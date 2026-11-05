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
function child(dbPath,input){
  const source=`const store=require(${JSON.stringify(require.resolve('../src/services/economyStore'))});
    const s=require(${JSON.stringify(require.resolve('../src/services/groupTreasuryService'))}).createGroupTreasury(store);
    try{process.stdout.write(JSON.stringify(s.donate(${JSON.stringify(input)})));}
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
  const {db,store,service,fund,donate}=fixture(t);fund(A,1000);donate();
  db.prepare('UPDATE economy_group_treasuries SET balance=? WHERE group_id=1').run(Number.MAX_SAFE_INTEGER);
  code(()=>donate(1,'overflow_0001'),'TREASURY_LIMIT');assert.equal(store.getWallet(A).balance,900);
  store.applyWalletTransaction({steamId:A,amount:1,kind:'fixture',reason:'Namespace collision fixture',idempotencyKey:'group-treasury-donation:collision_0001'});
  code(()=>donate(1,'collision_0001'),'DONATION_CONFLICT');
  assert.equal(service.get(1).balance,Number.MAX_SAFE_INTEGER);assert.equal(store.getWallet(A).balance,901);
});
test('duplicate receipts require both original ledger legs; missing evidence never causes a replacement debit',t=>{
  const {db,store,service,fund,donate}=fixture(t);fund(A,1000);const first=donate();
  db.prepare('DELETE FROM economy_group_treasury_ledger WHERE donation_id=?').run(first.donation.id);
  code(()=>donate(),'TREASURY_INTEGRITY_ERROR');code(()=>service.receipt({steamId:A,requestId:'donation_0001'}),'TREASURY_INTEGRITY_ERROR');
  assert.equal(store.getWallet(A).balance,900);assert.equal(service.get(1).balance,100);
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
