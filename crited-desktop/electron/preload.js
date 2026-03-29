const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer (Crited web app)
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),
  isDesktop: true,
  platform: process.platform,

  // Update
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', cb),

  // Native notifications (AI agents)
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  // Open links in browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
