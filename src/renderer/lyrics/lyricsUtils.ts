import type { TimedLyric } from '../types';

export const LYRICS_RESULTS_PER_PAGE = 2;

let traditionalLyricsConverter: ((text: string) => string) | null = null;

export async function toTraditionalLyrics(lyrics: string): Promise<string> {
  if (!traditionalLyricsConverter) {
    const OpenCC = await import('opencc-js');
    traditionalLyricsConverter = OpenCC.default.Converter({ from: 'cn', to: 'twp' });
  }
  return traditionalLyricsConverter(lyrics);
}

export function stripLyricTimestamps(lyrics: string) {
  return lyrics
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, ''))
    .join('\n');
}

export function getLyricsIndexAtTime(time: number, lyrics: TimedLyric[] | null) {
  if (!lyrics?.length || !Number.isFinite(time)) return -1;
  if (time < lyrics[0].time) return 0;
  let index = -1;
  for (let i = 0; i < lyrics.length && lyrics[i].time <= time; i++) {
    index = i;
  }
  return index;
}

export function formatLyricTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
