# 石狮资产构建（2026-10-18）
# 输入：photoscan-lion.glb（BlenderKit「Weathered Stone Lion Statue - Photoscan」，CC0/BlenderKit 许可）
# 输出：out/stone-lion-male.glb（公，踩绣球）、out/stone-lion-female.glb（母，镜像 + 去绣球 + 补幼狮）
#
# 坐标系：Blender Z-up，脸朝 −Y（导入后的实测：front 相机在 −Y 侧拍到正脸）。
# 归一化与 06e-assets.loadAssetOnce 一致：最大边 = 1.08m、水平居中、底部 z=0。
# （导出到 glTF 后 Blender −Y → +Z ⇒ 在 three.js 里脸朝 +z，holder.rotation.y = 0，
#   与旧 v7 资产（脸朝 −z、rotation.y=π）相反 —— 接线时要一起改。）
#
# 绣球识别：112 个连通分量里唯一一个"前右、低、近球形"的就是绣球（实测包围盒
#   x 0.083..0.253 / y −0.358..−0.202 / z 0.371..0.598，935 顶点）。
#   射线反投影（locate_ball.py）与分量包围盒互相印证。
#
# 母狮：镜像 X（去掉绣球、翻转面朝向）+ 同一扫描体的**幼狮**（切掉须弥座、缩到
#   0.148m 高）塞回原绣球位置 —— 原爪踩球的姿态正好变成"爪抚幼狮头顶"。
#
# 运行：blender -b --python research/diy-lions/photoscan/build_lions.py
import bpy, bmesh, os, math
from mathutils import Vector, Matrix

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'photoscan-lion.glb')
OUT = os.path.join(BASE, 'out')
os.makedirs(OUT, exist_ok=True)

MALE_TRIS = 15000
FEMALE_TRIS = 12000
CUB_TRIS = 4500


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_normalized():
    bpy.ops.import_scene.gltf(filepath=SRC)
    obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    s = 1.08 / max(obj.dimensions)
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for c in obj.bound_box:
        p = obj.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    obj.location.x -= (mn.x + mx.x) / 2
    obj.location.y -= (mn.y + mx.y) / 2
    obj.location.z -= mn.z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    bpy.context.view_layer.update()
    # 只留材质真正使用的那张 UV（贴图走 UV1；留两张会让 GLB 多一份 8B/顶点）
    used = set()
    for m in obj.data.materials:
        for n in m.node_tree.nodes:
            if n.type == 'UVMAP':
                used.add(n.uv_map)
    print('UV_LAYERS', [u.name for u in obj.data.uv_layers], 'MATERIAL_USES', used)
    for u in list(obj.data.uv_layers):
        if u.name not in used and len(obj.data.uv_layers) > 1:
            obj.data.uv_layers.remove(u)
    print('UV_KEPT', [u.name for u in obj.data.uv_layers])
    return obj


def islands(obj, min_n=20):
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    seen = set(); out = []
    for v in bm.verts:
        if v.index in seen: continue
        stack = [v]; seen.add(v.index); comp = []
        while stack:
            u = stack.pop(); comp.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index); stack.append(w)
        if len(comp) >= min_n:
            co = [x.co for x in comp]
            mn = Vector((min(p.x for p in co), min(p.y for p in co), min(p.z for p in co)))
            mx = Vector((max(p.x for p in co), max(p.y for p in co), max(p.z for p in co)))
            out.append({'verts': [x.index for x in comp], 'n': len(comp),
                        'c': (mn + mx) / 2, 'size': mx - mn, 'min': mn, 'max': mx})
    bm.free()
    return out


def delete_islands(obj, pick, verbose=False):
    """pick(dict) -> True 则删掉整个连通分量"""
    isl = islands(obj)
    kill = set()
    for d in isl:
        if pick(d):
            kill.update(d['verts'])
            if verbose:
                print('  KILL n=%d c=(%.3f,%.3f,%.3f) size=(%.3f,%.3f,%.3f)' % (
                    d['n'], d['c'].x, d['c'].y, d['c'].z,
                    d['size'].x, d['size'].y, d['size'].z))
    if not kill:
        print('DELETE_ISLANDS none'); return 0
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context='VERTS')
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    print('DELETE_ISLANDS', len(kill), 'verts')
    return len(kill)


def fill_hole_near(obj, center, radius):
    """把"摘掉绣球后留下的边界环"补面，并用边界顶点自带的 UV 做插值。
    扫描体在球与台面咬合处是**长在一起**的：删球必然沿咬合线撕开一个洞，
    洞里是背面（双面材质会把内壁照出来，看起来像一块黑褐色破口）。
    这里用 bmesh.holes_fill 只补这一圈边界，UV 取边界顶点自己的 UV ⇒ 补片与四周
    石材连续，不会出现一块纯色补丁。"""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    be = [e for e in bm.edges if len(e.link_faces) == 1
          and all((v.co - center).length < radius for v in e.verts)]
    print('FILL_HOLE boundary_edges', len(be))
    if not be:
        bm.free(); return 0
    uv_layer = bm.loops.layers.uv.active
    buv = {}
    for e in be:
        for f in e.link_faces:
            for l in f.loops:
                if l.vert in [v for v in e.verts] and l.vert not in buv:
                    buv[l.vert] = tuple(l[uv_layer].uv)
    res = bmesh.ops.holes_fill(bm, edges=be, sides=0)
    new_faces = res.get('faces', [])
    for f in new_faces:
        for l in f.loops:
            l[uv_layer].uv = buv.get(l.vert, (0.5, 0.5))
    bmesh.ops.recalc_face_normals(bm, faces=new_faces)
    bm.normal_update()
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    print('FILL_HOLE faces', len(new_faces))
    return len(new_faces)


def squash_island_z(obj, center, radius, z_base, k):
    """把球心附近整个连通分量的 Z 向压扁（保住 X/Y 轮廓，做成低矮底座）。"""
    isl = islands(obj)
    pick = [d for d in isl if (d['c'] - center).length < radius and d['n'] > 400]
    assert len(pick) == 1, ['squash islands', [(d['n'], tuple(d['c'])) for d in pick]]
    ids = set(pick[0]['verts'])
    me = obj.data
    for v in me.vertices:
        if v.index in ids:
            v.co.z = z_base + (v.co.z - z_base) * k
    me.update()
    print('SQUASH', pick[0]['n'], 'verts k=', k)


def find_platform_uv(obj):
    """在须弥座顶面找一块面，取它的 UV 均值 —— 补底座的贴图坐标。"""
    me = obj.data
    uv = me.uv_layers.active.data
    for p in me.polygons:
        c = p.center
        if 0.44 < c.z < 0.48 and abs(c.x) < 0.12 and -0.10 < c.y < 0.16:
            u = v = 0.0
            for li in p.loop_indices:
                u += uv[li].uv.x; v += uv[li].uv.y
            return (u / p.loop_total, v / p.loop_total)
    return (0.5, 0.5)


def add_disc(obj, loc, radius, depth, uv):
    """补一块素石底座（圆柱），共用扫描体的材质与 UV1。"""
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=radius, depth=depth, location=loc)
    disc = bpy.context.active_object
    disc.name = 'BallSocket'
    uv_name = obj.data.uv_layers.active.name
    dl = disc.data.uv_layers.new(name=uv_name)
    for d in dl.data:
        d.uv = uv
    disc.data.materials.append(obj.data.materials[0])
    return disc


def delete_below_z(obj, z):
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    kill = [v for v in bm.verts if v.co.z < z]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    print('DELETE_BELOW_Z', z, len(kill))
    return len(kill)


def mirror_x(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.transform(bm, matrix=Matrix.Scale(-1.0, 4, (1.0, 0.0, 0.0)), verts=bm.verts[:])
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.to_mesh(obj.data); bm.free(); obj.data.update()


def decimate(obj, target_tris):
    cur = len(obj.data.polygons)
    if cur <= target_tris:
        print('DECIMATE skip', cur); return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    md = obj.modifiers.new('dec', 'DECIMATE')
    md.decimate_type = 'COLLAPSE'
    md.ratio = target_tris / cur
    md.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=md.name)
    print('DECIMATE', cur, '->', len(obj.data.polygons))


def bottom_center_origin(obj):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for c in obj.bound_box:
        p = obj.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    me = obj.data
    for v in me.vertices:
        v.co -= off
    me.update()
    return off


def dup(src, name):
    o = src.copy(); o.data = src.data.copy(); o.name = name
    bpy.context.scene.collection.objects.link(o)
    return o


def export(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    ops = bpy.ops.export_scene.gltf
    kw = dict(filepath=path, export_format='GLB', use_selection=True,
              export_apply=True, export_yup=True,
              export_image_format='WEBP', export_image_quality=88,
              export_draco_mesh_compression_enable=False,
              export_normals=True, export_texcoords=True, export_tangents=False,
              export_materials='EXPORT', export_animations=False)
    # 不同 Blender 小版本参数名有出入：失败就去掉 image_quality 再试
    try:
        ops(**kw)
    except TypeError as e:
        print('EXPORT retry without some kwargs:', e)
        kw.pop('export_image_quality', None)
        ops(**kw)
    print('EXPORTED', path, os.path.getsize(path))


# ── 公狮 ────────────────────────────────────────────────────────────────
fresh()
male = load_normalized()
decimate(male, MALE_TRIS)
male.name = 'LionMale'
export(male, os.path.join(OUT, 'stone-lion-male.glb'))

# ── 母狮 ────────────────────────────────────────────────────────────────
fresh()
female = load_normalized()
# 绣球：**保留原样**。扫描体在球与须弥座咬合处长在一起，任何一种"摘球"都会
# 沿咬合线撕开台面（试过三种：整岛删 → 台面一个拳头大的洞；只删球顶 → 球壳开口
# 露出背面像破布；圆柱补洞 → 补块比台面还高、像一块灰砖）。母狮改为"带着绣球、
# 胸前伏幼狮"的构图：球留给幼狮玩，不是母狮的标记，但在 1m 高的门口石雕上
# 远看只读到"一对狮子 + 一只小狮"，比任何破面都稳。
BALL_C = Vector((0.168, -0.280, 0.485))
mirror_x(female)

# 幼狮：同一扫描体，切掉须弥座（平台顶 z≈0.45），缩到"头顶正好顶到母狮抬起的前爪"，
# 放回原绣球位置。爪的分量实测（归一化）：x 0.035..0.217 / y −0.279..−0.049 / z 0.598..0.831，
# 镜像后 x −0.217..−0.035 ⇒ 幼狮中心取 (−0.126, −0.20)，脚底 0.43（略埋进台面）。
cub = dup(female, 'LionCub')
delete_below_z(cub, 0.445)
off = bottom_center_origin(cub)
# 切完后幼狮（去掉须弥座的狮身）高度
mnz = 1e9; mxz = -1e9
for v in cub.data.vertices:
    mnz = min(mnz, v.co.z); mxz = max(mxz, v.co.z)
print('CUB_BODY_Z', mnz, mxz)
k = 0.200 / (mxz - mnz)
cub.scale = (k, k, k)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# 放在**两只前爪之间、靠前缘**（平台顶实测 z≈0.437~0.45）：正面一眼能看到整只小狮，
# 不会被母狮的下巴/胸前挡住。x=0 是两爪之间那道缝，y=−0.26 贴近台面前缘。
cub.location = (0.0, -0.260, 0.450)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
decimate(cub, CUB_TRIS)

# 合并母狮 + 幼狮
for o in bpy.context.scene.objects:
    o.select_set(False)
female.select_set(True); cub.select_set(True)
bpy.context.view_layer.objects.active = female
bpy.ops.object.join()
female.name = 'LionFemale'
decimate(female, FEMALE_TRIS)
export(female, os.path.join(OUT, 'stone-lion-female.glb'))
print('DONE')
