const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop:        true,
  platform:         process.platform,
  getVersion:       ()            => ipcRenderer.invoke('get-version'),
  quitAndInstall:   ()            => ipcRenderer.invoke('quit-and-install'),
  notify:           (title, body) => ipcRenderer.invoke('notify', { title, body }),
  openExternal:     (url)         => ipcRenderer.invoke('open-external', url),
  // FIX 3: open OAuth in default browser (passwords auto-fill there)
  openAuthBrowser:  (url)         => ipcRenderer.invoke('open-auth-browser', url),
});
