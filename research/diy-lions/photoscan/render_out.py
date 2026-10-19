# 出图核对：公/母/幼狮形体（2026-10-18）
import bpy, os, math
from mathutils import Vector

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'out')

def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def render(glb, tag):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    print('LOAD', tag, 'dims', tuple(round(v, 3) for v in obj.dimensions),
          'tris', len(obj.data.polygons))
    # 摆平：导入后 glTF y-up → blender z-up，底部对齐
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for c in obj.bound_box:
        p = obj.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    obj.location.x -= (mn.x + mx.x) / 2
    obj.location.y -= (mn.y + mx.y) / 2
    obj.location.z -= mn.z
    bpy.context.view_layer.update()
    # 地面
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    ground = bpy.context.active_object
    mat = bpy.data.materials.new('ground'); mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0.20, 0.20, 0.20, 1)
    bsdf.inputs['Roughness'].default_value = 0.92
    ground.data.materials.append(mat)
    for name, loc, energy, size in [('key', (2.2, -2.6, 3.0), 450, 3.0),
                                    ('fill', (-2.5, -1.0, 1.6), 120, 2.5),
                                    ('rim', (0, 2.8, 2.2), 180, 2.0)]:
        bpy.ops.object.light_add(type='AREA', location=loc)
        L = bpy.context.active_object
        L.data.energy = energy; L.data.size = size
    cd = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
    cd.lens = 50
    bpy.context.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
    bpy.context.scene.render.resolution_x = 900
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.world = bpy.data.worlds.new('W') if bpy.context.scene.world is None else bpy.context.scene.world
    bpy.context.scene.world.color = (0.05, 0.05, 0.05)
    for name, loc in [('front', (0.0, -2.2, 1.0)), ('q34', (-1.5, -1.7, 1.0)),
                      ('close', (0.55, -1.15, 0.85))]:
        cam.location = Vector(loc); look_at(cam, (0, 0, 0.52))
        bpy.context.scene.render.filepath = os.path.join(OUT, f'{tag}-{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDER', tag, name)

render(os.path.join(OUT, 'stone-lion-male.glb'), 'male')
render(os.path.join(OUT, 'stone-lion-female.glb'), 'female')
render(os.path.join(OUT, 'debug-cub.glb'), 'cub')
print('DONE')
