/**
 * peek.js — 查岗摸鱼：看他在干什么
 *
 * 跟查岗互补：查岗是他查你，摸鱼是你看他。
 * 「他此刻在干嘛」和「他现在在哪」都用「日期+小时」当种子的伪随机（seededRandom），
 * 每小时抽一次：同一个小时内稳定不变，跨过整点自动换一条 —— 不再是一整天一个状态。
 * 状态和位置用不同的 salt，抽到的下标互相独立，不会看起来像联动。
 * 「偷看一下」抓不抓包完全随机（两种结果各占一半，不配置概率，
 * 60 分钟冷却，localStorage 记 lastCaughtAt）；
 * 状态池直接用字卡库的「摸鱼状态」字卡组（reply-library.js 的
 * window._getSlackingStatusPool），跟查岗共用同一份字卡，
 * 被抓包的反应来自「偷看抓包」字卡组，两个都能点「管理」直达增删改。
 *
 * 对外：window.Peek = { open, getToday }
 */
(function () {
    'use strict';

    var KEY = 'peekStatus';               // { lastCaughtAt }（状态/位置改成按时段现算，不再落库）
    var CAUGHT_COOLDOWN = 60 * 60 * 1000; // 被抓包后的冷却：60 分钟

    // ── 兜底状态池（字卡库没加载/被清空时才用） ──────────────────────
    var DEFAULT_POOL = [
        '在偷偷打瞌睡',
        '开小差中被抓包',
        '认真工作中（大概）',
        '摸鱼刷手机',
        '在想着你走神了',
        '健身房举铁中',
        '厨房里折腾新菜',
        '打游戏连胜中',
        '阳台发呆看云',
        '在挑下次约会的餐厅'
    ];

    // ── 兜底位置池（「他的位置」字卡组没加载/被清空时才用） ──────────────────────
    var DEFAULT_LOCATIONS = [
        '在书房看书',
        '在客厅沙发瘫着',
        '在厨房煮面',
        '在阳台吹风',
        '在公司工位',
        '在回来的路上',
        '在卧室补觉',
        '在楼下遛弯'
    ];

    // ── 兜底反应（自定义回复为空时才用） ──────────────────────
    var CAUGHT_LINES = [
        '感觉有人在看我？',
        '看什么呢，我脸上有字？',
        '……你刚刚是不是在偷看我？',
        '再看再看就要收费了哦'
    ];

    // ── 被抓包时他的反应：直接用「自定义回复」里的主字卡，不再单独维护一组 ──────────────────
    // 你平时给他加的字卡，就是他生活里会说的话；抓包反应也从这里挑，才不像刻意写好的台词。
    function _getCaughtPool() {
        var pool = [];
        try {
            if (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) {
                pool = customReplies.map(function (r) {
                    return typeof r === 'string' ? r : (r && (r.text || r.content)) || '';
                }).filter(function (s) { return s && String(s).trim(); });
            }
        } catch (e) {}
        if (!pool.length && typeof window._getPeekCaughtPool === 'function') {
            try { pool = window._getPeekCaughtPool(); } catch (e) {}
        }
        if (!Array.isArray(pool) || !pool.length) pool = CAUGHT_LINES.slice();
        return pool;
    }

    // ── 存取 ──────────────────────
    function load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
        catch (e) { return {}; }
    }

    function save(d) {
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }

    function todayStr() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ── 状态池：优先字卡库的「摸鱼状态」字卡组，兜底用内置默认 ──────────────────────
    function _getPool() {
        var pool = [];
        if (typeof window._getSlackingStatusPool === 'function') {
            try { pool = window._getSlackingStatusPool(); } catch (e) {}
        }
        if (!Array.isArray(pool) || !pool.length) pool = DEFAULT_POOL.slice();
        return pool;
    }

    // ── 位置池：优先字卡库的「他的位置」字卡组，兜底用内置默认 ──────────────────────
    function _getLocationPool() {
        var pool = [];
        if (typeof window._getPartnerLocationPool === 'function') {
            try { pool = window._getPartnerLocationPool(); } catch (e) {}
        }
        if (!Array.isArray(pool) || !pool.length) pool = DEFAULT_LOCATIONS.slice();
        return pool;
    }

    // ── 每小时随机：用「日期+小时+用途」当种子，同一小时内稳定，跨小时自动换 ──────────────────────
    // salt 让"在干嘛"和"在哪"抽到各自独立的下标，不会看起来像联动
    function _hourlyIndex(len, day, hour, salt) {
        var rnd = seededRandom(day + '-h' + hour + '-' + salt);
        return Math.floor(rnd() * len) % len;
    }
    // 一次性把当天 0~23 点的下标序列算出来，遇到和上一条相同就往后挪一格 ——
    // 这样"相邻两个小时一定不一样"，不会出现连着两小时都是一条、看起来像没换。
    // 单次遍历 24 次，代价可忽略；而且这是纯函数：同一天同一小时内，
    // 全应用任何地方算出来的结果都一样，状态始终一致。
    function _daySequence(len, day, salt) {
        var seq = [];
        for (var h = 0; h < 24; h++) {
            var idx = _hourlyIndex(len, day, h, salt);
            if (h > 0 && idx === seq[h - 1] && len > 1) idx = (idx + 1) % len;
            seq.push(idx);
        }
        return seq;
    }
    function _pickHourly(pool, salt) {
        if (!Array.isArray(pool) || !pool.length) return '';
        var len = pool.length;
        if (len === 1) return pool[0];
        var seq = _daySequence(len, todayStr(), salt);
        var idx = seq[new Date().getHours()];
        if (idx == null) idx = 0;
        return pool[idx] || pool[0];
    }

    // ── 他现在在哪：每小时换，同一小时内稳定 ──────────────────────
    function getLocationNow() {
        return _pickHourly(_getLocationPool(), 'loc');
    }

    // ── 日期字符串种子伪随机：同一天种子相同，抽出的状态全天稳定 ──────────────────────
    function seededRandom(seedStr) {
        // FNV-1a 先把日期字符串揉成整数
        var h = 2166136261;
        for (var i = 0; i < seedStr.length; i++) {
            h ^= seedStr.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        // 返回一个 xorshift32 随机函数（0~1）
        return function () {
            h ^= h << 13; h >>>= 0;
            h ^= h >> 17;
            h ^= h << 5; h >>>= 0;
            return (h >>> 0) / 4294967296;
        };
    }

    // ── 此刻在干嘛：跟位置一样「每小时换」，同一小时内稳定 ──────────────────────
    // 以前是每天 0 点抽一次、全天不变 —— 一天都是一个状态太无聊了，改成每小时自动换
    function getToday() {
        return _pickHourly(_getPool(), 'act');
    }

    function _partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }

    // 他的头像：#partner-avatar img 取不到就用 fa-user 兜底
    function _avatarHtml() {
        try {
            var img = document.querySelector('#partner-avatar img');
            if (img && img.src) return '<img src="' + img.src + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        } catch (e) {}
        return '<i class="fas fa-user" style="font-size:26px;color:var(--accent-color,#c5a47e);"></i>';
    }

    // 以他的身份往聊天流说一句话（addMessage 存在性检查，缺了就静默跳过）
    function _partnerSay(text) {
        try {
            if (typeof addMessage === 'function') {
                addMessage({
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    sender: _partnerName(),
                    text: text,
                    timestamp: new Date(),
                    status: 'received',
                    favorited: false,
                    note: null,
                    replyTo: null,
                    type: 'normal'
                });
                if (typeof playSound === 'function') playSound('message');
            }
        } catch (e) {}
    }

    // ── 大卡片：头像 + 名字 + 今日状态大字 + 他现在在哪 ──────────────────────
    function renderCard() {
        var el = document.getElementById('peek-card');
        if (!el) return;
        var status = getToday();
        el.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:16px;'
            + 'background:rgba(var(--accent-color-rgb,197,164,126),.08);border:1px solid rgba(var(--accent-color-rgb,197,164,126),.25);">'
            +   '<div style="width:56px;height:56px;border-radius:50%;flex-shrink:0;overflow:hidden;'
            +   'display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border:2px solid rgba(var(--accent-color-rgb,197,164,126),.3);">'
            +     _avatarHtml()
            +   '</div>'
            +   '<div style="flex:1;min-width:0;">'
            +     '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);">' + _partnerName() + '</div>'
            +     '<div style="font-size:17px;font-weight:700;color:var(--text-primary,#333);line-height:1.4;margin-top:2px;" id="peek-status-text"></div>'
            +     '<div style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--accent-color,#c5a47e);margin-top:5px;">'
            +       '<i class="fas fa-location-dot" style="font-size:10px;"></i>'
            +       '<span id="peek-location-text"></span>'
            +     '</div>'
            +   '</div>'
            + '</div>'
            + '<div style="font-size:11px;color:var(--text-secondary,#999);margin:8px 0 12px 2px;">「在干嘛」和「在哪」都<b>每小时自动换一次</b> · 字卡来自「摸鱼状态」「他的位置」字卡组</div>';
        var textEl = document.getElementById('peek-status-text');
        if (textEl) textEl.textContent = status;
        var locEl = document.getElementById('peek-location-text');
        if (locEl) locEl.textContent = getLocationNow();
    }

    // ── 字卡组管理区：显示当前条数 + 直达「摸鱼状态」/「他的位置」字卡组编辑 ──────────────────────
    function renderPoolBox() {
        var box = document.getElementById('peek-pool-box');
        if (!box) return;
        box.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:8px;">'
            +   '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
            +     '<span style="font-size:12px;color:var(--text-secondary,#888);">状态字卡 ' + _getPool().length + ' 条 · 位置字卡 ' + _getLocationPool().length + ' 条 · 抓包反应 ' + _getCaughtPool().length + ' 条</span>'
            +   '</div>'
            +   '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
            +     '<button type="button" id="peek-manage-cards" style="flex:1;min-width:100px;padding:7px 12px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;">'
            +       '<i class="fas fa-comment-dots"></i> 管理状态字卡'
            +     '</button>'
            +     '<button type="button" id="peek-manage-locations" style="flex:1;min-width:100px;padding:7px 12px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;">'
            +       '<i class="fas fa-location-dot"></i> 管理位置字卡'
            +     '</button>'
            +     '<button type="button" id="peek-manage-caught" style="flex:1;min-width:100px;padding:7px 12px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;">'
            +       '<i class="fas fa-eye"></i> 管理抓包反应'
            +     '</button>'
            +   '</div>'
            + '</div>';
        box.querySelector('#peek-manage-cards').addEventListener('click', function () {
            _openCardLibrary('slacking', '[peek] 打开摸鱼状态字卡失败:');
        });
        box.querySelector('#peek-manage-locations').addEventListener('click', function () {
            _openCardLibrary('locationBank', '[peek] 打开位置字卡失败:');
        });
        box.querySelector('#peek-manage-caught').addEventListener('click', function () {
            _openCardLibrary('peekCaught', '[peek] 打开抓包反应字卡失败:');
        });
    }

    // 直达氛围感配置的指定字卡 tab；先关掉摸鱼弹窗，避免字卡库被盖在下面
    function _openCardLibrary(subTab, warnTag) {
        try {
            var peekModal = document.getElementById('peek-modal');
            if (peekModal && typeof hideModal === 'function') hideModal(peekModal);
            if (typeof currentMajorTab !== 'undefined') { currentMajorTab = 'atmosphere'; currentSubTab = subTab; }
            if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
            var libModal = document.getElementById('custom-replies-modal');
            if (libModal && typeof showModal === 'function') showModal(libModal);
        } catch (e) { console.warn(warnTag, e); }
    }

    // ── 偷看一下：抓不抓包完全随机（两个结果均匀抽，不配置任何概率） ──────────────────────
    function peekHim() {
        var d = load();
        var now = Date.now();
        // 冷却中：刚被抓过包，先别看了
        if (d.lastCaughtAt && now - d.lastCaughtAt < CAUGHT_COOLDOWN) {
            if (typeof showNotification === 'function') showNotification('刚被他抓包过，一小时后再偷看吧');
            return;
        }
        var caught = pick(['caught', 'safe']);
        if (caught === 'caught') {
            // 被发现了：他在聊天流里回头"看你"，反应从字卡组均匀随机
            d.lastCaughtAt = now;
            save(d);
            _partnerSay(pick(_getCaughtPool()));
            if (typeof showNotification === 'function') showNotification('糟糕，被他发现了');
        } else {
            // 安全偷看：今日状态和位置保持唯一数据源（与双向打卡完全一致），
            // 不在这里临时随机改卡片——他此刻在做什么、在哪，全应用只有一个答案
            if (typeof showNotification === 'function') showNotification('偷看成功，他没发现');
        }
    }

    // ── 弹窗（照抄 checkin.js 的 buildModal 模式） ──────────────────────
    // 状态/位置是"每小时换"，页面一直开着跨过整点时也要跟着变，所以开一个轻量对表定时器
    var _tickTimer = null;
    function _stopTick() {
        if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
    }

    function buildModal() {
        if (document.getElementById('peek-modal')) return;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'peek-modal';
        m.style.zIndex = '3300';
        m.innerHTML =
        '<div class="modal-content" style="max-width:400px;width:90vw;">'
        +   '<div class="modal-title"><i class="fas fa-binoculars"></i><span>摸鱼 · 看他在干嘛</span></div>'
        +   '<div id="peek-card"></div>'
        +   '<button type="button" id="peek-peek-btn" style="width:100%;padding:12px;border:none;border-radius:12px;background:var(--accent-color,#c5a47e);color:#fff;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:14px;">偷看一下</button>'
        +   '<div id="peek-pool-box"></div>'
        +   '<div style="display:flex;justify-content:flex-end;margin-top:12px;">'
        +     '<button type="button" id="peek-close" class="modal-btn modal-btn-secondary">关闭</button>'
        +   '</div>'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;">跟关心妹妹互补：关心妹妹是他来看你，摸鱼是你看他。他现在在干嘛、在哪，都是每小时自动换一次（同一小时内保持一致）。</div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#peek-close').addEventListener('click', function () {
            _stopTick();
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) {
                _stopTick();
                if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
            }
        });
        m.querySelector('#peek-peek-btn').addEventListener('click', peekHim);
    }

    // ── 打开弹窗（对外 API：Peek.open） ──────────────────────
    function open() {
        buildModal();
        renderCard();
        renderPoolBox();
        // 用摸鱼功能 → 梦角 App 熟练度 +1（每日上限 3 次）
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'peek', 3);
            }
        } catch (e) {}
        var m = document.getElementById('peek-modal');
        if (m) {
            if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
        }
        // 页面开着时每分钟对一次表：跨过整点自动换成新的"在干嘛 / 在哪"
        _stopTick();
        _tickTimer = setInterval(function () {
            var modal = document.getElementById('peek-modal');
            if (!modal || modal.style.display === 'none') { _stopTick(); return; }
            renderCard();
        }, 60000);
    }

    // ── 启动（状态/位置现在是按小时现算的纯函数，这里不需要预热） ──────────────────────
    function init() {}

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 对外：getToday=他此刻在做什么（本小时唯一状态字卡），
    //       getLocationNow=他此刻在哪（本小时唯一地点字卡，和状态各抽各的）。
    // 双向打卡等所有功能都必须从这里取，保证同一小时内全应用状态一致
    window.Peek = { open: open, getToday: getToday, getLocationNow: getLocationNow };
})();
