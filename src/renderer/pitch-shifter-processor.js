class PitchShifterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.semitones = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === 'setSemitones') this.semitones = Number(d.value) || 0;
    };
  }

  process(inputs, outputs) {
    // Simple pass-through processor. This is a skeleton to be replaced by a real
    // pitch-shifting algorithm (SoundTouch / AudioWorklet DSP). It copies input to output.
    try {
      const input = inputs[0];
      const output = outputs[0];
      if (!input || !input.length) return true;
      for (let channel = 0; channel < output.length; channel++) {
        const inChannel = input[channel] || input[0];
        const outChannel = output[channel];
        for (let i = 0; i < outChannel.length; i++) {
          outChannel[i] = inChannel[i] || 0;
        }
      }
    } catch (e) {
      // ignore to keep audio flowing
    }
    return true;
  }
}

registerProcessor('pitch-shifter-processor', PitchShifterProcessor);
