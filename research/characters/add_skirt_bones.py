"""给长袍/长裙角色补裙骨（1 段或 2 段），并把下摆顶点从腿骨上改绑到裙骨。

为什么（2026-10-22，P2 前置）：
  · 走路不需要裙骨（实测 ±0.38rad 不撕），但**坐姿一定需要** —— 膝盖抬到腰时，
    绑在腿上的锥面会被大腿顶成帐篷；
  · 顺带解决"腰带/衣摆带手臂权重"：这一步把下摆整体改绑到裙骨，手臂权重一并清掉。

段数：
  · seg=1：6 根 Skirt0..5（髋 → 下摆）。够**跪坐**（整体缩短 + 径向撑开）。
  · seg=2：12 根 Skirt{i}a（髋 → 膝线）/ Skirt{i}b（膝线 → 下摆），b 以 a 为父。
    够**坐凳**：a 前翻盖住大腿、b 反向垂到地面（单段做不出 L 形，实测是"贵妃榻"）。

判据（几何，不看权重名）：
  · 只在 z ∈ [hem, hip] 之间动手；
  · 手链骨权重 > --armcut（默认 0.20）的顶点**跳过**（那是袖子/手，必须留在手臂上）；
  · 半径 > --rmax（默认 0.33）的跳过（垂手/张开的手臂在轮廓之外）。
  ⚠️ 这两条是必须的：A 姿势下手在 z=0.75~0.90、半径 0.44~0.60，与下摆的 z 区间重叠。

权重：按角度分给相邻两根裙骨（余弦插值），并按高度往 Hips 渐混
（下摆 100% 裙骨、髋部 45% 裙骨 / 55% Hips），保证坐着时腰不脱节。

用法：
  blender -b --python add_skirt_bones.py -- <in.glb> <out.glb> [hem=0.12] [seg=2] [tex=1024]
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
RMIN = float(args.get('rmin', 0.15))   # 半径小于这个 = 袍内的腿/裤，不能跟着裙骨走
NB = int(args.get('nbones', 6))
SEG = int(args.get('seg', 1))
SPLIT_T = float(args.get('split', 0.57))      # 膝线高度占比（0=下摆 1=髋）

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
M = mesh.matrix_world
A = arm.matrix_world

hips = arm.data.bones['Hips']
HIP = HIP_OVERRIDE if HIP_OVERRIDE is not None else (A @ hips.head_local).z
ZSPLIT = HEM + (HIP - HEM) * SPLIT_T
print('[skirt] hip z=%.3f  hem z=%.3f  seg=%d  knee-line z=%.3f' % (HIP, HEM, SEG, ZSPLIT))

ARM_KEYS = ('UpperArm', 'LowerArm', 'Hand', 'Thumb', 'Index', 'Middle', 'Ring', 'Little')
gname = {g.index: g.name for g in mesh.vertex_groups}

# ── 1. 加骨 ────────────────────────────────────────────────────────────────
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
made = []          # (a_name, b_name|None, angle, dir)
for i in range(NB):
    a_ang = 2 * math.pi * i / NB           # 0 = 正前（Blender 里人物朝 −Y）
    dx, dy = math.sin(a_ang), -math.cos(a_ang)
    a_name = 'Skirt%da' % i if SEG == 2 else 'Skirt%d' % i
    b_name = 'Skirt%db' % i if SEG == 2 else None
    for n in (a_name, b_name):
        if n and n in eb:
            eb.remove(eb[n])
    ba = eb.new(a_name)
    ba.head = Vector((0.0, 0.0, HIP))
    ba.tail = Vector((dx * 0.13, dy * 0.13, ZSPLIT)) if SEG == 2 else \
              Vector((dx * 0.20, dy * 0.20, HEM + 0.02))
    ba.parent = eb['Hips']
    ba.use_connect = False
    if SEG == 2:
        bb = eb.new(b_name)
        bb.head = Vector((dx * 0.13, dy * 0.13, ZSPLIT))
        bb.tail = Vector((dx * 0.20, dy * 0.20, HEM + 0.02))
        bb.parent = ba
        bb.use_connect = True
    made.append((a_name, b_name, a_ang, (dx, dy)))
bpy.ops.object.mode_set(mode='OBJECT')

for a_name, b_name, _, _ in made:
    for n in (a_name, b_name):
        if n and n not in mesh.vertex_groups:
            mesh.vertex_groups.new(name=n)
gidx = {g.name: g.index for g in mesh.vertex_groups}

def smoothstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)

panels = [(a_name, b_name, ang) for a_name, b_name, ang, _ in made]
moved = skipped_arm = skipped_far = skipped_inner = 0
for v in mesh.data.vertices:
    w = M @ v.co
    if not (HEM <= w.z <= HIP):
        continue
    armw = sum(g.weight for g in v.groups
               if any(k in (gname.get(g.group) or '') for k in ARM_KEYS))
    if armw > ARMCUT:
        skipped_arm += 1
        continue
    r = math.hypot(w.x, w.y)
    if r < RMIN:
        skipped_inner += 1
        continue
    if r > RMAX:
        skipped_far += 1
        continue

    th = math.atan2(w.x, -w.y)
    best = sorted(panels, key=lambda p: abs(((th - p[2] + math.pi) % (2 * math.pi)) - math.pi))
    w0 = 1.0
    if len(best) >= 2:
        d0 = abs(((th - best[0][2] + math.pi) % (2 * math.pi)) - math.pi)
        d1 = abs(((th - best[1][2] + math.pi) % (2 * math.pi)) - math.pi)
        s = (math.cos(d0) + 1e-6) / (math.cos(d0) + math.cos(d1) + 2e-6)
        w0 = max(0.0, min(1.0, s))

    t = (w.z - HEM) / max(1e-6, HIP - HEM)      # 0=下摆 1=髋
    skirt = 1.0 - 0.55 * smoothstep(t)
    hips_w = 1.0 - skirt

    for g in list(v.groups):
        mesh.vertex_groups[g.group].remove([v.index])

    if SEG == 2 and w.z < ZSPLIT:
        # 膝线以下：全给 b（两根混合）；a 在膝线附近做过渡，避免折角断裂
        blend = smoothstep((ZSPLIT - w.z) / 0.10)      # 0 在膝线附近 → 1 到底
        b0, b1 = best[0][1], best[1][1] if len(best) > 1 else (best[0][1], None)
        mesh.vertex_groups[gidx[b0]].add([v.index], skirt * w0 * blend, 'REPLACE')
        if b1 and w0 < 0.999:
            mesh.vertex_groups[gidx[b1]].add([v.index], skirt * (1 - w0) * blend, 'REPLACE')
        a0, a1 = best[0][0], best[1][0] if len(best) > 1 else (best[0][0], None)
        mesh.vertex_groups[gidx[a0]].add([v.index], skirt * w0 * (1 - blend), 'REPLACE')
        if a1 and w0 < 0.999:
            mesh.vertex_groups[gidx[a1]].add([v.index], skirt * (1 - w0) * (1 - blend), 'REPLACE')
    else:
        a0, a1 = best[0][0], best[1][0] if len(best) > 1 else (best[0][0], None)
        mesh.vertex_groups[gidx[a0]].add([v.index], skirt * w0, 'REPLACE')
        if a1 and w0 < 0.999:
            mesh.vertex_groups[gidx[a1]].add([v.index], skirt * (1 - w0), 'REPLACE')
    if hips_w > 0.001:
        mesh.vertex_groups[gidx['Hips']].add([v.index], hips_w, 'REPLACE')
    moved += 1

print('[skirt] reweighted=%d  skipped(arm)=%d  skipped(far)=%d  skipped(inner)=%d' % (moved, skipped_arm, skipped_far, skipped_inner))

# ── 2. 贴图降采样 + 导出 ───────────────────────────────────────────────────
for im in bpy.data.images:
    if im.size[0] > TEX or im.size[1] > TEX:
        print('[skirt] resize', im.name, im.size[:], '->', TEX)
        im.scale(TEX, TEX); im.pack()

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_apply=False, export_animations=False, export_skins=True,
    export_image_format='JPEG', export_jpeg_quality=88)
print('[skirt] wrote %s  %d bytes' % (out, os.path.getsize(out)))
