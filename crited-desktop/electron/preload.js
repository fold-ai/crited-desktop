const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop:        true,
  platform:         process.platform,
  getVersion:       ()            => ipcRenderer.invoke('get-version'),
  quitAndInstall:   ()            => ipcRenderer.invoke('quit-and-install'),
  notify:           (title, body) => ipcRenderer.invoke('notify', { title, body }),
  openExternal:     (url)         => ipcRenderer.invoke('open-external', url),
  // Open OAuth in a popup window inside the app (session stays in Electron)
  openAuthPopup:    (url)         => ipcRenderer.invoke('open-auth-popup', url),
});
