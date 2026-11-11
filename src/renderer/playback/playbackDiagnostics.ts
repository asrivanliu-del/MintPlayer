import type { PlaybackDiagnostics } from '../types';

export function createInitialPlaybackDiagnostics(): PlaybackDiagnostics {
  return {
    waitingEvents: 0,
    stalledEvents: 0,
    totalBufferingMs: 0,
    maxBufferingMs: 0,
    lastBufferingMs: 0,
    progressGaps: 0,
    maxProgressGapMs: 0,
    lastProgressGapMs: 0,
    decodeCount: 0,
    decodeCacheHits: 0,
    lastDecodeMs: null,
    lastDecodeReadMs: null,
    lastDecodeProcessingMs: null,
    lastDecodeBytes: null,
    lastDecodeSource: null,
    lastDecodeTrack: null,
    lastDecodeError: null
  };
}
