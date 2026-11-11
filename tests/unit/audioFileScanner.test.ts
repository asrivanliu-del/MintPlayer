import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSeparatedStemOutputPaths,
  scanAudioFiles
} from '../../src/electron/audioFileScanner';

describe('scanAudioFiles', () => {
  let rootPath = '';

  beforeEach(() => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-audio-scan-'));
  });

  afterEach(() => {
    if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
    rootPath = '';
  });

  function createFile(relativePath: string) {
    const filePath = path.join(rootPath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
    return filePath;
  }

  it('scans supported audio and video files in the selected folder when recursion is off', () => {
    const mp3 = createFile('01.mp3');
    const flac = createFile('02.flac');
    const mp4 = createFile('03.mp4');
    createFile('04_backingtrack.wav');
    createFile('nested\\05.wav');

    expect(scanAudioFiles(rootPath, false)).toEqual([mp3, flac, mp4]);
  });

  it('includes nested audio but ignores generated stem folders when recursion is on', () => {
    const rootMp3 = createFile('01.mp3');
    const nestedWav = createFile('Album\\02.wav');
    createFile('Song_stems\\accompaniment.wav');
    createFile('Vocals\\Music\\01_vocals.wav');
    createFile('Accompaniments\\Music\\01_backingtrack.wav');
    createFile('Music_Vocals\\Singer\\Album\\01.wav');
    createFile('Video_Accompaniments\\Singer\\Album\\01.wav');

    expect(scanAudioFiles(rootPath, true)).toEqual([rootMp3, nestedWav]);
  });

  it('places both separated stems in the matching library-relative folders', () => {
    const sourcePath = createFile('Music\\Singer\\Album\\Song.flac');

    expect(getSeparatedStemOutputPaths(sourcePath, rootPath)).toEqual({
      vocalsPath: path.join(rootPath, 'Music_Vocals', 'Singer', 'Album', 'Song.wav'),
      accompanimentPath: path.join(rootPath, 'Music_Accompaniments', 'Singer', 'Album', 'Song.wav')
    });
  });

  it('places separated MP4 audio alongside the matching video artist and album', () => {
    const sourcePath = createFile('Video\\孫燕姿\\單曲\\飛瀑而下.mp4');

    expect(getSeparatedStemOutputPaths(sourcePath, rootPath)).toEqual({
      vocalsPath: path.join(rootPath, 'Video_Vocals', '孫燕姿', '單曲', '飛瀑而下.wav'),
      accompanimentPath: path.join(rootPath, 'Video_Accompaniments', '孫燕姿', '單曲', '飛瀑而下.wav')
    });
  });

  it('keeps same-title music and video stems in separate root folders', () => {
    const musicPath = createFile('Music\\孫燕姿\\單曲\\飛瀑而下.mp3');
    const videoPath = createFile('Video\\孫燕姿\\單曲\\飛瀑而下.mp4');

    expect(getSeparatedStemOutputPaths(musicPath, rootPath)).not.toEqual(
      getSeparatedStemOutputPaths(videoPath, rootPath)
    );
    expect(getSeparatedStemOutputPaths(musicPath, rootPath).accompanimentPath)
      .toContain(`${path.sep}Music_Accompaniments${path.sep}`);
    expect(getSeparatedStemOutputPaths(videoPath, rootPath).accompanimentPath)
      .toContain(`${path.sep}Video_Accompaniments${path.sep}`);
  });

  it('keeps the legacy output layout for sources outside Music and Video categories', () => {
    const sourcePath = createFile('Singer\\Album\\Song.wav');

    expect(getSeparatedStemOutputPaths(sourcePath, rootPath)).toEqual({
      vocalsPath: path.join(rootPath, 'Vocals', 'Singer', 'Album', 'Song.wav'),
      accompanimentPath: path.join(rootPath, 'Accompaniments', 'Singer', 'Album', 'Song.wav')
    });
  });

  it('rejects source files outside the selected media library root', () => {
    const outsidePath = path.resolve(rootPath, '..', 'outside.mp3');

    expect(() => getSeparatedStemOutputPaths(outsidePath, rootPath))
      .toThrow('outside the media library root');
  });

  it('rejects empty paths and files instead of treating them as folders', () => {
    const filePath = createFile('song.mp3');

    expect(() => scanAudioFiles('  ', true)).toThrow('Choose a folder');
    expect(() => scanAudioFiles(filePath, true)).toThrow('not a folder');
  });
});
