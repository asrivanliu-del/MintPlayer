import React from 'react';

type TransposeControlsProps = {
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
  title?: string;
};

const buttonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: '#f5f7fb',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: 'none'
};

export default function TransposeControls({ value, onChange, compact = false, title }: TransposeControlsProps) {
  const adjust = (amount: number) => onChange(Math.max(-12, Math.min(12, value + amount)));

  return (
    <div
      className={compact ? undefined : 'transpose-panel'}
      title={title}
      style={compact ? { display: 'flex', flexDirection: 'column', gap: 8 } : {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        minWidth: 0,
        whiteSpace: 'nowrap'
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="icon-btn" onClick={() => adjust(-4)} style={buttonStyle}>-4</button>
        <button className="icon-btn" onClick={() => adjust(-1)} style={buttonStyle}>-1</button>
        <button
          type="button"
          className="icon-btn"
          title="Reset transpose to 0"
          aria-label="Reset transpose to 0"
          onClick={() => onChange(0)}
          style={{ ...buttonStyle, padding: '6px 10px', borderRadius: 10, minWidth: 48, textAlign: 'center', fontWeight: 700, color: '#fff' }}
        >
          0
        </button>
        <button className="icon-btn" onClick={() => adjust(1)} style={buttonStyle}>+1</button>
        <button className="icon-btn" onClick={() => adjust(4)} style={buttonStyle}>+4</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: compact ? 8 : 0 }}>
        <span style={{ fontSize: '0.78rem', color: '#dfe6f4' }}>-12</span>
        <div className="transpose-slider" style={compact ? undefined : { width: 120, flex: '0 0 120px' }}>
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={value}
            title="Transpose"
            aria-valuetext={`Transpose: ${value > 0 ? '+' : ''}${value} semitones`}
            onChange={event => onChange(Number(event.currentTarget.value))}
            onDoubleClick={event => {
              event.preventDefault();
              onChange(0);
            }}
            aria-label="Transpose"
            style={compact ? undefined : { accentColor: '#ff9c4b' }}
          />
          <div className="transpose-slider-ticks" aria-hidden="true">
            {Array.from({ length: 25 }, (_, tick) => <span key={tick} className={tick % 4 === 0 ? 'major' : undefined} />)}
          </div>
        </div>
        <span style={{ fontSize: '0.78rem', color: '#dfe6f4' }}>+12</span>
      </div>
    </div>
  );
}
