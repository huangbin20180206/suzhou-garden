# Blender 5.2 — Traditional Chinese guardian lion pair (high-detail procedural scene)
# Output: Chinese_Guardian_Lions_HighDetail.blend + optional OBJ export
# Usage: Blender 5.2 > Scripting > Open this file > Run Script.
# Important: this is a procedural, editable sculptural blockout with layered ornamental detail,
# not a hand-sculpted museum replica. Run inside Blender; the .blend and .obj are created there.

import bpy, math, os
from mathutils import Vector

EXPORT_OBJ = True
SAVE_BLEND = True
BLEND_FILENAME = "Chinese_Guardian_Lions_HighDetail.blend"
OBJ_FILENAME = "Chinese_Guardian_Lions_HighDetail.obj"

# ---------------- scene reset ----------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for block in list(datablocks):
        if block.users == 0:
            datablocks.remove(block)

def mat_stone(name, color, rough=0.82, noise_scale=28, bump_strength=0.12):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    n = m.node_tree.nodes
    l = m.node_tree.links
    bs = n.get("Principled BSDF")
    # 对比用补丁（原文件未动）：Blender 5.2 中文版默认节点叫"原理化 BSDF"，按类型兜底
    if bs is None:
        bs = next((x for x in n if x.type == 'BSDF_PRINCIPLED'), None)
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Roughness"].default_value = rough
    tex = n.new("ShaderNodeTexNoise"); tex.inputs["Scale"].default_value = noise_scale
    tex.inputs["Detail"].default_value = 4; tex.inputs["Roughness"].default_value = 0.72
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.18
    ramp.color_ramp.elements[0].color = (*(c*0.72 for c in color), 1)
    ramp.color_ramp.elements[1].position = 0.82
    ramp.color_ramp.elements[1].color = (*(min(1,c*1.18) for c in color), 1)
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.035
    l.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    l.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    l.new(tex.outputs["Fac"], bump.inputs["Height"])
    l.new(bump.outputs["Normal"], bs.inputs["Normal"])
    return m

STONE = mat_stone("Aged pale granite", (0.47,0.455,0.415), 0.86, 34, 0.16)
HILITE = mat_stone("Raised carved edges", (0.58,0.55,0.49), 0.8, 42, 0.10)
RECESS = mat_stone("Deep carved recess", (0.105,0.095,0.078), 0.95, 38, 0.06)
BASE = mat_stone("Plinth granite", (0.37,0.36,0.33), 0.9, 25, 0.14)
GROUND = mat_stone("Studio floor", (0.09,0.085,0.075), 0.92, 18, 0.05)

def assign(o, m):
    if o.type in {'MESH','CURVE'} and o.data.materials:
        o.data.materials.clear()
    if o.type in {'MESH','CURVE'}:
        o.data.materials.append(m)
    return o

def smooth(o):
    if o.type == 'MESH':
        for p in o.data.polygons: p.use_smooth = True
    return o

def uv(name, loc, scale, material=STONE, seg=32, rings=20, rot=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale
    if rot: o.rotation_euler=rot
    assign(o, material); smooth(o)
    return o

def bevel_cube(name, loc, dims, bevel, material=BASE):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o=bpy.context.object; o.name=name; o.dimensions=dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    b=o.modifiers.new("Hand-worn arris", 'BEVEL'); b.width=bevel; b.segments=4
    o.modifiers.new("Weighted normals", 'WEIGHTED_NORMAL')
    assign(o,material)
    return o

def tube(name, points, radius, material=STONE, cyclic=False, resolution=4):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=16
    c.bevel_depth=radius; c.bevel_resolution=resolution
    s=c.splines.new('POLY'); s.points.add(len(points)-1)
    for p,co in zip(s.points,points): p.co=(*co,1)
    s.use_cyclic_u=cyclic
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o); assign(o,material)
    return o

def torus(name, loc, major, minor, material=HILITE, rot=(math.pi/2,0,0), seg=32):
    bpy.ops.mesh.primitive_torus_add(major_segments=seg, minor_segments=12, major_radius=major, minor_radius=minor, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; assign(o,material); smooth(o); return o

def carve_line(name, pts, radius=0.012):
    return tube(name, pts, radius, RECESS, False, 2)

def rosette(name, x, y, z, r, material=HILITE):
    # Raised spiral-like mane medallion: ring, central boss, and short curved comma.
    torus(name+"_ring",(x,y,z),r*0.70,r*0.19,material)
    uv(name+"_boss",(x,y-0.02,z),(r*0.27,r*0.18,r*0.27),STONE,20,12)
    pts=[]
    for i in range(13):
        t=math.radians(35+i*22)
        rr=r*(0.55-0.025*i)
        pts.append((x+rr*math.cos(t),y-0.035,z+rr*math.sin(t)))
    tube(name+"_comma",pts,r*0.065,RECESS,False,2)

def plinth(cx, tag):
    bevel_cube(tag+"_plinth_foot",(cx,0,0.13),(1.68,1.48,0.26),0.065,BASE)
    bevel_cube(tag+"_plinth_bead",(cx,0,0.29),(1.58,1.39,0.10),0.025,HILITE)
    bevel_cube(tag+"_plinth_body",(cx,0,0.43),(1.47,1.28,0.22),0.04,BASE)
    bevel_cube(tag+"_top_cap",(cx,0,0.57),(1.57,1.37,0.10),0.03,HILITE)
    # Front recessed-looking panel with raised border and corner studs
    bevel_cube(tag+"_panel",(cx,-0.646,0.39),(0.82,0.025,0.12),0.015,RECESS)
    for sx in (-0.34,0.34):
        uv(tag+"_panel_stud",(cx+sx,-0.67,0.39),(0.035,0.018,0.035),HILITE,16,10)
    # Stylized cloud / ruyi motif on the front face
    pts=[]
    for i in range(81):
        t=2*math.pi*i/80
        pts.append((cx+0.22*math.cos(t),-0.672,0.39+0.035*math.sin(2*t)))
    tube(tag+"_ruyi_line",pts,0.009,HILITE,True,2)

def make_lion(cx, tag, male):
    plinth(cx,tag)
    # Body silhouette, broad shoulders and seated haunches
    uv(tag+"_rump",(cx,0.12,1.17),(0.50,0.44,0.54),STONE)
    uv(tag+"_torso",(cx,0.04,1.46),(0.47,0.42,0.58),STONE)
    uv(tag+"_chest",(cx,-0.25,1.57),(0.43,0.34,0.50),STONE)
    for s in (-1,1):
        uv(tag+"_haunch",(cx+s*0.34,0.06,0.91),(0.34,0.40,0.39),STONE)
        # Forelegs taper subtly toward the paw
        uv(tag+"_foreleg",(cx+s*0.255,-0.32,1.08),(0.185,0.235,0.43),STONE,rot=(s*0.08,0,0))
        uv(tag+"_paw",(cx+s*0.255,-0.49,0.72),(0.235,0.30,0.155),STONE)
        # toe grooves as fine incised lines
        for k in (-1,0,1):
            carve_line(tag+"_toe",[(cx+s*0.255+k*0.09,-0.773,0.675),
                                   (cx+s*0.255+k*0.085,-0.776,0.715),
                                   (cx+s*0.255+k*0.07,-0.755,0.755)],0.009)
    # Mane collar and head
    uv(tag+"_mane_core",(cx,-0.19,2.04),(0.59,0.40,0.57),STONE,40,28)
    uv(tag+"_head",(cx,-0.48,2.18),(0.395,0.30,0.385),STONE,40,28)
    # Muzzle bridge, nose pad, muzzle lobes, chin
    uv(tag+"_nose_bridge",(cx,-0.70,2.13),(0.15,0.13,0.20),HILITE)
    uv(tag+"_nose",(cx,-0.817,2.105),(0.12,0.085,0.078),RECESS)
    for s in (-1,1):
        uv(tag+"_muzzle",(cx+s*0.095,-0.79,2.045),(0.13,0.105,0.095),HILITE)
        uv(tag+"_cheek",(cx+s*0.285,-0.65,2.10),(0.18,0.16,0.21),STONE)
        uv(tag+"_brow",(cx+s*0.16,-0.735,2.315),(0.18,0.085,0.095),HILITE,24,16,rot=(0,s*0.10,s*0.08))
        uv(tag+"_socket",(cx+s*0.155,-0.758,2.235),(0.083,0.032,0.061),RECESS,20,12)
        uv(tag+"_eyeball",(cx+s*0.155,-0.783,2.236),(0.046,0.021,0.038),HILITE,20,12)
        uv(tag+"_pupil",(cx+s*0.155,-0.802,2.236),(0.017,0.012,0.026),RECESS,12,8)
        # Ears and inner cavities
        uv(tag+"_ear",(cx+s*0.365,-0.41,2.47),(0.13,0.12,0.15),STONE,24,16,rot=(0,s*0.22,s*0.18))
        uv(tag+"_ear_cavity",(cx+s*0.365,-0.508,2.475),(0.058,0.022,0.076),RECESS,20,12)
        # Whisker pads and carved cheek curls
        rosette(tag+"_cheek_curl_"+str(s),cx+s*0.30,-0.795,1.99,0.075)
    uv(tag+"_chin",(cx,-0.72,1.91),(0.19,0.12,0.085),STONE)
    carve_line(tag+"_mouth",[(cx-0.17,-0.89,2.00),(cx-0.10,-0.90,1.975),(cx,-0.902,1.968),(cx+0.10,-0.90,1.975),(cx+0.17,-0.89,2.00)],0.012)
    # Nasolabial curves and forehead emblem
    for s in (-1,1):
        carve_line(tag+"_nasolabial",[(cx+s*0.06,-0.887,2.03),(cx+s*0.10,-0.89,2.00),(cx+s*0.16,-0.87,1.99)],0.008)
    torus(tag+"_forehead_emblem",(cx,-0.78,2.405),0.065,0.012,HILITE)
    uv(tag+"_forehead_boss",(cx,-0.80,2.405),(0.027,0.016,0.027),RECESS,16,10)
    # Dense layered mane curls around crown, cheeks, neck and shoulders
    mane_rows=[
        (2.50,5,0.080,-0.49),
        (2.36,6,0.082,-0.58),
        (2.20,7,0.080,-0.60),
        (2.02,7,0.085,-0.57),
        (1.84,6,0.090,-0.50),
        (1.67,5,0.095,-0.43)
    ]
    for row,(z,count,r,y) in enumerate(mane_rows):
        for i in range(count):
            x=cx+(i-(count-1)/2)*0.155
            # Keep central face visible; curls sit mostly at the sides and outer mane
            if row <= 2 and abs(x-cx)<0.16:
                continue
            rosette(f"{tag}_mane_r{row}_c{i}",x,y,z,r,HILITE if (i+row)%3 else STONE)
    # Shoulder tufts
    for s in (-1,1):
        for j in range(3):
            uv(tag+"_shoulder_tuft",(cx+s*(0.39+j*0.035),-0.32,1.62-j*0.13),
               (0.13,0.13,0.17),STONE,20,12,rot=(0,s*0.25,s*0.28))
    # Necklace, pendant and beadwork
    torus(tag+"_collar",(cx,-0.48,1.68),0.285,0.032,HILITE)
    for i in range(9):
        a=math.radians(205+i*16.25)
        uv(tag+"_collar_bead",(cx+0.285*math.cos(a),-0.49,1.68+0.285*math.sin(a)),
           (0.027,0.025,0.027),HILITE,12,8)
    uv(tag+"_pendant",(cx,-0.535,1.39),(0.105,0.065,0.145),HILITE)
    torus(tag+"_pendant_ring",(cx,-0.585,1.47),0.048,0.012,RECESS)
    # Tail curves up behind body, visible from 3/4 view
    tube(tag+"_tail",[(cx+0.35,0.23,1.08),(cx+0.56,0.28,1.19),(cx+0.68,0.29,1.38),
                      (cx+0.65,0.27,1.57),(cx+0.51,0.25,1.67)],0.052,STONE,False,5)
    rosette(tag+"_tail_tuft",cx+0.49,0.20,1.67,0.10,HILITE)

    if male:
        # Male lion: paw and ornate brocade ball on viewer-right
        uv(tag+"_embroidered_ball",(cx+0.43,-0.53,0.91),(0.19,0.19,0.19),STONE,32,20)
        torus(tag+"_ball_equator",(cx+0.43,-0.70,0.91),0.155,0.014,HILITE)
        for ang in (0,math.pi/3,2*math.pi/3):
            pts=[]
            for j in range(41):
                t=2*math.pi*j/40
                pts.append((cx+0.43+0.19*math.cos(t)*math.cos(ang),
                            -0.53+0.19*math.sin(t)*0.40,
                            0.91+0.19*math.sin(t)*math.sin(ang)))
            tube(tag+"_ball_lattice",pts,0.008,HILITE,True,2)
        uv(tag+"_ball_center",(cx+0.43,-0.715,0.91),(0.035,0.018,0.035),HILITE,16,10)
    else:
        # Female lion: cub tucked close to her paw
        uv(tag+"_cub_body",(cx-0.39,-0.46,0.91),(0.20,0.19,0.16),STONE)
        uv(tag+"_cub_head",(cx-0.40,-0.625,1.065),(0.155,0.13,0.145),STONE,28,18)
        for s in (-1,1):
            uv(tag+"_cub_ear",(cx-0.40+s*0.115,-0.64,1.17),(0.052,0.045,0.064),STONE,16,10)
            uv(tag+"_cub_eye",(cx-0.40+s*0.06,-0.746,1.085),(0.017,0.012,0.019),RECESS,12,8)
        uv(tag+"_cub_nose",(cx-0.40,-0.755,1.045),(0.027,0.018,0.021),RECESS,12,8)
        carve_line(tag+"_cub_mouth",[(cx-0.44,-0.768,1.03),(cx-0.40,-0.772,1.02),(cx-0.36,-0.768,1.03)],0.006)

# Traditional paired arrangement, front faces toward -Y.
make_lion(-1.08,"Male_Lion",True)
make_lion( 1.08,"Female_Lion",False)

# Studio ground
bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-0.025))
floor=bpy.context.object; floor.name="Studio_Ground"; assign(floor,GROUND)

# Camera / lights
bpy.ops.object.camera_add(location=(4.3,-10.7,4.15))
camera=bpy.context.object; camera.name="Render_Camera"
target=Vector((0,-0.03,1.35))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=55
bpy.context.scene.camera=camera

def area(name,loc,power,size):
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object; o.name=name; o.data.energy=power; o.data.shape='DISK'; o.data.size=size
    o.rotation_euler=(Vector((0,0,1.3))-o.location).to_track_quat('-Z','Y').to_euler()
area("Key_Large_Softbox",(0,-4.8,6.2),1000,5.0)
area("Fill_Softbox",(-4,-1.2,3.4),600,4.0)
area("Rim_Light",(3,2.5,4.8),1300,3.0)

scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.render.resolution_x=1600; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=os.path.join(os.path.expanduser("~"),"Chinese_Guardian_Lions_preview.png")
scene.world.color=(0.12,0.12,0.12)
scene.view_settings.view_transform='AgX'

# Organize objects into collections by purpose for convenient editing.
def move_to_collection(obj, collection):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj)

root=bpy.context.scene.collection
collections={}
for cname in ["01_Male_Lion","02_Female_Lion","03_Studio"]:
    col=bpy.data.collections.new(cname); root.children.link(col); collections[cname]=col
for obj in list(bpy.context.scene.objects):
    if obj.name.startswith("Male_Lion"):
        move_to_collection(obj,collections["01_Male_Lion"])
    elif obj.name.startswith("Female_Lion"):
        move_to_collection(obj,collections["02_Female_Lion"])
    else:
        move_to_collection(obj,collections["03_Studio"])

# Save files beside the current .blend; if unsaved, use user's home directory.
base_dir=bpy.path.abspath("//")
if not base_dir or base_dir=="//":
    base_dir=os.path.expanduser("~")
blend_path=os.path.join(base_dir,BLEND_FILENAME)
if SAVE_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print("Saved:",blend_path)

# Export selected statue mesh objects to OBJ; keep curves as curves in the scene,
# but convert a temporary duplicate set to meshes for broad OBJ compatibility.
if EXPORT_OBJ:
    bpy.ops.object.select_all(action='DESELECT')
    export_objs=[]
    for obj in bpy.context.scene.objects:
        if obj.name.startswith(("Male_Lion","Female_Lion")):
            obj.select_set(True); export_objs.append(obj)
    if export_objs:
        bpy.context.view_layer.objects.active=export_objs[0]
        # Blender 5.2 OBJ exporter operator is used if available.
        try:
            bpy.ops.wm.obj_export(filepath=os.path.join(base_dir,OBJ_FILENAME),
                                  export_selected_objects=True,
                                  export_materials=True)
            print("Exported OBJ:",os.path.join(base_dir,OBJ_FILENAME))
        except Exception as e:
            print("OBJ export did not run. Enable the Wavefront OBJ I/O extension or export manually:",repr(e))

print("Build complete. Model is editable; for a unified printable mesh, duplicate the lion collection and use Voxel Remesh.")
