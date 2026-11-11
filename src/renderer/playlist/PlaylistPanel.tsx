import React from 'react';
import type { ChangeEvent, DragEvent, Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Playlist, Track } from '../types';
import type { MediaLibraryRole } from './mediaLibraryUtils';
import { getTrackCoverCacheKey } from '../cover/coverUtils';
import { PlaylistTrackCover } from '../cover/CoverDisplay';
import { activatePlaylistTrackImmediately } from './playlistSelection';
import MediaLibraryPanel from './MediaLibraryPanel';
import {
  getTrackFilePath,
  TRACK_LIST_VIRTUALIZATION_THRESHOLD,
  TRACK_ROW_HEIGHT,
  TRACK_ROW_STRIDE
} from './playlistUtils';

export const PLAYLIST_TOOLS = ['Media Downloader', 'Karaoke Creator', 'Karaoke Aligner', 'Vocal Splitter'] as const;
export type PlaylistTool = typeof PLAYLIST_TOOLS[number];
export type PlaylistPanelMode = 'playlist' | 'library' | 'tools';

type PlaylistPanelProps = {
  panelMode: PlaylistPanelMode;
  onPanelModeChange: (mode: PlaylistPanelMode) => void;
  selectedTool: PlaylistTool | null;
  onSelectTool: (tool: PlaylistTool) => void;
  tracks: Track[];
  playlists: Playlist[];
  playlistsRef: MutableRefObject<Playlist[]>;
  selectedPlaylistName: string | null;
  playlistNameDraft: string;
  setPlaylistNameDraft: Dispatch<SetStateAction<string>>;
  isPlaylistOptionsOpen: boolean;
  setIsPlaylistOptionsOpen: Dispatch<SetStateAction<boolean>>;
  isPlaylistOperationPending: boolean;
  runPlaylistOperation: (operation: () => Promise<void>) => void;
  createPlaylist: () => Promise<void>;
  savePlaylist: () => Promise<void>;
  deletePlaylist: () => Promise<void>;
  selectPlaylist: (playlist: Playlist) => void;
  addFilesInputRef: MutableRefObject<HTMLInputElement | null>;
  addFolderInputRef: MutableRefObject<HTMLInputElement | null>;
  onAddFilesClick: () => void;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onFolder: (event?: ChangeEvent<HTMLInputElement>) => void;
  onAddFolder: () => void;
  selectedTrackIds: Set<string>;
  deleteSelectedTracks: () => Promise<void>;
  onSettingsClick: () => void;
  mediaLibraryPath: string;
  mediaLibraryRefreshKey: number;
  onAddLibraryFiles: (filePaths: string[]) => void;
  onPlayLibraryFile: (filePath: string, role: MediaLibraryRole) => void;
  isDragging: boolean;
  handleDrop: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragEnter: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  trackListRef: MutableRefObject<HTMLUListElement | null>;
  updateTrackVirtualWindow: (list: HTMLUListElement) => void;
  trackVirtualWindow: { start: number; end: number };
  draggedTrackIndex: number | null;
  draggedTrackIndexRef: MutableRefObject<number | null>;
  dropInsertionIndex: number | null;
  setDraggedTrackIndex: Dispatch<SetStateAction<number | null>>;
  setDropInsertionIndex: Dispatch<SetStateAction<number | null>>;
  getTrackInsertionIndex: (list: HTMLUListElement, clientY: number) => number;
  moveTrack: (fromIndex: number, toIndex: number) => void;
  finishTrackReorder: () => void;
  selectPlaylistTrack: (index: number) => void;
  handlePlaylistTrackClick: (index: number, event: React.MouseEvent<HTMLLIElement>) => void;
  trackPreviewTimerRef: MutableRefObject<number | null>;
  playIndex: (index: number) => Promise<void>;
  showCover: boolean;
  trackCoverCache: Map<string, string>;
  isVideoTrack: (track: Track | null | undefined) => boolean;
};

export default function PlaylistPanel({
  panelMode,
  onPanelModeChange,
  selectedTool,
  onSelectTool,
  tracks,
  playlists,
  playlistsRef,
  selectedPlaylistName,
  playlistNameDraft,
  setPlaylistNameDraft,
  isPlaylistOptionsOpen,
  setIsPlaylistOptionsOpen,
  isPlaylistOperationPending,
  runPlaylistOperation,
  createPlaylist,
  savePlaylist,
  deletePlaylist,
  selectPlaylist,
  addFilesInputRef,
  addFolderInputRef,
  onAddFilesClick,
  onFiles,
  onFolder,
  onAddFolder,
  selectedTrackIds,
  deleteSelectedTracks,
  onSettingsClick,
  mediaLibraryPath,
  mediaLibraryRefreshKey,
  onAddLibraryFiles,
  onPlayLibraryFile,
  isDragging,
  handleDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  trackListRef,
  updateTrackVirtualWindow,
  trackVirtualWindow,
  draggedTrackIndex,
  draggedTrackIndexRef,
  dropInsertionIndex,
  setDraggedTrackIndex,
  setDropInsertionIndex,
  getTrackInsertionIndex,
  moveTrack,
  finishTrackReorder,
  selectPlaylistTrack,
  handlePlaylistTrackClick,
  trackPreviewTimerRef,
  playIndex,
  showCover,
  trackCoverCache,
  isVideoTrack
}: PlaylistPanelProps) {
  const playlistOptions = playlists.filter(playlist => playlist.name !== selectedPlaylistName);
  const virtualized = tracks.length > TRACK_LIST_VIRTUALIZATION_THRESHOLD;
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [sidebarWidth, setSidebarWidth] = React.useState<number | null>(null);
  const [isResizing, setIsResizing] = React.useState(false);
  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const lastExpandedWidthRef = React.useRef<number | null>(null);
  const [isVerticalLayout, setIsVerticalLayout] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  );

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const updateLayout = () => setIsVerticalLayout(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  const getSidebarSizeLimits = () => {
    const container = sidebarRef.current?.parentElement;
    if (!container) return null;
    const style = window.getComputedStyle(container);
    const vertical = style.flexDirection === 'column';
    const availableSize = vertical
      ? container.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0)
      : container.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const minimumSize = vertical ? 120 : 300;
    const maxSize = vertical
      ? Math.max(120, Math.min(220, availableSize - 360))
      : Math.max(minimumSize, availableSize - 320);
    return { availableSize, maxSize, minimumSize, vertical };
  };

  const resizeSidebar = (clientX: number, clientY: number) => {
    const sidebar = sidebarRef.current;
    const container = sidebar?.parentElement;
    const limits = getSidebarSizeLimits();
    if (!sidebar || !container || !limits) return;
    const containerStyle = window.getComputedStyle(container);
    const bounds = container.getBoundingClientRect();
    const startPadding = Number.parseFloat(limits.vertical ? containerStyle.paddingTop : containerStyle.paddingLeft) || 0;
    const requestedSize = limits.vertical
      ? clientY - bounds.top - startPadding
      : clientX - bounds.left - startPadding;
    if (requestedSize < 48) {
      setSidebarWidth(0);
      setIsCollapsed(true);
      return;
    }
    const size = Math.min(limits.maxSize, Math.max(limits.minimumSize, requestedSize));
    lastExpandedWidthRef.current = size;
    setSidebarWidth(size);
    setIsCollapsed(false);
  };

  const toggleSidebarCollapsed = () => {
    if (!isCollapsed) {
      const currentSize = isVerticalLayout
        ? sidebarRef.current?.getBoundingClientRect().height
        : sidebarRef.current?.getBoundingClientRect().width;
      if (currentSize && currentSize > 0) lastExpandedWidthRef.current = currentSize;
      else if (sidebarWidth && sidebarWidth > 0) lastExpandedWidthRef.current = sidebarWidth;
      setSidebarWidth(0);
      setIsCollapsed(true);
      return;
    }
    const limits = getSidebarSizeLimits();
    const width = Math.min(
      limits?.maxSize ?? Number.POSITIVE_INFINITY,
      lastExpandedWidthRef.current ?? Math.max(limits?.minimumSize ?? 300, (limits?.availableSize ?? 1000) * (limits?.vertical ? 0.24 : 0.2))
    );
    setSidebarWidth(width);
    setIsCollapsed(false);
  };
  const sidebarResizeLimits = getSidebarSizeLimits();

  return (
    <aside
      ref={sidebarRef}
      className={`playlists${isDragging ? ' drop-active' : ''}${isCollapsed ? ' is-collapsed' : ''}${isResizing ? ' is-resizing' : ''}`}
      role="navigation"
      aria-label={panelMode === 'playlist' ? 'Playlists' : panelMode === 'library' ? 'Media library' : 'Tools'}
      style={{ width: isVerticalLayout ? '100%' : isCollapsed ? 0 : sidebarWidth ?? '20%', height: isVerticalLayout && !isCollapsed ? sidebarWidth ?? '24%' : undefined, minWidth: isVerticalLayout || isCollapsed ? 0 : 300, marginRight: isCollapsed && !isVerticalLayout ? -20 : 0, marginBottom: isCollapsed && isVerticalLayout ? -20 : 0, fontSize: '0.85rem', background: 'rgba(17,18,23,0.92)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 24, boxShadow: '0 18px 40px rgba(0,0,0,0.32)', color: '#eef2ff', padding: isCollapsed ? 0 : '18px 18px 8px', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', flex: `0 0 ${isCollapsed ? 0 : sidebarWidth ?? (isVerticalLayout ? '24%' : '20%')}`, minHeight: 0, maxHeight: isVerticalLayout ? 220 : 'calc(100vh - 36px)', transition: isResizing ? 'none' : 'width 180ms ease, height 180ms ease, flex-basis 180ms ease, padding 180ms ease' }}
      onDropCapture={handleDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      <div
        className="playlist-resize-handle"
        role={isCollapsed ? 'button' : 'separator'}
        aria-orientation={isCollapsed ? undefined : isVerticalLayout ? 'horizontal' : 'vertical'}
        aria-label={isCollapsed ? 'Reopen playlist' : 'Resize or collapse playlist'}
        aria-expanded={!isCollapsed}
        aria-valuemin={isCollapsed ? undefined : 0}
        aria-valuemax={isCollapsed ? undefined : sidebarResizeLimits?.maxSize ?? 1000}
        aria-valuenow={isCollapsed ? undefined : sidebarWidth ?? Math.round((sidebarResizeLimits?.availableSize ?? 1000) * (isVerticalLayout ? 0.24 : 0.2))}
        tabIndex={0}
        title={isCollapsed ? 'Reopen playlist' : 'Drag to resize; double-click to collapse'}
        onClick={() => {
          if (isCollapsed) toggleSidebarCollapsed();
        }}
        onPointerDown={event => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsResizing(true);
        }}
        onPointerMove={event => {
          if (event.buttons === 1) resizeSidebar(event.clientX, event.clientY);
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setIsResizing(false);
        }}
        onPointerCancel={() => setIsResizing(false)}
        onDoubleClick={toggleSidebarCollapsed}
        onKeyDown={event => {
          if (event.key === 'Home') {
            event.preventDefault();
            setSidebarWidth(0);
            setIsCollapsed(true);
          } else if (event.key === 'End') {
            event.preventDefault();
            const limits = getSidebarSizeLimits();
            const maxSize = limits?.maxSize ?? 1000;
            lastExpandedWidthRef.current = maxSize;
            setSidebarWidth(maxSize);
            setIsCollapsed(false);
          } else if (
            (isVerticalLayout && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) ||
            (!isVerticalLayout && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
          ) {
            event.preventDefault();
            const limits = getSidebarSizeLimits();
            const isDecreasing = isVerticalLayout ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
            const minimumSize = limits?.minimumSize ?? (isVerticalLayout ? 120 : 300);
            if (isDecreasing && !isCollapsed && (sidebarWidth ?? 240) <= minimumSize + 16) {
              setSidebarWidth(0);
              setIsCollapsed(true);
            } else {
              const currentSize = isCollapsed ? lastExpandedWidthRef.current ?? 240 : sidebarWidth ?? 240;
              const nextSize = Math.min(limits?.maxSize ?? 1000, Math.max(minimumSize, currentSize + (isDecreasing ? -24 : 24)));
              lastExpandedWidthRef.current = nextSize;
              setSidebarWidth(nextSize);
              setIsCollapsed(false);
            }
          }
        }}
      >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            {isCollapsed ? (
              <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M9 5v14M15 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
      </div>
      {!isCollapsed && <>
      <div role="group" aria-label="Playlist and media library" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          className="icon-btn"
          aria-label="Playlist"
          title="Playlist"
          aria-pressed={panelMode === 'playlist'}
          onClick={() => onPanelModeChange('playlist')}
          style={{ width: 36, height: 36, background: panelMode === 'playlist' ? 'rgba(141,217,193,0.2)' : 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5h16M4 10h16M4 15h11M4 20h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M18 15v6m-3-3h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Media library"
          title="Media library"
          aria-pressed={panelMode === 'library'}
          onClick={() => onPanelModeChange('library')}
          style={{ width: 36, height: 36, background: panelMode === 'library' ? 'rgba(141,217,193,0.2)' : 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M9 10v6m0 0 5-3-5-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Tools"
          title="Tools"
          aria-pressed={panelMode === 'tools'}
          onClick={() => onPanelModeChange('tools')}
          style={{ width: 36, height: 36, background: panelMode === 'tools' ? 'rgba(141,217,193,0.2)' : 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m14.7 6.3 3-3a5 5 0 0 1-6.4 6.4l-7.7 7.7a2.1 2.1 0 0 0 3 3l7.7-7.7a5 5 0 0 1 6.4-6.4l-3 3-3-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
          onClick={onSettingsClick}
          style={{ width: 36, height: 36, marginLeft: 'auto', background: 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 6h5m4 0h9M3 12h9m4 0h5M3 18h2m4 0h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="10" cy="6" r="2" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="14" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="7" cy="18" r="2" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
      </div>
      {panelMode === 'playlist' ? <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 110 }}>
            <input
              type="text"
              value={playlistNameDraft}
              disabled={isPlaylistOperationPending}
              onFocus={() => setIsPlaylistOptionsOpen(true)}
              onBlur={() => setIsPlaylistOptionsOpen(false)}
              onChange={event => {
                const value = event.currentTarget.value;
                setPlaylistNameDraft(value);
                const match = playlistsRef.current.find(playlist => playlist.name === value);
                if (match && match.name !== selectedPlaylistName) selectPlaylist(match);
              }}
              aria-label="Playlist name"
              aria-haspopup="listbox"
              aria-expanded={isPlaylistOptionsOpen}
              aria-controls="playlist-name-options"
              title="Choose a playlist from the list or type a name, then save"
              placeholder="Playlist name"
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#f5f7fb', borderRadius: 10, padding: '8px 36px 8px 12px', minWidth: 0 }}
            />
            <button
              type="button"
              className="icon-btn"
              disabled={isPlaylistOperationPending}
              aria-label={isPlaylistOptionsOpen ? 'Close playlist list' : 'Open playlist list'}
              aria-expanded={isPlaylistOptionsOpen}
              aria-controls="playlist-name-options"
              title={isPlaylistOptionsOpen ? 'Close playlist list' : 'Open playlist list'}
              onMouseDown={event => event.preventDefault()}
              onClick={() => setIsPlaylistOptionsOpen(open => !open)}
              style={{ position: 'absolute', top: 0, right: 0, width: 32, height: '100%', minHeight: 0, minWidth: 0, padding: 0, margin: 0, border: 0, borderRadius: '0 9px 9px 0', color: '#f5f7fb', background: 'transparent', boxShadow: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: isPlaylistOptionsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {isPlaylistOptionsOpen && (
              <div
                id="playlist-name-options"
                role="listbox"
                aria-label="Saved playlists"
                style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 20, maxHeight: 220, overflowY: 'auto', padding: 4, background: '#202127', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, boxShadow: '0 12px 28px rgba(0,0,0,0.45)' }}
              >
                {playlistOptions.length ? playlistOptions.map(playlist => (
                  <button
                    key={playlist.name}
                    type="button"
                    role="option"
                    aria-selected={playlist.name === selectedPlaylistName}
                    disabled={isPlaylistOperationPending}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectPlaylist(playlist)}
                    style={{ display: 'block', width: '100%', padding: '8px 10px', border: 0, borderRadius: 6, color: '#f5f7fb', background: playlist.name === selectedPlaylistName ? 'rgba(255,156,75,0.2)' : 'transparent', textAlign: 'left', cursor: 'pointer' }}
                  >
                    {playlist.name}
                  </button>
                )) : (
                  <div role="option" aria-disabled="true" style={{ padding: '8px 10px', color: 'rgba(245,247,251,0.55)' }}>
                    No other playlists
                  </div>
                )}
              </div>
            )}
          </div>
          <button className="icon-btn" disabled={isPlaylistOperationPending} style={{ marginLeft: 0, background: 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }} onClick={() => runPlaylistOperation(createPlaylist)} aria-label="New playlist" title="New playlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5h11M4 10h11M4 15h7M17 14v7m-3.5-3.5h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="icon-btn" disabled={isPlaylistOperationPending} style={{ marginLeft: 0, background: 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }} onClick={() => runPlaylistOperation(savePlaylist)} aria-label="Save playlist" title="Save playlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zM12 17a3 3 0 110-6 3 3 0 010 6zm5-9H7V5h10v3z" fill="currentColor"/></svg>
          </button>
          <button className="icon-btn" disabled={isPlaylistOperationPending} style={{ marginLeft: 0, background: 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }} onClick={() => runPlaylistOperation(deletePlaylist)} aria-label="Delete playlist" title="Delete playlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <input ref={addFilesInputRef} id="addFilesInput" type="file" accept=".mp3,.flac,.mp4" multiple style={{ display: 'none' }} onChange={onFiles} />
            <input ref={addFolderInputRef} id="addFolderInput" type="file" accept=".mp3,.flac,.mp4" {...({ webkitdirectory: 'true' } as React.InputHTMLAttributes<HTMLInputElement>)} style={{ display: 'none' }} onChange={onFolder} />
            <button className="icon-btn" onClick={onAddFilesClick} aria-label="Add files" title="Add files" style={{ background: 'linear-gradient(135deg, #ff9c4b, #ff6b6b)', color: '#fff', border: 'none', boxShadow: '0 12px 28px rgba(255, 118, 66, 0.35)' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M13 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V10l-7-7zM13 3v7h7M12 14v5m-2.5-2.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button className="icon-btn" style={{ marginLeft: 0, background: 'rgba(255,255,255,0.06)', color: '#f5f7fb', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' }} onClick={onAddFolder} aria-label="Add folder" title="Add folder">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2zM12 12v4h-2v-4H8l4-4 4 4h-2z" fill="currentColor"/></svg>
            </button>
            <button
              className="icon-btn playlist-delete-items"
              onClick={() => void deleteSelectedTracks()}
              disabled={selectedTrackIds.size === 0}
              aria-label={`Delete ${selectedTrackIds.size} selected playlist item${selectedTrackIds.size === 1 ? '' : 's'}`}
              title={selectedTrackIds.size ? `Remove ${selectedTrackIds.size} selected item${selectedTrackIds.size === 1 ? '' : 's'}` : 'Select playlist items to remove'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M6 7h12l-1 14H7L6 7zM9 7V4h6v3M4 7h16M10 11v6m4-6v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {selectedTrackIds.size > 1 && <span className="playlist-selection-count">{selectedTrackIds.size} selected</span>}
          </div>
        </div>
      </div>
      <div className="playlist-selection-hint">Ctrl-click or Shift-click to select multiple items</div>
      {isDragging && <div className="drop-overlay">Drop files or folder here</div>}
      <div className="drop-zone" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 18, border: '1px solid rgba(255,255,255,0.04)', padding: 8, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {isDragging && <div className="drop-overlay">Drop files or folder here</div>}
        <ul
          ref={trackListRef}
          role="listbox"
          aria-label="Tracks"
          aria-multiselectable="true"
          title="Double-click to play. Ctrl-click or Shift-click to select multiple items for removal."
          className="track-list"
          onScroll={event => updateTrackVirtualWindow(event.currentTarget)}
          style={virtualized ? { display: 'block', position: 'relative' } : undefined}
          onDragOver={event => {
            if (draggedTrackIndexRef.current === null) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setDropInsertionIndex(getTrackInsertionIndex(event.currentTarget, event.clientY));
          }}
          onDrop={event => {
            if (draggedTrackIndexRef.current === null) return;
            event.preventDefault();
            event.stopPropagation();
            const fromIndex = draggedTrackIndexRef.current;
            const insertionIndex = getTrackInsertionIndex(event.currentTarget, event.clientY);
            moveTrack(fromIndex, insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex);
            finishTrackReorder();
          }}
        >
          {tracks.slice(virtualized ? trackVirtualWindow.start : 0, virtualized ? trackVirtualWindow.end : tracks.length)
            .map((track, visibleIndex) => {
              const index = (virtualized ? trackVirtualWindow.start : 0) + visibleIndex;
              const cover = track.cover || trackCoverCache.get(getTrackCoverCacheKey(track));
              const trackPath = getTrackFilePath(track) || track.file?.webkitRelativePath;
              return (
                <li
                  key={index}
                  role="option"
                  aria-selected={selectedTrackIds.has(track.id)}
                  data-selected={selectedTrackIds.has(track.id)}
                  aria-posinset={index + 1}
                  aria-setsize={tracks.length}
                  tabIndex={0}
                  data-track-index={index}
                  draggable={tracks.length > 1}
                  className={`${draggedTrackIndex === index ? 'track-dragging ' : ''}${dropInsertionIndex === index ? 'track-drop-before' : ''}${dropInsertionIndex === tracks.length && index === tracks.length - 1 ? ' track-drop-end' : ''}`.trim()}
                  style={virtualized ? { position: 'absolute', top: index * TRACK_ROW_STRIDE, left: 0, right: 0, width: 'auto', height: TRACK_ROW_HEIGHT, flex: 'none' } : undefined}
                  title={`${track.name}${trackPath ? ` — ${trackPath}` : ''}`}
                  onDragStart={event => {
                    event.stopPropagation();
                    draggedTrackIndexRef.current = index;
                    setDraggedTrackIndex(index);
                    setDropInsertionIndex(null);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-mintplayer-track', String(index));
                  }}
                  onDragEnd={finishTrackReorder}
                  onKeyDown={event => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      selectPlaylistTrack(index);
                      void playIndex(index);
                    }
                  }}
                  onClick={event => handlePlaylistTrackClick(index, event)}
                  onDoubleClick={event => {
                    activatePlaylistTrackImmediately(index, event, trackPreviewTimerRef, selectPlaylistTrack, playIndex);
                  }}
                >
                  <PlaylistTrackCover visible={showCover} src={cover} />
                  <span className="track-info">
                    <span className="track-name">
                      <span className="track-title">{String(index + 1).padStart(2, '0')} {track.name.replace(/\.[^.]+$/, '')}</span>
                      {isVideoTrack(track)
                        ? track.resolution && <span className="track-meta">{track.resolution}</span>
                        : Number.isFinite(track.bitrate) && <span className="track-meta">{Math.round(track.bitrate! / 1000)} kbps</span>}
                    </span>
                    {trackPath && <span className="track-path" title={trackPath}>{trackPath}</span>}
                  </span>
                </li>
              );
            })}
          {virtualized && (
            <li role="presentation" aria-hidden="true" style={{ position: 'relative', height: tracks.length * TRACK_ROW_STRIDE, padding: 0, margin: 0, border: 0, visibility: 'hidden', pointerEvents: 'none' }} />
          )}
        </ul>
      </div>
      </> : panelMode === 'library' ? (
        <MediaLibraryPanel
          libraryPath={mediaLibraryPath}
          refreshKey={mediaLibraryRefreshKey}
          onAddToPlaylist={onAddLibraryFiles}
          onPlayFile={onPlayLibraryFile}
        />
      ) : (
        <section aria-label="Tools" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Tools</h2>
          <ul
            role="listbox"
            aria-label="Available tools"
            style={{ listStyle: 'none', padding: 0, margin: 0, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {PLAYLIST_TOOLS.map(tool => (
              <li key={tool} role="option" aria-selected={selectedTool === tool}>
                <button
                  type="button"
                  aria-label={tool}
                  aria-pressed={selectedTool === tool}
                  onClick={() => onSelectTool(tool)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', padding: '10px 12px', borderRadius: 10, textAlign: 'left', background: selectedTool === tool ? 'rgba(141,217,193,0.16)' : 'rgba(255,255,255,0.04)' }}
                >
                  <span>{tool}</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                    {tool === 'Vocal Splitter' ? (
                      <path d="M4 10v4m4-8v12m4-9v6m4-11v16m4-12v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    ) : tool === 'Karaoke Aligner' ? (
                      <path d="M10 5 3 12l7 7M14 5l7 7-7 7M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    ) : tool === 'Media Downloader' ? (
                      <>
                        <path d="M12 3v11m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </>
                    ) : (
                      <path d="M4 5h16v14H4zM7 9h5m-5 3h10m-10 3h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      </>}
    </aside>
  );
}
