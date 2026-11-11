import type { RefObject } from 'react';
import type { TimedLyric } from '../types';
import LyricsContent from './LyricsContent';

type LyricsDialogProps = {
  visible: boolean;
  lyricsRaw: string | null;
  lyricsTimed: TimedLyric[] | null;
  mode: 'static' | 'synchronized';
  activeIndex: number;
  containerRef: RefObject<HTMLDivElement>;
  onModeChange: (mode: 'static' | 'synchronized') => void;
  onSeek: (time: number) => void;
  onClose: () => void;
};

export default function LyricsDialog({
  visible,
  lyricsRaw,
  lyricsTimed,
  mode,
  activeIndex,
  containerRef,
  onModeChange,
  onSeek,
  onClose
}: LyricsDialogProps) {
  if (!visible) return null;
  return (
    <div className="lyrics-dialog-overlay" style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.63)', zIndex: 10000 }}>
      <div className="lyrics-dialog-panel" style={{ background: '#17181d', color: '#f5f7fb', padding: 16, borderRadius: 20, width: '70%', maxWidth: 800, maxHeight: '80%', overflow: 'auto', boxShadow: '0 22px 50px rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <h3 style={{ marginTop: 0 }}>Lyrics</h3>
        <div style={{ marginBottom: 8 }}>
          <label style={{ marginRight: 8, color: '#dfe6f4' }}>Display mode:</label>
          <select
            value={mode}
            onChange={event => onModeChange(event.currentTarget.value as 'static' | 'synchronized')}
            style={{ background: 'rgba(255,255,255,0.04)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px 10px' }}
          >
            <option value="static" style={{ background: '#17181d' }}>Static (no timestamps)</option>
            <option value="synchronized" style={{ background: '#17181d' }}>Synchronized (show timestamps if available)</option>
          </select>
        </div>
        <LyricsContent
          lyricsRaw={lyricsRaw}
          lyricsTimed={lyricsTimed}
          mode={mode}
          activeIndex={activeIndex}
          onSeek={onSeek}
          containerRef={containerRef}
          variant="dialog"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#f5f7fb', padding: '8px 12px' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
