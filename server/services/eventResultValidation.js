"use strict";
const problem=(message)=>Object.assign(new Error(message),{code:'INVALID_EVENT_RESULT',status:400});
const text=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max+1):'';
function validateEventResult(value,nowMs=Date.now(),{allowEngine=false,minTitle=8}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw problem('Invalid event result.');
 const key=text(value.eventKey,60),title=text(value.title,120),summary=text(value.summary,1000),at=Date.parse(value.eventAt);
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,59}$/.test(key)||(!allowEngine&&/^engine-/i.test(key))||title.length<minTitle||title.length>120||summary.length<40||summary.length>1000||/\b\d{17}\b/.test(title)||/\b\d{17}\b/.test(summary)||!Number.isFinite(at)||at>nowMs+60000||at<nowMs-366*86400000)throw problem('Enter a unique unreserved event key, title, 40–1,000 character summary and a completed event date within the past year.');
 if(!Array.isArray(value.winners)||value.winners.length>5)throw problem('Enter at most five winner display names.');
 const winners=value.winners.map(x=>text(x,80));if(winners.some(x=>x.length<2||x.length>80||/\b\d{17}\b/.test(x)))throw problem('Use winner display names without Steam IDs (2–80 characters).');
 if(allowEngine&&/(?:discord\.com|discordapp\.com)\/channels\//i.test([title,summary,...winners].join(' ')))throw problem('Keep private Discord evidence messages out of public report fields.');
 return {key,title,summary,time:new Date(at).toISOString(),winners};
}
module.exports={validateEventResult};
