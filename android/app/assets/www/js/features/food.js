/**
 * food.js — 食光记
 *
 * 「今天吃什么」的仪式感小本本：
 *   1. 互相推荐：把想吃的推荐给TA（TA会回一句反应），
 *      也可以让TA推荐一个（TA从内置美食池里随机馋一个）；
 *   2. 记一笔吃了什么：我吃的/TA吃的都能记，带餐段（早/午/晚/夜宵/加餐）；
 *   3. 推荐和记录全部以聊天消息的形式出现在聊天流里，
 *      翻聊天记录就像翻一起吃过的日子。
 *
 * 入口：输入区「+」更多菜单 → 食光记
 * 存储：localStorage 'foodDiaryData' { entries:[{id,ts,kind,author,what,meal}] }
 */
(function () {
    'use strict';

    var KEY = 'foodDiaryData';
    var MAX_ENTRIES = 500;

    // TA 推荐时的内置美食池（名字 + emoji）
    var FOOD_POOL = [
        ['火锅', '🍲'], ['烤肉', '🥩'], ['麻辣烫', '🍜'], ['螺蛳粉', '🍜'],
        ['炸鸡', '🍗'], ['烧烤', '🍢'], ['小龙虾', '🦞'], ['寿司', '🍣'],
        ['披萨', '🍕'], ['汉堡', '🍔'], ['饺子', '🥟'], ['牛肉面', '🍜'],
        ['韩式拌饭', '🍚'], ['泰式咖喱', '🍛'], ['关东煮', '🍢'], ['烤鱼', '🐟'],
        ['酸辣粉', '🍜'], ['砂锅粥', '🥣'], ['轻食沙拉', '🥗'], ['家常菜', '🥘'],
        ['奶茶', '🧋'], ['甜品', '🍰']
    ];

    var MEALS = ['早餐', '午餐', '晚餐', '夜宵', '加餐'];

    // ── 台词池（不预设身份，口吻跟其他模块保持一致） ──────────────────────
    var ME_RECO = [
        '给你推荐：{f}，下次一起？',
        '突然很想吃{f}，安排一个？',
        '我发现{f}好像很不错，记下来一起去'
    ];
    var HE_RECO = [
        '要不试试{f}？突然馋了',
        '我最近想吃{f}，一起？',
        '今晚{f}怎么样？我来挑地方',
        '馋{f}了，你陪我吃就更好了'
    ];
    var REACT_ACCEPT = [
        '好呀，记下了，下次一起去',
        '这个可以有，已经被我馋到了',
        '听你的，你推荐的都好吃',
        '行，就它了，你真会挑',
        '嗯嗯，我已经在想加什么菜了'
    ];
    var REACT_TEASE = [
        '哼，这时候馋我？记下了，你请',
        '看起来不错……要是你做的就更好了',
        '批准了，不过要陪我一起吃才算数'
    ];
    var ME_EATEN = [
        '{m}吃了{f}，记下啦',
        '{m}解决：{f}，还不错',
        '{m}的{f}，有点好吃',
        '今天{m}是{f}，汇报完毕'
    ];
    var HIM_EATEN = [
        '我{m}吃了{f}，满足',
        '{m}解决了{f}，和你汇报一下',
        '今天{m}吃的{f}，下次带你来'
    ];

    // ── 工具 ──────────────────────
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function _partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }
    function _nowMeal() {
        var h = new Date().getHours();
        if (h >= 5 && h < 10) return '早餐';
        if (h >= 10 && h < 14) return '午餐';
        if (h >= 14 && h < 18) return '加餐';
        if (h >= 18 && h < 23) return '晚餐';
        return '夜宵';
    }
    function _gain(n) {
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gain === 'function') {
                window.PartnerProficiency.gain(n);
            }
        } catch (e) {}
    }

    // ── 存取 ──────────────────────
    function load() {
        try {
            var d = JSON.parse(localStorage.getItem(KEY));
            if (!d || typeof d !== 'object') d = {};
            if (!Array.isArray(d.entries)) d.entries = [];
            return d;
        } catch (e) {
            return { entries: [] };
        }
    }
    function save(d) {
        try {
            if (d.entries.length > MAX_ENTRIES) d.entries.length = MAX_ENTRIES;
            localStorage.setItem(KEY, JSON.stringify(d));
        } catch (e) {}
    }
    function _newId() { return 'f_' + Date.now() + '_' + Math.floor(Math.random() * 100000); }

    // ── 往聊天流里说话（我 / TA 两种身份，和 quickqa 同一套） ──────────────────────
    function _say(text, who) {
        try {
            if (typeof addMessage !== 'function') return;
            addMessage({
                id: Date.now() + Math.floor(Math.random() * 1000),
                sender: who === 'me' ? 'user' : _partnerName(),
                text: text,
                timestamp: new Date(),
                status: who === 'me' ? 'sent' : 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal'
            });
            if (typeof playSound === 'function') playSound(who === 'me' ? 'send' : 'message');
        } catch (e) {}
    }

    // ── 动作 ──────────────────────
    function recommendMine(what) {
        what = String(what || '').trim().slice(0, 20);
        if (!what) return false;
        var d = load();
        d.entries.unshift({ id: _newId(), ts: Date.now(), kind: 'recommend', author: 'me', what: what, meal: '' });
        save(d);
        _say(_pick(ME_RECO).replace(/\{f\}/g, what), 'me');
        // TA 隔一会儿回一句反应（多数时候开心接受，偶尔嘴硬一下）
        var react = Math.random() < 0.8 ? _pick(REACT_ACCEPT) : _pick(REACT_TEASE);
        setTimeout(function () { _say(react, 'him'); }, 1000 + Math.random() * 1800);
        _gain(2);
        renderList();
        return true;
    }

    function recommendHis() {
        var f = _pick(FOOD_POOL);
        var d = load();
        d.entries.unshift({ id: _newId(), ts: Date.now(), kind: 'recommend', author: 'partner', what: f[0], meal: '' });
        save(d);
        _say(_pick(HE_RECO).replace(/\{f\}/g, f[0] + ' ' + f[1]), 'him');
        _gain(2);
        renderList();
        if (typeof showNotification === 'function') {
            showNotification(_partnerName() + '推荐了：' + f[0] + ' ' + f[1], 'info', 2200);
        }
    }

    function recordEaten(what, meal, author) {
        what = String(what || '').trim().slice(0, 20);
        if (!what) return false;
        meal = MEALS.indexOf(meal) > -1 ? meal : _nowMeal();
        author = author === 'partner' ? 'partner' : 'me';
        var d = load();
        d.entries.unshift({ id: _newId(), ts: Date.now(), kind: 'eaten', author: author, what: what, meal: meal });
        save(d);
        var tpl = author === 'me' ? _pick(ME_EATEN) : _pick(HIM_EATEN);
        _say(tpl.replace(/\{m\}/g, meal).replace(/\{f\}/g, what), author);
        _gain(1);
        renderList();
        return true;
    }

    // ── 弹窗 UI ──────────────────────
    var _mealSel = '午餐';
    var _authorSel = 'me';

    function buildModal() {
        if (document.getElementById('food-modal')) return;

        var st = document.createElement('style');
        st.textContent =
            '#food-modal .modal-content{max-width:420px;width:90vw;max-height:86vh;overflow-y:auto;}' +
            '.food-sec-title{font-size:12px;font-weight:700;color:var(--text-secondary,#999);margin:14px 0 6px;}' +
            '.food-sec-title:first-of-type{margin-top:6px;}' +
            '.food-input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;border:1.5px solid var(--border-color,#ddd);background:var(--primary-bg,transparent);color:var(--text-primary,#333);font-size:13px;outline:none;font-family:var(--font-family);}' +
            '.food-input:focus{border-color:var(--accent-color,#c5a47e);}' +
            '.food-btn-row{display:flex;gap:8px;margin-top:8px;}' +
            '.food-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}' +
            '.food-chip{padding:6px 12px;border-radius:999px;border:1px solid var(--border-color,#ddd);background:var(--secondary-bg,transparent);font-size:12px;color:var(--text-primary,#333);cursor:pointer;font-family:var(--font-family);}' +
            '.food-chip.active{border-color:var(--accent-color,#c5a47e);background:rgba(var(--accent-color-rgb,197,164,126),.16);color:var(--accent-color,#c5a47e);font-weight:700;}' +
            '.food-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:11px;}' +
            '.food-row:hover{background:var(--secondary-bg,rgba(0,0,0,.03));}' +
            '.food-row-icon{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;flex-shrink:0;}' +
            '.food-row-main{flex:1;min-width:0;}' +
            '.food-row-desc{font-size:13px;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.food-row-sub{font-size:10px;color:var(--text-secondary,#aaa);margin-top:1px;}' +
            '.food-row-btn{flex-shrink:0;width:26px;height:26px;border:none;border-radius:50%;background:transparent;color:var(--text-secondary,#aaa);font-size:11px;cursor:pointer;}' +
            '.food-date-head{font-size:11px;color:var(--text-secondary,#999);margin:8px 2px 2px;}' +
            '.food-author-tag{display:inline-block;padding:0 6px;border-radius:8px;font-size:10px;line-height:16px;background:rgba(197,164,126,.16);color:var(--accent-color,#c5a47e);margin-right:4px;vertical-align:middle;}' +
            '.food-author-partner{background:rgba(138,123,216,.16);color:#8a7bd8;}';
        document.head.appendChild(st);

        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'food-modal';
        m.style.zIndex = '3200';
        m.innerHTML =
            '<div class="modal-content">'
            +   '<div class="modal-title"><i class="fas fa-utensils"></i><span>食光记</span></div>'

            +   '<div class="food-sec-title"><i class="fas fa-star"></i> 互相推荐</div>'
            +   '<input type="text" class="food-input" id="food-rec-input" placeholder="想推荐TA吃什么？如：火锅" maxlength="20">'
            +   '<div class="food-btn-row">'
            +     '<button type="button" id="food-rec-mine" class="modal-btn modal-btn-primary" style="flex:1;padding:9px;font-size:12px;">推荐给TA</button>'
            +     '<button type="button" id="food-rec-his" class="modal-btn modal-btn-secondary" style="flex:1;padding:9px;font-size:12px;">让TA推荐一个</button>'
            +   '</div>'

            +   '<div class="food-sec-title"><i class="fas fa-pen-to-square"></i> 记一笔吃的</div>'
            +   '<div class="food-chips" id="food-meal-chips"></div>'
            +   '<div class="food-chips" id="food-author-chips"></div>'
            +   '<input type="text" class="food-input" id="food-eat-input" placeholder="吃了什么？如：螺蛳粉" maxlength="20">'
            +   '<div class="food-btn-row">'
            +     '<button type="button" id="food-eat-save" class="modal-btn modal-btn-primary" style="flex:1;padding:9px;font-size:12px;">记下来</button>'
            +   '</div>'

            +   '<div class="food-sec-title"><i class="fas fa-clock-rotate-left"></i> 最近食光</div>'
            +   '<div id="food-list" style="max-height:26vh;overflow-y:auto;"></div>'

            +   '<div class="food-btn-row" style="margin-top:12px;">'
            +     '<button type="button" id="food-close" class="modal-btn modal-btn-secondary" style="flex:1;">关闭</button>'
            +   '</div>'
            +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:8px;line-height:1.7;">推荐和记录都会出现在聊天里，翻记录就像翻一起吃过的日子</div>'
            + '</div>';
        document.body.appendChild(m);

        m.querySelector('#food-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });

        // 推荐给TA / 让TA推荐
        function doRecMine() {
            var input = m.querySelector('#food-rec-input');
            if (!input) return;
            if (!recommendMine(input.value)) {
                if (typeof showNotification === 'function') showNotification('先写个想吃的吧～', 'info', 1800);
                return;
            }
            input.value = '';
        }
        m.querySelector('#food-rec-mine').addEventListener('click', doRecMine);
        m.querySelector('#food-rec-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doRecMine(); } });
        m.querySelector('#food-rec-his').addEventListener('click', function () { recommendHis(); });

        // 记一笔
        function doEatSave() {
            var input = m.querySelector('#food-eat-input');
            if (!input) return;
            if (!recordEaten(input.value, _mealSel, _authorSel)) {
                if (typeof showNotification === 'function') showNotification('先写吃了什么吧～', 'info', 1800);
                return;
            }
            input.value = '';
        }
        m.querySelector('#food-eat-save').addEventListener('click', doEatSave);
        m.querySelector('#food-eat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doEatSave(); } });

        // 列表删除（事件委托）
        m.querySelector('#food-list').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-food-del]');
            if (!btn) return;
            var id = btn.getAttribute('data-food-del');
            var d = load();
            d.entries = d.entries.filter(function (x) { return String(x.id) !== String(id); });
            save(d);
            renderList();
        });
    }

    function renderChips() {
        var mealBox = document.getElementById('food-meal-chips');
        var authorBox = document.getElementById('food-author-chips');
        if (mealBox) {
            mealBox.innerHTML = '';
            MEALS.forEach(function (mm) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'food-chip' + (mm === _mealSel ? ' active' : '');
                b.textContent = mm;
                b.addEventListener('click', function () { _mealSel = mm; renderChips(); });
                mealBox.appendChild(b);
            });
        }
        if (authorBox) {
            authorBox.innerHTML = '';
            [['me', '我吃的'], ['partner', 'TA吃的']].forEach(function (pair) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'food-chip' + (_authorSel === pair[0] ? ' active' : '');
                b.textContent = pair[1];
                b.addEventListener('click', function () { _authorSel = pair[0]; renderChips(); });
                authorBox.appendChild(b);
            });
        }
    }

    function renderList() {
        var el = document.getElementById('food-list');
        if (!el) return;
        var d = load();
        if (!d.entries.length) {
            el.innerHTML = '<div class="stats-empty-state" style="padding:16px 10px;"><div style="font-size:24px;opacity:.5;"><i class="fas fa-utensils"></i></div><p style="font-size:12px;margin-top:6px;">还没有食光记录<br>推荐一顿或记一笔试试吧</p></div>';
            return;
        }

        var html = '';
        var lastDate = null;
        var now = new Date();
        var todayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
        var shown = d.entries.slice(0, 100);

        shown.forEach(function (x) {
            var dt = new Date(x.ts);
            var dk = dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate();
            if (dk !== lastDate) {
                lastDate = dk;
                var label = dk === todayKey ? '今天' : (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
                html += '<div class="food-date-head">' + label + '</div>';
            }
            var isRec = x.kind === 'recommend';
            var icon = isRec ? 'fa-star' : 'fa-utensils';
            var rgb = isRec ? '250,204,21' : '249,115,22';
            var authorName = x.author === 'partner' ? _partnerName() : '我';
            var desc = isRec ? x.what : (x.meal ? x.meal + ' · ' : '') + x.what;
            var time = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
            html += '<div class="food-row">'
                + '<span class="food-row-icon" style="background:linear-gradient(135deg,rgba(' + rgb + ',.9),rgba(' + rgb + ',.65));"><i class="fas ' + icon + '"></i></span>'
                + '<div class="food-row-main">'
                +   '<div class="food-row-desc">' + (isRec ? '推荐' : '吃了') + '：' + _esc(x.what) + '</div>'
                +   '<div class="food-row-sub"><span class="food-author-tag' + (x.author === 'partner' ? ' food-author-partner' : '') + '">' + _esc(authorName) + '</span>'
                +     (isRec ? '推荐' : _esc(x.meal || '')) + ' · ' + time + '</div>'
                + '</div>'
                + '<button type="button" class="food-row-btn" data-food-del="' + _esc(x.id) + '" title="删除"><i class="fas fa-times"></i></button>'
                + '</div>';
        });
        el.innerHTML = html;
    }

    function open() {
        buildModal();
        var m = document.getElementById('food-modal');
        if (!m) return;
        _mealSel = _nowMeal();      // 默认餐段跟着现在的时间走
        _authorSel = 'me';
        renderChips();
        renderList();
        // 用食光记 → 梦角 App 熟练度 +1（每日上限 3 次）
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'food', 3);
            }
        } catch (e) {}
        if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
    }

    window.Food = { open: open };
})();
