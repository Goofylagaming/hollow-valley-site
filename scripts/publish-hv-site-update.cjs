"use strict";
// GitHub Actions publisher — invoked ONLY after pinned-revision readiness.
// Skips cleanly until a dedicated site-update token has been configured.
async function publishVerifiedSiteRelease({
  sha=process.env.GITHUB_SHA,
  repository=process.env.GITHUB_REPOSITORY,
  token=process.env.HV_SITE_UPDATES_TOKEN,
  base=process.env.HV_SITE_UPDATES_URL || "https://hollow-valley-site.onrender.com",
  fetchImpl=globalThis.fetch,
}={}) {
  if (!token) return { skipped:true, reason:"site-update-token-unconfigured" };
  if (String(token).length < 32) throw new Error("Site update token is too short.");
  if (repository !== "Goofylagaming/hollow-valley-site") throw new Error("Unexpected release repository.");
  if (!/^[a-f0-9]{40}$/.test(String(sha||""))) throw new Error("Invalid GitHub commit SHA.");
  const url=new URL("/api/site-updates/release",base);
  if(url.protocol!=="https:")throw new Error("Site update endpoint must use HTTPS.");
  // Never send secrets in query strings or the response output.
  const response=await fetchImpl(url,{
    method:"POST",
    redirect:"error",
    headers:{
      Authorization:"Bearer "+token,
      Accept:"application/json",
      "Content-Type":"application/json",
    },
    body:JSON.stringify({sha}),
    signal:AbortSignal.timeout(12000),
  });
  let data={};
  try {data=await response.json();}
  catch {}
  if (!response.ok || !data.update?.verifiedLive || data.update.releaseSha!==sha) {
    throw new Error("Verified release notification was not accepted (HTTP "+response.status+").");
  }
  return {published:true,sha,id:data.update.id};
}
if(require.main===module) {
  publishVerifiedSiteRelease().then(result=>{
    if(result.skipped)console.log("Hollow Valley website release feed is not configured. No post was made.");
    else console.log("Verified website revision recorded: "+result.sha.slice(0,8));
  }).catch(error=>{
    console.error(error.message);
    process.exitCode=1;
  });
}
module.exports={publishVerifiedSiteRelease};
