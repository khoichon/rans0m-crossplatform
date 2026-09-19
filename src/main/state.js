'use strict';
// Small persistent JSON store. Replaces the registry keys used by the Windows version
// (Software\RANSOM\GoldCoins / GoldDirectories). It records everything RANS0M has changed on
// the system so a crash can be recovered from on the next launch.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

let data = { files: [], wallpaper: null, fileTypes: null };
const file = () => path.join(paths.dataDir(), 'state.json');

function load() {
  try { data = Object.assign({ files: [], wallpaper: null, fileTypes: null }, JSON.parse(fs.readFileSync(file(), 'utf8'))); }
  catch { /* first run */ }
  return data;
}
function save() {
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file());
}
const get = () => data;
function patch(obj) { Object.assign(data, obj); try { save(); } catch { /* best effort */ } }

module.exports = { load, get, patch };
