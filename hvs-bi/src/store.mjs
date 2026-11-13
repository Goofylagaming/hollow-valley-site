import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const nowISO = () => new Date().toISOString();
export function openStore(path = process.env.BI_DB_PATH || './data/bi.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY, source TEXT NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL, first_seen TEXT NOT NULL, changed_at TEXT NOT NULL, last_seen TEXT NOT NULL, present INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, last_attempt TEXT, last_success TEXT, status TEXT, count INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, preferences TEXT NOT NULL, stripe_customer TEXT UNIQUE, consent INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, status TEXT NOT NULL, valid_until INTEGER NOT NULL, cancel_at_period_end INTEGER NOT NULL, checked_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, week TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(customer_id,week));
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) {db.exec('ROLLBACK');throw e;}
}
export function ingest(db, source, rows, time=nowISO()) {
  if (!rows.length) throw new Error('Empty source snapshot: retained previous data');
  const unique = new Map();
  for (const row of rows) {
    if (!row.id || !row.title || !row.source_url || row.source !== source) throw new Error('Invalid normalized record');
    const old=unique.get(row.id);
    if (old) { old.address=[...new Set([old.address,row.address].filter(Boolean))].sort().join('; '); old.flags=[...new Set([...old.flags,...row.flags,'multiple_source_rows'])]; }
    else unique.set(row.id,structuredClone(row));
  }
  return transaction(db,()=>{
    let inserted=0,updated=0;
    db.prepare('UPDATE opportunities SET present=0 WHERE source=?').run(source);
    for (const row of unique.values()) {
      const body=JSON.stringify(row), fingerprint=hash(body);
      const old=db.prepare('SELECT fingerprint FROM opportunities WHERE id=?').get(row.id);
      if(!old) inserted++; else if(old.fingerprint!==fingerprint) updated++;
      db.prepare(`INSERT INTO opportunities VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,body=excluded.body,changed_at=CASE WHEN opportunities.fingerprint!=excluded.fingerprint THEN excluded.changed_at ELSE opportunities.changed_at END,last_seen=excluded.last_seen,present=1`).run(row.id,source,fingerprint,body,time,time,time);
    }
    db.prepare(`INSERT INTO sources VALUES(?,?,?,'ok',?,NULL) ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,status='ok',count=excluded.count,error=NULL`).run(source,time,time,unique.size);
    return {source,count:unique.size,inserted,updated};
  });
}
export function sourceFailure(db,id,error) {
  db.prepare(`INSERT INTO sources(id,last_attempt,status,error) VALUES(?,?,'failed',?) ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt,status='failed',error=excluded.error`).run(id,nowISO(),String(error.message).slice(0,200));
}
export function createCustomer(db,email,consent=false) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email required');
  const token=randomBytes(32).toString('base64url'), id=randomUUID();
  db.prepare('INSERT INTO customers(id,email,token_hash,preferences,consent) VALUES(?,?,?,?,?)').run(id,email,hash(token),JSON.stringify({trades:[],locations:[]}),Number(consent));
  return {id,token};
}
export function entitled(db,id,time=Date.now()/1000) {
  return !!db.prepare("SELECT 1 FROM subscriptions WHERE customer_id=? AND status IN ('active','trialing') AND valid_until>? AND checked_at>? LIMIT 1").get(id,time,time-86400);
}
