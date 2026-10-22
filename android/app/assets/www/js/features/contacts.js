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

    // ─── 漂亮的自定义弹窗（替代原生 alert / confirm / prompt） ──────────────
    function _mkModal(id, html) {
        var el = document.createElement('div');
        el.id = id;
        el.className = 'ct-modal-mask';
        el.innerHTML = html;
        document.body.appendChild(el);
        void el.offsetWidth;
        el.classList.add('on');
        return el;
    }
    window.ctConfirm = function (title, msg, okText, cancelText, danger) {
        return new Promise(function (resolve) {
            var el = _mkModal('ct-confirm-' + Date.now(),
                '<div class="ct-modal-card">' +
                    '<div class="ct-modal-title">' + _esc(title || '提示') + '</div>' +
                    (msg ? '<div class="ct-modal-msg">' + _esc(msg) + '</div>' : '') +
                    '<div class="ct-modal-btns">' +
                        '<button class="ct-modal-btn ct-modal-btn--cancel" data-k="no">' + _esc(cancelText || '取消') + '</button>' +
                        '<button class="ct-modal-btn ct-modal-btn--ok' + (danger ? ' ct-modal-btn--danger' : '') + '" data-k="yes">' + _esc(okText || '确定') + '</button>' +
                    '</div>' +
                '</div>');
            function cleanup() { el.classList.remove('on'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200); }
            el.addEventListener('click', function (e) {
                var btn = e.target.closest('.ct-modal-btn');
                if (!btn) return;
                cleanup();
                resolve(btn.getAttribute('data-k') === 'yes');
            });
            el.addEventListener('click', function (e) { if (e.target === el) { cleanup(); resolve(false); } });
        });
    };
    window.ctPrompt = function (title, placeholder, defaultValue, okText, cancelText) {
        return new Promise(function (resolve) {
            var el = _mkModal('ct-prompt-' + Date.now(),
                '<div class="ct-modal-card">' +
                    '<div class="ct-modal-title">' + _esc(title || '输入') + '</div>' +
                    '<textarea class="ct-modal-input" rows="3" placeholder="' + _esc(placeholder || '') + '">' + _esc(defaultValue || '') + '</textarea>' +
                    '<div class="ct-modal-btns">' +
                        '<button class="ct-modal-btn ct-modal-btn--cancel" data-k="no">' + _esc(cancelText || '取消') + '</button>' +
                        '<button class="ct-modal-btn ct-modal-btn--ok" data-k="yes">' + _esc(okText || '确定') + '</button>' +
                    '</div>' +
                '</div>');
            var ta = el.querySelector('.ct-modal-input');
            setTimeout(function () { try { ta.focus(); ta.select(); } catch (e) {} }, 60);
            function cleanup() { el.classList.remove('on'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200); }
            el.addEventListener('click', function (e) {
                var btn = e.target.closest('.ct-modal-btn');
                if (!btn) return;
                var v = ta ? String(ta.value == null ? '' : ta.value).trim() : '';
                cleanup();
                resolve(btn.getAttribute('data-k') === 'yes' ? v : null);
            });
            el.addEventListener('click', function (e) { if (e.target === el) { cleanup(); resolve(null); } });
        });
    };

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
        }).join('');
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
        var name = await (window.ctPrompt
            ? window.ctPrompt('新梦角', '他叫什么名字？（之后也能在聊天设置里改）', '', '创建', '取消')
            : Promise.resolve(prompt('新梦角叫什么名字？（之后也能在聊天设置里改）', '')));
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

    // ─── 管理（ellipsis 菜单：重命名 / 删除 / 在线状态） ───
    async function manageContact(id) {
        var arr = _sessions();
        var rec = arr.find(function (s) { return s.id === id; });
        if (!rec) return;
        var meta = await _meta(rec);

        var choice;
        if (window.ctConfirm) {
            // 漂亮的选项弹窗
            choice = await new Promise(function (resolve) {
                var el = _mkModal('ct-mgr-' + Date.now(),
                    '<div class="ct-modal-card">' +
                        '<div class="ct-modal-title">管理「' + _esc(meta.name) + '」</div>' +
                        '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">' +
                            '<button class="ct-modal-btn" data-k="rename" style="background:var(--primary-bg);color:var(--text-primary);border:1px solid var(--border-color);padding:12px 0;font-weight:500;">重命名</button>' +
                            '<button class="ct-modal-btn" data-k="online" style="background:var(--primary-bg);color:var(--text-primary);border:1px solid var(--border-color);padding:12px 0;font-weight:500;">切换在线状态（当前：' + (meta.online ? '在线' : '离线') + '）</button>' +
                            '<button class="ct-modal-btn" data-k="delete" style="background:linear-gradient(135deg,#f87171,#e5534b);color:#fff;padding:12px 0;font-weight:500;box-shadow:0 4px 14px rgba(229,83,75,.3);">删除这个梦角</button>' +
                        '</div>' +
                        '<button class="ct-modal-btn ct-modal-btn--cancel" data-k="cancel">取消</button>' +
                    '</div>');
                function cleanup() { el.classList.remove('on'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200); }
                el.addEventListener('click', function (e) {
                    var btn = e.target.closest('.ct-modal-btn');
                    if (!btn) return;
                    cleanup();
                    resolve(btn.getAttribute('data-k'));
                });
                el.addEventListener('click', function (e) { if (e.target === el) { cleanup(); resolve('cancel'); } });
            });
        } else {
            choice = prompt(
                '管理「' + meta.name + '」\n\n' +
                '1 = 重命名\n' +
                '2 = 切换在线状态\n' +
                '3 = 删除\n\n输入序号：', '1');
            if (choice === null) return;
            choice = ({ '1': 'rename', '2': 'online', '3': 'delete' })[String(choice).trim()] || 'cancel';
        }

        if (choice === 'cancel') return;
        if (choice === 'rename') {
            var nn = await (window.ctPrompt
                ? window.ctPrompt('改名字', '新的名字', meta.name, '确定', '取消')
                : Promise.resolve(prompt('新的名字：', meta.name)));
            if (nn === null) return;
            nn = String(nn).trim();
            if (!nn) return;
            rec.name = nn;
            try { await localforage.setItem(_prefix() + 'sessionList', arr); } catch (e) {}
            if (typeof showNotification === 'function') showNotification('已重命名为 ' + nn, 'success');
            renderContacts();
        } else if (choice === 'online') {
            rec.online = !(rec.online !== false);
            try { await localforage.setItem(_prefix() + 'sessionList', arr); } catch (e) {}
            renderContacts();
        } else if (choice === 'delete') {
            if (arr.length <= 1) {
                if (typeof showNotification === 'function') showNotification('至少得留一个梦角呀', 'warning');
                return;
            }
            var sure = await (window.ctConfirm
                ? window.ctConfirm('删除梦角', '确定要删除「' + meta.name + '」吗？他的聊天记录、动态、字卡都会一起删掉，不可恢复。', '删除', '再想想', true)
                : Promise.resolve(confirm('删除「' + meta.name + '」及其全部聊天记录？不可恢复')));
            if (!sure) return;

            var p = _prefix();
            arr = arr.filter(function (s) { return s.id !== id; });
            try { await localforage.setItem(p + 'sessionList', arr); } catch (e) {}
            try {
                var keys = await localforage.keys();
                for (var i = 0; i < keys.length; i++) {
                    if (keys[i].indexOf(p + id + '_') === 0) localforage.removeItem(keys[i]).catch(function () {});
                }
            } catch (e) {}
            Object.keys(localStorage).forEach(function (k) {
                if (k.indexOf(p + id + '_') === 0) { try { localStorage.removeItem(k); } catch (e) {} }
            });
            renderContacts();
            if (typeof window.WxRefreshConvs === 'function') window.WxRefreshConvs();
            if (typeof window.WxRefreshContacts === 'function') window.WxRefreshContacts();
            if (id === _currentId()) {
                var next = arr[0];
                if (next) { _switchOverlay(next.name || '梦角'); setTimeout(function () {
                    try { window.location.hash = next.id; window.location.reload(); } catch (e) {}
                }, 160); return; }
            }
            if (typeof showNotification === 'function') showNotification('已删除「' + meta.name + '」', 'success');
        }
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
                '<div class="ct-d-danger-row" data-act="delete">' +
                    '<i class="fas fa-trash-can"></i><span>删除' + (m.isCurrent ? '当前' : '') + '梦角</span>' +
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

        // 资料卡内所有点按行为（普通行 + 删除按钮 + 头像/背景文件选择器）
        el.addEventListener('click', async function (e) {
            var row = e.target.closest('.ct-d-row');
            if (!row) row = e.target.closest('.ct-d-danger-row');
            if (!row) return;
            var act = row.getAttribute('data-act');

            if (act === 'msg') {
                close();
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
                var nn = await (window.ctPrompt ? window.ctPrompt('改昵称', '输入新的名字', sheet.name, '确定', '取消')
                                                 : Promise.resolve(prompt('昵称：', sheet.name)));
                if (nn !== null && String(nn).trim()) {
                    try {
                        var st = (await localforage.getItem(_sessKey(id, 'chatSettings'))) || {};
                        st.partnerName = String(nn).trim();
                        await localforage.setItem(_sessKey(id, 'chatSettings'), st);
                    } catch (err) {}
                    _applyToLiveProfile(m, { name: String(nn).trim() });
                }
                var sg = await (window.ctPrompt ? window.ctPrompt('个性签名（留空则不显示）', '', sheet.signature || '', '确定', '取消')
                                                 : Promise.resolve(prompt('个性签名（留空则不显示）：', sheet.signature || '')));
                if (sg !== null) {
                    try {
                        var st2 = (await localforage.getItem(_sessKey(id, 'chatSettings'))) || {};
                        st2.partnerSignature = String(sg).trim();
                        await localforage.setItem(_sessKey(id, 'chatSettings'), st2);
                    } catch (err) {}
                    _applyToLiveProfile(m, { signature: String(sg).trim() });
                    // 聊天头部的签名条同步刷新
                    try { if (window._chdRefresh) window._chdRefresh(); } catch (err) {}
                }
                var wantChangeAv = await (window.ctConfirm
                    ? window.ctConfirm('换头像？', '要不要顺便换一下头像？', '好，换', '下次吧')
                    : Promise.resolve(confirm('要不要顺便换头像？')));
                if (wantChangeAv) { document.getElementById('ct-d-avatar-input').click(); return; }
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
            if (act === 'delete') {
                var sessions = _sessions();
                if (sessions.length <= 1) {
                    if (typeof showNotification === 'function') showNotification('至少得留一个梦角呀', 'warning');
                    return;
                }
                var sure = await (window.ctConfirm
                    ? window.ctConfirm('删除梦角', '确定要删除「' + sheet.name + '」吗？他的聊天记录、动态、字卡都会一起删掉，不可恢复。', '删除', '再想想', true)
                    : Promise.resolve(confirm('删除「' + sheet.name + '」及其全部聊天记录？不可恢复')));
                if (!sure) return;

                var p = _prefix();
                sessions = sessions.filter(function (s) { return s.id !== id; });
                try { await localforage.setItem(p + 'sessionList', sessions); } catch (e) {}
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

                close();
                renderContacts();
                if (typeof window.WxRefreshConvs === 'function') window.WxRefreshConvs();
                if (typeof window.WxRefreshContacts === 'function') window.WxRefreshContacts();

                if (id === _currentId()) {
                    var next = sessions[0];
                    if (next) {
                        var nm = next.name || '梦角';
                        if (typeof window.WxSwitchTo === 'function') { window.WxSwitchTo(next.id, nm); return; }
                        window.location.hash = next.id;
                        window.location.reload();
                    }
                } else {
                    if (typeof showNotification === 'function') showNotification('已删除「' + sheet.name + '」', 'success');
                }
                return;
            }
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
            var row = e.target.closest('.ct-row');
            if (!row || !row.getAttribute('data-id')) return;
            e.stopPropagation();
            openContactDetail(row.getAttribute('data-id'));   // 点进他的资料页，发消息在资料页里
        });
    }

    function install() {
        bind();
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
})();
