'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Minimal, explicit bridge -- renderers get exactly these channels, nothing else (no direct
// fs/child_process/ipcRenderer access), keeping the "don't collect input data / don't touch
// arbitrary files" boundary enforceable even if a window's HTML content were ever compromised.
contextBridge.exposeInMainWorld('rans0m', {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => { const h = (_e, ...a) => cb(...a); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  assetUrl: (...p) => ipcRenderer.invoke('asset:url', p),
  assetPath: (...p) => ipcRenderer.invoke('asset:path', p)
});
