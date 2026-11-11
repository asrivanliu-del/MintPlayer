import { describe, expect, it } from 'vitest';
import {
  addRecentVideoUrl,
  MEDIA_DOWNLOADER_RECENTS_LIMIT,
  parseRecentVideoUrls
} from '../../src/renderer/tools/mediaDownloaderHistory';

describe('Media Downloader URL history', () => {
  it('parses legacy URLs and titled entries, removes duplicates, and caps the list', () => {
    expect(parseRecentVideoUrls(JSON.stringify([
      { url: ' https://example.com/1 ', title: ' First video ' },
      'https://example.com/1',
      { url: 'https://example.com/2', title: 'Second video' },
      '',
      { url: 'https://example.com/3', title: 'Third video', thumbnailUrl: ' https://img.example.com/3.jpg ' },
      { url: 'https://example.com/4', title: 'Fourth video' }
    ]))).toEqual([
      { url: 'https://example.com/1', title: 'First video' },
      { url: 'https://example.com/2', title: 'Second video' },
      { url: 'https://example.com/3', title: 'Third video', thumbnailUrl: 'https://img.example.com/3.jpg' }
    ]);
    expect(parseRecentVideoUrls(JSON.stringify(['https://example.com/legacy']))).toEqual([
      { url: 'https://example.com/legacy', title: 'https://example.com/legacy' }
    ]);
    expect(parseRecentVideoUrls('invalid')).toEqual([]);
    expect(parseRecentVideoUrls(JSON.stringify({ url: 'https://example.com' }))).toEqual([]);
  });

  it('moves a repeated URL to the front, updates its title, and keeps at most three entries', () => {
    const updated = addRecentVideoUrl(
      [
        { url: 'https://example.com/1', title: 'First' },
        { url: 'https://example.com/2', title: 'Old title', thumbnailUrl: 'https://img.example.com/2.jpg' },
        { url: 'https://example.com/3', title: 'Third' }
      ],
      'https://example.com/2',
      'Updated title'
    );
    expect(updated).toEqual([
      { url: 'https://example.com/2', title: 'Updated title', thumbnailUrl: 'https://img.example.com/2.jpg' },
      { url: 'https://example.com/1', title: 'First' },
      { url: 'https://example.com/3', title: 'Third' }
    ]);
    expect(addRecentVideoUrl(updated, 'https://example.com/2', 'New title', 'https://img.example.com/new.jpg')[0])
      .toEqual({ url: 'https://example.com/2', title: 'New title', thumbnailUrl: 'https://img.example.com/new.jpg' });
    expect(addRecentVideoUrl(updated, 'https://example.com/4', 'Fourth')).toHaveLength(MEDIA_DOWNLOADER_RECENTS_LIMIT);
    expect(addRecentVideoUrl(updated, '  ', 'No title')).toEqual(updated);
  });
});
