import { describe, expect, it } from 'vitest';
import type { ElectronVideoFormat } from '../../src/electron/electronApi';
import { recommendVideoFormats } from '../../src/renderer/tools/videoFormatRecommendations';

const format = (overrides: Partial<ElectronVideoFormat>): ElectronVideoFormat => ({
  formatId: 'video',
  extension: 'mp4',
  resolution: '1280x720',
  note: '',
  videoCodec: 'avc1',
  audioCodec: 'none',
  fileSize: null,
  hasVideo: true,
  hasAudio: false,
  ...overrides
});

describe('video format recommendations', () => {
  const formats = [
    format({ formatId: 'audio-only', hasVideo: false, hasAudio: true }),
    format({ formatId: '720p', resolution: '1280x720' }),
    format({ formatId: '1080p', resolution: '1920x1080' }),
    format({ formatId: '1440p-ai', resolution: '2560x1440', note: 'AI-upscaled' }),
    format({ formatId: '360p', resolution: '640x360' })
  ];

  it('returns the top three non-upscaled video formats by resolution by default', () => {
    expect(recommendVideoFormats(formats, false).map(item => item.formatId)).toEqual([
      '1080p',
      '720p',
      '360p'
    ]);
  });

  it('includes AI-upscaled formats when opted in and honors a result limit', () => {
    expect(recommendVideoFormats(formats, true, 3).map(item => item.formatId)).toEqual([
      '1440p-ai',
      '1080p',
      '720p'
    ]);
    expect(recommendVideoFormats(formats, true, 0)).toEqual([]);
  });
});
