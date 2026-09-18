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

function isStaffOverviewCommand(name) {
  return STAFF_COMMAND_DEFINITIONS.some((command) => command.name === name);
}

async function handleStaffOverviewCommand(interaction, api) {
  if (!isStaffOverviewCommand(interaction.commandName)) return false;
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
  isStaffOverviewCommand,
  handleStaffOverviewCommand,
};
