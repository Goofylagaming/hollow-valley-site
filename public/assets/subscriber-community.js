"use strict";
const el = id => document.getElementById(id);
async function api(path, body) {
  const response = await fetch(`/api/subscriber-community${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "Request unavailable"); return value;
}
const run = fn => async event => { event?.preventDefault(); try { await fn(); } catch (e) { el("status").textContent = e.message; } };
el("suggest").addEventListener("submit", run(async () => { await api("/suggestions", { text: el("suggestion").value }); el("status").textContent = "Your suggestion is saved for staff review."; }));
let reviewed = null;
el("post").addEventListener("input", () => { reviewed = null; el("queue").disabled = true; });
el("post").addEventListener("submit", run(async () => { const input = { kind: el("kind").value, text: el("copy").value }; const p = await api("/admin/posts", input); el("preview").textContent = p.content; reviewed = input; el("queue").disabled = false; }));
el("queue").addEventListener("click", run(async () => { if (!reviewed) return; const p = await api("/admin/posts", { ...reviewed, dryRun: false }); el("status").textContent = p.duplicate ? "This post is already queued." : "Post queued."; el("queue").disabled = true; await load(); }));
el("monthly").addEventListener("click", run(async () => { const p = await api("/admin/monthly", {}); el("preview").textContent = p.map(x => x.content).join("\n\n"); el("queue-monthly").disabled = false; }));
el("queue-monthly").addEventListener("click", run(async () => { await api("/admin/monthly", { dryRun: false }); el("queue-monthly").disabled = true; await load(); }));
el("deliver").addEventListener("click", run(async () => { const p = await api("/admin/deliver", {}); el("status").textContent = p.dryRun ? "Dry-run mode: no Discord messages sent." : `Delivered ${p.delivered} posts.`; await load(); }));
async function load() {
  const state = await api("/admin"); el("admin").hidden = false; el("delivery").textContent = JSON.stringify(state.posts, null, 2); el("suggestions").replaceChildren();
  for (const item of state.suggestions) { const row = document.createElement("article"); const text = document.createElement("p"); text.textContent = `${item.text} (${item.status})`; row.append(text);
    const transitions={submitted:["shortlisted","declined"],shortlisted:["voting","declined"],voting:["selected","declined"],selected:["planned","declined"],planned:["released","declined"]};
    const choices=state.participation?(transitions[item.status]||[]):["shortlisted","closed"];
    const option=document.createElement("input");
    if(state.participation && item.status==="shortlisted"){option.type="number";option.placeholder="Website ballot option ID";row.append(option);}
    for(const status of choices){
      const button=document.createElement("button");button.textContent=status;
      button.addEventListener("click",run(async()=>{
        if(state.participation) await api("/admin/suggestions/"+item.id+"/review",{stage:status,optionId:Number(option.value)||null});
        else await api("/admin/suggestions/"+item.id,{status});
        await load();
      }));row.append(button);
    }
    el("suggestions").append(row);
  }
}
load().catch(() => { /* Member suggestion form remains available. */ });
