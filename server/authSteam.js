const express = require("express");
const { findOrCreateUserBySteam } = require("./db");
const { fetchSteamProfile } = require("./services/steamProfile");

const router = express.Router();

const STEAM_RETURN_URL = process.env.STEAM_RETURN_URL;
const STEAM_REALM = process.env.STEAM_REALM;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

const isConfigured = Boolean(STEAM_RETURN_URL && STEAM_REALM);

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
const DEFAULT_RETURN_PATH = "/mydinos";

function returnPathFromRequest(req) {
  const requested = typeof req.query.returnTo === "string" ? req.query.returnTo : null;
  if (requested?.startsWith("/") && !requested.startsWith("//")) return requested;

  const referer = req.get("referer");
  if (!referer) return DEFAULT_RETURN_PATH;
  try {
    const url = new URL(referer);
    if (url.origin === STEAM_REALM.replace(/\/$/, "")) return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // An invalid Referer must never affect the destination after login.
  }
  return DEFAULT_RETURN_PATH;
}

function redirectAfterSessionSave(req, res, destination) {
  req.session.save((error) => {
    if (error) {
      console.error("Steam session save failed:", error);
      return res.redirect("/?login=failed");
    }
    res.redirect(destination);
  });
}

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
  // Persist the existing login before Steam redirects away. This is essential
  // when a Discord user is linking Steam, and avoids redirect/session races.
  req.session.steamLoginStartedAt = Date.now();
  req.session.steamReturnPath = returnPathFromRequest(req);
  redirectAfterSessionSave(req, res, `${STEAM_OPENID_ENDPOINT}?${params.toString()}`);
});

router.get("/callback", async (req, res) => {
  if (!isConfigured) return res.redirect("/");

  try {
    const claimedId = req.query["openid.claimed_id"];
    if (!claimedId || typeof claimedId !== "string") {
      throw new Error("Missing openid.claimed_id in Steam callback");
    }

    const rawQuery = req.originalUrl.split("?")[1] || "";
    let checkAuthBody = "";
    if (rawQuery.includes("openid.mode=")) {
      checkAuthBody = rawQuery.replace(/openid\.mode=[^&]*/, "openid.mode=check_authentication");
    } else {
      const verifyParams = new URLSearchParams(rawQuery);
      verifyParams.set("openid.mode", "check_authentication");
      checkAuthBody = verifyParams.toString();
    }

    const verifyResponse = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: checkAuthBody,
    });
    const verifyText = await verifyResponse.text();

    if (!verifyResponse.ok || !verifyText.includes("is_valid:true")) {
      console.error("[Steam Auth Callback Verification Failed]:", verifyResponse.status, verifyText);
      throw new Error("Steam OpenID verification failed");
    }

    const match = CLAIMED_ID_PATTERN.exec(claimedId);
    if (!match) throw new Error(`Unexpected claimed_id format: ${claimedId}`);
    const steamId = match[1];

    const profile = await fetchSteamProfile(steamId);
    const hasRealProfile = Boolean(profile.ok && profile.personaName);
    const username = hasRealProfile ? profile.personaName : (profile.fallbackName || `Survivor${steamId.slice(-5)}`);
    const avatar = profile.avatar || null;

    const user = findOrCreateUserBySteam({
      currentUserId: req.session.userId,
      steamId,
      username,
      avatar,
      hasRealProfile,
    });

    req.session.userId = user.id;
    const returnPath = req.session.steamReturnPath || DEFAULT_RETURN_PATH;
    delete req.session.steamLoginStartedAt;
    delete req.session.steamReturnPath;
    redirectAfterSessionSave(req, res, returnPath);
  } catch (error) {
    console.error("Steam OpenID error:", error);
    res.redirect("/?login=failed");
  }
});

router.isConfigured = isConfigured;

module.exports = router;