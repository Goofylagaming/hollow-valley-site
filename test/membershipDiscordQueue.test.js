const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db } = require('../server/db');
require('../server/services/supporterWebhook');
const roles = require('../server/services/discordMembership');
let queue = require('../server/services/membershipDiscordQueue');

const NOW = Date.UTC(2026,10,2,12);
const DISCORD = '1546023362642317404';
const ROLE = {supporter:'1550695486464204810',guardian:'1550695581373042688',legend:'1550695426456555551',community:'1550000000000000001'};
const env = {
  MEMBERSHIP_REWARDS_ENABLED:'true', MEMBERSHIP_DISCORD_SYNC_ENABLED:'true',
  DISCORD_ROLE_BOT_TOKEN:'fixture-token-not-real', DISCORD_GUILD_ID:'1540359454627725382',
  DISCORD_ROLE_SUPPORTER_ID:ROLE.supporter, DISCORD_ROLE_GUARDIAN_ID:ROLE.guardian, DISCORD_ROLE_LEGEND_ID:ROLE.legend,
};
function reset({tier='legend',status='active',until=NOW+60000,discordId=DISCORD}={}) {
  queue.ensureSchema();
  db.exec('DELETE FROM membership_discord_sync; DELETE FROM supporter_subscriptions; DELETE FROM users;');
  db.prepare('INSERT INTO users (id,discord_id,username) VALUES (42,?,?)').run(discordId,'member');
  if(tier)db.prepare('INSERT INTO supporter_subscriptions(user_id,tier,stripe_status,renews_at,auto_renew) VALUES (42,?,?,?,1)')
    .run(tier,status,until===null?null:new Date(until).toISOString());
}
function discord(initial=[ROLE.community]) {
  const accounts = new Map([[DISCORD,new Set(initial)]]); const calls=[];
  return {accounts,calls,fetchImpl:async(url,options={})=>{
    const match=/\/members\/(\d+)(?:\/roles\/(\d+))?$/.exec(url);
    assert.ok(match,`Unexpected Discord operation: ${url}`);
    const [,id,role]=match;const method=options.method||'GET';calls.push({id,role,method});
    if(!accounts.has(id))accounts.set(id,new Set([ROLE.community]));
    const assigned=accounts.get(id);
    if(method==='GET')return {ok:true,status:200,json:async()=>({roles:[...assigned]})};
    assert.ok(Object.values(ROLE).includes(role));assert.notEqual(role,ROLE.community);
    if(method==='PUT')assigned.add(role);else if(method==='DELETE')assigned.delete(role);else assert.fail(`Unexpected role operation ${method}`);
    return {ok:true,status:204,json:async()=>null};
  }};
}

test('queue and new-mode direct sync stay disabled until explicitly enabled',async()=>{
  reset();const disabled={...env,MEMBERSHIP_DISCORD_SYNC_ENABLED:'false'};
  assert.deepEqual(queue.enqueue(42,{env:disabled,now:NOW}),{queued:false,reason:'disabled'});
  assert.equal((await queue.processQueue({env:disabled,now:NOW,fetchImpl:async()=>assert.fail('network')})).reason,'disabled');
  assert.equal((await roles.syncDiscordMembershipForUser(42,{env:disabled,now:NOW,fetchImpl:async()=>assert.fail('network')})).reason,'disabled');
});
test('preview identities never schedule or perform Discord role mutations',async()=>{
  reset();const preview={...env,RENDER_SERVICE_ID:'srv-isolated-preview'};let scheduled=0;
  assert.equal(queue.start({env:preview,schedule:()=>{scheduled++;}}),null);assert.equal(scheduled,0);
  assert.equal(queue.enqueue(42,{env:preview,now:NOW}).reason,'preview');
  assert.equal((await roles.syncDiscordMembershipForUser(42,{env:preview,now:NOW,fetchImpl:async()=>assert.fail('network')})).reason,'preview');
  const legacyPreview={...preview,MEMBERSHIP_REWARDS_ENABLED:'false'};
  assert.equal((await roles.syncDiscordMembershipForUser(42,{env:legacyPreview,fetchImpl:async()=>assert.fail('network')})).reason,'preview');
});
test('scheduled cancellation keeps noncoin role until paid expiry then sweep removes only membership roles',async()=>{
  reset();db.prepare("UPDATE supporter_subscriptions SET auto_renew=0,cancelled_at='2026-11-02' WHERE user_id=42").run();
  const api=discord();
  const first=await queue.processQueue({env,now:NOW,fetchImpl:api.fetchImpl});assert.equal(first.synced,1);
  assert.deepEqual([...api.accounts.get(DISCORD)].sort(),[ROLE.community,ROLE.legend].sort());
  const expiry=await queue.processQueue({env,now:NOW+60001,fetchImpl:api.fetchImpl});assert.equal(expiry.synced,1);
  assert.deepEqual([...api.accounts.get(DISCORD)],[ROLE.community]);
  assert.equal(queue.getSyncState(42,{env}).pending,false);
});
test('new noncoin role entitlement requires a valid future paid end and active status',async()=>{
  reset({until:null});const api=discord([ROLE.legend,ROLE.community]);
  await queue.processQueue({env,now:NOW,fetchImpl:api.fetchImpl});assert.deepEqual([...api.accounts.get(DISCORD)],[ROLE.community]);
  reset({status:'trialing'});const trial=discord([ROLE.legend,ROLE.community]);
  await queue.processQueue({env,now:NOW,fetchImpl:trial.fetchImpl});assert.deepEqual([...trial.accounts.get(DISCORD)],[ROLE.community]);
});
test('failed jobs persist across module restart and respect next attempt time',async()=>{
  reset();await queue.processQueue({env,now:NOW,fetchImpl:async()=>{throw new Error('private external failure');}});
  let state=queue.getSyncState(42,{env});assert.equal(state.pending,true);assert.equal(state.error.includes('private'),false);
  const retryAt=Date.parse(state.nextAttemptAt);assert.ok(retryAt>=NOW+30000);
  const path=require.resolve('../server/services/membershipDiscordQueue');delete require.cache[path];queue=require(path);
  const api=discord();assert.equal((await queue.processQueue({env,now:retryAt-1,fetchImpl:api.fetchImpl})).processed,0);
  assert.equal((await queue.processQueue({env,now:retryAt,fetchImpl:api.fetchImpl})).synced,1);
  state=queue.getSyncState(42,{env});assert.equal(state.pending,false);assert.equal(state.error,null);assert.ok(state.lastSyncedAt);
});
test('retries read the latest membership tier instead of replaying the failed event',async()=>{
  reset();await queue.processQueue({env,now:NOW,fetchImpl:async()=>{throw new Error('offline');}});
  db.prepare("UPDATE supporter_subscriptions SET tier='guardian' WHERE user_id=42").run();
  const api=discord([ROLE.legend,ROLE.community]);
  const result=await queue.processQueue({env,now:NOW+1000,fetchImpl:api.fetchImpl});assert.equal(result.synced,1);
  assert.deepEqual([...api.accounts.get(DISCORD)].sort(),[ROLE.guardian,ROLE.community].sort());
});
test('retry attempts are bounded and explicit enqueue restarts a failed job',async()=>{
  reset({until:NOW+86400000});let time=NOW;
  for(let attempt=1;attempt<=queue.MAX_ATTEMPTS;attempt++){
    await queue.processQueue({env,now:time,fetchImpl:async()=>{throw new Error('unavailable');}});
    const row=db.prepare('SELECT * FROM membership_discord_sync WHERE user_id=42').get();assert.equal(row.attempts,attempt);time=row.next_attempt_at;
  }
  assert.equal(queue.getSyncState(42,{env}).needsRetry,true);
  assert.equal((await queue.processQueue({env,now:time+1,fetchImpl:async()=>assert.fail('exhausted retry')})).processed,0);
  queue.enqueue(42,{env,now:time+1});const api=discord();
  assert.equal((await queue.processQueue({env,now:time+1,fetchImpl:api.fetchImpl})).synced,1);
});
test('Discord rate limit retry delay is honored and upstream messages never enter public state',async()=>{
  reset();await queue.processQueue({env,now:NOW,fetchImpl:async()=>({ok:false,status:429,json:async()=>({retry_after:120,message:'secret private upstream detail'})})});
  const state=queue.getSyncState(42,{env});assert.ok(Date.parse(state.nextAttemptAt)>=NOW+120000);
  assert.equal(JSON.stringify(state).includes('secret'),false);assert.match(state.error,/Discord is busy/);
});
test('a linked account change clears only managed roles from the previously linked account',async()=>{
  reset();const api=discord();await queue.processQueue({env,now:NOW,fetchImpl:api.fetchImpl});
  const replacement='1546023362642317405';db.prepare('UPDATE users SET discord_id=? WHERE id=42').run(replacement);
  await queue.processQueue({env,now:NOW+1000,fetchImpl:api.fetchImpl});
  assert.deepEqual([...api.accounts.get(DISCORD)],[ROLE.community]);
  assert.deepEqual([...api.accounts.get(replacement)].sort(),[ROLE.community,ROLE.legend].sort());
  db.prepare('UPDATE users SET discord_id=NULL WHERE id=42').run();
  await queue.processQueue({env,now:NOW+2000,fetchImpl:api.fetchImpl});
  assert.deepEqual([...api.accounts.get(replacement)],[ROLE.community]);assert.equal(queue.getSyncState(42,{env}).linked,false);
});
test('active durable lease prevents duplicate worker processing and expired lease is recoverable',async()=>{
  reset();queue.enqueue(42,{env,now:NOW});
  db.prepare("UPDATE membership_discord_sync SET lock_token='other-worker',lock_until=? WHERE user_id=42").run(NOW+1000);
  const api=discord();assert.equal((await queue.processQueue({env,now:NOW,fetchImpl:api.fetchImpl})).processed,0);
  assert.equal((await queue.processQueue({env,now:NOW+1001,fetchImpl:api.fetchImpl})).synced,1);
});
test('overlapping runs in one worker do not duplicate role changes',async()=>{
  reset();const api=discord();let release;let signal;
  const started=new Promise(resolve=>{signal=resolve;});const blocked=new Promise(resolve=>{release=resolve;});let first=true;
  const work=queue.processQueue({env,now:NOW,fetchImpl:async(...args)=>{if(first){first=false;signal();await blocked;}return api.fetchImpl(...args);}});
  await started;assert.equal((await queue.processQueue({env,now:NOW,fetchImpl:api.fetchImpl})).reason,'already-running');
  release();await work;assert.equal(api.calls.filter(call=>call.method==='PUT').length,1);
});
