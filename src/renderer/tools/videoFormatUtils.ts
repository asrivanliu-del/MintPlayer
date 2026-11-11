import type { ElectronVideoFormat } from '../../electron/electronApi';

export function isAiUpscaledVideoFormat(format: ElectronVideoFormat) {
  return format.hasVideo &&
    (/-sr(?:$|[-.])/i.test(format.formatId) || /\bAI[-\s]?upscaled\b/i.test(format.note));
}
