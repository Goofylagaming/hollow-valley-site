// Public, read-only release feeds. Never reads saves, tokens or account data.
(() => {
  "use strict";
  const lists=[...document.querySelectorAll("[data-release-list]")];
  if(!lists.length)return;
  const WEB_FEED="https://primalbound-web-preview.onrender.com/release-info.json";
  const WORLD_FEED="https://api.github.com/repos/Goofylagaming/primalbound-downloads/releases?per_page=75";
  const rank=value=>{const match=String(value).match(/^[WM](\d+)(?:\.(\d+))?$/i);return match?Number(match[1])*1000+Number(match[2]||0):-1;};
  const key=value=>String(value).toLowerCase().replace(/[^a-z0-9]+/g,"-");
  const allowedUrl=url=>typeof url==="string"&&(
    url.startsWith("https://github.com/Goofylagaming/primalbound-downloads/releases/tag/")||
    url==="https://primalbound-web-preview.onrender.com/release-info.json");
  const sectionFor=list=>list.closest("[data-release-area]")||list.parentElement;
  function showStatus(mode,message){
    for(const list of lists.filter(el=>el.dataset.releaseList===mode)){
      const status=sectionFor(list)?.querySelector("[data-release-status]");
      if(status)status.textContent=message;
    }
  }
  const makeCard=item=>{
    const card=document.createElement("article");
    card.className="release-card";
    card.id="release-"+key(item.version);
    card.dataset.releaseKey=item.version;
    card.dataset.releaseRank=String(rank(item.version));
    const heading=document.createElement("h3");
    heading.textContent=item.title;
    const meta=document.createElement("p");
    meta.className="release-meta";
    const version=document.createElement("strong");
    version.textContent=item.version;
    meta.append(version);
    if(item.published){
      const time=document.createElement("time");
      time.dateTime=item.published;
      time.textContent=item.published;
      meta.append(document.createTextNode(" · "),time);
    }
    const bullets=document.createElement("ul");
    for(const note of item.notes){
      const li=document.createElement("li");
      li.textContent=note;
      bullets.append(li);
    }
    card.append(meta,heading,bullets);
    if(allowedUrl(item.source)){
      const a=document.createElement("a");
      a.href=item.source;
      a.rel="noopener noreferrer";
      a.textContent="Release source";
      a.className="release-source";
      card.append(a);
    }
    return card;
  };
  function merge(mode,remote){
    const items=remote.filter(item=>rank(item.version)>=0&&item.notes.length);
    for(const list of lists.filter(el=>el.dataset.releaseList===mode)){
      const existing=new Map([...list.querySelectorAll("[data-release-key]")].map(x=>[x.dataset.releaseKey,x]));
      for(const item of items){if(!existing.has(item.version)){const card=makeCard(item);list.append(card);existing.set(item.version,card);}}
      const ordered=[...existing.values()].sort((a,b)=>Number(b.dataset.releaseRank||-1)-Number(a.dataset.releaseRank||-1));
      const limit=Number(list.dataset.limit)||0;
      ordered.forEach((card,i)=>{list.append(card);card.hidden=limit>0&&i>=limit;});
    }
  }
  const normalizeWeb=data=>{
    if(!data||typeof data.title!=="string"||!Array.isArray(data.notes)||data.notes.length<1||data.notes.length>40)return[];
    const version=(data.title.match(/\bW\d+(?:\.\d+)?\b/i)||[])[0]?.toUpperCase();
    if(!version||!data.notes.every(s=>typeof s==="string"&&s.trim()&&s.length<=240))return[];
    return [{version,title:data.title.slice(0,130),notes:data.notes,published:null,source:WEB_FEED}];
  };
  const normalizeWorld=payload=>{
    if(!Array.isArray(payload))return[];
    return payload.filter(x=>!x.draft&&!x.prerelease&&typeof x.tag_name==="string")
      .map(x=>{
        const match=x.tag_name.match(/^m(\d+)(?:-(\d+))?-build-\d+$/i);
        if(!match)return null;
        const version="M"+match[1]+(match[2]?"."+match[2]:"");
        const notes=String(x.body||"").split("\n").filter(line=>/^\s*[-*]\s+\S/.test(line))
          .map(line=>line.replace(/^\s*[-*]\s+/,"").trim()).filter(Boolean).slice(0,20);
        return {version,title:String(x.name||"Primalbound World "+version).slice(0,150),notes,published:String(x.published_at||"").slice(0,10),source:typeof x.html_url==="string"?x.html_url:""};
      }).filter(Boolean);
  };
  async function fetchFeed(mode){
    const url=mode==="web"?WEB_FEED:WORLD_FEED;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{cache:"no-store",signal:controller.signal,headers:{Accept:"application/json"}});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const data=await response.json();
      const fresh=mode==="web"?normalizeWeb(data):normalizeWorld(data);
      if(!fresh.length)throw new Error("No valid published notes");
      merge(mode,fresh);
      const latest=fresh.reduce((best,x)=>rank(x.version)>rank(best)?x.version:best,mode==="web"?"W0":"M0");
      showStatus(mode,"Latest verified "+(mode==="web"?"Web Preview":"published World")+" notes checked: "+latest+".");
    }catch{
      showStatus(mode,"Live update check unavailable; showing the last archived release notes.");
    }finally{clearTimeout(timeout);}
  }
  const search=document.querySelector("[data-release-search]");
  if(search){search.addEventListener("input",()=>{
    const query=search.value.trim().toLowerCase();
    for(const list of lists){
      for(const card of list.querySelectorAll(".release-card")){
        card.hidden=!!query&&!card.textContent.toLowerCase().includes(query);
      }
    }
  });}
  [...new Set(lists.map(x=>x.dataset.releaseList))].filter(x=>x==="web"||x==="world").forEach(fetchFeed);
})();
