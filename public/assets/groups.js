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
  let progressRequest=0;
  function progressCard(item,kind){
    const target=Math.max(1,Number(item.target)||1);
    const progress=Math.max(0,Math.min(target,Number(item.progress)||0));
    const done=item.completed===true;
    const pct=Math.round(progress/target*100);
    const label=kind==="achievement"?"BADGE":"WEEKLY QUEST";
    return '<article class="groups-milestone'+(done?' is-complete':'')+'">'+
      '<div class="groups-milestone-head"><span class="groups-milestone-icon">'+(done?'★':kind==="achievement"?'◇':'✓')+'</span>'+
      '<div><small>'+label+'</small><h3>'+safe(item.title)+'</h3></div>'+
      '<span class="groups-milestone-xp">'+(done?'✓ EARNED':'+'+Number(item.xp||0)+' XP')+'</span></div>'+
      '<p>'+safe(item.description)+'</p>'+
      '<div class="groups-milestone-count"><strong>'+progress+' / '+target+'</strong><span>'+pct+'%</span></div>'+
      '<div class="groups-milestone-track"><i style="width:'+pct+'%"></i></div>'+
      '</article>';
  }
  async function refreshProgress(){
    const currentId=state?.current?.id;
    const n=++progressRequest;
    show("groups-progress-panel",Boolean(currentId));
    if(!currentId)return;
    try{
      const progress=await api("/api/groups/progress");
      if(n!==progressRequest||state?.current?.id!==currentId)return;
      if(progress.group?.id!==currentId)throw new Error("Your group membership changed. Refresh to reload achievements.");
      text("groups-xp-value",Number(progress.groupXp||0).toLocaleString("en-AU"));
      text("groups-achievements-count",progress.achievements.filter(x=>x.completed).length+" / "+progress.achievements.length+" earned");
      text("groups-quests-count",progress.quests.filter(x=>x.completed).length+" / "+progress.quests.length+" complete");
      const next=new Date(progress.resetAt);
      text("groups-quests-reset",Number.isFinite(next.getTime())?
        "Weekly reset: "+next.toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"long",hour:"numeric",minute:"2-digit",hour12:true})+" (Brisbane)":
        "Weekly reset: Monday midnight (Brisbane)");
      $("groups-achievements").innerHTML=progress.achievements.map(a=>progressCard(a,"achievement")).join("");
      $("groups-quests").innerHTML=progress.quests.map(a=>progressCard(a,"quest")).join("");
    }catch(error){
      if(n===progressRequest){
        $("groups-quests").innerHTML=empty("Unable to refresh quest progress: "+(error.message||"Try again later."));
      }
    }
  }  function render(){
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
    void refreshProgress();
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
    $("groups-player-search-form").addEventListener("submit",async event=>{
      event.preventDefault();
      const query=$("groups-player-search").value.trim();
      const results=$("groups-player-search-results");
      if(query.length<2){
        results.innerHTML=empty("Enter at least two letters from their Steam username or Steam ID.");
        return;
      }
      results.innerHTML=empty("Searching registered Hollow Valley accounts...");
      try{
        const response=await api("/api/friends/search?q="+encodeURIComponent(query));
        const players=Array.isArray(response.results)?response.results:[];
        results.innerHTML=players.length?players.map(player=>
          '<div class="groups-row">'+
          '<div class="groups-person"><span class="groups-avatar">'+safe((player.username||"H")[0].toUpperCase())+'</span>'+
          '<span><strong>'+safe(player.username||"Steam player")+'</strong><small>Steam linked · '+safe(player.steamId)+'</small></span></div>'+
          '<button type="button" class="primary-button green" data-action="invite-found" data-steam="'+safe(player.steamId)+'">Invite</button></div>'
        ).join(""):empty("No matching Steam-linked account was found on the live Hollow Valley website. Ask the player to open My Profile and link Steam, then search again.");
      }catch(error){
        results.innerHTML=empty(error.message||"Could not search existing accounts.");
      }
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
      if(kind==="invite-found")action("/invites",{steamId:target.dataset.steam});
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