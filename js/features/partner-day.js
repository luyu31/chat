/**
 * partner-day.js — 「他今天做了什么」
 *
 * 一个时间轴页面：按时间段展示他这一天分别在做什么、在哪，
 * 类似《未定事件簿》的「你我之间」，一眼看完他一整天。
 *
 * 特点：
 *  - 时间段、在哪由用户自己设置（「在哪」每段可填多条候选，
 *    每天按日期固定随机抽一条 —— 同一天内结果稳定，不会刷新一次变一次）
 *  - 「他在做什么」不再每段单写，统一从共享字卡组「他在做什么」里随机抽
 *    （自定义回复 → 氛围感配置 → 他在做什么），想改内容改字卡就行
 *  - 当前时间段高亮显示「现在」，已过去的暗下去，还没到的正常显示
 *  - 跨零点的时段（如 23:30–06:30）也能正确算进"现在"
 *  - 页面做得比较大（宽 94vw / 高 92vh），不是为了塞进小弹窗
 *
 * 入口：高级功能 → 实用工具 → 他今天做了什么
 *      也可以在聊天里直接说「他在干嘛」「他今天做了什么」打开
 * 存储：localStorage 'partnerDayData'
 */
(function () {
    'use strict';

    var KEY = 'partnerDayData';

    var ICONS = [
        { id: 'fa-mug-hot',            label: '起床' },
        { id: 'fa-utensils',           label: '吃饭' },
        { id: 'fa-briefcase',          label: '工作' },
        { id: 'fa-laptop',             label: '电脑' },
        { id: 'fa-bowl-food',          label: '午餐' },
        { id: 'fa-couch',              label: '在家' },
        { id: 'fa-gamepad',            label: '打游戏' },
        { id: 'fa-book',               label: '看书' },
        { id: 'fa-shower',             label: '洗澡' },
        { id: 'fa-moon',               label: '睡觉' },
        { id: 'fa-car',                label: '路上' },
        { id: 'fa-dumbbell',           label: '运动' },
        { id: 'fa-mug-saucer',         label: '喝咖啡' },
        { id: 'fa-comment-heart',      label: '想你' }
    ];

    // 默认模板：一整天覆盖完整（最后一个时段跨零点）
    // 注意：「做什么」不再每个时段各写一份，而是全部从共享的「他在做什么」字卡组里抽
    //       （自定义回复 → 氛围感配置 → 他在做什么），所以这里只留时间、图标、在哪
    function defaultSlots() {
        return [
            { id: 'pd1', start: '06:30', end: '08:00', icon: 'fa-mug-hot',  locs: ['家', '家里'] },
            { id: 'pd2', start: '08:00', end: '09:00', icon: 'fa-utensils', locs: ['家', '楼下的早餐店'] },
            { id: 'pd3', start: '09:00', end: '12:00', icon: 'fa-briefcase', locs: ['公司', '办公室', '会议室'] },
            { id: 'pd4', start: '12:00', end: '13:30', icon: 'fa-bowl-food', locs: ['公司附近', '食堂', '常去的小店'] },
            { id: 'pd5', start: '13:30', end: '18:00', icon: 'fa-laptop',   locs: ['公司', '办公室'] },
            { id: 'pd6', start: '18:00', end: '19:30', icon: 'fa-car',      locs: ['路上', '家'] },
            { id: 'pd7', start: '19:30', end: '22:00', icon: 'fa-couch',    locs: ['家', '沙发上'] },
            { id: 'pd8', start: '22:00', end: '23:30', icon: 'fa-shower',   locs: ['家', '浴室'] },
            { id: 'pd9', start: '23:30', end: '06:30', icon: 'fa-moon',     locs: ['家', '床上'] }
        ];
    }

    function load() {
        try {
            var d = JSON.parse(localStorage.getItem(KEY));
            if (!d || !Array.isArray(d.slots) || !d.slots.length) return { slots: defaultSlots() };
            // 补齐字段（旧数据里可能还有每段自己的 acts，忽略即可 —— 现在统一走共享字卡组）
            d.slots.forEach(function (s) {
                if (!s.locs || !s.locs.length) s.locs = [s.locs || ''].filter(Boolean);
                if (!s.icon) s.icon = 'fa-clock';
            });
            return d;
        } catch (e) { return { slots: defaultSlots() }; }
    }

    function save(d) {
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }

    // ─── 工具 ───
    function parseHM(hm) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
        if (!m) return null;
        var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
        if (h > 23 || mi > 59) return null;
        return h * 60 + mi;
    }
    function nowMin() { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
    function todayKey() {
        var n = new Date();
        return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    }
    function fmtRange(s) { return (s.start || '--:--') + ' – ' + (s.end || '--:--'); }

    // 判断 nowMin 是否落在 [start,end) 内；跨零点时段（end < start）自动处理
    function inSlot(s, nm) {
        var a = parseHM(s.start), b = parseHM(s.end);
        if (a == null || b == null) return false;
        if (a === b) return false;
        if (b > a) return nm >= a && nm < b;
        // 跨零点：比如 23:30 ~ 06:30
        return nm >= a || nm < b;
    }

    // 稳定性：同一天同一时段，抽到的内容不变（换天才会变）
    function _hash(str) {
        var h = 2166136261;
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    function pickForDay(arr, seedStr) {
        if (!arr || !arr.length) return '';
        return arr[_hash(seedStr) % arr.length] || '';
    }

    // 「他在做什么」现在统一从共享字卡组抽（自定义回复 → 氛围感配置 → 他在做什么）
    function actPool() {
        var p = (typeof window._getPartnerDayActPool === 'function') ? window._getPartnerDayActPool() : null;
        return (Array.isArray(p) && p.length) ? p : [''];
    }

    // 某个时段"今天"的具体内容（都在同一天内固定，换天才变）
    function resolveSlot(s, dayKey) {
        return {
            act: pickForDay(actPool(), dayKey + '#' + s.id + '#a'),
            loc: pickForDay(s.locs, dayKey + '#' + s.id + '#l')
        };
    }

    function currentSlot(d, nm) {
        var slots = d.slots || [];
        for (var i = 0; i < slots.length; i++) {
            if (inSlot(slots[i], nm)) return slots[i];
        }
        return null;
    }

    // ─── 弹窗 ───
    var _editing = false;

    function buildModal() {
        if (document.getElementById('partner-day-modal')) return;
        var st = document.createElement('style');
        st.textContent =
            // 页面做大：宽 94vw、高 92vh —— 时间轴要能一口气看完
            '#partner-day-modal .modal-content{max-width:480px;width:94vw;height:92vh;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}' +
            '#partner-day-modal .pd-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 2px 8px;}' +
            '.pd-now-card{border-radius:16px;padding:14px 16px;background:linear-gradient(135deg,rgba(var(--accent-color-rgb,197,164,126),.20),rgba(var(--accent-color-rgb,197,164,126),.06));border:1px solid rgba(var(--accent-color-rgb,197,164,126),.35);margin-bottom:14px;}' +
            '.pd-now-label{font-size:11px;letter-spacing:2px;color:var(--accent-color,#c5a47e);font-weight:700;text-transform:uppercase;}' +
            '.pd-now-act{font-size:19px;font-weight:800;color:var(--text-primary,#333);margin-top:6px;line-height:1.35;word-break:break-word;}' +
            '.pd-now-loc{font-size:12.5px;color:var(--text-secondary,#888);margin-top:6px;display:flex;align-items:center;gap:6px;}' +
            '.pd-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}' +
            '.pd-date{font-size:12px;color:var(--text-secondary,#999);}' +
            '.pd-tl{position:relative;padding-left:46px;}' +
            '.pd-tl::before{content:"";position:absolute;left:17px;top:6px;bottom:14px;width:2px;background:var(--border-color,#e8e8e8);border-radius:2px;}' +
            '.pd-item{position:relative;margin-bottom:10px;border-radius:14px;padding:12px 14px;border:1px solid var(--border-color,#ececec);background:var(--primary-bg,transparent);}' +
            '.pd-item.past{opacity:.55;}' +
            '.pd-item.cur{border-color:var(--accent-color,#c5a47e);background:rgba(var(--accent-color-rgb,197,164,126),.10);box-shadow:0 4px 16px rgba(var(--accent-color-rgb,197,164,126),.16);}' +
            '.pd-dot{position:absolute;left:-37px;top:14px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;background:var(--secondary-bg,#ccc);}' +
            '.pd-item.cur .pd-dot{background:var(--accent-color,#c5a47e);box-shadow:0 0 0 4px rgba(var(--accent-color-rgb,197,164,126),.20);}' +
            '.pd-time{font-size:11.5px;font-weight:700;color:var(--text-secondary,#999);font-variant-numeric:tabular-nums;letter-spacing:.3px;}' +
            '.pd-item.cur .pd-time{color:var(--accent-color,#c5a47e);}' +
            '.pd-act{font-size:15px;font-weight:700;color:var(--text-primary,#333);margin-top:4px;line-height:1.4;word-break:break-word;}' +
            '.pd-loc{font-size:12px;color:var(--text-secondary,#888);margin-top:5px;display:flex;align-items:center;gap:5px;}' +
            '.pd-badge{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;font-size:10px;line-height:16px;background:var(--accent-color,#c5a47e);color:#fff;font-weight:700;vertical-align:middle;}' +
            '.pd-edit-item{border:1px dashed var(--border-color,#ddd);border-radius:12px;padding:10px 12px;margin-bottom:10px;}' +
            '.pd-input{width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border-color,#ddd);border-radius:9px;font-size:12.5px;background:var(--primary-bg,transparent);color:var(--text-primary,#333);outline:none;font-family:var(--font-family,inherit);}' +
            '.pd-input:focus{border-color:var(--accent-color,#c5a47e);}' +
            '.pd-row{display:flex;gap:8px;align-items:center;margin-top:8px;}' +
            '.pd-lb{font-size:11px;color:var(--text-secondary,#999);flex:0 0 auto;width:44px;}' +
            '.pd-empty{padding:26px 10px;text-align:center;font-size:12.5px;color:var(--text-secondary,#999);}';
        document.head.appendChild(st);

        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'partner-day-modal';
        m.style.zIndex = '3200';
        m.innerHTML =
            '<div class="modal-content">' +
                '<div class="modal-title" style="flex-shrink:0;"><i class="fas fa-clock"></i><span>他今天做了什么</span></div>' +
                '<div class="pd-head">' +
                    '<span class="pd-date" id="pd-date"></span>' +
                    '<button type="button" id="pd-edit-btn" style="padding:5px 12px;border:1px solid var(--border-color,#ddd);border-radius:9px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;font-family:inherit;"><i class="fas fa-pen"></i> 编辑</button>' +
                '</div>' +
                '<div class="pd-scroll" id="pd-scroll">' +
                    '<div id="pd-body"></div>' +
                '</div>' +
                '<div class="modal-buttons" style="margin:0;padding:10px 0 0;border-top:1px solid var(--border-color,#e8e8e8);flex-shrink:0;">' +
                    '<button type="button" class="modal-btn modal-btn-secondary" id="pd-close" style="flex:1;">关闭</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(m);

        m.querySelector('#pd-close').addEventListener('click', close);
        m.addEventListener('click', function (e) { if (e.target === m) close(); });
        m.querySelector('#pd-edit-btn').addEventListener('click', function () {
            _editing = !_editing;
            render();
        });
    }

    function close() {
        _editing = false;
        var m = document.getElementById('partner-day-modal');
        if (m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
    }

    // ─── 只读视图（时间轴） ───
    function renderView(d) {
        var nm = nowMin();
        var day = todayKey();
        var dateEl = document.getElementById('pd-date');
        var n = new Date();
        var week = ['日', '一', '二', '三', '四', '五', '六'];
        if (dateEl) dateEl.textContent = (n.getMonth() + 1) + '月' + n.getDate() + '日 周' + week[n.getDay()] + ' · 共 ' + d.slots.length + ' 个时段';

        var cur = currentSlot(d, nm);
        var curInfo = cur ? resolveSlot(cur, day) : null;

        var html = '';
        if (cur && curInfo) {
            html += '<div class="pd-now-card">' +
                '<div class="pd-now-label">现在</div>' +
                '<div class="pd-now-act">' + esc(curInfo.act || '（「他在做什么」字卡组是空的）') + '</div>' +
                '<div class="pd-now-loc"><i class="fas fa-location-dot"></i>' + esc(curInfo.loc || '（地点待补充）') +
                '<span style="opacity:.6;">· ' + esc(fmtRange(cur)) + '</span></div>' +
                '</div>';
        }

        if (!d.slots.length) {
            html += '<div class="pd-empty">还没有任何时段<br>点右上角「编辑」加一个吧</div>';
            return html;
        }

        var sorted = d.slots.slice().sort(function (a, b) {
            var x = parseHM(a.start); var y = parseHM(b.start);
            return (x == null ? 9999 : x) - (y == null ? 9999 : y);
        });

        html += '<div class="pd-tl">';
        sorted.forEach(function (s) {
            var info = resolveSlot(s, day);
            var isCur = inSlot(s, nm);
            var a = parseHM(s.start), b = parseHM(s.end);
            var isPast = false;
            if (!isCur && a != null && b != null && b > a) isPast = nm >= b;
            else if (!isCur && a != null && b != null && b <= a) isPast = (nm >= b && nm < a);

            html += '<div class="pd-item' + (isCur ? ' cur' : (isPast ? ' past' : '')) + '">' +
                '<span class="pd-dot"><i class="fas ' + esc(s.icon || 'fa-clock') + '"></i></span>' +
                '<div class="pd-time">' + esc(fmtRange(s)) + (isCur ? '<span class="pd-badge">现在</span>' : '') + '</div>' +
                '<div class="pd-act">' + esc(info.act || '（「他在做什么」字卡组是空的）') + '</div>' +
                '<div class="pd-loc"><i class="fas fa-location-dot"></i>' + esc(info.loc || '（地点待补充）') + '</div>' +
                '</div>';
        });
        html += '</div>';
        return html;
    }

    // ─── 编辑视图 ───
    function renderEdit(d) {
        var html = '<div style="font-size:11.5px;color:var(--text-secondary,#999);line-height:1.7;margin-bottom:10px;">' +
            '「他在做什么」统一从字卡组随机抽 —— 改字卡走：自定义回复 → 氛围感配置 → <b>他在做什么</b>，' +
            '不用在这儿一个个时段写。<br>' +
            '这里只排<b>时间段</b>和<b>在哪</b>；「在哪」每行一条，每天随机抽一条（同一天内不变）。' +
            '最后一个时段可以跨零点（比如 23:30 – 06:30）。</div>';

        d.slots.forEach(function (s, idx) {
            html += '<div class="pd-edit-item" data-idx="' + idx + '">' +
                '<div class="pd-row" style="margin-top:0;">' +
                    '<span class="pd-lb">时间</span>' +
                    '<input type="time" class="pd-input pd-e-start" value="' + esc(s.start) + '" style="flex:1;">' +
                    '<span style="color:var(--text-secondary,#999);font-size:12px;">–</span>' +
                    '<input type="time" class="pd-input pd-e-end" value="' + esc(s.end) + '" style="flex:1;">' +
                '</div>' +
                '<div class="pd-row">' +
                    '<span class="pd-lb">图标</span>' +
                    '<select class="pd-input pd-e-icon" style="flex:1;">' +
                        ICONS.map(function (ic) {
                            return '<option value="' + ic.id + '"' + (ic.id === s.icon ? ' selected' : '') + '>' + ic.label + '</option>';
                        }).join('') +
                    '</select>' +
                '</div>' +
                '<div style="margin-top:8px;font-size:11px;color:var(--text-secondary,#999);">在哪（每行一条）</div>' +
                '<textarea class="pd-input pd-e-locs" rows="2" style="margin-top:5px;resize:vertical;line-height:1.6;">' + esc((s.locs || []).join('\n')) + '</textarea>' +
                '<div class="pd-row" style="justify-content:flex-end;">' +
                    '<button type="button" class="pd-del" data-idx="' + idx + '" style="padding:5px 12px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;background:transparent;color:#e53935;cursor:pointer;font-family:inherit;"><i class="fas fa-trash-can"></i> 删除时段</button>' +
                '</div>' +
                '</div>';
        });

        html += '<button type="button" id="pd-add-slot" style="width:100%;margin:2px 0 10px;padding:9px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12.5px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;font-family:inherit;"><i class="fas fa-plus"></i> 添加时间段</button>' +
            '<button type="button" id="pd-reset" style="width:100%;margin-bottom:4px;padding:9px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;font-family:inherit;"><i class="fas fa-rotate-left"></i> 恢复默认安排</button>';
        return html;
    }

    function render() {
        var body = document.getElementById('pd-body');
        if (!body) return;
        var d = load();
        var btn = document.getElementById('pd-edit-btn');
        if (btn) btn.innerHTML = _editing
            ? '<i class="fas fa-check"></i> 完成'
            : '<i class="fas fa-pen"></i> 编辑';

        if (_editing) {
            body.innerHTML = renderEdit(d);
            bindEdit(body);
            return;
        }

        body.innerHTML = renderView(d);

        // 打开时滚到"现在"那一条，省得每次手动找
        var scroll = document.getElementById('pd-scroll');
        var curEl = body.querySelector('.pd-item.cur');
        if (scroll && curEl) {
            setTimeout(function () {
                try { scroll.scrollTop = Math.max(0, curEl.offsetTop - 70); } catch (e) {}
            }, 60);
        }
    }

    function bindEdit(body) {
        // 任意输入变化就存（失焦/改变时）
        function commit() {
            var d = load();
            var items = body.querySelectorAll('.pd-edit-item');
            var next = [];
            items.forEach(function (it) {
                var idx = parseInt(it.getAttribute('data-idx'), 10);
                var src = d.slots[idx];
                if (!src) return;
                var locs = (it.querySelector('.pd-e-locs').value || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
                next.push({
                    id: src.id,
                    start: it.querySelector('.pd-e-start').value || src.start,
                    end: it.querySelector('.pd-e-end').value || src.end,
                    icon: it.querySelector('.pd-e-icon').value || src.icon,
                    locs: locs.length ? locs : ['']
                });
            });
            d.slots = next;
            save(d);
        }

        body.querySelectorAll('.pd-e-start, .pd-e-end, .pd-e-icon').forEach(function (el) {
            el.addEventListener('change', function () { commit(); render(); });
        });
        body.querySelectorAll('.pd-e-locs').forEach(function (el) {
            el.addEventListener('blur', function () { commit(); });
        });
        body.querySelectorAll('.pd-del').forEach(function (el) {
            el.addEventListener('click', function () {
                commit();
                var idx = parseInt(el.getAttribute('data-idx'), 10);
                var d = load();
                if (d.slots.length <= 1) {
                    if (typeof showNotification === 'function') showNotification('至少留一个时间段', 'warning', 2000);
                    return;
                }
                var name = fmtRange(d.slots[idx]);
                if (!confirm('删除这个时间段？（' + name + '）')) return;
                d.slots.splice(idx, 1);
                save(d);
                render();
            });
        });
        var addBtn = body.querySelector('#pd-add-slot');
        if (addBtn) addBtn.addEventListener('click', function () {
            commit();
            var d = load();
            d.slots.push({
                id: 'pd_' + Date.now(),
                start: '09:00', end: '10:00', icon: 'fa-clock',
                locs: ['家']
            });
            save(d);
            render();
        });
        var resetBtn = body.querySelector('#pd-reset');
        if (resetBtn) resetBtn.addEventListener('click', function () {
            if (!confirm('恢复成默认的一天安排？当前设置会被覆盖')) return;
            save({ slots: defaultSlots() });
            render();
        });
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function open() {
        buildModal();
        _editing = false;
        render();
        var m = document.getElementById('partner-day-modal');
        if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'partnerDay', 3);
            }
        } catch (e) {}
        // 页面开着的时候，每 60 秒刷新一次"现在"（跨过时段边界时自动跳）
        clearInterval(_tickTimer);
        _tickTimer = setInterval(function () {
            var modal = document.getElementById('partner-day-modal');
            if (!modal || modal.style.display === 'none' || !_isModalVisible(modal)) {
                clearInterval(_tickTimer); _tickTimer = null; return;
            }
            if (!_editing) render();
        }, 60000);
    }

    function _isModalVisible(m) {
        var cs = window.getComputedStyle ? getComputedStyle(m) : null;
        return !cs || (cs.display !== 'none' && cs.visibility !== 'hidden');
    }

    var _tickTimer = null;

    // ─── 聊天里说「他在干嘛」也能打开 ───
    function maybeOpenFromChat(msg) {
        try {
            if (!msg || msg.sender !== 'user' || msg.type !== 'normal') return;
            var t = String(msg.text || '').trim();
            if (!t) return;
            if (/^(他在干嘛|他在干什么|他在做什么|他今天做了什么|今天他做了什么)[\s!！。～~?？]*$/.test(t)) {
                setTimeout(open, 120);
            }
        } catch (e) {}
    }

    function wrapUserHook() {
        var prev = window._onUserMessage;
        window._onUserMessage = function (m) {
            try { maybeOpenFromChat(m); } catch (e) {}
            if (typeof prev === 'function') { try { prev(m); } catch (e2) {} }
        };
    }

    function init() {
        var adv = document.getElementById('partner-day-function');
        if (adv) adv.addEventListener('click', open);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { init(); setTimeout(wrapUserHook, 0); });
    } else {
        setTimeout(function () { init(); wrapUserHook(); }, 60);
    }

    window.PartnerDay = {
        open: open,
        load: load,
        defaultSlots: defaultSlots,
        getCurrent: function () {
            var d = load();
            var s = currentSlot(d, nowMin());
            if (!s) return null;
            var info = resolveSlot(s, todayKey());
            return { slot: s, act: info.act, loc: info.loc, range: fmtRange(s) };
        }
    };
})();
