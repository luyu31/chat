/**
 * quickqa.js — 快问快答（问卷式）
 *
 * 两个玩法：
 *   1. 我问他：点开快问快答，当场写问题（选项可填可不填）直接发出去，
 *      不需要任何预设；他在限时内的随机时刻回答"我选「xx」"。
 *   2. 他问我：他自己随机决定什么时候出题（不接受我点单），从"他的题库"
 *      抽题考我，我在限时内作答；答得快被夸（夸奖字卡），
 *      超时或太慢被嘲讽（嘲讽字卡）。题库=内置中性题+我自己加的题，
 *      在快问快答弹窗里就能加/删。
 *
 * 回答时限可调：1~120 秒，默认 60 秒。
 * 字卡组（氛围感配置）：快答夸奖 / 快答嘲讽
 * 他问我：题目以 quickqa 类型消息直接嵌进聊天流，选项按钮当场点选作答，
 *         不再强制弹窗（弹窗保留，用于出题/管题库/看记录）。
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

    // 没写选项的开放题，他从这些里挑一句回（口语化，不预设任何身份）
    var OPEN_ANSWERS = [
        '这题我要想想……先反问一句：你觉得呢？',
        '我选「听你的」',
        '嗯……让我想想，先欠着',
        '这还用问？当然是跟你有关的那个答案',
        '我选「都可以，重点是跟你一起」'
    ];

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
                : pick(OPEN_ANSWERS);
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
    // 题目以 quickqa 类型消息嵌进聊天流，选项直接在聊天里点选作答
    var _answering = null; // 进行中的他问我 { q, options, timer, deadline, startTs, msgId }

    // 题目没写选项时，从其他题的选项里随机抽 3 个（等概率，不按顺序）
    function _borrowOptions(excludeQ) {
        var all = [];
        getQuestionPool().forEach(function (raw) {
            var p = parseQuestion(raw);
            if (p.q !== excludeQ) {
                p.options.forEach(function (o) { if (all.indexOf(o) === -1) all.push(o); });
            }
        });
        var borrow = [];
        while (all.length && borrow.length < 3) {
            borrow.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
        }
        ['好', '不好', '不知道'].forEach(function (o) { if (borrow.length < 3 && borrow.indexOf(o) === -1) borrow.push(o); });
        return borrow;
    }

    // 把作答状态写回聊天流里那条 quickqa 消息并重渲染（气泡随之收起变成结果态）
    function _markQaMsg(msgId, patch) {
        try {
            if (msgId == null || typeof messages === 'undefined' || !Array.isArray(messages)) return;
            var m = messages.find(function (x) { return String(x.id) === String(msgId); });
            if (!m) return;
            Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
            if (typeof renderMessages === 'function') renderMessages();
            if (typeof throttledSaveData === 'function') throttledSaveData();
        } catch (e) {}
    }

    function heAsks() {
        if (_answering) return;
        var d = load();
        var sec = d.answerSec;
        var parsed = parseQuestion(pick(getQuestionPool()));
        if (!parsed.q) return;
        var options = parsed.options.length ? parsed.options.slice() : _borrowOptions(parsed.q);

        var msg = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            sender: _partnerName(),
            text: '',
            timestamp: new Date(),
            status: 'received',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'quickqa',
            qaQ: parsed.q,
            qaOptions: options,
            qaState: 'active',
            qaDeadline: Date.now() + sec * 1000
        };
        _answering = { q: parsed.q, options: options, deadline: msg.qaDeadline, startTs: Date.now(), msgId: msg.id };

        if (typeof addMessage === 'function') {
            addMessage(msg);
            if (typeof playSound === 'function') playSound('message');
        } else {
            // 极端兜底：聊天流不可用时退回纯文本
            _say('换我来考你！' + parsed.q + (options.length ? '（' + options.join(' / ') + '）' : ''), 'him');
        }

        renderAnswering(); // 弹窗正好开着的话，弹窗里的作答区同步一份
        if (typeof showNotification === 'function') {
            showNotification(_partnerName() + ' 出题了！限时 ' + sec + ' 秒，快答！');
        }

        _answering.timer = setTimeout(_onAnswerTimeout, sec * 1000);
    }

    function _onAnswerTimeout() {
        if (!_answering) return;
        var q = _answering.q;
        var msgId = _answering.msgId;
        _answering = null;
        _markQaMsg(msgId, { qaState: 'timeout' });
        renderAnswering();
        _say(pick(getTeasePool()), 'him');
        _record({ ts: Date.now(), who: 'him', q: q, a: null });
    }

    function answerHim(answer) {
        if (!_answering) return;
        clearTimeout(_answering.timer);
        var q = _answering.q;
        var msgId = _answering.msgId;
        var sec = load().answerSec;
        var elapsed = Math.round((Date.now() - _answering.startTs) / 1000);
        _answering = null;
        _markQaMsg(msgId, { qaState: 'answered', qaAnswer: answer });
        renderAnswering();

        _say(answer, 'me');
        // 答得快（一半时间内答完）→ 夸奖字卡；否则 → 嘲讽字卡（阴阳怪气但算你过关）
        setTimeout(function () {
            _say(elapsed <= sec / 2 ? pick(getPraisePool()) : pick(getTeasePool()), 'him');
        }, 900 + Math.random() * 1200);
        _record({ ts: Date.now(), who: 'him', q: q, a: answer });
    }

    // 聊天流气泡上的选项按钮点击入口（事件委托，重渲染后依然可用）
    function answerInline(msgId, answer) {
        if (!_answering || String(_answering.msgId) !== String(msgId)) return;
        answerHim(answer);
    }

    // ── 聊天流里的 quickqa 气泡渲染（createMessageFragment 委托到这里） ──────────────────────
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderBubbleHTML(msg) {
        var qHtml = _esc(msg.qaQ || '');
        var opts = Array.isArray(msg.qaOptions) ? msg.qaOptions : [];
        var html = '<div style="min-width:170px;max-width:250px;">'
            + '<div style="font-size:11px;font-weight:700;color:var(--accent-color,#c5a47e);margin-bottom:4px;">'
            + '<i class="fas fa-bolt"></i> ' + _esc(_partnerName()) + '考你</div>'
            + '<div style="font-size:14px;font-weight:600;color:var(--text-primary,#333);margin-bottom:8px;line-height:1.5;">' + qHtml + '</div>';

        var active = msg.qaState === 'active' && _answering && String(_answering.msgId) === String(msg.id);

        if (active) {
            // 待作答：选项直接摆在这里点
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            opts.forEach(function (o) {
                html += '<button type="button" class="qa-inline-opt" data-qa-msg="' + _esc(msg.id) + '" data-qa-opt="' + _esc(o) + '"'
                    + ' style="padding:7px 14px;border-radius:20px;border:1px solid var(--accent-color,#c5a47e);background:transparent;'
                    + 'color:var(--accent-color,#c5a47e);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-family);">'
                    + _esc(o) + '</button>';
            });
            html += '</div>'
                + '<div style="margin-top:8px;font-size:11px;color:var(--text-secondary,#999);">限时作答 · 剩余 <span class="qa-inline-cd" style="font-weight:700;color:var(--accent-color,#c5a47e);">--</span> 秒</div>';
        } else if (msg.qaState === 'answered') {
            // 已作答：高亮选中的那个
            var shown = opts.length ? opts : [msg.qaAnswer];
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            shown.forEach(function (o) {
                var chosen = o === msg.qaAnswer;
                html += '<span style="padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;'
                    + (chosen
                        ? 'border:1px solid var(--accent-color,#c5a47e);background:rgba(var(--accent-color-rgb,197,164,126),.16);color:var(--accent-color,#c5a47e);'
                        : 'border:1px solid var(--border-color,#ddd);background:transparent;color:var(--text-secondary,#aaa);')
                    + '">' + _esc(o) + (chosen ? ' <i class="fas fa-check"></i>' : '') + '</span>';
            });
            html += '</div><div style="margin-top:6px;font-size:11px;color:var(--accent-color,#c5a47e);">已作答 ✓</div>';
        } else {
            // 超时 / 陈年旧题
            html += '<div style="font-size:11px;color:var(--text-secondary,#999);">'
                + (msg.qaState === 'timeout' ? '超时未答，这题算他赢' : '这题已经过去啦') + '</div>';
        }
        html += '</div>';
        return html;
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
        var inpCss = 'width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;border:1.5px solid var(--border-color,#ddd);background:var(--primary-bg,transparent);color:var(--text-primary,#333);font-size:13px;outline:none;font-family:var(--font-family);';
        m.innerHTML =
        '<div class="modal-content" style="max-width:420px;width:90vw;max-height:86vh;overflow-y:auto;">'
        +   '<div class="modal-title"><i class="fas fa-bolt"></i><span>快问快答</span></div>'
        +   '<div id="qa-answering"></div>'
        +   '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin:2px 0 10px;">'
        +     '<span style="font-size:12px;color:var(--text-secondary,#888);">回答时限</span>'
        +     '<input type="range" id="qa-sec-range" min="1" max="120" step="1" style="width:150px;accent-color:var(--accent-color,#c5a47e);">'
        +     '<span id="qa-sec-val" style="font-size:12px;font-weight:700;color:var(--accent-color,#c5a47e);min-width:38px;text-align:right;">60s</span>'
        +   '</div>'
        +   '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin-bottom:6px;">出题问' + _partnerName() + '（不用预设，想到什么问什么）</div>'
        +   '<input type="text" id="qa-ask-q" placeholder="想问什么？如：周末想干什么？" maxlength="40" style="' + inpCss + 'margin-bottom:6px;">'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-bottom:4px;">每个选项单独一格（不填就是开放题，TA自由回你）</div>'
        +   '<div id="qa-ask-opts-box"></div>'
        +   '<button type="button" id="qa-ask-opt-add" style="width:100%;padding:7px;border:1px dashed var(--border-color,#ddd);border-radius:10px;background:transparent;color:var(--text-secondary,#888);font-size:11px;cursor:pointer;font-family:var(--font-family);margin-bottom:8px;"><i class="fas fa-plus"></i> 再加一个选项</button>'
        +   '<button type="button" id="qa-ask-send" class="modal-btn modal-btn-primary" style="width:100%;padding:10px;font-size:13px;">发出去，等TA答</button>'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:5px;line-height:1.6;">TA会在时限内挑一个答案回你</div>'
        +   '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin:14px 0 6px;">TA的题库（TA考你时从中抽题，可自己加）</div>'
        +   '<div style="display:flex;gap:6px;margin-bottom:8px;">'
        +     '<input type="text" id="qa-bank-add-input" placeholder="加一道题：问题 | 选项1 | 选项2…" maxlength="80" style="flex:1;min-width:0;padding:8px 10px;border-radius:10px;border:1.5px solid var(--border-color,#ddd);background:var(--primary-bg,transparent);color:var(--text-primary,#333);font-size:12px;outline:none;font-family:var(--font-family);">'
        +     '<button type="button" id="qa-bank-add-btn" class="modal-btn modal-btn-primary" style="flex:0 0 auto;padding:8px 14px;font-size:12px;">加题</button>'
        +   '</div>'
        +   '<div id="qa-bank-list" style="max-height:24vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>'
        +   '<div style="font-size:12px;font-weight:600;color:var(--text-secondary,#888);margin:12px 0 6px;">问答记录</div>'
        +   '<div id="qa-history" style="max-height:18vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>'
        +   '<div style="display:flex;gap:6px;margin-top:12px;">'
        +     '<button type="button" class="qa-manage-btn" data-tab="qaPraise" style="flex:1;padding:9px 6px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:11px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-thumbs-up"></i> 夸奖字卡</button>'
        +     '<button type="button" class="qa-manage-btn" data-tab="qaTease" style="flex:1;padding:9px 6px;border:1px dashed var(--border-color,#ddd);border-radius:10px;font-size:11px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;"><i class="fas fa-ghost"></i> 嘲讽字卡</button>'
        +     '<button type="button" id="qa-close" class="modal-btn modal-btn-secondary" style="flex:0 0 auto;">关闭</button>'
        +   '</div>'
        +   '<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:10px;line-height:1.7;">'
        +     '出题问' + _partnerName() + '：当场写问题发出去，TA限时作答。<br>'
        +     'TA考你：什么时候出题由TA随机决定，题目直接出现在聊天流里，点选项即作答。答得快被夸，超时或太慢要被嘲讽。'
        +   '</div>'
        + '</div>';
        document.body.appendChild(m);

        m.querySelector('#qa-sec-range').addEventListener('input', function () {
            var d = load();
            d.answerSec = Math.max(MIN_SEC, Math.min(MAX_SEC, parseInt(this.value, 10) || DEFAULT_SEC));
            save(d);
            m.querySelector('#qa-sec-val').textContent = d.answerSec + 's';
        });

        // 当场出题：问题 + 每格一个选项 → 发出去
        renderOptRows(2);
        m.querySelector('#qa-ask-opt-add').addEventListener('click', function () {
            var n = m.querySelectorAll('.qa-ask-opt-input').length;
            if (n >= 6) {
                if (typeof showNotification === 'function') showNotification('一道题最多 6 个选项', 'info', 1600);
                return;
            }
            renderOptRows(n + 1, true);
        });
        m.querySelector('#qa-ask-send').addEventListener('click', _composeAsk);
        m.querySelector('#qa-ask-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); _composeAsk(); } });

        // 题库：加题 + 删除（删除走事件委托）
        m.querySelector('#qa-bank-add-btn').addEventListener('click', _bankAdd);
        m.querySelector('#qa-bank-add-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); _bankAdd(); } });
        m.querySelector('#qa-bank-list').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-bank-del]');
            if (!btn) return;
            var id = btn.getAttribute('data-bank-del');
            var arr = _bankRaw();
            var item = null;
            arr.forEach(function (x) { if (String(x.id) === String(id)) item = x; });
            if (!item) return;
            if (!confirm('把这道题从题库里删掉？\n' + parseQuestion(item.text).q)) return;
            _bankSave(arr.filter(function (x) { return String(x.id) !== String(id); }));
            renderBankList();
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

    var MAX_OPTS = 6;

    // 渲染选项格子：每个选项独立一个输入框（保留已填内容），focusLast=新增后聚焦新格
    function renderOptRows(count, focusLast) {
        var box = document.getElementById('qa-ask-opts-box');
        if (!box) return;
        var oldVals = [];
        box.querySelectorAll('.qa-ask-opt-input').forEach(function (inp) { oldVals.push(inp.value); });
        var n = Math.max(1, Math.min(MAX_OPTS, count));
        while (oldVals.length < n) oldVals.push('');
        oldVals = oldVals.slice(0, n);

        var rowCss = 'flex:1;min-width:0;padding:8px 11px;border-radius:10px;border:1.5px solid var(--border-color,#ddd);background:var(--primary-bg,transparent);color:var(--text-primary,#333);font-size:13px;outline:none;font-family:var(--font-family);';
        var delCss = 'flex-shrink:0;width:32px;height:32px;border:1px solid var(--border-color,#ddd);border-radius:10px;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;font-size:11px;';
        var html = '';
        oldVals.forEach(function (v, i) {
            html += '<div style="display:flex;gap:6px;margin-bottom:6px;">'
                + '<span style="flex-shrink:0;width:22px;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--accent-color,#c5a47e);">' + String.fromCharCode(65 + i) + '</span>'
                + '<input type="text" class="qa-ask-opt-input" placeholder="选项' + (i + 1) + '（可留空）" maxlength="16" style="' + rowCss + '" value="' + _esc(v) + '">'
                + (n > 1 ? '<button type="button" class="qa-ask-opt-del" title="删掉这格" style="' + delCss + '"><i class="fas fa-times"></i></button>' : '')
                + '</div>';
        });
        box.innerHTML = html;

        // 删格：把当前各格值带回去重渲染
        box.querySelectorAll('.qa-ask-opt-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var vals = _collectOptInputs();
                var row = btn.closest('div');
                var rows = Array.prototype.slice.call(box.children);
                var idx = rows.indexOf(row);
                if (idx > -1) vals.splice(idx, 1);
                _renderOptRowsWith(vals, false);
            });
        });

        var addBtn = document.getElementById('qa-ask-opt-add');
        if (addBtn) addBtn.style.display = n >= MAX_OPTS ? 'none' : '';
        if (focusLast) {
            var ins = box.querySelectorAll('.qa-ask-opt-input');
            if (ins.length) ins[ins.length - 1].focus();
        }
    }

    // 用指定值数组重渲染选项格
    function _renderOptRowsWith(vals, focusLast) {
        var box = document.getElementById('qa-ask-opts-box');
        if (!box) return;
        renderOptRows(vals.length || 1, focusLast);
        box.querySelectorAll('.qa-ask-opt-input').forEach(function (inp, i) { inp.value = vals[i] || ''; });
    }

    function _collectOptInputs() {
        var vals = [];
        document.querySelectorAll('#qa-ask-opts-box .qa-ask-opt-input').forEach(function (inp) { vals.push(inp.value); });
        return vals;
    }

    // ── 当场出题：问题 + 每格选项，拼成 "问题|选项1|选项2" 发给 askHim ──────────────────────
    function _composeAsk() {
        var qEl = document.getElementById('qa-ask-q');
        if (!qEl) return;
        var q = String(qEl.value || '').trim().slice(0, 40);
        if (!q) {
            if (typeof showNotification === 'function') showNotification('先写个问题吧～', 'info', 1800);
            qEl.focus();
            return;
        }
        var opts = _collectOptInputs()
            .map(function (s) { return String(s || '').trim(); })
            .filter(Boolean)
            .slice(0, MAX_OPTS);
        qEl.value = '';
        renderOptRows(2);   // 发完重置成两个空格，方便下一题
        askHim(opts.length ? q + '|' + opts.join('|') : q);
    }

    // ── 他的题库：直接读写字卡库的存储（customQAQuestions），弹窗里加/删 ──────────────────────
    var BANK_KEY = 'customQAQuestions';

    function _bankRaw() {
        // 先摸一次池子，确保字卡库已把内置题初始化进存储
        try { if (typeof window._getQAQuestionPool === 'function') window._getQAQuestionPool(); } catch (e) {}
        var arr = null;
        try { arr = JSON.parse(localStorage.getItem(BANK_KEY)); } catch (e) {}
        if (!Array.isArray(arr)) arr = [];
        return arr.map(function (it, i) {
            if (it && typeof it === 'object') return { id: it.id != null ? it.id : ('b_' + i), text: String(it.text || '') };
            return { id: 's_' + i, text: String(it || '') };
        }).filter(function (x) { return x.text.trim(); });
    }

    function _bankSave(arr) {
        try {
            localStorage.setItem(BANK_KEY, JSON.stringify(arr.map(function (x) { return { id: x.id, text: x.text }; })));
        } catch (e) {}
    }

    function _bankAdd() {
        var input = document.getElementById('qa-bank-add-input');
        if (!input) return;
        var v = String(input.value || '').trim();
        if (!v) return;
        var arr = _bankRaw();
        if (arr.some(function (x) { return x.text === v; })) {
            if (typeof showNotification === 'function') showNotification('题库里已经有这道题啦', 'info', 1800);
            return;
        }
        if (arr.length >= 100) {
            if (typeof showNotification === 'function') showNotification('题库最多 100 道，先删几道吧', 'info', 2000);
            return;
        }
        arr.push({ id: 'b_' + Date.now() + '_' + Math.floor(Math.random() * 1000), text: v });
        _bankSave(arr);
        input.value = '';
        renderBankList();
        if (typeof showNotification === 'function') showNotification('已加进题库 ✓ ' + _partnerName() + '考你时会抽到它', 'success', 2000);
    }

    function renderBankList() {
        var el = document.getElementById('qa-bank-list');
        if (!el) return;
        var arr = _bankRaw();
        if (!arr.length) {
            el.innerHTML = '<div style="font-size:11px;color:var(--text-secondary,#bbb);text-align:center;padding:8px;">题库是空的，加几道题TA才会来考你</div>';
            return;
        }
        el.innerHTML = '';
        // 新加的排前面
        arr.slice().reverse().forEach(function (x) {
            var parsed = parseQuestion(x.text);
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid var(--border-color,#ddd);background:var(--primary-bg,transparent);';
            row.innerHTML = '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:12px;font-weight:600;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + parsed.q.replace(/</g, '&lt;') + '</div>'
                + (parsed.options.length
                    ? '<div style="font-size:10.5px;color:var(--text-secondary,#aaa);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + parsed.options.join(' / ').replace(/</g, '&lt;') + '</div>'
                    : '<div style="font-size:10.5px;color:var(--text-secondary,#bbb);margin-top:2px;">没写选项，到时候凑选项</div>')
                + '</div>'
                + '<button type="button" data-bank-del="' + String(x.id).replace(/"/g, '&quot;') + '" title="删除" style="flex-shrink:0;width:24px;height:24px;border:none;border-radius:50%;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-times"></i></button>';
            el.appendChild(row);
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
            // 没写选项的题：从其他题借选项凑成点选
            var borrow = _borrowOptions(_answering.q);
            html += '<div id="qa-answer-options" style="display:flex;flex-wrap:wrap;gap:6px;">';
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
        renderBankList();
        renderHistory();
        // 用快问快答 → 梦角 App 熟练度 +1（每日上限 3 次）
        try {
            if (window.PartnerProficiency && typeof window.PartnerProficiency.gainDaily === 'function') {
                window.PartnerProficiency.gainDaily(1, 'qa', 3);
            }
        } catch (e) {}
        if (typeof showModal === 'function') showModal(m); else m.style.display = 'flex';
    }

    // ── 启动：挂上他的自主发问调度 + 聊天气泡的选项点击委托 ──────────────────────
    function init() {
        setInterval(_checkAskScheduler, 30000);

        // 聊天流 quickqa 气泡的选项按钮：事件委托，消息重渲染后依然可用
        document.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('.qa-inline-opt');
            if (!btn) return;
            answerInline(btn.getAttribute('data-qa-msg'), btn.getAttribute('data-qa-opt'));
        });

        // 聊天流气泡里的倒计时：轻量刷新文本，不触发整棵消息树重渲染
        setInterval(function () {
            if (!_answering) return;
            var left = Math.max(0, Math.ceil((_answering.deadline - Date.now()) / 1000));
            document.querySelectorAll('.qa-inline-cd').forEach(function (el) {
                el.textContent = left;
                el.style.color = left <= 10 ? '#e74c3c' : 'var(--accent-color,#c5a47e)';
            });
        }, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.QuickQA = { open: open, heAsks: heAsks, renderBubbleHTML: renderBubbleHTML, answerInline: answerInline };
})();
