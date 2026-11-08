import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./dist/hollow-valley/labs/showcase-v6/', import.meta.url));

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HVS Showcase — Hosted Interaction Test</title>
<style>
:root{color-scheme:dark;--bg:#08111d;--panel:#111d30;--panel2:#172741;--line:#2d4566;--ink:#f6f8fb;--muted:#9fb1c7;--green:#51d7a6;--blue:#6cb7ff;--red:#ff7885}
*{box-sizing:border-box}body{margin:0;background:#08111d;color:var(--ink);font:16px/1.5 system-ui,sans-serif}button,input,select{font:inherit}button{cursor:pointer;min-height:44px}.wrap{max-width:1100px;margin:auto;padding:22px}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--green)}h1{font-size:clamp(36px,7vw,72px);line-height:1;margin:10px 0 14px}p{color:var(--muted)}.tabs,.actions{display:flex;gap:8px;flex-wrap:wrap}.tabs{margin:18px 0}.tabs button,.actions button{border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);padding:10px 13px}.tabs button.active,.actions button.primary{background:var(--green);border-color:var(--green);color:#06140e;font-weight:800}.panel{display:none}.panel.active{display:block}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card,.stat,.notice,.row{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:14px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.stat{background:var(--panel2)}.stat small{display:block;color:var(--muted)}.stat strong{font-size:24px}.field{margin:10px 0}.field label{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}input,select{width:100%;padding:10px;background:#0b1727;color:var(--ink);border:1px solid var(--line);border-radius:8px}.row{margin:8px 0;background:var(--panel2)}.state{display:inline-block;padding:4px 8px;border-radius:999px;background:#203755;color:#c4e1ff;font-size:12px}.state.good{background:#183c31;color:#9af0c8}.state.hot{background:#49232a;color:#ffb0b8}.log{max-height:300px;overflow:auto}.log div{padding:7px 0;border-bottom:1px solid var(--line);color:var(--muted)}@media(max-width:760px){.grid,.stats{grid-template-columns:1fr}.wrap{padding:15px}}
</style>
</head>
<body>
<main id="main" class="wrap">
<div class="eyebrow">Hidden hosted test · no production data</div>
<h1>HVS Showcase</h1>
<p>This version keeps all interaction code inside this page so the buttons do not depend on a separate JavaScript file.</p>
<div class="notice"><strong>Build:</strong> v6.3-inline · <strong>Current action:</strong> <span id="currentAction">Ready</span></div>

<div class="tabs">
<button type="button" class="active" data-tab="gig">GigMatch</button>
<button type="button" data-tab="council">Council</button>
<button type="button" data-tab="tradie">Tradie</button>
<button type="button" data-tab="debug">Debug</button>
</div>

<section id="gig" class="panel active">
<div class="stats">
<div class="stat"><small>Artists found</small><strong id="gFound">0</strong></div>
<div class="stat"><small>Offers</small><strong id="gOffers">0</strong></div>
<div class="stat"><small>Offer value</small><strong id="gValue">$0</strong></div>
<div class="stat"><small>Bookings</small><strong id="gBookings">0</strong></div>
</div>
<div class="grid">
<div class="card">
<h2>Venue search</h2>
<div class="field"><label>Genre</label><select id="gGenre"><option>Acoustic</option><option>Country</option><option>Pop</option></select></div>
<div class="field"><label>Budget</label><select id="gBudget"><option value="400">$400</option><option value="500" selected>$500</option><option value="700">$700</option></select></div>
<div class="actions"><button type="button" class="primary" id="gSearch">Search artists</button><button type="button" id="gReset">Reset</button></div>
<div id="gResults"></div>
</div>
<div class="card">
<h2>Booking workflow</h2>
<div id="gWorkflow" class="row">Search for an artist first.</div>
<div class="actions"><button type="button" id="gCounter">Musician counters +$50</button><button type="button" id="gAccept">Venue accepts</button></div>
</div>
</div>
</section>

<section id="council" class="panel">
<div class="stats">
<div class="stat"><small>Requests</small><strong id="cRequests">0</strong></div>
<div class="stat"><small>Critical</small><strong id="cCritical">0</strong></div>
<div class="stat"><small>Assigned</small><strong id="cAssigned">0</strong></div>
<div class="stat"><small>Resolved</small><strong id="cResolved">0</strong></div>
</div>
<div class="grid">
<div class="card">
<h2>Create report</h2>
<div class="field"><label>Issue</label><select id="cIssue"><option value="Sparking power point|Critical">Sparking power point</option><option value="Public toilet overflowing|Urgent">Public toilet overflowing</option><option value="Facility lights out|Routine">Facility lights out</option></select></div>
<div class="field"><label>Location</label><select id="cLocation"><option>Riverside Community Centre</option><option>Meadow Park Public Toilets</option><option>Lakeside Reserve</option></select></div>
<div class="actions"><button type="button" class="primary" id="cCreate">Submit request</button><button type="button" id="cReset">Reset</button></div>
</div>
<div class="card">
<h2>Operations</h2>
<div id="cWorkflow" class="row">No request yet.</div>
<div class="actions"><button type="button" id="cAssign">Assign contractor</button><button type="button" id="cResolve">Resolve</button></div>
</div>
</div>
</section>

<section id="tradie" class="panel">
<div class="stats">
<div class="stat"><small>Leads</small><strong id="tLeads">0</strong></div>
<div class="stat"><small>Urgent</small><strong id="tUrgent">0</strong></div>
<div class="stat"><small>Won</small><strong id="tWon">0</strong></div>
<div class="stat"><small>Won value</small><strong id="tWonValue">$0</strong></div>
</div>
<div class="grid">
<div class="card">
<h2>Create lead</h2>
<div class="field"><label>Trade</label><select id="tTrade"><option>Roofing</option><option>Electrical</option><option>Plumbing</option></select></div>
<div class="field"><label>Issue</label><input id="tIssue" value="Active roof leak after storm"></div>
<div class="field"><label>Suburb</label><select id="tSuburb"><option>Beenleigh</option><option>Loganholme</option><option>Springwood</option></select></div>
<div class="actions"><button type="button" class="primary" id="tCreate">Create qualified lead</button><button type="button" id="tReset">Reset</button></div>
</div>
<div class="card">
<h2>Lead pipeline</h2>
<div id="tWorkflow" class="row">No lead yet.</div>
<div class="actions"><button type="button" id="tContact">Contacted</button><button type="button" id="tQuote">Quoted</button><button type="button" id="tBook">Booked</button><button type="button" id="tWin">Won</button></div>
</div>
</div>
</section>

<section id="debug" class="panel">
<div class="grid">
<div class="card"><h2>Activity log</h2><div id="activity" class="log"></div></div>
<div class="card"><h2>Interaction smoke test</h2><p>Runs one action in all three demos.</p><div class="actions"><button type="button" class="primary" id="runSmoke">Run smoke test</button><button type="button" id="clearAll">Clear everything</button></div><div id="smokeResult" class="notice">Not run yet.</div></div>
</div>
</section>
</main>

<script>
(function(){
"use strict";
var artists=[
 {name:"Demo Artist",genres:["Acoustic","Pop","Country"],fee:400},
 {name:"Jake Rivers",genres:["Acoustic","Country"],fee:450},
 {name:"Sunday Duo",genres:["Acoustic","Pop"],fee:500},
 {name:"Amber Lane",genres:["Acoustic","Pop"],fee:350}
];
var state={
 gig:{found:0,offer:null,bookings:0},
 council:{request:null},
 tradie:{lead:null,won:0,wonValue:0},
 log:[]
};
function el(id){return document.getElementById(id)}
function money(v){return new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",maximumFractionDigits:0}).format(Number(v)||0)}
function action(text){el("currentAction").textContent=text;state.log.unshift(new Date().toLocaleTimeString("en-AU")+" — "+text);renderLog()}
function renderLog(){el("activity").innerHTML=state.log.length?state.log.map(function(x){return "<div>"+x+"</div>"}).join(""):"<div>No activity yet.</div>"}
function renderGig(){
 el("gFound").textContent=state.gig.found;
 el("gOffers").textContent=state.gig.offer?1:0;
 el("gValue").textContent=state.gig.offer?money(state.gig.offer.pay):"$0";
 el("gBookings").textContent=state.gig.bookings;
 if(!state.gig.offer){el("gWorkflow").innerHTML="Search for an artist first.";return}
 el("gWorkflow").innerHTML="<strong>"+state.gig.offer.artist+"</strong><br>"+money(state.gig.offer.pay)+" · <span class=\"state "+(state.gig.offer.status==="Booked"?"good":"")+"\">"+state.gig.offer.status+"</span>";
}
function renderCouncil(){
 var r=state.council.request;
 el("cRequests").textContent=r?1:0;
 el("cCritical").textContent=r&&r.priority==="Critical"?1:0;
 el("cAssigned").textContent=r&&r.status==="Assigned"?1:0;
 el("cResolved").textContent=r&&r.status==="Resolved"?1:0;
 el("cWorkflow").innerHTML=r?"<strong>"+r.title+"</strong><br>"+r.location+" · "+r.priority+" · <span class=\"state "+(r.priority==="Critical"?"hot":"")+"\">"+r.status+"</span>":"No request yet.";
}
function leadMeta(trade,issue){
 var p=issue.toLowerCase();
 if(trade==="Roofing")return {urgent:/leak|storm/.test(p),value:/leak|storm/.test(p)?1200:500};
 if(trade==="Electrical")return {urgent:/spark|burn|power/.test(p),value:/switchboard/.test(p)?3200:850};
 return {urgent:/burst|leak|hot water/.test(p),value:/renovation/.test(p)?3800:950};
}
function renderTradie(){
 var l=state.tradie.lead;
 el("tLeads").textContent=l?1:0;
 el("tUrgent").textContent=l&&l.priority==="Urgent"&&l.status!=="Won"?1:0;
 el("tWon").textContent=state.tradie.won;
 el("tWonValue").textContent=money(state.tradie.wonValue);
 el("tWorkflow").innerHTML=l?"<strong>"+l.trade+" — "+l.issue+"</strong><br>"+l.suburb+" · "+l.priority+" · "+money(l.value)+" · <span class=\"state "+(l.status==="Won"?"good":"")+"\">"+l.status+"</span>":"No lead yet.";
}
function renderAll(){renderGig();renderCouncil();renderTradie();renderLog()}

document.querySelectorAll("[data-tab]").forEach(function(btn){
 btn.addEventListener("click",function(){
  document.querySelectorAll("[data-tab]").forEach(function(x){x.classList.remove("active")});
  document.querySelectorAll(".panel").forEach(function(x){x.classList.remove("active")});
  btn.classList.add("active");
  el(btn.getAttribute("data-tab")).classList.add("active");
  action(btn.textContent+" opened");
 });
});

el("gSearch").addEventListener("click",function(){
 var genre=el("gGenre").value,budget=Number(el("gBudget").value);
 var found=artists.filter(function(a){return a.genres.indexOf(genre)>=0&&a.fee<=budget});
 state.gig.found=found.length;
 el("gResults").innerHTML=found.map(function(a,i){return "<div class=\"row\"><strong>"+a.name+"</strong> · "+money(a.fee)+"<div class=\"actions\"><button type=\"button\" data-offer=\""+i+"\">Send offer</button></div></div>"}).join("")||"<div class=\"row\">No matches.</div>";
 Array.prototype.forEach.call(document.querySelectorAll("[data-offer]"),function(btn){
  btn.addEventListener("click",function(){
   var a=found[Number(btn.getAttribute("data-offer"))];
   state.gig.offer={artist:a.name,pay:a.fee,status:"Pending"};
   action("Offer sent to "+a.name);
   renderGig();
  });
 });
 action("GigMatch found "+found.length+" artists");
 renderGig();
});
el("gCounter").addEventListener("click",function(){if(!state.gig.offer)return alert("Send an offer first.");state.gig.offer.pay+=50;state.gig.offer.status="Countered";action("Musician countered "+money(state.gig.offer.pay));renderGig()});
el("gAccept").addEventListener("click",function(){if(!state.gig.offer||state.gig.offer.status!=="Countered")return alert("Counter the offer first.");state.gig.offer.status="Booked";state.gig.bookings+=1;action("Venue accepted counter — booking confirmed");renderGig()});
el("gReset").addEventListener("click",function(){state.gig={found:0,offer:null,bookings:0};el("gResults").innerHTML="";action("GigMatch reset");renderGig()});

el("cCreate").addEventListener("click",function(){var p=el("cIssue").value.split("|");state.council.request={title:p[0],priority:p[1],location:el("cLocation").value,status:"New"};action("Council request submitted");renderCouncil()});
el("cAssign").addEventListener("click",function(){if(!state.council.request)return alert("Create a request first.");state.council.request.status="Assigned";action("Council contractor assigned");renderCouncil()});
el("cResolve").addEventListener("click",function(){if(!state.council.request)return alert("Create a request first.");state.council.request.status="Resolved";action("Council request resolved");renderCouncil()});
el("cReset").addEventListener("click",function(){state.council={request:null};action("Council reset");renderCouncil()});

el("tCreate").addEventListener("click",function(){var trade=el("tTrade").value,issue=el("tIssue").value,meta=leadMeta(trade,issue);state.tradie.lead={trade:trade,issue:issue,suburb:el("tSuburb").value,priority:meta.urgent?"Urgent":"Standard",value:meta.value,status:"New"};action(trade+" qualified lead created");renderTradie()});
function setLeadStatus(status){var l=state.tradie.lead;if(!l)return alert("Create a lead first.");if(status==="Won"&&l.status!=="Won"){state.tradie.won+=1;state.tradie.wonValue+=l.value}l.status=status;action(l.trade+" lead moved to "+status);renderTradie()}
el("tContact").addEventListener("click",function(){setLeadStatus("Contacted")});
el("tQuote").addEventListener("click",function(){setLeadStatus("Quoted")});
el("tBook").addEventListener("click",function(){setLeadStatus("Booked")});
el("tWin").addEventListener("click",function(){setLeadStatus("Won")});
el("tReset").addEventListener("click",function(){state.tradie={lead:null,won:0,wonValue:0};action("Tradie reset");renderTradie()});

el("runSmoke").addEventListener("click",function(){
 try{
  el("gGenre").value="Acoustic";el("gBudget").value="500";el("gSearch").click();
  el("cCreate").click();
  el("tCreate").click();
  el("smokeResult").innerHTML="<strong>PASS</strong><br>All three button flows updated the page.";
  action("Smoke test PASS");
 }catch(err){
  el("smokeResult").innerHTML="<strong>FAIL</strong><br>"+err.message;
  action("Smoke test FAIL");
 }
});
el("clearAll").addEventListener("click",function(){state={gig:{found:0,offer:null,bookings:0},council:{request:null},tradie:{lead:null,won:0,wonValue:0},log:[]};el("gResults").innerHTML="";el("smokeResult").textContent="Not run yet.";el("currentAction").textContent="Ready";renderAll()});
renderAll();
action("Inline demo loaded");
})();
</script>
</body>
</html>`;

await mkdir(out,{recursive:true});
await writeFile(out+'index.html',html);
console.log('Published inline HVS showcase route /labs/showcase-v6/');
