import type { ElectronKaraokeSubtitleLine } from '../../electron/electronApi';

export function updateKaraokeLineBoundary(
  lines: ElectronKaraokeSubtitleLine[],
  lineIndex: number,
  boundaryIndex: number,
  requestedTime: number,
  duration: number
): ElectronKaraokeSubtitleLine[] {
  const line = lines[lineIndex];
  if (!line || !Number.isFinite(requestedTime) || !Number.isFinite(duration) || duration < 0) return lines;
  const characterCount = line.characters.length;
  if (boundaryIndex < 0 || boundaryIndex > characterCount || characterCount === 0) return lines;

  const boundaries = [
    line.start,
    ...line.characters.slice(1).map(character => character.start),
    line.end
  ];
  const previousLineEnd = lines[lineIndex - 1]?.end ?? 0;
  const nextLineStart = lines[lineIndex + 1]?.characters[0]?.start;
  const videoEnd = duration > 0 ? duration : line.end;
  const lowerBound = boundaryIndex === 0 ? previousLineEnd : boundaries[boundaryIndex - 1];
  const upperBound = boundaryIndex === characterCount
    ? Math.min(videoEnd, nextLineStart ?? videoEnd)
    : boundaries[boundaryIndex + 1];
  const time = Math.max(lowerBound, Math.min(upperBound, requestedTime));
  const characters = line.characters.map(character => ({ ...character }));

  if (boundaryIndex === 0) {
    characters[0].start = time;
  } else {
    characters[boundaryIndex - 1].end = time;
    if (boundaryIndex < characterCount) characters[boundaryIndex].start = time;
  }

  const updatedLine = {
    ...line,
    start: boundaryIndex === 0 ? time : line.start,
    end: boundaryIndex === characterCount ? time : line.end,
    characters
  };
  const updated = lines.slice();
  updated[lineIndex] = updatedLine;
  return updated;
}

export function formatKaraokeTime(seconds: number) {
  const safeTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeTime / 60);
  const remainingSeconds = safeTime - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainingSeconds.toFixed(2).padStart(5, '0')}`;
}

export function formatKaraokeTimestamp(seconds: number) {
  const safeTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const milliseconds = Math.round(safeTime * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const wholeSeconds = Math.floor(milliseconds / 1000) % 60;
  const fraction = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
}

export function parseKaraokeTimestamp(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds : null;
  }

  const match = trimmed.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[4] || '').padEnd(3, '0'));
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function getKaraokeTimelineWindow(line: ElectronKaraokeSubtitleLine, duration: number) {
  const minimum = Math.max(0, line.start - 2);
  const maximum = Math.min(duration || line.end + 2, Math.max(line.end + 2, line.start + 1));
  return { minimum, maximum: Math.max(minimum + 0.1, maximum) };
}
