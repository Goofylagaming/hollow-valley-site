"""Build the staging-only supplied Rex, separating disconnected tooth geometry.
No texture maps are present in the supplied PSK. Surface material is authored in JS.
"""
import importlib.util, json, hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('converter',Path(__file__).with_name('skin_studio_psk_to_glb.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
original_parse=c.parse_psk

def parse(data):
    model=original_parse(data)
    parents=list(range(len(model['points'])))
    def root(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]];i=parents[i]
        return i
    for a,b,d,mat in model['faces']:
        ids=[model['wedges'][i][0] for i in (a,b,d)]
        parents[root(ids[1])]=root(ids[0]);parents[root(ids[2])]=root(ids[0])
    groups={}
    for i,p in enumerate(model['points']):groups.setdefault(root(i),[]).append(p)
    # Verified on this supplied model: detached body components in the jaw are teeth.
    teeth=set()
    for k,points in groups.items():
        if len(points)<100 and all(230<p[2]<320 and -490<p[1]<-380 for p in points): teeth.add(k)
    model['materials'].append('HV_Teeth')
    model['faces']=[(a,b,d,2 if mat==0 and root(model['wedges'][a][0]) in teeth else mat) for a,b,d,mat in model['faces']]
    return model

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    data=a.source.read_bytes()
    expected='47208def239a5c1cce66f4645a8e68a4cbed0360d901a5f368cf736296d7ab45'
    if hashlib.sha256(data).hexdigest()!=expected: raise ValueError('Anatomical groups require the reviewed Rex source')
    c.parse_psk=parse
    glb,report=c.convert(data,'Tyrannosaurus',.01)
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(glb)
    report.update(source_sha256=expected,converted_sha256=hashlib.sha256(glb).hexdigest(),purpose='User-authorized staging preview only; no original game texture maps supplied')
    a.output.with_suffix('.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
