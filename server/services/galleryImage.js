const sharp=require('sharp');
const MAX_INPUT_BYTES=8*1024*1024;
async function normalizeGalleryImage(input) {
  const fail=()=>{throw Object.assign(new Error('Upload a valid still PNG, JPEG or WebP image, up to 8 MB and 20 megapixels.'),{status:400});};
  if(!Buffer.isBuffer(input)||!input.length||input.length>MAX_INPUT_BYTES)fail();
  const allowed=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ||input.subarray(0,3).equals(Buffer.from([255,216,255]))
    ||(input.toString('ascii',0,4)==='RIFF'&&input.toString('ascii',8,12)==='WEBP');
  if(!allowed)fail();
  try {
    const image=sharp(input,{limitInputPixels:20000000,failOn:'warning'});
    const meta=await image.metadata();
    if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)!==1)fail();
    const {data,info}=await image.rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:85}).timeout({seconds:5}).toBuffer({resolveWithObject:true});
    if(data.length>2*1024*1024)fail();
    return {data,width:info.width,height:info.height};
  }catch{fail();}
}
module.exports={normalizeGalleryImage,MAX_INPUT_BYTES};
