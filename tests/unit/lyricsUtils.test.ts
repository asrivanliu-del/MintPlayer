import { describe, expect, it } from 'vitest';
import { formatLyricTime, getLyricsIndexAtTime, stripLyricTimestamps } from '../../src/renderer/lyrics/lyricsUtils';

const lyrics = [
  { time: 4, text: 'First line' },
  { time: 9.5, text: 'Second line' },
  { time: 14, text: 'Third line' }
];

describe('getLyricsIndexAtTime', () => {
  it('selects the current lyric at exact timestamps and between lines', () => {
    expect(getLyricsIndexAtTime(4, lyrics)).toBe(0);
    expect(getLyricsIndexAtTime(8.99, lyrics)).toBe(0);
    expect(getLyricsIndexAtTime(9.5, lyrics)).toBe(1);
    expect(getLyricsIndexAtTime(30, lyrics)).toBe(2);
  });

  it('handles times before the first line and invalid lyric input', () => {
    expect(getLyricsIndexAtTime(0, lyrics)).toBe(0);
    expect(getLyricsIndexAtTime(Number.NaN, lyrics)).toBe(-1);
    expect(getLyricsIndexAtTime(5, null)).toBe(-1);
    expect(getLyricsIndexAtTime(5, [])).toBe(-1);
  });
});

describe('formatLyricTime', () => {
  it('formats time as zero-padded minutes and seconds', () => {
    expect(formatLyricTime(0)).toBe('00:00');
    expect(formatLyricTime(9.9)).toBe('00:09');
    expect(formatLyricTime(125)).toBe('02:05');
  });
});

describe('stripLyricTimestamps', () => {
  it('removes LRC timestamps from lines while preserving the lyric text', () => {
    expect(stripLyricTimestamps(
      '[00:31.272] 光 拿烏雲揉成團\r\n[00:36.396] 像鯨魚吻著浪\r\n[00:40.061] 叫我 和你 去飛翔'
    )).toBe('光 拿烏雲揉成團\n像鯨魚吻著浪\n叫我 和你 去飛翔');
  });

  it('removes multiple leading timestamps and leaves untimed text unchanged', () => {
    expect(stripLyricTimestamps('[00:01.00][00:02.00]Repeated line\nPlain line'))
      .toBe('Repeated line\nPlain line');
  });
});
