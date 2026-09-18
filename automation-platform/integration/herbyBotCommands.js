const automation = require('./herbyBotAutomationClient');

const MANAGE_GUILD_PERMISSION = '32';

const COMMANDS = [
  {
    name: 'server',
    description: 'Show the current Hollow Valley Evrima server status.',
  },
  {
    name: 'automation',
    description: 'Show Hollow Valley automation health for staff.',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
  },
];

function commandDefinitions() {
  return COMMANDS.map((command) => ({ ...command }));
}

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function serverReply(status = {}) {
  const server = status.server || {};
  const online = Boolean(server.online);
  const configured = server.configured !== false;
  const playerCount = formatCount(server.playerCount);
  const maxPlayers = Number.isFinite(Number(server.maxPlayers)) ? Number(server.maxPlayers) : null;
  const playerLine = maxPlayers ? `${playerCount}/${maxPlayers} players` : `${playerCount} players online`;

  if (!configured) {
    return {
      embeds: [{
        title: 'Hollow Valley',
        description: '⚪ Server status is not configured yet.',
        fields: [{ name: 'Evrima', value: 'Status unavailable', inline: true }],
      }],
    };
  }

  return {
    embeds: [{
      title: 'Hollow Valley',
      description: online ? '🟢 Evrima server is online.' : '🔴 Evrima server is currently offline.',
      fields: [
        { name: 'Players', value: online ? playerLine : '—', inline: true },
        { name: 'Automation', value: status.automation?.service ? 'Connected' : 'Unavailable', inline: true },
      ],
      footer: status.server?.checkedAt ? { text: `Checked ${new Date(status.server.checkedAt).toLocaleString('en-AU')}` } : undefined,
    }],
  };
}

function automationReply(status = {}) {
  const bridge = status.bridge || {};
  const outbox = bridge.outbox || {};
  const integrations = status.automation?.integrations || {};
  const modules = status.automation?.modules || {};

  return {
    ephemeral: true,
    embeds: [{
      title: 'Hollow Valley Automation',
      description: bridge.configured ? '🟢 HerbyBot bridge connected.' : '🟠 HerbyBot bridge is not configured.',
      fields: [
        {
          name: 'Outbox',
          value: `Pending: ${formatCount(outbox.pending)} · Claimed: ${formatCount(outbox.claimed)} · Failed: ${formatCount(outbox.failed)}`,
          inline: false,
        },
        {
          name: 'Integrations',
          value: `RCON: ${integrations.rcon ? 'ready' : 'not ready'}\nCommandBridge: ${integrations.commandBridge ? 'ready' : 'gated'}\nHerbyBot: ${integrations.herbyBot ? 'ready' : 'not ready'}`,
          inline: true,
        },
        {
          name: 'Modules',
          value: `BodyDrop: ${modules.bodyDrop ? 'built' : 'pending'}\nDinoStorage: ${modules.dinoStorage ? 'built' : 'pending'}\nDiscord handoff: ${modules.discordAutomation ? 'built' : 'pending'}`,
          inline: true,
        },
      ],
    }],
  };
}

function hasStaffAccess(interaction) {
  const permissions = interaction?.memberPermissions;
  if (!permissions?.has) return false;
  try {
    return Boolean(
      permissions.has('Administrator') ||
      permissions.has('ManageGuild') ||
      permissions.has(BigInt(8)) ||
      permissions.has(BigInt(32))
    );
  } catch {
    return false;
  }
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function createHerbyBotCommandHandler({ api = automation } = {}) {
  return async function handleInteraction(interaction) {
    if (!interaction?.isChatInputCommand?.()) return false;
    if (!COMMANDS.some((command) => command.name === interaction.commandName)) return false;

    if (interaction.commandName === 'automation' && !hasStaffAccess(interaction)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: 'You do not have permission to use this command.',
      });
      return true;
    }

    try {
      const status = await api.getStatus();
      if (interaction.commandName === 'server') {
        await safeReply(interaction, serverReply(status));
        return true;
      }
      if (interaction.commandName === 'automation') {
        await safeReply(interaction, automationReply(status));
        return true;
      }
      return false;
    } catch (error) {
      await safeReply(interaction, {
        ephemeral: interaction.commandName === 'automation',
        content: interaction.commandName === 'server'
          ? 'Hollow Valley status is temporarily unavailable.'
          : `Automation status is unavailable: ${error.message}`,
      });
      return true;
    }
  };
}

async function registerHerbyBotCommands(client) {
  if (!client?.application) throw new Error('Ready HerbyBot Discord client is required for command registration');
  const commands = commandDefinitions();
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();

  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    if (!guild?.commands?.set) throw new Error('Configured Discord guild does not support command registration');
    await guild.commands.set(commands);
    return { scope: 'guild', guildId, count: commands.length };
  }

  if (!client.application.commands?.set) throw new Error('HerbyBot application command manager is unavailable');
  await client.application.commands.set(commands);
  return { scope: 'global', guildId: null, count: commands.length };
}

function attachHerbyBotCommands({ client, api = automation, autoRegister = true } = {}) {
  if (!client?.on) throw new Error('Existing HerbyBot Discord client is required');
  const handler = createHerbyBotCommandHandler({ api });
  client.on('interactionCreate', handler);

  async function register() {
    if (!autoRegister) return { skipped: true };
    return registerHerbyBotCommands(client);
  }

  return { handler, register };
}

module.exports = {
  MANAGE_GUILD_PERMISSION,
  commandDefinitions,
  serverReply,
  automationReply,
  hasStaffAccess,
  createHerbyBotCommandHandler,
  registerHerbyBotCommands,
  attachHerbyBotCommands,
};
