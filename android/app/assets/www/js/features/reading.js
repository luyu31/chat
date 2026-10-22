/**
 * reading.js — 一起读书（情侣空间 · 电影院 tab 内的子页，与观影并列）
 * 自己上传 txt / 粘贴文本存进书架，App 内阅读器看书；
 * 梦角同步维护自己的"阅读进度"，各环节要说的话全部走 SceneLines：
 * 自定义台词 > 字卡库随机 > 不说话，绝不内置默认文案（防 OOC）。
 *
 * 入口：电影院 tab 顶部子tab「一起读书」→ window._readingInit()
 */
(function () {
    'use strict';

    var BOOKS_KEY = 'reading_books_v1';       // localforage：[{id,title,chapters[],addedAt}]
    var PROG_KEY  = 'reading_progress_v1';    // {bookId:{me:{ch,ratio}, his:number%, fontSize, readSec, lastAt}}
    var POLL_MS   = 30000;                    // 阅读计时心跳

    var _books = null;          // 书列表（含全文）
    var _prog = null;           // 进度表
    var _cur = null;            // 当前打开的书对象
    var _curCh = 0;             // 当前章
    var _readTick = null;       // 计时器
    var _readStart = 0;         // 本次打开时间戳
    var _readSeconds = 0;       // 本次阅读秒数
    var _lastPartnerPing = 0;   // 上次他搭话时间
    var _bannerTimer = null;

    // ─── 工具 ───
    function lfGet(k, fb) {
        try {
            return localforage.getItem(k).then(function (v) { return v || fb; });
        } catch (e) { return Promise.resolve(fb); }
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function partnerName() {
        try { return (typeof settings !== 'undefined' && settings.partnerName) || '对方'; } catch (e) { return '对方'; }
    }

    function partnerSay(text) {
        if (!text) return;
        try {
            if (typeof addMessage === 'function') {
                addMessage({
                    id: Date.now() + Math.random(),
                    sender: 'partner',
                    text: text,
                    timestamp: new Date(),
                    status: 'received',
                    favorited: false,
                    note: null,
                    replyTo: null,
                    type: 'normal'
                });
            }
            if (typeof playSound === 'function') playSound('message');
        } catch (e) {}
        _showReadBanner(text);
    }

    // 阅读页顶部小横幅：他在你读书时说的话，几秒后消失
    function _showReadBanner(text) {
        var el = document.getElementById('reading-banner');
        if (!el || !_cur) return;
        el.textContent = partnerName() + '：' + text;
        el.classList.add('visible');
        clearTimeout(_bannerTimer);
        _bannerTimer = setTimeout(function () { el.classList.remove('visible'); }, 5000);
    }

    // 场景台词：自定义（支持占位符）> 字卡库随机 > null（不说）
    function pickLine(slot, ctx) {
        return window.SceneLines ? SceneLines.pick('reading', slot, ctx) : null;
    }

    // ─── 数据 ───
    function loadAll() {
        return Promise.all([
            lfGet(BOOKS_KEY, []),
            lfGet(PROG_KEY, {})
        ]).then(function (r) {
            _books = r[0] || [];
            _prog = r[1] || {};
            return true;
        });
    }
    function saveBooks() { try { localforage.setItem(BOOKS_KEY, _books); } catch (e) {} }
    function saveProg() { try { localforage.setItem(PROG_KEY, _prog); } catch (e) {} }

    function getProg(bookId) {
        if (!_prog[bookId]) {
            _prog[bookId] = { me: { ch: 0, ratio: 0 }, his: 0, fontSize: 17, readSec: 0, lastAt: 0 };
        }
        var p = _prog[bookId];
        if (!p.me) p.me = { ch: 0, ratio: 0 };
        if (typeof p.his !== 'number') p.his = 0;
        if (!p.fontSize) p.fontSize = 17;
        if (typeof p.readSec !== 'number') p.readSec = 0;
        return p;
    }

    // 我的全书百分比
    function myPercent(book) {
        var p = getProg(book.id);
        var total = book.chapters.length || 1;
        var v = ((p.me.ch + p.me.ratio) / total) * 100;
        return Math.max(0, Math.min(100, Math.round(v)));
    }

    // ─── 文本 → 章节 ───
    var CH_RE = /^\s*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷幕]|序章|楔子|尾声|后记|Chapter\s*\d+|CHAPTER\s*\d+)/i;

    function splitChapters(raw) {
        var lines = raw.split(/\r?\n/);
        var chapters = [];
        var cur = null;
        var bufLen = 0;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (CH_RE.test(line) && line.trim().length <= 40) {
                if (cur && cur.text.length) chapters.push(cur);
                cur = { title: line.trim(), text: '' };
                bufLen = 0;
            } else {
                if (!cur) cur = { title: '开篇', text: '' };
                cur.text += line + '\n';
                bufLen += line.length;
            }
            // 无章节标记的书：攒太长就切一段（有"第X章"这类标题的书不硬切）
            if (cur && cur.text.length > 20000 && !CH_RE.test(cur.title)) {
                chapters.push(cur);
                cur = { title: '（续）', text: '' };
                bufLen = 0;
            }
        }
        if (cur && cur.text.trim()) chapters.push(cur);

        if (!chapters.length) chapters = [{ title: '正文', text: raw }];
        // 过滤空章节
        chapters = chapters.filter(function (c) { return c.text.trim().length > 0; });
        return chapters;
    }

    // 读取 txt 文件：先按 UTF-8 读，出现大量乱码替换符就用 GBK 重解码
    function readTextFile(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () {
                var text = String(fr.result || '');
                var bad = (text.match(/\uFFFD/g) || []).length;
                if (bad > text.length * 0.001 && typeof TextDecoder !== 'undefined') {
                    // 很可能是 GBK/GB18030 编码的书
                    var fr2 = new FileReader();
                    fr2.onload = function () {
                        try {
                            resolve(new TextDecoder('gb18030').decode(new Uint8Array(fr2.result)));
                        } catch (e) { resolve(text); }
                    };
                    fr2.onerror = function () { resolve(text); };
                    fr2.readAsArrayBuffer(file);
                } else {
                    resolve(text);
                }
            };
            fr.onerror = function () { reject(new Error('读取文件失败')); };
            fr.readAsText(file, 'utf-8');
        });
    }

    // ─── 空间面板（书架，挂在电影院 tab 的子视图容器里）────
    function _getPanel() { return document.getElementById('cinema-view-reading'); }

    function _init() {
        loadAll().then(function () { _renderShelf(); });
    }
    window._readingInit = function () { _init(); };

    function _linesEditor() {
        if (!window.SceneLines) return;
        SceneLines.openEditor({
            title: '读书台词',
            slots: [
                { scene: 'reading', slot: 'start',  label: '翻开书（你开始看时）',   hint: '可用 {title} 代替书名', ph: '留空则随机用字卡库' },
                { scene: 'reading', slot: 'mid',    label: '读着读着（中途搭话）',   ph: '留空则随机用字卡库' },
                { scene: 'reading', slot: 'end',    label: '合上书（退出阅读时）',   hint: '可用 {title}/{min}/{pct}/{his}（书名/分钟/我的进度/他的进度）', ph: '留空则随机用字卡库' },
                { scene: 'reading', slot: 'finish', label: '读完整本（读后感）',     hint: '可用 {title} 代替书名', ph: '留空则随机用字卡库' }
            ]
        });
    }

    function _renderShelf() {
        var panel = _getPanel();
        if (!panel) return;

        var rows = '';
        if (_books.length) {
            rows = _books.map(function (b) {
                var p = getProg(b.id);
                var meP = myPercent(b);
                var hisP = Math.round(p.his);
                return '<div class="rd-row" data-id="' + b.id + '">' +
                        '<div class="rd-row-info">' +
                            '<div class="rd-row-title">《' + esc(b.title) + '》</div>' +
                            '<div class="rd-row-sub">我 ' + meP + '% · ' + esc(partnerName()) + ' ' + hisP + '% · ' + b.chapters.length + '章</div>' +
                            '<div class="rd-bar"><div class="rd-bar-in" style="width:' + meP + '%;"></div></div>' +
                        '</div>' +
                        '<button class="rd-row-del" data-del="' + b.id + '" title="删除"><i class="fas fa-times"></i></button>' +
                    '</div>';
            }).join('');
        } else {
            rows = '<div class="rd-empty"><i class="fas fa-book-open"></i><div>书架还空着<br>上传一本 txt，两个人一起看吧</div></div>';
        }

        panel.innerHTML =
            '<div class="rd-hd">' +
                '<span class="rd-hd-title">一起读书</span>' +
                '<button class="cs-icon-btn" id="rd-lines-btn" title="他说什么（读书台词）"><i class="fas fa-comment-dots"></i></button>' +
            '</div>' +
            '<div class="rd-list">' + rows + '</div>' +
            '<div class="rd-actions">' +
                '<button class="rd-add" id="rd-add-file"><i class="fas fa-file-upload"></i> 上传txt</button>' +
                '<button class="rd-add" id="rd-add-paste"><i class="fas fa-paste"></i> 粘贴文本</button>' +
            '</div>' +
            '<div class="rd-tip">微信读书等App没有开放接口，暂时接不了；把书放进来自建书架，' +
            '他也会看同一本，各自有进度。他说的每句话都从你的字卡库或自定义台词里来。</div>';

        panel.querySelector('#rd-lines-btn').addEventListener('click', _linesEditor);

        panel.querySelector('#rd-add-file').addEventListener('click', function () {
            var inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.txt,text/plain';
            inp.onchange = function () {
                var f = inp.files && inp.files[0];
                if (!f) return;
                readTextFile(f).then(function (text) {
                    _addBook(f.name.replace(/\.txt$/i, ''), text);
                }).catch(function () {
                    if (typeof showNotification === 'function') showNotification('读取文件失败了', 'error', 2500);
                });
            };
            inp.click();
        });
        panel.querySelector('#rd-add-paste').addEventListener('click', function () {
            var title = prompt('这本书叫什么名字？');
            if (title === null) return;
            var text = prompt('把书的文字粘贴进来（太长的书建议分几次粘，或直接用上传txt）：');
            if (!text || !text.trim()) return;
            _addBook((title && title.trim()) || '未命名', text);
        });

        panel.querySelectorAll('.rd-row-info').forEach(function (el) {
            el.addEventListener('click', function () {
                var id = el.closest('.rd-row').getAttribute('data-id');
                _openBook(id);
            });
        });
        panel.querySelectorAll('.rd-row-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-del');
                var b = _books.find(function (x) { return x.id === id; });
                if (!b) return;
                if (!confirm('删除《' + b.title + '》？（阅读进度也会一起删掉）')) return;
                _books = _books.filter(function (x) { return x.id !== id; });
                delete _prog[id];
                saveBooks(); saveProg();
                _renderShelf();
            });
        });
    }

    function _addBook(title, text) {
        if (!text || text.trim().length < 50) {
            if (typeof showNotification === 'function') showNotification('内容太短啦，至少要有一段正文', 'error', 2500);
            return;
        }
        var book = {
            id: 'b_' + Date.now(),
            title: title || '未命名',
            chapters: splitChapters(text),
            addedAt: Date.now()
        };
        _books.unshift(book);
        getProg(book.id);
        saveBooks(); saveProg();
        _renderShelf();
        if (typeof showNotification === 'function')
            showNotification('《' + book.title + '》已加入书架（' + book.chapters.length + ' 章）', 'success', 2500);
    }

    // ─── 阅读页（全屏覆盖层，独立于面板）─────────────────
    function _openBook(bookId) {
        var b = _books.find(function (x) { return x.id === bookId; });
        if (!b) return;
        var p = getProg(b.id);
        _cur = b;
        _curCh = Math.min(p.me.ch || 0, b.chapters.length - 1);
        _readStart = Date.now();
        _readSeconds = 0;
        _lastPartnerPing = Date.now();

        _buildReader();
        _renderChapter(true);

        // 他也"翻开"这本书：进度推进一点，说一句开场台词（自定义>字卡库>不说）
        if (p.his < 100) {
            p.his = Math.min(96, p.his + 4 + Math.random() * 9);
            p.lastAt = Date.now();
            saveProg();
        }
        var line = pickLine('start', { title: b.title });
        if (line) setTimeout(function () { partnerSay(line); }, 900 + Math.random() * 2000);

        // 阅读计时：每 30s 累计 + 偶尔搭话（每 8~15 分钟一次，概率触发，台词走字卡库）
        clearInterval(_readTick);
        _readTick = setInterval(function () {
            if (document.hidden || !_cur) return;
            _readSeconds += POLL_MS / 1000;
            var mins = (Date.now() - _lastPartnerPing) / 60000;
            if (mins > 8 + Math.random() * 7 && Math.random() < 0.5) {
                _lastPartnerPing = Date.now();
                var mid = pickLine('mid', { title: _cur.title });
                if (mid) partnerSay(mid);
            }
        }, POLL_MS);
    }

    // ─── 样式注入（一次）────────────────────────────────
    function _injectCss() {
        if (document.getElementById('reading-css')) return;
        var css = document.createElement('style');
        css.id = 'reading-css';
        css.textContent =
            '#reading-banner{position:absolute;top:52px;left:50%;transform:translate(-50%,-12px);z-index:5;max-width:86%;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:16px;background:rgba(0,0,0,.72);color:#fff;font-size:11.5px;line-height:1.5;opacity:0;pointer-events:none;transition:.3s;}' +
            '#reading-banner.visible{opacity:1;transform:translate(-50%,0);}' +
            '#reading-banner i{flex-shrink:0;opacity:.8;}' +
            '.rd-nav{border:none;border-radius:16px;padding:6px 10px;font-size:11.5px;cursor:pointer;background:var(--secondary-bg,#f0f0f0);color:var(--text-primary,#333);display:flex;align-items:center;gap:4px;font-family:inherit;flex-shrink:0;}' +
            '.rd-nav:active{opacity:.7;}' +
            '.rd-para{margin:0 0 1em;font-size:var(--rd-fs,17px);line-height:1.9;color:var(--text-primary,#333);text-indent:2em;letter-spacing:.2px;white-space:pre-wrap;word-break:break-word;}' +
            '.rd-ch-title{font-size:18px;font-weight:700;color:var(--text-primary,#333);margin:0 0 18px;text-align:center;letter-spacing:1px;}' +
            '.rd-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-color,#e8e8e8);flex-shrink:0;}' +
            '.rd-hd-title{font-size:15px;font-weight:800;color:var(--text-primary,#333);letter-spacing:1px;}' +
            '.rd-list{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;}' +
            '.rd-row{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:12px;border:1px solid var(--border-color,#e8e8e8);background:var(--primary-bg,transparent);}' +
            '.rd-row-info{flex:1;min-width:0;cursor:pointer;}' +
            '.rd-row-title{font-size:13px;font-weight:600;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.rd-row-sub{font-size:10.5px;color:var(--text-secondary,#999);margin-top:3px;}' +
            '.rd-bar{height:4px;border-radius:2px;background:var(--secondary-bg,#f0f0f0);margin-top:5px;overflow:hidden;}' +
            '.rd-bar-in{height:100%;background:var(--accent-color,#c5a47e);}' +
            '.rd-row-del{flex-shrink:0;width:24px;height:24px;border:none;border-radius:50%;background:transparent;color:var(--text-secondary,#aaa);font-size:11px;cursor:pointer;}' +
            '.rd-empty{text-align:center;color:var(--text-secondary,#999);font-size:12px;padding:36px 0;line-height:2;}' +
            '.rd-empty i{font-size:28px;opacity:.5;display:block;margin-bottom:6px;}' +
            '.rd-actions{display:flex;gap:8px;padding:10px 16px 0;flex-shrink:0;}' +
            '.rd-add{flex:1;padding:9px 0;border:1px dashed var(--border-color,#ddd);border-radius:12px;font-size:12px;background:transparent;color:var(--text-secondary,#888);cursor:pointer;font-family:inherit;}' +
            '.rd-tip{font-size:11px;color:var(--text-secondary,#999);padding:10px 16px 16px;line-height:1.7;flex-shrink:0;}' +
            '#cinema-view-reading{flex-direction:column;overflow:hidden;}';
        document.head.appendChild(css);
    }
    _injectCss();

    function _buildReader() {
        var old = document.getElementById('reading-reader');
        if (old) old.remove();
        var p = getProg(_cur.id);

        var el = document.createElement('div');
        el.id = 'reading-reader';
        el.style.cssText = 'position:fixed;inset:0;z-index:3400;display:flex;flex-direction:column;background:var(--primary-bg,#f7f4ef);';
        el.innerHTML =
            '<div id="reading-banner"><i class="fas fa-book-reader"></i><span id="reading-banner-text"></span></div>' +
            '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-color,#e8e8e8);flex-shrink:0;">' +
                '<button type="button" id="rd-back" style="border:none;background:transparent;color:var(--text-primary,#333);font-size:16px;cursor:pointer;padding:4px 6px;"><i class="fas fa-chevron-left"></i></button>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div id="rd-title" style="font-size:14px;font-weight:700;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>' +
                    '<div id="rd-ch" style="font-size:10.5px;color:var(--text-secondary,#999);margin-top:1px;"></div>' +
                '</div>' +
                '<span id="rd-pct" style="font-size:11px;color:var(--accent-color,#c5a47e);font-weight:600;flex-shrink:0;"></span>' +
            '</div>' +
            '<div id="rd-body" style="flex:1;overflow-y:auto;padding:18px 20px 40px;"></div>' +
            '<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid var(--border-color,#e8e8e8);flex-shrink:0;">' +
                '<button type="button" class="rd-nav" id="rd-prev"><i class="fas fa-chevron-left"></i> 上一章</button>' +
                '<div style="flex:1;text-align:center;font-size:11px;color:var(--text-secondary,#999);" id="rd-ch-info"></div>' +
                '<button type="button" class="rd-nav" id="rd-next" style="flex-direction:row-reverse;">下一章 <i class="fas fa-chevron-right"></i></button>' +
                '<button type="button" class="rd-nav" id="rd-font" title="字号">A±</button>' +
            '</div>';

        document.body.appendChild(el);

        el.querySelector('#rd-back').addEventListener('click', _closeBook);
        el.querySelector('#rd-prev').addEventListener('click', function () { _gotoChapter(_curCh - 1); });
        el.querySelector('#rd-next').addEventListener('click', function () { _gotoChapter(_curCh + 1); });
        el.querySelector('#rd-font').addEventListener('click', function () {
            var pp = getProg(_cur.id);
            var sizes = [15, 17, 19, 21, 23];
            var idx = sizes.indexOf(pp.fontSize);
            if (idx < 0) idx = 1;
            pp.fontSize = sizes[(idx + 1) % sizes.length];
            saveProg();
            document.getElementById('rd-body').style.setProperty('--rd-fs', pp.fontSize + 'px');
            if (typeof showNotification === 'function') showNotification('字号：' + pp.fontSize, 'info', 1200);
        });

        // 滚动进度保存（停 400ms 记一次）
        var body = el.querySelector('#rd-body');
        var saveTimer = null;
        body.addEventListener('scroll', function () {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(function () { _saveScroll(body); }, 400);
        });
        body.style.setProperty('--rd-fs', p.fontSize + 'px');
    }

    function _saveScroll(body) {
        if (!_cur) return;
        var p = getProg(_cur.id);
        var max = Math.max(1, body.scrollHeight - body.clientHeight);
        var ratio = Math.max(0, Math.min(1, body.scrollTop / max));
        p.me.ch = _curCh;
        p.me.ratio = ratio;
        p.lastAt = Date.now();
        saveProg();
        var pct = document.getElementById('rd-pct');
        if (pct) pct.textContent = myPercent(_cur) + '%';
    }

    function _renderChapter(scrollToSaved) {
        if (!_cur) return;
        var body = document.getElementById('rd-body');
        if (!body) return;
        var ch = _cur.chapters[_curCh];
        var p = getProg(_cur.id);

        document.getElementById('rd-title').textContent = '《' + _cur.title + '》';
        document.getElementById('rd-ch').textContent = ch.title;
        document.getElementById('rd-ch-info').textContent = (_curCh + 1) + ' / ' + _cur.chapters.length;
        document.getElementById('rd-pct').textContent = myPercent(_cur) + '%';

        // 章内按空行分段渲染
        var paras = ch.text.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (!paras.length) paras = [ch.text.trim()];
        var html = '<h2 class="rd-ch-title">' + esc(ch.title) + '</h2>';
        paras.forEach(function (t) { html += '<p class="rd-para">' + esc(t) + '</p>'; });
        body.innerHTML = html;

        if (scrollToSaved && p.me.ch === _curCh) {
            // 恢复上次滚动位置
            requestAnimationFrame(function () {
                var max = Math.max(1, body.scrollHeight - body.clientHeight);
                body.scrollTop = max * (p.me.ratio || 0);
            });
        } else {
            body.scrollTop = 0;
        }
        _saveScroll(body);
    }

    function _gotoChapter(n) {
        if (!_cur) return;
        if (n < 0) n = 0;
        if (n > _cur.chapters.length - 1) {
            // 已经是最后一章
            if (_curCh >= _cur.chapters.length - 1) {
                var p = getProg(_cur.id);
                p.me.ch = _cur.chapters.length - 1; p.me.ratio = 1;
                saveProg();
                _onMeFinish();
                if (typeof showNotification === 'function') showNotification('已经是最后一章啦', 'info', 1500);
            }
            return;
        }
        _curCh = n;
        _renderChapter(false);
    }

    // 我读完整本
    function _onMeFinish() {
        if (!_cur) return;
        var b = _cur, p = getProg(b.id);
        if (p._meDone) return;
        p._meDone = true;
        p.his = 100; // 你都看完了，他也一起看完
        saveProg();
        setTimeout(function () {
            var line = pickLine('finish', { title: b.title });
            if (line) partnerSay(line);
        }, 1200);
    }

    function _closeBook() {
        if (!_cur) return;
        var b = _cur;
        var p = getProg(b.id);
        var body = document.getElementById('rd-body');
        if (body) _saveScroll(body);

        clearInterval(_readTick);
        _readTick = null;

        var mins = Math.round((_readSeconds + (Date.now() - _readStart) / 1000) / 60);
        p.readSec += Math.round((Date.now() - _readStart) / 1000);
        p.lastAt = Date.now();
        var meP = myPercent(b);
        saveProg();

        var el = document.getElementById('reading-reader');
        if (el) el.remove();
        _cur = null;

        // 退出时他说一句（自定义可带 {title}/{min}/{pct}/{his}，否则字卡库随机）
        setTimeout(function () {
            if (meP >= 98 && !p._meDone) { _onMeFinishRaw(b, p); return; }
            var line = pickLine('end', { title: b.title, min: mins, pct: meP, his: Math.round(p.his) });
            if (line) partnerSay(line);
        }, 800);

        // 回书架刷新进度条
        _renderShelf();
    }

    // _closeBook 里读完整本的收尾（不走 _onMeFinish 因为 _cur 已清空）
    function _onMeFinishRaw(b, p) {
        p._meDone = true;
        p.his = 100;
        saveProg();
        setTimeout(function () {
            var line = pickLine('finish', { title: b.title });
            if (line) partnerSay(line);
        }, 1200);
    }

    // ─── 初始化：书数据预热（面板渲染等 csSwitchTab 触发）───
    loadAll();

    window.Reading = { open: function () {
        // 入口在情侣空间 → 电影院 tab → 「一起读书」子页
        if (typeof openCoupleSpace !== 'function') return;
        openCoupleSpace();
        var tries = 0;
        (function go() {
            var page = document.getElementById('couple-space-page');
            if (page && page.classList.contains('cs-open')) {
                if (typeof csSwitchTab === 'function') csSwitchTab('cinema');
                if (typeof window._cinemaSwitchView === 'function') window._cinemaSwitchView('reading');
                setTimeout(function () {
                    var panel = document.getElementById('cs-panel-cinema');
                    if (panel && panel.style.display === 'none' && tries++ < 6) go();
                }, 120);
            } else if (tries++ < 40) {
                setTimeout(go, 80);
            }
        })();
    } };
})();
