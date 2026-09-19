'use strict';
// Gold coin ("ransom payment") file generation and cleanup.
// Faithful port of GoldCoinManager.cs: same target folders, same weighted extension
// distribution, same honeypot/crucifix chance, same recursive-subfolder scatter, same
// "folder drawer" mode. Marker files are the ONLY files this app ever creates or deletes;
// nothing else on the user's disk is ever touched.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = crypto;
const paths = require('./paths');
const state = require('./state');
const config = require('./config');
const log = require('./log');

const EXT_VALUES = { 1: 10, 2: 50, 3: 100, 4: 150, 5: 200, 6: 500 }; // 6 = honeypot
const CRUCIFIX_CHANCE = 0.1;
const GOLD6_CHANCE = 0.3;

function weightedExtension() {
  const roll = Math.floor(Math.random() * 100);
  if (roll < 40) return 1;
  if (roll < 70) return 2;
  if (roll < 85) return 3;
  if (roll < 93) return 4;
  return 5;
}

function targetFolders() {
  return [
    paths.userDir('desktop'), paths.userDir('documents'), paths.userDir('pictures'),
    paths.userDir('music'), paths.userDir('videos'), paths.userDir('downloads')
  ].filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

const drawerRoot = () => path.join(paths.tempDir(), 'RansomDrawers');

// A marker file just carries an id used to prevent reuse/replay of coins; no user data.
function writeMarkerFile(dir, ext) {
  try {
    const payload = JSON.stringify({ RANSOM_COIN: randomUUID().replace(/-/g, '') });
    // Same idea as ProtectedData.Protect: opaque-at-rest, not attacker-proof (not needed to be).
    const key = getOrCreateKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, enc]);

    const name = `${randomUUID().replace(/-/g, '')}.${ext}`;
    const full = path.join(dir, name);
    fs.writeFileSync(full, blob);
    return full;
  } catch (e) { log.warn('writeMarkerFile failed', e.message); return null; }
}

let _key = null;
function getOrCreateKey() {
  if (_key) return _key;
  const keyPath = path.join(paths.dataDir(), 'coin.key');
  try { _key = fs.readFileSync(keyPath); if (_key.length === 32) return _key; } catch { /* create below */ }
  _key = crypto.randomBytes(32);
  try { fs.writeFileSync(keyPath, _key, { mode: 0o600 }); } catch { /* best effort */ }
  return _key;
}

function decryptMarkerFile(file) {
  try {
    const blob = fs.readFileSync(file);
    const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), enc = blob.subarray(28);
    const key = getOrCreateKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch { return null; }
}

function balancedMaxDepth() { return Math.min(8, Math.max(2, 2 + Math.floor(config.get('InfectionDuration') / 45))); }

function randomLocationInTree(root) {
  const chain = [root];
  const depth = Math.floor(Math.random() * (balancedMaxDepth() + 1));
  let current = root;
  for (let i = 0; i < depth; i++) {
    let subDirs;
    try { subDirs = fs.readdirSync(current, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(current, d.name)); }
    catch { break; }
    if (subDirs.length === 0) break;
    current = subDirs[Math.floor(Math.random() * subDirs.length)];
    chain.push(current);
  }
  return chain[Math.floor(Math.random() * chain.length)];
}

function generateScattered() {
  const folders = targetFolders();
  const targetGold = Math.floor(config.get('RansomAmount') * 1.2);
  let generated = 0;
  const created = [];
  const touchedDirs = new Set();
  if (folders.length === 0) return { generated: 0, created };

  let attempts = 0;
  while (generated < targetGold && attempts < 500) {
    attempts++;
    try {
      const base = folders[Math.floor(Math.random() * folders.length)];
      const dir = randomLocationInTree(base);
      fs.mkdirSync(dir, { recursive: true });
      if (!folders.includes(dir)) touchedDirs.add(dir);
      const ext = weightedExtension();
      const f = writeMarkerFile(dir, `gold${ext}`);
      if (f) { created.push(f); generated += EXT_VALUES[ext]; }
    } catch { /* skip this attempt */ }
  }

  if (Math.random() < GOLD6_CHANCE && folders.length) {
    const base = folders[Math.floor(Math.random() * folders.length)];
    const dir = randomLocationInTree(base);
    try { fs.mkdirSync(dir, { recursive: true }); if (!folders.includes(dir)) touchedDirs.add(dir);
      const f = writeMarkerFile(dir, 'gold6'); if (f) created.push(f);
    } catch { /* ignore */ }
  }
  if (Math.random() < CRUCIFIX_CHANCE && folders.length) {
    const base = folders[Math.floor(Math.random() * folders.length)];
    const dir = randomLocationInTree(base);
    try { fs.mkdirSync(dir, { recursive: true }); if (!folders.includes(dir)) touchedDirs.add(dir);
      const f = writeMarkerFile(dir, 'crucifix'); if (f) created.push(f);
    } catch { /* ignore */ }
  }

  state.patch({ files: state.get().files.concat(created), dirs: (state.get().dirs || []).concat([...touchedDirs]) });
  return { generated, created };
}

function randFolderName() { return crypto.randomBytes(4).toString('hex'); }

function balancedDrawerLayout() {
  const targetGold = config.get('RansomAmount') * 1.2;
  const AVG = 60;
  const slotsForGold = Math.ceil((targetGold / AVG) * 1.5);
  const slotsForDuration = Math.floor(config.get('InfectionDuration') / 2);
  const totalSlots = Math.max(slotsForGold, slotsForDuration);
  const itemsPerDrawer = Math.min(8, Math.max(3, Math.round(Math.sqrt(totalSlots))));
  const drawerCount = Math.max(1, Math.ceil(totalSlots / itemsPerDrawer));
  return { drawerCount, itemsPerDrawer };
}

function generateDrawer() {
  const targetGold = Math.floor(config.get('RansomAmount') * 1.2);
  let generated = 0;
  const created = [];
  const allDirs = [];
  const root = drawerRoot();
  try {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const { drawerCount, itemsPerDrawer } = balancedDrawerLayout();
    for (let d = 0; d < drawerCount && generated < targetGold; d++) {
      const drawerPath = path.join(root, randFolderName());
      fs.mkdirSync(drawerPath, { recursive: true });
      allDirs.push(drawerPath);

      for (let it = 0; it < itemsPerDrawer && generated < targetGold; it++) {
        const itemPath = path.join(drawerPath, randFolderName());
        fs.mkdirSync(itemPath, { recursive: true });
        const levels = [drawerPath, itemPath];
        if (Math.random() < 0.5) {
          const sub = path.join(itemPath, randFolderName());
          fs.mkdirSync(sub, { recursive: true });
          levels.push(sub);
        }
        allDirs.push(...levels.slice(1));
        const coinDir = levels[Math.floor(Math.random() * levels.length)];
        const ext = weightedExtension();
        const f = writeMarkerFile(coinDir, `gold${ext}`);
        if (f) { created.push(f); generated += EXT_VALUES[ext]; }
      }
    }

    if (allDirs.length && Math.random() < GOLD6_CHANCE) {
      const dir = allDirs[Math.floor(Math.random() * allDirs.length)];
      const f = writeMarkerFile(dir, 'gold6'); if (f) created.push(f);
    }
    if (allDirs.length && Math.random() < CRUCIFIX_CHANCE) {
      const dir = allDirs[Math.floor(Math.random() * allDirs.length)];
      const f = writeMarkerFile(dir, 'crucifix'); if (f) created.push(f);
    }

    state.patch({ files: state.get().files.concat(created), drawerRoot: root });
  } catch (e) { log.warn('generateDrawer failed', e.message); }
  return { generated, created };
}

/** Generates the coin files for one ransom, per config.UseDrawerMode. Returns total gold value created. */
function generateCoins() {
  const { generated, created } = config.get('UseDrawerMode') ? generateDrawer() : generateScattered();
  log.info(`Generated ${created.length} marker file(s) worth ${generated} gold (drawer=${config.get('UseDrawerMode')})`);
  return generated;
}

/** Reads and validates a dropped file; returns { kind: 'gold'|'crucifix', value, coinId } or null if not ours/corrupt. */
function readDroppedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const data = decryptMarkerFile(filePath);
  if (!data || !data.RANSOM_COIN) return null;
  if (/^\.gold[1-6]$/.test(ext)) {
    const n = Number(ext.replace('.gold', ''));
    return { kind: 'gold', value: EXT_VALUES[n] || 10, coinId: data.RANSOM_COIN, filePath };
  }
  if (ext === '.crucifix') return { kind: 'crucifix', value: 0, coinId: data.RANSOM_COIN, filePath };
  return null;
}

/** Removes every marker file/dir this run created, and the drawer temp folder. Exception-safe. */
function deleteAllCoins() {
  const s = state.get();
  for (const f of s.files || []) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  for (const d of (s.dirs || []).sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(d); } catch { /* not empty / already gone, fine */ } }
  try { fs.rmSync(drawerRoot(), { recursive: true, force: true }); } catch { /* ignore */ }
  state.patch({ files: [], dirs: [], drawerRoot: null });
}

module.exports = { generateCoins, readDroppedFile, deleteAllCoins, drawerRoot, EXT_VALUES };
