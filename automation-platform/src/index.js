require('dotenv').config();

const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3100);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'hollow-valley-automation-platform',
    time: new Date().toISOString(),
  });
});

app.get('/status', (_req, res) => {
  res.json({
    ok: true,
    integrations: {
      rcon: Boolean(process.env.EVRIMA_RCON_HOST && process.env.EVRIMA_RCON_PORT),
      commandBridge: Boolean(process.env.GAME_FTP_HOST && process.env.COMMAND_BRIDGE_INBOX_PATH),
      discord: Boolean(process.env.DISCORD_BOT_TOKEN),
      database: Boolean(process.env.DATABASE_URL),
    },
  });
});

app.listen(port, () => {
  console.log(`Hollow Valley automation platform listening on port ${port}`);
});
