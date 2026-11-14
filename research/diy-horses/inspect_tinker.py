# Tinker 马体检（2026-10-19）：为什么上次只渲染出眼睛？
import bpy, os
from mathutils import Vector

BASE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(BASE, 'tinker-raw.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

print('--- objects ---')
for o in bpy.context.scene.objects:
    if o.type not in ('MESH', 'ARMATURE'):
        continue
    info = f'{o.name:24s} {o.type:9s} hide_render={o.hide_render} hide_viewport={o.hide_viewport} scale={tuple(round(v,3) for v in o.scale)} dims={tuple(round(v,3) for v in o.dimensions)}'
    if o.type == 'MESH':
        info += f' verts={len(o.data.vertices)} mods={[m.type for m in o.modifiers]} mats={[m.name for m in o.data.materials]}'
        for m in o.data.materials:
            if m and m.use_nodes:
                bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if bsdf:
                    a = bsdf.inputs['Alpha'].default_value
                    info += f' | {m.name}: alpha={a:.3f} blend={m.blend_method}'
    print(info)

# 包围盒（世界）
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            for i in range(3): mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
print('WORLD_BBOX', tuple(round(v,3) for v in mn), tuple(round(v,3) for v in mx))

# 用素色材质覆盖渲染（验证几何/蒙皮是否正常）
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
gray = bpy.data.materials.new('gray'); gray.use_nodes = True
b = next(n for n in gray.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
b.inputs['Base Color'].default_value = (0.45, 0.42, 0.38, 1)
b.inputs['Roughness'].default_value = 0.8
for o in meshes:
    o.data.materials.clear(); o.data.materials.append(gray)
    o.hide_render = False; o.hide_viewport = False

# 相机按包围盒取景
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
ctr = (mn + mx) / 2
size = max(mx - mn)
print('CENTER', tuple(round(v,3) for v in ctr), 'SIZE', round(size,3))
cd = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cd)
bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cd.lens = 50
cam.location = ctr + Vector((0, -size * 1.9, size * 0.35))
d = ctr - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
for n, loc, e in [('key', (3, -3, 5), 1200), ('fill', (-4, -2, 3), 500), ('rim', (0, 4, 4), 700)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    L = bpy.context.active_object; L.data.energy = e; L.data.size = 4
bpy.ops.mesh.primitive_plane_add(size=size * 6, location=(ctr.x, ctr.y, mn.z - 0.01))
ground = bpy.context.active_object
ground.data.materials.append(gray)
bpy.context.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1024
bpy.context.scene.render.resolution_y = 768
bpy.context.scene.world = bpy.data.worlds.new('W') if bpy.context.scene.world is None else bpy.context.scene.world
bpy.context.scene.world.color = (0.08, 0.08, 0.08)
bpy.context.scene.render.filepath = os.path.join(BASE, 'tinker-gray.png')
bpy.ops.render.render(write_still=True)
print('RENDERED gray')
