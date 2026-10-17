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
        ],
        '早午饭': [
            ['班尼迪克蛋', '🍳'], ['松饼', '🥞'], ['可颂配拿铁', '☕'], ['英式早午餐', '🍳'],
            ['滑蛋虾仁饭', '🍚'], ['菠萝油配奶茶', '🧋'], ['猪扒包', '🥪'], ['厚切吐司', '🍞'],
            ['贝果三明治', '🥯'], ['牛油果吐司', '🥑'], ['舒芙蕾', '🥞'], ['早茶点心', '🫖'],
            ['麦片碗', '🥣'], ['鸡蛋仔', '🧇']
        ],
        '工作餐': [
            ['公司盒饭', '🍱'], ['食堂打饭', '🍱'], ['外卖便当', '🥡'], ['便利店饭团', '🍙'],
            ['加班外卖', '🥡'], ['盖浇饭外卖', '🍱'], ['轻食代餐', '🥗'], ['三明治简餐', '🥪'],
            ['员工餐', '🍲'], ['楼下快餐', '🍛'], ['猪脚饭外卖', '🍲'], ['黄焖鸡外卖', '🍗'],
            ['麻辣烫外卖', '🍜'], ['麻辣香锅外卖', '🥘'], ['米线外卖', '🍜'], ['汉堡快餐', '🍔'],
            ['三明治咖啡', '☕'], ['关东煮简餐', '🍢']
        ]
    };

    // 预设推荐池（名字并集，去重）——实际使用时会叠加自定义、剔除被删预设
    var PRESET_ALL = (function () {
        var seen = {}, all = [];
        Object.keys(FOOD_POOL).forEach(function (m) {
            FOOD_POOL[m].forEach(function (f) {
                if (!seen[f[0]]) { seen[f[0]] = 1; all.push(f); }
            });
        });
        return all;
    })();

    // ── 自定义食物 / 删除预设 ──────────────────────
    // 数据存在 foodDiaryData 里：
    //   d.custFoods  = { '早餐': ['胡辣汤', ...], ... }  用户自己加的"他吃什么"
    //   d.hiddenFoods= ['炸鸡', ...]                    被删掉的预设名（全局生效，可恢复）
    var DEFAULT_EMOJI = '🍽️';

    function _ensureFoodCfg(d) {
        if (!d.custFoods || typeof d.custFoods !== 'object') d.custFoods = {};
        if (!Array.isArray(d.hiddenFoods)) d.hiddenFoods = [];
        return d;
    }
    function _hiddenSet(d) {
        var s = {};
        (d.hiddenFoods || []).forEach(function (n) { s[n] = 1; });
        return s;
    }
    // 某餐段实际生效的池子（预设去删 + 自定义）
    function poolFor(meal) {
        var d = _ensureFoodCfg(load());
        var hidden = _hiddenSet(d);
        var out = [];
        (FOOD_POOL[meal] || []).forEach(function (f) {
            if (!hidden[f[0]]) out.push(f);
        });
        ((d.custFoods && d.custFoods[meal]) || []).forEach(function (name) {
            if (name && !hidden[name]) out.push([name, DEFAULT_EMOJI]);
        });
        return out;
    }
    // 全部食物（推荐用）
    function recommendPool() {
        var d = _ensureFoodCfg(load());
        var hidden = _hiddenSet(d);
        var seen = {}, all = [];
        PRESET_ALL.forEach(function (f) { if (!hidden[f[0]] && !seen[f[0]]) { seen[f[0]] = 1; all.push(f); } });
        Object.keys(d.custFoods || {}).forEach(function (m) {
            (d.custFoods[m] || []).forEach(function (name) {
                if (name && !hidden[name] && !seen[name]) { seen[name] = 1; all.push([name, DEFAULT_EMOJI]); }
            });
        });
        return all;
    }
    // 这个名字是不是预设（用于 UI 显示"预设"标记）
    function isPresetFood(name) {
        return PRESET_ALL.some(function (f) { return f[0] === name; });
    }
    function addCustomFood(meal, name) {
        name = String(name || '').trim().slice(0, 12);
        if (!name) return 0;
        var d = _ensureFoodCfg(load());
        if (!d.custFoods[meal]) d.custFoods[meal] = [];
        var n = 0;
        name.split(/[，,、\/\n]+/).forEach(function (part) {
            part = part.trim();
            if (!part) return;
            var exists = poolFor(meal).some(function (f) { return f[0] === part; });
            if (!exists) { d.custFoods[meal].push(part); n++; }
        });
        // 如果之前删过这个名字的预设，现在用户手动加了，就解除隐藏
        d.hiddenFoods = d.hiddenFoods.filter(function (x) {
            return d.custFoods[meal].indexOf(x) === -1;
        });
        save(d);
        return n;
    }
    // 删除：预设 → 进隐藏名单；自定义 → 直接删
    function removeFood(meal, name) {
        var d = _ensureFoodCfg(load());
        if (d.custFoods[meal]) d.custFoods[meal] = d.custFoods[meal].filter(function (x) { return x !== name; });
        if (isPresetFood(name) && d.hiddenFoods.indexOf(name) === -1) d.hiddenFoods.push(name);
        save(d);
    }
    function restoreAllPresets() {
        var d = _ensureFoodCfg(load());
        d.hiddenFoods = [];
        save(d);
    }

    // 他一天的吃饭节奏（不卡太死，每天吃几顿、几点吃都带随机）：
    //   on      —— 这顿今天"开不开火"的概率（早午晚基本都吃，但偶尔睡过头/忙忘）
    //   middayPick —— 中午这顿在"午餐/工作餐"之间二选一（二选一，不会一天两顿中午饭）
    //   早午饭   —— 偶尔睡懒觉合并成 brunch；开了早午饭，早餐就自动取消
    var MEAL_WINDOWS = [
        { meal: '早餐',   startH: 6,  startM: 20, endH: 9,  endM: 40, on: 0.90 },
        { meal: '早午饭', startH: 9,  startM: 40, endH: 11, endM: 5,  on: 0.18 },
        { meal: '午餐',   startH: 11, startM: 0,  endH: 13, endM: 40, on: 0.95, middayPick: ['午餐', '工作餐'], middayWeights: [0.62, 0.38] },
        { meal: '加餐',   startH: 14, startM: 20, endH: 16, endM: 40, on: 0.50 },
        { meal: '晚餐',   startH: 17, startM: 20, endH: 20, endM: 40, on: 0.92 },
        { meal: '夜宵',   startH: 21, startM: 20, endH: 23, endM: 45, on: 0.45 }
    ];

    // 手动记一笔时可选的餐段
    var MEALS = ['早餐', '早午饭', '午餐', '工作餐', '加餐', '晚餐', '夜宵'];

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
        var h = new Date().getHours(), m = new Date().getMinutes();
        var t = h * 60 + m;
        if (t >= 5 * 60 + 30 && t < 9 * 60 + 40) return '早餐';
        if (t >= 9 * 60 + 40 && t < 11 * 60 + 5) return '早午饭';
        if (t >= 11 * 60 && t < 13 * 60 + 40) return '午餐';
        if (t >= 14 * 60 + 20 && t < 16 * 60 + 40) return '加餐';
        if (t >= 17 * 60 + 20 && t < 20 * 60 + 40) return '晚餐';
        if (t >= 21 * 60 + 20 && t < 23 * 60 + 50) return '夜宵';
        // 交界空档按就近餐段兜底
        if (t < 5 * 60 + 30) return '夜宵';
        if (t < 11 * 60) return '早餐';
        if (t < 14 * 60 + 20) return '午餐';
        return '晚餐';
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
            _ensureFoodCfg(d);
            return d;
        } catch (e) {
            return _ensureFoodCfg({ entries: [] });
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
    // 不卡太死：每顿按 on 概率决定吃不吃；时间点在窗口内均匀随机；
    // 偶尔睡懒觉吃了早午饭，早餐就自动取消；中午在午餐/工作餐里随机二选一
    function _ensurePlan(d) {
        var today = _todayStr();
        if (d.mealPlan && d.mealPlan.date === today && Array.isArray(d.mealPlan.items)) return d.mealPlan;
        var now = new Date();
        var items = MEAL_WINDOWS.map(function (w) {
            var s = _winStart(w, now), e = _winEnd(w, now);
            var meal = w.meal;
            // 中午这顿：午餐 / 工作餐 按权重二选一（只产生一条计划）
            if (w.middayPick) {
                var r = Math.random();
                meal = r < w.middayWeights[0] ? w.middayPick[0] : w.middayPick[1];
            }
            return {
                meal: meal,
                on: Math.random() < w.on,
                at: s + Math.floor(Math.random() * Math.max(1, e - s))
            };
        });
        // 吃了早午饭 → 早餐自动取消（睡觉呢）
        var brunch = items.filter(function (it) { return it.meal === '早午饭'; })[0];
        if (brunch && brunch.on) {
            items.forEach(function (it) { if (it.meal === '早餐') it.on = false; });
        }
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

    function _winForMeal(meal, day) {
        // 工作餐复用中午窗口；其他餐段直接查
        var w = MEAL_WINDOWS.filter(function (x) { return x.meal === meal; })[0];
        if (!w && meal === '工作餐') w = MEAL_WINDOWS.filter(function (x) { return x.meal === '午餐'; })[0];
        return w ? { s: _winStart(w, day), e: _winEnd(w, day) } : null;
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
            var win = _winForMeal(it.meal, new Date());
            if (!win || now > win.e) { it.done = true; continue; }  // 窗口已过，静默跳过，不补发
            var delay = Math.max(3000, it.at - now);                // 还没到点就等；在窗口内则至少 3 秒后吃
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
            var win = _winForMeal(it.meal, now);
            if (!win || now.getTime() > win.e) { it.done = true; continue; }
            // 到点了：从"当前餐段生效池"（预设+自定义、删掉的已剔除）抽吃的；
            // 不卡太死——70% 优先挑今天没吃过的，30% 全池随便抽，允许偶尔回味
            var meal = it.meal;
            var pool = poolFor(meal);
            if (!pool.length) pool = recommendPool();
            var eatenToday = {};
            d.entries.forEach(function (en) {
                if (en.author === 'partner' && en.kind === 'eaten' && _todayStr(en.ts) === _todayStr()) eatenToday[en.what] = 1;
            });
            var fresh = pool.filter(function (f) { return !eatenToday[f[0]]; });
            var useFresh = fresh.length && (Math.random() < 0.7);
            var f = _pick(useFresh ? fresh : pool);
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
        var f = _pick(recommendPool());
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
        ['工作餐', /工作餐|加班餐|盒饭|便当|员工餐|食堂打?饭/],
        ['夜宵', /夜宵|宵夜/],
        ['早午饭', /早午饭|早午餐|brunch/i],
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
            m = text.match(/(?:早餐|早饭|早午饭|早午餐|午餐|午饭|中饭|工作餐|加班餐|晚餐|晚饭|夜宵|宵夜|下午茶)\s*(?:是|为|有|解决了?|搞定了?|安排了?|吃的是|吃了)?\s*[:：]?\s*(.+?)\s*[。.!！~～…]*$/);
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

        // 拆分：同一条消息里金额归记账，剩下的文本才交给食光——
        // 先让记账把金额片段抠走（「中午吃了米线，18.4」→「中午吃了米线」），
        // 这样食光只记「米线」，不会把价格和食物名并列记进去
        var eatText = text;
        try {
            if (window.Ledger && typeof window.Ledger.splitText === 'function') {
                var sp = window.Ledger.splitText(text);
                if (sp && sp.amount != null && sp.text) eatText = sp.text;
            }
        } catch (e) {}

        var hit = detectEaten(eatText);
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
            '#food-modal .modal-content{max-width:420px;width:90vw;max-height:90vh;display:flex;flex-direction:column;overflow-y:auto;}' +
            '#food-modal .modal-content>*{flex-shrink:0;}' +
            // 顶部标题和底部按钮固定；「推荐 / 记一笔 / 最近食光」整体塞进大滚动区，
            // 列表能划的面积比原来那个 26vh 的小盒子大得多
            '#food-modal .modal-content>.food-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;}' +
            '.food-sec-title{font-size:13px;font-weight:700;color:var(--text-secondary,#999);margin:16px 0 8px;}' +
            '.food-sec-title:first-of-type{margin-top:6px;}' +
            '.food-input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:11px;border:1.5px solid var(--border-color,#ddd);background:var(--primary-bg,transparent);color:var(--text-primary,#333);font-size:14px;outline:none;font-family:var(--font-family);}' +
            '.food-input:focus{border-color:var(--accent-color,#c5a47e);}' +
            '.food-btn-row{display:flex;gap:8px;margin-top:10px;}' +
            '.food-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;}' +
            '.food-chip{padding:7px 14px;border-radius:999px;border:1px solid var(--border-color,#ddd);background:var(--secondary-bg,transparent);font-size:13px;color:var(--text-primary,#333);cursor:pointer;font-family:var(--font-family);}' +
            '.food-chip.active{border-color:var(--accent-color,#c5a47e);background:rgba(var(--accent-color-rgb,197,164,126),.16);color:var(--accent-color,#c5a47e);font-weight:700;}' +
            '.food-row{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;border:1px solid var(--border-color,#ececec);background:var(--secondary-bg,rgba(0,0,0,.02));margin-top:8px;}' +
            '.food-row:hover{background:var(--secondary-bg,rgba(0,0,0,.05));}' +
            '.food-row-icon{width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;flex-shrink:0;}' +
            '.food-row-main{flex:1;min-width:0;}' +
            '.food-row-desc{font-size:14px;line-height:1.45;font-weight:600;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;}' +
            '.food-row-sub{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:11.5px;color:var(--text-secondary,#999);margin-top:5px;}' +
            '.food-meal-badge{display:inline-flex;align-items:center;padding:0 8px;border-radius:999px;font-size:11px;line-height:18px;background:rgba(249,115,22,.14);color:#e8842b;white-space:nowrap;}' +
            '.food-row-time{font-size:11px;color:var(--text-secondary,#aaa);font-variant-numeric:tabular-nums;}' +
            '.food-row-btn{flex-shrink:0;width:28px;height:28px;border:none;border-radius:50%;background:transparent;color:var(--text-secondary,#aaa);font-size:12px;cursor:pointer;}' +
            '.food-date-head{font-size:12px;color:var(--text-secondary,#999);margin:14px 4px 4px;}' +
            '.food-author-tag{display:inline-block;padding:0 6px;border-radius:8px;font-size:10px;line-height:16px;background:rgba(197,164,126,.16);color:var(--accent-color,#c5a47e);margin-right:0;vertical-align:middle;}' +
            '.food-author-partner{background:rgba(138,123,216,.16);color:#8a7bd8;}' +
            // ── 两人食光对比卡 ──
            '.food-compare-card{border:1px solid var(--border-color,#e8e8e8);border-radius:14px;padding:12px 13px;background:var(--secondary-bg,rgba(0,0,0,.02));}' +
            '.food-compare-title{font-size:12px;font-weight:700;color:var(--text-secondary,#999);margin-bottom:11px;}' +
            '.food-cmp-row{margin-bottom:10px;}' +
            '.food-cmp-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:var(--text-primary,#333);margin-bottom:5px;}' +
            '.food-cmp-name{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:700;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;}' +
            '.food-cmp-val{font-size:15px;font-weight:800;flex-shrink:0;}' +
            '.food-cmp-unit{font-size:11px;color:var(--text-secondary,#999);font-weight:400;}' +
            '.food-cmp-bar{height:8px;border-radius:4px;background:var(--border-color,#ececec);overflow:hidden;}' +
            '.food-cmp-bar>div{height:100%;border-radius:4px;transition:width .4s ease;}' +
            '.food-cmp-extra{font-size:12px;color:var(--text-secondary,#999);margin-top:2px;text-align:center;line-height:1.7;}' +
            '.food-cmp-extra b{color:var(--text-primary,#333);}' +
            '.food-cmp-all{font-size:11px;color:var(--text-secondary,#999);margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-color,#e8e8e8);text-align:center;line-height:1.7;}' +
            '.food-compare-empty{font-size:12px;color:var(--text-secondary,#999);padding:14px 10px;text-align:center;border:1px dashed var(--border-color,#e8e8e8);border-radius:12px;}';
        document.head.appendChild(st);

        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'food-modal';
        m.style.zIndex = '3200';
        m.innerHTML =
            '<div class="modal-content">'
            +   '<div class="modal-title"><i class="fas fa-utensils"></i><span>食光记</span></div>'

            +   '<div class="food-scroll">'
            +   '<div class="food-sec-title"><i class="fas fa-scale-balanced"></i> 两人食光对比</div>'
            +   '<div id="food-compare"></div>'

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
            +   '<div id="food-list"></div>'
            +   '</div>'

            +   '<div class="food-btn-row" style="margin-top:12px;">'
            +     '<button type="button" id="food-manage-menu" style="flex:1;padding:9px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-bowl-food"></i> 管理他的菜单</button>'
            +     '<button type="button" id="food-manage-react" style="flex:1;padding:9px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-comment-dots"></i> 管理反应字卡</button>'
            +   '</div>'
            +   '<div class="food-btn-row" style="margin-top:8px;">'
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
        m.querySelector('#food-manage-menu').addEventListener('click', function () {
            openMenuManager();
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

    // ── 两人食光对比：我 vs 他 各吃了多少顿 + 互相推荐次数 ──────────────
    var _FC_ME_RGB = '197,164,126';     // 我：主题米金色
    var _FC_HIM_RGB = '138,123,216';    // 他：紫色

    function renderCompare() {
        var el = document.getElementById('food-compare');
        if (!el) return;
        var d = load();
        var meName = '我';
        var himName = _partnerName();

        var stat = { me: { eat: 0, rec: 0 }, partner: { eat: 0, rec: 0 } };
        var now = new Date();
        var mKey = now.getFullYear() + '-' + now.getMonth();
        var meMonth = 0, himMonth = 0;
        (d.entries || []).forEach(function (x) {
            var who = x.author === 'partner' ? 'partner' : 'me';
            if (x.kind === 'eaten') {
                stat[who].eat++;
                var dt = new Date(x.ts);
                if (dt.getFullYear() + '-' + dt.getMonth() === mKey) {
                    if (who === 'partner') himMonth++; else meMonth++;
                }
            } else if (x.kind === 'recommend') {
                stat[who].rec++;
            }
        });

        if (!(d.entries || []).length) {
            el.innerHTML = '<div class="food-compare-empty">还没有食光记录<br>记几笔或推荐一顿就能看到对比啦</div>';
            return;
        }

        var maxEat = Math.max(stat.me.eat, stat.partner.eat, 1);
        function block(name, count, rgb) {
            var w = Math.max(2, Math.round(count / maxEat * 100));
            return '<div class="food-cmp-row">'
                + '<div class="food-cmp-head">'
                +   '<span class="food-cmp-name" style="background:rgba(' + rgb + ',.16);color:rgb(' + rgb + ');">' + _esc(name) + '</span>'
                +   '<span class="food-cmp-val">' + count + ' <span class="food-cmp-unit">顿</span></span>'
                + '</div>'
                + '<div class="food-cmp-bar"><div style="width:' + w + '%;background:linear-gradient(90deg,rgba(' + rgb + ',.9),rgba(' + rgb + ',.5));"></div></div>'
                + '</div>';
        }

        var diffTxt;
        var diff = stat.me.eat - stat.partner.eat;
        if (diff === 0) diffTxt = '两人吃的一样多';
        else if (diff > 0) diffTxt = meName + '比' + _esc(himName) + '多吃 ' + diff + ' 顿';
        else diffTxt = _esc(himName) + '比' + meName + '多吃 ' + (-diff) + ' 顿';

        el.innerHTML =
            '<div class="food-compare-card">'
            + '<div class="food-compare-title"><i class="fas fa-utensils"></i> 共记录 ' + d.entries.length + ' 条食光</div>'
            + block(meName, stat.me.eat, _FC_ME_RGB)
            + block(himName, stat.partner.eat, _FC_HIM_RGB)
            + '<div class="food-cmp-extra">' + diffTxt + '</div>'
            + '<div class="food-cmp-extra">本月：' + meName + ' <b>' + meMonth + '</b> 顿 · ' + _esc(himName) + ' <b>' + himMonth + '</b> 顿</div>'
            + '<div class="food-cmp-all">互相推荐：' + meName + '推了 <b>' + stat.me.rec + '</b> 次 · '
            + _esc(himName) + '推了 <b>' + stat.partner.rec + '</b> 次</div>'
            + '</div>';
    }

    function renderList() {
        renderCompare();
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
                +     (isRec ? '<span class="food-meal-badge">推荐</span>' : '<span class="food-meal-badge">' + _esc(x.meal || '') + '</span>')
                +     '<span class="food-row-time">' + time + '</span></div>'
                + '</div>'
                + '<button type="button" class="food-row-btn" data-food-del="' + _esc(x.id) + '" title="删除"><i class="fas fa-times"></i></button>'
                + '</div>';
        });
        el.innerHTML = html;
    }

    // ── "他吃什么"菜单管理：自定义添加 + 删除预设（预设可一键恢复） ──────────────────────
    var _menuMeal = '早餐';
    function openMenuManager() {
        var old = document.getElementById('food-menu-modal');
        if (old) old.remove();
        var ov = document.createElement('div');
        ov.className = 'modal';
        ov.id = 'food-menu-modal';
        ov.style.zIndex = '3300';
        ov.innerHTML =
            '<div class="modal-content" style="max-width:400px;width:90vw;max-height:84vh;display:flex;flex-direction:column;">'
            + '<div class="modal-title"><i class="fas fa-bowl-food"></i><span>他吃什么 · 菜单</span></div>'
            + '<div style="font-size:11px;color:var(--text-secondary,#999);line-height:1.6;margin-bottom:8px;">给他加你想让他吃的（每行一个或用顿号隔开），不喜欢的预设点 × 删掉，可随时恢复</div>'
            + '<div class="food-chips" id="fm-meal-chips" style="flex-shrink:0;"></div>'
            + '<div style="display:flex;gap:8px;flex-shrink:0;margin-bottom:8px;">'
            +   '<input type="text" class="food-input" id="fm-add-input" placeholder="加一个，如：胡辣汤" maxlength="40">'
            +   '<button type="button" id="fm-add-btn" class="modal-btn modal-btn-primary" style="flex-shrink:0;padding:9px 16px;font-size:12px;">添加</button>'
            + '</div>'
            + '<div id="fm-list" style="flex:1;overflow-y:auto;min-height:120px;display:flex;flex-direction:column;gap:4px;"></div>'
            + '<div id="fm-hidden-bar" style="flex-shrink:0;margin-top:8px;font-size:11px;color:var(--text-secondary,#999);"></div>'
            + '<div class="food-btn-row" style="flex-shrink:0;margin-top:10px;">'
            +   '<button type="button" id="fm-restore" class="modal-btn modal-btn-secondary" style="flex:1;padding:9px;font-size:12px;">恢复全部预设</button>'
            +   '<button type="button" id="fm-done" class="modal-btn modal-btn-primary" style="flex:1;padding:9px;font-size:12px;">完成</button>'
            + '</div>'
            + '</div>';
        document.body.appendChild(ov);
        if (typeof showModal === 'function') showModal(ov); else ov.style.display = 'flex';

        function renderMealChips() {
            var box = ov.querySelector('#fm-meal-chips');
            box.innerHTML = '';
            MEALS.forEach(function (mm) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'food-chip' + (mm === _menuMeal ? ' active' : '');
                b.textContent = mm;
                b.addEventListener('click', function () { _menuMeal = mm; renderMealChips(); renderFoods(); });
                box.appendChild(b);
            });
        }
        function foodRowHTML(f) {
            var isCustom = !isPresetFood(f[0]);
            return '<div class="food-row">'
                + '<span class="food-row-icon" style="background:rgba(var(--accent-color-rgb,197,164,126),.55);">' + _esc(f[1] || DEFAULT_EMOJI) + '</span>'
                + '<div class="food-row-main"><div class="food-row-desc">' + _esc(f[0]) + '</div>'
                + '<div class="food-row-sub">' + (isCustom ? '我加的' : '预设') + '</div></div>'
                + '<button type="button" class="food-row-btn" data-fm-del="' + _esc(f[0]) + '" title="删除" style="color:#e57373;"><i class="fas fa-xmark"></i></button>'
                + '</div>';
        }
        function renderFoods() {
            var box = ov.querySelector('#fm-list');
            var pool = poolFor(_menuMeal);
            box.innerHTML = pool.length
                ? pool.map(foodRowHTML).join('')
                : '<div style="text-align:center;font-size:12px;color:var(--text-secondary,#aaa);padding:20px 0;">这餐还没有食物，加一个吧</div>';
            var d = load();
            var bar = ov.querySelector('#fm-hidden-bar');
            bar.textContent = d.hiddenFoods.length ? ('已删 ' + d.hiddenFoods.length + ' 个预设（全部餐段生效）') : '';
        }
        function doAdd() {
            var input = ov.querySelector('#fm-add-input');
            var v = input.value;
            if (!v.trim()) { if (typeof showNotification === 'function') showNotification('先写个吃的呀', 'info', 1500); return; }
            var n = addCustomFood(_menuMeal, v);
            input.value = '';
            renderFoods();
            if (typeof showNotification === 'function') {
                showNotification(n ? ('✓ 添加 ' + n + ' 个到「' + _menuMeal + '」') : '这些已经有啦', n ? 'success' : 'info', 1600);
            }
        }
        ov.querySelector('#fm-add-btn').addEventListener('click', doAdd);
        ov.querySelector('#fm-add-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
        ov.querySelector('#fm-list').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-fm-del]');
            if (!btn) return;
            var name = btn.getAttribute('data-fm-del');
            removeFood(_menuMeal, name);
            renderFoods();
        });
        ov.querySelector('#fm-restore').addEventListener('click', function () {
            var d = load();
            if (!d.hiddenFoods.length) { if (typeof showNotification === 'function') showNotification('没有删掉的预设呀', 'info', 1500); return; }
            restoreAllPresets();
            renderFoods();
            if (typeof showNotification === 'function') showNotification('✓ 预设已全部恢复', 'success', 1500);
        });
        ov.querySelector('#fm-done').addEventListener('click', function () { ov.remove(); });
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });

        renderMealChips();
        renderFoods();
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

    window.Food = {
        open: open,
        detect: detectEaten,
        // 测试/调试用
        poolFor: poolFor,
        recommendPool: recommendPool,
        addCustomFood: addCustomFood,
        removeFood: removeFood,
        restoreAllPresets: restoreAllPresets,
        isPresetFood: isPresetFood
    };
})();
