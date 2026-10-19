# Tinker 马：从源 GLB 转出**无 Draco** 的网页版（2026-10-19）
# 为什么要转：DRACOLoader 在门禁/离线环境里会拉 gstatic 的 wasm，probe 里报
# "Failed to parse URL from draco_decoder.wasm"（4 条 pageerror + 16 条 console.error）。
# 项目既有资产全部无 Draco；这里同样导出无压缩 GLB，保留骨骼/蒙皮/贴图。
#
# 运行：blender -b --python research/diy-horses/export_web.py
import bpy, os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'tinker-raw.glb')
OUT = os.path.join(BASE, 'tinker-web.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# 粒子毛发的占位球（2m、无材质、42 顶点）不导出
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o.name == 'Icosphere':
        bpy.data.objects.remove(o, do_unlink=True)

print('--- images ---')
for im in bpy.data.images:
    print('IMG', im.name, im.size[:], im.file_format, 'packed=', bool(im.packed_file))

# 只选网格 + 骨架
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type in ('MESH', 'ARMATURE'):
        o.select_set(True)
        if o.type == 'ARMATURE':
            bpy.context.view_layer.objects.active = o

kw = dict(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_apply=False, export_yup=True,
    export_skins=True, export_animations=False,
    export_draco_mesh_compression_enable=False,
    export_normals=True, export_texcoords=True, export_tangents=False,
    export_materials='EXPORT', export_image_format='WEBP', export_image_quality=90,
)
try:
    bpy.ops.export_scene.gltf(**kw)
except TypeError as e:
    print('retry without quality:', e)
    kw.pop('export_image_quality', None)
    bpy.ops.export_scene.gltf(**kw)
print('EXPORTED', OUT, os.path.getsize(OUT))
