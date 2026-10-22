# Monozukuri Platform (prototype) — ONIGIRI BENTO, Thapar Japan Hackathon 2026

Master records a craft task on a phone → the laptop turns moments into timestamped questions → the master answers and **approves** knowledge →
an apprentice's phone gets coaching grounded **only** in approved records, with a button to escalate to the master. Replaces the old `soldering-tutor`; shares no code with it.

**Zero-cost design.** Node 22 + SQLite (built in) + local disk + optional local Ollama. No account, card, or paid API is needed. Nothing is sent to any cloud.

## Stack decisions (the second brief — ₹0, local, privacy — overrides the first)
| Brief 1 asked for | Built instead | Why |
|---|---|---|
| Next.js | Express + plain ES modules | no build step, runs offline |
| Supabase (DB, auth, storage, RLS, realtime) | SQLite file, private `data/` folder, signed expiring links, role-scoped invite tokens, Server-Sent Events | free, local; access control is enforced in `app.js` (no RLS) |
| Gemini video analysis | optional local Ollama vision model + ffmpeg, **or** master adds moments manually | footage stays local |
| Google audio transcription | **not implemented** (typed answers only) | would send audio to a cloud provider; local Whisper is a future add |

## Run
```bash
node -v            # needs >= 22.13
npm install
cp .env.example .env   # set MASTER_PASSPHRASE
npm start              # prints LAN URLs
npm test
```
1. On the laptop open the **LAN URL** (not `localhost`), sign in, create a session.
2. Scan the Master QR with the recording phone, tick consent, record, upload.
3. Local AI (optional): `ollama pull <vision model>`, set `OLLAMA_URL=http://127.0.0.1:11434` and `OLLAMA_VISION_MODEL=<name>`, install `ffmpeg`. Without it, press nothing fake: analysis reports "not configured" and you add moments manually (“+ Add moment”).
4. Answer questions → edit → **Approve**. Then scan the Apprentice QR on a second phone.

**HTTPS for phones.** Browsers allow camera/microphone only on HTTPS or `localhost`. On a LAN IP over plain HTTP the phone pages will show a clear error. Zero-cost options: `cloudflared tunnel --url http://localhost:3000` (no account needed for quick tunnels) or a self-signed certificate on the LAN. Set `PUBLIC_URL` to the tunnel address so QR codes use it. Free tunnels have no uptime guarantee; the traffic is encrypted but passes through the provider. Not verified here.

## What is implemented vs. verified
| Area | Status |
|---|---|
| Login, sessions, role-scoped expiring invites, QR, rotate links | **Automated tests pass** |
| Consent gate (explicit, unticked), upload validation (type, magic bytes, size) | **Tests pass** |
| Manual moments → timestamped questions → draft → edit/approve/reject; apprentice sees only approved | **Tests pass** |
| Signed expiring file links, tamper/expiry rejected | **Tests pass** |
| Apprentice ask (keyword search of approved records) and unknown → help | **Tests pass** |
| Snapshot endpoint, rate limit, "cannot_assess" when no AI | **Tests pass** |
| Help request → master → reply → apprentice; statuses | **Tests pass** (API level) |
| Session deletion removes rows and files; retention purge | Delete tested; purge **not tested** |
| Assessment JSON validation | **Unit tests pass** |
| Realtime (SSE) and all browser UIs, MediaRecorder, camera, speech synthesis | **Written, NOT tested in a browser or on phones** |
| Ollama video analysis and trainee frame assessment | **Written, NOT tested** (no model in the build sandbox) |
| Voice answers / transcription, voice questions | **Not implemented** |
| Browser E2E and automated accessibility run | **Not run** |
| Check-my-work uses a *still frame*; periodic checks are snapshots, not live video | by design |

Limits: video analysis samples a still frame every 5 s (max 24 frames), so it cannot see pauses or hear audio; the master supplies what it misses. AI never writes "why" — expert words and master-written summaries are kept separate and labelled.

## Troubleshooting
- **Camera blocked / undefined `getUserMedia`**: not HTTPS. Use a tunnel or localhost.
- **QR opens but phone can't connect**: dashboard was opened via `localhost`; reopen via LAN IP or set `PUBLIC_URL`. Same Wi‑Fi, no client isolation.
- **Upload 415/413/400**: format must be MP4/WebM/MOV, under `MAX_VIDEO_MB`.
- **Analysis failed**: message shows the cause (no model, ffmpeg missing, Ollama down). Retry or add moments manually.
- **403 on a video**: signed link expired (15 min); refresh the dashboard.
- Data lives in `./data` (SQLite + files). Back it up or delete it as needed; never commit it.

See `docs/COMPLIANCE.md` for costs, cookies, assets, accessibility, risks and the legal-review checklist.
