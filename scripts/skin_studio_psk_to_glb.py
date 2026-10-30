#!/usr/bin/env python3
"""Offline Unreal ActorX PSK -> static glTF 2.0 GLB preview converter.

This deliberately does NOT include, fetch, upload, or redistribute source meshes.
Convert only files you are authorised to use. UV seams and material groups are
preserved; skinned animation, game material shaders and colour masks are not.
Python 3.10+, standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import struct
from pathlib import Path

HEADER = struct.Struct('<20siii')
POINT = struct.Struct('<fff')
WEDGE_16 = struct.Struct('<HffBB')
WEDGE_32 = struct.Struct('<IffBBH')
FACE_16 = struct.Struct('<HHHBBI')
FACE_32 = struct.Struct('<IIIBBI')

class PskError(ValueError):
    pass


def parse_psk(data: bytes):
    """Parse required ActorX chunks, returning validated positions, UV wedges, faces and materials."""
    chunks = {}
    offset = 0
    while offset < len(data):
        if offset + HEADER.size > len(data):
            raise PskError('Trailing data smaller than a PSK chunk header')
        raw_name, _flags, item_size, item_count = HEADER.unpack_from(data, offset)
        offset += HEADER.size
        name = raw_name.split(b'\x00', 1)[0].decode('ascii', errors='replace')
        if not name or item_size < 0 or item_count < 0 or item_size * item_count > len(data) - offset:
            raise PskError(f'Invalid chunk: {name!r}')
        if name in chunks:
            raise PskError(f'Duplicate chunk: {name}')
        chunks[name] = (item_size, item_count, memoryview(data)[offset:offset + item_size * item_count])
        offset += item_size * item_count

    def required(name, sizes):
        if name not in chunks:
            raise PskError(f'Missing PSK chunk {name}')
        stride, count, buffer = chunks[name]
        if stride not in sizes:
            raise PskError(f'Unsupported {name} record size: {stride}')
        return stride, count, buffer

    _, point_count, point_bytes = required('PNTS0000', {12})
    if not point_count:
        raise PskError('Mesh has no points')
    points = list(POINT.iter_unpack(point_bytes))
    if not all(math.isfinite(v) for xyz in points for v in xyz):
        raise PskError('Non-finite mesh coordinate')

    wedge_stride, wedge_count, wedge_bytes = required('VTXW0000', {12, 16})
    if not wedge_count:
        raise PskError('Mesh has no UV wedges')
    if wedge_stride == 16:
        wedges = [(p, u, v) for p,u,v,_mat,_unused,_pad in WEDGE_32.iter_unpack(wedge_bytes)]
    else:
        wedges = [(p,u,v) for p,u,v,_mat,_unused in WEDGE_16.iter_unpack(wedge_bytes)]
    if not all(0 <= p < point_count and math.isfinite(u) and math.isfinite(v) for p,u,v in wedges):
        raise PskError('Bad wedge point index or UV coordinate')

    face_chunk = 'FACE0000' if 'FACE0000' in chunks else 'FACE3200' if 'FACE3200' in chunks else 'FACE0032'
    face_stride, face_count, face_bytes = required(face_chunk, {12,18})
    if face_stride == 12:
        faces = [(a,b,c,mat) for a,b,c,mat,_aux,_smooth in FACE_16.iter_unpack(face_bytes)]
    else:
        faces = [(a,b,c,mat) for a,b,c,mat,_aux,_smooth in FACE_32.iter_unpack(face_bytes)]
    if not faces or not all(0 <= a < wedge_count and 0 <= b < wedge_count and 0 <= c < wedge_count for a,b,c,_ in faces):
        raise PskError('Missing triangles or invalid triangle wedge index')

    _, mat_count, mat_bytes = required('MATT0000', {88})
    mats = [bytes(mat_bytes[i*88:i*88+64]).split(b'\0',1)[0].decode('utf-8',errors='replace') or f'Material_{i}' for i in range(mat_count)]
    if not mats or not all(0 <= f[3] < len(mats) for f in faces):
        raise PskError('Missing materials or triangle references unavailable material')

    normals = None
    if 'VTXNORMS' in chunks:
        stride, count, raw = chunks['VTXNORMS']
        if stride != 12 or count != point_count:
            raise PskError('Unsupported normal array')
        normals = list(POINT.iter_unpack(raw))
        if not all(math.isfinite(v) for xyz in normals for v in xyz):
            raise PskError('Non-finite normal')

    extra_uvs = {}
    for name, (stride, count, raw) in sorted(chunks.items()):
        if name.startswith('EXTRAUVS') and len(name) == 9 and name[-1].isdigit():
            if stride != 8 or count != wedge_count:
                raise PskError(f'Unexpected extra UV data in {name}')
            values = list(struct.iter_unpack('<ff', raw))
            if not all(math.isfinite(u) and math.isfinite(v) for u,v in values):
                raise PskError('Non-finite extra UV')
            extra_uvs[int(name[-1])+1] = values

    bone_count = chunks.get('REFSKELT', (0,0,None))[1]
    return {'points':points, 'wedges':wedges, 'faces':faces,
            'materials':mats, 'normals':normals, 'extra_uvs':extra_uvs,
            'bone_count':bone_count, 'point_count':point_count}


def dot(a, b):
    return sum(x*y for x,y in zip(a,b))

def minus(a, b):
    return tuple(x-y for x,y in zip(a,b))

def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])

def unit(v):
    l = math.sqrt(dot(v,v))
    return tuple(x/l for x in v) if l > 1e-20 else (0., 1., 0.)

def orient_correctly(model):
    """Determine whether faces oppose supplied per-point normals in reference pose."""
    if model['normals'] is None:
        return False
    good = bad = 0
    for a,b,c,_ in model['faces'][::max(1,len(model['faces'])//2000)]:
        pa,pb,pc = [model['points'][model['wedges'][i][0]] for i in (a,b,c)]
        norm = cross(minus(pb,pa), minus(pc,pa))
        dotn = dot(norm, model['normals'][model['wedges'][a][0]])
        if dotn > 1e-10: good += 1
        elif dotn < -1e-10: bad += 1
    return bad > good


def convert(data: bytes, name: str, scale: float = 0.01):
    """Return self-contained static GLB binary and conversion report."""
    if not math.isfinite(scale) or scale <= 0:
        raise PskError('Scale must be positive and finite')
    model = parse_psk(data)
    source_points = model['points']
    wedges = model['wedges']
    flip = orient_correctly(model)
    # Right-handed +90° X rotation: Unreal Z-up -> glTF Y-up; centimetres -> metres.
    def pos(p): return (p[0]*scale, p[2]*scale, -p[1]*scale)
    def rot(n): return unit((n[0],n[2],-n[1]))
    positions = [pos(source_points[pi]) for pi,u,v in wedges]
    texcoords = [(u,v) for pi,u,v in wedges]
    if model['normals'] is not None:
        normals = [rot(model['normals'][pi]) for pi,u,v in wedges]
    else:
        # Fallback: accumulate smoothed triangle normals per wedge.
        accum = [[0.,0.,0.] for _ in wedges]
        for a,b,c,_ in model['faces']:
            if flip: b,c=c,b
            vnorm = cross(minus(positions[b],positions[a]), minus(positions[c],positions[a]))
            for idx in (a,b,c):
                for j in range(3): accum[idx][j]+=vnorm[j]
        normals = [unit(n) for n in accum]

    indices_by_mat = [[] for _ in model['materials']]
    for a,b,c,mat in model['faces']:
        if flip: b,c=c,b
        indices_by_mat[mat].extend((a,b,c))

    binary = bytearray()
    views = []
    accessors = []
    def add(data_buf, target=None):
        pad=(-len(binary)) % 4
        binary.extend(b'\x00'*pad)
        offset = len(binary)
        binary.extend(data_buf)
        view = {'buffer':0,'byteOffset':offset,'byteLength':len(data_buf)}
        if target: view['target']=target
        views.append(view)
        return len(views)-1
    def accessor(view, component_type, count, shape, minimum=None, maximum=None):
        o={'bufferView':view,'byteOffset':0,'componentType':component_type,'count':count,'type':shape}
        if minimum is not None: o['min']=minimum
        if maximum is not None: o['max']=maximum
        accessors.append(o)
        return len(accessors)-1
    def float_array(values, dims):
        return b''.join(struct.pack('<'+'f'*dims,*v) for v in values)

    pos_view=add(float_array(positions,3),34962)
    mins=[min(p[i] for p in positions) for i in range(3)]
    maxs=[max(p[i] for p in positions) for i in range(3)]
    pos_acc=accessor(pos_view,5126,len(positions),'VEC3',mins,maxs)
    norm_acc=accessor(add(float_array(normals,3),34962),5126,len(normals),'VEC3')
    uv_accessors={0:accessor(add(float_array(texcoords,2),34962),5126,len(texcoords),'VEC2')}
    for ch, coords in sorted(model['extra_uvs'].items()):
        uv_accessors[ch]=accessor(add(float_array(coords,2),34962),5126,len(coords),'VEC2')

    primitives=[]
    use_u16 = len(wedges)<=65535
    for index, material_indices in enumerate(indices_by_mat):
        if not material_indices: continue
        view=add(struct.pack('<'+('H' if use_u16 else 'I')*len(material_indices),*material_indices),34963)
        idx_acc=accessor(view,5123 if use_u16 else 5125,len(material_indices),'SCALAR', [min(material_indices)], [max(material_indices)])
        prim={'attributes':{'POSITION':pos_acc,'NORMAL':norm_acc,
                            **{f'TEXCOORD_{n}':i for n,i in uv_accessors.items()}},
              'indices':idx_acc,'material':index,'mode':4}
        primitives.append(prim)

    materials=[]
    for mat_name in model['materials']:
        is_eye='eye' in mat_name.lower()
        materials.append({'name':mat_name,'pbrMetallicRoughness':{
            'baseColorFactor':[0.70,0.58,0.22,1] if is_eye else [0.48,0.53,0.45,1],
            'metallicFactor':0.,'roughnessFactor':0.92},'doubleSided':True})

    document={
        'asset':{'version':'2.0','generator':'Hollow Valley offline PSK mesh preview converter v1'},
        'scene':0,'scenes':[{'nodes':[0]}],
        'nodes':[{'mesh':0,'name':name}],
        'meshes':[{'name':name,'primitives':primitives}],
        'materials':materials,
        'buffers':[{'byteLength':len(binary)}],
        'bufferViews':views, 'accessors':accessors,
    }
    encoded = json.dumps(document,separators=(',',':'),ensure_ascii=False).encode('utf-8')
    encoded += b' ' * (-len(encoded)%4)
    binary.extend(b'\x00'*(-len(binary)%4))
    size=12+8+len(encoded)+8+len(binary)
    glb=(struct.pack('<4sII',b'glTF',2,size)
         +struct.pack('<I4s',len(encoded),b'JSON')+encoded
         +struct.pack('<I4s',len(binary),b'BIN\0')+binary)
    report={'species':name,'points':len(source_points),'uv_wedges':len(wedges),
            'triangles':len(model['faces']),'bones_in_psk':model['bone_count'],
            'uv_sets':len(uv_accessors), 'materials':model['materials'],
            'face_winding_flipped':flip,'converted_bytes':len(glb),
            'bounds_min_m':mins,'bounds_max_m':maxs,
            'notes':'Static reference-pose preview only: no exported skeleton, animations, original shaders, game skin textures or colour-zone masks.'}
    return glb,report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path,help='Directory of locally provided .psk files or a single PSK')
    parser.add_argument('--output',type=Path,required=True,help='Private/local output directory')
    parser.add_argument('--scale',type=float,default=0.01,help='Input Unreal cm -> glTF metres (default .01)')
    args=parser.parse_args()
    paths=sorted(args.source.glob('SK_*.psk'), key=lambda p: ('(' in p.stem,p.name)) if args.source.is_dir() else [args.source]
    if not paths: parser.error('No PSK input files found')
    args.output.mkdir(parents=True,exist_ok=True)
    reports=[]
    seen={}
    for path in paths:
        source=path.read_bytes()
        sha=hashlib.sha256(source).hexdigest()
        species=re.sub(r'\s*\(\d+\)$', '', path.stem.removeprefix('SK_'))
        if species in seen:
            if seen[species] != sha:
                raise PskError(f'Duplicate species {species} has different source geometry: {path.name}')
            print(f'Skipping identical duplicate: {path.name}')
            continue
        seen[species]=sha
        glb, report=convert(source,species,args.scale)
        target=args.output/(species.lower()+'.glb')
        target.write_bytes(glb)
        report.update({'file':target.name,'source_sha256':sha,'converted_sha256':hashlib.sha256(glb).hexdigest()})
        reports.append(report)
        print(f"{species}: {report['triangles']:,} triangles, {report['uv_sets']} UV sets, {len(glb):,} bytes -> {target.name}")
    (args.output/'manifest.json').write_text(json.dumps({'format':'hollow-valley-skin-model-preview/v1',
        'notice':'PRIVATE prototype meshes, not approved for public hosting or redistribution. Conversion preserves UV and material names but no texture maps.',
        'models':reports},indent=2)+'\n',encoding='utf-8')
    print(f'Finished {len(reports)} models')

if __name__=='__main__':
    main()
