(function() {
    var TI_AVATAR_KEY = 'tiSettings_showAvatar';
    var TI_TEXT_KEY = 'tiSettings_customText';
    var tiShowAvatar = localStorage.getItem(TI_AVATAR_KEY) !== 'false';
    var tiCustomText = localStorage.getItem(TI_TEXT_KEY) || '';

    function applyTiAvatarVisibility() {
        var avatarEl = document.getElementById('typing-indicator-avatar');
        if (!avatarEl) return;
        avatarEl.style.display = tiShowAvatar ? '' : 'none';
    }

    function getTiLabel() {
        if (tiCustomText) return tiCustomText;
        var name = (window.settings && settings.partnerName) ? settings.partnerName : '对方';
        return name + ' 正在输入';
    }

    function updatePreview() {
        var previewText = document.getElementById('ti-preview-text');
        var previewAvatar = document.getElementById('ti-preview-avatar');
        if (previewText) previewText.textContent = getTiLabel();
        if (previewAvatar) previewAvatar.style.display = tiShowAvatar ? '' : 'none';
        var label = document.getElementById('typing-indicator-label');
        if (label && label.textContent) label.textContent = getTiLabel();
        var actualAvatar = document.getElementById('typing-indicator-avatar');
        if (actualAvatar) actualAvatar.style.display = tiShowAvatar ? '' : 'none';
    }

    function syncPillUI() {
        var row = document.getElementById('ti-avatar-toggle');
        if (!row) return;
        if (tiShowAvatar) {
            row.classList.add('active');
        } else {
            row.classList.remove('active');
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        applyTiAvatarVisibility();
    });

    var _origSetLabel = null;
    function patchTypingLabel() {
        var label = document.getElementById('typing-indicator-label');
        if (label && tiCustomText) {
            label.textContent = tiCustomText;
        }
    }
    var labelEl = null;
    function initLabelObserver() {
        labelEl = document.getElementById('typing-indicator-label');
        if (!labelEl || labelEl._tiObserved) return;
        labelEl._tiObserved = true;
        var obs = new MutationObserver(function() {
            if (tiCustomText && labelEl.textContent !== tiCustomText) {
                labelEl.textContent = tiCustomText;
            }
        });
        obs.observe(labelEl, { childList: true, characterData: true, subtree: true });
    }
    setTimeout(initLabelObserver, 1000);

    document.addEventListener('click', function(e) {
        var ti = e.target.closest('.typing-indicator');
        if (!ti) return;
        e.stopPropagation();
        initLabelObserver();
        var modal = document.getElementById('ti-settings-modal');
        if (!modal) return;
        var input = document.getElementById('ti-text-input');
        if (input) input.value = tiCustomText;
        syncPillUI();
        updatePreview();
        var partnerImg = document.querySelector('#partner-info .message-avatar img') ||
                         document.querySelector('.partner-avatar img') ||
                         document.querySelector('[id*="partner"] img');
        var previewAvatar = document.getElementById('ti-preview-avatar');
        if (previewAvatar && partnerImg) {
            previewAvatar.innerHTML = '<img src="' + partnerImg.src + '" style="width:100%;height:100%;object-fit:cover;">';
        }
        modal.classList.add('open');
    });

    document.addEventListener('click', function(e) {
        var modal = document.getElementById('ti-settings-modal');
        if (!modal || !modal.classList.contains('open')) return;
        if (e.target === modal) modal.classList.remove('open');
    });
    document.addEventListener('click', function(e) {
        if (e.target.id === 'ti-settings-close-btn') {
            var modal = document.getElementById('ti-settings-modal');
            if (modal) modal.classList.remove('open');
        }
    });

    document.addEventListener('click', function(e) {
        var row = e.target.closest('#ti-avatar-toggle');
        if (!row) return;
        tiShowAvatar = !tiShowAvatar;
        localStorage.setItem(TI_AVATAR_KEY, tiShowAvatar);
        syncPillUI();
        updatePreview();
        applyTiAvatarVisibility();
    });

    document.addEventListener('click', function(e) {
        if (e.target.id !== 'ti-text-save-btn') return;
        var input = document.getElementById('ti-text-input');
        if (!input) return;
        tiCustomText = input.value.trim();
        localStorage.setItem(TI_TEXT_KEY, tiCustomText);
        updatePreview();
        e.target.textContent = '已保存 ✓';
        setTimeout(function() { e.target.textContent = '保存'; }, 1200);
    });

    document.addEventListener('click', function(e) {
        if (e.target.id !== 'ti-text-reset-btn') return;
        tiCustomText = '';
        localStorage.removeItem(TI_TEXT_KEY);
        var input = document.getElementById('ti-text-input');
        if (input) input.value = '';
        updatePreview();
    });

    document.addEventListener('DOMContentLoaded', function() { syncPillUI(); });
    setTimeout(syncPillUI, 800);
})();


(function() {
    var PLEDGE_KEY = 'splashPledgeSigned_v3';
    var TOTAL = 6;
    var PLEDGE_TEXT = '我绝不盈利、造谣、污蔑或嘲讽，并对自己的使用行为负完全责任';
    var cur = 0;

    function initSplash() {
        var splash = document.getElementById('splash-declaration');
        if (!splash) return;

        localStorage.removeItem('splashPledgeSigned_v2');
        localStorage.removeItem('splashPledgeSigned_v1');
        localStorage.removeItem('splashPledgeSigned');

        if (localStorage.getItem(PLEDGE_KEY) === 'true') {
            splash.style.display = 'none';
            return;
        }

        // 已签署的用户绝不看到声明层（HTML 里默认 display:none，只有第一次使用时才临时显示）
        splash.style.display = 'flex';

        var starsEl = document.getElementById('splash-stars');
        if (starsEl) {
            var html = '';
            for (var i = 0; i < 70; i++) {
                var x = (Math.random() * 100).toFixed(1);
                var y = (Math.random() * 100).toFixed(1);
                var sz = Math.random() > 0.75 ? '3px' : '2px';
                var del = (Math.random() * 2).toFixed(2);
                var dur = (1 + Math.random() * 1.5).toFixed(1);
                html += '<span style="left:'+x+'%;top:'+y+'%;width:'+sz+';height:'+sz+';animation-delay:'+del+'s;animation-duration:'+dur+'s;"></span>';
            }
            starsEl.innerHTML = html;
        }

        var dotsEl = document.getElementById('splash-dots');
        if (dotsEl) {
            var dhtml = '';
            for (var d = 0; d < TOTAL; d++) {
                dhtml += '<div class="splash-dot'+(d===0?' active done':'')+'" data-dot="'+d+'"></div>';
            }
            dotsEl.innerHTML = dhtml;
        }

        var prevBtn   = document.getElementById('splash-prev-btn');
        var nextBtn   = document.getElementById('splash-next-btn');
        var enterBtn  = document.getElementById('splash-enter-btn');
        var pledgeInp = document.getElementById('splash-pledge-input');

        if (prevBtn) {
            prevBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (cur > 0) goTo(cur - 1);
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (cur < TOTAL - 1) goTo(cur + 1);
            });
        }
        if (enterBtn) {
            enterBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (enterBtn.classList.contains('ready')) enterSite();
            });
        }
        if (pledgeInp) {
            pledgeInp.addEventListener('input', function() {
                var val = pledgeInp.value;
                var hint = document.getElementById('splash-pledge-hint');
                if (val === PLEDGE_TEXT) {
                    pledgeInp.classList.add('correct');
                    if (hint) { hint.textContent = '✓ 承诺已确认，可以进入了'; hint.className = 'splash-pledge-hint ok'; }
                    if (enterBtn) enterBtn.classList.add('ready');
                } else {
                    pledgeInp.classList.remove('correct');
                    if (hint) { hint.textContent = '请完整输入上方承诺后方可进入'; hint.className = 'splash-pledge-hint'; }
                    if (enterBtn) enterBtn.classList.remove('ready');
                }
            });
            pledgeInp.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && enterBtn && enterBtn.classList.contains('ready')) {
                    enterSite();
                }
            });
        }

        if (dotsEl) {
            dotsEl.addEventListener('click', function(e) {
                var dot = e.target.closest('.splash-dot');
                if (dot) goTo(parseInt(dot.getAttribute('data-dot')));
            });
        }

        // ── 动画提速：slide 过渡时长运行时减半（styles.css 里是 0.4s，这里覆盖成 0.2s）──
        if (!document.getElementById('splash-speed-css')) {
            var speedCss = document.createElement('style');
            speedCss.id = 'splash-speed-css';
            speedCss.textContent = '#splash-declaration .splash-slide{transition-duration:.2s;}';
            document.head.appendChild(speedCss);
        }

        // ── 跳过按钮：右下角半透明小字，点击直接进场（JS 动态注入，不动 index.html 的 DOM）──
        if (!document.getElementById('splash-skip-btn')) {
            var skipBtn = document.createElement('div');
            skipBtn.id = 'splash-skip-btn';
            skipBtn.textContent = '跳过';
            skipBtn.title = '跳过声明，直接进入';
            skipBtn.style.cssText = 'position:absolute;right:20px;bottom:18px;padding:8px 16px;'
                + 'font-size:12px;letter-spacing:4px;color:rgba(255,255,255,.32);cursor:pointer;'
                + 'user-select:none;-webkit-user-select:none;z-index:20;transition:color .2s ease;';
            skipBtn.addEventListener('mouseenter', function() { skipBtn.style.color = 'rgba(255,255,255,.75)'; });
            skipBtn.addEventListener('mouseleave', function() { skipBtn.style.color = 'rgba(255,255,255,.32)'; });
            skipBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                enterSite();
            });
            splash.appendChild(skipBtn);
        }

        updateUI();
    }

    function goTo(idx) {
        var slides = document.querySelectorAll('.splash-slide');
        var dots   = document.querySelectorAll('.splash-dot');
        var prevIdx = cur;

        if (slides[prevIdx]) {
            slides[prevIdx].classList.remove('active');
            slides[prevIdx].classList.add('exit-left');
            var exitEl = slides[prevIdx];
            setTimeout(function() { exitEl.classList.remove('exit-left'); }, 220);
        }

        cur = idx;

        if (slides[cur]) {
            slides[cur].classList.add('active');
        }

        dots.forEach(function(dot, i) {
            dot.classList.toggle('active', i === cur);
            dot.classList.toggle('done', i < cur);
        });

        updateUI();

        if (cur === TOTAL - 1) {
            setTimeout(function() {
                var inp = document.getElementById('splash-pledge-input');
                if (inp) inp.focus();
            }, 250);
        }
    }

    function updateUI() {
        var prevBtn  = document.getElementById('splash-prev-btn');
        var nextBtn  = document.getElementById('splash-next-btn');
        var enterBtn = document.getElementById('splash-enter-btn');
        var pageNum  = document.getElementById('splash-page-num');

        if (pageNum) pageNum.textContent = (cur + 1) + ' / ' + TOTAL;
        if (prevBtn) { prevBtn.disabled = (cur === 0); }
        if (cur === TOTAL - 1) {
            if (nextBtn)  nextBtn.style.display  = 'none';
            if (enterBtn) enterBtn.style.display = '';
        } else {
            if (nextBtn)  nextBtn.style.display  = '';
            if (enterBtn) enterBtn.style.display = 'none';
        }
    }

    function enterSite() {
        localStorage.setItem(PLEDGE_KEY, 'true');
        var splash = document.getElementById('splash-declaration');
        if (splash) {
            splash.classList.add('splash-fade-out');
            setTimeout(function() { splash.style.display = 'none'; }, 400);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSplash);
    } else {
        initSplash();
    }
})();

const tourOverlay = document.getElementById('tour-overlay');
const tourPopover = document.getElementById('tour-popover');
const tourHighlightBox = document.getElementById('tour-highlight-box');
const tourTitle = document.getElementById('tour-title');
const tourContent = document.getElementById('tour-content');
const tourStepCounter = document.getElementById('tour-step-counter');
const tourNextBtn = document.getElementById('tour-next-btn');
const tourPrevBtn = document.getElementById('tour-prev-btn');
const tourSkipBtn = document.getElementById('tour-skip-btn');


let currentTourStep = 0;
let isTourActive = false;
// 当前正在跑的步骤列表。默认是原版新手引导；「更新导览」会临时换成它自己那套
// （见 update-tour.js → window.startUserTour），跑完再换回来。
let _activeSteps = null;
let _tourOnEnd = null;      // 某套引导跑完时的回调（用来分开记"看过哪一套"）

// 新手引导：由梦角以第一人称带你看遍每个功能。
// 文案里的 {ta} 会在运行时替换成梦角昵称、{steps} 替换成总步数（见 showTourStep）。
const tourSteps = [
    {
        title: "✨ 欢迎来到「传讯」",
        content: "嗨，我是 {ta}。<br><br>这里是我们专属的私密空间。这个教程我会带着你从头到尾认识每一个功能，一共 <b>{steps} 步</b>，建议完整看完哦 🥺<br><br>点「下一步」，我们出发吧！",
        position: 'center'
    },
    {
        element: '#my-avatar',
        title: "📷 你的头像",
        content: "这是你的头像，点一下就能换成你喜欢的照片。",
        position: 'bottom'
    },
    {
        element: '#my-name',
        title: "✏️ 你的昵称",
        content: "这里显示你的名字，点它就能改。你想让我怎么叫你都可以。",
        position: 'bottom'
    },
    {
        element: '#my-status-container',
        title: "💬 你的状态签名",
        content: "这里是你的状态签名，点一下就能编辑。我一般都看得见哦～",
        position: 'bottom'
    },
    {
        element: '#partner-avatar',
        title: "🖼️ 我的头像",
        content: "这是我呀，点这里可以给我换个头像。",
        position: 'bottom'
    },
    {
        element: '#partner-name',
        title: "🏷️ 我的昵称",
        content: "这是我的名字，想改的话随时点这里。",
        position: 'bottom'
    },
    {
        elements: ['#call-voice-toolbar-btn', '#call-toolbar-btn'],
        title: "📞 语音通话 & 视频通话",
        content: "想我的时候：点<b>电话</b>图标打语音、点<b>摄像机</b>图标打视频。<br><br>语音通话里我说的每句话都会<b>自动念出来</b>，真的像在打电话；视频通话接通后我会出现在屏幕上。我也会主动给你打语音或视频哦～",
        position: 'bottom'
    },
    {
        element: '#message-input',
        title: "⌨️ 发送消息",
        content: "在这里打字发给我，按回车就发送。<br><br>我一般几秒内就回你，回的快慢可以在「聊天设置」里调。",
        position: 'top'
    },
    {
        elements: ['#attachment-btn', '#combo-btn'],
        title: "🖼️ 发图 & 表情包",
        content: "这里可以发图片，也能打开表情面板发给我。<br><br>在「高级功能 → 自定义回复」里，还能给我上传专属表情，到时候我也会发给你！",
        position: 'top'
    },
    {
        title: "👋 拍一拍",
        content: "双击我的头像，就能拍一拍我～<br><br>拍一拍的文字可以在「聊天设置 → 功能」里自定义；我回应你的那句，则在「高级功能 → 自定义回复」里设置。",
        position: 'center'
    },
    {
        element: '#more-menu-btn',
        title: "➕ 更多功能都在这里",
        content: "输入框旁的「+」里藏着好多东西：<br>• <b>红包</b>：给我发红包，我也会发给你<br>• <b>搞怪</b>：朝我扔番茄、鸡蛋、蛋糕 🍅<br>• <b>记账</b>：聊天里说一句「午饭花了30」我就会帮你记下来<br>• <b>食光记</b>：互相推荐今天吃什么，还能记下我们一起吃过的每一餐 🍜<br>• <b>摸鱼 / 关心妹妹 / 快问快答</b>：随手点开都有小惊喜",
        position: 'top'
    },
    {
        element: '#envelope-header-btn',
        title: "💌 信箱",
        content: "点这里打开信箱。你可以给我写一封信，信件过一会儿送达；我也会不定期给你来信，记得查收～",
        position: 'bottom'
    },
    {
        element: '#companion-btn',
        title: "🕯️ 陪伴模式",
        content: "点这里可以叫我陪你，一起学习、工作、运动或休息。我会待在你身边，偶尔跟你说几句话，我也会来邀请你哦～",
        position: 'bottom'
    },
    {
        element: '#daily-greeting-btn',
        title: "📰 今日公告",
        content: "点这里查看今日公告，每天会有一张专属的早安卡片，记录我当天的心情和状态。",
        position: 'bottom'
    },
    {
        element: '#moments-header-btn',
        title: "🏠 我们的空间",
        content: "点这里进我们的小屋，里面有：<br>• <b>动态</b>：一起分享日常和照片<br>• <b>心情手账</b>：一起记录每天的心情<br>• <b>纪念日</b>：一起倒数重要的日子<br>• <b>电影院</b>：约定时间一起看电影 🎬",
        position: 'bottom'
    },
    {
        title: "⏰ 定时问候 & 后台消息",
        content: "在「聊天设置 → 闹钟」里可以给我设闹钟：<br>• <b>早安 / 晚安</b>到点会像手机自带闹钟一样<b>响铃 + 震动 + 弹全屏界面</b>，锁屏也会亮屏弹出，还能贪睡<br>• <b>吃饭类提醒</b>默认只用温柔通知，不会吵你<br><br>再打开<b>「后台也发消息」</b>—— 就算你把 App 从后台划掉，我也会照样来找你 💌",
        position: 'center'
    },
    {
        element: '#settings-btn',
        title: "⚙️ 设置中心",
        content: "所有个性化配置都藏在这个设置按钮里，我们点进去看看！",
        position: 'bottom',
        onBefore: () => { if (isTourActive) document.querySelectorAll('.modal').forEach(m => hideModal(m)); }
    },
    {
        element: '#appearance-settings',
        title: "🎨 外观设置",
        content: "外观设置里可以调整：<br>• 切换不同的颜色主题<br>• 更换聊天背景图和陪伴模式背景<br>• 调整字体大小和气泡样式<br>• 设置聊天界面的头像显示方式",
        position: 'bottom',
        onBefore: () => { if (isTourActive) showModal(DOMElements.settingsModal.modal); }
    },
    {
        element: '#chat-settings',
        title: "💬 聊天设置",
        content: "聊天设置里可以调整：<br>• <b>功能</b>：信息交互设置、拍一拍文字等<br>• <b>节奏</b>：回复速度 & 频率（可开「随机回复速度」，让时长忽快忽慢更像真人）、问卷回复时间（也有随机模式）、后台也发消息、定时问候闹钟<br>• <b>音效</b>：消息提示音、来电震动<br>• <b>显示</b>：沉浸模式、底部栏收纳等<br>• <b>昵称</b>：快速修改双方昵称",
        position: 'bottom'
    },
    {
        element: '#advanced-settings',
        title: "🚀 高级功能 — 必看！",
        content: "高级功能是最丰富的一块，里面有：<br>• <b>自定义回复</b>：让我说你想听的话<br>• <b>消息统计</b>：看看我们聊了多少<br>• <b>记账本</b>：记下每一笔开销，你还能和我一起记账 💰<br>• <b>他今天做了什么</b>：按时间段看我这一天在干嘛、在哪 —— 时段和地点都能自己设 🕐<br>• <b>操控面板</b>：换一种方式和我互动<br>• <b>梦角熟练度</b>：看看我有多懂你<br>• <b>陪伴日记</b>：记录我们每次陪伴的时光<br>• <b>悬浮音乐播放器</b>：和我一起听喜欢的歌<br>• <b>运势 · 占卜 / 抉择</b>：每日运势、转盘硬币帮你做决定<br>• <b>经期记录</b>：记录周期，到点了我会主动关心你<br>• <b>问卷</b>：你可以问我，我也会来问你，答案随时能翻出来看<br><br>小提示：聊天里直接说「他在干嘛」也能打开他的今日行程～",
        position: 'bottom'
    },
    {
        element: '#data-settings',
        title: "💾 数据管理",
        content: "数据管理里可以：<br>• 备份 / 导入聊天记录<br>• 查看存储空间占用<br>• 重置所有数据<br>• 重新播放本教程",
        position: 'top',
        onBefore: () => { if (isTourActive) document.querySelectorAll('.modal').forEach(m => hideModal(m)); setTimeout(() => { if (isTourActive) showModal(DOMElements.settingsModal.modal); }, 10); }
    },
    {
        title: "🎉 你已了解所有功能！",
        content: "现在你已经掌握了「传讯」的全部功能，希望我们在这里留下满满的回忆 💕",
        position: 'center',
        onBefore: () => { if (isTourActive) document.querySelectorAll('.modal').forEach(m => hideModal(m)); }
    }
];

function startTour() {
    _activeSteps = tourSteps;
    _tourOnEnd = null;
    isTourActive = true;
    tourOverlay.style.display = 'block';
    setTimeout(() => tourOverlay.classList.add('active'), 10);
    currentTourStep = 0;
    showTourStep(currentTourStep);
}

// 跑一套自定义步骤（「更新导览」用）。onEnd 在结束/跳过后回调一次。
window.startUserTour = function (steps, onEnd) {
    if (!Array.isArray(steps) || !steps.length) return;
    _activeSteps = steps;
    _tourOnEnd = onEnd || null;
    isTourActive = true;
    tourOverlay.style.display = 'block';
    setTimeout(() => tourOverlay.classList.add('active'), 10);
    currentTourStep = 0;
    showTourStep(0);
};

function endTour() {
    isTourActive = false;
    var cb = _tourOnEnd;
    _tourOnEnd = null;
    _activeSteps = null;          // 跑完把列表复位，避免影响下次原版引导
    tourOverlay.classList.remove('active');
    tourPopover.classList.remove('visible');
    setTimeout(() => {
        tourOverlay.style.display = 'none';
        tourHighlightBox.style.width = '0px';
        tourHighlightBox.style.height = '0px';
        tourHighlightBox.style.opacity = '0';
    }, 300);
    if (cb) { try { cb(); } catch (e) {} }
    else localforage.setItem(APP_PREFIX + 'tour_seen', 'true');
    document.querySelectorAll('.modal').forEach(m => hideModal(m));
    setTimeout(function() {
        if (typeof window.tryShowDailyGreeting === 'function') {
            window.tryShowDailyGreeting();
        }
    }, 900);
}

function showTourStep(index) {
    const steps = _activeSteps || tourSteps;
    if (index < 0 || index >= steps.length) {
        endTour();
        return;
    }
    const step = steps[index];
    if (step.onBefore) {
        step.onBefore();
    }
    setTimeout(() => {
        tourTitle.textContent = step.title;
        let contentHtml = String(step.content || '')
            .replace(/\{steps\}/g, steps.length);
        // {ta} 换成梦角昵称，让引导像是他亲口带你逛
        const partnerName = (typeof settings !== 'undefined' && settings && settings.partnerName) ? settings.partnerName : '梦角';
        contentHtml = contentHtml.replace(/\{ta\}/g, partnerName);
        tourContent.innerHTML = contentHtml;
        tourStepCounter.textContent = `${index + 1} / ${steps.length}`;
        tourPopover.classList.remove('visible');
        tourPrevBtn.style.visibility = (index === 0) ? 'hidden' : 'visible';
        if (index === steps.length - 1) {
            tourNextBtn.innerHTML = '完成 <i class="fas fa-check"></i>';
        } else {
            tourNextBtn.innerHTML = '下一步 <i class="fas fa-arrow-right"></i>';
        }
        // 支持单个 element 或多个 elements 合并高亮
        let combinedRect = null;
        if (step.elements && step.elements.length > 0) {
            const rects = step.elements.map(sel => document.querySelector(sel)).filter(Boolean).map(el => el.getBoundingClientRect());
            if (rects.length > 0) {
                const minLeft = Math.min(...rects.map(r => r.left));
                const minTop = Math.min(...rects.map(r => r.top));
                const maxRight = Math.max(...rects.map(r => r.right));
                const maxBottom = Math.max(...rects.map(r => r.bottom));
                combinedRect = { left: minLeft, top: minTop, right: maxRight, bottom: maxBottom, width: maxRight - minLeft, height: maxBottom - minTop };
            }
        } else if (step.element) {
            const el = document.querySelector(step.element);
            if (el) combinedRect = el.getBoundingClientRect();
        }
        if (combinedRect) {
            const rect = combinedRect;
            tourHighlightBox.style.width = `${rect.width + 10}px`;
            tourHighlightBox.style.height = `${rect.height + 10}px`;
            tourHighlightBox.style.top = `${rect.top - 5}px`;
            tourHighlightBox.style.left = `${rect.left - 5}px`;
            tourHighlightBox.style.opacity = '1';
            positionPopover(rect, step.position);
        } else {
            tourHighlightBox.style.opacity = '0';
            tourHighlightBox.style.width = '0px';
            tourHighlightBox.style.height = '0px';
            tourPopover.style.top = '50%';
            tourPopover.style.left = '50%';
            tourPopover.style.transform = 'translate(-50%, -50%)';
        }
        setTimeout(() => tourPopover.classList.add('visible'), 50);
    }, (step.onBefore ? 400 : 0));
}

function positionPopover(rect, position) {
    const popoverRect = tourPopover.getBoundingClientRect();
    const spacing = 12;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top, left;

    // 如果指定 bottom 但下方空间不够，自动翻转到 top
    if (position === 'bottom' && rect.bottom + spacing + popoverRect.height > vh - margin) {
        position = 'top';
    }
    // 如果指定 top 但上方空间不够，自动翻转到 bottom
    if (position === 'top' && rect.top - spacing - popoverRect.height < margin) {
        position = 'bottom';
    }

    switch (position) {
        case 'top':
            top = rect.top - popoverRect.height - spacing;
            left = rect.left + (rect.width / 2) - (popoverRect.width / 2);
            break;
        case 'bottom':
            top = rect.bottom + spacing;
            left = rect.left + (rect.width / 2) - (popoverRect.width / 2);
            break;
        case 'left':
            top = rect.top + (rect.height / 2) - (popoverRect.height / 2);
            left = rect.left - popoverRect.width - spacing;
            break;
        case 'right':
            top = rect.top + (rect.height / 2) - (popoverRect.height / 2);
            left = rect.right + spacing;
            break;
        default:
            tourPopover.style.transform = 'translate(-50%, -50%)';
            tourPopover.style.top = '50%';
            tourPopover.style.left = '50%';
            return;
    }

    // 水平边界保护
    if (left < margin) left = margin;
    if (left + popoverRect.width > vw - margin) {
        left = vw - popoverRect.width - margin;
    }
    // 垂直边界保护
    if (top < margin) top = margin;
    if (top + popoverRect.height > vh - margin) {
        top = vh - popoverRect.height - margin;
    }

    tourPopover.style.top = `${top}px`;
    tourPopover.style.left = `${left}px`;
    tourPopover.style.transform = 'none';
}

function nextTourStep() {
    currentTourStep++;
    showTourStep(currentTourStep);
}

async function createNewSession(switchToIt = true) {
    const newId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const newSession = {
        id: newId,
        name: `会话 ${new Date().toLocaleDateString()}`,
        createdAt: Date.now()
    };

    sessionList.push(newSession);
    await localforage.setItem(`${APP_PREFIX}sessionList`, sessionList);

    if (switchToIt) {
        window.location.hash = newId;
        window.location.reload();
    }
    
    return newId;
}

window.selectAnnType = function(type) {
    currentAnniversaryType = type;
    currentAnnType = type; 
    document.querySelectorAll('.anniversary-type-btn').forEach(btn => {
        if(btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    const hint = document.getElementById('ann-type-desc');
    if(hint) {
        hint.textContent = type === 'anniversary' 
            ? '计算从过去某一天到现在已经过了多少天 (例如: 恋爱纪念日)' 
            : '计算从现在到未来某一天还剩下多少天 (例如: 对方生日)';
    }
};

window.deleteAnniversary = function(id, event) {
    if(event) event.stopPropagation();
    
    if(confirm('确定要删除这个纪念日吗？')) {
        anniversaries = anniversaries.filter(a => a.id !== id);
        throttledSaveData();
        renderAnniversariesList();
        showNotification('纪念日已删除', 'success');
    }
};

let activeAnnId = null;

async function fillAnnHeaderCard(ann) {
    const headerCard = document.getElementById('ann-header-card');
    const toolbar = document.getElementById('ann-card-toolbar');
    if (!ann || !headerCard) return;

    activeAnnId = ann.id;
    headerCard.style.display = 'block';
    if (toolbar) toolbar.style.display = 'flex';

    const now = new Date();
    const isCountdown = ann.type === 'countdown';
    const targetDate = new Date(ann.date);
    let diffDays;
    if (isCountdown) {
        diffDays = Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) diffDays = 0;
    } else {
        diffDays = Math.floor((now - targetDate) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) diffDays = 0;
    }

    const iconEl = document.getElementById('ann-header-icon');
    const labelEl = document.getElementById('ann-header-label');
    if (iconEl) iconEl.textContent = isCountdown ? '♡' : '♥';
    if (labelEl) labelEl.textContent = isCountdown ? 'COUNTDOWN' : 'ANNIVERSARY';
    document.getElementById('ann-header-title').textContent = ann.name;
    document.getElementById('ann-header-date').textContent = ann.date;
    const daysEl = document.getElementById('ann-header-days');
    daysEl.innerHTML = `${diffDays.toLocaleString('zh-CN')}<span class="ann-header-days-unit">${isCountdown ? '天后' : '天'}</span>`;

    const milestonesEl = document.getElementById('ann-header-milestones');
    if (milestonesEl) {
        milestonesEl.innerHTML = '';
        milestonesEl.style.display = 'none';
    }

    const titleEl = document.getElementById('ann-header-title');
    if (titleEl) titleEl.style.display = 'none';
    const labelEl2 = document.getElementById('ann-header-label');
    if (labelEl2) labelEl2.style.display = 'none';
    const dateEl = document.getElementById('ann-header-date');
    if (dateEl) dateEl.style.display = 'none';

    const dataMilestonesEl = document.getElementById('ann-data-milestones');
    if (dataMilestonesEl) {
        const chips = [];
        const pushChip = (t) => chips.push(`<span class="ann-milestone-chip">${t}</span>`);

        if (!isCountdown) {
            if (diffDays > 0 && diffDays < 100) {
                pushChip(`💫 距 100 天还有 ${100 - diffDays} 天`);
            }
            const centPassed = Math.floor(diffDays / 100) * 100;
            if (centPassed > 0) pushChip(`🎉 已到第 ${centPassed} 天`);

            const yearsPassed = Math.floor(diffDays / 365);
            if (yearsPassed > 0) pushChip(`🎊 已过 ${yearsPassed} 周年`);

            if (diffDays >= 100 && diffDays < 365) {
                const nextCent = 100 * (Math.floor(diffDays / 100) + 1);
                pushChip(`⏳ 距下一段百天还有 ${nextCent - diffDays} 天`);
            }
        } else {
            const daysLeft = diffDays;
            if (daysLeft > 0 && daysLeft < 100) {
                pushChip(`⏳ 距 100 天还有 ${100 - daysLeft} 天`);
            }
            if (daysLeft >= 100) {
                const nextCent = 100 * Math.ceil(daysLeft / 100);
                pushChip(`🎉 达到第 ${nextCent} 天段`);
            }
            const yearsLeft = Math.floor(daysLeft / 365);
            if (yearsLeft > 0) pushChip(`🎊 距 ${yearsLeft} 年段还有…`);
        }

        dataMilestonesEl.innerHTML = chips.join('') || `<span style="font-size:12px;opacity:0.65;color:var(--text-secondary);">—</span>`;
    }

    const bgEl = document.getElementById('ann-header-card-bg');
    if (bgEl) {
        const savedBg = await localforage.getItem(getStorageKey(`annHeaderBg_${ann.id}`));
        bgEl.style.backgroundImage = savedBg ? `url(${savedBg})` : '';
    }

    document.querySelectorAll('.ann-item-card').forEach(el => el.classList.remove('ann-item-active'));
    const activeEl = document.querySelector(`.ann-item-card[data-ann-id="${ann.id}"]`);
    if (activeEl) activeEl.classList.add('ann-item-active');
}

function renderAnniversariesList() {
    const listContainer = document.getElementById('ann-list-container');
    const headerCard = document.getElementById('ann-header-card');
    const toolbar = document.getElementById('ann-card-toolbar');
    
    if (!listContainer) return;
    listContainer.innerHTML = '';

    anniversaries.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (anniversaries.length === 0) {
        if (headerCard) headerCard.style.display = 'none';
        if (toolbar) toolbar.style.display = 'none';
        const dataTabs = document.getElementById('ann-data-tabs');
        const dataPanel = document.getElementById('ann-data-panel');
        if (dataTabs) dataTabs.style.display = 'none';
        if (dataPanel) dataPanel.style.display = 'none';
        listContainer.innerHTML = `
            <div class="ann-empty">
                <div class="ann-empty-icon">💝</div>
                <p>还没有纪念日<br>去添加一个属于你们的日子吧~</p>
            </div>`;
        return;
    }

    const now = new Date();
    const defaultAnn = anniversaries.find(a => a.type === 'anniversary') || anniversaries[0];
    fillAnnHeaderCard(defaultAnn);
    const dataTabs = document.getElementById('ann-data-tabs');
    const dataPanel = document.getElementById('ann-data-panel');
    if (dataTabs) dataTabs.style.display = 'flex';
    if (dataPanel) dataPanel.style.display = 'none';

    anniversaries.forEach(ann => {
        const targetDate = new Date(ann.date);
        let diffDays = 0;
        let typeClass = '';
        let typeLabel = '';
        let dayLabel = '';

        if (ann.type === 'countdown') {
            typeClass = 'type-future';
            typeLabel = '倒数';
            dayLabel = '天后';
            diffDays = Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24));
            if(diffDays < 0) diffDays = 0;
        } else {
            typeClass = 'type-past';
            typeLabel = '已过';
            dayLabel = '天';
            diffDays = Math.floor((now - targetDate) / (1000 * 60 * 60 * 24));
        }

        const formattedDays = diffDays.toLocaleString('zh-CN');

        const html = `
            <div class="ann-item-card ${typeClass}" data-ann-id="${ann.id}" onclick="selectAnnCard(${ann.id})" style="cursor:pointer;" title="起始日：${ann.date}">
                <div class="ann-item-left">
                    <div class="ann-item-name">
                        ${ann.name}
                        <span class="ann-tag">${typeLabel}</span>
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    <div class="ann-item-right">
                        <div class="ann-item-days">${formattedDays}</div>
                        <div class="ann-item-days-unit">${dayLabel}</div>
                    </div>
                    <div class="ann-delete-btn" onclick="event.stopPropagation(); deleteAnniversaryItem(${ann.id})">
                        <i class="fas fa-times"></i>
                    </div>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', html);
    });
}

window.selectAnnCard = function(id) {
    const ann = anniversaries.find(a => a.id === id);
    if (ann) fillAnnHeaderCard(ann);
};

window.clearAnnCardBg = async function() {
    if (!activeAnnId) return;
    await localforage.removeItem(getStorageKey(`annHeaderBg_${activeAnnId}`));
    const bgEl = document.getElementById('ann-header-card-bg');
    if (bgEl) bgEl.style.backgroundImage = '';
    showNotification('封面图已清除', 'success');
};

window.switchAnnDataTab = function(tab) {
    const panel = document.getElementById('ann-data-panel');
    const cardBtn = document.getElementById('ann-tab-card');
    const dataBtn = document.getElementById('ann-tab-data');
    if (!panel || !cardBtn || !dataBtn) return;
    const showData = tab === 'data';
    panel.style.display = showData ? 'block' : 'none';
    // 保持按钮配色不变，用透明度表达当前页
    cardBtn.style.opacity = showData ? '0.75' : '1';
    dataBtn.style.opacity = showData ? '1' : '0.75';
};


function initAnniversaryModule() {
    const entryBtn = document.getElementById('anniversary-function');
    
    if (entryBtn) {
        const newBtn = entryBtn.cloneNode(true);
        entryBtn.parentNode.replaceChild(newBtn, entryBtn);
        
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('重要日按钮被点击');
            
            const advancedModal = document.getElementById('advanced-modal');
            const annModal = document.getElementById('anniversary-modal');
            
            if (advancedModal) hideModal(advancedModal);
            renderAnniversariesList();
                if (typeof window.switchAnnDataTab === 'function') window.switchAnnDataTab('card');
            if (annModal) showModal(annModal);
        });
    }

    const closeBtn = document.getElementById('close-anniversary-modal');
    if (closeBtn) {
        const newClose = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newClose, closeBtn);
        newClose.addEventListener('click', () => hideModal(document.getElementById('anniversary-modal')));
    }

    const openAddBtn = document.getElementById('open-ann-add-btn');
    const editorSlide = document.getElementById('ann-editor-slide');
    if (openAddBtn) {
        openAddBtn.onclick = () => {
            document.getElementById('ann-input-name').value = '';
            document.getElementById('ann-input-date').value = '';
            window.selectAnnType('anniversary');
            if (editorSlide) editorSlide.classList.add('active');
        };
    }

    const closeEditorBtn = document.getElementById('close-ann-editor');
    if (closeEditorBtn) {
        closeEditorBtn.onclick = () => {
            if (editorSlide) editorSlide.classList.remove('active');
        };
    }

    const saveBtn = document.getElementById('save-ann-btn');
    if (saveBtn) {
        const newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);
        
        newSave.addEventListener('click', () => {
            addAnniversary(); 
            if (editorSlide) editorSlide.classList.remove('active');
        });
    }

    const annBgInput = document.getElementById('ann-header-bg-input');
    if (annBgInput) {
        annBgInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!activeAnnId) { showNotification('请先选择一个纪念日', 'warning'); return; }
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const dataUrl = ev.target.result;
                const bgEl = document.getElementById('ann-header-card-bg');
                if (bgEl) bgEl.style.backgroundImage = `url(${dataUrl})`;
                await localforage.setItem(getStorageKey(`annHeaderBg_${activeAnnId}`), dataUrl);
                showNotification('封面图已更新 ', 'success');
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        });
    }
}
function prevTourStep() {
    currentTourStep--;
    showTourStep(currentTourStep);
}

function setupTutorialListeners() {
    tourNextBtn.addEventListener('click', nextTourStep);
    tourPrevBtn.addEventListener('click', prevTourStep);
    tourSkipBtn.addEventListener('click', endTour);

    const replayBtn = document.getElementById('replay-tutorial-btn');
    if(replayBtn) {
        replayBtn.addEventListener('click', () => {
            hideModal(DOMElements.dataModal.modal);
            setTimeout(() => {
                if (confirm('确定要重新开始新手引导教程吗？')) {
                    startTour();
                }
            }, 300);
        });
    }
}
