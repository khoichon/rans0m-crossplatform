'use strict';
(async () => {
  document.getElementById('repent').src = await window.rans0m.assetUrl('repent.gif');
  const audio = document.createElement('audio');
  audio.src = await window.rans0m.assetUrl('Sounds/crucifix.wav');
  audio.play().catch(() => {});
  // repent.gif is ~13.7s / 343 frames (single play-through), plus a safety fallback in case
  // GIF-completion detection isn't reliable across platforms (mirrors the 15s fallback timer
  // the original CrucifixWindow.cs used alongside its AnimationCompleted event).
  window.rans0m.send('window:closeAfter', 14000);
})();
