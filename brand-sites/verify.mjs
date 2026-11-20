import {readFile,readdir,stat} from 'node:fs/promises';
import {relative,resolve,join} from 'node:path';
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
      const hiddenShowcase=file.endsWith(join('labs','showcase-v6','index.html'))&&site==='hollow-valley';
      const daymark=site==='hollow-valley'&&file===join(base,'daymark','index.html');
      const staffCopy=site==='hollow-valley'&&['weekday','saturday'].some(v=>file===join(base,'daymark','staff',v,'index.html'));
      if(staffCopy){
        assert.doesNotMatch(html,/workbooks\/|\$[0-9]|Roster cost|Wage budget|demo\.js|data-desk|mailto:/i,'The staff copy must contain only the published shifts');
        assert.match(html,/noindex,nofollow/);
      }
      if(production && !hiddenShowcase && !staffCopy) {
        // The explicitly labelled static fallback may use the verified game/account origin.
        // All other Render preview links and staging indicators stay blocked.
        const approvedGameOrigin='https://primalbound-cloud-preview.onrender.com/';
        assert.doesNotMatch(html.replaceAll(approvedGameOrigin,'[approved-primalbound-game]'),/noindex|STAGING PREVIEW|onrender\.com/);
      }
      else {
        // Independently authored HVS demo pages are copied unchanged into the staging build.
        // The Primalbound staging preview and generated marketing/wiki pages must be noindexed;
        // do not pretend unrelated council/tradie/GigMatch demos received staging injection.
        const externalDemo=site==='hollow-valley'&&[
          join('council',''),join('tradie',''),join('gigmatch','')
        ].some(directory=>file.includes(directory));
        if(!externalDemo)assert.match(html,/noindex,nofollow/);
      }
      assert.match(html,/<h1>/);
      assert.match(html,/id="main(?:-content)?"/);
      const websitesOffer=site==='hollow-valley'&&file===join(base,'websites','index.html');
      if(websitesOffer){
        assert.match(html,/<form\b[^>]*\bid="hvs-form"/);
        assert.equal((html.match(/<form\b/gi)||[]).length,1,'The websites offer has one enquiry form');
        assert.doesNotMatch(html,/<iframe\b|DATABASE_URL|SESSION_SECRET/i);
      }else assert.doesNotMatch(html,/<form\b|<iframe\b|DATABASE_URL|SESSION_SECRET/i);
      const scripts=[...html.matchAll(/<script\b[^>]*>/gi)].filter(tag=>!/type=["']application\/ld\+json["']/i.test(tag[0]));
      if(scripts.length){
        const wiki=file.endsWith(join('wiki','index.html'));
        const notes=file.endsWith(join('patch-notes','index.html'))||(site==='primalbound'&&file===join(base,'patch-notes','web','index.html'));
        const merch=file.endsWith(join('merch','index.html'))&&site==='hollow-valley';
        const gigmatch=file.includes(join('gigmatch'))&&site==='hollow-valley';
        const hvsDemo=(file.includes(join('tradie'))||file.includes(join('council')))&&site==='hollow-valley';
        const showcase=hiddenShowcase;
        assert.ok(wiki||notes||merch||gigmatch||hvsDemo||showcase||daymark||websitesOffer,'Unapproved script on marketing page: '+file);
        const expected=websitesOffer?['<script>']:daymark?['<script src="./demo.js" defer>']:wiki
          ?['<script src="../../assets/wiki.js" defer>','<script src="../../assets/release-notes.js" defer>']
          :merch
            ?['<script defer src="/merch/app.js">']
            :gigmatch
              ?['<script>']
              :hvsDemo
                ?['<script>']
                :showcase
                ?['<script>']
                :['<script src="../../assets/release-notes.js" defer>'];
        assert.deepEqual(scripts.map(x=>x[0]).sort(),expected.sort(),'Only approved same-origin wiki/release scripts are allowed');
      }
      for(const [,url] of html.matchAll(/href="([^"]+)"/g)) {
        if(url.startsWith('#')){assert.ok(html.includes('id="'+url.slice(1)+'"'),file+': '+url);continue;}
        if(!url.startsWith('/'))continue;
        if(url.startsWith('/#')){const home=await readFile(resolve(base,'index.html'),'utf8');assert.ok(home.includes('id="'+url.slice(2)+'"'));continue;}
        const [pathname,fragment]=url.split('#');
        const cleanPath=pathname.split('?')[0];
        const target=resolve(base,'.'+cleanPath+(cleanPath.endsWith('/')?'index.html':''));
        if(fragment){const destination=await readFile(target,'utf8');assert.ok(destination.includes('id="'+fragment+'"'),file+': '+url);}
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
assert.match(web,/W43/);
assert.match(web,/W50/);
assert.match(web,/W44/);
assert.match(web,/Ancient Rift/);
assert.match(web,/Expedition World Map/);
assert.match(web,/Species Mastery/);
assert.match(web,/Breeding Project/);
assert.match(web,/Rift Legend/);
assert.match(web,/d783b3a4a148d5472eaeed1cf30e972fb4b6b64f9c79e99732b9750e98b62279/);
assert.match(web,/W50 verified save compatibility/);
assert.match(web,/format 30/);
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
assert.ok(world.includes('class="version-chip">Windows Playtest M36.7'),'World wiki badge not updated to published M36.7');
assert.match(world,/M36\.7/);
assert.match(world,/M36\.7 Mosswatch orientation/);
assert.match(world,/Play World/);
assert.match(world,/Ankylosaurus/);
assert.match(world,/schema 330 unchanged/);
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
const approvedGameLinks=['https://primalbound-cloud-preview.onrender.com/'];
assert.ok(approvedGameLinks.some(url=>intro.includes('href="'+url+'"')),'Unrecognized Web game destination');
if(production) assert.ok(intro.includes('href="https://primalbound-cloud-preview.onrender.com/"')&&intro.includes('Open hosted game fallback'),'Static fallback must be explicit and must not loop');
assert.ok(!intro.includes('href="https://primalboundgame.com/web/"'),'Web gateway must not redirect its Play button to itself');
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
 assert.ok(guide.includes('href="'+(label==='web'?'/patch-notes/web/':'/world/patch-notes/')+'"'),'Patch notes cross-link missing');
}
assert.ok(notesHome.includes('href="/patch-notes/web/"')&&notesHome.includes('href="/world/patch-notes/"'));
assert.ok(notesJs.includes('normalizeWeb')&&notesJs.includes('normalizeWorld'),'Live release listeners missing');
assert.ok(notesCss.includes('.release-card'),'Patch note styles missing');
const merchHome=await readFile(join(root,'hollow-valley','index.html'),'utf8');
assert.match(merchHome,/href="\/merch\/"/,'Studios navigation must link to /merch/');
const merchHtml=await readFile(join(root,'hollow-valley','merch','index.html'),'utf8');
assert.match(merchHtml,/HOLLOW VALLEY/);
assert.match(merchHtml,/Primalbound/i);
assert.match(merchHtml,/Fourthwall shop/i);
assert.match(merchHtml,/Colouring Book/i);
assert.equal((merchHtml.match(/class="product-card"/g)||[]).length,2,'Book 1 preview and Chromie Hoodie link must both be featured');
assert.equal((merchHtml.match(/class="preview-only">Preview only/g)||[]).length,0,'The active Book 1 listing must not show obsolete preview labels');
assert.match(merchHtml,/https:\/\/hvs-e-commerce-shop\.fourthwall\.com\//);
assert.doesNotMatch(merchHtml,/<form\b|<iframe\b|checkout\.stripe\.com|buy\.stripe\.com/i);
const merchJS=await readFile(join(root,'hollow-valley','merch','app.js'),'utf8');
const merchCSS=await readFile(join(root,'hollow-valley','merch','styles.css'),'utf8');
assert.match(merchJS,/getElementById\("year"\)/);
assert.match(merchCSS,/@media\(max-width:530px\)/);
assert.match(merchHtml,/Books 2–5, new hoodies/);
assert.match(merchHtml,/Hollow Valley Chromie Hoodie/);
assert.ok(merchHtml.includes('src="/merch/assets/chromie-hoodie-front-back.webp"'));
const chromieImage=await readFile(join(root,'hollow-valley','merch','assets','chromie-hoodie-front-back.webp'));
assert.equal(chromieImage.subarray(0,4).toString('ascii'),'RIFF');
assert.equal(chromieImage.subarray(8,12).toString('ascii'),'WEBP');
assert.ok(merchHtml.includes('href="https://hvs-e-commerce-shop.fourthwall.com/en-aud/products/hollow-valley-chromie-hoodie"'));
assert.match(merchHtml,/Price and availability on Fourthwall/);
assert.ok(merchHtml.includes('href="https://hollowvalleystudios-shop.fourthwall.com/products/primalbound-characters-dinosaur-adventures-vol-1"'));
assert.match(merchHtml,/20 dinosaur-themed colouring illustrations/);
assert.match(merchHtml,/download.*verification|delivery QA/i);
assert.match(merchHtml,/All other product development is paused/);
assert.doesNotMatch(merchHtml,/class="catalogue-tools"/);
console.log('PASS: '+count+' pages, wiki/patch notes, owner-provided Book 1 and Chromie Fourthwall links; other new products on hold.');

// The branded /web/* gateway serves gameplay; keep the public archive outside it.
const webNotesAlias=await readFile(join(base,'patch-notes/web/index.html'),'utf8');
assert.equal(webNotesAlias,webNotes,'Legacy static archive and gateway-safe route must stay identical');
assert.ok(webNotesAlias.includes('href="https://primalboundgame.com/patch-notes/web/"'),'Web archive canonical URL must avoid the game gateway');
assert.ok(!web.includes('href="/web/patch-notes/"')&&!notesHome.includes('href="/web/patch-notes/"'),'Published guide links must use the gateway-safe archive');

// Primary Web entrypoints must stay branded; the separate static fallback above is intentional.
for(const site of ['primalbound','hollow-valley']){
 const home=await readFile(join(root,site,'index.html'),'utf8');
 const playLinks=[...home.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*(?:Play on the web|Enter Primalbound Web|Play Primalbound Web)[^<]*)<\/a>/g)];
 assert.equal(playLinks.length,site==='primalbound'?2:1,'Missing expected Web play buttons');
 for(const [,url] of playLinks)assert.equal(url,'https://primalboundgame.com/web/','Primary Web play buttons must use the canonical branded route');
 assert.doesNotMatch(home,/href="https:\/\/primalbound-(?:web|cloud)-preview\.onrender\.com/,'Homepage must not send players directly to preview hostnames');
}

const hvs=resolve(root,'hollow-valley');
const setupCheckout='https://buy.stripe.com/dRm6oIffs4n1fdBc831oI00';
const publishedRoutes=[
 'https://hollowvalleystudios.com/',
 'https://hollowvalleystudios.com/websites/',
 'https://hollowvalleystudios.com/tradie/',
 'https://hollowvalleystudios.com/daymark/',
 'https://hollowvalleystudios.com/council/',
 'https://hollowvalleystudios.com/gigmatch/',
 'https://hollowvalleystudios.com/gigmatch/about/',
 'https://hollowvalleystudios.com/gigmatch/musician/',
 'https://hollowvalleystudios.com/gigmatch/venue/',
 'https://hollowvalleystudios.com/merch/'
];
const sitemap=await readFile(join(hvs,'sitemap.xml'),'utf8');
assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]),publishedRoutes,'Sitemap must list the live Hollow Valley routes');
const robots=await readFile(join(hvs,'robots.txt'),'utf8');
assert.equal(robots,production?'User-agent: *\nAllow: /\n\nSitemap: https://hollowvalleystudios.com/sitemap.xml\n':'User-agent: *\nDisallow: /\n');
assert.equal(await readFile(join(root,'primalbound','robots.txt'),'utf8'),production?'User-agent: *\nAllow: /\n':'User-agent: *\nDisallow: /\n');
await assert.rejects(stat(join(root,'primalbound','sitemap.xml')));
const stripeUrls=[];
async function scanPublished(dir){
 for(const name of await readdir(dir)){
  const file=resolve(dir,name),info=await stat(file);
  if(info.isDirectory()){await scanPublished(file);continue;}
  if(!/\.(html|js|css|xml|txt)$/.test(file))continue;
  const text=await readFile(file,'utf8');
  assert.doesNotMatch(text,/\+\s*GST|GST\s+included|\bGST\b/i,file+' must stay free of GST wording');
  stripeUrls.push(...[...text.matchAll(/https:\/\/(?:buy|checkout)\.stripe\.com\/[A-Za-z0-9]+/g)].map(match=>match[0]+'\n'+relative(hvs,file)));
 }
}
await scanPublished(hvs);
assert.deepEqual([...new Set(stripeUrls)],[setupCheckout+'\nwebsites/index.html'],'Only the AUD $500 setup Payment Link is published');
const websites=await readFile(join(hvs,'websites','index.html'),'utf8');
assert.match(websites,/content="Managed websites for Queensland tradies and local businesses:/);
assert.match(websites,/rel="canonical" href="https:\/\/hollowvalleystudios\.com\/websites\/"/);
assert.match(websites,/property="og:title" content="Managed Business Websites in Queensland \| Hollow Valley Studios"/);
assert.match(websites,/name="twitter:card" content="summary"/);
assert.match(websites,/Free demo · No meeting required/);
assert.match(websites,/No meeting required/);
assert.match(websites,/href="#hvs-enquire"/);
assert.match(websites,/id="hvs-pay-link" href="https:\/\/buy\.stripe\.com\/dRm6oIffs4n1fdBc831oI00" target="_blank" rel="noopener noreferrer"/);
const offerLd=JSON.parse(websites.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const businessTypes=[].concat(offerLd['@graph'][0]['@type']);
assert.deepEqual(businessTypes,['ProfessionalService','LocalBusiness','Organization']);
assert.equal(offerLd['@graph'][1].offers.price,'500.00');
assert.equal(offerLd['@graph'][1].offers.priceCurrency,'AUD');
assert.equal(offerLd['@graph'][1].offers.priceSpecification[1].price,'50.00');
const studioHome=await readFile(join(hvs,'index.html'),'utf8');
assert.match(studioHome,/rel="canonical" href="https:\/\/hollowvalleystudios\.com\/"/);
assert.match(studioHome,/property="og:site_name" content="Hollow Valley Studios"/);
assert.match(studioHome,/href="\/websites\/#hvs-enquire"/);
assert.doesNotMatch(studioHome,/buy\.stripe\.com|checkout\.stripe\.com/);
const homeLd=JSON.parse(studioHome.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert.ok([].concat(homeLd['@graph'][0]['@type']).includes('LocalBusiness'));
assert.match(await readFile(join(hvs,'daymark','index.html'),'utf8'),/Can we cover Saturday\?/);
assert.match(await readFile(join(hvs,'council','index.html'),'utf8'),/HVS Civic AI/);
if(production){
 const indexable=[];
 async function collectIndexable(dir){
  for(const name of await readdir(dir)){
   const file=resolve(dir,name),info=await stat(file);
   if(info.isDirectory()){await collectIndexable(file);continue;}
   if(!file.endsWith('.html'))continue;
   const rel=relative(hvs,file).replaceAll('\\','/');
   if(rel==='404.html')continue;
   const html=await readFile(file,'utf8');
   if(/noindex/i.test(html))continue;
   indexable.push('https://hollowvalleystudios.com/'+(rel==='index.html'?'':rel.replace(/index\.html$/,'')));
  }
 }
 await collectIndexable(hvs);
 assert.deepEqual(indexable.sort(),publishedRoutes.slice().sort(),'Sitemap must match every indexable Hollow Valley page');
}
console.log('PASS: Hollow Valley checkout, GST-free pricing, Open Graph and sitemap.');
