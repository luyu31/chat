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
        var name = s.name || '未命名';
        var avatar = null;
        try {
            var st = await localforage.getItem(p + s.id + '_chatSettings');
            if (st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
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
        _switchOverlay(name || '梦角');
        // 给过场留一帧，再跳；数据本来就是按 session 存的，重开才是安全的切法
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
        renderContacts();
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
            var id = row.getAttribute('data-id');
            var nm = (row.querySelector('.ct-name') || {}).textContent || '梦角';
            switchTo(id, nm);
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

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else setTimeout(install, 0);
    setTimeout(install, 800);
})();
