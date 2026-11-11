import { describe, expect, it, vi } from 'vitest';
import { searchOnlineMetadata } from '../../src/electron/onlineMetadata';

const hints = {
  title: 'Target Song',
  artist: 'Test Artist',
  album: 'Test Album'
};

function response(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createFetcher(handler: (url: URL) => unknown) {
  const mock = vi.fn(async (input: RequestInfo | URL) => response(handler(new URL(String(input)))));
  return { fetcher: mock as unknown as typeof fetch, mock };
}

function appleSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    trackId: 123,
    trackName: 'Target Song',
    artistName: 'Test Artist',
    collectionName: 'Test Album',
    collectionArtistName: 'Apple Album Artist',
    releaseDate: '2020-05-01T00:00:00Z',
    trackNumber: 1,
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
    trackTimeMillis: 180000,
    ...overrides
  };
}

function discogsRelease(overrides: Record<string, unknown> = {}) {
  return {
    id: 456,
    title: 'Test Album',
    year: 2024,
    released: '2024-01-03',
    artists: [{ name: 'Test Artist' }],
    images: [{ uri: 'https://i.discogs.com/cover.jpg' }],
    tracklist: [{
      position: '7',
      type_: 'track',
      title: 'Target Song',
      duration: '3:10',
      extraartists: [
        { name: 'Discogs Composer', role: 'Music By' },
        { name: 'Discogs Lyricist', role: 'Lyrics By' }
      ]
    }],
    ...overrides
  };
}

describe('searchOnlineMetadata', () => {
  it('keeps Apple Music/iTunes values and fills only missing fields from Discogs', async () => {
    const { fetcher, mock } = createFetcher(url => {
      if (url.hostname === 'itunes.apple.com') {
        const country = url.searchParams.get('country');
        if (country === 'TW') return { results: [appleSearchResult({ collectionArtistName: '' })] };
        return { results: country === 'US' ? [appleSearchResult()] : [] };
      }
      if (url.pathname === '/database/search') return { results: [{ id: 456 }] };
      if (url.pathname === '/releases/456') return discogsRelease();
      throw new Error(`Unexpected request: ${url}`);
    });

    const { results, warnings } = await searchOnlineMetadata('Target Song Test Artist Test Album', hints, fetcher);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      trackName: 'Target Song',
      artistName: 'Test Artist',
      albumName: 'Test Album',
      year: '2020',
      trackNumber: '1',
      albumArtist: 'Apple Album Artist',
      artworkUrl: 'https://is1-ssl.mzstatic.com/image/600x600bb.jpg',
      duration: 180,
      composer: 'Discogs Composer',
      lyricist: 'Discogs Lyricist',
      fieldSources: {
        title: 'Apple Music/iTunes',
        year: 'Apple Music/iTunes',
        track: 'Apple Music/iTunes',
        albumArtist: 'Apple Music/iTunes',
        cover: 'Apple Music/iTunes',
        composer: 'Discogs',
        lyricist: 'Discogs'
      }
    });
    expect(warnings).toEqual([]);
    expect(mock.mock.calls.some(([input]) => String(input).includes('musicbrainz.org'))).toBe(false);
  });

  it('uses MusicBrainz only after Discogs leaves fields missing', async () => {
    const { fetcher, mock } = createFetcher(url => {
      if (url.hostname === 'itunes.apple.com') {
        return { results: url.searchParams.get('country') === 'TW' ? [appleSearchResult()] : [] };
      }
      if (url.hostname === 'api.discogs.com' && url.pathname === '/database/search') {
        return { results: [] };
      }
      if (url.hostname === 'musicbrainz.org' && url.pathname.endsWith('/recording/')) {
        return {
          recordings: [{
            id: 'recording-id',
            title: 'Target Song',
            'artist-credit': [{ name: 'Test Artist' }],
            releases: [{ id: 'release-id' }]
          }]
        };
      }
      if (url.hostname === 'musicbrainz.org' && url.pathname.endsWith('/release/release-id')) {
        return {
          id: 'release-id',
          title: 'Test Album',
          date: '2019-09-10',
          'artist-credit': [{ name: 'Test Artist' }],
          'cover-art-archive': { front: true },
          media: [{
            tracks: [{
              number: '2',
              title: 'Target Song',
              length: 179000,
              recording: {
                id: 'recording-id',
                title: 'Target Song',
                relations: [
                  { type: 'composer', artist: { name: 'MusicBrainz Composer' } },
                  { type: 'lyricist', artist: { name: 'MusicBrainz Lyricist' } }
                ]
              }
            }]
          }]
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const { results, warnings } = await searchOnlineMetadata('Target Song Test Artist Test Album', hints, fetcher);

    expect(warnings, JSON.stringify(mock.mock.calls.map(([input]) => String(input)))).toEqual([]);
    expect(results[0]).toMatchObject({
      year: '2020',
      trackNumber: '1',
      composer: 'MusicBrainz Composer',
      lyricist: 'MusicBrainz Lyricist',
      fieldSources: {
        year: 'Apple Music/iTunes',
        track: 'Apple Music/iTunes',
        composer: 'MusicBrainz',
        lyricist: 'MusicBrainz'
      }
    });
    expect(warnings).toEqual([]);
  });

  it('returns Discogs matches when Apple Music/iTunes has no result', async () => {
    const { fetcher } = createFetcher(url => {
      if (url.hostname === 'itunes.apple.com') return { results: [] };
      if (url.pathname === '/database/search') return { results: [{ id: 456 }] };
      if (url.pathname === '/releases/456') return discogsRelease();
      throw new Error(`Unexpected request: ${url}`);
    });

    const { results } = await searchOnlineMetadata('Target Song Test Artist Test Album', hints, fetcher);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      trackName: 'Target Song',
      composer: 'Discogs Composer',
      lyricist: 'Discogs Lyricist',
      fieldSources: {
        title: 'Discogs',
        composer: 'Discogs',
        lyricist: 'Discogs'
      }
    });
    expect(results[0].country).toBeUndefined();
  });

  it('finds Discogs credits using title and artist when a path album name overconstrains the query', async () => {
    const sunHints = {
      title: '超快感',
      artist: '孫燕姿',
      album: '孫燕姿'
    };
    const discogsArtist = {
      id: 1305991,
      name: 'Stefanie Sun',
      anv: '孫燕姿'
    };
    const { fetcher, mock } = createFetcher(url => {
      if (url.hostname === 'itunes.apple.com') {
        return {
          results: url.searchParams.get('country') === 'TW'
            ? [appleSearchResult({
              trackName: '超快感 (Remastered)',
              artistName: '孫燕姿',
              collectionName: '同名專輯 (Remastered)',
              collectionArtistName: '孫燕姿'
            })]
            : []
        };
      }
      if (url.pathname === '/database/search') {
        expect(url.searchParams.get('q')).toBe('超快感 孫燕姿');
        return { results: [{ id: 9135137 }] };
      }
      if (url.pathname === '/releases/9135137') {
        return discogsRelease({
          id: 9135137,
          title: '孫燕姿',
          year: 2000,
          released: '2000-06-09',
          artists: [discogsArtist, { ...discogsArtist, anv: 'Yan Zi' }],
          tracklist: [{
            position: '1',
            type_: 'track',
            title: '超快感',
            duration: '3:39',
            extraartists: [
              { name: '包小柏', role: 'Composed By, Lyrics By' },
              { name: '李焯雄', role: 'Lyrics By' }
            ]
          }]
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const { results } = await searchOnlineMetadata('超快感 孫燕姿 孫燕姿', sunHints, fetcher);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      composer: '包小柏',
      lyricist: '包小柏, 李焯雄',
      albumArtist: '孫燕姿',
      fieldSources: {
        composer: 'Discogs',
        lyricist: 'Discogs'
      }
    });
    expect(mock.mock.calls.some(([input]) => new URL(String(input)).hostname === 'musicbrainz.org'))
      .toBe(false);
  });
});
