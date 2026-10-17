const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root,p), "utf8");
const { ALLOWED_STEAM_IDS, isAuthorized, requireTerritoryAdmin } = require("../server/middleware/requireTerritoryAdmin");

function send(status) { return { status, body: null, json(data) { this.body=data; return this; } }; }
test("Territory Wars allowlist contains exactly four distinct known website admin IDs", () => {
  assert.equal(ALLOWED_STEAM_IDS.length, 4);
  assert.equal(new Set(ALLOWED_STEAM_IDS).size, 4);
  assert.ok(ALLOWED_STEAM_IDS.every(id => /^\d{17}$/.test(id)));
  assert.ok(ALLOWED_STEAM_IDS.includes("76561198137456735")); // Chromie
  assert.ok(ALLOWED_STEAM_IDS.includes("76561199141282348")); // Defaultguy1
});
test("authentication requires listed Steam identity AND existing admin permission", () => {
  for (const steam_id of ALLOWED_STEAM_IDS) {
    assert.equal(isAuthorized({ steam_id, is_admin:1 }), true);
    assert.equal(isAuthorized({ steam_id, is_admin:0 }), false);
  }
  for (const steam_id of ["76561198000000001", "", null, undefined]) {
    assert.equal(isAuthorized({ steam_id, is_admin:1 }), false);
  }
  assert.equal(isAuthorized(null), false);
});
test("middleware returns 401 for guests, 403 for outsiders and only advances approved admins", () => {
  let advanced = 0;
  const next=()=>advanced++;
  assert.equal(requireTerritoryAdmin({user:null},send(401),next).body.error,"Login required");
  assert.equal(advanced,0);
  assert.equal(requireTerritoryAdmin({user:{is_admin:1,steam_id:"76561198000000001"}},send(403),next).body.error,"Territory Wars admin access required");
  assert.equal(advanced,0);
  requireTerritoryAdmin({user:{is_admin:1,steam_id:ALLOWED_STEAM_IDS[0]}},send(200),next);
  assert.equal(advanced,1);
});
test("production Territory Wars is off by default and protected before API and static mounts", () => {
  const code=read("server/index.js");
  assert.match(code,/TERRITORY_WARS_ADMIN_TEST_ENABLED\s*=\s*process\.env\.TERRITORY_WARS_ADMIN_TEST_ENABLED\s*===\s*"1"/);
  const guard=code.indexOf('app.use([\n    "/api/territory-wars"');
  const publicRoute=code.indexOf('app.get("/api/me"');
  const staticMount=code.indexOf('app.use(express.static(');
  assert.ok(guard > 0 && guard < publicRoute && publicRoute < staticMount);
  assert.match(code,/return requireTerritoryAdmin\(req, res, next\)/);
  assert.doesNotMatch(code,/require\(["']\.\/routes\/territoryWarsInternal["']\)/);
  assert.match(code,/TERRITORY_WARS_ADMIN_TEST_ENABLED && isTerritoryAdmin\(req\.user\)/);
});
test("preview controls cannot seed or fake presence in the production runtime", () => {
  const code=read("server/routes/territoryWars.js");
  assert.match(code,/function previewSimulationEnabled\(\) \{ return false; \}/);
  assert.match(code,/router\.tickRuntime\s*=\s*\(\) => processEventRuntime\(latestEventRaw\(\)\)/);
  assert.doesNotMatch(read("server/index.js"),/routes\/territoryWarsInternal/);
});
test("only approved accounts receive Territory Wars navigation and pages are not ordinary public pages",()=>{
  const nav=read("public/partials/nav.html");
  const common=read("public/assets/common.js");
  const index=read("server/index.js");
  assert.match(nav,/id="territory-admin-nav-link" hidden/);
  assert.match(common,/territoryAdminNavLink\.hidden = !Boolean\(me\?\.territoryWarsAdminAccess\)/);
  assert.match(index,/adminterritorywars/);
  assert.match(index,/groups\/territory-wars/);
});
