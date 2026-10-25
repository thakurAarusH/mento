// Checks the optional cloud AI settings in .env with one tiny request each (costs a fraction of a cent). Never prints keys.
// Usage: npm run cloud-check
import fs from 'node:fs';
import { createCloud } from '../lib/cloud.js';
if (fs.existsSync('.env')) for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const c = createCloud(process.env), s = c.status();
console.log(`Cloud AI: ${s.mode === 'off' ? 'off (set CLOUD_AI=text or vision and a key: ANTHROPIC_API_KEY, or CLOUD_PROVIDER=gemini with CLOUD_API_KEY)' : `${s.mode} via ${s.provider} ${s.model}`}`);
console.log(`Cloud speech-to-text: ${s.stt ? `${s.stt.model} at ${s.stt.host}` : 'off (set CLOUD_STT=1 and CLOUD_STT_KEY)'}`);
let bad = 0;
const time = async (name, fn) => { const t0 = Date.now(); try { const r = await fn(); console.log(`  ✓ ${name} (${Date.now() - t0} ms): ${r}`); } catch (e) { bad++; console.log(`  ✗ ${name}: ${e.message}`); } };
if (s.mode !== 'off') {
  await time('Japanese question', async () => JSON.parse(await c.json('translate', 'Translate this interview question for a Japanese master solderer into natural, polite Japanese: "Why do you clamp the board from the side away from the iron?" Return JSON {"ja":string}.')).ja);
  if (c.vision) {
    // A plain grey JPEG made by ffmpeg keeps this script free of sample files.
    const { execFileSync } = await import('node:child_process');
    await time('Vision (test image)', async () => { const img = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64', '-frames:v', '1', '-f', 'mjpeg', '-']); return JSON.parse(await c.json('see', 'Describe this still frame. Return JSON {"action":string,"objects":string,"change":string,"notable":boolean,"importance":number,"uncertainty":string}.', [img])).action; });
  }
}
if (s.stt) {
  const { execFileSync } = await import('node:child_process');
  await time('Speech-to-text (1 s of silence)', async () => { const wav = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', '-f', 'wav', '-']); return JSON.stringify(await c.transcribe(wav, 'check.wav', 'audio/wav', { language: 'ja' })); });
}
process.exit(bad ? 1 : 0);
