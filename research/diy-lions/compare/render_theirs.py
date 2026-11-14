# 对比用：打开 theirs 建好的 .blend，统计面数 + 按原 studio 打光渲染两张
import bpy, os
from mathutils import Vector
BLEND = r'C:\Users\huang\Chinese_Guardian_Lions_HighDetail.blend'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'theirs-studio-wide.png')
OUT2 = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'theirs-male-face.png')
bpy.ops.wm.open_mainfile(filepath=BLEND)
n_mesh = n_curve = tris = 0
for o in bpy.data.objects:
    if o.type == 'MESH':
        n_mesh += 1
        me = o.data
        try: me.calc_loop_triangles()
        except Exception: pass
        tris += len(me.loop_triangles)
    elif o.type == 'CURVE':
        n_curve += 1
print('STATS meshes=%d curves=%d tris=%d' % (n_mesh, n_curve, tris))
scn = bpy.context.scene
scn.cycles.samples = 12
scn.render.resolution_x = 1280; scn.render.resolution_y = 880
# A：作者原机位（双狮全景）
scn.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('RENDER_OK wide')
# B：推到公狮脸上（公狮 cx=-1.08，脸朝 -Y，头约 (-1.08,-0.48,2.18)）
cam = scn.camera
cam.location = Vector((-1.08, -4.6, 2.25))
tgt = Vector((-1.08, -0.48, 2.05))
cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
scn.render.filepath = OUT2
bpy.ops.render.render(write_still=True)
print('RENDER_OK maleface')
