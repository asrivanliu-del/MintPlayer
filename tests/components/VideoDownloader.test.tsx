import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VideoDownloader from '../../src/renderer/tools/VideoDownloader';
import type {
  ElectronTorrentDownloadProgress,
  ElectronVideoDownloadProgress,
  ElectronVideoFormat,
  ElectronVideoMediaInfo
} from '../../src/electron/electronApi';
import { getMp3ConversionEstimate, getSourceAudioBitrate, recommendAudioFormats } from '../../src/renderer/tools/audioFormatRecommendations';
import { MEDIA_DOWNLOADER_RECENTS_KEY } from '../../src/renderer/tools/mediaDownloaderHistory';

const originalElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI');

function installElectronApi(
  listVideoFormats: ReturnType<typeof vi.fn>,
  downloadVideoFormat: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    ok: true,
    path: 'C:\\Users\\Test\\Downloads\\Sample.webm'
  }),
  downloadVideoThumbnail: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    ok: true,
    path: 'C:\\Users\\Test\\Downloads\\Sample.jpg'
  }),
  downloadVideoMp4: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    ok: true,
    path: 'C:\\Users\\Test\\Downloads\\Sample.mp4'
  }),
  onVideoDownloadProgress: (listener: (progress: ElectronVideoDownloadProgress) => void) => () => void = () => () => {},
  openDownloadedMediaFolder: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ ok: true }),
  openDownloadedMediaFile: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ ok: true }),
  searchVideoPlatforms: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    ok: true,
    youtube: [],
    bilibili: []
  })
) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      listVideoFormats,
      downloadVideoFormat,
      downloadVideoThumbnail,
      downloadVideoMp4,
      onVideoDownloadProgress,
      openDownloadedMediaFolder,
      openDownloadedMediaFile,
      searchVideoPlatforms
    }
  });
}

afterEach(() => {
  localStorage.removeItem(MEDIA_DOWNLOADER_RECENTS_KEY);
  if (originalElectronApi) Object.defineProperty(window, 'electronAPI', originalElectronApi);
  else Reflect.deleteProperty(window, 'electronAPI');
});

describe('VideoDownloader', () => {
  it('searches both platforms, displays six image cards each, and loads formats when a result is selected', async () => {
    const youtube = Array.from({ length: 6 }, (_, index) => ({
      id: `yt-${index + 1}`,
      url: `https://www.youtube.com/watch?v=yt-${index + 1}`,
      title: `YouTube result ${index + 1}`,
      thumbnailUrl: `https://img.example.com/yt-${index + 1}.jpg`
    }));
    const bilibili = Array.from({ length: 6 }, (_, index) => ({
      id: `BV${index + 1}`,
      url: `https://www.bilibili.com/video/BV${index + 1}`,
      title: `Bilibili result ${index + 1}`,
      thumbnailUrl: `https://i${index % 2}.hdslb.com/bfs/archive/bili-${index + 1}.jpg`
    }));
    const searchVideoPlatforms = vi.fn().mockResolvedValue({ ok: true, youtube, bilibili });
    const listVideoFormats = vi.fn().mockResolvedValue({
      ok: true,
      title: 'Selected result',
      formats: []
    });
    installElectronApi(
      listVideoFormats,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      searchVideoPlatforms
    );
    render(<VideoDownloader />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search YouTube and Bilibili' }), {
      target: { value: 'sample query' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    const searchRegion = await screen.findByRole('region', { name: 'Video search results' });
    expect(searchRegion).toBeVisible();
    expect(searchRegion).toHaveClass('video-downloader-results');
    expect(searchRegion).toHaveStyle({ flex: '1 1 auto', minHeight: '0px', overflowY: 'auto' });
    expect(searchVideoPlatforms).toHaveBeenCalledWith('sample query');
    expect(within(screen.getByRole('region', { name: 'YouTube results' })).getAllByRole('button')).toHaveLength(6);
    expect(within(screen.getByRole('region', { name: 'Bilibili results' })).getAllByRole('button')).toHaveLength(6);
    expect(within(screen.getByRole('region', { name: 'YouTube results' }).querySelector('button')!)
      .getByAltText('')).toHaveAttribute('src', youtube[0].thumbnailUrl);
    expect(within(screen.getByRole('region', { name: 'Bilibili results' }).querySelector('button')!)
      .getByAltText('')).toHaveAttribute('src', bilibili[0].thumbnailUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Use Bilibili result: Bilibili result 1' }));
    await waitFor(() => expect(listVideoFormats).toHaveBeenCalledWith(bilibili[0].url));
    expect(screen.getByRole('textbox', { name: 'Video URL' })).toHaveValue(bilibili[0].url);
    expect(await screen.findByRole('heading', { name: 'Selected result' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Video search results' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search YouTube and Bilibili' }), {
      target: { value: 'another query' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('region', { name: 'Video search results' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Available video formats' })).not.toBeInTheDocument();
  });

  it('shows provider errors and empty results without hiding the other platform section', async () => {
    const searchVideoPlatforms = vi.fn().mockResolvedValue({
      ok: true,
      youtube: [],
      bilibili: [],
      errors: { youtube: 'YouTube search failed.' }
    });
    installElectronApi(vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, searchVideoPlatforms);
    render(<VideoDownloader />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search YouTube and Bilibili' }), {
      target: { value: 'sample query' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('YouTube search failed.')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Bilibili results' })).getByText('No results found.')).toBeVisible();
  });

  it('shows loading in the URL submit button for video and playlist lookups', async () => {
    let resolveVideoLookup!: (value: {
      ok: true;
      title: string;
      formats: ElectronVideoFormat[];
    }) => void;
    let resolvePlaylistLookup!: (value: {
      ok: true;
      title: string;
      entries: Extract<ElectronVideoMediaInfo, { entries: unknown }>['entries'];
    }) => void;
    const listVideoFormats = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveVideoLookup = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolvePlaylistLookup = resolve; }));
    installElectronApi(listVideoFormats);
    render(<VideoDownloader />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    const submitButton = screen.getByRole('button', { name: 'Download' });
    expect(submitButton.querySelector('svg')).toBeInTheDocument();
    expect(submitButton).toHaveClass('icon-btn');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    const loadingButton = await screen.findByRole('button', { name: 'Loading formats' });
    expect(loadingButton).not.toHaveTextContent('Download');
    expect(loadingButton.querySelector('.tag-editor-info-search-spinner')).toBeInTheDocument();

    await act(async () => {
      resolveVideoLookup({ ok: true, title: 'Sample video', formats: [] });
    });
    expect(await screen.findByRole('heading', { name: 'Sample video' })).toBeVisible();

    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/playlist?id=sample' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    const playlistLoadingButton = await screen.findByRole('button', { name: 'Loading formats' });
    expect(playlistLoadingButton.querySelector('.tag-editor-info-search-spinner')).toBeInTheDocument();

    await act(async () => {
      resolvePlaylistLookup({
        ok: true,
        title: 'Sample playlist',
        entries: [{
          index: 1,
          id: 'one',
          url: 'https://example.com/watch?v=1',
          title: 'First item',
          formats: [],
          formatsLoaded: false
        }]
      });
    });
    expect(await screen.findByRole('region', { name: 'Playlist items' })).toBeVisible();
  });

  it('requests formats for the entered URL and shows audio and video format lists', async () => {
    const formats: ElectronVideoFormat[] = [
      {
        formatId: '251',
        extension: 'webm',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'opus',
        audioBitrate: 160,
        sampleRate: 48000,
        audioChannels: 2,
        duration: 120,
        fileSize: 2400000,
        hasVideo: false,
        hasAudio: true
      },
      {
        formatId: '140',
        extension: 'm4a',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'mp4a.40.2',
        audioBitrate: 128,
        sampleRate: 44100,
        audioChannels: 2,
        duration: 120,
        fileSize: 2000000,
        hasVideo: false,
        hasAudio: true
      },
      {
        formatId: '250',
        extension: 'webm',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'opus',
        audioBitrate: 70,
        sampleRate: 48000,
        audioChannels: 2,
        duration: 120,
        fileSize: 1100000,
        hasVideo: false,
        hasAudio: true
      },
      {
        formatId: '249',
        extension: 'webm',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'opus',
        audioBitrate: 50,
        sampleRate: 48000,
        audioChannels: 2,
        duration: 120,
        fileSize: 900000,
        hasVideo: false,
        hasAudio: true
      },
      {
        formatId: '137',
        extension: 'mp4',
        resolution: '1920x1080',
        note: '',
        videoCodec: 'avc1.640028',
        audioCodec: 'none',
        audioBitrate: null,
        sampleRate: null,
        audioChannels: null,
        duration: null,
        fileSize: null,
        hasVideo: true,
        hasAudio: false
      },
      {
        formatId: '247-sr',
        extension: 'webm',
        resolution: '960x720',
        note: '720p, AI-upscaled',
        videoCodec: 'vp9',
        audioCodec: 'none',
        fileSize: 11500000,
        hasVideo: true,
        hasAudio: false
      },
      {
        formatId: '22',
        extension: 'mp4',
        resolution: '1280x720',
        note: '720p',
        videoCodec: 'avc1.64001F',
        audioCodec: 'mp4a.40.2',
        fileSize: 5000000,
        hasVideo: true,
        hasAudio: true
      }
    ];
    const listVideoFormats = vi.fn().mockResolvedValue({
      ok: true,
      title: 'Sample video',
      thumbnailUrl: 'https://img.example.com/sample.jpg',
      formats
    });

    installElectronApi(listVideoFormats);
    const { container } = render(<VideoDownloader mediaLibraryPath={'C:\\Media'} />);

    expect(screen.queryByText('Enter a video or playlist URL to inspect available audio and video formats.')).not.toBeInTheDocument();
    expect(screen.getByText('URL')).toBeVisible();
    const urlForm = container.querySelector('#video-downloader-url')?.closest('form');
    expect(urlForm).toHaveStyle({ display: 'flex', flexWrap: 'nowrap', alignItems: 'center' });
    expect(Array.from(urlForm?.children ?? []).map(child => child.tagName)).toEqual([
      'LABEL',
      'INPUT',
      'BUTTON',
      'BUTTON',
      'BUTTON'
    ]);

    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(listVideoFormats).toHaveBeenCalledWith('https://example.com/watch?v=1'));
    expect(await screen.findByRole('heading', { name: 'Sample video' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Video thumbnail preview' })).toHaveAttribute(
      'src',
      'https://img.example.com/sample.jpg'
    );
    const results = screen.getByRole('region', { name: 'Available video formats' });
    expect(results).toHaveClass('video-downloader-results');
    expect(results).toHaveStyle({ overflowY: 'auto', minHeight: '0px' });
    const audioRegion = screen.getByRole('region', { name: 'Audio formats' });
    const audioCards = within(audioRegion).getAllByRole('article');
    expect(audioCards).toHaveLength(3);
    expect(audioCards[0]).toHaveStyle({ padding: '10px' });
    expect(audioCards[0]).toHaveAccessibleName('Audio recommendation 1: format 251');
    expect(audioCards[0]).toHaveTextContent('251 · WEBM');
    expect(audioCards[1]).toHaveTextContent('140 · M4A');
    expect(audioCards[2]).toHaveTextContent('250 · WEBM');
    expect(within(audioRegion).queryByText(/249 · WEBM/)).not.toBeInTheDocument();
    expect(audioCards[0]).toHaveTextContent('MP3 estimate: 320 kbps · 48 kHz · Stereo · ~4.6 MB');
    expect(within(audioCards[0]).getByRole('button', { name: 'Download WEBM format 251' })).toBeVisible();
    expect(within(audioCards[0]).getByRole('button', { name: 'Download MP3 format 251' })).toBeVisible();
    for (const card of audioCards) {
      expect(within(card).getAllByRole('button')).toHaveLength(2);
    }
    const videoRegion = screen.getByRole('region', { name: 'Video formats' });
    const videoCards = within(videoRegion).getAllByRole('article');
    expect(videoCards).toHaveLength(2);
    expect(videoCards[0]).toHaveStyle({ padding: '10px' });
    expect(videoCards[0]).toHaveAccessibleName('Video recommendation 1: format 137');
    expect(videoCards[0]).toHaveTextContent('1920x1080');
    expect(videoCards[0]).toHaveTextContent('無聲音');
    expect(videoCards[1]).toHaveAccessibleName('Video recommendation 2: format 22');
    expect(within(videoRegion).queryByLabelText('AI-upscaled')).not.toBeInTheDocument();

    const aiUpscaleButton = screen.getByRole('button', { name: 'AI upscaled formats: Off' });
    expect(aiUpscaleButton).toHaveAttribute('aria-pressed', 'false');
    expect(aiUpscaleButton.querySelector('svg')).toBeInTheDocument();
    expect(aiUpscaleButton.querySelector('svg text')).toHaveTextContent('AI');
    expect(aiUpscaleButton.querySelector('svg path')).toHaveAttribute('d', 'M22 17V4m-4 4 4-4 4 4');
    expect(aiUpscaleButton).toHaveClass('icon-btn', 'player-media-role-button');
    expect(aiUpscaleButton).toHaveStyle({ background: '#171717' });
    expect(aiUpscaleButton).not.toHaveTextContent(/\b(On|Off)\b/);
    fireEvent.click(aiUpscaleButton);
    const enabledAiUpscaleButton = screen.getByRole('button', { name: 'AI upscaled formats: On' });
    expect(enabledAiUpscaleButton).toHaveAttribute('aria-pressed', 'true');
    expect(enabledAiUpscaleButton.querySelector('svg text')).toHaveTextContent('AI');
    expect(enabledAiUpscaleButton.querySelector('svg path')).toBeInTheDocument();
    expect(enabledAiUpscaleButton).toHaveClass('icon-btn', 'player-media-role-button');
    expect(enabledAiUpscaleButton).not.toHaveTextContent(/\b(On|Off)\b/);
    expect(enabledAiUpscaleButton).toHaveStyle({
      background: 'linear-gradient(135deg, #a4e8d1, #69c2a6)',
      color: '#18251f',
      border: '1px solid rgba(190,245,220,0.62)',
      boxShadow: '0 8px 22px rgba(84,185,158,0.24)'
    });
    const aiIncludedCards = within(videoRegion).getAllByRole('article');
    expect(aiIncludedCards).toHaveLength(3);
    expect(aiIncludedCards[2]).toHaveAccessibleName('Video recommendation 3: format 247-sr');
    expect(within(aiIncludedCards[2]).getByLabelText('AI-upscaled')).toBeVisible();
    expect(within(aiIncludedCards[2]).getByRole('button', { name: 'Download MP4 format 247-sr' })).toBeVisible();
  });

  it('keeps the three most recent successful URLs selectable and lets the user clear the URL', async () => {
    const listVideoFormats = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      title: `Title ${url.split('/').pop()}`,
      thumbnailUrl: `https://img.example.com/${url.split('/').pop()}.jpg`,
      formats: []
    }));
    installElectronApi(listVideoFormats);
    render(<VideoDownloader mediaLibraryPath={'C:\\Media'} />);
    const input = screen.getByRole('textbox', { name: 'Video URL' });

    for (const id of ['one', 'two', 'three']) {
      fireEvent.change(input, { target: { value: `https://example.com/${id}` } });
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      await waitFor(() => expect(listVideoFormats).toHaveBeenCalledTimes(['one', 'two', 'three'].indexOf(id) + 1));
    }

    fireEvent.change(input, { target: { value: 'https://example.com/one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(listVideoFormats).toHaveBeenCalledTimes(4));

    const recent = screen.getByRole('region', { name: 'Recent video URLs' });
    const recentButtons = within(recent).getAllByRole('button');
    expect(recentButtons).toHaveLength(3);
    expect(recentButtons.map(button => button.textContent)).toEqual([
      'Title one',
      'Title three',
      'Title two'
    ]);
    expect(recentButtons[0]).toHaveAttribute('title', 'Title one');
    expect(within(recentButtons[0]).getByRole('img')).toHaveAttribute('src', 'https://img.example.com/one.jpg');
    expect(within(recentButtons[0]).getByRole('img')).toHaveStyle({ width: '24px', height: '24px' });
    expect(within(recentButtons[0]).getByText('Title one')).toHaveStyle({ fontSize: '11px' });
    expect(recent).toHaveStyle({ display: 'flex' });
    expect(JSON.parse(localStorage.getItem(MEDIA_DOWNLOADER_RECENTS_KEY) || '[]')).toEqual([
      { url: 'https://example.com/one', title: 'Title one', thumbnailUrl: 'https://img.example.com/one.jpg' },
      { url: 'https://example.com/three', title: 'Title three', thumbnailUrl: 'https://img.example.com/three.jpg' },
      { url: 'https://example.com/two', title: 'Title two', thumbnailUrl: 'https://img.example.com/two.jpg' }
    ]);

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use recent URL Title three' }));
    expect(input).toHaveValue('https://example.com/three');
    await waitFor(() => expect(listVideoFormats).toHaveBeenCalledTimes(5));
    expect(await screen.findByRole('heading', { name: 'Title three' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Clear video URL' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Sample video' })).not.toBeInTheDocument();
  });

  it('uses the first playlist video thumbnail in its recent URL tag', async () => {
    installElectronApi(vi.fn().mockResolvedValue({
      ok: true,
      title: 'Sample playlist',
      thumbnailUrl: null,
      entries: [{
        index: 1,
        id: 'first',
        url: 'https://example.com/watch/first',
        title: 'First video',
        thumbnailUrl: 'https://img.example.com/first.jpg',
        formats: [],
        formatsLoaded: false
      }]
    }));
    render(<VideoDownloader />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/playlist?id=sample' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    const recentButton = await screen.findByRole('button', { name: 'Use recent URL Sample playlist' });
    expect(within(recentButton).getByRole('img', { name: 'Thumbnail for Sample playlist' }))
      .toHaveAttribute('src', 'https://img.example.com/first.jpg');
    expect(JSON.parse(localStorage.getItem(MEDIA_DOWNLOADER_RECENTS_KEY) || '[]')).toEqual([{
      url: 'https://example.com/playlist?id=sample',
      title: 'Sample playlist',
      thumbnailUrl: 'https://img.example.com/first.jpg'
    }]);
  });

  it('loads formats when a playlist card is clicked and batch downloads mint-highlighted choices', async () => {
    const audioFormat: ElectronVideoFormat = {
      formatId: '251',
      extension: 'webm',
      resolution: 'Audio only',
      note: '',
      videoCodec: 'none',
      audioCodec: 'opus',
      audioBitrate: 160,
      sampleRate: 48000,
      audioChannels: 2,
      duration: 120,
      fileSize: 2400000,
      hasVideo: false,
      hasAudio: true
    };
    const audioFormat2: ElectronVideoFormat = {
      ...audioFormat,
      formatId: '140',
      extension: 'm4a',
      audioCodec: 'mp4a.40.2',
      audioBitrate: 128,
      fileSize: 2000000
    };
    const silentVideoFormat: ElectronVideoFormat = {
      ...audioFormat,
      formatId: '137',
      extension: 'mp4',
      resolution: '1920x1080',
      videoCodec: 'avc1.640028',
      audioCodec: 'none',
      audioBitrate: null,
      sampleRate: null,
      audioChannels: null,
      fileSize: 12000000,
      hasVideo: true,
      hasAudio: false
    };
    const downloadVideoFormat = vi.fn().mockResolvedValue({
      ok: true,
      path: 'C:\\Media\\Downloads\\First.mp3'
    });
    const downloadVideoMp4 = vi.fn().mockResolvedValue({
      ok: true,
      path: 'C:\\Media\\Downloads\\Second.mp4'
    });
    let resolveFirstFormatLookup: ((value: {
      ok: true;
      title: string;
      thumbnailUrl?: string | null;
      formats: ElectronVideoFormat[];
    }) => void) | undefined;
    const listVideoFormats = vi.fn().mockImplementation(async (url: string) => {
      if (url === 'https://example.com/playlist?id=sample') {
        return {
          ok: true,
          title: 'Sample playlist',
          entries: [
            {
              index: 1,
              id: 'first',
              url: 'https://example.com/watch/first',
              title: 'First song',
              thumbnailUrl: null,
              formats: [],
              formatsLoaded: false
            },
            {
              index: 2,
              id: 'second',
              url: 'https://example.com/watch/second',
              title: 'Second video',
              thumbnailUrl: 'https://img.example.com/second.jpg',
              formats: [],
              formatsLoaded: false
            }
          ]
        };
      }
      if (url === 'https://example.com/watch/first') {
        return await new Promise(resolve => {
          resolveFirstFormatLookup = resolve;
        });
      }
      if (url === 'https://example.com/watch/second') {
        return { ok: true, title: 'Second video', formats: [audioFormat2, silentVideoFormat] };
      }
      return { ok: false, error: 'Unexpected test URL.' };
    });
    installElectronApi(
      listVideoFormats,
      downloadVideoFormat,
      undefined,
      downloadVideoMp4
    );
    render(<VideoDownloader mediaLibraryPath={'C:\\Media'} showThumbnail={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/playlist?id=sample' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    const playlistRegion = await screen.findByRole('region', { name: 'Playlist items' });
    const firstItem = within(playlistRegion).getByRole('article', { name: 'Playlist item 1: First song' });
    const secondItem = within(playlistRegion).getByRole('article', { name: 'Playlist item 2: Second video' });
    expect(within(firstItem).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(secondItem).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(firstItem).queryByText('Click this card to load formats')).not.toBeInTheDocument();
    const scrollList = playlistRegion.querySelector('div[style*="max-height"]');
    expect(scrollList).toHaveStyle({ maxHeight: '520px', overflowY: 'auto' });
    expect(scrollList).toHaveStyle({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' });
    expect(within(playlistRegion).queryByRole('button', { name: /Load formats/ })).not.toBeInTheDocument();
    expect(within(playlistRegion).queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument();
    expect(within(secondItem).getByRole('img', { name: 'Thumbnail for Second video' })).toHaveAttribute('src', 'https://img.example.com/second.jpg');
    expect(listVideoFormats).toHaveBeenCalledTimes(1);

    fireEvent.click(firstItem);
    expect(await within(firstItem).findByText('Loading...')).toBeVisible();
    expect(within(playlistRegion).queryByRole('status', { name: 'Loading formats' })).not.toBeInTheDocument();
    expect(within(firstItem).getByText('Loading...').parentElement?.querySelector('.tag-editor-info-search-spinner')).toBeInTheDocument();
    await act(async () => {
      resolveFirstFormatLookup?.({
        ok: true,
        title: 'First song',
        thumbnailUrl: 'https://img.example.com/first-loaded.jpg',
        formats: [audioFormat]
      });
    });
    await waitFor(() => {
      expect(listVideoFormats).toHaveBeenCalledTimes(2);
      expect(within(firstItem).getByRole('button', { name: 'Select MP3 format 251 for download' })).toBeVisible();
      expect(within(firstItem).getByRole('img', { name: 'Thumbnail for First song' })).toHaveAttribute('src', 'https://img.example.com/first-loaded.jpg');
    });
    const downloadSelectedButton = within(playlistRegion).getByRole('button', { name: 'Download Selected (0)' });
    expect(downloadSelectedButton).toBeDisabled();
    fireEvent.click(within(firstItem).getByRole('button', { name: 'Select MP3 format 251 for download' }));
    expect(firstItem).toHaveStyle({ background: 'linear-gradient(135deg, rgba(141,217,193,0.38), rgba(100,185,159,0.3))' });
    expect(within(firstItem).getByText('Selected: WEBM 251 → MP3')).toBeVisible();
    expect(within(firstItem).queryByRole('button', { name: 'Select MP3 format 251 for download' })).not.toBeInTheDocument();
    fireEvent.click(firstItem);
    expect(within(firstItem).getByRole('button', { name: 'Select MP3 format 251 for download' })).toBeVisible();
    fireEvent.click(firstItem);
    expect(within(firstItem).queryByRole('button', { name: 'Select MP3 format 251 for download' })).not.toBeInTheDocument();
    expect(within(playlistRegion).getByRole('button', { name: 'Download Selected (1)' })).toBeEnabled();

    fireEvent.click(secondItem);
    expect(await within(secondItem).findByRole('button', { name: 'Select MP4 format 137 for download' })).toBeVisible();
    expect(listVideoFormats).toHaveBeenCalledTimes(3);
    fireEvent.click(within(secondItem).getByRole('button', { name: 'Select MP4 format 137 for download' }));
    expect(secondItem).toHaveStyle({ background: 'linear-gradient(135deg, rgba(141,217,193,0.38), rgba(100,185,159,0.3))' });
    expect(within(secondItem).getByText('Selected: MP4 1920x1080 (137)')).toBeVisible();
    expect(within(secondItem).queryByRole('button', { name: 'Select MP4 format 137 for download' })).not.toBeInTheDocument();

    const downloadTwoSelectedButton = within(playlistRegion).getByRole('button', { name: 'Download Selected (2)' });
    expect(downloadTwoSelectedButton).toBeEnabled();
    fireEvent.click(downloadTwoSelectedButton);

    await waitFor(() => {
      expect(downloadVideoFormat).toHaveBeenCalledWith(
        'https://example.com/watch/first',
        '251',
        true,
        'C:\\Media'
      );
      expect(downloadVideoMp4).toHaveBeenCalledWith(
        'https://example.com/watch/second',
        '137',
        '140',
        'C:\\Media'
      );
    });
    expect(await screen.findByText('Downloaded all 2 selected playlist items.')).toBeVisible();
    expect(within(firstItem).getByText('Downloaded')).toBeVisible();
    expect(within(secondItem).getByText('Downloaded')).toBeVisible();
    const progressRegion = screen.getByRole('status', { name: 'Download progress' });
    expect(within(progressRegion).getByRole('button', { name: 'Open Folder' })).toBeVisible();
    expect(within(progressRegion).queryByRole('button', { name: 'Open File' })).not.toBeInTheDocument();
  });

  it('shows Open File after downloading one selected playlist item', async () => {
    const format: ElectronVideoFormat = {
      formatId: '251',
      extension: 'webm',
      resolution: 'Audio only',
      note: '',
      videoCodec: 'none',
      audioCodec: 'opus',
      audioBitrate: 160,
      sampleRate: 48000,
      audioChannels: 2,
      duration: 120,
      fileSize: 2400000,
      hasVideo: false,
      hasAudio: true
    };
    const listVideoFormats = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        title: 'Single-item playlist',
        entries: [{
          index: 1,
          id: 'only',
          url: 'https://example.com/watch/only',
          title: 'Only song',
          formats: [],
          formatsLoaded: false
        }]
      })
      .mockResolvedValueOnce({ ok: true, title: 'Only song', formats: [format] });
    installElectronApi(
      listVideoFormats,
      vi.fn().mockResolvedValue({ ok: true, path: 'C:\\Media\\Downloads\\Only.mp3' })
    );
    render(<VideoDownloader mediaLibraryPath={'C:\\Media'} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/playlist?id=only' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    const playlistRegion = await screen.findByRole('region', { name: 'Playlist items' });
    const item = within(playlistRegion).getByRole('article', { name: 'Playlist item 1: Only song' });
    fireEvent.click(item);
    fireEvent.click(await within(item).findByRole('button', { name: 'Select MP3 format 251 for download' }));
    fireEvent.click(within(playlistRegion).getByRole('button', { name: 'Download Selected (1)' }));

    const progressRegion = await screen.findByRole('status', { name: 'Download progress' });
    expect(within(progressRegion).getByRole('button', { name: 'Open Folder' })).toBeVisible();
    expect(within(progressRegion).getByRole('button', { name: 'Open File' })).toBeVisible();
  });

  it('downloads the displayed thumbnail to Downloads when clicked', async () => {
    const downloadVideoThumbnail = vi.fn().mockResolvedValue({
      ok: true,
      path: 'C:\\Media\\Downloads\\Sample.jpg'
    });
    installElectronApi(vi.fn().mockResolvedValue({
      ok: true,
      title: 'Sample video',
      thumbnailUrl: 'https://img.example.com/sample.jpg',
      formats: []
    }), vi.fn(), downloadVideoThumbnail);
    render(<VideoDownloader mediaLibraryPath={'C:\\Media'} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download video thumbnail' }));

    await waitFor(() => expect(downloadVideoThumbnail).toHaveBeenCalledWith('https://example.com/watch?v=1', 'C:\\Media'));
    expect(await screen.findByText(/Thumbnail downloaded to .*Sample\.jpg/)).toBeVisible();
  });

  it('downloads the selected source format or converts it to MP3', async () => {
    const downloadVideoFormat = vi.fn().mockResolvedValue({
      ok: true,
      path: 'C:\\Users\\Test\\Downloads\\Sample.mp3'
    });
    installElectronApi(vi.fn().mockResolvedValue({
      ok: true,
      title: 'Sample video',
      formats: [{
        formatId: '251',
        extension: 'webm',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'opus',
        audioBitrate: 160,
        sampleRate: 48000,
        audioChannels: 2,
        duration: 120,
        fileSize: 2400000,
        hasVideo: false,
        hasAudio: true
      }]
    }), downloadVideoFormat);
    render(<VideoDownloader mediaLibraryPath={'C:\\Media'} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    const sourceButton = await screen.findByRole('button', { name: 'Download WEBM format 251' });
    fireEvent.click(sourceButton);
    await waitFor(() => expect(downloadVideoFormat).toHaveBeenCalledWith(
      'https://example.com/watch?v=1',
      '251',
      false,
      'C:\\Media'
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Download MP3 format 251' }));
    await waitFor(() => expect(downloadVideoFormat).toHaveBeenLastCalledWith(
      'https://example.com/watch?v=1',
      '251',
      true,
      'C:\\Media'
    ));
    expect(await screen.findByRole('button', { name: 'Open File' })).toBeVisible();
    expect(screen.queryByText(/Downloaded to /)).not.toBeInTheDocument();
  });

  it('shows the current title, percentage, and progress bar during a download', async () => {
    let reportProgress: ((progress: ElectronVideoDownloadProgress) => void) | undefined;
    let finishDownload: ((response: { ok: true; path: string }) => void) | undefined;
    const onLog = vi.fn();
    const openDownloadedMediaFolder = vi.fn().mockResolvedValue({ ok: true });
    const openDownloadedMediaFile = vi.fn().mockResolvedValue({ ok: true });
    const downloadVideoFormat = vi.fn(() => new Promise<{ ok: true; path: string }>(resolve => {
      finishDownload = resolve;
    }));
    installElectronApi(
      vi.fn().mockResolvedValue({
        ok: true,
        title: 'Result title',
        formats: [{
          formatId: '251',
          extension: 'webm',
          resolution: 'Audio only',
          note: '',
          videoCodec: 'none',
          audioCodec: 'opus',
          fileSize: null,
          hasVideo: false,
          hasAudio: true
        }]
      }),
      downloadVideoFormat,
      undefined,
      undefined,
      listener => {
        reportProgress = listener;
        return () => { reportProgress = undefined; };
      },
      openDownloadedMediaFolder,
      openDownloadedMediaFile
    );
    render(<VideoDownloader mediaLibraryPath={'C:\\Media'} onLog={onLog} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download WEBM format 251' }));

    await waitFor(() => expect(reportProgress).toBeDefined());
    const progressRegion = screen.getByRole('status', { name: 'Download progress' });
    expect(progressRegion).toHaveTextContent('Waiting for progress...');
    expect(within(progressRegion).getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    act(() => reportProgress?.({ title: '孫燕姿 - 遇見 Encounter', percent: 20 }));

    expect(progressRegion).toHaveTextContent('孫燕姿 - 遇見 Encounter');
    expect(progressRegion).toHaveTextContent('20%');
    const progressBar = within(progressRegion).getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '20');
    expect(progressBar.firstElementChild).toHaveStyle({ width: '20%' });
    expect(progressRegion.children[1]).toHaveStyle({ height: '28px' });
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('renderer received progress'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('percent=20'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('bar===--------'));

    finishDownload?.({ ok: true, path: 'C:\\Media\\Downloads\\Sample.webm' });
    expect(await within(progressRegion).findByRole('img', { name: 'Download complete' })).toBeVisible();
    expect(screen.queryByText(/Downloaded to /)).not.toBeInTheDocument();
    expect(progressRegion.firstElementChild).toHaveStyle({ marginBottom: '8px' });
    expect(progressRegion.children[1]).toHaveStyle({ height: '28px' });
    expect(within(progressRegion).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(progressRegion).getByRole('img', { name: 'Download complete' })).toBeVisible();
    expect(within(progressRegion).getByRole('button', { name: 'Open Folder' })).toBeVisible();
    expect(within(progressRegion).getByRole('button', { name: 'Open File' })).toBeVisible();
    fireEvent.click(within(progressRegion).getByRole('button', { name: 'Open Folder' }));
    fireEvent.click(within(progressRegion).getByRole('button', { name: 'Open File' }));
    await waitFor(() => {
      expect(openDownloadedMediaFolder).toHaveBeenCalledWith('C:\\Media\\Downloads\\Sample.webm');
      expect(openDownloadedMediaFile).toHaveBeenCalledWith('C:\\Media\\Downloads\\Sample.webm');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Download WEBM format 251' }));
    const nextProgressRegion = screen.getByRole('status', { name: 'Download progress' });
    expect(within(nextProgressRegion).getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(within(nextProgressRegion).queryByRole('button', { name: 'Open File' })).not.toBeInTheDocument();
    expect(within(nextProgressRegion).queryByRole('img', { name: 'Download complete' })).not.toBeInTheDocument();
  });

  it('requires a configured media library location before downloading', async () => {
    const downloadVideoFormat = vi.fn();
    installElectronApi(vi.fn().mockResolvedValue({
      ok: true,
      title: 'Sample video',
      formats: [{
        formatId: '251',
        extension: 'webm',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'opus',
        fileSize: null,
        hasVideo: false,
        hasAudio: true
      }]
    }), downloadVideoFormat);
    render(<VideoDownloader />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download WEBM format 251' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Set the media library location in Config');
    expect(downloadVideoFormat).not.toHaveBeenCalled();
  });

  it('downloads video as MP4 and combines the top audio recommendation when the video has no audio', async () => {
    const downloadVideoMp4 = vi.fn().mockResolvedValue({
      ok: true,
      path: 'C:\\Users\\Test\\Downloads\\Sample.mp4'
    });
    installElectronApi(vi.fn().mockResolvedValue({
      ok: true,
      title: 'Sample video',
      formats: [
        {
          formatId: '251',
          extension: 'webm',
          resolution: 'Audio only',
          note: '',
          videoCodec: 'none',
          audioCodec: 'opus',
          audioBitrate: 160,
          sampleRate: 48000,
          audioChannels: 2,
          duration: 120,
          fileSize: 2400000,
          hasVideo: false,
          hasAudio: true
        },
        {
          formatId: '137',
          extension: 'mp4',
          resolution: '1920x1080',
          note: '',
          videoCodec: 'avc1.640028',
          audioCodec: 'none',
          fileSize: 11500000,
          hasVideo: true,
          hasAudio: false
        },
        {
          formatId: '22',
          extension: 'mp4',
          resolution: '1280x720',
          note: '',
          videoCodec: 'avc1.64001F',
          audioCodec: 'mp4a.40.2',
          fileSize: 5000000,
          hasVideo: true,
          hasAudio: true
        }
      ]
    }), undefined, undefined, downloadVideoMp4);
    render(<VideoDownloader mediaLibraryPath={'C:\\Media'} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download MP4 format 137' }));

    await waitFor(() => expect(downloadVideoMp4).toHaveBeenCalledWith(
      'https://example.com/watch?v=1',
      '137',
      '251',
      'C:\\Media'
    ));
    fireEvent.click(within(screen.getByRole('region', { name: 'Video formats' })).getByRole(
      'button',
      { name: 'Download MP4 format 22' }
    ));
    await waitFor(() => expect(downloadVideoMp4).toHaveBeenLastCalledWith(
      'https://example.com/watch?v=1',
      '22',
      null,
      'C:\\Media'
    ));
    expect(await screen.findByRole('button', { name: 'Open File' })).toBeVisible();
    expect(screen.queryByText(/Downloaded to /)).not.toBeInTheDocument();
  });

  it('shows an explicit error when MP3 conversion requires missing FFmpeg', async () => {
    const downloadVideoFormat = vi.fn().mockResolvedValue({
      ok: false,
      error: 'MP3 conversion requires FFmpeg. Install FFmpeg and add it to PATH.'
    });
    installElectronApi(vi.fn().mockResolvedValue({
      ok: true,
      title: 'Sample video',
      formats: [{
        formatId: '140',
        extension: 'm4a',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'mp4a.40.2',
        audioBitrate: 128,
        fileSize: null,
        hasVideo: false,
        hasAudio: true
      }]
    }), downloadVideoFormat);
    render(<VideoDownloader mediaLibraryPath="C:\\Media" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download MP3 format 140' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('requires FFmpeg');
  });

  describe('audio format recommendations', () => {
    const format: ElectronVideoFormat = {
      formatId: '251',
      extension: 'webm',
      resolution: 'Audio only',
      note: '',
      videoCodec: 'none',
      audioCodec: 'opus',
      audioBitrate: 160,
      sampleRate: 96000,
      audioChannels: 2,
      duration: 120,
      fileSize: 2400000,
      hasVideo: false,
      hasAudio: true
    };

    it('limits results to audio formats, sorts by estimated quality, and honors the requested limit', () => {
      const lowQuality = { ...format, formatId: 'low', audioBitrate: 48 };
      const video = { ...format, formatId: 'video', hasAudio: false, hasVideo: true };
      const combinedAudioVideo = { ...format, formatId: 'combined', hasVideo: true };

      expect(recommendAudioFormats([lowQuality, video, combinedAudioVideo, format], 1).map(item => item.formatId)).toEqual(['251']);
      expect(recommendAudioFormats([lowQuality, video, combinedAudioVideo, format], 0)).toEqual([]);
    });

    it('estimates an MP3 conversion without upsampling rate or channels', () => {
      expect(getMp3ConversionEstimate(format)).toEqual({
        bitrate: 320,
        sampleRate: 48000,
        channels: 2,
        fileSize: 4_800_000
      });
      expect(getMp3ConversionEstimate({
        ...format,
        formatId: 'legacy-aac',
        audioCodec: 'mp4a.40.2',
        audioBitrate: null,
        fileSize: null,
        duration: null
      })).toBeNull();
      expect(getMp3ConversionEstimate({ ...format, audioBitrate: 96 })).toMatchObject({ bitrate: 192 });
    });

    it('derives bitrate from file size and duration when yt-dlp omits bitrate metadata', () => {
      const formatWithoutBitrate = { ...format, audioBitrate: undefined, fileSize: 2_400_000, duration: 120 };

      expect(getSourceAudioBitrate(formatWithoutBitrate)).toBe(160);
      expect(getMp3ConversionEstimate(formatWithoutBitrate)).toMatchObject({
        bitrate: 320,
        fileSize: 4_800_000
      });
    });

    it('uses common YouTube Opus format IDs when bitrate and duration metadata are missing', () => {
      const opusFormat = { ...format, audioBitrate: null, fileSize: null, duration: null };
      expect(getSourceAudioBitrate({ ...opusFormat, formatId: '249' })).toBe(50);
      expect(getSourceAudioBitrate({ ...opusFormat, formatId: '250' })).toBe(70);
      expect(getSourceAudioBitrate({ ...opusFormat, formatId: '251' })).toBe(160);
      expect(getMp3ConversionEstimate({ ...opusFormat, formatId: '251' })).toMatchObject({
        bitrate: 320,
        fileSize: null
      });
    });
  });

  it('shows yt-dlp errors to the user', async () => {
    const listVideoFormats = vi.fn().mockResolvedValue({ ok: false, error: 'yt-dlp was not found.' });
    installElectronApi(listVideoFormats);
    render(<VideoDownloader />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('yt-dlp was not found.');
  });

  it('estimates MP3 bitrate from the Opus format ID when older Electron responses lack audio details', async () => {
    const listVideoFormats = vi.fn().mockResolvedValue({
      ok: true,
      title: 'Older response',
      formats: [{
        formatId: '251',
        extension: 'webm',
        resolution: 'Audio only',
        note: '',
        videoCodec: 'none',
        audioCodec: 'opus',
        fileSize: null,
        hasVideo: false,
        hasAudio: true
      }]
    });
    installElectronApi(listVideoFormats);
    render(<VideoDownloader />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), {
      target: { value: 'https://example.com/watch?v=1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(await screen.findByRole('heading', { name: 'Older response' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Audio recommendation 1: format 251' }))
      .toHaveTextContent('MP3 estimate: 320 kbps');
  });

  it('starts and stops a torrent download from the Torrent mode', async () => {
    const listVideoFormats = vi.fn();
    const chooseTorrentFile = vi.fn().mockResolvedValue({
      canceled: false,
      path: 'C:\\Users\\Test\\sample.torrent'
    });
    const startTorrentDownload = vi.fn().mockResolvedValue({
      ok: true,
      jobId: 'torrent-job-1',
      outputDirectory: 'C:\\Users\\Test\\Media\\Torrent Downloads'
    });
    const stopTorrentDownload = vi.fn().mockResolvedValue({ ok: true, stopped: true });
    let reportProgress: ((progress: ElectronTorrentDownloadProgress) => void) | null = null;
    installElectronApi(listVideoFormats);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        ...window.electronAPI,
        chooseTorrentFile,
        startTorrentDownload,
        stopTorrentDownload,
        onTorrentDownloadProgress: (listener: (progress: ElectronTorrentDownloadProgress) => void) => {
          reportProgress = listener;
          return () => { reportProgress = null; };
        }
      }
    });
    render(<VideoDownloader mediaLibraryPath="C:\\Users\\Test\\Media" />);

    fireEvent.click(screen.getByRole('button', { name: 'Torrent' }));
    fireEvent.click(screen.getByRole('button', { name: '.torrent file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose .torrent file' }));
    expect(await screen.findByText('C:\\Users\\Test\\sample.torrent')).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Continue seeding after download completes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start download' }));

    await waitFor(() => expect(startTorrentDownload).toHaveBeenCalledWith(
      { kind: 'torrent', path: 'C:\\Users\\Test\\sample.torrent' },
      true
    ));
    expect(await screen.findByRole('region', { name: 'Torrent download progress' })).toBeVisible();
    act(() => reportProgress?.({
      jobId: 'torrent-job-1',
      title: 'Sample video',
      status: 'downloading',
      progress: 50,
      downloadedBytes: 512,
      totalBytes: 1024,
      downloadSpeed: 128,
      uploadSpeed: 0,
      peers: 3,
      outputDirectory: 'C:\\Users\\Test\\Media\\Torrent Downloads'
    }));
    expect(screen.getByText('Downloading · 50.0%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop download' }));
    await waitFor(() => expect(stopTorrentDownload).toHaveBeenCalledWith('torrent-job-1'));
  });

  it('accepts a direct .torrent URL in the link field', async () => {
    const startTorrentDownload = vi.fn().mockResolvedValue({
      ok: true,
      jobId: 'torrent-url-job',
      outputDirectory: 'C:\\Users\\Test\\Media\\Torrent Downloads'
    });
    installElectronApi(vi.fn());
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        ...window.electronAPI,
        startTorrentDownload,
        onTorrentDownloadProgress: () => () => {}
      }
    });
    render(<VideoDownloader mediaLibraryPath="C:\\Users\\Test\\Media" />);

    fireEvent.click(screen.getByRole('button', { name: 'Torrent' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Magnet link or .torrent URL' }), {
      target: { value: 'https://webtorrent.io/torrents/big-buck-bunny.torrent' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start download' }));

    await waitFor(() => expect(startTorrentDownload).toHaveBeenCalledWith(
      { kind: 'torrent-url', url: 'https://webtorrent.io/torrents/big-buck-bunny.torrent' },
      false
    ));
  });

  it('restores an active torrent and keeps its Stop control after reopening the mode', async () => {
    const activeProgress: ElectronTorrentDownloadProgress = {
      jobId: 'restored-job',
      title: 'Restored torrent',
      status: 'downloading',
      progress: 25,
      downloadedBytes: 256,
      totalBytes: 1024,
      downloadSpeed: 64,
      uploadSpeed: 0,
      peers: 2,
      outputDirectory: 'C:\\Users\\Test\\Media\\Torrent Downloads'
    };
    const stopTorrentDownload = vi.fn().mockResolvedValue({ ok: true, stopped: true });
    installElectronApi(vi.fn());
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        ...window.electronAPI,
        getTorrentDownloadProgress: vi.fn().mockResolvedValue({ ok: true, progress: activeProgress }),
        stopTorrentDownload,
        onTorrentDownloadProgress: () => () => {}
      }
    });
    render(<VideoDownloader mediaLibraryPath="C:\\Users\\Test\\Media" />);

    fireEvent.click(screen.getByRole('button', { name: 'Torrent' }));
    expect(await screen.findByText('Downloading · 25.0%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop download' }));
    await waitFor(() => expect(stopTorrentDownload).toHaveBeenCalledWith('restored-job'));
  });
});
