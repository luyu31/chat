/**
 * exchange-diary.js — 交换日记
 *
 * 一本日记本，设定天数（10/30/90/180/365），每天"我写一篇 + 梦角写一篇"。
 * 梦角的内容从自定义回复字卡里选（不新增字卡分类）。
 * 当天没写会催（预设催写字卡 + 可自定义）。
 *
 * 存储：getStorageKey('exchangeDiaryList') → [{ id, title, startDate, duration, endDate, active, entries:[{day,date,user,text}] }]
 * entries 按 day 升序排列，每篇 2 行左右（用户自己写梦角那行从字卡选）。
 *
 * 入口：发现页 → 交换日记
 *      window.ExchangeDiary.open()
 */
(function () {
    'use strict';

    // ─── 常量 ──────────────────────────────────────────────────────────
    var KEY = 'exchangeDiaryList';
    var DURATION_PRESETS = [
        { label: '10 天',  days: 10  },
        { label: '30 天',  days: 30  },
        { label: '90 天',  days: 90  },
        { label: '半年',    days: 180 },
        { label: '一年',    days: 365 }
    ];
    var DEFAULT_TITLES = ['写给明天的信', '交换日记', '我们的小本本', '日记本'];
    var REMINDER_REPLIES = [
        '今天还没写日记呢，快动笔吧~',
        '该写啦，我在等你~',
        '日记日记，今天写了吗？',
        '记得写日记哦 📖',
        '写日记啦，不然我明天就偷看你的！'
    ];

    // ─── 存储 ──────────────────────────────────────────────────────────
    function getKey() { return (typeof getStorageKey === 'function' ? getStorageKey(KEY) : (window.APP_PREFIX || '') + KEY); }
    function todayKey() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function fmtDate(d) {
        if (typeof d === 'string') return d;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function daysBetween(a, b) {
        var da = new Date(a + 'T00:00:00');
        var db = new Date(b + 'T00:00:00');
        return Math.round((db - da) / 86400000);
    }
    function addDays(dateStr, n) {
        var d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + n);
        return fmtDate(d);
    }

    async function loadList() {
        try {
            var list = await localforage.getItem(getKey());
            if (!list || !Array.isArray(list)) list = [];
            // 自动关闭到期的日记
            var today = todayKey();
            var changed = false;
            list.forEach(function (diary) {
                if (diary.active && diary.endDate && diary.endDate < today) {
                    diary.active = false;
                    changed = true;
                }
            });
            if (changed) await localforage.setItem(getKey(), list);
            return list;
        } catch (e) { return []; }
    }
    async function saveList(list) {
        try { await localforage.setItem(getKey(), list); } catch (e) {}
    }

    function randomPick(arr) {
        if (!arr || !arr.length) return '';
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ─── 新建日记 ──────────────────────────────────────────────────────
    async function createDiary(title, days) {
        var start = todayKey();
        var diary = {
            id: String(Date.now()) + Math.floor(Math.random() * 1000),
            title: title || randomPick(DEFAULT_TITLES),
            startDate: start,
            duration: days,
            endDate: addDays(start, days),
            active: true,
            entries: []
        };
        var list = await loadList();
        list.unshift(diary);
        await saveList(list);
        return diary;
    }

    // ─── 梦角自动写一篇（从自定义回复字卡里选） ─────────────────────────
    function pickPartnerDiaryText(diary) {
        // 优先从 window._customReplies 字卡里选；没有就用日记专属兜底池
        var pool = [];
        try { pool = [...(window._customReplies || customReplies || [])]; } catch (e) {}
        // 过滤掉太短的（少于 6 个字不像日记）
        var longEnough = pool.filter(function (t) { return t && t.length >= 8; });
        if (longEnough.length) return randomPick(longEnough);
        if (pool.length) return randomPick(pool);
        // 兜底：从一些写日记用的短句里选
        var fallback = [
            '今天也很想你。',
            '窗外的风有点甜，像我们第一次见面那天。',
            '刚才刷到一只很可爱的猫，想起你说过想养一只。',
            '睡前最后一秒，在想你。',
            '明天要做的第一件事：跟你说早安。',
            '生活很普通，但想到你就觉得特别一点。',
            '今天发生了什么事，等你日记里告诉我吧。',
            '写日记的时候，感觉离你更近了。'
        ];
        return randomPick(fallback);
    }

    // 梦角"应该"写的天数（第几天了）
    function currentDayOf(diary) {
        if (!diary.startDate) return 0;
        var diff = daysBetween(diary.startDate, todayKey());
        return Math.max(1, Math.min(diary.duration, diff + 1));
    }

    // 某一天梦角是否已写
    function partnerWroteOnDay(diary, day) {
        return diary.entries.some(function (e) { return e.day === day && e.user === 'partner'; });
    }
    function meWroteOnDay(diary, day) {
        return diary.entries.some(function (e) { return e.day === day && e.user === 'me'; });
    }

    // 检查梦角有没有"今天该写但还没写"的 —— 在用户打开日记页时自动补上
    function ensurePartnerEntries(diary) {
        var day = currentDayOf(diary);
        var added = false;
        for (var d = 1; d <= day; d++) {
            if (!partnerWroteOnDay(diary, d)) {
                diary.entries.push({
                    day: d,
                    date: addDays(diary.startDate, d - 1),
                    user: 'partner',
                    text: pickPartnerDiaryText(diary)
                });
                added = true;
            }
        }
        if (added) {
            diary.entries.sort(function (a, b) { return (a.day - b.day) || (a.user === 'partner' ? -1 : 1); });
        }
        return added;
    }

    // ─── UI：自定义 modal（复用 ct-modal-mask 样式） ──────────────────
    function _mkMask(html) {
        var el = document.createElement('div');
        el.className = 'ct-modal-mask';
        el.innerHTML = html;
        document.body.appendChild(el);
        void el.offsetWidth;
        el.classList.add('on');
        return el;
    }
    function _closeMask(el) {
        el.classList.remove('on');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }

    // ─── 列表页（主入口） ──────────────────────────────────────────────
    async function open() {
        var list = await loadList();
        ensureAllPartnerEntries(list);
        await saveList(list);

        var activeList = list.filter(function (d) { return d.active; });
        var archivedList = list.filter(function (d) { return !d.active; });

        var el = _mkMask(
            '<div class="ed-root">' +
                '<div class="ed-header">' +
                    '<div class="ed-header-title">交换日记</div>' +
                    '<button class="ed-close"><i class="fas fa-xmark"></i></button>' +
                '</div>' +
                '<div class="ed-tabs">' +
                    '<button class="ed-tab ed-tab--on" data-tab="active">进行中 <span class="ed-tab-count">' + activeList.length + '</span></button>' +
                    '<button class="ed-tab" data-tab="archived">已封存 <span class="ed-tab-count">' + archivedList.length + '</span></button>' +
                '</div>' +
                '<div class="ed-list" id="ed-list"></div>' +
                '<button class="ed-new-btn" id="ed-new-btn"><i class="fas fa-pen-nib"></i><span>开启新的交换日记</span></button>' +
            '</div>');

        function render(tab) {
            var box = el.querySelector('#ed-list');
            var data = (tab === 'active' ? activeList : archivedList);
            if (!data.length) {
                box.innerHTML = '<div class="ed-empty">' +
                    '<div style="font-size:36px;opacity:.3;">📔</div>' +
                    '<div>还没有' + (tab === 'active' ? '进行中的' : '已封存的') + '日记</div>' +
                    (tab === 'active' ? '<div class="ed-empty-sub">点下面那个"开启新的"按钮开始第一本吧</div>' : '') +
                '</div>';
                return;
            }
            box.innerHTML = data.map(function (d) {
                var day = currentDayOf(d);
                var progress = Math.min(100, Math.round((day / d.duration) * 100));
                var needWrite = d.active && !meWroteOnDay(d, day);
                return '<div class="ed-card" data-id="' + d.id + '">' +
                    '<div class="ed-card-header">' +
                        '<div class="ed-card-title">' + _esc(d.title) + '</div>' +
                        (needWrite && tab === 'active' ? '<button class="ed-need-write" data-id="' + d.id + '">落笔写 →</button>' : '') +
                    '</div>' +
                    '<div class="ed-card-progress-text">进度 ' + day + ' / ' + d.duration + ' 天</div>' +
                    '<div class="ed-card-progress"><div class="ed-card-progress-inner" style="width:' + progress + '%;"></div></div>' +
                    '<div class="ed-card-dates">' +
                        '<span>开始 ' + _esc(d.startDate) + '</span>' +
                        '<span>结束 ' + _esc(d.endDate) + '</span>' +
                    '</div>' +
                    (d.active ? '' : '<div class="ed-card-badge">已封存</div>') +
                '</div>';
            }).join('');
        }

        render('active');

        el.querySelector('.ed-close').addEventListener('click', function () { _closeMask(el); });
        el.addEventListener('click', function (e) { if (e.target === el) _closeMask(el); });

        // Tab 切换
        el.querySelector('.ed-tabs').addEventListener('click', function (e) {
            var tab = e.target.closest('.ed-tab');
            if (!tab) return;
            el.querySelectorAll('.ed-tab').forEach(function (t) { t.classList.remove('ed-tab--on'); });
            tab.classList.add('ed-tab--on');
            render(tab.getAttribute('data-tab'));
        });

        // 点卡片 → 进详情
        el.querySelector('#ed-list').addEventListener('click', function (e) {
            var card = e.target.closest('.ed-card');
            if (!card) return;
            var id = card.getAttribute('data-id');
            _closeMask(el);
            setTimeout(function () { openDiaryDetail(id); }, 250);
        });

        // 点卡片上的"落笔写"按钮 → 直接进详情 + 聚焦输入
        el.querySelector('#ed-list').addEventListener('click', function (e) {
            var btn = e.target.closest('.ed-need-write');
            if (!btn) return;
            e.stopPropagation();
            var id = btn.getAttribute('data-id');
            _closeMask(el);
            setTimeout(function () { openDiaryDetail(id, true); }, 250);
        });

        // 新建
        el.querySelector('#ed-new-btn').addEventListener('click', async function () {
            var title = await (window.ctPrompt
                ? window.ctPrompt('新日记本', '起个标题（留空我帮你想）', '', '开启', '取消')
                : Promise.resolve(prompt('日记本叫什么名字？')));
            if (title === null) return;
            title = String(title || '').trim();

            // 选天数
            var days = 30;
            if (window.ctConfirm) {
                var choice = await new Promise(function (resolve) {
                    var mask = _mkMask(
                        '<div class="ct-modal-card">' +
                            '<div class="ct-modal-title">选个期限</div>' +
                            '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">' +
                                DURATION_PRESETS.map(function (p) {
                                    return '<button class="ct-modal-btn" data-days="' + p.days + '" style="background:var(--primary-bg);color:var(--text-primary);border:1px solid var(--border-color);padding:12px 0;font-weight:500;">' + p.label + '</button>';
                                }).join('') +
                            '</div>' +
                            '<button class="ct-modal-btn ct-modal-btn--cancel" data-days="cancel">取消</button>' +
                        '</div>');
                    mask.addEventListener('click', function (ev) {
                        var btn = ev.target.closest('.ct-modal-btn');
                        if (!btn) return;
                        _closeMask(mask);
                        var d = btn.getAttribute('data-days');
                        resolve(d === 'cancel' ? null : parseInt(d, 10));
                    });
                    mask.addEventListener('click', function (ev) { if (ev.target === mask) { _closeMask(mask); resolve(null); } });
                });
                if (!choice) return;
                days = choice;
            }

            await createDiary(title, days);
            _closeMask(el);
            // 刷新列表
            setTimeout(function () { open(); }, 250);
        });
    }

    function ensureAllPartnerEntries(list) {
        list.forEach(function (d) { if (d.active) ensurePartnerEntries(d); });
    }

    // ─── 单本日记详情 ───────────────────────────────────────────────────
    async function openDiaryDetail(id, focusWrite) {
        var list = await loadList();
        var diary = list.find(function (d) { return d.id === id; });
        if (!diary) {
            if (typeof showNotification === 'function') showNotification('日记本找不到了', 'error');
            return;
        }
        ensurePartnerEntries(diary);
        await saveList(list);

        var day = currentDayOf(diary);
        var meWrote = meWroteOnDay(diary, day);

        var el = _mkMask(
            '<div class="edd-root">' +
                '<div class="edd-header">' +
                    '<button class="edd-back"><i class="fas fa-chevron-left"></i></button>' +
                    '<div class="edd-header-title">' + _esc(diary.title) + '</div>' +
                    '<button class="edd-more"><i class="fas fa-ellipsis-vertical"></i></button>' +
                '</div>' +
                '<div class="edd-scroll" id="edd-scroll"></div>' +
                '<div class="edd-write-bar" id="edd-write-bar">' +
                    (diary.active && !meWrote
                        ? '<textarea class="edd-textarea" id="edd-textarea" rows="2" placeholder="今天想写点什么？（点击这里落笔）"></textarea>' +
                          '<button class="edd-send" id="edd-send">落笔</button>'
                        : '<div class="edd-done-hint">' +
                            (meWrote ? '今天已经写好啦 ✦' : '这本日记已封存') +
                          '</div>') +
                '</div>' +
            '</div>');

        function renderEntries() {
            var box = el.querySelector('#edd-scroll');
            if (!diary.entries.length) {
                box.innerHTML = '<div class="ed-empty"><div style="font-size:36px;opacity:.3;">📔</div><div>第一天还没写</div></div>';
                return;
            }
            // 按 day 分组
            var grouped = {};
            diary.entries.forEach(function (e) {
                if (!grouped[e.day]) grouped[e.day] = { date: e.date, list: [] };
                grouped[e.day].list.push(e);
            });
            var html = '';
            Object.keys(grouped).sort(function (a, b) { return a - b; }).forEach(function (d) {
                var g = grouped[d];
                html += '<div class="edd-day-group">' +
                    '<div class="edd-day-label">Day ' + d + ' · ' + _esc(g.date) + '</div>';
                g.list.forEach(function (e) {
                    if (e.user === 'partner') {
                        var av = '';
                        try { av = (window._avatarCache && window._avatarCache.partner) || ''; } catch (err) {}
                        html += '<div class="edd-entry edd-entry--partner">' +
                            (av ? '<img src="' + _esc(av) + '" class="edd-entry-av">' : '<div class="edd-entry-av"><i class="fas fa-user"></i></div>') +
                            '<div class="edd-entry-body">' +
                                '<div class="edd-entry-name">他的日记</div>' +
                                '<div class="edd-entry-text">' + _esc(e.text || '') + '</div>' +
                            '</div>' +
                        '</div>';
                    } else {
                        var mav = '';
                        try { mav = (window._avatarCache && window._avatarCache.me) || ''; } catch (err) {}
                        html += '<div class="edd-entry edd-entry--me">' +
                            '<div class="edd-entry-body">' +
                                '<div class="edd-entry-name">我的日记</div>' +
                                '<div class="edd-entry-text">' + _esc(e.text || '') + '</div>' +
                            '</div>' +
                            (mav ? '<img src="' + _esc(mav) + '" class="edd-entry-av">' : '<div class="edd-entry-av"><i class="fas fa-user"></i></div>') +
                        '</div>';
                    }
                });
                html += '</div>';
            });
            box.innerHTML = html;
            box.scrollTop = box.scrollHeight;
        }

        renderEntries();

        el.querySelector('.edd-back').addEventListener('click', function () { _closeMask(el); setTimeout(function () { open(); }, 250); });
        el.addEventListener('click', function (e) { if (e.target === el) { _closeMask(el); setTimeout(function () { open(); }, 250); } });

        // 更多菜单（删除/封存）
        el.querySelector('.edd-more').addEventListener('click', async function () {
            var act;
            if (window.ctConfirm) {
                act = await new Promise(function (resolve) {
                    var mask = _mkMask(
                        '<div class="ct-modal-card">' +
                            '<div class="ct-modal-title">' + _esc(diary.title) + '</div>' +
                            '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">' +
                                (diary.active
                                    ? '<button class="ct-modal-btn" data-a="seal" style="background:var(--primary-bg);color:var(--text-primary);border:1px solid var(--border-color);padding:12px 0;font-weight:500;">封存这本日记</button>'
                                    : '') +
                                '<button class="ct-modal-btn ct-modal-btn--danger" data-a="delete">删除整本日记</button>' +
                            '</div>' +
                            '<button class="ct-modal-btn ct-modal-btn--cancel" data-a="cancel">取消</button>' +
                        '</div>');
                    mask.addEventListener('click', function (ev) {
                        var btn = ev.target.closest('.ct-modal-btn');
                        if (!btn) return;
                        _closeMask(mask);
                        resolve(btn.getAttribute('data-a'));
                    });
                    mask.addEventListener('click', function (ev) { if (ev.target === mask) { _closeMask(mask); resolve('cancel'); } });
                });
            } else {
                act = prompt('输入 seal / delete / cancel');
            }
            if (act === 'seal') {
                var ok = await (window.ctConfirm
                    ? window.ctConfirm('封存日记', '封存后不会再催你写，也不能继续写了。', '封存', '再想想')
                    : Promise.resolve(confirm('封存这本日记？')));
                if (!ok) return;
                var list2 = await loadList();
                var d2 = list2.find(function (x) { return x.id === id; });
                if (d2) { d2.active = false; await saveList(list2); _closeMask(el); }
            } else if (act === 'delete') {
                var ok2 = await (window.ctConfirm
                    ? window.ctConfirm('删除日记', '整本日记都会消失，不可恢复。', '删除', '再想想', true)
                    : Promise.resolve(confirm('删除整本日记？')));
                if (!ok2) return;
                var list3 = await loadList();
                list3 = list3.filter(function (x) { return x.id !== id; });
                await saveList(list3);
                _closeMask(el);
            }
        });

        // 落笔：保存我的日记 + 梦角自动补写
        var sendBtn = el.querySelector('#edd-send');
        if (sendBtn) {
            sendBtn.addEventListener('click', async function () {
                var ta = el.querySelector('#edd-textarea');
                var text = ta ? String(ta.value || '').trim() : '';
                if (!text) {
                    if (typeof showNotification === 'function') showNotification('写点什么吧~', 'warning');
                    return;
                }
                var list2 = await loadList();
                var d2 = list2.find(function (x) { return x.id === id; });
                if (!d2) return;
                d2.entries.push({
                    day: currentDayOf(d2),
                    date: addDays(d2.startDate, currentDayOf(d2) - 1),
                    user: 'me',
                    text: text
                });
                // 梦角可能还没补这一篇，确保他今天也有一篇
                ensurePartnerEntries(d2);
                await saveList(list2);

                // 换 UI：textarea 消失，显示"已写"提示 + 重新 render
                var bar = el.querySelector('#edd-write-bar');
                if (bar) bar.innerHTML = '<div class="edd-done-hint">今天已经写好啦 ✦</div>';
                renderEntries();
            });
        }

        // 滚动到底
        setTimeout(function () {
            var sc = el.querySelector('#edd-scroll');
            if (sc) sc.scrollTop = sc.scrollHeight;
            if (focusWrite) {
                var ta2 = el.querySelector('#edd-textarea');
                if (ta2) { ta2.focus(); ta2.select(); }
            }
        }, 150);
    }

    // ─── 催写（每次打开 App 检查一次） ─────────────────────────────────
    async function checkReminders() {
        try {
            var list = await loadList();
            var needMsg = [];
            list.forEach(function (d) {
                if (!d.active) return;
                var day = currentDayOf(d);
                if (!meWroteOnDay(d, day) && day >= 2) {  // 第 1 天给人缓冲
                    needMsg.push(randomPick(REMINDER_REPLIES));
                }
            });
            if (needMsg.length && typeof showNotification === 'function') {
                showNotification(needMsg.join(' · '), 'info');
            }
        } catch (e) {}
    }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    // ─── 全局 API ──────────────────────────────────────────────────────
    window.ExchangeDiary = {
        open: open,
        checkReminders: checkReminders
    };

    // App 启动后等 DOM 和会话都 ready 了再检查
    (function hookStart() {
        function tryCheck() {
            if (typeof SESSION_ID !== 'undefined' && SESSION_ID) {
                checkReminders();
            } else {
                setTimeout(tryCheck, 2000);
            }
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { setTimeout(tryCheck, 3500); });
        } else {
            setTimeout(tryCheck, 3500);
        }
    })();
})();
