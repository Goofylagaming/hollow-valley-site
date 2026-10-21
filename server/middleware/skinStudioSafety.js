const PRODUCTION_SERVICE_ID = "srv-dajsk9nqj5pc73euebdg";
const PRODUCTION_RENDER_HOST = "hollow-valley-site.onrender.com";
const SITE_URL_KEYS = ["RENDER_EXTERNAL_URL", "PUBLIC_SITE_URL", "STEAM_REALM", "STEAM_RETURN_URL"];
const READ_ONLY_REASON = "This is a read-only Skin Studio preview. You can browse saved skins and try colours, but saving, purchases and game actions are disabled here.";

function configuredHostname(value) {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function isPreviewHostname(hostname) {
  if (!hostname) return false;
  if (["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname)) return true;
  if (hostname.endsWith(".onrender.com")) return hostname !== PRODUCTION_RENDER_HOST;
  return /(?:^|[.-])(?:test|preview|staging)(?:[.-]|$)/.test(hostname);
}

function getSkinStudioSafety(env = process.env) {
  const forcedReadOnly = /^(?:1|true|yes|on)$/i.test(String(env.SKIN_STUDIO_READ_ONLY || "").trim());
  const serviceId = String(env.RENDER_SERVICE_ID || "").trim();
  // Deployment configuration is authoritative. Never use a request's Host or
  // forwarded headers to decide whether it may write to the skin database.
  const previewService = Boolean(serviceId && serviceId !== PRODUCTION_SERVICE_ID);
  const previewUrl = SITE_URL_KEYS.some((key) => isPreviewHostname(configuredHostname(env[key])));
  const readOnly = forcedReadOnly || previewService || previewUrl;
  return {
    readOnly,
    reason: readOnly ? READ_ONLY_REASON : null,
    reasonCode: readOnly ? "SKIN_STUDIO_READ_ONLY" : null,
  };
}

function getSkinStudioContext(user, env = process.env) {
  const safety = getSkinStudioSafety(env);
  const loggedIn = Boolean(user);
  const steamLinked = /^\d{17}$/.test(String(user?.steam_id || ""));
  const canWrite = !safety.readOnly && steamLinked;
  return {
    ...safety,
    loggedIn,
    steamLinked,
    capabilities: {
      preview: true,
      importPreview: loggedIn,
      save: canWrite,
      wear: canWrite,
      buy: canWrite,
      manage: canWrite && Boolean(user?.is_admin),
      share: canWrite && Boolean(user?.is_admin),
    },
  };
}

function skinMutationGuard(req, res, next) {
  const safety = getSkinStudioSafety();
  if (!safety.readOnly) return next();
  const method = String(req.method || "").toUpperCase();
  const endpoint = String(req.path || "/").replace(/\/+$/, "").toLowerCase() || "/";
  const parsePreview = method === "POST"
    && ["/external/preview", "/external/batch-preview"].includes(endpoint);
  // The upstream wear-state GET reconciles jobs and writes live assignments.
  // Treat it as a mutation here even though the browser normally reads it.
  const reconcilesWear = ["GET", "HEAD"].includes(method) && endpoint === "/wear-state";
  if (parsePreview || (["GET", "HEAD", "OPTIONS"].includes(method) && !reconcilesWear)) return next();
  return res.status(403).json({
    error: safety.reason,
    code: "SKIN_STUDIO_READ_ONLY",
    readOnly: true,
  });
}

function startSkinSharePolicySync(sync, { env = process.env, schedule = setInterval } = {}) {
  if (getSkinStudioSafety(env).readOnly) return null;
  sync();
  const timer = schedule(sync, 5 * 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = {
  getSkinStudioSafety,
  getSkinStudioContext,
  skinMutationGuard,
  startSkinSharePolicySync,
};
