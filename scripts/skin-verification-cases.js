const fs=require('node:fs');
const path=require('node:path');
// Offline only: a reviewed per-species profile defines export order; never guess another species from Rex.
function generate(profile){
 if(!/^[A-Za-z]+$/.test(profile.species)||!Array.isArray(profile.patterns)||!profile.patterns.length)throw Error('Species and reviewed patterns required');
 const cases=[];
 for(const p of profile.patterns){
  if(!Number.isInteger(p.index)||p.index<0||p.index>9||!Array.isArray(p.channels)||!p.channels.length||new Set(p.channels).size!==p.channels.length)throw Error('Invalid pattern profile');
  for(const variation of [0,1,2])for(const channel of p.channels){
   cases.push({pattern:p.index,variation,theme:0,channel,code:profile.species+p.index+variation+'0'+p.channels.map(k=>k===channel?'FF00FFFF':'303030FF').join(''),result:'pending',gameScreenshot:null,stagingScreenshot:null});
  }
 }
 return {species:profile.species,gameBuild:profile.gameBuild,scope:'adult / default theme / fixed imported colours',published:false,cases};
}
module.exports={generate};
if(require.main===module){
 const input=process.argv[2];if(!input)throw Error('Usage: node scripts/skin-verification-cases.js profile.json [output.json]');
 const result=JSON.stringify(generate(JSON.parse(fs.readFileSync(input,'utf8'))),null,2)+'\n';
 if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),result,{flag:'wx'});else process.stdout.write(result);
}
