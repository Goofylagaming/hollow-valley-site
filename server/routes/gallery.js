const express=require('express');
const {requireAuth,requireAdmin}=require('../middleware/requireAuth');
const {MAX_INPUT_BYTES}=require('../services/galleryImage');
const router=express.Router();let store,inflight=0;
router.get('/capabilities',(_req,res)=>res.set('Cache-Control','no-store').json({enabled:process.env.HV_GALLERY_ENABLED==='1',maxUploadBytes:MAX_INPUT_BYTES}));
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');if(process.env.HV_GALLERY_ENABLED!=='1')return res.status(503).json({error:'Gallery is not enabled yet'});next();});
function get(){return store||(store=require('../services/galleryStore').createGalleryStore(require('../db').db));}
const run=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Gallery is temporarily unavailable'});}};
function sameOrigin(req,res,next){
  let origin;try{origin=process.env.PUBLIC_SITE_URL?new URL(process.env.PUBLIC_SITE_URL).origin:`${req.protocol}://${req.get('host')}`;}catch{return res.status(503).json({error:'Gallery origin is not configured'});}
  if(req.get('origin')!==origin)return res.status(403).json({error:'Use the Hollow Valley website to change the gallery'});next();
}
function linked(req,res,next){if(!/^\d{17}$/.test(String(req.user?.steam_id||'')))return res.status(403).json({error:'A linked Steam account is required'});next();}
router.get('/',run((req,res)=>res.json(get().list(null,{featured:req.query.featured==='1',before:req.query.before===undefined?undefined:Number(req.query.before)}))));
router.get('/mine',requireAuth,linked,run((req,res)=>res.json(get().list(req.user,{mine:true,before:req.query.before===undefined?undefined:Number(req.query.before)}))));
router.get('/admin',requireAdmin,linked,run((req,res)=>res.json(get().list(req.user,{admin:true,status:req.query.status||'all',before:req.query.before===undefined?undefined:Number(req.query.before)}))));
router.get('/:id/history',requireAdmin,linked,run((req,res)=>res.json({reviews:get().history(req.user,req.params.id)})));
router.get('/:id/image',run((req,res)=>{
  const data=get().image(req.params.id,req.user);
  res.set({'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="screenshot.webp"','Cross-Origin-Resource-Policy':'same-origin'}).send(data);
}));
router.post('/',requireAuth,linked,sameOrigin,(req,res,next)=>{
  if(!req.is('application/octet-stream'))return res.status(415).json({error:'Send the image file as binary data'});
  next();
},express.raw({type:'application/octet-stream',limit:MAX_INPUT_BYTES}),run(async(req,res)=>{
  if(inflight>=2)return res.status(429).json({error:'Gallery is processing other uploads; try again shortly'});
  inflight++;
  try {
    const image=await get().submit(req.user,{requestId:req.get('x-upload-id'),title:req.query.title,image:req.body});
    res.status(image.duplicate?200:201).json({image});
  }finally{inflight--;}
}));
router.post('/:id/review',requireAdmin,linked,sameOrigin,express.json({limit:'4kb'}),run((req,res)=>res.json(get().review(req.user,req.params.id,req.body))));
router.delete('/:id',requireAuth,linked,sameOrigin,run((req,res)=>res.json(get().withdraw(req.user,req.params.id))));
router.use((error,_req,res,next)=>{if(error.type==='entity.too.large')return res.status(413).json({error:'Screenshot must be no larger than 8 MB'});next(error);});
module.exports=router;
