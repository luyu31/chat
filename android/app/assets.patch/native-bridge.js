/**
 * native-bridge.js — milk.chat App（WebView 容器）专用。
 * 把 Web Notification 桥接到系统通知：
 *   横幅通知（heads-up）+ 锁屏通知 + 通知栏通知 + 桌面角标。
 * 仅在 App 内生效（window.MilkChat 存在时），浏览器打开本页面无任何影响。
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.MilkChat) return;
    var Native = window.MilkChat;

    // 默认开启"后台消息提醒"（用户仍可在应用设置-通知开关里关闭）
    try {
        if (localStorage.getItem('notifEnabled') === null) {
            localStorage.setItem('notifEnabled', '1');
        }
    } catch (e) {}

    function MilkNotification(title, opts) {
        opts = opts || {};
        this.title = title == null ? '' : String(title);
        this.body = opts.body == null ? '' : String(opts.body);
        this.tag = opts.tag == null ? null : String(opts.tag);
        this.onclick = null;
        this.onclose = null;
        this.onerror = null;
        this.onshow = null;
        this.data = opts.data || null;
        this.lang = opts.lang || '';
        this.silent = !!opts.silent;
        try {
            Native.notify(this.title, this.body, this.tag);
            var self = this;
            setTimeout(function () { if (self.onshow) self.onshow(); }, 0);
        } catch (e) {
            if (this.onerror) setTimeout(this.onerror, 0);
        }
    }
    MilkNotification.prototype.close = function () {
        if (this.onclose) { var f = this.onclose; this.onclose = null; setTimeout(f, 0); }
    };
    try {
        Object.defineProperty(MilkNotification, 'permission', {
            get: function () {
                try { return Native.notifPermission() || 'granted'; } catch (e) { return 'granted'; }
            },
            configurable: true
        });
        MilkNotification.maxActions = 0;
    } catch (e) {}
    MilkNotification.requestPermission = function (cb) {
        return new Promise(function (resolve) {
            function finish(p) {
                try { if (typeof cb === 'function') cb(p); } catch (e) {}
                resolve(p);
            }
            var r;
            try { r = Native.requestNotifPermission(); } catch (e) { r = 'granted'; }
            if (r === 'granted') { finish('granted'); return; }
            if (r === 'denied') { finish('denied'); return; }
            var tries = 0;
            var timer = setInterval(function () {
                var p;
                try { p = Native.notifPermission(); } catch (e) { p = 'granted'; }
                tries++;
                if (p !== 'default' || tries > 50) {
                    clearInterval(timer);
                    finish(p === 'default' ? 'denied' : p);
                }
            }, 100);
        });
    };

    try {
        Object.defineProperty(window, 'Notification', {
            value: MilkNotification, configurable: true, writable: true
        });
    } catch (e) {
        window.Notification = MilkNotification;
    }

    // 主动控制桌面角标 / 通知
    window.MilkChatSetBadge = function (n) { try { Native.setBadge(n); } catch (e) {} };
    window.MilkChatClearBadge = function () { try { Native.clearBadge(); } catch (e) {} };
    window.MilkChatNotify = function (title, body, tag) {
        try { Native.notify(title == null ? 'milk.chat' : String(title), body == null ? '' : String(body), tag || null); } catch (e) {}
    };

    // ─── 全屏来电联动 ───
    // 全屏来电界面点"接听/拒绝"后，原生回到主界面并调用这个函数，
    // 触发应用内来电弹窗的对应逻辑，接管通话流程。
    // 注意：不依赖网页内来电弹窗是否可见——用户可能在原生全屏界面接听/拒绝时，
    // 网页弹窗已被 60s 超时收起，仍要确保动作能落到通话流程上。
    window._nativeCallAction = function (action) {
        try { Native.stopRinging(); } catch (e) {}
        var btnId = action === 'answer' ? 'call-inc-accept' : 'call-inc-reject';

        function dispatch() {
            var btn = document.getElementById(btnId);
            if (btn) { btn.click(); return true; }
            return false;
        }
        if (dispatch()) return;

        // call.js 还没注入按钮（极端冷启动）：等一下再试，最多 5 秒
        var tries = 0;
        var t = setInterval(function () {
            if (dispatch() || ++tries > 50) clearInterval(t);
        }, 100);
    };

    // 原生铃声选择结果回调（更新设置界面显示）
    window._onNativeRingtone = function (ok) {
        try {
            if (ok && Native.hasRingtone) {
                var n = Native.getRingtoneName() || '自选铃声';
                localStorage.setItem('milkNativeRingtone', n);
            }
            var nameEl = document.getElementById('native-ringtone-name');
            if (nameEl) {
                var cur = '';
                try { cur = Native.hasRingtone() ? (Native.getRingtoneName() || '自选铃声') : ''; } catch (e) {}
                nameEl.textContent = cur ? '当前：' + cur : '未设置（用内置铃声）';
            }
            if (ok && typeof window.toast === 'function') window.toast('来电铃声已设置 ✓');
        } catch (e) {}
    };

    // 在设置 → 音效设置的"视频通话邀请音效"下面注入"来电铃声"设置（仅 App 内）。
    // 来电震动开关统一用音效设置里的「来电震动」(#call-vibrate-toggle)，这里不再重复放一个，
    // 避免两个同名单开关互相打架（之前两个都写同一个设置，用户会误以为开关失灵）。
    function injectRingtoneSetting() {
        var anchor = document.getElementById('sound-invite-videocall-preset');
        if (!anchor) return;
        var block = anchor.closest('div');
        if (!block || !block.parentElement || document.getElementById('native-ringtone-row')) return;
        var cur = '';
        try { cur = Native.hasRingtone() ? (Native.getRingtoneName() || '自选铃声') : ''; } catch (e) {}

        // 实时读取来电震动开关（设置 → 音效 → 来电震动，默认开启）
        function vibrateOnNow() {
            try {
                if (typeof settings !== 'undefined' && settings.callVibrateEnabled !== undefined) {
                    return settings.callVibrateEnabled !== false;
                }
                var lsV = localStorage.getItem('milkCallVibrate');
                return lsV === null ? true : lsV !== '0';
            } catch (e) { return true; }
        }

        var row = document.createElement('div');
        row.id = 'native-ringtone-row';
        row.style.cssText = 'margin-top:8px;padding:10px 12px;border:1px dashed var(--border-color,#ddd);border-radius:10px;background:var(--primary-bg,transparent);';
        row.innerHTML =
            '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">' +
            '<i class="fas fa-phone-volume" style="margin-right:4px;color:var(--accent-color,#c5a47e);"></i>' +
            '来电铃声（来电时播放）</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;" id="native-ringtone-name">' +
            (cur ? '当前：' + cur : '未设置（用内置铃声）') + '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button type="button" id="native-ringtone-pick" style="flex:1;padding:7px 10px;border:none;border-radius:8px;font-size:12px;cursor:pointer;background:var(--accent-color,#c5a47e);color:#fff;">选择铃声</button>' +
            '<button type="button" id="native-ringtone-file" style="padding:7px 10px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;cursor:pointer;background:var(--primary-bg,transparent);color:var(--text-primary);">从文件选</button>' +
            '<button type="button" id="native-ringtone-test" style="padding:7px 10px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;cursor:pointer;background:var(--primary-bg,transparent);color:var(--text-primary);">试听(铃+震)</button>' +
            '<button type="button" id="native-vibrate-test" style="padding:7px 10px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;cursor:pointer;background:var(--primary-bg,transparent);color:var(--text-primary);">震动测试</button>' +
            '<button type="button" id="native-ringtone-reset" style="padding:7px 10px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;cursor:pointer;background:var(--primary-bg,transparent);color:var(--text-primary);">恢复默认</button>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;line-height:1.6;">' +
            '「试听」播放铃声并震动 3 秒；「震动测试」震动约 2 秒，方便单独确认震动是否生效。' +
            '来电是否震动，由下方「来电震动」开关控制。' +
            '</div>';
        block.parentElement.insertBefore(row, block.nextSibling);
        row.querySelector('#native-ringtone-pick').onclick = function () {
            try { Native.pickRingtone(); } catch (e) {}
        };
        row.querySelector('#native-ringtone-file').onclick = function () {
            try { Native.pickRingtoneFile ? Native.pickRingtoneFile() : Native.pickRingtone(); } catch (e) {}
        };
        row.querySelector('#native-ringtone-test').onclick = function () {
            try { Native.previewRingtone(vibrateOnNow()); } catch (e) {}
        };
        row.querySelector('#native-vibrate-test').onclick = function () {
            try { Native.vibrateTest(); } catch (e) {
                try { Native.toast('震动测试失败，请重试'); } catch (e2) {}
            }
        };
        row.querySelector('#native-ringtone-reset').onclick = function () {
            try {
                Native.clearRingtone();
                localStorage.removeItem('milkNativeRingtone');
                var el = document.getElementById('native-ringtone-name');
                if (el) el.textContent = '未设置（用内置铃声）';
            } catch (e) {}
        };
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(injectRingtoneSetting, 800); });
    } else {
        setTimeout(injectRingtoneSetting, 800);
    }

    // ─── 备份/歌单导出：拦截 <a download href="blob:/data:"> 下载，转交原生保存到用户选择的位置 ───
    if (typeof Native.saveFile === 'function') {
        document.addEventListener('click', function (ev) {
            try {
                var t = ev.target;
                if (!t || typeof t.closest !== 'function') return;
                var a = t.closest('a[href]');
                if (!a) return;
                var href = a.getAttribute('href') || '';
                if (!/^(blob:|data:)/i.test(href)) return;
                if (!a.hasAttribute('download') && !/^data:.*download/i.test(href)) return;
                ev.preventDefault();
                ev.stopPropagation();
                var name = a.getAttribute('download') || 'milk.chat-export';
                fetch(href).then(function (r) { return r.blob(); }).then(function (b) {
                    var fr = new FileReader();
                    fr.onload = function () {
                        var base64 = String(fr.result).split(',')[1] || '';
                        Native.saveFile(name, base64);
                    };
                    fr.onerror = function () { try { Native.toast('导出失败，请重试'); } catch (e) {} };
                    fr.readAsDataURL(b);
                }).catch(function () {
                    try { Native.toast('导出失败，请重试'); } catch (e) {}
                });
            } catch (e) {}
        }, true);
    }
})();
