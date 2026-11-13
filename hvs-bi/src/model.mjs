export const TRADE_RULES={building:/\b(building|dwelling|house|townhouse|construction|renovation|extension|warehouse)\b/i,roofing:/\b(roof|roofing|gutter)\b/i,plumbing:/\b(plumb\w*|hydraulic|sewer|drainage|water pipe)\b/i,electrical:/\b(electric\w*|lighting|solar|switchboard)\b/i,civil:/\b(civil|road|bridge|earthwork\w*|subdivision|reconfigur\w*|infrastructure)\b/i,landscaping:/\b(park|landscap\w*|recreation|playground)\b/i,hvac:/\b(hvac|aircondition\w*|air.condition\w*|ventilation)\b/i};
export const LOCATIONS=['Logan','Brisbane','Ipswich','Gold Coast','Sunshine Coast','Moreton Bay','Redland','Scenic Rim','Lockyer Valley','Somerset','Statewide'];
export function classify(text) {
  const result=Object.entries(TRADE_RULES).filter(([,r])=>r.test(text)).map(([k])=>k);
  if(/\b(motorways?|roads?|bridges?|interchanges?)\b/i.test(text))result.push('civil');
  if(/\bwater connection\b/i.test(text))result.push('plumbing');
  return [...new Set(result)];
}
export function safeURL(url,fallback='') { try {const u=new URL(url);return u.protocol==='https:'?u.href:fallback;} catch {return fallback;} }
export function normalize(row) {
  row.title=String(row.title||'').trim();
  row.trades=classify(row.title+' '+(row.description||''));
  row.flags=[...new Set([...(row.flags||[]),'trade_match_inferred',...(row.trades.length?[]:['trade_unclassified']),...(row.published_at?[]:['publication_date_unknown']),...(row.location?[]:['location_unknown'])])];
  row.source_url=safeURL(row.source_url); row.closes_at=row.closes_at||null;
  return row;
}
export function validatePreferences(p) {
  if (!p || !Array.isArray(p.trades)||!Array.isArray(p.locations)||p.trades.some(t=>!Object.hasOwn(TRADE_RULES,t))||p.locations.some(l=>!LOCATIONS.includes(l))) throw new Error('Invalid trade/location preferences');
  return {trades:[...new Set(p.trades)],locations:[...new Set(p.locations)]};
}
export function selectRows(db,p={trades:[],locations:[]},{since=null,time=new Date()}={}) {
  validatePreferences(p);
  return db.prepare('SELECT * FROM opportunities WHERE present=1 ORDER BY changed_at DESC,id').all().map(x=>{
    const r=JSON.parse(x.body); r.first_seen=x.first_seen;r.changed_at=x.changed_at;r.last_seen=x.last_seen;
    r.flags=[...r.flags,...(time-new Date(x.last_seen)>8*86400000?['source_stale']:[])];
    if(r.published_at&&time-new Date(r.published_at)>365*86400000)r.flags.push('application_over_one_year_old');
    if(r.source_updated_at&&time-new Date(r.source_updated_at)>180*86400000)r.flags.push('source_version_over_six_months_old');
    if(r.closes_at && new Date(r.closes_at)<time)r.flags.push('deadline_passed');
    return r;
  }).filter(r=>(!p.trades.length||p.trades.some(t=>r.trades.includes(t)))&&(!p.locations.length||p.locations.includes(r.location))&&(!since||r.changed_at>=since))
    .sort((a,b)=>String(b.published_at||b.changed_at).localeCompare(String(a.published_at||a.changed_at)));
}
