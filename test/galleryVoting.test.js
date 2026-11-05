const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createGalleryStore}=require('../server/services/galleryStore');
const owner={steam_id:'76561198000000801'},voter={steam_id:'76561198000000802'};
test('vote changes are rate limited while exact retries remain safe',()=>{
  const db=new DatabaseSync(':memory:');let now=Date.parse('2026-11-05T00:00:00Z');
  try{
    const gallery=createGalleryStore(db,{now:()=>now});
    const input=i=>({month:'2026-11',imageId:null,expectedRevision:i,requestId:`limit-request-${i}`});
    for(let i=0;i<10;i++)gallery.vote(voter,input(i));
    assert.equal(gallery.vote(voter,input(0)).duplicate,true);
    assert.throws(()=>gallery.vote(voter,input(10)),{status:429});
    now+=3600001;gallery.vote(voter,input(10));
    assert.equal(gallery.voting(voter).revision,11);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'wallet%' OR name LIKE 'progression%'").get().n,0);
  }finally{db.close();}
});
test('monthly choices use Brisbane boundaries, reject invalid entries and preserve one vote through retries and changes',()=>{
  const db=new DatabaseSync(':memory:');let now=Date.parse('2026-10-31T14:00:01Z');
  try{
    const gallery=createGalleryStore(db,{now:()=>now}),month=gallery.voting(voter);
    assert.equal(month.month,'2026-11');assert.equal(month.startsAt,Date.parse('2026-10-31T14:00:00Z'));assert.equal(month.endsAt,Date.parse('2026-11-30T14:00:00Z'));
    const insert=db.prepare('INSERT INTO gallery_images(id,owner_steam_id,author,title,width,height,content_hash,request_id,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for(const [id,who,at,status] of [['one',owner,now,'approved'],['two',owner,now,'approved'],['self',voter,now,'approved'],['old',owner,month.startsAt-1,'approved'],['pending',owner,now,'pending']])insert.run(id,who.steam_id,'Fixture',id,1,1,'hash',id,at,status);
    const vote=(imageId,expectedRevision,requestId)=>gallery.vote(voter,{month:'2026-11',imageId,expectedRevision,requestId});
    for(const id of ['self','old','pending','missing'])assert.throws(()=>vote(id,0,`invalid-${id}`),{status:400});
    assert.throws(()=>gallery.vote(null,{month:'2026-11'}),{status:403});
    assert.throws(()=>gallery.vote(voter,{month:'2026-10'}),{status:409});
    vote('one',0,'request-one');assert.equal(vote('one',0,'request-one').duplicate,true);
    assert.equal(gallery.list().images.find(r=>r.id==='one').votes,1);
    vote('two',1,'request-two');assert.equal(vote('one',0,'request-one').voting.myVoteId,'two','replaying an old accepted request must not reverse a later choice');
    assert.throws(()=>vote('one',1,'request-stale'),{status:409});
    assert.throws(()=>vote('two',0,'request-one'),{status:409});
    assert.equal(gallery.list().images.find(r=>r.id==='one').votes,0);assert.equal(gallery.list().images.find(r=>r.id==='two').votes,1);
    vote(null,2,'request-clear');assert.equal(gallery.voting(voter).myVoteId,null);
    vote('one',3,'request-back');gallery.withdraw(owner,'one');
    assert.equal(gallery.voting(voter).myVoteId,null);assert.equal(gallery.list().images.some(r=>r.id==='one'),false);
    const oldVote=db.prepare('SELECT * FROM gallery_monthly_votes').get();
    now=month.endsAt;assert.equal(gallery.voting(voter).month,'2026-12');assert.equal(gallery.voting(voter).revision,0);
    assert.throws(()=>vote('two',4,'request-late'),{status:409});
    assert.deepEqual(db.prepare('SELECT * FROM gallery_monthly_votes').get(),oldVote);
    assert.equal(JSON.stringify(gallery.list()).includes(voter.steam_id),false);
    now=Date.parse('2026-12-31T14:00:00Z');assert.equal(gallery.voting().month,'2027-01');
  }finally{db.close();}
});

test('completed monthly results retain ties, omit private entries and never expose voter identities',()=>{
  const db=new DatabaseSync(':memory:');let now=Date.parse('2026-11-05T00:00:00Z');
  try{
    const gallery=createGalleryStore(db,{now:()=>now});
    const insert=db.prepare('INSERT INTO gallery_images(id,owner_steam_id,author,title,width,height,content_hash,request_id,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for(const id of ['one','two','three'])insert.run(id,owner.steam_id,'Fixture',id,1,1,'hash',id,now,'approved');
    for(let i=0;i<5;i++)gallery.vote({steam_id:`7656119800000090${i}`},{month:'2026-11',imageId:i<2?'one':i<4?'two':'three',expectedRevision:0,requestId:`results-vote-${i}`});
    assert.throws(()=>gallery.results('2026-11'),{status:400});
    now=Date.parse('2026-11-30T14:00:00Z');
    const changes=db.prepare('SELECT total_changes() AS n').get().n;
    const result=gallery.results();assert.equal(result.month,'2026-11');
    assert.deepEqual(result.images.map(r=>[r.id,r.votes,r.rank]),[['one',2,1],['two',2,1],['three',1,3]]);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,changes);
    assert.equal(JSON.stringify(result).includes(owner.steam_id),false);
    assert.equal(JSON.stringify(result).includes('steam'),false);
    gallery.withdraw(owner,'one');
    gallery.review({...voter,is_admin:true},'two',{requestId:'results-reject',status:'rejected',expectedRevision:0,reason:'Removed after moderation review'});
    assert.deepEqual(gallery.results('2026-11').images.map(r=>r.id),['three']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gallery_monthly_votes').get().n,5);
    for(const invalid of ['2026-12','2027-01','2026-00','2026-13',[],"2026-11' OR 1=1"])
      assert.throws(()=>gallery.results(invalid),{status:400});
    assert.deepEqual(gallery.results('2026-10').images,[]);
    now=Date.parse('2026-12-31T14:00:00Z');assert.equal(gallery.results().month,'2026-12');
  }finally{db.close();}
});
