import { describe, expect, it, vi } from 'vitest';
import {
  hasElectronCapability,
  parseChooseFilesResult,
  parseChooseFolderFilesResult,
  parseChooseFolderResult,
  parseElectronApiResult
} from '../../src/electron/electronApi';

describe('hasElectronCapability', () => {
  it('recognizes an available bridge method', () => {
    const api = { readFile: vi.fn() };

    expect(hasElectronCapability(api, 'readFile')).toBe(true);
  });

  it('rejects a missing bridge or method', () => {
    expect(hasElectronCapability(undefined, 'readFile')).toBe(false);
    expect(hasElectronCapability({}, 'readFile')).toBe(false);
    expect(hasElectronCapability({ readFile: undefined }, 'readFile')).toBe(false);
  });
});

describe('Electron API response parsing', () => {
  it('accepts a valid success response and preserves an IPC failure', () => {
    expect(parseElectronApiResult<{ path: string }>(
      { ok: true, path: 'C:\\music\\track.mp3' },
      'save-playlist',
      value => typeof value.path === 'string'
    )).toEqual({ ok: true, path: 'C:\\music\\track.mp3' });

    expect(parseElectronApiResult<{ path: string }>(
      { ok: false, error: 'disk unavailable' },
      'save-playlist',
      value => typeof value.path === 'string'
    )).toEqual({ ok: false, error: 'disk unavailable' });
  });

  it('throws when the IPC envelope or expected success payload is malformed', () => {
    expect(() => parseElectronApiResult(
      { path: 'C:\\music\\track.mp3' },
      'save-playlist',
      value => typeof value.path === 'string'
    )).toThrow('invalid response envelope');

    expect(() => parseElectronApiResult(
      { ok: true },
      'save-playlist',
      value => typeof value.path === 'string'
    )).toThrow('invalid success response');
  });

  it('validates folder chooser output, including cancellation failures', () => {
    expect(parseChooseFolderResult({ canceled: false, paths: ['C:\\music'] }))
      .toEqual({ canceled: false, paths: ['C:\\music'] });
    expect(parseChooseFolderResult({ canceled: true, error: 'dialog failed' }))
      .toEqual({ canceled: true, error: 'dialog failed' });
    expect(() => parseChooseFolderResult({ canceled: false, paths: 'C:\\music' }))
      .toThrow('invalid response');
  });

  it('validates file chooser output', () => {
    expect(parseChooseFilesResult({ canceled: false, paths: ['C:\\music\\track.mp3'] }))
      .toEqual({ canceled: false, paths: ['C:\\music\\track.mp3'] });
    expect(parseChooseFilesResult({ canceled: true, paths: [] }))
      .toEqual({ canceled: true, paths: [] });
    expect(() => parseChooseFilesResult({ canceled: false, paths: 'C:\\music\\track.mp3' }))
      .toThrow('invalid response');
  });

  it('validates folder audio file chooser output', () => {
    expect(parseChooseFolderFilesResult({ canceled: false, paths: ['C:\\music\\track.mp3'] }))
      .toEqual({ canceled: false, paths: ['C:\\music\\track.mp3'] });
    expect(parseChooseFolderFilesResult({ canceled: true, paths: [] }))
      .toEqual({ canceled: true, paths: [] });
    expect(() => parseChooseFolderFilesResult({ canceled: false, paths: 'C:\\music\\track.mp3' }))
      .toThrow('invalid response');
  });
});
