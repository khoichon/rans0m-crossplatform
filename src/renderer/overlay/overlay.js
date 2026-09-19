'use strict';
const bg = document.getElementById('bg');
const imgIdle = document.getElementById('img_idle');
const imgStop = document.getElementById('img_stopsign');
const imgAttack = document.getElementById('img_attack');
const staticBg = document.getElementById('staticBg');
const redVignette = document.getElementById('redVignette');
const dl = document.getElementById('download');
const dlText = document.getElementById('downloadText');
const bar = document.getElementById('bar').children;
const cursorFollower = document.getElementById('cursorFollower');
const faces = document.getElementById('faces');
let faceUrls = [];

async function A(name) { return await window.rans0m.assetUrl(name); }

(async () => {
  imgIdle.src = await A('ransom_idle.png');
  imgStop.src = await A('stop_sign.png');
  imgAttack.src = await A('ransom_attack.gif');
  staticBg.src = await A('static.gif');
  redVignette.src = await A('red_vignette.gif');
  cursorFollower.src = await A('infectedcursor.png');
  faceUrls = [imgIdle.src, await A('ransom_attack.png')];
})();

function rand(min, max) { return Math.floor(Math.random() * (max - min)) + min; }
function setBg(rgba) { bg.style.background = rgba; }

// -------- Cursor-follower fallback (see src/main/cursor.js for why) --------
let followerActive = false;
window.addEventListener('mousemove', e => {
  if (!followerActive) return;
  cursorFollower.style.left = (e.clientX - 4) + 'px';
  cursorFollower.style.top = (e.clientY - 4) + 'px';
});

window.rans0m.on('cursor:set', on => { followerActive = on; cursorFollower.style.opacity = on ? '1' : '0'; });

// -------- Phase visuals, driven by main.js's state machine --------
// Fallback for when the real wallpaper can't be safely changed (couldn't read the original, or
// unsupported desktop): a mild dark-red tint instead. Nothing on the system is modified.
window.rans0m.on('phase:tint', on => { document.getElementById('tint').style.opacity = on ? 1 : 0; });

window.rans0m.on('phase:reset', () => {
  faces.innerHTML = '';
  redVignette.style.opacity = 0; staticBg.style.opacity = 0;
  imgIdle.style.opacity = 0; imgAttack.style.opacity = 0; imgStop.style.opacity = 0;
  dl.style.opacity = 0;
  for (const seg of bar) seg.style.background = '#000';
  setBg('rgba(0,0,0,0)');
});

window.rans0m.on('phase:warning:show', (x, y) => {
  imgIdle.style.left = x + 'px'; imgIdle.style.top = y + 'px';
  imgIdle.style.opacity = 1;
});
window.rans0m.on('phase:warning:spy', () => {
  imgStop.style.opacity = 1;
  imgIdle.style.left = '50%'; imgIdle.style.top = 'calc(50% + 50px)';
  imgIdle.style.transform = 'translate(-50%,-50%)';
  setBg('rgb(40,0,0)');
});
window.rans0m.on('phase:warning:reveal', (moved) => {
  imgStop.style.opacity = 0;
  setBg('rgba(100,0,0,0.4)');
  setTimeout(() => { setBg('rgba(0,0,0,0)'); imgIdle.style.opacity = 0; }, moved ? 25 : 100);
});

window.rans0m.on('phase:attack:show', () => {
  imgAttack.style.left = '50%'; imgAttack.style.top = '50%'; imgAttack.style.transform = 'translate(-50%,-50%)';
  imgAttack.style.opacity = 1;
  setBg('rgb(120,0,0)');
  staticBg.style.opacity = 0.05;
  let i = 0; const shake = setInterval(() => {
    i++; if (i > 40) return clearInterval(shake);
    imgAttack.style.marginLeft = rand(-40, 40) + 'px'; imgAttack.style.marginTop = rand(-40, 40) + 'px';
  }, 20);
});
window.rans0m.on('phase:attack:crash', () => {
  imgAttack.style.left = '50%'; imgAttack.style.top = '50%'; imgAttack.style.transform = 'translate(-50%,-50%)';
  imgAttack.style.opacity = 1;
  setBg('rgb(100,0,0)'); staticBg.style.opacity = 0.05;
  let i = 0; const shake = setInterval(() => {
    i++; if (i > 25) return clearInterval(shake);
    imgAttack.style.marginLeft = rand(-40, 40) + 'px'; imgAttack.style.marginTop = rand(-40, 40) + 'px';
  }, 20);
});
window.rans0m.on('phase:attack:hide', () => { imgAttack.style.opacity = 0; });

window.rans0m.on('phase:download:show', () => {
  dl.style.opacity = 1;
  // Ransom's face gets drawn at a random spot/size/tilt on the background every 0.2s;
  // everything is removed again when the download finishes.
  const drawFace = () => {
    if (!faceUrls.length) return;
    const img = document.createElement('img');
    const size = rand(120, 420);
    img.src = faceUrls[rand(0, faceUrls.length)];
    img.style.width = size + 'px'; img.style.height = size + 'px';
    img.style.left = rand(-40, Math.max(1, window.innerWidth - size + 40)) + 'px';
    img.style.top = rand(-40, Math.max(1, window.innerHeight - size + 40)) + 'px';
    img.style.transform = 'rotate(' + rand(-25, 25) + 'deg)';
    faces.appendChild(img);
  };
  drawFace();
  const faceTimer = setInterval(drawFace, 200);
  let dots = 0; const words = ['', '.', '..', '...', ''];
  const textTimer = setInterval(() => { dlText.textContent = 'DOWNLOADING' + words[dots % words.length]; dots++; }, 120);
  let seg = 0; const barTimer = setInterval(() => {
    if (seg >= bar.length) return clearInterval(barTimer);
    bar[seg].style.background = 'linear-gradient(#cc0000,#960000,#cc0000)';
    seg++;
  }, 120);
  window._dlTimers = [textTimer, barTimer, faceTimer];
});
window.rans0m.on('phase:download:hide', () => {
  (window._dlTimers || []).forEach(clearInterval);
  dl.style.opacity = 0;
  for (const s of bar) s.style.background = '#000';
  faces.innerHTML = '';
  staticBg.style.opacity = 0;
  setBg('rgba(0,0,0,0)');
});

window.rans0m.on('phase:ransomed:flash', () => {
  setBg('rgba(255,0,0,1)');
  setTimeout(() => setBg('rgba(255,0,0,0)'), 500);
  redVignette.style.opacity = 1;
});
window.rans0m.on('phase:ransomed:end', () => { redVignette.style.opacity = 0; });
