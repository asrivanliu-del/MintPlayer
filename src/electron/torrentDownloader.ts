import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const MAX_TORRENT_FILE_SIZE = 10 * 1024 * 1024;
const RPC_START_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 1000;

export type TorrentSource =
  | { kind: 'magnet'; uri: string }
  | { kind: 'torrent-url'; url: string }
  | { kind: 'torrent'; path: string };

export type TorrentDownloadStatus = 'starting' | 'downloading' | 'seeding' | 'completed' | 'stopped' | 'error';

export type TorrentDownloadProgress = {
  jobId: string;
  title: string;
  status: TorrentDownloadStatus;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  outputDirectory: string;
  error?: string;
};

type TorrentEngineStatus = {
  status?: string;
  totalLength?: string;
  completedLength?: string;
  downloadSpeed?: string;
  uploadSpeed?: string;
  connections?: string;
  errorCode?: string;
  errorMessage?: string;
  followedBy?: string[];
  bittorrent?: { info?: { name?: string } };
  files?: Array<{ path?: string }>;
};

export interface TorrentDownloadEngine {
  add(source: TorrentSource, outputDirectory: string): Promise<string>;
  getStatus(gid: string): Promise<TorrentEngineStatus>;
  remove(gid: string): Promise<void>;
  close(): Promise<void>;
  onExit(listener: (error: Error) => void): () => void;
}

type TorrentDownloadManagerOptions = {
  createEngine: () => Promise<TorrentDownloadEngine>;
  onProgress: (progress: TorrentDownloadProgress) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function validateTorrentSource(value: unknown): Promise<TorrentSource> {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Choose a .torrent file or enter a magnet link.');
  }

  if (value.kind === 'magnet') {
    if (typeof value.uri !== 'string' || value.uri.length > 8192) {
      throw new Error('Enter a valid magnet link.');
    }

    let magnet: URL;
    try {
      magnet = new URL(value.uri.trim());
    } catch {
      throw new Error('Enter a valid magnet link.');
    }

    const hasSupportedTorrentHash = magnet.searchParams.getAll('xt').some(hash =>
      /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(hash) ||
      /^urn:btmh:1220[a-f0-9]{64}$/i.test(hash)
    );
    if (magnet.protocol !== 'magnet:' || !hasSupportedTorrentHash) {
      throw new Error('The magnet link must contain a supported BitTorrent info hash.');
    }

    return { kind: 'magnet', uri: magnet.toString() };
  }

  if (value.kind === 'torrent-url') {
    if (typeof value.url !== 'string' || value.url.length > 2048) {
      throw new Error('Enter a valid HTTPS .torrent URL.');
    }

    let torrentUrl: URL;
    try {
      torrentUrl = new URL(value.url.trim());
    } catch {
      throw new Error('Enter a valid HTTPS .torrent URL.');
    }
    if (
      torrentUrl.protocol !== 'https:' ||
      torrentUrl.username ||
      torrentUrl.password ||
      !torrentUrl.pathname.toLocaleLowerCase().endsWith('.torrent')
    ) {
      throw new Error('Torrent URLs must be HTTPS links ending in .torrent.');
    }
    return { kind: 'torrent-url', url: torrentUrl.toString() };
  }

  if (value.kind !== 'torrent' || typeof value.path !== 'string' || !path.isAbsolute(value.path)) {
    throw new Error('Choose a valid local .torrent file.');
  }

  const filePath = path.resolve(value.path);
  if (path.extname(filePath).toLocaleLowerCase() !== '.torrent') {
    throw new Error('The selected file must have a .torrent extension.');
  }

  let fileStat: fs.Stats;
  try {
    fileStat = await fs.promises.stat(filePath);
  } catch (error) {
    throw new Error(`Unable to read the selected .torrent file: ${String(error)}`);
  }
  if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_TORRENT_FILE_SIZE) {
    throw new Error('The .torrent file must be a non-empty file smaller than 10 MB.');
  }

  return { kind: 'torrent', path: await fs.promises.realpath(filePath) };
}

function parseNonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getStatusTitle(status: TorrentEngineStatus, fallback: string) {
  const torrentName = status.bittorrent?.info?.name;
  if (typeof torrentName === 'string' && torrentName.trim()) return torrentName;
  const filePath = status.files?.find(file => typeof file.path === 'string')?.path;
  return filePath ? path.basename(filePath) : fallback;
}

async function downloadTorrentFile(url: string) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`Unable to download .torrent file: HTTP ${response.status}.`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_TORRENT_FILE_SIZE) {
    throw new Error('The .torrent file must be smaller than 10 MB.');
  }
  if (!response.body) throw new Error('The .torrent URL returned an empty response.');

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_TORRENT_FILE_SIZE) {
      try {
        await reader.cancel();
      } catch (error) {
        console.warn('Unable to cancel oversized torrent response', error);
      }
      throw new Error('The .torrent file must be smaller than 10 MB.');
    }
    chunks.push(Buffer.from(value));
  }
  if (totalSize === 0) throw new Error('The .torrent URL returned an empty file.');

  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mintplayer-torrent-'));
  const temporaryPath = path.join(temporaryDirectory, 'source.torrent');
  try {
    await fs.promises.writeFile(temporaryPath, Buffer.concat(chunks, totalSize), { flag: 'wx' });
    return { source: { kind: 'torrent', path: temporaryPath } as const, temporaryDirectory };
  } catch (error) {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function createTorrentDownloadManager({ createEngine, onProgress }: TorrentDownloadManagerOptions) {
  type ActiveJob = {
    id: string;
    gid: string;
    currentGid: string;
    source: TorrentSource;
    outputDirectory: string;
    seedOnComplete: boolean;
    engine: TorrentDownloadEngine;
    timer: NodeJS.Timeout;
    removeExitListener: () => void;
    polling: boolean;
    consecutivePollErrors: number;
  };

  let activeJob: ActiveJob | null = null;
  let lastProgress: TorrentDownloadProgress | null = null;

  function emit(job: ActiveJob, status: TorrentDownloadStatus, data: Partial<TorrentDownloadProgress> = {}) {
    const progress: TorrentDownloadProgress = {
      jobId: job.id,
      title: data.title || (
        job.source.kind === 'torrent'
          ? path.basename(job.source.path, '.torrent')
          : job.source.kind === 'torrent-url'
            ? path.basename(new URL(job.source.url).pathname, '.torrent') || 'Torrent download'
            : 'Torrent download'
      ),
      status,
      progress: data.progress ?? null,
      downloadedBytes: data.downloadedBytes ?? 0,
      totalBytes: data.totalBytes ?? 0,
      downloadSpeed: data.downloadSpeed ?? 0,
      uploadSpeed: data.uploadSpeed ?? 0,
      peers: data.peers ?? 0,
      outputDirectory: job.outputDirectory,
      ...(data.error ? { error: data.error } : {})
    };
    lastProgress = progress;
    onProgress(progress);
  }

  async function closeJob(job: ActiveJob) {
    if (activeJob === job) activeJob = null;
    clearInterval(job.timer);
    job.removeExitListener();
    await job.engine.close();
  }

  async function failJob(job: ActiveJob, error: Error) {
    if (activeJob !== job) return;
    emit(job, 'error', { error: error.message });
    try {
      await closeJob(job);
    } catch (closeError) {
      console.warn('Unable to close torrent download engine after failure', closeError);
    }
  }

  async function pollJob(job: ActiveJob) {
    if (activeJob !== job || job.polling) return;
    job.polling = true;
    try {
      const initialStatus = await job.engine.getStatus(job.gid);
      const followedGid = initialStatus.followedBy?.[0];
      const currentGid = followedGid || job.gid;
      const status = currentGid === job.gid
        ? initialStatus
        : await job.engine.getStatus(currentGid);
      if (activeJob !== job) return;
      job.currentGid = currentGid;
      job.consecutivePollErrors = 0;

      const errorCode = status.errorCode ?? initialStatus.errorCode;
      if (status.status === 'error' || initialStatus.status === 'error' || (errorCode && errorCode !== '0')) {
        await failJob(job, new Error(status.errorMessage || initialStatus.errorMessage || 'The torrent download failed.'));
        return;
      }

      const totalBytes = parseNonNegativeNumber(status.totalLength);
      const downloadedBytes = parseNonNegativeNumber(status.completedLength);
      const isMetadataFile = !followedGid && initialStatus.status === 'complete' &&
        initialStatus.files?.some(file => path.basename(file.path || '').startsWith('[METADATA]'));
      const isComplete = !isMetadataFile && (
        status.status === 'complete' ||
        (totalBytes > 0 && downloadedBytes >= totalBytes)
      );
      const progress = totalBytes > 0
        ? Math.min(100, downloadedBytes / totalBytes * 100)
        : null;
      const progressData = {
        title: getStatusTitle(status, getStatusTitle(initialStatus, 'Torrent download')),
        progress,
        downloadedBytes,
        totalBytes,
        downloadSpeed: parseNonNegativeNumber(status.downloadSpeed),
        uploadSpeed: parseNonNegativeNumber(status.uploadSpeed),
        peers: parseNonNegativeNumber(status.connections)
      };

      if (isComplete) {
        if (!job.seedOnComplete) {
          emit(job, 'completed', progressData);
          try {
            await closeJob(job);
          } catch (error) {
            emit(job, 'error', { ...progressData, error: `Download completed, but the torrent engine could not be stopped: ${String(error)}` });
          }
          return;
        }
        emit(job, 'seeding', progressData);
        return;
      }

      emit(job, 'downloading', progressData);
    } catch (error) {
      job.consecutivePollErrors += 1;
      if (job.consecutivePollErrors >= 3) {
        await failJob(job, error instanceof Error ? error : new Error(String(error)));
      } else {
        console.warn('Unable to read torrent download status; retrying', error);
      }
    } finally {
      job.polling = false;
    }
  }

  return {
    getProgress() {
      return lastProgress;
    },

    async start(sourceValue: unknown, mediaLibraryPath: unknown, seedOnComplete: unknown) {
      if (activeJob) throw new Error('A torrent download is already active.');
      if (typeof mediaLibraryPath !== 'string' || !mediaLibraryPath.trim()) {
        throw new Error('Set the media library location in Config before downloading.');
      }
      if (typeof seedOnComplete !== 'boolean') {
        throw new Error('Invalid seeding preference.');
      }

      const source = await validateTorrentSource(sourceValue);
      let mediaLibraryDirectory: string;
      try {
        mediaLibraryDirectory = await fs.promises.realpath(path.resolve(mediaLibraryPath));
        if (!(await fs.promises.stat(mediaLibraryDirectory)).isDirectory()) {
          throw new Error('The media library location is not a folder.');
        }
      } catch (error) {
        throw new Error(`Unable to access the media library location: ${String(error)}`);
      }

      const outputDirectory = path.join(mediaLibraryDirectory, 'Torrent Downloads');
      await fs.promises.mkdir(outputDirectory, { recursive: true });

      const preparedTorrent = source.kind === 'torrent-url'
        ? await downloadTorrentFile(source.url)
        : null;
      const engine = await createEngine().catch(async error => {
        if (preparedTorrent) {
          await fs.promises.rm(preparedTorrent.temporaryDirectory, { recursive: true, force: true });
        }
        throw error;
      });
      let gid: string;
      try {
        gid = await engine.add(preparedTorrent?.source ?? source, outputDirectory);
      } catch (error) {
        await engine.close();
        throw error;
      } finally {
        if (preparedTorrent) {
          await fs.promises.rm(preparedTorrent.temporaryDirectory, { recursive: true, force: true });
        }
      }

      let removeExitListener = () => {};
      const job = {
        id: randomUUID(),
        gid,
        currentGid: gid,
        source,
        outputDirectory,
        seedOnComplete,
        engine,
        timer: setInterval(() => { void pollJob(job); }, POLL_INTERVAL_MS),
        removeExitListener,
        polling: false,
        consecutivePollErrors: 0
      } satisfies ActiveJob;
      activeJob = job;
      removeExitListener = engine.onExit(error => { void failJob(job, error); });
      job.removeExitListener = removeExitListener;
      emit(job, 'starting');
      void pollJob(job);
      return { jobId: job.id, outputDirectory };
    },

    async stop(jobId: unknown) {
      const job = activeJob;
      if (!job || typeof jobId !== 'string' || job.id !== jobId) {
        throw new Error('There is no matching active torrent download.');
      }

      if (activeJob === job) activeJob = null;
      clearInterval(job.timer);
      job.removeExitListener();
      let removalError: unknown;
      try {
        await job.engine.remove(job.currentGid);
        if (job.currentGid !== job.gid) await job.engine.remove(job.gid);
      } catch (error) {
        removalError = error;
      }
      try {
        await job.engine.close();
      } catch (error) {
        emit(job, 'error', { error: `Unable to stop torrent engine: ${String(error)}` });
        throw error;
      }
      emit(job, 'stopped');
      if (removalError) console.warn('Torrent engine could not remove the task before shutdown', removalError);
      return { stopped: true };
    },

    dispose() {
      const job = activeJob;
      if (!job) return;
      activeJob = null;
      clearInterval(job.timer);
      job.removeExitListener();
      void job.engine.close().catch(error => {
        console.warn('Unable to close torrent download engine during shutdown', error);
      });
    }
  };
}

export function getAria2Arguments(port: number, secret: string, platform = process.platform) {
  const args = [
    '--enable-rpc=true',
    '--rpc-listen-all=false',
    `--rpc-listen-port=${port}`,
    `--rpc-secret=${secret}`,
    '--console-log-level=warn',
    '--summary-interval=0',
    '--max-concurrent-downloads=1'
  ];
  if (platform === 'win32') args.push('--file-allocation=prealloc');
  return args;
}

function reserveLocalPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a local torrent RPC port.'));
        return;
      }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

export async function createAria2TorrentEngine(binaryPath: string): Promise<TorrentDownloadEngine> {
  if (!path.isAbsolute(binaryPath) || !fs.existsSync(binaryPath)) {
    throw new Error('The bundled aria2 torrent engine is not available.');
  }

  const port = await reserveLocalPort();
  const secret = randomBytes(32).toString('hex');
  const child = spawn(binaryPath, getAria2Arguments(port, secret), { stdio: 'ignore', windowsHide: true });
  let childExited = false;
  let childError: Error | null = null;
  const exitListeners = new Set<(error: Error) => void>();
  child.once('error', error => {
    childExited = true;
    childError = error;
    exitListeners.forEach(listener => listener(error));
  });
  child.once('exit', code => {
    childExited = true;
    if (code !== 0) {
      const error = new Error(`aria2 exited unexpectedly${code === null ? '' : ` with code ${code}`}.`);
      childError = error;
      exitListeners.forEach(listener => listener(error));
    }
  });

  const rpcUrl = `http://127.0.0.1:${port}/jsonrpc`;
  let requestId = 0;
  const request = async <T>(method: string, params: unknown[] = []): Promise<T> => {
    if (childExited) throw childError || new Error('The aria2 torrent engine is not running.');
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: String(++requestId),
        method: `aria2.${method}`,
        params: [`token:${secret}`, ...params]
      }),
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) throw new Error(`aria2 RPC returned HTTP ${response.status}.`);
    const result: unknown = await response.json();
    if (!isRecord(result)) throw new Error('aria2 RPC returned an invalid response.');
    if (isRecord(result.error)) {
      throw new Error(typeof result.error.message === 'string' ? result.error.message : 'aria2 RPC request failed.');
    }
    if (!('result' in result)) throw new Error('aria2 RPC response did not contain a result.');
    return result.result as T;
  };

  const engine: TorrentDownloadEngine = {
    async add(source, outputDirectory) {
      const options = { dir: outputDirectory, 'check-integrity': 'true', 'auto-file-renaming': 'true' };
      if (source.kind === 'magnet') {
        return request<string>('addUri', [[source.uri], options]);
      }
      if (source.kind === 'torrent-url') {
        throw new Error('Remote .torrent URLs must be downloaded before they can be added.');
      }
      const torrentData = (await fs.promises.readFile(source.path)).toString('base64');
      return request<string>('addTorrent', [torrentData, [], options]);
    },

    getStatus(gid) {
      return request<TorrentEngineStatus>('tellStatus', [gid, [
        'status',
        'totalLength',
        'completedLength',
        'downloadSpeed',
        'uploadSpeed',
        'connections',
        'errorCode',
        'errorMessage',
        'followedBy',
        'bittorrent',
        'files'
      ]]);
    },

    async remove(gid) {
      await request('forceRemove', [gid]);
    },

    async close() {
      if (childExited) return;
      child.kill();
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 2000))
      ]);
    },

    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    }
  };

  const deadline = Date.now() + RPC_START_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (childExited) {
      await engine.close();
      throw childError || new Error('aria2 exited before its RPC service became ready.');
    }
    try {
      await request('getVersion');
      return engine;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  await engine.close();
  throw new Error(`Unable to start aria2 RPC service: ${String(lastError)}`);
}
