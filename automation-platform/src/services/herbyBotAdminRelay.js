// Ephemeral bounded transport. Staff authorization and CSRF remain in HerbyBot.
const { randomUUID } = require('node:crypto');
const express = require('express');
const incoming = ['cookie','content-type','origin','accept','x-herby-timestamp','x-herby-signature'];
const outgoing = ['content-type','set-cookie','location','cache-control','content-security-policy','x-content-type-options','referrer-policy'];
function createRelay({ timeoutMs = 20000 } = {}) {
  const jobs = new Map();
  let waiter = null;
  function front(req,res) {
    if (process.env.HERBY_ADMIN_RELAY_ENABLED !== 'true') return res.sendStatus(404);
    if (!['GET','HEAD','POST'].includes(req.method)) return res.sendStatus(405);
    const path = '/herby-admin' + req.url;
    const normalized = new URL(path,'http://local').pathname;
    if (path.length > 4096 || /%(?:2f|5c|2e|25)/i.test(normalized) || normalized.includes('\\') ||
        (normalized !== '/herby-admin' && !normalized.startsWith('/herby-admin/'))) return res.sendStatus(400);
    if (jobs.size >= 16) return res.sendStatus(503);
    if (Number(req.headers['content-length'] || 0) > 16384) return res.sendStatus(413);
    const id = randomUUID();
    const job = { res, claimed:false, request:{ id,method:req.method,path,headers:{},body:'' } };
    for (const name of incoming) if(req.headers[name]) job.request.headers[name]=req.headers[name];
    jobs.set(id,job);
    const clean = () => { clearTimeout(job.timer); jobs.delete(id); };
    job.timer=setTimeout(()=>{clean();if(!res.writableEnded)res.sendStatus(504);},timeoutMs);
    res.on('close',clean);
    let size=0; const chunks=[];
    req.on('data',chunk=>{size+=chunk.length;if(size>16384){clean();if(!res.writableEnded)res.sendStatus(413);}else chunks.push(chunk);});
    req.on('end',()=>{
      if(!jobs.has(id)) return;
      job.request.body=Buffer.concat(chunks).toString('base64');
      job.complete=true;
      if(waiter){const wake=waiter;waiter=null;wake();}
    });
    req.on('error',clean);
  }
  // Mounted after service-token authentication, with a bounded JSON parser.
  const router=express.Router();
  router.use((req,res,next)=>process.env.HERBY_ADMIN_RELAY_ENABLED==='true'?next():res.sendStatus(404));
  router.get('/jobs',async(req,res)=>{
    const select=()=>{for(const job of jobs.values())if(job.complete&&!job.claimed){job.claimed=true;return job.request;}return null;};
    let job=select();
    if(!job){
      if(waiter) return res.status(409).json({error:'Poll already active'});
      await new Promise(resolve=>{const done=()=>{clearTimeout(timer);if(waiter===done)waiter=null;resolve();};const timer=setTimeout(done,5000);waiter=done;});
      job=select();
    }
    res.set('Cache-Control','no-store').json({job});
  });
  router.post('/jobs/:id', (req,res)=>{
    const job=jobs.get(req.params.id); if(!job||!job.claimed)return res.sendStatus(410);
    const result=req.body;
    if(!Number.isInteger(result.status)||result.status<200||result.status>599||typeof result.body!=='string'||result.body.length>350000||!Array.isArray(result.headers))return res.sendStatus(400);
    const body=Buffer.from(result.body,'base64'); if(body.length>262144)return res.sendStatus(413);
    const headers={};
    for(const pair of result.headers){
      if(!Array.isArray(pair)||pair.length!==2||!outgoing.includes(String(pair[0]).toLowerCase())||typeof pair[1]!=='string'||/[\r\n]/.test(pair[1]))return res.sendStatus(400);
      const name=pair[0].toLowerCase(); (headers[name] ||= []).push(pair[1]);
    }
    clearTimeout(job.timer);jobs.delete(req.params.id);
    job.res.status(result.status);
    for(const [name,values] of Object.entries(headers))job.res.setHeader(name, name==='set-cookie'?values:values.join(', '));
    job.res.end(body);res.json({ok:true});
  });
  return {front,router};
}
module.exports={createRelay,relay:createRelay()};
