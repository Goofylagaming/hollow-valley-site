"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const base = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(base,name),"utf8");
const routeNames = [
  ["/status", "status.html"],
  ["/reports", "reports.html"],
  ["/rules", "rules.html"],
  ["/packs", "packs.html"],
  ["/updates", "updates.html"],
  ["/support", "support.html"],
  ["/community", "community.html"],
  ["/recruitment", "recruitment.html"],
  ["/activity", "activity.html"],
];
const adminPages = [
  ["adminincidents","adminincidents.html"],
  ["adminreports","adminreports.html"],
  ["adminrules","adminrules.html"],
  ["adminupdates","adminupdates.html"],
  ["adminsupport","adminsupport.html"],
  ["adminactivity","adminactivity.html"],
];

test("integrated public routes are registered once and serve the real existing HTML assets",()=>{
  const app=read("server/index.js");
  const routes=app.match(/const PAGE_ROUTES = \[([^\]]+)\]/)?.[1]||"";
  for(const [route,html] of routeNames){
    const simple=route.slice(1);
    assert.match(routes,new RegExp('"'+simple+'"'),"Missing public route "+route);
    assert.ok(fs.existsSync(path.join(base,"public",html)),"Missing route HTML "+html);
  }
  for(const route of ["/api/admin-incidents","/api/reports","/api/community-guides",
    "/api/site-updates","/api/support-tickets","/api/group-recruitment","/api/community-activity"]) {
    assert.equal(app.split('"'+route+'"').length-1,1,"API registered more than once or absent "+route);
  }
  const legacy=read("server/routes/valleyLegacy.js");
  assert.match(legacy,/VALLEY_LEGACY_ENABLED/);
});

test("every new admin page retains a server-side authentication gate and never redirects unauthorised visitors to static HTML",()=>{
  const app=read("server/index.js");
  for(const [route,html] of adminPages){
    assert.match(app,new RegExp(route+': "'+html.replace(".","\\.")+'"'));
    const page=read("public/"+html);
    assert.match(page,/noindex, nofollow/);
    assert.match(page,/\/assets\/common\.js/);
  }
  assert.match(app,/app\.get\(\[\`\/\$\{route\}\`, \`\/\$\{route\}\.html\`\], requireAdmin/);
  assert.match(read("public/partials/nav.html"),/id="admin-nav-group" hidden/);
  assert.match(read("public/assets/common.js"),/adminNavGroup\.hidden = !isAdmin/);
});

test("consolidated website retains independent Wallet, Quests and Live Map shortcuts and all feature navigation",()=>{
  const nav=read("public/partials/nav.html");
  for(const [href] of routeNames){
    assert.match(nav,new RegExp('href="'+href+'"'),href+" should be discoverable");
  }
  for(const href of ["/wallet","/quests","/livemap","/dinostorage/",
    "/marketplace","/mydinos","/skins","/friends","/groups",
    "/events","/supporter"]){
    assert.match(nav,new RegExp('href="'+href.replace("/","\\/")+'"'));
  }
  assert.match(nav,/id="primalbound-nav-link"/);
  assert.match(nav,/id="valley-legacy-nav" hidden/);
});

test("all 31 feature descriptions, voting and the three active vote slots survive W01/UX integration",()=>{
  const roadmap=read("public/assets/home-roadmap.js");
  const votes=read("server/services/roadmapCommunity.js");
  const home=read("public/index.html");
  for(const id of [25,26,29]){
    assert.match(roadmap,new RegExp(id+": \\{ status: 'building'"));
    assert.doesNotMatch(votes,new RegExp("24, 25, 26, 29"));
  }
  assert.match(roadmap,/View status page/);
  assert.match(roadmap,/Player Reports/);
  assert.equal((roadmap.match(/\[\d+, '[^']+'/g)||[]).length,31);
  assert.match(home,/roadmap-vote-status/);
  assert.match(home,/roadmap-suggestion-form/);
  assert.match(votes,/MAX_VOTES = 3/);
  assert.match(votes,/myVotes[\s\S]*\.filter\(id => eligible\.has\(id\)\)/);
  assert.match(votes,/ON CONFLICT|INSERT INTO roadmap_votes/);
});

test("integration preserves a single original HerbyBot Discord client and distinct progress destination",()=>{
  const bridge=read("automation-platform/integration/herbyBotBridge.js");
  const outbox=read("automation-platform/src/services/herbyBotOutboxService.js");
  const env=read("automation-platform/.env.example");
  const progress=read("automation-platform/src/routes/progressUpdateRoutes.js");
  assert.match(bridge,/DISCORD_PROGRESS_CHANNEL_ID/);
  assert.match(bridge,/destination === 'progress'/);
  assert.match(bridge,/allowedMentions: \{ parse: \[\] \}/);
  assert.match(outbox,/queueProgress/);
  assert.match(progress,/HV_DISCORD_PROGRESS_TOKEN/);
  assert.doesNotMatch(env,/^DISCORD_BOT_TOKEN=/m);
  assert.doesNotMatch(read("render.yaml"),/DISCORD_BOT_TOKEN|RCON_PASSWORD/);
  assert.match(read("docs/DISCORD_PROGRESS_UPDATES.md"),/1550133934871023679/);
});

test("integrated homepage retains read-only status, releases and personal progression",()=>{
  const home=read("public/index.html");
  const client=read("public/assets/home-v2.js");
  const release=read("public/assets/site-updates.js");
  assert.match(home,/href="\/status"/);
  assert.match(home,/home-updates-list/);
  assert.match(home,/home-roadmap\.js\?v=5/);
  assert.match(client,/status\?\.online && !status\?\.stale/);
  assert.match(client,/home-profile-progress/);
  assert.doesNotMatch(release,/\.innerHTML\s*=/);
  assert.match(read(".env.example"),/SITE_UPDATES_AUTO_RELEASE_ENABLED=false/);
  assert.match(read(".env.example"),/HV_SUPPORT_TICKETS_ENABLED=false/);
});
