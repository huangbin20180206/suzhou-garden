# 对比用：接在 tabbit.py 后面跑，给无灯场景补中性打光，渲染三张（与自制v6同口径比形）
import bpy, os, math
from mathutils import Vector
OUT = os.path.dirname(os.path.abspath(__file__))
scn = bpy.context.scene
scn.render.engine = 'CYCLES'
scn.cycles.samples = 16
scn.render.resolution_x = 900; scn.render.resolution_y = 900
scn.render.film_transparent = False
w = scn.world
w.use_nodes = True
b = w.node_tree.nodes.get('Background') or w.node_tree.nodes.new('ShaderNodeBackground')
b.inputs['Color'].default_value = (0.55, 0.60, 0.66, 1); b.inputs['Strength'].default_value = 0.85
cam_d = bpy.data.cameras.new('cmp'); cam_d.lens = 55
cam = bpy.data.objects.new('cmp', cam_d); bpy.context.collection.objects.link(cam); scn.camera = cam
def aim(tx, ty, tz, cx, cy, cz):
    cam.location = Vector((cx, cy, cz))
    cam.rotation_euler = (Vector((tx, ty, tz)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
d = bpy.data.lights.new('sun', 'SUN'); d.energy = 3.2; d.angle = math.radians(6)
so = bpy.data.objects.new('sun', d); so.rotation_euler = (math.radians(52), 0, math.radians(35))
bpy.context.collection.objects.link(so)
d2 = bpy.data.lights.new('fill', 'SUN'); d2.energy = 1.0
so2 = bpy.data.objects.new('fill', d2); so2.rotation_euler = (math.radians(62), 0, math.radians(-140))
bpy.context.collection.objects.link(so2)
views = [('tabbit-wide', (0, -0.1, 1.0), (0, -7.0, 2.0)),
         ('tabbit-face', (-1.6, -0.2, 1.7), (-1.6, -3.2, 1.8)),
         ('tabbit-q34', (0, 0, 1.0), (4.8, -5.2, 2.4))]
for tag, t, c in views:
    aim(*t, *c)
    p = os.path.join(OUT, tag + '.png')
    scn.render.filepath = p
    bpy.ops.render.render(write_still=True)
    print('RENDER_OK ' + tag + ' bytes=' + str(os.path.getsize(p)))
