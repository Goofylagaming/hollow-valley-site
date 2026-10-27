require("dotenv").config();
const path = require("node:path");
const express = require("express");
const session = require("express-session");

const { db } = require("./db");
const { SqliteSessionStore } = require("./sessionStore");
const { requireAdmin } = require("./middleware/requireAuth");
const { isAuthorized: isTerritoryAdmin, requireTerritoryAdmin } = require("./middleware/requireTerritoryAdmin");
const { skinShareCodeRedaction } = require("./middleware/skinShareCodeRedaction");
const { getSkinStudioSafety, startSkinSharePolicySync } = require("./middleware/skinStudioSafety");
const authRouter = require("./auth");
const authSteamRouter = require("./authSteam");
const authOwnerRouter = require("./authOwner");
const speciesRouter = require("./routes/species");
const walletRouter = require("./routes/wallet");
const questsRouter = require("./routes/quests");
const progressionRouter = require("./routes/progression");
const rosterRouter = require("./routes/roster");
const leaderboardsRouter = require("./routes/leaderboards");
const mapRouter = require("./routes/map");
const dashboardRouter = require("./routes/dashboard");
const mydinosRouter = require("./routes/mydinos");
const marketplaceRouter = require("./routes/marketplace");
const skinsRouter = require("./routes/skins");
const supporterRouter = require("./routes/supporter");
const stripeWebhookRouter = require("./routes/stripeWebhook");
const dailyBonusRouter = require("./routes/dailybonus");
const bodydropRouter = require("./routes/bodydrop");
const serverStatusRouter = require("./routes/serverStatus");
const eventsRouter = require("./routes/events");
const friendsRouter = require("./routes/friends");
const roadmapCommunityRouter = require("./routes/roadmapCommunity");
const communityGuidesRouter = require("./routes/communityGuides");
const siteUpdatesRouter = require("./routes/siteUpdates");
const supportTicketsRouter = require("./routes/supportTickets");
const groupRecruitmentRouter = require("./routes/groupRecruitment");
const communityActivityRouter = require("./routes/communityActivity");
const groupsRouter = require("./routes/groups");
const mapdataRouter = require("./routes/mapdata");
const supporterInternalRouter = require("./routes/supporterInternal");
const adminRestoreRouter = require("./routes/adminRestore");
const adminOperationsRouter = require("./routes/adminOperations");
const adminIncidentsRouter = require("./routes/incidentTimeline");
const playerReportsRouter = require("./routes/playerReports");
const adminCombatRouter = require("./routes/adminCombat");
const adminPlayerDirectoryRouter = require("./routes/adminPlayerDirectory");
const adminSafeLogRecoveryRouter = require("./routes/adminSafeLogRecovery");
const adminCommsRouter = require("./routes/adminComms");
const adminSupportersRouter = require("./routes/adminSupporters");
const adminBodyDropResetRouter = require("./routes/adminBodyDropReset");
const serverStatusService = require("./services/serverStatus");
const automationWebsiteClient = require("./services/automationWebsiteClient");
const skinSharePolicyClient = require("./services/skinSharePolicyClient");
const { syncSteamProfiles } = require("./services/steamProfile");
const { createPrimalboundRouter } = require("./middleware/primalboundGateway");

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
// Defaults OFF: safe to merge code before a verified production DB backup.
const TERRITORY_WARS_ADMIN_TEST_ENABLED = process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED === "1";
const HOLLOW_VALLEY_HOSTNAME = "hollowvalleyisle.com";
const LEGACY_HOSTNAMES = new Set([
  "hollowvalley.herbydeathsquadgames.com",
  "herbydeathsquadgames.com",
  "www.herbydeathsquadgames.com",
  "www.hollowvalleyisle.com",
]);
const ADMIN_STEAM_IDS = new Set(
  String(process.env.ADMIN_STEAM_IDS || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{17}$/.test(value))
);
ADMIN_STEAM_IDS.add("76561198994993692");
ADMIN_STEAM_IDS.add("76561198137456735"); // chromie
ADMIN_STEAM_IDS.add("76561199141282348"); // Defaultguy1

function currentAdminSteamIds() {
  const ids = new Set(ADMIN_STEAM_IDS);
  const rows = db.prepare(`
    SELECT steam_id
    FROM users
    WHERE is_admin = 1 AND steam_id IS NOT NULL
  `).all();
  for (const row of rows) {
    const steamId = String(row.steam_id || "").trim();
    if (/^\d{17}$/.test(steamId)) ids.add(steamId);
  }
  return [...ids];
}

async function syncSkinSharePolicy() {
  if (getSkinStudioSafety().readOnly) return;
  try {
    const result = await skinSharePolicyClient.reconcile(currentAdminSteamIds());
    console.log(`[skin-share-policy] admins=${result.adminCount ?? 0} removed=${result.removedShareCodes ?? 0}`);
  } catch (error) {
    console.warn("[skin-share-policy] sync warning:", error.message);
  }
}

function legacyDirectGameApiRetired(_req, res) {
  return res.status(410).json({
    error: "Legacy direct game API has been retired. Use the automation-backed Hollow Valley endpoints instead.",
    code: "LEGACY_DIRECT_GAME_API_RETIRED",
  });
}

function createApp() {
  const app = express();
  app.locals.readiness = require('./services/readiness').installReadiness(
    app, () => db.prepare('SELECT id FROM users LIMIT 1').get(), 'hollow-valley-site');
  app.set("trust proxy", 1);
  // Serve the independent browser game under the Hollow Valley domain before
  // Hollow Valley JSON parsing/session middleware. Never forward Steam cookies.
  app.use("/primalbound", createPrimalboundRouter());
  app.use("/api/stripe/webhook", stripeWebhookRouter);
  app.use(express.json());

  app.use(
    session({
      store: new SqliteSessionStore(),
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 90,
      },
    })
  );

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("Pragma", "no-cache");
    }
    next();
  });

  app.use((req, res, next) => {
    if (req.session.userId) {
      req.user = db.prepare("SELECT id, discord_id, steam_id, username, avatar, is_admin FROM users WHERE id = ?").get(req.session.userId) || null;
      if (req.session.ownerEmailAuth) {
        const steamId = String(process.env.OWNER_STEAM_ID || "").trim();
        const login = db.prepare("SELECT session_version FROM owner_logins WHERE steam_id = ?").get(steamId);
        if (!req.user || req.user.steam_id !== steamId || login?.session_version !== req.session.ownerLoginVersion) {
          req.user = null;
          return req.session.destroy(() => next());
        }
      }
      if (req.user && ADMIN_STEAM_IDS.has(String(req.user.steam_id || ""))) {
        if (!req.user.is_admin) {
          db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(req.user.id);
        }
        req.user.is_admin = 1;
      }
    }
    next();
  });

  app.use((req, res, next) => {
    const hostname = (req.hostname || "").toLowerCase();
    if (!LEGACY_HOSTNAMES.has(hostname)) return next();
    const destination = new URL(req.originalUrl || req.url, `https://${HOLLOW_VALLEY_HOSTNAME}`);
    return res.redirect(308, destination.toString());
  });

  // Gated ahead of static files AND API mounts: knowing the URL is not access.
  // Only the four designated Steam admins get battle controls. Non-admins
  // can view/accept invitations addressed to their authenticated Steam ID.
  app.use([
    "/api/territory-wars",
    "/adminterritorywars",
    "/adminterritorywars.html",
    "/groups/territory-wars",
  ], (req, res, next) => {
    if (!TERRITORY_WARS_ADMIN_TEST_ENABLED) {
      return res.status(404).json({ error: "Territory Wars admin test is not enabled" });
    }
    const admin = isTerritoryAdmin(req.user);
    const isAdminPage = req.baseUrl === "/adminterritorywars"
      || req.baseUrl === "/adminterritorywars.html";
    const isPlayerPage = req.baseUrl === "/groups/territory-wars";
    const isTerritoryApi = req.baseUrl === "/api/territory-wars";

    if (isAdminPage) return requireTerritoryAdmin(req, res, next);

    if (!req.user?.steam_id || !/^\d{17}$/.test(String(req.user.steam_id))) {
      if (isPlayerPage) {
        return res.redirect(302, "/auth/steam?returnTo=%2Fgroups%2Fterritory-wars%2F");
      }
      return res.status(401).json({ error: "Steam sign-in required" });
    }

    if (admin) return next();

    if (isPlayerPage) {
      res.set("Cache-Control", "no-store, private");
      return res.sendFile(path.join(__dirname, "pages", "territoryInvites.html"));
    }

    // Keep event state, rosters, and every admin/group management endpoint
    // private. A player may only fetch their own invitations or accept one.
    const endpoint = req.path.replace(/\/+$/, "") || "/";
    const readInvites = req.method === "GET" && endpoint === "/invites";
    const acceptInvite = req.method === "POST" && endpoint === "/group/invite/accept";
    if (isTerritoryApi && (readInvites || acceptInvite)) return next();

    return res.status(403).json({ error: "Territory Wars admin access required" });
  });

  app.get("/api/me", (req, res) => {
    if (!getSkinStudioSafety().readOnly && req.user?.steam_id && req.user?.discord_id) {
      automationWebsiteClient.linkProgressionIdentity({
        steamId: String(req.user.steam_id),
        discordId: String(req.user.discord_id),
      }).catch((error) => {
        console.warn("[progression] automatic Discord link sync failed:", error.message);
      });
    }
    res.json({
      loggedIn: Boolean(req.user),
      valleyLegacyEnabled: process.env.VALLEY_LEGACY_ENABLED === "1",
      user: req.user || null,
      territoryWarsAdminAccess: TERRITORY_WARS_ADMIN_TEST_ENABLED && isTerritoryAdmin(req.user),
      discordLoginConfigured: authRouter.isConfigured,
      steamLoginConfigured: authSteamRouter.isConfigured,
      skinStudioCalibrationPreview: process.env.SKIN_STUDIO_CALIBRATION_PREVIEW === "1",
    });
  });

  app.get("/api/map/me-test", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Login required" });
    }
    if (!req.user.steam_id) {
      return res.status(403).json({ ok: false, error: "Steam account is not linked" });
    }
    return res.json({ ok: true, authenticated: true, steamId: req.user.steam_id, username: req.user.username });
  });

  app.use("/auth", authRouter);
  app.use("/auth/steam", authSteamRouter);
  app.use("/auth/owner", authOwnerRouter);
  app.use("/api/internal/commandbridge", legacyDirectGameApiRetired);
  app.use("/api/internal/supporter-memberships", supporterInternalRouter);
  app.use("/api/species", speciesRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/quests", questsRouter);
  app.use("/api/progression", progressionRouter);
  app.use("/api/legacy", require("./routes/valleyLegacy"));
  app.use("/api/roster", rosterRouter);
  app.use("/api/leaderboards", leaderboardsRouter);
  app.use("/api/map", mapRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/mydinos", mydinosRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/skins", skinShareCodeRedaction);
  app.use("/api/skins", skinsRouter);
  app.use("/api/supporter", supporterRouter);
  app.use("/api/daily-bonus", dailyBonusRouter);
  app.use("/api/bodydrop", bodydropRouter);
  app.use("/api/server-status", serverStatusRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/friends", friendsRouter);
  app.use("/api/roadmap", roadmapCommunityRouter);
  app.use("/api/community-guides", communityGuidesRouter);
  app.use("/api/site-updates", siteUpdatesRouter);
  app.use("/api/support-tickets", supportTicketsRouter);
  app.use("/api/group-recruitment", groupRecruitmentRouter);
  app.use("/api/community-activity", communityActivityRouter);
  app.use("/api/groups", groupsRouter);
  if (TERRITORY_WARS_ADMIN_TEST_ENABLED) {
    // Loading the module creates isolated territory_* tables: never load while disabled.
    app.use("/api/territory-wars", require("./routes/territoryWars"));
    // Live map preview mirrors the preview UI, but uses a separate signed-in
    // endpoint so non-admin visitors retain their invite-only TW API access.
    app.use("/api/live-map/territory-overlay", require("./routes/territoryOverlay"));
  }
  app.use("/api/admin-restore", adminRestoreRouter);
  app.use("/api/admin-operations", adminOperationsRouter);
  app.use("/api/admin-incidents", adminIncidentsRouter);
  app.use("/api/reports", playerReportsRouter);
  app.use("/api/admin-combat", adminCombatRouter);
  app.use("/api/admin-player-directory", adminPlayerDirectoryRouter);
  app.use("/api/admin-safelog-recovery", adminSafeLogRecoveryRouter);
  app.use("/api/admin-comms", adminCommsRouter);
  app.use("/api/admin-supporters", adminSupportersRouter);
  app.use("/api/admin-bodydrop-reset", adminBodyDropResetRouter);
  app.use("/api/mapdata", mapdataRouter);

  app.use("/api/dinostorage", legacyDirectGameApiRetired);
  app.all(["/api/park", "/api/playerdata", "/api/redeem", "/api/parked", "/api/admin"], legacyDirectGameApiRetired);

  const PAGE_ROUTES = ["legacy", "dashboard", "wallet", "quests", "profile", "mydinos", "bodydrop", "friends", "groups", "marketplace", "livemap", "leaderboard", "supporter", "events", "help", "rules", "packs", "updates", "support", "community", "recruitment", "activity", "status", "reports"];
  for (const page of PAGE_ROUTES) {
    app.get(`/${page}`, (req, res) => {
      res.sendFile(path.join(__dirname, "..", "public", `${page}.html`));
    });
  }

  app.get("/owner-login", (_req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.sendFile(path.join(__dirname, "..", "public", "owner-login.html"));
  });

  const ADMIN_PAGE_ROUTES = {
    admin: "admin.html",
    adminoperations: "adminoperations.html",
    adminincidents: "adminincidents.html",
    adminreports: "adminreports.html",
    admincomms: "admincomms.html",
    adminrestore: "adminrestore.html",
    adminsupporters: "adminsupporters.html",
    adminroadmap: "adminroadmap.html",
    adminrules: "adminrules.html",
    adminupdates: "adminupdates.html",
    adminsupport: "adminsupport.html",
    adminactivity: "adminactivity.html",
  };
  for (const [route, file] of Object.entries(ADMIN_PAGE_ROUTES)) {
    app.get([`/${route}`, `/${route}.html`], requireAdmin, (_req, res) => {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.sendFile(path.join(__dirname, "..", "public", file));
    });
  }

  if (TERRITORY_WARS_ADMIN_TEST_ENABLED) {
    app.get(["/adminterritorywars", "/adminterritorywars.html"], requireTerritoryAdmin, (_req, res) => {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.sendFile(path.join(__dirname, "..", "public", "adminterritorywars.html"));
    });
  }

  app.get(["/skins", "/skins.html"], (_req, res) => {
    return res.sendFile(path.join(__dirname, "..", "public", "skins.html"));
  });

  app.get("/mydinos/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "mydinos.html"));
  });

  app.use("/mydinos", express.static(path.join(__dirname, "..", "mydinos"), { index: false }));
  // Never let edge/browser caches retain an older shared nav with the retired Render link.
  app.get("/partials/nav.html", (_req, res) => {
    res.set("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.set("Pragma", "no-cache");
    res.sendFile(path.join(__dirname, "..", "public", "partials", "nav.html"));
  });
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return app;
}

function startServer() {
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`Herby Death Squad portal running on port ${PORT}`);
    console.log("[legacy-api] direct game execution paths retired");
    serverStatusService.start();
    if (TERRITORY_WARS_ADMIN_TEST_ENABLED) {
      const territoryRouter = require("./routes/territoryWars");
      const runtimeTimer = setInterval(() => {
        try { territoryRouter.tickRuntime(); }
        catch (error) { console.warn("[territory-wars] admin-test runtime warning:", error.message); }
      }, 15_000);
      runtimeTimer.unref?.();
      // Combat ingestion is a separate rollout; do not assume automation has its endpoint.
      if (process.env.TERRITORY_WARS_COMBAT_SYNC_ENABLED === "1") {
        require("./services/territoryCombatSync").start();
      }
      // The Discord feed uses existing website-to-automation credentials.
      // Opt-in: never replay or announce old TW tests during deployment.
      if (process.env.TERRITORY_WARS_DISCORD_FEED_ENABLED === "1") {
        require("./services/territoryDiscordFeed").start();
      }
    }
    startSkinSharePolicySync(syncSkinSharePolicy);
    syncSteamProfiles(db).then((res) => {
      if (res.updated > 0) {
        console.log(`[Steam Profile Sync] Successfully synchronized ${res.updated}/${res.total} Steam user profiles.`);
      }
    }).catch((err) => {
      console.warn("[Steam Profile Sync] Background sync warning:", err.message);
    });
  });
  process.once('SIGTERM', () => {
    app.locals.readiness.drain();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 25000).unref();
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer, HOLLOW_VALLEY_HOSTNAME };
