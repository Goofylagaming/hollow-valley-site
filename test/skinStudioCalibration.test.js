const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Auto = require('../public/assets/skin-studio-auto-map.js');
const viewer = fs.readFileSync(require.resolve('../public/assets/skin-studio-3d.js'), 'utf8');
function functionSource(name) {
  const start = viewer.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = viewer.indexOf('\nfunction ', start + 1);
  return viewer.slice(start, end < 0 ? undefined : end);
}

test('repeated proposals refine automatic pixels, preserve brush edits and erasures, and remove obsolete automatic coverage', () => {
  const current = Uint8Array.from([2, 3, 0, 4, 0]);
  const owners = Uint8Array.from([1, 2, 2, 1, 0]);
  const proposal = Uint8Array.from([1, 1, 4, 0, 3]);
  const result = Auto.mergeProposal(current, owners, proposal);
  assert.deepEqual([...result.lookup], [1, 3, 0, 0, 3]);
  assert.deepEqual([...result.owners], [1, 2, 2, 0, 1]);
  assert.equal(result.preserved, 2);
  assert.equal(Auto.mergeProposal(result.lookup, result.owners, proposal).changed, 0);
  assert.deepEqual([...current], [2, 3, 0, 4, 0]);
});

test('legacy masks remain protected until explicitly rebuilt', () => {
  const current = Uint8Array.from([2, 3, 0]);
  const proposal = Uint8Array.from([1, 4, 2]);
  assert.deepEqual([...Auto.mergeProposal(current, null, proposal).lookup], [2, 3, 2]);
  const rebuilt = Auto.mergeProposal(current, null, proposal, true);
  assert.deepEqual([...rebuilt.lookup], [...proposal]);
  assert.deepEqual([...rebuilt.owners], [1, 1, 1]);
});

test('UV picking matches clamp-to-edge atlas sampling and never falls back to the opposite row', () => {
  const lookup = Uint8Array.from([0, 2, 3, 4]);
  assert.equal(Auto.lookupUv(lookup, 2, {x:0, y:0}), 0);
  assert.equal(Auto.lookupUv(lookup, 2, {x:0, y:1}), 3);
  assert.equal(Auto.lookupUv(lookup, 2, {x:1, y:1}), 4);
  assert.equal(Auto.lookupUv(lookup, 2, {x:-1, y:2}), 3);
  assert.equal(Auto.lookupUv(lookup, 2, {x:NaN, y:0}), 0);
});

function harness() {
  const context = vm.createContext({ Uint8Array, console, setTimeout, clearTimeout });
  vm.runInContext(`
    const CALIBRATION_SIZE=256;
    const ZONE_KEYS=${JSON.stringify(Auto.ZONES)};
    let zoneLookup=new Uint8Array(65536), calibrationOwners=new Uint8Array(65536);
    let calibrationActive=true, model={}, currentModelDef={key:'test'}, currentMaskData=null;
    let calibrationUndoStack=[],calibrationRedoStack=[],maskAtlases=[],calibrationSaveTimer=null;
    const CALIBRATION_HISTORY_LIMIT=30;
    const calibrationFlipVEl={checked:false};
    const saved=new Map();
    const localStorage={setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)};
    function updateCalibrationHistoryButtons(){} function scheduleCalibrationCoverage(){}
    function rebuildMaskAtlasesFromLookup(){} function setCalibrationStatus(){}
    function disposeMaskAtlases(){} function applyCalibratedMaterials(){} function applyPreviewMode(){}
    function updatePalette(){} function paletteFromEditor(){return {};}
    function buildMaskAtlases(){zoneLookup=new Uint8Array(65536);for(const [zone,runs] of Object.entries(currentMaskData.zones)){for(let j=0;j<runs.length;j+=2)zoneLookup.fill(ZONE_KEYS.indexOf(zone)+1,runs[j],runs[j]+runs[j+1]);}return [];}
  `, context);
  for (const name of ['calibrationSnapshot','pushCalibrationHistory','restoreCalibrationSnapshot','undoCalibration','redoCalibration','calibrationStorageKey','maskPayloadFromLookup','rleForZone','saveCalibrationDraftNow','normalizeCalibrationMaskPayload','replaceCalibrationMask','loadCalibrationDraft']) vm.runInContext(functionSource(name), context);
  return code => vm.runInContext(code, context);
}

test('invalid import leaves undo and redo histories untouched', () => {
  const run=harness();
  run('calibrationRedoStack.push(calibrationSnapshot());');
  assert.throws(()=>run('replaceCalibrationMask({size:256,zones:{body:[0,2],flank:[1,1]}})'), /overlaps/);
  assert.equal(run('calibrationUndoStack.length'),0);
  assert.equal(run('calibrationRedoStack.length'),1);
});

test('undo/redo restores automatic ownership as well as colours', () => {
  const run=harness();
  run('zoneLookup[0]=3; calibrationOwners[0]=1; pushCalibrationHistory(); zoneLookup[0]=4; calibrationOwners[0]=2; undoCalibration();');
  assert.equal(run('zoneLookup[0]'),3);assert.equal(run('calibrationOwners[0]'),1);
  run('redoCalibration();');
  assert.equal(run('zoneLookup[0]'),4);assert.equal(run('calibrationOwners[0]'),2);
});

test('draft reload retains automatic pixels, manual erasures and orientation; legacy imports are protected', () => {
  const run=harness();
  run('zoneLookup[0]=3; calibrationOwners[0]=1; calibrationOwners[1]=2; calibrationFlipVEl.checked=true; saveCalibrationDraftNow(); zoneLookup.fill(0); calibrationOwners.fill(0); calibrationFlipVEl.checked=false; loadCalibrationDraft();');
  assert.equal(run('zoneLookup[0]'),3);assert.equal(run('calibrationOwners[0]'),1);
  assert.equal(run('calibrationOwners[1]'),2);assert.equal(run('calibrationFlipVEl.checked'),true);
  run('replaceCalibrationMask({size:256,zones:{body:[5,2]}});');
  assert.equal(run('calibrationOwners[5]'),2);
});
