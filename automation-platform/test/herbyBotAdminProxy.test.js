const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const proxy = require('../src/routes/herbyBotAdminProxy');

test('proxy preserves cookies/forms and cannot escape the admin namespace',async()=>{
  const target=http.createServer((req,res)=>{
    assert.ok(req.url.startsWith('/herby-admin/'));
    res.setHeader('Set-Cookie','herby_admin=value; Secure; HttpOnly; Path=/herby-admin');
    res.end(req.url);
  }).listen(0,'127.0.0.1'); await once(target,'listening');
  process.env.HERBY_ADMIN_PROXY_ENABLED='true';
  process.env.HERBY_ADMIN_INTERNAL_URL=`http://127.0.0.1:${target.address().port}`;
  const front=http.createServer((req,res)=>{
    res.status=code=>{res.statusCode=code;return res;};
    res.sendStatus=code=>{res.statusCode=code;res.end();};
    res.json=value=>res.end(JSON.stringify(value));
    proxy(req,res);
  }).listen(0,'127.0.0.1');await once(front,'listening');
  const base=`http://127.0.0.1:${front.address().port}`;
  try {
    let response=await fetch(base+'/access');
    assert.equal(await response.text(),'/herby-admin/access');
    assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    response=await new Promise((resolve,reject)=>http.get(base+'/..%2f..%2fconfig',r=>{r.resume();resolve(r);}).on('error',reject));
    // Encoded slashes cannot reach a root route on the upstream; the namespace remains fixed.
    assert.equal(response.statusCode,503);
    delete process.env.HERBY_ADMIN_PROXY_ENABLED;
    assert.equal((await fetch(base+'/access')).status,404);
  } finally {front.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise(r=>front.close(r)),new Promise(r=>target.close(r))]);}
});
