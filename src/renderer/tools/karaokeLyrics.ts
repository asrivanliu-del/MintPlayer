export type TimedLyricLine = {
  time: number;
  text: string;
};

export type KaraokeLyricsSearchHints = {
  title: string;
  artist: string;
  album: string;
};

export function parseLrc(contents: string): TimedLyricLine[] {
  if (contents.length > 256 * 1024) throw new Error('LRC text must be 256 KB or smaller.');
  const lines: TimedLyricLine[] = [];
  let offset = 0;
  const timestampPattern = /\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;

  for (const sourceLine of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const offsetMatch = sourceLine.match(/^\s*\[offset:([+-]?\d+)\]\s*$/i);
    if (offsetMatch) {
      offset = Number(offsetMatch[1]) / 1000;
      continue;
    }

    timestampPattern.lastIndex = 0;
    const timestamps: number[] = [];
    let textStart = 0;
    let match: RegExpExecArray | null;
    while ((match = timestampPattern.exec(sourceLine))) {
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      timestamps.push(Number(match[1]) * 60 + Number(match[2]) + fraction);
      textStart = match.index + match[0].length;
    }
    if (!timestamps.length) continue;

    const text = sourceLine.slice(textStart).trim();
    if (!text) continue;
    for (const time of timestamps) {
      lines.push({ time: Math.max(0, time + offset), text });
      if (lines.length > 5000) throw new Error('LRC files may contain at most 5,000 timed lines.');
    }
  }

  return lines.sort((left, right) => left.time - right.time);
}

function getVideoRelativePath(videoPath: string, mediaLibraryPath: string) {
  const separator = videoPath.includes('\\') ? '\\' : '/';
  const normalizedPath = videoPath.replace(/[\\/]/g, separator);
  const normalizedRoot = mediaLibraryPath.replace(/[\\/]/g, separator).replace(/[\\/]+$/, '');
  const rootPrefix = `${normalizedRoot}${separator}`;
  const isInLibrary = Boolean(normalizedRoot) &&
    normalizedPath.toLocaleLowerCase().startsWith(rootPrefix.toLocaleLowerCase());
  return {
    separator,
    normalizedPath,
    normalizedRoot,
    isInLibrary,
    relativePath: isInLibrary ? normalizedPath.slice(rootPrefix.length) : normalizedPath
  };
}

function getSourceFolderIndex(parts: string[]) {
  return parts.findIndex((part, index) =>
    index < parts.length - 1 && /^(music|video)$/i.test(part));
}

export function getMatchingMusicBasePath(mediaPath: string, mediaLibraryPath: string): string | null {
  const { separator, normalizedPath, normalizedRoot, isInLibrary, relativePath } =
    getVideoRelativePath(mediaPath, mediaLibraryPath);
  const parts = relativePath.split(separator);
  const sourceIndex = getSourceFolderIndex(parts);
  const filename = parts[parts.length - 1] || '';
  if (sourceIndex < 0 || !/\.(mp3|flac|wav|mp4)$/i.test(filename)) return null;

  if (parts[sourceIndex].toLocaleLowerCase() === 'video') {
    parts[sourceIndex] = 'Music';
    parts[parts.length - 1] = filename.replace(/\.mp4$/i, '');
  } else {
    parts[parts.length - 1] = filename.replace(/\.[^.]+$/, '');
  }
  const musicPath = parts.join(separator);
  return isInLibrary ? `${normalizedRoot}${separator}${musicPath}` : musicPath;
}

export function getKaraokeLyricsSearchHints(
  mediaPath: string,
  mediaLibraryPath: string
): KaraokeLyricsSearchHints {
  const { separator, relativePath } = getVideoRelativePath(mediaPath, mediaLibraryPath);
  const parts = relativePath.split(separator);
  const filename = parts[parts.length - 1] || '';
  const title = filename.replace(/\.[^.]+$/, '');
  const sourceIndex = getSourceFolderIndex(parts);
  if (sourceIndex < 0) return { title, artist: '', album: '' };
  return {
    title,
    artist: parts[sourceIndex + 1] || '',
    album: parts.slice(sourceIndex + 2, -1).join(' - ')
  };
}
