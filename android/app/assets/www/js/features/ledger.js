/**
 * ledger.js — 记账本
 *
 * 聊天式自动记账：在聊天里对梦角说「午饭花了30」「奶茶15元」「打车23块」，
 * 自动识别金额、按关键词归类（餐饮/交通/购物…），并在聊天流里插入一条
 * 居中的系统小卡片确认；也支持「记账 午饭 30」强制记一笔。
 * 管理弹窗：月度汇总（分类条形图）、按日分组流水、手动记一笔/修改/删除、
 * 聊天自动记账开关、共同记账开关 + 消费选项管理。
 *
 * 共同记账：开启后他完全随机地自己记上一笔（什么时候记、一次记几张都不定，
 * 调度器照抄 redpacket.js 的 nextCheckAt 持久化模式），播报到聊天流并计入账本汇总；
 * 每条流水带 author 标记（我/他），消费选项分内置+自定义、可勾选"隐藏明细"；
 * 隐藏项记账时不显示买了什么，只显示"神秘消费 ¥xx"。
 *
 * 入口：高级功能 → 实用工具 → 记账本；输入区「+」更多菜单 → 记账
 * 存储：localforage（ledgerRecords / ledgerSettings / sharedLedger），随全局备份自动导出
 */
(function () {
    'use strict';

    var KEY_RECORDS = 'ledgerRecords';
    var KEY_SETTINGS = 'ledgerSettings';
    var KEY_SHARED = 'sharedLedger';    // 共同记账：开关 + 他的选项 + 他的流水 + 调度器状态

    // 分类定义：顺序即归类优先级（通讯→居住→交通→医疗→学习→娱乐→餐饮→购物→其他），
    // rgb 用于进度条/图标底色的 rgba()
    var CATS = [
        { name: '通讯', icon: 'fa-phone',             rgb: '6,182,212',    words: ['话费', '流量', '月租'] },
        { name: '居住', icon: 'fa-house',             rgb: '16,185,129',   words: ['房租', '水电', '水费', '电费', '燃气', '物业', '宽带', '取暖'] },
        { name: '交通', icon: 'fa-bus',               rgb: '59,130,246',   words: ['打车', '出租', '滴滴', '地铁', '公交', '单车', '哈啰', '加油', '油费', '火车', '高铁', '动车', '机票', '飞机', '停车', '过路', '轮渡', '车票'] },
        { name: '医疗', icon: 'fa-briefcase-medical', rgb: '239,68,68',    words: ['药', '医院', '看病', '挂号', '体检', '诊所', '维生素', '口罩', '就诊', '创可贴', '体温计', '碘伏', '棉签', '纱布'] },
        { name: '学习', icon: 'fa-book',              rgb: '99,102,241',   words: ['书', '课本', '课程', '培训', '文具', '打印', '复印', '资料', '学费', '网课'] },
        { name: '娱乐', icon: 'fa-gamepad',           rgb: '139,92,246',   words: ['电影', '游戏', '充值', '会员', '视频', '音乐', 'KTV', 'ktv', '演出', '演唱会', '门票', '旅游', '景点', '游乐园', '密室', '剧本杀', '直播', '打赏'] },
        { name: '餐饮', icon: 'fa-utensils',          rgb: '249,115,22',   words: ['外卖', '奶茶', '咖啡', '早餐', '早饭', '午餐', '午饭', '晚餐', '晚饭', '宵夜', '夜宵', '烧烤', '火锅', '零食', '水果', '饮料', '吃饭', '食堂', '面包', '蛋糕', '米线', '麻辣烫', '汉堡', '披萨', '寿司', '点心', '小吃', '买菜', '炸鸡', '烤肉', '螺蛳粉', '饺子', '馄饨', '关东煮', '烤鱼', '喝', '吃', '餐'] },
        { name: '购物', icon: 'fa-bag-shopping',      rgb: '236,72,153',   words: ['淘宝', '京东', '拼多多', '超市', '便利店', '衣服', 'T恤', '鞋', '裤', '裙', '袜', '化妆品', '护肤', '口红', '香水', '纸巾', '抽纸', '卷纸', '卫生纸', '湿巾', '餐巾纸', '面巾纸', '手帕纸', '厨房纸', '卫生巾', '护垫', '棉条', '洗发水', '沐浴露', '牙膏', '牙刷', '毛巾', '洗衣液', '洗洁精', '垃圾袋', '收纳', '口罩', '雨伞', '拖鞋', '理发', '美甲', '网购', '快递', '日用', '买'] },
        { name: '其他', icon: 'fa-ellipsis',          rgb: '156,163,175',  words: [] }
    ];

    // ─── 金额识别正则 ───────────────────────────────────────────────
    // A1: ¥30 / ￥12.5
    var RE_YEN = /[¥￥]\s*(\d+(?:\.\d{1,2})?)/;
    // A2: 30元 / 30块 / 30块钱 / 30圆 / 30人民币 / 30rmb
    var RE_UNIT = /(\d+(?:\.\d{1,2})?)\s*(?:块钱|块|元|圆|人民币|rmb)/i;
    // B: 消费动词 + 数字（无单位）：花了30 / 买奶茶15 / 充了100 / 支付25
    //    负向先行：排除量词（买了2个）、时间（15分钟）、序号（3号）、大数（30万）
    var RE_VERB = /(?:花了|花费|消费了?|付了|支付了?|付|充值|充了|充|买了|买)[^\d¥￥]{0,10}?(\d+(?:\.\d{1,2})?)(?!\d)(?![个件只双张次趟杯瓶盒本份支条头页倍分秒点时号天日月年岁遍下折万亿千百万])/;
    // C: 常见消费词 + 数字结尾（口语速记）：外卖27.5 / 奶茶15 / 卫生巾30 / 地铁6
    var RE_NOUN = /(外卖|奶茶|咖啡|打车|地铁|公交|话费|房租|水电|加油|早餐|午饭|晚餐|宵夜|电影|门票|停车|火车票|机票|感冒药|药|卫生巾|护垫|纸巾|抽纸|卷纸|卫生纸|湿巾|餐巾纸|面巾纸|手帕纸|厨房纸|洗发水|沐浴露|牙膏|牙刷|毛巾|洗衣液|洗洁精|垃圾袋|零食|水果|理发|日用品|快递|炸鸡|烤肉|网购|会员)[^\d]{0,4}(\d+(?:\.\d{1,2})?)\s*$/;

    // 描述清洗：从金额前文里剔除的时间/助词/动词/量词等虚词（长的优先）
    var FILLERS = ['刚刚', '刚才', '今天', '昨天', '现在', '我们', '花了', '花费', '买了', '付了', '支付', '充值', '充了', '消费', '用了', '上午', '中午', '下午', '晚上', '今晚', '一', '二', '两', '三', '四', '五', '几', '我', '又', '再', '去', '跟', '和', '在', '给', '的', '了', '个', '件', '只', '张', '杯', '碗', '份', '支', '条', '买', '付', '充', '用'];

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function classify(text) {
        // 跨分类找"最长命中词"：避免"餐巾纸"被餐饮的单字"餐"抢走、
        // "护垫"被餐饮的"垫"类歧义影响；长度相同时按 CATS 声明顺序
        var best = null;
        for (var i = 0; i < CATS.length; i++) {
            var words = CATS[i].words;
            for (var j = 0; j < words.length; j++) {
                var w = words[j];
                if (text.indexOf(w) > -1) {
                    if (!best || w.length > best.word.length || (w.length === best.word.length && i < best.catIdx)) {
                        best = { name: CATS[i].name, word: w, catIdx: i };
                    }
                }
            }
        }
        return best ? best.name : '其他';
    }

    // 自定义类别的配色池（按添加顺序轮流取）
    var CAT_PALETTE = ['236,72,153', '14,165,233', '34,197,94', '250,204,21', '168,85,247', '251,146,60', '20,184,166', '217,70,239'];

    function catByName(name) {
        for (var i = 0; i < CATS.length; i++) if (CATS[i].name === name) return CATS[i];
        for (var j = 0; j < cfg.customCats.length; j++) {
            if (cfg.customCats[j] === name) {
                return { name: name, icon: 'fa-tag', rgb: CAT_PALETTE[j % CAT_PALETTE.length] };
            }
        }
        return CATS[CATS.length - 1];
    }

    function cleanDesc(before) {
        var s = String(before || '');
        for (var i = 0; i < FILLERS.length; i++) {
            s = s.split(FILLERS[i]).join('');
        }
        s = s.replace(/^[\s，。,.、!！?？~～:：;；\-—]+|[\s，。,.、!！?？~～:：;；\-—]+$/g, '');
        if (s.length > 14) s = s.slice(0, 14);
        return s;
    }

    function buildHit(amt, desc, raw) {
        amt = parseFloat(amt);
        if (!isFinite(amt) || amt <= 0 || amt > 99999) return null;
        return {
            amount: Math.round(amt * 100) / 100,
            category: classify(raw),
            desc: String(desc || '').trim().slice(0, 14)
        };
    }

    /**
     * 识别一句话里的消费记录。返回 {amount, category, desc} 或 null。
     * 优先级：强制指令 → ¥符号 → 数字+单位 → 动词+数字 → 消费词+结尾数字
     */
    function detectExpense(text) {
        if (!text) return null;
        text = String(text).trim();
        if (!text || text.length > 200) return null;

        // 1) 强制记账指令：「记账 午饭 30」「/记 奶茶 15」「记一笔 电影 40」
        var fm = text.match(/^\s*(?:\/记|记账|记帐|记一笔)[\s:：,，、]+([\s\S]+)$/);
        if (fm) {
            var body = fm[1].trim();
            var nums = body.match(/\d+(?:\.\d{1,2})?/g);
            if (nums && nums.length) {
                var amtF = parseFloat(nums[nums.length - 1]);
                var descF = body.replace(/\d+(?:\.\d{1,2})?\s*(?:块钱?|元|圆|人民币|rmb)?\s*$/i, '').trim();
                return buildHit(amtF, cleanDesc(descF), body);
            }
            return null;
        }

        var m;
        // 2) ¥30 / ￥12.5
        m = text.match(RE_YEN);
        if (m) return buildHit(m[1], cleanDesc(text.slice(0, m.index)), text);

        // 3) 30元 / 30块
        m = text.match(RE_UNIT);
        if (m) return buildHit(m[1], cleanDesc(text.slice(0, m.index)), text);

        // 4) 花了30 / 买奶茶15（排除量词、时间、大数后缀）
        m = text.match(RE_VERB);
        if (m) {
            var descV = cleanDesc(text.slice(0, m.index));
            if (!descV) {
                // 动词在句首：取动词与金额之间的内容（「买奶茶15」→「奶茶」）
                var between = m[0].replace(/^[花了花费消费付支付充值充买]+/, '').replace(/\d+(?:\.\d{1,2})?$/, '');
                descV = cleanDesc(between);
            }
            if (!descV) {
                // 金额后还有尾巴：取金额后的第一个词（「充了100话费」→「话费」）
                var after = text.slice(m.index + m[0].length).split(/[\s，。,.、!！?？]/)[0];
                descV = cleanDesc(after);
            }
            return buildHit(m[1], descV, text);
        }

        // 5) 外卖27.5 / 奶茶15（消费词+数字在句尾）
        m = text.match(RE_NOUN);
        if (m) return buildHit(m[2], m[1], text);

        return null;
    }

    // ─── 存储（localforage 优先，缺失时退回 localStorage） ─────────────
    var records = [];                 // 内存缓存，[{id,ts,amount,category,desc,source}]
    var cfg = { auto: true, customCats: [] };   // customCats：用户自增的记账类别（名字数组）
    var _loaded = false;
    var _saveTimer = null;
    var _seen = {};                   // 已处理过的用户消息 id，防重复

    // ─── 共同记账：模块状态与常量 ─────────────────────────────────
    // 他的流水直接并进 records（author='partner'），不再另起 key，
    // 渲染时无需合并；关掉开关也不丢历史，两边数据互不污染
    var shared = {
        enabled: false,
        consumerOptions: [],          // 自定义消费选项（用户可增删，可勾选隐藏明细）
        nextCheckAt: null             // 调度器持久化字段（照 redpacket.js 那套）
    };

    // 内置消费选项（写死常量）：hidden=true 的记账时不显示买了什么。
    // 覆盖尽量多的日常开销（含卫生巾等日用品），共同记账时他才会真的"什么都会买"
    var BUILTIN_CONSUMER_OPTIONS = [
        { id: 'eat',      label: '吃饭',         icon: '🍚', hidden: false },
        { id: 'milktea',  label: '奶茶',         icon: '🧋', hidden: false },
        { id: 'takeout',  label: '外卖',         icon: '🍜', hidden: false },
        { id: 'coffee',   label: '咖啡',         icon: '☕', hidden: false },
        { id: 'taxi',     label: '打车',         icon: '🚕', hidden: false },
        { id: 'snack',    label: '零食',         icon: '🍿', hidden: false },
        { id: 'fruit',    label: '水果',         icon: '🍎', hidden: false },
        { id: 'pad',      label: '卫生巾',       icon: '🩸', hidden: false },
        { id: 'grocery',  label: '日用品',       icon: '🧻', hidden: false },
        { id: 'shopping', label: '网购',         icon: '📦', hidden: false },
        { id: 'haircut',  label: '理发',         icon: '💇', hidden: false },
        { id: 'vip',      label: '会员充值',     icon: '🎬', hidden: false },
        { id: 'medicine', label: '药品',         icon: '💊', hidden: false },
        { id: 'transit',  label: '地铁公交',     icon: '🚇', hidden: false },
        { id: 'mystery',  label: '神秘消费',     icon: '🎁', hidden: true },
        { id: 'surprise', label: '小惊喜',       icon: '🌷', hidden: true },
        { id: 'sneaky',   label: '偷偷买了什么', icon: '🙈', hidden: true }
    ];

    // 播报文案：正常项不剧透具体买了啥；隐藏项金额也不露
    var LEDGER_MSGS = [
        '我记了一笔，¥{n}',
        '今天花了一点点，记上了'
    ];
    var LEDGER_MSGS_HIDDEN = [
        '我偷偷买了个东西，不告诉你多少钱'
    ];

    var _sharedTimer = null;          // 调度器 setTimeout 句柄

    function storageGet(key, cb) {
        if (typeof localforage !== 'undefined') {
            localforage.getItem(key).then(function (v) { cb(v); }).catch(function () { cb(null); });
        } else {
            var v = null;
            try { v = JSON.parse(localStorage.getItem(key)); } catch (e) {}
            cb(v);
        }
    }
    function storageSet(key, val) {
        if (typeof localforage !== 'undefined') {
            try { localforage.setItem(key, val); } catch (e) {}
        } else {
            try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
        }
    }
    function loadAll(cb) {
        storageGet(KEY_RECORDS, function (v) {
            records = Array.isArray(v) ? v : [];
            // 老数据没 author 字段的默认当 'me'
            records.forEach(function (r) { if (!r.author) r.author = 'me'; });
            _loaded = true;
            // 共同记账状态跟着流水一起读；读完才有资格排调度器（开关开着才真正起闹钟）
            storageGet(KEY_SHARED, function (s) {
                normalizeShared(s);
                scheduleSharedCheck();
                if (typeof cb === 'function') cb();
            });
        });
        storageGet(KEY_SETTINGS, function (v) {
            if (v && typeof v === 'object' && v !== null) {
                if (typeof v.auto === 'boolean') cfg.auto = v.auto;
                if (Array.isArray(v.customCats)) {
                    cfg.customCats = v.customCats
                        .filter(function (n) { return typeof n === 'string' && n.trim(); })
                        .map(function (n) { return n.trim().slice(0, 6); })
                        .filter(function (n, i, a) { return a.indexOf(n) === i; })
                        .slice(0, 20);
                }
            }
            fillCatSelect(); // 弹窗已经开着的话（兜底路径）同步一次下拉
        });
    }
    function saveSoon() {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(function () { storageSet(KEY_RECORDS, records); }, 400);
    }
    function saveCfg() { storageSet(KEY_SETTINGS, cfg); }

    // ─── 共同记账：状态读写 ─────────────────────────────────────────
    function saveShared() { storageSet(KEY_SHARED, shared); }

    // 老数据补字段/坏数据兜底：每个字段独立校验，缺哪个补哪个；
    // 旧结构（字符串选项 + partnerRecords）自动迁移到新结构（选项对象 + 并进 records）
    function normalizeShared(v) {
        var hadOld = !!(v && (Array.isArray(v.partnerOptions) || Array.isArray(v.commonOptions) || Array.isArray(v.partnerRecords)));
        var custom = (v && Array.isArray(v.consumerOptions)) ? v.consumerOptions.slice() : [];
        if (!custom.length) {
            // 旧字符串选项迁成 {id,label,icon,hidden}
            var old = ((v && Array.isArray(v.partnerOptions)) ? v.partnerOptions : [])
                .concat((v && Array.isArray(v.commonOptions)) ? v.commonOptions : []);
            old.forEach(function (label) {
                if (custom.some(function (o) { return o.label === label; })) return;
                var builtin = _builtinOption(label);
                custom.push({
                    id: 'opt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    label: label,
                    icon: builtin ? builtin.icon : '🛒',
                    hidden: builtin ? builtin.hidden : false
                });
            });
        }
        shared = {
            enabled: !!(v && v.enabled),
            consumerOptions: custom,
            nextCheckAt: (v && typeof v.nextCheckAt === 'number') ? v.nextCheckAt : null
        };
        // 旧 partnerRecords 并进 records（author='partner'），一次性迁移
        if (v && Array.isArray(v.partnerRecords) && v.partnerRecords.length) {
            v.partnerRecords.forEach(function (r) {
                records.push({
                    id: r.id, ts: r.ts, amount: r.amount,
                    category: r.mystery ? '其他' : classify(r.label),
                    desc: r.mystery ? '神秘消费' : r.label,
                    source: 'partner', author: 'partner', hidden: !!r.mystery
                });
            });
            saveSoon();
        }
        // 清掉旧字段，避免下次加载重复迁移
        if (hadOld) saveShared();
    }

    function _builtinOption(label) {
        for (var i = 0; i < BUILTIN_CONSUMER_OPTIONS.length; i++) {
            if (BUILTIN_CONSUMER_OPTIONS[i].label === label) return BUILTIN_CONSUMER_OPTIONS[i];
        }
        return null;
    }

    function partnerNameLabel() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }

    // ─── 共同记账：调度器（照抄 cinema.js / redpacket.js 的 nextCheckAt 持久化模式） ───
    // setTimeout + 把 nextCheckAt 存进 sharedLedger，不是 setInterval 轮询：
    // 页面关掉时间照走，下次打开发现过期就先补一笔再顺延；
    // 什么时候记完全随机——下一次间隔均匀分布在一个很宽的范围里，摸不到规律
    function sharedDelayMs() { return (10 + Math.random() * 470) * 60000; }   // 10 分钟~8 小时，完全随机

    function scheduleSharedCheck() {
        clearTimeout(_sharedTimer);
        if (!shared.enabled) return;
        if (!shared.nextCheckAt) {
            // 第一次开启：完全随机地隔一段时间才买第一单，别装上就秒买，像真人在慢慢生活
            shared.nextCheckAt = Date.now() + sharedDelayMs();
            saveShared();
        }
        var delay = shared.nextCheckAt - Date.now();
        if (delay <= 0) { runSharedCheck(); return; }
        _sharedTimer = setTimeout(runSharedCheck, delay);
    }

    function runSharedCheck() {
        if (shared.enabled) {
            // 这次他随手记几张完全随机（1~3 张），到点必记——随机感全靠随机间隔，
            // 不搞"到点再掷骰子"那套概率配置
            var n = 1 + Math.floor(Math.random() * 3);
            for (var i = 0; i < n; i++) _spawnPartnerExpense(i);
        }
        shared.nextCheckAt = Date.now() + sharedDelayMs();
        saveShared();
        scheduleSharedCheck();
    }

    // 单笔消费的落-chat流时机：第一张立刻，其余的隔随机几秒陆续冒出来，像真人一条条记
    function _spawnPartnerExpense(idx) {
        var fire = function () {
            // 开机竞态：ledger 的 loadAll 跑得比聊天模块的 loadData 早时，
            // 直接 addMessage 会被 loadData 恢复历史时覆盖丢掉（cinema.js 踩过同一个坑）。
            // 钩 renderMessages（loadData 收尾必调）——首次调用前先攒着，之后再真发。
            if (window._appDataLoaded || _chatReady) {
                generatePartnerExpense();
            } else {
                _pendingBootExpense++;
            }
        };
        if (idx === 0) fire();
        else setTimeout(fire, 800 + idx * 1500 + Math.random() * 1500);
    }

    var _chatReady = false;          // renderMessages 首调 = 聊天数据就绪
    var _pendingBootExpense = 0;     // 开机期间攒下的"他记了一笔"张数

    (function _hookRenderMessagesForLedger() {
        var origFn = window.renderMessages;
        if (typeof origFn !== 'function') return;
        window.renderMessages = function () {
            if (!_chatReady) {
                _chatReady = true;
                if (_pendingBootExpense > 0) {
                    var n = _pendingBootExpense;
                    _pendingBootExpense = 0;
                    for (var i = 0; i < n; i++) {
                        setTimeout(function () { generatePartnerExpense(); }, i * 1200);
                    }
                }
            }
            return origFn.apply(this, arguments);
        };
    })();

    // ─── 共同记账：生成他的一笔消费 ─────────────────────────────────
    function pickLedger(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    // 金额：15~200 元，保留 1 位小数（比如 36.5）
    function randAmount(min, max) {
        return Math.round((min + Math.random() * (max - min)) * 10) / 10;
    }

    function generatePartnerExpense() {
        // 抽签池 = 内置 + 自定义，每一项等概率，完全随机——不做任何权重/概率配置
        var pool = BUILTIN_CONSUMER_OPTIONS.concat(shared.consumerOptions || []);
        var picked = pickLedger(pool);
        var rec = {
            id: 'p_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
            ts: Date.now(),
            amount: randAmount(15, 200),
            category: picked.hidden ? '其他' : classify(picked.label),
            desc: picked.hidden ? pickLedger(['神秘消费', '偷偷花了']) : picked.label,
            source: 'partner',
            author: 'partner',
            hidden: !!picked.hidden
        };
        records.push(rec);
        saveSoon();
        partnerLedgerSay(rec);
        // 梦角熟练度 +3（存在性检查）
        if (window.PartnerProficiency && typeof window.PartnerProficiency.gain === 'function') {
            window.PartnerProficiency.gain(3);
        }
        // 记账本正好开着就当场刷新，让"他的账"蹦出来给用户看见
        var modal = document.getElementById('ledger-modal');
        if (modal && modal.style.display === 'flex') renderAll();
    }

    // 每笔消费同步播报进聊天流（正常项随机 2 条；隐藏项只说不告诉你金额）
    function partnerLedgerSay(rec) {
        try {
            if (typeof addMessage !== 'function') return;
            var text = rec.hidden
                ? pickLedger(LEDGER_MSGS_HIDDEN)
                : pickLedger(LEDGER_MSGS).replace(/\{n\}/g, rec.amount);
            addMessage({
                id: Date.now() + Math.random(),
                sender: partnerNameLabel(),
                text: text,
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal'
            });
            if (typeof playSound === 'function') playSound('message');
            // 同时弹顶部通知，App 在后台/看别的地方也能及时知道他记账了
            if (typeof showNotification === 'function') {
                showNotification(partnerNameLabel() + '刚记了一笔：' + (rec.hidden ? '神秘消费，就不告诉你' : rec.desc + ' ¥' + rec.amount.toFixed(1)), 'info', 3000);
            }
        } catch (e) { console.warn('[ledger] 共同记账播报失败:', e); }
    }

    function addRecord(hit, source, ts) {
        var rec = {
            id: 'r_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
            ts: ts || Date.now(),
            amount: hit.amount,
            category: hit.category,
            desc: hit.desc || '',
            source: source || 'chat',
            author: 'me'
        };
        records.push(rec);
        saveSoon();
        return rec;
    }

    // ─── 聊天流里插入记账确认卡片（system 消息，居中灰条） ─────────────
    function insertLedgerCard(hit) {
        try {
            if (typeof addMessage !== 'function') return;
            var d = hit.desc ? '（' + escapeHtml(hit.desc) + '）' : '';
            addMessage({
                id: Date.now() + Math.random(),
                sender: null,
                type: 'system',
                text: '<i class="fas fa-wallet" style="margin-right:4px;"></i>已记账 · ' + escapeHtml(hit.category) + ' ¥' + hit.amount.toFixed(2) + d,
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                replyTo: null
            });
        } catch (e) { console.warn('[ledger] 插入记账卡片失败:', e); }
    }

    // ─── 用户消息钩子 ──────────────────────────────────────────────
    function handleUserMessage(msg) {
        if (!cfg.auto) return;
        if (!msg || msg.sender !== 'user' || msg.type !== 'normal') return;
        var text = msg.text;
        if (!text || msg.image) return;

        var key = String(msg.id || '');
        if (key) {
            if (_seen[key]) return;
            _seen[key] = 1;
            if (Object.keys(_seen).length > 5000) _seen = {};
        }

        // 只说「记账/记一笔」→ 直接打开记账本
        if (/^\s*(?:\/记|记账|记帐|记一笔)[\s!！。～?？]*$/.test(text)) {
            setTimeout(open, 100);
            return;
        }

        var hit = detectExpense(text);
        if (!hit) return;
        addRecord(hit, 'chat');
        // 稍等一下再插卡片：此刻正处在 addMessage 执行中途，立刻重入有风险
        setTimeout(function () { insertLedgerCard(hit); }, 350);
    }

    // ─── 弹窗 UI ──────────────────────────────────────────────────
    var viewYear, viewMonth;          // 当前查看的月份
    var _editingId = null;            // 正在编辑的记录 id（null = 新增）

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtMoney(n) { return '¥' + (Math.round(n * 100) / 100).toFixed(2); }
    function monthKey(ts) {
        var d = new Date(ts);
        return d.getFullYear() + '-' + d.getMonth();
    }
    function dateKey(ts) {
        var d = new Date(ts);
        return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    }
    var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

    function buildModal() {
        if (document.getElementById('ledger-modal')) return;

            var st = document.createElement('style');
            st.textContent =
                '#ledger-modal .modal-content{max-width:430px;width:92vw;max-height:86vh;overflow-y:auto;}' +
                '.ledger-toggle-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border-color,#e8e8e8);border-radius:12px;background:var(--primary-bg,transparent);}' +
                '.ledger-toggle-btn{flex-shrink:0;min-width:64px;padding:6px 10px;border:none;border-radius:9px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:var(--font-family);}' +
                '.ledger-hint{font-size:11px;color:var(--text-secondary,#999);line-height:1.6;margin-top:6px;}' +
                '.ledger-month-bar{display:flex;align-items:center;gap:8px;margin-top:12px;}' +
                '.ledger-month-btn{width:30px;height:30px;border:1px solid var(--border-color,#ddd);border-radius:9px;background:transparent;color:var(--text-primary,#333);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}' +
                '.ledger-month-label{flex:1;text-align:center;font-size:15px;font-weight:700;color:var(--text-primary,#333);}' +
                '.ledger-total{font-size:12px;color:var(--text-secondary,#999);text-align:center;margin-top:2px;}' +
                '.ledger-total b{color:var(--accent-color,#c5a47e);font-size:15px;}' +
                '.ledger-sec-title{font-size:12px;font-weight:700;color:var(--text-secondary,#999);margin:14px 0 4px;}' +
                '.ledger-date-head{display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary,#999);margin:10px 2px 4px;}' +
                '.ledger-row{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:11px;}' +
                '.ledger-row:hover{background:var(--secondary-bg,rgba(0,0,0,.03));}' +
                '.ledger-cat-dot{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;flex-shrink:0;}' +
                '.ledger-row-main{flex:1;min-width:0;}' +
                '.ledger-row-desc{font-size:13px;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
                '.ledger-row-sub{font-size:10px;color:var(--text-secondary,#aaa);margin-top:1px;}' +
                '.ledger-row-amt{font-size:13px;font-weight:700;color:var(--text-primary,#333);flex-shrink:0;font-variant-numeric:tabular-nums;}' +
                '.ledger-row-btn{flex-shrink:0;width:26px;height:26px;border:none;border-radius:50%;background:transparent;color:var(--text-secondary,#aaa);font-size:11px;cursor:pointer;}' +
                '.ledger-form{border:1px dashed var(--border-color,#ddd);border-radius:12px;padding:10px 12px;margin-top:12px;}' +
                '.ledger-form-title{font-size:13px;font-weight:700;color:var(--text-primary,#333);margin-bottom:8px;}' +
                '.ledger-form-row{display:flex;gap:6px;margin-top:8px;}' +
                '.ledger-input{padding:8px 10px;border:1.5px solid var(--border-color,#ddd);border-radius:10px;font-size:13px;background:var(--primary-bg,transparent);color:var(--text-primary,#333);outline:none;font-family:var(--font-family);min-width:0;}' +
                '.ledger-input:focus{border-color:var(--accent-color,#c5a47e);}' +
                '.ledger-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}' +
                '.ledger-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;border:1px solid var(--border-color,#ddd);background:var(--secondary-bg,transparent);font-size:12px;color:var(--text-primary,#333);}' +
                '.ledger-chip-x{border:none;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;font-size:10px;padding:0;display:inline-flex;}' +
                '.ledger-chip-x:hover{color:#e53935;}' +
                '.ledger-author-tag{display:inline-block;padding:0 6px;border-radius:8px;font-size:10px;line-height:16px;background:rgba(197,164,126,.16);color:var(--accent-color,#c5a47e);margin-right:4px;vertical-align:middle;}' +
                '.ledger-author-partner{background:rgba(138,123,216,.16);color:#8a7bd8;}';
            document.head.appendChild(st);

            var m = document.createElement('div');
            m.className = 'modal';
            m.id = 'ledger-modal';
            m.style.zIndex = '3200';
            m.innerHTML =
                '<div class="modal-content">' +
                    '<div class="modal-title"><i class="fas fa-wallet"></i><span>记账本</span></div>' +

                    '<div class="ledger-toggle-row">' +
                        '<button type="button" class="ledger-toggle-btn" id="ledger-auto-toggle"></button>' +
                        '<div style="flex:1;min-width:0;">' +
                            '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">聊天自动记账</div>' +
                        '</div>' +
                    '</div>' +

                    '<div class="ledger-toggle-row" style="margin-top:8px;">' +
                        '<button type="button" class="ledger-toggle-btn" id="ledger-shared-toggle"></button>' +
                        '<div style="flex:1;min-width:0;">' +
                            '<div style="font-size:13px;font-weight:700;color:var(--text-primary);">共同记账</div>' +
                        '</div>' +
                        '<button type="button" id="ledger-shared-opts-btn" title="消费选项管理" style="flex-shrink:0;width:34px;height:34px;border:1px solid var(--border-color,#ddd);border-radius:10px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;font-size:13px;"><i class="fas fa-sliders"></i></button>' +
                    '</div>' +

                    '<div class="ledger-month-bar">' +
                        '<button type="button" class="ledger-month-btn" id="ledger-prev-month"><i class="fas fa-chevron-left"></i></button>' +
                        '<div class="ledger-month-label" id="ledger-month-label"></div>' +
                        '<button type="button" class="ledger-month-btn" id="ledger-next-month"><i class="fas fa-chevron-right"></i></button>' +
                        '<button type="button" class="ledger-month-btn" id="ledger-today-month" title="回到本月">今</button>' +
                    '</div>' +
                    '<div class="ledger-total" id="ledger-total"></div>' +

                    '<div class="ledger-sec-title"><i class="fas fa-chart-simple"></i> 分类汇总</div>' +
                    '<div id="ledger-summary"></div>' +

                    '<div class="ledger-sec-title"><i class="fas fa-receipt"></i> 流水明细</div>' +
                    '<div id="ledger-list" style="max-height:34vh;overflow-y:auto;"></div>' +

                    '<div class="ledger-form" id="ledger-form" style="display:none;">' +
                        '<div class="ledger-form-title" id="ledger-form-title">记一笔</div>' +
                        '<div class="ledger-form-row">' +
                            '<input type="text" class="ledger-input" id="ledger-f-desc" placeholder="事项（如：午饭）" maxlength="20" style="flex:1;">' +
                            '<input type="number" class="ledger-input" id="ledger-f-amount" placeholder="金额" step="0.01" min="0.01" style="width:96px;flex-shrink:0;">' +
                        '</div>' +
                        '<div class="ledger-form-row">' +
                            '<select class="ledger-input" id="ledger-f-cat" style="flex:1;min-width:0;"></select>' +
                            '<button type="button" id="ledger-f-cat-del" title="删除选中的自定义类别" style="display:none;flex-shrink:0;width:34px;height:34px;border:1px solid var(--border-color,#ddd);border-radius:10px;background:transparent;color:#e53935;cursor:pointer;font-size:12px;align-items:center;justify-content:center;"><i class="fas fa-trash-can"></i></button>' +
                            '<input type="date" class="ledger-input" id="ledger-f-date" style="width:138px;flex-shrink:0;">' +
                        '</div>' +
                        '<div class="ledger-form-row" style="justify-content:flex-end;">' +
                            '<button type="button" id="ledger-f-cancel" class="modal-btn modal-btn-secondary" style="padding:7px 14px;font-size:12px;">取消</button>' +
                            '<button type="button" id="ledger-f-save" class="modal-btn modal-btn-primary" style="padding:7px 16px;font-size:12px;">保存</button>' +
                        '</div>' +
                    '</div>' +

                    '<div style="display:flex;gap:8px;margin-top:14px;">' +
                        '<button type="button" id="ledger-add" style="flex:1;padding:9px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-plus"></i> 手动记一笔</button>' +
                        '<button type="button" id="ledger-close" class="modal-btn modal-btn-secondary" style="flex:0 0 auto;">关闭</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(m);

            // 分类下拉：内置 + 自定义 + 「新增类别」入口；选自定义类时旁边亮出删除按钮
            fillCatSelect();
            m.querySelector('#ledger-f-cat').addEventListener('change', function () {
                if (this.value === '__new__') {
                    var name = prompt('新类别名称（1~6个字，如：宠物、追星、猫粮）：');
                    if (name != null) name = String(name).trim().slice(0, 6);
                    if (!name) { this.value = '其他'; syncCatDelBtn(); return; }
                    var exists = CATS.some(function (c) { return c.name === name; }) || cfg.customCats.indexOf(name) > -1;
                    if (exists) {
                        if (typeof showNotification === 'function') showNotification('已经有这个类别啦', 'info', 1800);
                        this.value = name; syncCatDelBtn(); return;
                    }
                    if (cfg.customCats.length >= 20) {
                        if (typeof showNotification === 'function') showNotification('自定义类别最多 20 个，先删几个吧', 'info', 2000);
                        this.value = '其他'; syncCatDelBtn(); return;
                    }
                    cfg.customCats.push(name);
                    saveCfg();
                    fillCatSelect(name);
                    if (typeof showNotification === 'function') showNotification('已新增类别「' + name + '」', 'success', 1600);
                } else {
                    syncCatDelBtn();
                }
            });
            m.querySelector('#ledger-f-cat-del').addEventListener('click', function () {
                var sel = document.getElementById('ledger-f-cat');
                if (!sel) return;
                var name = sel.value;
                if (cfg.customCats.indexOf(name) === -1) return;
                if (!confirm('删除自定义类别「' + name + '」？\n已有记录不会丢，只是类别样式会按「其他」显示')) return;
                cfg.customCats = cfg.customCats.filter(function (n) { return n !== name; });
                saveCfg();
                fillCatSelect('其他');
                if (typeof showNotification === 'function') showNotification('已删除类别「' + name + '」', 'info', 1800);
            });

            // 关闭 / 点击遮罩关闭
            m.querySelector('#ledger-close').addEventListener('click', function () {
                if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
            });
            m.addEventListener('click', function (e) {
                if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
            });

            // 自动记账开关
            m.querySelector('#ledger-auto-toggle').addEventListener('click', function () {
                cfg.auto = !cfg.auto;
                saveCfg();
                renderToggle();
                if (typeof showNotification === 'function') {
                    showNotification(cfg.auto ? '已开启聊天自动记账' : '已关闭自动记账，仍可手动记一笔', 'info', 2000);
                }
            });

            // 共同记账开关 + 消费选项管理入口
            m.querySelector('#ledger-shared-toggle').addEventListener('click', toggleShared);
            m.querySelector('#ledger-shared-opts-btn').addEventListener('click', openOptsModal);

            // 月份导航
            m.querySelector('#ledger-prev-month').addEventListener('click', function () { shiftMonth(-1); });
            m.querySelector('#ledger-next-month').addEventListener('click', function () { shiftMonth(1); });
            m.querySelector('#ledger-today-month').addEventListener('click', function () {
                var now = new Date();
                viewYear = now.getFullYear(); viewMonth = now.getMonth();
                renderAll();
            });

            // 手动记一笔 / 表单
            m.querySelector('#ledger-add').addEventListener('click', function () { showForm(null); });
            m.querySelector('#ledger-f-cancel').addEventListener('click', function () { hideForm(); });
            m.querySelector('#ledger-f-save').addEventListener('click', saveForm);

            // 流水列表事件委托（编辑/删除）
            m.querySelector('#ledger-list').addEventListener('click', function (e) {
                var btn = e.target.closest('[data-act]');
                if (!btn) return;
                var id = btn.getAttribute('data-id');
                if (btn.getAttribute('data-act') === 'del') {
                    var rec = findRec(id);
                    if (!rec) return;
                    if (!confirm('删除这条记录？\n' + rec.category + ' ' + fmtMoney(rec.amount) + (rec.desc ? '（' + rec.desc + '）' : ''))) return;
                    records = records.filter(function (r) { return r.id !== id; });
                    saveSoon();
                    renderAll();
                } else if (btn.getAttribute('data-act') === 'edit') {
                    showForm(id);
                }
            });
        }

    // ─── 共同记账：消费选项管理小弹窗（内置固定 + 自定义可增删，可勾选隐藏明细） ────
    function buildOptsModal() {
        if (document.getElementById('ledger-shared-opts-modal')) return;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'ledger-shared-opts-modal';
        m.style.zIndex = '3300';    // 压在记账本(3200)之上
        m.innerHTML =
            '<div class="modal-content" style="max-width:400px;width:90vw;max-height:80vh;overflow-y:auto;">' +
                '<div class="modal-title"><i class="fas fa-sliders"></i><span>消费选项</span></div>' +
                '<div class="ledger-chips" id="ledger-opts-chips"></div>' +
                '<div class="ledger-form-row" style="margin-top:10px;">' +
                    '<input type="text" class="ledger-input" id="ledger-add-opt-input" placeholder="新增选项（如：游戏点卡）" maxlength="12" style="flex:1;">' +
                '</div>' +
                '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary,#888);margin-top:8px;cursor:pointer;">' +
                    '<input type="checkbox" id="ledger-add-opt-hidden" style="width:14px;height:14px;accent-color:var(--accent-color,#c5a47e);"> 隐藏明细（记了也不显示买了什么）' +
                '</label>' +
                '<div class="ledger-form-row" style="margin-top:10px;">' +
                    '<button type="button" id="ledger-add-opt-btn" class="modal-btn modal-btn-primary" style="padding:7px 14px;font-size:12px;flex:1;">添加</button>' +
                    '<button type="button" id="ledger-shared-opts-close" class="modal-btn modal-btn-secondary" style="padding:7px 14px;font-size:12px;flex:1;">关闭</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(m);

        // 关闭 / 点遮罩关闭
        m.querySelector('#ledger-shared-opts-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });

        // 删除自定义项走事件委托：重渲染后不用重新绑
        m.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-opt-del]');
            if (!btn) return;
            var id = btn.getAttribute('data-opt-del');
            shared.consumerOptions = (shared.consumerOptions || []).filter(function (o) { return o.id !== id; });
            saveShared();
            renderOpts();
        });

        function addOpt() {
            var input = m.querySelector('#ledger-add-opt-input');
            var hiddenCb = m.querySelector('#ledger-add-opt-hidden');
            var v = String(input.value || '').trim().slice(0, 12);
            if (!v) return;
            var exists = BUILTIN_CONSUMER_OPTIONS.some(function (o) { return o.label === v; })
                || (shared.consumerOptions || []).some(function (o) { return o.label === v; });
            if (exists) {
                if (typeof showNotification === 'function') showNotification('已经有这个选项啦', 'info', 1800);
                return;
            }
            if (!Array.isArray(shared.consumerOptions)) shared.consumerOptions = [];
            shared.consumerOptions.push({
                id: 'opt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                label: v,
                icon: '🛒',
                hidden: !!(hiddenCb && hiddenCb.checked)
            });
            saveShared();
            input.value = '';
            if (hiddenCb) hiddenCb.checked = false;
            renderOpts();
        }
        m.querySelector('#ledger-add-opt-btn').addEventListener('click', addOpt);
        // 回车也能加，顺手的事
        m.querySelector('#ledger-add-opt-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addOpt(); } });
    }

    function renderOpts() {
        var el = document.getElementById('ledger-opts-chips');
        if (!el) return;
        function chipHtml(o, builtin) {
            return '<span class="ledger-chip">' + o.icon + ' ' + escapeHtml(o.label)
                + (o.hidden ? ' <span style="font-size:10px;color:var(--text-secondary,#999);">🔒隐藏</span>' : '')
                + (builtin ? '' : '<button type="button" class="ledger-chip-x" data-opt-del="' + o.id + '" title="删除"><i class="fas fa-times"></i></button>')
                + '</span>';
        }
        var html = '';
        BUILTIN_CONSUMER_OPTIONS.forEach(function (o) { html += chipHtml(o, true); });
        (shared.consumerOptions || []).forEach(function (o) { html += chipHtml(o, false); });
        el.innerHTML = html;
    }

    function openOptsModal() {
        buildOptsModal();
        renderOpts();
        var m = document.getElementById('ledger-shared-opts-modal');
        if (typeof showModal === 'function') showModal(m);
        else m.style.display = 'flex';
    }

    // 填充分类下拉（内置 + 自定义 + 新增入口），keep：要保留选中的值
    function fillCatSelect(keep) {
        var sel = document.getElementById('ledger-f-cat');
        if (!sel) return;
        var prev = (keep != null) ? keep : sel.value;
        var html = '';
        CATS.forEach(function (c) { html += '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</option>'; });
        if (cfg.customCats.length) {
            html += '<optgroup label="自定义">';
            cfg.customCats.forEach(function (n) { html += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; });
            html += '</optgroup>';
        }
        html += '<option value="__new__">＋ 新增类别…</option>';
        sel.innerHTML = html;
        sel.value = prev;
        if (!sel.value) sel.value = '其他';   // 原来的值不在列表里了（比如刚被删）
        syncCatDelBtn();
    }

    function syncCatDelBtn() {
        var sel = document.getElementById('ledger-f-cat');
        var btn = document.getElementById('ledger-f-cat-del');
        if (!sel || !btn) return;
        btn.style.display = cfg.customCats.indexOf(sel.value) > -1 ? 'flex' : 'none';
    }

    function findRec(id) {
        for (var i = 0; i < records.length; i++) if (records[i].id === id) return records[i];
        return null;
    }

    function shiftMonth(delta) {
        var d = new Date(viewYear, viewMonth + delta, 1);
        viewYear = d.getFullYear(); viewMonth = d.getMonth();
        renderAll();
    }

    function monthRecords() {
        var key = viewYear + '-' + viewMonth;
        return records.filter(function (r) { return monthKey(r.ts) === key; });
    }

    function renderToggle() {
        var btn = document.getElementById('ledger-auto-toggle');
        if (!btn) return;
        btn.textContent = cfg.auto ? '已开启' : '已关闭';
        btn.style.background = cfg.auto ? 'linear-gradient(135deg,#4caf50,#2e7d32)' : 'var(--secondary-bg,#aaa)';
        btn.style.color = cfg.auto ? '#fff' : 'var(--text-secondary,#888)';
    }

    function renderSharedToggle() {
        var btn = document.getElementById('ledger-shared-toggle');
        if (!btn) return;
        btn.textContent = shared.enabled ? '已开启' : '已关闭';
        btn.style.background = shared.enabled ? 'linear-gradient(135deg,#4caf50,#2e7d32)' : 'var(--secondary-bg,#aaa)';
        btn.style.color = shared.enabled ? '#fff' : 'var(--text-secondary,#888)';
    }

    function toggleShared() {
        shared.enabled = !shared.enabled;
        if (shared.enabled) {
            // 刚打开就重排一单，别把上次"欠的"立刻买出来吓人
            shared.nextCheckAt = Date.now() + sharedDelayMs();
            if (typeof showNotification === 'function') showNotification('共同记账已开启，他会时不时自己记上一笔', 'info', 2200);
        } else {
            shared.nextCheckAt = null;
            if (typeof showNotification === 'function') showNotification('共同记账已关闭，已有记录仍保留', 'info', 2000);
        }
        saveShared();
        scheduleSharedCheck();
        renderSharedToggle();
        renderAll();
    }

    function renderSummary(monthRecs) {
        var el = document.getElementById('ledger-summary');
        if (!el) return;
        if (!monthRecs.length) {
            el.innerHTML = '<div class="stats-empty-state" style="padding:16px 10px;"><div style="font-size:24px;opacity:.5;"><i class="fas fa-wallet"></i></div><p style="font-size:12px;margin-top:6px;">这个月还没有记录</p></div>';
            return;
        }
        var byCat = {};
        monthRecs.forEach(function (r) {
            if (!byCat[r.category]) byCat[r.category] = { total: 0, count: 0 };
            byCat[r.category].total += r.amount;
            byCat[r.category].count++;
        });
        var list = Object.keys(byCat).map(function (k) { return { name: k, total: byCat[k].total, count: byCat[k].count }; })
            .sort(function (a, b) { return b.total - a.total; });
        var maxVal = list[0].total;
        el.innerHTML = list.map(function (item, idx) {
            var c = catByName(item.name);
            var percent = Math.max(4, Math.round(item.total / maxVal * 100));
            return '<div class="rank-item">' +
                '<div class="rank-progress-bg" style="width:' + percent + '%;background:rgba(' + c.rgb + ',.16);"></div>' +
                '<div class="rank-info">' +
                    '<div class="rank-number">#' + (idx + 1) + '</div>' +
                    '<div class="rank-text"><i class="fas ' + c.icon + '" style="color:rgb(' + c.rgb + ');margin-right:6px;"></i>' + escapeHtml(item.name) +
                        ' <span style="font-size:11px;color:var(--text-secondary);font-weight:400;">' + item.count + '笔</span></div>' +
                    '<div class="rank-count">' + fmtMoney(item.total) + '</div>' +
                '</div></div>';
        }).join('');
    }

    function renderList(monthRecs) {
        var el = document.getElementById('ledger-list');
        if (!el) return;

        if (!records.length) {
            el.innerHTML = '<div class="stats-empty-state" style="padding:18px 10px;"><div style="font-size:26px;opacity:.5;"><i class="fas fa-pen-to-square"></i></div><p style="font-size:12px;margin-top:8px;">还没有任何记录<br>去聊天里说一句「午饭花了30」试试吧</p></div>';
            return;
        }
        if (!monthRecs.length) {
            el.innerHTML = '<div class="stats-empty-state" style="padding:16px 10px;"><p style="font-size:12px;">这个月暂无记录</p></div>';
            return;
        }

        var sorted = monthRecs.slice().sort(function (a, b) { return b.ts - a.ts; });
        var capped = sorted.length > 200;
        if (capped) sorted = sorted.slice(0, 200);

        var html = '';
        var lastDate = null;
        var dayTotal = 0;
        var now = new Date();
        var todayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();

        sorted.forEach(function (r, i) {
            var dk = dateKey(r.ts);
            var d = new Date(r.ts);
            if (dk !== lastDate) {
                lastDate = dk;
                dayTotal = 0;
                var label = (dk === todayKey ? '今天' : (d.getMonth() + 1) + '月' + d.getDate() + '日') + ' 周' + WEEK[d.getDay()];
                html += '<div class="ledger-date-head"><span>' + label + '</span><span class="ledger-day-sub" data-dk="' + dk + '"></span></div>';
            }
            dayTotal += r.amount;
            var c = catByName(r.category);
            var dsc = escapeHtml(r.desc || r.category);
            var full = escapeHtml((r.desc || r.category) + ' · ' + r.category + ' · ' + fmtMoney(r.amount));
            var authorName = r.author === 'partner' ? partnerNameLabel() : '我';
            html += '<div class="ledger-row" title="' + full + '">' +
                '<span class="ledger-cat-dot" style="background:linear-gradient(135deg,rgba(' + c.rgb + ',.9),rgba(' + c.rgb + ',.65));"><i class="fas ' + c.icon + '"></i></span>' +
                '<div class="ledger-row-main">' +
                    '<div class="ledger-row-desc">' + dsc + '</div>' +
                    '<div class="ledger-row-sub">' +
                        '<span class="ledger-author-tag' + (r.author === 'partner' ? ' ledger-author-partner' : '') + '">' + escapeHtml(authorName) + '</span>' +
                        escapeHtml(r.category) + (r.source === 'chat' ? ' · 聊天识别' : '') +
                    '</div>' +
                '</div>' +
                '<span class="ledger-row-amt">' + fmtMoney(r.amount) + '</span>' +
                '<button type="button" class="ledger-row-btn" data-act="edit" data-id="' + r.id + '" title="修改"><i class="fas fa-pen"></i></button>' +
                '<button type="button" class="ledger-row-btn" data-act="del" data-id="' + r.id + '" title="删除"><i class="fas fa-times"></i></button>' +
            '</div>';
            dayTotals[dk] = (dayTotals[dk] || 0) + r.amount;
        });

        // 日期小计回填
        Object.keys(dayTotals).forEach(function (k) {
            html = html.replace('data-dk="' + k + '"></span>', 'data-dk="' + k + '">' + fmtMoney(dayTotals[k]) + '</span>');
        });

        if (capped) html += '<div style="text-align:center;font-size:11px;color:var(--text-secondary);padding:8px;">仅显示最近200条</div>';
        el.innerHTML = html;
    }

    var dayTotals = {}; // 渲染期间的日期小计累积

    function renderAll() {
        var label = document.getElementById('ledger-month-label');
        if (label) label.textContent = viewYear + '年' + (viewMonth + 1) + '月';
        renderToggle();

        var monthRecs = monthRecords();
        var total = 0;
        monthRecs.forEach(function (r) { total += r.amount; });
        var totalEl = document.getElementById('ledger-total');
        if (totalEl) totalEl.innerHTML = monthRecs.length
            ? '本月支出 <b>' + fmtMoney(total) + '</b> · 共' + monthRecs.length + '笔'
            : '';

        renderSummary(monthRecs);
        dayTotals = {};
        renderList(monthRecs);
    }

    function showForm(editId) {
        _editingId = editId;
        var form = document.getElementById('ledger-form');
        var title = document.getElementById('ledger-form-title');
        var desc = document.getElementById('ledger-f-desc');
        var amount = document.getElementById('ledger-f-amount');
        var cat = document.getElementById('ledger-f-cat');
        var date = document.getElementById('ledger-f-date');
        if (!form) return;

        if (editId) {
            var r = findRec(editId);
            if (!r) return;
            title.textContent = '修改记录';
            desc.value = r.desc || '';
            amount.value = r.amount;
            cat.value = r.category;
            if (!cat.value) cat.value = '其他';   // 类别可能已被删
            var d = new Date(r.ts);
            date.value = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        } else {
            title.textContent = '记一笔';
            desc.value = '';
            amount.value = '';
            cat.value = '其他';
            var n = new Date();
            date.value = n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate());
        }
        syncCatDelBtn();
        form.style.display = 'block';
        if (typeof form.scrollIntoView === 'function') form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideForm() {
        var form = document.getElementById('ledger-form');
        if (form) form.style.display = 'none';
        _editingId = null;
    }

    function saveForm() {
        var desc = document.getElementById('ledger-f-desc');
        var amount = document.getElementById('ledger-f-amount');
        var cat = document.getElementById('ledger-f-cat');
        var date = document.getElementById('ledger-f-date');
        if (!desc || !amount || !cat || !date) return;

        var amt = parseFloat(amount.value);
        if (!isFinite(amt) || amt <= 0 || amt > 9999999) {
            if (typeof showNotification === 'function') showNotification('金额好像不太对～', 'warning', 2000);
            return;
        }
        var dv = date.value;
        var ts = Date.now();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dv)) {
            var parts = dv.split('-');
            ts = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0).getTime();
            if (isNaN(ts)) ts = Date.now();
        }
        var descV = String(desc.value || '').trim().slice(0, 20);
        var catV = (!cat.value || cat.value === '__new__') ? '其他' : catByName(cat.value).name;

        if (_editingId) {
            var r = findRec(_editingId);
            if (r) {
                r.amount = Math.round(amt * 100) / 100;
                r.category = catV;
                r.desc = descV;
                r.ts = ts;
                r.source = 'manual';
                saveSoon();
            }
        } else {
            addRecord({ amount: amt, category: catV, desc: descV }, 'manual', ts);
        }
        hideForm();
        renderAll();
        if (typeof showNotification === 'function') showNotification(_editingId ? '已修改' : '已记一笔 ✓ ' + fmtMoney(amt), 'success', 1800);
    }

    function open() {
        buildModal();
        var now = new Date();
        viewYear = now.getFullYear();
        viewMonth = now.getMonth();
        hideForm();
        if (!_loaded) loadAll(renderAll);
        else renderAll();
        var m = document.getElementById('ledger-modal');
        if (typeof showModal === 'function') showModal(m);
        else m.style.display = 'flex';
    }

    // ─── 启动 ──────────────────────────────────────────────────────
    function init() {
        loadAll();
        // 高级功能 → 实用工具 → 记账本 入口（index.html 中的 settings-item）
        var adv = document.getElementById('ledger-function');
        if (adv) adv.addEventListener('click', function () { open(); });
    }

    // 链式包裹 window._onUserMessage（陪伴模块在用，不能覆盖它，只能叠加）。
    // 必须在 companion.js 的 init 赋值之后再包：本文件在 index.html 里排在其后加载，
    // DOMContentLoaded 监听也注册在其后，因此执行顺序有保证；再加一层 setTimeout 兜底。
    function wrapUserHook() {
        var prev = window._onUserMessage;
        window._onUserMessage = function (m) {
            try { handleUserMessage(m); } catch (e) { console.warn('[ledger]', e); }
            if (typeof prev === 'function') { try { prev(m); } catch (e2) { console.warn('[ledger:prev]', e2); } }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            init();
            setTimeout(wrapUserHook, 0);
        });
    } else {
        setTimeout(function () { init(); wrapUserHook(); }, 60);
    }

    // 调试/外部入口
    window.Ledger = { open: open, detect: detectExpense };
})();
