import bpy, sys, math
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index("--")+1:]
SRC, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

def scene_bbox():
    lo = Vector((1e9,1e9,1e9)); hi = Vector((-1e9,-1e9,-1e9))
    for o in bpy.context.scene.objects:
        if o.type != "MESH": continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo.x=min(lo.x,w.x); lo.y=min(lo.y,w.y); lo.z=min(lo.z,w.z)
            hi.x=max(hi.x,w.x); hi.y=max(hi.y,w.y); hi.z=max(hi.z,w.z)
    return lo, hi

def ext(lo, hi):
    return (hi.x-lo.x, hi.y-lo.y, hi.z-lo.z)

lo, hi = scene_bbox()
ex, ey, ez = ext(lo, hi)
print("BBOX_BEFORE ext= %.3f %.3f %.3f" % (ex, ey, ez))

# 立起来：把最长轴旋到 +Z（Blender 是 Z-up）
from math import radians as R, pi
if ez < max(ex, ey):
    from mathutils import Matrix
    roots = [o for o in bpy.data.objects if o.parent is None]
    rotM = Matrix.Rotation(math.radians(90), 4, "X") if ey >= ex else Matrix.Rotation(math.radians(-90), 4, "Y")
    for o in roots:
        o.matrix_basis = rotM @ o.matrix_basis
    bpy.context.view_layer.update()
    lo, hi = scene_bbox()
    ex, ey, ez = ext(lo, hi)
    print("BBOX_AFTER ext= %.3f %.3f %.3f" % (ex, ey, ez))

# 底部推到 y=0（Blender Z-up）
from mathutils import Matrix, Vector as V2
Tm = Matrix.Translation(V2((0, 0, -lo.z)))
roots = [o for o in bpy.data.objects if o.parent is None]
for o in roots:
    o.matrix_basis = Tm @ o.matrix_basis
bpy.context.view_layer.update()
lo, hi = scene_bbox()
ex, ey, ez = ext(lo, hi)
print("BBOX_ON_GROUND ext= %.3f %.3f %.3f center= %.3f %.3f %.3f" % (ex, ey, ez, (lo.x+hi.x)/2, (lo.y+hi.y)/2, (lo.z+hi.z)/2))

tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.context.scene.objects:
    if o.type != "MESH": continue
    m = o.evaluated_get(dg)
    me = m.to_mesh()
    tris += sum(len(p.vertices)-2 for p in me.polygons)
    m.to_mesh_clear()
print("TRIS", tris)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB")
print("EXPORTED", OUT)