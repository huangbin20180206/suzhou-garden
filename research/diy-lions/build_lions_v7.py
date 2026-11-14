# stone-lion v7（融合版 · Blender 5.2）：tabbit 的身子 + 自制的脸
# 身子（借 tabbit 的比例与须弥座，×0.5 缩到门口尺寸）：
#   六层须弥座（圭角/下枋/覆莲/束腰/仰莲/上枋）+ 坐姿胸腔/后臀/前腿/后肢/卷尾
# 脸（威猛挂，老黄："哪有这样的（卡哇伊）石狮子"）：
#   方头阔口、眉骨下压、怒目（三层：暗窝+石珠+暗仁、内角下斜）、大鼻、
#   张口（暗腔+上牙4+獠牙2+下牙4）、小耳后贴、满鬃（顶/腮/肩三区）。
# 材质（借 tabbit 的青石思路，转成能上网页的：顶点色斑驳经 Attribute→Multiply 进 BSDF；
#   Pointiness 是 Cycles 专用、导不出 GLB，不用）。
# 公母：公右爪踩绣球 / 母左爪抚幼狮；左雄右雌；脸朝 +Y（沿用 v6 摆位，ry=PI 迎客）。
import bpy, math, os
import numpy as np
from mathutils import Vector, Euler, noise
from mathutils.bvhtree import BVHTree

BODY_MESH = None   # 融球转成的身子网格（build_body 落定），脸部摆位全按它实测

def surf_y(x, z):
    """从 +y 往 -y 打射线，取身子在该 (x,z) 处的真实前表面（v7 血泪：
       手算�球面被融球融合坑了两次，鼻/嘴全埋进头里，外面一点看不见）"""
    dg = bpy.context.evaluated_depsgraph_get()
    bv = BVHTree.FromObject(BODY_MESH, dg)
    hit = bv.ray_cast((x, 5.0, z), (0, -1, 0))
    assert hit[0] is not None, 'ray miss at %.3f %.3f' % (x, z)
    return hit[0].y

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def act(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    return o

def apply_all(o):
    act(o); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); return o

parts = []
darkParts = []
def cube(name, sx, sy, sz, loc, rot=(0, 0, 0), dark=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx, sy, sz); o.rotation_euler = rot
    (darkParts if dark else parts).append(apply_all(o)); return o

def sph(name, rx, ry, rz, loc, seg=10, ring=7, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (rx, ry, rz); o.rotation_euler = rot
    parts.append(apply_all(o)); return o

def sphD(name, rx, ry, rz, loc, seg=8, ring=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (rx, ry, rz)
    darkParts.append(apply_all(o)); return o

def cone(name, r, depth, loc, flip=False, seg=8):
    bpy.ops.mesh.primitive_cone_add(radius1=r, depth=depth, location=loc, vertices=seg)
    o = bpy.context.active_object; o.name = name
    if flip: o.rotation_euler = (math.pi, 0, 0)
    parts.append(apply_all(o)); return o

def torus(name, major, minor, loc, rot=(0, 0, 0), mseg=16, nseg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                      major_segments=mseg, minor_segments=nseg, location=loc)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = rot
    parts.append(apply_all(o)); return o

Z0 = 0.30                                   # 须弥座顶面
FH = (0.0, 0.10, Z0 + 0.52)                 # 头心 (0, 0.10, 0.82)

def build_pedestal():
    """六层须弥座（tabbit 比例 ×0.5）：圭角/下枋/覆莲/束腰/仰莲/上枋"""
    layers = [(0.84, 0.70, 0.06, 0.06), (0.80, 0.66, 0.07, 0.155),
              (0.76, 0.62, 0.05, 0.215), (0.68, 0.55, 0.08, 0.28),
              (0.76, 0.62, 0.05, 0.345), (0.78, 0.64, 0.05, 0.395 - 0.12)]
    # 上枋顶面 = 0.30：最后一层中心 z = 0.30-0.025=0.275
    layers = [(0.84, 0.70, 0.12, 0.06), (0.80, 0.66, 0.07, 0.155),
              (0.76, 0.62, 0.05, 0.215), (0.68, 0.55, 0.08, 0.28),
              (0.76, 0.62, 0.05, 0.345), (0.78, 0.64, 0.05, 0.275)]
    for i, (sx, sy, sz, z) in enumerate(layers):
        cube('ped%d' % i, sx, sy, sz, (0, 0, z))

def build_body():
    """坐姿体块（tabbit 姿态：胸腔前倾、后臀蹲坐）"""
    mb = bpy.data.metaballs.new('lionBody')
    mb.resolution = 0.020; mb.render_resolution = 0.020
    mbo = bpy.data.objects.new('lionBody', mb)
    bpy.context.collection.objects.link(mbo)
    def ell(co, size, stiff=2.0):
        e = mb.elements.new(type='ELLIPSOID')
        e.co = Vector(co); e.size_x, e.size_y, e.size_z = size
        e.stiffness = stiff; e.rotation = Euler((0, 0, 0)).to_quaternion()
    ell((0, 0.02, Z0 + 0.26), (0.170, 0.160, 0.190))     # 胸腔
    ell((0, -0.10, Z0 + 0.15), (0.150, 0.140, 0.130))    # 后臀
    ell((0, 0.06, Z0 + 0.38), (0.100, 0.100, 0.110))     # 颈
    ell((FH[0], FH[1], FH[2]), (0.150, 0.135, 0.140))   # 头（方大）
    ell((0, 0.20, 0.78), (0.095, 0.075, 0.070))         # 吻
    ell((0, 0.185, 0.70), (0.085, 0.060, 0.055))        # 下颌
    for s in (1, -1):
        ell((s * 0.11, 0.02, Z0 + 0.13), (0.055, 0.060, 0.130))   # 前腿
        ell((s * 0.11, 0.06, Z0 + 0.035), (0.075, 0.090, 0.050))  # 前爪（大）
        ell((s * 0.13, -0.12, Z0 + 0.10), (0.080, 0.110, 0.120))  # 后肢
    act(mbo); bpy.ops.object.convert(target='MESH')
    body = bpy.context.active_object; body.name = 'lionBodyMesh'
    dec = body.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.45
    act(body); bpy.ops.object.modifier_apply(modifier='dec')
    parts.append(body)
    global BODY_MESH
    BODY_MESH = body
    # 尾（贴背卷上，带尾球）
    cube('tail1', 0.070, 0.100, 0.170, (0, -0.235, Z0 + 0.10), rot=(math.radians(-15), 0, 0))
    cube('tail2', 0.060, 0.090, 0.140, (0, -0.250, Z0 + 0.225), rot=(math.radians(-5), 0, 0))
    sph('tailTip', 0.055, 0.058, 0.052, (0, -0.245, Z0 + 0.315), seg=8, ring=6)

def build_face():
    """威猛脸：全部件按射线实测表面摆放（拒绝手算）"""
    for s in (1, -1):
        sd = 'R' if s > 0 else 'L'
        # 眉骨：横条向内下压（怒意就靠它；大块件，直接嵌，露一半）
        cube('brow' + sd, 0.075, 0.045, 0.040, (s * 0.062, 0.185, 0.885), rot=(0, 0, s * -0.35))
        # 眼：暗窝 + 石珠 + 暗仁，三层叠在实测表面上
        ex, ez = s * 0.058, 0.845
        es = surf_y(ex, ez)
        sphD('socket' + sd, 0.042, 0.025, 0.036, (ex, es + 0.008, ez), seg=8, ring=6)
        sph('eyeball' + sd, 0.026, 0.022, 0.026, (ex, es + 0.020, ez), seg=8, ring=6)
        sphD('pupil' + sd, 0.012, 0.010, 0.013, (ex, es + 0.038, ez), seg=6, ring=5)
        # 耳：小而后贴
        sph('ear' + sd, 0.042, 0.032, 0.048, (s * 0.105, 0.030, 0.930), seg=8, ring=6)
    # 鼻：宽鼻梁 + 大鼻头 + 大鼻孔（全按表面放）
    ns = surf_y(0, 0.815)
    sph('noseBridge', 0.045, 0.035, 0.050, (0, ns + 0.010, 0.815), seg=8, ring=6)
    ps = surf_y(0, 0.800)
    sphD('nosePad', 0.055, 0.025, 0.030, (0, ps + 0.008, 0.800), seg=8, ring=6)
    for s in (1, -1):
        gs = surf_y(s * 0.028, 0.795)
        sphD('nostril' + ('R' if s > 0 else 'L'), 0.018, 0.015, 0.016,
             (s * 0.028, gs + 0.005, 0.795), seg=6, ring=5)
    # 口：张开的暗腔贴在表面 + 上牙4 + 獠牙2 + 下牙4（牙长在嘴皮前面，不是嘴皮里面）
    ms = surf_y(0, 0.735)
    my, mz = ms + 0.007, 0.735
    cube('mouthCav', 0.110, 0.045, 0.055, (0, my, mz), dark=True)
    topEdge, botEdge = mz + 0.0275, mz - 0.0275
    ty = my + 0.026   # 牙中心 y：嘴皮前脸 (my+0.0225) 之外 3mm，根部埋进嘴里
    for i, x in enumerate((-0.042, -0.014, 0.014, 0.042)):
        cone('toothU%d' % i, 0.010, 0.028, (x, ty, topEdge - 0.008), flip=True, seg=6)
    for s in (1, -1):
        cone('fang' + ('R' if s > 0 else 'L'), 0.013, 0.045, (s * 0.062, ty, topEdge - 0.014), flip=True, seg=6)
    for i, x in enumerate((-0.036, -0.012, 0.012, 0.036)):
        cone('toothD%d' % i, 0.009, 0.022, (x, ty, botEdge + 0.006), flip=False, seg=6)
    # 鬃：顶/腮/肩三区（tabbit 螺旋的低模版：密而大，盖住脖子才威猛）
    R0 = 0.150
    rows = [(28, 7, 0.040), (52, 9, 0.042), (76, 11, 0.042), (100, 11, 0.040),
            (124, 9, 0.038), (148, 7, 0.036)]
    for ri, (theta, n, curl) in enumerate(rows):
        th = math.radians(theta)
        rad = R0 * math.sin(th)
        yy = FH[1] + R0 * math.cos(th) * 1.0
        for i in range(n):
            a = i / n * math.pi * 2 + ri * 0.35
            dz = math.sin(a) * rad
            dx = math.cos(a) * rad
            dy = yy - FH[1]
            # 脸部净空（v7 首版实测：鬃会把眼埋掉）：以前向为轴 60° 锥内不摆 + 颌下正中留嘴区
            horiz = math.hypot(dx, dz)
            if dy > 0 and horiz < dy * 1.732:
                continue
            if -0.06 <= dy <= 0 and horiz < 0.10:
                continue
            sph('mane%d_%d' % (ri, i), curl, curl, curl, (dx, yy, FH[2] + dz), seg=8, ring=6)
    # 肩 cape：脖子根部水平围一圈（正前方下巴处留空）
    for i in range(10):
        a = i / 10 * math.pi * 2
        if math.sin(a) > 0.45:
            continue
        sph('cape%d' % i, 0.045, 0.045, 0.045,
            (math.cos(a) * 0.155, 0.06 + math.sin(a) * 0.155, Z0 + 0.38), seg=8, ring=6)
    # 项圈 + 铃铛
    torus('collar', 0.135, 0.022, (0, 0.075, Z0 + 0.40), rot=(math.pi / 2 - 0.35, 0, 0))
    sph('bell', 0.034, 0.034, 0.038, (0, 0.150, Z0 + 0.325), seg=8, ring=6)

def add_ball():
    """雄狮：右前爪踩绣球"""
    bx, by, bz = 0.155, 0.200, Z0 + 0.075
    sph('ball', 0.078, 0.078, 0.078, (bx, by, bz), seg=14, ring=10)
    for a in (0.55, -0.55):
        torus('ballBand%+.2f' % a, 0.078, 0.013, (bx, by, bz), rot=(0, math.pi / 2, a), mseg=18, nseg=6)
    sph('ballKnot', 0.024, 0.024, 0.024, (bx, by, bz + 0.080), seg=8, ring=6)

def add_cub():
    """雌狮：左前爪抚幼狮"""
    cx, cy, cz = -0.155, 0.200, Z0 + 0.085
    sph('cubBody', 0.078, 0.095, 0.058, (cx, cy, cz), seg=12, ring=8, rot=(math.radians(72), 0, 0))
    sph('cubHead', 0.050, 0.050, 0.047, (cx - 0.024, cy + 0.070, cz + 0.024), seg=10, ring=7)
    for s in (1, -1):
        sph('cubEar%+d' % s, 0.021, 0.016, 0.022, (cx - 0.024 + s * 0.042, cy + 0.076, cz + 0.062), seg=6, ring=5)
        sph('cubPawA%+d' % s, 0.024, 0.024, 0.022, (cx + s * 0.046, cy + 0.024, cz + 0.078), seg=6, ring=5)
        sph('cubPawB%+d' % s, 0.024, 0.024, 0.022, (cx + s * 0.050, cy - 0.042, cz + 0.074), seg=6, ring=5)
    for i in range(6):
        a = i / 6 * math.pi * 2
        sph('cubCurl%d' % i, 0.024, 0.024, 0.024,
            (cx - 0.024 + math.cos(a) * 0.050, cy + 0.056, cz + 0.024 + math.sin(a) * 0.050), seg=6, ring=5)

def join_list(lst, newname):
    act(lst[0])
    for o in lst:
        o.select_set(True)
    bpy.context.view_layer.objects.active = lst[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = newname
    return o

def finalize(name, glb):
    lion = join_list(parts, 'stoneLion_' + name)
    dark = join_list(darkParts, 'stoneLion_' + name + '_dark')
    me = lion.data
    col = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    for i, v in enumerate(me.vertices):
        p = v.co
        n = noise.noise(Vector((p.x * 9.0, p.y * 9.0, p.z * 9.0)))
        t = 0.88 + 0.12 * (n * 0.5 + 0.5)
        col.data[i].color = (t, t * 0.995, t * 0.972, 1.0)
    mat = bpy.data.materials.new('lion_stone')
    mat.use_nodes = True
    bsdf = next((x for x in mat.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
    assert bsdf is not None
    nt = mat.node_tree
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'Col'; attr.attribute_type = 'GEOMETRY'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    mix.inputs['A'].default_value = (0.700, 0.690, 0.660, 1.0)   # 青灰（tabbit 那种偏青的调子）
    nt.links.new(attr.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.90
    if 'Metallic' in bsdf.inputs: bsdf.inputs['Metallic'].default_value = 0.0
    me.materials.clear(); me.materials.append(mat)
    dmat = bpy.data.materials.new('lion_dark')
    dmat.use_nodes = True
    dbsdf = next((x for x in dmat.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
    dbsdf.inputs['Base Color'].default_value = (0.200, 0.185, 0.170, 1.0)
    dbsdf.inputs['Roughness'].default_value = 0.95
    if 'Metallic' in dbsdf.inputs: dbsdf.inputs['Metallic'].default_value = 0.0
    dark.data.materials.clear(); dark.data.materials.append(dmat)
    for o in (lion, dark):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth()
    me.calc_loop_triangles()
    dark.data.calc_loop_triangles()
    zs = [v.co.z for v in me.vertices] + [v.co.z for v in dark.data.vertices]
    print('VARIANT=%s TRIS=%d+%d Z=[%.3f,%.3f]' % (name, len(me.loop_triangles),
          len(dark.data.loop_triangles), min(zs), max(zs)))
    keep = {lion.name, dark.name}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.materials):
        if m.name not in ('lion_stone', 'lion_dark'):
            m.use_fake_user = False
            bpy.data.materials.remove(m, do_unlink=True)
    assert len(bpy.data.objects) == 2 and len(bpy.data.materials) == 2, '清场失败'
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=True, export_yup=True,
                               export_draco_mesh_compression_enable=False, export_materials='EXPORT',
                               export_cameras=False, export_lights=False, use_selection=False)
    print('GLB=%s BYTES=%d' % (os.path.basename(glb), os.path.getsize(glb)))

for variant in ('male', 'female'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = []
    darkParts = []
    build_pedestal()
    build_body()
    build_face()
    if variant == 'male': add_ball()
    else: add_cub()
    finalize(variant, os.path.join(OUT_DIR, 'stone-lion-' + variant + '.glb'))
