/* ────────────────────────────────────────────────────────────────
 * 群聊 v2 · 把「群」做成一种会话
 *
 * 摸排结果：core.js 其实已经写好了群聊的渲染 ——
 *   · getGroupMemberForMessage(msgId) 决定这条消息是谁发的
 *   · 气泡会按成员换头像、上面挂成员名字（core.js 1332~1374 行）
 * 缺的只有两件：
 *   ① 入口被 CSS 藏了，进不去（#group-chat-btn display:none）
 *   ② groupChatSettings 存在 localStorage 里、**不分梦角** —— 一开群聊，
 *      所有梦角的一对一聊天都会跟着变成"多人说话"
 *
 * 所以这里不动渲染，只做两件事：
 *   1. 把「群」落成一种会话：sessionList 里一条 {type:'group', members:[...]}，
 *      成员直接从已有梦角里挑 —— 这样每个成员的昵称/头像都是他本人的。
 *   2. 每次进聊天时，按"当前这条会话是不是群"，把 groupChatSettings 同步成对应值
 *      （core.js 读的就是这个全局对象），并接管 getGroupMemberForMessage 让它
 *      只认当前会话的成员 —— 一对一聊天因此不会被污染。
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

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
    function _curRecord() {
        var id = _currentId();
        return _sessions().filter(function (s) { return s.id === id; })[0] || null;
    }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    // ─── 成员信息：从成员自己的会话里取昵称和头像 ───
    var _memCache = {};      // 会话id → {name, avatar}
    async function _resolveMembers(ids) {
        var p = _prefix();
        var out = [];
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (_memCache[id]) { out.push(_memCache[id]); continue; }
            var name = '梦角', avatar = null;
            try {
                var st = await localforage.getItem(p + id + '_chatSettings');
                if (st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
            } catch (e) {}
            try { avatar = await localforage.getItem(p + id + '_partnerAvatar'); } catch (e) {}
            var rec = _sessions().filter(function (s) { return s.id === id; })[0];
            if (rec && rec.name && name === '梦角') name = rec.name;
            _memCache[id] = { id: id, name: name, avatar: avatar || null };
            out.push(_memCache[id]);
        }
        return out;
    }

    // ─── 把当前会话的群设置同步进 core.js 读的那个全局对象 ───
    var _curMembers = [];    // 当前会话的成员（已解析好头像），供 getGroupMemberForMessage 用
    function _syncForCurrentSession() {
        var rec = _curRecord();
        var isGroup = !!(rec && rec.type === 'group' && Array.isArray(rec.members) && rec.members.length);
        try {
            if (typeof groupChatSettings === 'undefined') return;
            groupChatSettings.enabled = isGroup;
            groupChatSettings.showName = isGroup ? (rec.gcShowName !== false) : (groupChatSettings.showName !== false);
            groupChatSettings.showAvatar = isGroup ? (rec.gcShowAvatar !== false) : (groupChatSettings.showAvatar !== false);
            if (isGroup) {
                // 成员先塞占位，头像异步补 —— 只影响渲染，不影响判断
                groupChatSettings.members = rec.members.map(function (id, i) {
                    var c = _memCache[id];
                    return { id: id, name: (c && c.name) || ('成员' + (i + 1)), avatarRef: 'gca_' + id, avatar: (c && c.avatar) || null };
                });
            } else {
                groupChatSettings.members = [];
            }
        } catch (e) { console.warn('[group-v2] 同步群设置失败', e); }

        if (isGroup) {
            _resolveMembers(rec.members).then(function (list) {
                _curMembers = list;
                try { groupChatSettings.members = list.map(function (m) { return { id: m.id, name: m.name, avatarRef: 'gca_' + m.id, avatar: m.avatar }; }); } catch (e) {}
                // 成员头像补好后，重画一次当前聊天，让气泡换成真人头像
                try { if (typeof window.renderMessages === 'function') window.renderMessages(); } catch (e) {}
            });
        } else {
            _curMembers = [];
        }
    }

    // ─── 接管"这条消息是谁发的"：只认当前会话的群成员 ───
    function _installResolver() {
        window.getGroupMemberForMessage = function (msgId) {
            var rec = _curRecord();
            if (!rec || rec.type !== 'group') return null;      // 一对一：永远返回 null（不受群设置影响）
            var list = _curMembers.length ? _curMembers
                : (rec.members || []).map(function (id, i) {
                    var c = _memCache[id];
                    return { id: id, name: (c && c.name) || ('成员' + (i + 1)), avatar: (c && c.avatar) || null };
                });
            if (!list.length) return null;
            var seed = 0, s = String(msgId);
            for (var i = 0; i < s.length; i++) seed += s.charCodeAt(i) * (i + 1);
            return list[seed % list.length];
        };
    }

    // ─── 新建群聊 ───
    async function createGroupChat(name, memberIds) {
        if (!memberIds || memberIds.length < 2) {
            if (typeof showNotification === 'function') showNotification('至少选两个梦角才能拉群', 'warning');
            return null;
        }
        if (typeof createNewSession !== 'function') return null;
        var id = await createNewSession(false);
        var arr = _sessions();
        var rec = arr.filter(function (s) { return s.id === id; })[0];
        if (rec) {
            rec.name = name || '群聊';
            rec.type = 'group';
            rec.members = memberIds.slice();
            rec.gcShowName = true;
            rec.gcShowAvatar = true;
            try { await localforage.setItem(_prefix() + 'sessionList', arr); } catch (e) {}
        }
        // 群名写进该会话自己的 chatSettings，这样聊天头部和会话列表都显示群名
        try {
            var st = (await localforage.getItem(_prefix() + id + '_chatSettings')) || {};
            st.partnerName = name || '群聊';
            await localforage.setItem(_prefix() + id + '_chatSettings', st);
        } catch (e) {}
        if (typeof showNotification === 'function') showNotification('群聊已创建：' + (name || '群聊'), 'success');
        return id;
    }

    // ─── 选人面板 ───
    async function openCreateGroupPicker() {
        var old = document.getElementById('gc-picker');
        if (old) old.remove();
        var sessions = _sessions().filter(function (s) { return s.type !== 'group'; });
        var metas = await Promise.all(sessions.map(async function (s) {
            var m = await _resolveMembers([s.id]);
            return m[0];
        }));

        var el = document.createElement('div');
        el.id = 'gc-picker';
        el.innerHTML =
            '<div class="ct-d-sheet">' +
                '<div class="wx-mp-title">拉个群 · 选成员</div>' +
                '<div class="gc-name-row"><input id="gc-name" class="gc-name-inp" placeholder="群名称（默认：梦角们的群）"></div>' +
                '<div class="gc-list" id="gc-list">' +
                    (metas.length ? metas.map(function (m) {
                        return '<label class="gc-item"><input type="checkbox" value="' + _esc(m.id) + '">' +
                            '<span class="gc-av">' + (m.avatar
                                ? '<img src="' + _esc(m.avatar) + '" style="width:38px;height:38px;border-radius:6px;object-fit:cover;">'
                                : '<span style="width:38px;height:38px;border-radius:6px;background:var(--border-color,#ddd);display:inline-flex;align-items:center;justify-content:center;"><i class="fas fa-user" style="color:#aaa;"></i></span>') +
                            '</span>' +
                            '<span class="gc-nm">' + _esc(m.name) + '</span></label>';
                    }).join('') : '<div class="wx-mp-loading">还没有别的梦角，先加一个</div>') +
                '</div>' +
                '<div class="gc-btns">' +
                    '<button class="ct-d-cancel" id="gc-cancel" style="margin:0;flex:1;">取消</button>' +
                    '<button class="gc-ok" id="gc-ok">创建群聊</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(el);
        void el.offsetWidth;
        el.classList.add('on');
        function close() { el.classList.remove('on'); setTimeout(function () { el.remove(); }, 200); }
        el.querySelector('#gc-cancel').addEventListener('click', close);
        el.addEventListener('click', function (e) { if (e.target === el) close(); });
        el.querySelector('#gc-ok').addEventListener('click', async function () {
            var ids = [].slice.call(el.querySelectorAll('#gc-list input:checked')).map(function (i) { return i.value; });
            var nm = (el.querySelector('#gc-name').value || '').trim();
            if (ids.length < 2) { if (typeof showNotification === 'function') showNotification('至少选两个梦角', 'warning'); return; }
            if (!nm) nm = ids.length + ' 人群聊';
            close();
            var gid = await createGroupChat(nm, ids);
            if (gid) {
                // 建完直接进去（走统一那套丝滑切换）
                setTimeout(function () {
                    if (typeof window.WxSwitchTo === 'function') window.WxSwitchTo(gid, nm);
                    else { try { window.location.hash = gid; window.location.reload(); } catch (e) {} }
                }, 200);
            }
        });
    }

    window.openCreateGroupPicker = openCreateGroupPicker;
    window.createGroupChat = createGroupChat;

    // ─── 强制纠正群名 ───
    // 实测踩到过：建完群切过去之后，群会话的 chatSettings.partnerName 会被
    // 上一次进度的"设置自动保存"覆盖成上一个梦角的名字（列表和头部就都显示了错名字）。
    // 这里在每次着陆到群会话时，把名字强制定回群名，并写回该会话自己的 chatSettings。
    function _enforceGroupName() {
        var rec = _curRecord();
        if (!rec || rec.type !== 'group') return;
        var nm = rec.name || '群聊';
        try {
            if (typeof settings !== 'undefined' && settings) settings.partnerName = nm;
            var nEl = document.getElementById('partner-name');
            if (nEl) nEl.textContent = nm;
        } catch (e) {}
        try {
            var key = _prefix() + rec.id + '_chatSettings';
            localforage.getItem(key).then(function (st) {
                st = st || {};
                if (st.partnerName !== nm) {
                    st.partnerName = nm;
                    return localforage.setItem(key, st);
                }
            }).catch(function () {});
        } catch (e) {}
    }

    // ─── 启动：同步一次 + 装好解析器 ───
    function boot() {
        _installResolver();
        _syncForCurrentSession();
        _enforceGroupName();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
    // core.js 的 sessionList 是异步读回来的，晚一点再同步一次
    setTimeout(boot, 900);
    setTimeout(boot, 2200);
})();
