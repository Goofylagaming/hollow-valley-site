const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("automation deploy branch only mirrors changes to automation-platform code", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/sync-automation-branch.yml"), "utf8");
  assert.match(yml, /on:\s*\n\s*push:\s*\n\s*branches:\s*\n\s*- master\s*\n\s*paths:\s*\n\s*- ['"]automation-platform\/\*\*['"]/);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /git push origin HEAD:refs\/heads\/automation-platform\s*$/m);
  assert.doesNotMatch(yml, /git push[^\n]*--force/);
  assert.doesNotMatch(yml, /- ['"](?:server|public)\/\*\*['"]/);
});
