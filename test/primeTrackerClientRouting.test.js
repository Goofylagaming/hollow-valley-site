"use strict";
// Regression: the production incident sent a template expression literally,
// causing the automation service to reject every Prime request as HTTP 400.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const client = require("../server/services/automationWebsiteClient");

const STEAM = "76561198000000123";
const GOOD_PREFIX = "https://automation.example.test/api/website/prime/" + STEAM;
const LIFE = "d110944e-0f52-483e-9c77-e77b44e26b6e";
const REQUEST = "6751720a-f29f-4e1c-8796-535a1c225715";

test("Prime read and reset interpolate the linked Steam ID into actual API URLs", async () => {
  const prior = {
    base: process.env.AUTOMATION_SERVICE_URL,
    token: process.env.HOLLOW_VALLEY_API_TOKEN,
    fetch: globalThis.fetch,
  };
  process.env.AUTOMATION_SERVICE_URL = "https://automation.example.test";
  process.env.HOLLOW_VALLEY_API_TOKEN = "prime-hotfix-test-only-not-production";
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    assert.equal(options.headers.Authorization, "Bearer prime-hotfix-test-only-not-production");
    assert.doesNotMatch(String(url), /\$|%24|%7B|%7D|encodeURIComponent/i);
    return Response.json({ ok:true, value:"test-only" }, {status:200});
  };

  try {
    assert.deepEqual(await client.getPrimeTracker(STEAM), { ok:true,value:"test-only" });
    assert.deepEqual(
      await client.resetPrimeZones({
        steamId:STEAM,lifeId:LIFE,requestId:REQUEST,confirm:"RESET ZONES",
      }),
      { ok:true,value:"test-only" }
    );
    assert.equal(calls.length,2);
    assert.equal(calls[0].url, GOOD_PREFIX);
    assert.equal(calls[0].options.method,"GET");
    assert.equal(calls[1].url, GOOD_PREFIX + "/reset-zones");
    assert.equal(calls[1].options.method,"POST");
    assert.deepEqual(JSON.parse(calls[1].options.body),{
      lifeId:LIFE,requestId:REQUEST,confirm:"RESET ZONES",
    });
    assert.equal(calls[0].options.body,undefined);
    assert.throws(() => client.getPrimeTracker("invalid"), /valid 17-digit Steam ID/);
    assert.throws(() => client.resetPrimeZones({
      steamId:"invalid",lifeId:LIFE,requestId:REQUEST,confirm:"RESET ZONES",
    }), /valid 17-digit Steam ID/);
    assert.equal(calls.length,2,"Malformed IDs must not reach the automation API");
  } finally {
    globalThis.fetch = prior.fetch;
    if(prior.base===undefined)delete process.env.AUTOMATION_SERVICE_URL;
    else process.env.AUTOMATION_SERVICE_URL=prior.base;
    if(prior.token===undefined)delete process.env.HOLLOW_VALLEY_API_TOKEN;
    else process.env.HOLLOW_VALLEY_API_TOKEN=prior.token;
  }
});

test("Prime endpoints must never have escaped template interpolation in source",()=>{
  const source=fs.readFileSync(path.join(__dirname,"..","server","services",
    "automationWebsiteClient.js"),"utf8");
  assert.match(source,/return call\(\`\/prime\/\$\{encodeURIComponent\(validateSteamId\(steamId\)\)\}\`\)/);
  assert.match(source,/return call\(\`\/prime\/\$\{encodeURIComponent\(validateSteamId\(steamId\)\)\}\/reset-zones\`/);
  assert.doesNotMatch(source,/\/prime\/\\\$\{/);
});
