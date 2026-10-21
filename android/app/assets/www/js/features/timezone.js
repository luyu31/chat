/**
 * timezone.js — 时差显示
 *
 * 在聊天页顶部梦角的在线状态区注入一个时差小胶囊，显示梦角当前时间。
 * 梦角时间 = 本地时间 + offsetHours（-12 ~ +14，0.5 步进），每天自然刷新日期。
 * 纯本地展示，不联网、不影响任何功能。
 *
 * 存储：localStorage key 'timezoneData'（跟 checkin.js 一致的 load/save 模式）
 */
(function () {
    'use strict';

    var KEY = 'timezoneData';
    var MIN_OFFSET = -12;
    var MAX_OFFSET = 14;
    var TICK_MS = 60000;

    var _tick = null;

    // ── 数据读写（照抄 control.js 的 load/save） ──────────────────────
    function _defaultData() {
        return { enabled: true, mode: 'same', offsetHours: 0 };
    }

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return _defaultData();
            var d = JSON.parse(raw);
            // 补齐字段 + 校验偏移范围（老数据兼容）
            if (typeof d.enabled !== 'boolean') d.enabled = true;
            if (typeof d.offsetHours !== 'number') d.offsetHours = 0;
            // 老版本数据迁移：没有 mode 字段的，按偏移是否为 0 猜一个
            if (d.mode !== 'same' && d.mode !== 'random') d.mode = d.offsetHours ? 'random' : 'same';
            d.offsetHours = _clampOffset(d.offsetHours);
            return d;
        } catch (e) {
            return _defaultData();
        }
    }

    function _saveData(d) {
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }

    // ── 把偏移规整到 0.5 步进并夹在 [-12, 14] ──────────────────────
    function _clampOffset(o) {
        var snapped = Math.round(o * 2) / 2;
        if (snapped < MIN_OFFSET) snapped = MIN_OFFSET;
        if (snapped > MAX_OFFSET) snapped = MAX_OFFSET;
        return snapped;
    }

    function _pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    // ── 时间格式 HH:MM（24 小时制） ──────────────────────
    function _fmtTime(date) {
        return _pad(date.getHours()) + ':' + _pad(date.getMinutes());
    }

    // ── 日期格式 MM/DD ──────────────────────
    function _fmtDate(date) {
        return _pad(date.getMonth() + 1) + '/' + _pad(date.getDate());
    }

    // ── 随机时区：从 [-12..-1] + [1..14] 里随机抽一个（0 = 同时区，属于模式一，不参与随机） ──────────────────────
    function _rollRandomOffset() {
        var candidates = [];
        for (var h = MIN_OFFSET; h <= MAX_OFFSET; h++) { if (h !== 0) candidates.push(h); }
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // ── 梦角时间 = 本地时间 + offsetHours（same 模式恒为 0） ──────────────────────
    function getPartnerTime() {
        var d = load();
        var offset = d.mode === 'random' ? d.offsetHours : 0;
        return new Date(Date.now() + offset * 3600000);
    }

    // ── 当前生效的偏移（给胶囊显示用） ──────────────────────
    function _effectiveOffset() {
        var d = load();
        return d.mode === 'random' ? d.offsetHours : 0;
    }

    function isEnabled() {
        return load().enabled;
    }

    // ── 偏移紧凑文案：+8h / -3.5h / 同时区 ──────────────────────
    function _fmtOffsetCompact(o) {
        if (!o) return '同时区';
        var sign = o > 0 ? '+' : '-';
        var abs = Math.abs(o);
        var h = Math.floor(abs);
        var m = Math.round((abs - h) * 60);
        var s = sign + h;
        if (m) s += '.5'; // 只有 0.5 步进，m 非 0 即 30 分
        return s + 'h';
    }

    // ── 偏移说明文案：梦角比你快 8 小时 / 慢 3 小时 30 分 ──────────────────────
    function _fmtOffsetDesc(o) {
        if (!o) return '梦角和你同时区';
        var abs = Math.abs(o);
        var h = Math.floor(abs);
        var m = Math.round((abs - h) * 60);
        var part = '';
        if (h) part += h + ' 小时';
        if (m) part += (part ? ' ' : '') + m + ' 分';
        if (!part) part = '0 小时';
        return o > 0 ? '梦角比你快 ' + part : '梦角比你慢 ' + part;
    }

    // ── 胶囊注入：已停用 ──────────────────────
    // 聊天头部不再显示他的时间/时差（太挤了），时间统一放到"家园"的头像区下面；
    // 这里保留函数只为兼容旧调用，顺手把历史上可能残留的胶囊清掉。
    function _ensureBadge() {
        var exist = document.getElementById('tz-badge');
        if (exist && exist.parentNode) exist.parentNode.removeChild(exist);
        return null;
    }

    function _updateBadge() {
        var badge = _ensureBadge();
        if (!badge) return;
        var d = load();
        if (!d.enabled) {
            badge.style.display = 'none';
            return;
        }
        var name = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        var pt = getPartnerTime();
        var offset = _effectiveOffset();
        badge.style.display = 'inline-flex';
        badge.innerHTML = '<i class="fas fa-clock" style="font-size:9px;"></i>'
            + name + ' · ' + _fmtTime(pt)
            + '<span style="opacity:.75;">（' + _fmtOffsetCompact(offset) + '）</span>';
    }

    // ── 每 60 秒刷新胶囊（只在 enabled 时更新） ──────────────────────
    function _ensureTick() {
        var d = load();
        if (d.enabled && !_tick) {
            _tick = setInterval(function () {
                if (isEnabled()) _updateBadge();
            }, TICK_MS);
        } else if (!d.enabled && _tick) {
            clearInterval(_tick);
            _tick = null;
        }
    }

    function toggle() {
        var d = load();
        d.enabled = !d.enabled;
        _saveData(d);
        _updateBadge();
        _ensureTick();
        return d.enabled;
    }

    // ── 设置弹窗（照抄 checkin.js 的 buildModal 模式） ──────────────────────
    function buildModal() {
        if (document.getElementById('timezone-modal')) return;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'timezone-modal';
        m.style.zIndex = '3300';
        m.innerHTML =
        '<div class="modal-content" style="max-width:420px;width:90vw;">'
        +   '<div class="modal-title">'
        +     '<i class="fas fa-clock"></i><span>时差显示</span>'
        +   '</div>'
        +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
        +     '<span style="font-size:13px;color:var(--text-primary,#333);">开启双方时间显示</span>'
        +     '<button type="button" id="tz-toggle-btn" style="padding:6px 14px;border:none;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;"></button>'
        +   '</div>'
        +   '<div>'
        +     '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin-bottom:6px;">他的时区（二选一）</div>'
        +     '<div style="display:flex;gap:8px;">'
        +       '<button type="button" id="tz-mode-same" style="flex:1;padding:10px 0;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;">'
        +         '<i class="fas fa-handshake" style="margin-right:5px;font-size:11px;"></i>和我时间一样'
        +       '</button>'
        +       '<button type="button" id="tz-mode-random" style="flex:1;padding:10px 0;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;">'
        +         '<i class="fas fa-dice" style="margin-right:5px;font-size:11px;"></i>随机时差'
        +       '</button>'
        +     '</div>'
        +     '<div id="tz-offset-desc" style="font-size:12px;color:var(--text-primary,#333);margin:6px 0 2px;"></div>'
        +   '</div>'
        +   '<div id="tz-preview" style="display:flex;gap:10px;margin-top:14px;"></div>'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:12px;line-height:1.7;">'
        +     '只有两种模式：他和你同时区，或者一个随机时区。随机时差不能手动调，再点一次「随机时差」会重新掷一个。'
        +   '</div>'
        +   '<div style="display:flex;gap:8px;margin-top:14px;">'
        +     '<button type="button" id="tz-close" class="modal-btn modal-btn-secondary" style="flex:1;">关闭</button>'
        +   '</div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#tz-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });

        m.querySelector('#tz-toggle-btn').addEventListener('click', function () {
            toggle();
            render();
        });

        // 模式切换：same = 同时区；random = 随机掷一个时差（重复点 = 重新掷）
        m.querySelector('#tz-mode-same').addEventListener('click', function () {
            var d = load();
            d.mode = 'same';
            d.offsetHours = 0;
            _saveData(d);
            render();
            _updateBadge();
        });
        m.querySelector('#tz-mode-random').addEventListener('click', function () {
            var d = load();
            d.mode = 'random';
            d.offsetHours = _rollRandomOffset();
            _saveData(d);
            render();
            _updateBadge();
        });
    }

    function render() {
        var m = document.getElementById('timezone-modal');
        if (!m) return;
        var d = load();

        var btn = m.querySelector('#tz-toggle-btn');
        if (btn) {
            btn.textContent = d.enabled ? '已开启' : '已关闭';
            btn.style.background = d.enabled ? 'var(--accent-color,#c5a47e)' : 'var(--border-color,#ddd)';
            btn.style.color = d.enabled ? '#fff' : 'var(--text-secondary,#999)';
        }

        // 两个模式按钮的高亮状态（浅色样式，跟深浅主题都兼容）
        var sameBtn = m.querySelector('#tz-mode-same');
        var randomBtn = m.querySelector('#tz-mode-random');
        [sameBtn, randomBtn].forEach(function (b) {
            if (!b) return;
            b.style.borderColor = 'var(--border-color,#ddd)';
            b.style.background = 'transparent';
            b.style.color = 'var(--text-primary,#333)';
        });
        var activeBtn = d.mode === 'random' ? randomBtn : sameBtn;
        if (activeBtn) {
            activeBtn.style.borderColor = 'var(--accent-color,#c5a47e)';
            activeBtn.style.background = 'rgba(var(--accent-color-rgb,197,164,126),.16)';
            activeBtn.style.color = 'var(--accent-color,#c5a47e)';
        }

        var desc = m.querySelector('#tz-offset-desc');
        if (desc) desc.textContent = d.mode === 'random'
            ? _fmtOffsetDesc(d.offsetHours) + '（再点一次「随机时差」可重掷）'
            : '梦角和你同时区，时间完全一样';

        // 实时预览：两个时间并排大显示
        var preview = m.querySelector('#tz-preview');
        if (preview) {
            var now = new Date();
            var pt = getPartnerTime();
            preview.innerHTML =
                '<div style="flex:1;text-align:center;padding:14px 8px;border-radius:12px;background:var(--secondary-bg,#f5f5f5);">'
                +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-bottom:6px;">你的本地时间</div>'
                +   '<div style="font-size:22px;font-weight:700;color:var(--text-primary,#333);">' + _fmtTime(now) + '</div>'
                +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:4px;">' + _fmtDate(now) + '</div>'
                + '</div>'
                + '<div style="flex:1;text-align:center;padding:14px 8px;border-radius:12px;'
                +   'background:rgba(var(--accent-color-rgb,197,164,126),.12);">'
                +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-bottom:6px;">梦角的时间</div>'
                +   '<div style="font-size:22px;font-weight:700;color:var(--accent-color,#c5a47e);">' + _fmtTime(pt) + '</div>'
                +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:4px;">' + _fmtDate(pt) + '</div>'
                + '</div>';
        }
    }

    function open() {
        buildModal();
        render();
        var m = document.getElementById('timezone-modal');
        if (m) {
            if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
        }
    }

    function init() {
        _updateBadge();
        _ensureTick();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── 对外暴露 ──────────────────────
    window.Timezone = {
        open: open,
        toggle: toggle,
        getPartnerTime: getPartnerTime,
        isEnabled: isEnabled,
        // 原地切换梦角后让顶部时差胶囊换成新梦角（不然还挂着上一个名字）
        refresh: function () { try { render(); } catch (e) {} }
    };
})();
