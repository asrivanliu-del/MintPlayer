import { describe, expect, it } from 'vitest';
import {
  filterMediaLibrarySongs,
  getMediaLibraryRoleFromFilePath,
  getMediaLibraryRolePath,
  getMediaLibrarySongPath,
  getMediaLibrarySongPlaybackPath,
  getVideoResolutionLabel,
  groupMediaLibraryFiles
} from '../../src/renderer/playlist/mediaLibraryUtils';

describe('media library grouping', () => {
  it('formats video resolution labels like the playlist', () => {
    expect(getVideoResolutionLabel(1920, 1080)).toBe('1080p');
    expect(getVideoResolutionLabel(3840, 2160)).toBe('4K');
    expect(getVideoResolutionLabel(7680, 4320)).toBe('8K');
    expect(getVideoResolutionLabel(640, 360)).toBe('360p');
  });

  it('identifies the role of a playlist media path when it is not in the library scan', () => {
    expect(getMediaLibraryRoleFromFilePath('C:\\playlist\\Song.mp3')).toBe('music');
    expect(getMediaLibraryRoleFromFilePath('C:\\playlist\\Song.mp4')).toBe('video');
    expect(getMediaLibraryRoleFromFilePath('C:\\source\\karaoke\\Singer\\Album\\Song.ass')).toBe('karaoke');
    expect(getMediaLibraryRoleFromFilePath('C:\\playlist\\Song_backingtrack.wav')).toBe('accompaniments');
    expect(getMediaLibraryRoleFromFilePath('C:\\playlist\\vocals\\Song.wav')).toBe('vocals');
    expect(getMediaLibraryRoleFromFilePath('C:\\playlist\\Song.txt')).toBeUndefined();
  });

  it('groups matching music, video, karaoke, accompaniments, and vocals by their relative song path', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\music\\singer\\album\\01.abc.mp3',
      'C:\\source\\video\\singer\\album\\01.abc.mp4',
      'C:\\source\\karaoke\\singer\\album\\01.abc.ass',
      'C:\\source\\karaoke\\singer\\album\\01.abc_backingtrack.mp3',
      'C:\\source\\karaoke\\singer\\album\\01.abc_vocals.wav'
    ], 'C:\\source');

    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      name: '01.abc',
      relativeLocation: 'singer\\album',
      files: {
        music: ['C:\\source\\music\\singer\\album\\01.abc.mp3'],
        video: ['C:\\source\\video\\singer\\album\\01.abc.mp4'],
        karaoke: ['C:\\source\\karaoke\\singer\\album\\01.abc.ass'],
        accompaniments: ['C:\\source\\karaoke\\singer\\album\\01.abc_backingtrack.mp3'],
        vocals: ['C:\\source\\karaoke\\singer\\album\\01.abc_vocals.wav']
      }
    });
    expect(getMediaLibrarySongPath(songs[0])).toBe('C:\\source\\music\\singer\\album\\01.abc.mp3');
    expect(getMediaLibrarySongPlaybackPath(songs[0])).toBe('C:\\source\\music\\singer\\album\\01.abc.mp3');
  });

  it('groups stems saved under top-level Vocals and Accompaniments folders with their source song', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\Media\\Music\\Singer\\Album\\Song.mp3',
      'C:\\Media\\Vocals\\Singer\\Album\\Song.wav',
      'C:\\Media\\Accompaniments\\Singer\\Album\\Song.wav'
    ], 'C:\\Media');

    expect(songs).toHaveLength(1);
    expect(songs[0].files).toEqual({
      music: ['C:\\Media\\Music\\Singer\\Album\\Song.mp3'],
      vocals: ['C:\\Media\\Vocals\\Singer\\Album\\Song.wav'],
      accompaniments: ['C:\\Media\\Accompaniments\\Singer\\Album\\Song.wav']
    });
    expect(songs[0].relativeLocation).toBe('Singer\\Album');
  });

  it('plays the first supported media in M/V/K/A/O order and skips lyric files', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\video\\singer\\album\\Video first.mp4',
      'C:\\source\\karaoke\\singer\\album\\Video first.ass',
      'C:\\source\\music\\singer\\album\\Video first.mp3',
      'C:\\source\\karaoke\\singer\\album\\Accompaniment only.ass',
      'C:\\source\\karaoke\\singer\\album\\Accompaniment only_backingtrack.mp3',
      'C:\\source\\karaoke\\singer\\album\\Lyrics only.ass'
    ], 'C:\\source');

    expect(getMediaLibrarySongPlaybackPath(songs.find(song => song.name === 'Video first')!))
      .toBe('C:\\source\\music\\singer\\album\\Video first.mp3');
    expect(getMediaLibrarySongPlaybackPath(songs.find(song => song.name === 'Accompaniment only')!))
      .toBe('C:\\source\\karaoke\\singer\\album\\Accompaniment only_backingtrack.mp3');
    expect(getMediaLibrarySongPlaybackPath(songs.find(song => song.name === 'Lyrics only')!)).toBeUndefined();
  });

  it('prefers video over accompaniment when music is unavailable', () => {
    const [song] = groupMediaLibraryFiles([
      'C:\\source\\video\\singer\\album\\Song.mp4',
      'C:\\source\\karaoke\\singer\\album\\Song_backingtrack.wav'
    ], 'C:\\source');

    expect(getMediaLibrarySongPlaybackPath(song))
      .toBe('C:\\source\\video\\singer\\album\\Song.mp4');
  });

  it('resolves playable music, video, accompaniment, and vocal files but not subtitles as media', () => {
    const [song] = groupMediaLibraryFiles([
      'C:\\source\\music\\singer\\album\\Song.mp3',
      'C:\\source\\video\\singer\\album\\Song.mp4',
      'C:\\source\\karaoke\\singer\\album\\Song.ass',
      'C:\\source\\karaoke\\singer\\album\\Song_backingtrack.wav',
      'C:\\source\\karaoke\\singer\\album\\Song_vocals.wav'
    ], 'C:\\source');

    expect(getMediaLibraryRolePath(song, 'music')).toBe('C:\\source\\music\\singer\\album\\Song.mp3');
    expect(getMediaLibraryRolePath(song, 'video')).toBe('C:\\source\\video\\singer\\album\\Song.mp4');
    expect(getMediaLibraryRolePath(song, 'karaoke')).toBeUndefined();
    expect(getMediaLibraryRolePath(song, 'accompaniments')).toBe('C:\\source\\karaoke\\singer\\album\\Song_backingtrack.wav');
    expect(getMediaLibraryRolePath(song, 'vocals')).toBe('C:\\source\\karaoke\\singer\\album\\Song_vocals.wav');
  });

  it('plays video when music is missing even if karaoke lyrics are available', () => {
    const [song] = groupMediaLibraryFiles([
      'C:\\source\\video\\singer\\album\\Song.mp4',
      'C:\\source\\karaoke\\singer\\album\\Song.ass'
    ], 'C:\\source');

    expect(getMediaLibrarySongPlaybackPath(song)).toBe('C:\\source\\video\\singer\\album\\Song.mp4');
  });

  it('does not merge same-named songs from different singer or album paths', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\music\\Singer One\\Album\\Song.mp3',
      'C:\\source\\music\\Singer Two\\Album\\Song.mp3',
      'C:\\source\\music\\Singer One\\Other Album\\Song.mp3'
    ], 'C:\\source');

    expect(songs).toHaveLength(3);
  });

  it('sorts songs by singer and album path, then by song name', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\music\\Singer Z\\Album\\01 Song.mp3',
      'C:\\source\\music\\Singer A\\Album\\Zulu.mp3',
      'C:\\source\\music\\Singer M\\Album\\Song.mp3',
      'C:\\source\\music\\Singer A\\Album\\Alpha.mp3'
    ], 'C:\\source');

    expect(songs.map(song => `${song.relativeLocation}\\${song.name}`)).toEqual([
      'Singer A\\Album\\Alpha',
      'Singer A\\Album\\Zulu',
      'Singer M\\Album\\Song',
      'Singer Z\\Album\\01 Song'
    ]);
  });

  it('filters grouped songs by music and video availability while keeping both-on as all', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\music\\Singer\\Album\\Song.mp3',
      'C:\\source\\video\\Singer\\Album\\Song.mp4',
      'C:\\source\\karaoke\\Singer\\Album\\Song.ass',
      'C:\\source\\music\\Singer\\Album\\Music only.mp3',
      'C:\\source\\video\\Singer\\Album\\Video only.mp4',
      'C:\\source\\karaoke\\Singer\\Album\\Karaoke only.ass'
    ], 'C:\\source');

    expect(filterMediaLibrarySongs(songs, '', true, true)).toHaveLength(4);
    expect(filterMediaLibrarySongs(songs, '', true, false).map(song => song.name))
      .toEqual(expect.arrayContaining(['Song', 'Music only']));
    expect(filterMediaLibrarySongs(songs, '', true, false)).toHaveLength(2);
    expect(filterMediaLibrarySongs(songs, '', false, true).map(song => song.name))
      .toEqual(expect.arrayContaining(['Song', 'Video only']));
    expect(filterMediaLibrarySongs(songs, '', false, true)).toHaveLength(2);
    expect(filterMediaLibrarySongs(songs, '', false, false)).toHaveLength(0);
  });

  it('filters karaoke, accompaniment, and vocal assets independently', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\karaoke\\Singer\\Album\\Karaoke only.ass',
      'C:\\source\\accompaniments\\Singer\\Album\\Accompaniment only.wav',
      'C:\\source\\vocals\\Singer\\Album\\Vocals only.wav'
    ], 'C:\\source');

    expect(filterMediaLibrarySongs(songs, '', false, false, { karaoke: true }).map(song => song.name))
      .toEqual(['Karaoke only']);
    expect(filterMediaLibrarySongs(songs, '', false, false, { accompaniments: true }).map(song => song.name))
      .toEqual(['Accompaniment only']);
    expect(filterMediaLibrarySongs(songs, '', false, false, { vocals: true }).map(song => song.name))
      .toEqual(['Vocals only']);
  });

  it('searches linked asset names but returns the one grouped song item', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\music\\Singer\\Album\\Song.mp3',
      'C:\\source\\karaoke\\Singer\\Album\\Song.ass',
      'C:\\source\\karaoke\\Singer\\Album\\Song_backingtrack.mp3'
    ], 'C:\\source');

    const results = filterMediaLibrarySongs(songs, 'song.ass', true, true);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Song');
  });

  it('groups accompaniment and vocal folders with the matching song', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\music\\Singer\\Album\\Song.mp3',
      'C:\\source\\karaoke\\Singer\\Album\\Song.ass',
      'C:\\source\\karaoke\\Singer\\Album\\accompaniments\\Song.wav',
      'C:\\source\\karaoke\\Singer\\Album\\vocals\\Song.wav'
    ], 'C:\\source');

    expect(songs).toHaveLength(1);
    expect(songs[0].files.accompaniments).toEqual([
      'C:\\source\\karaoke\\Singer\\Album\\accompaniments\\Song.wav'
    ]);
    expect(songs[0].files.vocals).toEqual([
      'C:\\source\\karaoke\\Singer\\Album\\vocals\\Song.wav'
    ]);
  });

  it('groups source-specific stem folders with the song and resolves each version independently', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\Music\\孫燕姿\\單曲\\飛瀑而下.mp3',
      'C:\\source\\Video\\孫燕姿\\單曲\\飛瀑而下.mp4',
      'C:\\source\\Music_Accompaniments\\孫燕姿\\單曲\\飛瀑而下.wav',
      'C:\\source\\Video_Accompaniments\\孫燕姿\\單曲\\飛瀑而下.wav',
      'C:\\source\\Music_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav',
      'C:\\source\\Video_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav'
    ], 'C:\\source');

    expect(songs).toHaveLength(1);
    expect(songs[0].sourceStems.music).toEqual({
      accompaniments: ['C:\\source\\Music_Accompaniments\\孫燕姿\\單曲\\飛瀑而下.wav'],
      vocals: ['C:\\source\\Music_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav']
    });
    expect(getMediaLibraryRolePath(songs[0], 'accompaniments', 'music'))
      .toBe('C:\\source\\Music_Accompaniments\\孫燕姿\\單曲\\飛瀑而下.wav');
    expect(getMediaLibraryRolePath(songs[0], 'accompaniments', 'video'))
      .toBe('C:\\source\\Video_Accompaniments\\孫燕姿\\單曲\\飛瀑而下.wav');
    expect(getMediaLibraryRolePath(songs[0], 'vocals', 'music'))
      .toBe('C:\\source\\Music_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav');
    expect(getMediaLibraryRolePath(songs[0], 'vocals', 'video'))
      .toBe('C:\\source\\Video_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav');
  });

  it('does not use an ambiguous legacy stem for both music and video versions', () => {
    const songs = groupMediaLibraryFiles([
      'C:\\source\\Music\\Singer\\Album\\Song.mp3',
      'C:\\source\\Video\\Singer\\Album\\Song.mp4',
      'C:\\source\\Accompaniments\\Singer\\Album\\Song.wav'
    ], 'C:\\source');

    expect(getMediaLibraryRolePath(songs[0], 'accompaniments', 'music')).toBeUndefined();
    expect(getMediaLibraryRolePath(songs[0], 'accompaniments', 'video')).toBeUndefined();
  });
});
