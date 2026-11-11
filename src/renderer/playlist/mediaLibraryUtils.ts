export const MEDIA_LIBRARY_ROLES = [
  'music',
  'video',
  'karaoke',
  'accompaniments',
  'vocals'
] as const;

export type MediaLibraryRole = typeof MEDIA_LIBRARY_ROLES[number];
export type MediaLibrarySource = 'music' | 'video';
export type SeparatedAudioRole = 'accompaniments' | 'vocals';
export const MEDIA_LIBRARY_PLAYBACK_ROLES: readonly MediaLibraryRole[] = [
  'music',
  'video',
  'karaoke',
  'accompaniments',
  'vocals'
];
export type MediaLibrarySong = {
  id: string;
  name: string;
  relativeLocation: string;
  searchText: string;
  files: Partial<Record<MediaLibraryRole, string[]>>;
  sourceStems: Partial<Record<MediaLibrarySource, Partial<Record<SeparatedAudioRole, string[]>>>>;
  otherFiles: string[];
};

const KARAOKE_EXTENSIONS = /\.(ass|ssa|srt|lrc|vtt)$/i;
const ACCOMPANIMENT_SUFFIX = /(?:[_\s.-]+)(?:backing[_\s.-]?track|accompaniment|instrumental|no[_\s.-]?vocals?)(?:[_\s.-]*\d+)?$/i;
const VOCALS_SUFFIX = /(?:[_\s.-]+)vocals?(?:[_\s.-]*\d+)?$/i;
const SOURCE_STEM_DIRECTORY = /^(music|video)_(accompaniments|vocals)$/i;

function getSourceStemDirectory(filePath: string) {
  return filePath.split(/[\\/]/).find(part => SOURCE_STEM_DIRECTORY.test(part));
}

function getRelativePath(filePath: string, rootPath: string) {
  const normalizedFile = filePath.replace(/[\\/]+/g, '/');
  const normalizedRoot = rootPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  if (normalizedFile.toLocaleLowerCase().startsWith(`${normalizedRoot.toLocaleLowerCase()}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  return filePath.replace(/[\\/]+/g, '/');
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function getDisplayName(filePath: string) {
  return getFileName(filePath).replace(/\.[^.]+$/, '');
}

function getKaraokeAsset(filePath: string, relativeParts: string[]) {
  const fileName = getFileName(filePath);
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || '';
  const stem = fileName.slice(0, fileName.length - extension.length);
  const accompanimentMatch = ACCOMPANIMENT_SUFFIX.exec(stem);
  if (accompanimentMatch) {
    return { role: 'accompaniments' as const, stem: stem.slice(0, accompanimentMatch.index) || stem };
  }

  const vocalsMatch = VOCALS_SUFFIX.exec(stem);
  if (vocalsMatch) {
    return { role: 'vocals' as const, stem: stem.slice(0, vocalsMatch.index) || stem };
  }

  if (KARAOKE_EXTENSIONS.test(extension)) {
    return { role: 'karaoke' as const, stem };
  }

  const karaokeFolders = relativeParts.slice(1, -1).map(part => part.toLocaleLowerCase());
  if (karaokeFolders.some(folder => /^(?:accompaniment|accompaniments|backing|instrumental)$/.test(folder))) {
    return { role: 'accompaniments' as const, stem };
  }
  if (karaokeFolders.some(folder => /^(?:vocal|vocals)$/.test(folder))) {
    return { role: 'vocals' as const, stem };
  }
  return { role: undefined, stem };
}

function getFileRole(
  filePath: string,
  relativeParts: string[]
): { role: MediaLibraryRole | undefined; stem: string; source?: MediaLibrarySource } {
  const category = relativeParts[0]?.toLocaleLowerCase();
  const sourceStemMatch = SOURCE_STEM_DIRECTORY.exec(relativeParts[0] || '');
  if (sourceStemMatch) {
    return {
      role: sourceStemMatch[2].toLocaleLowerCase() as SeparatedAudioRole,
      source: sourceStemMatch[1].toLocaleLowerCase() as MediaLibrarySource,
      stem: getFileName(filePath).replace(/\.[^.]+$/, '')
    };
  }
  const fileName = getFileName(filePath);
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || '';
  const stem = fileName.slice(0, fileName.length - extension.length);

  if (category === 'music') return { role: 'music' as const, stem };
  if (category === 'video') return { role: 'video' as const, stem };
  if (category === 'karaoke') return getKaraokeAsset(filePath, relativeParts);
  if (category === 'accompaniments') {
    const asset = getKaraokeAsset(filePath, relativeParts);
    return asset.role ? asset : { role: 'accompaniments' as const, stem };
  }
  if (category === 'vocals') {
    const asset = getKaraokeAsset(filePath, relativeParts);
    return asset.role ? asset : { role: 'vocals' as const, stem };
  }
  return { role: undefined, stem };
}

export function getMediaLibraryRoleFromFilePath(filePath: string): MediaLibraryRole | undefined {
  const normalizedPath = filePath.replace(/[\\/]+/g, '/');
  const parts = normalizedPath.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || '';
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || '';
  const folders = parts.slice(0, -1).map(part => part.toLocaleLowerCase());
  const karaokeAsset = getKaraokeAsset(filePath, parts);
  const sourceStemMatch = folders.map(folder => SOURCE_STEM_DIRECTORY.exec(folder)).find(Boolean);
  if (sourceStemMatch) return sourceStemMatch[2].toLocaleLowerCase() as MediaLibraryRole;

  if (karaokeAsset.role === 'accompaniments' || folders.some(folder => /^(?:accompaniment|accompaniments|backing|instrumental)$/.test(folder))) {
    return 'accompaniments';
  }
  if (karaokeAsset.role === 'vocals' || folders.some(folder => /^(?:vocal|vocals)$/.test(folder))) {
    return 'vocals';
  }
  if (KARAOKE_EXTENSIONS.test(extension)) return 'karaoke';
  if (/\.mp4$/i.test(extension)) return 'video';
  if (/\.(mp3|flac|wav)$/i.test(extension)) return 'music';
  return undefined;
}

export function getVideoResolutionLabel(width: number, height: number) {
  const shortEdge = Math.min(width, height);
  if (shortEdge >= 4320) return '8K';
  if (shortEdge >= 2160) return '4K';
  for (const standard of [1440, 1080, 720, 480, 360]) {
    if (shortEdge >= standard) return `${standard}p`;
  }
  return `${shortEdge}p`;
}

function selectDisplayFile(song: MediaLibrarySong) {
  for (const role of ['music', 'video', 'karaoke', 'accompaniments', 'vocals'] as const) {
    const filePath = song.files[role]?.[0];
    if (filePath) return getDisplayName(filePath);
  }
  return getDisplayName(song.otherFiles[0] || song.id);
}

export function groupMediaLibraryFiles(filePaths: string[], rootPath: string): MediaLibrarySong[] {
  const songs = new Map<string, MediaLibrarySong>();
  const sortedPaths = [...filePaths].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  for (const filePath of sortedPaths) {
    const relativePath = getRelativePath(filePath, rootPath);
    const relativeParts = relativePath.split('/').filter(Boolean);
    const { role, stem, source } = getFileRole(filePath, relativeParts);
    const category = relativeParts[0]?.toLocaleLowerCase();
    const categoryFolders = ['music', 'video', 'karaoke', 'accompaniments', 'vocals'].includes(category || '') ||
      SOURCE_STEM_DIRECTORY.test(category || '')
      ? relativeParts.slice(1, -1)
      : relativeParts.slice(0, -1);
    const roleSourceCategory = categoryFolders[0]?.toLocaleLowerCase();
    const foldersWithoutRepeatedSourceCategory = ['accompaniments', 'vocals'].includes(category || '') &&
      ['music', 'video', 'karaoke'].includes(roleSourceCategory || '')
      ? categoryFolders.slice(1)
      : categoryFolders;
    const identityFolders = foldersWithoutRepeatedSourceCategory.filter(part =>
      category !== 'karaoke' || !/^(?:accompaniments?|backing|instrumental|vocals?)$/i.test(part)
    );
    const identityParts = [...identityFolders, stem];
    const normalizedIdentity = identityParts.join('/').toLocaleLowerCase();
    const song = songs.get(normalizedIdentity) || {
      id: normalizedIdentity,
      name: '',
      relativeLocation: identityFolders.join('\\'),
      searchText: '',
      files: {},
      sourceStems: {},
      otherFiles: []
    };

    if (role) {
      song.files[role] = [...(song.files[role] || []), filePath];
      if (source && (role === 'accompaniments' || role === 'vocals')) {
        const sourceRolePaths = song.sourceStems[source]?.[role] || [];
        song.sourceStems[source] = {
          ...song.sourceStems[source],
          [role]: [...sourceRolePaths, filePath]
        };
      }
    } else {
      song.otherFiles.push(filePath);
    }

    const allPaths = [...Object.values(song.files).flat(), ...song.otherFiles];
    song.name = selectDisplayFile(song);
    song.searchText = [song.name, ...allPaths.map(path => getRelativePath(path, rootPath))]
      .join(' ')
      .toLocaleLowerCase();
    songs.set(normalizedIdentity, song);
  }

  return [...songs.values()].sort((a, b) =>
    a.relativeLocation.localeCompare(b.relativeLocation, undefined, { sensitivity: 'base' }) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

export function filterMediaLibrarySongs(
  songs: MediaLibrarySong[],
  search: string,
  musicEnabled: boolean,
  videoEnabled: boolean,
  additionalRoleFilters: Partial<Record<'karaoke' | 'accompaniments' | 'vocals', boolean>> = {}
) {
  const query = search.trim().toLocaleLowerCase();
  const additionalRoles = (['karaoke', 'accompaniments', 'vocals'] as const)
    .filter(role => additionalRoleFilters[role]);
  const showAllWhenMusicAndVideoEnabled = musicEnabled && videoEnabled && additionalRoles.length === 0;
  return songs.filter(song => {
    const categoryMatches = showAllWhenMusicAndVideoEnabled
      ? true
      : (musicEnabled && !!song.files.music?.length) ||
        (videoEnabled && !!song.files.video?.length) ||
        additionalRoles.some(role => !!song.files[role]?.length);
    return categoryMatches && (!query || song.searchText.includes(query));
  });
}

export function getMediaLibrarySongPath(song: MediaLibrarySong) {
  return song.files.music?.[0] || song.files.video?.[0];
}

export function getMediaLibraryRolePath(
  song: MediaLibrarySong,
  role: MediaLibraryRole,
  source?: MediaLibrarySource
) {
  const supportedExtension = role === 'video'
    ? /\.mp4$/i
    : role === 'karaoke'
      ? null
      : /\.(mp3|flac|wav)$/i;
  if (!supportedExtension) return undefined;
  if ((role === 'accompaniments' || role === 'vocals') && source) {
    const sourcePath = song.sourceStems[source]?.[role]?.find(filePath => supportedExtension.test(filePath));
    if (sourcePath) return sourcePath;

    const hasMusicSource = !!song.files.music?.length;
    const hasVideoSource = !!song.files.video?.length;
    const hasOnlyRequestedSource = source === 'music'
      ? hasMusicSource && !hasVideoSource
      : hasVideoSource && !hasMusicSource;
    if (!hasOnlyRequestedSource) return undefined;

    const legacyPaths = (song.files[role] || []).filter(filePath => !getSourceStemDirectory(filePath));
    return legacyPaths.find(filePath => supportedExtension.test(filePath));
  }
  const sourcePaths = (role === 'accompaniments' || role === 'vocals')
    ? (['music', 'video'] as const).flatMap(sourceName => song.sourceStems[sourceName]?.[role] || [])
    : [];
  const paths = [...sourcePaths, ...(song.files[role] || []).filter(filePath => !getSourceStemDirectory(filePath))];
  return paths.find(filePath => supportedExtension.test(filePath));
}

export function getMediaLibrarySongPlaybackPath(song: MediaLibrarySong) {
  for (const role of MEDIA_LIBRARY_PLAYBACK_ROLES) {
    const filePath = getMediaLibraryRolePath(song, role);
    if (filePath) return filePath;
  }
  return undefined;
}
