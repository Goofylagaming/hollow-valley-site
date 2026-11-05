const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const sharp=require('sharp');
process.env.DB_PATH=':memory:';
const {db}=require('../server/db');
test.after(()=>db.close());
test('upload and image routes enforce rollout, identity, origin and moderation',async()=>{
  const app=express();app.use((req,res,next)=>{if(req.get('x-test-user'))req.user={steam_id:req.get('x-test-user'),username:'Fixture',is_admin:req.get('x-test-admin')==='1'};next();});
  app.use('/gallery',require('../server/routes/gallery'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const owner='76561198000000111',other='76561198000000112';
  const image=await sharp({create:{width:16,height:16,channels:3,background:'green'}}).png().toBuffer();
  const headers={'Content-Type':'application/octet-stream',Origin:base,'x-test-user':owner,'x-upload-id':'upload-http-1'};
  const upload=extra=>fetch(base+'/gallery?title=Screenshot',{method:'POST',headers:{...headers,...extra},body:image});
  try{
    assert.equal((await upload()).status,503);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='gallery_images'").get(),undefined);
    process.env.HV_GALLERY_ENABLED='1';
    assert.equal((await upload({'x-test-user':''})).status,401);
    assert.equal((await upload({Origin:'https://untrusted.invalid'})).status,403);
    const response=await upload();assert.equal(response.status,201);const id=(await response.json()).image.id;
    assert.equal((await fetch(`${base}/gallery/${id}/image`)).status,404);
    assert.equal((await fetch(`${base}/gallery/${id}/image`,{headers:{'x-test-user':other}})).status,404);
    const own=await fetch(`${base}/gallery/${id}/image`,{headers:{'x-test-user':owner}});assert.equal(own.status,200);assert.equal(own.headers.get('content-type'),'image/webp');assert.equal(own.headers.get('cache-control'),'private, no-store');assert.equal(own.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await fetch(base+'/gallery/admin',{headers:{'x-test-user':owner}})).status,403);
    const review=await fetch(`${base}/gallery/${id}/review`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','x-test-user':other,'x-test-admin':'1'},body:JSON.stringify({requestId:'review-http-1',status:'approved',reason:'Community screenshot reviewed',expectedRevision:0})});assert.equal(review.status,200);
    assert.equal((await fetch(`${base}/gallery/${id}/image`)).status,200);
    assert.equal((await fetch(`${base}/gallery/${id}/history`,{headers:{'x-test-user':owner}})).status,403);
    const history=await (await fetch(`${base}/gallery/${id}/history`,{headers:{'x-test-user':other,'x-test-admin':'1'}})).json();
    assert.equal(history.reviews[0].reason,'Community screenshot reviewed');
    assert.equal(history.reviews[0].actorSteamId,other);
    assert.equal((await (await fetch(base+'/gallery')).json()).images.length,1);
    assert.equal((await fetch(`${base}/gallery/${id}`,{method:'DELETE',headers:{Origin:base,'x-test-user':owner}})).status,200);
    assert.equal((await fetch(`${base}/gallery/${id}/image`)).status,404);
  }finally{delete process.env.HV_GALLERY_ENABLED;await new Promise(resolve=>server.close(resolve));}
});
