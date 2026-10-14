/**
 * checkin.js — 查岗功能（双向打卡）
 * 像备忘录一样列出每天要做的事（吃饭、睡觉…全部可自定义），
 * 双方各自打卡：我手动点，梦角会自己完成并主动汇报，
 * 有时还会反过来查你的岗（催你完成）。双方都完成会点亮整行。
 *
 * 入口：输入区「+」更多菜单 → 查岗
 */
(function () {
    'use strict';

    const KEY_ITEMS = 'checkinItems';
    const KEY_DAILY = 'checkinDaily';   // {date, me:{id:ts}, partner:{id:ts}}
    const KEY_PLAN  = 'checkinPlan';    // {date, times:{id:ts}} 梦角当日完成时刻表
    const KEY_NAG   = 'checkinNag';     // {date, counts:{id:n}, lastTs}

    const TICK_MS = 60000;

    function defaultItems() {
        return [
            { id: 'i_eat',   name: '吃饭' },
            { id: 'i_sleep', name: '睡觉' },
            { id: 'i_water', name: '喝水' },
        ];
    }

    // ─── 存取 ───
    function load(key, fallback) {
        try {
            const v = JSON.parse(localStorage.getItem(key));
            return v || fallback;
        } catch (e) { return fallback; }
    }
    function save(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    }

    function getItems() {
        const v = load(KEY_ITEMS, null);
        return (Array.isArray(v) && v.length) ? v : defaultItems();
    }

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function getDaily() {
        let d = load(KEY_DAILY, null);
        if (!d || d.date !== todayStr()) {
            d = { date: todayStr(), me: {}, partner: {} };
            save(KEY_DAILY, d);
        }
        if (!d.me) d.me = {};
        if (!d.partner) d.partner = {};
        return d;
    }

    // ─── 梦角当日完成时刻表（首次访问当天时生成） ───
    function getPlan() {
        let p = load(KEY_PLAN, null);
        if (!p || p.date !== todayStr()) {
            p = { date: todayStr(), times: {} };
        }
        if (!p.times) p.times = {};
        const items = getItems();
        const dayEnd = new Date(); dayEnd.setHours(23, 30, 0, 0);
        let changed = false;
        items.forEach(it => {
            if (!(it.id in p.times)) {
                // 从现在起的 15分钟~6小时内随机完成；太晚开 app 时压缩到 5~50 分钟
                let t = Date.now() + (15 + Math.random() * 345) * 60000;
                if (t > dayEnd.getTime()) t = Date.now() + (5 + Math.random() * 50) * 60000;
                p.times[it.id] = t;
                changed = true;
            }
        });
        // 清掉已删除项目的残留
        Object.keys(p.times).forEach(id => {
            if (!items.some(it => it.id === id)) { delete p.times[id]; changed = true; }
        });
        if (changed || p.date !== load(KEY_PLAN, { date: null }).date) save(KEY_PLAN, p);
        return p;
    }

    // ─── 消息（以梦角身份发进聊天流） ───
    function partnerSay(text) {
        try {
            addMessage({
                id: Date.now() + Math.floor(Math.random() * 1000),
                sender: (typeof settings !== 'undefined' && settings.partnerName) || '对方',
                text: text,
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal'
            });
            playSound('message');
        } catch (e) {}
    }

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    // ─── 摸鱼状态（查岗「他在干什么」）：从字卡组「摸鱼状态」随机抽一条 ───
    function pickSlackingStatus() {
        var pool = [];
        if (typeof window._getSlackingStatusPool === 'function') {
            try { pool = window._getSlackingStatusPool(); } catch (e) {}
        }
        if (!pool || !pool.length) {
            // 兜底：reply-library 没加载或库被清空时，用写死的默认
            pool = ['在摸鱼刷视频', '在偷偷打游戏', '在认真工作，勿扰', '在发呆想你了', '在吃零食', '在开会摸鱼', '在装忙，其实在等你消息', '在偷偷查岗你'];
        }
        return pick(pool);
    }

    // ─── 台词：打卡专用字卡（氛围感→打卡）优先，没有再用内置默认 ───
    // 字卡支持 {item} 占位符，会替换成任务名（如"吃饭"）
    function checkinSay(item, fallbacks, suffix) {
        let pool = [];
        try {
            if (typeof customCheckinLines !== 'undefined' && Array.isArray(customCheckinLines)) {
                pool = customCheckinLines.filter(function (s) { return s && s.trim(); });
            }
        } catch (e) {}
        let line;
        if (pool.length) {
            line = pick(pool).replace(/\{item\}/g, item.name);
        } else if (fallbacks && fallbacks.length) {
            line = pick(fallbacks.map(function (s) { return s.replace(/\{item\}/g, item.name); }));
        } else {
            return; // 字卡和内置都没有就不说话
        }
        if (suffix) line = line + suffix;
        partnerSay(line);
    }

    function fmtTs(ts) {
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    // ─── 梦角完成 / 查岗逻辑（每分钟检查） ───
    function tick() {
        if (document.hidden) return;
        const daily = getDaily();
        const plan = getPlan();
        const now = Date.now();

        // 1) 到点：梦角完成并汇报
        getItems().forEach(it => {
            if (daily.partner[it.id]) return;
            if (plan.times[it.id] && now >= plan.times[it.id]) {
                daily.partner[it.id] = now;
                save(KEY_DAILY, daily);
                checkinSay(it, [
                    '我刚完成「{item}」啦，你呢？',
                    '「{item}」打卡✓ 你完成了吗？',
                    '我「{item}」好啦，就等你了～',
                    '报告！「{item}」已完成，快跟上',
                ]);
                renderPanel();
            }
        });

        // 2) 查岗：梦角完成了、我还没完成、过了 1.5 小时 → 有概率催我
        const nag = (() => {
            let n = load(KEY_NAG, null);
            if (!n || n.date !== todayStr()) n = { date: todayStr(), counts: {}, lastTs: 0 };
            if (!n.counts) n.counts = {};
            return n;
        })();
        if (now - nag.lastTs > 25 * 60000) { // 全局：最多每 25 分钟查一次岗
            getItems().forEach(it => {
                if (nag.counts[it.id] >= 2) return;
                if (daily.partner[it.id] && !daily.me[it.id]
                    && now - daily.partner[it.id] > 90 * 60000
                    && Math.random() < 0.5) {
                    nag.counts[it.id] = (nag.counts[it.id] || 0) + 1;
                    nag.lastTs = now;
                    save(KEY_NAG, nag);
                    checkinSay(it, [
                        '查岗！「{item}」还没完成哦，快去！',
                        '都等你半天了，「{item}」呢？',
                        '别想糊弄过去，「{item}」打卡了吗？',
                        '我盯着呢，「{item}」完成没？',
                    ], '（此刻他正在：' + pickSlackingStatus() + '）');
                    return;
                }
            });
        }
    }

    // ─── 我完成一项 → 梦角必然紧跟着一起打卡（像真的情侣互相带动那样）───
    function onMeComplete(item) {
        const daily = getDaily();
        const delay = 1200 + Math.random() * 2600;
        setTimeout(() => {
            const d = getDaily();
            if (!d.me[item.id]) return; // 用户又撤销了
            if (d.partner[item.id]) {
                // 他先完成的 → 双人达成
                checkinSay(item, [
                    '太棒了，「{item}」我们都完成啦✓',
                    '「{item}」双人打卡达成！击掌✋',
                    '你也「{item}」完啦，默契✓',
                ]);
            } else if (Math.random() < 0.55) {
                // 他还没完成 → 55% 概率跟着我一起打（是否打卡是随机的）
                d.partner[item.id] = Date.now();
                save(KEY_DAILY, d);
                checkinSay(item, [
                    '我也刚「{item}」完，跟你一起✓',
                    '被你感染了，我也去「{item}」啦',
                    '看到你打了，我也把「{item}」搞定✓',
                ]);
                renderPanel();
            } else if (Math.random() < 0.6) {
                // 没跟着打，但夸一句
                checkinSay(item, [
                    '真乖，「{item}」完成啦，奖励一朵小红花🌸',
                    '「{item}」打卡成功！继续保持～',
                ]);
            }
            // 剩下约 18% 的情况：不说话也不打，留点真实感
        }, delay);
    }

    // ─── 面板 UI ───
    function buildModal() {
        if (document.getElementById('checkin-modal')) return;
        const m = document.createElement('div');
        m.className = 'modal';
        m.id = 'checkin-modal';
        m.style.zIndex = '3200';
        m.innerHTML = `
        <div class="modal-content" style="max-width:400px;width:90vw;">
            <div class="modal-title">
                <i class="fas fa-clipboard-check"></i><span>双向打卡</span>
            </div>
            <div id="checkin-summary" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;"></div>
            <div id="checkin-slacking" style="font-size:11px;color:var(--accent-color,#c5a47e);margin-bottom:8px;"></div>
            <div id="checkin-list" style="display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow-y:auto;padding:2px;"></div>
            <div style="display:flex;gap:8px;margin-top:12px;">
                <button type="button" id="checkin-add" style="flex:1;padding:8px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-plus"></i> 添加任务</button>
                <button type="button" id="checkin-lines" style="flex:1;padding:8px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-comment-dots"></i> 他的打卡台词</button>
                <button type="button" id="checkin-close" class="modal-btn modal-btn-secondary" style="flex:0 0 auto;">关闭</button>
            </div>
            <div style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;">
                点「我」打卡，他可能会跟着一起打（看心情）；他自己到点也会完成并汇报，你没完成还会反过来催你。<br>
                双方都完成会点亮整行。任务每天零点自动重置。点任务名可改名。
            </div>
        </div>`;
        document.body.appendChild(m);

        m.querySelector('#checkin-close').addEventListener('click', () => {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', e => { if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; } });
        m.querySelector('#checkin-lines').addEventListener('click', () => {
            // 直达氛围感配置的「打卡」字卡 tab（跟 period.js 跳经期 tab 同一套路）
            try {
                if (typeof currentMajorTab !== 'undefined') { currentMajorTab = 'atmosphere'; currentSubTab = 'checkinBank'; }
                if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
                const libModal = document.getElementById('custom-replies-modal');
                if (libModal && typeof showModal === 'function') showModal(libModal);
            } catch (e) { console.warn('[checkin] 打开打卡字卡失败:', e); }
        });
        m.querySelector('#checkin-add').addEventListener('click', () => {
            const name = prompt('新任务名称（比如：吃水果、敷面膜、背单词）');
            if (!name || !name.trim()) return;
            const items = getItems();
            items.push({ id: 'i_' + Date.now(), name: name.trim() });
            save(KEY_ITEMS, items);
            getPlan(); // 给新任务排上梦角的完成时间
            renderPanel();
        });
    }

    function renderPanel() {
        const listEl = document.getElementById('checkin-list');
        const sumEl = document.getElementById('checkin-summary');
        if (!listEl) return;
        const items = getItems();
        const daily = getDaily();
        const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '他';

        let meDone = 0, paDone = 0;
        items.forEach(it => {
            if (daily.me[it.id]) meDone++;
            if (daily.partner[it.id]) paDone++;
        });
        const now = new Date();
        if (sumEl) sumEl.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 · 我 ' + meDone + '/' + items.length + ' · ' + partnerName + ' ' + paDone + '/' + items.length;

        // 每次打开/刷新查岗面板，都随机展示一条梦角「此刻在干什么」的摸鱼状态
        var slackingEl = document.getElementById('checkin-slacking');
        if (slackingEl) slackingEl.textContent = '此刻他正在：' + pickSlackingStatus();

        listEl.innerHTML = '';
        items.forEach(it => {
            const meTs = daily.me[it.id] || 0;
            const paTs = daily.partner[it.id] || 0;
            const both = meTs && paTs;

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:12px;border:1px solid var(--border-color,#e8e8e8);'
                + (both ? 'background:rgba(76,175,80,.10);border-color:rgba(76,175,80,.35);' : 'background:var(--primary-bg,transparent);');

            // 任务名（点击改名）
            const nameEl = document.createElement('span');
            nameEl.textContent = it.name;
            nameEl.title = '点击改名';
            nameEl.style.cssText = 'flex:1;font-size:13px;color:var(--text-primary,#333);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            nameEl.onclick = function () {
                const n = prompt('修改任务名称', it.name);
                if (n && n.trim() && n.trim() !== it.name) {
                    const arr = getItems();
                    const t = arr.find(x => x.id === it.id);
                    if (t) { t.name = n.trim(); save(KEY_ITEMS, arr); renderPanel(); }
                }
            };
            row.appendChild(nameEl);

            // 我的状态按钮
            const meBtn = document.createElement('button');
            meBtn.type = 'button';
            meBtn.innerHTML = meTs
                ? '<i class="fas fa-check"></i><span style="font-size:9px;">' + fmtTs(meTs) + '</span>'
                : '打卡';
            meBtn.title = meTs ? '我已完成 ' + fmtTs(meTs) + '（点击撤销）' : '我完成这项';
            meBtn.style.cssText = 'flex-shrink:0;min-width:52px;padding:5px 8px;border:none;border-radius:9px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px;'
                + (meTs
                    ? 'background:linear-gradient(135deg,#4caf50,#2e7d32);color:#fff;'
                    : 'background:var(--accent-color,#c5a47e);color:#fff;');
            meBtn.onclick = function () {
                const d = getDaily();
                if (d.me[it.id]) {
                    if (!confirm('撤销「' + it.name + '」的打卡？')) return;
                    delete d.me[it.id];
                    save(KEY_DAILY, d);
                } else {
                    d.me[it.id] = Date.now();
                    save(KEY_DAILY, d);
                    onMeComplete(it);
                }
                renderPanel();
            };
            row.appendChild(meBtn);

            // 他的状态
            const paEl = document.createElement('span');
            paEl.title = partnerName + (paTs ? ' 已完成 ' + fmtTs(paTs) : ' 还没完成');
            paEl.style.cssText = 'flex-shrink:0;min-width:52px;padding:5px 8px;border-radius:9px;font-size:11px;display:flex;align-items:center;justify-content:center;gap:3px;'
                + (paTs
                    ? 'background:rgba(var(--accent-color-rgb,197,164,126),.16);color:var(--accent-color,#c5a47e);'
                    : 'background:transparent;border:1px dashed var(--border-color,#ddd);color:var(--text-secondary,#999);');
            paEl.innerHTML = paTs
                ? '<i class="fas fa-check"></i><span style="font-size:9px;">' + fmtTs(paTs) + '</span>'
                : '<span style="width:6px;height:6px;border-radius:50%;background:var(--text-secondary,#999);opacity:.5;"></span>待';
            row.appendChild(paEl);

            // 删除
            const del = document.createElement('button');
            del.type = 'button';
            del.innerHTML = '<i class="fas fa-times"></i>';
            del.title = '删除任务';
            del.style.cssText = 'flex-shrink:0;width:24px;height:24px;border:none;border-radius:50%;background:transparent;color:var(--text-secondary,#aaa);font-size:11px;cursor:pointer;';
            del.onclick = function () {
                if (!confirm('删除任务「' + it.name + '」？（今日打卡记录也会清除）')) return;
                const arr = getItems().filter(x => x.id !== it.id);
                save(KEY_ITEMS, arr.length ? arr : defaultItems());
                const d = getDaily();
                delete d.me[it.id]; delete d.partner[it.id];
                save(KEY_DAILY, d);
                getPlan();
                renderPanel();
            };
            row.appendChild(del);

            listEl.appendChild(row);
        });
    }

    function open() {
        buildModal();
        renderPanel();
        const m = document.getElementById('checkin-modal');
        if (typeof showModal === 'function') showModal(m);
        else m.style.display = 'flex';
    }

    // ─── 启动 ───
    function init() {
        // 初始化当日数据 + 时刻表
        getDaily();
        getPlan();
        setInterval(tick, TICK_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
        // 首次延迟一会儿再 tick，等聊天数据加载完
        setTimeout(tick, 8000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.Checkin = { open };
})();
