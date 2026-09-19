// Renderer side of src/main/audio.js. One message = one complete play request.
(function () {
  const handles = new Map();
  window.rans0m.on('audio:play', (id, url, loop) => {
    const el = new Audio(url);
    el.loop = !!loop;
    handles.set(id, el);
    el.addEventListener('ended', () => handles.delete(id));
    el.play().then(() => console.info('[audio] playing ' + url.split('/').pop()))
      .catch(e => console.warn('[audio] FAILED ' + e.name + ' ' + url));
  });
  window.rans0m.on('audio:stop', (id) => {
    const el = handles.get(id); if (!el) return;
    try { el.pause(); el.currentTime = 0; } catch { /* ignore */ }
    handles.delete(id);
  });
})();
