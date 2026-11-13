// A fixed private-network destination, never a URL supplied by a browser.
const http = require('node:http');
const https = require('node:https');

function adminProxy(req, res) {
  if (process.env.HERBY_ADMIN_PROXY_ENABLED !== 'true') return res.sendStatus(404);
  let target;
  try {
    const base = new URL(process.env.HERBY_ADMIN_INTERNAL_URL);
    if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/') throw new Error('bad target');
    target = new URL('/herby-admin'+(req.url.startsWith('/')?req.url:'/'+req.url),base);
    if (target.origin !== base.origin) throw new Error('bad origin');
    if (/%(?:2f|5c|2e|25)/i.test(target.pathname)) throw new Error('encoded path');
    if (target.pathname !== '/herby-admin' && !target.pathname.startsWith('/herby-admin/')) throw new Error('bad path');
  } catch { return res.sendStatus(503); }
  if (!['GET','HEAD','POST'].includes(req.method)) return res.sendStatus(405);
  const length = Number(req.headers['content-length'] || 0);
  if (length > 16384) return res.sendStatus(413);
  const headers = {};
  for (const name of ['cookie','content-type','content-length','origin','accept','x-herby-timestamp','x-herby-signature']) {
    if (req.headers[name]) headers[name]=req.headers[name];
  }
  const transport = target.protocol==='https:' ? https : http;
  const upstream = transport.request(target,{method:req.method,headers,timeout:15000},response=>{
    res.status(response.statusCode);
    for (const name of ['content-type','set-cookie','location','cache-control','content-security-policy','x-content-type-options','referrer-policy']) {
      if (response.headers[name]) res.setHeader(name,response.headers[name]);
    }
    response.on('error',()=>res.destroy());
    response.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent) res.status(502).json({error:'Staff dashboard unavailable'}); else res.destroy();});
  let bytes=0;
  req.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384){upstream.destroy();if(!res.headersSent)res.sendStatus(413);}});
  req.on('aborted',()=>upstream.destroy());
  req.pipe(upstream);
}
module.exports = adminProxy;
