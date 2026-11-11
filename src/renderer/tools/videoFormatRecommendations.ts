import type { ElectronVideoFormat } from '../../electron/electronApi';
import { isAiUpscaledVideoFormat } from './videoFormatUtils';

function getResolutionScore(format: ElectronVideoFormat) {
  const dimensions = format.resolution.match(/(\d{2,5})\s*x\s*(\d{2,5})/i);
  if (dimensions) return Number(dimensions[1]) * Number(dimensions[2]);

  const height = `${format.resolution} ${format.note}`.match(/\b(\d{3,4})p\b/i);
  return height ? Number(height[1]) ** 2 : 0;
}

export function recommendVideoFormats(
  formats: ElectronVideoFormat[],
  includeAiUpscaled: boolean,
  limit = 3
) {
  return formats
    .filter(format => format.hasVideo && (includeAiUpscaled || !isAiUpscaledVideoFormat(format)))
    .map((format, index) => ({ format, index }))
    .sort((left, right) =>
      getResolutionScore(right.format) - getResolutionScore(left.format) ||
      Number(right.format.hasAudio) - Number(left.format.hasAudio) ||
      Number(right.format.extension === 'mp4') - Number(left.format.extension === 'mp4') ||
      left.index - right.index
    )
    .slice(0, Math.max(0, limit))
    .map(({ format }) => format);
}
