(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports) module.exports=api;
 else root.HVRexCalibration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Cross-checked against the user's labelled in-game swatches and extracted MI_Tyrannosaurus_Body.
 const layers=Object.freeze({red:'maleDisplay',green:'underbelly',blue:'flank',cyan:'body',magenta:'markings',yellow:'detail1'});
 const reference=Object.freeze({
  name:'In-game reference',colorSpace:'srgb',
  code:'Tyrannosaurus010D3B48BFF897559FF594A35FF352F2AFF6C3729FF',
  settings:'Pattern1 / Medium / Default; adult reference',
  // Five exported swatches. Other channels use explicit material/reference defaults, not player data.
  colors:Object.freeze({underbelly:'#D3B48B',body:'#897559',flank:'#594A35',markings:'#352F2A',maleDisplay:'#6C3729',detail1:'#000000',eyes:'#6C2514',mouth:'#7C5859',teeth:'#DED6B8',claws:'#28251E'})
 });
 function linearRGB(hex,colorSpace='native-linear'){
  if(!/^#[0-9a-f]{6}$/i.test(hex))throw new Error('Invalid preview colour');
  if(!['native-linear','srgb'].includes(colorSpace))throw new Error('Unknown preview colour space');
  return [1,3,5].map(i=>{
   const v=parseInt(hex.slice(i,i+2),16)/255;
   return colorSpace==='srgb'?(v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)):v;
  });
 }
 return Object.freeze({layers,reference,linearRGB});
});
