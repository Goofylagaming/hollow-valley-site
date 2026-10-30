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
        const wiki=file.endsWith(join('wiki','index.html'));
        const notes=file.endsWith(join('patch-notes','index.html'));
        const merch=file.endsWith(join('merch','index.html'))&&site==='hollow-valley';
        assert.ok(wiki||notes||merch,'Unapproved script on marketing page: '+file);
        const expected=wiki
          ?['<script src="../../assets/wiki.js" defer>','<script src="../../assets/release-notes.js" defer>']
          :merch
            ?['<script defer src="/merch/app.js">']
            :['<script src="../../assets/release-notes.js" defer>'];
        assert.deepEqual(scripts.map(x=>x[0]).sort(),expected.sort(),'Only approved same-origin wiki/release scripts are allowed');
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
const webSource=await readFile(new URL('./wiki-source/web/wiki/index.html',import.meta.url),'utf8');
const verifiedWebVersion=webSource.match(/Latest verified Web Preview:\s*(W\d+(?:\.\d+)?)/)?.[1];
assert.ok(verifiedWebVersion,'Missing independently verified Web guide version');
assert.ok(web.includes('class="version-chip">Web Preview '+verifiedWebVersion+' · full guide updated'),'Web wiki badge does not match detailed player guide');
assert.ok(web.includes('guide documents the verified Web Preview through '+verifiedWebVersion),'Web wiki introduction is stale');
assert.ok(web.includes('Release-specific instructions have been incorporated through '+verifiedWebVersion),'Published Web guide coverage is stale');
const world=await readFile(join(base,'world/wiki/index.html'),'utf8');
const css=await readFile(join(base,'assets/wiki.css'),'utf8');
const js=await readFile(join(base,'assets/wiki.js'),'utf8');
assert.ok((web.match(/class="wiki-topic"/g)||[]).length>=44,'Missing Web chapters');
assert.ok((world.match(/class="wiki-topic"/g)||[]).length>=22,'Missing World chapters');
assert.match(web,/W26\.28/);
assert.match(web,/W34\.1/);
assert.match(web,/W35\.0/);
assert.match(web,/W36\.0/);
assert.match(web,/W38\.0/);
assert.match(web,/W40\.5/);
assert.match(web,/W42/);
assert.match(web,/format 29/);
assert.match(web,/Pack Bonds/);
assert.match(web,/Prime Forge/);
assert.match(web,/W27\.1/);
assert.match(web,/Load Local Account Copy/);
assert.match(web,/format 23/);
assert.match(web,/Regional Outlooks/);
assert.match(web,/format 18/);
assert.match(web,/Trophy Hall/);
assert.match(web,/Unified Expedition Journal/);
assert.match(web,/format 16 unchanged/);
assert.match(web,/manual collection|collect manually|manually collected/);
assert.match(web,/15 → 16/);
assert.match(web,/Moss-Crowned Colossus/);
assert.match(web,/9–13 stamina/);
assert.match(world,/M36\.4/);
assert.match(world,/M36\.5/);
assert.match(world,/M36\.6/);
assert.match(world,/19 different species/);
assert.match(world,/Pteranodon/);
assert.ok(world.includes('class="version-chip">Windows Playtest M36.6'),'World wiki badge not updated to published M36.6');
assert.match(world,/Mini Rex/);
assert.match(world,/schema 330 unchanged/);
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
const approvedGameLinks=['https://primalboundgame.com/web/','https://hollowvalleyisle.com/primalbound/'];
assert.ok(approvedGameLinks.some(url=>intro.includes('href="'+url+'"')),'Unrecognized Web game destination');
if(production) assert.ok(intro.includes('href="https://primalboundgame.com/web/"'),'Production must use the current branded Web destination');
const worldIntro=await readFile(join(base,'world/index.html'),'utf8');
assert.match(worldIntro,/primalbound-downloads\/releases\/latest/);
const notesHome=await readFile(join(base,'patch-notes/index.html'),'utf8');
const webNotes=await readFile(join(base,'web/patch-notes/index.html'),'utf8');
const worldNotes=await readFile(join(base,'world/patch-notes/index.html'),'utf8');
const notesJs=await readFile(join(base,'assets/release-notes.js'),'utf8');
const notesCss=await readFile(join(base,'assets/release-notes.css'),'utf8');
for(const [notes,label,expectedVersion] of [[webNotes,'web','W31'],[worldNotes,'world','M36.4']]){
 assert.match(notes,new RegExp(expectedVersion.replace('.','\\.')),'Missing release '+expectedVersion);
 assert.ok(notes.includes('data-release-list="'+label+'"'));
 assert.ok(notes.includes('href="/'+label+'/wiki/"'),'Missing guide cross-link');
}
for(const [guide,label] of [[web,'web'],[world,'world']]){
 assert.ok(guide.includes('data-release-list="'+label+'"'),'Guide release updates missing');
 assert.ok(guide.includes('href="/'+label+'/patch-notes/"'),'Patch notes cross-link missing');
}
assert.ok(notesHome.includes('href="/web/patch-notes/"')&&notesHome.includes('href="/world/patch-notes/"'));
assert.ok(notesJs.includes('normalizeWeb')&&notesJs.includes('normalizeWorld'),'Live release listeners missing');
assert.ok(notesCss.includes('.release-card'),'Patch note styles missing');
const merchHome=await readFile(join(root,'hollow-valley','index.html'),'utf8');
assert.match(merchHome,/href="\\/merch\\/"/,'Studios navigation must link to /merch/');
const merchHtml=await readFile(join(root,'hollow-valley','merch','index.html'),'utf8');
assert.match(merchHtml,/HOLLOW VALLEY/);
assert.match(merchHtml,/Primalbound/i);
assert.match(merchHtml,/Fourthwall shop/i);
assert.match(merchHtml,/Colouring Book/i);
assert.equal((merchHtml.match(/class="product-card"/g)||[]).length,6,'Exactly six preview concepts');
assert.equal((merchHtml.match(/class="preview-only">Preview only/g)||[]).length,6,'No cards are purchasable yet');
assert.match(merchHtml,/https:\\/\\/hvs-e-commerce-shop\\.fourthwall\\.com\\//);
assert.doesNotMatch(merchHtml,/<form\\b|<iframe\\b|checkout\\.stripe\\.com|buy\\.stripe\\.com/i);
const merchJS=await readFile(join(root,'hollow-valley','merch','app.js'),'utf8');
const merchCSS=await readFile(join(root,'hollow-valley','merch','styles.css'),'utf8');
assert.match(merchJS,/applyFilters/);
assert.match(merchCSS,/@media\\(max-width:530px\\)/);
console.log('PASS: '+count+' pages, wiki/patch notes, safe merch previews, navigation and local product filter scripts.');
