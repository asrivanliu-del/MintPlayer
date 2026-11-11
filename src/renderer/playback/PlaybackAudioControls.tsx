import React from 'react';
import TransposeControls from '../transpose/TransposeControls';

type PlaybackAudioControlsProps = {
  volume: number;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  pan: number;
  onPanChange: (value: number) => void;
  isVideo: boolean;
  transpose: number;
  onTransposeChange: (value: number) => void;
  showDebug: boolean;
  onToggleDebug: () => void;
};

const iconButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: '#f5f7fb',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: 'none'
};

export default function PlaybackAudioControls({
  volume,
  onVolumeChange,
  onToggleMute,
  pan,
  onPanChange,
  isVideo,
  transpose,
  onTransposeChange,
  showDebug,
  onToggleDebug
}: PlaybackAudioControlsProps) {
  return (
    <>
      <div
        className="audio-controls"
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 0, flex: '1 1 220px', minWidth: 200, flexWrap: 'wrap' }}
      >
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleMute}
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
          title={volume > 0 ? 'Mute' : 'Unmute'}
          style={iconButtonStyle}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            {volume <= 0 ? (
              <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <>
                {volume > 0.03 && <path d="M16 9a5 5 0 0 1 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
                {volume > 0.33 && <path d="M18.5 6.5a9 9 0 0 1 0 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
                {volume > 0.66 && <path d="M21 4a13 13 0 0 1 0 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
              </>
            )}
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={event => onVolumeChange(Number(event.currentTarget.value))}
          aria-label="Volume"
          aria-valuetext={`Volume: ${Math.round(volume * 100)}%`}
          title={`Volume: ${Math.round(volume * 100)}%`}
          style={{ width: 100 }}
        />
      </div>

      <div className="playback-tool-controls" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', minWidth: 0, flexWrap: 'nowrap' }}>
        <div
          className="pan-panel"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, minWidth: 0, whiteSpace: 'nowrap' }}
        >
          <label htmlFor="pan-control" style={{ fontSize: '0.82rem', color: '#dfe6f4', fontWeight: 600 }}>L</label>
          <input
            id="pan-control"
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={pan}
            onChange={event => onPanChange(Number(event.currentTarget.value))}
            onDoubleClick={event => {
              event.preventDefault();
              onPanChange(0);
            }}
            aria-label="Pan"
            aria-valuetext={Math.abs(pan) < 0.005
              ? 'Pan: M'
              : `Pan: ${pan < 0 ? 'L' : 'R'} ${Math.round(Math.abs(pan) * 100)}%`}
            title={isVideo ? 'Pan video audio left or right' : 'Pan'}
            style={{ width: 90, accentColor: '#ff9c4b' }}
          />
          <label htmlFor="pan-control" style={{ fontSize: '0.82rem', color: '#dfe6f4', fontWeight: 600 }}>R</label>
        </div>

        <TransposeControls
          value={transpose}
          onChange={onTransposeChange}
          title={isVideo ? 'Transpose video audio' : undefined}
        />
        <button type="button" className="debug-toggle" onClick={onToggleDebug} aria-pressed={showDebug}>
          {showDebug ? 'Hide debug' : 'Show debug'}
        </button>
      </div>
    </>
  );
}
