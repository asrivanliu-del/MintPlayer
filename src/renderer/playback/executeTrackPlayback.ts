import type { Track } from '../types';
import type { PlaybackControllerDependencies } from './playTrack';
import { playAudioTrack } from './audioTrackPlayback';
import { playVideoTrack } from './videoTrackPlayback';

export type TrackPlaybackExecution = {
  track: Track;
  index: number;
  src: string;
  backingMime?: string;
  startTime: number;
  shouldPlay: boolean;
  useBackingTrack: boolean;
  isStalePlaybackRequest: () => boolean;
};

export async function executeTrackPlayback(
  dependencies: PlaybackControllerDependencies,
  execution: TrackPlaybackExecution
) {
  const { track: t } = execution;
  const {
    isVideoTrack,
    audioCtxRef,
    getAudioContextConstructor,
    volume,
    setLogs,
    gainRef,
    pannerRef
  } = dependencies;
  // Ensure AudioContext and nodes exist
  try {
    if (!audioCtxRef.current) {
      const C = getAudioContextConstructor();
      if (!C) throw new Error('AudioContext is unavailable.');
      const ctx = new C();
      audioCtxRef.current = ctx;
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      pannerRef.current = panner;
      const gain = ctx.createGain();
      gainRef.current = gain;
      if (panner) { panner.connect(gain); }
      gain.connect(ctx.destination);
      try { gain.gain.value = volume; }
      catch (error) {
        console.warn(`Unable to apply initial audio gain for ${t.name}`, error);
        setLogs(logs => [...logs, `Unable to apply initial audio gain for ${t.name}: ${String(error)}`]);
      }
    }
  } catch(e) {
    console.warn('AudioContext init failed', e);
    setLogs(logs => [...logs, `Audio effects unavailable for ${t.name}; continuing with native audio playback: ${String(e)}`]);
  }

  if (isVideoTrack(t)) {
    await playVideoTrack(dependencies, execution);
    return;
  }
  await playAudioTrack(dependencies, execution);
}
