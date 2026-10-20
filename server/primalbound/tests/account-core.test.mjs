import test from "node:test";
import assert from "node:assert/strict";
import {
 validUsername,validPassword,normaliseUsername,hashPassword,checkPassword,
 newSessionToken,hashSession,setSessionCookie,clearSessionCookie,tokenFromCookie,
 safeOrigin,validateCloudSave,checkSaveRevision,rateLimit
} from "../account-core.mjs";
const validSave={version:7,stage:75,dinos:Array.from({length:49},(_,i)=>({id:"creature-"+i,owned:true,level:1})),active:["creature-0"],bones:250,inventory:{items:[],equipped:{}},hatchery:{eggs:[]}};
test("restrict account usernames and strong non-common passwords",()=>{
 assert.equal(validUsername("Raptor_200"),true);
 assert.equal(validUsername("2raptor"),false);
 assert.equal(validUsername("ab"),false);
 assert.equal(validUsername("x".repeat(25)),false);
 assert.equal(validUsername("a<script>"),false);
 assert.equal(normaliseUsername("GAMER_7"),"gamer_7");
 assert.equal(validPassword("12-characters-or-longer"),true);
 assert.equal(validPassword("short"),false);
 assert.equal(validPassword("password123456"),false);
});
test("password hashes use unique salts and correctly verify without storing plaintext",async()=>{
 const password="DifferentEverySite-2026!";
 const a=await hashPassword(password),b=await hashPassword(password);
 assert.ok(a.startsWith("scrypt$16384$8$1$"));
 assert.notEqual(a,b);
 assert.equal(a.includes(password),false);
 assert.equal(await checkPassword(password,a),true);
 assert.equal(await checkPassword("WrongPassword2026!",a),false);
 assert.equal(await checkPassword(password,"invalid"),false);
});
test("session token is unpredictable and only SHA-256 hash stored",()=>{
 const token=newSessionToken(),other=newSessionToken();
 assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(token,other);
 assert.match(hashSession(token),/^[0-9a-f]{64}$/);
 assert.notEqual(hashSession(token),token);
});
test("cookie sessions are HttpOnly Secure SameSite=Lax and scoping uses __Host-",()=>{
 const token=newSessionToken(),header=setSessionCookie(token);
 assert.match(header,/^__Host-primalbound_session=/);
 assert.match(header,/; Path=\//);
 assert.match(header,/; HttpOnly/);
 assert.match(header,/; Secure/);
 assert.match(header,/; SameSite=Lax/);
 assert.doesNotMatch(header,/Domain=/);
 assert.equal(tokenFromCookie("other=1; "+header.split(";")[0]+"; another=2"),token);
 assert.equal(tokenFromCookie("other=1"),null);
 assert.match(clearSessionCookie(),/Max-Age=0/);
});
test("API writes require origin equal to HTTPS account service host",()=>{
 assert.equal(safeOrigin("https://primalbound-cloud-preview.onrender.com","primalbound-cloud-preview.onrender.com"),true);
 assert.equal(safeOrigin("https://malicious.example","primalbound-cloud-preview.onrender.com"),false);
 assert.equal(safeOrigin("http://primalbound-cloud-preview.onrender.com","primalbound-cloud-preview.onrender.com"),false);
 assert.equal(safeOrigin(undefined,"primalbound-cloud-preview.onrender.com"),false);
});
test("cloud saves are bounded, minimally structured and use optimistic integer revisions",()=>{
 assert.equal(validateCloudSave(validSave),null);
 assert.equal(validateCloudSave({...validSave,stage:752}),"Invalid campaign stage.");
 assert.ok(validateCloudSave({...validSave,version:8}));
 assert.ok(validateCloudSave({...validSave,active:[]}));
 assert.ok(validateCloudSave({...validSave,bones:-1}));
 assert.ok(validateCloudSave({...validSave,dinos:[]}));
 assert.ok(validateCloudSave({...validSave,hatchery:null}));
 assert.ok(validateCloudSave({...validSave,extra:"x".repeat(300000)}));
 assert.equal(checkSaveRevision(0),true);
 assert.equal(checkSaveRevision(250),true);
 assert.equal(checkSaveRevision(-1),false);
 assert.equal(checkSaveRevision(1.5),false);
});
test("server-side rate limits throttle excessive requests by key",()=>{
 const block=rateLimit(2,1000);
 assert.equal(block("ip",1000),false);
 assert.equal(block("ip",1001),false);
 assert.equal(block("ip",1002),true);
 assert.equal(block("other",1002),false);
 assert.equal(block("ip",2001),false);
});
