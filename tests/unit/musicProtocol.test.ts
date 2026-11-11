import { describe, expect, it } from 'vitest';
import { createMusicProtocolCorsHeaders } from '../../src/electron/musicProtocol';

describe('music protocol CORS headers', () => {
  it('allows anonymous media requests and preserves streaming headers', () => {
    expect(createMusicProtocolCorsHeaders({
      'Content-Type': 'audio/mpeg',
      'Content-Range': 'bytes 0-99/1000',
      'Accept-Ranges': 'bytes'
    })).toEqual({
      'Content-Type': 'audio/mpeg',
      'Content-Range': 'bytes 0-99/1000',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Max-Age': '600'
    });
  });
});
