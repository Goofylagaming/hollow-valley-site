/* Admin-only support moderation interface; render all user text via textContent. */
(function () {
  "use strict";
  const { api,loadMe }=window.HDS;
  const $=id=>document.getElementById(id);
  let selected=null,busy=false;
  const names={open:"Open","awaiting-staff":"Awaiting staff","awaiting-player":"Awaiting player",resolved:"Resolved",closed:"Closed"};
  function node(tag,text,cls){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  }
  function time(input){
    const d=new Date(input);
    return input&&Number.isFinite(d.getTime()) ? d.toLocaleString("en-AU",{
      dateStyle:"medium",timeStyle:"short",timeZone:"Australia/Brisbane"
    })+" AEST":"Time unavailable";
  }
  function showLinks(container,values){
    const links=node("div",undefined,"hv-support-evidence");
    for(const value of Array.isArray(values)?values:[]){
      if(typeof value!=="string"||!/^https:\/\//.test(value))continue;
      const a=node("a","Evidence link ↗");
      a.href=value;a.target="_blank";a.rel="noopener noreferrer";
      links.append(a);
    }
    container.append(links);
  }
  function ticketList(rows){
    const host=$("hv-admin-support-list");host.replaceChildren();
    if(!rows.length){host.append(node("p","No tickets match the search."));return;}
    for(const t of rows){
      const article=node("article",undefined,"hv-support-ticket");
      const head=node("div",undefined,"hv-support-ticket-top");
      const stage=node("span",names[t.status]||"Unknown","hv-support-status");
      stage.dataset.status=t.status;
      head.append(node("strong",t.subject),stage);
      article.append(head,node("p",t.category+" · "+(t.reporterName||"Unknown")+" ("+t.reporterSteamId+") · "+time(t.updatedAt)));
      const button=node("button","Review ticket");
      button.type="button";
      button.addEventListener("click",()=>detail(t.id));
      article.append(button);host.append(article);
    }
  }
  async function loadQueue(){
    $("hv-admin-support-feedback").textContent="Loading private ticket queue…";
    try{
      const query=new URLSearchParams({
        status:$("hv-admin-support-status").value,
        q:$("hv-admin-support-search").value.trim().slice(0,100),
        limit:"100",
      });
      const data=await api("/api/support-tickets/admin?"+query);
      const rows=Array.isArray(data.tickets)?data.tickets:[];
      ticketList(rows);
      $("hv-admin-support-feedback").textContent=rows.length+" ticket(s) in this view.";
    }catch{
      $("hv-admin-support-feedback").textContent="Unable to load support queue.";
    }
  }
  function showThread(rows){
    const host=$("hv-admin-support-messages");host.replaceChildren();
    for(const m of rows){
      const item=node("article",undefined,"hv-support-message");
      item.dataset.author=m.authorRole||"player";
      item.dataset.private=m.internal===true?"true":"false";
      const head=node("div",undefined,"hv-support-message-head");
      head.append(
        node("strong",m.internal?"INTERNAL STAFF NOTE":m.authorRole==="staff"?"Staff response":"Player"),
        node("span",time(m.createdAt))
      );
      item.append(head,node("p",m.body||""));
      showLinks(item,m.evidenceUrls);
      host.append(item);
    }
  }
  function showAudit(rows){
    const host=$("hv-admin-support-audit");host.replaceChildren();
    for(const x of rows){
      const summary=x.details?.from&&x.details?.to ? " · "+x.details.from+" → "+x.details.to:"";
      host.append(node("p",time(x.createdAt)+" · "+x.action+summary+" · "+x.actorSteamId));
    }
    if(!rows.length)host.append(node("p","No moderation changes recorded."));
  }
  async function detail(id){
    try{
      const data=await api("/api/support-tickets/admin/"+encodeURIComponent(id));
      selected=data.ticket.id;
      $("hv-admin-support-detail").hidden=false;
      $("hv-admin-support-detail-heading").textContent=data.ticket.subject;
      $("hv-admin-support-detail-meta").textContent=
        (data.ticket.reporterName||"Unknown player")+" ("+data.ticket.reporterSteamId+") · "+
        data.ticket.category+" · Reference "+data.ticket.id;
      $("hv-admin-ticket-next-status").value=data.ticket.status;
      $("hv-admin-support-reply-form").hidden=data.ticket.status==="closed";
      $("hv-admin-support-note-form").hidden=data.ticket.status==="closed";
      showThread(data.messages||[]);
      showAudit(data.audit||[]);
      $("hv-admin-support-detail-feedback").textContent="Private staff moderation view.";
      $("hv-admin-support-detail").scrollIntoView({behavior:"smooth",block:"start"});
    }catch{$("hv-admin-support-detail-feedback").textContent="Unable to load this ticket.";}
  }
  async function write(url,body,success){
    if(busy||!selected)return;
    busy=true;
    $("hv-admin-support-detail-feedback").textContent="Saving…";
    try{
      const data=await api(url,{method:"POST",body:JSON.stringify(body)});
      await detail(selected);
      $("hv-admin-support-detail-feedback").textContent=success;
      await loadQueue();
      return data;
    }catch(e){$("hv-admin-support-detail-feedback").textContent=e.message||"Could not save change.";}
    finally{busy=false;}
  }
  async function init(){
    const me=await loadMe();
    const allowed=Boolean(me?.loggedIn&&me.user?.is_admin);
    $("hv-admin-support-guard").hidden=allowed;
    $("hv-admin-support-app").hidden=!allowed;
    if(!allowed)return;
    $("hv-admin-filter").addEventListener("submit",e=>{e.preventDefault();loadQueue();});
    $("hv-admin-support-reply-form").addEventListener("submit",async e=>{
      e.preventDefault();
      const body=$("hv-admin-support-reply").value.trim();
      const link=$("hv-admin-support-evidence").value.trim();
      const result=await write("/api/support-tickets/admin/"+encodeURIComponent(selected)+"/replies",
        {body,evidenceUrls:link?[link]:[]},"Response saved for the player.");
      if(result)$("hv-admin-support-reply-form").reset();
    });
    $("hv-admin-support-note-form").addEventListener("submit",async e=>{
      e.preventDefault();
      const result=await write("/api/support-tickets/admin/"+encodeURIComponent(selected)+"/replies",
        {body:$("hv-admin-support-note").value.trim(),internal:true},
        "Private staff note recorded.");
      if(result)$("hv-admin-support-note-form").reset();
    });
    $("hv-admin-support-status-form").addEventListener("submit",async e=>{
      e.preventDefault();
      await write("/api/support-tickets/admin/"+encodeURIComponent(selected)+"/status",
        {status:$("hv-admin-ticket-next-status").value},"Ticket status saved.");
    });
    await loadQueue();
  }
  const start=()=>init().catch(()=>{
    $("hv-admin-support-guard").hidden=false;$("hv-admin-support-app").hidden=true;
  });
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else start();
})();
