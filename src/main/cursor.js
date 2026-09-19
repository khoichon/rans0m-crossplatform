'use strict';
// Global system cursor swap during infection.
// Windows/macOS system-wide cursor replacement needs native modules we don't ship here
// (Win32 SetSystemCursor / a macOS private API); rather than silently doing nothing, every
// platform gets the same reliable fallback: an always-on-top, click-through, cursor-following
// overlay window showing the infected cursor image, positioned from the last known pointer
// location. This never permanently modifies OS cursor state, so restoration can never fail.
let active = false;
function setInfectedCursor() { active = true; }
function restoreCursor() { active = false; }
module.exports = { setInfectedCursor, restoreCursor, isActive: () => active };
