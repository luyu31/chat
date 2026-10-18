/**
 * auto-msg.js — 后台主动消息
 *
 * 目标：**把 App 从后台划掉之后，他还能给你发消息。**
 *
 * 原理：App 被划掉后 WebView 连同 JS 一起没了，网页里任何定时器都不再跑。
 * 所以这里只负责"把字卡池和间隔同步给原生"，真正发消息的是原生
 * （AutoMsgScheduler + AutoMsgReceiver），完全不依赖 WebView —— 只要进程能被
 * 闹钟唤醒（划掉后台不影响），消息就照发。
 *
 * 注意：如果在系统设置里对 App 点过「强行停止」，Android 会冻结该应用的全部闹钟与广播，
 * 直到你再次手动打开 App —— 这是系统限制，任何第三方应用都绕不过。
 */
(function () {
    'use strict';

    var KEY_ON  = 'bgAutoMsgEnabled';   // 开关
    var KEY_GAP = 'bgAutoMsgGapIdx';    // 间隔档位
    var MAX_TEXTS = 80;                 // 同步给原生最多这么多条（别把整个库塞过去）
    var RE_SYNC_MS = 10 * 60 * 1000;    // 每 10 分钟重新同步一次（字卡库改了能跟上）

    var GAPS = [
        { label: '30 分钟 ~ 2 小时', min: 30,  max: 120 },
        { label: '1 ~ 3 小时',       min: 60,  max: 180 },
        { label: '2 ~ 6 小时',       min: 120, max: 360 }
    ];

    function isOn() { return localStorage.getItem(KEY_ON) === 'true'; }
    function setOn(v) { try { localStorage.setItem(KEY_ON, v ? 'true' : 'false'); } catch (e) {} }
    function gapIdx() {
        var v = parseInt(localStorage.getItem(KEY_GAP) || '0', 10);
        return (v >= 0 && v < GAPS.length) ? v : 0;
    }
    function setGapIdx(v) { try { localStorage.setItem(KEY_GAP, String(v)); } catch (e) {} }

    function hasNative() {
        return !!(window.MilkChat && typeof window.MilkChat.syncAutoMsg === 'function');
    }

    // 从字卡池里随机抽最多 MAX_TEXTS 条（去重）
    function collectTexts() {
        var pool = window._customReplies
            || (typeof window.customReplies !== 'undefined' ? window.customReplies : null)
            || [];
        var arr = [];
        for (var i = 0; i < pool.length; i++) {
            var t = pool[i];
            if (typeof t === 'string' && t.trim()) arr.push(t.trim());
        }
        var seen = {}, out = [];
        var guard = 0;
        while (out.length < MAX_TEXTS && arr.length && guard++ < MAX_TEXTS * 8) {
            var t2 = arr[Math.floor(Math.random() * arr.length)];
            if (seen[t2]) continue;
            seen[t2] = 1;
            out.push(t2);
        }
        return out;
    }

    function sync() {
        try {
            if (!hasNative()) return;
            var g = GAPS[gapIdx()];
            window.MilkChat.syncAutoMsg(JSON.stringify({
                enabled: isOn(),
                partnerName: (typeof settings !== 'undefined' && settings.partnerName) || '对方',
                minGapMin: g.min,
                maxGapMin: g.max,
                texts: isOn() ? collectTexts() : []
            }));
        } catch (e) { console.warn('[auto-msg] sync 失败', e); }
    }

    // 原生后台消息送达：在聊天流里补一条（App 开着时能连上上下文）
    window._onNativeAutoMsg = function (text) {
        try {
            if (!text || typeof addMessage !== 'function') return;
            addMessage({
                id: Date.now() + Math.floor(Math.random() * 1000),
                sender: (typeof settings !== 'undefined' && settings.partnerName) || '对方',
                text: String(text),
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal',
                nativeAuto: true
            });
            try { if (typeof playSound === 'function') playSound('message'); } catch (e) {}
        } catch (e) { console.warn('[auto-msg] 补消息失败', e); }
    };

    // ─── 设置界面：注入到「设置 → 聊天设置 → 节奏 → 主动发送」里 ───
    function injectUI() {
        var anchor = document.getElementById('auto-send-toggle');
        if (!anchor || document.getElementById('bg-auto-msg-toggle')) return;
        var card = anchor.closest('.cs-card') || anchor.parentNode;

        var wrap = document.createElement('div');
        wrap.id = 'bg-auto-msg-wrap';
        wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-color,#e8e8e8);';
        wrap.innerHTML =
            '<div class="setting-pill-row" id="bg-auto-msg-toggle">' +
                '<span class="setting-pill-icon"><i class="fas fa-moon"></i></span>' +
                '<span class="setting-pill-label">后台也发消息 <span style="font-size:11px;color:var(--text-secondary);font-weight:400;">把 App 从后台划掉后他照样发</span></span>' +
                '<div class="setting-pill-switch"><div class="setting-pill-knob"></div></div>' +
            '</div>' +
            '<div id="bg-auto-msg-rows" style="margin-top:8px;display:none;">' +
                '<div style="font-size:11px;color:var(--text-secondary,#999);margin-bottom:6px;">多久来一条</div>' +
                '<select id="bg-auto-msg-gap" style="width:100%;padding:7px 10px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;background:var(--primary-bg,transparent);color:var(--text-primary,#333);outline:none;font-family:var(--font-family,inherit);">' +
                    GAPS.map(function (g, i) { return '<option value="' + i + '">' + g.label + '</option>'; }).join('') +
                '</select>' +
                '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:6px;line-height:1.6;">' +
                    '内容从你的<b>字卡回复库</b>里随机抽；0:00–7:00 不会打扰你。' +
                    '<br>（若在系统设置里对 App 点过「强行停止」，系统会冻结消息，重新打开一次 App 即可恢复）' +
                '</div>' +
            '</div>';
        card.appendChild(wrap);

        var toggle = wrap.querySelector('#bg-auto-msg-toggle');
        var rows = wrap.querySelector('#bg-auto-msg-rows');
        var sel = wrap.querySelector('#bg-auto-msg-gap');

        function render() {
            var on = isOn();
            toggle.classList.toggle('active', on);
            rows.style.display = on ? 'block' : 'none';
            sel.value = String(gapIdx());
        }
        toggle.addEventListener('click', function () {
            if (!hasNative()) {
                if (typeof showNotification === 'function')
                    showNotification('「后台也发消息」只在装成 App 后可用', 'info', 2600);
                return;
            }
            setOn(!isOn());
            sync();
            render();
            if (typeof showNotification === 'function') {
                showNotification(isOn() ? '已开启：划掉后台也会来消息' : '已关闭后台主动消息', 'success', 2000);
            }
        });
        sel.addEventListener('change', function () {
            setGapIdx(parseInt(this.value, 10) || 0);
            sync();
            if (typeof showNotification === 'function') showNotification('间隔已更新', 'success', 1600);
        });

        // 打开设置面板时刷新一次状态
        var settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn && !settingsBtn._bgAutoMsgBound) {
            settingsBtn._bgAutoMsgBound = true;
            settingsBtn.addEventListener('click', function () { setTimeout(render, 80); });
        }
        render();
    }

    function init() {
        setTimeout(injectUI, 900);
        // 等聊天数据（字卡库）加载完再首次同步
        setTimeout(sync, 2500);
        setInterval(sync, RE_SYNC_MS);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) sync();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.bgAutoMsg = { sync: sync, isOn: isOn, _collectTexts: collectTexts };
})();
