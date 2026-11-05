async function call(path,{method='GET',body}={}) {
  const base=String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/,'');
  const token=String(process.env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  if (!/^https?:\/\//i.test(base) || !token) {
    const error=new Error('Promotional skin service is not configured.');error.status=503;throw error;
  }
  const timeout=Math.max(1000,Math.min(30000,Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  let response;
  try {
    response=await fetch(`${base}/api/website/skin-promos${path}`,{
      method,headers:{Accept:'application/json',Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),
    });
  } catch(cause) {const error=new Error('Promotional skin service is temporarily unavailable. You can retry safely.');error.status=503;error.code='SKIN_PROMO_SERVICE_UNAVAILABLE';error.cause=cause;throw error;}
  const payload=await response.json().catch(()=>null);
  if (!response.ok) {const error=new Error(payload?.error || 'Promotional skin request failed.');error.status=response.status;error.code=payload?.code;error.payload=payload;throw error;}
  if (!payload || typeof payload!=='object') {const error=new Error('Promotional skin service returned an invalid response.');error.status=502;throw error;}
  return payload;
}
module.exports={list:body=>call('/admin/list',{method:'POST',body}),issue:body=>call('/admin/issue',{method:'POST',body}),revoke:body=>call('/admin/revoke',{method:'POST',body}),redeem:body=>call('/redeem',{method:'POST',body})};
