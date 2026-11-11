import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTorrentDownloadManager,
  getAria2Arguments,
  validateTorrentSource,
  type TorrentDownloadEngine
} from '../../src/electron/torrentDownloader';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mintplayer-torrent-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createFakeEngine(getStatus: TorrentDownloadEngine['getStatus']): TorrentDownloadEngine & {
  add: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const exitListeners = new Set<(error: Error) => void>();
  return {
    add: vi.fn().mockResolvedValue('test-gid'),
    getStatus,
    remove: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onExit: listener => {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    }
  };
}

async function waitForProgress(
  progress: Array<{ status: string }>,
  expectedStatus: string
) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (progress.some(item => item.status === expectedStatus)) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for torrent status "${expectedStatus}".`);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('torrentDownloader', () => {
  it('uses loopback RPC with a secret and Windows preallocation without falloc', () => {
    const args = getAria2Arguments(45678, 'random-secret', 'win32');
    expect(args).toContain('--rpc-listen-all=false');
    expect(args).toContain('--rpc-listen-port=45678');
    expect(args).toContain('--rpc-secret=random-secret');
    expect(args).toContain('--file-allocation=prealloc');
    expect(args).not.toContain('--file-allocation=falloc');
    expect(getAria2Arguments(45678, 'random-secret', 'linux'))
      .not.toContain('--file-allocation=prealloc');
  });

  it('accepts supported magnet hashes and rejects malformed or unsupported links', async () => {
    await expect(validateTorrentSource({
      kind: 'magnet',
      uri: `magnet:?xt=urn:btih:${'a'.repeat(40)}`
    })).resolves.toMatchObject({ kind: 'magnet' });
    await expect(validateTorrentSource({
      kind: 'magnet',
      uri: 'magnet:?xt=urn:btih:invalid'
    })).rejects.toThrow('supported BitTorrent info hash');
    await expect(validateTorrentSource({
      kind: 'magnet',
      uri: `https://example.com/?xt=urn:btih:${'a'.repeat(40)}`
    })).rejects.toThrow('supported BitTorrent info hash');
    await expect(validateTorrentSource({
      kind: 'torrent-url',
      url: 'https://webtorrent.io/torrents/big-buck-bunny.torrent'
    })).resolves.toEqual({
      kind: 'torrent-url',
      url: 'https://webtorrent.io/torrents/big-buck-bunny.torrent'
    });
    await expect(validateTorrentSource({
      kind: 'torrent-url',
      url: 'http://webtorrent.io/torrents/big-buck-bunny.torrent'
    })).rejects.toThrow('HTTPS');
    await expect(validateTorrentSource({
      kind: 'torrent-url',
      url: 'https://example.com/not-a-torrent'
    })).rejects.toThrow('ending in .torrent');
  });

  it('accepts only non-empty local torrent files within the configured size limit', async () => {
    const directory = await createTemporaryDirectory();
    const torrentPath = path.join(directory, 'sample.torrent');
    await fs.writeFile(torrentPath, 'torrent data');
    await expect(validateTorrentSource({ kind: 'torrent', path: torrentPath }))
      .resolves.toEqual({ kind: 'torrent', path: await fs.realpath(torrentPath) });
    await expect(validateTorrentSource({ kind: 'torrent', path: path.join(directory, 'missing.txt') }))
      .rejects.toThrow('.torrent extension');
    await expect(validateTorrentSource({ kind: 'torrent', path: path.join(directory, 'missing.torrent') }))
      .rejects.toThrow('Unable to read');
  });

  it('downloads into the media library and stops the engine when seeding is disabled', async () => {
    const mediaLibraryPath = await createTemporaryDirectory();
    const progress: Array<{ status: string }> = [];
    const engine = createFakeEngine(vi.fn().mockResolvedValue({
      status: 'complete',
      totalLength: '1024',
      completedLength: '1024',
      files: [{ path: path.join(mediaLibraryPath, 'sample.mp3') }]
    }));
    const manager = createTorrentDownloadManager({
      createEngine: async () => engine,
      onProgress: update => progress.push(update)
    });

    const result = await manager.start(
      { kind: 'magnet', uri: `magnet:?xt=urn:btih:${'b'.repeat(40)}` },
      mediaLibraryPath,
      false
    );
    await waitForProgress(progress, 'completed');
    expect(manager.getProgress()).toMatchObject({ jobId: result.jobId, status: 'completed' });
    expect(result.outputDirectory).toBe(path.join(mediaLibraryPath, 'Torrent Downloads'));
    expect(await fs.stat(result.outputDirectory)).toBeTruthy();
    expect(engine.add).toHaveBeenCalledWith(
      { kind: 'magnet', uri: `magnet:?xt=urn:btih:${'b'.repeat(40)}` },
      result.outputDirectory
    );
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('fetches a direct .torrent URL into a temporary file before adding it to aria2', async () => {
    const mediaLibraryPath = await createTemporaryDirectory();
    const progress: Array<{ status: string }> = [];
    const fetchMock = vi.fn().mockResolvedValue(new Response('torrent payload', {
      status: 200,
      headers: { 'content-length': '15' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const engine = createFakeEngine(vi.fn().mockResolvedValue({
      status: 'active',
      totalLength: '100',
      completedLength: '0'
    }));
    engine.add.mockImplementation(async (source: { kind: string; path?: string }) => {
      expect(source.kind).toBe('torrent');
      expect(source.path).toBeTruthy();
      expect(await fs.readFile(source.path!, 'utf8')).toBe('torrent payload');
      return 'test-gid';
    });
    const manager = createTorrentDownloadManager({
      createEngine: async () => engine,
      onProgress: update => progress.push(update)
    });

    const result = await manager.start({
      kind: 'torrent-url',
      url: 'https://webtorrent.io/torrents/big-buck-bunny.torrent'
    }, mediaLibraryPath, false);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://webtorrent.io/torrents/big-buck-bunny.torrent',
      expect.objectContaining({ redirect: 'error' })
    );
    expect(engine.add).toHaveBeenCalled();
    expect(result.outputDirectory).toBe(path.join(mediaLibraryPath, 'Torrent Downloads'));
    expect(progress.some(item => item.status === 'starting')).toBe(true);
    await manager.stop(result.jobId);
    expect(manager.getProgress()).toMatchObject({ jobId: result.jobId, status: 'stopped' });
  });

  it('allows a single active torrent, keeps seeding when selected, and stops on request', async () => {
    const mediaLibraryPath = await createTemporaryDirectory();
    const progress: Array<{ status: string }> = [];
    const engine = createFakeEngine(vi.fn().mockResolvedValue({
      status: 'active',
      totalLength: '100',
      completedLength: '40'
    }));
    const manager = createTorrentDownloadManager({
      createEngine: async () => engine,
      onProgress: update => progress.push(update)
    });

    const result = await manager.start(
      { kind: 'magnet', uri: `magnet:?xt=urn:btih:${'c'.repeat(40)}` },
      mediaLibraryPath,
      true
    );
    await expect(manager.start(
      { kind: 'magnet', uri: `magnet:?xt=urn:btih:${'d'.repeat(40)}` },
      mediaLibraryPath,
      false
    )).rejects.toThrow('already active');
    await manager.stop(result.jobId);
    expect(engine.remove).toHaveBeenCalledWith('test-gid');
    expect(engine.close).toHaveBeenCalledTimes(1);
    expect(progress[progress.length - 1]?.status).toBe('stopped');
  });
});
