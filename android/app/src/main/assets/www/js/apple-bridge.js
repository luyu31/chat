/**
 * apple-bridge.js — 苹果日记 Android 原生能力桥接
 *  - 接管 Blob 下载，交给系统「保存到文件」
 *  - 设备同步：局域网发送 / 接收备份包
 *  - 系统返回键、权限入口
 * 仅在 APK 环境（window.AppleDiary）生效，浏览器打开时不产生副作用。
 */
(function () {
    'use strict';

    var native = window.AppleDiary;
    if (!native || !native.isNative || !native.isNative()) return;
    window.__APPLE_NATIVE__ = true;

    // 1) 关闭 Web Share，避免 Blob 备份在 WebView 中无处可去
    try {
        Object.defineProperty(Navigator.prototype, 'share', {
            value: undefined,
            configurable: true
        });
    } catch (e) {}

    function notify(msg, type) {
        if (typeof showNotification === 'function') {
            showNotification(msg, type || 'info', 2600);
        } else if (native.toastMsg) {
            native.toastMsg(msg);
        }
    }

    // ---------------- Blob 下载 → 系统保存 ----------------

    function bytesToBase64(bytes) {
        var binary = '';
        var step = 0x8000;
        for (var i = 0; i < bytes.length; i += step) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
        }
        return btoa(binary);
    }

    function base64ToBytes(b64) {
        var binary = atob(b64);
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    async function saveBlob(blob, fileName) {
        if (!blob || !blob.size) throw new Error('文件为空');
        var token = native.saveBegin(fileName, blob.type || 'application/octet-stream');
        if (!token) throw new Error('无法创建临时文件');
        var CHUNK = 512 * 1024;
        for (var offset = 0; offset < blob.size; offset += CHUNK) {
            var part = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
            var buffer = await part.arrayBuffer();
            if (!native.saveChunk(token, bytesToBase64(new Uint8Array(buffer)))) {
                native.saveCancel(token);
                throw new Error('写入失败');
            }
            if (offset % (CHUNK * 4) === 0) await new Promise(function (r) { setTimeout(r, 0); });
        }
        native.saveFinish(token);
    }

    async function saveBlobUrl(url, fileName) {
        try {
            notify('正在准备文件…', 'info');
            var resp = await fetch(url);
            var blob = await resp.blob();
            await saveBlob(blob, fileName);
        } catch (e) {
            notify('保存失败：' + (e && e.message ? e.message : '未知错误'), 'error');
        }
    }

    document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (href.indexOf('blob:') !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        saveBlobUrl(href, a.getAttribute('download') || ('苹果日记-' + Date.now()));
    }, true);

    // ---------------- 样式 ----------------

    var CSS = ''
        + '#apple-sync-modal .modal-content{max-width:560px;}'
        + '.apple-sync-body{padding:4px 0 0;max-height:62vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}'
        + '.apple-sync-tip{margin:0 0 14px;font-size:12.5px;line-height:1.75;color:var(--text-secondary);text-align:center;}'
        + '.apple-sync-actions{display:flex;flex-direction:column;gap:10px;}'
        + '.apple-sync-btn{display:flex;align-items:center;gap:12px;width:100%;padding:13px 16px;border-radius:14px;border:1.5px solid var(--border-color);background:var(--primary-bg);color:var(--text-primary);font-family:var(--font-family);font-size:14px;text-align:left;cursor:pointer;transition:transform .12s ease;}'
        + '.apple-sync-btn:active{transform:scale(.98);}'
        + '.apple-sync-btn .ico{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;flex-shrink:0;}'
        + '.apple-sync-btn.red .ico{background:linear-gradient(135deg,#FF7A6B,#E84A4A);}'
        + '.apple-sync-btn.green .ico{background:linear-gradient(135deg,#9BE07D,#6FBF52);}'
        + '.apple-sync-btn .txt{display:flex;flex-direction:column;gap:3px;}'
        + '.apple-sync-btn .txt b{font-size:14px;font-weight:600;}'
        + '.apple-sync-btn .txt small{font-size:11px;color:var(--text-secondary);}'
        + '#apple-sync-panel{margin-top:14px;}'
        + '.apple-sync-card{background:var(--secondary-bg);border:1.5px dashed var(--border-color);border-radius:14px;padding:14px;}'
        + '.apple-sync-card h4{margin:0 0 8px;font-size:13px;color:var(--text-primary);display:flex;align-items:center;gap:6px;}'
        + '.apple-sync-card p{margin:6px 0;font-size:12px;line-height:1.7;color:var(--text-secondary);}'
        + '.apple-sync-code{display:inline-block;font-family:monospace;font-size:26px;letter-spacing:6px;color:#E84A4A;background:rgba(232,74,74,.08);border:1.5px dashed rgba(232,74,74,.4);border-radius:10px;padding:4px 12px;margin:6px 0;}'
        + '.apple-sync-addr{font-family:monospace;font-size:11.5px;color:var(--text-primary);word-break:break-all;}'
        + '.apple-sync-peer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:8px;background:var(--primary-bg);cursor:pointer;}'
        + '.apple-sync-peer .pname{font-size:13px;color:var(--text-primary);}'
        + '.apple-sync-peer .paddr{font-size:10.5px;color:var(--text-secondary);font-family:monospace;}'
        + '.apple-sync-input{width:100%;box-sizing:border-box;padding:9px 10px;margin:4px 0 8px;border-radius:9px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-primary);font-size:13px;outline:none;}'
        + '.apple-sync-row{display:flex;gap:8px;}'
        + '.apple-sync-row .apple-sync-input{margin-bottom:0;}'
        + '.apple-sync-mini{flex-shrink:0;padding:9px 14px;border-radius:9px;border:none;background:#E84A4A;color:#fff;font-size:12px;font-weight:600;cursor:pointer;}'
        + '.apple-sync-mini.ghost{background:var(--primary-bg);color:var(--text-primary);border:1px solid var(--border-color);}'
        + '.apple-sync-note{font-size:10.5px;color:var(--text-secondary);margin-top:10px;text-align:center;line-height:1.7;}'
        + '.apple-sync-note a{color:var(--accent-color);text-decoration:underline;cursor:pointer;}'
        + '.apple-sync-progress{height:8px;border-radius:6px;background:var(--border-color);overflow:hidden;margin:8px 0;}'
        + '.apple-sync-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#9BE07D,#E84A4A);transition:width .2s;}'
        + '.apple-sync-spin{display:inline-block;animation:appleSpin 1s linear infinite;}'
        + '@keyframes appleSpin{to{transform:rotate(360deg);}}'
        + '.apple-sync-state{text-align:center;padding:14px 0;font-size:13px;color:var(--text-secondary);}'
        + '.apple-sync-state .big{font-size:30px;display:block;margin-bottom:8px;}';

    var styleEl = document.createElement('style');
    styleEl.id = 'apple-bridge-style';
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    // ---------------- 设置入口 ----------------

    function openSyncModal() {
        var modal = document.getElementById('apple-sync-modal');
        if (typeof showModal === 'function') showModal(modal);
        else modal.style.display = 'flex';
        resetSyncPanel();
    }

    function closeSyncModal() {
        try { native.syncStopSend(); } catch (e) {}
        var modal = document.getElementById('apple-sync-modal');
        if (typeof hideModal === 'function') hideModal(modal);
        else modal.style.display = 'none';
    }

    function injectSettingsEntry() {
        if (document.getElementById('apple-sync-entry')) return;
        var settingsModal = document.getElementById('settings-modal');
        var grid = settingsModal && settingsModal.querySelector('.settings-grid');
        if (!grid) return;

        var card = document.createElement('div');
        card.className = 'settings-card';
        card.id = 'apple-sync-entry';
        card.style.gridColumn = '1 / -1';
        card.innerHTML = '<i class="fas fa-apple-whole" style="color:#E84A4A"></i>'
            + '<span>设备同步</span>'
            + '<span style="font-size:10px;color:var(--text-secondary);margin-top:-2px;">把日记搬到另一台手机</span>';
        card.addEventListener('click', function (e) {
            e.stopPropagation();
            openSyncModal();
        });
        grid.appendChild(card);

        if (!document.getElementById('apple-perm-row')) {
            var permRow = document.createElement('div');
            permRow.id = 'apple-perm-row';
            permRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:6px;padding:2px 0 8px;font-size:11.5px;color:var(--text-secondary);cursor:pointer;';
            permRow.innerHTML = '<i class="fas fa-shield-halved"></i><span>权限管理 · 相机 / 麦克风 / 相册 / 通知</span>';
            permRow.addEventListener('click', function () { native.openAppSettings(); });
            grid.parentNode.insertBefore(permRow, grid.nextSibling);
        }
    }

    // ---------------- 同步弹窗 ----------------

    var panelEl;

    function resetSyncPanel() {
        panelEl = document.getElementById('apple-sync-panel');
        if (!panelEl) return;
        panelEl.innerHTML = '';
        var tip = document.createElement('p');
        tip.className = 'apple-sync-tip';
        tip.textContent = '同一 WiFi 下，把本机的聊天与日记同步到另一台手机。数据不经过服务器。';
        panelEl.appendChild(tip);

        var actions = document.createElement('div');
        actions.className = 'apple-sync-actions';
        actions.innerHTML =
            '<button class="apple-sync-btn red" id="apple-send-btn">'
            + '<span class="ico"><i class="fas fa-paper-plane"></i></span>'
            + '<span class="txt"><b>发送到另一台手机</b><small>在新手机上接收全部数据</small></span>'
            + '</button>'
            + '<button class="apple-sync-btn green" id="apple-recv-btn">'
            + '<span class="ico"><i class="fas fa-download"></i></span>'
            + '<span class="txt"><b>从另一台手机接收</b><small>搜索附近设备，输入配对码</small></span>'
            + '</button>';
        panelEl.appendChild(actions);

        var note = document.createElement('div');
        note.className = 'apple-sync-note';
        note.innerHTML = '相机、麦克风、相册、通知等权限会在使用时向系统申请 · '
            + '<a id="apple-perm-link">打开系统权限管理</a>';
        panelEl.appendChild(note);

        document.getElementById('apple-perm-link').addEventListener('click', function () {
            native.openAppSettings();
        });
        document.getElementById('apple-send-btn').addEventListener('click', startSend);
        document.getElementById('apple-recv-btn').addEventListener('click', startReceive);
    }

    function showBusy(text) {
        panelEl.innerHTML = '<div class="apple-sync-state"><span class="big apple-sync-spin"><i class="fas fa-apple-whole"></i></span>' + text + '</div>';
    }

    function showError(text) {
        panelEl.innerHTML = '<div class="apple-sync-card"><h4><i class="fas fa-circle-exclamation" style="color:#E84A4A"></i> 同步失败</h4>'
            + '<p>' + escapeHtml(text) + '</p>'
            + '<button class="apple-sync-mini ghost" id="apple-sync-retry">返回</button></div>';
        document.getElementById('apple-sync-retry').addEventListener('click', resetSyncPanel);
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function dataUrlToBinary(url) {
        if (typeof url !== 'string') return null;
        var m = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
        if (!m) return null;
        var mime = m[1] || 'application/octet-stream';
        if (m[2]) {
            try {
                var bin = atob(m[3]);
                var bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return { bytes: bytes, mime: mime };
            } catch (e) {
                return null;
            }
        }
        try {
            return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime: mime };
        } catch (e) {
            return null;
        }
    }

    async function buildBackupBytes() {
        if (typeof ChatBackup === 'undefined' || !ChatBackup.buildBackupPayload) {
            throw new Error('备份模块未加载，请重启应用');
        }
        var flags = {
            inclMsgs: true, inclSet: true, inclCustom: true, inclAnn: true,
            inclThemes: true, inclDg: true, inclStickers: true
        };
        var payload = await ChatBackup.buildBackupPayload(flags);
        if (typeof JSZip === 'undefined') {
            return new TextEncoder().encode(ChatBackup.serializeBackupV4(payload));
        }
        var zip = new JSZip();
        var store = payload.mediaStore || {};
        var mediaIndex = {};
        for (var sid in store) {
            if (!Object.prototype.hasOwnProperty.call(store, sid)) continue;
            var url = store[sid];
            var parts = dataUrlToBinary(url);
            var path = 'media/' + sid;
            if (parts && parts.bytes && parts.bytes.length) {
                zip.file(path, parts.bytes, { binary: true });
                mediaIndex[sid] = { path: path, mime: parts.mime };
            } else {
                zip.file(path + '.txt', String(url));
                mediaIndex[sid] = { path: path + '.txt', mime: 'text/plain+dataurl' };
            }
        }
        var jsonBody = {
            type: 'chatapp-backup-v5',
            formatVersion: 5,
            appName: payload.appName || 'ChatApp',
            timestamp: payload.timestamp,
            sessionId: payload.sessionId,
            appPrefix: payload.appPrefix,
            modules: payload.modules,
            localforage: payload.localforage,
            localStorage: payload.localStorage,
            mediaIndex: mediaIndex
        };
        zip.file('backup.json', '\uFEFF' + JSON.stringify(jsonBody));
        return await zip.generateAsync({
            type: 'uint8array',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
    }

    async function startSend() {
        showBusy('正在打包本机数据…');
        try {
            var bytes = await buildBackupBytes();
            var code = String(Math.floor(1000 + Math.random() * 9000));
            var token = native.syncBeginSend(code);
            if (!token) throw new Error('无法创建同步任务');
            var CHUNK = 512 * 1024;
            for (var offset = 0; offset < bytes.length; offset += CHUNK) {
                var slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
                if (!native.syncPushChunk(token, bytesToBase64(slice))) {
                    native.syncStopSend();
                    throw new Error('写入同步包失败，可能是存储空间不足');
                }
                if (offset % (CHUNK * 4) === 0) {
                    showBusy('正在打包本机数据… ' + Math.min(100, Math.round(offset / bytes.length * 100)) + '%');
                    await new Promise(function (r) { setTimeout(r, 0); });
                }
            }
            showBusy('正在开启局域网发送…');
            var res = JSON.parse(native.syncFinishSend(token, code));
            if (!res.ok) throw new Error(res.error || '发送服务启动失败');
            showSenderPanel(res, bytes.length);
        } catch (e) {
            console.error('[apple-sync] send failed', e);
            try { native.syncStopSend(); } catch (err) {}
            showError(e && e.message ? e.message : '发送失败');
        }
    }

    function formatSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function showSenderPanel(res, bytes) {
        panelEl.innerHTML = '<div class="apple-sync-card">'
            + '<h4><i class="fas fa-tower-broadcast" style="color:#E84A4A"></i> 已开启，等待新手机接收</h4>'
            + '<p>配对码</p>'
            + '<div class="apple-sync-code">' + escapeHtml(res.code) + '</div>'
            + '<p>在另一台手机打开：设置 → 设备同步 → 从另一台手机接收，输入上面的配对码。</p>'
            + '<p>如果搜不到设备，可手动填写地址：<br><span class="apple-sync-addr">' + escapeHtml(res.ip) + ':' + res.port + '</span></p>'
            + '<p style="opacity:.75">数据大小：' + formatSize(bytes) + ' · 保持本页面打开，传输完成后会自动停止。</p>'
            + '<button class="apple-sync-mini ghost" id="apple-stop-send">停止发送</button>'
            + '</div>';
        document.getElementById('apple-stop-send').addEventListener('click', function () {
            native.syncStopSend();
            resetSyncPanel();
            notify('已停止发送', 'info');
        });
    }

    var discoveryBound = false;

    function bindDiscovery() {
        if (discoveryBound) return;
        discoveryBound = true;
        window.__appleSyncPeers = function (jsonStr) {
            var peers = [];
            try { peers = JSON.parse(jsonStr) || []; } catch (e) {}
            renderPeerList(peers);
        };
    }

    function startReceive() {
        bindDiscovery();
        panelEl.innerHTML = '<div class="apple-sync-card">'
            + '<h4><i class="fas fa-magnifying-glass" style="color:#6FBF52"></i> 搜索附近设备</h4>'
            + '<div id="apple-peer-area" class="apple-sync-state"><span class="big apple-sync-spin"><i class="fas fa-apple-whole"></i></span>正在搜索同一 WiFi 下的苹果日记…</div>'
            + '<div style="margin-top:12px"><button class="apple-sync-mini ghost" id="apple-manual-btn">手动输入地址</button></div>'
            + '</div>';
        document.getElementById('apple-manual-btn').addEventListener('click', function () {
            renderManualReceiver();
        });
        native.syncDiscover();
        setTimeout(function () {
            var el = document.getElementById('apple-peer-area');
            if (el && el.textContent.indexOf('正在搜索') !== -1) {
                el.innerHTML = '<p style="font-size:12px;line-height:1.7">没有搜到设备。请确认两台手机连的是同一个 WiFi，或点上方「手动输入地址」。</p>';
            }
        }, 2400);
    }

    function renderPeerList(peers) {
        var area = document.getElementById('apple-peer-area');
        if (!area) return;
        if (!peers.length) {
            area.innerHTML = '<p style="font-size:12px;line-height:1.7;margin:0">没有搜到设备。请确认两台手机连的是同一个 WiFi，或点下方「手动输入地址」。</p>';
            return;
        }
        area.className = '';
        area.innerHTML = '<p style="font-size:12px;color:var(--text-secondary);margin:0 0 8px">找到以下设备，点一下继续：</p>';
        peers.forEach(function (p) {
            var row = document.createElement('div');
            row.className = 'apple-sync-peer';
            row.innerHTML = '<span class="pname"><i class="fas fa-mobile-screen" style="color:#6FBF52"></i> ' + escapeHtml(p.name) + '</span>'
                + '<span class="paddr">' + escapeHtml(p.host) + ':' + p.port + '</span>';
            row.addEventListener('click', function () {
                renderPairCode(p.host, p.port, p.name);
            });
            area.appendChild(row);
        });
    }

    function renderManualReceiver() {
        panelEl.innerHTML = '<div class="apple-sync-card">'
            + '<h4><i class="fas fa-keyboard" style="color:#6FBF52"></i> 手动连接</h4>'
            + '<p>在发送方手机上查看地址与配对码：</p>'
            + '<input class="apple-sync-input" id="apple-manual-addr" placeholder="例如 192.168.1.8:41234" autocapitalize="off" autocorrect="off">'
            + '<div class="apple-sync-row">'
            + '<input class="apple-sync-input" id="apple-manual-code" placeholder="4 位配对码" inputmode="numeric" maxlength="4">'
            + '<button class="apple-sync-mini" id="apple-manual-go">连接</button>'
            + '</div>'
            + '<div style="margin-top:10px"><button class="apple-sync-mini ghost" id="apple-manual-back">返回搜索</button></div>'
            + '</div>';
        document.getElementById('apple-manual-back').addEventListener('click', startReceive);
        document.getElementById('apple-manual-go').addEventListener('click', function () {
            var addr = (document.getElementById('apple-manual-addr').value || '').trim();
            var code = (document.getElementById('apple-manual-code').value || '').trim();
            var m = addr.match(/^([\d.]+)(?::(\d+))?$/);
            if (!m) return notify('地址格式应为 192.168.x.x:端口', 'error');
            if (!/^\d{4}$/.test(code)) return notify('请输入 4 位配对码', 'error');
            beginReceive(m[1], m[2] ? parseInt(m[2], 10) : 8765, code);
        });
    }

    function renderPairCode(host, port, name) {
        panelEl.innerHTML = '<div class="apple-sync-card">'
            + '<h4><i class="fas fa-mobile-screen" style="color:#6FBF52"></i> ' + escapeHtml(name) + '</h4>'
            + '<p>输入发送方手机上显示的 4 位配对码：</p>'
            + '<div class="apple-sync-row">'
            + '<input class="apple-sync-input" id="apple-pair-code" placeholder="4 位配对码" inputmode="numeric" maxlength="4" autofocus>'
            + '<button class="apple-sync-mini" id="apple-pair-go">接收</button>'
            + '</div>'
            + '<div style="margin-top:10px"><button class="apple-sync-mini ghost" id="apple-pair-back">重新搜索</button></div>'
            + '</div>';
        document.getElementById('apple-pair-back').addEventListener('click', startReceive);
        var input = document.getElementById('apple-pair-code');
        if (input) input.focus();
        document.getElementById('apple-pair-go').addEventListener('click', function () {
            var code = (input.value || '').trim();
            if (!/^\d{4}$/.test(code)) return notify('请输入 4 位配对码', 'error');
            beginReceive(host, port, code);
        });
    }

    function beginReceive(host, port, code) {
        showBusy('正在连接 ' + escapeHtml(host) + '…');
        var token = native.syncBeginReceive(host, port, code);
        if (!token) return showError('无法开始接收，请重试');
        var started = Date.now();
        var timer = setInterval(async function () {
            var state;
            try { state = JSON.parse(native.syncReceiveState(token)); } catch (e) { state = { state: 'error', error: '状态读取失败' }; }
            if (state.state === 'error') {
                clearInterval(timer);
                native.syncCloseReceive(token);
                showError(state.error || '接收失败');
                return;
            }
            if (state.state === 'downloading') {
                var pct = state.total > 0 ? Math.round(state.received / state.total * 100) : 0;
                panelEl.innerHTML = '<div class="apple-sync-card">'
                    + '<h4><i class="fas fa-download" style="color:#6FBF52"></i> 正在接收数据</h4>'
                    + '<div class="apple-sync-progress"><i style="width:' + pct + '%"></i></div>'
                    + '<p style="text-align:center">' + pct + '% · ' + formatSize(state.received) + ' / ' + formatSize(state.total) + '</p>'
                    + '<p style="text-align:center;opacity:.7">请保持两台手机靠近，不要锁屏。</p>'
                    + '</div>';
                if (Date.now() - started > 5 * 60 * 1000) {
                    clearInterval(timer);
                    native.syncCloseReceive(token);
                    showError('接收超时，请重试');
                }
                return;
            }
            if (state.state === 'done') {
                clearInterval(timer);
                try {
                    var size = native.syncReceiveSize(token);
                    if (!size) throw new Error('收到的文件为空');
                    showBusy('正在写入本机数据…');
                    var bytes = new Uint8Array(size);
                    var off = 0;
                    var CHUNK = 512 * 1024;
                    while (off < size) {
                        var b64 = native.syncReadChunk(token, off, CHUNK);
                        if (!b64) throw new Error('读取同步包失败');
                        var chunk = base64ToBytes(b64);
                        bytes.set(chunk, off);
                        off += chunk.length;
                    }
                    native.syncCloseReceive(token);
                    var file = new File([bytes], 'apple-diary-sync.zip', { type: 'application/zip' });
                    closeSyncModal();
                    notify('同步包接收完成，请选择要恢复的内容', 'success');
                    if (typeof importAllData === 'function') {
                        await importAllData(file);
                    } else {
                        showError('备份恢复模块未加载，请重启应用');
                    }
                } catch (e) {
                    native.syncCloseReceive(token);
                    showError(e && e.message ? e.message : '写入失败');
                }
            }
        }, 350);
    }

    // ---------------- 返回键 ----------------

    function visible(el) {
        if (!el) return false;
        var s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
        return el.getBoundingClientRect().width > 0;
    }

    window.__appleHandleBack = function () {
        var syncModal = document.getElementById('apple-sync-modal');
        if (visible(syncModal)) {
            closeSyncModal();
            return true;
        }
        var splash = document.getElementById('splash-declaration');
        if (visible(splash)) return true;

        var overlays = Array.prototype.slice.call(
            document.querySelectorAll('.modal, .dm-action-drawer, .tour-overlay')
        ).filter(visible);
        if (overlays.length) {
            var el = overlays[overlays.length - 1];
            var closer = el.querySelector('.dm-drawer-cancel, .modal-btn-secondary, .modal-close, [id^="close-"]');
            if (closer) {
                closer.click();
                return true;
            }
            if (typeof hideModal === 'function') {
                hideModal(el);
                return true;
            }
            el.style.display = 'none';
            return true;
        }
        return false;
    };

    // ---------------- 初始化 ----------------

    function buildSyncModal() {
        if (document.getElementById('apple-sync-modal')) return;
        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'apple-sync-modal';
        modal.innerHTML = '<div class="modal-content">'
            + '<div class="modal-title"><i class="fas fa-apple-whole" style="color:#E84A4A"></i><span>设备同步</span></div>'
            + '<div class="apple-sync-body"><div id="apple-sync-panel"></div></div>'
            + '<div class="modal-buttons" style="padding-bottom: max(14px, env(safe-area-inset-bottom, 14px));">'
            + '<span></span><button class="modal-btn modal-btn-secondary" id="apple-sync-close">关闭</button>'
            + '</div></div>';
        document.body.appendChild(modal);
        document.getElementById('apple-sync-close').addEventListener('click', closeSyncModal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeSyncModal();
        });
    }

    function init() {
        buildSyncModal();
        injectSettingsEntry();
        // 标记原生环境，供其他脚本判断
        document.documentElement.classList.add('apple-native');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
