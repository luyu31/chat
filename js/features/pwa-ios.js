/* ────────────────────────────────────────────────────────────────
 * iOS / PWA 适配层
 *
 * 为什么需要这个文件：这个 App 原本是装在 Android 壳里跑的，
 * 到了 iPhone 上是"Safari + 添加到主屏幕"。iOS 有几处跟 Android 不一样，
 * 不处理会明显别扭：
 *
 *   1. 刘海 / 底部横条：页面会被挡住 → 补 safe-area 内边距（CSS 里配合）
 *   2. Safari 禁止无手势自动播放音频：语音条、通话播报、闹钟语音都哑掉
 *      → 在第一次触摸时"解锁"一次音频（静音播放一个空音频）
 *   3. 100vh 在 iOS 上算的是"含地址栏"的高度，底部会被截
 *      → 用 --vh 变量修正
 *   4. 下拉页面会出现橡皮筋回弹 → 关掉 body 的 overscroll
 *   5. file:// 下没有 Service Worker → 只在 http(s) 才注册
 *
 * 全部逻辑都做了环境判断：在 Android 壳里跑时不会生效，不干扰原有行为。
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isStandalone = (window.navigator.standalone === true) ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var inAndroidShell = !!window.MilkChat;   // 安卓壳里有这个桥，不重复做事

    window._isIOSWebApp = isIOS;
    window._isStandalone = isStandalone;

    // ─── 1. 高度修正：--vh ───
    function fixVh() {
        try {
            document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
        } catch (e) {}
    }
    fixVh();
    window.addEventListener('resize', fixVh);
    window.addEventListener('orientationchange', function () { setTimeout(fixVh, 250); });

    // ─── 2. 音频解锁（iOS 必须由用户手势触发一次） ───
    var unlocked = false;
    function unlockAudio() {
        if (unlocked) return;
        unlocked = true;
        try {
            // 空音频：只是让 WebKit 记住"这个页面获得过播放许可"
            var a = new Audio();
            a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
            a.volume = 0;
            var p = a.play();
            if (p && p.catch) p.catch(function () {});
        } catch (e) {}
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                if (!window.__iosAC) window.__iosAC = new AC();
                if (window.__iosAC.state === 'suspended') window.__iosAC.resume();
            }
        } catch (e) {}
        // 解锁完成就把监听撤掉，别一直挂着
        document.removeEventListener('touchstart', unlockAudio, true);
        document.removeEventListener('touchend', unlockAudio, true);
        document.removeEventListener('click', unlockAudio, true);
    }
    if (isIOS && !inAndroidShell) {
        document.addEventListener('touchstart', unlockAudio, true);
        document.addEventListener('touchend', unlockAudio, true);
        document.addEventListener('click', unlockAudio, true);
    }

    // ─── 3. 橡皮筋回弹 / 下拉刷新 ───
    if (isIOS && !inAndroidShell) {
        document.addEventListener('DOMContentLoaded', function () {
            var st = document.createElement('style');
            st.id = 'ios-pwa-fix';
            st.textContent = [
                /* 顶部/底部安全区：让头部和输入栏避开刘海与横条 */
                'body{padding-top:env(safe-area-inset-top,0);padding-bottom:env(safe-area-inset-bottom,0);}',
                /* 关掉整页回弹，但保留内部容器滚动 */
                'html,body{overscroll-behavior:none;-webkit-overflow-scrolling:touch;}',
                /* 输入框聚焦时 iOS 会放大字体，强制 16px 避免"跳一下" */
                'input,textarea,select{font-size:max(16px,1em);}',
                /* 用修好的高度替换 100vh */
                '.welcome-animation,.app-lock-overlay,#couple-space-page{min-height:calc(var(--vh,1vh) * 100);}'
            ].join('\n');
            document.head.appendChild(st);
        });
    }

    // ─── 4. Service Worker（只在 http/https 且非安卓壳时注册） ───
    if ('serviceWorker' in navigator && !inAndroidShell) {
        var proto = location.protocol;
        if (proto === 'http:' || proto === 'https:') {
            window.addEventListener('load', function () {
                navigator.serviceWorker.register('./sw.js').then(function (reg) {
                    console.log('[pwa] Service Worker 已注册，可离线打开 / 添加到主屏幕');
                    // 有新版就悄悄更新，下次打开生效
                    if (reg && reg.update) reg.update().catch(function () {});
                }).catch(function (e) {
                    console.warn('[pwa] Service Worker 注册失败（不影响使用）', e);
                });
            });
        }
    }

    // ─── 5. 独立模式下：横屏提示 / 状态栏适配 ───
    if (isStandalone) {
        document.addEventListener('DOMContentLoaded', function () {
            document.documentElement.classList.add('ios-standalone');
        });
    }

    // ─── 6. 双击缩放（iOS 独立模式仍会触发） ───
    if (isIOS && !inAndroidShell) {
        var lastTouch = 0;
        document.addEventListener('touchend', function (e) {
            var now = Date.now();
            if (now - lastTouch <= 300) { e.preventDefault(); }
            lastTouch = now;
        }, { passive: false });
    }
})();
