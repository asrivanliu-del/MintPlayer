import { describe, expect, it, vi } from 'vitest';
import type { ElectronApiBridge } from '../../src/electron/electronApi';
import {
  decodeBase64Blob,
  decodeBase64Bytes,
  getTrackMediaSource,
  localFileUrl,
  musicFileUrl,
  prepareTrackSource,
  resolveBackingTrackCandidates
} from '../../src/renderer/playback/mediaSource';
import type { Track } from '../../src/renderer/types';

const track: Track = {
  id: 'song',
  name: 'Song.mp3',
  path: 'C:\\music\\Song.mp3'
};

describe('media source helpers', () => {
  it('creates consistent encoded media URLs and decodes base64 data', async () => {
    expect(musicFileUrl('C:\\music\\Song.mp3')).toBe('music://local/C%3A%5Cmusic%5CSong.mp3');
    expect(localFileUrl('C:\\music\\Song.mp3')).toBe('file:///C:/music/Song.mp3');
    expect(getTrackMediaSource(track, true)).toBe(musicFileUrl(track.path!));
    expect(getTrackMediaSource(track, false)).toBe(localFileUrl(track.path!));
    expect(getTrackMediaSource({ ...track, src: 'blob:source' }, true)).toBe('blob:source');
    expect(decodeBase64Bytes('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(Array.from(new Uint8Array(await decodeBase64Blob('AQID', 'audio/mpeg').arrayBuffer())))
      .toEqual([1, 2, 3]);
    expect(decodeBase64Blob('AQID', 'audio/mpeg').type).toBe('audio/mpeg');
  });

  it('builds Windows and POSIX backing track candidates', () => {
    expect(resolveBackingTrackCandidates('C:\\music\\Song.mp3')).toEqual([
      'C:/music/Song_backingtrack.mp3',
      'C:/music/Song_backingtrack.wav'
    ]);
    expect(resolveBackingTrackCandidates('/music/Song.mp3')).toEqual([
      '/music/Song_backingtrack.mp3',
      '/music/Song_backingtrack.wav'
    ]);
  });

  it('checks the media library Accompaniments folder before legacy adjacent files', () => {
    expect(resolveBackingTrackCandidates(
      'C:\\Media\\Music\\Singer\\Song.mp3',
      'C:\\Media'
    )).toEqual([
      'C:/Media/Music_Accompaniments/Singer/Song.wav',
      'C:/Media/Music_Accompaniments/Singer/Song_backingtrack.wav',
      'C:/Media/Music_Accompaniments/Singer/Song_backingtrack.mp3',
      'C:/Media/Accompaniments/Music/Singer/Song_backingtrack.wav',
      'C:/Media/Accompaniments/Music/Singer/Song_backingtrack.mp3',
      'C:/Media/Music/Singer/Song_backingtrack.mp3',
      'C:/Media/Music/Singer/Song_backingtrack.wav'
    ]);
  });

  it('loads a cached backing source after checking the matching path', async () => {
    const libraryTrack = { ...track, path: 'C:\\Media\\Music\\Singer\\Song.mp3' };
    const stat = vi.fn().mockResolvedValue({ ok: true, isFile: true });
    const readFile = vi.fn().mockResolvedValue({ ok: true, data: 'AQID', mime: 'audio/mpeg' });
    const createMediaObjectUrl = vi.fn().mockReturnValue('blob:backing');
    const updateTrack = vi.fn();
    const result = await prepareTrackSource({
      track: libraryTrack,
      useBackingTrack: true,
      backingOutputRoot: 'C:\\Media',
      api: { stat, readFile },
      isStale: () => false,
      readRequestIdRef: { current: {} },
      createMediaObjectUrl,
      updateTrackSource: vi.fn(),
      updateTrack,
      log: vi.fn(),
      appendLog: vi.fn()
    });

    expect(stat).toHaveBeenCalledWith('C:/Media/Music_Accompaniments/Singer/Song.wav');
    expect(readFile).toHaveBeenCalledWith('C:/Media/Music_Accompaniments/Singer/Song.wav');
    expect(createMediaObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(updateTrack).toHaveBeenCalledWith('song', {
      backingSrc: 'blob:backing',
      backingMime: 'audio/wav',
      backingActive: true
    });
    expect(result).toEqual({ status: 'ready', src: 'blob:backing', backingMime: 'audio/wav' });
  });

  it('stops source preparation when an asynchronous request becomes stale', async () => {
    let stale = false;
    const readFile = vi.fn().mockImplementation(async () => {
      stale = true;
      return { ok: true, data: 'AQID', mime: 'audio/mpeg' };
    });
    const api: ElectronApiBridge = { readFile };
    const result = await prepareTrackSource({
      track: { ...track, src: 'file:///C:/music/Song.mp3' },
      useBackingTrack: false,
      api,
      isStale: () => stale,
      readRequestIdRef: { current: {} },
      createMediaObjectUrl: vi.fn().mockImplementation(() => {
        stale = true;
        return 'blob:unused';
      }),
      updateTrackSource: vi.fn(),
      updateTrack: vi.fn(),
      log: vi.fn(),
      appendLog: vi.fn()
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('reports an actionable failure when backing track access is unavailable', async () => {
    const result = await prepareTrackSource({
      track,
      useBackingTrack: true,
      api: {},
      isStale: () => false,
      readRequestIdRef: { current: {} },
      createMediaObjectUrl: vi.fn(),
      updateTrackSource: vi.fn(),
      updateTrack: vi.fn(),
      log: vi.fn(),
      appendLog: vi.fn()
    });

    expect(result).toEqual({
      status: 'failed',
      message: 'Cannot locate backing track for Song.mp3: source path or file access is unavailable'
    });
  });
});
