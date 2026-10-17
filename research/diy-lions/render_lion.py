# stone-lion 三视图缩略图
import bpy, os, math
from mathutils import Vector
OUT = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(OUT, 'stone-lion.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
print('IMPORTED=%d:%s' % (len(objs), ','.join(sorted(o.name for o in objs))))
pts = []
for o in objs:
    for c in o.bound_box:
        pts.append(o.matrix_world @ Vector(c))
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr = (mn + mx) / 2; size = mx - mn
print('BBOX size=(%.3f,%.3f,%.3f) min_z=%.3f max_z=%.3f' % (size.x, size.y, size.z, mn.z, mx.z))
scn = bpy.context.scene
scn.render.resolution_x = 900; scn.render.resolution_y = 900
scn.render.film_transparent = False
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 55
cam = bpy.data.objects.new('cam', cam_d); bpy.context.collection.objects.link(cam); scn.camera = cam
def aim(target, dist, az, el):
    a, e = math.radians(az), math.radians(el)
    cam.location = target + Vector((dist*math.cos(e)*math.cos(a), dist*math.cos(e)*math.sin(a), dist*math.sin(e)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
w = bpy.data.worlds.new('w'); w.use_nodes = True
b = w.node_tree.nodes.get('Background'); b.inputs['Color'].default_value = (0.55, 0.60, 0.66, 1); b.inputs['Strength'].default_value = 0.85
scn.world = w
d = bpy.data.lights.new('sun', 'SUN'); d.energy = 3.2; d.angle = math.radians(6)
so = bpy.data.objects.new('sun', d); so.rotation_euler = (math.radians(52), 0, math.radians(35))
bpy.context.collection.objects.link(so)
d2 = bpy.data.lights.new('fill', 'SUN'); d2.energy = 1.0
so2 = bpy.data.objects.new('fill', d2); so2.rotation_euler = (math.radians(62), 0, math.radians(-140))
bpy.context.collection.objects.link(so2)
views = [('front', 0), ('q34', 42), ('side', 90)]
for tag, az in views:
    aim(Vector((ctr.x, ctr.y, ctr.z * 1.0)), 2.6, az, 12)
    p = os.path.join(OUT, 'lion-' + tag + '.png')
    scn.render.filepath = p
    bpy.ops.render.render(write_still=True)
    print('RENDER_OK ' + tag + ' bytes=' + str(os.path.getsize(p)))
