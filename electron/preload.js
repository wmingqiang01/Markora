const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getInitialWorkspace: () => ipcRenderer.invoke('getInitialWorkspace'),
  openFolderDialog: () => ipcRenderer.invoke('openFolderDialog'),
  openFolderByPath: (folderPath) => ipcRenderer.invoke('openFolderByPath', folderPath),
  revealInFinder: (targetPath) => ipcRenderer.invoke('revealInFinder', targetPath),
  openFileDialog: () => ipcRenderer.invoke('openFileDialog'),
  readFile: (filePath) => ipcRenderer.invoke('readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('writeFile', { filePath, content }),
  createFile: (folderPath, fileName, content) => ipcRenderer.invoke('createFile', { folderPath, fileName, content }),
  createFolder: (parentPath, folderName) => ipcRenderer.invoke('createFolder', { parentPath, folderName }),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('renameFile', { oldPath, newName }),
  deleteFile: (filePath) => ipcRenderer.invoke('deleteFile', filePath),
  saveImageAsset: (mdFilePath, fileName, base64Data) => ipcRenderer.invoke('saveImageAsset', { mdFilePath, fileName, base64Data }),
  searchWorkspace: (query) => ipcRenderer.invoke('searchWorkspace', query),
  watchState: (rootPath, filePath, content) => ipcRenderer.invoke('watchState', { rootPath, filePath, content }),
  reloadWorkspaceAndFile: (filePath) => ipcRenderer.invoke('reloadWorkspaceAndFile', filePath),
  onExternalSync: (cb) => ipcRenderer.on('external-sync', (_, data) => cb(data)),
  saveFileAs: (defaultName, content) => ipcRenderer.invoke('saveFileAs', { defaultName, content }),
  exportHTML: (defaultName, content) => ipcRenderer.invoke('exportHTML', { defaultName, content }),
  exportPDF: (defaultName) => ipcRenderer.invoke('exportPDF', { defaultName })
});
