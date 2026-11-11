import { describe, expect, it } from 'vitest';
import { parseStoredPlaylists } from '../../src/electron/playlistStorage';

describe('parseStoredPlaylists', () => {
  it('parses valid saved playlists', () => {
    expect(parseStoredPlaylists(JSON.stringify([
      { name: 'Practice', tracks: [{ id: 'song-1', name: 'Song.mp3' }] }
    ]))).toEqual([
      { name: 'Practice', tracks: [{ id: 'song-1', name: 'Song.mp3' }] }
    ]);
  });

  it('returns an empty list for empty storage', () => {
    expect(parseStoredPlaylists('')).toEqual([]);
  });

  it('rejects invalid data rather than treating it as an empty playlist store', () => {
    expect(() => parseStoredPlaylists('{invalid')).toThrow();
    expect(() => parseStoredPlaylists(JSON.stringify({ name: 'Practice', tracks: [] })))
      .toThrow('Stored playlists must be an array of playlists with names and track lists.');
    expect(() => parseStoredPlaylists(JSON.stringify([{ name: 'Practice', tracks: null }])))
      .toThrow('Stored playlists must be an array of playlists with names and track lists.');
  });
});
