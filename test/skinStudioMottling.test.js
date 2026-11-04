const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/assets/skin-studio-3d.js'), 'utf8');
const start = source.indexOf('function deinosuchusMottlingEligible(');
const end = source.indexOf('function basicMaterialFrom(', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('procedural preview is restricted to Deinosuchus hide in game mode', () => {
  const eligible = context.deinosuchusMottlingEligible;
  assert.equal(eligible({key:'deinosuchus'}, false, 'MI_Deinosuchus_Body'), true);
  assert.equal(eligible({key:'deinosuchus'}, true, 'MI_Deinosuchus_Body'), false);
  assert.equal(eligible({key:'tyrannosaurus'}, false, 'Body'), false);
  for (const role of ['Eye','Eyes','Teeth','Mouth','Tongue','Claw']) assert.equal(eligible({key:'deinosuchus'},false,`MI_Deinosuchus_${role}`),false);
});

test('plain shaders retain the original mask pipeline; procedural branch keeps extended channels last', () => {
  const make=()=>({uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>'});
  const plain=make(); context.injectMaskShader(plain,{},true,false);
  assert.equal(plain.vertexShader,make().vertexShader);
  assert.ok(!plain.fragmentShader.includes('hvNoise'));
  const game=make(); context.injectMaskShader(game,{},false,true);
  assert.ok(game.vertexShader.includes('hvSurfacePosition = position * hvSurfaceScale'));
  assert.ok(game.fragmentShader.indexOf('vec3 pigment')<game.fragmentShader.indexOf('hvEyes *'));
  assert.ok(!game.fragmentShader.includes('uniform float time'));
  assert.ok(game.fragmentShader.includes('if (hvMottleStrength > 0.0)'));
});
