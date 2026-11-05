function balances(db,groupId){
  const holdsExist=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='economy_group_treasury_spends'").get();
  const failure=()=>Object.assign(new Error('Group Treasury balances and ledger require review'),{code:'TREASURY_INTEGRITY_ERROR',status:500});
  let row;
  try{
    // One statement sees one SQLite read snapshot, including outside a write
    // transaction. Independent commits cannot create a false cache/ledger drift.
    // Keep integer sums as BigInt until all safe-integer bounds are checked.
    const statement=db.prepare(`SELECT
      COALESCE((SELECT balance FROM economy_group_treasuries WHERE group_id=?),0) AS balance,
      COALESCE((SELECT SUM(amount) FROM economy_group_treasury_ledger WHERE group_id=?),0) AS ledger,
      ${holdsExist?"COALESCE((SELECT SUM(cost) FROM economy_group_treasury_spends WHERE group_id=? AND state IN('reserved','fulfilling')),0)":"0"} AS held`);
    statement.setReadBigInts(true);row=statement.get(...(holdsExist?[groupId,groupId,groupId]:[groupId,groupId]));
  }catch{throw failure();}
  const max=BigInt(Number.MAX_SAFE_INTEGER);
  if([row.balance,row.ledger,row.held].some(value=>typeof value!=='bigint'||value<0n||value>max)||row.balance!==row.ledger||row.held>row.balance)throw failure();
  return {balance:Number(row.balance),held:Number(row.held),available:Number(row.balance-row.held)};
}
module.exports={balances};
