"""剥掉误分到"裤腿/衣摆/腰带"上的手部权重 —— 用"最近肢体"判据。

为什么换成这条（2026-10-22，连续否掉三种判据）：
  ① 到骨线段的固定距离：垂手时拇指贴着大腿，误分点 0.12m、真手也 0.10m ⇒ 分不开；
  ② 手部球体（腕为心、手长为半径）：真指尖离腕 0.24m，而大腿表面离腕 0.26m ⇒
     球大放不过、球小剥掉真指尖；
  ③ 左右镜像：生成件顶点左右不严格对称（826/984 找不到镜像）⇒ 基本失效。

本判据：**谁近算谁的**。对每个带手部权重的顶点，比较
  d_hand = 到任一手部骨线段的最小距离
  d_body = 到 {Hips, Spine, Chest, UpperLeg, LowerLeg, Foot} 的最小距离
若 d_body + MARGIN < d_hand ⇒ 这个顶点在解剖上属于躯干/腿，手部权重是误分，剥掉。

用法：
  blender -b --python fix_hand_weights.py -- <in.glb> <out.glb> [margin=0.02]
"""
import bpy, sys, math, os

argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
MARGIN = float(argv[2]) if len(argv) > 2 else 0.02

HAND_RE = ('Hand', 'Thumb', 'Index', 'Middle', 'Ring', 'Little')
BODY = ['Hips', 'Spine', 'Chest', 'UpperChest', 'LeftUpperLeg', 'RightUpperLeg',
        'LeftLowerLeg', 'RightLowerLeg', 'LeftFoot', 'RightFoot']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
A = arm.matrix_world
M = mesh.matrix_world
gname = {g.index: g.name for g in mesh.vertex_groups}
gidx = {v: k for k, v in gname.items()}

def seg(name):
    b = arm.data.bones.get(name)
    if not b: return None
    return (A @ b.head_local, A @ b.tail_local)

def d2s(p, h, t):
    d = t - h
    L2 = d.dot(d)
    u = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - h).dot(d) / L2))
    return (p - (h + d * u)).length

handsegs = [s for s in (seg(b.name) for b in arm.data.bones if any(k in b.name for k in HAND_RE)) if s]
bodysegs = [s for s in (seg(n) for n in BODY) if s]
print('[fix] hand segs=%d body segs=%d' % (len(handsegs), len(bodysegs)))

def is_hand(n):
    return any(k in (n or '') for k in HAND_RE)

stripped = 0
for v in mesh.data.vertices:
    hw = sum(g.weight for g in v.groups if is_hand(gname.get(g.group)))
    if hw <= 1e-4:
        continue
    p = M @ v.co
    dh = min(d2s(p, h, t) for (h, t) in handsegs)
    db = min(d2s(p, h, t) for (h, t) in bodysegs)
    if db + MARGIN >= dh:
        continue
    best, bw = None, -1
    for g in v.groups:
        n = gname.get(g.group)
        if is_hand(n):
            continue
        if g.weight > bw: bw, best = g.weight, n
    tgt = best if best else 'Hips'
    if tgt not in gidx:
        continue
    for g in list(v.groups):
        if is_hand(gname.get(g.group)):
            mesh.vertex_groups[g.group].remove([v.index])
    mesh.vertex_groups[gidx[tgt]].add([v.index], hw, 'ADD')
    stripped += 1

print('[fix] stripped=%d (margin=%.3f)' % (stripped, MARGIN))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_apply=False, export_animations=False, export_skins=True,
    export_image_format='JPEG', export_jpeg_quality=88)
print('[fix] wrote %s  %d bytes' % (out, os.path.getsize(out)))
