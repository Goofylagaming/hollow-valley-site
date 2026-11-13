import { openStore, createCustomer } from './store.mjs';
import { selectRows } from './model.mjs';
import { syncAll } from './connectors.mjs';
import { writeReports } from './reports.mjs';
import { weekly, weekKey } from './jobs.mjs';
const db=openStore();
try {
  const [command,...args]=process.argv.slice(2);
  if(command==='sync'){const result=await syncAll(db);console.log(JSON.stringify(result,null,2));if(result.some(r=>r.error))process.exitCode=1;}
  else if(command==='report')console.log(await writeReports(selectRows(db),args[0]||'reports/sample',{label:'Pilot sample - all current matching source records',health:db.prepare('SELECT * FROM sources').all()}));
  else if(command==='customer'){
    const c=createCustomer(db,args[0],false);
    console.log(JSON.stringify(c)); // The only display of this access key; deliver securely, never commit it.
    if(args.includes('--local-preview')){
      if(process.env.NODE_ENV==='production')throw new Error('Local preview grants forbidden in production');
      const now=Math.floor(Date.now()/1000);db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(`preview:${c.id}`,c.id,'trialing',now+86400,1,now);
    }
  }
  else if(command==='weekly')console.log(await weekly(db));
  else if(command==='retry-week'){
    const id=`weekly:${weekKey()}`;
    const result=db.prepare("DELETE FROM jobs WHERE id=? AND status='failed'").run(id);console.log({reset:result.changes,note:'Uncertain emails remain blocked. Inspect provider before resetting deliveries.'});
  }
  else throw new Error('Commands: sync | report [directory] | customer email [--local-preview] | weekly | retry-week');
}catch(e){console.error(e.message);process.exitCode=1;}finally{db.close();}
