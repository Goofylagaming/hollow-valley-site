"use strict";
// Disposable preview only. Uses the real website and automation routers with
// separate SQLite files and HTTP boundary, but no game/Discord/Stripe workers.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomBytes } = require("node:crypto");
if (process.env.VALLEY_LEGACY_STAGING !== "1")
  throw new Error("Explicit staging mode is required");
if (
  process.env.DB_PATH ||
  process.env.AUTOMATION_DB_PATH ||
  process.env.AUTOMATION_SERVICE_URL
)
  throw new Error(
    "Staging must not receive existing database or automation configuration",
  );
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "valley-legacy-staging-"));
process.env.DB_PATH = path.join(dir, "website.sqlite");
process.env.AUTOMATION_DB_PATH = path.join(dir, "automation.sqlite");
process.env.VALLEY_LEGACY_ENABLED = "1";
for (const key of [
  "HOLLOW_VALLEY_API_TOKEN",
  "AUTOMATION_ADMIN_TOKEN",
  "SESSION_SECRET",
])
  process.env[key] = randomBytes(32).toString("hex");
const publicUrl =
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${process.env.PORT || 3000}`;
process.env.STEAM_REALM = publicUrl;
process.env.STEAM_RETURN_URL = publicUrl + "/auth/steam/callback";
// Never provide credentials to this service. No normal runtime start functions
// are called: they would start unrelated schedulers and reconciliation jobs.
const { app: automation } = require("../automation-platform/src/index");
const backend = automation.listen(0, "127.0.0.1", () => {
  process.env.AUTOMATION_SERVICE_URL = `http://127.0.0.1:${backend.address().port}`;
  const legacy = require("../automation-platform/src/services/valleyLegacyService");
  legacy.start();
  const { createApp } = require("../server/index");
  const site = createApp();
  site.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log(
      "[valley-legacy] isolated staging ready; disposable databases; game workers disabled",
    ),
  );
});
