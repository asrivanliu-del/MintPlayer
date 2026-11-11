import type { OnlineLyricsResult, OnlineMetadataResult, TrackPathHints } from '../types';
import { normalizeSearchText } from '../playlist/playlistUtils';

const VERSION_DESCRIPTOR =
  /\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|special|live|concert|radio\s+edit|single\s+version|mono|stereo|acoustic|instrumental|karaoke|remix|extended\s+mix|bonus\s+track)\b|現場|演唱會/i;
const LIVE_OR_CONCERT_VERSION =
  /\b(?:live|concert)(?:\s+(?:version|ver\.?|edition|recording))?\b|現場|演唱會/i;
const TRAILING_VERSION_DESCRIPTOR =
  /(?:[\s,;:–—-]+)(?:(?:19|20)\d{2}\s+)?(?:remaster(?:ed)?|deluxe(?:\s+edition)?|expanded(?:\s+edition)?|anniversary(?:\s+edition)?|special(?:\s+edition)?|live\s+concert|live(?:\s+(?:version|ver\.?|edition|recording))?|concert(?:\s+(?:version|ver\.?|edition|recording))?|radio\s+edit|single\s+version|mono|stereo|acoustic|instrumental|karaoke|remix|extended\s+mix|bonus\s+track)(?:\s+(?:19|20)\d{2})?$/i;
const SIMILARITY_WEIGHTS = {
  titleMatch: 45,
  titleSimilarity: 20,
  sameTrackRecording: 10,
  artistMatch: 15,
  albumMatch: 10,
  liveVersionPenalty: 3
};

export type OnlineMetadataSearchHints = Pick<TrackPathHints, 'title' | 'artist' | 'album' | 'year' | 'track'>;

function normalizeWithoutEdition(value: string): string {
  return normalizeSearchText(
    value
      .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (edition, roundContent: string | undefined, squareContent: string | undefined) =>
        VERSION_DESCRIPTOR.test(roundContent || squareContent || '') ? ' ' : edition
      )
      .replace(TRAILING_VERSION_DESCRIPTOR, '')
  );
}

function matchRank(actual: string, expected: string): number {
  const normalizedActual = normalizeSearchText(actual);
  const normalizedExpected = normalizeSearchText(expected);
  if (!normalizedActual || !normalizedExpected) return 0;
  if (normalizedActual === normalizedExpected) return 3;

  const editionlessActual = normalizeWithoutEdition(actual);
  const editionlessExpected = normalizeWithoutEdition(expected);
  if (editionlessActual && editionlessActual === editionlessExpected) return 2;
  if (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)) return 1;
  return 0;
}

function titleSimilarity(actual: string, expected: string): number {
  const normalizedActual = normalizeSearchText(actual).replace(/\s/g, '');
  const normalizedExpected = normalizeSearchText(expected).replace(/\s/g, '');
  const actualCharacters = Array.from(normalizedActual);
  const expectedCharacters = Array.from(normalizedExpected);
  if (actualCharacters.length < 3 || expectedCharacters.length < 3) return 0;

  const actualBigrams = new Set(actualCharacters.slice(1).map((character, index) =>
    `${actualCharacters[index]}${character}`));
  const expectedBigrams = new Set(expectedCharacters.slice(1).map((character, index) =>
    `${expectedCharacters[index]}${character}`));
  const sharedBigrams = [...actualBigrams].filter(bigram => expectedBigrams.has(bigram)).length;
  const score = 2 * sharedBigrams / (actualBigrams.size + expectedBigrams.size);
  return score >= 0.3 ? score : 0;
}

function isLiveOrConcertVersion(value: string): boolean {
  return LIVE_OR_CONCERT_VERSION.test(value);
}

function metadataDurationMatchesLyrics(metadata: OnlineMetadataResult, lyrics: OnlineLyricsResult[]): boolean {
  if (metadata.duration == null) return false;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return lyrics.some(result =>
    normalize(result.trackName) === normalize(metadata.trackName) &&
    result.duration != null &&
    Math.round(metadata.duration!) === Math.round(result.duration)
  );
}

export type OnlineMetadataMatchDetails = {
  titleMatched: boolean;
  artistMatched: boolean;
  albumMatched: boolean;
  similarityPercent: number;
};

type OnlineMetadataMatchCandidate = OnlineLyricsResult | OnlineMetadataResult;

function calculateOnlineMetadataMatchDetails(
  result: OnlineMetadataMatchCandidate,
  lyrics: OnlineLyricsResult[],
  hints: OnlineMetadataSearchHints,
  durationHint?: number
) {
  const titleRank = matchRank(result.trackName, hints.title);
  const artistRank = matchRank(result.artistName, hints.artist);
  const artist = normalizeSearchText(hints.artist);
  const album = normalizeSearchText(hints.album);
  let albumRank = matchRank(result.albumName, hints.album);
  if (artist && album === artist && isSelfTitledAlbum(result.albumName)) albumRank = Math.max(albumRank, 2);

  const normalizedTitleSimilarity = titleSimilarity(
    normalizeWithoutEdition(result.trackName),
    normalizeWithoutEdition(hints.title)
  );
  const resultTrackNumber = 'trackNumber' in result
    ? result.trackNumber.split('/')[0].replace(/^0+/, '')
    : '';
  const trackMatch = Number(!!hints.track && resultTrackNumber === hints.track);
  const yearMatch = Number(!!hints.year && 'year' in result && result.year === hints.year);
  const hasTrackYearEvidence = !!hints.track && !!hints.year && 'trackNumber' in result && 'year' in result;
  const hasDurationEvidence = Number.isFinite(durationHint) && result.duration !== null;
  const durationMatches = hasDurationEvidence && Math.abs(result.duration! - durationHint!) <= 2;
  const sameTrackRecording = Number(
    hasTrackYearEvidence ? !!trackMatch && !!yearMatch : !!durationMatches
  );
  const liveOrConcertPenalty = Number(!!titleRank && isLiveOrConcertVersion(result.trackName));
  const rawScore =
    (Number(titleRank > 0) * SIMILARITY_WEIGHTS.titleMatch) +
    (normalizedTitleSimilarity * SIMILARITY_WEIGHTS.titleSimilarity) +
    (sameTrackRecording * SIMILARITY_WEIGHTS.sameTrackRecording) +
    (Number(artistRank > 0) * SIMILARITY_WEIGHTS.artistMatch) +
    (Number(albumRank > 0) * SIMILARITY_WEIGHTS.albumMatch) -
    (liveOrConcertPenalty * SIMILARITY_WEIGHTS.liveVersionPenalty);
  const similarityPercent = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    titleRank,
    titleSimilarity: titleRank ? 0 : titleSimilarity(result.trackName, hints.title),
    liveOrConcertPenalty,
    sameTrackRecording,
    artistRank,
    albumRank,
    trackMatch,
    yearMatch,
    lyricsDurationMatch: 'country' in result ? Number(metadataDurationMatchesLyrics(result, lyrics)) : 0,
    scriptMatch: matchesExpectedScript(result.trackName, hints.title),
    titleMatched: titleRank > 0,
    artistMatched: artistRank > 0,
    albumMatched: albumRank > 0,
    similarityPercent
  };
}

export function getOnlineMetadataMatchDetails(
  result: OnlineMetadataMatchCandidate,
  lyrics: OnlineLyricsResult[],
  hints: OnlineMetadataSearchHints,
  durationHint?: number
): OnlineMetadataMatchDetails {
  const details = calculateOnlineMetadataMatchDetails(result, lyrics, hints, durationHint);
  return {
    titleMatched: details.titleMatched,
    artistMatched: details.artistMatched,
    albumMatched: details.albumMatched,
    similarityPercent: details.similarityPercent
  };
}

function compareOnlineMetadataMatchDetails(
  left: ReturnType<typeof calculateOnlineMetadataMatchDetails>,
  right: ReturnType<typeof calculateOnlineMetadataMatchDetails>
): number {
  return right.titleRank - left.titleRank ||
    right.titleSimilarity - left.titleSimilarity ||
    left.liveOrConcertPenalty - right.liveOrConcertPenalty ||
    right.sameTrackRecording - left.sameTrackRecording ||
    right.artistRank - left.artistRank ||
    right.albumRank - left.albumRank ||
    right.trackMatch - left.trackMatch ||
    right.yearMatch - left.yearMatch ||
    right.lyricsDurationMatch - left.lyricsDurationMatch ||
    right.scriptMatch - left.scriptMatch;
}

export function sortOnlineLyricsResults(
  results: OnlineLyricsResult[],
  hints: OnlineMetadataSearchHints,
  durationHint?: number
): OnlineLyricsResult[] {
  return [...results].sort((left, right) =>
    compareOnlineMetadataMatchDetails(
      calculateOnlineMetadataMatchDetails(left, [], hints, durationHint),
      calculateOnlineMetadataMatchDetails(right, [], hints, durationHint)
    )
  );
}

function isSelfTitledAlbum(value: string): boolean {
  return ['同名專輯', '同名专辑', 'self titled', 'self titled album', 'eponymous']
    .includes(normalizeWithoutEdition(value));
}

function matchesExpectedScript(value: string, expected: string): number {
  const hasCjk = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
  const expectedHasCjk = hasCjk(expected);
  const valueHasCjk = hasCjk(value);
  return Number(expectedHasCjk === valueHasCjk);
}

export function sortOnlineMetadataResults(
  results: OnlineMetadataResult[],
  lyrics: OnlineLyricsResult[],
  hints: OnlineMetadataSearchHints
): OnlineMetadataResult[] {
  const regionPriority: Record<NonNullable<OnlineMetadataResult['country']>, number> = {
    TW: 0,
    HK: 1,
    US: 2,
    JP: 2,
    GB: 2,
    CA: 2,
    AU: 2,
    SG: 2
  };
  return [...results].sort((left, right) => {
    const leftMatch = calculateOnlineMetadataMatchDetails(left, lyrics, hints);
    const rightMatch = calculateOnlineMetadataMatchDetails(right, lyrics, hints);
    return compareOnlineMetadataMatchDetails(leftMatch, rightMatch) ||
      (left.country ? regionPriority[left.country] : 3) -
        (right.country ? regionPriority[right.country] : 3);
  });
}
