const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createJourneyStore}=require('../src/services/journeyStore');
const steam='76561198000000801',other='76561198000000802';
test('journey combat matches only connected retained samples and omits other players and gaps',()=>{
  const previous=process.env.JOURNEY_HISTORY_ENABLED;process.env.JOURNEY_HISTORY_ENABLED='1';
  const db=new DatabaseSync(':memory:');let clock=5000000;
  try {
    const legacy=require('../src/services/valleyLegacyStore').createLegacyStore(db,{now:()=>clock});
    legacy.journeys.change(steam,{enabled:true,expectedRevision:0});
    const snapshot=location=>legacy.snapshot([{steamId:steam,species:'Rex',growth:0.5,location}],clock);
    clock+=15000;snapshot({x:0,y:0});const first=clock;
    clock+=15000;snapshot({x:100,y:0});
    for(let i=1;i<=22;i++)legacy.ingest({id:'matched-'+i,type:'combat_kill',steamId:steam,at:first+i});
    legacy.ingest({id:'other-player',type:'combat_kill',steamId:other,at:first+1});
    clock+=15000;snapshot(null);const missing=clock;
    clock+=15000;snapshot({x:200,y:0});legacy.ingest({id:'gap-kill',type:'combat_kill',steamId:steam,at:missing+1});
    const life=legacy.journeys.points(steam).lives[0];
    assert.equal(life.combatEvents.length,20);assert.equal(life.combatEventsLimited,true);
    assert.ok(life.combatEvents.every(e=>e.at>first&&e.at<=first+22&&e.type==='combat_kill'));
    assert.equal(JSON.stringify(life).includes(other),false);
    legacy.journeys.change(steam,{enabled:false,expectedRevision:1,erase:true});
    assert.deepEqual(legacy.journeys.points(steam).lives,[]);
  }finally{db.close();if(previous===undefined)delete process.env.JOURNEY_HISTORY_ENABLED;else process.env.JOURNEY_HISTORY_ENABLED=previous;}
});
test('missing positions persist a trail break and late samples cannot fill the gap',()=>{
  const db=new DatabaseSync(':memory:');let clock=4000000;
  try {
    let store=createJourneyStore(db,{now:()=>clock,enabled:()=>true});
    store.change(steam,{enabled:true,expectedRevision:0});
    const sample=(at,location)=>store.record({steamId:steam,lifeId:'same-life',at,location});
    clock+=15000;sample(clock,{x:0,y:0});const first=clock;
    clock+=1000;assert.equal(sample(clock,null),false);const missing=clock;
    store=createJourneyStore(db,{now:()=>clock,enabled:()=>true});
    assert.equal(sample(missing-1,{x:10,y:10}),false);
    clock+=15000;assert.equal(sample(clock,{x:20,y:20}),true);
    assert.equal(store.points(steam).points[0].breakBefore,1);
    assert.equal(sample(first,null),false);
    clock+=15000;sample(clock,{x:30,y:30});assert.equal(store.points(steam).points[0].breakBefore,0);
    clock+=15000;sample(clock,null);store.change(steam,{enabled:false,expectedRevision:1,erase:true});
    assert.equal(db.prepare('SELECT COUNT(*) n FROM journey_gaps').get().n,0);
  }finally{db.close();}
});
function fixture(){const db=new DatabaseSync(':memory:');let clock=1000000;const store=createJourneyStore(db,{now:()=>clock,enabled:()=>true});return {db,store,tick:n=>clock+=n,now:()=>clock};}
test('journey consent, deletion and new opt-in reject delayed observations',()=>{
  const f=fixture(),s=f.store,record=at=>s.record({steamId:steam,lifeId:'life',at,location:{x:1,y:2}});
  try{
    assert.equal(record(f.now()),false);assert.deepEqual(s.settings(steam),{enabled:false,revision:0});
    s.change(steam,{enabled:true,expectedRevision:0});assert.equal(record(f.now()),false);
    f.tick(15000);assert.equal(record(f.now()),true);
    assert.throws(()=>s.change(steam,{enabled:false,expectedRevision:0}),{status:409});
    s.change(steam,{enabled:false,expectedRevision:1,erase:true});assert.equal(s.points(steam).points.length,0);
    f.tick(15000);const late=f.now();assert.equal(record(late),false);
    f.tick(15000);s.change(steam,{enabled:true,expectedRevision:2});assert.equal(record(late),false);
    f.tick(15000);assert.equal(record(f.now()),true);assert.equal(s.points(steam).points[0].breakBefore,1);
    assert.equal(s.points(other).points.length,0);
  }finally{f.db.close();}
});
test('journey samples reject invalid times and split gaps, jumps and different lives',()=>{
  const f=fixture(),s=f.store;
  try{
    s.change(steam,{enabled:true,expectedRevision:0});
    const add=(x,lifeId='a')=>s.record({steamId:steam,lifeId,at:f.now(),location:{x,y:0}});
    f.tick(15000);assert.equal(add(0),true);assert.equal(add(0),false);
    assert.equal(s.record({steamId:steam,lifeId:'a',at:f.now()+1,location:{x:0,y:0}}),false);
    f.tick(15000);add(100);f.tick(15000);add(1e6);f.tick(121000);add(1e6);f.tick(15000);add(1e6,'b');
    assert.deepEqual(s.points(steam).points.map(p=>p.breakBefore),[1,1,1,0,1]);
    f.tick(31*86400000);assert.equal(s.points(steam).points.length,0);s.prune();
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM journey_points').get().n,0);
  }finally{f.db.close();}
});
test('accepted Legacy snapshots collect only opted-in private history behind the rollout gate',()=>{
  const previous=process.env.JOURNEY_HISTORY_ENABLED;process.env.JOURNEY_HISTORY_ENABLED='1';
  const db=new DatabaseSync(':memory:');let clock=2000000;
  try {
    const legacy=require('../src/services/valleyLegacyStore').createLegacyStore(db,{now:()=>clock});
    legacy.journeys.change(steam,{enabled:true,expectedRevision:0});clock+=15000;
    const players=[steam,other].map(steamId=>({steamId,species:'Triceratops',growth:0.5,location:{x:10,y:20}}));
    legacy.snapshot(players,clock);assert.equal(legacy.journeys.points(steam).points.length,1);
    const summary=legacy.journeys.points(steam).lives;
    assert.equal(summary.length,1);assert.equal(summary[0].species,'triceratops');assert.equal(summary[0].closureReason,null);
    assert.equal(JSON.stringify(summary).includes(steam),false);assert.equal(JSON.stringify(summary).includes('location'),false);
    assert.equal(legacy.journeys.points(other).points.length,0);
    assert.deepEqual(legacy.journeys.points(other).lives,[]);
    legacy.snapshot(players,clock);assert.equal(legacy.journeys.points(steam).points.length,1);
    process.env.JOURNEY_HISTORY_ENABLED='0';clock+=15000;legacy.snapshot(players,clock);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM journey_points').get().n,1);
    process.env.JOURNEY_HISTORY_ENABLED='1';clock+=1000;
    legacy.ingest({id:'journey-death',type:'combat_death',steamId:steam,at:clock});
    assert.equal(legacy.journeys.points(steam).lives[0].closureReason,'combat_death');
    legacy.journeys.change(steam,{enabled:false,expectedRevision:1,erase:true});
    assert.deepEqual(legacy.journeys.points(steam).lives,[]);
  } finally {db.close();if(previous===undefined)delete process.env.JOURNEY_HISTORY_ENABLED;else process.env.JOURNEY_HISTORY_ENABLED=previous;}
});

test('Legacy rejects coercible non-coordinate values instead of recording a false origin',()=>{
  const previous=process.env.JOURNEY_HISTORY_ENABLED;process.env.JOURNEY_HISTORY_ENABLED='1';
  const db=new DatabaseSync(':memory:');let clock=3000000;
  try {
    const legacy=require('../src/services/valleyLegacyStore').createLegacyStore(db,{now:()=>clock});
    legacy.journeys.change(steam,{enabled:true,expectedRevision:0});
    for(const x of ['', '  ',null,false,true,[],{},Infinity]) {
      clock+=15000;legacy.snapshot([{steamId:steam,species:'Triceratops',growth:0.5,location:{x,y:0}}],clock);
    }
    assert.equal(legacy.journeys.points(steam).points.length,0);
    clock+=15000;legacy.snapshot([{steamId:steam,species:'Triceratops',growth:0.5,location:{x:'0',y:'10'}}],clock);
    assert.equal(legacy.journeys.points(steam).points[0].x,0);
  }finally{db.close();if(previous===undefined)delete process.env.JOURNEY_HISTORY_ENABLED;else process.env.JOURNEY_HISTORY_ENABLED=previous;}
});

test('history pages have no duplicates and storage cap preserves the newest points and other accounts',()=>{
  const f=fixture(),s=f.store;
  try {
    s.change(steam,{enabled:true,expectedRevision:0});
    const insert=f.db.prepare('INSERT INTO journey_points VALUES (?,?,?,?,?,?)');
    f.db.exec('BEGIN');
    for(let i=1;i<=10000;i++)insert.run(steam,'life',f.now()+i,0,0,i===1?1:0);
    insert.run(other,'other-life',f.now()+1,1,1,1);f.db.exec('COMMIT');
    f.tick(30000);s.record({steamId:steam,lifeId:'life',at:f.now(),location:{x:0,y:0}});
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM journey_points WHERE steam_id=?').get(steam).n,10000);
    const seen=[];let before;
    do{const page=s.points(steam,before?{before}:{});assert.ok(page.points.length<=500);seen.push(...page.points.map(p=>p.at));before=page.nextBefore;}while(before);
    assert.equal(seen.length,10000);assert.equal(new Set(seen).size,10000);assert.equal(seen[0],f.now());
    assert.equal(s.points(other).points.length,1);
    assert.throws(()=>s.points(steam,{before:'1'}),{status:400});
  }finally{f.db.close();}
});
