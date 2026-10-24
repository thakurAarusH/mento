# MENTO — Experience becomes expertise.
### AI-Assisted Tacit Knowledge Transfer Platform (prototype) — ONIGIRI BENTO, Thapar Japan Hackathon 2026

An AI-assisted platform for capturing, preserving and transferring practical expertise from experienced practitioners to learners (initial demonstration domains: electronics soldering and bonsai cultivation).

Master records a craft task on a phone → the laptop turns moments into timestamped questions → the master answers and **approves** knowledge →
an apprentice's phone gets coaching grounded **only** in approved records, with a button to escalate to the master. Replaces the old `soldering-tutor`; shares no code with it.

**Zero-cost design.** Node 22 + SQLite (built in) + local disk + optional local Ollama. No account, card, or paid API is needed. Nothing is sent to any cloud.

## Stack decisions (the second brief — ₹0, local, privacy — overrides the first)
| Brief 1 asked for | Built instead | Why |
|---|---|---|
| Next.js | Express + plain ES modules | no build step, runs offline |
| Supabase (DB, auth, storage, RLS, realtime) | SQLite file, private `data/` folder, signed expiring links, role-scoped invite tokens, Server-Sent Events | free, local; access control is enforced in `app.js` (no RLS) |
| Gemini video analysis | optional local Ollama vision model + ffmpeg, **or** master adds moments manually | footage stays local |
| Google audio transcription | optional **local whisper.cpp** for the master's spoken answers (dashboard 🎤) | audio stays on the laptop by default (optional cloud STT, see *Hybrid AI*) |

## Run
```bash
node -v            # needs >= 22.13
npm install
cp .env.example .env   # set MASTER_PASSPHRASE
npm start              # prints LAN URLs
npm test
```
**Start at the landing page** (`/`). It explains MENTO and sends each person to their workflow:

| Who | Where | What they do |
|---|---|---|
| Master, laptop | `/dashboard` (own account) | Create sessions, review the AI's questions, answer them (type or 🎤), check the AI-filled knowledge record under each question, approve it. Sees each session's **student code** and students' progress. |
| Master, phone | `/m.html` (own account, or the session's master QR) | Pick a session or **create one for any skill**, record, upload, then **Find questions with AI** (choose up to 3/5/8/10) and watch progress. The phone then links to the dashboard. |
| Student, phone | `/a.html` (6-character code from the master, or the student QR) | **Overview** (progress, safety, tools, steps) · **Learn** (approved lessons by step, master's clip, mark as learned) · **Practise** (camera checks) · **Ask** (answers from approved lessons, otherwise the question goes to the master; replies arrive live). |

**Master accounts.** Each master creates an account (name, username, password) on the sign-in screen and stays signed in on that device for 30 days. A master sees and changes only their own sessions. The first account created takes over sessions made before accounts existed. `MASTER_PASSPHRASE` remains an administrator login ("Administrator sign-in") that sees everything. Set `ALLOW_SIGNUP=0` to stop new accounts being created.

**Deleting things.** Recordings (with their questions and knowledge), questions, knowledge records and help requests can be deleted from the dashboard; the master phone can delete its own uploads. Deleted items go to **Recently deleted** on the dashboard for 7 days, where **Restore** brings back everything that went with them; **Delete for good** (or the 7-day purge) removes them permanently. Deleting a whole session is immediate and permanent.

**Japanese (日本語).** Each session has a language (English or 日本語), chosen when it is created and switchable later. In a Japanese session the AI writes its questions in English and translates the best one into polite Japanese with the craft's own terms; knowledge records are drafted in the language of the master's answer; photo-check feedback is in Japanese; the 🎤 transcribes Japanese speech (Whisper's multilingual model); and the student phone reads lessons and guidance aloud with a local Japanese voice (Open JTalk + the "Mei" HTS voice), because phones often have no Japanese voice. English read-aloud uses the phone's own voice, falling back to espeak-ng on the laptop. To install Open JTalk without root: build `hts_engine_API-1.10` and `open_jtalk-1.11` from SourceForge with `--prefix=$HOME/.local/opt/open_jtalk`, unpack `open_jtalk_dic_utf_8-1.11` into `…/dic` and `mei_normal.htsvoice` (MMDAgent_Example-1.8) into `…/voice`, then set `OPENJTALK_BIN`, `OPENJTALK_DIC`, `OPENJTALK_VOICE`. Voice credit: HTS voice "Mei" © Nagoya Institute of Technology, CC BY 3.0.

**Interface language.** Every page has an **English / 日本語** switch in its header. The whole interface (dashboard, both phones, landing page, sign-in, consent, messages from the server, legal pages, and the skill profiles' names, tasks, tools and safety notes) switches without reloading; the choice is remembered on the device. This is separate from each session's *AI language*, which decides the language of the AI's questions, drafts and photo feedback.

**Questions that capture what manuals leave out.** Each skill has a built-in `manual` (the standard guidance that books and courses already cover), and a master can add their own manual to a session (PDF, text or pasted). For each moment the AI is given the relevant passages and told not to ask about them; it writes three candidates (always including a *why* question), a judging pass keeps the most insightful one, and moments with no good question are dropped. The first analysis asks for about **5**; **+5 / +10 more** then uses the saved frame descriptions (no need to re-watch the video) and, when new moments run out, asks **follow-up questions that dig into answers already given**. In Japanese sessions questions are written in English and translated; the English original stays visible under the question.

**Dashboard layout.** A sticky section bar (Sessions · New session · ▶ Live session · Recordings · Questions · Knowledge · Help · Students · Recently deleted) scrolls smoothly to each part; `/dashboard#live` opens the last session. Knowledge records open in a side panel (full screen on phones), with a compact Knowledge library list. Connection and activity (master phone last seen, students online / active today) are shown quietly in a small side panel.

**Any skill.** Soldering, bonsai, kintsugi and Japanese swordsmithing (katana forging) are bundled profiles (`skills/*.json`, each with a Japanese `ja` block and a `manual`). Choose **Another skill** to define one in the session itself: name, task, tools (`name — purpose` per line), safety notes and steps. The AI's questions and photo checks then use that description; photo checks for a custom skill judge only against the approved lessons.

Local AI (optional): `ollama pull <vision model>`, set `OLLAMA_URL=http://127.0.0.1:11434` and `OLLAMA_VISION_MODEL=<name>`, install `ffmpeg`. Without it, analysis reports "not configured" and the master adds moments manually. Spoken answers (optional): build [whisper.cpp](https://github.com/ggml-org/whisper.cpp), download a model such as `ggml-small-q5_1.bin`, and set `WHISPER_BIN` / `WHISPER_MODEL`.

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
| Spoken answers on the dashboard (local whisper.cpp) | **Endpoint tested** (auth, conversion, marker stripping); real mic + model checked manually |
| Voice questions from the apprentice phone | **Not implemented** |
| Browser E2E and automated accessibility run | **Not run** |
| Check-my-work uses a *still frame*; periodic checks are snapshots, not live video | by design |

Limits: video analysis samples a still frame every 5 s (max 24 frames), so it cannot see pauses or hear audio; the master supplies what it misses. AI never writes "why" — expert words and master-written summaries are kept separate and labelled.

## Uploading a video, voices and themes
- **Upload a video filmed with another camera** (MP4, MOV, WebM or MKV): on the dashboard (📁 *Upload a video file* in a session's recordings) or on the master phone (*Upload a video from this phone*). It goes through exactly the same AI analysis and questions as a phone recording. Limit 200 MB (95 MB through a quick tunnel).
- **Voices follow the interface language.** On the student phone, *Listen* speaks in the language the site is set to; a tip written in the other language is translated by the AI first (cached), or read as written if that is not possible. Speech input is transcribed into the interface language (日本語 → Japanese text, English → English text); the dashboard's 🎤 menu can still choose auto-detect or translate.
- **Dark and light mode**: the ☀/☾ button in every header (default: the device setting; the choice is remembered).

## Hybrid AI (optional, off by default)
Local mode stays the default and the fallback. The operator can let a cloud model help where the small local model is weakest:

| `CLOUD_AI` | What goes to the cloud (Anthropic Claude) | What stays local |
|---|---|---|
| `off` (default) | nothing | everything |
| `text` (recommended) | text only: frame *descriptions* written by the local vision model, the master's answers, approved records, student questions, manual excerpts | all video, photos and audio; frame analysis |
| `vision` | the above plus still frames and student practice photos | full videos, audio, names, passwords |

Cloud is used for: writing and judging questions, natural Japanese, follow-ups, drafting knowledge records, and **✨ Suggest a reply** (help requests; the reply is drafted only from approved records, and the master edits and sends it). Optional cloud speech-to-text (`CLOUD_STT=1`) works with any OpenAI-compatible transcription endpoint.

- Any cloud error, timeout or refusal → the local model does that step; a failing service is skipped for 1 minute (30 minutes for a wrong key or model), so the app never waits on it twice.
- Keys live only in `.env` (chmod 600); they are never sent to browsers, never logged, and scrubbed from error messages. Tests check this.
- The privacy/cookie pages, consent screens and landing page change their wording automatically to say what is sent where.
- The dashboard's Activity panel shows **AI: Local** or **Hybrid · model**, and warns when it is falling back.
- Set up: add `CLOUD_AI=text` and `ANTHROPIC_API_KEY=…` to `.env`, run `npm run cloud-check`, then `systemctl --user restart mento-app`.

Students can also **speak their question** on the phone (🎤 on the Ask tab); it is transcribed by the same Whisper on the laptop, in the interface language. Read-aloud uses the laptop's Open JTalk voice for Japanese, and for English the phone's own voice when it has one, otherwise espeak-ng on the laptop.

Speech-to-text also got better locally: the recogniser is given the session's craft words (e.g. はんだごて, フラックス) as a hint, and `WHISPER_MODEL` can point at `ggml-large-v3-turbo-q5_0.bin` for much better Japanese.

## Keeping it running
On this laptop the app, Ollama and the tunnel run as **systemd user services** (`mento-app`, `mento-ollama`, `mento-tunnel`), so they keep running when the terminal or Claude Code session closes (they stop at logout/reboot). Status: `systemctl --user status mento-app`; restart the app after code changes: `systemctl --user restart mento-app`. A restarted quick tunnel gets a **new address**: put it in `PUBLIC_URL` and restart the app. Logs: `journalctl --user -u mento-app`.

Free quick tunnels reject uploads over 100 MB, so behind one the phones are limited to 95 MB (a 10-minute take at the phone's 1.2 Mbps is about 90 MB).

## Troubleshooting
- **Camera blocked / undefined `getUserMedia`**: not HTTPS. Use a tunnel or localhost.
- **QR opens but phone can't connect**: dashboard was opened via `localhost`; reopen via LAN IP or set `PUBLIC_URL`. Same Wi‑Fi, no client isolation.
- **Upload 415/413/400**: format must be MP4/WebM/MOV, under `MAX_VIDEO_MB`.
- **Analysis failed**: message shows the cause (no model, ffmpeg missing, Ollama down). Retry or add moments manually.
- **403 on a video**: signed link expired (15 min); refresh the dashboard.
- Data lives in `./data` (SQLite + files). Back it up or delete it as needed; never commit it.

See `docs/COMPLIANCE.md` for costs, cookies, assets, accessibility, risks and the legal-review checklist.
