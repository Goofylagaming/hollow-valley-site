import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('./dist/',import.meta.url);
let count=0;
for(const site of ['primalbound','hollow-valley']){
 const base=resolve(root.pathname.replace(/^\/([A-Za-z]:)/,'$1'),site);
 async function walk(dir){for(const file of await readdir(dir)){const path=resolve(dir,file);if((await stat(path)).isDirectory()){await walk(path);continue;}if(!file.endsWith('.html'))continue;
 const html=await readFile(path,'utf8');assert.match(html,/noindex,nofollow/);assert.match(html,/<h1>/);assert.match(html,/id="main(?:-content)?"/);
 assert.doesNotMatch(html,/<form\b|<iframe\b|DATABASE_URL|SESSION_SECRET/i);
 const scripts=[...html.matchAll(/<script\b[^>]*>/gi)].map(x=>x[0]);
 if(path.endsWith('/merch/index.html')) {
   assert.deepEqual(scripts,['<script defer src="/merch/app.js">'],'Only the local merch filter script is allowed');
 }else{
   assert.equal(scripts.length,0,'Unexpected script in static site: '+path);
 }
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
assert.match(merchPage,/Fourthwall shop/i);
assert.match(merchPage,/Colouring Book/i);
assert.equal((merchPage.match(/class="product-card"/g)||[]).length,2);
assert.equal((merchPage.match(/class="preview-only">Preview only/g)||[]).length,1);
assert.match(merchPage,/href="https:\/\/hvs-e-commerce-shop\.fourthwall\.com\//);
assert.doesNotMatch(merchPage,/<form\b|<iframe\b|https:\/\/(?:checkout\.stripe\.com|buy\.stripe\.com)/i);
const merchJs=await readFile(new URL('merch/app.js',studioBase),'utf8');
const merchCss=await readFile(new URL('merch/styles.css',studioBase),'utf8');
assert.match(merchJs,/getElementById\("year"\)/);
assert.match(merchCss,/@media\(max-width:530px\)/);
assert.match(merchPage,/All other product development is paused/);
assert.match(merchPage,/Books 2–5, new hoodies/);
assert.match(merchPage,/Hollow Valley Chromie Hoodie/);
assert.ok(merchPage.includes('src="/merch/assets/chromie-hoodie-front-back.webp"'));
const chromieAsset=await readFile(new URL('merch/assets/chromie-hoodie-front-back.webp',studioBase));
assert.equal(chromieAsset.subarray(0,4).toString('ascii'),'RIFF');
assert.equal(chromieAsset.subarray(8,12).toString('ascii'),'WEBP');
assert.ok(merchPage.includes('href="https://hvs-e-commerce-shop.fourthwall.com/en-aud/products/hollow-valley-chromie-hoodie"'));
assert.match(merchPage,/Price and availability on Fourthwall/);
assert.match(merchPage,/Book 1 is not yet for sale/);
console.log('PASS: Studios routes, Book 1 preview and existing Chromie Hoodie direct link, other new products paused.');
