import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ElectronAPI,
  ElectronApiResult,
  ElectronKaraokeAlignmentProgress,
  ElectronKaraokeSubtitleLine,
  ElectronPlaylistRecord,
  ElectronTorrentDownloadProgress,
  ElectronTorrentSource,
  ElectronTimedLyric,
  ElectronTrackRecord,
  ElectronVideoDownloadProgress,
  ElectronVideoSearchResult
} from './electronApi';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function hasStrings(value: Record<string, unknown>, fields: string[]) {
  return fields.every(field => typeof value[field] === 'string');
}

function isTrackRecord(value: unknown): value is ElectronTrackRecord {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    ['path', 'src', 'cover', 'resolution'].every(field =>
      value[field] === undefined || typeof value[field] === 'string') &&
    (value.bitrate === undefined || (typeof value.bitrate === 'number' && Number.isFinite(value.bitrate)));
}

function isPlaylistRecord(value: unknown): value is ElectronPlaylistRecord {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.tracks) &&
    value.tracks.every(isTrackRecord);
}

function isTimedLyrics(value: unknown): boolean {
  return value === null ||
    (Array.isArray(value) && value.every(item =>
      isRecord(item) && typeof item.time === 'number' && Number.isFinite(item.time) && typeof item.text === 'string'));
}

function isKaraokeSubtitleLines(value: unknown): value is ElectronKaraokeSubtitleLine[] {
  return Array.isArray(value) && value.every(line =>
    isRecord(line) &&
    typeof line.start === 'number' && Number.isFinite(line.start) &&
    typeof line.end === 'number' && Number.isFinite(line.end) &&
    typeof line.text === 'string' &&
    Array.isArray(line.characters) &&
    line.characters.every(character =>
      isRecord(character) &&
      typeof character.text === 'string' &&
      typeof character.start === 'number' && Number.isFinite(character.start) &&
      typeof character.end === 'number' && Number.isFinite(character.end)));
}

function isLyricsSearchResults(value: unknown): boolean {
  return Array.isArray(value) && value.every(item =>
    isRecord(item) &&
    typeof item.id === 'number' && Number.isFinite(item.id) &&
    hasStrings(item, ['trackName', 'artistName', 'albumName', 'plainLyrics', 'syncedLyrics']) &&
    (item.duration === null || (typeof item.duration === 'number' && Number.isFinite(item.duration))) &&
    (item.source === undefined || typeof item.source === 'string'));
}

function isMetadataSearchResults(value: unknown): boolean {
  const countries = ['TW', 'HK', 'US', 'JP', 'GB', 'CA', 'AU', 'SG'];
  return Array.isArray(value) && value.every(item =>
    isRecord(item) &&
    ((typeof item.id === 'number' && Number.isFinite(item.id)) || typeof item.id === 'string') &&
    hasStrings(item, ['trackName', 'artistName', 'albumName', 'year', 'trackNumber', 'albumArtist', 'artworkUrl']) &&
    (item.duration === null || (typeof item.duration === 'number' && Number.isFinite(item.duration))) &&
    (item.composer === undefined || typeof item.composer === 'string') &&
    (item.lyricist === undefined || typeof item.lyricist === 'string') &&
    (item.country === undefined || countries.includes(String(item.country))) &&
    (item.fieldSources === undefined || (
      isRecord(item.fieldSources) &&
      Object.values(item.fieldSources).every(source =>
        source === 'Apple Music/iTunes' || source === 'Discogs' || source === 'MusicBrainz')
    )));
}

function isVideoFormat(value: unknown): boolean {
  return isRecord(value) &&
    hasStrings(value, ['formatId', 'extension', 'resolution', 'note', 'videoCodec', 'audioCodec']) &&
    ['audioBitrate', 'sampleRate', 'audioChannels', 'duration'].every(field =>
      value[field] === undefined || value[field] === null ||
      (typeof value[field] === 'number' && Number.isFinite(value[field]))) &&
    (value.fileSize === null || (typeof value.fileSize === 'number' && Number.isFinite(value.fileSize))) &&
    typeof value.hasVideo === 'boolean' &&
    typeof value.hasAudio === 'boolean';
}

function isVideoInfo(value: Record<string, unknown>) {
  return hasStrings(value, ['title']) &&
    (value.thumbnailUrl === undefined || value.thumbnailUrl === null || typeof value.thumbnailUrl === 'string') &&
    Array.isArray(value.formats) && value.formats.every(isVideoFormat);
}

function isVideoPlaylistInfo(value: Record<string, unknown>) {
  return hasStrings(value, ['title']) &&
    (value.thumbnailUrl === undefined || value.thumbnailUrl === null || typeof value.thumbnailUrl === 'string') &&
    Array.isArray(value.entries) && value.entries.every(entry =>
      isRecord(entry) &&
      typeof entry.index === 'number' && Number.isInteger(entry.index) && entry.index > 0 &&
      hasStrings(entry, ['id', 'url', 'title']) &&
      (entry.thumbnailUrl === undefined || entry.thumbnailUrl === null || typeof entry.thumbnailUrl === 'string') &&
      typeof entry.formatsLoaded === 'boolean' &&
      Array.isArray(entry.formats) && entry.formats.every(isVideoFormat) &&
      (entry.unavailableReason === undefined || typeof entry.unavailableReason === 'string'));
}

function isVideoSearchResult(value: unknown): value is ElectronVideoSearchResult {
  return isRecord(value) &&
    hasStrings(value, ['id', 'url', 'title']) &&
    (value.thumbnailUrl === null || typeof value.thumbnailUrl === 'string');
}

function isVideoSearchResponse(value: Record<string, unknown>) {
  const errors = value.errors;
  const validErrors = errors === undefined || (
    isRecord(errors) &&
    ['youtube', 'bilibili'].every(platform =>
      errors[platform] === undefined || typeof errors[platform] === 'string')
  );
  return Array.isArray(value.youtube) && value.youtube.every(isVideoSearchResult) &&
    Array.isArray(value.bilibili) && value.bilibili.every(isVideoSearchResult) &&
    validErrors;
}

function isVideoDownloadProgress(value: unknown): value is ElectronVideoDownloadProgress {
  return isRecord(value) &&
    typeof value.title === 'string' &&
    (value.percent === null ||
      (typeof value.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100));
}

function isTorrentDownloadProgress(value: unknown): value is ElectronTorrentDownloadProgress {
  const statuses = ['starting', 'downloading', 'seeding', 'completed', 'stopped', 'error'];
  return isRecord(value) &&
    typeof value.jobId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.status === 'string' && statuses.includes(value.status) &&
    (value.progress === null ||
      (typeof value.progress === 'number' && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 100)) &&
    ['downloadedBytes', 'totalBytes', 'downloadSpeed', 'uploadSpeed', 'peers'].every(field =>
      typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] >= 0) &&
    typeof value.outputDirectory === 'string' &&
    (value.error === undefined || typeof value.error === 'string');
}

// Sandboxed Electron preloads cannot require local modules, so keep their response parsers here.
function parseElectronApiResult<T extends object>(
  value: unknown,
  channel: string,
  hasValidSuccessPayload: (value: Record<string, unknown>) => boolean
): ElectronApiResult<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error(`Electron API "${channel}" returned an invalid response envelope.`);
  }

  if (value.ok === false) {
    if (typeof value.error !== 'string') {
      throw new Error(`Electron API "${channel}" returned an invalid error response.`);
    }
    return {
      ok: false,
      error: value.error,
      ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {})
    };
  }

  if (value.error !== undefined || !hasValidSuccessPayload(value)) {
    throw new Error(`Electron API "${channel}" returned an invalid success response.`);
  }
  return value as ElectronApiResult<T>;
}

function parseChoosePathsResult(
  value: unknown,
  channel: string
): Awaited<ReturnType<ElectronAPI['chooseFiles']>> {
  if (
    !isRecord(value) ||
    typeof value.canceled !== 'boolean' ||
    (value.paths !== undefined && !isStringArray(value.paths)) ||
    (value.error !== undefined && typeof value.error !== 'string') ||
    (value.canceled === false && (!isStringArray(value.paths) || value.error !== undefined))
  ) {
    throw new Error(`Electron API "${channel}" returned an invalid response.`);
  }
  return value as Awaited<ReturnType<ElectronAPI['chooseFiles']>>;
}

function parseChooseFilesResult(value: unknown): Awaited<ReturnType<ElectronAPI['chooseFiles']>> {
  return parseChoosePathsResult(value, 'choose-files');
}

function parseChooseFolderResult(value: unknown): Awaited<ReturnType<ElectronAPI['chooseFolder']>> {
  return parseChoosePathsResult(value, 'choose-folder');
}

function parseChooseFolderFilesResult(
  value: unknown
): Awaited<ReturnType<ElectronAPI['chooseFolderFiles']>> {
  return parseChoosePathsResult(value, 'choose-folder-files');
}

function invokeApiResult<T extends object>(
  channel: string,
  isValidPayload: (value: Record<string, unknown>) => boolean,
  ...args: unknown[]
): Promise<ElectronApiResult<T>> {
  return ipcRenderer.invoke(channel, ...args).then(value =>
    parseElectronApiResult<T>(value, channel, isValidPayload));
}

const electronAPI: ElectronAPI = {
  getPathForFile: file => webUtils.getPathForFile(file),
  loadMediaLibraryPath: () => invokeApiResult('load-media-library-path', value =>
    value.path === null || typeof value.path === 'string'),
  saveMediaLibraryPath: mediaLibraryPath => invokeApiResult('save-media-library-path', () => true, mediaLibraryPath),
  savePlaylist: (name, tracks) => invokeApiResult('save-playlist', value => typeof value.path === 'string', name, tracks),
  loadPlaylists: () => invokeApiResult('load-playlists', value =>
    Array.isArray(value.playlists) && value.playlists.every(isPlaylistRecord)),
  readdirRecursive: p => invokeApiResult('readdir-recursive', value =>
    Array.isArray(value.files) && value.files.every(file => typeof file === 'string'), p),
  scanAudioFiles: (p, recursive) => invokeApiResult('scan-audio-files', value =>
    Array.isArray(value.files) && value.files.every(file => typeof file === 'string'), p, recursive),
  splitAudioStems: (p, outputRoot) => invokeApiResult('split-audio-stems', value =>
    typeof value.vocalsPath === 'string' && typeof value.accompanimentPath === 'string', p, outputRoot),
  alignKaraokeSource: (mediaPath, vocalsPath, lyrics, outputRoot, timedLyrics) => invokeApiResult('align-karaoke-source', value =>
    typeof value.outputPath === 'string', mediaPath, vocalsPath, lyrics, outputRoot, timedLyrics),
  readKaraokeSubtitle: p => invokeApiResult('read-karaoke-subtitle', value =>
    isKaraokeSubtitleLines(value.lines), p),
  findKaraokeSubtitle: (videoPath, mediaLibraryPath) => invokeApiResult('find-karaoke-subtitle', value =>
    value.path === null || typeof value.path === 'string', videoPath, mediaLibraryPath),
  chooseKaraokeSubtitle: () => ipcRenderer.invoke('choose-karaoke-subtitle').then(parseChooseFilesResult),
  chooseKaraokeSubtitleSavePath: defaultPath => invokeApiResult('choose-karaoke-subtitle-save-path', value =>
    value.path === null || typeof value.path === 'string', defaultPath),
  saveKaraokeSubtitle: (filePath, lines, sourcePath) => sourcePath
    ? invokeApiResult('save-karaoke-subtitle', () => true, filePath, lines, sourcePath)
    : invokeApiResult('save-karaoke-subtitle', () => true, filePath, lines),
  chooseKaraokeSource: () => ipcRenderer.invoke('choose-karaoke-source').then(parseChooseFilesResult),
  chooseKaraokeVideo: () => ipcRenderer.invoke('choose-karaoke-video').then(parseChooseFilesResult),
  chooseKaraokeLrc: () => ipcRenderer.invoke('choose-karaoke-lrc').then(parseChooseFilesResult),
  readKaraokeLrc: p => invokeApiResult('read-karaoke-lrc', value =>
    typeof value.text === 'string', p),
  onKaraokeAlignmentProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isRecord(value) && typeof value.message === 'string') {
        listener(value as ElectronKaraokeAlignmentProgress);
      }
    };
    ipcRenderer.on('karaoke-alignment-progress', handler);
    return () => ipcRenderer.removeListener('karaoke-alignment-progress', handler);
  },
  stat: p => invokeApiResult('stat', value =>
    typeof value.isFile === 'boolean' && typeof value.isDirectory === 'boolean', p),
  chooseFiles: () => ipcRenderer.invoke('choose-files').then(parseChooseFilesResult),
  chooseFolder: () => ipcRenderer.invoke('choose-folder').then(parseChooseFolderResult),
  chooseFolderFiles: () => ipcRenderer.invoke('choose-folder-files').then(parseChooseFolderFilesResult),
  appendLog: msg => invokeApiResult('append-log', value => typeof value.path === 'string', msg),
  readFile: p => invokeApiResult('read-file', value =>
    typeof value.data === 'string' && typeof value.mime === 'string', p),
  getBitrate: p => invokeApiResult('get-bitrate', value =>
    value.bitrate === null || (typeof value.bitrate === 'number' && Number.isFinite(value.bitrate)), p),
  getCover: (p, thumbnail) => invokeApiResult('get-cover', value =>
    (value.coverBase64 === null || typeof value.coverBase64 === 'string') &&
    (value.mime === undefined || typeof value.mime === 'string'), p, thumbnail),
  readMp3Tags: p => invokeApiResult('read-mp3-tags', value =>
    hasStrings(value, ['title', 'artist', 'album', 'year', 'track', 'albumArtist', 'lyricist', 'composer', 'lyrics', 'coverMime', 'coverBase64']), p),
  writeMp3Tags: (p, tags) => invokeApiResult('write-mp3-tags', value =>
    typeof value.backupPath === 'string', p, tags),
  searchLyrics: (query, fallbackQuery, artistQuery) => invokeApiResult('search-lyrics', value =>
    isLyricsSearchResults(value.results) &&
    (value.fallbackUsed === undefined || typeof value.fallbackUsed === 'boolean') &&
    (value.fallbackError === undefined || typeof value.fallbackError === 'string'), query, fallbackQuery, artistQuery),
  searchMetadata: (query, hints) => invokeApiResult('search-metadata', value =>
    isMetadataSearchResults(value.results) &&
    (value.warnings === undefined || isStringArray(value.warnings)), query, hints),
  searchVideoPlatforms: query => invokeApiResult('search-video-platforms', isVideoSearchResponse, query),
  listVideoFormats: url => invokeApiResult('list-video-formats', value =>
    isVideoInfo(value) || isVideoPlaylistInfo(value), url),
  downloadVideoFormat: (url, formatId, convertToMp3, mediaLibraryPath) => invokeApiResult('download-video-format', value =>
    typeof value.path === 'string', url, formatId, convertToMp3, mediaLibraryPath),
  downloadVideoMp4: (url, videoFormatId, audioFormatId, mediaLibraryPath) => invokeApiResult('download-video-mp4', value =>
    typeof value.path === 'string', url, videoFormatId, audioFormatId, mediaLibraryPath),
  openDownloadedMediaFolder: filePath => invokeApiResult('open-downloaded-media-folder', () => true, filePath),
  openDownloadedMediaFile: filePath => invokeApiResult('open-downloaded-media-file', () => true, filePath),
  onVideoDownloadProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isVideoDownloadProgress(value)) listener(value);
    };
    ipcRenderer.on('video-download-progress', handler);
    return () => ipcRenderer.removeListener('video-download-progress', handler);
  },
  chooseTorrentFile: () => ipcRenderer.invoke('choose-torrent-file').then(value => {
    if (
      !isRecord(value) ||
      typeof value.canceled !== 'boolean' ||
      (value.canceled === false && typeof value.path !== 'string') ||
      (value.canceled === true && value.path !== undefined) ||
      (value.error !== undefined && typeof value.error !== 'string')
    ) {
      throw new Error('Electron API "choose-torrent-file" returned an invalid response.');
    }
    return value as Awaited<ReturnType<ElectronAPI['chooseTorrentFile']>>;
  }),
  startTorrentDownload: (source: ElectronTorrentSource, seedOnComplete: boolean) =>
    invokeApiResult('start-torrent-download', value =>
      typeof value.jobId === 'string' && typeof value.outputDirectory === 'string',
    source, seedOnComplete),
  stopTorrentDownload: jobId => invokeApiResult('stop-torrent-download', value =>
    value.stopped === true, jobId),
  getTorrentDownloadProgress: () => invokeApiResult('get-torrent-download-progress', value =>
    value.progress === null || isTorrentDownloadProgress(value.progress)),
  onTorrentDownloadProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isTorrentDownloadProgress(value)) listener(value);
    };
    ipcRenderer.on('torrent-download-progress', handler);
    return () => ipcRenderer.removeListener('torrent-download-progress', handler);
  },
  downloadVideoThumbnail: (url, mediaLibraryPath) => invokeApiResult('download-video-thumbnail', value =>
    typeof value.path === 'string', url, mediaLibraryPath),
  downloadOnlineArtwork: url => invokeApiResult('download-online-artwork', value =>
    typeof value.mime === 'string' && typeof value.base64 === 'string', url),
  getLyrics: p => invokeApiResult<{
    type: 'sylt' | 'common' | 'unsync' | null;
    lyrics: string | null;
    timed: ElectronTimedLyric[] | null;
  }>('get-lyrics', value =>
    (value.type === 'sylt' || value.type === 'common' || value.type === 'unsync' || value.type === null) &&
    (value.lyrics === null || typeof value.lyrics === 'string') &&
    isTimedLyrics(value.timed), p),
  generateBacking: p => invokeApiResult('generate-backing', value => typeof value.path === 'string', p),
  writeTempFile: (name, b64) => invokeApiResult('write-temp-file', value =>
    typeof value.path === 'string', name, b64),
  writePlaylists: playlists => invokeApiResult('write-playlists', value =>
    typeof value.path === 'string', playlists)
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);