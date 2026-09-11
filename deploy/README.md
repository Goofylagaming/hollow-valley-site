# Auto-deploy via GitHub webhook

Pushing to `master` on GitHub triggers an instant redeploy on the droplet —
no manual SSH needed. This is powered by the `webhook` tool
(https://github.com/adnanh/webhook), listening only on localhost and proxied
through Nginx at `/hooks/deploy`.

## One-time server setup

```bash
sudo apt install -y webhook

# Generate a secret and put it in hooks.json (already done once by the
# person setting this up — see below if you need to rotate it).
sudo cp deploy/hooks.json /opt/hollow-valley-site/deploy/hooks.json
sudo chmod +x /opt/hollow-valley-site/deploy/deploy.sh

sudo cp deploy/hollowvalley-webhook.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hollowvalley-webhook

# Nginx already proxies /hooks/ -> 127.0.0.1:9000 (see nginx/hollowvalley.conf)
sudo nginx -t && sudo systemctl reload nginx
```

## GitHub side

Repo → Settings → Webhooks → Add webhook:

- Payload URL: `https://hollowvalley.herbydeathsquadgames.com/hooks/deploy`
- Content type: `application/json`
- Secret: the same secret baked into `hooks.json`'s
  `trigger-rule.match.secret`
- Events: just the `push` event
- Active: checked

Every push to `master` now runs `deploy/deploy.sh` on the server:
`git fetch` + `git reset --hard origin/master`, `docker compose up -d
--build`, and an Nginx reload (so static files like `landing/index.html`
also update instantly, and app code changes get rebuilt automatically).

## Rotating the secret

```bash
openssl rand -hex 32
```

Update the value in both `deploy/hooks.json` on the server and the GitHub
webhook's "Secret" field, then:

```bash
sudo systemctl restart hollowvalley-webhook
```

## Logs

```bash
sudo journalctl -u hollowvalley-webhook -f   # webhook listener logs
tail -f /var/log/hollowvalley-deploy.log     # deploy script output
```

<!-- webhook test 2026-09-12T09:47:58.5295363+10:00 -->
