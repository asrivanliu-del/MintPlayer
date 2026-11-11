import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Track } from '../types';
import {
  getLyricsModeAfterTrackLoad,
  getMediaFrontAfterTrackChange
} from '../playlist/playlistSelection';
import { prepareTrackSource } from './mediaSource';
import { executeTrackPlayback } from './executeTrackPlayback';

export type PlaybackRequestOptions = {
  startTime?: number;
  backingActive?: boolean;
  shouldPlay?: boolean;
};

export type PlaybackControllerDependencies = {
  tracks: Track[];
  backingOutputRoot?: string;
  setPlaybackError: Dispatch<SetStateAction<string | null>>;
  currentTrackIdRef: MutableRefObject<string | null>;
  clearPitchShiftBufferCache: () => void;
  playbackRequestRef: MutableRefObject<number>;
  shifterRef: MutableRefObject<any>;
  pitchShifterTrackIdRef: MutableRefObject<string | null>;
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  lyricsLoadRequestRef: MutableRefObject<number>;
  setCurrent: Dispatch<SetStateAction<number | null>>;
  mediaFront: 'lyrics' | 'cover';
  setMediaFront: Dispatch<SetStateAction<'lyrics' | 'cover'>>;
  isVideoTrack: (track: Track | null | undefined) => boolean;
  mediaForTrack: (track: Track | null | undefined) => HTMLMediaElement | null;
  activeMediaRef: MutableRefObject<HTMLMediaElement | null>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setLyricsRaw: Dispatch<SetStateAction<string | null>>;
  setLyricsTimed: Dispatch<SetStateAction<Array<{ time: number; text: string }> | null>>;
  setLyricsIndex: Dispatch<SetStateAction<number>>;
  getLyricsForTrack: (track: Track, requestId?: number) => Promise<boolean>;
  setLyricsMode: Dispatch<SetStateAction<'static' | 'synchronized'>>;
  attachLyricsTimeListener: () => void;
  setSeekTime: Dispatch<SetStateAction<number>>;
  updatePlaybackStarting: (starting: boolean) => void;
  readRequestIdRef: MutableRefObject<Record<string, number>>;
  createMediaObjectUrl: (blob: Blob) => string | null;
  updateTrackSourceReferences: (trackId: string, src: string, file?: File) => void;
  setTracks: Dispatch<SetStateAction<Track[]>>;
  appendElectronLog: (message: string) => void;
  reportPlaybackFailure: (message: string) => void;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  ensureAudioGraph: () => void;
  getAudioContextConstructor: () => typeof AudioContext | undefined;
  volume: number;
  setLogs: Dispatch<SetStateAction<string[]>>;
  transposeRef: MutableRefObject<number>;
  getPitchShiftBuffer: (src: string, track: Track, audioContext: AudioContext) => Promise<AudioBuffer>;
  autoNextRef: MutableRefObject<boolean>;
  nextTrack: () => boolean;
  duration: number;
  setDuration: Dispatch<SetStateAction<number>>;
  seekingRef: MutableRefObject<boolean>;
  gainRef: MutableRefObject<any>;
  pannerRef: MutableRefObject<any>;
  videoSourceRef: MutableRefObject<MediaElementAudioSourceNode | null>;
  videoPitchNodeRef: MutableRefObject<ScriptProcessorNode | null>;
  videoSoundTouchRef: MutableRefObject<any>;
  videoTransposeRef: MutableRefObject<number>;
  previousVideoTransposeRef: MutableRefObject<number>;
  resetVideoPitchBuffers: () => void;
  scheduleMediaObjectUrlCleanup: () => void;
};

export async function playTrack(
  dependencies: PlaybackControllerDependencies,
  i: number,
  options: PlaybackRequestOptions = {}
) {
  const {
    tracks,
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
    setLogs,
    reportPlaybackFailure,
    ensureAudioGraph
  } = dependencies;
  const t = tracks[i];
  if (!t) return;
  ensureAudioGraph();
  const audioContext = dependencies.audioCtxRef.current;
  let audioContextResume: Promise<void> | null = null;
  let audioContextResumeError: unknown;
  if ((options.shouldPlay ?? true) && audioContext?.state === 'suspended') {
    try {
      audioContextResume = audioContext.resume().catch(error => {
        audioContextResumeError = error;
      });
    } catch (error) {
      audioContextResumeError = error;
    }
  }

  setPlaybackError(null);
  if (currentTrackIdRef.current !== t.id) clearPitchShiftBufferCache();
  currentTrackIdRef.current = t.id;
  const playbackRequest = ++playbackRequestRef.current;
  const isStalePlaybackRequest = () => playbackRequest !== playbackRequestRef.current;
  if (shifterRef.current) {
    try { shifterRef.current.disconnect(); } catch (error) {
      console.warn('Previous pitch shifter stop failed', error);
    }
    shifterRef.current = null;
  }
  pitchShifterTrackIdRef.current = null;
  try { audioRef.current?.pause(); } catch (error) {
    console.warn('Previous audio stop failed', error);
  }
  try { videoRef.current?.pause(); } catch (error) {
    console.warn('Previous video stop failed', error);
  }
  const lyricsRequestId = ++lyricsLoadRequestRef.current;
  setCurrent(i);
  const nextMediaFront = getMediaFrontAfterTrackChange(mediaFront, isVideoTrack(t));
  if (nextMediaFront !== mediaFront) setMediaFront(nextMediaFront);
  activeMediaRef.current = mediaForTrack(t);
  setIsPlaying(false);
  setLyricsRaw(null);
  setLyricsTimed(null);
  setLyricsIndex(0);
  if (!isVideoTrack(t)) {
    void getLyricsForTrack(t, lyricsRequestId).then(found => {
      if (lyricsRequestId !== lyricsLoadRequestRef.current) return;
      setLyricsMode(currentMode => getLyricsModeAfterTrackLoad(currentMode, found));
      if (shifterRef.current) attachLyricsTimeListener();
    });
  }
  if (!isVideoTrack(t) && videoRef.current) {
    try {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    } catch(e) { console.warn('video release failed', e); }
  }
  const requestedStartTime = options.startTime ?? 0;
  const startTime = Number.isFinite(requestedStartTime) ? Math.max(0, requestedStartTime) : 0;
  setSeekTime(startTime);
  const shouldPlay = options.shouldPlay ?? true;
  updatePlaybackStarting(shouldPlay);
  const useBackingTrack = !isVideoTrack(t) && (options.backingActive ?? t.backingActive ?? false);
  const api = window.electronAPI;
  const sourceResult = await prepareTrackSource({
    track: t,
    useBackingTrack,
    backingOutputRoot: dependencies.backingOutputRoot,
    api,
    isStale: isStalePlaybackRequest,
    readRequestIdRef,
    createMediaObjectUrl,
    updateTrackSource: updateTrackSourceReferences,
    updateTrack: (trackId, update) => {
      setTracks(previousTracks => previousTracks.map(track => track.id === trackId
        ? { ...track, ...update }
        : track));
    },
    log: message => setLogs(logs => [...logs, message]),
    appendLog: appendElectronLog
  });
  if (sourceResult.status === 'cancelled') return;
  if (sourceResult.status === 'failed') {
    updatePlaybackStarting(false);
    if (useBackingTrack) {
      setLogs(logs => [...logs, sourceResult.message]);
      alert(sourceResult.message);
    } else {
      reportPlaybackFailure(sourceResult.message);
    }
    return;
  }

  const { src, backingMime } = sourceResult;
  if (options.backingActive !== undefined) {
    setTracks(previousTracks => previousTracks.map((item, index) => index === i
      ? { ...item, backingActive: options.backingActive }
      : item));
  }

  if (src.startsWith('file://') && !api) {
    updatePlaybackStarting(false);
    reportPlaybackFailure(`Cannot play ${t.name} from a local path in the browser. Add the file through the file picker or run the Electron app.`);
    return;
  }

  console.log('Attempting play', { index: i, track: t, src });
  appendElectronLog(`Attempting play index=${i} name=${t.name}`);
  if (src.startsWith('file://') && !window.electronAPI) {
    // In browser contexts file:// is not allowed for security reasons.
    updatePlaybackStarting(false);
    reportPlaybackFailure(`Cannot play ${t.name} from a local path in the browser. Add the file through the file picker or run the Electron app.`);
    return;
  }

  if (audioContextResume) await audioContextResume;
  if (audioContextResumeError || (audioContext && audioContext.state !== 'running')) {
    updatePlaybackStarting(false);
    reportPlaybackFailure(`Audio output could not be started because the audio context did not resume: ${String(audioContextResumeError || audioContext?.state)}`);
    return;
  }

  await executeTrackPlayback(dependencies, {
    track: t,
    index: i,
    src,
    backingMime,
    startTime,
    shouldPlay,
    useBackingTrack,
    isStalePlaybackRequest
  });
}
