import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--")+1:]
SRC, OUT = argv[0], argv[1]
# 浅灰目标：均值 0.62、范围 [0.25, 0.95]（保留贴图明暗细节，只去饱和+提亮）
TARGET, LO, HI = 0.62, 0.25, 0.95

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# ── 改浅灰：只动接 Base Color 的 diffuse 贴图像素（去饱和→均值归一→范围重映射）──
def mean_rgb(img):
    px = list(img.pixels[:])
    n = len(px)//4
    rs=gs=bs=0.0
    for i in range(n):
        j=i*4; rs+=px[j]; gs+=px[j+1]; bs+=px[j+2]
    return (rs/n, gs/n, bs/n)

def recolor(img):
    px = list(img.pixels[:])          # 原始字节值（未经色彩管理转换）
    n = len(px)//4
    m = 0.0
    for i in range(n):
        j=i*4
        m += px[j]*0.2126 + px[j+1]*0.7152 + px[j+2]*0.0722
    m /= n
    s = TARGET/max(m, 0.05)
    if s > 2.5: s = 2.5              # 封顶，防止暗部细节炸白
    after = 0.0
    for i in range(n):
        j=i*4
        lum = px[j]*0.2126 + px[j+1]*0.7152 + px[j+2]*0.0722
        g = lum*s
        if g > 1.0: g = 1.0
        g = LO + g*(HI-LO)
        px[j]=g; px[j+1]=g; px[j+2]=g
        after += g
    img.pixels[:] = px
    img.pack()
    return m, after/n, s

hit = 0
for mat in bpy.data.materials:
    nt = getattr(mat, "node_tree", None)
    if not nt: continue
    for nd in nt.nodes:
        if nd.type != "TEX_IMAGE" or not nd.image: continue
        is_base = False
        for lnk in nt.links:
            if lnk.from_node == nd and lnk.from_socket.name == "Color" and lnk.to_socket.name == "Base Color":
                is_base = True
        if is_base:
            before = mean_rgb(nd.image)
            m, am, s = recolor(nd.image)
            print("RECOLOR img=%s before=(%.3f,%.3f,%.3f) lumMean=%.3f scale=%.2f afterMean=%.3f"
                  % (nd.image.name, before[0], before[1], before[2], m, s, am))
            hit += 1
print("RECOLOR_HITS", hit)

def scene_bbox():
    lo = Vector((1e9,1e9,1e9)); hi = Vector((-1e9,-1e9,-1e9))
    for o in bpy.context.scene.objects:
        if o.type != "MESH": continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo.x=min(lo.x,w.x); lo.y=min(lo.y,w.y); lo.z=min(lo.z,w.z)
            hi.x=max(hi.x,w.x); hi.y=max(hi.y,w.y); hi.z=max(hi.z,w.z)
    return lo, hi

lo, hi = scene_bbox()
ex, ey, ez = hi.x-lo.x, hi.y-lo.y, hi.z-lo.z
print("BBOX_BEFORE ext= %.3f %.3f %.3f" % (ex, ey, ez))

# 立起来：最长轴旋到 +Z（与 boulder 管线同一规则）
if ez < max(ex, ey):
    rotM = Matrix.Rotation(math.radians(90), 4, "X") if ey >= ex else Matrix.Rotation(math.radians(-90), 4, "Y")
    roots = [o for o in bpy.data.objects if o.parent is None]
    for o in roots:
        o.matrix_basis = rotM @ o.matrix_basis
    bpy.context.view_layer.update()
    lo, hi = scene_bbox()
    ex, ey, ez = hi.x-lo.x, hi.y-lo.y, hi.z-lo.z
    print("BBOX_AFTER ext= %.3f %.3f %.3f" % (ex, ey, ez))

# 底部推到 z=0
Tm = Matrix.Translation(Vector((0, 0, -lo.z)))
roots = [o for o in bpy.data.objects if o.parent is None]
for o in roots:
    o.matrix_basis = Tm @ o.matrix_basis
bpy.context.view_layer.update()
lo, hi = scene_bbox()
ex, ey, ez = hi.x-lo.x, hi.y-lo.y, hi.z-lo.z
print("BBOX_ON_GROUND ext= %.3f %.3f %.3f center= %.3f %.3f %.3f" % (ex, ey, ez, (lo.x+hi.x)/2, (lo.y+hi.y)/2, (lo.z+hi.z)/2))

tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.context.scene.objects:
    if o.type != "MESH": continue
    me = o.evaluated_get(dg).to_mesh()
    tris += sum(len(p.vertices)-2 for p in me.polygons)
    o.evaluated_get(dg).to_mesh_clear()
print("TRIS", tris)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB")
print("EXPORTED", OUT)