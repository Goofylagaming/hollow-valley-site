const PLAYER_PAGE_SIZE = 15;
const MANAGE_GUILD_PERMISSION = '32';

const STAFF_COMMAND_DEFINITIONS = [
  {
    name: 'players',
    description: 'Show the current Hollow Valley player overview for staff.',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [{
      type: 4,
      name: 'page',
      description: 'Player list page.',
      required: false,
      min_value: 1,
    }],
  },
  {
    name: 'queue',
    description: 'Show BodyDrop, DinoStorage and HerbyBot queue health for staff.',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
  },
  {
    name: 'activity',
    description: 'Show Hollow Valley player activity analytics for staff.',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [{
      type: 3,
      name: 'window',
      description: 'Analytics window.',
      required: false,
      choices: [
        { name: '24 hours', value: '24h' },
        { name: '7 days', value: '7d' },
        { name: '30 days', value: '30d' },
      ],
    }],
  },
];

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function escapeDiscordText(value) {
  return String(value ?? '')
    .replaceAll('@', '@\u200b')
    .replaceAll('`', 'ˋ')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('~', '\\~')
    .slice(0, 120);
}

function growthLabel(value) {
  const growth = Number(value);
  if (!Number.isFinite(growth)) return 'growth unknown';
  const percent = growth <= 1 ? growth * 100 : growth;
  return `${Math.max(0, Math.round(percent))}% growth`;
}

function playersReply(overview = {}, requestedPage = 1) {
  const server = overview.server || {};
  const players = Array.isArray(server.players) ? server.players : [];
  const totalPages = Math.max(1, Math.ceil(players.length / PLAYER_PAGE_SIZE));
  const page = Math.max(1, Math.min(totalPages, Number(requestedPage) || 1));
  const start = (page - 1) * PLAYER_PAGE_SIZE;
  const pagePlayers = players.slice(start, start + PLAYER_PAGE_SIZE);

  const lines = pagePlayers.map((player, index) => {
    const species = player.species ? escapeDiscordText(player.species) : 'Unknown species';
    return `${start + index + 1}. **${escapeDiscordText(player.name || 'Unknown player')}** — ${species}, ${growthLabel(player.growth)}`;
  });

  return {
    ephemeral: true,
    embeds: [{
      title: 'Hollow Valley Players',
      description: !server.configured
        ? '⚪ RCON is not configured.'
        : !server.online
          ? '🔴 Evrima server is currently offline.'
          : lines.length ? lines.join('\n') : 'No players are currently online.',
      fields: [{
        name: 'Online',
        value: server.maxPlayers ? `${formatCount(server.playerCount)}/${server.maxPlayers}` : String(formatCount(server.playerCount)),
        inline: true,
      }],
      footer: { text: `Page ${page}/${totalPages} · Staff view excludes Steam IDs and coordinates` },
    }],
  };
}

function queueReply(overview = {}) {
  const requests = overview.requests || {};
  const outbox = overview.outbox || {};

  return {
    ephemeral: true,
    embeds: [{
      title: 'Hollow Valley Queues',
      description: 'Read-only queue and delivery overview.',
      fields: [
        {
          name: 'Game automation',
          value: `Pending: ${formatCount(requests.pending)}\nConfirmed/accepted: ${formatCount(requests.confirmed)}\nFailed: ${formatCount(requests.failed)}\nUnknown: ${formatCount(requests.unknown)}`,
          inline: true,
        },
        {
          name: 'Requests',
          value: `BodyDrop: ${formatCount(requests.bodyDrop)}\nDinoStorage: ${formatCount(requests.dinoStorage)}\nTotal tracked: ${formatCount(requests.total)}`,
          inline: true,
        },
        {
          name: 'HerbyBot outbox',
          value: `Pending: ${formatCount(outbox.pending)}\nClaimed: ${formatCount(outbox.claimed)}\nDelivered: ${formatCount(outbox.delivered)}\nFailed: ${formatCount(outbox.failed)}`,
          inline: true,
        },
      ],
    }],
  };
}

function formatTrackedMinutes(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  if (value < 60) return `${Math.round(value)}m`;
  const hours = value / 60;
  return hours >= 100 ? `${Math.round(hours)}h` : `${Math.round(hours * 10) / 10}h`;
}

function activityWindowHours(value) {
  if (value === '7d') return 168;
  if (value === '30d') return 720;
  return 24;
}

function activityReply(analytics = {}) {
  const topPlayers = (analytics.topPlayers || []).slice(0, 5);
  const topSpecies = (analytics.topSpecies || []).slice(0, 5);

  return {
    ephemeral: true,
    embeds: [{
      title: 'Hollow Valley Player Activity',
      description: analytics.enabled
        ? `Tracked over the last ${analytics.hours === 168 ? '7 days' : analytics.hours === 720 ? '30 days' : '24 hours'}.`
        : 'Presence tracking is currently disabled.',
      fields: [
        {
          name: 'Players',
          value: `Unique: ${formatCount(analytics.uniquePlayers)}\nReturning: ${formatCount(analytics.returningPlayers)}\nPeak: ${formatCount(analytics.peakConcurrent)}\nAvg online: ${Number(analytics.averageOnline) || 0}`,
          inline: true,
        },
        {
          name: 'Sessions',
          value: `Sessions: ${formatCount(analytics.sessions)}\nTracked: ${formatTrackedMinutes(analytics.trackedMinutes)}\nAverage: ${formatTrackedMinutes(analytics.averageSessionMinutes)}\nLongest: ${formatTrackedMinutes(analytics.longestSessionMinutes)}`,
          inline: true,
        },
        {
          name: 'Top players',
          value: topPlayers.length
            ? topPlayers.map((player, index) => `${index + 1}. ${escapeDiscordText(player.name)} — ${formatTrackedMinutes(player.trackedMinutes)}`).join('\n')
            : 'No tracked players yet.',
          inline: false,
        },
        {
          name: 'Top species',
          value: topSpecies.length
            ? topSpecies.map((item, index) => `${index + 1}. ${escapeDiscordText(item.species)} — ${formatCount(item.samplePlayerCount)} samples`).join('\n')
            : 'No species samples yet.',
          inline: false,
        },
      ],
      footer: { text: `${formatCount(analytics.sampleCount)} successful aggregate samples · Steam IDs excluded` },
    }],
  };
}

function isStaffOverviewCommand(name) {
  return STAFF_COMMAND_DEFINITIONS.some((command) => command.name === name);
}

async function handleStaffOverviewCommand(interaction, api) {
  if (!isStaffOverviewCommand(interaction.commandName)) return false;

  if (interaction.commandName === 'activity') {
    const window = interaction.options?.getString?.('window') || '24h';
    return activityReply(await api.getActivity(activityWindowHours(window)));
  }

  const overview = await api.getStaffOverview();
  if (interaction.commandName === 'players') {
    const page = interaction.options?.getInteger?.('page') || 1;
    return playersReply(overview, page);
  }
  return queueReply(overview);
}

module.exports = {
  PLAYER_PAGE_SIZE,
  STAFF_COMMAND_DEFINITIONS,
  escapeDiscordText,
  growthLabel,
  playersReply,
  queueReply,
  activityReply,
  activityWindowHours,
  formatTrackedMinutes,
  isStaffOverviewCommand,
  handleStaffOverviewCommand,
};
