# Tinker 马导入与默认姿态渲染（2026-10-19）
# 看默认是 T-pose 还是已经站着。
import bpy, os, math
from mathutils import Vector

BASE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(BASE, 'tinker-raw.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH' or o.type == 'ARMATURE']
print('OBJECTS', [(o.name, o.type) for o in objs])
armature = next((o for o in objs if o.type == 'ARMATURE'), None)
mesh_objs = [o for o in objs if o.type == 'MESH']
print('ARMATURE', armature.name if armature else None)
print('MESHES', [o.name for o in mesh_objs])

# 归一化：让最高点对齐 z=0、x/y 居中
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in mesh_objs:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
print('BBOX', tuple(round(v,3) for v in mn), tuple(round(v,3) for v in mx))
for o in mesh_objs:
    o.location.x -= (mn.x + mx.x) / 2
    o.location.y -= (mn.y + mx.y) / 2
    o.location.z -= mn.z
if armature:
    armature.location.x -= (mn.x + mx.x) / 2
    armature.location.y -= (mn.y + mx.y) / 2
    armature.location.z -= mn.z
bpy.context.view_layer.update()

# 地面
bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, -0.001))
ground = bpy.context.active_object
mat = bpy.data.materials.new('ground'); mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Base Color'].default_value = (0.22, 0.30, 0.18, 1)
bsdf.inputs['Roughness'].default_value = 0.95
ground.data.materials.append(mat)
# 光
for n, loc, e in [('key', (3, -3, 4), 600), ('fill', (-3, -1, 2), 200), ('rim', (0, 4, 3), 300)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    L = bpy.context.active_object
    L.data.energy = e; L.data.size = 2.5
# 相机
cd = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cd)
bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cd.lens = 50
cam.location = Vector((0, -3.5, 1.4))
d = Vector((0, 0, 1.0)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
bpy.context.view_layer.update()

bpy.context.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1024
bpy.context.scene.render.resolution_y = 768
bpy.context.scene.render.film_transparent = True
bpy.context.scene.world = bpy.data.worlds.new('W') if bpy.context.scene.world is None else bpy.context.scene.world
bpy.context.scene.world.color = (0.05, 0.05, 0.05)
bpy.context.scene.render.filepath = os.path.join(BASE, 'tinker-default.png')
bpy.ops.render.render(write_still=True)
print('RENDERED default')
