import type { IAudioMetadata } from 'music-metadata';

export async function parseAudioBlob(blob: Blob): Promise<IAudioMetadata> {
  const { parseBlob } = await import('music-metadata');
  return parseBlob(blob);
}
