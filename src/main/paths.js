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
  const map = {
    desktop: 'Desktop', documents: 'Documents', pictures: 'Pictures', music: 'Music',
    videos: process.platform === 'darwin' ? 'Movies' : 'Videos', downloads: 'Downloads'
  };
  const conventional = path.join(home, map[name] || name);
  if (app) {
    try {
      const p = app.getPath(name);
      // On Linux accounts without an xdg-user-dirs config, Electron reports the HOME directory
      // itself for Downloads/Documents. Never treat home as one of these folders: use the
      // conventional ~/Downloads etc. instead (it's simply skipped later if it doesn't exist).
      if (path.resolve(p) !== path.resolve(home)) return p;
    } catch { /* fall through */ }
  }
  return conventional;
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
