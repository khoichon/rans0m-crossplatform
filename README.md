# RANS0M — cross-platform port (Windows / macOS / Linux)

This is an **unofficial cross-platform port** of [Ixar's RANS0M](https://github.com/Ixars/ransomdoors),
a fan-made recreation of the RANSOM (A-90) entity from the Roblox game *Doors*. The original
is a Windows-only WPF/.NET app; this port reimplements the same game — mechanics, assets,
configuration, credits — as an Electron app so it also runs on macOS and Linux.

**This is not the original repository.** It's a from-scratch reimplementation in JavaScript
that follows the original C# source line-by-line for behavior, using the original's own
assets and `config.json` schema, so a config file is interchangeable between the two.

## What it does (same as the original)

RANS0M randomly pops the entity's face on your screen. You have to stop moving your mouse
and stay off the keyboard, or it "infects" your PC: coin files worth gold get scattered
around your user folders (or into a safe temp "drawer" — see Configuration), and you have
to drag enough of them onto the ransom window before the timer runs out. Fail to pay in
time and — only if you've explicitly turned it on — it can run a command or shut your
computer down.

## Read this before running it

By default this build **never** shuts down your computer or runs any command; those are
off unless you enable them yourself in Configuration ("Death Consequences"). If you do
turn them on:

- Only run it on a machine you own, save your work first.
- Don't run it on anyone else's computer without them knowing exactly what it does and
  agreeing to it.

It doesn't touch anything on disk besides its own `.gold1`–`.gold6`/`.crucifix` marker
files (or, in Drawer mode, a single temp folder it creates and later deletes). Everything
it creates is tracked and removed on payment, timeout, or app exit — see
[Known limitations](#known-limitations) for the one case where wallpaper restoration can't
be 100% guaranteed on macOS.

## Platform support

| Feature | Windows | macOS | Linux (X11) | Linux (Wayland) |
|---|---|---|---|---|
| Spawning, coins, drag-to-pay, config | ✅ | ✅ | ✅ | ✅ |
| Global mouse/keyboard detection (even when unfocused) | ✅ | ✅ (needs permission) | ✅ | ❌ see below |
| System-tray icon | ✅ | ✅ | ✅ (needs a tray-capable DE) | ✅ (needs a tray-capable DE) |
| Desktop wallpaper effect | ✅ (native) | ✅ (AppleScript) | ✅ GNOME/`feh`, else skipped | same as X11 |
| System-wide cursor swap | overlay fallback* | overlay fallback* | overlay fallback* | overlay fallback* |
| Per-extension gold-file icons | ✅ (original build only) | ❌ not supported by the OS | ❌ not supported by the OS | ❌ |
| "Crash on death" (opt-in) | shutdown | AppleScript shutdown | `systemctl poweroff` | same as X11 |

\* This build implements the cursor effect as an always-on-top, click-through overlay image
that follows the pointer, on every OS, rather than swapping the real OS cursor (see
[Known limitations](#known-limitations)).

## Installation

```
git clone <this-repo>
cd crossplatform
npm install
```

## Running

```
npm start            # normal run
npm run start:test   # test mode: fast spawns, low ransom, Drawer mode encouraged, destructive actions forced off
```

The app runs from a tray icon. Right-click it for **Configuration** or **Close** (Close is
disabled while a ransom is active, same as the original, so it can't be dodged from the tray).

## Building standalone executables

`electron-builder` produces self-contained packages (no Node/Electron install needed by the end user). Build on the OS you are targeting (macOS builds need macOS):

```
npm run dist:win     # Windows: RANS0M-Portable-*.exe (single-file, no install) + RANS0M-Setup-*.exe (installer)
npm run dist:mac     # macOS: .dmg + .zip (contains RANS0M.app), x64 and arm64
npm run dist:linux   # Linux: .AppImage (single file, chmod +x and run) + .tar.gz
```

Output goes to `dist/`. Builds are **unsigned**:
- Windows: SmartScreen may warn ("More info" → "Run anyway").
- macOS: Gatekeeper may block it. Right-click the app → Open, or run `xattr -cr RANS0M.app`.
- Linux: `chmod +x RANS0M-*.AppImage && ./RANS0M-*.AppImage`.

## Automated builds (GitHub Actions)

`.github/workflows/build-crossplatform.yml` builds Windows, macOS and Linux in parallel on every push, pull request, `v*` tag, or manual run (Actions → *Build RANS0M (all platforms)* → Run workflow). It uploads one artifact per platform, then a final job bundles everything plus `SHA256SUMS.txt` into **`RANS0M-all-platforms.zip`**, published as the `RANS0M-all-platforms` workflow artifact. Note: GitHub always wraps an artifact download in a zip, so the artifact you download contains that zip.

## Configuration

Same keys as the original `config.json`, stored in the app's per-user data directory
(`Configuration` button in the tray, or edit the file directly):

- `SpawnAutomatically`, `MinSpawnDelay`, `MaxSpawnDelay` — how often RANSOM can show up.
- `InfectionDuration` — seconds to pay once infected.
- `RansomAmount` — gold needed to pay.
- `UseDrawerMode` — see below.
- `CrashOnDeath`, `ExecCMDOnDeath`, `CMDOnDeath` — **off by default, explicitly opt-in,
  potentially destructive.**

## Drawer mode

A safe mode for testing/development: instead of scattering files into your real Desktop/
Documents/etc., it builds a throwaway folder tree under your OS temp directory and puts the
coins there instead. It's deleted completely on cleanup. Recommended while developing or if
you just want to try the app without touching your real folders.

## macOS permissions

For RANS0M to detect mouse/keyboard input **while its window isn't focused** (so it can
catch you tabbing away during the "hold still" phase), macOS requires you to grant it:

- **System Settings → Privacy & Security → Accessibility**
- **System Settings → Privacy & Security → Input Monitoring**

The first infection also makes macOS ask whether RANS0M may control **System Events** (needed to change and restore the wallpaper). If you decline, the wallpaper is left alone and an in-app tint is used instead.

If you don't grant the input permissions, the app still works, but it can only see input while its own
window has focus — see [Known limitations](#known-limitations).

## Linux limitations

- **X11**: global input monitoring works normally.
- **Wayland**: there is no portable, unprivileged way for an app to watch input globally
  under the current compositor security model (GNOME/KDE included). Rather than requiring
  root or `input`-group access (which this app deliberately never asks for), it falls back
  to detecting input only while its own window is focused, and logs a warning explaining
  this. If your compositor's Wayland session sets `WAYLAND_DISPLAY`, you'll see this
  fallback automatically.
- **Tray icon**: depends on your desktop environment providing a `StatusNotifierItem`/tray
  host; some minimal window managers don't.

## Known limitations

- **System cursor swap**: the original replaces the actual Windows cursor
  (`SetSystemCursor`). Doing that on macOS/Linux would need native, less-portable APIs for
  comparatively small visual payoff, so this port uses a cursor-following overlay image
  instead everywhere, including Windows. This is a deliberate simplification, not a bug.
- **Per-extension file icons** (`.gold1`–`.gold6`, `.crucifix` getting a custom icon in the
  file manager): this was a Windows registry trick in the original; macOS/Linux don't offer
  an equivalent an unprivileged app can safely self-register. Skipped on those platforms.
- **Wallpaper effect**: the app reads your current wallpaper first, saves it to `state.json`, swaps in a dark-red image, and puts the original back when the ransom is paid, expires, is dodged, on quit, and on the next launch after a crash. If it can't read your current wallpaper (or your Linux desktop isn't supported: only GNOME-family, Cinnamon, MATE and XFCE are), it changes nothing and shows a mild dark-red tint inside the app instead. Windows slideshow wallpapers are restored as a single static image; macOS dynamic wallpapers are restored to their underlying image file.
- **Fullscreen overlay**: like the original, the "always on top" overlay may not be able to
  draw over another app's genuine fullscreen/exclusive surface, depending on OS/window
  manager.
- **This wasn't tested by the assistant that wrote it** — no GUI/Electron runtime was
  available in the environment it was built in. The non-UI core (config, coin generation,
  drop validation, cleanup) was exercised with `npm test` (see `scripts/selftest.js`) and
  passes, including a check that no files are left behind in any user folder. The Electron
  UI, tray, real global-input hooks, wallpaper/cursor effects, and all three OSes need to be
  verified by a human on real hardware before this is trusted as "done."

## Input detection & troubleshooting

Mouse movement is detected two ways: the global hook (`uiohook-napi`, also sees clicks, scroll and keys) **and** a cursor-position poll that needs no permissions. If the hook is blocked (macOS permission missing, security software on Windows), mouse movement still counts but keyboard/click/scroll won't. Use the tray item **Test input detection** to see what your machine delivers; the log is in the app data folder (`logs/rans0m.log`). Debug switch: `RANS0M_NO_HOOK=1` disables the hook to test the fallback.

## Tuning

The original spawns extra "taunt" windows with a ~2% chance every 200ms while you're infected (about one every 10 seconds on top of the initial 9). That's `TAUNT_CHANCE_PER_TICK` at the top of `src/main/main.js` if you want more chaos.

## Test mode

`npm run start:test` (or `--test`) sets: 2–5s spawn delay, 20s infection duration, 30 gold
ransom, and forces `CrashOnDeath`/`ExecCMDOnDeath` off regardless of your saved config, so
you can iterate quickly and safely. It does not change `UseDrawerMode` for you — turn that
on yourself in Configuration if you don't want it touching your real folders while testing.

## Credits

- **Doors** is made by **LSPLASH**. The RANSOM/A-90 entity, its name, look, and concept are
  their original work — this project is an unofficial fan recreation, not affiliated with
  or endorsed by LSPLASH. Go play the real game.
- **RANS0M** (the original Windows app this is a port of) is by **Ixar**:
  https://github.com/Ixars/ransomdoors
- Sound effects and images are from the game, taken from the wikis (carried over unchanged
  from the original project).
- This cross-platform port uses [Electron](https://www.electronjs.org/) and
  [uiohook-napi](https://github.com/SnosMe/uiohook-napi) (both MIT-licensed) in place of
  WPF and the original's Win32 hooks/NAudio.

- **libuiohook** by Alexander Barker (LGPL-3.0-or-later), bundled inside `uiohook-napi` for global input detection. Full notices: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and [`licenses/`](licenses/).

## Changes from the original

This is a full reimplementation (JavaScript/Electron instead of C#/WPF), built to
reproduce the original's behavior, assets, and configuration format, plus:

- True global mouse **and** keyboard activity detection (clicks, scroll, and key presses all
  count, not just cursor-position polling as in the original's mouse-spy phase).
- Runs on macOS and Linux in addition to Windows.
- Coin marker files are AES-GCM encrypted with a per-install local key instead of Windows
  DPAPI (`ProtectedData`), since DPAPI is Windows-only; same purpose (opaque, replay-resistant
  marker), different mechanism.
- Cursor effect is a follower overlay everywhere (see Known limitations) rather than a real
  OS cursor swap.
- Per-extension gold-file icon registration is Windows-only (unsupported OS feature
  elsewhere); on non-Windows the coin files still work identically, just without a custom
  icon.
- Destructive death behavior stays off by default and is clearly labeled in the config UI on
  every platform.

## License

Source-available under the original project's **RANS0M Educational & Non-Commercial License
(RENC-1.0)** — see [`LICENSE.md`](LICENSE.md).

- Original work: Copyright (c) 2026 **Ixar**.
- Cross-platform port modifications: Copyright (c) 2026 the port's contributors, **also released
  under RENC-1.0** (same terms: free, non-commercial, credited). This is a modified version of
  Ixar's RANS0M; it is unofficial and not affiliated with LSPLASH.
- You may use, modify and redistribute it for educational and non-commercial purposes if you keep
  the license file, credit Ixar (and the third-party creators listed above), and state what you
  changed. Selling or monetizing it in any form is not allowed.
- Bundled third-party software keeps its own licenses: see
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
