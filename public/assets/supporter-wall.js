"use strict";

const id=key=>document.getElementById(key);
async function request(path,body){
  const response=await fetch("/api/community-recognition/"+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});
  if(!response.ok) throw Error("Request unavailable. Check your sign-in and try again.");
  return response.headers.get("content-type")?.includes("application/json")?response.json():null;
}
async function wall(){
  const data=await request("wall");
  for(const [key,items] of [["wall",data.supporters.map(s=>s.alias)],["cards",data.entries.map(s=>s.alias+" · "+s.dinosaur)]]){
    id(key).replaceChildren(...items.map(label=>{const li=document.createElement("li");li.textContent=label;return li;}));
  }
  function media(row,parent){
    if(row.skin) parent.append(document.createTextNode(" · "+row.skin));
    if(row.screenshot){const link=document.createElement("a");link.href=row.screenshot;link.textContent=" View screenshot";link.rel="noreferrer";parent.append(link);}
  }
  data.entries.forEach((row,i)=>media(row,id("cards").children[i]));
}
function action(fn){return async event=>{event.preventDefault();try{await fn();}catch(e){id("status").textContent=e.message;}};}
id("submit").onsubmit=action(async()=>{
  await request("showcase",{...Object.fromEntries(new FormData(id("submit"))),optIn:true});
  id("status").textContent="Submitted for moderation.";await wall();
});
id("withdraw").onclick=action(async()=>{await request("showcase",{optIn:false});id("status").textContent="Card withdrawn.";await wall();});
id("founding").onclick=action(async()=>{await request("founding",{});id("status").textContent="Founding Subscriber badge and title added to your collection.";});
wall().catch(e=>id("status").textContent=e.message);
request("review").then(rows=>{
  id("reviews").hidden=false;
  for(const row of rows){
    const button=document.createElement("button");button.textContent="Approve "+row.alias+" · "+row.dinosaur;
    button.onclick=action(async()=>{await request("review",{userId:row.user_id,...row});button.remove();await wall();});
    id("reviews").append(button);
    if(row.screenshot){const link=document.createElement("a");link.href=row.screenshot;link.textContent=" Review screenshot";link.rel="noreferrer";id("reviews").append(link);}
    if(row.skin) id("reviews").append(document.createTextNode(" · "+row.skin));
  }
}).catch(()=>{});

fetch("/api/subscriber-community/public").then(async response=>{
  if(!response.ok)return;
  const data=await response.json();
  const section=document.createElement("section");
  for(const theme of data.themes){const p=document.createElement("p");p.textContent="Public weekend theme · "+theme.theme;section.append(p);}
  for(const skin of data.skins){const p=document.createElement("p");p.textContent=skin.skinId+" · "+skin.credit;section.append(p);}
  id("cards").after(section);
}).catch(()=>{});