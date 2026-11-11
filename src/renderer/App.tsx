import React, { lazy, Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { hasElectronCapability, type ElectronKaraokeSubtitleLine } from '../electron/electronApi';
import type { IAudioMetadata } from 'music-metadata';
import { normalizeLyricsText } from '../electron/lyricsText';
import type {
  OnlineLyricsResult,
  OnlineMetadataResult,
  PlaybackDiagnostics,
  PlaybackResumePosition,
  Playlist,
  TagEditorDraft,
  Track,
  TrackPathHints
} from './types';
import { getTrackCoverCacheKey } from './cover/coverUtils';
import { LYRICS_RESULTS_PER_PAGE, toTraditionalLyrics } from './lyrics/lyricsUtils';
import { useLyricsPlayback } from './lyrics/useLyricsPlayback';
import { createInitialPlaybackDiagnostics } from './playback/playbackDiagnostics';
import { playTrack, type PlaybackRequestOptions } from './playback/playTrack';
import { getTrackFilePath, METADATA_RESULTS_PER_PAGE, normalizeSearchText, parseTrackPathHints, serializePlaylistTracks, TRACK_LIST_OVERSCAN, TRACK_LIST_VIRTUALIZATION_THRESHOLD, TRACK_ROW_HEIGHT, TRACK_ROW_STRIDE } from './playlist/playlistUtils';
import { PlayerCover } from './cover/CoverDisplay';
import { useCoverCache, useFullResolutionCover } from './cover/useCoverCache';
import LyricsContent from './lyrics/LyricsContent';
import LyricsDialog from './lyrics/LyricsDialog';
import LyricsModeToggle from './lyrics/LyricsModeToggle';
import PlaylistPanel, { type PlaylistPanelMode, type PlaylistTool } from './playlist/PlaylistPanel';
import {
  getMediaLibraryRoleFromFilePath,
  getMediaLibraryRolePath,
  getVideoResolutionLabel,
  groupMediaLibraryFiles,
  type MediaLibraryRole
} from './playlist/mediaLibraryUtils';
import {
  clearPlaylistTrackPreview,
  getLyricsModeAfterTrackLoad,
  schedulePlaylistTrackPreview,
  shouldSchedulePlaylistTrackPreview
} from './playlist/playlistSelection';
import { applyPitchWithoutTempoChange } from './transpose/transposeUtils';
import TransposeControls from './transpose/TransposeControls';
import { AudioElement, VideoElement, VideoSeekControls } from './playback/MediaElements';
import KaraokeSubtitleOverlay from './playback/KaraokeSubtitleOverlay';
import PlaybackTransport from './playback/PlaybackTransport';
import PlaybackAudioControls from './playback/PlaybackAudioControls';
import { metadataRegionLabels } from './metadata/metadataRegions';
import { parseAudioBlob } from './metadata/parseAudioBlob';
import {
  getOnlineMetadataMatchDetails,
  sortOnlineLyricsResults,
  sortOnlineMetadataResults,
  type OnlineMetadataMatchDetails
} from './metadata/sortOnlineMetadataResults';
import { readPlaybackResumePosition, writePlaybackResumePosition } from './playback/resumePosition';
import { useMediaObjectUrls } from './playback/useMediaObjectUrls';
import { decodeBase64Blob, musicFileUrl, resolveBackingTrackCandidates } from './playback/mediaSource';

const VideoDownloader = lazy(() => import('./tools/VideoDownloader'));
const KaraokeCreator = lazy(() => import('./tools/KaraokeCreator'));
const KaraokeAligner = lazy(() => import('./tools/KaraokeAligner'));

type OnlineMetadataApplyField =
  | 'title'
  | 'artist'
  | 'album'
  | 'year'
  | 'track'
  | 'albumArtist'
  | 'composer'
  | 'lyricist'
  | 'cover';

const ONLINE_METADATA_TEXT_FIELDS = [
  { field: 'title', label: 'Title', getValue: (result: OnlineMetadataResult) => result.trackName },
  { field: 'artist', label: 'Artist', getValue: (result: OnlineMetadataResult) => result.artistName },
  { field: 'album', label: 'Album', getValue: (result: OnlineMetadataResult) => result.albumName },
  { field: 'year', label: 'Year', getValue: (result: OnlineMetadataResult) => result.year },
  { field: 'track', label: 'Track', getValue: (result: OnlineMetadataResult) => result.trackNumber },
  { field: 'albumArtist', label: 'Album Artist', getValue: (result: OnlineMetadataResult) => result.albumArtist },
  { field: 'composer', label: 'Composer', getValue: (result: OnlineMetadataResult) => result.composer || '' },
  { field: 'lyricist', label: 'Lyricist', getValue: (result: OnlineMetadataResult) => result.lyricist || '' }
] as const;

function getMetadataSourceLabel(source: string | undefined) {
  return source || 'Unknown source';
}

function getMetadataSourceSummary(result: OnlineMetadataResult) {
  const sources = [...new Set(Object.values(result.fieldSources || {})
    .filter((source): source is NonNullable<typeof source> => !!source))];
  if (sources.length) return sources.join(' + ');
  return result.country ? 'Apple Music/iTunes' : 'Online catalog';
}

function getAudioContextConstructor() {
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function readSliderPreference(key: string, fallback: number, min: number, max: number) {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    const value = Number(saved);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch (error) {
    console.warn(`Unable to load ${key} setting`, error);
    return fallback;
  }
}

function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return null;
  } catch (error) {
    const message = `Unable to save ${key} preference: ${String(error)}`;
    console.warn(message, error);
    return message;
  }
}

function appendElectronLog(message: string) {
  const api = window.electronAPI;
  if (!hasElectronCapability(api, 'appendLog')) return;
  void api.appendLog(message).catch(error => {
    console.warn('Unable to append Electron diagnostic log', error);
  });
}

function OnlineMatchIndicators({ details }: { details: OnlineMetadataMatchDetails }) {
  return (
    <span className="tag-editor-match-indicators" aria-label={`Similarity ${details.similarityPercent}%`}>
      <svg className="tag-editor-match-icon tag-editor-match-title" viewBox="0 0 24 24" role="img" aria-label={details.titleMatched ? 'Song title matches' : 'Song title does not match'}>
        <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9L12 2.8Z" fill={details.titleMatched ? 'currentColor' : 'none'} />
      </svg>
      <svg className="tag-editor-match-icon tag-editor-match-artist" viewBox="0 0 24 24" role="img" aria-label={details.artistMatched ? 'Artist matches' : 'Artist does not match'}>
        <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" fill={details.artistMatched ? 'currentColor' : 'none'} />
      </svg>
      <svg className="tag-editor-match-icon tag-editor-match-album" viewBox="0 0 24 24" role="img" aria-label={details.albumMatched ? 'Album matches' : 'Album does not match'}>
        <circle cx="12" cy="12" r="3.3" fill={details.albumMatched ? 'currentColor' : 'none'} />
        <path d="M12 1.8v3M12 19.2v3M4.8 4.8l2.1 2.1m10.2 10.2 2.1 2.1M1.8 12h3m14.4 0h3M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1" fill="none" />
      </svg>
      <span className="tag-editor-match-score">{details.similarityPercent}%</span>
    </span>
  );
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsReady, setPlaylistsReady] = useState(false);
  const [resumePosition, setResumePosition] = useState<PlaybackResumePosition | null>(null);
  const resumeRestoreAttemptedRef = useRef(false);
  const lastResumeSaveAtRef = useRef(0);
  const [current, setCurrent] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const selectionAnchorTrackIdRef = useRef<string | null>(null);
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string | null>(null);
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [isPlaylistOptionsOpen, setIsPlaylistOptionsOpen] = useState(false);
  const [isPlaylistOperationPending, setIsPlaylistOperationPending] = useState(false);
  const playlistOperationInProgressRef = useRef(false);
  const playlistsRef = useRef<Playlist[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const karaokeAccompanimentRef = useRef<HTMLAudioElement | null>(null);
  const karaokeAccompanimentPlayPendingRef = useRef(false);
  const karaokeAccompanimentShouldPlayRef = useRef(false);
  const videoSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const videoPitchNodeRef = useRef<ScriptProcessorNode | null>(null);
  const videoSoundTouchRef = useRef<any>(null);
  const transposeRef = useRef(0);
  const videoTransposeRef = useRef(0);
  const previousVideoTransposeRef = useRef(0);
  const mediaDisplayRef = useRef<HTMLDivElement | null>(null);
  const activeMediaRef = useRef<HTMLMediaElement | null>(null);
  const {
    createMediaObjectUrl,
    scheduleCleanup: scheduleMediaObjectUrlCleanup,
    updateTrackSourceReferences
  } = useMediaObjectUrls({
    tracks,
    playlists,
    activeMediaRef,
    setTracks,
    setPlaylists
  });
  const lyricsLoadRequestRef = useRef(0);
  const seekingRef = useRef<boolean>(false);
  const addFilesInputRef = useRef<HTMLInputElement | null>(null);
  const addFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const playbackDiagnosticsRef = useRef<PlaybackDiagnostics>(createInitialPlaybackDiagnostics());
  const [playbackDiagnostics, setPlaybackDiagnostics] = useState(createInitialPlaybackDiagnostics);
  const bufferingStartedAtRef = useRef<{ media: HTMLMediaElement; timestamp: number } | null>(null);
  const lastProgressSampleRef = useRef<{ media: HTMLMediaElement; timestamp: number; currentTime: number } | null>(null);
  const playbackRequestRef = useRef(0);
  const [view, setView] = useState<'player'|'config'>('player');
  const [selectedMediaRole, setSelectedMediaRole] = useState<MediaLibraryRole | null>(null);
  const [karaokeAudioSource, setKaraokeAudioSource] = useState<'accompaniment' | 'vocals' | 'original'>('accompaniment');
  const [aoStemSources, setAoStemSources] = useState<{ accompaniments: 'music' | 'video'; vocals: 'music' | 'video' }>({
    accompaniments: 'music',
    vocals: 'music'
  });
  const [sidebarMode, setSidebarMode] = useState<PlaylistPanelMode>('playlist');
  const [selectedTool, setSelectedTool] = useState<PlaylistTool | null>(null);
  const [vocalSplitterFolder, setVocalSplitterFolder] = useState('');
  const [vocalSplitterRecursive, setVocalSplitterRecursive] = useState(false);
  const [vocalSplitterRunning, setVocalSplitterRunning] = useState(false);
  const [vocalSplitterStatus, setVocalSplitterStatus] = useState('');
  const [vocalSplitterError, setVocalSplitterError] = useState('');
  const [vocalSplitterFailures, setVocalSplitterFailures] = useState<string[]>([]);
  const [karaokeSubtitleLines, setKaraokeSubtitleLines] = useState<ElectronKaraokeSubtitleLine[]>([]);
  const [karaokeSubtitleError, setKaraokeSubtitleError] = useState('');
  const [seekTime, setSeekTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMediaFullscreen, setIsMediaFullscreen] = useState(false);
  const [showVideoFullscreenControls, setShowVideoFullscreenControls] = useState(true);
  const fullscreenControlsTimerRef = useRef<number | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; left: number; top: number; below: boolean } | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const tooltipTargetRef = useRef<HTMLElement | null>(null);
  const bitrateRequestRef = useRef<Set<string>>(new Set());
  const resolutionRequestRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const updateFullscreenState = () => {
      const isFullscreen = document.fullscreenElement === mediaDisplayRef.current;
      setIsMediaFullscreen(isFullscreen);
      setShowVideoFullscreenControls(true);
    };
    document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
      if (fullscreenControlsTimerRef.current !== null) window.clearTimeout(fullscreenControlsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (fullscreenControlsTimerRef.current !== null) {
      window.clearTimeout(fullscreenControlsTimerRef.current);
      fullscreenControlsTimerRef.current = null;
    }
    const fullscreenTrack = current == null ? null : tracks[current] ?? null;
    if (isMediaFullscreen && isVideoTrack(fullscreenTrack)) {
      setShowVideoFullscreenControls(true);
      fullscreenControlsTimerRef.current = window.setTimeout(() => setShowVideoFullscreenControls(false), 2000);
    } else {
      setShowVideoFullscreenControls(true);
    }
    return () => {
      if (fullscreenControlsTimerRef.current !== null) {
        window.clearTimeout(fullscreenControlsTimerRef.current);
        fullscreenControlsTimerRef.current = null;
      }
    };
  }, [isMediaFullscreen, current, tracks]);

  useEffect(() => {
    const findTooltipTarget = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-mint-tooltip], [aria-valuetext], [title]') : null;
    const getTooltipText = (element: HTMLElement) =>
      element.getAttribute('aria-valuetext') || element.dataset.mintTooltip || element.getAttribute('title') || '';
    const clearTimer = () => {
      if (tooltipTimerRef.current !== null) {
        window.clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    };
    const showTooltip = (element: HTMLElement | null) => {
      if (!element) return;
      const title = element.getAttribute('title');
      if (title) {
        element.dataset.mintTooltip = title;
        element.removeAttribute('title');
      }
      const text = getTooltipText(element);
      if (!text || tooltipTargetRef.current === element) return;
      clearTimer();
      tooltipTargetRef.current = element;
      tooltipTimerRef.current = window.setTimeout(() => {
        if (tooltipTargetRef.current !== element) return;
        const bounds = element.getBoundingClientRect();
        const below = bounds.top < 56;
        setTooltip({
          text: getTooltipText(element),
          left: Math.max(132, Math.min(window.innerWidth - 132, bounds.left + bounds.width / 2)),
          top: below ? bounds.bottom + 8 : bounds.top - 8,
          below
        });
      }, 350);
    };
    const hideTooltip = (element: HTMLElement | null, relatedTarget: EventTarget | null) => {
      if (!element || tooltipTargetRef.current !== element) return;
      const relatedElement = relatedTarget instanceof Node ? relatedTarget : null;
      if (relatedElement && element.contains(relatedElement)) return;
      clearTimer();
      tooltipTargetRef.current = null;
      setTooltip(null);
    };
    const onRangeInput = (event: Event) => {
      const element = findTooltipTarget(event.target);
      if (!element || !element.matches('input[type="range"]') || tooltipTargetRef.current !== element) return;
      clearTimer();
      const bounds = element.getBoundingClientRect();
      const below = bounds.top < 56;
      setTooltip({
        text: getTooltipText(element),
        left: Math.max(132, Math.min(window.innerWidth - 132, bounds.left + bounds.width / 2)),
        top: below ? bounds.bottom + 8 : bounds.top - 8,
        below
      });
    };
    const onPointerOver = (event: PointerEvent) => showTooltip(findTooltipTarget(event.target));
    const onPointerOut = (event: PointerEvent) => hideTooltip(findTooltipTarget(event.target), event.relatedTarget);
    const onFocusIn = (event: FocusEvent) => showTooltip(findTooltipTarget(event.target));
    const onFocusOut = (event: FocusEvent) => hideTooltip(findTooltipTarget(event.target), event.relatedTarget);

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('input', onRangeInput);
    document.addEventListener('change', onRangeInput);
    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('input', onRangeInput);
      document.removeEventListener('change', onRangeInput);
    };
  }, []);

  // sync audio progress and metadata (also reflect play/pause state)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (!seekingRef.current) setSeekTime(a.currentTime || 0);
      recordPlaybackProgress(a);
    };
    const onMeta = () => setDuration(a.duration || 0);
    const onPlay = () => {
      if (activeMediaRef.current !== a) return;
      updatePlaybackStarting(false);
      setIsPlaying(true);
    };
    const onPause = () => {
      if (activeMediaRef.current !== a) return;
      updatePlaybackStarting(false);
      setIsPlaying(false);
      finishBufferingMeasurement(a);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      try { a.removeEventListener('timeupdate', onTime); } catch(e){}
      try { a.removeEventListener('loadedmetadata', onMeta); } catch(e){}
      try { a.removeEventListener('durationchange', onMeta); } catch(e){}
      try { a.removeEventListener('play', onPlay); } catch(e){}
      try { a.removeEventListener('pause', onPause); } catch(e){}
    };
  }, [audioRef]);

  // playback + audio routing states
  const [isPlaying, setIsPlaying] = useState(false);
  const togglePlaybackRef = useRef<() => Promise<void>>(async () => {});
  const [isPlaybackStarting, setIsPlaybackStarting] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playbackStartingRef = useRef(false);
  function updatePlaybackStarting(starting: boolean) {
    playbackStartingRef.current = starting;
    setIsPlaybackStarting(starting);
  }

  function reportPlaybackFailure(message: string) {
    console.error(message);
    setPlaybackError(message);
    setLogs(logs => [...logs, message]);
  }

  function updatePlaybackDiagnostics(
    update: (current: PlaybackDiagnostics) => PlaybackDiagnostics
  ) {
    const next = update(playbackDiagnosticsRef.current);
    playbackDiagnosticsRef.current = next;
    setPlaybackDiagnostics(next);
  }

  function recordBufferingEvent(media: HTMLMediaElement, type: 'waiting' | 'stalled') {
    if (activeMediaRef.current !== media || media.paused) return;
    const now = performance.now();
    if (bufferingStartedAtRef.current?.media !== media) {
      bufferingStartedAtRef.current = { media, timestamp: now };
    }
    updatePlaybackDiagnostics(current => ({
      ...current,
      waitingEvents: current.waitingEvents + (type === 'waiting' ? 1 : 0),
      stalledEvents: current.stalledEvents + (type === 'stalled' ? 1 : 0)
    }));
  }

  function finishBufferingMeasurement(media: HTMLMediaElement) {
    const buffering = bufferingStartedAtRef.current;
    if (activeMediaRef.current !== media || buffering?.media !== media) return;
    const bufferingMs = Math.max(0, performance.now() - buffering.timestamp);
    bufferingStartedAtRef.current = null;
    updatePlaybackDiagnostics(current => ({
      ...current,
      totalBufferingMs: current.totalBufferingMs + bufferingMs,
      maxBufferingMs: Math.max(current.maxBufferingMs, bufferingMs),
      lastBufferingMs: bufferingMs
    }));
  }

  function recordPlaybackProgress(media: HTMLMediaElement) {
    if (activeMediaRef.current !== media || media.paused || !Number.isFinite(media.currentTime)) {
      lastProgressSampleRef.current = null;
      return;
    }
    const now = performance.now();
    const previous = lastProgressSampleRef.current;
    lastProgressSampleRef.current = { media, timestamp: now, currentTime: media.currentTime };
    if (!previous || previous.media !== media || media.currentTime < previous.currentTime) return;

    const gapMs = now - previous.timestamp;
    if (gapMs < 2000) return;
    updatePlaybackDiagnostics(current => ({
      ...current,
      progressGaps: current.progressGaps + 1,
      maxProgressGapMs: Math.max(current.maxProgressGapMs, gapMs),
      lastProgressGapMs: gapMs
    }));
  }

  function recordPitchShiftDecode(
    metrics: { durationMs: number; readMs: number; processingMs: number; bytes: number; source: string },
    trackName: string,
    error?: unknown
  ) {
    updatePlaybackDiagnostics(current => ({
      ...current,
      decodeCount: current.decodeCount + (error ? 0 : 1),
      lastDecodeMs: metrics.durationMs,
      lastDecodeReadMs: metrics.readMs,
      lastDecodeProcessingMs: metrics.processingMs,
      lastDecodeBytes: metrics.bytes,
      lastDecodeSource: metrics.source,
      lastDecodeTrack: trackName,
      lastDecodeError: error ? String(error) : null
    }));
  }

  function recordPitchShiftCacheHit() {
    updatePlaybackDiagnostics(current => ({ ...current, decodeCacheHits: current.decodeCacheHits + 1 }));
  }

  function clearPlaybackDiagnostics() {
    const initial = createInitialPlaybackDiagnostics();
    playbackDiagnosticsRef.current = initial;
    lastProgressSampleRef.current = null;
    bufferingStartedAtRef.current = null;
    setPlaybackDiagnostics(initial);
  }

  const [volume, setVolume] = useState<number>(() => readSliderPreference('volume', 0.5, 0, 1));
  const [pan, setPan] = useState<number>(() => readSliderPreference('pan', 0, -1, 1));
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<any>(null);
  const gainRef = useRef<any>(null);
  const pannerRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioOutputRouteRef = useRef('not connected');
  const lastAudioMeterLogAtRef = useRef(0);
  const [audioOutputMeter, setAudioOutputMeter] = useState<{ rms: number; peak: number } | null>(null);
  const shifterRef = useRef<any>(null);
  const pitchShifterTrackIdRef = useRef<string | null>(null);
  const pitchShiftBufferCacheRef = useRef<{ trackId: string; src: string; buffer: AudioBuffer } | null>(null);
  const pitchShiftDecodeRequestRef = useRef<{ trackId: string; src: string; promise: Promise<AudioBuffer> } | null>(null);
  const prevVolumeRef = useRef<number>(0.5);
  const [transpose, setTranspose] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('transposeSemitones'));
      return Number.isInteger(saved) && saved >= -12 && saved <= 12 ? saved : 0;
    } catch (error) {
      console.warn('Unable to load saved transpose setting', error);
      return 0;
    }
  }); // semitones (-12..12)

  function resetVideoPitchBuffers() {
    const soundTouch = videoSoundTouchRef.current;
    if (!soundTouch) return;
    soundTouch.inputBuffer.clear();
    soundTouch.outputBuffer.clear();
    soundTouch._intermediateBuffer?.clear();
    soundTouch.clear();
  }

  // backing track state
  const [mediaLibraryPath, setMediaLibraryPath] = useState(() => {
    try {
      return localStorage.getItem('mediaLibraryPath') || '';
    } catch (error) {
      console.warn('Unable to load media library location', error);
      return '';
    }
  });
  const mediaLibraryPathRef = useRef(mediaLibraryPath);
  const mediaLibraryPathChangedRef = useRef(false);
  const mediaLibrarySaveRequestRef = useRef(0);
  const [mediaLibraryRefreshKey, setMediaLibraryRefreshKey] = useState(0);
  const [mediaLibraryFiles, setMediaLibraryFiles] = useState<string[]>([]);
  const mediaLibrarySongs = useMemo(
    () => groupMediaLibraryFiles(mediaLibraryFiles, mediaLibraryPath),
    [mediaLibraryFiles, mediaLibraryPath]
  );
  const [mediaLibraryLocationError, setMediaLibraryLocationError] = useState('');
  const [backingAvailableMap, setBackingAvailableMap] = useState<Record<string, boolean>>({});
  // guards for async readFile requests to avoid stale callbacks applying blobs
  const readRequestIdRef = useRef<Record<string, number>>({});

  async function persistMediaLibraryPath(value: string) {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'saveMediaLibraryPath')) return;
    const response = await api.saveMediaLibraryPath(value);
    if (!response.ok) throw new Error(response.error);
  }

  function saveMediaLibraryPath(value: string) {
    mediaLibraryPathRef.current = value;
    mediaLibraryPathChangedRef.current = true;
    setMediaLibraryPath(value);
    setMediaLibraryLocationError('');
    const error = writePreference('mediaLibraryPath', value);
    if (error) {
      setMediaLibraryLocationError(error);
      setLogs(logs => [...logs, error]);
    }
    const requestId = ++mediaLibrarySaveRequestRef.current;
    void persistMediaLibraryPath(value)
      .then(() => {
        if (requestId === mediaLibrarySaveRequestRef.current) setMediaLibraryLocationError('');
      })
      .catch(saveError => {
        if (requestId !== mediaLibrarySaveRequestRef.current) return;
        const message = `Unable to save media library location: ${String(saveError)}`;
        console.error(message, saveError);
        setMediaLibraryLocationError(message);
        setLogs(logs => [...logs, message]);
      });
  }

  useEffect(() => {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'loadMediaLibraryPath')) return;
    let isCurrent = true;
    void api.loadMediaLibraryPath()
      .then(async response => {
        if (!response.ok) throw new Error(response.error);
        if (!isCurrent) return;
        if (mediaLibraryPathChangedRef.current) {
          await persistMediaLibraryPath(mediaLibraryPathRef.current);
          return;
        }

        if (response.path !== null) {
          mediaLibraryPathRef.current = response.path;
          setMediaLibraryPath(response.path);
          const storageError = writePreference('mediaLibraryPath', response.path);
          if (storageError) {
            setMediaLibraryLocationError(storageError);
            setLogs(logs => [...logs, storageError]);
          }
        } else if (mediaLibraryPathRef.current) {
          await persistMediaLibraryPath(mediaLibraryPathRef.current);
        }
      })
      .catch(error => {
        if (!isCurrent) return;
        const message = `Unable to load saved media library location: ${String(error)}`;
        console.error(message, error);
        setMediaLibraryLocationError(message);
        setLogs(logs => [...logs, message]);
      });
    return () => { isCurrent = false; };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    const rootPath = mediaLibraryPath.trim();
    if (!rootPath) {
      setMediaLibraryFiles([]);
      return () => { isCurrent = false; };
    }

    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'readdirRecursive')) {
      const message = 'Unable to load player media controls: media library scanning is unavailable.';
      console.error(message);
      setMediaLibraryFiles([]);
      setLogs(logs => [...logs, message]);
      return () => { isCurrent = false; };
    }

    setMediaLibraryFiles([]);
    void api.readdirRecursive(rootPath)
      .then(result => {
        if (!isCurrent) return;
        if (!result.ok) throw new Error(result.error);
        setMediaLibraryFiles(result.files);
      })
      .catch(error => {
        if (!isCurrent) return;
        const message = `Unable to scan media library for player controls: ${String(error)}`;
        console.error(message, error);
        setMediaLibraryFiles([]);
        setLogs(logs => [...logs, message]);
      });

    return () => { isCurrent = false; };
  }, [mediaLibraryPath]);

  async function browseMediaLibraryPath() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseFolder')) {
      const message = 'Folder picker is unavailable.';
      setMediaLibraryLocationError(message);
      setLogs(logs => [...logs, message]);
      return;
    }

    try {
      const result = await api.chooseFolder();
      if (result.canceled) {
        const error = result.error;
        if (error) {
          setMediaLibraryLocationError(error);
          setLogs(logs => [...logs, error]);
        }
        return;
      }

      const folderPath = result.paths[0];
      if (!folderPath) throw new Error('The folder picker returned no folder.');
      saveMediaLibraryPath(folderPath);
    } catch (error) {
      const message = `Unable to choose media library location: ${String(error)}`;
      console.warn(message, error);
      setMediaLibraryLocationError(message);
      setLogs(logs => [...logs, message]);
    }
  }
    // track id currently requested for playback (synchronous guard across async callbacks)
    const currentTrackIdRef = useRef<string | null>(null);
    const trackPreviewTimerRef = useRef<number | null>(null);
    const createResumePositionRef = useRef<() => PlaybackResumePosition | null>(() => null);
    createResumePositionRef.current = () => {
      const trackIndex = currentTrackIdRef.current
        ? tracks.findIndex(track => track.id === currentTrackIdRef.current)
        : current;
      const track = trackIndex == null || trackIndex < 0 ? null : tracks[trackIndex] ?? null;
      if (!track || !selectedPlaylistName) return null;

      const shifter = shifterRef.current;
      const media = activeMediaRef.current;
      const shifterTime = shifter && pitchShifterTrackIdRef.current === track.id
        ? shifter.timePlayed
        : undefined;
      const activeTime = Number.isFinite(shifterTime)
        ? shifterTime
        : media && !media.paused && Number.isFinite(media.currentTime)
          ? media.currentTime
          : seekTime;

      return {
        playlistName: selectedPlaylistName,
        trackId: track.id,
        trackPath: getTrackFilePath(track),
        trackName: track.name,
        time: Number.isFinite(activeTime) ? Math.max(0, activeTime) : 0,
        backingActive: track.backingActive === true
      };
    };

    useEffect(() => {
      const savePosition = (force = false) => {
        const now = Date.now();
        if (!force && now - lastResumeSaveAtRef.current < 1000) return;
        const position = createResumePositionRef.current();
        if (!position) return;
        writePlaybackResumePosition(position);
        lastResumeSaveAtRef.current = now;
      };
      const interval = window.setInterval(() => savePosition(), 1000);
      const saveOnExit = () => savePosition(true);
      window.addEventListener('pagehide', saveOnExit);
      window.addEventListener('beforeunload', saveOnExit);
      return () => {
        window.clearInterval(interval);
        window.removeEventListener('pagehide', saveOnExit);
        window.removeEventListener('beforeunload', saveOnExit);
      };
    }, []);


  function ensureAudioGraph() {
    const a = audioRef.current;
    if (!a || audioCtxRef.current) return;
    try {
      const C = getAudioContextConstructor();
      if (!C) return;
      const ctx = new C();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaElementSource(a);
      const gain = ctx.createGain();
      let panner: any = null;
      let analyser: AnalyserNode | null = null;
      try { panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null; } catch(e) { panner = null; }
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
      } catch (error) {
        const message = `Audio output meter unavailable: ${String(error)}`;
        console.warn(message, error);
        setLogs(logs => [...logs, message]);
      }
      sourceRef.current = src;
      gainRef.current = gain;
      pannerRef.current = panner;
      analyserRef.current = analyser;
      let pannerConnected = false;
      if (panner) {
        try {
          src.connect(panner);
          panner.connect(gain);
          pannerConnected = true;
        } catch (error) {
          const message = `Unable to connect stereo pan audio processing: ${String(error)}`;
          console.warn(message, error);
          setLogs(logs => [...logs, message]);
          try {
            src.connect(gain);
          } catch (fallbackError) {
            const fallbackMessage = `Unable to connect audio output: ${String(fallbackError)}`;
            console.error(fallbackMessage, fallbackError);
            setLogs(logs => [...logs, fallbackMessage]);
            reportPlaybackFailure(fallbackMessage);
          }
        }
      } else {
        try {
          src.connect(gain);
        } catch (error) {
          const message = `Unable to connect audio output: ${String(error)}`;
          console.error(message, error);
          setLogs(logs => [...logs, message]);
          reportPlaybackFailure(message);
        }
      }

      try {
        if (analyser) {
          gain.connect(analyser);
          analyser.connect(ctx.destination);
          audioOutputRouteRef.current = `audio element -> ${pannerConnected ? 'stereo panner -> ' : ''}gain -> output meter -> destination`;
        } else {
          gain.connect(ctx.destination);
          audioOutputRouteRef.current = `audio element -> ${pannerConnected ? 'stereo panner -> ' : ''}gain -> destination (meter unavailable)`;
        }
      } catch (error) {
        if (analyser) {
          const message = `Unable to connect audio output meter; using direct output: ${String(error)}`;
          console.warn(message, error);
          setLogs(logs => [...logs, message]);
          analyserRef.current = null;
          try {
            gain.connect(ctx.destination);
            audioOutputRouteRef.current = `audio element -> ${pannerConnected ? 'stereo panner -> ' : ''}gain -> destination (meter bypassed)`;
          } catch (fallbackError) {
            const fallbackMessage = `Unable to connect audio output to the device: ${String(fallbackError)}`;
            console.error(fallbackMessage, fallbackError);
            setLogs(logs => [...logs, fallbackMessage]);
            reportPlaybackFailure(fallbackMessage);
          }
        } else {
          const message = `Unable to connect audio output to the device: ${String(error)}`;
          console.error(message, error);
          setLogs(logs => [...logs, message]);
          reportPlaybackFailure(message);
        }
      }
      gain.gain.value = volume;
      if (panner && typeof panner.pan !== 'undefined') panner.pan.value = pan;
      const message = `[Audio diagnostics] Audio graph ready: ${audioOutputRouteRef.current}; context=${ctx.state}; sampleRate=${ctx.sampleRate} Hz; volume=${volume}; gain=${gain.gain.value}; pan=${panner?.pan?.value ?? 'unavailable'}`;
      setLogs(logs => [...logs, message]);
      appendElectronLog(message);
    } catch (error) {
      const message = `Audio output setup failed: ${String(error)}`;
      console.error(message, error);
      setLogs(logs => [...logs, message]);
      reportPlaybackFailure(message);
    }
  }

  function resumeAudioContextFromUserGesture() {
    ensureAudioGraph();
    const audioContext = audioCtxRef.current;
    if (!audioContext || audioContext.state === 'running') return Promise.resolve(true);

    const reportResumeFailure = (error: unknown) => {
      const message = `Audio output could not be started because the audio context did not resume: ${String(error || audioContext.state)}`;
      console.error(message, error);
      setLogs(logs => [...logs, message]);
      reportPlaybackFailure(message);
      return false;
    };

    try {
      return audioContext.resume().then(
        () => audioContext.state === 'running' ? true : reportResumeFailure(audioContext.state),
        reportResumeFailure
      );
    } catch (error) {
      return Promise.resolve(reportResumeFailure(error));
    }
  }

  // create audio graph when audio element is available
  useEffect(() => {
    ensureAudioGraph();
  }, [audioRef]);

  function recordAudioDiagnosticEvent(event: string, media = activeMediaRef.current) {
    const context = audioCtxRef.current;
    const sinkId = context && 'sinkId' in context ? String(context.sinkId) : 'default';
    const outputRoute = media === videoRef.current
      ? `video element -> ${videoPitchNodeRef.current ? 'pitch processor -> ' : ''}${pannerRef.current ? 'stereo panner -> ' : ''}gain -> ${analyserRef.current ? 'output meter -> ' : ''}destination`
      : audioOutputRouteRef.current;
    const message = [
      `[Audio diagnostics] ${event}`,
      `media=${media === videoRef.current ? 'video' : media === audioRef.current ? 'audio' : 'none'}`,
      `src=${media?.currentSrc || media?.src || 'none'}`,
      `crossOrigin=${media?.crossOrigin || 'no-cors'}`,
      `playing=${media ? !media.paused : false}`,
      `mediaTime=${media?.currentTime.toFixed(2) ?? '—'}s`,
      `readyState=${media?.readyState ?? '—'}/4`,
      `mediaVolume=${media?.volume ?? '—'}`,
      `muted=${media?.muted ?? '—'}`,
      `mediaError=${media?.error ? `${media.error.code}:${media.error.message || 'unknown'}` : 'none'}`,
      `context=${context?.state || 'not created'}`,
      `sampleRate=${context?.sampleRate ?? '—'}Hz`,
      `outputLatency=${context && 'outputLatency' in context ? String(context.outputLatency) : 'unavailable'}`,
      `sink=${sinkId}`,
      `gain=${gainRef.current?.gain?.value ?? 'unavailable'}`,
      `pan=${pannerRef.current?.pan?.value ?? 'unavailable'}`,
      `route=${outputRoute}`
    ].join('; ');
    console.info(message);
    setLogs(logs => [...logs, message]);
    appendElectronLog(message);
  }

  // reflect volume and pan changes into graph and element
  useEffect(() => {
    if (audioRef.current) {
      try { audioRef.current.volume = volume; }
      catch (error) {
        console.warn('Unable to apply audio volume', error);
        setLogs(logs => [...logs, `Unable to apply audio volume: ${String(error)}`]);
      }
    }
    if (karaokeAccompanimentRef.current) {
      try { karaokeAccompanimentRef.current.volume = volume; }
      catch (error) {
        console.warn('Unable to apply karaoke accompaniment volume', error);
        setLogs(logs => [...logs, `Unable to apply karaoke accompaniment volume: ${String(error)}`]);
      }
    }
    if (videoRef.current) {
      try { videoRef.current.volume = videoSourceRef.current ? 1 : volume; }
      catch (error) {
        console.warn('Unable to apply video volume', error);
        setLogs(logs => [...logs, `Unable to apply video volume: ${String(error)}`]);
      }
    }
    if (gainRef.current) {
      try { gainRef.current.gain.value = volume; }
      catch (error) {
        console.warn('Unable to apply audio gain', error);
        setLogs(logs => [...logs, `Unable to apply audio gain: ${String(error)}`]);
      }
    }
    try {
      localStorage.setItem('volume', String(volume));
    } catch (error) {
      console.warn('Unable to save volume setting', error);
      setLogs(logs => [...logs, `Unable to save volume setting: ${String(error)}`]);
    }
  }, [volume]);
  useEffect(() => {
    if (pannerRef.current && typeof pannerRef.current.pan !== 'undefined') {
      try { pannerRef.current.pan.value = pan; }
      catch (error) {
        console.warn('Unable to apply audio pan', error);
        setLogs(logs => [...logs, `Unable to apply audio pan: ${String(error)}`]);
      }
    }
    try {
      localStorage.setItem('pan', String(pan));
    } catch (error) {
      console.warn('Unable to save pan setting', error);
      setLogs(logs => [...logs, `Unable to save pan setting: ${String(error)}`]);
    }
  }, [pan]);

  // Keep each active pitch processor in sync with the transpose control.
  useEffect(() => {
    transposeRef.current = transpose;
    videoTransposeRef.current = transpose;
    try {
      localStorage.setItem('transposeSemitones', String(transpose));
    } catch (error) {
      console.warn('Unable to save transpose setting', error);
      setLogs(logs => [...logs, `Unable to save transpose setting: ${String(error)}`]);
    }
    let restartingWithoutPitchShift = false;
    if (shifterRef.current) {
      try {
        const activeShifter = shifterRef.current;
        if (pitchShifterTrackIdRef.current !== currentTrackIdRef.current) {
          activeShifter.disconnect();
          shifterRef.current = null;
          pitchShifterTrackIdRef.current = null;
          setLogs(logs => [...logs, 'Discarded a pitch shifter belonging to a previous track']);
        } else if (transpose === 0) {
          const activeIndex = tracks.findIndex(track => track.id === currentTrackIdRef.current);
          const startTime = Number.isFinite(activeShifter.timePlayed)
            ? activeShifter.timePlayed
            : activeShifter.sourcePosition && activeShifter.sampleRate
              ? activeShifter.sourcePosition / activeShifter.sampleRate
              : seekTime;
          const shouldPlay = isPlaying || playbackStartingRef.current;
          activeShifter.disconnect();
          shifterRef.current = null;
          pitchShifterTrackIdRef.current = null;
          restartingWithoutPitchShift = true;
          if (activeIndex >= 0) {
            void playIndex(activeIndex, { startTime, shouldPlay });
          }
        } else {
          applyPitchWithoutTempoChange(activeShifter, transpose);
          const activeTrack = tracks.find(track => track.id === currentTrackIdRef.current);
          setLogs(logs => [...logs, `Transpose ${transpose >= 0 ? '+' : ''}${transpose} semitones applied to ${activeTrack?.name || currentTrackIdRef.current}; tempo held at 1x`]);
        }
      } catch (error) {
        console.warn('MP3 transpose update failed', error);
        setLogs(logs => [...logs, `MP3 transpose update failed: ${String(error)}`]);
      }
    }
    if (videoSoundTouchRef.current) {
      try {
        applyPitchWithoutTempoChange(videoSoundTouchRef.current, transpose);
      } catch (error) {
        console.warn('Video transpose update failed', error);
        setLogs(logs => [...logs, `Video transpose update failed: ${String(error)}`]);
      }
    }
    const activeIndex = currentTrackIdRef.current
      ? tracks.findIndex(track => track.id === currentTrackIdRef.current)
      : current;
    const activeTrack = activeIndex == null || activeIndex < 0 ? null : tracks[activeIndex] ?? null;
    const audio = audioRef.current;
    if (
      !restartingWithoutPitchShift &&
      !shifterRef.current &&
      activeIndex != null &&
      activeIndex >= 0 &&
      activeTrack &&
      !isVideoTrack(activeTrack) &&
      currentTrackIdRef.current === activeTrack.id &&
      activeMediaRef.current === audio &&
      audio
    ) {
      const shouldPlay = isPlaying || !audio.paused;
      void playIndex(activeIndex, {
        startTime: Number.isFinite(audio.currentTime) ? audio.currentTime : seekTime,
        shouldPlay
      });
    }
  }, [transpose]);

  function formatTime(t: number) {
    if (!t || isNaN(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function isVideoTrack(track: Track | null | undefined) {
    return /\.mp4$/i.test(track?.name || track?.path || '');
  }

  async function decodeTrackForPitchShift(src: string, track: Track, audioContext: AudioContext) {
    const failures: string[] = [];
    const startedAt = performance.now();
    let readMs = 0;
    let processingMs = 0;
    let bytes = 0;
    const decode = async (data: ArrayBuffer) => {
      if (!data.byteLength) throw new Error('audio source is empty');
      bytes = data.byteLength;
      const processingStartedAt = performance.now();
      try {
        return await audioContext.decodeAudioData(data.slice(0));
      } finally {
        processingMs += performance.now() - processingStartedAt;
      }
    };

    try {
      const readStartedAt = performance.now();
      let data: ArrayBuffer;
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`fetch returned HTTP ${response.status}`);
        data = await response.arrayBuffer();
      } finally {
        readMs += performance.now() - readStartedAt;
      }
      const buffer = await decode(data);
      recordPitchShiftDecode({
        durationMs: performance.now() - startedAt,
        readMs,
        processingMs,
        bytes,
        source: 'music stream'
      }, track.name);
      return buffer;
    } catch (error) {
      failures.push(`fetch: ${String(error)}`);
    }

    if (track.file) {
      try {
        const readStartedAt = performance.now();
        let data: ArrayBuffer;
        try {
          data = await track.file.arrayBuffer();
        } finally {
          readMs += performance.now() - readStartedAt;
        }
        const buffer = await decode(data);
        setLogs(logs => [...logs, `PitchShifter loaded ${track.name} from its file object`]);
        recordPitchShiftDecode({
          durationMs: performance.now() - startedAt,
          readMs,
          processingMs,
          bytes,
          source: 'File object'
        }, track.name);
        return buffer;
      } catch (error) {
        failures.push(`file object: ${String(error)}`);
      }
    }

    const api = window.electronAPI;
    if (track.path && hasElectronCapability(api, 'readFile')) {
      try {
        const readStartedAt = performance.now();
        let data: ArrayBuffer;
        try {
          const result = await api.readFile(track.path);
          if (!result?.ok || !result.data) {
            throw new Error(result?.error || 'file read returned no data');
          }
          const binary = atob(result.data);
          const fileBytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) {
            fileBytes[index] = binary.charCodeAt(index);
          }
          data = fileBytes.buffer;
        } finally {
          readMs += performance.now() - readStartedAt;
        }
        const buffer = await decode(data);
        setLogs(logs => [...logs, `PitchShifter loaded ${track.name} from disk`]);
        recordPitchShiftDecode({
          durationMs: performance.now() - startedAt,
          readMs,
          processingMs,
          bytes,
          source: 'Electron readFile'
        }, track.name);
        return buffer;
      } catch (error) {
        failures.push(`disk read: ${String(error)}`);
      }
    }

    const error = new Error(`Unable to decode ${track.name} for transpose (${failures.join('; ')})`);
    recordPitchShiftDecode({
      durationMs: performance.now() - startedAt,
      readMs,
      processingMs,
      bytes,
      source: 'failed'
    }, track.name, error);
    throw error;
  }

  function clearPitchShiftBufferCache() {
    pitchShiftBufferCacheRef.current = null;
    pitchShiftDecodeRequestRef.current = null;
  }

  async function getPitchShiftBuffer(src: string, track: Track, audioContext: AudioContext) {
    const cached = pitchShiftBufferCacheRef.current;
    if (cached?.trackId === track.id && cached.src === src) {
      recordPitchShiftCacheHit();
      return cached.buffer;
    }

    const pending = pitchShiftDecodeRequestRef.current;
    if (pending?.trackId === track.id && pending.src === src) {
      recordPitchShiftCacheHit();
      return pending.promise;
    }

    const promise = decodeTrackForPitchShift(src, track, audioContext);
    const request = { trackId: track.id, src, promise };
    pitchShiftDecodeRequestRef.current = request;

    try {
      const buffer = await promise;
      if (
        pitchShiftDecodeRequestRef.current === request &&
        currentTrackIdRef.current === track.id
      ) {
        pitchShiftDecodeRequestRef.current = null;
        pitchShiftBufferCacheRef.current = { trackId: track.id, src, buffer };
      }
      return buffer;
    } catch (error) {
      if (pitchShiftDecodeRequestRef.current === request) {
        pitchShiftDecodeRequestRef.current = null;
      }
      throw error;
    }
  }

  function mediaForTrack(track: Track | null | undefined) {
    return isVideoTrack(track) ? videoRef.current : audioRef.current;
  }

  function currentMedia() {
    const idx = current ?? selected;
    return idx == null ? null : mediaForTrack(tracks[idx]);
  }

  async function seekAndPlay(time: number) {
    const targetTime = Math.max(0, Number(time) || 0);
    const idx = current ?? selected;
    if (idx == null || !tracks[idx]) return;

    try {
      let media = mediaForTrack(tracks[idx]);
      if (!shifterRef.current && (!media || (!media.currentSrc && !media.getAttribute('src')))) {
        await playIndex(idx);
        media = mediaForTrack(tracks[idx]);
      }

      if (shifterRef.current) {
        const shifter = shifterRef.current;
        const dur = shifter.duration || duration || 0;
        shifter.percentagePlayed = dur ? Math.max(0, Math.min(1, targetTime / dur)) : 0;
        await (audioCtxRef.current?.state === 'suspended' ? audioCtxRef.current.resume() : Promise.resolve());
        if (!isPlaying) {
          if (pannerRef.current) shifter.connect(pannerRef.current);
          else if (gainRef.current) shifter.connect(gainRef.current);
        }
        setIsPlaying(true);
        setSeekTime(targetTime);
        return;
      }

      if (!media) return;
      media.currentTime = targetTime;
      if (media.paused) {
        await media.play();
      }
      setIsPlaying(true);
      setSeekTime(targetTime);
    } catch (err) {
      console.warn('seekAndPlay failed', err);
      setLogs(l => [...l, `seekAndPlay failed: ${String(err)}`]);
    }
  }
  const [showCover, setShowCover] = useState<boolean>(() => {
    try {
      const storedValue = localStorage.getItem('showCover');
      return storedValue === null ? true : storedValue === 'true';
    } catch {
      return true;
    }
  });
  const [mediaFront, setMediaFront] = useState<'lyrics'|'cover'>('lyrics');
  const [lyricsRaw, setLyricsRaw] = useState<string | null>(null);
  const [lyricsTimed, setLyricsTimed] = useState<Array<{time:number;text:string}>|null>(null);
  const [lyricsVisible, setLyricsVisible] = useState<boolean>(false);
  const [lyricsMode, setLyricsMode] = useState<'static'|'synchronized'>('synchronized');
  const [lyricsIndex, setLyricsIndex] = useState<number>(0);
  const [tagInfoVisible, setTagInfoVisible] = useState(false);
  const [tagEditorTrackId, setTagEditorTrackId] = useState<string | null>(null);
  const [tagEditorDraft, setTagEditorDraft] = useState<TagEditorDraft | null>(null);
  const [tagEditorLoading, setTagEditorLoading] = useState(false);
  const [tagEditorSaving, setTagEditorSaving] = useState(false);
  const [tagEditorError, setTagEditorError] = useState('');
  const [tagEditorMessage, setTagEditorMessage] = useState('');
  const tagEditorRequestRef = useRef(0);
  const [lyricsSearchResults, setLyricsSearchResults] = useState<OnlineLyricsResult[]>([]);
  const [lyricsSearchLoading, setLyricsSearchLoading] = useState(false);
  const [lyricsSearchError, setLyricsSearchError] = useState('');
  const [lyricsSearchNotice, setLyricsSearchNotice] = useState('');
  const [lyricsSearchCanRetry, setLyricsSearchCanRetry] = useState(false);
  const [lyricsSearchPage, setLyricsSearchPage] = useState(0);
  const [lyricsPickerOpen, setLyricsPickerOpen] = useState(false);
  const lyricsSearchRequestRef = useRef(0);
  const [metadataSearchResults, setMetadataSearchResults] = useState<OnlineMetadataResult[]>([]);
  const [metadataSearchLoading, setMetadataSearchLoading] = useState(false);
  const [metadataSearchError, setMetadataSearchError] = useState('');
  const [metadataSearchWarning, setMetadataSearchWarning] = useState('');
  const [metadataApplyIndex, setMetadataApplyIndex] = useState<number | null>(null);
  const [metadataPickerOpen, setMetadataPickerOpen] = useState(false);
  const [metadataSearchPage, setMetadataSearchPage] = useState(0);
  const [advancedMetadataSelection, setAdvancedMetadataSelection] = useState<{
    result: OnlineMetadataResult;
    resultIndex: number;
  } | null>(null);
  const [selectedMetadataFields, setSelectedMetadataFields] = useState<Set<OnlineMetadataApplyField>>(() => new Set());
  const [metadataOverwriteConfirmation, setMetadataOverwriteConfirmation] = useState<{
    result: OnlineMetadataResult;
    resultIndex: number;
    fields: Set<OnlineMetadataApplyField>;
    labels: string[];
  } | null>(null);
  const metadataSearchRequestRef = useRef(0);
  const metadataApplyRequestRef = useRef(0);
  const tagCoverInputRef = useRef<HTMLInputElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement|null>(null);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  useEffect(() => {
    const analyser = analyserRef.current;
    if ((!showDebug && !isPlaying) || !analyser) {
      setAudioOutputMeter(null);
      return;
    }

    const samples = new Float32Array(analyser.fftSize);
    const sampleOutput = () => {
      const media = activeMediaRef.current;
      if (!media || media.paused) {
        setAudioOutputMeter(null);
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      let sumOfSquares = 0;
      let peak = 0;
      for (const sample of samples) {
        sumOfSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(sumOfSquares / samples.length);
      if (showDebug) setAudioOutputMeter({ rms, peak });
      const now = Date.now();
      if (now - lastAudioMeterLogAtRef.current >= 2000) {
        lastAudioMeterLogAtRef.current = now;
        const message = `[Audio diagnostics] output signal before device: media=${media === videoRef.current ? 'video' : 'audio'}; RMS=${rms.toFixed(6)}; peak=${peak.toFixed(6)}; gain=${gainRef.current?.gain?.value ?? 'unavailable'}; context=${audioCtxRef.current?.state || 'not created'}`;
        console.info(message);
        setLogs(logs => [...logs, message]);
        appendElectronLog(message);
      }
    };

    sampleOutput();
    const interval = window.setInterval(sampleOutput, showDebug ? 500 : 1000);
    return () => window.clearInterval(interval);
  }, [showDebug, isPlaying, current]);

  const { attachLyricsTimeListener } = useLyricsPlayback({
    lyricsTimed,
    seekTime,
    lyricsIndex,
    setSeekTime,
    setLyricsIndex,
    audioRef,
    shifterRef,
    seekingRef,
    lyricsContainerRef
  });

  const [autoNext, setAutoNext] = useState<boolean>(true);
  const autoNextRef = useRef(true);
  const [loopPlaylist, setLoopPlaylist] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [draggedTrackIndex, setDraggedTrackIndex] = useState<number | null>(null);
  const [dropInsertionIndex, setDropInsertionIndex] = useState<number | null>(null);
  const draggedTrackIndexRef = useRef<number | null>(null);
  const trackListRef = useRef<HTMLUListElement | null>(null);
  const [trackVirtualWindow, setTrackVirtualWindow] = useState({ start: 0, end: 40 });
  const { trackCoverCache, extractCoverFromFile } = useCoverCache({
    tracks,
    current,
    selected,
    showCover,
    trackListRef,
    trackVirtualWindow,
    isVideoTrack,
    setLogs
  });
  const dragCounter = useRef<number>(0);

  useEffect(() => {
    autoNextRef.current = autoNext;
  }, [autoNext]);

  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);

  useEffect(() => {
    const metadataIndexes = new Set([selected, current].filter((index): index is number => index !== null));
    metadataIndexes.forEach(index => {
      const track = tracks[index];
      if (!track) return;
      if (isVideoTrack(track)) {
        if (!track.resolution) void loadTrackResolution(track);
      } else if (!Number.isFinite(track.bitrate)) {
        void loadTrackBitrate(track);
      }
    });
  }, [tracks, selected, current]);

  useEffect(() => {
    const list = trackListRef.current;
    if (!list) return;
    updateTrackVirtualWindow(list);
    const resizeObserver = new ResizeObserver(() => updateTrackVirtualWindow(list));
    resizeObserver.observe(list);
    return () => resizeObserver.disconnect();
  }, [tracks.length]);

  useEffect(() => {
    if (selected === null || tracks.length <= TRACK_LIST_VIRTUALIZATION_THRESHOLD) return;
    const list = trackListRef.current;
    if (!list) return;
    const rowTop = selected * TRACK_ROW_STRIDE;
    if (rowTop < list.scrollTop) {
      list.scrollTop = rowTop;
    } else if (rowTop + TRACK_ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowTop + TRACK_ROW_HEIGHT - list.clientHeight;
    }
    updateTrackVirtualWindow(list);
  }, [selected]);

  // load saved playlists once on mount (do not re-run on tracks change)
  useEffect(() => {
    const load = async () => {
      const api = window.electronAPI;
      const savedPosition = readPlaybackResumePosition();
      setResumePosition(savedPosition);
      const selectPlaylist = (normalized: Playlist[]) => {
        const saved = savedPosition
          ? normalized.find(playlist => playlist.name === savedPosition.playlistName)
          : null;
        let defaultName: string | null = null;
        try {
          defaultName = localStorage.getItem('defaultPlaylistName');
        } catch (error) {
          console.warn('Unable to read default playlist setting', error);
        }
        const playlist = saved || (defaultName
          ? normalized.find(item => item.name === defaultName)
          : null) || normalized[0] || null;
        if (playlist) {
          setSelectedPlaylistName(playlist.name);
          setPlaylistNameDraft(playlist.name);
          setTracks(playlist.tracks || []);
        }
      };
      const normalizePlaylists = (savedPlaylists: any[]) => savedPlaylists.map((playlist: any) => {
        const normalizedTracks = (playlist.tracks || []).map((track: any) => {
          const normalizedTrack: Track = {
            id: track.id,
            name: track.name,
            path: track.path,
            src: track.src,
            cover: track.cover,
            bitrate: track.bitrate,
            resolution: track.resolution
          };
          normalizedTrack.path = getTrackFilePath(normalizedTrack);
          if (api && normalizedTrack.path) {
            normalizedTrack.src = musicFileUrl(normalizedTrack.path);
          } else if (normalizedTrack.src?.startsWith('blob:')) {
            normalizedTrack.src = undefined;
          }
          if (normalizedTrack.cover?.startsWith('blob:')) normalizedTrack.cover = undefined;
          return normalizedTrack;
        });
        return { name: playlist.name, tracks: normalizedTracks };
      });

      try {
        if (hasElectronCapability(api, 'loadPlaylists')) {
          const res = await api.loadPlaylists();
          if (res && res.ok && Array.isArray(res.playlists)) {
            const normalized = normalizePlaylists(res.playlists);

            playlistsRef.current = normalized;
            setPlaylists(normalized);
            selectPlaylist(normalized);
            setPlaylistsReady(true);
            return;
          }
          if (res && !res.ok) {
            const message = `Unable to load saved playlists from Electron: ${res.error || 'unknown error'}`;
            console.warn(message);
            setLogs(logs => [...logs, message]);
          }
        }
      } catch (error) {
        console.warn('loadPlaylists electron failed', error);
        setLogs(logs => [...logs, `Unable to load saved playlists from Electron: ${String(error)}`]);
      }
      // fallback to localStorage
      try {
        const raw = localStorage.getItem('playlists');
        if (raw) {
          const arr = JSON.parse(raw || '[]');
          if (Array.isArray(arr)) {
            const normalized = normalizePlaylists(arr);
            playlistsRef.current = normalized;
            setPlaylists(normalized);
            selectPlaylist(normalized);
          }
        }
      } catch (error) {
        console.warn('Unable to load saved playlists from local storage', error);
        setLogs(logs => [...logs, `Unable to load saved playlists from local storage: ${String(error)}`]);
      }
      setPlaylistsReady(true);
    };
    load();
  }, []);

  // when playlists change and no selection, default to first playlist
  useEffect(() => {
    if ((!selectedPlaylistName || selectedPlaylistName === '') && playlists && playlists.length > 0) {
      const p = playlists[0];
      setSelectedPlaylistName(p.name);
      setPlaylistNameDraft(p.name);
      setTracks(p.tracks || []);
    }
  }, [playlists]);

  useEffect(() => {
    if (!playlistsReady || !resumePosition || resumeRestoreAttemptedRef.current || !tracks.length) return;
    if (selectedPlaylistName !== resumePosition.playlistName && playlists.some(playlist => playlist.name === resumePosition.playlistName)) return;

    const normalizedPath = resumePosition.trackPath?.replace(/\\/g, '/').toLowerCase();
    const index = tracks.findIndex(track => track.id === resumePosition.trackId);
    const matchingIndex = index >= 0
      ? index
      : tracks.findIndex(track =>
          normalizedPath && track.path?.replace(/\\/g, '/').toLowerCase() === normalizedPath
        );
    const resolvedIndex = matchingIndex >= 0
      ? matchingIndex
      : tracks.findIndex(track => track.name === resumePosition.trackName);
    if (resolvedIndex < 0) {
      resumeRestoreAttemptedRef.current = true;
      return;
    }

    resumeRestoreAttemptedRef.current = true;
    setResumePosition(null);
    setSelected(resolvedIndex);
    setSelectedTrackIds(new Set([tracks[resolvedIndex].id]));
    void playIndex(resolvedIndex, {
      startTime: resumePosition.time,
      backingActive: resumePosition.backingActive,
      shouldPlay: false
    });
  }, [playlistsReady, playlists, resumePosition, selectedPlaylistName, tracks]);

  // keyboard delete handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || selectedTrackIds.size === 0) return;
      const target = e.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.closest('input, textarea, select, [contenteditable="true"]')
      )) return;
      e.preventDefault();
      void deleteSelectedTracks();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTrackIds, tracks, playlists, selectedPlaylistName, current, selected, tagEditorTrackId]);

  // load preferences from localStorage
  useEffect(() => {
    try {
      const sv = localStorage.getItem('showCover');
      setShowCover(sv === null ? true : sv === 'true');
      const an = localStorage.getItem('autoNext');
      setAutoNext(an === null ? true : an === 'true');
      const lp = localStorage.getItem('loopPlaylist');
      setLoopPlaylist(lp === 'true');
    } catch (error) {
      console.warn('Unable to load player preferences from local storage', error);
      setLogs(logs => [...logs, `Unable to load player preferences: ${String(error)}`]);
    }
  }, []);

  // Show the accompaniment control only when a matching output exists.
  useEffect(() => {
    const check = async () => {
      const activeIndex = current ?? selected;
      if (activeIndex == null) return;
      const t = tracks[activeIndex];
      if (!t || !t.path) return;
      const candidates = resolveBackingTrackCandidates(t.path, mediaLibraryPath);
      try {
        const api = window.electronAPI;
        if (!hasElectronCapability(api, 'stat')) return;
        for (const candidate of candidates) {
          const result = await api.stat(candidate);
          if (result?.ok && result.isFile) {
            setBackingAvailableMap(currentMap => ({ ...currentMap, [t.id]: true }));
            return;
          }
        }
        setBackingAvailableMap(m => ({ ...m, [t.id]: false }));
      } catch (error) {
        console.warn(`Unable to check accompaniment output for ${t.name}`, error);
        setLogs(currentLogs => [...currentLogs, `Unable to check accompaniment output for ${t.name}: ${String(error)}`]);
        setBackingAvailableMap(m => ({ ...m, [t.id]: false }));
      }
    };
    check();
  }, [current, selected, tracks, mediaLibraryPath]);

  async function loadTrackBitrate(track: Track) {
    if (isVideoTrack(track) || Number.isFinite(track.bitrate) || bitrateRequestRef.current.has(track.id)) return;
    bitrateRequestRef.current.add(track.id);
    const api = window.electronAPI;
    try {
      let bitrate: number | undefined;
      if (track.path && hasElectronCapability(api, 'getBitrate')) {
        const result = await api.getBitrate(track.path);
        if (!result?.ok) throw new Error(result?.error || `Could not read bitrate for ${track.name}`);
        const value = Number(result.bitrate);
        if (Number.isFinite(value) && value > 0) bitrate = value;
      }
      if (!bitrate && track.file) {
        const metadata = await parseAudioBlob(track.file);
        const value = Number(metadata?.format?.bitrate);
        if (Number.isFinite(value) && value > 0) bitrate = value;
      }
      if (!bitrate) {
        setLogs(currentLogs => [...currentLogs, `bitrate unavailable for ${track.name}`]);
        return;
      }
      setTracks(currentTracks => currentTracks.map(item =>
        item.id === track.id || (track.path && item.path === track.path) ? { ...item, bitrate } : item
      ));
      setPlaylists(currentPlaylists => currentPlaylists.map(playlist => ({
        ...playlist,
        tracks: playlist.tracks.map(item =>
          item.id === track.id || (track.path && item.path === track.path) ? { ...item, bitrate } : item
        )
      })));
    } catch (error) {
      console.warn(`Unable to read bitrate for ${track.name}`, error);
      setLogs(currentLogs => [...currentLogs, `bitrate read failed for ${track.name}: ${String(error)}`]);
    } finally {
      bitrateRequestRef.current.delete(track.id);
    }
  }

  async function loadTrackResolution(track: Track) {
    if (!isVideoTrack(track) || track.resolution || resolutionRequestRef.current.has(track.id)) return;
    resolutionRequestRef.current.add(track.id);
    try {
      const source = track.src || (track.path ? musicFileUrl(track.path) : undefined);
      if (!source) throw new Error(`No video source available for ${track.name}`);

      const resolution = await new Promise<string>((resolve, reject) => {
        const video = document.createElement('video');
        let timeout = 0;
        const cleanup = () => {
          window.clearTimeout(timeout);
          video.onloadedmetadata = null;
          video.onerror = null;
          video.removeAttribute('src');
          video.load();
        };
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          const { videoWidth, videoHeight } = video;
          if (!videoWidth || !videoHeight) {
            cleanup();
            reject(new Error(`Video dimensions unavailable for ${track.name}`));
            return;
          }
          const label = getVideoResolutionLabel(videoWidth, videoHeight);
          cleanup();
          resolve(label);
        };
        video.onerror = () => {
          cleanup();
          reject(new Error(`Could not load video metadata for ${track.name}`));
        };
        timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out loading video metadata for ${track.name}`));
        }, 15000);
        video.src = source;
        video.load();
      });

      setTracks(currentTracks => currentTracks.map(item =>
        item.id === track.id || (track.path && item.path === track.path) ? { ...item, resolution } : item
      ));
      setPlaylists(currentPlaylists => currentPlaylists.map(playlist => ({
        ...playlist,
        tracks: playlist.tracks.map(item =>
          item.id === track.id || (track.path && item.path === track.path) ? { ...item, resolution } : item
        )
      })));
    } catch (error) {
      console.warn(`Unable to read video resolution for ${track.name}`, error);
      setLogs(currentLogs => [...currentLogs, `video resolution read failed for ${track.name}: ${String(error)}`]);
    } finally {
      resolutionRequestRef.current.delete(track.id);
    }
  }

  function parseTimestampedLyrics(text: string): Array<{time:number;text:string}> {
    const out: Array<{time:number;text:string}> = [];
    if (!text) return out;
    const lines = text.split(/\r?\n/);
    const offsetMatch = text.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im);
    const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
    const timeRe = /^\s*\[?(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]?\s*/;
    for (const line of lines) {
      let remaining = line;
      const times: number[] = [];
      let m: RegExpMatchArray | null;
      while ((m = remaining.match(timeRe))) {
        const mins = parseInt(m[1], 10);
        const secs = parseInt(m[2], 10);
        const ms = m[3] ? parseInt((m[3] + '00').slice(0,3), 10) : 0;
        times.push(Math.max(0, mins * 60 + secs + ms / 1000 + offsetSeconds));
        remaining = remaining.slice(m[0].length);
      }
      if (times.length) {
        const textPart = remaining.trimStart();
        for (const time of times) out.push({ time, text: textPart });
      }
    }
    // sort by time
    out.sort((a,b)=>a.time-b.time);
    return out;
  }

  function getEmbeddedLyrics(metadata: IAudioMetadata) {
    const lyrics = metadata.common.lyrics ?? [];
    const timed = lyrics.flatMap(lyric => (lyric.syncText || []).flatMap(line => {
      if (typeof line.timestamp !== 'number' || !Number.isFinite(line.timestamp)) return [];
      return typeof line.text === 'string' && line.text.trim()
        ? [{ time: line.timestamp / 1000, text: line.text }]
        : [];
    }));
    const text = normalizeLyricsText(lyrics) || timed.map(line => line.text).join('\n');
    return { text, timed };
  }

  async function getLyricsForTrack(t: Track, requestId?: number): Promise<boolean> {
    try {
      const api = window.electronAPI;
      const setLyrics = async (raw: string | null, timed: Array<{time:number;text:string}> | null) => {
        if (requestId !== undefined && requestId !== lyricsLoadRequestRef.current) return;
        const traditionalRaw = raw ? await toTraditionalLyrics(raw) : raw;
        const traditionalTimed = timed
          ? await Promise.all(timed
            .filter(item => Number.isFinite(item.time))
            .map(async item => ({ ...item, text: await toTraditionalLyrics(item.text) })))
          : null;
        if (requestId !== undefined && requestId !== lyricsLoadRequestRef.current) return;
        setLyricsRaw(traditionalRaw);
        setLyricsTimed(traditionalTimed?.sort((a, b) => a.time - b.time) || null);
      };
      await setLyrics(null, null);
      // Ask main process (preferred for files on disk)
      if (t.path && hasElectronCapability(api, 'getLyrics')) {
        try {
          const res = await api.getLyrics(t.path);
          if (res && res.ok) {
            if (res.timed && Array.isArray(res.timed) && res.timed.length) {
              await setLyrics(res.lyrics || null, res.timed.map((it:any)=>({ time: Number(it.time)||0, text: String(it.text||'') })));
              return true;
            } else {
              // attempt to parse timestamped lines from returned lyrics text
              if (res.lyrics && typeof res.lyrics === 'string') {
                const parsed = parseTimestampedLyrics(res.lyrics);
                if (parsed.length) { await setLyrics(res.lyrics, parsed); return true; }
              }
              await setLyrics(res.lyrics || null, null);
              return false;
            }
          }
        } catch (e) { /* ignore */ }
      }

      // Try reading embedded lyrics from the selected file.
      try {
        if (t.file) {
          const meta = await parseAudioBlob(t.file);
          const { text, timed } = getEmbeddedLyrics(meta);
          if (text) {
            const parsed = timed.length ? timed : parseTimestampedLyrics(text);
            if (parsed.length) { await setLyrics(text, parsed); return true; }
            await setLyrics(text, null);
            return false; }
        }
      } catch (e) { /* ignore */ }

      // fallback: if path available, read file via electron readFile and parse blob (client-side parse)
      try {
        if (t.path && hasElectronCapability(api, 'readFile')) {
          const rf = await api.readFile(t.path);
          if (rf && rf.ok && rf.data) {
            const binary = atob(rf.data);
            const len = binary.length;
            const u8 = new Uint8Array(len);
            for (let j = 0; j < len; j++) u8[j] = binary.charCodeAt(j);
            const blob = new Blob([u8], { type: rf.mime || 'application/octet-stream' });
            const meta = await parseAudioBlob(blob);
            const { text, timed } = getEmbeddedLyrics(meta);
            if (text) {
              const parsed = timed.length ? timed : parseTimestampedLyrics(text);
              if (parsed.length) { await setLyrics(text, parsed); return true; }
              await setLyrics(text, null);
              return false;
            }
          }
        }
      } catch (e) { /* ignore */ }

      // nothing found
      await setLyrics(null, null);
      return false;
    } catch (e) {
      if (requestId === undefined || requestId === lyricsLoadRequestRef.current) {
        setLyricsRaw(null);
        setLyricsTimed(null);
        console.warn(`Unable to load lyrics for ${t.name}`, e);
        setLogs(logs => [...logs, `Unable to load lyrics for ${t.name}: ${String(e)}`]);
      }
      return false;
    }
  }

  async function openTagEditor(track: Track, index: number, preserveSelection = false) {
    const requestId = ++tagEditorRequestRef.current;
    const trackPath = getTrackFilePath(track);
    lyricsSearchRequestRef.current++;
    metadataSearchRequestRef.current++;
    metadataApplyRequestRef.current++;
    setLyricsSearchResults([]);
    setLyricsSearchLoading(false);
    setLyricsSearchError('');
    setLyricsSearchNotice('');
    setLyricsSearchCanRetry(false);
    setLyricsSearchPage(0);
    setLyricsPickerOpen(false);
    setMetadataSearchResults([]);
    setMetadataSearchLoading(false);
    setMetadataSearchError('');
    setMetadataApplyIndex(null);
    setMetadataPickerOpen(false);
    setMetadataSearchPage(0);
    setAdvancedMetadataSelection(null);
    setSelectedMetadataFields(new Set());
    setMetadataOverwriteConfirmation(null);
    setSelected(index);
    if (!preserveSelection) {
      setSelectedTrackIds(new Set([track.id]));
      selectionAnchorTrackIdRef.current = track.id;
    }
    setTagInfoVisible(true);
    setTagEditorTrackId(track.id);
    const pathHints = parseTrackPathHints(trackPath);
    setTagEditorDraft({
      title: pathHints.title || track.name.replace(/\.[^.]+$/, ''),
      artist: pathHints.artist,
      album: pathHints.album,
      year: pathHints.year,
      track: pathHints.track,
      albumArtist: '',
      lyricist: '',
      composer: '',
      lyrics: '',
      coverMime: '',
      coverBase64: '',
      removeCover: false
    });
    const isMp3 = /\.mp3$/i.test(trackPath || track.name);
    setTagEditorLoading(isMp3 && !!trackPath);
    setTagEditorSaving(false);
    setTagEditorError('');
    setTagEditorMessage('');
    if (!isMp3) {
      setTagEditorError('Tag information is only available for MP3 files.');
      return;
    }
    if (!trackPath) {
      setTagEditorError('Cannot access the original file path for this MP3. Re-add it using Add files or Add folder.');
      return;
    }
    try {
      const api = window.electronAPI;
      if (!hasElectronCapability(api, 'readMp3Tags')) throw new Error('MP3 tag reader is unavailable.');
      const result = await api.readMp3Tags(trackPath);
      if (requestId !== tagEditorRequestRef.current) return;
      if (!result?.ok) throw new Error(result?.error || 'Unable to read MP3 tags.');
      const lyrics = await toTraditionalLyrics(String(result.lyrics || ''));
      if (requestId !== tagEditorRequestRef.current) return;
      setTagEditorDraft({
        title: String(result.title || ''),
        artist: String(result.artist || ''),
        album: String(result.album || ''),
        year: String(result.year || ''),
        track: String(result.track || ''),
        albumArtist: String(result.albumArtist || ''),
        lyricist: String(result.lyricist || ''),
        composer: String(result.composer || ''),
        lyrics,
        coverMime: String(result.coverMime || ''),
        coverBase64: String(result.coverBase64 || ''),
        removeCover: false
      });
    } catch (error) {
      if (requestId === tagEditorRequestRef.current) setTagEditorError(String(error));
    } finally {
      if (requestId === tagEditorRequestRef.current) setTagEditorLoading(false);
    }
  }

  function closeTagEditor() {
    tagEditorRequestRef.current++;
    lyricsSearchRequestRef.current++;
    metadataSearchRequestRef.current++;
    metadataApplyRequestRef.current++;
    setLyricsSearchResults([]);
    setLyricsSearchLoading(false);
    setLyricsSearchError('');
    setLyricsSearchNotice('');
    setLyricsSearchCanRetry(false);
    setLyricsSearchPage(0);
    setLyricsPickerOpen(false);
    setMetadataSearchResults([]);
    setMetadataSearchLoading(false);
    setMetadataSearchError('');
    setMetadataApplyIndex(null);
    setMetadataPickerOpen(false);
    setMetadataSearchPage(0);
    setAdvancedMetadataSelection(null);
    setSelectedMetadataFields(new Set());
    setMetadataOverwriteConfirmation(null);
    setTagInfoVisible(false);
    setTagEditorTrackId(null);
    setTagEditorDraft(null);
    setTagEditorError('');
    setTagEditorMessage('');
  }

  function toggleTagInfo() {
    if (tagInfoVisible) {
      closeTagEditor();
      return;
    }
    const index = selected ?? current;
    const track = index == null ? null : tracks[index] ?? null;
    if (track && index != null) void openTagEditor(track, index);
  }

  function selectPlaylistTrack(index: number) {
    const track = tracks[index];
    setSelected(index);
    if (track) {
      setSelectedTrackIds(new Set([track.id]));
      selectionAnchorTrackIdRef.current = track.id;
    }
    if (tagInfoVisible) {
      if (track) void openTagEditor(track, index);
    }
  }

  function selectPlaylistTrackWithModifiers(index: number, event: React.MouseEvent<HTMLLIElement>) {
    const track = tracks[index];
    if (!track) return;
    setSelected(index);

    if (event.shiftKey) {
      const anchorIndex = selectionAnchorTrackIdRef.current
        ? tracks.findIndex(item => item.id === selectionAnchorTrackIdRef.current)
        : index;
      const start = Math.min(anchorIndex < 0 ? index : anchorIndex, index);
      const end = Math.max(anchorIndex < 0 ? index : anchorIndex, index);
      const rangeIds = tracks.slice(start, end + 1).map(item => item.id);
      setSelectedTrackIds(previous => {
        const next = new Set(event.ctrlKey || event.metaKey ? previous : []);
        rangeIds.forEach(id => next.add(id));
        return next;
      });
      if (tagInfoVisible) void openTagEditor(track, index, true);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      selectionAnchorTrackIdRef.current = track.id;
      setSelectedTrackIds(previous => {
        const next = new Set(previous);
        if (next.has(track.id)) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
      if (tagInfoVisible) void openTagEditor(track, index, true);
      return;
    }

    selectPlaylistTrack(index);
  }

  function handlePlaylistTrackClick(index: number, event: React.MouseEvent<HTMLLIElement>) {
    selectPlaylistTrackWithModifiers(index, event);
    clearPlaylistTrackPreview(trackPreviewTimerRef);
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;

    const track = tracks[index];
    if (!track) return;

    playbackRequestRef.current++;
    lyricsLoadRequestRef.current++;
    try { shifterRef.current?.disconnect(); } catch (error) {
      console.warn('Unable to stop pitch shifter after track selection', error);
    }
    shifterRef.current = null;
    pitchShifterTrackIdRef.current = null;
    try { audioRef.current?.pause(); } catch (error) {
      console.warn('Unable to pause audio after track selection', error);
    }
    try { videoRef.current?.pause(); } catch (error) {
      console.warn('Unable to pause video after track selection', error);
    }
    try { if (audioRef.current) audioRef.current.currentTime = 0; } catch {}
    try { if (videoRef.current) videoRef.current.currentTime = 0; } catch {}

    if (currentTrackIdRef.current !== track.id) clearPitchShiftBufferCache();
    currentTrackIdRef.current = track.id;
    activeMediaRef.current = mediaForTrack(track);
    setCurrent(index);
    setIsPlaying(false);
    setSeekTime(0);
    setDuration(0);
    updatePlaybackStarting(false);

    if (!shouldSchedulePlaylistTrackPreview(event)) return;
    schedulePlaylistTrackPreview(index, trackPreviewTimerRef, (trackIndex, options) => {
      void playIndex(trackIndex, options);
    });
  }

  async function deleteSelectedTracks() {
    if (!selectedTrackIds.size) return;
    const idsToRemove = new Set(selectedTrackIds);
    const count = idsToRemove.size;
    if (!window.confirm(`Remove ${count} selected item${count === 1 ? '' : 's'} from this playlist? The audio files themselves will not be deleted.`)) return;

    const playingTrackId = currentTrackIdRef.current || (current == null ? null : tracks[current]?.id) || null;
    const deletedPlayingTrack = !!playingTrackId && idsToRemove.has(playingTrackId);
    const remainingTracks = tracks.filter(track => !idsToRemove.has(track.id));
    const updatedPlaylists = playlists.map(playlist => playlist.name === selectedPlaylistName
      ? { ...playlist, tracks: remainingTracks }
      : playlist);

    setTracks(remainingTracks);
    setPlaylists(updatedPlaylists);
    setSelectedTrackIds(new Set());
    selectionAnchorTrackIdRef.current = null;
    setSelected(null);
    try { localStorage.setItem('playlists', JSON.stringify(updatedPlaylists)); }
    catch (error) { console.warn('Unable to save playlist changes locally', error); }

    if (tagEditorTrackId && idsToRemove.has(tagEditorTrackId)) closeTagEditor();
    if (deletedPlayingTrack) {
      playbackRequestRef.current++;
      try { audioRef.current?.pause(); } catch {}
      try { videoRef.current?.pause(); } catch {}
      try { shifterRef.current?.disconnect(); } catch {}
      const deletedTrackMedia = activeMediaRef.current;
      try {
        deletedTrackMedia?.removeAttribute('src');
        deletedTrackMedia?.load();
      } catch (error) {
        console.warn('Unable to clear the deleted track media source', error);
        setLogs(previous => [...previous, `Unable to clear the deleted track media source: ${String(error)}`]);
      }
      shifterRef.current = null;
      pitchShifterTrackIdRef.current = null;
      activeMediaRef.current = null;
      clearPitchShiftBufferCache();
      currentTrackIdRef.current = null;
      setCurrent(null);
      setIsPlaying(false);
      setSeekTime(0);
      setDuration(0);
      lyricsLoadRequestRef.current++;
      setLyricsRaw(null);
      setLyricsTimed(null);
      scheduleMediaObjectUrlCleanup();
    } else if (playingTrackId) {
      const newCurrentIndex = remainingTracks.findIndex(track => track.id === playingTrackId);
      setCurrent(newCurrentIndex >= 0 ? newCurrentIndex : null);
    }

    try {
      const api = window.electronAPI;
      if (hasElectronCapability(api, 'writePlaylists')) {
        const serializablePlaylists = updatedPlaylists.map(playlist => ({
          ...playlist,
          tracks: playlist.tracks.map(track => ({
            id: track.id,
            name: track.name,
            path: track.path,
            src: track.src,
            cover: track.cover,
            bitrate: track.bitrate,
            resolution: track.resolution
          }))
        }));
        const result = await api.writePlaylists(serializablePlaylists);
        if (!result?.ok) throw new Error(result?.error || 'Playlist changes could not be saved.');
      } else if (hasElectronCapability(api, 'savePlaylist') && selectedPlaylistName) {
        const result = await api.savePlaylist(selectedPlaylistName, remainingTracks.map(track => ({
          id: track.id,
          name: track.name,
          path: track.path,
          src: track.src,
          cover: track.cover,
          bitrate: track.bitrate,
          resolution: track.resolution
        })));
        if (!result?.ok) throw new Error(result?.error || 'Playlist changes could not be saved.');
      }
    } catch (error) {
      const message = `Items removed from the current view, but playlist changes could not be saved: ${String(error)}`;
      console.error(message, error);
      setLogs(previous => [...previous, message]);
      alert(message);
    }
  }

  function getOnlineSearchHints(): TrackPathHints {
    const track = tracks.find(item => item.id === tagEditorTrackId);
    const pathHints = parseTrackPathHints(track ? getTrackFilePath(track) : undefined);
    const fallbackTitle = track?.name.replace(/\.[^.]+$/, '') || '';
    const tagTrackNumber = tagEditorDraft?.track.split('/')[0].trim().replace(/^0+/, '') || '';
    return {
      title: pathHints.title || tagEditorDraft?.title.trim() || fallbackTitle.trim(),
      artist: pathHints.artist || tagEditorDraft?.artist.trim() || tagEditorDraft?.albumArtist.trim() || '',
      album: pathHints.album || tagEditorDraft?.album.trim() || '',
      year: pathHints.year || tagEditorDraft?.year.trim() || '',
      track: pathHints.track ? String(Number(pathHints.track)) : tagTrackNumber
    };
  }

  function getOnlineSearchTitle(fallbackTitle = '') {
    const title = getOnlineSearchHints().title || fallbackTitle.trim();
    return title.replace(/^\s*\d{1,3}[\s._-]+/, '').trim();
  }

  function closeMetadataPicker() {
    metadataSearchRequestRef.current++;
    metadataApplyRequestRef.current++;
    setMetadataPickerOpen(false);
    setMetadataSearchLoading(false);
    setMetadataApplyIndex(null);
    setMetadataSearchPage(0);
    setAdvancedMetadataSelection(null);
    setSelectedMetadataFields(new Set());
    setMetadataOverwriteConfirmation(null);
  }

  function closeLyricsPicker() {
    lyricsSearchRequestRef.current++;
    setLyricsPickerOpen(false);
    setLyricsSearchLoading(false);
    setLyricsSearchPage(0);
  }

  function openAdvancedMetadataSelection(result: OnlineMetadataResult, resultIndex: number) {
    if (!tagEditorDraft || metadataApplyIndex !== null || tagEditorSaving) return;
    const changedFields: OnlineMetadataApplyField[] = ONLINE_METADATA_TEXT_FIELDS
      .filter(({ field, getValue }) => {
        const value = getValue(result).trim();
        return value && tagEditorDraft[field].trim() !== value;
      })
      .map(({ field }) => field);
    if (result.artworkUrl) changedFields.push('cover');
    setSelectedMetadataFields(new Set(changedFields));
    setAdvancedMetadataSelection({ result, resultIndex });
  }

  function openMetadataPicker() {
    if (!tagEditorDraft || metadataSearchLoading || metadataApplyIndex !== null) return;
    lyricsSearchRequestRef.current++;
    setLyricsPickerOpen(false);
    setLyricsSearchLoading(false);
    setAdvancedMetadataSelection(null);
    setSelectedMetadataFields(new Set());
    const hints = getOnlineSearchHints();
    const titleQuery = getOnlineSearchTitle();
    setMetadataSearchPage(0);
    const query = [titleQuery, hints.artist, hints.album]
      .filter(Boolean)
      .filter((value, index, values) =>
        values.findIndex(candidate => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
      .join(' ');
    if (!query) {
      setMetadataSearchError('Enter a title, artist, or album before searching.');
      setMetadataPickerOpen(true);
      return;
    }
    void searchOnlineMetadata(query, tagEditorTrackId, true, titleQuery);
  }

  async function searchOnlineMetadata(
    query: string,
    trackId: string | null,
    showPicker = false,
    fallbackQuery = ''
  ) {
    const requestId = ++metadataSearchRequestRef.current;
    setMetadataSearchPage(0);
    if (showPicker) setMetadataPickerOpen(true);
    setMetadataSearchLoading(true);
    setMetadataSearchError('');
    setMetadataSearchWarning('');
    setMetadataSearchResults([]);
    setAdvancedMetadataSelection(null);
    setSelectedMetadataFields(new Set());
    try {
      const api = window.electronAPI;
      if (!hasElectronCapability(api, 'searchMetadata')) throw new Error('Online song information search is unavailable.');
      const hints = getOnlineSearchHints();
      const searchHints = {
        title: getOnlineSearchTitle(),
        artist: hints.artist,
        album: hints.album
      };
      let response = await api.searchMetadata(query, searchHints);
      if (
        response?.ok &&
        response.results.length === 0 &&
        fallbackQuery &&
        fallbackQuery.toLocaleLowerCase() !== query.toLocaleLowerCase()
      ) {
        response = await api.searchMetadata(fallbackQuery, searchHints);
      }
      if (requestId !== metadataSearchRequestRef.current || trackId !== tagEditorTrackId) return;
      if (!response?.ok) throw new Error(response?.error || 'Unable to search online song information.');

      const results = Array.isArray(response.results)
        ? response.results as OnlineMetadataResult[]
        : [];
      setMetadataSearchWarning(response.warnings?.length
        ? `Some metadata sources could not be searched: ${response.warnings.join(' ')}`
        : '');
      setMetadataSearchResults(sortOnlineMetadataResults(results, lyricsSearchResults, {
        ...getOnlineSearchHints(),
        title: getOnlineSearchTitle()
      }));
      if (!results.length) setMetadataSearchError('No matching song information found. Check the title or artist and try again.');
    } catch (error) {
      if (requestId === metadataSearchRequestRef.current) {
        const message = error instanceof Error ? error.message : String(error).replace(/^Error:\s*/, '');
        setMetadataSearchError(message);
      }
    } finally {
      if (requestId === metadataSearchRequestRef.current) setMetadataSearchLoading(false);
    }
  }

  async function searchOnlineLyrics() {
    if (!tagEditorDraft || lyricsSearchLoading || metadataApplyIndex !== null) return;
    setLyricsPickerOpen(true);
    setMetadataPickerOpen(false);
    metadataSearchRequestRef.current++;
    metadataApplyRequestRef.current++;
    setMetadataSearchLoading(false);
    setMetadataApplyIndex(null);
    const trackId = tagEditorTrackId;
    const requestId = ++lyricsSearchRequestRef.current;
    const track = tracks.find(item => item.id === trackId);
    const fallbackTitle = track?.name.replace(/\.[^.]+$/, '') || '';
    const searchHints = getOnlineSearchHints();
    const searchTitle = getOnlineSearchTitle(fallbackTitle);
    const lyricsQuery = [searchTitle, searchHints.artist, searchHints.album]
      .filter(Boolean)
      .filter((value, index, values) =>
        values.findIndex(candidate => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
      .join(' ') || searchHints.artist;
    const fallbackQuery = searchTitle || searchHints.artist;
    const durationHint = current != null && tracks[current]?.id === trackId &&
      Number.isFinite(duration) && duration > 0
      ? duration
      : undefined;
    if (!lyricsQuery) {
      setLyricsSearchError('Enter a song title or artist before searching.');
      setLyricsSearchCanRetry(false);
      return;
    }

    setLyricsSearchLoading(true);
    setLyricsSearchError('');
    setLyricsSearchNotice('');
    setLyricsSearchCanRetry(false);
    setLyricsSearchResults([]);
    setLyricsSearchPage(0);
    try {
      const api = window.electronAPI;
      if (!hasElectronCapability(api, 'searchLyrics')) throw new Error('Online lyrics search is unavailable.');
      const response = await api.searchLyrics(lyricsQuery, fallbackQuery || lyricsQuery, searchHints.artist);
      if (requestId !== lyricsSearchRequestRef.current || trackId !== tagEditorTrackId) return;
      if (!response?.ok) {
        setLyricsSearchCanRetry(response?.retryable === true);
        throw new Error(response?.error || 'Unable to search online lyrics.');
      }
      if (response?.fallbackUsed) {
        setLyricsSearchNotice('LRCLIB did not return synchronized lyrics; alternate online lyric sources were checked.');
      } else if (response?.fallbackError) {
        setLyricsSearchNotice(`The syncedlyrics backup could not provide synchronized lyrics: ${response.fallbackError}`);
      }
      const results = Array.isArray(response.results)
        ? response.results as OnlineLyricsResult[]
        : [];
      const matchHints = {
        title: searchTitle || fallbackTitle,
        artist: searchHints.artist,
        album: searchHints.album,
        year: searchHints.year,
        track: searchHints.track
      };
      const sortedResults = sortOnlineLyricsResults(results, matchHints, durationHint);
      const traditionalResults = await Promise.all(sortedResults.map(async result => ({
        ...result,
        plainLyrics: result.plainLyrics ? await toTraditionalLyrics(result.plainLyrics) : '',
        syncedLyrics: result.syncedLyrics ? await toTraditionalLyrics(result.syncedLyrics) : ''
      })));
      if (requestId !== lyricsSearchRequestRef.current || trackId !== tagEditorTrackId) return;
      setLyricsSearchResults(traditionalResults);
      if (!traditionalResults.length) setLyricsSearchError('No lyrics found. Check the title or artist and try again.');
    } catch (error) {
      if (requestId === lyricsSearchRequestRef.current) {
        const message = error instanceof Error ? error.message : String(error).replace(/^Error:\s*/, '');
        setLyricsSearchError(message);
      }
    } finally {
      if (requestId === lyricsSearchRequestRef.current) setLyricsSearchLoading(false);
    }
  }

  async function useOnlineLyrics(result: OnlineLyricsResult) {
    if (!tagEditorDraft) return;
    const draft = tagEditorDraft;
    const trackId = tagEditorTrackId;
    const requestId = tagEditorRequestRef.current;
    let lyrics: string;
    try {
      lyrics = await toTraditionalLyrics(result.syncedLyrics || result.plainLyrics);
    } catch (error) {
      if (requestId === tagEditorRequestRef.current) setTagEditorError(String(error));
      return;
    }
    if (requestId !== tagEditorRequestRef.current || trackId !== tagEditorTrackId || !tagEditorDraft) return;
    if (!lyrics) return;
    if (
      draft.lyrics.trim() &&
      draft.lyrics.trim() !== lyrics.trim() &&
      !window.confirm('Replace the current LRC text with the selected online lyrics?')
    ) return;
    updateTagField('lyrics', lyrics);
    setTagEditorMessage(`Lyrics loaded from ${result.source || 'LRCLIB'}: ${result.trackName}. Review them before saving.`);
    setLyricsSearchError('');
    setLyricsSearchCanRetry(false);
    closeLyricsPicker();
  }

  async function useOnlineMetadata(
    result: OnlineMetadataResult,
    resultIndex: number,
    selectedFields?: Set<OnlineMetadataApplyField>,
    overwriteConfirmed = false
  ) {
    if (!tagEditorDraft || metadataApplyIndex !== null) return;
    const fields = selectedFields ?? new Set<OnlineMetadataApplyField>([
      ...ONLINE_METADATA_TEXT_FIELDS.map(({ field }) => field),
      'cover'
    ]);
    const updates = [
      ['title', result.trackName, 'Title'],
      ['artist', result.artistName, 'Artist'],
      ['album', result.albumName, 'Album'],
      ['year', result.year, 'Year'],
      ['track', result.trackNumber, 'Track'],
      ['albumArtist', result.albumArtist, 'Album Artist'],
      ['composer', result.composer || '', 'Composer'],
      ['lyricist', result.lyricist || '', 'Lyricist']
    ] as const satisfies ReadonlyArray<readonly [keyof TagEditorDraft, string, string]>;
    const changedValues = updates.filter(([field, value]) =>
      fields.has(field as OnlineMetadataApplyField) &&
      !!value.trim() &&
      typeof tagEditorDraft[field] === 'string' &&
      tagEditorDraft[field].trim() !== value
    );
    const coverWillChange = fields.has('cover') && !!result.artworkUrl &&
      !!tagEditorDraft.coverBase64 && !tagEditorDraft.removeCover;
    const fieldsBeingReplaced = [
        ...changedValues.filter(([field]) => !!tagEditorDraft[field].trim()).map(([, , label]) => label),
        ...(coverWillChange ? ['Cover'] : [])
    ];
    if (fieldsBeingReplaced.length && !overwriteConfirmed) {
      setMetadataOverwriteConfirmation({
        result,
        resultIndex,
        fields: new Set(fields),
        labels: fieldsBeingReplaced
      });
      return;
    }

    const applyRequestId = ++metadataApplyRequestRef.current;
    const editorTrackId = tagEditorTrackId;
    const editorRequestId = tagEditorRequestRef.current;
    setMetadataApplyIndex(resultIndex);
    setTagEditorError('');
    setTagEditorMessage('');
    let artwork: { mime: string; base64: string } | null = null;
    let artworkError = '';
    try {
      if (fields.has('cover') && result.artworkUrl) {
        const api = window.electronAPI;
        if (!hasElectronCapability(api, 'downloadOnlineArtwork')) throw new Error('Online artwork download is unavailable.');
        const response = await api.downloadOnlineArtwork(result.artworkUrl);
        if (!response?.ok) throw new Error(response?.error || 'Unable to download the selected cover.');
        artwork = { mime: String(response.mime || ''), base64: String(response.base64 || '') };
      }
    } catch (error) {
      artworkError = error instanceof Error ? error.message : String(error);
    }
    if (
      applyRequestId !== metadataApplyRequestRef.current ||
      editorRequestId !== tagEditorRequestRef.current ||
      editorTrackId !== tagEditorTrackId
    ) {
      setMetadataApplyIndex(null);
      return;
    }

    const fieldsToApply = Object.fromEntries(
      updates
        .filter(([field, value]) => fields.has(field as OnlineMetadataApplyField) && !!value.trim())
        .map(([field, value]) => [field, value])
    ) as Partial<Pick<TagEditorDraft,
      'title' | 'artist' | 'album' | 'year' | 'track' | 'albumArtist' | 'composer' | 'lyricist'>>;
    setTagEditorDraft(previous => previous ? {
      ...previous,
      ...fieldsToApply,
      ...(artwork ? { coverMime: artwork.mime, coverBase64: artwork.base64, removeCover: false } : {})
    } : previous);
    closeMetadataPicker();
    setTagEditorMessage(
      `Information loaded from ${getMetadataSourceSummary(result)} for “${result.trackName}”. Review the fields before saving.` +
      (artworkError ? ` Cover was not loaded: ${artworkError}` : '')
    );
    setMetadataSearchError('');
    setMetadataApplyIndex(null);
  }

  function confirmMetadataOverwrite() {
    const pending = metadataOverwriteConfirmation;
    if (!pending) return;
    setMetadataOverwriteConfirmation(null);
    void useOnlineMetadata(pending.result, pending.resultIndex, pending.fields, true);
  }

  async function saveTagEditor() {
    const track = tracks.find(item => item.id === tagEditorTrackId);
    const trackPath = track ? getTrackFilePath(track) : undefined;
    if (!track || !trackPath || !tagEditorDraft || tagEditorSaving) return;
    setTagEditorSaving(true);
    setTagEditorError('');
    setTagEditorMessage('');
    try {
      const api = window.electronAPI;
      if (!hasElectronCapability(api, 'writeMp3Tags')) throw new Error('MP3 tag writer is unavailable.');
        const draftToSave = { ...tagEditorDraft, lyrics: await toTraditionalLyrics(tagEditorDraft.lyrics) };
        setTagEditorDraft(draftToSave);
        const result = await api.writeMp3Tags(trackPath, draftToSave);
        if (!result?.ok) throw new Error(result?.error || 'Unable to save MP3 tags.');
        const cover = draftToSave.removeCover
          ? undefined
          : draftToSave.coverBase64
            ? `data:${draftToSave.coverMime};base64,${draftToSave.coverBase64}`
            : track.cover;
        setTracks(previous => previous.map(item => item.id === track.id
          ? { ...item, cover }
          : item));
        if (currentTrackIdRef.current === track.id) {
          const timedLyrics = parseTimestampedLyrics(draftToSave.lyrics);
          setLyricsRaw(draftToSave.lyrics || null);
          setLyricsTimed(timedLyrics.length ? timedLyrics : null);
        }
      setTagEditorMessage(`Tags saved. Original file backup: ${result.backupPath}`);
    } catch (error) {
      setTagEditorError(String(error));
    } finally {
      setTagEditorSaving(false);
    }
  }

  function chooseTagCover(file: File | undefined) {
    if (!file || !tagEditorDraft) return;
    if (file.size > 20 * 1024 * 1024) {
      setTagEditorError('Cover image must be 20 MB or smaller.');
      return;
    }
    const mime = file.type.toLowerCase();
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) {
      setTagEditorError('Choose a JPEG, PNG, GIF or WebP image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        setTagEditorError('Unable to read the selected cover image.');
        return;
      }
      setTagEditorDraft(previous => previous
        ? { ...previous, coverMime: mime, coverBase64: base64, removeCover: false }
        : previous);
      setTagEditorError('');
    };
    reader.onerror = () => setTagEditorError('Unable to read the selected cover image.');
    reader.readAsDataURL(file);
  }

  function updateTagField<K extends keyof TagEditorDraft>(field: K, value: TagEditorDraft[K]) {
    setTagEditorDraft(previous => previous ? { ...previous, [field]: value } : previous);
  }

  async function convertLyricsFieldOnBlur(lyrics: string) {
    try {
      const traditionalLyrics = await toTraditionalLyrics(lyrics);
      setTagEditorDraft(previous => previous?.lyrics === lyrics
        ? { ...previous, lyrics: traditionalLyrics }
        : previous);
    } catch (error) {
      setTagEditorError(String(error));
    }
  }

  async function browseVocalSplitterFolder() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseFolder')) {
      setVocalSplitterError('Folder picker is unavailable.');
      return;
    }

    try {
      const result = await api.chooseFolder();
      if (result.canceled) {
        if (result.error) setVocalSplitterError(result.error);
        return;
      }

      const folderPath = result.paths[0];
      if (!folderPath) throw new Error('The folder picker returned no folder.');
      setVocalSplitterFolder(folderPath);
      setVocalSplitterError('');
      setVocalSplitterStatus('');
      setVocalSplitterFailures([]);
    } catch (error) {
      const message = `Unable to choose Vocal Splitter folder: ${String(error)}`;
      console.warn(message, error);
      setVocalSplitterError(message);
      setLogs(logs => [...logs, message]);
    }
  }

  async function splitVocalFolder() {
    if (vocalSplitterRunning) return;
    const folderPath = vocalSplitterFolder.trim();
    if (!folderPath) {
      setVocalSplitterStatus('');
      setVocalSplitterError('Enter or choose a folder first.');
      return;
    }

    const api = window.electronAPI;
    const outputRoot = mediaLibraryPath.trim();
    if (!outputRoot) {
      setVocalSplitterError('Set the media library location in Settings before splitting audio.');
      return;
    }
    if (!hasElectronCapability(api, 'scanAudioFiles')) {
      setVocalSplitterError('Audio folder scanning is unavailable.');
      return;
    }
    if (!hasElectronCapability(api, 'splitAudioStems')) {
      setVocalSplitterError('Vocal separation is unavailable.');
      return;
    }

    setVocalSplitterRunning(true);
    setVocalSplitterError('');
    setVocalSplitterStatus('Scanning folder...');
    setVocalSplitterFailures([]);

    try {
      const scanResult = await api.scanAudioFiles(folderPath, vocalSplitterRecursive);
      if (!scanResult.ok) throw new Error(scanResult.error);
      if (scanResult.files.length === 0) {
        setVocalSplitterStatus('No MP3, FLAC, WAV, or MP4 files found in this folder.');
        return;
      }

      let successCount = 0;
      const failures: string[] = [];
      for (const [index, filePath] of scanResult.files.entries()) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        setVocalSplitterStatus(`Processing ${index + 1} of ${scanResult.files.length}: ${fileName}`);
        try {
          const result = await api.splitAudioStems(filePath, outputRoot);
          if (!result.ok) throw new Error(result.error);
          successCount++;
          setMediaLibraryFiles(currentFiles => Array.from(new Set([
            ...currentFiles,
            result.vocalsPath,
            result.accompanimentPath
          ])));
          setBackingAvailableMap(current => {
            const updated = { ...current };
            for (const track of tracks) {
              if (track.path === filePath) updated[track.id] = true;
            }
            return updated;
          });
        } catch (error) {
          failures.push(`${fileName}: ${String(error)}`);
        }
      }

      if (successCount > 0) setMediaLibraryRefreshKey(key => key + 1);
      setVocalSplitterFailures(failures);
      const summary = `Completed: ${successCount} succeeded, ${failures.length} failed.`;
      setVocalSplitterStatus(summary);
      setLogs(current => [...current, `Vocal Splitter: ${summary}`, ...failures.map(failure => `Vocal Splitter failed: ${failure}`)]);
      appendElectronLog(`Vocal Splitter: ${summary}`);
      failures.forEach(failure => appendElectronLog(`Vocal Splitter failed: ${failure}`));
    } catch (error) {
      const message = `Unable to split the selected folder: ${String(error)}`;
      console.error(message, error);
      setVocalSplitterError(message);
      setLogs(current => [...current, message]);
    } finally {
      setVocalSplitterRunning(false);
    }
  }

  function addFilesFromFileList(fileList: FileList) {
    addFilesFromFiles(Array.from(fileList));
  }

  function updateLoadedTrackSource(trackId: string, trackName: string, src: string, file?: File) {
    updateTrackSourceReferences(trackId, src, file);

    const audio = audioRef.current;
    if (
      currentTrackIdRef.current !== trackId ||
      !audio ||
      activeMediaRef.current !== audio
    ) return;

    let wasPlaying: boolean;
    let currentTime: number;
    try {
      wasPlaying = !audio.paused;
      currentTime = audio.currentTime || 0;
    } catch (error) {
      reportPlaybackFailure(`Unable to restore playback after reloading ${trackName}: ${String(error)}`);
      return;
    }

    try {
      audio.src = src;
    } catch (error) {
      reportPlaybackFailure(`Unable to switch ${trackName} to its loaded audio source: ${String(error)}`);
      return;
    }

    try {
      audio.currentTime = Math.max(0, Math.min(currentTime, audio.duration || currentTime));
    } catch (error) {
      console.warn(`Unable to preserve playback position for ${trackName}`, error);
      setLogs(logs => [...logs, `Unable to preserve playback position for ${trackName}: ${String(error)}`]);
    }

    if (wasPlaying) {
      try {
        void audio.play().catch(error => {
          setIsPlaying(false);
          reportPlaybackFailure(`Unable to resume ${trackName} after reloading its audio source: ${String(error)}`);
        });
      } catch (error) {
        setIsPlaying(false);
        reportPlaybackFailure(`Unable to resume ${trackName} after reloading its audio source: ${String(error)}`);
      }
    }
    scheduleMediaObjectUrlCleanup();
  }

  function addFilesFromFiles(files: File[]) {
    const arr: Track[] = [];
    const api = window.electronAPI;
    for (const file of files) {
      const name = file.name;
      if (name.match(/_backingtrack\.(mp3|wav)$/i)) continue;
      if (!name.match(/\.(mp3|flac|mp4)$/i)) continue;
      let p: string | undefined;
      if (hasElectronCapability(api, 'getPathForFile')) {
        try {
          p = api.getPathForFile(file) || undefined;
        } catch (error) {
          console.warn(`Unable to resolve the selected file path for ${name}`, error);
          setLogs(logs => [...logs, `Unable to resolve the selected file path for ${name}: ${String(error)}`]);
        }
      }
      if (!p) p = (file as File & { path?: string }).path || undefined;
      const isVideo = /\.mp4$/i.test(name);
      const src = isVideo && p && api ? musicFileUrl(p) : createMediaObjectUrl(file);
      if (!src) continue;
      const id = p ? `path:${p}` : `${name}:${file.size}:${file.lastModified}`;
      const track: Track = { id, name, src, file };
      if (p) track.path = p;
      arr.push(track);
    }

    setTracks(previousTracks => [...previousTracks, ...arr]);
    setLogs(logs => [...logs, `Added ${arr.length} files from file input`]);
    appendElectronLog(`Added ${arr.length} files from file input`);

    // If running in Electron, and we have file paths, read from disk to create stable blob URLs.
    if (hasElectronCapability(api, 'readFile')) {
      for (const track of arr) {
        const trackPath = track.path;
        if (!trackPath || isVideoTrack(track)) continue;

        void (async () => {
          try {
            const result = await api.readFile(trackPath);
            if (result && result.ok && result.data) {
              const blob = decodeBase64Blob(result.data, result.mime || 'application/octet-stream');
              const url = createMediaObjectUrl(blob);
              if (!url) return;
              updateLoadedTrackSource(track.id, track.name, url);
              setLogs(logs => [...logs, `readFile created blob for ${track.name}`]);
            } else {
              setLogs(logs => [...logs, `readFile failed for ${trackPath}: ${result?.error || 'unknown'}`]);
            }
          } catch (error) {
            setLogs(logs => [...logs, `readFile exception ${String(error)}`]);
          }
        })();
      }
    }
  }


    async function addFilesFromPathList(paths: string[], includeBackingTracks = false): Promise<Track[]> {
      const arr: Track[] = [];
      const api = window.electronAPI;
      for (const p of paths) {
        const name = p.split(/[/\\]/).pop() || p;
              // Skip backing tracks (already-generated accompaniment files)
              if (!includeBackingTracks && name.match(/_backingtrack\.(mp3|wav)$/i)) continue;
              if (!name.match(/\.(mp3|flac|mp4|wav)$/i)) continue;
              const id = `path:${p}`;
              // Prefer music:// protocol in Electron to stream directly with range support
              const src = api ? musicFileUrl(p) : undefined;
              arr.push({ id, name, path: p, src });
            }

      setTracks(previousTracks => [...previousTracks, ...arr]);
      setLogs(logs => [...logs, `Added ${arr.length} files from path list`]);
      appendElectronLog(`Added ${arr.length} files from path list: ${arr.map(track => track.name).join(',')}`);
      console.log('addFilesFromPathList added', arr.map(track => track.name));
      // If music protocol not available, fall back to reading and creating blob URLs
      if (!hasElectronCapability(api, 'readFile')) return arr;

      for (const t of arr) {
        const trackPath = t.path;
        if (!trackPath) continue;
        (async () => {
          try {
            const statRes = hasElectronCapability(api, 'stat')
              ? await api.stat(trackPath)
              : null;
            if (statRes && statRes.ok && statRes.isFile) {
              // nothing else needed when music:// is used
              return;
            }
          } catch (error) {
            setLogs(logs => [...logs, `Music protocol check failed for ${trackPath}; falling back to file read: ${String(error)}`]);
          }

          try {
            const pathKey = trackPath;
            const reqId = ((readRequestIdRef.current[pathKey] || 0) + 1);
            readRequestIdRef.current[pathKey] = reqId;

            const res = await api.readFile(trackPath);
            if (readRequestIdRef.current[pathKey] !== reqId) {
              setLogs(l=>[...l, `stale readFile result ignored for ${trackPath}`]);
            } else if (res && res.ok && res.data) {
              const blob = decodeBase64Blob(res.data, res.mime || 'application/octet-stream');
              const url = createMediaObjectUrl(blob);
              if (!url) return;
              // create a File object if supported (useful for chrome APIs)
              let fileObj: File | undefined = undefined;
              try { fileObj = new File([blob], t.name, { type: res.mime || 'application/octet-stream' }); } catch (e) { /* ignore if not supported */ }
                          updateLoadedTrackSource(t.id, t.name, url, fileObj);
                          setLogs(l=>[...l, `Created blob for ${t.name}`]);
                          appendElectronLog(`Created blob for ${t.name}`);
                        } else {
                          setLogs(l=>[...l, `readFile failed for ${trackPath}: ${res.error || 'unknown'}`]);
                        }
          } catch (err) {
            setLogs(l=>[...l, `readFile exception ${String(err)}`]);
          }
        })();
      }

      return arr;
    }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    addFilesFromFileList(e.target.files);
  }

  async function onAddFilesClick() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseFiles')) {
      addFilesInputRef.current?.click();
      return;
    }

    try {
      const result = await api.chooseFiles();
      if (result.canceled) {
        if (result.error) {
          setLogs(logs => [...logs, `Unable to open the audio file picker: ${result.error}`]);
        }
        return;
      }
      await addFilesFromPathList(result.paths);
    } catch (error) {
      console.error('Unable to add selected audio files', error);
      setLogs(logs => [...logs, `Unable to add selected audio files: ${String(error)}`]);
    }
  }

  async function onFolder(e: React.ChangeEvent<HTMLInputElement> | undefined) {
    if (!e?.target?.files) return;
    addFilesFromFileList(e.target.files);
  }

  async function onAddFolderClick() {
    const api = window.electronAPI;
    if (api) {
      if (!hasElectronCapability(api, 'chooseFolderFiles')) {
        const message = 'Folder import is unavailable in this app version. Restart MintPlayer to load the updated Electron bridge.';
        console.error(message);
        setLogs(logs => [...logs, message]);
        return;
      }

      try {
        const result = await api.chooseFolderFiles();
        if (result.canceled) {
          if (result.error) throw new Error(result.error);
          return;
        }
        await addFilesFromPathList(result.paths);
      } catch (error) {
        const message = `Unable to add folder: ${String(error)}`;
        console.error(message, error);
        setLogs(logs => [...logs, message]);
      }
      return;
    }

    addFolderInputRef.current?.click();
  }

  function isFileDrag(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.types).includes('Files')
      || Array.from(dataTransfer.items).some(item => item.kind === 'file');
  }

  async function readDroppedEntry(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        (entry as FileSystemFileEntry).file(file => resolve([file]), reject);
      });
    }

    if (!entry.isDirectory) return [];

    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const childEntries: FileSystemEntry[] = [];
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (batch.length === 0) break;
      childEntries.push(...batch);
    }

    const childFiles = await Promise.all(childEntries.map(child => readDroppedEntry(child)));
    return childFiles.flat();
  }

  async function handleDrop(e: React.DragEvent) {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    // reset drag counter/state reliably
    dragCounter.current = 0;
    setIsDragging(false);
    const dt = e.dataTransfer;
    const files: File[] = [];
    const items = Array.from(dt.items);
    let entryReadFailed = false;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
      if (!entry) continue;
      try {
        files.push(...await readDroppedEntry(entry));
      } catch (error) {
        entryReadFailed = true;
        console.warn('Unable to read dropped file or folder entry', error);
        setLogs(currentLogs => [...currentLogs, `Dropped folder read failed: ${String(error)}`]);
      }
    }

    if (files.length === 0 || entryReadFailed) files.push(...Array.from(dt.files));
    const uniqueFiles = Array.from(new Map(files.map(file => {
      const filePath = (file as File & { path?: string }).path;
      return [filePath || `${file.name}:${file.size}:${file.lastModified}`, file];
    })).values());
    if (uniqueFiles.length > 0) {
      addFilesFromFiles(uniqueFiles);
    } else {
      setLogs(currentLogs => [...currentLogs, 'Drop contained no readable files.']);
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (isFileDrag(e.dataTransfer)) e.preventDefault();
  }
  function onDragEnter(e: React.DragEvent) {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current > 0) setIsDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  }

  function finishTrackReorder() {
    draggedTrackIndexRef.current = null;
    setDraggedTrackIndex(null);
    setDropInsertionIndex(null);
  }

  function updateTrackVirtualWindow(list: HTMLUListElement) {
    const start = Math.max(0, Math.floor(list.scrollTop / TRACK_ROW_STRIDE) - TRACK_LIST_OVERSCAN);
    const end = Math.min(
      tracks.length,
      Math.ceil((list.scrollTop + list.clientHeight) / TRACK_ROW_STRIDE) + TRACK_LIST_OVERSCAN
    );
    setTrackVirtualWindow(previous => previous.start === start && previous.end === end
      ? previous
      : { start, end });
  }

  function moveTrack(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= tracks.length || toIndex >= tracks.length) return;
    const reorderedTracks = tracks.slice();
    const [movedTrack] = reorderedTracks.splice(fromIndex, 1);
    reorderedTracks.splice(toIndex, 0, movedTrack);
    const remapIndex = (index: number | null) => {
      if (index === null) return null;
      if (index === fromIndex) return toIndex;
      if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
      if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
      return index;
    };

    setTracks(reorderedTracks);
    setSelected(remapIndex(selected));
    setCurrent(remapIndex(current));
    if (selectedPlaylistName) {
      setPlaylists(previous => previous.map(playlist =>
        playlist.name === selectedPlaylistName ? { ...playlist, tracks: reorderedTracks } : playlist
      ));
    }
  }

  function getTrackInsertionIndex(list: HTMLUListElement, clientY: number) {
    const contentY = clientY - list.getBoundingClientRect().top + list.scrollTop;
    return Math.max(0, Math.min(
      tracks.length,
      Math.floor((contentY - TRACK_ROW_HEIGHT / 2) / TRACK_ROW_STRIDE) + 1
    ));
  }

  function nextTrack(): boolean {
    const activeTrackIndex = currentTrackIdRef.current
      ? tracks.findIndex(track => track.id === currentTrackIdRef.current)
      : -1;
    const idx = activeTrackIndex >= 0 ? activeTrackIndex : current ?? -1;
    let next = idx + 1;
    if (next >= tracks.length) {
      if (loopPlaylist && tracks.length > 0) next = 0;
      else return false;
    }
    selectPlaylistTrack(next);
    playIndex(next);
    return true;
  }

  function prevTrack() {
    const idx = current ?? 0;
    let prev = idx - 1;
    if (prev < 0) {
      if (loopPlaylist && tracks.length > 0) prev = tracks.length - 1;
      else return;
    }
    selectPlaylistTrack(prev);
    playIndex(prev);
  }

  async function playIndex(
    i: number,
    options: PlaybackRequestOptions = {},
    trackList: Track[] = tracks,
    mediaRoleOverride?: MediaLibraryRole | null
  ) {
    const track = trackList[i];
    const trackPath = track ? getTrackFilePath(track) : undefined;
    const role = options.backingActive
      ? 'accompaniments'
      : trackPath ? getMediaLibraryRoleFromFilePath(trackPath) : undefined;
    setSelectedMediaRole(mediaRoleOverride ?? role ?? null);
    return playTrack({
      tracks: trackList,
      backingOutputRoot: mediaLibraryPath,
      setPlaybackError,
      currentTrackIdRef,
      clearPitchShiftBufferCache,
      playbackRequestRef,
      shifterRef,
      pitchShifterTrackIdRef,
      audioRef,
      videoRef,
      lyricsLoadRequestRef,
      setCurrent,
      mediaFront,
      setMediaFront,
      isVideoTrack,
      mediaForTrack,
      activeMediaRef,
      setIsPlaying,
      setLyricsRaw,
      setLyricsTimed,
      setLyricsIndex,
      getLyricsForTrack,
      setLyricsMode,
      attachLyricsTimeListener,
      setSeekTime,
      updatePlaybackStarting,
      readRequestIdRef,
      createMediaObjectUrl,
      updateTrackSourceReferences,
      setTracks,
      appendElectronLog,
      reportPlaybackFailure,
      audioCtxRef,
      ensureAudioGraph,
      getAudioContextConstructor,
      volume,
      setLogs,
      transposeRef,
      getPitchShiftBuffer,
      autoNextRef,
      nextTrack,
      duration,
      setDuration,
      seekingRef,
      gainRef,
      pannerRef,
      videoSourceRef,
      videoPitchNodeRef,
      videoSoundTouchRef,
      videoTransposeRef,
      previousVideoTransposeRef,
      resetVideoPitchBuffers,
      scheduleMediaObjectUrlCleanup
    }, i, options);
  }

  async function playLibraryFile(filePath: string, role?: MediaLibraryRole) {
    setView('player');
    const selectedRole = role || getMediaLibraryRoleFromFilePath(filePath);
    const audioOutputStarted = resumeAudioContextFromUserGesture();
    if (!(await audioOutputStarted)) return;

    const existingIndex = tracks.findIndex(track => getTrackFilePath(track) === filePath);
    if (existingIndex >= 0) {
      selectPlaylistTrack(existingIndex);
      await playIndex(existingIndex, {}, tracks, selectedRole);
      return;
    }

    const addedTracks = await addFilesFromPathList([filePath], true);
    if (!addedTracks.length) {
      setPlaybackError(`Unable to play media library file: ${filePath}`);
      return;
    }
    await playIndex(tracks.length, {}, [...tracks, ...addedTracks], selectedRole);
  }

  function playPlaylistTrack(index: number) {
    setView('player');
    const track = tracks[index];
    const trackPath = track ? getTrackFilePath(track) : undefined;
    const role = trackPath
      ? (track?.backingActive ? 'accompaniments' : getMediaLibraryRoleFromFilePath(trackPath))
      : undefined;
    setSelectedMediaRole(role || null);
    return playIndex(index);
  }

  function selectPlaylist(playlist: Playlist) {
    setPlaylistNameDraft(playlist.name);
    setIsPlaylistOptionsOpen(false);
    if (playlist.name === selectedPlaylistName) return;
    setSelectedPlaylistName(playlist.name);
    setTracks(playlist.tracks || []);
    setSelected(null);
    setSelectedTrackIds(new Set());
    selectionAnchorTrackIdRef.current = null;
    const preferenceError = writePreference('defaultPlaylistName', playlist.name);
    if (preferenceError) setLogs(logs => [...logs, preferenceError]);
  }

  function getNextPlaylistName() {
      // names like playlist1, playlist2 (case-insensitive)
      const used = new Set(playlistsRef.current.map(p => (p.name || '').toLowerCase()));
      let max = 0;
      for (const n of used) {
        const m = n.match(/^playlist(\d+)$/i);
        if (m) {
          const v = parseInt(m[1], 10);
          if (!isNaN(v) && v > max) max = v;
        }
      }
      let candidate: string;
      do {
        candidate = `playlist${max + 1}`;
        max++;
      } while (used.has(candidate.toLowerCase()));
      return candidate;
    }

    async function runPlaylistOperation(operation: () => Promise<void>) {
      if (playlistOperationInProgressRef.current) return;
      playlistOperationInProgressRef.current = true;
      setIsPlaylistOperationPending(true);
      try {
        await operation();
      } finally {
        playlistOperationInProgressRef.current = false;
        setIsPlaylistOperationPending(false);
      }
    }

    async function createPlaylist() {
      const name = getNextPlaylistName();
      const newPlaylist = { name, tracks: [] as Track[] };
      const updatedPlaylists = [...playlistsRef.current, newPlaylist];
      const persistedPlaylists = updatedPlaylists.map(playlist => ({
        name: playlist.name,
        tracks: serializePlaylistTracks(playlist.tracks)
      }));
      const api = window.electronAPI;

      try {
        if (hasElectronCapability(api, 'writePlaylists')) {
          const result = await api.writePlaylists(persistedPlaylists);
          if (!result?.ok) throw new Error(result?.error || 'Unable to create playlist.');
        } else if (hasElectronCapability(api, 'savePlaylist')) {
          const result = await api.savePlaylist(name, []);
          if (!result?.ok) throw new Error(result?.error || 'Unable to create playlist.');
        }
      } catch (error) {
        const message = `Unable to create playlist "${name}": ${String(error)}`;
        console.error(message, error);
        alert(message);
        return;
      }

      let storageWarning = '';
      try {
        localStorage.setItem('playlists', JSON.stringify(persistedPlaylists));
        localStorage.setItem('defaultPlaylistName', name);
      } catch (error) {
        storageWarning = ` Playlist is active but browser storage could not be updated: ${String(error)}`;
        console.warn(storageWarning, error);
      }
      playlistsRef.current = updatedPlaylists;
      setPlaylists(updatedPlaylists);
      setSelectedPlaylistName(name);
      setPlaylistNameDraft(name);
      setTracks([]);
      setSelected(null);
      setSelectedTrackIds(new Set());
      selectionAnchorTrackIdRef.current = null;
      setLogs(previous => [...previous, `Created playlist ${name}.${storageWarning}`]);
      if (storageWarning) alert(`Created playlist "${name}", but browser storage could not be updated.${storageWarning}`);
    }

    async function savePlaylist() {
      const name = playlistNameDraft.trim() || selectedPlaylistName || getNextPlaylistName();
      const isRename = !!selectedPlaylistName && name !== selectedPlaylistName;
      const currentPlaylists = playlistsRef.current;
      const duplicate = currentPlaylists.find(playlist =>
        playlist.name.toLocaleLowerCase() === name.toLocaleLowerCase() &&
        playlist.name !== selectedPlaylistName
      );
      if (duplicate) {
        alert(`A playlist named "${duplicate.name}" already exists.`);
        return;
      }

      const serializableTracks = serializePlaylistTracks(tracks);
      const updatedPlaylists = [
        ...currentPlaylists.filter(playlist =>
          playlist.name !== selectedPlaylistName && playlist.name !== name
        ),
        { name, tracks: serializableTracks }
      ];
      const persistedPlaylists = updatedPlaylists.map(playlist => ({
        name: playlist.name,
        tracks: serializePlaylistTracks(playlist.tracks)
      }));
      const api = window.electronAPI;

      try {
        if (isRename) {
          if (!hasElectronCapability(api, 'writePlaylists')) {
            throw new Error('Playlist renaming requires the full playlist save API.');
          }
          const result = await api.writePlaylists(persistedPlaylists);
          if (!result?.ok) throw new Error(result?.error || 'Unable to rename playlist.');
        } else if (hasElectronCapability(api, 'savePlaylist')) {
          const result = await api.savePlaylist(name, serializableTracks);
          if (!result?.ok) throw new Error(result?.error || 'Unable to save playlist.');
        } else if (hasElectronCapability(api, 'writePlaylists')) {
          const result = await api.writePlaylists(persistedPlaylists);
          if (!result?.ok) throw new Error(result?.error || 'Unable to save playlist.');
        }
      } catch (error) {
        const message = `Unable to save playlist "${name}": ${String(error)}`;
        console.error(message, error);
        alert(message);
        return;
      }
      playlistsRef.current = updatedPlaylists;
      let storageWarning = '';
      try {
        localStorage.setItem('playlists', JSON.stringify(persistedPlaylists));
        localStorage.setItem('defaultPlaylistName', name);
      } catch (error) {
        storageWarning = ` Browser storage could not be updated: ${String(error)}`;
        console.warn(storageWarning, error);
      }
      setPlaylists(updatedPlaylists);
      setSelectedPlaylistName(name);
      setPlaylistNameDraft(name);
      setLogs(previous => [...previous, `Saved playlist ${name}${storageWarning}`]);
      if (storageWarning) alert(`Saved playlist "${name}", but${storageWarning}`);
    }

    async function deletePlaylist() {
      if (!selectedPlaylistName) { alert('No playlist selected to delete'); return; }
      const name = selectedPlaylistName;
      if (!confirm(`Delete playlist "${name}"? This cannot be undone.`)) return;
      const updated = playlistsRef.current.filter(p => p.name !== name);
      playlistsRef.current = updated;
      setPlaylists(updated);
      setSelectedPlaylistName(null);
      setPlaylistNameDraft('');
      setTracks([]);
      const playlistStorageError = writePreference('playlists', JSON.stringify(updated));
      if (playlistStorageError) setLogs(logs => [...logs, playlistStorageError]);
      try { localStorage.removeItem('defaultPlaylistName'); }
      catch (error) {
        const message = `Unable to clear the default playlist preference: ${String(error)}`;
        console.warn(message, error);
        setLogs(logs => [...logs, message]);
      }
      try {
        const api = window.electronAPI;
        if (hasElectronCapability(api, 'writePlaylists')) {
          const res = await api.writePlaylists(updated);
          if (res?.ok) setLogs(l=>[...l, `Deleted playlist ${name}`]);
          else setLogs(l=>[...l, `writePlaylists failed: ${res?.error}`]);
        } else if (hasElectronCapability(api, 'savePlaylist')) {
          // delete by saving each remaining playlist (per-save fallback)
          for (const p of updated) {
            await api.savePlaylist(p.name, p.tracks);
          }
          setLogs(l=>[...l, `Deleted (via per-save) playlist ${name}`]);
        }
      } catch(err) { setLogs(l=>[...l, `delete persist error: ${String(err)}`]); }
    }

  useEffect(() => {
    return () => {
      if (trackPreviewTimerRef.current !== null) {
        window.clearTimeout(trackPreviewTimerRef.current);
        trackPreviewTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function togglePlayback() {
    if (trackPreviewTimerRef.current !== null) {
      window.clearTimeout(trackPreviewTimerRef.current);
      trackPreviewTimerRef.current = null;
    }
    if (playbackStartingRef.current) {
      playbackRequestRef.current++;
      updatePlaybackStarting(false);
      setIsPlaying(false);
      try { shifterRef.current?.disconnect(); } catch (error) {
        console.warn('Unable to cancel pending pitch-shift playback', error);
      }
      shifterRef.current = null;
      pitchShifterTrackIdRef.current = null;
      try { audioRef.current?.pause(); } catch (error) {
        console.warn('Unable to cancel pending audio playback', error);
      }
      try { videoRef.current?.pause(); } catch (error) {
        console.warn('Unable to cancel pending video playback', error);
      }
      return;
    }

    const idx = current ?? selected;
    const shifter = shifterRef.current;
    if (shifter) {
      if (isPlaying) {
        try {
          shifter.disconnect();
          setIsPlaying(false);
        } catch (err) {
          console.warn('pause failed', err);
          setLogs(l => [...l, `pause failed: ${String(err)}`]);
        }
        return;
      }

      try {
        await (audioCtxRef.current?.state === 'suspended' ? audioCtxRef.current.resume() : Promise.resolve());
        if (pannerRef.current) shifter.connect(pannerRef.current);
        else if (gainRef.current) shifter.connect(gainRef.current);
        setIsPlaying(true);
      } catch (err) {
        console.warn('resume failed', err);
        setLogs(l => [...l, `resume failed: ${String(err)}`]);
      }
      return;
    }

    const media = currentMedia();
    if (!media || (!media.currentSrc && !media.getAttribute('src'))) {
      if (idx != null && tracks[idx]) await playIndex(idx);
      return;
    }

    if (media.paused) {
      activeMediaRef.current = media;
      try {
        const audioContext = audioCtxRef.current;
        if (audioContext?.state === 'suspended') await audioContext.resume();
        if (audioContext && audioContext.state !== 'running') {
          throw new Error(`Audio context is ${audioContext.state}`);
        }
        await media.play();
        setIsPlaying(true);
        setPlaybackError(null);
      } catch (err) {
        setIsPlaying(false);
        reportPlaybackFailure(`Unable to resume playback: ${String(err)}`);
      }
      return;
    }

    media.pause();
    setIsPlaying(false);
  }

  function toggleMute() {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(prevVolumeRef.current || 1);
    }
  }

  togglePlaybackRef.current = togglePlayback;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.code !== 'Space' && event.key !== ' ' && event.key !== 'Spacebar') ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) return;

      const target = event.target;
      if (target instanceof Element && target.closest(
        'input, textarea, select, button, a[href], [role="button"], [contenteditable="true"]'
      )) return;

      event.preventDefault();
      void togglePlaybackRef.current();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onVolumeKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) return;

      const target = event.target;
      if (target instanceof HTMLElement && target.closest(
        'input, textarea, select, [contenteditable="true"]'
      )) return;

      event.preventDefault();
      const adjustment = event.key === 'ArrowUp' ? 0.05 : -0.05;
      setVolume(current => Math.min(1, Math.max(0, Number((current + adjustment).toFixed(2)))));
    };

    window.addEventListener('keydown', onVolumeKeyDown);
    return () => window.removeEventListener('keydown', onVolumeKeyDown);
  }, []);

  async function toggleBackingTrack() {
    const idx = current ?? selected;
    if (idx == null) return;
    const track = tracks[idx];
    if (!track || !track.path) return;
    const available = !!track.id && !!backingAvailableMap[track.id];
    if (!available) return;

    const nextUseBacking = !Boolean(track.backingActive);
    const startTime = shifterRef.current?.timePlayed ?? currentMedia()?.currentTime ?? 0;
    await playIndex(idx, { startTime, backingActive: nextUseBacking, shouldPlay: isPlaying });
  }

  const activeTrackIndex = current ?? selected;
  const activeTrack = activeTrackIndex == null ? null : tracks[activeTrackIndex] ?? null;
  const currentTrack = current == null ? null : tracks[current] ?? null;
  const diagnosticTrack = currentTrack ?? activeTrack;
  const diagnosticMedia = activeMediaRef.current || (currentTrack ? mediaForTrack(currentTrack) : null);
  const diagnosticBuffering = bufferingStartedAtRef.current;
  const diagnosticBufferingMs = diagnosticBuffering?.media === diagnosticMedia
    ? Math.max(0, performance.now() - diagnosticBuffering.timestamp)
    : 0;
  const diagnosticBufferedAhead = (() => {
    if (!diagnosticMedia) return null;
    const time = diagnosticMedia.currentTime;
    for (let index = 0; index < diagnosticMedia.buffered.length; index++) {
      const start = diagnosticMedia.buffered.start(index);
      const end = diagnosticMedia.buffered.end(index);
      if (start <= time && time <= end) return Math.max(0, end - time);
    }
    return 0;
  })();
  const diagnosticPitchShifterActive = Boolean(
    transpose !== 0 && (
      isVideoTrack(diagnosticTrack)
        ? videoSoundTouchRef.current
        : shifterRef.current && pitchShifterTrackIdRef.current === diagnosticTrack?.id
    )
  );
  const backingToggleEnabled = !!activeTrack?.path && !isVideoTrack(activeTrack) && !!backingAvailableMap[activeTrack.id];
  const activeTrackPath = activeTrack ? getTrackFilePath(activeTrack) : undefined;
  const normalizedActiveTrackPath = activeTrackPath?.replace(/[\\/]+/g, '/').toLocaleLowerCase();
  const activeMediaLibrarySong = normalizedActiveTrackPath
    ? mediaLibrarySongs.find(song =>
      Object.values(song.files).some(paths =>
        paths?.some(path => path.replace(/[\\/]+/g, '/').toLocaleLowerCase() === normalizedActiveTrackPath)
      )
    )
    : undefined;
  const activeMediaPaths: Partial<Record<MediaLibraryRole, string>> = activeMediaLibrarySong
    ? {
      music: getMediaLibraryRolePath(activeMediaLibrarySong, 'music'),
      video: getMediaLibraryRolePath(activeMediaLibrarySong, 'video'),
      accompaniments: getMediaLibraryRolePath(
        activeMediaLibrarySong,
        'accompaniments',
        selectedMediaRole === 'karaoke' ? 'video' : aoStemSources.accompaniments
      ),
      vocals: getMediaLibraryRolePath(
        activeMediaLibrarySong,
        'vocals',
        selectedMediaRole === 'vocals' ? aoStemSources.vocals : 'music'
      )
    }
    : {};
  const activeTrackRole = activeTrackPath ? getMediaLibraryRoleFromFilePath(activeTrackPath) : undefined;
  if (activeTrackRole && activeTrackRole !== 'karaoke' && activeTrackPath && !activeMediaPaths[activeTrackRole]) {
    activeMediaPaths[activeTrackRole] = activeTrackPath;
  }
  const karaokePlaybackPath = activeMediaPaths.video;
  const playerMediaAvailability: Record<MediaLibraryRole, boolean> = {
    music: !!activeMediaPaths.music,
    video: !!activeMediaPaths.video,
    karaoke: !!activeMediaLibrarySong?.files.karaoke?.length && !!(
      karaokePlaybackPath ||
      getMediaLibraryRolePath(activeMediaLibrarySong, 'accompaniments', 'music')
    ),
    accompaniments: !!(activeMediaLibrarySong && (
      getMediaLibraryRolePath(activeMediaLibrarySong, 'accompaniments', 'music') ||
      getMediaLibraryRolePath(activeMediaLibrarySong, 'accompaniments', 'video')
    )) || !!activeMediaPaths.accompaniments || backingToggleEnabled,
    vocals: !!(activeMediaLibrarySong && (
      getMediaLibraryRolePath(activeMediaLibrarySong, 'vocals', 'music') ||
      getMediaLibraryRolePath(activeMediaLibrarySong, 'vocals', 'video')
    )) || !!activeMediaPaths.vocals
  };

  const karaokeSubtitlePath = activeMediaLibrarySong?.files.karaoke?.find(filePath => /\.ass$/i.test(filePath));
  const karaokeAccompanimentPath = activeMediaLibrarySong
    ? getMediaLibraryRolePath(activeMediaLibrarySong, 'accompaniments', 'video')
    : undefined;
  const karaokeMusicAccompanimentPath = activeMediaLibrarySong
    ? getMediaLibraryRolePath(activeMediaLibrarySong, 'accompaniments', 'music')
    : undefined;
  const karaokeMusicVocalsPath = activeMediaLibrarySong
    ? getMediaLibraryRolePath(activeMediaLibrarySong, 'vocals', 'music')
    : undefined;
  const aoStemAvailability = {
    music: !!(selectedMediaRole && activeMediaLibrarySong && (
      getMediaLibraryRolePath(activeMediaLibrarySong, selectedMediaRole === 'vocals' ? 'vocals' : 'accompaniments', 'music')
    )),
    video: !!(selectedMediaRole && activeMediaLibrarySong && (
      getMediaLibraryRolePath(activeMediaLibrarySong, selectedMediaRole === 'vocals' ? 'vocals' : 'accompaniments', 'video')
    ))
  };
  const isKaraokeVideoActive = selectedMediaRole === 'karaoke' && isVideoTrack(currentTrack);
  const isKaraokeAudioActive = selectedMediaRole === 'karaoke' && !isVideoTrack(currentTrack);
  const isMusicStemActive = selectedMediaRole === 'accompaniments' || selectedMediaRole === 'vocals';
  const karaokeMusicTrack = activeMediaPaths.music
    ? tracks.find(track => getTrackFilePath(track)?.replace(/[\\/]+/g, '/').toLocaleLowerCase() ===
      activeMediaPaths.music?.replace(/[\\/]+/g, '/').toLocaleLowerCase())
    : undefined;
  const musicTrackPath = activeMediaPaths.music;
  const coverTrack = (isKaraokeAudioActive || isMusicStemActive) && musicTrackPath
    ? karaokeMusicTrack || {
      id: `path:${musicTrackPath}`,
      name: musicTrackPath.split(/[\\/]/).pop() || musicTrackPath,
      path: musicTrackPath
    }
    : currentTrack;
  const coverTrackKey = coverTrack ? getTrackCoverCacheKey(coverTrack) : null;
  const fullResolutionCover = useFullResolutionCover(
    coverTrack,
    coverTrackKey,
    showCover || isKaraokeAudioActive || isMusicStemActive,
    isVideoTrack,
    extractCoverFromFile,
    setLogs
  );
  const currentTrackCover = coverTrack?.cover || (
    coverTrackKey && fullResolutionCover?.key === coverTrackKey
      ? fullResolutionCover.url
      : undefined
  );
  const karaokeDisplayCover = currentTrackCover;
  const currentKaraokeMediaPath = activeTrackRole === 'video'
    ? activeMediaPaths.video || activeTrackPath || ''
    : activeTrackRole === 'music'
      ? activeMediaPaths.music || activeTrackPath || ''
      : activeMediaPaths.music || activeMediaPaths.video || '';

  useEffect(() => {
    if (!isMusicStemActive || !musicTrackPath) return;
    const musicTrack = karaokeMusicTrack || {
      id: `path:${musicTrackPath}`,
      name: musicTrackPath.split(/[\\/]/).pop() || musicTrackPath,
      path: musicTrackPath
    };
    const requestId = ++lyricsLoadRequestRef.current;
    void getLyricsForTrack(musicTrack, requestId).then(found => {
      if (requestId !== lyricsLoadRequestRef.current || !isMusicStemActive) return;
      setLyricsMode(currentMode => getLyricsModeAfterTrackLoad(currentMode, found));
    });
    return () => {
      if (lyricsLoadRequestRef.current === requestId) lyricsLoadRequestRef.current++;
    };
  }, [selectedMediaRole, currentTrack?.id, musicTrackPath]);

  function pauseKaraokeAccompaniment() {
    karaokeAccompanimentShouldPlayRef.current = false;
    const audio = karaokeAccompanimentRef.current;
    if (audio && (!audio.paused || karaokeAccompanimentPlayPendingRef.current)) audio.pause();
  }

  useEffect(() => {
    const audio = karaokeAccompanimentRef.current;
    if (!audio) return;
    pauseKaraokeAccompaniment();
    audio.removeAttribute('src');
    if (!karaokeAccompanimentPath) {
      audio.load();
      return;
    }

    audio.crossOrigin = 'anonymous';
    audio.src = musicFileUrl(karaokeAccompanimentPath);
    audio.load();
    return () => {
      pauseKaraokeAccompaniment();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [karaokeAccompanimentPath]);

  function syncKaraokeAccompaniment(shouldPlay: boolean, forceSeek = true) {
    const video = videoRef.current;
    const audio = karaokeAccompanimentRef.current;
    if (!video || !audio || !isKaraokeVideoActive || karaokeAudioSource !== 'accompaniment' || !karaokeAccompanimentPath) {
      pauseKaraokeAccompaniment();
      return;
    }

    karaokeAccompanimentShouldPlayRef.current = shouldPlay && !video.paused;
    video.muted = true;
    const resync = () => {
      if (forceSeek || Math.abs(audio.currentTime - video.currentTime) > 0.3) {
        try { audio.currentTime = video.currentTime; }
        catch (error) {
          const message = `Unable to synchronize karaoke accompaniment: ${String(error)}`;
          setPlaybackError(message);
          setLogs(logs => [...logs, message]);
          return;
        }
      }
      if (karaokeAccompanimentShouldPlayRef.current && !audio.paused) return;
      if (karaokeAccompanimentShouldPlayRef.current && !karaokeAccompanimentPlayPendingRef.current) {
        karaokeAccompanimentPlayPendingRef.current = true;
        let interruptedByPause = false;
        void audio.play().catch(error => {
          if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
            interruptedByPause = true;
            return;
          }
          if (!karaokeAccompanimentShouldPlayRef.current) return;
          const message = `Unable to play karaoke accompaniment: ${String(error)}`;
          setPlaybackError(message);
          setLogs(logs => [...logs, message]);
        }).finally(() => {
          karaokeAccompanimentPlayPendingRef.current = false;
          if (interruptedByPause && karaokeAccompanimentShouldPlayRef.current && !video.paused && audio.paused) {
            syncKaraokeAccompaniment(true, false);
          }
        });
      } else if (!karaokeAccompanimentShouldPlayRef.current) {
        pauseKaraokeAccompaniment();
      }
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) resync();
  }

  useEffect(() => {
    const video = videoRef.current;
    const audio = karaokeAccompanimentRef.current;
    if (!video || !audio) return;
    if (!isKaraokeVideoActive) {
      pauseKaraokeAccompaniment();
      video.muted = false;
      return;
    }
    const useAccompaniment = karaokeAudioSource === 'accompaniment' && !!karaokeAccompanimentPath;
    video.muted = useAccompaniment;
    if (useAccompaniment) syncKaraokeAccompaniment(isPlaying);
    else pauseKaraokeAccompaniment();
  }, [isKaraokeVideoActive, karaokeAudioSource, karaokeAccompanimentPath, isPlaying, currentTrack?.id]);

  function changeKaraokeAudioSource(source: 'accompaniment' | 'vocals' | 'original') {
    if (source === 'original' && !isKaraokeVideoActive) return;
    if (source === 'accompaniment' && !(isKaraokeVideoActive ? karaokeAccompanimentPath : karaokeMusicAccompanimentPath)) return;
    if (source === 'vocals' && (!isKaraokeAudioActive || !karaokeMusicVocalsPath)) return;
    setKaraokeAudioSource(source);
    if (isKaraokeAudioActive) {
      const filePath = source === 'vocals' ? karaokeMusicVocalsPath : karaokeMusicAccompanimentPath;
      if (filePath) void playLibraryFile(filePath, 'karaoke');
      return;
    }
    const video = videoRef.current;
    const audio = karaokeAccompanimentRef.current;
    if (source === 'original') {
      if (video) video.muted = false;
      pauseKaraokeAccompaniment();
      return;
    }
    if (video) video.muted = true;
    syncKaraokeAccompaniment(isPlaying);
  }

  function changeAoStemSource(role: 'accompaniments' | 'vocals', source: 'music' | 'video') {
    if (!activeMediaLibrarySong) return;
    const filePath = getMediaLibraryRolePath(activeMediaLibrarySong, role, source);
    if (!filePath) return;
    setAoStemSources(currentSources => ({ ...currentSources, [role]: source }));
    if (selectedMediaRole === role) void playLibraryFile(filePath, role);
  }

  useEffect(() => {
    if (selectedMediaRole !== 'karaoke' || !karaokeSubtitlePath) {
      setKaraokeSubtitleLines([]);
      setKaraokeSubtitleError('');
      return;
    }

    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'readKaraokeSubtitle')) {
      setKaraokeSubtitleLines([]);
      setKaraokeSubtitleError('Karaoke subtitle reading is unavailable.');
      return;
    }

    let cancelled = false;
    setKaraokeSubtitleLines([]);
    setKaraokeSubtitleError('');
    void api.readKaraokeSubtitle(karaokeSubtitlePath).then(result => {
      if (cancelled) return;
      if (!result.ok) throw new Error(result.error);
      setKaraokeSubtitleLines(result.lines);
    }).catch(error => {
      if (cancelled) return;
      const message = `Unable to load karaoke subtitle: ${String(error)}`;
      setKaraokeSubtitleError(message);
      setLogs(current => [...current, message]);
    });
    return () => { cancelled = true; };
  }, [selectedMediaRole, karaokeSubtitlePath]);

  async function playMediaRole(role: MediaLibraryRole) {
    if (role === 'accompaniments' && !activeMediaPaths.accompaniments && backingToggleEnabled) {
      await toggleBackingTrack();
      return;
    }
    if (role === 'karaoke') {
      const source = karaokePlaybackPath
        ? karaokeAccompanimentPath ? 'accompaniment' : 'original'
        : 'accompaniment';
      setKaraokeAudioSource(source);
      if (videoRef.current) videoRef.current.muted = source === 'accompaniment';
    }
    const filePath = role === 'karaoke'
      ? karaokePlaybackPath || karaokeMusicAccompanimentPath
      : role === 'accompaniments' || role === 'vocals'
        ? activeMediaLibrarySong
          ? getMediaLibraryRolePath(activeMediaLibrarySong, role, aoStemSources[role])
          : undefined
        : activeMediaPaths[role];
    if (filePath) await playLibraryFile(filePath, role);
  }

  async function toggleMediaFullscreen() {
    try {
      if (document.fullscreenElement === mediaDisplayRef.current) {
        await document.exitFullscreen();
        return;
      }
      const display = mediaDisplayRef.current;
      if (!display?.requestFullscreen) throw new Error('Full screen is not supported by this window.');
      await display.requestFullscreen();
    } catch (error) {
      const message = `Unable to change full screen mode: ${String(error)}`;
      console.error(message, error);
      setLogs(logs => [...logs, message]);
      alert(message);
    }
  }

  function showFullscreenVideoControls() {
    if (!isMediaFullscreen || !isVideoTrack(currentTrack)) return;
    setShowVideoFullscreenControls(true);
    if (fullscreenControlsTimerRef.current !== null) {
      window.clearTimeout(fullscreenControlsTimerRef.current);
    }
    fullscreenControlsTimerRef.current = window.setTimeout(() => setShowVideoFullscreenControls(false), 2000);
  }

  const isPlaybackActive = isPlaying || isPlaybackStarting;

  return (
    <div className={`app${view === 'player' ? ' player-view' : ''}`} role="application" aria-label="MintPlayer" style={{ background: 'radial-gradient(circle at top, #2b2931 0%, #17181d 28%, #0c0d10 100%)', color: '#f5f7fb', gap: 20, padding: '18px 18px 26px', height: '100vh', boxSizing: 'border-box' }}>

      <PlaylistPanel
        panelMode={sidebarMode}
        onPanelModeChange={mode => {
          setSidebarMode(mode);
          setView('player');
        }}
        selectedTool={selectedTool}
        onSelectTool={setSelectedTool}
        tracks={tracks}
        playlists={playlists}
        playlistsRef={playlistsRef}
        selectedPlaylistName={selectedPlaylistName}
        playlistNameDraft={playlistNameDraft}
        setPlaylistNameDraft={setPlaylistNameDraft}
        isPlaylistOptionsOpen={isPlaylistOptionsOpen}
        setIsPlaylistOptionsOpen={setIsPlaylistOptionsOpen}
        isPlaylistOperationPending={isPlaylistOperationPending}
        runPlaylistOperation={runPlaylistOperation}
        createPlaylist={createPlaylist}
        savePlaylist={savePlaylist}
        deletePlaylist={deletePlaylist}
        selectPlaylist={selectPlaylist}
        addFilesInputRef={addFilesInputRef}
        addFolderInputRef={addFolderInputRef}
        onAddFilesClick={() => void onAddFilesClick()}
        onFiles={onFiles}
        onFolder={onFolder}
        onAddFolder={() => void onAddFolderClick()}
        selectedTrackIds={selectedTrackIds}
        deleteSelectedTracks={deleteSelectedTracks}
        onSettingsClick={() => setView(view === 'config' ? 'player' : 'config')}
        mediaLibraryPath={mediaLibraryPath}
        mediaLibraryRefreshKey={mediaLibraryRefreshKey}
        onAddLibraryFiles={filePaths => { void addFilesFromPathList(filePaths); }}
        onPlayLibraryFile={(filePath, role) => { void playLibraryFile(filePath, role); }}
        isDragging={isDragging}
        handleDrop={handleDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        trackListRef={trackListRef}
        updateTrackVirtualWindow={updateTrackVirtualWindow}
        trackVirtualWindow={trackVirtualWindow}
        draggedTrackIndex={draggedTrackIndex}
        draggedTrackIndexRef={draggedTrackIndexRef}
        dropInsertionIndex={dropInsertionIndex}
        setDraggedTrackIndex={setDraggedTrackIndex}
        setDropInsertionIndex={setDropInsertionIndex}
        getTrackInsertionIndex={getTrackInsertionIndex}
        moveTrack={moveTrack}
        finishTrackReorder={finishTrackReorder}
        selectPlaylistTrack={selectPlaylistTrack}
        handlePlaylistTrackClick={handlePlaylistTrackClick}
        trackPreviewTimerRef={trackPreviewTimerRef}
        playIndex={playPlaylistTrack}
        showCover={showCover}
        trackCoverCache={trackCoverCache}
        isVideoTrack={isVideoTrack}
      />

      <main className="player" role="main" aria-label={sidebarMode === 'tools' && view !== 'config' ? 'Tools workspace' : 'Player'} style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0, height: '100%' }}>
        {view === 'config' ? (
          <div className="config-panel" style={{ background: 'rgba(18,18,23,0.92)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 24, padding: 24, boxShadow: '0 18px 40px rgba(0,0,0,0.32)' }}>
            <h2 style={{ marginTop: 0, color: '#f5f7fb' }}>Configuration</h2>
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 18 }}>
                <label htmlFor="mediaLibraryPath" style={{ display: 'block', marginBottom: 8, color: '#eef2ff' }}>
                  Media library location
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="mediaLibraryPath"
                    type="text"
                    value={mediaLibraryPath}
                    placeholder="C:\\source"
                    onChange={event => saveMediaLibraryPath(event.currentTarget.value)}
                    style={{ flex: 1, minWidth: 0, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#111218', color: '#f5f7fb', padding: '10px 12px' }}
                  />
                  <button
                    type="button"
                    onClick={() => void browseMediaLibraryPath()}
                    style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#1d1f27', color: '#f5f7fb', padding: '10px 14px' }}
                  >
                    Browse...
                  </button>
                </div>
                {mediaLibraryLocationError && (
                  <p role="alert" style={{ margin: '8px 0 0', color: '#ff9b9b' }}>{mediaLibraryLocationError}</p>
                )}
              </div>
              <label style={{ display: 'block', marginBottom: 10, color: '#eef2ff' }}>
                <input type="checkbox" checked={showCover} onChange={(e)=>{ const v = e.target.checked; setShowCover(v); const error = writePreference('showCover', String(v)); if (error) setLogs(logs => [...logs, error]); }} /> Show covers and videos in Player, Playlist, and Media Downloader
              </label>
              <label style={{ display: 'block', marginBottom: 10, color: '#eef2ff' }}>
                <input type="checkbox" checked={autoNext} onChange={(e)=>{ const v = e.target.checked; autoNextRef.current = v; setAutoNext(v); const error = writePreference('autoNext', String(v)); if (error) setLogs(logs => [...logs, error]); }} /> Auto play next
              </label>
              <label style={{ display: 'block', marginBottom: 10, color: '#eef2ff' }}>
                <input type="checkbox" checked={loopPlaylist} onChange={(e)=>{ const v = e.target.checked; setLoopPlaylist(v); const error = writePreference('loopPlaylist', String(v)); if (error) setLogs(logs => [...logs, error]); }} /> Loop playlist when finished
              </label>
            </div>
            <div>
              <button onClick={()=>setView('player')} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: '#1d1f27', color: '#f5f7fb', padding: '10px 14px' }}>Back to Player</button>
            </div>
          </div>
        ) : (
          <>
            <div
              className="player-live-content"
              style={sidebarMode === 'tools'
                ? { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }
                : { display: 'contents' }}
            >
            <div className="media-stage" style={{ display: 'flex', gap: 18, alignItems: 'stretch', flex: '1 1 auto', minHeight: 500, height: '100%', minWidth: 0 }}>
              <div
                ref={mediaDisplayRef}
                className="media-display"
                onPointerMove={showFullscreenVideoControls}
                onClick={(event) => {
                  const target = event.target;
                  if (target instanceof Element && target.closest('button, input, select, textarea, [role="button"], .fullscreen-video-controls')) return;
                  void togglePlayback();
                }}
                style={{ position: 'relative', flex: 1, minWidth: 260, minHeight: 500, borderRadius: 24, boxShadow: '0 28px 60px rgba(0,0,0,0.32)', background: 'linear-gradient(135deg, #f6d38c 0%, #ff8f70 40%, #7a5cff 100%)', overflow: 'hidden' }}
              >
                <div className="media-display-toolbar" style={{ position: 'absolute', right: 14, top: 14, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {mediaFront === 'lyrics' && (
                    <LyricsModeToggle
                      mode={lyricsMode}
                      onModeChange={mode => {
                        if (tagInfoVisible) closeTagEditor();
                        setLyricsMode(mode);
                      }}
                    />
                  )}
                  {(mediaFront === 'cover' || isVideoTrack(currentTrack)) && (
                    <button
                      type="button"
                      className="media-fullscreen-toggle"
                      onClick={() => {
                        if (tagInfoVisible) closeTagEditor();
                        void toggleMediaFullscreen();
                      }}
                      aria-label={isMediaFullscreen ? 'Exit full screen' : 'Enter full screen'}
                      aria-pressed={isMediaFullscreen}
                      title={isMediaFullscreen ? 'Exit full screen' : 'Full screen'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 42,
                        height: 42,
                        minWidth: 0,
                        padding: 0,
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.04)',
                        color: '#f5f7fb',
                        cursor: 'pointer',
                        boxShadow: '0 12px 26px rgba(0,0,0,0.18)',
                      }}
                    >
                      {isMediaFullscreen ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4m11 5v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className="media-view-toggle"
                    onClick={() => {
                      if (tagInfoVisible) closeTagEditor();
                      setMediaFront((v) => v === 'lyrics' ? 'cover' : 'lyrics');
                    }}
                    aria-label={mediaFront === 'lyrics' ? 'Show cover' : 'Show lyrics'}
                    title={mediaFront === 'lyrics' ? 'Cover' : 'Lyrics'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 42,
                      height: 42,
                      minWidth: 0,
                      padding: 0,
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: 'rgba(255,255,255,0.04)',
                      color: '#f5f7fb',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 12px 26px rgba(0,0,0,0.18)',
                    }}
                  >
                    {mediaFront === 'lyrics' ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                        <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.8"/>
                        <circle cx="12" cy="12" r="1.25" fill="currentColor"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                        <path d="M4 12h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`media-info-toggle${tagInfoVisible ? ' active' : ''}`}
                    onClick={toggleTagInfo}
                    disabled={selected == null && current == null}
                    aria-label={tagInfoVisible ? 'Show cover and lyrics' : 'Show selected item information'}
                    aria-pressed={tagInfoVisible}
                    title="Info"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
                      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      <circle cx="12" cy="7.5" r="1" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
                <VideoElement
                  mediaRef={videoRef}
                  aria-label={`Video playback: ${currentTrack?.name || ''}`}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  onSeeking={() => {
                    resetVideoPitchBuffers();
                    if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                      pauseKaraokeAccompaniment();
                    }
                  }}
                  onPlay={(event) => {
                    resetVideoPitchBuffers();
                    const video = event.currentTarget;
                    if (activeMediaRef.current === video) {
                      syncKaraokeAccompaniment(true);
                      finishBufferingMeasurement(video);
                      updatePlaybackStarting(false);
                      setIsPlaying(true);
                    }
                  }}
                  onPause={(event) => {
                    resetVideoPitchBuffers();
                    const video = event.currentTarget;
                    if (activeMediaRef.current === video) {
                      syncKaraokeAccompaniment(false);
                      finishBufferingMeasurement(video);
                      updatePlaybackStarting(false);
                      setIsPlaying(false);
                    }
                  }}
                  onSeeked={(event) => {
                    if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                      syncKaraokeAccompaniment(!event.currentTarget.paused);
                    }
                  }}
                  onWaiting={(event) => {
                    if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                      pauseKaraokeAccompaniment();
                    }
                    recordBufferingEvent(event.currentTarget, 'waiting');
                  }}
                  onStalled={(event) => {
                    if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                      pauseKaraokeAccompaniment();
                    }
                    recordBufferingEvent(event.currentTarget, 'stalled');
                  }}
                  onPlaying={(event) => {
                    finishBufferingMeasurement(event.currentTarget);
                    if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                      syncKaraokeAccompaniment(true);
                    }
                    recordAudioDiagnosticEvent('video element playing', event.currentTarget);
                  }}
                  onCanPlay={(event) => finishBufferingMeasurement(event.currentTarget)}
                  onTimeUpdate={(event) => {
                    if (!seekingRef.current) setSeekTime(event.currentTarget.currentTime || 0);
                    if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                      syncKaraokeAccompaniment(!event.currentTarget.paused, false);
                    }
                    recordPlaybackProgress(event.currentTarget);
                  }}
                  onEnded={() => {
                    pauseKaraokeAccompaniment();
                    if (activeMediaRef.current === videoRef.current && (!autoNextRef.current || !nextTrack())) setIsPlaying(false);
                  }}
                  onError={(event) => {
                    const error = event.currentTarget.error;
                    if (activeMediaRef.current !== event.currentTarget) return;
                    reportPlaybackFailure(`Video playback failed for ${currentTrack?.name || 'unknown file'}: ${error?.message || error?.code || 'unsupported format or codec'}`);
                  }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: mediaFront === 'cover' ? 3 : 1,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: isVideoTrack(currentTrack) ? 'block' : 'none',
                    visibility: isVideoTrack(currentTrack) && !showCover ? 'hidden' : 'visible',
                    background: '#08090b'
                  }}
                />
                {selectedMediaRole === 'karaoke' && karaokeSubtitleError && (
                  <p role="alert" style={{ position: 'absolute', zIndex: 5, left: 20, right: 20, bottom: 60, margin: 0, padding: 10, borderRadius: 10, background: 'rgba(20,12,14,0.82)', color: '#ffb2b2', textAlign: 'center' }}>
                    {karaokeSubtitleError}
                  </p>
                )}
                <KaraokeSubtitleOverlay
                  visible={selectedMediaRole === 'karaoke' && !karaokeSubtitleError && (showCover || !isVideoTrack(currentTrack))}
                  currentTime={seekTime}
                  lines={karaokeSubtitleLines}
                  videoElement={isKaraokeVideoActive ? videoRef.current : null}
                  isPlaying={isPlaying}
                />
                <VideoSeekControls
                  visible={isMediaFullscreen && isVideoTrack(currentTrack)}
                  controlsVisible={showVideoFullscreenControls}
                  currentTime={seekTime}
                  duration={duration}
                  formatTime={formatTime}
                  onShowControls={showFullscreenVideoControls}
                  onSeek={time => {
                    if (!Number.isFinite(time)) return;
                    setSeekTime(time);
                    const video = videoRef.current;
                    if (video) video.currentTime = time;
                  }}
                />
                <PlayerCover visible={showCover || isKaraokeAudioActive || isMusicStemActive} isVideo={isKaraokeAudioActive || isMusicStemActive ? false : isVideoTrack(currentTrack)} src={karaokeDisplayCover} onTop={mediaFront === 'cover'} />
                {selectedMediaRole !== 'karaoke' && (
                  <div style={{ position: 'absolute', inset: 0, zIndex: mediaFront === 'lyrics' ? 2 : 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'rgba(17,18,23,0.68)', borderRadius: 24, border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 18px 40px rgba(0,0,0,0.24)', padding: 18, opacity: mediaFront === 'lyrics' ? 1 : 0.82, transition: 'opacity 0.18s ease' }}>
                    <LyricsContent
                      lyricsRaw={lyricsRaw}
                      lyricsTimed={lyricsTimed}
                      mode={lyricsMode}
                      activeIndex={lyricsIndex}
                      onSeek={seekAndPlay}
                      containerRef={lyricsContainerRef}
                      variant="player"
                    />
                  </div>
                )}
                {tagInfoVisible && (
                  <section
                    className="tag-editor-overlay"
                    aria-label="Edit MP3 tags"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <header className="tag-editor-header">
                      <div className="tag-editor-header-title">
                        <h2>Edit MP3 tags</h2>
                        <p>{tracks.find(track => track.id === tagEditorTrackId)?.name || ''}</p>
                      </div>
                      <div className="tag-editor-header-actions">
                        <button
                          type="button"
                          className="tag-editor-header-icon"
                          onClick={openMetadataPicker}
                          disabled={metadataSearchLoading || tagEditorSaving || !tagEditorDraft}
                          aria-label="Search online for all MP3 information"
                          title="Search online for all MP3 information"
                        >
                          {metadataSearchLoading ? (
                            <span className="tag-editor-info-search-spinner" aria-hidden="true" />
                          ) : (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="10.8" cy="10.8" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                              <path d="m16 16 4.2 4.2M8 10.8h5.6M10.8 8v5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="tag-editor-header-icon"
                          onClick={() => void searchOnlineLyrics()}
                          disabled={lyricsSearchLoading || metadataApplyIndex !== null || tagEditorSaving || !tagEditorDraft}
                          aria-label="Search online for lyrics"
                          title="Search online for lyrics"
                        >
                          {lyricsSearchLoading ? (
                            <span className="tag-editor-info-search-spinner" aria-hidden="true" />
                          ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                              <path d="m15.5 15.5 4 4M8 8.3h5M8 10.7h4M8 13.1h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="tag-editor-header-icon"
                          onClick={closeTagEditor}
                          disabled={tagEditorSaving}
                          aria-label="Cancel MP3 tag editing"
                          title="Cancel"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="tag-editor-header-icon tag-editor-header-save"
                          onClick={() => void saveTagEditor()}
                          disabled={tagEditorSaving || tagEditorLoading || !tagEditorDraft}
                          aria-label={tagEditorSaving ? 'Saving MP3 tags' : 'Save MP3 tags'}
                          title={tagEditorSaving ? 'Saving tags…' : 'Save tags'}
                        >
                          {tagEditorSaving ? (
                            <span className="tag-editor-info-search-spinner" aria-hidden="true" />
                          ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M5 3h12l4 4v14H3V3h2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                              <path d="M7 3v6h10V3M7 21v-7h10v7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </header>
                    {metadataOverwriteConfirmation && (
                      <div
                        className="tag-editor-confirm-backdrop"
                        onKeyDown={event => {
                          if (event.key === 'Escape') setMetadataOverwriteConfirmation(null);
                        }}
                      >
                        <section
                          className="tag-editor-confirm-dialog"
                          role="alertdialog"
                          aria-modal="true"
                          aria-labelledby="metadata-overwrite-title"
                          aria-describedby="metadata-overwrite-description"
                        >
                          <h3 id="metadata-overwrite-title">Replace existing information?</h3>
                          <p id="metadata-overwrite-description">
                            Replace existing {metadataOverwriteConfirmation.labels.join(', ')} with the selected online information?
                          </p>
                          <footer>
                            <button
                              type="button"
                              onClick={() => setMetadataOverwriteConfirmation(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="tag-editor-confirm-primary"
                              onClick={confirmMetadataOverwrite}
                            >
                              Replace
                            </button>
                          </footer>
                        </section>
                      </div>
                    )}
                    {metadataPickerOpen && (
                      <section
                        className={`tag-editor-metadata-picker${advancedMetadataSelection ? ' has-advanced-selection' : ''}`}
                        aria-label="Select online MP3 information"
                      >
                        <header className="tag-editor-metadata-picker-header">
                          <div>
                            <h3>Choose MP3 information</h3>
                            <p>Select a result to fill all available fields, or use Advance select to choose specific fields.</p>
                          </div>
                          <button
                            type="button"
                            className="tag-editor-close"
                            aria-label="Close without selecting"
                            title="Close without selecting"
                            onClick={closeMetadataPicker}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </header>
                        {metadataSearchWarning && (
                          <p className="tag-editor-notice" role="status">{metadataSearchWarning}</p>
                        )}
                        {metadataSearchLoading ? (
                          <p className="tag-editor-notice" role="status">Searching Apple Music/iTunes, Discogs, and MusicBrainz…</p>
                        ) : metadataSearchError ? (
                          <p className="tag-editor-error" role="alert">{metadataSearchError}</p>
                        ) : metadataSearchResults.length ? (
                          <>
                            <div className="tag-editor-metadata-grid" hidden={!!advancedMetadataSelection}>
                              {metadataSearchResults
                                .slice(
                                  metadataSearchPage * METADATA_RESULTS_PER_PAGE,
                                  (metadataSearchPage + 1) * METADATA_RESULTS_PER_PAGE
                                )
                                .map((result, pageResultIndex) => {
                                  const resultIndex = metadataSearchPage * METADATA_RESULTS_PER_PAGE + pageResultIndex;
                                  const matchDetails = getOnlineMetadataMatchDetails(
                                    result,
                                    lyricsSearchResults,
                                    { ...getOnlineSearchHints(), title: getOnlineSearchTitle() }
                                  );
                                  return (
                                    <div className="tag-editor-metadata-card-wrap" key={`${result.country}-${result.id}`}>
                                      <button
                                        type="button"
                                        className="tag-editor-metadata-card"
                                        onClick={() => void useOnlineMetadata(result, resultIndex)}
                                        disabled={tagEditorSaving || metadataApplyIndex !== null}
                                        aria-label={`Select ${result.trackName} by ${result.artistName}, ${result.albumName || 'album unavailable'}`}
                                      >
                                        <OnlineMatchIndicators details={matchDetails} />
                                        {result.artworkUrl
                                          ? <img src={result.artworkUrl} alt="" />
                                          : <span className="tag-editor-metadata-card-no-cover">No cover</span>}
                                        <span className="tag-editor-metadata-card-info">
                                          <strong>{result.trackName}</strong>
                                          <small>
                                            {result.country ? `${metadataRegionLabels[result.country]} · ` : ''}
                                            {getMetadataSourceSummary(result)}
                                          </small>
                                          <span>{result.artistName}</span>
                                          <span>{result.albumName || 'Album unavailable'}</span>
                                          <small>
                                            {[result.year, result.trackNumber ? `Track ${result.trackNumber}` : '', result.duration != null ? formatTime(result.duration) : '']
                                              .filter(Boolean).join(' · ')}
                                          </small>
                                          {metadataApplyIndex === resultIndex && <small className="tag-editor-metadata-card-loading">Loading artwork…</small>}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className="tag-editor-metadata-advanced-trigger"
                                        aria-label={`Advance select for ${result.trackName} by ${result.artistName}`}
                                        title="Advance select"
                                        onClick={() => openAdvancedMetadataSelection(result, resultIndex)}
                                        disabled={tagEditorSaving || metadataApplyIndex !== null}
                                      >
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                          <path d="M4 5h16M4 12h10M4 19h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                          <path d="m16 17 2 2 4-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </button>
                                    </div>
                                  );
                                })}
                            </div>
                            {advancedMetadataSelection && tagEditorDraft && (
                              <section
                                className="tag-editor-metadata-advanced"
                                aria-label={`Advanced field selection for ${advancedMetadataSelection.result.trackName}`}
                              >
                                <header>
                                  <div>
                                    <h4>Choose fields to update</h4>
                                    <p>Only checked fields will be changed; other tag values stay as they are.</p>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label="Close advanced selection"
                                    title="Close advanced selection"
                                    onClick={() => setAdvancedMetadataSelection(null)}
                                  >
                                    ×
                                  </button>
                                </header>
                                <div className="tag-editor-metadata-advanced-fields">
                                  {ONLINE_METADATA_TEXT_FIELDS.map(({ field, label, getValue }) => {
                                    const nextValue = getValue(advancedMetadataSelection.result).trim();
                                    const available = !!nextValue;
                                    return (
                                      <label className="tag-editor-metadata-advanced-field" key={field}>
                                        <input
                                          type="checkbox"
                                          aria-label={label}
                                          checked={selectedMetadataFields.has(field)}
                                          disabled={!available || metadataApplyIndex !== null}
                                          onChange={event => {
                                            const checked = event.currentTarget.checked;
                                            setSelectedMetadataFields(previous => {
                                              const next = new Set(previous);
                                              if (checked) next.add(field);
                                              else next.delete(field);
                                              return next;
                                            });
                                          }}
                                        />
                                        <span className="tag-editor-metadata-advanced-label">{label}</span>
                                        <span className="tag-editor-metadata-advanced-values">
                                          <span>Current: {tagEditorDraft[field] || 'Empty'}</span>
                                          <span>
                                            New: {nextValue || 'Not provided'}
                                            {nextValue && advancedMetadataSelection.result.fieldSources?.[field]
                                              ? ` · ${advancedMetadataSelection.result.fieldSources[field]}`
                                              : ''}
                                          </span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                  <label className="tag-editor-metadata-advanced-field">
                                    <input
                                      type="checkbox"
                                      aria-label="Cover"
                                      checked={selectedMetadataFields.has('cover')}
                                      disabled={!advancedMetadataSelection.result.artworkUrl || metadataApplyIndex !== null}
                                      onChange={event => {
                                        const checked = event.currentTarget.checked;
                                        setSelectedMetadataFields(previous => {
                                          const next = new Set(previous);
                                          if (checked) next.add('cover');
                                          else next.delete('cover');
                                          return next;
                                        });
                                      }}
                                    />
                                    <span className="tag-editor-metadata-advanced-label">Cover</span>
                                    <span className="tag-editor-metadata-advanced-values">
                                      <span>Current: {tagEditorDraft.coverBase64 && !tagEditorDraft.removeCover ? 'Existing cover' : 'No cover'}</span>
                                      <span>
                                        New: {advancedMetadataSelection.result.artworkUrl
                                          ? `Artwork · ${getMetadataSourceLabel(advancedMetadataSelection.result.fieldSources?.cover)}`
                                          : 'Not provided'}
                                      </span>
                                    </span>
                                  </label>
                                </div>
                                <div className="tag-editor-metadata-unavailable-fields">
                                  <span>Each field uses Apple Music/iTunes first, then Discogs, then MusicBrainz.</span>
                                </div>
                                <footer>
                                  <button type="button" onClick={() => setAdvancedMetadataSelection(null)}>
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="tag-editor-metadata-advanced-apply"
                                    disabled={selectedMetadataFields.size === 0 || metadataApplyIndex !== null || tagEditorSaving}
                                    onClick={() => void useOnlineMetadata(
                                      advancedMetadataSelection.result,
                                      advancedMetadataSelection.resultIndex,
                                      selectedMetadataFields
                                    )}
                                  >
                                    Apply selected fields
                                  </button>
                                </footer>
                              </section>
                            )}
                            {metadataSearchResults.length > METADATA_RESULTS_PER_PAGE && !advancedMetadataSelection && (
                              <nav className="tag-editor-metadata-pagination" aria-label="Song information result pages">
                                <button
                                  type="button"
                                  onClick={() => setMetadataSearchPage(page => Math.max(0, page - 1))}
                                  disabled={metadataSearchPage === 0 || metadataApplyIndex !== null}
                                >
                                  Previous
                                </button>
                                <span aria-live="polite">
                                  Showing {metadataSearchPage * METADATA_RESULTS_PER_PAGE + 1}–
                                  {Math.min((metadataSearchPage + 1) * METADATA_RESULTS_PER_PAGE, metadataSearchResults.length)} of {metadataSearchResults.length}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setMetadataSearchPage(page =>
                                    Math.min(Math.ceil(metadataSearchResults.length / METADATA_RESULTS_PER_PAGE) - 1, page + 1)
                                  )}
                                  disabled={
                                    metadataSearchPage >= Math.ceil(metadataSearchResults.length / METADATA_RESULTS_PER_PAGE) - 1 ||
                                    metadataApplyIndex !== null
                                  }
                                >
                                  Next
                                </button>
                              </nav>
                            )}
                          </>
                        ) : (
                          <p className="tag-editor-notice" role="status">No matching song information found.</p>
                        )}
                      </section>
                    )}
                    {lyricsPickerOpen && (
                      <section className="tag-editor-metadata-picker tag-editor-lyrics-picker" aria-label="Select online lyrics">
                        <header className="tag-editor-metadata-picker-header">
                          <div>
                            <h3>Choose lyrics</h3>
                            <p>Select a lyrics card to fill the LRC field. Close to keep the current lyrics.</p>
                          </div>
                          <button
                            type="button"
                            className="tag-editor-close"
                            aria-label="Close without selecting"
                            title="Close without selecting"
                            onClick={closeLyricsPicker}
                          >
                            ×
                          </button>
                        </header>
                        {lyricsSearchLoading ? (
                          <p className="tag-editor-notice" role="status">Searching online for lyrics…</p>
                        ) : lyricsSearchError ? (
                          <div className="tag-editor-search-error" role="alert">
                            <p className="tag-editor-error">{lyricsSearchError}</p>
                            {lyricsSearchCanRetry && (
                              <button
                                type="button"
                                className="tag-editor-search-lyrics"
                                onClick={() => void searchOnlineLyrics()}
                                disabled={lyricsSearchLoading || tagEditorSaving}
                              >
                                Try again
                              </button>
                            )}
                          </div>
                        ) : lyricsSearchResults.length ? (
                          <>
                            {lyricsSearchNotice && <p className="tag-editor-notice" role="status">{lyricsSearchNotice}</p>}
                            <div className="tag-editor-lyrics-results" aria-label="Online lyrics search results">
                              {lyricsSearchResults
                                .slice(
                                  lyricsSearchPage * LYRICS_RESULTS_PER_PAGE,
                                  (lyricsSearchPage + 1) * LYRICS_RESULTS_PER_PAGE
                                )
                                .map((result, pageResultIndex) => {
                                  const resultIndex = lyricsSearchPage * LYRICS_RESULTS_PER_PAGE + pageResultIndex;
                                  const matchDetails = getOnlineMetadataMatchDetails(
                                    result,
                                    [],
                                    { ...getOnlineSearchHints(), title: getOnlineSearchTitle() },
                                    current != null && tracks[current]?.id === tagEditorTrackId &&
                                      Number.isFinite(duration) && duration > 0
                                      ? duration
                                      : undefined
                                  );
                                  return (
                                    <button
                                      type="button"
                                      className="tag-editor-lyrics-card"
                                      key={`${result.id}-${resultIndex}`}
                                      onClick={() => void useOnlineLyrics(result)}
                                      disabled={tagEditorSaving}
                                      aria-label={`Use lyrics for ${result.trackName} by ${result.artistName}`}
                                    >
                                      <OnlineMatchIndicators details={matchDetails} />
                                      <span className="tag-editor-lyrics-card-info">
                                        <strong>{result.trackName}</strong>
                                        <small>
                                          {[result.artistName, result.albumName, result.duration != null ? formatTime(result.duration) : '']
                                            .filter(Boolean).join(' · ')}
                                        </small>
                                        <small>
                                          {result.syncedLyrics ? 'Synchronized lyrics' : 'Plain lyrics'}
                                          {result.source ? ` · ${result.source}` : ''}
                                        </small>
                                      </span>
                                      <span className="tag-editor-lyrics-card-text">
                                        {result.syncedLyrics || result.plainLyrics || 'No lyrics available.'}
                                      </span>
                                    </button>
                                  );
                                })}
                            </div>
                            {lyricsSearchResults.length > LYRICS_RESULTS_PER_PAGE && (
                              <nav className="tag-editor-lyrics-pagination" aria-label="Lyrics result pages">
                                <button
                                  type="button"
                                  onClick={() => setLyricsSearchPage(page => Math.max(0, page - 1))}
                                  disabled={lyricsSearchPage === 0}
                                >
                                  Previous
                                </button>
                                <span aria-live="polite">
                                  Showing {lyricsSearchPage * LYRICS_RESULTS_PER_PAGE + 1}–
                                  {Math.min((lyricsSearchPage + 1) * LYRICS_RESULTS_PER_PAGE, lyricsSearchResults.length)} of {lyricsSearchResults.length}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setLyricsSearchPage(page =>
                                    Math.min(Math.ceil(lyricsSearchResults.length / LYRICS_RESULTS_PER_PAGE) - 1, page + 1)
                                  )}
                                  disabled={lyricsSearchPage >= Math.ceil(lyricsSearchResults.length / LYRICS_RESULTS_PER_PAGE) - 1}
                                >
                                  Next
                                </button>
                              </nav>
                            )}
                          </>
                        ) : (
                          <>
                            {lyricsSearchNotice && <p className="tag-editor-notice" role="status">{lyricsSearchNotice}</p>}
                            <p className="tag-editor-notice" role="status">No lyrics found. Check the title or artist and try again.</p>
                          </>
                        )}
                      </section>
                    )}
                    {tagEditorLoading ? (
                      <p className="tag-editor-notice">Reading tags…</p>
                    ) : tagEditorDraft ? (
                      <>
                        <div className="tag-editor-fields">
                          {([
                            ['title', 'Title'],
                            ['artist', 'Artist'],
                            ['album', 'Album'],
                            ['year', 'Year'],
                            ['track', 'Track'],
                            ['albumArtist', 'Album Artist'],
                            ['lyricist', 'Lyricist'],
                            ['composer', 'Composer']
                          ] as const).map(([field, label]) => (
                            field === 'artist' ? (
                              <div className="tag-editor-field" key={field}>
                                <div className="tag-editor-field-heading">
                                  <label htmlFor="tag-editor-artist">{label}</label>
                                </div>
                                <input
                                  id="tag-editor-artist"
                                  type="text"
                                  value={tagEditorDraft[field]}
                                  onChange={(event) => updateTagField(field, event.target.value)}
                                />
                              </div>
                            ) : (
                              <label className="tag-editor-field" key={field}>
                                <span>{label}</span>
                                <input
                                  type="text"
                                  value={tagEditorDraft[field]}
                                  onChange={(event) => updateTagField(field, event.target.value)}
                                />
                              </label>
                            )
                          ))}
                          <div className="tag-editor-field tag-editor-lyrics">
                            <div className="tag-editor-lyrics-heading">
                              <span>LRC</span>
                            </div>
                            <textarea
                              rows={10}
                              value={tagEditorDraft.lyrics}
                              placeholder="[00:12.34]Lyrics line"
                              onChange={(event) => updateTagField('lyrics', event.target.value)}
                              onBlur={(event) => void convertLyricsFieldOnBlur(event.currentTarget.value)}
                            />
                          </div>
                          <div className="tag-editor-cover">
                            <span className="tag-editor-cover-label">Cover</span>
                            <div className="tag-editor-cover-row">
                              {tagEditorDraft.coverBase64 && !tagEditorDraft.removeCover
                                ? <img src={`data:${tagEditorDraft.coverMime};base64,${tagEditorDraft.coverBase64}`} alt="Selected cover preview" />
                                : <div className="tag-editor-cover-empty">No cover</div>}
                              <div className="tag-editor-cover-actions">
                                <input
                                  ref={tagCoverInputRef}
                                  type="file"
                                  accept="image/jpeg,image/png,image/gif,image/webp"
                                  onChange={(event) => {
                                    chooseTagCover(event.currentTarget.files?.[0]);
                                    event.currentTarget.value = '';
                                  }}
                                />
                                <button type="button" onClick={() => tagCoverInputRef.current?.click()}>Choose image</button>
                                <label className="tag-editor-remove-cover">
                                  <input
                                    type="checkbox"
                                    checked={tagEditorDraft.removeCover}
                                    onChange={(event) => updateTagField('removeCover', event.target.checked)}
                                  />
                                  Remove embedded cover
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                        {tagEditorError && <p className="tag-editor-error" role="alert">{tagEditorError}</p>}
                        {tagEditorMessage && <p className="tag-editor-notice" role="status">{tagEditorMessage}</p>}
                      </>
                    ) : (
                      <>
                        {tagEditorError && <p className="tag-editor-error" role="alert">{tagEditorError}</p>}
                        <footer className="tag-editor-footer">
                          <button type="button" onClick={closeTagEditor}>Close</button>
                        </footer>
                      </>
                    )}
                  </section>
                )}
              </div>
            </div>

            <div className="player-bottom" style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '0 0 auto', minHeight: 0, minWidth: 0, width: '100%' }}>

              <div className="player-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 52, flexWrap: 'wrap', background: 'rgba(17,18,23,0.9)', borderRadius: 22, border: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px', boxShadow: '0 18px 40px rgba(0,0,0,0.25)', backdropFilter: 'blur(10px)' }}>
                <PlaybackTransport
                  currentTime={seekTime}
                  duration={duration}
                  formatTime={formatTime}
                  onSeek={time => {
                    setSeekTime(time);
                    try {
                      if (shifterRef.current) {
                        const shifterDuration = shifterRef.current.duration || duration || 0;
                        shifterRef.current.percentagePlayed = shifterDuration
                          ? Math.max(0, Math.min(1, time / shifterDuration))
                          : 0;
                      } else {
                        const media = currentMedia();
                        if (media) media.currentTime = time;
                      }
                    } catch (error) {
                      console.warn('seek input change failed', error);
                    }
                  }}
                  isPlaying={isPlaybackActive}
                  onPrevious={prevTrack}
                  onTogglePlayback={togglePlayback}
                  onNext={nextTrack}
                  mediaAvailability={playerMediaAvailability}
                  backingActive={!!activeTrack?.backingActive}
                  selectedMediaRole={selectedMediaRole}
                  karaokeAudioSource={karaokeAudioSource}
                  hasKaraokeAccompaniment={!!(isKaraokeVideoActive ? karaokeAccompanimentPath : karaokeMusicAccompanimentPath)}
                  hasKaraokeVocals={!!karaokeMusicVocalsPath}
                  karaokeHasVideo={!!karaokePlaybackPath}
                  onKaraokeAudioSourceChange={changeKaraokeAudioSource}
                  aoStemSource={selectedMediaRole === 'vocals' ? aoStemSources.vocals : aoStemSources.accompaniments}
                  aoStemAvailability={aoStemAvailability}
                  onAoStemSourceChange={changeAoStemSource}
                  onPlayMediaRole={role => {
                    setSelectedMediaRole(role);
                    void playMediaRole(role);
                  }}
                />

                <PlaybackAudioControls
                  volume={volume}
                  onVolumeChange={setVolume}
                  onToggleMute={toggleMute}
                  pan={pan}
                  onPanChange={setPan}
                  isVideo={isVideoTrack(activeTrack)}
                  transpose={transpose}
                  onTransposeChange={setTranspose}
                  showDebug={showDebug}
                  onToggleDebug={() => setShowDebug(value => !value)}
                />
              </div>
              {playbackError && (
                <div role="alert" aria-live="assertive" style={{ padding: '10px 14px', borderRadius: 12, color: '#ffe1dc', background: 'rgba(132,38,32,0.28)', border: '1px solid rgba(255,125,110,0.42)' }}>
                  {playbackError}
                </div>
              )}
              {showDebug && (
                <div style={{ background: 'rgba(17,18,23,0.9)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <strong style={{ color: '#f5f7fb' }}>Debug &amp; playback diagnostics</strong>
                    <button type="button" className="debug-toggle" onClick={clearPlaybackDiagnostics}>Clear diagnostics</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, margin: '12px 0', color: '#dfe6f4', fontSize: 12 }}>
                    <div>
                      Media: {diagnosticMedia ? (diagnosticMedia === videoRef.current ? 'video' : 'audio') : 'none'}
                      {' · '}readyState: {diagnosticMedia ? `${diagnosticMedia.readyState}/4 (${['nothing', 'metadata', 'current data', 'future data', 'enough data'][diagnosticMedia.readyState] || 'unknown'})` : '—'}
                      {' · '}buffered ahead: {diagnosticBufferedAhead == null ? '—' : `${diagnosticBufferedAhead.toFixed(2)} s`}
                      {' · '}media volume: {diagnosticMedia ? `${Math.round(diagnosticMedia.volume * 100)}%${diagnosticMedia.muted ? ' (muted)' : ''}` : '—'}
                    </div>
                    <div>
                      Output signal before device: RMS {audioOutputMeter?.rms.toFixed(5) ?? '—'}
                      {' · '}peak {audioOutputMeter?.peak.toFixed(5) ?? '—'}
                      {' · '}app volume {Math.round(volume * 100)}%
                    </div>
                    <div>
                      AudioContext: {audioCtxRef.current?.state || 'not created'}
                      {' · '}gain: {gainRef.current?.gain?.value ?? '—'}
                      {' · '}sink: {audioCtxRef.current && 'sinkId' in audioCtxRef.current
                        ? String(audioCtxRef.current.sinkId) || 'default'
                        : 'default'}
                      {' · '}transpose: {transpose > 0 ? `+${transpose}` : transpose} semitones
                      {' · '}pitch shifter: {transpose === 0 ? 'off' : diagnosticPitchShifterActive ? 'active' : 'requested, not active'}
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      Audio route: {audioOutputRouteRef.current}
                    </div>
                    <div>
                      Possible buffering: waiting {playbackDiagnostics.waitingEvents}, stalled {playbackDiagnostics.stalledEvents}
                      {' · '}total {((playbackDiagnostics.totalBufferingMs + diagnosticBufferingMs) / 1000).toFixed(2)} s
                      {' · '}max { (playbackDiagnostics.maxBufferingMs / 1000).toFixed(2)} s
                      {' · '}last {(playbackDiagnostics.lastBufferingMs / 1000).toFixed(2)} s
                    </div>
                    <div>
                      Progress gaps over 2 s: {playbackDiagnostics.progressGaps}
                      {' · '}max {(playbackDiagnostics.maxProgressGapMs / 1000).toFixed(2)} s
                      {' · '}last {(playbackDiagnostics.lastProgressGapMs / 1000).toFixed(2)} s
                    </div>
                    <div>
                      Transpose decodes: {playbackDiagnostics.decodeCount}
                      {' · '}cache hits: {playbackDiagnostics.decodeCacheHits}
                    </div>
                    <div>
                      Last decode: {playbackDiagnostics.lastDecodeTrack || '—'}
                      {' · '}{playbackDiagnostics.lastDecodeSource || 'no decode yet'}
                      {' · '}total {playbackDiagnostics.lastDecodeMs == null ? '—' : `${playbackDiagnostics.lastDecodeMs.toFixed(0)} ms`}
                      {' · '}read {playbackDiagnostics.lastDecodeReadMs == null ? '—' : `${playbackDiagnostics.lastDecodeReadMs.toFixed(0)} ms`}
                      {' · '}decode {playbackDiagnostics.lastDecodeProcessingMs == null ? '—' : `${playbackDiagnostics.lastDecodeProcessingMs.toFixed(0)} ms`}
                      {' · '}{playbackDiagnostics.lastDecodeBytes == null ? '—' : `${(playbackDiagnostics.lastDecodeBytes / (1024 * 1024)).toFixed(2)} MB`}
                    </div>
                    {playbackDiagnostics.lastDecodeError && (
                      <div role="status" style={{ color: '#ff9c9c', gridColumn: '1 / -1' }}>
                        Last transpose decode error: {playbackDiagnostics.lastDecodeError}
                      </div>
                    )}
                    <div style={{ gridColumn: '1 / -1', opacity: 0.75 }}>
                      Buffering and progress gaps are indicators of possible playback stalls, not direct hardware audio-underrun measurements.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8, marginTop: 8 }}>
                    <div style={{ flex: 1, maxHeight: 220, overflow: 'auto', background: '#0d0f15', padding: 8, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                      <pre style={{ whiteSpace: 'pre-wrap', color: '#dfe6f4', margin: 0 }}>{JSON.stringify(tracks.map(t=>({ id: t.id, name: t.name, hasFile: !!t.file, hasCover: !!t.cover, src: t.src })), null, 2)}</pre>
                    </div>
                    <div style={{ width: 240 }}>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ marginRight: 8, color: '#dfe6f4' }}>Transpose (semitones)</label>
                        <TransposeControls value={transpose} onChange={setTranspose} compact />
                      </div>
                      <div style={{ fontSize: 12, color: '#bfc9e6' }}>
                        Note: high-quality pitch-shifter will be integrated into the AudioWorklet processor. Current worklet is a skeleton; after integrating algorithm the transpose will change pitch while keeping tempo.
                      </div>
                    </div>
                  </div>
                  <div
                    role="log"
                    aria-label="Debug log"
                    style={{
                      maxHeight: 220,
                      overflowY: 'auto',
                      scrollbarGutter: 'stable',
                      color: '#dfe6f4',
                      whiteSpace: 'pre-wrap',
                      background: '#0d0f15',
                      padding: 8,
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.08)'
                    }}
                  >
                    {logs.join('\n')}
                  </div>
                </div>
              )}
            </div>
            </div>
            <AudioElement
              mediaRef={audioRef}
              onWaiting={(event) => recordBufferingEvent(event.currentTarget, 'waiting')}
              onStalled={(event) => recordBufferingEvent(event.currentTarget, 'stalled')}
              onPlaying={(event) => {
                finishBufferingMeasurement(event.currentTarget);
                recordAudioDiagnosticEvent('audio element playing', event.currentTarget);
              }}
              onCanPlay={(event) => finishBufferingMeasurement(event.currentTarget)}
              onEnded={() => { if (activeMediaRef.current === audioRef.current && (!autoNextRef.current || !nextTrack())) setIsPlaying(false); }}
              onError={(event) => {
                const audio = event.currentTarget;
                if (activeMediaRef.current !== audio) return;
                reportPlaybackFailure(`Audio playback failed: ${audio.error?.message || audio.error?.code || 'the media source could not be loaded or decoded'}`);
              }}
              style={{ display: 'none', marginTop: 0, filter: 'sepia(0.2) saturate(1.2) brightness(1.05)' }}
            />
            <AudioElement
              mediaRef={karaokeAccompanimentRef}
              aria-label="Karaoke accompaniment audio"
              preload="auto"
              onLoadedMetadata={() => {
                if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                  syncKaraokeAccompaniment(isPlaying);
                }
              }}
              onError={() => {
                if (isKaraokeVideoActive && karaokeAudioSource === 'accompaniment') {
                  const message = `Unable to load karaoke accompaniment: ${karaokeAccompanimentPath || 'audio file not found'}`;
                  setPlaybackError(message);
                  setLogs(logs => [...logs, message]);
                }
              }}
              style={{ display: 'none' }}
            />
            {sidebarMode === 'tools' && (
              <section
                className="tool-workspace"
                aria-label={selectedTool ? `${selectedTool} operations` : 'Tool workspace'}
                style={{ flex: '1 1 auto', minHeight: 0, padding: 28, borderRadius: 24, background: 'rgba(18,18,23,0.92)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 18px 40px rgba(0,0,0,0.32)', ...(selectedTool === 'Media Downloader' ? { display: 'flex', flexDirection: 'column' as const } : {}) }}
              >
                <Suspense fallback={<p role="status">Loading {selectedTool || 'tool'}...</p>}>
                {selectedTool === 'Vocal Splitter' ? (
                  <>
                    <h1 style={{ margin: '0 0 12px', color: '#f5f7fb', fontSize: '1.4rem' }}>Vocal Splitter</h1>
                    <p style={{ margin: '0 0 18px', color: 'rgba(245,247,251,0.62)' }}>
                      Create backing tracks from audio or MP4 video files in a folder.
                    </p>
                    <div className="vocal-splitter-controls" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 900, margin: '14px 0' }}>
                      <label htmlFor="vocal-splitter-folder" style={{ flex: '0 0 auto', color: '#eef2ff' }}>
                        Folder Path
                      </label>
                      <input
                        id="vocal-splitter-folder"
                        type="text"
                        aria-label="Folder path"
                        value={vocalSplitterFolder}
                        disabled={vocalSplitterRunning}
                        onChange={event => {
                          setVocalSplitterFolder(event.currentTarget.value);
                          setVocalSplitterError('');
                        }}
                        placeholder="C:\\Media\\Video"
                        style={{ flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#111218', color: '#f5f7fb', padding: '10px 12px' }}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Browse..."
                        title="Browse for folder"
                        onClick={() => void browseVocalSplitterFolder()}
                        disabled={vocalSplitterRunning}
                        style={{ width: 44, height: 44, flex: '0 0 44px', border: '1px solid rgba(255,255,255,0.12)', background: '#1d1f27', color: '#f5f7fb' }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2H19.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          <path d="M3.5 9h17" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="icon-btn player-media-role-button"
                        aria-label="Include subfolders (recursive)"
                        aria-pressed={vocalSplitterRecursive}
                        title={`Include subfolders (recursive): ${vocalSplitterRecursive ? 'On' : 'Off'}`}
                        disabled={vocalSplitterRunning}
                        onClick={() => setVocalSplitterRecursive(current => !current)}
                        style={{
                          width: 44,
                          height: 44,
                          flex: '0 0 44px',
                          background: vocalSplitterRecursive ? 'linear-gradient(135deg, #a4e8d1, #69c2a6)' : '#171717',
                          color: vocalSplitterRecursive ? '#18251f' : 'rgba(245,247,251,0.78)',
                          border: `1px solid ${vocalSplitterRecursive ? 'rgba(190,245,220,0.62)' : 'rgba(255,255,255,0.12)'}`,
                          boxShadow: vocalSplitterRecursive ? '0 8px 22px rgba(84,185,158,0.24)' : 'none'
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2H19.5A1.5 1.5 0 0 1 21 8.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          <path d="M3.5 10H15M8 10v4m0 0H5.5A1.5 1.5 0 0 0 4 15.5v2A1.5 1.5 0 0 0 5.5 19H8m0-5h2.5a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H8m0-5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={vocalSplitterRunning ? 'Splitting...' : 'Split'}
                        title={vocalSplitterRunning ? 'Splitting...' : 'Split audio'}
                        onClick={() => void splitVocalFolder()}
                        disabled={vocalSplitterRunning}
                        style={{ width: 44, height: 44, flex: '0 0 44px', border: 'none', background: 'linear-gradient(135deg, #8dd9c1, #64b99f)', color: '#10221c' }}
                      >
                        {vocalSplitterRunning ? (
                          <span className="tag-editor-info-search-spinner" aria-hidden="true" />
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="6" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.8" />
                            <circle cx="6" cy="18" r="2.25" stroke="currentColor" strokeWidth="1.8" />
                            <path d="m8 7.5 12 9M8 16.5l4.8-3.6M14.4 9.6 20 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <p style={{ margin: '0 0 14px', color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>
                      {mediaLibraryPath.trim()
                        ? `Output: ${['Music_Accompaniments', 'Video_Accompaniments', 'Music_Vocals', 'Video_Vocals'].map(folder => `${mediaLibraryPath.trim().replace(/[\\/]+$/, '')}\\${folder}`).join(', ')}`
                        : 'Set the media library location in Settings to choose the output root.'}
                    </p>
                    {vocalSplitterError && (
                      <p role="alert" style={{ margin: '14px 0 0', color: '#ff9b9b' }}>{vocalSplitterError}</p>
                    )}
                    {vocalSplitterStatus && (
                      <p role="status" aria-live="polite" style={{ margin: '14px 0 0', color: 'rgba(245,247,251,0.78)' }}>
                        {vocalSplitterStatus}
                      </p>
                    )}
                    {vocalSplitterFailures.length > 0 && (
                      <ul aria-label="Vocal Splitter failures" style={{ marginTop: 10, color: '#ffb2b2' }}>
                        {vocalSplitterFailures.map((failure, index) => <li key={`${index}:${failure}`}>{failure}</li>)}
                      </ul>
                    )}
                  </>
                ) : selectedTool === 'Media Downloader' ? (
                  <VideoDownloader
                    showThumbnail={showCover}
                    mediaLibraryPath={mediaLibraryPath}
                    onLog={entry => setLogs(current => [...current, entry])}
                  />
                ) : selectedTool === 'Karaoke Creator' ? (
                  <KaraokeCreator
                    mediaLibraryPath={mediaLibraryPath}
                    initialMediaPath={currentKaraokeMediaPath}
                    initialLyrics={lyricsRaw || ''}
                    onComplete={subtitlePath => {
                      setMediaLibraryFiles(files => Array.from(new Set([...files, subtitlePath])));
                      setMediaLibraryRefreshKey(key => key + 1);
                      setLogs(current => [...current, `Karaoke subtitle created: ${subtitlePath}`]);
                    }}
                    onStemsCreated={stemPaths => {
                      setMediaLibraryFiles(files => Array.from(new Set([...files, ...stemPaths])));
                      setMediaLibraryRefreshKey(key => key + 1);
                      setLogs(current => [...current, `Karaoke A/O stems created: ${stemPaths.join(', ')}`]);
                    }}
                  />
                ) : selectedTool === 'Karaoke Aligner' ? (
                  <KaraokeAligner
                    mediaLibraryPath={mediaLibraryPath}
                    initialVideoPath={currentTrack && isVideoTrack(currentTrack) ? getTrackFilePath(currentTrack) || '' : ''}
                    onSubtitleSaved={subtitlePath => {
                      setMediaLibraryFiles(files => Array.from(new Set([...files, subtitlePath])));
                      setMediaLibraryRefreshKey(key => key + 1);
                      setLogs(current => [...current, `Karaoke subtitle saved: ${subtitlePath}`]);
                    }}
                  />
                ) : selectedTool ? (
                  <>
                    <h1 style={{ margin: '0 0 12px', color: '#f5f7fb', fontSize: '1.4rem' }}>{selectedTool}</h1>
                    <p role="status" style={{ margin: 0, color: 'rgba(245,247,251,0.62)' }}>This tool is not implemented yet.</p>
                  </>
                ) : (
                  <>
                    <h1 style={{ margin: '0 0 12px', color: '#f5f7fb', fontSize: '1.4rem' }}>Tools</h1>
                    <p style={{ margin: 0, color: 'rgba(245,247,251,0.62)' }}>Select a tool from the list.</p>
                  </>
                )}
                </Suspense>
              </section>
            )}
          </>
        )}
      </main>

      <LyricsDialog
        visible={lyricsVisible}
        lyricsRaw={lyricsRaw}
        lyricsTimed={lyricsTimed}
        mode={lyricsMode}
        activeIndex={lyricsIndex}
        containerRef={lyricsContainerRef}
        onModeChange={setLyricsMode}
        onSeek={seekAndPlay}
        onClose={() => {
          setLyricsVisible(false);
          setLyricsRaw(null);
          setLyricsTimed(null);
        }}
      />
      {tooltip && (
        <div
          className={`mint-tooltip${tooltip.below ? ' mint-tooltip-below' : ''}`}
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
