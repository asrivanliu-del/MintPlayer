import type {
  ElectronOnlineLyricsResult,
  ElectronOnlineMetadataResult,
  ElectronTagDraft,
  ElectronTimedLyric
} from '../electron/electronApi';

export type Track = {
  id: string;
  name: string;
  path?: string;
  src?: string;
  backingSrc?: string;
  backingMime?: string;
  file?: File;
  cover?: string;
  bitrate?: number;
  resolution?: string;
  backingActive?: boolean;
  _originalSrc?: string;
};

export type Playlist = { name: string; tracks: Track[] };

export type PlaybackDiagnostics = {
  waitingEvents: number;
  stalledEvents: number;
  totalBufferingMs: number;
  maxBufferingMs: number;
  lastBufferingMs: number;
  progressGaps: number;
  maxProgressGapMs: number;
  lastProgressGapMs: number;
  decodeCount: number;
  decodeCacheHits: number;
  lastDecodeMs: number | null;
  lastDecodeReadMs: number | null;
  lastDecodeProcessingMs: number | null;
  lastDecodeBytes: number | null;
  lastDecodeSource: string | null;
  lastDecodeTrack: string | null;
  lastDecodeError: string | null;
};

export type TagEditorDraft = ElectronTagDraft;
export type OnlineLyricsResult = ElectronOnlineLyricsResult;
export type OnlineMetadataResult = ElectronOnlineMetadataResult;

export type TrackPathHints = {
  title: string;
  artist: string;
  album: string;
  year: string;
  track: string;
};

export type PitchProcessor = {
  tempo: number;
  rate: number;
  pitchSemitones: number;
  _soundtouch?: {
    stretch?: {
      setParameters: (sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number) => void;
    };
  };
};

export type TimedLyric = ElectronTimedLyric;

export type PlaybackResumePosition = {
  playlistName: string;
  trackId: string;
  trackPath?: string;
  trackName: string;
  time: number;
  backingActive: boolean;
};
