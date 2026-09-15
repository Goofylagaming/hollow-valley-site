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
const dailyBonusRouter = require("./routes/dailybonus");
const bodydropRouter = require("./routes/bodydrop");
const serverStatusRouter = require("./routes/serverStatus");
const eventsRouter = require("./routes/events");
const mapdataRouter = require("./routes/mapdata");
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

function createApp() {
  const app = express();
  app.set("trust proxy", 1); // required when running behind an Nginx reverse proxy
  app.use(express.json());

  app.use(
    session({
      store: new SqliteSessionStore(),
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      rolling: true, // refresh the expiry on every active request, so regular
      // visitors effectively stay signed in indefinitely instead of being
      // logged out a fixed number of days after their first login.
      cookie: {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 90,
      },
    })
  );

  // Auth state must never be cached - by the browser, the bfcache, Cloudflare or
  // any other intermediary - or a stale "logged out" response can be replayed to
  // a user who actually holds a valid session.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("Pragma", "no-cache");
    }
    next();
  });

  // Attach the logged-in user (if any) to every request.
  app.use((req, res, next) => {
    if (req.session.userId) {
      req.user = db.prepare("SELECT id, discord_id, steam_id, username, avatar, is_admin FROM users WHERE id = ?").get(req.session.userId) || null;
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

  app.use("/auth", authRouter);
  app.use("/auth/steam", authSteamRouter);
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
  app.use("/api/server-status", serverStatusRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/mapdata", mapdataRouter);

  app.all("/api/park", parkHandler);
  app.all("/api/playerdata", playerdataHandler);
  app.all("/api/redeem", redeemHandler);
  app.all("/api/parked", parkedHandler);
  app.all("/api/admin", adminHandler);

  // Clean URLs for each page (e.g. /dashboard -> public/dashboard.html).
  const PAGE_ROUTES = ["dashboard", "mydinos", "marketplace", "skins", "livemap", "leaderboard", "supporter", "events"];
  for (const page of PAGE_ROUTES) {
    app.get(`/${page}`, (req, res) => {
      res.sendFile(path.join(__dirname, "..", "public", `${page}.html`));
    });
  }

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
    // Automatically synchronize profiles for linked Steam users who have placeholder usernames
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
