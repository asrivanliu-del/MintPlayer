import { describe, expect, it } from 'vitest';
import { normalizeLyricsText } from '../../src/electron/lyricsText';

describe('normalizeLyricsText', () => {
  it('extracts text from music-metadata lyric objects', () => {
    expect(normalizeLyricsText([
      { text: '那些你很冒險的夢' },
      { text: '不眠不休' }
    ])).toBe('那些你很冒險的夢\n不眠不休');
  });

  it('extracts synchronized lyric entries without stringifying objects', () => {
    expect(normalizeLyricsText([{
      syncText: [
        { text: '那些你很冒險的夢', timestamp: 1000 },
        { text: '不眠不休', timestamp: 2000 }
      ]
    }])).toBe('那些你很冒險的夢\n不眠不休');
    expect(normalizeLyricsText([{ text: { value: 'not lyric text' } }])).toBeNull();
  });

  it('preserves plain string lyrics and rejects empty input', () => {
    expect(normalizeLyricsText('  歌詞內容  ')).toBe('歌詞內容');
    expect(normalizeLyricsText([])).toBeNull();
  });
});
