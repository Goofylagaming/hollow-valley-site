const {randomUUID}=require('node:crypto');
const MAX=Number.MAX_SAFE_INTEGER;
function failure(code,message,status=400){return Object.assign(new Error(message),{code,status});}

// Internal accounting boundary. Website membership/consent must be verified by
// the trusted website caller before authorizing a donation. Runtime endpoints
// require the private website token; new donations default off.
function createGroupTreasury(store,{writesEnabled=()=>process.env.GROUP_TREASURY_ENABLED==='1'}={}) {
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS economy_group_treasuries (
    group_id INTEGER PRIMARY KEY CHECK(group_id>0 AND group_id<=${MAX}),
    balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND balance>=0 AND balance<=${MAX}),
    created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE IF NOT EXISTS economy_group_treasury_donations (
    id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,group_id INTEGER NOT NULL,steam_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=${MAX}),
    wallet_ledger_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE IF NOT EXISTS economy_group_treasury_ledger (
    id TEXT PRIMARY KEY,group_id INTEGER NOT NULL,amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount<>0),
    kind TEXT NOT NULL,donation_id TEXT UNIQUE,created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE INDEX IF NOT EXISTS idx_group_treasury_ledger_group ON economy_group_treasury_ledger(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_treasury_donor ON economy_group_treasury_donations(steam_id);
    CREATE TABLE IF NOT EXISTS economy_group_treasury_requests (
    request_key TEXT PRIMARY KEY,steam_id TEXT NOT NULL,group_id INTEGER NOT NULL,amount INTEGER NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN('donated','cancelled')),created_at TEXT NOT NULL DEFAULT(datetime('now')));`);
  function groupId(value){if(!Number.isSafeInteger(value)||value<1)throw failure('INVALID_GROUP','A valid website group ID is required');return value;}
  function steamId(value){if(typeof value!=='string'||!/^\d{17}$/.test(value))throw failure('INVALID_STEAM','A linked Steam account is required');return value;}
  function requestId(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))throw failure('INVALID_REQUEST','A valid donation request ID is required');return value;}
  function get(id){
    const gid=groupId(id),row=db.prepare('SELECT balance FROM economy_group_treasuries WHERE group_id=?').get(gid);
    return {groupId:gid,balance:row?.balance??0,transactions:db.prepare(`SELECT id,amount,kind,created_at AS createdAt
      FROM economy_group_treasury_ledger WHERE group_id=? ORDER BY rowid DESC LIMIT 50`).all(gid)};
  }
  function verifyReceipt(row){
    const wallet=db.prepare('SELECT * FROM economy_wallet_ledger WHERE id=?').get(row.wallet_ledger_id);
    const group=db.prepare('SELECT * FROM economy_group_treasury_ledger WHERE donation_id=?').get(row.id);
    if(!wallet||wallet.steam_id!==row.steam_id||wallet.amount!==-row.amount||wallet.kind!=='group_treasury_donation'||
      wallet.idempotency_key!==`group-treasury-donation:${row.request_key}`||wallet.reference_type!=='group_treasury_donation'||wallet.reference_id!==row.id||
      !group||group.group_id!==row.group_id||group.amount!==row.amount||group.kind!=='donation')
      throw failure('TREASURY_INTEGRITY_ERROR','Donation ledger requires review',500);
  }
  function project(row){return {id:row.id,requestId:row.request_key,groupId:row.group_id,amount:row.amount,createdAt:row.created_at};}
  function validateDetails({groupId:gid,steamId:steam,amount,requestId:key}={}){
    gid=groupId(gid);steam=steamId(steam);key=requestId(key);
    if(!Number.isSafeInteger(amount)||amount<1)throw failure('INVALID_AMOUNT','Donate a positive whole number of Valley Coins');
    return {gid,steam,amount,key};
  }
  function matching(row,{gid,steam,amount}){
    if(row&&(row.group_id!==gid||row.steam_id!==steam||row.amount!==amount))throw failure('DONATION_CONFLICT','Donation request already has different details',409);
  }
  function receipt({steamId:steam,requestId:key}={}){
    const row=db.prepare('SELECT * FROM economy_group_treasury_donations WHERE request_key=? AND steam_id=?').get(requestId(key),steamId(steam));
    if(!row)return null;verifyReceipt(row);return project(row);
  }
  function outcome({steamId:steam,requestId:key}={}){
    steam=steamId(steam);key=requestId(key);
    const request=db.prepare('SELECT * FROM economy_group_treasury_requests WHERE request_key=? AND steam_id=?').get(key,steam);
    const donation=receipt({steamId:steam,requestId:key});
    if(request?.outcome==='cancelled'){
      if(donation)throw failure('TREASURY_INTEGRITY_ERROR','Donation outcome requires review',500);
      return {state:'cancelled',requestId:key,groupId:request.group_id,amount:request.amount};
    }
    if(donation)return {state:'confirmed',donation};
    if(request)throw failure('TREASURY_INTEGRITY_ERROR','Donation receipt requires review',500);
    return null;
  }
  function cancel(input){
    const details=validateDetails(input),{gid,steam,amount,key}=details;
    // Cancellation does not refund or move coins. The same lock as donate()
    // makes an uncommitted request permanently unable to debit after cancellation.
    db.exec('BEGIN IMMEDIATE');
    try{
      const request=db.prepare('SELECT * FROM economy_group_treasury_requests WHERE request_key=?').get(key);
      matching(request,details);
      const donation=db.prepare('SELECT * FROM economy_group_treasury_donations WHERE request_key=?').get(key);
      matching(donation,details);
      if(donation)verifyReceipt(donation);
      if(!request){
        if(!donation&&db.prepare('SELECT id FROM economy_wallet_ledger WHERE idempotency_key=?').get(`group-treasury-donation:${key}`))
          throw failure('TREASURY_INTEGRITY_ERROR','Donation wallet reference requires review',500);
        db.prepare('INSERT INTO economy_group_treasury_requests(request_key,steam_id,group_id,amount,outcome) VALUES(?,?,?,?,?)')
          .run(key,steam,gid,amount,donation?'donated':'cancelled');
      }
      const result=outcome({steamId:steam,requestId:key});db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function donate({groupId:gid,steamId:steam,amount,requestId:key}={}){
    if(!writesEnabled())throw failure('GROUP_TREASURY_DISABLED','Group Treasury donations are not enabled',503);
    const details=validateDetails({groupId:gid,steamId:steam,amount,requestId:key});
    ({gid,steam,key}=details);
    db.exec('BEGIN IMMEDIATE');
    try{
      const request=db.prepare('SELECT * FROM economy_group_treasury_requests WHERE request_key=?').get(key);
      matching(request,details);
      if(request?.outcome==='cancelled')throw failure('DONATION_CANCELLED','This donation was cancelled',409);
      let donation=db.prepare('SELECT * FROM economy_group_treasury_donations WHERE request_key=?').get(key);
      if(request&&!donation)throw failure('TREASURY_INTEGRITY_ERROR','Donation receipt requires review',500);
      const duplicate=Boolean(donation);
      if(donation){
        if(donation.group_id!==gid||donation.steam_id!==steam||donation.amount!==amount)
          throw failure('DONATION_CONFLICT','Donation request already has different details',409);
        verifyReceipt(donation);
      }else{
        const walletKey=`group-treasury-donation:${key}`;
        if(db.prepare('SELECT id FROM economy_wallet_ledger WHERE idempotency_key=?').get(walletKey))
          throw failure('DONATION_CONFLICT','Donation wallet reference already exists',409);
        const wallet=store.ensureWallet(steam);
        if(!Number.isSafeInteger(wallet.balance)||wallet.balance<0)throw failure('TREASURY_INTEGRITY_ERROR','Player wallet requires review',500);
        if(wallet.balance<amount)throw failure('INSUFFICIENT_FUNDS','Not enough Valley Coins',409);
        db.prepare('INSERT OR IGNORE INTO economy_group_treasuries(group_id) VALUES (?)').run(gid);
        const balance=db.prepare('SELECT balance FROM economy_group_treasuries WHERE group_id=?').get(gid).balance;
        if(balance>MAX-amount)throw failure('TREASURY_LIMIT','Group Treasury balance limit reached',409);
        const id=randomUUID(),walletId=randomUUID();
        db.prepare("UPDATE economy_wallets SET balance=balance-?,updated_at=datetime('now') WHERE steam_id=?").run(amount,steam);
        db.prepare("UPDATE economy_group_treasuries SET balance=balance+?,updated_at=datetime('now') WHERE group_id=?").run(amount,gid);
        db.prepare(`INSERT INTO economy_group_treasury_donations(id,request_key,group_id,steam_id,amount,wallet_ledger_id)
          VALUES(?,?,?,?,?,?)`).run(id,key,gid,steam,amount,walletId);
        db.prepare(`INSERT INTO economy_wallet_ledger(id,steam_id,amount,kind,reason,idempotency_key,reference_type,reference_id,metadata_json)
          VALUES(?,?,?,'group_treasury_donation','Group Treasury donation',?,'group_treasury_donation',?,?)`)
          .run(walletId,steam,-amount,walletKey,id,JSON.stringify({groupId:gid}));
        db.prepare("INSERT INTO economy_group_treasury_ledger(id,group_id,amount,kind,donation_id) VALUES(?,?,?,'donation',?)").run(randomUUID(),gid,amount,id);
        donation=db.prepare('SELECT * FROM economy_group_treasury_donations WHERE id=?').get(id);
      }
      if(!request)db.prepare("INSERT INTO economy_group_treasury_requests(request_key,steam_id,group_id,amount,outcome) VALUES(?,?,?,?,'donated')").run(key,steam,gid,amount);
      const result={duplicate,donation:project(donation),walletBalance:db.prepare('SELECT balance FROM economy_wallets WHERE steam_id=?').get(steam).balance,treasury:get(gid)};
      db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {get,donate,receipt,outcome,cancel};
}
module.exports={createGroupTreasury};
