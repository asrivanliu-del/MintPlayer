const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  savePlaylist: (name, tracks) => ipcRenderer.invoke('save-playlist', name, tracks),
  loadPlaylists: () => ipcRenderer.invoke('load-playlists'),
  readdirRecursive: (p) => ipcRenderer.invoke('readdir-recursive', p),
  stat: (p) => ipcRenderer.invoke('stat', p),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  getLyrics: (p) => ipcRenderer.invoke('get-lyrics', p),
  appendLog: (msg) => ipcRenderer.invoke('append-log', msg),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  generateBacking: (p) => ipcRenderer.invoke('generate-backing', p),
  // write base64 content to temp file
  writeTempFile: (name, b64) => ipcRenderer.invoke('write-temp-file', name, b64),
  writePlaylists: (pl) => ipcRenderer.invoke('write-playlists', pl)
});