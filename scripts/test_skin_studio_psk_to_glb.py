#!/usr/bin/env python3
"""Synthetic PSK fixture tests: no third-party mesh included in source control."""
import json
import struct
import unittest
from skin_studio_psk_to_glb import PskError, convert, parse_psk


def chunk(name, size, data):
    assert len(data) % size == 0 if size else len(data) == 0
    return struct.pack('<20siii', name.encode(), 1999801, size, len(data)//size if size else 0) + data


def sample(include_extrauv=True, bad_triangle=False):
    positions = [(0.,0.,0.), (100.,0.,0.), (0.,100.,0.), (0.,0.,100.)]
    points = b''.join(struct.pack('<fff',*p) for p in positions)
    wedges = b''.join(struct.pack('<IffBBH',p,u,v,0,0,0) for p,u,v in [(0,0,0),(1,1,0),(2,0,1),(0,0,0),(2,0,1),(3,1,1)])
    faces = b''.join(struct.pack('<HHHBBI',*t) for t in [(0,1,2,0,0,1),(3,4, 999 if bad_triangle else 5,1,0,1)])
    mats = (b'MI_Test_Body\x00'.ljust(64,b'\0') + b'\0'*24
            + b'MI_Test_Eye\x00'.ljust(64,b'\0') + b'\0'*24)
    normals=b''.join(struct.pack('<fff', 0.,0.,1.) for _ in positions)
    data=(chunk('ACTRHEAD',0,b'')+chunk('PNTS0000',12,points)
          +chunk('VTXW0000',16,wedges)+chunk('FACE0000',12,faces)
          +chunk('MATT0000',88,mats)+chunk('VTXNORMS',12,normals))
    if include_extrauv:
        data+=chunk('EXTRAUVS0',8,b''.join(struct.pack('<ff',0.,0.) for _ in range(6)))
    return data


class ConversionTests(unittest.TestCase):
    def test_binary_glb_and_material_primitives(self):
        binary,report=convert(sample(), 'UnitTest')
        magic,version,length=struct.unpack_from('<4sII',binary,0)
        self.assertEqual(magic,b'glTF')
        self.assertEqual(version,2)
        self.assertEqual(length,len(binary))
        json_size,chunk_type=struct.unpack_from('<I4s',binary,12)
        self.assertEqual(chunk_type,b'JSON')
        doc=json.loads(binary[20:20+json_size].decode('utf-8'))
        self.assertEqual(len(doc['meshes'][0]['primitives']),2)
        self.assertEqual(len(doc['materials']),2)
        self.assertEqual(report['triangles'],2)
        self.assertEqual(report['uv_sets'],2)
        self.assertEqual(report['bone_count'] if 'bone_count' in report else report['bones_in_psk'],0)
        self.assertIn('TEXCOORD_1',doc['meshes'][0]['primitives'][0]['attributes'])
        self.assertNotIn('textures',doc)
        # 100 Unreal centimetres transform to 1 glTF metre.
        self.assertEqual(doc['accessors'][0]['max'],[1.,1.,0.])

    def test_corrupt_face_index_is_rejected(self):
        with self.assertRaisesRegex(PskError,'invalid triangle'):
            parse_psk(sample(bad_triangle=True))

    def test_missing_required_uv_data_is_rejected(self):
        binary=sample()
        idx=binary.find(b'VTXW0000')
        with self.assertRaises(PskError): parse_psk(binary[:idx])

    def test_corrupt_chunk_is_rejected(self):
        with self.assertRaises(PskError): parse_psk(sample()+b'err')

    def test_flipped_source_winding_is_detected(self):
        _,report=convert(sample(), 'UnitTest')
        self.assertFalse(report['face_winding_flipped'])


if __name__=='__main__':
    unittest.main()
