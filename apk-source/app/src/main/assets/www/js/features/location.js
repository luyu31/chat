/* ============================================================
   位置功能 v2（"+"菜单 → 位置）
   - 不用真实地图/真实坐标：卡片只显示"两人相距多远"（虚拟距离，
     随机生成一次后固定在这条消息上，双方卡片共用同一个距离）
   - 发送后 ta 有概率也回一张自己的位置卡片（同一个距离）
   - 常用位置记录（localforage: cx_fav_locations，最多 8 个）
   ============================================================ */
(function () {
    'use strict';

    var FAV_KEY = 'cx_fav_locations';

    var ECHO_NAMES = ['家里', '公司', '学校', '楼下超市', '在梦里', '你猜我在哪', '老地方', '路上'];
    var FOOT_LINES = ['见面要趁早呀', '心在一起就不算远', '说远不远，说近不近', '风一吹就到了', '想见你的心比这近多了'];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function partnerName() { return (typeof settings !== 'undefined' && settings.partnerName) || '对方'; }

    // ── 虚拟距离：一次生成，双方共用 ─────────────────────────
    function randomDistance() {
        var r = Math.random();
        if (r < 0.35) return Math.round(20 + Math.random() * 800) + 'm';        // 20~820米
        if (r < 0.75) return (Math.random() * 9 + 1).toFixed(1) + 'km';         // 1.0~10.0km
        return Math.round(10 + Math.random() * 40) + 'km';                      // 10~50km
    }
    function footLine(id) {
        return FOOT_LINES[Math.abs(String(id).split('').reduce(function (a, c) { return a + c.charCodeAt(0); }, 0)) % FOOT_LINES.length];
    }

    // ── 样式注入 ────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('cx-location-styles')) return;
        var st = document.createElement('style');
        st.id = 'cx-location-styles';
        st.textContent =
            '.cx-loc-card{width:100%;max-width:240px;border-radius:14px;overflow:hidden;background:var(--secondary-bg);user-select:none;}' +
            '.cx-loc-top{display:flex;align-items:center;gap:10px;padding:12px 12px 10px;}' +
            '.cx-loc-pin{width:34px;height:34px;border-radius:50% 50% 50% 0;background:#ff5b6a;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(255,91,106,.45);flex-shrink:0;}' +
            '.cx-loc-pin i{transform:rotate(45deg);color:#fff;font-size:14px;}' +
            '.cx-loc-name{font-size:14px;font-weight:700;color:var(--text-primary);line-height:1.35;word-break:break-all;}' +
            '.cx-loc-dist{font-size:12px;color:#ff5b6a;font-weight:700;margin-top:3px;}' +
            '.cx-loc-foot{font-size:10.5px;color:var(--text-secondary);opacity:.75;padding:6px 12px 9px;border-top:1px dashed var(--border-color, rgba(128,128,128,.25));display:flex;align-items:center;gap:4px;}' +
            '.cx-loc-input{width:100%;box-sizing:border-box;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:12px;padding:10px 12px;font-size:13.5px;background:var(--primary-bg);color:var(--text-primary);outline:none;}' +
            '.cx-loc-input:focus{border-color:var(--accent-color,#ff5b6a);}' +
            '.cx-loc-chip{display:inline-flex;align-items:center;gap:4px;padding:6px 11px;border-radius:999px;background:var(--primary-bg);border:1.5px solid var(--border-color,rgba(128,128,128,.25));font-size:12px;color:var(--text-primary);cursor:pointer;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.cx-loc-chip:hover{border-color:var(--accent-color,#ff5b6a);color:var(--accent-color,#ff5b6a);}' +
            '.cx-btn-main{width:100%;padding:11px;border:none;border-radius:12px;background:var(--accent-color,#ff5b6a);color:#fff;font-size:14px;font-weight:700;cursor:pointer;}' +
            '.cx-btn-ghost{width:100%;padding:11px;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:12px;background:transparent;color:var(--text-primary);font-size:13.5px;cursor:pointer;}' +
            '@keyframes cxFadeIn{from{opacity:0}to{opacity:1}}' +
            '@keyframes cxSlideIn{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:none}}';
        document.head.appendChild(st);
    }

    // ── 气泡渲染（core.js 调用） ─────────────────────────────
    function renderBubbleHTML(msg) {
        var loc = msg.location || {};
        var name = loc.name || '某个地方';
        var dist = loc.distance || '——';
        return (
            '<div class="cx-loc-card">' +
                '<div class="cx-loc-top">' +
                    '<div class="cx-loc-pin"><i class="fas fa-location-dot"></i></div>' +
                    '<div style="min-width:0;">' +
                        '<div class="cx-loc-name">' + esc(name) + '</div>' +
                        '<div class="cx-loc-dist"><i class="fas fa-heart" style="font-size:10px;"></i> 相距 ' + esc(dist) + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="cx-loc-foot"><i class="fas fa-paper-plane"></i> ' + esc(footLine(msg.id)) + '</div>' +
            '</div>'
        );
    }

    // ── 常用位置 ─────────────────────────────────────────────
    function loadFavs(cb) {
        localforage.getItem(FAV_KEY).then(function (v) { cb(Array.isArray(v) ? v : []); }).catch(function () { cb([]); });
    }
    function saveFav(loc) {
        if (!loc.name) return;
        loadFavs(function (list) {
            list = list.filter(function (l) { return l.name !== loc.name; });
            list.unshift(loc);
            localforage.setItem(FAV_KEY, list.slice(0, 8));
        });
    }

    // ── 发送 ────────────────────────────────────────────────
    function sendLocation(loc) {
        if (!loc || !loc.name) return;
        if (typeof addMessage === 'function') {
            addMessage({
                id: Date.now() + Math.random(),
                sender: 'user',
                text: '',
                timestamp: new Date(),
                status: 'sent',
                type: 'location',
                location: loc,
                favorited: false,
                note: null
            });
        }
        if (typeof playSound === 'function') playSound('send');
        if (typeof window._triggerDelayedReply === 'function') window._triggerDelayedReply(true);

        // ta 有概率也回一张位置卡片（相距同一个距离）
        if (Math.random() < 0.6) {
            setTimeout(function () {
                var name = partnerName();
                if (typeof addMessage !== 'function') return;
                addMessage({
                    id: Date.now() + Math.random(),
                    sender: name,
                    text: '',
                    timestamp: new Date(),
                    status: 'received',
                    type: 'location',
                    location: { name: ECHO_NAMES[Math.floor(Math.random() * ECHO_NAMES.length)], distance: loc.distance },
                    favorited: false,
                    note: null
                });
                if (typeof playSound === 'function') playSound('message');
                if (typeof window._sendPartnerNotification === 'function') {
                    window._sendPartnerNotification(name, '也分享了位置给你，相距 ' + loc.distance);
                }
            }, 1500 + Math.random() * 1500);
        }
    }

    // ── 弹窗 ────────────────────────────────────────────────
    var rememberFlag = false;

    function closeModal(overlay) { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    function openLocationModal() {
        injectStyles();
        rememberFlag = false;

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:cxFadeIn .2s ease;';
        overlay.innerHTML =
            '<div style="background:var(--secondary-bg);border-radius:20px;padding:22px;width:88%;max-width:350px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:cxSlideIn .25s ease forwards;max-height:82vh;overflow-y:auto;">' +
                '<div style="text-align:center;margin-bottom:16px;">' +
                    '<div style="width:52px;height:52px;border-radius:50%;background:rgba(255,91,106,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;"><i class="fas fa-location-dot" style="color:#ff5b6a;font-size:20px;"></i></div>' +
                    '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">发送位置</div>' +
                    '<div style="font-size:12px;color:var(--text-secondary);">告诉ta你在哪儿，卡片会显示你们相距多远</div>' +
                '</div>' +
                '<input id="cx-loc-name" class="cx-loc-input" placeholder="位置名称（必填，如：家里）" maxlength="40" style="margin-bottom:9px;">' +
                '<input id="cx-loc-addr" class="cx-loc-input" placeholder="备注（选填）" maxlength="60" style="margin-bottom:10px;">' +
                '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);margin-bottom:12px;cursor:pointer;">' +
                    '<input type="checkbox" id="cx-loc-remember" style="accent-color:#ff5b6a;"> 记住这个位置，下次一键发送' +
                '</label>' +
                '<div id="cx-loc-favs" style="margin-bottom:14px;"></div>' +
                '<div style="display:flex;gap:9px;">' +
                    '<button id="cx-loc-cancel" class="cx-btn-ghost" style="flex:1;">取消</button>' +
                    '<button id="cx-loc-send" class="cx-btn-main" style="flex:1.6;"><i class="fas fa-paper-plane"></i> 发送</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var nameInput = overlay.querySelector('#cx-loc-name');
        var addrInput = overlay.querySelector('#cx-loc-addr');
        var favsBox = overlay.querySelector('#cx-loc-favs');

        function renderFavs() {
            loadFavs(function (list) {
                if (!list.length) { favsBox.style.display = 'none'; return; }
                favsBox.style.display = 'block';
                favsBox.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">常用位置</div>' +
                    '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
                    list.map(function (l, i) {
                        return '<span class="cx-loc-chip" data-i="' + i + '"><i class="fas fa-clock-rotate-left" style="font-size:10px;opacity:.6;"></i>' + esc(l.name) + '</span>';
                    }).join('') + '</div>';
                favsBox.querySelectorAll('.cx-loc-chip').forEach(function (chip) {
                    chip.addEventListener('click', function () {
                        var l = list[Number(chip.dataset.i)];
                        if (!l) return;
                        nameInput.value = l.name;
                        addrInput.value = l.address || '';
                    });
                });
            });
        }
        renderFavs();

        overlay.querySelector('#cx-loc-remember').addEventListener('change', function (e) { rememberFlag = e.target.checked; });
        overlay.querySelector('#cx-loc-cancel').addEventListener('click', function () { closeModal(overlay); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay); });

        overlay.querySelector('#cx-loc-send').addEventListener('click', function () {
            var name = nameInput.value.trim();
            if (!name) { nameInput.focus(); if (typeof showNotification === 'function') showNotification('先给这个位置起个名字吧', 'info'); return; }
            var loc = { name: name, address: addrInput.value.trim(), distance: randomDistance() };
            if (rememberFlag) saveFav({ name: name, address: loc.address });
            closeModal(overlay);
            sendLocation(loc);
        });
    }

    // ── 注册进 "+" 菜单 ─────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        if (window.MoreMenu && typeof window.MoreMenu.registerItem === 'function') {
            window.MoreMenu.registerItem('location', { ready: true, action: openLocationModal });
        }
    });

    window.LocationMsg = {
        renderBubbleHTML: renderBubbleHTML,
        openModal: openLocationModal
    };
})();
