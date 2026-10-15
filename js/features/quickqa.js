/**
 * quickqa.js — 快问快答
 *
 * 两个玩法：
 *   1. 我问他：出一道填空题或选择题发到聊天流，他在限时内回答。
 *      选择题他随机选一个选项；填空题他从「他的快答」字卡组里抽一句。
 *   2. 他问我：从内置题库随机出一道题（也是填空/选择两种），
 *      我在限时内作答，超时算他赢，他阴阳怪气两句。
 *
 * 回答时限可调：1~120 秒，默认 60 秒。
 *
 * 入口：输入区「+」更多菜单 → 快问快答
 * 存储：localStorage 'quickQAData' { answerSec, history:[] }（最多留 30 条）
 */
(function () {
    'use strict';

    var KEY = 'quickQAData';
    var DEFAULT_SEC = 60;
    var MIN_SEC = 1;
    var MAX_SEC = 120;
    var HISTORY_MAX = 30;

    // ── 他问我的内置题库：type 'choice' 带选项，'fill' 是填空 ──────────────────────
    var QUESTION_BANK = [
        { type: 'choice', q: '今天想我了没？', options: ['想了', '特别想', '一直在想', '没有（才怪）'] },
        { type: 'choice', q: '周末想跟我干什么？', options: ['宅家贴贴', '出门逛街', '看电影', '吃好吃的'] },
        { type: 'choice', q: '奶茶要几分糖？', options: ['全糖', '七分', '半糖', '三分', '无糖'] },
        { type: 'choice', q: '我是不是很可爱？', options: ['是', '特别可爱', '全天下最可爱', '一般（才怪）'] },
        { type: 'choice', q: '今晚早点睡好不好？', options: ['好', '再玩五分钟', '马上睡', '你先睡'] },
        { type: 'choice', q: '先有鸡还是先有蛋？', options: ['鸡', '蛋', '不知道', '先有你'] },
        { type: 'choice', q: '更喜欢我对你笑还是对我撒娇？', options: ['笑', '撒娇', '都要', '闭眼选你'] },
        { type: 'choice', q: '吵架了谁先低头？', options: ['我先', '你先', '石头剪刀布', '不存在吵架'] },
        { type: 'fill', q: '用一句话形容我？' },
        { type: 'fill', q: '你今天心情怎么样？' },
        { type: 'fill', q: '最喜欢我哪一点？' },
        { type: 'fill', q: '今天吃了什么好吃的？' },
        { type: 'fill', q: '如果周末只能做一件事，你想做什么？' },
        { type: 'fill', q: '现在最想对我说什么？' },
        { type: 'fill', q: '今天有什么烦心事吗？' },
        { type: 'fill', q: '下次约会你想去哪？' }
    ];

    // ── 台词池 ──────────────────────
    var MY_Q_PREFIX = ['快问快答！', '限时抢答：', '考考你：', '快答，不许想太久：'];
    var TIMEOUT_LINES = [
        '时间到！你刚刚是不是走神了？',
        '超时了哦，这题算我赢',
        '喂，人呢？倒计时都跑完了',
        '算了算了，我自己去想答案了'
    ];
    var FAST_LINES = [
        '反应挺快嘛，奖励一个抱抱',
        '答得不错，就喜欢你这个速度',
        '这速度，看来心里有我',
        '好快的回答，我还没准备好夸你'
    ];

    // ── 存取 ──────────────────────
    function load() {
        try {
            var d = JSON.parse(localStorage.getItem(KEY));
            if (!d || typeof d !== 'object') d = {};
            if (typeof d.answerSec !== 'number' || d.answerSec < MIN_SEC || d.answerSec > MAX_SEC) d.answerSec = DEFAULT_SEC;
            if (!Array.isArray(d.history)) d.history = [];
            return d;
        } catch (e) {
            return { answerSec: DEFAULT_SEC, history: [] };
        }
    }

    function save(d) {
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    function _partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }

    // ── 往聊天流里说话（我 / 他两种身份） ──────────────────────
    function _say(text, who) {
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
                type: 'normal'
            });
            if (typeof playSound === 'function') playSound(who === 'me' ? 'send' : 'message');
        } catch (e) {}
    }

    function _record(entry) {
        var d = load();
        d.history.unshift(entry);
        if (d.history.length > HISTORY_MAX) d.history.length = HISTORY_MAX;
        save(d);
        renderHistory();
    }

    // ── 他的快答字卡池（兜底内置） ──────────────────────
    function _getAnswerPool() {
        if (typeof window._getQAAnswerPool === 'function') {
            try {
                var pool = window._getQAAnswerPool();
                if (pool && pool.length) return pool;
            } catch (e) {}
        }
        return ['当然想你了', '这还用问吗', '你猜？', '答案跟你有关', '这题我会：想你'];
    }

    // ── 玩法一：我问他 ──────────────────────
    function askHim(type, question, options) {
        var d = load();
        var sec = d.answerSec;
        var prefix = pick(MY_Q_PREFIX);
        var text = type === 'choice'
            ? prefix + question + '（' + options.join(' / ') + '）'
            : prefix + question;
        _say(text, 'me');

        // 他在限时内的某个随机时刻回答（至少 1 秒，最快也要 0.8~2 秒才显得像在打字）
        var delay = Math.max(800 + Math.random() * 1500, Math.random() * sec * 1000);
        if (sec <= 3) delay = 600 + Math.random() * sec * 400;

        setTimeout(function () {
            var answer = type === 'choice' ? '我选「' + pick(options) + '」' : pick(_getAnswerPool());
            _say(answer, 'him');
            _record({ ts: Date.now(), who: 'me', q: question, type: type, a: answer });
        }, delay);

        if (typeof showNotification === 'function') {
            showNotification('问题已发出，限时 ' + sec + ' 秒，等他答～');
        }
    }

    // ── 玩法二：他问我 ──────────────────────
    var _answering = null; // 当前进行中的他问我 { question, type, options, timer, deadline }

    function heAsks() {
        if (_answering) return; // 已经有一题在进行
        var d = load();
        var sec = d.answerSec;
        var question = pick(QUESTION_BANK);
        _answering = { question: question, type: question.type, options: question.options || [], deadline: Date.now() + sec * 1000 };

        var text = question.type === 'choice'
            ? pick(MY_Q_PREFIX) + question.q + '（' + question.options.join(' / ') + '）'
            : pick(MY_Q_PREFIX) + question.q;
        _say(text, 'him');

        renderAnswering();
        if (typeof showNotification === 'function') {
            showNotification('他出题了！限时 ' + sec + ' 秒，快答！');
        }

        _answering.timer = setTimeout(function () {
            if (!_answering) return;
            _say(pick(TIMEOUT_LINES), 'him');
            _record({ ts: Date.now(), who: 'him', q: question.q, type: question.type, a: null });
            _answering = null;
            renderAnswering();
            renderHistory();
        }, sec * 1000);
    }

    function answerHim(answer) {
        if (!_answering) return;
        clearTimeout(_answering.timer);
        var q = _answering.question.q;
        var type = _answering.type;
        var elapsed = Math.round((Date.now() - (_answering.deadline - load().answerSec * 1000)) / 1000);
        _answering = null;
        renderAnswering();

        _say(answer, 'me');
        // 答得快（一半时间内答完）他会夸，否则慢悠悠回一句
        setTimeout(function () {
            if (elapsed <= load().answerSec / 2) {
                _say(pick(FAST_LINES), 'him');
            } else {
                _say('嗯……算你答对了，下次快点', 'him');
            }
        }, 900 + Math.random() * 1200);
        _record({ ts: Date.now(), who: 'him', q: q, type: type, a: answer });
    }

    // ── UI ──────────────────────
    function buildModal() {
        if (document.getElementById('qa-modal')) return;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'qa-modal';
        m.style.zIndex = '3300';
        m.innerHTML =
        '<div class="modal-content" style="max-width:420px;width:90vw;">'
        +   '<div class="modal-title"><i class="fas fa-bolt"></i><span>快问快答</span></div>'
        +   '<div id="qa-answering"></div>'
        +   '<div style="display:flex;gap:8px;margin-bottom:10px;">'
        +     '<button type="button" id="qa-he-asks" style="flex:1;padding:10px;border:none;border-radius:12px;background:var(--accent-color,#c5a47e);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">'
        +       '<i class="fas fa-question" style="margin-right:5px;"></i>让他问我'
        +     '</button>'
        +   '</div>'
        +   '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin:10px 0 6px;">我问他</div>'
        +   '<div style="display:flex;gap:8px;margin-bottom:8px;">'
        +     '<button type="button" id="qa-type-fill" style="flex:1;padding:8px 0;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border-color,#ddd);background:transparent;color:var(--text-primary,#333);">填空题</button>'
        +     '<button type="button" id="qa-type-choice" style="flex:1;padding:8px 0;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border-color,#ddd);background:transparent;color:var(--text-primary,#333);">选择题</button>'
        +   '</div>'
        +   '<input type="text" id="qa-question-input" placeholder="输入问题（比如：今天想我了没？）" style="width:100%;padding:10px 12px;border:1px solid var(--border-color,#ddd);border-radius:10px;font-size:13px;background:transparent;color:var(--text-primary,#333);margin-bottom:8px;box-sizing:border-box;">'
        +   '<div id="qa-options-box" style="display:none;flex-direction:column;gap:6px;margin-bottom:8px;">'
        +     '<input type="text" class="qa-option-input" placeholder="选项 A" style="padding:8px 12px;border:1px solid var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-primary,#333);box-sizing:border-box;">'
        +     '<input type="text" class="qa-option-input" placeholder="选项 B" style="padding:8px 12px;border:1px solid var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-primary,#333);box-sizing:border-box;">'
        +     '<button type="button" id="qa-add-option" style="align-self:flex-start;padding:5px 10px;border:1px dashed var(--border-color,#ddd);border-radius:8px;font-size:11px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-plus"></i> 加一个选项</button>'
        +   '</div>'
        +   '<button type="button" id="qa-send" style="width:100%;padding:11px;border:none;border-radius:12px;background:var(--accent-color,#c5a47e);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">发给他，限时抢答！</button>'
        +   '<div style="display:flex;align-items:center;gap:8px;margin-top:12px;">'
        +     '<span style="font-size:12px;color:var(--text-secondary,#888);flex-shrink:0;">回答时限</span>'
        +     '<input type="range" id="qa-sec-range" min="1" max="120" step="1" style="flex:1;accent-color:var(--accent-color,#c5a47e);">'
        +     '<span id="qa-sec-val" style="font-size:12px;font-weight:700;color:var(--accent-color,#c5a47e);min-width:38px;text-align:right;">60s</span>'
        +   '</div>'
        +   '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin:12px 0 6px;">问答记录</div>'
        +   '<div id="qa-history" style="max-height:24vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>'
        +   '<div style="display:flex;gap:8px;margin-top:12px;">'
        +     '<button type="button" id="qa-manage-cards" style="flex:1;padding:9px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-comment-dots"></i> 他的快答字卡</button>'
        +     '<button type="button" id="qa-close" class="modal-btn modal-btn-secondary" style="flex:0 0 auto;">关闭</button>'
        +   '</div>'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;">'
        +     '我问他：填空题他从「他的快答」字卡组抽一句答；选择题他随机选一项。<br>'
        +     '他问我：从内置题库随机出题，你超时没答算他赢。时限 1~120 秒可调。'
        +   '</div>'
        + '</div>';
        document.body.appendChild(m);

        var state = { type: 'fill' };

        function syncTypeBtns() {
            var fillBtn = m.querySelector('#qa-type-fill');
            var choiceBtn = m.querySelector('#qa-type-choice');
            var opts = m.querySelector('#qa-options-box');
            [fillBtn, choiceBtn].forEach(function (b) {
                b.style.borderColor = 'var(--border-color,#ddd)';
                b.style.background = 'transparent';
                b.style.color = 'var(--text-primary,#333)';
            });
            var active = state.type === 'fill' ? fillBtn : choiceBtn;
            active.style.borderColor = 'var(--accent-color,#c5a47e)';
            active.style.background = 'rgba(var(--accent-color-rgb,197,164,126),.16)';
            active.style.color = 'var(--accent-color,#c5a47e)';
            opts.style.display = state.type === 'choice' ? 'flex' : 'none';
        }

        m.querySelector('#qa-type-fill').addEventListener('click', function () { state.type = 'fill'; syncTypeBtns(); });
        m.querySelector('#qa-type-choice').addEventListener('click', function () { state.type = 'choice'; syncTypeBtns(); });

        m.querySelector('#qa-add-option').addEventListener('click', function () {
            var box = m.querySelector('#qa-options-box');
            var inputs = box.querySelectorAll('.qa-option-input');
            if (inputs.length >= 5) return;
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'qa-option-input';
            inp.placeholder = '选项 ' + String.fromCharCode(65 + inputs.length);
            inp.style.cssText = 'padding:8px 12px;border:1px solid var(--border-color,#ddd);border-radius:10px;font-size:12px;background:transparent;color:var(--text-primary,#333);box-sizing:border-box;';
            box.insertBefore(inp, m.querySelector('#qa-add-option'));
        });

        m.querySelector('#qa-send').addEventListener('click', function () {
            var q = (m.querySelector('#qa-question-input').value || '').trim();
            if (!q) { if (typeof showNotification === 'function') showNotification('先输入问题呀'); return; }
            if (state.type === 'choice') {
                var opts = [];
                m.querySelectorAll('.qa-option-input').forEach(function (i) {
                    var v = (i.value || '').trim();
                    if (v) opts.push(v);
                });
                if (opts.length < 2) { if (typeof showNotification === 'function') showNotification('选择题至少要 2 个选项'); return; }
                askHim('choice', q, opts);
            } else {
                askHim('fill', q, null);
            }
            m.querySelector('#qa-question-input').value = '';
            m.querySelectorAll('.qa-option-input').forEach(function (i) { i.value = ''; });
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });

        m.querySelector('#qa-he-asks').addEventListener('click', heAsks);

        m.querySelector('#qa-sec-range').addEventListener('input', function () {
            var d = load();
            d.answerSec = Math.max(MIN_SEC, Math.min(MAX_SEC, parseInt(this.value, 10) || DEFAULT_SEC));
            save(d);
            m.querySelector('#qa-sec-val').textContent = d.answerSec + 's';
        });

        m.querySelector('#qa-manage-cards').addEventListener('click', function () {
            try {
                if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
                if (typeof currentMajorTab !== 'undefined') { currentMajorTab = 'atmosphere'; currentSubTab = 'qaAnswers'; }
                if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
                var libModal = document.getElementById('custom-replies-modal');
                if (libModal && typeof showModal === 'function') showModal(libModal);
            } catch (e) { console.warn('[qa] 打开快答字卡失败:', e); }
        });

        m.querySelector('#qa-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });

        syncTypeBtns();
    }

    // ── 他问我进行中的作答区（含倒计时） ──────────────────────
    var _countdownTimer = null;

    function renderAnswering() {
        var box = document.getElementById('qa-answering');
        if (!box) return;
        if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
        if (!_answering) { box.innerHTML = ''; return; }

        var q = _answering.question;
        var html =
            '<div style="padding:12px;border-radius:14px;margin-bottom:10px;'
            + 'background:rgba(var(--accent-color-rgb,197,164,126),.10);border:1px solid rgba(var(--accent-color-rgb,197,164,126),.3);">'
            +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
            +     '<span style="font-size:12px;font-weight:700;color:var(--accent-color,#c5a47e);">他正在问你</span>'
            +     '<span id="qa-countdown" style="font-size:16px;font-weight:800;color:var(--accent-color,#c5a47e);"></span>'
            +   '</div>'
            +   '<div style="font-size:14px;font-weight:600;color:var(--text-primary,#333);margin-bottom:10px;">' + q.q + '</div>';

        if (_answering.type === 'choice' && _answering.options && _answering.options.length) {
            html += '<div id="qa-answer-options" style="display:flex;flex-wrap:wrap;gap:6px;">';
            _answering.options.forEach(function (opt) {
                html += '<button type="button" class="qa-opt-btn" data-v="' + opt.replace(/"/g, '&quot;') + '" style="padding:8px 14px;border-radius:20px;border:1px solid var(--accent-color,#c5a47e);background:transparent;color:var(--accent-color,#c5a47e);font-size:12px;font-weight:600;cursor:pointer;">' + opt + '</button>';
            });
            html += '</div>';
        } else {
            html += '<div style="display:flex;gap:6px;">'
                +   '<input type="text" id="qa-answer-input" placeholder="快写下你的答案…" style="flex:1;padding:9px 12px;border:1px solid var(--border-color,#ddd);border-radius:10px;font-size:13px;background:transparent;color:var(--text-primary,#333);box-sizing:border-box;">'
                +   '<button type="button" id="qa-answer-send" style="padding:9px 16px;border:none;border-radius:10px;background:var(--accent-color,#c5a47e);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">答！</button>'
                + '</div>';
        }
        html += '</div>';
        box.innerHTML = html;

        // 倒计时
        var cdEl = box.querySelector('#qa-countdown');
        function tick() {
            if (!_answering || !cdEl) return;
            var left = Math.max(0, Math.ceil((_answering.deadline - Date.now()) / 1000));
            cdEl.textContent = left + 's';
            if (left <= 10) cdEl.style.color = '#e74c3c';
            if (left <= 0) { if (_countdownTimer) clearInterval(_countdownTimer); _countdownTimer = null; }
        }
        tick();
        _countdownTimer = setInterval(tick, 250);

        // 作答事件
        var optBtns = box.querySelectorAll('.qa-opt-btn');
        optBtns.forEach(function (b) {
            b.addEventListener('click', function () { answerHim(b.dataset.v); });
        });
        var sendBtn = box.querySelector('#qa-answer-send');
        var inputEl = box.querySelector('#qa-answer-input');
        if (sendBtn && inputEl) {
            function submit() {
                var v = (inputEl.value || '').trim();
                if (!v) { if (typeof showNotification === 'function') showNotification('写点什么再答呀'); return; }
                answerHim(v);
            }
            sendBtn.addEventListener('click', submit);
            inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        }
    }

    // ── 问答记录 ──────────────────────
    function renderHistory() {
        var el = document.getElementById('qa-history');
        if (!el) return;
        var d = load();
        if (!d.history.length) {
            el.innerHTML = '<div style="font-size:11px;color:var(--text-secondary,#bbb);text-align:center;padding:8px;">还没有问答记录</div>';
            return;
        }
        el.innerHTML = '';
        d.history.slice(0, 10).forEach(function (h) {
            var whoText = h.who === 'me' ? '我问' : '他问';
            var aText = h.a ? h.a : '（超时未答）';
            var div = document.createElement('div');
            div.style.cssText = 'font-size:11px;color:var(--text-secondary,#888);padding:8px 10px;border-radius:10px;background:var(--secondary-bg,#f5f5f5);line-height:1.6;';
            var t = new Date(h.ts);
            var ts = (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
            div.innerHTML = '<span style="font-weight:700;color:var(--accent-color,#c5a47e);">' + whoText + '</span> '
                + h.q.replace(/</g, '&lt;') + '<br>'
                + '答：<span style="color:var(--text-primary,#555);">' + aText.replace(/</g, '&lt;') + '</span>'
                + '<span style="float:right;opacity:.6;">' + ts + '</span>';
            el.appendChild(div);
        });
    }

    function open() {
        buildModal();
        var m = document.getElementById('qa-modal');
        if (!m) return;
        var d = load();
        m.querySelector('#qa-sec-range').value = String(d.answerSec);
        m.querySelector('#qa-sec-val').textContent = d.answerSec + 's';
        renderAnswering();
        renderHistory();
        // 用快问快答 → 梦角 App 熟练度 +1（每日上限 3 次）
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'qa', 3);
            }
        } catch (e) {}
        if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
    }

    window.QuickQA = { open: open, heAsks: heAsks };
})();
