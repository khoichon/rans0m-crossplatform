'use strict';
// Desktop wallpaper effect ("dark red" while infected).
//
// Safety rules (this used to leave the wallpaper stuck dark):
//  1. We only change the wallpaper if we could FIRST read the current one. If we can't, we
//     don't touch it and the caller shows an in-app red tint instead.
//  2. The original is written to state.json BEFORE we change anything, so it survives a crash
//     and is restored on the next launch.
//  3. restore() runs on every exit path: paid, timed out, dodged, app quit, crash recovery.
//  4. apply()/restore() are serialized so they can never interleave.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const paths = require('./paths');
const state = require('./state');
const log = require('./log');

function defaultRun(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: Object.assign({}, process.env, opts.env || {})
    }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '').trim(), err: err ? err.message : null }));
  });
}

// ---------- tiny solid-colour image writers (no dependencies) ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function solidPng(w, h, r, g, b) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
function solidBmp(w, h, r, g, b) { // 24-bit, Windows' SystemParametersInfo is happiest with BMP
  const rowSize = (w * 3 + 3) & ~3, size = 54 + rowSize * h;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(rowSize * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 54 + y * rowSize + x * 3; buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
  }
  return buf;
}
const DARK_RED = [45, 0, 0];
function makeImage(platform, dir) {
  const file = path.join(dir, platform === 'win32' ? 'rans0m_darkred.bmp' : 'rans0m_darkred.png');
  fs.writeFileSync(file, platform === 'win32' ? solidBmp(64, 64, ...DARK_RED) : solidPng(64, 64, ...DARK_RED));
  return file;
}

// ---------- per-OS backends: capture() -> object|null, set(), restore() ----------
const asq = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); // AppleScript string escape

const darwin = {
  async capture(run) {
    const c = await run('osascript', ['-e', 'tell application "System Events" to count desktops']);
    const n = parseInt(c.out, 10);
    if (!c.ok || !(n >= 1)) return null;
    const pics = [];
    for (let i = 1; i <= n; i++) {
      const r = await run('osascript', [
        '-e', `tell application "System Events" to set p to picture of desktop ${i}`,
        '-e', 'set t to p as text',
        '-e', 'if t starts with "/" then return t',
        '-e', 'return POSIX path of (t as alias)']);
      if (!r.ok || !r.out.startsWith('/')) return null; // can't read it -> don't touch it
      pics.push(r.out);
    }
    return { pics };
  },
  async set(run, img) {
    const r = await run('osascript', ['-e', `tell application "System Events" to tell every desktop to set picture to "${asq(img)}"`]);
    return r.ok;
  },
  async restore(run, cap) {
    let ok = true;
    for (let i = 0; i < cap.pics.length; i++) {
      const r = await run('osascript', ['-e', `tell application "System Events" to set picture of desktop ${i + 1} to "${asq(cap.pics[i])}"`]);
      ok = ok && r.ok;
    }
    return ok;
  }
};

const SPI_SCRIPT = "Add-Type -MemberDefinition '[DllImport(\"user32.dll\",CharSet=CharSet.Unicode)] public static extern int SystemParametersInfo(int a,int b,string c,int d);' -Name W -Namespace R0; [R0.W]::SystemParametersInfo(20,0,$env:RANS0M_WP,3)";
const win32 = {
  async capture(run) {
    const r = await run('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper']);
    if (!r.ok) return null;
    const m = /WallPaper\s+REG_SZ\s*(.*)$/mi.exec(r.out);
    return m ? { file: m[1].trim() } : null; // '' = no wallpaper (solid colour) is a valid original
  },
  async set(run, img) {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SPI_SCRIPT], { env: { RANS0M_WP: img } });
    return r.ok;
  },
  async restore(run, cap) {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SPI_SCRIPT], { env: { RANS0M_WP: cap.file } });
    return r.ok;
  }
};

const GSETTINGS = [
  { match: /gnome|unity|budgie|pop|ubuntu|deepin|zorin/, schema: 'org.gnome.desktop.background', set: ['picture-uri', 'picture-uri-dark'], keep: ['picture-uri', 'picture-uri-dark'] },
  { match: /cinnamon/, schema: 'org.cinnamon.desktop.background', set: ['picture-uri'], keep: ['picture-uri'] },
  { match: /mate/, schema: 'org.mate.background', set: ['picture-filename'], keep: ['picture-filename'], plainPath: true }
];
function linuxDesktop() { return (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase(); }

const linux = {
  async capture(run) {
    const de = linuxDesktop();
    const gs = GSETTINGS.find(g => g.match.test(de));
    if (gs) {
      const vals = {};
      for (const k of gs.keep) {
        const r = await run('gsettings', ['get', gs.schema, k]);
        if (!r.ok) { if (k === gs.keep[0]) return null; continue; } // -dark key may not exist
        vals[k] = r.out;
      }
      return { kind: 'gsettings', schema: gs.schema, vals, set: gs.set, plainPath: !!gs.plainPath };
    }
    if (/xfce/.test(de)) {
      const l = await run('xfconf-query', ['-c', 'xfce4-desktop', '-l']);
      if (!l.ok) return null;
      const props = l.out.split('\n').filter(p => /\/last-image$/.test(p));
      if (!props.length) return null;
      const vals = {};
      for (const p of props) { const r = await run('xfconf-query', ['-c', 'xfce4-desktop', '-p', p]); if (!r.ok) return null; vals[p] = r.out; }
      return { kind: 'xfce', vals };
    }
    return null; // KDE etc: can't read/restore reliably -> don't touch, use the in-app tint
  },
  async set(run, img, cap) {
    if (cap.kind === 'gsettings') {
      let ok = true;
      for (const k of cap.set) if (k in cap.vals) {
        const val = cap.plainPath ? `'${img}'` : `'file://${img}'`;
        ok = (await run('gsettings', ['set', cap.schema, k, val])).ok && ok;
      }
      return ok;
    }
    let ok = true;
    for (const p of Object.keys(cap.vals)) ok = (await run('xfconf-query', ['-c', 'xfce4-desktop', '-p', p, '-s', img])).ok && ok;
    return ok;
  },
  async restore(run, cap) {
    let ok = true;
    if (cap.kind === 'gsettings') {
      for (const k of Object.keys(cap.vals)) ok = (await run('gsettings', ['set', cap.schema, k, cap.vals[k]])).ok && ok;
    } else {
      for (const p of Object.keys(cap.vals)) ok = (await run('xfconf-query', ['-c', 'xfce4-desktop', '-p', p, '-s', cap.vals[p]])).ok && ok;
    }
    return ok;
  }
};

const BACKENDS = { darwin, win32, linux };

function createWallpaperManager({ platform = process.platform, run = defaultRun, imageDir } = {}) {
  let chain = Promise.resolve();
  let applied = false;
  const enqueue = fn => (chain = chain.then(fn, fn));
  const dir = () => imageDir || paths.dataDir();

  function apply() {
    return enqueue(async () => {
      if (applied) return true;
      const be = BACKENDS[platform];
      if (!be) return false;
      try {
        if (state.get().wallpaper) await doRestore(); // leftover from a crash: put that back first
        const cap = await be.capture(run);
        if (!cap) { log.warn('Wallpaper: could not read the current wallpaper, leaving it alone (in-app tint used instead).'); return false; }
        state.patch({ wallpaper: { platform, cap } }); // persist BEFORE changing anything
        const ok = await be.set(run, makeImage(platform, dir()), cap);
        if (!ok) { log.warn('Wallpaper: setting failed, restoring.'); await doRestore(); return false; }
        applied = true;
        return true;
      } catch (e) { log.warn('Wallpaper apply error', e.message); try { await doRestore(); } catch { /* ignore */ } return false; }
    });
  }

  async function doRestore() {
    const saved = state.get().wallpaper;
    if (!saved) { applied = false; return true; }
    const be = BACKENDS[saved.platform];
    let ok = false;
    try { ok = be ? await be.restore(run, saved.cap) : true; } catch (e) { log.warn('Wallpaper restore error', e.message); }
    if (ok) {
      state.patch({ wallpaper: null }); applied = false;
      for (const f of ['rans0m_darkred.bmp', 'rans0m_darkred.png']) { try { fs.unlinkSync(path.join(dir(), f)); } catch { /* ignore */ } }
    } else {
      log.warn('Wallpaper restore failed; the original is kept in state.json and retried on next launch.');
    }
    return ok;
  }
  const restore = () => enqueue(doRestore);

  return { apply, restore, isApplied: () => applied };
}

const manager = createWallpaperManager();
module.exports = Object.assign({ createWallpaperManager, solidPng, solidBmp }, manager);
