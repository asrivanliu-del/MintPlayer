import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LyricsModeToggle from '../../src/renderer/lyrics/LyricsModeToggle';

describe('LyricsModeToggle', () => {
  it('requests synchronized mode from static mode and updates the accessible label', () => {
    const onModeChange = vi.fn();
    const { rerender } = render(<LyricsModeToggle mode="static" onModeChange={onModeChange} />);
    const button = screen.getByRole('button', { name: 'Switch to synchronized lyrics' });

    expect(button).toHaveAttribute('title', 'Synchronized lyrics');
    expect(button).toHaveClass('media-mode-toggle');
    expect(button).toHaveStyle({ width: '42px', height: '42px' });
    fireEvent.click(button);
    expect(onModeChange).toHaveBeenCalledWith('synchronized');

    rerender(<LyricsModeToggle mode="synchronized" onModeChange={onModeChange} />);
    expect(screen.getByRole('button', { name: 'Switch to static lyrics' })).toHaveAttribute('title', 'Static lyrics');
  });

  it('requests static mode from synchronized mode', () => {
    const onModeChange = vi.fn();
    render(<LyricsModeToggle mode="synchronized" onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to static lyrics' }));
    expect(onModeChange).toHaveBeenCalledWith('static');
  });
});
