'use strict';
// Headless test of the platform-independent core (config, coin generation/cleanup, dropped-file
// validation) without needing Electron/a display. Electron-dependent parts (windows, tray,
// real input hooks) still require `npm start` / `npm run start:test` on a machine with a GUI.
process.env.RANS0M_DATA_DIR = process.env.RANS0M_DATA_DIR || require('os').tmpdir() + '/rans0m-selftest';
const fs = require('fs');
const assert = require('assert');
const config = require('../src/main/config');
const coins = require('../src/main/coins');
const state = require('../src/main/state');
const paths = require('../src/main/paths');

function log(msg) { console.log('[selftest] ' + msg); }

state.load();
config.load();
config.setMany({ RansomAmount: 100, InfectionDuration: 30, UseDrawerMode: false });
config.save();
assert.strictEqual(config.get('RansomAmount'), 100);
log('config load/save/clamp OK');

// out-of-range values get clamped
config.set('RansomAmount', 99999999);
assert.strictEqual(config.get('RansomAmount'), 1000000);
log('config clamping OK');
config.setMany({ RansomAmount: 100 }); // restore a sane amount for the generation tests below
config.save();

// Snapshot each user folder BEFORE generating anything. CI runners (and real machines) can
// have pre-existing OS files in these folders (desktop.ini on Windows, .localized on macOS) —
// those aren't ours to complain about. We only care that nothing WE create is left behind.
const os = require('os');
const path = require('path');
const USER_FOLDERS = ['Desktop', 'Documents', 'Pictures', 'Music', 'Videos', 'Downloads'];
const before = {};
for (const d of USER_FOLDERS) {
  const dir = path.join(os.homedir(), d);
  before[dir] = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
}

// ---- scattered mode ----
const gold = coins.generateCoins();
assert.ok(gold > 0, 'expected some gold to be generated');
log(`scattered mode generated ${gold} gold`);

const s = state.get();
assert.ok(s.files.length > 0, 'expected marker files to be tracked');
for (const f of s.files) assert.ok(fs.existsSync(f), `tracked file missing: ${f}`);
log(`${s.files.length} marker files exist on disk and are tracked for cleanup`);

// pick one gold file and one crucifix (if any) and validate round-trip decrypt
const goldFile = s.files.find(f => /\.gold[1-5]$/.test(f));
if (goldFile) {
  const parsed = coins.readDroppedFile(goldFile);
  assert.ok(parsed && parsed.kind === 'gold' && parsed.coinId, 'gold file should decrypt');
  log(`decrypt round-trip OK for ${goldFile} (value ${parsed.value})`);
}

// tampered/foreign file must be rejected, not crash
const fakePath = goldFile ? goldFile.replace(/\.gold[1-5]$/, '.gold1') + '.fake.gold1' : null;
if (fakePath) {
  fs.writeFileSync(fakePath, Buffer.from('not a real coin'));
  const bad = coins.readDroppedFile(fakePath);
  assert.strictEqual(bad, null, 'corrupt file must be rejected, not throw');
  fs.unlinkSync(fakePath);
  log('corrupt/foreign file correctly rejected without throwing');
}

coins.deleteAllCoins();
const s2 = state.get();
assert.strictEqual(s2.files.length, 0, 'state should be empty after cleanup');
for (const f of s.files) assert.ok(!fs.existsSync(f), `file should have been deleted: ${f}`);
log('cleanup removed every tracked marker file');

// ---- normal mode: known top-level folders only (no subfolders), plus mid-attack batches ----
{
  const allowed = coins.targetFolders().map(d => path.resolve(d));
  // Put a tempting subfolder (and an app-bundle-like folder) in every allowed folder: coins must never go in.
  for (const d of allowed) {
    fs.mkdirSync(path.join(d, 'SubFolder'), { recursive: true });
    fs.mkdirSync(path.join(d, 'Photos Library.photoslibrary'), { recursive: true });
  }
  config.setMany({ UseDrawerMode: false, RansomAmount: 1000 }); config.save();  // target 1200: initial share (720) can never reach it
  const initial = coins.generateCoins();
  assert.ok(initial > 0);
  assert.ok(coins.midAttackRemaining(), 'some gold should still be pending for mid-attack spawning');
  const initialFiles = state.get().files.length;
  let batches = 0, guard = 0;
  while (coins.midAttackRemaining() && guard++ < 20) { coins.spawnMidAttackBatch(); batches++; }
  assert.ok(batches >= 1 && batches <= 5, 'mid-attack gold arrives in at most 5 batches, got ' + batches);
  assert.ok(coins.totalGenerated() >= 1200, `mid-attack batches should reach the planned total, got ${coins.totalGenerated()}`);
  assert.ok(state.get().files.length > initialFiles, 'mid-attack batches must add files');
  for (const f of state.get().files) {
    assert.ok(allowed.includes(path.resolve(path.dirname(f))), `coin outside the known top-level folders: ${f}`);
    assert.ok(!/SubFolder|photoslibrary/.test(f), `coin placed in a subfolder/bundle: ${f}`);
  }
  log(`normal mode: ${initial} gold at infection start + ${coins.totalGenerated() - initial} in ${batches} mid-attack batch(es), all directly inside ${allowed.length} known folder(s)`);
  coins.deleteAllCoins();
  assert.strictEqual(coins.totalGenerated(), 0);
  for (const d of allowed) { fs.rmdirSync(path.join(d, 'SubFolder')); fs.rmdirSync(path.join(d, 'Photos Library.photoslibrary')); }
  config.setMany({ RansomAmount: 100 }); config.save();
}

// ---- drawer mode: never touches real user folders ----
config.setMany({ UseDrawerMode: true, RansomAmount: 60 });
config.save();
const gold2 = coins.generateCoins();
assert.ok(gold2 > 0);
const drawerRoot = coins.drawerRoot();
assert.ok(fs.existsSync(drawerRoot), 'drawer root should exist');
const s3 = state.get();
for (const f of s3.files) assert.ok(f.startsWith(drawerRoot), `drawer-mode file escaped the drawer root: ${f}`);
log(`drawer mode generated ${gold2} gold, all files confined to ${drawerRoot}`);

coins.deleteAllCoins();
assert.ok(!fs.existsSync(drawerRoot), 'drawer root should be removed after cleanup');
log('drawer temp folder removed after cleanup');

// ---- real user folders were never touched outside what we tracked+cleaned ----
// Compare against the BEFORE snapshot so pre-existing OS files (desktop.ini, .localized, etc.)
// on a real machine or CI runner never fail this check; only files WE introduced and failed to
// clean up would.
for (const dir of Object.keys(before)) {
  const after = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const newFiles = after.filter(f => !before[dir].has(f));
  assert.strictEqual(newFiles.length, 0, `leftover files WE created in ${dir}: ${newFiles}`);
}
log('no leftover files introduced by this run in any user folder');

console.log('\ncore selftests passed, running wallpaper tests...');
// ---------------- wallpaper: capture -> change -> restore, per platform (fake OS commands) ----------------
(async () => {
  const wp = require('../src/main/wallpaper');
  const stateMod = require('../src/main/state');
  const os = require('os'), pth = require('path');
  const imgDir = fs.mkdtempSync(pth.join(os.tmpdir(), 'wp-'));

  // --- macOS fake: two desktops, System Events via osascript
  function fakeMac(desks, failCount) {
    const calls = [];
    const run = async (cmd, args) => {
      const script = args.filter((a, i) => args[i - 1] === '-e').join('\n');
      calls.push(script);
      if (/count desktops/.test(script)) return failCount ? { ok: false, out: '' } : { ok: true, out: String(desks.length) };
      let m;
      if ((m = /set p to picture of desktop (\d+)/.exec(script))) return { ok: true, out: desks[+m[1] - 1] };
      if ((m = /every desktop to set picture to "(.*)"/.exec(script))) { desks.fill(m[1]); return { ok: true, out: '' }; }
      if ((m = /set picture of desktop (\d+) to "(.*)"/.exec(script))) { desks[+m[1] - 1] = m[2]; return { ok: true, out: '' }; }
      return { ok: false, out: '' };
    };
    return { run, calls };
  }
  let desks = ['/Users/me/Pictures/a.jpg', '/System/Library/Desktop Pictures/b.heic'];
  const orig = desks.slice();
  let mac = fakeMac(desks, false);
  let mgr = wp.createWallpaperManager({ platform: 'darwin', run: mac.run, imageDir: imgDir });
  assert.strictEqual(await mgr.apply(), true);
  assert.ok(desks.every(d => /rans0m_darkred\.png$/.test(d)), 'macOS wallpaper should be the dark image while infected');
  assert.ok(stateMod.get().wallpaper, 'original must be persisted while applied');
  await mgr.restore();
  assert.deepStrictEqual(desks, orig, 'macOS: every desktop must be restored to its ORIGINAL wallpaper');
  assert.strictEqual(stateMod.get().wallpaper, null);
  log('macOS: original wallpaper restored for every desktop');

  // --- crash recovery: apply, "crash" (no restore), a brand new manager restores on next launch
  mac = fakeMac(desks, false);
  const crashed = wp.createWallpaperManager({ platform: 'darwin', run: mac.run, imageDir: imgDir });
  await crashed.apply();
  assert.ok(desks.every(d => /darkred/.test(d)));
  const afterRestart = wp.createWallpaperManager({ platform: 'darwin', run: mac.run, imageDir: imgDir });
  await afterRestart.restore();
  assert.deepStrictEqual(desks, orig, 'wallpaper must be restored after a crash on the next launch');
  log('crash recovery: original wallpaper restored by the next launch');

  // --- if the original can't be read we must NOT change anything
  const before = orig.slice();
  const bad = fakeMac(before, true);
  const badMgr = wp.createWallpaperManager({ platform: 'darwin', run: bad.run, imageDir: imgDir });
  assert.strictEqual(await badMgr.apply(), false);
  assert.deepStrictEqual(before, orig, 'unreadable original => wallpaper untouched');
  assert.ok(!bad.calls.some(c => /set picture/.test(c)), 'no set command may be issued when capture failed');
  log('unreadable original: wallpaper left completely untouched (in-app tint fallback)');

  // --- Windows fake: registry + SystemParametersInfo
  let winWall = 'C:\\Users\\me\\Pictures\\wall.jpg';
  const winRun = async (cmd, args, opts = {}) => {
    if (cmd === 'reg') return { ok: true, out: '\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    WallPaper    REG_SZ    ' + winWall + '\r\n' };
    if (cmd === 'powershell.exe') { winWall = opts.env.RANS0M_WP; return { ok: true, out: '1' }; }
    return { ok: false, out: '' };
  };
  mgr = wp.createWallpaperManager({ platform: 'win32', run: winRun, imageDir: imgDir });
  assert.strictEqual(await mgr.apply(), true);
  assert.ok(/rans0m_darkred\.bmp$/.test(winWall));
  await mgr.restore();
  assert.strictEqual(winWall, 'C:\\Users\\me\\Pictures\\wall.jpg');
  log('Windows: original wallpaper restored');

  // --- Linux GNOME fake
  process.env.XDG_CURRENT_DESKTOP = 'ubuntu:GNOME';
  const g = { 'picture-uri': "'file:///home/me/a.jpg'", 'picture-uri-dark': "'file:///home/me/a-dark.jpg'" };
  const gRun = async (cmd, args) => {
    if (cmd !== 'gsettings') return { ok: false, out: '' };
    if (args[0] === 'get') return { ok: true, out: g[args[2]] };
    if (args[0] === 'set') { g[args[2]] = args[3]; return { ok: true, out: '' }; }
    return { ok: false, out: '' };
  };
  const gOrig = Object.assign({}, g);
  mgr = wp.createWallpaperManager({ platform: 'linux', run: gRun, imageDir: imgDir });
  assert.strictEqual(await mgr.apply(), true);
  assert.ok(/darkred/.test(g['picture-uri']) && /darkred/.test(g['picture-uri-dark']));
  await mgr.restore();
  assert.deepStrictEqual(g, gOrig);
  log('Linux/GNOME: light and dark wallpaper both restored');

  // --- unsupported Linux desktop (e.g. KDE): never touched
  process.env.XDG_CURRENT_DESKTOP = 'KDE';
  const kdeCalls = [];
  mgr = wp.createWallpaperManager({ platform: 'linux', run: async (c, a) => { kdeCalls.push(c); return { ok: true, out: '' }; }, imageDir: imgDir });
  assert.strictEqual(await mgr.apply(), false);
  assert.strictEqual(kdeCalls.length, 0);
  log('unsupported desktop: wallpaper untouched');

  // --- generated images are valid
  assert.strictEqual(wp.solidPng(4, 4, 45, 0, 0).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.strictEqual(wp.solidBmp(4, 4, 45, 0, 0).subarray(0, 2).toString(), 'BM');
  log('generated wallpaper images are well-formed');

  console.log('\nALL SELFTESTS PASSED (incl. wallpaper restore)');
})().catch(e => { console.error(e); process.exit(1); });