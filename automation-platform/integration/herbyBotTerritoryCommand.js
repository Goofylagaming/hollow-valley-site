const automation = require('./herbyBotAutomationClient');

const TERRITORY_COMMAND = {
  name: 'territory',
  description: 'Show the current Hollow Valley Territory War status.',
};

function formatDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-AU') : 'Not set';
}

function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function territoryReply(payload = {}, env = process.env) {
  const event = payload.event || null;
  if (!event) {
    return {
      embeds: [{
        title: 'Hollow Valley Territory Wars',
        description: 'No Territory War is currently scheduled.',
      }],
    };
  }

  const presence = payload.presence || {};
  const attack = payload.attack || null;
  const mapUrl = /^https:\/\//i.test(String(env.TERRITORY_WARS_MAP_URL || '').trim())
    ? String(env.TERRITORY_WARS_MAP_URL).trim()
    : 'https://hollowvalleyisle.com/groups/territory-wars/';
  const owner = event.owner_name || 'Admin';
  const challenger = event.challenger_name || 'Open';
  const ownerControl = clampPercent(event.owner_control);
  const challengerControl = clampPercent(event.challenger_control);
  const attackText = attack
    ? `${attack.attacker_name || 'Challenger'} · ${String(attack.status || 'active').toUpperCase()}${attack.status === 'warning' ? ` · starts ${formatDate(attack.starts_at)}` : ''}`
    : 'No active attack';

  return {
    embeds: [{
      title: `${event.territory_name || 'Territory'} · Territory War`,
      description: `[Open live Territory Wars view](${mapUrl})`,
      fields: [
        { name: 'Status', value: String(event.status || 'scheduled').toUpperCase(), inline: true },
        { name: 'Owner', value: String(owner), inline: true },
        { name: 'Challenger', value: String(challenger), inline: true },
        { name: 'Control', value: `${owner}: ${ownerControl}%\n${challenger}: ${challengerControl}%`, inline: false },
        {
          name: 'Claim Zone',
          value: `${Number(presence.eligibleClaimCount || 0)} eligible · ${Number(presence.claimCount || 0)} total`,
          inline: true,
        },
        {
          name: 'Battlefield',
          value: `${Number(presence.playerCount || 0)} players`,
          inline: true,
        },
        { name: 'Attack', value: attackText, inline: false },
        { name: 'Starts', value: formatDate(event.starts_at), inline: true },
        { name: 'Ends', value: formatDate(event.ends_at), inline: true },
      ],
      footer: { text: 'Hollow Valley Territory Wars · live website state' },
    }],
  };
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function createTerritoryCommandHandler({ api = automation } = {}) {
  return async function handleTerritoryCommand(interaction) {
    if (!interaction?.isChatInputCommand?.() || interaction.commandName !== 'territory') return false;
    if (interaction.deferReply && !interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: false });
    }
    try {
      const state = await api.getTerritoryWarsState();
      await safeReply(interaction, territoryReply(state));
    } catch (error) {
      await safeReply(interaction, {
        content: error?.payload?.error || error.message || 'Territory Wars status is temporarily unavailable.',
      });
    }
    return true;
  };
}

async function upsertCommand(manager) {
  if (!manager) throw new Error('Discord application command manager is unavailable');
  if (manager.fetch) {
    const existing = await manager.fetch();
    const list = typeof existing?.values === 'function' ? [...existing.values()] : Array.isArray(existing) ? existing : [];
    const current = list.find((command) => command?.name === TERRITORY_COMMAND.name);
    if (current?.edit) {
      await current.edit(TERRITORY_COMMAND);
      return { created: false, updated: true };
    }
  }
  if (!manager.create) throw new Error('Discord application command manager cannot create commands');
  await manager.create(TERRITORY_COMMAND);
  return { created: true, updated: false };
}

async function registerTerritoryCommand(client) {
  if (!client?.application) throw new Error('Ready HerbyBot Discord client is required for Territory command registration');
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    const result = await upsertCommand(guild?.commands);
    return { scope: 'guild', guildId, ...result };
  }
  const result = await upsertCommand(client.application.commands);
  return { scope: 'global', guildId: null, ...result };
}

function attachHerbyBotTerritoryCommand({ client, api = automation, autoRegister = true } = {}) {
  if (!client?.on) throw new Error('Existing HerbyBot Discord client is required');
  const handler = createTerritoryCommandHandler({ api });
  client.on('interactionCreate', handler);

  async function register() {
    if (!autoRegister) return { skipped: true };
    return registerTerritoryCommand(client);
  }

  return { handler, register };
}

module.exports = {
  TERRITORY_COMMAND,
  territoryReply,
  createTerritoryCommandHandler,
  registerTerritoryCommand,
  attachHerbyBotTerritoryCommand,
};
