"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
process.env.DB_PATH=':memory:';process.env.HV_MANAGEMENT_ENABLED='1';process.env.HV_MANAGEMENT_WRITES_ENABLED='0';process.env.HV_MANAGEMENT_AGENT_TOKEN='synthetic-component-health-agent-token-over-thirty-two-characters';
test('authenticated existing heartbeats supply minimal public observations; reads never lease jobs or initialize source schema',async()=>{
 const keys=['STATUS_COMPONENTS_COLLECTION_ENABLED','STATUS_COMPONENTS_PUBLIC_ENABLED'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);
 const {db}=require('../server/db'),app=express();app.use(express.json());app.use('/api/binarylane-management',require('../server/routes/serverManagement').agentRouter);app.use('/api/component-status',require('../server/routes/componentStatus').createRouter({db}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 const get=()=>fetch(base+'/api/component-status'),post=(body,token=process.env.HV_MANAGEMENT_AGENT_TOKEN)=>fetch(base+'/api/binarylane-management/status',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});
 const hasTable=()=>db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='hv_bridge_worker_observation'").get().n;
 try{
  assert.deepEqual(await (await get()).json(),{available:false,components:[]});assert.equal(hasTable(),0);process.env.STATUS_COMPONENTS_PUBLIC_ENABLED='1';assert.equal((await (await get()).json()).components[0].code,'not-configured');assert.equal(hasTable(),0);
  process.env.STATUS_COMPONENTS_COLLECTION_ENABLED='1';const raw={sampledAt:new Date().toISOString(),tasks:{command_bridge:'Running'},logs:{bridge:['PRIVATE 76561198000000001 token=never-public']},server:{pid:7890,processCount:1}};
  assert.equal((await post(raw,'wrong-token')).status,401);assert.equal(hasTable(),0);assert.equal((await post({tasks:raw.tasks})).status,200);assert.equal(hasTable(),0,'a legacy source never gets a receiving-time date');
  db.prepare("INSERT INTO hv_management_jobs(id,action,target,state,owner_steam_id,created_at_ms,expires_at_ms) VALUES('synthetic-untouched-job','enable_start','command_bridge','queued','76561198000000001',?,?)").run(Date.now(),Date.now()+90000);
  assert.equal((await post(raw)).status,200);const before=db.prepare('SELECT total_changes() n').get().n,response=await get(),body=await response.json();assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.components[0].code,'running');assert.equal(body.components[0].executionVerified,false);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|76561198|token|7890|logs|processCount/);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);assert.equal(db.prepare("SELECT state FROM hv_management_jobs WHERE id='synthetic-untouched-job'").get().state,'queued');
  const source=db.prepare('SELECT observed_at FROM hv_bridge_worker_observation').get().observed_at;
  db.exec("CREATE TRIGGER reject_worker_status BEFORE INSERT ON hv_bridge_worker_observation BEGIN SELECT RAISE(ABORT,'PRIVATE source failure');END");
  const warn=console.warn,notices=[];console.warn=(...values)=>notices.push(values.join(' '));try{assert.equal((await post({...raw,sampledAt:new Date(Date.now()+1).toISOString(),tasks:{command_bridge:'Ready'}})).status,200);}finally{console.warn=warn;}
  assert.equal(db.prepare('SELECT observed_at FROM hv_bridge_worker_observation').get().observed_at,source);assert.deepEqual(notices,['[component-status] worker observation could not be saved']);assert.equal((await (await get()).json()).components[0].observedAt,new Date(source).toISOString());db.exec('DROP TRIGGER reject_worker_status');
  process.env.STATUS_COMPONENTS_COLLECTION_ENABLED='0';assert.equal((await (await get()).json()).components[0].code,'not-configured');
 }finally{await new Promise(resolve=>server.close(resolve));db.close();for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
