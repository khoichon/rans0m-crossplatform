'use strict';
// Same keys / defaults / clamping as the original Windows Config.cs + ConfigWindow, so an
// existing config.json can simply be copied into the new data folder.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const log = require('./log');

const defaultCmd = process.platform === 'win32' ? 'shutdown /s /t 0'
  : process.platform === 'darwin' ? `osascript -e 'tell application "System Events" to shut down'`
  : 'systemctl poweroff';

// [default, min, max] for numbers
const SCHEMA = {
  SpawnAutomatically: [true],
  MinSpawnDelay: [5, 0, 86400],
  MaxSpawnDelay: [600, 0, 86400],
  InfectionDuration: [90, 5, 86400],
  CrashOnDeath: [false],          // DESTRUCTIVE: shuts the computer down on death (opt-in)
  ExecCMDOnDeath: [false],        // DESTRUCTIVE: runs CMDOnDeath on death (opt-in)
  CMDOnDeath: [defaultCmd],
  UseDrawerMode: [false],
  RansomAmount: [500, 1, 1000000]
};

let values = {};       // what is saved to disk (includes unknown keys, for forward compatibility)
let overrides = {};    // runtime-only (test mode); never written to disk
let exists = false;

const file = () => path.join(paths.dataDir(), 'config.json');

function coerce(key, v) {
  const [def, min, max] = SCHEMA[key];
  if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
  if (typeof def === 'number') {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  return typeof v === 'string' ? v.slice(0, 500) : def;
}

function load() {
  values = {};
  exists = fs.existsSync(file());
  if (exists) {
    try { values = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; }
    catch (e) { log.warn('config.json unreadable, using defaults', e.message); exists = false; }
  }
  return exists;
}

function get(key) {
  if (key in overrides) return overrides[key];
  return key in SCHEMA ? coerce(key, values[key] !== undefined ? values[key] : SCHEMA[key][0]) : values[key];
}

function set(key, v) { if (key in SCHEMA) values[key] = coerce(key, v); }
function setMany(obj) { for (const k of Object.keys(obj)) set(k, obj[k]); }

function save() {
  const out = Object.assign({}, values);
  for (const k of Object.keys(SCHEMA)) out[k] = get(k in overrides ? k : k) === undefined ? SCHEMA[k][0] : coerce(k, values[k] !== undefined ? values[k] : SCHEMA[k][0]);
  fs.writeFileSync(file(), JSON.stringify(out, null, 2));
  values = out; exists = true;
}

function all() { const o = {}; for (const k of Object.keys(SCHEMA)) o[k] = get(k); return o; }
function setOverrides(o) { overrides = o || {}; }

module.exports = { load, get, set, setMany, save, all, setOverrides, exists: () => exists, file, SCHEMA, defaultCmd };
