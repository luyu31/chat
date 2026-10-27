/**
 * apple-push.js — 本地消息推送（类微信通知栏提醒）
 *  - App 退到后台时，用 AlarmManager 排 3 条定时提醒
 *  - 到点由系统发通知，App 被杀掉也能响
 *  - 回到 App 时把已触发的提醒补成聊天消息，保持记录一致
 * 仅在 APK 环境生效。
 */
(function () {
    'use strict';

    var native = window.AppleDiary;
    if (!native || !native.isNative || !native.isNative()) return;
    if (typeof native.pushSchedule !== 'function') return;
    window.__APPLE_PUSH__ = true;

    var TEXTS = [
        '在忙吗？刚刚突然想到你了。',
        '今天也要好好吃饭呀。',
        '我这边天色暗下来了，你那边呢？',
        '记得喝水，别一直盯着屏幕。',
        '有点想你了，忙完回来说一声。',
        '今天过得怎么样？想听你讲讲。',
        '路过一棵苹果树，想起我们的约定了。',
        '别熬夜啦，早点休息，我在。'
    ];

    function prefOn() {
        try {
            return localStorage.getItem('notifEnabled') !== '0';
        } catch (e) {
            return true;
        }
    }

    function canNotify() {
        try {
            var st = JSON.parse(native.pushStatus() || '{}');
            return st.enabled !== false;
        } catch (e) {
            return true;
        }
    }

    function partnerName() {
        try {
            if (typeof settings !== 'undefined' && settings.partnerName) return settings.partnerName;
        } catch (e) {}
        return '梦伴';
    }

    function gapMs() {
        try {
            if (typeof settings !== 'undefined' && settings.autoSendEnabled) {
                return Math.max(3, settings.autoSendInterval || 5) * 60 * 1000;
            }
        } catch (e) {}
        return 15 * 60 * 1000;
    }

    function toast(msg, type) {
        if (typeof showNotification === 'function') showNotification(msg, type || 'info', 2400);
    }

    function scheduleBackground() {
        if (!prefOn() || !canNotify()) return;
        var now = Date.now();
        var gap = gapMs();
        var items = [];
        for (var i = 1; i <= 3; i++) {
            items.push({
                at: now + gap * i,
                title: partnerName(),
                body: TEXTS[Math.floor(Math.random() * TEXTS.length)]
            });
        }
        try {
            native.pushSchedule(JSON.stringify({ items: items, texts: TEXTS, gap: gap }));
        } catch (e) {}
    }

    function cancelAll() {
        try { native.pushCancelAll(); } catch (e) {}
    }

    var consuming = false;
    function consumePending() {
        if (consuming) return;
        consuming = true;
        var list = [];
        try { list = JSON.parse(native.pushTakePending() || '[]'); } catch (e) { list = []; }
        if (!list.length || typeof addMessage !== 'function') {
            consuming = false;
            return;
        }
        list.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
        var added = 0;
        var name = partnerName();
        list.forEach(function (p) {
            var body = String(p.body || '').trim();
            if (!body) return;
            try {
                addMessage({
                    id: (p.time || Date.now()) + added,
                    sender: name,
                    text: body,
                    timestamp: new Date(p.time || Date.now()),
                    status: 'received',
                    favorited: false,
                    note: null,
                    type: 'normal'
                });
                added++;
            } catch (e) {}
        });
        consuming = false;
        if (added && typeof saveData === 'function') {
            try { saveData(); } catch (e) {}
        }
    }

    window.__applePushOnBackground = function () {
        scheduleBackground();
    };

    window.__applePushOnForeground = function () {
        cancelAll();
        try { native.pushClear(); } catch (e) {}
        setTimeout(consumePending, 700);
    };

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') window.__applePushOnForeground();
        else window.__applePushOnBackground();
    });

    window.addEventListener('pagehide', function () {
        scheduleBackground();
    });

    setTimeout(function () {
        if (document.visibilityState === 'visible') consumePending();
    }, 2000);

    // ---------------- 设置入口 ----------------

    function updateModalBody(body) {
        var enabled = canNotify();
        var on = prefOn();
        body.innerHTML = '<div class="apple-sync-card">'
            + '<h4><i class="fas fa-bell" style="color:var(--accent-color,#EE7B2F)"></i> '
            + (enabled ? '通知权限正常' : '系统通知被关闭') + '</h4>'
            + '<p>' + (enabled
                ? '退到后台后，会按聊天频率给你发通知栏提醒；回到 App 会自动补成聊天消息。'
                : '没拿到通知权限，通知栏不会显示。点下面的按钮去系统设置里打开「通知」。') + '</p>'
            + '<div class="apple-sync-actions" style="margin-top:10px">'
            + '<button class="apple-sync-btn blue" id="apple-push-toggle">'
            + '<span class="ico"><i class="fas fa-toggle-' + (on ? 'on' : 'off') + '"></i></span>'
            + '<span class="txt"><b>后台主动提醒：' + (on ? '已开启' : '已关闭') + '</b>'
            + '<small>关闭后只在打开 App 时才看到消息</small></span></button>'
            + (enabled ? '' : '<button class="apple-sync-btn red" id="apple-push-perm">'
                + '<span class="ico"><i class="fas fa-bell-slash"></i></span>'
                + '<span class="txt"><b>去打开通知权限</b><small>系统设置 → 通知</small></span></button>')
            + '</div>'
            + '<div class="apple-sync-row" style="margin-top:10px">'
            + '<button class="apple-sync-mini" id="apple-push-test">发送测试通知</button>'
            + '</div>'
            + '<p class="apple-sync-hint">本地定时提醒，不需要联网，也不用注册。'
            + 'App 被系统彻底清理后仍会提醒（除非系统禁止自启动）。</p>'
            + '</div>';

        var toggle = body.querySelector('#apple-push-toggle');
        if (toggle) toggle.addEventListener('click', function () {
            try {
                localStorage.setItem('notifEnabled', prefOn() ? '0' : '1');
            } catch (e) {}
            updateModalBody(body);
            toast(prefOn() ? '后台提醒已开启' : '后台提醒已关闭', 'success');
        });
        var perm = body.querySelector('#apple-push-perm');
        if (perm) perm.addEventListener('click', function () {
            try { native.openAppSettings(); } catch (e) {}
        });
        var test = body.querySelector('#apple-push-test');
        if (test) test.addEventListener('click', function () {
            try {
                native.pushTest(partnerName(), '这是一条测试提醒，看到我就说明推送通了。');
                toast('已发送，下拉通知栏看看', 'success');
            } catch (e) {}
        });
    }

    function openPushModal() {
        var modal = document.getElementById('apple-push-modal');
        if (!modal) {
            var bodyId = 'apple-push-body';
            modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'apple-push-modal';
            modal.innerHTML = '<div class="modal-content">'
                + '<div class="modal-title"><i class="fas fa-bell" style="color:var(--accent-color,#EE7B2F)"></i><span>消息推送</span></div>'
                + '<div class="apple-sync-body"><div id="' + bodyId + '"></div></div>'
                + '<div class="modal-buttons" style="padding-bottom: max(14px, env(safe-area-inset-bottom, 14px));">'
                + '<span></span><button class="modal-btn modal-btn-secondary" id="apple-push-close">关闭</button>'
                + '</div></div>';
            document.body.appendChild(modal);
            document.getElementById('apple-push-close').addEventListener('click', function () {
                if (typeof hideModal === 'function') hideModal(modal);
                else modal.style.display = 'none';
            });
        }
        updateModalBody(document.getElementById('apple-push-body'));
        if (typeof showModal === 'function') showModal(modal);
        else modal.style.display = 'flex';
    }

    function injectSettingsEntry() {
        if (document.getElementById('apple-push-entry')) return;
        var settingsModal = document.getElementById('settings-modal');
        var grid = settingsModal && settingsModal.querySelector('.settings-grid');
        if (!grid) return;
        var card = document.createElement('div');
        card.className = 'settings-card';
        card.id = 'apple-push-entry';
        card.style.gridColumn = '1 / -1';
        card.innerHTML = '<i class="fas fa-bell" style="color:var(--accent-color,#EE7B2F)"></i>'
            + '<span>消息推送</span>'
            + '<span style="font-size:10px;color:var(--text-secondary);margin-top:-2px;">后台也能收到提醒</span>';
        card.addEventListener('click', function (e) {
            e.stopPropagation();
            openPushModal();
        });
        grid.appendChild(card);
    }

    var tries = 0;
    var timer = setInterval(function () {
        tries++;
        injectSettingsEntry();
        if (document.getElementById('apple-push-entry') || tries > 40) clearInterval(timer);
    }, 500);
    document.addEventListener('visibilitychange', injectSettingsEntry);
})();
