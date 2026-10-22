import bpy, sys, os
from mathutils import Vector
argv=sys.argv[sys.argv.index+1:] if False else []
src=sys.argv[sys.argv.index('--')+1:][0]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm=next((o for o in bpy.context.scene.objects if o.type=='ARMATURE'),None)
mesh=next((o for o in bpy.context.scene.objects if o.type=='MESH'),None)
print('[rig] armature',arm.name if arm else None,'bones',len(arm.data.bones) if arm else 0)
if arm: print('[rig] bones:',','.join(b.name for b in arm.data.bones))
print('[rig] mesh',mesh.name,'verts',len(mesh.data.vertices),'groups',len(mesh.vertex_groups))
# count weights per group
cnt=[0]*len(mesh.vertex_groups)
for v in mesh.data.vertices:
    for g in v.groups:
        if g.weight>0.01: cnt[g.group]+=1
pairs=sorted([(cnt[i],mesh.vertex_groups[i].name) for i in range(len(cnt))],reverse=True)
print('[rig] top groups',pairs[:20])
print('[rig] zero groups',[n for c,n in pairs if c==0][:20], 'count',sum(1 for c,n in pairs if c==0))
# skirt region: vertices below 0.9m with |x|<0.25? print dominant bones
from collections import Counter
c=Counter()
for v in mesh.data.vertices:
    w=mesh.matrix_world @ v.co
    if w.z<0.9 and abs(w.x)<0.30:
        best=max(v.groups,key=lambda g:g.weight,default=None)
        if best: c[mesh.vertex_groups[best.group].name]+=1
print('[rig] skirt dominant',c.most_common(12))
xs=[mesh.matrix_world @ v.co for v in mesh.data.vertices]
mn=[min(v[i] for v in xs) for i in range(3)]; mx=[max(v[i] for v in xs) for i in range(3)]
print('[rig] bounds',[round(mx[i]-mn[i],3) for i in range(3)],'min',[round(v,3) for v in mn],'max',[round(v,3) for v in mx])
