'use strict';
const IMAGES = ["Taunts/glitch1.jpg","Taunts/glitch2.jpeg","Taunts/glitch3.jpg","Taunts/glitch4.jpg","Taunts/glitch5.jpg","Taunts/idiot.png","Taunts/tauntface.png","Taunts/tauntflower.png"];
(async () => {
  const url = await window.rans0m.assetUrl(IMAGES[Math.floor(Math.random() * IMAGES.length)]);
  document.body.style.backgroundImage = 'url("' + url + '")';
})();
