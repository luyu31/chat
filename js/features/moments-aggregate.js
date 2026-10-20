/* ────────────────────────────────────────────────────────────────
 * 朋友圈 · 聚合时间线
 *
 * 以前：朋友圈只看得到"当前这个梦角"的动态（因为动态是按会话存的）。
 * 现在：点进去默认是**所有人的动态混在一起**，像真的微信朋友圈 ——
 *       刷的时候一次看完；点某条动态的头像/名字，才进他本人的空间。
 *
 * 做法（尽量不改 moments.js 的内部逻辑，降低风险）：
 *   1. 把每个会话的 momentsData 预读到内存（异步，启动后后台做）
 *   2. 渲染动态流时，临时把"合并后的列表"塞给原渲染函数，渲染完立刻还原
 *   3. 渲染完再把每张卡片的头像/名字改成"该动态真正的主人"
 *   4. 点赞/评论别人的动态 = 先切到他那页再操作，避免写到错误的会话里
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var _other = {};        // sid → posts[]（其他梦角的动态）
    var _meta = {};         // sid → { name, avatar, myAvatar }
    var _loaded = false;
    var _aggMode = 'all';   // 'all' | 'mine' | 'owner'
    var _busy = false;
    var _bootTries = 0;

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
    function _avHtml(src, size) {
        var s = size || 36;
        if (src) return '<img src="' + _esc(src) + '" style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;object-fit:cover;display:block;">';
        return '<span style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:var(--border-color,#d8d8d8);display:inline-flex;align-items:center;justify-content:center;">' +
            '<i class="fas fa-user" style="font-size:' + Math.round(s * 0.44) + 'px;color:var(--text-secondary,#aaa);"></i></span>';
    }

    // ─── 预读所有人的动态 ───
    async function loadAll() {
        if (_busy) return;
        var p = _prefix();
        var list = _sessions();
        // sessionList 是异步读回来的，太早跑会读到空数组 —— 过一会儿再试
        if (!list.length) {
            if (_bootTries++ < 20) setTimeout(loadAll, 500);
            return;
        }
        _busy = true;
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            if (s.id === _currentId()) continue;      // 当前这个用实时的 momentsData
            try {
                var d = await localforage.getItem(p + s.id + '_momentsData');
                _other[s.id] = (d && Array.isArray(d.posts)) ? d.posts : [];
            } catch (e) { _other[s.id] = []; }
            var name = s.name || '梦角', av = null, myAv = null;
            try {
                var st = await localforage.getItem(p + s.id + '_chatSettings');
                if (st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
            } catch (e) {}
            try { av = await localforage.getItem(p + s.id + '_partnerAvatar'); } catch (e) {}
            try { myAv = await localforage.getItem(p + s.id + '_myAvatar'); } catch (e) {}
            _meta[s.id] = { name: name, avatar: av || null, myAvatar: myAv || null };
        }
        _loaded = true;
        _busy = false;
        // 数据到了，如果正开着家园就重画一次
        try {
            var page = document.getElementById('couple-space-page');
            if (page && page.classList.contains('cs-open') && typeof window._csRenderFeed === 'function') {
                window._csRenderFeed();
            }
        } catch (e) {}
    }

    // 当前会话的作者信息
    function _curMeta() {
        var id = _currentId();
        if (_meta[id]) return _meta[id];
        var name = (typeof settings !== 'undefined' && settings && settings.partnerName) ? settings.partnerName : '梦角';
        var av = window._avatarCache && window._avatarCache.partner;
        var myAv = window._avatarCache && window._avatarCache.me;
        return { name: name, avatar: av || null, myAvatar: myAv || null };
    }

    // ─── 合并列表 ───
    function mergedList() {
        var out = [];
        var curId = _currentId();

        // 当前会话（实时的那一份，保证刚发的动态立刻出现）
        try {
            var cur = (typeof momentsData !== 'undefined' && momentsData && Array.isArray(momentsData.posts)) ? momentsData.posts : [];
            cur.forEach(function (p) {
                out.push(_tag(p, curId, true));
            });
        } catch (e) {}

        if (_aggMode !== 'owner' && _loaded) {
            Object.keys(_other).forEach(function (sid) {
                if (sid === curId) return;
                (_other[sid] || []).forEach(function (p) { out.push(_tag(p, sid, false)); });
            });
        }
        // 时间倒序（没有时间戳的排在后面）
        out.sort(function (a, b) {
            var ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            var tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        });
        if (_aggMode === 'mine') {
            out = out.filter(function (p) { return p.type === 'user'; });
        } else if (_aggMode === 'owner') {
            // 进他的空间：只看他发的，我的动态留在"我的朋友圈"里
            out = out.filter(function (p) { return p.type === 'partner'; });
        }
        return out;
    }

    function _tag(post, sid, isCurrent) {
        // 不改原对象（会污染别的会话的数据），只造一个带作者信息的浅拷贝
        var cp = Object.assign({}, post);
        var isCurrentSid = sid === _currentId();
        var mm = isCurrentSid ? _curMeta() : (_meta[sid] || { name: '梦角', avatar: null, myAvatar: null });
        cp._ownerId = sid;
        cp._ownerIsMe = post.type !== 'partner';
        cp._ownerName = (post.type === 'partner') ? mm.name : '我';
        cp._ownerAvatar = (post.type === 'partner') ? mm.avatar : mm.myAvatar;
        cp._isCurrentOwner = isCurrentSid;
        return cp;
    }

    // ─── 渲染后：把卡片上的头像/名字换成真正的作者 ───
    function decorate(merged) {
        var list = document.getElementById('cs-feed-list');
        if (!list) return;
        var cards = list.querySelectorAll('.cs-post');
        for (var i = 0; i < cards.length && i < merged.length; i++) {
            var card = cards[i], post = merged[i];
            if (!post || !post._ownerId) continue;
            card.setAttribute('data-owner', post._ownerId);

            // 头像
            var avBox = card.querySelector('.cs-post-av');
            if (avBox) {
                avBox.innerHTML = _avHtml(post._ownerAvatar, 36);
                avBox.style.cursor = 'pointer';
                avBox.setAttribute('data-owner', post._ownerId);
            }
            // 名字
            var nmBox = card.querySelector('.cs-post-name');
            if (nmBox) {
                var dot = nmBox.querySelector('span');
                nmBox.textContent = post._ownerName || '';
                if (dot) nmBox.appendChild(dot);
                nmBox.style.cursor = 'pointer';
                nmBox.setAttribute('data-owner', post._ownerId);
            }
            // 别人的动态：隐藏"删除"按钮（不是你的帖子，删不了）
            if (!post._isCurrentOwner) {
                var del = card.querySelector('.cs-post-del');
                if (del) del.style.display = 'none';
            }
        }
    }

    // ─── 拦截：别人的动态要点赞/评论 → 先切到他 ───
    function _foreignOf(postId) {
        var merged = mergedList();
        var hit = merged.filter(function (p) { return String(p.id) === String(postId); })[0];
        if (!hit || hit._isCurrentOwner) return null;
        return hit;
    }
    // 切换到他本人那页，再继续做后面的事（点赞/评论/进他的空间）
    function _goOwner(postId, then) {
        var hit = _foreignOf(postId);
        if (!hit) return false;
        var name = (_meta[hit._ownerId] || {}).name || '梦角';
        if (typeof showNotification === 'function') showNotification('这是 ' + name + ' 的动态，正在切到他那页…', 'info', 1400);
        if (typeof window.WxSwitchTo === 'function') {
            var pr = window.WxSwitchTo(hit._ownerId, name);
            var run = function () { setTimeout(function () { if (typeof then === 'function') then(); }, 80); };
            if (pr && typeof pr.then === 'function') pr.then(run);
            else {
                var t0 = Date.now();
                (function wait() {
                    if (_currentId() === hit._ownerId || Date.now() - t0 > 1200) { run(); return; }
                    setTimeout(wait, 40);
                })();
            }
        }
        return true;
    }

    // 切过去之后，等他的动态真的加载出来，再执行点赞/评论这类操作
    function _runWhenReady(postId, fn) {
        var t0 = Date.now();
        (function retry() {
            var has = false;
            try {
                has = (typeof momentsData !== 'undefined' && momentsData && Array.isArray(momentsData.posts))
                    && momentsData.posts.some(function (p) { return String(p.id) === String(postId); });
            } catch (e) {}
            if (has) { try { fn(); } catch (e) {} return; }
            if (Date.now() - t0 > 1800) return;
            setTimeout(retry, 60);
        })();
    }

    function _wrapFn(name) {
        var orig = window[name];
        if (typeof orig !== 'function' || orig._aggWrapped) return;
        var wrapped = function (postId) {
            if (_goOwner(postId, function () { _runWhenReady(postId, function () { orig.call(window, postId); }); })) return;
            return orig.apply(this, arguments);
        };
        wrapped._aggWrapped = true;
        window[name] = wrapped;
    }

    // ─── 安装 ───
    function install() {
        if (!window._csRenderFeed || window._csRenderFeed._aggWrapped) return false;
        var orig = window._csRenderFeed;
        var wrapped = function () {
            // 新加了梦角 / 冷启动时 sessionList 还没就绪：发现漏读就补一次
            try {
                var missing = _sessions().some(function (s) { return s.id !== _currentId() && !(s.id in _other); });
                if (missing && !_busy) loadAll();
            } catch (e) {}
            var merged = mergedList();
            // 标题/发布入口跟着模式走
            _syncTitle();
            _syncModeUI();
            var bak = null, swapped = false;
            try {
                if (typeof momentsData !== 'undefined' && momentsData) {
                    bak = momentsData.posts;
                    momentsData.posts = merged;
                    swapped = true;
                }
            } catch (e) {}
            try {
                return orig.apply(this, arguments);
            } finally {
                if (swapped) { try { momentsData.posts = bak; } catch (e) {} }
                decorate(merged);
            }
        };
        wrapped._aggWrapped = true;
        window._csRenderFeed = wrapped;

        _wrapFn('_mToggleLike');
        _wrapFn('_mFocusCmt');
        _wrapFn('_mSendComment');
        return true;
    }

    // 标题跟着模式走：全部 / 我的 / 他一个人的
    function _syncTitle() {
        try {
            var th = document.querySelector('.cs-feed-hd-title');
            if (th) th.textContent = _aggMode === 'owner' ? '他的朋友圈' : (_aggMode === 'mine' ? '我的朋友圈' : '朋友圈');
        } catch (e) {}
    }
    // 看别人空间时把"发动态"入口收起来（这是只读浏览，不是你自己那页）
    function _syncModeUI() {
        try {
            var page = document.getElementById('couple-space-page');
            if (page) page.classList.toggle('cs-viewing-owner', _aggMode === 'owner');
        } catch (e) {}
    }

    // 只显示我发的（点自己头像）
    window._mShowOnlyMine = function () {
        _aggMode = 'mine';
        _syncTitle();
        _syncModeUI();
        try {
            if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
            else if (typeof window.openCoupleSpace === 'function') window.openCoupleSpace();
        } catch (e) {}
        setTimeout(function () {
            try { if (typeof window._csRenderFeed === 'function') window._csRenderFeed(); } catch (e) {}
        }, 300);
    };
    // 只显示当前这位梦角的空间（点聊天页/动态里的他的头像）
    window._mShowOwner = function () {
        _aggMode = 'owner';
        _syncTitle();
        _syncModeUI();
        try {
            if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
            else if (typeof window.openCoupleSpace === 'function') window.openCoupleSpace();
        } catch (e) {}
        setTimeout(function () {
            try { if (typeof window._csRenderFeed === 'function') window._csRenderFeed(); } catch (e) {}
        }, 300);
    };
    // 回到所有人
    window._mShowAllPeople = function () {
        _aggMode = 'all';
        _syncTitle();
        _syncModeUI();
        try { if (typeof window._csRenderFeed === 'function') window._csRenderFeed(); } catch (e) {}
    };

    // 点空头像区域/名字 → 进他的空间
    function bindFeedClicks() {
        document.addEventListener('click', function (e) {
            var t = e.target.closest('[data-owner]');
            if (!t) return;
            // 只在"动态卡片里的头像/名字"上生效，别把点赞按钮也吞了
            if (!t.classList.contains('cs-post-av') && !t.classList.contains('cs-post-name')) return;
            var oid = t.getAttribute('data-owner');
            if (!oid) return;
            var card = t.closest('.cs-post');
            var pid = card && card.getAttribute('data-pid');
            e.stopPropagation(); e.preventDefault();

            // 我的头像 → 只看我发的（所有人的"我"合在一起）
            var merged = mergedList();
            var hit = merged.filter(function (p) { return String(p.id) === String(pid); })[0];
            if (hit && hit._ownerIsMe) {
                if (typeof window._mShowOnlyMine === 'function') window._mShowOnlyMine();
                return;
            }
            // 当前这位梦角：不用切会话，直接把动态流收成他一个人的空间
            if (oid === _currentId()) {
                _aggMode = 'owner';
                _syncTitle();
                _syncModeUI();
                try { if (typeof window._csRenderFeed === 'function') window._csRenderFeed(); } catch (e) {}
                var panel = document.getElementById('cs-panel-feed');
                if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                if (typeof showNotification === 'function') showNotification('只看 ' + ((hit && hit._ownerName) || '他') + ' 的空间', 'info', 1000);
                return;
            }
            _goOwner(pid, function () {
                // 切过去之后进他本人的空间（只看他的朋友圈）
                if (typeof window._mShowOwner === 'function') window._mShowOwner();
                else if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
            });
        }, true);
    }

    function boot() {
        if (!install()) { setTimeout(function () { if (install()) loadAll(); }, 400); return; }
        loadAll();
        bindFeedClicks();
        // 切换梦角后，其他人的动态要重新读（当前会话变了）
        window.addEventListener('session:switched', function () { _loaded = false; _other = {}; setTimeout(loadAll, 50); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
    setTimeout(boot, 900);
    setTimeout(loadAll, 2500);
})();
