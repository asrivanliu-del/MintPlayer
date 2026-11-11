import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import KaraokeSubtitleOverlay, { getKaraokeCharacterProgress } from '../../src/renderer/playback/KaraokeSubtitleOverlay';

const lines = [{
  start: 2,
  end: 4,
  text: '飛瀑',
  characters: [
    { text: '飛', start: 2, end: 3 },
    { text: '瀑', start: 3, end: 4 }
  ]
}];

describe('Karaoke subtitle overlay', () => {
  it('fills each character from left to right across its singing duration', () => {
    render(<KaraokeSubtitleOverlay visible currentTime={2.5} lines={lines} />);

    const overlay = screen.getByLabelText('Karaoke subtitles');
    expect(overlay).toHaveClass('karaoke-subtitle-overlay-player');
    expect(overlay).toHaveTextContent('飛瀑');
    expect(overlay.getAttribute('style')).toContain('background: rgba(0, 0, 0, 0.72)');
    expect(overlay.getAttribute('style')).toContain('padding: 1px 12px');
    expect(overlay.getAttribute('style')).toContain('border-radius: 8px');
    expect(overlay.getAttribute('style')).toContain('outline: none');
    expect(overlay.getAttribute('style')).toContain('box-shadow: 0 2px 12px rgba(0,0,0,0.28)');
    expect(overlay.children[0]).toHaveAttribute('data-fill-progress', '0.5');
    expect(overlay.children[0].getAttribute('style')).toContain(
      'background-image: linear-gradient(90deg, rgb(164, 232, 209) 0%, rgb(164, 232, 209) 50%, rgb(255, 255, 255) 50%, rgb(255, 255, 255) 100%)'
    );
    expect(overlay.children[0].getAttribute('style')).toContain('background-clip: text');
    expect(overlay.children[0].getAttribute('style')).toContain('color: transparent');
    expect(overlay.children[1]).toHaveAttribute('data-fill-progress', '0');
  });

  it('supports a smaller video-preview size without changing the player overlay', () => {
    render(<KaraokeSubtitleOverlay visible currentTime={2.5} lines={lines} size="preview" />);

    expect(screen.getByLabelText('Karaoke subtitles')).toHaveClass('karaoke-subtitle-overlay-preview');
  });

  it('clamps fill progress before and after the character and handles zero-duration timing', () => {
    expect(getKaraokeCharacterProgress(1, 2, 3)).toBe(0);
    expect(getKaraokeCharacterProgress(4, 2, 3)).toBe(1);
    expect(getKaraokeCharacterProgress(2, 2, 2)).toBe(1);
    expect(getKaraokeCharacterProgress(Number.NaN, 2, 3)).toBe(0);
  });

  it('fills the preceding character fully while the next character is filling', () => {
    render(<KaraokeSubtitleOverlay visible currentTime={3.5} lines={lines} />);

    const overlay = screen.getByLabelText('Karaoke subtitles');
    expect(overlay.children[0]).toHaveAttribute('data-fill-progress', '1');
    expect(overlay.children[1]).toHaveAttribute('data-fill-progress', '0.5');
  });

  it('hides subtitles when the line is not active or karaoke playback is off', () => {
    const { rerender } = render(<KaraokeSubtitleOverlay visible currentTime={4.5} lines={lines} />);
    expect(screen.queryByLabelText('Karaoke subtitles')).not.toBeInTheDocument();

    rerender(<KaraokeSubtitleOverlay visible={false} currentTime={2.5} lines={lines} />);
    expect(screen.queryByLabelText('Karaoke subtitles')).not.toBeInTheDocument();
  });
});
