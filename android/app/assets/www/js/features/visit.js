/**
 * visit.js — 查岗：他会偷偷来看你
 *
 * 跟摸鱼对应：摸鱼是你去看他，查岗是他来看你。
 * 每 1.5~4 小时随机一个时间点他"路过"来看你一次（nextVisitAt 持久化，
 * 重启 App 不会丢）；每看一次都会在面板里留下一条记录（时间 + 他嘀咕的话，
 * 最多留 30 条）；如果他来看你的那一刻你正好在线（页面可见），
 * 会当场撞见他：顶部通知 + 聊天流里他发来一条"被抓包"的消息。
 *
 * 对外：window.Visit = { open, getRecords }
 */
(function () {
    'use strict';

    var KEY = 'visitData';                    // { records:[{ts,line,live}], nextVisitAt }
    var MAX_RECORDS = 30;                     // 记录最多保留条数
    var MIN_GAP = 1.5 * 60 * 60 * 1000;       // 两次来看你的最小间隔：1.5 小时
    var MAX_GAP = 4 * 60 * 60 * 1000;         // 最大间隔：4 小时
    var TICK = 30 * 1000;                     // 调度轮询：30 秒

    // ── 他来看你时嘀咕的话（写进记录） ──────────────────────
    var VISIT_LINES = [
        '悄悄来看了你一眼',
        '路过，顺便看看你在干嘛',
        '想你了，就来看看',
        '来看你一眼，心满意足地走了',
        '盯着你看了一会儿',
        '来看看你有没有好好吃饭',
        '隔着屏幕看了你半天',
        '来看看你有没有想他',
        '偷瞄了一眼，没敢打扰你',
        '来看你的时候你正好不在'
    ];

    // ── 你在线把他撞个正着时，他发来的话 ──────────────────────
    var CAUGHT_LINES = [
        '（被你撞见了）……我就路过看看你。',
        '呀，你在啊。我什么都没干，真的。',
        '本来想偷偷看你一眼就走的，被发现了。',
        '看你这么认真，没舍得打扰你。'
    ];

    // ── 存取 ──────────────────────
    function load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
        catch (e) { return {}; }
    }

    function save(d) {
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }

    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function _partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }

    function _fmtTime(ts) {
        var d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function _fmtDay(ts) {
        var d = new Date(ts);
        var now = new Date();
        var dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        if (ts >= dayStart) return '今天';
        if (ts >= dayStart - 86400000) return '昨天';
        return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    // ── 调度：到点他就来看你一次 ──────────────────────
    function _nextGap() {
        return MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);
    }

    function _ensureSchedule() {
        var d = load();
        if (!d.nextVisitAt || d.nextVisitAt < Date.now() - 24 * 60 * 60 * 1000) {
            // 首次使用（或数据异常超过一天）：10~40 分钟后他第一次来看你
            d.nextVisitAt = Date.now() + (10 + Math.random() * 30) * 60 * 1000;
            save(d);
        }
    }

    function _doVisit() {
        var d = load();
        var live = (typeof document.visibilityState === 'undefined') || document.visibilityState === 'visible';
        var rec = { ts: Date.now(), line: pick(VISIT_LINES), live: !!live };
        d.records = d.records || [];
        d.records.unshift(rec);
        if (d.records.length > MAX_RECORDS) d.records.length = MAX_RECORDS;
        d.nextVisitAt = Date.now() + _nextGap();
        save(d);

        if (live) {
            // 你正好在线 → 当场撞见他
            if (typeof showNotification === 'function') {
                showNotification(_partnerName() + ' 正在偷看你…', 'info', 3000);
            }
            try {
                if (typeof addMessage === 'function') {
                    addMessage({
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        sender: _partnerName(),
                        text: pick(CAUGHT_LINES),
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
    }

    function _tick() {
        var d = load();
        if (d.nextVisitAt && Date.now() >= d.nextVisitAt) {
            _doVisit();
        }
    }

    // ── 面板 ──────────────────────
    function _avatarHtml() {
        try {
            var img = document.querySelector('#partner-avatar img');
            if (img && img.src) return '<img src="' + img.src + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        } catch (e) {}
        return '<i class="fas fa-user" style="font-size:26px;color:var(--accent-color,#c5a47e);"></i>';
    }

    function renderPanel() {
        var head = document.getElementById('visit-head');
        var list = document.getElementById('visit-list');
        if (!head || !list) return;
        var d = load();
        var records = d.records || [];

        var lastText = records.length ? (_fmtDay(records[0].ts) + ' ' + _fmtTime(records[0].ts)) : '还没来过';
        head.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:16px;'
            + 'background:rgba(var(--accent-color-rgb,197,164,126),.08);border:1px solid rgba(var(--accent-color-rgb,197,164,126),.25);">'
            +   '<div style="width:56px;height:56px;border-radius:50%;flex-shrink:0;overflow:hidden;'
            +   'display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border:2px solid rgba(var(--accent-color-rgb,197,164,126),.3);">'
            +     _avatarHtml()
            +   '</div>'
            +   '<div style="flex:1;min-width:0;">'
            +     '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);">' + _partnerName() + '</div>'
            +     '<div style="font-size:14px;font-weight:700;color:var(--text-primary,#333);margin-top:3px;">上次来看你：' + lastText + '</div>'
            +     '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:2px;">累计来看你 ' + records.length + ' 次</div>'
            +   '</div>'
            + '</div>';

        if (!records.length) {
            list.innerHTML = '<div style="text-align:center;padding:24px 0;font-size:12px;color:var(--text-secondary,#999);">他还没来看过你，再等等～</div>';
            return;
        }
        list.innerHTML = records.map(function (r) {
            return '<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:12px;'
                + 'background:var(--primary-bg,transparent);border:1px solid var(--border-color,#e8e8e8);">'
                + '<div style="flex:1;min-width:0;font-size:13px;color:var(--text-primary,#333);">' + r.line + '</div>'
                + (r.live ? '<span style="flex-shrink:0;font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(var(--accent-color-rgb,197,164,126),.15);color:var(--accent-color,#c5a47e);font-weight:600;">当场撞见</span>' : '')
                + '<div style="flex-shrink:0;font-size:11px;color:var(--text-secondary,#999);">' + _fmtDay(r.ts) + ' ' + _fmtTime(r.ts) + '</div>'
                + '</div>';
        }).join('');
    }

    function buildModal() {
        if (document.getElementById('visit-modal')) return;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'visit-modal';
        m.style.zIndex = '3300';
        m.innerHTML =
        '<div class="modal-content" style="max-width:400px;width:90vw;">'
        +   '<div class="modal-title"><i class="fas fa-eye"></i><span>查岗 · 他来看你</span></div>'
        +   '<div id="visit-head" style="margin-bottom:10px;"></div>'
        +   '<div id="visit-list" style="display:flex;flex-direction:column;gap:6px;max-height:44vh;overflow-y:auto;padding:2px;"></div>'
        +   '<div style="display:flex;justify-content:flex-end;margin-top:12px;">'
        +     '<button type="button" id="visit-close" class="modal-btn modal-btn-secondary">关闭</button>'
        +   '</div>'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;">'
        +     '跟摸鱼对应：摸鱼是你去看他，查岗是他来看你。他会趁你不注意偷偷过来，每看一次都会留下记录；'
        +     '如果他来的时候你正好在线，会当场撞见他。'
        +   '</div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#visit-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });
    }

    function open() {
        buildModal();
        renderPanel();
        // 用查岗功能 → 梦角 App 熟练度 +1（每日上限 3 次）
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'visit', 3);
            }
        } catch (e) {}
        var m = document.getElementById('visit-modal');
        if (m) {
            if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
        }
    }

    // ── 启动：排上日程 + 30 秒轮询（首次检查延迟 10 秒，避开开屏） ──────────────────────
    function init() {
        _ensureSchedule();
        setTimeout(_tick, 10000);
        setInterval(_tick, TICK);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.Visit = {
        open: open,
        getRecords: function () { return (load().records || []).slice(); },
        // 控制台测试用：立即触发一次"他来看你"
        test: function () { _doVisit(); }
    };
})();
