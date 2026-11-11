import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KaraokeCreator from '../../src/renderer/tools/KaraokeCreator';

describe('Karaoke Creator tool', () => {
  afterEach(() => {
    delete window.electronAPI;
  });

  it('fills the media path from the current player media and omits the Video file label', () => {
    const props = {
      mediaLibraryPath: 'C:\\Media',
      onComplete: vi.fn(),
      onStemsCreated: vi.fn()
    };
    const { rerender } = render(<KaraokeCreator {...props} />);

    expect(screen.queryByText('Video file')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use current media' })).toBeDisabled();

    rerender(
      <KaraokeCreator
        {...props}
        initialMediaPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
      />
    );
    const useCurrentButton = screen.getByRole('button', { name: 'Use current media' });
    expect(useCurrentButton).toBeEnabled();
    expect(useCurrentButton.compareDocumentPosition(screen.getByRole('button', { name: 'Browse for media' })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(useCurrentButton);
    expect(screen.getByRole('textbox', { name: 'Media path' }))
      .toHaveValue('C:\\Media\\Video\\Artist\\Album\\Song.mp4');
  });

  it('creates Video A/O stems before aligning lyrics and reports both outputs', async () => {
    const splitAudioStems = vi.fn().mockResolvedValue({
      ok: true,
      vocalsPath: 'C:\\Media\\Video_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav',
      accompanimentPath: 'C:\\Media\\Video_Accompaniments\\孫燕姿\\單曲\\飛瀑而下.wav'
    });

    const alignKaraokeSource = vi.fn().mockResolvedValue({
      ok: true,
      outputPath: 'C:\\Media\\karaoke\\孫燕姿\\單曲\\飛瀑而下.ass'
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        splitAudioStems,
        alignKaraokeSource,
        onKaraokeAlignmentProgress: vi.fn(() => () => {}),
        chooseKaraokeSource: vi.fn().mockResolvedValue({ canceled: true, paths: [] })
      }
    });
    const onComplete = vi.fn();
    const onStemsCreated = vi.fn();

    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Video\\孫燕姿\\單曲\\飛瀑而下.mp4'}
        onComplete={onComplete}
        onStemsCreated={onStemsCreated}
      />
    );
    expect(screen.getByRole('button', { name: 'Use LRC alignment' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(screen.getByRole('textbox', { name: 'Lyrics' }), {
      target: { value: '雷達指引 目地滑行' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create karaoke' }));

    await waitFor(() => expect(splitAudioStems).toHaveBeenCalledWith(
      'C:\\Media\\Video\\孫燕姿\\單曲\\飛瀑而下.mp4',
      'C:\\Media'
    ));
    await waitFor(() => expect(alignKaraokeSource).toHaveBeenCalledWith(
      'C:\\Media\\Video\\孫燕姿\\單曲\\飛瀑而下.mp4',
      'C:\\Media\\Video_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav',
      '雷達指引 目地滑行',
      'C:\\Media'
    ));
    expect(splitAudioStems.mock.invocationCallOrder[0]).toBeLessThan(alignKaraokeSource.mock.invocationCallOrder[0]);
    expect(onStemsCreated).toHaveBeenCalledWith([
      'C:\\Media\\Video_Vocals\\孫燕姿\\單曲\\飛瀑而下.wav',
      'C:\\Media\\Video_Accompaniments\\孫燕姿\\單曲\\飛瀑而下.wav'
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent('C:\\Media\\karaoke\\孫燕姿\\單曲\\飛瀑而下.ass');
    expect(onComplete).toHaveBeenCalledWith('C:\\Media\\karaoke\\孫燕姿\\單曲\\飛瀑而下.ass');
  });

  it('creates Music A/O stems and aligns lyrics against the vocals stem', async () => {
    const alignKaraokeSource = vi.fn().mockResolvedValue({
      ok: true,
      outputPath: 'C:\\Media\\karaoke\\Artist\\Album\\Song.ass'
    });
    const splitAudioStems = vi.fn().mockResolvedValue({
      ok: true,
      vocalsPath: 'C:\\Media\\Music_Vocals\\Artist\\Album\\Song.wav',
      accompanimentPath: 'C:\\Media\\Music_Accompaniments\\Artist\\Album\\Song.wav'
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        splitAudioStems,
        alignKaraokeSource,
        onKaraokeAlignmentProgress: vi.fn(() => () => {})
      }
    });
    const onStemsCreated = vi.fn();
    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Music\\Artist\\Album\\Song.mp3'}
        onComplete={vi.fn()}
        onStemsCreated={onStemsCreated}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Lyrics' }), { target: { value: 'Song lyrics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create karaoke' }));

    await waitFor(() => expect(splitAudioStems).toHaveBeenCalledWith(
      'C:\\Media\\Music\\Artist\\Album\\Song.mp3',
      'C:\\Media'
    ));
    await waitFor(() => expect(alignKaraokeSource).toHaveBeenCalledWith(
      'C:\\Media\\Music\\Artist\\Album\\Song.mp3',
      'C:\\Media\\Music_Vocals\\Artist\\Album\\Song.wav',
      'Song lyrics',
      'C:\\Media'
    ));
    expect(onStemsCreated).toHaveBeenCalledWith([
      'C:\\Media\\Music_Vocals\\Artist\\Album\\Song.wav',
      'C:\\Media\\Music_Accompaniments\\Artist\\Album\\Song.wav'
    ]);
  });

  it('uses the same-name Music LRC when LRC alignment is enabled', async () => {
    const alignKaraokeSource = vi.fn().mockResolvedValue({
      ok: true,
      outputPath: 'C:\\Media\\karaoke\\Artist\\Album\\Song.ass'
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        splitAudioStems: vi.fn().mockResolvedValue({
          ok: true,
          vocalsPath: 'C:\\Media\\Video_Vocals\\Artist\\Album\\Song.wav',
          accompanimentPath: 'C:\\Media\\Video_Accompaniments\\Artist\\Album\\Song.wav'
        }),
        alignKaraokeSource,
        onKaraokeAlignmentProgress: vi.fn(() => () => {}),
        stat: vi.fn(async (path: string) => ({
          ok: path.endsWith('.lrc'),
          isFile: path.endsWith('.lrc'),
          isDirectory: false
        })),
        readKaraokeLrc: vi.fn().mockResolvedValue({
          ok: true,
          text: '[00:10.00]Repeated line\n[00:20.00]Repeated line'
        }),
        getLyrics: vi.fn()
      }
    });

    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
        onComplete={vi.fn()}
        onStemsCreated={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use LRC alignment' }));

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Lyrics' })).toHaveValue('Repeated line\nRepeated line'));
    expect(screen.getByRole('button', { name: 'Use LRC alignment' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Create karaoke' }));

    await waitFor(() => expect(alignKaraokeSource).toHaveBeenCalledWith(
      'C:\\Media\\Video\\Artist\\Album\\Song.mp4',
      'C:\\Media\\Video_Vocals\\Artist\\Album\\Song.wav',
      'Repeated line\nRepeated line',
      'C:\\Media',
      [{ time: 10, text: 'Repeated line' }, { time: 20, text: 'Repeated line' }]
    ));
  });

  it('uses synchronized lyrics embedded in the same-name Music MP3', async () => {
    const getLyrics = vi.fn().mockResolvedValue({
      ok: true,
      type: 'sylt',
      lyrics: 'Embedded chorus',
      timed: [{ time: 12, text: 'Embedded chorus' }]
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        onKaraokeAlignmentProgress: vi.fn(() => () => {}),
        stat: vi.fn(async (path: string) => ({
          ok: path.endsWith('.mp3'),
          isFile: path.endsWith('.mp3'),
          isDirectory: false
        })),
        readKaraokeLrc: vi.fn(),
        getLyrics
      }
    });
    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
        onComplete={vi.fn()}
        onStemsCreated={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use LRC alignment' }));

    expect(await screen.findByRole('textbox', { name: 'Lyrics' })).toHaveValue('Embedded chorus');
    expect(getLyrics).toHaveBeenCalledWith('C:\\Media\\Music\\Artist\\Album\\Song.mp3');
  });

  it('lets the user select an external LRC instead of online search results', async () => {
    const searchLyrics = vi.fn().mockResolvedValue({ ok: true, results: [] });
    const chooseKaraokeLrc = vi.fn().mockResolvedValue({
      canceled: false,
      paths: ['C:\\Lyrics\\Chosen.lrc']
    });
    const readKaraokeLrc = vi.fn().mockResolvedValue({
      ok: true,
      text: '[00:03.00]Selected lyrics'
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        onKaraokeAlignmentProgress: vi.fn(() => () => {}),
        stat: vi.fn().mockResolvedValue({ ok: false, error: 'not found' }),
        readKaraokeLrc,
        getLyrics: vi.fn(),
        searchLyrics,
        chooseKaraokeLrc
      }
    });
    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
        onComplete={vi.fn()}
        onStemsCreated={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use LRC alignment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose an LRC file' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Lyrics' })).toHaveValue('Selected lyrics'));

    expect(chooseKaraokeLrc).toHaveBeenCalledOnce();
    expect(searchLyrics).toHaveBeenCalledOnce();
    expect(readKaraokeLrc).toHaveBeenCalledWith('C:\\Lyrics\\Chosen.lrc');
    expect(screen.getByText('C:\\Lyrics\\Chosen.lrc')).toBeInTheDocument();
  });

  it('shows online synchronized lyric results when no local timed lyrics are found', async () => {
    const searchLyrics = vi.fn().mockResolvedValue({
      ok: true,
      results: [{
        id: 21,
        trackName: 'Song',
        artistName: 'Artist',
        albumName: 'Album',
        duration: 120,
        plainLyrics: 'untimed text',
        syncedLyrics: '[00:05.00]Timed song line',
        source: 'LRCLIB'
      }]
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        onKaraokeAlignmentProgress: vi.fn(() => () => {}),
        stat: vi.fn().mockResolvedValue({ ok: false, error: 'not found' }),
        readKaraokeLrc: vi.fn(),
        getLyrics: vi.fn(),
        searchLyrics
      }
    });
    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
        onComplete={vi.fn()}
        onStemsCreated={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use LRC alignment' }));
    const result = await screen.findByRole('button', { name: /Song — Artist/ });
    expect(searchLyrics).toHaveBeenCalledWith('Song Artist Album', 'Song Artist', 'Artist');
    fireEvent.click(result);

    expect(screen.getByRole('textbox', { name: 'Lyrics' })).toHaveValue('Timed song line');
    expect(screen.getByRole('button', { name: 'Use LRC alignment' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/Song — Artist \(LRCLIB\)/)).toHaveLength(2);
  });

  it('reports separation errors and does not start subtitle alignment', async () => {
    const alignKaraokeSource = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        splitAudioStems: vi.fn().mockResolvedValue({ ok: false, error: 'separator unavailable' }),
        alignKaraokeSource,
        onKaraokeAlignmentProgress: vi.fn(() => () => {})
      }
    });
    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
        onComplete={vi.fn()}
        onStemsCreated={vi.fn()}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Lyrics' }), { target: { value: 'Song lyrics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create karaoke' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('separator unavailable');
    expect(alignKaraokeSource).not.toHaveBeenCalled();
    expect(screen.queryByText(/Karaoke subtitle saved/)).not.toBeInTheDocument();
  });

  it('rejects a non-MP4 source before creating any stems', async () => {
    const splitAudioStems = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        splitAudioStems,
        alignKaraokeSource: vi.fn(),
        onKaraokeAlignmentProgress: vi.fn(() => () => {})
      }
    });
    render(
      <KaraokeCreator
        mediaLibraryPath={'C:\\Media'}
        initialMediaPath={'C:\\Media\\Music\\Artist\\Album\\Song.m4a'}
        onComplete={vi.fn()}
        onStemsCreated={vi.fn()}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Lyrics' }), { target: { value: 'Song lyrics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create karaoke' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an MP3, FLAC, WAV, or MP4 source');
    expect(splitAudioStems).not.toHaveBeenCalled();
  });
});
