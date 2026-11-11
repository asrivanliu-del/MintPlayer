import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getSeparatedStemOutputPaths,
  type SeparatedStemOutputPaths
} from './audioFileScanner';

type StemPair = {
  vocalsPath: string;
  accompanimentSourcePath: string;
};

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type SeparationProcessRunner = (command: string, args: string[]) => Promise<ProcessResult>;

function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: { ...globalThis.process.env }
    });
    let stdout = '';
    let stderr = '';
    process.stdout?.on('data', chunk => {
      stdout = `${stdout}${String(chunk)}`.slice(-128 * 1024);
    });
    process.stderr?.on('data', chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-128 * 1024);
    });
    process.on('error', reject);
    process.on('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
}

function getSpleeterStemPair(outputDirectory: string, baseName: string): StemPair | null {
  const songDirectory = path.join(outputDirectory, baseName);
  const pair = {
    vocalsPath: path.join(songDirectory, 'vocals.wav'),
    accompanimentSourcePath: path.join(songDirectory, 'accompaniment.wav')
  };
  return fs.existsSync(pair.vocalsPath) && fs.existsSync(pair.accompanimentSourcePath)
    ? pair
    : null;
}

function findDemucsStemPairs(directory: string): StemPair[] {
  const pairs: StemPair[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pairs.push(...findDemucsStemPairs(entryPath));
      continue;
    }
    if (!entry.isFile() || entry.name.toLowerCase() !== 'vocals.wav') continue;
    const accompanimentSourcePath = path.join(path.dirname(entryPath), 'no_vocals.wav');
    if (fs.existsSync(accompanimentSourcePath)) {
      pairs.push({ vocalsPath: entryPath, accompanimentSourcePath });
    }
  }
  return pairs.sort((left, right) =>
    fs.statSync(right.vocalsPath).mtimeMs - fs.statSync(left.vocalsPath).mtimeMs
  );
}

function copyStemPair(pair: StemPair, outputs: SeparatedStemOutputPaths) {
  fs.mkdirSync(path.dirname(outputs.vocalsPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputs.accompanimentPath), { recursive: true });
  fs.copyFileSync(pair.vocalsPath, outputs.vocalsPath);
  fs.copyFileSync(pair.accompanimentSourcePath, outputs.accompanimentPath);
  return outputs;
}

function createTemporaryDirectory(tempRoot: string) {
  return fs.mkdtempSync(path.join(tempRoot, 'mintplayer-vocal-splitter-'));
}

function removeTemporaryDirectory(directory: string) {
  fs.rmSync(directory, { recursive: true, force: true });
}

export async function separateAudioFile(
  filePath: string,
  outputRoot: string,
  tempRoot = os.tmpdir(),
  run = runProcess
): Promise<SeparatedStemOutputPaths> {
  if (!/\.(mp3|flac|wav|mp4)$/i.test(filePath)) {
    throw new Error('Vocal Splitter supports MP3, FLAC, WAV, and MP4 files.');
  }
  if (!fs.statSync(filePath).isFile()) throw new Error('The selected audio path is not a file.');
  if (!fs.statSync(outputRoot).isDirectory()) throw new Error('The media library root is not a folder.');

  const outputs = getSeparatedStemOutputPaths(filePath, outputRoot);
  if (fs.existsSync(outputs.vocalsPath) && fs.existsSync(outputs.accompanimentPath)) return outputs;

  const baseName = path.basename(filePath, path.extname(filePath));
  const failures: string[] = [];
  let separationInputPath = filePath;
  let extractedAudioDirectory: string | null = null;
  if (/\.mp4$/i.test(filePath)) {
    extractedAudioDirectory = createTemporaryDirectory(tempRoot);
    separationInputPath = path.join(extractedAudioDirectory, `${baseName}.wav`);
    try {
      const result = await run('ffmpeg', [
        '-y', '-i', filePath, '-vn', '-ac', '2', '-ar', '44100', '-sample_fmt', 's16', separationInputPath
      ]);
      if (result.exitCode !== 0 || !fs.existsSync(separationInputPath)) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `ffmpeg exited ${result.exitCode}`);
      }
    } catch (error) {
      removeTemporaryDirectory(extractedAudioDirectory);
      throw new Error(`Unable to extract audio from ${baseName}. Install FFmpeg and add it to PATH. ${String(error)}`);
    }
  }

  try {
    const spleeterDirectory = createTemporaryDirectory(tempRoot);
    try {
      try {
        const result = await run('spleeter', [
          'separate', '-i', separationInputPath, '-p', 'spleeter:2stems', '-o', spleeterDirectory
        ]);
        const pair = getSpleeterStemPair(spleeterDirectory, baseName);
        if (pair) return copyStemPair(pair, outputs);
        failures.push(`Spleeter exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || 'both stems were not produced'}`);
      } catch (error) {
        failures.push(`Spleeter: ${String(error)}`);
      }
    } finally {
      removeTemporaryDirectory(spleeterDirectory);
    }

    const userProfile = globalThis.process.env.USERPROFILE || '';
    const demucsCandidates = [
      ...(userProfile ? [path.join(userProfile, 'Miniconda3', 'envs', 'backing', 'Scripts', 'demucs.exe')] : []),
      'demucs'
    ];

    for (const command of demucsCandidates) {
      const demucsDirectory = createTemporaryDirectory(tempRoot);
      try {
        try {
          const result = await run(command, ['--two-stems', 'vocals', '-o', demucsDirectory, separationInputPath]);
          const pair = findDemucsStemPairs(demucsDirectory)[0];
          if (pair) return copyStemPair(pair, outputs);
          failures.push(`${command} exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || 'both stems were not produced'}`);
        } catch (error) {
          failures.push(`${command}: ${String(error)}`);
        }
      } finally {
        removeTemporaryDirectory(demucsDirectory);
      }
    }

    throw new Error(`Unable to separate ${baseName}. ${failures.join('; ')}`);
  } finally {
    if (extractedAudioDirectory) removeTemporaryDirectory(extractedAudioDirectory);
  }
}
