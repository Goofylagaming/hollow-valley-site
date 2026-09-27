const express = require("express");
const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { db } = require("./db");

const router = express.Router();
const scrypt = promisify(scryptCallback);
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const STEAM_VERIFICATION_MS = 15 * 60 * 1000;
const failures = new Map();

function ownerSteamId() {
  const id = String(process.env.OWNER_STEAM_ID || "").trim();
  return /^\d{17}$/.test(id) ? id : null;
}

function sameOrigin(req) {
  const origin = req.get("origin");
  return origin === `${req.protocol}://${req.get("host")}`;
}

function keyFor(req) {
  return String(req.ip || req.socket.remoteAddress || "unknown");
}

function isBlocked(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.until <= Date.now()) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key) {
  const entry = failures.get(key);
  failures.set(key, {
    count: entry && entry.until > Date.now() ? entry.count + 1 : 1,
    until: entry && entry.until > Date.now() ? entry.until : Date.now() + WINDOW_MS,
  });
  if (failures.size > 10000) {
    for (const [oldKey, oldEntry] of failures) {
      if (oldEntry.until <= Date.now()) failures.delete(oldKey);
    }
  }
}

function canSetUp(req) {
  const steamId = ownerSteamId();
  return Boolean(
    steamId && req.user?.steam_id === steamId &&
    req.session?.steamVerifiedId === steamId &&
    Date.now() - Number(req.session.steamVerifiedAt) < STEAM_VERIFICATION_MS
  );
}

router.get("/status", (req, res) => {
  const steamId = ownerSteamId();
  const configured = Boolean(steamId && db.prepare("SELECT 1 FROM owner_logins WHERE steam_id = ?").get(steamId));
  return res.json({ configured, canSetUp: canSetUp(req) });
});

router.post("/setup", async (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: "Open this page on Hollow Valley to continue." });
  if (!canSetUp(req)) return res.status(403).json({ error: "Sign in with the owner Steam account again to set up or reset email login." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (typeof password !== "string" || password.length < 16 || password.length > 256) {
    return res.status(400).json({ error: "Use a password between 16 and 256 characters." });
  }

  const salt = randomBytes(32).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  const sessionVersion = randomBytes(24).toString("hex");
  try {
    db.prepare(`INSERT INTO owner_logins (steam_id, email, password_salt, password_hash, session_version)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(steam_id) DO UPDATE SET email = excluded.email,
        password_salt = excluded.password_salt, password_hash = excluded.password_hash,
        session_version = excluded.session_version,
        updated_at = datetime('now')`).run(ownerSteamId(), email, salt, hash, sessionVersion);
    delete req.session.steamVerifiedAt;
    delete req.session.steamVerifiedId;
    req.session.save((error) => error
      ? res.status(500).json({ error: "Could not save your session." })
      : res.json({ ok: true }));
  } catch (error) {
    console.error("Owner login setup failed:", error);
    return res.status(500).json({ error: "Could not save owner login." });
  }
});

router.post("/login", async (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: "Open this page on Hollow Valley to continue." });
  const steamId = ownerSteamId();
  if (!steamId) return res.status(503).json({ error: "Owner email login is not configured." });

  const ipKey = `ip:${keyFor(req)}`;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const emailKey = `email:${email}`;
  if (isBlocked(ipKey) || isBlocked(emailKey)) {
    return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  }
  const password = req.body?.password;
  if (!email || email.length > 254 || typeof password !== "string" || password.length > 256) {
    recordFailure(ipKey);
    return res.status(401).json({ error: "Email or password is incorrect." });
  }

  const saved = db.prepare("SELECT email, password_salt, password_hash, session_version FROM owner_logins WHERE steam_id = ?").get(steamId);
  const hash = await scrypt(password, saved?.password_salt || "no-owner-login", 64);
  const expected = saved ? Buffer.from(saved.password_hash, "hex") : Buffer.alloc(64);
  const valid = Boolean(saved && email === saved.email && expected.length === hash.length && timingSafeEqual(hash, expected));
  const owner = valid ? db.prepare("SELECT id, is_admin FROM users WHERE steam_id = ?").get(steamId) : null;
  if (!valid || !owner) {
    recordFailure(ipKey);
    recordFailure(emailKey);
    return res.status(401).json({ error: "Email or password is incorrect." });
  }

  failures.delete(ipKey);
  failures.delete(emailKey);
  // The configured Steam identity is the sole source of owner privileges.
  if (!owner.is_admin) db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(owner.id);
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "Could not start your session." });
    req.session.userId = owner.id;
    req.session.ownerEmailAuth = true;
    req.session.ownerLoginVersion = saved.session_version;
    req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    req.session.save((saveError) => saveError
      ? res.status(500).json({ error: "Could not save your session." })
      : res.json({ ok: true, returnTo: "/admin" }));
  });
});

module.exports = router;
