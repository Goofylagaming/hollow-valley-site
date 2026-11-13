import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { syncAll } from './connectors.mjs';
import { selectRows } from './model.mjs';
import { writeReports } from './reports.mjs';
import { entitled, nowISO } from './store.mjs';
import { stripeClient, reconcileCustomer } from './billing.mjs';
export function weekKey(time=new Date()) {
  const local=new Date(time.getTime()+10*3600000);local.setUTCDate(local.getUTCDate()-((local.getUTCDay()+6)%7));return local.toISOString().slice(0,10);
}
export function scheduledDue(time=new Date()) {const d=new Date(time.getTime()+10*3600000);return d.getUTCDay()===1&&d.getUTCHours()>=7;}
export async function deliver(db,c,week,files,env=process.env,fetcher=fetch) {
  const id=`${c.id}:${week}`,existing=db.prepare('SELECT status FROM deliveries WHERE id=?').get(id);
  if(existing&&['sent','sending','uncertain'].includes(existing.status))return existing.status;
  const payload={from:env.BI_EMAIL_FROM,to:[c.email],subject:`HVS BI - weekly construction intelligence - ${week}`,text:'Your filtered weekly report is attached. These are planning signals, not confirmed jobs. Manage preferences or disable email in your HVS BI dashboard.',attachments:[{filename:'opportunities.pdf',content:(await readFile(files.pdf)).toString('base64')},{filename:'opportunities.csv',content:(await readFile(files.csv)).toString('base64')}]};
  const allowed=(env.BI_EMAIL_ALLOWLIST||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const enabled=env.BI_EMAIL_ENABLED==='true'&&c.consent===1&&allowed.includes(c.email.toLowerCase())&&env.RESEND_API_KEY&&env.BI_EMAIL_FROM;
  db.prepare(`INSERT INTO deliveries VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`).run(id,c.id,week,enabled?'sending':'dry_run',nowISO());
  if(!enabled){await writeFile(join(files.pdf.replace(/[^/\\]+$/,''),'email-preview.json'),JSON.stringify({...payload,attachments:payload.attachments.map(x=>({filename:x.filename}))},null,2));return 'dry_run';}
  try {
    const res=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`hvs-bi-${id}`},body:JSON.stringify(payload)});
    if(!res.ok)throw new Error('Email provider rejected request');
    db.prepare("UPDATE deliveries SET status='sent',updated_at=? WHERE id=?").run(nowISO(),id);return 'sent';
  }catch(e){db.prepare("UPDATE deliveries SET status='uncertain',updated_at=? WHERE id=?").run(nowISO(),id);throw e;}
}
export async function weekly(db,{env=process.env,time=new Date(),sync=syncAll}={}) {
  const week=weekKey(time),id=`weekly:${week}`;
  // Atomic claim prevents concurrent/manual duplicate runs. Failed runs may be retried explicitly.
  const claim=db.prepare("INSERT OR IGNORE INTO jobs VALUES(?,'running',?)").run(id,nowISO());
  if(!claim.changes)return {skipped:true,reason:'Week already claimed; inspect jobs before retry'};
  try {
    const sources=await sync(db);
    if(sources.some(s=>s.error))throw new Error('Source sync failed; delivery withheld. Inspect source health.');
    const since=new Date(time.getTime()-7*86400000).toISOString();
    const health=db.prepare('SELECT * FROM sources').all();
    let count=0;
    for(const c of db.prepare('SELECT * FROM customers').all()){
      if(c.stripe_customer)await reconcileCustomer(db,c,stripeClient(env),env.BI_STRIPE_PRICE_ID);
      if(!entitled(db,c.id))continue;
      const rows=selectRows(db,JSON.parse(c.preferences),{since,time});
      const files=await writeReports(rows,join(env.BI_REPORT_DIR||'reports',week,c.id),{label:'New and changed records in the last seven days',health,generatedAt:time});
      await deliver(db,c,week,files,env);count++;
    }
    db.prepare("UPDATE jobs SET status='complete',updated_at=? WHERE id=?").run(nowISO(),id);return {week,customers:count,sources};
  }catch(e){db.prepare("UPDATE jobs SET status='failed',updated_at=? WHERE id=?").run(nowISO(),id);throw e;}
}
