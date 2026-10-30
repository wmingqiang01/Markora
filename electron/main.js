const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow = null;
let currentWorkspacePath = path.join(__dirname, '..', 'workspace');
let watchedFilePath = '';
let lastKnownContent = '';
let lastTreeJson = '';
let activeWatchers = [];
let fsCheckTimer = null;

function rebuildWatchers() {
  activeWatchers.forEach(w => { try { w.close(); } catch (e) {} });
  activeWatchers = [];
  const dirs = new Set();
  if (currentWorkspacePath && fs.existsSync(currentWorkspacePath)) dirs.add(currentWorkspacePath);
  if (watchedFilePath) {
    const pDir = path.dirname(watchedFilePath);
    if (pDir && fs.existsSync(pDir)) dirs.add(pDir);
  }
  for (const dir of dirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_, filename) => {
        if (filename && (filename.includes('.git') || filename.endsWith('.DS_Store'))) return;
        clearTimeout(fsCheckTimer);
        fsCheckTimer = setTimeout(checkExternalChanges, 120);
      });
      activeWatchers.push(watcher);
    } catch (e) {}
  }
}

function sendExternalSync(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('external-sync', payload);
  }
}

function checkExternalChanges() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const tree = currentWorkspacePath ? scanDirectoryTree(currentWorkspacePath) : [];
  const treeJson = JSON.stringify(tree);
  let treeChanged = treeJson !== lastTreeJson;
  if (treeChanged) lastTreeJson = treeJson;

  if (watchedFilePath) {
    if (!fs.existsSync(watchedFilePath)) {
      treeChanged = false;
      sendExternalSync({ type: 'fileDeleted', path: watchedFilePath, tree });
    } else {
      try {
        const diskContent = fs.readFileSync(watchedFilePath, 'utf-8');
        if (diskContent !== lastKnownContent) {
          lastKnownContent = diskContent;
          sendExternalSync({
            type: 'fileModified',
            path: watchedFilePath,
            name: path.basename(watchedFilePath),
            content: diskContent
          });
        }
      } catch (e) {}
    }
  }

  if (treeChanged) {
    sendExternalSync({ type: 'treeChanged', rootPath: currentWorkspacePath, tree });
  }
}

function scanDirectoryTree(dirPath, depth = 0) {
  if (depth > 4 || !fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const folders = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      folders.push({
        name: entry.name,
        path: fullPath,
        type: 'folder',
        children: scanDirectoryTree(fullPath, depth + 1)
      });
    } else if (/\.(md|markdown|txt)$/i.test(entry.name)) {
      files.push({
        name: entry.name,
        path: fullPath,
        type: 'file'
      });
    }
  }
  return [...folders, ...files];
}

function findFirstMarkdownFile(tree) {
  for (const item of tree) {
    if (item.type === 'file') {
      const content = fs.readFileSync(item.path, 'utf-8');
      return { name: item.name, path: item.path, content };
    }
    if (item.type === 'folder' && item.children) {
      const found = findFirstMarkdownFile(item.children);
      if (found) return found;
    }
  }
  return null;
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (process.platform === 'darwin' && app.dock && fs.existsSync(iconPath)) {
    app.dock.setIcon(iconPath);
  }

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('getInitialWorkspace', () => {
    const tree = scanDirectoryTree(currentWorkspacePath);
    const initialFile = findFirstMarkdownFile(tree);
    return {
      rootPath: currentWorkspacePath,
      rootName: path.basename(currentWorkspacePath),
      homeDir: os.homedir(),
      tree,
      initialFile
    };
  });

  ipcMain.handle('openFolderDialog', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    currentWorkspacePath = res.filePaths[0];
    const tree = scanDirectoryTree(currentWorkspacePath);
    const initialFile = findFirstMarkdownFile(tree);
    return {
      rootPath: currentWorkspacePath,
      rootName: path.basename(currentWorkspacePath),
      homeDir: os.homedir(),
      tree,
      initialFile
    };
  });

  ipcMain.handle('openFolderByPath', (_, targetDir) => {
    if (!targetDir || !fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      throw new Error('目录不存在或已被移动');
    }
    currentWorkspacePath = targetDir;
    const tree = scanDirectoryTree(currentWorkspacePath);
    const initialFile = findFirstMarkdownFile(tree);
    return {
      rootPath: currentWorkspacePath,
      rootName: path.basename(currentWorkspacePath),
      homeDir: os.homedir(),
      tree,
      initialFile
    };
  });

  ipcMain.handle('revealInFinder', (_, targetPath) => {
    const p = targetPath || currentWorkspacePath;
    if (p && fs.existsSync(p)) {
      shell.showItemInFolder(p);
    }
    return { ok: true };
  });

  ipcMain.handle('openFileDialog', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, name: path.basename(filePath), content };
  });

  ipcMain.handle('readFile', (_, filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, name: path.basename(filePath), content };
  });

  ipcMain.handle('writeFile', (_, { filePath, content }) => {
    fs.writeFileSync(filePath, content, 'utf-8');
    if (filePath === watchedFilePath || !watchedFilePath) {
      watchedFilePath = filePath;
      lastKnownContent = content;
    }
    return { ok: true, path: filePath };
  });

  ipcMain.handle('watchState', (_, { rootPath, filePath, content }) => {
    if (rootPath && rootPath !== '/workspace') currentWorkspacePath = rootPath;
    watchedFilePath = filePath || '';
    if (typeof content === 'string') {
      lastKnownContent = content;
    } else if (watchedFilePath && fs.existsSync(watchedFilePath)) {
      lastKnownContent = fs.readFileSync(watchedFilePath, 'utf-8');
    }
    lastTreeJson = JSON.stringify(scanDirectoryTree(currentWorkspacePath));
    rebuildWatchers();
    return { ok: true };
  });

  ipcMain.handle('reloadWorkspaceAndFile', (_, filePath) => {
    const tree = scanDirectoryTree(currentWorkspacePath);
    lastTreeJson = JSON.stringify(tree);
    const fp = filePath || watchedFilePath;
    let file = null;
    if (fp && fs.existsSync(fp)) {
      const content = fs.readFileSync(fp, 'utf-8');
      watchedFilePath = fp;
      lastKnownContent = content;
      file = { path: fp, name: path.basename(fp), content };
    }
    rebuildWatchers();
    return { tree, file };
  });

  ipcMain.handle('createFile', (_, { folderPath, fileName, content }) => {
    const cleanName = path.extname(fileName) ? fileName : `${fileName}.md`;
    const fullPath = path.join(folderPath || currentWorkspacePath, cleanName);
    const initialContent = content || `# ${cleanName.replace(/\.md$/i, '')}\n\n`;
    fs.writeFileSync(fullPath, initialContent, 'utf-8');
    const tree = scanDirectoryTree(currentWorkspacePath);
    return {
      file: { name: cleanName, path: fullPath, content: initialContent },
      tree
    };
  });

  ipcMain.handle('createFolder', (_, { parentPath, folderName }) => {
    const fullPath = path.join(parentPath || currentWorkspacePath, folderName || '新建文件夹');
    fs.mkdirSync(fullPath, { recursive: true });
    const tree = scanDirectoryTree(currentWorkspacePath);
    return { ok: true, folderPath: fullPath, tree };
  });

  ipcMain.handle('renameFile', (_, { oldPath, newName }) => {
    const isDir = fs.statSync(oldPath).isDirectory();
    let finalName = String(newName || '').trim();
    if (!isDir && !path.extname(finalName)) {
      finalName += path.extname(oldPath) || '.md';
    }
    const newPath = path.join(path.dirname(oldPath), finalName);
    if (newPath !== oldPath) {
      fs.renameSync(oldPath, newPath);
    }
    const tree = scanDirectoryTree(currentWorkspacePath);
    return { ok: true, newPath, newName: finalName, isDir, tree };
  });

  ipcMain.handle('deleteFile', async (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      await shell.trashItem(filePath);
    }
    const tree = scanDirectoryTree(currentWorkspacePath);
    return { ok: true, tree };
  });

  ipcMain.handle('saveImageAsset', (_, { mdFilePath, fileName, base64Data }) => {
    const baseDir = mdFilePath ? path.dirname(mdFilePath) : currentWorkspacePath;
    const assetsDir = path.join(baseDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const ext = (path.extname(fileName || '') || '.png').toLowerCase();
    const stem = (path.basename(fileName || 'image', ext) || 'image').replace(/[\s/\\]+/g, '-');
    let finalName = `${stem}${ext}`;
    let destPath = path.join(assetsDir, finalName);
    let idx = 1;
    while (fs.existsSync(destPath)) {
      finalName = `${stem}-${idx++}${ext}`;
      destPath = path.join(assetsDir, finalName);
    }
    const rawBase64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(destPath, Buffer.from(rawBase64, 'base64'));
    return {
      ok: true,
      relativePath: `assets/${finalName}`,
      fullPath: destPath,
      fileName: finalName
    };
  });

  ipcMain.handle('searchWorkspace', (_, queryStr) => {
    const q = String(queryStr || '').trim().toLowerCase();
    const allFiles = [];
    const walk = (dir, depth) => {
      if (depth > 4 || !fs.existsSync(dir) || allFiles.length >= 500) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fp, depth + 1);
        else if (/\.(md|markdown|txt)$/i.test(entry.name)) allFiles.push(fp);
      }
    };
    walk(currentWorkspacePath, 0);

    const results = [];
    if (!q) {
      for (const fp of allFiles.slice(0, 40)) {
        results.push({
          path: fp,
          name: path.basename(fp),
          relPath: path.relative(currentWorkspacePath, fp),
          line: 0,
          snippet: '',
          matchType: 'file'
        });
      }
      return { results };
    }

    for (const fp of allFiles) {
      if (results.length >= 60) break;
      const rel = path.relative(currentWorkspacePath, fp);
      if (rel.toLowerCase().includes(q)) {
        results.push({ path: fp, name: path.basename(fp), relPath: rel, line: 0, snippet: '文件名匹配', matchType: 'file' });
      }
    }
    for (const fp of allFiles) {
      if (results.length >= 60) break;
      const content = fs.readFileSync(fp, 'utf-8');
      if (!content.toLowerCase().includes(q)) continue;
      const rel = path.relative(currentWorkspacePath, fp);
      const lines = content.split(/\r?\n/);
      let hits = 0;
      for (let i = 0; i < lines.length && results.length < 60 && hits < 5; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          results.push({
            path: fp,
            name: path.basename(fp),
            relPath: rel,
            line: i + 1,
            snippet: lines[i].trim().slice(0, 120),
            matchType: 'content'
          });
          hits++;
        }
      }
    }
    return { results };
  });

  ipcMain.handle('saveFileAs', async (_, { defaultName, content }) => {
    const res = await dialog.showSaveDialog(mainWindow, { defaultName });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, content, 'utf-8');
    return { ok: true, path: res.filePath, name: path.basename(res.filePath) };
  });

  ipcMain.handle('exportHTML', async (_, { defaultName, content }) => {
    const res = await dialog.showSaveDialog(mainWindow, { defaultName });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, content, 'utf-8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('exportPDF', async (_, { defaultName }) => {
    const res = await dialog.showSaveDialog(mainWindow, { defaultName });
    if (res.canceled || !res.filePath) return { ok: false };
    const pdfData = await mainWindow.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(res.filePath, pdfData);
    return { ok: true, path: res.filePath };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
