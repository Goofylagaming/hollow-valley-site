(() => {
 'use strict';
 const labels={website:'Website',game:'Game server',bridge:'Command Bridge',discord:'Discord bot',marketplace:'Marketplace',steam:'Steam sign-in',map:'Live Map'};
 const statuses={investigating:'Investigating',identified:'Cause identified',monitoring:'Monitoring recovery',resolved:'Resolved'};
 const $=id=>document.getElementById(id);let generation=0,controller=null,next=null,busy=false;
 const node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
 const date=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST';
 function valid(item){return item&&typeof item.id==='string'&&/^[-a-zA-Z0-9_]{16,80}$/.test(item.id)&&typeof item.title==='string'&&item.title.length<=120&&typeof item.summary==='string'&&item.summary.length<=1200&&
  item.source==='staff-reviewed'&&Object.hasOwn(statuses,item.status)&&['degraded','outage'].includes(item.severity)&&Array.isArray(item.components)&&item.components.length>0&&item.components.length<=7&&item.components.every(c=>Object.hasOwn(labels,c))&&
  [item.startedAt,item.verifiedAt,item.reportedAt].every(t=>Number.isSafeInteger(t)&&t>=0&&t<=Date.now()+120000)&&item.verifiedAt>=item.startedAt&&
  (item.status==='resolved'?Number.isSafeInteger(item.endedAt)&&item.endedAt>=item.startedAt&&item.endedAt<=item.verifiedAt:item.endedAt===null);}
 async function load(reset){
  if(!reset&&(busy||next===null))return;
  if(controller)controller.abort();const current=++generation;controller=new AbortController();const active=controller;
  busy=true;$('status-incidents-more').disabled=true;const timeout=setTimeout(()=>active.abort(),10000);
  const request=async path=>{const response=await fetch(path,{cache:'no-store',credentials:'same-origin',signal:active.signal});if(!response.ok)throw new Error('Unavailable');return response.json();};
  if(reset){next=null;$('status-incidents-list').replaceChildren();$('status-incidents-more').hidden=true;}
  $('status-incidents-message').textContent='Checking incident history…';
  try{
   if(reset){const caps=await request('/api/status-incidents/capabilities');if(current!==generation)return;if(caps.available!==true){$('status-incidents-message').textContent='Staff-reviewed incident history is not available yet.';return;}}
   const body=await request('/api/status-incidents'+(next===null?'':'?before='+next));if(current!==generation)return;
   if(!body||body.source!=='staff-reviewed'||body.independentMonitoring!==false||typeof body.partial!=='boolean'||!Array.isArray(body.items)||body.items.length>25||!body.items.every(valid)||
     (body.next!==null&&(!Number.isSafeInteger(body.next)||body.next<1||(next!==null&&body.next>=next))))throw new Error('Unavailable');
   for(const item of body.items){const article=node('article','');article.className='hv-status-incident';article.append(node('h3',item.title),node('p',statuses[item.status]+' · '+(item.severity==='outage'?'Outage':'Degraded service')+' · '+item.components.map(c=>labels[c]).join(', ')),node('p',item.summary),node('small','Began '+date(item.startedAt)+' · Staff checked '+date(item.verifiedAt)+(item.endedAt===null?'':' · Resolved '+date(item.endedAt))));$('status-incidents-list').append(article);}
   next=body.next;$('status-incidents-more').hidden=next===null;
   $('status-incidents-message').textContent=body.partial?'Some incident reports could not be verified and are unavailable.':$('status-incidents-list').children.length?'Published staff reports · Times shown in Brisbane time.':'No published staff reports are available. This does not confirm that every service is healthy.';
  }catch{if(current===generation){next=null;$('status-incidents-list').replaceChildren();$('status-incidents-more').hidden=true;$('status-incidents-message').textContent='Incident history could not be verified. Refresh to try again.';}}
  finally{clearTimeout(timeout);if(current===generation){busy=false;controller=null;$('status-incidents-more').disabled=false;}}
 }
 function init(){if(!$('status-incidents-list'))return;$('status-incidents-more').addEventListener('click',()=>load(false));$('status-refresh')?.addEventListener('click',()=>load(true));load(true);setInterval(()=>{if(!document.hidden)load(true);},30000);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
