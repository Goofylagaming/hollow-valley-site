import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const csvCell=value=>{let s=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export function csvReport(rows) {
  const keys=['id','title','description','kind','status','location','suburb','address','agency','trades','published_at','closes_at','timing','first_seen','changed_at','last_seen','flags','source_url','dataset_url','licence','attribution'];
  return [keys.map(csvCell).join(','),...rows.map(r=>keys.map(k=>csvCell(Array.isArray(r[k])?r[k].join('; '):r[k])).join(','))].join('\r\n');
}
export async function pdfReport(rows,{label='Weekly opportunities',health=[],generatedAt=new Date()}={}) {
  const doc=new PDFDocument({size:'A4',margin:45,bufferPages:true,info:{Title:'HVS BI - Construction Intelligence'}}),chunks=[];
  const result=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  doc.fillColor('#173e38').fontSize(11).text('HOLLOW VALLEY STUDIOS / BUSINESS INTELLIGENCE');
  doc.moveDown().fontSize(25).text('Construction opportunities');
  doc.fontSize(12).fillColor('#334155').text(label).text(generatedAt.toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})+' Brisbane');
  doc.moveDown().fontSize(10).text(`${rows.length} matching records. Planning signals are not confirmed jobs or open tenders. Verify status and eligibility with the official source.`);
  for(const s of health)doc.text(`${s.id}: ${s.status}; last successful sync ${s.last_success||'never'}`);
  if(!rows.length)doc.moveDown().text('No new or changed records match these filters. This does not mean no work exists.');
  for(const r of rows){
    if(doc.y>610)doc.addPage();
    doc.moveDown().fillColor('#173e38').fontSize(14).text(r.title);
    doc.fillColor('#334155').fontSize(10).text(`${r.kind.replaceAll('_',' ')} | ${r.location} / ${r.suburb||'area unspecified'}`);
    doc.text(r.description||r.status);doc.text(`Status: ${r.status}`);
    doc.text(`Potential trades (inferred): ${r.trades.join(', ')||'unclassified'}`);
    if(r.timing)doc.text(`Published timing window: ${r.timing} (not a bid deadline)`);
    doc.text(`Quality notes: ${r.flags.join(', ')}`);
    doc.text(`Next step: ${r.kind==='development_application'?'Monitor the application; confirm the appointed builder through official channels.':'Check the official programme for current delivery/procurement status.'}`);
    doc.fillColor('#156b61').text('Official source / verify this record',{link:r.source_url,underline:true});
    doc.fillColor('#64748b').fontSize(8).text(`${r.attribution}. ${r.licence}. Reference: ${r.source_id||r.id}`);
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
