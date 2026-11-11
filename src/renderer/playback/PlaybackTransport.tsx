import type { MediaLibraryRole } from '../playlist/mediaLibraryUtils';

type PlaybackTransportProps = {
  currentTime: number;
  duration: number;
  formatTime: (time: number) => string;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  mediaAvailability: Record<MediaLibraryRole, boolean>;
  backingActive: boolean;
  selectedMediaRole: MediaLibraryRole | null;
  onPlayMediaRole: (role: MediaLibraryRole) => void;
  karaokeAudioSource: 'accompaniment' | 'vocals' | 'original';
  hasKaraokeAccompaniment: boolean;
  hasKaraokeVocals: boolean;
  karaokeHasVideo: boolean;
  onKaraokeAudioSourceChange: (source: 'accompaniment' | 'vocals' | 'original') => void;
  aoStemSource: 'music' | 'video';
  aoStemAvailability: { music: boolean; video: boolean };
  onAoStemSourceChange: (role: 'accompaniments' | 'vocals', source: 'music' | 'video') => void;
};

const transportButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: '#f5f7fb',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: 'none'
};

function MediaRoleIcon({ role }: { role: MediaLibraryRole }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {role === 'music' ? (
        <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Zm12-2a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : role === 'video' ? (
        <path d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H4Zm12 4 6-3v10l-6-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : role === 'karaoke' ? (
        <path d="M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Zm-7 10a7 7 0 0 0 14 0m-7 7v3m-4 0h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : role === 'accompaniments' ? (
        <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Zm12-2a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3ZM3 8h3m-3 4h3m-3 4h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M3 10v4m4-8v12m4-15v18m4-13v8m4-10v12m3-9v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export default function PlaybackTransport({
  currentTime,
  duration,
  formatTime,
  onSeek,
  isPlaying,
  onPrevious,
  onTogglePlayback,
  onNext,
  mediaAvailability,
  backingActive,
  selectedMediaRole,
  onPlayMediaRole,
  karaokeAudioSource,
  hasKaraokeAccompaniment,
  hasKaraokeVocals,
  karaokeHasVideo,
  onKaraokeAudioSourceChange,
  aoStemSource,
  aoStemAvailability,
  onAoStemSourceChange
}: PlaybackTransportProps) {
  const mediaButtons: Array<{
    role: MediaLibraryRole;
    label: string;
    title: string;
    enabled: boolean;
  }> = [
    { role: 'music', label: 'Play music', title: 'Play music', enabled: mediaAvailability.music },
    { role: 'video', label: 'Play video', title: 'Play video', enabled: mediaAvailability.video },
    {
      role: 'karaoke',
      label: karaokeHasVideo ? 'Play karaoke video' : 'Play karaoke',
      title: karaokeHasVideo ? 'Play video with karaoke subtitle overlay' : 'Play music with karaoke subtitle overlay',
      enabled: mediaAvailability.karaoke
    },
    {
      role: 'accompaniments',
      label: 'Play accompaniments',
      title: 'Play accompaniments',
      enabled: mediaAvailability.accompaniments
    },
    { role: 'vocals', label: 'Play vocals', title: 'Play vocals', enabled: mediaAvailability.vocals }
  ];

  return (
    <>
      <div className="seek" aria-label="Seek controls" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 260px', minWidth: 200 }}>
        <span className="time" style={{ minWidth: 42, fontSize: '0.82rem', textAlign: 'center', color: '#dfe6f4' }}>{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, duration)}
          step={0.1}
          value={currentTime}
          onChange={event => onSeek(Number(event.currentTarget.value))}
          aria-label="Seek"
          aria-valuetext={`Seek: ${formatTime(currentTime)} / ${formatTime(duration)}`}
          style={{ flex: 1 }}
        />
        <span className="time" style={{ minWidth: 42, fontSize: '0.82rem', textAlign: 'center', color: '#dfe6f4' }}>{formatTime(duration)}</span>
      </div>

      <div className="transport-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
        <button className="icon-btn" onClick={onPrevious} aria-label="Previous" title="Previous track" style={transportButtonStyle}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 18V6l-8.5 6L11 18zM22 6v12h-2V6h2z" fill="currentColor"/></svg>
        </button>
        <button
          className="icon-btn"
          onClick={onTogglePlayback}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-pressed={isPlaying}
          title={isPlaying ? 'Pause' : 'Play'}
          style={{ background: 'linear-gradient(135deg, #ff9c4b, #ff6b6b)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 20px rgba(255,107,107,0.24)' }}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 5h4v14H7zM15 5h4v14h-4z" fill="currentColor"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7L8 5z" fill="currentColor"/></svg>
          )}
        </button>
        <button className="icon-btn" onClick={onNext} aria-label="Next" title="Next track" style={transportButtonStyle}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 6v12l8.5-6L13 6zM2 18V6h2v12H2z" fill="currentColor"/></svg>
        </button>
      </div>
      <div className="player-media-role-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
        {mediaButtons.map(({ role, label, title, enabled }) => (
          <button
            key={role}
            type="button"
            className="icon-btn player-media-role-button"
            onClick={() => onPlayMediaRole(role)}
            disabled={!enabled}
            data-available={enabled ? 'true' : 'false'}
            aria-label={label}
            aria-pressed={selectedMediaRole === role}
            title={enabled && role === 'accompaniments' && backingActive ? 'Play original track' : title}
          >
            <MediaRoleIcon role={role} />
          </button>
        ))}
        {selectedMediaRole === 'karaoke' && (
          <div
            role="group"
            aria-label={karaokeHasVideo ? 'Karaoke audio source' : 'Karaoke music source'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              padding: 3,
              borderRadius: 12,
              border: '1px solid rgba(164,232,209,0.28)',
              background: 'rgba(255,255,255,0.045)'
            }}
          >
            <button
              type="button"
              className="karaoke-audio-source-button"
              aria-label={karaokeHasVideo ? 'Karaoke audio: Accompaniment' : 'Karaoke music: Accompaniment'}
              aria-pressed={karaokeAudioSource === 'accompaniment'}
              title={hasKaraokeAccompaniment ? 'Play accompaniment with karaoke' : 'Run Vocal Splitter to create an accompaniment first'}
              disabled={!hasKaraokeAccompaniment}
              onClick={() => onKaraokeAudioSourceChange('accompaniment')}
              style={{
                border: 0,
                borderRadius: 9,
                padding: '7px 10px',
                color: karaokeAudioSource === 'accompaniment' ? '#14251f' : 'rgba(245,247,251,0.78)',
                background: karaokeAudioSource === 'accompaniment' ? 'linear-gradient(135deg, #a4e8d1, #69c2a6)' : 'transparent',
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                cursor: hasKaraokeAccompaniment ? 'pointer' : 'not-allowed',
                opacity: hasKaraokeAccompaniment ? 1 : 0.45
              }}
            >
              Accompaniment
            </button>
            {karaokeHasVideo ? (
              <button
                type="button"
                className="karaoke-audio-source-button"
                aria-label="Karaoke audio: Original"
                aria-pressed={karaokeAudioSource === 'original'}
                title="Play the original mixed audio from the video"
                onClick={() => onKaraokeAudioSourceChange('original')}
                style={{
                  border: 0,
                  borderRadius: 9,
                  padding: '7px 10px',
                  color: karaokeAudioSource === 'original' ? '#14251f' : 'rgba(245,247,251,0.78)',
                  background: karaokeAudioSource === 'original' ? 'linear-gradient(135deg, #a4e8d1, #69c2a6)' : 'transparent',
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer'
                }}
              >
                Original
              </button>
            ) : (
              <button
                type="button"
                className="karaoke-audio-source-button"
                aria-label="Karaoke music: Vocals"
                aria-pressed={karaokeAudioSource === 'vocals'}
                title={hasKaraokeVocals ? 'Play the vocals stem with karaoke subtitles' : 'Create the vocals stem first'}
                disabled={!hasKaraokeVocals}
                onClick={() => onKaraokeAudioSourceChange('vocals')}
                style={{
                  border: 0,
                  borderRadius: 9,
                  padding: '7px 10px',
                  color: karaokeAudioSource === 'vocals' ? '#14251f' : 'rgba(245,247,251,0.78)',
                  background: karaokeAudioSource === 'vocals' ? 'linear-gradient(135deg, #a4e8d1, #69c2a6)' : 'transparent',
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  cursor: hasKaraokeVocals ? 'pointer' : 'not-allowed',
                  opacity: hasKaraokeVocals ? 1 : 0.45
                }}
              >
                Vocals
              </button>
            )}
          </div>
        )}
        {(selectedMediaRole === 'accompaniments' || selectedMediaRole === 'vocals') && (
          <div
            role="group"
            aria-label={`${selectedMediaRole === 'accompaniments' ? 'Accompaniment' : 'Vocals'} source`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              padding: 3,
              borderRadius: 12,
              border: '1px solid rgba(164,232,209,0.28)',
              background: 'rgba(255,255,255,0.045)'
            }}
          >
            {(['music', 'video'] as const).map(source => {
              const label = source === 'music' ? 'Music' : 'Video';
              const enabled = aoStemAvailability[source];
              const roleLabel = selectedMediaRole === 'accompaniments' ? 'Accompaniment' : 'Vocals';
              return (
                <button
                  key={source}
                  type="button"
                  className="karaoke-audio-source-button"
                  aria-label={`${roleLabel} source: ${label}`}
                  aria-pressed={aoStemSource === source}
                  title={enabled ? `Play ${roleLabel.toLocaleLowerCase()} from ${label}` : `No ${roleLabel.toLocaleLowerCase()} stem for ${label}`}
                  disabled={!enabled}
                  onClick={() => onAoStemSourceChange(selectedMediaRole, source)}
                  style={{
                    border: 0,
                    borderRadius: 9,
                    padding: '7px 10px',
                    color: aoStemSource === source ? '#14251f' : 'rgba(245,247,251,0.78)',
                    background: aoStemSource === source ? 'linear-gradient(135deg, #a4e8d1, #69c2a6)' : 'transparent',
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    cursor: enabled ? 'pointer' : 'not-allowed',
                    opacity: enabled ? 1 : 0.45
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
