export type ElectronApiResult<T extends object = Record<string, never>> =
  | ({ ok: true; error?: undefined } & T)
  | { ok: false; error: string; retryable?: boolean };

export type ElectronTrackRecord = {
  id: string;
  name: string;
  path?: string;
  src?: string;
  cover?: string;
  bitrate?: number;
  resolution?: string;
};

export type ElectronPlaylistRecord = {
  name: string;
  tracks: ElectronTrackRecord[];
};

export type ElectronTagDraft = {
  title: string;
  artist: string;
  album: string;
  year: string;
  track: string;
  albumArtist: string;
  lyricist: string;
  composer: string;
  lyrics: string;
  coverMime: string;
  coverBase64: string;
  removeCover: boolean;
};

export type ElectronTimedLyric = { time: number; text: string };

export type ElectronKaraokeCharacter = { text: string; start: number; end: number };
export type ElectronKaraokeSubtitleLine = {
  start: number;
  end: number;
  text: string;
  characters: ElectronKaraokeCharacter[];
};
export type ElectronKaraokeAlignmentProgress = { message: string };

export type ElectronOnlineLyricsResult = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number | null;
  plainLyrics: string;
  syncedLyrics: string;
  source?: string;
};

export type ElectronMetadataSource = 'Apple Music/iTunes' | 'Discogs' | 'MusicBrainz';
export type ElectronMetadataSearchHints = {
  title: string;
  artist: string;
  album: string;
};
export type ElectronMetadataField =
  | 'title'
  | 'artist'
  | 'album'
  | 'year'
  | 'track'
  | 'albumArtist'
  | 'cover'
  | 'duration'
  | 'composer'
  | 'lyricist';

export type ElectronOnlineMetadataResult = {
  id: number | string;
  trackName: string;
  artistName: string;
  albumName: string;
  year: string;
  trackNumber: string;
  albumArtist: string;
  artworkUrl: string;
  duration: number | null;
  composer?: string;
  lyricist?: string;
  country?: 'TW' | 'HK' | 'US' | 'JP' | 'GB' | 'CA' | 'AU' | 'SG';
  fieldSources?: Partial<Record<ElectronMetadataField, ElectronMetadataSource>>;
};

export type ElectronLyricsResult =
  | {
      ok: true;
      type: 'sylt' | 'common' | 'unsync' | null;
      lyrics: string | null;
      timed: ElectronTimedLyric[] | null;
    }
  | { ok: false; error: string };

export type ElectronLyricsSearchResult = ElectronApiResult<{
  results: ElectronOnlineLyricsResult[];
  fallbackUsed?: boolean;
  fallbackError?: string;
  retryable?: boolean;
}>;

export type ElectronMetadataSearchResult = ElectronApiResult<{
  results: ElectronOnlineMetadataResult[];
  warnings?: string[];
}>;

export type ElectronVideoFormat = {
  formatId: string;
  extension: string;
  resolution: string;
  note: string;
  videoCodec: string;
  audioCodec: string;
  audioBitrate?: number | null;
  sampleRate?: number | null;
  audioChannels?: number | null;
  duration?: number | null;
  fileSize: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type ElectronVideoInfo = {
  title: string;
  thumbnailUrl?: string | null;
  formats: ElectronVideoFormat[];
};

export type ElectronVideoPlaylistEntry = {
  index: number;
  id: string;
  url: string;
  title: string;
  thumbnailUrl?: string | null;
  formats: ElectronVideoFormat[];
  formatsLoaded: boolean;
  unavailableReason?: string;
};

export type ElectronVideoPlaylistInfo = {
  title: string;
  thumbnailUrl?: string | null;
  entries: ElectronVideoPlaylistEntry[];
};

export type ElectronVideoMediaInfo = ElectronVideoInfo | ElectronVideoPlaylistInfo;

export type ElectronVideoSearchResult = {
  id: string;
  url: string;
  title: string;
  thumbnailUrl: string | null;
};

export type ElectronVideoSearchResponse = {
  youtube: ElectronVideoSearchResult[];
  bilibili: ElectronVideoSearchResult[];
  errors?: {
    youtube?: string;
    bilibili?: string;
  };
};

export type ElectronVideoDownloadProgress = {
  title: string;
  percent: number | null;
};

export type ElectronTorrentSource =
  | { kind: 'magnet'; uri: string }
  | { kind: 'torrent-url'; url: string }
  | { kind: 'torrent'; path: string };

export type ElectronTorrentDownloadProgress = {
  jobId: string;
  title: string;
  status: 'starting' | 'downloading' | 'seeding' | 'completed' | 'stopped' | 'error';
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  outputDirectory: string;
  error?: string;
};

export interface ElectronAPI {
  getPathForFile(file: File): string;
  loadMediaLibraryPath(): Promise<ElectronApiResult<{ path: string | null }>>;
  saveMediaLibraryPath(path: string): Promise<ElectronApiResult>;
  savePlaylist(name: string, tracks: ElectronTrackRecord[]): Promise<ElectronApiResult<{ path: string }>>;
  loadPlaylists(): Promise<ElectronApiResult<{ playlists: ElectronPlaylistRecord[] }>>;
  readdirRecursive(path: string): Promise<ElectronApiResult<{ files: string[] }>>;
  scanAudioFiles(path: string, recursive: boolean): Promise<ElectronApiResult<{ files: string[] }>>;
  splitAudioStems(path: string, outputRoot: string): Promise<ElectronApiResult<{
    vocalsPath: string;
    accompanimentPath: string;
  }>>;
  alignKaraokeSource(mediaPath: string, vocalsPath: string, lyrics: string, outputRoot: string, timedLyrics?: ElectronTimedLyric[]): Promise<ElectronApiResult<{ outputPath: string }>>;
  readKaraokeSubtitle(path: string): Promise<ElectronApiResult<{ lines: ElectronKaraokeSubtitleLine[] }>>;
  findKaraokeSubtitle(videoPath: string, mediaLibraryPath: string): Promise<ElectronApiResult<{ path: string | null }>>;
  chooseKaraokeSubtitle(): Promise<
    | { canceled: false; paths: string[] }
    | { canceled: true; paths?: string[]; error?: string }
  >;
  chooseKaraokeSubtitleSavePath(defaultPath: string): Promise<ElectronApiResult<{ path: string | null }>>;
  saveKaraokeSubtitle(path: string, lines: ElectronKaraokeSubtitleLine[], sourcePath?: string): Promise<ElectronApiResult>;
  chooseKaraokeSource(): Promise<
    | { canceled: false; paths: string[] }
    | { canceled: true; paths?: string[]; error?: string }
  >;
  chooseKaraokeVideo(): Promise<
    | { canceled: false; paths: string[] }
    | { canceled: true; paths?: string[]; error?: string }
  >;
  chooseKaraokeLrc(): Promise<
    | { canceled: false; paths: string[] }
    | { canceled: true; paths?: string[]; error?: string }
  >;
  readKaraokeLrc(path: string): Promise<ElectronApiResult<{ text: string }>>;
  onKaraokeAlignmentProgress(listener: (progress: ElectronKaraokeAlignmentProgress) => void): () => void;
  stat(path: string): Promise<ElectronApiResult<{ isFile: boolean; isDirectory: boolean }>>;
  chooseFiles(): Promise<
    | { canceled: false; paths: string[] }
    | { canceled: true; paths?: string[]; error?: string }
  >;
  chooseFolder(): Promise<
    | { canceled: false; paths: string[] }
    | { canceled: true; paths?: string[]; error?: string }
  >;
  chooseFolderFiles(): Promise<
    | { canceled: false; paths: string[] }
    | { canceled: true; paths?: string[]; error?: string }
  >;
  appendLog(message: string): Promise<ElectronApiResult<{ path: string }>>;
  readFile(path: string): Promise<ElectronApiResult<{ data: string; mime: string }>>;
  getBitrate(path: string): Promise<ElectronApiResult<{ bitrate: number | null }>>;
  getCover(path: string, thumbnail?: boolean): Promise<ElectronApiResult<{ coverBase64: string | null; mime?: string }>>;
  readMp3Tags(path: string): Promise<ElectronApiResult<{
    title: string;
    artist: string;
    album: string;
    year: string;
    track: string;
    albumArtist: string;
    lyricist: string;
    composer: string;
    lyrics: string;
    coverMime: string;
    coverBase64: string;
  }>>;
  writeMp3Tags(path: string, draft: ElectronTagDraft): Promise<ElectronApiResult<{ backupPath: string }>>;
  searchLyrics(query: string, fallbackQuery?: string, artistQuery?: string): Promise<ElectronLyricsSearchResult>;
  searchMetadata(query: string, hints?: ElectronMetadataSearchHints): Promise<ElectronMetadataSearchResult>;
  searchVideoPlatforms(query: string): Promise<ElectronApiResult<ElectronVideoSearchResponse>>;
  listVideoFormats(url: string): Promise<ElectronApiResult<ElectronVideoMediaInfo>>;
  downloadVideoFormat(url: string, formatId: string, convertToMp3: boolean, mediaLibraryPath: string): Promise<ElectronApiResult<{ path: string }>>;
  downloadVideoMp4(url: string, videoFormatId: string, audioFormatId: string | null, mediaLibraryPath: string): Promise<ElectronApiResult<{ path: string }>>;
  openDownloadedMediaFolder(filePath: string): Promise<ElectronApiResult>;
  openDownloadedMediaFile(filePath: string): Promise<ElectronApiResult>;
  onVideoDownloadProgress(listener: (progress: ElectronVideoDownloadProgress) => void): () => void;
  chooseTorrentFile(): Promise<
    | { canceled: false; path: string }
    | { canceled: true; error?: string }
  >;
  startTorrentDownload(source: ElectronTorrentSource, seedOnComplete: boolean): Promise<ElectronApiResult<{
    jobId: string;
    outputDirectory: string;
  }>>;
  stopTorrentDownload(jobId: string): Promise<ElectronApiResult<{ stopped: true }>>;
  getTorrentDownloadProgress(): Promise<ElectronApiResult<{
    progress: ElectronTorrentDownloadProgress | null;
  }>>;
  onTorrentDownloadProgress(listener: (progress: ElectronTorrentDownloadProgress) => void): () => void;
  downloadVideoThumbnail(url: string, mediaLibraryPath: string): Promise<ElectronApiResult<{ path: string }>>;
  downloadOnlineArtwork(url: string): Promise<ElectronApiResult<{ mime: string; base64: string }>>;
  getLyrics(path: string): Promise<ElectronLyricsResult>;
  generateBacking(path: string): Promise<ElectronApiResult<{ path: string }>>;
  writeTempFile(name: string, base64: string): Promise<ElectronApiResult<{ path: string }>>;
  writePlaylists(playlists: ElectronPlaylistRecord[]): Promise<ElectronApiResult<{ path: string }>>;
}

export type ElectronApiBridge = Partial<ElectronAPI>;

export function parseElectronApiResult<T extends object>(
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

export function parseChooseFolderResult(value: unknown): Awaited<ReturnType<ElectronAPI['chooseFolder']>> {
  if (
    !isRecord(value) ||
    typeof value.canceled !== 'boolean' ||
    (value.paths !== undefined && !isStringArray(value.paths)) ||
    (value.error !== undefined && typeof value.error !== 'string') ||
    (value.canceled === false && (!isStringArray(value.paths) || value.error !== undefined))
  ) {
    throw new Error('Electron API "choose-folder" returned an invalid response.');
  }
  return value as Awaited<ReturnType<ElectronAPI['chooseFolder']>>;
}

export function parseChooseFolderFilesResult(
  value: unknown
): Awaited<ReturnType<ElectronAPI['chooseFolderFiles']>> {
  if (
    !isRecord(value) ||
    typeof value.canceled !== 'boolean' ||
    (value.paths !== undefined && !isStringArray(value.paths)) ||
    (value.error !== undefined && typeof value.error !== 'string') ||
    (value.canceled === false && (!isStringArray(value.paths) || value.error !== undefined))
  ) {
    throw new Error('Electron API "choose-folder-files" returned an invalid response.');
  }
  return value as Awaited<ReturnType<ElectronAPI['chooseFolderFiles']>>;
}

export function parseChooseFilesResult(value: unknown): Awaited<ReturnType<ElectronAPI['chooseFiles']>> {
  if (
    !isRecord(value) ||
    typeof value.canceled !== 'boolean' ||
    (value.paths !== undefined && !isStringArray(value.paths)) ||
    (value.error !== undefined && typeof value.error !== 'string') ||
    (value.canceled === false && (!isStringArray(value.paths) || value.error !== undefined))
  ) {
    throw new Error('Electron API "choose-files" returned an invalid response.');
  }
  return value as Awaited<ReturnType<ElectronAPI['chooseFiles']>>;
}

export function hasElectronCapability<K extends keyof ElectronAPI>(
  api: ElectronApiBridge | undefined,
  capability: K
): api is ElectronApiBridge & Required<Pick<ElectronAPI, K>> {
  return typeof api?.[capability] === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
