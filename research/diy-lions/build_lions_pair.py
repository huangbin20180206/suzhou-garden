# stone-lion v5（Blender 5.2）：一公一母**两只**，公踩绣球 / 母抚幼狮
# 依据（维基"石狮子"条，2026-10-18 取）：
#   · 看门石狮成双成对，**左雄右雌**（合男左女右）；判据是"**从大门里出来**时，
#     雄狮在人的左侧、雌狮在右侧"。
#   · 雄狮：右前爪玩弄绣球（或两前爪之间放绣球）；雌狮：左前爪抚摸幼狮（或两前爪间卧幼狮）。
#   · 造型共性：满头卷发、须弥座。
# 形体做法：躯干+头用**融球**合成一整块（v4 验证过：基本体堆出来一眼是"几个球"），
#   鬃髻/眼/耳/项圈/尾再用小件叠；最后合并 + 顶点色斑驳 + 单材质。
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, noise, Euler

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def act(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    return o

def apply_all(o):
    act(o); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); return o

parts = []
def cube(name, sx, sy, sz, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx, sy, sz); o.rotation_euler = rot
    parts.append(apply_all(o)); return o

def sph(name, rx, ry, rz, loc, seg=10, ring=7, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (rx, ry, rz); o.rotation_euler = rot
    parts.append(apply_all(o)); return o

def torus(name, major, minor, loc, rot=(0, 0, 0), mseg=16, nseg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=mseg, minor_segments=nseg, location=loc)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = rot
    parts.append(apply_all(o)); return o

# ── 尺寸（总高 ~1.12；须弥座 0.22 + 狮身 ~0.90）──
H1, H2, H3 = 0.100, 0.090, 0.030
Z = H1 + H2 + H3                      # 0.220 狮脚所在面
HC = (0.0, 0.195, Z + 0.665)          # 头心
R0 = 0.142                            # 鬃髻环半径（≈头半径，让卷发**贴着**头，不是飘在外的光环）

def build_stone():
    """两只共用的狮身：须弥座 + 融球躯干/头 + 五官/鬃髻/项圈/尾"""
    cube('lionBase1', 0.720, 0.720, H1, (0, 0, H1 / 2))
    cube('lionBase2', 0.600, 0.600, H2, (0, 0, H1 + H2 / 2))
    cube('lionBase3', 0.660, 0.660, H3, (0, 0, H1 + H2 + H3 / 2))

    # ── 融球：躯干 + 头（一次熔成整块石）──
    mb = bpy.data.metaballs.new('lionBody')
    mb.resolution = 0.020; mb.render_resolution = 0.020
    mbo = bpy.data.objects.new('lionBody', mb)
    bpy.context.collection.objects.link(mbo)
    def ell(co, size, stiff=2.0):
        e = mb.elements.new(type='ELLIPSOID')
        e.co = Vector(co); e.size_x, e.size_y, e.size_z = size
        e.stiffness = stiff; e.rotation = Euler((0, 0, 0)).to_quaternion()
    ell((0, -0.115, Z + 0.240), (0.120, 0.155, 0.148))     # 后胯
    ell((0,  0.010, Z + 0.320), (0.112, 0.150, 0.130))     # 腰背
    ell((0,  0.135, Z + 0.375), (0.120, 0.128, 0.138))     # 前胸
    ell((0,  0.170, Z + 0.500), (0.092, 0.098, 0.102))     # 颈
    ell((0,  0.195, Z + 0.665), (0.138, 0.128, 0.128))     # 头（方、大）
    ell((0,  0.330, Z + 0.615), (0.086, 0.088, 0.070))     # 吻（**前伸出去**，脸才有东西）
    ell((0,  0.305, Z + 0.552), (0.078, 0.072, 0.052))     # 下颌
    ell((0,  0.292, Z + 0.706), (0.108, 0.046, 0.036))     # 眉弓（横向，压出怒目）
    for s in (1, -1):
        ell((s * 0.115, 0.240, Z + 0.205), (0.052, 0.056, 0.108))   # 前腿
        ell((s * 0.120, 0.258, Z + 0.055), (0.080, 0.098, 0.044))   # 前爪
        ell((s * 0.190, -0.078, Z + 0.052), (0.074, 0.092, 0.042))  # 后爪
    act(mbo); bpy.ops.object.convert(target='MESH')
    body = bpy.context.active_object; body.name = 'lionBodyMesh'
    dec = body.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.40
    act(body); bpy.ops.object.modifier_apply(modifier='dec')
    parts.append(body)

    # ── 螺髻：罩住头顶与后脑的一层卷发（**跳过下巴底下**，否则成"项圈"）──
    rows = [(30, 7, 0.050), (58, 12, 0.052), (86, 12, 0.050), (114, 10, 0.046), (140, 8, 0.042)]
    for ri, (theta, n, curl) in enumerate(rows):
        th = math.radians(theta)
        rad = R0 * math.sin(th)
        yy = HC[1] + R0 * math.cos(th) * 1.02
        for i in range(n):
            a = i / n * math.pi * 2 + ri * 0.30
            dz = math.sin(a) * rad
            if theta > 100 and dz < -0.05:      # 下巴与颈下不摆卷
                continue
            sph('curl%d_%d' % (ri, i), curl, curl, curl,
                (math.cos(a) * rad, yy, HC[2] + dz), seg=8, ring=6)

    # ── 耳 / 眼（贴在头面上，凸出一点才看得见）──
    for s in (1, -1):
        sd = 'R' if s > 0 else 'L'
        sph('ear' + sd, 0.052, 0.036, 0.056, (s * 0.122, 0.145, HC[2] + 0.100), seg=8, ring=6)
        sph('eye' + sd, 0.032, 0.030, 0.030, (s * 0.072, HC[1] + 0.108, HC[2] + 0.036), seg=8, ring=6)
        sph('nostril' + sd, 0.018, 0.016, 0.014, (s * 0.030, HC[1] + 0.205, HC[2] - 0.020), seg=6, ring=5)
    # ── 项圈 + 铃铛 ──
    torus('collar', 0.172, 0.026, (0, HC[1] - 0.045, HC[2] - 0.180), rot=(math.pi / 2 - 0.40, 0, 0))
    sph('bell', 0.042, 0.042, 0.046, (0, HC[1] + 0.135, HC[2] - 0.235), seg=8, ring=6)
    # ── 尾（贴背卷上，带尾球）──
    cube('tail1', 0.085, 0.140, 0.200, (0, -0.310, Z + 0.110), rot=(math.radians(-15), 0, 0))
    cube('tail2', 0.075, 0.120, 0.165, (0, -0.335, Z + 0.255), rot=(math.radians(-5), 0, 0))
    sph('tailTip', 0.064, 0.068, 0.060, (0, -0.328, Z + 0.362), seg=8, ring=6)

def add_ball():
    """雄狮：右前爪戏绣球（球在右前爪下，右腿因此短一截、爪搭在球上）"""
    bx, by, bz = 0.150, 0.300, Z + 0.100
    sph('ball', 0.098, 0.098, 0.098, (bx, by, bz), seg=14, ring=10)
    for a in (0.55, -0.55):
        torus('ballBand%+.2f' % a, 0.098, 0.016, (bx, by, bz), rot=(0, math.pi / 2, a), mseg=18, nseg=6)
    sph('ballKnot', 0.028, 0.028, 0.028, (bx, by, bz + 0.100), seg=8, ring=6)

def add_cub():
    """雌狮：左前爪抚幼狮（幼狮仰卧、四爪朝上，卧在两前爪之间偏左）"""
    cx, cy, cz = -0.150, 0.300, Z + 0.112
    sph('cubBody', 0.098, 0.120, 0.072, (cx, cy, cz), seg=12, ring=8, rot=(math.radians(72), 0, 0))
    sph('cubHead', 0.062, 0.062, 0.058, (cx - 0.030, cy + 0.088, cz + 0.030), seg=10, ring=7)
    for s in (1, -1):
        sph('cubEar%+d' % s, 0.026, 0.020, 0.028, (cx - 0.030 + s * 0.052, cy + 0.095, cz + 0.078), seg=6, ring=5)
        sph('cubPawA%+d' % s, 0.030, 0.030, 0.028, (cx + s * 0.058, cy + 0.030, cz + 0.098), seg=6, ring=5)
        sph('cubPawB%+d' % s, 0.030, 0.030, 0.028, (cx + s * 0.062, cy - 0.052, cz + 0.092), seg=6, ring=5)
    for i in range(6):
        a = i / 6 * math.pi * 2
        sph('cubCurl%d' % i, 0.030, 0.030, 0.030,
            (cx - 0.030 + math.cos(a) * 0.062, cy + 0.070, cz + 0.030 + math.sin(a) * 0.062), seg=6, ring=5)
    sph('cubTail', 0.030, 0.048, 0.028, (cx, cy - 0.120, cz - 0.010), seg=6, ring=5)

def finalize(name, glb):
    act(parts[0])
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    lion = bpy.context.active_object; lion.name = 'stoneLion_' + name
    me = lion.data
    col = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    for i, v in enumerate(me.vertices):
        p = v.co
        n = noise.noise(Vector((p.x * 9.0, p.y * 9.0, p.z * 9.0)))
        t = 0.90 + 0.10 * (n * 0.5 + 0.5)
        col.data[i].color = (t, t * 0.995, t * 0.975, 1.0)
    mat = bpy.data.materials.new('lion_stone')
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    assert bsdf is not None
    bsdf.inputs['Base Color'].default_value = (0.760, 0.752, 0.726, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.88
    if 'Metallic' in bsdf.inputs: bsdf.inputs['Metallic'].default_value = 0.0
    me.materials.clear(); me.materials.append(mat)
    bpy.ops.object.shade_smooth()
    me.calc_loop_triangles()
    zs = [v.co.z for v in me.vertices]
    print('VARIANT=%s TRIS=%d Z=[%.3f,%.3f]' % (name, len(me.loop_triangles), min(zs), max(zs)))
    for o in list(bpy.data.objects):
        if o.name != lion.name:
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.materials):
        if m.name != 'lion_stone':
            m.use_fake_user = False
            bpy.data.materials.remove(m, do_unlink=True)
    assert len(bpy.data.objects) == 1 and len(bpy.data.materials) == 1, '清场失败'
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=True, export_yup=True,
                              export_draco_mesh_compression_enable=False, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, use_selection=False)
    print('GLB=%s BYTES=%d' % (os.path.basename(glb), os.path.getsize(glb)))

for variant in ('male', 'female'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = []
    build_stone()
    if variant == 'male': add_ball()
    else: add_cub()
    finalize(variant, os.path.join(OUT_DIR, 'stone-lion-' + variant + '.glb'))
