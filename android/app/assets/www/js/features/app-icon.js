/**
 * app-icon.js — 自定义应用图标（钉一个换图标后的快捷方式到桌面）v1
 *
 * 原理：Android 8.0+ 的 ShortcutManager.requestPinShortcut()
 *  → 在桌面生成一个固定 id 的启动快捷方式（图标/名字由用户自选），
 *    原应用图标不受影响；重复添加会覆盖同一个，不会越钉越多。
 *
 * 流程：
 *  1. 「选图片」→ 隐藏 file input → 居中裁成正方形 192×192 + 圆角 → PNG dataURL
 *  2. 实时预览 + localforage 记住上次的选择（重启后预览还在）
 *  3. 「添加到桌面」→ window.MilkChat.pinAppShortcut(label, dataUrl)
 *     返回码：'ok' 已弹系统确认窗 / 'no_launcher' 桌面不支持 /
 *             'old_android' 系统 < 8.0 / 'error' 参数异常
 *  4. 非App环境（浏览器直接打开网页）→ 提示此功能需在 App 内使用
 */
(function () {
    'use strict';

    var STORE_KEY = 'app_icon_v1';   // { dataUrl, label }
    var ICON_SIZE = 192;             // 导出尺寸（px）
    var ICON_RADIUS = 42;            // 圆角半径（约为尺寸的 22%，视觉接近系统图标）

    // 当前选好的图标（没选过为 null）
    var _icon = null;

    // ── DOM ───────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }
    function preview() { return el('app-icon-preview'); }
    function pinBtn() { return el('app-icon-pin-btn'); }
    function labelInput() { return el('app-icon-label-input'); }
    function hint() { return el('app-icon-hint'); }

    function note(msg, type, ms) {
        if (typeof showNotification === 'function') showNotification(msg, type, ms || 2500);
    }

    // ── 图片 → 居中裁方 + 圆角 PNG dataURL ─────────────────
    // 不依赖 canvas.roundRect()（旧 WebView 没有），手画圆角路径
    function makeIcon(file) {
        return new Promise(function (resolve, reject) {
            if (!file || !/^image\//.test(file.type)) {
                reject(new Error('not_image')); return;
            }
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                try {
                    var S = ICON_SIZE, R = ICON_RADIUS;
                    var side = Math.min(img.naturalWidth, img.naturalHeight);
                    var sx = (img.naturalWidth - side) / 2;
                    var sy = (img.naturalHeight - side) / 2;
                    var c = document.createElement('canvas');
                    c.width = S; c.height = S;
                    var ctx = c.getContext('2d');
                    ctx.beginPath();
                    ctx.moveTo(R, 0);
                    ctx.arcTo(S, 0, S, S, R);
                    ctx.arcTo(S, S, 0, S, R);
                    ctx.arcTo(0, S, 0, 0, R);
                    ctx.arcTo(0, 0, S, 0, R);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
                    resolve(c.toDataURL('image/png'));
                } catch (e) {
                    reject(e);
                } finally {
                    URL.revokeObjectURL(url);
                }
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('load_fail')); };
            img.src = url;
        });
    }

    // ── 预览 & 持久化 ──────────────────────────────────────
    function renderPreview() {
        var p = preview();
        if (!p) return;
        if (_icon) {
            p.innerHTML = '';
            var im = document.createElement('img');
            im.src = _icon.dataUrl;
            im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            p.appendChild(im);
        } else {
            p.innerHTML = '<i class="fas fa-image" style="font-size:20px;color:var(--text-secondary,#bbb);"></i>';
        }
        var b = pinBtn();
        if (b) b.disabled = !_icon;
        var inp = labelInput();
        if (inp && _icon && _icon.label && inp.value !== _icon.label) inp.value = _icon.label;
    }

    function persist() {
        try { localforage.setItem(STORE_KEY, _icon); } catch (e) {}
    }

    // ── 选图入口（动态建 file input，不往 HTML 里塞节点）────
    function pickImage() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        input.onchange = function () {
            var f = input.files && input.files[0];
            if (f) {
                makeIcon(f).then(function (dataUrl) {
                    _icon = { dataUrl: dataUrl, label: (labelInput() && labelInput().value.trim()) || '' };
                    persist();
                    renderPreview();
                    note('图片已就绪，点「添加到桌面」就能换图标啦', 'success');
                }).catch(function () {
                    note('这张图读取失败了，换一张试试', 'error');
                });
            }
            input.remove && input.remove();
        };
        document.body.appendChild(input);
        input.click();
    }

    // ── 钉到桌面 ──────────────────────────────────────────
    function pinToLauncher() {
        if (!_icon) return;
        var label = (labelInput() && labelInput().value.trim()) || 'milk.chat';
        _icon.label = label;
        persist();

        // 非 App 环境：window.MilkChat 是 Android WebView 注入的原生桥
        if (!(window.MilkChat && typeof window.MilkChat.pinAppShortcut === 'function')) {
            note('此功能需要在 App 里使用哦', 'error', 3000);
            return;
        }
        var r;
        try {
            r = window.MilkChat.pinAppShortcut(label, _icon.dataUrl);
        } catch (e) {
            r = 'error';
        }
        if (r === 'ok') {
            note('已发起请求，看一下系统弹窗点「添加」就完成了', 'success', 3500);
        } else if (r === 'no_launcher') {
            note('当前桌面不支持钉图标，换系统桌面试试', 'error', 3500);
        } else if (r === 'old_android') {
            note('系统版本太低（需要 Android 8.0+），换不了图标', 'error', 3500);
        } else {
            note('添加失败了，重新选一次图试试', 'error', 3000);
        }
    }

    // ── 初始化 ────────────────────────────────────────────
    function bindOnce() {
        if (el('app-icon-card') && el('app-icon-card')._iconBound) return;
        var card = el('app-icon-card');
        if (!card) return;
        card._iconBound = true;

        var pick = el('app-icon-pick-btn');
        if (pick) pick.addEventListener('click', pickImage);
        var pin = pinBtn();
        if (pin) pin.addEventListener('click', pinToLauncher);
    }

    function init() {
        bindOnce();
        // 恢复上次的选择（仅预览；快捷方式在系统里，无需恢复）
        try {
            localforage.getItem(STORE_KEY).then(function (v) {
                if (v && v.dataUrl) { _icon = v; renderPreview(); }
            });
        } catch (e) {}
        renderPreview();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
