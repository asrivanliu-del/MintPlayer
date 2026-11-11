import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TransposeControls from '../../src/renderer/transpose/TransposeControls';

describe('TransposeControls', () => {
  it('renders the transpose slider, reset, and step buttons', () => {
    render(<TransposeControls value={3} onChange={vi.fn()} />);

    expect(screen.getByRole('slider', { name: 'Transpose' })).toHaveValue('3');
    expect(screen.getByRole('slider', { name: 'Transpose' })).toHaveAttribute('aria-valuetext', 'Transpose: +3 semitones');
    expect(screen.getByRole('button', { name: 'Reset transpose to 0' })).toBeVisible();
    expect(screen.getByRole('button', { name: '-4' })).toBeVisible();
    expect(screen.getByRole('button', { name: '-1' })).toBeVisible();
    expect(screen.getByRole('button', { name: '+1' })).toBeVisible();
    expect(screen.getByRole('button', { name: '+4' })).toBeVisible();
    expect(document.querySelectorAll('.transpose-slider-ticks span')).toHaveLength(25);
  });

  it('applies step changes and resets to zero', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TransposeControls value={2} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '+1' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    await user.click(screen.getByRole('button', { name: '-4' }));
    expect(onChange).toHaveBeenLastCalledWith(-2);
    await user.click(screen.getByRole('button', { name: 'Reset transpose to 0' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('clamps step changes to the supported semitone range', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<TransposeControls value={12} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '+1' }));
    expect(onChange).toHaveBeenLastCalledWith(12);

    rerender(<TransposeControls value={-12} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '-1' }));
    expect(onChange).toHaveBeenLastCalledWith(-12);
  });

  it('updates from direct slider input and supports compact layout', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<TransposeControls value={0} onChange={onChange} compact />);

    fireEvent.change(screen.getByRole('slider', { name: 'Transpose' }), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
    rerender(<TransposeControls value={7} onChange={onChange} compact />);
    expect(screen.getByRole('slider', { name: 'Transpose' })).toHaveAttribute('aria-valuetext', 'Transpose: +7 semitones');
    expect(container.querySelector('.transpose-panel')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Transpose' })).toBeVisible();
  });

  it('resets the transpose slider to zero on double-click', () => {
    const onChange = vi.fn();
    render(<TransposeControls value={7} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Transpose' });
    const doubleClick = new MouseEvent('dblclick', { bubbles: true, cancelable: true });

    slider.dispatchEvent(doubleClick);

    expect(doubleClick.defaultPrevented).toBe(true);
    expect(slider).toHaveValue('7');
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
