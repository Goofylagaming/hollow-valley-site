// Steam login via OpenID 2.0 (Steam has no OAuth, only OpenID). This is the
// primary non-admin sign-in option — players link their Steam account so the
// site can eventually be matched against the game server's own SteamID64-based
// logs/RCON output for website <-> in-game syncing. Admin status is only ever
// granted via Discord (see ADMIN_DISCORD_IDS in auth.js) — Steam logins never
// become admins.
const express = require("express");
const { findOrCreateUserBySteam } = require("./db");

const router = express.Router();

const STEAM_RETURN_URL = process.env.STEAM_RETURN_URL;
const STEAM_REALM = process.env.STEAM_REALM;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

const isConfigured = Boolean(STEAM_RETURN_URL && STEAM_REALM);

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

router.get("/", (req, res) => {
  if (!isConfigured) {
    return res
      .status(503)
      .send("Steam login is not configured yet. Set STEAM_RETURN_URL / STEAM_REALM.");
  }
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": STEAM_RETURN_URL,
    "openid.realm": STEAM_REALM,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  res.redirect(`${STEAM_OPENID_ENDPOINT}?${params.toString()}`);
});

router.get("/callback", async (req, res) => {
  if (!isConfigured) return res.redirect("/");

  try {
    const claimedId = req.query["openid.claimed_id"];
    if (!claimedId || typeof claimedId !== "string") {
      throw new Error("Missing openid.claimed_id in Steam callback");
    }

    // Stateless verification: echo every openid.* field back to Steam with
    // mode switched to check_authentication and trust its is_valid response.
    const verifyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") verifyParams.set(key, value);
    }
    verifyParams.set("openid.mode", "check_authentication");

    const verifyResponse = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyParams.toString(),
    });
    const verifyText = await verifyResponse.text();
    if (!verifyResponse.ok || !verifyText.includes("is_valid:true")) {
      throw new Error("Steam OpenID verification failed");
    }

    const match = CLAIMED_ID_PATTERN.exec(claimedId);
    if (!match) throw new Error(`Unexpected claimed_id format: ${claimedId}`);
    const steamId = match[1];

    let username = `Survivor${steamId.slice(-5)}`;
    let avatar = null;
    let hasRealProfile = false;
    if (STEAM_API_KEY) {
      const profileResponse = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`
      );
      if (profileResponse.ok) {
        const data = await profileResponse.json();
        const player = data?.response?.players?.[0];
        if (player) {
          username = player.personaname || username;
          avatar = player.avatarfull || null;
          hasRealProfile = true;
        }
      }
    }

    const user = findOrCreateUserBySteam({ steamId, username, avatar, hasRealProfile });
    req.session.userId = user.id;
    res.redirect("/");
  } catch (error) {
    console.error("Steam OpenID error:", error);
    res.redirect("/?login=failed");
  }
});

router.isConfigured = isConfigured;

module.exports = router;
