/**
 * Markora Unified Desktop Bridge
 * Supports:
 * 1. Native macOS AppKit + WKWebView Bridge (webkit.messageHandlers.markora)
 * 2. Electron IPC Bridge (window.electronAPI)
 * 3. Web Browser Fallback (File System Access API + LocalStorage Virtual Workspace)
 */

(function (global) {
  'use strict';

  const pendingRequests = new Map();
  let reqCounter = 1;

  // Callback invoked by Native macOS WKWebView host
  global.__markoraNativeCallback = function (reqId, ok, data, error) {
    const entry = pendingRequests.get(reqId);
    if (!entry) return;
    pendingRequests.delete(reqId);
    if (ok) {
      entry.resolve(data);
    } else {
      entry.reject(new Error(error || 'Native operation failed'));
    }
  };

  function isNativeMacApp() {
    return Boolean(
      global.webkit &&
      global.webkit.messageHandlers &&
      global.webkit.messageHandlers.markora
    );
  }

  function isElectronApp() {
    return Boolean(global.electronAPI);
  }

  function callNativeMac(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const reqId = reqCounter++;
      pendingRequests.set(reqId, { resolve, reject });
      try {
        global.webkit.messageHandlers.markora.postMessage({
          reqId,
          action,
          payload
        });
      } catch (err) {
        pendingRequests.delete(reqId);
        reject(err);
      }
    });
  }

  // Default fallback documents if opened directly in browser
  const DEFAULT_VIRTUAL_FILES = [
    {
      name: '01-欢迎使用Markora.md',
      path: '/workspace/01-欢迎使用Markora.md',
      type: 'file',
      content: `# 欢迎使用 Markora — 极简所见即所得 Markdown 编辑器

> [!NOTE]
> **Markora** 是一款致敬 Typora 的轻量级原生桌面 Markdown 编辑器。它将「书写」与「预览」融为一体，让你专注于内容本身。

## ✨ 核心特性一览

在 **Markora** 中，你无需忍受左右分屏的割裂感。当你输入 Markdown 语法时，文档会实时呈现排版效果；而当你点击段落或按下 \`Cmd + /\` 切换源码模式时，又能精准掌控每一处标记。

- **实时所见即所得**：标题、列表、引用、表格、任务列表实时渲染，行内焦点智能展开语法标记。
- **快捷键切换源码**：随时按 \`Cmd + /\` 在「所见即所得视图」与「纯 Markdown 源码视图」之间无缝切换。
- **大纲与本地文件树**：左侧边栏支持本地文件夹目录树管理与文档结构大纲（TOC）联动跳转。
- **专注模式与打字机模式**：支持段落聚焦（Focus Mode）与光标居中（Typewriter Mode），沉浸式创作。
- **科学绘图与公式支持**：内置离线 **LaTeX 数学公式（MathML 原生排版）**、**Mermaid 流程图/时序图** 与 **多语言代码高亮**。

---

## ⌨️ 常用快捷键与行首触发语法

| 功能操作 | 快捷键 / 触发方式 | 说明 |
| :--- | :--- | :--- |
| **切换源码模式** | \`Cmd + /\` | 在所见即所得与 Markdown 源码间切换 |
| **一级至六级标题** | \`Cmd + 1~6\` 或输入 \`# \` | 行首输入 \`#\` 加空格立即转为标题 |
| **加粗 / 斜体 / 行内代码** | \`Cmd + B\` / \`Cmd + I\` / \`Cmd + E\` | 支持选中文字后通过悬浮工具栏设置 |
| **专注模式 / 打字机模式** | \`F8\` / \`F9\` | 仅高亮当前正在编辑的段落 |
| **快捷插入菜单** | 行首输入 \`/\` | 呼出块级元素快捷插入面板 |
| **快速跳转 / 全文搜索** | \`Cmd + P\` | 检索工作区文件名与全文内容 |
| **文内查找与替换** | \`Cmd + F\` | 高亮定位当前文档匹配项并支持批量替换 |
| **粘贴 / 拖拽本地图片** | \`Cmd + V\` 或拖入图片 | 自动拷贝至 \`./assets/\` 目录并支持缩放与灯箱预览 |
| **保存文档 / 导出 PDF** | \`Cmd + S\` / \`Cmd + Shift + E\` | 直接读写本地磁盘文件或导出矢量 PDF |

---

## ✅ 交互式任务列表

你可以直接点击下方的复选框来切换完成状态，修改会同步更新底层 Markdown 源码：

- [x] 设计极简无干扰的沉浸式排版界面
- [x] 实现实时所见即所得（WYSIWYG）与源码模式无缝切换
- [x] 集成 LaTeX 数学公式渲染与实时编辑面板
- [x] 集成 Mermaid 流程图与时序图矢量渲染
- [ ] 点击左侧文件树探索更多示例文档，或打开你自己的本地文件夹！

---

## 🧮 数学公式（LaTeX）

Markora 支持行内公式（如质能方程 $E = mc^2$、欧拉恒等式 $e^{i\\pi} + 1 = 0$）以及独立公式块。点击下方公式块即可直接编辑 LaTeX 源码：

$$
f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\exp\\left( -\\frac{(x - \\mu)^2}{2\\sigma^2} \\right)
$$

$$
\\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi} \\quad , \\quad \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

---

## 📊 Mermaid 流程图与架构图

点击图表可展开源码编辑器并实时预览修改效果：

\`\`\`mermaid
flowchart LR
    A["Markdown 源码输入"] --> B{"解析引擎"}
    B -->|实时排版| C["所见即所得画布"]
    B -->|语法树提取| D["大纲目录 TOC"]
    C --> E["导出 HTML / PDF"]
\`\`\`

---

## 💻 代码块与语法高亮

\`\`\`javascript
class DocumentSession {
  constructor(filePath, content = '') {
    this.filePath = filePath;
    this.content = content;
    this.isDirty = false;
  }

  update(nextMarkdown) {
    if (nextMarkdown !== this.content) {
      this.content = nextMarkdown;
      this.isDirty = true;
      return true;
    }
    return false;
  }
}
\`\`\`
`
    },
    {
      name: '02-数学与图表展示.md',
      path: '/workspace/02-数学与图表展示.md',
      type: 'file',
      content: `# 数学公式与科学绘图指南

本文档展示了 **Markora** 内置的数学公式排版引擎与 Mermaid 图表渲染能力。

## 1. 微积分与级数展开

$$
f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!} (x - a)^n
$$

$$
\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0} \\quad , \\quad \\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}
$$

## 2. 线性代数与矩阵

$$
A = \\begin{pmatrix} a_{11} & a_{12} & a_{13} \\\\ a_{21} & a_{22} & a_{23} \\\\ a_{31} & a_{32} & a_{33} \\end{pmatrix} , \\quad \\det(A - \\lambda I) = 0
$$

## 3. Mermaid 时序图（Sequence Diagram）

\`\`\`mermaid
sequenceDiagram
    participant U as 用户 (User)
    participant E as 编辑器视图 (WYSIWYG)
    participant P as 解析引擎 (Parser)
    participant D as 本地磁盘 (FileSystem)
    U->>E: 输入 Markdown 语法 (# 标题)
    E->>P: 触发块级语法转换
    P-->>E: 更新 DOM 节点与大纲目录
    U->>D: 按下 Cmd + S 保存
    D-->>U: 写入本地 .md 文件成功
\`\`\`
`
    }
  ];

  function loadVirtualWorkspace() {
    try {
      const saved = localStorage.getItem('markora_virtual_ws');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    localStorage.setItem('markora_virtual_ws', JSON.stringify(DEFAULT_VIRTUAL_FILES));
    return DEFAULT_VIRTUAL_FILES;
  }

  function saveVirtualWorkspace(files) {
    try {
      localStorage.setItem('markora_virtual_ws', JSON.stringify(files));
    } catch (e) {}
  }

  const DesktopBridge = {
    getRuntimeName() {
      if (isNativeMacApp()) return 'macOS Native (WebKit)';
      if (isElectronApp()) return 'Electron Desktop';
      return 'Web Workspace';
    },

    async getInitialWorkspace() {
      if (isNativeMacApp()) {
        return callNativeMac('getInitialWorkspace');
      }
      if (isElectronApp()) {
        return global.electronAPI.getInitialWorkspace();
      }
      const files = loadVirtualWorkspace();
      return {
        rootPath: '/workspace',
        rootName: '示例工作区 (Workspace)',
        tree: files.map(f => ({ name: f.name, path: f.path, type: 'file' })),
        initialFile: files[0]
      };
    },

    async openFolderDialog() {
      if (isNativeMacApp()) {
        return callNativeMac('openFolderDialog');
      }
      if (isElectronApp()) {
        return global.electronAPI.openFolderDialog();
      }
      return null;
    },

    async openFolderByPath(folderPath) {
      if (isNativeMacApp()) {
        return callNativeMac('openFolderByPath', { path: folderPath });
      }
      if (isElectronApp() && global.electronAPI.openFolderByPath) {
        return global.electronAPI.openFolderByPath(folderPath);
      }
      if (folderPath === '/workspace') {
        return this.getInitialWorkspace();
      }
      throw new Error('当前环境不支持直接挂载该路径');
    },

    async revealInFinder(targetPath) {
      if (isNativeMacApp()) {
        return callNativeMac('revealInFinder', { path: targetPath || '' });
      }
      if (isElectronApp() && global.electronAPI.revealInFinder) {
        return global.electronAPI.revealInFinder(targetPath || '');
      }
      return { ok: false };
    },

    async getHistory() {
      let localRaw = '';
      try {
        localRaw = localStorage.getItem('markora_recent_history') || '';
      } catch (e) {}

      if (isNativeMacApp()) {
        try {
          const res = await callNativeMac('getHistory');
          const raw = (res && res.json) ? res.json : localRaw;
          const parsed = raw ? JSON.parse(raw) : { folders: [], files: [] };
          return {
            folders: Array.isArray(parsed.folders) ? parsed.folders : [],
            files: Array.isArray(parsed.files) ? parsed.files : [],
            homeDir: (res && res.homeDir) || ''
          };
        } catch (e) {}
      }

      try {
        const parsed = localRaw ? JSON.parse(localRaw) : { folders: [], files: [] };
        return {
          folders: Array.isArray(parsed.folders) ? parsed.folders : [],
          files: Array.isArray(parsed.files) ? parsed.files : [],
          homeDir: ''
        };
      } catch (e) {
        return { folders: [], files: [], homeDir: '' };
      }
    },

    async saveHistory(historyObj) {
      const json = JSON.stringify({
        folders: historyObj.folders || [],
        files: historyObj.files || []
      });
      try {
        localStorage.setItem('markora_recent_history', json);
      } catch (e) {}
      if (isNativeMacApp()) {
        try {
          await callNativeMac('saveHistory', { json });
        } catch (e) {}
      }
      return { ok: true };
    },

    async openFileDialog() {
      if (isNativeMacApp()) {
        return callNativeMac('openFileDialog');
      }
      if (isElectronApp()) {
        return global.electronAPI.openFileDialog();
      }
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.txt';
        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return resolve(null);
          const content = await file.text();
          resolve({
            name: file.name,
            path: '/workspace/' + file.name,
            content
          });
        };
        input.click();
      });
    },

    async readFile(filePath) {
      if (isNativeMacApp()) {
        return callNativeMac('readFile', { path: filePath });
      }
      if (isElectronApp()) {
        return global.electronAPI.readFile(filePath);
      }
      const files = loadVirtualWorkspace();
      const found = files.find(f => f.path === filePath);
      return found ? { path: found.path, name: found.name, content: found.content } : null;
    },

    async writeFile(filePath, content) {
      if (isNativeMacApp()) {
        return callNativeMac('writeFile', { path: filePath, content });
      }
      if (isElectronApp()) {
        return global.electronAPI.writeFile(filePath, content);
      }
      const files = loadVirtualWorkspace();
      const found = files.find(f => f.path === filePath);
      if (found) {
        found.content = content;
      } else {
        const name = filePath.split('/').pop() || '未命名.md';
        files.push({ name, path: filePath, type: 'file', content });
      }
      saveVirtualWorkspace(files);
      return { ok: true, path: filePath };
    },

    async saveFileAs(defaultName, content) {
      if (isNativeMacApp()) {
        return callNativeMac('saveFileAs', { defaultName, content });
      }
      if (isElectronApp()) {
        return global.electronAPI.saveFileAs(defaultName, content);
      }
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = defaultName || 'document.md';
      a.click();
      URL.revokeObjectURL(a.href);
      return { ok: true, name: defaultName, path: '/workspace/' + defaultName };
    },

    async createFile(folderPath, fileName, initialContent = '') {
      if (isNativeMacApp()) {
        return callNativeMac('createFile', { folderPath, fileName, content: initialContent });
      }
      if (isElectronApp()) {
        return global.electronAPI.createFile(folderPath, fileName, initialContent);
      }
      const files = loadVirtualWorkspace();
      const cleanName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
      const fullPath = `${folderPath.replace(/\/$/, '')}/${cleanName}`;
      const newDoc = {
        name: cleanName,
        path: fullPath,
        type: 'file',
        content: initialContent || `# ${cleanName.replace(/\.md$/i, '')}\n\n`
      };
      files.push(newDoc);
      saveVirtualWorkspace(files);
      return {
        file: newDoc,
        tree: files.map(f => ({ name: f.name, path: f.path, type: 'file' }))
      };
    },

    async createFolder(parentPath, folderName) {
      if (isNativeMacApp()) {
        return callNativeMac('createFolder', { parentPath, folderName });
      }
      if (isElectronApp() && global.electronAPI.createFolder) {
        return global.electronAPI.createFolder(parentPath, folderName);
      }
      const files = loadVirtualWorkspace();
      const fullPath = `${(parentPath || '/workspace').replace(/\/$/, '')}/${folderName || '新建文件夹'}`;
      return {
        ok: true,
        folderPath: fullPath,
        tree: [
          { name: folderName || '新建文件夹', path: fullPath, type: 'folder', children: [] },
          ...files.map(f => ({ name: f.name, path: f.path, type: 'file' }))
        ]
      };
    },

    async deleteFile(filePath) {
      if (isNativeMacApp()) {
        return callNativeMac('deleteFile', { path: filePath });
      }
      if (isElectronApp()) {
        return global.electronAPI.deleteFile(filePath);
      }
      let files = loadVirtualWorkspace();
      files = files.filter(f => f.path !== filePath && !f.path.startsWith(filePath + '/'));
      saveVirtualWorkspace(files);
      return {
        ok: true,
        tree: files.map(f => ({ name: f.name, path: f.path, type: 'file' }))
      };
    },

    async renameFile(oldPath, newName) {
      if (isNativeMacApp()) {
        return callNativeMac('renameFile', { oldPath, newName });
      }
      if (isElectronApp()) {
        return global.electronAPI.renameFile(oldPath, newName);
      }
      const files = loadVirtualWorkspace();
      const target = files.find(f => f.path === oldPath);
      const cleanName = newName.includes('.') ? newName : `${newName}.md`;
      if (target) {
        const dir = oldPath.slice(0, oldPath.lastIndexOf('/'));
        target.name = cleanName;
        target.path = `${dir}/${cleanName}`;
        saveVirtualWorkspace(files);
      }
      return {
        ok: true,
        newPath: target ? target.path : oldPath,
        newName: cleanName,
        isDir: false,
        tree: files.map(f => ({ name: f.name, path: f.path, type: 'file' }))
      };
    },

    async saveImageAsset(mdFilePath, fileName, base64Data) {
      if (isNativeMacApp()) {
        return callNativeMac('saveImageAsset', { mdFilePath, fileName, base64Data });
      }
      if (isElectronApp() && global.electronAPI.saveImageAsset) {
        return global.electronAPI.saveImageAsset(mdFilePath, fileName, base64Data);
      }
      return {
        ok: true,
        relativePath: base64Data,
        fullPath: base64Data,
        fileName: fileName || 'image.png'
      };
    },

    async searchWorkspace(query) {
      if (isNativeMacApp()) {
        return callNativeMac('searchWorkspace', { query: query || '' });
      }
      if (isElectronApp() && global.electronAPI.searchWorkspace) {
        return global.electronAPI.searchWorkspace(query || '');
      }
      const files = loadVirtualWorkspace();
      const q = String(query || '').trim().toLowerCase();
      const results = [];
      if (!q) {
        for (const f of files) {
          results.push({
            path: f.path,
            name: f.name,
            relPath: f.name,
            line: 0,
            snippet: '',
            matchType: 'file'
          });
        }
        return { results };
      }
      for (const f of files) {
        if (f.name.toLowerCase().includes(q)) {
          results.push({
            path: f.path,
            name: f.name,
            relPath: f.name,
            line: 0,
            snippet: '文件名匹配',
            matchType: 'file'
          });
        }
        const lines = String(f.content || '').split('\n');
        lines.forEach((ln, idx) => {
          if (results.length < 50 && ln.toLowerCase().includes(q)) {
            results.push({
              path: f.path,
              name: f.name,
              relPath: f.name,
              line: idx + 1,
              snippet: ln.trim().slice(0, 120),
              matchType: 'content'
            });
          }
        });
      }
      return { results };
    },

    async forceCloseWindow() {
      if (isNativeMacApp()) {
        return callNativeMac('forceCloseWindow');
      }
      window.close();
    },

    async watchState(rootPath, filePath, content) {
      if (isNativeMacApp()) {
        return callNativeMac('watchState', { rootPath, filePath, content });
      }
      if (isElectronApp() && global.electronAPI.watchState) {
        return global.electronAPI.watchState(rootPath, filePath, content);
      }
      return { ok: true };
    },

    async reloadWorkspaceAndFile(filePath) {
      if (isNativeMacApp()) {
        return callNativeMac('reloadWorkspaceAndFile', { filePath });
      }
      if (isElectronApp() && global.electronAPI.reloadWorkspaceAndFile) {
        return global.electronAPI.reloadWorkspaceAndFile(filePath);
      }
      const files = loadVirtualFiles();
      const found = files.find(f => f.path === filePath) || null;
      return {
        tree: files.map(f => ({ name: f.name, path: f.path, type: 'file' })),
        file: found ? { path: found.path, name: found.name, content: found.content } : null
      };
    },

    onExternalSync(callback) {
      if (typeof callback !== 'function') return;
      global.__markoraExternalSync = callback;
      if (isElectronApp() && global.electronAPI.onExternalSync) {
        global.electronAPI.onExternalSync(callback);
      }
    },

    async exportHTML(defaultName, htmlContent) {
      if (isNativeMacApp()) {
        return callNativeMac('exportHTML', { defaultName, content: htmlContent });
      }
      if (isElectronApp()) {
        return global.electronAPI.exportHTML(defaultName, htmlContent);
      }
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = defaultName || 'export.html';
      a.click();
      URL.revokeObjectURL(a.href);
      return { ok: true };
    },

    async exportPDF(defaultName) {
      if (isNativeMacApp()) {
        return callNativeMac('exportPDF', { defaultName });
      }
      if (isElectronApp()) {
        return global.electronAPI.exportPDF(defaultName);
      }
      window.print();
      return { ok: true };
    },

    async setWindowTitle(title, isEdited = false) {
      document.title = `${isEdited ? '● ' : ''}${title} — Markora`;
      if (isNativeMacApp()) {
        return callNativeMac('setWindowTitle', { title, isEdited });
      }
      if (isElectronApp() && global.electronAPI.setWindowTitle) {
        return global.electronAPI.setWindowTitle(title, isEdited);
      }
    },

    armWindowDrag() {
      if (isNativeMacApp()) {
        try {
          global.webkit.messageHandlers.markora.postMessage({
            action: 'armWindowDrag'
          });
        } catch (e) {}
      }
    },

    zoomWindow() {
      if (isNativeMacApp()) {
        try {
          global.webkit.messageHandlers.markora.postMessage({
            action: 'zoomWindow'
          });
        } catch (e) {}
      }
    }
  };

  global.MarkoraBridge = DesktopBridge;
})(window);
