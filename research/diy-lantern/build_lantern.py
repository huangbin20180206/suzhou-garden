# stone-lantern 建模（Blender 5.2 命令行）—— 依据 research/diy-first-target.md §3
# 只写本目录；不碰 src / assets / sw.js / 13-preload。
import bpy, bmesh, math, os, sys
import numpy as np

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(OUT_DIR, 'stone-lantern.glb')

# ── §3.1 高度配比（总高 1.05，单位米，1 BU = 1 m）──
H_BASE, H_SHAFT, H_PLAT, H_LAMP, H_ROOF, H_FIN = 0.16, 0.34, 0.10, 0.24, 0.16, 0.05
Z0 = 0.0
Z_BASE = Z0                     # 0.00 -> 0.16
Z_SHAFT = Z_BASE + H_BASE       # 0.16 -> 0.50
Z_PLAT = Z_SHAFT + H_SHAFT      # 0.50 -> 0.60
Z_LAMP = Z_PLAT + H_PLAT        # 0.60 -> 0.84
Z_ROOF = Z_LAMP + H_LAMP        # 0.84 -> 1.00
Z_FIN = Z_ROOF + H_ROOF         # 1.00 -> 1.05

def act(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o

def cyl(name, r_bot, r_top, depth, zc, verts=8, cap='NGON'):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=1.0, depth=depth, end_fill_type=cap,
        location=(0, 0, zc))
    o = bpy.context.active_object; o.name = name
    # 用 taper 缩放顶圈：直接按半径做两个比例（简单起见顶底同径，需要收分时用 taper）
    if abs(r_bot - r_top) > 1e-6:
        me = o.data
        for v in me.vertices:
            t = (v.co.z + depth/2) / depth          # 0 底 -> 1 顶
            s = (r_bot + (r_top - r_bot) * t)
            v.co.x *= s; v.co.y *= s
    else:
        o.scale = (r_bot, r_bot, 1.0)
        bpy.ops.object.transform_apply(scale=True)
    return o

def cube(name, sx, sy, sz, loc):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name
    return o

parts = []

# ── 1 base 基座：八角须弥座，埋地 0.03，含 2mm 磨损倒角 ──
b1 = cyl('base_lo', 0.225, 0.215, 0.06, Z_BASE + 0.03)
b2 = cyl('base_hi', 0.190, 0.180, 0.10, Z_BASE + 0.06 + 0.05)
base = join([b1, b2], 'base')
bev = base.modifiers.new('wear', 'BEVEL'); bev.width = 0.006; bev.segments = 1; bev.angle_limit = math.radians(40)
bpy.ops.object.modifier_apply(modifier=bev.name)

# ── 2 shaft 柱身：八角直柱 + 束腰（不做贴花）──
s1 = cyl('shaft_lo', 0.090, 0.086, 0.14, Z_SHAFT + 0.07)
s2 = cyl('shaft_waist', 0.078, 0.078, 0.06, Z_SHAFT + 0.14 + 0.03)
s3 = cyl('shaft_hi', 0.086, 0.090, 0.14, Z_SHAFT + 0.20 + 0.07)
shaft = join([s1, s2, s3], 'shaft')

# ── 3 platform 中台：八角承台，下沿出挑 0.04 ──
p1 = cyl('plat_lo', 0.170, 0.170, 0.04, Z_PLAT + 0.02)
p2 = cyl('plat_hi', 0.150, 0.155, 0.06, Z_PLAT + 0.04 + 0.03)
platform = join([p1, p2], 'platform')

# ── 4 lamp 火袋：下环 0.045 + 四角柱 0.15（窗 0.12 宽 × 0.15 高）+ 上环 0.045 + 内芯(发光) ──
ring_lo = cyl('lamp_rlo', 0.140, 0.140, 0.045, Z_LAMP + 0.0225)
ring_hi = cyl('lamp_rhi', 0.140, 0.140, 0.045, Z_LAMP + 0.195 + 0.0225)
posts = []
for sx in (-1, 1):
    for sy in (-1, 1):
        posts.append(cube('lamp_post', 0.05, 0.05, 0.15,
                          (sx*0.085, sy*0.085, Z_LAMP + 0.045 + 0.075)))
lamp = join([ring_lo, ring_hi] + posts, 'lamp')
lb = lamp.modifiers.new('edge', 'BEVEL'); lb.width = 0.004; lb.segments = 1; lb.angle_limit = math.radians(40)
bpy.ops.object.modifier_apply(modifier=lb.name)
# 内芯（发光面）：八角柱，半径 0.115，高度 = 窗高 0.15，与 lamp 同物体、第二材质槽
glow = cyl('lamp_glow', 0.115, 0.115, 0.15, Z_LAMP + 0.045 + 0.075)
lamp = join([lamp, glow], 'lamp')          # join 后 glow 面用下面单独指定槽

# ── 5 roof 笠：四角翘檐，最大外径 0.55（角对角），带 15mm 厚度 ──
def build_roof():
    me = bpy.data.meshes.new('roofMesh')
    bm = bmesh.new()
    r_corner, r_mid = 0.275, 0.275 / math.sqrt(2)
    def ring(z, scale, lift):
        vs = []
        for k in range(8):
            ang = math.radians(k * 45)                     # 0/90/180/270 = 边中点，45.. = 角
            is_corner = (k % 2 == 1)
            r = (r_corner if is_corner else r_mid) * scale
            zoff = lift * (1.0 if is_corner else -0.35)    # 角上翘、边微垂
            vs.append(bm.verts.new((r*math.cos(ang), r*math.sin(ang), z + zoff)))
        return vs
    r1 = ring(Z_ROOF, 1.00, 0.018)          # 檐口
    r2 = ring(Z_ROOF, 0.60, 0.010)
    r3 = ring(Z_ROOF + H_ROOF - 0.015, 0.20, 0.002)
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((r1[i], r1[j], r2[j], r2[i]))
        bm.faces.new((r2[i], r2[j], r3[j], r3[i]))
    bm.faces.new(r3)                             # 顶面封口
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('roof', me)
    bpy.context.collection.objects.link(o)
    act(o)
    sol = o.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = 0.015; sol.offset = -1.0
    bpy.ops.object.modifier_apply(modifier=sol.name)
    return o
roof = build_roof()

# ── 6 finial 宝珠：珠座(八角) + 球 ──
# 珠座 0.980→1.000（下沿埋进 roof 顶 7mm，避免悬空）；宝珠 1.000→1.050 ⇒ 总高恰 1.05
f1 = cyl('fin_base', 0.048, 0.042, 0.020, 0.990)
bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.025,
                                     location=(0, 0, 1.025))
f2 = bpy.context.active_object; f2.name = 'fin_orb'
bpy.ops.object.shade_smooth()
finial = join([f1, f2], 'finial')

parts = [base, shaft, platform, lamp, roof, finial]

# ── 材质 ──
def make_stone_image(N=1024):
    rng = np.random.default_rng(20261014)
    def up(g):
        h, w = g.shape
        ys = np.arange(N) * (h - 1) / (N - 1)
        xs = np.arange(N) * (w - 1) / (N - 1)
        y0 = np.floor(ys).astype(int); y1 = np.minimum(y0 + 1, h - 1); fy = (ys - y0)[:, None]
        x0 = np.floor(xs).astype(int); x1 = np.minimum(x0 + 1, w - 1); fx = (xs - x0)[None, :]
        a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]
        c = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
        top = a * (1 - fx) + b * fx; bot = c * (1 - fx) + d * fx
        return top * (1 - fy) + bot * fy
    f = np.zeros((N, N), np.float32)
    amp = 1.0; tot = 0.0
    for n in (8, 16, 32, 64, 128, 256):
        f += up(rng.random((n, n), dtype=np.float32)) * amp
        tot += amp; amp *= 0.55
    f /= tot
    f = (f - f.min()) / (np.ptp(f) + 1e-9)
    # 苏南石材：暖灰底 + 细颗粒 + 少量深斑
    base_rgb = np.array([0.705, 0.688, 0.645], np.float32)
    v = (0.86 + 0.28 * f)[..., None]
    rgb = np.clip(base_rgb * v, 0, 1)
    speck = (rng.random((N, N)) < 0.004)[..., None]
    rgb = np.where(speck, rgb * 0.62, rgb)
    rgba = np.concatenate([rgb, np.ones((N, N, 1), np.float32)], axis=2)
    return np.ascontiguousarray(rgba, np.float32)

img = bpy.data.images.new('stone_albedo', 1024, 1024, alpha=False, float_buffer=False)
img.colorspace_settings.name = 'sRGB'
img.pixels.foreach_set(make_stone_image().ravel())
img.update()
img.pack()

mat_stone = bpy.data.materials.new('stone_lantern'); mat_stone.use_nodes = True
nt = mat_stone.node_tree
bsdf = nt.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
bsdf.inputs['Roughness'].default_value = 0.86
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.location = (-340, 60)
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

mat_glow = bpy.data.materials.new('lantern_glow'); mat_glow.use_nodes = True
gb = mat_glow.node_tree.nodes.get('Principled BSDF')
gb.inputs['Base Color'].default_value = (0.02, 0.015, 0.01, 1)
gb.inputs['Roughness'].default_value = 0.9
gb.inputs['Emission Color'].default_value = (1.0, 0.74, 0.34, 1)
gb.inputs['Emission Strength'].default_value = 1.0      # =1 ⇒ 不触发 KHR_materials_emissive_strength

for p in parts:
    act(p)
    p.data.materials.clear()
    p.data.materials.append(mat_stone)

# lamp 的发光内芯单独占第二槽：按"与 lamp 同高区间且半径<=0.116"选面
lamp = bpy.data.objects['lamp']
lamp.data.materials.append(mat_glow)
me = lamp.data
zs = [v.co.z for v in me.vertices]
lo, hi = Z_LAMP + 0.045 - 1e-4, Z_LAMP + 0.045 + 0.15 + 1e-4
for poly in me.polygons:
    c = poly.center
    if lo - 1e-3 <= c.z <= hi + 1e-3 and math.hypot(c.x, c.y) <= 0.12:
        poly.material_index = 1

# ── UV（对每个石质部件做 smart project；glow 面无贴图，随选即可）──
for p in parts:
    act(p)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

# ── Apply Transforms（节点平移归零）──
for p in parts:
    act(p)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ── 统计 ──
print('=== PARTS ===')
tot_tri = 0
for p in parts:
    tri = sum(len(poly.vertices) - 2 for poly in p.data.polygons)
    bb = [tuple(round(c, 4) for c in corner) for corner in p.bound_box]
    zs_ = [b[2] for b in bb]; xs_ = [b[0] for b in bb]
    loc = tuple(round(c, 6) for c in p.location)
    tot_tri += tri
    print(f'PART {p.name}: tris={tri} polys={len(p.data.polygons)} mats={len(p.data.materials)} loc={loc} '
          f'x[{min(xs_):.3f},{max(xs_):.3f}] z[{min(zs_):.3f},{max(zs_):.3f}]')
print(f'TOTAL_TRIS={tot_tri}')
corners = [tuple(c) for p in parts for c in p.bound_box]      # bound_box = 8×(x,y,z)
xs = [c[0] for c in corners]; ys = [c[1] for c in corners]; zs = [c[2] for c in corners]
print(f'BBOX_LWH={max(xs)-min(xs):.4f},{max(ys)-min(ys):.4f},{max(zs)-min(zs):.4f}')
print(f'BBOX_Z=[{min(zs):.4f},{max(zs):.4f}] BBOX_X=[{min(xs):.4f},{max(xs):.4f}] BBOX_Y=[{min(ys):.4f},{max(ys):.4f}]')
print(f'OBJ_COUNT={len(parts)} MATERIALS={len(bpy.data.materials)} IMAGES={len(bpy.data.images)}')

# ── 清场 + 自检：场景里只许有这 6 件 ──
# ⚠️ 首版教训（2026-10-14）：导出 use_selection=False 会把**整个场景**打包，
#    当时残留一个未缩放的单位立方体（12 tris / bbox ±1 / 默认 Material）⇒ GLB 多出
#    node "Cube"、materials 3 个、tris 1012（= 6 件 1000 + 垃圾 12），且该盒穿模全模型。
#    故：删掉不在 parts 名单里的对象 + 删掉零引用材质，并断言后再导出。
keep = {p.name for p in parts}
for o in list(bpy.data.objects):
    if o.name not in keep:
        n = len(o.data.vertices) if (o.data is not None and hasattr(o.data, 'vertices')) else 0
        print(f'PURGE_OBJECT name={o.name} type={o.type} verts={n}')
        bpy.data.objects.remove(o, do_unlink=True)
WANT_MATS = {'stone_lantern', 'lantern_glow'}
for m in list(bpy.data.materials):
    if m.name not in WANT_MATS:
        # 默认场景的 Material 带 fake user，users==0 判不出来 ⇒ 按白名单删
        print(f'PURGE_MATERIAL name={m.name} users={m.users} fake={m.use_fake_user}')
        m.use_fake_user = False
        bpy.data.materials.remove(m, do_unlink=True)
left = [o.name for o in bpy.data.objects]
print('SCENE_OBJECTS=' + str(len(left)) + ':' + ','.join(sorted(left)))
print('SCENE_MATERIALS=' + str(len(bpy.data.materials)) + ':' + ','.join(sorted(m.name for m in bpy.data.materials)))
assert len(bpy.data.objects) == 6, f'对象数应为 6，实为 {len(left)}: {left}'
assert len(bpy.data.materials) == 2, f'材质数应为 2，实为 {len(bpy.data.materials)}'

# ── 导出 GLB：无压缩扩展、内嵌贴图、Apply、Y-up、1BU=1m ──
kwargs = dict(filepath=GLB, export_format='GLB', export_apply=True, export_yup=True,
              export_draco_mesh_compression_enable=False, export_materials='EXPORT',
              export_cameras=False, export_lights=False, use_selection=False)
try:
    bpy.ops.export_scene.gltf(export_image_format='JPEG', export_image_quality=90, **kwargs)
    print('EXPORT_OK image_format=JPEG')
except TypeError as e:
    print('EXPORT_RETRY1', e)
    bpy.ops.export_scene.gltf(**kwargs)
    print('EXPORT_OK image_format=default')
print('GLB_PATH=' + GLB)
