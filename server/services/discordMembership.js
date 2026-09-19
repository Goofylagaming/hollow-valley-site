const { db, getSupporterStatus } = require("../db");
const { normalizeTier } = require("./supporterTiers");

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
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.message ? `: ${payload.message}` : "";
    } catch {}
    throw new DiscordMembershipError(
      response.status >= 400 && response.status < 500 ? 502 : 503,
      `Discord role sync failed (HTTP ${response.status})${detail}`
    );
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

async function syncDiscordMembershipForUser(userId, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!configuration(env)) return { configured: false, changed: false };
  const user = db.prepare("SELECT id, discord_id FROM users WHERE id = ?").get(userId);
  if (!user?.discord_id) return { configured: true, linked: false, changed: false };

  const status = getSupporterStatus(userId);
  const entitled = Boolean(status && ["active", "trialing"].includes(status.stripe_status));
  const normalizedTier = normalizeTier(status?.tier);
  const targetTier = entitled && normalizedTier && ROLE_NAMES[normalizedTier] ? normalizedTier : null;
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

  const member = await discordRequest(`/guilds/${config.guildId}/members/${user.discord_id}`, {}, env, fetchImpl);
  const currentRoleIds = new Set(Array.isArray(member?.roles) ? member.roles.map((roleId) => String(roleId)) : []);
  let changed = false;

  for (const role of membershipRoles) {
    const roleId = String(role.id);
    const shouldHave = Boolean(targetRole && roleId === String(targetRole.id));
    const hasRole = currentRoleIds.has(roleId);
    if (shouldHave === hasRole) continue;
    const path = `/guilds/${config.guildId}/members/${user.discord_id}/roles/${roleId}`;
    await discordRequest(path, { method: shouldHave ? "PUT" : "DELETE" }, env, fetchImpl);
    changed = true;
  }

  return {
    configured: true,
    linked: true,
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
  syncDiscordMembershipForUser,
  _test: { ensureRoleForTier, discordRequest },
};
