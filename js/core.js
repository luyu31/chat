/*核心应用逻辑：数据加载保存、消息渲染、会话管理等*/

// 梦角回复消息的多监听通道（跟 window._onPartnerMessage 单函数钩子并行，互不覆盖）
// 需要监听"梦角发了消息"这个事件的新模块，用 window._registerPartnerMessageListener(fn) 注册，
// 不要直接赋值 window._onPartnerMessage，那个是给旧模块（陪伴模块）用的，赋值会覆盖掉它。
window._partnerMessageListeners = window._partnerMessageListeners || [];
window._registerPartnerMessageListener = window._registerPartnerMessageListener || function (fn) {
    if (typeof fn === 'function') window._partnerMessageListeners.push(fn);
};

        function clearAllAppData() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
    overlay.innerHTML = `
        <div style="background:var(--secondary-bg);border-radius:20px;padding:24px;width:88%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:modalContentSlideIn 0.3s ease forwards;">
            <div style="text-align:center;margin-bottom:20px;">
                <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,80,80,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
                    <i class="fas fa-trash-alt" style="color:#ff5050;font-size:20px;"></i>
                </div>
                <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">重置数据</div>
                <div style="font-size:12px;color:var(--text-secondary);">请选择要重置的范围</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
                <button id="_reset_current" style="width:100%;padding:12px 16px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);color:var(--text-primary);font-size:13px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:all 0.2s;">
                    <i class="fas fa-comment-slash" style="color:var(--accent-color);font-size:15px;width:18px;text-align:center;"></i>
                    <span>仅清除当前会话消息</span>
                </button>
                <button id="_reset_all" style="width:100%;padding:12px 16px;border:1px solid rgba(255,80,80,0.3);border-radius:12px;background:rgba(255,80,80,0.06);color:#ff5050;font-size:13px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:all 0.2s;">
                    <i class="fas fa-bomb" style="font-size:15px;width:18px;text-align:center;"></i>
                    <span>重置所有数据（完全清空）</span>
                </button>
                <button id="_reset_cancel" style="width:100%;padding:10px 16px;border:none;border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;transition:all 0.2s;">取消</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    function closeDialog() { overlay.remove(); }
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
    const _resetCancelBtn = document.getElementById('_reset_cancel');
    const _resetCurrentBtn = document.getElementById('_reset_current');
    const _resetAllBtn = document.getElementById('_reset_all');

    if (_resetCancelBtn) _resetCancelBtn.onclick = closeDialog;

    if (_resetCurrentBtn) _resetCurrentBtn.onclick = () => {
        closeDialog();
        if (confirm('确定要清除当前会话的所有消息吗？此操作无法恢复！')) {
            messages = [];
            window.messages = messages; // 双保险：同步 window 属性
            displayedMessageCount = HISTORY_BATCH_SIZE;
            msgViewMode = 'latest'; // 清空消息了，历史浏览模式的窗口下标肯定全部失效，一并重置
            newMsgCountWhileBrowsing = 0;
            if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();

            // 立即清除本会话的 localStorage 备份，防止 _tryRecoverFromBackup 在 IndexedDB 写入前恢复旧消息
            try { _clearLocalBackup(); } catch(e) {}

            // 直接写入 IndexedDB（跳过 500ms 防抖），确保刷新后不恢复
            localforage.setItem(getStorageKey('chatMessages'), []).catch(() => {});

            renderMessages();
            showNotification('当前会话消息已清除', 'success');
        }
    };

    if (_resetAllBtn) _resetAllBtn.onclick = () => {
        closeDialog();
        if (confirm('【高危操作】确定要重置所有数据吗？此操作将清除所有本地数据且无法恢复！')) {
            window._skipBackup = true;
            messages = [];
            settings = {};
            localforage.clear().then(() => {
                localStorage.clear();
                showNotification('所有数据已重置，页面即将刷新', 'info', 2000);
                setTimeout(() => { window.location.href = window.location.pathname + '?reset=' + Date.now(); }, 2000);
            }).catch(e => {
                window._skipBackup = false;
                showNotification('清除数据时发生错误', 'error');
                console.error("清除 localforage 失败:", e);
            });
        }
    };
}

// 把 messages[startIdx, endIdxExclusive) 这一批更早的消息，直接插到聊天区域最上面——
// 不清空、不重画已经显示着的内容，所以不会有"整个区域先藏起来再露出来"那种白屏闪烁
function _prependOlderMessages(startIdx, endIdxExclusive) {
    const container = DOMElements.chatContainer;
    const batch = messages.slice(startIdx, endIdxExclusive);
    if (!batch.length || !container) return;

    const fragment = new DocumentFragment();
    let lastSenderRef = { current: null };
    batch.forEach((msg, i) => {
        const globalIdx = startIdx + i;
        const prevMsg = globalIdx > 0 ? messages[globalIdx - 1] : null;
        const nextMsg = messages[globalIdx + 1] || null; // 批次内的下一条，或者已经渲染在下面的那一条，都能正确取到
        const msgFragment = createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef);
        fragment.appendChild(msgFragment);
    });

    // 最上面固定有一个用来撑高度的占位div（spacer），新内容要插在它后面、原有消息前面
    const spacer = container.querySelector('div[style*="flex: 1"]');
    const insertBeforeNode = spacer ? spacer.nextSibling : container.firstChild;

    // 聊天框本身开着"平滑滚动"效果（CSS scroll-behavior: smooth），这跟"瞬间精确挪到某个位置"是冲突的——
    // 不临时关掉的话，下面这行补偿滚动条位置的操作会被浏览器理解成"慢慢滑过去"，
    // 读到的中间值就会不准，视觉上也会变成"先加载、又滑到别的地方"，这正是这次要修的问题
    const prevScrollBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';

    const oldScrollHeight = container.scrollHeight;
    if (insertBeforeNode) {
        container.insertBefore(fragment, insertBeforeNode);
    } else {
        container.appendChild(fragment);
    }
    // 上面新插入了这么多高度，滚动条也跟着往下挪同样的距离，视觉上就像"没有动过"，用户能无缝接着往上看
    const newScrollHeight = container.scrollHeight;
    container.scrollTop += (newScrollHeight - oldScrollHeight);

    container.style.scrollBehavior = prevScrollBehavior || '';
}

// 把 messages[startIdx, endIdxExclusive) 这一批更晚的消息，直接接在聊天区域最下面——
// 同样不清空重画，往下追加不会影响当前已经看到的内容和滚动位置，不需要额外补偿滚动条
function _appendNewerMessages(startIdx, endIdxExclusive) {
    const container = DOMElements.chatContainer;
    const batch = messages.slice(startIdx, endIdxExclusive);
    if (!batch.length || !container) return;

    const fragment = new DocumentFragment();
    // lastSenderRef 要先接上"当前已经渲染的最后一条是谁发的"，不然本来该合并显示的头像/时间会重复冒出来
    let lastSenderRef = { current: null };
    if (startIdx > 0) {
        const lastRenderedMsg = messages[startIdx - 1];
        const prevGroupMember = (lastRenderedMsg.sender !== 'user' && typeof getGroupMemberForMessage === 'function') ? getGroupMemberForMessage(lastRenderedMsg.id) : null;
        lastSenderRef.current = prevGroupMember ? ('group_' + prevGroupMember.name) : lastRenderedMsg.sender;
    }
    batch.forEach((msg, i) => {
        const globalIdx = startIdx + i;
        const prevMsg = globalIdx > 0 ? messages[globalIdx - 1] : null;
        const nextMsg = messages[globalIdx + 1] || null;
        const msgFragment = createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef);
        fragment.appendChild(msgFragment);
    });

    container.appendChild(fragment);
}

function loadMoreHistory() {
    const historyLoader = document.getElementById('history-loader');
    const container = DOMElements && DOMElements.chatContainer;
    const currentOldestMsgIndex = msgViewMode === 'window' ? msgWinStart : (messages.length - displayedMessageCount);

    if (!container) return;
    if (isLoadingHistory) return;

    if (currentOldestMsgIndex <= 0) {
        if (historyLoader) historyLoader.style.display = 'none';
        return;
    }

    isLoadingHistory = true;
    if (historyLoader) historyLoader.style.display = 'flex';

    // 消息本来就已经在内存里了，不是要发网络请求，这里保留一点延迟纯粹是为了让转圈动效能被看清楚、
    // 感觉更像"正在加载"，不会显得太突兀。真正的DOM操作只插入新增的这一批，不会有白屏闪烁。
    setTimeout(() => {
        const oldStart = msgViewMode === 'window' ? msgWinStart : Math.max(0, messages.length - displayedMessageCount);
        let newStart;
        if (msgViewMode === 'window') {
            msgWinStart = Math.max(0, msgWinStart - HISTORY_BATCH_SIZE);
            newStart = msgWinStart;
        } else {
            displayedMessageCount = Math.min(messages.length, displayedMessageCount + HISTORY_BATCH_SIZE);
            newStart = Math.max(0, messages.length - displayedMessageCount);
        }

        _prependOlderMessages(newStart, oldStart);

        const stillHasMore = msgViewMode === 'window' ? msgWinStart > 0 : (messages.length > displayedMessageCount);
        if (historyLoader) {
            historyLoader.style.display = stillHasMore ? 'flex' : 'none';
        }
        isLoadingHistory = false;
    }, 120);
}

// 往下翻，加载更晚的消息——跟 loadMoreHistory 对称，只在 window（历史浏览）模式下会用到，
// 正常的 latest 模式本来就已经渲染到最新消息了，没有"更晚"可以加载
function loadMoreFuture() {
    const futureLoader = document.getElementById('future-loader');
    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return;
    if (msgViewMode !== 'window') return;
    if (isLoadingFuture) return;

    if (msgWinEnd >= messages.length) {
        if (futureLoader) futureLoader.style.display = 'none';
        return;
    }

    isLoadingFuture = true;
    if (futureLoader) futureLoader.style.display = 'flex';

    setTimeout(() => {
        const oldEnd = msgWinEnd;
        msgWinEnd = Math.min(messages.length, msgWinEnd + HISTORY_BATCH_SIZE);

        // 如果这一下已经追到最新消息了，直接切回正常模式，体验上等同于"回到最新"——
        // 这是一次性的模式切换，不是重复的翻页动作，用一次完整渲染没问题
        if (msgWinEnd >= messages.length) {
            window._backToLatestMessages();
            isLoadingFuture = false;
            return;
        }

        _appendNewerMessages(oldEnd, msgWinEnd);

        if (futureLoader) {
            futureLoader.style.display = (msgWinEnd < messages.length) ? 'flex' : 'none';
        }
        isLoadingFuture = false;
    }, 120);
}


        function getDefaultSettings() {
            return {
                partnerName: "梦角",
                myName: "我",
                myStatus: "在线",
                partnerStatus: "在线",
                isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
                colorTheme: "xiayizhou",
                soundEnabled: true,
                typingIndicatorEnabled: true,
                readReceiptsEnabled: true,
                replyEnabled: true,
                lastStatusChange: Date.now(),
                nextStatusChange: 1 + Math.random() * 7,
                fontSize: 16,
                bubbleStyle: 'standard',
                messageFontFamily: "'Noto Serif SC', serif",
                messageFontWeight: 400,
                messageLineHeight: 1.5,
                musicPlayerEnabled: false,
                replyDelayMin: 3000,
                replyDelayMax: 7000,
                inChatAvatarEnabled: true,
                inChatAvatarSize: 36,
                inChatAvatarPosition: 'center',
                alwaysShowAvatar: false,
                showPartnerNameInChat: false,
                customFontUrl: "", 
        customBubbleCss: "",
        customGlobalCss: "",
                myAvatarFrame: null, 
                partnerAvatarFrame: null,
                myAvatarShape: 'circle',
                partnerAvatarShape: 'circle',
autoSendEnabled: false,
autoSendInterval: 5,
        allowReadNoReply: false, 
        readNoReplyChance: 0.2,
        combineReplyCards: false,
        combineReplyMaxCards: 3,
        timeFormat: 'HH:mm',
        customSoundUrl: '',
        // 音效：两方分别可选（若对应 URL 为空则使用内置预设）
        mySendSoundPreset: 'tone_low',
        mySendCustomSoundUrl: '',
        partnerMessageSoundPreset: 'tone_low',
        partnerMessageCustomSoundUrl: '',
        myPokeSoundPreset: 'tone_low',
        myPokeCustomSoundUrl: '',
        partnerPokeSoundPreset: 'tone_low',
        partnerPokeCustomSoundUrl: '',
        soundVolume: 0.15,
        bottomCollapseMode: false,
        emojiMixEnabled: true,
        autoReactionEnabled: true
            };
        }


        function renderBackgroundGallery() {
            const list = document.getElementById('background-gallery-list');
            if (!list) return;

            list.innerHTML = '';

            
            const addBtn = document.createElement('div');
            addBtn.className = 'bg-item bg-add-btn';
            
            addBtn.innerHTML = '<i class="fas fa-plus"></i><span></span>';
            addBtn.onclick = () => document.getElementById('bg-gallery-input').click();
            list.appendChild(addBtn);

            const currentBg = safeGetItem(getStorageKey('chatBackground'));

            savedBackgrounds.forEach((bg, index) => {
                const item = document.createElement('div');
                let isActive = false;

                if (currentBg) {
                    if (currentBg === bg.value) {
                        // 本地 base64 完全匹配
                        isActive = true;
                    } else if (typeof currentBg === 'string' && currentBg.indexOf('oss://') === 0) {
                        // 换设备恢复后 currentBg 是 oss:// 引用，跟 cloudUrl 比较
                        isActive = bg.cloudUrl === currentBg;
                    }
                }

                item.className = `bg-item ${isActive ? 'active': ''}`;

                if (bg.type === 'image' || bg.type === 'gif') {
                    // 图库预览：优先用缩略图（省内存），没有缩略图才用本地 base64
                    // cloudUrl 存云端备份引用，但图库预览不走云端
                    const displaySrc = bg.thumbnail || bg.value;
                    item.innerHTML = `<img src="${displaySrc}" loading="lazy" alt="bg">`;
                } else {
                    item.innerHTML = `<div class="bg-color-block" style="background: ${bg.value}"></div>`;
                }

                item.onclick = async (e) => {
                    if (e.target.closest('.bg-delete-btn')) return;
                    await applyBackground(bg.value);
                    safeSetItem(getStorageKey('chatBackground'), bg.value);
                    localforage.setItem(getStorageKey('chatBackground'), bg.value);
                    renderBackgroundGallery();
                    showNotification('背景已切换', 'success');
                };

                if (bg.id.startsWith('user-')) {
                    const delBtn = document.createElement('div');
                    delBtn.className = 'bg-delete-btn';
                    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    delBtn.title = "删除此背景";
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (confirm('确定删除这张背景图吗？')) {
                            // 阶段三B：如果有云端引用，先删云端对象（失败不阻塞本地删除）
                            if (window.CloudMedia && bg) {
                                const refToDelete = bg.cloudKey || (typeof bg.value === 'string' && bg.value.indexOf('oss://') === 0 ? bg.value : null);
                                if (refToDelete) {
                                    try {
                                        await window.CloudMedia.delete(refToDelete);
                                    } catch (err) {
                                        console.warn('[cloud-media] 云端删除失败', err);
                                    }
                                }
                            }
                            savedBackgrounds.splice(index, 1);
                            saveBackgroundGallery();

                            if (isActive) {
                                removeBackground(); 
                                renderBackgroundGallery();
                            } else {
                                renderBackgroundGallery();
                            }
                        }
                    };
                    item.appendChild(delBtn);
                }

                list.appendChild(item);
            });
        }



        function saveBackgroundGallery() {
    localforage.setItem(getStorageKey('backgroundGallery'), savedBackgrounds);
}


        const applyBackground = async (value) => {
            if (!value || typeof value !== 'string') return;
            try {
                // 聊天页背景本地存全尺寸 base64，直接应用，零延迟
                // oss:// 引用只会在换设备恢复时临时出现（旧数据迁移过渡期），兜底处理
                if (value.indexOf('oss://') === 0) {
                    // 兜底：找本地 gallery 里有没有对应的 cloudUrl，有就用本地 base64
                    const localItem = Array.isArray(savedBackgrounds)
                        ? savedBackgrounds.find(function (bg) { return bg && (bg.cloudUrl === value || bg.value === value); })
                        : null;
                    if (localItem && localItem.value && localItem.value.indexOf('data:image') === 0) {
                        // 本地有，直接用
                        const cssValue = `url(${localItem.value})`;
                        document.documentElement.style.setProperty('--chat-bg-image', cssValue);
                        document.body.classList.add('with-background');
                        return;
                    }
                    // 本地没有（换设备恢复后的旧数据）：才走云端下载，缩略图先垫底
                    if (window.CloudMedia) {
                        if (localItem && localItem.thumbnail) {
                            document.documentElement.style.setProperty('--chat-bg-image', `url(${localItem.thumbnail})`);
                            document.body.classList.add('with-background');
                        }
                        window.CloudMedia.fetchUrl(value).then(function (blobUrl) {
                            document.documentElement.style.setProperty('--chat-bg-image', `url(${blobUrl})`);
                            document.body.classList.add('with-background');
                        }).catch(function (e) {
                            console.warn('[cloud-media] 加载云端背景失败', e);
                        });
                    }
                    return;
                }
                if (value.startsWith('linear-gradient') || value.startsWith('#') || value.startsWith('rgb')) {
                    document.documentElement.style.setProperty('--chat-bg-image', value);
                } else {
                    const cssValue = value.startsWith('url(') ? value : `url(${value})`;
                    document.documentElement.style.setProperty('--chat-bg-image', cssValue);
                }
                document.body.classList.add('with-background');
            } catch (e) {
                if (typeof removeBackground === 'function') removeBackground();
            }
        };


const loadData = async () => {
    try {
        settings = getDefaultSettings();

        
        const results = await Promise.allSettled([
            localforage.getItem(getStorageKey('chatSettings')),
            localforage.getItem(getStorageKey('chatMessages')),
            localforage.getItem(getStorageKey('backgroundGallery')),
            localforage.getItem(getStorageKey('customReplies')),
            localforage.getItem(getStorageKey('customPokes')),
            localforage.getItem(getStorageKey('customStatuses')),
            localforage.getItem(getStorageKey('customMottos')),
            localforage.getItem(getStorageKey('customIntros')),
            localforage.getItem(getStorageKey('anniversaries')),
            localforage.getItem(getStorageKey('stickerLibrary')),
            localforage.getItem(`${APP_PREFIX}customThemes`),
            localforage.getItem(getStorageKey('chatBackground')),
            localforage.getItem(getStorageKey('partnerAvatar')),
            localforage.getItem(getStorageKey('myAvatar')),
            localforage.getItem(getStorageKey('partnerPersonas')), 
            localforage.getItem(getStorageKey('showPartnerNameInChat')),
            localforage.getItem(`${APP_PREFIX}themeSchemes`),
            localforage.getItem(getStorageKey('myStickerLibrary')),
            localforage.getItem(getStorageKey('customReplyGroups')),
            localforage.getItem(getStorageKey('customPokeGroups')),
            localforage.getItem(getStorageKey('customStatusGroups')),
            localforage.getItem(getStorageKey('customPeriodCare')),
            localforage.getItem(getStorageKey('myStickerGroups'))
        ]);
        const getVal = (index) => results[index].status === 'fulfilled' ? results[index].value : null;

        const savedSettings = getVal(0);
        const savedMessages = getVal(1);
        const savedBgGallery = getVal(2);
        const savedCustomReplies = getVal(3);
        const savedPokes = getVal(4);
        const savedStatuses = getVal(5);
        const savedMottos = getVal(6);
        const savedIntros = getVal(7);
        const savedAnniversaries = getVal(8);
        const savedStickers = getVal(9);
        const savedCustomThemes = getVal(10);
        const savedChatBg = getVal(11);
        const partnerAvatarSrc = getVal(12);
        const myAvatarSrc = getVal(13);
        const savedPartnerPersonas = getVal(14);
        const savedShowNameConfig = getVal(15);
        const savedThemeSchemes = getVal(16);
        const savedMyStickers = getVal(17);
        const savedReplyGroups = getVal(18);
        const savedPokeGroups = getVal(19);
        const savedStatusGroups = getVal(20);
        const savedPeriodCare = getVal(21);
        const savedMyStickerGroups = getVal(22);

        if (savedPartnerPersonas) partnerPersonas = savedPartnerPersonas;

        if (savedSettings) Object.assign(settings, savedSettings);

        // 主色调改为「夏以昼」橙蓝：老用户一次性迁移（自定义主题不覆盖）
        try {
            if (!localStorage.getItem('appleThemeXiayizhou')
                && !String(settings.colorTheme || '').startsWith('custom-')) {
                settings.colorTheme = 'xiayizhou';
                localStorage.setItem('appleThemeXiayizhou', '1');
            }
        } catch (e) {}

        if (settings.showPartnerNameInChat !== undefined) {
            showPartnerNameInChat = settings.showPartnerNameInChat;
        } else if (savedShowNameConfig !== null) {
            showPartnerNameInChat = savedShowNameConfig;
        }
        document.body.classList.toggle('show-partner-name', showPartnerNameInChat);
        try {
            if (settings.customFontUrl) applyCustomFont(settings.customFontUrl);
            if (settings.customBubbleCss) applyCustomBubbleCss(settings.customBubbleCss);
            if (settings.customGlobalCss) applyGlobalThemeCss(settings.customGlobalCss);
        } catch(e) { console.warn("样式应用失败", e); }
        
        if (savedPokes) customPokes = savedPokes;
        else customPokes = [...CONSTANTS.POKE_ACTIONS];

        if (savedStatuses) customStatuses = savedStatuses;
        else customStatuses = [...CONSTANTS.PARTNER_STATUSES];

        if (savedMottos) customMottos = savedMottos;
        else customMottos = [...CONSTANTS.HEADER_MOTTOS];
        
        if (savedIntros) customIntros = savedIntros;
        else customIntros = CONSTANTS.WELCOME_ANIMATIONS.map(a => `${a.line1}|${a.line2}`);

        customPeriodCare = savedPeriodCare || [];  // 没有内置预设，用户没配置就是空数组

        if (savedMessages && Array.isArray(savedMessages)) {
            messages = savedMessages.map(m => ({
                ...m, timestamp: new Date(m.timestamp)
            }));
        } else {
            const backup = _tryRecoverFromBackup();
            if (backup && Array.isArray(backup.messages) && backup.messages.length > 0) {
                const timeSince = Math.round((Date.now() - backup.ts) / 60000);
                console.warn(`[loadData] 主存储无消息，正在从本会话备份恢复（备份时间：${timeSince} 分钟前，${backup.messages.length} 条）`);
                _savePreRecoverySnapshot(); // 先留现场，再覆盖
                messages = backup.messages.map(m => ({
                    ...m, timestamp: new Date(m.timestamp)
                }));
                if (backup.settings) Object.assign(settings, backup.settings);
                if (backup.anniversaries && Array.isArray(backup.anniversaries)) {
                    anniversaries = backup.anniversaries;
                }
                setTimeout(() => saveData(), 1000);
                showNotification(
                    `已从备份恢复 ${messages.length} 条文字消息（图片未纳入备份）`,
                    'warning', 6000
                );
            } else {
                messages = [];
            }
        }

        if (savedBgGallery) {
            savedBackgrounds = savedBgGallery;
        } else {
            savedBackgrounds = [{ id: 'preset-1', type: 'color', value: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' }];
        }

        if (savedCustomReplies) customReplies = savedCustomReplies;
        if (savedReplyGroups) window.customReplyGroups = savedReplyGroups;
        if (savedPokeGroups) window.customPokeGroups = savedPokeGroups;
        if (savedStatusGroups) window.customStatusGroups = savedStatusGroups;
        if (savedAnniversaries) anniversaries = savedAnniversaries;
        if (savedStickers) stickerLibrary = savedStickers;
        if (savedMyStickers) myStickerLibrary = savedMyStickers;
        if (savedMyStickerGroups) window.myStickerGroups = savedMyStickerGroups;
        else window.myStickerGroups = [];

        // 迁移："我的表情库"以前是纯字符串数组（元素直接是图片地址），
        // 现在要支持分组，每一项需要有自己的身份（id）和归属（groupId），
        // 改成对象数组。只有第一次加载到旧格式数据时才会触发，转完就直接存回去，
        // 以后不会再重复转。
        (function _migrateMyStickerLibrary() {
            if (!Array.isArray(myStickerLibrary) || !myStickerLibrary.length) return;
            var needsMigration = myStickerLibrary.some(function (s) { return typeof s === 'string'; });
            if (!needsMigration) return;
            var base = Date.now();
            var n = myStickerLibrary.length;
            myStickerLibrary = myStickerLibrary.map(function (s, i) {
                if (typeof s === 'string') {
                    // 这个数组从老格式（纯字符串数组）那会儿开始，加新表情就一直是 unshift 塞到最前面
                    // （见 app.js 的 myStickerLibrary.unshift），也就是说数组第0个本来就是"最新"那张，
                    // 不是"最老"那张——时间戳要按这个真实规律倒着算，第0个给最大的时间戳，
                    // 不然新的排序逻辑（按 addedAt 倒序）会把老数据的先后顺序整个搞反
                    return { id: 'stk_' + base + '_' + i, src: s, groupId: null, addedAt: base + (n - 1 - i), groupJoinedAt: base + (n - 1 - i) };
                }
                return s; // 已经是新格式的，原样保留
            });
            try { localforage.setItem(getStorageKey('myStickerLibrary'), myStickerLibrary); } catch (e) {}
        })();

        // 一次性补救：上面那段迁移代码上线后，已经有一批用户的老表情包被那个"方向搞反"的
        // bug 转换过一次了（转换本身已经完成，不会再走上面那条 needsMigration 分支）。
        // 这里专门找出"当年被那个bug处理过"的那一批，把顺序倒回来——判断依据是：
        // 一批条目的 id 共享同一个 'stk_<base>_' 前缀，且 addedAt 严格是 base, base+1, base+2...
        // 这种连续整数（真实世界不同时间上传的表情，时间戳几乎不可能刚好差1毫秒排成这样，
        // 这个特征几乎只有那个bug的产物才会有），符合的话就按当前数组位置重新倒序赋值一次。
        // 用一个开关记一下修过了，不会同一批数据被反复橄来倒去
        (function _fixMyStickerMigrationOrderBug() {
            try {
                if (localStorage.getItem('myStickerOrderFixApplied') === '1') return;
            } catch (e) { return; }
            if (!Array.isArray(myStickerLibrary) || !myStickerLibrary.length) {
                try { localStorage.setItem('myStickerOrderFixApplied', '1'); } catch (e) {}
                return;
            }
            // 按 id 里的 base 前缀分批，逐批检查是不是"连续整数"这个特征
            var groups = {};
            var order = [];
            myStickerLibrary.forEach(function (entry, idx) {
                if (!entry || typeof entry.id !== 'string') return;
                var m = entry.id.match(/^stk_(\d+)_\d+$/);
                if (!m) return;
                var base = m[1];
                if (!groups[base]) { groups[base] = []; order.push(base); }
                groups[base].push({ entry: entry, idx: idx });
            });
            var fixedCount = 0;
            order.forEach(function (base) {
                var members = groups[base];
                if (members.length < 2) return; // 单独一条不构成"批量迁移"的特征，跳过，避免误伤正常数据
                // members 已经是按数组原始顺序收集的（forEach 天然顺序），检查是不是连续整数
                var baseNum = Number(base);
                var isSequential = members.every(function (m, i) { return m.entry.addedAt === baseNum + i; });
                if (!isSequential) return; // 不符合特征，可能是正常数据凑巧共享了前缀，不动它
                var n = members.length;
                members.forEach(function (m, i) {
                    var newVal = baseNum + (n - 1 - i);
                    m.entry.addedAt = newVal;
                    m.entry.groupJoinedAt = newVal;
                });
                fixedCount += n;
            });
            if (fixedCount > 0) {
                try { localforage.setItem(getStorageKey('myStickerLibrary'), myStickerLibrary); } catch (e) {}
                console.log('[sticker-fix] 已修正 ' + fixedCount + ' 张老表情包的排序方向');
            }
            try { localStorage.setItem('myStickerOrderFixApplied', '1'); } catch (e) {}
        })();
        if (savedCustomThemes) customThemes = savedCustomThemes;
        if (savedThemeSchemes) themeSchemes = savedThemeSchemes;
        try { const ce = await localforage.getItem(getStorageKey('customEmojis')); if (ce && Array.isArray(ce)) customEmojis = ce; } catch(e) {}
        window._customReplies = customReplies;
        window._CONSTANTS = CONSTANTS;

        if (DOMElements && DOMElements.partner && DOMElements.me) {
            updateAvatar(DOMElements.partner.avatar, partnerAvatarSrc);
            updateAvatar(DOMElements.me.avatar, myAvatarSrc);
            // updateAvatar 已经把值写进 _avatarCache 了，这里不用再写一遍

            // 阶段四：本地没有头像时，从云端下载（换设备恢复场景）
            if (window.CloudMedia && window.CloudSync && window.CloudSync.isConnected()) {
                const _tryRestoreAvatar = async (isPartner) => {
                    const localSrc = isPartner ? partnerAvatarSrc : myAvatarSrc;
                    // 本地 localforage 有 或 内存缓存有，都不拉
                    const cacheVal = window._avatarCache && (isPartner ? window._avatarCache.partner : window._avatarCache.me);
                    if (localSrc || cacheVal) return;

                    const category = isPartner ? 'avatars' : 'my-avatars';
                    const avatarId = isPartner ? 'partner' : 'me';
                    const sid = SESSION_ID;
                    // 只试 jpg 和 png（上传时统一用 jpg，png 做兜底）
                    for (const ext of ['jpg', 'png']) {
                        const ossRef = `oss://media/${sid}/${category}/${avatarId}.${ext}`;
                        try {
                            const blobUrl = await window.CloudMedia.fetchUrl(ossRef);
                            const resp = await fetch(blobUrl);
                            const buf = await resp.arrayBuffer();
                            const b64arr = new Uint8Array(buf);
                            let binary = '';
                            b64arr.forEach(b => binary += String.fromCharCode(b));
                            const base64 = `data:image/${ext};base64,` + btoa(binary);
                            const storageKey = getStorageKey(isPartner ? 'partnerAvatar' : 'myAvatar');
                            await localforage.setItem(storageKey, base64);
                            const el = isPartner ? DOMElements.partner.avatar : DOMElements.me.avatar;
                            updateAvatar(el, base64);
                            break;
                        } catch (e) {
                            // 没有这个后缀，继续
                        }
                    }
                };
                _tryRestoreAvatar(true).catch(() => {});
                _tryRestoreAvatar(false).catch(() => {});
            }
        }

        if (savedChatBg) {
            applyBackground(savedChatBg);
        } else {
            const lsBg = safeGetItem(getStorageKey('chatBackground'));
            if (lsBg) {
                applyBackground(lsBg);
                localforage.setItem(getStorageKey('chatBackground'), lsBg);
            }
        }

        try { await initMoodData(); } catch(e) { console.warn("心情数据加载失败", e); }
        try { await loadEnvelopeData(); } catch(e) { console.warn("信封数据加载失败", e); }
        
        displayedMessageCount = HISTORY_BATCH_SIZE;
        msgViewMode = 'latest'; // 切换/加载会话时，重置掉"历史浏览模式"，避免带着上一个会话的浏览状态串过来
        newMsgCountWhileBrowsing = 0;
        if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();
        
        setTimeout(() => {
            applyAllAvatarFrames();
            manageAutoSendTimer(); 
            checkEnvelopeStatus(); 
            if (typeof checkMomentsStatus === 'function') checkMomentsStatus();
            updateUI();
            if (settings.customBubbleCss) {
                try { applyCustomBubbleCss(settings.customBubbleCss); } catch(e) {}
            }
        }, 100);

    } catch (e) {
        console.error("LoadData 内部致命错误:", e);
        settings = getDefaultSettings();
        messages = [];
        updateUI();
    }
};

const LIBRARY_CONFIG = {
    reply: {
        title: "回复库管理",
        tabs: [
            { id: 'custom', name: '主字卡', mode: 'list' },
            { id: 'emojis', name: 'Emoji', mode: 'grid' },
            { id: 'stickers', name: '表情库', mode: 'grid' }
        ]
    },
    atmosphere: {
        title: "氛围感配置",
        tabs: [
            { id: 'pokes', name: '拍一拍', mode: 'list' },
            { id: 'statuses', name: '对方状态', mode: 'list' },
            { id: 'surveyBank', name: '问卷题库', mode: 'list' },
            { id: 'period', name: '经期', mode: 'list' },
            { id: 'redpacketBank', name: '红包祝福语', mode: 'list' },
            { id: 'mottos', name: '顶部格言', mode: 'list' },
            { id: 'intros', name: '开场动画', mode: 'list' }
        ]
    }
};
let currentAnnType = 'anniversary'; 

window.openMyStickerSettings = function() {
    const picker = document.getElementById('user-sticker-picker');
    if (picker) picker.classList.remove('active');
    if (typeof currentMajorTab !== 'undefined') {
        currentMajorTab = 'reply';
        currentSubTab = 'stickers';
    }
    var sidebarBtns = document.querySelectorAll('.sidebar-btn');
    sidebarBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.major === 'reply'); });
    if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
    var modal = document.getElementById('custom-replies-modal');
    if (modal && typeof showModal === 'function') showModal(modal);
};

window.switchAnnType = function(type) {
    currentAnnType = type;
    currentAnniversaryType = type; 
    document.querySelectorAll('.ann-type-btn').forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    const desc = document.getElementById('ann-type-desc');
    if(desc) {
        desc.textContent = type === 'anniversary' 
            ? '计算从过去某一天到现在已经过了多少天 (例如: 相识、恋爱)' 
            : '计算从现在到未来某一天还剩下多少天 (例如: 生日、跨年)';
    }
};

window.deleteAnniversaryItem = function(id) {
    if(confirm("确定要删除这条记录吗？")) {
        anniversaries = anniversaries.filter(a => a.id !== id);
        throttledSaveData(); 
        renderAnniversariesList();
        showNotification('已删除', 'success');
        if (typeof playSound === 'function') playSound('anniversary');
    }
};

// ── 阶段 2 保存层：单飞合并 + 兜底备份节流 + 可选计时 ──────────
// 只改"什么时候写、写几次"，不碰 key 名称、数据结构、会话隔离；
// chatMessages / 贴纸 / 头像仍然每次全量写入，不做"内容没变就跳过"的判断。

// 可选性能计时：默认关闭。关闭时每个记录点只多一次布尔判断，不做计时或日志
const _perf = {
    enabled: false,
    saves: [],      // 最近 20 次 saveData 的耗时
    backups: [],    // 最近 20 次兜底备份的耗时与字节数
    inputSync: [],  // 最近 100 次输入框高度测量的布局耗时（ms）
    scrollFrames: [], // 最近 100 次滚动帧的处理耗时（ms）
    scrollEvents: 0,  // 收到的原始 scroll 事件数（用来对比合并前后的触发次数）
    foreground: [],   // 最近 20 次"切回前台后 3 秒内"的主线程长任务汇总
    skippedBackups: 0,
    backupFailures: 0, // 兜底备份写入失败次数（配额满/隐私模式），用来验证"不再静默失败"
    renderMs: [],       // 最近 20 次"追加一条消息"的 DOM 构建耗时
    renderFrames: [],   // 帧探针采集到的 rAF 间隔（ms）
    renderLayoutReads: 0, // 渲染路径内累计的强制同步布局读取次数（scrollHeight/scrollTop）
    renderFull: 0,      // 全量重建次数
    renderAppend: 0     // 单条追加次数
};
try {
    _perf.enabled = localStorage.getItem('PERF_ENABLED') === '1';
} catch (e) {}

window.__PERF__ = {
    get enabled() { return _perf.enabled; },
    enable() {
        _perf.enabled = true;
        try { localStorage.setItem('PERF_ENABLED', '1'); } catch (e) {}
        console.log('[perf] 计时已开启');
    },
    disable() {
        _perf.enabled = false;
        try { localStorage.removeItem('PERF_ENABLED'); } catch (e) {}
        console.log('[perf] 计时已关闭');
    },
    reset() {
        _perf.saves.length = 0;
        _perf.backups.length = 0;
        _perf.inputSync.length = 0;
        _perf.scrollFrames.length = 0;
        _perf.scrollEvents = 0;
        _perf.foreground.length = 0;
        _perf.skippedBackups = 0;
        _perf.backupFailures = 0;
        _perf.renderMs.length = 0;
        _perf.renderFrames.length = 0;
        _perf.renderLayoutReads = 0;
        _perf.renderFull = 0;
        _perf.renderAppend = 0;
        _bootTimeline.dcl = null;
        _bootTimeline.fcp = null;
        _bootTimeline.splashGone = null;
        _bootTimeline.firstMessage = null;
    },
    // 输入框高度测量的布局耗时统计（配合 console 里 __PERF__.enable() 使用）
    get inputStats() {
        const s = _perf.inputSync.slice();
        if (!s.length) return { count: 0, avg: 0, max: 0, skipped: 0 };
        const arr = s.slice().sort((a, b) => a - b);
        const sum = s.reduce((n, v) => n + v, 0);
        return {
            count: s.length,
            avg: Math.round(sum / s.length * 100) / 100,
            max: arr[arr.length - 1],
            p95: arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))],
            skipped: _inputSync.skipped
        };
    },
    // 滚动帧处理耗时统计：events 是原始 scroll 事件数，frames 是真正处理了几帧
    get scrollStats() {
        const s = _perf.scrollFrames.slice();
        if (!s.length) return { events: _perf.scrollEvents, frames: 0, avg: 0, max: 0, p95: 0 };
        const arr = s.slice().sort((a, b) => a - b);
        const sum = s.reduce((n, v) => n + v, 0);
        return {
            events: _perf.scrollEvents,
            frames: s.length,
            avg: Math.round(sum / s.length * 100) / 100,
            max: Math.round(arr[arr.length - 1] * 100) / 100,
            p95: Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))] * 100) / 100
        };
    },
    bumpScrollEvent() {
        _perf.scrollEvents++;
    },
    // 切回前台后 3 秒内的主线程长任务汇总（最近的若干次）
    get foregroundStats() {
        const list = _perf.foreground.slice();
        if (!list.length) return { rounds: 0, avgTotal: 0, maxTotal: 0, avgCount: 0 };
        const avgTotal = list.reduce((s, r) => s + r.total, 0) / list.length;
        return {
            rounds: list.length,
            avgTotal: Math.round(avgTotal * 10) / 10,
            maxTotal: Math.max.apply(null, list.map(r => r.total)),
            avgCount: Math.round(list.reduce((s, r) => s + r.count, 0) / list.length * 10) / 10,
            last: list[list.length - 1]
        };
    },
    recordScrollFrame(ms) {
        _perf.scrollFrames.push(ms);
        if (_perf.scrollFrames.length > 100) _perf.scrollFrames.shift();
    },
    // 兜底备份统计：bytes 是实际写入 localStorage 的字符数（V2 目标 ≤64K 字符）
    get backupStats() {
        const list = _perf.backups.slice();
        const bytes = list.map(b => b.bytes).sort((a, b) => a - b);
        const times = list.map(b => b.ms).sort((a, b) => a - b);
        const sum = times.reduce((s, v) => s + v, 0);
        return {
            count: list.length,
            lastBytes: list.length ? list[list.length - 1].bytes : 0,
            maxBytes: bytes.length ? bytes[bytes.length - 1] : 0,
            avgMs: times.length ? Math.round(sum / times.length * 100) / 100 : 0,
            p95Ms: times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : 0,
            skipped: _perf.skippedBackups,
            failures: _perf.backupFailures
        };
    },
    // "连续 20 条消息"的观察窗口：最近 20 次 saveData 的累计耗时
    get last20TotalMs() {
        const last = _perf.saves.slice(-20);
        return Math.round(last.reduce((sum, r) => sum + r.ms, 0) * 10) / 10;
    },
    // 消息列表渲染统计：layoutReads 是渲染路径里主动读 scrollHeight/scrollTop 的次数，
    // 每次这类读取都会强制浏览器同步布局，所以它直接对应"强制同步布局次数"
    get renderStats() {
        const ms = _perf.renderMs.slice();
        const frames = _perf.renderFrames.slice();
        const msSorted = ms.slice().sort((a, b) => a - b);
        const fSorted = frames.slice().sort((a, b) => a - b);
        const sum = ms.reduce((s, v) => s + v, 0);
        return {
            full: _perf.renderFull,
            append: _perf.renderAppend,
            layoutReads: _perf.renderLayoutReads,
            appendCount: ms.length,
            avgAppendMs: ms.length ? Math.round(sum / ms.length * 100) / 100 : 0,
            maxAppendMs: msSorted.length ? msSorted[msSorted.length - 1] : 0,
            lastAppendMs: ms.length ? ms[ms.length - 1] : 0,
            frames: frames.length,
            frameP95: fSorted.length ? fSorted[Math.min(fSorted.length - 1, Math.floor(fSorted.length * 0.95))] : 0,
            frameMax: fSorted.length ? fSorted[fSorted.length - 1] : 0
        };
    },
    bumpRenderLayout(n) {
        _perf.renderLayoutReads += (n || 1);
    },
    // 帧探针：连续发送/接收时用，采 durationMs 内的 rAF 间隔，用完自动停
    beginFrameProbe(durationMs) {
        if (!_perf.enabled) return;
        const start = _perfNow();
        let last = 0;
        const tick = (ts) => {
            if (last) {
                _perf.renderFrames.push(Math.round((ts - last) * 100) / 100);
                if (_perf.renderFrames.length > 200) _perf.renderFrames.shift();
            }
            last = ts;
            if (_perfNow() - start < (durationMs || 1000)) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    },
    // 启动时间线：全部相对 navigationStart，单位 ms
    get bootTimeline() {
        const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
        return {
            dcl: _bootTimeline.dcl,
            fcp: _bootTimeline.fcp,
            splashGone: _bootTimeline.splashGone,
            firstMessage: _bootTimeline.firstMessage,
            domInteractive: (nav && nav.domInteractive) ? Math.round(nav.domInteractive) : null,
            load: (nav && nav.loadEventEnd) ? Math.round(nav.loadEventEnd) : null
        };
    }
};

// 启动时间线探针：记录 DCL / 首绘 / 开屏遮罩移除 / 首条消息进入 DOM 的时刻。
// 只在启动阶段挂一次监听，之后不再产生开销；数据通过 __PERF__.bootTimeline 读取
const _bootTimeline = { dcl: null, fcp: null, splashGone: null, firstMessage: null };
(function () {
    try {
        document.addEventListener('DOMContentLoaded', () => {
            _bootTimeline.dcl = Math.round(_perfNow());
        }, { once: true });

        try {
            new PerformanceObserver(list => {
                list.getEntries().forEach(e => {
                    if (e.name === 'first-contentful-paint' && _bootTimeline.fcp === null) {
                        _bootTimeline.fcp = Math.round(e.startTime);
                    }
                });
            }).observe({ type: 'paint', buffered: true });
        } catch (e) {}

        const isSplashGone = (splash) => {
            if (!document.documentElement.contains(splash)) return true;
            if (splash.classList.contains('splash-fade-out')) return true;
            return getComputedStyle(splash).display === 'none';
        };
        const markSplashGone = () => {
            if (_bootTimeline.splashGone === null) _bootTimeline.splashGone = Math.round(_perfNow());
        };
        const watchSplash = () => {
            const splash = document.getElementById('splash-declaration');
            if (!splash) { markSplashGone(); return; }
            if (isSplashGone(splash)) { markSplashGone(); return; }
            const check = () => {
                if (isSplashGone(splash)) {
                    markSplashGone();
                    attrObs.disconnect();
                    removedObs.disconnect();
                }
            };
            const attrObs = new MutationObserver(check);
            attrObs.observe(splash, { attributes: true, attributeFilter: ['class', 'style'] });
            const removedObs = new MutationObserver(check);
            removedObs.observe(document.documentElement, { childList: true, subtree: true });
        };
        const watchFirstMessage = () => {
            const container = document.getElementById('chat-container');
            if (!container) return;
            if (container.querySelector('.message-wrapper')) {
                _bootTimeline.firstMessage = Math.round(_perfNow());
                return;
            }
            const obs = new MutationObserver(() => {
                if (container.querySelector('.message-wrapper')) {
                    _bootTimeline.firstMessage = Math.round(_perfNow());
                    obs.disconnect();
                }
            });
            obs.observe(container, { childList: true, subtree: true });
        };

        watchSplash();
        document.addEventListener('DOMContentLoaded', watchFirstMessage, { once: true });
    } catch (e) {}
})();
// 非首屏功能样式：首屏不加载，首次需要时再注入。
// 这样可以减掉首屏的 CSS 解析与样式匹配成本，同时保持功能样式完整
const _deferredCssLoaded = Object.create(null);
// 弹层 id → 该弹层专属的样式文件（打开前先注入，避免样式闪烁）
const _deferredCssByModal = {
    'period-modal': 'css/period.css',
    'stats-modal': 'css/period.css',
    'survey-modal': 'css/survey.css',
    'redpacket-compose-modal': 'css/redpacket.css',
    'redpacket-view-modal': 'css/redpacket.css',
    'redpacket-history-modal': 'css/redpacket.css'
};
function loadCssOnce(href) {
    if (_deferredCssLoaded[href]) return _deferredCssLoaded[href];
    _deferredCssLoaded[href] = new Promise(resolve => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve(true);
        link.onerror = () => resolve(false);
        document.head.appendChild(link);
    });
    return _deferredCssLoaded[href];
}
window.loadCssOnce = loadCssOnce;

document.addEventListener('DOMContentLoaded', () => {
    const warm = () => {
        ['css/cinema.css', 'css/companion.css', 'css/redpacket.css', 'css/survey.css', 'css/period.css'].forEach(loadCssOnce);
    };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 1200 });
    else setTimeout(warm, 300);
}, { once: true });


function _perfNow() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
}

// 切回前台后 3 秒内的主线程长任务（>50ms）累计耗时：用来量化"切后台再回来"那一刻的卡顿
let _fgObserver = null;
function _startForegroundWatch() {
    if (!_perf.enabled || typeof PerformanceObserver === 'undefined') return;
    if (_fgObserver) return;
    const start = _perfNow();
    const durations = [];
    try {
        _fgObserver = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (e) { if (e.startTime >= start) durations.push(e.duration); });
        });
        _fgObserver.observe({ entryTypes: ['longtask'] });
    } catch (e) { _fgObserver = null; return; }
    setTimeout(function () {
        try { if (_fgObserver) _fgObserver.disconnect(); } catch (e) {}
        _fgObserver = null;
        let total = 0, max = 0;
        for (let i = 0; i < durations.length; i++) { total += durations[i]; if (durations[i] > max) max = durations[i]; }
        _perf.foreground.push({ total: Math.round(total * 10) / 10, count: durations.length, max: Math.round(max * 10) / 10 });
        if (_perf.foreground.length > 20) _perf.foreground.shift();
    }, 3000);
}
document.addEventListener('visibilitychange', function () {
    if (!document.hidden) _startForegroundWatch();
});

// ── 兜底备份 V2：只存"最近 N 条纯文字 + 少量关键设置"──────────────
// 为什么不再整段镜像 messages：图片是 base64，一次同步 stringify 就是几 MB，
// 而 localStorage 配额通常只有几 MB。超了 setItem 直接抛异常，结果是
// "旧备份还在、新备份没写进来"，比没有备份更容易误导。
// 现在只保一段文本尾巴（目标 ≤64KB），能救回最近几条消息，也不会撑爆配额。
const BACKUP_V2_PREFIX = 'BACKUP_V2_';
const BACKUP_TEXT_LIMIT = 120;          // 备份的消息条数上限
const BACKUP_TEXT_MIN = 10;             // 缩量后至少保留的条数（再少就没有救急意义了）
const BACKUP_MAX_BYTES = 64 * 1024;     // UTF-16 保守估算（字符数 × 2）
const BACKUP_MIN_INTERVAL = 8000;       // 非强制调用最短间隔
const BACKUP_LEGACY_KEY = 'BACKUP_V1_critical';
const BACKUP_LEGACY_TS_KEY = 'BACKUP_V1_timestamp';

// 恢复时跟着消息一起回来的设置：只挑小的标量，不含自定义 CSS / 音频 data URL
const BACKUP_SETTINGS_KEYS = [
    'partnerName', 'myName', 'myStatus', 'partnerStatus',
    'colorTheme', 'isDarkMode', 'fontSize', 'messageFontFamily',
    'messageFontWeight', 'messageLineHeight', 'bubbleStyle', 'timeFormat',
    'showPartnerNameInChat', 'soundEnabled', 'typingIndicatorEnabled',
    'readReceiptsEnabled', 'replyEnabled', 'musicPlayerEnabled',
    'replyDelayMin', 'replyDelayMax', 'autoSendEnabled', 'autoSendInterval',
    'inChatAvatarEnabled', 'inChatAvatarSize', 'inChatAvatarPosition', 'alwaysShowAvatar',
    'myAvatarFrame', 'partnerAvatarFrame', 'myAvatarShape', 'partnerAvatarShape',
    'allowReadNoReply', 'readNoReplyChance', 'combineReplyCards', 'combineReplyMaxCards'
];

let _lastBackupAt = 0;
let _backupIdleHandle = 0;
let _backupIdleIsIdle = false;

function _jsonBytes(str) { return str.length * 2; }

function _backupKeyFor(sid) { return BACKUP_V2_PREFIX + sid + '_critical'; }
function _backupKey() { return SESSION_ID ? _backupKeyFor(SESSION_ID) : ''; }
function _preRecoveryKey(sid) { return BACKUP_V2_PREFIX + sid + '_pre_recovery'; }

function _pickBackupSettings() {
    const out = {};
    if (!settings || typeof settings !== 'object') return out;
    for (let i = 0; i < BACKUP_SETTINGS_KEYS.length; i++) {
        const k = BACKUP_SETTINGS_KEYS[i];
        const v = settings[k];
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.length > 256) continue; // 自定义样式/URL 不进备份
        out[k] = v;
    }
    try {
        const colors = settings.customThemeColors;
        if (colors && typeof colors === 'object' && JSON.stringify(colors).length <= 2048) {
            out.customThemeColors = colors;
        }
    } catch (e) {}
    return out;
}

// 备份里的消息只留"能看懂内容"的字段；图片一律剥离成标记，
// 避免 base64 撑大备份，也避免恢复出来的占位数据覆盖真实图片。
function _pickBackupMessages(limit, textCap) {
    const out = [];
    const cap = (textCap && textCap > 0) ? textCap : 2000;
    const total = messages.length;
    const from = Math.max(0, total - limit);
    for (let i = from; i < total; i++) {
        const m = messages[i];
        if (!m) continue;
        const item = {
            id: m.id,
            sender: m.sender,
            text: typeof m.text === 'string' ? m.text : '',
            timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
            type: m.type,
            status: m.status,
            isSticker: m.isSticker ? 1 : undefined,
            // 引用只留"谁说了什么"，引用的图片/语音可能也是 base64，一律不带
            replyTo: m.replyTo ? {
                id: m.replyTo.id,
                sender: m.replyTo.sender,
                text: typeof m.replyTo.text === 'string' ? m.replyTo.text.slice(0, 200) : ''
            } : undefined,
            voice: (m.voice && m.voice.fakeText) ? { fakeText: String(m.voice.fakeText).slice(0, 500) } : undefined
        };
        if (m.image) item._imgOmitted = 1;
        if (m.note) item.note = String(m.note).slice(0, 1000);
        if (typeof item.text === 'string' && item.text.length > cap) item.text = item.text.slice(0, cap) + '…';
        for (const k in item) { if (item[k] === undefined) delete item[k]; }
        out.push(item);
    }
    return out;
}

function _buildBackupPayload(limit, minimal, textCap) {
    return {
        v: 2,
        ts: Date.now(),
        sessionId: SESSION_ID,
        messages: _pickBackupMessages(limit, textCap),
        settings: minimal ? {} : _pickBackupSettings(),
        anniversaries: (minimal || !Array.isArray(anniversaries)) ? [] : anniversaries.slice(-100)
    };
}

function _buildBackupJson() {
    let limit = BACKUP_TEXT_LIMIT;
    let payload = _buildBackupPayload(limit, false, 0);
    let json = JSON.stringify(payload);
    // 超限就从"最老的"开始丢，尽量保住最近的消息，而不是一刀切清空
    let guard = 0;
    while (_jsonBytes(json) > BACKUP_MAX_BYTES && limit > BACKUP_TEXT_MIN && guard++ < 20) {
        limit = Math.max(BACKUP_TEXT_MIN, Math.floor(limit / 2));
        payload = _buildBackupPayload(limit, false, 0);
        payload._truncated = true;
        json = JSON.stringify(payload);
    }
    // 极端情况：最近 10 条单条就超长，才退到"截短每条文字"
    if (_jsonBytes(json) > BACKUP_MAX_BYTES) {
        payload = _buildBackupPayload(BACKUP_TEXT_MIN, false, 200);
        payload._truncated = true;
        json = JSON.stringify(payload);
    }
    return { json: json, count: payload.messages.length };
}

function _clearLegacyBackupKeys() {
    try { localStorage.removeItem(BACKUP_LEGACY_KEY); } catch (e) {}
    try { localStorage.removeItem(BACKUP_LEGACY_TS_KEY); } catch (e) {}
}

function _writeBackupNow() {
    if (window._skipBackup || !SESSION_ID) return;
    const _t0 = _perf.enabled ? _perfNow() : 0;
    try {
        const built = _buildBackupJson();
        localStorage.setItem(_backupKey(), built.json);
        _lastBackupAt = Date.now();
        _clearLegacyBackupKeys(); // 旧版全量镜像已无用，尽早释放配额
        if (_perf.enabled) {
            const ms = Math.round((_perfNow() - _t0) * 10) / 10;
            _perf.backups.push({ ms, bytes: built.json.length, count: built.count });
            if (_perf.backups.length > 20) _perf.backups.shift();
            console.log(`[perf] backup ${ms}ms / ${(built.json.length / 1024).toFixed(0)}K chars / ${built.count} msgs`);
        }
    } catch (e) {
        // 配额满/隐私模式：先用更小的 payload 再试一次；仍失败就保留上一份并留痕，等下一轮重试
        _perf.backupFailures++;
        try {
            const tiny = JSON.stringify(_buildBackupPayload(20, true));
            localStorage.setItem(_backupKey(), tiny);
            _lastBackupAt = Date.now();
            console.warn('[备份] 完整备份失败，已降级写入最近 20 条文字:', e);
        } catch (e2) {
            console.warn('[备份] localStorage 写入失败，保留上一份备份:', e);
        }
    }
}

function _cancelIdleBackup() {
    if (!_backupIdleHandle) return;
    try {
        if (_backupIdleIsIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(_backupIdleHandle);
        else clearTimeout(_backupIdleHandle);
    } catch (e) {}
    _backupIdleHandle = 0;
}

// force = true：退出/切后台/挂断路径，必须同步立即落盘
// force = false：saveData 结尾调用，放到空闲时段写，且最短 8 秒一次
function _backupCriticalData(force = true) {
    if (window._skipBackup || !SESSION_ID) return;
    if (force) {
        _cancelIdleBackup();
        _writeBackupNow();
        return;
    }
    if (Date.now() - _lastBackupAt < BACKUP_MIN_INTERVAL) {
        _perf.skippedBackups++;
        return;
    }
    if (_backupIdleHandle) return;
    const run = function () { _backupIdleHandle = 0; _writeBackupNow(); };
    if (typeof requestIdleCallback === 'function') {
        _backupIdleIsIdle = true;
        _backupIdleHandle = requestIdleCallback(run, { timeout: 2000 });
    } else {
        _backupIdleIsIdle = false;
        _backupIdleHandle = setTimeout(run, 200);
    }
}

function _parseBackupRaw(raw) {
    try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return null;
        if (!Array.isArray(obj.messages)) return null;
        // 会话隔离：没有归属信息、或归属不是当前会话，一律不拿来恢复
        if (!obj.sessionId || String(obj.sessionId) !== String(SESSION_ID)) return null;
        return obj;
    } catch (e) {
        return null;
    }
}

// 只用于"主存储为空/读取失败"的冷启动恢复，调用方必须先确认 IndexedDB 里确实没有消息
function _tryRecoverFromBackup() {
    if (!SESSION_ID) return null;
    try {
        const own = localStorage.getItem(_backupKey());
        if (own) {
            const p = _parseBackupRaw(own);
            if (p) return p;
        }
    } catch (e) {}
    // 老版本的全量镜像：只在首轮升级时读一次，读成功后会被新备份覆盖并删除
    try {
        const legacy = localStorage.getItem(BACKUP_LEGACY_KEY);
        if (legacy) {
            const p = _parseBackupRaw(legacy);
            if (p) return p;
        }
    } catch (e) {}
    return null;
}

function _peekLocalBackup() {
    const p = _tryRecoverFromBackup();
    if (!p) return null;
    return {
        ts: p.ts || 0,
        count: p.messages.length,
        truncated: !!p._truncated || p.messages.some(m => m && m._imgOmitted)
    };
}

// 恢复前先把"现场"留一份，避免恢复动作本身把当前状态冲掉
function _savePreRecoverySnapshot() {
    if (!SESSION_ID) return;
    try {
        localStorage.setItem(_preRecoveryKey(SESSION_ID), JSON.stringify({
            ts: Date.now(),
            sessionId: SESSION_ID,
            messageCount: messages.length,
            settings: _pickBackupSettings(),
            messages: _pickBackupMessages(20)
        }));
    } catch (e) {}
}

// 只清当前会话的兜底备份（清空当前会话消息时用）
function _clearLocalBackup() {
    if (SESSION_ID) {
        try { localStorage.removeItem(_backupKey()); } catch (e) {}
        try { localStorage.removeItem(_preRecoveryKey(SESSION_ID)); } catch (e) {}
    }
    _clearLegacyBackupKeys();
}

// 清掉所有会话的兜底备份（云端整体恢复 / 全量重置时用）
function _clearAllLocalBackups() {
    try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k.indexOf(BACKUP_V2_PREFIX) === 0 || k === BACKUP_LEGACY_KEY || k === BACKUP_LEGACY_TS_KEY) {
                toRemove.push(k);
            }
        }
        for (let j = 0; j < toRemove.length; j++) localStorage.removeItem(toRemove[j]);
    } catch (e) {}
}

window._clearLocalBackup = _clearLocalBackup;
window._clearAllLocalBackups = _clearAllLocalBackups;
window._peekLocalBackup = _peekLocalBackup;
window._backupCriticalData = _backupCriticalData;

let _saveInFlight = null;
let _saveQueued = false;

const saveData = async () => {
    if (!SESSION_ID) {
        console.warn('[saveData] SESSION_ID 尚未初始化，跳过保存以防数据写入临时 key');
        return;
    }

    // 同一时刻只跑一轮写入；期间再有保存请求就合并成"跑完再补一次"，
    // 避免连续发消息 / 拖动滑块时多轮全量写入互相叠加
    if (_saveInFlight) {
        _saveQueued = true;
        return _saveInFlight;
    }

    _saveInFlight = (async () => {
        const _t0 = _perf.enabled ? _perfNow() : 0;

        const promises = [
            { key: 'chatSettings',           val: () => localforage.setItem(getStorageKey('chatSettings'), settings) },
            { key: 'customReplies',          val: () => localforage.setItem(getStorageKey('customReplies'), customReplies) },
            { key: 'customReplyGroups',      val: () => localforage.setItem(getStorageKey('customReplyGroups'), window.customReplyGroups || []) },
            { key: 'customPokeGroups',        val: () => localforage.setItem(getStorageKey('customPokeGroups'), window.customPokeGroups || []) },
            { key: 'customStatusGroups',      val: () => localforage.setItem(getStorageKey('customStatusGroups'), window.customStatusGroups || []) },
            { key: 'customEmojis',           val: () => localforage.setItem(getStorageKey('customEmojis'), customEmojis) },
            { key: 'anniversaries',          val: () => localforage.setItem(getStorageKey('anniversaries'), anniversaries) },
            { key: 'customPokes',            val: () => localforage.setItem(getStorageKey('customPokes'), customPokes) },
            { key: 'customStatuses',         val: () => localforage.setItem(getStorageKey('customStatuses'), customStatuses) },
            { key: 'customMottos',           val: () => localforage.setItem(getStorageKey('customMottos'), customMottos) },
            { key: 'customIntros',           val: () => localforage.setItem(getStorageKey('customIntros'), customIntros) },
            { key: 'customPeriodCare',       val: () => localforage.setItem(getStorageKey('customPeriodCare'), customPeriodCare) },
            { key: 'stickerLibrary',         val: () => localforage.setItem(getStorageKey('stickerLibrary'), stickerLibrary) },
            { key: 'myStickerLibrary',       val: () => localforage.setItem(getStorageKey('myStickerLibrary'), myStickerLibrary) },
            { key: 'myStickerGroups',        val: () => localforage.setItem(getStorageKey('myStickerGroups'), window.myStickerGroups || []) },
            { key: 'customThemes',           val: () => localforage.setItem(`${APP_PREFIX}customThemes`, customThemes) },
            { key: 'themeSchemes',           val: () => localforage.setItem(`${APP_PREFIX}themeSchemes`, themeSchemes) },
            { key: 'chatMessages',           val: () => localforage.setItem(getStorageKey('chatMessages'), messages) },
        ];

        // 头像从内存缓存读（不从 DOM 读，DOM 的 img.src 不可靠：可能是 blob URL、绝对路径或空字符串）
        const partnerAvatarSrc = window._avatarCache && window._avatarCache.partner || null;
        const myAvatarSrc = window._avatarCache && window._avatarCache.me || null;

        if (partnerAvatarSrc) {
            promises.push({ key: 'partnerAvatar', val: () => localforage.setItem(getStorageKey('partnerAvatar'), partnerAvatarSrc) });
        }
        // 注意：头像不做 removeItem —— 用户没改头像时 _avatarCache 可能是 null，不能误删

        if (myAvatarSrc) {
            promises.push({ key: 'myAvatar', val: () => localforage.setItem(getStorageKey('myAvatar'), myAvatarSrc) });
        }

        const results = await Promise.allSettled(promises.map(p => {
            try { return p.val(); }
            catch(e) { return Promise.reject(e); }
        }));

        const failed = [];
        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                failed.push(promises[i].key);
                console.error(`[saveData] 保存失败: ${promises[i].key}`, r.reason);
            }
        });

        if (failed.length > 0) {
            console.warn(`[saveData] ${failed.length} 项写入失败，已触发 localStorage 降级备份`, failed);
        }

        if (_perf.enabled) {
            const ms = Math.round((_perfNow() - _t0) * 10) / 10;
            _perf.saves.push({ ms });
            if (_perf.saves.length > 20) _perf.saves.shift();
            const last = _perf.saves.slice(-20);
            const total = Math.round(last.reduce((sum, r) => sum + r.ms, 0) * 10) / 10;
            console.log(`[perf] saveData ${ms}ms | 最近 ${last.length} 次累计 ${total}ms`);
        }

        // 非强制：距上次同步兜底备份不足 8 秒就跳过（退出/切后台路径仍会强制立即备份）
        _backupCriticalData(false);
    })();

    try {
        return await _saveInFlight;
    } finally {
        _saveInFlight = null;
        if (_saveQueued) {
            _saveQueued = false;
            setTimeout(() => {
                const p = saveData();
                if (p && typeof p.catch === 'function') p.catch(e => console.warn('[saveData] 尾随保存失败:', e));
            }, 0);
        }
    }
};

        function initializeRandomUI() {


            document.querySelector('.header-motto').textContent = getRandomItem(CONSTANTS.HEADER_MOTTOS);
if (customMottos && customMottos.length > 0) {
    document.querySelector('.header-motto').textContent = getRandomItem(customMottos);
} else {
    document.querySelector('.header-motto').textContent = '';
}
            const placeholder = "";
            DOMElements.messageInput.placeholder = placeholder.length > 20 ? placeholder.substring(0, 20) + "...": placeholder;


            const starsContainer = document.getElementById('stars-container');
            starsContainer.innerHTML = '';
            const starCount = 80;
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'star';
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = Math.random() * 2.5 + 0.5;
                const duration = Math.random() * 4 + 2;
                const delay = Math.random() * 6;
                star.style.left = `${x}%`;
                star.style.top = `${y}%`;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.setProperty('--duration', `${duration}s`);
                star.style.animationDelay = `${delay}s`;
                starsContainer.appendChild(star);
            }
            const particlesContainer = document.getElementById('welcome-particles');
            if (particlesContainer) {
                particlesContainer.innerHTML = '';
                const types = ['petal', 'petal', 'petal', 'sparkle', 'sparkle'];
                for (let i = 0; i < 22; i++) {
                    const p = document.createElement('div');
                    const type = types[i % types.length];
                    p.className = `wp ${type}`;
                    const sz = type === 'petal' ? (Math.random() * 6 + 5) : (Math.random() * 4 + 2);
                    p.style.setProperty('--pSz', sz + 'px');
                    p.style.left = (Math.random() * 100) + '%';
                    p.style.setProperty('--pDur', (Math.random() * 10 + 9) + 's');
                    p.style.setProperty('--pDel', (Math.random() * 8) + 's');
                    p.style.setProperty('--pX1', (Math.random() * 50 - 25) + 'px');
                    p.style.setProperty('--pX2', (Math.random() * 80 - 40) + 'px');
                    p.style.setProperty('--pX3', (Math.random() * 50 - 25) + 'px');
                    particlesContainer.appendChild(p);
                }
            }

            const meteorsContainer = document.getElementById('welcome-meteors');
            if (meteorsContainer) {
                meteorsContainer.innerHTML = '';
                let meteorCount = 0;
                const MAX_METEORS = 12;
                const createMeteor = () => {
                    if (meteorCount >= MAX_METEORS) return;
                    meteorCount++;
                    const m = document.createElement('div');
                    m.className = 'meteor';
                    m.style.left = (Math.random() * 100) + '%';
                    m.style.top = (Math.random() * 35) + '%';
                    const dur = (Math.random() * 0.8 + 0.7);
                    m.style.setProperty('--mDur', dur + 's');
                    m.style.setProperty('--mDel', '0s');
                    m.style.setProperty('--mRot', (25 + Math.random() * 20) + 'deg');
                    meteorsContainer.appendChild(m);
                    setTimeout(() => { m.remove(); meteorCount = Math.max(0, meteorCount - 1); }, (dur + 0.1) * 1000);
                };
                for (let i = 0; i < 8; i++) setTimeout(createMeteor, i * 350);
                const meteorTimer = setInterval(createMeteor, 600);
                setTimeout(() => clearInterval(meteorTimer), 5000);
            }

            const loaderBarEl = document.getElementById('loader-tech-bar');
            if (loaderBarEl) {
                setTimeout(() => loaderBarEl.classList.add('pulsing'), 300);
            }


            const welcomeIcon = getRandomItem(CONSTANTS.WELCOME_ICONS);
document.querySelector('.logo-icon-main').innerHTML = `<i class="${welcomeIcon}"></i>`;

if (customIntros && customIntros.length > 0) {
    const rawIntro = getRandomItem(customIntros);
    const parts = rawIntro.split('|');
    const line1 = parts[0];
    const line2 = parts[1] || ""; 

    const titleEl = document.getElementById('welcome-title-glitch');
    const subEl = document.getElementById('welcome-subtitle-scramble');

    titleEl.classList.remove('playing');
    titleEl.textContent = line1;
    void titleEl.offsetWidth;
    titleEl.classList.add('playing');

    const scrambleText = (element, finalText, duration = 1500) => {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
                const length = finalText.length;
                let start = Date.now();

                const interval = setInterval(() => {
                    const now = Date.now();
                    const progress = (now - start) / duration;

                    if (progress >= 1) {
                        element.textContent = finalText;
                        clearInterval(interval);
                        return;
                    }

                    let result = '';

                    const revealIndex = Math.floor(progress * length);

                    for (let i = 0; i < length; i++) {
                        if (i <= revealIndex) {
                            result += finalText[i];
                        } else {

                            result += chars[Math.floor(Math.random() * chars.length)];
                        }
                    }
                    element.textContent = result;
                },
                    40);
            };


          setTimeout(() => {
        scrambleText(subEl, line2, 2000);
    }, 600);
} else {
    document.getElementById('welcome-title-glitch').textContent = "苹果日记";
    document.getElementById('welcome-subtitle-scramble').textContent = "请在设置中添加开场动画";
}


            const loaderBar = document.getElementById('loader-tech-bar');
            const statusText = document.getElementById('loader-status-text');
            loaderBar.style.width = '0%';
            const loadingPhases = [
                { width: '15%', text: 'INITIALIZING · 初始化中' },
                { width: '40%', text: 'LOADING MEMORIES · 读取记忆' },
                { width: '70%', text: 'BUILDING WORLD · 构建世界' },
                { width: '90%', text: 'ALMOST THERE · 即将完成' },
                { width: '100%', text: 'CONNECTED · 连接成功' }
            ];
            const delays = [100, 700, 1600, 2400, 2900];
            delays.forEach((delay, i) => {
                setTimeout(() => {
                    loaderBar.style.width = loadingPhases[i].width;
                    if (statusText) statusText.textContent = loadingPhases[i].text;
                }, delay);
            });
        }

function manageAutoSendTimer() {
    if (autoSendTimer) {
        clearInterval(autoSendTimer);
        autoSendTimer = null;
    }
    if (settings.autoSendEnabled) {
        const intervalMs = settings.autoSendInterval * 60 * 1000;
        
        autoSendTimer = setInterval(() => {
            if (!document.body.classList.contains('batch-favorite-mode')) {
                simulateReply(); 
            }
        }, intervalMs);
    }
}

        const updateUI = () => {
            const isCustomTheme = settings.colorTheme.startsWith('custom-');
            if (isCustomTheme) {
                const themeId = settings.colorTheme;
                const theme = customThemes.find(t => t.id === themeId);
                if (theme) {
                    applyTheme(theme.colors);
                } else {
                    DOMElements.html.setAttribute('data-color-theme', 'gold');
                }
            } else {
                DOMElements.html.setAttribute('data-color-theme', settings.colorTheme);
                applyTheme(null, true);
            }
            
            if (settings.customThemeColors && Object.keys(settings.customThemeColors).length > 0) {
                for (const [variable, value] of Object.entries(settings.customThemeColors)) {
                    document.documentElement.style.setProperty(variable, value);
                }
            }

            if (window.SummerTheme && window.SummerTheme.isEnabled()) {
                // 夏日白昼主题接管明暗与变量：避免被系统昼夜或自定义主题的变量覆盖
                window.SummerTheme.refresh();
            } else {
                DOMElements.html.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            }
            DOMElements.partner.name.textContent = settings.partnerName;
            DOMElements.me.name.textContent = settings.myName;
            DOMElements.partner.status.textContent = settings.partnerStatus || '在线';
            DOMElements.me.statusText.textContent = settings.myStatus;
            if (typeof window.updateDynamicNames === 'function') window.updateDynamicNames();
            document.documentElement.style.setProperty('--font-size', `${settings.fontSize}px`);
            
            const fontToUse = settings.messageFontFamily || "'Noto Serif SC', serif";
            
            document.documentElement.style.setProperty('--message-font-family', fontToUse);
            document.documentElement.style.setProperty('--font-family', fontToUse);
            document.documentElement.style.setProperty('--message-font-weight', settings.messageFontWeight);
            document.documentElement.style.setProperty('--message-line-height', settings.messageLineHeight);

            document.documentElement.style.setProperty('--in-chat-avatar-size', `${settings.inChatAvatarSize}px`);
            const _alignMap = { 'top': 'flex-start', 'center': 'center', 'bottom': 'flex-end', 'custom': 'flex-start' };
            document.documentElement.style.setProperty('--avatar-align', _alignMap[settings.inChatAvatarPosition || 'center'] || 'center');
            if (settings.inChatAvatarPosition === 'custom' && settings.inChatAvatarCustomOffset !== undefined) {
                document.documentElement.style.setProperty('--avatar-custom-offset', settings.inChatAvatarCustomOffset + 'px');
            }
            document.body.classList.toggle('always-show-avatar', !!settings.alwaysShowAvatar);
            if (typeof _applyCollapseState === 'function') _applyCollapseState(!!settings.bottomCollapseMode);
            document.body.classList.toggle('show-partner-name', !!(settings.showPartnerNameInChat || showPartnerNameInChat));

            document.querySelectorAll('.theme-color-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.theme === settings.colorTheme);
            });


            document.querySelectorAll('[data-bubble-style]').forEach(item => {
                item.classList.toggle('active', item.dataset.bubbleStyle === settings.bubbleStyle);
            });

            const _pillSyncMap = {
                '#reply-toggle': 'replyEnabled',
                '#sound-toggle': 'soundEnabled',
                '#read-receipts-toggle': 'readReceiptsEnabled',
                '#typing-indicator-toggle': 'typingIndicatorEnabled',
                '#read-no-reply-toggle': 'allowReadNoReply',
                '#emoji-mix-toggle': 'emojiMixEnabled',
                '#auto-send-toggle': 'autoSendEnabled',
                '#auto-reaction-toggle': 'autoReactionEnabled'
            };
            for (const [sel, prop] of Object.entries(_pillSyncMap)) {
                const el = document.querySelector(sel);
                if (el) {
                    const val = (prop === 'emojiMixEnabled' || prop === 'autoReactionEnabled') ? (settings[prop] !== false) : !!settings[prop];
                    el.classList.toggle('active', val);
                }
            }
            const _immToggle = document.getElementById('immersive-toggle');
            if (_immToggle) _immToggle.classList.toggle('active', document.body.classList.contains('immersive-mode'));

            renderMessages();
        };

        const updateAvatar = (element, src) => {
            if (src) {
                element.innerHTML = `<img src="${src}" alt="avatar">`;
                // 同时写内存缓存，供 saveData 读取（不从 DOM img.src 读，不可靠）
                if (!window._avatarCache) window._avatarCache = {};
                if (element === DOMElements.partner.avatar) window._avatarCache.partner = src;
                else if (element === DOMElements.me.avatar) window._avatarCache.me = src;
            } else {
                element.innerHTML = `<i class="fas fa-user"></i>`;
                // src 为空时清缓存（用户主动删除头像）
                if (window._avatarCache) {
                    if (element === DOMElements.partner.avatar) window._avatarCache.partner = null;
                    else if (element === DOMElements.me.avatar) window._avatarCache.me = null;
                }
            }
        };

        const removeBackground = () => {
            document.documentElement.style.removeProperty('--chat-bg-image');
            document.body.classList.remove('with-background');
            localforage.removeItem(getStorageKey('chatBackground'));
            safeRemoveItem(getStorageKey('chatBackground'));
            showNotification('背景图片已移除', 'success');
        };

        window.scrollToQuotedMessage = function(el) {
            const id = el.getAttribute('data-reply-id');
            if (!id) return;
            const target = document.querySelector(`[data-msg-id="${id}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('msg-highlight');
                setTimeout(() => target.classList.remove('msg-highlight'), 1500);
                return;
            }
            // 当前页面上没有这条消息（可能太老了，还没渲染到），统一走"定位到某条消息"这条路，
            // 不管这条消息有多老，只渲染它附近一小段，不会因为聊天记录长就变慢
            if (!window._jumpToMessage(id)) return;
            setTimeout(() => {
                const el2 = document.querySelector(`[data-msg-id="${id}"]`);
                if (el2) el2.classList.add('msg-highlight');
                setTimeout(() => { if (el2) el2.classList.remove('msg-highlight'); }, 1500);
            }, 60);
        };

function createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef) {
    const fragment = new DocumentFragment();
    const messageDate = new Date(msg.timestamp).toDateString();
    const prevDate = prevMsg ? new Date(prevMsg.timestamp).toDateString() : null;

    if (messageDate !== prevDate) {
        const dateDivider = document.createElement('div');
        dateDivider.className = 'date-divider';
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        const displayDate = (messageDate === today) ? '今天' : (messageDate === yesterday) ? '昨天' : new Date(msg.timestamp).toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        dateDivider.innerHTML = `<span>${displayDate}</span>`;
        fragment.appendChild(dateDivider);
        lastSenderRef.current = null;
    }

    if (msg.type === 'system') {
        const systemMsgDiv = document.createElement('div');
        systemMsgDiv.className = 'system-message';
        systemMsgDiv.dataset.msgId = msg.id; // 让"跳转到某条消息"能定位到拍一拍这类系统消息
        systemMsgDiv.innerHTML = msg.text;
        fragment.appendChild(systemMsgDiv);
        lastSenderRef.current = 'system';
        return fragment;
    }

    if (msg.type === 'call-event') {
        const callEvDiv = document.createElement('div');
        callEvDiv.className = 'call-event-message';
        callEvDiv.dataset.id = msg.id;
        callEvDiv.dataset.msgId = msg.id; // 让"跳转到某条消息"能定位到搞怪/通话记录
        const icon = msg.callIcon || 'fa-video';
        // 供夏日白昼主题区分通话记录图标：呼入 / 呼出 / 结束（其它事件如观影保持原样）
        const _isCallIcon = icon === 'fa-video' || icon === 'fa-phone-slash';
        const _callKind = !_isCallIcon ? 'other' : (/^\[通话\]\s*(呼入|呼出)/.test(msg.text || '') ? 'start' : 'end');
        const _callDir = _callKind === 'start' ? ((msg.text || '').indexOf('呼入') > -1 ? 'in' : 'out') : '';
        // 红色样式：通话拒绝/未接 + 陪伴拒绝/错过/取消
        const isRejected = icon === 'fa-phone-slash' ||
                           icon === 'fa-heart-crack' ||
                           icon === 'fa-circle-xmark';
        const colorClass = isRejected ? 'call-event-pill--rejected' : 'call-event-pill--ended';
        const detail = msg.callDetail ? `<span class="call-event-detail">${msg.callDetail}</span>` : '';
        // 通话记录标注发生时间（本地时间 YYYY-MM-DD HH:mm:ss）
        const _ts = new Date(msg.timestamp);
        const _pad = n => String(n).padStart(2, '0');
        const _timeStr = `${_ts.getFullYear()}-${_pad(_ts.getMonth() + 1)}-${_pad(_ts.getDate())} ${_pad(_ts.getHours())}:${_pad(_ts.getMinutes())}:${_pad(_ts.getSeconds())}`;
        const timeHTML = `<span class="call-event-time">${_timeStr}</span>`;
        callEvDiv.innerHTML = `<div class="call-event-pill ${colorClass}" data-call-kind="${_callKind}" data-call-dir="${_callDir}"><i class="fas ${icon} call-event-icon"></i><span class="call-event-label">${msg.text.replace(/ · .*/, '')}</span>${detail}${timeHTML}<button class="call-event-delete" title="删除" onclick="(function(btn){const id=btn.closest('[data-id]').dataset.id;const idx=messages.findIndex(m=>String(m.id)===String(id));if(idx>-1){messages.splice(idx,1);renderMessages();throttledSaveData();}})(this)"><i class="fas fa-times"></i></button></div>`;
        fragment.appendChild(callEvDiv);
        lastSenderRef.current = 'system';
        return fragment;
    }

    let showTimestamp = true;
    if (settings.timeFormat === 'off') {
        showTimestamp = false;
    } else if (nextMsg) {
        const currentTs = new Date(msg.timestamp).getTime();
        const nextTs = new Date(nextMsg.timestamp).getTime();
        if (nextMsg.sender === msg.sender && nextMsg.type !== 'system' && (nextTs - currentTs < 60000)) {
            showTimestamp = false;
        }
    }

    let isLastInSenderGroup = true;
    if (nextMsg) {
        const currentTs = new Date(msg.timestamp).getTime();
        const nextTs = new Date(nextMsg.timestamp).getTime();
        if (nextMsg.sender === msg.sender && nextMsg.type !== 'system' && (nextTs - currentTs < 60000)) {
            isLastInSenderGroup = false;
        }
    }

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${msg.sender === 'user' ? 'sent' : 'received'}`;
    wrapper.dataset.id = msg.id;
    wrapper.dataset.msgId = msg.id;

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    if (settings.inChatAvatarPosition === 'custom' && settings.inChatAvatarCustomOffset !== undefined) {
        avatarDiv.style.marginTop = settings.inChatAvatarCustomOffset + 'px';
    }

    const groupMember = (msg.sender !== 'user' && typeof getGroupMemberForMessage === 'function') ? getGroupMemberForMessage(msg.id) : null;

    if (settings.inChatAvatarEnabled) {
        const isSameSenderGroup = groupMember && lastSenderRef.current === 'group_' + (groupMember ? groupMember.name : '');
        const isSameSenderNormal = !groupMember && msg.sender === lastSenderRef.current;
        const shouldHide = !settings.alwaysShowAvatar && (isSameSenderGroup || isSameSenderNormal);
        if (shouldHide) {
            avatarDiv.classList.add('hidden');
        } else if (groupMember) {
            const groupAvatarShape = settings.partnerAvatarShape || 'circle';
            ['circle', 'square', 'pentagon', 'heart'].forEach(s => avatarDiv.classList.remove('shape-' + s));
            if (groupAvatarShape !== 'none') avatarDiv.classList.add('shape-' + groupAvatarShape);
            if (groupMember.avatar) {
                avatarDiv.innerHTML = `<img src="${groupMember.avatar}" style="width:100%;height:100%;object-fit:cover;">`;
            } else {
                const initials = (groupMember.name || '?').charAt(0).toUpperCase();
                avatarDiv.innerHTML = `<div style="width:100%;height:100%;background:var(--accent-color);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;">${initials}</div>`;
            }
        } else {
            const isUser = msg.sender === 'user';
            const avatarElement = isUser ? DOMElements.me.avatar : DOMElements.partner.avatar;
            const frameSettings = isUser ? settings.myAvatarFrame : settings.partnerAvatarFrame;
            const avatarShape = isUser ? (settings.myAvatarShape || 'circle') : (settings.partnerAvatarShape || 'circle');
            avatarDiv.innerHTML = avatarElement.innerHTML;
            applyAvatarFrame(avatarDiv, frameSettings);
            ['circle', 'square', 'pentagon', 'heart'].forEach(s => avatarDiv.classList.remove('shape-' + s));
            if (avatarShape !== 'none') avatarDiv.classList.add('shape-' + avatarShape);
        }
    } else {
        avatarDiv.style.display = 'none';
    }
    wrapper.appendChild(avatarDiv);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';

    if (groupMember && groupChatSettings.showName) {
        const nameLabel = document.createElement('div');
        nameLabel.className = 'group-sender-name';
        nameLabel.textContent = groupMember.name;
        const isSameSenderGroupForName = lastSenderRef.current === 'group_' + groupMember.name;
        if (!isSameSenderGroupForName) contentWrapper.appendChild(nameLabel);
    } else if (!groupMember && msg.sender !== 'user' && msg.sender !== null && (settings.showPartnerNameInChat || showPartnerNameInChat)) {
        const isSameSenderForName = lastSenderRef.current === msg.sender;
        if (!isSameSenderForName) {
            const nameLabel = document.createElement('div');
            nameLabel.className = 'group-sender-name';
            nameLabel.textContent = settings.partnerName || msg.sender || '对方';
            contentWrapper.appendChild(nameLabel);
        }
    }

    let messageHTML = '';
    if (msg.replyTo) {
        const repliedText = msg.replyTo.text || window._quotePreviewLabel(msg.replyTo);
        const repliedSender = msg.replyTo.sender === 'user' ? (settings.myName || '我') : (settings.partnerName || '对方');
        messageHTML += `<div class="reply-indicator" data-reply-id="${msg.replyTo.id || ''}" style="cursor:pointer;" onclick="scrollToQuotedMessage(this)"><span class="reply-indicator-sender">${repliedSender}</span><span class="reply-indicator-text">${repliedText}</span></div>`;
    }

    const isRedPacket = msg.type === 'redpacket';
    const isImageOnly = !msg.text && !!msg.image;
    let content = msg.text ? `<div>${msg.text.replace(/\n/g, '<br>')}</div>` : '';
    if (isRedPacket) {
        content = (window.RedPacket && typeof window.RedPacket.renderBubbleHTML === 'function') ? window.RedPacket.renderBubbleHTML(msg) : '';
    } else if (msg.image) {
        // 阶段三B：识别 oss:// 走懒加载；识别 pending:// 走本地 base64 + 上传中角标
        const isCloudImg = typeof msg.image === 'string' && msg.image.indexOf('oss://') === 0;
        const isPendingImg = typeof msg.image === 'string' && msg.image.indexOf('pending://') === 0;
        const imgAttrs = `class="message-image${isImageOnly ? ' message-image-only' : ''}" alt="图片" style="max-width:${isImageOnly ? '100px' : '100px'}; border-radius: 12px;${!isImageOnly ? ' margin-top: 6px;' : ''} cursor: pointer;" onclick="viewImage('${msg.image}')"`;
        if (isCloudImg) {
            content += `<img data-lazy-cloud-ref="${msg.image}" ${imgAttrs}>`;
        } else if (isPendingImg) {
            // 用一个包裹层放"上传中"角标
            content += `<div class="message-image-pending-wrap" style="position:relative;display:inline-block;">`
                + `<img data-pending-ref="${msg.image}" ${imgAttrs}>`
                + `<div class="upload-indicator" style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.55);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;"><i class="fas fa-cloud-upload-alt"></i></div>`
                + `</div>`;
        } else {
            content += `<img src="${msg.image}" ${imgAttrs}>`;
        }
    }
    messageHTML += content;

    const messageDiv = document.createElement('div');
    if (isRedPacket) {
        messageDiv.className = `message message-${msg.sender === 'user' ? 'sent' : 'received'} message-redpacket-bubble-wrap`;
    } else if (isImageOnly) {
        messageDiv.className = `message message-${msg.sender === 'user' ? 'sent' : 'received'} message-image-bubble-none`;
    } else {
        messageDiv.className = `message message-${msg.sender === 'user' ? 'sent' : 'received'} ${settings.bubbleStyle}`;
    }
    messageDiv.innerHTML = messageHTML;
    // 阶段三B：innerHTML 塞完后，找带 data-lazy-cloud-ref 的图绑定懒加载
    if (window.CloudMedia) {
        messageDiv.querySelectorAll('img[data-lazy-cloud-ref]').forEach(function (imgEl) {
            const ref = imgEl.getAttribute('data-lazy-cloud-ref');
            window.CloudMedia.bindLazyImage(imgEl, ref);
        });
        // 阶段三B：pending 图从本地 base64 显示
        messageDiv.querySelectorAll('img[data-pending-ref]').forEach(function (imgEl) {
            const ref = imgEl.getAttribute('data-pending-ref');
            window.CloudMedia.bindPendingImage(imgEl, ref);
        });
    }

    let actionsHTML = '';
    if (settings.replyEnabled) actionsHTML += `<button class="meta-action-btn reply-btn" title="回复"><i class="fas fa-reply"></i></button>`;
    actionsHTML += `<button class="meta-action-btn reaction-btn" title="表情回应"><i class="far fa-grin"></i></button>`;
    const starIcon = msg.favorited ? 'fas fa-star' : 'far fa-star';
    actionsHTML += `<button class="meta-action-btn favorite-action-btn ${msg.favorited ? 'favorited' : ''}" title="${msg.favorited ? '取消收藏' : '收藏'}"><i class="${starIcon}"></i></button>`;
    actionsHTML += `<button class="meta-action-btn delete-btn" title="删除"><i class="fas fa-trash-alt"></i></button>`;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-meta-actions';
    actionsDiv.innerHTML = actionsHTML;

    // ── 消息气泡外包一层不裁切的容器，反应小标签贴在这层上面，而不是贴在 .message 本身。
    //    .message 为了让自定义气泡皮肤边缘好看，设了 overflow:hidden，标签如果贴在里面、
    //    又要探出气泡边缘一点，会被这个裁切规则切掉——所以单独包一层。──
    const bubbleWrap = document.createElement('div');
    bubbleWrap.className = 'message-bubble-wrap';
    bubbleWrap.appendChild(messageDiv);
    if (msg.reaction) {
        const reactionBadge = document.createElement('div');
        reactionBadge.className = 'message-reaction-badge ' + (_shouldUseCircleBadge(msg.reaction) ? 'reaction-badge-emoji' : 'reaction-badge-kaomoji');
        reactionBadge.textContent = msg.reaction;
        reactionBadge.title = '反应：' + msg.reaction;
        bubbleWrap.appendChild(reactionBadge);
    }

    let metaHTML = '';
    if (showTimestamp) {
        const ts = new Date(msg.timestamp);
        let timeStr;
        const fmt = settings.timeFormat || 'HH:mm';
        if (fmt === 'HH:mm:ss') {
            timeStr = ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        } else if (fmt === 'h:mm AM/PM') {
            timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        } else if (fmt === 'h:mm:ss AM/PM') {
            timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
        } else {
            timeStr = ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        metaHTML += `<div class="timestamp">${timeStr}</div>`;
    }

    if (msg.sender === 'user' && settings.readReceiptsEnabled && isLastInSenderGroup) {
        const rrStyle = settings.readReceiptStyle || 'icon';
        if (rrStyle === 'text') {
            if (msg.status === 'read') {
                metaHTML += `<div class="read-receipt read" style="font-size:9px;letter-spacing:0.3px;font-weight:500;">已读</div>`;
            } else {
                metaHTML += `<div class="read-receipt" style="font-size:9px;letter-spacing:0.3px;opacity:0.5;">未读</div>`;
            }
        } else {
            const statusIcon = msg.status === 'read' ? 'fa-check-double' : 'fa-check';
            metaHTML += `<div class="read-receipt ${msg.status === 'read' ? 'read' : ''}"><i class="fas ${statusIcon}"></i></div>`;
        }
    }

    if (metaHTML !== '') {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';
        if (!showTimestamp && !metaHTML.includes('timestamp')) {
            metaDiv.style.height = 'auto';
            metaDiv.style.marginTop = '2px';
            if (settings.inChatAvatarPosition !== 'top') {
                avatarDiv.style.marginBottom = '18px';
            }
        } else {
            if (settings.inChatAvatarPosition !== 'top') {
                avatarDiv.style.marginBottom = '26px';
            }
        }
        metaDiv.innerHTML = metaHTML;
        contentWrapper.append(actionsDiv, bubbleWrap, metaDiv);
    } else {
        contentWrapper.append(actionsDiv, bubbleWrap);
    }
    wrapper.appendChild(contentWrapper);
    fragment.appendChild(wrapper);

    lastSenderRef.current = groupMember ? ('group_' + groupMember.name) : msg.sender;
    return fragment;
}

function _updateReadReceiptsDOM() {
    const container = DOMElements.chatContainer;
    const rrStyle = settings.readReceiptStyle || 'icon';
    container.querySelectorAll('.message-wrapper.sent').forEach(wrapper => {
        const receiptEl = wrapper.querySelector('.read-receipt');
        if (!receiptEl) return;
        const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
        const msg = messages.find(m => String(m.id) === String(msgId));
        if (!msg || msg.status !== 'read') return;
        if (rrStyle === 'text') {
            receiptEl.classList.add('read');
            receiptEl.textContent = '已读';
            receiptEl.style.opacity = '1';
        } else {
            receiptEl.classList.add('read');
            const icon = receiptEl.querySelector('i');
            if (icon) icon.className = 'fas fa-check-double';
        }
    });
}

// 滚到底部但不读 scrollHeight：直接把 scrollTop 设成超大值，由浏览器自己夹到最大值。
// behavior:'instant' 是为了绕开 CSS 的 scroll-behavior:smooth——否则赋值会被当成一次平滑滚动，
// 发完消息要滑好几百毫秒才到底（实测能差 4000 多 px）。
function _scrollToBottomInstant(container) {
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: 1e9, behavior: 'instant' });
    } else {
        container.scrollTop = 1e9;
    }
}

// 记录"追加一条消息"的 DOM 构建耗时，供 __PERF__.renderStats 读取
function _recordAppendCost(t0) {
    _perf.renderAppend++;
    if (!_perf.enabled) return;
    _perf.renderMs.push(Math.round((_perfNow() - t0) * 100) / 100);
    if (_perf.renderMs.length > 20) _perf.renderMs.shift();
}

function renderMessages(preserveScroll = false) {
    const container = DOMElements.chatContainer;
    const totalMessages = messages.length;

    let startIndex, endIndex, msgsToRender;
    if (msgViewMode === 'window') {
        // 历史浏览模式：只渲染 [msgWinStart, msgWinEnd) 这一小段，不管这段离最新消息有多远，
        // 渲染量都是恒定的，不会因为聊天记录变长就跟着变慢
        startIndex = Math.max(0, Math.min(msgWinStart, totalMessages));
        endIndex = Math.max(startIndex, Math.min(msgWinEnd, totalMessages));
        msgsToRender = messages.slice(startIndex, endIndex);
    } else {
        startIndex = Math.max(0, totalMessages - displayedMessageCount);
        endIndex = totalMessages;
        msgsToRender = messages.slice(startIndex);
    }

    const historyLoader = document.getElementById('history-loader');
    if (historyLoader) {
        historyLoader.style.display = startIndex > 0 ? 'flex' : 'none';
    }
    const futureLoader = document.getElementById('future-loader');
    if (futureLoader) {
        futureLoader.style.display = (msgViewMode === 'window' && endIndex < totalMessages) ? 'flex' : 'none';
    }

    DOMElements.emptyState.style.display = totalMessages === 0 ? 'flex' : 'none';

    // 只有"必须保持当前位置"的整表重建（换主题/换字体/导入/切窗口）才需要读高度；
    // 发消息走 addMessage 的追加路径，不会进这里，也就不会有这两次强制同步布局。
    let oldScrollHeight = 0, oldScrollTop = 0;
    if (preserveScroll) {
        _perf.renderLayoutReads += 2;
        oldScrollHeight = container.scrollHeight;
        oldScrollTop = container.scrollTop;
    }

    const fragment = new DocumentFragment();
    
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    fragment.appendChild(spacer);

    let lastSenderRef = { current: null };
    msgsToRender.forEach((msg, i) => {
        const prevMsg = i > 0 ? msgsToRender[i - 1] : (startIndex > 0 ? messages[startIndex - 1] : null);
        const nextMsg = i < msgsToRender.length - 1 ? msgsToRender[i + 1] : null;
        const msgFragment = createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef);
        fragment.appendChild(msgFragment);
    });

    // replaceChildren 一次完成"清空 + 插入"，比 innerHTML='' 再 appendChild 少一轮 DOM 变更
    container.replaceChildren(fragment);

    if (preserveScroll) {
        _perf.renderLayoutReads += 1;
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    } else if (msgViewMode !== 'window') {
        requestAnimationFrame(() => _scrollToBottomInstant(container));
    }
    // window模式下不自动滚动到底部/顶部，滚动位置由调用方（比如跳转定位）自己处理
    _perf.renderFull++;
    _clampReactionBadges();
}

// 反应标签默认是居中卡在气泡的左下/右下角的（见 CSS），内容长度正常的话不会跑出屏幕。
// 但碰上特别长的自定义表情/颜文字，居中之后还是可能有一侧探出屏幕，这里量一下、
// 超出了就用 --badge-safe-shift 往回拉一点，跟长按工具栏那个安全边距是同一个思路。
//
// 注意：这里必须"先写、再统一读、最后统一写"。原来的写法是每个标签"写属性→读 rect→写位移"，
// 每读一次都让上一次写入造成的布局失效，N 个标签就是 N 次强制同步布局。
let _badgeClampQueued = false;
let _badgeClampFull = false;
let _badgeClampScope = null;

// scope 传节点时只量该节点里的标签（新增/改动单条消息）；不传则整列表全量量一次
function _clampReactionBadges(scope) {
    if (scope && scope.nodeType === 1) {
        if (!_badgeClampFull) _badgeClampScope = scope;
    } else {
        _badgeClampFull = true;
        _badgeClampScope = null;
    }
    if (_badgeClampQueued) return;
    _badgeClampQueued = true;
    requestAnimationFrame(() => {
        _badgeClampQueued = false;
        const full = _badgeClampFull;
        const scoped = _badgeClampScope;
        _badgeClampFull = false;
        _badgeClampScope = null;

        const root = (!full && scoped && scoped.isConnected) ? scoped : document;
        const badges = root.querySelectorAll('.message-reaction-badge');
        const n = badges.length;
        if (!n) return;
        const SAFE_MARGIN = 10;

        // 阶段 1：只写——清掉上一轮的位移，此时不读任何几何信息
        for (let i = 0; i < n; i++) badges[i].style.removeProperty('--badge-safe-shift');

        // 阶段 2：一次性读完全部 rect，只会触发一次强制布局
        _perf.renderLayoutReads += 1;
        const rects = new Array(n);
        for (let i = 0; i < n; i++) rects[i] = badges[i].getBoundingClientRect();

        // 阶段 3：只写——按刚读到的矩形算位移
        const vw = window.innerWidth;
        for (let i = 0; i < n; i++) {
            const rect = rects[i];
            let shift = 0;
            if (rect.left < SAFE_MARGIN) {
                shift = SAFE_MARGIN - rect.left;
            } else if (rect.right > vw - SAFE_MARGIN) {
                shift = (vw - SAFE_MARGIN) - rect.right;
            }
            if (shift !== 0) badges[i].style.setProperty('--badge-safe-shift', shift + 'px');
        }
    });
}

// 跳转到某一条消息（搜索结果点击、引用消息点击都可以用这个统一入口），
// 不管这条消息离最新消息有多远，只渲染它附近一小段，不会因为聊天记录很长就卡顿
window._jumpToMessage = function(id) {
    const idx = messages.findIndex(m => String(m.id) === String(id));
    if (idx === -1) {
        if (typeof showNotification === 'function') showNotification('这条消息可能已被删除', 'info');
        return false;
    }

    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return false;

    const HALF = 50; // 目标消息前后各带50条上下文，数量固定，不会因为消息在哪个位置而变化
    msgViewMode = 'window';
    msgWinStart = Math.max(0, idx - HALF);
    msgWinEnd = Math.min(messages.length, idx + HALF + 1);
    newMsgCountWhileBrowsing = 0;

    renderMessages(false);

    requestAnimationFrame(() => {
        const el = container.querySelector('[data-msg-id="' + id + '"]');
        if (el) {
            // .chat-container 全局设了 scroll-behavior:smooth，scrollIntoView 的 behavior:'auto'
            // 会被这个 CSS 接管、跟着走平滑滚动——跳转距离近（比如搜索/引用跳转，通常离得不远）
            // 时不明显，但这次是从聊天末尾跳回一千多条之前，平滑动画跟不上，滚一半就没跟上了，
            // 实测卡在半路（scrollTop 只挪了几百px，目标还在屏幕外几千px）。
            // 改成直接算偏移量手动设 scrollTop，不走 scrollIntoView 那条会被 CSS 平滑滚动
            // 接管的路径，保证不管跳多远都是瞬间到位。
            const containerRect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const offset = (elRect.top - containerRect.top) - (container.clientHeight / 2) + (elRect.height / 2);
            const newScrollTop = container.scrollTop + offset;
            // 直接赋值 scrollTop 在新一点的浏览器实现里，一样会被 CSS 的 scroll-behavior:smooth
            // 接管（CSSOM View 规范里，设置 scrollTop 本身也算一次"滚动操作"，跟 scrollIntoView
            // 是同一套受 CSS 影响的机制，不是只有 scrollIntoView 才会被смооth）。
            // 改成显式调用 scrollTo 并传 behavior:'instant'——这个选项的优先级最高，
            // 不管 CSS 怎么设，都会强制瞬间跳到位，不会再半路"跟丢"。
            if (typeof container.scrollTo === 'function') {
                container.scrollTo({ top: newScrollTop, behavior: 'instant' });
            } else {
                container.scrollTop = newScrollTop;
            }
            el.style.transition = 'background .3s ease';
            el.style.background = 'rgba(var(--accent-color-rgb),.14)';
            setTimeout(() => { el.style.background = ''; }, 1800);
        }
        if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();
        if (typeof window._updateNewMsgIndicator === 'function') window._updateNewMsgIndicator();
    });
    return true;
};

// 从历史浏览模式回到最新消息——切回正常模式，重置成"只看最近一批"，然后自动滚到底部
window._backToLatestMessages = function() {
    msgViewMode = 'latest';
    displayedMessageCount = HISTORY_BATCH_SIZE;
    newMsgCountWhileBrowsing = 0;
    renderMessages(false);
    if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();
    if (typeof window._updateNewMsgIndicator === 'function') window._updateNewMsgIndicator();
};

// "回到最新消息"悬浮按钮的显示/隐藏——判断标准跟自动滚动是同一套：只要没追上底部就显示。
// caughtUpOverride 用于调用方已经判断过贴底状态时直接复用，避免同一帧里重复读高度
window._updateBackToLatestBtn = function(caughtUpOverride) {
    const btn = document.getElementById('back-to-latest-btn');
    if (!btn) return;
    const caughtUp = (typeof caughtUpOverride === 'boolean') ? caughtUpOverride : _isCaughtUpToLatest();
    btn.style.display = caughtUp ? 'none' : 'flex';
};

// "有N条新消息"提示——文案套在同一个按钮上，不额外加控件
window._updateNewMsgIndicator = function() {
    const btn = document.getElementById('back-to-latest-btn');
    const label = document.getElementById('back-to-latest-label');
    if (!btn || !label) return;
    if (msgViewMode === 'window' && newMsgCountWhileBrowsing > 0) {
        label.textContent = '有' + newMsgCountWhileBrowsing + '条新消息';
        btn.classList.add('has-new-msg');
    } else {
        label.textContent = '';
        btn.classList.remove('has-new-msg');
    }
};


// 判断"用户现在是不是正停在聊天最底部"——不看是通过什么方式到达当前位置的（正常聊天时手指往上划了一点、
// 还是从搜索/引用跳转过来的历史记录），只看两件事：① 当前渲染的这一段有没有已经连到最新消息；
// ② 滚动条实际位置离底部够不够近。两个都满足才算"追上了"，新消息来的时候才会自动帮你滚下去。
function _isCaughtUpToLatest() {
    if (msgViewMode === 'window' && msgWinEnd < messages.length) return false; // 当前渲染的窗口本来就没到最新，不管怎么滚都不算追上
    const c = DOMElements && DOMElements.chatContainer;
    if (!c) return true;
    return (c.scrollHeight - c.scrollTop - c.clientHeight) < 100;
}

// ── 消息反应（emoji reaction）────────────────────────────────────────
// 常用反应表：长按面板第一行直接展示的 7 个 + 一个"+"号，覆盖日常聊天最常见的几种情绪反馈
window.COMMON_REACTIONS = ['❤️', '😂', '😲', '😢', '😡', '🥺'];

// "+"展开后的完整表情表（已去重、去掉水果类）
window.EXTRA_REACTIONS = ['😀','🥲','☺️','😊','😍','🥰','😘','🤨','🧐','🤓','🤩','🥳','🙂‍↕️','😏','😒','🙂‍↔️','😞','😔','🙁','☹️','😫','😢','😭','😡','😑','😠','🤬','🤯','😳','😱','😨','😰','🫣','🤫','🫡','😶','😐','🙄','😯','😧','😲','🥱','🫩','😴','😪','😮‍💨','😵','🤢','🤮','😈','💩','👻','☠️','🫶','🤲🏻','🙌🏻','👏🏻','🤝🏻','👍🏻','👎🏻','👊🏻','✊🏻','✌🏻','🫰🏻','🤟🏻','🫳🏻','👌🏻','🤏🏻','👋🏻','💪🏻','🙏🏻','🖕🏻','👀','🌝','🌚','⭐️','🔥','❄️','🩷','❤️','🧡','💛','💚','🩵','💙','💜','🖤','🩶','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💓','💗','💖','💘','🉑','❌','❗️','✅','❎','✔️'];

// 判断一个反应是"纯 emoji"（底用圆形）还是"颜文字/自定义拼接表情"（底用现在这种胶囊形）。
// 做法：把零宽连接符、变体选择符、肤色修饰符这些"合法拼接用的东西"先去掉，
// 剩下的每个字符如果都落在 Unicode 的"象形符号"范围里，就判定是纯 emoji；
// 只要有一个不是（比如颜文字里常见的括号、片假名、ಠ_ಠ这种字母符号），就按颜文字处理。
function _isPureEmoji(str) {
    if (!str) return false;
    const stripped = String(str).replace(/[‍️\u{1F3FB}-\u{1F3FF}]/gu, '');
    if (!stripped) return true;
    try {
        return [...stripped].every(ch => /\p{Extended_Pictographic}/u.test(ch));
    } catch (e) {
        // 极老的浏览器不支持 \p{} Unicode 属性转义，退化成"看着像颜文字特征字符就不算纯emoji"
        return !/[()（）<>^_~°òóôõ·ノДД゜ｏ∀o]/.test(stripped);
    }
}

// 圆形底只适合"视觉上就是一个符号"的情况——哪怕这一个符号背后是好几个 unicode 码位拼出来的
// （比如 👍🏻 是"赞"+肤色，❤️‍🔥 是"心"+ZWJ+"火"拼成的一个"燃烧的心"），也还是一个圆能装下。
// 但如果是两个毫不相干的 emoji 连在一起（比如 😀😂），那是两个独立的字符，塞进固定大小的
// 圆形会被挤变形/裁掉，这种该走胶囊形。Intl.Segmenter 能准确数出"一段文字里实际有几个
// 可视字符"，不会把合法拼接出来的一个emoji误数成两个。
function _shouldUseCircleBadge(str) {
    if (!_isPureEmoji(str)) return false;
    try {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            return [...segmenter.segment(str)].length === 1;
        }
    } catch (e) {}
    // 没有 Intl.Segmenter 的老浏览器兜底：按"去掉拼接符之后还剩几个码位"粗略估算，
    // 不如 Segmenter 精确（遇到复杂合体 emoji 可能会误判成"不止一个"），但能覆盖大部分场景
    const stripped = String(str).replace(/[‍️\u{1F3FB}-\u{1F3FF}]/gu, '');
    return [...stripped].length === 1;
}

const RECENT_REACTIONS_KEY = 'recentReactionEmojis';
const RECENT_REACTIONS_MAX = 8;

function _getRecentReactions() {
    try {
        const raw = localStorage.getItem(RECENT_REACTIONS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function _recordRecentReaction(emoji) {
    try {
        let arr = _getRecentReactions().filter(e => e !== emoji);
        arr.unshift(emoji);
        arr = arr.slice(0, RECENT_REACTIONS_MAX);
        localStorage.setItem(RECENT_REACTIONS_KEY, JSON.stringify(arr));
    } catch (e) {}
}

// 引用（回复）一条没有文字的消息时，引用条里显示的文案：
// 红包 → [红包]；语音 → 语音 N"；表情包 → [表情]；真正的图片 → [图片]；其他（通话记录等）→ [消息]。
// 优先去聊天记录里按 id 找到原消息来判断（引用条里只存了 id/发送者/文字，没存类型）；找不到原消息再用引用条里带的字段。
// 梦角发的图片只有表情包这一种来源；用户发的图片要看它是不是在"我的表情库"里，是就算表情包。
window._quotePreviewLabel = function (q) {
    if (!q) return '[消息]';
    const orig = (typeof messages !== 'undefined' && Array.isArray(messages))
        ? (messages.find(function (m) { return String(m.id) === String(q.id); }) || q)
        : q;
    if (orig.type === 'redpacket') return '[红包]';
    if (orig.voice) return '语音 ' + (orig.voice.duration || 0) + '"';
    if (orig.image) {
        // 新消息发出时带 isSticker 标记，最准；老消息没有标记，就按下面的规则判断
        if (orig.isSticker) return '[表情]';
        if (orig.sender !== 'user') return '[表情]';
        // 老的、没有标记的用户消息：看这张图在不在表情库里（我的表情库的条目是 {src,...} 对象，梦角表情库是字符串）
        const inLib = function (lib) {
            return Array.isArray(lib) && lib.some(function (e) { return (e && typeof e === 'object' ? e.src : e) === orig.image; });
        };
        const mine = (typeof myStickerLibrary !== 'undefined') ? myStickerLibrary : [];
        const theirs = (typeof stickerLibrary !== 'undefined') ? stickerLibrary : [];
        return (inLib(mine) || inLib(theirs)) ? '[表情]' : '[图片]';
    }
    return '[消息]';
};

// 原地更新一条消息的反应小标签；成功返回 true，找不到对应节点返回 false 让调用方兜底重画
function _updateReactionBadgeInPlace(messageId, reaction) {
    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return false;
    const wrapper = container.querySelector('[data-msg-id="' + messageId + '"]');
    if (!wrapper) return false;
    const bubbleWrap = wrapper.querySelector('.message-bubble-wrap');
    if (!bubbleWrap) return false;
    const old = bubbleWrap.querySelector('.message-reaction-badge');
    if (old) old.remove();
    if (reaction) {
        const badge = document.createElement('div');
        badge.className = 'message-reaction-badge ' + (_shouldUseCircleBadge(reaction) ? 'reaction-badge-emoji' : 'reaction-badge-kaomoji');
        badge.textContent = reaction;
        badge.title = '反应：' + reaction;
        bubbleWrap.appendChild(badge);
    }
    // 只量这一条消息里的标签，不做全列表扫描
    _clampReactionBadges(wrapper);
    return true;
}

// 每条消息最多保留一个反应（不分是谁点的），位置固定跟着这条消息本身的气泡走：
// 用户发的消息 → 左下角；梦角发的消息 → 右下角（见 CSS .message-wrapper.sent/.received .message-reaction-badge）。
// 再点一次同一个表情 = 取消反应（气泡上的反应小标签本身也是直接点一下就撤回，走的是同一个函数）。
window.addReactionToMessage = function(messageId, emoji) {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;
    const isRemoving = message.reaction === emoji;
    message.reaction = isRemoving ? null : emoji;
    throttledSaveData();
    // 只更新这一条消息的反应小标签，不重画整个聊天列表（重画会闪一下、滚动位置还会漂）。
    // 找不到这条消息的节点（比如不在当前渲染范围内）才退回整体重画。
    if (!_updateReactionBadgeInPlace(messageId, message.reaction)) {
        renderMessages(true);
    }
    // 撤回反应时不放效果，「新加上」一个反应（不管是用户手动点的还是梦角自动给的）才满屏飘——
    // 纯emoji会在气球/礼花/烟花里随机抽一种；颜文字固定只用气球（带毛玻璃胶囊底），不会抽到礼花/烟花
    // 满屏飘的效果只在主聊天页播：用户在弹窗/情侣空间/陪伴页/电影院或页面在后台时跳过，
    // 不然会盖在别的页面上面飘（标签小标签本身已经更新了，回到聊天页就能看到）
    const _awayFromChat = (typeof window._isAwayFromChat === 'function') ? window._isAwayFromChat() : false;
    if (!isRemoving && !_awayFromChat && typeof window.playReactionBurst === 'function') {
        window.playReactionBurst(emoji);
    }
};

// 满屏飘表情的效果：纯emoji（单个）在气球（iMessage风格）/礼花/烟花三种里随机抽一种播放，图个惊喜感；
// 2个及以上拼在一起的emoji组合，风格仍然随机三选一，但字号和速度收窄一档（原因见 _playReactionBurstBalloon
// 的注释）；颜文字固定只用气球——字符串长短不一，转/炸的话经常会糊成一团不好看，飘的话配上毛玻璃胶囊底还算清爽。
// 性能上都只用 transform/opacity 做动画（GPU 合成，不触发重排），DOM 节点一次性用 DocumentFragment
// 批量插入（只触发一次重排/重绘），纯展示浮层、不挡点击，播完自己整体移除。
window.playReactionBurst = function(emoji) {
    if (!emoji) return;
    try {
        if (!_isPureEmoji(emoji)) {
            _playReactionBurstBalloon(emoji, { kaomoji: true });
            return;
        }
        // 是纯emoji，但拆出来不止一个「视觉字符」（比如 😀😂 这种两三个emoji拼在一起）——
        // 跟单个emoji用同一套字号范围的话，画面上会比单个emoji宽不少，贴着屏幕边缘飘的时候
        // 容易被切掉一截（跟颜文字同理，只是没那么夸张），所以也收窄一档，但风格还是正常三选一
        const isCombo = !_shouldUseCircleBadge(emoji);
        const styles = [_playReactionBurstBalloon, _playReactionBurstConfetti, _playReactionBurstFirework];
        const pick = styles[Math.floor(Math.random() * styles.length)];
        pick(emoji, isCombo ? { combo: true } : undefined);
    } catch (e) {}
};

// 气球：数量多、大小不一，2.5~4秒内陆续飘完自己消失。
// 垂直上升和左右摇摆拆成两层独立动画（外层匀速上升 + 内层钟摆式摇摆），避免同一个动画里又要变速
// 上升又要来回折返方向，折返的瞬间会看起来像"顿一下"；拆开之后每层都是匀速/顺滑的，就不会有停顿感了。
// opts.kaomoji === true 时是颜文字专用的那一版：整体放慢、字号收窄一些、外面套一层跟消息反应
// 小标签同款的毛玻璃胶囊底（宽度跟着文字内容自适应撑开），不然裸着一串颜文字飞过去不好认。
// opts.combo === true 时是多个emoji拼接（非颜文字）：跟颜文字共用同一套「字号收窄+放慢」的参数，
// 但不加毛玻璃底、风格也还是三选一（上面 playReactionBurst 里已经抽过了），只是传进来已经定好是气球。
function _playReactionBurstBalloon(emoji, opts) {
    const isKaomoji = !!(opts && opts.kaomoji);
    const isSlow = isKaomoji || !!(opts && opts.combo); // 颜文字和emoji组合共用一套收窄参数
    // 速度倍数（越大越慢）：单个/多个 emoji 比原来慢 1.6 倍，眼睛不容易累；颜文字速度保持原样。
    // 数量：颜文字只放原来的 70%；emoji 数量不变。
    const SPEED = isKaomoji ? 1 : 1.6;
    const COUNT = Math.max(6, Math.round((28 + Math.floor(Math.random() * 14)) * (isKaomoji ? 0.7 : 1))); // 28~41 个（颜文字 ×0.7）
    const container = document.createElement('div');
    container.className = 'reaction-burst-container';
    const fragment = document.createDocumentFragment();
    let maxFinish = 0;
    for (let i = 0; i < COUNT; i++) {
        const item = document.createElement('div');
        item.className = 'reaction-burst-item reaction-burst-balloon';
        const inner = document.createElement('span');
        inner.className = 'reaction-burst-emoji' + (isKaomoji ? ' reaction-burst-emoji-kaomoji' : '');
        inner.textContent = emoji;
        item.appendChild(inner);

        const left = 2 + Math.random() * 96; // vw，铺满全宽
        const delay = Math.random() * 1.2 * SPEED; // 错开出现时间，不是齐刷刷一起冒出来
        // 颜文字/emoji组合比单个emoji再放慢一档，字还在飘的时候好歹能看清
        const riseDuration = (isSlow ? (3.6 + Math.random() * 2.0) : (2.6 + Math.random() * 1.6)) * SPEED; // 原速：普通2.6~4.2s / 收窄版3.6~5.6s，再乘 SPEED
        const wobbleDuration = (isSlow ? (2.3 + Math.random() * 1.1) : (1.6 + Math.random() * 1.0)) * SPEED; // 原速：普通1.6~2.6s / 收窄版2.3~3.4s，再乘 SPEED
        const wobble = Math.round(14 + Math.random() * 30); // 14~44px 的摇摆幅度
        // 大小差异拉大：小的多、偶尔冒几个很大的，更有层次感（指数分布让小尺寸更常见）
        // 颜文字/emoji组合天生就比单个emoji宽，封顶字号调低一点，不然（颜文字）胶囊底会撑得很夸张，
        // （emoji组合）贴着屏幕边缘飘的时候容易被切掉一截
        const size = isSlow
            ? Math.round(13 + Math.pow(Math.random(), 1.8) * 21) // 13~34px
            : Math.round(14 + Math.pow(Math.random(), 1.8) * 46); // 14~60px

        item.style.left = left + 'vw';
        item.style.animationDelay = delay.toFixed(2) + 's';
        item.style.animationDuration = riseDuration.toFixed(2) + 's';
        item.style.fontSize = size + 'px';
        inner.style.animationDelay = (Math.random() * wobbleDuration).toFixed(2) + 's'; // 起始相位也随机，摆动不同步
        inner.style.animationDuration = wobbleDuration.toFixed(2) + 's';
        inner.style.setProperty('--burst-wobble', wobble + 'px');
        fragment.appendChild(item);
        maxFinish = Math.max(maxFinish, delay + riseDuration);
    }
    container.appendChild(fragment);
    document.body.appendChild(container);
    setTimeout(() => container.remove(), Math.ceil(maxFinish * 1000) + 300);
}

// 礼花：从顶部密集落下，带旋转，数量多、大小差异明显。opts.combo 见上面气球函数的说明。
function _playReactionBurstConfetti(emoji, opts) {
    const isCombo = !!(opts && opts.combo);
    const SPEED = 1.6; // 比原来慢 1.6 倍（旋转总角度不变，时长拉长后转得更慢）；数量不变
    const COUNT = 40 + Math.floor(Math.random() * 16); // 40~55 个
    const container = document.createElement('div');
    container.className = 'reaction-burst-container';
    const fragment = document.createDocumentFragment();
    let maxFinish = 0;
    for (let i = 0; i < COUNT; i++) {
        const item = document.createElement('div');
        item.className = 'reaction-burst-item reaction-burst-confetti';
        item.textContent = emoji;

        const delay = Math.random() * 0.6 * SPEED;
        const duration = (isCombo ? (2.8 + Math.random() * 1.6) : (1.8 + Math.random() * 1.2)) * SPEED; // 原速：普通1.8~3.0s / 组合2.8~4.4s，再乘 SPEED
        const sway = Math.round(Math.random() * 140 - 70);
        const spin = Math.round(360 + Math.random() * 540);
        const size = isCombo
            ? Math.round(12 + Math.pow(Math.random(), 1.6) * 16) // 12~28px
            : Math.round(12 + Math.pow(Math.random(), 1.6) * 34); // 12~46px

        item.style.left = Math.round(Math.random() * 100) + 'vw';
        item.style.animationDelay = delay.toFixed(2) + 's';
        item.style.animationDuration = duration.toFixed(2) + 's';
        item.style.animationTimingFunction = 'linear'; // 匀速下落：原来的 ease-in 越落越快，末尾那一下最晃眼
        item.style.fontSize = size + 'px';
        item.style.setProperty('--confetti-sway', sway + 'px');
        item.style.setProperty('--confetti-spin', spin + 'deg');
        fragment.appendChild(item);
        maxFinish = Math.max(maxFinish, delay + duration);
    }
    container.appendChild(fragment);
    document.body.appendChild(container);
    setTimeout(() => container.remove(), Math.ceil(maxFinish * 1000) + 300);
}

// 烟花：几个点同时向四周炸开，范围大、速度偏慢，更有冲击力。opts.combo 见上面气球函数的说明。
function _playReactionBurstFirework(emoji, opts) {
    const isCombo = !!(opts && opts.combo);
    const SPEED = 1.6; // 比原来慢 1.6 倍，几朵之间的间隔也一起拉长；数量不变
    const BURST_COUNT = 5;
    const RAYS = 12;
    const container = document.createElement('div');
    container.className = 'reaction-burst-container';
    const fragment = document.createDocumentFragment();
    let maxFinish = 0;
    for (let b = 0; b < BURST_COUNT; b++) {
        const originX = 10 + Math.random() * 80; // vw
        const originY = 15 + Math.random() * 50; // vh
        const burstDelay = (b * 0.28 + Math.random() * 0.1) * SPEED;
        for (let i = 0; i < RAYS; i++) {
            const angle = (i / RAYS) * Math.PI * 2 + Math.random() * 0.3;
            const dist = 90 + Math.random() * 70;
            const duration = (isCombo ? (2.4 + Math.random() * 0.9) : (1.4 + Math.random() * 0.5)) * SPEED; // 原速：普通1.4~1.9s / 组合2.4~3.3s，再乘 SPEED
            const size = isCombo
                ? Math.round(16 + Math.random() * 10) // 16~26px
                : Math.round(22 + Math.random() * 16); // 22~38px

            const item = document.createElement('div');
            item.className = 'reaction-burst-item reaction-burst-firework';
            item.textContent = emoji;
            item.style.left = originX + 'vw';
            item.style.top = originY + 'vh';
            item.style.animationDelay = burstDelay.toFixed(2) + 's';
            item.style.animationDuration = duration.toFixed(2) + 's';
            item.style.fontSize = size + 'px';
            item.style.setProperty('--firework-tx', Math.round(Math.cos(angle) * dist) + 'px');
            item.style.setProperty('--firework-ty', Math.round(Math.sin(angle) * dist) + 'px');
            fragment.appendChild(item);
            maxFinish = Math.max(maxFinish, burstDelay + duration);
        }
    }
    container.appendChild(fragment);
    document.body.appendChild(container);
    setTimeout(() => container.remove(), Math.ceil(maxFinish * 1000) + 300);
}

function _buildReactionGridItem(emoji, onPick) {
    const item = document.createElement('div');
    item.className = 'reaction-picker-item';
    item.textContent = emoji;
    item.addEventListener('click', () => onPick(emoji));
    return item;
}

// 长按工具栏里点击"表情回应"弹出的小面板：常用 7 个 + "+"号；点"+"展开完整表情表（含"最近使用"）
window.openReactionPicker = function(messageId, anchorEl) {
    const existing = document.getElementById('reaction-picker-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'reaction-picker-popup';
    popup.className = 'reaction-picker-popup';

    const pick = (emoji) => {
        window.addReactionToMessage(messageId, emoji);
        _recordRecentReaction(emoji);
        popup.remove();
        // 用户手动加表情 = 等同于发了一条新消息：走跟发消息一样的回复流程（已读→延迟→正在输入→回复）。
        // 撤回表情（再点同一个）不算；梦角自动给的表情不走这里，所以也不会触发。
        const reacted = messages.find(m => m.id === messageId);
        if (reacted && reacted.reaction && typeof window._triggerDelayedReply === 'function') {
            // 如果点的是用户自己发的消息，也记进"这一轮"候选池，跟发消息时的处理一致
            if (reacted.sender === 'user') {
                window._currentRoundMsgIds = window._currentRoundMsgIds || [];
                if (window._currentRoundMsgIds.indexOf(reacted.id) === -1) window._currentRoundMsgIds.push(reacted.id);
            }
            window._triggerDelayedReply(true);
        }
    };

    // 小面板的列数按"常用反应数量 + 1（"+"号）"来定，不要写死 8 列——不然常用反应数量以后
    // 再调（比如这次从 7 个减到 6 个），列数和实际格子数对不上，最后会空出一截不上不下的缺口
    popup.style.gridTemplateColumns = `repeat(${window.COMMON_REACTIONS.length + 1}, 34px)`;

    window.COMMON_REACTIONS.forEach(emoji => popup.appendChild(_buildReactionGridItem(emoji, pick)));

    const moreBtn = document.createElement('div');
    moreBtn.className = 'reaction-picker-item reaction-picker-more';
    moreBtn.innerHTML = '<i class="fas fa-plus"></i>';
    moreBtn.title = '更多表情';
    moreBtn.addEventListener('click', () => {
        popup.classList.add('reaction-picker-popup-expanded');
        popup.style.gridTemplateColumns = 'repeat(8, 34px)'; // 完整表情表固定按 8 列铺开
        popup.innerHTML = '';

        const recent = _getRecentReactions();
        if (recent.length > 0) {
            const label = document.createElement('div');
            label.className = 'reaction-picker-section-label';
            label.textContent = '最近使用';
            popup.appendChild(label);
            recent.forEach(emoji => popup.appendChild(_buildReactionGridItem(emoji, pick)));
            const sep = document.createElement('div');
            sep.className = 'reaction-picker-section-label';
            sep.textContent = '全部';
            popup.appendChild(sep);
        }

        window.EXTRA_REACTIONS.forEach(emoji => popup.appendChild(_buildReactionGridItem(emoji, pick)));

        // 内容变多了，重新定位一次，避免还按原来那个小面板的尺寸算，导致超出屏幕
        _repositionReactionPicker(popup, anchorEl);
    });
    popup.appendChild(moreBtn);

    document.body.appendChild(popup);

    _repositionReactionPicker(popup, anchorEl);

    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            // 用 composedPath 而不是 popup.contains(e.target)：点"+"之后会清空面板内容重新渲染，
            // 原来被点击的那个节点（比如"+"上的图标）在这次点击冒泡到 document 之前就已经从页面上
            // 被移除了，这时候 popup.contains(e.target) 永远是 false（哪怕明明点在面板里），
            // 会把刚展开的完整表情表立刻关掉。composedPath() 拿到的是点击发生那一刻的真实路径，
            // 不受后续 DOM 变化影响，不会有这个问题。
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            const clickedInsidePopup = path.includes(popup);
            if (!clickedInsidePopup && e.target !== anchorEl && !anchorEl.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', handler);
            }
        });
    }, 0);
};

// 定位在触发按钮附近，并保证不会贴着屏幕边缘（留安全边距）；展开成完整表情表之后内容变多了，
// 也会重新调一次，避免还按小面板的尺寸算，导致超出屏幕
function _repositionReactionPicker(popup, anchorEl) {
    const SAFE_MARGIN = 10;
    const rect = anchorEl.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - popupRect.width / 2;
    left = Math.max(SAFE_MARGIN, Math.min(left, window.innerWidth - popupRect.width - SAFE_MARGIN));
    let top = rect.top - popupRect.height - 8;
    if (top < SAFE_MARGIN) top = rect.bottom + 8;
    if (top + popupRect.height > window.innerHeight - SAFE_MARGIN) {
        top = Math.max(SAFE_MARGIN, window.innerHeight - SAFE_MARGIN - popupRect.height);
    }
    if (top < SAFE_MARGIN) top = SAFE_MARGIN; // 面板本身比屏幕还高时，至少贴顶，靠自身滚动条处理溢出
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

const addMessage = (message) => {
    if (!(message.timestamp instanceof Date)) message.timestamp = new Date(message.timestamp);

    const container = DOMElements.chatContainer;
    const wasEmpty = messages.length === 0;

    const prevMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    // 追没追上底部，要在"往数组里塞新消息、改动滚动高度"之前就先判断好，不然滚动高度已经变了，判断就不准了。
    // 用户自己发的消息永远要滚到底，不需要这次读取——省掉一次强制同步布局。
    let wasCaughtUp = true;
    if (message.sender !== 'user') {
        _perf.renderLayoutReads += 1;
        wasCaughtUp = _isCaughtUpToLatest();
    }
    messages.push(message);
    
    if (wasEmpty) {
        DOMElements.emptyState.style.display = 'none';
    }

    // 用户自己发的新消息：不能让它发出去后自己却看不到，不管之前在不在底部，都直接跳回/滚到最新（所有聊天软件的通用逻辑）
    if (message.sender === 'user') {
        if (msgViewMode === 'window') {
            throttledSaveData();
            if (message.type === 'normal' && typeof window._onUserMessage === 'function') {
                try { window._onUserMessage(message); } catch (e) { console.warn('[onUserMessage]', e); }
            }
            if (typeof window._backToLatestMessages === 'function') window._backToLatestMessages();
            return;
        }
        // 已经在 latest 模式，走下面正常的"追加+滚动到底"逻辑即可（wasCaughtUp 对用户自己发消息没意义，永远滚底）
    } else if (!wasCaughtUp) {
        // 对方发来新消息，但用户当前没有停在底部（不管是因为在翻很久以前的历史记录，
        // 还是就是正常聊天时手指往上划了一点点）——新消息不硬塞进当前视野、也不强行拽人，只悄悄计数提示
        if (msgViewMode === 'window' && msgWinEnd < messages.length) {
            // 窗口本来就没连到最新，DOM里没法接着往后加，直接跳过渲染这一步
        } else {
            // 处于 latest 模式但没在底部：消息本身仍然要能在"滚到底"之后看到，所以还是要把DOM追加上，只是不强制滚动
            const existingWrappers = container.querySelectorAll('.message-wrapper');
            const lastWrapper = existingWrappers.length > 0 ? existingWrappers[existingWrappers.length - 1] : null;
            if (lastWrapper && prevMsg) {
                const currentTs = new Date(message.timestamp).getTime();
                const prevTs = new Date(prevMsg.timestamp).getTime();
                if (message.sender === prevMsg.sender && message.type === 'normal' && prevMsg.type === 'normal' && (currentTs - prevTs < 60000)) {
                    const metaEl = lastWrapper.querySelector('.message-meta');
                    if (metaEl) metaEl.style.display = 'none';
                    const avatarEl = lastWrapper.querySelector('.message-avatar');
                    if (avatarEl) avatarEl.style.marginBottom = '';
                }
            }
            let lastSenderRef = { current: null };
            if (prevMsg) {
                const prevGroupMember = (prevMsg.sender !== 'user' && typeof getGroupMemberForMessage === 'function') ? getGroupMemberForMessage(prevMsg.id) : null;
                lastSenderRef.current = prevGroupMember ? ('group_' + prevGroupMember.name) : prevMsg.sender;
            }
            const _tAppend = _perfNow();
            const newMsgFragment = createMessageFragment(message, prevMsg, null, lastSenderRef);
            const spacer = container.querySelector('div[style*="flex: 1"]');
            if (spacer && spacer === container.lastElementChild) {
                spacer.before(newMsgFragment);
            } else {
                container.appendChild(newMsgFragment);
            }
            _recordAppendCost(_tAppend);
            // 修复消息重复bug：这里直接把新消息插入了DOM，displayedMessageCount 必须同步+1，
            // 否则这个计数器会跟实际显示的消息数量脱节，导致下次往上翻页时把已显示过的消息误判成"还没显示"而重复插入
            if (msgViewMode !== 'window') displayedMessageCount++;
        }
        newMsgCountWhileBrowsing++;
        if (typeof window._updateNewMsgIndicator === 'function') window._updateNewMsgIndicator();
        // 这里本来就已经确定"没停在底部"，把结果传进去，省掉悬浮按钮再读一次高度
        if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn(false);
        throttledSaveData();
        if (message.type === 'normal' && typeof window._onPartnerMessage === 'function') {
            try { window._onPartnerMessage(message); } catch (e) { console.warn('[onPartnerMessage]', e); }
        }
        if (message.type === 'normal' && Array.isArray(window._partnerMessageListeners)) {
            window._partnerMessageListeners.forEach(function (fn) {
                try { fn(message); } catch (e) { console.warn('[onPartnerMessage:listener]', e); }
            });
        }
        return;
    }

    // --- 正常情况：用户自己发消息、或对方发消息时用户本来就在底部 —— 追加消息并滚动到底 ---
    // --- Update previous message if needed ---
    const existingWrappers = container.querySelectorAll('.message-wrapper');
    const lastWrapper = existingWrappers.length > 0 ? existingWrappers[existingWrappers.length - 1] : null;
    if (lastWrapper && prevMsg) {
        const currentTs = new Date(message.timestamp).getTime();
        const prevTs = new Date(prevMsg.timestamp).getTime();

        if (message.sender === prevMsg.sender && message.type === 'normal' && prevMsg.type === 'normal' && (currentTs - prevTs < 60000)) {
            const metaEl = lastWrapper.querySelector('.message-meta');
            if (metaEl) metaEl.style.display = 'none';
            const avatarEl = lastWrapper.querySelector('.message-avatar');
            if (avatarEl) avatarEl.style.marginBottom = '';
        }
    }
    
    // --- Append new message ---
    let lastSenderRef = { current: null };
    if (prevMsg) {
        const prevGroupMember = (prevMsg.sender !== 'user' && typeof getGroupMemberForMessage === 'function') ? getGroupMemberForMessage(prevMsg.id) : null;
        lastSenderRef.current = prevGroupMember ? ('group_' + prevGroupMember.name) : prevMsg.sender;
    }
    
    const _tAppend = _perfNow();
    const newMsgFragment = createMessageFragment(message, prevMsg, null, lastSenderRef);
    
    const spacer = container.querySelector('div[style*="flex: 1"]');
    if (spacer && spacer === container.lastElementChild) {
        spacer.before(newMsgFragment);
    } else {
        container.appendChild(newMsgFragment);
    }
    _recordAppendCost(_tAppend);
    // 修复消息重复bug：同上，正常追加到底部时也要同步+1，理由同前面那处注释
    if (msgViewMode !== 'window') displayedMessageCount++;

    // 滚到底但不读 scrollHeight（详见 _scrollToBottomInstant 的注释）
    requestAnimationFrame(() => _scrollToBottomInstant(container));

    throttledSaveData();

    // 钩子：通知陪伴模块"梦角刚说了一句话"，让陪伴页可以同步显示气泡
    // 只对梦角的普通消息触发（不是用户消息、不是 system call-event 等）
    // 保留原有的单函数赋值方式（陪伴模块在用，不改动，避免影响它）
    if (message.sender !== 'user' && message.type === 'normal' && typeof window._onPartnerMessage === 'function') {
        try { window._onPartnerMessage(message); } catch (e) { console.warn('[onPartnerMessage]', e); }
    }
    // 新增：多监听通道，供电影院等新模块注册，跟上面那个单函数钩子并行、互不覆盖
    if (message.sender !== 'user' && message.type === 'normal' && Array.isArray(window._partnerMessageListeners)) {
        window._partnerMessageListeners.forEach(function (fn) {
            try { fn(message); } catch (e) { console.warn('[onPartnerMessage:listener]', e); }
        });
    }
    // 钩子：通知陪伴模块"用户刚发了一条消息"，让陪伴页气泡同步显示
    if (message.sender === 'user' && message.type === 'normal' && typeof window._onUserMessage === 'function') {
        try { window._onUserMessage(message); } catch (e) { console.warn('[onUserMessage]', e); }
    }
};

        window._addCallEvent = (icon, label, detail) => {
            addMessage({
                id: Date.now() + Math.random(),
                sender: 'system',
                text: label + (detail ? ' · ' + detail : ''),
                timestamp: new Date(),
                status: 'received',
                type: 'call-event',
                callIcon: icon || 'fa-video',
                callDetail: detail || null,
                favorited: false,
                note: null,
            });
        };

        function optimizeImage(file, maxWidth = 800, quality = 0.7) {
            return new Promise((resolve, reject) => {
                if (file.size < 300 * 1024) {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                    return;
                }
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    let {
                        width,
                        height
                    } = img;
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                    URL.revokeObjectURL(img.src);
                };
                img.onerror = () => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                    URL.revokeObjectURL(img.src);
                };
                img.src = URL.createObjectURL(file);
            });
        }

        window.updateReplyPreview = function() {
            const container = DOMElements.replyPreviewContainer;
            if (!container) return;
            if (!currentReplyTo) {
                container.innerHTML = '';
                container.style.display = 'none';
                return;
            }
            const senderName = currentReplyTo.sender === 'user' ? (settings.myName || '我') : (settings.partnerName || '对方');
            const previewText = currentReplyTo.text ? currentReplyTo.text.slice(0, 40) : window._quotePreviewLabel(currentReplyTo);
            container.style.display = 'flex';
            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(var(--accent-color-rgb),0.07);border-left:3px solid var(--accent-color);border-radius:0 8px 8px 0;width:100%;">
                    <div style="flex:1;min-width:0;">
                        <span style="font-size:11px;color:var(--accent-color);font-weight:600;">回复 ${senderName}</span>
                        <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${previewText}</div>
                    </div>
                    <button onclick="currentReplyTo=null;window.updateReplyPreview();" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:2px 4px;font-size:14px;">✕</button>
                </div>`;
        };
        function updateReplyPreview() { window.updateReplyPreview(); }

        // ── 对方拍一拍核心逻辑（提取为独立函数，供随机触发和测试指令共用）──
        window._triggerPartnerPoke = function() {
            let pokeAction = null;

            const groups = window.customPokeGroups || [];
            const allPokes = (typeof customPokes !== 'undefined' ? customPokes : []) || [];

            const enabledGroups = groups.filter(function(g) {
                return !g.disabled && Array.isArray(g.items) && g.items.length > 0;
            });

            const groupedItems = new Set();
            enabledGroups.forEach(function(g) { g.items.forEach(function(t) { groupedItems.add(t); }); });

            const ungroupedPokes = allPokes.filter(function(t) { return !groupedItems.has(t); });

            if (enabledGroups.length > 0) {
                const pickedGroup = enabledGroups[Math.floor(Math.random() * enabledGroups.length)];
                const groupPool = pickedGroup.items.filter(function(t) { return allPokes.includes(t); });
                if (groupPool.length > 0) {
                    pokeAction = groupPool[Math.floor(Math.random() * groupPool.length)];
                }
            }

            if (!pokeAction && ungroupedPokes.length > 0) {
                pokeAction = ungroupedPokes[Math.floor(Math.random() * ungroupedPokes.length)];
            }
            if (!pokeAction && allPokes.length > 0) {
                pokeAction = allPokes[Math.floor(Math.random() * allPokes.length)];
            }
            if (!pokeAction && CONSTANTS.POKE_ACTIONS && CONSTANTS.POKE_ACTIONS.length > 0) {
                pokeAction = getRandomItem(CONSTANTS.POKE_ACTIONS);
            }
            if (!pokeAction) {
                if (typeof showNotification === 'function') showNotification('拍一拍库为空，请先添加内容', 'warning', 2500);
                return;
            }

            if (typeof window._sanitizePokeTextForDisplay === 'function') {
                pokeAction = window._sanitizePokeTextForDisplay(pokeAction);
            }
            const pokeText = (typeof window._formatPartnerPokeText === 'function')
                ? window._formatPartnerPokeText(`${settings.partnerName} ${pokeAction}`)
                : `${settings.partnerName} ${pokeAction}`;

            const _pokeMsgId = Date.now();
            addMessage({ id: _pokeMsgId, text: pokeText, timestamp: new Date(), type: 'system' });
            if (typeof playSound === 'function') playSound('partner_poke');
            // 不在主聊天页（后台/弹窗/情侣空间……）时提示一下：后台弹系统通知，应用内弹横条
            if (typeof window._notifyPartnerEvent === 'function') window._notifyPartnerEvent('拍了拍你', _pokeMsgId);
            (function(){try{if(window._typingIndicatorAutoHideTimer){clearTimeout(window._typingIndicatorAutoHideTimer);window._typingIndicatorAutoHideTimer=null;}}catch(e){}var _tiW=document.getElementById('typing-indicator-wrapper');if(_tiW){var _tiInner=_tiW.querySelector('.typing-indicator');if(_tiInner){_tiInner.classList.add('hiding');setTimeout(function(){_tiW.style.display='none';if(_tiInner)_tiInner.classList.remove('hiding');},240);}else{_tiW.style.display='none';}}})();
        };

        // 输入框高度动态测量——不管清空还是有内容，统一走这一个函数，不再写死具体像素值。
        // styles.css 里 .message-input 在不同断点下 min-height 是不一样的（桌面46px/手机≤768px是
        // 42px/更小屏幕≤480px是38px），写死一个数字在窄屏上就会跟正确值对不上，
        // 表现出来就是"空的时候"（走写死值）比"有文字的时候"（走这里的scrollHeight动态测量）更高或更矮。
        // 用 scrollHeight 量出来的高度，天然就是当前断点下 CSS 实际生效的那个值，不用关心断点数字本身。
        //
        // 性能：原来每敲一个字都"写 height:auto → 读 scrollHeight"，等于每键一次强制同步布局。
        // 现在先按估算的视觉行数做一次便宜的比较，行数没变就直接跳过；
        // 真要测的时候合并到一帧 rAF 里，写完 auto 只读一次，再统一写像素高度，
        // 不再和 ResizeObserver 各跑一轮读写。
        const _inputSync = {
            rafId: 0,
            lastLines: -1,      // 上次测量时的估算行数，相同就跳过测量
            charsPerLine: 0,    // 按当前宽度折算的"每行几个字"，宽度变化时失效重算
            width: 0,           // 上次测量时输入框自身的宽度
            areaW: 0,           // 上次观察到的输入区宽度（RO 用，和上面区分开）
            appliedH: 0,        // 上次写进 style.height 的像素值
            areaH: 0,
            selfWrite: false,   // 标记"这次尺寸变化是我们自己写的"，避免 RO 再排一轮
            skipped: 0,
            samples: []         // __PERF__：最近 100 次测量的耗时（ms）
        };

        // 估算视觉行数：显式换行 + 每段按 charsPerLine 折算的折行数。
        // charsPerLine 是实测「内容宽度/字号」得出的，中文（全角）一个字正好 1em，估算和浏览器换行一致；
        // 一旦出现 ASCII 半角字符或 emoji（宽度≠字号、代理对算 2 个字符），估算就不再可靠，
        // 这时返回 -2 强制测量，宁可多测一次，也不让"文字已经换行但输入框没长高"。
        const INPUT_LINES_UNKNOWN = -2;
        function _estimateInputVisualLines(value) {
            if (!value) return 1;
            if (/[ -~]/.test(value) || /[\uD800-\uDFFF]/.test(value)) return INPUT_LINES_UNKNOWN;
            const perLine = _inputSync.charsPerLine > 0 ? _inputSync.charsPerLine : 12;
            const parts = value.split('\n');
            let lines = 0;
            for (let i = 0; i < parts.length; i++) {
                lines += Math.max(1, Math.ceil(parts[i].length / perLine));
            }
            return lines;
        }

        function _flushInputHeight() {
            _inputSync.rafId = 0;
            const ta = DOMElements.messageInput;
            if (!ta) return;
            const t0 = _perf.enabled ? _perfNow() : 0;

            // 读阶段：只写一次 auto，然后把要读的值一次读完，避免写-读-写交错
            ta.style.height = 'auto';
            const sh = ta.scrollHeight;
            const w = ta.clientWidth;
            if (w > 0 && _inputSync.charsPerLine <= 0) {
                const cs = window.getComputedStyle(ta);
                const fsPx = parseFloat(cs.fontSize) || 16;
                const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
                _inputSync.charsPerLine = Math.max(1, Math.floor((w - padX) / fsPx));
                _inputSync.width = w;
            }

            // 写阶段：像素高度，"正在输入"提示跟着输入区高度走
            const targetH = Math.min(sh, 120);
            _inputSync.selfWrite = true;
            ta.style.height = targetH + 'px';
            _inputSync.appliedH = targetH;

            const area = document.querySelector('.input-area-wrapper');
            const tiW = document.getElementById('typing-indicator-wrapper');
            if (area) {
                const areaH = area.offsetHeight;
                _inputSync.areaH = areaH;
                if (tiW && tiW.style.display !== 'none') tiW.style.bottom = areaH + 'px';
            }

            // 这一帧的尺寸变化是我们自己造成的，别让 RO 再补一轮
            requestAnimationFrame(() => { _inputSync.selfWrite = false; });

            if (_perf.enabled) {
                const ms = _perfNow() - t0;
                _inputSync.samples.push(ms);
                if (_inputSync.samples.length > 100) _inputSync.samples.shift();
                if (_perf.inputSync) {
                    _perf.inputSync.push(Math.round(ms * 10) / 10);
                    if (_perf.inputSync.length > 100) _perf.inputSync.shift();
                }
            }
        }

        function _syncMessageInputHeight() {
            const ta = DOMElements.messageInput;
            if (!ta) return;
            const lines = _estimateInputVisualLines(ta.value);
            const unknown = lines === INPUT_LINES_UNKNOWN;
            if (!unknown && lines === _inputSync.lastLines) {   // 行数没变：不用测量，省掉这次强制布局
                _inputSync.skipped++;
                return;
            }
            // 估算不可靠时把签名置为 NaN：下一次（包括清空/粘贴）一定会重新测量，
            // 避免半角/emoji 文本之后残留一个旧的"行数"把该缩回的高度挡掉
            _inputSync.lastLines = unknown ? NaN : lines;
            if (_inputSync.rafId) return;
            _inputSync.rafId = requestAnimationFrame(_flushInputHeight);
        }
        window._syncMessageInputHeight = _syncMessageInputHeight;

        function sendMessage(textOverride = null, type = 'normal') {
            const text = textOverride || DOMElements.messageInput.value.trim();
            const imageFile = DOMElements.imageInput.files[0];
            if (!text && !imageFile && type === 'normal') return;

            // ── 斜杠指令拦截 ──
            if (text && text.startsWith('/') && type === 'normal') {
                const cmd = text.replace(/\s+/g, '').toLowerCase();
                if (cmd === '/测试拍一拍' || cmd === '/testpoke') {
                    DOMElements.messageInput.value = '';
                    _syncMessageInputHeight();
                    if (typeof window._triggerPartnerPoke === 'function') window._triggerPartnerPoke();
                    if (typeof showNotification === 'function') showNotification('✦ 强制触发对方拍一拍', 'info', 1800);
                    return;
                }
                if (cmd === '/测试状态更新' || cmd === '/teststatus') {
                    DOMElements.messageInput.value = '';
                    _syncMessageInputHeight();
                    if (typeof window._triggerStatusChange === 'function') window._triggerStatusChange();
                    if (typeof showNotification === 'function') showNotification('✦ 强制触发状态更新', 'info', 1800);
                    return;
                }
            }

            DOMElements.messageInput.value = '';
            _syncMessageInputHeight();
            if (imageFile && imageFile.size > MAX_IMAGE_SIZE) {
                showNotification('图片大小不能超过5MB', 'error'); DOMElements.imageInput.value = ''; return;
            }

            const createMessage = (imgSrc = null) => {
                const messageData = {
                    id: Date.now(),
                    sender: 'user',
                    text: text || '',
                    timestamp: new Date(),
                    image: imgSrc,
                    status: 'sent',
                    favorited: false,
                    note: null,
                    replyTo: currentReplyTo,
                    type: type
                };
                if (type === 'system') messageData.sender = null;

                addMessage(messageData);
                if (type !== 'system' && messageData.sender === 'user') {
                    // 记录进"这一轮"候选池，供梦角自动表情反应使用（见 _triggerDelayedReply / simulateReply）
                    window._currentRoundMsgIds = window._currentRoundMsgIds || [];
                    window._currentRoundMsgIds.push(messageData.id);
                }
                if (type !== 'system') playSound('send');
                currentReplyTo = null;
                updateReplyPreview();

if (!isBatchMode && type === 'normal') {
    // 触发延迟回复（真实用户消息 → isUserMessage = true）
    window._triggerDelayedReply(true);
}
};

            if (imageFile) {
                showNotification('正在优化图片...', 'info', 1500);
                optimizeImage(imageFile).then(createMessage).catch(() => showNotification('图片处理失败', 'error'));
            } else {
                createMessage();
            }
            DOMElements.imageInput.value = '';
        }

        function toggleBatchMode() {
            isBatchMode = !isBatchMode;
            DOMElements.batchBtn.classList.toggle('active', isBatchMode);
            DOMElements.batchBtn.title = isBatchMode ? "退出批量模式": "批量发送模式";
            DOMElements.batchPreview.style.display = isBatchMode ? 'flex': 'none';
            const placeholder = "";
            DOMElements.messageInput.placeholder = isBatchMode ? "此刻，想说的有很多很多...": (placeholder.length > 20 ? placeholder.substring(0, 20) + "...": placeholder);
            if (isBatchMode) {
                batchMessages = []; updateBatchPreview();
            }
        }

        function addToBatch(imageOverride = null) {
            const text = DOMElements.messageInput.value.trim();
            if (!text && !imageOverride) return;
            batchMessages.push({
                id: Date.now() + batchMessages.length, text: text || '', image: imageOverride || null
            });
            DOMElements.messageInput.value = ''; _syncMessageInputHeight();
            updateBatchPreview();
        }

        function updateBatchPreview() {
            const previewContainer = DOMElements.batchPreview;
            let listHTML = '';
            if (batchMessages.length > 0) {
                listHTML = batchMessages.map((msg, index) => {
                    // 阶段三B：识别 oss:// 走懒加载（预览不设 src，塞完 innerHTML 后绑定）
                    let preview = '';
                    if (msg.image) {
                        const isCloudImg = typeof msg.image === 'string' && msg.image.indexOf('oss://') === 0;
                        if (isCloudImg) {
                            preview = `<img data-lazy-cloud-ref="${msg.image}" style="height:36px;width:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px;">`;
                        } else {
                            preview = `<img src="${msg.image}" style="height:36px;width:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px;">`;
                        }
                    }
                    const label = msg.text
                        ? `<span class="batch-preview-text">${msg.text}</span>`
                        : `<span class="batch-preview-text" style="color:var(--text-secondary);font-style:italic;">图片</span>`;
                    return `<div class="batch-preview-item" data-index="${index}">${preview}${label}<button class="batch-preview-edit" title="编辑"><i class="fas fa-pencil-alt"></i></button><button class="batch-preview-remove"><i class="fas fa-times"></i></button></div>`;
                }).join('');
            } else {
                listHTML = '<div style="text-align: center; color: var(--text-secondary); font-size: 14px; padding: 10px;">つ♡⊂</div>';
            }

            previewContainer.innerHTML = `
        <div class="batch-preview-title">我有很多的话想说…！</div>
        <div class="batch-actions-top" style="display:flex;gap:6px;padding:4px 10px 0;"><label style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:5px 8px;background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:12px;color:var(--text-secondary);"><i class="fas fa-image"></i>添加图片<input type="file" accept="image/*" style="display:none;" id="batch-image-input"></label></div>
        <div class="batch-preview-list">${listHTML}</div>
        <div class="batch-actions">
        <button class="batch-action-btn batch-cancel-btn">取消</button>
        <button class="batch-action-btn batch-send-btn" ${batchMessages.length === 0 ? 'disabled': ''}>发送全部 (${batchMessages.length})</button>
        </div>`;

            // 阶段三B：innerHTML 塞完后绑定云端图懒加载
            if (window.CloudMedia) {
                previewContainer.querySelectorAll('img[data-lazy-cloud-ref]').forEach(function (imgEl) {
                    const ref = imgEl.getAttribute('data-lazy-cloud-ref');
                    window.CloudMedia.bindLazyImage(imgEl, ref);
                });
            }

            const batchImgInput = document.getElementById('batch-image-input');
            if (batchImgInput) {
                batchImgInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    if (file.size > MAX_IMAGE_SIZE) { showNotification('图片超过5MB限制', 'warning'); return; }
                    try {
                        const base64 = await optimizeImage(file, 600, 0.8);
                        addToBatch(base64);
                    } catch(err) { showNotification('图片处理失败', 'error'); }
                    e.target.value = '';
                });
            }
        }

        function sendBatchMessages() {
            if (batchMessages.length === 0) return;
            showNotification(`正在发送 ${batchMessages.length} 条消息...`, 'info', 2000);
            batchMessages.forEach((msg, index) => {
                setTimeout(() => {
                    const batchMsgId = Date.now() + index;
                    addMessage({
                        id: batchMsgId, sender: 'user', text: msg.text || '', image: msg.image || null, isSticker: !!msg.isSticker, timestamp: new Date(), status: 'sent', favorited: false, type: 'normal'
                    });
                    window._currentRoundMsgIds = window._currentRoundMsgIds || [];
                    window._currentRoundMsgIds.push(batchMsgId);
                    playSound('send');
                }, index * 300);
            });
            const delayRange = settings.replyDelayMax - settings.replyDelayMin;
            const randomDelay = settings.replyDelayMin + Math.random() * delayRange;
            setTimeout(simulateReply, batchMessages.length * 300 + randomDelay);
            isBatchMode = false; batchMessages = [];
            DOMElements.batchBtn.classList.remove('active'); DOMElements.batchPreview.style.display = 'none';
            const placeholder = "";
            DOMElements.messageInput.placeholder = placeholder.length > 20 ? placeholder.substring(0, 20) + "...": placeholder;
        }

        function positionTypingIndicator() {
            var tiW = document.getElementById('typing-indicator-wrapper');
            var inputArea = document.querySelector('.input-area-wrapper');
            if (!tiW || !inputArea) return;
            var h = inputArea.offsetHeight;
            tiW.style.bottom = h + 'px';
        }
        (function() {
            var inputArea = document.querySelector('.input-area-wrapper');
            if (!inputArea) return;
            if (typeof ResizeObserver === 'undefined') {
                window.addEventListener('resize', function() {
                    // 宽度变了，每行字符数失效，需要重新折算并重测一次
                    _inputSync.charsPerLine = 0;
                    _inputSync.width = 0;
                    _inputSync.lastLines = -1;
                    _syncMessageInputHeight();
                });
                return;
            }
            var ro = new ResizeObserver(function(entries) {
                var entry = entries[entries.length - 1];
                // 宽度变化（横竖屏、面板伸缩）→ 每行字符数要重新折算
                if (entry && entry.contentRect && Math.abs(entry.contentRect.width - _inputSync.areaW) > 0.5) {
                    _inputSync.areaW = entry.contentRect.width;
                    _inputSync.charsPerLine = 0;
                    _inputSync.lastLines = -1;
                }
                // 这次高度变化是我们自己在 _flushInputHeight 里写出来的，已经处理过，不再排一轮
                if (_inputSync.selfWrite) {
                    _inputSync.selfWrite = false;
                    if (_inputSync.lastLines === -1) _syncMessageInputHeight();
                    return;
                }
                // 宽度变了（行数估算失效）：重测一次高度，不再额外走一轮读写
                if (_inputSync.lastLines === -1) {
                    _syncMessageInputHeight();
                    return;
                }
                var tiW = document.getElementById('typing-indicator-wrapper');
                if (tiW && tiW.style.display !== 'none') positionTypingIndicator();
            });
            ro.observe(inputArea);
        })();

        // 通用：触发"模拟用户发了消息后的延迟回复"机制
        //   isUserMessage: true 表示真实有用户消息（默认），false 表示陪伴页点击触发（不存在的虚拟消息）
        //   返回 true 表示已排队等待回复，false 表示被"已读不回"概率拦截
        window._triggerDelayedReply = function(isUserMessage) {
            if (isBatchMode) return false;
            // 真实用户消息一定要清除陪伴静默标志（避免陪伴中点了一下，回首页发消息时还跳过引用）
            if (isUserMessage) {
                window._companionSilentTrigger = false;
            }
            const delayRange = settings.replyDelayMax - settings.replyDelayMin;
            const randomDelay = settings.replyDelayMin + Math.random() * delayRange;

            const chance = Math.max(0, Math.min(1, Number(settings.readNoReplyChance) || 0));
            const shouldIgnore = settings.allowReadNoReply && (Math.random() < chance);

            // 只在有真实用户消息时才更新已读状态
            if (isUserMessage) {
                const readDelay = 1500 + Math.random() * 2500;
                setTimeout(() => {
                    let changed = false;
                    messages.forEach(msg => {
                        if (msg.sender === 'user' && msg.status !== 'read') {
                            msg.status = 'read';
                            changed = true;
                        }
                    });
                    if (changed) { _updateReadReceiptsDOM(); throttledSaveData(); }
                }, readDelay);
            }

            // 取消之前排队的回复（连续触发时只保留最后一次）
            if (window._pendingReplyTimer) clearTimeout(window._pendingReplyTimer);
            window._pendingReplyTimer = null;

            if (shouldIgnore) return false;

            // 显示 typing
            if (settings.typingIndicatorEnabled) {
                const tiWrapper = document.getElementById('typing-indicator-wrapper');
                const tiLabel = document.getElementById('typing-indicator-label');
                const tiAvatar = document.getElementById('typing-indicator-avatar');
                if (tiLabel) tiLabel.textContent = (settings.partnerName || '对方') + ' 正在输入';
                if (tiWrapper) {
                    positionTypingIndicator();
                    tiWrapper.style.display = 'block';
                }
                if (tiAvatar) {
                    const partnerImg = DOMElements.partner.avatar.querySelector('img');
                    tiAvatar.innerHTML = partnerImg ? `<img src="${partnerImg.src}">` : '<i class="fas fa-user"></i>';
                }
                if (_isCaughtUpToLatest() && DOMElements.chatContainer) DOMElements.chatContainer.scrollTop = DOMElements.chatContainer.scrollHeight;
            }

            // 排队回复
            window._pendingReplyTimer = setTimeout(() => {
                window._pendingReplyTimer = null;
                simulateReply();
                // 清除陪伴静默标志：延迟清除，确保 simulateReply 内部所有消息都已取到 recentUserMsgs 之后再清
                setTimeout(() => { window._companionSilentTrigger = false; }, (settings.replyDelayMax || 3000) + 500);
            }, randomDelay);
            return true;
        };

        window.simulateReply = function() {
            function showTypingIndicator() {
                if (!settings.typingIndicatorEnabled) return;
                const tiWrapper = document.getElementById('typing-indicator-wrapper');
                const tiLabel = document.getElementById('typing-indicator-label');
                const tiAvatar = document.getElementById('typing-indicator-avatar');
                if (tiLabel) tiLabel.textContent = (settings.partnerName || '对方') + ' 正在输入';
                if (tiWrapper) { 
                    positionTypingIndicator(); 
                    tiWrapper.style.display = 'block'; 
                }
                if (tiAvatar) {
                    const partnerImg = DOMElements.partner.avatar.querySelector('img');
                    tiAvatar.innerHTML = partnerImg ? `<img src="${partnerImg.src}">` : '<i class="fas fa-user"></i>';
                }
                // 判断标准不是"在不在历史浏览模式"，而是"用户现在实际有没有停在底部"——
                // 哪怕没有搜索/跳转，正常聊天时手指往上划了一点，也一样不该被强行拽回去
                if (_isCaughtUpToLatest()) {
                    DOMElements.chatContainer.scrollTop = DOMElements.chatContainer.scrollHeight;
                }
            }
            let changed = false;
            messages.forEach(msg => {
                if (msg.sender === 'user' && msg.status !== 'read') {
                    msg.status = 'read'; changed = true;
                }
            });
            if (changed) {
                _updateReadReceiptsDOM(); throttledSaveData();
            }

if (partnerPersonas && partnerPersonas.length > 0 && Math.random() < 0.3) {
                const currentPool = [
                    ...partnerPersonas
                ];
                if(currentPool.length > 0) {
                     const nextPersona = currentPool[Math.floor(Math.random() * currentPool.length)];
                     
                     settings.partnerName = nextPersona.name;
                     DOMElements.partner.name.textContent = nextPersona.name;
                     
                     if (nextPersona.avatar) {
                         updateAvatar(DOMElements.partner.avatar, nextPersona.avatar);
                         localforage.setItem(getStorageKey('partnerAvatar'), nextPersona.avatar);
                     }
                     throttledSaveData();
                }
            }
            // ── 对方拍一拍：3% 概率触发；触发了这次就不再走普通回复 ──
            const _doPoke = Math.random() < 0.03;
            if (_doPoke) {
                // 调用提取的通用函数（同时供 /测试拍一拍 指令使用）
                if (typeof window._triggerPartnerPoke === 'function') window._triggerPartnerPoke();
                return;
            }

            // ── 梦角主动发红包：跟上面拍一拍是完全独立的两套判定，互不影响——
            // 不 return，不影响这次正常回复照常生成；异步调用，不 await，不拖慢/阻塞回复流程，
            // 红包该不该发、发不发得出去，evaluatePartnerTrigger 内部自己算完自己存，
            // 这里只是在梦角每次要生成回复之前，顺手多"戳"它判定一次
            if (window.RedPacket && typeof window.RedPacket.evaluatePartnerTrigger === 'function') {
                window.RedPacket.evaluatePartnerTrigger().catch(function (e) {
                    console.warn('[红包] 判定过程出错，这次先跳过', e);
                });
            }

            const replyCount = Math.random() < 0.75 ? 1: (Math.random() < 0.95 ? 2: 3);
            if (!customReplies || customReplies.length === 0) {
                showNotification('回复库为空，请先到「自定义回复」中添加内容', 'info', 3500);
                return;
            }
            const disabledItemsOnce = (() => {
                try {
                    const raw = localStorage.getItem('disabledReplyItems');
                    return raw ? new Set(JSON.parse(raw)) : new Set();
                } catch (e) { return new Set(); }
            })();
            const disabledGroupItemsOnce = new Set();
            (window.customReplyGroups || []).forEach(g => {
                if (g.disabled && Array.isArray(g.items)) g.items.forEach(item => disabledGroupItemsOnce.add(item));
            });
            const replyPoolOnce = customReplies
                .filter(r => !disabledItemsOnce.has(r) && !disabledGroupItemsOnce.has(r))
                .map(r => String(r || '').trim())
                .filter(Boolean);
            if (!replyPoolOnce.length) {
                showNotification('回复库可用内容为空（可能被分组禁用或屏蔽），请到「自定义回复」中调整', 'info', 4000);
                return;
            }

            // 确认有可用回复后再展示“正在输入中”，避免空转
            showTypingIndicator();
            let delay = 0;
            // 陪伴页静默触发时不引用用户消息（陪伴中的触发不是用户发了某条具体消息）
            const recentUserMsgs = (settings.replyEnabled && !window._companionSilentTrigger)
                ? messages.filter(m => m.sender === 'user' && m.text).slice(-10)
                : [];

            // ── 梦角自动表情反应：候选池只取"这一轮"（上次回复之后用户连续发的消息），
            //    跟引用回复、表情混入消息都是各自独立摇骰子，互不影响 ──
            const roundCandidateIds = (window._currentRoundMsgIds || []).slice();
            window._currentRoundMsgIds = []; // 这一轮即将被回复，清空计数，下一次发消息重新算一轮
            if (settings.autoReactionEnabled !== false && !window._companionSilentTrigger && roundCandidateIds.length > 0 && Math.random() < 0.2) {
                if (!customEmojis || customEmojis.length === 0) {
                    showNotification('自定义 Emoji 库为空，梦角暂时没法给消息加反应', 'info', 3000);
                } else {
                    const targetId = roundCandidateIds[Math.floor(Math.random() * roundCandidateIds.length)];
                    const targetMsg = messages.find(m => m.id === targetId);
                    if (targetMsg && typeof window.addReactionToMessage === 'function') {
                        const emoji = customEmojis[Math.floor(Math.random() * customEmojis.length)];
                        window.addReactionToMessage(targetId, emoji);
                        // 不在主聊天页时提示：后台弹系统通知，应用内弹横条，点一下跳到被加表情的那条消息
                        if (typeof window._notifyPartnerEvent === 'function') {
                            window._notifyPartnerEvent('回应了你的消息 ' + emoji, targetId);
                        }
                    }
                }
            }

            for (let i = 0; i < replyCount; i++) {
                const delayRange = settings.replyDelayMax - settings.replyDelayMin;
                delay += settings.replyDelayMin + Math.random() * delayRange;
                setTimeout(() => {
                    try {
                    const replyPool = replyPoolOnce;
                    // 被屏蔽或无效项直接换下一个，尽量保证每次都产出可用回复
                    let replyText = '';
                    if (settings.combineReplyCards) {
                        // 拼接字卡：1 ~ combineReplyMaxCards 句随机拼接，句子间随机加标点断句
                        const maxN = Math.max(1, Math.min(5, parseInt(settings.combineReplyMaxCards, 10) || 3));
                        const n = 1 + Math.floor(Math.random() * maxN);
                        for (let k = 0; k < n; k++) {
                            const picked = replyPool[Math.floor(Math.random() * replyPool.length)];
                            replyText += picked + (Math.random() < .2 ? '！' : Math.random() < .2 ? '……' : '。');
                        }
                    } else {
                        // 开关关闭：老逻辑，只抽1句（保留原有的跳过空/无效项重试）
                        for (let t = 0; t < 6; t++) {
                            const picked = replyPool[Math.floor(Math.random() * replyPool.length)];
                            if (picked && String(picked).trim()) {
                                replyText = String(picked).trim();
                                break;
                            }
                        }
                    }
                    if (!replyText && i === replyCount - 1) {
                        (function(){try{if(window._typingIndicatorAutoHideTimer){clearTimeout(window._typingIndicatorAutoHideTimer);window._typingIndicatorAutoHideTimer=null;}}catch(e){}var _tiW=document.getElementById('typing-indicator-wrapper');if(_tiW){var _tiInner=_tiW.querySelector('.typing-indicator');if(_tiInner){_tiInner.classList.add('hiding');setTimeout(function(){_tiW.style.display='none';if(_tiInner)_tiInner.classList.remove('hiding');},240);}else{_tiW.style.display='none';}}})();
                        return;
                    }

                    let disabledStickerItems = new Set();
                    try {
                        const raw = localStorage.getItem('disabledStickerItems');
                        if (raw) disabledStickerItems = new Set(JSON.parse(raw));
                    } catch (e) {}
                    const enabledStickerPool = (stickerLibrary || []).filter(s => !disabledStickerItems.has(s));
                    const shouldSendSticker = enabledStickerPool.length > 0 && Math.random() < 0.2;

                    let finalText = replyText;
                    let separateEmoji = null;
                    if (customEmojis && customEmojis.length > 0 && Math.random() < 0.2) {
                        const emoji = customEmojis[Math.floor(Math.random() * customEmojis.length)];
                        if (settings.emojiMixEnabled !== false) {
                            finalText = Math.random() < 0.5
                                ? emoji + ' ' + replyText
                                : replyText + ' ' + emoji;
                        } else {
                            separateEmoji = emoji;
                        }
                    }

                    addMessage({
                        id: Date.now() + i,
                        sender: settings.partnerName || '对方',
                        text: finalText,
                        timestamp: new Date(),
                        status: 'received',
                        favorited: false,
                        note: null,
                        replyTo: (i === 0 && recentUserMsgs.length > 0 && Math.random() < 0.3)
                            ? (function(){ const m = recentUserMsgs[Math.floor(Math.random() * recentUserMsgs.length)]; return { id: m.id, text: m.text, sender: m.sender }; })()
                            : null,
                        type: 'normal'
                    });
                    if (typeof window._sendPartnerNotification === 'function') {
                        window._sendPartnerNotification(settings.partnerName || '对方', finalText);
                    }
                    playSound('message');

                    if (shouldSendSticker) {
                        const randomSticker = enabledStickerPool[Math.floor(Math.random() * enabledStickerPool.length)];
                        setTimeout(() => {
                            addMessage({
                                id: Date.now() + i + 2000,
                                sender: settings.partnerName || '对方',
                                text: '',
                                timestamp: new Date(),
                                image: randomSticker,
                                isSticker: true,
                                status: 'received',
                                favorited: false,
                                note: null,
                                type: 'normal'
                            });
                            playSound('message');
                            if (typeof window._sendPartnerNotification === 'function') {
                                window._sendPartnerNotification(settings.partnerName || '对方', '[表情]');
                            }
                        }, 400 + Math.random() * 600);
                    }

                    if (separateEmoji) {
                        setTimeout(() => {
                            addMessage({
                                id: Date.now() + i + 1000,
                                sender: settings.partnerName || '对方',
                                text: separateEmoji,
                                timestamp: new Date(),
                                status: 'received',
                                favorited: false,
                                note: null,
                                type: 'normal'
                            });
                            playSound('message');
                        }, 300 + Math.random() * 400);
                    }

                    if (i === replyCount - 1) {
                        (function() {
                            try {
                                if (window._typingIndicatorAutoHideTimer) {
                                    clearTimeout(window._typingIndicatorAutoHideTimer);
                                    window._typingIndicatorAutoHideTimer = null;
                                }
                            } catch (e) {}
                            var _tiW = document.getElementById('typing-indicator-wrapper');
                            if (_tiW) {
                                var _tiInner = _tiW.querySelector('.typing-indicator');
                                if (_tiInner) {
                                    _tiInner.classList.add('hiding');
                                    setTimeout(function() {
                                        _tiW.style.display = 'none';
                                        if (_tiInner) _tiInner.classList.remove('hiding');
                                    }, 240);
                                } else {
                                    _tiW.style.display = 'none';
                                }
                            }
                        })();
                    }
                    } catch (e) {
                        console.error('[simulateReply] 渲染/回填出错:', e);
                        // 机制性兜底：出错时至少让“正在输入中”消失，避免假死
                        try {
                            (function(){
                                try { if (window._typingIndicatorAutoHideTimer) { clearTimeout(window._typingIndicatorAutoHideTimer); window._typingIndicatorAutoHideTimer = null; } } catch (e2) {}
                                var _tiW2 = document.getElementById('typing-indicator-wrapper');
                                if (_tiW2) _tiW2.style.display = 'none';
                            })();
                        } catch (e2) {}
                    }
                }, delay);
            }
        }

function showModal(modalElement, focusElement = null) {
            const _deferredCss = modalElement && _deferredCssByModal[modalElement.id];
            if (_deferredCss) loadCssOnce(_deferredCss);
            if (modalElement._hideTimeout) {
                clearTimeout(modalElement._hideTimeout);
                modalElement._hideTimeout = null;
            }
            modalElement.style.display = 'flex';
            requestAnimationFrame(() => {
                const content = modalElement.querySelector('.modal-content');
                if (content) {
                    content.style.opacity = '1';
                    content.style.transform = 'translateY(0) scale(1)';
                }
                if (focusElement) {
                    setTimeout(() => focusElement.focus(), 100);
                }
            });
        }

        function hideModal(modalElement) {
            const content = modalElement.querySelector('.modal-content');
            if (content) {
                content.style.opacity = '0';
                content.style.transform = 'translateY(20px) scale(0.95)';
            }
            if (modalElement._hideTimeout) clearTimeout(modalElement._hideTimeout);
            modalElement._hideTimeout = setTimeout(() => {
                modalElement.style.display = 'none';
            }, 300);
        }

        async function viewImage(src) {
            // 阶段三B：云端引用先下载；pending 引用从本地 base64 读
            let displaySrc = src;
            let downloadHref = src;
            if (typeof src === 'string' && src.indexOf('oss://') === 0) {
                if (!window.CloudMedia) return;
                try {
                    displaySrc = await window.CloudMedia.fetchUrl(src);
                    downloadHref = displaySrc;
                } catch (e) {
                    if (typeof showNotification === 'function') showNotification('图片加载失败', 'error');
                    return;
                }
            } else if (typeof src === 'string' && src.indexOf('pending://') === 0) {
                if (!window.CloudMedia) return;
                const base64 = await window.CloudMedia.getPendingBase64(src);
                if (!base64) {
                    if (typeof showNotification === 'function') showNotification('图片仍在准备中', 'info');
                    return;
                }
                displaySrc = base64;
                downloadHref = base64;
            }
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;touch-action:pinch-zoom;';
            modal.innerHTML = `
                <div style="position:relative;max-width:95vw;max-height:92vh;display:flex;align-items:center;justify-content:center;">
                    <img src="${displaySrc}" style="max-width:95vw;max-height:88vh;object-fit:contain;display:block;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);" draggable="false">
                    <button onclick="this.closest('[style*=fixed]').remove()" style="position:fixed;top:16px;right:16px;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);z-index:10;line-height:1;">×</button>
                    <a href="${downloadHref}" download style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 24px;background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3);border-radius:20px;color:#fff;font-size:13px;text-decoration:none;backdrop-filter:blur(8px);display:flex;align-items:center;gap:6px;"><i class="fas fa-download"></i> 保存图片</a>
                </div>`;
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.tagName === 'IMG') modal.remove();
            });
            document.body.appendChild(modal);
        }

        async function exportChatHistory() {
            // 直接从 localforage 读取日记（不依赖内存缓存，防止懒加载未就绪时为空）
            let _diaryForExport = [];
            let _moodForExport = null;
            let _customMoodOptionsForExport = [];
            try {
                const _allKeys = await localforage.keys();
                const _diaryKey = _allKeys.find(k => k.includes('companionDiary') && !k.includes('Bg') && !k.includes('Gallery'));
                if (_diaryKey) _diaryForExport = (await localforage.getItem(_diaryKey)) || [];
                const _moodKey = _allKeys.find(k => k.includes('moodCalendar'));
                if (_moodKey) _moodForExport = (await localforage.getItem(_moodKey)) || {};
                const _moodOptsKey = _allKeys.find(k => k.includes('customMoodOptions'));
                if (_moodOptsKey) _customMoodOptionsForExport = (await localforage.getItem(_moodOptsKey)) || [];
            } catch(e) { _diaryForExport = []; _moodForExport = {}; }

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
            overlay.innerHTML = `
                <div style="background:var(--secondary-bg);border-radius:20px;padding:24px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:modalContentSlideIn 0.3s ease forwards;">
                    <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-file-export" style="color:var(--accent-color);font-size:14px;"></i>选择导出内容
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">勾选需要导出的数据模块</div>
                    <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:20px;">
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_msgs" checked style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-comments" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>聊天记录 <span style="font-size:11px;color:var(--text-secondary);">(${messages.length} 条)</span></span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_settings" checked style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-sliders-h" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>外观与聊天设置</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_replies" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-reply" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>字卡回复库</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_ann" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-calendar-heart" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>纪念日 / 倒计时</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_themes" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-palette" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>自定义主题配色</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_diary" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-book-open" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>陪伴日记 <span style="font-size:11px;color:var(--text-secondary);">(${_diaryForExport.length} 条)</span></span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_mood" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-face-smile" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>心情手账 <span style="font-size:11px;color:var(--text-secondary);">(${Object.keys(_moodForExport || {}).length} 天)</span></span>
                        </label>
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button id="_exp_cancel" style="flex:1;padding:11px;border:1px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
                        <button id="_exp_confirm" style="flex:2;padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:7px;">
                            <i class="fas fa-download"></i>确认导出
                        </button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            function closeDialog() { overlay.remove(); }
            overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
            const _expCancelBtn = document.getElementById('_exp_cancel');
            const _expConfirmBtn = document.getElementById('_exp_confirm');
            if (_expCancelBtn) _expCancelBtn.onclick = closeDialog;

            if (_expConfirmBtn) _expConfirmBtn.onclick = function() {
                const inclMsgs     = !!document.getElementById('_exp_msgs')?.checked;
                const inclSettings = !!document.getElementById('_exp_settings')?.checked;
                const inclReplies  = !!document.getElementById('_exp_replies')?.checked;
                const inclAnn      = !!document.getElementById('_exp_ann')?.checked;
                const inclThemes   = !!document.getElementById('_exp_themes')?.checked;
                const inclDiary    = !!document.getElementById('_exp_diary')?.checked;
                const inclMood     = !!document.getElementById('_exp_mood')?.checked;

                if (!inclMsgs && !inclSettings && !inclReplies && !inclAnn && !inclThemes && !inclDiary && !inclMood) {
                    showNotification('请至少选择一项导出内容', 'error');
                    return;
                }
                closeDialog();

                try {
                    let dgCustomData = null, dgStatusPool = null, customWeatherMap = {};
                    if (inclSettings) {
                        try { dgCustomData = JSON.parse(localStorage.getItem('dg_custom_data') || 'null'); } catch(e2) {}
                        try { dgStatusPool = JSON.parse(localStorage.getItem('dg_status_pool') || 'null'); } catch(e2) {}
                        try {
                            Object.keys(localStorage).forEach(kk => {
                                if (kk && kk.startsWith('customWeather_')) {
                                    customWeatherMap[kk] = localStorage.getItem(kk);
                                }
                            });
                        } catch(e2) {}
                    }

                    const exportObj = {
                        version: '3.1',
                        appName: 'ChatApp',
                        exportDate: new Date().toISOString(),
                        exportModules: []
                    };
                    if (inclMsgs)     {
                        // 永远省略图片字段，只导出文字等基础信息，减小体积
                        exportObj.messages = messages.map(m => {
                            const { image, ...rest } = m;
                            return rest;
                        });
                        exportObj.exportModules.push('messages');
                    }
                    if (inclSettings) {
                        exportObj.settings = settings;
                        exportObj.exportModules.push('settings');
                        exportObj.dgCustomData = dgCustomData;
                        exportObj.dgStatusPool = dgStatusPool;
                        exportObj.customWeatherMap = customWeatherMap;
                    }
                    if (inclReplies)  {
                        exportObj.customReplies = customReplies;
                        if (customEmojis && customEmojis.length > 0) exportObj.customEmojis = customEmojis;
                        if (customPokes && customPokes.length > 0) exportObj.customPokes = customPokes;
                        if (customStatuses && customStatuses.length > 0) exportObj.customStatuses = customStatuses;
                        if (customMottos && customMottos.length > 0) exportObj.customMottos = customMottos;
                        if (customIntros && customIntros.length > 0) exportObj.customIntros = customIntros;
                        if (customPeriodCare && customPeriodCare.length > 0) exportObj.customPeriodCare = customPeriodCare;
                        if (window.customReplyGroups && window.customReplyGroups.length > 0) exportObj.customReplyGroups = window.customReplyGroups;
                        if (window.customPokeGroups && window.customPokeGroups.length > 0) exportObj.customPokeGroups = window.customPokeGroups;
                        if (window.customStatusGroups && window.customStatusGroups.length > 0) exportObj.customStatusGroups = window.customStatusGroups;
                        exportObj.exportModules.push('customReplies');
                    }
                    if (inclAnn)      { exportObj.anniversaries = anniversaries; exportObj.exportModules.push('anniversaries'); }
                    if (inclThemes)   {
                        exportObj.customThemes = customThemes;
                        exportObj.exportModules.push('themes');
                    }
                    if (inclDiary) {
                        exportObj.companionDiary = _diaryForExport;
                        exportObj.exportModules.push('companionDiary');
                    }
                    if (inclMood && _moodForExport && Object.keys(_moodForExport).length > 0) {
                        exportObj.moodCalendar = _moodForExport;
                        if (_customMoodOptionsForExport.length > 0) exportObj.customMoodOptions = _customMoodOptionsForExport;
                        exportObj.exportModules.push('moodCalendar');
                    }

                    const dataStr = JSON.stringify(exportObj, null, 2);
                    const parts = exportObj.exportModules.join('+');
                    const fileName = `chat-export-${parts}-${new Date().toISOString().slice(0,10)}.json`;

                    if (navigator.share && /Mobile|Android|iPhone|iPad/.test(navigator.userAgent)) {
                        const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
                        const file = new File([blob], fileName, { type: 'application/json' });
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            navigator.share({ files: [file], title: '苹果日记数据导出', text: `导出日期：${new Date().toLocaleDateString()}` })
                                .catch(() => fallbackExport(dataStr, fileName));
                            return;
                        }
                    }
                    fallbackExport(dataStr, fileName);
                } catch (error) {
                    console.error('导出失败:', error);
                    showNotification('导出失败，请重试', 'error');
                }
            };
        }

        function fallbackExport(dataStr, fileName) {
            fileName = fileName || `chat-backup-${SESSION_ID}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
            const dataBlob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            showNotification('导出成功', 'success');
        }

        function importChatHistory(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    let rawText = e.target.result;
                    if (rawText.charCodeAt(0) === 0xFEFF) rawText = rawText.slice(1);
                    let importedData = JSON.parse(rawText);

                    // 兼容全量备份格式（type:'full' 或含 indexedDB/localforage 字段）
                    // 将其转换为 importChatHistory 能识别的标准字段
                    if (importedData && typeof importedData === 'object' &&
                        (importedData.type === 'full' || importedData.indexedDB || importedData.localforage) &&
                        !importedData.messages && !importedData.settings) {

                        const idb = importedData.indexedDB || importedData.localforage || {};
                        const ls  = importedData.localStorage || {};
                        const allKv = Object.assign({}, idb, ls);

                        // 找到 sessionId（取第一个带 _chatMessages 的键前缀）
                        let detectedSid = null;
                        const appPfx = importedData.appPrefix || 'CHAT_APP_V3_';
                        for (const k of Object.keys(allKv)) {
                            if (k.indexOf('_chatMessages') !== -1 && k.startsWith(appPfx)) {
                                const after = k.slice(appPfx.length);
                                const u = after.indexOf('_');
                                if (u > 0) { detectedSid = after.slice(0, u); break; }
                            }
                        }

                        const pfxSid = detectedSid ? (appPfx + detectedSid + '_') : null;
                        const getVal = (suffix) => {
                            if (pfxSid) {
                                const v = allKv[pfxSid + suffix];
                                if (v !== undefined && v !== null) return v;
                            }
                            // 无前缀回退
                            return allKv[suffix] !== undefined ? allKv[suffix] : null;
                        };
                        const parseVal = (v) => {
                            if (v === null || v === undefined) return null;
                            if (typeof v !== 'string') return v;
                            try { return JSON.parse(v); } catch(e2) { return v; }
                        };

                        const converted = {
                            version: importedData.version || '3.1',
                            appName:  importedData.appName || 'ChatApp',
                            exportDate: importedData.exportDate || importedData.timestamp || new Date().toISOString(),
                            exportModules: []
                        };

                        const msgs = parseVal(getVal('chatMessages'));
                        if (Array.isArray(msgs)) { converted.messages = msgs; converted.exportModules.push('messages'); }

                        const chatSettings = parseVal(getVal('chatSettings'));
                        if (chatSettings && typeof chatSettings === 'object') {
                            converted.settings = chatSettings;
                            converted.exportModules.push('settings');
                        }
                        // 额外的 localStorage 设置字段
                        const dgCustomData = parseVal(ls['dg_custom_data'] !== undefined ? ls['dg_custom_data'] : null);
                        if (dgCustomData) converted.dgCustomData = dgCustomData;
                        const dgStatusPool = parseVal(ls['dg_status_pool'] !== undefined ? ls['dg_status_pool'] : null);
                        if (dgStatusPool) converted.dgStatusPool = dgStatusPool;
                        const customWeatherMap = {};
                        for (const wk of Object.keys(ls)) {
                            if (wk && wk.startsWith('customWeather_')) customWeatherMap[wk] = ls[wk];
                        }
                        if (Object.keys(customWeatherMap).length) converted.customWeatherMap = customWeatherMap;

                        const replies = parseVal(getVal('customReplies'));
                        if (Array.isArray(replies)) { converted.customReplies = replies; converted.exportModules.push('customReplies'); }

                        const emojis = parseVal(getVal('customEmojis'));
                        if (Array.isArray(emojis)) converted.customEmojis = emojis;

                        const ann = parseVal(getVal('anniversaries'));
                        if (Array.isArray(ann)) { converted.anniversaries = ann; converted.exportModules.push('anniversaries'); }

                        const themes = parseVal(allKv[appPfx + 'customThemes'] !== undefined ? allKv[appPfx + 'customThemes'] : (ls[appPfx + 'customThemes'] || null));
                        if (themes) { converted.customThemes = themes; converted.exportModules.push('themes'); }

                        importedData = converted;
                    }

                    const hasMessages  = importedData.messages && Array.isArray(importedData.messages);
                    const hasSettings  = !!importedData.settings;
                    const hasReplies   = importedData.customReplies && Array.isArray(importedData.customReplies);
                    const hasAnn       = importedData.anniversaries && Array.isArray(importedData.anniversaries);
                    const hasThemes    = !!importedData.customThemes || !!importedData.stickerLibrary;
                    const hasDiary     = importedData.companionDiary && Array.isArray(importedData.companionDiary);
                    const hasMood      = !!importedData.moodCalendar && typeof importedData.moodCalendar === 'object';

                    if (!hasMessages && !hasSettings && !hasReplies && !hasAnn && !hasThemes && !hasDiary && !hasMood) {
                        throw new Error('无效的聊天记录文件（未检测到可识别的数据模块）');
                    }

                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

                    const makeRow = (id, icon, label, sublabel, available, checked) => {
                        if (!available) return '';
                        return `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);">
                            <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="${icon}" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>${label}${sublabel ? `<span style="font-size:11px;color:var(--text-secondary);margin-left:4px;">${sublabel}</span>` : ''}</span>
                        </label>`;
                    };

                    overlay.innerHTML = `
                        <div style="background:var(--secondary-bg);border-radius:20px;padding:24px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:modalContentSlideIn 0.3s ease forwards;">
                            <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-file-import" style="color:var(--accent-color);font-size:14px;"></i>选择导入内容
                            </div>
                            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">文件中检测到以下数据，选择要导入的模块</div>
                            <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:20px;">
                                ${makeRow('_imp_msgs', 'fas fa-comments', '聊天记录', hasMessages ? `(${importedData.messages.length} 条)` : '', hasMessages, true)}
                                ${makeRow('_imp_settings', 'fas fa-sliders-h', '外观与聊天设置', '', hasSettings, true)}
                                ${makeRow('_imp_replies', 'fas fa-reply', '字卡回复库', '', hasReplies, false)}
                                ${makeRow('_imp_ann', 'fas fa-calendar-heart', '纪念日 / 倒计时', '', hasAnn, false)}
                                ${makeRow('_imp_themes', 'fas fa-palette', '自定义主题配色', '', hasThemes, false)}
                                ${makeRow('_imp_diary', 'fas fa-book-open', '陪伴日记', hasDiary ? `(${importedData.companionDiary.length} 条)` : '', hasDiary, false)}
                                ${makeRow('_imp_mood', 'fas fa-face-smile', '心情手账', hasMood ? `(${Object.keys(importedData.moodCalendar).length} 天)` : '', hasMood, false)}
                            </div>
                            <div style="display:flex;gap:10px;">
                                <button id="_imp_cancel" style="flex:1;padding:11px;border:1px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
                                <button id="_imp_confirm" style="flex:2;padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:7px;">
                                    <i class="fas fa-upload"></i>确认导入
                                </button>
                            </div>
                        </div>`;
                    document.body.appendChild(overlay);

                    function closeDialog() { overlay.remove(); }
                    overlay.addEventListener('click', ev => { if (ev.target === overlay) closeDialog(); });
                    const _impCancelBtn = document.getElementById('_imp_cancel');
                    const _impConfirmBtn = document.getElementById('_imp_confirm');
                    if (_impCancelBtn) _impCancelBtn.onclick = closeDialog;

                    if (_impConfirmBtn) _impConfirmBtn.onclick = function() {
                        const doMsgs     = hasMessages  && !!document.getElementById('_imp_msgs')?.checked;
                        const doSettings = hasSettings  && !!document.getElementById('_imp_settings')?.checked;
                        const doReplies  = hasReplies   && !!document.getElementById('_imp_replies')?.checked;
                        const doAnn      = hasAnn       && !!document.getElementById('_imp_ann')?.checked;
                        const doThemes   = hasThemes    && !!document.getElementById('_imp_themes')?.checked;
                        const doDiary    = hasDiary     && !!document.getElementById('_imp_diary')?.checked;
                        const doMood     = hasMood      && !!document.getElementById('_imp_mood')?.checked;

                        if (!doMsgs && !doSettings && !doReplies && !doAnn && !doThemes && !doDiary && !doMood) {
                            showNotification('请至少选择一项导入内容', 'error');
                            return;
                        }

                        if (doMsgs && messages.length > 0 && !confirm('导入将覆盖当前会话的聊天记录，确定继续吗？')) return;
                        closeDialog();

                        if (doMsgs) {
                            messages = importedData.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
                        }
                        if (doSettings) {
                            if (importedData.settings) {
                                Object.assign(settings, importedData.settings);
                                try {
                                    if (settings.customFontUrl) applyCustomFont(settings.customFontUrl);
                                    if (settings.customBubbleCss) applyCustomBubbleCss(settings.customBubbleCss);
                                    if (settings.customGlobalCss) applyGlobalThemeCss(settings.customGlobalCss);
                                } catch(e2) { console.warn('导入后样式应用失败', e2); }
                            }
                            if (importedData.dgCustomData) { try { localStorage.setItem('dg_custom_data', JSON.stringify(importedData.dgCustomData)); } catch(e2) {} }
                            if (importedData.dgStatusPool) { try { localStorage.setItem('dg_status_pool', JSON.stringify(importedData.dgStatusPool)); } catch(e2) {} }
                            if (importedData.customWeatherMap) { try { Object.keys(importedData.customWeatherMap).forEach(wk => localStorage.setItem(wk, importedData.customWeatherMap[wk])); } catch(e2) {} }
                        }
                        if (doReplies  && importedData.customReplies)  customReplies  = importedData.customReplies;
                        if (doReplies  && importedData.customEmojis && Array.isArray(importedData.customEmojis)) customEmojis = importedData.customEmojis;
                        if (doReplies  && importedData.customPokes && Array.isArray(importedData.customPokes)) customPokes = importedData.customPokes;
                        if (doReplies  && importedData.customStatuses && Array.isArray(importedData.customStatuses)) customStatuses = importedData.customStatuses;
                        if (doReplies  && importedData.customMottos && Array.isArray(importedData.customMottos)) customMottos = importedData.customMottos;
                        if (doReplies  && importedData.customPeriodCare && Array.isArray(importedData.customPeriodCare)) customPeriodCare = importedData.customPeriodCare;
                        if (doReplies  && importedData.customIntros && Array.isArray(importedData.customIntros)) customIntros = importedData.customIntros;
                        if (doReplies  && importedData.customReplyGroups) window.customReplyGroups = importedData.customReplyGroups;
                        if (doReplies  && importedData.customPokeGroups) window.customPokeGroups = importedData.customPokeGroups;
                        if (doReplies  && importedData.customStatusGroups) window.customStatusGroups = importedData.customStatusGroups;
                        if (doAnn      && importedData.anniversaries)   anniversaries  = importedData.anniversaries;
                        if (doThemes   && importedData.customThemes)    customThemes   = importedData.customThemes;
                        if (doThemes   && importedData.stickerLibrary)  stickerLibrary = importedData.stickerLibrary;
                        if (doDiary    && importedData.companionDiary && typeof window._setCompanionDiaryEntries === 'function') {
                            window._setCompanionDiaryEntries(importedData.companionDiary);
                        }
                        if (doMood && importedData.moodCalendar && typeof window._setMoodData === 'function') {
                            window._setMoodData(importedData.moodCalendar, importedData.customMoodOptions || []);
                        }

                        saveData();
                        if (doMsgs && typeof renderMessages === 'function') renderMessages();
                        if (typeof applySettings === 'function') applySettings();
                        updateUI();
                        const count = doMsgs ? `${messages.length} 条消息` : '所选数据';
                        showNotification(`成功导入${count}`, 'success');
                    };
                } catch (error) {
                    console.error('导入失败:', error);
                    showNotification('文件格式错误或已损坏', 'error');
                }
            };
            reader.onerror = () => showNotification('文件读取失败', 'error');
            reader.readAsText(file);
        }

        // ── 对方状态更新核心逻辑（提取为独立函数，供定时触发和 /测试状态更新 指令共用）──
        window._triggerStatusChange = function() {
            let newStatus = null;

            const groups = window.customStatusGroups || [];
            const allStatuses = (typeof customStatuses !== 'undefined' ? customStatuses : []) || [];

            // 只保留「启用」且「有内容」的分组，内容必须也在 allStatuses 里存在
            const enabledGroups = groups.filter(function(g) {
                return !g.disabled && Array.isArray(g.items) && g.items.length > 0;
            });

            // 收集所有在分组内的状态文本
            const groupedItems = new Set();
            enabledGroups.forEach(function(g) { g.items.forEach(function(t) { groupedItems.add(t); }); });

            // 未分组的状态
            const ungroupedStatuses = allStatuses.filter(function(t) { return !groupedItems.has(t); });

            if (enabledGroups.length > 0) {
                // 有启用分组时：随机选一个分组 → 从该分组随机选一条状态
                const pickedGroup = enabledGroups[Math.floor(Math.random() * enabledGroups.length)];
                const groupPool = pickedGroup.items.filter(function(t) { return allStatuses.includes(t); });
                if (groupPool.length > 0) {
                    newStatus = groupPool[Math.floor(Math.random() * groupPool.length)];
                }
            }

            // 分组里没找到内容时，退回到：未分组状态 → 全部 customStatuses → 内置 PARTNER_STATUSES
            if (!newStatus && ungroupedStatuses.length > 0) {
                newStatus = ungroupedStatuses[Math.floor(Math.random() * ungroupedStatuses.length)];
            }
            if (!newStatus && allStatuses.length > 0) {
                newStatus = allStatuses[Math.floor(Math.random() * allStatuses.length)];
            }
            if (!newStatus && CONSTANTS.PARTNER_STATUSES && CONSTANTS.PARTNER_STATUSES.length > 0) {
                newStatus = getRandomItem(CONSTANTS.PARTNER_STATUSES);
            }
            if (!newStatus) {
                // 静默跳过（不再 toast 提示用户）
                return;
            }

            settings.partnerStatus = newStatus;
            settings.lastStatusChange = Date.now();
            settings.nextStatusChange = 1 + Math.random() * 7;
            DOMElements.partner.status.textContent = newStatus;
            throttledSaveData();
        };

        const checkStatusChange = () => {
            if ((Date.now() - settings.lastStatusChange) / 36e5 >= settings.nextStatusChange) {
                window._triggerStatusChange();
            }
        };



        function getStorageKey(baseKey) {
            if (!SESSION_ID) {
                console.error('[getStorageKey] SESSION_ID 尚未初始化，拒绝生成存储键:', baseKey);
                throw new Error('SESSION_ID 未初始化，存储操作已中止');
            }
            return `${APP_PREFIX}${SESSION_ID}_${baseKey}`;
        }

        // 阶段四：收藏语音键名（带 SESSION_ID 前缀，按梦角隔离）
        function favAudioKey(messageId) {
            return getStorageKey(`favAudio_${messageId}`);
        }
        window.favAudioKey = favAudioKey;

        async function migrateData() {
            const isMigrated = await localforage.getItem(APP_PREFIX + 'MIGRATION_V2_DONE');
            if (isMigrated) return;

            try {
                const keys = Object.keys(localStorage);
                for (const key of keys) {
                    if (key.startsWith(APP_PREFIX)) {
                        try {
                            const val = localStorage.getItem(key);
                            if (val) {
                                let dataToStore = val;
                                try {
                                    if (val.startsWith('{') || val.startsWith('[')) {
                                        dataToStore = JSON.parse(val);
                                    }
                                } catch (e) {
                                    console.warn(`迁移期间解析数据失败: ${key}，将作为原始字符串存储。`, e);
                                }
                                await localforage.setItem(key, dataToStore);
                            }
                        } catch (e) {
                            console.error(`迁移键值 ${key} 时发生错误，已跳过。`, e);
                        }
                    }
                }
                
                await localforage.setItem(APP_PREFIX + 'MIGRATION_V2_DONE', 'true');
            } catch (e) {
                console.error("数据迁移过程中发生严重错误:", e);
                showNotification('数据迁移失败，部分旧数据可能丢失', 'error');
            }
        }

window.initializeSession = async function() {
    await migrateData();

    const sessionsData = await localforage.getItem(`${APP_PREFIX}sessionList`);
    sessionList = sessionsData || [];

    const hash = window.location.hash.substring(1);
    if (hash && sessionList.some(s => s.id === hash)) {
        SESSION_ID = hash;
    } else if (sessionList.length > 0) {
        const lastId = await localforage.getItem(`${APP_PREFIX}lastSessionId`);
        SESSION_ID = lastId && sessionList.some(s => s.id === lastId) ? lastId : sessionList[0].id;
    } else {
        SESSION_ID = await createNewSession(false);
    }

    await localforage.setItem(`${APP_PREFIX}lastSessionId`, SESSION_ID);
}

// 监听系统昼夜变化，实时更新 data-theme
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // 夏日白昼开启时由主题自己控制明暗，系统变化不覆盖
    if (document.documentElement.getAttribute('data-skin') === 'summer') return;
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
});

// 注：往上/往下翻页加载更多消息的触发，只靠 listeners.js 里那个绑定在真正可滚动容器（chat-container）
// 上的 scroll 事件监听（检查 scrollTop 实际位置）。这里原本还有一套用 IntersectionObserver 做的重复监听，
// 但它绑定的参照容器（.main-chat-area）本身并不会滚动，导致这套监听只要"加载提示条一显示出来"就会误触发，
// 跟用户有没有真的滑动到顶部/底部没有关系，会引发连环自动加载、把用户拽到意料之外的位置。已确认删除，不会影响功能。
