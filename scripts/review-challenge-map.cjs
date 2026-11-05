"use strict";
const fs=require('node:fs'),path=require('node:path');
const {describe,createChallengeLocationCatalog}=require('../automation-platform/src/services/challengeLocationCatalog');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function previewHtml({catalog:c,digest}){
  const b=c.bounds,scale=Math.min(720/(b.maxX-b.minX),420/(b.maxY-b.minY));
  const x=v=>40+(720-(b.maxX-b.minX)*scale)/2+(v-b.minX)*scale,y=v=>40+(420-(b.maxY-b.minY)*scale)/2+(v-b.minY)*scale;
  const vertices=c.highlands.polygon.map((p,i)=>`<tr><td>${i+1}</td><td>${p[0]}</td><td>${p[1]}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Map rule review — ${escape(c.version)}</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:1rem;color:#173b2b}svg{width:100%;border:1px solid #50705b}p,code{overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #8ba897;padding:.4rem}polygon{fill:#94c9a5;stroke:#173b2b;stroke-width:2}</style><h1>Map rule review: ${escape(c.version)}</h1><p>This diagram displays the supplied geometry. Compare it with verified map evidence before activation; it does not establish a real Highlands boundary.</p><p>Map version: ${escape(c.mapVersion)} · Units: Unreal centimetres</p><p>Exact SHA-256 digest: <code>${digest}</code></p><p>Review evidence: ${escape(c.reviewNote)}</p><svg viewBox="0 0 800 520" role="img" aria-label="Supplied Highlands polygon within reviewed map bounds"><rect x="${x(b.minX)}" y="${y(b.minY)}" width="${(b.maxX-b.minX)*scale}" height="${(b.maxY-b.minY)*scale}" fill="#eff7f1" stroke="#50705b"/><polygon points="${c.highlands.polygon.map(p=>x(p[0])+','+y(p[1])).join(' ')}"/>${c.highlands.polygon.map((p,i)=>`<text x="${x(p[0])+4}" y="${y(p[1])-5}" font-size="12">${i+1}</text>`).join('')}<text x="40" y="495" font-size="15">Raw X increases right; raw Y increases down. No compass orientation is inferred.</text></svg><p>Bounds: X ${b.minX} to ${b.maxX}; Y ${b.minY} to ${b.maxY}.</p><table><thead><tr><th>Vertex</th><th>Raw X</th><th>Raw Y</th></tr></thead><tbody>${vertices}</tbody></table><p>Reviewing or staging rules does not activate them. Keep collection disabled until geometry, feed units, sampling cadence and staging have been verified.</p></html>`;
}
function main(args){
  const [command,...rest]=args;
  const spec={review:{required:['file'],optional:['preview']},stage:{required:['file','database','reviewer','digest'],optional:[]},inspect:{required:['database'],optional:['version']},activate:{required:['database','version','digest','active-version','reviewer'],optional:[]},deactivate:{required:['database','version','digest','reviewer'],optional:[]}}[command];
  if(!spec)throw new Error('Choose review, stage, inspect, activate or deactivate');
  const options={};let write=false;
  for(let i=0;i<rest.length;i++){
    const flag=rest[i];if(flag==='--write'){if(write||!['stage','activate','deactivate'].includes(command))throw new Error('Explicit --write is allowed once for stage, activate or deactivate only');write=true;continue;}
    const name=flag.startsWith('--')?flag.slice(2):'';
    if(![...spec.required,...spec.optional].includes(name)||Object.hasOwn(options,name)||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('Unknown, missing or duplicate map-review option');options[name]=rest[++i];
  }
  if(spec.required.some(key=>!Object.hasOwn(options,key)))throw new Error('Required options: '+spec.required.map(k=>'--'+k).join(', '));
  if(options.reviewer&&!/^\d{17}$/.test(options.reviewer))throw new Error('A reviewing operator Steam ID is required');
  if(options.digest&&!/^[a-f0-9]{64}$/.test(options.digest))throw new Error('Use the exact reviewed SHA-256 digest');
  let checked;
  if(options.file){const file=path.resolve(options.file),stat=fs.statSync(file);if(!stat.isFile()||stat.size>65536)throw new Error('Choose a map catalog JSON file no larger than 64 KiB');checked=describe(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));if(options.digest&&options.digest!==checked.digest)throw new Error('Map rules changed after review; review the file again');}
  if(command==='review'){
    let preview=null;
    if(options.preview){preview=path.resolve(options.preview);if(path.extname(preview).toLowerCase()!=='.html'||preview===path.resolve(options.file))throw new Error('Choose a separate new .html review artifact');fs.writeFileSync(preview,previewHtml(checked),{flag:'wx'});}
    return {...checked,preview,databaseOpened:false,registered:false,activated:false};
  }
  // Host-operator tool: never loads .env, infers a database or creates a new file.
  const database=fs.realpathSync(path.resolve(options.database));if(!fs.statSync(database).isFile())throw new Error('Select an existing authoritative automation database');
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(database,{readOnly:!write});
  try{
    db.exec('PRAGMA busy_timeout=5000');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!['vl_state','vl_lives','dc_participants'].every(t=>tables.has(t)))throw new Error('The selected file is not an initialized Legacy/challenge automation database');
    const ready=['dc_location_catalogs','dc_location_active','dc_location_catalog_audit'].every(t=>tables.has(t));
    if(!ready&&command!=='stage'){if(command==='inspect')return {database,schemaReady:false,activeVersion:null,catalogs:[],written:false};throw new Error('Stage reviewed rules before activation');}
    const catalogs=ready||write?createChallengeLocationCatalog(db,{initialize:write}):null;
    const activeVersion=ready?db.prepare('SELECT version FROM dc_location_active WHERE id=1').get()?.version||null:null;
    if(command==='inspect'){
      const entries=options.version?db.prepare('SELECT version,reviewed_by,created_at FROM dc_location_catalogs WHERE version=?').all(options.version):db.prepare('SELECT version,reviewed_by,created_at FROM dc_location_catalogs ORDER BY version LIMIT 101').all();
      if(entries.length>100)throw new Error('Specify --version to inspect a catalog in a database with more than 100 versions');
      const selected=options.version?catalogs.get(options.version):null;if(options.version&&!selected)throw new Error('Map catalog version was not found');
      const audit=db.prepare('SELECT * FROM dc_location_catalog_audit ORDER BY id DESC LIMIT 50').all();
      return {database,schemaReady:true,activeVersion,catalogs:entries,selected,audit,written:false};
    }
    if(command==='stage'){
      const old=catalogs?.get(checked.catalog.version);if(old&&old.digest!==checked.digest)throw new Error('Catalog version already has different rules; choose a new version');
      if(!write)return {database,...checked,activeVersion,wouldStage:!old,written:false};
      return {database,...catalogs.register(checked.catalog,options.reviewer),activeVersion,staged:true,collectionSettingsChanged:false,written:true};
    }
    if(command==='activate'){
      const saved=catalogs.get(options.version);if(!saved||saved.digest!==options.digest)throw new Error('Inspect the exact staged version and digest before activation');
      const expectedVersion=options['active-version']==='none'?null:options['active-version'];
      if(activeVersion!==expectedVersion)throw new Error('Active map version changed; inspect and review again');
      if(!write)return {database,version:saved.version,digest:saved.digest,activeVersion,wouldActivate:true,written:false};
      return {database,...catalogs.activate({version:saved.version,digest:saved.digest,expectedVersion,actorSteamId:options.reviewer}),collectionSettingsChanged:false,written:true};
    }
    const saved=db.prepare('SELECT digest FROM dc_location_catalogs WHERE version=?').get(options.version);
    if(activeVersion!==options.version||saved?.digest!==options.digest)throw new Error('Active map version or digest changed; inspect and review again');
    if(!write)return {database,activeVersion,digest:saved.digest,wouldDeactivate:true,written:false};
    return {database,...catalogs.deactivate({expectedVersion:options.version,digest:options.digest,actorSteamId:options.reviewer}),collectionSettingsChanged:false,written:true};
  }finally{db.close();}
}
if(require.main===module){try{console.log(JSON.stringify(main(process.argv.slice(2)),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={main,previewHtml};
