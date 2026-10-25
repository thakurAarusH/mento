# Putting MENTO on a server

The installer (`setup.sh`) works on any Ubuntu 24.04 server. Two free options we've used or planned:

## Option A: Azure for Students (no credit card) — what the live demo uses

Students can sign up at <https://azure.microsoft.com/free/students> with their **university email** and get free small servers for 12 months. No card is needed, but sign in with the university email, not a personal one, or Azure will ask for a card.

1. **Create the VM:** *Virtual machines → Create → Azure virtual machine*.
   - Region: one your subscription allows (Cloud Shell: `az policy assignment list --disable-scope-strict-match --query "[].parameters"`)
     **and** where Google Gemini is available. Not East Asia (Hong Kong): Gemini refuses requests from there. The live demo uses Japan East.
   - Image: **Ubuntu Server 24.04 LTS**
   - Size: **B2ats v2** (marked "free services eligible")
   - Authentication: **SSH public key**, user `azureuser`
   - Inbound ports: **80, 443, 22**
   - Public IP: **Static**
   - Auto-shutdown: **Off**
2. **Install** with the commands in Part 2 below, using `azureuser@$IP` and adding `MENTO_NO_AI=1`.
   The free VM has only 1 GB of memory, which is too little for the local vision AI. The installer adds swap and runs everything else.
3. **Turn the AI on** with a free Gemini key (aistudio.google.com → *Get API key*, no card). Add to `/opt/mento/.env`, then `sudo systemctl restart mento`:
   ```
   CLOUD_AI=vision
   CLOUD_PROVIDER=gemini
   CLOUD_API_KEY=<your key>
   CLOUD_MIN_INTERVAL_MS=4000
   CLOUD_TIMEOUT_MS=90000
   ```
   A video analysis then takes about 3–4 minutes. When the main model is busy, MENTO automatically uses `gemini-3.5-flash-lite`.

```bash
ssh -i ~/.ssh/mento_oracle azureuser@$IP "sudo MENTO_HOST=$HOST MENTO_NO_AI=1 bash mento/deploy/oracle/setup.sh"
```

## Option B: Oracle Cloud Always Free ($0/month, needs a card for verification)

One always-on ARM server runs everything: the app, database, uploaded videos, Whisper, Open JTalk and the local vision AI,
behind HTTPS (Caddy + a free Let's Encrypt certificate). Your laptop can be switched off.

Always Free ARM allowance (Oracle's page, 2026): **2 OCPU, 12 GB RAM, 200 GB disk, 10 TB/month traffic.**
Video analysis on 2 CPU cores is much slower than on the laptop GPU (estimate: tens of minutes per video, in the background).

## Part 1 — only you can do this (about 20 minutes)

1. **Sign up** at <https://www.oracle.com/cloud/free/>. Choose the **home region** carefully — it cannot be changed:
   *Japan East (Tokyo)* or *Japan Central (Osaka)*. A card is needed for verification; Always Free use is not charged.
2. **Recommended:** *Billing → Upgrade and manage payment → Pay As You Go*, then *Billing → Budgets → Create* a $1 budget with an email alert.
   Oracle keeps Always Free resources free after upgrading, and upgraded accounts are not subject to idle reclamation
   (otherwise a mostly idle server can be reclaimed after 7 quiet days).
3. **Create the server:** *Compute → Instances → Create instance*
   - Name: `mento`
   - Image: **Canonical Ubuntu 24.04** (choose the **aarch64** build)
   - Shape: **Ampere → VM.Standard.A1.Flex**, **2 OCPU, 12 GB memory**
   - Networking: create a new VCN with a **public subnet**, **assign a public IPv4 address**
   - SSH keys: **Paste public keys** → paste the line from `~/.ssh/mento_oracle.pub` on the laptop
   - Boot volume: **Specify a custom size → 150 GB**
   - If it says *Out of host capacity*, try another availability domain or try again later (common in popular regions).
4. **Open the web ports:** *Networking → Virtual cloud networks → (your VCN) → Security Lists → Default Security List → Add Ingress Rules*:
   Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port **80**; add a second rule for port **443**.
5. Copy the instance's **Public IP address**.

## Part 2 — install (Claude can do this over SSH, or run it yourself)

```bash
IP=203.0.113.10                                  # your public IP
HOST=$(echo $IP | tr . -).sslip.io               # free hostname that points to the IP, e.g. 203-0-113-10.sslip.io
rsync -az --exclude node_modules --exclude data --exclude .env --exclude video --exclude .git \
  -e "ssh -i ~/.ssh/mento_oracle" ./ ubuntu@$IP:mento/
ssh -i ~/.ssh/mento_oracle ubuntu@$IP "sudo MENTO_HOST=$HOST bash mento/deploy/oracle/setup.sh"
```

The script prints a new **administrator passphrase once** (stored only in `/opt/mento/.env` on the server).
Then open `https://<HOST>` — the landing page, dashboard, master phone and student phone all work from there.

## Afterwards
- **Update MENTO:** run the same `rsync` and `setup.sh` again (it keeps the existing `.env` and data).
- **Logs / status:** `sudo journalctl -u mento -f`, `systemctl status mento ollama caddy`
- **Backups:** the database is copied nightly to `/var/lib/mento/backups` (14 kept). For videos too, add a backup policy to the
  boot volume in the console (*Block Storage → Boot Volumes → Backup policies*; 5 volume backups are free).
- **Faster AI (optional, small cost):** set `CLOUD_AI=text` and an API key in `/opt/mento/.env` (see the main README, *Hybrid AI*),
  then `sudo systemctl restart mento`. The local model stays the fallback.
- **Your own domain (optional, ~$10/year):** point it at the IP and run `setup.sh` again with `MENTO_HOST=your.domain`.
