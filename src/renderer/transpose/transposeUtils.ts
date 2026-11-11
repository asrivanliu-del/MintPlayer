import type { PitchProcessor } from '../types';

export function applyPitchWithoutTempoChange(processor: PitchProcessor, semitones: number) {
  processor.pitchSemitones = semitones;
  processor.tempo = 1;
  processor.rate = 1;
}

export function configurePitchProcessor(processor: PitchProcessor, sampleRate: number, semitones: number) {
  processor._soundtouch?.stretch?.setParameters(sampleRate, 0, 0, 8);
  applyPitchWithoutTempoChange(processor, semitones);
}
