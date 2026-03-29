# Crited Desktop

Native desktop app for [crited.com](https://crited.com) — built with Electron.

## Stack

- **Electron 29** — native shell
- **electron-builder** — DMG + NSIS packaging
- **electron-updater** — auto-updates via GitHub Releases
- **electron-log** — native logging

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Run with DevTools open
npm run dev
```

## Building

```bash
# macOS only (DMG — x64 + arm64)
npm run build:mac

# Windows only (NSIS installer)
npm run build:win

# Both platforms
npm run build:all
```

Output goes to `dist/`.

## Releasing a New Version

1. Update version in `package.json`
2. Commit and push
3. Create a git tag:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. GitHub Actions automatically builds DMG + EXE and creates a GitHub Release
5. `electron-updater` picks up the new release and notifies existing users

## Auto-Update

The app checks for updates on startup and every 30 minutes.
Users get a macOS notification when an update is ready.

## Adding to crited.com Landing Page

The landing page should detect the OS and show the right download:

```javascript
const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');
const isWin = navigator.platform.includes('Win');

// Link to GitHub Releases
const baseUrl = 'https://github.com/fold-ai/crited-desktop/releases/latest/download';
const downloadUrl = isMac
  ? `${baseUrl}/Crited-1.0.0-arm64.dmg`   // or x64 based on arch
  : `${baseUrl}/Crited-Setup-1.0.0.exe`;
```

## Required Build Assets

Place these in `build/`:

| File | Size | Notes |
|------|------|-------|
| `icon.icns` | — | macOS icon (1024×1024 source) |
| `icon.ico` | — | Windows icon (256×256) |
| `icon.png` | 512×512 | Linux + tray fallback |
| `tray-icon.png` | 16×16 | macOS menu bar (template image) |
| `dmg-background.png` | 540×380 | DMG window background |

### Generate icons from a single PNG

```bash
# macOS — requires iconutil
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset

# Windows — use https://convertico.com or ImageMagick
convert icon.png -resize 256x256 icon.ico
```

## Architecture

```
User opens Crited.app
  → Splash screen (0.8s)
  → Loads https://crited.com in native window
  → Injects window.__CRITED_DESKTOP__ = true
  → Crited web app detects desktop mode
  → System tray icon appears (agents work in background)
  → Auto-updater checks GitHub Releases
```

## Desktop-Specific Features

When `window.__CRITED_DESKTOP__` is true, Crited web app can:

```javascript
// Check if running as desktop app
if (window.electronAPI?.isDesktop) {
  // Send native notification from agent
  window.electronAPI.notify('PM Agent', 'Sprint health score dropped to 6.2');

  // Open links in browser (not inside app)
  window.electronAPI.openExternal('https://github.com/...');
}
```
