// Minimal express-session store backed by the same SQLite database, so logins
// survive a server restart instead of relying on the default in-memory store.
const session = require("express-session");
const { db } = require("./db");

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 90;

// Sessions use `rolling: true`, so the browser's cookie expiry is pushed
// forward on every response. The row's expiry has to be pushed forward too,
// otherwise the server-side record quietly expires while the browser still
// believes it holds a valid session - which surfaces as a random logout.
function expiryFor(sessionData) {
  const expires = sessionData?.cookie?.expires;
  if (expires) {
    const parsed = new Date(expires).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  const maxAge = sessionData?.cookie?.originalMaxAge;
  return Date.now() + (Number.isFinite(maxAge) ? maxAge : DEFAULT_TTL_MS);
}

class SqliteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare("SELECT sess, expires FROM sessions WHERE sid = ?").get(sid);
      if (!row) {
        // The browser presented a session we have no record of. This is the
        // signature of an unexpected logout, so make it visible in the logs.
        console.warn(`[session] unknown sid presented: ${sid.slice(0, 8)}...`);
        return callback(null, null);
      }
      if (row.expires < Date.now()) {
        console.warn(`[session] expired sid presented: ${sid.slice(0, 8)}... (expired ${new Date(row.expires).toISOString()})`);
        db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback) {
    try {
      db.prepare(
        "INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires"
      ).run(sid, JSON.stringify(sessionData), expiryFor(sessionData));
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  // Called by express-session on requests that read but don't modify the
  // session. Without this, `rolling` only ever refreshes the client cookie.
  touch(sid, sessionData, callback) {
    try {
      db.prepare("UPDATE sessions SET expires = ? WHERE sid = ?").run(expiryFor(sessionData), sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }
}

module.exports = { SqliteSessionStore };
