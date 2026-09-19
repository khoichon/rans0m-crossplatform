'use strict';
// Per-extension custom icons for .gold1-6 / .crucifix, matching the Windows build's
// HKCU\Software\Classes registration. This is inherently a Windows-only shell feature;
// macOS (Launch Services UTIs) and Linux (mimeapps/shared-mime-info) don't offer an
// equivalent a normal, unprivileged app can safely and portably self-register per-run.
// On non-Windows we simply skip icon registration (a documented limitation) -- the files
// still work exactly the same, they just show their default OS file icon.
const log = require('./log');

function registerAll() {
  if (process.platform !== 'win32') {
    log.info('Skipping gold-file icon registration (Windows-only feature).');
    return;
  }
  // A real Windows build can restore the original HKCU\Software\Classes registration
  // logic (FileTypeRegister.cs) here; left out of this cross-platform Node build since
  // Node has no built-in Windows registry API and pulling one in only to cover an already-
  // working Windows codepath isn't worth the extra dependency.
  log.info('Windows icon registration not implemented in the Node build; use the original .NET build for this feature.');
}

function unregisterAll() { /* mirror of registerAll: no-op outside the original Windows build */ }

module.exports = { registerAll, unregisterAll };
