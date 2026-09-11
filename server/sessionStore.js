// Minimal express-session store backed by the same SQLite database, so logins
// survive a server restart instead of relying on the default in-memory store.
const session = require("express-session");
const { db } = require("./db");

class SqliteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare("SELECT sess, expires FROM sessions WHERE sid = ?").get(sid);
      if (!row) return callback(null, null);
      if (row.expires < Date.now()) {
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
      const expires = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 24 * 7;
      db.prepare(
        "INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires"
      ).run(sid, JSON.stringify(sessionData), expires);
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
