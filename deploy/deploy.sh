#!/usr/bin/env bash
# Auto-deploy script, triggered by the GitHub webhook on push to master.
# Pulls latest code, rebuilds/restarts the Docker app, and reloads Nginx
# in case static assets (e.g. the landing page) changed.
set -euo pipefail

REPO_DIR="/opt/hollow-valley-site"
LOG_FILE="/var/log/hollowvalley-deploy.log"

{
  echo "===== Deploy started: $(date -u +%FT%TZ) ====="
  cd "$REPO_DIR"

  export GIT_SSH_COMMAND="ssh -i /root/.ssh/deploy_key -o StrictHostKeyChecking=no"
  git fetch origin master
  git reset --hard origin/master

  docker compose up -d --build

  nginx -t && systemctl reload nginx

  echo "===== Deploy finished: $(date -u +%FT%TZ) ====="
} >> "$LOG_FILE" 2>&1
