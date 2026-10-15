/**
 * lockscreen.js — 暗号封锁（全屏锁）
 *
 * 效果类似市面上情侣软件的"锁手机"：梦角设定一句暗号，
 * 用户必须在全屏封锁界面里输入正确暗号才能解锁。
 * 做不到锁整台手机（Android 不允许第三方锁屏），
 * 但可以锁本应用：全屏覆盖层 + 杀进程/重启后自动恢复，
 * 效果等价于"他锁住了你俩的世界"。
 *
 * 防绕过机制：
 *   - 覆盖层 z-index:99990，盖过一切弹窗
 *   - 没有关闭按钮、ESC 无效、点击不冒泡关闭
 *   - active 状态持久化到 localStorage，杀进程/重启后 DOMContentLoaded 自动恢复
 *   - 连续错 10 次梦角"心软"自动解锁（防死锁，但不给 XP）
 */
(function () {
    'use strict';

    var KEY = 'appLock';

    // ── 内置封锁台词（梦角封锁时说的话） ──────────────────────
    var LOCK_LINES = [
        '手机被没收了哦',
        '想解锁？先把暗号说清楚',
        '不乖的小孩可没有自由',
        '先把暗号说对了再说',
        '嗯……先回答一个问题吧'
    ];

    // ── 解锁失败时的嘲讽台词 ──────────────────────
    var FAIL_LINES = [
        '不对，再说一遍',
        '就这？重说',
        '心不诚嘛，再来',
        '答错了哦，再想想',
        '差远了，继续说'
    ];

    // ── 解锁成功时梦角的夸奖（加到聊天流） ──────────────────────
    var SUCCESS_LINES = [
        '乖，这才对嘛',
        '真听话，奖励你',
        '嗯，说出来说明你心里有数'
    ];

    // ── 软解锁（连续错 10 次心软）台词 ──────────────────────
    var SOFT_UNLOCK_LINE = '算了，看你说不出来的样子……下次可没这么好心了';

    var _overlay = null;

    function load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
        catch (e) { return {}; }
    }

    function save(data) {
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    }

    // 两边都去掉空格和标点符号后全等比较（大小写不敏感），
    // 这样"最喜欢哥哥！"和"最喜欢哥哥"都能通过
    function _normalize(s) {
        return String(s || '')
            .replace(/[\s\p{P}\p{S}]/gu, '')
            .toLowerCase();
    }

    function _getPartnerAvatarHtml() {
        try {
            var img = document.querySelector('#partner-avatar img');
            if (img && img.src) return '<img src="' + img.src + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        } catch (e) {}
        return '<i class="fas fa-user" style="font-size:28px;color:var(--accent-color,#c5a47e);"></i>';
    }

    function _getPartnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    }

    function _pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ── 显示全屏封锁覆盖层 ──────────────────────
    function _show(passphrase, prompt, startedAt, failCount) {
        if (_overlay) _overlay.remove();

        var lockLine = _pick(LOCK_LINES);
        var name = _getPartnerName();

        _overlay = document.createElement('div');
        _overlay.id = 'app-lock-overlay';
        _overlay.style.cssText = 'position:fixed;inset:0;z-index:99990;'
            + 'background:rgba(20,16,24,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);'
            + 'display:flex;align-items:center;justify-content:center;'
            + 'animation:fadeIn .3s ease;';

        _overlay.innerHTML =
            '<div id="app-lock-card" style="'
            + 'width:84%;max-width:340px;max-height:90vh;overflow-y:auto;'
            + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
            + 'border-radius:24px;padding:32px 24px;text-align:center;'
            + 'box-shadow:0 20px 60px rgba(0,0,0,.5);">'
            +   '<div style="width:64px;height:64px;border-radius:50%;margin:0 auto 16px;'
            +   'border:2px solid rgba(255,255,255,.2);overflow:hidden;display:flex;align-items:center;justify-content:center;'
            +   'background:rgba(255,255,255,.05);">'
            +     _getPartnerAvatarHtml()
            +   '</div>'
            +   '<div style="font-size:15px;font-weight:600;color:rgba(255,255,255,.9);margin-bottom:6px;">' + name + '</div>'
            +   '<div id="app-lock-line" style="font-size:13px;color:rgba(255,255,255,.5);margin-bottom:20px;line-height:1.6;">' + lockLine + '</div>'
            +   '<div id="app-lock-prompt" style="font-size:22px;font-weight:700;color:rgba(255,255,255,.95);margin-bottom:24px;letter-spacing:1px;">' + prompt + '</div>'
            +   '<input id="app-lock-input" type="text" autocomplete="off" placeholder="说出暗号…" '
            +   'style="width:100%;box-sizing:border-box;padding:14px 16px;border-radius:14px;'
            +   'border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);'
            +   'color:#fff;font-size:16px;text-align:center;outline:none;margin-bottom:14px;" />'
            +   '<button id="app-lock-btn" type="button" style="width:100%;padding:14px;border:none;border-radius:14px;'
            +   'background:var(--accent-color,#c5a47e);color:#fff;font-size:15px;font-weight:600;cursor:pointer;">解锁</button>'
            +   '<div id="app-lock-hint" style="font-size:11px;color:rgba(255,255,255,.3);margin-top:16px;line-height:1.5;">'
            +   (failCount > 0 ? '已答错 ' + failCount + ' 次' : '输完暗号点解锁，或按回车')
            +   '</div>'
            + '</div>';

        document.body.appendChild(_overlay);

        // 阻止一切冒泡关闭——没有 ESC、没有点背景关闭、只有输对暗号才能走
        _overlay.addEventListener('click', function (e) { e.stopPropagation(); });

        var input = _overlay.querySelector('#app-lock-input');
        var btn = _overlay.querySelector('#app-lock-btn');

        function tryUnlock() {
            var val = input.value;
            if (_normalize(val) === _normalize(passphrase)) {
                _unlock(true);
            } else {
                _onFail();
            }
        }

        btn.addEventListener('click', tryUnlock);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); }
            // ESC 故意不处理——不能绕过封锁
        });

        // 自动聚焦输入框
        setTimeout(function () { try { input.focus(); } catch (e) {} }, 100);
    }

    // ── 答错处理 ──────────────────────
    function _onFail() {
        var data = load();
        data.failCount = (data.failCount || 0) + 1;
        save(data);

        var input = _overlay.querySelector('#app-lock-input');
        var lineEl = _overlay.querySelector('#app-lock-line');
        var hintEl = _overlay.querySelector('#app-lock-hint');
        var card = _overlay.querySelector('#app-lock-card');

        input.value = '';
        input.placeholder = '不对哦，再试一次';
        if (lineEl) lineEl.textContent = _pick(FAIL_LINES);
        if (hintEl) hintEl.textContent = '已答错 ' + data.failCount + ' 次';

        // 抖动动画
        if (card) {
            card.style.animation = 'none';
            // 触发回流让动画可以重新播放
            void card.offsetWidth;
            card.style.animation = 'lockShake .4s ease';
        }

        // 连续错 10 次心软解锁（防死锁），但不给 XP
        if (data.failCount >= 10) {
            _unlock(false, 'soft');
            return;
        }

        // 通知操控模块记录失败
        if (window.Control && typeof window.Control.onTaskDone === 'function') {
            window.Control.onTaskDone('lock-failed');
        }
        try { input.focus(); } catch (e) {}
    }

    // ── 解锁 ──────────────────────
    // passed: true=暗号正确 / false=软解锁（心软）
    function _unlock(passed, softReason) {
        save({ active: false });

        if (_overlay) {
            _overlay.style.transition = 'opacity .25s ease';
            _overlay.style.opacity = '0';
            var ov = _overlay;
            setTimeout(function () { if (ov) ov.remove(); }, 250);
            _overlay = null;
        }

        if (passed) {
            // 暗号正确：加 XP + 聊天流夸一句
            if (window.Control && typeof window.Control.onTaskDone === 'function') {
                window.Control.onTaskDone('lock-passed');
            }
            if (typeof addMessage === 'function') {
                addMessage({
                    id: Date.now() + Math.random(),
                    sender: _getPartnerName(),
                    text: _pick(SUCCESS_LINES),
                    timestamp: new Date(),
                    status: 'received',
                    type: 'normal',
                    favorited: false,
                    note: null
                });
                if (typeof window._triggerDelayedReply === 'function') window._triggerDelayedReply(true);
            }
        } else if (softReason === 'soft') {
            // 心软解锁：聊天流说一句"算了"
            if (typeof addMessage === 'function') {
                addMessage({
                    id: Date.now() + Math.random(),
                    sender: _getPartnerName(),
                    text: SOFT_UNLOCK_LINE,
                    timestamp: new Date(),
                    status: 'received',
                    type: 'normal',
                    favorited: false,
                    note: null
                });
            }
        }
    }

    // ══ 反向锁：我锁他 ════════════════════════════════════════════
    // 全屏覆盖层角色扮演（复用正向锁的覆盖层样式，但文案反过来）：
    // 你设一句暗号 → 显示"梦角必须说出：XXXX 才能解锁" → 他自动尝试
    // （80% 一次说对 / 20% 说错卖萌）→ 说对自动解锁，说错你心软点"算了放了他"。
    // 说对解锁后调 window.Control.onTaskDone('lock-partner')。

    var _partnerOverlay = null;

    // ── 暗号建议池（默认预填，可直接用） ──────────────────────
    var PLOCK_SUGGESTIONS = [
        '最爱的是你',
        '答案就是你呀',
        '心里只有你一个',
        '你比什么都重要',
        '当然是最爱你'
    ];

    // ── 他说错时卖萌的错误答案 ──────────────────────
    var PLOCK_WRONG_LINES = [
        '呃……是"全世界我最帅"？',
        '我想想……"今晚吃什么"？',
        '我知道了！是"我想睡觉"……不对吗？'
    ];

    // ── 说对后的撒娇话 ──────────────────────
    var PLOCK_PLEAD_LINES = [
        '呜呜……算你厉害，快放了我嘛',
        '好好好，我说——这次放过我啦',
        '哼，就这一次，快放了我～'
    ];

    // ── 说错后的委屈话 ──────────────────────
    var PLOCK_POUT_LINES = [
        '呜……我居然说错了，你肯定不爱我了',
        '（委屈巴巴）我错了还不行吗……',
        '哼，你一定是故意出这么难的暗号'
    ];

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 以他的身份往聊天流里说一句话（addMessage 存在性检查，缺了就静默跳过）
    function _partnerSay(text) {
        try {
            if (typeof addMessage === 'function') {
                addMessage({
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    sender: _getPartnerName(),
                    text: text,
                    timestamp: new Date(),
                    status: 'received',
                    favorited: false,
                    note: null,
                    replyTo: null,
                    type: 'normal'
                });
                if (typeof playSound === 'function') playSound('message');
            }
        } catch (e) {}
    }

    // ── 反向锁全屏覆盖层：第一步，你设暗号 ──────────────────────
    function lockPartner(passphrase) {
        if (_partnerOverlay) _partnerOverlay.remove();

        _partnerOverlay = document.createElement('div');
        _partnerOverlay.id = 'lock-partner-overlay';
        _partnerOverlay.style.cssText = 'position:fixed;inset:0;z-index:99985;'
            + 'background:rgba(24,18,32,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);'
            + 'display:flex;align-items:center;justify-content:center;'
            + 'animation:fadeIn .3s ease;';

        _partnerOverlay.innerHTML =
            '<div id="lock-partner-card" style="'
            + 'width:84%;max-width:340px;max-height:90vh;overflow-y:auto;'
            + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
            + 'border-radius:24px;padding:32px 24px;text-align:center;'
            + 'box-shadow:0 20px 60px rgba(0,0,0,.5);">'
            +   '<div style="font-size:34px;margin-bottom:10px;">🔒</div>'
            +   '<div style="font-size:18px;font-weight:700;color:rgba(255,255,255,.95);margin-bottom:6px;">你锁住了' + _esc(_getPartnerName()) + '</div>'
            +   '<div id="lock-partner-sub" style="font-size:13px;color:rgba(255,255,255,.55);margin-bottom:18px;line-height:1.6;">你把' + _esc(_getPartnerName()) + '锁住了，快让他说暗号</div>'
            +   '<input id="lock-partner-pass-input" type="text" autocomplete="off" placeholder="设一句暗号…" '
            +   'style="width:100%;box-sizing:border-box;padding:14px 16px;border-radius:14px;'
            +   'border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);'
            +   'color:#fff;font-size:16px;text-align:center;outline:none;margin-bottom:14px;" />'
            +   '<button id="lock-partner-go" type="button" style="width:100%;padding:14px;border:none;border-radius:14px;'
            +   'background:var(--accent-color,#c5a47e);color:#fff;font-size:15px;font-weight:600;cursor:pointer;">锁他！</button>'
            +   '<div id="lock-partner-stage" style="margin-top:16px;"></div>'
            + '</div>';

        document.body.appendChild(_partnerOverlay);

        // 阻止一切冒泡关闭——角色扮演期间不能点背景就逃走
        _partnerOverlay.addEventListener('click', function (e) { e.stopPropagation(); });

        var input = _partnerOverlay.querySelector('#lock-partner-pass-input');
        var goBtn = _partnerOverlay.querySelector('#lock-partner-go');

        input.value = passphrase || _pick(PLOCK_SUGGESTIONS);

        goBtn.addEventListener('click', function () {
            var val = (input.value || '').trim();
            if (!val) {
                input.placeholder = '先设一句暗号呀';
                return;
            }
            _partnerLocked(val);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); goBtn.click(); }
        });

        setTimeout(function () { try { input.focus(); } catch (e) {} }, 100);
    }

    // ── 第二步：已锁定，他自动尝试说暗号 ──────────────────────
    function _partnerLocked(passphrase) {
        var name = _getPartnerName();
        var sub = _partnerOverlay.querySelector('#lock-partner-sub');
        var stage = _partnerOverlay.querySelector('#lock-partner-stage');
        var input = _partnerOverlay.querySelector('#lock-partner-pass-input');
        var goBtn = _partnerOverlay.querySelector('#lock-partner-go');

        if (input) input.style.display = 'none';
        if (goBtn) goBtn.style.display = 'none';
        if (sub) sub.textContent = name + '必须说出：「' + passphrase + '」才能解锁';

        stage.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,.4);">'
            + name + ' 正在想……</div>';

        // 1~2 秒后显示他的"回答"（模拟正在输入）
        setTimeout(function () {
            if (!_partnerOverlay) return;
            var correct = Math.random() < 0.8;
            var said = correct ? passphrase : _pick(PLOCK_WRONG_LINES);
            var line = correct ? _pick(PLOCK_PLEAD_LINES) : _pick(PLOCK_POUT_LINES);

            var html = '<div style="margin-top:4px;">'
                +   '<div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:6px;">' + _esc(name) + ' 说：</div>'
                +   '<div style="font-size:15px;font-weight:600;color:rgba(255,255,255,.92);padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.08);margin-bottom:8px;">' + _esc(said) + '</div>'
                +   '<div style="font-size:13px;color:rgba(255,255,255,.6);line-height:1.6;margin-bottom:12px;">' + _esc(line) + '</div>';

            if (correct) {
                html += '</div>';
                stage.innerHTML = html;
                // 说对：稍等让用户看清他的撒娇，再自动解锁
                setTimeout(function () { _partnerUnlock(passphrase); }, 1400);
            } else {
                html += '<button id="lock-partner-release" type="button" style="width:100%;padding:13px;border:none;border-radius:14px;'
                    + 'background:rgba(255,255,255,.14);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">算了放了他</button>'
                    + '</div>';
                stage.innerHTML = html;
                stage.querySelector('#lock-partner-release').addEventListener('click', function () {
                    _partnerUnlock(null);
                });
            }
        }, 1000 + Math.random() * 1000);
    }

    // ── 第三步：解锁（passphrase 非空=他说对了；null=你心软放了他） ──────────────────────
    function _partnerUnlock(passphrase) {
        if (_partnerOverlay) {
            _partnerOverlay.style.transition = 'opacity .25s ease';
            _partnerOverlay.style.opacity = '0';
            var ov = _partnerOverlay;
            setTimeout(function () { if (ov) ov.remove(); }, 250);
            _partnerOverlay = null;
        }
        if (passphrase) {
            // 说对了：加熟练度 + 聊天流里补一句
            if (window.Control && typeof window.Control.onTaskDone === 'function') {
                window.Control.onTaskDone('lock-partner');
            }
            if (typeof showNotification === 'function') showNotification('他答对了，已解锁', 'success', 2000);
            _partnerSay('"' + passphrase + '"——哼，这种程度难不倒我');
        } else {
            // 你心软放了他
            _partnerSay('我就知道你舍不得锁我～');
        }
    }

    // ── 公开 API ──────────────────────

    /**
     * 启动封锁。
     * @param opts.passphrase 暗号答案（不传则从 control.js 的暗号库随机抽）
     * @param opts.prompt     封锁提示语（不传则自动拼"说，" + passphrase）
     */
    function start(opts) {
        opts = opts || {};
        var passphrase = opts.passphrase;
        var prompt = opts.prompt;

        // 没传暗号：从操控模块的暗号库（用户自定义+内置）随机抽
        if (!passphrase) {
            if (window.Control && typeof window.Control._pickPassphrase === 'function') {
                passphrase = window.Control._pickPassphrase();
            } else {
                passphrase = '最喜欢哥哥';
            }
        }
        if (!prompt) prompt = '说，' + passphrase;

        var data = {
            active: true,
            passphrase: passphrase,
            prompt: prompt,
            startedAt: Date.now(),
            failCount: 0
        };
        save(data);
        _show(passphrase, prompt, data.startedAt, 0);
        _notifyLock(_getPartnerName(), prompt);
    }

    // 锁上时给手机发系统通知（App 在后台/息屏时也能及时知道是他锁的）
    function _notifyLock(name, prompt) {
        try {
            if (window.MilkChat && typeof window.MilkChat.notify === 'function') {
                window.MilkChat.notify(name + '把软件锁了', prompt + '——说对了才给解锁', 'lock');
            } else if (typeof Notification === 'function') {
                new Notification(name + '把软件锁了', { body: prompt + '——说对了才给解锁' });
            }
        } catch (e) {}
    }

    function isActive() {
        return load().active === true;
    }

    // ── 启动恢复：杀进程/重启后自动重新显示锁 ──────────────────────
    function _restoreIfLocked() {
        var data = load();
        if (data.active === true && data.passphrase) {
            _show(data.passphrase, data.prompt || ('说，' + data.passphrase), data.startedAt || 0, data.failCount || 0);
        }
    }

    // 注入抖动动画 keyframes（只注入一次）
    function _injectShakeCss() {
        if (document.getElementById('lockscreen-shake-css')) return;
        var style = document.createElement('style');
        style.id = 'lockscreen-shake-css';
        style.textContent =
            '@keyframes lockShake {'
            + '0%,100%{transform:translateX(0)}'
            + '20%{transform:translateX(-8px)}'
            + '40%{transform:translateX(8px)}'
            + '60%{transform:translateX(-6px)}'
            + '80%{transform:translateX(6px)}'
            + '}'
            + '@keyframes fadeIn{from{opacity:0}to{opacity:1}}';
        document.head.appendChild(style);
    }

    // ── 初始化 ──────────────────────
    function init() {
        _injectShakeCss();
        // 600ms 后检查是否处于封锁状态（等页面渲染完）
        setTimeout(_restoreIfLocked, 600);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.LockScreen = {
        start: start,
        isActive: isActive,
        lockPartner: lockPartner
    };
})();
