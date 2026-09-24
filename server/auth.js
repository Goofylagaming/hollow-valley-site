// Discord OAuth2 account linking.
// Production can use the standard authorization-code flow when a client secret is
// configured, or Discord's supported implicit grant for one-time identity linking
// when only the public application/client ID is available.
const express = require("express");
const { randomBytes } = require("node:crypto");
const { findOrCreateUser, db } = require("./db");
const { syncDiscordMembershipForUser } = require("./services/discordMembership");

const router = express.Router();

const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || "").trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || "").trim();
const DISCORD_REDIRECT_URI = String(process.env.DISCORD_REDIRECT_URI || "").trim();
const ADMIN_DISCORD_IDS = new Set(
  (process.env.ADMIN_DISCORD_IDS || "").split(",").map((id) => id.trim()).filter(Boolean)
);

const hasClientSecret = Boolean(DISCORD_CLIENT_SECRET);
const isConfigured = Boolean(DISCORD_CLIENT_ID && DISCORD_REDIRECT_URI);

function safeReturnPath(value, fallback = "/wallet") {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

function newOAuthState() {
  return randomBytes(24).toString("hex");
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Discord user fetch failed: ${response.status}`);
  return response.json();
}

function linkDiscordUser(req, discordUser) {
  const user = findOrCreateUser({
    currentUserId: req.session.userId,
    discordId: discordUser.id,
    username: `${discordUser.username}`,
    avatar: discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : null,
  });

  if (ADMIN_DISCORD_IDS.has(discordUser.id)) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
  }

  req.session.userId = user.id;
  syncDiscordMembershipForUser(user.id).catch((error) => {
    console.warn("Discord membership role sync warning:", error.message);
  });
  return user;
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

router.get("/discord", (req, res) => {
  if (!isConfigured) {
    return res.status(503).send("Discord linking is not configured yet.");
  }

  const returnTo = safeReturnPath(req.query.returnTo, req.user ? "/wallet" : "/");
  const state = newOAuthState();
  req.session.discordReturnPath = returnTo;
  req.session.discordOAuthState = state;

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: hasClientSecret ? "code" : "token",
    scope: "identify",
    state,
  });

  req.session.save((error) => {
    if (error) {
      console.error("Discord OAuth session save failed:", error);
      return res.redirect("/?login=failed");
    }
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });
});

router.get("/discord/callback", async (req, res) => {
  if (!isConfigured) return res.redirect("/");

  // With no server-side client secret, Discord's implicit grant returns the
  // access token in the URL fragment. Fragments never reach the server, so this
  // tiny callback page immediately posts the token back over the same HTTPS
  // origin, then removes it from the address bar by replacing the page.
  if (!hasClientSecret) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Linking Discord…</title></head>
<body><p id="status">Linking your Discord account…</p>
<script>
(async () => {
  const status = document.getElementById("status");
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const accessToken = params.get("access_token");
    const state = params.get("state");
    if (!accessToken || !state) throw new Error("Discord did not return an authorization token.");
    history.replaceState(null, "", location.pathname);
    const response = await fetch("/auth/discord/implicit-callback", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, state }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Discord linking failed.");
    location.replace(result.returnTo || "/wallet");
  } catch (error) {
    status.textContent = error.message || "Discord linking failed.";
  }
})();
</script></body></html>`);
  }

  const { code, state } = req.query;
  const expectedState = String(req.session.discordOAuthState || "");
  if (!code || !state || !expectedState || state !== expectedState) {
    delete req.session.discordOAuthState;
    return res.redirect("/wallet?discord=failed");
  }

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Discord token exchange failed: ${tokenResponse.status}`);
    const tokenData = await tokenResponse.json();
    const discordUser = await fetchDiscordUser(tokenData.access_token);
    linkDiscordUser(req, discordUser);

    const returnPath = safeReturnPath(req.session.discordReturnPath, "/wallet");
    delete req.session.discordReturnPath;
    delete req.session.discordOAuthState;
    await saveSession(req);
    res.redirect(returnPath);
  } catch (error) {
    console.error("Discord OAuth error:", error);
    res.redirect("/wallet?discord=failed");
  }
});

router.post("/discord/implicit-callback", async (req, res) => {
  if (!isConfigured || hasClientSecret) return res.status(404).json({ error: "Discord implicit linking is unavailable." });

  const accessToken = String(req.body?.accessToken || "").trim();
  const state = String(req.body?.state || "").trim();
  const expectedState = String(req.session.discordOAuthState || "");
  if (!accessToken || !state || !expectedState || state !== expectedState) {
    delete req.session.discordOAuthState;
    return res.status(400).json({ error: "Discord linking session expired or could not be verified." });
  }

  try {
    const discordUser = await fetchDiscordUser(accessToken);
    linkDiscordUser(req, discordUser);
    const returnPath = safeReturnPath(req.session.discordReturnPath, "/wallet");
    delete req.session.discordReturnPath;
    delete req.session.discordOAuthState;
    await saveSession(req);
    return res.json({ ok: true, returnTo: returnPath });
  } catch (error) {
    console.error("Discord implicit OAuth error:", error);
    return res.status(400).json({ error: "Could not link Discord. Please try again." });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.isConfigured = isConfigured;
router.hasClientSecret = hasClientSecret;

module.exports = router;
