import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openStore, hash, entitled } from './store.mjs';
import { TRADE_RULES, LOCATIONS, selectRows, validatePreferences } from './model.mjs';
import { csvReport, pdfReport } from './reports.mjs';
import { stripeClient, checkout, handleWebhook, reconcileCustomer } from './billing.mjs';
import { scheduledDue, weekly } from './jobs.mjs';
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>262144)throw Object.assign(new Error('Request too large'),{status:413});chunks.push(c);}return Buffer.concat(chunks);}
export function makeServer(db,{env=process.env}={}) {
  // One process serializes webhook reconciliation, preventing stale concurrent API responses overwriting access.
  let webhookQueue=Promise.resolve();
  const rates=new Map();
  return createServer(async(req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/healthz')return json(200,{status:'ok',mode:'pilot-test-only'});
      if(req.method==='POST'&&url.pathname==='/api/stripe/webhook') {
        const raw=await body(req),stripe=stripeClient(env);
        const task=webhookQueue.then(()=>handleWebhook(db,raw,req.headers['stripe-signature'],stripe,env));webhookQueue=task.catch(()=>{});
        return json(200,await task);
      }
      if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){
        const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);
        res.setHeader('Content-Type',filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript':'text/css');return res.end(await readFile(new URL(`../public/${filename}`,import.meta.url)));
      }
      const key=req.socket.remoteAddress,minute=Math.floor(Date.now()/60000),rate=rates.get(key);
      if(!rate||rate.minute!==minute)rates.set(key,{minute,count:1});else if(++rate.count>120)return json(429,{error:'Please wait a minute'});
      if(rates.size>10000)rates.clear();
      const token=req.headers.authorization?.replace(/^Bearer /,'');
      const c=token?db.prepare('SELECT * FROM customers WHERE token_hash=?').get(hash(token)):null;
      if(!c)return json(401,{error:'Enter your pilot access key'});
      if(c.stripe_customer){
        const last=db.prepare('SELECT MAX(checked_at) AS checked FROM subscriptions WHERE customer_id=?').get(c.id).checked||0;
        if(last<Date.now()/1000-43200)await reconcileCustomer(db,c,stripeClient(env),env.BI_STRIPE_PRICE_ID);
      }
      if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==new URL(env.BI_PUBLIC_URL||'http://localhost:3080').origin)return json(403,{error:'Origin rejected'});
      if(req.method==='GET'&&url.pathname==='/api/me')return json(200,{email:c.email,preferences:JSON.parse(c.preferences),email_consent:!!c.consent,entitled:entitled(db,c.id),trades:Object.keys(TRADE_RULES),locations:LOCATIONS,billing_enabled:env.BI_STRIPE_ENABLED==='true'});
      if(req.method==='POST'&&url.pathname==='/api/preferences'){
        const p=JSON.parse((await body(req)).toString()),prefs=validatePreferences(p);
        db.prepare('UPDATE customers SET preferences=?,consent=? WHERE id=?').run(JSON.stringify(prefs),Number(p.email_consent===true),c.id);return json(200,{saved:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/checkout')return json(200,{url:await checkout(db,c,stripeClient(env),env)});
      if(req.method==='POST'&&url.pathname==='/api/billing-portal'){
        if(!c.stripe_customer)return json(400,{error:'No test subscription yet'});
        const session=await stripeClient(env).billingPortal.sessions.create({customer:c.stripe_customer,return_url:env.BI_PUBLIC_URL+'/'});return json(200,{url:session.url});
      }
      if(!entitled(db,c.id))return json(403,{error:'An active, recently verified pilot entitlement is required'});
      if (req.method === 'GET' && env.RENDER_SERVICE_NAME === 'hvs-bi-pilot-staging' &&
          ['/api/verified-weekly.pdf','/api/verified-weekly.csv'].includes(url.pathname)) {
        const extension = url.pathname.endsWith('.pdf') ? 'pdf' : 'csv';
        const data = await readFile('reports/verified-weekly/opportunities.' + extension);
        res.setHeader('Content-Type', extension === 'pdf' ? 'application/pdf' : 'text/csv');
        return res.end(data);
      }
      const rows=selectRows(db,JSON.parse(c.preferences)),health=db.prepare('SELECT * FROM sources').all();
      if(req.method==='GET'&&url.pathname==='/api/opportunities')return json(200,{rows,health});
      if(req.method==='GET'&&url.pathname==='/api/report.csv'){res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="hvs-bi.csv"');return res.end(csvReport(rows));}
      if(req.method==='GET'&&url.pathname==='/api/report.pdf'){res.setHeader('Content-Type','application/pdf');return res.end(await pdfReport(rows,{label:'Current matching records',health}));}
      return json(404,{error:'Not found'});
    }catch(e){console.error('Request failed:',e.name);return json(e.status||400,{error:'Request could not be completed. Check configuration or input; no live payments are supported.'});}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const db=openStore(),server=makeServer(db);server.listen(Number(process.env.PORT||3080),process.env.HOST||'127.0.0.1',()=>console.log('HVS BI pilot ready'));
  let busy=false;
  const timer=setInterval(async()=>{if(process.env.BI_SCHEDULE_ENABLED==='true'&&scheduledDue()&&!busy){busy=true;try{console.log(await weekly(db));}catch(e){console.error(e.message);}finally{busy=false;}}},60000);
  async function close(){clearInterval(timer);server.close(()=>{db.close();process.exit(0);});}
  process.on('SIGTERM',close);process.on('SIGINT',close);
}
