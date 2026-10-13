/*
 * milk.chat 原生桥接脚本
 * —— 由 App 在页面最前面注入；如果是在普通浏览器里打开本网页，这段脚本会自动失效。
 *
 * 做三件事：
 *   1. 接管 window.Notification：网页里原本的“浏览器通知”变成系统级通知
 *      （横幅 / 锁屏 / 通知栏 / 桌面角标）。
 *   2. 默认打开「消息通知」与「后台保活音频」两个开关，装完即可用。
 *   3. 回到前台清角标、跟随主题切换状态栏颜色。
 */
(function () {
    'use strict';

    var N = window.AndroidNative;
    if (!N) return;                              // 非 App 环境，直接跳过
    if (window.__MILK_NATIVE__) return;
    window.__MILK_NATIVE__ = true;

    /* ---------------- 1. 用原生通知接管 Web Notification ---------------- */
    function MilkNotification(title, options) {
        options = options || {};
        this.title = (title == null) ? '' : String(title);
        this.body = (options.body == null) ? '' : String(options.body);
        this.tag = (options.tag == null) ? '' : String(options.tag);
        this.icon = options.icon || '';
        this.data = options.data || null;
        this.onclick = null;
        this.onclose = null;
        this.onerror = null;
        this.onshow = null;
        try { N.notify(this.title || 'milk', this.body, this.tag); } catch (e) {}
        var self = this;
        setTimeout(function () {
            try { if (typeof self.onshow === 'function') self.onshow(); } catch (e) {}
        }, 0);
    }
    MilkNotification.permission = 'granted';
    MilkNotification.maxActions = 2;
    MilkNotification.requestPermission = function (cb) {
        try { N.requestNotificationPermission(); } catch (e) {}
        if (typeof cb === 'function') { try { cb('granted'); } catch (e) {} }
        return Promise.resolve('granted');
    };
    MilkNotification.prototype.close = function () {};
    MilkNotification.prototype.addEventListener = function (type, fn) {
        if (type && typeof fn === 'function') this['on' + type] = fn;
    };
    MilkNotification.prototype.removeEventListener = function () {};

    try {
        Object.defineProperty(window, 'Notification', {
            configurable: true, writable: true, value: MilkNotification
        });
    } catch (e) {
        try { window.Notification = MilkNotification; } catch (e2) {}
    }

    /* ---------------- 2. 默认开关 ---------------- */
    try {
        if (localStorage.getItem('notifEnabled') === null) {
            localStorage.setItem('notifEnabled', '1');
        }
        if (localStorage.getItem('keepaliveAudioEnabled') === null) {
            localStorage.setItem('keepaliveAudioEnabled', 'true');
        }
    } catch (e) {}

    /* ---------------- 3. 回到前台清角标 ---------------- */
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            try { N.clearBadge(); } catch (e) {}
        }
    });

    /* ---------------- 4. 状态栏跟随主题 ---------------- */
    function syncStatusBar() {
        try {
            var t = document.documentElement.getAttribute('data-theme');
            N.setStatusBarTheme(t === 'dark' ? 'dark' : 'light');
        } catch (e) {}
    }
    try {
        syncStatusBar();
        if (window.MutationObserver) {
            new MutationObserver(syncStatusBar).observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-theme']
            });
        }
    } catch (e) {}

    /* ---------------- 对外的小工具 ---------------- */
    window.__milkNative = {
        notify: function (t, b) { try { N.notify(t || 'milk', b || '', ''); } catch (e) {} },
        clearBadge: function () { try { N.clearBadge(); } catch (e) {} },
        platform: function () { try { return N.platform(); } catch (e) { return 'android'; } }
    };
})();