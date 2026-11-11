import type { ElectronApiBridge } from '../../electron/electronApi';
import type { Track } from '../types';

export function musicFileUrl(filePath: string) {
  return `music://local/${encodeURIComponent(filePath)}`;
}

export function localFileUrl(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `file:///${encodeURI(normalizedPath)}`;
}

export function decodeBase64Bytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function decodeBase64Blob(base64: string, mime = 'application/octet-stream') {
  return new Blob([decodeBase64Bytes(base64)], { type: mime });
}

export function getTrackMediaSource(track: Track, hasElectronApi: boolean) {
  if (track.src) return track.src;
  if (!track.path) return undefined;
  return hasElectronApi ? musicFileUrl(track.path) : localFileUrl(track.path);
}

export function resolveBackingTrackCandidates(filePath: string, outputRoot?: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const directory = normalizedPath.replace(/\/[^/]*$/, '');
  const baseName = (normalizedPath.split('/').pop() || '').replace(/\.[^/.]+$/, '');
  const candidates: string[] = [];

  if (outputRoot?.trim()) {
    const normalizedRoot = outputRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const rootPrefix = `${normalizedRoot}/`;
    if (normalizedPath.toLocaleLowerCase().startsWith(rootPrefix.toLocaleLowerCase())) {
      const relativePath = normalizedPath.slice(rootPrefix.length);
      const relativeDirectory = relativePath.replace(/\/[^/]*$/, '');
      const sourceDirectories = relativeDirectory.split('/').filter(Boolean);
      const sourceType = /^(music|video)$/i.test(sourceDirectories[0] || '')
        ? sourceDirectories[0][0].toLocaleUpperCase() + sourceDirectories[0].slice(1).toLocaleLowerCase()
        : undefined;
      if (/^(?:music|video|karaoke)$/i.test(sourceDirectories[0] || '')) sourceDirectories.shift();
      const outputRelativeDirectory = sourceDirectories.join('/');
      const sourceOutputDirectory = sourceType
        ? `${sourceType}_Accompaniments`
        : 'Accompaniments';
      const outputDirectory = [
        normalizedRoot,
        sourceOutputDirectory,
        outputRelativeDirectory
      ].filter(Boolean).join('/');
      const legacyOutputDirectory = `${normalizedRoot}/Accompaniments/${relativeDirectory}`;
      candidates.push(
        `${outputDirectory}/${baseName}.wav`,
        `${outputDirectory}/${baseName}_backingtrack.wav`,
        `${outputDirectory}/${baseName}_backingtrack.mp3`,
        `${legacyOutputDirectory}/${baseName}_backingtrack.wav`,
        `${legacyOutputDirectory}/${baseName}_backingtrack.mp3`
      );
    }
  }

  candidates.push(
    `${directory}/${baseName}_backingtrack.mp3`,
    `${directory}/${baseName}_backingtrack.wav`
  );
  return [...new Set(candidates)];
}

export type PrepareTrackSourceResult =
  | { status: 'ready'; src: string; backingMime?: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

type PrepareTrackSourceOptions = {
  track: Track;
  useBackingTrack: boolean;
  backingOutputRoot?: string;
  api: ElectronApiBridge | undefined;
  isStale: () => boolean;
  readRequestIdRef: { current: Record<string, number> };
  createMediaObjectUrl: (blob: Blob) => string | null;
  updateTrackSource: (trackId: string, src: string) => void;
  updateTrack: (trackId: string, update: Partial<Track>) => void;
  log: (message: string) => void;
  appendLog: (message: string) => void;
};

function nextReadRequestId(requests: Record<string, number>, path: string) {
  const requestId = (requests[path] || 0) + 1;
  requests[path] = requestId;
  return requestId;
}

export async function prepareTrackSource({
  track,
  useBackingTrack,
  backingOutputRoot,
  api,
  isStale,
  readRequestIdRef,
  createMediaObjectUrl,
  updateTrackSource,
  updateTrack,
  log,
  appendLog
}: PrepareTrackSourceOptions): Promise<PrepareTrackSourceResult> {
  let backingPath: string | undefined;
  let backingMime: string | undefined;

  if (useBackingTrack) {
    if (!track.path || !api?.stat || !api.readFile) {
      return {
        status: 'failed',
        message: `Cannot locate backing track for ${track.name}: source path or file access is unavailable`
      };
    }

    const candidates = resolveBackingTrackCandidates(track.path, backingOutputRoot);
    for (const candidate of candidates) {
      try {
        const result = await api.stat(candidate);
        if (isStale()) return { status: 'cancelled' };
        if (result?.ok && result.isFile) {
          backingPath = candidate;
          break;
        }
      } catch (error) {
        console.warn(`Backing track check failed for ${candidate}`, error);
      }
    }

    if (!backingPath) {
      return {
        status: 'failed',
        message: `Backing track not found for ${track.name}. Checked: ${candidates.join(', ')}`
      };
    }

    if (track.backingSrc) {
      backingPath = track.backingSrc;
      backingMime = track.backingMime || 'audio/mpeg';
    } else {
      try {
        backingMime = backingPath.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
        const result = await api.readFile(backingPath);
        if (isStale()) return { status: 'cancelled' };
        if (!result?.ok || !result.data) {
          throw new Error(result?.error || 'empty file response');
        }
        const backingSrc = createMediaObjectUrl(decodeBase64Blob(result.data, backingMime));
        if (!backingSrc) return { status: 'cancelled' };
        backingPath = backingSrc;
        updateTrack(track.id, { backingSrc, backingMime, backingActive: true });
      } catch (error) {
        const message = `Unable to load backing track for ${track.name}: ${String(error)}`;
        return { status: 'failed', message };
      }
    }
  }

  let src: string | undefined;
  if (backingPath) {
    src = backingPath.startsWith('blob:') ? backingPath : musicFileUrl(backingPath);
    log(`Playing backing track for ${track.name}: ${src}`);
  } else {
    src = getTrackMediaSource(track, !!api);
  }

  const sourcePath = track.path;
  if (src?.startsWith('file://') && sourcePath && api?.readFile) {
    const requestId = nextReadRequestId(readRequestIdRef.current, sourcePath);
    try {
      const result = await api.readFile(sourcePath);
      if (isStale()) return { status: 'cancelled' };
      if (readRequestIdRef.current[sourcePath] !== requestId) {
        log(`stale recreate readFile result ignored for ${sourcePath}`);
      } else if (result?.ok && result.data) {
        const url = createMediaObjectUrl(decodeBase64Blob(result.data, result.mime));
        if (!url) return { status: 'cancelled' };
        src = url;
        updateTrackSource(track.id, url);
      } else {
        log(`readFile failed for ${sourcePath}: ${result?.error || 'unknown'}`);
      }
    } catch (error) {
      log(`readFile exception ${String(error)}`);
    }
  }

  if (!src) return { status: 'failed', message: `Unable to play ${track.name}: no audio source or file path is available.` };

  if (!useBackingTrack && src.startsWith('blob:')) {
    if (track.file) {
      try {
        const url = createMediaObjectUrl(track.file);
        if (!url) return { status: 'cancelled' };
        src = url;
        updateTrackSource(track.id, url);
        log(`Recreated blob URL for ${track.name}`);
        appendLog(`Recreated blob URL for ${track.name}`);
      } catch (error) {
        log(`recreate blob error ${String(error)}`);
      }
    } else if (track.path && api?.readFile) {
      const requestId = nextReadRequestId(readRequestIdRef.current, track.path);
      try {
        const result = await api.readFile(track.path);
        if (isStale()) return { status: 'cancelled' };
        if (readRequestIdRef.current[track.path] !== requestId) {
          log(`stale recreate readFile result ignored for ${track.path}`);
        } else if (result?.ok && result.data) {
          const url = createMediaObjectUrl(decodeBase64Blob(result.data, result.mime));
          if (!url) return { status: 'cancelled' };
          src = url;
          updateTrackSource(track.id, url);
          log(`Recreated blob URL from disk for ${track.name}`);
        }
      } catch (error) {
        log(`readFile recreate error ${String(error)}`);
      }
    }
  }

  return { status: 'ready', src, backingMime };
}
