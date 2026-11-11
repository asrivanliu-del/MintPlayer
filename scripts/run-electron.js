// Spawn Electron as a child so nodemon restarts do not leave orphan app processes.
const { spawn } = require('child_process');
const path = require('path');

process.env.NODE_ENV = 'development';

const electronPackage = require('electron');
const electronPath = typeof electronPackage === 'string'
  ? electronPackage
  : electronPackage && typeof electronPackage.path === 'string'
    ? electronPackage.path
    : path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32' && electronPath.endsWith('.cmd')
});

let stopping = false;
function stopElectron() {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null || child.signalCode !== null) {
    process.exit(0);
    return;
  }
  child.once('close', () => process.exit(0));
  child.kill();
}

process.on('SIGUSR2', stopElectron);
process.on('SIGINT', stopElectron);
process.on('SIGTERM', stopElectron);
child.on('close', (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
child.on('error', error => {
  console.error('Failed to start Electron:', error);
  process.exitCode = 1;
});