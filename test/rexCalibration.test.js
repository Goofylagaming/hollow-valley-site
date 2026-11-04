const test=require('node:test');
const assert=require('node:assert/strict');
const calibration=require('../public/assets/rex-staging-calibration');
test('exported game swatches agree with their labelled fields and material layers',()=>{
 const chunks=calibration.reference.code.slice('Tyrannosaurus010'.length).match(/.{8}/g);
 assert.equal(chunks.length,5);
 ['underbelly','body','flank','markings','maleDisplay'].forEach((key,i)=>assert.equal(calibration.reference.colors[key],'#'+chunks[i].slice(0,6)));
 assert.equal(calibration.layers.blue,'flank');
 assert.equal(calibration.layers.cyan,'body');
 // Extracted material: green (.65,.455,.26), cyan (.25,.17751,.1), red (.15,.038438,.0225).
 for(const [key,expected] of Object.entries({underbelly:[.65,.455,.26],body:[.25,.17751,.1],maleDisplay:[.15,.038438,.0225]})){
  calibration.linearRGB(calibration.reference.colors[key],'srgb').forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<.004));
 }
});
test('game export conversion does not reinterpret or mutate native premium values',()=>{
 assert.deepEqual(calibration.linearRGB('#808080'),[128/255,128/255,128/255]);
 calibration.linearRGB('#808080','srgb').forEach(v=>assert.ok(Math.abs(v-.2158605)<.000001));
 assert.deepEqual(calibration.linearRGB('#000000','srgb'),[0,0,0]);
 assert.deepEqual(calibration.linearRGB('#FFFFFF','srgb'),[1,1,1]);
 assert.throws(()=>calibration.linearRGB('#abc','srgb'));
 assert.throws(()=>calibration.linearRGB('#123456','unknown'));
 assert.ok(Object.isFrozen(calibration.reference.colors));
});
