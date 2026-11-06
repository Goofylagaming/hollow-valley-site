'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');

test('spectator queries use producer-installed time-window indexes without changing stored state',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-spectator-plans-'));
 try{
  // A separate process closes every producer connection before Windows cleanup.
  // Use real startup schemas and capture the actual dashboard SQL, not copies.
  const script=`
   const path=require('node:path'),root=process.argv[1];
   for(const name of ['automationStore','economyStore','combatEventService','serverHealthHistoryService'])require(path.join(root,'src/services',name));
   const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(process.env.AUTOMATION_DB_PATH),queries=[];
   db.exec(\`BEGIN;
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
    INSERT INTO combat_events(id,occurred_at,killer_steam_id,victim_steam_id,source)
    SELECT 'old-'||x,'2025-01-01T00:00:00Z','76561198000000001','76561198000000002','hollow-valley-game' FROM n;
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
    INSERT INTO server_health_samples(checked_at,online) SELECT '2025-01-01T00:00:00Z',0 FROM n;
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
    INSERT INTO automation_audit(id,category,action,status,updated_at) SELECT 'old-'||x,'test','inspect','failed','2025-01-01T00:00:00Z' FROM n;
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
    INSERT INTO automation_requests(id,kind,status,updated_at) SELECT 'old-'||x,'test','failed','2025-01-01T00:00:00Z' FROM n;
    INSERT INTO combat_events(id,occurred_at,killer_steam_id,victim_steam_id,source) VALUES
     ('recent-1','2026-11-05T23:59:59Z','76561198000000001','76561198000000002','hollow-valley-game'),
     ('recent-2','2026-11-05T20:00:00-04:00','76561198000000001','76561198000000002','hollow-valley-game'),
     ('future','2026-11-06T00:00:01Z','76561198000000001','76561198000000002','hollow-valley-game'),
     ('other-source','2026-11-06T00:00:00Z','76561198000000001','76561198000000002','manual');
    INSERT INTO server_health_samples(checked_at,online) VALUES('2026-11-05T23:59:59.000Z',1);
    INSERT INTO automation_audit(id,category,action,status,updated_at) VALUES('recent-audit','test','inspect','failed','2026-11-06 00:00:00');
    INSERT INTO automation_requests(id,kind,status,updated_at) VALUES('recent-request','test','failed','2026-11-06T00:00:00.000Z');
    INSERT INTO economy_wallets(steam_id) VALUES('76561198000000001');
    INSERT INTO economy_marketplace_catalog(id,item_type,name,price) VALUES('test','test','Synthetic query fixture',1);
    INSERT INTO economy_marketplace_orders(id,steam_id,catalog_id,price,status,idempotency_key,updated_at) VALUES('recent-order','76561198000000001','test',1,'failed','recent-order','2026-11-05T20:00:00-04:00');
    COMMIT;\`);
   db.exec('PRAGMA query_only=ON');
   const source=require(path.join(root,'src/services/adminSpectatorService')).createAdminSpectatorSource({db:{prepare(sql){const stmt=db.prepare(sql);return {get(...args){queries.push({sql,args});return stmt.get(...args);},all(...args){queries.push({sql,args});return stmt.all(...args);}};}},enabled:()=>true,combatSource:()=>'hollow-valley-game',now:()=>Date.parse('2026-11-06T00:00:00Z')});
   const before=db.prepare('SELECT total_changes() n').get().n;
   const value=source.read();
   const plans=queries.map(({sql,args})=>({sql,detail:db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join(' | ')}));
   console.log(JSON.stringify({plans,value,before,after:db.prepare('SELECT total_changes() n').get().n}));db.close();
  `;
  const output=execFileSync(process.execPath,['-e',script,path.resolve(__dirname,'..')],{env:{...process.env,AUTOMATION_DB_PATH:path.join(temp,'automation.sqlite')},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const result=JSON.parse(output.trim());assert.equal(result.after,result.before);
  const plan=fragment=>{const match=result.plans.find(row=>row.sql.includes(fragment));assert.ok(match,'Missing executed query: '+fragment);return match.detail;};
  // Keep complete source/time filtering: an arbitrary recent-row cap could hide
  // repeated pairs or report a false zero when retained history grows.
  assert.equal(result.value.combat.pairs.length,1);assert.equal(result.value.combat.pairs[0].count,2);
  assert.equal(result.value.health.online,true);assert.equal(result.value.marketplace.failedOrders,1);
  assert.deepEqual(result.value.errors.items.map(row=>row.id).sort(),['recent-audit','recent-request']);
  assert.match(plan('FROM combat_events'),/idx_combat_events_spectator_window/);
  assert.match(plan('FROM combat_events'),/source=\? AND <expr>>\? AND <expr><\?/);
  assert.match(plan('FROM server_health_samples'),/idx_server_health_observed/);
  assert.doesNotMatch(plan('FROM server_health_samples'),/USE TEMP B-TREE/);
  assert.match(plan('FROM economy_marketplace_orders'),/idx_economy_orders_updated/);
  assert.match(plan('FROM economy_marketplace_orders'),/status=\? AND <expr>>\? AND <expr><\?/);
  assert.match(plan('FROM automation_audit'),/idx_automation_audit_updated/);
  assert.match(plan('FROM automation_audit'),/idx_automation_requests_updated/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
