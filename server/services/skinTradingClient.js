'use strict';
const ACTIONS=new Set(['list','eligible','history','receipt','offerReceipt','ownListing','offer','buy','cancel']);
async function request(action,body,admin=false){
 if(!(admin?['read','receipt','change'].includes(action):ACTIONS.has(action)))throw Error('Invalid trading operation');
 const base=String(process.env.AUTOMATION_SERVICE_URL||'').trim().replace(/\/$/,''),token=String(admin?process.env.AUTOMATION_ADMIN_TOKEN||'':process.env.HOLLOW_VALLEY_API_TOKEN||'').trim();
 const fail=(status,message)=>Object.assign(new Error(message),{status});
 if(!/^https?:\/\//i.test(base)||!token)throw fail(503,'Skin trading is not configured');
 const configured=Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS||8000),timeout=Number.isFinite(configured)?Math.max(1000,Math.min(30000,configured)):8000;
 let response,payload;
 try{
  response=await fetch(base+(admin?'/api/admin/skin-market/':'/api/website/skin-trading/')+action,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const reader=response.body?.getReader();if(!reader)throw Error('Missing response');let size=0,chunks=[];
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024){await reader.cancel();throw Error('Oversized response');}chunks.push(value);}
  payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch{throw fail(502,'The trading service could not confirm this request. Check its status before retrying.');}
 if(!response.ok){const status=[400,403,404,409,429,503].includes(response.status)?response.status:502;throw fail(status,status===502?'Trading records are temporarily unavailable':String(payload?.error||'The trading request could not be completed').slice(0,240));}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw fail(502,'The trading response could not be verified');return payload;
}
module.exports={call:(action,body)=>request(action,body),callAdmin:(action,body)=>request(action,body,true)};
