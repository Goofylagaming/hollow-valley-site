import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./dist/hollow-valley/labs/showcase-v6/', import.meta.url));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HVS Showcase — Hosted Interactive Demo</title>
<style>
:root{color-scheme:dark;--bg:#08111d;--panel:#111d30;--panel2:#172741;--line:#2d4566;--ink:#f6f8fb;--muted:#9fb1c7;--green:#51d7a6;--blue:#6cb7ff;--red:#ff7885;--amber:#ffcc70}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 0 0,#123b37 0,transparent 30%),var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}button,input,select{font:inherit}button{cursor:pointer;min-height:44px}.wrap{max-width:1180px;margin:auto;padding:24px}.eyebrow{color:var(--green);font-size:12px;letter-spacing:.15em;text-transform:uppercase}h1{font-size:clamp(34px,6vw,70px);line-height:1;margin:10px 0 14px}p{color:var(--muted)}.notice{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel);margin:14px 0}.tabs,.actions{display:flex;gap:8px;flex-wrap:wrap}.tabs{position:sticky;top:0;background:rgba(8,17,29,.96);padding:12px 0;z-index:5}.tabs button,.actions button{border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:9px 13px;border-radius:10px}.tabs button.active,.actions button.primary{background:var(--green);color:#07140f;border-color:var(--green);font-weight:800}.actions button.danger{color:#ffb1b8;border-color:#7a3942}.panel{display:none;margin-top:18px}.panel.active{display:block}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}.card h2,.card h3{margin-top:0}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.stat{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px}.stat small{display:block;color:var(--muted)}.stat strong{font-size:24px}.row{padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);margin:8px 0}.status{display:inline-block;padding:4px 8px;border-radius:999px;background:#203755;color:#bdddff;font-size:12px;font-weight:800}.status.good{background:#183c31;color:#9af0c8}.status.hot{background:#49232a;color:#ffb0b8}.log{max-height:260px;overflow:auto}.log div{border-bottom:1px solid var(--line);padding:8px 0;color:var(--muted)}input,select{width:100%;background:#0b1727;border:1px solid var(--line);color:var(--ink);padding:10px;border-radius:8px}.field{margin:9px 0}.field label{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}.hint{font-size:12px;color:var(--muted)}@media(max-width:760px){.grid,.stats{grid-template-columns:1fr}.wrap{padding:16px}.tabs{position:static}}
</style>
</head>
<body>
<main id="main" class="wrap">
<div class="eyebrow">Temporary internal demo · hosted test</div>
<h1>HVS Showcase</h1>
<p>This hidden route exists to test the interactive behaviour over HTTPS. Nothing here connects to production customer, council, game or payment data.</p>
<div class="notice"><strong>Hosted build:</strong> <span id="version">v6.2-hosted</span> · <strong>State:</strong> <span id="globalState">Ready</span></div>
<div class="tabs" aria-label="Demo products">
<button type="button" class="active" data-tab="gig">GigMatch</button>
<button type="button" data-tab="council">Council Triage</button>
<button type="button" data-tab="tradie">Tradie Assistant</button>
<button type="button" data-tab="debug">Debug / Activity</button>
</div>

<section id="gig" class="panel active">
<div class="stats"><div class="stat"><small>Artists</small><strong id="gArtists">4</strong></div><div class="stat"><small>Offers</small><strong id="gOffers">0</strong></div><div class="stat"><small>Counter</small><strong id="gCounter">$0</strong></div><div class="stat"><small>Bookings</small><strong id="gBookings">0</strong></div></div>
<div class="grid">
<div class="card"><h2>Venue search</h2><div class="field"><label>Genre</label><select id="gGenre"><option>Acoustic</option><option>Country</option><option>Pop</option></select></div><div class="field"><label>Budget</label><select id="gBudget"><option value="400">$400</option><option value="500" selected>$500</option><option value="700">$700</option></select></div><div class="actions"><button type="button" class="primary" id="gSearch">Search available artists</button><button type="button" id="gReset">Reset GigMatch</button></div><div id="gResults"></div></div>
<div class="card"><h2>Offer workflow</h2><div id="gOfferBox" class="row">No offer yet.</div><div class="actions"><button type="button" id="gCounterBtn">Musician: Counter +$50</button><button type="button" id="gAcceptBtn">Venue: Accept counter</button></div><p class="hint">Search → Send offer → Counter → Accept. Each button visibly changes the state.</p></div>
</div>
</section>

<section id="council" class="panel">
<div class="stats"><div class="stat"><small>Requests</small><strong id="cRequests">0</strong></div><div class="stat"><small>Critical</small><strong id="cCritical">0</strong></div><div class="stat"><small>Assigned</small><strong id="cAssigned">0</strong></div><div class="stat"><small>Resolved</small><strong id="cResolved">0</strong></div></div>
<div class="grid">
<div class="card"><h2>Create request</h2><div class="field"><label>Issue</label><select id="cIssue"><option value="Sparking power point|Critical|Electrical">Sparking power point</option><option value="Public toilet overflowing|Urgent|Plumbing">Public toilet overflowing</option><option value="Facility lights out|Routine|Electrical">Facility lights out</option></select></div><div class="field"><label>Location</label><select id="cLocation"><option>Riverside Community Centre</option><option>Meadow Park Public Toilets</option><option>Lakeside Reserve</option></select></div><div class="actions"><button type="button" class="primary" id="cSubmit">Submit request</button><button type="button" id="cReset">Reset Council</button></div></div>
<div class="card"><h2>Operations</h2><div id="cRequestBox" class="row">No service request yet.</div><div class="actions"><button type="button" id="cAssign">Assign contractor</button><button type="button" id="cResolve">Resolve</button></div></div>
</div>
</section>

<section id="tradie" class="panel">
<div class="stats"><div class="stat"><small>Leads</small><strong id="tLeads">0</strong></div><div class="stat"><small>Urgent</small><strong id="tUrgent">0</strong></div><div class="stat"><small>Won</small><strong id="tWon">0</strong></div><div class="stat"><small>Won value</small><strong id="tValue">$0</strong></div></div>
<div class="grid">
<div class="card"><h2>Create qualified lead</h2><div class="field"><label>Trade</label><select id="tTrade"><option>Roofing</option><option>Electrical</option><option>Plumbing</option></select></div><div class="field"><label>Issue</label><input id="tIssue" value="Active roof leak after storm"></div><div class="field"><label>Suburb</label><select id="tSuburb"><option>Beenleigh</option><option>Loganholme</option><option>Springwood</option></select></div><div class="actions"><button type="button" class="primary" id="tCreate">Create lead</button><button type="button" id="tReset">Reset Tradie</button></div></div>
<div class="card"><h2>Lead pipeline</h2><div id="tLeadBox" class="row">No lead yet.</div><div class="actions"><button type="button" id="tContact">Contacted</button><button type="button" id="tQuote">Quoted</button><button type="button" id="tBook">Booked</button><button type="button" id="tWin">Won</button></div></div>
</div>
</section>

<section id="debug" class="panel">
<div class="grid"><div class="card"><h2>Activity log</h2><div id="activity" class="log"></div></div><div class="card"><h2>Browser test</h2><div class="actions"><button type="button" class="primary" id="runSmoke">Run all smoke tests</button><button type="button" class="danger" id="resetAll">Reset everything</button></div><div id="smokeResult" class="notice">Not run yet.</div><p class="hint">If this succeeds, JavaScript events and localStorage are working on the hosted route.</p></div></div>
</section>
</main>
<script defer src="/labs/showcase-v6/app.js"></script>
</body>
</html>`;

const appJs = `"use strict";
(function(){
const VERSION="v6.2-hosted";
const $=(id)=>document.getElementById(id);
const load=(k,f)=>{try{const v=JSON.parse(localStorage.getItem(k));return v===null?f:v}catch(e){return f}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const money=(v)=>new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",maximumFractionDigits:0}).format(Number(v)||0);
function log(msg){const a=load("hvs_showcase_activity",[]);a.unshift(new Date().toLocaleTimeString("en-AU")+" — "+msg);save("hvs_showcase_activity",a.slice(0,80));renderLog()}
function renderLog(){const a=load("hvs_showcase_activity",[]);$("activity").innerHTML=a.length?a.map(x=>"<div>"+x+"</div>").join(""):"<div>No activity yet.</div>"}
function setGlobal(s){$("globalState").textContent=s}
document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));btn.classList.add("active");$(btn.dataset.tab).classList.add("active");setGlobal(btn.textContent+" open")}));

const artists=[{name:"Demo Artist",genres:["Acoustic","Pop","Country"],fee:400},{name:"Jake Rivers",genres:["Acoustic","Country"],fee:450},{name:"The Sunday Duo",genres:["Acoustic","Pop"],fee:500},{name:"Amber Lane",genres:["Acoustic","Pop"],fee:350}];
function gState(){return load("hvs_showcase_gig",{offer:null,bookings:0})}
function renderGig(){const s=gState();$("gOffers").textContent=s.offer?1:0;$("gCounter").textContent=s.offer&&s.offer.status==="Countered"?money(s.offer.pay):"$0";$("gBookings").textContent=s.bookings||0;$("gOfferBox").innerHTML=s.offer?"<strong>"+s.offer.artist+"</strong><br>"+money(s.offer.pay)+" · <span class=\"status "+(s.offer.status==="Booked"?"good":"")+"\">"+s.offer.status+"</span>":"No offer yet."}
$("gSearch").addEventListener("click",()=>{const genre=$("gGenre").value,budget=Number($("gBudget").value);const found=artists.filter(a=>a.genres.includes(genre)&&a.fee<=budget);$("gResults").innerHTML=found.map((a,i)=>"<div class=\"row\"><strong>"+a.name+"</strong> · "+money(a.fee)+"<div class=\"actions\"><button type=\"button\" data-send=\""+i+"\">Send offer</button></div></div>").join("")||"<div class=\"row\">No matches.</div>";document.querySelectorAll("[data-send]").forEach(b=>b.addEventListener("click",()=>{const a=found[Number(b.dataset.send)];save("hvs_showcase_gig",{offer:{artist:a.name,pay:a.fee,status:"Pending"},bookings:gState().bookings||0});log("GigMatch offer sent to "+a.name);renderGig()}));log("GigMatch search found "+found.length+" artists");setGlobal("GigMatch search complete")});
$("gCounterBtn").addEventListener("click",()=>{const s=gState();if(!s.offer){log("GigMatch counter blocked — no offer");return alert("Send an offer first.")}s.offer.pay+=50;s.offer.status="Countered";save("hvs_showcase_gig",s);log("Musician countered "+money(s.offer.pay));renderGig()});
$("gAcceptBtn").addEventListener("click",()=>{const s=gState();if(!s.offer||s.offer.status!=="Countered"){return alert("Counter an offer first.")}s.offer.status="Booked";s.bookings=(s.bookings||0)+1;save("hvs_showcase_gig",s);log("Venue accepted counter; booking confirmed");renderGig();setGlobal("GigMatch booking confirmed")});
$("gReset").addEventListener("click",()=>{localStorage.removeItem("hvs_showcase_gig");$("gResults").innerHTML="";log("GigMatch reset");renderGig()});

function cState(){return load("hvs_showcase_council",{request:null})}
function renderCouncil(){const s=cState(),r=s.request;$("cRequests").textContent=r?1:0;$("cCritical").textContent=r&&r.priority==="Critical"?1:0;$("cAssigned").textContent=r&&r.status==="Assigned"?1:0;$("cResolved").textContent=r&&r.status==="Resolved"?1:0;$("cRequestBox").innerHTML=r?"<strong>"+r.title+"</strong><br>"+r.location+" · "+r.priority+" · <span class=\"status "+(r.priority==="Critical"?"hot":"")+"\">"+r.status+"</span>":"No service request yet."}
$("cSubmit").addEventListener("click",()=>{const p=$("cIssue").value.split("|");const r={title:p[0],priority:p[1],category:p[2],location:$("cLocation").value,status:"New"};save("hvs_showcase_council",{request:r});log("Council request created: "+r.title);renderCouncil();setGlobal("Council operations notified")});
$("cAssign").addEventListener("click",()=>{const s=cState();if(!s.request)return alert("Create a request first.");s.request.status="Assigned";save("hvs_showcase_council",s);log("Council request assigned to contractor");renderCouncil()});
$("cResolve").addEventListener("click",()=>{const s=cState();if(!s.request)return alert("Create a request first.");s.request.status="Resolved";save("hvs_showcase_council",s);log("Council request resolved");renderCouncil();setGlobal("Council request resolved")});
$("cReset").addEventListener("click",()=>{localStorage.removeItem("hvs_showcase_council");log("Council reset");renderCouncil()});

function classify(trade,issue){const p=issue.toLowerCase();if(trade==="Roofing")return {priority:/leak|storm/.test(p)?"Urgent":"Standard",value:/leak|storm/.test(p)?1200:500};if(trade==="Electrical")return {priority:/spark|burn|power/.test(p)?"Urgent":"Standard",value:/switchboard/.test(p)?3200:850};return {priority:/burst|leak|hot water/.test(p)?"Urgent":"Standard",value:/renovation/.test(p)?3800:950}}
function tState(){return load("hvs_showcase_tradie",{lead:null,wonValue:0,won:0})}
function renderTradie(){const s=tState(),l=s.lead;$("tLeads").textContent=l?1:0;$("tUrgent").textContent=l&&l.priority==="Urgent"&&l.status!=="Won"?1:0;$("tWon").textContent=s.won||0;$("tValue").textContent=money(s.wonValue||0);$("tLeadBox").innerHTML=l?"<strong>"+l.trade+" — "+l.issue+"</strong><br>"+l.suburb+" · "+l.priority+" · "+money(l.value)+" · <span class=\"status "+(l.status==="Won"?"good":"")+"\">"+l.status+"</span>":"No lead yet."}
$("tCreate").addEventListener("click",()=>{const trade=$("tTrade").value,issue=$("tIssue").value,meta=classify(trade,issue),s=tState();s.lead={trade,issue,suburb:$("tSuburb").value,priority:meta.priority,value:meta.value,status:"New"};save("hvs_showcase_tradie",s);log(trade+" lead created: "+issue);renderTradie();setGlobal(trade+" lead created")});
function tStatus(status){const s=tState();if(!s.lead)return alert("Create a lead first.");if(status==="Won"&&s.lead.status!=="Won"){s.won=(s.won||0)+1;s.wonValue=(s.wonValue||0)+s.lead.value}s.lead.status=status;save("hvs_showcase_tradie",s);log(s.lead.trade+" lead moved to "+status);renderTradie();if(status==="Won")setGlobal("Tradie job won")}
$("tContact").addEventListener("click",()=>tStatus("Contacted"));$("tQuote").addEventListener("click",()=>tStatus("Quoted"));$("tBook").addEventListener("click",()=>tStatus("Booked"));$("tWin").addEventListener("click",()=>tStatus("Won"));$("tReset").addEventListener("click",()=>{localStorage.removeItem("hvs_showcase_tradie");log("Tradie reset");renderTradie()});

$("resetAll").addEventListener("click",()=>{["hvs_showcase_gig","hvs_showcase_council","hvs_showcase_tradie","hvs_showcase_activity"].forEach(k=>localStorage.removeItem(k));renderAll();setGlobal("Ready")});
$("runSmoke").addEventListener("click",()=>{try{localStorage.setItem("hvs_showcase_smoke","ok");if(localStorage.getItem("hvs_showcase_smoke")!=="ok")throw new Error("localStorage");$("gGenre").value="Acoustic";$("gBudget").value="500";$("gSearch").click();$("cSubmit").click();$("tCreate").click();$("smokeResult").innerHTML="<strong>PASS</strong><br>JavaScript events, DOM updates and localStorage all worked on this hosted page.";log("Hosted smoke test passed");setGlobal("Smoke test PASS")}catch(e){$("smokeResult").innerHTML="<strong>FAIL</strong><br>"+e.message;setGlobal("Smoke test FAIL")}});
function renderAll(){renderGig();renderCouncil();renderTradie();renderLog();$("version").textContent=VERSION}
renderAll();log("Hosted demo loaded");
})();`;

await mkdir(out,{recursive:true});
await writeFile(out+'index.html',html);
await writeFile(out+'app.js',appJs);
console.log('Published hidden HVS showcase route /labs/showcase-v6/');