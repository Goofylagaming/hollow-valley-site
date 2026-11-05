(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HVLiveMapObservation=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function current(data,now=Date.now()){
  if(!data||typeof data!=='object'||Array.isArray(data))return {connected:false,configured:false,me:null,others:[],sourceStatus:'unavailable'};
  if(data.connected!==true)return {...data,connected:false,me:null,others:[],sourceStatus:data.connected===false?data.sourceStatus||'unavailable':'unavailable'};
  const at=typeof data.lastChecked==='string'?Date.parse(data.lastChecked):NaN;
  const valid=Number.isSafeInteger(at)&&at>=0&&new Date(at).toISOString()===data.lastChecked&&Number.isSafeInteger(now)&&now>=0;
  if(!valid||at>now||now-at>120000)return {...data,connected:false,me:null,others:[],sourceStatus:valid&&at<=now?'stale':'unverified-clock'};
  return data;
 }
 return {current};
});
