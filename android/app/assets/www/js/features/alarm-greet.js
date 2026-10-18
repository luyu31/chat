/**
 * alarm-greet.js — 定时问候（闹钟）模块
 * 每天在用户设定的时间，梦角主动发来一条问候/提醒消息（早安、吃饭、晚安等），
 * 可选配合 MiniMax TTS 朗读播放。
 *
 * 触发路径（双保险）：
 *  1. App 在前台：本模块每 30 秒自检一次时间
 *  2. App 在后台/锁屏：原生 AlarmManager 精确闹钟 → 发系统通知 + 回调
 *     window._onNativeAlarmFired(id) 在聊天流里补上消息
 *  3. App 被杀后错过：打开 App 时自动补发（消息时间戳还原为闹钟时间点）
 */
(function () {
    'use strict';

    const STORE_KEY = 'alarmGreets';
    const FIRED_KEY = 'alarmGreetFiredDates';
    const SNOOZE_KEY = 'alarmGreetSnoozeMin';   // 贪睡时长（分钟）
    const MAXRING_KEY = 'alarmGreetMaxRingMin'; // 最长响铃时长（分钟）

    const DEFAULT_SNOOZE_MIN = 5;
    const DEFAULT_MAX_RING_MIN = 10;
    // 可选档位
    const SNOOZE_OPTIONS = [1, 3, 5, 10, 15, 20];
    const MAXRING_OPTIONS = [1, 3, 5, 10, 15, 30];

    function getNum(key, def, min, max) {
        const v = parseInt(localStorage.getItem(key) || '', 10);
        if (!isFinite(v) || v < min || v > max) return def;
        return v;
    }
    function getSnoozeMin() { return getNum(SNOOZE_KEY, DEFAULT_SNOOZE_MIN, 1, 60); }
    function getMaxRingMin() { return getNum(MAXRING_KEY, DEFAULT_MAX_RING_MIN, 1, 60); }
    function setNum(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) {} }

    // ─── 默认闹钟（时间用户可随意改，文案每行一条随机抽） ───
    // gentle: true  = 温柔提醒（只弹一条通知，不响铃、不弹全屏）
    // gentle: false = 闹钟式（响铃 + 震动 + 全屏闹钟界面）
    // 默认只有「早安 / 晚安」是真闹钟，吃饭类提醒用温柔提醒，不吵人
    function defaultAlarms() {
        return [
            {
                id: 'goodMorning', name: '早安问候', time: '08:00', enabled: true, tts: true, gentle: false,
                texts: [
                    '早安，新的一天也要开心哦',
                    '起床啦～今天也一起加油',
                    '早上好呀，睡得怎么样？',
                    '早安，又是想你的一天',
                ]
            },
            {
                id: 'breakfast', name: '早餐提醒', time: '09:30', enabled: true, tts: false, gentle: true,
                texts: [
                    '该吃早饭了，不许饿着肚子',
                    '早餐很重要，去吃点东西吧',
                    '吃过早饭了吗？别糊弄我哦',
                ]
            },
            {
                id: 'lunch', name: '午餐提醒', time: '12:00', enabled: true, tts: false, gentle: true,
                texts: [
                    '到中午啦，去吃饭吧，我等你',
                    '别忘了吃午饭哦',
                    '到饭点啦，去吃点好吃的犒劳自己',
                ]
            },
            {
                id: 'goodNight', name: '晚安提醒', time: '22:10', enabled: true, tts: true, gentle: false,
                texts: [
                    '十点多了，该睡觉了哦，晚安',
                    '别熬夜啦，早点睡，晚安好梦',
                    '今天辛苦了，快去休息吧，晚安',
                    '再不睡觉明天起不来啦，晚安～',
                ]
            },
        ];
    }

    // 老数据补 gentle 字段：吃饭类默认温柔，其余默认闹钟式
    function _normalizeAlarm(a) {
        if (!a || typeof a !== 'object') return a;
        if (a.gentle === undefined) {
            a.gentle = (a.id === 'breakfast' || a.id === 'lunch');
        }
        return a;
    }

    // ─── 存取 ───
    function getAlarms() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return defaultAlarms().map(_normalizeAlarm);
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr.map(_normalizeAlarm) : defaultAlarms().map(_normalizeAlarm);
        } catch (e) { return defaultAlarms().map(_normalizeAlarm); }
    }

    function saveAlarms(list) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {}
        syncNative();
    }

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function getFiredMap() {
        try { return JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch (e) { return {}; }
    }

    function isFiredToday(id) {
        return getFiredMap()[id] === todayStr();
    }

    function markFired(id) {
        const m = getFiredMap();
        m[id] = todayStr();
        try { localStorage.setItem(FIRED_KEY, JSON.stringify(m)); } catch (e) {}
    }

    function parseHM(hm) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
        if (!m) return null;
        const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
        if (h > 23 || mi > 59) return null;
        return { h, mi };
    }

    // ─── 同步给原生（App 内生效；网页端静默跳过） ───
    // 除了闹钟表，把「贪睡时长 / 最长响铃时长」一起带上，
    // 原生到点响铃时才知道该响多久、贪睡按钮该写几分钟。
    function syncNative() {
        try {
            if (window.MilkChat && window.MilkChat.syncAlarms) {
                window.MilkChat.syncAlarms(JSON.stringify({
                    partnerName: (typeof settings !== 'undefined' && settings.partnerName) || '对方',
                    snoozeMinutes: getSnoozeMin(),
                    maxRingMinutes: getMaxRingMin(),
                    alarms: getAlarms().filter(a => a.enabled && parseHM(a.time)).map(a => ({
                        id: a.id, name: a.name, time: a.time,
                        gentle: !!a.gentle,
                        texts: (a.texts || []).filter(t => t && t.trim())
                    }))
                }));
            }
        } catch (e) {}
    }

    // ─── TTS 朗读（需在设置里配置好 MiniMax） ───
    async function speakText(text) {
        try {
            if (!window.voiceTTS || !window.voiceTTS.isTtsReady()) return;
            const url = await window.voiceTTS.getAudioForMessage('alarm_' + Date.now(), text);
            if (!url) return;
            const audio = new Audio(url);
            if (window.voiceTTS.applyPlaybackSettings) window.voiceTTS.applyPlaybackSettings(audio);
            audio.play().catch(() => {});
        } catch (e) { console.warn('[alarm-greet] tts error:', e); }
    }

    // ─── 核心：触发一次闹钟（以梦角身份发消息） ───
    function fireAlarm(alarm, ts) {
        const texts = (alarm.texts || []).filter(t => t && t.trim());
        const text = texts.length ? texts[Math.floor(Math.random() * texts.length)]
            : '（' + (alarm.name || '提醒') + '）';
        const when = ts instanceof Date ? ts : new Date();
        try {
            addMessage({
                id: Date.now() + Math.floor(Math.random() * 1000),
                sender: (typeof settings !== 'undefined' && settings.partnerName) || '对方',
                text: text,
                timestamp: when,
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal'
            });
        } catch (e) { console.warn('[alarm-greet] addMessage error:', e); return; }
        markFired(alarm.id);
        try { playSound('message'); } catch (e) {}
        if (alarm.tts) speakText(text);
    }

    // ─── 前台自检（30 秒一次） ───
    function checkDue() {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const today = todayStr();
        const fired = getFiredMap();
        getAlarms().forEach(a => {
            if (!a.enabled) return;
            const hm = parseHM(a.time);
            if (!hm) return;
            if (fired[a.id] === today) return;
            if (nowMin >= hm.h * 60 + hm.mi) {
                // 前台命中：用当前时间
                fireAlarm(a, now);
            }
        });
    }

    // ─── 打开 App 时补发错过的（消息时间戳还原为闹钟时间点） ───
    function backfillMissed() {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const today = todayStr();
        const fired = getFiredMap();
        getAlarms().forEach(a => {
            if (!a.enabled) return;
            const hm = parseHM(a.time);
            if (!hm) return;
            if (fired[a.id] === today) return;
            if (nowMin >= hm.h * 60 + hm.mi) {
                const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm.h, hm.mi, 0);
                fireAlarm(a, ts);
            }
        });
    }

    // 原生闹钟到点回调（App 在后台时由 AlarmManager 触发）
    window._onNativeAlarmFired = function (id) {
        try {
            const a = getAlarms().find(x => x.id === id);
            if (!a) return;
            if (isFiredToday(id)) return;
            fireAlarm(a, new Date());
        } catch (e) {}
    };

    // ─── 响铃方式设置（贪睡时长 / 最长响铃时长） ───
    // 这两项会随 syncNative 一起交给原生：决定到点响多久、点贪睡写几分钟
    function renderConfig() {
        const el = document.getElementById('alarm-greet-config');
        if (!el) return;
        const selStyle = 'flex:1;padding:7px 10px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;background:var(--primary-bg,transparent);color:var(--text-primary,#333);outline:none;font-family:var(--font-family,inherit);';
        const rowStyle = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
        const lbStyle = 'font-size:12px;color:var(--text-secondary,#888);flex:0 0 auto;width:88px;';

        const snooze = getSnoozeMin();
        const maxRing = getMaxRingMin();

        el.innerHTML =
            '<div style="' + rowStyle + '">' +
                '<span style="' + lbStyle + '">贪睡时长</span>' +
                '<select id="alarm-cfg-snooze" style="' + selStyle + '">' +
                    SNOOZE_OPTIONS.map(n => '<option value="' + n + '"' + (n === snooze ? ' selected' : '') + '>' + n + ' 分钟</option>').join('') +
                '</select>' +
            '</div>' +
            '<div style="' + rowStyle + 'margin-bottom:0;">' +
                '<span style="' + lbStyle + '">最长响铃</span>' +
                '<select id="alarm-cfg-maxring" style="' + selStyle + '">' +
                    MAXRING_OPTIONS.map(n => '<option value="' + n + '"' + (n === maxRing ? ' selected' : '') + '>' + n + ' 分钟</option>').join('') +
                '</select>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:6px;line-height:1.6;" id="alarm-cfg-status"></div>';

        const snSel = el.querySelector('#alarm-cfg-snooze');
        if (snSel) snSel.onchange = function () {
            setNum(SNOOZE_KEY, parseInt(this.value, 10) || DEFAULT_SNOOZE_MIN);
            syncNative();
            _flashCfgStatus();
        };
        const mrSel = el.querySelector('#alarm-cfg-maxring');
        if (mrSel) mrSel.onchange = function () {
            setNum(MAXRING_KEY, parseInt(this.value, 10) || DEFAULT_MAX_RING_MIN);
            syncNative();
            _flashCfgStatus();
        };
        _renderCfgStatus();
    }

    function _renderCfgStatus() {
        const s = document.getElementById('alarm-cfg-status');
        if (!s) return;
        const native = !!(window.MilkChat && window.MilkChat.syncAlarms);
        s.textContent = native
            ? '已生效：到点会响铃 + 震动 + 弹出全屏闹钟界面'
            : '网页版只发消息提醒；装成 App 后到点会像手机自带闹钟一样响铃 + 震动 + 全屏弹出';
        s.style.color = native ? 'var(--accent-color,#c5a47e)' : 'var(--text-secondary,#999)';
    }
    function _flashCfgStatus() {
        _renderCfgStatus();
        const s = document.getElementById('alarm-cfg-status');
        if (s) s.textContent = '已保存 ✓ ' + s.textContent;
    }

    // ─────────────────────────────────────────────────────────
    // 设置界面渲染（设置 → 闹钟 面板）
    // ─────────────────────────────────────────────────────────
    function renderSettings() {
        const listEl = document.getElementById('alarm-greet-list');
        if (!listEl) return;
        const alarms = getAlarms();
        listEl.innerHTML = '';

        const inputStyle = 'padding:6px 9px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;background:var(--primary-bg,transparent);color:var(--text-primary,#333);outline:none;font-family:var(--font-family,inherit);';
        const btnStyle = 'padding:5px 9px;border:1px solid var(--border-color,#ddd);border-radius:8px;font-size:12px;background:var(--primary-bg,transparent);color:var(--text-primary,#333);cursor:pointer;white-space:nowrap;';

        alarms.forEach((a, idx) => {
            const row = document.createElement('div');
            row.style.cssText = 'padding:10px 0;border-bottom:1px dashed var(--border-color,#e8e8e8);';

            // 第一行：开关 + 名称 + 时间 + 删除
            const top = document.createElement('div');
            top.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';

            // 开关
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.textContent = a.enabled ? '已开启' : '已关闭';
            toggle.style.cssText = btnStyle + (a.enabled
                ? 'background:var(--accent-color,#c5a47e);color:#fff;border-color:transparent;'
                : 'opacity:.7;');
            toggle.onclick = function () {
                const list = getAlarms();
                const it = list.find(x => x.id === a.id);
                if (it) { it.enabled = !it.enabled; saveAlarms(list); renderSettings(); }
            };
            top.appendChild(toggle);

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = a.name || '';
            nameInput.placeholder = '名称';
            nameInput.style.cssText = inputStyle + 'flex:0 0 auto;width:96px;';
            nameInput.onchange = function () {
                const list = getAlarms();
                const it = list.find(x => x.id === a.id);
                if (it) { it.name = this.value.trim() || '提醒'; saveAlarms(list); }
            };
            top.appendChild(nameInput);

            const timeInput = document.createElement('input');
            timeInput.type = 'time';
            timeInput.value = a.time || '08:00';
            timeInput.style.cssText = inputStyle + 'margin-left:auto;';
            timeInput.onchange = function () {
                if (!parseHM(this.value)) { this.value = '08:00'; return; }
                const list = getAlarms();
                const it = list.find(x => x.id === a.id);
                if (it) { it.time = this.value; saveAlarms(list); }
            };
            top.appendChild(timeInput);

            const del = document.createElement('button');
            del.type = 'button';
            del.innerHTML = '<i class="fas fa-trash"></i>';
            del.title = '删除这个闹钟';
            del.style.cssText = btnStyle;
            del.onclick = function () {
                if (!confirm('删除「' + (a.name || '提醒') + '」？')) return;
                saveAlarms(getAlarms().filter(x => x.id !== a.id));
                renderSettings();
            };
            top.appendChild(del);

            row.appendChild(top);

            // 第二行：TTS 开关
            const ttsRow = document.createElement('div');
            ttsRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px;color:var(--text-secondary,#888);';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!a.tts;
            cb.id = 'alarm-tts-' + idx;
            cb.onchange = function () {
                const list = getAlarms();
                const it = list.find(x => x.id === a.id);
                if (it) { it.tts = this.checked; saveAlarms(list); }
            };
            const lb = document.createElement('label');
            lb.htmlFor = cb.id;
            lb.textContent = '用语音朗读（需已配置 MiniMax 语音）';
            lb.style.cursor = 'pointer';
            ttsRow.appendChild(cb);
            ttsRow.appendChild(lb);
            row.appendChild(ttsRow);

            // 响铃方式：闹钟式（响铃+震动+全屏） / 温柔提醒（只弹一条通知）
            const modeRow = document.createElement('div');
            modeRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
            const modeLb = document.createElement('span');
            modeLb.style.cssText = 'font-size:11px;color:var(--text-secondary,#999);flex:0 0 auto;';
            modeLb.textContent = '响铃方式';
            modeRow.appendChild(modeLb);
            [['alarm', '闹钟（响铃+全屏）'], ['gentle', '温柔提醒（只弹通知）']].forEach(pair => {
                const isGentle = !!a.gentle;
                const on = pair[0] === 'gentle' ? isGentle : !isGentle;
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = pair[1];
                chip.style.cssText = 'padding:4px 9px;border-radius:999px;font-size:11px;cursor:pointer;font-family:inherit;'
                    + (on ? 'border:1px solid var(--accent-color,#c5a47e);background:rgba(var(--accent-color-rgb,197,164,126),.16);color:var(--accent-color,#c5a47e);font-weight:700;'
                        : 'border:1px solid var(--border-color,#ddd);background:transparent;color:var(--text-secondary,#888);');
                chip.onclick = function () {
                    const list = getAlarms();
                    const it = list.find(x => x.id === a.id);
                    if (!it) return;
                    it.gentle = (pair[0] === 'gentle');
                    saveAlarms(list);
                    renderSettings();
                };
                modeRow.appendChild(chip);
            });
            row.appendChild(modeRow);

            // 第三行：文案（每行一条，随机抽一条发送）
            const taLabel = document.createElement('div');
            taLabel.style.cssText = 'font-size:11px;color:var(--text-secondary,#999);margin-bottom:4px;';
            taLabel.textContent = '他会随机发其中一句（每行一条）';
            row.appendChild(taLabel);

            const ta = document.createElement('textarea');
            ta.value = (a.texts || []).join('\n');
            ta.rows = 3;
            ta.style.cssText = inputStyle + 'width:100%;box-sizing:border-box;resize:vertical;line-height:1.6;';
            ta.onchange = function () {
                const list = getAlarms();
                const it = list.find(x => x.id === a.id);
                if (it) {
                    it.texts = this.value.split('\n').map(s => s.trim()).filter(Boolean);
                    if (!it.texts.length) it.texts = ['（' + (it.name || '提醒') + '）'];
                    saveAlarms(list);
                }
            };
            row.appendChild(ta);

            listEl.appendChild(row);
        });

        // TTS 配置状态提示
        const hint = document.getElementById('alarm-tts-hint');
        if (hint) {
            let ready = false;
            try { ready = !!(window.voiceTTS && window.voiceTTS.isTtsReady()); } catch (e) {}
            hint.textContent = ready
                ? '已检测到 MiniMax 语音配置：勾选"用语音朗读"的闹钟会自动读出来'
                : '尚未配置 MiniMax 语音：目前只发文字消息；想让他念出来，请到 语音设置 配置 MiniMax';
            hint.style.color = ready ? 'var(--accent-color,#c5a47e)' : 'var(--text-secondary,#999)';
        }

        // 响铃方式（贪睡时长 / 最长响铃时长）
        renderConfig();
    }

    function bindSettingsUI() {
        const addBtn = document.getElementById('alarm-greet-add');
        if (addBtn && !addBtn._alarmBound) {
            addBtn._alarmBound = true;
            addBtn.onclick = function () {
                const list = getAlarms();
                list.push({
                    id: 'custom_' + Date.now(),
                    name: '新提醒',
                    time: '18:00',
                    enabled: true,
                    tts: false,
                    texts: ['记得这件事哦']
                });
                saveAlarms(list);
                renderSettings();
            };
        }

        // 「试响一次」：立刻走一遍原生闹钟流程（响铃 + 震动 + 全屏界面），
        // 不用等到设定时间就能确认效果（仅 App 内可用）
        const testBtn = document.getElementById('alarm-greet-test');
        if (testBtn && !testBtn._alarmBound) {
            testBtn._alarmBound = true;
            testBtn.onclick = function () {
                try {
                    if (window.MilkChat && typeof window.MilkChat.testAlarm === 'function') {
                        const name = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
                        const first = getAlarms().find(a => a.enabled) || defaultAlarms()[0];
                        const texts = (first && first.texts || []).filter(Boolean);
                        const text = texts.length ? texts[Math.floor(Math.random() * texts.length)] : '闹钟试响一下～';
                        window.MilkChat.testAlarm(name, text);
                        if (typeof showNotification === 'function')
                            showNotification('已试响：响铃 + 震动 + 全屏闹钟界面', 'success', 2600);
                    } else if (typeof showNotification === 'function') {
                        showNotification('「试响」只在装成 App 后可用', 'info', 2600);
                    }
                } catch (e) {}
            };
        }

        // 每次打开设置时刷新一次显示
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn && !settingsBtn._alarmBound) {
            settingsBtn._alarmBound = true;
            settingsBtn.addEventListener('click', function () {
                setTimeout(renderSettings, 60);
            });
        }
    }

    // 原生侧用户在闹钟界面点了「停止 / 贪睡」：回一条系统小卡片，
    // 让用户能在聊天里看到这次闹钟的结果（贪睡的那次不重复记）
    window._onNativeAlarmAction = function (action, id) {
        try {
            if (action !== 'stop') return;
            const a = getAlarms().find(x => x.id === id);
            const name = a ? (a.name || '提醒') : '闹钟';
            if (typeof addMessage === 'function') {
                addMessage({
                    id: Date.now() + Math.random(),
                    sender: null,
                    type: 'system',
                    text: '<i class="fas fa-clock" style="margin-right:4px;"></i>你关掉了「' + name + '」',
                    timestamp: new Date(),
                    status: 'received',
                    favorited: false,
                    note: null,
                    replyTo: null
                });
            }
        } catch (e) {}
    };

    // ─── 启动 ───
    function init() {
        // 首次运行写入默认闹钟
        if (!localStorage.getItem(STORE_KEY)) {
            try { localStorage.setItem(STORE_KEY, JSON.stringify(defaultAlarms())); } catch (e) {}
        }
        bindSettingsUI();
        renderSettings();

        // 延迟启动：等 settings/聊天数据加载完成
        setTimeout(function () {
            backfillMissed();   // 补发今天错过的
            syncNative();       // 把闹钟表交给原生 AlarmManager
        }, 2000);

        // 前台每 30 秒自检（后台时定时器会被冻结，由原生闹钟接管）
        setInterval(checkDue, 30000);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                checkDue();
                syncNative();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露（调试/联动用）
    window.alarmGreet = { getAlarms, saveAlarms, fireAlarm, renderSettings, syncNative };
})();
