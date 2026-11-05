"use strict";
const MAX_LIVE_SAMPLE_AGE_MS=120000;
function observation(state,now=Date.now()) {
  const sampledAt=typeof state?.lastChecked==='string'?Date.parse(state.lastChecked):NaN;
  let reason=null;
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(sampledAt))reason='Automation snapshot time is missing or invalid';
  else if(sampledAt>now)reason='Automation snapshot is future-dated';
  else if(now-sampledAt>MAX_LIVE_SAMPLE_AGE_MS)reason='Automation snapshot has expired';
  else if(state?.stale)reason='Automation snapshot is marked stale';
  return {fresh:reason===null,sampledAt:Number.isSafeInteger(sampledAt)?sampledAt:null,reason};
}
module.exports={observation,MAX_LIVE_SAMPLE_AGE_MS};
