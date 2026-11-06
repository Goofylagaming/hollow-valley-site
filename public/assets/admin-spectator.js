/* Private cached observations. No command controls, browser storage or automatic source polling. */
(() => {
 'use strict';
 const {api}=window.HDS,$=id=>document.getElementById(id),node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
 let actor=null,locked=false,generation=0,pending=null,display=null,received=0,available=false,freshSignature='';
 const time=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST';
 function clear(){generation++;pending?.abort();pending=null;display=null;$('spectator-panels').replaceChildren();}
 function lock(message){locked=true;clear();$('spectator-content').hidden=true;$('spectator-guard').hidden=false;$('spectator-guard').textContent=message;$('spectator-refresh').disabled=true;}
 async function check(expected){
  if(locked)throw Error('Reload dashboard');let me;try{me=await api('/api/me',{cache:'no-store'});}catch{lock('Admin access could not be verified. Reload this page.');throw Error('Unverified access');}
  if(locked)throw Error('Access changed');if(!me?.loggedIn||!me.user?.is_admin||!Number.isSafeInteger(me.user.id)||me.user.id<=0||typeof me.user.steam_id!=='string'||!/^\d{17}$/.test(me.user.steam_id||'')){lock('Current linked admin access is required. Reload this page.');throw Error('Admin access required');}
  const binding=me.user.id+':'+me.user.steam_id;if(actor&&actor!==binding||expected&&expected!==binding){lock('The admin account changed. Reload this page.');throw Error('Account changed');}actor=binding;return binding;
 }
 const list=(card,items)=>{const ul=node('ul','');for(const item of items)ul.append(node('li',item));card.append(ul);};
 function render(value,clock){
  const panels=$('spectator-panels');panels.replaceChildren();
  function card(id,title){const section=node('section','');section.className='hv-spectator-card';section.id=id;section.append(node('h2',title));panels.append(section);return section;}
  function observed(value){return value?.code==='fresh'&&Date.parse(value.expiresAt)>=clock;}
  const population=card('spectator-population','Observed population');
  if(observed(value.presence))population.append(node('b',String(value.presence.population)),node('p','Cached sample: '+time(value.presence.observedAt)));
  else population.append(node('p',value.presence?.code==='stale'||value.presence?.code==='fresh'?'Player observation expired. Refresh for a newer sample.':'Player observations are unavailable.'));
  const species=card('spectator-species','Observed species'),regions=card('spectator-regions','Approximate regions');
  if(observed(value.presence)){
   list(species,value.presence.species.map(row=>row.label+' · '+row.count));species.append(node('p','Species not recorded: '+value.presence.unknownSpecies));
   list(regions,value.presence.regions.map(row=>row.label+' · '+row.count));regions.append(node('p','Nearest map labels, not verified biome boundaries. Region unknown: '+value.presence.unknownRegions));
  }else{species.append(node('p','A fresh player sample is required.'));regions.append(node('p','A fresh player sample is required.'));}
  const health=card('spectator-health','Recorded game health');health.append(node('p',observed(value.health)?(value.health.online?'Recorded online':'Recorded offline')+' · '+time(value.health.observedAt):'A recent health record is unavailable.'));
  card('spectator-fps','Game FPS').append(node('p','Not supplied by the current feed.'));
  const drops=card('spectator-bodydrops','Body-drop requests');
  if(value.bodyDrops?.available){list(drops,['Queued: '+value.bodyDrops.counts.queued,'Acknowledged: '+value.bodyDrops.counts.acknowledged,'Outcome unknown: '+value.bodyDrops.counts.unknown]);drops.append(node('p','Stored request state as of '+time(value.bodyDrops.asOf)+'. This does not verify a drop in the game.'));}else drops.append(node('p','Request counts are unavailable.'));
  const orders=card('spectator-marketplace','Failed official orders');orders.append(node('p',value.marketplace?.available?String(value.marketplace.failedOrders)+' currently failed order(s), updated during the recorded 24-hour window.':'Order counts are unavailable.'));
  const battles=card('spectator-battles','Website battle records');battles.append(node('p','Stored warning/active attacks, not verified current game battles.'));
  if(value.battles?.available){list(battles,value.battles.items.map(row=>'Attack #'+row.id+' · Event #'+row.eventId+' · '+row.status+' · '+time(row.observedAt)+(row.stale?' · observation is old':'')));if(!value.battles.items.length)battles.append(node('p','No matching stored attack records.'));if(value.battles.truncated)battles.append(node('p','Results are limited.'));}else battles.append(node('p','Battle records are unavailable.'));
  const combat=card('spectator-combat','Repeated combat pairs');combat.append(node('p','At least two distinct recorded kill times for the same attacker/victim in 24 hours. Statistics for staff review, not an abuse finding or automatic moderation.'));
  if(value.combat?.available){list(combat,value.combat.pairs.map(row=>row.attacker+' → '+row.victim+' · '+row.count));if(!value.combat.pairs.length)combat.append(node('p','No repeated pairs were returned from the retained configured feed.'));if(value.combat.truncated)combat.append(node('p','Showing only the largest recorded pairs.'));}else combat.append(node('p','Combat statistics are unavailable.'));
  const errors=card('spectator-errors','Stored failed operations');errors.append(node('p','Latest currently failed audit/request records updated in 24 hours. Earlier errors may be absent after a later state change. Raw error messages are withheld.'));
  if(value.errors?.available){list(errors,value.errors.items.map(row=>time(row.at)+' · '+row.source+' · '+row.category+' / '+row.operation+' · '+row.id));if(!value.errors.items.length)errors.append(node('p','No matching failed records were returned.'));if(value.errors.truncated)errors.append(node('p','Showing a bounded recent window.'));}else errors.append(node('p','Failure records are unavailable.'));
 }
 async function refresh(){
  if(!available||locked)return;
  clear();const current=generation,controller=new AbortController();pending=controller;$('spectator-refresh').disabled=true;$('spectator-feedback').textContent='Loading private observations…';let binding;
  try{binding=await check(actor);if(current!==generation)return;const value=await api('/api/admin-spectator/summary',{cache:'no-store',headers:{'X-Spectator-Reviewer':binding},signal:controller.signal});await check(binding);if(current!==generation||controller.signal.aborted)return;if(value.version!==1||value.readOnly!==true||value.reviewerBinding!==binding||!Number.isFinite(Date.parse(value.fetchedAt)))throw Error('Unverified reply');display=value;received=performance.now();freshSignature=[value.presence,value.health].map(section=>section?.code==='fresh'&&Date.parse(section.expiresAt)>=Date.parse(value.fetchedAt)).join(':');render(value,Date.parse(value.fetchedAt));$('spectator-feedback').textContent='Observations read '+time(value.fetchedAt)+'. Refresh explicitly for newer records.';}
  catch(error){if(locked||controller.signal.aborted||current!==generation)return;try{await check(binding||actor);}catch{return;}if(current===generation){display=null;$('spectator-panels').replaceChildren();$('spectator-feedback').textContent='Observations could not be loaded. Refresh when the sources are available.';}}
  finally{if(current===generation){pending=null;$('spectator-refresh').disabled=locked;}}
 }
 async function initialize(){const current=generation;try{const binding=await check();const caps=await api('/api/admin-spectator/capabilities',{cache:'no-store'});await check(binding);if(current!==generation||document.hidden)return;if(caps.reviewerBinding!==binding||caps.readOnly!==true)throw Error('Unverified capabilities');available=caps.enabled===true;$('spectator-guard').hidden=true;$('spectator-content').hidden=false;if(!available){$('spectator-feedback').textContent='This dashboard is not enabled. Reload after rollout is reviewed.';return;}$('spectator-refresh').disabled=false;await refresh();}catch{if(!locked)lock('Dashboard access could not be verified. Reload this page.');}}
 async function focus(){if(!actor||locked)return;$('spectator-content').hidden=true;clear();const current=generation;try{const binding=await check(actor);const caps=await api('/api/admin-spectator/capabilities',{cache:'no-store'});await check(binding);if(current!==generation||document.hidden)return;if(caps.reviewerBinding!==binding||caps.readOnly!==true)throw Error('Unverified capabilities');available=caps.enabled===true;$('spectator-guard').hidden=true;$('spectator-content').hidden=false;$('spectator-feedback').textContent=available?'Refresh observations to reload private records.':'This dashboard is not enabled. Reload after rollout is reviewed.';$('spectator-refresh').disabled=!available;}catch{if(!locked)lock('Dashboard access could not be verified. Reload this page.');}}
 $('spectator-refresh').addEventListener('click',refresh);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();$('spectator-content').hidden=true;}else focus();});
 setInterval(()=>{if(document.hidden||locked||!display)return;const clock=Date.parse(display.fetchedAt)+Math.max(0,performance.now()-received);if(clock-Date.parse(display.fetchedAt)>120000){clear();$('spectator-feedback').textContent='This view has expired. Refresh observations.';}else{const signature=[display.presence,display.health].map(value=>value?.code==='fresh'&&Date.parse(value.expiresAt)>=clock).join(':');if(signature!==freshSignature){freshSignature=signature;render(display,clock);}}},1000);
 setInterval(()=>{if(actor&&!locked&&!document.hidden)check(actor).catch(()=>{});},15000);initialize();
})();
