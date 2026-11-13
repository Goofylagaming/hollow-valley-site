import { parse } from 'csv-parse/sync';
import { hash, ingest, sourceFailure } from './store.mjs';
import { normalize, safeURL, LOCATIONS } from './model.mjs';
export const LOGAN='https://services5.arcgis.com/ZUCWDRj8F77Xo351/ArcGIS/rest/services/Logan_City_Undecided_Development_Applications/FeatureServer/0';
export const BRISBANE_ID='cp14-lgip-pfti-parks-and-comm-facilities-future-park-upgrade-specific-location';
export const BRISBANE=`https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/${BRISBANE_ID}`;
export const QLD='https://www.data.qld.gov.au/api/3/action/package_show?id=forward-procurement-pipeline';
const hosts=new Set(['services5.arcgis.com','www.arcgis.com','data.brisbane.qld.gov.au','www.data.qld.gov.au']);
export async function request(url,{json=true,fetcher=fetch,redirects=0}={}) {
  const u=new URL(url); if(u.protocol!=='https:'||!hosts.has(u.hostname))throw new Error('Unapproved source host');
  for(let attempt=0;attempt<3;attempt++) {
    let res;
    try {res=await fetcher(u,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'HVS-BI-Pilot/0.1 (open-data client)','Accept':json?'application/json':'text/csv'}});}
    catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}
    if([301,302,303,307,308].includes(res.status)){
      if(redirects>=3)throw new Error('Source redirect limit');
      return request(new URL(res.headers.get('location'),u).href,{json,fetcher,redirects:redirects+1});
    }
    if((res.status===429||res.status>=500)&&attempt<2){await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}
    if(!res.ok)throw new Error(`Source HTTP ${res.status}`);
    const reader=res.body.getReader();let size=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new Error('Source size limit');}chunks.push(Buffer.from(value));}
    const text=Buffer.concat(chunks).toString('utf8');
    const data=json?JSON.parse(text):text;
    if(data?.error||data?.success===false)throw new Error('Source API error');
    return data;
  }
}
export function mapLogan(a) {
  if(!a.Application_Number||!a.Application_Description)throw new Error('Logan schema changed');
  return normalize({id:`logan:${a.Application_Number}:${a.Application_Amendment||''}`,source:'logan',source_id:a.Application_Number,title:a.Application_Description,
    description:a.Application_Development_Type_De||'',kind:'development_application',status:a.Application_Status||'Undecided',location:'Logan',suburb:a.Application_Property_Suburb||'',address:a.Application_Property_Address||'',
    published_at:a.Application_Lodgement_Date?new Date(a.Application_Lodgement_Date).toISOString():null,closes_at:null,
    source_url:safeURL(a.PDonline_Link,LOGAN),dataset_url:LOGAN,licence:'CC BY 3.0 AU',attribution:'Logan City Council; normalized and trade-tagged by HVS',flags:['not_a_tender','start_date_unconfirmed']});
}
export async function logan(get=request) {
  const meta=await get('https://www.arcgis.com/sharing/rest/content/items/50489a44f46b45b5857bcc7f9aa95f20?f=json');
  if(!/creativecommons.org\/licenses\/by\/3.0\/au/i.test(meta.licenseInfo||''))throw new Error('Logan licence requires review');
  const rows=[];
  // Full paginated snapshot catches edits and removals; storage writes only changed records.
  for(let offset=0;offset<100000;offset+=1000){
    const params=new URLSearchParams({where:'1=1',outFields:'Application_Number,Application_Amendment,Application_Description,Application_Development_Type_De,Application_Status,Application_Property_Suburb,Application_Property_Address,Application_Lodgement_Date,PDonline_Link',returnGeometry:'false',orderByFields:'OBJECTID ASC',resultOffset:String(offset),resultRecordCount:'1000',f:'json'});
    const page=await get(`${LOGAN}/query?${params}`);
    if(!Array.isArray(page.features))throw new Error('Logan response schema changed');
    rows.push(...page.features.map(f=>mapLogan(f.attributes)));
    if(!page.exceededTransferLimit)return rows;
    if(!page.features.length)throw new Error('Incomplete Logan pagination');
  }throw new Error('Logan pagination limit');
}
export function mapBrisbane(r,meta) {
  if(!r.lgip_id||!r.project_description)throw new Error('Brisbane schema changed');
  const url=`https://data.brisbane.qld.gov.au/explore/dataset/${BRISBANE_ID}/`;
  return normalize({id:`brisbane:${r.lgip_id}`,source:'brisbane',source_id:r.lgip_id,title:`${r.project_type}: ${r.suburb_reference}`,description:r.project_description,
    kind:'infrastructure_plan',status:'Planned infrastructure - verify delivery status',location:'Brisbane',suburb:r.suburb_reference||'',address:'',published_at:null,
    source_updated_at:meta.modified,timing:r.estimated_year_of_completion,source_url:url+`?refine.lgip_id=${encodeURIComponent(r.lgip_id)}`,dataset_url:url,
    licence:'CC BY 4.0',attribution:(meta.attributions||['Brisbane City Council']).join('; ')+'; normalized and trade-tagged by HVS',flags:['not_a_tender','historical_plan_verify_status','completion_window_not_deadline']});
}
export async function brisbane(get=request) {
  const meta=(await get(BRISBANE)).metas.default;
  if(meta.license!=='CC BY 4.0')throw new Error('Brisbane licence requires review');
  const rows=[];
  for(let offset=0;offset<10000;offset+=100){
    const page=await get(`${BRISBANE}/records?limit=100&offset=${offset}&order_by=lgip_id`);
    if(!Array.isArray(page.results))throw new Error('Brisbane response schema changed');
    rows.push(...page.results.map(r=>mapBrisbane(r,meta)));
    if(rows.length>=page.total_count)return rows;
    if(!page.results.length)throw new Error('Incomplete Brisbane pagination');
  }throw new Error('Brisbane pagination limit');
}
export function mapProcurement(r,resource) {
  if(!r['Program Description']||!r.Agency)throw new Error('Queensland schema changed');
  const region=r['Region SA4']||'';
  let location=LOCATIONS.find(l=>l!=='Statewide'&&region.toLowerCase().includes(l.toLowerCase()));
  if(!location&&/state.?wide|all regions|queensland.?wide/i.test(region))location='Statewide';
  if(!location)return null; // Never mislabel regional QLD procurements as SEQ.
  if(!/building|construction|maintenance|infrastructure/i.test(r['Category Group']+' '+r.Category+' '+r['Program Description']))return null;
  const title=r['Program Description'];
  const dataset='https://www.data.qld.gov.au/dataset/forward-procurement-pipeline';
  return normalize({id:`qld:${hash([r.Agency,r['Business Unit'],title,region].join('|')).slice(0,32)}`,source:'qld',source_id:null,title,description:r.Category||'',agency:r.Agency,kind:'procurement_pipeline',status:'Planned procurement - not an open tender',location,suburb:'',address:'',published_at:null,
    timing:r['Estimated Timing for Release to Market'],spend_range:r['Spend Range'],funding_status:r['Funding Status'],procurement_method:r['Procurement Method'],source_url:safeURL(r.Link,dataset),dataset_url:dataset,resource_url:resource.url,source_updated_at:resource.last_modified||null,
    licence:'CC BY 4.0',attribution:'State of Queensland; normalized, filtered and trade-tagged by HVS',flags:['not_a_tender','release_window_not_deadline','derived_id',...(location==='Statewide'?['statewide_location_not_confirmed_seq']:[])]});
}
export async function procurement(get=request) {
  const pkg=(await get(QLD)).result;
  if(pkg.license_id!=='CC-BY-4.0')throw new Error('Queensland licence requires review');
  const resources=pkg.resources.filter(r=>r.format?.toUpperCase()==='CSV').sort((a,b)=>String(b.last_modified||b.created).localeCompare(String(a.last_modified||a.created)));
  if(!resources.length)throw new Error('No Queensland CSV resource');
  const resource=resources[0],csv=await get(resource.url,{json:false});
  return parse(csv,{columns:true,bom:true,skip_empty_lines:true,trim:true}).map(r=>mapProcurement(r,resource)).filter(Boolean);
}
export async function syncAll(db,connectors={logan,brisbane,qld:procurement}) {
  const results=[];
  for(const [id,collect] of Object.entries(connectors)) {
    try {results.push(ingest(db,id,await collect()));} catch(e){sourceFailure(db,id,e);results.push({source:id,error:e.message});}
  }return results;
}
