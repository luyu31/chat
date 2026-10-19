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
        var name = s.name || '未命名';
        var avatar = null, preview = '', time = 0;
        try {
            var st = await localforage.getItem(p + s.id + '_chatSettings');
            if (st && st.partnerName && String(st.partnerName).trim()) name = st.partnerName;
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
        return { id: s.id, name: name, avatar: avatar, preview: preview, time: time, isCurrent: s.id === _currentId() };
    }

    // ─── DOM ───
    function buildHome() {
        if (document.getElementById('wx-home')) return;
        var el = document.createElement('div');
        el.id = 'wx-home';
        el.innerHTML =
            '<div class="wx-head"><span class="wx-head-title">微信</span>' +
                '<button class="wx-head-add" id="wx-add-btn" title="添加梦角"><i class="fas fa-plus"></i></button></div>' +
            '<div class="wx-conv-list" id="wx-conv-list"></div>' +
            '<div class="wx-tabbar">' +
                '<div class="wx-tab wx-tab--on" id="wx-tab-chat"><i class="fas fa-comment-dots"></i><span>聊天</span></div>' +
                '<div class="wx-tab" id="wx-tab-moments"><i class="fas fa-user-group"></i><span>朋友圈</span></div>' +
            '</div>';
        document.body.appendChild(el);

        el.querySelector('#wx-add-btn').addEventListener('click', function () {
            if (typeof window.openContactsPanel === 'function') window.openContactsPanel();
        });
        el.querySelector('#wx-tab-chat').addEventListener('click', function () { /* 已经在这一页 */ });
        el.querySelector('#wx-tab-moments').addEventListener('click', function () {
            // 家园的层级（1500）比首页（400）高，会盖在首页上面 ——
            // 所以这里不要把首页收起来：关掉家园后自然又回到这张列表，跟微信切标签一样
            try {
                if (typeof window.openMomentsWithTransition === 'function') window.openMomentsWithTransition();
                else if (typeof window.openCoupleSpace === 'function') window.openCoupleSpace();
            } catch (e) { console.warn('[wx-home] 打开家园失败', e); }
        });
        el.querySelector('#wx-conv-list').addEventListener('click', function (e) {
            var row = e.target.closest('.wx-conv');
            if (!row) return;
            var id = row.getAttribute('data-id');
            var nm = (row.querySelector('.wx-conv-name') || {}).textContent || '梦角';
            if (!id) return;
            if (id === _currentId()) { enterChat(); return; }
            // 换梦角：先记个标记，重开之后直接进聊天（而不是又回到首页）
            try { sessionStorage.setItem(FLAG, '1'); } catch (e) {}
            if (typeof window.ContactsSwitchTo === 'function') { window.ContactsSwitchTo(id, nm); return; }
            if (typeof showNotification === 'function') showNotification('正在进入 ' + nm + '…', 'info', 900);
            setTimeout(function () {
                try { window.location.hash = id; } catch (e) {}
                try { window.location.reload(); } catch (e) {}
            }, 160);
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
                        '<span class="wx-conv-name">' + _esc(m.name) + '</span>' +
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

    var _booted = false;
    function boot() {
        if (_booted) return;
        _booted = true;
        buildHome();
        injectBackBtn();
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
    }

    // sessionList 是 core.js 在 DOMContentLoaded 之后异步从 localforage 读回来的，
    // 而 defer 脚本执行得比它早 —— 早渲染会读到空数组，表现就是首页明明有梦角却写
    // "还没有梦角"。所以这里轮询等它就绪，再补渲染一次（只更新列表，不动显示状态，
    // 不会把已经进到聊天里的用户又弹回首页）。
    function waitSessionsAndRender(tries) {
        tries = tries || 0;
        var n = 0;
        try { n = _sessions().length; } catch (e) {}
        if (n > 0) { renderConvs(); return; }
        if (tries >= 40) { renderConvs(); return; }   // 最多等 10 秒，等不到就渲染空态
        setTimeout(function () { waitSessionsAndRender(tries + 1); }, 250);
    }

    // 暴露给"我的梦角"面板复用（同一套切换逻辑）
    window.WxHomeShow = showHome;
    window.WxHomeEnter = enterChat;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
    // 兜底：脚本注入顺序/欢迎层可能晚一点，再补一次
    setTimeout(boot, 1200);
})();
