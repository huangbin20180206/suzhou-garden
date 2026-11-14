# 定向：直接渲染当前构建现场（不经过 GLB 往返），从 +Y 和 -Y 各拍一张，看脸在哪边
import bpy, os
from mathutils import Vector
OUT = os.path.dirname(os.path.abspath(__file__))
scn = bpy.context.scene
scn.render.resolution_x = 700; scn.render.resolution_y = 700
scn.render.film_transparent = False
w = scn.world
if w is None:
    w = bpy.data.worlds.new('w'); scn.world = w
w.use_nodes = True
b = w.node_tree.nodes.get('Background'); b.inputs['Color'].default_value = (0.55, 0.60, 0.66, 1)
cam_d = bpy.data.cameras.new('dir'); cam_d.lens = 55
cam = bpy.data.objects.new('dir', cam_d); bpy.context.collection.objects.link(cam); scn.camera = cam
import math
d = bpy.data.lights.new('sun', 'SUN'); d.energy = 3.0
so = bpy.data.objects.new('sun', d); so.rotation_euler = (math.radians(52), 0, math.radians(35))
bpy.context.collection.objects.link(so)
# 以雌狮头心 (0, 0.10, 0.82) 为目标
for tag, cy in [('face_PLEASE', 3.0), ('face_MINUS', -3.0)]:
    cam.location = Vector((0, cy, 0.95))
    cam.rotation_euler = (Vector((0, 0.10, 0.80)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    p = os.path.join(OUT, 'dir-' + tag + '.png')
    scn.render.filepath = p
    bpy.ops.render.render(write_still=True)
    print('RENDER_OK ' + tag)
