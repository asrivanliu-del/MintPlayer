import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KaraokeAligner from '../../src/renderer/tools/KaraokeAligner';
import type { ElectronKaraokeSubtitleLine } from '../../src/electron/electronApi';

const subtitlePath = 'C:\\Media\\karaoke\\Artist\\Album\\Song.ass';
const lines: ElectronKaraokeSubtitleLine[] = [{
  start: 5,
  end: 8,
  text: 'ABC',
  characters: [
    { text: 'A', start: 5, end: 6 },
    { text: 'B', start: 6, end: 7 },
    { text: 'C', start: 7, end: 8 }
  ]
}];

function createPointerEvent(type: string, pointerId: number, clientX: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX }
  });
  return event;
}

describe('Karaoke Aligner tool', () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  it('finds the matching ASS, previews the selected video, and edits character boundaries', async () => {
    const findKaraokeSubtitle = vi.fn().mockResolvedValue({ ok: true, path: subtitlePath });
    const readKaraokeSubtitle = vi.fn().mockResolvedValue({ ok: true, lines });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        findKaraokeSubtitle,
        readKaraokeSubtitle,
        chooseKaraokeVideo: vi.fn(),
        chooseKaraokeSubtitle: vi.fn(),
        onKaraokeAlignmentProgress: vi.fn(() => () => {})
      }
    });

    render(
      <KaraokeAligner
        mediaLibraryPath={'C:\\Media'}
        initialVideoPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
      />
    );

    expect(await screen.findByText(subtitlePath)).toBeInTheDocument();
    const video = screen.getByLabelText('Karaoke alignment video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    let paused = true;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    const play = vi.spyOn(video, 'play').mockImplementation(async () => {
      paused = false;
      fireEvent.play(video);
    });
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {
      paused = true;
      fireEvent.pause(video);
    });
    expect(findKaraokeSubtitle).toHaveBeenCalledWith(
      'C:\\Media\\Video\\Artist\\Album\\Song.mp4',
      'C:\\Media'
    );
    expect(readKaraokeSubtitle).toHaveBeenCalledWith(subtitlePath);
    expect(screen.getByLabelText('Karaoke alignment video')).toHaveAttribute(
      'src',
      'music://local/C%3A%5CMedia%5CVideo%5CArtist%5CAlbum%5CSong.mp4'
    );
    expect(video.crossOrigin).toBe('anonymous');
    expect(screen.getByRole('slider', { name: /first character start/ }).parentElement).toHaveStyle({ left: '0px' });
    expect(screen.getByLabelText('Timing handles for line 1').querySelectorAll('.karaoke-aligner-timeline-character'))
      .toHaveLength(3);
    for (const character of screen.getByLabelText('Timing handles for line 1').querySelectorAll('.karaoke-aligner-timeline-character')) {
      expect(character).toHaveStyle({ width: '56px' });
    }
    const playbackButton = screen.getByRole('button', { name: 'Play video' });
    expect(playbackButton).toBeDisabled();
    fireEvent.click(playbackButton);
    expect(play).not.toHaveBeenCalled();
    fireEvent.canPlay(video);
    expect(playbackButton).toBeEnabled();
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 6 });
    fireEvent.timeUpdate(video);
    expect(await screen.findByLabelText('Karaoke subtitles')).toHaveTextContent('ABC');
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(await screen.findByRole('button', { name: 'Pause video' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }));
    expect(await screen.findByRole('button', { name: 'Play video' })).toBeVisible();
    expect(pause).toHaveBeenCalledOnce();
    const handle = screen.getByRole('slider', { name: /B start/ });
    const timestamp = screen.getByRole('textbox', { name: /B start.*timestamp/ });
    expect(handle.parentElement).toHaveStyle({ left: '56px' });
    expect(handle).toHaveAttribute('aria-valuetext', '00:00:06.000');
    expect(timestamp).toHaveValue('00:00:06.000');

    fireEvent.change(timestamp, { target: { value: '00:00:06.250' } });
    expect(video.currentTime).toBe(6.25);
    expect(handle).toHaveAttribute('aria-valuetext', '00:00:06.250');
    const handlePosition = handle.parentElement?.style.left;
    fireEvent(handle, createPointerEvent('pointerdown', 1, 100));
    expect(timestamp.closest('.karaoke-aligner-boundary')).toHaveClass('dragging');
    fireEvent(handle, createPointerEvent('pointermove', 1, 108.4));
    expect(handle).toHaveAttribute('aria-valuetext', '00:00:06.400');
    expect(timestamp).toHaveValue('00:00:06.400');
    expect(video.currentTime).toBe(6.4);
    expect(handle.parentElement?.style.left).toBe(handlePosition);
    expect(timestamp.closest('.karaoke-aligner-boundary')).toHaveClass('dragging');
    fireEvent(handle, createPointerEvent('pointerup', 1, 108.4));
    expect(timestamp.closest('.karaoke-aligner-boundary')).not.toHaveClass('dragging');
    fireEvent.doubleClick(handle);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('hides spaces and their redundant timing handles in the subtitle timeline', async () => {
    const spacedLine: ElectronKaraokeSubtitleLine = {
      start: 5,
      end: 9,
      text: 'A B',
      characters: [
        { text: 'A', start: 5, end: 6 },
        { text: ' ', start: 6, end: 7 },
        { text: 'B', start: 7, end: 9 }
      ]
    };
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        findKaraokeSubtitle: vi.fn().mockResolvedValue({ ok: true, path: subtitlePath }),
        readKaraokeSubtitle: vi.fn().mockResolvedValue({ ok: true, lines: [spacedLine] }),
        onKaraokeAlignmentProgress: vi.fn(() => () => {})
      }
    });

    render(
      <KaraokeAligner mediaLibraryPath="C:\\Media" initialVideoPath="C:\\Media\\Video\\Song.mp4" />
    );

    await screen.findByText(subtitlePath);
    const timeline = screen.getByLabelText('Timing handles for line 1');
    expect(timeline).toHaveTextContent('A');
    expect(timeline).toHaveTextContent('B');
    expect(timeline.querySelectorAll('[role="slider"]')).toHaveLength(3);
    expect(screen.queryByRole('slider', { name: /space/i })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /B start/ }).parentElement).toHaveStyle({ left: '56px' });
  });

  it('saves edits over the loaded subtitle and saves a copy to a chosen path', async () => {
    const saveKaraokeSubtitle = vi.fn().mockResolvedValue({ ok: true });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        findKaraokeSubtitle: vi.fn().mockResolvedValue({ ok: true, path: subtitlePath }),
        readKaraokeSubtitle: vi.fn().mockResolvedValue({ ok: true, lines }),
        saveKaraokeSubtitle,
        chooseKaraokeSubtitleSavePath: vi.fn().mockResolvedValue({
          ok: true,
          path: 'C:\\Exports\\Song-edited.ass'
        }),
        onKaraokeAlignmentProgress: vi.fn(() => () => {})
      }
    });
    const onSubtitleSaved = vi.fn();

    render(
      <KaraokeAligner
        mediaLibraryPath={'C:\\Media'}
        initialVideoPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
        onSubtitleSaved={onSubtitleSaved}
      />
    );
    await screen.findByText(subtitlePath);
    fireEvent.change(screen.getByRole('textbox', { name: /B start.*timestamp/ }), {
      target: { value: '6.25' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveKaraokeSubtitle).toHaveBeenCalledWith(
      subtitlePath,
      [{
        ...lines[0],
        characters: [
          { text: 'A', start: 5, end: 6.25 },
          { text: 'B', start: 6.25, end: 7 },
          { text: 'C', start: 7, end: 8 }
        ]
      }]
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Save As...' }));
    await waitFor(() => expect(saveKaraokeSubtitle).toHaveBeenLastCalledWith(
      'C:\\Exports\\Song-edited.ass',
      [{
        ...lines[0],
        characters: [
          { text: 'A', start: 5, end: 6.25 },
          { text: 'B', start: 6.25, end: 7 },
          { text: 'C', start: 7, end: 8 }
        ]
      }],
      subtitlePath
    ));
    expect(onSubtitleSaved).toHaveBeenLastCalledWith('C:\\Exports\\Song-edited.ass');
  });

  it('offers manual ASS selection when no matching subtitle exists', async () => {
    const chooseKaraokeSubtitle = vi.fn().mockResolvedValue({
      canceled: false,
      paths: [subtitlePath]
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        findKaraokeSubtitle: vi.fn().mockResolvedValue({ ok: true, path: null }),
        readKaraokeSubtitle: vi.fn().mockResolvedValue({ ok: true, lines }),
        chooseKaraokeSubtitle,
        onKaraokeAlignmentProgress: vi.fn(() => () => {})
      }
    });
    render(
      <KaraokeAligner
        mediaLibraryPath={'C:\\Media'}
        initialVideoPath={'C:\\Media\\Video\\Artist\\Album\\Song.mp4'}
      />
    );

    expect(await screen.findByText(/No matching ASS subtitle was found/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose ASS...' }));
    expect(await screen.findByText(subtitlePath)).toBeInTheDocument();
    expect(chooseKaraokeSubtitle).toHaveBeenCalledOnce();
  });
});
