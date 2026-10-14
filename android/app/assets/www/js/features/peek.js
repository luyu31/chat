/**
 * peek.js — 查岗摸鱼：看他在干什么
 *
 * 跟查岗互补：查岗是他查你，摸鱼是你看他。
 * 每天第一次打开时用"日期字符串"当种子的伪随机（seededRandom）
 * 抽一个当天的状态，当天内保持不变，零点后重抽；
 * 「偷看一下」有 60% 概率被他抓包（60 分钟冷却，localStorage 记 lastCaughtAt）；
 * 状态池完全开放：可删、点文字改名、输入框添加，删到只剩一个有保底。
 *
 * 对外：window.Peek = { open, getToday }
 */
(function () {
    'use strict';

    var KEY = 'peekStatus';               // { pool:[], lastRefresh:'YYYY-MM-DD', current, refreshDate, lastCaughtAt }
    var CAUGHT_COOLDOWN = 60 * 60 * 1000; // 被抓包后的冷却：60 分钟

    // ── 内置状态池（默认灌入，用户可增删改） ──────────────────────
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

    // ── 被抓包时他的反应台词（随机 4 条） ──────────────────────
    var CAUGHT_LINES = [
        '感觉有人在看我？',
        '看什么呢，我脸上有字？',
        '……你刚刚是不是在偷看我？',
        '再看再看就要收费了哦'
    ];

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

    // ── 今日状态：每天第一次取时抽签，当天内不再变（lastRefresh 记日期） ──────────────────────
    function getToday() {
        var d = load();
        // 池子不存在/被删空：回灌默认池
        if (!Array.isArray(d.pool) || !d.pool.length) d.pool = DEFAULT_POOL.slice();
        var today = todayStr();
        if (d.lastRefresh !== today || !d.current) {
            var rnd = seededRandom(today);
            d.current = d.pool[Math.floor(rnd() * d.pool.length)];
            d.lastRefresh = today;
            d.refreshDate = today;
            save(d);
        }
        return d.current;
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

    // ── 大卡片：头像 + 名字 + 今日状态大字 ──────────────────────
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
            +     '<div style="font-size:17px;font-weight:700;color:var(--text-primary,#333);line-height:1.4;margin-top:2px;">' + status + '</div>'
            +   '</div>'
            + '</div>'
            + '<div style="font-size:11px;color:var(--text-secondary,#999);margin:8px 0 12px 2px;">今日状态 · 每天 0 点刷新</div>';
    }

    // ── 状态池管理区：chips 可删可改名 + 输入框添加（control.js 暗号库同款风格） ──────────────────────
    function renderChips() {
        var box = document.getElementById('peek-pool-box');
        if (!box) return;
        var d = load();
        if (!Array.isArray(d.pool) || !d.pool.length) { d.pool = DEFAULT_POOL.slice(); save(d); }
        var pool = d.pool;

        var html = '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin-bottom:8px;">状态池</div>';
        html += '<div id="peek-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
        pool.forEach(function (p, i) {
            html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:20px;'
                + 'background:var(--secondary-bg,#f5f5f5);font-size:12px;color:var(--text-primary,#333);cursor:pointer;" title="点击改名">'
                + p
                + '<i class="fas fa-times peek-del" data-idx="' + i + '" style="cursor:pointer;color:var(--text-secondary,#ccc);font-size:10px;"></i>'
                + '</span>';
        });
        html += '</div>';
        html += '<div style="display:flex;gap:6px;">'
            + '<input id="peek-add-input" type="text" placeholder="添加状态，如：在给你织围巾" style="flex:1;padding:8px 10px;border:1px solid var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-primary,#333);outline:none;" />'
            + '<button type="button" id="peek-add-btn" style="padding:8px 12px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;">添加</button>'
            + '</div>';
        box.innerHTML = html;

        // 添加（去重）
        box.querySelector('#peek-add-btn').addEventListener('click', function () {
            var input = box.querySelector('#peek-add-input');
            var val = (input && input.value ? input.value : '').trim();
            if (!val) return;
            var d2 = load();
            if (!Array.isArray(d2.pool)) d2.pool = [];
            if (d2.pool.indexOf(val) !== -1) {
                if (typeof showNotification === 'function') showNotification('这个状态已经在池子里了', 'warning');
                return;
            }
            d2.pool.push(val);
            save(d2);
            renderChips();
        });

        // 删除（至少留一个，否则今天的卡片没东西可抽）
        box.querySelectorAll('.peek-del').forEach(function (icon) {
            icon.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(icon.getAttribute('data-idx'), 10);
                var d2 = load();
                if (d2.pool.length <= 1) {
                    if (typeof showNotification === 'function') showNotification('至少得留一个状态', 'warning');
                    return;
                }
                d2.pool.splice(idx, 1);
                save(d2);
                renderChips();
            });
        });

        // 点 chip 文字改名（当天已抽出的状态不受影响，明天才用新池子）
        box.querySelectorAll('#peek-chips > span').forEach(function (chip, i) {
            chip.addEventListener('click', function () {
                var d2 = load();
                var n = prompt('修改状态文字', d2.pool[i]);
                if (n && n.trim() && n.trim() !== d2.pool[i]) {
                    d2.pool[i] = n.trim();
                    save(d2);
                    renderChips();
                }
            });
        });
    }

    // ── 偷看一下：60% 被他抓包（60 分钟冷却），40% 安全偷看 ──────────────────────
    function peekHim() {
        var d = load();
        var now = Date.now();
        // 冷却中：刚被抓过包，先别看了
        if (d.lastCaughtAt && now - d.lastCaughtAt < CAUGHT_COOLDOWN) {
            if (typeof showNotification === 'function') showNotification('刚被他抓包过，一小时后再偷看吧');
            return;
        }
        if (Math.random() < 0.6) {
            // 被发现了：他在聊天流里回头"看你"
            d.lastCaughtAt = now;
            save(d);
            _partnerSay(pick(CAUGHT_LINES));
            if (typeof showNotification === 'function') showNotification('糟糕，被他发现了');
        } else {
            if (typeof showNotification === 'function') showNotification('偷看成功，他没发现');
        }
    }

    // ── 弹窗（照抄 checkin.js 的 buildModal 模式） ──────────────────────
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
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;">跟查岗互补：查岗是他查你，摸鱼是你看他。今日状态每天 0 点用日期种子抽签，全天不变。</div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#peek-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });
        m.querySelector('#peek-peek-btn').addEventListener('click', peekHim);
    }

    // ── 打开弹窗（对外 API：Peek.open） ──────────────────────
    function open() {
        buildModal();
        renderCard();
        renderChips();
        var m = document.getElementById('peek-modal');
        if (m) {
            if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
        }
    }

    // ── 启动：DOMContentLoaded 自动初始化（灌默认池 + 抽今日状态） ──────────────────────
    function init() {
        getToday();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.Peek = { open: open, getToday: getToday };
})();
