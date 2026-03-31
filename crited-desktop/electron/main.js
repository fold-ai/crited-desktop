const { app, BrowserWindow, shell, Tray, Menu, nativeImage,
        ipcMain, Notification, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const APP_NAME  = 'Crited';
const APP_URL   = 'https://crited.com';
const ICON_PATH = path.join(__dirname, '../build/icon.png');

let mainWindow  = null;
let tray        = null;
let splashWindow = null;
let isQuitting  = false;

// ─── DESKTOP CSS ─────────────────────────────────────────────
const DESKTOP_CSS = `
  body[data-platform="darwin"] nav:first-of-type,
  body[data-platform="darwin"] header:first-of-type,
  body[data-platform="darwin"] .app-topbar,
  body[data-platform="darwin"] .crited-desktop-topbar {
    padding-left: 84px !important;
  }
  body.crited-desktop nav,
  body.crited-desktop header,
  body.crited-desktop [data-tauri-drag-region],
  body.crited-desktop .titlebar,
  body.crited-desktop .crited-desktop-topbar {
    -webkit-app-region: drag;
    user-select: none;
  }
  body.crited-desktop nav button,
  body.crited-desktop nav a,
  body.crited-desktop nav input,
  body.crited-desktop nav select,
  body.crited-desktop header button,
  body.crited-desktop header a,
  body.crited-desktop header input,
  body.crited-desktop header select,
  body.crited-desktop .crited-desktop-topbar button,
  body.crited-desktop .crited-desktop-topbar a,
  body.crited-desktop .crited-desktop-topbar input,
  body.crited-desktop .crited-desktop-topbar select,
  body.crited-desktop .crited-desktop-topbar kbd {
    -webkit-app-region: no-drag;
  }
`;

function injectDesktopEnv() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const version = app.getVersion();
  const platform = process.platform;
  mainWindow.webContents.executeJavaScript(`
    (function() {
      document.body.classList.add('crited-desktop');
      document.body.setAttribute('data-platform', '${platform}');
      window.__CRITED_DESKTOP__  = true;
      window.__CRITED_VERSION__  = '${version}';
      window.__CRITED_PLATFORM__ = '${platform}';

      let s = document.getElementById('crited-desktop-styles');
      if (!s) {
        s = document.createElement('style');
        s.id = 'crited-desktop-styles';
        document.head.appendChild(s);
      }
      s.textContent = ${JSON.stringify(DESKTOP_CSS)};

      if (!window.__critedDragObserver) {
        function tagDragRegions() {
          document.querySelectorAll('div[style*="border-bottom"]').forEach(el => {
            const style = el.getAttribute('style') || '';
            if (style.includes('border-bottom') && style.includes('flex') &&
                el.offsetHeight < 60 && el.offsetHeight > 20 &&
                !el.classList.contains('crited-desktop-topbar')) {
              el.classList.add('crited-desktop-topbar');
            }
          });
        }
        tagDragRegions();
        window.__critedDragObserver = new MutationObserver(() => {
          requestAnimationFrame(tagDragRegions);
        });
        window.__critedDragObserver.observe(document.body, { childList: true, subtree: true });
      }
    })();
  `).catch(() => {});
}

// ─── AUTO UPDATER ─────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.executeJavaScript(
      `window.dispatchEvent(new Event('crited-update-ready'));`
    );
  });
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 30 * 60 * 1000);
}

// ─── SPLASH ───────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 400, height: 280,
    transparent: true, frame: false,
    alwaysOnTop: true, skipTaskbar: true,
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

    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 16 },
    movable: true,

    backgroundColor: '#0a0a0a',
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true,
      // Persist session so Google remembers your account after first login
      partition: 'persist:crited',
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.on('did-finish-load', () => {
    injectDesktopEnv();

    if (splashWindow && !splashWindow.isDestroyed()) {
      setTimeout(() => {
        splashWindow.close();
        splashWindow = null;
        mainWindow.show();
        mainWindow.focus();
      }, 900);
    } else {
      mainWindow.show();
    }
  });

  // Re-inject on SPA navigation
  mainWindow.webContents.on('did-navigate-in-page', () => {
    injectDesktopEnv();
  });

  // Re-inject after full navigation (OAuth redirect back to crited.com)
  mainWindow.webContents.on('did-navigate', () => {
    injectDesktopEnv();
  });

  // External links via window.open → system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

// ─── DEEP LINK ────────────────────────────────────────────────
function setupDeepLink() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('crited', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('crited');
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function handleDeepLink(url) {
  if (!mainWindow) createMainWindow();
  if (url.startsWith('crited://')) {
    const webUrl = url.replace('crited://', `${APP_URL}/`);
    mainWindow.loadURL(webUrl);
  }
  mainWindow.show();
  mainWindow.focus();
}

// ─── TRAY ─────────────────────────────────────────────────────
function createTray() {
  const trayPath = path.join(__dirname, '../build/tray-icon.png');
  const iconFile = fs.existsSync(trayPath)
    ? trayPath
    : path.join(__dirname, '../build/icon.png');
  const icon = nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Crited — AI Product Workspace');

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Crited',    click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'AI Office',      click: () => showAndNavigate('/office') },
    { label: 'PM Agent',       click: () => showAndNavigate('/agent') },
    { label: 'Sprint Planner', click: () => showAndNavigate('/sprint') },
    { type: 'separator' },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit Crited',
      accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
      click: () => { isQuitting = true; app.quit(); } },
  ]));

  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show();
    });
  }
}

function showAndNavigate(p) {
  if (!mainWindow) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.executeJavaScript(`window.__navigate && window.__navigate('${p}')`);
}

// ─── IPC ──────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('get-version',      ()          => app.getVersion());
  ipcMain.handle('quit-and-install', ()          => { isQuitting = true; autoUpdater.quitAndInstall(); });
  ipcMain.handle('open-external',    (_, url)    => shell.openExternal(url));
  ipcMain.handle('notify', (_, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body, icon: ICON_PATH }).show();
  });

  // Navigate main window to a URL (used for OAuth redirect)
  ipcMain.handle('navigate-to', (_, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(url);
    }
  });
}

// ─── APP LIFECYCLE ────────────────────────────────────────────
app.setName(APP_NAME);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const deepLink = argv.find(a => a.startsWith('crited://'));
    if (deepLink) handleDeepLink(deepLink);
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

app.whenReady().then(() => {
  setupDeepLink();

  // Use the persisted session for User-Agent header
  const ses = session.fromPartition('persist:crited');
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: {
      ...details.requestHeaders,
      'User-Agent': `Crited Desktop/${app.getVersion()} Electron/${process.versions.electron}`,
    }});
  });

  createSplash();
  createMainWindow();
  createTray();
  setupIPC();

  if (app.isPackaged) setupAutoUpdater();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate',          () => { if (!mainWindow) createMainWindow(); else mainWindow.show(); });
app.on('before-quit',       () => { isQuitting = true; });
