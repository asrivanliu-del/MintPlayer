import { app, BrowserWindow, ipcMain as electronIpcMain, dialog, protocol, nativeImage, screen, shell, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { spawn } from 'child_process';
import type { IpcMainInvokeEvent } from 'electron';
import { parseStoredPlaylists } from './playlistStorage';
import { normalizeLyricsText } from './lyricsText';
import { searchLyricsOvh } from './onlineLyrics';
import { searchOnlineMetadata } from './onlineMetadata';
import { createMusicProtocolCorsHeaders } from './musicProtocol';
import { scanAudioFiles } from './audioFileScanner';
import { readMediaLibraryPath, writeMediaLibraryPath } from './mediaLibrarySettings';
import { separateAudioFile } from './vocalSplitter';
import { alignKaraokeSource, getKaraokeOutputPath, parseKaraokeAss, updateKaraokeAss } from './karaokeAligner';
import { downloadVideoFormat, downloadVideoMp4, downloadVideoThumbnail, getVideoFormatErrorMessage, listVideoFormats, searchVideoPlatforms } from './videoDownloader';
import { createAria2TorrentEngine, createTorrentDownloadManager } from './torrentDownloader';
import { acquireSingleInstanceLock } from './singleInstance';
import { keepWindowBoundsVisible, parseWindowBounds, type WindowBounds } from './windowState';
import {
  DEVELOPMENT_RENDERER_URL,
  isTrustedRendererIpcSender,
  isTrustedRendererUrl,
  shouldLoadDevelopmentRenderer
} from './rendererSecurity';
import type { ElectronMetadataSearchHints } from './electronApi';
import type { ElectronOnlineLyricsResult } from './electronApi';
import type { ElectronKaraokeSubtitleLine, ElectronTimedLyric } from './electronApi';

const importMusicMetadata = new Function('return import("music-metadata")') as () => Promise<typeof import('music-metadata')>;
const importNaria2Node = new Function('return import("@naria2/node")') as () => Promise<{
  getNaria2Binary: () => string;
}>;

function isKaraokeTimedLyrics(value: unknown): value is ElectronTimedLyric[] {
  if (!Array.isArray(value) || value.length > 5000) return false;
  const lines = value as unknown[];
  if (!lines.every(line => {
    if (typeof line !== 'object' || line === null) return false;
    const record = line as Record<string, unknown>;
    return typeof record.time === 'number' &&
      Number.isFinite(record.time) &&
      record.time >= 0 &&
      record.time <= 86400 &&
      typeof record.text === 'string' &&
      record.text.trim().length > 0 &&
      record.text.length <= 5000;
  })) return false;
  return lines.every((line, index) =>
    index === 0 || (line as ElectronTimedLyric).time >= (lines[index - 1] as ElectronTimedLyric).time
  );
}

// Register 'music' as a privileged scheme so it behaves like a normal, secure origin and supports fetch
protocol.registerSchemesAsPrivileged([{ scheme: 'music', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let mainWindow: BrowserWindow | null = null;
let windowStateSaveTimer: NodeJS.Timeout | null = null;
const hasSingleInstanceLock = acquireSingleInstanceLock(
  app,
  () => mainWindow,
  () => { void createWindow(); }
);

const torrentDownloadManager = createTorrentDownloadManager({
  createEngine: async () => {
    const { getNaria2Binary } = await importNaria2Node();
    let binaryPath = getNaria2Binary();
    if (app.isPackaged) {
      const appPath = app.getAppPath();
      const unpackedAppPath = `${appPath}.unpacked`;
      const binaryPathInAsar = path.relative(appPath, binaryPath);
      if (!binaryPath.includes(`${path.sep}app.asar.unpacked${path.sep}`)) {
        const unpackedBinaryPath = path.join(unpackedAppPath, binaryPathInAsar);
        if (fs.existsSync(unpackedBinaryPath)) binaryPath = unpackedBinaryPath;
      }
    }
    return createAria2TorrentEngine(binaryPath);
  },
  onProgress: progress => {
    const webContents = mainWindow?.isDestroyed() ? null : mainWindow?.webContents ?? null;
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('torrent-download-progress', progress);
    }
  }
});

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

const ipcMain = {
  handle(channel: string, handler: IpcHandler) {
    electronIpcMain.handle(channel, (event, ...args) => {
      const rendererFilePath = path.join(__dirname, '../renderer/index.html');
      const webContents = mainWindow?.isDestroyed() ? null : mainWindow?.webContents ?? null;
      if (!isTrustedRendererIpcSender(
        event.sender,
        event.senderFrame,
        webContents,
        webContents?.mainFrame ?? null,
        shouldLoadDevelopmentRenderer(app.isPackaged, process.env.NODE_ENV),
        rendererFilePath
      )) {
        throw new Error(`Rejected IPC request "${channel}" from an untrusted renderer.`);
      }
      return handler(event, ...args);
    });
  }
};

function logVideoDownloadProgress(message: string) {
  try {
    const logPath = path.join(app.getPath('temp'), 'player-ui.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} video download IPC: ${message}\n`, 'utf8');
  } catch (error) {
    console.warn('Unable to write video download IPC log', error);
  }
}

export async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return mainWindow;
  }

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build-icons', process.platform === 'darwin' ? 'app.icns' : 'app.ico')
    : path.join(process.cwd(), 'build-icons', process.platform === 'darwin' ? 'app.icns' : 'app.ico');

  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const defaultBounds: WindowBounds = {
    x: Math.round(primaryWorkArea.x + (primaryWorkArea.width - Math.min(1000, primaryWorkArea.width)) / 2),
    y: Math.round(primaryWorkArea.y + (primaryWorkArea.height - Math.min(700, primaryWorkArea.height)) / 2),
    width: Math.min(1000, primaryWorkArea.width),
    height: Math.min(700, primaryWorkArea.height)
  };
  const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
  let savedBounds = null;
  try {
    if (fs.existsSync(windowStatePath)) {
      savedBounds = parseWindowBounds(JSON.parse(fs.readFileSync(windowStatePath, 'utf8')));
      if (!savedBounds) console.warn('Saved window bounds are invalid; using the primary display.');
    }
  } catch (error) {
    console.warn('Unable to read saved window bounds; using the primary display.', error);
  }
  const bounds = keepWindowBoundsVisible(
    savedBounds,
    screen.getAllDisplays().map(display => display.workArea),
    defaultBounds
  );

  const saveWindowBounds = () => {
    if (!window || window.isDestroyed()) return;
    const normalBounds = window.getNormalBounds();
    const state: WindowBounds = {
      x: normalBounds.x,
      y: normalBounds.y,
      width: normalBounds.width,
      height: normalBounds.height
    };
    const temporaryPath = `${windowStatePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(state), { encoding: 'utf8', flag: 'w' });
      try {
        fs.renameSync(temporaryPath, windowStatePath);
      } catch (error) {
        if (!fs.existsSync(windowStatePath)) throw error;
        fs.unlinkSync(windowStatePath);
        fs.renameSync(temporaryPath, windowStatePath);
      }
    } catch (error) {
      console.warn('Unable to save window bounds', error);
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  };

  mainWindow = new BrowserWindow({
    ...bounds,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const window = mainWindow;
  const scheduleWindowBoundsSave = () => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = setTimeout(saveWindowBounds, 250);
  };
  window.on('move', scheduleWindowBoundsSave);
  window.on('resize', scheduleWindowBoundsSave);
  window.once('close', () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    saveWindowBounds();
  });
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  const rendererFilePath = path.join(__dirname, '../renderer/index.html');
  const useDevelopmentRenderer = shouldLoadDevelopmentRenderer(app.isPackaged, process.env.NODE_ENV);
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, useDevelopmentRenderer, rendererFilePath)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (useDevelopmentRenderer) {
    try {
      await mainWindow.loadURL(DEVELOPMENT_RENDERER_URL);
      if (process.env.OPEN_DEVTOOLS === '1' || process.env.OPEN_DEVTOOLS === 'true') {
        mainWindow.webContents.openDevTools();
      }
    } catch (e) {
      console.warn('Failed to load dev URL, falling back to file:', e);
      await mainWindow.loadFile(rendererFilePath);
    }
  } else {
    await mainWindow.loadFile(rendererFilePath);
  }

  return mainWindow;
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  Menu.setApplicationMenu(null);
  // Register music:// protocol serving local files with Range support
  try {
    protocol.registerStreamProtocol('music', (request, callback) => {
      try {
        if (request.method === 'OPTIONS') {
          callback({
            statusCode: 204,
            headers: createMusicProtocolCorsHeaders()
          });
          return;
        }
        const url = new URL(request.url);
        // support music://local/C:/path or music://C:/path (host optional)
        let filePath = '';
        if (url.host) {
          // pathname may include leading '/'
          filePath = decodeURIComponent(url.pathname);
        } else {
          filePath = decodeURIComponent(url.pathname);
        }
        // On Windows strip leading slash if present (e.g., /C:/...)
        if (process.platform === 'win32' && filePath.startsWith('/')) filePath = filePath.slice(1);
        const stat = fs.statSync(filePath);
        const total = stat.size;
        const rangeHeader = (request.headers && (request.headers.range || request.headers.Range)) || '';
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.flac' ? 'audio/flac' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
        if (rangeHeader && rangeHeader.startsWith('bytes=')) {
          // correct regex: use single backslashes inside a regex literal so \d is treated as a digit
          const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (m) {
            const start = m[1] ? parseInt(m[1], 10) : 0;
            const end = m[2] ? parseInt(m[2], 10) : (total - 1);
            const chunkSize = (end - start) + 1;
            const stream = fs.createReadStream(filePath, { start, end });
            callback({
              statusCode: 206,
              headers: createMusicProtocolCorsHeaders({
                'Content-Type': mime,
                'Content-Length': String(chunkSize),
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes'
              }),
              data: stream
            });
            return;
          }
        }
        // no range requested; send full file
        const stream = fs.createReadStream(filePath);
        callback({
          statusCode: 200,
          headers: createMusicProtocolCorsHeaders({
            'Content-Type': mime,
            'Content-Length': String(total),
            'Accept-Ranges': 'bytes'
          }),
          data: stream
        });
      } catch (err) {
        console.error('music protocol error', err);
        callback({
          statusCode: 404,
          headers: createMusicProtocolCorsHeaders()
        });
      }
    });
  } catch (err) {
    console.warn('Failed to register music protocol', err);
  }

  await createWindow();
});

ipcMain.handle('load-media-library-path', async () => {
  try {
    return { ok: true, path: readMediaLibraryPath(app.getPath('userData')) };
  } catch (error) {
    console.error('Unable to load saved media library location', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('save-media-library-path', async (_, mediaLibraryPath: unknown) => {
  try {
    if (typeof mediaLibraryPath !== 'string') {
      return { ok: false, error: 'Media library location must be a string.' };
    }
    writeMediaLibraryPath(app.getPath('userData'), mediaLibraryPath);
    return { ok: true };
  } catch (error) {
    console.error('Unable to save media library location', error);
    return { ok: false, error: String(error) };
  }
});

// IPC handlers for playlist persistence and filesystem helper
ipcMain.handle('save-playlist', async (_, name: string, tracks: any[]) => {
  try {
    const p = path.join(app.getPath('userData'), 'playlists.json');
    let store: { name: string; tracks: any[] }[] = [];
    if (fs.existsSync(p)) {
      store = parseStoredPlaylists(fs.readFileSync(p, 'utf8'));
    }
    const idx = store.findIndex(s => s.name === name);
    if (idx >= 0) store[idx] = { name, tracks };
    else store.push({ name, tracks });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('load-playlists', async () => {
  try {
    const p = path.join(app.getPath('userData'), 'playlists.json');
    if (!fs.existsSync(p)) return { ok: true, playlists: [] };
    const playlists = parseStoredPlaylists(fs.readFileSync(p, 'utf8'));
    return { ok: true, playlists };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('readdir-recursive', async (_, dirPath: string) => {
  const out: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  try { walk(dirPath); return { ok: true, files: out }; } catch (err) { return { ok: false, error: String(err) }; }
});

ipcMain.handle('scan-audio-files', async (_, folderPath: string, recursive: boolean) => {
  try {
    if (typeof folderPath !== 'string' || typeof recursive !== 'boolean') {
      return { ok: false, error: 'Invalid folder scan options.' };
    }
    return { ok: true, files: scanAudioFiles(folderPath, recursive) };
  } catch (error) {
    console.error('Unable to scan audio files for Vocal Splitter', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('split-audio-stems', async (_, filePath: string, outputRoot: string) => {
  try {
    if (typeof filePath !== 'string' || typeof outputRoot !== 'string') {
      return { ok: false, error: 'Invalid vocal separation paths.' };
    }
    const outputs = await separateAudioFile(filePath, outputRoot, app.getPath('temp'));
    return {
      ok: true,
      vocalsPath: outputs.vocalsPath,
      accompanimentPath: outputs.accompanimentPath
    };
  } catch (error) {
    console.error('Unable to separate audio stems', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('align-karaoke-source', async (event, mediaPath: unknown, vocalsPath: unknown, lyrics: unknown, outputRoot: unknown, timedLyricsInput: unknown) => {
  try {
    const timedLyrics = timedLyricsInput === undefined
      ? undefined
      : isKaraokeTimedLyrics(timedLyricsInput)
        ? timedLyricsInput
        : null;
    if (
      typeof mediaPath !== 'string' ||
      typeof vocalsPath !== 'string' ||
      typeof lyrics !== 'string' ||
      lyrics.length > 256 * 1024 ||
      typeof outputRoot !== 'string' ||
      timedLyrics === null
    ) {
      return { ok: false, error: 'Invalid Karaoke Creator input.' };
    }
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts', 'karaoke_aligner.py')
      : path.join(app.getAppPath(), 'scripts', 'karaoke_aligner.py');
    const result = await alignKaraokeSource(
      mediaPath,
      vocalsPath,
      lyrics,
      outputRoot,
      scriptPath,
      message => {
        if (!event.sender.isDestroyed()) event.sender.send('karaoke-alignment-progress', { message });
      },
      undefined,
      timedLyrics
    );
    return { ok: true, outputPath: result.outputPath };
  } catch (error) {
    console.error('Unable to align karaoke lyrics', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('read-karaoke-subtitle', async (_, filePath: unknown) => {
  try {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.ass') {
      return { ok: false, error: 'Karaoke playback requires an ASS subtitle file.' };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
      return { ok: false, error: 'Karaoke subtitle must be a file no larger than 5 MB.' };
    }
    const lines = parseKaraokeAss(fs.readFileSync(filePath, 'utf8'));
    if (!lines.length) return { ok: false, error: 'The ASS subtitle contains no timed karaoke lines.' };
    return { ok: true, lines };
  } catch (error) {
    console.error('Unable to read karaoke subtitle', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('find-karaoke-subtitle', async (_, videoPath: unknown, mediaLibraryPath: unknown) => {
  try {
    if (typeof videoPath !== 'string' || typeof mediaLibraryPath !== 'string') {
      return { ok: false, error: 'Invalid Karaoke video or media library path.' };
    }
    const subtitlePath = getKaraokeOutputPath(videoPath, mediaLibraryPath);
    try {
      const stat = fs.statSync(subtitlePath);
      if (stat.isFile() && stat.size <= 5 * 1024 * 1024) return { ok: true, path: subtitlePath };
      return { ok: false, error: 'The matching Karaoke ASS file is not a valid subtitle file.' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, path: null };
      throw error;
    }
  } catch (error) {
    console.error('Unable to find the Karaoke subtitle for video', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('choose-karaoke-subtitle', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'ASS karaoke subtitles', extensions: ['ass'] }]
    });
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: result.filePaths };
  } catch (error) {
    console.error('Unable to choose Karaoke subtitle', error);
    return { canceled: true, error: String(error) };
  }
});

ipcMain.handle('choose-karaoke-subtitle-save-path', async (_, defaultPath: unknown) => {
  try {
    if (typeof defaultPath !== 'string' || path.extname(defaultPath).toLowerCase() !== '.ass') {
      return { ok: false, error: 'Invalid Karaoke subtitle destination.' };
    }
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: 'ASS karaoke subtitles', extensions: ['ass'] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, path: null };
    const savePath = path.extname(result.filePath).toLowerCase() === '.ass'
      ? result.filePath
      : `${result.filePath}.ass`;
    return { ok: true, path: savePath };
  } catch (error) {
    console.error('Unable to choose Karaoke subtitle destination', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('save-karaoke-subtitle', async (_, filePath: unknown, linesInput: unknown, sourcePathInput: unknown) => {
  let temporaryPath: string | null = null;
  try {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.ass') {
      return { ok: false, error: 'Choose an ASS karaoke subtitle to save.' };
    }
    if (!Array.isArray(linesInput) || linesInput.length > 5000) {
      return { ok: false, error: 'The edited subtitle contains invalid line data.' };
    }
    const sourcePath = sourcePathInput === undefined ? filePath : sourcePathInput;
    if (typeof sourcePath !== 'string' || path.extname(sourcePath).toLowerCase() !== '.ass') {
      return { ok: false, error: 'Choose a valid source ASS subtitle.' };
    }
    const sourceStat = fs.statSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size > 5 * 1024 * 1024) {
      return { ok: false, error: 'Karaoke subtitle must be a file no larger than 5 MB.' };
    }
    const lines = linesInput as ElectronKaraokeSubtitleLine[];
    if (!lines.every(line =>
      typeof line === 'object' && line !== null &&
      Number.isFinite(line.start) && Number.isFinite(line.end) &&
      typeof line.text === 'string' &&
      Array.isArray(line.characters) &&
      line.characters.every(character =>
        typeof character.text === 'string' &&
        Number.isFinite(character.start) && Number.isFinite(character.end))
    )) {
      return { ok: false, error: 'The edited subtitle contains invalid character timings.' };
    }

    const original = fs.readFileSync(sourcePath, 'utf8');
    const updated = updateKaraokeAss(original, lines);
    temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, updated, { encoding: 'utf8', flag: 'wx' });
    if (!fs.existsSync(path.dirname(filePath))) {
      throw new Error('The selected subtitle destination folder does not exist.');
    }
    fs.renameSync(temporaryPath, filePath);
    temporaryPath = null;
    return { ok: true };
  } catch (error) {
    console.error('Unable to save Karaoke subtitle', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (temporaryPath && fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
});

ipcMain.handle('list-video-formats', async (_, url: unknown) => {
  try {
    if (typeof url !== 'string') {
      return { ok: false, error: 'Invalid video URL.' };
    }
    return { ok: true, ...await listVideoFormats(url) };
  } catch (error) {
    console.error('Unable to list video formats', error);
    return { ok: false, error: getVideoFormatErrorMessage(error) };
  }
});

ipcMain.handle('search-video-platforms', async (_, query: unknown) => {
  try {
    if (typeof query !== 'string') {
      return { ok: false, error: 'Invalid video search query.' };
    }
    return { ok: true, ...await searchVideoPlatforms(query) };
  } catch (error) {
    console.error('Unable to search video platforms', error);
    return { ok: false, error: getVideoFormatErrorMessage(error) };
  }
});

ipcMain.handle('download-video-format', async (event, url: unknown, formatId: unknown, convertToMp3: unknown, mediaLibraryPath: unknown) => {
  try {
    if (
      typeof url !== 'string' ||
      typeof formatId !== 'string' ||
      typeof convertToMp3 !== 'boolean' ||
      typeof mediaLibraryPath !== 'string'
    ) {
      return { ok: false, error: 'Invalid video download options.' };
    }
    const download = await downloadVideoFormat(
      url,
      formatId,
      convertToMp3,
      mediaLibraryPath,
      progress => {
        const message = `format progress title=${JSON.stringify(progress.title)} percent=${progress.percent ?? 'null'}`;
        if (event.sender.isDestroyed()) {
          logVideoDownloadProgress(`not sent; renderer destroyed; ${message}`);
          return;
        }
        logVideoDownloadProgress(`sent; ${message}`);
        event.sender.send('video-download-progress', progress);
      }
    );
    return { ok: true, ...download };
  } catch (error) {
    console.error('Unable to download video format', error);
    return { ok: false, error: getVideoFormatErrorMessage(error) };
  }
});

ipcMain.handle('download-video-mp4', async (event, url: unknown, videoFormatId: unknown, audioFormatId: unknown, mediaLibraryPath: unknown) => {
  try {
    if (
      typeof url !== 'string' ||
      typeof videoFormatId !== 'string' ||
      (audioFormatId !== null && typeof audioFormatId !== 'string') ||
      typeof mediaLibraryPath !== 'string'
    ) {
      return { ok: false, error: 'Invalid MP4 download options.' };
    }
    const download = await downloadVideoMp4(
      url,
      videoFormatId,
      audioFormatId,
      mediaLibraryPath,
      progress => {
        const message = `MP4 progress title=${JSON.stringify(progress.title)} percent=${progress.percent ?? 'null'}`;
        if (event.sender.isDestroyed()) {
          logVideoDownloadProgress(`not sent; renderer destroyed; ${message}`);
          return;
        }
        logVideoDownloadProgress(`sent; ${message}`);
        event.sender.send('video-download-progress', progress);
      }
    );
    return { ok: true, ...download };
  } catch (error) {
    console.error('Unable to download video as MP4', error);
    return { ok: false, error: getVideoFormatErrorMessage(error) };
  }
});

ipcMain.handle('choose-torrent-file', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'BitTorrent files', extensions: ['torrent'] }]
    });
    if (result.canceled) return { canceled: true };
    const selectedPath = result.filePaths[0];
    if (!selectedPath) throw new Error('No torrent file was selected.');
    return { canceled: false, path: selectedPath };
  } catch (error) {
    console.error('Unable to choose torrent file', error);
    return { canceled: true, error: String(error) };
  }
});

ipcMain.handle('start-torrent-download', async (_, source: unknown, seedOnComplete: unknown) => {
  try {
    const mediaLibraryPath = readMediaLibraryPath(app.getPath('userData'));
    if (!mediaLibraryPath) {
      return { ok: false, error: 'Set the media library location in Config before downloading.' };
    }
    const result = await torrentDownloadManager.start(source, mediaLibraryPath, seedOnComplete);
    return { ok: true, ...result };
  } catch (error) {
    console.error('Unable to start torrent download', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('stop-torrent-download', async (_, jobId: unknown) => {
  try {
    return { ok: true, ...await torrentDownloadManager.stop(jobId) };
  } catch (error) {
    console.error('Unable to stop torrent download', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('get-torrent-download-progress', async () => ({
  ok: true,
  progress: torrentDownloadManager.getProgress()
}));

function getDownloadedMediaPath(filePath: unknown) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Invalid downloaded media file path.');
  }
  const resolvedPath = path.resolve(filePath);
  if (path.basename(path.dirname(resolvedPath)).toLowerCase() !== 'downloads') {
    throw new Error('Downloaded media must be inside the Downloads folder.');
  }
  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error('Downloaded media file was not found.');
  }
  return resolvedPath;
}

ipcMain.handle('open-downloaded-media-folder', async (_, filePath: unknown) => {
  try {
    const resolvedPath = getDownloadedMediaPath(filePath);
    const error = await shell.openPath(path.dirname(resolvedPath));
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('open-downloaded-media-file', async (_, filePath: unknown) => {
  try {
    const resolvedPath = getDownloadedMediaPath(filePath);
    const error = await shell.openPath(resolvedPath);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('download-video-thumbnail', async (_, url: unknown, mediaLibraryPath: unknown) => {
  try {
    if (typeof url !== 'string' || typeof mediaLibraryPath !== 'string') {
      return { ok: false, error: 'Invalid video URL.' };
    }
    const download = await downloadVideoThumbnail(url, mediaLibraryPath);
    return { ok: true, ...download };
  } catch (error) {
    console.error('Unable to download video thumbnail', error);
    return { ok: false, error: getVideoFormatErrorMessage(error) };
  }
});

ipcMain.handle('choose-folder', async () => {
  try {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (res.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: res.filePaths };
  } catch (err) { return { canceled: true, error: String(err) }; }
});

ipcMain.handle('choose-folder-files', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (result.canceled) return { canceled: true, paths: [] };

    const files: string[] = [];
    const pendingDirectories = [...result.filePaths];
    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop()!;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
        } else if (entry.isFile() && /\.(mp3|flac|mp4)$/i.test(entry.name)) {
          files.push(entryPath);
        }
      }
    }

    return { canceled: false, paths: files };
  } catch (err) {
    console.error('Unable to read audio files from the selected folder', err);
    return { canceled: true, error: String(err) };
  }
});

ipcMain.handle('choose-files', async () => {
  try {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio and video files', extensions: ['mp3', 'flac', 'mp4'] },
        { name: 'MP3 audio', extensions: ['mp3'] }
      ]
    });
    if (res.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: res.filePaths };
  } catch (err) {
    console.error('Unable to choose audio files', err);
    return { canceled: true, error: String(err) };
  }
});

ipcMain.handle('choose-karaoke-source', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Music and video files', extensions: ['mp3', 'flac', 'wav', 'mp4'] }]
    });
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: result.filePaths };
  } catch (error) {
    console.error('Unable to choose Karaoke source', error);
    return { canceled: true, error: String(error) };
  }
});

ipcMain.handle('choose-karaoke-video', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    });
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: result.filePaths };
  } catch (error) {
    console.error('Unable to choose Karaoke video', error);
    return { canceled: true, error: String(error) };
  }
});

ipcMain.handle('choose-karaoke-lrc', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'LRC lyrics', extensions: ['lrc'] }]
    });
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: result.filePaths };
  } catch (error) {
    console.error('Unable to choose Karaoke LRC file', error);
    return { canceled: true, error: String(error) };
  }
});

ipcMain.handle('read-karaoke-lrc', async (_, filePath: unknown) => {
  try {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.lrc') {
      return { ok: false, error: 'Choose an LRC lyrics file.' };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
      return { ok: false, error: 'LRC files must be no larger than 5 MB.' };
    }
    return { ok: true, text: fs.readFileSync(filePath, 'utf8') };
  } catch (error) {
    console.error('Unable to read Karaoke LRC file', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('stat', async (_, pth: string) => {
  try { const s = fs.statSync(pth); return { ok: true, isFile: s.isFile(), isDirectory: s.isDirectory() }; } catch (err) { return { ok: false, error: String(err) }; }
});

// Read a file and return base64 + mime so renderer can create a blob URL (avoids file:// loading restrictions)
ipcMain.handle('read-file', async (_, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath);
    const b64 = data.toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.flac' ? 'audio/flac' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
    return { ok: true, data: b64, mime };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('read-mp3-tags', async (_, filePath: string) => {
  try {
    if (!filePath || path.extname(filePath).toLowerCase() !== '.mp3') {
      return { ok: false, error: 'Tag editing is currently available for MP3 files only.' };
    }
    const nodeId3 = require('node-id3');
    const tags = nodeId3.read(filePath);
    const frames = Array.isArray(tags?.synchronisedLyrics) ? tags.synchronisedLyrics : [];
    let sampleRate = 0;
    let samplesPerFrame = 0;
    if (frames.some((frame: any) => frame.timeStampFormat === 1)) {
      try {
        const mm = await importMusicMetadata();
        const metadata = await (mm as any).parseFile(filePath);
        sampleRate = Number(metadata?.format?.sampleRate);
        const codec = String(metadata?.format?.codec || '').toLowerCase();
        samplesPerFrame = codec.includes('layer 3')
          ? (codec.includes('mpeg 1') ? 1152 : 576)
          : codec.includes('layer 1') ? 384
            : codec.includes('layer 2') ? 1152 : 0;
      } catch (error) {
        console.warn('Unable to read MP3 format for synchronized lyrics', error);
      }
    }
    const synchronizedLyrics = frames
      .flatMap((frame: any) => (frame.synchronisedText || []).map((line: any) => {
        const time = frame.timeStampFormat === 2
          ? Number(line.timeStamp) / 1000
          : frame.timeStampFormat === 1 && sampleRate > 0 && samplesPerFrame > 0
            ? Number(line.timeStamp) * samplesPerFrame / sampleRate
            : Number.NaN;
        return Number.isFinite(time) ? { time, text: String(line.text || '') } : null;
      })).filter((line: { time: number; text: string } | null): line is { time: number; text: string } => line !== null);
    const lyrics = synchronizedLyrics.length
      ? synchronizedLyrics.sort((a: { time: number }, b: { time: number }) => a.time - b.time)
        .map((line: { time: number; text: string }) => {
          const totalCentiseconds = Math.max(0, Math.round(line.time * 100));
          const minutes = Math.floor(totalCentiseconds / 6000);
          const remainingCentiseconds = totalCentiseconds % 6000;
          const seconds = Math.floor(remainingCentiseconds / 100);
          const centiseconds = remainingCentiseconds % 100;
          return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]${line.text}`;
        }).join('\n')
      : String(tags?.unsynchronisedLyrics?.text || '');
    const imageBuffer = tags?.image?.imageBuffer;
    return {
      ok: true,
      title: tags?.title || '',
      artist: tags?.artist || '',
      album: tags?.album || '',
      year: tags?.year || '',
      track: tags?.trackNumber || '',
      albumArtist: tags?.performerInfo || '',
      lyricist: tags?.textWriter || '',
      composer: tags?.composer || '',
      lyrics,
      coverMime: tags?.image?.mime || '',
      coverBase64: Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : ''
    };
  } catch (error) {
    console.error('Unable to read MP3 tags', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('write-mp3-tags', async (_, filePath: string, draft: any) => {
  let backupPath = '';
  try {
    if (!filePath || path.extname(filePath).toLowerCase() !== '.mp3') {
      return { ok: false, error: 'Tag editing is currently available for MP3 files only.' };
    }
    if (!draft || typeof draft !== 'object') return { ok: false, error: 'Invalid tag data.' };
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { ok: false, error: 'The selected MP3 path is not a file.' };
    const textFields = ['title', 'artist', 'album', 'year', 'track', 'albumArtist', 'lyricist', 'composer'];
    for (const field of textFields) {
      if (String(draft[field] || '').length > 10000) return { ok: false, error: `${field} is too long.` };
    }
    const lyrics = String(draft.lyrics || '');
    if (lyrics.length > 5 * 1024 * 1024) return { ok: false, error: 'LRC text must be 5 MB or smaller.' };
    let coverBuffer: Buffer | null = null;
    const coverMime = String(draft.coverMime || '');
    if (!draft.removeCover && draft.coverBase64) {
      const coverBase64 = String(draft.coverBase64);
      if (!/^image\/(jpeg|png|gif|webp)$/i.test(coverMime)) {
        return { ok: false, error: 'Cover must be a JPEG, PNG, GIF or WebP image.' };
      }
      if (coverBase64.length > 28 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(coverBase64)) {
        return { ok: false, error: 'Invalid cover image data.' };
      }
      coverBuffer = Buffer.from(coverBase64, 'base64');
      if (!coverBuffer.length || coverBuffer.length > 20 * 1024 * 1024) {
        return { ok: false, error: 'Cover image must be between 1 byte and 20 MB.' };
      }
    }

    const timedLines: Array<{ time: number; text: string }> = [];
    for (const line of lyrics.split(/\r?\n/)) {
      let remaining = line.trim();
      const timestamps: number[] = [];
      let match: RegExpMatchArray | null;
      while ((match = remaining.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/))) {
        const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
        timestamps.push(Number(match[1]) * 60 + Number(match[2]) + fraction);
        remaining = remaining.slice(match[0].length);
      }
      for (const time of timestamps) timedLines.push({ time, text: remaining });
    }
    timedLines.sort((a, b) => a.time - b.time);

    const backupDirectory = path.join(app.getPath('userData'), 'mp3-tag-backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backupName = `${path.basename(filePath, path.extname(filePath))}.${Date.now()}.backup.mp3`;
    backupPath = path.join(backupDirectory, backupName);
    fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);

    const tagData: Record<string, any> = {
      title: String(draft.title || ''),
      artist: String(draft.artist || ''),
      album: String(draft.album || ''),
      year: String(draft.year || ''),
      trackNumber: String(draft.track || ''),
      performerInfo: String(draft.albumArtist || ''),
      textWriter: String(draft.lyricist || ''),
      composer: String(draft.composer || ''),
      unsynchronisedLyrics: { language: 'eng', text: lyrics },
      synchronisedLyrics: timedLines.length
        ? [{
          language: 'eng',
          timeStampFormat: 2,
          contentType: 1,
          shortText: '',
          synchronisedText: timedLines.map(line => ({
            text: line.text,
            timeStamp: Math.max(0, Math.round(line.time * 1000))
          }))
        }]
        : []
    };

    if (coverBuffer) {
      tagData.image = { mime: coverMime, type: { id: 3 }, description: 'Cover', imageBuffer: coverBuffer };
    }

    const nodeId3 = require('node-id3');
    const existingTags = nodeId3.read(filePath);
    const rawTags: Record<string, any> = { ...(existingTags?.raw || {}) };
    const replacedFrames = ['TIT2', 'TPE1', 'TALB', 'TYER', 'TRCK', 'TPE2', 'TEXT', 'TCOM', 'USLT', 'SYLT'];
    for (const frame of replacedFrames) delete rawTags[frame];
    if (draft.removeCover || coverBuffer) delete rawTags.APIC;
    const result = nodeId3.write({ ...rawTags, ...tagData }, filePath);
    if (result !== true) throw result instanceof Error ? result : new Error('ID3 tag writer did not confirm success.');

    const verified = nodeId3.read(filePath);
    const expectedFields: Record<string, string> = {
      title: tagData.title,
      artist: tagData.artist,
      album: tagData.album,
      year: tagData.year,
      trackNumber: tagData.trackNumber,
      performerInfo: tagData.performerInfo,
      textWriter: tagData.textWriter,
      composer: tagData.composer
    };
    for (const [field, expected] of Object.entries(expectedFields)) {
      if (String(verified?.[field] || '') !== expected) {
        throw new Error(`Tag verification failed for ${field}.`);
      }
    }
    const verifiedLyrics = typeof verified?.unsynchronisedLyrics === 'string'
      ? verified.unsynchronisedLyrics
      : String(verified?.unsynchronisedLyrics?.text || '');
    if (verifiedLyrics !== lyrics) throw new Error('LRC text verification failed.');
    const verifiedTimedLines = (verified?.synchronisedLyrics || [])
      .flatMap((frame: any) => (frame.synchronisedText || []).map((line: any) => ({
        text: String(line.text || ''),
        time: frame.timeStampFormat === 2 ? Number(line.timeStamp) / 1000 : Number.NaN
      })));
    if (verifiedTimedLines.length !== timedLines.length || timedLines.some((line, index) =>
      verifiedTimedLines[index]?.text !== line.text ||
      Math.abs(verifiedTimedLines[index]?.time - line.time) > 0.001
    )) {
      throw new Error('Synchronized lyrics verification failed.');
    }
    if (draft.removeCover && verified?.image) throw new Error('Cover removal verification failed.');
    if (!draft.removeCover && coverBuffer && !verified?.image?.imageBuffer?.equals(coverBuffer)) {
      throw new Error('Cover image verification failed.');
    }

    return { ok: true, backupPath };
  } catch (error) {
    let restoreError = '';
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.copyFileSync(backupPath, filePath); }
      catch (restoreFailure) { restoreError = ` Original-file restore also failed: ${String(restoreFailure)}`; }
    }
    console.error('Unable to write MP3 tags', error);
    return { ok: false, error: `${String(error)}${restoreError}`, backupPath };
  }
});

// Write a base64-encoded buffer to a temporary file and return the path
ipcMain.handle('write-temp-file', async (_, name: string, b64: string) => {
  try {
    const ext = path.extname(name) || '.mp3';
    const base = path.basename(name, ext).replace(/[^a-zA-Z0-9-_\.]/g, '_');
    const out = path.join(app.getPath('temp'), `${base}_upload_${Date.now()}${ext}`);
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    return { ok: true, path: out };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Get embedded lyrics (ID3 USLT/SYLT or common.lyrics)
ipcMain.handle('get-bitrate', async (_, filePath: string) => {
  try {
    if (!filePath) return { ok: false, error: 'no path' };
    const mm = await importMusicMetadata();
    const metadata = await (mm as any).parseFile(filePath);
    const bitrate = Number(metadata?.format?.bitrate);
    return { ok: true, bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null };
  } catch (error) {
    console.warn('Unable to read media bitrate', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('get-cover', async (_, filePath: string, thumbnail = true) => {
  try {
    if (!filePath) return { ok: false, error: 'no path' };
    const mm = await importMusicMetadata();
    const metadata = await mm.parseFile(filePath, { skipCovers: false });
    const picture = metadata.common.picture?.[0];
    if (!picture) return { ok: true, coverBase64: null };
    if (!thumbnail) {
      return {
        ok: true,
        coverBase64: Buffer.from(picture.data).toString('base64'),
        mime: picture.format || 'image/jpeg'
      };
    }

    const image = nativeImage.createFromBuffer(Buffer.from(picture.data));
    if (image.isEmpty()) return { ok: true, coverBase64: null };
    const { width, height } = image.getSize();
    if (width <= 0 || height <= 0) return { ok: true, coverBase64: null };
    const scale = Math.min(1, 256 / Math.max(width, height));
    const thumbnailImage = scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'good'
        })
      : image;
    const thumbnailData = thumbnailImage.toJPEG(92);
    return {
      ok: true,
      coverBase64: thumbnailData.toString('base64'),
      mime: 'image/jpeg'
    };
  } catch (error) {
    console.warn('Unable to read media cover', error);
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('get-lyrics', async (_, filePath: string) => {
  try {
    if (!filePath) return { ok: false, error: 'no path' };
    let id3Tags: any = null;
    try {
      id3Tags = require('node-id3').read(filePath);
    } catch (error) {
      console.warn('Unable to read ID3 lyrics tags', error);
    }

    let meta: any = null;
    try {
      const mm = await importMusicMetadata();
      meta = await (mm as any).parseFile(filePath, { native: true });
    } catch (error) {
      console.warn('Unable to read media metadata for lyrics', error);
    }

    const synchronizedFrames = Array.isArray(id3Tags?.synchronisedLyrics)
      ? id3Tags.synchronisedLyrics
      : [];
    for (const frame of synchronizedFrames) {
      const sampleRate = Number(meta?.format?.sampleRate);
      const codec = String(meta?.format?.codec || '').toLowerCase();
      const samplesPerFrame = codec.includes('layer 3')
        ? (codec.includes('mpeg 1') ? 1152 : 576)
        : codec.includes('layer 1')
          ? 384
          : codec.includes('layer 2')
            ? 1152
            : 0;
      const timed = (frame.synchronisedText || [])
        .filter((item: any) => item && typeof item.text === 'string' && Number.isFinite(item.timeStamp))
        .map((item: { text: string; timeStamp: number }) => {
          if (frame.timeStampFormat === 2) return { time: item.timeStamp / 1000, text: item.text };
          if (frame.timeStampFormat === 1 && sampleRate > 0 && samplesPerFrame > 0) {
            return { time: item.timeStamp * samplesPerFrame / sampleRate, text: item.text };
          }
          return null;
        })
        .filter((item: { time: number; text: string } | null): item is { time: number; text: string } => item !== null);
      if (timed.length) return { ok: true, type: 'sylt', lyrics: timed.map((item: { time: number; text: string }) => item.text).join('\n'), timed };
    }

    const commonLyrics = normalizeLyricsText(meta?.common?.lyrics);
    if (commonLyrics) return { ok: true, type: 'common', lyrics: commonLyrics, timed: null };

    const native = meta?.native || {};
    for (const frames of Object.values(native) as any[]) {
      if (!Array.isArray(frames)) continue;
      for (const frame of frames) {
        if (!frame || String(frame.id).toUpperCase() !== 'USLT') continue;
        const value = frame.value;
        const text = normalizeLyricsText(value);
        if (text) return { ok: true, type: 'unsync', lyrics: text, timed: null };
      }
    }

    if (id3Tags?.unsynchronisedLyrics) {
      const unsynchronizedLyrics = id3Tags.unsynchronisedLyrics;
      const text = normalizeLyricsText(unsynchronizedLyrics);
      if (text) return { ok: true, type: 'unsync', lyrics: text, timed: null };
    }

    return { ok: true, type: null, lyrics: null, timed: null };
  } catch (err) { return { ok: false, error: String(err) }; }
});

ipcMain.handle('search-metadata', async (_, query: string, searchHints?: ElectronMetadataSearchHints) => {
  try {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    if (!normalizedQuery) return { ok: false, error: 'Enter a song title or artist to search.' };
    if (normalizedQuery.length > 500) return { ok: false, error: 'Song information search query is too long.' };

    const hints = {
      title: typeof searchHints?.title === 'string' ? searchHints.title.trim() : normalizedQuery,
      artist: typeof searchHints?.artist === 'string' ? searchHints.artist.trim() : '',
      album: typeof searchHints?.album === 'string' ? searchHints.album.trim() : ''
    };
    const response = await searchOnlineMetadata(normalizedQuery, hints);
    if (!response.results.length && response.warnings.length) {
      throw new Error(response.warnings.join(' '));
    }
    response.warnings.forEach(warning => console.warn('Online metadata source unavailable:', warning));
    return { ok: true, ...response };
  } catch (error) {
    console.error('Unable to search online song information', error);
    return {
      ok: false,
      error: error instanceof Error ? `Unable to search online song information: ${error.message}` : `Unable to search online song information: ${String(error)}`
    };
  }
});

function isAllowedArtworkHost(hostname: string) {
  return /^is\d+-ssl\.mzstatic\.com$/i.test(hostname) ||
    hostname === 'i.discogs.com' ||
    hostname === 'img.discogs.com' ||
    hostname === 'coverartarchive.org' ||
    hostname.endsWith('.archive.org');
}

function downloadArtwork(
  url: URL,
  redirectsRemaining: number
): Promise<{ mime: string; data: Buffer }> {
  if (url.protocol !== 'https:' || !isAllowedArtworkHost(url.hostname)) {
    return Promise.reject(new Error('The artwork URL is not from an approved music catalog image host.'));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirectsRemaining <= 0) {
          reject(new Error('Artwork service returned an invalid redirect.'));
          return;
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, url);
        } catch (error) {
          reject(new Error(`Artwork service returned an invalid redirect URL: ${String(error)}`));
          return;
        }
        resolve(downloadArtwork(nextUrl, redirectsRemaining - 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Artwork service returned HTTP ${response.statusCode || 'error'}.`));
        return;
      }
      const mime = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) {
        response.resume();
        reject(new Error('Artwork service returned an unsupported image format.'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          request.destroy(new Error('Artwork image exceeded 8 MB.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ mime, data: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.setTimeout(12000, () => request.destroy(new Error('Artwork download timed out.')));
    request.on('error', reject);
  });
}

ipcMain.handle('download-online-artwork', async (_, artworkUrl: string) => {
  try {
    const result = await downloadArtwork(new URL(typeof artworkUrl === 'string' ? artworkUrl : ''), 3);
    return { ok: true, mime: result.mime, base64: result.data.toString('base64') };
  } catch (error) {
    console.error('Unable to download online artwork', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

type SyncedLyricsPythonCandidate = { command: string; args: string[] };

const syncedLyricsPythonScript = String.raw`
import json
import logging
import re
import sys

try:
    import syncedlyrics
except ModuleNotFoundError:
    print("MINTPLAYER_SYNCEDLYRICS_MISSING", file=sys.stderr)
    sys.exit(3)

class ProviderCapture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.provider = ""

    def emit(self, record):
        match = re.search(r'Lyrics found for .* on (.+)$', record.getMessage())
        if match:
            self.provider = match.group(1)

capture = ProviderCapture()
logger = logging.getLogger("syncedlyrics")
logger.addHandler(capture)
logger.setLevel(logging.INFO)
search_term = sys.argv[1]
lyrics = syncedlyrics.search(
    search_term,
    synced_only=True,
    providers=["Musixmatch", "NetEase", "Megalobiz"],
    enhanced=True,
)
print(json.dumps({
    "lyrics": lyrics,
    "provider": capture.provider,
}, ensure_ascii=False))
`;

function getSyncedLyricsPythonCandidates(): SyncedLyricsPythonCandidate[] {
  const candidates: SyncedLyricsPythonCandidate[] = [];
  const seen = new Set<string>();
  const add = (command: string, args: string[] = []) => {
    const key = `${command}\0${args.join('\0')}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ command, args });
  };
  const localPythonPaths = [
    path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
    path.join(app.getAppPath(), '.venv', 'Scripts', 'python.exe')
  ];
  for (const pythonPath of localPythonPaths) {
    if (fs.existsSync(pythonPath)) add(pythonPath);
  }
  if (process.env.MINTPLAYER_PYTHON?.trim()) add(process.env.MINTPLAYER_PYTHON.trim());
  if (process.platform === 'win32') add('py', ['-3']);
  add('python');
  add('python3');
  return candidates;
}

async function runSyncedLyricsFallback(query: string): Promise<{ lyrics: string | null; provider: string; error?: string }> {
  const candidates = getSyncedLyricsPythonCandidates();
  let packageMissing = false;
  let lastError = '';

  for (const candidate of candidates) {
    try {
      const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(candidate.command, [...candidate.args, '-c', syncedLyricsPythonScript, query], {
          shell: false,
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
          child.kill();
          if (!settled) {
            settled = true;
            reject(new Error('syncedlyrics search timed out.'));
          }
        }, 60000);
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
          if (stdout.length > 5 * 1024 * 1024) child.kill();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
          if (stderr.length > 256 * 1024) stderr = stderr.slice(-256 * 1024);
        });
        child.on('error', error => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          reject(error);
        });
        child.on('close', code => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          resolve({ code, stdout, stderr });
        });
      });

      if (output.stderr.includes('MINTPLAYER_SYNCEDLYRICS_MISSING')) {
        packageMissing = true;
        continue;
      }
      if (output.code !== 0) {
        lastError = output.stderr.trim() || `Python lyrics provider exited with code ${output.code}.`;
        continue;
      }
      const result = JSON.parse(output.stdout.trim()) as { lyrics?: unknown; provider?: unknown };
      const lyrics = typeof result.lyrics === 'string' ? result.lyrics.trim() : '';
      return {
        lyrics: lyrics || null,
        provider: typeof result.provider === 'string' ? result.provider : ''
      };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code === 'ENOENT') continue;
      lastError = failure.message || String(error);
    }
  }

  if (packageMissing) {
    return {
      lyrics: null,
      provider: '',
      error: 'The syncedlyrics backup is not installed. Install it with "python -m pip install syncedlyrics" and restart MintPlayer.'
    };
  }
  return {
    lyrics: null,
    provider: '',
    error: lastError || 'No Python 3 interpreter was found for the syncedlyrics backup.'
  };
}

function makeSyncedLyricsFallbackResult(query: string, lyrics: string, provider: string) {
  return {
    ok: true,
    fallbackUsed: true,
    results: [{
      id: 0,
      trackName: query,
      artistName: '',
      albumName: '',
      duration: null,
      plainLyrics: '',
      syncedLyrics: lyrics,
      source: provider ? `syncedlyrics · ${provider}` : 'syncedlyrics'
    }]
  };
}

function makePlainLyricsFallbackResult(result: ElectronOnlineLyricsResult) {
  return {
    ok: true,
    fallbackUsed: true,
    results: [result]
  };
}

ipcMain.handle('search-lyrics', async (_, query: string, fallbackQuery?: string, artistQuery?: string) => {
  try {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const normalizedFallbackQuery = typeof fallbackQuery === 'string' && fallbackQuery.trim()
      ? fallbackQuery.trim()
      : normalizedQuery;
    const normalizedArtistQuery = typeof artistQuery === 'string' ? artistQuery.trim() : '';
    if (!normalizedQuery) return { ok: false, error: 'Enter a song title or artist to search.' };
    if (normalizedQuery.length > 500) return { ok: false, error: 'Lyrics search query is too long.' };
    if (normalizedFallbackQuery.length > 500) return { ok: false, error: 'Lyrics backup search query is too long.' };

    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(normalizedQuery)}`;
    const maxAttempts = 3;
    const maxAutomaticWaitMs = 30000;
    const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
    const transientNetworkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT']);
    let responseData = '';
    let lastFailure: { statusCode?: number; retryAfter?: string; code?: string; message: string } | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        responseData = await new Promise<string>((resolve, reject) => {
          const request = https.get(url, {
            headers: { 'User-Agent': 'MintPlayer/0.1.0 (desktop lyrics lookup)' }
          }, response => {
            if (response.statusCode !== 200) {
              response.resume();
              reject(Object.assign(
                new Error(`HTTP ${response.statusCode || 'error'}`),
                { statusCode: response.statusCode, retryAfter: response.headers['retry-after'] }
              ));
              return;
            }
            let data = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
              data += chunk;
              if (data.length > 5 * 1024 * 1024) {
                request.destroy(new Error('Lyrics search response exceeded 5 MB.'));
              }
            });
            response.on('end', () => resolve(data));
            response.on('error', reject);
          });
          request.setTimeout(12000, () => {
            request.destroy(Object.assign(new Error('Lyrics search timed out.'), { code: 'ETIMEDOUT' }));
          });
          request.on('error', reject);
        });
        lastFailure = null;
        break;
      } catch (error) {
        const failure = error as { statusCode?: number; retryAfter?: string; code?: string; message?: string };
        lastFailure = {
          statusCode: failure.statusCode,
          retryAfter: failure.retryAfter,
          code: failure.code,
          message: failure.message || 'Unknown network error'
        };
        const retryable = (failure.statusCode !== undefined && transientStatuses.has(failure.statusCode))
          || (failure.statusCode === undefined && !!failure.code && transientNetworkCodes.has(failure.code));
        if (!retryable || attempt === maxAttempts) break;

        let retryAfterMs: number | null = null;
        if (failure.retryAfter) {
          const seconds = Number(failure.retryAfter);
          const date = Date.parse(failure.retryAfter);
          if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1000);
          else if (Number.isFinite(date)) retryAfterMs = Math.max(0, date - Date.now());
        }
        if (retryAfterMs !== null && retryAfterMs > maxAutomaticWaitMs) break;

        const backoffMs = retryAfterMs ?? (700 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 300));
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    if (lastFailure) {
      const statusCode = lastFailure.statusCode;
      const transient = (statusCode !== undefined && transientStatuses.has(statusCode))
        || (statusCode === undefined && !!lastFailure.code && transientNetworkCodes.has(lastFailure.code));
      let error = statusCode
        ? `Lyrics service returned HTTP ${statusCode}.`
        : 'Unable to reach the lyrics service.';
      if (transient && lastFailure.retryAfter) {
        const retryAfterMs = Number(lastFailure.retryAfter) * 1000;
        if (Number.isFinite(retryAfterMs) && retryAfterMs > maxAutomaticWaitMs) {
          error = `Lyrics service is busy. Please try again in about ${Math.ceil(retryAfterMs / 1000)} seconds.`;
        } else {
          const retryAfterDate = Date.parse(lastFailure.retryAfter);
          if (Number.isFinite(retryAfterDate) && retryAfterDate - Date.now() > maxAutomaticWaitMs) {
            error = 'Lyrics service is busy. Please try again later.';
          } else {
            error = 'Lyrics service is temporarily unavailable after several attempts. Please try again.';
          }
        }
      } else if (transient) {
        error = 'Lyrics service is temporarily unavailable after several attempts. Please try again.';
      }
      const onlineFallback = await searchLyricsOvh(
        normalizedFallbackQuery,
        normalizedArtistQuery,
        normalizedQuery
      );
      if (onlineFallback.result) {
        console.info('LRCLIB unavailable; plain lyrics found with Lyrics.ovh.');
        return makePlainLyricsFallbackResult(onlineFallback.result);
      }
      const fallback = await runSyncedLyricsFallback(normalizedFallbackQuery);
      if (fallback.lyrics) {
        console.info(`LRCLIB unavailable; synchronized lyrics found with syncedlyrics${fallback.provider ? ` (${fallback.provider})` : ''}.`);
        return makeSyncedLyricsFallbackResult(normalizedFallbackQuery, fallback.lyrics, fallback.provider);
      }
      const fallbackError = [
        onlineFallback.error ? `Lyrics.ovh backup unavailable: ${onlineFallback.error}` : '',
        fallback.error
          ? `syncedlyrics backup unavailable: ${fallback.error}`
          : 'syncedlyrics backup did not find synchronized lyrics.'
      ].filter(Boolean).join(' ');
      return { ok: false, error: `${error}${fallbackError}`, retryable: transient };
    }

    const results = JSON.parse(responseData);
    if (!Array.isArray(results)) throw new Error('LRCLIB returned an invalid search response.');
    const lyricResults = results.slice(0, 20).map(result => ({
      id: Number(result.id),
      trackName: String(result.trackName || result.name || ''),
      artistName: String(result.artistName || ''),
      albumName: String(result.albumName || ''),
      duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
      plainLyrics: typeof result.plainLyrics === 'string' ? result.plainLyrics.slice(0, 5 * 1024 * 1024) : '',
      syncedLyrics: typeof result.syncedLyrics === 'string' ? result.syncedLyrics.slice(0, 5 * 1024 * 1024) : '',
      source: 'LRCLIB'
    })).filter(result => result.trackName && (result.plainLyrics || result.syncedLyrics));
    if (lyricResults.some(result => result.syncedLyrics.trim())) {
      return { ok: true, results: lyricResults };
    }

    const onlineFallback = await searchLyricsOvh(
      normalizedFallbackQuery,
      normalizedArtistQuery,
      normalizedQuery
    );
    if (onlineFallback.result) {
      return {
        ok: true,
        fallbackUsed: true,
        results: [...lyricResults, onlineFallback.result]
      };
    }

    const fallback = await runSyncedLyricsFallback(normalizedFallbackQuery);
    if (fallback.lyrics) {
      console.info(`No LRCLIB lyrics found; synchronized lyrics found with syncedlyrics${fallback.provider ? ` (${fallback.provider})` : ''}.`);
      const fallbackResult = makeSyncedLyricsFallbackResult(normalizedFallbackQuery, fallback.lyrics, fallback.provider);
      return {
        ...fallbackResult,
        results: [...lyricResults, ...fallbackResult.results]
      };
    }
    if (lyricResults.length) {
      return {
        ok: true,
        results: lyricResults,
        fallbackError: [
          onlineFallback.error ? `Lyrics.ovh unavailable: ${onlineFallback.error}` : '',
          fallback.error || 'No synchronized lyrics were found using syncedlyrics.'
        ].filter(Boolean).join(' ')
      };
    }
    return {
      ok: false,
      error: fallback.error
        ? `No lyrics found on LRCLIB or Lyrics.ovh${onlineFallback.error ? ` (${onlineFallback.error})` : ''}. syncedlyrics backup unavailable: ${fallback.error}`
        : onlineFallback.error
          ? `No lyrics found on LRCLIB or Lyrics.ovh (${onlineFallback.error}).`
          : 'No lyrics found on LRCLIB or the syncedlyrics backup.',
      retryable: false
    };
  } catch (error) {
    console.error('Unable to search online lyrics', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: false };
  }
});

ipcMain.handle('generate-backing', async (_, filePath: string) => {
  try {
    if (!filePath || !/\.(mp3|flac|wav)$/i.test(filePath)) {
      return { ok: false, error: 'Vocal Splitter supports MP3, FLAC, and WAV files.' };
    }
    if (!fs.statSync(filePath).isFile()) return { ok: false, error: 'The selected audio path is not a file.' };
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const destMp3 = path.join(dir, `${base}_backingtrack.mp3`);
    const destWav = path.join(dir, `${base}_backingtrack.wav`);
    if (fs.existsSync(destMp3)) return { ok: true, path: destMp3 };
    if (fs.existsSync(destWav)) return { ok: true, path: destWav };
    const outdir = path.join(dir, `${base}_stems`);
    if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });
    const { spawn } = require('child_process');
    // Try spleeter first
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn('spleeter', ['separate', '-i', filePath, '-p', 'spleeter:2stems', '-o', outdir], { shell: false });
        proc.on('close', (code: number) => code === 0 ? resolve(null) : reject(new Error('spleeter exit ' + code)));
        proc.on('error', (err: any) => reject(err));
      });
      const acc = path.join(outdir, base, 'accompaniment.wav');
      if (fs.existsSync(acc)) {
        fs.copyFileSync(acc, destWav);
        return { ok: true, path: destWav };
      }
    } catch (sErr) {
      // spleeter failed or not available; fall through to demucs
      console.warn('spleeter failed or not available', sErr);
    }
    // Try demucs as fallback (prefer absolute path to environment-installed demucs)
    try {
      const demucsCandidates = [
        path.join(process.env['USERPROFILE'] || 'C:\\Users\\IvanLIU', 'Miniconda3', 'envs', 'backing', 'Scripts', 'demucs.exe'),
        'demucs'
      ];

      // Use a project-local temp output so all demucs runs land in one place for inspection
      const projectRoot = path.resolve(__dirname, '..', '..');
      const canonicalTempBase = path.join(projectRoot, 'temp_demucs_out');
      if (!fs.existsSync(canonicalTempBase)) fs.mkdirSync(canonicalTempBase, { recursive: true });
      const canonicalTemp = canonicalTempBase;
      // clear previous canonical temp contents so we reuse a fixed temp folder
      try {
        const ents = fs.readdirSync(canonicalTempBase);
        for (const e of ents) {
          const full = path.join(canonicalTempBase, e);
          try {
            if (fs.lstatSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
            else fs.unlinkSync(full);
          } catch (error) {
            throw new Error(`Unable to remove stale backing-track output ${full}: ${String(error)}`);
          }
        }
      } catch (error) {
        console.error('Unable to clear previous backing-track output', error);
        throw error;
      }

      // Try each candidate; treat a candidate as success if it produces expected output files even when exit code is non-zero
      for (const cmd of demucsCandidates) {
        try {
          // spawn and collect stdout/stderr
          const exitCode: number = await new Promise<number>((resolve) => {
            try {
              const tempOut = canonicalTempBase;
              if (!fs.existsSync(tempOut)) fs.mkdirSync(tempOut, { recursive: true });
              const pLog = path.join(app.getPath('temp'), 'player-ui.log');
              fs.appendFileSync(pLog, `${new Date().toISOString()} demucs start: cmd=${cmd} out=${tempOut} file=${filePath}\n`, 'utf8');

              const proc = spawn(cmd, ['--two-stems', 'vocals', '-o', tempOut, filePath], { shell: false, env: { ...process.env } });
              let stdout = '';
              let stderr = '';
              if (proc.stdout) proc.stdout.on('data', (d: any) => { stdout += String(d); });
              if (proc.stderr) proc.stderr.on('data', (d: any) => { stderr += String(d); });
              proc.on('close', (code: number) => {
                try { fs.appendFileSync(pLog, `${new Date().toISOString()} demucs ${cmd} exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`, 'utf8'); }
                catch (error) { console.warn('Unable to write demucs process log', error); }
                resolve(typeof code === 'number' ? code : -1);
              });
              proc.on('error', (err: any) => {
                try { fs.appendFileSync(pLog, `${new Date().toISOString()} demucs ${cmd} error ${String(err)}\n`, 'utf8'); }
                catch (error) { console.warn('Unable to write demucs process error log', error); }
                resolve(-1);
              });
            } catch (e) {
              try {
                const p = path.join(app.getPath('temp'), 'player-ui.log');
                fs.appendFileSync(p, `${new Date().toISOString()} demucs spawn threw ${String(e)}\n`, 'utf8');
              } catch (logError) { console.warn('Unable to write demucs spawn error log', logError); }
              resolve(-1);
            }
          });

          // Regardless of exit code, search canonicalTemp recursively for no_vocals.wav and convert to mp3
          const pLog2 = path.join(app.getPath('temp'), 'player-ui.log');
          try {
            // helper to find all no_vocals under a dir
            function findNoVocals(dir: string): string[] {
              let out: string[] = [];
              try {
                const ents = fs.readdirSync(dir, { withFileTypes: true });
                for (const e of ents) {
                  const full = path.join(dir, e.name);
                  if (e.isDirectory()) out = out.concat(findNoVocals(full));
                  else if (e.isFile() && e.name === 'no_vocals.wav') out.push(full);
                }
              } catch (error) {
                console.warn(`Unable to inspect backing-track output directory ${dir}`, error);
              }
              return out;
            }

            const foundFiles = findNoVocals(canonicalTemp);
            if (foundFiles.length) {
              // pick the most recently modified one
              foundFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
              const found = foundFiles[0];

              // convert to mp3 using ffmpeg if available
              const tempMp3 = path.join(canonicalTemp, 'no_vocals.mp3');
              try {
                const convExit: number = await new Promise<number>((resolve) => {
                  const p = spawn('ffmpeg', ['-y', '-i', found, tempMp3], { shell: false });
                  p.on('close', (c: number) => resolve(typeof c === 'number' ? c : -1));
                  p.on('error', () => resolve(-1));
                });
                if (convExit === 0 && fs.existsSync(tempMp3)) {
                  fs.copyFileSync(tempMp3, destMp3);
                  fs.appendFileSync(pLog2, `${new Date().toISOString()} converted ${found} -> ${tempMp3} and copied to ${destMp3}\n`, 'utf8');
                  return { ok: true, path: destMp3 };
                }
              } catch (e) { fs.appendFileSync(pLog2, `${new Date().toISOString()} ffmpeg convert error ${String(e)}\n`, 'utf8'); }

              // fallback: copy wav as backing wav
              try {
                fs.copyFileSync(found, destWav);
                fs.appendFileSync(pLog2, `${new Date().toISOString()} copied ${found} -> ${destWav} (wav fallback)\n`, 'utf8');
                return { ok: true, path: destWav };
              } catch (copyErr) {
                fs.appendFileSync(pLog2, `${new Date().toISOString()} copy failed ${String(copyErr)}\n`, 'utf8');
                return { ok: false, error: 'copy_failed: ' + String(copyErr) };
              }
            }

            fs.appendFileSync(pLog2, `${new Date().toISOString()} demucs candidate produced no accompaniment ${cmd} exit=${exitCode}\n`, 'utf8');
          } catch(e) {
            fs.appendFileSync(pLog2, `${new Date().toISOString()} demucs post-scan error ${String(e)}\n`, 'utf8');
          }
        } catch (e) {
          fs.appendFileSync(path.join(app.getPath('temp'), 'player-ui.log'), `${new Date().toISOString()} demucs candidate failed ${cmd} ${String(e)}\n`, 'utf8');
        }
      }
    } catch (dErr) {
      fs.appendFileSync(path.join(app.getPath('temp'), 'player-ui.log'), `${new Date().toISOString()} demucs failed or not available ${String(dErr)}\n`, 'utf8');
    }
    return { ok: false, error: 'no accompaniment produced' };
  } catch (err) { return { ok: false, error: String(err) }; }
});

ipcMain.handle('append-log', async (_, msg: string) => {
  try {
    const p = path.join(app.getPath('temp'), 'player-ui.log');
    fs.appendFileSync(p, `${new Date().toISOString()} ${String(msg)}\n`, 'utf8');
    return { ok: true, path: p };
  } catch (err) { return { ok: false, error: String(err) }; }
});

// Overwrite the entire playlists file with the provided array
ipcMain.handle('write-playlists', async (_, playlists: any[]) => {
  try {
    const p = path.join(app.getPath('userData'), 'playlists.json');
    fs.writeFileSync(p, JSON.stringify(playlists || [], null, 2), 'utf8');
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => torrentDownloadManager.dispose());
