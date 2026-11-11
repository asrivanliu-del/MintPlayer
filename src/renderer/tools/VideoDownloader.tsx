import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  hasElectronCapability,
  type ElectronTorrentDownloadProgress,
  type ElectronTorrentSource,
  type ElectronVideoDownloadProgress,
  type ElectronVideoFormat,
  type ElectronVideoMediaInfo,
  type ElectronVideoPlaylistEntry,
  type ElectronVideoSearchResult
} from '../../electron/electronApi';
import { getMp3ConversionEstimate, getSourceAudioBitrate, recommendAudioFormats } from './audioFormatRecommendations';
import { addRecentVideoUrl, MEDIA_DOWNLOADER_RECENTS_KEY, parseRecentVideoUrls, type RecentVideoUrl } from './mediaDownloaderHistory';
import { isAiUpscaledVideoFormat } from './videoFormatUtils';
import { recommendVideoFormats } from './videoFormatRecommendations';

function formatFileSize(fileSize: number | null) {
  if (fileSize === null || fileSize <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = fileSize;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function logVideoDownload(message: string, onLog?: (entry: string) => void) {
  const entry = `[Media Downloader] ${message}`;
  onLog?.(entry);
  console.info(entry);
  const appendLog = window.electronAPI?.appendLog;
  if (typeof appendLog !== 'function') return;
  void appendLog(entry).then(response => {
    if (!response.ok) console.warn('Unable to persist Media Downloader log', response.error);
  }).catch(error => {
    console.warn('Unable to persist Media Downloader log', error);
  });
}

type PlaylistDownloadChoice =
  | { kind: 'audio'; format: ElectronVideoFormat; convertToMp3: boolean }
  | { kind: 'video'; format: ElectronVideoFormat; audioFormatId: string | null };

function AudioRecommendations({
  formats,
  activeDownload,
  onDownload,
  selectedChoice,
  onSelect
}: {
  formats: ElectronVideoFormat[];
  activeDownload: string | null;
  onDownload: (format: ElectronVideoFormat, convertToMp3: boolean) => void;
  selectedChoice?: PlaylistDownloadChoice;
  onSelect?: (choice: PlaylistDownloadChoice) => void;
}) {
  const recommendations = recommendAudioFormats(formats);
  return (
    <section aria-label="Audio formats" style={{ marginTop: 16 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem' }}>Top 3 audio recommendations</h2>
      <p style={{ margin: '0 0 8px', color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>
        Approximate codec-equivalent MP3 bitrate (Opus: about 2×, capped at 320 kbps). This is only an encoding estimate; conversion cannot restore lost source audio quality.
      </p>
      {recommendations.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
          {recommendations.map((format, index) => {
            const mp3 = getMp3ConversionEstimate(format);
            const sourceBitrate = getSourceAudioBitrate(format);
            return (
              <article
                key={`audio:${format.formatId}`}
                aria-label={`Audio recommendation ${index + 1}: format ${format.formatId}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minWidth: 0,
                  padding: 10,
                  border: '1px solid rgba(190,218,196,0.13)',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)'
                }}
              >
                <div>
                  <div style={{ color: '#a4e8d1', fontSize: 12, fontWeight: 700 }}>RECOMMENDATION {index + 1}</div>
                  <h3 style={{ margin: '4px 0 0', fontSize: '1rem' }}>
                    {format.formatId} · {format.extension.toUpperCase()}
                  </h3>
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 8px', margin: 0, fontSize: 12 }}>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Codec</dt>
                  <dd style={{ margin: 0 }}>{format.audioCodec || '—'}</dd>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Bitrate</dt>
                  <dd style={{ margin: 0 }}>{sourceBitrate === null ? '—' : `~${Math.round(sourceBitrate)} kbps`}</dd>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Sample rate</dt>
                  <dd style={{ margin: 0 }}>
                    {format.sampleRate == null ? '—' : `${(format.sampleRate / 1000).toFixed(format.sampleRate % 1000 ? 1 : 0)} kHz`}
                  </dd>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Channels</dt>
                  <dd style={{ margin: 0 }}>
                    {format.audioChannels == null ? '—' : format.audioChannels === 1 ? 'Mono' : `${format.audioChannels} channels`}
                  </dd>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Size</dt>
                  <dd style={{ margin: 0 }}>{formatFileSize(format.fileSize)}</dd>
                </dl>
                <p style={{ margin: 0, fontSize: 12 }}>
                  <span style={{ color: 'rgba(245,247,251,0.62)' }}>MP3 estimate: </span>
                  {mp3
                    ? `${mp3.bitrate} kbps${mp3.sampleRate ? ` · ${(mp3.sampleRate / 1000).toFixed(mp3.sampleRate % 1000 ? 1 : 0)} kHz` : ''}${mp3.channels ? ` · ${mp3.channels === 1 ? 'Mono' : 'Stereo'}` : ''}${mp3.fileSize ? ` · ~${formatFileSize(mp3.fileSize)}` : ''}`
                    : 'Unavailable'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 'auto' }}>
                  <button
                    type="button"
                    aria-label={onSelect
                      ? `Select ${format.extension.toUpperCase()} format ${format.formatId} for download`
                      : `Download ${format.extension.toUpperCase()} format ${format.formatId}`}
                    aria-pressed={onSelect
                      ? selectedChoice?.kind === 'audio' && selectedChoice.format.formatId === format.formatId && !selectedChoice.convertToMp3
                      : undefined}
                    disabled={activeDownload !== null}
                    onClick={() => onSelect
                      ? onSelect({ kind: 'audio', format, convertToMp3: false })
                      : onDownload(format, false)}
                    style={{ padding: '6px 9px' }}
                  >
                    {onSelect
                      ? selectedChoice?.kind === 'audio' && selectedChoice.format.formatId === format.formatId && !selectedChoice.convertToMp3
                        ? 'Selected'
                        : 'Use this format'
                      : activeDownload === `${format.formatId}:original` ? 'Downloading...' : `Download ${format.extension.toUpperCase()}`}
                  </button>
                  <button
                    type="button"
                    aria-label={onSelect ? `Select MP3 format ${format.formatId} for download` : `Download MP3 format ${format.formatId}`}
                    aria-pressed={onSelect
                      ? selectedChoice?.kind === 'audio' && selectedChoice.format.formatId === format.formatId && selectedChoice.convertToMp3
                      : undefined}
                    disabled={activeDownload !== null}
                    onClick={() => onSelect
                      ? onSelect({ kind: 'audio', format, convertToMp3: true })
                      : onDownload(format, true)}
                    style={{ padding: '6px 9px' }}
                  >
                    {onSelect
                      ? selectedChoice?.kind === 'audio' && selectedChoice.format.formatId === format.formatId && selectedChoice.convertToMp3
                        ? 'Selected'
                        : 'Use for MP3'
                      : activeDownload === `${format.formatId}:mp3` ? 'Converting...' : 'Download MP3'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: 0, color: 'rgba(245,247,251,0.62)' }}>No audio formats are available.</p>
      )}
    </section>
  );
}

function VideoRecommendations({
  formats,
  includeAiUpscaled,
  audioFormat,
  activeDownload,
  onDownload,
  selectedChoice,
  onSelect
}: {
  formats: ElectronVideoFormat[];
  includeAiUpscaled: boolean;
  audioFormat: ElectronVideoFormat | null;
  activeDownload: string | null;
  onDownload: (format: ElectronVideoFormat, audioFormatId: string | null) => void;
  selectedChoice?: PlaylistDownloadChoice;
  onSelect?: (choice: PlaylistDownloadChoice) => void;
}) {
  const recommendations = recommendVideoFormats(formats, includeAiUpscaled);
  return (
    <section aria-label="Video formats" style={{ marginTop: 16 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>Top 3 video recommendations</h2>
      {recommendations.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
          {recommendations.map((format, index) => {
            const needsAudio = !format.hasAudio;
            const cannotAddAudio = needsAudio && audioFormat === null;
            const downloadKey = `${format.formatId}:mp4`;
            return (
              <article
                key={`video:${format.formatId}`}
                aria-label={`Video recommendation ${index + 1}: format ${format.formatId}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minWidth: 0,
                  padding: 10,
                  border: '1px solid rgba(190,218,196,0.13)',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)'
                }}
              >
                <div>
                  <div style={{ color: '#a4e8d1', fontSize: 12, fontWeight: 700 }}>RECOMMENDATION {index + 1}</div>
                  <h3 style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '4px 0 0', fontSize: '1rem' }}>
                    {format.formatId} · {format.extension.toUpperCase()}
                    {isAiUpscaledVideoFormat(format) && (
                      <span
                        aria-label="AI-upscaled"
                        style={{ padding: '2px 6px', borderRadius: 999, background: 'rgba(141,217,193,0.16)', color: '#a4e8d1', fontSize: 11, fontWeight: 700 }}
                      >
                        AI-upscaled
                      </span>
                    )}
                  </h3>
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 8px', margin: 0, fontSize: 12 }}>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Resolution</dt>
                  <dd style={{ margin: 0 }}>{[format.resolution, format.note].filter(Boolean).join(' · ') || '—'}</dd>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Video codec</dt>
                  <dd style={{ margin: 0 }}>{format.videoCodec || '—'}</dd>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Audio</dt>
                  <dd style={{ margin: 0 }}>{format.hasAudio ? '有聲音' : '無聲音'}</dd>
                  <dt style={{ color: 'rgba(245,247,251,0.62)' }}>Size</dt>
                  <dd style={{ margin: 0 }}>{formatFileSize(format.fileSize)}</dd>
                </dl>
                <div style={{ marginTop: 'auto' }}>
                  <button
                    type="button"
                    aria-label={onSelect
                      ? `Select MP4 format ${format.formatId} for download`
                      : `Download MP4 format ${format.formatId}`}
                    aria-pressed={onSelect
                      ? selectedChoice?.kind === 'video' && selectedChoice.format.formatId === format.formatId
                      : undefined}
                    title={cannotAddAudio ? 'No audio format is available to combine.' : undefined}
                    disabled={activeDownload !== null || cannotAddAudio}
                    onClick={() => {
                      const audioFormatId = needsAudio ? audioFormat?.formatId ?? null : null;
                      if (onSelect) onSelect({ kind: 'video', format, audioFormatId });
                      else onDownload(format, audioFormatId);
                    }}
                    style={{ padding: '6px 9px' }}
                  >
                    {onSelect
                      ? selectedChoice?.kind === 'video' && selectedChoice.format.formatId === format.formatId
                        ? 'Selected'
                        : 'Use this format'
                      : activeDownload === downloadKey ? 'Downloading...' : 'Download MP4'}
                  </button>
                  {needsAudio && (
                    <p style={{ margin: '8px 0 0', color: 'rgba(245,247,251,0.62)', fontSize: 12 }}>
                      {audioFormat
                        ? `Combines with audio recommendation 1 (${audioFormat.formatId}).`
                        : 'Cannot add audio: no audio format is available.'}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: 0, color: 'rgba(245,247,251,0.62)' }}>No video formats are available.</p>
      )}
    </section>
  );
}

function formatTorrentBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function TorrentDownloader({
  mediaLibraryPath,
  onBack
}: {
  mediaLibraryPath: string;
  onBack: () => void;
}) {
  const [sourceKind, setSourceKind] = useState<'link' | 'torrent'>('link');
  const [magnetUri, setMagnetUri] = useState('');
  const [torrentPath, setTorrentPath] = useState('');
  const [seedOnComplete, setSeedOnComplete] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ElectronTorrentDownloadProgress | null>(null);
  const [error, setError] = useState('');
  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId;
  const progressJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    let disposed = false;
    let receivedEvent = false;
    const applyProgress = (nextProgress: ElectronTorrentDownloadProgress) => {
      receivedEvent = true;
      if (!jobIdRef.current) {
        jobIdRef.current = nextProgress.jobId;
        setJobId(nextProgress.jobId);
      }
      if (nextProgress.jobId !== jobIdRef.current) return;
      progressJobIdRef.current = nextProgress.jobId;
      setProgress(nextProgress);
      setError(nextProgress.status === 'error' ? nextProgress.error || 'The torrent download failed.' : '');
    };

    const removeProgressListener = hasElectronCapability(api, 'onTorrentDownloadProgress')
      ? api.onTorrentDownloadProgress(applyProgress)
      : () => undefined;
    if (hasElectronCapability(api, 'getTorrentDownloadProgress')) {
      void api.getTorrentDownloadProgress().then(response => {
        if (disposed || receivedEvent) return;
        if (!response.ok) {
          setError(response.error);
          return;
        }
        const currentProgress = response.progress;
        if (!currentProgress) return;
        jobIdRef.current = currentProgress.jobId;
        progressJobIdRef.current = currentProgress.jobId;
        setJobId(currentProgress.jobId);
        setProgress(currentProgress);
        setError(currentProgress.status === 'error' ? currentProgress.error || 'The torrent download failed.' : '');
      }).catch(requestError => {
        if (!disposed) setError(`Unable to restore torrent download status: ${String(requestError)}`);
      });
    }

    return () => {
      disposed = true;
      removeProgressListener();
    };
  }, []);

  async function chooseTorrentFile() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseTorrentFile')) {
      setError('Selecting torrent files is unavailable outside the desktop app.');
      return;
    }

    try {
      const result = await api.chooseTorrentFile();
      if (result.canceled) {
        if (result.error) setError(result.error);
        return;
      }
      if (!result.path) {
        setError('No torrent file was selected.');
        return;
      }
      setTorrentPath(result.path);
      setError('');
    } catch (requestError) {
      setError(`Unable to select a torrent file: ${String(requestError)}`);
    }
  }

  async function startDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mediaLibraryPath.trim()) {
      setError('Set the media library location in Config before downloading.');
      return;
    }

    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'startTorrentDownload')) {
      setError('Torrent downloading is unavailable outside the desktop app.');
      return;
    }

    const enteredLink = magnetUri.trim();
    const source: ElectronTorrentSource = sourceKind === 'torrent'
      ? { kind: 'torrent', path: torrentPath }
      : /^magnet:/i.test(enteredLink)
        ? { kind: 'magnet', uri: enteredLink }
        : { kind: 'torrent-url', url: enteredLink };
    setError('');
    setProgress(null);
    setJobId(null);
    jobIdRef.current = null;
    progressJobIdRef.current = null;
    setIsStarting(true);
    try {
      const response = await api.startTorrentDownload(source, seedOnComplete);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      jobIdRef.current = response.jobId;
      setJobId(response.jobId);
      if (progressJobIdRef.current !== response.jobId) {
        const sourceName = source.kind === 'torrent'
          ? source.path.split(/[\\/]/).pop()?.replace(/\.torrent$/i, '')
          : source.kind === 'torrent-url'
            ? source.url.split(/[/?#]/).filter(Boolean).pop()?.replace(/\.torrent$/i, '')
            : null;
        setProgress({
          jobId: response.jobId,
          title: sourceName || 'Torrent download',
          status: 'starting',
          progress: null,
          downloadedBytes: 0,
          totalBytes: 0,
          downloadSpeed: 0,
          uploadSpeed: 0,
          peers: 0,
          outputDirectory: response.outputDirectory
        });
      }
    } catch (requestError) {
      setError(`Unable to start torrent download: ${String(requestError)}`);
    } finally {
      setIsStarting(false);
    }
  }

  async function stopDownload() {
    if (!jobId) return;
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'stopTorrentDownload')) {
      setError('Stopping torrent downloads is unavailable outside the desktop app.');
      return;
    }

    setIsStopping(true);
    setError('');
    try {
      const response = await api.stopTorrentDownload(jobId);
      if (!response.ok) setError(response.error);
    } catch (requestError) {
      setError(`Unable to stop torrent download: ${String(requestError)}`);
    } finally {
      setIsStopping(false);
    }
  }

  const isActive = isStarting || progress?.status === 'starting' ||
    progress?.status === 'downloading' || progress?.status === 'seeding';
  const statusLabel = progress?.status === 'starting' ? 'Starting…'
    : progress?.status === 'downloading' ? 'Downloading'
      : progress?.status === 'seeding' ? 'Seeding'
        : progress?.status === 'completed' ? 'Completed'
          : progress?.status === 'stopped' ? 'Stopped'
            : progress?.status === 'error' ? 'Failed' : '';

  return (
    <div className="video-downloader torrent-downloader" style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0, height: '100%', overflowY: 'auto' }}>
      <h1 style={{ margin: '0 0 12px', color: '#f5f7fb', fontSize: '1.4rem' }}>Media Downloader</h1>
      <div role="group" aria-label="Download type" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" aria-pressed="false" disabled={isActive} onClick={onBack}>
          Video
        </button>
        <button type="button" aria-pressed="true" disabled>
          Torrent
        </button>
      </div>
      <section aria-label="Torrent download" style={{ width: '100%', maxWidth: 760, padding: 16, border: '1px solid rgba(190,218,196,0.16)', borderRadius: 12, background: 'rgba(255,255,255,0.03)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>Add torrent</h2>
        <p style={{ margin: '0 0 14px', color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>
          Downloads are saved in the media library’s <strong>Torrent Downloads</strong> folder.
        </p>
        <p role="note" style={{ margin: '0 0 14px', padding: 10, border: '1px solid rgba(245,190,115,0.24)', borderRadius: 8, background: 'rgba(245,190,115,0.06)', color: 'rgba(255,230,190,0.88)', fontSize: 12 }}>
          Torrent peers can see your IP address. Piece checks verify data against the torrent metadata, but do not verify the source or scan files for malware. Use trusted sources and check the publisher’s SHA-256 or GPG signature when available.
        </p>
        <div role="group" aria-label="Torrent source type" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" aria-pressed={sourceKind === 'link'} disabled={isActive} onClick={() => setSourceKind('link')}>
            Magnet / .torrent URL
          </button>
          <button type="button" aria-pressed={sourceKind === 'torrent'} disabled={isActive} onClick={() => setSourceKind('torrent')}>
            .torrent file
          </button>
        </div>
        <form onSubmit={event => void startDownload(event)} style={{ display: 'grid', gap: 12 }}>
          {sourceKind === 'link' ? (
            <label style={{ display: 'grid', gap: 6, color: '#eef2ff' }}>
              Magnet link or .torrent URL
              <input
                type="text"
                aria-label="Magnet link or .torrent URL"
                value={magnetUri}
                onChange={event => setMagnetUri(event.currentTarget.value)}
                placeholder="magnet:?xt=urn:btih:... or https://example.com/file.torrent"
                disabled={isActive}
                required
                style={{ boxSizing: 'border-box', width: '100%' }}
              />
            </label>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <button type="button" onClick={() => void chooseTorrentFile()} disabled={isActive}>
                Choose .torrent file
              </button>
              <span aria-live="polite" style={{ color: 'rgba(245,247,251,0.68)', overflowWrap: 'anywhere', fontSize: 13 }}>
                {torrentPath || 'No file selected'}
              </span>
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#eef2ff' }}>
            <input
              type="checkbox"
              checked={seedOnComplete}
              onChange={event => setSeedOnComplete(event.currentTarget.checked)}
              disabled={isActive}
            />
            Continue seeding after download completes
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="submit" disabled={isActive || isStarting || (sourceKind === 'torrent' && !torrentPath)}>
              {isStarting ? 'Starting…' : 'Start download'}
            </button>
            {isActive && (
              <button type="button" onClick={() => void stopDownload()} disabled={isStopping}>
                {isStopping ? 'Stopping…' : 'Stop download'}
              </button>
            )}
          </div>
        </form>
        {error && <p role="alert" style={{ margin: '12px 0 0', color: '#ffb2b2' }}>{error}</p>}
      </section>
      {progress && (
        <section aria-label="Torrent download progress" aria-live="polite" style={{ width: '100%', maxWidth: 760, marginTop: 14, padding: 16, border: '1px solid rgba(190,218,196,0.16)', borderRadius: 12, background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ overflowWrap: 'anywhere' }}>{progress.title}</strong>
            <span>{statusLabel}{progress.progress === null ? '' : ` · ${progress.progress.toFixed(1)}%`}</span>
          </div>
          <progress
            aria-label="Torrent download progress"
            max={100}
            value={progress.progress ?? undefined}
            style={{ width: '100%', marginTop: 10, accentColor: '#8dd9c1' }}
          />
          <p style={{ margin: '8px 0 0', color: 'rgba(245,247,251,0.7)', fontSize: 13 }}>
            {formatTorrentBytes(progress.downloadedBytes)}
            {progress.totalBytes > 0 ? ` / ${formatTorrentBytes(progress.totalBytes)}` : ''}
            {' · '}{formatTorrentBytes(progress.downloadSpeed)}/s
            {progress.peers > 0 ? ` · ${progress.peers} peers` : ''}
          </p>
          {progress.status === 'seeding' && (
            <p style={{ margin: '6px 0 0', color: 'rgba(245,247,251,0.7)', fontSize: 13 }}>
              Uploading at {formatTorrentBytes(progress.uploadSpeed)}/s
            </p>
          )}
          <p style={{ margin: '8px 0 0', color: 'rgba(245,247,251,0.55)', fontSize: 12, overflowWrap: 'anywhere' }}>
            Saved to {progress.outputDirectory}
          </p>
        </section>
      )}
    </div>
  );
}

export default function VideoDownloader({
  showThumbnail = true,
  mediaLibraryPath = '',
  onLog
}: {
  showThumbnail?: boolean;
  mediaLibraryPath?: string;
  onLog?: (entry: string) => void;
}) {
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const [downloaderMode, setDownloaderMode] = useState<'video' | 'torrent'>('video');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    youtube: ElectronVideoSearchResult[];
    bilibili: ElectronVideoSearchResult[];
    errors?: { youtube?: string; bilibili?: string };
  } | null>(null);
  const [searchError, setSearchError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [url, setUrl] = useState('');
  const [includeAiUpscaled, setIncludeAiUpscaled] = useState(false);
  const [recentUrls, setRecentUrls] = useState<RecentVideoUrl[]>(() => {
    try {
      return parseRecentVideoUrls(localStorage.getItem(MEDIA_DOWNLOADER_RECENTS_KEY));
    } catch (error) {
      console.warn('Unable to load recent Media Downloader URLs', error);
      return [];
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [playlistBatchSummary, setPlaylistBatchSummary] = useState('');
  const [activeDownload, setActiveDownload] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<ElectronVideoDownloadProgress | null>(null);
  const [downloadedMedia, setDownloadedMedia] = useState<{ path: string; title: string; showFileButton?: boolean } | null>(null);
  const [playlistChoices, setPlaylistChoices] = useState<Record<number, PlaylistDownloadChoice>>({});
  const [openPlaylistEntryIndex, setOpenPlaylistEntryIndex] = useState<number | null>(null);
  const [playlistFormatStatus, setPlaylistFormatStatus] = useState<Record<number, 'loading' | 'loaded' | 'failed'>>({});
  const [playlistFormatErrors, setPlaylistFormatErrors] = useState<Record<number, string>>({});
  const [playlistItemStatus, setPlaylistItemStatus] = useState<Record<number, 'downloading' | 'downloaded' | 'failed'>>({});
  const [thumbnailError, setThumbnailError] = useState('');
  const [thumbnailStatus, setThumbnailStatus] = useState('');
  const [thumbnailDownloading, setThumbnailDownloading] = useState(false);
  const [thumbnailLoadFailed, setThumbnailLoadFailed] = useState(false);
  const [result, setResult] = useState<ElectronVideoMediaInfo | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'onVideoDownloadProgress')) return;
    return api.onVideoDownloadProgress(progress => {
      const segmentCount = progress.percent === null ? 0 : Math.round(progress.percent / 10);
      const bar = `${'='.repeat(segmentCount)}${'-'.repeat(10 - segmentCount)}`;
      logVideoDownload(`renderer received progress title=${JSON.stringify(progress.title)} percent=${progress.percent ?? 'null'} bar=${bar}`, onLogRef.current);
      setDownloadProgress(progress);
    });
  }, []);

  if (downloaderMode === 'torrent') {
    return (
      <TorrentDownloader
        mediaLibraryPath={mediaLibraryPath}
        onBack={() => setDownloaderMode('video')}
      />
    );
  }

  async function lookupFormats(urlToLookup: string) {
    if (activeDownload) return;
    setSearchResults(null);
    setSearchError('');
    setError('');
    setHistoryError('');
    setResult(null);
    setDownloadProgress(null);
    setDownloadedMedia(null);
    setPlaylistChoices({});
    setPlaylistFormatStatus({});
    setPlaylistFormatErrors({});
    setPlaylistItemStatus({});
    setPlaylistBatchSummary('');

    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'listVideoFormats')) {
      setError('Video format lookup is unavailable outside the desktop app.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.listVideoFormats(urlToLookup);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response);
      setThumbnailLoadFailed(false);
      const recentThumbnailUrl = 'entries' in response
        ? response.entries[0]?.thumbnailUrl || response.thumbnailUrl
        : response.thumbnailUrl;
      const updatedRecentUrls = addRecentVideoUrl(recentUrls, urlToLookup, response.title, recentThumbnailUrl);
      setRecentUrls(updatedRecentUrls);
      setHistoryError('');
      try {
        localStorage.setItem(MEDIA_DOWNLOADER_RECENTS_KEY, JSON.stringify(updatedRecentUrls));
      } catch (storageError) {
        console.warn('Unable to save recent Media Downloader URLs', storageError);
        setHistoryError(`Formats loaded, but recent URLs could not be saved: ${String(storageError)}`);
      }
    } catch (requestError) {
      setError(`Unable to list video formats: ${String(requestError)}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeDownload) return;
    await lookupFormats(url);
  }

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeDownload) return;
    setResult(null);
    setError('');
    setHistoryError('');
    setDownloadProgress(null);
    setDownloadedMedia(null);
    setPlaylistChoices({});
    setPlaylistFormatStatus({});
    setPlaylistFormatErrors({});
    setPlaylistItemStatus({});
    setPlaylistBatchSummary('');
    setThumbnailError('');
    setThumbnailStatus('');
    setSearchError('');
    setSearchResults(null);
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'searchVideoPlatforms')) {
      setSearchError('Video search is unavailable outside the desktop app.');
      return;
    }

    setIsSearching(true);
    try {
      const response = await api.searchVideoPlatforms(searchQuery);
      if (!response.ok) {
        setSearchError(response.error);
        return;
      }
      setSearchResults(response);
    } catch (requestError) {
      setSearchError(`Unable to search video platforms: ${String(requestError)}`);
    } finally {
      setIsSearching(false);
    }
  }

  function selectSearchResult(searchResult: ElectronVideoSearchResult) {
    setUrl(searchResult.url);
    void lookupFormats(searchResult.url);
  }

  function clearUrl() {
    setUrl('');
    setResult(null);
    setError('');
    setHistoryError('');
    setDownloadError('');
    setThumbnailError('');
    setThumbnailStatus('');
    setPlaylistBatchSummary('');
    setPlaylistChoices({});
    setPlaylistFormatStatus({});
    setPlaylistFormatErrors({});
    setPlaylistItemStatus({});
    setDownloadedMedia(null);
  }

  function selectRecentUrl(recentUrl: RecentVideoUrl) {
    setUrl(recentUrl.url);
    void lookupFormats(recentUrl.url);
  }

  async function handleOpenDownloadedMedia(target: 'folder' | 'file') {
    if (!downloadedMedia) return;
    const api = window.electronAPI;
    const capability = target === 'folder' ? 'openDownloadedMediaFolder' : 'openDownloadedMediaFile';
    if (!hasElectronCapability(api, capability)) {
      setDownloadError(`Unable to open the downloaded ${target}: this action is unavailable.`);
      return;
    }

    try {
      const response = target === 'folder'
        ? await api.openDownloadedMediaFolder(downloadedMedia.path)
        : await api.openDownloadedMediaFile(downloadedMedia.path);
      if (!response.ok) setDownloadError(`Unable to open the downloaded ${target}: ${response.error}`);
    } catch (error) {
      setDownloadError(`Unable to open the downloaded ${target}: ${String(error)}`);
    }
  }

  async function handleDownload(format: ElectronVideoFormat, convertToMp3: boolean) {
    if (!mediaLibraryPath.trim()) {
      setDownloadError('Set the media library location in Config before downloading.');
      return;
    }
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'downloadVideoFormat')) {
      setDownloadError('Video downloading is unavailable outside the desktop app.');
      return;
    }

    const downloadKey = `${format.formatId}:${convertToMp3 ? 'mp3' : 'original'}`;
    setPlaylistBatchSummary('');
    setDownloadedMedia(null);
    setActiveDownload(downloadKey);
    setDownloadProgress({ title: result?.title || 'Preparing download', percent: null });
    logVideoDownload(`download started type=${convertToMp3 ? 'mp3' : 'format'} format=${format.formatId}`, onLog);
    setDownloadError('');
    try {
      const response = await api.downloadVideoFormat(url, format.formatId, convertToMp3, mediaLibraryPath);
      if (!response.ok) {
        setDownloadError(response.error);
        return;
      }
      setDownloadedMedia({ path: response.path, title: result?.title || format.formatId });
      setDownloadProgress(null);
      logVideoDownload(`download succeeded format=${format.formatId}`, onLog);
    } catch (downloadRequestError) {
      logVideoDownload(`download failed format=${format.formatId}: ${String(downloadRequestError)}`, onLog);
      setDownloadError(`Unable to download format ${format.formatId}: ${String(downloadRequestError)}`);
    } finally {
      setActiveDownload(null);
    }
  }

  async function handleDownloadVideoMp4(format: ElectronVideoFormat, audioFormatId: string | null) {
    if (!mediaLibraryPath.trim()) {
      setDownloadError('Set the media library location in Config before downloading.');
      return;
    }
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'downloadVideoMp4')) {
      setDownloadError('MP4 video downloading is unavailable outside the desktop app.');
      return;
    }

    setDownloadedMedia(null);
    setPlaylistBatchSummary('');
    setActiveDownload(`${format.formatId}:mp4`);
    setDownloadProgress({ title: result?.title || 'Preparing download', percent: null });
    logVideoDownload(`MP4 download started videoFormat=${format.formatId} audioFormat=${audioFormatId ?? 'none'}`, onLog);
    setDownloadError('');
    try {
      const response = await api.downloadVideoMp4(url, format.formatId, audioFormatId, mediaLibraryPath);
      if (!response.ok) {
        setDownloadError(response.error);
        return;
      }
      setDownloadedMedia({ path: response.path, title: result?.title || format.formatId });
      setDownloadProgress(null);
      logVideoDownload(`MP4 download succeeded videoFormat=${format.formatId}`, onLog);
    } catch (downloadRequestError) {
      logVideoDownload(`MP4 download failed videoFormat=${format.formatId}: ${String(downloadRequestError)}`, onLog);
      setDownloadError(`Unable to download video format ${format.formatId} as MP4: ${String(downloadRequestError)}`);
    } finally {
      setActiveDownload(null);
    }
  }

  async function loadPlaylistEntryFormats(entry: ElectronVideoPlaylistEntry) {
    if (activeDownload || entry.formatsLoaded || entry.unavailableReason) return;
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'listVideoFormats')) {
      setDownloadError('Video format lookup is unavailable outside the desktop app.');
      return;
    }

    setDownloadError('');
    setPlaylistFormatErrors(current => {
      const next = { ...current };
      delete next[entry.index];
      return next;
    });
    setPlaylistFormatStatus(current => ({ ...current, [entry.index]: 'loading' }));
    setOpenPlaylistEntryIndex(entry.index);
    setActiveDownload(`playlist-format:${entry.index}`);
    logVideoDownload(`playlist format lookup started title=${JSON.stringify(entry.title)}`, onLog);
    try {
      const response = await api.listVideoFormats(entry.url);
      if (!response.ok) throw new Error(response.error);
      if ('entries' in response) {
        throw new Error('This item URL resolved to another playlist instead of a single video.');
      }

      const unavailableReason = response.formats.length === 0
        ? 'No downloadable formats are available for this item.'
        : undefined;
      setResult(current => {
        if (!current || !('entries' in current)) return current;
        return {
          ...current,
          entries: current.entries.map(currentEntry => currentEntry.index === entry.index
            ? {
              ...currentEntry,
              thumbnailUrl: response.thumbnailUrl || currentEntry.thumbnailUrl,
              formats: response.formats,
              formatsLoaded: true,
              unavailableReason
            }
            : currentEntry)
        };
      });
      setPlaylistFormatStatus(current => ({ ...current, [entry.index]: 'loaded' }));
      logVideoDownload(`playlist formats loaded title=${JSON.stringify(entry.title)} formats=${response.formats.length}`, onLog);
    } catch (error) {
      const message = String(error);
      setPlaylistFormatStatus(current => ({ ...current, [entry.index]: 'failed' }));
      setPlaylistFormatErrors(current => ({ ...current, [entry.index]: message }));
      logVideoDownload(`playlist format lookup failed title=${JSON.stringify(entry.title)} error=${message}`, onLog);
    } finally {
      setActiveDownload(null);
    }
  }

  function choosePlaylistFormat(entryIndex: number, choice: PlaylistDownloadChoice) {
    setOpenPlaylistEntryIndex(null);
    setPlaylistChoices(current => {
      const existing = current[entryIndex];
      if (
        existing?.kind === choice.kind &&
        existing.format.formatId === choice.format.formatId &&
        (existing.kind !== 'audio' || choice.kind !== 'audio' || existing.convertToMp3 === choice.convertToMp3)
      ) {
        const next = { ...current };
        delete next[entryIndex];
        return next;
      }
      return { ...current, [entryIndex]: choice };
    });
  }

  async function downloadSelectedPlaylist() {
    if (!playlistResult || activeDownload) return;
    if (!mediaLibraryPath.trim()) {
      setDownloadError('Set the media library location in Config before downloading.');
      return;
    }

    const selectedEntries = playlistResult.entries.filter(entry => playlistChoices[entry.index]);
    if (selectedEntries.length === 0) {
      setDownloadError('Choose a format for at least one playlist item before downloading.');
      return;
    }

    const api = window.electronAPI;
    const choices = selectedEntries.map(entry => playlistChoices[entry.index]);
    if (choices.some(choice => choice.kind === 'audio') && !hasElectronCapability(api, 'downloadVideoFormat')) {
      setDownloadError('Audio downloading is unavailable outside the desktop app.');
      return;
    }
    if (choices.some(choice => choice.kind === 'video') && !hasElectronCapability(api, 'downloadVideoMp4')) {
      setDownloadError('MP4 video downloading is unavailable outside the desktop app.');
      return;
    }

    setDownloadError('');
    setPlaylistBatchSummary('');
    setPlaylistItemStatus({});
    setDownloadedMedia(null);
    setActiveDownload('playlist-batch');
    let completed = 0;
    const failures: string[] = [];
    let lastDownloaded: { path: string; title: string } | null = null;

    for (let index = 0; index < selectedEntries.length; index += 1) {
      const entry = selectedEntries[index];
      const choice = playlistChoices[entry.index];
      setPlaylistItemStatus(current => ({ ...current, [entry.index]: 'downloading' }));
      setDownloadProgress({ title: entry.title, percent: null });
      logVideoDownload(`playlist download ${index + 1}/${selectedEntries.length} started title=${JSON.stringify(entry.title)}`, onLog);

      try {
        let response;
        if (choice.kind === 'audio') {
          if (!hasElectronCapability(api, 'downloadVideoFormat')) throw new Error('Audio download is unavailable.');
          response = await api.downloadVideoFormat(entry.url, choice.format.formatId, choice.convertToMp3, mediaLibraryPath);
        } else {
          if (!hasElectronCapability(api, 'downloadVideoMp4')) throw new Error('MP4 download is unavailable.');
          response = await api.downloadVideoMp4(entry.url, choice.format.formatId, choice.audioFormatId, mediaLibraryPath);
        }
        if (!response.ok) throw new Error(response.error);

        completed += 1;
        lastDownloaded = { path: response.path, title: entry.title };
        setPlaylistItemStatus(current => ({ ...current, [entry.index]: 'downloaded' }));
        logVideoDownload(`playlist download succeeded title=${JSON.stringify(entry.title)}`, onLog);
      } catch (downloadError) {
        failures.push(`${entry.title}: ${String(downloadError)}`);
        setPlaylistItemStatus(current => ({ ...current, [entry.index]: 'failed' }));
        logVideoDownload(`playlist download failed title=${JSON.stringify(entry.title)} error=${String(downloadError)}`, onLog);
      }
    }

    setActiveDownload(null);
    setDownloadProgress(null);
    setDownloadedMedia(lastDownloaded && {
      ...lastDownloaded,
      showFileButton: completed === 1
    });
    setPlaylistBatchSummary(
      failures.length
        ? `Downloaded ${completed} of ${selectedEntries.length}; ${failures.length} failed.`
        : `Downloaded all ${completed} selected playlist items.`
    );
    if (failures.length) {
      setDownloadError(failures.join('\n'));
    }
  }

  async function handleDownloadThumbnail() {
    if (!mediaLibraryPath.trim()) {
      setThumbnailError('Set the media library location in Config before downloading.');
      return;
    }
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'downloadVideoThumbnail')) {
      setThumbnailError('Thumbnail downloading is unavailable outside the desktop app.');
      return;
    }

    setThumbnailDownloading(true);
    setThumbnailError('');
    setThumbnailStatus('');
    try {
      const response = await api.downloadVideoThumbnail(url, mediaLibraryPath);
      if (!response.ok) {
        setThumbnailError(response.error);
        return;
      }
      setThumbnailStatus(`Thumbnail downloaded to ${response.path}`);
    } catch (requestError) {
      setThumbnailError(`Unable to download thumbnail: ${String(requestError)}`);
    } finally {
      setThumbnailDownloading(false);
    }
  }

  const singleResult = result && 'formats' in result ? result : null;
  const playlistResult = result && 'entries' in result ? result : null;
  const audioRecommendations = singleResult ? recommendAudioFormats(singleResult.formats) : [];
  const selectedPlaylistEntries = playlistResult?.entries.filter(entry => !!playlistChoices[entry.index]) ?? [];
  const canDownloadSelectedPlaylist = selectedPlaylistEntries.length > 0 && activeDownload === null;
  const progressPercent = downloadProgress?.percent ?? null;
  const formattedProgressPercent = progressPercent === null
    ? null
    : `${Number(progressPercent.toFixed(1))}%`;
  const progressWaitingLabel = activeDownload ? 'Waiting for progress...' : 'No progress received';

  return (
    <div className="video-downloader" style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <h1 style={{ margin: '0 0 12px', color: '#f5f7fb', fontSize: '1.4rem' }}>Media Downloader</h1>
      <div role="group" aria-label="Download type" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" aria-pressed="true" disabled>
          Video
        </button>
        <button
          type="button"
          aria-pressed="false"
          onClick={() => setDownloaderMode('torrent')}
        >
          Torrent
        </button>
      </div>
      <form
        onSubmit={event => void handleSearchSubmit(event)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 1100, marginBottom: 10 }}
      >
        <label htmlFor="video-downloader-search" style={{ flex: '0 0 auto', color: '#eef2ff' }}>Search</label>
        <input
          id="video-downloader-search"
          aria-label="Search YouTube and Bilibili"
          type="search"
          required
          maxLength={200}
          value={searchQuery}
          onChange={event => setSearchQuery(event.currentTarget.value)}
          placeholder="Search videos..."
          style={{ flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box' }}
        />
        <button
          type="submit"
          disabled={isSearching || activeDownload !== null}
          style={{ flex: '0 0 auto', minWidth: 92 }}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </form>
      <form
        onSubmit={event => void handleSubmit(event)}
        style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 10, width: '100%', maxWidth: 1100 }}
      >
        <label htmlFor="video-downloader-url" style={{ flex: '0 0 auto', color: '#eef2ff' }}>
          URL
        </label>
        <input
          id="video-downloader-url"
          aria-label="Video URL"
          type="url"
          required
          value={url}
          onChange={event => setUrl(event.currentTarget.value)}
          placeholder="https://..."
          style={{ flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box' }}
        />
        <button
          type="button"
          aria-label="Clear video URL"
          title="Clear URL"
          disabled={(!url && !result) || activeDownload !== null}
          onClick={clearUrl}
          style={{ flex: '0 0 38px', width: 38, height: 38, minHeight: 38, padding: 0, borderRadius: 999, fontSize: 20, lineHeight: 1 }}
        >
          ×
        </button>
        <button
          type="submit"
          className="icon-btn"
          aria-label={isLoading ? 'Loading formats' : 'Download'}
          title={isLoading ? 'Loading formats...' : 'Download'}
          disabled={isLoading || activeDownload !== null}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 44px', width: 44, height: 44, minHeight: 44, padding: 0, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #8dd9c1, #64b99f)', color: '#10221c' }}
        >
          {isLoading ? (
            <span className="tag-editor-info-search-spinner" aria-hidden="true" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="icon-btn player-media-role-button"
          aria-label={`AI upscaled formats: ${includeAiUpscaled ? 'On' : 'Off'}`}
          aria-pressed={includeAiUpscaled}
          title={`AI-upscaled formats: ${includeAiUpscaled ? 'On' : 'Off'}`}
          onClick={() => setIncludeAiUpscaled(current => !current)}
          style={{
            background: includeAiUpscaled ? 'linear-gradient(135deg, #a4e8d1, #69c2a6)' : '#171717',
            color: includeAiUpscaled ? '#18251f' : 'rgba(245,247,251,0.78)',
            border: `1px solid ${includeAiUpscaled ? 'rgba(190,245,220,0.62)' : 'rgba(255,255,255,0.12)'}`,
            boxShadow: includeAiUpscaled ? '0 8px 22px rgba(84,185,158,0.24)' : 'none'
          }}
        >
          <svg width="28" height="22" viewBox="0 0 28 22" fill="none" aria-hidden="true">
            <rect x="1" y="5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <text x="3.2" y="15.2" fill="currentColor" fontSize="8" fontWeight="700">AI</text>
            <path d="M22 17V4m-4 4 4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
      {recentUrls.length > 0 && (
        <section
          aria-label="Recent video URLs"
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 920, marginTop: 10 }}
        >
          <span style={{ flex: '0 0 auto', color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>Recent:</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', flex: '1 1 auto', gap: 8, minWidth: 0 }}>
            {recentUrls.map(recentUrl => (
              <button
                key={recentUrl.url}
                type="button"
                aria-label={`Use recent URL ${recentUrl.title}`}
                title={recentUrl.title}
                disabled={isLoading || activeDownload !== null}
                onClick={() => selectRecentUrl(recentUrl)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, overflow: 'hidden', padding: '4px 6px', margin: 0, textAlign: 'left' }}
              >
                {recentUrl.thumbnailUrl && (
                  <img
                    src={recentUrl.thumbnailUrl}
                    alt={`Thumbnail for ${recentUrl.title}`}
                    onError={event => { event.currentTarget.hidden = true; }}
                    style={{ flex: '0 0 24px', width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }}
                  />
                )}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                  {recentUrl.title}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {error && <p role="alert" style={{ margin: '14px 0 0', color: '#ff9b9b' }}>{error}</p>}
      {historyError && <p role="alert" style={{ margin: '14px 0 0', color: '#ff9b9b' }}>{historyError}</p>}
      {searchError && <p role="alert" style={{ margin: '10px 0 0', color: '#ff9b9b' }}>{searchError}</p>}
      {searchResults ? (
        <div
          className="video-downloader-results"
          role="region"
          aria-label="Video search results"
          style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0, width: '100%', maxWidth: 1100, marginTop: 22, overflowY: 'auto', paddingRight: 8, scrollbarGutter: 'stable' }}
        >
          {(['youtube', 'bilibili'] as const).map(platform => {
            const platformName = platform === 'youtube' ? 'YouTube' : 'Bilibili';
            const results = searchResults[platform];
            const platformError = searchResults.errors?.[platform];
            return (
              <section key={platform} aria-label={`${platformName} results`} style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 8px', color: '#f5f7fb', fontSize: '1rem' }}>{platformName}</h2>
                {platformError ? (
                  <p role="alert" style={{ margin: 0, color: '#ff9b9b' }}>{platformError}</p>
                ) : results.length ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 10 }}>
                    {results.map(searchResult => (
                      <button
                        key={`${platform}:${searchResult.id}`}
                        type="button"
                        aria-label={`Use ${platformName} result: ${searchResult.title}`}
                        title={searchResult.title}
                        disabled={isLoading || activeDownload !== null}
                        onClick={() => selectSearchResult(searchResult)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, padding: 10, textAlign: 'left' }}
                      >
                        {searchResult.thumbnailUrl && (
                          <img
                            src={searchResult.thumbnailUrl}
                            alt=""
                            onError={event => { event.currentTarget.hidden = true; }}
                            style={{ flex: '0 0 120px', width: 120, height: 68, borderRadius: 5, objectFit: 'cover' }}
                          />
                        )}
                        <span style={{ minWidth: 0, overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflowWrap: 'anywhere', fontSize: 13 }}>
                          {searchResult.title}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>No results found.</p>
                )}
              </section>
            );
          })}
        </div>
      ) : result && (
        <div
          className="video-downloader-results"
          role="region"
          aria-label="Available video formats"
          style={{ flex: '1 1 auto', minHeight: 0, marginTop: 22, overflowY: 'auto', paddingRight: 8, scrollbarGutter: 'stable' }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem', overflowWrap: 'anywhere' }}>{result.title}</h2>
          {showThumbnail && result.thumbnailUrl && !thumbnailLoadFailed && (
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="media-downloader-thumbnail-button"
                aria-label={thumbnailDownloading ? 'Downloading video thumbnail' : 'Download video thumbnail'}
                title="Click to download this thumbnail to Downloads"
                disabled={thumbnailDownloading}
                onClick={() => void handleDownloadThumbnail()}
              >
                <img
                  src={result.thumbnailUrl}
                  alt="Video thumbnail preview"
                  onError={() => setThumbnailLoadFailed(true)}
                />
              </button>
              <p style={{ margin: '6px 0 0', color: 'rgba(245,247,251,0.62)', fontSize: 12 }}>
                {thumbnailDownloading ? 'Downloading thumbnail...' : 'Click the image to save it to Downloads'}
              </p>
            </div>
          )}
          {singleResult && (
            <>
              <AudioRecommendations formats={singleResult.formats} activeDownload={activeDownload} onDownload={(format, convertToMp3) => {
                void handleDownload(format, convertToMp3);
              }} />
              <VideoRecommendations
                formats={singleResult.formats}
                includeAiUpscaled={includeAiUpscaled}
                audioFormat={audioRecommendations[0] ?? null}
                activeDownload={activeDownload}
                onDownload={(format, audioFormatId) => void handleDownloadVideoMp4(format, audioFormatId)}
              />
            </>
          )}
          {playlistResult && (
            <section aria-label="Playlist items" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Playlist · {playlistResult.entries.length} items</h2>
                  <p style={{ margin: '4px 0 0', color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>
                    Click a card to load its formats. Choose a format to mark it for download.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={!canDownloadSelectedPlaylist}
                    onClick={() => void downloadSelectedPlaylist()}
                    style={{ border: 'none', borderRadius: 8, background: 'linear-gradient(135deg, #8dd9c1, #64b99f)', color: '#10221c', fontWeight: 700 }}
                  >
                    {activeDownload === 'playlist-batch'
                      ? 'Downloading playlist...'
                      : `Download Selected (${selectedPlaylistEntries.length})`}
                  </button>
                </div>
              </div>
              {playlistBatchSummary && (
                <p role="status" style={{ margin: '0 0 10px', color: '#a4e8d1' }}>{playlistBatchSummary}</p>
              )}
              <div
                style={{
                  maxHeight: 520,
                  overflowY: 'auto',
                  scrollbarGutter: 'stable',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  alignItems: 'start',
                  gap: 10,
                  padding: 8,
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.12)'
                }}
              >
                {playlistResult.entries.map(entry => {
                  const choice = playlistChoices[entry.index];
                  const itemStatus = playlistItemStatus[entry.index];
                  const itemAudioRecommendations = recommendAudioFormats(entry.formats);
                  return (
                    <article
                      key={`${entry.index}:${entry.id}`}
                      aria-label={`Playlist item ${entry.index}: ${entry.title}`}
                      aria-busy={playlistFormatStatus[entry.index] === 'loading'}
                      tabIndex={!entry.unavailableReason ? 0 : undefined}
                      onClick={event => {
                        const target = event.target;
                        if (target instanceof Element && target.closest('button, a, input')) return;
                        if (entry.formatsLoaded) {
                          setOpenPlaylistEntryIndex(current => current === entry.index ? null : entry.index);
                        } else {
                          void loadPlaylistEntryFormats(entry);
                        }
                      }}
                      onKeyDown={event => {
                        if (
                          (event.key === 'Enter' || event.key === ' ') &&
                          event.target === event.currentTarget
                        ) {
                          event.preventDefault();
                          if (entry.formatsLoaded) {
                            setOpenPlaylistEntryIndex(current => current === entry.index ? null : entry.index);
                          } else {
                            void loadPlaylistEntryFormats(entry);
                          }
                        }
                      }}
                      style={{
                        minWidth: 0,
                        padding: 12,
                        border: choice ? '1px solid rgba(141,217,193,0.9)' : '1px solid rgba(190,218,196,0.13)',
                        borderRadius: 10,
                        background: choice
                          ? 'linear-gradient(135deg, rgba(141,217,193,0.38), rgba(100,185,159,0.3))'
                          : 'rgba(255,255,255,0.025)',
                        boxShadow: choice ? '0 0 0 1px rgba(141,217,193,0.35), 0 0 20px rgba(141,217,193,0.18)' : undefined,
                        cursor: entry.unavailableReason ? 'default' : 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div style={{ position: 'relative', flex: '0 0 96px', width: 96, height: 54, overflow: 'hidden', borderRadius: 6, background: 'rgba(141,217,193,0.08)' }}>
                          <span aria-hidden="true" style={{ display: 'grid', width: '100%', height: '100%', placeItems: 'center', color: 'rgba(245,247,251,0.45)', fontSize: 11 }}>Video</span>
                          {entry.thumbnailUrl && (
                            <img
                              src={entry.thumbnailUrl}
                              alt={`Thumbnail for ${entry.title}`}
                              loading="lazy"
                              onError={event => {
                                event.currentTarget.style.display = 'none';
                              }}
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          )}
                        </div>
                        <span style={{ flex: '0 0 auto', color: 'rgba(245,247,251,0.58)', fontVariantNumeric: 'tabular-nums' }}>
                            {entry.index}.
                        </span>
                        <strong style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</strong>
                        <span style={{ flex: '0 0 auto', color: itemStatus === 'failed' || playlistFormatStatus[entry.index] === 'failed' ? '#ff9b9b' : '#a4e8d1', fontSize: 12 }}>
                          {playlistFormatStatus[entry.index] === 'loading' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span className="tag-editor-info-search-spinner" aria-hidden="true" />
                              Loading...
                            </span>
                          )
                            : playlistFormatStatus[entry.index] === 'failed'
                              ? 'Click to retry'
                              : itemStatus === 'downloading'
                                ? 'Downloading...'
                                : itemStatus === 'downloaded'
                                  ? 'Downloaded'
                                  : itemStatus === 'failed'
                                    ? 'Failed'
                                    : ''}
                        </span>
                      </div>
                      {choice && (
                        <p style={{ margin: '6px 0 0 26px', color: '#a4e8d1', fontSize: 12 }}>
                          Selected: {choice.kind === 'audio'
                            ? `${choice.format.extension.toUpperCase()} ${choice.format.formatId}${choice.convertToMp3 ? ' → MP3' : ''}`
                            : `MP4 ${choice.format.resolution} (${choice.format.formatId})`}
                        </p>
                      )}
                      {entry.unavailableReason && (
                        <p style={{ margin: '10px 0 0', color: '#ffb2b2', fontSize: 13 }}>{entry.unavailableReason}</p>
                      )}
                      {playlistFormatErrors[entry.index] && (
                        <p role="alert" style={{ margin: '10px 0 0', color: '#ffb2b2', fontSize: 13 }}>
                          Unable to load formats: {playlistFormatErrors[entry.index]}
                        </p>
                      )}
                      {entry.formatsLoaded && openPlaylistEntryIndex === entry.index && !entry.unavailableReason && (
                        <>
                          <AudioRecommendations
                            formats={entry.formats}
                            activeDownload={activeDownload}
                            onDownload={() => undefined}
                            selectedChoice={choice}
                            onSelect={formatChoice => choosePlaylistFormat(entry.index, formatChoice)}
                          />
                          <VideoRecommendations
                            formats={entry.formats}
                            includeAiUpscaled={includeAiUpscaled}
                            audioFormat={itemAudioRecommendations[0] ?? null}
                            activeDownload={activeDownload}
                            onDownload={() => undefined}
                            selectedChoice={choice}
                            onSelect={formatChoice => choosePlaylistFormat(entry.index, formatChoice)}
                          />
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
      {downloadError && <p role="alert" style={{ margin: '14px 0 0', color: '#ff9b9b' }}>{downloadError}</p>}
      {activeDownload && !activeDownload.startsWith('playlist-format:') && (
        <p role="status" aria-live="polite" style={{ margin: '14px 0 0', color: 'rgba(245,247,251,0.78)' }}>
          Downloading to your Downloads folder...
        </p>
      )}
      {(downloadProgress || downloadedMedia) && (
        <section
          role="status"
          aria-live="polite"
          aria-label="Download progress"
          style={{ marginTop: 10, padding: 12, border: '1px solid rgba(141,217,193,0.25)', borderRadius: 10, background: 'rgba(141,217,193,0.06)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontSize: 13 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {downloadProgress
                ? `Downloading: ${downloadProgress.title || result?.title || 'Preparing download'}`
                : `Downloaded: ${downloadedMedia?.title || 'Media'}`}
            </span>
            {downloadedMedia && (
              <svg
                aria-label="Download complete"
                role="img"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                style={{ flex: '0 0 auto', color: '#8dd9c1' }}
              >
                <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.16" />
                <path d="m7 12.5 3.2 3.2L17.5 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          {downloadProgress ? (
            <div style={{ height: 28, display: 'flex', alignItems: 'center' }}>
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  role="progressbar"
                  aria-label={`Download progress for ${downloadProgress.title || result?.title || 'media'}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent ?? undefined}
                  style={{
                    flex: '1 1 auto',
                    height: 12,
                    overflow: 'hidden',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.12)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.35)'
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'block',
                      width: `${progressPercent ?? 0}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: 'linear-gradient(90deg, #64b99f, #a4e8d1)',
                      boxShadow: progressPercent === null || progressPercent === 0
                        ? 'none'
                        : '0 0 10px rgba(141,217,193,0.45)',
                      transition: 'width 250ms ease-out'
                    }}
                  />
                </span>
                <strong style={{
                  flex: '0 0 auto',
                  minWidth: 52,
                  color: '#a4e8d1',
                  fontSize: 14,
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'right'
                }}>
                  {formattedProgressPercent ?? progressWaitingLabel}
                </strong>
              </div>
            </div>
          ) : (
            <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => void handleOpenDownloadedMedia('folder')}
                style={{ height: 26, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', borderRadius: 7, border: '1px solid rgba(141,217,193,0.35)', background: 'rgba(141,217,193,0.12)', color: '#d8fff1', padding: '4px 9px', fontSize: 12, fontWeight: 600 }}
              >
                Open Folder
              </button>
              {downloadedMedia?.showFileButton !== false && (
                <button
                  type="button"
                  onClick={() => void handleOpenDownloadedMedia('file')}
                  style={{ height: 26, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', borderRadius: 7, border: '1px solid rgba(141,217,193,0.35)', background: 'rgba(141,217,193,0.12)', color: '#d8fff1', padding: '4px 9px', fontSize: 12, fontWeight: 600 }}
                >
                  Open File
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {thumbnailError && <p role="alert" style={{ margin: '14px 0 0', color: '#ff9b9b' }}>{thumbnailError}</p>}
      {thumbnailStatus && <p role="status" aria-live="polite" style={{ margin: '14px 0 0', color: 'rgba(245,247,251,0.78)' }}>{thumbnailStatus}</p>}
    </div>
  );
}
