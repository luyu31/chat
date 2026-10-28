/* ============================================================
   更多菜单（输入区 "..." 按钮）框架 v3
   - 微信同款交互：点"..."在输入框下方展开一整块网格面板（不是浮层），
     推开聊天区域，不盖在消息上面
   - 已实现的功能项：直接执行 action
   - 未开发的功能项：统一走 showNotification 弹"开发中"提示
   ============================================================ */

(function () {
    // 图标里 emoji 优先于 iconClass（emoji 更容易一眼分辨）；
    // iconClass 支持传完整的 class 字符串（包括 fab 品牌图标）
    // 顺序：图片 / 让ta主动 / 批量发送。红包已移到「高级功能」，搞怪功能已删除。
    // 面板本身按这个数组自动渲染，加/删条目会自动跟着调整布局。
    const MORE_MENU_ITEMS = [
        {
            id: 'image',
            iconClass: 'fas fa-image',
            label: '图片',
            ready: true,
            action: function () {
                const input = document.getElementById('image-input');
                if (input) input.click();
            }
        },
        {
            id: 'continue',
            // 头像居中 + 右上角带三个点的对话气泡，代表"让ta主动说句话"。
            // 用 svgIcon 而不是 iconClass，因为这是设计好的复合图标，不是字体库里现成的单个符号
            svgIcon: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:28px;height:28px;" fill="none">' +
                '<circle cx="12" cy="10" r="4.3" fill="currentColor"/>' +
                '<path d="M5.7 21.5c0-4.7 3-7.4 6.3-7.4s6.3 2.7 6.3 7.4" fill="currentColor"/>' +
                '<rect x="15.8" y="0.8" width="7.1" height="5.3" rx="2.65" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
                '<path d="M17.8 6.0 17.0 7.3 18.7 6.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
                '<circle cx="17.9" cy="3.45" r="0.65" fill="currentColor"/>' +
                '<circle cx="19.35" cy="3.45" r="0.65" fill="currentColor"/>' +
                '<circle cx="20.8" cy="3.45" r="0.65" fill="currentColor"/>' +
                '</svg>',
            label: '让ta主动',
            ready: true,
            action: function () {
                if (typeof simulateReply === 'function') simulateReply();
            }
        },
        {
            id: 'batch',
            iconClass: 'fas fa-layer-group',
            label: '批量发送',
            ready: true,
            action: function () {
                if (typeof toggleBatchMode === 'function') toggleBatchMode();
            }
        }
    ];

    function getPanel() { return document.getElementById('more-menu-panel'); }
    function getPlusBtn() { return document.getElementById('more-menu-btn'); }
    function getInput() { return document.getElementById('message-input'); }

    // 不要任何展开/收起动效——切换要立刻到位，所以这里不再用 setTimeout 延迟隐藏
    // 等过渡播完（那是配合 CSS max-height transition 写的，现在 CSS 那条 transition 已经删了）
    function closeMoreMenu() {
        const panel = getPanel(), btn = getPlusBtn();
        if (panel) {
            panel.classList.remove('active');
            panel.style.display = 'none';
        }
        if (btn) btn.classList.remove('active');
    }

    function openMoreMenu() {
        const panel = getPanel(), btn = getPlusBtn();
        if (!panel || !btn) return;
        // 跟输入区其它弹层（表情/拍一拍、收纳面板）互斥，避免叠在一起
        try {
            document.getElementById('user-sticker-picker')?.classList.remove('active');
            const extrasPanel = document.getElementById('collapsed-extras-panel');
            if (extrasPanel) extrasPanel.style.display = 'none';
            document.getElementById('collapse-expand-btn')?.classList.remove('open');
        } catch (e) {}
        // 跟微信一样：展开面板前先收起软键盘，把屏幕空间让给图标网格
        const input = getInput();
        if (input) input.blur();
        panel.style.display = 'block';
        panel.classList.add('active');
        btn.classList.add('active');
    }

    function toggleMoreMenu() {
        const panel = getPanel();
        if (panel && panel.classList.contains('active')) closeMoreMenu();
        else openMoreMenu();
    }

    function renderMoreMenu() {
        const panel = getPanel();
        if (!panel) return;
        const gridHTML = MORE_MENU_ITEMS.map(function (item) {
            const iconHTML = item.svgIcon
                ? item.svgIcon
                : (item.emoji
                    ? '<span class="more-menu-emoji">' + item.emoji + '</span>'
                    : '<i class="' + item.iconClass + '"></i>');
            return (
                '<button class="more-menu-item' + (item.ready ? '' : ' disabled') + '" data-id="' + item.id + '" title="' + item.label + '">' +
                '<span class="more-menu-icon">' + iconHTML + '</span>' +
                '<span class="more-menu-label">' + item.label + '</span>' +
                '</button>'
            );
        }).join('');
        panel.innerHTML = '<div class="more-menu-grid">' + gridHTML + '</div>';

        panel.querySelectorAll('.more-menu-item').forEach(function (btnEl) {
            btnEl.addEventListener('click', function () {
                const item = MORE_MENU_ITEMS.find(function (i) { return i.id === btnEl.dataset.id; });
                if (!item) { closeMoreMenu(); return; }
                if (item.ready && typeof item.action === 'function') {
                    // "图片"是特殊情况：面板不能在这里就收起，要等用户真的选完图、
                    // 触发发送之后才收（见下面 DOMContentLoaded 里挂在 #image-input 上的 change 监听）
                    if (item.id !== 'image') closeMoreMenu();
                    item.action();
                } else {
                    closeMoreMenu();
                    if (typeof showNotification === 'function') {
                        showNotification('「' + item.label + '」功能开发中，敬请期待～', 'info', 2200);
                    }
                }
            });
        });
    }

    // 供后续开发把占位项升级为真实功能，不用改这个文件的面板/切换逻辑
    function registerItem(id, patch) {
        const item = MORE_MENU_ITEMS.find(function (i) { return i.id === id; });
        if (!item) return;
        Object.assign(item, patch);
        renderMoreMenu();
    }

    document.addEventListener('DOMContentLoaded', function () {
        renderMoreMenu();

        const plusBtn = getPlusBtn();
        if (plusBtn) {
            plusBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleMoreMenu();
            });
        }

        const input = getInput();
        if (input) {
            // 聚焦输入框时（唤起软键盘）收起"更多"面板，避免面板和键盘抢屏幕
            input.addEventListener('focus', closeMoreMenu);
        }


        // 点击面板/输入区以外的地方自动收起
        document.addEventListener('click', function (e) {
            const panel = getPanel(), btn2 = getPlusBtn();
            if (!panel || !panel.classList.contains('active')) return;
            if (panel.contains(e.target) || (btn2 && btn2.contains(e.target))) return;
            // "图片"项点击后会用 input.click() 模拟点开系统相册，这个模拟点击本身
            // 也会冒泡到 document 被这里的"点外部"逻辑抓到，导致相册还没弹出面板就先收起了——
            // #image-input 不算"外部"，直接放过
            if (e.target.id === 'image-input') return;
            closeMoreMenu();
        });

        // 图片：真正选完图（触发发送）之后再收起面板，不是点"图片"按钮那一下就收
        const imageInput = document.getElementById('image-input');
        if (imageInput) {
            imageInput.addEventListener('change', function () {
                if (imageInput.files && imageInput.files[0]) closeMoreMenu();
            });
        }
    });

    window.MoreMenu = {
        open: openMoreMenu,
        close: closeMoreMenu,
        toggle: toggleMoreMenu,
        registerItem: registerItem
    };
})();
