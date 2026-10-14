/**
 * scene-lines.js — 场景台词系统（电影院 / 一起读书共用）
 *
 * 固定场景（开始一起看、结束、读书中途搭话……）他要说的话：
 *   1. 用户在设置里自定义了 → 从自定义里随机抽一条（支持 {title}/{n}/{min}/{pct}/{his} 占位符）
 *   2. 没自定义 → 从导入的字卡回复库（customReplies，含禁用过滤）里随机抽一条
 *   3. 字卡库也是空的 → 不说话（返回 null），绝不使用内置默认文案
 *
 * 挑选动作类消息（观影中聊天、读书时发消息）不走这里——那些直接复用
 * 主聊天的 _triggerDelayedReply，本来就是纯字卡驱动。
 */
(function () {
    'use strict';

    var KEY = 'scene_lines_v1';
    var _data = null; // { 'cinema.start': ['...', ...], ... }

    function _load() {
        if (_data) return Promise.resolve(_data);
        try {
            return localforage.getItem(KEY).then(function (v) {
                _data = (v && typeof v === 'object') ? v : {};
                return _data;
            });
        } catch (e) { _data = {}; return Promise.resolve(_data); }
    }
    function _save() {
        try { localforage.setItem(KEY, _data); } catch (e) {}
    }

    // ── 字卡池：跟主聊天 simulateReply 同规则过滤（禁用条目 + 禁用分组）──
    function buildReplyPool() {
        var replies = (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) ? customReplies : [];
        if (!replies.length) return [];
        var disabledItems = (function () {
            try {
                var raw = localStorage.getItem('disabledReplyItems');
                return raw ? new Set(JSON.parse(raw)) : new Set();
            } catch (e) { return new Set(); }
        })();
        var disabledGroupItems = new Set();
        (window.customReplyGroups || []).forEach(function (g) {
            if (g.disabled && Array.isArray(g.items)) {
                g.items.forEach(function (it) { disabledGroupItems.add(it); });
            }
        });
        return replies
            .filter(function (r) { return !disabledItems.has(r) && !disabledGroupItems.has(r); })
            .map(function (r) { return String(r || '').trim(); })
            .filter(Boolean);
    }

    function _fill(line, ctx) {
        if (!ctx) return line;
        return String(line)
            .replace(/\{title\}/g, ctx.title != null ? String(ctx.title) : '')
            .replace(/\{n\}/g, ctx.n != null ? String(ctx.n) : '')
            .replace(/\{min\}/g, ctx.min != null ? String(ctx.min) : '')
            .replace(/\{pct\}/g, ctx.pct != null ? String(ctx.pct) : '')
            .replace(/\{his\}/g, ctx.his != null ? String(ctx.his) : '');
    }

    /**
     * 抽一条台词。返回 null 表示"没素材，别说话"。
     * pick('cinema', 'start', { title: '情书' })
     */
    function pick(scene, slot, ctx) {
        var k = scene + '.' + slot;
        var custom = (_data && Array.isArray(_data[k])) ? _data[k].filter(function (s) { return s && s.trim(); }) : [];
        if (custom.length) {
            return _fill(custom[Math.floor(Math.random() * custom.length)], ctx);
        }
        var pool = buildReplyPool();
        if (!pool.length) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** 某场景是否配置了自定义台词（编辑器回显用） */
    function getCustom(scene, slot) {
        var k = scene + '.' + slot;
        return (_data && Array.isArray(_data[k])) ? _data[k].slice() : [];
    }

    /**
     * 打开台词编辑器。
     * openEditor({
     *   title: '电影院台词',
     *   slots: [
     *     { scene:'cinema', slot:'start', label:'开场', ph:'每行一条，随机抽一条说', hint:'可用 {title} 代替片名' },
     *     ...
     *   ]
     * })
     */
    function openEditor(cfg) {
        _load().then(function () {
            var old = document.getElementById('scene-lines-editor');
            if (old) old.remove();
            var m = document.createElement('div');
            m.id = 'scene-lines-editor';
            m.className = 'modal';
            m.style.zIndex = '3500';
            var fields = cfg.slots.map(function (s, i) {
                var cur = getCustom(s.scene, s.slot);
                return '<div style="margin-bottom:14px;">' +
                        '<div style="font-size:12.5px;font-weight:700;color:var(--text-primary,#333);margin-bottom:2px;">' + s.label + '</div>' +
                        (s.hint ? '<div style="font-size:10.5px;color:var(--text-secondary,#999);margin-bottom:5px;">' + s.hint + '</div>' : '') +
                        '<textarea data-i="' + i + '" rows="3" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-color,#ddd);border-radius:10px;background:var(--primary-bg,transparent);color:var(--text-primary,#333);font-size:12px;font-family:inherit;resize:vertical;" placeholder="' + (s.ph || '每行一条，随机抽取') + '">' +
                            cur.map(function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }).join('\n') +
                        '</textarea>' +
                    '</div>';
            }).join('');
            m.innerHTML =
                '<div class="modal-content" style="max-width:420px;width:90vw;max-height:82vh;display:flex;flex-direction:column;">' +
                    '<div class="modal-title"><i class="fas fa-comment-dots"></i><span>' + cfg.title + '</span></div>' +
                    '<div style="flex:1;overflow-y:auto;padding-right:2px;">' + fields + '</div>' +
                    '<div style="font-size:11px;color:var(--text-secondary,#999);margin:10px 0;line-height:1.7;">' +
                        '每行写一条，到时随机抽一条说；<b>留空 = 直接用你字卡库里导入的回复</b>（随机抽）。字卡库也是空的话，他就什么都不说。' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;">' +
                        '<button type="button" id="scene-lines-cancel" class="modal-btn modal-btn-secondary" style="flex:1;">取消</button>' +
                        '<button type="button" id="scene-lines-save" class="modal-btn modal-btn-primary" style="flex:1;">保存</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(m);

            function close() { m.remove(); }
            m.querySelector('#scene-lines-cancel').addEventListener('click', close);
            m.addEventListener('click', function (e) { if (e.target === m) close(); });
            m.querySelector('#scene-lines-save').addEventListener('click', function () {
                m.querySelectorAll('textarea').forEach(function (ta) {
                    var s = cfg.slots[parseInt(ta.getAttribute('data-i'), 10)];
                    var lines = ta.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
                    _data[s.scene + '.' + s.slot] = lines;
                });
                _save();
                close();
                if (typeof showNotification === 'function') showNotification('台词已保存', 'success', 1800);
            });
            if (typeof showModal === 'function') showModal(m);
        });
    }

    _load();

    window.SceneLines = {
        pick: pick,
        getCustom: getCustom,
        openEditor: openEditor,
        buildReplyPool: buildReplyPool
    };
})();
