import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PlaybackAudioControls from '../../src/renderer/playback/PlaybackAudioControls';

function renderControls(overrides: Partial<React.ComponentProps<typeof PlaybackAudioControls>> = {}) {
  const props: React.ComponentProps<typeof PlaybackAudioControls> = {
    volume: 0.5,
    onVolumeChange: vi.fn(),
    onToggleMute: vi.fn(),
    pan: 0,
    onPanChange: vi.fn(),
    isVideo: false,
    transpose: 0,
    onTransposeChange: vi.fn(),
    showDebug: false,
    onToggleDebug: vi.fn(),
    ...overrides
  };
  return { ...render(<PlaybackAudioControls {...props} />), props };
}

describe('PlaybackAudioControls', () => {
  it('renders the audio controls with accessible values and defaults', () => {
    renderControls();

    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.5');
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('title', 'Volume: 50%');
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', 'Volume: 50%');
    expect(screen.getByRole('button', { name: 'Mute' })).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Pan' })).toHaveValue('0');
    expect(screen.getByRole('slider', { name: 'Pan' })).toHaveAttribute('aria-valuetext', 'Pan: M');
    expect(screen.getByRole('slider', { name: 'Transpose' })).toHaveValue('0');
    expect(screen.getByRole('button', { name: 'Show debug' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('labels pan direction and updates its live text for left, center, and right', () => {
    const { rerender } = renderControls({ pan: -0.42 });
    const panSlider = screen.getByRole('slider', { name: 'Pan' });
    expect(panSlider).toHaveAttribute('aria-valuetext', 'Pan: L 42%');

    rerender(
      <PlaybackAudioControls
        volume={0.5}
        onVolumeChange={vi.fn()}
        onToggleMute={vi.fn()}
        pan={0.51}
        onPanChange={vi.fn()}
        isVideo={false}
        transpose={0}
        onTransposeChange={vi.fn()}
        showDebug={false}
        onToggleDebug={vi.fn()}
      />
    );
    expect(screen.getByRole('slider', { name: 'Pan' })).toHaveAttribute('aria-valuetext', 'Pan: R 51%');
  });

  it('resets the pan slider to center on double-click', () => {
    const onPanChange = vi.fn();
    renderControls({ pan: 0.42, onPanChange });
    const slider = screen.getByRole('slider', { name: 'Pan' });
    const doubleClick = new MouseEvent('dblclick', { bubbles: true, cancelable: true });

    slider.dispatchEvent(doubleClick);

    expect(doubleClick.defaultPrevented).toBe(true);
    expect(slider).toHaveValue('0.42');
    expect(onPanChange).toHaveBeenCalledWith(0);
  });

  it('forwards volume, pan, mute, and debug actions', async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.73' } });
    expect(props.onVolumeChange).toHaveBeenCalledWith(0.73);

    fireEvent.change(screen.getByRole('slider', { name: 'Pan' }), { target: { value: '-0.4' } });
    expect(props.onPanChange).toHaveBeenCalledWith(-0.4);

    await user.click(screen.getByRole('button', { name: 'Mute' }));
    await user.click(screen.getByRole('button', { name: 'Show debug' }));
    expect(props.onToggleMute).toHaveBeenCalledOnce();
    expect(props.onToggleDebug).toHaveBeenCalledOnce();
  });

  it('shows unmute and hide-debug states when muted and diagnostics are visible', () => {
    renderControls({ volume: 0, showDebug: true });

    expect(screen.getByRole('button', { name: 'Unmute' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide debug' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('labels pan and transpose controls for video and updates transpose', async () => {
    const user = userEvent.setup();
    const { props } = renderControls({ isVideo: true, transpose: 2 });

    expect(screen.getByRole('slider', { name: 'Pan' })).toHaveAttribute('title', 'Pan video audio left or right');
    expect(screen.getByRole('slider', { name: 'Transpose' }).parentElement?.parentElement?.parentElement).toHaveAttribute(
      'title',
      'Transpose video audio'
    );
    await user.click(screen.getByRole('button', { name: '+1' }));
    expect(props.onTransposeChange).toHaveBeenCalledWith(3);
  });
});
