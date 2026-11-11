import React from 'react';
import type { RefObject } from 'react';
import type { TimedLyric } from '../types';
import { formatLyricTime, stripLyricTimestamps } from './lyricsUtils';

type LyricsContentProps = {
  lyricsRaw: string | null;
  lyricsTimed: TimedLyric[] | null;
  mode: 'static' | 'synchronized';
  activeIndex: number;
  onSeek: (time: number) => void;
  containerRef?: RefObject<HTMLDivElement>;
  variant: 'player' | 'dialog';
};

export default function LyricsContent({
  lyricsRaw,
  lyricsTimed,
  mode,
  activeIndex,
  onSeek,
  containerRef,
  variant
}: LyricsContentProps) {
  const staticText = stripLyricTimestamps(lyricsRaw || (lyricsTimed ? lyricsTimed.map(line => line.text).join('\n') : ''));
  const hasTimedLyrics = Boolean(lyricsTimed?.length);
  const hasLyricsForMode = mode === 'static' ? Boolean(staticText) : hasTimedLyrics || Boolean(lyricsRaw);
  const lineStyle: React.CSSProperties = {
    padding: '9px 10px',
    background: 'transparent',
    borderRadius: 10,
    transition: 'background 0.08s',
    cursor: 'pointer',
    marginBottom: 2
  };

  const emptyLyricsState = (
    <div
      role="img"
      aria-label={mode === 'static' ? 'No lyrics found' : 'No synchronized lyrics found'}
      title={mode === 'static' ? 'No lyrics found' : 'No synchronized lyrics found'}
      style={{
        display: 'grid',
        placeItems: 'center',
        flex: '1 1 auto',
        minHeight: variant === 'dialog' ? 240 : 0,
        color: 'rgba(237,243,255,0.42)'
      }}
    >
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        {mode === 'static' && <path d="M4 12h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />}
        <path d="m3 21 18-18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  );

  return (
    <div
      ref={containerRef}
      style={variant === 'player'
        ? { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, overflow: 'auto', background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 16, border: '1px solid rgba(255,255,255,0.04)' }
        : { display: 'flex', flexDirection: 'column', maxHeight: 400, overflow: 'auto', background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.04)' }}
    >
      {!hasLyricsForMode ? emptyLyricsState : mode === 'static' || !hasTimedLyrics ? (
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.95rem', lineHeight: 1.7, color: '#edf3ff' }}>
          {mode === 'static' ? staticText : lyricsRaw}
        </pre>
      ) : (
        <div style={variant === 'dialog' ? { maxHeight: 360, overflow: 'auto' } : { flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
          {lyricsTimed?.map((line, index) => (
            <div
              id={`lyr-line-${index}`}
              key={index}
              role="button"
              tabIndex={0}
              aria-label={`Seek to ${formatLyricTime(line.time)}`}
              onClick={() => onSeek(line.time)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSeek(line.time);
                }
              }}
              className="lyric-line"
              style={{
                ...lineStyle,
                background: index === activeIndex ? 'linear-gradient(135deg, rgba(141,217,193,0.28), rgba(84,185,158,0.16))' : 'transparent',
                fontWeight: index === activeIndex ? 800 : 400,
                color: index === activeIndex ? '#e7f3e8' : '#dfe6f4'
              }}
            >
              <span style={{ color: '#cdd9f8', marginRight: 10, fontFamily: 'monospace', fontSize: '0.78rem' }}>{formatLyricTime(line.time)}</span>
              <span style={{ fontSize: index === activeIndex ? '1.05em' : '1em' }}>{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
