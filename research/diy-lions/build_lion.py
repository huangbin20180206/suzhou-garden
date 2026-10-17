# stone-lion v3（Blender 5.2）：**融球**先合成整体石雕形体，再补鬃髻/耳/项圈/尾
# 为什么改用融球：v1/v2 用基本体堆出来的狮身一眼是"几个球拼的"（评审：玩具感），
#   而石雕的价值恰恰在**浑然一体的凿刻表面**。融球（metaball）会把相邻元素熔成一个连续面，
#   转成网格后即是"一整块石头凿出来的"形体；再叠低模鬃髻与配饰即可。
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector, noise, Euler

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(OUT_DIR, 'stone-lion.glb')

# ── 尺寸配比（总高 ~1.12m）──
H1, H2, HLIP = 0.100, 0.090, 0.030
ZB1, ZB2, ZLIP = H1, H1 + H2, H1 + H2 + HLIP
parts = []

def act(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    return o

def apply_all(o):
    act(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o

def cube(name, sx, sy, sz, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx, sy, sz); o.rotation_euler = rot
    parts.append(apply_all(o)); return o

def sph(name, rx, ry, rz, loc, seg=12, ring=8, rot=(0, 0, 0)):
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

# ── 须弥座 ──
cube('lionBase1', 0.720, 0.720, H1, (0, 0, ZB1 / 2))
cube('lionBase2', 0.600, 0.600, H2, (0, 0, ZB1 + H2 / 2))
cube('lionBaseLip', 0.660, 0.660, HLIP, (0, 0, ZB2 + HLIP / 2))

# ── ① 融球合成躯干与头（朝 +Y）──
mb = bpy.data.metaballs.new('lionBody')
mb.resolution = 0.022
mb.render_resolution = 0.022
mbo = bpy.data.objects.new('lionBody', mb)
bpy.context.collection.objects.link(mbo)

def ell(co, size, stiff=2.0, rot=(0, 0, 0)):
    e = mb.elements.new(type='ELLIPSOID')
    e.co = Vector(co); e.size_x, e.size_y, e.size_z = size
    e.stiffness = stiff
    e.rotation = Euler(rot).to_quaternion()      # ⚠️ metaball 元素的 rotation 是**四元数**（4 分量），给 3 元组会报 dimension 错
    return e

Z = ZB2 + 0.02
# 后胯（低、宽、厚）
ell((0, -0.110, Z + 0.235), (0.115, 0.150, 0.140))
# 背腰
ell((0,  0.010, Z + 0.330), (0.108, 0.145, 0.125))
# 前胸（高、鼓）
ell((0,  0.130, Z + 0.380), (0.115, 0.120, 0.130))
# 颈（把胸与头接起来，别让头悬着）
ell((0,  0.165, Z + 0.520), (0.085, 0.090, 0.095))
# 头（方而大 —— 石狮的头占比本来就大）
ell((0,  0.190, Z + 0.680), (0.125, 0.115, 0.115))
# 吻（短、宽）
ell((0,  0.300, Z + 0.640), (0.078, 0.070, 0.062))
# 下颌
ell((0,  0.285, Z + 0.585), (0.070, 0.055, 0.045))
# 前腿 ×2（细长椭球 ⇒ 与身熔成"前肢"）
for s in (1, -1):
    ell((s * 0.115, 0.225, Z + 0.225), (0.055, 0.055, 0.115))
    ell((s * 0.120, 0.250, Z + 0.055), (0.075, 0.090, 0.040))   # 前爪
    ell((s * 0.185, -0.070, Z + 0.050), (0.070, 0.085, 0.038))  # 后爪
act(mbo)
bpy.ops.object.convert(target='MESH')
body = bpy.context.active_object
body.name = 'lionBodyMesh'
# 融球网格偏密 ⇒ 轻量简化（保持形体、砍面数）
dec = body.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.42
act(body); bpy.ops.object.modifier_apply(modifier='dec')
body.data.calc_loop_triangles()
print('BODY_TRIS=%d' % len(body.data.loop_triangles))
parts.append(body)

# ── ② 螺髻鬃毛：**罩住头后半球的兜状**（不是一圈立着的环）──
# ⚠️ v3 首版把三圈球摆在同一个垂直于朝向的平面上 ⇒ 出图是一面"立着的光环/向日葵"。
#    真石狮的鬃毛是**从面颊往后包成兜**的 ⇒ 球要布在**以头心为心的球面上**：
#    θ = 与朝向(+Y)的夹角，55°~150° 分四排、每排沿方位角一圈，半径随 θ 收（包成锥兜）。
HY, HZ = 0.190, Z + 0.680
R0 = 0.168
for ri, (theta, n, curl) in enumerate([(52, 12, 0.052), (86, 12, 0.050), (120, 10, 0.046), (148, 8, 0.042)]):
    th = math.radians(theta)
    rad = R0 * math.sin(th)                 # 该排绕头轴的半径
    yy = HY + R0 * math.cos(th) * 1.06      # 略往前推一点，让鬃毛包住脸侧
    for i in range(n):
        a = i / n * math.pi * 2 + ri * 0.28
        sph('lionCurl%d_%d' % (ri, i), curl, curl, curl,
            (math.cos(a) * rad, yy, HZ + math.sin(a) * rad), seg=8, ring=6)
# 腮帮/须（脸两侧的一对小球，把"兜"和脸接住）
for s in (1, -1):
    sph('lionCheek' + ('R' if s > 0 else 'L'), 0.062, 0.058, 0.062,
        (s * 0.135, HY + 0.055, HZ - 0.055), seg=8, ring=6)
# ── ③ 耳 / 眼 / 项圈 / 铃铛 / 卷尾 ──
for s in (1, -1):
    sd = 'R' if s > 0 else 'L'
    sph('lionEar' + sd, 0.052, 0.036, 0.058, (s * 0.118, 0.130, HZ + 0.105), seg=8, ring=6)
    sph('lionEye' + sd, 0.033, 0.026, 0.031, (s * 0.076, HY + 0.075, HZ + 0.028), seg=8, ring=6)
torus('lionCollar', 0.176, 0.026, (0, HY - 0.030, HZ - 0.165), rot=(math.pi / 2 - 0.42, 0, 0))
sph('lionBell', 0.042, 0.042, 0.046, (0, HY + 0.150, HZ - 0.225), seg=8, ring=6)
cube('lionTail1', 0.085, 0.140, 0.195, (0, -0.300, Z + 0.105), rot=(math.radians(-16), 0, 0))
cube('lionTail2', 0.075, 0.120, 0.160, (0, -0.325, Z + 0.250), rot=(math.radians(-6), 0, 0))
sph('lionTailTip', 0.062, 0.066, 0.058, (0, -0.318, Z + 0.355), seg=8, ring=6)

# ── 合并 + 顶点色 ──
act(body)
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
lion = bpy.context.active_object
lion.name = 'stoneLion'
me = lion.data
col = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
for i, v in enumerate(me.vertices):
    p = v.co
    n = noise.noise(Vector((p.x * 9.0, p.y * 9.0, p.z * 9.0)))
    tt = 0.90 + 0.10 * (n * 0.5 + 0.5)
    col.data[i].color = (tt, tt * 0.995, tt * 0.975, 1.0)
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
xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
print('TOTAL_TRIS=%d' % len(me.loop_triangles))
print('BBOX_LWH=%.4f,%.4f,%.4f' % (max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)))
print('BBOX_Z=[%.4f,%.4f]' % (min(zs), max(zs)))
for o in list(bpy.data.objects):
    if o.name != 'stoneLion':
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.materials):
    if m.name != 'lion_stone':
        m.use_fake_user = False
        bpy.data.materials.remove(m, do_unlink=True)
print('SCENE_OBJECTS=%d:%s' % (len(bpy.data.objects), ','.join(o.name for o in bpy.data.objects)))
print('SCENE_MATERIALS=%d:%s' % (len(bpy.data.materials), ','.join(m.name for m in bpy.data.materials)))
assert len(bpy.data.objects) == 1 and len(bpy.data.materials) == 1
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', export_apply=True, export_yup=True,
                          export_draco_mesh_compression_enable=False, export_materials='EXPORT',
                          export_cameras=False, export_lights=False, use_selection=False)
print('GLB_BYTES=' + str(os.path.getsize(GLB)))
