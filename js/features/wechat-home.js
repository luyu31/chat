/* ────────────────────────────────────────────────────────────────
 * 微信式首页 · 会话列表 + 底部标签
 *
 * 目标：点开 App 第一眼是"微信那样的一页" —— 上面是会话列表（每个梦角一条，
 * 带头像、名字、最后一条消息、时间），下面是「聊天 / 朋友圈」两个标签。
 * 点某一条 → 进他的聊天；聊天头部有返回键 → 回到这一页。
 *
 * 数据来源仍然是 App 自己的 session 机制：每个梦角一条会话，
 * 名字/头像/聊天记录分别存在 `${APP_PREFIX}${sessionId}_chatSettings / _partnerAvatar / _chatMessages`。
 *
 * 切换梦角时（切到"不是当前这条"的会话）依旧走 hash + reload —— 数据是按 session 存的，
 * 整页重开才最安全。但重开之后不能又回到首页（那就不像"点进去聊天"了），
 * 所以切换前往 sessionStorage 写一个标记，启动时看到标记就直接进聊天。
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var FLAG = 'wxEnterAfterSwitch';   // '1' = 下次启动直接进聊天，不显示首页

    function _prefix() {
        return (typeof APP_PREFIX !== 'undefined' && APP_PREFIX) ? APP_PREFIX : 'CHAT_APP_V3_';
    }
    function _sessions() {
        try { return (typeof sessionList !== 'undefined' && Array.isArray(sessionList)) ? sessionList : []; }
        catch (e) { return []; }
    }
    function _currentId() {
        try { return (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : ''; }
        catch (e) { return ''; }
    }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    // 相对时间，微信那种：刚刚 / 12:30 / 昨天 / 周三 / 10月19日
    function _relTime(ts) {
        if (!ts) return '';
        var d = new Date(ts), now = new Date();
        var sameDay = d.toDateString() === now.toDateString();
        var hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        if (sameDay) return hhmm;
        var yest = new Date(now.getTime() - 86400000);
        if (d.toDateString() === yest.toDateString()) return '昨天';
        if (now.getTime() - ts < 7 * 86400000) {
            return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
        }
        return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function _avatarHtml(avatar, size) {
        var s = size || 48;
        if (avatar) {
            return '<img src="' + _esc(avatar) + '" style="width:' + s + 'px;height:' + s + 'px;border-radius:8px;object-fit:cover;display:block;flex-shrink:0;">';
        }
        return '<span style="width:' + s + 'px;height:' + s + 'px;border-radius:8px;background:var(--border-color,#d8d8d8);' +
            'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
            '<i class="fas fa-user" style="font-size:' + Math.round(s * 0.44) + 'px;color:var(--text-secondary,#aaa);"></i></span>';
    }

    // 一条会话的摘要信息
    async function _convMeta(s) {
        var p = _prefix();
        var recName = s.name || '';
        // 会话列表里的名字若是用户自己起的（不是系统默认的"会话 日期"），就以它为准；
        // 否则再看这个会话自己的 chatSettings。这样即使旧数据被污染过，列表也不会全都同名。
        var userNamed = recName && recName.indexOf('会话 ') !== 0;
        var name = userNamed ? recName : '未命名';
        var avatar = null, preview = '', time = 0;
        try {
            var st = await localforage.getItem(p + s.id + '_chatSettings');
            if (!userNamed && st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
            if (userNamed && (!st || !st.partnerName)) name = recName;
        } catch (e) {}
        try { avatar = await localforage.getItem(p + s.id + '_partnerAvatar'); } catch (e) {}
        try {
            var msgs = await localforage.getItem(p + s.id + '_chatMessages');
            if (Array.isArray(msgs) && msgs.length) {
                for (var i = msgs.length - 1; i >= 0; i--) {
                    var m = msgs[i];
                    if (!m || m.type === 'system') continue;
                    if (!(m.text || m.voice || m.image)) continue;
                    time = m.timestamp ? new Date(m.timestamp).getTime() : 0;
                    if (m.voice) preview = '[语音]';
                    else if (m.image) preview = '[图片]';
                    else preview = String(m.text || '');
                    break;
                }
            }
        } catch (e) {}
        return { id: s.id, name: name, avatar: avatar, preview: preview, time: time, isCurrent: s.id === _currentId(), isGroup: s.type === 'group' };
    }

    // ─── 切换过场：跨越"整页重载"保持连续，别让人看到白屏和开场动画 ───
    function showSwitchOverlay(name) {
        var el = document.getElementById('ct-switch-overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ct-switch-overlay';
            document.body.appendChild(el);
        }
        el.innerHTML = '<div class="ct-switch-box"><div class="ct-switch-spin"></div>' +
            '<div class="ct-switch-txt">正在进入 ' + _esc(name || '梦角') + '…</div></div>';
        void el.offsetWidth;
        el.classList.add('on');
    }
    function hideSwitchOverlay() {
        var el = document.getElementById('ct-switch-overlay');
        if (el) el.classList.remove('on');
    }

    // 聊天渲染好了没？（用来决定什么时候把过场收掉）
    // renderMessages 跑过就是 App 把数据加载完并渲染完的可靠信号（cinema.js 用的也是这一招），
    // 比单纯看"消息容器里有没有子节点"更准 —— 新梦角一条消息都没有时也不会白等
    var _rendered = false;
    (function hookRender(retry) {
        if (typeof window.renderMessages !== 'function') {
            if ((retry || 0) < 60) setTimeout(function () { hookRender((retry || 0) + 1); }, 50);
            return;
        }
        if (window.renderMessages._wxHooked) return;
        var orig = window.renderMessages;
        var wrapped = function () {
            _rendered = true;
            if (!_prefetchedOnce) { _prefetchedOnce = true; prefetchAll(); }  // 数据一就绪就开始预读
            return orig.apply(this, arguments);
        };
        wrapped._wxHooked = true;
        window.renderMessages = wrapped;
    })();

    function _chatReady() {
        if (_rendered) return true;
        var box = document.querySelector('.chat-container') || document.getElementById('messages-container');
        if (!box) return false;
        var inner = box.querySelector('#messages-container') || box;
        return inner.children && inner.children.length > 0;
    }

    // ─── 会话内存缓存：为了"零等待"切换 ───
    // 每个梦角的聊天记录/设置先预读进内存。切的时候直接从内存赋值、立刻渲染，
    // 存储的读写全部丢到后台 —— 点下去的那一帧就已经是新梦角的聊天了。
    var _cache = {};         // id → { messages, settings, avatar, background }
    var _prefetching = {};   // id → 正在进行的预读 Promise（并发调用必须等同一个，不能拿到 null）
    var _prefetchedOnce = false;

    function _cacheCurrent() {
        try {
            var id = _currentId();
            if (!id) return;
            var bg = null;
            try { bg = localStorage.getItem(_prefix() + id + '_chatBackground'); } catch (e) {}
            _cache[id] = {
                messages: (typeof messages !== 'undefined' && Array.isArray(messages)) ? messages.slice() : [],
                settings: (typeof settings !== 'undefined' && settings) ? JSON.parse(JSON.stringify(settings)) : null,
                avatar: (window._avatarCache && window._avatarCache.partner) || null,
                background: bg || null
            };
        } catch (e) {}
    }

    function _prefetchSession(id) {
        if (_cache[id]) return Promise.resolve(_cache[id]);
        // 之前这里在"已经在预读"时直接返回 null，调用方就会拿着上一位梦角的
        // settings/messages 继续渲染 —— 表现就是"点新角色还是原来那位"。
        // 现在把同一个 Promise 交出去，等它读完再切。
        if (_prefetching[id]) return _prefetching[id];
        var p = _prefix();
        var job = Promise.all([
            localforage.getItem(p + id + '_chatMessages'),
            localforage.getItem(p + id + '_chatSettings'),
            localforage.getItem(p + id + '_partnerAvatar'),
            localforage.getItem(p + id + '_chatBackground')
        ]).then(function (res) {
            var msgs = Array.isArray(res[0]) ? res[0].map(function (m) {
                return Object.assign({}, m, { timestamp: new Date(m.timestamp) });
            }) : [];
            _cache[id] = {
                messages: msgs,
                settings: res[1] || null,
                avatar: res[2] || null,
                background: res[3] || null
            };
            delete _prefetching[id];
            return _cache[id];
        }).catch(function () {
            _cache[id] = { messages: [], settings: null, avatar: null, background: null };
            delete _prefetching[id];
            return _cache[id];
        });
        _prefetching[id] = job;
        return job;
    }

    // 把所有会话预读一遍。并发读（IndexedDB 读很快），不再一个个排队等 120ms ——
    // 这样刚打开 App 就想切也会命中缓存，不会出现"第一次慢一下"。
    function prefetchAll() {
        var list = [];
        try { list = _sessions(); } catch (e) { return; }
        list.forEach(function (s) {
            if (_cache[s.id] || _prefetching[s.id]) return;
            _prefetchSession(s.id).catch(function () {});
        });
    }

    // 关掉「减少动画」的人：切换时连过场都不给看 —— 不转圈、不淡入，点一下直接到位
    function _instantSwitch() {
        try { return !!(window._reduceMotionAll && window._reduceMotionAll()); } catch (e) { return false; }
    }

    // 切换：原地换会话，不重载页面
    // 之前是 hash+reload，所以每点一个梦角都像"重新打开一次软件"。
    // 现在改成：把当前会话存好 → 换 SESSION_ID → 重新加载该会话的数据 → 重画。
    // 关键点是"存好再换"：否则切换前那个 500ms 延时保存会拿旧数据写进新会话，
    // 表现就是"新加的角色显示的却是上一个角色的名字"。
    async function switchToSession(id, name) {
        if (!id) return;

        if (id === _currentId()) {
            // 已经"名义上"是这一位了。但如果数据并没有真正换过来（之前预读没完成就会这样），
            // 这里不能直接进聊天 —— 否则屏幕上留着的还是上一位的聊天记录，再点也永远修不好。
            if (window._loadedSessionId === id) { enterChat(); return; }
            var instant0 = _instantSwitch();
            if (!instant0) showSwitchOverlay(name);
            try {
                var fix = (typeof loadData === 'function') ? loadData() : null;
                Promise.resolve(fix).then(function () {
                    if (_currentId() !== id) return;
                    try { if (typeof window.renderMessages === 'function') window.renderMessages(); } catch (e) {}
                    try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (e) {}
                    window._loadedSessionId = id;
                    if (!instant0) hideSwitchOverlay();
                }).catch(function () { if (!instant0) hideSwitchOverlay(); });
            } catch (e) { if (!instant0) hideSwitchOverlay(); }
            enterChat();
            return;
        }

        var instant = _instantSwitch();
        if (!instant) {
            showSwitchOverlay(name);
            await new Promise(r => setTimeout(r, 60));   // 让过场先画出来一帧
        }

        // 先把当前进度收进内存缓存（同步，不碰存储 → 不拖慢点击）
        _cacheCurrent();

        // 目标会话：内存里有就直接用（预读过的），没有就现场读（只有第一次会见效）
        var tgt = _cache[id] || await _prefetchSession(id);

        // 后台落盘 + 记住当前会话（全部异步，不阻塞切换）
        (function () {
            try { if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout); } catch (e) {}
            try {
                var pr = (typeof saveData === 'function') ? saveData() : null;
                if (pr && pr.catch) pr.catch(function () {});
            } catch (e) {}
            try { localforage.setItem(_prefix() + 'lastSessionId', id).catch(function () {}); } catch (e) {}
        })();

        try {
            // ① 换会话号（同步）
            SESSION_ID = id;
            try { history.replaceState(null, '', '#' + id); } catch (e) {}

            // ② 直接改成内存里的数据 —— 这一步是同步的，所以点下去立刻就是新梦角的聊天
            // 注意：新角色（或任何还没存过设置的会话）必须从默认设置起步，
            // 不能拿上一位的 settings 去 merge，否则状态/签名/主题都会继承过来。
            if (tgt) {
                try {
                    if (Array.isArray(tgt.messages)) messages = tgt.messages.slice();
                    var baseSettings = (typeof window.getDefaultSettings === 'function')
                        ? window.getDefaultSettings()
                        : settings;
                    settings = Object.assign({}, baseSettings, (tgt.settings && typeof tgt.settings === 'object') ? tgt.settings : {});
                    window._loadedSessionId = id;
                } catch (e) {}
            }

            // ③ 立刻重画
            if (typeof window.renderMessages === 'function') window.renderMessages();
            if (typeof window.updateUI === 'function') { try { window.updateUI(); } catch (e) {} }

            // ③b 名字以这个会话自己的存档为准，绝不显示上一个角色的名字
            try {
                var rec = _sessions().filter(function (s) { return s.id === id; })[0];
                var wantName = (rec && rec.name && rec.name.indexOf('会话 ') !== 0) ? rec.name
                             : (tgt && tgt.settings && tgt.settings.partnerName) ? tgt.settings.partnerName
                             : (rec && rec.name) ? rec.name : name;
                if (wantName) {
                    if (typeof settings !== 'undefined' && settings) settings.partnerName = wantName;
                    var nEl0 = document.getElementById('partner-name');
                    if (nEl0) nEl0.textContent = wantName;
                    // 名字也写回这个会话自己的存档（后台写）
                    try {
                        var key = _prefix() + id + '_chatSettings';
                        localforage.getItem(key).then(function (st) {
                            st = st || {};
                            if (st.partnerName !== wantName) { st.partnerName = wantName; return localforage.setItem(key, st); }
                        }).catch(function () {});
                    } catch (e) {}
                }
            } catch (e) {}

            // ④ 头像 + 背景：必须用目标会话自己的，不能用 _avatarCache 里上一位的
            try {
                var av = tgt ? (tgt.avatar || null) : null;
                if (!window._avatarCache) window._avatarCache = {};
                window._avatarCache.partner = av;
                var host = (typeof DOMElements !== 'undefined' && DOMElements.partner) ? DOMElements.partner.avatar : null;
                if (host) {
                    host.innerHTML = av
                        ? '<img src="' + av + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                        : '<i class="fas fa-user"></i>';
                }
                if (typeof window.applyBackground === 'function') {
                    var bg = tgt ? (tgt.background || null) : null;
                    if (!bg) {
                        try { bg = localStorage.getItem(_prefix() + id + '_chatBackground'); } catch (e) {}
                    }
                    window.applyBackground(bg || '');
                }
            } catch (e) {}

            enterChat();

            // ⑤ 后台补齐：把那些"按会话存数据"的模块唤醒（晚一点做，不抢渲染）
            setTimeout(function () {
                try {
                    if (typeof loadData === 'function') {
                        var pr2 = loadData();
                        if (pr2 && pr2.then) {
                            pr2.then(function () {
                                // loadData 只更新内存，不会重画消息；上面如果因为预读失败留下了
                                // 上一位的 DOM，这里必须用新数据再渲染一次。
                                if (_currentId() !== id) return;
                                try { if (typeof window.renderMessages === 'function') window.renderMessages(); } catch (e) {}
                                try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (e) {}
                                window._loadedSessionId = id;
                            }).catch(function () {});
                        } else if (pr2 && pr2.catch) {
                            pr2.catch(function () {});
                        }
                    }
                } catch (e) {}
                try { window.dispatchEvent(new CustomEvent('session:switched', { detail: { id: id, name: name } })); } catch (e) {}
                try { if (typeof window._groupSyncNow === 'function') window._groupSyncNow(); } catch (e) {}
                try { if (window.Timezone && window.Timezone.refresh) window.Timezone.refresh(); } catch (e) {}
            }, 30);

            // 再把切过去的这一位也缓存起来（下次切回来零等待）
            setTimeout(function () {
                var bg2 = null;
                try { bg2 = localStorage.getItem(_prefix() + id + '_chatBackground'); } catch (e) {}
                _cache[id] = {
                    messages: messages.slice(),
                    settings: JSON.parse(JSON.stringify(settings)),
                    avatar: (window._avatarCache && window._avatarCache.partner) || null,
                    background: bg2 || null
                };
            }, 120);

            if (!instant && typeof showNotification === 'function' && name) {
                showNotification('已切换到 ' + name, 'info', 1000);
            }
        } catch (e) {
            console.warn('[wx-home] 原地切换失败，退回重载', e);
            try {
                sessionStorage.setItem(FLAG, '1');
                sessionStorage.setItem('wxSwitchName', name || '梦角');
                sessionStorage.setItem('wxFastBoot', '1');
                window.location.hash = id;
                window.location.reload();
                return;
            } catch (e2) {}
        }
        if (!instant) hideSwitchOverlay();
    }

    // ─── 「朋友圈」：先看所有人的动态（微信式封面），点某个人的头像才进他个人的朋友圈 ───
    function openAllMoments() {
        try {
            if (typeof window._mShowMomentsHome === 'function') { window._mShowMomentsHome(); return; }
            if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
            else if (typeof window.openCoupleSpace === 'function') window.openCoupleSpace();
        } catch (e) { console.warn('[wx-home] 打开家园失败', e); }
    }
    function openOwnerMoments() {
        enterChat();
        try {
            if (typeof window._mShowOwner === 'function') { window._mShowOwner(); return; }
            if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
            else if (typeof window.openCoupleSpace === 'function') window.openCoupleSpace();
        } catch (e) { console.warn('[wx-home] 打开家园失败', e); }
    }

    function openMomentsPicker() {
        var old = document.getElementById('wx-mp');
        if (old) old.remove();
        var sessions = _sessions();
        var el = document.createElement('div');
        el.id = 'wx-mp';
        el.innerHTML =
            '<div class="wx-mp-sheet">' +
                '<div class="wx-mp-title">看谁的朋友圈</div>' +
                '<div class="wx-mp-list" id="wx-mp-list"><div class="wx-mp-loading">加载中…</div></div>' +
                '<button class="wx-mp-cancel" id="wx-mp-cancel">取消</button>' +
            '</div>';
        document.body.appendChild(el);
        void el.offsetWidth;
        el.classList.add('on');

        el.querySelector('#wx-mp-cancel').addEventListener('click', function () {
            el.classList.remove('on');
            setTimeout(function () { el.remove(); }, 200);
        });
        // 点空白处也能关
        el.addEventListener('click', function (e) {
            if (e.target === el) { el.classList.remove('on'); setTimeout(function () { el.remove(); }, 200); }
        });

        var list = el.querySelector('#wx-mp-list');
        Promise.all(sessions.map(_convMeta)).then(function (metas) {
            metas.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
            list.innerHTML = metas.map(function (m) {
                return '<div class="wx-mp-row' + (m.isCurrent ? ' wx-mp-row--cur' : '') + '" data-id="' + _esc(m.id) + '" data-name="' + _esc(m.name) + '">' +
                    _avatarHtml(m.avatar, 40) +
                    '<div class="wx-mp-name">' + _esc(m.name) + '</div>' +
                    (m.isCurrent ? '<span class="wx-mp-tag">当前</span>' : '<i class="fas fa-chevron-right wx-mp-arrow"></i>') +
                '</div>';
            }).join('');
            list.addEventListener('click', function (e) {
                var row = e.target.closest('.wx-mp-row');
                if (!row) return;
                var id = row.getAttribute('data-id');
                var nm = row.getAttribute('data-name');
                el.classList.remove('on');
                setTimeout(function () { el.remove(); }, 200);
                if (id === _currentId()) { openOwnerMoments(); return; }
                // 换一个梦角看他的朋友圈：切过去，并且到了之后直接进家园
                try { sessionStorage.setItem('wxOpenMoments', '1'); } catch (e2) {}
                setTimeout(function () { switchToSession(id, nm); }, 180);
            });
        });
    }

    // 点头部那些原有按钮（它们都在，只是被我从视野里"藏"进了发现页）
    function _click(id) {
        var el = document.getElementById(id);
        if (el) { try { el.click(); return true; } catch (e) {} }
        if (typeof showNotification === 'function') showNotification('这个功能还没就绪', 'warning');
        return false;
    }
    // 朋友圈入口：直接进"所有人混在一起"的那条流（不再先问看谁）
    function _momentsEntry() {
        openAllMoments();
    }

    // 今日公告是"按人"的：多个梦角时先选看谁，再打开他今天的公告
    function openDailyGreetingPicker() {
        var list = _sessions();
        if (list.length <= 1) { _click('daily-greeting-btn'); return; }
        openPersonPicker('看谁的今日公告', function () {
            setTimeout(function () { _click('daily-greeting-btn'); }, 120);
        });
    }

    // 通用「选个人」面板：给"今日公告"这种需要区分是谁的功能用
    async function openPersonPicker(title, onPick) {
        var old = document.getElementById('wx-pp');
        if (old) old.remove();
        var sessions = _sessions();
        var metas = await Promise.all(sessions.map(_convMeta));
        var el = document.createElement('div');
        el.id = 'wx-pp';
        el.innerHTML =
            '<div class="wx-mp-sheet">' +
                '<div class="wx-mp-title">' + _esc(title || '选一个人') + '</div>' +
                '<div class="wx-mp-list" id="wx-pp-list">' + metas.map(function (m) {
                    return '<div class="wx-mp-row' + (m.isCurrent ? ' wx-mp-row--cur' : '') + '" data-id="' + _esc(m.id) + '" data-name="' + _esc(m.name) + '">' +
                        _avatarHtml(m.avatar, 40) +
                        '<div class="wx-mp-name">' + _esc(m.name) + '</div>' +
                        (m.isCurrent ? '<span class="wx-mp-tag">当前</span>' : '<i class="fas fa-chevron-right wx-mp-arrow"></i>') +
                    '</div>';
                }).join('') + '</div>' +
                '<button class="wx-mp-cancel" id="wx-pp-cancel">取消</button>' +
            '</div>';
        document.body.appendChild(el);
        void el.offsetWidth;
        el.classList.add('on');
        function close() { el.classList.remove('on'); setTimeout(function () { el.remove(); }, 200); }
        el.querySelector('#wx-pp-cancel').addEventListener('click', close);
        el.addEventListener('click', function (e) { if (e.target === el) close(); });
        el.querySelector('#wx-pp-list').addEventListener('click', function (e) {
            var row = e.target.closest('.wx-mp-row');
            if (!row) return;
            var id = row.getAttribute('data-id');
            var nm = row.getAttribute('data-name');
            close();
            if (id !== _currentId()) {
                try {
                    var pr = switchToSession(id, nm);
                    var run = function () { setTimeout(function () { try { onPick && onPick(id, nm); } catch (err) {} }, 80); };
                    if (pr && typeof pr.then === 'function') pr.then(run); else run();
                } catch (err) {}
            } else {
                try { onPick && onPick(id, nm); } catch (err) {}
            }
        });
    }

    // 底部标签切换：聊天列表 / 发现
    function _setTab(tab) {
        var list = document.getElementById('wx-conv-list');
        var disc = document.getElementById('wx-discover');
        var tChat = document.getElementById('wx-tab-chat');
        var tDisc = document.getElementById('wx-tab-discover');
        var isChat = tab !== 'discover';
        if (list) list.style.display = isChat ? '' : 'none';
        // 注意：必须用 grid，之前写成 flex 会把网格布局打散，图标被压成"细长条"
        if (disc) disc.style.display = isChat ? 'none' : 'grid';
        if (tChat) tChat.classList.toggle('wx-tab--on', isChat);
        if (tDisc) tDisc.classList.toggle('wx-tab--on', !isChat);
    }

    // ─── 统一信箱：把**所有梦角**的信汇总到一处（这才是"集中收多个人的信"） ───
    async function openUnifiedInbox() {
        var old = document.getElementById('wx-inbox');
        if (old) old.remove();
        var el = document.createElement('div');
        el.id = 'wx-inbox';
        el.innerHTML =
            '<div class="ct-d-sheet" style="max-height:86vh;">' +
                '<div class="wx-mp-title">信箱 · 所有人的信</div>' +
                '<div class="wx-inbox-list" id="wx-inbox-list"><div class="wx-mp-loading">正在收信…</div></div>' +
                '<button class="ct-d-cancel" id="wx-inbox-close" style="margin:10px 16px 14px;">关闭</button>' +
            '</div>';
        document.body.appendChild(el);
        void el.offsetWidth;
        el.classList.add('on');
        function close() { el.classList.remove('on'); setTimeout(function () { el.remove(); }, 200); }
        el.querySelector('#wx-inbox-close').addEventListener('click', close);
        el.addEventListener('click', function (e) { if (e.target === el) close(); });

        var p = _prefix();
        var sessions = _sessions();
        var all = [];
        for (var i = 0; i < sessions.length; i++) {
            var s = sessions[i];
            var data = null;
            try { data = await localforage.getItem(p + s.id + '_envelopeData'); } catch (e) {}
            if (!data || typeof data !== 'object') continue;
            var nm = s.name || '梦角';
            try {
                var st = await localforage.getItem(p + s.id + '_chatSettings');
                if (st && st.partnerName && String(st.partnerName).trim()) nm = st.partnerName;
            } catch (e) {}
            (data.inbox || []).forEach(function (L) {
                all.push({ kind: 'in', from: nm, text: L.content || '', ts: L.replyTime || L.sentTime || 0, sid: s.id });
            });
            (data.outbox || []).forEach(function (L) {
                all.push({ kind: 'out', from: nm, text: L.content || '', ts: L.sentTime || 0, sid: s.id, status: L.status });
            });
        }
        all.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });

        var list = el.querySelector('#wx-inbox-list');
        if (!all.length) {
            list.innerHTML = '<div class="wx-mp-loading">还没有任何信。<br>进某个梦角的「发现 → 信箱」写一封试试～</div>';
            return;
        }
        list.innerHTML = all.map(function (L, idx) {
            var t = L.ts ? _relTime(L.ts) : '';
            var tag = L.kind === 'in' ? '收到回信' : (L.status === 'pending' ? '等待回信' : '已寄出');
            return '<div class="wx-inbox-item" data-i="' + idx + '">' +
                '<div class="wx-inbox-hd"><b>' + _esc(L.from) + '</b>' +
                    '<span class="wx-inbox-tag' + (L.kind === 'in' ? ' wx-inbox-tag--in' : '') + '">' + tag + '</span>' +
                    '<span class="wx-inbox-time">' + _esc(t) + '</span></div>' +
                '<div class="wx-inbox-body">' + _esc((L.text || '').slice(0, 80)) + ((L.text || '').length > 80 ? '…' : '') + '</div>' +
            '</div>';
        }).join('');
        list.addEventListener('click', function (e) {
            var it = e.target.closest('.wx-inbox-item');
            if (!it) return;
            var L = all[parseInt(it.getAttribute('data-i'), 10)];
            if (!L) return;
            // 想看全文/回信：切到他本人那页的信箱
            if (L.sid === _currentId()) {
                close();
                _click('envelope-header-btn');
            } else {
                close();
                try { sessionStorage.setItem('wxOpenEnvelope', '1'); } catch (e2) {}
                switchToSession(L.sid, L.from).then(function () {
                    setTimeout(function () { _click('envelope-header-btn'); }, 400);
                });
            }
        });
    }

    // ─── DOM ───
    function buildHome() {
        if (document.getElementById('wx-home')) return;
        var el = document.createElement('div');
        el.id = 'wx-home';
        el.innerHTML =
            '<div class="wx-head"><span class="wx-head-title">微信</span>' +
                '<div class="wx-head-ops">' +
                    '<button class="wx-head-add" id="wx-add-group" title="拉个群"><i class="fas fa-user-group"></i></button>' +
                    '<button class="wx-head-add" id="wx-add-btn" title="添加梦角"><i class="fas fa-plus"></i></button>' +
                '</div></div>' +
            '<div class="wx-conv-list" id="wx-conv-list"></div>' +
            '<div class="wx-tabbar">' +
                '<div class="wx-tab wx-tab--on" id="wx-tab-chat"><i class="fas fa-comment-dots"></i><span>聊天</span></div>' +
                '<div class="wx-tab" id="wx-tab-moments"><i class="fas fa-user-group"></i><span>朋友圈</span></div>' +
                '<div class="wx-tab" id="wx-tab-discover"><i class="fas fa-compass"></i><span>发现</span></div>' +
            '</div>' +
            '<div class="wx-discover" id="wx-discover"></div>';
        document.body.appendChild(el);

        // 发现页：把一堆功能收进来，不再挤在聊天头部
        var disc = el.querySelector('#wx-discover');
        var tiles = [
            { ic: 'fa-envelope-open-text', nm: '信箱', sub: '集中收所有人的信', act: function () { openUnifiedInbox(); } },
            { ic: 'fa-house', nm: '家园', sub: '朋友圈形态', act: function () { _momentsEntry(); } },
            { ic: 'fa-newspaper', nm: '今日公告', sub: '按人查看', act: function () { openDailyGreetingPicker(); } },
            { ic: 'fa-user-group', nm: '我的梦角', sub: '管理 / 切换', act: function () { if (typeof window.openContactsPanel === 'function') window.openContactsPanel(); } },
            { ic: 'fa-cog', nm: '设置', sub: '外观 / 聊天 / 节奏', act: function () { _click('settings-btn'); } }
        ];
        disc.innerHTML = tiles.map(function (t, i) {
            return '<div class="wx-d-tile" data-i="' + i + '">' +
                '<i class="fas ' + t.ic + '"></i>' +
                '<div class="wx-d-nm">' + t.nm + '</div>' +
                '<div class="wx-d-sub">' + t.sub + '</div></div>';
        }).join('');
        disc.addEventListener('click', function (e) {
            var t = e.target.closest('.wx-d-tile');
            if (!t) return;
            var i = parseInt(t.getAttribute('data-i'), 10);
            if (tiles[i]) tiles[i].act();
        });

        el.querySelector('#wx-add-btn').addEventListener('click', function () {
            if (typeof window.openContactsPanel === 'function') window.openContactsPanel();
        });
        el.querySelector('#wx-add-group').addEventListener('click', function () {
            if (typeof window.openCreateGroupPicker === 'function') window.openCreateGroupPicker();
            else if (typeof showNotification === 'function') showNotification('群聊模块未就绪', 'warning');
        });
        el.querySelector('#wx-tab-chat').addEventListener('click', function () {
            _setTab('chat');
        });
        el.querySelector('#wx-tab-moments').addEventListener('click', function () {
            _momentsEntry();
        });
        el.querySelector('#wx-tab-discover').addEventListener('click', function () {
            _setTab('discover');
        });
        el.querySelector('#wx-conv-list').addEventListener('click', function (e) {
            var row = e.target.closest('.wx-conv');
            if (!row) return;
            var id = row.getAttribute('data-id');
            var nm = (row.querySelector('.wx-conv-name') || {}).textContent || '梦角';
            if (!id) return;
            if (id === _currentId()) { enterChat(); return; }
            switchToSession(id, nm);
        });
    }

    async function renderConvs() {
        var list = document.getElementById('wx-conv-list');
        if (!list) return;
        var sessions = _sessions();
        if (!sessions.length) { list.innerHTML = '<div class="wx-empty">还没有梦角</div>'; return; }
        var metas = await Promise.all(sessions.map(_convMeta));
        metas.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
        list.innerHTML = metas.map(function (m) {
            return '<div class="wx-conv' + (m.isCurrent ? ' wx-conv--cur' : '') + '" data-id="' + _esc(m.id) + '">' +
                '<div class="wx-conv-av">' + _avatarHtml(m.avatar, 48) + '</div>' +
                '<div class="wx-conv-main">' +
                    '<div class="wx-conv-top">' +
                        '<span class="wx-conv-name">' + (m.isGroup ? '<i class="fas fa-user-group" style="font-size:12px;color:var(--text-secondary);margin-right:4px;"></i>' : '') + _esc(m.name) + '</span>' +
                        '<span class="wx-conv-time">' + _esc(_relTime(m.time)) + '</span>' +
                    '</div>' +
                    '<div class="wx-conv-prev">' + _esc(m.preview || '还没有聊过，点进去说句话吧') + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // ─── 进入 / 返回 ───
    function showHome() {
        buildHome();
        var el = document.getElementById('wx-home');
        if (el) el.style.display = 'flex';
        try { sessionStorage.setItem(FLAG, '0'); } catch (e) {}
        _setTab('chat');
        renderConvs();
    }

    function enterChat() {
        var el = document.getElementById('wx-home');
        if (el) el.style.display = 'none';
    }

    // 聊天头部左侧的返回键
    function injectBackBtn() {
        var inner = document.querySelector('.header-inner');
        if (!inner || document.getElementById('wx-back-btn')) return;
        var b = document.createElement('button');
        b.id = 'wx-back-btn';
        b.className = 'action-btn';
        b.title = '返回';
        b.innerHTML = '<i class="fas fa-chevron-left"></i>';
        b.addEventListener('click', function (e) { e.stopPropagation(); showHome(); });
        inner.insertBefore(b, inner.firstChild);
    }

    // ─── 聊天页头部整理：像微信一样清爽 ───
    //  · 中间那排功能按钮全部收掉（都搬到「发现」里了），只留返回 + 两边头像
    //  · 他的头像在左、我的头像在右，各自带自己的状态，左右对称
    //  · 点他的头像 → 进他的朋友圈空间；点我的头像 → 只看我发的
    function tidyChatHeader() {
        try { document.body.classList.add('header-clean'); } catch (e) {}

        var openHis = function (e) {
            if (e) { e.stopPropagation(); e.preventDefault(); }
            openOwnerMoments();
        };
        var openMine = function (e) {
            if (e) { e.stopPropagation(); e.preventDefault(); }
            try {
                if (typeof window._mShowOnlyMine === 'function') window._mShowOnlyMine();
                else if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
            } catch (err) {}
        };
        var bind = function (id, fn) {
            var el = document.getElementById(id);
            if (!el || el._wxBound) return;
            el._wxBound = true;
            el.style.cursor = 'pointer';
            el.addEventListener('click', fn);
        };
        // 绑整个头像容器：点到头像/边框/空白都算，手指更好点
        bind('partner-avatar-container', openHis);
        bind('my-avatar-container', openMine);
    }

    var _booted = false;
    function boot() {
        if (_booted) return;
        _booted = true;
        buildHome();
        injectBackBtn();
        tidyChatHeader();

        // 是不是"刚从另一个梦角切过来"？是的话把过场接着铺住，
        // 等这一页的聊天渲染好再淡出 —— 视觉上就是一条连续的过场。
        // 但如果用户关掉了动画：过场一概不铺，直接进聊天（他不想看到任何转圈）
        var switchName = null;
        try { switchName = sessionStorage.getItem('wxSwitchName'); } catch (e) {}
        if (switchName) {
            if (_instantSwitch()) {
                try {
                    sessionStorage.removeItem('wxSwitchName');
                    sessionStorage.removeItem('wxFastBoot');
                } catch (e) {}
                hideSwitchOverlay();
            } else {
                showSwitchOverlay(switchName);
                resumeAfterSwitch();
            }
        }

        var goChat = false;
        try { goChat = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}
        if (goChat) {
            try { sessionStorage.setItem(FLAG, '0'); } catch (e) {}
            enterChat();
            renderConvs();
        } else {
            showHome();
        }
        waitSessionsAndRender();
        // 空闲时把所有梦角预读进内存，之后切换就是"零等待"
        setTimeout(prefetchAll, 1500);

        // 从"朋友圈选人"切过来的：等聊天渲染完，直接把他那一页的家园打开
        var openM = null;
        try { openM = sessionStorage.getItem('wxOpenMoments'); } catch (e) {}
        if (openM === '1') {
            try { sessionStorage.removeItem('wxOpenMoments'); } catch (e) {}
            var t0 = Date.now();
            (function waitThenOpen() {
                if (_chatReady() || Date.now() - t0 > 2500) { openOwnerMoments(); return; }
                requestAnimationFrame(waitThenOpen);
            })();
        }
    }

    // 切换后：等聊天真的渲染出来（或最多等 2.5 秒）再把过场淡出
    function resumeAfterSwitch() {
        var t0 = Date.now();
        (function poll() {
            var ready = false;
            try { ready = _chatReady(); } catch (e) {}
            if (ready || Date.now() - t0 > 2500) {
                hideSwitchOverlay();
                try {
                    sessionStorage.removeItem('wxSwitchName');
                    sessionStorage.removeItem('wxFastBoot');
                } catch (e) {}
                return;
            }
            requestAnimationFrame(poll);
        })();
    }

    // sessionList 是 core.js 在 DOMContentLoaded 之后异步从 localforage 读回来的，
    // 而 defer 脚本执行得比它早 —— 早渲染会读到空数组，表现就是首页明明有梦角却写
    // "还没有梦角"。所以这里轮询等它就绪，再补渲染一次（只更新列表，不动显示状态，
    // 不会把已经进到聊天里的用户又弹回首页）。
    function waitSessionsAndRender(tries) {
        tries = tries || 0;
        var n = 0;
        try { n = _sessions().length; } catch (e) {}
        if (n > 0) {
            renderConvs();
            prefetchAll();          // 会话一就绪就立刻并发预读，别等到点的时候才读
            return;
        }
        if (tries >= 80) { renderConvs(); return; }   // 最多等 10 秒，等不到就渲染空态
        setTimeout(function () { waitSessionsAndRender(tries + 1); }, 120);
    }

    // 暴露给「我的梦角」面板复用（同一套切换 + 过场逻辑，保证两条入口手感一致）
    window.WxHomeShow = showHome;
    window.WxHomeEnter = enterChat;
    window.WxSwitchTo = switchToSession;
    window.WxSwitchOverlay = showSwitchOverlay;
    // 新建/删除梦角之后，让首页会话列表立刻刷新（不用等下次进页面）
    window.WxRefreshConvs = function () { try { renderConvs(); } catch (e) {} };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
    // 兜底：脚本注入顺序/欢迎层可能晚一点，再补一次
    setTimeout(boot, 1200);
})();
