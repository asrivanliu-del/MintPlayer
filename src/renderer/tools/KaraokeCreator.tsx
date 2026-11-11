import { useEffect, useRef, useState } from 'react';
import { hasElectronCapability } from '../../electron/electronApi';
import type { ElectronOnlineLyricsResult } from '../../electron/electronApi';
import {
  getKaraokeLyricsSearchHints,
  getMatchingMusicBasePath,
  parseLrc,
  type TimedLyricLine
} from './karaokeLyrics';

export default function KaraokeCreator({
  mediaLibraryPath,
  initialMediaPath = '',
  initialLyrics = '',
  onComplete,
  onStemsCreated
}: {
  mediaLibraryPath: string;
  initialMediaPath?: string;
  initialLyrics?: string;
  onComplete: (subtitlePath: string) => void;
  onStemsCreated: (paths: string[]) => void;
}) {
  const [mediaPath, setMediaPath] = useState(initialMediaPath);
  const [lyrics, setLyrics] = useState(initialLyrics);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [lrcEnabled, setLrcEnabled] = useState(false);
  const [timedLyrics, setTimedLyrics] = useState<TimedLyricLine[] | null>(null);
  const [lrcSource, setLrcSource] = useState('');
  const [selectedLrcPath, setSelectedLrcPath] = useState('');
  const [lrcSearchResults, setLrcSearchResults] = useState<ElectronOnlineLyricsResult[]>([]);
  const [isSearchingLyrics, setIsSearchingLyrics] = useState(false);
  const lrcRequestId = useRef(0);

  function setSelectedMediaPath(selectedPath: string) {
    lrcRequestId.current++;
    setMediaPath(selectedPath);
    setLrcEnabled(false);
    setTimedLyrics(null);
    setLrcSource('');
    setSelectedLrcPath('');
    setLrcSearchResults([]);
    setError('');
    setStatus('');
  }

  useEffect(() => {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'onKaraokeAlignmentProgress')) return;
    return api.onKaraokeAlignmentProgress(({ message }) => {
      setStatus(message);
      setError('');
    });
  }, []);

  async function browseSource() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseKaraokeSource')) {
      setError('The music and video file picker is unavailable.');
      return;
    }

    try {
      const result = await api.chooseKaraokeSource();
      if (result.canceled) {
        if (result.error) setError(result.error);
        return;
      }
      const selectedPath = result.paths[0];
      if (!selectedPath) throw new Error('The music and video picker returned no file.');
      setSelectedMediaPath(selectedPath);
    } catch (caught) {
      setError(`Unable to choose a music or video file: ${String(caught)}`);
    }
  }

  function applyTimedLines(parsed: TimedLyricLine[], source: string) {
    if (!parsed.length) throw new Error('No usable timestamped LRC lines were found in this source.');
    if (parsed.length > 5000 || parsed.some(line => line.text.length > 5000)) {
      throw new Error('LRC lyrics exceed the Karaoke Creator alignment limits.');
    }
    setTimedLyrics(parsed);
    setLyrics(parsed.map(line => line.text).join('\n'));
    setLrcSource(source);
    setLrcSearchResults([]);
    setError('');
    setStatus(`Using timed lyrics from ${source}.`);
  }

  function applyLrc(contents: string, source: string) {
    applyTimedLines(parseLrc(contents), source);
  }

  async function searchForLrc(requestId: number, localWarning = '') {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'searchLyrics')) {
      throw new Error('Online lyrics search is unavailable in this app window.');
    }
    const hints = getKaraokeLyricsSearchHints(mediaPath.trim(), mediaLibraryPath.trim());
    const query = [hints.title, hints.artist, hints.album].filter(Boolean).join(' ');
    if (!query) throw new Error('The media filename does not contain a title to search.');

    setIsSearchingLyrics(true);
    setStatus('No local timed lyrics found. Searching online using the media title and folder names...');
    try {
      const response = await api.searchLyrics(
        query,
        [hints.title, hints.artist].filter(Boolean).join(' ') || query,
        hints.artist
      );
      if (requestId !== lrcRequestId.current) return;
      if (!response?.ok) throw new Error(response?.error || 'Unable to search online lyrics.');
      const results = (response.results || []).filter(result =>
        result.syncedLyrics.length <= 256 * 1024 &&
        (result.syncedLyrics.match(/\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?\]/g)?.length || 0) <= 5000 &&
        parseLrc(result.syncedLyrics).length > 0
      );
      setLrcSearchResults(results);
      setStatus(results.length
        ? 'Choose a synchronized lyrics result to use for LRC alignment.'
        : `${localWarning ? `${localWarning} ` : ''}No timed lyrics were found. Turn off LRC to use the normal lyrics workflow.`);
    } finally {
      setIsSearchingLyrics(false);
    }
  }

  async function findLocalLrc(requestId: number): Promise<{ found: boolean; warning?: string }> {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'stat') ||
        !hasElectronCapability(api, 'readKaraokeLrc') ||
        !hasElectronCapability(api, 'getLyrics')) {
      throw new Error('Local LRC lookup is unavailable in this app window.');
    }

    const musicBasePath = getMatchingMusicBasePath(mediaPath.trim(), mediaLibraryPath.trim());
    if (!musicBasePath) return { found: false };

    const lrcPath = `${musicBasePath}.lrc`;
    const lrcStat = await api.stat(lrcPath);
    if (requestId !== lrcRequestId.current) return { found: false };
    let warning = '';
    if (lrcStat.ok && lrcStat.isFile) {
      const file = await api.readKaraokeLrc(lrcPath);
      if (!file.ok) throw new Error(file.error);
      if (requestId !== lrcRequestId.current) return { found: false };
      const lines = parseLrc(file.text);
      if (lines.length) {
        applyLrc(file.text, lrcPath);
        return { found: true };
      }
      warning = 'The same-name Music LRC has no usable timestamps.';
    }

    const mp3Path = `${musicBasePath}.mp3`;
    const mp3Stat = await api.stat(mp3Path);
    if (requestId !== lrcRequestId.current) return { found: false };
    if (mp3Stat.ok && mp3Stat.isFile) {
      const embedded = await api.getLyrics(mp3Path);
      if (!embedded.ok) throw new Error(embedded.error);
      if (requestId !== lrcRequestId.current) return { found: false };
      const lines = embedded.timed?.length
        ? embedded.timed
          .filter(line => Number.isFinite(line.time) && line.time >= 0 && line.text.trim())
          .slice()
          .sort((left, right) => left.time - right.time)
        : embedded.lyrics
          ? parseLrc(embedded.lyrics)
          : [];
      if (lines.length) {
        applyTimedLines(lines, `${mp3Path} (embedded lyrics)`);
        return { found: true };
      }
      if (embedded.lyrics) warning = 'The same-name Music MP3 has lyrics but no usable timestamps.';
    }
    return { found: false, warning };
  }

  async function enableLrc() {
    if (lrcEnabled) {
      lrcRequestId.current++;
      setLrcEnabled(false);
      setLrcSearchResults([]);
      setIsSearchingLyrics(false);
      setStatus('LRC alignment is off. The entered lyrics will use the normal alignment workflow.');
      return;
    }

    setLrcEnabled(true);
    setError('');
    if (timedLyrics?.length) {
      setStatus(`Using timed lyrics from ${lrcSource}.`);
      return;
    }

    const requestId = ++lrcRequestId.current;
    setLrcSearchResults([]);
    try {
      if (selectedLrcPath) {
        const api = window.electronAPI;
        if (!hasElectronCapability(api, 'readKaraokeLrc')) throw new Error('LRC file reading is unavailable.');
        const file = await api.readKaraokeLrc(selectedLrcPath);
        if (!file.ok) throw new Error(file.error);
        if (requestId !== lrcRequestId.current) return;
        applyLrc(file.text, selectedLrcPath);
        return;
      }
      const local = await findLocalLrc(requestId);
      if (local.found) return;
      if (requestId !== lrcRequestId.current) return;
      await searchForLrc(requestId, local.warning);
    } catch (caught) {
      if (requestId === lrcRequestId.current) {
        setError(`Unable to load timed lyrics: ${String(caught)}`);
        setStatus('');
      }
    }
  }

  async function browseLrc() {
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'chooseKaraokeLrc') ||
        !hasElectronCapability(api, 'readKaraokeLrc')) {
      setError('The LRC file picker is unavailable in this app window.');
      return;
    }

    const pickerRequestId = lrcRequestId.current;
    try {
      const result = await api.chooseKaraokeLrc();
      if (result.canceled) {
        if (result.error) setError(result.error);
        return;
      }
      if (pickerRequestId !== lrcRequestId.current) return;
      const selectedPath = result.paths[0];
      if (!selectedPath) throw new Error('The LRC picker returned no file.');
      const readRequestId = ++lrcRequestId.current;
      const file = await api.readKaraokeLrc(selectedPath);
      if (!file.ok) throw new Error(file.error);
      if (readRequestId !== lrcRequestId.current) return;
      setIsSearchingLyrics(false);
      setSelectedLrcPath(selectedPath);
      setLrcEnabled(true);
      applyLrc(file.text, selectedPath);
    } catch (caught) {
      setError(`Unable to use the selected LRC file: ${String(caught)}`);
    }
  }

  function useOnlineLyrics(result: ElectronOnlineLyricsResult) {
    try {
      applyLrc(result.syncedLyrics, `${result.trackName} — ${result.artistName} (${result.source || 'online'})`);
    } catch (caught) {
      setError(`Unable to use the selected online lyrics: ${String(caught)}`);
    }
  }

  async function createKaraoke() {
    if (isRunning) return;
    if (!/\.(mp3|flac|wav|mp4)$/i.test(mediaPath.trim())) {
      setError('Choose an MP3, FLAC, WAV, or MP4 source before creating karaoke.');
      return;
    }
    const api = window.electronAPI;
    if (!hasElectronCapability(api, 'splitAudioStems')) {
      setError('Vocal and accompaniment separation is unavailable in this app window.');
      return;
    }
    if (!hasElectronCapability(api, 'alignKaraokeSource')) {
      setError('Karaoke alignment is unavailable in this app window.');
      return;
    }
    if (lrcEnabled && !timedLyrics?.length) {
      setError('Choose a timed LRC source or turn off LRC alignment before creating karaoke.');
      return;
    }

    setIsRunning(true);
    setError('');
    const sourceType = /\.mp4$/i.test(mediaPath.trim()) ? 'Video' : 'Music';
    setStatus(`Creating ${sourceType} accompaniment and vocal stems...`);
    try {
      const stems = await api.splitAudioStems(mediaPath.trim(), mediaLibraryPath.trim());
      if (!stems.ok) throw new Error(`Unable to create ${sourceType} A/O stems: ${stems.error}`);
      onStemsCreated([stems.vocalsPath, stems.accompanimentPath]);
      setStatus(`${sourceType} A/O stems created. Aligning lyrics...`);
      const result = lrcEnabled
        ? await api.alignKaraokeSource(
            mediaPath.trim(),
            stems.vocalsPath,
            lyrics,
            mediaLibraryPath.trim(),
            timedLyrics || undefined
          )
        : await api.alignKaraokeSource(mediaPath.trim(), stems.vocalsPath, lyrics, mediaLibraryPath.trim());
      if (!result.ok) throw new Error(result.error);
      setStatus(`Karaoke subtitle saved: ${result.outputPath}`);
      onComplete(result.outputPath);
    } catch (caught) {
      setError(String(caught));
      setStatus('');
    } finally {
      setIsRunning(false);
    }
  }

  const disabled = isRunning || !mediaPath.trim() || !lyrics.trim() || !mediaLibraryPath.trim() ||
    (lrcEnabled && !timedLyrics?.length) || isSearchingLyrics;
  return (
    <section aria-label="Karaoke Creator" style={{ maxWidth: 1000 }}>
      <h1 style={{ margin: '0 0 12px', color: '#f5f7fb', fontSize: '1.4rem' }}>Karaoke Creator</h1>
      <p style={{ margin: '0 0 18px', color: 'rgba(245,247,251,0.62)' }}>
        Separate music or video into accompaniment and vocals, then align lyrics against the vocals and create a character-highlight karaoke subtitle. LRC timing is optional.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          id="karaoke-media-path"
          type="text"
          aria-label="Media path"
          value={mediaPath}
          disabled={isRunning}
          onChange={event => setSelectedMediaPath(event.currentTarget.value)}
          placeholder="C:\\Media\\Music\\Artist\\Album\\Song.mp3"
          style={{ flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#111218', color: '#f5f7fb', padding: '10px 12px' }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Use current media"
          title={initialMediaPath ? 'Use the current player media' : 'Select music or video in the player first'}
          onClick={() => setSelectedMediaPath(initialMediaPath)}
          disabled={isRunning || !/\.(mp3|flac|wav|mp4)$/i.test(initialMediaPath.trim())}
          style={{ minWidth: 104, border: '1px solid rgba(255,255,255,0.12)', background: '#1d1f27', color: '#f5f7fb' }}
        >
          Use Current
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Browse for media"
          title="Browse for music or video"
          onClick={() => void browseSource()}
          disabled={isRunning}
          style={{ minWidth: 88, border: '1px solid rgba(255,255,255,0.12)', background: '#1d1f27', color: '#f5f7fb' }}
        >
          Browse...
        </button>
      </div>
      <button
        type="button"
        className="icon-toggle"
        aria-label="Use LRC alignment"
        aria-pressed={lrcEnabled}
        onClick={() => void enableLrc()}
        disabled={isRunning}
        style={{
          minHeight: 36,
          marginBottom: 14,
          padding: '0 12px',
          borderRadius: 8,
          border: `1px solid ${lrcEnabled ? '#8dd9c1' : 'rgba(255,255,255,0.12)'}`,
          background: lrcEnabled ? '#8dd9c1' : '#1d1f27',
          color: lrcEnabled ? '#10221c' : '#f5f7fb',
          fontWeight: 700
        }}
      >
        {lrcEnabled ? 'LRC alignment: On' : 'LRC alignment: Off'}
      </button>
      {lrcEnabled && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#111218' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Choose an LRC file"
              onClick={() => void browseLrc()}
              disabled={isRunning}
              style={{ minHeight: 34, padding: '0 10px', border: '1px solid rgba(255,255,255,0.12)', background: '#1d1f27', color: '#f5f7fb' }}
            >
              Choose LRC file...
            </button>
            <span style={{ color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>
              {lrcSource || (isSearchingLyrics
                ? 'Checking the matching Music folder and searching online...'
                : 'No timed LRC source selected.')}
            </span>
          </div>
          {lrcSearchResults.length > 0 && (
            <div
              role="group"
              aria-label="Synchronized lyrics search results"
              style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto', marginTop: 10 }}
            >
              {lrcSearchResults.map((result, index) => (
                <button
                  type="button"
                  className="icon-btn"
                  key={`${result.id}:${result.source || ''}:${index}`}
                  onClick={() => useOnlineLyrics(result)}
                  disabled={isRunning}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '9px 10px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 7,
                    background: '#1d1f27',
                    color: '#f5f7fb',
                    textAlign: 'left'
                  }}
                >
                  {result.trackName} — {result.artistName}
                  {result.albumName ? ` · ${result.albumName}` : ''}
                  {result.source ? ` · ${result.source}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <label htmlFor="karaoke-lyrics" style={{ display: 'block', marginBottom: 8, color: '#eef2ff' }}>Lyrics</label>
      <textarea
        id="karaoke-lyrics"
        aria-label="Lyrics"
        value={lyrics}
        disabled={isRunning}
        onChange={event => {
          setLyrics(event.currentTarget.value);
          if (lrcEnabled) {
            lrcRequestId.current++;
            setLrcEnabled(false);
            setTimedLyrics(null);
            setLrcSource('');
            setLrcSearchResults([]);
            setStatus('Lyrics were edited, so LRC alignment is off. Turn it on again to load timed lyrics.');
          } else {
            setStatus('');
          }
          setError('');
        }}
        placeholder="Paste the complete lyrics here..."
        rows={12}
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', resize: 'vertical', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#111218', color: '#f5f7fb', padding: '12px', font: 'inherit', lineHeight: 1.55 }}
      />
      <p style={{ margin: '10px 0 14px', color: 'rgba(245,247,251,0.62)', fontSize: 13 }}>
        Output: {mediaLibraryPath.trim()
          ? `${mediaLibraryPath.trim().replace(/[\\/]+$/, '')}\\karaoke\\Artist\\Album\\Song.ass`
          : 'Set the media library location in Settings first.'}
        {' '}The first run downloads the open-source small speech model.
      </p>
      <button
        type="button"
        className="primary-btn"
        onClick={() => void createKaraoke()}
        disabled={disabled}
        style={{ minHeight: 44, padding: '0 20px', border: 'none', borderRadius: 12, background: disabled ? '#4a5b55' : 'linear-gradient(135deg, #8dd9c1, #64b99f)', color: '#10221c', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        {isRunning ? 'Creating karaoke...' : 'Create karaoke'}
      </button>
      {error && <p role="alert" style={{ margin: '14px 0 0', color: '#ff9b9b', overflowWrap: 'anywhere' }}>{error}</p>}
      {status && <p role="status" aria-live="polite" style={{ margin: '14px 0 0', color: 'rgba(245,247,251,0.78)', overflowWrap: 'anywhere' }}>{status}</p>}
    </section>
  );
}
