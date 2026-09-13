// Discord OAuth2 login. Requires an application registered at
// https://discord.com/developers/applications with the redirect URI below added.
const express = require("express");
const { findOrCreateUser, db } = require("./db");

const router = express.Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const ADMIN_DISCORD_IDS = new Set(
  (process.env.ADMIN_DISCORD_IDS || "").split(",").map((id) => id.trim()).filter(Boolean)
);

const isConfigured = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);

router.get("/discord", (req, res) => {
  if (!isConfigured) {
    return res.status(503).send("Discord login is not configured yet. Set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI.");
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

router.get("/discord/callback", async (req, res) => {
  if (!isConfigured) return res.redirect("/");
  const { code } = req.query;
  if (!code) return res.redirect("/?login=failed");

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Discord token exchange failed: ${tokenResponse.status}`);
    const tokenData = await tokenResponse.json();

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) throw new Error(`Discord user fetch failed: ${userResponse.status}`);
    const discordUser = await userResponse.json();

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
    res.redirect("/");
  } catch (error) {
    console.error("Discord OAuth error:", error);
    res.redirect("/?login=failed");
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.isConfigured = isConfigured;

module.exports = router;
