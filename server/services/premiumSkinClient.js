async function call(path,{method='GET',body}={}) {
  const base=String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/,'');
  const token=String(process.env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  if (!/^https?:\/\//i.test(base) || !token) {
    const error=new Error('Premium skin service is not configured.');error.status=503;throw error;
  }
  const timeout=Math.max(1000,Math.min(30000,Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  let response;
  try {
    response=await fetch(`${base}/api/website/premium-skins${path}`,{
      method,headers:{Accept:'application/json',Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),
    });
  } catch(cause) {const error=new Error('Premium skin service is temporarily unavailable. You can retry safely.');error.status=503;error.code='PREMIUM_SKIN_SERVICE_UNAVAILABLE';error.cause=cause;throw error;}
  const payload=await response.json().catch(()=>null);
  if (!response.ok) {const error=new Error(payload?.error || 'Premium skin request failed.');error.status=response.status;error.code=payload?.code;error.payload=payload;throw error;}
  if (!payload || typeof payload!=='object') {const error=new Error('Premium skin service returned an invalid response.');error.status=502;throw error;}
  return payload;
}
function steamQuery(steamId) {return steamId ? `?steamId=${encodeURIComponent(String(steamId))}`:'';}
module.exports={
  listCatalog:(steamId)=>call(`/catalog${steamQuery(steamId)}`),
  listAdmin:(steamId)=>call(`/admin${steamQuery(steamId)}`),
  fulfillClaim:({claimId,steamId,skinId})=>call('/fulfill',{method:'POST',body:{claimId,steamId,skinId}}),
  seedDrafts:(actorSteamId)=>call('/admin/seed-drafts',{method:'POST',body:{actorSteamId}}),
  draftFromPreset:({actorSteamId,presetId,collection})=>call('/admin/drafts',{method:'POST',body:{actorSteamId,presetId,collection}}),
  updateDraft:({skinId,...body})=>call(`/admin/${encodeURIComponent(skinId)}`,{method:'PUT',body}),
  verifyDraft:({skinId,...body})=>call(`/admin/${encodeURIComponent(skinId)}/verify`,{method:'POST',body}),
  setPublished:({skinId,...body})=>call(`/admin/${encodeURIComponent(skinId)}/publish`,{method:'POST',body}),
};
