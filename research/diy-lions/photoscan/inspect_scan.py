# 扫描狮结构体检（2026-10-18）：尺寸/朝向/连通分量/贴图
# 运行：blender -b --python research/diy-lions/photoscan/inspect_scan.py
import bpy, bmesh, os, json
from mathutils import Vector

BASE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(BASE, 'photoscan-lion.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('OBJECTS', [(o.name, tuple(round(v, 4) for v in o.dimensions)) for o in objs])
o = objs[0]
print('MATRIX', [[round(v, 4) for v in row] for row in o.matrix_world])
print('DIMS', tuple(round(v, 4) for v in o.dimensions))
print('VERTS', len(o.data.vertices), 'FACES', len(o.data.polygons))
for m in o.data.materials:
    print('MAT', m.name, 'nodes', [(n.type, getattr(n, 'image', None).name if getattr(n, 'image', None) else '')
                                   for n in m.node_tree.nodes])

bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
seen = set(); islands = []
for v in bm.verts:
    if v.index in seen: continue
    stack = [v]; seen.add(v.index); comp = []
    while stack:
        u = stack.pop(); comp.append(u)
        for e in u.link_edges:
            w = e.other_vert(u)
            if w.index not in seen:
                seen.add(w.index); stack.append(w)
    if len(comp) >= 30:
        co = [x.co for x in comp]
        mn = Vector((min(p.x for p in co), min(p.y for p in co), min(p.z for p in co)))
        mx = Vector((max(p.x for p in co), max(p.y for p in co), max(p.z for p in co)))
        islands.append({'n': len(comp), 'min': tuple(round(v, 3) for v in mn),
                        'max': tuple(round(v, 3) for v in mx),
                        'size': tuple(round(mx[i] - mn[i], 3) for i in range(3))})
islands.sort(key=lambda d: -d['n'])
print('ISLANDS', len(islands))
for i, d in enumerate(islands[:25]):
    print(i, d)
print('TOTAL', len(bm.verts), len(bm.faces))
bm.free()
