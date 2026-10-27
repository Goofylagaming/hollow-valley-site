import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const src=fileURLToPath(new URL('./wiki-source/',import.meta.url));
const out=fileURLToPath(new URL('./dist/primalbound/',import.meta.url));
const production=process.argv.includes('--production');
const archive=JSON.parse(await readFile(join(src,'release-archive.json'),'utf8'));
const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const plain=x=>String(x??'').replace(/\*\*/g,'').replace(/\x60/g,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
const slug=x=>String(x).toLowerCase().replace(/[^a-z0-9]+/g,'-');
const rank=x=>{const m=String(x).match(/^[WM](\d+)(?:\.(\d+))?$/);return m?Number(m[1])*1000+Number(m[2]||0):-1;};
for(const mode of ['web','world']){
 const arr=archive[mode];
 if(!Array.isArray(arr)||arr.length<3)throw Error('Missing archived releases: '+mode);
 const seen=new Set();
 for(const x of arr){if(rank(x.version)<0||seen.has(x.version)||typeof x.title!=='string'||!Array.isArray(x.notes)||!x.notes.length||x.notes.some(s=>typeof s!=='string'||!s.trim()))throw Error('Invalid archived release: '+x.version);seen.add(x.version);}
}
const webSource=await readFile(join(src,'web/wiki/index.html'),'utf8');
const worldSource=await readFile(join(src,'world/wiki/index.html'),'utf8');
const addNav=x=>x.replace('</nav>','<a href="/patch-notes/">Patch Notes</a></nav>');
const navHeader=(addNav(webSource).match(/<header class="site-header">[\s\S]*?<\/header>/)||[])[0]?.replace(/<button class="menu-btn"[\s\S]*?<\/button>/,'');
const footer=(webSource.match(/<footer class="footer">[\s\S]*?<\/footer>/)||[])[0];
if(!navHeader||!footer)throw Error('Wiki header/footer unavailable');
const ordered=mode=>archive[mode].slice().sort((a,b)=>rank(b.version)-rank(a.version));
function card(entry,hidden=false){
 const source=String(entry.source||'');
 const safe=/^https:\/\/github\.com\/Goofylagaming\/primalbound-downloads\/releases\/tag\//.test(source);
 return '<article '+(hidden?'hidden ':'')+'class="release-card" id="release-'+slug(entry.version)+'" data-release-key="'+esc(entry.version)+'" data-release-rank="'+rank(entry.version)+'"><p class="release-meta"><strong>'+esc(entry.version)+'</strong>'+(entry.published?' · <time datetime="'+esc(entry.published)+'">'+esc(entry.published)+'</time>':'')+'</p><h3>'+esc(plain(entry.title))+'</h3><ul>'+entry.notes.map(note=>'<li>'+esc(plain(note))+'</li>').join('')+'</ul>'+(safe?'<a class="release-source" href="'+esc(source)+'" rel="noopener noreferrer">Release source</a>':'')+'</article>';
}
function list(mode,limit=0){return '<div class="notes-list" data-release-list="'+mode+'"'+(limit?' data-limit="'+limit+'"':'')+'>'+ordered(mode).map((entry,i)=>card(entry,limit>0&&i>=limit)).join('\n')+'</div>';}
function frame(title,desc,url,main,dynamic=false){
 const base=url==='/patch-notes/'?'../':'../../';
 return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0c1110"><meta name="description" content="'+esc(desc)+'"><title>'+esc(title)+' | Primalbound</title><link rel="canonical" href="https://primalboundgame.com'+url+'"><link rel="stylesheet" href="'+base+'assets/wiki.css"><link rel="stylesheet" href="'+base+'assets/release-notes.css">'+(production?'':'<meta name="robots" content="noindex,nofollow">')+'</head><body><a class="skip-link" href="#main-content">Skip to content</a>'+navHeader+main+footer+(dynamic?'<script src="../../assets/release-notes.js" defer></script>':'')+'</body></html>\n';
}
function notesPage(mode){
 const label=mode==='web'?'Web':'World / Desktop';
 const desc=mode==='web'?'Verified browser-game updates, fixes and save changes.':'Published Windows playtest features, fixes and save compatibility.';
 const latest=ordered(mode)[0];
 const body='<main class="notes-page" id="main-content"><p class="eyebrow">Primalbound '+label+' · Release history</p><h1>'+label+' Patch Notes</h1><p class="portal-intro">'+desc+'</p><div class="notes-actions"><a class="btn" href="/'+mode+'/wiki/">Read the Player Guide</a><a class="btn secondary" href="/'+(mode==='web'?'world':'web')+'/patch-notes/">Other game patch notes</a></div><section class="release-area" data-release-area><label class="release-label" for="release-search">Search changes and versions</label><input id="release-search" type="search" class="search-input" data-release-search placeholder="Search patch notes…"><p class="feed-status" data-release-status role="status">Archived through '+esc(latest.version)+'; checking for newer published notes.</p>'+list(mode)+'</section><p class="notes-disclaimer">Web patch notes follow the verified Web Preview build. World patch notes follow published Windows releases. These games have separate saves and progression.</p></main>';
 return frame(label+' Patch Notes',desc,'/'+mode+'/patch-notes/',body,true);
}
function hub(){
 const cards=['web','world'].map(mode=>'<section class="portal-card"><p class="card-label">'+esc(ordered(mode)[0].version)+' · Latest archived</p><h2>Primalbound '+(mode==='web'?'Web':'World / Desktop')+'</h2><p>'+(mode==='web'?'Browser game updates, fixes, balance and save changes.':'Windows playtest releases, mechanics and save compatibility.')+'</p><div class="card-buttons"><a class="btn" href="/'+mode+'/patch-notes/">View Patch Notes</a><a class="btn secondary" href="/'+mode+'/wiki/">Player Guide</a></div></section>').join('');
 return frame('Primalbound Patch Notes','Web and World version history.','/patch-notes/','<main class="notes-page" id="main-content"><p class="eyebrow">Release history</p><h1>Primalbound Patch Notes</h1><p class="portal-intro">Choose your game to see verified updates and the current player guide.</p><div class="portal-grid">'+cards+'</div></main>',false);
}
function wiki(mode,source){
 const verified=mode==='web'
  ? source.match(/Latest verified Web Preview:\s*(W\d+(?:\.\d+)?)/)?.[1]
  : source.match(/published Primalbound World\/Desktop (M\d+(?:\.\d+)?)/i)?.[1];
 if(!verified||!archive[mode].some(x=>x.version===verified))throw Error('Wiki guide version is not archived: '+mode+' '+verified);
 let html=addNav(source),last=ordered(mode)[0],baseline=verified;
 if(mode==='web'){
  const previous=html;
  html=html.replace(/class="version-chip">(?:Web )?Preview W\d+(?:\.\d+)?(?: · full guide updated)?/,'class="version-chip">Web Preview '+esc(verified)+' · full guide updated');
  if(html===previous)throw Error('Missing Web wiki version badge');
 }
 const intro='<section class="release-area release-inline" data-release-area id="guide-release-updates"><div class="release-inline-heading"><p class="eyebrow">Updated gameplay instructions</p><h2>What changed in '+(mode==='web'?'Web':'World')+'</h2><p>Read these verified release changes alongside the detailed player guide. Release-specific instructions have been incorporated through '+baseline+' and should not be confused with newer gameplay updates.</p><p class="feed-status" data-release-status role="status">Archived through '+esc(last.version)+'; checking newer releases.</p></div>'+list(mode,3)+'<a class="btn secondary" href="/'+mode+'/patch-notes/">Read all '+(mode==='web'?'Web':'World')+' Patch Notes</a></section>';
 if(!html.includes('<div class="search-results"')||!html.includes('</body>'))throw Error('Unrecognized wiki HTML: '+mode);
 html=html.replace('<div class="search-results"',intro+'<div class="search-results"');
 html=html.replace('<p class="sidebar-title"','<a class="sidebar-patch-link" href="/'+mode+'/patch-notes/">Patch Notes</a><p class="sidebar-title"');
 html=html.replace('</head>','<link rel="stylesheet" href="../../assets/release-notes.css"></head>');
 html=html.replace('</body>','<script src="../../assets/release-notes.js" defer></script></body>');
 if(!production)html=html.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');
 return html;
}
const files=[
 ['web/wiki/index.html',wiki('web',webSource)],
 ['world/wiki/index.html',wiki('world',worldSource)],
 ['patch-notes/index.html',hub()],
 ['web/patch-notes/index.html',notesPage('web')],
 ['world/patch-notes/index.html',notesPage('world')]
];
for(const file of ['wiki.css','wiki.js','release-notes.css','release-notes.js'])files.push(['assets/'+file,await readFile(join(src,'assets',file),'utf8')]);
for(const [name,data] of files){const file=join(out,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,data,'utf8');}
console.log('Published two guide addenda, three patch-note routes and the read-only live release feed.');
