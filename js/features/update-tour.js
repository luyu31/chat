/* ────────────────────────────────────────────────────────────────
 * 本次更新的新手引导（更新导览）
 *
 * 复用 onboarding.js 里那套引导 UI（高亮框 + 气泡 + 上一步/下一步），
 * 只是换成另一套步骤内容 —— 那边新增了 window.startUserTour(steps, onEnd)。
 *
 * 触发方式：
 *   1. 更新后第一次打开，自动跑一次（老用户专属：已经看过原版引导的人）
 *   2. 设置里那一行「新功能导览」随时可以再看
 *   3. 控制台 window.startUpdateTour() 也能手动跑
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var KEY = 'update_tour_v1_seen';   // 存 localforage，带 App 前缀

    function _prefix() {
        return (typeof APP_PREFIX !== 'undefined' && APP_PREFIX) ? APP_PREFIX : 'CHAT_APP_V3_';
    }

    var steps = [
        {
            title: '🎉 首页变了',
            content: '这次更新把「一打开就是聊天」换成了<b>微信那样的一页</b>：上面是会话列表，下面是标签。<br><br>我带你走一圈，一共 <b>{steps} 步</b>，很快的～',
            position: 'center'
        },
        {
            element: '#wx-conv-list',
            title: '💬 会话列表',
            content: '每个梦角一条，右边是他最后说的话和时间。点哪条就进谁的聊天。',
            position: 'bottom'
        },
        {
            element: '#wx-add-btn',
            title: '➕ 可以有很多个梦角',
            content: '点这里加新梦角。每个梦角的<b>聊天记录、字卡、纪念日、朋友圈都是各自独立的</b>，不会串。',
            position: 'bottom'
        },
        {
            element: '#wx-add-group',
            title: '👥 还能拉群聊',
            content: '点这里挑几个梦角拉一个群。<br><br>群里每个人<b>用他自己的名字、头像和你给他写的字卡</b>说话 —— 你一句我一句，不是同一个人换名字。',
            position: 'bottom'
        },
        {
            element: '#wx-tab-moments',
            title: '🌏 朋友圈',
            content: '点这里进「朋友圈」。梦角多了会先问你<b>看谁的朋友圈</b>，选完直接进他那一页。',
            position: 'top'
        },
        {
            title: '💬 朋友圈里的「回复 @谁」',
            content: '在朋友圈底下评论、互相回复时，会像真正的社交软件那样<b>一层一层显示</b>：「谁 回复 @谁」，再加上缩进的小卡片。<br><br>他回你、你回他，一眼就能看出谁在跟谁说话。',
            position: 'center'
        },
        {
            title: '🪪 点开联系人的资料页',
            content: '在「我的梦角」里点某个联系人，进的是他的<b>资料页</b>：头像、昵称、签名、在线状态，下面只有 <b>4 项</b> —— 发消息 / 编辑主页 / 在线状态 / 聊天背景。<br><br>改别人的资料不用先切过去，会直接写进他自己的存档。',
            position: 'center'
        },
        {
            title: '📞 电话是真的「电话」了',
            content: '语音通话一接通，<b>他说的每一句都会变成语音条并自动依次播放</b>，像真的在打电话；视频通话保持原来的样子。<br><br>另外他发语音时，<b>颜文字不会再被念出来了</b>（以前会把「括号波浪线」读出来，很出戏）。',
            position: 'center'
        },
        {
            title: '🎬 嫌动画慢可以关掉',
            content: '设置里新增了两个开关：<b>进入动画</b>（开屏直接消失，不等渐隐）和<b>进入家园动画</b>（点进情侣空间瞬间到位，不滑那一下）。<br><br>想快点进去就把它俩关掉。',
            position: 'center'
        },
        {
            title: '✨ 都带你逛完了',
            content: '以上都是这次更新加上去的。<br><br>有想再看一遍的地方，去 <b>设置 → 新功能导览</b> 就能重看；也可以随时找我聊天 💕',
            position: 'center'
        }
    ];

    function markSeen() {
        try { localforage.setItem(_prefix() + KEY, 'true'); } catch (e) {}
    }

    function start() {
        if (typeof window.startUserTour !== 'function') {
            console.warn('[update-tour] 引导系统未就绪');
            return;
        }
        // 先把可能挡着的东西收起来，不然高亮框找不到元素
        try {
            var dm = document.getElementById('disclaimer-modal');
            if (dm) dm.style.display = 'none';
        } catch (e) {}
        window.startUserTour(steps, markSeen);
    }

    window.startUpdateTour = start;
    window.UPDATE_TOUR_STEPS = steps;

    // ─── 设置里注入一行「新功能导览」 ───
    function injectSettingsRow() {
        if (document.getElementById('update-tour-row')) return;
        var anchor = document.getElementById('entry-anim-toggle');   // 上个版本加的动画开关行，拿它当锚点
        if (!anchor) return;
        var row = document.createElement('div');
        row.className = 'setting-pill-row';
        row.id = 'update-tour-row';
        row.style.borderTop = '1px solid var(--border-color)';
        row.style.cursor = 'pointer';
        row.innerHTML =
            '<span class="setting-pill-icon"><i class="fas fa-graduation-cap"></i></span>' +
            '<span class="setting-pill-label">新功能导览 <span style="font-size:11px;color:var(--text-secondary);font-weight:400;">再看看这次更新都加了什么</span></span>' +
            '<span style="color:var(--text-secondary);font-size:12px;"><i class="fas fa-chevron-right"></i></span>';
        row.addEventListener('click', function () { start(); });
        anchor.parentNode.insertBefore(row, anchor.nextSibling);
    }

    // ─── 更新后第一次打开，自动跑一遍（只对老用户：已经看过原版引导的） ───
    function maybeAutoRun() {
        Promise.resolve()
            .then(function () { return localforage.getItem(_prefix() + 'tour_seen'); })
            .then(function (baseSeen) {
                if (!baseSeen) return;    // 全新用户：让他先走原版引导，别叠着来
                return localforage.getItem(_prefix() + KEY).then(function (seen) {
                    if (seen) return;
                    setTimeout(function () {
                        // 原版引导正在跑 / 有弹窗挡着 就先不打扰
                        if (typeof isTourActive !== 'undefined' && isTourActive) return;
                        start();
                    }, 2600);
                });
            })
            .catch(function (e) { console.warn('[update-tour] 检查失败', e); });
    }

    document.addEventListener('DOMContentLoaded', function () {
        injectSettingsRow();
        maybeAutoRun();
    });
    setTimeout(function () { injectSettingsRow(); }, 1200);
    setTimeout(function () { injectSettingsRow(); }, 3000);
})();
