import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import { openStore, ingest, createCustomer, entitled, sourceFailure } from '../src/store.mjs';
import { normalize, selectRows, validatePreferences } from '../src/model.mjs';
import { mapLogan, mapBrisbane, mapProcurement, logan, syncAll, request } from '../src/connectors.mjs';
import { saveSubscription, stripeClient, handleWebhook } from '../src/billing.mjs';
import { csvReport, pdfReport, rankForSummary } from '../src/reports.mjs';
import { scheduledDue, weekKey, weekly, deliver } from '../src/jobs.mjs';
import { makeServer } from '../src/server.mjs';
const record=(id='x',title='Roof replacement')=>normalize({id,source:'test',title,kind:'infrastructure_plan',status:'planned',location:'Logan',source_url:'https://example.com',dataset_url:'https://example.com',flags:['not_a_tender'],licence:'CC BY 4.0',attribution:'Test fixture'});
test('incremental upsert, duplicate parcels, source disappearance and failed snapshot rollback',()=>{
 const db=openStore(':memory:');
 assert.equal(ingest(db,'test',[record(),record()],'2026-11-01').count,1);
 assert.equal(selectRows(db)[0].flags.includes('multiple_source_rows'),true);
 const a=record();ingest(db,'test',[a],'2026-11-02');assert.equal(ingest(db,'test',[a],'2026-11-03').updated,0);
 assert.equal(selectRows(db)[0].changed_at,'2026-11-02');
 assert.equal(ingest(db,'test',[record('x','Roof repair')],'2026-11-04').updated,1);
 ingest(db,'test',[record('y')]);assert.equal(selectRows(db).length,1);assert.equal(selectRows(db)[0].id,'y');
 assert.throws(()=>ingest(db,'test',[]));assert.throws(()=>ingest(db,'test',[{id:'bad'}]));assert.equal(selectRows(db)[0].id,'y');db.close();
});
test('trade/location selection, input validation and missing fields flags',()=>{
 const db=openStore(':memory:');ingest(db,'test',[record(),record('y','Plumbing repairs')]);
 assert.equal(selectRows(db,{trades:['roofing'],locations:['Logan']}).length,1);
 assert.equal(selectRows(db,{trades:['roofing'],locations:['Brisbane']}).length,0);
 assert.throws(()=>validatePreferences({trades:['SQL'],locations:[]}));
 assert.ok(selectRows(db)[0].flags.includes('publication_date_unknown'));db.close();
});
test('official mapping does not turn decision dates or procurement methods into tender deadlines',()=>{
 const r=mapLogan({Application_Number:'MCU/1',Application_Description:'Dwelling house',Application_Decision_Due_Date:1});assert.equal(r.closes_at,null);assert.equal(r.kind,'development_application');
 const base={Agency:'Agency','Program Description':'Building construction','Category Group':'Building construction and maintenance','Region SA4':'Logan - Beaudesert','Procurement Method':'Open tender'};
 assert.equal(mapProcurement(base,{url:'https://example.com'}).kind,'procurement_pipeline');
 assert.equal(mapProcurement({...base,'Region SA4':'Cairns'},{url:''}),null);
 assert.equal(mapProcurement({...base,'Region SA4':'Statewide'},{url:''}).location,'Statewide');
 assert.throws(()=>mapBrisbane({},{}));
});
test('pagination and runtime licence gate',async()=>{
 let pages=0;const get=async url=>{if(url.includes('sharing'))return {licenseInfo:'https://creativecommons.org/licenses/by/3.0/au/'};pages++;return {features:[{attributes:{Application_Number:'A'+pages,Application_Description:'House'}}],exceededTransferLimit:pages===1};};
 assert.equal((await logan(get)).length,2);assert.equal(pages,2);
 await assert.rejects(logan(async()=>({licenseInfo:'restricted'})),/licence/);
 await assert.rejects(request('https://localhost/private'),/host/);
});
test('source redirects cannot escape approved hosts',async()=>{
 await assert.rejects(request('https://www.data.qld.gov.au/feed',{fetcher:async()=>new Response('',{status:302,headers:{location:'https://evil.test/data'}})}),/host/);
});
test('source outage preserves records and reports failure',async()=>{
 const db=openStore(':memory:');ingest(db,'test',[record()]);const result=await syncAll(db,{test:async()=>{throw new Error('offline');}});
 assert.ok(result[0].error);assert.equal(selectRows(db).length,1);assert.equal(db.prepare('SELECT status FROM sources').get().status,'failed');db.close();
});
test('weekly shortlist favours classified recent work and CSV retains every match',()=>{
 const rows=Array.from({length:12},(_,i)=>({
   id:String(i).padStart(2,'0'), trades:i===0?[]:['civil'], flags:i===1?['source_stale']:[],
   published_at:`2026-11-${String(i+1).padStart(2,'0')}`,
   closes_at:i===11?'2026-11-12':null
 }));
 const ranked=rankForSummary(rows,new Date('2026-11-14'));
 assert.deepEqual(ranked.map(row=>row.id),['10','09','08','07','06','05','04','03']);
 assert.equal(csvReport(rows).split('\r\n').length,13);
});
test('weekly shortlist represents each eligible feed without dropping CSV records',()=>{
 const logan=Array.from({length:10},(_,i)=>({
   id:`logan:${i}`,source:'logan',trades:['civil'],flags:[],published_at:'2026-11-13'
 }));
 const brisbane={...logan[0],id:'brisbane:1',source:'brisbane',published_at:'2026-10-01'};
 const qld={...brisbane,id:'qld:1',source:'qld'};
 const rows=[...logan,brisbane,qld];
 assert.equal(rankForSummary(rows).length,8);
 assert.deepEqual(new Set(rankForSummary(rows).map(row=>row.source)),new Set(['logan','brisbane','qld']));
 const expired={...qld,flags:['deadline_passed']};
 assert.ok(!rankForSummary([...logan,brisbane,expired]).some(row=>row.source==='qld'));
 assert.equal(csvReport(rows).split('\r\n').length,13);
});
test('CSV injection and valid PDF output including no matches',async()=>{
 const r=record('x','=HYPERLINK("evil")');assert.match(csvReport([r]),/'=HYPERLINK/);
 assert.equal((await pdfReport([])).subarray(0,4).toString(),'%PDF');
 assert.equal((await pdfReport([record()])).subarray(0,4).toString(),'%PDF');
});
function subscription(customer,status='active',end=Math.floor(Date.now()/1000)+3600){return {id:'sub_1',customer,livemode:false,status,cancel_at_period_end:true,items:{data:[{price:{id:'price_test'},current_period_end:end}]}};}
test('cancellation, expiry, wrong price, payment failure and paused collection revoke access',()=>{
 const db=openStore(':memory:'),c=createCustomer(db,'test@example.com');db.prepare('UPDATE customers SET stripe_customer=? WHERE id=?').run('cus_test',c.id);
 saveSubscription(db,subscription('cus_test'),'price_test');assert.equal(entitled(db,c.id),true);
 for(const status of ['canceled','unpaid','past_due','paused','incomplete']){saveSubscription(db,subscription('cus_test',status),'price_test');assert.equal(entitled(db,c.id),false);}
 saveSubscription(db,subscription('cus_test','active',1),'price_test');assert.equal(entitled(db,c.id),false);
 saveSubscription(db,subscription('cus_test'),'price_other');assert.equal(entitled(db,c.id),false);
 saveSubscription(db,{...subscription('cus_test'),pause_collection:{behavior:'void'}},'price_test');assert.equal(entitled(db,c.id),false);
 assert.throws(()=>stripeClient({BI_STRIPE_ENABLED:'true',BI_STRIPE_KEY:'sk_live_rejected'}),/test keys/);db.close();
});
test('signed webhook, replay, tampering, age and live mode rejection; old event re-reads canceled state',async()=>{
 const db=openStore(':memory:'),c=createCustomer(db,'test@example.com');db.prepare('UPDATE customers SET stripe_customer=? WHERE id=?').run('cus_test',c.id);
 const stripe=new Stripe('sk_test_fixture'),secret='whsec_fixture';let calls=0;
 stripe.subscriptions.list=()=>({async *[Symbol.asyncIterator](){calls++;yield subscription('cus_test','canceled');}});
 const event={id:'evt_1',type:'customer.subscription.updated',livemode:false,data:{object:subscription('cus_test')}};
 const raw=JSON.stringify(event),sig=stripe.webhooks.generateTestHeaderString({payload:raw,secret});
 const env={BI_STRIPE_WEBHOOK_SECRET:secret,BI_STRIPE_PRICE_ID:'price_test'};
 await handleWebhook(db,Buffer.from(raw),sig,stripe,env);assert.equal(entitled(db,c.id),false);
 assert.equal((await handleWebhook(db,Buffer.from(raw),sig,stripe,env)).duplicate,true);assert.equal(calls,1);
 await assert.rejects(handleWebhook(db,Buffer.from(raw+' '),sig,stripe,env));
 await assert.rejects(handleWebhook(db,Buffer.from(raw),stripe.webhooks.generateTestHeaderString({payload:raw,secret,timestamp:1}),stripe,env));
 const live=JSON.stringify({...event,id:'live',livemode:true});await assert.rejects(handleWebhook(db,Buffer.from(live),stripe.webhooks.generateTestHeaderString({payload:live,secret}),stripe,env),/Live/);db.close();
});
test('Monday 7am Brisbane schedule and job replay/failure gates',async()=>{
 assert.equal(scheduledDue(new Date('2026-11-15T20:59:59Z')),false);assert.equal(scheduledDue(new Date('2026-11-15T21:00:00Z')),true);
 assert.equal(weekKey(new Date('2026-11-15T21:00:00Z')),'2026-11-16');
 const db=openStore(':memory:');await assert.rejects(weekly(db,{sync:async()=>[{error:'offline'}]}),/withheld/);assert.equal((await weekly(db)).skipped,true);db.close();
});
test('weekly run creates reports and a dry-run delivery once for an entitled customer',async()=>{
 const db=openStore(':memory:'),c=createCustomer(db,'weekly@example.com'),dir=await mkdtemp(join(tmpdir(),'bi-weekly-'));const now=Date.now()/1000;
 db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run('preview',c.id,'trialing',now+3600,1,now);
 const sync=async()=>[ingest(db,'test',[record()])];
 try {const result=await weekly(db,{env:{BI_REPORT_DIR:dir},sync});assert.equal(result.customers,1);assert.equal(db.prepare('SELECT status FROM deliveries').get().status,'dry_run');assert.equal((await weekly(db,{env:{BI_REPORT_DIR:dir},sync})).skipped,true);}
 finally{db.close();await rm(dir,{recursive:true});}
});
test('email defaults to dry run; explicit config and consent required; uncertain sends never retry automatically',async()=>{
 const db=openStore(':memory:'),c={...createCustomer(db,'test@example.com'),email:'test@example.com',consent:1};const dir=await mkdtemp(join(tmpdir(),'bi-'));const files={pdf:join(dir,'a.pdf'),csv:join(dir,'a.csv')};await writeFile(files.pdf,'pdf');await writeFile(files.csv,'csv');let calls=0;const send=async()=>{calls++;throw new Error('timeout');};
 assert.equal(await deliver(db,c,'2026-11-16',files,{},send),'dry_run');assert.equal(calls,0);
 const env={BI_EMAIL_ENABLED:'true',BI_EMAIL_ALLOWLIST:c.email,BI_EMAIL_FROM:'sender@example.com',RESEND_API_KEY:'fixture'};
 await assert.rejects(deliver(db,c,'2026-11-16',files,env,send));assert.equal(await deliver(db,c,'2026-11-16',files,env,send),'uncertain');assert.equal(calls,1);db.close();await rm(dir,{recursive:true});
});
test('HTTP authentication, customer isolation, exports and persistent preferences',async()=>{
 const db=openStore(':memory:'),a=createCustomer(db,'a@example.com'),b=createCustomer(db,'b@example.com');ingest(db,'test',[record()]);
 db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run('preview',a.id,'trialing',Date.now()/1000+3600,1,Date.now()/1000);
 const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{
 assert.equal((await fetch(url+'/api/opportunities')).status,401);
 assert.equal((await fetch(url+'/api/opportunities',{headers:{Authorization:'Bearer '+b.token}})).status,403);
 const headers={Authorization:'Bearer '+a.token,'Content-Type':'application/json'};
 assert.equal((await fetch(url+'/api/preferences',{method:'POST',headers,body:JSON.stringify({trades:['roofing'],locations:['Logan'],email_consent:true})})).status,200);
 assert.equal((await(await fetch(url+'/api/opportunities',{headers})).json()).rows.length,1);
 assert.equal((await fetch(url+'/api/report.csv',{headers})).status,200);
 assert.equal((await fetch(url+'/api/preferences',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:'{}'})).status,403);
 assert.equal((await(await fetch(url+'/api/me',{headers:{Authorization:'Bearer '+b.token}})).json()).preferences.trades.length,0);
 }finally{await new Promise(r=>server.close(r));db.close();}
});

