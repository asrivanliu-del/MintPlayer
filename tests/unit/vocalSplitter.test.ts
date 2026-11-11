import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { separateAudioFile } from '../../src/electron/vocalSplitter';

describe('separateAudioFile', () => {
  let temporaryRoot = '';
  let libraryRoot = '';
  let sourcePath = '';
  let tempRoot = '';

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-split-test-'));
    libraryRoot = path.join(temporaryRoot, 'library');
    tempRoot = path.join(temporaryRoot, 'temp');
    sourcePath = path.join(libraryRoot, 'Music', 'Singer', 'Album', 'Song.mp3');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.writeFileSync(sourcePath, 'source');
  });

  afterEach(() => {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = '';
  });

  it('copies vocals and accompaniment into separate output trees from Spleeter', async () => {
    const run = async (_command: string, args: string[]) => {
      const outputDirectory = args[args.indexOf('-o') + 1];
      const songDirectory = path.join(outputDirectory, 'Song');
      fs.mkdirSync(songDirectory, { recursive: true });
      fs.writeFileSync(path.join(songDirectory, 'vocals.wav'), 'vocals');
      fs.writeFileSync(path.join(songDirectory, 'accompaniment.wav'), 'accompaniment');
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const outputs = await separateAudioFile(sourcePath, libraryRoot, tempRoot, run);

    expect(outputs).toEqual({
      vocalsPath: path.join(libraryRoot, 'Music_Vocals', 'Singer', 'Album', 'Song.wav'),
      accompanimentPath: path.join(libraryRoot, 'Music_Accompaniments', 'Singer', 'Album', 'Song.wav')
    });
    expect(fs.readFileSync(outputs.vocalsPath, 'utf8')).toBe('vocals');
    expect(fs.readFileSync(outputs.accompanimentPath, 'utf8')).toBe('accompaniment');
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('falls back to Demucs and reuses a complete pair of output stems', async () => {
    const run = async (command: string, args: string[]) => {
      if (command === 'spleeter') return { exitCode: 1, stdout: '', stderr: 'not installed' };
      const outputDirectory = args[args.indexOf('-o') + 1];
      const songDirectory = path.join(outputDirectory, 'htdemucs', 'Song');
      fs.mkdirSync(songDirectory, { recursive: true });
      fs.writeFileSync(path.join(songDirectory, 'vocals.wav'), 'demucs vocals');
      fs.writeFileSync(path.join(songDirectory, 'no_vocals.wav'), 'demucs accompaniment');
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const outputs = await separateAudioFile(sourcePath, libraryRoot, tempRoot, run);
    const secondResult = await separateAudioFile(sourcePath, libraryRoot, tempRoot, async () => {
      throw new Error('an existing pair should be reused');
    });

    expect(fs.readFileSync(outputs.vocalsPath, 'utf8')).toBe('demucs vocals');
    expect(fs.readFileSync(outputs.accompanimentPath, 'utf8')).toBe('demucs accompaniment');
    expect(secondResult).toEqual(outputs);
  });

  it('extracts MP4 audio before producing aligned vocals and accompaniment WAV files', async () => {
    const videoPath = path.join(libraryRoot, 'Video', '孫燕姿', '單曲', '飛瀑而下.mp4');
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    fs.writeFileSync(videoPath, 'mock video');
    const commands: Array<{ command: string; args: string[] }> = [];
    const run = async (command: string, args: string[]) => {
      commands.push({ command, args });
      if (command === 'ffmpeg') {
        fs.writeFileSync(args[args.length - 1], 'extracted wav');
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      const inputPath = args[args.indexOf('-i') + 1];
      expect(inputPath).toMatch(/飛瀑而下\.wav$/);
      const outputDirectory = args[args.indexOf('-o') + 1];
      const songDirectory = path.join(outputDirectory, '飛瀑而下');
      fs.mkdirSync(songDirectory, { recursive: true });
      fs.writeFileSync(path.join(songDirectory, 'vocals.wav'), 'vocals');
      fs.writeFileSync(path.join(songDirectory, 'accompaniment.wav'), 'accompaniment');
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const outputs = await separateAudioFile(videoPath, libraryRoot, tempRoot, run);

    expect(commands[0].command).toBe('ffmpeg');
    expect(commands[0].args).toContain('-vn');
    expect(outputs).toEqual({
      vocalsPath: path.join(libraryRoot, 'Video_Vocals', '孫燕姿', '單曲', '飛瀑而下.wav'),
      accompanimentPath: path.join(libraryRoot, 'Video_Accompaniments', '孫燕姿', '單曲', '飛瀑而下.wav')
    });
    expect(fs.readFileSync(outputs.vocalsPath, 'utf8')).toBe('vocals');
    expect(fs.readFileSync(outputs.accompanimentPath, 'utf8')).toBe('accompaniment');
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('creates independent cached stems for same-title Music and Video sources', async () => {
    const videoPath = path.join(libraryRoot, 'Video', 'Singer', 'Album', 'Song.mp4');
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    fs.writeFileSync(videoPath, 'video source');
    let separatedSources = 0;
    const run = async (command: string, args: string[]) => {
      if (command === 'ffmpeg') {
        fs.writeFileSync(args[args.length - 1], 'extracted audio');
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      separatedSources++;
      const outputDirectory = args[args.indexOf('-o') + 1];
      const songDirectory = path.join(outputDirectory, 'Song');
      fs.mkdirSync(songDirectory, { recursive: true });
      fs.writeFileSync(path.join(songDirectory, 'vocals.wav'), `${separatedSources} vocals`);
      fs.writeFileSync(path.join(songDirectory, 'accompaniment.wav'), `${separatedSources} accompaniment`);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const musicOutputs = await separateAudioFile(sourcePath, libraryRoot, tempRoot, run);
    const videoOutputs = await separateAudioFile(videoPath, libraryRoot, tempRoot, run);

    expect(musicOutputs.vocalsPath).not.toBe(videoOutputs.vocalsPath);
    expect(musicOutputs.accompanimentPath).not.toBe(videoOutputs.accompanimentPath);
    expect(fs.readFileSync(musicOutputs.vocalsPath, 'utf8')).toBe('1 vocals');
    expect(fs.readFileSync(videoOutputs.vocalsPath, 'utf8')).toBe('2 vocals');
    expect(fs.readFileSync(musicOutputs.accompanimentPath, 'utf8')).toBe('1 accompaniment');
    expect(fs.readFileSync(videoOutputs.accompanimentPath, 'utf8')).toBe('2 accompaniment');
    expect(separatedSources).toBe(2);
  });

  it('reports an actionable error when MP4 audio cannot be extracted', async () => {
    const videoPath = path.join(libraryRoot, 'Video', 'Artist', 'Album', 'Song.mp4');
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    fs.writeFileSync(videoPath, 'mock video');

    await expect(separateAudioFile(videoPath, libraryRoot, tempRoot, async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'no audio stream'
    }))).rejects.toThrow('Install FFmpeg and add it to PATH');
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });
});
