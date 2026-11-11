const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  // Use src preload in development to avoid dist/preload mismatch
  const preloadPath = process.env.NODE_ENV === 'development' ? path.join(process.cwd(), 'src', 'electron', 'preload.js') : path.join(__dirname, 'preload.js');
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'build-icons', process.platform === 'darwin' ? 'app.icns' : 'app.ico') : path.join(process.cwd(), 'build-icons', process.platform === 'darwin' ? 'app.icns' : 'app.ico');
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') {
    win.loadURL(devUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

// IPC handlers for playlist persistence and filesystem helper
ipcMain.handle('save-playlist', async (_, playlists) => {
  try {
    const p = path.join(app.getPath('userData'), 'playlists.json');
    fs.writeFileSync(p, JSON.stringify(playlists, null, 2), 'utf8');
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('load-playlist', async () => {
  try {
    const p = path.join(app.getPath('userData'), 'playlists.json');
    if (!fs.existsSync(p)) return { ok: true, playlists: null };
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ok: true, playlists: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('readdir-recursive', async (_, dirPath) => {
  const out = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  try { walk(dirPath); return { ok: true, files: out }; } catch (err) { return { ok: false, error: String(err) }; }
});

ipcMain.handle('stat', async (_, pth) => {
  try { const s = fs.statSync(pth); return { ok: true, isFile: s.isFile(), isDirectory: s.isDirectory() }; } catch (err) { return { ok: false, error: String(err) }; }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });