'use strict';
// Platform-independent directory abstraction. Works with or without Electron so the
// file-generation logic can be exercised from plain Node (scripts/selftest.js).
const os = require('os');
const path = require('path');
const fs = require('fs');

let app = null;
try {
  const e = require('electron');
  if (e && e.app && typeof e.app.getPath === 'function') app = e.app;
} catch { /* running under plain node */ }

const home = os.homedir();

/** name: desktop | documents | pictures | music | videos | downloads */
function userDir(name) {
  if (app) {
    try { return app.getPath(name); } catch { /* fall through */ }
  }
  const map = {
    desktop: 'Desktop', documents: 'Documents', pictures: 'Pictures', music: 'Music',
    videos: process.platform === 'darwin' ? 'Movies' : 'Videos', downloads: 'Downloads'
  };
  return path.join(home, map[name] || name);
}

/** Per-user application data: config.json, state.json, coin.key, logs. */
function dataDir() {
  let d;
  if (process.env.RANS0M_DATA_DIR) d = process.env.RANS0M_DATA_DIR;
  else if (app) d = app.getPath('userData');
  else d = path.join(os.tmpdir(), 'rans0m-dev-data');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const logDir = () => path.join(dataDir(), 'logs');
const tempDir = () => os.tmpdir();
const assetsDir = () => path.join(__dirname, '..', '..', 'assets');
const asset = (...p) => path.join(assetsDir(), ...p);

module.exports = { userDir, dataDir, logDir, tempDir, assetsDir, asset };
