"""抬手臂 → 逐顶点位移 → 找出"腰部/下摆到底是哪根骨在拉"。

用法：blender -b --python _diag_armdrag.py -- <glb> [zmax=1.05] [thr=0.03]
"""
import bpy, sys, math
from collections import Counter
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index('--')+1:]
src = argv[0]
ZMAX = float(argv[1]) if len(argv) > 1 else 1.05
THR = float(argv[2]) if len(argv) > 2 else 0.03
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
gname = {g.index: g.name for g in mesh.vertex_groups}
M = mesh.matrix_world

def evalpos():
    dg = bpy.context.evaluated_depsgraph_get()
    me = mesh.evaluated_get(dg).to_mesh()
    pts = [(M @ v.co).copy() for v in me.vertices]
    mesh.evaluated_get(dg).to_mesh_clear()
    return pts

for b in arm.pose.bones:
    b.rotation_mode = 'XYZ'; b.rotation_euler = Euler((0, 0, 0), 'XYZ')
bpy.context.view_layer.update()
p0 = evalpos()

pb = arm.pose.bones['LeftUpperArm']
pb.rotation_mode = 'XYZ'; pb.rotation_euler = Euler((-0.9, 0.75, 0), 'XYZ')
bpy.context.view_layer.update()
p1 = evalpos()
print('[drag] verts=%d  zmax=%.2f thr=%.3f' % (len(p0), ZMAX, THR))

hot = []
for i, (a, b) in enumerate(zip(p0, p1)):
    d = (b - a).length
    if a.z <= ZMAX and d > THR:
        hot.append((d, i, a))
hot.sort(reverse=True)
print('[drag] hot verts (z<=%.2f, moved>%.3f): %d' % (ZMAX, THR, len(hot)))
for d, i, a in hot[:8]:
    v = mesh.data.vertices[i]
    gl = sorted(((g.weight, gname.get(g.group)) for g in v.groups), reverse=True)[:3]
    print('   d=%.3f at (%.2f,%.2f,%.2f)  %s' % (
        d, a.x, a.y, a.z, ', '.join('%s:%.2f' % (n, w) for w, n in gl)))

cnt = Counter()
for d, i, a in hot:
    v = mesh.data.vertices[i]
    for g in v.groups:
        if g.weight > 0.05:
            cnt[gname.get(g.group)] += 1
print('[drag] groups on hot verts (w>0.05): %s' % ', '.join('%s:%d' % kv for kv in cnt.most_common(8)))
