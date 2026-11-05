const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const sharp=require('sharp');
const {normalizeGalleryImage}=require('../server/services/galleryImage');
const {createGalleryStore}=require('../server/services/galleryStore');
const a={steam_id:'76561198000000111',username:'Photographer'},b={steam_id:'76561198000000112',username:'Other'},admin={steam_id:'76561198000000113',is_admin:true};
const picture=()=>sharp({create:{width:40,height:20,channels:3,background:'#228833'}}).png().withMetadata().toBuffer();
test('images are decoded, resized, stripped of metadata and forced to WebP',async()=>{
  const input=await sharp({create:{width:2400,height:1200,channels:3,background:'#228833'}}).jpeg().withExif({IFD0:{Artist:'Private photographer'}}).toBuffer();
  const output=await normalizeGalleryImage(input),meta=await sharp(output.data).metadata();
  assert.equal(meta.format,'webp');assert.equal(output.width,1920);assert.equal(output.height,960);
  assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined);assert.equal(meta.icc,undefined);
  for(const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),Buffer.from('not an image'),input.subarray(0,20),Buffer.alloc(8*1024*1024+1)])await assert.rejects(normalizeGalleryImage(bad),{status:400});
});
test('gallery is private until reviewed, idempotent and owner-controlled with immutable moderation history',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const gallery=createGalleryStore(db),image=await picture();
    const input={requestId:'upload-0001',title:'A day in the Valley',image};
    const first=await gallery.submit(a,input);
    assert.equal(first.status,'pending');assert.equal(gallery.list().images.length,0);
    assert.equal(gallery.list(a,{mine:true}).images[0].id,first.id);
    assert.throws(()=>gallery.image(first.id,b),{status:404});
    assert.ok(gallery.image(first.id,a).length);assert.ok(gallery.image(first.id,admin).length);
    assert.equal((await gallery.submit(a,input)).duplicate,true);
    await assert.rejects(gallery.submit(a,{...input,title:'Different'}),{status:409});
    const decision={requestId:'review-0001',status:'approved',featured:true,reason:'Suitable community screenshot',expectedRevision:0};
    assert.throws(()=>gallery.review(b,first.id,decision),{status:403});
    gallery.review(admin,first.id,decision);assert.equal(gallery.review(admin,first.id,decision).duplicate,true);
    assert.throws(()=>gallery.review(admin,first.id,{...decision,requestId:'review-0002'}),{status:409});
    assert.equal(gallery.list().images[0].featured,true);
    assert.equal(JSON.stringify(gallery.list()).includes(a.steam_id),false);
    assert.ok(gallery.image(first.id).length);
    assert.throws(()=>gallery.withdraw(b,first.id),{status:404});
    gallery.withdraw(a,first.id);gallery.withdraw(a,first.id);
    assert.equal(gallery.list().images.length,0);assert.throws(()=>gallery.image(first.id,admin),{status:404});
    assert.equal(db.prepare('SELECT image FROM gallery_images').get().image,null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gallery_reviews').get().n,1);
    assert.throws(()=>gallery.review(admin,first.id,{...decision,requestId:'review-0003',expectedRevision:2}),{status:409});
  }finally{db.close();}
});
test('withdrawals cannot bypass daily submission limits',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const gallery=createGalleryStore(db),image=await picture();
    for(let i=0;i<5;i++){const row=await gallery.submit(a,{requestId:`upload-${i}000`,title:'Screenshot',image});gallery.withdraw(a,row.id);}
    await assert.rejects(gallery.submit(a,{requestId:'upload-limit',title:'Screenshot',image}),{status:429});
  }finally{db.close();}
});
