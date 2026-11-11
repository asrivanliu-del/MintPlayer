import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LyricsContent from '../../src/renderer/lyrics/LyricsContent';

const timedLyrics = [
  { time: 12, text: 'First line' },
  { time: 45.5, text: 'Second line' }
];

describe('LyricsContent', () => {
  it('renders static lyrics and the empty state', () => {
    const { rerender } = render(
      <LyricsContent lyricsRaw={'Verse one\nVerse two'} lyricsTimed={null} mode="static" activeIndex={-1} onSeek={vi.fn()} variant="player" />
    );
    expect(screen.getByText(/Verse one\s+Verse two/)).toBeVisible();

    rerender(
      <LyricsContent lyricsRaw={null} lyricsTimed={null} mode="static" activeIndex={-1} onSeek={vi.fn()} variant="player" />
    );
    expect(screen.getByRole('img', { name: 'No lyrics found' })).toBeVisible();
  });

  it('switches from static to synchronized lyrics and highlights the active line', () => {
    const props = {
      lyricsRaw: 'Static lyrics',
      lyricsTimed: timedLyrics,
      activeIndex: 1,
      onSeek: vi.fn(),
      variant: 'player' as const
    };
    const { rerender } = render(<LyricsContent {...props} mode="static" />);
    expect(screen.getByText('Static lyrics')).toBeVisible();

    rerender(<LyricsContent {...props} mode="synchronized" />);
    expect(screen.getByRole('button', { name: 'Seek to 00:12' })).toBeVisible();
    const activeLine = screen.getByRole('button', { name: 'Seek to 00:45' });
    expect(activeLine).toBeVisible();
    expect(activeLine).toHaveStyle({ fontWeight: '800' });
  });

  it('hides LRC timestamps in static mode while preserving them in synchronized mode', () => {
    const lyricsRaw = '[00:31.272] 光 拿烏雲揉成團\n[00:36.396] 像鯨魚吻著浪';
    const { rerender } = render(
      <LyricsContent lyricsRaw={lyricsRaw} lyricsTimed={timedLyrics} mode="static" activeIndex={-1} onSeek={vi.fn()} variant="dialog" />
    );

    expect(screen.getByText(/光 拿烏雲揉成團/)).toBeVisible();
    expect(screen.queryByText(/\[00:31\.272\]/)).not.toBeInTheDocument();

    rerender(
      <LyricsContent lyricsRaw={lyricsRaw} lyricsTimed={timedLyrics} mode="synchronized" activeIndex={0} onSeek={vi.fn()} variant="dialog" />
    );
    expect(screen.getByRole('button', { name: 'Seek to 00:12' })).toBeVisible();
    expect(screen.getByText('00:12')).toBeVisible();
  });

  it('seeks on lyric click, Enter, and Space', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <LyricsContent lyricsRaw={null} lyricsTimed={timedLyrics} mode="synchronized" activeIndex={0} onSeek={onSeek} variant="dialog" />
    );
    const firstLine = screen.getByRole('button', { name: 'Seek to 00:12' });

    await user.click(firstLine);
    expect(onSeek).toHaveBeenLastCalledWith(12);

    firstLine.focus();
    await user.keyboard('{Enter}');
    expect(onSeek).toHaveBeenLastCalledWith(12);

    firstLine.focus();
    await user.keyboard(' ');
    expect(onSeek).toHaveBeenLastCalledWith(12);
    expect(onSeek).toHaveBeenCalledTimes(3);
  });

  it('falls back to raw lyrics when synchronized timestamps are unavailable', () => {
    render(
      <LyricsContent lyricsRaw="Lyrics without timing" lyricsTimed={[]} mode="synchronized" activeIndex={-1} onSeek={vi.fn()} variant="dialog" />
    );
    expect(screen.getByText('Lyrics without timing')).toBeVisible();
  });

  it('shows a centered synchronized-lyrics icon with a slash when unavailable', () => {
    render(
      <LyricsContent lyricsRaw={null} lyricsTimed={[]} mode="synchronized" activeIndex={-1} onSeek={vi.fn()} variant="dialog" />
    );
    const emptyState = screen.getByRole('img', { name: 'No synchronized lyrics found' });
    expect(emptyState).toBeVisible();
    expect(emptyState).toHaveStyle({ display: 'grid', placeItems: 'center' });
    expect(emptyState.querySelector('svg path:last-child')).toHaveAttribute('d', 'm3 21 18-18');
    expect(screen.queryByText('No synchronized lyrics found')).not.toBeInTheDocument();
  });

  it('shows the static-lyrics icon with a slash when lyrics are unavailable', () => {
    render(
      <LyricsContent lyricsRaw={null} lyricsTimed={null} mode="static" activeIndex={-1} onSeek={vi.fn()} variant="player" />
    );
    const emptyState = screen.getByRole('img', { name: 'No lyrics found' });
    expect(emptyState).toBeVisible();
    expect(emptyState).toHaveStyle({ display: 'grid', placeItems: 'center' });
    expect(emptyState.querySelectorAll('svg path')).toHaveLength(3);
  });
});
