import { useEffect, useState } from 'react';
import type { ElectronKaraokeSubtitleLine } from '../../electron/electronApi';

export function getKaraokeCharacterProgress(currentTime: number, start: number, end: number) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= start) return currentTime >= start ? 1 : 0;
  return Math.max(0, Math.min(1, (currentTime - start) / (end - start)));
}

export default function KaraokeSubtitleOverlay({
  visible,
  currentTime,
  lines,
  videoElement,
  isPlaying,
  size = 'player'
}: {
  visible: boolean;
  currentTime: number;
  lines: ElectronKaraokeSubtitleLine[];
  videoElement?: HTMLVideoElement | null;
  isPlaying?: boolean;
  size?: 'player' | 'preview';
}) {
  const [animationTime, setAnimationTime] = useState(currentTime);

  useEffect(() => {
    if (!videoElement || !isPlaying || !visible) {
      setAnimationTime(currentTime);
      return;
    }

    let frameId = 0;
    const updateTime = () => {
      setAnimationTime(videoElement.currentTime);
      frameId = window.requestAnimationFrame(updateTime);
    };
    frameId = window.requestAnimationFrame(updateTime);
    return () => window.cancelAnimationFrame(frameId);
  }, [currentTime, isPlaying, videoElement, visible]);

  if (!visible) return null;
  const activeLine = lines.find(line => animationTime >= line.start && animationTime <= line.end);
  if (!activeLine) return null;

  return (
    <div
      aria-label="Karaoke subtitles"
      aria-live="off"
      className={`karaoke-subtitle-overlay karaoke-subtitle-overlay-${size}`}
      style={{ position: 'absolute', zIndex: 5, left: '50%', bottom: '9%', width: 'max-content', maxWidth: 'calc(100% - 48px)', boxSizing: 'border-box', transform: 'translateX(-50%)', padding: '1px 12px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, textAlign: 'center', fontSize: 'clamp(22px, 3.2vw, 48px)', fontWeight: 700, lineHeight: 1.45, letterSpacing: '0.04em', background: 'rgba(0,0,0,0.72)', outline: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.28)', pointerEvents: 'none' }}
    >
      {activeLine.characters.map((character, index) => {
        const progress = getKaraokeCharacterProgress(animationTime, character.start, character.end);
        const percentage = `${progress * 100}%`;
        return (
          <span
            key={`${index}:${character.start}`}
            data-fill-progress={progress}
            style={{
              backgroundImage: `linear-gradient(90deg, #a4e8d1 0%, #a4e8d1 ${percentage}, #fff ${percentage}, #fff 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent'
            }}
          >
            {character.text}
          </span>
        );
      })}
    </div>
  );
}
