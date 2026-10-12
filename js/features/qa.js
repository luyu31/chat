/* ============================================================
   快问快答 v5（"+"菜单 → 快问快答）—— 双向问答
   - 模式一「开始挑战」：ta 出题 → 你 10 秒内点选项作答 → 对比双方选择
   - 模式二「让ta出题」：ta 亲自出题（出过就存进"我们的题库"）
   - 模式三「我来提问」：你出题 → ta 限时 10 秒作答 → 轮到你选 → 对比
   - 选项点击用事件委托（document 级），新插入的卡片也能直接点
   - 超时反应：随机字卡/表情包（引用题目），不再是出戏的吐槽旁白
   - 题库 = 内置 4 分类 × 10 题（全选择题）+ 自定义题（你加的 + ta 加的）
   - 自定义题存 localforage: cx_qa_custom [{q, opts, cat, by:'me'|'ta'}]
   - 作答状态存 localforage: cx_qa_states
     · 'answered' {pick:用户选择, taPick:ta选择} 双方都已作答
     · 'waiting'  {taPick} ta 答了、等你选（你提问的卡片）
     · 'timeout'  超时
   ============================================================ */
(function () {
    'use strict';

    var STATE_KEY = 'cx_qa_states';
    var STATS_KEY = 'cx_qa_stats';
    var RECENT_KEY = 'cx_qa_recent';
    var CUSTOM_KEY = 'cx_qa_custom';
    var LIMIT_MS = 10000; // 10 秒作答

    var stateMap = {};  // qaId -> {state:'answered'|'timeout', pick, taPick}
    var stats = { total: 0, byCat: {} };
    var customList = []; // [{q, opts:[], cat, by:'me'|'ta', ts}]
    var hydrated = false;

    // ── 题库（全选择题，opts[0] 固定为"正确位置"无意义——这是走心问答不是考试） ──
    var BANK = [
        { cat: '日常脑洞', qs: [
            { q: '你更像哪种动物？', opts: ['猫', '狗', '仓鼠', '老虎'] },
            { q: '周末最理想的安排？', opts: ['宅家', '出门玩', '约会', '睡到自然醒'] },
            { q: '奶茶要几分糖？', opts: ['全糖', '七分', '五分', '无糖'] },
            { q: '最想拥有的超能力？', opts: ['读心术', '隐身', '瞬间移动', '时间暂停'] },
            { q: '夜宵想吃哪种？', opts: ['炸鸡', '火锅', '烧烤', '奶茶甜品'] },
            { q: '你的睡眠类型？', opts: ['早睡早起', '夜猫子', '看心情', '一秒入睡'] },
            { q: '下雨天的第一反应？', opts: ['想睡觉', '想听雨', '想踩水', '好烦'] },
            { q: '最想去的旅行地？', opts: ['海边', '雪山', '古镇', '游乐园'] },
            { q: '变成透明人先干嘛？', opts: ['整蛊别人', '偷听八卦', '白嫖演唱会', '躲起来'] },
            { q: '手机里最占内存的是？', opts: ['聊天记录', '相册', '表情包', '视频App'] }
        ]},
        { cat: '心动瞬间', qs: [
            { q: '第一次见面对我的印象？', opts: ['还不错', '高冷', '傻乎乎', '记不清了'] },
            { q: '最喜欢我哪一点？', opts: ['性格', '长相', '声音', '全都要'] },
            { q: '我做什么你最容易心动？', opts: ['突然抱你', '认真做事', '叫你昵称', '睡迷糊的样子'] },
            { q: '什么时候最想我？', opts: ['深夜', '吃饭时', '开心时', '随时都想'] },
            { q: '最想和我一起做的事？', opts: ['旅行', '看电影', '一起做饭', '都行'] },
            { q: '收到什么礼物最开心？', opts: ['手写的', '实用的', '惊喜的', '你送的都喜欢'] },
            { q: '我们像哪种动物CP？', opts: ['猫和狗', '两只猫', '两只仓鼠', '企鹅'] },
            { q: '我穿哪种颜色最好看？', opts: ['白色', '黑色', '你的幸运色', '什么都好看'] },
            { q: '我们约会的天花板？', opts: ['游乐园', '海边日落', '居家一天', '说走就走'] },
            { q: '哪句话最让你心动？', opts: ['我想你了', '交给我', '辛苦了', '有我在'] }
        ]},
        { cat: '尴尬名场面', qs: [
            { q: '最容易社死的场景？', opts: ['叫错名字', '当众摔跤', '发错消息', '认错人'] },
            { q: '一天中最困的时刻？', opts: ['下午两点', '刚吃完饭', '开会/上课时', '从不困'] },
            { q: '你手机最后一张照片是？', opts: ['自拍', '食物', '截图', '不告诉你'] },
            { q: '唱K你必点的是？', opts: ['深情情歌', '说唱', '嘶吼摇滚', '我只会吃'] },
            { q: '最想删除的动态是？', opts: ['中二文学', '九宫格自拍', '深夜emo', '全都想删'] },
            { q: '偶遇前任你会？', opts: ['大方问好', '假装没看见', '绕道走', '炫耀新生活'] },
            { q: '购物车里最多的是？', opts: ['衣服', '零食', '数码', '永远差一点买'] },
            { q: '半夜饿了你会？', opts: ['点外卖', '硬扛', '泡面', '摸黑找零食'] },
            { q: '被突然点名发言？', opts: ['大胆说', '心跳加速', '装没听见', '提前躲好'] },
            { q: '你删过最狠的东西？', opts: ['聊天记录', '游戏存档', '旧照片', '全都舍不得'] }
        ]},
        { cat: '灵魂拷问', qs: [
            { q: '吵架了谁先低头？', opts: ['我', 'ta', '看谁有错', '冷战到底'] },
            { q: '爱情里最重要的是？', opts: ['信任', '陪伴', '激情', '面包'] },
            { q: '能接受多远的异地？', opts: ['同城', '一小时', '一天车程', '距离不是问题'] },
            { q: '什么时候觉得"就是ta了"？', opts: ['某个瞬间', '还没确定', '相处久了', '见第一面'] },
            { q: '多久不回消息不能忍？', opts: ['几分钟', '几小时', '看情况', '直接打过去'] },
            { q: '婚姻对你来说是？', opts: ['必需品', '顺其自然', '加分项', '有点怕'] },
            { q: '我们最该改进的是？', opts: ['沟通', '陪伴', '信任', '都挺好的'] },
            { q: '被爱和爱人哪个重要？', opts: ['被爱', '爱人', '双向奔赴', '说不清'] },
            { q: '如果只剩24小时你会？', opts: ['陪最爱的人', '吃顿好的', '去想去的地方', '睡大觉'] },
            { q: '你现在幸福吗？', opts: ['幸福', '还不错', '一般般', '这题超纲'] }
        ]}
    ];

    // ta 亲自出题的题库（"让ta出题"从这里抽，抽过就存进自定义题库）
    var TA_BANK = [
        { q: '刚才有没有想我？说实话。', opts: ['有', '没有（嘴硬）', '超想', '你猜'] },
        { q: '我们下次约会去哪？', opts: ['你安排', '听我的', '在家待着', '去吃大餐'] },
        { q: '只能带一样去荒岛？', opts: ['带你', '带手机', '带吃的', '带帐篷'] },
        { q: '我最让你无语的一刻？', opts: ['讲冷笑话', '突然消失', '抢你吃的', '从没有过'] },
        { q: '给我们的关系起个歌名？', opts: ['小幸运', '甜甜的', '奇妙缘分', '你起吧'] },
        { q: '我最喜欢吃的菜？', opts: ['火锅', '你做的都爱吃', '不告诉你', '看你做的这道'] },
        { q: '下次见面第一件事？', opts: ['先抱一下', '先吃一顿', '先拍照', '你说了算'] },
        { q: '我会因为什么小事感动？', opts: ['记住我说的话', '突然出现', '小礼物', '你夸我'] },
        { q: '你猜我现在在干嘛？', opts: ['在想你', '在吃东西', '在打游戏', '在睡觉'] },
        { q: '如果画我，先画哪里？', opts: ['眼睛', '笑起来的嘴', '整体轮廓', '乱画一通'] }
    ];

    // 超时反应不再用固定吐槽文案（太出戏），改为随机字卡/表情包，见 partnerTimeoutReaction
    var MATCH_LINES = ['心有灵犀 ✨', '果然是一个人', '太默契了吧', '答案一致，加一分'];
    var DIFF_LINES = ['答案不一样，罚你想我十分钟', '选得不一样？说说为什么', '哼，答案不同（但差不多）', '不一致，记小本本了'];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function partnerName() { return (typeof settings !== 'undefined' && settings.partnerName) || '对方'; }
    function nowId() { return 'qa' + Date.now() + Math.floor(Math.random() * 1000); }

    // ── 样式注入 ────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('cx-qa-styles')) return;
        var st = document.createElement('style');
        st.id = 'cx-qa-styles';
        st.textContent =
            '.cx-qa-card{width:100%;max-width:260px;}' +
            '.cx-qa-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;}' +
            '.cx-qa-badge{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:linear-gradient(135deg,#ff5b6a,#ff8f5b);color:#fff;}' +
            '.cx-qa-cat{font-size:10.5px;color:var(--text-secondary);}' +
            '.cx-qa-q{font-size:14.5px;font-weight:700;color:var(--text-primary);line-height:1.5;margin-bottom:10px;}' +
            '.cx-qa-opt{display:block;width:100%;text-align:left;box-sizing:border-box;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;background:var(--primary-bg);color:var(--text-primary);font-size:12.5px;padding:9px 11px;margin-bottom:6px;cursor:pointer;line-height:1.4;}' +
            '.cx-qa-opt:active{border-color:#ff5b6a;background:rgba(255,91,106,.08);}' +
            '.cx-qa-timer{font-size:11px;color:#ff5b6a;font-weight:700;margin:2px 0 9px;}' +
            '.cx-qa-timer .cx-qa-bar{height:3px;border-radius:2px;background:rgba(255,91,106,.18);margin-top:4px;overflow:hidden;}' +
            '.cx-qa-timer .cx-qa-bar i{display:block;height:100%;background:#ff5b6a;border-radius:2px;}' +
            '.cx-qa-pick{font-size:12px;color:var(--text-secondary);background:var(--primary-bg);border-radius:10px;padding:8px 10px;margin-bottom:6px;}' +
            '.cx-qa-pick b{color:var(--text-primary);}' +
            '.cx-qa-verdict{font-size:12px;font-weight:700;border-radius:10px;padding:8px 10px;}' +
            '.cx-qa-verdict.match{background:rgba(62,201,126,.12);color:#3ec97e;}' +
            '.cx-qa-verdict.diff{background:rgba(255,91,106,.1);color:#ff5b6a;}' +
            '.cx-qa-timeout{font-size:12px;color:var(--text-secondary);opacity:.85;}' +
            '.cx-qa-chip{padding:8px 14px;border-radius:999px;border:1.5px solid var(--border-color,rgba(128,128,128,.25));background:transparent;color:var(--text-primary);font-size:12.5px;cursor:pointer;}' +
            '.cx-qa-chip.on{background:#ff5b6a;border-color:#ff5b6a;color:#fff;font-weight:700;}' +
            '.cx-qa-start{width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#ff5b6a,#ff8f5b);color:#fff;font-size:14.5px;font-weight:700;cursor:pointer;}' +
            '@keyframes cxFadeIn{from{opacity:0}to{opacity:1}}' +
            '@keyframes cxSlideIn{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:none}}';
        document.head.appendChild(st);
    }

    // ── 持久化 ──────────────────────────────────────────────
    function persistStates() { try { localforage.setItem(STATE_KEY, stateMap); } catch (e) {} }
    function persistStats() { try { localforage.setItem(STATS_KEY, stats); } catch (e) {} }
    function persistCustom() { try { localforage.setItem(CUSTOM_KEY, customList); } catch (e) {} }
    function rememberQuestion(q) {
        try {
            localforage.getItem(RECENT_KEY).then(function (r) {
                r = Array.isArray(r) ? r : [];
                r.unshift(q);
                localforage.setItem(RECENT_KEY, r.slice(0, 20));
            });
        } catch (e) {}
    }

    // 加题：q 非空 + 至少 2 个选项；重复题返回 'dup'
    function addCustomQuestion(q, opts, cat, by) {
        q = String(q || '').trim();
        opts = (opts || []).map(function (o) { return String(o || '').trim(); }).filter(Boolean);
        if (!q || opts.length < 2) return 'bad';
        if (customList.some(function (c) { return c.q === q; })) return 'dup';
        if (customList.length >= 100) return 'full';
        customList.unshift({ q: q, opts: opts, cat: cat || '自定义', by: by || 'me', ts: Date.now() });
        persistCustom();
        return true;
    }
    function removeCustomQuestion(idx) {
        customList.splice(idx, 1);
        persistCustom();
    }

    // 状态从本地载入后，把聊天里所有卡片重绘成正确状态（已答/超时/待答）
    function refreshAllCards() {
        document.querySelectorAll('.cx-qa-card[data-qa-id]').forEach(function (c) {
            redrawCard(c.getAttribute('data-qa-id'));
        });
    }

    function hydrate(cb) {
        if (hydrated) { if (cb) cb(); return; }
        Promise.all([
            localforage.getItem(STATE_KEY), localforage.getItem(STATS_KEY), localforage.getItem(CUSTOM_KEY)
        ]).then(function (res) {
            stateMap = res[0] || {};
            if (res[1]) stats = res[1];
            // 只保留带选项的题（老版本纯文字题自动淘汰）
            customList = (Array.isArray(res[2]) ? res[2] : []).filter(function (c) { return c && Array.isArray(c.opts) && c.opts.length >= 2; });
            hydrated = true;
            refreshAllCards();
            if (cb) cb();
        }).catch(function () { hydrated = true; if (cb) cb(); });
    }

    // ── 出题 ────────────────────────────────────────────────
    function pickQuestion(cat) {
        var isAll = !cat || cat === '全部';
        var pool = [];
        BANK.forEach(function (g) { if (isAll || g.cat === cat) pool = pool.concat(g.qs); });
        customList.forEach(function (c) {
            if (isAll || c.cat === cat || c.by === 'ta') pool.push(c);
        });
        if (!pool.length) pool = BANK[0].qs.slice();
        var recent = (window.__qaRecent || []);
        var fresh = pool.filter(function (p) { return recent.indexOf(p.q) === -1; });
        var finalPool = fresh.length ? fresh : pool;
        // ta 的题加权 4 份（≈25% 概率优先）
        var weighted = [];
        finalPool.forEach(function (p) {
            weighted.push(p);
            if (p.by === 'ta') { weighted.push(p); weighted.push(p); weighted.push(p); }
        });
        var pick = weighted[Math.floor(Math.random() * weighted.length)];
        return { q: pick.q, opts: pick.opts.slice(), cat: pick.cat, by: pick.by || null };
    }

    function askQuestion(cat, forceByTa) {
        var name = partnerName();
        var item;

        if (forceByTa) {
            var taPool = customList.filter(function (c) { return c.by === 'ta'; });
            if (taPool.length) {
                var pick = taPool[Math.floor(Math.random() * taPool.length)];
                item = { q: pick.q, opts: pick.opts.slice(), cat: pick.cat, by: 'ta' };
            } else {
                var b = TA_BANK[Math.floor(Math.random() * TA_BANK.length)];
                addCustomQuestion(b.q, b.opts, 'ta 的题', 'ta');
                item = { q: b.q, opts: b.opts.slice(), cat: 'ta 的题', by: 'ta' };
            }
        } else {
            item = pickQuestion(cat);
        }

        rememberQuestion(item.q);
        var qaId = nowId();
        if (typeof addMessage === 'function') {
            addMessage({
                id: qaId,
                sender: name,
                text: '',
                timestamp: new Date(),
                status: 'received',
                type: 'qa-question',
                qaId: qaId,
                qa: { q: item.q, opts: item.opts, cat: item.cat, by: item.by },
                favorited: false,
                note: null
            });
        }
        if (typeof playSound === 'function') playSound('message');
        if (typeof window._sendPartnerNotification === 'function') {
            window._sendPartnerNotification(name, (item.by === 'ta' ? '亲自给你出了道选择题：' : '快问快答来啦，10秒作答：') + item.q);
        }
    }

    // ── 模式三：我来提问（你出题，ta 限时 10 秒作答） ────────
    function askMyQuestion(item) {
        var qaId = nowId();
        if (typeof addMessage === 'function') {
            addMessage({
                id: qaId,
                sender: 'user',
                text: '',
                timestamp: new Date(),
                status: 'sent',
                type: 'qa-question',
                qaId: qaId,
                qa: { q: item.q, opts: item.opts, cat: item.cat, by: 'me' },
                favorited: false,
                note: null
            });
        }
        if (typeof playSound === 'function') playSound('send');

        // ta 在 2.5~7.5 秒内作答；10% 概率想太久直接超时（被你问住）
        var qaIdCapture = qaId;
        var optsCapture = item.opts.slice();
        if (Math.random() < 0.1) return; // 超时由倒计时兜底
        var delay = 2500 + Math.floor(Math.random() * 5000);
        setTimeout(function () { answerTa(qaIdCapture, optsCapture); }, delay);
    }

    // ta 作答（你提问的卡片）：记录 ta 的选择，轮到用户选
    function answerTa(qaId, opts) {
        if (stateMap[qaId]) return; // 已超时或已作答
        stateMap[qaId] = { state: 'waiting', taPick: Math.floor(Math.random() * opts.length) };
        persistStates();
        redrawCard(qaId);

        var mine = opts[stateMap[qaId].taPick];
        var name = partnerName();
        if (typeof addMessage === 'function') {
            addMessage({
                id: Date.now() + Math.random(),
                sender: name,
                text: '我的答案是：' + mine,
                timestamp: new Date(),
                status: 'received',
                type: 'normal',
                favorited: false,
                note: null,
                replyTo: { id: qaId, text: '', sender: 'user' }
            });
        }
        if (typeof playSound === 'function') playSound('message');
    }

    // ── 卡片渲染（core.js 调用） ────────────────────────────
    function renderCardHTML(msg) {
        var qa = msg.qa || {};
        var opts = Array.isArray(qa.opts) ? qa.opts : [];
        var qaId = String(msg.qaId || msg.id);
        var ts = new Date(msg.timestamp).getTime();
        if (isNaN(ts)) ts = Date.now();
        var st = stateMap[qaId];
        var byTa = !!(qa.by === 'ta');
        var askedByUser = msg.sender === 'user';
        var catMark = askedByUser ? '<i class="fas fa-paper-plane" style="font-size:9px;color:#ff8f5b;"></i> 我出的题 · '
            : (byTa ? '<i class="fas fa-heart" style="font-size:9px;color:#ff5b6a;"></i> ta 亲自出题 · ' : '');
        var head = '<div class="cx-qa-head"><span class="cx-qa-badge"><i class="fas fa-microphone"></i> 快问快答</span><span class="cx-qa-cat">' + catMark + esc(qa.cat || '') + '</span></div>' +
                   '<div class="cx-qa-q">' + esc(qa.q || '') + '</div>';

        var inner;
        if (!st) {
            var expired = (Date.now() - ts) > LIMIT_MS + 1000;
            if (expired) {
                inner = head + '<div class="cx-qa-timeout"><i class="fas fa-hourglass-end"></i> ' + (askedByUser ? 'ta 被这题问住了，没答上来…' : '这题没来得及回答…') + '</div>';
            } else if (askedByUser) {
                // 你出的题：倒计时是 ta 的作答时间，选项先不亮出来
                inner = head +
                    '<div class="cx-qa-timer">等 ta 作答 <span class="cx-qa-count" data-qa-id="' + esc(qaId) + '" data-deadline="' + (ts + LIMIT_MS) + '">10s</span>' +
                        '<div class="cx-qa-bar"><i class="cx-qa-bar-fill" data-qa-id="' + esc(qaId) + '" data-deadline="' + (ts + LIMIT_MS) + '" style="width:100%;"></i></div></div>' +
                    '<div style="font-size:11px;color:var(--text-secondary);">ta 正在纠结选项中…</div>';
            } else {
                // 选项按钮（问卷形式：点选项即作答）
                var optBtns = opts.map(function (o, i) {
                    return '<button class="cx-qa-opt" data-qa-id="' + esc(qaId) + '" data-i="' + i + '"><b style="color:#ff5b6a;margin-right:5px;">' + 'ABCD'.charAt(i % 4) + '.</b>' + esc(o) + '</button>';
                }).join('');
                inner = head +
                    '<div class="cx-qa-timer">限时作答 <span class="cx-qa-count" data-qa-id="' + esc(qaId) + '" data-deadline="' + (ts + LIMIT_MS) + '">10s</span>' +
                        '<div class="cx-qa-bar"><i class="cx-qa-bar-fill" data-qa-id="' + esc(qaId) + '" data-deadline="' + (ts + LIMIT_MS) + '" style="width:100%;"></i></div></div>' +
                    optBtns;
            }
        } else if (st.state === 'answered') {
            var mine = opts[st.pick] != null ? opts[st.pick] : '——';
            var ta = opts[st.taPick] != null ? opts[st.taPick] : '——';
            var matched = st.pick === st.taPick;
            var lines = matched ? MATCH_LINES : DIFF_LINES;
            inner = head +
                '<div class="cx-qa-pick">你的选择：<b>' + esc(mine) + '</b></div>' +
                '<div class="cx-qa-pick">ta 的选择：<b>' + esc(ta) + '</b></div>' +
                '<div class="cx-qa-verdict ' + (matched ? 'match' : 'diff') + '"><i class="fas ' + (matched ? 'fa-heart' : 'fa-comment-dots') + '"></i> ' + esc(lines[Math.abs(String(qaId).split('').reduce(function (a, c) { return a + c.charCodeAt(0); }, 0)) % lines.length]) + '</div>';
        } else if (st.state === 'waiting') {
            // 「我来提问」的卡片：ta 已作答，轮到用户选（不限时）
            var taPickTxt = opts[st.taPick] != null ? opts[st.taPick] : '——';
            var myBtns = opts.map(function (o, i) {
                return '<button class="cx-qa-opt" data-qa-id="' + esc(qaId) + '" data-i="' + i + '"><b style="color:#ff5b6a;margin-right:5px;">' + 'ABCD'.charAt(i % 4) + '.</b>' + esc(o) + '</button>';
            }).join('');
            inner = head +
                '<div class="cx-qa-pick">ta 的选择：<b>' + esc(taPickTxt) + '</b></div>' +
                '<div style="font-size:11.5px;font-weight:700;color:#ff5b6a;margin:8px 0 6px;">轮到你了，选出你的答案：</div>' +
                myBtns;
        } else {
            inner = head + '<div class="cx-qa-timeout"><i class="fas fa-hourglass-end"></i> ' + (askedByUser ? 'ta 超时没答上，被你问住了' : '超时未作答，被记了一笔') + '</div>';
        }

        // 外层卡片带数据属性：提交作答/重绘时靠它们找回题目和选项
        // （opts JSON 经 esc 转义后放进属性，getAttribute 会自动还原成原 JSON 字符串）
        var cardAttrs = 'data-qa-id="' + esc(qaId) + '" data-ts="' + ts + '"' +
            ' data-q="' + esc(qa.q || '') + '" data-cat="' + esc(qa.cat || '') + '" data-by="' + (byTa ? 'ta' : '') + '"' +
            ' data-sender="' + (askedByUser ? 'user' : 'ta') + '"' +
            ' data-opts="' + esc(JSON.stringify(opts)) + '"';
        return '<div class="cx-qa-card" ' + cardAttrs + '>' +
                   '<div class="cx-qa-body">' + inner + '</div></div>';
    }

    // 用卡片上携带的数据重绘整张卡（作答后/超时后调用）
    function redrawCard(qaId) {
        var card = document.querySelector('.cx-qa-card[data-qa-id="' + qaId + '"]');
        if (!card) return;
        var opts = [];
        try { opts = JSON.parse(card.getAttribute('data-opts') || '[]'); } catch (e) {}
        var tmp = document.createElement('div');
        tmp.innerHTML = renderCardHTML({
            qaId: qaId,
            sender: card.getAttribute('data-sender') === 'user' ? 'user' : partnerName(),
            timestamp: Number(card.getAttribute('data-ts')) || Date.now(),
            qa: {
                q: card.getAttribute('data-q') || '',
                opts: opts,
                cat: card.getAttribute('data-cat') || '',
                by: card.getAttribute('data-by') || null
            }
        });
        if (tmp.firstChild) card.replaceWith(tmp.firstChild);
        bindOptions();
    }

    // 事件委托：点击只绑一次在 document 上，之后新插入的题卡选项也能直接点
    // （旧做法绑在每个按钮元素上，新消息渲染时没人补绑，导致选项点不了）
    function bindOptions() {
        if (bindOptions._delegated) return;
        bindOptions._delegated = true;
        document.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== document) {
                if (el.classList && el.classList.contains('cx-qa-opt')) {
                    submitPick(el.getAttribute('data-qa-id'), Number(el.getAttribute('data-i')));
                    return;
                }
                el = el.parentNode;
            }
        });
    }

    function submitPick(qaId, idx) {
        var card = document.querySelector('.cx-qa-card[data-qa-id="' + qaId + '"]');
        if (!card) return;
        var st = stateMap[qaId];
        if (st && st.state !== 'waiting') return; // 已作答/已超时
        var opts = [];
        try { opts = JSON.parse(card.getAttribute('data-opts') || '[]'); } catch (e) {}
        var mine = opts[idx];
        if (mine == null) return;

        // 「我来提问」的卡片：ta 已先作答（waiting），这里补上用户的选择
        var taPick = (st && st.state === 'waiting') ? st.taPick : Math.floor(Math.random() * opts.length);
        stateMap[qaId] = { state: 'answered', pick: idx, taPick: taPick };
        persistStates();
        stats.total = (stats.total || 0) + 1;
        persistStats();

        redrawCard(qaId);

        // 答案作为用户消息进聊天（带引用指向题目卡片）
        var qText = card.getAttribute('data-q') || '';
        var askedByUser = card.getAttribute('data-sender') === 'user';
        if (typeof addMessage === 'function') {
            addMessage({
                id: Date.now() + Math.random(),
                sender: 'user',
                text: '我的答案：' + mine,
                timestamp: new Date(),
                status: 'sent',
                type: 'normal',
                favorited: false,
                note: null,
                replyTo: qText ? { id: qaId, text: qText, sender: askedByUser ? 'user' : partnerName() } : null
            });
        }
        if (typeof playSound === 'function') playSound('send');
        if (typeof window._triggerDelayedReply === 'function') window._triggerDelayedReply(true);
    }

    // ── ta 的反应素材池（和主聊天回复引擎同一套来源） ─────────
    // 字卡池：window._customReplies 减去被屏蔽/被分组禁用的，过滤逻辑和 core.js 一致
    function buildReplyPool() {
        var src = (window._customReplies && window._customReplies.length) ? window._customReplies : [];
        var disabled = new Set();
        try {
            var raw = localStorage.getItem('disabledReplyItems');
            if (raw) JSON.parse(raw).forEach(function (x) { disabled.add(x); });
        } catch (e) {}
        var disabledGroup = new Set();
        (window.customReplyGroups || []).forEach(function (g) {
            if (g.disabled && Array.isArray(g.items)) g.items.forEach(function (item) { disabledGroup.add(item); });
        });
        return src.filter(function (r) { return !disabled.has(r) && !disabledGroup.has(r); })
            .map(function (r) { return String(r || '').trim(); })
            .filter(Boolean);
    }

    // 表情包池：ta 的表情库减去被屏蔽的
    function buildStickerPool() {
        var lib = (typeof stickerLibrary !== 'undefined' && stickerLibrary && stickerLibrary.length) ? stickerLibrary : [];
        var disabled = new Set();
        try {
            var raw = localStorage.getItem('disabledStickerItems');
            if (raw) JSON.parse(raw).forEach(function (x) { disabled.add(x); });
        } catch (e) {}
        return lib.filter(function (s) { return !disabled.has(s); });
    }

    // 超时后 ta 的反应：像平时聊天一样，随机回一张字卡（60%）或一张表情包（40%），
    // 引用着你没答的那道题；两个库都空就保持安静，不硬凑
    function partnerTimeoutReaction(qaId, qText) {
        if (typeof addMessage !== 'function') return;
        var name = partnerName();
        var replies = buildReplyPool();
        var stickers = buildStickerPool();
        var useSticker = stickers.length > 0 && (replies.length === 0 || Math.random() < 0.4);
        var line = null;
        var replyTo = qText ? { id: qaId, text: qText, sender: 'user' } : null;
        if (useSticker) {
            addMessage({
                id: Date.now() + Math.random(),
                sender: name,
                text: '',
                timestamp: new Date(),
                image: stickers[Math.floor(Math.random() * stickers.length)],
                isSticker: true,
                status: 'received',
                type: 'normal',
                favorited: false,
                note: null,
                replyTo: replyTo
            });
        } else if (replies.length > 0) {
            line = replies[Math.floor(Math.random() * replies.length)];
            addMessage({
                id: Date.now() + Math.random(),
                sender: name,
                text: line,
                timestamp: new Date(),
                status: 'received',
                type: 'normal',
                favorited: false,
                note: null,
                replyTo: replyTo
            });
        } else {
            return;
        }
        if (typeof playSound === 'function') playSound('message');
        if (typeof window._sendPartnerNotification === 'function') window._sendPartnerNotification(name, line || '[表情]');
    }

    function markTimeout(qaId) {
        if (stateMap[qaId]) return;
        stateMap[qaId] = { state: 'timeout' };
        persistStates();
        redrawCard(qaId);
        var card = document.querySelector('.cx-qa-card[data-qa-id="' + qaId + '"]');
        var qText = card ? (card.getAttribute('data-q') || '') : '';
        partnerTimeoutReaction(qaId, qText);
    }

    // ── 全局计时器：每 300ms 扫一遍倒计时 ───────────────────
    setInterval(function () {
        if (!hydrated) return;
        var t = Date.now();
        document.querySelectorAll('.cx-qa-count').forEach(function (el) {
            var deadline = Number(el.getAttribute('data-deadline'));
            var left = deadline - t;
            if (left <= 0) { markTimeout(el.getAttribute('data-qa-id')); return; }
            el.textContent = Math.ceil(left / 1000) + 's';
            var bar = document.querySelector('.cx-qa-bar-fill[data-qa-id="' + el.getAttribute('data-qa-id') + '"]');
            if (bar) bar.style.width = Math.max(0, Math.min(100, (left / LIMIT_MS) * 100)) + '%';
        });
    }, 300);

    // ── 弹窗 ────────────────────────────────────────────────
    function closeModal(overlay) { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    // ── 模式三面板：我来提问（从题库选 / 现场写一道） ────────
    function openAskPanel() {
        injectStyles();
        hydrate();
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:cxFadeIn .2s ease;';
        overlay.innerHTML =
            '<div style="background:var(--secondary-bg);border-radius:20px;padding:22px;width:88%;max-width:350px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:cxSlideIn .25s ease forwards;max-height:84vh;overflow-y:auto;">' +
                '<div style="text-align:center;margin-bottom:14px;">' +
                    '<div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,rgba(255,143,91,.15),rgba(255,91,143,.15));display:flex;align-items:center;justify-content:center;margin:0 auto 10px;"><i class="fas fa-paper-plane" style="color:#ff8f5b;font-size:18px;"></i></div>' +
                    '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">我来提问</div>' +
                    '<div style="font-size:12px;color:var(--text-secondary);">你出选择题 · ta 限时10秒作答 · 轮到你选后对比默契</div>' +
                '</div>' +
                '<div id="cx-qa-ask-src" style="display:flex;gap:7px;justify-content:center;margin-bottom:12px;">' +
                    '<button class="cx-qa-chip on" data-src="bank">从题库选</button>' +
                    '<button class="cx-qa-chip" data-src="write">现场写一道</button>' +
                '</div>' +
                '<div id="cx-qa-ask-body"></div>' +
            '</div>';
        document.body.appendChild(overlay);
        var bodyEl = overlay.querySelector('#cx-qa-ask-body');
        var mode = 'bank';

        function qRow(q, opts, cat, tag) {
            return '<div style="padding:9px 0;border-bottom:1px dashed var(--border-color,rgba(128,128,128,.18));">' +
                '<div style="display:flex;align-items:center;gap:7px;">' +
                    (tag ? '<span style="font-size:10px;flex-shrink:0;padding:2px 7px;border-radius:999px;' + (tag === 'ta' ? 'background:linear-gradient(135deg,#8f5bff,#5b8fff);color:#fff;' : 'background:rgba(255,91,106,.12);color:#ff5b6a;') + 'font-weight:700;">' + tag + '</span>' : '') +
                    '<span style="flex:1;min-width:0;font-size:12px;color:var(--text-primary);font-weight:700;word-break:break-all;">' + esc(q) + '</span>' +
                    '<button class="cx-qa-ask-now" data-q="' + esc(q) + '" data-opts="' + esc(JSON.stringify(opts)) + '" data-cat="' + esc(cat || '') + '" data-tag="' + (tag || '') + '" style="flex-shrink:0;border:none;border-radius:999px;padding:5px 12px;background:linear-gradient(135deg,#ff8f5b,#ff5b8f);color:#fff;font-size:11px;font-weight:700;cursor:pointer;">提问</button>' +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-secondary);margin:4px 0 0 2px;word-break:break-all;">' + esc(opts.join(' / ')) + '</div>' +
            '</div>';
        }

        function renderBody() {
            overlay.querySelectorAll('#cx-qa-ask-src .cx-qa-chip').forEach(function (chip) {
                chip.classList.toggle('on', chip.dataset.src === mode);
            });
            if (mode === 'bank') {
                hydrate(function () {
                    var rows = [];
                    BANK.forEach(function (g) {
                        g.items.forEach(function (it) { rows.push(qRow(it.q, it.opts, g.cat, '')); });
                    });
                    customList.forEach(function (c) { rows.push(qRow(c.q, c.opts, c.cat, c.by === 'ta' ? 'ta' : '我')); });
                    bodyEl.innerHTML = '<div style="max-height:320px;overflow-y:auto;">' +
                        (rows.length ? rows.join('') : '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:10px 0;">题库是空的</div>') +
                        '</div>';
                    bodyEl.querySelectorAll('.cx-qa-ask-now').forEach(function (btn) {
                        btn.addEventListener('click', function () {
                            var item = { q: btn.dataset.q, opts: [], cat: btn.dataset.cat };
                            try { item.opts = JSON.parse(btn.dataset.opts || '[]'); } catch (e) {}
                            closeModal(overlay);
                            askMyQuestion(item);
                        });
                    });
                });
            } else {
                bodyEl.innerHTML =
                    '<input id="cx-qa-ask-q" placeholder="题目：想问ta的问题…" maxlength="50" style="width:100%;box-sizing:border-box;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;margin-bottom:6px;">' +
                    '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
                        '<input class="cx-qa-ask-o" placeholder="选项A" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                        '<input class="cx-qa-ask-o" placeholder="选项B" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
                        '<input class="cx-qa-ask-o" placeholder="选项C（选填）" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                        '<input class="cx-qa-ask-o" placeholder="选项D（选填）" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                    '</div>' +
                    '<button id="cx-qa-ask-go" class="cx-qa-start" style="width:100%;"><i class="fas fa-paper-plane"></i> 直接提问</button>' +
                    '<div style="font-size:10.5px;color:var(--text-secondary);text-align:center;margin-top:7px;">提问会同时存入「我们的题库」，以后能随时再问</div>';
                bodyEl.querySelector('#cx-qa-ask-go').addEventListener('click', function () {
                    var q = bodyEl.querySelector('#cx-qa-ask-q').value;
                    var opts = [];
                    bodyEl.querySelectorAll('.cx-qa-ask-o').forEach(function (i) { opts.push(i.value); });
                    var r = addCustomQuestion(q, opts, '自定义', 'me');
                    if (r === 'bad') { if (typeof showNotification === 'function') showNotification('题目和至少 2 个选项都要填哦', 'info'); return; }
                    if (r === 'dup') { if (typeof showNotification === 'function') showNotification('题库里已有这道题，去「从题库选」里提问吧', 'info'); return; }
                    if (r === 'full') { if (typeof showNotification === 'function') showNotification('题库已满（100 道），这次不保存、直接提问', 'info', 2200); }
                    closeModal(overlay);
                    askMyQuestion({ q: q, opts: opts.filter(Boolean), cat: '自定义' });
                });
                bodyEl.querySelector('#cx-qa-ask-q').addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') bodyEl.querySelector('#cx-qa-ask-go').click();
                });
            }
        }

        overlay.querySelectorAll('#cx-qa-ask-src .cx-qa-chip').forEach(function (chip) {
            chip.addEventListener('click', function () { mode = chip.dataset.src; renderBody(); });
        });
        renderBody();
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay); });
    }

    function openQAModal() {
        injectStyles();
        hydrate();
        var curCat = '全部';
        var listOpen = false;
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:cxFadeIn .2s ease;';
        overlay.innerHTML =
            '<div style="background:var(--secondary-bg);border-radius:20px;padding:22px;width:88%;max-width:350px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:cxSlideIn .25s ease forwards;max-height:84vh;overflow-y:auto;">' +
                '<div style="text-align:center;margin-bottom:14px;">' +
                    '<div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,rgba(255,91,106,.15),rgba(255,143,91,.15));display:flex;align-items:center;justify-content:center;margin:0 auto 10px;"><i class="fas fa-microphone" style="color:#ff5b6a;font-size:19px;"></i></div>' +
                    '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">快问快答</div>' +
                    '<div style="font-size:12px;color:var(--text-secondary);">选择题 · 10秒作答 · 你问我答比默契</div>' +
                '</div>' +
                '<div id="cx-qa-cats" style="display:flex;flex-wrap:wrap;gap:7px;justify-content:center;margin-bottom:12px;"></div>' +
                '<div id="cx-qa-custom-sec" style="border:1.5px dashed var(--border-color,rgba(128,128,128,.3));border-radius:14px;padding:11px 12px;margin-bottom:12px;">' +
                    '<div id="cx-qa-custom-toggle" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">' +
                        '<span style="font-size:12.5px;font-weight:700;color:var(--text-primary);"><i class="fas fa-pen-to-square" style="color:#ff5b6a;font-size:11px;"></i> 我们的题库</span>' +
                        '<span id="cx-qa-custom-count" style="font-size:11px;color:var(--text-secondary);"></span>' +
                    '</div>' +
                    '<div id="cx-qa-custom-body" style="display:none;margin-top:10px;"></div>' +
                '</div>' +
                '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
                    '<button id="cx-qa-start" class="cx-qa-start" style="flex:1.7;"><i class="fas fa-bolt"></i> 开始挑战</button>' +
                    '<button id="cx-qa-ta" class="cx-qa-start" style="flex:1;background:linear-gradient(135deg,#8f5bff,#5b8fff);"><i class="fas fa-heart"></i> 让ta出题</button>' +
                '</div>' +
                '<button id="cx-qa-ask" class="cx-qa-start" style="width:100%;margin-bottom:8px;background:linear-gradient(135deg,#ff8f5b,#ff5b8f);"><i class="fas fa-paper-plane"></i> 我来提问 · ta 10秒作答</button>' +
                '<div id="cx-qa-stat" style="text-align:center;font-size:11px;color:var(--text-secondary);margin-top:6px;"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        var catsBox = overlay.querySelector('#cx-qa-cats');
        var statEl = overlay.querySelector('#cx-qa-stat');
        var toggleEl = overlay.querySelector('#cx-qa-custom-toggle');
        var countEl = overlay.querySelector('#cx-qa-custom-count');
        var bodyEl = overlay.querySelector('#cx-qa-custom-body');

        function renderCats() {
            catsBox.innerHTML = ['全部'].concat(BANK.map(function (g) { return g.cat; })).map(function (c) {
                return '<button class="cx-qa-chip' + (c === curCat ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
            }).join('');
            catsBox.querySelectorAll('.cx-qa-chip').forEach(function (chip) {
                chip.addEventListener('click', function () { curCat = chip.dataset.cat; renderCats(); });
            });
        }

        function renderCustomBody() {
            var meCnt = customList.filter(function (c) { return c.by !== 'ta'; }).length;
            var taCnt = customList.filter(function (c) { return c.by === 'ta'; }).length;
            countEl.textContent = meCnt ? (meCnt + ' 道你的' + (taCnt ? ' · ' + taCnt + ' 道ta的' : '')) : (taCnt ? taCnt + ' 道ta的' : '还没有自定义题');
            if (!listOpen) { bodyEl.style.display = 'none'; return; }
            bodyEl.style.display = 'block';
            var rows = customList.map(function (c, i) {
                return '<div style="padding:8px 0;border-bottom:1px dashed var(--border-color,rgba(128,128,128,.18));">' +
                    '<div style="display:flex;align-items:center;gap:7px;">' +
                        '<span style="font-size:10px;flex-shrink:0;padding:2px 7px;border-radius:999px;' + (c.by === 'ta' ? 'background:linear-gradient(135deg,#8f5bff,#5b8fff);color:#fff;' : 'background:rgba(255,91,106,.12);color:#ff5b6a;') + 'font-weight:700;">' + (c.by === 'ta' ? 'ta' : '我') + '</span>' +
                        '<span style="flex:1;min-width:0;font-size:12px;color:var(--text-primary);font-weight:700;word-break:break-all;">' + esc(c.q) + '</span>' +
                        '<button class="cx-qa-del" data-i="' + i + '" style="border:none;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:12px;flex-shrink:0;padding:2px 4px;"><i class="fas fa-trash-alt"></i></button>' +
                    '</div>' +
                    '<div style="font-size:11px;color:var(--text-secondary);margin:4px 0 0 2px;word-break:break-all;">选项：' + esc(c.opts.join(' / ')) + '</div>' +
                '</div>';
            }).join('');
            bodyEl.innerHTML =
                (customList.length
                    ? '<div style="max-height:150px;overflow-y:auto;">' + rows + '</div>'
                    : '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">还没有自定义题，在下面添加吧（至少 2 个选项）</div>') +
                '<div style="margin-top:9px;">' +
                    '<input id="cx-qa-add-q" placeholder="题目：只有你们俩才懂的问题…" maxlength="50" style="width:100%;box-sizing:border-box;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;margin-bottom:6px;">' +
                    '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
                        '<input class="cx-qa-add-o" placeholder="选项A" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                        '<input class="cx-qa-add-o" placeholder="选项B" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
                        '<input class="cx-qa-add-o" placeholder="选项C（选填）" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                        '<input class="cx-qa-add-o" placeholder="选项D（选填）" maxlength="20" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;">' +
                        '<select id="cx-qa-add-cat" style="flex:1;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 6px;font-size:11px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                            ['自定义'].concat(BANK.map(function (g) { return g.cat; })).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') +
                        '</select>' +
                        '<button id="cx-qa-add-btn" style="flex-shrink:0;border:none;border-radius:10px;padding:0 16px;background:#ff5b6a;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">添加</button>' +
                    '</div>' +
                '</div>';

            bodyEl.querySelectorAll('.cx-qa-del').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    removeCustomQuestion(Number(btn.dataset.i));
                    renderCustomBody();
                });
            });
            bodyEl.querySelector('#cx-qa-add-btn').addEventListener('click', function () {
                var q = bodyEl.querySelector('#cx-qa-add-q').value;
                var opts = [];
                bodyEl.querySelectorAll('.cx-qa-add-o').forEach(function (i) { opts.push(i.value); });
                var cat = bodyEl.querySelector('#cx-qa-add-cat').value;
                var r = addCustomQuestion(q, opts, cat, 'me');
                if (r === 'bad') { if (typeof showNotification === 'function') showNotification('题目和至少 2 个选项都要填哦', 'info'); return; }
                if (r === 'dup') { if (typeof showNotification === 'function') showNotification('这道题已经在题库里啦', 'info'); return; }
                if (r === 'full') { if (typeof showNotification === 'function') showNotification('题库已满（100 道），先删一点吧', 'error'); return; }
                if (typeof showNotification === 'function') showNotification('✦ 已加入题库，开始挑战就有机会抽到', 'info', 2000);
                renderCustomBody();
            });
            bodyEl.querySelector('#cx-qa-add-q').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') bodyEl.querySelector('#cx-qa-add-btn').click();
            });
        }

        toggleEl.addEventListener('click', function () { listOpen = !listOpen; renderCustomBody(); });
        renderCats();
        renderCustomBody();
        hydrate(function () {
            statEl.textContent = (stats.total || 0) > 0 ? ('你已经累计回答了 ' + stats.total + ' 题') : '还没有答题记录，来试试吧';
            renderCustomBody();
        });

        overlay.querySelector('#cx-qa-start').addEventListener('click', function () {
            closeModal(overlay);
            askQuestion(curCat, false);
        });
        overlay.querySelector('#cx-qa-ta').addEventListener('click', function () {
            closeModal(overlay);
            askQuestion(curCat, true);
        });
        overlay.querySelector('#cx-qa-ask').addEventListener('click', function () {
            closeModal(overlay);
            openAskPanel();
        });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay); });
    }

    // ── 初始化 ─────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        injectStyles();
        hydrate();
        setTimeout(bindOptions, 800);
        if (window.MoreMenu && typeof window.MoreMenu.registerItem === 'function') {
            window.MoreMenu.registerItem('qa', { ready: true, action: openQAModal });
        }
    });

    window.QuickQA = {
        renderCardHTML: renderCardHTML,
        openModal: openQAModal,
        _bindOptions: bindOptions
    };
})();
