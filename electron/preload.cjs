const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Methods to access local file system or native APIs
  saveProject: (data) => ipcRenderer.invoke('dialog:saveProject', data),
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
  checkFileExists: (path) => ipcRenderer.invoke('fs:checkExists', path),
  saveAutoSave: (data) => ipcRenderer.invoke('fs:saveAutoSave', data),
  loadAutoSave: () => ipcRenderer.invoke('fs:loadAutoSave'),
  onMenuNew: (callback) => {
    ipcRenderer.removeAllListeners('menu:new');
    ipcRenderer.on('menu:new', () => callback());
  },
  onMenuOpen: (callback) => {
    ipcRenderer.removeAllListeners('menu:open');
    ipcRenderer.on('menu:open', () => callback());
  },
  onMenuSave: (callback) => {
    ipcRenderer.removeAllListeners('menu:save');
    ipcRenderer.on('menu:save', () => callback());
  }
});
