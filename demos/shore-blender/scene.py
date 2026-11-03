import bpy, bmesh, math, sys, json, random
from mathutils import Vector, noise

# ---------- args ----------
argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
def arg(name, default):
    for a in argv:
        if a.startswith(name+"="):
            return a.split("=",1)[1]
    return default
SAMPLES = int(arg("samples", "48"))
W = int(arg("w", "1280")); H = int(arg("h", "720"))
OUT = arg("out", "C:/Users/huang/AppData/Roaming/dsh-desktop/harness/bot/workspace/shore-blender/render.png")
FRAME = int(arg("frame", "1"))
SUN_EL = float(arg("sun_el", "0.62"))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8
sc.render.resolution_x = W; sc.render.resolution_y = H
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Standard'
sc.view_settings.look = 'None'
sc.view_settings.exposure = -0.5
sc.frame_set(FRAME)

R = 16.0  # 岸线场覆盖半宽（米）

def shore_r(ang):
    return 5.4 + 0.55*math.sin(3*ang+1.7) + 0.28*math.sin(7*ang+0.4) + 0.12*math.sin(11*ang+2.3)

def land_h(x, y):
    r = math.hypot(x, y); ang = math.atan2(y, x); s = shore_r(ang)
    d = s - r
    if d > 0:
        h = (min(d, 3.2)/3.2)**0.8 * 1.25
        h += 0.16*noise.noise(Vector((x*0.45, y*0.45, 0.0)))
        h += 0.05*noise.noise(Vector((x*1.7, y*1.7, 3.1)))
        return max(h, 0.02)
    return max(-2.6, d*0.42)

# ---------- 岸线距离场贴图（R 通道存 d，编码 d/16+0.5） ----------
N = 512
img = bpy.data.images.new("ShoreField", N, N, float_buffer=True)
px = [0.0]*(N*N*4)
for j in range(N):
    wy = (j/(N-1)*2-1)*R
    for i in range(N):
        wx = (i/(N-1)*2-1)*R
        r = math.hypot(wx, wy); ang = math.atan2(wy, wx)
        d = shore_r(ang) - r
        d += 0.12*noise.noise(Vector((wx*1.3, wy*1.3, 5.0)))
        v = d/16.0 + 0.5
        k = (j*N+i)*4
        px[k] = v; px[k+1] = v; px[k+2] = v; px[k+3] = 1.0
img.pixels = px
img.pack()

def new_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (900, 0)
    return m, nt, out

def sock(node, names, default=None):
    for n in names:
        if n in node.inputs:
            s = node.inputs[n]
            if default is not None:
                try: s.default_value = default
                except Exception: pass
            return s
    return None

def ramp(nt, stops, loc=(0,0)):
    r = nt.nodes.new("ShaderNodeValToRGB"); r.location = loc
    el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0]
    el[1].position, el[1].color = stops[-1]
    for pos, col in stops[1:-1]:
        e = el.new(pos); e.color = col
    return r

def shore_field(nt, loc=(-900,0)):
    uv = nt.nodes.new("ShaderNodeUVMap"); uv.location = (loc[0]-200, loc[1])
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.location = loc
    tex.image = img; tex.interpolation = 'Linear'; tex.extension = 'EXTEND'
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    # d = (R - 0.5) * 16
    sub = nt.nodes.new("ShaderNodeMath"); sub.operation='SUBTRACT'; sub.location=(loc[0]+220, loc[1])
    sub.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs["Color"], sub.inputs[0])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation='MULTIPLY'; mul.location=(loc[0]+400, loc[1])
    mul.inputs[1].default_value = 16.0
    nt.links.new(sub.outputs[0], mul.inputs[0])
    return tex, mul  # mul.outputs[0] = d（正=陆地，负=水下）

# ---------- 岛 ----------
NG = 160; S = 18.0
verts = []; uvs = []; faces = []
for j in range(NG+1):
    for i in range(NG+1):
        x = -S + 2*S*i/NG; y = -S + 2*S*j/NG
        verts.append((x, y, land_h(x, y)))
        uvs.append(((x+R)/(2*R), (y+R)/(2*R)))
for j in range(NG):
    for i in range(NG):
        a = j*(NG+1)+i; b = a+1; c = a+NG+1; d = c+1
        faces.append((a, b, d, c))
me = bpy.data.meshes.new("Island"); me.from_pydata(verts, [], faces); me.update()
uvl = me.uv_layers.new(name="UVMap")
for li, loop in enumerate(me.loops):
    uvl.data[li].uv = uvs[loop.vertex_index]
ob = bpy.data.objects.new("Island", me); sc.collection.objects.link(ob)
for p in me.polygons: p.use_smooth = True

# 顶点色：草->沙（平滑过渡，无锯齿）
col_layer = me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
for i, v in enumerate(me.vertices):
    x, y, z = v.co.x, v.co.y, v.co.z
    r = math.hypot(x, y); ang = math.atan2(y, x)
    d0 = shore_r(ang) - r
    n1 = 0.5+0.5*noise.noise(Vector((x*0.8, y*0.8, 11.0)))
    edge = 0.50 + 0.22*(n1-0.5)
    g = max(0.0, min(1.0, (z - edge)/0.40))
    sand = (0.66+0.10*n1, 0.57+0.09*n1, 0.40+0.07*n1)
    grass = (0.09+0.05*n1, 0.26+0.10*n1, 0.10+0.04*n1)
    c = tuple(sand[k]*(1-g) + grass[k]*g for k in range(3))
    if d0 < 0:
        f = max(0.30, 1.0 + d0*0.20)
        c = tuple(c2*f for c2 in c)
    col_layer.data[i].color = (c[0], c[1], c[2], 1.0)

m_island, nt, out = new_mat("Island")
tex, dsock = shore_field(nt)
d = dsock.outputs[0]
vcn = nt.nodes.new("ShaderNodeAttribute"); vcn.attribute_name = "Col"; vcn.location=(-500,150)
# 湿沙：水线附近变深
wetf = nt.nodes.new("ShaderNodeMapRange"); wetf.location=(-750,-250)
wetf.inputs["From Min"].default_value = -0.15; wetf.inputs["From Max"].default_value = 1.20
nt.links.new(d, wetf.inputs["Value"])
wetr = nt.nodes.new("ShaderNodeMapRange"); wetr.location=(-500,-250)
wetr.inputs["To Min"].default_value = 0.52; wetr.inputs["To Max"].default_value = 1.0
nt.links.new(wetf.outputs["Result"], wetr.inputs["Value"])
mulc = nt.nodes.new("ShaderNodeMix"); mulc.data_type='RGBA'; mulc.blend_type='MULTIPLY'; mulc.location=(-200,50)
nt.links.new(vcn.outputs["Color"], mulc.inputs[6])
nt.links.new(wetr.outputs["Result"], mulc.inputs[7])
# 水下焦散（只在浅水带）
tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location=(-950,-550)
vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.location=(-750,-550); vor.inputs["Scale"].default_value=2.4
try: vor.feature = 'DISTANCE_TO_EDGE'
except Exception: pass
nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
caus = ramp(nt, [(0.0,(1,1,1,1)), (0.10,(0.0,0.0,0.0,1)), (0.22,(0.55,0.55,0.55,1)), (0.34,(0.0,0.0,0.0,1))], (-520,-550))
nt.links.new(vor.outputs["Distance"], caus.inputs["Fac"])
band = nt.nodes.new("ShaderNodeMapRange"); band.location=(-750,-800)
band.inputs["From Min"].default_value = 0.30; band.inputs["From Max"].default_value = -2.40
nt.links.new(d, band.inputs["Value"])
cmul = nt.nodes.new("ShaderNodeMath"); cmul.operation='MULTIPLY'; cmul.location=(-300,-650)
nt.links.new(caus.outputs["Color"], cmul.inputs[0])
nt.links.new(band.outputs["Result"], cmul.inputs[1])
addm = nt.nodes.new("ShaderNodeMix"); addm.data_type='RGBA'; addm.blend_type='ADD'; addm.location=(100,0)
nt.links.new(mulc.outputs[2], addm.inputs[6])
nt.links.new(cmul.outputs[0], addm.inputs[7])
addm.inputs[0].default_value = 0.30
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location=(400,0)
sock(bsdf, ["Roughness"], 0.88); sock(bsdf, ["Specular IOR Level","Specular"], 0.22)
nt.links.new(addm.outputs[2], bsdf.inputs["Base Color"])
nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
ob.data.materials.append(m_island)

# ---------- 水面 ----------
bpy.ops.mesh.primitive_plane_add(size=170, location=(0,0,0))
w = bpy.context.object; w.name = "Ocean"
bpy.context.view_layer.objects.active = w
for _ in range(2):
    bpy.ops.object.modifier_add(type='SUBSURF')
    m = w.modifiers[-1]; m.subdivision_type='SIMPLE'; m.levels=3; m.render_levels=3
    bpy.ops.object.modifier_apply(modifier=m.name)
try:
    bpy.ops.object.modifier_add(type='OCEAN')
    oc = w.modifiers[-1]
    oc.geometry_mode = 'DISPLACE'
    oc.resolution = 14; oc.viewport_resolution = 8
    oc.spatial_size = 38
    oc.wind_velocity = 9.5
    oc.wave_scale = 1.15
    oc.choppiness = 1.25
    oc.wave_alignment = 0.3
    oc.wave_direction = math.radians(35)
    oc.use_foam = True
    oc.foam_layer_name = "foam"
    oc.use_spray = False
except Exception as e:
    print("OCEAN_FAIL", e)

# 水面 UV（与世界 XY 对齐，用同一张岸线场）
uvl2 = w.data.uv_layers.new(name="UVMap")
for li, loop in enumerate(w.data.loops):
    co = w.data.vertices[loop.vertex_index].co
    uvl2.data[li].uv = ((co.x+R)/(2*R), (co.y+R)/(2*R))
for p in w.data.polygons: p.use_smooth = True

m_water, nt, out = new_mat("Water")
tex, dsock = shore_field(nt)
d = dsock.outputs[0]
dfac = nt.nodes.new("ShaderNodeMapRange"); dfac.location=(-500,-250)
dfac.inputs["From Min"].default_value = -6.0; dfac.inputs["From Max"].default_value = 0.3
nt.links.new(d, dfac.inputs["Value"])
col = ramp(nt, [(0.0,(0.004,0.03,0.10,1)), (0.35,(0.01,0.12,0.26,1)), (0.75,(0.04,0.36,0.44,1)), (1.0,(0.26,0.76,0.72,1))], (-200,-250))
nt.links.new(dfac.outputs["Result"], col.inputs["Fac"])
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location=(150,-100)
sock(bsdf, ["Roughness"], 0.055)
sock(bsdf, ["IOR"], 1.33)
sock(bsdf, ["Transmission Weight","Transmission"], 0.35)
sock(bsdf, ["Specular IOR Level","Specular"], 0.7)
nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
# 浅水更透，能看见水下沙
trn = nt.nodes.new("ShaderNodeMath"); trn.operation='MULTIPLY_ADD'; trn.location=(-150,-450)
nt.links.new(dfac.outputs["Result"], trn.inputs[0]); trn.inputs[1].default_value=0.45; trn.inputs[2].default_value=0.18
tsock = sock(bsdf, ["Transmission Weight","Transmission"])
nt.links.new(trn.outputs[0], tsock)
# 岸边泡沫：|d| 小于阈值 + 噪声打碎
fmap = nt.nodes.new("ShaderNodeMapRange"); fmap.location=(-500,150)
fmap.inputs["From Min"].default_value = -1.6; fmap.inputs["From Max"].default_value = -0.05
fmap.inputs["To Min"].default_value = 1.0; fmap.inputs["To Max"].default_value = 0.0
nt.links.new(d, fmap.inputs["Value"])
nzf = nt.nodes.new("ShaderNodeTexNoise"); nzf.location=(-500,380); nzf.inputs["Scale"].default_value=9.0
try: nzf.inputs["Detail"].default_value = 6.0
except Exception: pass
nt.links.new(tc.outputs["Object"], nzf.inputs["Vector"])
fnoise = ramp(nt, [(0.30,(0,0,0,1)), (0.62,(1,1,1,1))], (-260,380))
nt.links.new(nzf.outputs["Fac"], fnoise.inputs["Fac"])
fmul = nt.nodes.new("ShaderNodeMath"); fmul.operation='MULTIPLY'; fmul.location=(-20,300)
nt.links.new(fmap.outputs["Result"], fmul.inputs[0]); nt.links.new(fnoise.outputs["Color"], fmul.inputs[1])
# 海面自身的白沫（海洋修改器 foam 属性）
try:
    at = nt.nodes.new("ShaderNodeAttribute"); at.location=(-500,600); at.attribute_name="foam"
    atw = nt.nodes.new("ShaderNodeMath"); atw.operation='MULTIPLY'; atw.location=(-260,600); atw.inputs[1].default_value=0.35
    nt.links.new(at.outputs["Fac"], atw.inputs[0])
    fadd = nt.nodes.new("ShaderNodeMath"); fadd.operation='ADD'; fadd.location=(180,380)
    nt.links.new(fmul.outputs[0], fadd.inputs[0]); nt.links.new(atw.outputs[0], fadd.inputs[1])
    foam_fac = fadd.outputs[0]
except Exception:
    foam_fac = fmul.outputs[0]
fmix = nt.nodes.new("ShaderNodeMixShader"); fmix.location=(600,0)
fbsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); fbsdf.location=(350,-350)
sock(fbsdf, ["Base Color"], (1,1,1,1)); sock(fbsdf, ["Roughness"], 0.55)
nt.links.new(foam_fac, fmix.inputs[0])
nt.links.new(bsdf.outputs["BSDF"], fmix.inputs[1])
nt.links.new(fbsdf.outputs["BSDF"], fmix.inputs[2])
nt.links.new(fmix.outputs["Shader"], out.inputs["Surface"])
w.data.materials.append(m_water)

# ---------- 礁石 ----------
m_rock, nt2, out2 = new_mat("Rock")
b2 = nt2.nodes.new("ShaderNodeBsdfPrincipled"); b2.location=(400,0)
sock(b2, ["Base Color"], (0.30,0.29,0.27,1)); sock(b2, ["Roughness"], 0.9)
nt2.links.new(b2.outputs["BSDF"], out2.inputs["Surface"])
random.seed(7)
for k in range(9):
    ang = random.uniform(0, 2*math.pi); rr = random.uniform(6.2, 11.0)
    x, y = math.cos(ang)*rr, math.sin(ang)*rr
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=random.uniform(0.35,0.95), location=(x,y,-0.1))
    r = bpy.context.object; r.name = f"Rock{k}"
    for v in r.data.vertices:
        v.co.x *= random.uniform(0.9,1.3); v.co.z *= random.uniform(0.5,0.9)
        v.co += Vector((random.uniform(-0.05,0.05) for _ in range(3)))
    r.rotation_euler[2] = random.uniform(0,6.28)
    for p in r.data.polygons: p.use_smooth = False
    r.data.materials.append(m_rock)

# ---------- 椰树 ----------
m_palm, nt3, out3 = new_mat("PalmTrunk")
b3 = nt3.nodes.new("ShaderNodeBsdfPrincipled"); b3.location=(400,0)
sock(b3, ["Base Color"], (0.32,0.24,0.16,1)); sock(b3, ["Roughness"], 0.9)
nt3.links.new(b3.outputs["BSDF"], out3.inputs["Surface"])
m_leaf, nt4, out4 = new_mat("PalmLeaf")
b4 = nt4.nodes.new("ShaderNodeBsdfPrincipled"); b4.location=(400,0)
sock(b4, ["Base Color"], (0.10,0.34,0.12,1)); sock(b4, ["Roughness"], 0.7)
nt4.links.new(b4.outputs["BSDF"], out4.inputs["Surface"])

def make_palm(x, y, scale=1.0, rot=0.0):
    base_z = land_h(x, y)
    H = 3.4*scale
    curve = 0.55*scale
    verts=[]; faces=[]
    seg = 12; sides = 6
    for s in range(seg+1):
        t = s/seg
        cx = math.cos(rot)*(curve*t*t); cy = math.sin(rot)*(curve*t*t)
        cz = base_z + H*t
        rad = 0.12*scale*(1-0.55*t)+0.03
        for sd in range(sides):
            a = 2*math.pi*sd/sides
            verts.append((cx+math.cos(a)*rad, cy+math.sin(a)*rad, cz))
    for s in range(seg):
        for sd in range(sides):
            a = s*sides+sd; b = s*sides+(sd+1)%sides
            c = (s+1)*sides+sd; d2 = (s+1)*sides+(sd+1)%sides
            faces.append((a,b,d2,c))
    me2 = bpy.data.meshes.new(f"Palm{x:.1f}{y:.1f}"); me2.from_pydata(verts,[],faces); me2.update()
    o2 = bpy.data.objects.new(me2.name, me2); sc.collection.objects.link(o2)
    for p in me2.polygons: p.use_smooth=True
    me2.materials.append(m_palm)
    top = Vector((math.cos(rot)*curve, math.sin(rot)*curve, base_z+H))
    for li in range(9):
        a = 2*math.pi*li/9 + rot
        L = 2.1*scale; droop = 0.75*scale
        pts = []
        for tt in [0.0,0.35,0.7,1.0]:
            rr = L*tt
            pts.append(Vector((top.x+math.cos(a)*rr, top.y+math.sin(a)*rr, top.z + 0.2*scale*tt - droop*tt*tt)))
        w0 = 0.30*scale
        lv=[]; lf=[]
        for i2,p in enumerate(pts):
            side = Vector((-math.sin(a), math.cos(a), 0))*(w0*(1-i2*0.22))
            lv.append(tuple(p+side)); lv.append(tuple(p-side))
        for i2 in range(len(pts)-1):
            k = i2*2
            lf.append((k,k+1,k+3,k+2))
        lm = bpy.data.meshes.new(f"Leaf{li}"); lm.from_pydata(lv,[],lf); lm.update()
        lo = bpy.data.objects.new(lm.name, lm); sc.collection.objects.link(lo)
        lm.materials.append(m_leaf)
        for p in lm.polygons: p.use_smooth=True

for (px_, py_, sc_, ro_) in [(1.4,1.0,1.0,0.3), (-1.9,0.6,0.85,2.1), (0.4,-2.2,0.92,4.0), (2.6,-0.8,0.75,1.1)]:
    make_palm(px_, py_, sc_, ro_)

# ---------- 天空（物理天空：相机看到亮天，照明只用很小一份） ----------
sc.world = bpy.data.worlds.new("W")
sc.world.use_nodes = True
wnt = sc.world.node_tree
wnt.nodes.clear()
wout = wnt.nodes.new("ShaderNodeOutputWorld"); wout.location=(600,0)
mixw = wnt.nodes.new("ShaderNodeMixShader"); mixw.location=(400,0)
lp = wnt.nodes.new("ShaderNodeLightPath"); lp.location=(150,250)
wnt.links.new(lp.outputs["Is Camera Ray"], mixw.inputs[0])
tsky = wnt.nodes.new("ShaderNodeTexSky"); tsky.location=(-500,100)
for attr, val in [("sky_type","MULTIPLE_SCATTERING"),("sun_elevation",math.radians(38)),
                  ("sun_rotation",math.radians(-140)),("sun_size",math.radians(1.0)),("altitude",15.0)]:
    try: setattr(tsky, attr, val)
    except Exception as e: print("SKY_ATTR_SKIP", attr, e)
bg_dim = wnt.nodes.new("ShaderNodeBackground"); bg_dim.location=(150,-200)
bg_dim.inputs["Strength"].default_value = 0.045
wnt.links.new(tsky.outputs["Color"], bg_dim.inputs["Color"])
bg_vis = wnt.nodes.new("ShaderNodeBackground"); bg_vis.location=(150,50)
bg_vis.inputs["Strength"].default_value = 0.55
wnt.links.new(tsky.outputs["Color"], bg_vis.inputs["Color"])
wnt.links.new(bg_dim.outputs["Background"], mixw.inputs[1])
wnt.links.new(bg_vis.outputs["Background"], mixw.inputs[2])
wnt.links.new(mixw.outputs["Shader"], wout.inputs["Surface"])

# ---------- 光 ----------
bpy.ops.object.light_add(type='SUN', location=(20,-25,30))
sun = bpy.context.object
sun.data.energy = 1.6
sun.data.angle = math.radians(1.2)
sun.data.color = (1.0, 0.97, 0.92)
sun.rotation_euler = (math.radians(38), 0, math.radians(-52))

# ---------- 相机 ----------
bpy.ops.object.camera_add(location=(12.0, -16.0, 5.6))
cam = bpy.context.object
cam.data.lens = 38
target = Vector((0, 0, 1.15))
dirv = target - cam.location
cam.rotation_euler = dirv.to_track_quat('-Z','Y').to_euler()
sc.camera = cam

sc.render.filepath = OUT
sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print("HEADLESS " + json.dumps({"ok": True, "out": OUT, "samples": SAMPLES, "res": [W,H]}))
