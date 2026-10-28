/**
 * apple-push.js — 本地后台推送（类微信通知栏）
 *  - 退到后台后按设定频率持续提醒（闹钟链，最长 30 天）
 *  - 锁屏、进程被回收、手机重启后都能继续
 *  - 通知是「消息凭据」：点击后带回 sessionId / messageId，直接定位到那条消息
 *  - 不再为了"看起来像收到消息"而随机生成一条回复（那正是幽灵通知的来源）
 * 仅在 APK 环境生效。
 */
(function () {
    'use strict';

    var native = window.AppleDiary;
    if (!native || !native.isNative || !native.isNative()) return;
    if (typeof native.pushStartChain !== 'function') return;
    window.__APPLE_PUSH__ = true;

    // 后台提醒只是"提醒"，不写死聊天内容；真正的消息由前台的聊天链路产生
    var NOTIFY_BODY = '收到一条新消息';
    // 需要切换会话时，先把跳转目标存本地，reload 之后再消费
    var JUMP_KEY = 'appleNotifyJumpTarget';

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

    // 数据（消息/设置）加载完成前不要做跳转或补全，否则会对着空数组操作
    function whenDataReady(fn) {
        if (window.__APP_DATA_LOADED__) { fn(); return; }
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (window.__APP_DATA_LOADED__ || tries > 150) {
                clearInterval(timer);
                fn();
            }
        }, 200);
    }

    function currentSessionId() {
        try {
            if (typeof SESSION_ID !== 'undefined' && SESSION_ID) return String(SESSION_ID);
        } catch (e) {}
        return '';
    }

    function hasMessage(messageId) {
        if (!messageId) return false;
        try {
            if (typeof messages === 'undefined' || !Array.isArray(messages)) return false;
            return messages.some(function (m) { return String(m.id) === String(messageId); });
        } catch (e) {
            return false;
        }
    }

    function closeOverlays() {
        var dyn = document.getElementById('companion-modal-dynamic');
        if (dyn) dyn.remove();
        document.querySelectorAll('.modal').forEach(function (m) {
            if (getComputedStyle(m).display !== 'none') {
                if (typeof window.hideModal === 'function') window.hideModal(m);
                else m.style.display = 'none';
            }
        });
        if (typeof window.closeCoupleSpace === 'function') window.closeCoupleSpace();
    }

    // 跳转：先关掉挡在聊天上面的页面/弹窗，再按 messageId 定位并高亮；
    // 找不到这条消息（被删了/数据对不上）就只停在聊天底部，不弹错误。
    function goToTarget(messageId) {
        var companionPage = document.getElementById('companion-page');
        var companionApi = window.companionModule;
        if (companionPage && companionPage.classList.contains('active')
            && companionApi && typeof companionApi.closeCompanionPage === 'function') {
            try { companionApi.closeCompanionPage({ skipLogEvent: true }); } catch (e) {}
        }
        closeOverlays();
        setTimeout(function () {
            if (messageId && hasMessage(messageId)
                && typeof window._jumpToMessage === 'function'
                && window._jumpToMessage(messageId)) {
                return;
            }
            if (typeof window._backToLatestMessages === 'function') window._backToLatestMessages();
        }, 420);
    }

    function handleClickPayload(payload) {
        var sessionId = payload && payload.sessionId ? String(payload.sessionId) : '';
        var messageId = payload && payload.messageId ? String(payload.messageId) : '';
        var current = currentSessionId();
        if (sessionId && current && sessionId !== current) {
            // 通知属于另一个会话：先记下目标，切过去（会 reload），加载完再由 consumeJumpTarget 跳
            try {
                localStorage.setItem(JUMP_KEY, JSON.stringify({
                    sessionId: sessionId,
                    messageId: messageId,
                    ts: Date.now()
                }));
            } catch (e) {}
            window.location.hash = sessionId;
            window.location.reload();
            return;
        }
        goToTarget(messageId);
    }

    // 会话切换 reload 之后，把刚才记下的跳转目标消费掉
    function consumeJumpTarget() {
        var raw = null;
        try { raw = localStorage.getItem(JUMP_KEY); } catch (e) {}
        if (!raw) return false;
        try { localStorage.removeItem(JUMP_KEY); } catch (e) {}
        var target = null;
        try { target = JSON.parse(raw); } catch (e) { return false; }
        if (!target || !target.ts || Date.now() - target.ts > 10 * 60 * 1000) return false;
        // 会话没切成功就别乱跳
        if (target.sessionId && currentSessionId()
            && String(target.sessionId) !== currentSessionId()) return false;
        goToTarget(target.messageId ? String(target.messageId) : '');
        return true;
    }

    // 原生把"通知点击"推过来的入口（冷启动时由 MainActivity 的待投递队列补发）
    window.__appleNotifyOpen = function (payload) {
        var data = null;
        try { data = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (e) { data = null; }
        if (!data) return false;
        whenDataReady(function () {
            // 上一个页面可能已经写了"切会话后要跳"的记录，优先消费它
            if (!consumeJumpTarget()) handleClickPayload(data);
        });
        return true;
    };

    // 待处理通知：只做"核对 + 补落库 + ack"，绝不生成新消息。
    var consuming = false;
    function consumePending() {
        if (consuming) return;
        if (!native || typeof native.pushPeekPending !== 'function') return;
        consuming = true;
        whenDataReady(function () {
            var list = [];
            try { list = JSON.parse(native.pushPeekPending() || '[]'); } catch (e) { list = []; }
            if (!list || !list.length) { consuming = false; return; }

            var ids = [];
            var targetId = '';
            list.forEach(function (record) {
                if (!record) return;
                if (record.id) ids.push(record.id);
                if (record.messageId) targetId = String(record.messageId);
            });

            var finish = function () {
                // 消息不在内存里（可能真的没落库/换会话了）：给个轻提示，然后照常 ack
                if (targetId && !hasMessage(targetId)) {
                    toast('收到一条新消息', 'info');
                }
                try {
                    if (ids.length) native.pushAckPending(JSON.stringify(ids));
                } catch (e) {}
                consuming = false;
            };

            // 内存里已有但可能还没写进 IndexedDB：先 flush 一次，确认后再 ack
            if (targetId && typeof window._flushSaveData === 'function') {
                window._flushSaveData().then(finish, finish);
            } else {
                finish();
            }
        });
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

    // core.js 在 loadData 完成时会调用它（冷启动时 onResume 的 evaluateJavascript 可能早于页面加载，收不到）
    window.__appleDataReady = function () {
        consumeJumpTarget();
        if (document.visibilityState === 'visible') window.__applePushOnForeground();
        else consumePending();
    };

    if (window.__APP_DATA_LOADED__) {
        setTimeout(window.__appleDataReady, 0);
    }

    // 告诉原生：JS 侧已经可以接 "__appleNotifyOpen" 了，把冷启动积压的点击推过来
    try {
        if (typeof native.pushClientReady === 'function') native.pushClientReady();
    } catch (e) {}

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
