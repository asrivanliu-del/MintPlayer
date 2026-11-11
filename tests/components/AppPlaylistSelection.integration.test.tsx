import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';

vi.mock('../../src/renderer/lyrics/lyricsUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/lyrics/lyricsUtils')>();
  return {
    ...actual,
    toTraditionalLyrics: vi.fn(async (lyrics: string) => lyrics)
  };
});

const originalWindowDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
const originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

function setWindowProperty(property: PropertyKey, value: unknown) {
  if (!originalWindowDescriptors.has(property)) {
    originalWindowDescriptors.set(property, Object.getOwnPropertyDescriptor(window, property));
  }
  Object.defineProperty(window, property, { configurable: true, value });
}

const playlistTracks = [
  {
    id: 'track-one',
    name: 'First song.mp3',
    path: 'C:\\music\\first.mp3',
    bitrate: 192000
  },
  {
    id: 'track-two',
    name: 'Second song.mp3',
    path: 'C:\\music\\second.mp3',
    bitrate: 256000
  }
];

function installBrowserMocks(initialAudioContextState: 'running' | 'suspended' = 'running') {
  setWindowProperty('matchMedia', vi.fn().mockImplementation(() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));

  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  const audioContextResume = vi.fn();
  const audioDestination = {};
  const audioSourceConnect = vi.fn();
  const gainConnect = vi.fn();
  const pannerConnect = vi.fn();
  const analyserConnect = vi.fn();
  const audioGainNode = { gain: { value: 1 }, connect: gainConnect };
  const audioPannerNode = { pan: { value: 0 }, connect: pannerConnect };
  const audioAnalyserNode = {
    fftSize: 2048,
    connect: analyserConnect,
    getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(0.125))
  };

  class MockAudioContext {
    state = initialAudioContextState;
    currentTime = 0;
    sampleRate = 44100;
    destination = audioDestination;
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    createMediaElementSource = vi.fn(() => ({ connect: audioSourceConnect }));
    createScriptProcessor = vi.fn(() => ({
      connect: vi.fn(),
      onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null
    }));
    createAnalyser = vi.fn(() => audioAnalyserNode);
    createGain = vi.fn(() => audioGainNode);
    createStereoPanner = vi.fn(() => audioPannerNode);
    resume = audioContextResume;
    constructor() {
      audioContextResume.mockImplementation(async () => {
        this.state = 'running';
      });
    }
  }
  class MockAudioWorkletNode {
    port = { postMessage: vi.fn() };
    connect = vi.fn();
  }
  setWindowProperty('AudioContext', MockAudioContext);
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);

  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn()
  });
  return {
    audioContextResume,
    audioContext: {
      audioDestination,
      audioSourceConnect,
      gainConnect,
      pannerConnect,
      analyserConnect,
      audioGainNode,
      audioPannerNode,
      audioAnalyserNode
    }
  };
}

function renderApp(options: {
  strictMode?: boolean;
  readFile?: ReturnType<typeof vi.fn>;
  mediaFiles?: string[];
  savedMediaLibraryPath?: string;
  tracks?: Array<{
    id: string;
    name: string;
    path?: string;
    src?: string;
    cover?: string;
    bitrate?: number;
  }>;
} = {}) {
  const electronAPI = {
    loadPlaylists: vi.fn().mockResolvedValue({
      ok: true,
      playlists: [{ name: 'Integration playlist', tracks: options.tracks ?? playlistTracks }]
    }),
    loadMediaLibraryPath: vi.fn().mockResolvedValue({
      ok: true,
      path: options.savedMediaLibraryPath ?? null
    }),
    saveMediaLibraryPath: vi.fn().mockResolvedValue({ ok: true }),
    readdirRecursive: vi.fn().mockResolvedValue({ ok: true, files: options.mediaFiles ?? [] }),
    scanAudioFiles: vi.fn(async (): Promise<{ ok: boolean; files: string[]; error?: string }> => ({
      ok: true,
      files: []
    })),
    splitAudioStems: vi.fn(async (): Promise<{
      ok: boolean;
      vocalsPath?: string;
      accompanimentPath?: string;
      error?: string;
    }> => ({
      ok: true,
      vocalsPath: 'C:\\Media\\Music_Vocals\\track.wav',
      accompanimentPath: 'C:\\Media\\Music_Accompaniments\\track.wav'
    })),
    alignKaraokeSource: vi.fn().mockResolvedValue({
      ok: true,
      outputPath: 'C:\\Media\\karaoke\\Artist\\Album\\Song.ass'
    }),
    readKaraokeSubtitle: vi.fn().mockResolvedValue({
      ok: true,
      lines: [{
        start: 0,
        end: 5,
        text: '飛瀑',
        characters: [
          { text: '飛', start: 0, end: 2 },
          { text: '瀑', start: 2, end: 5 }
        ]
      }]
    }),
    onKaraokeAlignmentProgress: vi.fn(() => () => {}),
    chooseKaraokeVideo: vi.fn().mockResolvedValue({ canceled: true, paths: [] }),
    getBitrate: vi.fn().mockResolvedValue({ ok: true, bitrate: 192000 }),
    chooseFiles: vi.fn().mockResolvedValue({ canceled: true, paths: [] }),
    chooseFolder: vi.fn().mockResolvedValue({ canceled: true, paths: [] }),
    chooseFolderFiles: vi.fn().mockResolvedValue({ canceled: true, paths: [] }),
    getCover: vi.fn().mockResolvedValue({ ok: true, coverBase64: '' }),
    getPathForFile: vi.fn((file: File) => (file as File & { path?: string }).path || ''),
    readFile: options.readFile ?? vi.fn().mockResolvedValue({
      ok: true,
      data: 'AQID',
      mime: 'audio/mpeg'
    }),
    readMp3Tags: vi.fn().mockResolvedValue({
      ok: true,
      title: 'Selected song',
      artist: 'Test artist',
      album: '',
      year: '',
      track: '',
      albumArtist: '',
      lyricist: '',
      composer: '',
      lyrics: '',
      coverMime: '',
      coverBase64: ''
    }),
    searchMetadata: vi.fn().mockResolvedValue({ ok: true, results: [] }),
    listVideoFormats: vi.fn().mockResolvedValue({ ok: true, title: 'Sample video', formats: [] }),
    searchLyrics: vi.fn().mockResolvedValue({
      ok: true,
      results: [{
        id: 123,
        trackName: 'Selected song',
        artistName: 'Test artist',
        albumName: '',
        duration: null,
        plainLyrics: 'Selected song lyrics',
        syncedLyrics: '',
        source: 'Lyrics.ovh'
      }]
    }),
    getLyrics: vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      lyrics: `Static lyrics for ${path}`,
      timed: [{ time: 1, text: `Synchronized lyrics for ${path}` }]
    }))
  };
  setWindowProperty('electronAPI', electronAPI);

  const rendered = options.strictMode
    ? render(<StrictMode><App /></StrictMode>)
    : render(<App />);
  return { electronAPI, ...rendered };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  if (originalCreateObjectURLDescriptor) {
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURLDescriptor);
  } else {
    Reflect.deleteProperty(URL, 'createObjectURL');
  }
  if (originalRevokeObjectURLDescriptor) {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURLDescriptor);
  } else {
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
  for (const [property, descriptor] of originalWindowDescriptors) {
    if (descriptor) Object.defineProperty(window, property, descriptor);
    else Reflect.deleteProperty(window, property);
  }
  originalWindowDescriptors.clear();
});

describe('playlist selection integration', () => {
  it('resumes audio output before asynchronously adding a media library file for playback', async () => {
    const callOrder: string[] = [];
    const { audioContextResume } = installBrowserMocks('suspended');
    const resumeImplementation = audioContextResume.getMockImplementation();
    audioContextResume.mockImplementation(async (...args) => {
      callOrder.push('resume');
      await resumeImplementation?.(...args);
    });

    const filePath = 'C:\\source\\music\\singer\\album\\first.mp3';
    const readFile = vi.fn().mockImplementation(async () => {
      callOrder.push('readFile');
      return { ok: true, data: 'AQID', mime: 'audio/mpeg' };
    });
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const { electronAPI } = renderApp({ mediaFiles: [filePath], readFile });

    fireEvent.click(await screen.findByRole('button', { name: 'Media library' }));
    const firstSong = await screen.findByRole('option', { name: 'first' });
    fireEvent.doubleClick(firstSong);

    expect(audioContextResume).toHaveBeenCalledOnce();
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(filePath));
    expect(callOrder.indexOf('resume')).toBeLessThan(callOrder.indexOf('readFile'));
  }, 15000);

  it('keeps the open-playlist button the same height as the playlist name input', async () => {
    installBrowserMocks();
    renderApp();

    const playlistNameInput = await screen.findByRole('textbox', { name: 'Playlist name' });
    const openPlaylistButton = screen.getByRole('button', { name: 'Open playlist list' });

    expect(playlistNameInput).toHaveStyle({ padding: '8px 36px 8px 12px' });
    expect(openPlaylistButton).toHaveStyle({ height: '100%', top: '0px' });
    expect(openPlaylistButton.parentElement).toBe(playlistNameInput.parentElement);
  });

  it('uses the Show cover setting to control the Media Downloader thumbnail preview', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    vi.mocked(electronAPI.listVideoFormats).mockResolvedValue({
      ok: true,
      title: 'Sample video',
      thumbnailUrl: 'https://img.example.com/sample.jpg',
      formats: []
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const showCoverCheckbox = screen.getByRole('checkbox', {
      name: 'Show covers and videos in Player, Playlist, and Media Downloader'
    });
    expect(showCoverCheckbox).toBeChecked();
    fireEvent.click(showCoverCheckbox);
    expect(showCoverCheckbox).not.toBeChecked();
    expect(localStorage.getItem('showCover')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Back to Player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Media Downloader' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await screen.findByRole('heading', { name: 'Sample video' });
    expect(screen.queryByRole('img', { name: 'Video thumbnail preview' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Show covers and videos in Player, Playlist, and Media Downloader'
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Player' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('img', { name: 'Video thumbnail preview' })).toBeVisible();
  });

  it('hides video visuals when Show covers and videos is disabled while video audio remains playable', async () => {
    installBrowserMocks();
    vi.spyOn(HTMLVideoElement.prototype, 'load').mockImplementation(function (this: HTMLVideoElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('canplay')));
    });
    const videoPath = 'C:\\music\\Song.mp4';
    renderApp({ tracks: [{ id: `path:${videoPath}`, name: 'Song.mp4', path: videoPath }] });

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Show covers and videos in Player, Playlist, and Media Downloader'
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Player' }));
    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp4/ }));

    const video = screen.getByLabelText('Video playback: Song.mp4') as HTMLVideoElement;
    expect(video).toHaveStyle({ visibility: 'hidden', display: 'block' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play video' })).toHaveAttribute('aria-pressed', 'true');
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });
    expect(video).toHaveStyle({ visibility: 'hidden' });
  });

  it('closes Configuration when switching to Tools, Media library, or Playlist', async () => {
    installBrowserMocks();
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Tools workspace' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Media library' }));
    expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Media library' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Playlist' }));
    expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Playlists' })).toBeVisible();
  }, 15000);

  it('updates the playlist resize orientation when the viewport crosses the responsive breakpoint', () => {
    installBrowserMocks();
    let notifyMediaChange: (() => void) | undefined;
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        notifyMediaChange = listener;
      }),
      removeEventListener: vi.fn()
    };
    setWindowProperty('matchMedia', vi.fn(() => mediaQuery));
    renderApp();

    const resizeHandle = screen.getByRole('separator', { name: 'Resize or collapse playlist' });
    expect(resizeHandle).toHaveAttribute('aria-orientation', 'vertical');

    act(() => {
      mediaQuery.matches = true;
      notifyMediaChange?.();
    });

    expect(resizeHandle).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('keeps an obvious playlist reopen control after collapsing on desktop and compact layouts', () => {
    installBrowserMocks();
    let notifyMediaChange: (() => void) | undefined;
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        notifyMediaChange = listener;
      }),
      removeEventListener: vi.fn()
    };
    setWindowProperty('matchMedia', vi.fn(() => mediaQuery));
    const { container } = renderApp();

    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize or collapse playlist' }));
    const desktopReopenButton = screen.getByRole('button', { name: 'Reopen playlist' });
    expect(desktopReopenButton).toBeVisible();
    expect(container.querySelector('.playlists')).toHaveClass('is-collapsed');
    fireEvent.click(desktopReopenButton);
    expect(container.querySelector('.playlists')).not.toHaveClass('is-collapsed');

    act(() => {
      mediaQuery.matches = true;
      notifyMediaChange?.();
    });
    const compactResizeHandle = screen.getByRole('separator', { name: 'Resize or collapse playlist' });
    expect(compactResizeHandle).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.doubleClick(compactResizeHandle);
    const compactReopenButton = screen.getByRole('button', { name: 'Reopen playlist' });
    expect(compactReopenButton).toBeVisible();
    fireEvent.click(compactReopenButton);
    expect(container.querySelector('.playlists')).not.toHaveClass('is-collapsed');
  });

  it('reports an audio output error instead of starting library playback when resume fails', async () => {
    const { audioContextResume } = installBrowserMocks('suspended');
    const filePath = 'C:\\source\\music\\singer\\album\\first.mp3';
    const readFile = vi.fn().mockResolvedValue({
      ok: true,
      data: 'AQID',
      mime: 'audio/mpeg'
    });
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const { electronAPI, container } = renderApp({ mediaFiles: [filePath], readFile });
    audioContextResume.mockRejectedValue(new Error('resume denied'));

    fireEvent.click(await screen.findByRole('button', { name: 'Media library' }));
    fireEvent.doubleClick(await screen.findByRole('option', { name: 'first' }));

    expect(await screen.findByText(/Audio output could not be started because the audio context did not resume/))
      .toBeVisible();
    expect(electronAPI.readFile).not.toHaveBeenCalled();
    expect(container.querySelector('audio')?.src).toBe('');
  }, 15000);

  it('shows post-gain output signal and logs media state while playing', async () => {
    const { audioContext } = installBrowserMocks();
    const { container } = renderApp();
    const debugButton = await screen.findByRole('button', { name: 'Show debug' });
    fireEvent.click(debugButton);
    const debugLog = screen.getByRole('log', { name: 'Debug log' });
    expect(debugLog).toHaveStyle({ maxHeight: '220px', overflowY: 'auto' });
    fireEvent.doubleClick(await screen.findByRole('option', { name: /First song/i }));

    const audio = container.querySelector('audio');
    await waitFor(() => expect(audio?.src).not.toBe(''));
    expect(audio?.crossOrigin).toBe('anonymous');
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    fireEvent.playing(audio!);

    expect(await screen.findByText(/Output signal before device: RMS 0\.12500 · peak 0\.12500/))
      .toBeVisible();
    expect(screen.getByText(/Audio diagnostics.*audio element playing/)).toBeVisible();
    expect(await screen.findByText(/output signal before device: media=audio; RMS=0\.125000; peak=0\.125000/))
      .toBeVisible();
    expect(audioContext.analyserConnect).toHaveBeenCalledWith(audioContext.audioDestination);
    expect(audioContext.gainConnect).toHaveBeenCalledWith(audioContext.audioAnalyserNode);
  }, 15000);

  it('switches the playlist panel to a searchable list of all media library files', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const { electronAPI } = renderApp({
      mediaFiles: [
        'C:\\source\\music\\singer\\album\\01.abc.mp3',
        'C:\\source\\video\\singer\\album\\01.abc.mp4',
        'C:\\source\\karaoke\\singer\\album\\01.abc.ass',
        'C:\\source\\karaoke\\singer\\album\\01.abc_backingtrack.mp3',
        'C:\\source\\karaoke\\singer\\album\\01.abc_vocals.wav',
        'C:\\source\\music\\singer\\album\\music-only.flac',
        'C:\\source\\video\\singer\\album\\video-only.mp4',
        'C:\\source\\karaoke\\singer\\album\\lyrics-only.ass'
      ]
    });
    vi.spyOn(HTMLVideoElement.prototype, 'load').mockImplementation(function (this: HTMLVideoElement) {
      if (!this.src) return;
      Object.defineProperty(this, 'videoWidth', { configurable: true, value: 1920 });
      Object.defineProperty(this, 'videoHeight', { configurable: true, value: 1080 });
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
    });

    const playlistButton = await screen.findByRole('button', { name: 'Playlist' });
    const libraryButton = screen.getByRole('button', { name: 'Media library' });
    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    expect(playlistButton).toHaveAttribute('title', 'Playlist');
    expect(libraryButton).toHaveAttribute('title', 'Media library');
    expect(playlistButton).toHaveStyle({ width: '36px', height: '36px' });
    expect(libraryButton).toHaveStyle({ width: '36px', height: '36px' });
    expect(settingsButton).toHaveStyle({ width: '36px', height: '36px' });

    fireEvent.click(libraryButton);
    const libraryList = screen.getByRole('listbox', { name: 'Media library files' });
    const songItem = await within(libraryList).findByRole('option', { name: '01.abc' });
    await waitFor(() => {
      expect(within(songItem).getByLabelText('Music bitrate')).toHaveTextContent('192 kbps');
      expect(within(songItem).getByLabelText('Video resolution')).toHaveTextContent('1080p');
    });
    const musicBitrate = within(songItem).getByLabelText('Music bitrate');
    const musicIndicator = within(songItem).getByLabelText('Music available');
    const videoResolution = within(songItem).getByLabelText('Video resolution');
    const videoIndicator = within(songItem).getByLabelText('Video available');
    expect(musicBitrate.compareDocumentPosition(musicIndicator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(videoResolution.compareDocumentPosition(videoIndicator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(libraryList).getAllByRole('option')).toHaveLength(4);
    expect(songItem).toHaveTextContent('01.abc');
    expect(within(songItem).getByLabelText('Song location')).toHaveTextContent('singer\\album');
    expect(songItem).not.toHaveTextContent('01.abc.mp3');
    for (const roleName of [
      'Music available',
      'Video available',
      'Karaoke lyrics available',
      'Accompaniments (伴奏) available',
      'Vocals (人聲) available'
    ]) {
      const indicator = within(songItem).getByRole('img', { name: roleName });
      expect(indicator.querySelector('svg')).toBeInTheDocument();
      expect(indicator.textContent).toBe('');
    }
    expect(within(songItem).queryByRole('button')).not.toBeInTheDocument();
    const addToPlaylistButton = screen.getByRole('button', { name: 'Add 0 selected files to playlist' });
    expect(addToPlaylistButton).toHaveClass('media-library-add-button');
    expect(addToPlaylistButton).toBeDisabled();
    expect(addToPlaylistButton.querySelector('svg')).not.toBeNull();
    expect(within(songItem).getByLabelText('Music available')).toHaveAttribute('data-available', 'true');
    expect(within(songItem).getByLabelText('Music available').textContent).toBe('');
    const musicOnlySong = within(libraryList).getByRole('option', { name: 'music-only' });
    expect(within(musicOnlySong).getByLabelText('Video missing'))
      .toHaveClass('media-library-role-indicator');
    expect(within(musicOnlySong).getByLabelText('Video missing'))
      .toHaveAttribute('data-available', 'false');
    expect(screen.queryByText('01.abc.mp4')).not.toBeInTheDocument();
    expect(screen.queryByText('01.abc.ass')).not.toBeInTheDocument();
    expect(electronAPI.readdirRecursive).toHaveBeenCalledWith('C:\\source');

    const musicToggle = screen.getByRole('button', { name: 'Music files' });
    const videoToggle = screen.getByRole('button', { name: 'Video files' });
    expect(musicToggle).toHaveAttribute('aria-pressed', 'true');
    expect(videoToggle).toHaveAttribute('aria-pressed', 'true');
    expect(musicToggle).toHaveAttribute('title', 'Music files (on)');
    expect(videoToggle).toHaveAttribute('title', 'Video files (on)');
    expect(musicToggle).toHaveClass('media-library-category-toggle');
    expect(videoToggle).toHaveClass('media-library-category-toggle');

    fireEvent.click(musicToggle);
    expect(musicToggle).toHaveAttribute('aria-pressed', 'false');
    expect(videoToggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(libraryList).getByRole('option', { name: '01.abc' })).toBeVisible();
    expect(within(libraryList).getByRole('option', { name: 'video-only' })).toBeVisible();
    expect(within(libraryList).queryByRole('option', { name: 'music-only' })).not.toBeInTheDocument();
    expect(within(libraryList).queryByRole('option', { name: 'lyrics-only' })).not.toBeInTheDocument();

    fireEvent.click(videoToggle);
    expect(screen.getByText('No matching files.')).toBeVisible();
    fireEvent.click(videoToggle);
    fireEvent.click(musicToggle);
    expect(within(libraryList).getByRole('option', { name: 'music-only' })).toBeVisible();
    expect(within(libraryList).getByRole('option', { name: 'lyrics-only' })).toBeVisible();

    const karaokeToggle = screen.getByRole('button', { name: 'Karaoke lyrics files' });
    const accompanimentToggle = screen.getByRole('button', { name: 'Accompaniments (伴奏) files' });
    const vocalsToggle = screen.getByRole('button', { name: 'Vocals (人聲) files' });
    expect(karaokeToggle).toHaveClass('media-library-category-toggle');
    expect(accompanimentToggle).toHaveClass('media-library-category-toggle');
    expect(vocalsToggle).toHaveClass('media-library-category-toggle');
    expect(karaokeToggle.querySelector('svg')).not.toBeNull();
    expect(accompanimentToggle.querySelector('svg')).not.toBeNull();
    expect(vocalsToggle.querySelector('svg')).not.toBeNull();
    expect(karaokeToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(musicToggle);
    fireEvent.click(videoToggle);
    fireEvent.click(karaokeToggle);
    expect(karaokeToggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(libraryList).getByRole('option', { name: 'lyrics-only' })).toBeVisible();
    expect(within(libraryList).queryByRole('option', { name: 'music-only' })).not.toBeInTheDocument();
    fireEvent.click(karaokeToggle);
    fireEvent.click(musicToggle);
    fireEvent.click(videoToggle);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('textbox', { name: 'Media library location' })).toHaveValue('C:\\source');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Player' }));

    const search = screen.getByRole('searchbox', { name: 'Search media library files' });
    fireEvent.change(search, { target: { value: '01.abc.ass' } });
    expect(within(libraryList).getAllByRole('option')).toHaveLength(1);
    expect(within(libraryList).getByRole('option', { name: '01.abc' })).toBeVisible();

    fireEvent.change(search, { target: { value: '' } });
    const firstSong = within(libraryList).getByRole('option', { name: '01.abc' });
    const secondSong = within(libraryList).getByRole('option', { name: 'music-only' });
    fireEvent.click(firstSong);
    fireEvent.click(secondSong, { ctrlKey: true });
    expect(firstSong).toHaveAttribute('aria-selected', 'true');
    expect(secondSong).toHaveAttribute('aria-selected', 'true');
    const addSelected = screen.getByRole('button', { name: 'Add 2 selected files to playlist' });
    fireEvent.click(addSelected);
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith('C:\\source\\music\\singer\\album\\01.abc.mp3'));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith('C:\\source\\music\\singer\\album\\music-only.flac'));
  }, 15000);

  it('switches to tool pages without interrupting playback and exposes the Vocal Splitter controls', async () => {
    const { audioContextResume, audioContext } = installBrowserMocks('suspended');
    const { container } = renderApp();
    await waitFor(() => {
      expect(audioContext.audioSourceConnect).toHaveBeenCalledWith(audioContext.audioPannerNode);
      expect(audioContext.pannerConnect).toHaveBeenCalledWith(audioContext.audioGainNode);
      expect(audioContext.gainConnect).toHaveBeenCalledWith(audioContext.audioAnalyserNode);
      expect(audioContext.analyserConnect).toHaveBeenCalledWith(audioContext.audioDestination);
    });
    const firstTrack = await screen.findByRole('option', { name: /First song/i });
    fireEvent.doubleClick(firstTrack);
    await waitFor(() => expect(audioContextResume).toHaveBeenCalledOnce());
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    await waitFor(() => expect(audio?.src).not.toBe(''));
    fireEvent.play(audio!);
    await waitFor(() => expect(container.querySelector('.player-live-content [aria-label="Pause"]')).not.toBeNull());
    const playingSource = audio!.src;

    const toolsButton = await screen.findByRole('button', { name: 'Tools' });
    expect(toolsButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toolsButton);

    expect(toolsButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('navigation', { name: 'Tools' })).toBeVisible();
    expect(screen.getByRole('listbox', { name: 'Available tools' })).toBeVisible();
    const vocalSplitterButton = screen.getByRole('button', { name: 'Vocal Splitter' });
    const karaokeCreatorButton = screen.getByRole('button', { name: 'Karaoke Creator' });
    const karaokeAlignerButton = screen.getByRole('button', { name: 'Karaoke Aligner' });
    const videoDownloaderButton = screen.getByRole('button', { name: 'Media Downloader' });
    expect(vocalSplitterButton).toBeVisible();
    expect(karaokeCreatorButton).toBeVisible();
    expect(karaokeAlignerButton).toBeVisible();
    expect(videoDownloaderButton).toBeVisible();
    expect(within(screen.getByRole('listbox', { name: 'Available tools' })).getAllByRole('option')
      .map(option => option.textContent?.trim()))
      .toEqual(['Media Downloader', 'Karaoke Creator', 'Karaoke Aligner', 'Vocal Splitter']);
    for (const button of [videoDownloaderButton, karaokeCreatorButton, karaokeAlignerButton, vocalSplitterButton]) {
      expect(button.lastElementChild?.tagName.toLocaleLowerCase()).toBe('svg');
      expect(button.lastElementChild).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('main', { name: 'Tools workspace' })).toBeVisible();
    expect(screen.getByText('Select a tool from the list.')).toBeVisible();
    expect(container.querySelector('.player-live-content')).toHaveStyle({
      position: 'absolute',
      visibility: 'hidden',
      pointerEvents: 'none'
    });
    expect(audio!.closest('.player-live-content')).toBeNull();
    expect(audio!.isConnected).toBe(true);
    expect(audio!.src).toBe(playingSource);
    expect(container.querySelector('.player-live-content [aria-label="Pause"]')).not.toBeNull();

    fireEvent.click(videoDownloaderButton);
    expect(await screen.findByRole('heading', { name: 'Media Downloader' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Vocal Splitter' }));
    expect(screen.getByRole('heading', { name: 'Vocal Splitter' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Folder path' })).toBeVisible();
    const recursiveButton = screen.getByRole('button', { name: 'Include subfolders (recursive)' });
    expect(recursiveButton).toBeVisible();
    expect(recursiveButton).toHaveAttribute('aria-pressed', 'false');
    expect(recursiveButton).toHaveClass('icon-btn');
    expect(recursiveButton).toHaveStyle({ background: '#171717' });
    expect(screen.getByRole('button', { name: 'Split' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vocal Splitter' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(karaokeCreatorButton);
    expect(await screen.findByRole('heading', { name: 'Karaoke Creator' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vocal Splitter' })).toHaveAttribute('aria-pressed', 'false');
    expect(karaokeCreatorButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Media library' }));
    expect(screen.getByRole('navigation', { name: 'Media library' })).toBeVisible();
    expect(screen.queryByRole('listbox', { name: 'Available tools' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Player' })).toBeVisible();
    expect(container.querySelector('.player-live-content')).toHaveStyle({ display: 'contents' });
    expect(audio!.src).toBe(playingSource);

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Playlist' }));
    expect(screen.getByRole('navigation', { name: 'Playlists' })).toBeVisible();
    expect(screen.getByRole('listbox', { name: 'Tracks' })).toBeVisible();
  });

  it('plays a media library item on double-click', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const { container } = renderApp({
      mediaFiles: [
        'C:\\source\\video\\singer\\album\\01.abc.mp4',
        'C:\\source\\karaoke\\singer\\album\\01.abc.ass'
      ]
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Media library' }));
    const songItem = await screen.findByRole('option', { name: '01.abc' });
    fireEvent.doubleClick(songItem);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    await waitFor(() => expect(video?.src).toContain(encodeURIComponent('C:\\source\\video\\singer\\album\\01.abc.mp4')));
    expect(video?.crossOrigin).toBe('anonymous');
    fireEvent.canPlay(video!);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  it('enables player media buttons from the current song group and plays vocals', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\source\\music\\Singer\\Album\\Song.mp3';
    const videoPath = 'C:\\source\\video\\Singer\\Album\\Song.mp4';
    const karaokePath = 'C:\\source\\karaoke\\Singer\\Album\\Song.ass';
    const accompanimentPath = 'C:\\source\\Music_Accompaniments\\Singer\\Album\\Song.wav';
    const vocalsPath = 'C:\\source\\Music_Vocals\\Singer\\Album\\Song.wav';
    const { electronAPI } = renderApp({
      tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath }],
      mediaFiles: [musicPath, videoPath, karaokePath, accompanimentPath, vocalsPath]
    });

    fireEvent.click(await screen.findByRole('option', { name: /Song\.mp3/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play music' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play video' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play karaoke video' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play accompaniments' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play vocals' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Play vocals' }));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(vocalsPath));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play vocals' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('plays the video and shows the aligned karaoke overlay when K is selected', async () => {
    installBrowserMocks();
    vi.spyOn(HTMLVideoElement.prototype, 'load').mockImplementation(function (this: HTMLVideoElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('canplay')));
    });
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const videoPath = 'C:\\source\\video\\Singer\\Album\\Song.mp4';
    const musicPath = 'C:\\source\\music\\Singer\\Album\\Song.mp3';
    const karaokePath = 'C:\\source\\karaoke\\Singer\\Album\\Song.ass';
    const accompanimentPath = 'C:\\source\\Video_Accompaniments\\Singer\\Album\\Song.wav';
    const { electronAPI, container } = renderApp({
      tracks: [{ id: `path:${videoPath}`, name: 'Song.mp4', path: videoPath }],
      mediaFiles: [
        videoPath,
        musicPath,
        karaokePath,
        accompanimentPath,
        'C:\\source\\Music_Accompaniments\\Singer\\Album\\Song.wav'
      ]
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp4/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play karaoke video' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Play karaoke video' }));

    await waitFor(() => expect(electronAPI.readKaraokeSubtitle).toHaveBeenCalledWith(karaokePath));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play karaoke video' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByLabelText('Karaoke subtitles')).toHaveTextContent('飛瀑');
    expect(screen.queryByText(/Static lyrics for/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Karaoke subtitles').children[0]).toHaveAttribute('data-fill-progress', '0');
    const video = container.querySelector('video');
    expect(video?.src).toContain(encodeURIComponent(videoPath));
    expect(video?.muted).toBe(true);
    expect(container.querySelector('audio[aria-label="Karaoke accompaniment audio"]')?.getAttribute('src'))
      .toContain(encodeURIComponent(accompanimentPath));
    expect(screen.getByRole('button', { name: 'Karaoke audio: Accompaniment' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Karaoke audio: Original' }));
    expect(video?.muted).toBe(false);
    expect(screen.getByRole('button', { name: 'Play karaoke video' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Karaoke audio: Accompaniment' }));
    expect(video?.muted).toBe(true);
  });

  it('defaults A and O to Music stems and lets each switch independently to Video', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\source\\Music\\Singer\\Album\\Song.mp3';
    const musicAccompaniment = 'C:\\source\\Music_Accompaniments\\Singer\\Album\\Song.wav';
    const videoAccompaniment = 'C:\\source\\Video_Accompaniments\\Singer\\Album\\Song.wav';
    const musicVocals = 'C:\\source\\Music_Vocals\\Singer\\Album\\Song.wav';
    const videoVocals = 'C:\\source\\Video_Vocals\\Singer\\Album\\Song.wav';
    const { electronAPI } = renderApp({
      tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath }],
      mediaFiles: [
        musicPath,
        'C:\\source\\Video\\Singer\\Album\\Song.mp4',
        musicAccompaniment,
        videoAccompaniment,
        musicVocals,
        videoVocals
      ]
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp3/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play accompaniments' }));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(musicAccompaniment));
    expect(screen.getByRole('button', { name: 'Accompaniment source: Music' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Accompaniment source: Video' }));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(videoAccompaniment));

    fireEvent.click(screen.getByRole('button', { name: 'Play vocals' }));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(musicVocals));
    expect(screen.getByRole('button', { name: 'Vocals source: Music' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Vocals source: Video' }));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(videoVocals));
    fireEvent.click(screen.getByRole('button', { name: 'Play accompaniments' }));
    expect(screen.getByRole('button', { name: 'Accompaniment source: Video' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses original audio and disables accompaniment when a karaoke stem is missing', async () => {
    installBrowserMocks();
    vi.spyOn(HTMLVideoElement.prototype, 'load').mockImplementation(function (this: HTMLVideoElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('canplay')));
    });
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const videoPath = 'C:\\source\\video\\Singer\\Album\\Song.mp4';
    const karaokePath = 'C:\\source\\karaoke\\Singer\\Album\\Song.ass';
    const { container } = renderApp({
      tracks: [{ id: `path:${videoPath}`, name: 'Song.mp4', path: videoPath }],
      mediaFiles: [videoPath, karaokePath]
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp4/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play karaoke video' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Play karaoke video' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Play karaoke video' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Karaoke audio: Accompaniment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Karaoke audio: Original' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('video')?.muted).toBe(false);
  });

  it('ignores a play request aborted by an intentional video pause and retries on resume', async () => {
    installBrowserMocks();
    vi.spyOn(HTMLVideoElement.prototype, 'load').mockImplementation(function (this: HTMLVideoElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('canplay')));
    });
    let rejectPendingAudioPlay: ((error: Error) => void) | undefined;
    const audioPlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      if (this.getAttribute('aria-label') === 'Karaoke accompaniment audio') {
        return new Promise<void>((_resolve, reject) => { rejectPendingAudioPlay = reject; });
      }
      return Promise.resolve();
    });
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const videoPath = 'C:\\source\\video\\Singer\\Album\\Song.mp4';
    const karaokePath = 'C:\\source\\karaoke\\Singer\\Album\\Song.ass';
    const accompanimentPath = 'C:\\source\\accompaniments\\Singer\\Album\\Song.wav';
    const { container } = renderApp({
      tracks: [{ id: `path:${videoPath}`, name: 'Song.mp4', path: videoPath }],
      mediaFiles: [videoPath, karaokePath, accompanimentPath]
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp4/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play karaoke video' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Play karaoke video' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play karaoke video' })).toHaveAttribute('aria-pressed', 'true'));

    const video = container.querySelector('video')!;
    const accompaniment = screen.getByLabelText('Karaoke accompaniment audio');
    let videoPaused = false;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => videoPaused });
    Object.defineProperty(accompaniment, 'readyState', { configurable: true, get: () => HTMLMediaElement.HAVE_METADATA });

    fireEvent.play(video);
    await waitFor(() => expect(rejectPendingAudioPlay).toBeDefined());
    const rejectFirstPlay = rejectPendingAudioPlay!;
    videoPaused = true;
    fireEvent.pause(video);
    videoPaused = false;
    fireEvent.play(video);
    rejectFirstPlay(Object.assign(new Error('The play() request was interrupted by a call to pause().'), { name: 'AbortError' }));
    const karaokeAudioPlayCount = () => audioPlay.mock.contexts.filter(
      media => media instanceof HTMLMediaElement && media.getAttribute('aria-label') === 'Karaoke accompaniment audio'
    ).length;
    await waitFor(() => expect(karaokeAudioPlayCount()).toBe(2));
    videoPaused = true;
    fireEvent.pause(video);
    rejectPendingAudioPlay!(Object.assign(new Error('The play() request was interrupted by a call to pause().'), { name: 'AbortError' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows media availability for the playlist track after double-click playback', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\source\\music\\Singer\\Album\\Song.mp3';
    const mediaFiles = [
      musicPath,
      'C:\\source\\video\\Singer\\Album\\Song.mp4',
      'C:\\source\\karaoke\\Singer\\Album\\Song.ass',
      'C:\\source\\Music_Accompaniments\\Singer\\Album\\Song.wav',
      'C:\\source\\Music_Vocals\\Singer\\Album\\Song.wav'
    ];
    renderApp({
      tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath }],
      mediaFiles
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp3/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play music' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play video' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play karaoke video' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play accompaniments' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play vocals' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Play music' })).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByRole('button', { name: 'Play accompaniments' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('main', { name: 'Player' })).toBeVisible();
  });

  it('returns to Player and synchronizes the MAVKO button when a playlist item is double-clicked from Configuration', async () => {
    installBrowserMocks();
    const musicPath = 'C:\\music\\Song.mp3';
    renderApp({ tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath }] });

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp3/ }));

    expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Player' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play music' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('returns to Player and synchronizes the first available media role in MVKAO order from the library', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const accompanimentPath = 'C:\\source\\karaoke\\Singer\\Album\\Song_backingtrack.wav';
    const videoPath = 'C:\\source\\video\\Singer\\Album\\Song.mp4';
    const { electronAPI } = renderApp({ mediaFiles: [videoPath, accompanimentPath] });

    fireEvent.click(await screen.findByRole('button', { name: 'Media library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    fireEvent.doubleClick(await screen.findByRole('option', { name: 'Song' }));

    expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(electronAPI.readFile).toHaveBeenCalledWith(videoPath);
      expect(screen.getByRole('button', { name: 'Play video' })).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByRole('button', { name: 'Play accompaniments' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('synchronizes the accompaniment button when that is the only playable library role', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const accompanimentPath = 'C:\\source\\karaoke\\Singer\\Album\\Song_backingtrack.wav';
    const { electronAPI } = renderApp({ mediaFiles: [accompanimentPath] });

    fireEvent.click(await screen.findByRole('button', { name: 'Media library' }));
    fireEvent.doubleClick(await screen.findByRole('option', { name: 'Song_backingtrack' }));

    await waitFor(() => {
      expect(electronAPI.readFile).toHaveBeenCalledWith(accompanimentPath);
      expect(screen.getByRole('button', { name: 'Play accompaniments' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('enables the current playlist media role when it is absent from the library scan', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\playlist\\Unindexed song.mp3';
    renderApp({
      tracks: [{ id: `path:${musicPath}`, name: 'Unindexed song.mp3', path: musicPath }]
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Unindexed song\.mp3/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Play music' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Play video' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play karaoke' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play accompaniments' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play vocals' })).toBeDisabled();
  });

  it('keeps the K player button disabled when the song has no karaoke subtitles', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\source\\music\\Singer\\Album\\Song.mp3';
    const videoPath = 'C:\\source\\video\\Singer\\Album\\Song.mp4';
    renderApp({
      tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath }],
      mediaFiles: [musicPath, videoPath]
    });

    fireEvent.click(await screen.findByRole('option', { name: /Song\.mp3/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play video' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Play karaoke video' })).toBeDisabled();
  });

  it('keeps audio-only K disabled until a matching Music stem is available', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\source\\music\\Singer\\Album\\Song.mp3';
    const karaokePath = 'C:\\source\\karaoke\\Singer\\Album\\Song.ass';
    renderApp({
      tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath }],
      mediaFiles: [musicPath, karaokePath]
    });

    fireEvent.click(await screen.findByRole('option', { name: /Song\.mp3/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play music' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Play karaoke' })).toBeDisabled();
  });

  it('plays Music accompaniment with the cover and timed subtitles in audio-only K mode', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\source\\Music\\Singer\\Album\\Song.mp3';
    const accompanimentPath = 'C:\\source\\Music_Accompaniments\\Singer\\Album\\Song.wav';
    const vocalsPath = 'C:\\source\\Music_Vocals\\Singer\\Album\\Song.wav';
    const karaokePath = 'C:\\source\\karaoke\\Singer\\Album\\Song.ass';
    const cover = 'data:image/png;base64,AQID';
    const { electronAPI, container } = renderApp({
      savedMediaLibraryPath: 'C:\\source',
      tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath, cover }],
      mediaFiles: [musicPath, accompanimentPath, vocalsPath, karaokePath]
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp3/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play music' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Play karaoke' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Play karaoke' }));

    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(accompanimentPath));
    expect(await screen.findByRole('group', { name: 'Karaoke music source' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play karaoke' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByAltText('cover')).toHaveAttribute('src', cover));
    expect(await screen.findByLabelText('Karaoke subtitles')).toBeVisible();
    expect(screen.queryByText(/Static lyrics for/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Karaoke music: Vocals' }));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(vocalsPath));
    expect(container.querySelector('video')).not.toBeVisible();
  });

  it('shows the original Music cover and lyrics in accompaniment and vocals modes', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    const musicPath = 'C:\\source\\Music\\Singer\\Album\\Song.mp3';
    const accompanimentPath = 'C:\\source\\Music_Accompaniments\\Singer\\Album\\Song.wav';
    const vocalsPath = 'C:\\source\\Music_Vocals\\Singer\\Album\\Song.wav';
    const cover = 'data:image/png;base64,AQID';
    const { electronAPI } = renderApp({
      savedMediaLibraryPath: 'C:\\source',
      tracks: [{ id: `path:${musicPath}`, name: 'Song.mp3', path: musicPath, cover }],
      mediaFiles: [musicPath, accompanimentPath, vocalsPath]
    });

    fireEvent.doubleClick(await screen.findByRole('option', { name: /Song\.mp3/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play music' })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Play vocals' }));

    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(vocalsPath));
    expect(await screen.findByAltText('cover')).toHaveAttribute('src', cover);
    await waitFor(() => expect(electronAPI.getLyrics).toHaveBeenCalledWith(musicPath));
    expect(await screen.findByText(`Synchronized lyrics for ${musicPath}`)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Play accompaniments' }));
    await waitFor(() => expect(electronAPI.readFile).toHaveBeenCalledWith(accompanimentPath));
    expect(await screen.findByAltText('cover')).toHaveAttribute('src', cover);
    expect(await screen.findByText(`Synchronized lyrics for ${musicPath}`)).toBeVisible();
  });

  it('lets the user type or browse for a media library location and saves it', async () => {
    installBrowserMocks();
    const { electronAPI, unmount } = renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const locationInput = screen.getByRole('textbox', { name: 'Media library location' });
    fireEvent.change(locationInput, { target: { value: 'C:\\manual-library' } });
    expect(localStorage.getItem('mediaLibraryPath')).toBe('C:\\manual-library');
    await waitFor(() => expect(electronAPI.saveMediaLibraryPath).toHaveBeenCalledWith('C:\\manual-library'));

    vi.mocked(electronAPI.chooseFolder).mockResolvedValue({
      canceled: false,
      paths: ['C:\\source']
    });
    fireEvent.click(screen.getByRole('button', { name: 'Browse...' }));

    await waitFor(() => expect(locationInput).toHaveValue('C:\\source'));
    expect(electronAPI.chooseFolder).toHaveBeenCalledOnce();
    expect(localStorage.getItem('mediaLibraryPath')).toBe('C:\\source');
    await waitFor(() => expect(electronAPI.saveMediaLibraryPath).toHaveBeenCalledWith('C:\\source'));

    unmount();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('textbox', { name: 'Media library location' })).toHaveValue('C:\\source');
  });

  it('restores the saved media library location from Electron settings after startup', async () => {
    installBrowserMocks();
    renderApp({ savedMediaLibraryPath: 'C:\\Media' });

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('textbox', { name: 'Media library location' })).toHaveValue('C:\\Media');
    expect(localStorage.getItem('mediaLibraryPath')).toBe('C:\\Media');
  });

  it('honors an explicitly cleared saved path instead of restoring stale browser storage', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\OldMedia');
    renderApp({ savedMediaLibraryPath: '' });

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('textbox', { name: 'Media library location' })).toHaveValue('');
    expect(localStorage.getItem('mediaLibraryPath')).toBe('');
  });

  it('migrates an existing localStorage media library location into Electron settings', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\LegacyMedia');
    const { electronAPI } = renderApp();

    await waitFor(() => expect(electronAPI.saveMediaLibraryPath).toHaveBeenCalledWith('C:\\LegacyMedia'));
  });

  it('updates slider tooltips while volume, pan, and transpose are being adjusted', async () => {
    installBrowserMocks();
    renderApp();

    const volumeSlider = await screen.findByRole('slider', { name: 'Volume' });
    fireEvent.pointerOver(volumeSlider);
    fireEvent.input(volumeSlider, { target: { value: '0.73' } });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Volume: 73%');

    const panSlider = screen.getByRole('slider', { name: 'Pan' });
    fireEvent.pointerOver(panSlider);
    fireEvent.input(panSlider, { target: { value: '-0.42' } });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pan: L 42%');
    fireEvent.input(panSlider, { target: { value: '0' } });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pan: M');

    const transposeSlider = screen.getByRole('slider', { name: 'Transpose' });
    fireEvent.pointerOver(transposeSlider);
    fireEvent.input(transposeSlider, { target: { value: '5' } });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Transpose: +5 semitones');
  });

  it('changes volume with the up and down arrow keys without hijacking text inputs', async () => {
    installBrowserMocks();
    renderApp();

    const volumeSlider = await screen.findByRole('slider', { name: 'Volume' });
    expect(volumeSlider).toHaveValue('0.5');

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(volumeSlider).toHaveValue('0.55');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(volumeSlider).toHaveValue('0.5');

    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    }
    expect(volumeSlider).toHaveValue('1');
    for (let index = 0; index < 24; index += 1) {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    }
    expect(volumeSlider).toHaveValue('0');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const mediaLibraryInput = await screen.findByRole('textbox', { name: 'Media library location' });
    fireEvent.keyDown(mediaLibraryInput, { key: 'ArrowUp' });
    expect(volumeSlider).toHaveValue('0');
  });

  it('previews a single-clicked track after the delay, loads its lyrics, and preserves static lyrics mode', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    const secondTrack = await screen.findByRole('option', { name: /Second song/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Switch to static lyrics' }));
    });
    expect(screen.getByRole('button', { name: 'Switch to synchronized lyrics' })).toBeVisible();

    fireEvent.click(secondTrack, { detail: 1 });
    expect(secondTrack).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
    expect(electronAPI.getLyrics).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(electronAPI.getLyrics).toHaveBeenCalledWith('C:\\music\\second.mp3');
    }, { timeout: 1500 });
    expect(await screen.findByText('Static lyrics for C:\\music\\second.mp3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Switch to synchronized lyrics' })).toBeVisible();
  });

  it('plays a double-clicked track immediately, loads its lyrics, and retains the cover view', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    const secondTrack = await screen.findByRole('option', { name: /Second song/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show cover' }));
    });
    expect(screen.getByRole('button', { name: 'Show lyrics' })).toBeVisible();

    await act(async () => {
      fireEvent.click(secondTrack, { detail: 1 });
      fireEvent.click(secondTrack, { detail: 2 });
      fireEvent.doubleClick(secondTrack, { detail: 2 });
    });

    expect(secondTrack).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Show lyrics' })).toBeVisible();
    await waitFor(() => {
      expect(electronAPI.getLyrics).toHaveBeenCalledWith('C:\\music\\second.mp3');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show lyrics' }));
    });
    expect(await screen.findByRole('button', { name: 'Seek to 00:01' })).toHaveTextContent(
      'Synchronized lyrics for C:\\music\\second.mp3'
    );
  });

  it('shows a visible playback error when the selected media cannot start', async () => {
    installBrowserMocks();
    const playError = new Error('media decoder rejected the source');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(playError);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderApp();
    const secondTrack = await screen.findByRole('option', { name: /Second song/i });

    await act(async () => {
      fireEvent.click(secondTrack, { detail: 1 });
      fireEvent.click(secondTrack, { detail: 2 });
      fireEvent.doubleClick(secondTrack, { detail: 2 });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Playback failed for Second song.mp3: media decoder rejected the source'
    );
    expect(screen.getByRole('button', { name: /^Play$/ })).toHaveAttribute('aria-pressed', 'false');
    expect(alert).not.toHaveBeenCalled();
  });

  it('routes selected video tracks through video playback', async () => {
    installBrowserMocks();
    vi.spyOn(HTMLVideoElement.prototype, 'load').mockImplementation(function (this: HTMLVideoElement) {
      this.dispatchEvent(new Event('canplay'));
    });
    const videoTracks = [
      playlistTracks[0],
      {
        id: 'video-track',
        name: 'Video clip.mp4',
        path: 'C:\\music\\video-clip.mp4',
        bitrate: 0
      }
    ];
    renderApp({ tracks: videoTracks });
    const videoTrack = await screen.findByRole('option', { name: /Video clip/i });

    await act(async () => {
      fireEvent.click(videoTrack, { detail: 1 });
      fireEvent.click(videoTrack, { detail: 2 });
      fireEvent.doubleClick(videoTrack, { detail: 2 });
    });

    const video = await screen.findByLabelText('Video playback: Video clip.mp4');
    await waitFor(() => {
      expect(video).toHaveAttribute('src', 'music://local/C%3A%5Cmusic%5Cvideo-clip.mp4');
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('resolves an added MP3 path with Electron webUtils so tag actions are available', async () => {
    installBrowserMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn()
        .mockReturnValueOnce('blob:selected-file')
        .mockReturnValue('blob:loaded-file')
    });
    const { electronAPI } = renderApp();
    await screen.findByRole('option', { name: /First song/i });
    const file = new File(['audio'], 'Selected song.mp3', { type: 'audio/mpeg' });
    const filePath = 'C:\\music\\Selected song.mp3';
    electronAPI.getPathForFile.mockReturnValue(filePath);

    fireEvent.change(document.getElementById('addFilesInput') as HTMLInputElement, {
      target: { files: [file] }
    });
    const addedTrack = await screen.findByRole('option', { name: /Selected song/i });
    expect(electronAPI.getPathForFile).toHaveBeenCalledWith(file);

    await act(async () => {
      fireEvent.click(addedTrack, { detail: 1 });
    });
    expect(addedTrack).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));

    await waitFor(() => {
      expect(electronAPI.readMp3Tags).toHaveBeenCalledWith(filePath);
    });
    expect(screen.getByRole('button', { name: 'Search online for all MP3 information' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Search online for lyrics' })).toBeEnabled();
  });

  it('uses the Electron file picker path to load MP3 tags and enable info actions', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp({ tracks: [] });
    const filePath = 'C:\\music\\Selected song.mp3';
    electronAPI.chooseFiles.mockResolvedValue({ canceled: false, paths: [filePath] });

    fireEvent.click(screen.getByRole('button', { name: 'Add files' }));
    const addedTrack = await screen.findByRole('option', { name: /Selected song/i });
    expect(electronAPI.chooseFiles).toHaveBeenCalledOnce();
    expect(electronAPI.readFile).toHaveBeenCalledWith(filePath);

    await act(async () => {
      fireEvent.click(addedTrack);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));

    await waitFor(() => {
      expect(electronAPI.readMp3Tags).toHaveBeenCalledWith(filePath);
    });
    expect(screen.getByRole('button', { name: 'Search online for all MP3 information' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Search online for lyrics' })).toBeEnabled();
  });

  it('recovers the MP3 path from a path-prefixed playlist track id', async () => {
    installBrowserMocks();
    const filePath = 'C:\\music\\Folder song.mp3';
    const { electronAPI } = renderApp({
      tracks: [{
        id: `path:${filePath}`,
        name: 'Folder song.mp3',
        src: 'music://local/C%3A%5Cmusic%5CFolder%20song.mp3'
      }]
    });
    const addedTrack = await screen.findByRole('option', { name: /Folder song/i });

    expect(addedTrack).toHaveAttribute('title', `Folder song.mp3 — ${filePath}`);
    fireEvent.click(addedTrack);
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));

    await waitFor(() => {
      expect(electronAPI.readMp3Tags).toHaveBeenCalledWith(filePath);
    });
    expect(screen.getByRole('button', { name: 'Search online for all MP3 information' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Search online for lyrics' })).toBeEnabled();
  });

  it('keeps the original path when adding MP3 files from an Electron folder', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp({ tracks: [] });
    const filePath = 'C:\\music\\album\\Folder song.mp3';
    electronAPI.chooseFolderFiles.mockResolvedValue({
      canceled: false,
      paths: [filePath]
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    const addedTrack = await screen.findByRole('option', { name: /Folder song/i });
    expect(electronAPI.chooseFolderFiles).toHaveBeenCalledOnce();
    expect(addedTrack).toHaveTextContent(filePath);
    expect(electronAPI.readFile).toHaveBeenCalledWith(filePath);

    await act(async () => {
      fireEvent.click(addedTrack);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));

    await waitFor(() => {
      expect(electronAPI.readMp3Tags).toHaveBeenCalledWith(filePath);
    });
    expect(screen.getByRole('button', { name: 'Search online for all MP3 information' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Search online for lyrics' })).toBeEnabled();
  });

  it('keeps Get Info available when local MP3 tag reading fails', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp({ tracks: [] });
    const filePath = 'C:\\music\\Folder song.mp3';
    electronAPI.chooseFolderFiles.mockResolvedValue({
      canceled: false,
      paths: [filePath]
    });
    electronAPI.readMp3Tags.mockRejectedValue(new Error('ID3 data could not be read'));

    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    const addedTrack = await screen.findByRole('option', { name: /Folder song/i });
    fireEvent.click(addedTrack);
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ID3 data could not be read');
    const getInfoButton = screen.getByRole('button', { name: 'Search online for all MP3 information' });
    expect(getInfoButton).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Search online for lyrics' })).toBeEnabled();

    fireEvent.click(getInfoButton);
    await waitFor(() => {
      expect(electronAPI.searchMetadata).toHaveBeenCalledWith(
        expect.stringContaining('Folder song'),
        expect.objectContaining({ title: expect.stringContaining('Folder song') })
      );
    });
  });

  it('shows online song information returned by the catalog', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    electronAPI.searchMetadata.mockResolvedValue({
      ok: true,
      results: [{
        id: 42,
        trackName: 'First song',
        artistName: 'Test artist',
        albumName: 'Test album',
        year: '2024',
        trackNumber: '1',
        albumArtist: 'Test artist',
        artworkUrl: '',
        duration: 180,
        country: 'US'
      }]
    });
    const track = await screen.findByRole('option', { name: /First song/i });
    fireEvent.click(track);
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Search online for all MP3 information' }));

    const resultCard = await screen.findByRole('button', { name: 'Select First song by Test artist, Test album' });
    expect(resultCard).toBeVisible();
    expect(electronAPI.searchMetadata).toHaveBeenCalledWith(
      'Selected song Test artist',
      expect.objectContaining({ title: 'Selected song', artist: 'Test artist' })
    );
    fireEvent.click(resultCard);
    expect(await screen.findByRole('alertdialog', { name: 'Replace existing information?' }))
      .toHaveTextContent('Replace existing Title');
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('First song'));
    expect(screen.getByRole('textbox', { name: 'Artist' })).toHaveValue('Test artist');
    expect(screen.getByRole('textbox', { name: 'Album' })).toHaveValue('Test album');
    expect(screen.getByRole('textbox', { name: 'Year' })).toHaveValue('2024');
    expect(screen.getByRole('textbox', { name: 'Track' })).toHaveValue('1');
    expect(screen.getByRole('textbox', { name: 'Album Artist' })).toHaveValue('Test artist');
  });

  it('keeps existing tags when the themed overwrite dialog is canceled', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    electronAPI.readMp3Tags.mockResolvedValue({
      ok: true,
      title: 'Existing title',
      artist: 'Test artist',
      album: '',
      year: '',
      track: '',
      albumArtist: '',
      lyricist: '',
      composer: '',
      lyrics: '',
      coverMime: '',
      coverBase64: ''
    });
    electronAPI.searchMetadata.mockResolvedValue({
      ok: true,
      results: [{
        id: 46,
        trackName: 'New title',
        artistName: 'Test artist',
        albumName: '',
        year: '',
        trackNumber: '',
        albumArtist: '',
        artworkUrl: '',
        duration: null,
        country: 'US'
      }]
    });

    fireEvent.click(await screen.findByRole('option', { name: /First song/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Search online for all MP3 information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select New title by Test artist, album unavailable' }));
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Existing title');
  });

  it('lets advanced selection apply only checked metadata fields', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    electronAPI.readMp3Tags.mockResolvedValue({
      ok: true,
      title: 'Existing title',
      artist: 'Old artist',
      album: 'Old album',
      year: '2010',
      track: '2',
      albumArtist: 'Old album artist',
      lyricist: 'Existing lyricist',
      composer: 'Existing composer',
      lyrics: '',
      coverMime: '',
      coverBase64: ''
    });
    electronAPI.searchMetadata.mockResolvedValue({
      ok: true,
      results: [{
        id: 45,
        trackName: 'Selected song',
        artistName: 'Test artist',
        albumName: 'Test album',
        year: '2024',
        trackNumber: '1',
        albumArtist: 'Test artist',
        artworkUrl: '',
        duration: 180,
        country: 'US'
      }]
    });
    fireEvent.click(await screen.findByRole('option', { name: /First song/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Search online for all MP3 information' }));
    await screen.findByRole('button', { name: 'Select Selected song by Test artist, Test album' });
    const advanceSelectButton = screen.getByRole('button', {
      name: 'Advance select for Selected song by Test artist'
    });
    expect(advanceSelectButton.closest('.tag-editor-metadata-card-wrap')).toContainElement(advanceSelectButton);
    fireEvent.click(advanceSelectButton);

    const advancedSelection = screen.getByRole('region', { name: 'Advanced field selection for Selected song' });
    expect(advancedSelection).toBeVisible();
    expect(screen.getByRole('region', { name: 'Select online MP3 information' })
      .querySelector('.tag-editor-metadata-grid')).toHaveAttribute('hidden');
    expect(screen.getByText(/Each field uses Apple Music\/iTunes first, then Discogs, then MusicBrainz/)).toBeVisible();
    expect(within(advancedSelection).getByRole('checkbox', { name: 'Composer' })).toBeDisabled();
    for (const field of ['Artist', 'Album', 'Year', 'Track', 'Album Artist']) {
      fireEvent.click(within(advancedSelection).getByRole('checkbox', { name: new RegExp(`^${field}$`) }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected fields' }));
    expect(await screen.findByRole('alertdialog', { name: 'Replace existing information?' }))
      .toHaveTextContent('Replace existing Title');
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(screen.queryByRole('region', {
      name: 'Advanced field selection for Selected song'
    })).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Selected song');
    expect(screen.getByRole('textbox', { name: 'Artist' })).toHaveValue('Old artist');
    expect(screen.getByRole('textbox', { name: 'Album' })).toHaveValue('Old album');
    expect(screen.getByRole('textbox', { name: 'Year' })).toHaveValue('2010');
    expect(screen.getByRole('textbox', { name: 'Track' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Album Artist' })).toHaveValue('Old album artist');
    expect(screen.getByRole('textbox', { name: 'Composer' })).toHaveValue('Existing composer');
    expect(screen.getByRole('textbox', { name: 'Lyricist' })).toHaveValue('Existing lyricist');
  });

  it('lets advanced selection update Composer and Lyricist supplied by fallback catalogs', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    electronAPI.readMp3Tags.mockResolvedValue({
      ok: true,
      title: 'Selected song',
      artist: 'Test artist',
      album: 'Test album',
      year: '',
      track: '',
      albumArtist: '',
      lyricist: '',
      composer: '',
      lyrics: '',
      coverMime: '',
      coverBase64: ''
    });
    electronAPI.searchMetadata.mockResolvedValue({
      ok: true,
      results: [{
        id: 47,
        trackName: 'Selected song',
        artistName: 'Test artist',
        albumName: 'Test album',
        year: '',
        trackNumber: '',
        albumArtist: '',
        artworkUrl: '',
        duration: null,
        country: 'US',
        composer: 'Fallback composer',
        lyricist: 'Fallback lyricist',
        fieldSources: {
          composer: 'Discogs',
          lyricist: 'MusicBrainz'
        }
      }]
    });

    fireEvent.click(await screen.findByRole('option', { name: /First song/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Search online for all MP3 information' }));
    fireEvent.click(await screen.findByRole('button', {
      name: 'Advance select for Selected song by Test artist'
    }));

    const advancedSelection = screen.getByRole('region', {
      name: 'Advanced field selection for Selected song'
    });
    const composerCheckbox = within(advancedSelection).getByRole('checkbox', { name: 'Composer' });
    const lyricistCheckbox = within(advancedSelection).getByRole('checkbox', { name: 'Lyricist' });
    expect(composerCheckbox).toBeEnabled();
    expect(lyricistCheckbox).toBeEnabled();
    expect(within(advancedSelection).getByText('New: Fallback composer · Discogs')).toBeVisible();
    expect(within(advancedSelection).getByText('New: Fallback lyricist · MusicBrainz')).toBeVisible();

    for (const field of ['Composer', 'Lyricist']) {
      const checkbox = within(advancedSelection).getByRole('checkbox', { name: field });
      if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected fields' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Composer' })).toHaveValue('Fallback composer');
      expect(screen.getByRole('textbox', { name: 'Lyricist' })).toHaveValue('Fallback lyricist');
    });
  });

  it('shows filled match icons and a weighted similarity score on Get Info cards', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    electronAPI.readMp3Tags.mockResolvedValue({
      ok: true,
      title: 'Selected song',
      artist: 'Test artist',
      album: 'Test album',
      year: '',
      track: '',
      albumArtist: '',
      lyricist: '',
      composer: '',
      lyrics: '',
      coverMime: '',
      coverBase64: ''
    });
    electronAPI.searchMetadata.mockResolvedValue({
      ok: true,
      results: [{
        id: 44,
        trackName: 'Selected song',
        artistName: 'Test artist',
        albumName: 'Test album',
        year: '2024',
        trackNumber: '1',
        albumArtist: 'Test artist',
        artworkUrl: '',
        duration: 180,
        country: 'US'
      }]
    });

    fireEvent.click(await screen.findByRole('option', { name: /First song/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Search online for all MP3 information' }));
    const resultCard = await screen.findByRole('button', {
      name: 'Select Selected song by Test artist, Test album'
    });

    expect(resultCard).toHaveTextContent('90%');
    expect(screen.getByRole('img', { name: 'Song title matches' }).querySelector('path'))
      .toHaveAttribute('fill', 'currentColor');
    expect(screen.getByRole('img', { name: 'Artist matches' }).querySelector('path'))
      .toHaveAttribute('fill', 'currentColor');
    expect(screen.getByRole('img', { name: 'Album matches' }).querySelector('circle'))
      .toHaveAttribute('fill', 'currentColor');
  });

  it('retries online song information using the title when the detailed query has no matches', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    electronAPI.searchMetadata
      .mockResolvedValueOnce({ ok: true, results: [] })
      .mockResolvedValueOnce({
        ok: true,
        results: [{
          id: 43,
          trackName: 'Selected song',
          artistName: 'Test artist',
          albumName: 'Test album',
          year: '2024',
          trackNumber: '1',
          albumArtist: 'Test artist',
          artworkUrl: '',
          duration: 180,
          country: 'US'
        }]
      });
    const track = await screen.findByRole('option', { name: /First song/i });
    fireEvent.click(track);
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Search online for all MP3 information' }));

    expect(await screen.findByRole('button', { name: 'Select Selected song by Test artist, Test album' })).toBeVisible();
    expect(electronAPI.searchMetadata).toHaveBeenNthCalledWith(
      1,
      'Selected song Test artist',
      expect.objectContaining({ title: 'Selected song', artist: 'Test artist' })
    );
    expect(electronAPI.searchMetadata).toHaveBeenNthCalledWith(
      2,
      'Selected song',
      expect.objectContaining({ title: 'Selected song', artist: 'Test artist' })
    );
  });

  it('searches and displays online lyrics for the selected track', async () => {
    installBrowserMocks();
    const { electronAPI } = renderApp();
    electronAPI.readMp3Tags.mockResolvedValue({
      ok: true,
      title: 'Selected song',
      artist: 'Test artist',
      album: 'Test album',
      year: '',
      track: '',
      albumArtist: '',
      lyricist: '',
      composer: '',
      lyrics: '',
      coverMime: '',
      coverBase64: ''
    });
    electronAPI.searchLyrics.mockResolvedValue({
      ok: true,
      results: [{
        id: 123,
        trackName: 'Selected song',
        artistName: 'Test artist',
        albumName: 'Test album',
        duration: null,
        plainLyrics: 'Selected song lyrics',
        syncedLyrics: '',
        source: 'LRCLIB'
      }]
    });
    const track = await screen.findByRole('option', { name: /First song/i });
    fireEvent.click(track);
    fireEvent.click(screen.getByRole('button', { name: 'Show selected item information' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Search online for lyrics' }));

    const resultCard = await screen.findByRole('button', { name: 'Use lyrics for Selected song by Test artist' });
    expect(resultCard).toBeVisible();
    expect(resultCard).toHaveTextContent('90%');
    expect(screen.getByRole('img', { name: 'Song title matches' }).querySelector('path'))
      .toHaveAttribute('fill', 'currentColor');
    expect(screen.getByRole('img', { name: 'Artist matches' }).querySelector('path'))
      .toHaveAttribute('fill', 'currentColor');
    expect(screen.getByRole('img', { name: 'Album matches' }).querySelector('circle'))
      .toHaveAttribute('fill', 'currentColor');
    expect(electronAPI.searchLyrics).toHaveBeenCalledWith(
      'Selected song Test artist Test album',
      'Selected song',
      'Test artist'
    );
  });

  it('shows a browser folder file relative path under its playlist item', async () => {
    installBrowserMocks();
    renderApp({ tracks: [] });
    setWindowProperty('electronAPI', undefined);
    const file = new File(['audio'], 'Browser folder song.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: 'Album\\Browser folder song.mp3'
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.change(document.getElementById('addFolderInput') as HTMLInputElement, {
      target: { files: [file] }
    });

    const addedTrack = await screen.findByRole('option', { name: /Browser folder song/i });
    expect(addedTrack).toHaveTextContent('Album\\Browser folder song.mp3');
  });

  it('reads an added file once in StrictMode and replaces the active source without stopping playback', async () => {
    installBrowserMocks();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL
    });
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
    let resolveReadFile!: (result: { ok: boolean; data: string; mime: string }) => void;
    const readFile = vi.fn(() => new Promise<{ ok: boolean; data: string; mime: string }>(resolve => {
      resolveReadFile = resolve;
    }));
    let objectUrlIndex = 0;
    const objectUrls = ['blob:initial-file', 'blob:playback-file', 'blob:loaded-file'];
    const createObjectURL = vi.fn()
      .mockImplementation(() => objectUrls[objectUrlIndex++] || `blob:extra-${objectUrlIndex}`);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL
    });
    const { electronAPI } = renderApp({ strictMode: true, readFile });
    await screen.findByRole('option', { name: /First song/i });

    const file = new File(['audio'], 'Added song.mp3', { type: 'audio/mpeg' }) as File & { path?: string };
    Object.defineProperty(file, 'path', { value: 'C:\\music\\added.mp3' });
    fireEvent.change(document.getElementById('addFilesInput') as HTMLInputElement, {
      target: { files: [file] }
    });

    const addedTrack = await screen.findByRole('option', { name: /Added song/i });
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(addedTrack, { detail: 1 });
      fireEvent.click(addedTrack, { detail: 2 });
      fireEvent.doubleClick(addedTrack, { detail: 2 });
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:playback-file');

    await act(async () => {
      resolveReadFile({ ok: true, data: 'AQID', mime: 'audio/mpeg' });
    });

    await waitFor(() => {
      expect(document.querySelector('audio')).toHaveProperty('src', 'blob:loaded-file');
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(electronAPI.getCover).toHaveBeenCalledWith('C:\\music\\added.mp3', false);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:playback-file'));
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:loaded-file');
  });

  it('releases replaced and deleted media URLs, and releases remaining URLs on unmount', async () => {
    installBrowserMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const objectUrls = [
      'blob:first-initial',
      'blob:first-loaded',
      'blob:second-initial',
      'blob:second-loaded'
    ];
    const createObjectURL = vi.fn()
      .mockImplementation(() => objectUrls.shift() || 'blob:unexpected');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL
    });
    const { unmount } = renderApp();
    await screen.findByRole('option', { name: /First song/i });

    const firstFile = new File(['first'], 'First added.mp3', { type: 'audio/mpeg' }) as File & { path?: string };
    Object.defineProperty(firstFile, 'path', { value: 'C:\\music\\first-added.mp3' });
    fireEvent.change(document.getElementById('addFilesInput') as HTMLInputElement, {
      target: { files: [firstFile] }
    });
    await screen.findByRole('option', { name: /First added/i });
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:first-initial'));
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:first-loaded');

    const secondFile = new File(['second'], 'Second added.mp3', { type: 'audio/mpeg' }) as File & { path?: string };
    Object.defineProperty(secondFile, 'path', { value: 'C:\\music\\second-added.mp3' });
    fireEvent.change(document.getElementById('addFilesInput') as HTMLInputElement, {
      target: { files: [secondFile] }
    });
    const secondTrack = await screen.findByRole('option', { name: /Second added/i });
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:second-initial'));

    fireEvent.click(secondTrack, { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 selected playlist item' }));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:second-loaded'));
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:first-loaded');

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first-loaded');
  });

  it('lets the user browse for a folder and recursively split supported files', async () => {
    installBrowserMocks();
    localStorage.setItem('mediaLibraryPath', 'C:\\Media');
    const firstPath = 'C:\\Media\\Music\\first.mp3';
    const secondPath = 'C:\\Media\\Music\\second.flac';
    const { electronAPI } = renderApp({
      tracks: [{ id: `path:${firstPath}`, name: 'first.mp3', path: firstPath }],
      mediaFiles: [firstPath]
    });
    electronAPI.scanAudioFiles.mockResolvedValue({
      ok: true,
      files: [firstPath, secondPath]
    });
    electronAPI.splitAudioStems
      .mockResolvedValueOnce({
        ok: true,
        vocalsPath: 'C:\\Media\\Music_Vocals\\first.wav',
        accompanimentPath: 'C:\\Media\\Music_Accompaniments\\first.wav'
      })
      .mockResolvedValueOnce({ ok: false, error: 'separator unavailable' });
    electronAPI.chooseFolder.mockResolvedValue({
      canceled: false,
      paths: ['C:\\selected-folder']
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vocal Splitter' }));
    const folderInput = screen.getByRole('textbox', { name: 'Folder path' });
    const folderControlsRow = folderInput.parentElement;
    expect(folderControlsRow).toHaveStyle({ display: 'flex', alignItems: 'center' });
    expect(Array.from(folderControlsRow?.children ?? []).map(child => child.tagName)).toEqual([
      'LABEL',
      'INPUT',
      'BUTTON',
      'BUTTON',
      'BUTTON'
    ]);
    const browseButton = screen.getByRole('button', { name: 'Browse...' });
    expect(browseButton.querySelector('svg')).toBeInTheDocument();
    expect(browseButton).toHaveClass('icon-btn');
    fireEvent.click(browseButton);
    await waitFor(() => expect(folderInput).toHaveValue('C:\\selected-folder'));

    fireEvent.change(folderInput, { target: { value: 'C:\\Media' } });
    const recursiveButton = screen.getByRole('button', { name: 'Include subfolders (recursive)' });
    expect(recursiveButton).toHaveClass('icon-btn', 'player-media-role-button');
    expect(recursiveButton).toHaveStyle({ background: '#171717' });
    fireEvent.click(recursiveButton);
    expect(recursiveButton).toHaveAttribute('aria-pressed', 'true');
    expect(recursiveButton).toHaveStyle({ background: 'linear-gradient(135deg, #a4e8d1, #69c2a6)' });
    const splitButton = screen.getByRole('button', { name: 'Split' });
    expect(splitButton.querySelector('svg')).toBeInTheDocument();
    expect(splitButton).toHaveClass('icon-btn');
    fireEvent.click(splitButton);

    expect(await screen.findByText('Completed: 1 succeeded, 1 failed.')).toBeVisible();
    expect(electronAPI.scanAudioFiles).toHaveBeenCalledWith('C:\\Media', true);
    expect(electronAPI.splitAudioStems).toHaveBeenNthCalledWith(1, firstPath, 'C:\\Media');
    expect(electronAPI.splitAudioStems).toHaveBeenNthCalledWith(2, secondPath, 'C:\\Media');
    expect(screen.getByRole('list', { name: 'Vocal Splitter failures' }))
      .toHaveTextContent('second.flac: Error: separator unavailable');

    electronAPI.readdirRecursive.mockResolvedValueOnce({
      ok: true,
      files: [
        firstPath,
        'C:\\Media\\Music_Vocals\\first.wav',
        'C:\\Media\\Music_Accompaniments\\first.wav'
      ]
    });
    fireEvent.click(screen.getByRole('button', { name: 'Media library' }));
    const song = await screen.findByRole('option', { name: /first/i });
    expect(within(song).getByRole('img', { name: 'Accompaniments (伴奏) available' }).querySelector('svg')).toBeInTheDocument();
    expect(within(song).getByRole('img', { name: 'Vocals (人聲) available' }).querySelector('svg')).toBeInTheDocument();
  });

  it('does not run vocal separation when files are added to the playlist', async () => {
    installBrowserMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:added-file')
    });
    const { electronAPI } = renderApp({ tracks: [] });
    electronAPI.chooseFiles.mockResolvedValue({
      canceled: false,
      paths: ['C:\\music\\added.mp3']
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add files' }));
    await screen.findByRole('option', { name: /added/i });

    expect(electronAPI.splitAudioStems).not.toHaveBeenCalled();
    expect(electronAPI.scanAudioFiles).not.toHaveBeenCalled();
  });
});
