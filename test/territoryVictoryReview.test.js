const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-delivery-review-'));
process.env.DB_PATH=path.join(dir,'test.sqlite');
const {db}=require('../server/db');
const router=require('../server/routes/territoryVictoryReview');
const {createVictoryOutbox}=require('../server/services/territoryVictoryOutbox');
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
test('admin review requires same-origin linked identity and preserves immutable payload',async()=>{
  const queue=createVictoryOutbox(db,{send:async()=>{throw Object.assign(new Error('conflict'),{status:409});}});
  queue.enqueue({attackId:1,eventId:2,winners:['76561198000000201']});await queue.flush();
  const original=db.prepare('SELECT payload_json FROM territory_victory_outbox').get().payload_json;
  const app=express();app.use(express.json());app.use((req,res,next)=>{
    if(req.get('x-test-role')) req.user={is_admin:req.get('x-test-role')==='admin',steam_id:'76561198000000202'};
    next();
  });app.use('/review',router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(extra={},body={reason:'Receiver configuration reviewed'})=>fetch(base+'/review/1/retry',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'x-test-role':'admin',...extra},body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base+'/review')).status,401);
    assert.equal((await fetch(base+'/review',{headers:{'x-test-role':'member'}})).status,403);
    const list=await fetch(base+'/review',{headers:{'x-test-role':'admin'}});
    assert.equal(list.headers.get('cache-control'),'no-store');
    const rows=await list.json();assert.equal(rows.deliveries[0].status,'review');
    assert.equal(JSON.stringify(rows).includes('76561198000000201'),false);
    assert.equal((await post({Origin:'https://other.invalid'})).status,403);
    assert.equal((await post({}, {reason:'short'})).status,400);
    assert.equal((await post({}, {reason:'Receiver configuration reviewed',winners:[],actor:'forged'})).status,200);
    assert.equal(db.prepare('SELECT payload_json FROM territory_victory_outbox').get().payload_json,original);
    const audit=db.prepare('SELECT * FROM territory_victory_delivery_reviews').get();
    assert.equal(audit.actor_steam_id,'76561198000000202');assert.equal(audit.previous_status,'review');
    assert.equal(queue.list()[0].status,'pending');
    assert.equal(queue.list()[0].nextAttemptAt,0);
    db.prepare("UPDATE territory_victory_outbox SET status='delivered' WHERE attack_id=1").run();
    assert.equal((await post()).status,409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM territory_victory_delivery_reviews').get().n,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
