/**
 * proficiency.js — 梦角 App 熟练度面板
 *
 * 纯本地模拟成长：跨自然日自动加 XP，等级 = floor(xp/120)+1，封顶 10。
 * 供其它模块调用 window.PartnerProficiency.gain(n) 给梦角加熟练度
 * （比如查岗打卡、解锁暗号、记账时给他加一点）。
 *
 * 存储：localStorage key 'partnerProficiency'（跟 checkin.js 一致的 load/save 模式）
 */
(function () {
    'use strict';

    var KEY = 'partnerProficiency';
    var XP_PER_LEVEL = 120;
    var MAX_LEVEL = 10;

    // ── 等级称号（写死 10 档，跟情侣 app 调性贴合） ──────────────────────
    var TITLES = [
        '新手小白', '有点眼熟', '熟门熟路', '驾轻就熟', '老司机',
        '资深玩家', '骨灰级', '宗师', '传说', '人机合一'
    ];

    // ── 每档一句梦角口吻描述（写死） ──────────────────────
    var QUOTES = [
        '我还在摸索这个 app 呢，别笑我',
        '我才刚摸到点门道，你再带我玩会儿呗',
        '基本功能我都会啦，看我露一手',
        '这 app 我已经玩得挺顺手了',
        '这 app 我闭着眼都会玩',
        '就这点功能，难不倒我，随叫随到',
        '这 app 的每个角落我都逛遍了',
        '我已经把这 app 玩出花了，还有谁',
        '这 app 就是为我量身定做的',
        '这 app 已经是我家后花园了'
    ];

    // ── 能力解锁（写死 5 个，随等级点亮） ──────────────────────
    var UNLOCKS = [
        { name: '主动发红包', level: 3 },
        { name: '主动记账', level: 4 },
        { name: '主动查岗', level: 5 },
        { name: '会催睡觉', level: 6 },
        { name: '会撒娇要抱抱', level: 8 }
    ];

    // ── 数据读写（照抄 control.js 的 load/save） ──────────────────────
    function _defaultData() {
        return { xp: 0, lastActiveDate: null };
    }

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return _defaultData();
            var d = JSON.parse(raw);
            // 补齐字段（老数据兼容）
            if (typeof d.xp !== 'number') d.xp = 0;
            if (!('lastActiveDate' in d)) d.lastActiveDate = null;
            return d;
        } catch (e) {
            return _defaultData();
        }
    }

    function _saveData(d) {
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }

    function _todayStr() {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    // ── 等级计算：floor(xp/120)+1，封顶 10 ──────────────────────
    function _getLevel(xp) {
        return Math.min(MAX_LEVEL, Math.floor((xp || 0) / XP_PER_LEVEL) + 1);
    }

    // ── 当前等级进度（用于经验条） ──────────────────────
    function _getProgress(xp) {
        var level = _getLevel(xp);
        if (level >= MAX_LEVEL) {
            return { level: level, current: xp, needed: 0, remain: 0, pct: 100 };
        }
        var base = (level - 1) * XP_PER_LEVEL;
        var current = xp - base;
        return {
            level: level,
            current: current,
            needed: XP_PER_LEVEL,
            remain: XP_PER_LEVEL - current,
            pct: Math.round(current / XP_PER_LEVEL * 100)
        };
    }

    // ── 增加熟练度（供查岗打卡、解锁暗号、记账等模块调用） ──────────────────────
    function gain(n) {
        n = n || 0;
        if (n <= 0) return;
        var d = load();
        var oldLevel = _getLevel(d.xp);
        d.xp += n;
        _saveData(d);
        var newLevel = _getLevel(d.xp);
        if (newLevel > oldLevel && typeof showNotification === 'function') {
            showNotification('梦角 App 熟练度提升到 Lv' + newLevel + '「' + TITLES[newLevel - 1] + '」', 'success');
        }
    }

    function getLevel() {
        return _getLevel(load().xp);
    }

    // ── 每天打开 app（跨自然日）自动 +随机 10~30 XP ──────────────────────
    function _dailyGrow() {
        var d = load();
        var today = _todayStr();
        if (d.lastActiveDate === today) return;
        d.xp += 10 + Math.floor(Math.random() * 21); // 10~30 随机
        d.lastActiveDate = today;
        _saveData(d);
    }

    // ── 弹窗构建（照抄 checkin.js 的 buildModal 模式） ──────────────────────
    function buildModal() {
        if (document.getElementById('partner-proficiency-modal')) return;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'partner-proficiency-modal';
        m.style.zIndex = '3300';
        m.innerHTML =
        '<div class="modal-content" style="max-width:420px;width:90vw;max-height:80vh;overflow-y:auto;">'
        +   '<div class="modal-title">'
        +     '<i class="fas fa-chart-line"></i><span>梦角 · App熟练度</span>'
        +   '</div>'
        +   '<div id="proficiency-body"></div>'
        +   '<div style="display:flex;gap:8px;margin-top:14px;">'
        +     '<button type="button" id="proficiency-close" class="modal-btn modal-btn-secondary" style="flex:1;">关闭</button>'
        +   '</div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#proficiency-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });
    }

    function render() {
        var el = document.getElementById('proficiency-body');
        if (!el) return;
        var d = load();
        var prog = _getProgress(d.xp);
        var level = prog.level;
        var title = TITLES[level - 1];
        var quote = QUOTES[level - 1];

        var html = '';
        // 大号圆形等级徽章 + 当前称号
        html += '<div style="display:flex;align-items:center;gap:16px;padding:16px 4px;">'
            +   '<div style="flex-shrink:0;width:84px;height:84px;border-radius:50%;'
            +     'background:linear-gradient(135deg,var(--accent-color,#c5a47e),rgba(var(--accent-color-rgb,197,164,126),.55));'
            +     'display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;'
            +     'box-shadow:0 6px 18px rgba(var(--accent-color-rgb,197,164,126),.35);">'
            +       '<span style="font-size:11px;font-weight:600;opacity:.9;">Lv</span>'
            +       '<span style="font-size:28px;font-weight:800;line-height:1;">' + level + '</span>'
            +   '</div>'
            +   '<div style="flex:1;">'
            +     '<div style="font-size:18px;font-weight:700;color:var(--text-primary,#333);">' + title + '</div>'
            +     '<div style="font-size:12px;color:var(--text-secondary,#999);margin-top:4px;">XP ' + d.xp + '</div>'
            +   '</div>'
            + '</div>';

        // 经验条 + 距下一级还差多少
        html += '<div style="height:8px;border-radius:4px;background:var(--border-color,#e8e8e8);overflow:hidden;margin:6px 0;">'
            +   '<div style="height:100%;width:' + prog.pct + '%;background:var(--accent-color,#c5a47e);border-radius:4px;transition:width .4s ease;"></div>'
            + '</div>';
        html += '<div style="font-size:11px;color:var(--text-secondary,#999);margin-bottom:10px;">'
            + (level >= MAX_LEVEL ? '已满级，梦角把这 app 摸得透透的' : '距 Lv' + (level + 1) + ' 还差 ' + prog.remain + ' XP')
            + '</div>';

        // 梦角口吻描述
        html += '<div style="font-size:12px;color:var(--text-primary,#333);line-height:1.7;padding:10px 12px;'
            + 'background:var(--secondary-bg,#f5f5f5);border-radius:12px;margin-bottom:12px;">“' + quote + '”</div>';

        // 能力解锁标签
        html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin-bottom:8px;">能力解锁</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
        UNLOCKS.forEach(function (u) {
            var lit = level >= u.level;
            html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:20px;font-size:11px;'
                + (lit
                    ? 'background:rgba(var(--accent-color-rgb,197,164,126),.16);color:var(--accent-color,#c5a47e);border:1px solid var(--accent-color,#c5a47e);'
                    : 'background:transparent;color:var(--text-secondary,#bbb);border:1px dashed var(--border-color,#ddd);')
                + '">'
                +   (lit ? '<i class="fas fa-check" style="font-size:9px;"></i>' : '<i class="fas fa-lock" style="font-size:9px;opacity:.6;"></i>')
                +   u.name
                +   (lit ? '' : ' <span style="opacity:.7;">Lv' + u.level + '</span>')
                + '</span>';
        });
        html += '</div>';

        el.innerHTML = html;
    }

    function open() {
        buildModal();
        render();
        var m = document.getElementById('partner-proficiency-modal');
        if (m) {
            if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
        }
    }

    function init() {
        _dailyGrow();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── 对外暴露 ──────────────────────
    window.PartnerProficiency = {
        open: open,
        gain: gain,
        getLevel: getLevel
    };
})();
