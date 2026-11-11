import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

function getSettingsFilePath(userDataPath: string) {
  return path.join(userDataPath, 'media-library-path.json');
}

export function readMediaLibraryPath(userDataPath: string): string | null {
  const settingsPath = getSettingsFilePath(userDataPath);
  if (!fs.existsSync(settingsPath)) return null;

  const value: unknown = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (typeof value !== 'string') {
    throw new Error('Saved media library location has an invalid format.');
  }
  return value;
}

export function writeMediaLibraryPath(userDataPath: string, mediaLibraryPath: string) {
  if (typeof mediaLibraryPath !== 'string') {
    throw new Error('Media library location must be a string.');
  }

  const settingsPath = getSettingsFilePath(userDataPath);
  const temporaryPath = `${settingsPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(mediaLibraryPath), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, settingsPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (!isMissingFileError(cleanupError)) {
        console.warn('Unable to remove temporary media library settings file', cleanupError);
      }
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
