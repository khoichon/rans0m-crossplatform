'use strict';
(async () => {
  document.getElementById('face').src = await window.rans0m.assetUrl('ransom_idle.png');
  document.getElementById('goldIcon').src = await window.rans0m.assetUrl('Gold.png');
})();

window.rans0m.on('ransom:tick', (left, secs) => {
  document.getElementById('goldValue').textContent = String(left);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  document.getElementById('timerBox').textContent = `TIME: ${m}:${s}`;
});

const zone = document.getElementById('dropzone');
zone.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragover'); });
zone.addEventListener('dragleave', () => document.body.classList.remove('dragover'));
zone.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const paths = [...e.dataTransfer.files].map(f => window.rans0m.pathForFile(f)).filter(Boolean);
  if (paths.length) window.rans0m.send('notification:drop', paths);
});

// Focused-window activity (only used when the global hook is unavailable). Never sends what was pressed.
for (const ev of ['keydown','mousemove','mousedown','wheel']) window.addEventListener(ev, () => window.rans0m.send('input:focusedActivity'));
