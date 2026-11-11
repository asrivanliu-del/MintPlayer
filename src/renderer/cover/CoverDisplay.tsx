type PlaylistTrackCoverProps = {
  visible: boolean;
  src?: string;
};

export function PlaylistTrackCover({ visible, src }: PlaylistTrackCoverProps) {
  if (!visible) return null;
  return src
    ? <img className="track-cover" src={src} alt="" draggable={false} />
    : <span className="track-cover track-cover-placeholder" aria-hidden="true">♪</span>;
}

type PlayerCoverProps = {
  visible: boolean;
  isVideo: boolean;
  src?: string;
  onTop: boolean;
};

export function PlayerCover({ visible, isVideo, src, onTop }: PlayerCoverProps) {
  if (!visible) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: onTop ? 2 : 1, opacity: 1, transition: 'opacity 0.18s ease' }}>
      {isVideo ? null : src ? (
        <img src={src} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: 'rgba(13,15,20,0.18)' }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: '#fff', fontWeight: 700, letterSpacing: 0.4 }}>Cover</div>
      )}
    </div>
  );
}
