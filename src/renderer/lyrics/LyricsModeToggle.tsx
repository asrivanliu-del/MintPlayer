type LyricsModeToggleProps = {
  mode: 'static' | 'synchronized';
  onModeChange: (mode: 'static' | 'synchronized') => void;
};

export default function LyricsModeToggle({ mode, onModeChange }: LyricsModeToggleProps) {
  const nextMode = mode === 'static' ? 'synchronized' : 'static';

  return (
    <button
      type="button"
      className="media-mode-toggle"
      onClick={() => onModeChange(nextMode)}
      aria-label={mode === 'static' ? 'Switch to synchronized lyrics' : 'Switch to static lyrics'}
      title={mode === 'static' ? 'Synchronized lyrics' : 'Static lyrics'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 42,
        height: 42,
        minWidth: 0,
        padding: 0,
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.04)',
        color: '#f5f7fb',
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: '0 12px 26px rgba(0,0,0,0.18)'
      }}
    >
      {mode === 'static' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 12h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
