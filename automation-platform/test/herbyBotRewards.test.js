const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(),`herby-reward-${randomUUID()}.sqlite`);
const economy = require('../src/services/economyStore');
const {settle,signature} = require('../src/services/herbyBotRewards');
const secret = 'test-only-secret-12345678901234567890';
const env = {HERBYBOT_REWARDS_ENABLED:'true',HERBYBOT_REWARD_SIGNING_SECRET:secret,HERBY_GAME_GUILD_ID:'1540359454627725382'};
const payload = {guild:env.HERBY_GAME_GUILD_ID,reward:'abcdef1234567890',recipient:'111111111',amount:50,proposedBy:'222222222',approvedBy:'333333333'};
let linked = '76561198000000111';
const progression = {steamIdForDiscord:()=>linked};
const options = {env,economy,progression};
test('approved rewards use the real wallet ledger once, including after account relink',()=>{
  const first = settle(payload,signature(payload,secret),options);
  assert.equal(first.amount,50);
  assert.equal(economy.getWallet(linked).balance,50);
  assert.equal(settle(payload,signature(payload,secret),options).duplicate,true);
  linked = '76561198000000112';
  assert.equal(settle(payload,signature(payload,secret),options).transactionId,first.transactionId);
  assert.equal(economy.getWallet(linked).balance,0);
});
test('tampering, disabled flag, self approval and wrong guild cannot pay',()=>{
  assert.throws(()=>settle({...payload,amount:100},signature(payload,secret),options),/UNAUTHORIZED/);
  assert.throws(()=>settle(payload,signature(payload,secret),{...options,env:{...env,HERBYBOT_REWARDS_ENABLED:'false'}}),/DISABLED/);
  for (const change of [{guild:'other'},{approvedBy:payload.proposedBy},{amount:-1},{amount:1.5}]) {
    const bad = {...payload,...change};
    assert.throws(()=>settle(bad,signature(bad,secret),options),/INVALID/);
  }
});
test('idempotency conflicts and unlinked recipients cannot receive another payment',()=>{
  const changed = {...payload,amount:51};
  assert.throws(()=>settle(changed,signature(changed,secret),options),/CONFLICT/);
  const unlinked = {...payload,reward:'abcdef1234567891'};
  assert.throws(()=>settle(unlinked,signature(unlinked,secret),{...options,progression:{steamIdForDiscord:()=>null}}),/NOT_LINKED/);
});
