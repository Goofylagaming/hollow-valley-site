# Deploying the Herby Death Squad portal

This site is now a real Node.js/Express app with a SQLite database and Discord
login — it is **not** a static site anymore, so it needs a host that can run a
persistent Node process (Netlify cannot do this; that's fine, this guide
covers a normal VPS instead).

## 1. Domain (done ✅)

You've already bought **herbydeathsquadgames.com** via Cloudflare Registrar.
This site (the actual app) runs on the subdomain
`hollowvalley.herbydeathsquadgames.com`. The **root domain**
(`herbydeathsquadgames.com`) hosts a small static landing page
(`landing/index.html`) with a "studio" front door and a big button into
Hollow Valley — see step 6b below.

Pick a VPS host to run the app on:

- **Hetzner Cloud (recommended)** — cheapest, ~$4-5/mo (CX22: 2vCPU/4GB),
  EU/US locations, plenty of headroom for this app. Sign up at
  https://www.hetzner.com/cloud, create a server with the **Ubuntu 22.04 or
  24.04** image, cheapest CX22 tier, and note its public IPv4 address.
- **DigitalOcean** — ~$6/mo droplet, very good docs if you want more hand-holding.
- **Linode/Akamai** — similar pricing to DigitalOcean.

Once you have the server's public IP, add this DNS record in the Cloudflare
dashboard (Website → herbydeathsquadgames.com → DNS):

```
Type: A
Name: hollowvalley
IPv4 address: <your server's public IP>
Proxy status: Proxied (orange cloud) or DNS only — either works; proxied
              gives you free CDN/DDoS protection in front of the app.
TTL: Auto
```

This makes `hollowvalley.herbydeathsquadgames.com` point at your server. DNS
changes usually take effect within a few minutes on Cloudflare.

> If you enable the orange-cloud proxy, set `DISCORD_REDIRECT_URI` and the
> Nginx `server_name` to `https://hollowvalley.herbydeathsquadgames.com` and
> use Cloudflare's "Full (strict)" SSL mode once certbot has issued a cert —
> otherwise Cloudflare's edge cert alone can leave the origin connection
> unencrypted.

## 2. Server setup (one time)

SSH into the fresh server, then:

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo apt install -y nginx certbot python3-certbot-nginx git
```

## 3. Get the code onto the server

```bash
git clone https://github.com/Goofylagaming/hollow-valley-site.git
cd hollow-valley-site
cp .env.example .env
nano .env   # fill in SESSION_SECRET, DISCORD_CLIENT_ID/SECRET,
            # DISCORD_REDIRECT_URI=https://hollowvalley.herbydeathsquadgames.com/auth/discord/callback
```

Generate a strong `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3b. Optional: admin access + supporter payments

- `ADMIN_DISCORD_IDS` — comma-separated Discord user IDs. Anyone logging in
  with one of these IDs is auto-promoted to site admin (can create free
  "premium" skins for everyone). Leave blank if you don't need admins yet.
- `STRIPE_SECRET_KEY` — leave blank until you have a real Stripe account.
  Without it, the Supporter page clearly tells players checkout isn't
  configured yet instead of faking a purchase. Once you're ready to accept
  real payments, set this and wire up a Stripe Checkout session + webhook in
  `server/routes/supporter.js` (the TODO comments show exactly where).

## 4. Discord login setup

1. Go to https://discord.com/developers/applications → New Application.
2. OAuth2 → General → add a redirect: `https://hollowvalley.herbydeathsquadgames.com/auth/discord/callback`
3. Copy the **Client ID** and **Client Secret** into `.env`.
4. Set `DISCORD_REDIRECT_URI=https://hollowvalley.herbydeathsquadgames.com/auth/discord/callback` in `.env` to match exactly.

Without this, the site still runs — the "Login with Discord" button will just
show a friendly "not configured yet" message instead of erroring out.

## 5. Run it with Docker (recommended)

```bash
docker compose up -d --build
```

The app now listens on `127.0.0.1:3000` inside the server. Data persists in a
Docker volume (`hollowvalley-data`) even if the container restarts/rebuilds.

## 6. Point Nginx + HTTPS at it

```bash
sudo cp nginx/hollowvalley.conf /etc/nginx/sites-available/hollowvalley.conf
sudo ln -s /etc/nginx/sites-available/hollowvalley.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d hollowvalley.herbydeathsquadgames.com
```

Certbot auto-configures HTTPS and sets up auto-renewal. Your site is now live
at `https://hollowvalley.herbydeathsquadgames.com`.

> If you're using Cloudflare's orange-cloud proxy, switch SSL/TLS mode to
> "Full (strict)" in the Cloudflare dashboard once certbot has issued the
> certificate above, so traffic is encrypted end-to-end.

## 6b. Root domain landing page (herbydeathsquadgames.com)

The `landing/` folder is a plain static page (no Node/Docker involved) that
lists your projects with a button into Hollow Valley. To serve it at the bare
root domain:

1. Add a Cloudflare DNS record for the root domain:

   ```
   Type: A
   Name: @
   IPv4 address: <your server's public IP>
   Proxy status: DNS only at first (needed for certbot), switch to Proxied
                 after the cert is issued
   ```

2. On the server, enable the Nginx site (already cloned as part of the repo):

   ```bash
   sudo cp nginx/herbydeathsquadgames.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/herbydeathsquadgames.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d herbydeathsquadgames.com -d www.herbydeathsquadgames.com
   ```

Now `https://herbydeathsquadgames.com` shows the studio landing page, and its
"Enter the Server" button links to `https://hollowvalley.herbydeathsquadgames.com/`.
To edit the landing page copy/branding later, just edit `landing/index.html`
and `git pull` on the server (no rebuild needed, it's static).

## 7. Updating the site later

```bash
cd hollow-valley-site
git pull
docker compose up -d --build
```

## Alternative: no Docker (systemd)

If you'd rather not use Docker:

```bash
cd /opt
sudo git clone https://github.com/Goofylagaming/hollow-valley-site.git
cd hollow-valley-site
npm install --omit=dev
cp .env.example .env   # fill in values
sudo cp nginx/hollowvalley.service /etc/systemd/system/hollowvalley.service
sudo systemctl daemon-reload
sudo systemctl enable --now hollowvalley
```

Then follow step 6 above for Nginx + HTTPS.

## What's real vs. still a placeholder

- **Login (Discord OAuth), wallet balance, quest claims, daily bonus, transaction
  history** — fully working, persisted in SQLite.
- **Species database** — served from `server/data/species.json`, real API-backed.
- **My Dinos (storage), Marketplace (official catalog + peer listings), Skins**
  — fully working economy: buy official dinos with Valley Coin, resell your
  own dinos to other players, create/apply custom skins. All balances and
  ownership are real, tracked in SQLite — nothing here is fabricated.
- **Supporter tiers** — the tier info, status and cancel-auto-renew all work.
  Checkout is gated behind `STRIPE_SECRET_KEY` (see section 3b) so no fake
  purchases are ever granted.
- **Live map / player positions, leaderboards** — the
  API endpoints exist and return real (currently empty) data. They will only
  show real content once your actual game server can report player
  positions/kills/roster — that requires a separate ingestion bridge (e.g. a
  small script reading the Isle server's logs or an RCON tool) that POSTs
  data into this app. That's a follow-up task once the server itself exists.
