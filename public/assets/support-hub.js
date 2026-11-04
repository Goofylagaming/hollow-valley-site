/* Steam-linked player support: ticket data is never inserted as HTML. */
(function () {
  "use strict";
  const { api, loadMe }=window.HDS;
  const $=id=>document.getElementById(id);
  const statuses={
    open:"Open","awaiting-staff":"Awaiting staff",
    "awaiting-player":"Awaiting your reply",resolved:"Resolved",closed:"Closed",
  };
  let chosen=null,enabled=false,createNonce=null,busy=false;
  function node(tag,text,cls) {
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  }
  function at(iso) {
    const d=new Date(iso);
    return iso&&Number.isFinite(d.getTime()) ? d.toLocaleString("en-AU",{
      dateStyle:"medium",timeStyle:"short",timeZone:"Australia/Brisbane"
    })+" AEST" : "Time unknown";
  }
  function evidence(container,links) {
    if(!Array.isArray(links)||!links.length)return;
    const box=node("div",undefined,"hv-support-evidence");
    for(const url of links) {
      if(typeof url!=="string"||!/^https:\/\//.test(url))continue;
      const link=node("a","Evidence link ↗");
      link.href=url;link.rel="noopener noreferrer";link.target="_blank";
      box.append(link);
    }
    container.append(box);
  }
  function renderTickets(rows) {
    const list=$("hv-support-list");list.replaceChildren();
    if(!rows.length) {list.append(node("p","No support tickets submitted yet."));return;}
    for(const t of rows) {
      const card=node("article",undefined,"hv-support-ticket");
      const head=node("div",undefined,"hv-support-ticket-top");
      const title=node("strong",t.subject);
      const badge=node("span",statuses[t.status]||"Unverified","hv-support-status");
      badge.dataset.status=t.status;
      head.append(title,badge);
      const summary=node("p",(t.category||"General")+" · updated "+at(t.updatedAt));
      const button=node("button","View conversation");
      button.type="button";
      button.addEventListener("click",()=>openThread(t.id));
      card.append(head,summary,button);list.append(card);
    }
  }
  async function loadTickets() {
    try {
      const data=await api("/api/support-tickets/mine");
      const rows=Array.isArray(data.tickets)?data.tickets:[];
      renderTickets(rows);
      $("hv-support-list-status").textContent=rows.length+" ticket(s) in your history.";
    } catch {
      $("hv-support-list-status").textContent="Your support tickets could not be loaded.";
    }
  }
  function drawMessages(rows) {
    const host=$("hv-support-messages");host.replaceChildren();
    for(const message of rows) {
      const entry=node("article",undefined,"hv-support-message");
      entry.dataset.author=message.authorRole||"player";
      const header=node("div",undefined,"hv-support-message-head");
      header.append(
        node("strong",message.authorRole==="staff"?"Hollow Valley Staff":"You"),
        node("span",at(message.createdAt))
      );
      entry.append(header,node("p",message.body||""));
      evidence(entry,message.evidenceUrls);
      host.append(entry);
    }
    if(!rows.length)host.append(node("p","No messages recorded."));
  }
  async function openThread(id) {
    $("hv-support-thread-status").textContent="Loading conversation…";
    try {
      const data=await api("/api/support-tickets/mine/"+encodeURIComponent(id));
      chosen=data.ticket.id;
      $("hv-support-thread").hidden=false;
      $("hv-support-thread-title").textContent=data.ticket.subject;
      $("hv-support-thread-sub").textContent=(statuses[data.ticket.status]||data.ticket.status)+
        " · Reference "+data.ticket.id;
      drawMessages(data.messages||[]);
      const disabledReply=!enabled||data.ticket.status==="closed";
      $("hv-support-reply").hidden=disabledReply;
      $("hv-support-thread-status").textContent=disabledReply
        ? "New replies are unavailable on this ticket. Contact staff on Discord if urgent."
        : "Your reply is private to staff.";
      $("hv-support-thread").scrollIntoView({behavior:"smooth",block:"start"});
    }catch {
      $("hv-support-thread-status").textContent="Conversation unavailable.";
    }
  }
  async function create(event) {
    event.preventDefault();if(busy||!enabled)return;
    busy=true;const button=$("hv-ticket-create-btn");button.disabled=true;
    const content={
      category:$("hv-ticket-category").value,
      subject:$("hv-ticket-subject").value.trim(),
      body:$("hv-ticket-body").value.trim(),
      evidenceUrls:$("hv-ticket-evidence").value.trim()?[$("hv-ticket-evidence").value.trim()]:[],
      clientNonce:createNonce||(createNonce=crypto.randomUUID()),
    };
    $("hv-ticket-create-status").textContent="Submitting your private request…";
    try {
      const data=await api("/api/support-tickets",{method:"POST",body:JSON.stringify(content)});
      createNonce=null;
      $("hv-ticket-create").reset();
      $("hv-ticket-create-status").textContent="Ticket received. Reference: "+data.ticket.id;
      await loadTickets();
      await openThread(data.ticket.id);
    }catch(e) {
      $("hv-ticket-create-status").textContent=e.message||"Could not submit this request.";
    }finally {busy=false;button.disabled=false;}
  }
  async function reply(event) {
    event.preventDefault();if(busy||!chosen||!enabled)return;
    busy=true;const button=$("hv-support-reply-btn");button.disabled=true;
    const input={
      body:$("hv-support-reply-body").value.trim(),
      evidenceUrls:$("hv-support-reply-link").value.trim()?[$("hv-support-reply-link").value.trim()]:[],
    };
    $("hv-support-thread-status").textContent="Sending your reply…";
    try {
      const data=await api("/api/support-tickets/mine/"+encodeURIComponent(chosen)+"/replies",{
        method:"POST",body:JSON.stringify(input),
      });
      $("hv-support-reply").reset();
      drawMessages(data.messages||[]);
      $("hv-support-thread-status").textContent="Your reply has been saved for the staff team.";
      await loadTickets();
    }catch(e) {$("hv-support-thread-status").textContent=e.message||"Reply failed.";}
    finally {busy=false;button.disabled=false;}
  }
  async function init() {
    const me=await loadMe();
    const auth=Boolean(me?.loggedIn&&/^\d{17}$/.test(String(me.user?.steam_id||"")));
    $("hv-support-guest").hidden=auth;
    $("hv-support-app").hidden=!auth;
    if(!auth)return;
    try {
      const capabilities=await api("/api/support-tickets/capabilities");
      enabled=capabilities.enabled===true;
    }catch {enabled=false;}
    $("hv-support-disabled").hidden=enabled;
    $("hv-support-create-panel").hidden=!enabled;
    $("hv-support-create").addEventListener("submit",create);
    $("hv-support-reply").addEventListener("submit",reply);
    $("hv-support-refresh").addEventListener("click",loadTickets);
    await loadTickets();
    const id=new URLSearchParams(window.location.search).get("ticket");
    if(id&&/^[0-9a-f-]{36}$/i.test(id))await openThread(id);
  }
  const start=()=>init().catch(()=>{
    $("hv-support-guest").hidden=false;$("hv-support-app").hidden=true;
  });
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else start();
})();
