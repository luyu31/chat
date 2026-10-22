/* ────────────────────────────────────────────────────────────────
 * 我的梦角 · 联系人列表（多梦角切换）
 *
 * 底层直接用 App 早就有的"会话（session）"机制 —— 每个会话就是一个梦角，
 * 名字/头像/聊天记录/字卡/纪念日全都是按 session 隔离存储的
 * （core.js 里 getStorageKey() = APP_PREFIX + SESSION_ID + '_' + key）。
 * 所以这里只做"表面"这一层：把原来那个朴素的「会话管理」列表，
 * 换成微信那种带头像、名字、在线状态、点一下就进的联系人列表。
 *
 * 切换梦角 = 改 hash + reload。这是 App 原本就有的安全做法：
 * 每个梦角的数据是按 session 键存/取的，只有整页重开才能保证
 * "A 的账本绝不出现在 B 里"。所以这里不硬改内存，只把切换做得顺一点
 * （先显示"正在进入…"再跳，不让你觉得是闪退）。
 *
 * 注意：行元素故意用 .ct-row 而不是 .session-item ——
 * 这样 listeners.js 里那套老的会话点击逻辑（靠 closest('.session-item') 判断）
 * 完全不会碰我的行，避免一次点击被处理两遍。
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

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    // 读某个梦角的名字和头像（都按 session 键存在 localforage 里）
    async function _meta(s) {
        var p = _prefix();
        var recName = s.name || '';
        var userNamed = recName && recName.indexOf('会话 ') !== 0;
        var name = userNamed ? recName : '未命名';
        var avatar = null;
        try {
            var st = await localforage.getItem(p + s.id + '_chatSettings');
            if (!userNamed && st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
        } catch (e) {}
        try { avatar = await localforage.getItem(p + s.id + '_partnerAvatar'); } catch (e) {}
        return {
            id: s.id,
            name: name,
            avatar: (typeof avatar === 'string' && avatar) ? avatar : null,
            online: s.online !== false,
            isCurrent: s.id === _currentId(),
            createdAt: s.createdAt || 0
        };
    }

    function _avatarHtml(m, size) {
        var s = size || 44;
        if (m.avatar) {
            return '<img src="' + _esc(m.avatar) + '" style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;object-fit:cover;display:block;flex-shrink:0;">';
        }
        return '<span style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:var(--border-color,#d8d8d8);' +
            'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
            '<i class="fas fa-user" style="font-size:' + Math.round(s * 0.44) + 'px;color:var(--text-secondary,#aaa);"></i></span>';
    }

    // ─── 列表渲染 ───
    async function renderContacts() {
        var list = document.getElementById('session-list');
        if (!list) return;
        var sessions = _sessions();
        if (!sessions.length) {
            list.innerHTML = '<div class="ct-empty">还没有梦角</div>';
            return;
        }

        var metas = await Promise.all(sessions.map(_meta));
        // 当前梦角排最前面，其余按创建时间
        metas.sort(function (a, b) {
            if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
            return b.createdAt - a.createdAt;
        });

        list.innerHTML = metas.map(function (m) {
            return '<div class="ct-row' + (m.isCurrent ? ' ct-row--cur' : '') + '" data-id="' + _esc(m.id) + '">' +
                '<div class="ct-av">' + _avatarHtml(m, 44) +
                    '<span class="ct-dot' + (m.online ? '' : ' ct-dot--off') + '"></span>' +
                '</div>' +
                '<div class="ct-info">' +
                    '<div class="ct-name">' + _esc(m.name) + '</div>' +
                    '<div class="ct-status">' + (m.online ? '在线' : '离线') +
                        (m.isCurrent ? '<span class="ct-cur-tag">当前</span>' : '') +
                    '</div>' +
                '</div>' +
                '<button class="ct-edit" data-id="' + _esc(m.id) + '" title="管理"><i class="fas fa-ellipsis"></i></button>' +
            '</div>';
        }).join('') +
        '<div class="ct-row ct-row--new" id="ct-new">' +
            '<div class="ct-av"><span class="ct-new-ic"><i class="fas fa-plus"></i></span></div>' +
            '<div class="ct-info"><div class="ct-name">添加梦角</div>' +
            '<div class="ct-status">新建一个独立的梦角，聊天记录、字卡、纪念日都各自独立</div></div>' +
        '</div>';
    }

    // ─── 切换（hash + reload，带一个"正在进入"的过场） ───
    function _switchOverlay(name) {
        var el = document.getElementById('ct-switch-overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ct-switch-overlay';
            document.body.appendChild(el);
        }
        el.innerHTML = '<div class="ct-switch-box"><div class="ct-switch-spin"></div>' +
            '<div class="ct-switch-txt">正在进入 ' + _esc(name) + '…</div></div>';
        // 强制一次样式计算，保证过渡生效
        void el.offsetWidth;
        el.classList.add('on');
    }

    function switchTo(id, name) {
        if (!id || id === _currentId()) return;
        // 统一走微信首页那套切换：过场 + 跳过开场动画，两个入口手感一致
        if (typeof window.WxSwitchTo === 'function') { window.WxSwitchTo(id, name); return; }
        _switchOverlay(name || '梦角');
        setTimeout(function () {
            try { window.location.hash = id; } catch (e) {}
            try { window.location.reload(); } catch (e) {}
        }, 160);
    }

    // ─── 新建 ───
    async function createContact() {
        var name = prompt('新梦角叫什么名字？（之后也能在聊天设置里改）', '');
        if (name === null) return;
        name = String(name).trim();
        if (!name) name = '新梦角';
        if (typeof createNewSession !== 'function') {
            if (typeof showNotification === 'function') showNotification('创建失败：会话模块未就绪', 'error');
            return;
        }
        var id = await createNewSession(false);   // 先建不切
        var arr = _sessions();
        var rec = arr.find(function (s) { return s.id === id; });
        if (rec) {
            rec.name = name;
            rec.online = true;
            try { await localforage.setItem(_prefix() + 'sessionList', arr); } catch (e) {}
        }
        // 关键：把名字也写进这个新会话自己的 chatSettings。
        // 不写的话它一进去是"空设置"，聊天头部会沿用上一个梦角的名字 ——
        // 这就是"新加的角色显示的却是上一个角色"的由来。
        try {
            var st = (await localforage.getItem(_prefix() + id + '_chatSettings')) || {};
            st.partnerName = name;
            await localforage.setItem(_prefix() + id + '_chatSettings', st);
        } catch (e) {}
        // 新梦角从零开始：把这些按会话存的核心数据显式初始化成空，
        // 避免它去读上一位梦角的存档、或者触发任何"从备份恢复"的兜底
        try {
            var pnew = _prefix() + id;
            await Promise.allSettled([
                localforage.setItem(pnew + '_chatMessages', []),
                localforage.setItem(pnew + '_momentsData', { posts: [], notifications: [] }),
                localforage.setItem(pnew + '_envelopeData', { outbox: [], inbox: [] }),
                localforage.setItem(pnew + '_moodCalendar', {}),
                localforage.setItem(pnew + '_anniversaries', [])
            ]);
        } catch (e) {}
        renderContacts();
        if (typeof window.WxRefreshConvs === 'function') window.WxRefreshConvs();
        if (typeof window.WxRefreshContacts === 'function') window.WxRefreshContacts();
        if (typeof showNotification === 'function') showNotification('已添加梦角：' + name, 'success');
    }

    // ─── 管理（重命名 / 删除 / 在线状态） ───
    async function manageContact(id) {
        var arr = _sessions();
        var rec = arr.find(function (s) { return s.id === id; });
        if (!rec) return;
        var meta = await _meta(rec);
        var choice = prompt(
            '管理「' + meta.name + '」\n\n' +
            '1 = 重命名\n' +
            '2 = 切换在线状态（现在：' + (meta.online ? '在线' : '离线') + '）\n' +
            '3 = 删除这个梦角\n\n' +
            '输入序号：', '1');
        if (choice === null) return;
        choice = String(choice).trim();

        if (choice === '1') {
            var nn = prompt('新的名字：', meta.name);
            if (nn === null) return;
            nn = String(nn).trim();
            if (!nn) return;
            rec.name = nn;
            try { await localforage.setItem(_prefix() + 'sessionList', arr); } catch (e) {}
            if (typeof showNotification === 'function') showNotification('已重命名为 ' + nn, 'success');
        } else if (choice === '2') {
            rec.online = !(rec.online !== false);
            try { await localforage.setItem(_prefix() + 'sessionList', arr); } catch (e) {}
        } else if (choice === '3') {
            if (arr.length <= 1) {
                if (typeof showNotification === 'function') showNotification('至少得留一个梦角', 'warning');
                return;
            }
            if (!confirm('删除「' + meta.name + '」及其全部聊天记录？不可恢复')) return;
            var p = _prefix();
            arr = arr.filter(function (s) { return s.id !== id; });
            try { await localforage.setItem(p + 'sessionList', arr); } catch (e) {}
            // 清掉这个会话的所有键（localforage + localStorage）
            try {
                var keys = await localforage.keys();
                for (var i = 0; i < keys.length; i++) {
                    if (keys[i].indexOf(p + id + '_') === 0) localforage.removeItem(keys[i]).catch(function () {});
                }
            } catch (e) {}
            Object.keys(localStorage).forEach(function (k) {
                if (k.indexOf(p + id + '_') === 0) { try { localStorage.removeItem(k); } catch (e) {} }
            });
            if (id === _currentId()) {   // 删的是当前梦角 → 跳到剩下的第一个
                var next = arr[0];
                if (next) { _switchOverlay(next.name || '梦角'); setTimeout(function () {
                    try { window.location.hash = next.id; window.location.reload(); } catch (e) {}
                }, 160); return; }
            }
            if (typeof showNotification === 'function') showNotification('已删除', 'success');
        }
        renderContacts();
        if (typeof window.WxRefreshConvs === 'function') window.WxRefreshConvs();
        if (typeof window.WxRefreshContacts === 'function') window.WxRefreshContacts();
    }

    // ─── 联系人详情页（只有你选的 4 项：发消息 / 编辑主页 / 在线状态 / 聊天背景） ───
    function _sessKey(id, base) { return _prefix() + id + '_' + base; }

    // 当前梦角：改完要同步到"活着"的那一份，不然界面要等重载才变
    function _applyToLiveProfile(meta, patch) {
        if (meta.id !== _currentId()) return;
        try {
            if (patch.name != null && typeof settings !== 'undefined' && settings) {
                settings.partnerName = patch.name;
                var nEl = document.getElementById('partner-name');
                if (nEl) nEl.textContent = patch.name;
            }
            if (patch.signature != null && typeof settings !== 'undefined' && settings) {
                settings.partnerSignature = patch.signature;
            }
            if (patch.avatar !== undefined) {
                window._avatarCache = window._avatarCache || {};
                window._avatarCache.partner = patch.avatar || null;
                var host = (typeof DOMElements !== 'undefined' && DOMElements.partner) ? DOMElements.partner.avatar : null;
                if (host) {
                    host.innerHTML = patch.avatar
                        ? '<img src="' + _esc(patch.avatar) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                        : '<i class="fas fa-user"></i>';
                }
            }
            if (patch.bg !== undefined && typeof window.applyBackground === 'function') {
                window.applyBackground(patch.bg || '');
            }
            if (typeof saveData === 'function') saveData();
        } catch (e) { console.warn('[contacts] 同步到当前梦角失败', e); }
    }

    async function openContactDetail(id) {
        var s = _sessions().filter(function (x) { return x.id === id; })[0];
        if (!s) return;
        var m = await _meta(s);
        var sheet = await _readProfile(id);
        var old = document.getElementById('ct-detail');
        if (old) old.remove();

        var el = document.createElement('div');
        el.id = 'ct-detail';
        el.innerHTML =
            '<div class="ct-d-sheet">' +
                '<div class="ct-d-head">' +
                    '<div class="ct-d-av">' + _avatarHtml({ avatar: sheet.avatar }, 64) + '</div>' +
                    '<div class="ct-d-names">' +
                        '<div class="ct-d-name">' + _esc(sheet.name) + '</div>' +
                        '<div class="ct-d-sig">' + _esc(sheet.signature || '这个人很懒，什么都没写') + '</div>' +
                        '<div class="ct-d-online' + (m.online ? '' : ' off') + '">' +
                            '<span class="ct-d-dot"></span>' + (m.online ? '在线' : '离线') +
                            (m.isCurrent ? '<span class="ct-d-cur">当前</span>' : '') +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="ct-d-rows">' +
                    '<div class="ct-d-row" data-act="msg"><i class="fas fa-comment"></i><span>发消息</span><i class="fas fa-chevron-right"></i></div>' +
                    '<div class="ct-d-row" data-act="edit"><i class="fas fa-pen"></i><span>编辑主页</span><i class="fas fa-chevron-right"></i></div>' +
                    '<div class="ct-d-row" data-act="online"><i class="fas fa-circle"></i><span>在线状态</span><span class="ct-d-val">' + (m.online ? '在线' : '离线') + '</span></div>' +
                    '<div class="ct-d-row" data-act="bg"><i class="fas fa-image"></i><span>聊天背景</span><i class="fas fa-chevron-right"></i></div>' +
                '</div>' +
                (m.isCurrent ? '' : '<div class="ct-d-tip">改动会直接写进他本人的存档，他下次进来就生效；当前这一位改完立刻生效</div>') +
                '<button class="ct-d-cancel" id="ct-d-cancel">关闭</button>' +
                '<input type="file" id="ct-d-avatar-input" accept="image/*" style="display:none;">' +
                '<input type="file" id="ct-d-bg-input" accept="image/*,.gif" style="display:none;">' +
            '</div>';
        document.body.appendChild(el);
        void el.offsetWidth;
        el.classList.add('on');

        function close() { el.classList.remove('on'); setTimeout(function () { el.remove(); }, 200); }
        el.querySelector('#ct-d-cancel').addEventListener('click', close);
        el.addEventListener('click', function (e) { if (e.target === el) close(); });

        // 头像选择
        el.querySelector('#ct-d-avatar-input').addEventListener('change', async function (e) {
            var f = e.target.files && e.target.files[0];
            if (!f) return;
            var dataUrl = await new Promise(function (res) {
                var r = new FileReader(); r.onload = function (ev) { res(ev.target.result); }; r.readAsDataURL(f);
            });
            try { await localforage.setItem(_sessKey(id, 'partnerAvatar'), dataUrl); } catch (err) {}
            _applyToLiveProfile(m, { avatar: dataUrl });
            close(); openContactDetail(id);
            if (typeof showNotification === 'function') showNotification('头像已更新', 'success');
        });
        // 背景选择
        el.querySelector('#ct-d-bg-input').addEventListener('change', async function (e) {
            var f = e.target.files && e.target.files[0];
            if (!f) return;
            var dataUrl = await new Promise(function (res) {
                var r = new FileReader(); r.onload = function (ev) { res(ev.target.result); }; r.readAsDataURL(f);
            });
            try { await localforage.setItem(_sessKey(id, 'chatBackground'), dataUrl); } catch (err) {}
            try { localStorage.setItem(_sessKey(id, 'chatBackground'), dataUrl); } catch (err) {}
            _applyToLiveProfile(m, { bg: dataUrl });
            close();
            if (typeof showNotification === 'function') showNotification('聊天背景已更新', 'success');
        });

        el.querySelector('.ct-d-rows').addEventListener('click', async function (e) {
            var row = e.target.closest('.ct-d-row');
            if (!row) return;
            var act = row.getAttribute('data-act');

            if (act === 'msg') {
                close();
                // 把「我的梦角」面板一起收掉：不然它盖在聊天页上面，
                // 名字已经切了、聊天也换了，肉眼看到的还是原来那一屏列表。
                try {
                    var sm = document.getElementById('session-modal');
                    var cb = document.getElementById('cancel-session');
                    if (sm && sm.style.display !== 'none') {
                        if (cb) cb.click();
                        else sm.style.display = 'none';
                    }
                } catch (err) {}
                if (id === _currentId()) { if (typeof window.WxHomeEnter === 'function') window.WxHomeEnter(); return; }
                setTimeout(function () { switchTo(id, sheet.name); }, 180);
                return;
            }
            if (act === 'edit') {
                var nn = prompt('昵称：', sheet.name);
                if (nn !== null && String(nn).trim()) {
                    try {
                        var st = (await localforage.getItem(_sessKey(id, 'chatSettings'))) || {};
                        st.partnerName = String(nn).trim();
                        await localforage.setItem(_sessKey(id, 'chatSettings'), st);
                    } catch (err) {}
                    _applyToLiveProfile(m, { name: String(nn).trim() });
                }
                var sg = prompt('个性签名（留空则不显示）：', sheet.signature || '');
                if (sg !== null) {
                    try {
                        var st2 = (await localforage.getItem(_sessKey(id, 'chatSettings'))) || {};
                        st2.partnerSignature = String(sg).trim();
                        await localforage.setItem(_sessKey(id, 'chatSettings'), st2);
                    } catch (err) {}
                    _applyToLiveProfile(m, { signature: String(sg).trim() });
                }
                if (confirm('要不要顺便换头像？')) {
                    document.getElementById('ct-d-avatar-input').click();
                    return;
                }
                close(); openContactDetail(id);
                renderContacts();
                if (typeof showNotification === 'function') showNotification('主页已更新', 'success');
                return;
            }
            if (act === 'online') {
                var arr = _sessions();
                var rec = arr.filter(function (x) { return x.id === id; })[0];
                if (rec) {
                    rec.online = !(rec.online !== false);
                    try { await localforage.setItem(_prefix() + 'sessionList', arr); } catch (err) {}
                }
                close(); openContactDetail(id);
                renderContacts();
                return;
            }
            if (act === 'bg') { document.getElementById('ct-d-bg-input').click(); return; }
        });
    }

    // 读某个梦角的资料（昵称/签名/头像）
    async function _readProfile(id) {
        var name = '未命名', signature = '', avatar = null;
        try {
            var st = await localforage.getItem(_sessKey(id, 'chatSettings'));
            if (st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
            if (st && st.partnerSignature) signature = st.partnerSignature;
        } catch (e) {}
        try { avatar = await localforage.getItem(_sessKey(id, 'partnerAvatar')); } catch (e) {}
        return { name: name, signature: signature, avatar: avatar };
    }

    // ─── 接管列表点击 ───
    function bind() {
        var list = document.getElementById('session-list');
        if (!list || list._ctBound) return;
        list._ctBound = true;
        list.addEventListener('click', function (e) {
            var editBtn = e.target.closest('.ct-edit');
            if (editBtn) { e.stopPropagation(); manageContact(editBtn.getAttribute('data-id')); return; }
            if (e.target.closest('#ct-new')) { e.stopPropagation(); createContact(); return; }
            var row = e.target.closest('.ct-row');
            if (!row || !row.getAttribute('data-id')) return;
            e.stopPropagation();
            openContactDetail(row.getAttribute('data-id'));   // 点进他的资料页，发消息在资料页里
        });
    }

    function install() {
        bind();
        // 老的「新建会话」按钮是 listeners.js 直接绑的（拿不到引用没法 unbind），
        // 用一个克隆节点把它换掉：克隆不带任何监听器，绑定关系干净转移到我这边
        var oldBtn = document.getElementById('create-new-session');
        if (oldBtn && !oldBtn._ctSwapped) {
            var nb = oldBtn.cloneNode(true);
            nb._ctSwapped = true;
            nb.addEventListener('click', function (e) { e.stopPropagation(); createContact(); });
            oldBtn.parentNode.replaceChild(nb, oldBtn);
        }
        // 老渲染器（games.js 的 renderSessionList）换成我们的；
        // 它俩是同一个全局绑定，所以覆盖后 listeners.js 里那句裸调用也会走到这里
        window.renderSessionList = renderContacts;
    }

    window.openContactsPanel = function () {
        install();
        renderContacts();
        var modal = document.getElementById('session-modal');
        if (modal && typeof showModal === 'function') showModal(modal);
    };

    // 给微信首页复用同一套切换逻辑（点会话列表里不是当前那条时走这里）
    window.ContactsSwitchTo = function (id, name) { switchTo(id, name); };
    // 通讯录 tab 的"编辑"按钮直接打开他本人的资料卡
    window.openContactDetail = function (id) { return openContactDetail(id); };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else setTimeout(install, 0);
    setTimeout(install, 800);
})();
