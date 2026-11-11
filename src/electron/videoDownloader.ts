import { randomUUID } from 'node:crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import type { ElectronVideoSearchResponse, ElectronVideoSearchResult } from './electronApi';

export type YtDlpFormat = {
  formatId: string;
  extension: string;
  resolution: string;
  note: string;
  videoCodec: string;
  audioCodec: string;
  audioBitrate: number | null;
  sampleRate: number | null;
  audioChannels: number | null;
  duration: number | null;
  fileSize: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type YtDlpInfo = {
  title: string;
  thumbnailUrl: string | null;
  formats: YtDlpFormat[];
};

export type YtDlpPlaylistInfo = {
  title: string;
  thumbnailUrl: string | null;
  entries: Array<{
    index: number;
    id: string;
    url: string;
    title: string;
    thumbnailUrl: string | null;
    formats: YtDlpFormat[];
    unavailableReason?: string;
  }>;
};

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type VideoDownloadProgress = {
  title: string;
  percent: number | null;
};

function logVideoDownload(message: string) {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), 'player-ui.log'),
      `${new Date().toISOString()} video download: ${message}\n`,
      'utf8'
    );
  } catch (error) {
    console.warn('Unable to write video download progress log', error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' || (typeof value === 'string' && value.trim())
    ? Number(value)
    : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isCodecAvailable(codec: string) {
  return codec !== '' && codec.toLowerCase() !== 'none';
}

function getSafeThumbnailUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function getSafeBilibiliThumbnailUrl(value: string) {
  const candidate = value.startsWith('//') ? `https:${value}` : value;
  try {
    const url = new URL(candidate);
    const isBilibiliImageHost = ['hdslb.com', 'biliimg.com', 'bilivideo.com']
      .some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    if (url.protocol === 'http:' && isBilibiliImageHost) url.protocol = 'https:';
    return getSafeThumbnailUrl(url.toString());
  } catch {
    return null;
  }
}

export function selectHighestQualityThumbnail(info: Record<string, unknown>) {
  const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  const candidates = thumbnails.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const url = getSafeThumbnailUrl(item.url);
    if (!url) return [];
    const width = readPositiveNumber(item.width) ?? 0;
    const height = readPositiveNumber(item.height) ?? 0;
    return [{ url, area: width * height, index }];
  });
  candidates.sort((left, right) => right.area - left.area || left.index - right.index);
  return candidates.find(candidate => candidate.area > 0)?.url ??
    getSafeThumbnailUrl(info.thumbnail) ??
    candidates[0]?.url ??
    null;
}

export function validateVideoUrl(value: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Enter a video URL first.');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS video URL.');
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('Only HTTP or HTTPS video URLs without embedded credentials are supported.');
  }
  const bilibiliVideoPath = /^\/en\/video\/(BV[0-9A-Za-z]+)\/?$/i.exec(url.pathname);
  if (
    (url.hostname === 'bilibili.com' || url.hostname === 'www.bilibili.com') &&
    bilibiliVideoPath
  ) {
    url.pathname = `/video/${bilibiliVideoPath[1]}`;
  }
  return url.toString();
}

function parseYtDlpJson(output: string): Record<string, unknown> {
  let info: unknown;
  try {
    info = JSON.parse(output);
  } catch {
    throw new Error('yt-dlp returned invalid format data.');
  }

  if (!isRecord(info)) {
    throw new Error('yt-dlp did not return a list of formats for this URL.');
  }
  return info;
}

function parseYtDlpFormatRecords(info: Record<string, unknown>): YtDlpFormat[] {
  const rawFormats = Array.isArray(info.formats) ? info.formats : [];

  return rawFormats.flatMap((item): YtDlpFormat[] => {
    if (!isRecord(item) || (typeof item.format_id !== 'string' && typeof item.format_id !== 'number')) {
      return [];
    }

    const videoCodec = readString(item.vcodec);
    const audioCodec = readString(item.acodec);
    const duration = readPositiveNumber(item.duration) ?? readPositiveNumber(info.duration);
    const fileSize = readPositiveNumber(item.filesize) ??
      readPositiveNumber(item.filesize_approx);
    const audioBitrate = readPositiveNumber(item.abr) ??
      (!isCodecAvailable(videoCodec) ? readPositiveNumber(item.tbr) : null) ??
      (!isCodecAvailable(videoCodec) && duration && fileSize
        ? (fileSize * 8) / duration / 1000
        : null);
    const resolution = readString(item.resolution) ||
      (typeof item.width === 'number' && typeof item.height === 'number'
        ? `${item.width}x${item.height}`
        : (isCodecAvailable(audioCodec) && !isCodecAvailable(videoCodec) ? 'Audio only' : ''));
    return [{
      formatId: String(item.format_id),
      extension: readString(item.ext) || '—',
      resolution,
      note: readString(item.format_note),
      videoCodec,
      audioCodec,
      audioBitrate,
      sampleRate: readPositiveNumber(item.asr),
      audioChannels: readPositiveNumber(item.audio_channels),
      duration,
      fileSize,
      hasVideo: isCodecAvailable(videoCodec),
      hasAudio: isCodecAvailable(audioCodec)
    }];
  });
}

function getEntryUrl(entry: Record<string, unknown>) {
  const extractor = readString(entry.extractor_key).toLowerCase();
  const id = readString(entry.id);
  if (extractor.includes('youtube') && id) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  const candidates = [entry.webpage_url, entry.original_url, entry.url];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      continue;
    }
  }
  return '';
}

export function parseYtDlpInfo(output: string): YtDlpInfo {
  const info = parseYtDlpJson(output);
  if (!Array.isArray(info.formats)) {
    throw new Error('yt-dlp did not return a list of formats for this URL.');
  }
  return {
    title: readString(info.title) || 'Untitled video',
    thumbnailUrl: selectHighestQualityThumbnail(info),
    formats: parseYtDlpFormatRecords(info)
  };
}

export function parseYtDlpMediaInfo(output: string): YtDlpInfo | YtDlpPlaylistInfo {
  const info = parseYtDlpJson(output);
  if (!Array.isArray(info.entries)) return parseYtDlpInfo(output);

  const entries = info.entries.map((value, index) => {
    if (!isRecord(value)) {
      return {
        index: index + 1,
        id: String(index + 1),
        url: '',
        title: `Unavailable video ${index + 1}`,
        thumbnailUrl: null,
        formats: [],
        formatsLoaded: false,
        unavailableReason: 'yt-dlp could not read this playlist entry.'
      };
    }
    const url = getEntryUrl(value);
    const formats = parseYtDlpFormatRecords(value);
    const formatsLoaded = Array.isArray(value.formats);
    return {
      index: index + 1,
      id: readString(value.id) || String(index + 1),
      url,
      title: readString(value.title) || `Video ${index + 1}`,
      thumbnailUrl: selectHighestQualityThumbnail(value),
      formats,
      formatsLoaded,
      ...(!url
        ? { unavailableReason: 'yt-dlp did not provide a playable URL for this entry.' }
        : formatsLoaded && formats.length === 0
          ? { unavailableReason: 'No downloadable formats are available for this entry.' }
          : {})
    };
  });
  if (entries.length === 0) {
    throw new Error('yt-dlp returned a playlist without any playable entries.');
  }
  return {
    title: readString(info.title) || 'Untitled playlist',
    thumbnailUrl: selectHighestQualityThumbnail(info),
    entries
  };
}

export function createYouTubeSearchArgs(query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 200) {
    throw new Error('Enter a search term of 1 to 200 characters.');
  }
  return [
    '--dump-single-json',
    '--skip-download',
    '--flat-playlist',
    '--no-warnings',
    '--encoding', 'UTF-8',
    '--',
    `ytsearch6:${normalizedQuery}`
  ];
}

export function createBilibiliSearchUrl(query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 200) {
    throw new Error('Enter a search term of 1 to 200 characters.');
  }
  const searchUrl = new URL('https://api.bilibili.com/x/web-interface/search/type');
  searchUrl.searchParams.set('Search_key', normalizedQuery);
  searchUrl.searchParams.set('search_type', 'video');
  searchUrl.searchParams.set('keyword', normalizedQuery);
  searchUrl.searchParams.set('page', '1');
  searchUrl.searchParams.set('context', '');
  searchUrl.searchParams.set('duration', '0');
  searchUrl.searchParams.set('tids_2', '');
  searchUrl.searchParams.set('__refresh__', 'true');
  searchUrl.searchParams.set('tids', '0');
  searchUrl.searchParams.set('highlight', '1');
  return searchUrl;
}

export function parseYtDlpSearchResults(output: string): ElectronVideoSearchResult[] {
  const info = parseYtDlpJson(output);
  if (!Array.isArray(info.entries)) {
    throw new Error('yt-dlp did not return YouTube search results.');
  }
  return info.entries.flatMap((entry): ElectronVideoSearchResult[] => {
    if (!isRecord(entry)) return [];
    const id = readString(entry.id).trim();
    const title = readString(entry.title).trim();
    if (!id || !title) return [];
    return [{
      id,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      title,
      thumbnailUrl: selectHighestQualityThumbnail(entry)
    }];
  }).slice(0, 6);
}

function decodeBilibiliTitle(value: string) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .trim();
}

export function parseBilibiliSearchResults(payload: unknown): ElectronVideoSearchResult[] {
  if (!isRecord(payload) || typeof payload.code !== 'number' || payload.code !== 0 ||
      !isRecord(payload.data) || !Array.isArray(payload.data.result)) {
    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : 'Bilibili returned an invalid search response.';
    throw new Error(message);
  }

  return payload.data.result.flatMap((entry): ElectronVideoSearchResult[] => {
    if (!isRecord(entry)) return [];
    const id = readString(entry.bvid).trim();
    const title = decodeBilibiliTitle(readString(entry.title));
    if (!/^BV[0-9A-Za-z]+$/i.test(id) || !title) return [];
    const thumbnail = readString(entry.pic);
    return [{
      id,
      url: `https://www.bilibili.com/video/${encodeURIComponent(id)}`,
      title,
      thumbnailUrl: getSafeBilibiliThumbnailUrl(thumbnail)
    }];
  }).slice(0, 6);
}

async function searchYouTube(query: string): Promise<ElectronVideoSearchResult[]> {
  const result = await runYtDlp(
    createYouTubeSearchArgs(query),
    60_000,
    'yt-dlp timed out while searching YouTube.',
    undefined,
    8 * 1024 * 1024
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `yt-dlp exited with code ${result.exitCode ?? 'unknown'}.`);
  }
  return parseYtDlpSearchResults(result.stdout);
}

export async function searchBilibili(
  query: string,
  fetcher: typeof fetch = fetch
): Promise<ElectronVideoSearchResult[]> {
  const response = await fetcher(createBilibiliSearchUrl(query), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cookie': `buvid3=${randomUUID()}infoc`
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Bilibili returned HTTP ${response.status}.`);
  return parseBilibiliSearchResults(await response.json());
}

export async function searchVideoPlatforms(query: string): Promise<ElectronVideoSearchResponse> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 200) {
    throw new Error('Enter a search term of 1 to 200 characters.');
  }

  const [youtube, bilibili] = await Promise.allSettled([
    searchYouTube(normalizedQuery),
    searchBilibili(normalizedQuery)
  ]);
  const errors: NonNullable<ElectronVideoSearchResponse['errors']> = {};
  if (youtube.status === 'rejected') errors.youtube = getVideoFormatErrorMessage(youtube.reason);
  if (bilibili.status === 'rejected') {
    errors.bilibili = bilibili.reason instanceof Error ? bilibili.reason.message : String(bilibili.reason);
  }
  return {
    youtube: youtube.status === 'fulfilled' ? youtube.value : [],
    bilibili: bilibili.status === 'fulfilled' ? bilibili.value : [],
    ...(Object.keys(errors).length ? { errors } : {})
  };
}

export function parseYtDlpProgressLine(line: string): number | null {
  const match = /MEDIA_PROGRESS:\s*(\d+(?:\.\d+)?)\s*%?/i.exec(line) ??
    /\[download\]\s+(\d+(?:\.\d+)?)\s*%/i.exec(line);
  if (!match) return null;
  const percent = Number(match[1]);
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null;
}

function runYtDlp(
  args: string[],
  timeoutMs: number,
  timeoutMessage: string,
  onProgress?: (progress: VideoDownloadProgress) => void,
  maxOutputLength = 2 * 1024 * 1024
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env }
    });
    logVideoDownload(`yt-dlp started pid=${child.pid ?? 'unknown'}`);

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let title = '';
    let timedOut = false;
    let outputTruncated = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const appendLimited = (current: string, chunk: unknown) => {
      const combined = `${current}${String(chunk)}`;
      if (combined.length > maxOutputLength) outputTruncated = true;
      return combined.slice(-maxOutputLength);
    };
    const processOutputLines = (lines: string[], stream: 'stdout' | 'stderr') => {
      for (const line of lines) {
        if (/\[download\]|MEDIA_PROGRESS:/i.test(line)) {
          logVideoDownload(`${stream} output: ${line.slice(0, 500)}`);
        }
        if (line.startsWith('MEDIA_TITLE:')) {
          title = line.slice('MEDIA_TITLE:'.length).trim();
          logVideoDownload(`title received: ${title}`);
          onProgress?.({ title, percent: null });
        }
        const percent = parseYtDlpProgressLine(line);
        if (percent !== null) {
          logVideoDownload(`parsed progress=${percent}% title=${title || '(not reported)'}`);
          onProgress?.({ title, percent });
        }
      }
    };

    child.stdout?.on('data', chunk => {
      const text = stdoutDecoder.write(chunk);
      stdout = appendLimited(stdout, text);
      if (!onProgress) return;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/[\r\n]+/);
      stdoutBuffer = lines.pop() || '';
      processOutputLines(lines, 'stdout');
    });
    child.stderr?.on('data', chunk => {
      const text = stderrDecoder.write(chunk);
      stderr = appendLimited(stderr, text);
      if (!onProgress) return;
      stderrBuffer += text;
      const lines = stderrBuffer.split(/[\r\n]+/);
      stderrBuffer = lines.pop() || '';
      processOutputLines(lines, 'stderr');
    });
    child.once('error', error => {
      clearTimeout(timeout);
      logVideoDownload(`process error: ${error.message}`);
      reject(error);
    });
    child.once('close', exitCode => {
      clearTimeout(timeout);
      const stdoutRemainder = stdoutDecoder.end();
      const stderrRemainder = stderrDecoder.end();
      stdout = appendLimited(stdout, stdoutRemainder);
      stderr = appendLimited(stderr, stderrRemainder);
      if (onProgress) {
        stdoutBuffer += stdoutRemainder;
        stderrBuffer += stderrRemainder;
        processOutputLines([stdoutBuffer], 'stdout');
        processOutputLines([stderrBuffer], 'stderr');
      }
      logVideoDownload(`yt-dlp closed exitCode=${exitCode ?? 'unknown'} stdoutChars=${stdout.length} stderrChars=${stderr.length}`);
      if (timedOut) {
        logVideoDownload('download timed out');
        reject(new Error(timeoutMessage));
        return;
      }
      if (outputTruncated) {
        reject(new Error('yt-dlp output exceeded the playlist metadata size limit.'));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export function createVideoInfoArgs(value: string) {
  const url = validateVideoUrl(value);
  return [
    '--dump-single-json',
    '--skip-download',
    '--flat-playlist',
    '--no-warnings',
    '--encoding', 'UTF-8',
    '--',
    url
  ];
}

export async function listVideoFormats(value: string): Promise<YtDlpInfo | YtDlpPlaylistInfo> {
  const result = await runYtDlp(
    createVideoInfoArgs(value),
    10 * 60_000,
    'yt-dlp timed out while reading the video or playlist formats.',
    undefined,
    64 * 1024 * 1024
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `yt-dlp exited with code ${result.exitCode ?? 'unknown'}.`);
  }
  return parseYtDlpMediaInfo(result.stdout);
}

export function getMediaDownloadsDirectory(mediaLibraryPath: string) {
  const root = mediaLibraryPath.trim();
  if (!root || !path.isAbsolute(root)) {
    throw new Error('Set a valid absolute media library location in Config first.');
  }
  return path.join(path.resolve(root), 'Downloads');
}

function ensureMediaDownloadsDirectory(mediaLibraryPath: string) {
  const downloadsDirectory = getMediaDownloadsDirectory(mediaLibraryPath);
  fs.mkdirSync(downloadsDirectory, { recursive: true });
  return downloadsDirectory;
}

export function createVideoDownloadArgs(urlValue: string, formatId: string, outputDirectory: string, convertToMp3: boolean) {
  const url = validateVideoUrl(urlValue);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(formatId)) {
    throw new Error('Invalid video format ID.');
  }
  if (!outputDirectory.trim()) {
    throw new Error('Download folder is unavailable.');
  }

  return [
    '--no-warnings',
    '--no-colors',
    '--newline',
    '--progress',
    '--progress-delta', '1',
    '--progress-template', 'download:MEDIA_PROGRESS:%(progress._percent_str)s',
    '--encoding', 'UTF-8',
    '--no-playlist',
    '--force-overwrites',
    '--format', formatId,
    '--paths', outputDirectory,
    '--output', '%(title).200B [%(id)s].%(ext)s',
    ...(convertToMp3 ? ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '320K'] : []),
    '--print', 'before_dl:MEDIA_TITLE:%(title)s',
    '--print', 'after_move:filepath',
    '--',
    url
  ];
}

export async function downloadVideoFormat(
  urlValue: string,
  formatId: string,
  convertToMp3: boolean,
  mediaLibraryPath: string,
  onProgress?: (progress: VideoDownloadProgress) => void
) {
  const outputDirectory = ensureMediaDownloadsDirectory(mediaLibraryPath);
  const args = createVideoDownloadArgs(urlValue, formatId, outputDirectory, convertToMp3);
  const result = await runYtDlp(
    args,
    30 * 60_000,
    'yt-dlp timed out while downloading the selected format.',
    onProgress
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `yt-dlp exited with code ${result.exitCode ?? 'unknown'}.`);
  }

  const filePath = result.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!filePath) {
    throw new Error('yt-dlp finished without reporting the downloaded file path.');
  }
  return { path: filePath };
}

export function createVideoMp4DownloadArgs(
  urlValue: string,
  videoFormatId: string,
  audioFormatId: string | null,
  outputDirectory: string
) {
  const url = validateVideoUrl(urlValue);
  const isValidFormatId = (formatId: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(formatId);
  if (!isValidFormatId(videoFormatId) || (audioFormatId !== null && !isValidFormatId(audioFormatId))) {
    throw new Error('Invalid video or audio format ID.');
  }
  if (!outputDirectory.trim()) {
    throw new Error('Download folder is unavailable.');
  }

  const formatSelector = audioFormatId === null
    ? videoFormatId
    : `${videoFormatId}+${audioFormatId}`;
  return [
    '--no-warnings',
    '--no-colors',
    '--newline',
    '--progress',
    '--progress-delta', '1',
    '--progress-template', 'download:MEDIA_PROGRESS:%(progress._percent_str)s',
    '--encoding', 'UTF-8',
    '--no-playlist',
    '--force-overwrites',
    '--format', formatSelector,
    '--remux-video', 'mp4',
    '--paths', outputDirectory,
    '--output', '%(title).200B [%(id)s].%(ext)s',
    '--print', 'before_dl:MEDIA_TITLE:%(title)s',
    '--print', 'after_move:filepath',
    '--',
    url
  ];
}

export async function downloadVideoMp4(
  urlValue: string,
  videoFormatId: string,
  audioFormatId: string | null,
  mediaLibraryPath: string,
  onProgress?: (progress: VideoDownloadProgress) => void
) {
  const outputDirectory = ensureMediaDownloadsDirectory(mediaLibraryPath);
  const args = createVideoMp4DownloadArgs(urlValue, videoFormatId, audioFormatId, outputDirectory);
  const result = await runYtDlp(
    args,
    30 * 60_000,
    'yt-dlp timed out while downloading the selected MP4 format.',
    onProgress
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `yt-dlp exited with code ${result.exitCode ?? 'unknown'}.`);
  }

  const filePath = result.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!filePath) {
    throw new Error('yt-dlp finished without reporting the downloaded file path.');
  }
  return { path: filePath };
}

export function createThumbnailDownloadArgs(urlValue: string, outputDirectory: string) {
  const url = validateVideoUrl(urlValue);
  return [
    '--skip-download',
    '--write-thumbnail',
    '--no-warnings',
    '--encoding', 'UTF-8',
    '--no-playlist',
    '--paths', outputDirectory,
    '--output', '%(title).200B [%(id)s].%(ext)s',
    '--',
    url
  ];
}

export async function downloadVideoThumbnail(urlValue: string, mediaLibraryPath: string) {
  const downloadsDirectory = ensureMediaDownloadsDirectory(mediaLibraryPath);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-thumbnail-'));
  try {
    const result = await runYtDlp(
      createThumbnailDownloadArgs(urlValue, temporaryDirectory),
      5 * 60_000,
      'yt-dlp timed out while downloading the thumbnail.'
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `yt-dlp exited with code ${result.exitCode ?? 'unknown'}.`);
    }

    const thumbnailPath = fs.readdirSync(temporaryDirectory)
      .map(name => path.join(temporaryDirectory, name))
      .find(filePath => /\.(jpe?g|png|webp|avif)$/i.test(filePath) && fs.statSync(filePath).isFile());
    if (!thumbnailPath) throw new Error('yt-dlp did not produce a thumbnail image.');

    fs.mkdirSync(downloadsDirectory, { recursive: true });
    const parsed = path.parse(path.basename(thumbnailPath));
    let destination = path.join(downloadsDirectory, parsed.base);
    let suffix = 1;
    while (fs.existsSync(destination)) {
      destination = path.join(downloadsDirectory, `${parsed.name} (${suffix})${parsed.ext}`);
      suffix += 1;
    }
    fs.copyFileSync(thumbnailPath, destination, fs.constants.COPYFILE_EXCL);
    return { path: destination };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function getVideoFormatErrorMessage(error: unknown) {
  if (isRecord(error) && error.code === 'ENOENT') {
    return 'yt-dlp was not found. Install yt-dlp and make sure it is available on PATH.';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/ffmpeg/i.test(message)) {
    return `This download requires FFmpeg. Install FFmpeg and add it to PATH. ${message}`;
  }
  return message;
}
