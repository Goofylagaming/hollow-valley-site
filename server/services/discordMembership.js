const { db, getSupporterStatus } = require("../db");
const { normalizeTier } = require("./supporterTiers");
const membershipEntitlements = require("./membershipEntitlements");
const { getSkinStudioSafety } = require("../middleware/skinStudioSafety");

const ROLE_NAMES = Object.freeze({
  supporter: "Valley Supporter",
  guardian: "Valley Guardian",
  legend: "Valley Legend",
});
const LEGACY_ROLE_NAMES = new Set(["Valley Member", "Valley Elite"]);

function configuredRoleIds(env = process.env) {
  const ids = {
    supporter: String(env.DISCORD_ROLE_SUPPORTER_ID || "").trim(),
    guardian: String(env.DISCORD_ROLE_GUARDIAN_ID || "").trim(),
    legend: String(env.DISCORD_ROLE_LEGEND_ID || "").trim(),
  };
  return Object.fromEntries(Object.entries(ids).filter(([, id]) => /^\d{15,22}$/.test(id)));
}

class DiscordMembershipError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function configuration(env = process.env) {
  const token = String(env.DISCORD_ROLE_BOT_TOKEN || "").trim();
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  if (!token || !/^\d{15,22}$/.test(guildId)) return null;
  return { token, guildId, apiBase: "https://discord.com/api/v10" };
}

function automaticSyncEnabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.MEMBERSHIP_DISCORD_SYNC_ENABLED || "").trim());
}

function targetTierForStatus(status, { env = process.env, now = Date.now() } = {}) {
  if (membershipEntitlements.enabled(env)) return membershipEntitlements.entitlement(status, { env, now }).tier;
  return status && ["active", "trialing"].includes(status.stripe_status) ? normalizeTier(status.tier) : null;
}

function syncGate(env) {
  if (!configuration(env)) return { configured: false, changed: false };
  if (getSkinStudioSafety(env).readOnly) return { configured: true, changed: false, skipped: true, reason: "preview" };
  if (membershipEntitlements.enabled(env) && !automaticSyncEnabled(env)) return { configured: true, changed: false, skipped: true, reason: "disabled" };
  return null;
}

async function discordRequest(path, { method = "GET", body = null } = {}, env = process.env, fetchImpl = globalThis.fetch) {
  const config = configuration(env);
  if (!config) throw new DiscordMembershipError(503, "Discord membership role sync is not configured.");
  const response = await fetchImpl(`${config.apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${config.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    let retryAfterMs = null;
    try {
      const payload = await response.json();
      const seconds = Number(payload?.retry_after);
      if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = Math.min(3600000, Math.ceil(seconds * 1000));
    } catch {}
    const error = new DiscordMembershipError(
      response.status >= 400 && response.status < 500 ? 502 : 503,
      `Discord role sync failed (HTTP ${response.status}).`
    );
    error.code = response.status === 429 ? "DISCORD_RATE_LIMITED" : response.status === 403 ? "DISCORD_PERMISSION_REQUIRED" :
      response.status === 404 && /\/members\//.test(path) ? "DISCORD_MEMBER_UNAVAILABLE" : "DISCORD_SYNC_FAILED";
    error.retryAfterMs = retryAfterMs;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function listRoles(env, fetchImpl) {
  const config = configuration(env);
  return discordRequest(`/guilds/${config.guildId}/roles`, {}, env, fetchImpl);
}

async function ensureRoleForTier(tier, env, fetchImpl) {
  if (!ROLE_NAMES[tier]) return null;
  const config = configuration(env);
  let roles = await listRoles(env, fetchImpl);
  let role = roles.find((item) => item?.name === ROLE_NAMES[tier]);
  if (role) return { role, roles };
  role = await discordRequest(
    `/guilds/${config.guildId}/roles`,
    { method: "POST", body: { name: ROLE_NAMES[tier], hoist: false, mentionable: false } },
    env,
    fetchImpl
  );
  roles = [...roles, role];
  return { role, roles };
}

async function syncDiscordMembershipForUser(userId, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const gate = syncGate(env);
  if (gate) return gate;
  const user = db.prepare("SELECT id, discord_id FROM users WHERE id = ?").get(userId);
  if (!/^\d{15,22}$/.test(String(user?.discord_id || ""))) return { configured: true, linked: false, changed: false };
  const status = getSupporterStatus(userId);
  const targetTier = targetTierForStatus(status, { env, now });
  return syncRolesForDiscord(String(user.discord_id), targetTier, { env, fetchImpl });
}

async function removeMembershipRolesForDiscord(discordId, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const gate = syncGate(env);
  if (gate) return gate;
  if (!/^\d{15,22}$/.test(String(discordId || ""))) throw new DiscordMembershipError(400, "Invalid linked Discord account.");
  try { return await syncRolesForDiscord(String(discordId), null, { env, fetchImpl }); }
  catch (error) {
    // A member who has left the guild no longer has any guild roles to remove.
    if (error.code === "DISCORD_MEMBER_UNAVAILABLE") return { configured: true, linked: false, changed: false };
    throw error;
  }
}

async function syncRolesForDiscord(discordId, targetTier, { env, fetchImpl }) {
  const config = configuration(env);

  const exactRoleIds = configuredRoleIds(env);
  const hasAllExactRoleIds = Object.keys(ROLE_NAMES).every((tier) => exactRoleIds[tier]);
  let membershipRoles;
  let targetRole = null;

  if (hasAllExactRoleIds) {
    membershipRoles = Object.entries(ROLE_NAMES).map(([tier, name]) => ({ id: exactRoleIds[tier], name, tier }));
    targetRole = targetTier ? membershipRoles.find((role) => role.tier === targetTier) || null : null;
  } else {
    let roles;
    if (targetTier) {
      const ensured = await ensureRoleForTier(targetTier, env, fetchImpl);
      targetRole = ensured.role;
      roles = ensured.roles;
    } else {
      roles = await listRoles(env, fetchImpl);
    }
    membershipRoles = roles.filter(
      (role) => Object.values(ROLE_NAMES).includes(role?.name) || LEGACY_ROLE_NAMES.has(role?.name)
    );
  }

  const member = await discordRequest(`/guilds/${config.guildId}/members/${discordId}`, {}, env, fetchImpl);
  const currentRoleIds = new Set(Array.isArray(member?.roles) ? member.roles.map((roleId) => String(roleId)) : []);
  let changed = false;

  for (const role of membershipRoles) {
    const roleId = String(role.id);
    const shouldHave = Boolean(targetRole && roleId === String(targetRole.id));
    const hasRole = currentRoleIds.has(roleId);
    if (shouldHave === hasRole) continue;
    const path = `/guilds/${config.guildId}/members/${discordId}/roles/${roleId}`;
    await discordRequest(path, { method: shouldHave ? "PUT" : "DELETE" }, env, fetchImpl);
    changed = true;
  }

  return {
    configured: true,
    linked: true,
    discordId,
    changed,
    tier: targetTier,
    roleName: targetTier ? ROLE_NAMES[targetTier] : null,
  };
}

module.exports = {
  ROLE_NAMES,
  DiscordMembershipError,
  configuration,
  configuredRoleIds,
  automaticSyncEnabled,
  targetTierForStatus,
  syncDiscordMembershipForUser,
  removeMembershipRolesForDiscord,
  _test: { ensureRoleForTier, discordRequest },
};
