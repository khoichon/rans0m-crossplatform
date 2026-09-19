'use strict';
(async () => {
  document.getElementById('ransom').src = await window.rans0m.assetUrl('ransom_idle.png');
  document.getElementById('ok').src = await window.rans0m.assetUrl('ok_sign.png');
  document.getElementById('thx').src = await window.rans0m.assetUrl('thx_txt.png');

  document.getElementById('ransom').style.opacity = 1;
  await new Promise(r => setTimeout(r, 600));
  document.getElementById('ransom').style.opacity = 0;

  const audio = document.createElement('audio');
  audio.src = await window.rans0m.assetUrl('Sounds/thankyou.wav');
  audio.play().catch(() => {});

  await new Promise(r => setTimeout(r, 100));
  document.getElementById('thx').style.opacity = 1;
  document.getElementById('thx').style.transform = 'translateX(-50%) scale(1)';

  window.rans0m.send('window:closeAfter', 4400);
})();
