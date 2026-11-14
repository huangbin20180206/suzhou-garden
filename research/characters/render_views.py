import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
path = argv[0]
outdir = argv[1] if len(argv)>1 else os.path.dirname(path)
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
mins=Vector((1e9,1e9,1e9)); maxs=Vector((-1e9,-1e9,-1e9))
for o in objs:
    for c in o.bound_box:
        w=o.matrix_world @ Vector(c)
        for i in range(3):
            mins[i]=min(mins[i],w[i]); maxs[i]=max(maxs[i],w[i])
ctr=(mins+maxs)/2; size=maxs-mins
H=max(size.z,0.1); W=max(size.x,size.y,H*0.55)

# world
world=bpy.data.worlds.new('W'); bpy.context.scene.world=world
world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(0.055,0.06,0.07,1)
world.node_tree.nodes['Background'].inputs[1].default_value=0.6

# key / fill / rim
def lamp(name, loc, energy, size, color=(1,1,1)):
    d=bpy.data.lights.new(name,'AREA'); d.energy=energy; d.size=size; d.color=color
    o=bpy.data.objects.new(name,d); bpy.context.scene.collection.objects.link(o)
    o.location=loc
    o.rotation_euler=(0,0,0)
    # aim at center
    dirv=ctr-Vector(loc); o.rotation_euler=dirv.to_track_quat('-Z','Y').to_euler()
    return o
lamp('key', (ctr.x+2.2, ctr.y-3.0, ctr.z+2.6), 700, 3.0, (1.0,0.97,0.92))
lamp('fill', (ctr.x-3.0, ctr.y-1.5, ctr.z+1.2), 320, 4.0, (0.85,0.92,1.0))
lamp('rim', (ctr.x+0.5, ctr.y+3.2, ctr.z+2.8), 500, 3.0, (1.0,0.95,0.88))

cam_data=bpy.data.cameras.new('Cam'); cam=bpy.data.objects.new('Cam',cam_data)
bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera=cam
cam_data.type='ORTHO'; cam_data.ortho_scale=max(H*1.15, W*1.25)
bpy.context.scene.render.resolution_x=640; bpy.context.scene.render.resolution_y=900
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.film_transparent=False
try: bpy.context.scene.render.engine='BLENDER_EEVEE_NEXT'
except Exception: pass
bpy.context.scene.view_settings.view_transform='Filmic' if 'Filmic' in [v.name for v in bpy.context.scene.view_settings.bl_rna.properties['view_transform'].enum_items] else bpy.context.scene.view_settings.view_transform

def shot(name, dirv):
    d=Vector(dirv).normalized()
    cam.location=ctr + d*max(6,H*4)
    cam.rotation_euler=(ctr-cam.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.render.filepath=os.path.join(outdir,name+'.png')
    bpy.ops.render.render(write_still=True)
    print('RENDER',name,bpy.context.scene.render.filepath)

shot('front',(0,-1,0.06))
shot('side',(1,-0.05,0.06))
shot('back',(0,1,0.06))
shot('threequarter',(1,-1,0.14))
print('DONE', len(objs), 'meshes', tuple(round(v,3) for v in size))
