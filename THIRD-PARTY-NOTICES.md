# Third-party notices

RANS0M itself (original project by **Ixar**, plus the cross-platform port) is under the
**RANS0M Educational & Non-Commercial License (RENC-1.0)** — see `LICENSE.md`. The components
below are separate works under their own licenses. Full license texts are in `licenses/`.

## Runtime components shipped inside the app

### Electron — MIT
Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.
https://www.electronjs.org/ · License: `licenses/electron-MIT.txt`

Electron builds also bundle Chromium and Node.js and their dependencies. Their license
notices are included with every packaged build as `LICENSE.electron.txt` and
`LICENSES.chromium.html` (next to the executable).

### uiohook-napi — MIT
Copyright (c) 2020 Alexander Drozdov
https://github.com/SnosMe/uiohook-napi · License: `licenses/uiohook-napi-MIT.txt`

Node.js bindings used for global mouse/keyboard *activity* detection (RANS0M only checks
whether an input event happened; it never reads or records what was pressed).

### libuiohook — GNU LGPL v3 or later
Copyright (C) 2006-2023 Alexander Barker. All Rights Reserved.
https://github.com/kwhat/libuiohook

libuiohook is compiled into the prebuilt native module shipped with `uiohook-napi`
(`node_modules/uiohook-napi/prebuilds/<platform>-<arch>/*.node`). It is licensed under the
GNU Lesser General Public License, version 3 or (at your option) any later version.
License texts: `licenses/libuiohook-LGPL-3.0.md` and `licenses/libuiohook-GPL-3.0.md`
(the LGPL is a set of additional permissions on top of the GPL).

Your rights under the LGPL, as they apply here:
- The library is used **unmodified** and is a **separate, dynamically loaded file** (a `.node`
  shared module, stored unpacked next to the app archive: `app.asar.unpacked/node_modules/
  uiohook-napi/`), not statically merged into RANS0M's own code.
- You may replace it with your own build of libuiohook/uiohook-napi. Complete corresponding
  source: https://github.com/kwhat/libuiohook and https://github.com/SnosMe/uiohook-napi
  (the exact versions are pinned in `package-lock.json`).
- Nothing in RENC-1.0 restricts the rights the LGPL gives you over libuiohook itself.

## Build-time tools (not shipped in the app)
electron-builder (MIT) is used to package the app.

## Original assets
Images and sounds come from the original RANS0M project by Ixar and, through it, from
*Doors* by **LSPLASH** and its community wiki. They are **not** covered by the licenses above;
see `LICENSE.md` (RENC-1.0, sections 3 and 5) and the Credits in the README.
