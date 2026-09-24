const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-event-attendance-'));
const dbPath = path.join(dir, 'automation.sqlite');

const previous = {
  AUTOMATION_DB_PATH: process.env.AUTOMATION_DB_PATH,
  EVENT_REWARDS_ENABLED: process.env.EVENT_REWARDS_ENABLED,
  EVENT_ATTENDANCE_BASE_VC: process.env.EVENT_ATTENDANCE_BASE_VC,
  SUPPORTER_COIN_BONUSES_ENABLED: process.env.SUPPORTER_COIN_BONUSES_ENABLED,
  HOLLOW_VALLEY_API_BASE_URL: process.env.HOLLOW_VALLEY_API_BASE_URL,
  HOLLOW_VALLEY_API_TOKEN: process.env.HOLLOW_VALLEY_API_TOKEN,
};

process.env.AUTOMATION_DB_PATH = dbPath;
process.env.EVENT_REWARDS_ENABLED = 'true';
process.env.EVENT_ATTENDANCE_BASE_VC = '10000';
process.env.SUPPORTER_COIN_BONUSES_ENABLED = 'false';

const economy = require('../src/services/economyStore');
const supporter = require('../src/services/supporterBonusService');
const attendance = require('../src/services/eventAttendanceService');
const eventRewards = require('../src/services/eventRewardService');

test.after(() => {
  supporter._test.clearCache();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function event(id = 'event-01', title = 'Migration Night') {
  return {
    eventId: id,
    eventTitle: title,
    eventStart: '2026-10-01T08:00:00.000Z',
    eventEnd: '2026-10-01T10:00:00.000Z',
  };
}

test('website RSVP can be withdrawn and re-added without creating duplicates', () => {
  const steamId = '76561198000001001';
  const first = attendance.upsertAttendee({
    steamId,
    event: event('rsvp-event'),
    source: 'website_rsvp',
  });

  assert.equal(first.duplicate, false);
  assert.equal(first.attendance.status, 'attending');
  assert.equal(first.attendance.source, 'website_rsvp');

  const withdrawn = attendance.withdrawAttendee({ steamId, eventId: 'rsvp-event' });
  assert.equal(withdrawn.changed, true);
  assert.equal(withdrawn.attendance.status, 'withdrawn');

  const readded = attendance.upsertAttendee({
    steamId,
    event: event('rsvp-event'),
    source: 'website_rsvp',
  });
  assert.equal(readded.duplicate, true);
  assert.equal(readded.attendance.status, 'attending');
  assert.equal(attendance.listAttendance({ eventId: 'rsvp-event', includeWithdrawn: true }).length, 1);
});

test('admin can add a raw Steam ID that has no website account', () => {
  const result = attendance.upsertAttendee({
    steamId: '76561198000001002',
    event: event('admin-added-event'),
    source: 'admin',
    addedBySteamId: '76561198000001099',
  });

  assert.equal(result.attendance.source, 'admin');
  assert.equal(result.attendance.addedBySteamId, '76561198000001099');
});

test('regular attendance pays 10,000 VC exactly once', async () => {
  const steamId = '76561198000001003';
  attendance.upsertAttendee({ steamId, event: event('regular-event'), source: 'website_rsvp' });

  const first = await attendance.confirmAttendance({
    eventId: 'regular-event',
    steamId,
    confirmedBySteamId: '76561198000001099',
  }, {
    env: {
      ...process.env,
      EVENT_REWARDS_ENABLED: 'true',
      EVENT_ATTENDANCE_BASE_VC: '10000',
      SUPPORTER_COIN_BONUSES_ENABLED: 'false',
    },
  });

  assert.equal(first.duplicate, false);
  assert.equal(first.baseAmount, 10000);
  assert.equal(first.supporterMultiplier, 1);
  assert.equal(first.payoutAmount, 10000);
  assert.equal(first.wallet.balance, 10000);
  assert.equal(first.transaction.kind, 'event_attendance_reward');
  assert.equal(first.attendance.status, 'paid');

  const duplicate = await attendance.confirmAttendance({
    eventId: 'regular-event',
    steamId,
    confirmedBySteamId: '76561198000001099',
  }, {
    env: {
      ...process.env,
      EVENT_REWARDS_ENABLED: 'true',
      EVENT_ATTENDANCE_BASE_VC: '999999',
      SUPPORTER_COIN_BONUSES_ENABLED: 'false',
    },
  });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.payoutAmount, 10000);
  assert.equal(duplicate.wallet.balance, 10000);
});

test('attendance uses Member x1.5, Elite x3 and Legend x5 multipliers', async (t) => {
  const tiers = [
    ['supporter', 1.5, 15000, 'member-event', '76561198000001011'],
    ['guardian', 3, 30000, 'elite-event', '76561198000001012'],
    ['legend', 5, 50000, 'legend-event', '76561198000001013'],
  ];
  const env = {
    ...process.env,
    EVENT_REWARDS_ENABLED: 'true',
    EVENT_ATTENDANCE_BASE_VC: '10000',
    SUPPORTER_COIN_BONUSES_ENABLED: 'true',
    HOLLOW_VALLEY_API_BASE_URL: 'https://example.test',
    HOLLOW_VALLEY_API_TOKEN: 'test-token',
  };
  const bySteam = new Map(tiers.map(([tier, , , , steamId]) => [steamId, tier]));
  const originalRefresh = supporter.refreshMemberships;
  supporter.refreshMemberships = async (ids, { env: suppliedEnv }) => {
    supporter.replaceMemberships(ids, ids.map((steamId) => ({
      steamId,
      entitled: true,
      tier: bySteam.get(steamId),
    })), suppliedEnv);
    return { skipped: false, requested: ids.length, entitled: ids.length };
  };
  t.after(() => {
    supporter.refreshMemberships = originalRefresh;
    supporter._test.clearCache();
  });

  for (const [tier, multiplier, payout, eventId, steamId] of tiers) {
    attendance.upsertAttendee({ steamId, event: event(eventId), source: 'website_rsvp' });
    const result = await attendance.confirmAttendance({ eventId, steamId }, { env });
    assert.equal(result.supporterTier, tier);
    assert.equal(result.supporterMultiplier, multiplier);
    assert.equal(result.payoutAmount, payout);
  }
});

test('custom bonus pays entered amount and does not multiply unless explicitly enabled', async (t) => {
  const steamId = '76561198000001021';
  const plain = await attendance.awardBonus({
    steamId,
    eventId: 'bonus-event',
    eventTitle: 'Bonus Event',
    amount: 25000,
    label: 'Best Skin',
    bonusId: 'bonus-plain-001',
    applySupporterMultiplier: false,
  }, {
    env: {
      ...process.env,
      EVENT_REWARDS_ENABLED: 'true',
      SUPPORTER_COIN_BONUSES_ENABLED: 'false',
    },
  });

  assert.equal(plain.payoutAmount, 25000);
  assert.equal(plain.supporterMultiplier, 1);
  assert.equal(plain.transaction.kind, 'event_bonus_reward');

  const env = {
    ...process.env,
    EVENT_REWARDS_ENABLED: 'true',
    SUPPORTER_COIN_BONUSES_ENABLED: 'true',
    HOLLOW_VALLEY_API_BASE_URL: 'https://example.test',
    HOLLOW_VALLEY_API_TOKEN: 'test-token',
  };
  const originalRefresh = supporter.refreshMemberships;
  supporter.refreshMemberships = async (ids, { env: suppliedEnv }) => {
    supporter.replaceMemberships(ids, [{ steamId, entitled: true, tier: 'supporter' }], suppliedEnv);
    return { skipped: false, requested: 1, entitled: 1 };
  };
  t.after(() => {
    supporter.refreshMemberships = originalRefresh;
    supporter._test.clearCache();
  });

  const multiplied = await attendance.awardBonus({
    steamId,
    eventId: 'bonus-event',
    eventTitle: 'Bonus Event',
    amount: 10000,
    label: 'Winner bonus',
    bonusId: 'bonus-mult-001',
    applySupporterMultiplier: true,
  }, { env });

  assert.equal(multiplied.supporterMultiplier, 1.5);
  assert.equal(multiplied.payoutAmount, 15000);
  assert.equal(economy.getWallet(steamId).balance, 40000);
});

test('event reward history includes attendance and bonus transactions', async () => {
  const steamId = '76561198000001031';
  attendance.upsertAttendee({ steamId, event: event('history-event'), source: 'admin' });
  await attendance.confirmAttendance({ eventId: 'history-event', steamId }, {
    env: {
      ...process.env,
      EVENT_REWARDS_ENABLED: 'true',
      SUPPORTER_COIN_BONUSES_ENABLED: 'false',
    },
  });
  await attendance.awardBonus({
    steamId,
    eventId: 'history-event',
    eventTitle: 'Migration Night',
    amount: 1234,
    label: 'Objective bonus',
    bonusId: 'history-bonus-001',
  }, {
    env: {
      ...process.env,
      EVENT_REWARDS_ENABLED: 'true',
      SUPPORTER_COIN_BONUSES_ENABLED: 'false',
    },
  });

  const history = eventRewards.listRewards({ steamId });
  assert.equal(history.length, 2);
  assert.deepEqual(new Set(history.map((row) => row.metadata.rewardType)), new Set(['attendance', 'bonus']));
});
