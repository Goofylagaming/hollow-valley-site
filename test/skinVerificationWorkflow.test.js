const test=require('node:test');const assert=require('node:assert/strict');
const c=require('../public/assets/rex-staging-calibration');
const {generate}=require('../scripts/skin-verification-cases');
test('reference exports exactly and pattern counts match observed game UI',()=>{
 assert.equal(c.gameCode({skin:c.reference.colors,...c.reference}),c.reference.code);
 for(let p=0;p<5;p++)for(let v=0;v<3;v++){
  const skin=c.diagnostic(p);const before=JSON.stringify(skin);
  const code=c.gameCode({skin,patternIndex:p,skinVariation:v,colorSpace:'srgb'});
  assert.equal(code.length,'Tyrannosaurus'.length+3+[5,5,5,6,3][p]*8);
  assert.ok(code.startsWith('Tyrannosaurus'+p+v+'0'));assert.equal(JSON.stringify(skin),before);
 }
 assert.ok(c.gameCode({skin:c.diagnostic(3,'detail1'),patternIndex:3,colorSpace:'srgb'}).startsWith('Tyrannosaurus300FF00FFFF'));
 assert.throws(()=>c.diagnostic(4,'markings'));assert.throws(()=>c.gameCode({skin:{},patternIndex:5}));
 assert.throws(()=>c.gameCode({skin:c.reference.colors,themeIndex:1}));
});
test('native premium values are converted for game import without changing stored colours',()=>{
 const pack=require('../public/assets/premium-skin-drafts.json');const before=JSON.stringify(pack);
 assert.equal(c.gameCode({skin:pack.skins[0].colors,skinVariation:1}),'Tyrannosaurus010D8D4C8FF8A8A85FFA8A7A0FF70726EFFC9AA90FF');
 assert.equal(JSON.stringify(pack),before);
});
test('other species workflow generates pending isolated channel tests from explicit profiles',()=>{
 const result=generate({species:'ExampleDino',gameBuild:'test',patterns:[{index:2,channels:['body','belly']}]});
 assert.equal(result.cases.length,6);assert.equal(result.published,false);
 assert.ok(result.cases.every(x=>x.result==='pending'&&!x.gameScreenshot));
 assert.equal(result.cases[0].code,'ExampleDino200FF00FFFF303030FF');
 assert.throws(()=>generate({species:'Example',patterns:[{index:0,channels:['body','body']}]}));
});
