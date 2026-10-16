(() => {
  "use strict";
  const { api, escapeHtml: safe }=window.HDS;
  const $=id=>document.getElementById(id);
  let steam=null, state=null;
  function text(id,value){const node=$(id);if(node)node.textContent=String(value);}
  function show(id,value){const node=$(id);if(node)node.hidden=!value;}
  function date(value){if(!value)return "Unknown date";const d=new Date(value.replace(" ","T")+"Z");return Number.isFinite(+d)?d.toLocaleDateString():value;}
  function empty(message){return '<p class="section-intro groups-empty">'+safe(message)+'</p>';}
  function alert(message,isError=false){
    const node=$("groups-alert");node.textContent=message;node.hidden=!message;
    node.classList.toggle("is-error",isError);
    if(message)node.scrollIntoView({block:"nearest",behavior:"smooth"});
  }
  function button(action,label,extra=""){return '<button type="button" class="small-button '+extra+'" data-action="'+safe(action)+'">'+safe(label)+'</button>';}
  function person(user){
    const owner=user.role==="owner";
    const username=safe(user.username||"Steam player");
    return '<div class="groups-person"><span class="groups-avatar">'+safe((user.username||"H")[0].toUpperCase())+'</span><span><strong>'+username+'</strong><small>Joined '+safe(date(user.joinedAt))+' · '+(owner?"Owner":"Member")+'</small></span></div>';
  }
  function render(){
    if(!state)return;
    const g=state.current,history=state.previous||[],invites=state.incoming||[];
    text("groups-total",g?"1":"0");text("groups-current-label",g?g.name:"Not in a group");
    text("groups-member-count",g?g.members.length:0);
    text("groups-invite-count",invites.length);
    text("groups-history-count",history.length);
    show("groups-current-panel",!!g);show("groups-create-panel",!g);
    if(g){
      const owner=g.ownerSteamId===steam;
      text("groups-name-title",g.name);text("groups-created","Created "+date(g.createdAt)+" · Website group");
      text("groups-capacity",g.members.length+" / "+g.capacity);
      text("groups-leave",owner?"Leave and transfer ownership":"Leave group");
      $("groups-members").innerHTML=g.members.map(u=>
        '<div class="groups-row">'+person(u)+(owner&&u.steamId!==steam?'<button type="button" class="small-button groups-danger" data-action="remove" data-steam="'+safe(u.steamId)+'">Remove</button>':"")+'</div>'
      ).join("");
      show("groups-owner-panel",owner);
      $("groups-sent").innerHTML=owner&&g.sentInvites.length?'<p class="groups-caption">PENDING SENT INVITES</p>'+g.sentInvites.map(u=>
        '<div class="groups-row"><span>'+safe(u.username)+' <small>('+safe(u.steamId)+')</small></span><button type="button" class="small-button" data-action="cancel" data-id="'+u.id+'">Cancel</button></div>'
      ).join(""):"";
    }
    $("groups-incoming").innerHTML=invites.length?invites.map(invite=>
      '<div class="groups-row"><span><strong>'+safe(invite.groupName)+'</strong><small>Invited by '+safe(invite.invitedBy)+' · '+safe(date(invite.createdAt))+'</small></span><span class="groups-actions">'+
      (g?"":'<button type="button" class="primary-button green" data-action="accept" data-id="'+invite.id+'">Accept</button>')+
      '<button type="button" class="small-button" data-action="decline" data-id="'+invite.id+'">Decline</button></span></div>'
    ).join(""):empty("No incoming group invitations.");
    const outcomes={left:"You left",removed:"Removed from group",disbanded:"Group disbanded"};
    $("groups-history").innerHTML=history.length?history.map(entry=>
      '<article class="groups-history-card"><div><strong>'+safe(entry.groupName)+'</strong><small>'+safe(date(entry.joinedAt))+' – '+safe(date(entry.leftAt))+'</small></div><span class="groups-outcome">'+safe(outcomes[entry.outcome]||entry.outcome)+'</span><small class="groups-past-members">Previous members: '+safe((entry.members||[]).join(", ")||"Unavailable")+'</small></article>'
    ).join(""):empty("Your previous groups will appear here once you leave or a group disbands.");
  }
  async function refresh(){
    state=await api("/api/groups");
    render();
  }
  async function action(path,body,confirmText){
    if(confirmText&&!window.confirm(confirmText))return;
    try{
      state=await api("/api/groups"+path,{method:"POST",body:JSON.stringify(body||{})});
      render();alert("Group updated.");
    }catch(error){alert(error.message||"Could not update group.",true);}
  }
  function wire(){
    $("groups-create-form").addEventListener("submit",async event=>{
      event.preventDefault();
      const name=$("groups-name").value.trim();
      if(!name)return;
      await action("/",{name});
    });
    $("groups-invite-form").addEventListener("submit",async event=>{
      event.preventDefault();
      const id=$("groups-steam-id").value.trim();
      if(!/^\d{17}$/.test(id)){alert("Enter a valid 17-digit Steam ID.",true);return;}
      await action("/invites",{steamId:id});
    });
    $("groups-leave").addEventListener("click",()=>action("/leave",{},"Leave this group? If you're the owner, ownership transfers automatically."));
    $("groups-disband").addEventListener("click",()=>action("/disband",{},"Disband this group for every member? This action cannot be undone."));
    $("groups-app").addEventListener("click",event=>{
      const target=event.target.closest("[data-action]");
      if(!target)return;
      const kind=target.dataset.action,id=target.dataset.id;
      if(["accept","decline"].includes(kind))action("/invites/"+encodeURIComponent(id)+"/"+kind);
      if(kind==="cancel")action("/invites/"+encodeURIComponent(id)+"/cancel");
      if(kind==="remove")action("/remove",{steamId:target.dataset.steam},"Remove this player from your group?");
    });
  }
  async function init(){
    const me=await window.HDS.loadMe();
    if(!me.loggedIn||!/^\d{17}$/.test(String(me.user?.steam_id||""))){
      show("groups-signin",true);show("groups-app",false);return;
    }
    steam=String(me.user.steam_id);
    show("groups-signin",false);show("groups-app",true);
    wire();
    try{await refresh();}catch(error){alert(error.message||"Groups could not load.",true);}
  }
  init();
})();