import type { PlaybackControllerDependencies } from './playTrack';
import type { TrackPlaybackExecution } from './executeTrackPlayback';
import { configurePitchProcessor } from '../transpose/transposeUtils';

export async function playAudioTrack(
  dependencies: PlaybackControllerDependencies,
  execution: TrackPlaybackExecution
) {
  const {
    track: t,
    index: i,
    src,
    backingMime,
    startTime,
    shouldPlay,
    useBackingTrack,
    isStalePlaybackRequest
  } = execution;
  const {
    shifterRef,
    pitchShifterTrackIdRef,
    audioRef,
    setCurrent,
    setIsPlaying,
    attachLyricsTimeListener,
    setSeekTime,
    updatePlaybackStarting,
    appendElectronLog,
    reportPlaybackFailure,
    audioCtxRef,
    setLogs,
    transposeRef,
    getPitchShiftBuffer,
    autoNextRef,
    nextTrack,
    duration,
    setDuration,
    seekingRef,
    gainRef,
    pannerRef,
    scheduleMediaObjectUrlCleanup
  } = dependencies;
  // Pitch shifting applies to audio tracks only; avoid delaying video playback.
  let usedPitchShifter = false;
  let pitchShifterError: Error | null = null;
  if (transposeRef.current !== 0) {
    try {
      const stMod = await import('soundtouchjs');
      if (isStalePlaybackRequest()) return;
      const PitchShifter = (stMod as any).PitchShifter;
      if (PitchShifter && audioCtxRef.current && gainRef.current) {
        try {
          const audioContext = audioCtxRef.current;
          const audioBuf = await getPitchShiftBuffer(src, t, audioContext);
          if (isStalePlaybackRequest()) return;
          pitchShifterTrackIdRef.current = t.id;
          const shifter = new PitchShifter(audioContext, audioBuf, 1024, () => {
            try {
              if (isStalePlaybackRequest()) return;
              if (!autoNextRef.current || !nextTrack()) setIsPlaying(false);
            } catch (error) {
              console.error('PitchShifter end handler failed', error);
              setLogs(logs => [...logs, `PitchShifter end handler failed: ${String(error)}`]);
            }
          });
          configurePitchProcessor(shifter, audioBuf.sampleRate, transposeRef.current);
          shifter.percentagePlayed = shifter.duration ? Math.min(1, startTime / shifter.duration) : 0;
          shifter.on('play', (detail: any) => {
            if (!seekingRef.current) setSeekTime(detail.timePlayed);
            setDuration(shifter.duration || detail.duration || duration);
          });

          shifterRef.current = shifter;
          if (shouldPlay) {
            await (audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve());
            if (isStalePlaybackRequest()) return;
            shifter.pitchSemitones = transposeRef.current;
            if (pannerRef.current) shifter.connect(pannerRef.current);
            else shifter.connect(gainRef.current);
          }
          setCurrent(i);
          setSeekTime(startTime);
          setDuration(shifter.duration || 0);
          setIsPlaying(shouldPlay);
          updatePlaybackStarting(false);
          try { attachLyricsTimeListener(); }
          catch (error) {
            console.warn(`Unable to synchronize lyrics for ${t.name}`, error);
            setLogs(logs => [...logs, `Unable to synchronize lyrics for ${t.name}: ${String(error)}`]);
          }
          setLogs(logs => [...logs, `PitchShifter playback started for ${t.name} at ${transposeRef.current >= 0 ? '+' : ''}${transposeRef.current} semitones`]);
          usedPitchShifter = true;
        } catch (err) {
          console.warn('PitchShifter init failed', err);
          pitchShifterError = err instanceof Error ? err : new Error(String(err));
          setLogs(logs => [...logs, `PitchShifter failed for ${t.name}: ${pitchShifterError?.message || String(err)}`]);
        }
      }
    } catch (e) {
      pitchShifterError = e instanceof Error ? e : new Error(String(e));
      setLogs(logs => [...logs, `PitchShifter module failed for ${t.name}: ${pitchShifterError?.message || String(e)}`]);
    }
  }

  if (!usedPitchShifter && transposeRef.current !== 0) {
    const message = `Transpose could not be applied to ${t.name}; playback stopped instead of using unprocessed audio. ${pitchShifterError?.message || 'PitchShifter is unavailable.'}`;
    reportPlaybackFailure(message);
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch {}
    }
    setIsPlaying(false);
    updatePlaybackStarting(false);
  } else if (!usedPitchShifter && audioRef.current) {
    // Fallback: keep existing <audio> element playback
    try {
      // basic support check by extension
      const ext = (t.name || '').split('.').pop()?.toLowerCase();
      const mime = useBackingTrack
        ? backingMime || 'audio/mpeg'
        : ext === 'mp3' ? 'audio/mpeg' : ext === 'flac' ? 'audio/flac' : '';
      try {
        const can = (mime && audioRef.current.canPlayType) ? audioRef.current.canPlayType(mime) : '';
        setLogs(l=>[...l, `canPlayType(${mime})=${can}`]);
      } catch (e) { setLogs(l=>[...l, `canPlayType check error: ${String(e)}`]); }

      // Reset position to start if possible.
      try { audioRef.current.currentTime = 0; } catch (e) {}
      // clear previous sources
      audioRef.current.removeAttribute('src');
      while (audioRef.current.firstChild) audioRef.current.removeChild(audioRef.current.firstChild as Node);
      if (src.startsWith('music://')) audioRef.current.crossOrigin = 'anonymous';
      else audioRef.current.removeAttribute('crossorigin');
      audioRef.current.src = src;
      scheduleMediaObjectUrlCleanup();
      audioRef.current.load();
      if (startTime > 0) {
        await new Promise<void>((resolve, reject) => {
          const audio = audioRef.current!;
          if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            resolve();
            return;
          }
          const onMetadata = () => {
            audio.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            audio.removeEventListener('loadedmetadata', onMetadata);
            reject(new Error(`Unable to load track metadata: ${t.name}`));
          };
          audio.addEventListener('loadedmetadata', onMetadata, { once: true });
          audio.addEventListener('error', onError, { once: true });
        });
        if (isStalePlaybackRequest()) return;
        const audio = audioRef.current;
        if (audio) {
          const target = Number.isFinite(audio.duration) ? Math.min(startTime, audio.duration) : startTime;
          audio.currentTime = target;
          setSeekTime(target);
        }
      }
      if (!shouldPlay) {
        setCurrent(i);
        setIsPlaying(false);
      } else {
      const p = audioRef.current.play();
      if (p !== undefined && typeof (p as any).then === 'function') {
        (p as any).then(async () => { if (isStalePlaybackRequest()) return; setCurrent(i); setIsPlaying(true); updatePlaybackStarting(false); appendElectronLog(`Playback started index=${i} name=${t.name}`);
                      })
                    .catch((err: any) => {
            if (isStalePlaybackRequest()) return;
            updatePlaybackStarting(false);
                          appendElectronLog(`Playback failed index=${i} error=${String((err as any))}`);
            // Ignore benign aborts caused by an immediate pause interrupting play()
                          const msg = (err && (((err as any).message) || ((err as any).name) || String(err))).toString();
            if (!/interrupted|aborted|abort/i.test(msg)) {
                            reportPlaybackFailure(`Playback failed for ${t.name}: ${msg}`);
            } else {
              setLogs(l=>[...l, 'Ignored abort/interrupted play(): ' + msg]);
            }
          });
      } else {
        setCurrent(i);
        setIsPlaying(true);
        updatePlaybackStarting(false);
      }
      }
    } catch (err) {
      if (isStalePlaybackRequest()) return;
      reportPlaybackFailure(`Playback failed for ${t.name}: ${String(err)}`);
      updatePlaybackStarting(false);
    }
  }
}
