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
    querySelectorAll: () => [],
    focus: () => {},
    click: function () { this.dispatchEvent('click', { stopPropagation: () => {}, preventDefault: () => {} }); }
  };
}

globalObj.document = {
  title: '',
  documentElement: makeStubElement('html'),
  body: makeStubElement('body'),
  createElement: (tag) => makeStubElement(tag),
  createTextNode: (txt) => ({ nodeType: 3, textContent: txt }),
  getElementById: (id) => {
    if (!elementsById[id]) {
      const el = makeStubElement('div', id);
      if (id === 'external-conflict-banner') el.classList.add('hidden');
      elementsById[id] = el;
    }
    return elementsById[id];
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (ev, fn) => {
    if (ev === 'DOMContentLoaded') domReadyCallback = fn;
  },
  createRange: () => ({ selectNodeContents: () => {}, collapse: () => {}, setStart: () => {}, setEnd: () => {} })
};
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

  print('✅ ALL MARKORA TESTS PASSED!');
})().catch((e) => {
  print('ERROR: ' + e);
  quit(1);
});
