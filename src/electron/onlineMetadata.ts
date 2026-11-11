import type {
  ElectronMetadataSearchHints,
  ElectronMetadataSource,
  ElectronOnlineMetadataResult
} from './electronApi';

const APPLE_COUNTRIES = ['TW', 'HK', 'US', 'JP', 'GB', 'CA', 'AU', 'SG'] as const;
const METADATA_FIELDS = [
  'title',
  'artist',
  'album',
  'year',
  'track',
  'albumArtist',
  'cover',
  'duration',
  'composer',
  'lyricist'
] as const;

type MetadataField = typeof METADATA_FIELDS[number];
type MetadataResult = ElectronOnlineMetadataResult & {
  fieldSources: Partial<Record<MetadataField, ElectronMetadataSource>>;
};
type DiscogsSearchResult = { id?: unknown };
type DiscogsArtist = { id?: unknown; name?: unknown; anv?: unknown; role?: unknown };
type DiscogsTrack = {
  position?: unknown;
  type_?: unknown;
  title?: unknown;
  duration?: unknown;
  artists?: DiscogsArtist[];
  extraartists?: DiscogsArtist[];
};
type DiscogsRelease = {
  id?: unknown;
  title?: unknown;
  year?: unknown;
  released?: unknown;
  artists?: DiscogsArtist[];
  tracklist?: DiscogsTrack[];
  images?: Array<{ uri?: unknown }>;
};
type MusicBrainzArtistCredit = { name?: unknown; artist?: { name?: unknown }; joinphrase?: unknown };
type MusicBrainzRelation = {
  type?: unknown;
  artist?: { name?: unknown };
  work?: { relations?: MusicBrainzRelation[] };
};
type MusicBrainzTrack = {
  number?: unknown;
  title?: unknown;
  length?: unknown;
  recording?: { id?: unknown; title?: unknown; relations?: MusicBrainzRelation[] };
};
type MusicBrainzRelease = {
  id?: unknown;
  title?: unknown;
  date?: unknown;
  'artist-credit'?: MusicBrainzArtistCredit[];
  'cover-art-archive'?: { front?: unknown };
  media?: Array<{ tracks?: MusicBrainzTrack[] }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function matchesText(actual: string, expected: string) {
  const left = normalize(actual);
  const right = normalize(expected);
  return !!left && !!right && (left === right || left.includes(right) || right.includes(left));
}

function hasValue(value: unknown) {
  return typeof value === 'string' ? !!value.trim() : typeof value === 'number' && Number.isFinite(value);
}

function sourceFields(
  result: Omit<MetadataResult, 'fieldSources'>,
  source: ElectronMetadataSource
): MetadataResult {
  const fieldSources: MetadataResult['fieldSources'] = {};
  const values: Record<MetadataField, unknown> = {
    title: result.trackName,
    artist: result.artistName,
    album: result.albumName,
    year: result.year,
    track: result.trackNumber,
    albumArtist: result.albumArtist,
    cover: result.artworkUrl,
    duration: result.duration,
    composer: result.composer,
    lyricist: result.lyricist
  };
  for (const field of METADATA_FIELDS) {
    if (hasValue(values[field])) fieldSources[field] = source;
  }
  return { ...result, fieldSources };
}

function mergeMissingFields(target: MetadataResult, fallback: MetadataResult) {
  const fields: Record<MetadataField, keyof MetadataResult> = {
    title: 'trackName',
    artist: 'artistName',
    album: 'albumName',
    year: 'year',
    track: 'trackNumber',
    albumArtist: 'albumArtist',
    cover: 'artworkUrl',
    duration: 'duration',
    composer: 'composer',
    lyricist: 'lyricist'
  };
  for (const field of METADATA_FIELDS) {
    const targetKey = fields[field];
    if (!hasValue(target[targetKey]) && hasValue(fallback[targetKey])) {
      Object.assign(target, { [targetKey]: fallback[targetKey] });
      target.fieldSources[field] = fallback.fieldSources[field];
    }
  }
  return target;
}

function missingMetadataFields(result: MetadataResult) {
  const fields: Record<MetadataField, keyof MetadataResult> = {
    title: 'trackName',
    artist: 'artistName',
    album: 'albumName',
    year: 'year',
    track: 'trackNumber',
    albumArtist: 'albumArtist',
    cover: 'artworkUrl',
    duration: 'duration',
    composer: 'composer',
    lyricist: 'lyricist'
  };
  return METADATA_FIELDS.some(field => !hasValue(result[fields[field]]));
}

async function requestJson(url: string, provider: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { 'User-Agent': `MintPlayer/0.1.0 (desktop ${provider} metadata lookup)` },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}.`);
  return response.json();
}

function appleTrack(item: Record<string, unknown>, country: MetadataResult['country']): MetadataResult | null {
  const id = Number(item.trackId);
  const trackName = typeof item.trackName === 'string' ? item.trackName.trim() : '';
  const artistName = typeof item.artistName === 'string' ? item.artistName.trim() : '';
  if (!Number.isFinite(id) || !trackName || !artistName) return null;
  const artworkUrl = typeof item.artworkUrl100 === 'string'
    ? item.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.')
    : '';
  const duration = Number(item.trackTimeMillis);
  const result = {
    id,
    trackName,
    artistName,
    albumName: typeof item.collectionName === 'string' ? item.collectionName : '',
    year: typeof item.releaseDate === 'string' ? item.releaseDate.slice(0, 4) : '',
    trackNumber: Number.isFinite(Number(item.trackNumber)) ? String(item.trackNumber) : '',
    albumArtist: typeof item.collectionArtistName === 'string' ? item.collectionArtistName : '',
    artworkUrl,
    duration: Number.isFinite(duration) ? duration / 1000 : null,
    country,
    composer: '',
    lyricist: ''
  };
  return sourceFields(result, 'Apple Music/iTunes');
}

async function searchAppleMusic(query: string, fetcher: typeof fetch) {
  const warnings: string[] = [];
  const requests = await Promise.allSettled(APPLE_COUNTRIES.map(async country => {
    const url = `https://itunes.apple.com/search?country=${country}&media=music&entity=song&limit=10&term=${encodeURIComponent(query)}`;
    const payload = await requestJson(url, 'Apple Music/iTunes', fetcher);
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error(`${country} returned an invalid search response.`);
    }
    return payload.results
      .filter(isRecord)
      .map(item => appleTrack(item, country))
      .filter((result): result is MetadataResult => !!result);
  }));
  const results: MetadataResult[] = [];
  requests.forEach((request, index) => {
    if (request.status === 'fulfilled') results.push(...request.value);
    else warnings.push(`Apple Music/iTunes (${APPLE_COUNTRIES[index]}): ${String(request.reason)}`);
  });
  const uniqueResults: MetadataResult[] = [];
  for (const result of results) {
    const existing = uniqueResults.find(candidate => candidate.id === result.id);
    if (existing) mergeMissingFields(existing, result);
    else uniqueResults.push(result);
  }
  return {
    results: uniqueResults,
    warnings
  };
}

function parseDuration(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d+))?$/);
  if (!match) return null;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2]);
  return seconds < 60 ? minutes * 60 + seconds : null;
}

function namesFromArtists(artists: DiscogsArtist[] | undefined, preferredName = '') {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const names: string[] = [];
  for (const artist of artists || []) {
    const id = artist.id == null ? '' : String(artist.id);
    if (id && seenIds.has(id)) continue;
    const variants = [artist.anv, artist.name]
      .filter((name): name is string => typeof name === 'string')
      .map(name => name.trim())
      .filter(Boolean);
    const name = variants.find(variant => matchesText(variant, preferredName)) || variants[0] || '';
    const normalizedName = normalize(name);
    if (!name || (normalizedName && seenNames.has(normalizedName))) continue;
    if (id) seenIds.add(id);
    seenNames.add(normalizedName);
    names.push(name);
  }
  return names;
}

function musicbrainzNames(credits: MusicBrainzArtistCredit[] | undefined) {
  return (credits || [])
    .map(credit => typeof credit.name === 'string'
      ? credit.name
      : typeof credit.artist?.name === 'string' ? credit.artist.name : '')
    .filter(Boolean)
    .join('');
}

function matchScore(
  candidate: Pick<ElectronOnlineMetadataResult, 'trackName' | 'artistName' | 'albumName'>,
  hints: ElectronMetadataSearchHints
) {
  if (!matchesText(candidate.trackName, hints.title)) return 0;
  const artistMatch = !!hints.artist && matchesText(candidate.artistName, hints.artist);
  const albumMatch = !!hints.album && matchesText(candidate.albumName, hints.album);
  if ((hints.artist || hints.album) && !artistMatch && !albumMatch) return 0;
  return 3 + Number(artistMatch) * 2 + Number(albumMatch) * 2;
}

function discogsCandidate(
  release: DiscogsRelease,
  track: DiscogsTrack,
  hints: ElectronMetadataSearchHints
): MetadataResult | null {
  if (track.type_ && track.type_ !== 'track') return null;
  if (typeof track.title !== 'string' || typeof release.title !== 'string') return null;
  const releaseArtists = namesFromArtists(release.artists, hints.artist);
  const trackArtists = namesFromArtists(track.artists, hints.artist);
  const allCredits = track.extraartists || [];
  const creditsForRole = (role: RegExp) => allCredits
    .filter(artist => typeof artist.role === 'string' && role.test(artist.role))
    .map(artist => typeof artist.name === 'string' ? artist.name.trim() : '')
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index)
    .join(', ');
  const releaseDate = typeof release.released === 'string' ? release.released : '';
  const id = Number(release.id);
  const result = {
    id: Number.isFinite(id) ? id : 0,
    trackName: track.title.trim(),
    artistName: trackArtists.join(', ') || releaseArtists.join(', '),
    albumName: release.title.trim(),
    year: releaseDate.match(/^\d{4}/)?.[0] || String(release.year || ''),
    trackNumber: typeof track.position === 'string' ? track.position.trim() : '',
    albumArtist: releaseArtists.join(', '),
    artworkUrl: typeof release.images?.[0]?.uri === 'string' ? release.images[0].uri : '',
    duration: parseDuration(track.duration),
    composer: creditsForRole(/\b(?:music by|composed by|composer)\b/i),
    lyricist: creditsForRole(/\b(?:lyrics by|lyricist|written by)\b/i)
  };
  return sourceFields(result, 'Discogs');
}

async function searchDiscogs(
  hints: ElectronMetadataSearchHints,
  fetcher: typeof fetch
) {
  const candidates: MetadataResult[] = [];
  const warnings: string[] = [];
  const queries = [...new Set([
    [hints.title, hints.artist].filter(Boolean).join(' '),
    [hints.title, hints.album].filter(Boolean).join(' '),
    hints.title
  ].filter(Boolean))];
  const seenReleaseIds = new Set<number>();

  for (const query of queries) {
    let payload: unknown;
    try {
      const url = `https://api.discogs.com/database/search?type=release&per_page=5&q=${encodeURIComponent(query)}`;
      payload = await requestJson(url, 'Discogs', fetcher);
    } catch (error) {
      warnings.push(`Discogs search "${query}": ${String(error)}`);
      continue;
    }
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      warnings.push(`Discogs returned an invalid search response for "${query}".`);
      continue;
    }
    const releases = payload.results
      .filter(isRecord)
      .map(result => result as DiscogsSearchResult)
      .filter((result): result is DiscogsSearchResult & { id: number } =>
        Number.isInteger(Number(result.id)) && Number(result.id) > 0)
      .filter(result => !seenReleaseIds.has(result.id));
    releases.forEach(result => seenReleaseIds.add(result.id));
    const releaseResponses = await Promise.allSettled(releases.map(result =>
      requestJson(`https://api.discogs.com/releases/${result.id}`, 'Discogs', fetcher)));
    for (const [index, response] of releaseResponses.entries()) {
      if (response.status === 'rejected') {
        warnings.push(`Discogs release ${releases[index].id}: ${String(response.reason)}`);
        continue;
      }
      const releasePayload = response.value;
      if (!isRecord(releasePayload) || !Array.isArray(releasePayload.tracklist)) {
        warnings.push(`Discogs release ${releases[index].id} returned no track list.`);
        continue;
      }
      const release = releasePayload as DiscogsRelease;
      const tracklist = releasePayload.tracklist.filter(isRecord) as DiscogsTrack[];
      for (const track of tracklist) {
        const candidate = discogsCandidate(release, track, hints);
        if (candidate && matchScore(candidate, hints)) candidates.push(candidate);
      }
    }
    if (candidates.some(candidate => candidate.composer && candidate.lyricist)) break;
  }
  return { candidates, warnings };
}

function musicbrainzCandidate(release: MusicBrainzRelease, track: MusicBrainzTrack): MetadataResult | null {
  const recording = track.recording;
  const trackName = typeof recording?.title === 'string'
    ? recording.title
    : typeof track.title === 'string' ? track.title : '';
  const artists = musicbrainzNames(release['artist-credit']);
  const relations = [
    ...(recording?.relations || []),
    ...(recording?.relations || []).flatMap(relation => relation.work?.relations || [])
  ];
  const creditsForRole = (role: 'composer' | 'lyricist') => relations
    .filter(relation => relation.type === role)
    .map(relation => typeof relation.artist?.name === 'string' ? relation.artist.name.trim() : '')
    .filter((name, index, names) => names.indexOf(name) === index)
    .join(', ');
  const date = typeof release.date === 'string' ? release.date : '';
  const coverArtAvailable = release['cover-art-archive']?.front === true && typeof release.id === 'string';
  const recordingId = typeof recording?.id === 'string' ? recording.id : '';
  if (!trackName || !artists) return null;
  const result = {
    id: recordingId || String(release.id || ''),
    trackName,
    artistName: artists,
    albumName: typeof release.title === 'string' ? release.title : '',
    year: date.match(/^\d{4}/)?.[0] || '',
    trackNumber: typeof track.number === 'string' || typeof track.number === 'number' ? String(track.number) : '',
    albumArtist: artists,
    artworkUrl: coverArtAvailable ? `https://coverartarchive.org/release/${release.id}/front-500` : '',
    duration: typeof track.length === 'number' && Number.isFinite(track.length) ? track.length / 1000 : null,
    composer: creditsForRole('composer'),
    lyricist: creditsForRole('lyricist')
  };
  return sourceFields(result, 'MusicBrainz');
}

async function searchMusicBrainz(
  hints: ElectronMetadataSearchHints,
  fetcher: typeof fetch
) {
  const terms = [hints.title, hints.artist].filter(Boolean).join(' ');
  const searchUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(terms)}&fmt=json&limit=5`;
  const payload = await requestJson(searchUrl, 'MusicBrainz', fetcher);
  if (!isRecord(payload)) {
    throw new Error('MusicBrainz returned an invalid recording search response.');
  }
  const recordingList = Array.isArray(payload.recordings) ? payload.recordings : payload['recording-list'];
  if (!Array.isArray(recordingList)) {
    throw new Error('MusicBrainz returned an invalid recording list.');
  }
  const recordings = recordingList
    .filter(isRecord)
    .filter(recording => typeof recording.title === 'string')
    .filter(recording => matchesText(recording.title as string, hints.title))
    .filter(recording => {
      const artist = musicbrainzNames(recording['artist-credit'] as MusicBrainzArtistCredit[] | undefined);
      return !hints.artist || matchesText(artist, hints.artist);
    });
  const candidates: MetadataResult[] = [];
  for (const recording of recordings) {
    const releases = Array.isArray(recording.releases)
      ? recording.releases
      : Array.isArray(recording['release-list']) ? recording['release-list'] : [];
    const releaseId = releases.find(isRecord)?.id;
    if (typeof releaseId !== 'string') continue;
    await new Promise(resolve => setTimeout(resolve, 1100));
    const releasePayload = await requestJson(
      `https://musicbrainz.org/ws/2/release/${encodeURIComponent(releaseId)}?inc=recordings+artist-credits+recording-level-rels+work-level-rels&fmt=json`,
      'MusicBrainz',
      fetcher
    );
    if (!isRecord(releasePayload) || !Array.isArray(releasePayload.media)) {
      throw new Error(`MusicBrainz release ${releaseId} returned no track list.`);
    }
    const release = releasePayload as MusicBrainzRelease;
    const media = release.media || [];
    for (const track of media.flatMap(medium => medium.tracks || [])) {
      const candidate = musicbrainzCandidate(release, track);
      if (candidate && matchScore(candidate, hints)) candidates.push(candidate);
    }
    if (candidates.length) break;
  }
  return candidates;
}

function bestCandidate(candidates: MetadataResult[], result: MetadataResult, hints: ElectronMetadataSearchHints) {
  return candidates
    .map(candidate => ({ candidate, score: matchScore(candidate, {
      title: result.trackName || hints.title,
      artist: result.artistName || hints.artist,
      album: result.albumName || hints.album
    }) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

function appendWarnings(warnings: string[], provider: string, error: unknown) {
  warnings.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
}

export async function searchOnlineMetadata(
  query: string,
  hints: ElectronMetadataSearchHints,
  fetcher: typeof fetch = globalThis.fetch
): Promise<{ results: MetadataResult[]; warnings: string[] }> {
  const apple = await searchAppleMusic(query, fetcher);
  const warnings = [...apple.warnings];
  let results = apple.results;
  let discogsCandidates: MetadataResult[] = [];

  if (results.some(missingMetadataFields) || !results.length) {
    try {
      const discogs = await searchDiscogs(hints, fetcher);
      discogsCandidates = discogs.candidates;
      warnings.push(...discogs.warnings);
    } catch (error) {
      appendWarnings(warnings, 'Discogs', error);
    }
    if (!results.length) results = discogsCandidates.slice(0, 10);
    else {
      results = results.map(result => {
        const candidate = bestCandidate(discogsCandidates, result, hints);
        return candidate ? mergeMissingFields(result, candidate) : result;
      });
    }
  }

  if (results.some(missingMetadataFields) || !results.length) {
    try {
      const musicBrainzCandidates = await searchMusicBrainz(hints, fetcher);
      if (!results.length) results = musicBrainzCandidates.slice(0, 10);
      else {
        results = results.map(result => {
          const candidate = bestCandidate(musicBrainzCandidates, result, hints);
          return candidate ? mergeMissingFields(result, candidate) : result;
        });
      }
    } catch (error) {
      appendWarnings(warnings, 'MusicBrainz', error);
    }
  }

  return { results, warnings };
}
