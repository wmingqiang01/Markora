// Automated JavaScriptCore (jsc) Test Suite for Markora
// Usage: /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/test_suite.js

const globalObj = globalThis;
globalObj.window = globalObj;
globalObj.console = {
  log: (...a) => print(a.join(' ')),
  warn: (...a) => print(a.join(' ')),
  error: (...a) => print(a.join(' '))
};
globalObj.requestAnimationFrame = (fn) => fn();
globalObj.setTimeout = () => 1;
globalObj.clearTimeout = () => {};

const store = {};
globalObj.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

const elementsById = {};
let domReadyCallback = null;

function makeStubElement(tag, id) {
  const classes = new Set();
  const listeners = {};
  const attrs = {};
  return {
    id: id || '',
    tagName: (tag || 'DIV').toUpperCase(),
    nodeType: 1,
    value: '',
    scrollTop: 0,
    selectionStart: 0,
    selectionEnd: 0,
    style: { setProperty: () => {} },
    dataset: {},
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle: (c, force) => {
        const shouldAdd = typeof force === 'boolean' ? force : !classes.has(c);
        if (shouldAdd) classes.add(c);
        else classes.delete(c);
        return shouldAdd;
      },
      contains: (c) => classes.has(c)
    },
    children: [],
    childNodes: [],
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v);
      if (v === '') {
        this.children = [];
        this.childNodes = [];
      }
    },
    textContent: '',
    addEventListener: (ev, fn) => {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(fn);
    },
    dispatchEvent: (evName, payload = {}) => {
      (listeners[evName] || []).forEach((fn) => fn(payload));
    },
    removeEventListener: () => {},
    appendChild: function (c) { this.children.push(c); this.childNodes.push(c); return c; },
    setAttribute: function (k, v) { attrs[k] = String(v); this[k] = String(v); },
    getAttribute: function (k) { return k in attrs ? attrs[k] : (this[k] || null); },
    setSelectionRange: function (s, e) { this.selectionStart = s; this.selectionEnd = e; },
    querySelector: () => makeStubElement('div'),
    querySelectorAll: function (sel) {
      if (sel === ':scope > .mk-block') return this.children;
      return [];
    },
    focus: () => {},
    blur: () => {},
    scrollIntoView: () => {},
    getBoundingClientRect: () => ({ top: 0, bottom: 20, left: 0, right: 200, width: 200, height: 20 }),
    click: function () { this.dispatchEvent('click', { stopPropagation: () => {}, preventDefault: () => {} }); }
  };
}

globalObj.document = {
  title: '',
  activeElement: null,
  documentElement: makeStubElement('html'),
  body: makeStubElement('body'),
  createElement: (tag) => makeStubElement(tag),
  createTextNode: (txt) => ({ nodeType: 3, textContent: txt }),
  getElementById: (id) => {
    if (!elementsById[id]) {
      const el = makeStubElement('div', id);
      if (id === 'external-conflict-banner' || id === 'block-selection-bar') el.classList.add('hidden');
      elementsById[id] = el;
    }
    return elementsById[id];
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (ev, fn) => {
    if (ev === 'DOMContentLoaded') domReadyCallback = fn;
  },
  execCommand: () => true,
  createRange: () => ({ selectNodeContents: () => {}, collapse: () => {}, setStart: () => {}, setEnd: () => {} })
};
globalObj.window.addEventListener = () => {};
globalObj.window.removeEventListener = () => {};
globalObj.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
globalObj.window.getSelection = () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges: () => {}, addRange: () => {} });
globalObj.navigator = { clipboard: { writeText: async () => {} } };
globalObj.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

function assert(cond, msg) {
  if (!cond) {
    print('FAIL: ' + msg);
    quit(1);
  } else {
    print('PASS: ' + msg);
  }
}

load('src/js/icons.js');
load('src/js/renderers.js');
load('src/js/bridge.js');
load('src/js/editor.js');
load('src/js/app.js');

const Parser = window.MarkoraParser;
Parser.setDocumentBaseDir('/Users/demo/笔记');
assert(Parser.resolveAssetUrl('assets/pic 1.png').startsWith('file:///Users/demo/'), 'Asset URL encoding');

const sampleMd = '# 标题\n\n![架构图|75%](assets/arch.png)\n';
const parsed = Parser.parseMarkdownToBlocks(sampleMd);
assert(parsed[1].type === 'image' && parsed[1].width === '75%', 'Standalone image block width parsing');
assert(Parser.serializeBlocksToMarkdown(parsed) === sampleMd, 'Lossless Markdown round-trip');

(async function runIntegration() {
  await domReadyCallback();

  window.__markoraOpenExternalFile({
    rootPath: '/Users/test/notes',
    rootName: 'notes',
    tree: [{ name: 'demo.md', path: '/Users/test/notes/demo.md', type: 'file' }],
    file: { name: 'demo.md', path: '/Users/test/notes/demo.md', content: '# 初始\n\n```js\nconst x = 1;\nconst y = 2;\n```\n' }
  });

  const canvas = document.getElementById('wysiwyg-canvas');
  assert(canvas.children.length === 3 && canvas.children[2].dataset.blockType === 'paragraph', 'Trailing paragraph appended after code block');

  // External file live sync test
  await window.__markoraExternalSync({
    type: 'fileModified',
    path: '/Users/test/notes/demo.md',
    name: 'demo.md',
    content: '# 外部更新\n\n已同步正文'
  });
  assert(document.getElementById('source-textarea').value === '# 外部更新\n\n已同步正文', 'External modification synced automatically');

  // Cross-Block Selection & Universal Block Deletion tests (Table + Mermaid + Math + Callout + Code + HR)
  const api = window.__markoraTestApi;
  const complexDoc = [
    '# 复杂块测试',
    '',
    '> [!NOTE]',
    '> 提示框内容',
    '',
    '| 列A | 列B |',
    '| :--- | :--- |',
    '| 1 | 2 |',
    '',
    '```mermaid',
    'flowchart LR',
    '    A --> B',
    '```',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '---',
    '',
    '结尾段落'
  ].join('\n');

  api.loadDocument('/Users/test/notes/complex.md', 'complex.md', complexDoc);
  const st = api.getState();
  assert(st.blocks.length === 7, 'Loaded all 7 heterogeneous block types cleanly');

  // 1. Cross-block range selection across Table, Mermaid, Math, and HR (indices 2..5)
  api.setBlockRangeSelection(st.blocks[2].id, st.blocks[5].id, true);
  assert(st.selectedBlockIds.size === 4, 'Range-selected 4 heterogeneous blocks (table + mermaid + math + hr)');
  assert(
    canvas.children[2].classList.contains('is-selected') &&
    canvas.children[3].classList.contains('is-selected') &&
    canvas.children[4].classList.contains('is-selected') &&
    canvas.children[5].classList.contains('is-selected'),
    'Canvas DOM blocks carry .is-selected highlight class'
  );
  const copiedMd = api.getSelectedBlocksMarkdown();
  assert(copiedMd.includes('| 列A | 列B |') && copiedMd.includes('```mermaid') && copiedMd.includes('E = mc^2'), 'Cross-block Markdown serialization preserves all special blocks');

  // 2. Delete all 4 selected special blocks in one operation + verify Undo restores them
  api.deleteSelectedBlocks('backward');
  assert(st.blocks.length === 3, 'Batch-deleted table, mermaid, math, and hr blocks cleanly');
  assert(!st.blocks.some(b => ['table', 'mermaid', 'math', 'hr'].includes(b.type)), 'Zero un-deletable special blocks remain');

  api.performUndo();
  assert(st.blocks.length === 7 && st.blocks[2].type === 'table' && st.blocks[3].type === 'mermaid', 'Cmd+Z Undo restores batch-deleted special blocks');

  // 3. Cross-block Duplicate & Reorder (Move Up / Down)
  api.setBlockRangeSelection(st.blocks[0].id, st.blocks[1].id, true);
  api.duplicateBlocksByIds();
  assert(st.blocks.length === 9 && st.blocks[2].type === 'heading' && st.blocks[3].type === 'callout', 'Cross-block Cmd+D duplicates selected block range');
  api.moveBlocksByStep(1);
  assert(st.blocks[2].type === 'table' && st.blocks[3].type === 'heading' && st.blocks[4].type === 'callout', 'Alt+Down moves contiguous multi-block selection downward');

  // 4. Multi-block Markdown Paste replacing selected blocks
  api.replaceSelectedBlocksWithMarkdown('## 新章节\n\n- 列表项 1\n- 列表项 2');
  assert(
    st.blocks.some(b => b.type === 'heading' && b.text === '新章节') &&
    st.blocks.some(b => b.type === 'ulist' && b.items.length === 2),
    'Multi-block Markdown paste replaces selected blocks with structured AST blocks'
  );

  // 5. Menu Select All (Cmd+A) + Delete Entire Document -> Clean Empty Paragraph + Undo
  await window.__markoraMenuCommand('selectAll');
  assert(st.selectedBlockIds.size === st.blocks.length && st.blocks.length > 1, 'Native menu Cmd+A selects all blocks in document');
  api.deleteSelectedBlocks('backward');
  assert(st.blocks.length === 1 && st.blocks[0].type === 'paragraph' && st.blocks[0].text === '', 'Deleting all blocks resets cleanly to a single editable paragraph');
  api.performUndo();
  assert(st.blocks.length > 5, 'Cmd+Z restores full document after Select-All deletion');

  // 6. Character-Accurate Cross-Block Text Selection (Partial Paragraph 1 -> Partial Paragraph 2, NO whole-block snap!)
  api.loadDocument(
    '/Users/test/notes/partial.md',
    'partial.md',
    '第一段保留，第一段删除\n\n第二段删除，第二段保留'
  );
  assert(st.blocks.length === 2, 'Loaded 2-paragraph document');
  api.setCrossRange(
    { blockId: st.blocks[0].id, blockIdx: 0, kind: 'editable', mdOffset: 6 },
    { blockId: st.blocks[1].id, blockIdx: 1, kind: 'editable', mdOffset: 6 },
    true
  );
  assert(st.selectedBlockIds.size === 0, 'Cross-block text selection does NOT snap to whole-block selection');
  assert(
    api.extractCrossRangeMarkdown() === '第一段删除\n\n第二段删除，',
    'Cmd+C on cross-block text range copies ONLY the exact selected character slices'
  );
  api.deleteCrossRange(null);
  assert(
    st.blocks.length === 1 && st.blocks[0].text === '第一段保留，第二段保留',
    'Backspace on cross-block text range deletes ONLY selected slices and merges remaining prefix + suffix'
  );
  api.performUndo();
  assert(st.blocks.length === 2 && st.blocks[0].text === '第一段保留，第一段删除', 'Undo restores both paragraphs cleanly');

  // 7. Typing replacement & Inline Formatting across partial cross-block selection
  api.setCrossRange(
    { blockId: st.blocks[0].id, blockIdx: 0, kind: 'editable', mdOffset: 6 },
    { blockId: st.blocks[1].id, blockIdx: 1, kind: 'editable', mdOffset: 6 },
    true
  );
  api.applyInlineFormattingToCrossRange('**');
  assert(
    st.blocks[0].text === '第一段保留，**第一段删除**' && st.blocks[1].text === '**第二段删除，**第二段保留',
    'Cmd+B across blocks bolds ONLY the exact selected slices in each block'
  );
  api.deleteCrossRange('衔接词，');
  assert(
    st.blocks.length === 1 && st.blocks[0].text === '第一段保留，衔接词，第二段保留',
    'Typing over cross-block selection replaces exact slices and merges inline'
  );

  // 8. Selecting from middle of Paragraph 1 across Table + Mermaid into middle of Paragraph 4 deletes intermediate special blocks & merges!
  api.loadDocument(
    '/Users/test/notes/bridge.md',
    'bridge.md',
    '开头保留，开头删掉\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n结尾删掉，结尾保留'
  );
  assert(st.blocks.length === 4, 'Loaded paragraph + table + mermaid + paragraph');
  api.setCrossRange(
    { blockId: st.blocks[0].id, blockIdx: 0, kind: 'editable', mdOffset: 5 },
    { blockId: st.blocks[3].id, blockIdx: 3, kind: 'editable', mdOffset: 5 },
    true
  );
  api.deleteCrossRange(null);
  assert(
    st.blocks.length === 1 && st.blocks[0].text === '开头保留，结尾保留',
    'Selecting text across intermediate Table + Mermaid blocks deletes them and merges outer paragraphs'
  );

  print('✅ ALL MARKORA TESTS PASSED!');
})().catch((e) => {
  print('ERROR: ' + e);
  quit(1);
});
