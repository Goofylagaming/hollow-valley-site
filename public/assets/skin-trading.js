(() => {
 'use strict';
 const get=id=>document.getElementById('trade-'+id),node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
 let generation=0,binding=null,caps=null,busy=false,review=null,attempt=null,controller=null,started=false;
 const cursors={listings:null,own:null,history:null,skins:null},money=value=>Number(value).toLocaleString()+' Valley Coins';
 const setStatus=text=>{get('status').textContent=text;};
 function clear(message){generation++;controller?.abort();controller=null;binding=null;caps=null;busy=false;review=null;attempt=null;get('account').hidden=true;get('review').hidden=true;get('review-summary').textContent='';get('mode').textContent='';get('offer').reset();get('skin').replaceChildren(new Option('Choose a skin',''));for(const id of ['listings','own','history'])get(id).replaceChildren();for(const key of Object.keys(cursors))cursors[key]=null;get('refresh').disabled=false;if(message)setStatus(message);}
 async function request(path,{body,signal}={}){
  const response=await fetch(path,{credentials:'same-origin',signal,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Skin-Trader':binding},body:JSON.stringify(body)})});
  let result;try{result=await response.json();}catch{throw Object.assign(Error('The service could not confirm this request.'),{status:502});}
  if(!response.ok)throw Object.assign(Error(result.error||'The request could not be completed.'),{status:response.status});return result;
 }
 async function identity(epoch){const me=await request('/api/me');if(epoch!==generation)throw Error('View changed');const current=me.loggedIn&&Number.isSafeInteger(me.user?.id)&&/^\d{17}$/.test(me.user?.steam_id||'')?me.user.id+':'+me.user.steam_id:null;if(!current||binding&&current!==binding){clear('Your account changed. Refresh to load its market.');get('signin').hidden=Boolean(current);throw Error('View changed');}return current;}
 async function rpc(action,body,epoch){const result=await request('/api/skins/trading/'+action,{body,signal:controller?.signal});if(epoch!==generation)throw Error('View changed');if(result.traderBinding!==binding){clear('Your account changed. Refresh this page.');throw Error('View changed');}return result;}
 const writable=()=>caps&&!caps.readOnly&&!busy&&!attempt;
 function controls(){
  const locked=busy||Boolean(review)||Boolean(attempt);get('refresh').disabled=busy||Boolean(attempt);get('offer').querySelector('fieldset').disabled=locked||!caps?.enabled||caps.readOnly;
  get('more-skins').disabled=locked||!cursors.skins;for(const id of ['listings','own','history'])get('next-'+id).disabled=locked||!cursors[id];
  document.querySelectorAll('[data-trade-choice]').forEach(button=>{button.disabled=locked||caps?.readOnly||button.dataset.tradeChoice==='buy'&&!caps?.enabled;});
  get('confirm').disabled=busy||!review||!writable()||review.action!=='cancel'&&!caps?.enabled;get('discard').disabled=busy||Boolean(attempt);
  get('check').hidden=!attempt;get('retry').hidden=!attempt;get('check').disabled=busy;get('retry').disabled=busy||caps?.readOnly||attempt?.action!=='cancel'&&!caps?.enabled;
 }
 function choose(action,body,text){if(!writable()||action!=='cancel'&&!caps?.enabled)return;review={action,body,text};get('review-summary').textContent=text;get('review').hidden=false;get('confirm').hidden=false;controls();get('review').scrollIntoView({block:'nearest'});}
 function listingCards(id,rows){
  const host=get(id);host.replaceChildren();if(!rows.length)host.append(node('p',id==='own'?'You have no listings on this page.':'No available skins on this page.'));
  for(const row of rows){const card=node('article','');card.append(node('h3',row.name),node('p',row.species+' · '+money(row.price)),node('p',row.state+' · Expires '+new Date(row.expiresAt).toLocaleString()));
   if(row.held)card.append(node('p','Resale is temporarily on hold. You can still cancel your own listing.'));
   if(row.state==='active'&&(id==='own'||!row.mine&&!row.owned&&!row.held)){const action=id==='own'?'cancel':'buy',button=node('button',action==='cancel'?'Review cancellation':'Review purchase');button.type='button';button.dataset.tradeChoice=action;button.addEventListener('click',()=>choose(action,action==='cancel'?{id:row.id,expectedRevision:row.revision}:{id:row.id,expectedRevision:row.revision,expectedPrice:row.price,requestId:crypto.randomUUID()},action==='cancel'?'Cancel your unsold listing for '+row.name+'?':'Buy '+row.name+' for '+money(row.price)+'? The unlock moves to your account.'));card.append(button);}else if(row.mine&&id!=='own')card.append(node('p','Your listing'));else if(row.owned&&id!=='own')card.append(node('p','Already in your account'));
   const support=node('details',''),label=node('summary','Need help with this listing?'),link=node('a','Open a player report');link.href='/reports';support.append(label,node('p','Include this reference: '+row.id),link);card.append(support);host.append(card);
  }
 }
 async function page(kind,before,epoch){
  const action=kind==='skins'?'eligible':kind==='history'?'history':'list',body={...(kind==='own'?{own:true}:{}),...(kind!=='skins'?{limit:matchMedia('(max-width:760px)').matches?6:12}:{}),...(before?{before}:{})};
  const result=await rpc(action,body,epoch);return ()=>{cursors[kind]=result.next||null;
  if(kind==='skins'){get('skin').replaceChildren(new Option('Choose a skin',''));for(const skin of result.skins)get('skin').add(new Option(skin.name+' · '+skin.species,skin.id));}
  else if(kind==='history'){get('history').replaceChildren();if(!result.trades.length)get('history').append(node('p','No trades on this page.'));for(const row of result.trades)get('history').append(node('p',(row.role==='buyer'?'Bought ':'Sold ')+row.name+' · '+money(row.price)+' · '+new Date(row.purchasedAt).toLocaleString()));}
  else listingCards(kind,result.listings);};
 }
 async function load(){
  clear();const epoch=generation;busy=true;controller=new AbortController();get('signin').hidden=true;setStatus('Loading your market…');controls();
  try{binding=await identity(epoch);const latestCaps=await request('/api/skins/trading/capabilities');if(epoch!==generation)return;caps=latestCaps;if(caps.traderBinding!==binding)throw Error('Your account changed. Refresh again.');
   const renderers=await Promise.all([page('own',null,epoch),page('history',null,epoch),...(caps.enabled?[page('listings',null,epoch),page('skins',null,epoch)]:[])]);await identity(epoch);if(epoch!==generation)return;for(const render of renderers)render();
   get('account').hidden=false;get('mode').textContent=caps.readOnly?'This preview is read-only. You can review your listings and trade history.':caps.enabled?'Listings last seven days. Check the exact price before confirming.':'New trading is paused. Your saved history and unsold-listing cancellation remain available.';setStatus('Market refreshed.');return true;
  }catch(error){if(epoch===generation){clear(error.message||'The market is unavailable. Refresh to try again.');}}
  finally{if(epoch===generation){busy=false;controls();started=true;}}
 }
 async function next(kind){if(busy||review||attempt||!cursors[kind])return;const epoch=generation;busy=true;controls();try{await identity(epoch);const render=await page(kind,cursors[kind],epoch);await identity(epoch);if(epoch===generation)render();}catch(error){if(epoch===generation)setStatus(error.message);}finally{if(epoch===generation){busy=false;controls();}}}
 async function confirm(){
  const frozen=attempt||review;if(busy||!frozen||caps?.readOnly||frozen.action!=='cancel'&&!caps?.enabled)return;const epoch=generation;attempt=frozen;busy=true;controls();get('confirm').hidden=true;
  try{await identity(epoch);await rpc(frozen.action,frozen.body,epoch);await identity(epoch);if(epoch!==generation)return;attempt=null;review=null;const previous=binding;if(await load()&&binding===previous)setStatus(frozen.action==='offer'?'Your listing is saved.':frozen.action==='buy'?'Purchase saved. The skin is now in your account.':'Listing cancelled. You keep the skin.');}
  catch(error){if(epoch!==generation)return;if([400,404,409,429].includes(error.status)){attempt=null;review=null;get('review').hidden=true;setStatus(error.message+' Refresh before a new choice.');}else if([401,403].includes(error.status)){clear('Your account or access changed. Refresh and check saved history before retrying.');}else{get('review').hidden=false;setStatus('The outcome is unconfirmed. Check saved status, or retry this same request. '+error.message);}}
  finally{if(epoch===generation){busy=false;controls();}}
 }
 async function check(){
  if(!attempt||busy)return;const frozen=attempt,epoch=generation;busy=true;controls();
  try{await identity(epoch);const action=frozen.action==='offer'?'offerReceipt':frozen.action==='buy'?'receipt':'ownListing',body=frozen.action==='cancel'?{id:frozen.body.id}:{requestId:frozen.body.requestId};const result=await rpc(action,body,epoch);await identity(epoch);if(epoch!==generation)return;
   const confirmed=frozen.action!=='cancel'||['cancelled','sold','expired'].includes(result.listing.state);if(confirmed){attempt=null;review=null;const previous=binding;if(await load()&&binding===previous)setStatus('Saved outcome confirmed. No new request was sent.');}else setStatus('The listing is '+result.listing.state+'. No cancellation is recorded. You may retry the same choice.');
  }catch(error){if(epoch===generation){if([401,403].includes(error.status))clear('Your account changed. Refresh before checking history.');else setStatus(error.status===404?'No saved receipt is visible yet. Keep this request and check again, or explicitly retry the same request.':error.message);}}
  finally{if(epoch===generation){busy=false;controls();}}
 }
 get('refresh').addEventListener('click',load);get('confirm').addEventListener('click',confirm);get('retry').addEventListener('click',confirm);get('check').addEventListener('click',check);
 get('discard').addEventListener('click',()=>{if(busy||attempt)return;review=null;get('review').hidden=true;controls();});
 get('offer').addEventListener('submit',event=>{event.preventDefault();if(!writable()||review)return;const value=get('price').value.trim(),cost=Number(value),skin=get('skin').selectedOptions[0];if(!/^\d+$/.test(value)||!Number.isSafeInteger(cost)||cost<1||!skin?.value){setStatus('Choose a skin and a positive whole-number price.');return;}choose('offer',{presetId:skin.value,price:cost,requestId:crypto.randomUUID()},'List '+skin.textContent+' for '+money(cost)+'? The listing lasts seven days; the unlock stays yours until a buyer confirms.');});
 get('more-skins').addEventListener('click',()=>next('skins'));for(const kind of ['listings','own','history'])get('next-'+kind).addEventListener('click',()=>next(kind));
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&started)clear('Private market data cleared. Refresh when you return.');});window.addEventListener('focus',()=>{if(started&&binding)clear('Refresh to load your current account.');});
 const identityTimer=setInterval(()=>{if(binding&&!document.hidden&&!busy){const epoch=generation;identity(epoch).catch(()=>{if(epoch===generation)clear('Account verification is unavailable. Refresh before continuing.');});}},30000);window.addEventListener('pagehide',()=>{clearInterval(identityTimer);clear();});
 void load();
})();
