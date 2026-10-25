# MENTO technical guide

The [README](../README.md) explains what MENTO is. This page is for running, configuring and fixing it.

## Contents
- [Running MENTO](#running-mento)
- [Who uses which page](#who-uses-which-page)
- [Accounts and deleting things](#accounts-and-deleting-things)
- [Japanese support](#japanese-support)
- [How the AI writes its questions](#how-the-ai-writes-its-questions)
- [Optional local tools](#optional-local-tools)
- [Hybrid AI (optional)](#hybrid-ai-optional)
- [HTTPS for phones](#https-for-phones)
- [Keeping it running](#keeping-it-running)
- [Design decisions](#design-decisions)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)

## Running MENTO

```bash
node -v                # needs 22.13 or newer
npm install
cp .env.example .env   # set MASTER_PASSPHRASE
npm start              # prints the local and network addresses
npm test               # 95 automated tests
```

Every setting lives in `.env`, and `.env.example` explains each one. Data (the SQLite database and video files) is stored in `./data`. Back it up, and never commit it.

## Who uses which page

Start at the landing page (`/`). It explains MENTO and sends each person to the right place.

| Who | Page | What they do |
|---|---|---|
| Master, laptop | `/dashboard` | Create sessions, review the AI's questions, answer them (typed or 🎤), check the knowledge card drafted under each question, and approve it. Sees each session's **student code** and the students' progress. |
| Master, phone | `/m.html` | Pick or create a session for any skill, then record or upload a video and press **Find questions with AI** (3, 5, 8 or 10 questions). Progress is shown on the phone. |
| Student, phone | `/a.html` | Join with the master's 6-character code or QR. **Overview** shows progress, safety, tools and steps. **Learn** has the approved lessons, the master's clips and *mark as learned*. **Practise** has camera checks. **Ask** answers from approved lessons, or sends the question to the master. Also includes the **Practice Lab** (`/lab.html`). |

The dashboard has a sticky section bar (Sessions · New session · ▶ Live session · Recordings · Questions · Knowledge · Help · Students · Recently deleted). `/dashboard#live` opens the most recent session. Knowledge cards open in a side panel, or full screen on phones.

## Accounts and deleting things

**Master accounts.** A master creates an account (name, username, password) on the sign-in screen and stays signed in on that device for 30 days. Masters see and change only their own sessions. `MASTER_PASSPHRASE` is the administrator login, which can see everything. Set `ALLOW_SIGNUP=0` to stop new accounts being created.

**Deleting.** Recordings (with their questions and knowledge), questions, knowledge cards and help requests can be deleted from the dashboard. Deleted items stay in **Recently deleted** for 7 days, where **Restore** brings back everything that went with them. Deleting a whole session is immediate and permanent.

## Japanese support

- **Interface language.** Every page has an **English / 日本語** switch. The whole interface switches without reloading, including the server's messages, the legal pages and the skill profiles, and the choice is remembered on the device.
- **Session language.** Each session has its own *AI language*. In a Japanese session, the AI writes its questions in English and then translates the best one into polite Japanese using the craft's own terms. The English original stays visible.
- **Speech to text.** Whisper's multilingual model transcribes speech in the interface language. It is given the craft's own words (e.g. はんだごて, フラックス) as a hint, which makes Japanese much more accurate.
- **Read aloud.** *Listen* speaks in the interface language. A tip written in the other language is translated first, and the translation is cached. Japanese uses Open JTalk with the "Mei" voice, because phones often have no Japanese voice. English uses the phone's voice, or espeak-ng on the server if the phone has none.

Installing Open JTalk without root: build `hts_engine_API-1.10` and `open_jtalk-1.11` from SourceForge with `--prefix=$HOME/.local/opt/open_jtalk`. Unpack `open_jtalk_dic_utf_8-1.11` into `…/dic` and `mei_normal.htsvoice` (from MMDAgent_Example-1.8) into `…/voice`. Then set `OPENJTALK_BIN`, `OPENJTALK_DIC` and `OPENJTALK_VOICE`. On Ubuntu, `apt install open-jtalk open-jtalk-mecab-naist-jdic` provides the program and the dictionary.

## How the AI writes its questions

Each skill in `skills/*.json` comes with a `manual`: the standard guidance that books and courses already cover. A master can add their own manual to a session as a PDF, text, or pasted in.

For each key moment in the video:
1. The local vision model describes the frame.
2. The AI is given the matching manual passages and told **not** to ask about them.
3. It writes three candidate questions (always including a *why* question).
4. A judging pass keeps the most insightful one. Moments with no good question are dropped.

The first analysis asks about 5 questions. **+5 / +10 more** reuses the saved frame descriptions instead of re-watching the video. When new moments run out, it asks follow-up questions that dig into answers already given.

The AI never invents the "why". Knowledge cards are drafted only from the master's own words, and the master approves them.

## Optional local tools

| Tool | Settings in `.env` |
|---|---|
| Ollama + a vision model (we use `qwen3-vl:4b-instruct`), plus `ffmpeg` | `OLLAMA_URL=http://127.0.0.1:11434`, `OLLAMA_VISION_MODEL=qwen3-vl:4b-instruct` |
| whisper.cpp + `ggml-small-q5_1.bin` | `WHISPER_BIN`, `WHISPER_MODEL`, `WHISPER_LANG` |
| Open JTalk + Mei voice, espeak-ng | `OPENJTALK_BIN`, `OPENJTALK_DIC`, `OPENJTALK_VOICE`, `ESPEAK_BIN` |

Without Ollama, analysis says "not configured" and the master adds key moments by hand. Everything else still works.

## Hybrid AI (optional)

Local mode is the default and always the fallback. The operator can let a cloud model (Anthropic Claude) help where the small local model is weakest.

| `CLOUD_AI` | Sent to the cloud | Stays local |
|---|---|---|
| `off` (default) | nothing | everything |
| `text` (recommended) | text only: frame *descriptions*, the master's answers, approved cards, student questions, manual excerpts | all video, photos and audio |
| `vision` | the above, plus still frames and practice photos | full videos, audio, names, passwords |

How it behaves:
- **What it's used for:** writing and judging questions, natural Japanese, follow-ups, drafting knowledge cards, and **✨ Suggest a reply** for help requests (drafted only from approved cards; the master edits it and sends it).
- **Fallback:** on any cloud error, timeout or refusal, the local model does that step. A failing service is skipped for 1 minute, or 30 minutes for a wrong key or model.
- **Keys:** stored only in `.env`. They are never sent to browsers, never logged, and scrubbed from error messages. The tests check this.
- **Privacy wording:** the privacy pages, consent screens and landing page change their wording automatically to match.
- **Status:** the dashboard's Activity panel shows **AI: Local** or **Hybrid · model**.
- **Speech to text:** optional cloud transcription (`CLOUD_STT=1`) works with any OpenAI-compatible endpoint.

To set it up, add `CLOUD_AI=text` and `ANTHROPIC_API_KEY=…` to `.env`, run `npm run cloud-check`, then restart MENTO.

## HTTPS for phones

Browsers only allow the camera and microphone on HTTPS (or `localhost`). Free options:
- **Cloudflare quick tunnel:** `cloudflared tunnel --url http://localhost:3000`. No account is needed. Put the address it prints in `PUBLIC_URL` so the QR codes use it. Quick tunnels reject uploads over 100 MB, so MENTO limits phones to 95 MB behind one.
- **A real server** with Caddy, which gets a free certificate automatically. See [deploy/oracle/README.md](../deploy/oracle/README.md).

## Keeping it running

**On a laptop (Linux):** we run MENTO, Ollama and the tunnel as systemd user services (`mento-app`, `mento-ollama`, `mento-tunnel`).
- Status: `systemctl --user status mento-app`
- Restart after code changes: `systemctl --user restart mento-app`
- Logs: `journalctl --user -u mento-app`

A restarted quick tunnel gets a new address.

**On a server:** `deploy/oracle/setup.sh` installs everything, runs MENTO as a system service behind Caddy (HTTPS), and backs the database up every night.

## Design decisions

The hackathon asked for zero cost, local data and privacy, so:

| Usual choice | What MENTO uses | Why |
|---|---|---|
| Next.js | Express + plain ES modules | No build step, works offline |
| Supabase | SQLite, a private `data/` folder, signed expiring links, role-scoped invite tokens, Server-Sent Events | Free and local. Access control is enforced in `app.js` |
| Cloud video AI | Local Ollama vision model + ffmpeg, or key moments added by hand | Footage stays local |
| Cloud transcription | Local whisper.cpp | Audio stays local |

## Limits

- Video analysis looks at still frames (one every few seconds), so it can't see pauses or hear audio. The master fills in what it misses.
- *Check my work* compares a single photo, not live video.
- A small CPU-only server is much slower at AI analysis than a laptop with a GPU.

## Troubleshooting

- **Camera blocked, or `getUserMedia` is undefined:** the page isn't on HTTPS. Use a tunnel or `localhost`.
- **The QR opens but the phone can't connect:** the dashboard was opened via `localhost`. Set `PUBLIC_URL`, or open it via the network address on the same Wi-Fi.
- **Upload rejected (415/413/400):** the file must be MP4, MOV, WebM or MKV, and under `MAX_VIDEO_MB`.
- **Analysis failed:** the message shows the cause (no model, ffmpeg missing, Ollama down). Try again, or add moments by hand.
- **A video won't play (403):** the signed link expired after 15 minutes. Refresh the page.

See also [API_CONTRACT.md](API_CONTRACT.md) for the HTTP API and [COMPLIANCE.md](COMPLIANCE.md) for costs, cookies, licences, accessibility and risks.
