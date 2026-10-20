/* ────────────────────────────────────────────────────────────────
 * 动画开关 · 只想快点进去的人可以少看点过场
 *   - 进入动画：开屏那层「和你在一起的每一天」渐隐 + 白屏过渡
 *   - 进入家园动画：情侣空间整页从下往上滑进来的那一下
 *
 * 两个开关默认都是「开」（保持跟以前一模一样），关掉之后：
 *   - 进入动画关掉 → 开屏直接消失，不渐隐、不等那 250/1200ms
 *   - 家园动画关掉 → 点进去瞬间到位，不滑；退出来也是瞬间
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var KEY_ENTRY = 'skipEntryAnim';      // 'true' = 关掉开屏动画
    var KEY_HOME  = 'skipHomeEnterAnim';  // 'true' = 关掉家园进入动画
    var KEY_MOTION = 'reduceMotionAll';   // 'true' = 全站减少动画（消息入场、气泡、加载动效…全都关）

    function isOn(key) { return localStorage.getItem(key) === 'true'; }

    // 给 app.js / moments.js 用的查询接口
    window._skipEntryAnim = function () { return isOn(KEY_ENTRY); };
    window._skipHomeEnterAnim = function () { return isOn(KEY_HOME); };
    window._reduceMotionAll = function () { return isOn(KEY_MOTION); };

    // 全站动画由 <html> 上的一个 class 控制（CSS 见 styles.css 的 html.motion-off）
    function applyMotionClass() {
        try {
            document.documentElement.classList.toggle('motion-off', isOn(KEY_MOTION));
        } catch (e) {}
    }

    function syncUI() {
        var a = document.getElementById('entry-anim-toggle');
        if (a) a.classList.toggle('active', isOn(KEY_ENTRY));
        var b = document.getElementById('home-anim-toggle');
        if (b) b.classList.toggle('active', isOn(KEY_HOME));
        var c = document.getElementById('motion-off-toggle');
        if (c) c.classList.toggle('active', isOn(KEY_MOTION));
        applyMotionClass();
    }

    window._toggleEntryAnim = function () {
        localStorage.setItem(KEY_ENTRY, String(!isOn(KEY_ENTRY)));
        syncUI();
    };
    window._toggleHomeAnim = function () {
        localStorage.setItem(KEY_HOME, String(!isOn(KEY_HOME)));
        syncUI();
    };
    window._toggleMotionAll = function () {
        localStorage.setItem(KEY_MOTION, String(!isOn(KEY_MOTION)));
        syncUI();
    };

    // 尽快把 class 挂上，别等 DOMContentLoaded（不然首屏那一下动画已经跑完了）
    applyMotionClass();

    document.addEventListener('DOMContentLoaded', syncUI);
    setTimeout(syncUI, 500);
})();
