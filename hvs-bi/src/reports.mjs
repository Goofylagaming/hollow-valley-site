import PDFDocument from 'pdfkit';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const csvCell=value=>{let s=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export function csvReport(rows) {
  const keys=['id','title','description','kind','status','location','suburb','address','agency','trades','published_at','closes_at','timing','first_seen','changed_at','last_seen','flags','source_url','dataset_url','licence','attribution'];
  return [keys.map(csvCell).join(','),...rows.map(r=>keys.map(k=>csvCell(Array.isArray(r[k])?r[k].join('; '):r[k])).join(','))].join('\r\n');
}
const shortlistLimit = 8;
const cautionFlags = ['source_stale','application_over_one_year_old','source_version_over_six_months_old'];
const concise = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 3) + '...' : text;
};
export function rankForSummary(rows, time = new Date()) {
  const relevance = row => Number(row.trades.length > 0) * 2 -
    cautionFlags.filter(flag => row.flags.includes(flag)).length;
  const recency = row => Date.parse(row.published_at || row.source_updated_at || row.changed_at) || 0;
  const ranked = rows.filter(row => !row.flags.includes('deadline_passed') &&
    !(row.closes_at && new Date(row.closes_at) < time))
    .sort((a,b) => relevance(b) - relevance(a) || recency(b) - recency(a) ||
      String(a.id).localeCompare(String(b.id)));
  const byFeed = new Map();
  for (const row of ranked) {
    const feed = row.source || 'unknown';
    if (!byFeed.has(feed)) byFeed.set(feed, []);
    byFeed.get(feed).push(row);
  }
  const selected = new Set();
  const target = Math.min(shortlistLimit, ranked.length);
  for (let round = 0; round < shortlistLimit && selected.size < target; round++) {
    const candidates = new Set([...byFeed.values()].map(feed => feed[round]).filter(Boolean));
    for (const row of ranked) {
      if (candidates.has(row)) selected.add(row);
      if (selected.size === target) break;
    }
  }
  return ranked.filter(row => selected.has(row));
}
export async function pdfReport(rows,{label='Weekly opportunities',health=[],generatedAt=new Date(),preferences}={}) {
  const shortlist = rankForSummary(rows, generatedAt);
  const feedLabels = new Map([
    ['logan', 'Logan'],
    ['brisbane', 'Brisbane'],
    ['qld', 'Queensland Procurement']
  ]);
  const doc=new PDFDocument({size:'A4',margin:45,bufferPages:true,info:{Title:'HVS BI - Construction Intelligence'}}),chunks=[];
  const result=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  doc.fillColor('#173e38').fontSize(11).text('HOLLOW VALLEY STUDIOS / BUSINESS INTELLIGENCE');
  doc.moveDown().fontSize(25).text('Construction opportunities');
  doc.fontSize(12).fillColor('#334155').text(label).text(generatedAt.toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})+' Brisbane');
  if (preferences) {
    const trades = preferences.trades.map(trade => trade[0].toUpperCase() + trade.slice(1));
    doc.moveDown(0.5).fontSize(10)
      .text(`Trades: ${trades.join(', ') || 'All trades'}`)
      .text(`Locations: ${preferences.locations.join(', ') || 'All locations'}`);
  }
  doc.moveDown().fontSize(10).text(`Showing ${shortlist.length} priority records. The full CSV contains ${rows.length} matching records.`);
  doc.moveDown(0.5).fontSize(11).text('Feed summary');
  doc.fontSize(10);
  for (const [feed, name] of feedLabels) {
    const matches = rows.filter(row => row.source === feed).length;
    const shortlisted = shortlist.filter(row => row.source === feed).length;
    doc.text(`${name}  |  ${matches} matches  |  ${shortlisted} shortlisted`);
  }
  doc.moveDown(0.5);
  doc.text('Check project status and eligibility with the official source before acting.');
  for(const s of health)doc.text(`${s.id}: ${s.status}; last successful sync ${s.last_success||'never'}`);
  if(!shortlist.length)doc.moveDown().text('No priority records for this report.');
  const grouped = new Map();
  for (const row of shortlist) {
    const feed = row.source || 'unknown';
    if (!grouped.has(feed)) grouped.set(feed, []);
    grouped.get(feed).push(row);
  }
  const feedOrder = new Set([...feedLabels.keys(), ...grouped.keys()]);
  for (const feed of feedOrder) {
    const entries = grouped.get(feed);
    if (!entries?.length) continue;
    const lines = [{ text: feedLabels.get(feed) || 'Other sources', size: 16, color: '#173e38', gap: 12 }];
    for (const r of entries) {
      const add = (text, style = {}) => lines.push({ text, size: 10, color: '#334155', gap: 0, ...style });
      add(concise(r.title, 150), {size: 13, color: '#173e38', gap: 9});
      add(concise(`${r.kind.replaceAll('_',' ')} | ${r.location} / ${r.suburb||'area unspecified'}`, 110));
      add(concise(r.status, 105));
      add(`Potential trades: ${concise(r.trades.join(', ')||'unclassified', 95)}`);
      if (r.timing) add(`Published timing window: ${concise(r.timing, 75)}`);
      if (cautionFlags.some(flag => r.flags.includes(flag))) add('Older source information. Check current status.');
      add('Official source / verify this record', {color: '#156b61', link: r.source_url});
      add(concise(`${r.attribution}. ${r.licence}. Reference: ${r.source_id||r.id}`, 170), {size: 8, color: '#64748b'});
    }
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = 785; // Leave room for the page footer.
    const pageCapacity = bottom - doc.page.margins.top;
    const sectionHeight = scale => lines.reduce((height, line) =>
      height + line.gap * scale + doc.fontSize(line.size * scale).heightOfString(line.text, {width}), 0);
    let scale = 1;
    let height = sectionHeight(scale);
    if (height > pageCapacity) {
      scale = pageCapacity / height;
      height = sectionHeight(scale);
    }
    if (doc.y + height > bottom) doc.addPage();
    for (const line of lines) {
      doc.y += line.gap * scale;
      doc.fontSize(line.size * scale).fillColor(line.color)
        .text(line.text, {width, link: line.link, underline: Boolean(line.link)});
    }
  }
  const range=doc.bufferedPageRange();
  for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#64748b').text(`HVS BI pilot | ${i+1} / ${range.count}`,45,805,{lineBreak:false});}
  doc.end();return result;
}
export async function writeReports(rows,dir,options={}) {
  mkdirSync(dir,{recursive:true});
  await writeFile(join(dir,'opportunities.csv'),csvReport(rows));
  await writeFile(join(dir,'opportunities.pdf'),await pdfReport(rows,options));
  return {csv:join(dir,'opportunities.csv'),pdf:join(dir,'opportunities.pdf')};
}

