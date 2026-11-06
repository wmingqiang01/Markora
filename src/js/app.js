/**
 * Markora Main Application Controller
 * Connects the WYSIWYG Canvas, Source Mode Editor, Sidebar File Tree & Outline,
 * Floating Selection Toolbar, Slash Command Palette, Themes, and Desktop Bridge.
 */

(function (global) {
  'use strict';

  const Bridge = global.MarkoraBridge;
  const Parser = global.MarkoraParser;
  const Renderers = global.MarkoraRenderers;
  const Icons = global.MarkoraIcons;

  const LANGUAGES = [
    'javascript', 'typescript', 'python', 'rust', 'c', 'cpp', 'go',
    'java', 'html', 'css', 'sql', 'bash', 'json', 'swift', 'verilog', 'markdown', 'plaintext'
  ];

  const SLASH_COMMANDS = [
    { id: 'h1', icon: 'H1', title: '一级标题', desc: '# 大标题 (Cmd+1)', action: () => transformActiveBlock('heading', { level: 1 }) },
    { id: 'h2', icon: 'H2', title: '二级标题', desc: '## 章节标题 (Cmd+2)', action: () => transformActiveBlock('heading', { level: 2 }) },
    { id: 'h3', icon: 'H3', title: '三级标题', desc: '### 小节标题 (Cmd+3)', action: () => transformActiveBlock('heading', { level: 3 }) },
    { id: 'ulist', icon: '•', title: '无序列表', desc: '- 项目符号列表', action: () => transformActiveBlock('ulist') },
    { id: 'olist', icon: '1.', title: '有序列表', desc: '1. 编号列表', action: () => transformActiveBlock('olist') },
    { id: 'task', icon: '☑', title: '任务列表', desc: '- [ ] 待办事项清单', action: () => transformActiveBlock('tasklist') },
    { id: 'quote', icon: '❝', title: '引用块', desc: '> 引用文字段落', action: () => transformActiveBlock('blockquote') },
    { id: 'callout', icon: '!', title: '提示高亮框 (Callout)', desc: '> [!NOTE] 醒目提示块', action: () => transformActiveBlock('callout', { calloutType: 'NOTE' }) },
    { id: 'code', icon: '</>', title: '代码块', desc: '``` 语法高亮代码块', action: () => transformActiveBlock('code', { lang: 'javascript', code: '// 在此输入代码\n' }) },
    { id: 'math', icon: '∑', title: '数学公式块 (LaTeX)', desc: '$$ 独立数学公式', action: () => transformActiveBlock('math', { latex: 'f(x) = \\int_{-\\infty}^{+\\infty} \\hat{f}(\\xi) e^{2\\pi i \\xi x} d\\xi' }) },
    { id: 'mermaid', icon: '❖', title: 'Mermaid 流程图', desc: '```mermaid 矢量图表', action: () => transformActiveBlock('mermaid', { code: 'flowchart LR\n    A["开始"] --> B{"条件判断"}\n    B -->|通过| C["执行处理"]\n    B -->|重试| A' }) },
    { id: 'table', icon: '⊞', title: '数据表格', desc: '| 插入交互式表格', action: () => transformActiveBlock('table', { headers: ['名称', '类型', '说明'], aligns: ['left', 'left', 'left'], rows: [['示例项 A', '核心功能', '支持直接点击单元格编辑'], ['示例项 B', '扩展模块', '支持增删行列与对齐切换']] }) },
    { id: 'image', icon: '▣', title: '插入图片', desc: '选择图片存入 ./assets/（支持 Cmd+V 粘贴）', action: () => triggerPickImageToInsert() },
    { id: 'hr', icon: '―', title: '分割线', desc: '--- 水平分割线', action: () => transformActiveBlock('hr') }
  ];

  // Application State
  const state = {
    rootPath: '',
    rootName: '工作区',
    fileTree: [],
    currentFilePath: '',
    currentFileName: '未命名.md',
    markdown: '',
    blocks: [],
    activeBlockId: null,
    editingSpecialId: null, // For math or mermaid block currently showing source editor
    isDirty: false,
    sourceMode: false,
    focusMode: false,
    typewriterMode: false,
    revealInlineSyntax: true, // Typora-like active block inline syntax reveal
    sidebarOpen: true,
    sidebarWidth: Math.min(440, Math.max(200, Number(localStorage.getItem('markora_sidebar_width')) || 265)),
    sidebarTab: 'files', // 'files' | 'outline' | 'history'
    fileSearchQuery: '',
    theme: localStorage.getItem('markora_theme') || 'github-light',
    slashMenuOpen: false,
    slashSelectedIndex: 0,
    homeDir: '',
    recentFolders: [],
    recentFiles: [],
    dirDropdownOpen: false,
    findBarOpen: false,
    replaceBarOpen: false,
    findMatches: [],
    findActiveIndex: -1,
    quickOpenVisible: false,
    quickOpenResults: [],
    quickOpenIndex: 0,
    collapsedFolders: new Set(),
    pendingExternalContent: null,
    lastExternalSyncToastTs: 0,
    selectedBlockIds: new Set(),
    selectionAnchorBlockId: null,
    selectionFocusBlockId: null,
    crossRange: null, // Character-accurate cross-block text selection { anchor, focus }
    slashMenuMode: 'slash'
  };

  let autoSaveTimer = null;
  const darkMediaQuery = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  /* ==========================================================================
   * DOCUMENT AST UNDO / REDO STACK
   * ========================================================================== */

  const undoState = {
    undoStack: [],
    redoStack: [],
    lastKey: null,
    lastTime: 0,
    maxDepth: 100
  };

  function captureCurrentSnapshot() {
    if (state.sourceMode) {
      const ta = document.getElementById('source-textarea');
      const md = ta ? ta.value : state.markdown;
      return {
        markdown: md,
        blocksJson: JSON.stringify(Parser.parseMarkdownToBlocks(md)),
        activeBlockId: state.activeBlockId
      };
    }
    const md = Parser.serializeBlocksToMarkdown(state.blocks);
    return {
      markdown: md,
      blocksJson: JSON.stringify(state.blocks),
      activeBlockId: state.activeBlockId
    };
  }

  function resetUndoHistory() {
    undoState.undoStack = [];
    undoState.redoStack = [];
    undoState.lastKey = null;
    undoState.lastTime = 0;
  }

  function recordUndoSnapshot(coalesceKey = null) {
    const now = Date.now();
    if (
      coalesceKey &&
      undoState.lastKey === coalesceKey &&
      now - undoState.lastTime < 900 &&
      undoState.undoStack.length > 0
    ) {
      undoState.lastTime = now;
      return;
    }
    const snap = captureCurrentSnapshot();
    const top = undoState.undoStack[undoState.undoStack.length - 1];
    if (top && top.markdown === snap.markdown) {
      return;
    }
    undoState.undoStack.push(snap);
    if (undoState.undoStack.length > undoState.maxDepth) {
      undoState.undoStack.shift();
    }
    undoState.redoStack = [];
    undoState.lastKey = coalesceKey;
    undoState.lastTime = now;
  }

  function applySnapshot(snap) {
    if (!snap) return;
    clearBlockSelection(false);
    state.markdown = snap.markdown;
    state.blocks = JSON.parse(snap.blocksJson);
    state.activeBlockId = snap.activeBlockId || state.blocks[0]?.id || null;
    state.editingSpecialId = null;
    if (state.sourceMode) {
      syncSourceEditor();
    } else {
      renderCanvas();
      if (state.activeBlockId) {
        focusBlockById(state.activeBlockId, 'end');
      }
    }
    markDirtyAndSync(true);
  }

  function performUndo() {
    if (undoState.undoStack.length === 0) {
      showToast('已无可撤销的操作');
      return;
    }
    const current = captureCurrentSnapshot();
    const prev = undoState.undoStack.pop();
    undoState.redoStack.push(current);
    undoState.lastKey = null;
    applySnapshot(prev);
  }

  function performRedo() {
    if (undoState.redoStack.length === 0) {
      showToast('已无可重做的操作');
      return;
    }
    const current = captureCurrentSnapshot();
    const next = undoState.redoStack.pop();
    undoState.undoStack.push(current);
    undoState.lastKey = null;
    applySnapshot(next);
  }

  function syncDocumentBaseDir() {
    if (state.currentFilePath && state.currentFilePath.includes('/')) {
      const dir = state.currentFilePath.slice(0, state.currentFilePath.lastIndexOf('/'));
      Parser.setDocumentBaseDir(dir);
    } else if (state.rootPath) {
      Parser.setDocumentBaseDir(state.rootPath);
    } else {
      Parser.setDocumentBaseDir('');
    }
  }

  function notifyNativeWatchState() {
    if (Bridge.watchState) {
      Bridge.watchState(state.rootPath || '', state.currentFilePath || '', state.markdown);
    }
  }

  /* ==========================================================================
   * INITIALIZATION
   * ========================================================================== */

  async function init() {
    const layoutEl = document.getElementById('app-layout');
    if (layoutEl) {
      layoutEl.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
    }

    if (darkMediaQuery && darkMediaQuery.addEventListener) {
      darkMediaQuery.addEventListener('change', () => {
        if (state.theme === 'auto') {
          applyTheme('auto');
        }
      });
    }

    applyTheme(state.theme);
    bindGlobalEvents();
    bindUIControls();
    if (Bridge.onExternalSync) {
      Bridge.onExternalSync(handleExternalSyncEvent);
    }

    // Load persisted recent folders & files history
    try {
      const hist = await Bridge.getHistory();
      if (hist) {
        state.recentFolders = hist.folders || [];
        state.recentFiles = hist.files || [];
        if (hist.homeDir) state.homeDir = hist.homeDir;
      }
    } catch (e) {}

    try {
      const ws = await Bridge.getInitialWorkspace();
      if (ws) {
        if (ws.homeDir) state.homeDir = ws.homeDir;
        state.rootPath = ws.rootPath || '';
        state.rootName = ws.rootName || '工作区';
        state.fileTree = ws.tree || [];
        if (state.rootPath) {
          recordRecentFolder(state.rootPath, state.rootName);
        }
        renderSidebarFiles();

        if (ws.initialFile) {
          loadDocument(ws.initialFile.path, ws.initialFile.name, ws.initialFile.content);
        } else if (state.fileTree.length > 0) {
          const firstFile = findFirstFileInTree(state.fileTree);
          if (firstFile) {
            await openFileFromTree(firstFile.path);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load initial workspace:', err);
      loadDocument('/workspace/欢迎使用.md', '欢迎使用.md', '# 欢迎使用 Markora\n\n开始你的极简写作之旅。');
    }

    renderHistoryViews();

    const runtimeBadge = document.getElementById('runtime-badge');
    if (runtimeBadge) {
      runtimeBadge.textContent = Bridge.getRuntimeName();
    }
  }

  function findFirstFileInTree(items) {
    for (const item of items) {
      if (item.type === 'file') return item;
      if (item.children && item.children.length > 0) {
        const found = findFirstFileInTree(item.children);
        if (found) return found;
      }
    }
    return null;
  }

  /* ==========================================================================
   * DOCUMENT LOADING & SAVING
   * ========================================================================== */

  function isSpecialBlockType(type) {
    return type === 'code' || type === 'mermaid' || type === 'math' || type === 'table' || type === 'image' || type === 'hr';
  }

  function ensureTrailingParagraph() {
    if (state.blocks.length === 0) {
      state.blocks.push({ id: Parser.nextBlockId(), type: 'paragraph', text: '' });
      return;
    }
    const last = state.blocks[state.blocks.length - 1];
    if (isSpecialBlockType(last.type)) {
      state.blocks.push({ id: Parser.nextBlockId(), type: 'paragraph', text: '' });
    }
  }

  function loadDocument(filePath, fileName, content) {
    state.currentFilePath = filePath || '';
    state.currentFileName = fileName || '未命名.md';
    syncDocumentBaseDir();
    state.markdown = String(content || '');
    state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
    ensureTrailingParagraph();
    state.activeBlockId = state.blocks[0]?.id || null;
    state.editingSpecialId = null;
    clearBlockSelection(false);
    state.isDirty = false;
    state.pendingExternalContent = null;
    hideExternalConflictBanner();
    resetUndoHistory();
    notifyNativeWatchState();

    if (state.currentFilePath) {
      recordRecentFile(state.currentFilePath, state.currentFileName);
    }

    updateHeaderTitle();
    renderCanvas();
    syncSourceEditor();
    renderSidebarOutline();
    renderSidebarFiles();
    renderHistoryViews();
    updateStatusBar();
    if (state.findBarOpen) {
      runInDocSearch(false);
    }
  }

  function showExternalConflictBanner() {
    document.getElementById('external-conflict-banner')?.classList.remove('hidden');
  }

  function hideExternalConflictBanner() {
    document.getElementById('external-conflict-banner')?.classList.add('hidden');
  }

  function applyExternalContentToEditor(nextContent, silentToast = false) {
    const scroller = document.getElementById('editor-scroll-container');
    const prevScrollTop = scroller ? scroller.scrollTop : 0;
    const srcTextarea = document.getElementById('source-textarea');
    const prevSrcScroll = srcTextarea ? srcTextarea.scrollTop : 0;
    const prevSrcStart = srcTextarea ? srcTextarea.selectionStart : 0;

    // Save passive undo snapshot without marking document dirty
    const snap = captureCurrentSnapshot();
    const topSnap = undoState.undoStack[undoState.undoStack.length - 1];
    if (!topSnap || topSnap.markdown !== snap.markdown) {
      undoState.undoStack.push(snap);
      if (undoState.undoStack.length > undoState.maxDepth) undoState.undoStack.shift();
    }

    const prevIdx = Math.max(0, state.blocks.findIndex(b => b.id === state.activeBlockId));
    state.markdown = String(nextContent ?? '');
    state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
    ensureTrailingParagraph();
    const clampedIdx = Math.min(prevIdx, Math.max(0, state.blocks.length - 1));
    state.activeBlockId = state.blocks[clampedIdx]?.id || null;
    state.editingSpecialId = null;
    clearBlockSelection(false);
    state.isDirty = false;
    state.pendingExternalContent = null;
    hideExternalConflictBanner();

    updateHeaderTitle();
    renderCanvas();
    syncSourceEditor();
    renderSidebarOutline();
    updateStatusBar();
    if (state.findBarOpen) {
      runInDocSearch(false);
    }

    if (scroller) scroller.scrollTop = prevScrollTop;
    if (srcTextarea) {
      srcTextarea.scrollTop = prevSrcScroll;
      if (state.sourceMode) {
        const clampedPos = Math.min(prevSrcStart, srcTextarea.value.length);
        srcTextarea.setSelectionRange(clampedPos, clampedPos);
      }
    }

    if (!silentToast) {
      const now = Date.now();
      if (now - state.lastExternalSyncToastTs > 2500) {
        state.lastExternalSyncToastTs = now;
        showToast('已自动同步外部修改');
      }
    }
  }

  async function reloadCurrentDocumentFromDisk() {
    if (!Bridge.reloadWorkspaceAndFile) return;
    try {
      const res = await Bridge.reloadWorkspaceAndFile(state.currentFilePath || '');
      if (res && Array.isArray(res.tree)) {
        state.fileTree = res.tree;
        renderSidebarFiles();
      }
      if (res && res.file && typeof res.file.content === 'string') {
        applyExternalContentToEditor(res.file.content, true);
        showToast(`已从磁盘同步 ${res.file.name}`);
      } else {
        showToast('已刷新工作区目录');
      }
    } catch (e) {
      showToast('从磁盘同步失败');
    }
  }

  async function handleExternalSyncEvent(event) {
    if (!event || !event.type) return;

    if (event.type === 'fileModified') {
      if (!event.path || event.path !== state.currentFilePath) return;
      const nextContent = String(event.content ?? '');
      const currentMemContent = state.sourceMode
        ? (document.getElementById('source-textarea')?.value ?? state.markdown)
        : (state.isDirty ? Parser.serializeBlocksToMarkdown(state.blocks) : state.markdown);

      if (nextContent === currentMemContent) {
        if (state.isDirty) {
          state.isDirty = false;
          hideExternalConflictBanner();
          updateHeaderTitle();
          updateStatusBar();
        }
        return;
      }

      if (!state.isDirty) {
        applyExternalContentToEditor(nextContent, false);
      } else {
        // Pause auto-save so local unsaved buffer never overwrites external disk changes silently
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer);
          autoSaveTimer = null;
        }
        state.pendingExternalContent = nextContent;
        showExternalConflictBanner();
      }
      return;
    }

    if (event.type === 'fileRenamed') {
      if (Array.isArray(event.tree)) {
        state.fileTree = event.tree;
      }
      if (event.oldPath && state.currentFilePath === event.oldPath) {
        state.currentFilePath = event.newPath;
        state.currentFileName = event.newName || event.newPath.split('/').pop() || state.currentFileName;
        syncDocumentBaseDir();
        state.recentFiles = state.recentFiles.filter(f => f.path !== event.oldPath);
        recordRecentFile(state.currentFilePath, state.currentFileName);
        updateHeaderTitle();
        if (!state.isDirty && typeof event.content === 'string' && event.content !== state.markdown) {
          applyExternalContentToEditor(event.content, true);
        }
        showToast(`文档已在外部重命名为 ${state.currentFileName}`);
      }
      renderSidebarFiles();
      renderHistoryViews();
      return;
    }

    if (event.type === 'fileDeleted') {
      if (Array.isArray(event.tree)) {
        state.fileTree = event.tree;
      }
      if (event.path) {
        state.recentFiles = state.recentFiles.filter(
          f => f.path !== event.path && !f.path.startsWith(event.path + '/')
        );
        persistHistory();
      }
      renderSidebarFiles();
      renderHistoryViews();

      if (event.path && state.currentFilePath === event.path) {
        if (state.isDirty) {
          if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
          }
          showToast('当前文档已在外部被移走或删除，按 Cmd+S 可重新保存');
        } else {
          const nextFile = findFirstFileInTree(state.fileTree);
          if (nextFile) {
            await openFileFromTree(nextFile.path);
            showToast('原文档已在外部被删除，已自动切换文档');
          } else {
            state.currentFilePath = '';
            notifyNativeWatchState();
            updateHeaderTitle();
            showToast('当前文档已在外部被移走或删除');
          }
        }
      }
      return;
    }

    if (event.type === 'treeChanged') {
      if (event.rootPath && state.rootPath && event.rootPath !== state.rootPath) return;
      state.fileTree = event.tree || [];
      renderSidebarFiles();
      return;
    }

    if (event.type === 'assetsChanged') {
      const ts = event.ts || Date.now();
      document.querySelectorAll('#wysiwyg-canvas img, #image-lightbox-img').forEach(img => {
        const curSrc = img.getAttribute('src') || '';
        if (curSrc.startsWith('file://')) {
          const cleanSrc = curSrc.split('?')[0];
          img.setAttribute('src', `${cleanSrc}?v=${ts}`);
        }
      });
    }
  }

  function markDirtyAndSync(rebuildOutline = true) {
    state.markdown = Parser.serializeBlocksToMarkdown(state.blocks);
    state.isDirty = true;
    updateHeaderTitle();
    if (rebuildOutline) renderSidebarOutline();
    updateStatusBar();

    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (state.isDirty && state.currentFilePath) {
        saveCurrentDocument(true);
      }
    }, 1200);
  }

  async function saveCurrentDocument(silent = false) {
    if (state.sourceMode) {
      const srcEl = document.getElementById('source-textarea');
      if (srcEl) {
        state.markdown = srcEl.value;
        state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
      }
    } else {
      state.markdown = Parser.serializeBlocksToMarkdown(state.blocks);
    }

    if (!state.currentFilePath) {
      const res = await Bridge.saveFileAs(state.currentFileName, state.markdown);
      if (res && res.path) {
        state.currentFilePath = res.path;
        state.currentFileName = res.name || res.path.split('/').pop();
        syncDocumentBaseDir();
        notifyNativeWatchState();
        recordRecentFile(state.currentFilePath, state.currentFileName);
        renderCanvas();
      } else {
        return false;
      }
    } else {
      await Bridge.writeFile(state.currentFilePath, state.markdown);
    }

    state.isDirty = false;
    state.pendingExternalContent = null;
    hideExternalConflictBanner();
    updateHeaderTitle();
    updateStatusBar();
    if (!silent) {
      showToast(`已保存 ${state.currentFileName}`);
    }
    return true;
  }

  function updateHeaderTitle() {
    const titleEl = document.getElementById('doc-title-text');
    const dotEl = document.getElementById('doc-dirty-dot');
    const pathEl = document.getElementById('doc-folder-name');

    if (titleEl) titleEl.textContent = state.currentFileName;
    if (dotEl) dotEl.classList.toggle('visible', state.isDirty);
    if (pathEl) pathEl.textContent = state.rootName || '本地文档';

    Bridge.setWindowTitle(state.currentFileName, state.isDirty);
  }

  /* ==========================================================================
   * WYSIWYG CANVAS RENDERING
   * ========================================================================== */

  function renderCanvas() {
    const canvas = document.getElementById('wysiwyg-canvas');
    if (!canvas) return;

    canvas.innerHTML = '';

    state.blocks.forEach((block, index) => {
      const blockEl = createBlockDOM(block, index);
      canvas.appendChild(blockEl);
    });
  }

  function createBlockDOM(block, index) {
    const wrapper = document.createElement('div');
    wrapper.className = `mk-block mk-block-${block.type}`;
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;
    if (block.id === state.activeBlockId) {
      wrapper.classList.add('is-active');
    }
    if (state.selectedBlockIds.has(block.id)) {
      wrapper.classList.add('is-selected');
    }

    // Left gutter block type badge (click for block actions/transform, Shift+click for range select)
    const gutter = document.createElement('div');
    gutter.className = 'mk-block-gutter';
    gutter.title = '点击打开块操作菜单（删除 / 克隆 / 转换类型） · Shift+点击多选块';
    gutter.textContent = getBlockBadgeLabel(block);
    gutter.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey && (state.selectionAnchorBlockId || state.activeBlockId)) {
        setBlockRangeSelection(state.selectionAnchorBlockId || state.activeBlockId, block.id, true);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        toggleSingleBlockSelection(block.id);
        return;
      }
      clearBlockSelection(false);
      setActiveBlock(block.id);
      openSlashMenuForBlock(wrapper, 'gutter');
    });
    wrapper.appendChild(gutter);

    switch (block.type) {
      case 'heading': {
        const tag = `h${Math.min(Math.max(block.level || 1, 1), 6)}`;
        const hEl = document.createElement(tag);
        hEl.className = `mk-editable mk-heading mk-h${block.level}`;
        hEl.contentEditable = 'true';
        hEl.spellcheck = false;
        hEl.dataset.placeholder = `标题 ${block.level}`;
        renderEditableContent(hEl, block.text, block.id === state.activeBlockId);
        bindTextBlockEvents(hEl, block);
        wrapper.appendChild(hEl);
        break;
      }

      case 'paragraph': {
        const pEl = document.createElement('div');
        pEl.className = 'mk-editable mk-paragraph';
        pEl.contentEditable = 'true';
        pEl.spellcheck = false;
        pEl.dataset.placeholder = index === 0 ? '开始输入正文，或输入 / 呼出快捷命令菜单…' : '输入正文，或输入 / 插入块…';
        renderEditableContent(pEl, block.text, block.id === state.activeBlockId);
        bindTextBlockEvents(pEl, block);
        wrapper.appendChild(pEl);
        break;
      }

      case 'blockquote': {
        const bqEl = document.createElement('blockquote');
        bqEl.className = 'mk-editable mk-blockquote';
        bqEl.contentEditable = 'true';
        bqEl.spellcheck = false;
        bqEl.dataset.placeholder = '输入引用内容…';
        renderEditableContent(bqEl, block.text, block.id === state.activeBlockId);
        bindTextBlockEvents(bqEl, block);
        wrapper.appendChild(bqEl);
        break;
      }

      case 'callout': {
        const calloutBox = document.createElement('div');
        const kind = (block.calloutType || 'NOTE').toUpperCase();
        calloutBox.className = `mk-callout mk-callout-${kind.toLowerCase()}`;

        const header = document.createElement('div');
        header.className = 'mk-callout-header';
        const icons = {
          NOTE: Icons.calloutNote,
          TIP: Icons.calloutTip,
          IMPORTANT: Icons.calloutImportant,
          WARNING: Icons.calloutWarning,
          CAUTION: Icons.calloutCaution
        };
        header.innerHTML = `<span class="mk-callout-header-left" title="点击切换提示框类型"><span class="mk-callout-icon">${icons[kind] || Icons.calloutNote}</span><span class="mk-callout-title">${kind}</span></span>`;

        const delCalloutBtn = document.createElement('button');
        delCalloutBtn.type = 'button';
        delCalloutBtn.className = 'mk-callout-del-btn';
        delCalloutBtn.title = '删除此提示框';
        delCalloutBtn.textContent = '×';
        delCalloutBtn.addEventListener('click', e => {
          e.stopPropagation();
          deleteBlock(block.id);
        });
        header.appendChild(delCalloutBtn);

        // Click callout header to cycle callout type
        header.addEventListener('click', () => {
          recordUndoSnapshot();
          const types = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
          const nextIdx = (types.indexOf(kind) + 1) % types.length;
          block.calloutType = types[nextIdx];
          markDirtyAndSync(false);
          replaceBlockDOM(block);
        });

        const body = document.createElement('div');
        body.className = 'mk-editable mk-callout-body';
        body.contentEditable = 'true';
        body.spellcheck = false;
        body.dataset.placeholder = '输入提示内容…';
        renderEditableContent(body, block.text, block.id === state.activeBlockId);
        bindTextBlockEvents(body, block);

        calloutBox.appendChild(header);
        calloutBox.appendChild(body);
        wrapper.appendChild(calloutBox);
        break;
      }

      case 'ulist':
      case 'olist': {
        const listTag = block.type === 'olist' ? 'ol' : 'ul';
        const listEl = document.createElement(listTag);
        listEl.className = `mk-list mk-${block.type}`;
        (block.items || ['']).forEach((itemText, itemIdx) => {
          const li = document.createElement('li');
          li.className = 'mk-list-item';
          const span = document.createElement('div');
          span.className = 'mk-editable mk-list-item-text';
          span.contentEditable = 'true';
          span.spellcheck = false;
          span.dataset.placeholder = '列表项…';
          renderEditableContent(span, itemText, false);
          bindListItemEvents(span, block, itemIdx);
          li.appendChild(span);
          listEl.appendChild(li);
        });
        wrapper.appendChild(listEl);
        break;
      }

      case 'tasklist': {
        const ul = document.createElement('ul');
        ul.className = 'mk-list mk-tasklist';
        (block.items || [{ checked: false, text: '' }]).forEach((item, itemIdx) => {
          const li = document.createElement('li');
          li.className = `mk-task-item ${item.checked ? 'is-checked' : ''}`;

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'mk-task-checkbox';
          checkbox.checked = Boolean(item.checked);
          checkbox.addEventListener('change', () => {
            recordUndoSnapshot();
            item.checked = checkbox.checked;
            li.classList.toggle('is-checked', item.checked);
            markDirtyAndSync(false);
          });

          const span = document.createElement('div');
          span.className = 'mk-editable mk-task-text';
          span.contentEditable = 'true';
          span.spellcheck = false;
          span.dataset.placeholder = '待办事项…';
          renderEditableContent(span, item.text, false);
          bindTaskItemEvents(span, block, itemIdx);

          li.appendChild(checkbox);
          li.appendChild(span);
          ul.appendChild(li);
        });
        wrapper.appendChild(ul);
        break;
      }

      case 'code': {
        wrapper.appendChild(createCodeBlockDOM(block));
        break;
      }

      case 'math': {
        wrapper.appendChild(createMathBlockDOM(block));
        break;
      }

      case 'mermaid': {
        wrapper.appendChild(createMermaidBlockDOM(block));
        break;
      }

      case 'table': {
        wrapper.appendChild(createTableBlockDOM(block));
        break;
      }

      case 'image': {
        wrapper.appendChild(createImageBlockDOM(block));
        break;
      }

      case 'hr': {
        const hrBox = document.createElement('div');
        hrBox.className = 'mk-hr-container';
        hrBox.tabIndex = 0;
        hrBox.title = '点击选中分割线（按 Delete / Backspace 删除）';
        hrBox.innerHTML = '<hr class="mk-hr" />';
        hrBox.addEventListener('click', e => {
          if (e.shiftKey) return;
          selectSingleBlock(block.id);
        });
        hrBox.addEventListener('keydown', e => {
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            deleteBlock(block.id);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            stepDownFromSpecialBlock(block.id);
          } else if (e.key === 'ArrowUp') {
            const idx = state.blocks.findIndex(b => b.id === block.id);
            if (idx > 0) {
              e.preventDefault();
              focusBlockById(state.blocks[idx - 1].id, 'end');
            }
          }
        });
        wrapper.appendChild(hrBox);
        break;
      }
    }

    return wrapper;
  }

  function getBlockBadgeLabel(block) {
    switch (block.type) {
      case 'heading': return `H${block.level}`;
      case 'paragraph': return '¶';
      case 'blockquote': return '❝';
      case 'callout': return '!';
      case 'ulist': return '•';
      case 'olist': return '1.';
      case 'tasklist': return '☑';
      case 'code': return '</>';
      case 'math': return '∑';
      case 'mermaid': return '❖';
      case 'table': return '⊞';
      case 'image': return '▣';
      case 'hr': return '―';
      default: return '¶';
    }
  }

  function renderEditableContent(el, rawText, isFocusedBlock) {
    const showMarkers = isFocusedBlock && state.revealInlineSyntax;
    el.innerHTML = Parser.renderInlineMarkdown(rawText || '', showMarkers);
  }

  function replaceBlockDOM(block) {
    const canvas = document.getElementById('wysiwyg-canvas');
    if (!canvas) return;
    const oldEl = canvas.querySelector(`[data-block-id="${block.id}"]`);
    if (!oldEl) return;
    const idx = state.blocks.findIndex(b => b.id === block.id);
    const newEl = createBlockDOM(block, idx);
    oldEl.replaceWith(newEl);
  }

  /* ==========================================================================
   * SPECIAL BLOCKS: CODE, MATH, MERMAID, TABLE
   * ========================================================================== */

  function createCodeBlockDOM(block) {
    const container = document.createElement('div');
    container.className = 'mk-codeblock';

    // Top bar: language selector + copy + delete
    const header = document.createElement('div');
    header.className = 'mk-codeblock-header';

    const langSelect = document.createElement('select');
    langSelect.className = 'mk-code-lang-select';
    const currentLang = (block.lang || 'javascript').toLowerCase();
    const langSet = new Set([...LANGUAGES, currentLang]);
    langSet.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l;
      if (l === currentLang) opt.selected = true;
      langSelect.appendChild(opt);
    });

    const actions = document.createElement('div');
    actions.className = 'mk-code-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'mk-code-btn';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(block.code || '');
      copyBtn.textContent = '已复制 ✓';
      setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
    });

    const addBelowBtn = document.createElement('button');
    addBelowBtn.type = 'button';
    addBelowBtn.className = 'mk-code-btn';
    addBelowBtn.title = '在下方插入新行 (Cmd+Enter 或在末行按 ↓)';
    addBelowBtn.textContent = '+ 下方新行';
    addBelowBtn.addEventListener('click', () => {
      insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
    });

    const delCodeBtn = document.createElement('button');
    delCodeBtn.type = 'button';
    delCodeBtn.className = 'mk-code-btn is-danger';
    delCodeBtn.title = '删除代码块';
    delCodeBtn.textContent = '×';
    delCodeBtn.addEventListener('click', () => {
      deleteBlock(block.id);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(addBelowBtn);
    actions.appendChild(delCodeBtn);
    header.appendChild(langSelect);
    header.appendChild(actions);

    // Code Editor Body with line numbers + highlighted backdrop + editable textarea
    const editorWrap = document.createElement('div');
    editorWrap.className = 'mk-code-editor-wrap';

    const lineNums = document.createElement('div');
    lineNums.className = 'mk-code-linenums';

    const codeStage = document.createElement('div');
    codeStage.className = 'mk-code-stage';

    const pre = document.createElement('pre');
    pre.className = 'mk-code-highlight-layer';
    const codeEl = document.createElement('code');
    pre.appendChild(codeEl);

    const textarea = document.createElement('textarea');
    textarea.className = 'mk-code-textarea';
    textarea.spellcheck = false;
    textarea.autocapitalize = 'off';
    textarea.autocomplete = 'off';
    textarea.value = block.code || '';

    const syncHighlight = () => {
      const val = textarea.value;
      block.code = val;
      // Trailing newline + space ensures <pre> naturally matches <textarea> height on both growth and deletion
      codeEl.innerHTML = Renderers.highlightCode(val, block.lang) + '\n ';
      const count = Math.max(1, val.split('\n').length);
      lineNums.innerHTML = Array.from({ length: count }, (_, i) => `<span>${i + 1}</span>`).join('');
    };

    langSelect.addEventListener('change', () => {
      recordUndoSnapshot();
      block.lang = langSelect.value;
      if (block.lang === 'mermaid') {
        block.type = 'mermaid';
        replaceBlockDOM(block);
      } else {
        syncHighlight();
      }
      markDirtyAndSync(false);
    });

    textarea.addEventListener('focus', () => setActiveBlock(block.id));
    textarea.addEventListener('input', () => {
      recordUndoSnapshot('code:' + block.id);
      syncHighlight();
      markDirtyAndSync(false);
    });

    textarea.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        textarea.blur();
        selectSingleBlock(block.id);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        recordUndoSnapshot('code:' + block.id);
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, start) + '  ' + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        syncHighlight();
        markDirtyAndSync(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          insertBlockBefore(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
        } else {
          insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
        }
      } else if (e.key === 'ArrowDown' && e.shiftKey && !e.metaKey && !e.altKey) {
        const val = textarea.value;
        if (val.indexOf('\n', textarea.selectionEnd) === -1) {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx >= 0 && idx < state.blocks.length - 1) {
            e.preventDefault();
            textarea.blur();
            setBlockRangeSelection(block.id, state.blocks[idx + 1].id, true);
          }
        }
      } else if (e.key === 'ArrowUp' && e.shiftKey && !e.metaKey && !e.altKey) {
        const val = textarea.value;
        if (textarea.selectionStart === 0 || val.lastIndexOf('\n', textarea.selectionStart - 1) === -1) {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx > 0) {
            e.preventDefault();
            textarea.blur();
            setBlockRangeSelection(block.id, state.blocks[idx - 1].id, true);
          }
        }
      } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.metaKey && !e.altKey) {
        if (textarea.selectionStart === textarea.selectionEnd) {
          const val = textarea.value;
          const pos = textarea.selectionEnd;
          const onLastLogicalLine = val.indexOf('\n', pos) === -1;
          const lineCount = Math.max(1, val.split('\n').length);
          const noSoftWrap = !pre.offsetHeight || Math.abs(pre.offsetHeight - (lineCount * 21.6 + 24)) < 8;
          if (onLastLogicalLine && (pos === val.length || noSoftWrap)) {
            e.preventDefault();
            stepDownFromSpecialBlock(block.id);
          }
        }
      } else if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.altKey) {
        if (textarea.selectionStart === textarea.selectionEnd) {
          const val = textarea.value;
          const pos = textarea.selectionStart;
          const onFirstLogicalLine = pos === 0 || val.lastIndexOf('\n', pos - 1) === -1;
          const lineCount = Math.max(1, val.split('\n').length);
          const noSoftWrap = !pre.offsetHeight || Math.abs(pre.offsetHeight - (lineCount * 21.6 + 24)) < 8;
          if (onFirstLogicalLine && (pos === 0 || noSoftWrap)) {
            const idx = state.blocks.findIndex(b => b.id === block.id);
            if (idx > 0) {
              e.preventDefault();
              focusBlockById(state.blocks[idx - 1].id, 'end');
            }
          }
        }
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && textarea.value === '') {
        e.preventDefault();
        deleteBlock(block.id);
      }
    });

    codeStage.appendChild(pre);
    codeStage.appendChild(textarea);
    editorWrap.appendChild(lineNums);
    editorWrap.appendChild(codeStage);

    container.appendChild(header);
    container.appendChild(editorWrap);

    syncHighlight();
    return container;
  }

  function createMathBlockDOM(block) {
    const container = document.createElement('div');
    container.className = 'mk-mathblock';
    container.tabIndex = 0;
    const isEditing = state.editingSpecialId === block.id;
    if (isEditing) container.classList.add('is-editing');

    const hoverActions = document.createElement('div');
    hoverActions.className = 'mk-math-hover-actions';
    const delMathBtn = document.createElement('button');
    delMathBtn.type = 'button';
    delMathBtn.className = 'mk-math-del-btn';
    delMathBtn.title = '删除数学公式块';
    delMathBtn.textContent = '×';
    delMathBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteBlock(block.id);
    });
    hoverActions.appendChild(delMathBtn);

    const preview = document.createElement('div');
    preview.className = 'mk-math-preview';
    preview.title = '点击编辑 LaTeX 公式源码 · 按 Esc 选中整个公式块后可删除';
    preview.innerHTML = Renderers.renderMath(block.latex || 'E = mc^2', true);

    const drawer = document.createElement('div');
    drawer.className = 'mk-special-drawer';

    const drawerHeader = document.createElement('div');
    drawerHeader.className = 'mk-special-drawer-header';
    drawerHeader.innerHTML = '<span>$$ LaTeX 公式源码（实时预览）</span><span class="mk-drawer-hint">Cmd+Enter 完成 · Esc 选中块 · 清空按 ⌫ 删除</span>';

    const input = document.createElement('textarea');
    input.className = 'mk-special-textarea';
    input.rows = 3;
    input.spellcheck = false;
    input.value = block.latex || '';
    input.placeholder = '输入 LaTeX 公式，例如 \\frac{a}{b} 或 \\sum_{i=1}^n x_i';

    input.addEventListener('input', () => {
      recordUndoSnapshot('math:' + block.id);
      block.latex = input.value;
      preview.innerHTML = Renderers.renderMath(block.latex, true);
      markDirtyAndSync(false);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        state.editingSpecialId = null;
        container.classList.remove('is-editing');
        input.blur();
        selectSingleBlock(block.id);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        state.editingSpecialId = null;
        container.classList.remove('is-editing');
        insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && input.value === '') {
        e.preventDefault();
        deleteBlock(block.id);
      }
    });

    preview.addEventListener('click', e => {
      if (e.shiftKey) return;
      setActiveBlock(block.id);
      const nextState = !container.classList.contains('is-editing');
      state.editingSpecialId = nextState ? block.id : null;
      container.classList.toggle('is-editing', nextState);
      if (nextState) {
        setTimeout(() => input.focus(), 20);
      } else {
        selectSingleBlock(block.id);
      }
    });

    drawer.appendChild(drawerHeader);
    drawer.appendChild(input);
    container.appendChild(hoverActions);
    container.appendChild(preview);
    container.appendChild(drawer);
    return container;
  }

  function createMermaidBlockDOM(block) {
    const container = document.createElement('div');
    container.className = 'mk-mermaidblock';
    container.tabIndex = 0;
    const isEditing = state.editingSpecialId === block.id;
    if (isEditing) container.classList.add('is-editing');

    const toolbar = document.createElement('div');
    toolbar.className = 'mk-mermaid-toolbar';
    toolbar.innerHTML = `
      <span class="mk-mermaid-badge">❖ Mermaid 矢量图</span>
      <div class="mk-mermaid-actions">
        <button type="button" class="mk-code-btn mk-mermaid-edit-btn">编辑图表源码</button>
        <button type="button" class="mk-code-btn mk-mermaid-addp-btn">+ 段落</button>
        <button type="button" class="mk-code-btn is-danger mk-mermaid-del-btn" title="删除此图表">×</button>
      </div>
    `;

    const preview = document.createElement('div');
    preview.className = 'mk-mermaid-preview';
    preview.title = '单击选中图表块（按 Delete 删除） · 双击编辑图表源码';
    preview.innerHTML = Renderers.renderMermaidToSVG(block.code || '');

    const drawer = document.createElement('div');
    drawer.className = 'mk-special-drawer';

    const input = document.createElement('textarea');
    input.className = 'mk-special-textarea';
    input.rows = 5;
    input.spellcheck = false;
    input.value = block.code || '';

    input.addEventListener('input', () => {
      recordUndoSnapshot('mermaid:' + block.id);
      block.code = input.value;
      preview.innerHTML = Renderers.renderMermaidToSVG(block.code);
      markDirtyAndSync(false);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        state.editingSpecialId = null;
        container.classList.remove('is-editing');
        input.blur();
        selectSingleBlock(block.id);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        state.editingSpecialId = null;
        container.classList.remove('is-editing');
        insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && input.value === '') {
        e.preventDefault();
        deleteBlock(block.id);
      }
    });

    const toggleEdit = () => {
      clearBlockSelection(false);
      setActiveBlock(block.id);
      const nextState = !container.classList.contains('is-editing');
      state.editingSpecialId = nextState ? block.id : null;
      container.classList.toggle('is-editing', nextState);
      if (nextState) setTimeout(() => input.focus(), 20);
    };

    toolbar.querySelector('.mk-mermaid-edit-btn').addEventListener('click', toggleEdit);
    toolbar.querySelector('.mk-mermaid-addp-btn').addEventListener('click', () => {
      insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
    });
    toolbar.querySelector('.mk-mermaid-del-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteBlock(block.id);
    });
    preview.addEventListener('click', e => {
      if (e.shiftKey) return;
      if (!container.classList.contains('is-editing')) {
        selectSingleBlock(block.id);
      }
    });
    preview.addEventListener('dblclick', toggleEdit);

    drawer.appendChild(input);
    container.appendChild(toolbar);
    container.appendChild(preview);
    container.appendChild(drawer);
    return container;
  }

  function isTableCompletelyEmpty(block) {
    const headersEmpty = (block.headers || []).every(h => !(h || '').trim());
    const rowsEmpty = (block.rows || []).every(r => (r || []).every(c => !(c || '').trim()));
    return headersEmpty && rowsEmpty;
  }

  function createTableBlockDOM(block) {
    const container = document.createElement('div');
    container.className = 'mk-table-container';

    const bar = document.createElement('div');
    bar.className = 'mk-table-toolbar';
    bar.innerHTML = `
      <span class="mk-table-label" title="点击选中整个表格">⊞ 表格</span>
      <div class="mk-table-btns">
        <button type="button" data-act="add-row">+ 行</button>
        <button type="button" data-act="add-col">+ 列</button>
        <button type="button" data-act="del-row">- 行</button>
        <button type="button" data-act="del-col">- 列</button>
        <button type="button" data-act="add-para">+ 下方段落</button>
        <button type="button" data-act="del-table" class="is-danger" title="删除整个表格">× 删除表格</button>
      </div>
    `;

    bar.querySelector('.mk-table-label')?.addEventListener('click', e => {
      if (e.shiftKey) return;
      selectSingleBlock(block.id);
    });

    bar.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'del-table') {
        deleteBlock(block.id);
        return;
      }
      if (act === 'add-para') {
        insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
        return;
      }
      if (act === 'del-row' && block.rows.length <= 1) {
        deleteBlock(block.id);
        return;
      }
      recordUndoSnapshot();
      const colCount = block.headers.length;
      if (act === 'add-row') {
        block.rows.push(Array.from({ length: colCount }, () => ''));
      } else if (act === 'add-col') {
        block.headers.push(`列 ${colCount + 1}`);
        block.aligns.push('left');
        block.rows.forEach(r => r.push(''));
      } else if (act === 'del-row' && block.rows.length > 1) {
        block.rows.pop();
      } else if (act === 'del-col' && block.headers.length > 1) {
        block.headers.pop();
        block.aligns.pop();
        block.rows.forEach(r => r.pop());
      }
      markDirtyAndSync(false);
      replaceBlockDOM(block);
    });

    const table = document.createElement('table');
    table.className = 'mk-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    block.headers.forEach((hText, colIdx) => {
      const th = document.createElement('th');
      th.style.textAlign = block.aligns[colIdx] || 'left';
      th.contentEditable = 'true';
      th.spellcheck = false;
      th.innerHTML = Parser.renderInlineMarkdown(hText, false);
      th.addEventListener('focus', () => {
        setActiveBlock(block.id);
        th.innerHTML = Parser.renderInlineMarkdown(block.headers[colIdx], state.revealInlineSyntax);
      });
      th.addEventListener('input', () => {
        recordUndoSnapshot('tbl:' + block.id);
        block.headers[colIdx] = Parser.extractInlineMarkdownFromElement(th);
        markDirtyAndSync(false);
      });
      th.addEventListener('blur', () => {
        th.innerHTML = Parser.renderInlineMarkdown(block.headers[colIdx], false);
      });
      th.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          th.blur();
          selectSingleBlock(block.id);
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
        } else if (e.key === 'ArrowUp' && !e.metaKey && !e.altKey) {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx > 0) {
            e.preventDefault();
            if (e.shiftKey) {
              th.blur();
              setBlockRangeSelection(block.id, state.blocks[idx - 1].id, true);
            } else {
              focusBlockById(state.blocks[idx - 1].id, 'end');
            }
          }
        } else if (e.key === 'Backspace' && colIdx === 0 && isTableCompletelyEmpty(block)) {
          e.preventDefault();
          deleteBlock(block.id);
        }
      });
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    block.rows.forEach((row, rowIdx) => {
      const tr = document.createElement('tr');
      block.headers.forEach((_, colIdx) => {
        const td = document.createElement('td');
        td.style.textAlign = block.aligns[colIdx] || 'left';
        td.contentEditable = 'true';
        td.spellcheck = false;
        const cellVal = row[colIdx] || '';
        td.innerHTML = Parser.renderInlineMarkdown(cellVal, false);
        td.addEventListener('focus', () => {
          setActiveBlock(block.id);
          td.innerHTML = Parser.renderInlineMarkdown(block.rows[rowIdx][colIdx] || '', state.revealInlineSyntax);
        });
        td.addEventListener('input', () => {
          recordUndoSnapshot('tbl:' + block.id);
          block.rows[rowIdx][colIdx] = Parser.extractInlineMarkdownFromElement(td);
          markDirtyAndSync(false);
        });
        td.addEventListener('blur', () => {
          td.innerHTML = Parser.renderInlineMarkdown(block.rows[rowIdx][colIdx] || '', false);
        });
        td.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            td.blur();
            selectSingleBlock(block.id);
          } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
          } else if (e.key === 'ArrowDown' && rowIdx === block.rows.length - 1 && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (e.shiftKey) {
              const idx = state.blocks.findIndex(b => b.id === block.id);
              if (idx >= 0 && idx < state.blocks.length - 1) {
                td.blur();
                setBlockRangeSelection(block.id, state.blocks[idx + 1].id, true);
              }
            } else {
              stepDownFromSpecialBlock(block.id);
            }
          } else if (e.key === 'Backspace' && rowIdx === 0 && colIdx === 0 && isTableCompletelyEmpty(block)) {
            e.preventDefault();
            deleteBlock(block.id);
          }
        });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.appendChild(bar);
    container.appendChild(table);
    return container;
  }

  function createImageBlockDOM(block) {
    const card = document.createElement('div');
    card.className = 'mk-image-card';
    card.tabIndex = 0;

    const stage = document.createElement('div');
    stage.className = 'mk-image-stage';

    const img = document.createElement('img');
    img.className = 'mk-image-el';
    const resolvedSrc = Parser.resolveAssetUrl(block.src || '');
    img.src = resolvedSrc;
    img.alt = block.alt || '';
    img.style.width = block.width || '100%';
    img.addEventListener('click', e => {
      e.stopPropagation();
      setActiveBlock(block.id);
      openImageLightbox(resolvedSrc, block.alt || block.src || '');
    });

    const controls = document.createElement('div');
    controls.className = 'mk-image-controls';
    const widths = ['50%', '75%', '100%'];
    widths.forEach(w => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mk-img-ctrl-btn ${(block.width || '100%') === w ? 'is-active' : ''}`;
      btn.textContent = w;
      btn.title = `缩放显示宽度至 ${w}`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        recordUndoSnapshot();
        block.width = w;
        img.style.width = w;
        controls.querySelectorAll('.mk-img-ctrl-btn[data-w]').forEach(b => {
          b.classList.toggle('is-active', b.dataset.w === w);
        });
        markDirtyAndSync(false);
      });
      btn.dataset.w = w;
      controls.appendChild(btn);
    });

    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'mk-img-ctrl-btn';
    zoomBtn.title = '全屏放大预览';
    zoomBtn.innerHTML = Icons.zoomIn;
    zoomBtn.addEventListener('click', e => {
      e.stopPropagation();
      openImageLightbox(resolvedSrc, block.alt || block.src || '');
    });
    controls.appendChild(zoomBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'mk-img-ctrl-btn is-danger';
    delBtn.title = '移除此图片块';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteBlock(block.id);
    });
    controls.appendChild(delBtn);

    stage.appendChild(img);
    stage.appendChild(controls);

    const caption = document.createElement('div');
    caption.className = 'mk-editable mk-image-caption';
    caption.contentEditable = 'true';
    caption.spellcheck = false;
    caption.dataset.placeholder = '添加图片说明（可选）…';
    caption.textContent = block.alt || '';

    caption.addEventListener('focus', () => setActiveBlock(block.id));
    caption.addEventListener('input', () => {
      recordUndoSnapshot('imgcap:' + block.id);
      block.alt = caption.textContent.trim();
      img.alt = block.alt;
      markDirtyAndSync(false);
    });
    caption.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        caption.blur();
        selectSingleBlock(block.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && caption.textContent === '') {
        e.preventDefault();
        deleteBlock(block.id);
      } else if (e.key === 'ArrowUp') {
        const idx = state.blocks.findIndex(b => b.id === block.id);
        if (idx > 0) {
          e.preventDefault();
          focusBlockById(state.blocks[idx - 1].id, 'end');
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        stepDownFromSpecialBlock(block.id);
      }
    });

    stage.addEventListener('click', e => {
      if (e.target === stage && !e.shiftKey) {
        selectSingleBlock(block.id);
      }
    });

    card.addEventListener('keydown', e => {
      if (e.target === caption) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteBlock(block.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' });
      }
    });

    card.appendChild(stage);
    card.appendChild(caption);
    return card;
  }

  function openImageLightbox(src, captionText = '') {
    const box = document.getElementById('image-lightbox');
    const img = document.getElementById('lightbox-img');
    const cap = document.getElementById('lightbox-caption');
    if (!box || !img) return;
    img.src = src;
    if (cap) cap.textContent = captionText || '';
    box.classList.remove('hidden');
  }

  function closeImageLightbox() {
    const box = document.getElementById('image-lightbox');
    if (box) box.classList.add('hidden');
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }

  async function insertImageFileAsAsset(file) {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const extFromMime = (file.type || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      const rawName = (file.name && file.name !== 'image.png')
        ? file.name
        : `screenshot-${stamp}.${extFromMime}`;

      syncDocumentBaseDir();
      const res = await Bridge.saveImageAsset(state.currentFilePath || '', rawName, dataUrl);
      if (!res || !res.relativePath) {
        showToast('保存图片失败');
        return;
      }

      const altTitle = (rawName.replace(/\.[^.]+$/, '') || '').replace(/^screenshot-\d+-\d+$/, '');
      if (state.sourceMode) {
        const ta = document.getElementById('source-textarea');
        if (ta) {
          recordUndoSnapshot();
          const mdImg = `\n![${altTitle}](${res.relativePath})\n`;
          const pos = ta.selectionStart || 0;
          ta.value = ta.value.slice(0, pos) + mdImg + ta.value.slice(ta.selectionEnd || pos);
          state.markdown = ta.value;
          state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
          markDirtyAndSync(false);
          syncSourceEditor();
        }
      } else {
        const activeIdx = state.blocks.findIndex(b => b.id === state.activeBlockId);
        const activeBlk = activeIdx >= 0 ? state.blocks[activeIdx] : null;
        const imgBlock = {
          id: Parser.nextBlockId(),
          type: 'image',
          alt: altTitle,
          src: res.relativePath,
          width: '100%'
        };
        if (activeBlk && activeBlk.type === 'paragraph' && (!activeBlk.text || activeBlk.text === '/')) {
          recordUndoSnapshot();
          state.blocks[activeIdx] = imgBlock;
          state.activeBlockId = imgBlock.id;
          markDirtyAndSync(false);
          renderCanvas();
        } else {
          insertBlockAfter(state.activeBlockId || state.blocks[state.blocks.length - 1]?.id, imgBlock);
        }
      }
      showToast(`图片已存入 ${res.relativePath}`);
    } catch (err) {
      console.error('Image insert failed:', err);
      showToast('插入图片失败');
    }
  }

  function triggerPickImageToInsert() {
    closeSlashMenu();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (file) {
        await insertImageFileAsAsset(file);
      }
    };
    input.click();
  }

  /* ==========================================================================
   * TEXT & LIST BLOCK INTERACTION (Typora-style Live Editing)
   * ========================================================================== */

  function measureMarkdownOffsetInElement(el, targetContainer, targetOffset) {
    let out = '';
    let done = false;

    function walk(parent) {
      if (done) return;
      const children = parent.childNodes;
      for (let i = 0; i < children.length; i++) {
        if (done) return;
        if (parent === targetContainer && i === targetOffset) {
          done = true;
          return;
        }
        const node = children[i];
        if (node.nodeType === Node.TEXT_NODE) {
          if (node === targetContainer) {
            out += node.nodeValue.slice(0, targetOffset);
            done = true;
            return;
          }
          out += node.nodeValue;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          if (node.classList?.contains('md-inline-math')) {
            const hasMarker = node.previousElementSibling && node.previousElementSibling.classList?.contains('md-marker');
            if (!hasMarker) {
              const latex = (node.getAttribute('title') || '').replace(/^LaTeX:\s*/, '');
              if (node === targetContainer || node.contains?.(targetContainer)) {
                done = true;
                return;
              }
              out += `$${latex}$`;
            } else if (node === targetContainer || node.contains?.(targetContainer)) {
              done = true;
              return;
            }
          } else if (tag === 'img') {
            const hasMarker = node.previousElementSibling && node.previousElementSibling.classList?.contains('md-marker');
            if (!hasMarker) {
              const alt = node.getAttribute('alt') || '';
              const rawSrc = node.getAttribute('data-raw-src') || node.getAttribute('src') || '';
              out += `![${alt}](${rawSrc})`;
            }
          } else if (tag === 'br') {
            out += '\n';
          } else {
            const hasMarker = node.previousElementSibling && node.previousElementSibling.classList?.contains('md-marker');
            let prefix = '';
            let suffix = '';
            if (!hasMarker && !node.classList?.contains('md-marker')) {
              if (tag === 'strong' || tag === 'b') { prefix = '**'; suffix = '**'; }
              else if (tag === 'em' || tag === 'i') { prefix = '*'; suffix = '*'; }
              else if (tag === 'code') { prefix = '`'; suffix = '`'; }
              else if (tag === 'del' || tag === 's') { prefix = '~~'; suffix = '~~'; }
              else if (tag === 'mark') { prefix = '=='; suffix = '=='; }
              else if (tag === 'a') { prefix = '['; suffix = `](${node.getAttribute('href') || ''})`; }
            }
            out += prefix;
            walk(node);
            if (!done) out += suffix;
          }
        }
      }
      if (!done && parent === targetContainer && targetOffset >= children.length) {
        done = true;
      }
    }

    walk(el);
    return out.replace(/\u00a0/g, ' ').length;
  }

  function domPointFromMarkdownOffset(el, targetMdOffset) {
    if (!el || targetMdOffset <= 0) {
      return { node: el, offset: 0 };
    }
    let mdPos = 0;
    let found = null;

    function walk(parent) {
      if (found) return;
      const children = parent.childNodes || [];
      for (let i = 0; i < children.length; i++) {
        if (found) return;
        const node = children[i];
        if (node.nodeType === Node.TEXT_NODE) {
          const val = (node.nodeValue || '').replace(/\u00a0/g, ' ');
          if (targetMdOffset <= mdPos + val.length) {
            found = {
              node,
              offset: Math.min((node.nodeValue || '').length, Math.max(0, targetMdOffset - mdPos))
            };
            return;
          }
          mdPos += val.length;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          if (node.classList?.contains('md-inline-math')) {
            const hasMarker = node.previousElementSibling && node.previousElementSibling.classList?.contains('md-marker');
            if (!hasMarker) {
              const latex = (node.getAttribute('title') || '').replace(/^LaTeX:\s*/, '');
              const tokenLen = latex.length + 2;
              if (targetMdOffset <= mdPos + tokenLen) {
                found = { node: parent, offset: targetMdOffset <= mdPos ? i : i + 1 };
                return;
              }
              mdPos += tokenLen;
            }
          } else if (tag === 'img') {
            const hasMarker = node.previousElementSibling && node.previousElementSibling.classList?.contains('md-marker');
            if (!hasMarker) {
              const alt = node.getAttribute('alt') || '';
              const rawSrc = node.getAttribute('data-raw-src') || node.getAttribute('src') || '';
              const tokenLen = `![${alt}](${rawSrc})`.length;
              if (targetMdOffset <= mdPos + tokenLen) {
                found = { node: parent, offset: targetMdOffset <= mdPos ? i : i + 1 };
                return;
              }
              mdPos += tokenLen;
            }
          } else if (tag === 'br') {
            if (targetMdOffset <= mdPos + 1) {
              found = { node: parent, offset: targetMdOffset <= mdPos ? i : i + 1 };
              return;
            }
            mdPos += 1;
          } else {
            const hasMarker = node.previousElementSibling && node.previousElementSibling.classList?.contains('md-marker');
            let prefixLen = 0;
            let suffixLen = 0;
            if (!hasMarker && !node.classList?.contains('md-marker')) {
              if (tag === 'strong' || tag === 'b') { prefixLen = 2; suffixLen = 2; }
              else if (tag === 'em' || tag === 'i') { prefixLen = 1; suffixLen = 1; }
              else if (tag === 'code') { prefixLen = 1; suffixLen = 1; }
              else if (tag === 'del' || tag === 's') { prefixLen = 2; suffixLen = 2; }
              else if (tag === 'mark') { prefixLen = 2; suffixLen = 2; }
              else if (tag === 'a') {
                prefixLen = 1;
                suffixLen = 3 + (node.getAttribute('href') || '').length;
              }
            }
            if (targetMdOffset <= mdPos + prefixLen) {
              found = { node: parent, offset: i };
              return;
            }
            mdPos += prefixLen;
            walk(node);
            if (found) return;
            if (targetMdOffset <= mdPos + suffixLen) {
              found = { node: parent, offset: i + 1 };
              return;
            }
            mdPos += suffixLen;
          }
        }
      }
    }

    walk(el);
    if (found) return found;
    return { node: el, offset: (el.childNodes || []).length };
  }

  function createDomRangeForMarkdownSlice(el, startMdOffset, endMdOffset) {
    if (!el || endMdOffset <= startMdOffset) return null;
    try {
      const pStart = domPointFromMarkdownOffset(el, startMdOffset);
      const pEnd = domPointFromMarkdownOffset(el, endMdOffset);
      const r = document.createRange();
      r.setStart(pStart.node, pStart.offset);
      r.setEnd(pEnd.node, pEnd.offset);
      return r;
    } catch (e) {
      return null;
    }
  }

  function extractMarkdownWithCaret(el) {
    const full = Parser.extractInlineMarkdownFromElement(el);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      return { full, start: full.length, end: full.length };
    }
    const range = sel.getRangeAt(0);
    const start = Math.min(full.length, measureMarkdownOffsetInElement(el, range.startContainer, range.startOffset));
    const end = range.collapsed
      ? start
      : Math.min(full.length, measureMarkdownOffsetInElement(el, range.endContainer, range.endOffset));
    return { full, start, end };
  }

  function applyDesiredCaretToEditable(el, fallback = 'end') {
    const programmatic = el._pendingProgrammaticCaret;
    delete el._pendingProgrammaticCaret;

    if (programmatic !== undefined) {
      if (programmatic === 'start') {
        placeCaretAtStart(el);
      } else if (programmatic === 'end') {
        placeCaretAtEnd(el);
      } else if (typeof programmatic === 'number') {
        try {
          const pt = domPointFromMarkdownOffset(el, programmatic);
          const range = document.createRange();
          range.setStart(pt.node, pt.offset);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {
          setCaretCharacterOffsetWithin(el, programmatic);
        }
      }
      return;
    }

    if (el._clickPt && Date.now() - el._clickPt.ts < 450 && document.caretRangeFromPoint) {
      const pt = el._clickPt;
      el._clickPt = null;
      try {
        const hitRange = document.caretRangeFromPoint(pt.x, pt.y);
        if (hitRange && el.contains(hitRange.startContainer)) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(hitRange);
          return;
        }
      } catch (e) {}
    }

    if (fallback === 'start') placeCaretAtStart(el);
    else placeCaretAtEnd(el);
  }

  function isCaretNearTopOfEditable(el) {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
    if (getCaretCharacterOffsetWithin(el) === 0) return true;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    if (!rects || rects.length === 0) return false;
    const elRect = el.getBoundingClientRect();
    return rects[0].top <= elRect.top + 14;
  }

  function isCaretNearBottomOfEditable(el) {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
    const totalLen = (el.textContent || '').length;
    if (getCaretCharacterOffsetWithin(el) >= totalLen) return true;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    if (!rects || rects.length === 0) return false;
    const elRect = el.getBoundingClientRect();
    return rects[rects.length - 1].bottom >= elRect.bottom - 14;
  }

  function bindTextBlockEvents(el, block) {
    el.addEventListener('mousedown', e => {
      if (e.button === 0) {
        el._clickPt = { x: e.clientX, y: e.clientY, ts: Date.now() };
      }
    });

    el.addEventListener('focus', () => {
      const prevActive = state.activeBlockId;
      setActiveBlock(block.id);
      if (prevActive !== block.id && state.revealInlineSyntax) {
        renderEditableContent(el, block.text, true);
        applyDesiredCaretToEditable(el, 'end');
      } else if (el._pendingProgrammaticCaret !== undefined) {
        applyDesiredCaretToEditable(el, 'end');
      }
      if (state.typewriterMode) {
        centerElementInViewport(el);
      }
    });

    el.addEventListener('blur', () => {
      block.text = Parser.extractInlineMarkdownFromElement(el);
      renderEditableContent(el, block.text, false);
    });

    el.addEventListener('input', () => {
      recordUndoSnapshot('type:' + block.id);
      const raw = Parser.extractInlineMarkdownFromElement(el);
      block.text = raw;

      // Check Slash command trigger on empty paragraph
      if (block.type === 'paragraph' && raw === '/') {
        openSlashMenuForBlock(el.closest('.mk-block'));
      } else if (state.slashMenuOpen) {
        closeSlashMenu();
      }

      // Check Live Markdown block prefix triggers!
      if (checkLivePrefixTrigger(block, raw)) {
        return;
      }

      markDirtyAndSync(block.type === 'heading');
      if (state.typewriterMode) {
        centerElementInViewport(el);
      }
    });

    el.addEventListener('keydown', e => {
      if (state.slashMenuOpen) {
        if (handleSlashMenuKeydown(e)) return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        el.blur();
        selectSingleBlock(block.id);
        return;
      }

      // Shift + Arrow across block boundaries -> Character-accurate Cross-Block Text Selection
      if (
        e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        if (tryStartCrossRangeFromEditableKey(el, block, null, e.key)) {
          e.preventDefault();
          return;
        }
      }

      // Smooth Cross-Block ArrowUp / ArrowDown Navigation
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.altKey) {
        if (isCaretNearTopOfEditable(el)) {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx > 0) {
            e.preventDefault();
            focusBlockById(state.blocks[idx - 1].id, 'end');
            return;
          }
        }
      } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.metaKey && !e.altKey) {
        if (isCaretNearBottomOfEditable(el)) {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx >= 0 && idx < state.blocks.length - 1) {
            e.preventDefault();
            focusBlockById(state.blocks[idx + 1].id, 'start');
            return;
          }
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const { full, start, end } = extractMarkdownWithCaret(el);
        const trimmed = full.trim();

        // Check if user typed ```lang, $$, ---, or ![alt](src) and pressed Enter
        const codeFenceMatch = trimmed.match(/^```([a-zA-Z0-9_+-]*)$/);
        if (codeFenceMatch) {
          const lang = codeFenceMatch[1] || 'javascript';
          if (lang.toLowerCase() === 'mermaid') {
            transformBlockById(block.id, 'mermaid', {
              code: 'flowchart LR\n    A["输入"] --> B["处理"]'
            });
          } else {
            transformBlockById(block.id, 'code', { lang, code: '' });
          }
          return;
        }
        if (trimmed === '$$') {
          state.editingSpecialId = block.id;
          transformBlockById(block.id, 'math', { latex: '' });
          return;
        }
        if (trimmed === '---' || trimmed === '***') {
          transformBlockById(block.id, 'hr', {});
          insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
          return;
        }
        const imgSyntax = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imgSyntax) {
          transformBlockById(block.id, 'image', {
            alt: imgSyntax[1],
            src: imgSyntax[2],
            width: '100%'
          });
          return;
        }

        // Split current block at caret position (left stays, right moves to new paragraph)
        recordUndoSnapshot();
        const leftPart = full.slice(0, start);
        const rightPart = full.slice(end);
        block.text = leftPart;
        renderEditableContent(el, block.text, false);

        const nextBlk = { id: Parser.nextBlockId(), type: 'paragraph', text: rightPart };
        insertBlockAfter(block.id, nextBlk, 'start', true);
      } else if (e.key === 'Backspace') {
        const { full, start, end } = extractMarkdownWithCaret(el);
        const isCollapsedAtStart = start === 0 && end === 0;

        if (isCollapsedAtStart) {
          if (block.type !== 'paragraph') {
            e.preventDefault();
            transformBlockById(block.id, 'paragraph', { text: full });
            focusBlockById(block.id, 'start');
            return;
          }

          const idx = state.blocks.findIndex(b => b.id === block.id);
          // Leading empty first paragraph when document has more blocks below
          if (idx === 0 && full === '' && state.blocks.length > 1) {
            e.preventDefault();
            recordUndoSnapshot();
            state.blocks.splice(0, 1);
            state.activeBlockId = state.blocks[0].id;
            markDirtyAndSync(true);
            renderCanvas();
            focusBlockById(state.blocks[0].id, 'start');
            return;
          }

          if (idx > 0) {
            const prevBlock = state.blocks[idx - 1];
            if (
              prevBlock.type === 'paragraph' ||
              prevBlock.type === 'heading' ||
              prevBlock.type === 'blockquote' ||
              prevBlock.type === 'callout'
            ) {
              e.preventDefault();
              recordUndoSnapshot();
              const joinOffset = (prevBlock.text || '').length;
              prevBlock.text = (prevBlock.text || '') + full;
              state.blocks.splice(idx, 1);
              state.activeBlockId = prevBlock.id;
              markDirtyAndSync(true);
              renderCanvas();
              focusBlockById(prevBlock.id, joinOffset);
              return;
            } else if (prevBlock.type === 'ulist' || prevBlock.type === 'olist') {
              e.preventDefault();
              recordUndoSnapshot();
              const lastIdx = Math.max(0, (prevBlock.items?.length || 1) - 1);
              const joinOffset = (prevBlock.items[lastIdx] || '').length;
              prevBlock.items[lastIdx] = (prevBlock.items[lastIdx] || '') + full;
              state.blocks.splice(idx, 1);
              state.activeBlockId = prevBlock.id;
              markDirtyAndSync(false);
              renderCanvas();
              focusListItem(prevBlock.id, lastIdx, joinOffset);
              return;
            } else if (prevBlock.type === 'tasklist') {
              e.preventDefault();
              recordUndoSnapshot();
              const lastIdx = Math.max(0, (prevBlock.items?.length || 1) - 1);
              const joinOffset = (prevBlock.items[lastIdx]?.text || '').length;
              prevBlock.items[lastIdx].text = (prevBlock.items[lastIdx]?.text || '') + full;
              state.blocks.splice(idx, 1);
              state.activeBlockId = prevBlock.id;
              markDirtyAndSync(false);
              renderCanvas();
              focusListItem(prevBlock.id, lastIdx, joinOffset);
              return;
            } else {
              // Previous block is a special block (hr, table, mermaid, math, code, image):
              // Select it so pressing Backspace once more cleanly deletes that special block!
              e.preventDefault();
              el.blur();
              if (full === '' && idx < state.blocks.length - 1) {
                recordUndoSnapshot();
                state.blocks.splice(idx, 1);
                markDirtyAndSync(false);
                renderCanvas();
              }
              selectSingleBlock(prevBlock.id);
              return;
            }
          }
        }
      } else if (e.key === 'Delete') {
        const { full, start, end } = extractMarkdownWithCaret(el);
        const isCollapsedAtEnd = start === full.length && end === full.length;
        if (isCollapsedAtEnd) {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx >= 0 && idx < state.blocks.length - 1) {
            if (full === '' && block.type === 'paragraph') {
              e.preventDefault();
              recordUndoSnapshot();
              const nextId = state.blocks[idx + 1].id;
              state.blocks.splice(idx, 1);
              state.activeBlockId = nextId;
              markDirtyAndSync(true);
              renderCanvas();
              focusBlockById(nextId, 'start');
              return;
            }
            const nextBlock = state.blocks[idx + 1];
            if (
              nextBlock.type === 'paragraph' ||
              nextBlock.type === 'heading' ||
              nextBlock.type === 'blockquote' ||
              nextBlock.type === 'callout'
            ) {
              e.preventDefault();
              recordUndoSnapshot();
              const joinOffset = full.length;
              block.text = full + (nextBlock.text || '');
              state.blocks.splice(idx + 1, 1);
              ensureTrailingParagraph();
              markDirtyAndSync(true);
              renderCanvas();
              focusBlockById(block.id, joinOffset);
              return;
            } else if (nextBlock.type === 'ulist' || nextBlock.type === 'olist') {
              e.preventDefault();
              recordUndoSnapshot();
              const joinOffset = full.length;
              const firstItem = nextBlock.items?.[0] || '';
              block.text = full + firstItem;
              if ((nextBlock.items?.length || 0) <= 1) {
                state.blocks.splice(idx + 1, 1);
              } else {
                nextBlock.items.shift();
              }
              markDirtyAndSync(false);
              renderCanvas();
              focusBlockById(block.id, joinOffset);
              return;
            } else if (nextBlock.type === 'tasklist') {
              e.preventDefault();
              recordUndoSnapshot();
              const joinOffset = full.length;
              const firstTask = nextBlock.items?.[0]?.text || '';
              block.text = full + firstTask;
              if ((nextBlock.items?.length || 0) <= 1) {
                state.blocks.splice(idx + 1, 1);
              } else {
                nextBlock.items.shift();
              }
              markDirtyAndSync(false);
              renderCanvas();
              focusBlockById(block.id, joinOffset);
              return;
            } else {
              e.preventDefault();
              el.blur();
              selectSingleBlock(nextBlock.id);
              return;
            }
          }
        }
      }
    });
  }

  function checkLivePrefixTrigger(block, raw) {
    // 1. Heading trigger: # .. ###### followed by space
    const hMatch = raw.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const rest = hMatch[2];
      transformBlockById(block.id, 'heading', { level, text: rest });
      return true;
    }

    if (block.type !== 'paragraph') return false;

    // 2. Task List trigger: - [ ] or - [x] followed by space
    const taskMatch = raw.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      transformBlockById(block.id, 'tasklist', {
        items: [{ checked: taskMatch[1].toLowerCase() === 'x', text: taskMatch[2] }]
      });
      return true;
    }

    // 3. Unordered List trigger: - or * followed by space
    const ulMatch = raw.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      transformBlockById(block.id, 'ulist', { items: [ulMatch[1]] });
      return true;
    }

    // 4. Ordered List trigger: 1. followed by space
    const olMatch = raw.match(/^1\.\s+(.*)$/);
    if (olMatch) {
      transformBlockById(block.id, 'olist', { items: [olMatch[1]] });
      return true;
    }

    // 5. Blockquote trigger: > followed by space
    const bqMatch = raw.match(/^>\s+(.*)$/);
    if (bqMatch) {
      transformBlockById(block.id, 'blockquote', { text: bqMatch[1] });
      return true;
    }

    // 6. Horizontal Rule: --- or *** followed by space
    if (/^(?:---|\*\*\*)\s+$/.test(raw)) {
      transformBlockById(block.id, 'hr', {});
      insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' });
      return true;
    }

    return false;
  }

  function bindListItemEvents(el, block, itemIdx) {
    el.addEventListener('mousedown', e => {
      if (e.button === 0) {
        el._clickPt = { x: e.clientX, y: e.clientY, ts: Date.now() };
      }
    });

    el.addEventListener('focus', () => {
      setActiveBlock(block.id);
      renderEditableContent(el, block.items[itemIdx], state.revealInlineSyntax);
      applyDesiredCaretToEditable(el, 'end');
    });

    el.addEventListener('blur', () => {
      block.items[itemIdx] = Parser.extractInlineMarkdownFromElement(el);
      renderEditableContent(el, block.items[itemIdx], false);
    });

    el.addEventListener('input', () => {
      recordUndoSnapshot(`list:${block.id}:${itemIdx}`);
      block.items[itemIdx] = Parser.extractInlineMarkdownFromElement(el);
      markDirtyAndSync(false);
    });

    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        el.blur();
        selectSingleBlock(block.id);
        return;
      }
      if (
        e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        if (tryStartCrossRangeFromEditableKey(el, block, itemIdx, e.key)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'ArrowUp' && !e.shiftKey && isCaretNearTopOfEditable(el)) {
        e.preventDefault();
        if (itemIdx > 0) {
          focusListItem(block.id, itemIdx - 1, 'end');
        } else {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx > 0) focusBlockById(state.blocks[idx - 1].id, 'end');
        }
        return;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && isCaretNearBottomOfEditable(el)) {
        e.preventDefault();
        if (itemIdx < block.items.length - 1) {
          focusListItem(block.id, itemIdx + 1, 'start');
        } else {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx >= 0 && idx < state.blocks.length - 1) focusBlockById(state.blocks[idx + 1].id, 'start');
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const { full, start, end } = extractMarkdownWithCaret(el);
        if (full.trim() === '') {
          recordUndoSnapshot();
          if (block.items.length === 1) {
            transformBlockById(block.id, 'paragraph', { text: '' });
          } else {
            block.items.splice(itemIdx, 1);
            replaceBlockDOM(block);
            insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start', true);
          }
          return;
        }
        recordUndoSnapshot();
        block.items[itemIdx] = full.slice(0, start);
        block.items.splice(itemIdx + 1, 0, full.slice(end));
        markDirtyAndSync(false);
        replaceBlockDOM(block);
        focusListItem(block.id, itemIdx + 1, 'start');
      } else if (e.key === 'Backspace') {
        const { full, start, end } = extractMarkdownWithCaret(el);
        if (start === 0 && end === 0) {
          e.preventDefault();
          if (itemIdx > 0) {
            recordUndoSnapshot();
            const joinOffset = (block.items[itemIdx - 1] || '').length;
            block.items[itemIdx - 1] = (block.items[itemIdx - 1] || '') + full;
            block.items.splice(itemIdx, 1);
            markDirtyAndSync(false);
            replaceBlockDOM(block);
            focusListItem(block.id, itemIdx - 1, joinOffset);
          } else if (block.items.length === 1) {
            transformBlockById(block.id, 'paragraph', { text: full });
            focusBlockById(block.id, 'start');
          } else {
            // Split item 0 out into a normal paragraph right above the remaining list!
            recordUndoSnapshot();
            block.items.splice(0, 1);
            const newPara = { id: Parser.nextBlockId(), type: 'paragraph', text: full };
            insertBlockBefore(block.id, newPara, 'start', true);
          }
        }
      } else if (e.key === 'Delete') {
        const { full, start, end } = extractMarkdownWithCaret(el);
        if (start === full.length && end === full.length) {
          if (itemIdx < block.items.length - 1) {
            e.preventDefault();
            recordUndoSnapshot();
            const joinOffset = full.length;
            block.items[itemIdx] = full + (block.items[itemIdx + 1] || '');
            block.items.splice(itemIdx + 1, 1);
            markDirtyAndSync(false);
            replaceBlockDOM(block);
            focusListItem(block.id, itemIdx, joinOffset);
          } else {
            const idx = state.blocks.findIndex(b => b.id === block.id);
            if (idx >= 0 && idx < state.blocks.length - 1) {
              const nextBlk = state.blocks[idx + 1];
              e.preventDefault();
              if (nextBlk.type === 'paragraph' || nextBlk.type === 'heading' || nextBlk.type === 'blockquote') {
                recordUndoSnapshot();
                const joinOffset = full.length;
                block.items[itemIdx] = full + (nextBlk.text || '');
                state.blocks.splice(idx + 1, 1);
                ensureTrailingParagraph();
                markDirtyAndSync(true);
                renderCanvas();
                focusListItem(block.id, itemIdx, joinOffset);
              } else {
                el.blur();
                selectSingleBlock(nextBlk.id);
              }
            }
          }
        }
      }
    });
  }

  function bindTaskItemEvents(el, block, itemIdx) {
    el.addEventListener('mousedown', e => {
      if (e.button === 0) {
        el._clickPt = { x: e.clientX, y: e.clientY, ts: Date.now() };
      }
    });

    el.addEventListener('focus', () => {
      setActiveBlock(block.id);
      renderEditableContent(el, block.items[itemIdx].text, state.revealInlineSyntax);
      applyDesiredCaretToEditable(el, 'end');
    });

    el.addEventListener('blur', () => {
      block.items[itemIdx].text = Parser.extractInlineMarkdownFromElement(el);
      renderEditableContent(el, block.items[itemIdx].text, false);
    });

    el.addEventListener('input', () => {
      recordUndoSnapshot(`task:${block.id}:${itemIdx}`);
      block.items[itemIdx].text = Parser.extractInlineMarkdownFromElement(el);
      markDirtyAndSync(false);
    });

    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        el.blur();
        selectSingleBlock(block.id);
        return;
      }
      if (
        e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        if (tryStartCrossRangeFromEditableKey(el, block, itemIdx, e.key)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'ArrowUp' && !e.shiftKey && isCaretNearTopOfEditable(el)) {
        e.preventDefault();
        if (itemIdx > 0) {
          focusListItem(block.id, itemIdx - 1, 'end');
        } else {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx > 0) focusBlockById(state.blocks[idx - 1].id, 'end');
        }
        return;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && isCaretNearBottomOfEditable(el)) {
        e.preventDefault();
        if (itemIdx < block.items.length - 1) {
          focusListItem(block.id, itemIdx + 1, 'start');
        } else {
          const idx = state.blocks.findIndex(b => b.id === block.id);
          if (idx >= 0 && idx < state.blocks.length - 1) focusBlockById(state.blocks[idx + 1].id, 'start');
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const { full, start, end } = extractMarkdownWithCaret(el);
        if (full.trim() === '') {
          recordUndoSnapshot();
          if (block.items.length === 1) {
            transformBlockById(block.id, 'paragraph', { text: '' });
          } else {
            block.items.splice(itemIdx, 1);
            replaceBlockDOM(block);
            insertBlockAfter(block.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start', true);
          }
          return;
        }
        recordUndoSnapshot();
        block.items[itemIdx].text = full.slice(0, start);
        block.items.splice(itemIdx + 1, 0, { checked: false, text: full.slice(end) });
        markDirtyAndSync(false);
        replaceBlockDOM(block);
        focusListItem(block.id, itemIdx + 1, 'start');
      } else if (e.key === 'Backspace') {
        const { full, start, end } = extractMarkdownWithCaret(el);
        if (start === 0 && end === 0) {
          e.preventDefault();
          if (itemIdx > 0) {
            recordUndoSnapshot();
            const joinOffset = (block.items[itemIdx - 1].text || '').length;
            block.items[itemIdx - 1].text = (block.items[itemIdx - 1].text || '') + full;
            block.items.splice(itemIdx, 1);
            markDirtyAndSync(false);
            replaceBlockDOM(block);
            focusListItem(block.id, itemIdx - 1, joinOffset);
          } else if (block.items.length === 1) {
            transformBlockById(block.id, 'paragraph', { text: full });
            focusBlockById(block.id, 'start');
          } else {
            recordUndoSnapshot();
            block.items.splice(0, 1);
            const newPara = { id: Parser.nextBlockId(), type: 'paragraph', text: full };
            insertBlockBefore(block.id, newPara, 'start', true);
          }
        }
      } else if (e.key === 'Delete') {
        const { full, start, end } = extractMarkdownWithCaret(el);
        if (start === full.length && end === full.length) {
          if (itemIdx < block.items.length - 1) {
            e.preventDefault();
            recordUndoSnapshot();
            const joinOffset = full.length;
            block.items[itemIdx].text = full + (block.items[itemIdx + 1]?.text || '');
            block.items.splice(itemIdx + 1, 1);
            markDirtyAndSync(false);
            replaceBlockDOM(block);
            focusListItem(block.id, itemIdx, joinOffset);
          } else {
            const idx = state.blocks.findIndex(b => b.id === block.id);
            if (idx >= 0 && idx < state.blocks.length - 1) {
              const nextBlk = state.blocks[idx + 1];
              e.preventDefault();
              if (nextBlk.type === 'paragraph' || nextBlk.type === 'heading' || nextBlk.type === 'blockquote') {
                recordUndoSnapshot();
                const joinOffset = full.length;
                block.items[itemIdx].text = full + (nextBlk.text || '');
                state.blocks.splice(idx + 1, 1);
                ensureTrailingParagraph();
                markDirtyAndSync(true);
                renderCanvas();
                focusListItem(block.id, itemIdx, joinOffset);
              } else {
                el.blur();
                selectSingleBlock(nextBlk.id);
              }
            }
          }
        }
      }
    });
  }

  function focusListItem(blockId, itemIdx, caretTarget = 'end') {
    requestAnimationFrame(() => {
      const blkEl = document.querySelector(`[data-block-id="${blockId}"]`);
      if (!blkEl) return;
      const items = blkEl.querySelectorAll('.mk-editable');
      const target = items[itemIdx];
      if (target) {
        target._pendingProgrammaticCaret = caretTarget;
        target.focus();
        if (target._pendingProgrammaticCaret !== undefined) {
          applyDesiredCaretToEditable(target, caretTarget === 'start' ? 'start' : 'end');
        }
      }
    });
  }

  /* ==========================================================================
   * BLOCK MANIPULATION HELPERS
   * ========================================================================== */

  function setActiveBlock(blockId) {
    state.activeBlockId = blockId;
    document.querySelectorAll('.mk-block.is-active').forEach(el => {
      if (el.dataset.blockId !== blockId) {
        el.classList.remove('is-active');
      }
    });
    const nextEl = document.querySelector(`[data-block-id="${blockId}"]`);
    if (nextEl) {
      nextEl.classList.add('is-active');
    }
    updateStatusBar();
  }

  function transformActiveBlock(newType, extraProps = {}) {
    closeSlashMenu();
    const targetId = state.activeBlockId || state.blocks[0]?.id;
    if (!targetId) return;
    transformBlockById(targetId, newType, extraProps);
  }

  function transformBlockById(blockId, newType, extraProps = {}) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;

    recordUndoSnapshot();
    const oldBlock = state.blocks[idx];
    const baseText = oldBlock.text === '/' ? '' : (oldBlock.text || '');

    const updated = {
      id: oldBlock.id,
      type: newType,
      ...extraProps
    };

    if (newType === 'heading') {
      updated.level = extraProps.level || 2;
      updated.text = extraProps.text !== undefined ? extraProps.text : baseText;
    } else if (newType === 'paragraph' || newType === 'blockquote') {
      updated.text = extraProps.text !== undefined ? extraProps.text : baseText;
    } else if (newType === 'callout') {
      updated.calloutType = extraProps.calloutType || 'NOTE';
      updated.text = extraProps.text !== undefined ? extraProps.text : (baseText || '在此输入提示内容');
    } else if (newType === 'ulist' || newType === 'olist') {
      updated.items = extraProps.items || [baseText];
    } else if (newType === 'tasklist') {
      updated.items = extraProps.items || [{ checked: false, text: baseText }];
    } else if (newType === 'code') {
      updated.lang = extraProps.lang || 'javascript';
      updated.code = extraProps.code !== undefined ? extraProps.code : baseText;
    } else if (newType === 'math') {
      updated.latex = extraProps.latex !== undefined ? extraProps.latex : baseText;
      state.editingSpecialId = updated.id;
    } else if (newType === 'mermaid') {
      updated.code = extraProps.code || 'flowchart LR\n    A["开始"] --> B["结束"]';
      state.editingSpecialId = updated.id;
    } else if (newType === 'table') {
      updated.headers = extraProps.headers || ['列 1', '列 2', '列 3'];
      updated.aligns = extraProps.aligns || ['left', 'left', 'left'];
      updated.rows = extraProps.rows || [['内容 1', '内容 2', '内容 3']];
    } else if (newType === 'image') {
      updated.alt = extraProps.alt || '';
      updated.src = extraProps.src || '';
      updated.width = extraProps.width || '100%';
    }

    state.blocks[idx] = updated;
    if (idx === state.blocks.length - 1 && isSpecialBlockType(updated.type)) {
      ensureTrailingParagraph();
      markDirtyAndSync(true);
      renderCanvas();
    } else {
      markDirtyAndSync(true);
      replaceBlockDOM(updated);
    }
    focusBlockById(updated.id, 'end');
  }

  function insertBlockAfter(afterBlockId, newBlock, caretTarget = 'end', skipUndo = false) {
    if (!skipUndo) recordUndoSnapshot();
    const idx = state.blocks.findIndex(b => b.id === afterBlockId);
    const insertIdx = idx === -1 ? state.blocks.length : idx + 1;
    state.blocks.splice(insertIdx, 0, newBlock);
    state.activeBlockId = newBlock.id;
    markDirtyAndSync(true);
    renderCanvas();
    focusBlockById(newBlock.id, caretTarget);
  }

  function insertBlockBefore(beforeBlockId, newBlock, caretTarget = 'start', skipUndo = false) {
    if (!skipUndo) recordUndoSnapshot();
    const idx = state.blocks.findIndex(b => b.id === beforeBlockId);
    const insertIdx = idx === -1 ? 0 : idx;
    state.blocks.splice(insertIdx, 0, newBlock);
    state.activeBlockId = newBlock.id;
    markDirtyAndSync(true);
    renderCanvas();
    focusBlockById(newBlock.id, caretTarget);
  }

  function stepDownFromSpecialBlock(blockId) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx >= 0 && idx < state.blocks.length - 1) {
      focusBlockById(state.blocks[idx + 1].id, 'start');
    } else {
      insertBlockAfter(blockId, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
    }
  }

  function deleteBlock(blockId) {
    recordUndoSnapshot();
    clearBlockSelection(false);
    if (state.blocks.length <= 1) {
      state.blocks[0] = { id: Parser.nextBlockId(), type: 'paragraph', text: '' };
      state.activeBlockId = state.blocks[0].id;
      markDirtyAndSync(true);
      renderCanvas();
      focusBlockById(state.blocks[0].id, 'start');
      return;
    }
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    state.blocks.splice(idx, 1);
    ensureTrailingParagraph();
    const nextIdx = Math.min(Math.max(0, idx - 1), state.blocks.length - 1);
    const targetBlock = state.blocks[nextIdx];
    state.activeBlockId = targetBlock.id;
    markDirtyAndSync(true);
    renderCanvas();
    focusBlockById(targetBlock.id, idx === 0 ? 'start' : 'end');
  }

  /* ==========================================================================
   * CROSS-BLOCK SELECTION & MULTI-BLOCK OPERATIONS ENGINE
   * ========================================================================== */

  function hasBlockSelection() {
    return state.selectedBlockIds && state.selectedBlockIds.size > 0;
  }

  function getSelectedBlockIndices() {
    if (!hasBlockSelection()) return [];
    const indices = [];
    state.blocks.forEach((blk, idx) => {
      if (state.selectedBlockIds.has(blk.id)) {
        indices.push(idx);
      }
    });
    return indices;
  }

  function getSelectedBlocksOrdered() {
    return getSelectedBlockIndices().map(idx => state.blocks[idx]);
  }

  function getSelectedBlocksMarkdown() {
    const blocks = getSelectedBlocksOrdered();
    if (blocks.length === 0) return '';
    return Parser.serializeBlocksToMarkdown(blocks);
  }

  function syncBlockSelectionUI(focusBridge = true) {
    const canvas = document.getElementById('wysiwyg-canvas');
    if (canvas) {
      canvas.querySelectorAll(':scope > .mk-block').forEach(el => {
        el.classList.toggle('is-selected', state.selectedBlockIds.has(el.dataset.blockId));
      });
    }

    const bar = document.getElementById('block-selection-bar');
    const countEl = document.getElementById('block-sel-count');
    const bridge = document.getElementById('block-selection-bridge');

    if (!hasBlockSelection() || state.sourceMode) {
      bar?.classList.add('hidden');
      return;
    }

    hideFloatingToolbar();
    try {
      window.getSelection()?.removeAllRanges();
    } catch (e) {}

    if (countEl) {
      const n = state.selectedBlockIds.size;
      countEl.textContent = n === state.blocks.length && n > 1
        ? `已全选 ${n} 个块`
        : `已选中 ${n} 个块`;
    }
    bar?.classList.remove('hidden');

    if (focusBridge && bridge) {
      const serialized = getSelectedBlocksMarkdown();
      bridge.value = serialized || '\n';
      try {
        bridge.focus({ preventScroll: true });
      } catch (e) {
        bridge.focus();
      }
      bridge.setSelectionRange(0, bridge.value.length);
    }
  }

  /* ==========================================================================
   * CHARACTER-ACCURATE CROSS-BLOCK TEXT SELECTION ENGINE
   * ========================================================================== */

  function hasCrossRange() {
    return Boolean(state.crossRange && state.crossRange.anchor && state.crossRange.focus);
  }

  function getListItemText(block, idx) {
    if (!block || !Array.isArray(block.items) || idx < 0 || idx >= block.items.length) return '';
    return block.type === 'tasklist' ? (block.items[idx]?.text || '') : (block.items[idx] || '');
  }

  function setListItemText(block, idx, val) {
    if (!block || !Array.isArray(block.items) || idx < 0 || idx >= block.items.length) return;
    if (block.type === 'tasklist') {
      block.items[idx].text = val;
    } else {
      block.items[idx] = val;
    }
  }

  function getTableCellText(block, rowIdx, colIdx) {
    if (!block || block.type !== 'table') return '';
    if (rowIdx === -1) return block.headers?.[colIdx] || '';
    return block.rows?.[rowIdx]?.[colIdx] || '';
  }

  function setTableCellText(block, rowIdx, colIdx, val) {
    if (!block || block.type !== 'table') return;
    if (rowIdx === -1) {
      if (block.headers && colIdx < block.headers.length) block.headers[colIdx] = val;
    } else if (block.rows?.[rowIdx] && colIdx < block.rows[rowIdx].length) {
      block.rows[rowIdx][colIdx] = val;
    }
  }

  function makeBlockBoundaryEndpoint(blockIdx, atEnd = false) {
    const block = state.blocks[blockIdx];
    if (!block) return null;
    const t = block.type;
    if (t === 'paragraph' || t === 'heading' || t === 'blockquote' || t === 'callout') {
      const len = (block.text || '').length;
      return { blockId: block.id, blockIdx, kind: 'editable', mdOffset: atEnd ? len : 0 };
    }
    if (t === 'ulist' || t === 'olist' || t === 'tasklist') {
      const count = Math.max(1, (block.items || []).length);
      const itemIdx = atEnd ? count - 1 : 0;
      const len = getListItemText(block, itemIdx).length;
      return {
        blockId: block.id,
        blockIdx,
        kind: t === 'tasklist' ? 'taskitem' : 'listitem',
        itemIdx,
        mdOffset: atEnd ? len : 0
      };
    }
    if (t === 'code') {
      const len = (block.code || '').length;
      return { blockId: block.id, blockIdx, kind: 'code', codeOffset: atEnd ? len : 0 };
    }
    if (t === 'table') {
      const cols = Math.max(1, (block.headers || []).length);
      const rows = (block.rows || []).length;
      const rowIdx = atEnd ? rows - 1 : -1;
      const colIdx = atEnd ? cols - 1 : 0;
      const len = getTableCellText(block, rowIdx, colIdx).length;
      return { blockId: block.id, blockIdx, kind: 'table', rowIdx, colIdx, mdOffset: atEnd ? len : 0 };
    }
    return { blockId: block.id, blockIdx, kind: 'special', edge: atEnd ? 'after' : 'before' };
  }

  function refreshEndpointIndex(ep) {
    if (!ep) return null;
    const idx = state.blocks.findIndex(b => b.id === ep.blockId);
    if (idx === -1) return null;
    return { ...ep, blockIdx: idx };
  }

  function compareEndpoints(a, b) {
    if (!a || !b) return 0;
    if (a.blockIdx !== b.blockIdx) return a.blockIdx - b.blockIdx;
    if ((a.kind === 'listitem' || a.kind === 'taskitem') && (b.kind === 'listitem' || b.kind === 'taskitem')) {
      if (a.itemIdx !== b.itemIdx) return a.itemIdx - b.itemIdx;
      return (a.mdOffset || 0) - (b.mdOffset || 0);
    }
    if (a.kind === 'table' && b.kind === 'table') {
      if (a.rowIdx !== b.rowIdx) return a.rowIdx - b.rowIdx;
      if (a.colIdx !== b.colIdx) return a.colIdx - b.colIdx;
      return (a.mdOffset || 0) - (b.mdOffset || 0);
    }
    if (a.kind === 'code' && b.kind === 'code') {
      return (a.codeOffset || 0) - (b.codeOffset || 0);
    }
    if (a.kind === 'special' && b.kind === 'special') {
      if (a.edge === b.edge) return 0;
      return a.edge === 'before' ? -1 : 1;
    }
    return (a.mdOffset || 0) - (b.mdOffset || 0);
  }

  function isSameSubEditable(a, b) {
    if (!a || !b || a.blockId !== b.blockId || a.kind !== b.kind) return false;
    if (a.kind === 'special') return false;
    if (a.kind === 'listitem' || a.kind === 'taskitem') return a.itemIdx === b.itemIdx;
    if (a.kind === 'table') return a.rowIdx === b.rowIdx && a.colIdx === b.colIdx;
    return true;
  }

  function normalizeCrossRange(cr = state.crossRange) {
    if (!cr || !cr.anchor || !cr.focus) return null;
    const anchor = refreshEndpointIndex(cr.anchor);
    const focus = refreshEndpointIndex(cr.focus);
    if (!anchor || !focus) return null;
    const cmp = compareEndpoints(anchor, focus);
    return cmp <= 0
      ? { start: anchor, end: focus, reversed: false, collapsed: cmp === 0 }
      : { start: focus, end: anchor, reversed: true, collapsed: false };
  }

  function isEndpointAtBlockStart(ep) {
    if (!ep) return false;
    if (ep.kind === 'editable') return (ep.mdOffset || 0) <= 0;
    if (ep.kind === 'listitem' || ep.kind === 'taskitem') return ep.itemIdx === 0 && (ep.mdOffset || 0) <= 0;
    if (ep.kind === 'code') return (ep.codeOffset || 0) <= 0;
    if (ep.kind === 'table') return ep.rowIdx === -1 && ep.colIdx === 0 && (ep.mdOffset || 0) <= 0;
    if (ep.kind === 'special') return ep.edge === 'before';
    return false;
  }

  function isEndpointAtBlockEnd(ep) {
    const block = state.blocks[ep?.blockIdx];
    if (!block) return false;
    if (ep.kind === 'editable') return (ep.mdOffset || 0) >= (block.text || '').length;
    if (ep.kind === 'listitem' || ep.kind === 'taskitem') {
      const last = Math.max(0, (block.items || []).length - 1);
      return ep.itemIdx >= last && (ep.mdOffset || 0) >= getListItemText(block, last).length;
    }
    if (ep.kind === 'code') return (ep.codeOffset || 0) >= (block.code || '').length;
    if (ep.kind === 'table') {
      const lastRow = (block.rows || []).length - 1;
      const lastCol = Math.max(0, (block.headers || []).length - 1);
      return ep.rowIdx >= lastRow && ep.colIdx >= lastCol && (ep.mdOffset || 0) >= getTableCellText(block, lastRow, lastCol).length;
    }
    if (ep.kind === 'special') return ep.edge === 'after';
    return false;
  }

  function measureMdOffsetFromPointInEditable(el, clientX, clientY, fallbackFullLen) {
    if (!el || !document.caretRangeFromPoint) return 0;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return 0;
    if (clientY < r.top - 4) return 0;
    if (clientY > r.bottom + 4) return fallbackFullLen;
    const px = Math.min(Math.max(clientX, r.left + 2), Math.max(r.left + 2, r.right - 2));
    const py = Math.min(Math.max(clientY, r.top + 2), Math.max(r.top + 2, r.bottom - 2));
    try {
      const hit = document.caretRangeFromPoint(px, py);
      if (hit && el.contains(hit.startContainer)) {
        return Math.min(fallbackFullLen, measureMarkdownOffsetInElement(el, hit.startContainer, hit.startOffset));
      }
    } catch (e) {}
    return clientX <= r.left ? 0 : fallbackFullLen;
  }

  function resolveEndpointFromPoint(clientX, clientY) {
    const canvas = document.getElementById('wysiwyg-canvas');
    if (!canvas || state.blocks.length === 0) return null;
    const blockEls = Array.from(canvas.querySelectorAll(':scope > .mk-block'));
    if (blockEls.length === 0) return null;

    const firstRect = blockEls[0].getBoundingClientRect();
    if (clientY < firstRect.top) {
      return makeBlockBoundaryEndpoint(0, false);
    }
    const lastIdx = Math.min(blockEls.length, state.blocks.length) - 1;
    const lastRect = blockEls[lastIdx].getBoundingClientRect();
    if (clientY > lastRect.bottom) {
      return makeBlockBoundaryEndpoint(lastIdx, true);
    }

    let hitIdx = 0;
    for (let i = 0; i <= lastIdx; i++) {
      const r = blockEls[i].getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        hitIdx = i;
        break;
      }
      if (i < lastIdx) {
        const rNext = blockEls[i + 1].getBoundingClientRect();
        if (clientY > r.bottom && clientY < rNext.top) {
          return makeBlockBoundaryEndpoint(i, true);
        }
      }
    }

    const wrapper = blockEls[hitIdx];
    const block = state.blocks[hitIdx];
    if (!wrapper || !block) return null;
    const t = block.type;

    if (t === 'paragraph' || t === 'heading' || t === 'blockquote' || t === 'callout') {
      const el = wrapper.querySelector('.mk-editable');
      const fullLen = (block.text || '').length;
      const mdOffset = el ? measureMdOffsetFromPointInEditable(el, clientX, clientY, fullLen) : 0;
      return { blockId: block.id, blockIdx: hitIdx, kind: 'editable', mdOffset };
    }

    if (t === 'ulist' || t === 'olist' || t === 'tasklist') {
      const itemEls = Array.from(wrapper.querySelectorAll('.mk-editable'));
      if (itemEls.length === 0) return makeBlockBoundaryEndpoint(hitIdx, false);
      let chosen = 0;
      for (let k = 0; k < itemEls.length; k++) {
        const ir = itemEls[k].closest('li')?.getBoundingClientRect() || itemEls[k].getBoundingClientRect();
        if (clientY <= ir.bottom || k === itemEls.length - 1) {
          chosen = k;
          break;
        }
      }
      const fullLen = getListItemText(block, chosen).length;
      const mdOffset = measureMdOffsetFromPointInEditable(itemEls[chosen], clientX, clientY, fullLen);
      return {
        blockId: block.id,
        blockIdx: hitIdx,
        kind: t === 'tasklist' ? 'taskitem' : 'listitem',
        itemIdx: chosen,
        mdOffset
      };
    }

    if (t === 'table') {
      const theadCells = Array.from(wrapper.querySelectorAll('thead th'));
      const bodyRows = Array.from(wrapper.querySelectorAll('tbody tr'));
      const allRowEls = [
        { rowIdx: -1, cells: theadCells },
        ...bodyRows.map((tr, idx) => ({ rowIdx: idx, cells: Array.from(tr.querySelectorAll('td')) }))
      ].filter(r => r.cells.length > 0);
      if (allRowEls.length === 0) return makeBlockBoundaryEndpoint(hitIdx, false);

      let chosenRow = allRowEls[0];
      for (const rowObj of allRowEls) {
        const rr = rowObj.cells[0].parentElement?.getBoundingClientRect() || rowObj.cells[0].getBoundingClientRect();
        if (clientY <= rr.bottom) {
          chosenRow = rowObj;
          break;
        }
        chosenRow = rowObj;
      }
      let chosenColIdx = 0;
      for (let c = 0; c < chosenRow.cells.length; c++) {
        const cr = chosenRow.cells[c].getBoundingClientRect();
        if (clientX <= cr.right || c === chosenRow.cells.length - 1) {
          chosenColIdx = c;
          break;
        }
      }
      const cellEl = chosenRow.cells[chosenColIdx];
      const fullLen = getTableCellText(block, chosenRow.rowIdx, chosenColIdx).length;
      const mdOffset = measureMdOffsetFromPointInEditable(cellEl, clientX, clientY, fullLen);
      return { blockId: block.id, blockIdx: hitIdx, kind: 'table', rowIdx: chosenRow.rowIdx, colIdx: chosenColIdx, mdOffset };
    }

    if (t === 'code') {
      const ta = wrapper.querySelector('.mk-code-textarea');
      const code = block.code || '';
      if (!ta) return { blockId: block.id, blockIdx: hitIdx, kind: 'code', codeOffset: 0 };
      const tr = ta.getBoundingClientRect();
      if (clientY <= tr.top + 4) return { blockId: block.id, blockIdx: hitIdx, kind: 'code', codeOffset: 0 };
      if (clientY >= tr.bottom - 4) return { blockId: block.id, blockIdx: hitIdx, kind: 'code', codeOffset: code.length };
      const lines = code.split('\n');
      const lineH = 22.5;
      const padTop = 12;
      const padLeft = 14;
      const approxCharW = 8.1;
      const lineIdx = Math.min(lines.length - 1, Math.max(0, Math.floor((clientY - tr.top - padTop + (ta.scrollTop || 0)) / lineH)));
      const colIdx = Math.min(lines[lineIdx].length, Math.max(0, Math.round((clientX - tr.left - padLeft) / approxCharW)));
      let offset = 0;
      for (let l = 0; l < lineIdx; l++) offset += lines[l].length + 1;
      offset += colIdx;
      return { blockId: block.id, blockIdx: hitIdx, kind: 'code', codeOffset: Math.min(code.length, offset) };
    }

    const wr = wrapper.getBoundingClientRect();
    const edge = clientY < wr.top + wr.height * 0.42 ? 'before' : 'after';
    return { blockId: block.id, blockIdx: hitIdx, kind: 'special', edge };
  }

  function getCurrentCaretEndpoint(useAnchor = true) {
    const activeEl = document.activeElement;
    const canvas = document.getElementById('wysiwyg-canvas');
    if (!activeEl || !canvas || !canvas.contains(activeEl)) {
      const fallbackIdx = Math.max(0, state.blocks.findIndex(b => b.id === state.activeBlockId));
      return state.blocks[fallbackIdx] ? makeBlockBoundaryEndpoint(fallbackIdx, false) : null;
    }

    const wrapper = activeEl.closest('.mk-block');
    const blockIdx = state.blocks.findIndex(b => b.id === wrapper?.dataset.blockId);
    if (blockIdx === -1) return null;
    const block = state.blocks[blockIdx];

    if (activeEl.classList.contains('mk-code-textarea') && block.type === 'code') {
      const off = useAnchor ? (activeEl.selectionStart || 0) : (activeEl.selectionEnd || 0);
      return { blockId: block.id, blockIdx, kind: 'code', codeOffset: off };
    }

    const sel = window.getSelection();
    const calcOffset = el => {
      const full = Parser.extractInlineMarkdownFromElement(el);
      if (!sel || sel.rangeCount === 0) return full.length;
      const node = useAnchor ? sel.anchorNode : sel.focusNode;
      const off = useAnchor ? sel.anchorOffset : sel.focusOffset;
      if (!node || !el.contains(node)) return full.length;
      return Math.min(full.length, measureMarkdownOffsetInElement(el, node, off));
    };

    if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'blockquote' || block.type === 'callout') {
      return { blockId: block.id, blockIdx, kind: 'editable', mdOffset: calcOffset(activeEl) };
    }
    if (block.type === 'ulist' || block.type === 'olist' || block.type === 'tasklist') {
      const itemEls = Array.from(wrapper.querySelectorAll('.mk-editable'));
      const itemIdx = Math.max(0, itemEls.indexOf(activeEl));
      return {
        blockId: block.id,
        blockIdx,
        kind: block.type === 'tasklist' ? 'taskitem' : 'listitem',
        itemIdx,
        mdOffset: calcOffset(activeEl)
      };
    }
    if (block.type === 'table' && (activeEl.tagName === 'TH' || activeEl.tagName === 'TD')) {
      const tr = activeEl.parentElement;
      const colIdx = Math.max(0, Array.from(tr.children).indexOf(activeEl));
      const rowIdx = activeEl.tagName === 'TH'
        ? -1
        : Math.max(0, Array.from(wrapper.querySelectorAll('tbody tr')).indexOf(tr));
      return { blockId: block.id, blockIdx, kind: 'table', rowIdx, colIdx, mdOffset: calcOffset(activeEl) };
    }
    return makeBlockBoundaryEndpoint(blockIdx, false);
  }

  function clearCrossRangeVisuals() {
    try {
      if (typeof CSS !== 'undefined' && CSS.highlights) {
        CSS.highlights.delete('mk-cross-sel');
      }
    } catch (e) {}
    const overlay = document.getElementById('cross-selection-overlay');
    if (overlay) overlay.innerHTML = '';
    const canvas = document.getElementById('wysiwyg-canvas');
    if (canvas) {
      canvas.querySelectorAll(':scope > .mk-block.is-range-covered').forEach(el => {
        el.classList.remove('is-range-covered');
      });
    }
  }

  function collectCrossRangeDomPieces(norm) {
    const domRanges = [];
    const coveredBlockIds = new Set();
    const canvas = document.getElementById('wysiwyg-canvas');
    if (!canvas || !norm || norm.collapsed) return { domRanges, coveredBlockIds };

    const { start, end } = norm;
    for (let idx = start.blockIdx; idx <= end.blockIdx; idx++) {
      const block = state.blocks[idx];
      if (!block) continue;
      const wrapper = canvas.querySelector(`[data-block-id="${block.id}"]`);
      if (!wrapper) continue;
      const isFirst = idx === start.blockIdx;
      const isLast = idx === end.blockIdx;
      const t = block.type;

      if (t === 'paragraph' || t === 'heading' || t === 'blockquote' || t === 'callout') {
        const el = wrapper.querySelector('.mk-editable');
        if (!el) continue;
        const fullLen = (block.text || '').length;
        const sOff = isFirst ? (start.mdOffset || 0) : 0;
        const eOff = isLast ? (end.mdOffset || 0) : fullLen;
        if (eOff > sOff) {
          const r = createDomRangeForMarkdownSlice(el, sOff, eOff);
          if (r) domRanges.push(r);
        }
      } else if (t === 'ulist' || t === 'olist' || t === 'tasklist') {
        const itemEls = Array.from(wrapper.querySelectorAll('.mk-editable'));
        const sItem = isFirst ? (start.itemIdx || 0) : 0;
        const eItem = isLast ? (end.itemIdx ?? itemEls.length - 1) : itemEls.length - 1;
        for (let k = sItem; k <= eItem && k < itemEls.length; k++) {
          const fullLen = getListItemText(block, k).length;
          const sOff = isFirst && k === sItem ? (start.mdOffset || 0) : 0;
          const eOff = isLast && k === eItem ? (end.mdOffset || 0) : fullLen;
          if (eOff > sOff) {
            const r = createDomRangeForMarkdownSlice(itemEls[k], sOff, eOff);
            if (r) domRanges.push(r);
          }
        }
      } else if (t === 'table') {
        const theadCells = Array.from(wrapper.querySelectorAll('thead th'));
        const bodyRows = Array.from(wrapper.querySelectorAll('tbody tr'));
        const allRows = [
          { rowIdx: -1, cells: theadCells },
          ...bodyRows.map((tr, rIdx) => ({ rowIdx: rIdx, cells: Array.from(tr.querySelectorAll('td')) }))
        ];
        const sRow = isFirst ? (start.rowIdx ?? -1) : -1;
        const eRow = isLast ? (end.rowIdx ?? bodyRows.length - 1) : bodyRows.length - 1;
        allRows.forEach(rowObj => {
          if (rowObj.rowIdx < sRow || rowObj.rowIdx > eRow) return;
          const sCol = isFirst && rowObj.rowIdx === sRow ? (start.colIdx || 0) : 0;
          const eCol = isLast && rowObj.rowIdx === eRow ? (end.colIdx ?? rowObj.cells.length - 1) : rowObj.cells.length - 1;
          for (let c = sCol; c <= eCol && c < rowObj.cells.length; c++) {
            const fullLen = getTableCellText(block, rowObj.rowIdx, c).length;
            const sOff = isFirst && rowObj.rowIdx === sRow && c === sCol ? (start.mdOffset || 0) : 0;
            const eOff = isLast && rowObj.rowIdx === eRow && c === eCol ? (end.mdOffset || 0) : fullLen;
            if (eOff > sOff) {
              const r = createDomRangeForMarkdownSlice(rowObj.cells[c], sOff, eOff);
              if (r) domRanges.push(r);
            }
          }
        });
        if (!isFirst && !isLast) {
          coveredBlockIds.add(block.id);
        }
      } else if (t === 'code') {
        const fullLen = (block.code || '').length;
        const sOff = isFirst ? (start.codeOffset || 0) : 0;
        const eOff = isLast ? (end.codeOffset ?? fullLen) : fullLen;
        if (eOff > sOff || (!isFirst && !isLast)) {
          coveredBlockIds.add(block.id);
        }
      } else {
        const includeSpecial = (!isFirst || start.edge === 'before') && (!isLast || end.edge === 'after');
        if (includeSpecial) {
          coveredBlockIds.add(block.id);
        }
      }
    }
    return { domRanges, coveredBlockIds };
  }

  function syncCrossRangeUI(focusBridge = true) {
    const norm = normalizeCrossRange();
    if (!norm || norm.collapsed || state.sourceMode) {
      clearCrossRangeVisuals();
      return;
    }

    if (focusBridge) {
      // Ensure any previously focused editable blurs FIRST so its DOM stabilizes before building Range highlights
      const bridge = document.getElementById('block-selection-bridge');
      if (bridge) {
        bridge.value = extractCrossRangeMarkdown() || ' ';
        try {
          bridge.focus({ preventScroll: true });
        } catch (e) {
          bridge.focus();
        }
        bridge.setSelectionRange(0, bridge.value.length);
      }
    }

    try {
      window.getSelection()?.removeAllRanges();
    } catch (e) {}

    const { domRanges, coveredBlockIds } = collectCrossRangeDomPieces(norm);
    const canvas = document.getElementById('wysiwyg-canvas');
    if (canvas) {
      canvas.querySelectorAll(':scope > .mk-block').forEach(el => {
        el.classList.toggle('is-range-covered', coveredBlockIds.has(el.dataset.blockId));
      });
    }

    let usedNativeHighlight = false;
    try {
      if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
        if (domRanges.length > 0) {
          CSS.highlights.set('mk-cross-sel', new Highlight(...domRanges));
        } else {
          CSS.highlights.delete('mk-cross-sel');
        }
        usedNativeHighlight = true;
      }
    } catch (e) {}

    const overlay = document.getElementById('cross-selection-overlay');
    const scroller = document.getElementById('editor-scroll-container');
    if (overlay && scroller) {
      overlay.innerHTML = '';
      if (!usedNativeHighlight && domRanges.length > 0) {
        const sr = scroller.getBoundingClientRect();
        const frag = document.createDocumentFragment ? document.createDocumentFragment() : overlay;
        domRanges.forEach(r => {
          const rects = r.getClientRects ? Array.from(r.getClientRects()) : [];
          rects.forEach(rc => {
            if (rc.width <= 0 || rc.height <= 0) return;
            const box = document.createElement('div');
            box.className = 'cross-sel-rect';
            box.style.top = `${rc.top - sr.top + scroller.scrollTop}px`;
            box.style.left = `${rc.left - sr.left + scroller.scrollLeft}px`;
            box.style.width = `${rc.width}px`;
            box.style.height = `${rc.height}px`;
            frag.appendChild(box);
          });
        });
        if (frag !== overlay) overlay.appendChild(frag);
      }
    }

    if (focusBridge && domRanges.length > 0) {
      const toolbar = document.getElementById('floating-toolbar');
      const rect = domRanges[0].getBoundingClientRect?.();
      if (toolbar && rect && rect.width > 0) {
        toolbar.style.top = `${Math.max(12, rect.top - 46)}px`;
        toolbar.style.left = `${Math.max(16, rect.left + rect.width / 2 - 140)}px`;
        toolbar.classList.add('visible');
      }
    }
  }

  function clearCrossRange(restoreFocus = false) {
    const had = hasCrossRange();
    const prevFocus = state.crossRange?.focus ? refreshEndpointIndex(state.crossRange.focus) : null;
    state.crossRange = null;
    if (had) {
      clearCrossRangeVisuals();
      hideFloatingToolbar();
    }
    if (restoreFocus && prevFocus) {
      focusAtEndpoint(prevFocus);
    }
  }

  function setCrossRange(anchorEp, focusEp, focusBridge = true) {
    if (!anchorEp || !focusEp) return;
    if (hasBlockSelection()) {
      if (state.selectedBlockIds) state.selectedBlockIds.clear();
      state.selectionAnchorBlockId = null;
      state.selectionFocusBlockId = null;
      syncBlockSelectionUI(false);
    }
    closeSlashMenu();
    state.crossRange = { anchor: anchorEp, focus: focusEp };
    state.activeBlockId = focusEp.blockId;
    setActiveBlock(focusEp.blockId);
    syncCrossRangeUI(focusBridge);
  }

  function focusAtEndpoint(ep) {
    const refreshed = refreshEndpointIndex(ep);
    if (!refreshed) return;
    const block = state.blocks[refreshed.blockIdx];
    if (!block) return;

    if (refreshed.kind === 'listitem' || refreshed.kind === 'taskitem') {
      focusListItem(block.id, refreshed.itemIdx || 0, refreshed.mdOffset || 0);
      return;
    }
    if (refreshed.kind === 'code') {
      focusBlockById(block.id, refreshed.codeOffset || 0);
      return;
    }
    if (refreshed.kind === 'editable') {
      focusBlockById(block.id, refreshed.mdOffset || 0);
      return;
    }
    focusBlockById(block.id, refreshed.edge === 'after' ? 'end' : 'start');
  }

  function restoreIntraEditableSelectionFromCrossRange() {
    const norm = normalizeCrossRange();
    if (!norm || !isSameSubEditable(norm.start, norm.end)) return false;
    const { start, end } = norm;
    clearCrossRange(false);
    const canvas = document.getElementById('wysiwyg-canvas');
    const wrapper = canvas?.querySelector(`[data-block-id="${start.blockId}"]`);
    if (!wrapper) return false;

    if (start.kind === 'code') {
      const ta = wrapper.querySelector('.mk-code-textarea');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(start.codeOffset || 0, end.codeOffset || 0);
        return true;
      }
      return false;
    }

    let el = null;
    if (start.kind === 'editable') {
      el = wrapper.querySelector('.mk-editable');
    } else if (start.kind === 'listitem' || start.kind === 'taskitem') {
      el = wrapper.querySelectorAll('.mk-editable')[start.itemIdx || 0];
    } else if (start.kind === 'table') {
      el = start.rowIdx === -1
        ? wrapper.querySelectorAll('thead th')[start.colIdx || 0]
        : wrapper.querySelectorAll('tbody tr')[start.rowIdx]?.querySelectorAll('td')[start.colIdx || 0];
    }
    if (!el) return false;

    el.focus();
    const r = createDomRangeForMarkdownSlice(el, start.mdOffset || 0, end.mdOffset || 0);
    if (r) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      updateFloatingToolbar();
      return true;
    }
    return false;
  }

  function extractCrossRangeMarkdown() {
    const norm = normalizeCrossRange();
    if (!norm || norm.collapsed) return '';
    const { start, end } = norm;

    const serializeListSlice = (block, sItem, sOff, eItem, eOff) => {
      const lines = [];
      for (let k = sItem; k <= eItem && k < (block.items || []).length; k++) {
        const full = getListItemText(block, k);
        const sub = full.slice(k === sItem ? sOff : 0, k === eItem ? eOff : full.length);
        if (sItem === eItem) return sub;
        if (block.type === 'olist') lines.push(`${k + 1}. ${sub}`);
        else if (block.type === 'tasklist') lines.push(`- [${block.items[k]?.checked ? 'x' : ' '}] ${sub}`);
        else lines.push(`- ${sub}`);
      }
      return lines.join('\n');
    };

    if (start.blockIdx === end.blockIdx) {
      const blk = state.blocks[start.blockIdx];
      if (!blk) return '';
      if (blk.type === 'paragraph' || blk.type === 'heading' || blk.type === 'blockquote' || blk.type === 'callout') {
        return (blk.text || '').slice(start.mdOffset || 0, end.mdOffset || 0);
      }
      if (blk.type === 'ulist' || blk.type === 'olist' || blk.type === 'tasklist') {
        return serializeListSlice(blk, start.itemIdx || 0, start.mdOffset || 0, end.itemIdx || 0, end.mdOffset || 0);
      }
      if (blk.type === 'code') {
        return (blk.code || '').slice(start.codeOffset || 0, end.codeOffset || 0);
      }
      return Parser.serializeBlocksToMarkdown([blk]);
    }

    const parts = [];
    for (let idx = start.blockIdx; idx <= end.blockIdx; idx++) {
      const blk = state.blocks[idx];
      if (!blk) continue;
      const isFirst = idx === start.blockIdx;
      const isLast = idx === end.blockIdx;
      const t = blk.type;

      if (!isFirst && !isLast) {
        parts.push(Parser.serializeBlocksToMarkdown([blk]));
        continue;
      }

      if (t === 'paragraph') {
        const txt = blk.text || '';
        parts.push(isFirst ? txt.slice(start.mdOffset || 0) : txt.slice(0, end.mdOffset || 0));
      } else if (t === 'heading') {
        const txt = blk.text || '';
        const slice = isFirst ? txt.slice(start.mdOffset || 0) : txt.slice(0, end.mdOffset || 0);
        const includePrefix = isFirst ? (start.mdOffset || 0) === 0 : (end.mdOffset || 0) > 0;
        parts.push(includePrefix ? `${'#'.repeat(blk.level || 1)} ${slice}` : slice);
      } else if (t === 'blockquote') {
        const txt = blk.text || '';
        const slice = isFirst ? txt.slice(start.mdOffset || 0) : txt.slice(0, end.mdOffset || 0);
        parts.push((isFirst && (start.mdOffset || 0) > 0) ? slice : `> ${slice}`);
      } else if (t === 'callout') {
        const txt = blk.text || '';
        if (isFirst && (start.mdOffset || 0) === 0) {
          parts.push(Parser.serializeBlocksToMarkdown([blk]));
        } else {
          parts.push(isFirst ? txt.slice(start.mdOffset || 0) : txt.slice(0, end.mdOffset || 0));
        }
      } else if (t === 'ulist' || t === 'olist' || t === 'tasklist') {
        const lastK = Math.max(0, (blk.items || []).length - 1);
        if (isFirst) {
          parts.push(serializeListSlice(blk, start.itemIdx || 0, start.mdOffset || 0, lastK, getListItemText(blk, lastK).length));
        } else {
          parts.push(serializeListSlice(blk, 0, 0, end.itemIdx || 0, end.mdOffset || 0));
        }
      } else if (t === 'code') {
        const code = blk.code || '';
        const sub = isFirst ? code.slice(start.codeOffset || 0) : code.slice(0, end.codeOffset || 0);
        parts.push('```' + (blk.lang || '') + '\n' + sub + (sub.endsWith('\n') ? '' : '\n') + '```');
      } else {
        const include = isFirst ? start.edge === 'before' : end.edge === 'after';
        if (include) {
          parts.push(Parser.serializeBlocksToMarkdown([blk]));
        }
      }
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function isTextMergeableType(type) {
    return type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'callout';
  }

  function deleteCrossRange(replacementInlineText = null) {
    const norm = normalizeCrossRange();
    if (!norm || norm.collapsed) return false;
    const { start, end } = norm;
    const ins = replacementInlineText !== null ? String(replacementInlineText) : '';

    recordUndoSnapshot();
    clearCrossRange(false);

    // Case 1: Same block (e.g. multi-item list selection or multi-cell table selection)
    if (start.blockIdx === end.blockIdx) {
      const blk = state.blocks[start.blockIdx];
      if (!blk) return false;
      if (blk.type === 'ulist' || blk.type === 'olist' || blk.type === 'tasklist') {
        const sItem = start.itemIdx || 0;
        const eItem = end.itemIdx || 0;
        const left = getListItemText(blk, sItem).slice(0, start.mdOffset || 0);
        const right = getListItemText(blk, eItem).slice(end.mdOffset || 0);
        const merged = left + ins + right;
        setListItemText(blk, sItem, merged);
        if (eItem > sItem) {
          blk.items.splice(sItem + 1, eItem - sItem);
        }
        if (blk.items.length === 1 && merged === '' && replacementInlineText === null) {
          state.blocks.splice(start.blockIdx, 1, { id: blk.id, type: 'paragraph', text: '' });
          ensureTrailingParagraph();
          state.activeBlockId = blk.id;
          markDirtyAndSync(true);
          renderCanvas();
          focusBlockById(blk.id, 0);
          return true;
        }
        markDirtyAndSync(false);
        renderCanvas();
        focusListItem(blk.id, sItem, (left + ins).length);
        return true;
      }
      if (blk.type === 'table') {
        if (isEndpointAtBlockStart(start) && isEndpointAtBlockEnd(end) && replacementInlineText === null) {
          deleteBlock(blk.id);
          return true;
        }
        const rowsCount = (blk.rows || []).length;
        const colsCount = (blk.headers || []).length;
        for (let r = start.rowIdx; r <= end.rowIdx; r++) {
          const cStart = r === start.rowIdx ? start.colIdx : 0;
          const cEnd = r === end.rowIdx ? end.colIdx : colsCount - 1;
          for (let c = cStart; c <= cEnd; c++) {
            const cur = getTableCellText(blk, r, c);
            const sOff = r === start.rowIdx && c === start.colIdx ? (start.mdOffset || 0) : 0;
            const eOff = r === end.rowIdx && c === end.colIdx ? (end.mdOffset || 0) : cur.length;
            const fill = r === start.rowIdx && c === start.colIdx ? ins : '';
            setTableCellText(blk, r, c, cur.slice(0, sOff) + fill + cur.slice(eOff));
          }
        }
        markDirtyAndSync(false);
        renderCanvas();
        focusBlockById(blk.id, 'start');
        return true;
      }
      if (isTextMergeableType(blk.type)) {
        const left = (blk.text || '').slice(0, start.mdOffset || 0);
        const right = (blk.text || '').slice(end.mdOffset || 0);
        blk.text = left + ins + right;
        markDirtyAndSync(blk.type === 'heading');
        renderCanvas();
        focusBlockById(blk.id, (left + ins).length);
        return true;
      }
    }

    // Case 2: Cross-block range (start.blockIdx < end.blockIdx)
    const bStart = state.blocks[start.blockIdx];
    const bEnd = state.blocks[end.blockIdx];
    const startAtZero = isEndpointAtBlockStart(start);
    const endAtMax = isEndpointAtBlockEnd(end);

    // 2A: Both bStart and bEnd are text-like (paragraph, heading, blockquote, callout) -> Seamless Merge!
    if (isTextMergeableType(bStart.type) && isTextMergeableType(bEnd.type)) {
      const left = (bStart.text || '').slice(0, start.mdOffset || 0);
      const right = (bEnd.text || '').slice(end.mdOffset || 0);
      const caretOff = (left + ins).length;

      // If user selected from very start of a heading/blockquote into a paragraph and hit Backspace,
      // adopt bEnd's block style when right text survives (Word / Typora standard behavior).
      let mergedBlock = { ...bStart, text: left + ins + right };
      if (startAtZero && !endAtMax && bStart.type !== bEnd.type) {
        mergedBlock = { ...bEnd, id: bStart.id, text: left + ins + right };
      } else if (startAtZero && endAtMax && replacementInlineText === null) {
        // Entire bStart .. bEnd selected from 0 to end: delete completely (unless sole remaining content)
        state.blocks.splice(start.blockIdx, end.blockIdx - start.blockIdx + 1);
        if (state.blocks.length === 0) {
          const fresh = { id: Parser.nextBlockId(), type: 'paragraph', text: '' };
          state.blocks = [fresh];
          state.activeBlockId = fresh.id;
          markDirtyAndSync(true);
          renderCanvas();
          focusBlockById(fresh.id, 0);
          return true;
        }
        ensureTrailingParagraph();
        const targetIdx = Math.min(Math.max(0, start.blockIdx - 1), state.blocks.length - 1);
        const targetBlk = state.blocks[targetIdx];
        state.activeBlockId = targetBlk.id;
        markDirtyAndSync(true);
        renderCanvas();
        focusBlockById(targetBlk.id, start.blockIdx === 0 ? 'start' : 'end');
        return true;
      }

      state.blocks.splice(start.blockIdx, end.blockIdx - start.blockIdx + 1, mergedBlock);
      ensureTrailingParagraph();
      state.activeBlockId = mergedBlock.id;
      markDirtyAndSync(true);
      renderCanvas();
      focusBlockById(mergedBlock.id, caretOff);
      return true;
    }

    // 2B: List <-> Text or List <-> List cross-block merge
    const startIsList = bStart.type === 'ulist' || bStart.type === 'olist' || bStart.type === 'tasklist';
    const endIsList = bEnd.type === 'ulist' || bEnd.type === 'olist' || bEnd.type === 'tasklist';

    if (startIsList && (isTextMergeableType(bEnd.type) || endIsList) && !(startAtZero && endAtMax && replacementInlineText === null)) {
      const sItem = start.itemIdx || 0;
      const left = getListItemText(bStart, sItem).slice(0, start.mdOffset || 0);
      const right = endIsList
        ? getListItemText(bEnd, end.itemIdx || 0).slice(end.mdOffset || 0)
        : (bEnd.text || '').slice(end.mdOffset || 0);
      const caretOff = (left + ins).length;

      bStart.items = bStart.items.slice(0, sItem + 1);
      setListItemText(bStart, sItem, left + ins + right);

      if (endIsList && bEnd.type === bStart.type && (end.itemIdx || 0) + 1 < bEnd.items.length) {
        bStart.items.push(...bEnd.items.slice((end.itemIdx || 0) + 1));
        state.blocks.splice(start.blockIdx + 1, end.blockIdx - start.blockIdx);
      } else if (endIsList && (end.itemIdx || 0) + 1 < bEnd.items.length) {
        bEnd.items = bEnd.items.slice((end.itemIdx || 0) + 1);
        state.blocks.splice(start.blockIdx + 1, end.blockIdx - start.blockIdx - 1);
      } else {
        state.blocks.splice(start.blockIdx + 1, end.blockIdx - start.blockIdx);
      }

      ensureTrailingParagraph();
      state.activeBlockId = bStart.id;
      markDirtyAndSync(true);
      renderCanvas();
      focusListItem(bStart.id, sItem, caretOff);
      return true;
    }

    if (isTextMergeableType(bStart.type) && endIsList && !(startAtZero && endAtMax && replacementInlineText === null)) {
      const left = (bStart.text || '').slice(0, start.mdOffset || 0);
      const eItem = end.itemIdx || 0;
      const right = getListItemText(bEnd, eItem).slice(end.mdOffset || 0);
      const caretOff = (left + ins).length;
      bStart.text = left + ins + right;

      if (eItem + 1 < bEnd.items.length) {
        bEnd.items = bEnd.items.slice(eItem + 1);
        state.blocks.splice(start.blockIdx + 1, end.blockIdx - start.blockIdx - 1);
      } else {
        state.blocks.splice(start.blockIdx + 1, end.blockIdx - start.blockIdx);
      }

      ensureTrailingParagraph();
      state.activeBlockId = bStart.id;
      markDirtyAndSync(true);
      renderCanvas();
      focusBlockById(bStart.id, caretOff);
      return true;
    }

    // 2C: Heterogeneous cross-block selection involving Code / Table / Mermaid / Math / Image / HR
    const survivors = [];
    let focusTargetId = null;
    let focusTargetOffset = 'end';

    // Handle left remainder of bStart
    if (isTextMergeableType(bStart.type)) {
      if (!startAtZero || replacementInlineText !== null) {
        const left = (bStart.text || '').slice(0, start.mdOffset || 0);
        bStart.text = left + ins;
        survivors.push(bStart);
        focusTargetId = bStart.id;
        focusTargetOffset = bStart.text.length;
      }
    } else if (startIsList) {
      if (!startAtZero || replacementInlineText !== null) {
        const sItem = start.itemIdx || 0;
        bStart.items = bStart.items.slice(0, sItem + 1);
        setListItemText(bStart, sItem, getListItemText(bStart, sItem).slice(0, start.mdOffset || 0) + ins);
        survivors.push(bStart);
        focusTargetId = bStart.id;
        focusTargetOffset = 'end';
      }
    } else if (bStart.type === 'code') {
      if (!startAtZero || replacementInlineText !== null) {
        bStart.code = (bStart.code || '').slice(0, start.codeOffset || 0) + ins;
        survivors.push(bStart);
        focusTargetId = bStart.id;
        focusTargetOffset = bStart.code.length;
      }
    } else if (bStart.type === 'special' || start.kind === 'special') {
      if (start.edge === 'after') {
        survivors.push(bStart);
      }
      if (replacementInlineText !== null) {
        const p = { id: Parser.nextBlockId(), type: 'paragraph', text: ins };
        survivors.push(p);
        focusTargetId = p.id;
        focusTargetOffset = ins.length;
      }
    } else if (bStart.type === 'table' && !startAtZero) {
      const rowsCount = (bStart.rows || []).length;
      const colsCount = (bStart.headers || []).length;
      for (let r = start.rowIdx; r < rowsCount; r++) {
        const cStart = r === start.rowIdx ? start.colIdx : 0;
        for (let c = cStart; c < colsCount; c++) {
          const cur = getTableCellText(bStart, r, c);
          const sOff = r === start.rowIdx && c === start.colIdx ? (start.mdOffset || 0) : 0;
          setTableCellText(bStart, r, c, cur.slice(0, sOff));
        }
      }
      survivors.push(bStart);
    }

    // Handle right remainder of bEnd
    if (isTextMergeableType(bEnd.type)) {
      if (!endAtMax) {
        const right = (bEnd.text || '').slice(end.mdOffset || 0);
        if (survivors.length === 1 && isTextMergeableType(survivors[0].type)) {
          const joinAt = survivors[0].text.length;
          survivors[0].text += right;
          focusTargetId = survivors[0].id;
          focusTargetOffset = joinAt;
        } else {
          bEnd.text = right;
          if (!focusTargetId) {
            focusTargetId = bEnd.id;
            focusTargetOffset = 0;
          }
          survivors.push(bEnd);
        }
      } else if (!focusTargetId && replacementInlineText !== null) {
        const p = { id: Parser.nextBlockId(), type: 'paragraph', text: ins };
        survivors.push(p);
        focusTargetId = p.id;
        focusTargetOffset = ins.length;
      }
    } else if (endIsList && !endAtMax) {
      const eItem = end.itemIdx || 0;
      setListItemText(bEnd, eItem, getListItemText(bEnd, eItem).slice(end.mdOffset || 0));
      bEnd.items = bEnd.items.slice(eItem);
      if (!focusTargetId) {
        focusTargetId = bEnd.id;
        focusTargetOffset = 'start';
      }
      survivors.push(bEnd);
    } else if (bEnd.type === 'code' && !endAtMax) {
      if (survivors.length === 1 && survivors[0].type === 'code') {
        const joinAt = survivors[0].code.length;
        survivors[0].code += (bEnd.code || '').slice(end.codeOffset || 0);
        focusTargetId = survivors[0].id;
        focusTargetOffset = joinAt;
      } else {
        bEnd.code = (bEnd.code || '').slice(end.codeOffset || 0);
        if (!focusTargetId) {
          focusTargetId = bEnd.id;
          focusTargetOffset = 0;
        }
        survivors.push(bEnd);
      }
    } else if (end.kind === 'special' && end.edge === 'before') {
      survivors.push(bEnd);
    } else if (bEnd.type === 'table' && !endAtMax) {
      const colsCount = (bEnd.headers || []).length;
      for (let r = -1; r <= end.rowIdx; r++) {
        const cEnd = r === end.rowIdx ? end.colIdx : colsCount - 1;
        for (let c = 0; c <= cEnd; c++) {
          const cur = getTableCellText(bEnd, r, c);
          const eOff = r === end.rowIdx && c === end.colIdx ? (end.mdOffset || 0) : cur.length;
          setTableCellText(bEnd, r, c, cur.slice(eOff));
        }
      }
      survivors.push(bEnd);
    }

    state.blocks.splice(start.blockIdx, end.blockIdx - start.blockIdx + 1, ...survivors);
    if (state.blocks.length === 0) {
      const fresh = { id: Parser.nextBlockId(), type: 'paragraph', text: ins };
      state.blocks = [fresh];
      focusTargetId = fresh.id;
      focusTargetOffset = ins.length;
    }

    ensureTrailingParagraph();
    if (!focusTargetId) {
      const nextIdx = Math.min(Math.max(0, start.blockIdx), state.blocks.length - 1);
      focusTargetId = state.blocks[nextIdx].id;
      focusTargetOffset = 'start';
    }
    state.activeBlockId = focusTargetId;
    markDirtyAndSync(true);
    renderCanvas();
    focusBlockById(focusTargetId, focusTargetOffset);
    return true;
  }

  function replaceCrossRangeWithMarkdown(rawText) {
    const normalized = String(rawText || '').replace(/\r\n/g, '\n');
    if (!normalized.includes('\n')) {
      return deleteCrossRange(normalized);
    }
    const parsed = Parser.parseMarkdownToBlocks(normalized);
    if (parsed.length === 0) {
      return deleteCrossRange('');
    }
    if (parsed.length === 1 && parsed[0].type === 'paragraph') {
      return deleteCrossRange(parsed[0].text || '');
    }

    // Delete cross range leaving caret at exact join point, then splice multi-block Markdown cleanly
    const norm = normalizeCrossRange();
    if (!norm) return false;
    const { start, end } = norm;
    const bStart = state.blocks[start.blockIdx];
    const bEnd = state.blocks[end.blockIdx];

    if (isTextMergeableType(bStart?.type) && isTextMergeableType(bEnd?.type)) {
      recordUndoSnapshot();
      clearCrossRange(false);
      const left = (bStart.text || '').slice(0, start.mdOffset || 0);
      const right = (bEnd.text || '').slice(end.mdOffset || 0);
      const toInsert = [];
      if (left !== '') {
        if (parsed[0].type === 'paragraph') {
          parsed[0] = { ...bStart, id: bStart.id, text: left + (parsed[0].text || '') };
        } else {
          toInsert.push({ ...bStart, id: bStart.id, text: left });
        }
      }
      toInsert.push(...parsed);
      const lastNew = toInsert[toInsert.length - 1];
      let caretTarget = 'end';
      if (right !== '') {
        if (isTextMergeableType(lastNew.type)) {
          caretTarget = (lastNew.text || '').length;
          lastNew.text = (lastNew.text || '') + right;
        } else {
          toInsert.push({ ...bEnd, id: Parser.nextBlockId(), text: right });
          caretTarget = 0;
        }
      }
      state.blocks.splice(start.blockIdx, end.blockIdx - start.blockIdx + 1, ...toInsert);
      ensureTrailingParagraph();
      const focusBlk = toInsert[toInsert.length - 1];
      state.activeBlockId = focusBlk.id;
      markDirtyAndSync(true);
      renderCanvas();
      focusBlockById(focusBlk.id, caretTarget);
      return true;
    }

    deleteCrossRange('');
    const activeIdx = Math.max(0, state.blocks.findIndex(b => b.id === state.activeBlockId));
    state.blocks.splice(activeIdx + 1, 0, ...parsed);
    ensureTrailingParagraph();
    const lastBlk = parsed[parsed.length - 1];
    state.activeBlockId = lastBlk.id;
    markDirtyAndSync(true);
    renderCanvas();
    focusBlockById(lastBlk.id, 'end');
    return true;
  }

  function applyInlineFormattingToCrossRange(wrapperSymbol, suffixSymbol = wrapperSymbol) {
    const norm = normalizeCrossRange();
    if (!norm || norm.collapsed) return false;
    const { start, end, reversed } = norm;
    const addLen = wrapperSymbol.length + suffixSymbol.length;

    recordUndoSnapshot();
    let newStart = { ...start };
    let newEnd = { ...end };

    for (let idx = start.blockIdx; idx <= end.blockIdx; idx++) {
      const blk = state.blocks[idx];
      if (!blk) continue;
      const isFirst = idx === start.blockIdx;
      const isLast = idx === end.blockIdx;

      if (isTextMergeableType(blk.type)) {
        const full = blk.text || '';
        const sOff = isFirst ? (start.mdOffset || 0) : 0;
        const eOff = isLast ? (end.mdOffset || 0) : full.length;
        if (eOff > sOff) {
          const mid = full.slice(sOff, eOff);
          blk.text = full.slice(0, sOff) + wrapperSymbol + mid + suffixSymbol + full.slice(eOff);
          if (isLast) {
            newEnd.mdOffset = eOff + addLen;
          }
        }
      } else if (blk.type === 'ulist' || blk.type === 'olist' || blk.type === 'tasklist') {
        const sItem = isFirst ? (start.itemIdx || 0) : 0;
        const eItem = isLast ? (end.itemIdx ?? blk.items.length - 1) : blk.items.length - 1;
        for (let k = sItem; k <= eItem && k < blk.items.length; k++) {
          const full = getListItemText(blk, k);
          const sOff = isFirst && k === sItem ? (start.mdOffset || 0) : 0;
          const eOff = isLast && k === eItem ? (end.mdOffset || 0) : full.length;
          if (eOff > sOff) {
            setListItemText(blk, k, full.slice(0, sOff) + wrapperSymbol + full.slice(sOff, eOff) + suffixSymbol + full.slice(eOff));
            if (isLast && k === eItem) {
              newEnd.mdOffset = eOff + addLen;
            }
          }
        }
      }
    }

    markDirtyAndSync(false);
    renderCanvas();
    state.crossRange = reversed ? { anchor: newEnd, focus: newStart } : { anchor: newStart, focus: newEnd };
    syncCrossRangeUI(true);
    return true;
  }

  function stepEndpointByArrow(ep, key) {
    const cur = refreshEndpointIndex(ep);
    if (!cur) return null;
    const block = state.blocks[cur.blockIdx];
    if (!block) return null;

    if (key === 'ArrowRight') {
      if (cur.kind === 'editable') {
        const len = (block.text || '').length;
        if ((cur.mdOffset || 0) < len) return { ...cur, mdOffset: (cur.mdOffset || 0) + 1 };
      } else if (cur.kind === 'listitem' || cur.kind === 'taskitem') {
        const len = getListItemText(block, cur.itemIdx || 0).length;
        if ((cur.mdOffset || 0) < len) return { ...cur, mdOffset: (cur.mdOffset || 0) + 1 };
        if ((cur.itemIdx || 0) + 1 < block.items.length) return { ...cur, itemIdx: (cur.itemIdx || 0) + 1, mdOffset: 0 };
      } else if (cur.kind === 'code') {
        const len = (block.code || '').length;
        if ((cur.codeOffset || 0) < len) return { ...cur, codeOffset: (cur.codeOffset || 0) + 1 };
      } else if (cur.kind === 'special' && cur.edge === 'before') {
        return { ...cur, edge: 'after' };
      }
      if (cur.blockIdx + 1 < state.blocks.length) {
        return makeBlockBoundaryEndpoint(cur.blockIdx + 1, false);
      }
      return cur;
    }

    if (key === 'ArrowLeft') {
      if (cur.kind === 'editable') {
        if ((cur.mdOffset || 0) > 0) return { ...cur, mdOffset: (cur.mdOffset || 0) - 1 };
      } else if (cur.kind === 'listitem' || cur.kind === 'taskitem') {
        if ((cur.mdOffset || 0) > 0) return { ...cur, mdOffset: (cur.mdOffset || 0) - 1 };
        if ((cur.itemIdx || 0) > 0) {
          const prevIdx = (cur.itemIdx || 0) - 1;
          return { ...cur, itemIdx: prevIdx, mdOffset: getListItemText(block, prevIdx).length };
        }
      } else if (cur.kind === 'code') {
        if ((cur.codeOffset || 0) > 0) return { ...cur, codeOffset: (cur.codeOffset || 0) - 1 };
      } else if (cur.kind === 'special' && cur.edge === 'after') {
        return { ...cur, edge: 'before' };
      }
      if (cur.blockIdx > 0) {
        return makeBlockBoundaryEndpoint(cur.blockIdx - 1, true);
      }
      return cur;
    }

    if (key === 'ArrowDown') {
      if ((cur.kind === 'listitem' || cur.kind === 'taskitem') && (cur.itemIdx || 0) + 1 < block.items.length) {
        const nextItem = (cur.itemIdx || 0) + 1;
        const nextLen = getListItemText(block, nextItem).length;
        return { ...cur, itemIdx: nextItem, mdOffset: Math.min(nextLen, cur.mdOffset || 0) };
      }
      if (cur.blockIdx + 1 < state.blocks.length) {
        const nextBlk = state.blocks[cur.blockIdx + 1];
        if (isTextMergeableType(nextBlk.type)) {
          return {
            blockId: nextBlk.id,
            blockIdx: cur.blockIdx + 1,
            kind: 'editable',
            mdOffset: Math.min((nextBlk.text || '').length, cur.mdOffset || 0)
          };
        }
        return makeBlockBoundaryEndpoint(cur.blockIdx + 1, true);
      }
      return makeBlockBoundaryEndpoint(cur.blockIdx, true);
    }

    if (key === 'ArrowUp') {
      if ((cur.kind === 'listitem' || cur.kind === 'taskitem') && (cur.itemIdx || 0) > 0) {
        const prevItem = (cur.itemIdx || 0) - 1;
        const prevLen = getListItemText(block, prevItem).length;
        return { ...cur, itemIdx: prevItem, mdOffset: Math.min(prevLen, cur.mdOffset || 0) };
      }
      if (cur.blockIdx > 0) {
        const prevBlk = state.blocks[cur.blockIdx - 1];
        if (isTextMergeableType(prevBlk.type)) {
          return {
            blockId: prevBlk.id,
            blockIdx: cur.blockIdx - 1,
            kind: 'editable',
            mdOffset: Math.min((prevBlk.text || '').length, cur.mdOffset || 0)
          };
        }
        return makeBlockBoundaryEndpoint(cur.blockIdx - 1, false);
      }
      return makeBlockBoundaryEndpoint(0, false);
    }

    return cur;
  }

  function tryStartCrossRangeFromEditableKey(el, block, itemIdx, key) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.focusNode)) return false;

    const full = Parser.extractInlineMarkdownFromElement(el);
    const focusMd = Math.min(full.length, measureMarkdownOffsetInElement(el, sel.focusNode, sel.focusOffset));
    const anchorMd = sel.anchorNode && el.contains(sel.anchorNode)
      ? Math.min(full.length, measureMarkdownOffsetInElement(el, sel.anchorNode, sel.anchorOffset))
      : focusMd;

    const blockIdx = state.blocks.findIndex(b => b.id === block.id);
    if (blockIdx === -1) return false;

    let shouldCross = false;
    if (key === 'ArrowLeft' && focusMd === 0) {
      shouldCross = itemIdx !== null ? (itemIdx > 0 || blockIdx > 0) : blockIdx > 0;
    } else if (key === 'ArrowRight' && focusMd >= full.length) {
      shouldCross = itemIdx !== null
        ? (itemIdx < (block.items?.length || 1) - 1 || blockIdx < state.blocks.length - 1)
        : blockIdx < state.blocks.length - 1;
    } else if (key === 'ArrowUp') {
      const focusRange = document.createRange();
      focusRange.setStart(sel.focusNode, sel.focusOffset);
      focusRange.collapse(true);
      const rects = focusRange.getClientRects?.() || [];
      const elRect = el.getBoundingClientRect();
      const atTopLine = focusMd === 0 || (rects.length > 0 && rects[0].top <= elRect.top + 14);
      shouldCross = atTopLine && (itemIdx !== null ? (itemIdx > 0 || blockIdx > 0) : blockIdx > 0);
    } else if (key === 'ArrowDown') {
      const focusRange = document.createRange();
      focusRange.setStart(sel.focusNode, sel.focusOffset);
      focusRange.collapse(true);
      const rects = focusRange.getClientRects?.() || [];
      const elRect = el.getBoundingClientRect();
      const atBottomLine = focusMd >= full.length || (rects.length > 0 && rects[rects.length - 1].bottom >= elRect.bottom - 14);
      shouldCross = atBottomLine && (itemIdx !== null
        ? (itemIdx < (block.items?.length || 1) - 1 || blockIdx < state.blocks.length - 1)
        : blockIdx < state.blocks.length - 1);
    }

    if (!shouldCross) return false;

    const kind = itemIdx !== null ? (block.type === 'tasklist' ? 'taskitem' : 'listitem') : 'editable';
    const anchorEp = itemIdx !== null
      ? { blockId: block.id, blockIdx, kind, itemIdx, mdOffset: anchorMd }
      : { blockId: block.id, blockIdx, kind, mdOffset: anchorMd };
    const focusEp = itemIdx !== null
      ? { blockId: block.id, blockIdx, kind, itemIdx, mdOffset: focusMd }
      : { blockId: block.id, blockIdx, kind, mdOffset: focusMd };

    const nextFocus = stepEndpointByArrow(focusEp, key);
    if (!nextFocus) return false;
    setCrossRange(anchorEp, nextFocus, true);
    const domEl = document.querySelector(`[data-block-id="${nextFocus.blockId}"]`);
    domEl?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function clearBlockSelection(restoreFocus = false) {
    clearCrossRange(false);
    const hadSelection = hasBlockSelection();
    if (state.selectedBlockIds) state.selectedBlockIds.clear();
    state.selectionAnchorBlockId = null;
    state.selectionFocusBlockId = null;
    if (hadSelection) {
      syncBlockSelectionUI(false);
    }
    if (restoreFocus && state.activeBlockId) {
      focusBlockById(state.activeBlockId, 'end');
    }
  }

  function selectSingleBlock(blockId, focusBridge = true) {
    if (!blockId || !state.blocks.some(b => b.id === blockId)) return;
    closeSlashMenu();
    state.editingSpecialId = null;
    state.activeBlockId = blockId;
    state.selectionAnchorBlockId = blockId;
    state.selectionFocusBlockId = blockId;
    state.selectedBlockIds = new Set([blockId]);
    setActiveBlock(blockId);
    syncBlockSelectionUI(focusBridge);
  }

  function toggleSingleBlockSelection(blockId) {
    if (!blockId || !state.blocks.some(b => b.id === blockId)) return;
    closeSlashMenu();
    if (state.selectedBlockIds.has(blockId)) {
      state.selectedBlockIds.delete(blockId);
      if (state.selectedBlockIds.size === 0) {
        clearBlockSelection(false);
        return;
      }
    } else {
      state.selectedBlockIds.add(blockId);
    }
    state.selectionAnchorBlockId = blockId;
    state.selectionFocusBlockId = blockId;
    setActiveBlock(blockId);
    syncBlockSelectionUI(true);
  }

  function setBlockRangeSelection(anchorBlockId, focusBlockId, focusBridge = true) {
    const idxA = state.blocks.findIndex(b => b.id === anchorBlockId);
    const idxB = state.blocks.findIndex(b => b.id === focusBlockId);
    if (idxA === -1 && idxB === -1) return;
    const realA = idxA === -1 ? idxB : idxA;
    const realB = idxB === -1 ? idxA : idxB;
    const lo = Math.min(realA, realB);
    const hi = Math.max(realA, realB);

    closeSlashMenu();
    state.editingSpecialId = null;
    state.selectionAnchorBlockId = state.blocks[realA].id;
    state.selectionFocusBlockId = state.blocks[realB].id;
    state.activeBlockId = state.blocks[realB].id;

    const nextSet = new Set();
    for (let i = lo; i <= hi; i++) {
      nextSet.add(state.blocks[i].id);
    }
    state.selectedBlockIds = nextSet;
    setActiveBlock(state.activeBlockId);
    syncBlockSelectionUI(focusBridge);
  }

  function selectAllBlocks() {
    if (state.blocks.length === 0) return;
    setBlockRangeSelection(state.blocks[0].id, state.blocks[state.blocks.length - 1].id, true);
  }

  function extendBlockSelectionByStep(step) {
    if (state.blocks.length === 0) return;
    const anchorId = state.selectionAnchorBlockId || state.activeBlockId || state.blocks[0].id;
    const focusId = state.selectionFocusBlockId || anchorId;
    const curFocusIdx = Math.max(0, state.blocks.findIndex(b => b.id === focusId));
    const nextFocusIdx = Math.min(state.blocks.length - 1, Math.max(0, curFocusIdx + step));
    const nextFocusBlock = state.blocks[nextFocusIdx];
    setBlockRangeSelection(anchorId, nextFocusBlock.id, true);
    const domEl = document.querySelector(`[data-block-id="${nextFocusBlock.id}"]`);
    domEl?.scrollIntoView({ block: 'nearest' });
  }

  function deleteSelectedBlocks(direction = 'backward') {
    const indices = getSelectedBlockIndices();
    if (indices.length === 0) return false;

    recordUndoSnapshot();
    const firstIdx = indices[0];
    const selectedSet = new Set(state.selectedBlockIds);
    state.blocks = state.blocks.filter(b => !selectedSet.has(b.id));
    clearBlockSelection(false);

    if (state.blocks.length === 0) {
      const fresh = { id: Parser.nextBlockId(), type: 'paragraph', text: '' };
      state.blocks = [fresh];
      state.activeBlockId = fresh.id;
      markDirtyAndSync(true);
      renderCanvas();
      focusBlockById(fresh.id, 'start');
      return true;
    }

    ensureTrailingParagraph();
    const targetIdx = direction === 'forward'
      ? Math.min(firstIdx, state.blocks.length - 1)
      : Math.max(0, Math.min(firstIdx - 1, state.blocks.length - 1));
    const targetBlock = state.blocks[targetIdx];
    state.activeBlockId = targetBlock.id;
    markDirtyAndSync(true);
    renderCanvas();
    focusBlockById(targetBlock.id, direction === 'forward' || firstIdx === 0 ? 'start' : 'end');
    return true;
  }

  function cloneBlockWithNewId(block) {
    const copy = JSON.parse(JSON.stringify(block));
    copy.id = Parser.nextBlockId();
    return copy;
  }

  function duplicateBlocksByIds(idsArray = null) {
    const indices = idsArray && idsArray.length > 0
      ? idsArray.map(id => state.blocks.findIndex(b => b.id === id)).filter(i => i >= 0).sort((a, b) => a - b)
      : (hasBlockSelection() ? getSelectedBlockIndices() : [state.blocks.findIndex(b => b.id === state.activeBlockId)].filter(i => i >= 0));
    if (indices.length === 0) return;

    recordUndoSnapshot();
    const clones = indices.map(i => cloneBlockWithNewId(state.blocks[i]));
    const insertAt = indices[indices.length - 1] + 1;
    state.blocks.splice(insertAt, 0, ...clones);
    ensureTrailingParagraph();
    markDirtyAndSync(true);
    renderCanvas();
    setBlockRangeSelection(clones[0].id, clones[clones.length - 1].id, true);
    showToast(clones.length > 1 ? `已克隆 ${clones.length} 个块` : '已克隆当前块');
  }

  function moveBlocksByStep(delta) {
    const indices = hasBlockSelection()
      ? getSelectedBlockIndices()
      : [state.blocks.findIndex(b => b.id === state.activeBlockId)].filter(i => i >= 0);
    if (indices.length === 0) return;

    // Require contiguous selection (or single block) for unambiguous reordering
    const minIdx = indices[0];
    const maxIdx = indices[indices.length - 1];
    if (maxIdx - minIdx + 1 !== indices.length) return;
    if (delta < 0 && minIdx === 0) return;
    if (delta > 0 && maxIdx >= state.blocks.length - 1) return;

    const wasMultiSelected = hasBlockSelection();
    recordUndoSnapshot();
    const moving = state.blocks.splice(minIdx, indices.length);
    const targetInsert = Math.max(0, Math.min(state.blocks.length, minIdx + delta));
    state.blocks.splice(targetInsert, 0, ...moving);
    ensureTrailingParagraph();
    markDirtyAndSync(true);
    renderCanvas();

    if (wasMultiSelected) {
      setBlockRangeSelection(moving[0].id, moving[moving.length - 1].id, true);
    } else {
      focusBlockById(moving[0].id, 'end');
    }
  }

  function replaceSelectedBlocksWithMarkdown(mdText) {
    const indices = getSelectedBlockIndices();
    if (indices.length === 0) return false;

    recordUndoSnapshot();
    const firstIdx = indices[0];
    const selectedSet = new Set(state.selectedBlockIds);
    const remaining = [];
    let inserted = false;
    const parsed = Parser.parseMarkdownToBlocks(String(mdText || ''));
    const replacement = parsed.length > 0
      ? parsed
      : [{ id: Parser.nextBlockId(), type: 'paragraph', text: '' }];

    state.blocks.forEach((blk, idx) => {
      if (selectedSet.has(blk.id)) {
        if (!inserted && idx >= firstIdx) {
          remaining.push(...replacement);
          inserted = true;
        }
      } else {
        remaining.push(blk);
      }
    });
    if (!inserted) {
      remaining.push(...replacement);
    }

    state.blocks = remaining;
    clearBlockSelection(false);
    ensureTrailingParagraph();
    const lastInserted = replacement[replacement.length - 1];
    state.activeBlockId = lastInserted.id;
    markDirtyAndSync(true);
    renderCanvas();
    focusBlockById(lastInserted.id, 'end');
    return true;
  }

  function handlePasteMarkdownIntoEditable(editable, rawText) {
    const blockWrapper = editable.closest('.mk-block');
    const blockIdx = state.blocks.findIndex(b => b.id === blockWrapper?.dataset.blockId);
    if (blockIdx === -1) return false;
    const block = state.blocks[blockIdx];

    const normalized = String(rawText || '').replace(/\r\n/g, '\n');
    const isMultiLine = normalized.includes('\n');
    const looksLikeBlockSyntax = /^(\s{0,3}#{1,6}\s|```|\$\$|\|.*\|\s*$|[-*+]\s+\[[ xX]\]\s|[-*+]\s+|1\.\s+|>\s+|---|\*\*\*)/.test(normalized);

    // Single-line plain inline text inside an existing editable: insert cleanly without HTML style soup
    if (!isMultiLine && !(looksLikeBlockSyntax && (editable.textContent || '').trim() === '')) {
      recordUndoSnapshot('paste:' + block.id);
      document.execCommand('insertText', false, normalized);
      return true;
    }

    // Multi-block paste into simple text blocks (paragraph, heading, blockquote, callout)
    if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'blockquote' || block.type === 'callout') {
      const { full, start, end } = extractMarkdownWithCaret(editable);
      const before = full.slice(0, start);
      const after = full.slice(end);
      const parsed = Parser.parseMarkdownToBlocks(normalized);
      if (parsed.length === 0) return false;

      recordUndoSnapshot();
      const toInsert = [];
      if (before !== '') {
        if (parsed[0].type === 'paragraph') {
          parsed[0] = {
            ...block,
            id: block.id,
            text: before + (parsed[0].text || '')
          };
        } else {
          toInsert.push({ ...block, id: block.id, text: before });
        }
      }
      toInsert.push(...parsed);

      const lastNew = toInsert[toInsert.length - 1];
      let focusTargetOffset = 'end';
      if (after !== '') {
        if (lastNew.type === 'paragraph' || lastNew.type === 'heading' || lastNew.type === 'blockquote') {
          focusTargetOffset = (lastNew.text || '').length;
          lastNew.text = (lastNew.text || '') + after;
        } else {
          toInsert.push({ id: Parser.nextBlockId(), type: 'paragraph', text: after });
          focusTargetOffset = 0;
        }
      }

      state.blocks.splice(blockIdx, 1, ...toInsert);
      ensureTrailingParagraph();
      const focusBlk = toInsert[toInsert.length - 1];
      state.activeBlockId = focusBlk.id;
      markDirtyAndSync(true);
      renderCanvas();
      focusBlockById(focusBlk.id, focusTargetOffset);
      return true;
    }

    // Multi-line paste inside list/table cell: insert after current block cleanly
    const parsed = Parser.parseMarkdownToBlocks(normalized);
    if (parsed.length > 0) {
      recordUndoSnapshot();
      state.blocks.splice(blockIdx + 1, 0, ...parsed);
      ensureTrailingParagraph();
      const lastBlk = parsed[parsed.length - 1];
      state.activeBlockId = lastBlk.id;
      markDirtyAndSync(true);
      renderCanvas();
      focusBlockById(lastBlk.id, 'end');
      return true;
    }
    return false;
  }

  function handleSelectAllCommand() {
    const activeEl = document.activeElement;
    if (
      activeEl &&
      activeEl.tagName === 'INPUT' &&
      activeEl.type !== 'checkbox'
    ) {
      activeEl.select();
      return;
    }

    if (state.sourceMode) {
      const srcTa = document.getElementById('source-textarea');
      srcTa?.focus();
      srcTa?.select();
      return;
    }

    if (hasBlockSelection() || hasCrossRange()) {
      selectAllBlocks();
      return;
    }

    const canvas = document.getElementById('wysiwyg-canvas');
    if (activeEl && canvas && canvas.contains(activeEl)) {
      if (activeEl.tagName === 'TEXTAREA') {
        const len = (activeEl.value || '').length;
        const alreadyAll = len === 0 || (activeEl.selectionStart === 0 && activeEl.selectionEnd === len);
        if (!alreadyAll) {
          activeEl.select();
          return;
        }
        activeEl.blur();
        selectAllBlocks();
        return;
      }

      if (activeEl.isContentEditable) {
        const totalLen = (activeEl.textContent || '').length;
        const sel = window.getSelection();
        const selLen = (
          sel &&
          !sel.isCollapsed &&
          activeEl.contains(sel.anchorNode) &&
          activeEl.contains(sel.focusNode)
        )
          ? sel.toString().length
          : 0;
        if (totalLen > 0 && selLen < totalLen) {
          const range = document.createRange();
          range.selectNodeContents(activeEl);
          sel.removeAllRanges();
          sel.addRange(range);
          updateFloatingToolbar();
          return;
        }
        activeEl.blur();
        selectAllBlocks();
        return;
      }
    }

    selectAllBlocks();
  }

  function focusBlockById(blockId, caretTarget = 'end') {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector(`[data-block-id="${blockId}"]`);
      if (!wrapper) return;
      setActiveBlock(blockId);

      const editables = wrapper.querySelectorAll('.mk-editable, .mk-code-textarea, .mk-special-textarea, th, td');
      if (editables.length === 0) {
        const focusable = wrapper.querySelector('[tabindex]');
        focusable?.focus();
        return;
      }
      const editable = caretTarget === 'end' && editables.length > 1
        ? editables[editables.length - 1]
        : editables[0];

      if (editable) {
        if (editable.classList.contains('mk-editable')) {
          editable._pendingProgrammaticCaret = caretTarget;
          editable.focus();
          if (editable._pendingProgrammaticCaret !== undefined) {
            applyDesiredCaretToEditable(editable, caretTarget === 'start' ? 'start' : 'end');
          }
        } else if (editable.tagName === 'TEXTAREA') {
          editable.focus();
          const len = (editable.value || '').length;
          if (caretTarget === 'start') {
            editable.setSelectionRange(0, 0);
          } else if (typeof caretTarget === 'number') {
            const p = Math.min(len, Math.max(0, caretTarget));
            editable.setSelectionRange(p, p);
          } else {
            editable.setSelectionRange(len, len);
          }
        } else {
          editable.focus();
        }
      }
    });
  }

  function placeCaretAtStart(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  function setCaretCharacterOffsetWithin(element, targetOffset) {
    try {
      if (targetOffset <= 0) {
        placeCaretAtStart(element);
        return;
      }
      let remaining = targetOffset;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      while (node) {
        const len = node.nodeValue.length;
        if (remaining <= len) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        remaining -= len;
        node = walker.nextNode();
      }
      placeCaretAtEnd(element);
    } catch (e) {
      placeCaretAtEnd(element);
    }
  }

  function getCaretCharacterOffsetWithin(element) {
    let caretOffset = 0;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      caretOffset = preCaretRange.toString().length;
    }
    return caretOffset;
  }

  function centerElementInViewport(el) {
    const scroller = document.getElementById('editor-scroll-container');
    if (!scroller || !el) return;
    const rect = el.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const targetTop = rect.top - scrollerRect.top + scroller.scrollTop - scrollerRect.height / 2 + rect.height / 2;
    scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }

  /* ==========================================================================
   * INLINE FORMATTING ACTIONS (Bold, Italic, Code, Link, Math)
   * ========================================================================== */

  function applyInlineFormatting(wrapperSymbol, suffixSymbol = wrapperSymbol) {
    if (state.sourceMode) {
      const ta = document.getElementById('source-textarea');
      if (!ta) return;
      recordUndoSnapshot();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = ta.value.slice(start, end) || '文本';
      ta.value = ta.value.slice(0, start) + wrapperSymbol + selected + suffixSymbol + ta.value.slice(end);
      ta.focus();
      ta.selectionStart = start + wrapperSymbol.length;
      ta.selectionEnd = start + wrapperSymbol.length + selected.length;
      state.markdown = ta.value;
      state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
      markDirtyAndSync(true);
      return;
    }

    if (hasCrossRange()) {
      applyInlineFormattingToCrossRange(wrapperSymbol, suffixSymbol);
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const editable = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer.closest('.mk-editable')
      : range.commonAncestorContainer.parentElement?.closest('.mk-editable');

    if (!editable) return;

    const blockWrapper = editable.closest('.mk-block');
    const block = state.blocks.find(b => b.id === blockWrapper?.dataset.blockId);
    if (!block) return;

    recordUndoSnapshot();
    const selectedText = sel.toString();
    if (selectedText) {
      const replacement = `${wrapperSymbol}${selectedText}${suffixSymbol}`;
      document.execCommand('insertText', false, replacement);
    } else {
      const replacement = `${wrapperSymbol}文本${suffixSymbol}`;
      document.execCommand('insertText', false, replacement);
    }

    const raw = Parser.extractInlineMarkdownFromElement(editable);
    if (block.text !== undefined) {
      block.text = raw;
    }
    renderEditableContent(editable, raw, true);
    placeCaretAtEnd(editable);
    hideFloatingToolbar();
    markDirtyAndSync(false);
  }

  /* ==========================================================================
   * SLASH COMMAND MENU (/) & GUTTER BLOCK ACTION MENU
   * ========================================================================== */

  function getActiveSlashCommands() {
    if (state.slashMenuMode === 'gutter') {
      const gutterActions = [
        {
          id: 'gutter-delete',
          icon: '✕',
          title: '删除当前块',
          desc: '移除该内容块（支持 Cmd+Z 撤销）',
          danger: true,
          action: () => {
            const id = state.activeBlockId;
            closeSlashMenu();
            if (id) deleteBlock(id);
          }
        },
        {
          id: 'gutter-select',
          icon: '▣',
          title: '选中当前块',
          desc: '进入块级操作模式（Shift+点击可跨块多选）',
          action: () => {
            const id = state.activeBlockId;
            closeSlashMenu();
            if (id) selectSingleBlock(id, true);
          }
        },
        {
          id: 'gutter-duplicate',
          icon: '❐',
          title: '克隆当前块',
          desc: '在下方复制一份相同块 (Cmd+D)',
          action: () => {
            const id = state.activeBlockId;
            closeSlashMenu();
            if (id) duplicateBlocksByIds([id]);
          }
        },
        {
          id: 'gutter-insert-above',
          icon: '↑',
          title: '在上方插入空段落',
          desc: '在当前块前面新建一行',
          action: () => {
            const id = state.activeBlockId;
            closeSlashMenu();
            if (id) insertBlockBefore(id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
          }
        },
        {
          id: 'gutter-insert-below',
          icon: '↓',
          title: '在下方插入空段落',
          desc: '在当前块后面新建一行',
          dividerAfter: true,
          action: () => {
            const id = state.activeBlockId;
            closeSlashMenu();
            if (id) insertBlockAfter(id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
          }
        }
      ];
      return [...gutterActions, ...SLASH_COMMANDS];
    }
    return SLASH_COMMANDS;
  }

  function openSlashMenuForBlock(blockWrapper, mode = 'slash') {
    const menu = document.getElementById('slash-menu');
    if (!menu || !blockWrapper) return;

    if (blockWrapper.dataset.blockId) {
      setActiveBlock(blockWrapper.dataset.blockId);
    }
    state.slashMenuMode = mode;
    state.slashMenuOpen = true;
    state.slashSelectedIndex = 0;
    renderSlashMenuItems();

    const rect = blockWrapper.getBoundingClientRect();
    const preferredTop = mode === 'gutter' ? rect.top + 28 : rect.bottom + 6;
    menu.style.top = `${Math.max(48, Math.min(preferredTop, window.innerHeight - 330))}px`;
    menu.style.left = `${Math.max(rect.left + (mode === 'gutter' ? 0 : 24), 48)}px`;
    menu.classList.add('visible');
  }

  function closeSlashMenu() {
    state.slashMenuOpen = false;
    state.slashMenuMode = 'slash';
    const menu = document.getElementById('slash-menu');
    if (menu) menu.classList.remove('visible');
  }

  function renderSlashMenuItems() {
    const menu = document.getElementById('slash-menu');
    if (!menu) return;
    const commands = getActiveSlashCommands();
    menu.innerHTML = commands.map((cmd, idx) => `
      <div class="slash-item ${idx === state.slashSelectedIndex ? 'is-selected' : ''} ${cmd.danger ? 'is-danger' : ''}" data-idx="${idx}">
        <span class="slash-icon">${cmd.icon}</span>
        <div class="slash-meta">
          <div class="slash-title">${cmd.title}</div>
          <div class="slash-desc">${cmd.desc}</div>
        </div>
      </div>
      ${cmd.dividerAfter ? '<div class="slash-divider"></div>' : ''}
    `).join('');

    menu.querySelectorAll('.slash-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        const idx = Number(item.dataset.idx);
        commands[idx]?.action();
      });
    });

    const selectedEl = menu.querySelector('.slash-item.is-selected');
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }

  function handleSlashMenuKeydown(e) {
    const commands = getActiveSlashCommands();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.slashSelectedIndex = (state.slashSelectedIndex + 1) % commands.length;
      renderSlashMenuItems();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.slashSelectedIndex = (state.slashSelectedIndex - 1 + commands.length) % commands.length;
      renderSlashMenuItems();
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commands[state.slashSelectedIndex]?.action();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSlashMenu();
      return true;
    }
    return false;
  }

  /* ==========================================================================
   * SOURCE CODE MODE (Cmd + /)
   * ========================================================================== */

  function toggleSourceMode() {
    clearBlockSelection(false);
    state.sourceMode = !state.sourceMode;
    const wysiwygContainer = document.getElementById('wysiwyg-canvas');
    const sourceContainer = document.getElementById('source-editor-container');
    const sourceTextarea = document.getElementById('source-textarea');
    const toggleBtn = document.getElementById('btn-source-mode');

    if (state.sourceMode) {
      state.markdown = Parser.serializeBlocksToMarkdown(state.blocks);
      syncSourceEditor();
      wysiwygContainer.classList.add('hidden');
      sourceContainer.classList.remove('hidden');
      toggleBtn?.classList.add('active');
      setTimeout(() => sourceTextarea?.focus(), 20);
    } else {
      if (sourceTextarea) {
        state.markdown = sourceTextarea.value;
        state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
        ensureTrailingParagraph();
      }
      sourceContainer.classList.add('hidden');
      wysiwygContainer.classList.remove('hidden');
      toggleBtn?.classList.remove('active');
      renderCanvas();
      renderSidebarOutline();
    }
    updateStatusBar();
  }

  function syncSourceEditor() {
    const sourceTextarea = document.getElementById('source-textarea');
    const sourceLines = document.getElementById('source-linenums');
    if (!sourceTextarea) return;

    sourceTextarea.value = state.markdown;
    const updateLineNumbers = () => {
      const count = Math.max(1, sourceTextarea.value.split('\n').length);
      if (sourceLines) {
        sourceLines.innerHTML = Array.from({ length: count }, (_, i) => `<div>${i + 1}</div>`).join('');
      }
    };
    updateLineNumbers();
  }

  /* ==========================================================================
   * SIDEBAR: FILE TREE & OUTLINE (TOC)
   * ========================================================================== */

  function renderSidebarFiles() {
    const container = document.getElementById('file-tree-list');
    const folderLabel = document.getElementById('sidebar-folder-title');
    if (!container) return;

    if (folderLabel) {
      folderLabel.textContent = state.rootName || '本地工作区';
      folderLabel.title = state.rootPath || '';
    }

    const query = (state.fileSearchQuery || '').trim().toLowerCase();

    function renderNodes(items, depth = 0) {
      let html = '';
      for (const item of items) {
        if (item.type === 'folder') {
          const childrenHtml = renderNodes(item.children || [], depth + 1);
          if (query && !childrenHtml) continue;
          const isCollapsed = !query && state.collapsedFolders.has(item.path);
          html += `
            <div class="tree-folder ${isCollapsed ? 'is-collapsed' : ''}" data-path="${Renderers.escapeHtml(item.path)}">
              <div class="tree-folder-header" style="padding-left: ${10 + depth * 14}px">
                <span class="tree-caret">${Icons.chevron}</span>
                <span class="tree-folder-icon">
                  <span class="folder-svg-open">${Icons.folderOpen}</span>
                  <span class="folder-svg-closed">${Icons.folderClosed}</span>
                </span>
                <span class="tree-name">${Renderers.escapeHtml(item.name)}</span>
              </div>
              <div class="tree-folder-children">${childrenHtml}</div>
            </div>
          `;
        } else {
          if (query && !item.name.toLowerCase().includes(query)) continue;
          const isActive = item.path === state.currentFilePath;
          html += `
            <div class="tree-file ${isActive ? 'is-active' : ''}" data-path="${Renderers.escapeHtml(item.path)}" style="padding-left: ${16 + depth * 14}px">
              <span class="tree-file-icon">${Icons.fileForName(item.name)}</span>
              <span class="tree-name">${Renderers.escapeHtml(item.name)}</span>
              <button type="button" class="tree-file-del" data-del-path="${Renderers.escapeHtml(item.path)}" title="删除文档">×</button>
            </div>
          `;
        }
      }
      return html;
    }

    const treeHtml = renderNodes(state.fileTree);
    container.innerHTML = treeHtml || '<div class="sidebar-empty">暂无匹配的 Markdown 文档</div>';

    container.querySelectorAll('.tree-file').forEach(el => {
      el.addEventListener('click', async e => {
        const delBtn = e.target.closest('.tree-file-del');
        if (delBtn) {
          e.stopPropagation();
          const delPath = delBtn.dataset.delPath;
          promptTrashTarget(delPath, false);
          return;
        }
        const path = el.dataset.path;
        if (path && path !== state.currentFilePath) {
          if (state.isDirty && state.currentFilePath) {
            await saveCurrentDocument(true);
          }
          await openFileFromTree(path);
        }
      });
    });

    container.querySelectorAll('.tree-folder-header').forEach(header => {
      header.addEventListener('click', () => {
        const folder = header.parentElement;
        const collapsed = folder.classList.toggle('is-collapsed');
        const fp = folder.dataset.path;
        if (fp) {
          if (collapsed) state.collapsedFolders.add(fp);
          else state.collapsedFolders.delete(fp);
        }
      });
    });
  }

  async function openFileFromTree(filePath) {
    const fileData = await Bridge.readFile(filePath);
    if (fileData) {
      loadDocument(fileData.path, fileData.name, fileData.content);
    }
  }

  /* ==========================================================================
   * UNIFIED DIALOG MODAL & SIDEBAR RIGHT-CLICK CONTEXT MENU
   * ========================================================================== */

  let activeDialogConfirmHandler = null;

  function openDialogModal(opts) {
    const modal = document.getElementById('dialog-modal');
    const titleEl = document.getElementById('dialog-modal-title');
    const descEl = document.getElementById('dialog-modal-desc');
    const inputEl = document.getElementById('dialog-modal-input');
    const confirmBtn = document.getElementById('btn-dialog-confirm');
    if (!modal || !titleEl || !inputEl || !confirmBtn) return;

    titleEl.textContent = opts.title || '操作确认';
    if (descEl) {
      if (opts.desc) {
        descEl.textContent = opts.desc;
        descEl.classList.remove('hidden');
      } else {
        descEl.textContent = '';
        descEl.classList.add('hidden');
      }
    }

    const showInput = opts.showInput !== false;
    inputEl.classList.toggle('hidden', !showInput);
    if (showInput) {
      inputEl.placeholder = opts.placeholder || '';
      inputEl.value = opts.initialValue || '';
    }

    confirmBtn.textContent = opts.confirmText || '确定';
    confirmBtn.classList.toggle('is-danger', Boolean(opts.danger));
    activeDialogConfirmHandler = opts.onConfirm || null;

    modal.classList.add('visible');
    setTimeout(() => {
      if (showInput) {
        inputEl.focus();
        const dotIdx = inputEl.value.lastIndexOf('.');
        if (dotIdx > 0 && opts.selectStem) {
          inputEl.setSelectionRange(0, dotIdx);
        } else {
          inputEl.select();
        }
      } else {
        confirmBtn.focus();
      }
    }, 25);
  }

  function closeDialogModal() {
    const modal = document.getElementById('dialog-modal');
    if (modal) modal.classList.remove('visible');
    activeDialogConfirmHandler = null;
  }

  function openNewFileModal(targetFolder = '') {
    const folder = targetFolder || state.rootPath || '/workspace';
    openDialogModal({
      title: '新建 Markdown 文档',
      desc: targetFolder ? `创建位置：${shortenHomePath(folder)}` : '',
      placeholder: '输入文件名，例如：读书笔记.md',
      initialValue: '',
      confirmText: '创建文档',
      onConfirm: async val => {
        const rawName = (val || '').trim() || '新建笔记.md';
        const res = await Bridge.createFile(folder, rawName);
        if (res && res.file) {
          if (res.tree) state.fileTree = res.tree;
          loadDocument(res.file.path, res.file.name, res.file.content);
          showToast(`已创建 ${res.file.name}`);
        }
      }
    });
  }

  function promptCreateSubfolder(parentDir = '') {
    const folder = parentDir || state.rootPath || '/workspace';
    openDialogModal({
      title: '新建文件夹',
      desc: `所在位置：${shortenHomePath(folder)}`,
      placeholder: '输入文件夹名称…',
      initialValue: '',
      confirmText: '创建文件夹',
      onConfirm: async val => {
        const name = (val || '').trim() || '新建文件夹';
        const res = await Bridge.createFolder(folder, name);
        if (res && res.ok) {
          if (res.tree) state.fileTree = res.tree;
          renderSidebarFiles();
          showToast(`已创建文件夹「${name}」`);
        }
      }
    });
  }

  function promptRenameTarget(targetPath, isDir = false) {
    if (!targetPath) return;
    const oldName = targetPath.split('/').pop() || '';
    openDialogModal({
      title: isDir ? '重命名文件夹' : '重命名文档',
      placeholder: '输入新名称…',
      initialValue: oldName,
      selectStem: !isDir,
      confirmText: '重命名',
      onConfirm: async val => {
        const nextName = (val || '').trim();
        if (!nextName || nextName === oldName) return;
        const res = await Bridge.renameFile(targetPath, nextName);
        if (res && res.ok) {
          if (res.tree) state.fileTree = res.tree;
          if (!isDir && state.currentFilePath === targetPath) {
            state.currentFilePath = res.newPath;
            state.currentFileName = res.newName;
            syncDocumentBaseDir();
            recordRecentFile(state.currentFilePath, state.currentFileName);
            updateHeaderTitle();
          } else if (isDir && state.currentFilePath.startsWith(targetPath + '/')) {
            state.currentFilePath = res.newPath + state.currentFilePath.slice(targetPath.length);
            syncDocumentBaseDir();
            recordRecentFile(state.currentFilePath, state.currentFileName);
          }
          renderSidebarFiles();
          renderHistoryViews();
          showToast(`已重命名为 ${res.newName}`);
        }
      }
    });
  }

  function promptTrashTarget(targetPath, isDir = false) {
    if (!targetPath) return;
    const itemName = targetPath.split('/').pop() || targetPath;
    openDialogModal({
      title: isDir ? '将文件夹移到废纸篓？' : '将文档移到废纸篓？',
      desc: `「${itemName}」将被安全移入 macOS 废纸篓，您随时可以从废纸篓中还原。`,
      showInput: false,
      confirmText: '移到废纸篓',
      danger: true,
      onConfirm: async () => {
        await handleDeleteFile(targetPath);
      }
    });
  }

  async function handleDeleteFile(filePath) {
    const res = await Bridge.deleteFile(filePath);
    if (res && res.tree) {
      state.fileTree = res.tree;
      state.recentFiles = state.recentFiles.filter(f => f.path !== filePath && !f.path.startsWith(filePath + '/'));
      persistHistory();
      renderSidebarFiles();
      renderHistoryViews();
      showToast('已移到废纸篓');
      if (state.currentFilePath === filePath || state.currentFilePath.startsWith(filePath + '/')) {
        const nextFile = findFirstFileInTree(state.fileTree);
        if (nextFile) {
          await openFileFromTree(nextFile.path);
        } else {
          loadDocument('', '未命名.md', '# 未命名文档\n\n');
        }
      }
    }
  }

  function closeContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.classList.add('hidden');
  }

  function openSidebarContextMenu(e) {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    e.preventDefault();

    const fileEl = e.target.closest('.tree-file');
    const folderHeaderEl = e.target.closest('.tree-folder-header');
    const folderEl = folderHeaderEl ? folderHeaderEl.closest('.tree-folder') : null;

    const actions = [];
    if (fileEl) {
      const filePath = fileEl.dataset.path || '';
      const parentDir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : state.rootPath;
      actions.push(
        { icon: Icons.filePlus, label: '新建同级文档…', run: () => openNewFileModal(parentDir) },
        { icon: Icons.folderPlus, label: '新建同级文件夹…', run: () => promptCreateSubfolder(parentDir) },
        { divider: true },
        { icon: Icons.rename, label: '重命名…', run: () => promptRenameTarget(filePath, false) },
        { icon: Icons.copy, label: '复制文件路径', run: () => { navigator.clipboard?.writeText(filePath); showToast('已复制文件路径'); } },
        { icon: Icons.external, label: '在访达中显示', run: () => Bridge.revealInFinder(filePath) },
        { divider: true },
        { icon: Icons.trash, label: '移到废纸篓…', danger: true, run: () => promptTrashTarget(filePath, false) }
      );
    } else if (folderEl) {
      const folderPath = folderEl.dataset.path || state.rootPath;
      actions.push(
        { icon: Icons.filePlus, label: '在此新建文档…', run: () => openNewFileModal(folderPath) },
        { icon: Icons.folderPlus, label: '新建子文件夹…', run: () => promptCreateSubfolder(folderPath) },
        { divider: true },
        { icon: Icons.rename, label: '重命名文件夹…', run: () => promptRenameTarget(folderPath, true) },
        { icon: Icons.copy, label: '复制目录路径', run: () => { navigator.clipboard?.writeText(folderPath); showToast('已复制目录路径'); } },
        { icon: Icons.external, label: '在访达中显示', run: () => Bridge.revealInFinder(folderPath) },
        { divider: true },
        { icon: Icons.trash, label: '移到废纸篓…', danger: true, run: () => promptTrashTarget(folderPath, true) }
      );
    } else {
      const rootDir = state.rootPath || '/workspace';
      actions.push(
        { icon: Icons.filePlus, label: '新建 Markdown 文档…', run: () => openNewFileModal(rootDir) },
        { icon: Icons.folderPlus, label: '新建文件夹…', run: () => promptCreateSubfolder(rootDir) },
        { divider: true },
        { icon: Icons.external, label: '在访达中显示工作区', run: () => Bridge.revealInFinder(rootDir) }
      );
    }

    menu.innerHTML = actions
      .map((item, idx) => {
        if (item.divider) return '<div class="ctx-divider"></div>';
        return `<button type="button" class="ctx-item ${item.danger ? 'is-danger' : ''}" data-ctx-idx="${idx}">${item.icon}<span>${Renderers.escapeHtml(item.label)}</span></button>`;
      })
      .join('');

    menu.querySelectorAll('.ctx-item').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const idx = Number(btn.dataset.ctxIdx);
        closeContextMenu();
        actions[idx]?.run?.();
      });
    });

    menu.classList.remove('hidden');
    const menuWidth = 192;
    const menuHeight = menu.offsetHeight || 220;
    const left = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const top = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  function renderSidebarOutline() {
    const container = document.getElementById('outline-list');
    if (!container) return;

    const headings = Parser.extractHeadings(state.blocks);
    if (headings.length === 0) {
      container.innerHTML = '<div class="sidebar-empty">当前文档暂无标题大纲<br/><small>使用 # 一级标题 创建结构</small></div>';
      return;
    }

    const minLevel = Math.min(...headings.map(h => h.level));
    container.innerHTML = headings
      .map(h => {
        const indent = (h.level - minLevel) * 14;
        return `
          <div class="outline-item outline-h${h.level}" data-target-id="${h.id}" style="padding-left: ${14 + indent}px">
            <span class="outline-bullet">H${h.level}</span>
            <span class="outline-text">${Renderers.escapeHtml(h.text)}</span>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('.outline-item').forEach(item => {
      item.addEventListener('click', () => {
        const targetId = item.dataset.targetId;
        const blockEl = document.querySelector(`[data-block-id="${targetId}"]`);
        if (blockEl) {
          blockEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          focusBlockById(targetId, 'end');
        }
      });
    });

    updateOutlineScrollSpy();
  }

  function updateOutlineScrollSpy() {
    const outlineContainer = document.getElementById('outline-list');
    const scroller = document.getElementById('editor-scroll-container');
    if (!outlineContainer || !scroller || state.sourceMode) return;

    const items = Array.from(outlineContainer.querySelectorAll('.outline-item'));
    if (items.length === 0) return;

    const scrollerTop = scroller.getBoundingClientRect().top;
    let activeTargetId = items[0].dataset.targetId;

    for (const item of items) {
      const blk = document.querySelector(`[data-block-id="${item.dataset.targetId}"]`);
      if (!blk) continue;
      const rect = blk.getBoundingClientRect();
      if (rect.top - scrollerTop <= 115) {
        activeTargetId = item.dataset.targetId;
      } else {
        break;
      }
    }

    items.forEach(item => {
      const isMatch = item.dataset.targetId === activeTargetId;
      item.classList.toggle('is-active', isMatch);
    });
  }

  /* ==========================================================================
   * RECENT HISTORY & DIRECTORY SWITCHER
   * ========================================================================== */

  function shortenHomePath(fullPath) {
    const p = String(fullPath || '');
    if (!p) return '';
    if (state.homeDir && p.startsWith(state.homeDir)) {
      return '~' + p.slice(state.homeDir.length);
    }
    return p.replace(/^\/Users\/[^/]+/, '~');
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return '刚刚';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} 小时前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return '昨天';
    if (diffDay < 7) return `${diffDay} 天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function persistHistory() {
    Bridge.saveHistory({
      folders: state.recentFolders,
      files: state.recentFiles
    });
  }

  function recordRecentFolder(folderPath, folderName) {
    if (!folderPath) return;
    const name = folderName || folderPath.split('/').filter(Boolean).pop() || '工作区';
    state.recentFolders = [
      { path: folderPath, name, openedAt: Date.now() },
      ...state.recentFolders.filter(item => item.path !== folderPath)
    ].slice(0, 12);
    persistHistory();
  }

  function recordRecentFile(filePath, fileName) {
    if (!filePath) return;
    const name = fileName || filePath.split('/').pop() || '未命名.md';
    const lastSlash = filePath.lastIndexOf('/');
    const folderPath = lastSlash > 0 ? filePath.slice(0, lastSlash) : '';
    state.recentFiles = [
      { path: filePath, name, folderPath, openedAt: Date.now() },
      ...state.recentFiles.filter(item => item.path !== filePath)
    ].slice(0, 20);
    persistHistory();
  }

  function switchSidebarTab(tabName) {
    state.sidebarTab = tabName;
    if (!state.sidebarOpen) {
      state.sidebarOpen = true;
      document.getElementById('app-layout')?.classList.remove('sidebar-collapsed');
    }
    document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.getElementById('panel-files')?.classList.toggle('hidden', tabName !== 'files');
    document.getElementById('panel-outline')?.classList.toggle('hidden', tabName !== 'outline');
    document.getElementById('panel-history')?.classList.toggle('hidden', tabName !== 'history');

    if (tabName === 'history') {
      renderHistoryViews();
    }
  }

  function toggleDirDropdown(forceState) {
    const menu = document.getElementById('dir-dropdown-menu');
    const btn = document.getElementById('btn-dir-switcher');
    if (!menu) return;
    state.dirDropdownOpen = typeof forceState === 'boolean' ? forceState : !state.dirDropdownOpen;
    menu.classList.toggle('hidden', !state.dirDropdownOpen);
    btn?.classList.toggle('is-open', state.dirDropdownOpen);
    if (state.dirDropdownOpen) {
      renderDirDropdownList();
    }
  }

  async function promptChooseFolder() {
    toggleDirDropdown(false);
    if (state.isDirty && state.currentFilePath) {
      await saveCurrentDocument(true);
    }
    const ws = await Bridge.openFolderDialog();
    if (ws && ws.rootPath) {
      if (ws.homeDir) state.homeDir = ws.homeDir;
      state.rootPath = ws.rootPath;
      state.rootName = ws.rootName;
      state.fileTree = ws.tree || [];
      recordRecentFolder(ws.rootPath, ws.rootName);
      switchSidebarTab('files');
      renderSidebarFiles();
      if (ws.initialFile) {
        loadDocument(ws.initialFile.path, ws.initialFile.name, ws.initialFile.content);
      } else {
        updateHeaderTitle();
        renderHistoryViews();
      }
      showToast(`已切换至目录：${ws.rootName}`);
    }
  }

  async function switchToFolderByPath(folderPath) {
    toggleDirDropdown(false);
    if (!folderPath) return;
    if (state.isDirty && state.currentFilePath) {
      await saveCurrentDocument(true);
    }
    try {
      const ws = await Bridge.openFolderByPath(folderPath);
      if (ws && ws.rootPath) {
        if (ws.homeDir) state.homeDir = ws.homeDir;
        state.rootPath = ws.rootPath;
        state.rootName = ws.rootName;
        state.fileTree = ws.tree || [];
        recordRecentFolder(ws.rootPath, ws.rootName);
        switchSidebarTab('files');
        renderSidebarFiles();
        if (ws.initialFile) {
          loadDocument(ws.initialFile.path, ws.initialFile.name, ws.initialFile.content);
        } else {
          updateHeaderTitle();
          renderHistoryViews();
        }
        showToast(`已打开目录：${ws.rootName}`);
      }
    } catch (err) {
      state.recentFolders = state.recentFolders.filter(f => f.path !== folderPath);
      persistHistory();
      renderHistoryViews();
      showToast('该目录已不存在或已移动，已从历史移除');
    }
  }

  async function openRecentFileByPath(filePath) {
    toggleDirDropdown(false);
    if (!filePath) return;
    if (state.isDirty && state.currentFilePath) {
      await saveCurrentDocument(true);
    }
    try {
      const fileData = await Bridge.readFile(filePath);
      if (!fileData) throw new Error('File not found');

      // Also mount parent folder if outside current workspace so file tree stays in sync
      const lastSlash = filePath.lastIndexOf('/');
      const parentDir = lastSlash > 0 ? filePath.slice(0, lastSlash) : '';
      if (parentDir && (!state.rootPath || !filePath.startsWith(state.rootPath + '/'))) {
        try {
          const ws = await Bridge.openFolderByPath(parentDir);
          if (ws && ws.rootPath) {
            state.rootPath = ws.rootPath;
            state.rootName = ws.rootName;
            state.fileTree = ws.tree || [];
            recordRecentFolder(ws.rootPath, ws.rootName);
          }
        } catch (e) {}
      }

      loadDocument(fileData.path, fileData.name, fileData.content);
      showToast(`已打开 ${fileData.name}`);
    } catch (err) {
      state.recentFiles = state.recentFiles.filter(f => f.path !== filePath);
      persistHistory();
      renderHistoryViews();
      showToast('该文件已不存在或已被移动，已从历史移除');
    }
  }

  function renderDirDropdownList() {
    const listEl = document.getElementById('dir-dropdown-recent-list');
    if (!listEl) return;

    if (state.recentFolders.length === 0) {
      listEl.innerHTML = '<div class="sidebar-empty" style="padding: 10px 8px;">暂无历史目录</div>';
      return;
    }

    listEl.innerHTML = state.recentFolders
      .slice(0, 8)
      .map(folder => {
        const isCurrent = folder.path === state.rootPath;
        const shortPath = shortenHomePath(folder.path);
        return `
          <div class="dir-recent-item ${isCurrent ? 'is-current' : ''}" data-folder-path="${Renderers.escapeHtml(folder.path)}">
            <span class="dir-recent-icon">${isCurrent ? Icons.check : Icons.folderClosed}</span>
            <div class="dir-recent-info">
              <div class="dir-recent-title">${Renderers.escapeHtml(folder.name)}</div>
              <div class="dir-recent-path">${Renderers.escapeHtml(shortPath)}</div>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.dir-recent-item').forEach(el => {
      el.addEventListener('click', () => {
        const p = el.dataset.folderPath;
        if (p) switchToFolderByPath(p);
      });
    });
  }

  function renderHistoryViews() {
    renderDirDropdownList();

    const foldersEl = document.getElementById('history-folders-list');
    const filesEl = document.getElementById('history-files-list');

    if (foldersEl) {
      if (state.recentFolders.length === 0) {
        foldersEl.innerHTML = '<div class="sidebar-empty" style="padding: 12px 8px;">暂无最近打开的目录</div>';
      } else {
        foldersEl.innerHTML = state.recentFolders
          .map(folder => {
            const isCurrent = folder.path === state.rootPath;
            const shortPath = shortenHomePath(folder.path);
            return `
              <div class="history-item ${isCurrent ? 'is-active' : ''}" data-hist-folder="${Renderers.escapeHtml(folder.path)}" title="${Renderers.escapeHtml(folder.path)}">
                <span class="history-item-icon">${Icons.folderClosed}</span>
                <div class="history-item-main">
                  <div class="history-item-title">${Renderers.escapeHtml(folder.name)}${isCurrent ? ' (当前)' : ''}</div>
                  <div class="history-item-sub">${Renderers.escapeHtml(shortPath)}</div>
                </div>
                <button type="button" class="history-item-del" data-del-folder="${Renderers.escapeHtml(folder.path)}" title="从历史中移除">×</button>
              </div>
            `;
          })
          .join('');

        foldersEl.querySelectorAll('.history-item').forEach(el => {
          el.addEventListener('click', e => {
            const delBtn = e.target.closest('.history-item-del');
            if (delBtn) {
              e.stopPropagation();
              const targetPath = delBtn.dataset.delFolder;
              state.recentFolders = state.recentFolders.filter(f => f.path !== targetPath);
              persistHistory();
              renderHistoryViews();
              return;
            }
            const targetPath = el.dataset.histFolder;
            if (targetPath) switchToFolderByPath(targetPath);
          });
        });
      }
    }

    if (filesEl) {
      if (state.recentFiles.length === 0) {
        filesEl.innerHTML = '<div class="sidebar-empty" style="padding: 12px 8px;">暂无最近打开的文档</div>';
      } else {
        filesEl.innerHTML = state.recentFiles
          .map(file => {
            const isCurrent = file.path === state.currentFilePath;
            const shortDir = shortenHomePath(file.folderPath || '');
            const relTime = formatRelativeTime(file.openedAt);
            const subText = [shortDir, relTime].filter(Boolean).join(' · ');
            return `
              <div class="history-item ${isCurrent ? 'is-active' : ''}" data-hist-file="${Renderers.escapeHtml(file.path)}" title="${Renderers.escapeHtml(file.path)}">
                <span class="history-item-icon">${Icons.fileForName(file.name)}</span>
                <div class="history-item-main">
                  <div class="history-item-title">${Renderers.escapeHtml(file.name)}</div>
                  <div class="history-item-sub">${Renderers.escapeHtml(subText)}</div>
                </div>
                <button type="button" class="history-item-del" data-del-file="${Renderers.escapeHtml(file.path)}" title="从历史中移除">×</button>
              </div>
            `;
          })
          .join('');

        filesEl.querySelectorAll('.history-item').forEach(el => {
          el.addEventListener('click', e => {
            const delBtn = e.target.closest('.history-item-del');
            if (delBtn) {
              e.stopPropagation();
              const targetPath = delBtn.dataset.delFile;
              state.recentFiles = state.recentFiles.filter(f => f.path !== targetPath);
              persistHistory();
              renderHistoryViews();
              return;
            }
            const targetPath = el.dataset.histFile;
            if (targetPath) openRecentFileByPath(targetPath);
          });
        });
      }
    }
  }

  /* ==========================================================================
   * STATUS BAR, WORD COUNT & THEMES
   * ========================================================================== */

  function updateStatusBar() {
    const stats = Parser.computeDocumentStats(state.markdown);
    const wordsEl = document.getElementById('stat-words');
    const charsEl = document.getElementById('stat-chars');
    const linesEl = document.getElementById('stat-lines');
    const readEl = document.getElementById('stat-reading');
    const saveStateEl = document.getElementById('stat-save-state');

    if (wordsEl) wordsEl.textContent = `${stats.words} 词`;
    if (charsEl) charsEl.textContent = `${stats.chars} 字符`;
    if (linesEl) linesEl.textContent = `${stats.lines} 行`;
    if (readEl) readEl.textContent = `约 ${stats.readingMinutes} 分钟阅读`;
    if (saveStateEl) {
      saveStateEl.textContent = state.isDirty ? '● 未保存' : '✓ 已同步';
      saveStateEl.classList.toggle('is-dirty', state.isDirty);
    }
  }

  function resolveEffectiveTheme(themeName) {
    if (themeName === 'auto') {
      return darkMediaQuery && darkMediaQuery.matches ? 'night-dark' : 'github-light';
    }
    return themeName || 'github-light';
  }

  function applyTheme(themeName) {
    state.theme = themeName || 'github-light';
    const effective = resolveEffectiveTheme(state.theme);
    document.documentElement.setAttribute('data-theme', effective);
    localStorage.setItem('markora_theme', state.theme);

    document.querySelectorAll('[data-theme-opt]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeOpt === state.theme);
    });
  }

  /* ==========================================================================
   * IN-DOCUMENT FIND & REPLACE (Cmd + F)
   * ========================================================================== */

  function clearSearchBlockHighlights() {
    document.querySelectorAll('.mk-block.is-search-match').forEach(el => {
      el.classList.remove('is-search-match');
    });
  }

  function openFindBar(showReplace = false) {
    const bar = document.getElementById('find-bar');
    const findInput = document.getElementById('find-input');
    const replaceRow = document.getElementById('replace-row');
    if (!bar || !findInput) return;

    state.findBarOpen = true;
    bar.classList.remove('hidden');
    if (showReplace) {
      state.replaceBarOpen = true;
      replaceRow?.classList.remove('hidden');
    }

    const sel = window.getSelection();
    const selStr = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    if (selStr && !selStr.includes('\n')) {
      findInput.value = selStr;
    }

    setTimeout(() => {
      findInput.focus();
      findInput.select();
      runInDocSearch(true);
    }, 15);
  }

  function closeFindBar() {
    state.findBarOpen = false;
    state.findMatches = [];
    state.findActiveIndex = -1;
    document.getElementById('find-bar')?.classList.add('hidden');
    clearSearchBlockHighlights();
  }

  function collectBlockMatches(query) {
    const q = query.toLowerCase();
    const matches = [];
    if (!q) return matches;

    const scanStr = (str, blockId, field, subIdx = -1, colIdx = -1) => {
      const s = String(str || '');
      const lower = s.toLowerCase();
      let pos = 0;
      while (pos <= lower.length - q.length) {
        const hit = lower.indexOf(q, pos);
        if (hit === -1) break;
        matches.push({ blockId, field, subIdx, colIdx, start: hit, length: query.length });
        pos = hit + Math.max(1, q.length);
      }
    };

    state.blocks.forEach(blk => {
      if (blk.text !== undefined) scanStr(blk.text, blk.id, 'text');
      else if (blk.code !== undefined) scanStr(blk.code, blk.id, 'code');
      else if (blk.latex !== undefined) scanStr(blk.latex, blk.id, 'latex');
      else if (blk.type === 'image') scanStr(blk.alt, blk.id, 'alt');
      else if (blk.type === 'ulist' || blk.type === 'olist') {
        (blk.items || []).forEach((it, idx) => scanStr(it, blk.id, 'listItem', idx));
      } else if (blk.type === 'tasklist') {
        (blk.items || []).forEach((it, idx) => scanStr(it.text, blk.id, 'taskItem', idx));
      } else if (blk.type === 'table') {
        (blk.headers || []).forEach((h, cIdx) => scanStr(h, blk.id, 'tableHeader', -1, cIdx));
        (blk.rows || []).forEach((row, rIdx) => {
          (row || []).forEach((cell, cIdx) => scanStr(cell, blk.id, 'tableCell', rIdx, cIdx));
        });
      }
    });
    return matches;
  }

  function runInDocSearch(scrollToMatch = true) {
    const findInput = document.getElementById('find-input');
    const countEl = document.getElementById('find-count');
    const query = findInput ? findInput.value : '';
    clearSearchBlockHighlights();

    if (!query) {
      state.findMatches = [];
      state.findActiveIndex = -1;
      if (countEl) countEl.textContent = '0/0';
      return;
    }

    if (state.sourceMode) {
      const ta = document.getElementById('source-textarea');
      const text = ta ? ta.value : state.markdown;
      const lower = text.toLowerCase();
      const q = query.toLowerCase();
      const hits = [];
      let pos = 0;
      while (pos <= lower.length - q.length) {
        const idx = lower.indexOf(q, pos);
        if (idx === -1) break;
        hits.push({ start: idx, end: idx + query.length });
        pos = idx + Math.max(1, q.length);
      }
      state.findMatches = hits;
      state.findActiveIndex = hits.length > 0 ? Math.min(Math.max(0, state.findActiveIndex), hits.length - 1) : -1;
      if (countEl) countEl.textContent = hits.length > 0 ? `${state.findActiveIndex + 1}/${hits.length}` : '0/0';
      if (scrollToMatch && hits.length > 0 && ta) {
        const m = hits[state.findActiveIndex];
        ta.setSelectionRange(m.start, m.end);
      }
      return;
    }

    const matches = collectBlockMatches(query);
    state.findMatches = matches;
    if (matches.length === 0) {
      state.findActiveIndex = -1;
      if (countEl) countEl.textContent = '0/0';
      return;
    }
    if (state.findActiveIndex < 0 || state.findActiveIndex >= matches.length) {
      state.findActiveIndex = 0;
    }
    if (countEl) countEl.textContent = `${state.findActiveIndex + 1}/${matches.length}`;
    if (scrollToMatch) {
      highlightActiveFindMatch();
    }
  }

  function highlightActiveFindMatch() {
    clearSearchBlockHighlights();
    if (state.findActiveIndex < 0 || state.findActiveIndex >= state.findMatches.length) return;
    const match = state.findMatches[state.findActiveIndex];

    if (state.sourceMode) {
      const ta = document.getElementById('source-textarea');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(match.start, match.end);
        document.getElementById('find-input')?.focus();
      }
      return;
    }

    const blkEl = document.querySelector(`[data-block-id="${match.blockId}"]`);
    if (blkEl) {
      blkEl.classList.add('is-search-match');
      blkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function stepFindMatch(delta) {
    if (state.findMatches.length === 0) {
      runInDocSearch(true);
      return;
    }
    state.findActiveIndex = (state.findActiveIndex + delta + state.findMatches.length) % state.findMatches.length;
    const countEl = document.getElementById('find-count');
    if (countEl) countEl.textContent = `${state.findActiveIndex + 1}/${state.findMatches.length}`;
    highlightActiveFindMatch();
  }

  function applyStringReplaceAt(str, start, length, replacement) {
    const s = String(str || '');
    return s.slice(0, start) + replacement + s.slice(start + length);
  }

  function replaceSingleMatch() {
    const findInput = document.getElementById('find-input');
    const replaceInput = document.getElementById('replace-input');
    const query = findInput ? findInput.value : '';
    const replacement = replaceInput ? replaceInput.value : '';
    if (!query) return;

    if (state.findMatches.length === 0) {
      runInDocSearch(true);
      if (state.findMatches.length === 0) return;
    }

    recordUndoSnapshot();

    if (state.sourceMode) {
      const ta = document.getElementById('source-textarea');
      if (!ta) return;
      const m = state.findMatches[state.findActiveIndex];
      ta.value = ta.value.slice(0, m.start) + replacement + ta.value.slice(m.end);
      state.markdown = ta.value;
      state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
      markDirtyAndSync(true);
      syncSourceEditor();
      runInDocSearch(true);
      return;
    }

    const m = state.findMatches[state.findActiveIndex];
    const blk = state.blocks.find(b => b.id === m.blockId);
    if (!blk) return;

    if (m.field === 'text') blk.text = applyStringReplaceAt(blk.text, m.start, m.length, replacement);
    else if (m.field === 'code') blk.code = applyStringReplaceAt(blk.code, m.start, m.length, replacement);
    else if (m.field === 'latex') blk.latex = applyStringReplaceAt(blk.latex, m.start, m.length, replacement);
    else if (m.field === 'alt') blk.alt = applyStringReplaceAt(blk.alt, m.start, m.length, replacement);
    else if (m.field === 'listItem') blk.items[m.subIdx] = applyStringReplaceAt(blk.items[m.subIdx], m.start, m.length, replacement);
    else if (m.field === 'taskItem') blk.items[m.subIdx].text = applyStringReplaceAt(blk.items[m.subIdx].text, m.start, m.length, replacement);
    else if (m.field === 'tableHeader') blk.headers[m.colIdx] = applyStringReplaceAt(blk.headers[m.colIdx], m.start, m.length, replacement);
    else if (m.field === 'tableCell') blk.rows[m.subIdx][m.colIdx] = applyStringReplaceAt(blk.rows[m.subIdx][m.colIdx], m.start, m.length, replacement);

    replaceBlockDOM(blk);
    markDirtyAndSync(blk.type === 'heading');
    runInDocSearch(true);
  }

  function replaceAllMatches() {
    const findInput = document.getElementById('find-input');
    const replaceInput = document.getElementById('replace-input');
    const query = findInput ? findInput.value : '';
    const replacement = replaceInput ? replaceInput.value : '';
    if (!query) return;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');

    if (state.sourceMode) {
      const ta = document.getElementById('source-textarea');
      if (!ta) return;
      const matches = ta.value.match(regex);
      if (!matches || matches.length === 0) return;
      recordUndoSnapshot();
      ta.value = ta.value.replace(regex, replacement);
      state.markdown = ta.value;
      state.blocks = Parser.parseMarkdownToBlocks(state.markdown);
      markDirtyAndSync(true);
      syncSourceEditor();
      runInDocSearch(false);
      showToast(`已全部替换 ${matches.length} 处`);
      return;
    }

    const total = collectBlockMatches(query).length;
    if (total === 0) return;
    recordUndoSnapshot();

    state.blocks.forEach(blk => {
      if (blk.text !== undefined) blk.text = String(blk.text).replace(regex, replacement);
      else if (blk.code !== undefined) blk.code = String(blk.code).replace(regex, replacement);
      else if (blk.latex !== undefined) blk.latex = String(blk.latex).replace(regex, replacement);
      else if (blk.type === 'image') blk.alt = String(blk.alt || '').replace(regex, replacement);
      else if (blk.type === 'ulist' || blk.type === 'olist') {
        blk.items = (blk.items || []).map(it => String(it).replace(regex, replacement));
      } else if (blk.type === 'tasklist') {
        blk.items = (blk.items || []).map(it => ({ ...it, text: String(it.text || '').replace(regex, replacement) }));
      } else if (blk.type === 'table') {
        blk.headers = (blk.headers || []).map(h => String(h).replace(regex, replacement));
        blk.rows = (blk.rows || []).map(r => (r || []).map(c => String(c).replace(regex, replacement)));
      }
    });

    renderCanvas();
    markDirtyAndSync(true);
    runInDocSearch(false);
    showToast(`已全部替换 ${total} 处`);
  }

  /* ==========================================================================
   * QUICK OPEN & WORKSPACE FULL-TEXT SEARCH PALETTE (Cmd + P)
   * ========================================================================== */

  let quickOpenTimer = null;

  async function openQuickOpenModal() {
    const modal = document.getElementById('quick-open-modal');
    const input = document.getElementById('quick-open-input');
    if (!modal || !input) return;

    state.quickOpenVisible = true;
    state.quickOpenIndex = 0;
    modal.classList.remove('hidden');
    input.value = '';
    setTimeout(() => input.focus(), 15);
    await performQuickOpenSearch('');
  }

  function closeQuickOpenModal() {
    state.quickOpenVisible = false;
    document.getElementById('quick-open-modal')?.classList.add('hidden');
  }

  async function performQuickOpenSearch(query) {
    try {
      const res = await Bridge.searchWorkspace(query);
      state.quickOpenResults = (res && Array.isArray(res.results)) ? res.results : [];
      state.quickOpenIndex = 0;
      renderQuickOpenList(query);
    } catch (e) {
      state.quickOpenResults = [];
      renderQuickOpenList(query);
    }
  }

  function highlightQueryHtml(rawStr, query) {
    const safe = Renderers.escapeHtml(rawStr || '');
    const q = String(query || '').trim();
    if (!q) return safe;
    const escapedQ = Renderers.escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${escapedQ})`, 'gi'), '<mark class="palette-hl">$1</mark>');
  }

  function renderQuickOpenList(query = '') {
    const listEl = document.getElementById('quick-open-results');
    if (!listEl) return;

    if (state.quickOpenResults.length === 0) {
      listEl.innerHTML = '<div class="sidebar-empty">未找到匹配的文档或内容</div>';
      return;
    }

    listEl.innerHTML = state.quickOpenResults
      .map((item, idx) => {
        const isSel = idx === state.quickOpenIndex;
        const locBadge = item.line > 0 ? `第 ${item.line} 行` : (item.relPath || '');
        const snippetHtml = item.matchType === 'content'
          ? `<div class="palette-item-snippet">${highlightQueryHtml(item.snippet, query)}</div>`
          : (item.relPath && item.relPath !== item.name
              ? `<div class="palette-item-snippet">${Renderers.escapeHtml(item.relPath)}</div>`
              : '');
        return `
          <div class="palette-item ${isSel ? 'is-selected' : ''}" data-qidx="${idx}">
            <span class="palette-item-icon">${Icons.fileForName(item.name)}</span>
            <div class="palette-item-body">
              <div class="palette-item-top">
                <span class="palette-item-title">${highlightQueryHtml(item.name, query)}</span>
                <span class="palette-item-loc">${Renderers.escapeHtml(locBadge)}</span>
              </div>
              ${snippetHtml}
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.palette-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.qidx);
        activateQuickOpenItem(idx);
      });
    });

    const activeEl = listEl.querySelector('.palette-item.is-selected');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }

  async function activateQuickOpenItem(idx) {
    const item = state.quickOpenResults[idx];
    if (!item) return;
    const query = (document.getElementById('quick-open-input')?.value || '').trim();
    closeQuickOpenModal();

    if (item.path !== state.currentFilePath) {
      if (state.isDirty && state.currentFilePath) {
        await saveCurrentDocument(true);
      }
      await openFileFromTree(item.path);
    }

    if (item.matchType === 'content' && query) {
      requestAnimationFrame(() => {
        if (state.sourceMode && item.line > 0) {
          const ta = document.getElementById('source-textarea');
          if (ta) {
            const lines = ta.value.split('\n');
            const charStart = lines.slice(0, item.line - 1).join('\n').length + (item.line > 1 ? 1 : 0);
            ta.focus();
            ta.setSelectionRange(charStart, charStart + (lines[item.line - 1] || '').length);
          }
          return;
        }
        const matches = collectBlockMatches(query);
        if (matches.length > 0) {
          const snippetProbe = (item.snippet || '').slice(0, 24).toLowerCase();
          const best = matches.find(m => {
            const blk = state.blocks.find(b => b.id === m.blockId);
            const rawBlk = Parser.serializeBlocksToMarkdown([blk]).toLowerCase();
            return snippetProbe && rawBlk.includes(snippetProbe);
          }) || matches[0];
          const blkEl = document.querySelector(`[data-block-id="${best.blockId}"]`);
          if (blkEl) {
            clearSearchBlockHighlights();
            blkEl.classList.add('is-search-match');
            blkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => blkEl.classList.remove('is-search-match'), 2000);
          }
        }
      });
    }
  }

  /* ==========================================================================
   * EXPORT HTML & PDF
   * ========================================================================== */

  async function handleExportHTML() {
    const canvas = document.getElementById('wysiwyg-canvas');
    const cssText = Array.from(document.styleSheets)
      .map(sheet => {
        try {
          return Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
        } catch (e) {
          return '';
        }
      })
      .join('\n');

    const title = state.currentFileName.replace(/\.md$/i, '');
    const effectiveTheme = resolveEffectiveTheme(state.theme);
    const htmlDoc = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${effectiveTheme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${Renderers.escapeHtml(title)}</title>
  <style>
    ${cssText}
    body { overflow: auto !important; height: auto !important; padding: 48px 24px; }
    .mk-block-gutter, .mk-code-actions, .mk-table-toolbar, .mk-mermaid-actions, .mk-image-controls, .mk-special-drawer { display: none !important; }
    #export-container { max-width: 820px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="export-container" class="wysiwyg-canvas">
    ${canvas ? canvas.innerHTML : ''}
  </div>
</body>
</html>`;

    const res = await Bridge.exportHTML(`${title}.html`, htmlDoc);
    if (res && res.ok) {
      showToast(`已导出 ${title}.html`);
    }
  }

  async function handleExportPDF() {
    const title = state.currentFileName.replace(/\.md$/i, '');
    const res = await Bridge.exportPDF(`${title}.pdf`);
    if (res && res.ok) {
      showToast(`已导出 PDF 文档`);
    }
  }

  /* ==========================================================================
   * FLOATING SELECTION TOOLBAR & UI EVENTS
   * ========================================================================== */

  function updateFloatingToolbar() {
    const toolbar = document.getElementById('floating-toolbar');
    if (!toolbar || state.sourceMode) {
      hideFloatingToolbar();
      return;
    }
    if (hasCrossRange()) {
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideFloatingToolbar();
      return;
    }

    const anchorEl = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    if (!anchorEl || !anchorEl.closest('#wysiwyg-canvas')) {
      hideFloatingToolbar();
      return;
    }

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0) {
      hideFloatingToolbar();
      return;
    }

    toolbar.style.top = `${Math.max(12, rect.top - 46)}px`;
    toolbar.style.left = `${Math.max(16, rect.left + rect.width / 2 - 140)}px`;
    toolbar.classList.add('visible');
  }

  function hideFloatingToolbar() {
    const toolbar = document.getElementById('floating-toolbar');
    if (toolbar) toolbar.classList.remove('visible');
  }

  function showToast(msg) {
    const toast = document.getElementById('mk-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  function bindUIControls() {
    // Sidebar Toggle
    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
      state.sidebarOpen = !state.sidebarOpen;
      document.getElementById('app-layout')?.classList.toggle('sidebar-collapsed', !state.sidebarOpen);
    });

    // Sidebar Resizer Drag Handle (200px .. 440px, double-click resets to 265px)
    const resizer = document.getElementById('sidebar-resizer');
    const layoutEl = document.getElementById('app-layout');
    if (resizer && layoutEl) {
      resizer.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        layoutEl.classList.add('is-resizing');
        const onMove = ev => {
          const nextW = Math.min(440, Math.max(200, ev.clientX));
          state.sidebarWidth = nextW;
          layoutEl.style.setProperty('--sidebar-width', `${nextW}px`);
        };
        const onUp = () => {
          layoutEl.classList.remove('is-resizing');
          localStorage.setItem('markora_sidebar_width', String(state.sidebarWidth));
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      resizer.addEventListener('dblclick', () => {
        state.sidebarWidth = 265;
        layoutEl.style.setProperty('--sidebar-width', '265px');
        localStorage.setItem('markora_sidebar_width', '265');
      });
    }

    // Quick Open Button in Titlebar
    document.getElementById('btn-quick-open')?.addEventListener('click', openQuickOpenModal);

    // External Conflict Banner Actions
    document.getElementById('btn-conflict-reload')?.addEventListener('click', () => {
      if (state.pendingExternalContent !== null) {
        applyExternalContentToEditor(state.pendingExternalContent, true);
        showToast('已加载外部最新版本');
      } else {
        hideExternalConflictBanner();
      }
    });
    document.getElementById('btn-conflict-keep')?.addEventListener('click', async () => {
      state.pendingExternalContent = null;
      hideExternalConflictBanner();
      await saveCurrentDocument(false);
    });

    // Sidebar Tabs (Files / Outline / History)
    document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchSidebarTab(btn.dataset.tab);
      });
    });

    // Sidebar Right-Click Context Menu on File Tree
    document.getElementById('file-tree-list')?.addEventListener('contextmenu', openSidebarContextMenu);

    // Outline Scroll Spy on Editor Viewport Scroll
    let scrollSpyRaf = null;
    document.getElementById('editor-scroll-container')?.addEventListener('scroll', () => {
      if (scrollSpyRaf) return;
      scrollSpyRaf = requestAnimationFrame(() => {
        scrollSpyRaf = null;
        updateOutlineScrollSpy();
      });
    });

    // Directory Switcher Dropdown & Choose Folder Controls
    document.getElementById('btn-dir-switcher')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleDirDropdown();
    });
    document.getElementById('menu-choose-folder')?.addEventListener('click', promptChooseFolder);
    document.getElementById('btn-open-folder')?.addEventListener('click', promptChooseFolder);
    document.getElementById('btn-choose-dir-footer')?.addEventListener('click', promptChooseFolder);
    document.getElementById('btn-history-pick-dir')?.addEventListener('click', promptChooseFolder);

    document.getElementById('menu-choose-file')?.addEventListener('click', () => {
      toggleDirDropdown(false);
      document.getElementById('btn-open-file')?.click();
    });
    document.getElementById('btn-history-pick-file')?.addEventListener('click', () => {
      document.getElementById('btn-open-file')?.click();
    });
    document.getElementById('menu-reveal-finder')?.addEventListener('click', () => {
      toggleDirDropdown(false);
      Bridge.revealInFinder(state.currentFilePath || state.rootPath);
    });

    // Top Titlebar Folder Breadcrumb -> Open Sidebar Directory Switcher
    document.getElementById('doc-folder-name')?.addEventListener('click', e => {
      e.stopPropagation();
      switchSidebarTab('files');
      toggleDirDropdown(true);
    });

    // Clear History Button
    document.getElementById('btn-clear-history')?.addEventListener('click', () => {
      state.recentFolders = state.rootPath
        ? [{ path: state.rootPath, name: state.rootName || '工作区', openedAt: Date.now() }]
        : [];
      state.recentFiles = state.currentFilePath
        ? [{
            path: state.currentFilePath,
            name: state.currentFileName,
            folderPath: state.rootPath,
            openedAt: Date.now()
          }]
        : [];
      persistHistory();
      renderHistoryViews();
      showToast('已清空其他历史记录');
    });

    // File search filter
    document.getElementById('file-search-input')?.addEventListener('input', e => {
      state.fileSearchQuery = e.target.value;
      renderSidebarFiles();
    });

    // Open Single File
    document.getElementById('btn-open-file')?.addEventListener('click', async () => {
      if (state.isDirty && state.currentFilePath) {
        await saveCurrentDocument(true);
      }
      const file = await Bridge.openFileDialog();
      if (file) {
        loadDocument(file.path, file.name, file.content);
      }
    });

    // Unified Dialog Modal Controls
    document.getElementById('btn-new-file')?.addEventListener('click', () => openNewFileModal());
    document.getElementById('btn-dialog-cancel')?.addEventListener('click', closeDialogModal);
    document.getElementById('btn-dialog-confirm')?.addEventListener('click', async () => {
      const input = document.getElementById('dialog-modal-input');
      const val = input ? input.value : '';
      const fn = activeDialogConfirmHandler;
      closeDialogModal();
      if (fn) await fn(val);
    });
    document.getElementById('dialog-modal-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-dialog-confirm')?.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDialogModal();
      }
    });
    document.getElementById('dialog-modal')?.addEventListener('mousedown', e => {
      if (e.target.id === 'dialog-modal') closeDialogModal();
    });

    // In-Document Find & Replace Controls
    document.getElementById('find-input')?.addEventListener('input', () => {
      state.findActiveIndex = 0;
      runInDocSearch(true);
    });
    document.getElementById('find-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        stepFindMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
      }
    });
    document.getElementById('replace-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceSingleMatch();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
      }
    });
    document.getElementById('btn-find-prev')?.addEventListener('click', () => stepFindMatch(-1));
    document.getElementById('btn-find-next')?.addEventListener('click', () => stepFindMatch(1));
    document.getElementById('btn-toggle-replace')?.addEventListener('click', () => {
      state.replaceBarOpen = !state.replaceBarOpen;
      document.getElementById('replace-row')?.classList.toggle('hidden', !state.replaceBarOpen);
      if (state.replaceBarOpen) {
        document.getElementById('replace-input')?.focus();
      }
    });
    document.getElementById('btn-find-close')?.addEventListener('click', closeFindBar);
    document.getElementById('btn-replace-one')?.addEventListener('click', replaceSingleMatch);
    document.getElementById('btn-replace-all')?.addEventListener('click', replaceAllMatches);

    // Quick Open Palette Controls (Cmd + P)
    const qoInput = document.getElementById('quick-open-input');
    qoInput?.addEventListener('input', () => {
      clearTimeout(quickOpenTimer);
      quickOpenTimer = setTimeout(() => {
        performQuickOpenSearch(qoInput.value);
      }, 80);
    });
    qoInput?.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.quickOpenResults.length > 0) {
          state.quickOpenIndex = (state.quickOpenIndex + 1) % state.quickOpenResults.length;
          renderQuickOpenList(qoInput.value);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.quickOpenResults.length > 0) {
          state.quickOpenIndex = (state.quickOpenIndex - 1 + state.quickOpenResults.length) % state.quickOpenResults.length;
          renderQuickOpenList(qoInput.value);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        activateQuickOpenItem(state.quickOpenIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeQuickOpenModal();
      }
    });
    document.getElementById('quick-open-modal')?.addEventListener('mousedown', e => {
      if (e.target.id === 'quick-open-modal') closeQuickOpenModal();
    });

    // Image Lightbox Click to Close
    document.getElementById('image-lightbox')?.addEventListener('click', closeImageLightbox);

    // Source Mode Toggle
    document.getElementById('btn-source-mode')?.addEventListener('click', toggleSourceMode);

    // Source Textarea live sync
    const sourceTextarea = document.getElementById('source-textarea');
    sourceTextarea?.addEventListener('input', () => {
      recordUndoSnapshot('source-edit');
      state.markdown = sourceTextarea.value;
      state.isDirty = true;
      updateHeaderTitle();
      updateStatusBar();
      const sourceLines = document.getElementById('source-linenums');
      const count = Math.max(1, sourceTextarea.value.split('\n').length);
      if (sourceLines) {
        sourceLines.innerHTML = Array.from({ length: count }, (_, i) => `<div>${i + 1}</div>`).join('');
      }
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        if (state.isDirty && state.currentFilePath) {
          saveCurrentDocument(true);
        }
      }, 1200);
    });

    // Focus Mode Toggle
    document.getElementById('btn-focus-mode')?.addEventListener('click', () => {
      state.focusMode = !state.focusMode;
      document.body.classList.toggle('focus-mode', state.focusMode);
      document.getElementById('btn-focus-mode')?.classList.toggle('active', state.focusMode);
      showToast(state.focusMode ? '专注模式：已开启 (F8)' : '专注模式：已关闭');
    });

    // Typewriter Mode Toggle
    document.getElementById('btn-typewriter-mode')?.addEventListener('click', () => {
      state.typewriterMode = !state.typewriterMode;
      document.getElementById('btn-typewriter-mode')?.classList.toggle('active', state.typewriterMode);
      showToast(state.typewriterMode ? '打字机模式：已开启 (F9)' : '打字机模式：已关闭');
    });

    // Inline Syntax Reveal Toggle
    document.getElementById('btn-syntax-reveal')?.addEventListener('click', () => {
      state.revealInlineSyntax = !state.revealInlineSyntax;
      document.getElementById('btn-syntax-reveal')?.classList.toggle('active', state.revealInlineSyntax);
      renderCanvas();
      showToast(state.revealInlineSyntax ? '焦点段落行内标记：显示' : '焦点段落行内标记：隐藏（纯排版视图）');
    });

    // Theme Switcher
    document.querySelectorAll('[data-theme-opt]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.themeOpt);
      });
    });

    // Save & Export Buttons
    document.getElementById('btn-save-doc')?.addEventListener('click', () => saveCurrentDocument(false));
    document.getElementById('btn-export-html')?.addEventListener('click', handleExportHTML);
    document.getElementById('btn-export-pdf')?.addEventListener('click', handleExportPDF);

    // Floating Toolbar Buttons
    document.querySelectorAll('#floating-toolbar button[data-fmt]').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const fmt = btn.dataset.fmt;
        if (fmt === 'bold') applyInlineFormatting('**');
        else if (fmt === 'italic') applyInlineFormatting('*');
        else if (fmt === 'code') applyInlineFormatting('`');
        else if (fmt === 'strike') applyInlineFormatting('~~');
        else if (fmt === 'highlight') applyInlineFormatting('==');
        else if (fmt === 'math') applyInlineFormatting('$');
        else if (fmt === 'link') applyInlineFormatting('[', '](https://)');
      });
    });
  }

  function isWindowDragZone(target) {
    if (!target || target.nodeType !== 1) return false;
    // Never drag when clicking interactive controls
    if (target.closest('button, input, textarea, select, a, .theme-pills')) {
      return false;
    }
    return Boolean(
      target.closest('#top-titlebar') ||
      target.closest('.sidebar-top-bar') ||
      target.closest('#status-bar')
    );
  }

  function writePlainTextToClipboard(text) {
    const bridge = document.getElementById('block-selection-bridge');
    let copied = false;
    if (bridge) {
      bridge.value = text;
      try {
        bridge.focus({ preventScroll: true });
      } catch (e) {
        bridge.focus();
      }
      bridge.setSelectionRange(0, bridge.value.length);
      try {
        copied = document.execCommand('copy');
      } catch (e) {}
    }
    if (!copied && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function findBlockIdAtClientY(clientY) {
    const canvas = document.getElementById('wysiwyg-canvas');
    if (!canvas) return null;
    const blockEls = Array.from(canvas.querySelectorAll(':scope > .mk-block'));
    if (blockEls.length === 0) return null;

    const firstRect = blockEls[0].getBoundingClientRect();
    if (clientY <= firstRect.top) return blockEls[0].dataset.blockId;

    const lastRect = blockEls[blockEls.length - 1].getBoundingClientRect();
    if (clientY >= lastRect.bottom) return blockEls[blockEls.length - 1].dataset.blockId;

    let closestId = blockEls[0].dataset.blockId;
    let bestDist = Infinity;
    for (const el of blockEls) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        return el.dataset.blockId;
      }
      const dist = clientY < r.top ? r.top - clientY : clientY - r.bottom;
      if (dist < bestDist) {
        bestDist = dist;
        closestId = el.dataset.blockId;
      }
    }
    return closestId;
  }

  function findBlockIdsIntersectingYBand(minY, maxY) {
    const canvas = document.getElementById('wysiwyg-canvas');
    if (!canvas) return [];
    const ids = [];
    canvas.querySelectorAll(':scope > .mk-block').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom >= minY && r.top <= maxY && el.dataset.blockId) {
        ids.push(el.dataset.blockId);
      }
    });
    return ids;
  }

  function bindGlobalEvents() {
    let suppressNextCanvasClick = false;
    let bridgeComposing = false;

    document.addEventListener('selectionchange', () => {
      requestAnimationFrame(updateFloatingToolbar);
    });

    // Floating Cross-Block Selection Action Pill (#block-selection-bar)
    document.getElementById('block-selection-bar')?.addEventListener('mousedown', e => {
      e.preventDefault(); // Keep focus on #block-selection-bridge
      e.stopPropagation();
      const btn = e.target.closest('button[data-bsel-act]');
      if (!btn || !hasBlockSelection()) return;
      const act = btn.dataset.bselAct;
      const count = state.selectedBlockIds.size;
      if (act === 'copy') {
        writePlainTextToClipboard(getSelectedBlocksMarkdown());
        syncBlockSelectionUI(true);
        showToast(`已复制 ${count} 个块 Markdown`);
      } else if (act === 'cut') {
        writePlainTextToClipboard(getSelectedBlocksMarkdown());
        deleteSelectedBlocks('backward');
        showToast(`已剪切 ${count} 个块`);
      } else if (act === 'duplicate') {
        duplicateBlocksByIds();
      } else if (act === 'move-up') {
        moveBlocksByStep(-1);
      } else if (act === 'move-down') {
        moveBlocksByStep(1);
      } else if (act === 'delete') {
        deleteSelectedBlocks('backward');
      } else if (act === 'clear') {
        clearBlockSelection(true);
      }
    });

    // Offscreen Native Clipboard & IME Bridge (#block-selection-bridge)
    const selBridge = document.getElementById('block-selection-bridge');
    if (selBridge) {
      selBridge.addEventListener('copy', e => {
        if (hasCrossRange()) {
          const md = extractCrossRangeMarkdown();
          if (e.clipboardData) {
            e.preventDefault();
            e.clipboardData.setData('text/plain', md);
          }
          showToast('已复制选中内容');
          return;
        }
        if (!hasBlockSelection()) return;
        const md = getSelectedBlocksMarkdown();
        if (e.clipboardData) {
          e.preventDefault();
          e.clipboardData.setData('text/plain', md);
        }
        showToast(`已复制 ${state.selectedBlockIds.size} 个块 Markdown`);
      });

      selBridge.addEventListener('cut', e => {
        if (hasCrossRange()) {
          const md = extractCrossRangeMarkdown();
          if (e.clipboardData) {
            e.preventDefault();
            e.clipboardData.setData('text/plain', md);
          }
          deleteCrossRange(null);
          showToast('已剪切选中内容');
          return;
        }
        if (!hasBlockSelection()) return;
        const count = state.selectedBlockIds.size;
        const md = getSelectedBlocksMarkdown();
        if (e.clipboardData) {
          e.preventDefault();
          e.clipboardData.setData('text/plain', md);
        }
        deleteSelectedBlocks('backward');
        showToast(`已剪切 ${count} 个块`);
      });

      selBridge.addEventListener('compositionstart', () => {
        bridgeComposing = true;
      });

      const commitBridgeTypedReplacement = () => {
        if (hasCrossRange()) {
          const typed = selBridge.value || '';
          deleteCrossRange(typed);
          return;
        }
        if (!hasBlockSelection()) return;
        const typed = selBridge.value || '';
        const indices = getSelectedBlockIndices();
        if (indices.length === 0) return;

        recordUndoSnapshot();
        const firstIdx = indices[0];
        const selectedSet = new Set(state.selectedBlockIds);
        const newPara = { id: Parser.nextBlockId(), type: 'paragraph', text: typed };
        const remaining = [];
        let inserted = false;
        state.blocks.forEach((blk, idx) => {
          if (selectedSet.has(blk.id)) {
            if (!inserted && idx >= firstIdx) {
              remaining.push(newPara);
              inserted = true;
            }
          } else {
            remaining.push(blk);
          }
        });
        if (!inserted) remaining.push(newPara);

        state.blocks = remaining;
        clearBlockSelection(false);
        ensureTrailingParagraph();
        state.activeBlockId = newPara.id;
        markDirtyAndSync(true);
        renderCanvas();
        focusBlockById(newPara.id, 'end');
      };

      selBridge.addEventListener('compositionend', () => {
        bridgeComposing = false;
        commitBridgeTypedReplacement();
      });

      selBridge.addEventListener('input', () => {
        if (bridgeComposing || (!hasCrossRange() && !hasBlockSelection())) return;
        commitBridgeTypedReplacement();
      });

      selBridge.addEventListener('keydown', e => {
        if (!hasCrossRange() && !hasBlockSelection()) return;
        const meta = e.metaKey || e.ctrlKey;
        if (meta || e.altKey) return; // Let global shortcuts / native copy-cut-paste run

        // 1. Character-accurate Cross-Block Text Range Active
        if (hasCrossRange()) {
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            deleteCrossRange(null);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            clearCrossRange(true);
            return;
          }
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            const norm = normalizeCrossRange();
            if (
              norm &&
              norm.start.blockIdx < norm.end.blockIdx &&
              isTextMergeableType(state.blocks[norm.start.blockIdx]?.type) &&
              isTextMergeableType(state.blocks[norm.end.blockIdx]?.type)
            ) {
              recordUndoSnapshot();
              clearCrossRange(false);
              const bS = state.blocks[norm.start.blockIdx];
              const bE = state.blocks[norm.end.blockIdx];
              bS.text = (bS.text || '').slice(0, norm.start.mdOffset || 0);
              bE.text = (bE.text || '').slice(norm.end.mdOffset || 0);
              if (norm.end.blockIdx - norm.start.blockIdx > 1) {
                state.blocks.splice(norm.start.blockIdx + 1, norm.end.blockIdx - norm.start.blockIdx - 1);
              }
              ensureTrailingParagraph();
              state.activeBlockId = bE.id;
              markDirtyAndSync(true);
              renderCanvas();
              focusBlockById(bE.id, 0);
            } else {
              deleteCrossRange('');
            }
            return;
          }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
              const nextFocus = stepEndpointByArrow(state.crossRange.focus, e.key);
              if (nextFocus) {
                setCrossRange(state.crossRange.anchor, nextFocus, true);
                const domEl = document.querySelector(`[data-block-id="${nextFocus.blockId}"]`);
                domEl?.scrollIntoView({ block: 'nearest' });
              }
            } else {
              const norm = normalizeCrossRange();
              clearCrossRange(false);
              if (norm) {
                const targetEp = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? norm.start : norm.end;
                focusAtEndpoint(targetEp);
              }
            }
            return;
          }
          return;
        }

        // 2. Explicit Whole-Block Selection Active
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          e.stopPropagation();
          deleteSelectedBlocks(e.key === 'Delete' ? 'forward' : 'backward');
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          clearBlockSelection(true);
          return;
        }
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          const ordered = getSelectedBlocksOrdered();
          if (ordered.length === 1) {
            const targetId = ordered[0].id;
            clearBlockSelection(false);
            insertBlockAfter(targetId, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
          } else {
            replaceSelectedBlocksWithMarkdown('');
          }
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey && e.key === 'ArrowUp') {
            extendBlockSelectionByStep(-1);
          } else {
            const ordered = getSelectedBlocksOrdered();
            const firstId = ordered[0]?.id || state.activeBlockId;
            clearBlockSelection(false);
            if (firstId) focusBlockById(firstId, 'start');
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey && e.key === 'ArrowDown') {
            extendBlockSelectionByStep(1);
          } else {
            const ordered = getSelectedBlocksOrdered();
            const lastId = ordered[ordered.length - 1]?.id || state.activeBlockId;
            clearBlockSelection(false);
            if (lastId) focusBlockById(lastId, 'end');
          }
        }
      });
    }

    // Cross-Block Mouse Selection:
    // - Dragging text across blocks / Shift+Click inside text -> Character-accurate Cross-Block Text Selection!
    // - Dragging in blank left/right margin -> Whole-Block Lasso Selection!
    const scroller = document.getElementById('editor-scroll-container');
    const dragSel = {
      active: false,
      startX: 0,
      startY: 0,
      originBlockId: null,
      originEditable: null,
      anchorEndpoint: null,
      startedInMargin: false,
      isCrossTextDragging: false,
      isMarginBlockDragging: false
    };

    scroller?.addEventListener('mousedown', e => {
      if (e.button !== 0 || state.sourceMode) return;
      if (e.target.closest('#source-editor-container')) return;
      if (e.target.closest('button, select, input, a, .mk-block-gutter')) return;

      const clickedBlockEl = e.target.closest('.mk-block');
      const clickedBlockId = clickedBlockEl?.dataset.blockId || null;

      // Shift + Click:
      // - If already in explicit whole-block selection mode (or clicked in margin while blocks selected), extend block range
      // - Otherwise perform character-accurate Cross-Block Text Selection from current caret to clicked point!
      if (e.shiftKey) {
        if (hasBlockSelection()) {
          const anchorId = state.selectionAnchorBlockId || state.activeBlockId;
          const targetId = clickedBlockId || findBlockIdAtClientY(e.clientY);
          if (anchorId && targetId) {
            e.preventDefault();
            suppressNextCanvasClick = true;
            setTimeout(() => { suppressNextCanvasClick = false; }, 80);
            setBlockRangeSelection(anchorId, targetId, true);
            return;
          }
        } else {
          const anchorEp = hasCrossRange() ? state.crossRange.anchor : getCurrentCaretEndpoint(true);
          const focusEp = resolveEndpointFromPoint(e.clientX, e.clientY);
          if (anchorEp && focusEp && (hasCrossRange() || !isSameSubEditable(anchorEp, focusEp))) {
            e.preventDefault();
            suppressNextCanvasClick = true;
            setTimeout(() => { suppressNextCanvasClick = false; }, 80);
            setCrossRange(anchorEp, focusEp, true);
            return;
          }
        }
      }

      // Cmd + Click while in explicit whole-block selection mode -> Toggle individual block
      if ((e.metaKey || e.ctrlKey) && clickedBlockId && hasBlockSelection()) {
        e.preventDefault();
        suppressNextCanvasClick = true;
        setTimeout(() => { suppressNextCanvasClick = false; }, 80);
        toggleSingleBlockSelection(clickedBlockId);
        return;
      }

      // Normal click clears any prior cross-block / multi-block selection before starting fresh interaction
      if (hasCrossRange()) {
        clearCrossRange(false);
      }
      if (hasBlockSelection()) {
        clearBlockSelection(false);
      }

      dragSel.active = true;
      dragSel.startX = e.clientX;
      dragSel.startY = e.clientY;
      dragSel.originBlockId = clickedBlockId || findBlockIdAtClientY(e.clientY);
      dragSel.originEditable = clickedBlockEl
        ? e.target.closest('.mk-editable, .mk-code-textarea, .mk-special-textarea, th, td')
        : null;
      dragSel.anchorEndpoint = clickedBlockEl ? resolveEndpointFromPoint(e.clientX, e.clientY) : null;
      dragSel.startedInMargin = !clickedBlockId;
      dragSel.isCrossTextDragging = false;
      dragSel.isMarginBlockDragging = false;
      if (dragSel.startedInMargin) {
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', ev => {
      if (!dragSel.active) return;
      if ((ev.buttons & 1) === 0) {
        dragSel.active = false;
        document.body.classList.remove('is-block-selecting');
        return;
      }

      const dist = Math.hypot(ev.clientX - dragSel.startX, ev.clientY - dragSel.startY);
      if (dist < 5) return;

      if (dragSel.startedInMargin) {
        const minY = Math.min(dragSel.startY, ev.clientY);
        const maxY = Math.max(dragSel.startY, ev.clientY);
        const hitIds = findBlockIdsIntersectingYBand(minY, maxY);
        if (hitIds.length > 0) {
          dragSel.isMarginBlockDragging = true;
          document.body.classList.add('is-block-selecting');
          const anchor = ev.clientY >= dragSel.startY ? hitIds[0] : hitIds[hitIds.length - 1];
          const focus = ev.clientY >= dragSel.startY ? hitIds[hitIds.length - 1] : hitIds[0];
          setBlockRangeSelection(anchor, focus, false);
        }
      } else {
        const hoveredEditable = ev.target?.nodeType === 1
          ? ev.target.closest?.('.mk-editable, .mk-code-textarea, .mk-special-textarea, th, td')
          : null;
        const hoveredBlockEl = ev.target?.nodeType === 1 ? ev.target.closest?.('.mk-block') : null;

        if (!dragSel.isCrossTextDragging) {
          // Stay 100% out of WebKit's way while dragging inside the SAME editable!
          if (dragSel.originEditable && hoveredEditable === dragSel.originEditable) {
            return;
          }
          if (!dragSel.originEditable && hoveredBlockEl?.dataset.blockId === dragSel.originBlockId) {
            return;
          }
          if (!dragSel.anchorEndpoint) {
            dragSel.anchorEndpoint = resolveEndpointFromPoint(dragSel.startX, dragSel.startY);
          }
          dragSel.isCrossTextDragging = true;
          document.body.classList.add('is-block-selecting');
        }

        const focusEp = resolveEndpointFromPoint(ev.clientX, ev.clientY);
        if (dragSel.anchorEndpoint && focusEp) {
          setCrossRange(dragSel.anchorEndpoint, focusEp, false);
        }
      }

      // Smooth viewport auto-scroll when dragging near top/bottom edge of editor scroller
      if ((dragSel.isCrossTextDragging || dragSel.isMarginBlockDragging) && scroller) {
        const sr = scroller.getBoundingClientRect();
        const edgeZone = 46;
        if (ev.clientY < sr.top + edgeZone) {
          scroller.scrollTop -= 14;
        } else if (ev.clientY > sr.bottom - edgeZone) {
          scroller.scrollTop += 14;
        }
      }
    });

    window.addEventListener('mouseup', () => {
      if (!dragSel.active) return;
      const wasCrossText = dragSel.isCrossTextDragging;
      const wasMarginBlock = dragSel.isMarginBlockDragging;
      dragSel.active = false;
      dragSel.isCrossTextDragging = false;
      dragSel.isMarginBlockDragging = false;
      document.body.classList.remove('is-block-selecting');

      if (wasCrossText) {
        suppressNextCanvasClick = true;
        setTimeout(() => { suppressNextCanvasClick = false; }, 80);
        const norm = normalizeCrossRange();
        if (!norm || norm.collapsed) {
          clearCrossRange(false);
        } else if (isSameSubEditable(norm.start, norm.end)) {
          restoreIntraEditableSelectionFromCrossRange();
        } else {
          syncCrossRangeUI(true);
        }
      } else if (wasMarginBlock) {
        suppressNextCanvasClick = true;
        setTimeout(() => { suppressNextCanvasClick = false; }, 80);
        syncBlockSelectionUI(true);
      }
    });

    // Click inline Markdown images to open Lightbox zoom preview
    document.getElementById('wysiwyg-canvas')?.addEventListener('click', e => {
      const inlineImg = e.target.closest('.md-inline-img');
      if (inlineImg) {
        e.stopPropagation();
        openImageLightbox(inlineImg.src, inlineImg.alt || '');
      }
    });

    // Click in blank space below last block, above first block, or between blocks to insert/focus a paragraph
    scroller?.addEventListener('click', e => {
      if (suppressNextCanvasClick || hasBlockSelection() || hasCrossRange()) return;
      if (state.sourceMode) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      if (e.target.closest('.mk-block')) return;

      const canvas = document.getElementById('wysiwyg-canvas');
      if (!canvas) return;
      const blockEls = Array.from(canvas.querySelectorAll(':scope > .mk-block'));
      if (blockEls.length === 0 || state.blocks.length === 0) {
        const firstBlk = { id: Parser.nextBlockId(), type: 'paragraph', text: '' };
        state.blocks = [firstBlk];
        state.activeBlockId = firstBlk.id;
        markDirtyAndSync(true);
        renderCanvas();
        focusBlockById(firstBlk.id, 'start');
        return;
      }

      const clickY = e.clientY;
      const firstRect = blockEls[0].getBoundingClientRect();
      const lastRect = blockEls[blockEls.length - 1].getBoundingClientRect();

      // 1. Clicked below the last block in the document
      if (clickY >= lastRect.bottom - 6) {
        const lastBlock = state.blocks[state.blocks.length - 1];
        if (lastBlock.type === 'paragraph' && !(lastBlock.text || '').trim()) {
          focusBlockById(lastBlock.id, 'start');
        } else {
          insertBlockAfter(lastBlock.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
        }
        return;
      }

      // 2. Clicked above the first block in the document
      if (clickY <= firstRect.top + 6) {
        const firstBlock = state.blocks[0];
        if (firstBlock.type === 'paragraph') {
          focusBlockById(firstBlock.id, 'start');
        } else {
          insertBlockBefore(firstBlock.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
        }
        return;
      }

      // 3. Clicked in the vertical gap between two blocks
      for (let i = 0; i < blockEls.length - 1; i++) {
        const rA = blockEls[i].getBoundingClientRect();
        const rB = blockEls[i + 1].getBoundingClientRect();
        if (clickY >= rA.bottom - 2 && clickY <= rB.top + 2) {
          const blkA = state.blocks[i];
          const blkB = state.blocks[i + 1];
          if (blkA && blkA.type === 'paragraph' && !(blkA.text || '').trim()) {
            focusBlockById(blkA.id, 'start');
          } else if (blkB && blkB.type === 'paragraph' && !(blkB.text || '').trim()) {
            focusBlockById(blkB.id, 'start');
          } else if (blkA) {
            insertBlockAfter(blkA.id, { id: Parser.nextBlockId(), type: 'paragraph', text: '' }, 'start');
          }
          return;
        }
      }
    });

    // Clipboard Image & Multi-Block Markdown Paste
    document.addEventListener('paste', async e => {
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              if (hasCrossRange()) clearCrossRange(false);
              if (hasBlockSelection()) clearBlockSelection(false);
              await insertImageFileAsAsset(file);
            }
            return;
          }
        }
      }

      if (state.sourceMode) return;

      const rawText = e.clipboardData?.getData('text/plain');
      if (rawText === undefined || rawText === null) return;

      // 0. Pasting while a character-accurate Cross-Block Text Selection is active -> replace exact slice!
      if (hasCrossRange()) {
        e.preventDefault();
        replaceCrossRangeWithMarkdown(rawText);
        showToast('已粘贴并替换选中内容');
        return;
      }

      // 1. Pasting while one or more whole blocks are selected -> replace selected blocks with parsed Markdown blocks
      if (hasBlockSelection()) {
        e.preventDefault();
        replaceSelectedBlocksWithMarkdown(rawText);
        showToast('已粘贴并替换选中块');
        return;
      }

      // 2. Pasting inside a WYSIWYG .mk-editable -> clean plain/Markdown paste (supports multi-block!)
      const activeEl = document.activeElement;
      const editable = activeEl?.classList?.contains('mk-editable')
        ? activeEl
        : activeEl?.closest?.('.mk-editable');
      if (editable) {
        e.preventDefault();
        handlePasteMarkdownIntoEditable(editable, rawText);
      }
    });

    // Drag & Drop Images (into ./assets/) or Markdown Files (open document)
    const mainPane = document.getElementById('main-pane');
    const dropOverlay = document.getElementById('drop-overlay');
    let dragDepth = 0;

    mainPane?.addEventListener('dragenter', e => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        dragDepth++;
        dropOverlay?.classList.remove('hidden');
      }
    });

    mainPane?.addEventListener('dragover', e => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    mainPane?.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        dropOverlay?.classList.add('hidden');
      }
    });

    mainPane?.addEventListener('drop', async e => {
      dragDepth = 0;
      dropOverlay?.classList.add('hidden');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();

      for (const file of files) {
        if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name)) {
          await insertImageFileAsAsset(file);
        } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
          if (state.isDirty && state.currentFilePath) {
            await saveCurrentDocument(true);
          }
          const content = await file.text();
          loadDocument(file.path || '', file.name, content);
          showToast(`已载入 ${file.name}`);
          break;
        }
      }
    });

    // Native Window Dragging & Prevent Accidental Text Selection in Titlebar/Chrome
    document.addEventListener(
      'mousedown',
      e => {
        if (e.button === 0 && isWindowDragZone(e.target)) {
          e.preventDefault(); // Prevent WebKit from selecting text when dragging window
          Bridge.armWindowDrag();
        }
      },
      true
    );

    // Double-click titlebar to zoom/maximize window (macOS standard behavior)
    document.addEventListener('dblclick', e => {
      if (
        !e.target.closest('button, input, textarea, select, a, .theme-pills') &&
        (e.target.closest('#top-titlebar') || e.target.closest('.sidebar-top-bar'))
      ) {
        e.preventDefault();
        Bridge.zoomWindow();
      }
    });

    document.addEventListener('mousedown', e => {
      if (state.slashMenuOpen && !e.target.closest('#slash-menu')) {
        closeSlashMenu();
      }
      if (!e.target.closest('#context-menu')) {
        closeContextMenu();
      }
      if (
        state.dirDropdownOpen &&
        !e.target.closest('#dir-dropdown-menu') &&
        !e.target.closest('#btn-dir-switcher') &&
        !e.target.closest('#doc-folder-name')
      ) {
        toggleDirDropdown(false);
      }
    });

    // Global Keyboard Shortcuts (Typora-compatible)
    document.addEventListener('keydown', e => {
      const meta = e.metaKey || e.ctrlKey;
      const keyLower = e.key.toLowerCase();

      // Escape closes Lightbox, Context Menu, Quick Open, Find Bar, or Cross-Block Selection
      if (e.key === 'Escape') {
        const lightbox = document.getElementById('image-lightbox');
        if (lightbox && !lightbox.classList.contains('hidden')) {
          e.preventDefault();
          closeImageLightbox();
          return;
        }
        const ctxMenu = document.getElementById('context-menu');
        if (ctxMenu && !ctxMenu.classList.contains('hidden')) {
          e.preventDefault();
          closeContextMenu();
          return;
        }
        if (state.quickOpenVisible) {
          e.preventDefault();
          closeQuickOpenModal();
          return;
        }
        if (state.findBarOpen) {
          e.preventDefault();
          closeFindBar();
          return;
        }
        if (hasCrossRange()) {
          e.preventDefault();
          clearCrossRange(true);
          return;
        }
        if (hasBlockSelection()) {
          e.preventDefault();
          clearBlockSelection(true);
          return;
        }
      }

      // Fallback cross-block keyboard actions if focus wandered off #block-selection-bridge
      if (
        (hasCrossRange() || hasBlockSelection()) &&
        !state.sourceMode &&
        !(e.target && e.target.tagName === 'INPUT')
      ) {
        if (!meta && !e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) {
          e.preventDefault();
          if (hasCrossRange()) deleteCrossRange(null);
          else deleteSelectedBlocks(e.key === 'Delete' ? 'forward' : 'backward');
          return;
        }
        if (!meta && !e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          if (hasCrossRange()) {
            const nextFocus = stepEndpointByArrow(state.crossRange.focus, e.key);
            if (nextFocus) setCrossRange(state.crossRange.anchor, nextFocus, true);
          } else {
            extendBlockSelectionByStep(e.key === 'ArrowUp' ? -1 : 1);
          }
          return;
        }
      }

      // Cmd + A : Progressive Select All (Active Block Text -> All Blocks in Document)
      if (meta && !e.shiftKey && !e.altKey && keyLower === 'a') {
        if (e.target && e.target.tagName === 'INPUT') {
          return;
        }
        e.preventDefault();
        handleSelectAllCommand();
        return;
      }

      // Cmd + D : Duplicate Selected Block(s) or Active Block
      if (meta && !e.shiftKey && !e.altKey && keyLower === 'd') {
        if (!state.sourceMode && !(e.target && e.target.tagName === 'INPUT')) {
          e.preventDefault();
          duplicateBlocksByIds();
          return;
        }
      }

      // Alt + ArrowUp / Alt + ArrowDown : Move Selected Block(s) or Active Block Up / Down
      if (!meta && e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!state.sourceMode && !(e.target && e.target.tagName === 'INPUT')) {
          e.preventDefault();
          moveBlocksByStep(e.key === 'ArrowUp' ? -1 : 1);
          return;
        }
      }

      // Cmd + Z / Cmd + Shift + Z : Document AST Undo / Redo
      if (meta && keyLower === 'z') {
        if (e.target && e.target.tagName === 'INPUT') {
          return; // Keep native text undo inside modal/search inputs
        }
        e.preventDefault();
        if (e.shiftKey) performRedo();
        else performUndo();
        return;
      }

      // Cmd + F : In-Document Find & Replace
      if (meta && !e.shiftKey && keyLower === 'f') {
        e.preventDefault();
        openFindBar(false);
        return;
      }

      // Cmd + P : Quick Open & Workspace Full-Text Search
      if (meta && !e.shiftKey && keyLower === 'p') {
        e.preventDefault();
        openQuickOpenModal();
        return;
      }

      // Cmd + Shift + E : Export PDF
      if (meta && e.shiftKey && keyLower === 'e') {
        e.preventDefault();
        handleExportPDF();
        return;
      }

      // Cmd + / : Toggle Source Code Mode
      if (meta && e.key === '/') {
        e.preventDefault();
        toggleSourceMode();
        return;
      }

      // Cmd + R : Reload Workspace & Current Document from Disk
      if (meta && !e.shiftKey && keyLower === 'r') {
        e.preventDefault();
        reloadCurrentDocumentFromDisk();
        return;
      }

      // Cmd + S : Save Document
      if (meta && !e.shiftKey && keyLower === 's') {
        e.preventDefault();
        saveCurrentDocument(false);
        return;
      }

      // Cmd + Shift + S : Save As
      if (meta && e.shiftKey && keyLower === 's') {
        e.preventDefault();
        Bridge.saveFileAs(state.currentFileName, state.markdown);
        return;
      }

      // Cmd + N : New Document
      if (meta && keyLower === 'n') {
        e.preventDefault();
        openNewFileModal();
        return;
      }

      // Cmd + O : Open File
      if (meta && !e.shiftKey && keyLower === 'o') {
        e.preventDefault();
        document.getElementById('btn-open-file')?.click();
        return;
      }

      // Cmd + Shift + O : Choose Directory
      if (meta && e.shiftKey && keyLower === 'o') {
        e.preventDefault();
        promptChooseFolder();
        return;
      }

      // Cmd + Shift + H : Show Recent History Tab
      if (meta && e.shiftKey && keyLower === 'h') {
        e.preventDefault();
        switchSidebarTab('history');
        return;
      }

      // Cmd + Shift + L : Toggle Sidebar
      if (meta && e.shiftKey && keyLower === 'l') {
        e.preventDefault();
        document.getElementById('btn-toggle-sidebar')?.click();
        return;
      }

      // Cmd + 1..6 : Heading 1..6
      if (meta && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        transformActiveBlock('heading', { level: Number(e.key) });
        return;
      }

      // Cmd + 0 : Normal Paragraph
      if (meta && e.key === '0') {
        e.preventDefault();
        transformActiveBlock('paragraph');
        return;
      }

      // Cmd + B / I / E / K : Inline formatting
      if (meta && keyLower === 'b') {
        e.preventDefault();
        applyInlineFormatting('**');
        return;
      }
      if (meta && keyLower === 'i') {
        e.preventDefault();
        applyInlineFormatting('*');
        return;
      }
      if (meta && keyLower === 'e') {
        e.preventDefault();
        applyInlineFormatting('`');
        return;
      }
      if (meta && keyLower === 'k') {
        e.preventDefault();
        applyInlineFormatting('[', '](https://)');
        return;
      }

      // F8 : Focus Mode
      if (e.key === 'F8') {
        e.preventDefault();
        document.getElementById('btn-focus-mode')?.click();
        return;
      }

      // F9 : Typewriter Mode
      if (e.key === 'F9') {
        e.preventDefault();
        document.getElementById('btn-typewriter-mode')?.click();
        return;
      }
    });

    // Native macOS Menu Bar Callback
    global.__markoraMenuCommand = async function (cmd) {
      switch (cmd) {
        case 'newFile': openNewFileModal(); break;
        case 'openFile': document.getElementById('btn-open-file')?.click(); break;
        case 'openFolder': promptChooseFolder(); break;
        case 'quickOpen': openQuickOpenModal(); break;
        case 'showHistory': switchSidebarTab('history'); break;
        case 'reloadFromDisk': reloadCurrentDocumentFromDisk(); break;
        case 'save': await saveCurrentDocument(false); break;
        case 'saveAndClose': {
          const saved = await saveCurrentDocument(true);
          if (saved && !state.isDirty) {
            Bridge.forceCloseWindow();
          }
          break;
        }
        case 'saveAs': Bridge.saveFileAs(state.currentFileName, state.markdown); break;
        case 'exportHTML': handleExportHTML(); break;
        case 'exportPDF': handleExportPDF(); break;
        case 'undo': performUndo(); break;
        case 'redo': performRedo(); break;
        case 'selectAll': handleSelectAllCommand(); break;
        case 'find': openFindBar(false); break;
        case 'toggleSource': toggleSourceMode(); break;
        case 'toggleSidebar': document.getElementById('btn-toggle-sidebar')?.click(); break;
        case 'toggleFocus': document.getElementById('btn-focus-mode')?.click(); break;
        case 'toggleTypewriter': document.getElementById('btn-typewriter-mode')?.click(); break;
        case 'themeAuto': applyTheme('auto'); break;
        case 'themeLight': applyTheme('github-light'); break;
        case 'themeWarm': applyTheme('paper-warm'); break;
        case 'themeDark': applyTheme('night-dark'); break;
        case 'themeNord': applyTheme('nord-minimal'); break;
      }
    };

    // Finder "Open With Markora" / Dock Drop Callback
    global.__markoraOpenExternalFile = function (data) {
      if (!data || !data.file) return;
      if (data.rootPath) {
        state.rootPath = data.rootPath;
        state.rootName = data.rootName || '本地目录';
        recordRecentFolder(state.rootPath, state.rootName);
      }
      if (Array.isArray(data.tree)) {
        state.fileTree = data.tree;
        renderSidebarFiles();
      }
      loadDocument(data.file.path, data.file.name, data.file.content);
      showToast(`已打开 ${data.file.name}`);
    };

    // Programmatic Controller API for Automated Test Suite Verification
    global.__markoraTestApi = {
      getState: () => state,
      loadDocument,
      setCrossRange,
      clearCrossRange,
      extractCrossRangeMarkdown,
      deleteCrossRange,
      replaceCrossRangeWithMarkdown,
      applyInlineFormattingToCrossRange,
      selectSingleBlock,
      toggleSingleBlockSelection,
      setBlockRangeSelection,
      selectAllBlocks,
      clearBlockSelection,
      extendBlockSelectionByStep,
      deleteSelectedBlocks,
      deleteBlock,
      duplicateBlocksByIds,
      moveBlocksByStep,
      replaceSelectedBlocksWithMarkdown,
      getSelectedBlocksMarkdown,
      handleSelectAllCommand,
      performUndo,
      performRedo
    };
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
