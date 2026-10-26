import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('./dist/', import.meta.url));
const production=process.argv.includes('--production');
let count=0;
for (const site of ['primalbound','hollow-valley']) {
  const base=resolve(root,site);
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const file=resolve(dir,name),info=await stat(file);
      if (info.isDirectory()){await walk(file);continue;}
      if(!file.endsWith('.html'))continue;
      const html=await readFile(file,'utf8');
      if(production) assert.doesNotMatch(html,/noindex|STAGING PREVIEW|onrender\.com/);
      else assert.match(html,/noindex,nofollow/);
      assert.match(html,/<h1>/);
      assert.match(html,/id="main(?:-content)?"/);
      assert.doesNotMatch(html,/<form\b|<iframe\b|DATABASE_URL|SESSION_SECRET/i);
      const scripts=[...html.matchAll(/<script\b[^>]*>/gi)];
      if(scripts.length){
        assert.ok(file.endsWith(join('wiki','index.html')),'Scripts are only allowed on guide pages: '+file);
        assert.equal(scripts.length,1,'A wiki page must have only the approved external search script');
        assert.equal(scripts[0][0],'<script src="../../assets/wiki.js" defer>');
      }
      for(const [,url] of html.matchAll(/href="([^"]+)"/g)) {
        if(url.startsWith('#')){assert.ok(html.includes('id="'+url.slice(1)+'"'),file+': '+url);continue;}
        if(!url.startsWith('/'))continue;
        if(url.startsWith('/#')){const home=await readFile(resolve(base,'index.html'),'utf8');assert.ok(home.includes('id="'+url.slice(2)+'"'));continue;}
        const target=resolve(base,'.'+url+(url.endsWith('/')?'index.html':''));
        assert.ok(target.startsWith(base),'Unexpected link outside site');
        await stat(target);
      }
      count++;
    }
  }
  await walk(base);
}
const base=resolve(root,'primalbound');
const web=await readFile(join(base,'web/wiki/index.html'),'utf8');
const world=await readFile(join(base,'world/wiki/index.html'),'utf8');
const css=await readFile(join(base,'assets/wiki.css'),'utf8');
const js=await readFile(join(base,'assets/wiki.js'),'utf8');
assert.ok((web.match(/class="wiki-topic"/g)||[]).length>=44,'Missing Web chapters');
assert.ok((world.match(/class="wiki-topic"/g)||[]).length>=22,'Missing World chapters');
assert.match(web,/W26\.28/);
assert.match(world,/M36\.4/);
assert.match(web,/Hatchling Growth Attack bonus/);
assert.match(world,/Companion Armoury/);
assert.match(js,/renderResults/);
assert.match(css,/\.wiki-sidebar/);
for(const html of [web,world]) {
  assert.match(html,/id="wiki-search"/);
  const anchors=[...html.matchAll(/data-wiki-nav href="#([^"]+)"/g)].map(x=>x[1]);
  const sections=[...html.matchAll(/<section class="wiki-topic" id="([^"]+)"/g)].map(x=>x[1]);
  assert.deepEqual(anchors,sections,'Sidebar chapter anchors do not match guide sections');
}
const intro=await readFile(join(base,'web/index.html'),'utf8');
assert.ok(intro.includes('href="https://hollowvalleyisle.com/primalbound/"'), 'Web entry must retain the existing game URL until /web is a verified playable mount');
for (const site of ['primalbound','hollow-valley']) {
  const robots = await readFile(join(root,site,'robots.txt'),'utf8');
  assert.equal(robots, production?'User-agent: *\\nAllow: /\\n':'User-agent: *\\nDisallow: /\\n');
}
const worldIntro=await readFile(join(base,'world/index.html'),'utf8');
assert.match(worldIntro,/primalbound-downloads\/releases\/latest/);
console.log('PASS: '+count+' pages, complete wiki chapters, search, anchors, safe scripts, staging indexing and game/download links.');
