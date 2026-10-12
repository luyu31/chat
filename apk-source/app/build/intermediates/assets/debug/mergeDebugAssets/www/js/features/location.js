/* ============================================================
   位置功能（"+"菜单 → 位置）
   - 弹窗：获取当前定位（WebView 原生权限桥）或手动填写位置名称
   - 常用位置记录（localforage: cx_fav_locations，最多 8 个，一键重发）
   - 消息类型 type:'location'，气泡渲染见本文件 renderBubbleHTML
     （core.js 渲染分支里已接入）
   - 点卡片打开高德地图网页版（uri.amap.com，无需 key）：
     APK 内走 AndroidBridge.openUrl（系统浏览器），纯网页环境走 window.open
   ============================================================ */
(function () {
    'use strict';

    var FAV_KEY = 'cx_fav_locations';
    var registry = {}; // locId -> location 对象（渲染卡片时登记，点击时取用，避免 onclick 里拼 JSON 转义地狱）

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }

    // ── 样式注入（独立 <style>，不碰受保护的 css 文件） ──────────
    function injectStyles() {
        if (document.getElementById('cx-location-styles')) return;
        var st = document.createElement('style');
        st.id = 'cx-location-styles';
        st.textContent =
            '.cx-loc-card{width:100%;max-width:240px;border-radius:14px;overflow:hidden;background:var(--secondary-bg);cursor:pointer;user-select:none;}' +
            '.cx-loc-map{height:74px;position:relative;background:linear-gradient(135deg,#dcefe3 0%,#cfe6f5 55%,#e8f2dc 100%);display:flex;align-items:center;justify-content:center;}' +
            '.cx-loc-map .cx-loc-grid{position:absolute;top:0;right:0;bottom:0;left:0;opacity:.5;' +
                'background-image:linear-gradient(rgba(255,255,255,.7) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.7) 1px,transparent 1px);background-size:22px 22px;}' +
            '.cx-loc-pin{width:34px;height:34px;border-radius:50% 50% 50% 0;background:#ff5b6a;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(255,91,106,.45);position:relative;z-index:1;}' +
            '.cx-loc-pin i{transform:rotate(45deg);color:#fff;font-size:14px;}' +
            '.cx-loc-pin::after{content:"";position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);width:26px;height:7px;border-radius:50%;background:rgba(0,0,0,.18);}' +
            '.cx-loc-body{padding:9px 12px 10px;}' +
            '.cx-loc-name{font-size:14px;font-weight:700;color:var(--text-primary);line-height:1.35;word-break:break-all;}' +
            '.cx-loc-addr{font-size:11.5px;color:var(--text-secondary);margin-top:3px;line-height:1.4;word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}' +
            '.cx-loc-foot{font-size:10.5px;color:var(--text-secondary);opacity:.75;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-color, rgba(128,128,128,.25));display:flex;align-items:center;gap:4px;}' +
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
        var locId = String(msg.id);
        registry[locId] = loc;
        var name = loc.name || '未知位置';
        var sub = loc.address || '';
        if (!sub && loc.lat != null && loc.lng != null) {
            sub = Number(loc.lat).toFixed(5) + ', ' + Number(loc.lng).toFixed(5);
        }
        return (
            '<div class="cx-loc-card" onclick="window.LocationMsg.openMap(\'' + locId + '\')">' +
                '<div class="cx-loc-map"><div class="cx-loc-grid"></div><div class="cx-loc-pin"><i class="fas fa-location-dot"></i></div></div>' +
                '<div class="cx-loc-body">' +
                    '<div class="cx-loc-name">' + esc(name) + '</div>' +
                    (sub ? '<div class="cx-loc-addr">' + esc(sub) + '</div>' : '') +
                    '<div class="cx-loc-foot"><i class="fas fa-paper-plane"></i> 位置 · 点击打开地图</div>' +
                '</div>' +
            '</div>'
        );
    }

    function openMap(locId) {
        var loc = registry[locId] || {};
        var url;
        if (loc.lat != null && loc.lng != null) {
            url = 'https://uri.amap.com/marker?position=' + encodeURIComponent(loc.lng + ',' + loc.lat) +
                  '&name=' + encodeURIComponent(loc.name || '位置');
        } else {
            url = 'https://uri.amap.com/search?keyword=' + encodeURIComponent(loc.name || '位置');
        }
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.openUrl === 'function') {
                window.AndroidBridge.openUrl(url); // APK：交给系统浏览器
            } else {
                window.open(url, '_blank');
            }
        } catch (e) {}
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
    }

    // ── 弹窗 ────────────────────────────────────────────────
    var pendingCoords = null; // {lat,lng} 获取定位成功后暂存
    var rememberFlag = false;

    function closeModal(overlay) { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    function openLocationModal() {
        injectStyles();
        pendingCoords = null;
        rememberFlag = false;

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:cxFadeIn .2s ease;';
        overlay.innerHTML =
            '<div style="background:var(--secondary-bg);border-radius:20px;padding:22px;width:88%;max-width:350px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:cxSlideIn .25s ease forwards;max-height:82vh;overflow-y:auto;">' +
                '<div style="text-align:center;margin-bottom:16px;">' +
                    '<div style="width:52px;height:52px;border-radius:50%;background:rgba(255,91,106,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;"><i class="fas fa-location-dot" style="color:#ff5b6a;font-size:20px;"></i></div>' +
                    '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">发送位置</div>' +
                    '<div style="font-size:12px;color:var(--text-secondary);">告诉ta你在哪儿</div>' +
                '</div>' +
                '<button id="cx-loc-gps" class="cx-btn-ghost" style="margin-bottom:12px;"><i class="fas fa-crosshairs"></i> 获取当前定位</button>' +
                '<div id="cx-loc-gps-result" style="font-size:11px;color:var(--text-secondary);margin:-6px 0 10px 2px;display:none;"></div>' +
                '<input id="cx-loc-name" class="cx-loc-input" placeholder="位置名称（必填）" maxlength="40" style="margin-bottom:9px;">' +
                '<input id="cx-loc-addr" class="cx-loc-input" placeholder="详细地址（选填）" maxlength="80" style="margin-bottom:10px;">' +
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
        var gpsBtn = overlay.querySelector('#cx-loc-gps');
        var gpsResult = overlay.querySelector('#cx-loc-gps-result');
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
                        pendingCoords = (l.lat != null && l.lng != null) ? { lat: l.lat, lng: l.lng } : null;
                        gpsResult.style.display = 'block';
                        gpsResult.textContent = '已选择常用位置';
                    });
                });
            });
        }
        renderFavs();

        gpsBtn.addEventListener('click', function () {
            gpsResult.style.display = 'block';
            gpsResult.textContent = '正在定位…';
            // 先确保原生定位权限已申请（APK 环境；失败也不阻塞，纯网页环境直接走 geolocation）
            try { if (window.AndroidBridge && typeof window.AndroidBridge.requestLocationPermission === 'function') window.AndroidBridge.requestLocationPermission(); } catch (e) {}
            if (!navigator.geolocation) {
                gpsResult.textContent = '当前环境不支持定位，请手动填写位置名称';
                return;
            }
            navigator.geolocation.getCurrentPosition(function (pos) {
                pendingCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                gpsResult.textContent = '定位成功 ✓ ' + pendingCoords.lat.toFixed(4) + ', ' + pendingCoords.lng.toFixed(4);
                if (!nameInput.value) nameInput.placeholder = '我在这里，给它起个名字（必填）';
            }, function (err) {
                gpsResult.textContent = '定位失败，可直接手动填写位置名称';
            }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
        });

        overlay.querySelector('#cx-loc-remember').addEventListener('change', function (e) { rememberFlag = e.target.checked; });
        overlay.querySelector('#cx-loc-cancel').addEventListener('click', function () { closeModal(overlay); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay); });

        overlay.querySelector('#cx-loc-send').addEventListener('click', function () {
            var name = nameInput.value.trim();
            if (!name) { nameInput.focus(); if (typeof showNotification === 'function') showNotification('先给这个位置起个名字吧', 'info'); return; }
            var loc = { name: name, address: addrInput.value.trim() };
            if (pendingCoords) { loc.lat = pendingCoords.lat; loc.lng = pendingCoords.lng; }
            if (rememberFlag) saveFav(loc);
            closeModal(overlay);
            sendLocation(loc);
        });
    }

    // ── 注册进 "+" 菜单 ─────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        if (window.MoreMenu && typeof window.MoreMenu.registerItem === 'function') {
            window.MoreMenu.registerItem('location', {
                ready: true,
                action: openLocationModal
            });
        }
    });

    window.LocationMsg = {
        renderBubbleHTML: renderBubbleHTML,
        openMap: openMap,
        openModal: openLocationModal
    };
})();
