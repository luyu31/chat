/**
 * quickqa.js — 快问快答（问卷式）
 *
 * 两个玩法：
 *   1. 我问他：从「快问问题」字卡组点选一道题（问题|选项1|选项2|...），
 *      他在限时内回答"我选「xx」"。
 *   2. 他问我：他自己随机决定什么时候出题（不接受我点单），从同一个
 *      问题池抽题考我，我在限时内作答；答得快被夸（夸奖字卡），
 *      超时或太慢被嘲讽（嘲讽字卡）。
 *
 * 回答时限可调：1~120 秒，默认 60 秒。
 * 字卡组（氛围感配置）：快问问题 / 快答夸奖 / 快答嘲讽
 * 入口：输入区「+」更多菜单 → 快问快答
 * 存储：localStorage 'quickQAData' { answerSec, nextAskAt, history:[] }
 */
(function () {
    'use strict';

    var KEY = 'quickQAData';
    var DEFAULT_SEC = 60;
    var MIN_SEC = 1;
    var MAX_SEC = 120;
    var HISTORY_MAX = 30;

    // ── 台词池：优先字卡库，兜底内置 ──────────────────────
    function _poolFrom(fn, fallback) {
        try {
            var pool = fn();
            if (Array.isArray(pool) && pool.length) return pool;
        } catch (e) {}
        return fallback;
    }

    function getQuestionPool() {
        return _poolFrom(window._getQAQuestionPool, [
            '今天想我了没？|想了|特别想|一直在想|才不想',
            '周末想跟我干什么？|宅家贴贴|出门逛街|看电影|吃好吃的',
            '我是不是很可爱？|是|特别可爱|全天下最可爱|一般般',
            '今晚早点睡好不好？|好|再玩五分钟|马上睡|你先睡'
        ]);
    }

    function getPraisePool() {
        return _poolFrom(window._getQAPraisePool, [
            '反应挺快嘛，奖励一个抱抱',
            '答得不错，就喜欢你这个速度',
            '这速度，看来心里有我'
        ]);
    }

    function getTeasePool() {
        return _poolFrom(window._getQATeasePool, [
            '时间到！你刚刚是不是走神了？',
            '超时了哦，这题算我赢',
            '喂，人呢？倒计时都跑完了'
        ]);
    }

    // 解析 "问题|选项1|选项2" → { q, options }
    function parseQuestion(raw) {
        var parts = String(raw).split('|').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!parts.length) return { q: '', options: [] };
        return { q: parts[0], options: parts.slice(1) };
    }

    // ── 存取 ──────────────────────
    function load() {
        try {
            var d = JSON.parse(localStorage.getItem(KEY));
            if (!d || typeof d !== 'object') d = {};
            if (typeof d.answerSec !== 'number' || d.answerSec < MIN_SEC || d.answerSec > MAX_SEC) d.answerSec = DEFAULT_SEC;
            if (typeof d.nextAskAt !== 'number') d.nextAskAt = 0;
            if (!Array.isArray(d.history)) d.history = [];
            return d;
        } catch (e) {
            return { answerSec: DEFAULT_SEC, nextAskAt: 0, history: [] };
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

    // ── 玩法一：我问他（问卷式点选，不打字） ──────────────────────
    function askHim(rawQuestion) {
        var d = load();
        var sec = d.answerSec;
        var parsed = parseQuestion(rawQuestion);
        if (!parsed.q) return;
        var text = parsed.options.length
            ? '快问快答！' + parsed.q + '（' + parsed.options.join(' / ') + '）'
            : '快问快答！' + parsed.q;
        _say(text, 'me');

        // 他在限时内的某个随机时刻回答；时限很短时就 1~3 秒内答
        var delay = sec <= 3
            ? 800 + Math.random() * sec * 600
            : 800 + Math.random() * 1500 + Math.random() * (sec * 1000 - 800);
        delay = Math.max(600, Math.min(delay, sec * 1000));

        setTimeout(function () {
            var answer = parsed.options.length
                ? '我选「' + pick(parsed.options) + '」'
                : '这题我要想想……先反问一句：你觉得呢？';
            _say(answer, 'him');
            _record({ ts: Date.now(), who: 'me', q: parsed.q, a: answer });
        }, delay);

        if (typeof showNotification === 'function') {
            showNotification('问题已发出，限时 ' + sec + ' 秒，等他答～');
        }
        var m = document.getElementById('qa-modal');
        if (m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
    }

    // ── 玩法二：他问我（他自己决定什么时候问，不接受点单） ──────────────────────
    var _answering = null; // 进行中的他问我 { q, options, timer, deadline, startTs }

    function heAsks() {
        if (_answering) return;
        // 他自主出题时弹窗可能还没建过——先确保作答区在 DOM 里
        buildModal();
        var d = load();
        var sec = d.answerSec;
        var parsed = parseQuestion(pick(getQuestionPool()));
        if (!parsed.q) return;
        _answering = { q: parsed.q, options: parsed.options, deadline: Date.now() + sec * 1000, startTs: Date.now() };

        var text = parsed.options.length
            ? '换我来考你！' + parsed.q + '（' + parsed.options.join(' / ') + '）'
            : '换我来考你！' + parsed.q;
        _say(text, 'him');

        renderAnswering();
        // 弹窗跟着弹出来，倒计时和选项直接摆在眼前
        var modal = document.getElementById('qa-modal');
        if (modal) { if (typeof showModal === 'function') showModal(modal); else modal.style.display = 'flex'; }
        if (typeof showNotification === 'function') {
            showNotification(_partnerName() + ' 出题了！限时 ' + sec + ' 秒，快答！');
        }

        _answering.timer = setTimeout(function () {
            if (!_answering) return;
            _say(pick(getTeasePool()), 'him');
            _record({ ts: Date.now(), who: 'him', q: _answering.q, a: null });
            _answering = null;
            renderAnswering();
            renderHistory();
        }, sec * 1000);
    }

    function answerHim(answer) {
        if (!_answering) return;
        clearTimeout(_answering.timer);
        var q = _answering.q;
        var sec = load().answerSec;
        var elapsed = Math.round((Date.now() - _answering.startTs) / 1000);
        _answering = null;
        renderAnswering();

        _say(answer, 'me');
        // 答得快（一半时间内答完）→ 夸奖字卡；否则 → 嘲讽字卡（阴阳怪气但算你过关）
        setTimeout(function () {
            _say(elapsed <= sec / 2 ? pick(getPraisePool()) : pick(getTeasePool()), 'him');
        }, 900 + Math.random() * 1200);
        _record({ ts: Date.now(), who: 'him', q: q, a: answer });
    }

    // ── 他的自主发问调度（照 control.js 随机封锁的思路） ──────────────────────
    // nextAskAt 持久化；30 秒轮询；到点且页面可见 → 他出题；下一轮 2~6 小时后随机
    function _checkAskScheduler() {
        var d = load();
        if (!d.nextAskAt) {
            d.nextAskAt = Date.now() + (30 + Math.random() * 150) * 60000; // 首次：30分钟~3小时
            save(d);
            return;
        }
        if (Date.now() < d.nextAskAt) return;
        if (document.hidden) return; // 不在页面上就等回来再问
        if (_answering) return; // 上一题还没答完

        heAsks();
        d = load();
        d.nextAskAt = Date.now() + (2 + Math.random() * 4) * 3600000; // 2~6 小时后再问
        save(d);
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
        +   '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin:2px 0 10px;">'
        +     '<span style="font-size:12px;color:var(--text-secondary,#888);">回答时限</span>'
        +     '<input type="range" id="qa-sec-range" min="1" max="120" step="1" style="width:150px;accent-color:var(--accent-color,#c5a47e);">'
        +     '<span id="qa-sec-val" style="font-size:12px;font-weight:700;color:var(--accent-color,#c5a47e);min-width:38px;text-align:right;">60s</span>'
        +   '</div>'
        +   '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin-bottom:6px;">我问' + _partnerName() + '（点一道题直接发）</div>'
        +   '<div id="qa-question-list" style="max-height:34vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;"></div>'
        +   '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin:12px 0 6px;">问答记录</div>'
        +   '<div id="qa-history" style="max-height:20vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>'
        +   '<div style="display:flex;gap:6px;margin-top:12px;">'
        +     '<button type="button" class="qa-manage-btn" data-tab="qaQuestions" style="flex:1;padding:9px 6px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:11px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-circle-question"></i> 问题字卡</button>'
        +     '<button type="button" class="qa-manage-btn" data-tab="qaPraise" style="flex:1;padding:9px 6px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:11px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-thumbs-up"></i> 夸奖字卡</button>'
        +     '<button type="button" class="qa-manage-btn" data-tab="qaTease" style="flex:1;padding:9px 6px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:11px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-ghost"></i> 嘲讽字卡</button>'
        +     '<button type="button" id="qa-close" class="modal-btn modal-btn-secondary" style="flex:0 0 auto;">关闭</button>'
        +   '</div>'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;">'
        +     '我问' + _partnerName() + '：点一道题直接发，他限时作答。<br>'
        +     '他问我：什么时候考你由他自己决定，不接受点单。答得快被夸，超时或太慢要被嘲讽。'
        +   '</div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#qa-sec-range').addEventListener('input', function () {
            var d = load();
            d.answerSec = Math.max(MIN_SEC, Math.min(MAX_SEC, parseInt(this.value, 10) || DEFAULT_SEC));
            save(d);
            m.querySelector('#qa-sec-val').textContent = d.answerSec + 's';
        });

        m.querySelectorAll('.qa-manage-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                _openCardLibrary(b.getAttribute('data-tab'));
            });
        });

        m.querySelector('#qa-close').addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none';
        });
        m.addEventListener('click', function (e) {
            if (e.target === m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
        });
    }

    // 直达氛围感配置的对应字卡 tab（先关快问快答弹窗，避免被盖住）
    function _openCardLibrary(subTab) {
        try {
            var m = document.getElementById('qa-modal');
            if (m) { if (typeof hideModal === 'function') hideModal(m); else m.style.display = 'none'; }
            if (typeof currentMajorTab !== 'undefined') { currentMajorTab = 'atmosphere'; currentSubTab = subTab; }
            if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
            var libModal = document.getElementById('custom-replies-modal');
            if (libModal && typeof showModal === 'function') showModal(libModal);
        } catch (e) { console.warn('[qa] 打开字卡失败:', e); }
    }

    // ── 问题列表（问卷式：问题 + 选项预览，点一行直接发） ──────────────────────
    function renderQuestionList() {
        var el = document.getElementById('qa-question-list');
        if (!el) return;
        var pool = getQuestionPool();
        if (!pool.length) {
            el.innerHTML = '<div style="font-size:11px;color:var(--text-secondary,#bbb);text-align:center;padding:8px;">问题池是空的，去「问题字卡」加几道吧</div>';
            return;
        }
        el.innerHTML = '';
        pool.forEach(function (raw) {
            var parsed = parseQuestion(raw);
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = 'text-align:left;padding:10px 12px;border-radius:12px;border:1px solid var(--border-color,#ddd);'
                + 'background:var(--primary-bg,transparent);cursor:pointer;';
            var inner = '<div style="font-size:13px;font-weight:600;color:var(--text-primary,#333);">' + parsed.q.replace(/</g, '&lt;') + '</div>';
            if (parsed.options.length) {
                inner += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">'
                    + parsed.options.map(function (o) {
                        return '<span style="padding:3px 9px;border-radius:12px;font-size:10.5px;'
                            + 'background:rgba(var(--accent-color-rgb,197,164,126),.12);color:var(--accent-color,#c5a47e);">'
                            + o.replace(/</g, '&lt;') + '</span>';
                    }).join('')
                    + '</div>';
            }
            btn.innerHTML = inner;
            btn.addEventListener('click', function () { askHim(raw); });
            el.appendChild(btn);
        });
    }

    // ── 他问我进行中的作答区（含倒计时） ──────────────────────
    var _countdownTimer = null;

    function renderAnswering() {
        var box = document.getElementById('qa-answering');
        if (!box) return;
        if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
        if (!_answering) { box.innerHTML = ''; return; }

        var html =
            '<div style="padding:12px;border-radius:14px;margin-bottom:10px;'
            + 'background:rgba(var(--accent-color-rgb,197,164,126),.10);border:1px solid rgba(var(--accent-color-rgb,197,164,126),.3);">'
            +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
            +     '<span style="font-size:12px;font-weight:700;color:var(--accent-color,#c5a47e);">' + _partnerName() + '正在问你</span>'
            +     '<span id="qa-countdown" style="font-size:16px;font-weight:800;color:var(--accent-color,#c5a47e);"></span>'
            +   '</div>'
            +   '<div style="font-size:14px;font-weight:600;color:var(--text-primary,#333);margin-bottom:10px;">' + _answering.q.replace(/</g, '&lt;') + '</div>';

        if (_answering.options && _answering.options.length) {
            html += '<div id="qa-answer-options" style="display:flex;flex-wrap:wrap;gap:6px;">';
            _answering.options.forEach(function (opt) {
                html += '<button type="button" class="qa-opt-btn" data-v="' + opt.replace(/"/g, '&quot;') + '" style="padding:8px 14px;border-radius:20px;border:1px solid var(--accent-color,#c5a47e);background:transparent;color:var(--accent-color,#c5a47e);font-size:12px;font-weight:600;cursor:pointer;">' + opt.replace(/</g, '&lt;') + '</button>';
            });
            html += '</div>';
        } else {
            // 没写选项的题：自动从其他题里借选项凑成点选（问卷就是要能直接点，不打字）
            var borrow = [];
            getQuestionPool().forEach(function (raw) {
                var p2 = parseQuestion(raw);
                if (p2.q !== _answering.q) {
                    p2.options.forEach(function (o) { if (borrow.length < 3) borrow.push(o); });
                }
            });
            html += '<div id="qa-answer-options" style="display:flex;flex-wrap:wrap;gap:6px;">';
            ['好', '不好', '不知道'].forEach(function (o) { if (borrow.length < 3) borrow.push(o); });
            borrow.forEach(function (opt) {
                html += '<button type="button" class="qa-opt-btn" data-v="' + opt.replace(/"/g, '&quot;') + '" style="padding:8px 14px;border-radius:20px;border:1px solid var(--accent-color,#c5a47e);background:transparent;color:var(--accent-color,#c5a47e);font-size:12px;font-weight:600;cursor:pointer;">' + opt.replace(/</g, '&lt;') + '</button>';
            });
            html += '</div>';
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
        renderQuestionList();
        renderHistory();
        // 用快问快答 → 梦角 App 熟练度 +1（每日上限 3 次）
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'qa', 3);
            }
        } catch (e) {}
        if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
    }

    // ── 启动：挂上他的自主发问调度 ──────────────────────
    function init() {
        setInterval(_checkAskScheduler, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.QuickQA = { open: open, heAsks: heAsks };
})();
