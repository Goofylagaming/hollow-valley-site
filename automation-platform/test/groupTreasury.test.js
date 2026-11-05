const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createGroupTreasury}=require('../src/services/groupTreasuryService');
const A='76561198000000001',B='76561198000000002';
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-treasury-')),previous=process.env.AUTOMATION_DB_PATH;
  process.env.AUTOMATION_DB_PATH=path.join(temp,'automation.sqlite');
  const modulePath=require.resolve('../src/services/economyStore');delete require.cache[modulePath];
  const store=require(modulePath);let enabled=true;
  const service=createGroupTreasury(store,{writesEnabled:()=>enabled});
  t.after(()=>{store.db.close();delete require.cache[modulePath];if(previous===undefined)delete process.env.AUTOMATION_DB_PATH;else process.env.AUTOMATION_DB_PATH=previous;
    const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
  const fund=(steamId,amount)=>store.applyWalletTransaction({steamId,amount,kind:'fixture',reason:'Synthetic fixture credit',idempotencyKey:'fixture:'+steamId});
  const donate=(amount=100,requestId='donation_0001',groupId=1,steamId=A)=>service.donate({amount,requestId,groupId,steamId});
  return {store,db:store.db,service,fund,donate,disable:()=>{enabled=false;}};
}
function code(fn,value){assert.throws(fn,error=>error.code===value);}
function child(dbPath,input,action='donate'){
  const source=`const store=require(${JSON.stringify(require.resolve('../src/services/economyStore'))});
    const s=require(${JSON.stringify(require.resolve('../src/services/groupTreasuryService'))}).createGroupTreasury(store);
    try{process.stdout.write(JSON.stringify(s[${JSON.stringify(action)}](${JSON.stringify(input)})));}
    catch(e){process.stdout.write(JSON.stringify({code:e.code,message:e.message}));}
    finally{store.db.close();}`;
  return new Promise((resolve,reject)=>{
    const processHandle=spawn(process.execPath,['-e',source],{env:{...process.env,AUTOMATION_DB_PATH:dbPath,GROUP_TREASURY_ENABLED:'1'},windowsHide:true});
    let stdout='',stderr='';processHandle.stdout.on('data',data=>{stdout+=data;});processHandle.stderr.on('data',data=>{stderr+=data;});
    processHandle.on('error',reject);processHandle.on('close',status=>{if(status!==0)return reject(new Error(stderr));try{resolve(JSON.parse(stdout));}catch(error){reject(error);}});
  });
}
test('donations conserve authoritative player and group coins with both ledger legs',t=>{
  const {store,db,service,fund,donate}=fixture(t);fund(A,1000);fund(B,500);
  const first=donate();donate(50,'donation_0002',1,B);donate(25,'donation_0003',2);
  assert.equal(first.duplicate,false);assert.equal(first.walletBalance,900);
  assert.equal(service.get(1).balance,150);assert.equal(service.get(2).balance,25);
  assert.equal(store.getWallet(A).balance+store.getWallet(B).balance+service.get(1).balance+service.get(2).balance,1500);
  const receipt=db.prepare('SELECT * FROM economy_group_treasury_donations WHERE id=?').get(first.donation.id);
  assert.equal(db.prepare('SELECT amount FROM economy_wallet_ledger WHERE id=?').get(receipt.wallet_ledger_id).amount,-100);
  assert.equal(db.prepare('SELECT amount FROM economy_group_treasury_ledger WHERE donation_id=?').get(receipt.id).amount,100);
  assert.equal(store.getWallet(A).transactions.filter(row=>row.kind==='group_treasury_donation').length,2);
});
test('identical retries survive a new process; changed request details cannot move coins again',async t=>{
  const {store,service,fund,donate}=fixture(t);fund(A,1000);const first=donate();
  const retry=await child(store.dbPath,{groupId:1,steamId:A,amount:100,requestId:'donation_0001'});
  assert.equal(retry.duplicate,true);assert.equal(retry.donation.id,first.donation.id);assert.equal(retry.walletBalance,900);
  code(()=>donate(101),'DONATION_CONFLICT');code(()=>donate(100,'donation_0001',2),'DONATION_CONFLICT');code(()=>donate(100,'donation_0001',1,B),'DONATION_CONFLICT');
  assert.equal(store.getWallet(A).balance,900);assert.equal(service.get(1).balance,100);
});
test('concurrent independent processes cannot overdraw a player wallet',async t=>{
  const {store,service,fund}=fixture(t);fund(A,150);
  const results=await Promise.all(['parallel_0001','parallel_0002'].map(requestId=>child(store.dbPath,{groupId:1,steamId:A,amount:100,requestId})));
  assert.equal(results.filter(result=>result.code==='INSUFFICIENT_FUNDS').length,1);
  assert.equal(results.filter(result=>result.duplicate===false).length,1);
  assert.equal(store.getWallet(A).balance,50);assert.equal(service.get(1).balance,100);
});
test('failed group ledger writes roll back both balances, receipts and wallet debits',t=>{
  const {db,store,service,fund,donate}=fixture(t);fund(A,200);
  db.exec("CREATE TRIGGER fail_group_ledger BEFORE INSERT ON economy_group_treasury_ledger BEGIN SELECT RAISE(ABORT,'fixture ledger failure'); END");
  assert.throws(()=>donate(),/fixture ledger failure/);
  assert.equal(store.getWallet(A).balance,200);assert.equal(service.get(1).balance,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_donations').get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM economy_wallet_ledger WHERE kind='group_treasury_donation'").get().n,0);
  db.exec('DROP TRIGGER fail_group_ledger');assert.equal(donate().duplicate,false);
});
test('insufficient funds and invalid amounts never create a funded treasury',t=>{
  const {db,service,donate}=fixture(t);
  code(()=>donate(),'INSUFFICIENT_FUNDS');
  for(const amount of [0,-1,1.5,'10',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])code(()=>donate(amount),'INVALID_AMOUNT');
  code(()=>donate(1,'bad'),'INVALID_REQUEST');code(()=>donate(1,'donation_0001',0),'INVALID_GROUP');code(()=>donate(1,'donation_0001',1,'bad'),'INVALID_STEAM');
  assert.equal(service.get(1).balance,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_wallets').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_group_treasuries').get().n,0);
});
test('group balance overflow and wallet-reference collisions fail without partial movement',t=>{
  const {store,service,fund,donate}=fixture(t);fund(A,Number.MAX_SAFE_INTEGER);donate(Number.MAX_SAFE_INTEGER);fund(B,1);
  code(()=>donate(1,'overflow_0001',1,B),'TREASURY_LIMIT');assert.equal(store.getWallet(B).balance,1);
  store.applyWalletTransaction({steamId:A,amount:1,kind:'fixture',reason:'Namespace collision fixture',idempotencyKey:'group-treasury-donation:collision_0001'});
  code(()=>donate(1,'collision_0001'),'DONATION_CONFLICT');
  assert.equal(service.get(1).balance,Number.MAX_SAFE_INTEGER);assert.equal(store.getWallet(A).balance,1);
});
test('duplicate receipts require both original ledger legs; missing evidence never causes a replacement debit',t=>{
  const {db,store,service,fund,donate}=fixture(t);fund(A,1000);const first=donate();
  db.prepare('DELETE FROM economy_group_treasury_ledger WHERE donation_id=?').run(first.donation.id);
  code(()=>donate(),'TREASURY_INTEGRITY_ERROR');code(()=>service.receipt({steamId:A,requestId:'donation_0001'}),'TREASURY_INTEGRITY_ERROR');
  assert.equal(store.getWallet(A).balance,900);code(()=>service.get(1),'TREASURY_INTEGRITY_ERROR');assert.equal(db.prepare('SELECT balance FROM economy_group_treasuries WHERE group_id=1').get().balance,100);
});
test('cached balance drift cannot admit new donations, purchases or zero-fund closure',t=>{
  const {db,store,service,fund,donate}=fixture(t);fund(A,1000);donate();
  const spending=require('../src/services/groupTreasurySpending').createGroupTreasurySpending(store,{enabled:()=>true});
  const item={id:'audit-frame',revision:1,title:'Synthetic frame',description:'Test price',cost:50,purpose:'group_cosmetic',target:{kind:'profile_frame',value:'fern'}};
  spending.register(item,A);spending.setEnabled(item.id,1,true,A);
  const closure=require('../src/services/groupTreasuryClosure').createGroupTreasuryClosure(store);
  for(const balance of [0,300]){
    db.prepare('UPDATE economy_group_treasuries SET balance=? WHERE group_id=1').run(balance);
    code(()=>service.get(1),'TREASURY_INTEGRITY_ERROR');code(()=>donate(1,'drift_donation_'+balance),'TREASURY_INTEGRITY_ERROR');
    code(()=>spending.reserve({groupId:1,actorSteamId:A,itemId:item.id,revision:1,expectedCost:50,requestId:'drift_spend_'+balance}),'TREASURY_INTEGRITY_ERROR');
    code(()=>closure.begin({groupId:1,actorSteamId:A,requestId:'drift_closure_'+balance,action:'disband'}),'TREASURY_INTEGRITY_ERROR');
    assert.equal(store.getWallet(A).balance,900);assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_closures').get().n,0);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger').get().n,1);
  db.prepare('UPDATE economy_group_treasuries SET balance=100 WHERE group_id=1').run();assert.equal(service.get(1).balance,100);
});
test('orphan group ledger credit is not treated as an empty Treasury or repaired by donation',t=>{
  const {db,store,service,fund,donate}=fixture(t);fund(A,1000);
  db.prepare("INSERT INTO economy_group_treasury_ledger(id,group_id,amount,kind) VALUES('orphan-credit',9,50,'donation')").run();
  code(()=>service.get(9),'TREASURY_INTEGRITY_ERROR');code(()=>donate(1,'orphan_donation',9),'TREASURY_INTEGRITY_ERROR');
  assert.equal(db.prepare('SELECT balance FROM economy_group_treasuries WHERE group_id=9').get(),undefined);assert.equal(store.getWallet(A).balance,1000);
});
test('corrupted ledger aggregate overflow returns an integrity error without lossy numeric conversion',t=>{
  const {db,service}=fixture(t);const insert=db.prepare("INSERT INTO economy_group_treasury_ledger(id,group_id,amount,kind) VALUES(?,8,?,'donation')");
  db.exec('BEGIN IMMEDIATE');for(let index=0;index<1025;index++)insert.run('overflow-'+index,Number.MAX_SAFE_INTEGER);db.exec('COMMIT');
  code(()=>service.get(8),'TREASURY_INTEGRITY_ERROR');assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_group_treasuries').get().n,0);
});
test('group history is bounded and contains no donor identity or retry key',t=>{
  const {service,fund,donate}=fixture(t);fund(A,1000);
  let last;
  for(let i=0;i<55;i++)last=donate(1,'history_'+String(i).padStart(4,'0'));
  const history=service.get(1);assert.equal(history.transactions.length,50);assert.equal(history.balance,55);
  assert.equal(history.transactions[0].amount,1);
  assert.equal(JSON.stringify(history).includes(A),false);assert.equal(JSON.stringify(history).includes('history_'),false);
  assert.equal(service.receipt({steamId:B,requestId:'history_0054'}),null);
  assert.equal(service.receipt({steamId:A,requestId:'history_0054'}).id,last.donation.id);
});
test('disabled donations make no coin changes and the default service remains off',t=>{
  const {store,service,fund,donate,disable}=fixture(t);fund(A,1000);disable();
  code(()=>donate(),'GROUP_TREASURY_DISABLED');assert.equal(store.getWallet(A).balance,1000);assert.equal(service.get(1).balance,0);
  const previous=process.env.GROUP_TREASURY_ENABLED;delete process.env.GROUP_TREASURY_ENABLED;
  try{code(()=>createGroupTreasury(store).donate({groupId:1,steamId:A,amount:1,requestId:'default_0001'}),'GROUP_TREASURY_DISABLED');}
  finally{if(previous===undefined)delete process.env.GROUP_TREASURY_ENABLED;else process.env.GROUP_TREASURY_ENABLED=previous;}
});
test('cancellation persists across processes and prevents a late donation even after writes resume',async t=>{
  const {store,service,fund,disable}=fixture(t);fund(A,1000);disable();
  const input={groupId:1,steamId:A,amount:100,requestId:'cancelled_0001'};
  const first=service.cancel(input);assert.equal(first.state,'cancelled');assert.deepEqual(service.cancel(input),first);
  assert.equal((await child(store.dbPath,input)).code,'DONATION_CANCELLED');
  assert.deepEqual(service.outcome({steamId:A,requestId:input.requestId}),first);
  assert.equal(service.outcome({steamId:B,requestId:input.requestId}),null);
  code(()=>service.cancel({...input,groupId:2}),'DONATION_CONFLICT');
  assert.equal(store.getWallet(A).balance,1000);assert.equal(service.get(1).balance,0);
});
test('cancellation after commitment returns the immutable receipt and never refunds',t=>{
  const {store,service,fund,donate}=fixture(t);fund(A,1000);const original=donate();
  const result=service.cancel({groupId:1,steamId:A,amount:100,requestId:'donation_0001'});
  assert.equal(result.state,'confirmed');assert.equal(result.donation.id,original.donation.id);
  assert.equal(store.getWallet(A).balance,900);assert.equal(service.get(1).balance,100);
});
test('competing donation and cancellation processes settle to one durable accounting outcome',async t=>{
  const {store,service,fund}=fixture(t);fund(A,1000);
  const input={groupId:1,steamId:A,amount:100,requestId:'competing_0001'};
  const [donation,cancelled]=await Promise.all([child(store.dbPath,input),child(store.dbPath,input,'cancel')]);
  const outcome=service.outcome({steamId:A,requestId:input.requestId});assert.equal(cancelled.state,outcome.state);
  if(outcome.state==='cancelled'){assert.equal(donation.code,'DONATION_CANCELLED');assert.equal(service.get(1).balance,0);assert.equal(store.getWallet(A).balance,1000);}
  else{assert.equal(donation.donation.id,outcome.donation.id);assert.equal(service.get(1).balance,100);assert.equal(store.getWallet(A).balance,900);}
});
test('failed cancellation audit cannot report a cancellation that was not stored',t=>{
  const {db,service,fund,donate}=fixture(t);fund(A,1000);
  db.exec("CREATE TRIGGER fail_cancellation BEFORE INSERT ON economy_group_treasury_requests WHEN NEW.outcome='cancelled' BEGIN SELECT RAISE(ABORT,'fixture cancellation failure'); END");
  assert.throws(()=>service.cancel({groupId:1,steamId:A,amount:100,requestId:'donation_0001'}),/fixture cancellation failure/);
  assert.equal(service.outcome({steamId:A,requestId:'donation_0001'}),null);
  db.exec('DROP TRIGGER fail_cancellation');assert.equal(donate().duplicate,false);
});
