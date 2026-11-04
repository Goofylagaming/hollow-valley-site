"""Build staging-only species assets from private extracted materials and supplied PSKs."""
import json,hashlib,shutil,argparse
from pathlib import Path
from PIL import Image

def build(source,output,table):
 output.mkdir(parents=True,exist_ok=True); textures=output/'textures';textures.mkdir(exist_ok=True)
 rows=json.loads(table.read_text(encoding='utf-8'))[0]['Rows']; reports=json.loads((source/'models/manifest.json').read_text(encoding='utf-8'))['models']; catalog=[]; assets={}
 def texture(name):
  target=textures/(name+'.png')
  if name not in assets:
   raw=source/'textures'/(name+'.raw');meta=json.loads(raw.with_suffix('.json').read_text())
   if meta['PixelFormat'] not in ['PF_B8G8R8A8','PF_R8G8B8A8']:raise ValueError(meta)
   im=Image.frombytes('RGBA',(meta['Width'],meta['Height']),raw.read_bytes(),'raw','BGRA' if meta['PixelFormat']=='PF_B8G8R8A8' else 'RGBA');im.thumbnail((2048,2048),Image.Resampling.LANCZOS);im.save(target,optimize=True)
   assets[name]={'file':'textures/'+target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sourceSize':[meta['Width'],meta['Height']],'previewSize':list(im.size)}
  return '/assets/skin-models/species-staging/'+assets[name]['file']
 def props(name):return json.loads((source/'materials'/(name+'.json')).read_text())[0]['Properties']
 def refs(p):return {v['ParameterInfo']['Name']:v['ParameterValue']['ObjectName'].split("'")[1] for v in p.get('TextureParameterValues',[])}
 for r in reports:
  if r['species']=='Tyrannosaurus':continue
  p=props(r['materials'][0]);t=refs(p);eye=refs(props(r['materials'][1]));scalars={v['ParameterInfo']['Name']:v['ParameterValue'] for v in p.get('ScalarParameterValues',[])}
  maps={key:texture(t[param]) for key,param in {'pattern':'Adult_Base_ColorOverlay','normal':'Base_NormalMap','surface':'Base_RoughAlbedoCavityMap','zones':'Base_Mask'}.items()}
  maps['detail-normal']=texture(t.get('Detail_NormalMap','T_DinoSkinDetail_5_N'))
  maps['iris']=texture(eye.get('Iris Texture','T_AnimalEyes_Iris_2'));maps['pupil']=texture(eye.get('Pupil Texture','T_AnimalEyes_Pupil_3'))
  shutil.copyfile(source/'models'/r['file'],output/r['file'])
  catalog.append({'id':r['species'].lower(),'name':r['species'],'model':'/assets/skin-models/species-staging/'+r['file'],'maps':maps,'detailScale':scalars.get('Detail_Scale',12),'detailStrength':scalars.get('Detail_NormalStrength',2),'verifiedInGame':False,'status':'Extracted assets; channel mapping and appearance require in-game verification','triangles':r['triangles'],'sourceSha256':r['source_sha256'],'modelSha256':r['converted_sha256'],'materials':r['materials'],'sections':[c['Key'] for c in rows[r['species']]['ColorsBySection']]})
 (output/'catalog.json').write_text(json.dumps({'gameBuild':'24664737','published':False,'species':catalog,'textures':assets},indent=2)+'\n',encoding='utf-8')
 print(f'Built {len(catalog)} species, {len(assets)} texture maps')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('table',type=Path);a=p.parse_args();build(a.source,a.output,a.table)
