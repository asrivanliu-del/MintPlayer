import type { PlaybackControllerDependencies } from './playTrack';
import type { TrackPlaybackExecution } from './executeTrackPlayback';
import { configurePitchProcessor } from '../transpose/transposeUtils';

export async function playVideoTrack(
  dependencies: PlaybackControllerDependencies,
  execution: TrackPlaybackExecution
) {
  const {
    track: t,
    index: i,
    src,
    startTime,
    shouldPlay,
    isStalePlaybackRequest
  } = execution;
  const {
    videoRef,
    setCurrent,
    setMediaFront,
    setIsPlaying,
    setLyricsRaw,
    setLyricsTimed,
    setLyricsIndex,
    setLyricsMode,
    setSeekTime,
    setDuration,
    updatePlaybackStarting,
    reportPlaybackFailure,
    audioCtxRef,
    volume,
    setLogs,
    videoSourceRef,
    videoPitchNodeRef,
    videoSoundTouchRef,
    videoTransposeRef,
    previousVideoTransposeRef,
    resetVideoPitchBuffers,
    gainRef,
    pannerRef,
    scheduleMediaObjectUrlCleanup
  } = dependencies;
  try {
    const video = videoRef.current;
    if (!video) throw new Error('Video player is not available');
    video.pause();
    video.removeAttribute('src');
    video.load();
    const audioContext = audioCtxRef.current;
    if (audioContext && gainRef.current) {
      try {
        if (!videoSourceRef.current) {
          videoSourceRef.current = audioContext.createMediaElementSource(video);
        }
        if (!videoPitchNodeRef.current) {
          const soundTouchModule = await import('soundtouchjs');
          if (isStalePlaybackRequest()) return;
          const soundTouch = new soundTouchModule.SoundTouch();
          configurePitchProcessor(soundTouch, audioContext.sampleRate, videoTransposeRef.current);
          const bufferSize = 1024;
          const pitchNode = audioContext.createScriptProcessor(bufferSize, 2, 2);
          const inputSamples = new Float32Array(bufferSize * 2);
          const outputSamples = new Float32Array(bufferSize * 2);
          pitchNode.onaudioprocess = event => {
            const input = event.inputBuffer;
            const output = event.outputBuffer;
            const leftIn = input.getChannelData(0);
            const rightIn = input.numberOfChannels > 1 ? input.getChannelData(1) : leftIn;
            const leftOut = output.getChannelData(0);
            const rightOut = output.numberOfChannels > 1 ? output.getChannelData(1) : leftOut;
            const semitones = videoTransposeRef.current;

            if (semitones === 0) {
              if (previousVideoTransposeRef.current !== 0) resetVideoPitchBuffers();
              previousVideoTransposeRef.current = 0;
              leftOut.set(leftIn);
              if (rightOut !== leftOut) rightOut.set(rightIn);
              return;
            }

            previousVideoTransposeRef.current = semitones;
            inputSamples.fill(0);
            for (let frame = 0; frame < leftIn.length; frame++) {
              inputSamples[frame * 2] = leftIn[frame];
              inputSamples[frame * 2 + 1] = rightIn[frame];
            }
            const activeSoundTouch = videoSoundTouchRef.current;
            if (!activeSoundTouch) {
              leftOut.set(leftIn);
              if (rightOut !== leftOut) rightOut.set(rightIn);
              return;
            }
            activeSoundTouch.inputBuffer.putSamples(inputSamples, 0, leftIn.length);
            activeSoundTouch.process();
            outputSamples.fill(0);
            const framesAvailable = Math.min(leftIn.length, activeSoundTouch.outputBuffer.frameCount);
            if (framesAvailable > 0) {
              activeSoundTouch.outputBuffer.receiveSamples(outputSamples, framesAvailable);
              for (let frame = 0; frame < framesAvailable; frame++) {
                leftOut[frame] = outputSamples[frame * 2];
                if (rightOut !== leftOut) rightOut[frame] = outputSamples[frame * 2 + 1];
              }
            }
            for (let frame = framesAvailable; frame < leftOut.length; frame++) {
              leftOut[frame] = 0;
              if (rightOut !== leftOut) rightOut[frame] = 0;
            }
          };
          videoSourceRef.current.connect(pitchNode);
          pitchNode.connect(pannerRef.current || gainRef.current);
          videoSoundTouchRef.current = soundTouch;
          videoPitchNodeRef.current = pitchNode;
        }
        resetVideoPitchBuffers();
        video.volume = 1;
      } catch (error) {
        console.warn('Video audio processing setup failed; using direct video audio', error);
        setLogs(logs => [...logs, `Video audio processing setup failed: ${String(error)}`]);
        try {
          videoSourceRef.current?.connect(pannerRef.current || gainRef.current);
          video.volume = 1;
        } catch (fallbackError) {
          console.error('Direct video audio fallback failed', fallbackError);
          setLogs(logs => [...logs, `Direct video audio fallback failed: ${String(fallbackError)}`]);
          video.volume = volume;
        }
      }
    } else {
      video.volume = volume;
    }
    const resumeAudioContext = audioContext?.state === 'suspended'
      ? audioContext.resume()
      : Promise.resolve();
    if (src.startsWith('music://')) video.crossOrigin = 'anonymous';
    else video.removeAttribute('crossorigin');
    video.src = src;
    scheduleMediaObjectUrlCleanup();
    const canPlay = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
      };
      const onCanPlay = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        const mediaError = video.error;
        reject(new Error(mediaError
          ? `MediaError ${mediaError.code}: ${mediaError.message || 'browser could not load or decode the video'}`
          : 'Browser could not load or decode the video'));
      };
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
      video.load();
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        cleanup();
        resolve();
      }
    });
    setMediaFront('cover');
    setLyricsRaw(null);
    setLyricsTimed(null);
    setLyricsIndex(0);
    setLyricsMode('static');
    setCurrent(i);

    await canPlay;
    if (isStalePlaybackRequest()) return;
    await resumeAudioContext;
    if (isStalePlaybackRequest()) return;
    if (startTime > 0) {
      video.currentTime = Number.isFinite(video.duration) ? Math.min(startTime, video.duration) : startTime;
    }

    setSeekTime(video.currentTime || startTime);
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    if (shouldPlay) {
      await video.play();
      if (isStalePlaybackRequest()) return;
      setIsPlaying(true);
      updatePlaybackStarting(false);
      setLogs(l => [...l, `Video playback started for ${t.name}`]);
    } else {
      setIsPlaying(false);
      updatePlaybackStarting(false);
    }
  } catch (err) {
    const details = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const message = `Video playback failed for ${t.name}: ${details}`;
    if (isStalePlaybackRequest()) return;
    reportPlaybackFailure(message);
    updatePlaybackStarting(false);
  }



}
