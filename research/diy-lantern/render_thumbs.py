# 石灯笼缩略图（v2：手算 look-at，不依赖约束）
import bpy, os, math
from mathutils import Vector

OUT = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(OUT, 'stone-lantern.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('IMPORTED=' + str(len(meshes)) + ':' + ','.join(sorted(o.name for o in meshes)))

# 真实包围盒中心与尺寸（世界系）
pts = []
for o in meshes:
    for c in o.bound_box:
        pts.append(o.matrix_world @ Vector(c))
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr = (mn + mx) / 2
size = mx - mn
print('BBOX min=(%.3f,%.3f,%.3f) max=(%.3f,%.3f,%.3f) center=(%.3f,%.3f,%.3f) size=(%.3f,%.3f,%.3f)'
      % (mn.x, mn.y, mn.z, mx.x, mx.y, mx.z, ctr.x, ctr.y, ctr.z, size.x, size.y, size.z))

scn = bpy.context.scene
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 50
cam = bpy.data.objects.new('cam', cam_d)
bpy.context.collection.objects.link(cam)
scn.camera = cam

def aim_at(target, dist, azimuth_deg, elev_deg):
    """相机放在 target 的球坐标上，look-at 手算，无约束。"""
    a, e = math.radians(azimuth_deg), math.radians(elev_deg)
    cam.location = target + Vector((dist*math.cos(e)*math.cos(a),
                                    dist*math.cos(e)*math.sin(a),
                                    dist*math.sin(e)))
    d = (target - cam.location)                      # 世界系视线方向
    q = d.to_track_quat('-Z', 'Y')                    # Blender 标准 look-at
    cam.rotation_euler = q.to_euler()
    return cam.location.copy()

def world(col, strength):
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    b = w.node_tree.nodes.get('Background')
    b.inputs['Color'].default_value = (*col, 1); b.inputs['Strength'].default_value = strength
    scn.world = w

def sun(energy, ang, rot):
    d = bpy.data.lights.new('sun', 'SUN'); d.energy = energy; d.angle = math.radians(ang)
    o = bpy.data.objects.new('sun', d); o.rotation_euler = rot
    bpy.context.collection.objects.link(o)

def render(path, label):
    bpy.context.view_layer.update()
    e = bpy.context.evaluated_depsgraph_get()
    cd = cam.evaluated_get(e)
    t = cd.matrix_world.translation
    fw = cd.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    print('CAM %s: loc=(%.3f,%.3f,%.3f) fwd=(%.3f,%.3f,%.3f)' % (label, t.x, t.y, t.z, fw.x, fw.y, fw.z))
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'RENDER_OK {label} -> {os.path.basename(path)} bytes={os.path.getsize(path)}')

scn.render.engine = 'CYCLES'
scn.cycles.device = 'CPU'
scn.cycles.samples = 96
scn.cycles.use_denoising = True
scn.render.resolution_x = 900
scn.render.resolution_y = 1150
scn.view_settings.view_transform = 'Standard'

# 竖构图：可视高度需容纳 1.05m + 上下留白 ≈1.5m
# 垂直 FOV @50mm/36mm 传感器 ≈ 2*atan(12/50) ≈ 27°  ⇒ dist ≈ (1.5/2)/tan(13.5°) ≈ 3.1m
TARGET = ctr
DIST = 3.15
loc = aim_at(TARGET, DIST, azimuth_deg=38, elev_deg=14)
print(f'CAM aim: target=({TARGET.x:.3f},{TARGET.y:.3f},{TARGET.z:.3f}) dist={DIST} loc=({loc.x:.3f},{loc.y:.3f},{loc.z:.3f})')

# 白天
world((0.78, 0.83, 0.90), 1.0)
sun(3.2, 3.0, (math.radians(52), math.radians(8), math.radians(-38)))
render(os.path.join(OUT, 'thumb-day.png'), 'day')

# 夜晚：去太阳、暗环境，只靠火袋 emissive（不加点光，守"不新增真光源"）
for o in [o for o in bpy.data.objects if o.type == 'LIGHT']:
    bpy.data.objects.remove(o, do_unlink=True)
world((0.030, 0.042, 0.075), 0.28)
sun(0.18, 12.0, (math.radians(60), 0, math.radians(150)))
render(os.path.join(OUT, 'thumb-night.png'), 'night')
print('DONE')
