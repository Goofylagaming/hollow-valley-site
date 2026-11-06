"use strict";
const {project,toLatLong,nearestRegion,gridCell,fromRconLocation,BOUNDS,REGIONS}=require('../evrimaMap');
const {sourceTime}=require('./sourceTimestamp');
const MAX_AGE_MS=120000;
const REGION_LABELS=REGIONS.map(([name,lat,long])=>({name,position:project(lat*1000,long*1000)}));
function position(character){
 const {x,y,z}=fromRconLocation(character?.location),valid=Number.isFinite(x)&&Number.isFinite(y)&&x>=BOUNDS.minX&&x<=BOUNDS.maxX&&y>=BOUNDS.minY&&y<=BOUNDS.maxY;
 return {position:valid?project(x,y):null,coords:Number.isFinite(x)&&Number.isFinite(y)?toLatLong(x,y):null,altitude:Number.isFinite(z)?Math.round(z/1000):null,region:valid?nearestRegion(x,y):null,grid:valid?gridCell(x,y):null};
}
function source(state,now=Date.now()){
 if(state?.configured!==true)return {code:'not-configured',at:null};
 const at=sourceTime(state.lastChecked);
 if(at===null||!Number.isSafeInteger(now)||now<0||at>now)return {code:'unverified-clock',at:null};
 if(state.stale||now-at>MAX_AGE_MS)return {code:'stale',at};
 if(state.online!==true)return {code:state.online===false?'verified-offline':'unavailable',at};
 if(!Array.isArray(state.characters)||state.characters.length>1000)return {code:'unavailable',at};
 return {code:'fresh',at};
}
function detailed(character){return {name:character.name,species:character.species,gender:character.gender,isPrime:character.isPrime,mutations:character.mutations,growth:character.growth,health:character.health,stamina:character.stamina,hunger:character.hunger,thirst:character.thirst,...position(character)};}
function positions(state,user,now=Date.now()){
 const status=source(state,now),common={configured:state?.configured===true,linked:Boolean(user?.steam_id),bounds:BOUNDS,regions:REGION_LABELS,lastChecked:status.at===null?null:new Date(status.at).toISOString(),sourceStatus:status.code,maxPlayers:state?.maxPlayers??null};
 if(status.code!=='fresh')return {...common,connected:false,me:null,others:[],playerCount:0};
 const mine=user?.steam_id?state.characters.find(c=>c?.steamId===user.steam_id):null;
 return {...common,connected:true,me:mine?detailed(mine):null,others:state.characters.filter(c=>c&&c!==mine).map(user?.is_admin?detailed:c=>({name:c.name,species:c.species,isPrime:c.isPrime})),othersHavePositions:Boolean(user?.is_admin),playerCount:state.playerCount};
}
function health(state,now=Date.now()){
 const status=source(state,now),base={id:'map-source',scope:'cached-position-source',code:status.code,observedAt:status.at===null?null:new Date(status.at).toISOString(),renderingVerified:false};
 if(status.code!=='fresh')return base;
 if(!state.characters.length)return {...base,code:'no-position-observation'};
 // Check the same projection used by authenticated map reads, never return it.
 for(const character of state.characters)if(!character||!position(character).position)return {...base,code:'unprojectable'};
 return {...base,code:'usable'};
}
module.exports={positions,health,position,MAX_AGE_MS};
