/**
 * apple-push.js — 本地后台推送（类微信通知栏）
 *  - 退到后台后按设定频率持续提醒（闹钟链，最长 30 天）
 *  - 锁屏、进程被回收、手机重启后都能继续
 *  - 回到 App 自动补进聊天记录，并清掉通知
 * 仅在 APK 环境生效。
 */
(function () {
    'use strict';

    var native = window.AppleDiary;
    if (!native || !native.isNative || !native.isNative()) return;
    if (typeof native.pushStartChain !== 'function') return;
    window.__APPLE_PUSH__ = true;

    // 通知只提示"收到了新消息"，不再使用写死的聊天句子；
    // 真正的消息由原来的随机回复（simulateReply）产生。
    var NOTIFY_BODY = '在后台收到了新消息';

    var GAPS = [5, 15, 30, 60];
    var HOURS = [6, 24, 168, 0];

    function prefOn() {
        try {
            return localStorage.getItem('notifEnabled') !== '0';
        } catch (e) {
            return true;
        }
    }

    function status() {
        try {
            return JSON.parse(native.pushStatus() || '{}');
        } catch (e) {
            return { enabled: true };
        }
    }

    function partnerName() {
        try {
            if (typeof settings !== 'undefined' && settings.partnerName) return settings.partnerName;
        } catch (e) {}
        return '梦伴';
    }

    function gapMinutes() {
        try {
            var v = parseInt(localStorage.getItem('pushGapMin'), 10);
            if (v > 0) return Math.max(5, v);
        } catch (e) {}
        try {
            if (typeof settings !== 'undefined' && settings.autoSendEnabled) {
                return Math.max(5, settings.autoSendInterval || 15);
            }
        } catch (e) {}
        return 15;
    }

    function hoursValue() {
        try {
            var v = localStorage.getItem('pushHours');
            if (v !== null && v !== '') return parseInt(v, 10) || 0;
        } catch (e) {}
        return 24;
    }

    function toast(msg, type) {
        if (typeof showNotification === 'function') showNotification(msg, type || 'info', 2400);
    }

    function startBackgroundChain() {
        if (!prefOn()) return;
        if (status().enabled === false) return;
        var gap = gapMinutes() * 60 * 1000;
        try {
            native.pushStartChain(JSON.stringify({
                title: partnerName(),
                texts: [NOTIFY_BODY],
                gap: gap,
                hours: hoursValue()
            }));
        } catch (e) {}
    }

    function stopChain() {
        try { native.pushCancelAll(); } catch (e) {}
    }

    var consuming = false;
    function consumePending() {
        if (consuming) return;
        consuming = true;
        var list = [];
        try { list = JSON.parse(native.pushTakePending() || '[]'); } catch (e) { list = []; }
        consuming = false;
        if (!list.length) return;
        // 后台提醒不再往聊天里塞写死的句子：回到前台由原来的随机回复补一条
        if (typeof window.simulateReply === 'function') {
            setTimeout(function () {
                try { window.simulateReply(); } catch (e) {}
            }, 900);
        }
    }

    window.__applePushOnBackground = function () {
        startBackgroundChain();
    };

    window.__applePushOnForeground = function () {
        stopChain();
        try { native.pushClear(); } catch (e) {}
        setTimeout(consumePending, 700);
    };

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') window.__applePushOnForeground();
        else window.__applePushOnBackground();
    });

    window.addEventListener('pagehide', function () {
        startBackgroundChain();
    });

    setTimeout(function () {
        if (document.visibilityState === 'visible') consumePending();
    }, 2000);

    // ---------------- 设置面板 ----------------

    function chip(label, active) {
        return '<button class="apple-sync-mini" data-chip="1" style="flex:1;'
            + (active ? 'background:#EE7B2F;color:#fff;border:none;' : 'background:var(--primary-bg);color:var(--text-primary);border:1px solid var(--border-color);')
            + '">' + label + '</button>';
    }

    function gapLabel(v) {
        return v + '分钟';
    }

    function hoursLabel(v) {
        if (v === 0) return '一直';
        if (v === 168) return '7天';
        return v + '小时';
    }

    function renderBody(body) {
        var st = status();
        var enabled = st.enabled !== false;
        var on = prefOn();
        var gap = gapMinutes();
        var hv = hoursValue();

        body.innerHTML = '<div class="apple-sync-card">'
            + '<h4><i class="fas fa-bell" style="color:#EE7B2F"></i> '
            + (enabled ? '通知权限正常' : '系统通知被关闭') + '</h4>'
            + '<p>' + (enabled
                ? '退到后台后每 ' + gapLabel(gap) + ' 提醒一次，持续 ' + hoursLabel(hv) + '；'
                    + '锁屏、清理后台、重启手机都会继续。回到 App 后会收到一条随机消息。'
                : '没拿到通知权限，通知栏不会显示。先去系统设置里允许「苹果日记」发通知。') + '</p>'
            + (enabled ? '' : '<button class="apple-sync-btn red" id="apple-push-perm" style="margin-top:10px">'
                + '<span class="ico"><i class="fas fa-bell-slash"></i></span>'
                + '<span class="txt"><b>去打开通知权限</b><small>系统设置 → 通知</small></span></button>')
            + '<div style="margin-top:12px;font-size:12px;color:var(--text-secondary)">提醒频率</div>'
            + '<div class="apple-sync-row" style="margin-top:6px" id="apple-push-gap-row">'
            + GAPS.map(function (g) { return chip(gapLabel(g), g === gap); }).join('')
            + '</div>'
            + '<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">持续时长</div>'
            + '<div class="apple-sync-row" style="margin-top:6px" id="apple-push-hour-row">'
            + HOURS.map(function (h) { return chip(hoursLabel(h), h === hv); }).join('')
            + '</div>'
            + '<div class="apple-sync-row" style="margin-top:12px">'
            + '<button class="apple-sync-mini" id="apple-push-test" style="flex:1">发送测试通知</button>'
            + '<button class="apple-sync-mini ghost" id="apple-push-battery" style="flex:1">'
            + (st.battery ? '电池优化已关闭' : '关闭电池优化') + '</button>'
            + '</div>'
            + '<div class="apple-sync-row" style="margin-top:8px">'
            + '<button class="apple-sync-mini ghost" id="apple-push-toggle" style="flex:1">'
            + (on ? '关闭后台提醒' : '开启后台提醒') + '</button>'
            + '</div>'
            + '<p class="apple-sync-hint">这是本机定时提醒，不需要联网。'
            + '华为手机上建议在「应用启动管理」里允许自启动，并关闭电池优化。</p>'
            + '</div>';

        body.querySelectorAll('#apple-push-gap-row [data-chip]').forEach(function (btn, i) {
            btn.addEventListener('click', function () {
                try { localStorage.setItem('pushGapMin', String(GAPS[i])); } catch (e) {}
                renderBody(body);
                if (document.visibilityState !== 'visible') startBackgroundChain();
            });
        });
        body.querySelectorAll('#apple-push-hour-row [data-chip]').forEach(function (btn, i) {
            btn.addEventListener('click', function () {
                try { localStorage.setItem('pushHours', String(HOURS[i])); } catch (e) {}
                renderBody(body);
                if (document.visibilityState !== 'visible') startBackgroundChain();
            });
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
        var bat = body.querySelector('#apple-push-battery');
        if (bat) bat.addEventListener('click', function () {
            try { native.openBatterySettings(); } catch (e) {}
        });
        var toggle = body.querySelector('#apple-push-toggle');
        if (toggle) toggle.addEventListener('click', function () {
            try { localStorage.setItem('notifEnabled', prefOn() ? '0' : '1'); } catch (e) {}
            if (!prefOn()) stopChain();
            renderBody(body);
            toast(prefOn() ? '后台提醒已开启' : '后台提醒已关闭', 'success');
        });
    }

    function openPushModal() {
        var modal = document.getElementById('apple-push-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'apple-push-modal';
            modal.innerHTML = '<div class="modal-content">'
                + '<div class="modal-title"><i class="fas fa-bell" style="color:#EE7B2F"></i><span>消息推送</span></div>'
                + '<div class="apple-sync-body"><div id="apple-push-body"></div></div>'
                + '<div class="modal-buttons" style="padding-bottom: max(14px, env(safe-area-inset-bottom, 14px));">'
                + '<span></span><button class="modal-btn modal-btn-secondary" id="apple-push-close">关闭</button>'
                + '</div></div>';
            document.body.appendChild(modal);
            document.getElementById('apple-push-close').addEventListener('click', function () {
                if (typeof hideModal === 'function') hideModal(modal);
                else modal.style.display = 'none';
            });
        }
        renderBody(document.getElementById('apple-push-body'));
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
        card.innerHTML = '<i class="fas fa-bell" style="color:#EE7B2F"></i>'
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
