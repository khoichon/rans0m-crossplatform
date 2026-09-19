'use strict';
(async () => {
  window.addEventListener('keydown', e => { if (e.key === 'Escape') window.rans0m.send('window:close'); });
  const cfg = await window.rans0m.invoke('config:get');
  const el = id => document.getElementById(id);
  el('spawnAuto').checked = cfg.SpawnAutomatically;
  el('minDelay').value = cfg.MinSpawnDelay;
  el('maxDelay').value = cfg.MaxSpawnDelay;
  el('duration').value = cfg.InfectionDuration;
  el('crashOnDeath').checked = cfg.CrashOnDeath;
  el('cmdOnDeath').checked = cfg.ExecCMDOnDeath;
  el('cmdText').value = cfg.CMDOnDeath;
  el('cmdText').disabled = !cfg.ExecCMDOnDeath;
  el('modeUser').checked = !cfg.UseDrawerMode;
  el('modeDrawer').checked = cfg.UseDrawerMode;
  el('amount').value = cfg.RansomAmount;

  const note = { win32: 'Running on Windows.', darwin: 'Running on macOS \u2014 grant Accessibility/Input Monitoring permission if prompted for full input detection.', linux: 'Running on Linux \u2014 global input detection may be limited under Wayland.' }[cfg.platform] || '';
  el('platformNote').textContent = note;

  el('cmdOnDeath').addEventListener('change', () => { el('cmdText').disabled = !el('cmdOnDeath').checked; });

  function save() {
    window.rans0m.send('config:set', {
      SpawnAutomatically: el('spawnAuto').checked,
      MinSpawnDelay: Number(el('minDelay').value),
      MaxSpawnDelay: Number(el('maxDelay').value),
      InfectionDuration: Number(el('duration').value),
      CrashOnDeath: el('crashOnDeath').checked,
      ExecCMDOnDeath: el('cmdOnDeath').checked,
      CMDOnDeath: el('cmdText').value,
      UseDrawerMode: el('modeDrawer').checked,
      RansomAmount: Number(el('amount').value)
    });
  }
  window.addEventListener('beforeunload', save);
  el('btnSpawn').addEventListener('click', () => { save(); window.rans0m.send('config:spawnNow'); });
})();
