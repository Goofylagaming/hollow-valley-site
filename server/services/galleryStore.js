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
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const card=row=>({id:row.id,author:row.author,title:row.title,width:row.width,height:row.height,createdAt:row.created_at,featured:Boolean(row.featured)});
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
    return {images:rows.map(row=>({...card(row),...(mine||admin?{status:row.status,revision:row.revision}:{}),...(admin?{ownerSteamId:row.owner_steam_id}:{} )})),nextCursor:rows.length===50?rows.at(-1).cursor:null};
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
  return {submit,list,image,review,withdraw,history};
}
module.exports={createGalleryStore};
