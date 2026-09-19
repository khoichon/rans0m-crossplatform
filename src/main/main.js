'use strict';
const { app, BrowserWindow, screen, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const paths = require('./paths');
const log = require('./log');
const state = require('./state');
const config = require('./config');
const coins = require('./coins');
const { InputMonitor } = require('./input');
const wallpaper = require('./wallpaper');
const cursor = require('./cursor');
const death = require('./death');
const filetypes = require('./filetypes');
const tray = require('./tray');
const audio = require('./audio');

const TEST_MODE = process.argv.includes('--test');

// Original Global.GlitchIdle: every 200ms the notification has a ~2% chance to hop somewhere
// random AND spawn another taunt window. Raise this if you want more taunt windows.
const TAUNT_CHANCE_PER_TICK = 0.02;
const TAUNT_TITLES = ["RANS0M","MOSNAR","RANSOM","M0NARS","YOU ARE AN IDIOT","Untitled","Untitled (3)","I FOUND YOU","RANSOM.exe","RAANNNSSSSOOOOOMMMMMM","times up","GIVE MONEY","ERROR","DHAUFGH","_________","IMG.JPG"];

let overlayWin = null;
let notificationWin = null;
const tauntWindows = new Set();
let overlayAudio = null;
let inputMonitor = null;

async function runInputDiagnostics() {
  if (!inputMonitor) return;
  const h0 = inputMonitor.hookEvents, p0 = inputMonitor.pollEvents;
  dialog.showMessageBox({ type: 'info', title: 'RANS0M input test', message: 'Input test running', detail: 'Move the mouse, click, scroll and press keys (in ANY app) for the next 6 seconds.', buttons: ['Start'] }).catch(() => {});
  await delay(6500);
  const h = inputMonitor.hookEvents - h0, p = inputMonitor.pollEvents - p0;
  dialog.showMessageBox({ type: h > 0 ? 'info' : 'warning', title: 'RANS0M input test result', message: h > 0 ? 'Global input hook is working' : 'Global input hook received NOTHING',
    detail: `Global hook events: ${h}\nCursor-position changes: ${p}\nMode: ${inputMonitor.mode}\n\n` + (h > 0 ? '' : 'Keyboard/click/scroll detection is unavailable. Mouse movement is still detected via cursor polling. On macOS check Accessibility + Input Monitoring permissions; on Windows check for security software blocking hooks. See the log file in the app data folder.') }).catch(() => {});
}

// ---------------- Global run state (mirrors Global.cs) ----------------
const G = {
  underRansom: false,
  ransomLeft: 0,
  ransomTimeLeft: 0,
  canAttack: true,
  usedCoins: new Set(),
  crucifixUsed: false,
  spyingMouse: false,
  activityDuringSpy: false,
  onPaid: null,
  spawnCancel: null,
  layers: []
};

function hookDiagnostics(win, name) {
  win.webContents.on('console-message', (...args) => {
    const d = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] };
    const msg = String(d.message || '');
    const lvl = d.level;
    if (lvl === 'warning' || lvl === 'error' || lvl === 2 || lvl === 3 || msg.startsWith('[audio]')) log.info(`[${name}] ${msg}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log.warn(`[${name}] failed to load ${url}: ${desc} (${code})`));
}

let configWin = null;
function openConfigWindow() {
  if (configWin && !configWin.isDestroyed()) { configWin.show(); configWin.focus(); return configWin; }
  const win = createSmallWindow('config/config.html', 302, 525, {
    frame: true, title: 'RANS0M Configuration', transparent: false, show: true, resizable: false,
    useContentSize: true, minimizable: false, maximizable: false, closable: true, alwaysOnTop: false,
    backgroundColor: '#30005b'
  });
  win.setMenuBarVisibility(false);
  win.on('closed', () => { if (configWin === win) configWin = null; retriggerSpawnLoop(); });
  configWin = win;
  return win;
}

function screenSize() {
  const d = screen.getPrimaryDisplay();
  return { width: d.bounds.width, height: d.bounds.height };
}

function applyTestOverrides() {
  if (!TEST_MODE) { config.setOverrides({}); return; }
  config.setOverrides({
    MinSpawnDelay: 2, MaxSpawnDelay: 5, InfectionDuration: 20, RansomAmount: 30,
    CrashOnDeath: false, ExecCMDOnDeath: false // destructive actions forced off in test mode
  });
  log.info('Test mode active: fast spawns, low ransom, destructive actions forced off.');
}

// ---------------- Windows ----------------
function createOverlayWindow() {
  const { width, height } = screenSize();
  const win = new BrowserWindow({
    x: 0, y: 0, width, height,
    frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  hookDiagnostics(win, 'overlay');
  win.setIgnoreMouseEvents(true, { forward: true }); // click-through, like WS_EX_TRANSPARENT
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));

  // Keep shoving back to the front, like the original's topmost timer -- some platforms/WMs
  // let other windows steal the top spot from an always-on-top window over time.
  const keepOnTop = setInterval(() => { try { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } catch { /* window gone */ } }, 1000);
  win.on('closed', () => clearInterval(keepOnTop));
  return win;
}

function createSmallWindow(rel, w, h, opts = {}) {
  const win = new BrowserWindow(Object.assign({
    width: w, height: h, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' }
  }, opts));
  hookDiagnostics(win, rel.split('/')[0]);
  win.loadFile(path.join(__dirname, '..', 'renderer', rel));
  return win;
}

function randomPos(w, h) {
  const { width, height } = screenSize();
  return { x: Math.floor(Math.random() * Math.max(1, width - w)), y: Math.floor(Math.random() * Math.max(1, height - h)) };
}

// ---------------- Audio helper (see src/main/audio.js) ----------------
function playOnOverlay(rel, opts = {}) {
  if (!overlayAudio) return { stop() {} };
  return overlayAudio.play(rel, opts);
}
function playLayer(rel, opts) { const h = playOnOverlay(rel, opts); G.layers.push(h); return h; }

// ---------------- Cleanup ----------------
async function fullCleanup() {
  const t0 = Date.now(); const step = (n) => log.info(`cleanup: ${n} (+${Date.now() - t0}ms)`);
  try { coins.deleteAllCoins(); } catch (e) { log.warn('cleanup coins', e.message); }
  try { filetypes.unregisterAll(); } catch { /* ignore */ }
  try { cursor.restoreCursor(); overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.send('cursor:set', false); } catch { /* ignore */ }
  step('coins/cursor done');
  try { await wallpaper.restore(); } catch (e) { log.warn('cleanup wallpaper', e.message); }
  step('wallpaper done');
  try { inputMonitor && inputMonitor.stop(); } catch { /* ignore */ }
  step('input stopped');
}

function resetRansom() {
  coins.deleteAllCoins();
  G.canAttack = true; G.onPaid = null; G.underRansom = false; G.ransomLeft = 0;
  G.usedCoins.clear(); G.crucifixUsed = false;
  for (const h of G.layers) { try { h.stop(); } catch { /* ignore */ } }
  G.layers = [];
  for (const w of [...tauntWindows]) { try { w.destroy(); } catch { /* already closed */ } }
  tauntWindows.clear();
  if (notificationWin) { try { notificationWin.destroy(); } catch { /* ignore */ } notificationWin = null; }
  overlayWin && overlayWin.webContents.send('phase:reset');
  wallpaper.restore(); // async + serialized; restores the ORIGINAL wallpaper (see wallpaper.js)
  cursor.restoreCursor();
  overlayWin && overlayWin.webContents.send('cursor:set', false);
  overlayWin && overlayWin.webContents.send('phase:tint', false);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function interruptibleDelay(ms) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(); } }, ms);
    G.spawnCancel = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
  });
}
function retriggerSpawnLoop() { if (G.spawnCancel) G.spawnCancel(); }

// ---------------- RANSOM phases (ports Overlay.xaml.cs 1:1) ----------------
async function ransomWarning() {
  playOnOverlay('Sounds/spawn.wav');
  const { x, y } = randomPos(192, 192);
  overlayWin.webContents.send('phase:warning:show', x, y);

  await delay(500); // mouse/keyboard spy phase begins
  G.spyingMouse = true;
  G.activityDuringSpy = false;
  overlayWin.webContents.send('phase:warning:spy');

  await delay(500);
  G.spyingMouse = false;
  const moved = G.activityDuringSpy;
  log.info(`Spy phase over: activity detected = ${moved} (events this run: ${G.activityCount || 0})`);
  overlayWin.webContents.send('phase:warning:reveal', moved);
  await delay(moved ? 25 + 500 : 100 + 500); // wait for the CSS transition set in the renderer
  return moved;
}

async function downloadJumpscare() {
  playOnOverlay('Sounds/attack.wav');
  overlayWin.webContents.send('phase:attack:show');
  await delay(800);
  overlayWin.webContents.send('phase:attack:hide');

  playOnOverlay('Sounds/install.wav');
  overlayWin.webContents.send('phase:download:show');
  await delay(1200);
  overlayWin.webContents.send('phase:download:hide');
}

async function ransomedPhase(generatedGold) {
  wallpaper.apply().then(ok => { if (!ok && G.underRansom) overlayWin.webContents.send('phase:tint', true); });
  cursor.setInfectedCursor();
  overlayWin.webContents.send('cursor:set', true);
  overlayWin.webContents.send('phase:ransomed:flash');

  const layer1 = playLayer('Sounds/layer1.wav', { loop: true });
  const layer2Sound = () => playLayer('Sounds/layer2.wav', { loop: true });
  const layer3Sound = () => playLayer('Sounds/layer3.wav');

  G.ransomLeft = Math.min(config.get('RansomAmount'), generatedGold);
  G.underRansom = true;
  const duration = config.get('InfectionDuration');
  G.ransomTimeLeft = duration;

  let paidResolve;
  const paidPromise = new Promise(res => { paidResolve = res; });
  G.onPaid = () => { try { layer1.stop(); } catch { /* ignore */ } resetRansom(); paidResolve(true); };

  const npos = randomPos(560, 400);
  const nwin = createSmallWindow('notification/notification.html', 560, 400, {
    frame: true, title: 'RANS0M', transparent: false, backgroundColor: '#F82B1C', useContentSize: true,
    closable: false, minimizable: false, maximizable: false, x: npos.x, y: npos.y
  });
  notificationWin = nwin;
  nwin.setMenuBarVisibility(false);
  nwin.on('page-title-updated', e => e.preventDefault());
  nwin.on('close', e => { if (G.underRansom) e.preventDefault(); }); // can't be dismissed while ransomed
  nwin.on('closed', () => { if (notificationWin === nwin) notificationWin = null; });
  glitchIdle(nwin, true);

  for (let i = 0; i < 9; i++) spawnTaunt();

  const layer3Seconds = 26;
  const remaining = Math.max(0, duration - layer3Seconds);
  const layer1Seconds = Math.floor(remaining / 2);
  const layer2Seconds = remaining - layer1Seconds;
  let started2 = false, started3 = false, layer2 = null;

  let elapsed = 0;
  while (elapsed < duration) {
    const winner = await Promise.race([delay(1000).then(() => 'tick'), paidPromise.then(() => 'paid')]);
    if (winner === 'paid') return false;
    if (!G.underRansom) return false;

    elapsed++;
    G.ransomTimeLeft = Math.max(0, duration - elapsed);
    notificationWin && notificationWin.webContents.send('ransom:tick', G.ransomLeft, G.ransomTimeLeft);

    if (!started2 && elapsed >= layer1Seconds) { started2 = true; try { layer1.stop(); } catch { /* ignore */ } layer2 = layer2Sound(); }
    else if (started2 && !started3 && elapsed >= layer1Seconds + layer2Seconds) { started3 = true; try { layer2 && layer2.stop(); } catch { /* ignore */ } layer3Sound(); }
  }

  if (notificationWin) { try { notificationWin.destroy(); } catch { /* ignore */ } notificationWin = null; }
  overlayWin.webContents.send('phase:ransomed:end');
  return true; // timed out unpaid
}

async function crashJumpscare() {
  playOnOverlay('Sounds/attack.wav');
  overlayWin.webContents.send('phase:attack:crash');
  await delay(1000);
  overlayWin.webContents.send('phase:attack:hide');

  if (config.get('ExecCMDOnDeath')) death.runConfiguredCommand(config.get('CMDOnDeath'));
  if (config.get('CrashOnDeath')) death.crashOnDeath();

  resetRansom();
}

async function spawnRansom() {
  if (!G.canAttack) return;
  G.canAttack = false;

  const activity = await ransomWarning();
  if (activity) {
    let generatedGold = 0;
    try { generatedGold = coins.generateCoins(); } catch (e) { log.warn('generateCoins failed', e.message); }

    try {
      if (generatedGold <= 0) {
        await crashJumpscare();
      } else {
        await downloadJumpscare();
        const timedOut = await ransomedPhase(generatedGold);
        if (timedOut) { G.underRansom = false; await crashJumpscare(); }
      }
    } catch (e) { if (!app.isQuitting) { log.warn('spawnRansom phase error', e.message); resetRansom(); } }
  } else {
    resetRansom(); // user stayed still, dodged the ransom
  }
}

async function ransomLoop() {
  while (!app.isQuitting) {
    if (!config.get('SpawnAutomatically')) { await interruptibleDelay(250); continue; }
    const min = Math.min(config.get('MinSpawnDelay'), config.get('MaxSpawnDelay')) * 1000;
    const max = Math.max(config.get('MinSpawnDelay'), config.get('MaxSpawnDelay')) * 1000;
    await interruptibleDelay(min + Math.random() * Math.max(1, max - min));
    try { await spawnRansom(); } catch (e) { if (!app.isQuitting) log.warn('ransomLoop error', e.message); }
  }
}

function glitchIdle(win, divideAndTaunt) {
  let [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const t = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(t); return; }
    if (!G.underRansom) { clearInterval(t); try { win.destroy(); } catch { /* ignore */ } return; }
    if (divideAndTaunt && Math.random() < TAUNT_CHANCE_PER_TICK) {
      const p = randomPos(w, h); x = p.x; y = p.y;
      spawnTaunt();
    }
    try { win.setPosition(x + rand(-5, 5), y + rand(-5, 5)); } catch { /* ignore */ }
  }, 200);
  win.on('closed', () => clearInterval(t));
}

function spawnTaunt() {
  const w = rand(200, 400), h = rand(200, 400);
  const p = randomPos(w, h);
  const win = createSmallWindow('taunt/taunt.html', w, h, {
    frame: true, title: TAUNT_TITLES[rand(0, TAUNT_TITLES.length)], transparent: false, backgroundColor: '#320000',
    closable: false, minimizable: false, maximizable: false, show: false, x: p.x, y: p.y, useContentSize: true
  });
  win.setMenuBarVisibility(false);
  win.on('page-title-updated', e => e.preventDefault());
  win.once('ready-to-show', () => { try { win.showInactive(); } catch { /* ignore */ } });
  tauntWindows.add(win);
  win.on('closed', () => tauntWindows.delete(win));
  playOnOverlay('Sounds/tauntSpawn.wav');
  glitchIdle(win, false);

  const t = setTimeout(() => {
    if (win.isDestroyed()) return;
    playOnOverlay('Sounds/tauntLeave.wav');
    try { win.destroy(); } catch { /* ignore */ }
  }, rand(4000, 10000));
  win.on('closed', () => clearTimeout(t));
}
function rand(a, b) { return Math.floor(Math.random() * (b - a)) + a; }

// ---------------- IPC ----------------
ipcMain.handle('asset:path', (_e, parts) => paths.asset(...parts));
ipcMain.handle('asset:url', (_e, parts) => pathToFileURL(paths.asset(...parts)).href);
ipcMain.handle('config:get', () => Object.assign(config.all(), { platform: process.platform }));
ipcMain.on('config:set', (_e, values) => { config.setMany(values); config.save(); retriggerSpawnLoop(); });
ipcMain.on('config:spawnNow', () => { spawnRansom(); retriggerSpawnLoop(); });
ipcMain.on('window:close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !w.isDestroyed()) w.close(); });
ipcMain.on('window:closeAfter', (e, ms) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) setTimeout(() => { try { w.close(); } catch { /* ignore */ } }, ms); });

ipcMain.on('notification:drop', (_e, filePaths) => {
  let sfxPlayed = false;
  for (const f of filePaths) {
    const parsed = coins.readDroppedFile(f);
    if (!parsed) continue;
    if (G.usedCoins.has(parsed.coinId)) continue; // no replaying the same coin
    G.usedCoins.add(parsed.coinId);
    try { require('fs').unlinkSync(parsed.filePath); } catch { /* ignore */ }

    if (parsed.kind === 'gold') {
      if (!sfxPlayed) { playOnOverlay('Sounds/cash.wav'); sfxPlayed = true; }
      G.ransomLeft -= parsed.value;
    } else if (parsed.kind === 'crucifix') {
      G.crucifixUsed = true;
      G.ransomLeft = 0;
    }
  }
  if (G.ransomLeft <= 0) {
    G.underRansom = false;
    const npos = notificationWin ? notificationWin.getPosition() : [0, 0];
    if (G.crucifixUsed) {
      const win = createSmallWindow('crucifix/crucifix.html', 560, 400, { transparent: true, frame: false });
      win.setPosition(npos[0], npos[1]);
    } else {
      const win = createSmallWindow('thankyou/thankyou.html', 560, 350, { transparent: false });
      win.setPosition(npos[0], npos[1]);
    }
    if (notificationWin) { try { notificationWin.destroy(); } catch { /* ignore */ } notificationWin = null; }
    if (G.onPaid) G.onPaid();
  } else if (notificationWin) {
    notificationWin.webContents.send('ransom:tick', G.ransomLeft, G.ransomTimeLeft);
  }
});

// ---------------- App lifecycle ----------------
app.on('ready', async () => {
  log.init();
  applyTestOverrides();
  config.load();

  overlayWin = createOverlayWindow();
  overlayAudio = audio.forWindow(overlayWin);

  filetypes.registerAll();

  const input = new InputMonitor();
  input.on('mode', (mode, message) => {
    if (!message) return;
    log.warn(`Input monitoring: ${mode} \u2014 ${message}`);
    dialog.showMessageBox({ type: 'warning', title: 'RANS0M \u2014 limited input detection', message: 'Limited input detection', detail: message, buttons: ['OK'] }).catch(() => {});
  });
  input.on('permission-missing', () => {
    dialog.showMessageBox({
      type: 'warning', title: 'RANS0M needs permission',
      message: 'Allow RANS0M to monitor keyboard and mouse',
      detail: 'RANS0M only checks WHETHER you pressed/moved something (it never records what). Enable RANS0M (or the app you launched it from, e.g. Terminal) under Privacy & Security \u2192 Accessibility and Input Monitoring, then relaunch.',
      buttons: ['Open Accessibility Settings', 'Open Input Monitoring Settings', 'Later'], defaultId: 0
    }).then(r => {
      if (r.response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      if (r.response === 1) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
    }).catch(() => {});
  });
  ipcMain.on('input:focusedActivity', () => input.reportFocusedActivity());
  inputMonitor = input;
  input.on('activity', () => { G.activityCount = (G.activityCount || 0) + 1; if (G.spyingMouse) G.activityDuringSpy = true; });
  const started = await input.start();
  log.info(`Input monitor start() -> ${started}, mode=${input.mode}`);

  tray.create({
    onConfig: () => { openConfigWindow(); },
    onSpawn: () => { spawnRansom(); retriggerSpawnLoop(); },
    onDiag: () => runInputDiagnostics(),
    onClose: () => { app.isQuitting = true; app.quit(); },
    isRansomActive: () => G.underRansom
  });

  if (!config.exists()) {
    const cfgWin = openConfigWindow();
    await new Promise(res => cfgWin.on('closed', res));
  }

  resetRansom();
  ransomLoop();

  log.info(`RANS0M started on ${process.platform} (test mode: ${TEST_MODE})`);
});

let quitCleanupDone = false, quitCleanupStarted = false;
app.on('will-quit', () => log.info('event: will-quit'));
app.on('quit', () => log.info('event: quit'));
app.on('before-quit', (e) => {
  log.info(`event: before-quit (cleanupDone=${quitCleanupDone})`);
  app.isQuitting = true;
  if (quitCleanupDone) return;
  e.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  retriggerSpawnLoop();
  Promise.race([fullCleanup(), delay(10000)]).finally(() => {
    quitCleanupDone = true;
    tray.destroy();
    // Cleanup is finished, so tear every window down explicitly (some are frameless/non-closable
    // by design and would otherwise stall a normal quit) and exit.
    for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch { /* ignore */ } }
    app.quit();
  });
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit());
process.on('uncaughtException', (err) => { log.error('uncaughtException', err); wallpaper.restore(); });
app.on('window-all-closed', () => { /* keep running: tray-driven app, like the original */ });
