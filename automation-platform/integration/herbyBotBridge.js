const automation = require('./herbyBotAutomationClient');

function destinationChannelId(destination) {
  if (destination === 'announcement') {
    return String(process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || '').trim();
  }
  if (destination === 'alert') {
    return String(process.env.DISCORD_ALERT_CHANNEL_ID || '').trim();
  }
  return '';
}

async function deliverEvent(client, event) {
  if (!client?.isReady?.()) throw new Error('HerbyBot Discord client is not ready');
  const channelId = destinationChannelId(event?.destination);
  if (!channelId) throw new Error(`Discord channel is not configured for HerbyBot destination: ${event?.destination || 'unknown'}`);

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) throw new Error('Configured HerbyBot destination is not a text channel');

  const message = await channel.send({
    content: String(event.message || ''),
    allowedMentions: { parse: [] },
    nonce: String(event.nonce || event.id),
    enforceNonce: true,
  });
  return { discordMessageId: message?.id || null, channelId };
}

function createHerbyBotAutomationBridge({
  client,
  pollIntervalMs = Number(process.env.HERBYBOT_AUTOMATION_POLL_INTERVAL_MS || 15000),
  batchSize = Number(process.env.HERBYBOT_AUTOMATION_BATCH_SIZE || 10),
  leaseSeconds = Number(process.env.HERBYBOT_AUTOMATION_LEASE_SECONDS || 60),
  api = automation,
} = {}) {
  if (!client) throw new Error('Existing HerbyBot Discord client is required');
  let cycleRunning = false;
  let timer = null;

  async function pollOnce() {
    if (cycleRunning) return { skipped: true, reason: 'poll-already-running' };
    if (!client.isReady?.()) return { skipped: true, reason: 'discord-not-ready' };
    cycleRunning = true;
    let delivered = 0;
    let failed = 0;
    try {
      const payload = await api.claimMessages({ limit: batchSize, leaseSeconds });
      const events = Array.isArray(payload?.events) ? payload.events : [];
      for (const event of events) {
        try {
          await deliverEvent(client, event);
          await api.acknowledgeMessage(event.id);
          delivered += 1;
        } catch (error) {
          failed += 1;
          await api.failMessage(event.id, error.message).catch(() => {});
        }
      }
      return { skipped: false, checked: events.length, delivered, failed };
    } finally {
      cycleRunning = false;
    }
  }

  function start() {
    if (timer) return timer;
    const interval = Math.max(5000, Number(pollIntervalMs) || 15000);
    pollOnce().catch((error) => console.warn('[herbybot-automation]', error.message));
    timer = setInterval(() => {
      pollOnce().catch((error) => console.warn('[herbybot-automation]', error.message));
    }, interval);
    timer.unref?.();
    return timer;
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, pollOnce };
}

module.exports = {
  destinationChannelId,
  deliverEvent,
  createHerbyBotAutomationBridge,
};
