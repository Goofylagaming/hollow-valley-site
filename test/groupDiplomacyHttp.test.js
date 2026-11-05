const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-diplomacy-http-'));process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.GROUP_TREASURY_ENABLED='0';process.env.GROUP_DIPLOMACY_ENABLED='1';
for(const name of ['GROUP_DIPLOMACY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[name];
const {db}=require('../server/db'),groups=require('../server/groupsStore');
const A='76561198000022001',B='76561198000022002',M='76561198000022003';
for(const actor of [A,B,M])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic diplomacy account');
const a=groups.createGroup(A,'HTTP Alliance A').current.id,b=groups.createGroup(B,'HTTP Alliance B').current.id;groups.invite(A,M);groups.actOnInvite(M,groups.getState(M).incoming[0].id,'accept');
let server,base,drop=false;
test.before(async()=>{const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};if(drop&&req.method==='POST'){drop=false;res.json=()=>{res.destroy();return res;};}next();});app.use('/api/group-diplomacy',require('../server/routes/groupDiplomacy'));
 server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
async function request(actor,url='',body,origin=base){const response=await fetch(base+'/api/group-diplomacy'+url,{method:body?'POST':'GET',headers:{'x-user':actor||'',Origin:origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};}
test('private diplomacy API requires linked Steam and current membership; capability flag defaults can disable reads',async()=>{
 assert.equal((await request(null)).status,401);assert.equal((await request('not-steam')).status,403);assert.equal((await request('76561198000022999')).status,404);
 const response=await request(M);assert.equal(response.status,200);assert.equal(response.cache,'private, no-store');assert.equal(response.body.canManage,false);assert.equal(response.body.group.id,a);
 process.env.GROUP_DIPLOMACY_ENABLED='0';try{assert.equal((await request(A)).status,503);assert.equal((await request(null,'/capabilities')).body.enabled,false);}finally{process.env.GROUP_DIPLOMACY_ENABLED='1';}
});
test('origin/read-only checks reject mutation while private reads remain available',async()=>{
 const body={expectedGroupId:a,expectedRevision:0,action:'propose_alliance',requestId:'http_proposal_01'};
 assert.equal((await request(A,'/relations/'+b,body,'https://other.invalid')).status,403);
 process.env.GROUP_DIPLOMACY_READ_ONLY='1';try{assert.equal((await request(A,'/relations/'+b,body)).status,403);assert.equal((await request(A,'/relations/'+b)).status,200);}finally{process.env.GROUP_DIPLOMACY_READ_ONLY='0';}
 assert.equal((await request(M,'/relations/'+b,body)).status,403);assert.equal((await request(A,'/relations/'+b)).body.revision,0);
});
test('lost confirmation reply reuses the immutable operation, and the other owner can accept only its current group',async()=>{
 const body={expectedGroupId:a,expectedRevision:0,action:'propose_alliance',requestId:'http_proposal_02',actorSteamId:B,targetGroupId:999};drop=true;await assert.rejects(()=>request(A,'/relations/'+b,body));
 const retry=await request(A,'/relations/'+b,body);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.revision,1);assert.equal(retry.body.proposalFrom,a);
 assert.equal((await request(B,'/relations/'+a,{expectedGroupId:a,expectedRevision:1,action:'accept_alliance',requestId:'wrong_target_01'})).status,409);
 const accepted=await request(B,'/relations/'+a,{expectedGroupId:b,expectedRevision:1,action:'accept_alliance',requestId:'http_accept_01'});assert.equal(accepted.body.effectiveAlliance,true);assert.equal(JSON.stringify(accepted.body).includes(A),false);
});
test('head-to-head availability is explicit and search excludes the caller group without publishing owner identity',async()=>{
 const history=await request(M,'/relations/'+b);assert.equal(history.body.headToHead.available,false);assert.equal(history.body.headToHead.totals,null);
 const search=await request(A,'/groups?q=HTTP');assert.deepEqual(search.body.groups.map(group=>group.id),[b]);assert.equal(JSON.stringify(search.body).includes(B),false);assert.equal((await request(A,'/groups?q=x')).status,400);
});
