import bpy, sys, os, math
from mathutils import Vector
src=sys.argv[sys.argv.index('--')+1:][0]; outdir=os.path.dirname(src)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
for o in list(bpy.context.scene.objects):
    if o.type=='MESH' and o is not mesh: bpy.data.objects.remove(o, do_unlink=True)
w=bpy.data.worlds.new('W'); bpy.context.scene.world=w; w.use_nodes=True
w.node_tree.nodes['Background'].inputs[0].default_value=(0.06,0.065,0.07,1); w.node_tree.nodes['Background'].inputs[1].default_value=0.8
def lamp(name,loc,e,s):
    d=bpy.data.lights.new(name,'AREA'); d.energy=e; d.size=s
    o=bpy.data.objects.new(name,d); bpy.context.scene.collection.objects.link(o); o.location=loc
    o.rotation_euler=(Vector((0,0,1.1))-Vector(loc)).to_track_quat('-Z','Y').to_euler()
lamp('key',(2,-3,3),600,3); lamp('fill',(-3,-2,1.5),250,4); lamp('rim',(0,3,3),400,3)
cd=bpy.data.cameras.new('C'); cam=bpy.data.objects.new('C',cd); bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera=cam
cd.type='ORTHO'; cd.ortho_scale=2.3; cam.location=(0,-6,0.9); cam.rotation_euler=(math.radians(90),0,0)
bpy.context.scene.render.resolution_x=640; bpy.context.scene.render.resolution_y=800
try: bpy.context.scene.render.engine='BLENDER_EEVEE_NEXT'
except Exception: pass
def setrot(name,axis,val):
    pb=arm.pose.bones.get(name); pb.rotation_mode='XYZ'; pb.rotation_euler=(0,0,0); pb.rotation_euler[axis]=val
for tag, vals in [
  ('Xneg', {'LeftUpperArm':(0,-0.8),'RightUpperArm':(0,-0.8)}),
  ('YmirrorA', {'LeftUpperArm':(1,0.8),'RightUpperArm':(1,-0.8)}),
  ('YmirrorB', {'LeftUpperArm':(1,-0.8),'RightUpperArm':(1,0.8)}),
]:
    for n,(ax,v) in vals.items(): setrot(n,ax,v)
    bpy.context.view_layer.update()
    bpy.context.scene.render.filepath=os.path.join(outdir,'pose_%s.png'%tag)
    bpy.ops.render.render(write_still=True); print('RENDER',tag)
