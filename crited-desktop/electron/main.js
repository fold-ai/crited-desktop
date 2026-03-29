const { app, BrowserWindow, shell, Tray, Menu, nativeImage,
        ipcMain, Notification, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// ─── CONFIG ──────────────────────────────────────────────────
const APP_URL = 'https://crited.com';
const APP_NAME = 'Crited';
const ICON_PATH = path.join(__dirname, '../build/icon.png');

let mainWindow = null;
let tray = null;
let splashWindow = null;
let isQuitting = false;

// ─── AUTO UPDATER ─────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Crited Update Available',
        body: `Version ${info.version} is downloading...`,
        icon: ICON_PATH,
      }).show();
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Crited Updated',
        body: 'Restart Crited to apply the update.',
        icon: ICON_PATH,
      }).show();
    }
    // Show update dialog in app
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(
        `window.__crited_update_ready = true; window.dispatchEvent(new Event('crited-update-ready'));`
      );
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err);
  });

  // Check on startup and every 30 minutes
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 30 * 60 * 1000);
}

// ─── SPLASH SCREEN ────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 280,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

// ─── MAIN WINDOW ──────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0a',
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true,
    },
  });

  // Load Crited web app
  mainWindow.loadURL(APP_URL);

  // Inject desktop class for CSS targeting
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      document.body.classList.add('crited-desktop');
      document.body.classList.add('platform-${process.platform}');
      window.__CRITED_DESKTOP__ = true;
      window.__CRITED_VERSION__ = '${app.getVersion()}';
    `);

    // Close splash and show main window
    if (splashWindow && !splashWindow.isDestroyed()) {
      setTimeout(() => {
        splashWindow.close();
        splashWindow = null;
        mainWindow.show();
      }, 800);
    } else {
      mainWindow.show();
    }
  });

  // Open external links in browser, not in app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Minimize to tray on close (macOS)
  mainWindow.on('close', (e) => {
    if (!isQuitting && process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  return mainWindow;
}

// ─── SYSTEM TRAY ──────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../build/tray-icon.png');
  const fallback = path.join(__dirname, '../build/icon.png');
  const icon = nativeImage.createFromPath(fs.existsSync(iconPath) ? iconPath : fallback);
  const trayIcon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('Crited — AI Product Workspace');

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: 'Open Crited',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else { createMainWindow(); }
      },
    },
    { type: 'separator' },
    {
      label: 'AI Office',
      click: () => {
        showAndNavigate('/office');
      },
    },
    {
      label: 'PM Agent',
      click: () => showAndNavigate('/agent'),
    },
    {
      label: 'Sprint Planner',
      click: () => showAndNavigate('/sprint'),
    },
    { type: 'separator' },
    {
      label: `Version ${app.getVersion()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit Crited',
      accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(buildMenu());

  // Click to show/hide (Windows/Linux)
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  }
}

function showAndNavigate(path) {
  if (!mainWindow) { createMainWindow(); }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.executeJavaScript(
    `window.__navigate && window.__navigate('${path}');`
  );
}

// ─── IPC HANDLERS ─────────────────────────────────────────────
function setupIPC() {
  // Quit and install update
  ipcMain.handle('quit-and-install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  // Get app version
  ipcMain.handle('get-version', () => app.getVersion());

  // Show native notification from agent
  ipcMain.handle('notify', (_, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: ICON_PATH }).show();
    }
  });

  // Open external URL
  ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
}

// ─── APP LIFECYCLE ────────────────────────────────────────────
app.setName(APP_NAME);

// macOS: single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Session — allow crited.com cookies and auth
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': `Crited Desktop/${app.getVersion()}` } });
  });

  createSplash();
  createMainWindow();
  createTray();
  setupIPC();

  // Auto updater (skip in dev)
  if (app.isPackaged) {
    setupAutoUpdater();
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
  else mainWindow.show();
});

app.on('before-quit', () => { isQuitting = true; });
