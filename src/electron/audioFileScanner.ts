import fs from 'fs';
import path from 'path';

const AUDIO_FILE_PATTERN = /\.(mp3|flac|wav|mp4)$/i;
const GENERATED_STEM_PATTERN = /_(?:backingtrack|vocals)\.(mp3|flac|wav)$/i;

export type SeparatedStemOutputPaths = {
  vocalsPath: string;
  accompanimentPath: string;
};

export function getSeparatedStemOutputPaths(filePath: string, outputRoot: string): SeparatedStemOutputPaths {
  if (!filePath.trim() || !outputRoot.trim()) {
    throw new Error('An audio file and media library root are required.');
  }

  const sourcePath = path.resolve(filePath);
  const rootPath = path.resolve(outputRoot);
  const relativeDirectory = path.relative(rootPath, path.dirname(sourcePath));
  if (
    path.isAbsolute(relativeDirectory) ||
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${path.sep}`)
  ) {
    throw new Error('The audio file is outside the media library root.');
  }

  const sourceDirectories = relativeDirectory.split(path.sep).filter(Boolean);
  const sourceCategory = /^(music|video)$/i.exec(sourceDirectories[0] || '')?.[1];
  if (/^(?:music|video|karaoke)$/i.test(sourceDirectories[0] || '')) sourceDirectories.shift();
  const outputRelativeDirectory = path.join(...sourceDirectories);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const sourceName = sourceCategory?.toLocaleLowerCase() === 'video' ? 'Video' : 'Music';
  const vocalsDirectory = sourceCategory ? `${sourceName}_Vocals` : 'Vocals';
  const accompanimentDirectory = sourceCategory ? `${sourceName}_Accompaniments` : 'Accompaniments';
  return {
    vocalsPath: path.join(rootPath, vocalsDirectory, outputRelativeDirectory, `${baseName}.wav`),
    accompanimentPath: path.join(rootPath, accompanimentDirectory, outputRelativeDirectory, `${baseName}.wav`)
  };
}

export function scanAudioFiles(folderPath: string, recursive: boolean): string[] {
  const normalizedPath = typeof folderPath === 'string' ? folderPath.trim() : '';
  if (!normalizedPath) throw new Error('Choose a folder to scan.');

  const rootPath = path.resolve(normalizedPath);
  if (!fs.statSync(rootPath).isDirectory()) {
    throw new Error('The selected path is not a folder.');
  }

  const files: string[] = [];
  const walk = (directory: string, isRoot = false) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const outputDirectory = isRoot && /^(?:vocals?|accompaniments?|music_(?:vocals|accompaniments)|video_(?:vocals|accompaniments))$/i.test(entry.name);
        if (recursive && !outputDirectory && !entry.name.toLowerCase().endsWith('_stems')) {
          walk(entryPath);
        }
        continue;
      }
      if (
        entry.isFile() &&
        AUDIO_FILE_PATTERN.test(entry.name) &&
        !GENERATED_STEM_PATTERN.test(entry.name)
      ) {
        files.push(entryPath);
      }
    }
  };

  walk(rootPath, true);
  return files;
}
