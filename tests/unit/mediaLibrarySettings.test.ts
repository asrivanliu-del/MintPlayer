import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readMediaLibraryPath, writeMediaLibraryPath } from '../../src/electron/mediaLibrarySettings';

const temporaryDirectories: string[] = [];

function createUserDataDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mintplayer-settings-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('media library settings persistence', () => {
  it('reports when no saved path setting exists', () => {
    expect(readMediaLibraryPath(createUserDataDirectory())).toBeNull();
  });

  it('persists and reloads the configured path, including an explicit clear', () => {
    const userDataPath = createUserDataDirectory();
    writeMediaLibraryPath(userDataPath, 'C:\\Media');
    expect(readMediaLibraryPath(userDataPath)).toBe('C:\\Media');

    writeMediaLibraryPath(userDataPath, '');
    expect(readMediaLibraryPath(userDataPath)).toBe('');
  });

  it('reports corrupt saved settings instead of silently clearing them', () => {
    const userDataPath = createUserDataDirectory();
    fs.writeFileSync(path.join(userDataPath, 'media-library-path.json'), '{invalid', 'utf8');

    expect(() => readMediaLibraryPath(userDataPath)).toThrow();
  });
});
