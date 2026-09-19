const BONUS_PERCENT_BY_TIER = Object.freeze({
  member: 20,
  elite: 50,
  legend: 100,
});

const memberships = new Map();

function enabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.SUPPORTER_COIN_BONUSES_ENABLED || "").trim());
}

function configuration(env = process.env) {
  if (!enabled(env)) return null;
  const baseUrl = String(env.HOLLOW_VALLEY_SITE_URL || "").trim().replace(/\/$/, "");
  const token = String(env.HOLLOW_VALLEY_API_TOKEN || "").trim();
  const timeoutMs = Math.max(
    1000,
    Math.min(15000, Number(env.SUPPORTER_MEMBERSHIP_TIMEOUT_MS || 5000) || 5000)
  );
  if (!/^https?:\/\//i.test(baseUrl) || !token) return null;
  return { baseUrl, token, timeoutMs };
}

function validateSteamId(value) {
  const steamId = String(value || "").trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error("Invalid Steam ID");
  return steamId;
}

function bonusPercentForTier(tier) {
  return BONUS_PERCENT_BY_TIER[String(tier || "").trim()] || 0;
}

function noMembership(steamId) {
  return {
    steamId,
    entitled: false,
    tier: null,
    bonusPercent: 0,
  };
}

function membershipForSteamId(steamId, env = process.env) {
  const id = validateSteamId(steamId);
  if (!enabled(env)) return noMembership(id);
  return memberships.get(id) || noMembership(id);
}

function replaceMemberships(steamIds, records = [], env = process.env) {
  const ids = [...new Set((steamIds || []).map(validateSteamId))];
  const bySteam = new Map(
    (records || [])
      .filter((record) => record && /^\d{17}$/.test(String(record.steamId || "")))
      .map((record) => [String(record.steamId), record])
  );

  let entitled = 0;
  for (const steamId of ids) {
    const record = bySteam.get(steamId);
    const tier = record?.entitled ? String(record.tier || "") : "";
    const bonusPercent = bonusPercentForTier(tier);
    const membership = bonusPercent > 0
      ? { steamId, entitled: true, tier, bonusPercent }
      : noMembership(steamId);
    memberships.set(steamId, membership);
    if (membership.entitled) entitled += 1;
  }
  return { requested: ids.length, entitled };
}

async function refreshMemberships(
  steamIds,
  { env = process.env, fetchImpl = globalThis.fetch } = {}
) {
  const ids = [...new Set((steamIds || [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{17}$/.test(value)))];

  if (!ids.length) return { skipped: true, reason: "no-players", requested: 0, entitled: 0 };

  if (!enabled(env)) {
    replaceMemberships(ids, [], env);
    return { skipped: true, reason: "disabled", requested: ids.length, entitled: 0 };
  }

  const config = configuration(env);
  if (!config) {
    replaceMemberships(ids, [], env);
    return { skipped: true, reason: "not-configured", requested: ids.length, entitled: 0 };
  }

  try {
    const response = await fetchImpl(`${config.baseUrl}/api/internal/supporter-memberships`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ steamIds: ids }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Supporter membership lookup failed (HTTP ${response.status})`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.memberships)) {
      throw new Error("Supporter membership lookup returned an invalid payload");
    }

    const summary = replaceMemberships(ids, payload.memberships, env);
    return { skipped: false, ...summary };
  } catch (error) {
    // Fail closed: a website outage must never keep granting a stale paid bonus.
    replaceMemberships(ids, [], env);
    throw error;
  }
}

function applyBonus(coinsAfterQuestBoost, steamId, env = process.env) {
  const amount = Math.max(0, Math.floor(Number(coinsAfterQuestBoost) || 0));
  const membership = membershipForSteamId(steamId, env);
  const supporterBonusCoins = Math.floor((amount * membership.bonusPercent) / 100);
  return {
    ...membership,
    coinsBeforeSupporterBonus: amount,
    supporterBonusCoins,
    payoutCoins: amount + supporterBonusCoins,
  };
}

function clearCache() {
  memberships.clear();
}

module.exports = {
  BONUS_PERCENT_BY_TIER,
  enabled,
  configuration,
  validateSteamId,
  bonusPercentForTier,
  membershipForSteamId,
  replaceMemberships,
  refreshMemberships,
  applyBonus,
  _test: { clearCache },
};
