const automation = require('./herbyBotAutomationClient');
const { STAFF_COMMAND_DEFINITIONS, isStaffOverviewCommand, handleStaffOverviewCommand } = require('./herbyBotStaffCommands');
const { STAFF_ACTION_DEFINITIONS, isStaffActionCommand, handleStaffActionCommand } = require('./herbyBotStaffActions');

const MANAGE_GUILD_PERMISSION = '32';

const COMMANDS = [
  {
    name: 'server',
    description: 'Show the current Hollow Valley Evrima server status.',
  },
  {
    name: 'profile',
    description: 'Show your permanent Hollow Valley level, dino rank and achievements.',
  },
  {
    name: 'level',
    description: 'Show your Hollow Valley XP and progress to the next level.',
  },
  {
    name: 'achievements',
    description: 'Show your permanent Hollow Valley achievements.',
  },
  {
    name: 'leaderboard',
    description: 'Show the Hollow Valley progression leaderboard.',
    options: [{
      type: 3,
      name: 'type',
      description: 'Leaderboard to show',
      required: false,
      choices: [
        { name: 'Levels', value: 'levels' },
        { name: 'Achievements', value: 'achievements' },
      ],
    }],
  },
  {
    name: 'automation',
    description: 'Show Hollow Valley automation health for staff.',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
  },
  ...STAFF_COMMAND_DEFINITIONS,
  ...STAFF_ACTION_DEFINITIONS,
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

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-AU');
}

function progressBar(percent) {
  const filled = Math.max(0, Math.min(10, Math.round(Number(percent || 0) / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function profileReply(profile = {}) {
  const nextRank = profile.nextRank
    ? `${profile.nextRank.name} at level ${profile.nextRank.level}`
    : 'Apex rank reached';
  return {
    embeds: [{
      title: `${profile.username || 'Hollow Valley Player'} · Level ${formatCount(profile.level)}`,
      description: `🦖 **${profile.rank?.name || 'Hypsilophodon'}**\n${progressBar(profile.progressPercent)} ${formatCount(profile.progressPercent)}%`,
      fields: [
        {
          name: 'XP',
          value: profile.xpForNextLevel
            ? `${formatNumber(profile.xp)} total · ${formatNumber(profile.xpNeededForNextLevel)} to next level`
            : `${formatNumber(profile.xp)} total`,
          inline: false,
        },
        { name: 'Next dino rank', value: nextRank, inline: true },
        { name: 'Achievements', value: formatNumber(profile.achievementCount), inline: true },
        { name: 'Level reward', value: `+${formatNumber(profile.levelRewardVc || 100)} VC every level`, inline: true },
        { name: 'Verified playtime', value: `${Math.floor(Number(profile.verifiedPlaytimeMinutes || 0) / 60)}h ${Number(profile.verifiedPlaytimeMinutes || 0) % 60}m`, inline: true },
        { name: 'Quests', value: formatNumber(profile.questsCompleted), inline: true },
        { name: 'Events', value: formatNumber(profile.eventsAttended), inline: true },
      ],
      footer: { text: 'Permanent Hollow Valley progression · does not reset' },
    }],
  };
}

function levelReply(profile = {}) {
  return {
    embeds: [{
      title: `Level ${formatCount(profile.level)} · ${profile.rank?.name || 'Hollow Valley'}`,
      description: `${progressBar(profile.progressPercent)} **${formatCount(profile.progressPercent)}%**`,
      fields: [
        { name: 'Total XP', value: formatNumber(profile.xp), inline: true },
        { name: 'XP to next level', value: profile.xpForNextLevel ? formatNumber(profile.xpNeededForNextLevel) : '—', inline: true },
        { name: 'Reward on level-up', value: `+${formatNumber(profile.levelRewardVc || 100)} VC`, inline: true },
      ],
      footer: { text: `Verified playtime earns ${formatNumber(profile.xpPer5Minutes || 10)} XP every 5 minutes` },
    }],
  };
}

function achievementsReply(profile = {}) {
  const achievements = Array.isArray(profile.achievements) ? profile.achievements : [];
  const lines = achievements.slice(0, 15).map((item) => `🏆 **${item.title}** — ${item.description}`);
  if (achievements.length > 15) lines.push(`…and ${achievements.length - 15} more.`);
  return {
    embeds: [{
      title: `Achievements · ${formatNumber(achievements.length)} unlocked`,
      description: lines.length ? lines.join('\n') : 'No achievements unlocked yet. Keep playing Hollow Valley to discover them.',
      footer: { text: 'Achievements are permanent' },
    }],
  };
}

function leaderboardReply(payload = {}, type = 'levels') {
  const players = Array.isArray(payload.players) ? [...payload.players] : [];
  if (type === 'achievements') {
    players.sort((a, b) => Number(b.achievementCount || 0) - Number(a.achievementCount || 0) || Number(b.xp || 0) - Number(a.xp || 0));
  }
  const top = players.slice(0, 10);
  const lines = top.map((player, index) => {
    const name = player.username || `Steam ${String(player.steamId || '').slice(-6)}`;
    return type === 'achievements'
      ? `**${index + 1}. ${name}** — ${formatNumber(player.achievementCount)} achievements · Lv ${formatCount(player.level)}`
      : `**${index + 1}. ${name}** — Lv ${formatCount(player.level)} · ${player.rank?.name || 'Hollow Valley'} · ${formatNumber(player.xp)} XP`;
  });
  return {
    embeds: [{
      title: type === 'achievements' ? 'Hollow Valley Achievement Leaders' : 'Hollow Valley Level Leaders',
      description: lines.length ? lines.join('\n') : 'No permanent progression has been recorded yet.',
      footer: { text: 'Permanent progression leaderboard' },
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

    const staffCommand = interaction.commandName === 'automation' || isStaffOverviewCommand(interaction.commandName) || isStaffActionCommand(interaction.commandName);
    if (staffCommand && !hasStaffAccess(interaction)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: 'You do not have permission to use this command.',
      });
      return true;
    }

    if (interaction.deferReply && !interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: staffCommand });
    }

    try {
      if (['profile', 'level', 'achievements'].includes(interaction.commandName)) {
        const discordId = String(interaction.user?.id || interaction.member?.user?.id || '').trim();
        const payload = await api.getProgression(discordId);
        if (interaction.commandName === 'profile') await safeReply(interaction, profileReply(payload.profile));
        if (interaction.commandName === 'level') await safeReply(interaction, levelReply(payload.profile));
        if (interaction.commandName === 'achievements') await safeReply(interaction, achievementsReply(payload.profile));
        return true;
      }
      if (interaction.commandName === 'leaderboard') {
        const type = interaction.options?.getString?.('type') || 'levels';
        await safeReply(interaction, leaderboardReply(await api.getProgressionLeaderboard(), type));
        return true;
      }
      if (isStaffOverviewCommand(interaction.commandName)) {
        await safeReply(interaction, await handleStaffOverviewCommand(interaction, api));
        return true;
      }
      if (isStaffActionCommand(interaction.commandName)) {
        await safeReply(interaction, await handleStaffActionCommand(interaction, api));
        return true;
      }
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
      const progressionCommand = ['profile', 'level', 'achievements', 'leaderboard'].includes(interaction.commandName);
      await safeReply(interaction, {
        ephemeral: staffCommand || progressionCommand,
        content: interaction.commandName === 'server'
          ? 'Hollow Valley status is temporarily unavailable.'
          : progressionCommand
            ? (error?.payload?.error || error.message || 'Hollow Valley progression is temporarily unavailable.')
            : `Staff automation data is unavailable: ${error.message}`,
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
  profileReply,
  levelReply,
  achievementsReply,
  leaderboardReply,
  hasStaffAccess,
  createHerbyBotCommandHandler,
  registerHerbyBotCommands,
  attachHerbyBotCommands,
};
