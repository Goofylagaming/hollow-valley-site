const MANAGE_GUILD_PERMISSION = '32';

const STAFF_ACTION_DEFINITIONS = [
  {
    name: 'announce',
    description: 'Queue a Hollow Valley Discord announcement through HerbyBot.',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [{
      type: 3,
      name: 'message',
      description: 'Announcement message.',
      required: true,
      max_length: 1900,
    }],
  },
  {
    name: 'schedule',
    description: 'Schedule a Hollow Valley announcement through HerbyBot.',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [
      {
        type: 3,
        name: 'message',
        description: 'Announcement message.',
        required: true,
        max_length: 1900,
      },
      {
        type: 4,
        name: 'minutes',
        description: 'Minutes from now to send the first announcement.',
        required: true,
        min_value: 1,
        max_value: 43200,
      },
      {
        type: 3,
        name: 'repeat',
        description: 'Optional recurrence after the first announcement.',
        required: false,
        choices: [
          { name: 'Once', value: 'none' },
          { name: 'Daily', value: 'daily' },
          { name: 'Weekly', value: 'weekly' },
        ],
      },
    ],
  },
];

function isStaffActionCommand(name) {
  return STAFF_ACTION_DEFINITIONS.some((command) => command.name === name);
}

function interactionNonce(interaction) {
  const id = String(interaction?.id || '').trim();
  if (!/^[0-9]{8,32}$/.test(id)) throw new Error('Discord interaction ID is unavailable');
  return id;
}

async function handleStaffActionCommand(interaction, api) {
  if (!isStaffActionCommand(interaction.commandName)) return false;
  const nonce = interactionNonce(interaction);
  const message = interaction.options?.getString?.('message', true);
  if (!message) throw new Error('Announcement message is required');

  if (interaction.commandName === 'announce') {
    const result = await api.queueAnnouncement(message, `slash:${nonce}`);
    return {
      ephemeral: true,
      content: result?.event?.id
        ? `Announcement queued for HerbyBot delivery. Event: \`${result.event.id}\``
        : 'Announcement queued for HerbyBot delivery.',
    };
  }

  const minutes = Number(interaction.options?.getInteger?.('minutes'));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200) {
    throw new Error('Schedule delay must be between 1 and 43200 minutes');
  }
  const recurrence = interaction.options?.getString?.('repeat') || 'none';
  if (!['none', 'daily', 'weekly'].includes(recurrence)) throw new Error('Invalid schedule recurrence');

  const createdAt = Number(interaction.createdTimestamp);
  const baseTime = Number.isFinite(createdAt) ? createdAt : Date.now();
  const runAt = new Date(baseTime + minutes * 60_000).toISOString();
  const result = await api.scheduleAnnouncement({
    message,
    runAt,
    recurrence,
    nonce,
  });
  const unix = Math.floor(new Date(runAt).getTime() / 1000);

  return {
    ephemeral: true,
    embeds: [{
      title: 'Announcement scheduled',
      description: `First delivery: <t:${unix}:F>`,
      fields: [
        { name: 'Repeat', value: recurrence === 'none' ? 'Once' : recurrence, inline: true },
        { name: 'Job', value: result?.job?.id ? `\`${result.job.id}\`` : 'Created', inline: true },
      ],
    }],
  };
}

module.exports = {
  STAFF_ACTION_DEFINITIONS,
  isStaffActionCommand,
  interactionNonce,
  handleStaffActionCommand,
};
