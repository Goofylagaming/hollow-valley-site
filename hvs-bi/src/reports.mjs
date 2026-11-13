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
  return rows.filter(row => !row.flags.includes('deadline_passed') &&
    !(row.closes_at && new Date(row.closes_at) < time))
    .sort((a,b) => relevance(b) - relevance(a) || recency(b) - recency(a) ||
      String(a.id).localeCompare(String(b.id)))
    .slice(0, shortlistLimit);
}
export async function pdfReport(rows,{label='Weekly opportunities',health=[],generatedAt=new Date()}={}) {
  const shortlist = rankForSummary(rows, generatedAt);
  const doc=new PDFDocument({size:'A4',margin:45,bufferPages:true,info:{Title:'HVS BI - Construction Intelligence'}}),chunks=[];
  const result=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  doc.fillColor('#173e38').fontSize(11).text('HOLLOW VALLEY STUDIOS / BUSINESS INTELLIGENCE');
  doc.moveDown().fontSize(25).text('Construction opportunities');
  doc.fontSize(12).fillColor('#334155').text(label).text(generatedAt.toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})+' Brisbane');
  doc.moveDown().fontSize(10).text(`Showing ${shortlist.length} priority records. The full CSV contains ${rows.length} matching records.`);
  doc.text('Check project status and eligibility with the official source before acting.');
  for(const s of health)doc.text(`${s.id}: ${s.status}; last successful sync ${s.last_success||'never'}`);
  if(!shortlist.length)doc.moveDown().text('No priority records for this report.');
  for(const r of shortlist){
    if(doc.y>625)doc.addPage();
    doc.moveDown().fillColor('#173e38').fontSize(13).text(concise(r.title, 150));
    doc.fillColor('#334155').fontSize(10).text(concise(`${r.kind.replaceAll('_',' ')} | ${r.location} / ${r.suburb||'area unspecified'}`, 110));
    doc.text(concise(r.status, 105));
    doc.text(`Potential trades: ${concise(r.trades.join(', ')||'unclassified', 95)}`);
    if(r.timing)doc.text(`Published timing window: ${concise(r.timing, 75)}`);
    if(cautionFlags.some(flag => r.flags.includes(flag)))doc.text('Older source information. Check current status.');
    doc.fillColor('#156b61').text('Official source / verify this record',{link:r.source_url,underline:true});
    doc.fillColor('#64748b').fontSize(8).text(concise(`${r.attribution}. ${r.licence}. Reference: ${r.source_id||r.id}`, 170));
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

