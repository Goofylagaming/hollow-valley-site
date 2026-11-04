/* Hollow Valley opt-in group recruitment; interest never auto-joins players. */
(function(){
  "use strict";
  const {api,loadMe}=window.HDS;
  const $=id=>document.getElementById(id);
  let selectedGroup=null,authenticated=false,mine=null;
  const styles={casual:"Casual",survival:"Survival",nesting:"Nesting",events:"Events",exploration:"Exploration"};
  const focus={any:"All species",herbivores:"Herbivores",carnivores:"Carnivores",omnivores:"Omnivores",mixed:"Mixed"};
  function node(tag,text,cls){
    const e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined)e.textContent=String(text);
    return e;
  }
  function time(input){
    const d=new Date(input);
    return input&&Number.isFinite(d.getTime()) ? d.toLocaleString("en-AU",{
      timeZone:"Australia/Brisbane",dateStyle:"medium",timeStyle:"short"
    })+" AEST":"Unverified date";
  }
  function card(group){
    const item=node("article",undefined,"hv-group-card");
    const status=group.full?" · FULL":"";
    item.append(node("small",(styles[group.style]||"Group")+" · "+(focus[group.focus]||"Any")+
      " · "+group.members+"/"+group.capacity+" members"+status),
    node("strong",group.groupName),node("p",group.description));
    if(authenticated&&!mine?.group&&!group.full){
      const btn=node("button","Send interest request");
      btn.type="button";
      btn.addEventListener("click",()=>{
        selectedGroup=group.groupId;
        $("hv-group-interest-form-panel").hidden=false;
        $("hv-group-interest-heading").textContent="Ask to join "+group.groupName;
        $("hv-group-interest-status").textContent=
          "The group owner will review your message. This does not issue an invitation.";
        $("hv-group-interest-form-panel").scrollIntoView({behavior:"smooth",block:"start"});
      });
      item.append(btn);
    }
    return item;
  }
  async function browse(){
    const query=new URLSearchParams({
      q:$("hv-group-search").value.trim().slice(0,100),
      style:$("hv-group-style").value,focus:$("hv-group-focus").value,limit:"100",
    });
    const host=$("hv-group-search-results");
    $("hv-group-search-status").textContent="Loading opt-in group listings…";
    try{
      const data=await api("/api/group-recruitment?"+query);
      const rows=Array.isArray(data.groups)?data.groups:[];
      host.replaceChildren();
      for(const group of rows)host.append(card(group));
      if(!rows.length)host.append(node("p","No groups match your search, or none have opted in to recruit."));
      $("hv-group-search-status").textContent=rows.length+" recruiting group(s). Member identities are not public.";
    }catch{
      $("hv-group-search-status").textContent="Recruitment listings are temporarily unavailable.";
      host.replaceChildren();
    }
  }
  function sendList(rows){
    const host=$("hv-group-sent");host.replaceChildren();
    for(const entry of rows){
      const box=node("article");
      box.append(node("strong",entry.groupName),
        node("p","Status: "+entry.status+" · Sent "+time(entry.createdAt)));
      if(entry.status==="pending"){
        const cancel=node("button","Cancel enquiry");
        cancel.type="button";
        cancel.addEventListener("click",async()=>{
          try{
            await api("/api/group-recruitment/me/interest/"+entry.id+"/cancel",{
              method:"POST",body:JSON.stringify({}),
            });await loadMine();await browse();
          }catch(e){$("hv-group-interest-status").textContent=e.message||"Could not cancel enquiry.";}
        });
        box.append(cancel);
      }
      host.append(box);
    }
    if(!rows.length)host.append(node("p","No interest requests submitted yet."));
  }
  function incomingList(rows){
    const host=$("hv-group-incoming");host.replaceChildren();
    for(const entry of rows){
      const box=node("article");
      box.append(node("strong",entry.applicantName+" · "+entry.applicantSteamId),
        node("p",entry.message),node("small","Sent "+time(entry.createdAt)));
      for(const decision of ["acknowledged","declined"]){
        const button=node("button",decision==="acknowledged"?"Mark reviewed":"Decline request");
        button.type="button";
        button.addEventListener("click",async()=>{
          try{
            await api("/api/group-recruitment/me/interest/"+entry.id+"/decision",{
              method:"POST",body:JSON.stringify({decision}),
            });$("hv-group-owner-status").textContent=decision==="acknowledged"
              ?"Request reviewed. Invite the player manually through My Groups if approved."
              :"Interest request declined.";
            await loadMine();await browse();
          }catch(e){$("hv-group-owner-status").textContent=e.message||"Could not review request.";}
        });
        box.append(button);
      }
      host.append(box);
    }
    if(!rows.length)host.append(node("p","No pending recruitment enquiries."));
  }
  async function loadMine(){
    if(!authenticated)return;
    try{
      const data=await api("/api/group-recruitment/me");
      mine=data;
      sendList(Array.isArray(data.sent)?data.sent:[]);
      const owner=Boolean(data.group?.owner);
      $("hv-group-owner-panel").hidden=!owner;
      if(owner){
        $("hv-group-owner-style").value=data.listing?.style||"casual";
        $("hv-group-owner-focus").value=data.listing?.focus||"any";
        $("hv-group-owner-description").value=data.listing?.description||"";
        $("hv-group-owner-active").checked=Boolean(data.listing?.active);
        incomingList(Array.isArray(data.incoming)?data.incoming:[]);
        $("hv-group-owner-status").textContent=data.group.name+" · "+
          data.group.memberCount+" / "+data.group.capacity+" members.";
      }
    }catch{
      $("hv-group-owner-status").textContent="Group management unavailable.";
    }
  }
  async function apply(event){
    event.preventDefault();
    if(!selectedGroup)return;
    const submit=$("hv-group-interest-form").querySelector("button");
    submit.disabled=true;
    try{
      await api("/api/group-recruitment/"+selectedGroup+"/interest",{
        method:"POST",body:JSON.stringify({message:$("hv-group-interest-message").value.trim()}),
      });
      $("hv-group-interest-status").textContent="Interest sent. The group owner will review it; you have not joined the group.";
      $("hv-group-interest-form").reset();
      $("hv-group-interest-form-panel").hidden=true;
      selectedGroup=null;
      await loadMine();
    }catch(e){
      $("hv-group-interest-status").textContent=e.message||"Your interest could not be submitted.";
    }finally{submit.disabled=false;}
  }
  async function saveListing(event){
    event.preventDefault();
    const button=$("hv-group-owner-form").querySelector("button");
    button.disabled=true;
    try{
      const body={
        active:$("hv-group-owner-active").checked,
        style:$("hv-group-owner-style").value,
        focus:$("hv-group-owner-focus").value,
        description:$("hv-group-owner-description").value.trim(),
      };
      await api("/api/group-recruitment/me",{method:"PUT",body:JSON.stringify(body)});
      $("hv-group-owner-status").textContent=body.active
        ?"Opt-in group listing saved and visible publicly."
        :"Recruitment disabled. The group's membership and history are untouched.";
      await loadMine();await browse();
    }catch(e){
      $("hv-group-owner-status").textContent=e.message||"Could not save recruitment listing.";
    }finally{button.disabled=false;}
  }
  async function init(){
    const me=await loadMe();
    authenticated=Boolean(me?.loggedIn&&/^\d{17}$/.test(String(me.user?.steam_id||"")));
    $("hv-group-guest").hidden=authenticated;
    $("hv-group-membership").hidden=!authenticated;
    $("hv-group-discovery-filter").addEventListener("submit",e=>{e.preventDefault();browse();});
    $("hv-group-style").addEventListener("change",browse);
    $("hv-group-focus").addEventListener("change",browse);
    $("hv-group-interest-form").addEventListener("submit",apply);
    $("hv-group-owner-form").addEventListener("submit",saveListing);
    if(authenticated)await loadMine();
    await browse();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();
