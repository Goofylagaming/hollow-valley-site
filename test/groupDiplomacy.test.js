const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-diplomacy-'));process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.GROUP_TREASURY_ENABLED='0';
const {db}=require('../server/db'),groups=require('../server/groupsStore');
const {createGroupDiplomacy}=require('../server/services/groupDiplomacy');
test.after(()=>{db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
let n=0;
function fixture(){
 n++;const A=String(76561198000020000n+BigInt(n*10)),B=String(BigInt(A)+1n),M=String(BigInt(A)+2n);
 for(const actor of [A,B,M])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic diplomacy player');
 const a=groups.createGroup(A,'Diplomacy A '+n).current.id,b=groups.createGroup(B,'Diplomacy B '+n).current.id;
 groups.invite(A,M);groups.actOnInvite(M,groups.getState(M).incoming[0].id,'accept');
 let clock=100000;const service=createGroupDiplomacy(db,groups,{now:()=>clock});let key=0;
 const action=(name,actor=A,revision=service.detail(actor,actor===B?a:b).revision,requestId='diplomacy_'+n+'_'+(++key))=>service.change(actor,{expectedGroupId:actor===B?b:a,targetGroupId:actor===B?a:b,expectedRevision:revision,action:name,requestId});
 return {A,B,M,a,b,service,action,advance:()=>clock+=60001};
}
const code=value=>error=>error.code===value;
test('alliances require both current owners; members can read but cannot accept or declare',()=>{
 const f=fixture();const proposed=f.action('propose_alliance');assert.equal(proposed.alliance,'pending');assert.equal(proposed.effectiveAlliance,false);assert.equal(proposed.proposalFrom,f.a);
 assert.throws(()=>f.action('accept_alliance'),code('RELATION_ACTION_UNAVAILABLE'));
 assert.throws(()=>f.service.change(f.M,{expectedGroupId:f.a,targetGroupId:f.b,expectedRevision:1,action:'declare_rival',requestId:'member_attempt'}),code('GROUP_OWNER_REQUIRED'));
 assert.equal(f.service.detail(f.M,f.b).canManage,false);
 const accepted=f.action('accept_alliance',f.B);assert.equal(accepted.alliance,'active');assert.equal(accepted.effectiveAlliance,true);assert.equal(f.service.detail(f.A,f.b).effectiveAlliance,true);
 assert.equal(JSON.stringify(accepted).includes(f.A),false);assert.equal(JSON.stringify(accepted).includes(f.B),false);
});
test('rivalry is directional, cancels an alliance/proposal, and cannot be cleared by the other owner',()=>{
 const f=fixture();f.action('propose_alliance');f.action('accept_alliance',f.B);const rival=f.action('declare_rival');assert.equal(rival.alliance,'none');assert.equal(rival.outgoingRival,true);
 assert.equal(f.service.detail(f.B,f.a).incomingRival,true);assert.throws(()=>f.action('clear_rival',f.B),code('RELATION_ACTION_UNAVAILABLE'));assert.throws(()=>f.action('propose_alliance',f.B),code('RELATION_ACTION_UNAVAILABLE'));
 f.action('declare_rival',f.B);f.action('clear_rival');assert.equal(f.service.detail(f.A,f.b).incomingRival,true);assert.equal(f.service.detail(f.A,f.b).outgoingRival,false);f.action('clear_rival',f.B);assert.equal(f.action('propose_alliance').alliance,'pending');
});
test('recipient can decline; either owner can end an active alliance; outgoing proposal can be withdrawn',()=>{
 const f=fixture();f.action('propose_alliance');assert.equal(f.action('decline_alliance',f.B).alliance,'none');f.action('propose_alliance');assert.equal(f.action('end_alliance').alliance,'none');f.action('propose_alliance');f.action('accept_alliance',f.B);assert.equal(f.action('end_alliance',f.B).alliance,'none');
});
test('stale revisions/group IDs and altered retry details cannot overwrite a new decision',()=>{
 const f=fixture(),key='retry_exact_'+n;f.action('propose_alliance',f.A,0,key);f.action('accept_alliance',f.B);
 const retry=f.action('propose_alliance',f.A,0,key);assert.equal(retry.duplicate,true);assert.equal(retry.revision,2);assert.equal(retry.alliance,'active');
 assert.throws(()=>f.action('declare_rival',f.A,0,key),code('RELATION_REQUEST_CONFLICT'));
 assert.throws(()=>f.action('declare_rival',f.A,1),code('RELATION_CHANGED'));
 assert.throws(()=>f.service.change(f.A,{expectedGroupId:f.b,targetGroupId:f.a,expectedRevision:0,action:'declare_rival',requestId:'wrong_group_key'}),code('GROUP_CHANGED'));
});
test('failed audit rolls back both a new relationship and subsequent revisions',()=>{
 const f=fixture();db.exec("CREATE TRIGGER fail_diplomacy BEFORE INSERT ON hv_group_relation_edits BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
 assert.throws(()=>f.action('propose_alliance'),/synthetic audit failure/);assert.equal(f.service.detail(f.A,f.b).relationId,null);db.exec('DROP TRIGGER fail_diplomacy');f.action('propose_alliance');
 db.exec("CREATE TRIGGER fail_diplomacy BEFORE INSERT ON hv_group_relation_edits BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
 assert.throws(()=>f.action('accept_alliance',f.B),/synthetic audit failure/);assert.equal(f.service.detail(f.A,f.b).revision,1);assert.equal(f.service.detail(f.A,f.b).alliance,'pending');db.exec('DROP TRIGGER fail_diplomacy');
});
test('owner succession preserves the group proposal but removes the former owner authority',()=>{
 const f=fixture();f.action('propose_alliance');groups.exitGroup(f.A);
 assert.throws(()=>f.action('end_alliance'),code('GROUP_REQUIRED'));
 const successor=f.service.change(f.M,{expectedGroupId:f.a,targetGroupId:f.b,expectedRevision:1,action:'end_alliance',requestId:'successor_'+n});assert.equal(successor.alliance,'none');assert.equal(successor.history.length,2);
});
test('closed groups retain historical relationships and name reuse cannot inherit their alliance',()=>{
 const f=fixture();f.action('propose_alliance');f.action('accept_alliance',f.B);const name=groups.getState(f.B).current.name;groups.disband(f.B);
 const old=f.service.detail(f.A,f.b);assert.equal(old.alliance,'active');assert.equal(old.effectiveAlliance,false);assert.equal(old.otherGroup.status,'closed');
 const replacement=groups.createGroup(f.B,name).current.id;assert.notEqual(replacement,f.b);assert.equal(f.service.detail(f.A,replacement).alliance,'none');assert.throws(()=>f.action('declare_rival'),code('GROUP_UNAVAILABLE'));
});
test('search exposes bounded group names only and treats wildcard characters literally',()=>{
 const f=fixture();db.prepare('UPDATE hv_groups SET name=? WHERE id=?').run('Search%Value '+n,f.b);db.prepare('UPDATE hv_groups SET name=? WHERE id=?').run('SearchXValue '+n,f.a);
 const result=f.service.search(f.A,'%V');assert.deepEqual(result.groups.map(group=>group.id),[f.b]);assert.equal(JSON.stringify(result).includes(f.B),false);assert.throws(()=>f.service.search(f.A,'x'),code('INVALID_SEARCH'));assert.throws(()=>f.service.detail(f.A,f.a),code('SELF_RELATION'));
});
test('rate limits count successful changes and release after the configured window',()=>{
 const f=fixture();for(let index=0;index<20;index++)f.action(index%2?'clear_rival':'declare_rival');
 assert.throws(()=>f.action('declare_rival'),code('RELATION_RATE_LIMIT'));assert.equal(f.service.detail(f.A,f.b).revision,20);f.advance();assert.equal(f.action('declare_rival').revision,21);
});
test('a closing group cannot create or accept a new relationship',()=>{
 const f=fixture();db.prepare("INSERT INTO hv_group_treasury_closures(group_id,request_id,actor,action,state) VALUES(?,?,?,'disband','checking')").run(f.b,'closing_relation_'+n,f.B);
 assert.throws(()=>f.action('propose_alliance'),code('GROUP_CLOSURE_PENDING'));assert.equal(f.service.detail(f.A,f.b).revision,0);
});
test('active relationship capacity applies to incoming declarations as well as the acting group',()=>{
 const f=fixture();const insert=db.prepare("INSERT INTO hv_group_relations(group_low,group_high,revision,alliance,low_rival,high_rival,updated_at) VALUES(?,?,1,'none',1,0,100000)");
 for(let index=0;index<100;index++){
  const other=Number(db.prepare("INSERT INTO hv_groups(name,owner_steam_id,status) VALUES(?,?,'active')").run('Capacity fixture '+n+' '+index,f.A).lastInsertRowid);
  insert.run(Math.min(f.b,other),Math.max(f.b,other));
 }
 assert.throws(()=>f.action('declare_rival'),code('RELATION_CAPACITY'));assert.equal(f.service.detail(f.A,f.b).revision,0);
 const first=f.service.list(f.B);assert.equal(first.relations.length,50);assert.ok(first.nextRelationId);
 const second=f.service.list(f.B,{afterRelationId:first.nextRelationId});assert.equal(second.relations.length,50);assert.equal(second.nextRelationId,null);assert.equal(new Set([...first.relations,...second.relations].map(row=>row.relationId)).size,100);
});
test('independent processes using one expected revision cannot apply competing decisions',async()=>{
 const f=fixture();const source=`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.RELATION_TEST_DB);db.exec('PRAGMA busy_timeout=5000');const groups={getState:actor=>({current:db.prepare("SELECT g.id,g.name,g.owner_steam_id AS ownerSteamId FROM hv_groups g JOIN hv_group_members m ON m.group_id=g.id WHERE m.steam_id=? AND g.status='active'").get(actor)})};const service=require(process.env.RELATION_TEST_SERVICE).createGroupDiplomacy(db,groups);try{process.stdout.write(JSON.stringify(service.change(process.env.RELATION_TEST_ACTOR,JSON.parse(process.env.RELATION_TEST_INPUT))));}catch(error){process.stdout.write(JSON.stringify({code:error.code}));}finally{db.close();}`;
 const run=action=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',source],{windowsHide:true,env:{...process.env,RELATION_TEST_DB:process.env.DB_PATH,RELATION_TEST_SERVICE:require.resolve('../server/services/groupDiplomacy'),RELATION_TEST_ACTOR:f.A,RELATION_TEST_INPUT:JSON.stringify({expectedGroupId:f.a,targetGroupId:f.b,expectedRevision:0,action,requestId:'race_'+action+'_'+n})}});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);child.on('error',reject);child.on('close',status=>status?reject(new Error(errors)):resolve(JSON.parse(output)));});
 const results=await Promise.all([run('propose_alliance'),run('declare_rival')]);assert.equal(results.filter(row=>row.revision===1).length,1);assert.equal(results.filter(row=>row.code==='RELATION_CHANGED').length,1);assert.equal(f.service.detail(f.A,f.b).history.length,1);
});
