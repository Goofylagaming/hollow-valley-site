(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports) module.exports=api;
 else root.HVRexCalibration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Cross-checked against the user's labelled in-game swatches and extracted MI_Tyrannosaurus_Body.
 const layers=Object.freeze({red:'maleDisplay',green:'underbelly',blue:'flank',cyan:'body',magenta:'markings',yellow:'detail1'});
 const reference=Object.freeze({
  name:'In-game reference',colorSpace:'srgb',patternIndex:0,skinVariation:1,themeIndex:0,
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
 const five=['underbelly','body','flank','markings','maleDisplay'];
 const patterns=Object.freeze([
  {name:'Pattern1',texture:'pattern',channels:five},
  {name:'Pattern2',texture:'pattern2',channels:five},
  {name:'Pattern3',texture:'pattern3',channels:five},
  {name:'Pattern4',texture:'pattern4',channels:['detail1',...five]},
  {name:'Pattern5',texture:'pattern5',channels:five.slice(0,3)}
 ].map(p=>Object.freeze({...p,channels:Object.freeze([...p.channels])})));
 function gameCode({skin,patternIndex=0,skinVariation=0,themeIndex=0,colorSpace='native-linear'}){
  if(!Number.isInteger(patternIndex)||!patterns[patternIndex]||![0,1,2].includes(skinVariation)||themeIndex!==0)throw new Error('Unsupported reference settings');
  const hex=patterns[patternIndex].channels.map(k=>linearRGB(skin[k],colorSpace).map(v=>{
   const srgb=v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055;
   return Math.round(srgb*255).toString(16).padStart(2,'0');
  }).join('')+'FF').join('').toUpperCase();
  return 'Tyrannosaurus'+patternIndex+skinVariation+themeIndex+hex;
 }
 function diagnostic(patternIndex,channel='all'){
  const p=patterns[patternIndex];if(!p)throw new Error('Unknown pattern');
  if(channel!=='all'&&!p.channels.includes(channel))throw new Error('Channel unavailable on this pattern');
  const colours={underbelly:'#FF0000',body:'#00FF00',flank:'#0000FF',markings:'#FFFF00',maleDisplay:'#FF00FF',detail1:'#00FFFF'};
  return Object.fromEntries(Object.keys(reference.colors).map(k=>[k,p.channels.includes(k)?(channel==='all'?colours[k]:k===channel?'#FF00FF':'#303030'):reference.colors[k]]));
 }
 return Object.freeze({layers,reference,linearRGB,patterns,gameCode,diagnostic});
});
