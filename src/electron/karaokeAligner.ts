import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getSeparatedStemOutputPaths } from './audioFileScanner';

export type KaraokeCharacter = {
  text: string;
  start: number;
  end: number;
};

export type KaraokeSubtitleLine = {
  start: number;
  end: number;
  text: string;
  characters: KaraokeCharacter[];
};

export type RecognizedWord = {
  text: string;
  start: number;
  end: number;
};

export type TimedLyricLine = {
  time: number;
  text: string;
};

type AlignmentProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
type TextConverter = (text: string) => string;

export type AlignmentProcessRunner = (
  command: string,
  args: string[],
  input: string,
  onProgress?: (message: string) => void
) => Promise<AlignmentProcessResult>;

const MAX_LYRIC_CHARACTERS = 5000;
const MAX_ALIGNMENT_CELLS = 25_000_000;

function runProcess(
  command: string,
  args: string[],
  input: string,
  onProgress?: (message: string) => void
): Promise<AlignmentProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    });
    let stdout = '';
    let stderr = '';
    let progressBuffer = '';
    child.stdout?.on('data', chunk => {
      stdout = `${stdout}${String(chunk)}`.slice(-2 * 1024 * 1024);
    });
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-128 * 1024);
      progressBuffer += String(chunk);
      const messages = progressBuffer.split(/\r?\n/);
      progressBuffer = messages.pop() || '';
      for (const message of messages) {
        if (message.startsWith('MINT_PROGRESS:')) onProgress?.(message.slice('MINT_PROGRESS:'.length).trim());
      }
    });
    child.on('error', reject);
    child.on('close', exitCode => resolve({ exitCode, stdout, stderr }));
    child.stdin?.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error);
    });
    child.stdin?.end(input, 'utf8');
  });
}

function normalizeFolderName(value: string, fallback: string) {
  const normalized = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : fallback;
}

export function getKaraokeOutputPath(mediaPath: string, mediaLibraryRoot: string) {
  const absoluteMediaPath = path.resolve(mediaPath);
  const absoluteRoot = path.resolve(mediaLibraryRoot);
  const relativePath = path.relative(absoluteRoot, absoluteMediaPath);
  const relativeParts = relativePath.split(path.sep).filter(Boolean);
  const isLibraryMedia = !path.isAbsolute(relativePath) &&
    ['video', 'music'].includes(relativeParts[0]?.toLocaleLowerCase() || '') &&
    !relativeParts.some(part => part === '..');

  let artist: string;
  let album: string;
  if (isLibraryMedia) {
    artist = normalizeFolderName(relativeParts[1], 'Unknown Artist');
    album = normalizeFolderName(relativeParts.slice(2, -1).join(' - '), 'Singles');
  } else {
    artist = normalizeFolderName(path.basename(path.dirname(path.dirname(absoluteMediaPath))), 'Unknown Artist');
    album = normalizeFolderName(path.basename(path.dirname(absoluteMediaPath)), 'Singles');
  }

  const title = normalizeFolderName(path.basename(absoluteMediaPath, path.extname(absoluteMediaPath)), 'Untitled');
  return path.join(absoluteRoot, 'karaoke', artist, album, `${title}.ass`);
}

function getSpokenCharacters(words: RecognizedWord[], convertText: TextConverter) {
  const characters: Array<{ text: string; start: number; end: number }> = [];
  for (const word of words) {
    const text = Array.from(convertText(word.text));
    const start = Number(word.start);
    const end = Number(word.end);
    if (!text.length || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const duration = end - start;
    text.forEach((character, index) => {
      if (/^[\s\p{P}\p{S}]$/u.test(character)) return;
      characters.push({
        text: character.toLocaleLowerCase(),
        start: start + duration * index / text.length,
        end: start + duration * (index + 1) / text.length
      });
    });
  }
  return characters;
}

function getLyricCharacters(lyrics: string, convertText: TextConverter) {
  const lines = lyrics.replace(/\r\n?/g, '\n').split('\n');
  const characters: Array<{ text: string; lineIndex: number; characterIndex: number }> = [];
  lines.forEach((line, lineIndex) => {
    const originalCharacters = Array.from(line);
    const normalizedCharacters = Array.from(convertText(line));
    originalCharacters.forEach((character, characterIndex) => {
      const normalizedCharacter = normalizedCharacters.length === originalCharacters.length
        ? normalizedCharacters[characterIndex]
        : Array.from(convertText(character))[0] || character;
      if (/^[\s\p{P}\p{S}]$/u.test(normalizedCharacter)) return;
      characters.push({ text: normalizedCharacter.toLocaleLowerCase(), lineIndex, characterIndex });
    });
  });
  return { lines, characters };
}

function findMatchingCharacters(
  lyrics: Array<{ text: string; lineIndex: number; characterIndex: number }>,
  speech: Array<{ text: string; start: number; end: number }>,
  minimumMatches = Math.max(3, Math.ceil(lyrics.length * 0.2))
) {
  const rows = lyrics.length + 1;
  const columns = speech.length + 1;
  if (rows * columns > MAX_ALIGNMENT_CELLS) {
    throw new Error('The lyrics are too long to align safely. Shorten them to 5,000 characters or fewer.');
  }

  const table = new Uint16Array(rows * columns);
  for (let row = 1; row < rows; row++) {
    const rowOffset = row * columns;
    const previousOffset = (row - 1) * columns;
    for (let column = 1; column < columns; column++) {
      table[rowOffset + column] = lyrics[row - 1].text === speech[column - 1].text
        ? table[previousOffset + column - 1] + 1
        : Math.max(table[previousOffset + column], table[rowOffset + column - 1]);
    }
  }

  const matches = new Map<number, number>();
  let row = lyrics.length;
  let column = speech.length;
  while (row > 0 && column > 0) {
    const value = table[row * columns + column];
    if (
      lyrics[row - 1].text === speech[column - 1].text &&
      value === table[(row - 1) * columns + column - 1] + 1
    ) {
      matches.set(row - 1, column - 1);
      row--;
      column--;
    } else if (table[(row - 1) * columns + column] >= table[row * columns + column - 1]) {
      row--;
    } else {
      column--;
    }
  }

  if (matches.size < minimumMatches) {
    throw new Error('Too little of the provided lyrics matched the audio. Check that the lyrics belong to this source and try again.');
  }
  return matches;
}

function getTimedLyricStarts(
  characters: Array<{ text: string; lineIndex: number; characterIndex: number }>,
  timedLyrics: TimedLyricLine[],
  speech: Array<{ text: string; start: number; end: number }>
) {
  const starts = new Array<number>(characters.length);
  const allMatches = new Map<number, number>();
  let speechCursor = 0;
  let totalMatches = 0;

  timedLyrics.forEach((line, lineIndex) => {
    const lyricCharacters = characters
      .map((character, index) => ({ character, index }))
      .filter(item => item.character.lineIndex === lineIndex);
    if (!lyricCharacters.length) return;

    const nextTime = timedLyrics[lineIndex + 1]?.time;
    const lowerBound = Math.max(0, line.time - 1.25);
    const upperBound = typeof nextTime === 'number' && nextTime > line.time
      ? Math.max(line.time, nextTime - 0.01)
      : line.time + Math.max(3, lyricCharacters.length * 0.2);
    while (speechCursor < speech.length && speech[speechCursor].end < lowerBound) speechCursor++;

    const speechWindowOffset = speechCursor;
    let speechEnd = speechCursor;
    while (speechEnd < speech.length && speech[speechEnd].start <= upperBound) speechEnd++;
    const speechWindow = speech.slice(speechCursor, speechEnd);
    const matches = speechWindow.length
      ? findMatchingCharacters(lyricCharacters.map(item => item.character), speechWindow, 0)
      : new Map<number, number>();

    const anchors = [...matches.keys()].sort((left, right) => left - right);
    totalMatches += anchors.length;
    const fallbackEnd = typeof nextTime === 'number' && nextTime > line.time
      ? nextTime
      : line.time + Math.max(0.5, lyricCharacters.length * 0.14);

    for (let index = 0; index < lyricCharacters.length; index++) {
      const current = lyricCharacters[index];
      const speechIndex = matches.get(index);
      if (speechIndex !== undefined) {
        starts[current.index] = speechWindow[speechIndex].start;
        allMatches.set(current.index, speechWindowOffset + speechIndex);
      }
    }

    if (!anchors.length) {
      lyricCharacters.forEach((item, index) => {
        starts[item.index] = line.time + (fallbackEnd - line.time) * index / lyricCharacters.length;
      });
      return;
    }

    const first = anchors[0];
    const firstTime = speechWindow[matches.get(first)!].start;
    for (let index = 0; index < first; index++) {
      starts[lyricCharacters[index].index] = line.time + (firstTime - line.time) * index / Math.max(1, first);
    }

    for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex++) {
      const left = anchors[anchorIndex];
      const right = anchors[anchorIndex + 1];
      const leftTime = speechWindow[matches.get(left)!].start;
      const rightTime = speechWindow[matches.get(right)!].start;
      for (let index = left + 1; index < right; index++) {
        starts[lyricCharacters[index].index] =
          leftTime + (rightTime - leftTime) * (index - left) / (right - left);
      }
    }

    const last = anchors[anchors.length - 1];
    const lastTime = speechWindow[matches.get(last)!].start;
    const remaining = lyricCharacters.length - last - 1;
    for (let index = last + 1; index < lyricCharacters.length; index++) {
      starts[lyricCharacters[index].index] = lastTime +
        Math.max(0, fallbackEnd - lastTime) * (index - last) / Math.max(1, remaining + 1);
    }

    const matchedSpeechIndexes = [...matches.values()];
    if (matchedSpeechIndexes.length) speechCursor += Math.max(...matchedSpeechIndexes) + 1;
  });

  if (totalMatches < Math.max(3, Math.ceil(characters.length * 0.2))) {
    throw new Error('The LRC timestamps do not match the vocals closely enough. Check the LRC source or turn off LRC alignment.');
  }
  return { starts, matches: allMatches };
}

function assignLyricTimings(
  lyrics: string,
  words: RecognizedWord[],
  convertText: TextConverter,
  timedLyrics?: TimedLyricLine[]
): KaraokeSubtitleLine[] {
  const lyricText = timedLyrics ? timedLyrics.map(line => line.text).join('\n') : lyrics;
  const { lines, characters } = getLyricCharacters(lyricText, convertText);
  if (!characters.length) throw new Error('Enter lyrics containing at least one line of text.');
  if (characters.length > MAX_LYRIC_CHARACTERS) {
    throw new Error(`Lyrics may contain at most ${MAX_LYRIC_CHARACTERS} non-whitespace characters.`);
  }
  const speech = getSpokenCharacters(words, convertText);
  if (!speech.length) throw new Error('The speech recognizer did not return usable word timings.');
  let matches: Map<number, number>;
  let starts: number[];
  if (timedLyrics) {
    const aligned = getTimedLyricStarts(characters, timedLyrics, speech);
    starts = aligned.starts;
    matches = aligned.matches;
  } else {
    matches = findMatchingCharacters(characters, speech);
    starts = new Array<number>(characters.length);
    for (const [lyricIndex, speechIndex] of matches) starts[lyricIndex] = speech[speechIndex].start;

    const anchors = [...matches.keys()].sort((left, right) => left - right);
    const firstAnchor = anchors[0];
    for (let index = firstAnchor - 1; index >= 0; index--) {
      starts[index] = Math.max(0, starts[index + 1] - 0.14);
    }
    for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex++) {
      const left = anchors[anchorIndex];
      const right = anchors[anchorIndex + 1];
      const leftTime = starts[left];
      const rightTime = starts[right];
      for (let index = left + 1; index < right; index++) {
        starts[index] = leftTime + (rightTime - leftTime) * (index - left) / (right - left);
      }
    }
    const lastAnchor = anchors[anchors.length - 1];
    for (let index = lastAnchor + 1; index < characters.length; index++) {
      starts[index] = starts[index - 1] + 0.14;
    }
  }

  const linesByIndex = lines.map((text, lineIndex) => {
    const indexedCharacters = characters
      .map((character, index) => ({ character, index }))
      .filter(item => item.character.lineIndex === lineIndex);
    const indexedByCharacter = new Map(indexedCharacters.map((item, index) => [item.character.characterIndex, index]));
    const timedCharacters = Array.from(text).map((character, characterIndex) => {
      const characterOffset = indexedByCharacter.get(characterIndex);
      if (characterOffset === undefined) {
        const nextContent = indexedCharacters.find(item => item.character.characterIndex > characterIndex);
        const previousContent = [...indexedCharacters].reverse().find(item => item.character.characterIndex < characterIndex);
        const start = nextContent
          ? starts[nextContent.index]
          : previousContent
            ? starts[previousContent.index]
            : 0;
        return { text: character, start, end: start };
      }

      const { index } = indexedCharacters[characterOffset];
      const start = Math.max(0, starts[index]);
      const next = indexedCharacters[characterOffset + 1];
      const mappedSpeech = matches.has(index) ? speech[matches.get(index)!] : undefined;
      const end = next
        ? Math.max(start, Math.min(starts[next.index], mappedSpeech?.end ?? starts[next.index]))
        : Math.max(start + 0.08, mappedSpeech?.end ?? start + 0.14);
      return { text: character, start, end };
    });

    return {
      start: timedCharacters[0]?.start ?? 0,
      end: Math.max(...timedCharacters.map(character => character.end), timedCharacters[0]?.start ?? 0),
      text,
      characters: timedCharacters
    };
  });

  return linesByIndex.filter(line => line.text.trim().length > 0 && line.characters.length > 0);
}

function formatAssTime(seconds: number) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor(centiseconds / 6000) % 60;
  const remainingSeconds = Math.floor(centiseconds / 100) % 60;
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
}

function escapeAssText(text: string) {
  return text.replace(/[{}]/g, character => character === '{' ? '（' : '）');
}

export function createKaraokeAss(lines: KaraokeSubtitleLine[]) {
  const dialogue = lines.map(line => {
    const start = line.start;
    const end = Math.max(line.end, start + 0.1);
    const text = line.characters.map((character, index) => {
      const next = line.characters[index + 1];
      const duration = next
        ? Math.max(0, next.start - character.start)
        : Math.max(0.08, character.end - character.start);
      const centiseconds = Math.max(0, Math.round(duration * 100));
      return `{\\k${centiseconds}}${escapeAssText(character.text)}`;
    }).join('');
    return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`;
  }).join('\n');

  return [
    '[Script Info]',
    'Title: MintPlayer Karaoke',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Microsoft JhengHei,54,&H00D1E8A4,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,1,0,1,3,1,2,70,70,70,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    dialogue,
    ''
  ].join('\n');
}

export function updateKaraokeAss(contents: string, updatedLines: KaraokeSubtitleLine[]) {
  const parsedLines = parseKaraokeAss(contents);
  const sourceLines = contents.split(/\r?\n/);
  const dialogueIndexes = sourceLines
    .map((line, index) => line.startsWith('Dialogue:') ? index : -1)
    .filter(index => index >= 0);
  if (!parsedLines.length || dialogueIndexes.length !== parsedLines.length || parsedLines.length !== updatedLines.length) {
    throw new Error(
      `The ASS subtitle contains unsupported or inconsistent dialogue events ` +
      `(parsed ${parsedLines.length}, source ${dialogueIndexes.length}, edited ${updatedLines.length}) and was not changed.`
    );
  }

  for (let lineIndex = 0; lineIndex < updatedLines.length; lineIndex++) {
    const source = parsedLines[lineIndex];
    const edited = updatedLines[lineIndex];
    if (
      source.text !== edited.text ||
      source.characters.length !== edited.characters.length ||
      edited.characters.some((character, characterIndex) =>
        character.text !== source.characters[characterIndex]?.text ||
        !Number.isFinite(character.start) ||
        !Number.isFinite(character.end) ||
        character.start < 0 ||
        character.end < character.start ||
        (characterIndex > 0 && character.start < edited.characters[characterIndex - 1].start)
      ) ||
      !Number.isFinite(edited.start) ||
      !Number.isFinite(edited.end) ||
      edited.start < 0 ||
      edited.end < edited.start ||
      Math.abs(edited.characters[0].start - edited.start) > 0.011 ||
      Math.abs(edited.characters[edited.characters.length - 1].end - edited.end) > 0.011 ||
      edited.characters.some((character, characterIndex) =>
        characterIndex < edited.characters.length - 1 &&
        Math.abs(character.end - edited.characters[characterIndex + 1].start) > 0.011
      )
    ) {
      throw new Error(`Invalid character timing data for subtitle line ${lineIndex + 1}.`);
    }

    const sourceLine = sourceLines[dialogueIndexes[lineIndex]];
    const prefixMatch = sourceLine.match(/^(\s*Dialogue:\s*)(.*)$/);
    if (!prefixMatch) throw new Error(`Unable to preserve ASS event ${lineIndex + 1}.`);
    const fields = prefixMatch[2].split(',', 10);
    if (fields.length !== 10) throw new Error(`Unable to preserve ASS event ${lineIndex + 1}.`);

    const karaokeTags = [...fields[9].matchAll(/\\k(?:f|o)?\d+/gi)];
    const sourceCharacters = Array.from(fields[9].replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n'));
    if (
      karaokeTags.length !== edited.characters.length ||
      sourceCharacters.length !== edited.characters.length ||
      sourceCharacters.some((character, index) => character !== edited.characters[index].text)
    ) {
      throw new Error(`ASS event ${lineIndex + 1} has unsupported inline text formatting and was not changed.`);
    }

    let tagIndex = 0;
    fields[9] = fields[9].replace(/\\k(?:f|o)?\d+/gi, () => {
      const character = edited.characters[tagIndex];
      const next = edited.characters[tagIndex + 1];
      const duration = next
        ? next.start - character.start
        : character.end - character.start;
      tagIndex++;
      return `\\k${Math.max(0, Math.round(duration * 100))}`;
    });
    fields[1] = formatAssTime(edited.start);
    fields[2] = formatAssTime(edited.end);
    sourceLines[dialogueIndexes[lineIndex]] = `${prefixMatch[1]}${fields.join(',')}`;
  }

  return sourceLines.join('\n');
}

function parseAssTime(value: string) {
  const match = value.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100;
}

export function parseKaraokeAss(contents: string): KaraokeSubtitleLine[] {
  const lines: KaraokeSubtitleLine[] = [];
  for (const sourceLine of contents.split(/\r?\n/)) {
    if (!sourceLine.startsWith('Dialogue:')) continue;
    const fields = sourceLine.slice('Dialogue:'.length).trimStart().split(',', 10);
    if (fields.length < 10) continue;
    const start = parseAssTime(fields[1]);
    const end = parseAssTime(fields[2]);
    if (start === null || end === null || end <= start) continue;
    const textField = fields[9];
    const characters: KaraokeCharacter[] = [];
    let cursor = start;
    const tags = /\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    let previousEnd = 0;
    let duration = 0;
    while ((match = tags.exec(textField))) {
      if (previousEnd > 0 && duration >= 0) {
        const segment = textField.slice(previousEnd, match.index);
        const segmentCharacters = Array.from(segment.replace(/\\[Nn]/g, '\n'));
        const segmentDuration = duration / Math.max(1, segmentCharacters.length);
        for (const character of segmentCharacters) {
          const characterEnd = cursor + segmentDuration;
          characters.push({ text: character, start: cursor, end: characterEnd });
          cursor = characterEnd;
        }
      }
      const karaoke = match[1].match(/\\k(?:f|o)?(\d+)/i);
      duration = karaoke ? Number(karaoke[1]) / 100 : 0;
      previousEnd = tags.lastIndex;
    }
    if (previousEnd > 0) {
      const segment = textField.slice(previousEnd).replace(/\\[Nn]/g, '\n');
      const segmentCharacters = Array.from(segment);
      const segmentDuration = duration / Math.max(1, segmentCharacters.length);
      for (const character of segmentCharacters) {
        const characterEnd = cursor + segmentDuration;
        characters.push({ text: character, start: cursor, end: characterEnd });
        cursor = characterEnd;
      }
    }
    if (characters.length) {
      lines.push({ start, end, text: characters.map(character => character.text).join(''), characters });
    }
  }
  return lines;
}

function getPythonCommand(scriptPath: string) {
  const projectPython = path.resolve(path.dirname(scriptPath), '..', '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(projectPython) ? projectPython : 'python';
}

export async function alignKaraokeSource(
  mediaPath: string,
  vocalsPath: string,
  lyrics: string,
  mediaLibraryRoot: string,
  scriptPath: string,
  onProgress?: (message: string) => void,
  run: AlignmentProcessRunner = runProcess,
  timedLyrics?: TimedLyricLine[]
) {
  if (!mediaPath.trim() || !fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
    throw new Error('Choose an existing music or video file first.');
  }
  if (!/\.(mp3|flac|wav|mp4)$/i.test(mediaPath)) {
    throw new Error('Karaoke Creator supports MP3, FLAC, WAV, and MP4 sources.');
  }
  if (!lyrics.trim()) throw new Error('Enter the lyrics to align.');
  if (timedLyrics && (
    !timedLyrics.length ||
    timedLyrics.some((line, index) =>
      !Number.isFinite(line.time) || line.time < 0 ||
      typeof line.text !== 'string' || !line.text.trim() ||
      (index > 0 && line.time < timedLyrics[index - 1].time))
  )) {
    throw new Error('The LRC timestamps are invalid or out of order.');
  }
  if (!mediaLibraryRoot.trim() || !fs.existsSync(mediaLibraryRoot) || !fs.statSync(mediaLibraryRoot).isDirectory()) {
    throw new Error('Set an existing media library folder in Settings before aligning lyrics.');
  }
  const expectedVocalsPath = getSeparatedStemOutputPaths(mediaPath, mediaLibraryRoot).vocalsPath;
  if (path.resolve(vocalsPath) !== path.resolve(expectedVocalsPath)) {
    throw new Error('Karaoke alignment only accepts the matching source vocals stem.');
  }
  if (!fs.existsSync(expectedVocalsPath) || !fs.statSync(expectedVocalsPath).isFile()) {
    throw new Error('Create the matching vocals stem before aligning lyrics.');
  }

  const result = await run(getPythonCommand(scriptPath), [scriptPath], JSON.stringify({ audioPath: vocalsPath, lyrics }), onProgress);
  if (result.exitCode !== 0) {
    const details = result.stderr.trim().split(/\r?\n/).filter(Boolean).pop();
    throw new Error(details || `The open-source aligner exited with code ${result.exitCode}.`);
  }

  let words: RecognizedWord[];
  try {
    const payload = JSON.parse(result.stdout) as { words?: unknown };
    if (!Array.isArray(payload.words)) throw new Error('The aligner returned no word timings.');
    words = payload.words.filter((word): word is RecognizedWord =>
      typeof word === 'object' && word !== null &&
      typeof (word as RecognizedWord).text === 'string' &&
      Number.isFinite((word as RecognizedWord).start) &&
      Number.isFinite((word as RecognizedWord).end)
    );
  } catch (error) {
    throw new Error(`Unable to read the aligner result: ${String(error)}`);
  }

  const OpenCC = await import('opencc-js');
  const convertText = OpenCC.default.Converter({ from: 'cn', to: 'twp' });
  const outputPath = getKaraokeOutputPath(mediaPath, mediaLibraryRoot);
  const ass = createKaraokeAss(assignLyricTimings(lyrics, words, convertText, timedLyrics));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, ass, { encoding: 'utf8', flag: 'wx' });
    try {
      fs.renameSync(temporaryPath, outputPath);
    } catch (error) {
      if (!fs.existsSync(outputPath)) throw error;
      fs.unlinkSync(outputPath);
      fs.renameSync(temporaryPath, outputPath);
    }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return { outputPath };
}
