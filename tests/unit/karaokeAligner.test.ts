import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  alignKaraokeSource,
  createKaraokeAss,
  getKaraokeOutputPath,
  parseKaraokeAss,
  updateKaraokeAss,
  type AlignmentProcessRunner
} from '../../src/electron/karaokeAligner';

describe('Karaoke Creator subtitle alignment backend', () => {
  it('creates the requested Karaoke artist/album/title path', () => {
    const root = path.join('C:\\Media');
    const video = path.join(root, 'Video', '孫燕姿', '單曲', '飛瀑而下.mp4');
    const music = path.join(root, 'Music', '孫燕姿', '單曲', '飛瀑而下.mp3');

    expect(getKaraokeOutputPath(video, root))
      .toBe(path.join(root, 'karaoke', '孫燕姿', '單曲', '飛瀑而下.ass'));
    expect(getKaraokeOutputPath(music, root))
      .toBe(path.join(root, 'karaoke', '孫燕姿', '單曲', '飛瀑而下.ass'));
  });

  it('writes and reads character-timed ASS karaoke events', () => {
    const subtitle = createKaraokeAss([{
      start: 1,
      end: 2,
      text: '飛瀑',
      characters: [
        { text: '飛', start: 1, end: 1.5 },
        { text: '瀑', start: 1.5, end: 2 }
      ]
    }]);

    expect(subtitle).toContain('{\\k50}飛{\\k50}瀑');
    const [line] = parseKaraokeAss(subtitle);
    expect(line.text).toBe('飛瀑');
    expect(line.characters).toHaveLength(2);
    expect(line.characters[0].start).toBe(1);
    expect(line.characters[1].start).toBe(1.5);
    expect(line.end).toBe(2);
  });

  it('updates karaoke timings while preserving the original ASS style and event fields', () => {
    const source = createKaraokeAss([{
      start: 1,
      end: 3,
      text: '飛瀑',
      characters: [
        { text: '飛', start: 1, end: 2 },
        { text: '瀑', start: 2, end: 3 }
      ]
    }]).replace(
      'Dialogue: 0,',
      'Dialogue: 2,'
    ).replace(
      ',Default,,0,0,0,,',
      ',CustomStyle,Actor,12,13,14,Effect,'
    );
    const [line] = parseKaraokeAss(source);
    const updated = updateKaraokeAss(source, [{
      ...line,
      start: 1.5,
      end: 3.5,
      characters: [
        { text: '飛', start: 1.5, end: 2.5 },
        { text: '瀑', start: 2.5, end: 3.5 }
      ]
    }]);

    expect(updated).toContain('Style: Default,Microsoft JhengHei');
    expect(updated).toContain('Dialogue: 2,0:00:01.50,0:00:03.50,CustomStyle,Actor,12,13,14,Effect,{\\k100}飛{\\k100}瀑');
    expect(parseKaraokeAss(updated)[0].characters.map(character => character.start)).toEqual([1.5, 2.5]);
  });

  it('rejects subtitle timing data that changes text or creates gaps', () => {
    const source = createKaraokeAss([{
      start: 1,
      end: 3,
      text: '飛瀑',
      characters: [
        { text: '飛', start: 1, end: 2 },
        { text: '瀑', start: 2, end: 3 }
      ]
    }]);
    const [line] = parseKaraokeAss(source);

    expect(() => updateKaraokeAss(source, [{
      ...line,
      text: '不同',
      characters: [
        { text: '不', start: 1, end: 2 },
        { text: '同', start: 2, end: 3 }
      ]
    }])).toThrow('Invalid character timing data');
    expect(() => updateKaraokeAss(source, [{
      ...line,
      characters: [
        { text: '飛', start: 1, end: 1.8 },
        { text: '瀑', start: 2, end: 3 }
      ]
    }])).toThrow('Invalid character timing data');
  });

  it('runs alignment, stores an ASS subtitle, and returns timed character data', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-karaoke-test-'));
    try {
      const libraryRoot = path.join(temporaryRoot, 'Media');
      const videoPath = path.join(libraryRoot, 'Video', '孫燕姿', '單曲', '飛瀑而下.mp4');
      const vocalsPath = path.join(libraryRoot, 'Video_Vocals', '孫燕姿', '單曲', '飛瀑而下.wav');
      fs.mkdirSync(path.dirname(videoPath), { recursive: true });
      fs.mkdirSync(path.dirname(vocalsPath), { recursive: true });
      fs.mkdirSync(path.join(temporaryRoot, 'scripts'), { recursive: true });
      fs.mkdirSync(libraryRoot, { recursive: true });
      fs.writeFileSync(videoPath, 'mock video');
      fs.writeFileSync(vocalsPath, 'mock vocals');
      const runner: AlignmentProcessRunner = vi.fn(async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          words: [{ text: '飛瀑而下', start: 1, end: 3 }]
        }),
        stderr: ''
      }));

      const result = await alignKaraokeSource(
        videoPath,
        vocalsPath,
        '飛瀑而下',
        libraryRoot,
        path.join(temporaryRoot, 'scripts', 'karaoke_aligner.py'),
        undefined,
        runner
      );

      expect(result.outputPath).toBe(path.join(libraryRoot, 'karaoke', '孫燕姿', '單曲', '飛瀑而下.ass'));
      const contents = fs.readFileSync(result.outputPath, 'utf8');
      const [line] = parseKaraokeAss(contents);
      expect(line.text).toBe('飛瀑而下');
      expect(line.characters).toHaveLength(4);
      expect(line.characters[0].start).toBe(1);
      expect(line.characters[3].end).toBeGreaterThan(line.characters[3].start);
      expect(runner).toHaveBeenCalledWith(
        'python',
        [path.join(temporaryRoot, 'scripts', 'karaoke_aligner.py')],
        JSON.stringify({ audioPath: vocalsPath, lyrics: '飛瀑而下' }),
        undefined
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('uses LRC timestamps to align repeated lines to their later chorus occurrence', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-karaoke-lrc-'));
    try {
      const libraryRoot = path.join(temporaryRoot, 'Media');
      const videoPath = path.join(libraryRoot, 'Video', 'Artist', 'Album', 'Song.mp4');
      const vocalsPath = path.join(libraryRoot, 'Video_Vocals', 'Artist', 'Album', 'Song.wav');
      fs.mkdirSync(path.dirname(videoPath), { recursive: true });
      fs.mkdirSync(path.dirname(vocalsPath), { recursive: true });
      fs.mkdirSync(path.join(temporaryRoot, 'scripts'), { recursive: true });
      fs.mkdirSync(libraryRoot, { recursive: true });
      fs.writeFileSync(videoPath, 'mock video');
      fs.writeFileSync(vocalsPath, 'mock vocals');
      const runner: AlignmentProcessRunner = vi.fn(async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          words: [
            { text: '飛瀑而下', start: 1, end: 3 },
            { text: '飛瀑而下', start: 10, end: 12 },
            { text: '飛瀑而下', start: 20, end: 22 }
          ]
        }),
        stderr: ''
      }));

      const result = await alignKaraokeSource(
        videoPath,
        vocalsPath,
        '飛瀑而下\n飛瀑而下',
        libraryRoot,
        path.join(temporaryRoot, 'scripts', 'karaoke_aligner.py'),
        undefined,
        runner,
        [{ time: 10, text: '飛瀑而下' }, { time: 20, text: '飛瀑而下' }]
      );

      const [first, second] = parseKaraokeAss(fs.readFileSync(result.outputPath, 'utf8'));
      expect(first.start).toBe(10);
      expect(second.start).toBe(20);
      expect(runner).toHaveBeenCalledWith(
        'python',
        [path.join(temporaryRoot, 'scripts', 'karaoke_aligner.py')],
        JSON.stringify({ audioPath: vocalsPath, lyrics: '飛瀑而下\n飛瀑而下' }),
        undefined
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('does not create output when the transcript does not match the lyrics', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-karaoke-mismatch-'));
    try {
      const libraryRoot = path.join(temporaryRoot, 'Media');
      const videoPath = path.join(libraryRoot, 'Video', 'Artist', 'Album', 'Song.mp4');
      const vocalsPath = path.join(libraryRoot, 'Video_Vocals', 'Artist', 'Album', 'Song.wav');
      fs.mkdirSync(path.dirname(videoPath), { recursive: true });
      fs.mkdirSync(path.dirname(vocalsPath), { recursive: true });
      fs.writeFileSync(videoPath, 'mock video');
      fs.writeFileSync(vocalsPath, 'mock vocals');
      const runner: AlignmentProcessRunner = async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ words: [{ text: '完全不相符', start: 1, end: 3 }] }),
        stderr: ''
      });

      await expect(alignKaraokeSource(
        videoPath,
        vocalsPath,
        '這是另一首歌的歌詞內容',
        libraryRoot,
        'unused.py',
        undefined,
        runner
      )).rejects.toThrow('Too little of the provided lyrics matched the audio');
      expect(fs.existsSync(path.join(libraryRoot, 'karaoke'))).toBe(false);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('requires an existing Video vocals WAV rather than transcribing the original video', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-karaoke-vocals-required-'));
    try {
      const libraryRoot = path.join(temporaryRoot, 'Media');
      const videoPath = path.join(libraryRoot, 'Video', 'Artist', 'Album', 'Song.mp4');
      fs.mkdirSync(path.dirname(videoPath), { recursive: true });
      fs.writeFileSync(videoPath, 'mock video');
      const runner: AlignmentProcessRunner = vi.fn();

      await expect(alignKaraokeSource(
        videoPath,
        path.join(libraryRoot, 'Video_Vocals', 'Artist', 'Album', 'Song.wav'),
        'Song lyrics',
        libraryRoot,
        'unused.py',
        undefined,
        runner
      )).rejects.toThrow('Create the matching vocals stem');
      expect(runner).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
