'use strict';
// Gold coin ("ransom payment") file generation and cleanup.
// Faithful port of GoldCoinManager.cs: same target folders, same weighted extension
// distribution, same honeypot/crucifix chance, same recursive-subfolder scatter, same
// "folder drawer" mode. Marker files are the ONLY files this app ever creates or deletes;
// nothing else on the user's disk is ever touched.
const fs = require('fs');
const os = require('os');
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


// ---- Normal mode: only well-known, top-level folders ----------------------------------------
// Coins are placed directly in Desktop and Downloads (never in subfolders, so we can never end
// up inside app bundles/libraries such as macOS' "Photos Library.photoslibrary"). If neither
// exists we fall back to other standard folders, and finally the home directory.
const KNOWN_FOLDERS = ['desktop', 'downloads'];
const FALLBACK_FOLDERS = ['documents', 'pictures', 'music', 'videos'];
// Gold is not all placed at once: this share appears when the infection starts and the rest
// trickles in during the attack, in MID_ATTACK_BATCHES batches spread over the first ~60% of the timer.
const INITIAL_FRACTION = 0.6;
const MID_ATTACK_BATCHES = 5;

let mid = { pending: 0, batchesLeft: 0, total: 0 };

function isWritableDir(d) {
  try { if (!fs.statSync(d).isDirectory()) return false; fs.accessSync(d, fs.constants.W_OK); return true; }
  catch { return false; }
}

function targetFolders() {
  const pick = names => [...new Set(names.map(n => paths.userDir(n)))].filter(isWritableDir);
  let dirs = pick(KNOWN_FOLDERS);
  if (dirs.length === 0) dirs = pick(FALLBACK_FOLDERS);
  if (dirs.length === 0 && isWritableDir(os.homedir())) dirs = [os.homedir()];
  return dirs;
}

/** Places gold coins (top level of the given folders) until at least targetGold is reached. */
function placeGold(targetGold, folders) {
  const created = [];
  let generated = 0, attempts = 0;
  while (generated < targetGold && attempts < 300 && folders.length) {
    attempts++;
    const ext = weightedExtension();
    const f = writeMarkerFile(folders[Math.floor(Math.random() * folders.length)], `gold${ext}`);
    if (f) { created.push(f); generated += EXT_VALUES[ext]; }
  }
  return { generated, created };
}

function generateScattered() {
  const folders = targetFolders();
  const targetGold = Math.floor(config.get('RansomAmount') * 1.2);
  mid = { pending: 0, batchesLeft: 0, total: 0 };
  if (folders.length === 0) return { generated: 0, created: [] };

  const { generated, created } = placeGold(Math.ceil(targetGold * INITIAL_FRACTION), folders);

  const extras = [];
  if (generated > 0 && Math.random() < GOLD6_CHANCE) extras.push('gold6');
  if (generated > 0 && Math.random() < CRUCIFIX_CHANCE) extras.push('crucifix');
  for (const ext of extras) {
    const f = writeMarkerFile(folders[Math.floor(Math.random() * folders.length)], ext);
    if (f) created.push(f);
  }

  if (generated > 0) mid = { pending: Math.max(0, targetGold - generated), batchesLeft: MID_ATTACK_BATCHES, total: generated };
  state.patch({ files: state.get().files.concat(created) });
  return { generated, created };
}

/** One mid-attack batch: drops more gold into the same known folders. Returns gold created. */
function spawnMidAttackBatch() {
  if (mid.batchesLeft <= 0 || mid.pending <= 0) { mid.batchesLeft = 0; mid.pending = 0; return 0; }
  const share = Math.ceil(mid.pending / mid.batchesLeft);
  mid.batchesLeft--;
  const { generated, created } = placeGold(share, targetFolders());
  mid.pending = Math.max(0, mid.pending - generated);
  mid.total += generated;
  if (mid.batchesLeft === 0) mid.pending = 0;
  if (created.length) state.patch({ files: state.get().files.concat(created) });
  log.info(`Mid-attack gold: +${generated} (${created.length} file(s)), ${mid.batchesLeft} batch(es) left`);
  return generated;
}
const midAttackRemaining = () => mid.batchesLeft > 0 && mid.pending > 0;
const pendingGold = () => mid.pending;
const totalGenerated = () => mid.total;

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

    mid = { pending: 0, batchesLeft: 0, total: generated };
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
  mid = { pending: 0, batchesLeft: 0, total: 0 };
  state.patch({ files: [], dirs: [], drawerRoot: null });
}

module.exports = { generateCoins, readDroppedFile, deleteAllCoins, drawerRoot, EXT_VALUES,
  spawnMidAttackBatch, midAttackRemaining, pendingGold, totalGenerated, targetFolders, KNOWN_FOLDERS };