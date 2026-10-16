/**
 * food.js — 食光记
 *
 * 「今天吃什么」的仪式感小本本：
 *   1. 互相推荐：把想吃的推荐给TA（TA会回一句反应），
 *      也可以让TA推荐一个（TA从内置美食池里随机馋一个）；
 *   2. 记一笔吃了什么：我吃的/TA吃的都能记，带餐段（早/午/晚/夜宵/加餐）；
 *   3. 推荐和记录全部以聊天消息的形式出现在聊天流里，
 *      翻聊天记录就像翻一起吃过的日子。
 *
 * 入口：输入区「+」更多菜单 → 食光记
 * 存储：localStorage 'foodDiaryData' { entries:[{id,ts,kind,author,what,meal}] }
 */
(function () {
    'use strict';

    var KEY = 'foodDiaryData';
    var MAX_ENTRIES = 500;

    // TA 推荐时的美食池：按餐段分组（他自己吃饭时按当前餐段抽，不会早餐吃炸鸡）；
    // 推荐给你时用全部并集，什么都能馋
    var FOOD_POOL = {
        '早餐': [
            ['豆浆油条', '🥖'], ['包子', '🥟'], ['小笼包', '🥟'], ['生煎包', '🍳'],
            ['烧麦', '🍘'], ['皮蛋瘦肉粥', '🥣'], ['小米粥', '🥣'], ['豆腐脑', '🥣'],
            ['煎饼果子', '🫓'], ['鸡蛋灌饼', '🫓'], ['鸡蛋饼', '🍳'], ['肠粉', '🍥'],
            ['小馄饨', '🍜'], ['胡辣汤', '🥣'], ['三明治', '🥪'], ['吐司', '🍞'],
            ['饭团', '🍙'], ['粢饭团', '🍙'], ['牛奶麦片', '🥛'], ['玉米鸡蛋', '🌽'],
            ['牛肉面', '🍜'], ['肉夹馍', '🥙'], ['锅贴', '🥟'], ['蒸饺', '🥟'],
            ['手抓饼', '🫓'], ['酸奶水果碗', '🥣']
        ],
        '午餐': [
            ['黄焖鸡米饭', '🍗'], ['麻辣烫', '🍜'], ['螺蛳粉', '🍜'], ['牛肉面', '🍜'],
            ['韩式拌饭', '🍚'], ['盖浇饭', '🍱'], ['兰州拉面', '🍜'], ['沙县小吃', '🥟'],
            ['轻食沙拉', '🥗'], ['日式定食', '🍱'], ['猪脚饭', '🍲'], ['烧腊饭', '🍱'],
            ['酸菜鱼', '🐟'], ['水煮肉片', '🌶️'], ['宫保鸡丁盖饭', '🥜'], ['咖喱饭', '🍛'],
            ['意大利面', '🍝'], ['卤肉饭', '🍚'], ['麻辣香锅', '🥘'], ['冒菜', '🍲'],
            ['鸡公煲', '🍲'], ['牛肉粉', '🍜'], ['酸辣粉', '🍜'], ['寿司便当', '🍱'],
            ['米线', '🍜'], ['汉堡套餐', '🍔'], ['炒饭', '🍳'], ['炒面', '🍜'],
            ['饺子', '🥟'], ['馄饨', '🥟'], ['家常菜', '🥘'], ['食堂套餐', '🍱']
        ],
        '晚餐': [
            ['火锅', '🍲'], ['烤肉', '🥩'], ['烤鱼', '🐟'], ['小龙虾', '🦞'],
            ['牛排', '🥩'], ['日料', '🍣'], ['寿司', '🍣'], ['泰式咖喱', '🍛'],
            ['川菜', '🌶️'], ['粤式茶点', '🫖'], ['北京烤鸭', '🦆'], ['羊肉汤', '🍲'],
            ['牛杂煲', '🍲'], ['猪肚鸡', '🍲'], ['椰子鸡', '🥥'], ['韩式烤肉', '🥩'],
            ['部队锅', '🍲'], ['寿喜烧', '🍲'], ['披萨', '🍕'], ['意面', '🍝'],
            ['酸菜鱼', '🐟'], ['水煮鱼', '🐟'], ['干锅', '🌶️'], ['烧烤大餐', '🍢'],
            ['家常四菜一汤', '🥘'], ['砂锅粥配小菜', '🥣'], ['焖锅', '🍲'], ['海鲜大餐', '🦐']
        ],
        '夜宵': [
            ['烧烤', '🍢'], ['炸鸡', '🍗'], ['泡面', '🍜'], ['小龙虾', '🦞'],
            ['关东煮', '🍢'], ['烤冷面', '🍳'], ['炒粉', '🍜'], ['炒面', '🍜'],
            ['螺蛳粉', '🍜'], ['花甲粉', '🍜'], ['炸串', '🍢'], ['卤味', '🍗'],
            ['烤红薯', '🍠'], ['鸭脖', '🦆'], ['串串香', '🍢'], ['手抓饼加肠', '🫓'],
            ['生煎', '🍳'], ['锅贴', '🥟'], ['臭豆腐', '🧆'], ['烤生蚝', '🦪'],
            ['烤鱿鱼', '🦑'], ['麻辣烫', '🍜'], ['便利店饭团', '🍙'], ['薯片可乐', '🥤']
        ],
        '加餐': [
            ['奶茶', '🧋'], ['咖啡', '☕'], ['果茶', '🧃'], ['蛋糕', '🍰'],
            ['水果', '🍎'], ['冰淇淋', '🍦'], ['酸奶', '🥛'], ['饼干', '🍪'],
            ['华夫饼', '🧇'], ['双皮奶', '🍮'], ['提拉米苏', '🍰'], ['麻薯', '🍡'],
            ['布丁', '🍮'], ['巧克力', '🍫'], ['蛋挞', '🥧'], ['甜甜圈', '🍩'],
            ['马卡龙', '🧁'], ['草莓大福', '🍓'], ['芒果班戟', '🥭'], ['芋圆烧仙草', '🍧']
        ]
    };

    // 推荐池 = 所有餐段并集（去重，保留第一个 emoji）
    var RECOMMEND_POOL = (function () {
        var seen = {}, all = [];
        Object.keys(FOOD_POOL).forEach(function (m) {
            FOOD_POOL[m].forEach(function (f) {
                if (!seen[f[0]]) { seen[f[0]] = 1; all.push(f); }
            });
        });
        return all;
    })();

    // 他一天的吃饭时间窗：每段在窗口内随机一个点吃；加餐/夜宵是可选餐（对半决定今天吃不吃）
    var MEAL_WINDOWS = [
        { meal: '早餐', startH: 6,  startM: 30, endH: 9,  endM: 30, optional: false },
        { meal: '午餐', startH: 11, startM: 0,  endH: 13, endM: 30, optional: false },
        { meal: '加餐', startH: 14, startM: 30, endH: 16, endM: 30, optional: true },
        { meal: '晚餐', startH: 17, startM: 30, endH: 20, endM: 30, optional: false },
        { meal: '夜宵', startH: 21, startM: 30, endH: 23, endM: 40, optional: true }
    ];

    var MEALS = ['早餐', '午餐', '晚餐', '夜宵', '加餐'];

    // ── 台词池（不预设身份，口吻跟其他模块保持一致） ──────────────────────
    var ME_RECO = [
        '给你推荐：{f}，下次一起？',
        '突然很想吃{f}，安排一个？',
        '我发现{f}好像很不错，记下来一起去'
    ];
    var HE_RECO = [
        '要不试试{f}？突然馋了',
        '我最近想吃{f}，一起？',
        '今晚{f}怎么样？我来挑地方',
        '馋{f}了，你陪我吃就更好了'
    ];
    var ME_EATEN = [
        '{m}吃了{f}，记下啦',
        '{m}解决：{f}，还不错',
        '{m}的{f}，有点好吃',
        '今天{m}是{f}，汇报完毕'
    ];
    var HIM_EATEN = [
        '我{m}吃了{f}，满足',
        '{m}解决了{f}，和你汇报一下',
        '今天{m}吃的{f}，下次带你来'
    ];

    // 我推荐给他时他的反应兜底池：实际优先用字卡库的「食光反应」字卡组，
    // 开心/嘴硬全混在一起，抽到哪句算哪句——不做任何概率配比
    var DEFAULT_REACTS = [
        '好呀，记下了，下次一起去',
        '这个可以有，已经被我馋到了',
        '听你的，你推荐的都好吃',
        '行，就它了，你真会挑',
        '嗯嗯，我已经在想加什么菜了',
        '你怎么知道我刚好想吃这个',
        '哼，这时候馋我？记下了，你请',
        '看起来不错……要是你做的就更好了',
        '批准了，不过要陪我一起吃才算数',
        '大半夜看这个，你得负责'
    ];

    function getReactPool() {
        try {
            if (typeof window._getFoodReactPool === 'function') {
                var pool = window._getFoodReactPool();
                if (Array.isArray(pool) && pool.length) return pool;
            }
        } catch (e) {}
        return DEFAULT_REACTS.slice();
    }

    // ── 工具 ──────────────────────
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function _partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }
    function _nowMeal() {
        var h = new Date().getHours();
        if (h >= 5 && h < 10) return '早餐';
        if (h >= 10 && h < 14) return '午餐';
        if (h >= 14 && h < 18) return '加餐';
        if (h >= 18 && h < 23) return '晚餐';
        return '夜宵';
    }
    function _gain(n) {
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gain === 'function') {
                window.PartnerProficiency.gain(n);
            }
        } catch (e) {}
    }

    // ── 存取 ──────────────────────
    function load() {
        try {
            var d = JSON.parse(localStorage.getItem(KEY));
            if (!d || typeof d !== 'object') d = {};
            if (!Array.isArray(d.entries)) d.entries = [];
            return d;
        } catch (e) {
            return { entries: [] };
        }
    }
    function save(d) {
        try {
            if (d.entries.length > MAX_ENTRIES) d.entries.length = MAX_ENTRIES;
            localStorage.setItem(KEY, JSON.stringify(d));
        } catch (e) {}
    }
    function _newId() { return 'f_' + Date.now() + '_' + Math.floor(Math.random() * 100000); }

    // ── 他自己的吃饭调度：按"真实餐段"来 ──────────────────────
    // 每天凌晨后第一次检查时排好当天的吃饭计划：早/午/晚必有，加餐/夜宵对半随机，
    // 每顿在对应时间窗内随机一个点；到点且在窗口内才播报，错过的窗口静默跳过不补发，
    // 同一餐今天已经记过（无论自动还是手动）就不再记——从根上杜绝"三顿晚餐/早餐炸鸡"。
    var _foodTimer = null;
    var _foodChatReady = false;
    var _foodPending = 0;

    function _todayStr(ts) {
        var d = new Date(ts || Date.now());
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    function _winStart(w, day) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.startH, w.startM, 0, 0).getTime(); }
    function _winEnd(w, day) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.endH, w.endM, 0, 0).getTime(); }

    // 生成（或沿用）今天的计划：[{meal, at, on}]
    function _ensurePlan(d) {
        var today = _todayStr();
        if (d.mealPlan && d.mealPlan.date === today && Array.isArray(d.mealPlan.items)) return d.mealPlan;
        var now = new Date();
        var items = MEAL_WINDOWS.map(function (w) {
            var s = _winStart(w, now), e = _winEnd(w, now);
            return {
                meal: w.meal,
                on: w.optional ? Math.random() < 0.5 : true,
                at: s + Math.floor(Math.random() * Math.max(1, e - s))
            };
        });
        d.mealPlan = { date: today, items: items };
        return d.mealPlan;
    }

    // 今天他是否已有某餐的记录（自动+手动都算，避免重复）
    function _partnerAteMealToday(d, meal) {
        var today = _todayStr();
        return d.entries.some(function (en) {
            return en.author === 'partner' && en.kind === 'eaten' && en.meal === meal && _todayStr(en.ts) === today;
        });
    }

    function _scheduleFood() {
        clearTimeout(_foodTimer);
        var d = load();
        var plan = _ensurePlan(d);
        save(d);
        var now = Date.now();

        // 找下一顿该吃的饭
        for (var i = 0; i < plan.items.length; i++) {
            var it = plan.items[i];
            if (!it.on || it.done || _partnerAteMealToday(d, it.meal)) { it.done = true; continue; }
            var w = MEAL_WINDOWS.filter(function (x) { return x.meal === it.meal; })[0];
            var e = _winEnd(w, new Date());
            if (now > e) { it.done = true; continue; }      // 窗口已过，静默跳过，不补发
            var delay = Math.max(3000, it.at - now);        // 还没到点就等；在窗口内则至少 3 秒后吃
            _foodTimer = setTimeout(_runFoodCheck, delay);
            save(d);
            return;
        }
        // 今天饭全吃完了：排到明天 0:05 再重建计划
        save(d);
        var tomorrow = new Date();
        tomorrow.setHours(24, 5, 0, 0);
        _foodTimer = setTimeout(_scheduleFood, Math.max(5000, tomorrow.getTime() - now));
    }

    function _runFoodCheck() {
        var d = load();
        var plan = _ensurePlan(d);
        var now = new Date();
        var fired = false;
        for (var i = 0; i < plan.items.length; i++) {
            var it = plan.items[i];
            if (!it.on || it.done || _partnerAteMealToday(d, it.meal)) { it.done = true; continue; }
            var w = MEAL_WINDOWS.filter(function (x) { return x.meal === it.meal; })[0];
            if (now.getTime() > _winEnd(w, now)) { it.done = true; continue; }
            // 到点了：从"当前餐段池"里抽吃的，抽一个他今天还没吃过的（小池子兜底不纠结）
            var meal = it.meal;
            var pool = (FOOD_POOL[meal] || RECOMMEND_POOL).slice();
            var eatenToday = {};
            d.entries.forEach(function (en) {
                if (en.author === 'partner' && en.kind === 'eaten' && _todayStr(en.ts) === _todayStr()) eatenToday[en.what] = 1;
            });
            var fresh = pool.filter(function (f) { return !eatenToday[f[0]]; });
            var f = _pick(fresh.length ? fresh : pool);
            it.done = true;
            fired = true;
            save(d);
            _spawnPartnerEaten(meal, f[0]);
            break;
        }
        if (!fired) save(d);
        _scheduleFood();
    }

    function _spawnPartnerEaten(meal, what) {
        // 开机竞态：food.js 可能比聊天模块先就绪，先攒着，renderMessages 首调后再补发
        if (window._appDataLoaded || _foodChatReady) {
            _doPartnerEaten(meal, what);
        } else {
            _foodPending++;
            _foodPendingMeal = meal;
            _foodPendingWhat = what;
        }
    }
    var _foodPendingMeal = null, _foodPendingWhat = null;

    function _doPartnerEaten(meal, what) {
        // 直接记已经算好的餐段和食物（不能再用 _nowMeal，否则错过窗口补发时餐段会错）
        recordEaten(what, meal || _nowMeal(), 'partner');
        // 食光记弹窗开着就当场刷新
        var modal = document.getElementById('food-modal');
        if (modal && modal.style.display === 'flex') renderList();
    }

    (function _hookRenderForFood() {
        var origFn = window.renderMessages;
        if (typeof origFn !== 'function') return;
        window.renderMessages = function () {
            if (!_foodChatReady) {
                _foodChatReady = true;
                if (_foodPending > 0) {
                    _foodPending = 0;
                    // 攒下的只补一笔（带原定餐段和食物），避免开机刷一串
                    setTimeout(function () { _doPartnerEaten(_foodPendingMeal, _foodPendingWhat); }, 600);
                }
            }
            return origFn.apply(this, arguments);
        };
    })();

    // ── 往聊天流里说话（我 / TA 两种身份，和 quickqa 同一套） ──────────────────────
    // foodOwn=true 标记"食光记自己产生的消息"，聊天自动记账钩子靠它防重复
    function _say(text, who, foodOwn) {
        try {
            if (typeof addMessage !== 'function') return;
            addMessage({
                id: Date.now() + Math.floor(Math.random() * 1000),
                sender: who === 'me' ? 'user' : _partnerName(),
                text: text,
                timestamp: new Date(),
                status: who === 'me' ? 'sent' : 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal',
                foodOwn: !!foodOwn
            });
            if (typeof playSound === 'function') playSound(who === 'me' ? 'send' : 'message');
        } catch (e) {}
    }

    // ── 动作 ──────────────────────
    function recommendMine(what) {
        what = String(what || '').trim().slice(0, 20);
        if (!what) return false;
        var d = load();
        d.entries.unshift({ id: _newId(), ts: Date.now(), kind: 'recommend', author: 'me', what: what, meal: '' });
        save(d);
        _say(_pick(ME_RECO).replace(/\{f\}/g, what), 'me', true);
        // TA 隔一会儿回一句反应：反应池整池均匀随机，不区分接受/嘴硬，不做概率配比
        var react = _pick(getReactPool());
        setTimeout(function () { _say(react, 'him'); }, 1000 + Math.random() * 1800);
        _gain(2);
        renderList();
        return true;
    }

    function recommendHis() {
        var f = _pick(RECOMMEND_POOL);
        var d = load();
        d.entries.unshift({ id: _newId(), ts: Date.now(), kind: 'recommend', author: 'partner', what: f[0], meal: '' });
        save(d);
        _say(_pick(HE_RECO).replace(/\{f\}/g, f[0] + ' ' + f[1]), 'him');
        _gain(2);
        renderList();
        if (typeof showNotification === 'function') {
            showNotification(_partnerName() + '推荐了：' + f[0] + ' ' + f[1], 'info', 2200);
        }
    }

    function recordEaten(what, meal, author) {
        what = String(what || '').trim().slice(0, 20);
        if (!what) return false;
        meal = MEALS.indexOf(meal) > -1 ? meal : _nowMeal();
        author = author === 'partner' ? 'partner' : 'me';
        var d = load();
        d.entries.unshift({ id: _newId(), ts: Date.now(), kind: 'eaten', author: author, what: what, meal: meal });
        save(d);
        var tpl = author === 'me' ? _pick(ME_EATEN) : _pick(HIM_EATEN);
        _say(tpl.replace(/\{m\}/g, meal).replace(/\{f\}/g, what), author, true);
        _gain(1);
        renderList();
        return true;
    }

    // ── 聊天自动记录：「今天晚上吃了炸鸡」「中午吃的螺蛳粉」→ 自动入食光 ──────────────────────
    var _seenChat = {};

    var MEAL_RULES = [
        ['夜宵', /夜宵|宵夜/],
        ['早餐', /早餐|早饭|早点|今早|早上\s*吃/],
        ['午餐', /午餐|午饭|中饭|中午\s*吃/],
        ['晚餐', /晚餐|晚饭|今晚|晚上\s*吃|夜里\s*吃|半夜\s*吃/],
        ['加餐', /下午茶|加餐|下午\s*吃/]
    ];

    // 问句/计划/否定 → 不是在汇报"吃了"，不记
    var SKIP_RE = /[?？]$|吃(?:什么|啥|点啥|啥好)|吃(?:了)?(?:没|吗|么|过没)|想\s*吃|没吃|不吃|还没|要不要|去吃|待会|待会儿|等会|明天|下次|约|陪(?:我|你)|带(?:我|你)|谁请|好吃|难吃|吃腻|吃过了[?？]?\s*$/;

    function detectMeal(text) {
        for (var i = 0; i < MEAL_RULES.length; i++) {
            if (MEAL_RULES[i][1].test(text)) return MEAL_RULES[i][0];
        }
        return _nowMeal();
    }

    // 从句中抠出食物名；返回 {what, meal} 或 null
    function detectEaten(text) {
        if (!text) return null;
        text = String(text).trim();
        if (!text || text.length > 60) return null;
        if (SKIP_RE.test(text)) return null;

        var what = null;
        var m;
        // 1) 吃了X / 吃的X / 吃的是X
        m = text.match(/吃(?:了|的是|的)?(.+?)\s*[。.!！~～…]*$/);
        if (m) what = m[1];
        // 2) 「晚饭是火锅」「晚餐解决了黄焖鸡」「夜宵：烧烤」
        if (!what) {
            m = text.match(/(?:早餐|早饭|午餐|午饭|中饭|晚餐|晚饭|夜宵|宵夜|下午茶)\s*(?:是|为|有|解决了?|搞定了?|安排了?|吃的是|吃了)?\s*[:：]?\s*(.+?)\s*[。.!！~～…]*$/);
            if (m) what = m[1];
        }
        if (!what) return null;

        what = what
            // 开头的量词/虚词（"个汉堡""一碗面"）；注意"包"不能放进来——包子会被误杀
            .replace(/^[了的是为有个些点份碗顿盘杯串袋盒]+/, '')
            .replace(/[呢啊呀哦啦嘛呐的了吧呗~～\s。，,.!！?？…]+$/g, '')
            .replace(/^(?:一点|一些|好多|好多好多)/, '')
            .trim();
        // 抠完还是虚词/含疑问指代，就不记
        if (!what || what.length > 12) return null;
        if (/[你我他她它们谁什哪几多吗呢嘛么吧]|这个|那个|东西|外卖到|饭没|饭了吗/.test(what)) {
            // "饭"本身是合法的（吃了饭），但"东西"不是
            if (what !== '饭') return null;
        }
        return { what: what, meal: detectMeal(text) };
    }

    // ── 聊天流里插入食光确认卡片（system 消息，居中灰条，照 ledger 的样式） ──────────────────────
    function insertFoodCard(hit) {
        try {
            if (typeof addMessage !== 'function') return;
            addMessage({
                id: Date.now() + Math.random(),
                sender: null,
                type: 'system',
                text: '<i class="fas fa-utensils" style="margin-right:4px;"></i>已记食光 · ' + _esc(hit.meal) + ' · ' + _esc(hit.what),
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null
            });
        } catch (e) {}
    }

    function handleUserMessage(msg) {
        if (!msg || msg.sender !== 'user' || msg.type !== 'normal') return;
        if (msg.foodOwn || msg.image) return;
        var text = msg.text;
        if (!text) return;
        var key = String(msg.id || '');
        if (key) {
            if (_seenChat[key]) return;
            _seenChat[key] = 1;
            if (Object.keys(_seenChat).length > 5000) _seenChat = {};
        }
        // 只说「食光记/吃什么」之类的打开指令 → 直接打开弹窗
        if (/^\s*(?:食光记|食光)\s*$/.test(text)) { setTimeout(open, 100); return; }

        var hit = detectEaten(text);
        if (!hit) return;
        var d = load();
        d.entries.unshift({ id: _newId(), ts: Date.now(), kind: 'eaten', author: 'me', what: hit.what, meal: hit.meal, source: 'chat' });
        save(d);
        setTimeout(function () {
            insertFoodCard(hit);
            var modal = document.getElementById('food-modal');
            if (modal && modal.style.display === 'flex') renderList();
        }, 350);
    }

    // ── 弹窗 UI ──────────────────────
    var _mealSel = '午餐';
    var _authorSel = 'me';

    function buildModal() {
        if (document.getElementById('food-modal')) return;

        var st = document.createElement('style');
        st.textContent =
            '#food-modal .modal-content{max-width:420px;width:90vw;max-height:86vh;overflow-y:auto;}' +
            '.food-sec-title{font-size:12px;font-weight:700;color:var(--text-secondary,#999);margin:14px 0 6px;}' +
            '.food-sec-title:first-of-type{margin-top:6px;}' +
            '.food-input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;border:1.5px solid var(--border-color,#ddd);background:var(--primary-bg,transparent);color:var(--text-primary,#333);font-size:13px;outline:none;font-family:var(--font-family);}' +
            '.food-input:focus{border-color:var(--accent-color,#c5a47e);}' +
            '.food-btn-row{display:flex;gap:8px;margin-top:8px;}' +
            '.food-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}' +
            '.food-chip{padding:6px 12px;border-radius:999px;border:1px solid var(--border-color,#ddd);background:var(--secondary-bg,transparent);font-size:12px;color:var(--text-primary,#333);cursor:pointer;font-family:var(--font-family);}' +
            '.food-chip.active{border-color:var(--accent-color,#c5a47e);background:rgba(var(--accent-color-rgb,197,164,126),.16);color:var(--accent-color,#c5a47e);font-weight:700;}' +
            '.food-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:11px;}' +
            '.food-row:hover{background:var(--secondary-bg,rgba(0,0,0,.03));}' +
            '.food-row-icon{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;flex-shrink:0;}' +
            '.food-row-main{flex:1;min-width:0;}' +
            '.food-row-desc{font-size:13px;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.food-row-sub{font-size:10px;color:var(--text-secondary,#aaa);margin-top:1px;}' +
            '.food-row-btn{flex-shrink:0;width:26px;height:26px;border:none;border-radius:50%;background:transparent;color:var(--text-secondary,#aaa);font-size:11px;cursor:pointer;}' +
            '.food-date-head{font-size:11px;color:var(--text-secondary,#999);margin:8px 2px 2px;}' +
            '.food-author-tag{display:inline-block;padding:0 6px;border-radius:8px;font-size:10px;line-height:16px;background:rgba(197,164,126,.16);color:var(--accent-color,#c5a47e);margin-right:4px;vertical-align:middle;}' +
            '.food-author-partner{background:rgba(138,123,216,.16);color:#8a7bd8;}';
        document.head.appendChild(st);

        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'food-modal';
        m.style.zIndex = '3200';
        m.innerHTML =
            '<div class="modal-content">'
            +   '<div class="modal-title"><i class="fas fa-utensils"></i><span>食光记</span></div>'

            +   '<div class="food-sec-title"><i class="fas fa-star"></i> 互相推荐</div>'
            +   '<input type="text" class="food-input" id="food-rec-input" placeholder="想推荐TA吃什么？如：火锅" maxlength="20">'
            +   '<div class="food-btn-row">'
            +     '<button type="button" id="food-rec-mine" class="modal-btn modal-btn-primary" style="flex:1;padding:9px;font-size:12px;">推荐给TA</button>'
            +     '<button type="button" id="food-rec-his" class="modal-btn modal-btn-secondary" style="flex:1;padding:9px;font-size:12px;">让TA推荐一个</button>'
            +   '</div>'

            +   '<div class="food-sec-title"><i class="fas fa-pen-to-square"></i> 记一笔吃的</div>'
            +   '<div class="food-chips" id="food-meal-chips"></div>'
            +   '<div class="food-chips" id="food-author-chips"></div>'
            +   '<input type="text" class="food-input" id="food-eat-input" placeholder="吃了什么？如：螺蛳粉" maxlength="20">'
            +   '<div class="food-btn-row">'
            +     '<button type="button" id="food-eat-save" class="modal-btn modal-btn-primary" style="flex:1;padding:9px;font-size:12px;">记下来</button>'
            +   '</div>'

            +   '<div class="food-sec-title"><i class="fas fa-clock-rotate-left"></i> 最近食光</div>'
            +   '<div id="food-list" style="max-height:26vh;overflow-y:auto;"></div>'

            +   '<div class="food-btn-row" style="margin-top:12px;">'
            +     '<button type="button" id="food-manage-react" style="flex:1;padding:9px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-comment-dots"></i> 管理反应字卡</button>'
            +     '<button type="button" id="food-close" class="modal-btn modal-btn-secondary" style="flex:1;">关闭</button>'
            +   '</div>'
            +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:8px;line-height:1.7;">推荐和记录都会出现在聊天里，翻记录就像翻一起吃过的日子</div>'
            + '</div>';
        document.body.appendChild(m);

        m.querySelector('#food-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.querySelector('#food-manage-react').addEventListener('click', function () {
            try {
                if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
                if (typeof currentMajorTab !== 'undefined') { currentMajorTab = 'atmosphere'; currentSubTab = 'foodReact'; }
                if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
                var libModal = document.getElementById('custom-replies-modal');
                if (libModal && typeof showModal === 'function') showModal(libModal);
            } catch (e) {}
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });

        // 推荐给TA / 让TA推荐
        function doRecMine() {
            var input = m.querySelector('#food-rec-input');
            if (!input) return;
            if (!recommendMine(input.value)) {
                if (typeof showNotification === 'function') showNotification('先写个想吃的吧～', 'info', 1800);
                return;
            }
            input.value = '';
        }
        m.querySelector('#food-rec-mine').addEventListener('click', doRecMine);
        m.querySelector('#food-rec-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doRecMine(); } });
        m.querySelector('#food-rec-his').addEventListener('click', function () { recommendHis(); });

        // 记一笔
        function doEatSave() {
            var input = m.querySelector('#food-eat-input');
            if (!input) return;
            if (!recordEaten(input.value, _mealSel, _authorSel)) {
                if (typeof showNotification === 'function') showNotification('先写吃了什么吧～', 'info', 1800);
                return;
            }
            input.value = '';
        }
        m.querySelector('#food-eat-save').addEventListener('click', doEatSave);
        m.querySelector('#food-eat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doEatSave(); } });

        // 列表删除（事件委托）
        m.querySelector('#food-list').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-food-del]');
            if (!btn) return;
            var id = btn.getAttribute('data-food-del');
            var d = load();
            d.entries = d.entries.filter(function (x) { return String(x.id) !== String(id); });
            save(d);
            renderList();
        });
    }

    function renderChips() {
        var mealBox = document.getElementById('food-meal-chips');
        var authorBox = document.getElementById('food-author-chips');
        if (mealBox) {
            mealBox.innerHTML = '';
            MEALS.forEach(function (mm) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'food-chip' + (mm === _mealSel ? ' active' : '');
                b.textContent = mm;
                b.addEventListener('click', function () { _mealSel = mm; renderChips(); });
                mealBox.appendChild(b);
            });
        }
        if (authorBox) {
            authorBox.innerHTML = '';
            [['me', '我吃的'], ['partner', 'TA吃的']].forEach(function (pair) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'food-chip' + (_authorSel === pair[0] ? ' active' : '');
                b.textContent = pair[1];
                b.addEventListener('click', function () { _authorSel = pair[0]; renderChips(); });
                authorBox.appendChild(b);
            });
        }
    }

    function renderList() {
        var el = document.getElementById('food-list');
        if (!el) return;
        var d = load();
        if (!d.entries.length) {
            el.innerHTML = '<div class="stats-empty-state" style="padding:16px 10px;"><div style="font-size:24px;opacity:.5;"><i class="fas fa-utensils"></i></div><p style="font-size:12px;margin-top:6px;">还没有食光记录<br>推荐一顿或记一笔试试吧</p></div>';
            return;
        }

        var html = '';
        var lastDate = null;
        var now = new Date();
        var todayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
        var shown = d.entries.slice(0, 100);

        shown.forEach(function (x) {
            var dt = new Date(x.ts);
            var dk = dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate();
            if (dk !== lastDate) {
                lastDate = dk;
                var label = dk === todayKey ? '今天' : (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
                html += '<div class="food-date-head">' + label + '</div>';
            }
            var isRec = x.kind === 'recommend';
            var icon = isRec ? 'fa-star' : 'fa-utensils';
            var rgb = isRec ? '250,204,21' : '249,115,22';
            var authorName = x.author === 'partner' ? _partnerName() : '我';
            var desc = isRec ? x.what : (x.meal ? x.meal + ' · ' : '') + x.what;
            var time = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
            html += '<div class="food-row">'
                + '<span class="food-row-icon" style="background:linear-gradient(135deg,rgba(' + rgb + ',.9),rgba(' + rgb + ',.65));"><i class="fas ' + icon + '"></i></span>'
                + '<div class="food-row-main">'
                +   '<div class="food-row-desc">' + (isRec ? '推荐' : '吃了') + '：' + _esc(x.what) + '</div>'
                +   '<div class="food-row-sub"><span class="food-author-tag' + (x.author === 'partner' ? ' food-author-partner' : '') + '">' + _esc(authorName) + '</span>'
                +     (isRec ? '推荐' : _esc(x.meal || '')) + ' · ' + time + '</div>'
                + '</div>'
                + '<button type="button" class="food-row-btn" data-food-del="' + _esc(x.id) + '" title="删除"><i class="fas fa-times"></i></button>'
                + '</div>';
        });
        el.innerHTML = html;
    }

    function open() {
        buildModal();
        var m = document.getElementById('food-modal');
        if (!m) return;
        _mealSel = _nowMeal();      // 默认餐段跟着现在的时间走
        _authorSel = 'me';
        renderChips();
        renderList();
        // 用食光记 → 梦角 App 熟练度 +1（每日上限 3 次）
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'food', 3);
            }
        } catch (e) {}
        if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
    }

    // 链式包裹 window._onUserMessage（和 ledger.js 同款叠加，不能覆盖别的模块）
    function wrapUserHook() {
        var prev = window._onUserMessage;
        window._onUserMessage = function (m) {
            try { handleUserMessage(m); } catch (e) { console.warn('[food]', e); }
            if (typeof prev === 'function') { try { prev(m); } catch (e2) { console.warn('[food:prev]', e2); } }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(wrapUserHook, 0);
            _scheduleFood();   // 他的吃饭调度随模块启动
        });
    } else {
        setTimeout(function () { wrapUserHook(); _scheduleFood(); }, 60);
    }

    window.Food = { open: open, detect: detectEaten };
})();
