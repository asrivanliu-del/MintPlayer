import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackTransport from '../../src/renderer/playback/PlaybackTransport';
import type { MediaLibraryRole } from '../../src/renderer/playlist/mediaLibraryUtils';

function renderTransport(overrides: Partial<ComponentProps<typeof PlaybackTransport>> = {}) {
  const onPlayMediaRole = vi.fn<(role: MediaLibraryRole) => void>();
  const props: ComponentProps<typeof PlaybackTransport> = {
    currentTime: 12,
    duration: 180,
    formatTime: time => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`,
    onSeek: vi.fn(),
    isPlaying: false,
    onPrevious: vi.fn(),
    onTogglePlayback: vi.fn(),
    onNext: vi.fn(),
    mediaAvailability: {
      music: true,
      video: true,
      karaoke: true,
      accompaniments: true,
      vocals: true
    },
    backingActive: false,
    selectedMediaRole: null,
    onPlayMediaRole,
    karaokeAudioSource: 'accompaniment',
    hasKaraokeAccompaniment: true,
    hasKaraokeVocals: true,
    karaokeHasVideo: true,
    onKaraokeAudioSourceChange: vi.fn(),
    aoStemSource: 'music',
    aoStemAvailability: { music: true, video: false },
    onAoStemSourceChange: vi.fn(),
    ...overrides
  };
  return { ...render(<PlaybackTransport {...props} />), props, onPlayMediaRole };
}

describe('PlaybackTransport', () => {
  it('renders transport buttons followed by media role buttons in MVKAO order', () => {
    renderTransport();
    const buttonNames = screen.getAllByRole('button').map(button => button.getAttribute('aria-label'));

    expect(buttonNames).toEqual([
      'Previous',
      'Play',
      'Next',
      'Play music',
      'Play video',
      'Play karaoke video',
      'Play accompaniments',
      'Play vocals'
    ]);
    const mediaRoleButtons = screen.getAllByRole('button').slice(3, 8);
    expect(mediaRoleButtons.every(button => button.querySelector('svg[aria-hidden="true"]'))).toBe(true);
    expect(mediaRoleButtons.map(button => button.textContent)).toEqual(['', '', '', '', '']);
    expect(screen.getByRole('button', { name: 'Play music' })).toHaveAttribute('data-available', 'true');
    expect(screen.getAllByRole('button').slice(3).every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.getByLabelText('Seek')).toHaveValue('12');
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', 'Seek: 0:12 / 3:00');
  });

  it('calls playback controls and reflects play/pause state', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderTransport();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await user.click(screen.getByRole('button', { name: 'Play' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(props.onPrevious).toHaveBeenCalledOnce();
    expect(props.onTogglePlayback).toHaveBeenCalledOnce();
    expect(props.onNext).toHaveBeenCalledOnce();

    rerender(<PlaybackTransport {...props} isPlaying />);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('seeks and plays the requested media role', async () => {
    const user = userEvent.setup();
    const { props, rerender, onPlayMediaRole } = renderTransport();

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '45.5' } });
    expect(props.onSeek).toHaveBeenCalledWith(45.5);
    rerender(<PlaybackTransport {...props} currentTime={45.5} />);
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', 'Seek: 0:45 / 3:00');

    const roles: MediaLibraryRole[] = ['music', 'video', 'karaoke', 'accompaniments', 'vocals'];
    for (const role of roles) {
      const label = {
        music: 'Play music',
        video: 'Play video',
        karaoke: 'Play karaoke video',
        accompaniments: 'Play accompaniments',
        vocals: 'Play vocals'
      }[role];
      await user.click(screen.getByRole('button', { name: label }));
    }
    expect(onPlayMediaRole.mock.calls.map(([role]) => role)).toEqual(roles);

    rerender(<PlaybackTransport {...props} backingActive />);
    expect(screen.getByRole('button', { name: 'Play accompaniments' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Play accompaniments' })).toHaveAttribute('title', 'Play original track');
  });

  it('reflects the selected media role supplied by the player', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderTransport();
    const musicButton = screen.getByRole('button', { name: 'Play music' });
    const videoButton = screen.getByRole('button', { name: 'Play video' });

    await user.click(musicButton);
    expect(musicButton).toHaveAttribute('aria-pressed', 'false');
    rerender(<PlaybackTransport {...props} selectedMediaRole="music" />);
    expect(screen.getByRole('button', { name: 'Play music' })).toHaveAttribute('aria-pressed', 'true');
    expect(videoButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(videoButton);
    rerender(<PlaybackTransport {...props} selectedMediaRole="video" />);
    expect(screen.getByRole('button', { name: 'Play music' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Play video' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button').slice(3).filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('disables roles that do not have corresponding media', () => {
    renderTransport({
      mediaAvailability: {
        music: true,
        video: false,
        karaoke: false,
        accompaniments: true,
        vocals: false
      }
    });

    expect(screen.getByRole('button', { name: 'Play music' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Play video' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play video' })).toHaveAttribute('data-available', 'false');
    expect(screen.getByRole('button', { name: 'Play karaoke video' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play accompaniments' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Play vocals' })).toBeDisabled();
  });

  it('shows the accompaniment/original selector only while karaoke is selected', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderTransport({ selectedMediaRole: 'karaoke' });
    const accompaniment = screen.getByRole('button', { name: 'Karaoke audio: Accompaniment' });
    const original = screen.getByRole('button', { name: 'Karaoke audio: Original' });

    expect(accompaniment).toHaveAttribute('aria-pressed', 'true');
    expect(original).toHaveAttribute('aria-pressed', 'false');
    await user.click(original);
    expect(props.onKaraokeAudioSourceChange).toHaveBeenCalledWith('original');

    rerender(<PlaybackTransport {...props} karaokeAudioSource="original" />);
    expect(screen.getByRole('button', { name: 'Karaoke audio: Original' })).toHaveAttribute('aria-pressed', 'true');

    rerender(<PlaybackTransport {...props} selectedMediaRole="video" />);
    expect(screen.queryByRole('group', { name: 'Karaoke audio source' })).not.toBeInTheDocument();
  });

  it('disables accompaniment selection when no separated stem exists', () => {
    renderTransport({
      selectedMediaRole: 'karaoke',
      hasKaraokeAccompaniment: false,
      karaokeAudioSource: 'original'
    });

    expect(screen.getByRole('button', { name: 'Karaoke audio: Accompaniment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Karaoke audio: Accompaniment' }))
      .toHaveAttribute('title', 'Run Vocal Splitter to create an accompaniment first');
    expect(screen.getByRole('button', { name: 'Karaoke audio: Original' })).toBeEnabled();
  });

  it('offers the vocals stem for audio-only karaoke playback', async () => {
    const user = userEvent.setup();
    const { props } = renderTransport({
      selectedMediaRole: 'karaoke',
      karaokeHasVideo: false,
      karaokeAudioSource: 'accompaniment'
    });

    expect(screen.getByRole('group', { name: 'Karaoke music source' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Karaoke audio: Original' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Karaoke music: Vocals' }));
    expect(props.onKaraokeAudioSourceChange).toHaveBeenCalledWith('vocals');
  });

  it('lets accompaniment and vocals independently switch stem source', async () => {
    const user = userEvent.setup();
    const onAoStemSourceChange = vi.fn();
    const { props, rerender } = renderTransport({
      selectedMediaRole: 'accompaniments',
      aoStemAvailability: { music: true, video: true },
      onAoStemSourceChange
    });

    expect(screen.getByRole('button', { name: 'Accompaniment source: Music' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Accompaniment source: Video' }));
    expect(onAoStemSourceChange).toHaveBeenCalledWith('accompaniments', 'video');

    rerender(<PlaybackTransport {...props} selectedMediaRole="vocals" aoStemSource="music" />);
    expect(screen.getByRole('button', { name: 'Vocals source: Music' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Vocals source: Video' }));
    expect(onAoStemSourceChange).toHaveBeenLastCalledWith('vocals', 'video');
  });

  it('disables unavailable A/O stem sources', () => {
    renderTransport({
      selectedMediaRole: 'vocals',
      aoStemAvailability: { music: true, video: false }
    });

    expect(screen.getByRole('button', { name: 'Vocals source: Music' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Vocals source: Video' })).toBeDisabled();
  });
});
