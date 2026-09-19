'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

let stream = null;
function init() {
  try {
    const dir = paths.logDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'rans0m.log');
    try { if (fs.statSync(file).size > 1024 * 1024) fs.truncateSync(file, 0); } catch { /* new file */ }
    stream = fs.createWriteStream(file, { flags: 'a' });
  } catch { stream = null; }
}
function write(level, args) {
  const text = args.map(a => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} [${level}] ${text}`;
  (level === 'error' ? console.error : console.log)(line);
  try { if (stream) stream.write(line + '\n'); } catch { /* ignore */ }
}
module.exports = {
  init,
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a)
};
