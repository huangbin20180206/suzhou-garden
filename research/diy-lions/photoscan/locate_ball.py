# 用射线把渲染图上的"绣球"像素反投影成世界坐标（2026-10-18）
# 与 render.py 完全同一套归一化 + 相机参数，保证像素对得上。
import bpy, os, math
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

BASE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(BASE, 'photoscan-lion.glb'))
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
s = 1.08 / max(obj.dimensions)
obj.scale = (s, s, s)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for c in obj.bound_box:
    p = obj.matrix_world @ Vector(c)
    for i in range(3): mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
obj.location.x -= (mn.x + mx.x) / 2
obj.location.y -= (mn.y + mx.y) / 2
obj.location.z -= mn.z
bpy.context.view_layer.update()
print('NORM_BBOX', tuple(round(v,3) for v in obj.dimensions),
      tuple(round(v,3) for v in obj.location))

cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data)
bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cam_data.lens = 50
cam.location = Vector((0.0, -2.2, 1.0))
d = Vector((0, 0, 0.55)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
bpy.context.view_layer.update()

dg = bpy.context.evaluated_depsgraph_get()
W = H = 900
# 相机局部方向 → 世界方向
import mathutils
cam_inv = cam.matrix_world.inverted()
def ray_at(px, py):
    nx = (px / W) * 2 - 1
    ny = 1 - (py / H) * 2
    tanx = math.tan(cam_data.angle / 2) * (W / H)
    tany = math.tan(cam_data.angle / 2)
    local = Vector((nx * tanx, ny * tany, -1.0)).normalized()
    origin = cam.matrix_world.translation
    direction = (cam.matrix_world.to_3x3() @ local).normalized()
    hit, loc, nor, idx, ob, mat = bpy.context.scene.ray_cast(dg, origin, direction)
    return (hit, loc, ob.name if ob else None)

for py in range(400, 541, 20):
    row = []
    for px in range(450, 591, 20):
        hit, loc, name = ray_at(px, py)
        row.append(f'{px},{py}:' + (f'({loc.x:.3f},{loc.y:.3f},{loc.z:.3f})' if hit else '—'))
    print(' | '.join(row))
