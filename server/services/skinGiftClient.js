async function call(path,{method='GET',body}={}) {
  const base=String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/,'');
  const token=String(process.env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  if (!/^https?:\/\//i.test(base) || !token) {
    const error=new Error('Skin gifting service is not configured.');error.status=503;throw error;
  }
  const timeout=Math.max(1000,Math.min(30000,Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  let response;
  try {
    response=await fetch(`${base}/api/website/skin-gifts${path}`,{
      method,headers:{Accept:'application/json',Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),
    });
  } catch(cause) {const error=new Error('Skin gifting service is temporarily unavailable. You can retry safely.');error.status=503;error.code='SKIN_GIFT_SERVICE_UNAVAILABLE';error.cause=cause;throw error;}
  const payload=await response.json().catch(()=>null);
  if (!response.ok) {const error=new Error(payload?.error || 'Skin gifting request failed.');error.status=response.status;error.code=payload?.code;error.payload=payload;throw error;}
  if (!payload || typeof payload!=='object') {const error=new Error('Skin gifting service returned an invalid response.');error.status=502;throw error;}
  return payload;
}
module.exports=Object.fromEntries(['list','eligible','offer','decide','reconcile'].map(action=>[action,body=>call('/'+action,{method:'POST',body})]));
