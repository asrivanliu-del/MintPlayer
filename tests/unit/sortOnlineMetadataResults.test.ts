import { describe, expect, it } from 'vitest';
import type { OnlineLyricsResult, OnlineMetadataResult, TrackPathHints } from '../../src/renderer/types';
import {
  getOnlineMetadataMatchDetails,
  sortOnlineLyricsResults,
  sortOnlineMetadataResults
} from '../../src/renderer/metadata/sortOnlineMetadataResults';

const hints: TrackPathHints = {
  title: '尚好的青春',
  artist: '孫燕姿',
  album: '克卜勒',
  year: '2014',
  track: '4'
};

function result(
  id: number,
  values: Partial<OnlineMetadataResult> & Pick<OnlineMetadataResult, 'trackName' | 'artistName' | 'albumName'>
): OnlineMetadataResult {
  return {
    id,
    trackName: values.trackName,
    artistName: values.artistName,
    albumName: values.albumName,
    year: values.year ?? '',
    trackNumber: values.trackNumber ?? '',
    albumArtist: values.albumArtist ?? values.artistName,
    artworkUrl: '',
    duration: values.duration ?? null,
    country: values.country ?? 'TW'
  };
}

function lyricsResult(
  id: number,
  values: Partial<OnlineLyricsResult> & Pick<OnlineLyricsResult, 'trackName' | 'artistName' | 'albumName'>
): OnlineLyricsResult {
  return {
    id,
    trackName: values.trackName,
    artistName: values.artistName,
    albumName: values.albumName,
    duration: values.duration ?? null,
    plainLyrics: values.plainLyrics ?? 'Lyrics',
    syncedLyrics: values.syncedLyrics ?? '',
    source: values.source ?? 'LRCLIB'
  };
}

describe('sortOnlineMetadataResults', () => {
  it('scores all five criteria to 100 and marks title, artist, and album matches', () => {
    const exact = result(1, {
      trackName: '尚好的青春',
      artistName: '孫燕姿',
      albumName: '克卜勒',
      year: '2014',
      trackNumber: '4'
    });

    expect(getOnlineMetadataMatchDetails(exact, [], hints)).toEqual({
      titleMatched: true,
      artistMatched: true,
      albumMatched: true,
      similarityPercent: 100
    });
  });

  describe('sortOnlineLyricsResults', () => {
    it('ranks title, artist, and album matches and recognizes Live title variants', () => {
      const original = lyricsResult(1, {
        trackName: '尚好的青春',
        artistName: '孫燕姿',
        albumName: '克卜勒'
      });
      const live = lyricsResult(2, {
        trackName: '尚好的青春 (Live Concert)',
        artistName: '孫燕姿',
        albumName: '克卜勒'
      });
      const unrelated = lyricsResult(3, {
        trackName: '完全不同',
        artistName: 'Different artist',
        albumName: 'Different album'
      });

      expect(sortOnlineLyricsResults([live, unrelated, original], hints))
        .toEqual([original, live, unrelated]);
      expect(getOnlineMetadataMatchDetails(live, [], hints)).toEqual({
        titleMatched: true,
        artistMatched: true,
        albumMatched: true,
        similarityPercent: 87
      });
    });

    it('uses the current track duration as a same-recording hint when available', () => {
      const exact = lyricsResult(1, {
        trackName: '尚好的青春',
        artistName: '孫燕姿',
        albumName: '克卜勒',
        duration: 180
      });

      expect(getOnlineMetadataMatchDetails(exact, [], hints, 180).similarityPercent).toBe(100);
      expect(sortOnlineLyricsResults([
        lyricsResult(2, {
          trackName: '尚好的青春',
          artistName: '孫燕姿',
          albumName: '克卜勒',
          duration: 240
        }),
        exact
      ], hints, 180)).toEqual([exact, expect.objectContaining({ id: 2 })]);
    });
  });

  it('marks a Live version as a title match but gives the original version a higher score', () => {
    const live = result(1, {
      trackName: '尚好的青春 (Live ver.)',
      artistName: '孫燕姿',
      albumName: '克卜勒',
      year: '2014',
      trackNumber: '4'
    });

    expect(getOnlineMetadataMatchDetails(live, [], hints)).toEqual({
      titleMatched: true,
      artistMatched: true,
      albumMatched: true,
      similarityPercent: 97
    });
  });

  it('counts an artist self-titled album as an album match', () => {
    const selfTitledAlbum = result(1, {
      trackName: '尚好的青春',
      artistName: '孫燕姿',
      albumName: '同名專輯'
    });

    expect(getOnlineMetadataMatchDetails(selfTitledAlbum, [], {
      ...hints,
      album: '孫燕姿'
    })).toMatchObject({
      albumMatched: true,
      similarityPercent: 90
    });
  });

  it('returns zero similarity and unfilled match indicators for unrelated metadata', () => {
    const unrelated = result(1, {
      trackName: '完全不同',
      artistName: 'Different artist',
      albumName: 'Different album'
    });

    expect(getOnlineMetadataMatchDetails(unrelated, [], hints)).toEqual({
      titleMatched: false,
      artistMatched: false,
      albumMatched: false,
      similarityPercent: 0
    });
  });

  it('sorts catalog-only results without a regional Apple Music market', () => {
    const appleResult = result(1, {
      trackName: '尚好的青春',
      artistName: '孫燕姿',
      albumName: '克卜勒',
      year: '2014',
      trackNumber: '4'
    });
    const discogsResult = {
      ...result(2, {
        trackName: '尚好的青春',
        artistName: '孫燕姿',
        albumName: '克卜勒',
        year: '2014',
        trackNumber: '4'
      }),
      country: undefined
    };

    expect(sortOnlineMetadataResults([discogsResult, appleResult], [], hints))
      .toEqual([appleResult, discogsResult]);
  });

  it('ranks the exact title, same track in another language, matching artist and album, then unrelated results', () => {
    const exact = result(1, {
      trackName: '尚好的青春',
      artistName: '孫燕姿',
      albumName: '克卜勒',
      year: '2014',
      trackNumber: '4'
    });
    const chineseAlbumTrack = result(2, {
      trackName: '克卜勒',
      artistName: '孫燕姿',
      albumName: '克卜勒',
      year: '2014',
      trackNumber: '1'
    });
    const translatedSameTrack = result(3, {
      trackName: 'Best Days of My Youth',
      artistName: 'Yanzi Sun',
      albumName: 'Kepler',
      year: '2014',
      trackNumber: '4',
      country: 'US'
    });
    const englishAlbumTrack = result(4, {
      trackName: 'Kepler',
      artistName: 'Yanzi Sun',
      albumName: 'Kepler',
      year: '2014',
      trackNumber: '1',
      country: 'US'
    });
    const unrelatedLive = result(5, {
      trackName: '剋蔔勒 (live版)',
      artistName: "Zhou Shen & COM'Z",
      albumName: '天賜的聲音第三季 第1期',
      year: '2022',
      trackNumber: '1'
    });

    expect(sortOnlineMetadataResults(
      [chineseAlbumTrack, englishAlbumTrack, unrelatedLive, translatedSameTrack, exact],
      [],
      hints
    )).toEqual([exact, translatedSameTrack, chineseAlbumTrack, englishAlbumTrack, unrelatedLive]);
  });

  it('ranks original recordings ahead of matching live and concert versions', () => {
    const live = result(1, {
      trackName: '尚好的青春 (Live ver.)',
      artistName: '孫燕姿',
      albumName: '克卜勒',
      year: '2014',
      trackNumber: '4'
    });
    const concert = result(2, {
      trackName: '尚好的青春 (2020 Concert)',
      artistName: '孫燕姿',
      albumName: '演唱會',
      year: '2020',
      trackNumber: '3'
    });
    const original = result(3, {
      trackName: '尚好的青春',
      artistName: '孫燕姿',
      albumName: '克卜勒',
      year: '2014',
      trackNumber: '4'
    });

    expect(sortOnlineMetadataResults([live, concert, original], [], hints))
      .toEqual([original, live, concert]);
  });

  it('uses title similarity before artist and album matches', () => {
    const similarTitle = result(1, {
      trackName: '尚好的青唇',
      artistName: 'Different artist',
      albumName: 'Different album'
    });
    const sameArtist = result(2, {
      trackName: '完全不同的歌',
      artistName: '孫燕姿',
      albumName: '克卜勒'
    });

    expect(sortOnlineMetadataResults([sameArtist, similarTitle], [], hints))
      .toEqual([similarTitle, sameArtist]);
  });

  it('prioritizes a matching title over an artist match', () => {
    const matchingTitle = result(1, {
      trackName: '尚好的青春',
      artistName: 'Different artist',
      albumName: 'Different album'
    });
    const matchingArtist = result(2, {
      trackName: 'A different song',
      artistName: '孫燕姿',
      albumName: '克卜勒'
    });

    expect(sortOnlineMetadataResults([matchingArtist, matchingTitle], [], hints))
      .toEqual([matchingTitle, matchingArtist]);
  });

  it('does not treat a track number without a matching year as the same recording', () => {
    const sameTrackNumber = result(1, {
      trackName: 'Best Days of My Youth',
      artistName: 'Yanzi Sun',
      albumName: 'Kepler',
      year: '2020',
      trackNumber: '4',
      country: 'US'
    });
    const matchingArtist = result(2, {
      trackName: 'A different song',
      artistName: '孫燕姿',
      albumName: 'Another album',
      year: '2014'
    });

    expect(sortOnlineMetadataResults([sameTrackNumber, matchingArtist], [], hints))
      .toEqual([matchingArtist, sameTrackNumber]);
  });
});
