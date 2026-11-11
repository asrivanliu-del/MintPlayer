// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAudioBlob } from '../../src/renderer/metadata/parseAudioBlob';

function createWaveBlob(): Blob {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < tag.length; index += 1) {
      view.setUint8(offset + index, tag.charCodeAt(index));
    }
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, 0, true);

  return new Blob([bytes], { type: 'audio/wav' });
}

describe('parseAudioBlob', () => {
  it('parses audio metadata directly from a Blob', async () => {
    const metadata = await parseAudioBlob(createWaveBlob());

    expect(metadata.format.container).toBe('WAVE');
    expect(metadata.format.codec).toBe('PCM');
    expect(metadata.format.sampleRate).toBe(8000);
    expect(metadata.format.numberOfChannels).toBe(1);
  });
});
