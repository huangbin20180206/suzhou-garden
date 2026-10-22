import bpy, sys, os
argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, use_anim=False)
arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
print('[fbx] armatures', len(arms), 'meshes', len(meshes))
for a in arms:
    print('[fbx] armature', a.name, 'bones', len(a.data.bones))
    print('[fbx] bone names:', ','.join(b.name for b in a.data.bones))
for m in meshes:
    print('[fbx] mesh', m.name, 'verts', len(m.data.vertices), 'groups', len(m.vertex_groups), 'mods', [x.type for x in m.modifiers], 'mats', [x.name for x in m.data.materials])
    xs=[m.matrix_world @ v.co for v in m.data.vertices]
    if xs:
        mn=[min(v[i] for v in xs) for i in range(3)]; mx=[max(v[i] for v in xs) for i in range(3)]
        print('[fbx] bounds', [round(mx[i]-mn[i],3) for i in range(3)], 'min', [round(v,3) for v in mn], 'max', [round(v,3) for v in mx])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=False, export_animations=False, export_skins=True, export_morph=False)
print('[fbx] wrote', out)
