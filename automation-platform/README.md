# Hollow Valley Automation Platform

This folder is intentionally isolated from the live Hollow Valley website code.

It is the dedicated home for the automation/control-plane work that will connect the website, Discord, database, Evrima RCON, VeryGames/FTP, BodyDrop, DinoStorage, scheduled jobs, and future server automation.

## Isolation rules

- Build and test automation work on the `automation-platform` branch.
- Do not change the live website or `master` branch unless a feature is ready to integrate.
- Keep game-server credentials and secrets out of Git; use environment variables only.
- Treat website/API integration as an explicit interface rather than importing live-site internals directly.

## Planned structure

```text
automation-platform/
  src/
    index.js              # automation service entrypoint
    adapters/             # RCON, FTP, Discord, website/API integrations
    jobs/                 # scheduled and recurring automation
    services/             # BodyDrop, DinoStorage, player/server logic
    storage/              # persistence/database layer
  .env.example
  package.json
  README.md
```

## First milestone

1. Health/status service
2. Evrima RCON connection layer
3. VeryGames/CommandBridge adapter
4. Reliable command queue + acknowledgements
5. BodyDrop worker
6. DinoStorage worker
7. Discord integration
8. Scheduled automation and monitoring

Nothing in this folder is deployed to production automatically unless we explicitly wire it into Render or another host.
