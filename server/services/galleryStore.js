const {randomUUID,createHash}=require('node:crypto');
const {normalizeGalleryImage}=require('./galleryImage');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function identity(user) {
  if(typeof user?.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id))fail('Sign in with a linked Steam account',403);
  return user.steam_id;
}
function createGalleryStore(db,{now=Date.now}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_images (
    id TEXT PRIMARY KEY,owner_steam_id TEXT NOT NULL,author TEXT NOT NULL,title TEXT NOT NULL,
    image BLOB,width INTEGER NOT NULL,height INTEGER NOT NULL,content_hash TEXT NOT NULL,
    request_id TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
    featured INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,
    UNIQUE(owner_steam_id,request_id));
    CREATE INDEX IF NOT EXISTS gallery_owner ON gallery_images(owner_steam_id,created_at);
    CREATE INDEX IF NOT EXISTS gallery_status ON gallery_images(status,created_at);
    CREATE TABLE IF NOT EXISTS gallery_reviews (
      request_id TEXT PRIMARY KEY,image_id TEXT NOT NULL,actor_steam_id TEXT NOT NULL,
      payload TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_monthly_votes (
    month TEXT NOT NULL,steam_id TEXT NOT NULL,image_id TEXT,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,
    PRIMARY KEY(month,steam_id));
    CREATE INDEX IF NOT EXISTS gallery_vote_image ON gallery_monthly_votes(month,image_id);
    CREATE TABLE IF NOT EXISTS gallery_vote_requests (
      steam_id TEXT NOT NULL,request_id TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(steam_id,request_id));`);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const card=row=>({id:row.id,author:row.author,title:row.title,width:row.width,height:row.height,createdAt:row.created_at,featured:Boolean(row.featured)});
  function voting(user) {
    const local=new Date(now()+36000000),year=local.getUTCFullYear(),month=local.getUTCMonth();
    const period={month:`${year}-${String(month+1).padStart(2,'0')}`,startsAt:Date.UTC(year,month,1)-36000000,endsAt:Date.UTC(year,month+1,1)-36000000};
    const saved=user?.steam_id?db.prepare('SELECT image_id,revision FROM gallery_monthly_votes WHERE month=? AND steam_id=?').get(period.month,user.steam_id):null;
    const visible=saved?.image_id&&db.prepare("SELECT 1 FROM gallery_images WHERE id=? AND status='approved' AND created_at>=? AND created_at<?").get(saved.image_id,period.startsAt,period.endsAt);
    return {...period,myVoteId:visible?saved.image_id:null,revision:saved?.revision||0};
  }
  function vote(user,input={}) {
    const steam=identity(user),period=voting(user);
    const {month,imageId,requestId,expectedRevision}=input||{};
    if(month!==period.month)fail('The voting month has changed; refresh the gallery',409);
    if((imageId!==null&&typeof imageId!=='string')||typeof requestId!=='string'||!/^[\w-]{8,128}$/.test(requestId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('Valid vote, request ID and revision required');
    const payload=JSON.stringify({month,imageId,expectedRevision});
    return tx(()=>{
      const prior=db.prepare('SELECT payload FROM gallery_vote_requests WHERE steam_id=? AND request_id=?').get(steam,requestId);
      if(prior){if(prior.payload!==payload)fail('Conflicting vote request',409);return {duplicate:true,voting:voting(user)};}
      const latest=voting(user);
      if(latest.month!==month||latest.revision!==expectedRevision)fail('Your vote or voting month changed; refresh the gallery',409);
      if(imageId!==null){
        const row=db.prepare("SELECT owner_steam_id FROM gallery_images WHERE id=? AND status='approved' AND created_at>=? AND created_at<?").get(imageId,period.startsAt,period.endsAt);
        if(!row)fail('This screenshot is not eligible this month',400);
        if(row.owner_steam_id===steam)fail('Choose another player’s screenshot',400);
      }
      if(db.prepare('SELECT COUNT(*) AS n FROM gallery_vote_requests WHERE steam_id=? AND created_at>?').get(steam,now()-3600000).n>=10)fail('Please wait before changing your vote again',429);
      db.prepare(`INSERT INTO gallery_monthly_votes VALUES (?,?,?,?,?) ON CONFLICT(month,steam_id)
        DO UPDATE SET image_id=excluded.image_id,revision=excluded.revision,updated_at=excluded.updated_at`).run(month,steam,imageId,expectedRevision+1,now());
      db.prepare('INSERT INTO gallery_vote_requests VALUES (?,?,?,?)').run(steam,requestId,payload,now());
      return {duplicate:false,voting:voting(user)};
    });
  }
  function results(month) {
    const current=voting();
    if(month===undefined){const previous=new Date(current.startsAt-1+36000000);month=`${previous.getUTCFullYear()}-${String(previous.getUTCMonth()+1).padStart(2,'0')}`;}
    if(typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month>=current.month)fail('Choose a completed voting month');
    const [year,index]=month.split('-').map(Number),startsAt=Date.UTC(year,index-1,1)-36000000,endsAt=Date.UTC(year,index,1)-36000000;
    const rows=db.prepare(`WITH counts AS (
      SELECT i.id,i.author,i.title,i.width,i.height,i.created_at,i.featured,COUNT(*) AS votes
      FROM gallery_monthly_votes v JOIN gallery_images i ON i.id=v.image_id
      WHERE v.month=? AND i.status='approved' AND i.created_at>=? AND i.created_at<?
      GROUP BY i.id
    ) SELECT *,RANK() OVER (ORDER BY votes DESC) AS rank FROM counts
      ORDER BY votes DESC,created_at,id LIMIT 51`).all(month,startsAt,endsAt);
    return {month,startsAt,endsAt,limited:rows.length>50,images:rows.slice(0,50).map(row=>({...card(row),votes:row.votes,rank:row.rank}))};
  }
  async function submit(user,{requestId,title,image}={}) {
    const steam=identity(user);
    if(typeof requestId!=='string'||!/^[\w-]{8,128}$/.test(requestId)||typeof title!=='string'||!title.trim()||title.trim().length>120)fail('A request ID and a title of 1–120 characters are required');
    const normalized=await normalizeGalleryImage(image);
    const hash=createHash('sha256').update(normalized.data).digest('hex');
    return tx(()=>{
      const prior=db.prepare('SELECT * FROM gallery_images WHERE owner_steam_id=? AND request_id=?').get(steam,requestId);
      if(prior){if(prior.content_hash!==hash||prior.title!==title.trim())fail('Upload request conflicts with the saved submission',409);return {...card(prior),status:prior.status,duplicate:true};}
      if(db.prepare("SELECT COUNT(*) AS n FROM gallery_images WHERE owner_steam_id=? AND status!='withdrawn'").get(steam).n>=20||db.prepare('SELECT COUNT(*) AS n FROM gallery_images WHERE owner_steam_id=? AND created_at>=?').get(steam,now()-86400000).n>=5)fail('Gallery limit reached: 20 saved images and 5 submissions per day',429);
      if(db.prepare('SELECT COALESCE(SUM(length(image)),0) AS n FROM gallery_images').get().n+normalized.data.length>2*1024*1024*1024)fail('Gallery storage is full',503);
      const id=randomUUID();
      db.prepare('INSERT INTO gallery_images(id,owner_steam_id,author,title,image,width,height,content_hash,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,steam,String(user.username||'Survivor').slice(0,80),title.trim(),normalized.data,normalized.width,normalized.height,hash,requestId,now());
      const row=db.prepare('SELECT * FROM gallery_images WHERE id=?').get(id);
      return {...card(row),status:row.status,duplicate:false};
    });
  }
  function list(user,{mine=false,admin=false,before=Number.MAX_SAFE_INTEGER,status='all',featured=false}={}) {
    if(!Number.isSafeInteger(before)||before<0)fail('Invalid page cursor');
    if(!['all','pending','approved','rejected','withdrawn'].includes(status)||typeof featured!=='boolean')fail('Invalid gallery filter');
    if(!mine&&!admin&&status!=='all')fail('Private status filters require owner or admin access',403);
    if(admin&&!user?.is_admin)fail('Admin access required',403);
    let where="status='approved'",args=[];
    if(mine){where='owner_steam_id=?';args=[identity(user)];}
    else if(admin){identity(user);where="status!='withdrawn'";}
    if(status!=='all'){where+=' AND status=?';args.push(status);}
    if(featured)where+=' AND featured=1';
    const rows=db.prepare(`SELECT rowid AS cursor,id,owner_steam_id,author,title,width,height,created_at,status,featured,revision FROM gallery_images WHERE ${where} AND rowid<? ORDER BY rowid DESC LIMIT 50`).all(...args,before);
    const period=voting(user);
    return {images:rows.map(row=>{
      const eligible=row.status==='approved'&&row.created_at>=period.startsAt&&row.created_at<period.endsAt;
      return {...card(row),votes:eligible?db.prepare('SELECT COUNT(*) AS n FROM gallery_monthly_votes WHERE month=? AND image_id=?').get(period.month,row.id).n:0,
        canVote:eligible&&Boolean(user?.steam_id)&&row.owner_steam_id!==user.steam_id,
        ...(mine||admin?{status:row.status,revision:row.revision}:{}),...(admin?{ownerSteamId:row.owner_steam_id}:{})};
    }),voting:period,nextCursor:rows.length===50?rows.at(-1).cursor:null};
  }
  function image(id,user) {
    const row=db.prepare('SELECT * FROM gallery_images WHERE id=?').get(id);
    if(!row||row.status==='withdrawn'||(row.status!=='approved'&&row.owner_steam_id!==user?.steam_id&&!user?.is_admin))fail('Image not found',404);
    return Buffer.from(row.image);
  }
  function review(user,id,input={}) {
    const actor=identity(user);if(!user.is_admin)fail('Admin access required',403);
    const {requestId,status,featured=false,reason,expectedRevision}=input;
    if(typeof requestId!=='string'||!/^[\w-]{8,128}$/.test(requestId)||!['approved','rejected'].includes(status)||typeof featured!=='boolean'||(featured&&status!=='approved')||typeof reason!=='string'||reason.trim().length<10||reason.length>500||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('Valid decision, revision and review reason required');
    const payload=JSON.stringify({id,actor,status,featured,reason:reason.trim(),expectedRevision});
    return tx(()=>{
      const old=db.prepare('SELECT payload FROM gallery_reviews WHERE request_id=?').get(requestId);
      if(old){if(old.payload!==payload)fail('Conflicting review request',409);return {duplicate:true};}
      const row=db.prepare('SELECT status,revision FROM gallery_images WHERE id=?').get(id);
      if(!row)fail('Image not found',404);
      if(row.status==='withdrawn'||row.revision!==expectedRevision)fail('Image changed; reload before reviewing',409);
      db.prepare('UPDATE gallery_images SET status=?,featured=?,revision=revision+1 WHERE id=?').run(status,Number(featured),id);
      db.prepare('INSERT INTO gallery_reviews VALUES (?,?,?,?,?)').run(requestId,id,actor,payload,now());
      return {duplicate:false};
    });
  }
  function withdraw(user,id) {
    const steam=identity(user);
    const row=db.prepare('SELECT owner_steam_id FROM gallery_images WHERE id=?').get(id);
    if(!row||row.owner_steam_id!==steam)fail('Image not found',404);
    db.prepare("UPDATE gallery_images SET status='withdrawn',featured=0,image=NULL,revision=revision+1 WHERE id=? AND status!='withdrawn'").run(id);
    return {withdrawn:true};
  }
  function history(user,id) {
    identity(user);if(!user.is_admin)fail('Admin access required',403);
    if(!db.prepare('SELECT id FROM gallery_images WHERE id=?').get(id))fail('Image not found',404);
    return db.prepare('SELECT actor_steam_id,created_at,payload FROM gallery_reviews WHERE image_id=? ORDER BY created_at,request_id').all(id).map(row=>({actorSteamId:row.actor_steam_id,createdAt:row.created_at,...JSON.parse(row.payload)}));
  }
  return {submit,list,image,review,withdraw,history,vote,voting,results};
}
module.exports={createGalleryStore};
