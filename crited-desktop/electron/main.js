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

    // FIX 1 + 2: hiddenInset gives traffic lights without covering content
    // traffic lights sit at x:20 y:16 — same as Cursor
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
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      (function() {
        document.body.classList.add('crited-desktop');
        document.body.setAttribute('data-platform', '${process.platform}');
        window.__CRITED_DESKTOP__  = true;
        window.__CRITED_VERSION__  = '${app.getVersion()}';
        window.__CRITED_PLATFORM__ = '${process.platform}';

        // FIX 2: inject CSS so traffic lights don't overlap logo/nav
        const s = document.createElement('style');
        s.id = 'crited-desktop-styles';
        s.textContent = \`
          /* ── macOS traffic light safe zone ── */
          body[data-platform="darwin"] nav:first-of-type,
          body[data-platform="darwin"] header:first-of-type,
          body[data-platform="darwin"] .app-topbar {
            padding-left: 84px !important;
          }

          /* ── FIX 1: make top bar draggable (move window by dragging) ── */
          body.crited-desktop nav,
          body.crited-desktop header,
          body.crited-desktop [data-tauri-drag-region],
          body.crited-desktop .titlebar {
            -webkit-app-region: drag;
            user-select: none;
          }

          /* ── Buttons/inputs inside drag area must NOT be draggable ── */
          body.crited-desktop nav button,
          body.crited-desktop nav a,
          body.crited-desktop nav input,
          body.crited-desktop header button,
          body.crited-desktop header a,
          body.crited-desktop header input,
          body.crited-desktop header select {
            -webkit-app-region: no-drag;
          }
        \`;
        document.head.appendChild(s);
      })();
    `);

    // Close splash → show main window
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

  // FIX 3: intercept OAuth navigations → open in default browser
  // Supabase/Google/GitHub auth pages open in the user's real browser
  // where their passwords are saved → much better UX
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isOAuth = (
      url.includes('accounts.google.com') ||
      url.includes('github.com/login/oauth') ||
      url.includes('github.com/login?') ||
      (url.includes('supabase.co') && url.includes('/auth/v1/authorize'))
    );
    if (isOAuth) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Also catch window.open calls for OAuth popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isOAuth = (
      url.includes('accounts.google.com') ||
      url.includes('github.com/login') ||
      url.includes('supabase.co/auth')
    );
    if (isOAuth) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // Internal app links → allow
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    // Everything else → browser
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

// ─── DEEP LINK — auth callback ────────────────────────────────
// Register crited:// so after OAuth in browser it returns to the app
function setupDeepLink() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('crited', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('crited');
  }

  // macOS: open-url event
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function handleDeepLink(url) {
  if (!mainWindow) createMainWindow();
  // crited://auth/callback?access_token=... → translate to https and load
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
  ipcMain.handle('get-version',        ()          => app.getVersion());
  ipcMain.handle('quit-and-install',   ()          => { isQuitting = true; autoUpdater.quitAndInstall(); });
  ipcMain.handle('open-external',      (_, url)    => shell.openExternal(url));
  ipcMain.handle('open-auth-browser',  (_, url)    => shell.openExternal(url));
  ipcMain.handle('notify', (_, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body, icon: ICON_PATH }).show();
  });
}

// ─── APP LIFECYCLE ────────────────────────────────────────────
app.setName(APP_NAME);

// Single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    // Windows deep link
    const deepLink = argv.find(a => a.startsWith('crited://'));
    if (deepLink) handleDeepLink(deepLink);
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

app.whenReady().then(() => {
  setupDeepLink();

  // Tag requests as Crited Desktop
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
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
