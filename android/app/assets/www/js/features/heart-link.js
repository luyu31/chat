/**
 * heart-link.js — 心链感应 v1
 *
 * 聊天顶栏随时看两人的「链接状态」：有没有连上、强度多少，全部随机。
 *  - 顶栏头像下方挂一个小胶囊（心跳图标 + 强度%），点击打开感应面板；
 *    状态带 TTL（10 分钟），过期自动重掷，页面开着也有"活着"的感觉
 *  - 面板：扫描动画 → 随机结果（六档：心有灵犀/同频共振/链接平稳/信号波动/若即若离/暂时失联）
 *  - 分享到聊天：发 link-check 卡片；梦角的反应走 SceneLines（自定义台词 > 字卡库 > 静默），
 *    支持自定义台词里用 {pct} 占位符代替强度数字
 */
(function () {
    'use strict';

    var STORE_KEY = 'heart_link_state_v1';
    var TTL_MS = 10 * 60 * 1000; // 状态 10 分钟后过期重掷

    // 六档，加权随机：大部分时间连得好，偶尔微弱，小概率失联
    var TIERS = [
        { w: 15, min: 90, max: 100, name: '心有灵犀', desc: '两个人的心跳几乎叠在了一起', ecg: 0 },
        { w: 25, min: 75, max: 89,  name: '同频共振', desc: '不用说话，也知道对方在想什么', ecg: 1 },
        { w: 25, min: 55, max: 74,  name: '链接平稳', desc: '安安稳稳地连着，像平时一样', ecg: 2 },
        { w: 20, min: 35, max: 54,  name: '信号波动', desc: '有一点点分心，但还牵着', ecg: 3 },
        { w: 10, min: 10, max: 34,  name: '若即若离', desc: '信号时有时无，好像在想别的事', ecg: 4 },
        { w: 5,  min: 0,  max: 0,   name: '暂时失联', desc: '现在没连上……可能走神了', ecg: 5 }
    ];

    // 结果页的心电图（六档各一条，viewBox 0 0 240 60）
    var ECG_PATHS = [
        'M0,32 L28,32 L34,20 L42,44 L48,32 L80,32 L86,20 L94,44 L100,32 L132,32 L138,20 L146,44 L152,32 L184,32 L190,20 L198,44 L204,32 L240,32',
        'M0,32 L24,32 L30,24 L38,42 L44,32 L72,32 L78,24 L86,42 L92,32 L120,32 L126,24 L134,42 L140,32 L168,32 L174,24 L182,42 L188,32 L216,32 L222,24 L230,42 L236,32 L240,32',
        'M0,32 L36,32 L40,28 L46,38 L50,32 L84,32 L88,28 L94,38 L98,32 L132,32 L136,28 L142,38 L146,32 L180,32 L184,28 L190,38 L194,32 L240,32',
        'M0,32 L20,32 L25,26 L30,38 L35,32 L48,29 L54,35 L60,32 L84,32 L90,22 L98,44 L104,32 L124,30 L130,34 L136,32 L160,32 L166,22 L174,44 L180,32 L204,30 L210,35 L216,32 L240,32',
        'M0,32 L22,32 L28,26 L36,40 L42,32 L60,32 L66,26 L74,40 L80,32 L240,32',
        'M0,32 L92,32 L96,30 L102,35 L106,32 L240,32'
    ];

    var _state = null; // { strength, tier, ts }
    var _scanning = false;

    function _tierOf(i) { return TIERS[i]; }

    function _roll() {
        var total = 0;
        TIERS.forEach(function (t) { total += t.w; });
        var r = Math.random() * total;
        var picked = TIERS[TIERS.length - 1];
        for (var i = 0; i < TIERS.length; i++) {
            r -= TIERS[i].w;
            if (r < 0) { picked = TIERS[i]; break; }
        }
        var strength = picked.min + Math.floor(Math.random() * (picked.max - picked.min + 1));
        _state = { strength: strength, tier: TIERS.indexOf(picked), ts: Date.now() };
        try { localforage.setItem(STORE_KEY, _state); } catch (e) {}
        _renderChip();
        return _state;
    }

    function _bars(strength) {
        var lit = strength <= 0 ? 0 : Math.max(1, Math.ceil(strength / 20));
        var html = '';
        for (var i = 0; i < 5; i++) html += '<span class="hl-bar' + (i < lit ? ' on' : '') + '"></span>';
        return html;
    }

    // ── 顶栏胶囊 ─────────────────────────────────────────
    function _ensureChip() {
        var status = document.getElementById('partner-status');
        if (!status || document.getElementById('hl-chip')) return;
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.id = 'hl-chip';
        chip.title = '心链感应';
        chip.innerHTML = '<i class="fas fa-heart-pulse"></i><span class="hl-chip-val"></span>';
        chip.addEventListener('click', function () { openPanel(); });
        status.appendChild(chip);
    }

    function _renderChip() {
        var chip = document.getElementById('hl-chip');
        var val = chip && chip.querySelector('.hl-chip-val');
        if (!chip || !val || !_state) return;
        var t = _tierOf(_state.tier);
        var dead = _state.strength <= 0;
        chip.classList.toggle('hl-chip-dead', dead);
        val.textContent = dead ? '··' : _state.strength + '%';
        chip.title = '心链感应：' + t.name;
    }

    function _tick() {
        if (!_state || Date.now() - _state.ts > TTL_MS) _roll();
        else _renderChip();
    }

    // ── 感应面板 ─────────────────────────────────────────
    function _panelHtml() {
        return '<div class="modal-content hl-modal">' +
                '<div class="modal-title"><i class="fas fa-heart-pulse"></i><span>心链感应</span></div>' +
                '<div class="hl-stage" id="hl-stage">' +
                    '<div class="hl-ring"><i class="fas fa-heart-pulse"></i></div>' +
                    '<div class="hl-pct" id="hl-pct">--</div>' +
                    '<div class="hl-word" id="hl-word">正在感应…</div>' +
                    '<svg class="hl-ecg" id="hl-ecg" viewBox="0 0 240 60" preserveAspectRatio="none">' +
                        '<path id="hl-ecg-path" d="M0,32 L240,32" fill="none"/>' +
                    '</svg>' +
                    '<div class="hl-bars" id="hl-bars">' +
                        '<span class="hl-bar"></span><span class="hl-bar"></span><span class="hl-bar"></span><span class="hl-bar"></span><span class="hl-bar"></span>' +
                    '</div>' +
                    '<div class="hl-desc" id="hl-desc">闭上眼睛，感受一下那边的心跳</div>' +
                '</div>' +
                '<div class="hl-actions">' +
                    '<button type="button" class="modal-btn modal-btn-secondary" id="hl-redo">重新感应</button>' +
                    '<button type="button" class="modal-btn modal-btn-primary" id="hl-share">分享到聊天</button>' +
                '</div>' +
                '<button type="button" class="hl-edit-lines" id="hl-edit-lines">定制 ta 的感应台词</button>' +
            '</div>';
    }

    var _scanTimer = null;

    function _showResult(st) {
        var t = _tierOf(st.tier);
        var stage = document.getElementById('hl-stage');
        if (!stage) return;
        stage.classList.remove('hl-scanning');
        stage.classList.toggle('hl-dead', st.strength <= 0);
        var pct = document.getElementById('hl-pct');
        var word = document.getElementById('hl-word');
        var desc = document.getElementById('hl-desc');
        var path = document.getElementById('hl-ecg-path');
        var bars = document.getElementById('hl-bars');
        if (pct) pct.textContent = st.strength <= 0 ? '--' : st.strength + '%';
        if (word) word.textContent = t.name;
        if (desc) desc.textContent = t.desc;
        if (path) path.setAttribute('d', ECG_PATHS[t.ecg]);
        if (bars) bars.innerHTML = _bars(st.strength);
        _renderChip();
    }

    function _scan() {
        if (_scanning) return;
        _scanning = true;
        var stage = document.getElementById('hl-stage');
        var pct = document.getElementById('hl-pct');
        var word = document.getElementById('hl-word');
        var path = document.getElementById('hl-ecg-path');
        var bars = document.getElementById('hl-bars');
        if (stage) { stage.classList.add('hl-scanning'); stage.classList.remove('hl-dead'); }
        if (word) word.textContent = '正在感应…';
        if (path) path.setAttribute('d', ECG_PATHS[2]);
        if (bars) bars.innerHTML = _bars(0);

        // 数字乱跳，1.5s 后定格到本次抽中的结果
        var st = _roll();
        var hops = 0;
        if (_scanTimer) clearInterval(_scanTimer);
        _scanTimer = setInterval(function () {
            hops++;
            if (pct) pct.textContent = (5 + Math.floor(Math.random() * 95)) + '%';
            if (hops >= 18) {
                clearInterval(_scanTimer);
                _scanTimer = null;
                _scanning = false;
                _showResult(st);
            }
        }, 82);
    }

    function openPanel() {
        var old = document.getElementById('heart-link-modal');
        if (old) old.remove();
        var m = document.createElement('div');
        m.id = 'heart-link-modal';
        m.className = 'modal';
        m.style.zIndex = '3200';
        m.innerHTML = _panelHtml();
        document.body.appendChild(m);
        m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
        m.querySelector('#hl-redo').addEventListener('click', _scan);
        m.querySelector('#hl-share').addEventListener('click', function () {
            if (!_state) return;
            _sendCard(_state);
            m.remove();
        });
        m.querySelector('#hl-edit-lines').addEventListener('click', function () {
            if (window.SceneLines && window.SceneLines.openEditor) {
                window.SceneLines.openEditor({
                    title: '心链感应台词',
                    slots: [
                        { scene: 'link', slot: 'check', label: '感应出结果后 ta 说', ph: '每行一条，随机抽一条说', hint: '可用 {pct} 代替感应强度数字' }
                    ]
                });
            }
        });
        if (typeof showModal === 'function') showModal(m);
        _scan();
    }

    // ── 聊天卡片（type: 'link-check'）────────────────────
    function _escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _avatarHTML(isPartner, size) {
        if (typeof window._avEl === 'function') return window._avEl(isPartner, size || 30);
        return '<span style="font-size:' + Math.round((size || 30) * 0.65) + 'px;">' + (isPartner ? '🌸' : '🙂') + '</span>';
    }

    function _fmtTime(ts) {
        var d = new Date(ts);
        function p(n) { return n < 10 ? '0' + n : '' + n; }
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function _cardFragment(msg) {
        var d = msg.linkCheckData || {};
        var st = { strength: d.strength || 0, tier: d.tier || 0 };
        var t = _tierOf(st.tier);
        var fragment = new DocumentFragment();
        var wrap = document.createElement('div');
        wrap.className = 'message-wrapper sent hl-msg-wrap';
        wrap.dataset.id = msg.id;
        wrap.innerHTML =
            '<div class="message-avatar">' + _avatarHTML(false, 36) + '</div>' +
            '<div class="message-content-wrapper">' +
                '<div class="hl-card' + (st.strength <= 0 ? ' hl-card-dead' : '') + '">' +
                    '<div class="hl-card-banner">HEART LINK</div>' +
                    '<div class="hl-card-top">' +
                        '<i class="fas fa-heart-pulse"></i>' +
                        '<span class="hl-card-pct">' + (st.strength <= 0 ? '--' : st.strength) + '%</span>' +
                    '</div>' +
                    '<div class="hl-card-word">' + _escapeHtml(t.name) + '</div>' +
                    '<div class="hl-card-bars">' + _bars(st.strength) + '</div>' +
                    '<div class="hl-card-time">感应于 ' + _fmtTime(d.ts || Date.now()) + '</div>' +
                '</div>' +
            '</div>';
        fragment.appendChild(wrap);
        return fragment;
    }

    function _hookCreateMessageFragment() {
        function tryHook() {
            if (typeof window.createMessageFragment !== 'function') {
                setTimeout(tryHook, 100);
                return;
            }
            var origFn = window.createMessageFragment;
            window.createMessageFragment = function (msg, prevMsg, nextMsg, lastSenderRef) {
                if (msg && msg.type === 'link-check') {
                    if (lastSenderRef) lastSenderRef.current = 'user';
                    return _cardFragment(msg);
                }
                return origFn.apply(this, arguments);
            };
        }
        tryHook();
    }

    function _sendCard(st) {
        if (typeof addMessage !== 'function') {
            console.warn('[heart-link] addMessage 不可用');
            return;
        }
        addMessage({
            id: Date.now() + Math.random(),
            sender: 'user',
            text: '',
            timestamp: new Date(),
            status: 'sent',
            type: 'link-check',
            linkCheckData: { strength: st.strength, tier: st.tier, ts: Date.now() },
            favorited: false,
            note: null
        });
        _partnerReact(st.strength);
    }

    // 梦角反应：自定义台词 > 字卡库 > 静默（支持 {pct} 占位符）
    function _partnerReact(strength) {
        var line = null;
        try {
            if (window.SceneLines && typeof window.SceneLines.pick === 'function') {
                line = window.SceneLines.pick('link', 'check', { pct: String(strength) });
            }
        } catch (e) {}
        if (!line) return;
        setTimeout(function () {
            if (typeof addMessage !== 'function') return;
            addMessage({
                id: Date.now() + Math.random(),
                sender: 'partner',
                text: line,
                timestamp: new Date(),
                status: 'received',
                type: 'normal',
                favorited: false,
                note: null
            });
        }, 900 + Math.random() * 1500);
    }

    // ── 启动 ─────────────────────────────────────────────
    function _init() {
        _hookCreateMessageFragment();
        _ensureChip();
        try {
            localforage.getItem(STORE_KEY).then(function (v) {
                if (v && typeof v === 'object' && typeof v.strength === 'number') {
                    _state = v;
                    if (v.tier == null || v.tier < 0 || v.tier >= TIERS.length) _state.tier = 0;
                }
                _tick();
            }).catch(function () { _roll(); });
        } catch (e) { _roll(); }
        setInterval(_tick, 60000);
        // 头像是异步加载的，晚一点再补一次胶囊（防止 status 容器还没就绪）
        setTimeout(_ensureChip, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    window.HeartLink = { openPanel: openPanel };
})();
