import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('./dist/',import.meta.url);
let count=0;
for(const site of ['primalbound','hollow-valley']){
 const base=resolve(root.pathname.replace(/^\/([A-Za-z]:)/,'$1'),site);
 async function walk(dir){for(const file of await readdir(dir)){const path=resolve(dir,file);if((await stat(path)).isDirectory()){await walk(path);continue;}if(!file.endsWith('.html'))continue;
 const html=await readFile(path,'utf8');assert.match(html,/noindex,nofollow/);assert.match(html,/<h1>/);assert.match(html,/id="main"/);assert.doesNotMatch(html,/<form|<script|iframe|DATABASE_URL|SESSION_SECRET/i);
 for(const [,url]of html.matchAll(/href="([^"]+)"/g)){if(url.startsWith('#')){assert.ok(html.includes(`id="${url.slice(1)}"`),url);continue;}if(!url.startsWith('/'))continue;if(url.startsWith('/#')){const home=await readFile(resolve(base,'index.html'),'utf8');assert.ok(home.includes('id='+String.fromCharCode(34)+url.slice(2)+String.fromCharCode(34)));continue;}const target=resolve(base,'.'+url+(url.endsWith('/')?'index.html':''));assert.ok(target.startsWith(base));await stat(target);}
 count++;
 }}await walk(base);
}
const web=await readFile(new URL('primalbound/web/index.html',root),'utf8');assert.ok(web.includes('href="https://hollowvalleyisle.com/primalbound/"'));
const world=await readFile(new URL('primalbound/world/index.html',root),'utf8');assert.match(world,/primalbound-downloads\/releases\/latest/);
console.log(`PASS: ${count} pages; internal links, anchors, noindex, static isolation, live-game destination and release link.`);


const studioBase=new URL('hollow-valley/',root);
for(const route of ['our-games/','hollow-valley/','primalbound/','merch/','news/','support/']) {
 const html=await readFile(new URL(route+'index.html',studioBase),'utf8');
 assert.match(html,/HOLLOW VALLEY/);
 assert.match(html,/PRIMALBOUND/i);
 assert.match(html,/href="\/merch\/"/);
}
const studioHome=await readFile(new URL('index.html',studioBase),'utf8');
assert.match(studioHome,/Two worlds\. One creative home/);
assert.match(studioHome,/href="\/hollow-valley\/"/);
assert.match(studioHome,/href="\/primalbound\/"/);
const merchPage=await readFile(new URL('merch/index.html',studioBase),'utf8');
assert.match(merchPage,/No orders/);
assert.match(merchPage,/mailto:/);
assert.match(merchPage,/Colouring Book Collection/);
assert.equal((merchPage.match(/class="merch-item"/g)||[]).length,6);
assert.doesNotMatch(merchPage,/<form|<script|<iframe|https:\/\/(?:checkout\.stripe\.com|buy\.stripe\.com)/i);
console.log('PASS: Studios routes, Hollow Valley/Primalbound cards and six merch concepts; no checkout or live integrations.');
