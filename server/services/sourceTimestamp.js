"use strict";
// Explicit UTC source clocks, including Windows round-trip precision.
function sourceTime(value){
 if(typeof value!=='string')return null;
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?Z$/.exec(value);if(!match)return null;
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number);
 if(year<1970||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)return null;
 const at=Date.UTC(year,month-1,day,hour,minute,second,Number((match[7]||'').padEnd(3,'0').slice(0,3)));
 return Number.isSafeInteger(at)&&at>=0?at:null;
}
module.exports={sourceTime};
