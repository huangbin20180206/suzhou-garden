import bpy, os
from mathutils import Vector
BASE=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(BASE,'out','stone-lion-female.glb'))
o=[x for x in bpy.context.scene.objects if x.type=='MESH'][0]
# glTF y-up → blender z-up：直接按世界包围盒对齐
mn=Vector((1e9,)*3); mx=Vector((-1e9,)*3)
for c in o.bound_box:
    p=o.matrix_world@Vector(c)
    for i in range(3): mn[i]=min(mn[i],p[i]); mx[i]=max(mx[i],p[i])
o.location.x-=(mn.x+mx.x)/2; o.location.y-=(mn.y+mx.y)/2; o.location.z-=mn.z
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get()
for x,y in [(0.135,-0.19),(0.15,-0.15),(0.16,-0.10),(0.18,-0.05),(0.10,-0.25),(-0.03,-0.12),(0.0,-0.2),(0.2,-0.2)]:
    hit,loc,nor,idx,ob,mat=bpy.context.scene.ray_cast(dg, Vector((x,y,2.0)), Vector((0,0,-1)))
    print(f"({x:+.2f},{y:+.2f}) -> {'z=%.3f'%loc.z if hit else 'MISS'}  {ob.name if ob else ''}")
print('BBOX', tuple(round(v,3) for v in mn), tuple(round(v,3) for v in mx))
