import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { openStore, createCustomer } from './store.mjs';
import { weekly } from './jobs.mjs';

export async function verifyStagingWeekly() {
  if (process.env.RENDER_SERVICE_NAME !== 'hvs-bi-pilot-staging' ||
      process.env.BI_EMAIL_ENABLED !== 'false' ||
      process.env.BI_STRIPE_ENABLED !== 'false') {
    throw new Error('Dry run requires the isolated staging service with email and billing disabled');
  }
  const dir = await mkdtemp(join(tmpdir(), 'hvs-bi-weekly-'));
  const db = openStore(':memory:');
  try {
    const customer = createCustomer(db, 'weekly-verification@example.invalid');
    const trade = process.env.BI_VERIFY_STAGING_TRADE;
    const location = process.env.BI_VERIFY_STAGING_LOCATION;
    if (trade || location) {
      db.prepare('UPDATE customers SET preferences=? WHERE id=?')
        .run(JSON.stringify({trades:trade?[trade]:[], locations:location?[location]:[]}), customer.id);
    }
    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)')
      .run('staging-verification', customer.id, 'trialing', now + 3600, 0, now);
    const result = await weekly(db, {env: {
      BI_REPORT_DIR: dir, BI_EMAIL_ENABLED: 'false', BI_STRIPE_ENABLED: 'false'
    }});
    const report = join(dir, result.week, customer.id);
    const pdf = await readFile(join(report, 'opportunities.pdf'));
    const csv = parse(await readFile(join(report, 'opportunities.csv')), {columns: true, skip_empty_lines: true});
    if (trade && csv.some(row => !row.trades.split('; ').includes(trade))) {
      throw new Error('Weekly CSV contains a row outside the selected trade');
    }
    if (location && csv.some(row => row.location !== location)) {
      throw new Error('Weekly CSV contains a row outside the selected location');
    }
    const preview = JSON.parse(await readFile(join(report, 'email-preview.json'), 'utf8'));
    const counts = Object.fromEntries(['logan','brisbane','qld'].map(source =>
      [source, csv.filter(row => row.id.startsWith(source + ':')).length]));
    const delivery = db.prepare('SELECT status FROM deliveries WHERE customer_id=?').get(customer.id)?.status;
    const job = db.prepare('SELECT status FROM jobs WHERE id=?').get('weekly:' + result.week)?.status;
    if (result.customers !== 1 || job !== 'complete' || delivery !== 'dry_run' ||
        pdf.subarray(0,5).toString() !== '%PDF-' || !pdf.toString('ascii').trimEnd().endsWith('%%EOF') ||
        csv.length === 0 || result.sources.length !== 3 || csv.length !== Object.values(counts).reduce((sum,n)=>sum+n,0) ||
        preview.attachments.map(a=>a.filename).sort().join(',') !== 'opportunities.csv,opportunities.pdf') {
      throw new Error('Weekly dry-run output did not pass verification');
    }
    if (process.env.BI_SAVE_STAGING_WEEKLY === 'true') {
      const {mkdir, copyFile} = await import('node:fs/promises');
      await mkdir('reports/verified-weekly', {recursive:true});
      for (const file of ['opportunities.pdf','opportunities.csv']) {
        await copyFile(join(report,file),join('reports/verified-weekly',file));
      }
    }
    console.log('HVS BI WEEKLY VERIFIED ' + JSON.stringify({week:result.week,trade,location,job,delivery,counts,pdfBytes:pdf.length,csvRows:csv.length}));
  } finally {
    db.close();
    await rm(dir,{recursive:true,force:true});
  }
}
