import fs from 'node:fs';
import os from 'node:os';
import { createApp } from './app.js';
if (fs.existsSync('.env')) for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const port = +(process.env.PORT || 3000);
createApp().listen(port, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Monozukuri running. Open the DASHBOARD via a LAN address so phones can reach it:\n${ips.map((i) => `  http://${i}:${port}`).join('\n') || '  (no LAN address found)'}\nNote: phones need HTTPS for camera access on non-localhost hosts — see README (tunnel).`);
});
