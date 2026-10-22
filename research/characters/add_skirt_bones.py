"""给长袍/长裙角色补 6 根裙骨，并把下摆顶点从腿骨上改绑到裙骨。

为什么（2026-10-22，P2 前置）：
  · 走路不需要裙骨（实测 ±0.38rad 不撕），但**坐姿一定需要** —— 膝盖抬到腰时，
    绑在腿上的锥面会被大腿顶成帐篷；
  · 顺带解决"腰带/衣摆带手臂权重"：这一步把下摆整体改绑到裙骨，手臂权重一并清掉。

判据（几何，不看权重名）：
  · 只在 z ∈ [hem, hip] 之间动手；
  · 手链骨权重 > --armcut（默认 0.20）的顶点**跳过**（那是袖子/手，必须留在手臂上）；
  · 半径 > --rmax（默认 0.33）的跳过（垂手/张开的手臂在轮廓之外）。
  ⚠️ 这两条是必须的：A 姿势下手在 z=0.75~0.90、半径 0.44~0.60，与下摆的 z 区间重叠。

权重：按角度分给相邻两根裙骨（余弦插值），并按高度往 Hips 渐混
（hem 处 100% 裙骨、hip 处 45% 裙骨 / 55% Hips），保证坐在椅子上时腰不脱节。

用法：
  blender -b --python add_skirt_bones.py -- <in.glb> <out.glb> [hem=0.12] [hip=auto] [tex=1024]
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
args = {}
for a in argv[2:]:
    if '=' in a:
        k, v = a.split('=', 1)
        args[k] = v
HEM = float(args.get('hem', 0.12))
HIP_OVERRIDE = float(args['hip']) if 'hip' in args else None
TEX = int(args.get('tex', 1024))
ARMCUT = float(args.get('armcut', 0.20))
RMAX = float(args.get('rmax', 0.33))
NB = int(args.get('nbones', 6))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
M = mesh.matrix_world
A = arm.matrix_world

hips = arm.data.bones['Hips']
HIP = HIP_OVERRIDE if HIP_OVERRIDE is not None else (A @ hips.head_local).z
print('[skirt] hip z=%.3f  hem z=%.3f  bones=%d' % (HIP, HEM, NB))

ARM_KEYS = ('UpperArm', 'LowerArm', 'Hand', 'Thumb', 'Index', 'Middle', 'Ring', 'Little')
gname = {g.index: g.name for g in mesh.vertex_groups}

# ── 1. 加骨 ────────────────────────────────────────────────────────────────
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
made = []
for i in range(NB):
    name = 'Skirt%d' % i
    if name in eb:
        eb.remove(eb[name])
    b = eb.new(name)
    a = 2 * math.pi * i / NB            # 0 = 正前（Blender 里人物朝 −Y）
    dx, dy = math.sin(a), -math.cos(a)
    b.head = Vector((0.0, 0.0, HIP))
    b.tail = Vector((dx * 0.20, dy * 0.20, HEM + 0.02))
    b.parent = eb['Hips']
    b.use_connect = False
    made.append((name, dx, dy))
bpy.ops.object.mode_set(mode='OBJECT')

for name, _, _ in made:
    if name not in mesh.vertex_groups:
        mesh.vertex_groups.new(name=name)
gidx = {g.name: g.index for g in mesh.vertex_groups}

# ── 2. 改权重 ──────────────────────────────────────────────────────────────
def smoothstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)

skirt_bones = [(name, math.atan2(dx, -dy)) for name, dx, dy in made]   # 角度：0=前
moved = 0
skipped_arm = 0
skipped_far = 0
for v in mesh.data.vertices:
    w = M @ v.co
    if not (HEM <= w.z <= HIP):
        continue
    armw = 0.0
    for g in v.groups:
        n = gname.get(g.group) or ''
        if any(k in n for k in ARM_KEYS):
            armw += g.weight
    if armw > ARMCUT:
        skipped_arm += 1
        continue
    r = math.hypot(w.x, w.y)
    if r > RMAX:
        skipped_far += 1
        continue
    # 角度 → 相邻两根裙骨
    th = math.atan2(w.x, -w.y)
    best = sorted(skirt_bones, key=lambda kb: abs(((th - kb[1] + math.pi) % (2 * math.pi)) - math.pi))
    w0 = 1.0
    if len(best) >= 2:
        d0 = abs(((th - best[0][1] + math.pi) % (2 * math.pi)) - math.pi)
        d1 = abs(((th - best[1][1] + math.pi) % (2 * math.pi)) - math.pi)
        s = (math.cos(d0) + 1e-6) / (math.cos(d0) + math.cos(d1) + 2e-6)
        w0 = max(0.0, min(1.0, s))
    # 高度 → 往 Hips 渐混
    t = (w.z - HEM) / max(1e-6, HIP - HEM)
    skirt = 1.0 - 0.55 * smoothstep(t)
    hips_w = 1.0 - skirt
    # 清掉全部旧权重
    for g in list(v.groups):
        mesh.vertex_groups[g.group].remove([v.index])
    mesh.vertex_groups[gidx[best[0][0]]].add([v.index], skirt * w0, 'REPLACE')
    if w0 < 0.999:
        mesh.vertex_groups[gidx[best[1][0]]].add([v.index], skirt * (1 - w0), 'REPLACE')
    if hips_w > 0.001:
        mesh.vertex_groups[gidx['Hips']].add([v.index], hips_w, 'REPLACE')
    moved += 1

print('[skirt] reweighted=%d  skipped(arm)=%d  skipped(far)=%d' % (moved, skipped_arm, skipped_far))
print('[skirt] bones: ' + ', '.join('%s@%.0f°' % (n, math.degrees(a) % 360) for n, a in skirt_bones))

# ── 3. 贴图降采样 + 导出 ───────────────────────────────────────────────────
for im in bpy.data.images:
    if im.size[0] > TEX or im.size[1] > TEX:
        print('[skirt] resize', im.name, im.size[:], '->', TEX)
        im.scale(TEX, TEX); im.pack()

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_apply=False, export_animations=False, export_skins=True,
    export_image_format='JPEG', export_jpeg_quality=88)
print('[skirt] wrote %s  %d bytes' % (out, os.path.getsize(out)))
