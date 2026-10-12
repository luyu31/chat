/* ============================================================
   快问快答 v2（"+"菜单 → 快问快答）
   - 玩法：梦角向你发起快问快答挑战——抽一道题发进聊天（限时15秒的
     问题卡片），你在卡片输入框里作答；答完梦角自然接话，超时会被嘲笑
   - 题库 = 内置 4 分类 × 16 题 + 自定义题目（你加的 + ta 加的）
   - 自定义题库存 localforage: cx_qa_custom [{q, cat, by:'me'|'ta'}]
     · 弹窗里可以自己加题/删题
     · 点"让ta出题"，ta 会亲自出一道（出自 ta 的题库，出一道存一道）
     · 随机抽题时 ta 的题有 25% 优先被抽中
   - 卡片状态（待答/已答/超时）存 localforage: cx_qa_states
   ============================================================ */
(function () {
    'use strict';

    var STATE_KEY = 'cx_qa_states';
    var STATS_KEY = 'cx_qa_stats';
    var RECENT_KEY = 'cx_qa_recent';
    var CUSTOM_KEY = 'cx_qa_custom';
    var LIMIT_MS = 15000;

    var stateMap = {};  // qaId -> {state:'answered'|'timeout', answer:''}
    var stats = { total: 0, byCat: {} };
    var customList = []; // 自定义题目 [{q, cat, by:'me'|'ta', ts}]
    var hydrated = false;

    var BANK = [
        { cat: '日常脑洞', qs: [
            '如果明天不用上班/上学，你最想干什么？', '你觉得我像什么口味的奶茶？', '如果能拥有一个超能力，你要哪个？',
            '你手机里最舍不得删的一张照片是什么？', '如果可以瞬间移动，你现在想去哪？', '你小时候的梦想是什么？',
            '如果养一只宠物，你想养什么，叫什么名字？', '你最想穿越到哪个年代？', '你觉得十年后的自己在做什么？',
            '如果请我吃饭，你会带我去哪？', '你的手机密码暗示了什么？', '如果给你一天当异性，你最想干什么？',
            '你的床头必须有什么？', '哪首歌是你现在的单曲循环？', '如果改成四天工作制，多出来那天你干嘛？',
            '你觉得我们上辈子是什么关系？'
        ]},
        { cat: '心动瞬间', qs: [
            '你第一次对我心动是什么时候？', '我做过让你最感动的一件事是什么？', '你最喜欢我哪一点？说三个。',
            '你什么时候最想抱抱我？', '你觉得我们最有默契的一瞬间是什么时候？', '第一次见我之前，你想象中的我是什么样？',
            '我穿什么类型的衣服你觉得最好看？', '你偷偷观察过我睡觉吗？', '我们的第一次约会，你还记得细节吗？',
            '你最想在哪个节日收到我的礼物？', '用三个词形容我，你会用哪三个？', '你希望我们老了以后住在哪里？',
            '你说过的最让我心动的一句话还记得吗？', '如果给我做一顿饭，你想做什么？', '你觉得我们俩谁先动心的？',
            '你手机里我的备注是什么？敢说实话吗？'
        ]},
        { cat: '尴尬名场面', qs: [
            '你干过最社死的事是什么？', '你有没有叫错别人名字的翻车现场？', '你最尴尬的一次说错话是什么？',
            '你有没有在公众场合摔过跤？', '你暗恋一个人时干过最傻的事是什么？', '你有没有发错消息到群里的经历？',
            '你上学时传纸条被抓过吗？', '你有没有认错人然后热情打招呼？', '你第一次喝醉是什么样子？',
            '你有没有把老师/老板名字写错的黑历史？', '你最想删掉的一条动态是什么？', '你撒过的最离谱的谎是什么？',
            '你有没有假装认识一个根本不认识的人？', '你在外地迷过路吗？后来怎么解决的？', '你有没有穿反衣服出门一整天？',
            '你被当众训过最丢人的一次是？'
        ]},
        { cat: '灵魂拷问', qs: [
            '如果我们吵架了，你会先低头吗？', '你觉得爱情里最重要的是什么？', '你能接受异地恋超过两年吗？',
            '你觉得我们最大的分歧是什么？', '如果我变了，你会怎么提醒我？', '你怕老吗？为什么？',
            '你觉得婚姻是必需品吗？', '如果只剩最后一天，你最想跟谁度过？', '你愿意为我放弃一座城市吗？',
            '你觉得我们现在最大的问题是什么？', '你希望我改掉的一个习惯是什么？诚实点。', '陪伴和面包，哪个更不能缺？',
            '你最近一次哭是因为什么？', '如果我们一直没有结果，你会后悔吗？', '被爱重要还是爱人重要？',
            '你对我的第一印象和现在差多少？'
        ]}
    ];

    // ta 亲自出题的题库（"让ta出题"会从这里抽，抽过就存进自定义题库，越玩越多）
    var TA_BANK = [
        '刚才有没有想我？说实话。', '如果我现在突然出现在你身后，你会干嘛？', '你觉得我们下次约会应该去哪？',
        '我最近哪里进步了？要夸得具体一点。', '用一句话形容你现在的心情。', '只能带一样东西去荒岛，你带我还是带手机？',
        '你今天笑得最开心的一刻是什么？', '我最让你无语的一个瞬间是什么？', '如果给我们的关系起个歌名，会是哪首？',
        '你猜我现在在干什么？猜错有惩罚。', '我最喜欢吃的菜是什么？答错就去做饭。', '下次见面，你想第一件事先干嘛？',
        '你觉得我会因为什么小事感动？', '如果给我画一幅画像，你会先画哪里？'
    ];

    var TIMEOUT_TEASES = [
        '15秒都答不上来？看来这题戳中你了😏', '超时啦！这题就当你认输了~', '哈哈哈答不上来了吧，我先记一笔！',
        '时间到~你欠我一个答案，下次见面还！', '就这？我随便挑一题就把你问住了'
    ];

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
            '.cx-qa-card{width:100%;max-width:250px;}' +
            '.cx-qa-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;}' +
            '.cx-qa-badge{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:linear-gradient(135deg,#ff5b6a,#ff8f5b);color:#fff;}' +
            '.cx-qa-cat{font-size:10.5px;color:var(--text-secondary);}' +
            '.cx-qa-q{font-size:14.5px;font-weight:700;color:var(--text-primary);line-height:1.5;margin-bottom:10px;}' +
            '.cx-qa-timer{font-size:11px;color:#ff5b6a;font-weight:700;margin-bottom:8px;}' +
            '.cx-qa-timer .cx-qa-bar{height:3px;border-radius:2px;background:rgba(255,91,106,.18);margin-top:4px;overflow:hidden;}' +
            '.cx-qa-timer .cx-qa-bar i{display:block;height:100%;background:#ff5b6a;border-radius:2px;}' +
            '.cx-qa-inputrow{display:flex;gap:6px;}' +
            '.cx-qa-input{flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12.5px;background:var(--primary-bg);color:var(--text-primary);outline:none;}' +
            '.cx-qa-input:focus{border-color:#ff5b6a;}' +
            '.cx-qa-go{border:none;border-radius:10px;padding:0 13px;background:#ff5b6a;color:#fff;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;}' +
            '.cx-qa-done{display:flex;gap:6px;align-items:flex-start;font-size:12px;color:var(--text-secondary);background:var(--primary-bg);border-radius:10px;padding:8px 10px;}' +
            '.cx-qa-done b{color:var(--text-primary);word-break:break-all;}' +
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
    function rememberQuestion(q) {
        try {
            localforage.getItem(RECENT_KEY).then(function (r) {
                r = Array.isArray(r) ? r : [];
                r.unshift(q);
                localforage.setItem(RECENT_KEY, r.slice(0, 20));
            });
        } catch (e) {}
    }
    function persistCustom() { try { localforage.setItem(CUSTOM_KEY, customList); } catch (e) {} }

    function addCustomQuestion(q, cat, by) {
        q = String(q || '').trim();
        if (!q) return false;
        if (customList.some(function (c) { return c.q === q; })) return 'dup';
        if (customList.length >= 100) return 'full';
        customList.unshift({ q: q, cat: cat || '自定义', by: by || 'me', ts: Date.now() });
        persistCustom();
        return true;
    }
    function removeCustomQuestion(idx) {
        customList.splice(idx, 1);
        persistCustom();
    }

    function hydrate(cb) {
        if (hydrated) { if (cb) cb(); return; }
        Promise.all([
            localforage.getItem(STATE_KEY), localforage.getItem(STATS_KEY), localforage.getItem(CUSTOM_KEY)
        ]).then(function (res) {
            stateMap = res[0] || {};
            if (res[1]) stats = res[1];
            customList = Array.isArray(res[2]) ? res[2] : [];
            hydrated = true;
            refreshCards();
            if (cb) cb();
        }).catch(function () { hydrated = true; if (cb) cb(); });
    }

    // ── 出题 ────────────────────────────────────────────────
    function pickQuestion(cat) {
        var isAll = !cat || cat === '全部';
        var pool = [];
        BANK.forEach(function (g) { if (isAll || g.cat === cat) pool = pool.concat(g.qs.map(function (q) { return { q: q, cat: g.cat, by: null }; })); });
        // 自定义题（你加的 + ta 加的）也进抽题池；"ta 出的题"不在指定分类时也算进来
        customList.forEach(function (c) {
            if (isAll || c.cat === cat || c.by === 'ta') pool.push({ q: c.q, cat: c.cat, by: c.by });
        });
        if (!pool.length) pool = BANK[0].qs.map(function (q) { return { q: q, cat: BANK[0].cat, by: null }; });
        var recent = (window.__qaRecent || []);
        var fresh = pool.filter(function (p) { return recent.indexOf(p.q) === -1; });
        var finalPool = fresh.length ? fresh : pool;
        // ta 的题有 25% 优先权重：把 ta 的题复制几份进池子，提高命中概率
        var weighted = [];
        finalPool.forEach(function (p) {
            weighted.push(p);
            if (p.by === 'ta') { weighted.push(p); weighted.push(p); weighted.push(p); } // 额外3份 ≈ 25%概率优先
        });
        return weighted[Math.floor(Math.random() * weighted.length)];
    }

    function askQuestion(cat, forceByTa) {
        var name = partnerName();
        var item;

        if (forceByTa) {
            // ta 亲自出题：优先从"ta 已经出过的题"里抽，否则从 ta 的原生题库抽一道并存档
            var taPool = customList.filter(function (c) { return c.by === 'ta'; });
            if (taPool.length) {
                var pick = taPool[Math.floor(Math.random() * taPool.length)];
                item = { q: pick.q, cat: pick.cat, by: 'ta' };
            } else {
                var q = TA_BANK[Math.floor(Math.random() * TA_BANK.length)];
                addCustomQuestion(q, 'ta 的题', 'ta');
                item = { q: q, cat: 'ta 的题', by: 'ta' };
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
                qa: { q: item.q, cat: item.cat, by: item.by || null },
                favorited: false,
                note: null
            });
        }
        if (typeof playSound === 'function') playSound('message');
        if (typeof window._sendPartnerNotification === 'function') {
            window._sendPartnerNotification(name, (item.by === 'ta' ? '亲自给你出了一道题：' : '向你发起快问快答：') + item.q);
        }
    }

    // ── 卡片渲染（core.js 调用） ────────────────────────────
    function renderCardHTML(msg) {
        var qa = msg.qa || {};
        var qaId = String(msg.qaId || msg.id);
        var ts = new Date(msg.timestamp).getTime();
        if (isNaN(ts)) ts = Date.now();
        var st = stateMap[qaId];
        var byTa = !!(qa.by === 'ta');
        var head = '<div class="cx-qa-head"><span class="cx-qa-badge"><i class="fas fa-microphone"></i> 快问快答</span><span class="cx-qa-cat">' + (byTa ? '<i class="fas fa-heart" style="font-size:9px;color:#ff5b6a;"></i> ta 亲自出题 · ' : '') + esc(qa.cat || '') + '</span></div>' +
                   '<div class="cx-qa-q">' + esc(qa.q || '') + '</div>';

        var inner;
        if (!st) {
            // 待回答：有倒计时（还在时限内）就直接作答；过期但没结算过的显示"过期"提示
            var expired = (Date.now() - ts) > LIMIT_MS + 1000;
            if (expired) {
                inner = head + '<div class="cx-qa-timeout"><i class="fas fa-hourglass-end"></i> 这题没来得及回答…</div>';
            } else {
                inner = head +
                    '<div class="cx-qa-timer">限时作答 <span class="cx-qa-count" data-qa-id="' + esc(qaId) + '" data-deadline="' + (ts + LIMIT_MS) + '">15s</span>' +
                        '<div class="cx-qa-bar"><i class="cx-qa-bar-fill" data-qa-id="' + esc(qaId) + '" data-deadline="' + (ts + LIMIT_MS) + '" style="width:100%;"></i></div></div>' +
                    '<div class="cx-qa-inputrow">' +
                        '<input class="cx-qa-input" data-qa-id="' + esc(qaId) + '" placeholder="诚实作答，不许糊弄…" maxlength="120">' +
                        '<button class="cx-qa-go" data-qa-id="' + esc(qaId) + '">答</button>' +
                    '</div>';
            }
        } else if (st.state === 'answered') {
            inner = head + '<div class="cx-qa-done"><i class="fas fa-circle-check" style="color:#3ec97e;margin-top:2px;"></i><span>你的回答：<b>' + esc(st.answer) + '</b></span></div>';
        } else {
            inner = head + '<div class="cx-qa-timeout"><i class="fas fa-hourglass-end"></i> 超时未回答，被记了一笔</div>';
        }

        // 外层卡片带数据属性：全局计时器/refreshCards/提交时都靠这些属性找回题目内容
        var html = '<div class="cx-qa-card" data-qa-id="' + esc(qaId) + '" data-q="' + esc(qa.q || '') + '" data-cat="' + esc(qa.cat || '') + '" data-by="' + (byTa ? 'ta' : '') + '" data-ts="' + ts + '">' +
                       '<div class="cx-qa-body">' + inner + '</div></div>';
        // 渲染完成后绑一次输入事件（绑定有幂等保护，不会重复）
        setTimeout(function () { bindInput(document); }, 60);
        return html;
    }

    function refreshCards() {
        document.querySelectorAll('.cx-qa-card[data-qa-id]').forEach(function (card) {
            // 卡片 DOM 里带 msg 数据太重，直接用卡片上记录的 qaId 找不到 msg 对象——
            // 简化：只处理还在"待答输入"状态的卡片，状态一致就不用动
            var qaId = card.getAttribute('data-qa-id');
            var st = stateMap[qaId];
            if (!st) return;
            var body = card.querySelector('.cx-qa-body');
            if (!body) return;
            var q = card.getAttribute('data-q') || '';
            var cat = card.getAttribute('data-cat') || '';
            var by = card.getAttribute('data-by') || null;
            body.innerHTML = renderCardHTML({ qaId: qaId, qa: { q: q, cat: cat, by: by }, timestamp: card.getAttribute('data-ts') || Date.now() });
            bindInput(body);
        });
    }

    function bindInput(scope) {
        (scope || document).querySelectorAll('.cx-qa-go').forEach(function (btn) {
            if (btn.__qaBound) return;
            btn.__qaBound = true;
            btn.addEventListener('click', function () { submitFromDom(btn.getAttribute('data-qa-id')); });
        });
        (scope || document).querySelectorAll('.cx-qa-input').forEach(function (input) {
            if (input.__qaBound) return;
            input.__qaBound = true;
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitFromDom(input.getAttribute('data-qa-id')); });
        });
    }

    function submitFromDom(qaId) {
        var input = document.querySelector('.cx-qa-input[data-qa-id="' + qaId + '"]');
        if (!input) return;
        submitAnswer(qaId, input.value, input);
    }

    function submitAnswer(qaId, raw, inputEl) {
        var val = String(raw || '').trim();
        if (!val) { if (inputEl) inputEl.focus(); return; }
        stateMap[qaId] = { state: 'answered', answer: val };
        persistStates();
        stats.total = (stats.total || 0) + 1;
        persistStats();

        // 输入框锁定 + 显示回答
        var card = document.querySelector('.cx-qa-card[data-qa-id="' + qaId + '"]');
        if (card) {
            var body = card.querySelector('.cx-qa-body');
            if (body) {
                body.innerHTML = renderCardHTML({ qaId: qaId, qa: { q: card.getAttribute('data-q') || '', cat: card.getAttribute('data-cat') || '', by: card.getAttribute('data-by') || null }, timestamp: card.getAttribute('data-ts') || Date.now() });
                bindInput(body);
            }
        }

        // 回答作为用户消息进聊天（带引用指向题目卡片）
        var qText = card ? (card.getAttribute('data-q') || '') : '';
        if (typeof addMessage === 'function') {
            addMessage({
                id: Date.now() + Math.random(),
                sender: 'user',
                text: val,
                timestamp: new Date(),
                status: 'sent',
                type: 'normal',
                favorited: false,
                note: null,
                replyTo: qText ? { id: qaId, text: qText, sender: partnerName() } : null
            });
        }
        if (typeof playSound === 'function') playSound('send');
        if (typeof window._triggerDelayedReply === 'function') window._triggerDelayedReply(true);
    }

    function markTimeout(qaId) {
        if (stateMap[qaId]) return;
        stateMap[qaId] = { state: 'timeout' };
        persistStates();
        var card = document.querySelector('.cx-qa-card[data-qa-id="' + qaId + '"]');
        var qText = card ? (card.getAttribute('data-q') || '') : '';
        if (card) {
            var body = card.querySelector('.cx-qa-body');
            if (body) body.innerHTML = '<div class="cx-qa-timeout"><i class="fas fa-hourglass-end"></i> 超时未回答，被记了一笔</div>';
        }
        // 梦角嘲笑一条
        var name = partnerName();
        var tease = TIMEOUT_TEASES[Math.floor(Math.random() * TIMEOUT_TEASES.length)];
        if (typeof addMessage === 'function') {
            addMessage({
                id: Date.now() + Math.random(),
                sender: name,
                text: tease,
                timestamp: new Date(),
                status: 'received',
                type: 'normal',
                favorited: false,
                note: null
            });
        }
        if (typeof playSound === 'function') playSound('message');
        if (typeof window._sendPartnerNotification === 'function') window._sendPartnerNotification(name, tease);
    }

    // ── 全局计时器：每 300ms 扫一遍倒计时元素 ───────────────
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
                    '<div style="font-size:12px;color:var(--text-secondary);">15秒限时作答，超时会被ta嘲笑哦</div>' +
                '</div>' +
                '<div id="cx-qa-cats" style="display:flex;flex-wrap:wrap;gap:7px;justify-content:center;margin-bottom:12px;"></div>' +
                // 自定义题库区
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
                return '<div style="display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px dashed var(--border-color,rgba(128,128,128,.18));">' +
                    '<span style="font-size:10px;flex-shrink:0;padding:2px 7px;border-radius:999px;' + (c.by === 'ta' ? 'background:linear-gradient(135deg,#8f5bff,#5b8fff);color:#fff;' : 'background:rgba(255,91,106,.12);color:#ff5b6a;') + 'font-weight:700;">' + (c.by === 'ta' ? 'ta' : '我') + '</span>' +
                    '<span style="flex:1;min-width:0;font-size:12px;color:var(--text-primary);word-break:break-all;">' + esc(c.q) + '</span>' +
                    '<button class="cx-qa-del" data-i="' + i + '" style="border:none;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:12px;flex-shrink:0;padding:2px 4px;"><i class="fas fa-trash-alt"></i></button>' +
                '</div>';
            }).join('');
            bodyEl.innerHTML =
                (customList.length
                    ? '<div style="max-height:150px;overflow-y:auto;">' + rows + '</div>'
                    : '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">还没有自定义题目，在下面添加吧</div>') +
                '<div style="display:flex;gap:6px;margin-top:9px;">' +
                    '<input id="cx-qa-add-input" placeholder="写一道只有你们俩才懂的题…" maxlength="60" style="flex:1;min-width:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:8px 10px;font-size:12px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                    '<select id="cx-qa-add-cat" style="flex-shrink:0;border:1.5px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;padding:0 6px;font-size:11px;background:var(--primary-bg);color:var(--text-primary);outline:none;">' +
                        ['自定义'].concat(BANK.map(function (g) { return g.cat; })).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') +
                    '</select>' +
                    '<button id="cx-qa-add-btn" style="flex-shrink:0;border:none;border-radius:10px;padding:0 12px;background:#ff5b6a;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">添加</button>' +
                '</div>';

            bodyEl.querySelectorAll('.cx-qa-del').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    removeCustomQuestion(Number(btn.dataset.i));
                    renderCustomBody();
                });
            });
            bodyEl.querySelector('#cx-qa-add-btn').addEventListener('click', function () {
                var input = bodyEl.querySelector('#cx-qa-add-input');
                var cat = bodyEl.querySelector('#cx-qa-add-cat').value;
                var r = addCustomQuestion(input.value, cat, 'me');
                if (r === 'dup') { if (typeof showNotification === 'function') showNotification('这道题已经在题库里啦', 'info'); return; }
                if (r === 'full') { if (typeof showNotification === 'function') showNotification('题库已满（100 道），先删一点吧', 'error'); return; }
                if (typeof showNotification === 'function') showNotification('✦ 已加入题库，开始挑战就有机会抽到', 'info', 2000);
                renderCustomBody();
            });
            bodyEl.querySelector('#cx-qa-add-input').addEventListener('keydown', function (e) {
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
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay); });
    }

    // ── 初始化：恢复历史卡片状态 + 绑定输入 ─────────────────
    document.addEventListener('DOMContentLoaded', function () {
        injectStyles();
        hydrate();
        setTimeout(function () { bindInput(document); }, 800);
        if (window.MoreMenu && typeof window.MoreMenu.registerItem === 'function') {
            window.MoreMenu.registerItem('qa', { ready: true, action: openQAModal });
        }
    });

    window.QuickQA = {
        renderCardHTML: renderCardHTML,
        openModal: openQAModal,
        refreshCards: refreshCards,
        _bindInput: bindInput
    };
})();
