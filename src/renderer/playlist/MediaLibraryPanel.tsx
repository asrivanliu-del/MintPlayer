import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { hasElectronCapability } from '../../electron/electronApi';
import {
  TRACK_LIST_OVERSCAN,
  TRACK_LIST_VIRTUALIZATION_THRESHOLD,
  TRACK_ROW_HEIGHT,
  TRACK_ROW_STRIDE
} from './playlistUtils';
import { musicFileUrl } from '../playback/mediaSource';
import {
  filterMediaLibrarySongs,
  getMediaLibraryRoleFromFilePath,
  getMediaLibraryRolePath,
  getMediaLibrarySongPath,
  getMediaLibrarySongPlaybackPath,
  getVideoResolutionLabel,
  groupMediaLibraryFiles,
  MEDIA_LIBRARY_ROLES,
  type MediaLibraryRole
} from './mediaLibraryUtils';

type MediaLibraryPanelProps = {
  libraryPath: string;
  refreshKey: number;
  onAddToPlaylist: (filePaths: string[]) => void;
  onPlayFile: (filePath: string, role: MediaLibraryRole) => void;
};

const MEDIA_ROLE_DETAILS: Record<MediaLibraryRole, { label: string }> = {
  music: { label: 'Music' },
  video: { label: 'Video' },
  karaoke: { label: 'Karaoke lyrics' },
  accompaniments: { label: 'Accompaniments (伴奏)' },
  vocals: { label: 'Vocals (人聲)' }
};

function MediaRoleIcon({ role }: { role: MediaLibraryRole }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

export default function MediaLibraryPanel({ libraryPath, refreshKey, onAddToPlaylist, onPlayFile }: MediaLibraryPanelProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [additionalRoleFilters, setAdditionalRoleFilters] = useState({
    karaoke: false,
    accompaniments: false,
    vocals: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [visibleWindow, setVisibleWindow] = useState({ start: 0, end: 40 });
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(() => new Set());
  const [fileMetadata, setFileMetadata] = useState<Record<string, { bitrate?: number; resolution?: string }>>({});
  const selectionAnchorSongIdRef = useRef<string | null>(null);
  const metadataRequestsRef = useRef(new Set<string>());
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    if (!libraryPath.trim()) {
      setFiles([]);
      setError('');
      setIsLoading(false);
      return () => { isCurrent = false; };
    }

    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'readdirRecursive')) {
      setFiles([]);
      setError('Folder scanning is unavailable in this app version.');
      setIsLoading(false);
      return () => { isCurrent = false; };
    }

    setIsLoading(true);
    setError('');
    void api.readdirRecursive(libraryPath.trim())
      .then(result => {
        if (!isCurrent) return;
        if (!result.ok) throw new Error(result.error);
        setFiles([...result.files].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
      })
      .catch(cause => {
        if (!isCurrent) return;
        const message = `Unable to scan media library: ${String(cause)}`;
        console.error(message, cause);
        setFiles([]);
        setError(message);
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => { isCurrent = false; };
  }, [libraryPath, refreshKey, refreshVersion]);

  const songs = useMemo(() => groupMediaLibraryFiles(files, libraryPath), [files, libraryPath]);
  const filteredSongs = useMemo(
    () => filterMediaLibrarySongs(songs, search, musicEnabled, videoEnabled, additionalRoleFilters),
    [additionalRoleFilters, musicEnabled, search, songs, videoEnabled]
  );
  const virtualized = filteredSongs.length > TRACK_LIST_VIRTUALIZATION_THRESHOLD;
  const visibleSongs = virtualized
    ? filteredSongs.slice(visibleWindow.start, visibleWindow.end)
    : filteredSongs;
  const visibleSongIds = visibleSongs.map(song => song.id).join('\0');
  const selectedFilePaths = filteredSongs
    .filter(song => selectedSongIds.has(song.id))
    .map(getMediaLibrarySongPath)
    .filter((filePath): filePath is string => !!filePath);

  useEffect(() => {
    setVisibleWindow({ start: 0, end: 40 });
    const filteredSongIds = new Set(filteredSongs.map(song => song.id));
    setSelectedSongIds(previous => new Set([...previous].filter(id => filteredSongIds.has(id))));
    if (selectionAnchorSongIdRef.current && !filteredSongIds.has(selectionAnchorSongIdRef.current)) {
      selectionAnchorSongIdRef.current = null;
    }
  }, [filteredSongs]);

  useEffect(() => {
    const songsToLoad = visibleSongs.filter(song =>
      (getMediaLibraryRolePath(song, 'music') && !metadataRequestsRef.current.has(`bitrate:${getMediaLibraryRolePath(song, 'music')}`)) ||
      (getMediaLibraryRolePath(song, 'video') && !metadataRequestsRef.current.has(`resolution:${getMediaLibraryRolePath(song, 'video')}`))
    );
    let nextSongIndex = 0;

    async function loadSongMetadata(song: typeof visibleSongs[number]) {
      const musicPath = getMediaLibraryRolePath(song, 'music');
      if (musicPath) {
        const requestKey = `bitrate:${musicPath}`;
        if (!metadataRequestsRef.current.has(requestKey)) {
          metadataRequestsRef.current.add(requestKey);
          try {
            const api = window.electronAPI;
            if (!hasElectronCapability(api, 'getBitrate')) {
              throw new Error('Bitrate reading is unavailable in this app version.');
            }
            const result = await api.getBitrate(musicPath);
            if (!result.ok) throw new Error(result.error);
            const bitrate = Number(result.bitrate);
            if (isMountedRef.current && Number.isFinite(bitrate) && bitrate > 0) {
              setFileMetadata(current => ({ ...current, [musicPath]: { ...current[musicPath], bitrate } }));
            }
          } catch (cause) {
            console.warn(`Unable to read media library bitrate for ${musicPath}`, cause);
          }
        }
      }

      const videoPath = getMediaLibraryRolePath(song, 'video');
      if (!videoPath) return;
      const requestKey = `resolution:${videoPath}`;
      if (metadataRequestsRef.current.has(requestKey)) return;
      metadataRequestsRef.current.add(requestKey);
      try {
        const resolution = await new Promise<string>((resolve, reject) => {
          const video = document.createElement('video');
          let timeout = 0;
          const cleanup = () => {
            window.clearTimeout(timeout);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onError);
            video.removeAttribute('src');
            video.load();
          };
          const onLoadedMetadata = () => {
            if (!video.videoWidth || !video.videoHeight) {
              cleanup();
              reject(new Error(`Video dimensions unavailable for ${videoPath}`));
              return;
            }
            const label = getVideoResolutionLabel(video.videoWidth, video.videoHeight);
            cleanup();
            resolve(label);
          };
          const onError = () => {
            cleanup();
            reject(new Error(`Could not load video metadata for ${videoPath}`));
          };
          timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out loading video metadata for ${videoPath}`));
          }, 15000);
          video.preload = 'metadata';
          video.addEventListener('loadedmetadata', onLoadedMetadata);
          video.addEventListener('error', onError);
          video.src = musicFileUrl(videoPath);
          video.load();
        });
        if (isMountedRef.current) {
          setFileMetadata(current => ({ ...current, [videoPath]: { ...current[videoPath], resolution } }));
        }
      } catch (cause) {
        console.warn(`Unable to read media library video resolution for ${videoPath}`, cause);
      }
    }

    async function runMetadataWorkers() {
      async function worker() {
        while (nextSongIndex < songsToLoad.length) {
          const song = songsToLoad[nextSongIndex++];
          await loadSongMetadata(song);
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, songsToLoad.length) }, () => worker()));
    }
    void runMetadataWorkers();
  }, [songs, visibleSongIds, refreshVersion]);

  function updateVisibleWindow(list: HTMLUListElement) {
    if (!virtualized) return;
    const firstVisibleRow = Math.floor(list.scrollTop / TRACK_ROW_STRIDE);
    const visibleRowCount = Math.ceil(list.clientHeight / TRACK_ROW_STRIDE);
    const start = Math.max(0, firstVisibleRow - TRACK_LIST_OVERSCAN);
    const end = Math.min(filteredSongs.length, firstVisibleRow + visibleRowCount + TRACK_LIST_OVERSCAN);
    setVisibleWindow(current => current.start === start && current.end === end ? current : { start, end });
  }

  function selectSong(songIndex: number, event: MouseEvent<HTMLLIElement>) {
    const song = filteredSongs[songIndex];
    if (!song) return;

    if (event.shiftKey) {
      const anchorIndex = selectionAnchorSongIdRef.current
        ? filteredSongs.findIndex(item => item.id === selectionAnchorSongIdRef.current)
        : songIndex;
      const start = Math.min(anchorIndex < 0 ? songIndex : anchorIndex, songIndex);
      const end = Math.max(anchorIndex < 0 ? songIndex : anchorIndex, songIndex);
      const rangeIds = filteredSongs.slice(start, end + 1).map(item => item.id);
      setSelectedSongIds(previous => {
        const next = new Set(event.ctrlKey || event.metaKey ? previous : []);
        rangeIds.forEach(id => next.add(id));
        return next;
      });
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      selectionAnchorSongIdRef.current = song.id;
      setSelectedSongIds(previous => {
        const next = new Set(previous);
        if (next.has(song.id)) next.delete(song.id);
        else next.add(song.id);
        return next;
      });
      return;
    }

    selectionAnchorSongIdRef.current = song.id;
    setSelectedSongIds(new Set([song.id]));
  }

  function playSong(songIndex: number) {
    const song = filteredSongs[songIndex];
    const filePath = song && getMediaLibrarySongPlaybackPath(song);
    if (!song || !filePath) return;
    selectionAnchorSongIdRef.current = song.id;
    setSelectedSongIds(new Set([song.id]));
    const role = getMediaLibraryRoleFromFilePath(filePath);
    if (role) onPlayFile(filePath, role);
  }

  return (
    <section aria-label="Media library" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="search"
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
          aria-label="Search media library files"
          placeholder="Search files"
          style={{ flex: 1, minWidth: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.06)', color: '#f5f7fb', padding: '9px 12px' }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Refresh media library"
          title="Refresh media library"
          disabled={isLoading || !libraryPath.trim()}
          onClick={() => {
            metadataRequestsRef.current.clear();
            setFileMetadata({});
            setRefreshVersion(version => version + 1);
          }}
          style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5m-4.1-2A7.5 7.5 0 0 1 17.6 6L20 12M4 12l2.4 6A7.5 7.5 0 0 0 19.1 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div role="group" aria-label="Media library filters and actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="icon-btn media-library-category-toggle"
          aria-label="Music files"
          aria-pressed={musicEnabled}
          title={`Music files (${musicEnabled ? 'on' : 'off'})`}
          onClick={() => setMusicEnabled(enabled => !enabled)}
          style={{ width: 36, height: 36 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Zm12-2a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn media-library-category-toggle"
          aria-label="Video files"
          aria-pressed={videoEnabled}
          title={`Video files (${videoEnabled ? 'on' : 'off'})`}
          onClick={() => setVideoEnabled(enabled => !enabled)}
          style={{ width: 36, height: 36 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H4Zm12 4 6-3v10l-6-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {(['karaoke', 'accompaniments', 'vocals'] as const).map(role => {
          const label = MEDIA_ROLE_DETAILS[role].label;
          const enabled = additionalRoleFilters[role];
          return (
            <button
              key={role}
              type="button"
              className="icon-btn media-library-category-toggle"
              aria-label={`${label} files`}
              aria-pressed={enabled}
              title={`${label} files (${enabled ? 'on' : 'off'})`}
              onClick={() => setAdditionalRoleFilters(filters => ({ ...filters, [role]: !filters[role] }))}
              style={{ width: 36, height: 36 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                {role === 'karaoke' ? (
                  <path d="M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Zm-7 10a7 7 0 0 0 14 0m-7 7v3m-4 0h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ) : role === 'accompaniments' ? (
                  <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Zm12-2a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3ZM3 8h3m-3 4h3m-3 4h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M3 10v4m4-8v12m4-15v18m4-13v8m4-10v12m3-9v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
          );
        })}
        <button
          type="button"
          className="icon-btn media-library-add-button"
          aria-label={`Add ${selectedFilePaths.length} selected file${selectedFilePaths.length === 1 ? '' : 's'} to playlist`}
          title={selectedFilePaths.length
            ? `Add ${selectedFilePaths.length} selected file${selectedFilePaths.length === 1 ? '' : 's'} to playlist`
            : 'Select media files to add to playlist'}
          disabled={selectedFilePaths.length === 0}
          onClick={() => onAddToPlaylist(selectedFilePaths)}
          style={{ width: 36, height: 36, marginLeft: 'auto' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5h11M4 10h11M4 15h7M17 14v7m-3.5-3.5h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div title={libraryPath || 'No media library location configured'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.72rem', opacity: 0.72 }}>
        {libraryPath || 'Set a media library location in Settings'}
      </div>
      {isLoading && <div role="status" style={{ padding: 8, opacity: 0.75 }}>Scanning media library...</div>}
      {error && <div role="alert" style={{ padding: 8, color: '#ff9b9b', overflowWrap: 'anywhere' }}>{error}</div>}
      {!isLoading && !error && !libraryPath.trim() && (
        <div role="status" style={{ padding: 8, opacity: 0.75 }}>Choose a media library location in Settings to list its files.</div>
      )}
      {!isLoading && !error && libraryPath.trim() && filteredSongs.length === 0 && (
        <div role="status" style={{ padding: 8, opacity: 0.75 }}>
          {songs.length ? 'No matching files.' : 'No files found in this location.'}
        </div>
      )}
      <ul
        role="listbox"
        aria-label="Media library files"
        aria-multiselectable="true"
        title="Click to select. Ctrl-click or Shift-click to select multiple. Double-click to play."
        className="media-library-files"
        onScroll={event => updateVisibleWindow(event.currentTarget)}
        style={{ listStyle: 'none', padding: 0, margin: 0, minHeight: 0, overflowY: 'auto', display: virtualized ? 'block' : 'flex', flexDirection: 'column', gap: 8, position: virtualized ? 'relative' : undefined }}
      >
        {visibleSongs.map((song, visibleIndex) => {
          const index = virtualized ? visibleWindow.start + visibleIndex : visibleIndex;
          const musicPath = getMediaLibraryRolePath(song, 'music');
          const videoPath = getMediaLibraryRolePath(song, 'video');
          const bitrate = musicPath ? fileMetadata[musicPath]?.bitrate : undefined;
          const resolution = videoPath ? fileMetadata[videoPath]?.resolution : undefined;
          return (
            <li
              key={song.id}
              role="option"
              aria-selected={selectedSongIds.has(song.id)}
              aria-label={song.name}
              title={song.name}
              aria-posinset={index + 1}
              aria-setsize={filteredSongs.length}
              tabIndex={0}
              onClick={event => selectSong(index, event)}
              onDoubleClick={event => {
                if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                event.preventDefault();
                playSong(index);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  playSong(index);
                }
              }}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, height: TRACK_ROW_HEIGHT, padding: '8px 10px', borderRadius: 10, border: '1px solid transparent', background: 'rgba(255,255,255,0.04)', ...(virtualized ? { position: 'absolute' as const, top: index * TRACK_ROW_STRIDE, left: 0, right: 0 } : {}) }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, flex: 1, paddingTop: 2, gap: 2 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {song.name}
                </span>
                {song.relativeLocation && (
                  <span
                    className="media-library-path"
                    aria-label="Song location"
                    title={song.relativeLocation}
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem', lineHeight: 1.2 }}
                  >
                    {song.relativeLocation}
                  </span>
                )}
              </span>
              <span
                aria-label="Available media"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, flex: '0 0 auto', fontSize: '0.68rem', lineHeight: 1 }}
              >
                <span aria-label="Music, video, and karaoke availability" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {MEDIA_LIBRARY_ROLES.slice(0, 3).map(role => {
                    const details = MEDIA_ROLE_DETAILS[role];
                    const available = !!song.files[role]?.length;
                    return (
                      <span key={role} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {role === 'music' && Number.isFinite(bitrate) && (
                          <span className="media-library-meta" aria-label="Music bitrate" title="Music bitrate">
                            {Math.round(bitrate! / 1000)} kbps
                          </span>
                        )}
                        {role === 'video' && resolution && (
                          <span className="media-library-meta" aria-label="Video resolution" title="Video resolution">
                            {resolution}
                          </span>
                        )}
                        <span
                          className="media-library-role-indicator"
                          data-available={available}
                          aria-label={`${details.label} ${available ? 'available' : 'missing'}`}
                          title={`${details.label}: ${available ? 'available' : 'not available'}`}
                          role="img"
                          style={{ display: 'inline-flex', alignItems: 'center' }}
                        >
                          <MediaRoleIcon role={role} />
                        </span>
                      </span>
                    );
                  })}
                </span>
                <span aria-label="Accompaniment and vocals availability" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {MEDIA_LIBRARY_ROLES.slice(3).map(role => {
                    const details = MEDIA_ROLE_DETAILS[role];
                    const available = !!song.files[role]?.length;
                    return (
                      <span
                        key={role}
                        className="media-library-role-indicator"
                        data-available={available}
                        aria-label={`${details.label} ${available ? 'available' : 'missing'}`}
                        title={`${details.label}: ${available ? 'available' : 'not available'}`}
                        role="img"
                        style={{ display: 'inline-flex', alignItems: 'center' }}
                      >
                        <MediaRoleIcon role={role} />
                      </span>
                    );
                  })}
                </span>
              </span>
            </li>
          );
        })}
        {virtualized && (
          <li role="presentation" aria-hidden="true" style={{ position: 'relative', height: filteredSongs.length * TRACK_ROW_STRIDE, padding: 0, margin: 0, border: 0, visibility: 'hidden', pointerEvents: 'none' }} />
        )}
      </ul>
      {!isLoading && !error && songs.length > 0 && (
        <div aria-live="polite" style={{ padding: '4px 2px', fontSize: '0.7rem', opacity: 0.7 }}>
          {filteredSongs.length} of {songs.length} songs
        </div>
      )}
    </section>
  );
}
