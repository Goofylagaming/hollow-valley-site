require("dotenv").config();
const path = require("node:path");
const express = require("express");
const session = require("express-session");

const { db } = require("./db");
const { SqliteSessionStore } = require("./sessionStore");
const authRouter = require("./auth");
const authSteamRouter = require("./authSteam");
const speciesRouter = require("./routes/species");
const walletRouter = require("./routes/wallet");
const questsRouter = require("./routes/quests");
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
const dinoStorageRouter = require("./routes/dinoStorage");
const serverStatusRouter = require("./routes/serverStatus");
const eventsRouter = require("./routes/events");
const mapdataRouter = require("./routes/mapdata");
const commandBridgeInternalRouter = require("./routes/commandBridgeInternal");
const supporterInternalRouter = require("./routes/supporterInternal");
const adminRestoreRouter = require("./routes/adminRestore");
const adminOperationsRouter = require("./routes/adminOperations");
const adminCommsRouter = require("./routes/adminComms");
const serverStatusService = require("./services/serverStatus");
const { syncSteamProfiles } = require("./services/steamProfile");
const herbyBot = require("./herbyBot");

const parkHandler = require("../api/park");
const playerdataHandler = require("../api/playerdata");
const redeemHandler = require("../api/redeem");
const parkedHandler = require("../api/parked");
const adminHandler = require("../api/admin");

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const HOLLOW_VALLEY_HOSTNAME = "hollowvalley.herbydeathsquadgames.com";
const LANDING_HOSTNAMES = new Set(["herbydeathsquadgames.com", "www.herbydeathsquadgames.com"]);
const LANDING_PAGE_PATH = path.join(__dirname, "..", "landing", "index.html");
const ADMIN_STEAM_IDS = new Set(
  String(process.env.ADMIN_STEAM_IDS || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{17}$/.test(value))
);

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  // Stripe signature verification requires the exact raw request body.
  // Mount the webhook before the global JSON parser.
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
    if (!LANDING_HOSTNAMES.has(hostname)) return next();
    if (req.path === "/" || req.path === "/index.html") {
      return res.sendFile(LANDING_PAGE_PATH);
    }
    const destination = new URL(req.originalUrl || req.url, `https://${HOLLOW_VALLEY_HOSTNAME}`);
    return res.redirect(302, destination.toString());
  });

  app.get("/api/me", (req, res) => {
    res.json({
      loggedIn: Boolean(req.user),
      user: req.user || null,
      discordLoginConfigured: authRouter.isConfigured,
      steamLoginConfigured: authSteamRouter.isConfigured,
    });
  });

  // Test endpoint for authenticated Steam map tracking.
  // Uses the SteamID from the verified logged-in session.
  // The browser does NOT provide the SteamID.
  app.get("/api/map/me-test", (req, res) => {
    if (!req.user) {
      return res.status(401).json({
        ok: false,
        error: "Login required"
      });
    }

    if (!req.user.steam_id) {
      return res.status(403).json({
        ok: false,
        error: "Steam account is not linked"
      });
    }

    return res.json({
      ok: true,
      authenticated: true,
      steamId: req.user.steam_id,
      username: req.user.username
    });
  });

  app.use("/auth", authRouter);
  app.use("/auth/steam", authSteamRouter);
  app.use("/api/internal/commandbridge", commandBridgeInternalRouter);
  app.use("/api/internal/supporter-memberships", supporterInternalRouter);
  app.use("/api/species", speciesRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/quests", questsRouter);
  app.use("/api/roster", rosterRouter);
  app.use("/api/leaderboards", leaderboardsRouter);
  app.use("/api/map", mapRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/mydinos", mydinosRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/skins", skinsRouter);
  app.use("/api/supporter", supporterRouter);
  app.use("/api/daily-bonus", dailyBonusRouter);
  app.use("/api/bodydrop", bodydropRouter);
  app.use("/api/dinostorage", dinoStorageRouter);
  app.use("/api/server-status", serverStatusRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/admin-restore", adminRestoreRouter);
  app.use("/api/admin-operations", adminOperationsRouter);
  app.use("/api/admin-comms", adminCommsRouter);
  app.use("/api/mapdata", mapdataRouter);

  app.all("/api/park", parkHandler);
  app.all("/api/playerdata", playerdataHandler);
  app.all("/api/redeem", redeemHandler);
  app.all("/api/parked", parkedHandler);
  app.all("/api/admin", adminHandler);

  const PAGE_ROUTES = ["dashboard", "wallet", "quests", "mydinos", "bodydrop", "marketplace", "livemap", "leaderboard", "supporter", "events", "adminrestore"];
  for (const page of PAGE_ROUTES) {
    app.get(`/${page}`, (req, res) => {
      res.sendFile(path.join(__dirname, "..", "public", `${page}.html`));
    });
  }

  app.get(["/skins", "/skins.html"], (req, res) => {
    if (!req.user) return res.status(401).send("Not logged in");
    if (!req.user.is_admin) return res.status(403).send("Admin access required");
    return res.sendFile(path.join(__dirname, "..", "public", "skins.html"));
  });

  app.get("/mydinos/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "mydinos.html"));
  });

  app.use("/mydinos", express.static(path.join(__dirname, "..", "mydinos"), { index: false }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return app;
}

function startServer() {
  const app = createApp();
  return app.listen(PORT, () => {
    console.log(`Herby Death Squad portal running on port ${PORT}`);
    serverStatusService.start();
    herbyBot.start();
    syncSteamProfiles(db).then((res) => {
      if (res.updated > 0) {
        console.log(`[Steam Profile Sync] Successfully synchronized ${res.updated}/${res.total} Steam user profiles.`);
      }
    }).catch((err) => {
      console.warn("[Steam Profile Sync] Background sync warning:", err.message);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer, HOLLOW_VALLEY_HOSTNAME };
