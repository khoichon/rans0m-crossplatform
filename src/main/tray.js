'use strict';
const { Tray, Menu, nativeImage } = require('electron');
const paths = require('./paths');

let tray = null;

function create({ onConfig, onSpawn, onDiag, onClose, isRansomActive }) {
  const icon = nativeImage.createFromPath(paths.asset('CD-1.png')).resize({ width: 32, height: 32 });
  tray = new Tray(icon.isEmpty() ? paths.asset('CD-1.png') : icon);
  tray.setToolTip('RANS0M');
  refresh({ onConfig, onSpawn, onDiag, onClose, isRansomActive });
  return tray;
}

function refresh({ onConfig, onSpawn, onDiag, onClose, isRansomActive }) {
  if (!tray) return;
  const active = isRansomActive();
  const menu = Menu.buildFromTemplate([
    { label: 'Configuration', click: onConfig },
    { label: 'Spawn now (test)', click: onSpawn },
    { label: 'Test input detection', click: onDiag },
    { type: 'separator' },
    // Disabled during an active ransom so it can't be dodged from the tray, same as the original.
    { label: 'Close', enabled: !active, click: onClose }
  ]);
  tray.setContextMenu(menu);
}

function destroy() { try { tray && tray.destroy(); } catch { /* ignore */ } tray = null; }

module.exports = { create, refresh, destroy };
