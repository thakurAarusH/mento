# Deploy MENTO on Oracle Cloud Always Free ($0/month)

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
