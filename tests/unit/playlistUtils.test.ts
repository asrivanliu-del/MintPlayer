import { describe, expect, it } from 'vitest';
import {
  countMetadataMatches,
  getTrackFilePath,
  normalizeSearchText,
  parseTrackPathHints,
  serializePlaylistTracks,
  titleMatchScore
} from '../../src/renderer/playlist/playlistUtils';

describe('normalizeSearchText', () => {
  it('normalizes case and punctuation while preserving Chinese characters', () => {
    expect(normalizeSearchText('  SUN YAN-ZI！超快感  ')).toBe('sun yan zi 超快感');
  });
});

describe('getTrackFilePath', () => {
  it('uses the path stored in an imported track id when its path field is missing', () => {
    expect(getTrackFilePath({
      id: 'path:C:\\Music\\Track.mp3',
      src: 'music://local/C%3A%5CMusic%5CTrack.mp3'
    })).toBe('C:\\Music\\Track.mp3');
  });

  it('recovers the original path from music and file URLs', () => {
    expect(getTrackFilePath({
      id: 'legacy-track',
      src: 'music://local/C%3A%5CMusic%5CTrack%20One.mp3'
    })).toBe('C:\\Music\\Track One.mp3');
    expect(getTrackFilePath({
      id: 'legacy-track',
      src: 'file:///C:/Music/Track%20One.mp3'
    })).toBe('C:/Music/Track One.mp3');
  });

  it('prefers the explicit path and rejects non-local sources', () => {
    expect(getTrackFilePath({
      id: 'path:C:\\Music\\id-path.mp3',
      path: 'C:\\Music\\explicit-path.mp3'
    })).toBe('C:\\Music\\explicit-path.mp3');
    expect(getTrackFilePath({ id: 'remote-track', src: 'https://example.com/track.mp3' }))
      .toBeUndefined();
  });
});

describe('titleMatchScore', () => {
  it('prioritizes exact titles over whole-word partial matches', () => {
    expect(titleMatchScore('超快感', '超快感')).toBe(2);
    expect(titleMatchScore('孫燕姿 - 超快感', '超快感')).toBe(1);
  });

  it('does not count an incomplete word or an empty title as a match', () => {
    expect(titleMatchScore('Superstar', 'star')).toBe(0);
    expect(titleMatchScore('', '超快感')).toBe(0);
    expect(titleMatchScore('超快感', '')).toBe(0);
  });
});

describe('countMetadataMatches', () => {
  it('counts exact title, artist, and album matches', () => {
    expect(countMetadataMatches({
      trackName: '超快感',
      artistName: '孫燕姿',
      albumName: '孫燕姿'
    }, {
      title: '超快感',
      artist: '孫燕姿',
      album: '孫燕姿'
    })).toBe(3);
  });

  it('allows partial title and album matches but requires an exact artist', () => {
    expect(countMetadataMatches({
      trackName: '超快感 (Remastered)',
      artistName: '孫燕姿 featuring Guest',
      albumName: '2000 孫燕姿'
    }, {
      title: '超快感',
      artist: '孫燕姿',
      album: '孫燕姿'
    })).toBe(2);
  });
});

describe('parseTrackPathHints', () => {
  it('extracts track, title, artist, album, and year from a Windows music path', () => {
    expect(parseTrackPathHints('C:\\Ivan\\MP3\\孫燕姿\\2000 孫燕姿\\01 超快感.mp3')).toEqual({
      title: '超快感',
      artist: '孫燕姿',
      album: '孫燕姿',
      year: '2000',
      track: '01'
    });
  });

  it('supports slash-separated paths and filenames without track numbers', () => {
    expect(parseTrackPathHints('/music/Artist/Album/Track Name.flac')).toEqual({
      title: 'Track Name',
      artist: 'Artist',
      album: 'Album',
      year: '',
      track: ''
    });
  });

  it('returns empty hints for missing or incomplete paths', () => {
    const emptyHints = { title: '', artist: '', album: '', year: '', track: '' };
    expect(parseTrackPathHints()).toEqual(emptyHints);
    expect(parseTrackPathHints('C:\\Music\\Track.mp3')).toEqual(emptyHints);
  });
});

describe('serializePlaylistTracks', () => {
  it('keeps playlist fields and omits playback-only properties', () => {
    expect(serializePlaylistTracks([{
      id: 'track-1',
      name: '超快感',
      path: 'C:\\Music\\01 超快感.mp3',
      src: 'music://local/track-1',
      cover: 'cover.jpg',
      bitrate: 320,
      resolution: '1920x1080',
      backingSrc: 'backing.mp3',
      backingMime: 'audio/mpeg',
      backingActive: true
    }])).toEqual([{
      id: 'track-1',
      name: '超快感',
      path: 'C:\\Music\\01 超快感.mp3',
      src: 'music://local/track-1',
      cover: 'cover.jpg',
      bitrate: 320,
      resolution: '1920x1080'
    }]);
  });
});
