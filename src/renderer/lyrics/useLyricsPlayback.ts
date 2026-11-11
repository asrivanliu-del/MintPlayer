import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { TimedLyric } from '../types';
import { getLyricsIndexAtTime } from './lyricsUtils';

type PitchShifterTimeSource = {
  timePlayed?: number;
  sourcePosition?: number;
  sampleRate?: number;
};

type UseLyricsPlaybackOptions = {
  lyricsTimed: TimedLyric[] | null;
  seekTime: number;
  lyricsIndex: number;
  setSeekTime: Dispatch<SetStateAction<number>>;
  setLyricsIndex: Dispatch<SetStateAction<number>>;
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  shifterRef: MutableRefObject<PitchShifterTimeSource | null>;
  seekingRef: MutableRefObject<boolean>;
  lyricsContainerRef: MutableRefObject<HTMLDivElement | null>;
};

export function useLyricsPlayback({
  lyricsTimed,
  seekTime,
  lyricsIndex,
  setSeekTime,
  setLyricsIndex,
  audioRef,
  shifterRef,
  seekingRef,
  lyricsContainerRef
}: UseLyricsPlaybackOptions) {
  const lyricsTimeHandlerRef = useRef<(() => void) | null>(null);
  const shifterPollRef = useRef<number | null>(null);

  function detachLyricsTimeListener() {
    if (shifterPollRef.current !== null) {
      window.clearInterval(shifterPollRef.current);
      shifterPollRef.current = null;
    }
    const audio = audioRef.current;
    const handler = lyricsTimeHandlerRef.current;
    if (audio && handler) audio.removeEventListener('timeupdate', handler);
    lyricsTimeHandlerRef.current = null;
  }

  function attachLyricsTimeListener() {
    detachLyricsTimeListener();
    if (!lyricsTimed?.length) return;

    if (shifterRef.current) {
      shifterPollRef.current = window.setInterval(() => {
        const shifter = shifterRef.current;
        if (!shifter) return;
        const time = typeof shifter.timePlayed === 'number'
          ? shifter.timePlayed
          : shifter.sourcePosition && shifter.sampleRate
            ? shifter.sourcePosition / shifter.sampleRate
            : 0;
        if (!seekingRef.current) setSeekTime(time);
      }, 200);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    const handler = () => {
      if (!seekingRef.current) setSeekTime(audio.currentTime);
    };
    lyricsTimeHandlerRef.current = handler;
    audio.addEventListener('timeupdate', handler);
  }

  useEffect(() => {
    if (lyricsTimed?.length) attachLyricsTimeListener();
    else detachLyricsTimeListener();
    return detachLyricsTimeListener;
  }, [lyricsTimed]);

  useEffect(() => {
    setLyricsIndex(getLyricsIndexAtTime(seekTime, lyricsTimed));
  }, [seekTime, lyricsTimed, setLyricsIndex]);

  useEffect(() => {
    try {
      const container = lyricsContainerRef.current;
      const element = container?.querySelector<HTMLElement>(`#lyr-line-${lyricsIndex}`);
      if (!element || !container) return;
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const distanceFromTop = elementRect.top - containerRect.top;
      const desiredScrollTop = Math.max(
        0,
        container.scrollTop + distanceFromTop - container.clientHeight / 2 + element.clientHeight / 2
      );
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const target = Math.min(maxScroll, desiredScrollTop);
      if (lyricsIndex > 2) {
        container.scrollTo({ top: target, behavior: 'smooth' });
      } else {
        const elementBottom = container.scrollTop + distanceFromTop + element.offsetHeight;
        const viewBottom = container.scrollTop + container.clientHeight;
        if (distanceFromTop < 0 || elementBottom > viewBottom) {
          container.scrollTo({ top: Math.max(0, container.scrollTop + distanceFromTop - 8), behavior: 'smooth' });
        }
      }
    } catch (error) {
      console.warn('lyrics scroll error', error);
    }
  }, [lyricsIndex, lyricsContainerRef]);

  return { attachLyricsTimeListener, detachLyricsTimeListener };
}
