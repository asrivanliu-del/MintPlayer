import type { ElectronVideoFormat } from '../../electron/electronApi';

function getCodecEfficiency(codec: string) {
  const normalized = codec.toLowerCase();
  if (normalized.includes('opus')) return 1.2;
  if (normalized.includes('vorbis')) return 1.1;
  if (normalized.includes('flac') || normalized.includes('alac') || normalized.includes('pcm')) return 2;
  if (normalized.includes('mp3')) return 0.9;
  return 1;
}

function getQualityScore(format: ElectronVideoFormat) {
  return (getSourceAudioBitrate(format) ?? 0) * getCodecEfficiency(format.audioCodec);
}

export function getSourceAudioBitrate(format: ElectronVideoFormat) {
  if (format.audioBitrate != null) return format.audioBitrate;
  if (format.fileSize === null || format.fileSize <= 0 || format.duration == null || format.duration <= 0) {
    if (format.audioCodec.toLowerCase().includes('opus')) {
      const youtubeOpusBitrates: Record<string, number> = { '249': 50, '250': 70, '251': 160 };
      return youtubeOpusBitrates[format.formatId] ?? null;
    }
    return null;
  }
  return format.fileSize * 8 / format.duration / 1000;
}

function getMp3EquivalentBitrate(format: ElectronVideoFormat, sourceBitrate: number) {
  const codec = format.audioCodec.toLowerCase();
  if (codec.includes('opus')) return sourceBitrate * 2;
  if (codec.includes('vorbis')) return sourceBitrate * 1.5;
  if (codec.includes('flac') || codec.includes('alac') || codec.includes('pcm')) return 320;
  return sourceBitrate;
}

export function recommendAudioFormats(formats: ElectronVideoFormat[], limit = 3) {
  return formats
    .filter(format => format.hasAudio && !format.hasVideo)
    .map((format, index) => ({ format, index }))
    .sort((left, right) =>
      getQualityScore(right.format) - getQualityScore(left.format) ||
      (getSourceAudioBitrate(right.format) ?? 0) - (getSourceAudioBitrate(left.format) ?? 0) ||
      (right.format.sampleRate ?? 0) - (left.format.sampleRate ?? 0) ||
      (right.format.audioChannels ?? 0) - (left.format.audioChannels ?? 0) ||
      left.index - right.index
    )
    .slice(0, Math.max(0, limit))
    .map(({ format }) => format);
}

export function getMp3ConversionEstimate(format: ElectronVideoFormat) {
  const sourceBitrate = getSourceAudioBitrate(format);
  if (sourceBitrate == null) return null;

  const standardBitrates = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const estimatedMp3Bitrate = getMp3EquivalentBitrate(format, sourceBitrate);
  const bitrate = standardBitrates.find(value => value >= estimatedMp3Bitrate) ?? 320;
  const sampleRate = format.sampleRate == null ? null : Math.min(format.sampleRate, 48_000);
  const channels = format.audioChannels == null ? null : Math.min(format.audioChannels, 2);
  const fileSize = format.duration == null ? null : (bitrate * 1000 / 8) * format.duration;

  return { bitrate, sampleRate, channels, fileSize };
}
