import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchLyricsOvh } from '../../src/electron/onlineLyrics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchLyricsOvh', () => {
  it('fetches plain lyrics directly when title and artist are known', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      lyrics: 'Hello from the other side'
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const result = await searchLyricsOvh('Hello', 'Adele', 'Hello Adele');

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.lyrics.ovh/v1/Adele/Hello');
    expect(result.result).toMatchObject({
      trackName: 'Hello',
      artistName: 'Adele',
      plainLyrics: 'Hello from the other side',
      syncedLyrics: '',
      source: 'Lyrics.ovh'
    });
  });

  it('finds an artist from song suggestions when the track has no artist metadata', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 123, title: 'Hello', duration: 295, artist: { name: 'Adele' } }]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lyrics: 'Hello lyrics' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const result = await searchLyricsOvh('Hello', '', 'Hello');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain('/suggest/Hello');
    expect(String(fetch.mock.calls[1][0])).toBe('https://api.lyrics.ovh/v1/Adele/Hello');
    expect(result.result).toMatchObject({
      id: 123,
      trackName: 'Hello',
      artistName: 'Adele',
      duration: 295,
      plainLyrics: 'Hello lyrics'
    });
  });

  it('uses the optimized fallback query without repeating the title and artist', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ lyrics: '' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 123, title: 'Hello', artist: { name: 'Adele' } }]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lyrics: 'Hello lyrics' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await searchLyricsOvh('Hello', 'Adele', 'Hello Adele 30');

    expect(String(fetch.mock.calls[0][0])).toBe('https://api.lyrics.ovh/v1/Adele/Hello');
    expect(String(fetch.mock.calls[1][0]))
      .toBe('https://api.lyrics.ovh/suggest/Hello%20Adele%2030');
  });

  it('returns a visible provider error when the online fallback is unavailable', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);

    const result = await searchLyricsOvh('Hello', 'Adele', 'Hello Adele');

    expect(result.result).toBeNull();
    expect(result.error).toContain('HTTP 503');
  });
});
