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

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

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

// Attach the logged-in user (if any) to every request.
app.use((req, res, next) => {
  if (req.session.userId) {
    req.user = db.prepare("SELECT id, discord_id, steam_id, username, avatar, is_admin FROM users WHERE id = ?").get(req.session.userId) || null;
  }
  if (process.env.DEBUG_AUTH === "1") {
    console.log(
      `[auth-debug] ${req.method} ${req.originalUrl} | cookie=${req.headers.cookie ? "present" : "MISSING"} | sessionID=${req.sessionID} | session.userId=${req.session.userId ?? "none"} | resolvedUser=${req.user ? req.user.username : "none"}`
    );
  }
  next();
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

app.use(express.static(path.join(__dirname, "..", "public")));

// Clean URLs for each page (e.g. /dashboard -> public/dashboard.html).
const PAGE_ROUTES = ["dashboard", "mydinos", "marketplace", "skins", "livemap", "leaderboard", "supporter"];
for (const page of PAGE_ROUTES) {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", `${page}.html`));
  });
}

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Herby Death Squad portal running on port ${PORT}`);
});
