/* Staff-confirmed event results publisher. Does not award prizes. */
(function(){
  "use strict";
  const {api,loadMe}=window.HDS;
  const $=id=>document.getElementById(id);
  let busy=false;
  async function submit(event){
    event.preventDefault();
    if(busy)return;
    const when=new Date($("hv-event-time").value);
    if(!Number.isFinite(when.getTime())){
      $("hv-admin-event-feedback").textContent="Enter a valid completed event date.";
      return;
    }
    if($("hv-event-confirm").value!=="PUBLISH"){
      $("hv-admin-event-feedback").textContent='Type PUBLISH exactly before releasing this public result.';
      return;
    }
    const names=$("hv-event-winners").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(names.length>5){
      $("hv-admin-event-feedback").textContent="Choose at most five winner display names.";
      return;
    }
    const form={
      eventKey:$("hv-event-key").value.trim(),
      title:$("hv-event-title").value.trim(),
      eventAt:when.toISOString(),
      summary:$("hv-event-summary").value.trim(),
      winners:names,confirm:"PUBLISH",
    };
    busy=true;$("hv-event-submit").disabled=true;
    $("hv-admin-event-feedback").textContent="Publishing staff-confirmed result…";
    try{
      const result=await api("/api/community-activity/admin/event-results",{
        method:"POST",body:JSON.stringify(form),
      });
      $("hv-admin-event-result").reset();
      $("hv-admin-event-feedback").textContent="Published "+result.result.title+
        " as a manual staff summary. No Valley Coin payments or game actions were triggered.";
    }catch(e){
      $("hv-admin-event-feedback").textContent=e.message||"Event result could not be published.";
    }finally{busy=false;$("hv-event-submit").disabled=false;}
  }
  async function init(){
    const me=await loadMe();
    const admin=Boolean(me?.loggedIn&&me.user?.is_admin);
    $("hv-admin-activity-guard").hidden=admin;
    $("hv-admin-activity-content").hidden=!admin;
    if(!admin)return;
    $("hv-admin-event-result").addEventListener("submit",submit);
  }
  const start=()=>init().catch(()=>{
    $("hv-admin-activity-guard").hidden=false;
    $("hv-admin-activity-content").hidden=true;
  });
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else start();
})();
