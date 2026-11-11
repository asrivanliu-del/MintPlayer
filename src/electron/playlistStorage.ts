export type StoredPlaylist = {
  name: string;
  tracks: unknown[];
};

function isStoredPlaylist(value: unknown): value is StoredPlaylist {
  if (!value || typeof value !== 'object') return false;
  const playlist = value as Record<string, unknown>;
  return typeof playlist.name === 'string' && Array.isArray(playlist.tracks);
}

export function parseStoredPlaylists(raw: string): StoredPlaylist[] {
  const parsed: unknown = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed) || !parsed.every(isStoredPlaylist)) {
    throw new Error('Stored playlists must be an array of playlists with names and track lists.');
  }
  return parsed;
}
