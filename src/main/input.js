'use strict';
// Global input monitoring.
//
// "Movement" here means any mouse or keyboard ACTIVITY, not just cursor position changing:
// key down/up, mouse move, any mouse button down/up, and wheel/scroll all count. We never
// record what was pressed or where; only "an input event happened" is used, via a single
// `emitActivity()` call from every listener below.
//
// Windows / macOS / Linux-X11: uiohook-napi gives real global hooks (works even when the
// RANS0M window isn't focused), covering all of the above.
// Linux/Wayland: there is no portable, permission-free way to get global input under the
// current Wayland security model (GNOME/KDE compositors don't expose one to unprivileged
// apps, and libinput needs root/`input`-group access we deliberately don't ask for). In that
// case we fall back to input seen only while a RANS0M window has focus, and report the
// degraded mode so the UI can tell the user.
const os = require('os');
const log = require('./log');

const EventEmitter = require('events');

class InputMonitor extends EventEmitter {
  constructor() {
    super();
    this.mode = 'none';       // 'global' | 'focused-only' | 'none'
    this._uiohook = null;
    this._permissionState = 'unknown'; // 'granted' | 'denied' | 'unknown' (mainly for macOS)
    this.hookEvents = 0;      // events delivered by the global hook
    this.pollEvents = 0;      // cursor-position changes seen by the supplementary poller
    this._poll = null;
    this._lastPos = null;
  }

  /**
   * Supplementary detector, NOT the sole mechanism: watches the pointer position with the OS's
   * plain cursor-position query (no permissions needed on Windows/macOS). It guarantees mouse
   * movement still counts if the global hook is blocked or silently delivers nothing.
   */
  _startPoll() {
    try {
      const { screen } = require('electron');
      this._lastPos = screen.getCursorScreenPoint();
      this._poll = setInterval(() => {
        try {
          const p = screen.getCursorScreenPoint();
          if (!this._lastPos || p.x !== this._lastPos.x || p.y !== this._lastPos.y) { this._lastPos = p; this.pollEvents++; this._activity(); }
        } catch { /* ignore */ }
      }, 16);
    } catch (e) { log.warn('cursor poll unavailable', e.message); }
  }

  /** Try global hooks first; caller falls back to focused-window listening on failure. */
  async start() {
    this._startPoll();

    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = require('electron');
        const trusted = systemPreferences.isTrustedAccessibilityClient(false);
        this._permissionState = trusted ? 'granted' : 'denied';
        if (!trusted) {
          systemPreferences.isTrustedAccessibilityClient(true); // triggers the system prompt once
          this.emit('permission-missing');
          log.warn('macOS Accessibility permission not granted: global keyboard/mouse hook will not receive events.');
        }
      } catch (e) { log.warn('macOS permission check failed', e.message); }
    }
    if (process.platform === 'linux' && isLikelyWayland()) {
      log.warn('Wayland session detected: global input monitoring is not available; falling back to focused-window input only.');
      this.mode = 'focused-only';
      this.emit('mode', this.mode, 'Wayland does not allow apps to watch input globally without root/input-group access. RANS0M will only see input while its own window is focused.');
      return false;
    }

    try {
      if (process.env.RANS0M_NO_HOOK) throw new Error('hook disabled by RANS0M_NO_HOOK (debug)');
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      this._uiohook = uIOhook;
      this._UiohookKey = UiohookKey;

      uIOhook.on('keydown', () => { this.hookEvents++; this._activity(); });
      uIOhook.on('keyup', () => { this.hookEvents++; this._activity(); });
      uIOhook.on('mousemove', () => { this.hookEvents++; this._activity(); });
      uIOhook.on('mousedown', () => { this.hookEvents++; this._activity(); });
      uIOhook.on('mouseup', () => { this.hookEvents++; this._activity(); });
      uIOhook.on('wheel', () => { this.hookEvents++; this._activity(); });

      uIOhook.start();
      this.mode = this._permissionState === 'denied' ? 'focused-only' : 'global';
      this.emit('mode', this.mode, this._permissionState === 'denied'
        ? 'macOS Accessibility/Input Monitoring permission is missing, so keyboard and clicks are NOT detected globally (mouse movement still is). Grant it in System Settings \u2192 Privacy & Security, then relaunch.'
        : null);
      return true;
    } catch (e) {
      log.warn('Global input hook unavailable, falling back to focused-window input only:', e.message);
      const macPermission = process.platform === 'darwin';
      this._permissionState = macPermission ? 'denied' : 'unknown';
      this.mode = 'focused-only';
      this.emit('mode', this.mode, macPermission
        ? 'macOS is blocking global input monitoring. Grant RANS0M access under System Settings \u2192 Privacy & Security \u2192 Accessibility (and Input Monitoring), then relaunch.'
        : 'Global input monitoring failed to start; RANS0M will only see input while its own window is focused.');
      return false;
    }
  }

  /** Called by the renderer/window layer for keydown/mousemove/etc. it receives while focused. */
  reportFocusedActivity() { if (this.mode === 'focused-only') this._activity(); }

  _activity() { this.emit('activity'); }

  stop() {
    if (this._poll) { clearInterval(this._poll); this._poll = null; }
    try { if (this._uiohook) this._uiohook.stop(); } catch { /* ignore */ }
    this._uiohook = null;
    this.mode = 'none';
  }
}

function isLikelyWayland() {
  return !!(process.env.WAYLAND_DISPLAY || (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland');
}

module.exports = { InputMonitor, isLikelyWayland };
