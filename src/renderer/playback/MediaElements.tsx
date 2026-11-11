import React from 'react';
import type { RefObject } from 'react';

type VideoElementProps = React.VideoHTMLAttributes<HTMLVideoElement> & {
  mediaRef: RefObject<HTMLVideoElement>;
};

export function VideoElement({ mediaRef, ...props }: VideoElementProps) {
  return <video ref={mediaRef} {...props} />;
}

type AudioElementProps = React.AudioHTMLAttributes<HTMLAudioElement> & {
  mediaRef: RefObject<HTMLAudioElement>;
};

export function AudioElement({ mediaRef, ...props }: AudioElementProps) {
  return <audio ref={mediaRef} {...props} />;
}

type VideoSeekControlsProps = {
  visible: boolean;
  controlsVisible: boolean;
  currentTime: number;
  duration: number;
  formatTime: (time: number) => string;
  onShowControls: () => void;
  onSeek: (time: number) => void;
};

export function VideoSeekControls({
  visible,
  controlsVisible,
  currentTime,
  duration,
  formatTime,
  onShowControls,
  onSeek
}: VideoSeekControlsProps) {
  if (!visible) return null;
  return (
    <div className={`fullscreen-video-controls${controlsVisible ? ' visible' : ''}`}>
      <span>{formatTime(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(0, duration)}
        step={0.05}
        value={Math.min(currentTime, Math.max(0, duration))}
        aria-label="Video playback position"
        aria-valuetext={`Playback position: ${formatTime(currentTime)} / ${formatTime(duration)}`}
        onFocus={onShowControls}
        onPointerDown={onShowControls}
        onChange={event => onSeek(Number(event.currentTarget.value))}
      />
      <span>{formatTime(duration)}</span>
    </div>
  );
}
