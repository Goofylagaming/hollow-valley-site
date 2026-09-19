const TIERS = Object.freeze({
  member: Object.freeze({ label: "Valley Member", priceAud: 7 }),
  elite: Object.freeze({ label: "Valley Elite", priceAud: 15 }),
  legend: Object.freeze({ label: "Valley Legend", priceAud: 25 }),
});
const PRICE_ENV = Object.freeze({
  member: "STRIPE_PRICE_MEMBER",
  elite: "STRIPE_PRICE_ELITE",
  legend: "STRIPE_PRICE_LEGEND",
});

class CheckoutError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function liveModeEnabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.STRIPE_LIVE_ENABLED || "").trim());
}

function configuration(env = process.env) {
  const secret = String(env.STRIPE_SECRET_KEY || "").trim();
  const live = liveModeEnabled(env);
  const keyOk = live
    ? /^(sk|rk)_live_/.test(secret)
    : /^(sk|rk)_test_/.test(secret);
  if (!keyOk) return null;

  try {
    // Use server configuration, never Host, Origin or browser-supplied return URLs.
    const origin = new URL(env.RENDER_EXTERNAL_URL || env.STEAM_REALM);
    if (origin.protocol !== "https:" || origin.username || origin.password) return null;
    if (!Object.values(PRICE_ENV).every((name) => /^price_[A-Za-z0-9]+$/.test(env[name] || ""))) return null;
    return { secret, origin: origin.origin, live };
  } catch {
    return null;
  }
}

function checkoutConfigured(env = process.env) {
  return Boolean(configuration(env));
}

function stableIdentityRequired(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.SUPPORTER_REQUIRE_STEAM_ID || "").trim());
}

async function createCheckoutSession({ tier, userId, steamId = null, env = process.env, fetchImpl = globalThis.fetch }) {
  if (!Object.hasOwn(TIERS, tier)) throw new CheckoutError(404, "Unknown supporter tier");
  if (userId === undefined || userId === null || String(userId) === "") {
    throw new CheckoutError(401, "Not logged in");
  }
  const config = configuration(env);
  if (!config) throw new CheckoutError(503, "Supporter checkout is not configured yet.");
  if (stableIdentityRequired(env) && !/^\d{15,22}$/.test(String(steamId || ""))) {
    throw new CheckoutError(409, "A linked Steam account is required before starting a membership.");
  }
  const user = String(userId);
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": env[PRICE_ENV[tier]],
    "line_items[0][quantity]": "1",
    client_reference_id: user,
    "metadata[user_id]": user,
    "metadata[tier]": tier,
    "subscription_data[metadata][user_id]": user,
    "subscription_data[metadata][tier]": tier,
    success_url: `${config.origin}/supporter?checkout=success`,
    cancel_url: `${config.origin}/supporter?checkout=cancelled`,
  });
  if (steamId) {
    body.set("metadata[steam_id]", String(steamId));
    body.set("subscription_data[metadata][steam_id]", String(steamId));
  }
  try {
    const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Stripe rejected checkout");
    const session = await response.json();
    const url = new URL(session.url);
    const expectedPrefix = config.live ? "cs_live_" : "cs_test_";
    if (session.livemode !== config.live || !session.id?.startsWith(expectedPrefix) ||
        url.origin !== "https://checkout.stripe.com" || url.username || url.password) {
      throw new Error("Invalid Stripe checkout response");
    }
    return { url: session.url };
  } catch {
    // Provider errors can contain credentials or request details; keep them private.
    throw new CheckoutError(502, "Unable to start Stripe checkout. Please try again.");
  }
}

module.exports = { TIERS, PRICE_ENV, liveModeEnabled, configuration, checkoutConfigured, stableIdentityRequired, createCheckoutSession, CheckoutError };
