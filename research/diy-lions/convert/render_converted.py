# 转制产物三视图 + 与 v7 同机位对比
import bpy, os, math
from mathutils import Vector
OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
import glob
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.render.resolution_x = 900; sc.render.resolution_y = 900
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'AgX'
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
b = sc.world.node_tree.nodes.get('Background')
b.inputs['Color'].default_value = (0.52, 0.56, 0.60, 1); b.inputs['Strength'].default_value = 0.85

cd = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cd)
bpy.context.collection.objects.link(cam); sc.camera = cam; cd.lens = 55

def aim(t):
    cam.rotation_euler = (Vector(t) - cam.location).to_track_quat('-Z', 'Y').to_euler()

for nm, loc, pwr, sz in [('key', (0, 3.4, 3.2), 900, 3.0), ('fill', (3.2, 1.0, 2.6), 420, 3.5), ('rim', (-3.2, -1.2, 3.0), 480, 2.5)]:
    d = bpy.data.lights.new(nm, 'AREA'); d.energy = pwr; d.shape = 'DISK'; d.size = sz
    o = bpy.data.objects.new(nm, d); bpy.context.collection.objects.link(o); o.location = loc
    aim((0, 0, 0.55))

for tag in ('male', 'female'):
    p = os.path.join(OUT, 'lion-%s.glb' % tag)
    bpy.ops.import_scene.gltf(filepath=p)
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    pts = []
    for o in objs:
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    ctr = Vector((sum(v.x for v in pts) / len(pts), sum(v.y for v in pts) / len(pts), sum(v.z for v in pts) / len(pts)))
    sz = Vector((max(v.x for v in pts) - min(v.x for v in pts), max(v.y for v in pts) - min(v.y for v in pts), max(v.z for v in pts) - min(v.z for v in pts)))
    print('%s BBOX %.3f %.3f %.3f' % (tag, sz.x, sz.y, sz.z))
    for view, off in [('front', (0, 2.9, 0)), ('q34', (2.2, 2.6, 0)), ('side', (2.9, 0, 0))]:
        cam.location = ctr + Vector(off) + Vector((0, 0, 0.05))
        aim(ctr)
        f = os.path.join(OUT, 'conv-%s-%s.png' % (tag, view))
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        print('RENDER_OK ' + os.path.basename(f))
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
print('DONE')
