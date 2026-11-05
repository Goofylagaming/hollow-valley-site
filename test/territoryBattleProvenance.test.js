const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createBattleProvenance}=require('../server/services/territoryBattleProvenance');
test('battle provenance survives restarts, never upgrades unknown history or erases preview/manual evidence',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    let s=createBattleProvenance(db);
    assert.deepEqual(s.finish(99,200,'capture'),{eligible:false,reason:'unknown-history'});
    s.begin(1,1,100);s.observe(1,{usable:true,simulated:true});
    s=createBattleProvenance(db);
    s.observe(1,{usable:true});
    assert.deepEqual(s.finish(1,200,'capture'),{eligible:false,reason:'simulated'});
    assert.deepEqual(s.finish(1,200,'capture'),{eligible:false,reason:'simulated'});
    assert.throws(()=>s.finish(1,201,'capture'),/conflict/);
    assert.throws(()=>s.begin(1,2,100),/conflict/);
    s.begin(2,1,300);s.observe(2,{usable:true});s.disqualify(2,'manual');
    assert.equal(s.finish(2,400,'capture').eligible,false);
    s.begin(3,1,500);s.observe(3,{usable:false});
    assert.equal(s.finish(3,600,'capture').eligible,false);
    s.begin(4,1,700);s.observe(4,{usable:true});
    assert.deepEqual(s.finish(4,800,'capture'),{eligible:true,reason:'recorded-live'});
    s.begin(5,1,900,{testing:true});s.observe(5,{usable:true});
    assert.equal(s.finish(5,1000,'capture').eligible,false);
    s.begin(6,1,1100);s.observe(6,{usable:true});
    assert.equal(s.finish(6,1200,'capture',{manual:true}).eligible,false);
    db.exec('BEGIN');s.begin(7,1,1300);db.exec('ROLLBACK');
    assert.equal(s.read(7),null,'declaration and provenance share the caller transaction');
  } finally {db.close();}
});
