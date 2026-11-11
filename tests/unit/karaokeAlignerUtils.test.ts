import { describe, expect, it } from 'vitest';
import type { ElectronKaraokeSubtitleLine } from '../../src/electron/electronApi';
import {
  formatKaraokeTime,
  formatKaraokeTimestamp,
  getKaraokeTimelineWindow,
  parseKaraokeTimestamp,
  updateKaraokeLineBoundary
} from '../../src/renderer/tools/karaokeAlignerUtils';

const line: ElectronKaraokeSubtitleLine = {
  start: 5,
  end: 8,
  text: 'ABC',
  characters: [
    { text: 'A', start: 5, end: 6 },
    { text: 'B', start: 6, end: 7 },
    { text: 'C', start: 7, end: 8 }
  ]
};

describe('Karaoke Aligner timing utilities', () => {
  it('moves a shared character boundary and keeps adjacent timings contiguous', () => {
    const updated = updateKaraokeLineBoundary([line], 0, 1, 6.4, 10)[0];

    expect(updated.characters[0].end).toBe(6.4);
    expect(updated.characters[1].start).toBe(6.4);
    expect(updated.characters[1].end).toBe(7);
    expect(updated.start).toBe(5);
  });

  it('clamps a boundary between neighboring characters and within the video duration', () => {
    const tooEarly = updateKaraokeLineBoundary([line], 0, 1, 1, 10)[0];
    expect(tooEarly.characters[0].end).toBe(5);
    expect(tooEarly.characters[1].start).toBe(5);

    const tooLate = updateKaraokeLineBoundary([line], 0, 1, 20, 60)[0];
    expect(tooLate.characters[0].end).toBe(7);
    expect(tooLate.characters[1].start).toBe(7);

    const beyondVideo = updateKaraokeLineBoundary([line], 0, 3, 12, 9)[0];
    expect(beyondVideo.end).toBe(9);
    expect(beyondVideo.characters[2].end).toBe(9);
  });

  it('keeps the first and last line boundaries within neighboring subtitle lines', () => {
    const previousLine: ElectronKaraokeSubtitleLine = {
      start: 1,
      end: 4,
      text: 'Previous',
      characters: [{ text: 'P', start: 1, end: 4 }]
    };
    const nextLine: ElectronKaraokeSubtitleLine = {
      start: 9,
      end: 11,
      text: 'Next',
      characters: [{ text: 'N', start: 9, end: 11 }]
    };

    const firstBoundary = updateKaraokeLineBoundary([previousLine, line], 1, 0, 0, 60)[1];
    expect(firstBoundary.start).toBe(4);
    expect(firstBoundary.characters[0].start).toBe(4);

    const lastBoundary = updateKaraokeLineBoundary([line, nextLine], 0, line.characters.length, 20, 60)[0];
    expect(lastBoundary.end).toBe(9);
    expect(lastBoundary.characters[lastBoundary.characters.length - 1].end).toBe(9);
  });

  it('formats time labels and creates a readable local timeline window', () => {
    expect(formatKaraokeTime(65.5)).toBe('01:05.50');
    expect(formatKaraokeTimestamp(10.123)).toBe('00:00:10.123');
    expect(parseKaraokeTimestamp('00:00:10.123')).toBe(10.123);
    expect(parseKaraokeTimestamp('01:02:03.4')).toBe(3723.4);
    expect(parseKaraokeTimestamp('not a time')).toBeNull();
    expect(getKaraokeTimelineWindow(line, 60)).toEqual({ minimum: 3, maximum: 10 });
  });
});
