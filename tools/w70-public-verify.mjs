// Read-only public release verification. No sessions, secrets, accounts or save writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const expected='5ebfccaaad8d0751e16c1d1b61d1664836732999';
const digest='eebdbfbd252ad046be6a3152bd4dd893212a1a74137bb0687b230e73e69d47ee';
const notes='c95cc19f22a5d665c268731f11a7c18232a2cb25';
const bases=['https://primalbound-web-preview.onrender.com/','https://primalbound-cloud-preview.onrender.com/','https://primalboundgame.com/web/'];
async function bytes(url){const r=await fetch(url,{signal:AbortSignal.timeout(90000),headers:{'Cache-Control':'no-cache'}});assert.equal(r.status,200,url+' status');return Buffer.from(await r.arrayBuffer());}
fs.mkdirSync('evidence',{recursive:true});const results=[];
for(const base of bases){
 const raw=await bytes(new URL('release-info.json',base)),info=JSON.parse(raw);
 assert.equal(info.version,expected,base+' commit');assert.equal(info.manifest_sha256,digest);assert.equal(info.notes_commit,notes);assert.equal(info.notes.length,14);
 const manifestBytes=await bytes(new URL('build-manifest.json',base));assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),digest);
 const manifest=JSON.parse(manifestBytes),paths=[...new Set(Object.values(manifest).flatMap(entry=>[entry.file,...(entry.css||[])]))];
 assert.ok(paths.length>10);assert.ok(paths.every(path=>/^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path)));
 let cursor=0;await Promise.all(Array.from({length:6},async()=>{while(cursor<paths.length){const path=paths[cursor++],data=await bytes(new URL(path,base));assert.ok(data.length>0,path);assert.ok(!data.toString('utf8',0,100).toLowerCase().includes('<!doctype html'),path+' must be an asset');}}));
 const html=(await bytes(base)).toString('utf8'),entry=Object.values(manifest).find(e=>e.isEntry);assert.ok(entry&&html.includes(entry.file),base+' entry');
 fs.writeFileSync('evidence/live-release-info.json',raw);results.push({base,commit:info.version,manifest:digest,notes:notes,bullets:14,verifiedAssets:paths.length});
}
const health=JSON.parse(await bytes('https://primalbound-cloud-preview.onrender.com/api/health'));
assert.equal(health.ok,true);assert.equal(health.accountsConfigured,true);
fs.writeFileSync('evidence/public-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),results,health},null,2));
console.log(JSON.stringify({results,health},null,2));
