const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const {
 createPrimalboundRouter, cleanApiOrigin, destinationFor, primalboundCookie
} = require("../server/middleware/primalboundGateway");

function request(port, uri, { method="GET", headers={}, body }={}) {
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:"127.0.0.1",port,path:uri,method,headers},res=>{
   const chunks=[];
   res.on("data",x=>chunks.push(x));
   res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString("utf8")}));
  });
  req.on("error",reject);
  if(body)req.write(body);
  req.end();
 });
}
async function withGateway(mock,fn,apiOrigin=undefined){
 const before=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return mock(url,opts)};
 const app=express();
 app.use("/primalbound",createPrimalboundRouter({apiOrigin}));
 const server=await new Promise(resolve=>{const srv=app.listen(0,"127.0.0.1",()=>resolve(srv))});
 try{return await fn(server.address().port,calls)}finally{
  globalThis.fetch=before;
  await new Promise(resolve=>server.close(resolve));
 }
}

test("URL gateway maps only /primalbound assets to a pinned Render static host",()=>{
 assert.equal(destinationFor("/assets/index-123.js").url,"https://primalbound-web-preview.onrender.com/assets/index-123.js");
 assert.equal(destinationFor("/").url,"https://primalbound-web-preview.onrender.com/");
 assert.equal(destinationFor("/api/capabilities").type,"disabled-api");
 assert.equal(destinationFor("/api/capabilities","https://primalbound-cloud-preview.onrender.com").type,"api");
 assert.equal(destinationFor("https://evil.example/"),null);
 assert.equal(destinationFor("//evil.example/"),null);
 assert.equal(destinationFor("/\\evil.example"),null);
 assert.equal(cleanApiOrigin("http://primalbound-cloud-preview.onrender.com"),null);
 assert.equal(cleanApiOrigin("https://attacker.example"),null);
 assert.equal(cleanApiOrigin("https://primalbound-cloud-preview.onrender.com"),"https://primalbound-cloud-preview.onrender.com");
});
test("gateway accepts only isolated Primalbound cookie",()=>{
 const token="x".repeat(43);
 assert.equal(primalboundCookie("connect.sid=HV_SESSION; __Host-primalbound_session="+token+"; csrf=abc"),"__Host-primalbound_session="+token);
 assert.equal(primalboundCookie("connect.sid=HV_SESSION; OtherGame=secret"),null);
});
test("game route responds at nested URL and never forwards Hollow Valley cookies", async()=>{
 await withGateway(
  async()=>new Response("<html><script src='./assets/index.js'></script></html>",{status:200,headers:{"Content-Type":"text/html"}}),
  async(port,calls)=>{
   const redirect=await request(port,"/primalbound");
   assert.equal(redirect.status,308);
   assert.equal(redirect.headers.location,"/primalbound/");
   const home=await request(port,"/primalbound/",{headers:{Cookie:"connect.sid=secret; SteamAuth=secret"}});
   assert.equal(home.status,200);
   assert.match(home.body,/assets\/index\.js/);
   assert.equal(home.headers["x-frame-options"],"DENY");
   assert.match(home.headers["content-security-policy"],/script-src 'self'/);
   assert.equal(calls[0].url,"https://primalbound-web-preview.onrender.com/");
   assert.equal(calls[0].opts.headers.Cookie,undefined);
   const js=await request(port,"/primalbound/assets/index.js");
   assert.equal(js.status,200);
   assert.equal(calls[1].url,"https://primalbound-web-preview.onrender.com/assets/index.js");
  }
 );
});
test("cloud API stays explicitly disabled when no dedicated account server configured",async()=>{
 await withGateway(async()=>{throw new Error("Unexpected remote request")},async(port,calls)=>{
  const cap=await request(port,"/primalbound/api/capabilities");
  assert.equal(cap.status,200);
  assert.equal(JSON.parse(cap.body).accounts,false);
  const posted=await request(port,"/primalbound/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"username":"Someone"}'});
  assert.equal(posted.status,503);
  assert.equal(calls.length,0);
 });
});
test("configured cloud API rewrites same-origin POST safely, forwarding only a Primalbound cookie", async()=>{
 const token="b".repeat(43);
 await withGateway(
  async()=>new Response(JSON.stringify({user:{username:"Player"}}),{status:200,headers:{"Content-Type":"application/json","Set-Cookie":"__Host-primalbound_session="+token+"; Path=/; Secure; HttpOnly; SameSite=Lax"}}),
  async(port,calls)=>{
   const body=JSON.stringify({username:"Player",password:"PasswordOnlyForTest123!"});
   const disallowed=await request(port,"/primalbound/api/auth/login",{method:"POST",headers:{"Host":"hollowvalleyisle.com","Origin":"https://evil.example","Content-Type":"application/json"},body});
   assert.equal(disallowed.status,403);
   const allowed=await request(port,"/primalbound/api/auth/login",{method:"POST",headers:{"Host":"hollowvalleyisle.com","Origin":"https://hollowvalleyisle.com","Content-Type":"application/json","Cookie":"connect.sid=HVsecret; __Host-primalbound_session="+token},body});
   assert.equal(allowed.status,200);
   assert.equal(calls.length,1);
   assert.equal(calls[0].url,"https://primalbound-cloud-preview.onrender.com/api/auth/login");
   assert.equal(calls[0].opts.headers.Origin,"https://primalbound-cloud-preview.onrender.com");
   assert.equal(calls[0].opts.headers.Cookie,"__Host-primalbound_session="+token);
   assert.equal(Buffer.from(calls[0].opts.body).toString("utf8"),body);
   assert.ok(allowed.headers["set-cookie"]?.length);
   assert.ok(allowed.headers["set-cookie"][0].includes("Secure"));
  },
  "https://primalbound-cloud-preview.onrender.com"
 );
});
