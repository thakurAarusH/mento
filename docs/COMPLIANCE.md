# Compliance, cost and risk notes (prototype — not legal advice, not a compliance claim)

## 1. Zero-cost table
| Dependency | Zero-cost config | Limits | Account? |
|---|---|---|---|
| Node.js 22 (`node:sqlite`) | free/OSS | sqlite API is experimental | No |
| express, qrcode (npm) | MIT licences | — | No |
| SQLite + local disk | on laptop | disk space | No |
| Ollama + open vision model (optional) | local | needs RAM/GPU; sandbox had 1 CPU/4 GB, so a model was not run here | No |
| ffmpeg (optional) | OSS | — | No |
| Tunnel for remote demo (optional) | e.g. Cloudflare quick tunnel | no uptime guarantee, terms apply | Usually no |
Nothing here can bill silently. Do not add a paid API or fallback without explicit approval. A free hackathon laptop deployment is not a production service.

## 2. Cookie and third-party inventory (from the code)
One cookie `mz` (auth, HttpOnly, SameSite=Strict, 12 h, strictly necessary). Invite token lives in the URL fragment (not sent to the server in page requests; sent in `x-token` header; the SSE URL carries it in the query string, so it can appear in local server/tunnel logs — mitigated by expiry/rotation). No analytics, no external fonts/CDNs/embeds (a test asserts no external URLs in `public/`). No cookie banner is shown because only strictly necessary storage is used — confirm with counsel for your jurisdictions.

## 3. Legal research summary (verify before relying)
- **India DPDP Act 2023 / Rules 2025**: Rules notified 13 Nov 2025. Rules 1, 2, 17–21 effective immediately; Rule 4 (consent managers) 13 Nov 2026; Rules 3, 5–16, 22–23 (notice, consent, safeguards, breach, retention, rights) from **13 May 2027**. Sources checked were law-firm summaries, not the Gazette — confirm on meity.gov.in. Whether a student prototype handling recordings of identifiable people is in scope, and whether any exemption applies, is **uncertain**.
- **Japan APPI**: relevant if Japanese organisations' employees/personal data are handled or data is transferred from Japan; **not researched in depth**.
- **GDPR/UK GDPR**: only if EU/UK people use it; unresolved.
- **Indian IT/consumer rules**: grievance-contact and intermediary obligations may depend on becoming a service for others; unresolved.
Refund policy: not applicable (no payments).

## 4. Legal-review checklist (owner/counsel)
[ ] legal name, address, grievance contact in `lib/legal.js` · [ ] retention period · [ ] consent wording per jurisdiction · [ ] minors/employees as recorded subjects · [ ] who owns the master's expertise/recordings · [ ] cross-border tunnel use · [ ] breach-notification process · [ ] governing law/liability in Terms · [ ] whether a banner is needed

## 5. Accessibility checklist (WCAG 2.2 AA target — **not audited**)
Done in code: semantic landmarks, skip link, labelled fields, visible focus, 44 px targets, status not by colour alone (icons + text), `aria-live` announcements, text for all spoken guidance, reduced-motion media query, captions N/A (no instructional audio shipped). **Not done:** automated axe run, screen-reader pass, video captions/transcripts for master clips, contrast measurement tool, zoom/reflow tests.

## 6. Asset/licence inventory
No images, icons, fonts or third-party assets. UI uses system fonts and original CSS. npm: express (MIT), qrcode (MIT) and their dependencies — run `npm audit` and `npx license-checker` before release.

## 7. Risk register
| Risk | Sev | Lik | Mitigation | Remaining |
|---|---|---|---|---|
| Invite link shared/leaked | High | Med | random 192-bit, role-scoped, 24 h expiry, rotate, consent required | token in SSE query string; anyone with link in window |
| Footage exposure | High | Low | private folder, signed 15-min links, CSP, no cloud AI | laptop security, disk encryption is operator's job |
| Weak master passphrase | High | Med | rate limit 8/min/IP, HttpOnly cookie | single shared passphrase, no MFA |
| AI wrong/unsafe advice | High | Med | approved-record grounding, `cannot_assess`, safety_stop, human escalation, schema validation | model quality untested |
| Wrong attribution to expert | Med | Low | verbatim vs master-written summary separated, no AI summaries | master may approve badly |
| Over-retention | Med | Med | default 30-day purge, delete button | purge untested |
| Missing legal basis/notice | High | Unknown | consent screen, policies drafted | needs counsel |
| CSRF | Med | Low | SameSite=Strict, JSON/headers | no CSRF tokens |
| No HTTPS on LAN | Med | High | tunnel instructions, cookie `Secure` behind HTTPS | camera blocked otherwise |
