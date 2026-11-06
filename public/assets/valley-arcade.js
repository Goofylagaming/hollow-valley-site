"use strict";
const byId=id=>document.getElementById(id);
async function api(path,body){
  const res=await fetch("/api/valley-arcade/"+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});
  if(!res.ok) throw new Error("Arcade unavailable. Sign in and try again when the arcade is open.");
  return res.json();
}
async function scores(){
  const rows=await api("leaderboard");
  byId("scores").replaceChildren(...rows.map(row=>{
    const item=document.createElement("li");item.textContent=row.score+" points";return item;
  }));
}
function showError(e){byId("status").textContent=e.message;}
scores().then(()=>{byId("games").hidden=false;byId("status").textContent="";}).catch(showError);
byId("start").onclick=async()=>{
  const area=byId("round");area.replaceChildren();byId("start").disabled=true;
  try{
    const round=await api("start",{game:byId("game").value});
    byId("status").textContent=round.preview||round.prompt;
    if(round.preview||round.game==="reaction") await new Promise(resolve=>setTimeout(resolve,Math.max(0,round.opens-Date.now())));
    byId("status").textContent=round.game==="reaction"?"Green!":round.prompt;
    const selected=[];
    for(const choice of round.choices){
      const button=document.createElement("button");button.textContent=choice;
      button.onclick=async()=>{
        let answer=choice;
        if(round.game==="memory-match"){
          selected.push(choice);button.disabled=true;
          if(selected.length<2)return;
          answer=selected.sort().join(",");
        }
        area.replaceChildren();
        try{
          const result=await api("answer",{id:round.id,choice:answer});
          byId("status").textContent=result.score+" points · "+result.payout+" Valley Coins";await scores();
        }catch(e){showError(e);}finally{byId("start").disabled=false;}
      };area.append(button);
    }
  }catch(e){showError(e);byId("start").disabled=false;}
};
