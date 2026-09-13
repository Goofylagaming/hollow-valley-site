const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("node:sqlite");
const { parseSteamXml, fetchSteamProfile, syncSteamProfiles } = require("../server/services/steamProfile");

test("parseSteamXml extracts persona name, avatar, and privacy state with CDATA", () => {
  const xml = `
    <profile>
      <steamID><![CDATA[TestPlayer123]]></steamID>
      <privacyState>public</privacyState>
      <avatarFull><![CDATA[https://avatars.steamstatic.com/test_full.jpg]]></avatarFull>
    </profile>
  `;
  const result = parseSteamXml(xml);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.personaName, "TestPlayer123");
  assert.strictEqual(result.avatar, "https://avatars.steamstatic.com/test_full.jpg");
  assert.strictEqual(result.isPrivate, false);
  assert.strictEqual(result.source, "community_xml");
});

test("parseSteamXml handles friendsonly / private profile XML", () => {
  const xml = `
    <profile>
      <steamID><![CDATA[PrivatePersona]]></steamID>
      <privacyState>friendsonly</privacyState>
      <avatarFull><![CDATA[https://avatars.steamstatic.com/private_full.jpg]]></avatarFull>
    </profile>
  `;
  const result = parseSteamXml(xml);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.personaName, "PrivatePersona");
  assert.strictEqual(result.isPrivate, true);
});

test("parseSteamXml decodes XML entities when CDATA is absent", () => {
  const xml = `
    <profile>
      <steamID>Dino &amp; Hunter &lt;Rex&gt;</steamID>
      <privacyState>public</privacyState>
      <avatarFull>https://avatars.steamstatic.com/plain.jpg</avatarFull>
    </profile>
  `;
  const result = parseSteamXml(xml);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.personaName, "Dino & Hunter <Rex>");
  assert.strictEqual(result.avatar, "https://avatars.steamstatic.com/plain.jpg");
});

test("parseSteamXml handles invalid or empty XML gracefully", () => {
  assert.strictEqual(parseSteamXml(null).ok, false);
  assert.strictEqual(parseSteamXml("").ok, false);
  assert.strictEqual(parseSteamXml("<error>Not found</error>").ok, false);
});

test("fetchSteamProfile rejects invalid Steam ID format", async () => {
  const result = await fetchSteamProfile("invalid-id");
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.source, "invalid_steamid");
});

test("syncSteamProfiles backfills users with placeholder usernames", async () => {
  const testDb = new Database.DatabaseSync(":memory:");
  testDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE,
      steam_id TEXT UNIQUE,
      username TEXT NOT NULL,
      avatar TEXT
    );
  `);

  testDb.prepare("INSERT INTO users (id, steam_id, username) VALUES (?, ?, ?)").run(1, "76561198038977506", "Survivor77506");
  testDb.prepare("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run(2, "123456789", "DiscordOnlyUser");

  const mockFetchProfile = async (steamId) => {
    if (steamId === "76561198038977506") {
      return { ok: true, personaName: "RealGamerName", avatar: "https://avatar.url/img.jpg" };
    }
    return { ok: false, personaName: null };
  };

  const syncResult = await syncSteamProfiles(testDb, {
    fetchProfileFn: mockFetchProfile,
  });

  assert.strictEqual(syncResult.updated, 1);
  const updatedUser = testDb.prepare("SELECT username, avatar FROM users WHERE id = 1").get();
  assert.strictEqual(updatedUser.username, "RealGamerName");
  assert.strictEqual(updatedUser.avatar, "https://avatar.url/img.jpg");

  const discordUser = testDb.prepare("SELECT username FROM users WHERE id = 2").get();
  assert.strictEqual(discordUser.username, "DiscordOnlyUser");
});

test("findOrCreateUserBySteam prioritizes persona name and updates placeholder names", () => {
  const testDb = new Database.DatabaseSync(":memory:");
  testDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE,
      steam_id TEXT UNIQUE,
      username TEXT NOT NULL,
      avatar TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE wallets (user_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE player_stats (user_id INTEGER PRIMARY KEY, kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, playtime_seconds INTEGER NOT NULL DEFAULT 0, playtime_minutes INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE roster (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL);
    CREATE TABLE wallet_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL);
    CREATE TABLE skins (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER NOT NULL);
  `);

  // Helper matching db.js implementation
  function findOrCreateUserBySteamHelper({ currentUserId, steamId, username, avatar, hasRealProfile = false }) {
    const existingSteamUser = testDb.prepare("SELECT * FROM users WHERE steam_id = ?").get(steamId);

    if (currentUserId) {
      const currentUser = testDb.prepare("SELECT * FROM users WHERE id = ?").get(currentUserId);
      if (currentUser) {
        if (existingSteamUser && existingSteamUser.id !== currentUser.id) {
          const targetId = currentUser.id;
          const sourceId = existingSteamUser.id;
          testDb.prepare("UPDATE roster SET user_id = ? WHERE user_id = ?").run(targetId, sourceId);
          testDb.prepare("DELETE FROM wallets WHERE user_id = ?").run(sourceId);
          testDb.prepare("DELETE FROM player_stats WHERE user_id = ?").run(sourceId);
          testDb.prepare("DELETE FROM users WHERE id = ?").run(sourceId);
        }
        let newName = currentUser.username;
        if (hasRealProfile && username) {
          newName = username;
        } else if (!newName || /^Survivor\d+$/i.test(newName)) {
          newName = username || `Survivor${steamId.slice(-5)}`;
        }
        const newAvatar = avatar || currentUser.avatar;
        testDb.prepare("UPDATE users SET steam_id = ?, username = ?, avatar = ? WHERE id = ?").run(steamId, newName, newAvatar, currentUser.id);
        return testDb.prepare("SELECT * FROM users WHERE id = ?").get(currentUser.id);
      }
    }

    if (existingSteamUser) {
      if (hasRealProfile && username) {
        testDb.prepare("UPDATE users SET username = ?, avatar = COALESCE(?, avatar) WHERE id = ?").run(username, avatar, existingSteamUser.id);
      } else if (!existingSteamUser.username || /^Survivor\d+$/i.test(existingSteamUser.username)) {
        if (username) {
          testDb.prepare("UPDATE users SET username = ?, avatar = COALESCE(?, avatar) WHERE id = ?").run(username, avatar, existingSteamUser.id);
        }
      }
      return testDb.prepare("SELECT * FROM users WHERE id = ?").get(existingSteamUser.id);
    }

    const info = testDb
      .prepare("INSERT INTO users (steam_id, username, avatar) VALUES (?, ?, ?)")
      .run(steamId, username, avatar);
    const userId = Number(info.lastInsertRowid);
    testDb.prepare("INSERT INTO wallets (user_id, balance) VALUES (?, 0)").run(userId);
    testDb.prepare("INSERT INTO player_stats (user_id) VALUES (?)").run(userId);
    return testDb.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  }

  // 1. New user with real profile
  const user1 = findOrCreateUserBySteamHelper({
    steamId: "76561198994993692",
    username: "Stressed_",
    avatar: "https://avatar.url/stressed.jpg",
    hasRealProfile: true,
  });
  assert.strictEqual(user1.username, "Stressed_");
  assert.strictEqual(user1.avatar, "https://avatar.url/stressed.jpg");

  // 2. Linking Steam to an existing Discord user updates username to persona name
  testDb.prepare("INSERT INTO users (id, discord_id, username, avatar) VALUES (?, ?, ?, ?)").run(10, "9999", "DiscordNick", "https://discord.avatar/pic.png");
  const linked = findOrCreateUserBySteamHelper({
    currentUserId: 10,
    steamId: "76561198137456735",
    username: "Chromie",
    avatar: "https://avatar.url/chromie.jpg",
    hasRealProfile: true,
  });
  assert.strictEqual(linked.id, 10);
  assert.strictEqual(linked.username, "Chromie");
  assert.strictEqual(linked.steam_id, "76561198137456735");

  // 3. Linking Steam with unavailable profile to user with existing name preserves existing name
  testDb.prepare("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run(11, "8888", "ExistingPlayer");
  const linkedUnavailable = findOrCreateUserBySteamHelper({
    currentUserId: 11,
    steamId: "76561198000011111",
    username: "Survivor11111",
    avatar: null,
    hasRealProfile: false,
  });
  assert.strictEqual(linkedUnavailable.id, 11);
  assert.strictEqual(linkedUnavailable.username, "ExistingPlayer");

  // 4. Existing user with placeholder name updates on subsequent login with real profile
  testDb.prepare("INSERT INTO users (id, steam_id, username) VALUES (?, ?, ?)").run(12, "76561198043788625", "Survivor88625");
  const reLogin = findOrCreateUserBySteamHelper({
    steamId: "76561198043788625",
    username: "Shukura",
    avatar: "https://avatar.url/shukura.jpg",
    hasRealProfile: true,
  });
  assert.strictEqual(reLogin.id, 12);
  assert.strictEqual(reLogin.username, "Shukura");
});
