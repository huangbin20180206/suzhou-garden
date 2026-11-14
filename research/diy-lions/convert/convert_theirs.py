# 转制：用户提供的 chinese_guardian_lions_highdetail_blender52.py 产物 → 网页可用 GLB
# 做法：把原脚本的 .blend 打开，曲线全部转网格 → 按材质合并成 2 个网格（石身/深色件）
#       → 统一缩到高 1.01m（与 v7 一致）→ 单 Principled 石材质 → 导 GLB。
# 隔离目录输出，不碰 assets/ 与 src/。
import bpy, os
from mathutils import Vector

SRC = r'C:\Users\huang\Chinese_Guardian_Lions_HighDetail.blend'
OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=SRC)

n_curve_before = len([o for o in bpy.data.objects if o.type == 'CURVE'])
n_mesh_before = len([o for o in bpy.data.objects if o.type == 'MESH'])

# 1) 曲线 → 网格（线框式的鬃毛漩涡、嘴线、爪缝全靠它）
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type == 'CURVE':
        o.select_set(True)
if bpy.context.selected_objects:
    bpy.ops.object.convert(target='MESH')

# 2) 清场：只留公母两只狮子的部件（去掉 Studio_Ground / 灯 / 相机）
KEEP_PREFIX = ('Male_Lion', 'Female_Lion')
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    if not o.name.startswith(KEEP_PREFIX):
        bpy.data.objects.remove(o, do_unlink=True)

# 3) 按"深色件 vs 石身"分两组（RECESS 材质=深色雕件）
DEEP = set()
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.materials:
        nm = o.data.materials[0].name
        if 'Deep carved recess' in nm:
            DEEP.add(o.name)

def group(prefix):
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(prefix)]

for prefix, tag in (('Male_Lion', 'male'), ('Female_Lion', 'female')):
    objs = group(prefix)
    body = [o for o in objs if o.name not in DEEP]
    deep = [o for o in objs if o.name in DEEP]
    print('%s: 总 %d 件（石身 %d / 深色 %d）' % (tag, len(objs), len(body), len(deep)))

    # 先统一应用各件的既有变换（原脚本已 transform_apply 过，这里是双保险）
    for o in objs:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # 深色件并到石身上（同一个对象、两个材质槽）—— 一次 join，不分组合并，
    # 否则原脚本"一个材质拆几十个对象"的结构会在分组时轴心错位、零件飞散
    def merge_keep(objs, name):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        m = bpy.context.active_object
        m.name = name
        return m

    bodyM = merge_keep(body, tag + '_body')
    deepM = merge_keep(deep, tag + '_deep') if deep else None

    # 温和青灰石 + 深一档的雕件色（比 v7 的凶脸柔和得多）
    def stone_mat(name, color, rough):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = rough
        return mat

    mBody = stone_mat('lion_body_%s' % tag, (0.40, 0.42, 0.40), 0.90)
    mDeep = stone_mat('lion_deep_%s' % tag, (0.24, 0.25, 0.24), 0.94)

    # 压面
    for m, ratio in ((bodyM, 0.06), (deepM, 0.35)):
        if m is None:
            continue
        d = m.modifiers.new('dec', 'DECIMATE')
        d.ratio = ratio
        d.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.modifier_apply(modifier='dec')

    # 整体测量（两个对象一起算），再统一缩放 + 落地
    allM = [x for x in (bodyM, deepM) if x]
    zmax = max((m.matrix_world @ Vector(c)).z for m in allM for c in m.bound_box)
    zmin = min((m.matrix_world @ Vector(c)).z for m in allM for c in m.bound_box)
    s = 1.01 / (zmax - zmin)
    for m in allM:
        m.scale = (s, s, s)
        bpy.ops.object.select_all(action='DESELECT')
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        m.location.z -= zmin * s
        # transform_apply 会把 location 一起清掉 ⇒ 落地偏移必须写在应用之后
        bpy.ops.object.select_all(action='DESELECT')
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        bpy.ops.object.select_all(action='DESELECT')

    # 石身挂槽 0、深色件挂槽 1，然后合成一个对象
    bodyM.data.materials.append(mBody)
    if deepM:
        deepM.data.materials.append(mDeep)
    bpy.ops.object.select_all(action='DESELECT')
    for m in allM:
        m.select_set(True)
    bpy.context.view_layer.objects.active = allM[0]
    bpy.ops.object.join()
    lion = bpy.context.active_object
    lion.name = 'stoneLion_' + tag
    lion.data.materials.clear()
    lion.data.materials.append(mBody)
    lion.data.materials.append(mDeep)
    for p in lion.data.polygons:
        p.use_smooth = True
    lion.data.calc_loop_triangles()
    zs = [(lion.matrix_world @ v.co).z for v in lion.data.vertices]
    print('%s: TRIS=%d Z=[%.3f, %.3f] 面数范围=[%d,%d]' % (
        tag, len(lion.data.loop_triangles), min(zs), max(zs),
        min(len(o.data.vertices) for o in [lion]), len(lion.data.vertices)))

# 7) 逐个导出
for tag in ('male', 'female'):
    lion = bpy.data.objects['stoneLion_' + tag]
    bpy.ops.object.select_all(action='DESELECT')
    lion.select_set(True)
    bpy.context.view_layer.objects.active = lion
    p = os.path.join(OUT, 'lion-%s.glb' % tag)
    bpy.ops.export_scene.gltf(
        filepath=p, export_format='GLB', use_selection=True, export_apply=True,
        export_materials='EXPORT', export_yup=True,
        export_draco_mesh_compression_enable=False,
        export_cameras=False, export_lights=False)
    print('GLB_OK %s %d' % (tag, os.path.getsize(p)))

print('DONE')
