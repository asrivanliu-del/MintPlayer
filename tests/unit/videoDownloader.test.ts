import { describe, expect, it } from 'vitest';
import {
  createVideoMp4DownloadArgs,
  createVideoDownloadArgs,
  createVideoInfoArgs,
  createYouTubeSearchArgs,
  createBilibiliSearchUrl,
  createThumbnailDownloadArgs,
  getMediaDownloadsDirectory,
  getVideoFormatErrorMessage,
  parseYtDlpProgressLine,
  parseYtDlpMediaInfo,
  parseYtDlpSearchResults,
  parseBilibiliSearchResults,
  parseYtDlpInfo,
  searchBilibili,
  selectHighestQualityThumbnail,
  validateVideoUrl
} from '../../src/electron/videoDownloader';
import { isAiUpscaledVideoFormat } from '../../src/renderer/tools/videoFormatUtils';

describe('video downloader format parsing', () => {
  it('creates bounded platform searches and parses up to six results', async () => {
    const args = createYouTubeSearchArgs('  mint chocolate  ');
    expect(args).toContain('ytsearch6:mint chocolate');
    expect(args).toContain('--flat-playlist');
    expect(() => createYouTubeSearchArgs(' ')).toThrow('1 to 200 characters');
    expect(() => createYouTubeSearchArgs('a'.repeat(201))).toThrow('1 to 200 characters');
    const bilibiliSearchUrl = createBilibiliSearchUrl('  mint chocolate  ');
    expect(bilibiliSearchUrl.searchParams.get('keyword')).toBe('mint chocolate');
    expect(bilibiliSearchUrl.searchParams.get('search_type')).toBe('video');
    expect(bilibiliSearchUrl.searchParams.get('Search_key')).toBe('mint chocolate');
    expect(bilibiliSearchUrl.searchParams.get('__refresh__')).toBe('true');
    expect(() => createBilibiliSearchUrl(' ')).toThrow('1 to 200 characters');

    const results = parseYtDlpSearchResults(JSON.stringify({
      entries: Array.from({ length: 8 }, (_, index) => ({
        id: `video-${index + 1}`,
        title: `Video ${index + 1}`,
        thumbnails: [{ url: `https://img.example.com/${index + 1}.jpg` }]
      }))
    }));
    expect(results).toHaveLength(6);
    expect(results[0]).toEqual({
      id: 'video-1',
      url: 'https://www.youtube.com/watch?v=video-1',
      title: 'Video 1',
      thumbnailUrl: 'https://img.example.com/1.jpg'
    });

    const bilibiliResults = parseBilibiliSearchResults({
      code: 0,
      message: 'OK',
      data: {
        result: [
          { bvid: 'BV123abc', title: '<em>Mint</em> &amp; Chocolate', pic: 'http://i0.hdslb.com/bfs/archive/video.jpg' },
          { bvid: 'BV456def', title: 'No safe thumbnail', pic: 'http://img.example.com/unsafe.jpg' },
          { bvid: 'invalid', title: 'Invalid ID', pic: 'http://img.example.com/unsafe.jpg' }
        ]
      }
    });
    expect(bilibiliResults).toEqual([{
      id: 'BV123abc',
      url: 'https://www.bilibili.com/video/BV123abc',
      title: 'Mint & Chocolate',
      thumbnailUrl: 'https://i0.hdslb.com/bfs/archive/video.jpg'
    }, {
      id: 'BV456def',
      url: 'https://www.bilibili.com/video/BV456def',
      title: 'No safe thumbnail',
      thumbnailUrl: null
    }]);

    const request: { url?: URL; headers?: HeadersInit } = {};
    const fetcher: typeof fetch = async (input, init) => {
      request.url = new URL(input.toString());
      request.headers = init?.headers;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        data: { result: [{ bvid: 'BV123abc', title: 'Mint & Chocolate', pic: '//i0.hdslb.com/bfs/archive/video.jpg' }] }
      }), { status: 200 });
    };
    expect(await searchBilibili('mint chocolate', fetcher)).toHaveLength(1);
    expect(request.url?.searchParams.get('keyword')).toBe('mint chocolate');
    expect(request.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
      Cookie: expect.stringMatching(/^buvid3=[0-9a-f-]+infoc$/i)
    });
  });

  it('parses yt-dlp download percentage lines', () => {
    expect(parseYtDlpProgressLine('MEDIA_PROGRESS:38.6')).toBe(38.6);
    expect(parseYtDlpProgressLine('MEDIA_PROGRESS:  38.6%')).toBe(38.6);
    expect(parseYtDlpProgressLine('MEDIA_PROGRESS:100.0')).toBe(100);
    expect(parseYtDlpProgressLine('[download]  38.6% of 10.00MiB at 1.00MiB/s ETA 00:06')).toBe(38.6);
    expect(parseYtDlpProgressLine('[download]  5.2% of ~10.00MiB at 1.00MiB/s ETA 00:06')).toBe(5.2);
    expect(parseYtDlpProgressLine('[download] 100% of 10.00MiB')).toBe(100);
    expect(parseYtDlpProgressLine('[download] Destination: sample.mp4')).toBeNull();
    expect(parseYtDlpProgressLine('[download] 101%')).toBe(100);
  });

  it('selects the highest-resolution HTTPS thumbnail', () => {
    expect(selectHighestQualityThumbnail({
      thumbnail: 'https://img.example.com/default.jpg',
      thumbnails: [
        { url: 'https://img.example.com/small.jpg', width: 120, height: 90 },
        { url: 'https://img.example.com/large.jpg', width: 1280, height: 720 },
        { url: 'file:///secret.jpg', width: 4000, height: 3000 }
      ]
    })).toBe('https://img.example.com/large.jpg');
    expect(selectHighestQualityThumbnail({
      thumbnail: 'https://img.example.com/default.jpg',
      thumbnails: [{ url: 'file:///secret.jpg', width: 4000, height: 3000 }]
    })).toBe('https://img.example.com/default.jpg');
  });

  it('classifies audio-only, video-only, and combined formats', () => {
    const result = parseYtDlpInfo(JSON.stringify({
      title: 'Sample video',
      thumbnails: [
        { url: 'https://img.example.com/low.jpg', width: 320, height: 180 },
        { url: 'https://img.example.com/high.jpg', width: 1920, height: 1080 }
      ],
      duration: 120,
      formats: [
        { format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 128, asr: 48000, audio_channels: 2, filesize: 1024 },
        { format_id: '251', ext: 'webm', acodec: 'opus', vcodec: 'none', tbr: '160', filesize_approx: '2400000' },
        { format_id: '137', ext: 'mp4', acodec: 'none', vcodec: 'avc1.640028', width: 1920, height: 1080 },
        { format_id: '22', ext: 'mp4', acodec: 'mp4a.40.2', vcodec: 'avc1.64001F', format_note: '720p', filesize_approx: 2048 }
      ]
    }));

    expect(result.title).toBe('Sample video');
    expect(result.thumbnailUrl).toBe('https://img.example.com/high.jpg');
    expect(result.formats).toEqual([
      expect.objectContaining({
        formatId: '140',
        resolution: 'Audio only',
        hasAudio: true,
        hasVideo: false,
        fileSize: 1024,
        audioBitrate: 128,
        sampleRate: 48000,
        audioChannels: 2,
        duration: 120
      }),
      expect.objectContaining({ formatId: '251', audioBitrate: 160, fileSize: 2400000 }),
      expect.objectContaining({ formatId: '137', resolution: '1920x1080', hasAudio: false, hasVideo: true, fileSize: null }),
      expect.objectContaining({ formatId: '22', note: '720p', hasAudio: true, hasVideo: true, fileSize: 2048 })
    ]);
  });

  it('rejects malformed or unsupported yt-dlp results', () => {
    expect(() => parseYtDlpInfo('not json')).toThrow('invalid format data');
    expect(() => parseYtDlpInfo(JSON.stringify({ title: 'No formats' })))
      .toThrow('did not return a list of formats');
  });

  it('parses flat playlist titles before per-video formats are requested', () => {
    const result = parseYtDlpMediaInfo(JSON.stringify({
      _type: 'playlist',
      title: 'Sample playlist',
      entries: [
        {
          id: 'video-1',
          extractor_key: 'Youtube',
          title: 'First video',
          url: 'video-1',
          thumbnails: [{ url: 'https://img.example.com/video-1.jpg', width: 320, height: 180 }]
        },
        {
          id: 'video-2',
          extractor_key: 'Youtube',
          title: 'Second video',
          url: 'video-2'
        },
        {
          id: 'unavailable',
          title: 'Unavailable video',
          formats: []
        }
      ]
    }));

    expect(result).toMatchObject({
      title: 'Sample playlist',
      entries: [
        {
          index: 1,
          id: 'video-1',
          url: 'https://www.youtube.com/watch?v=video-1',
          title: 'First video',
          thumbnailUrl: 'https://img.example.com/video-1.jpg',
          formats: [],
          formatsLoaded: false
        },
        {
          index: 2,
          id: 'video-2',
          url: 'https://www.youtube.com/watch?v=video-2',
          title: 'Second video',
          formats: [],
          formatsLoaded: false
        },
        {
          index: 3,
          id: 'unavailable',
          title: 'Unavailable video',
          formats: [],
          formatsLoaded: true,
          unavailableReason: 'yt-dlp did not provide a playable URL for this entry.'
        }
      ]
    });
  });

  it('recognizes YouTube AI-upscaled video formats from the format ID or note', () => {
    const format = {
      formatId: '247-sr',
      extension: 'webm',
      resolution: '960x720',
      note: '720p, AI-upscaled',
      videoCodec: 'vp9',
      audioCodec: 'none',
      fileSize: null,
      hasVideo: true,
      hasAudio: false
    };

    expect(isAiUpscaledVideoFormat(format)).toBe(true);
    expect(isAiUpscaledVideoFormat({ ...format, formatId: '398-sr', note: '' })).toBe(true);
    expect(isAiUpscaledVideoFormat({ ...format, formatId: '247', note: '720p, AI upscaled' })).toBe(true);
    expect(isAiUpscaledVideoFormat({ ...format, formatId: '247', note: '720p' })).toBe(false);
    expect(isAiUpscaledVideoFormat({ ...format, hasVideo: false })).toBe(false);
  });
});

describe('video downloader URL validation', () => {
  it('uses the media library Downloads subdirectory', () => {
    expect(getMediaDownloadsDirectory(' C:\\Media\\ ')).toBe('C:\\Media\\Downloads');
    expect(() => getMediaDownloadsDirectory('')).toThrow('valid absolute media library location');
    expect(() => getMediaDownloadsDirectory('relative\\media')).toThrow('valid absolute media library location');
  });

  it('trims and accepts HTTP and HTTPS URLs', () => {
    expect(validateVideoUrl(' https://example.com/watch?v=1 ')).toBe('https://example.com/watch?v=1');
    expect(validateVideoUrl('http://example.com/video')).toBe('http://example.com/video');
  });

  it('normalizes Bilibili English video URLs to the canonical route', () => {
    const suppliedUrl = 'https://www.bilibili.com/en/video/BV1S3d3Y8EYb/?spm_id_from=333.337.search-card.all.click';
    const canonicalUrl = 'https://www.bilibili.com/video/BV1S3d3Y8EYb?spm_id_from=333.337.search-card.all.click';

    expect(validateVideoUrl(suppliedUrl)).toBe(canonicalUrl);
    const infoArgs = createVideoInfoArgs(suppliedUrl);
    expect(infoArgs[infoArgs.length - 1]).toBe(canonicalUrl);
    const downloadArgs = createVideoDownloadArgs(suppliedUrl, '30080', 'C:\\Downloads', false);
    expect(downloadArgs[downloadArgs.length - 1])
      .toBe(canonicalUrl);
    const canonicalArgs = createVideoInfoArgs('https://www.bilibili.com/video/BV1S3d3Y8EYb');
    expect(canonicalArgs[canonicalArgs.length - 1]).toBe('https://www.bilibili.com/video/BV1S3d3Y8EYb');
    expect(validateVideoUrl('https://example.com/en/video/BV1S3d3Y8EYb'))
      .toBe('https://example.com/en/video/BV1S3d3Y8EYb');
  });

  describe('video downloader arguments', () => {
    it('requests playlist metadata without disabling playlist extraction', () => {
      const args = createVideoInfoArgs('https://example.com/playlist?id=sample');
      expect(args).toContain('--dump-single-json');
      expect(args).toContain('--skip-download');
      expect(args).toContain('--flat-playlist');
      expect(args).not.toContain('--no-playlist');
      expect(args[args.length - 1]).toBe('https://example.com/playlist?id=sample');
    });

    it('downloads the thumbnail into a temporary directory without requiring conversion', () => {
      const args = createThumbnailDownloadArgs(
        'https://example.com/watch?v=1',
        'C:\\Temp\\thumbnail'
      );
      expect(args).toContain('--write-thumbnail');
      expect(args).toContain('--skip-download');
      expect(args).toContain('C:\\Temp\\thumbnail');
      expect(args).not.toContain('--convert-thumbnails');
    });

    it('creates direct-format and MP3 download commands for the Downloads folder', () => {
      const direct = createVideoDownloadArgs(
        'https://example.com/watch?v=1',
        '251',
        'C:\\Users\\Test\\Downloads',
        false
      );
      expect(direct).toContain('--format');
      expect(direct).toContain('--newline');
      expect(direct).toContain('--progress');
      expect(direct[direct.indexOf('--progress-template') + 1])
        .toBe('download:MEDIA_PROGRESS:%(progress._percent_str)s');
      expect(direct[direct.indexOf('--progress-delta') + 1]).toBe('1');
      expect(direct).toContain('--encoding');
      expect(direct).toContain('UTF-8');
      expect(direct).toContain('--force-overwrites');
      expect(direct).not.toContain('--no-overwrites');
      expect(direct).toContain('251');
      expect(direct).toContain('--paths');
      expect(direct).toContain('C:\\Users\\Test\\Downloads');
      expect(direct).not.toContain('--extract-audio');

      const mp3 = createVideoDownloadArgs(
        'https://example.com/watch?v=1',
        '251',
        'C:\\Users\\Test\\Downloads',
        true
      );
      expect(mp3).toContain('--extract-audio');
      expect(mp3).toContain('--audio-format');
      expect(mp3).toContain('mp3');
      expect(mp3).toContain('320K');
    });

    it('rejects unsafe format IDs and explains missing FFmpeg', () => {
      expect(() => createVideoDownloadArgs(
        'https://example.com/video',
        '--exec',
        'C:\\Downloads',
        false
      )).toThrow('Invalid video format ID');
      expect(getVideoFormatErrorMessage('ERROR: ffmpeg not found')).toContain('requires FFmpeg');
    });

    it('downloads video as MP4 and merges the selected audio format when supplied', () => {
      const withAudio = createVideoMp4DownloadArgs(
        'https://example.com/watch?v=1',
        '137',
        '251',
        'C:\\Users\\Test\\Downloads'
      );
      expect(withAudio).toContain('--format');
      expect(withAudio[withAudio.indexOf('--format') + 1]).toBe('137+251');
      expect(withAudio).toContain('--remux-video');
      expect(withAudio).toContain('mp4');
      expect(withAudio).toContain('--force-overwrites');
      expect(withAudio).not.toContain('--no-overwrites');
      expect(withAudio[withAudio.indexOf('--progress-template') + 1])
        .toBe('download:MEDIA_PROGRESS:%(progress._percent_str)s');
      expect(withAudio).toContain('C:\\Users\\Test\\Downloads');

      const audioAlreadyIncluded = createVideoMp4DownloadArgs(
        'https://example.com/watch?v=1',
        '22',
        null,
        'C:\\Users\\Test\\Downloads'
      );
      expect(audioAlreadyIncluded[audioAlreadyIncluded.indexOf('--format') + 1]).toBe('22');
      expect(() => createVideoMp4DownloadArgs(
        'https://example.com/watch?v=1',
        '137',
        '--exec',
        'C:\\Users\\Test\\Downloads'
      )).toThrow('Invalid video or audio format ID');
    });
  });

  it('rejects blank, malformed, non-HTTP, and credential-bearing URLs', () => {
    expect(() => validateVideoUrl('  ')).toThrow('Enter a video URL first');
    expect(() => validateVideoUrl('not a url')).toThrow('valid HTTP or HTTPS');
    expect(() => validateVideoUrl('file:///C:/video.mp4')).toThrow('Only HTTP or HTTPS');
    expect(() => validateVideoUrl('https://user:pass@example.com/video')).toThrow('embedded credentials');
  });
});
