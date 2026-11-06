'use strict';
const {randomUUID,createHash}=require('node:crypto');
const DAY=86400000,MAX=BigInt(Number.MAX_SAFE_INTEGER);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))fail('A valid request reference is required');return value;};
const price=value=>{if(!Number.isSafeInteger(value)||value<1)fail('Price must be a positive whole number of Valley Coins');return value;};
const fingerprint=p=>createHash('sha256').update(JSON.stringify([p.owner_steam_id,p.species,p.skin])).digest('hex');
function createSkinTradingService(store,{now=Date.now,enabled=()=>process.env.SKIN_TRADING_ENABLED==='1'&&process.env.SKIN_SYSTEM_ENABLED==='true'}={}){
 const db=store.db,inspect=require('./skinTransferEligibility').createSkinTransferEligibility(store);
 db.exec(`CREATE TABLE IF NOT EXISTS economy_skin_listings(
  id TEXT PRIMARY KEY,seller TEXT NOT NULL,preset_id TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),
  request_id TEXT NOT NULL,unlock_key TEXT NOT NULL,fingerprint TEXT NOT NULL,summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'active',
  decided_at INTEGER,UNIQUE(seller,request_id));
  CREATE UNIQUE INDEX IF NOT EXISTS economy_skin_listing_active ON economy_skin_listings(seller,preset_id) WHERE state='active';
  CREATE INDEX IF NOT EXISTS economy_skin_listing_browse ON economy_skin_listings(state,created_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS economy_skin_trades(
  listing_id TEXT PRIMARY KEY,buyer TEXT NOT NULL,seller TEXT NOT NULL,price INTEGER NOT NULL,
  request_id TEXT NOT NULL,unlock_receipt TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(buyer,request_id));`);
 const clock=()=>{const at=now();if(!Number.isSafeInteger(at)||at<0||at>8640000000000000-7*DAY)fail('The trading clock cannot be verified',503);return at;};
 const gate=()=>{if(!enabled())fail('Skin trading is not enabled',503);};
 const actor=user=>store.validateSteamId(user?.steam_id);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const activeGift=(steam,id,at)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='economy_skin_gifts'").get()&&db.prepare("SELECT 1 FROM economy_skin_gifts WHERE sender=? AND preset_id=? AND state='pending' AND expires_at>?").get(steam,id,at));
 const transferable=(steam,id,at)=>{if(activeGift(steam,id,at))fail('This skin has a pending gift; resolve it before trading',409);return inspect(steam,id);};
 const summary=(row,at)=>{const value=JSON.parse(row.summary_json);return {id:row.id,presetId:row.preset_id,name:value.name,species:value.species,price:row.price,createdAt:row.created_at,expiresAt:row.expires_at,state:row.state==='active'&&row.expires_at<=at?'expired':row.state,revision:row.state==='active'&&row.expires_at>at?0:1};};
 function offer(user,input={}){
  gate();const seller=actor(user),requestId=key(input.requestId),cost=price(input.price),presetId=key(input.presetId),at=clock();
  return tx(()=>{
   const old=db.prepare('SELECT * FROM economy_skin_listings WHERE seller=? AND request_id=?').get(seller,requestId);
   if(old){if(old.preset_id!==presetId||old.price!==cost)fail('Conflicting listing request',409);return {listing:summary(old,at),duplicate:true};}
   const {preset,unlock}=transferable(seller,presetId,at);
   db.prepare("UPDATE economy_skin_listings SET state='expired',decided_at=? WHERE seller=? AND preset_id=? AND state='active' AND expires_at<=?").run(at,seller,presetId,at);
   if(db.prepare("SELECT 1 FROM economy_skin_listings WHERE seller=? AND preset_id=? AND state='active'").get(seller,presetId))fail('This skin already has an active listing',409);
   if(db.prepare('SELECT COUNT(*) n FROM economy_skin_listings WHERE seller=? AND created_at>?').get(seller,at-DAY).n>=20)fail('You can create up to twenty listings per day',429);
   const id=randomUUID();db.prepare('INSERT INTO economy_skin_listings(id,seller,preset_id,price,request_id,unlock_key,fingerprint,summary_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,seller,presetId,cost,requestId,unlock.idempotency_key,fingerprint(preset),JSON.stringify({name:preset.name,species:preset.species}),at,at+7*DAY);
   return {listing:summary(db.prepare('SELECT * FROM economy_skin_listings WHERE id=?').get(id),at),duplicate:false};
  });
 }
 function cancel(user,{id,expectedRevision}={}){
  // A paused market must not trap an existing seller's listing.
  const seller=actor(user),at=clock();key(id);if(expectedRevision!==0)fail('Review the original listing revision',409);
  return tx(()=>{const row=db.prepare('SELECT * FROM economy_skin_listings WHERE id=? AND seller=?').get(id,seller);if(!row)fail('Listing not found',404);
   if(row.state==='cancelled')return {listing:summary(row,at),duplicate:true};if(row.state!=='active')fail('This listing is already closed',409);
   db.prepare("UPDATE economy_skin_listings SET state='cancelled',decided_at=? WHERE id=?").run(at,id);
   return {listing:summary({...row,state:'cancelled'},at),duplicate:false};});
 }
 function balance(steam){
  const stmt=db.prepare('SELECT balance,COALESCE((SELECT SUM(amount) FROM economy_wallet_ledger WHERE steam_id=?),0) ledger FROM economy_wallets WHERE steam_id=?');stmt.setReadBigInts(true);let row;
  try{row=stmt.get(steam,steam);}catch{fail('Wallet accounting needs staff review',500);}
  if(!row||typeof row.balance!=='bigint'||row.balance<0n||row.balance>MAX||row.ledger!==row.balance)fail('Wallet accounting needs staff review',500);return row.balance;
 }
 function buy(user,{id,expectedRevision,expectedPrice,requestId}={}){
  gate();const buyer=actor(user),at=clock();key(id);key(requestId);const cost=price(expectedPrice);if(expectedRevision!==0)fail('Review the original listing revision',409);
  return tx(()=>{
   const old=db.prepare('SELECT * FROM economy_skin_trades WHERE buyer=? AND request_id=?').get(buyer,requestId);
   if(old){if(old.listing_id!==id||old.price!==cost)fail('Conflicting purchase request',409);return {id,price:cost,duplicate:true};}
   const row=db.prepare('SELECT * FROM economy_skin_listings WHERE id=?').get(id);
   if(!row||row.state!=='active'||row.expires_at<=at)fail('This listing is no longer available',409);
   if(row.seller===buyer)fail('You cannot buy your own listing',409);if(row.price!==cost)fail('The listed price changed; review it again',409);
   const {preset,unlock}=transferable(row.seller,row.preset_id,at);
   if(unlock.idempotency_key!==row.unlock_key||fingerprint(preset)!==row.fingerprint)fail('The listed skin or its ownership changed',409);
   if(preset.owner_steam_id===buyer||store.hasSkinUnlock(buyer,preset.id)||store.hasSkinGrant(buyer,preset.id))fail('You already have this skin',409);
   store.ensureWallet(buyer);store.ensureWallet(row.seller);
   const buyerBalance=balance(buyer),sellerBalance=balance(row.seller),amount=BigInt(cost);
   if(buyerBalance<amount)fail('Insufficient Valley Coins',409);if(sellerBalance+amount>MAX)fail('Seller wallet capacity needs staff review',409);
   db.prepare('UPDATE economy_wallets SET balance=?,updated_at=datetime(\'now\') WHERE steam_id=?').run(buyerBalance-amount,buyer);
   db.prepare('UPDATE economy_wallets SET balance=?,updated_at=datetime(\'now\') WHERE steam_id=?').run(sellerBalance+amount,row.seller);
   for(const [steam,delta,kind]of[[buyer,-cost,'skin_trade_purchase'],[row.seller,cost,'skin_trade_sale']])db.prepare('INSERT INTO economy_wallet_ledger(id,steam_id,amount,kind,reason,idempotency_key,reference_type,reference_id) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),steam,delta,kind,'Player skin trade','skin-trade:'+id+':'+kind,'skin_trade',id);
   if(db.prepare('UPDATE economy_skin_unlocks SET steam_id=? WHERE steam_id=? AND preset_id=? AND idempotency_key=?').run(buyer,row.seller,preset.id,row.unlock_key).changes!==1)fail('Skin ownership changed',409);
   db.prepare('INSERT INTO economy_skin_trades VALUES(?,?,?,?,?,?,?)').run(id,buyer,row.seller,cost,requestId,JSON.stringify(unlock),at);
   db.prepare("UPDATE economy_skin_listings SET state='sold',decided_at=? WHERE id=?").run(at,id);
   return {id,price:cost,duplicate:false};
  });
 }
 function list(user,{own=false,before=null}={}){
  const steam=actor(user),at=clock();if(typeof own!=='boolean')fail('Invalid listing scope');if(!own)gate();
  if(before!==null&&(!before||!Number.isSafeInteger(before.at)||typeof before.id!=='string'))fail('Invalid listing cursor');
  const where=own?'seller=?':"state='active' AND expires_at>?",args=own?[steam]:[at];
  if(before)args.push(before.at,before.at,key(before.id));
  const rows=db.prepare(`SELECT * FROM economy_skin_listings WHERE ${where}${before?' AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT 51`).all(...args),page=rows.slice(0,50),last=page.at(-1);
  return {listings:page.map(row=>summary(row,at)),next:rows.length>50?{at:last.created_at,id:last.id}:null};
 }
 function receipt(user,{requestId}={}){
  const buyer=actor(user);key(requestId);
  const row=db.prepare('SELECT listing_id,price,created_at FROM economy_skin_trades WHERE buyer=? AND request_id=?').get(buyer,requestId);
  if(!row)fail('Purchase receipt not found',404);
  return {id:row.listing_id,price:row.price,purchasedAt:row.created_at};
 }
 return {offer,cancel,buy,list,receipt};
}
module.exports={createSkinTradingService};
