'use strict';
// Cross-platform audio for the original WAV assets (replaces NAudio). Playback happens in a
// renderer <audio> element (same engine on every OS). Each play request is ONE self-contained
// message carrying the file URL, so nothing can arrive "before the sound exists" (that race
// silently dropped most sounds in the first version). Messages are queued until the page has
// loaded.
const { pathToFileURL } = require('url');
const paths = require('./paths');

let counter = 0;
function forWindow(win) {
  let ready = !win.webContents.isLoading();
  const queue = [];
  function send(...args) {
    if (win.isDestroyed()) return;
    if (!ready) { queue.push(args); return; }
    try { win.webContents.send(...args); } catch { /* window gone */ }
  }
  win.webContents.once('did-finish-load', () => { ready = true; while (queue.length) send(...queue.shift()); });

  return {
    play(relPath, { loop = false } = {}) {
      const id = ++counter;
      send('audio:play', id, pathToFileURL(paths.asset(...relPath.split('/'))).href, loop);
      return { stop: () => send('audio:stop', id) };
    }
  };
}
module.exports = { forWindow };
