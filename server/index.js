require("dotenv").config();
const path = require("node:path");
const express = require("express");
const session = require("express-session");

const { db } = require("./db");
const { SqliteSessionStore } = require("./sessionStore");
const authRouter = require("./auth");
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
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

// Attach the logged-in user (if any) to every request.
app.use((req, res, next) => {
  if (req.session.userId) {
    req.user = db.prepare("SELECT id, discord_id, username, avatar, is_admin FROM users WHERE id = ?").get(req.session.userId) || null;
  }
  next();
});

app.get("/api/me", (req, res) => {
  res.json({ loggedIn: Boolean(req.user), user: req.user || null, discordLoginConfigured: authRouter.isConfigured });
});

app.use("/auth", authRouter);
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
