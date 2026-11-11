import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ElectronKaraokeSubtitleLine } from '../../electron/electronApi';
import { hasElectronCapability } from '../../electron/electronApi';
import KaraokeSubtitleOverlay from '../playback/KaraokeSubtitleOverlay';
import { musicFileUrl } from '../playback/mediaSource';
import {
  formatKaraokeTime,
  formatKaraokeTimestamp,
  getKaraokeTimelineWindow,
  parseKaraokeTimestamp,
  updateKaraokeLineBoundary
} from './karaokeAlignerUtils';

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5] as const;
const TIMELINE_CHARACTER_WIDTH = 56;

function isHiddenTimelineCharacter(text: string) {
  return text !== '\n' && !text.trim();
}

export default function KaraokeAligner({
  mediaLibraryPath,
  initialVideoPath = '',
  onSubtitleSaved
}: {
  mediaLibraryPath: string;
  initialVideoPath?: string;
  onSubtitleSaved?: (subtitlePath: string) => void;
}) {
  const [videoPath, setVideoPath] = useState(initialVideoPath);
  const [subtitlePath, setSubtitlePath] = useState('');
  const [lines, setLines] = useState<ElectronKaraokeSubtitleLine[]>([]);
  const [savedLines, setSavedLines] = useState<ElectronKaraokeSubtitleLine[]>([]);
  const [selectedLineIndex, setSelectedLineIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [readyVideoPath, setReadyVideoPath] = useState('');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [timestampDrafts, setTimestampDrafts] = useState<Record<string, string>>({});
  const [dragFeedback, setDragFeedback] = useState<{
    lineIndex: number;
    boundaryIndex: number;
    direction: 'earlier' | 'later';
    time: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const requestId = useRef(0);
  const boundaryDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startTime: number;
    lineIndex: number;
    boundaryIndex: number;
    secondsPerPixel: number;
  } | null>(null);
  const isDirty = useMemo(() => JSON.stringify(lines) !== JSON.stringify(savedLines), [lines, savedLines]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!videoPath.trim() || !mediaLibraryPath.trim() || !/\.mp4$/i.test(videoPath.trim()) ||
        !hasElectronCapability(api, 'findKaraokeSubtitle')) {
      setSubtitlePath('');
      setLines([]);
      setSavedLines([]);
      setStatus(videoPath.trim() ? 'Choose an MP4 video and set the media library location.' : 'Choose an MP4 video to begin.');
      return;
    }

    const loadId = ++requestId.current;
    setIsLoading(true);
    setError('');
    setStatus('Searching for the matching Karaoke ASS subtitle...');
    void (async () => {
      try {
        const found = await api.findKaraokeSubtitle(videoPath.trim(), mediaLibraryPath.trim());
        if (loadId !== requestId.current) return;
        if (!found.ok) throw new Error(found.error);
        if (!found.path) {
          setSubtitlePath('');
          setLines([]);
          setSavedLines([]);
          setStatus('No matching ASS subtitle was found. Choose an ASS file to edit.');
          return;
        }
        await loadSubtitle(found.path, loadId);
      } catch (caught) {
        if (loadId === requestId.current) {
          setError(`Unable to find the matching subtitle: ${String(caught)}`);
          setStatus('');
        }
      } finally {
        if (loadId === requestId.current) setIsLoading(false);
      }
    })();
  }, [videoPath, mediaLibraryPath]);

  async function loadSubtitle(filePath: string, currentRequestId = ++requestId.current) {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'readKaraokeSubtitle')) {
      throw new Error('Karaoke subtitle reading is unavailable in this app window.');
    }
    setIsLoading(true);
    setError('');
    setStatus('Loading subtitle timings...');
    try {
      const result = await api.readKaraokeSubtitle(filePath);
      if (currentRequestId !== requestId.current) return;
      if (!result.ok) throw new Error(result.error);
      if (!result.lines.length) throw new Error('The subtitle contains no editable karaoke lines.');
      setSubtitlePath(filePath);
      setLines(result.lines);
      setSavedLines(result.lines);
      setSelectedLineIndex(0);
      setStatus(`Loaded ${result.lines.length} subtitle lines from ${filePath}.`);
    } finally {
      if (currentRequestId === requestId.current) setIsLoading(false);
    }
  }

  async function browseVideo() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseKaraokeVideo')) {
      setError('The MP4 video picker is unavailable.');
      return;
    }
    try {
      const result = await api.chooseKaraokeVideo();
      if (result.canceled) {
        if (result.error) setError(result.error);
        return;
      }
      const selectedPath = result.paths[0];
      if (!selectedPath) throw new Error('The video picker returned no file.');
      setVideoPath(selectedPath);
      setError('');
    } catch (caught) {
      setError(`Unable to choose an MP4 video: ${String(caught)}`);
    }
  }

  async function browseSubtitle() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseKaraokeSubtitle')) {
      setError('The ASS subtitle picker is unavailable.');
      return;
    }
    try {
      const result = await api.chooseKaraokeSubtitle();
      if (result.canceled) {
        if (result.error) setError(result.error);
        return;
      }
      const selectedPath = result.paths[0];
      if (!selectedPath) throw new Error('The ASS subtitle picker returned no file.');
      await loadSubtitle(selectedPath);
    } catch (caught) {
      setError(`Unable to load the selected ASS subtitle: ${String(caught)}`);
      setStatus('');
    }
  }

  function seek(time: number) {
    const boundedTime = Math.max(0, Math.min(duration || time, time));
    if (videoRef.current) videoRef.current.currentTime = boundedTime;
    setCurrentTime(boundedTime);
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      await video.play();
    } catch (caught) {
      setError(`Unable to play the selected MP4 video: ${String(caught)}`);
    }
  }

  function moveBoundary(lineIndex: number, boundaryIndex: number, time: number) {
    const updated = updateKaraokeLineBoundary(lines, lineIndex, boundaryIndex, time, duration);
    setLines(updated);
    const boundedTime = updated[lineIndex]
      ? getBoundaryTime(updated[lineIndex], boundaryIndex)
      : time;
    seek(boundedTime);
    setError('');
    setStatus('Unsaved timing changes.');
    return boundedTime;
  }

  function getBoundaryTime(line: ElectronKaraokeSubtitleLine, boundaryIndex: number) {
    return boundaryIndex === 0
      ? line.start
      : boundaryIndex === line.characters.length
        ? line.end
        : line.characters[boundaryIndex].start;
  }

  function updateTimestamp(lineIndex: number, boundaryIndex: number, value: string) {
    const key = `${lineIndex}:${boundaryIndex}`;
    setTimestampDrafts(current => ({ ...current, [key]: value }));
    const time = parseKaraokeTimestamp(value);
    if (time !== null) {
      const appliedTime = moveBoundary(lineIndex, boundaryIndex, time);
      setTimestampDrafts(current => ({ ...current, [key]: formatKaraokeTimestamp(appliedTime) }));
    }
  }

  function startBoundaryDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    lineIndex: number,
    boundaryIndex: number,
    time: number,
    secondsPerPixel: number
  ) {
    event.preventDefault();
    event.stopPropagation();
    boundaryDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startTime: time,
      lineIndex,
      boundaryIndex,
      secondsPerPixel
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragFeedback({ lineIndex, boundaryIndex, direction: 'later', time });
  }

  function updateBoundaryDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = boundaryDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const requestedTime = drag.startTime + (event.clientX - drag.startClientX) * drag.secondsPerPixel;
    const appliedTime = moveBoundary(drag.lineIndex, drag.boundaryIndex, requestedTime);
    const draftKey = `${drag.lineIndex}:${drag.boundaryIndex}`;
    setTimestampDrafts(current => {
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
    const direction = appliedTime < drag.startTime ? 'earlier' : 'later';
    setDragFeedback({
      lineIndex: drag.lineIndex,
      boundaryIndex: drag.boundaryIndex,
      direction,
      time: appliedTime
    });
  }

  function finishBoundaryDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (boundaryDragRef.current?.pointerId !== event.pointerId) return;
    boundaryDragRef.current = null;
    setDragFeedback(null);
  }

  async function jumpAndPlay(time: number) {
    if (!videoRef.current) return;
    seek(time);
    try {
      await videoRef.current.play();
    } catch (caught) {
      setError(`Unable to play the video from this timestamp: ${String(caught)}`);
    }
  }

  async function saveTo(filePath: string, sourcePath?: string) {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'saveKaraokeSubtitle')) throw new Error('Karaoke subtitle saving is unavailable.');
    setIsSaving(true);
    setError('');
    try {
      const result = sourcePath
        ? await api.saveKaraokeSubtitle(filePath, lines, sourcePath)
        : await api.saveKaraokeSubtitle(filePath, lines);
      if (!result.ok) throw new Error(result.error);
      setSubtitlePath(filePath);
      setSavedLines(lines);
      setStatus(`Saved Karaoke subtitle: ${filePath}`);
      onSubtitleSaved?.(filePath);
    } finally {
      setIsSaving(false);
    }
  }

  async function save() {
    if (!subtitlePath || !isDirty) return;
    try {
      await saveTo(subtitlePath);
    } catch (caught) {
      setError(`Unable to save the subtitle: ${String(caught)}`);
    }
  }

  async function saveAs() {
    const api = window.electronAPI;
    if (!subtitlePath || !hasElectronCapability(api, 'chooseKaraokeSubtitleSavePath')) {
      setError('Load a subtitle before saving a copy.');
      return;
    }
    try {
      const destination = await api.chooseKaraokeSubtitleSavePath(subtitlePath);
      if (!destination.ok) throw new Error(destination.error);
      if (!destination.path) return;
      await saveTo(destination.path, subtitlePath);
    } catch (caught) {
      setError(`Unable to save a copy of the subtitle: ${String(caught)}`);
    }
  }

  const canEdit = Boolean(subtitlePath && lines.length && !isLoading && !isSaving);

  return (
    <section className="karaoke-aligner" aria-label="Karaoke Aligner">
      <header className="karaoke-aligner-header">
        <div>
          <h1>Karaoke Aligner</h1>
          <p>Preview the video and fine-tune each character's karaoke timing.</p>
        </div>
        <div className="karaoke-aligner-actions">
          <button type="button" className="icon-btn" onClick={() => void save()} disabled={!canEdit || !isDirty}>
            Save
          </button>
          <button type="button" className="primary-btn" onClick={() => void saveAs()} disabled={!canEdit}>
            Save As...
          </button>
        </div>
      </header>

      <div className="karaoke-aligner-source">
        <label htmlFor="karaoke-aligner-video">Video</label>
        <input
          id="karaoke-aligner-video"
          aria-label="Video path"
          value={videoPath}
          disabled={isLoading || isSaving}
          onChange={event => {
            requestId.current++;
            setVideoPath(event.currentTarget.value);
          }}
          placeholder="Choose an MP4 video"
        />
        <button type="button" className="icon-btn" onClick={() => void browseVideo()} disabled={isLoading || isSaving}>
          Browse video...
        </button>
        <button type="button" className="icon-btn" onClick={() => void browseSubtitle()} disabled={isLoading || isSaving}>
          Choose ASS...
        </button>
      </div>

      <div className="karaoke-aligner-workspace">
        <section className="karaoke-aligner-preview" aria-label="Video preview">
          {videoPath.trim() && /\.mp4$/i.test(videoPath.trim()) ? (
            <div className="karaoke-aligner-video-frame">
              <video
                ref={videoRef}
                src={musicFileUrl(videoPath.trim())}
                crossOrigin="anonymous"
                playsInline
                preload="metadata"
                onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  setDuration(Number.isFinite(video.duration) ? video.duration : 0);
                  video.playbackRate = playbackRate;
                }}
                onCanPlay={() => setReadyVideoPath(videoPath.trim())}
                onEmptied={() => setReadyVideoPath('')}
                onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onError={event => {
                  setReadyVideoPath('');
                  const mediaError = event.currentTarget.error;
                  setError(
                    `Unable to load the selected MP4 video` +
                    (mediaError ? ` (media error ${mediaError.code}${mediaError.message ? `: ${mediaError.message}` : ''}).` : '.')
                  );
                }}
                aria-label="Karaoke alignment video"
              />
              <KaraokeSubtitleOverlay
                visible
                size="preview"
                currentTime={currentTime}
                lines={lines}
                videoElement={videoRef.current}
                isPlaying={isPlaying}
              />
            </div>
          ) : (
            <div className="karaoke-aligner-video-empty">Choose an MP4 video to preview.</div>
          )}
          <div className="karaoke-aligner-playback">
            <button
              type="button"
              className="icon-btn karaoke-aligner-play-toggle"
              onClick={() => void togglePlayback()}
              disabled={!videoPath.trim() || readyVideoPath !== videoPath.trim()}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              aria-pressed={isPlaying}
            >
              <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
            </button>
            <label>
              Speed
              <select
                aria-label="Playback speed"
                value={playbackRate}
                onChange={event => {
                  const rate = Number(event.currentTarget.value);
                  setPlaybackRate(rate);
                  if (videoRef.current) videoRef.current.playbackRate = rate;
                }}
              >
                {PLAYBACK_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
              </select>
            </label>
            <span className="karaoke-aligner-clock" aria-live="off">
              {formatKaraokeTime(currentTime)} / {formatKaraokeTime(duration)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.01}
            value={Math.min(currentTime, Math.max(duration, 0.1))}
            aria-label="Video playback position"
            onChange={event => seek(Number(event.currentTarget.value))}
          />
        </section>

        <section className="karaoke-aligner-editor" aria-label="Subtitle timing editor">
          <div className="karaoke-aligner-editor-heading">
            <h2>Subtitle lines</h2>
            <span>{subtitlePath || 'No subtitle loaded'}</span>
          </div>
          {!lines.length && (
            <p className="karaoke-aligner-empty">Choose a video to find its subtitle, or choose an ASS file to edit.</p>
          )}
          <div className="karaoke-aligner-lines">
            {lines.map((line, lineIndex) => {
              const window = getKaraokeTimelineWindow(line, duration);
              const boundaries = [line.start, ...line.characters.slice(1).map(character => character.start), line.end];
              let visibleCharacterCount = 0;
              const characterSlots = line.characters.map(character => {
                const slot = visibleCharacterCount;
                if (!isHiddenTimelineCharacter(character.text)) visibleCharacterCount++;
                return slot;
              });
              const timelineWidth = visibleCharacterCount * TIMELINE_CHARACTER_WIDTH;
              const getBoundaryPosition = (boundaryIndex: number) =>
                (boundaryIndex === line.characters.length ? visibleCharacterCount : characterSlots[boundaryIndex]) *
                TIMELINE_CHARACTER_WIDTH;
              const timestampRowEnds: number[] = [];
              const timestampLanes = new Array<number>(boundaries.length).fill(0);
              const visibleBoundaryIndices = boundaries
                .map((_, boundaryIndex) => boundaryIndex)
                .filter(boundaryIndex =>
                  boundaryIndex === 0 ||
                  boundaryIndex === line.characters.length ||
                  !isHiddenTimelineCharacter(line.characters[boundaryIndex].text)
                );
              for (const boundaryIndex of visibleBoundaryIndices) {
                const x = getBoundaryPosition(boundaryIndex);
                const labelLeft = boundaryIndex === 0
                  ? x
                  : boundaryIndex === boundaries.length - 1
                    ? x - 126
                    : x - 63;
                let lane = timestampRowEnds.findIndex(rowEnd => labelLeft >= rowEnd + 6);
                if (lane < 0) lane = timestampRowEnds.length;
                timestampRowEnds[lane] = labelLeft + 126;
                timestampLanes[boundaryIndex] = lane;
              }
              const rangeTop = timestampRowEnds.length * 24 + 3;
              const characterTop = rangeTop + 27;
              const timelineHeight = characterTop + 26;
              const lineSeconds = Math.max(1, line.end - line.start);
              const secondsPerPixel = lineSeconds / Math.max(timelineWidth, 1);
              return (
                <article
                  className={`karaoke-aligner-line${selectedLineIndex === lineIndex ? ' selected' : ''}`}
                  key={`${lineIndex}:${line.start}:${line.text}`}
                  aria-label={`Subtitle line ${lineIndex + 1}`}
                  onClick={() => {
                    setSelectedLineIndex(lineIndex);
                    seek(line.start);
                  }}
                >
                  <div className="karaoke-aligner-line-heading">
                    <span>Line {lineIndex + 1}</span>
                    <span>{formatKaraokeTime(line.start)} – {formatKaraokeTime(line.end)}</span>
                  </div>
                  <div className="karaoke-aligner-timeline-scroll">
                  <div
                    className="karaoke-aligner-timeline"
                    aria-label={`Timing handles for line ${lineIndex + 1}`}
                    style={{ width: `${timelineWidth}px`, height: `${timelineHeight}px` }}
                    onPointerUp={() => setDragFeedback(null)}
                    onPointerCancel={() => setDragFeedback(null)}
                  >
                    {line.characters.map((character, characterIndex) => {
                      if (isHiddenTimelineCharacter(character.text)) return null;
                      return (
                        <span
                          key={`text-${characterIndex}:${character.start}`}
                          className="karaoke-aligner-timeline-character"
                          style={{
                            left: `${characterSlots[characterIndex] * TIMELINE_CHARACTER_WIDTH}px`,
                            top: `${characterTop}px`,
                            width: `${TIMELINE_CHARACTER_WIDTH}px`
                          }}
                        >
                          {character.text === '\n' ? '↵' : character.text}
                        </span>
                      );
                    })}
                    {boundaries.map((time, boundaryIndex) => {
                      if (
                        boundaryIndex > 0 &&
                        boundaryIndex < line.characters.length &&
                        isHiddenTimelineCharacter(line.characters[boundaryIndex].text)
                      ) return null;
                      const characterIndex = boundaryIndex === line.characters.length
                        ? line.characters.length - 1
                        : boundaryIndex;
                      const edge = boundaryIndex === line.characters.length ? 'end' : 'start';
                      const character = line.characters[Math.max(0, characterIndex)];
                      const label = boundaryIndex === 0
                        ? `Line ${lineIndex + 1}, first character start`
                        : boundaryIndex === line.characters.length
                          ? `Line ${lineIndex + 1}, last character end`
                          : `Line ${lineIndex + 1}, ${character.text} ${edge}, previous character end`;
                      const draftKey = `${lineIndex}:${boundaryIndex}`;
                      return (
                        <div
                          key={boundaryIndex}
                          className={`karaoke-aligner-boundary${dragFeedback?.lineIndex === lineIndex && dragFeedback.boundaryIndex === boundaryIndex ? ' dragging' : ''}`}
                          style={{
                            left: `${getBoundaryPosition(boundaryIndex)}px`,
                            zIndex: boundaryIndex + 1
                          }}
                        >
                          <input
                            className="karaoke-aligner-timestamp"
                            type="text"
                            inputMode="decimal"
                            aria-label={`${label} timestamp`}
                            value={timestampDrafts[draftKey] ?? formatKaraokeTimestamp(time)}
                            disabled={!canEdit}
                            style={{
                              top: `${timestampLanes[boundaryIndex] * 24}px`,
                              transform: boundaryIndex === 0
                                ? 'translateX(0)'
                                : boundaryIndex === line.characters.length
                                  ? 'translateX(-100%)'
                                  : 'translateX(-50%)'
                            }}
                            onClick={event => event.stopPropagation()}
                            onChange={event => updateTimestamp(lineIndex, boundaryIndex, event.currentTarget.value)}
                            onBlur={() => {
                              setTimestampDrafts(current => {
                                const next = { ...current };
                                delete next[draftKey];
                                return next;
                              });
                            }}
                            onKeyDown={event => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                            }}
                          />
                          <button
                            type="button"
                            role="slider"
                            className="karaoke-aligner-handle"
                            aria-label={label}
                            aria-valuemin={boundaryIndex === 0 ? 0 : boundaries[boundaryIndex - 1]}
                            aria-valuemax={boundaryIndex === line.characters.length
                              ? Math.min(duration || window.maximum, lines[lineIndex + 1]?.start ?? (duration || window.maximum))
                              : boundaries[boundaryIndex + 1]}
                            aria-valuenow={time}
                            aria-valuetext={formatKaraokeTimestamp(time)}
                            disabled={!canEdit}
                            onPointerDown={event => startBoundaryDrag(
                              event,
                              lineIndex,
                              boundaryIndex,
                              time,
                              secondsPerPixel
                            )}
                            onPointerMove={updateBoundaryDrag}
                            onPointerUp={finishBoundaryDrag}
                            onPointerCancel={finishBoundaryDrag}
                            onLostPointerCapture={finishBoundaryDrag}
                            style={{
                              top: `${rangeTop}px`
                            }}
                            onClick={event => event.stopPropagation()}
                            onDoubleClick={event => {
                              event.stopPropagation();
                              void jumpAndPlay(time);
                            }}
                            onKeyDown={event => {
                              const step = event.shiftKey ? 0.1 : 0.01;
                              const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                                ? -step
                                : event.key === 'ArrowRight' || event.key === 'ArrowUp'
                                  ? step
                                  : 0;
                              if (delta) {
                                event.preventDefault();
                                moveBoundary(lineIndex, boundaryIndex, time + delta);
                              }
                            }}
                          >
                            <span aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                    <span className="karaoke-aligner-playhead" style={{
                      left: `${Math.max(0, Math.min(timelineWidth, (currentTime - line.start) / lineSeconds * timelineWidth))}px`
                    }} />
                    {dragFeedback?.lineIndex === lineIndex && (
                      <span
                        className={`karaoke-aligner-drag-feedback ${dragFeedback.direction}`}
                        style={{
                          left: `${getBoundaryPosition(dragFeedback.boundaryIndex)}px`,
                          top: `${rangeTop}px`
                        }}
                        aria-hidden="true"
                      >
                        {dragFeedback.direction === 'earlier' ? '←' : '→'} {formatKaraokeTimestamp(dragFeedback.time)}
                      </span>
                    )}
                  </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
      {error && <p role="alert" className="karaoke-aligner-error">{error}</p>}
      {status && <p role="status" aria-live="polite" className="karaoke-aligner-status">{status}</p>}
    </section>
  );
}
