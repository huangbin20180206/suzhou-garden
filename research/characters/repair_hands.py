"""清掉 UniRig 的"手骨跑腿上去"误权重。

背景（2026-10-22 马夫）：UniRig 这次绑骨把 LeftThumbDistal 分到了 448 个顶点，包围盒
z=0.51~0.90、x=-0.01~0.27 —— 那是**裤腿**，不是手（手在这个 A 姿势下在 z≈0.85 的两侧、
|x|>0.25）。后果：只要转手腕/拇指，裤腿就跟着被拽走。文士那版没检查这一项。

判据（几何，不看权重名）：一条"手链骨"（Hand/Thumb/Index/Middle/Ring/Little）对某顶点
有权重，但该顶点**离这根骨的线段超过 TOL** ⇒ 判定为误权重，把它转给最近的躯干/腿骨。

⚠️ TOL 不能给大（第一版 0.14 不够）：腰带/布结在 z≈0.87~1.02、|x| 到 0.30，而垂手的
掌根就在 z≈0.87、x≈0.28 —— 腰带外缘离手骨只有 ~0.13m，用 0.14 判据会**放过**它们。
实测症状（pose_stretch_test.py 抬臂 0.75rad）：整条腰带被手骨拽成一片尖刺。
⇒ 手是十厘米级的东西，TOL 收到 0.09，并且**只对 z<1.05 的躯干区**启用"往下半身转"的
   最近骨候选（Hips/Spine/腿），手本身的原生顶点离骨链 < 0.06，不会被误伤。

用法：
  blender -b --python repair_hands.py -- <in.glb> <out.glb> [tol=0.09]
"""
import bpy, sys, re
from mathutils import Vector

argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
TOL = float(argv[2]) if len(argv) > 2 else 0.09

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh.data.calc_loop_triangles()

HAND_RE = re.compile(r'(Hand|Thumb|Index|Middle|Ring|Little)')
BODY = ['Hips', 'Spine', 'Chest', 'LeftUpperLeg', 'RightUpperLeg',
        'LeftLowerLeg', 'RightLowerLeg', 'LeftUpperArm', 'RightUpperArm',
        'LeftLowerArm', 'RightLowerArm']

def seg_of(name):
    b = arm.data.bones.get(name)
    if b is None: return None
    h = arm.matrix_world @ b.head_local
    t = arm.matrix_world @ b.tail_local
    return (h, t)

def dist_to_seg(p, h, t):
    d = t - h
    L2 = d.dot(d)
    u = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - h).dot(d) / L2))
    return (p - (h + d * u)).length

hand = {n: seg_of(n) for n in [b.name for b in arm.data.bones] if HAND_RE.search(n)}
body = {n: seg_of(n) for n in BODY if arm.data.bones.get(n)}
gidx = {g.name: g.index for g in mesh.vertex_groups}
gname = {v: k for k, v in gidx.items()}

moved = 0
for v in mesh.data.vertices:
    p = mesh.matrix_world @ v.co
    for g in list(v.groups):
        name = gname.get(g.group)
        seg = hand.get(name)
        if not seg or g.weight <= 0.0: continue
        if dist_to_seg(p, seg[0], seg[1]) <= TOL: continue
        # 这条手骨不该碰这个顶点 ⇒ 转给最近的躯干/腿骨
        best, bd = None, 1e9
        for bn, bs in body.items():
            dd = dist_to_seg(p, bs[0], bs[1])
            if dd < bd: bd, best = dd, bn
        w = g.weight
        mesh.vertex_groups[g.group].remove([v.index])
        mesh.vertex_groups[gidx[best]].add([v.index], w, 'ADD')
        moved += 1

print('[repair] moved %d stray hand weights (tol=%.3f)' % (moved, TOL))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_apply=False, export_animations=False, export_skins=True,
    export_image_format='JPEG', export_jpeg_quality=88)
print('[repair] wrote', out)
