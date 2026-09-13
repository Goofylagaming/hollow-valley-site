/**
 * Service to fetch and synchronize Steam profiles (persona names and avatars).
 * Supports:
 * 1. Steam Web API (when STEAM_API_KEY is configured)
 * 2. Steam Community XML endpoint (public fallback without requiring API key)
 * 3. Fallback resolution for private/unavailable profiles
 */

function parseSteamXml(xmlText) {
  if (!xmlText || typeof xmlText !== "string") {
    return { ok: false, personaName: null, avatar: null, isPrivate: false };
  }

  // Check for privacy state
  const privacyMatch = /<privacyState>(.*?)<\/privacyState>/i.exec(xmlText);
  const privacyState = privacyMatch ? privacyMatch[1].trim().toLowerCase() : null;
  const isPrivate = privacyState === "private" || privacyState === "friendsonly";

  // Match steamID (persona name) with or without CDATA
  const nameMatch = /<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>|<steamID>([\s\S]*?)<\/steamID>/i.exec(xmlText);
  let rawName = nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? "") : "";

  // Decode basic XML entities if not inside CDATA
  if (rawName && !nameMatch[1]) {
    rawName = rawName
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  const personaName = rawName.trim();

  // Match avatarFull with or without CDATA
  const avatarMatch = /<avatarFull><!\[CDATA\[([\s\S]*?)\]\]><\/avatarFull>|<avatarFull>([\s\S]*?)<\/avatarFull>/i.exec(xmlText);
  const avatar = (avatarMatch ? (avatarMatch[1] ?? avatarMatch[2] ?? "") : "").trim() || null;

  if (personaName) {
    return {
      ok: true,
      personaName,
      avatar,
      isPrivate,
      source: "community_xml",
    };
  }

  return {
    ok: false,
    personaName: null,
    avatar,
    isPrivate,
    source: "community_xml_empty",
  };
}

async function fetchSteamProfile(steamId, { apiKey = process.env.STEAM_API_KEY, timeoutMs = 4000 } = {}) {
  const cleanId = String(steamId).trim();
  if (!/^\d{17}$/.test(cleanId)) {
    return {
      ok: false,
      personaName: null,
      avatar: null,
      isPrivate: false,
      source: "invalid_steamid",
      fallbackName: `Survivor${cleanId.slice(-5) || "00000"}`,
    };
  }

  // 1. Try Steam Web API if key is available
  if (apiKey) {
    try {
      const response = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${cleanId}`,
        { signal: AbortSignal.timeout(timeoutMs) }
      );
      if (response.ok) {
        const data = await response.json();
        const player = data?.response?.players?.[0];
        if (player && player.personaname && player.personaname.trim()) {
          return {
            ok: true,
            personaName: player.personaname.trim(),
            avatar: player.avatarfull || player.avatarmedium || player.avatar || null,
            isPrivate: player.communityvisibilitystate === 1,
            source: "web_api",
          };
        }
      }
    } catch (err) {
      // Ignore and proceed to XML fallback
    }
  }

  // 2. Try Steam Community XML endpoint (works without API key)
  try {
    const response = await fetch(
      `https://steamcommunity.com/profiles/${cleanId}/?xml=1`,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
    if (response.ok) {
      const xml = await response.text();
      const parsed = parseSteamXml(xml);
      if (parsed.ok) {
        return parsed;
      }
    }
  } catch (err) {
    // Ignore and proceed to fallback
  }

  // 3. Fallback for unavailable or private profiles
  return {
    ok: false,
    personaName: null,
    avatar: null,
    isPrivate: false,
    source: "unavailable",
    fallbackName: `Survivor${cleanId.slice(-5)}`,
  };
}

async function syncSteamProfiles(dbInstance, { force = false, fetchProfileFn = fetchSteamProfile } = {}) {
  const users = dbInstance.prepare("SELECT id, steam_id, username, avatar FROM users WHERE steam_id IS NOT NULL").all();
  let updated = 0;
  const results = [];

  for (const user of users) {
    const isPlaceholder = !user.username || /^Survivor\d+$/i.test(user.username.trim());
    if (!force && !isPlaceholder) continue;

    try {
      const profile = await fetchProfileFn(user.steam_id);
      if (profile.ok && profile.personaName) {
        dbInstance
          .prepare("UPDATE users SET username = ?, avatar = COALESCE(?, avatar) WHERE id = ?")
          .run(profile.personaName, profile.avatar, user.id);
        updated++;
        results.push({ id: user.id, oldName: user.username, newName: profile.personaName, status: "updated" });
      } else {
        results.push({ id: user.id, username: user.username, status: "skipped_or_unavailable", isPrivate: profile.isPrivate });
      }
    } catch (err) {
      results.push({ id: user.id, username: user.username, status: "error", error: err.message });
    }
  }

  return { total: users.length, updated, results };
}

module.exports = {
  parseSteamXml,
  fetchSteamProfile,
  syncSteamProfiles,
};
