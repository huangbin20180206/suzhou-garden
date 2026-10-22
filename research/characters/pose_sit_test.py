"""坐姿/抬臂测试渲染（检验裙骨与权重修复）。

用法：
  blender -b --python pose_sit_test.py -- <glb> <outdir> <mode> [skirt=0]
    mode: sit | stand | arms
    skirt: 前侧裙骨绕局部 X 的角度（rad，负/正各试一次）
"""
import bpy, sys, os, math
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index('--')+1:]
src, outdir, mode = argv[0], argv[1], argv[2]
skirt = float(argv[3]) if len(argv) > 3 else 0.0
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')

def pb(name, x=0.0, y=0.0, z=0.0):
    b = arm.pose.bones.get(name)
    if not b:
        return False
    b.rotation_mode = 'XYZ'
    b.rotation_euler = Euler((x, y, z), 'XYZ')
    return True

def move(name, dz):
    b = arm.pose.bones.get(name)
    if b: b.location = (0.0, dz, 0.0)   # 骨局部 Y = 骨轴向

if mode == 'sit':
    arm.pose.bones['Hips'].location = (0.0, -0.34, 0.0)
    pb('LeftUpperLeg', 1.45); pb('RightUpperLeg', 1.45)
    pb('LeftLowerLeg', -1.45); pb('RightLowerLeg', -1.45)
    pb('LeftFoot', 0.30); pb('RightFoot', 0.30)
    pb('Spine', 0.06); pb('Chest', 0.05)
    if abs(skirt) > 1e-6:
        pb('Skirt0', skirt)
        pb('Skirt1', skirt * 0.72); pb('Skirt5', skirt * 0.72)
        pb('Skirt2', skirt * 0.20); pb('Skirt4', skirt * 0.20)
        pb('Skirt3', -skirt * 0.55)          # 背后那片往后垂
elif mode == 'kneel':
    # 正坐/跪坐：大腿基本不动，小腿折回身下，髋下沉；长袍自然堆在地上。
    #   argv[3] = 裙骨"沿骨长压缩"的比例（1=不压），argv[4] = 向外撑开的角度
    sq = skirt if abs(skirt) > 1e-6 else 0.55
    spread = float(argv[4]) if len(argv) > 4 else 0.10
    RAD = float(argv[5]) if len(argv) > 5 else 1.0
    arm.pose.bones['Hips'].location = (0.0, -0.46, 0.0)
    for s in ('Left', 'Right'):
        pb(s + 'UpperLeg', -0.06, 0, 0.10 if s == 'Left' else -0.10)
        pb(s + 'LowerLeg', 1.62)   # 正号 = 小腿往后折（实测：+1.57 时踝在 y=+0.43 = 身后）
        pb(s + 'Foot', -1.30)      # 脚背贴地、脚尖朝后
        for fb in (s + 'Foot', s + 'Toes'):
            bb = arm.pose.bones.get(fb)
            if bb: bb.scale = (0.04, 0.04, 0.04)   # 收进袍内（长袍跪坐时脚本来就被下摆盖住）
    pb('Spine', 0.03)
    for i in range(6):
        b = arm.pose.bones.get('Skirt%d' % i)
        if not b:
            continue
        b.rotation_mode = 'XYZ'
        b.rotation_euler = Euler((spread * (1.0 if i in (0, 1, 5) else 0.55), 0, 0), 'XYZ')
        b.scale = (RAD, sq, RAD)                 # 径向撑开 = 下摆铺地
elif mode == 'arms':
    pb('LeftUpperArm', -1.15, 0.30, 0); pb('RightUpperArm', -1.15, -0.30, 0)
    pb('LeftLowerArm', -0.45, 0, 0); pb('RightLowerArm', -0.45, 0, 0)

bpy.context.view_layer.update()

# 量出来的姿态：网格实际高度 + 关键骨的世界位置（判"跪坐有没有真的压下去"）
dg = bpy.context.evaluated_depsgraph_get()
me = mesh.evaluated_get(dg).to_mesh()
zs = [(mesh.matrix_world @ v.co).z for v in me.vertices]
print('[pose] mesh z %.3f..%.3f (height %.3f)' % (min(zs), max(zs), max(zs) - min(zs)))
for n in ('Hips', 'Spine', 'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'):
    b = arm.pose.bones.get(n)
    if b:
        print('[pose] %-13s head=(%.3f, %.3f, %.3f)' % (n, *(arm.matrix_world @ b.head)))

# 场景/相机
pts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
ctr = sum(pts, Vector()) / 8
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
H = max(hi.z - lo.z, 0.6)
world = bpy.data.worlds.new('W'); bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.055, 0.06, 0.07, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
def lamp(name, loc, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (ctr - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
# 地面：判"跪坐时下摆/脚有没有插进地板"
bpy.ops.mesh.primitive_plane_add(size=4.0, location=(ctr.x, ctr.y, 0.0))
gp = bpy.context.object
gm = bpy.data.materials.new('ground'); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.22, 0.23, 0.24, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
gp.data.materials.append(gm)
lamp('key', (ctr.x + 2.2, ctr.y - 3.0, ctr.z + 2.4), 700, 3.0, (1.0, 0.97, 0.92))
lamp('fill', (ctr.x - 3.0, ctr.y - 1.5, ctr.z + 1.0), 320, 4.0, (0.85, 0.92, 1.0))
cam_d = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cam_d)
bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cam_d.lens = 60
sc = bpy.context.scene
eng = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in eng else 'BLENDER_EEVEE'
sc.render.resolution_x = 640; sc.render.resolution_y = 760

def shot(name, ang):
    a = math.radians(ang)
    dist = H * 1.9
    cam.location = (ctr.x + math.sin(a) * dist, ctr.y - math.cos(a) * dist, ctr.z - H * 0.05)
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(outdir, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('[shot]', sc.render.filepath)

tag = '%s%s' % (mode, ('_s%+.1f' % skirt) if abs(skirt) > 1e-6 else '')
shot(tag + '-front', 0)
shot(tag + '-side', 78)
