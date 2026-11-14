"""拉伸测试：抬臂 + 迈步各一帧，看腋下/裤腿/裙摆有没有被误权重拽走。

用法：blender -b --python pose_stretch_test.py -- <glb> <outdir>
"""
import bpy, sys, os, math
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index('--')+1:]
src, outdir = argv[0], argv[1]
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')

# 世界包围盒
pts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
ctr = sum(pts, Vector()) / 8
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
H = hi.z - lo.z

def pose(name, x=0.0, y=0.0, z=0.0):
    pb = arm.pose.bones.get(name)
    if not pb: print('[pose] missing', name); return
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = Euler((x, y, z), 'XYZ')

pose('LeftUpperArm', 0, 0.75, 0)
pose('RightUpperArm', 0, -0.75, 0)
pose('LeftUpperArm', -0.9, 0.75, 0)   # 再往前抬，腋下最容易撕
pose('LeftUpperLeg', 0.42, 0, 0)
pose('RightUpperLeg', -0.28, 0, 0)
pose('LeftLowerLeg', -0.20, 0, 0)

world = bpy.data.worlds.new('W'); bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.055, 0.06, 0.07, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.7

def lamp(name, loc, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (ctr - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

lamp('key', (ctr.x + 2.2, ctr.y - 3.0, ctr.z + 2.6), 700, 3.0, (1.0, 0.97, 0.92))
lamp('fill', (ctr.x - 3.0, ctr.y - 1.5, ctr.z + 1.2), 320, 4.0, (0.85, 0.92, 1.0))

cam_d = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cam_d)
bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cam_d.lens = 60
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.resolution_x = 640; scene.render.resolution_y = 800
scene.render.film_transparent = False

def shot(name, ang_deg):
    a = math.radians(ang_deg)
    dist = H * 2.0
    cam.location = (ctr.x + math.sin(a) * dist, ctr.y - math.cos(a) * dist, ctr.z + H * 0.10)
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(outdir, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('[shot]', scene.render.filepath)

shot('stretch-front', 0)
shot('stretch-side', 75)
