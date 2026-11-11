import { describe, expect, it } from 'vitest';
import {
  getKaraokeLyricsSearchHints,
  getMatchingMusicBasePath,
  parseLrc
} from '../../src/renderer/tools/karaokeLyrics';

describe('Karaoke Creator LRC helpers', () => {
  it('parses centisecond and millisecond timestamps, offsets, and multiple timestamps', () => {
    expect(parseLrc([
      '[ar:Artist]',
      '[offset:-500]',
      '[00:01.25][00:03.250]First line',
      '[00:04:500]Second line',
      '[00:99.00]invalid seconds',
      '[00:05.00]'
    ].join('\n'))).toEqual([
      { time: 0.75, text: 'First line' },
      { time: 2.75, text: 'First line' },
      { time: 4, text: 'Second line' }
    ]);
  });

  it('finds the corresponding Music track path for a library Video file', () => {
    expect(getMatchingMusicBasePath(
      'C:\\Media\\Video\\孫燕姿\\單曲\\飛瀑而下.mp4',
      'C:\\Media'
    )).toBe('C:\\Media\\Music\\孫燕姿\\單曲\\飛瀑而下');
  });

  it('uses Music sources directly for local LRC matching and search hints', () => {
    const musicPath = 'C:\\Media\\Music\\Artist\\Album\\Song.flac';
    expect(getMatchingMusicBasePath(musicPath, 'C:\\Media'))
      .toBe('C:\\Media\\Music\\Artist\\Album\\Song');
    expect(getKaraokeLyricsSearchHints(musicPath, 'C:\\Media'))
      .toEqual({ title: 'Song', artist: 'Artist', album: 'Album' });
  });

  it('derives online search hints from the video title and library folders', () => {
    expect(getKaraokeLyricsSearchHints(
      'C:\\Media\\Video\\孫燕姿\\單曲\\飛瀑而下.mp4',
      'C:\\Media'
    )).toEqual({ title: '飛瀑而下', artist: '孫燕姿', album: '單曲' });
  });
});
