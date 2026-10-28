/* ============================================================
   夏日白昼 · 可选主题开关
   - 默认关闭：<html> 上没有 data-skin，localStorage 也不会被写脏
   - 开启：加 data-skin="summer"，启用 css/summer-theme.css，
     并在 <html> 上内联覆盖主题变量（优先级高于自定义主题编辑器写入的变量）
   - 关闭：按开启前的快照精确还原内联变量、移除 data-skin、禁用样式表，
     明暗模式回到系统设置，不残留任何 class / 属性 / 内联样式
   ============================================================ */

(function () {
    const KEY_ON = 'summerDaylight';
    const KEY_DARK = 'summerDark';

    // 只接管这一个主题需要的变量；快照 / 还原都以这份清单为准，
    // 不会影响用户在主题编辑器里设置的其他变量
    const THEME_VARS = [
        '--primary-bg', '--secondary-bg', '--header-bg', '--input-area-bg',
        '--text-primary', '--text-secondary', '--border-color',
        '--message-sent-bg', '--message-sent-text',
        '--message-received-bg', '--message-received-text',
        '--accent-color', '--accent-color-dark', '--accent-color-rgb',
        '--accent-color-2', '--accent-color-2-rgb',
        '--favorite-color', '--toolbar-btn-bg', '--toolbar-btn-color',
        '--send-btn-bg', '--primary-bg-rgb', '--secondary-bg-rgb',
        '--timestamp-color', '--shadow'
    ];

    const LIGHT = {
        '--primary-bg': '#F7FAF5',
        '--secondary-bg': '#FFFFFF',
        '--header-bg': '#FFFFFF',
        '--input-area-bg': '#FFFFFF',
        '--text-primary': '#2F3E2E',
        '--text-secondary': '#6B7A6A',
        '--border-color': '#E3EBE0',
        '--message-sent-bg': '#EAF4E4',
        '--message-sent-text': '#2F3E2E',
        '--message-received-bg': '#FFFFFF',
        '--message-received-text': '#2F3E2E',
        '--accent-color': '#7FB069',
        '--accent-color-dark': '#6FA05B',
        '--accent-color-rgb': '127, 176, 105',
        '--accent-color-2': '#F2C14E',
        '--accent-color-2-rgb': '242, 193, 78',
        '--favorite-color': '#F2C14E',
        '--toolbar-btn-bg': '#EEF6EA',
        '--toolbar-btn-color': '#4E7A45',
        '--send-btn-bg': '#7FB069',
        '--primary-bg-rgb': '247, 250, 245',
        '--secondary-bg-rgb': '255, 255, 255',
        '--timestamp-color': '#6B7A6A',
        '--shadow': '0 4px 16px rgba(127, 176, 105, 0.10)'
    };

    const DARK = {
        '--primary-bg': '#1E2A1D',
        '--secondary-bg': '#273526',
        '--header-bg': '#273526',
        '--input-area-bg': '#273526',
        '--text-primary': '#E8F0E4',
        '--text-secondary': '#A9BBA5',
        '--border-color': '#3A4A37',
        '--message-sent-bg': '#35502F',
        '--message-sent-text': '#EAF4E4',
        '--message-received-bg': '#273526',
        '--message-received-text': '#E8F0E4',
        '--accent-color': '#9BC98A',
        '--accent-color-dark': '#7FB069',
        '--accent-color-rgb': '155, 201, 138',
        '--accent-color-2': '#F2C14E',
        '--accent-color-2-rgb': '242, 193, 78',
        '--favorite-color': '#F2C14E',
        '--toolbar-btn-bg': '#2E3F2B',
        '--toolbar-btn-color': '#C9E4BC',
        '--send-btn-bg': '#9BC98A',
        '--primary-bg-rgb': '30, 42, 29',
        '--secondary-bg-rgb': '39, 53, 38',
        '--timestamp-color': '#A9BBA5',
        '--shadow': '0 4px 16px rgba(0, 0, 0, 0.35)'
    };

    const root = document.documentElement;
    let enabled = false;
    let snapshot = null;   // { var: { v, p } | null }

    const isDark = () => localStorage.getItem(KEY_DARK) === '1';
    const getCssLink = () => document.getElementById('summer-skin-css');

    function applyVars(map) {
        Object.keys(map).forEach(function (k) {
            root.style.setProperty(k, map[k]);
        });
    }

    function snapshotVars() {
        const snap = {};
        THEME_VARS.forEach(function (k) {
            const value = root.style.getPropertyValue(k);
            snap[k] = value ? { v: value, p: root.style.getPropertyPriority(k) } : null;
        });
        return snap;
    }

    function restoreVars(snap) {
        THEME_VARS.forEach(function (k) {
            const item = snap && snap[k];
            if (!item) root.style.removeProperty(k);
            else root.style.setProperty(k, item.v, item.p);
        });
    }

    // 重新套一遍变量和明暗；updateUI / 自定义主题写入变量后会调用它
    function refresh() {
        if (!enabled) return;
        applyVars(isDark() ? DARK : LIGHT);
        root.setAttribute('data-theme', isDark() ? 'dark' : 'light');
        const darkToggle = document.getElementById('summer-dark-toggle');
        if (darkToggle) darkToggle.checked = isDark();
    }

    function enable(remember) {
        if (enabled) return;
        enabled = true;
        snapshot = snapshotVars();
        root.setAttribute('data-skin', 'summer');
        const link = getCssLink();
        if (link) link.disabled = false;
        // 默认是浅色；若上次开过深色子开关，沿用
        refresh();
        if (remember !== false) localStorage.setItem(KEY_ON, '1');
        const toggle = document.getElementById('summer-theme-toggle');
        if (toggle) toggle.checked = true;
        const row = document.getElementById('summer-dark-row');
        if (row) row.style.display = 'flex';
    }

    function disable() {
        if (!enabled) return;
        enabled = false;
        restoreVars(snapshot);
        snapshot = null;
        root.removeAttribute('data-skin');
        const link = getCssLink();
        if (link) link.disabled = true;
        // 启动时主题就已开启的场景，上面的快照可能是空的；
        // 这里把用户在主题编辑器里保存的自定义变量补回去，保证关闭后仍是原来的主题
        try {
            if (typeof settings !== 'undefined' && settings.customThemeColors) {
                Object.keys(settings.customThemeColors).forEach(function (k) {
                    root.style.setProperty(k, settings.customThemeColors[k]);
                });
            }
        } catch (e) {}
        // 明暗回到系统设置
        root.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        localStorage.setItem(KEY_ON, '0');
        localStorage.removeItem(KEY_DARK);
        const toggle = document.getElementById('summer-theme-toggle');
        if (toggle) toggle.checked = false;
        const darkToggle = document.getElementById('summer-dark-toggle');
        if (darkToggle) darkToggle.checked = false;
        const row = document.getElementById('summer-dark-row');
        if (row) row.style.display = 'none';
    }

    function setDark(on) {
        localStorage.setItem(KEY_DARK, on ? '1' : '0');
        refresh();
    }

    window.SummerTheme = {
        isEnabled: function () { return enabled; },
        enable: enable,
        disable: disable,
        refresh: refresh,
        toggle: function (on) { on ? enable(true) : disable(); }
    };

    // 启动：只有存过 "1" 才启用；否则什么都不做，保持原样
    if (localStorage.getItem(KEY_ON) === '1') enable(true);

    function bindUI() {
        const toggle = document.getElementById('summer-theme-toggle');
        if (toggle) {
            toggle.checked = enabled;
            toggle.addEventListener('change', function () {
                if (toggle.checked) enable(true);
                else disable();
            });
        }

        const darkToggle = document.getElementById('summer-dark-toggle');
        if (darkToggle) {
            darkToggle.checked = enabled && isDark();
            darkToggle.addEventListener('change', function () {
                if (!enabled) return;
                setDark(darkToggle.checked);
            });
        }

        const row = document.getElementById('summer-dark-row');
        if (row) row.style.display = enabled ? 'flex' : 'none';
    }

    // 多标签页同步：别处改了开关，这里跟着变
    window.addEventListener('storage', function (e) {
        if (e.key === KEY_ON) {
            if (e.newValue === '1' && !enabled) enable(false);
            else if (e.newValue !== '1' && enabled) disable();
        } else if (e.key === KEY_DARK && enabled) {
            refresh();
        }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUI);
    else bindUI();
})();
