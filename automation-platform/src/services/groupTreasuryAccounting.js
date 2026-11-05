function balances(db,groupId){
  const balance=db.prepare('SELECT balance FROM economy_group_treasuries WHERE group_id=?').get(groupId)?.balance??0;
  const holdsExist=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='economy_group_treasury_spends'").get();
  const held=holdsExist?db.prepare("SELECT COALESCE(SUM(cost),0) amount FROM economy_group_treasury_spends WHERE group_id=? AND state IN('reserved','fulfilling')").get(groupId).amount:0;
  if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(held)||balance<0||held<0||held>balance)
    throw Object.assign(new Error('Group Treasury balances require review'),{code:'TREASURY_INTEGRITY_ERROR',status:500});
  return {balance,held,available:balance-held};
}
module.exports={balances};
