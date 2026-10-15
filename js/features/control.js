/**
 * control.js — 操控面板（难度 + 熟练度 + 随机封锁调度）
 *
 * 六档难度影响梦角查岗的语气和随机封锁的频率上限，全部直接可选，不需要解锁。
 * 熟练度（XP）通过完成查岗、解锁暗号、陪伴等积累（只作展示，不卡难度）。
 * 随机封锁调度照抄 redpacket.js 的 scheduler 思路：
 *   nextLockAt 持久化 → 30秒轮询 → 到点且条件满足就触发 LockScreen.start()。
 * 什么时候锁完全随机，不配置任何概率。
 *
 * 存储：localStorage key 'controlData'（跟 checkin.js 一致的 load/save 模式）
 */
(function () {
    'use strict';

    var KEY = 'controlData';

    // ── 难度六档（写死常量，全部直接可选、不用解锁） ──────────────────────
    // maxPerDay: 每天最多锁手机的次数上限；什么时候锁纯随机，档位只定上限
    var DIFFICULTIES = [
        { level: 1, name: '温柔引导', desc: '他很少锁你，每天最多 5 次', maxPerDay: 5 },
        { level: 2, name: '日常管教', desc: '日常关心你，每天最多 10 次', maxPerDay: 10 },
        { level: 3, name: '认真调教', desc: '锁得更勤，每天最多 15 次', maxPerDay: 15 },
        { level: 4, name: '严厉掌控', desc: '他说什么就是什么，每天最多 20 次', maxPerDay: 20 },
        { level: 5, name: '完全臣服', desc: '没有次数上限，他想锁就锁', maxPerDay: Infinity },
        { level: 6, name: '看他心情', desc: '完全随机 · 没有上限 · 什么时候锁全看他的心情', maxPerDay: Infinity }
    ];

    // ── 内置暗号库（不可删除，与用户库合并抽取） ──────────────────────
    // 抽取时如果 settings.partnerName 存在且不是默认"对方"，把"哥哥"动态替换成 partnerName
    var BUILTIN_PASSPHRASES = [
        '最喜欢哥哥', '哥哥说得对', '我最听话了',
        '你说什么都对', '离不开你', '只想粘着你'
    ];

    // ── XP 来源配置 ──────────────────────
    var XP_REWARDS = {
        'checkin': 5,
        'lock-passed': 20,
        'lock-failed': 2,
        'companion': 10
    };

    // ── 随机封锁调度状态 ──────────────────────
    // 今日已锁次数直接持久化在数据里（lockDate/lockCount），不再用内存计数

    // 用户改的昵称（设置→对方的名字），取不到就用"他"
    function _partnerName() {
        var n = (typeof settings !== 'undefined' && settings.partnerName) || '';
        return (n && n !== '对方') ? n : '他';
    }

    // ── 数据读写（照抄 checkin.js 的 load/save） ──────────────────────
    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return _defaultData();
            var d = JSON.parse(raw);
            // 补齐字段（老数据兼容）
            if (!d.stats) d.stats = { tasksDone: 0, locksPassed: 0, locksFailed: 0, streakDays: 0, lastActiveDate: null };
            if (!Array.isArray(d.passphraseBank)) d.passphraseBank = [];
            return d;
        } catch (e) {
            return _defaultData();
        }
    }

    function _defaultData() {
        return {
            difficulty: 2,
            xp: 0,
            stats: { tasksDone: 0, locksPassed: 0, locksFailed: 0, streakDays: 0, lastActiveDate: null },
            passphraseBank: [],
            nextLockAt: null
        };
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) {}
    }

    function _saveData(d) {
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }

    // ── 等级计算 ──────────────────────
    function _getLevel(xp) {
        return Math.min(9, Math.floor((xp || 0) / 100) + 1);
    }

    function _getLevelProgress(xp) {
        var level = _getLevel(xp);
        if (level >= 9) return { level: 9, current: xp, needed: 0, pct: 100 };
        var baseXp = (level - 1) * 100;
        var current = xp - baseXp;
        return { level: level, current: current, needed: 100, pct: Math.round(current / 100 * 100) };
    }

    // ── 当前难度配置 ──────────────────────
    function _getDifficultyCfg() {
        var d = load();
        var lvl = DIFFICULTIES.find(function (x) { return x.level === d.difficulty; });
        return lvl || DIFFICULTIES[0];
    }

    // ── 暗号抽取（内置 + 用户自定义，"哥哥"动态替换成 partnerName） ──────────────────────
    function _pickPassphrase() {
        var d = load();
        var name = (typeof settings !== 'undefined' && settings.partnerName && settings.partnerName !== '对方')
            ? settings.partnerName : null;
        var pool = BUILTIN_PASSPHRASES.concat(d.passphraseBank || []).map(function (p) {
            return name ? p.replace(/哥哥/g, name) : p;
        });
        // 去重
        pool = pool.filter(function (v, i, a) { return a.indexOf(v) === i; });
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // ── XP 增加统一入口 ──────────────────────
    function onTaskDone(type) {
        var xpGain = XP_REWARDS[type] || 0;
        if (!xpGain) return;
        var d = load();
        var oldLevel = _getLevel(d.xp);
        d.xp += xpGain;

        // 统计
        if (type === 'checkin') d.stats.tasksDone++;
        else if (type === 'lock-passed') d.stats.locksPassed++;
        else if (type === 'lock-failed') d.stats.locksFailed++;

        // 连续活跃天数
        var today = _todayStr();
        if (d.stats.lastActiveDate !== today) {
            var yesterday = _dateStr(Date.now() - 86400000);
            d.stats.streakDays = (d.stats.lastActiveDate === yesterday) ? (d.stats.streakDays + 1) : 1;
            d.stats.lastActiveDate = today;
        }

        _saveData(d);

        var newLevel = _getLevel(d.xp);
        if (newLevel > oldLevel) {
            if (typeof showNotification === 'function') {
                showNotification('操控熟练度提升到 Lv ' + newLevel + ' ✓', 'success');
            }
        }
    }

    function _todayStr() { return _dateStr(Date.now()); }
    function _dateStr(ts) {
        var d = new Date(ts);
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    // ── 获取查岗语气风格（给后续 checkin 联动用） ──────────────────────
    function getNagStyle() {
        var diff = _getDifficultyCfg().level;
        // 看他心情：连语气都随机， soft / normal / strict 抽到哪个是哪个
        if (diff === 6) return ['soft', 'normal', 'strict'][Math.floor(Math.random() * 3)];
        if (diff <= 2) return 'soft';
        if (diff <= 3) return 'normal';
        return 'strict';
    }

    function getDifficulty() {
        return load().difficulty;
    }

    // ── 弹窗构建（照抄 checkin.js 的 buildModal 模式） ──────────────────────
    function buildModal() {
        if (document.getElementById('control-modal')) return;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'control-modal';
        m.style.zIndex = '3300';
        m.innerHTML =
        '<div class="modal-content" style="max-width:420px;width:90vw;max-height:80vh;overflow-y:auto;">'
        +   '<div class="modal-title">'
        +     '<i class="fas fa-masks-theater"></i><span>操控 · 熟练度</span>'
        +   '</div>'
        +   '<div id="ctrl-mastery"></div>'
        +   '<div id="ctrl-difficulty" style="margin-top:14px;"></div>'
        +   '<div id="ctrl-passphrases" style="margin-top:14px;"></div>'
        +   '<div style="display:flex;gap:8px;margin-top:14px;">'
        +     '<button type="button" id="ctrl-lock-partner" style="flex:1;padding:10px;border:none;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;background:#9a86e8;color:#fff;">把他锁起来</button>'
        +     '<button type="button" id="ctrl-close" class="modal-btn modal-btn-secondary" style="flex:0 0 auto;">关闭</button>'
        +   '</div>'
        +   '<div id="ctrl-footer-hint" style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;"></div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#ctrl-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });
        m.querySelector('#ctrl-lock-partner').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m);
            if (window.LockScreen && typeof window.LockScreen.lockPartner === 'function') {
                window.LockScreen.lockPartner();
            }
        });
    }

    // ── 渲染熟练度卡 ──────────────────────
    function renderMastery() {
        var el = document.getElementById('ctrl-mastery');
        if (!el) return;
        var d = load();
        var prog = _getLevelProgress(d.xp);

        var html = '<div style="background:var(--primary-bg,transparent);border:1px solid var(--border-color,#e8e8e8);border-radius:14px;padding:14px;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
            +   '<span style="font-size:15px;font-weight:700;color:var(--text-primary,#333);">熟练度 Lv' + prog.level + '</span>'
            +   '<span style="font-size:11px;color:var(--text-secondary,#999);">XP ' + d.xp + '</span>'
            + '</div>'
            + '<div style="height:8px;border-radius:4px;background:var(--border-color,#e8e8e8);overflow:hidden;margin-bottom:6px;">'
            +   '<div style="height:100%;width:' + prog.pct + '%;background:var(--accent-color,#c5a47e);border-radius:4px;transition:width .4s ease;"></div>'
            + '</div>'
            + '<div style="font-size:11px;color:var(--text-secondary,#999);">';
        if (prog.level >= 9) {
            html += '已满级，你是真正的乖孩子';
        } else {
            html += '距 Lv' + (prog.level + 1) + ' 还差 ' + (100 - prog.current) + ' XP';
        }
        html += '</div>'
            + '<div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text-secondary,#888);">'
            +   '<span>完成指令 ' + (d.stats.tasksDone || 0) + '</span>'
            +   '<span>暗号通过 ' + (d.stats.locksPassed || 0) + '</span>'
            +   '<span>失败 ' + (d.stats.locksFailed || 0) + '</span>'
            +   '<span>连续 ' + (d.stats.streakDays || 0) + ' 天</span>'
            + '</div>'
            + '</div>';
        el.innerHTML = html;
    }

    // ── 渲染难度选择（六档全部直接可选，不用解锁） ──────────────────────
    function renderDifficulty() {
        var el = document.getElementById('ctrl-difficulty');
        if (!el) return;
        var d = load();

        var html = '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin-bottom:8px;">难度等级</div>';
        DIFFICULTIES.forEach(function (diff) {
            var selected = d.difficulty === diff.level;
            var bg = selected ? 'background:rgba(var(--accent-color-rgb,197,164,126),.14);border-color:var(--accent-color,#c5a47e);'
                : 'background:var(--primary-bg,transparent);border:1px solid var(--border-color,#e8e8e8);';
            html += '<div class="ctrl-diff-row" data-level="' + diff.level + '" '
                + 'style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;margin-bottom:6px;cursor:pointer;' + bg + 'border:1px solid '
                + (selected ? 'var(--accent-color,#c5a47e)' : 'var(--border-color,#e8e8e8)') + ';">'
                +   '<div style="flex:1;">'
                +     '<div style="font-size:13px;font-weight:600;color:var(--text-primary,#333);">' + diff.name + '</div>'
                +     '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:2px;">' + diff.desc + '</div>'
                +   '</div>'
                +   (selected ? '<i class="fas fa-check" style="color:var(--accent-color,#c5a47e);font-size:14px;"></i>' : '')
                + '</div>';
        });
        el.innerHTML = html;

        // 绑定点击
        el.querySelectorAll('.ctrl-diff-row').forEach(function (row) {
            row.addEventListener('click', function () {
                var level = parseInt(row.getAttribute('data-level'));
                var diff = DIFFICULTIES.find(function (x) { return x.level === level; });
                var d2 = load();
                d2.difficulty = level;
                _saveData(d2);
                renderDifficulty();
                if (typeof showNotification === 'function') {
                    showNotification('已切换为「' + diff.name + '」', 'success', 1500);
                }
            });
        });
    }

    // ── 渲染暗号库管理 ──────────────────────
    function renderPassphrases() {
        var el = document.getElementById('ctrl-passphrases');
        if (!el) return;
        var d = load();
        var userBank = d.passphraseBank || [];

        var html = '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin-bottom:8px;">自定义暗号</div>';
        if (userBank.length === 0) {
            html += '<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:8px 0;">还没有自定义暗号，' + _partnerName() + '会用内置暗号考你</div>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
            userBank.forEach(function (p, i) {
                html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:20px;'
                    + 'background:var(--secondary-bg,#f5f5f5);font-size:12px;color:var(--text-primary,#333);">'
                    + p
                    + '<i class="fas fa-times ctrl-del-pass" data-idx="' + i + '" style="cursor:pointer;color:var(--text-secondary,#ccc);font-size:10px;"></i>'
                    + '</span>';
            });
            html += '</div>';
        }
        html += '<div style="display:flex;gap:6px;">'
            +   '<input id="ctrl-pass-input" type="text" placeholder="添加暗号，如：他是最好的" style="flex:1;padding:8px 10px;border:1px solid var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-primary,#333);outline:none;" />'
            +   '<button type="button" id="ctrl-pass-add" style="padding:8px 12px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;">添加</button>'
            + '</div>';
        el.innerHTML = html;

        el.querySelector('#ctrl-pass-add').addEventListener('click', function () {
            var input = el.querySelector('#ctrl-pass-input');
            var val = (input.value || '').trim();
            if (!val) return;
            var d2 = load();
            if (!Array.isArray(d2.passphraseBank)) d2.passphraseBank = [];
            d2.passphraseBank.push(val);
            _saveData(d2);
            renderPassphrases();
        });

        el.querySelectorAll('.ctrl-del-pass').forEach(function (icon) {
            icon.addEventListener('click', function () {
                var idx = parseInt(icon.getAttribute('data-idx'));
                var d2 = load();
                d2.passphraseBank.splice(idx, 1);
                _saveData(d2);
                renderPassphrases();
            });
        });
    }

    function _renderAll() {
        renderMastery();
        renderDifficulty();
        renderPassphrases();
    }

    // 按钮/说明里的名字跟着用户改的昵称走（弹窗是缓存的，每次打开都要重刷）
    function _applyNames() {
        var name = _partnerName();
        var lockPartner = document.getElementById('ctrl-lock-partner');
        var hint = document.getElementById('ctrl-footer-hint');
        if (lockPartner) lockPartner.textContent = '把' + name + '锁起来';
        if (hint) hint.textContent = '他会在随机时刻主动锁你（首次很快就会遇到），切回 App 到点即锁；难度只定每天次数上限，锁上的瞬间会发手机通知。';
    }

    function open() {
        buildModal();
        _applyNames();
        _renderAll();
        var m = document.getElementById('control-modal');
        if (m) {
            if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
        }
    }

    // ── 随机封锁调度（setTimeout 精确调度 + 30 秒兜底 + 回前台立即补检） ──────────────────────
    // 什么时候锁完全随机，不配置任何概率；难度档位只决定每天的次数上限。
    // 旧版只靠 30 秒轮询且首次就要等 20 分钟~2 小时，App 使用时长短时几乎永远遇不到——
    // 现在：从没遇到过锁的用户首次只等 3~20 分钟；页面关掉时间照走，
    // 重新打开或切回前台时发现到点立刻补锁，不再依赖轮询碰运气。
    var _lockTimer = null;

    function _firstLockDelayMs() { return (3 + Math.random() * 17) * 60000; }      // 首次：3~20 分钟
    function _nextLockDelayMs() {
        // 常规档：20 分钟~6 小时均匀随机；
        // 「看他心情」连节奏都不让你摸透：2 分钟~10 小时均匀随机
        if (load().difficulty === 6) return (2 + Math.random() * 598) * 60000;
        return (20 + Math.random() * 340) * 60000;
    }

    // 今日已锁次数（持久化，重启 App 不重置）
    function _bumpTodayCount(d) {
        var today = _todayStr();
        if (d.lockDate !== today) { d.lockDate = today; d.lockCount = 0; }
        d.lockCount = (d.lockCount || 0) + 1;
    }
    function _todayCount(d) {
        return d.lockDate === _todayStr() ? (d.lockCount || 0) : 0;
    }

    // 到点后尝试真的锁；条件不满足就把下一次时间排好
    function _fireIfPossible() {
        var d = load();
        // 还没到点：按剩余时间精确排闹钟
        if (d.nextLockAt && Date.now() < d.nextLockAt) { _scheduleLock(); return; }
        // 页面不在前台：不锁，等 visibilitychange 回前台时立刻再试
        if (document.hidden) return;
        // 暗号锁当前激活：顺延 10 分钟后再看
        if (window.LockScreen && typeof window.LockScreen.isActive === 'function' && window.LockScreen.isActive()) {
            d.nextLockAt = Date.now() + 10 * 60000;
            _saveData(d);
            _scheduleLock();
            return;
        }
        // 今天封锁次数到上限：排到明天 0~3 小时内
        var diff = _getDifficultyCfg();
        if (_todayCount(d) >= diff.maxPerDay) {
            var tomorrow = new Date();
            tomorrow.setHours(0, 0, 0, 0);
            tomorrow.setDate(tomorrow.getDate() + 1);
            d.nextLockAt = tomorrow.getTime() + Math.random() * 3 * 3600000;
            _saveData(d);
            _scheduleLock();
            return;
        }

        // 条件全满足，触发封锁！
        _bumpTodayCount(d);
        d.everLocked = true;
        d.nextLockAt = Date.now() + _nextLockDelayMs();
        _saveData(d);
        try {
            if (window.LockScreen && typeof window.LockScreen.start === 'function') {
                window.LockScreen.start();
            }
        } catch (e) { console.warn('[control] 触发封锁失败:', e); }
        _scheduleLock();
    }

    function _scheduleLock() {
        if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null; }
        var d = load();
        // 老用户迁移：从没遇到过主动锁（旧版首次要等 20 分钟~2 小时，使用时长短永远遇不到），
        // 把首次时间收紧到 3~20 分钟内
        var neverLocked = !d.everLocked && !(d.stats && (d.stats.locksPassed || d.stats.locksFailed));
        if (d.nextLockAt && neverLocked && d.nextLockAt > Date.now() + 20 * 60000) {
            d.nextLockAt = Date.now() + _firstLockDelayMs();
            _saveData(d);
        }
        if (!d.nextLockAt) {
            // 从没锁过的人首次很快就能遇到一次；之后按档位宽随机
            d.nextLockAt = Date.now() + (neverLocked ? _firstLockDelayMs() : _nextLockDelayMs());
            _saveData(d);
        }
        var delay = d.nextLockAt - Date.now();
        if (delay <= 0) {
            // 已过期：5 秒后补锁（给页面加载/聊天数据恢复留点时间）
            _lockTimer = setTimeout(_fireIfPossible, 5000);
        } else {
            // setTimeout 最大延迟约 24.8 天，这里最长 10 小时，安全
            _lockTimer = setTimeout(_fireIfPossible, delay);
        }
    }

    function initScheduler() {
        _scheduleLock();
        // 30 秒兜底轮询：极端情况下（系统改时间、timer 被 WebView 吞掉）也能自愈
        setInterval(function () {
            var d = load();
            if (d.nextLockAt && Date.now() >= d.nextLockAt) _fireIfPossible();
        }, 30000);
        // 切回前台立刻检查：后台期间到点的锁，一回来就补，不用等轮询
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                var d = load();
                if (d.nextLockAt && Date.now() >= d.nextLockAt) _fireIfPossible();
            }
        });
    }

    // ── 初始化 ──────────────────────
    function init() {
        // nextLockAt / 首次延迟都由 _scheduleLock 内部决定
        initScheduler();
        // 高级功能 → 实用工具 → 操控面板 入口
        var adv = document.getElementById('control-function');
        if (adv) adv.addEventListener('click', function () { open(); });
    }

    // 页面加载完后启动调度
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── 对外暴露 ──────────────────────
    window.Control = {
        open: open,
        onTaskDone: onTaskDone,
        getDifficulty: getDifficulty,
        getNagStyle: getNagStyle,
        _pickPassphrase: _pickPassphrase
    };
})();
