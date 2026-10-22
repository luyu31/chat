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
        var avatar = null, preview = '', time = 0, signature = '';
        try {
            var st = await localforage.getItem(p + s.id + '_chatSettings');
            if (!userNamed && st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
            if (userNamed && (!st || !st.partnerName)) name = recName;
            if (st && st.partnerSignature) signature = String(st.partnerSignature);
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
        return { id: s.id, name: name, avatar: avatar, preview: preview, time: time, signature: signature, isCurrent: s.id === _currentId(), isGroup: s.type === 'group' };
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

    function _prefetchSession(id, force) {
        // 切梦角必须拿"存储里此刻的真实数据"。内存缓存一旦被上一次错误切换污染，
        // 后面每次点这个梦角都会一直显示错的 —— 这是"梦角2永远是梦角1"的根源之一。
        if (force) { try { delete _cache[id]; } catch (e) {} }
        if (_cache[id]) return Promise.resolve(_cache[id]);
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

        // 切走就取消上一位还在排队的回复和"正在输入"，不然新梦角页面会冒出他的提示
        try {
            if (window._pendingReplyTimer) { clearTimeout(window._pendingReplyTimer); window._pendingReplyTimer = null; }
            var tiW = document.getElementById('typing-indicator-wrapper');
            if (tiW) tiW.style.display = 'none';
        } catch (e) {}

        // 先把当前进度收进内存缓存（同步，不碰存储 → 不拖慢点击）
        _cacheCurrent();

        // 目标会话：直接从存储读，不走可能被污染的内存缓存
        var tgt = await _prefetchSession(id, true);

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
            try { _chdRefresh(); } catch (e) {}

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
                                // 朋友圈也是按梦角存的：切完必须重新读，否则新梦角会短暂/永久显示上一位的动态
                                try {
                                    if (typeof window.loadMomentsData === 'function') {
                                        Promise.resolve(window.loadMomentsData()).then(function () {
                                            if (_currentId() !== id) return;
                                            try { if (typeof window._updateMomentsBadge === 'function') window._updateMomentsBadge(); } catch (e) {}
                                            try {
                                                var csp = document.getElementById('couple-space-page');
                                                if (csp && csp.classList.contains('cs-open') && typeof window._csRenderFeed === 'function') window._csRenderFeed();
                                            } catch (e) {}
                                        }).catch(function () {});
                                    }
                                } catch (e) {}
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

            // 不再把切换后的数据写回内存缓存：只有确认从存储读到的内容才可信，
            // 避免一次错误切换把"梦角1的数据"缓存到梦角2名下，之后怎么点都错。

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
    // 打开全屏层（家园/影院等）之前记住当前 tab，关掉后好原路返回
    function _rememberTabBeforeCs() {
        try {
            var onTab = document.querySelector('.wx-tab.wx-tab--on');
            window._wxTabBeforeCs = (onTab && onTab.id) ? onTab.id.replace('wx-tab-', '') : 'chat';
        } catch (e) { window._wxTabBeforeCs = 'chat'; }
    }

    function openAllMoments() {
        try {
            _rememberTabBeforeCs();
            if (typeof window._mShowMomentsHome === 'function') { window._mShowMomentsHome(); return; }
            if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
            else if (typeof window.openCoupleSpace === 'function') window.openCoupleSpace();
        } catch (e) { console.warn('[wx-home] 打开家园失败', e); }
    }
    function openOwnerMoments() {
        enterChat();
        try {
            _rememberTabBeforeCs();
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

    // 底部标签切换：消息 / 通讯录 / 家园 / 发现 / 我
    function _setTab(tab) {
        var panels = {
            chat: document.getElementById('wx-conv-list'),
            contacts: document.getElementById('wx-contacts'),
            discover: document.getElementById('wx-discover'),
            me: document.getElementById('wx-me')
        };
        var showKey = (tab === 'moments') ? 'chat' : tab;
        Object.keys(panels).forEach(function (k) {
            var p = panels[k];
            if (!p) return;
            p.style.display = (k === showKey) ? (k === 'discover' ? 'grid' : 'block') : 'none';
        });
        var tabIds = { chat: 'wx-tab-chat', contacts: 'wx-tab-contacts', moments: 'wx-tab-moments', discover: 'wx-tab-discover', me: 'wx-tab-me' };
        Object.keys(tabIds).forEach(function (k) {
            var el = document.getElementById(tabIds[k]);
            if (el) el.classList.toggle('wx-tab--on', k === (tab === 'moments' ? 'moments' : tab));
        });
        if (tab === 'contacts') renderContactsTab();
        if (tab === 'me') renderMeTab();
    }

    // ─── 通讯录：所有梦角，点一下直接进他的聊天 ───
    async function renderContactsTab() {
        var box = document.getElementById('wx-contacts');
        if (!box) return;
        var sessions = _sessions();
        if (!sessions.length) {
            if (!window._sessionsLoaded) { box.innerHTML = ''; return; }
            box.innerHTML = '<div class="wx-empty">还没有梦角</div>';
            return;
        }
        var metas = await Promise.all(sessions.map(_convMeta));
        metas.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'zh-CN'); });
        box.innerHTML =
            '<div class="wx-ct-section">梦角</div>' +
            metas.map(function (m) {
                var sub = m.signature || (m.preview ? ('最近：' + m.preview) : '还没有聊过');
                return '<div class="wx-ct-row" data-id="' + _esc(m.id) + '">' +
                    '<div class="wx-ct-av">' + _avatarHtml(m.avatar, 44) + '</div>' +
                    '<div class="wx-ct-main">' +
                        '<div class="wx-ct-name">' + _esc(m.name) + '</div>' +
                        '<div class="wx-ct-sub">' + _esc(sub) + '</div>' +
                    '</div>' +
                    '<button class="wx-ct-edit" data-id="' + _esc(m.id) + '" title="编辑"><i class="fas fa-ellipsis"></i></button>' +
                '</div>';
            }).join('');
    }

    // ─── 我：仿微信个人页 ───
    function renderMeTab() {
        var box = document.getElementById('wx-me');
        if (!box) return;
        var meName = (typeof settings !== 'undefined' && settings.myName) || '我';
        var sig = '';
        try { sig = localStorage.getItem('milk_my_signature') || ''; } catch (e) {}
        if (!sig && typeof settings !== 'undefined' && settings) sig = settings.mySignature || '';
        var av = (window._avatarCache && window._avatarCache.me) || null;
        if (!av) {
            var img = document.querySelector('#my-avatar img');
            if (img && img.src) av = img.src;
        }
        box.innerHTML =
            '<div class="wx-me-card" data-me-act="signature">' +
                '<div class="wx-me-av">' + _avatarHtml(av, 64) + '</div>' +
                '<div class="wx-me-info">' +
                    '<div class="wx-me-name">' + _esc(meName) + '</div>' +
                    '<div class="wx-me-sig">' + _esc(sig || '点击设置个性签名') + '</div>' +
                '</div>' +
                '<i class="fas fa-chevron-right wx-me-arrow"></i>' +
            '</div>' +
            '<div class="wx-me-group">' +
                '<div class="wx-me-item" data-me-act="appearance"><i class="fas fa-palette"></i><span>外观设置</span><i class="fas fa-chevron-right"></i></div>' +
                '<div class="wx-me-item" data-me-act="chat"><i class="fas fa-comments"></i><span>聊天设置</span><i class="fas fa-chevron-right"></i></div>' +
                '<div class="wx-me-item" data-me-act="advanced"><i class="fas fa-tools"></i><span>高级功能</span><i class="fas fa-chevron-right"></i></div>' +
                '<div class="wx-me-item" data-me-act="data"><i class="fas fa-database"></i><span>数据管理</span><i class="fas fa-chevron-right"></i></div>' +
                '<div class="wx-me-item" data-me-act="settings"><i class="fas fa-gear"></i><span>设置</span><i class="fas fa-chevron-right"></i></div>' +
            '</div>';
    }

    // ─── 统一信箱：把**所有梦角**的信汇总到一处（这才是"集中收多个人的信"） ───
    async function openUnifiedInbox() {
        var sessions = _sessions();
        // 只有一个梦角：直接开他本人的信箱（汇总面板反而不顺手）
        if (sessions.length <= 1) {
            if (typeof enterChat === 'function') enterChat();
            if (!_click('envelope-header-btn')) {
                if (typeof showNotification === 'function') showNotification('信箱还没就绪，稍后再试', 'warning');
            }
            return;
        }
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
            '<div class="wx-head"><span class="wx-head-title"></span>' +
                '<div class="wx-head-ops">' +
                    '<button class="wx-head-add" id="wx-add-group" title="拉个群"><i class="fas fa-user-group"></i></button>' +
                '</div></div>' +
            '<div class="wx-conv-list" id="wx-conv-list"></div>' +
            '<div class="wx-contacts" id="wx-contacts" style="display:none;"></div>' +
            '<div class="wx-discover" id="wx-discover" style="display:none;"></div>' +
            '<div class="wx-me" id="wx-me" style="display:none;"></div>' +
            '<div class="wx-tabbar">' +
                '<div class="wx-tab wx-tab--on" id="wx-tab-chat"><i class="fas fa-comment-dots"></i><span>消息</span></div>' +
                '<div class="wx-tab" id="wx-tab-contacts"><i class="fas fa-address-book"></i><span>通讯录</span></div>' +
                '<div class="wx-tab" id="wx-tab-moments"><i class="fas fa-house"></i><span>家园</span></div>' +
                '<div class="wx-tab" id="wx-tab-discover"><i class="fas fa-compass"></i><span>发现</span></div>' +
                '<div class="wx-tab" id="wx-tab-me"><i class="fas fa-user"></i><span>我</span></div>' +
            '</div>';
        document.body.appendChild(el);

        // 发现页：一起看书/看电影等共同活动统一放这里
        var disc = el.querySelector('#wx-discover');
        var tiles = [
            { ic: 'fa-book-open', nm: '一起看书', sub: '书架 / 共读', act: function () { if (window.Reading) window.Reading.open(); } },
            { ic: 'fa-film', nm: '一起看电影', sub: '影院 / 观影', act: function () { if (window.Cinema) window.Cinema.open(); else if (typeof csSwitchTab === 'function') { if (typeof openCoupleSpace === 'function') openCoupleSpace(); setTimeout(function () { csSwitchTab('cinema'); }, 420); } } },
            { ic: 'fa-envelope-open-text', nm: '信箱', sub: '集中收所有人的信', act: function () { openUnifiedInbox(); } },
            { ic: 'fa-newspaper', nm: '今日公告', sub: '按人查看', act: function () { openDailyGreetingPicker(); } },
            { ic: 'fa-wallet', nm: '记账', sub: '聊天自动记账', act: function () { if (window.Ledger) window.Ledger.open(); } },
            { ic: 'fa-utensils', nm: '食光记', sub: '今天吃了什么', act: function () { if (window.Food) window.Food.open(); } },
            { ic: 'fa-book-open-reader', nm: '交换日记', sub: '你一篇他一篇', act: function () { if (window.ExchangeDiary) window.ExchangeDiary.open(); } }
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

        el.querySelector('#wx-add-group').addEventListener('click', function () {
            if (typeof window.openCreateGroupPicker === 'function') window.openCreateGroupPicker();
            else if (typeof showNotification === 'function') showNotification('群聊模块未就绪', 'warning');
        });
        el.querySelector('#wx-tab-chat').addEventListener('click', function () { _setTab('chat'); });
        el.querySelector('#wx-tab-contacts').addEventListener('click', function () { _setTab('contacts'); });
        el.querySelector('#wx-tab-moments').addEventListener('click', function () {
            _setTab('moments');
            _momentsEntry();
        });
        el.querySelector('#wx-tab-discover').addEventListener('click', function () { _setTab('discover'); });
        el.querySelector('#wx-tab-me').addEventListener('click', function () { _setTab('me'); });
        el.querySelector('#wx-conv-list').addEventListener('click', function (e) {
            var row = e.target.closest('.wx-conv');
            if (!row) return;
            var id = row.getAttribute('data-id');
            var nm = (row.querySelector('.wx-conv-name') || {}).textContent || '梦角';
            if (!id) return;
            if (id === _currentId()) { enterChat(); return; }
            switchToSession(id, nm);
        });
        el.querySelector('#wx-contacts').addEventListener('click', function (e) {
            var edit = e.target.closest('.wx-ct-edit');
            if (edit) {
                e.stopPropagation();
                if (typeof window.openContactDetail === 'function') window.openContactDetail(edit.getAttribute('data-id'));
                else if (typeof window.openContactsPanel === 'function') window.openContactsPanel();
                return;
            }
            var row = e.target.closest('.wx-ct-row');
            if (!row) return;
            var id = row.getAttribute('data-id');
            var nm = (row.querySelector('.wx-ct-name') || {}).textContent || '梦角';
            if (id && id !== _currentId()) switchToSession(id, nm);
            else enterChat();
        });
        el.querySelector('#wx-me').addEventListener('click', function (e) {
            var item = e.target.closest('[data-me-act]');
            if (!item) return;
            var act = item.getAttribute('data-me-act');
            if (act === 'signature') {
                var cur = '';
                try { cur = localStorage.getItem('milk_my_signature') || ''; } catch (err0) {}
                if (!cur && typeof settings !== 'undefined' && settings) cur = settings.mySignature || '';
                var v = prompt('我的个性签名（会显示在聊天顶部）：', cur);
                if (v === null) return;
                try {
                    v = String(v).trim();
                    localStorage.setItem('milk_my_signature', v);
                    if (typeof settings !== 'undefined' && settings) {
                        settings.mySignature = v;
                        if (typeof saveData === 'function') saveData();
                        if (typeof updateUI === 'function') updateUI();
                    }
                } catch (err) {}
                try { _chdRefresh(); } catch (err) {}
                renderMeTab();
            } else if (act === 'contacts') {
                if (typeof window.openContactsPanel === 'function') window.openContactsPanel();
            } else if (act === 'appearance' || act === 'chat' || act === 'data') {
                var map = { appearance: 'appearance-settings', chat: 'chat-settings', data: 'data-settings' };
                var modal = document.getElementById('settings-modal');
                if (modal && typeof showModal === 'function') showModal(modal);
                setTimeout(function () {
                    var card = document.getElementById(map[act]);
                    if (card) card.click();
                }, 60);
            } else if (act === 'advanced') {
                var adv = document.getElementById('advanced-modal');
                if (adv && typeof showModal === 'function') showModal(adv);
            } else if (act === 'settings') {
                _click('settings-btn');
            }
        });
    }

    async function renderConvs() {
        var list = document.getElementById('wx-conv-list');
        if (!list) return;
        var sessions = _sessions();
        if (!sessions.length) {
            // sessionList 还在从 localforage 读：先什么都不写，避免闪一下"还没有梦角"
            if (!window._sessionsLoaded) { list.innerHTML = ''; return; }
            list.innerHTML = '<div class="wx-empty">还没有梦角</div>';
            return;
        }
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
        var back = document.getElementById('wx-back-btn');
        if (back) back.style.display = 'none';
        try { sessionStorage.setItem(FLAG, '0'); } catch (e) {}
        _setTab('chat');
        renderConvs();
    }

    function enterChat() {
        var el = document.getElementById('wx-home');
        if (el) el.style.display = 'none';
        var back = document.getElementById('wx-back-btn');
        if (back) back.style.display = 'flex';
        try { _chdRefresh(); } catch (e) {}
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

    // ─── 聊天页头部整理：彻底重排 ───
    // 旧样式表里 .user-info/.username/.status 有十几处历史规则（含多个 media query）
    // 互相打架，真机上怎么调都压不稳。这里直接把头部 DOM 重新组织成全新的
    // chd-* 结构，配一段只有 chd-* 才会命中的样式（注入在所有样式表之后），
    // 与老样式彻底隔离 —— 老规则再怎么打架也碰不到新结构。
    function tidyChatHeader() {
        try { document.body.classList.add('header-clean'); } catch (e) {}
        var inner = document.querySelector('.header-inner');
        if (!inner || inner._chdDone) return;
        inner._chdDone = true;

        if (!document.getElementById('chd-style')) {
            var st = document.createElement('style');
            st.id = 'chd-style';
            st.textContent = [
                // 华为灵动岛机型状态栏偏厚：给足顶部空间，避免头一块被胶囊挤住
                'body.header-clean .header{padding-top:calc(var(--sat,0px) + 22px)!important;}',
                // 头部容器：一行三块，整块放大
                'body.header-clean .header-inner{display:flex;align-items:flex-end;gap:8px;padding:10px 12px 14px!important;max-width:600px!important;}',
                'body.header-clean .header-inner::after{content:none!important;}',
                'body.header-clean .header-actions{display:none!important;}',
                'body.header-clean .header-motto{display:none!important;}',
                // 人物块：竖排 —— 大头像在上，名字/签名在头像下面
                '.chd-person{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;}',
                '.chd-av{flex:0 0 auto;width:64px;height:64px;position:relative;line-height:0;cursor:pointer;order:0!important;}',
                '.chd-av .avatar{width:100%!important;height:100%!important;margin:0!important;order:0!important;border-radius:50%!important;}',
                '.chd-av .avatar img{width:100%!important;height:100%!important;object-fit:cover;border-radius:50%!important;}',
                '.chd-text{display:flex;flex-direction:column;align-items:center;gap:2px;max-width:100%;min-width:0;order:1!important;}',
                '.chd-text .username{font-size:15.5px;font-weight:600;max-width:100%!important;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.3px;text-align:center!important;order:0!important;}',
                // 签名就在头像下面，字号放大一点，最多两行（order 压过老规则的默认排序）
                '.chd-sig{font-size:12.5px;line-height:1.5;color:var(--text-secondary);max-width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;text-align:center;order:1!important;}',
                // 旧的状态元素留在 DOM 里供老代码写入，但不显示
                '.chd-hide{display:none!important;}',
                // 返回键：竖排头像块整体变高，返回键贴底对齐
                'body.header-clean #wx-back-btn{flex:0 0 52px;width:52px;height:52px;margin:0 0 4px 0;transform:none;font-size:22px;position:relative;align-self:flex-end;}',
                'body.header-clean #wx-back-btn::after{content:"";position:absolute;inset:-8px;border-radius:50%;}'
            ].join('\n');
            document.head.appendChild(st);
        }

        var pAv = document.getElementById('partner-avatar-container');
        var pName = document.getElementById('partner-name');
        var pSt = document.getElementById('partner-status');
        var mAv = document.getElementById('my-avatar-container');
        var mName = document.getElementById('my-name');
        var mSt = document.getElementById('my-status-container');
        if (!pAv || !mAv || !pName || !mName) return;

        function mkPerson(av, name, stEl, sigCls, mirror) {
            var p = document.createElement('div');
            p.className = 'chd-person' + (mirror ? ' chd-mirror' : '');
            var avw = document.createElement('div');
            avw.className = 'chd-av';
            avw.appendChild(av);
            var tx = document.createElement('div');
            tx.className = 'chd-text';
            tx.appendChild(name);
            var sig = document.createElement('div');
            sig.className = 'chd-sig ' + sigCls;
            tx.appendChild(sig);
            if (stEl) { stEl.classList.add('chd-hide'); tx.appendChild(stEl); }
            // 竖排：大头像在上，名字/签名紧贴头像下面
            p.appendChild(avw);
            p.appendChild(tx);
            return p;
        }

        var back = document.getElementById('wx-back-btn');
        var actions = inner.querySelector('.header-actions');
        var left = mkPerson(pAv, pName, pSt, 'chd-sig--p', false);
        var right = mkPerson(mAv, mName, mSt, 'chd-sig--m', true);

        inner.innerHTML = '';
        if (back) inner.appendChild(back);
        inner.appendChild(left);
        inner.appendChild(right);
        if (actions) inner.appendChild(actions);   // 老按钮容器留着（由老规则隐藏），别的代码还要按 id 找它们

        // 头像点击：他的 → 他的朋友圈；我的 → 只看我发的
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
        var bind = function (el, fn) {
            if (!el || el._wxBound) return;
            el._wxBound = true;
            el.addEventListener('click', fn);
        };
        bind(pAv, openHis);
        bind(mAv, openMine);

        _chdRefresh();
    }

    // 签名刷新：他的 = 会话资料卡签名 → 全局设置签名 → 在线状态；
    // 我的 = 我的签名（localStorage/设置）→ 我的状态
    function _chdRefresh() {
        var lp = document.querySelector('.chd-sig--p');
        var lm = document.querySelector('.chd-sig--m');
        if (lm) {
            var my = '';
            try { my = localStorage.getItem('milk_my_signature') || ''; } catch (e) {}
            if (!my && typeof settings !== 'undefined' && settings) my = settings.mySignature || settings.myStatus || '';
            lm.textContent = String(my || '').trim() || '在线';
        }
        if (lp) {
            var p = '';
            try {
                if (typeof settings !== 'undefined' && settings && settings.partnerSignature)
                    p = String(settings.partnerSignature).trim();
            } catch (e) {}
            var fallback = '';
            try {
                if (typeof settings !== 'undefined' && settings && settings.partnerStatus)
                    fallback = settings.partnerStatus;
            } catch (e) {}
            lp.textContent = p || fallback || '在线';
            if (!p) {
                // 会话资料卡里可能单独存了签名（优先级更高，异步补上）
                try {
                    var cid = _currentId();
                    if (cid) {
                        localforage.getItem(_prefix() + cid + '_chatSettings').then(function (st) {
                            if (st && st.partnerSignature && String(st.partnerSignature).trim() && lp.isConnected)
                                lp.textContent = String(st.partnerSignature).trim();
                        }).catch(function () {});
                    }
                } catch (e) {}
            }
        }
    }
    window._chdRefresh = _chdRefresh;

    var _booted = false;
    function boot() {
        if (_booted) return;
        _booted = true;
        buildHome();
        injectBackBtn();
        tidyChatHeader();
        if (!window._wxCsClosedBound) {
            window._wxCsClosedBound = true;
            window.addEventListener('cs:closed', function () {
                // 家园/阅读/影院这些全屏层关掉后，回到进它之前所在的 tab
                // （从「发现」进去的，关掉就应该还在「发现」，而不是弹回「消息」）
                var home = document.getElementById('wx-home');
                if (home && home.style.display !== 'none') _setTab(window._wxTabBeforeCs || 'chat');
            });
        }

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
    window.WxRefreshContacts = function () { try { renderContactsTab(); } catch (e) {} };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
    // 兜底：脚本注入顺序/欢迎层可能晚一点，再补一次
    setTimeout(boot, 1200);
})();
