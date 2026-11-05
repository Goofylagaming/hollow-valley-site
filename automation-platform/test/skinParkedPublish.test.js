const test=require('node:test'),assert=require('node:assert/strict');
process.env.AUTOMATION_DB_PATH=':memory:';
const bridge=require('../src/services/commandBridgeService');
const storage=require('../src/services/dinoStorageService');
const steam='76561198000000901';
test('parked edit reserves the exact command before publication and sends only once',async t=>{
  const order=[],command={id:'fixture-command-001',verb:'dino_edit',steam};
  t.mock.method(bridge,'assertPublisherReady',()=>{});
  t.mock.method(bridge,'buildCommand',()=>command);
  t.mock.method(bridge,'queueCommand',async value=>{assert.equal(value,command);order.push('queue');});
  t.mock.method(bridge,'readOutcome',async()=>({state:'confirmed'}));
  const values=Object.fromEntries(['maleDisplay','markings','body','flank','underbelly','teeth','mouth','claws','detail1','eyes'].map(key=>[key,'0.1,0.2,0.3,1']));
  Object.assign(values,{skinVariation:1,patternIndex:2,themeIndex:3});
  const result=await storage.editStoredDino({steamId:steam,slot:'fixture-slot',mode:'skin',values,beforePublish:value=>{assert.equal(value,command);order.push('reserve');}});
  assert.deepEqual(order,['reserve','queue']);assert.equal(result.command.id,command.id);
  order.length=0;
  await assert.rejects(storage.editStoredDino({steamId:steam,slot:'fixture-slot',mode:'skin',values,beforePublish:()=>{throw new Error('ownership lost');}}),/ownership lost/);
  assert.deepEqual(order,[]);
});
test('publication errors retain the original command ID for reconciliation',async t=>{
  t.mock.method(bridge,'assertPublisherReady',()=>{});
  t.mock.method(bridge,'buildCommand',()=>({id:'fixture-command-002',verb:'dino_edit',steam}));
  t.mock.method(bridge,'queueCommand',async()=>{throw new Error('uncertain publication');});
  let reserved;
  await assert.rejects(storage.runImmediateCommand({verb:'dino_edit',steamId:steam,beforePublish:command=>{reserved=command.id;}}),error=>error.requestId===reserved&&error.message==='uncertain publication');
  assert.equal(reserved,'fixture-command-002');
});
