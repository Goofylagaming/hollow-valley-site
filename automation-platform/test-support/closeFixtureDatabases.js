"use strict";

const sqlite = require("node:sqlite");
const path = require("node:path");

// Some services own private SQLite connections. Record only the connections
// opened for a test directory and release them before Windows removes it.
const connections = new Map();
const SQLiteDatabase = sqlite.DatabaseSync;
sqlite.DatabaseSync = class FixtureDatabase extends SQLiteDatabase {
  constructor(filename, ...options) {
    super(filename, ...options);
    if (typeof filename === "string" && filename !== ":memory:") {
      const directory = path.dirname(path.resolve(filename));
      if (!connections.has(directory)) connections.set(directory, []);
      connections.get(directory).push(this);
    }
  }
};

module.exports = function closeFixtureDatabases(directory) {
  const key = path.resolve(directory);
  for (const db of connections.get(key) || []) {
    if (db.isOpen) db.close();
  }
  connections.delete(key);
};
