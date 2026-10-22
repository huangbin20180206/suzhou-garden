import bpy
src=r"E:\ai_test\codex_test\suzhou-garden\research\characters\_stage\scholar_opt.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.context.scene.objects:
    print('[obj]',o.name,o.type,'parent',o.parent.name if o.parent else None,'hide_render',o.hide_render,'hide_view',o.hide_viewport)
    if o.type=='MESH':
        from mathutils import Vector
        xs=[o.matrix_world @ v.co for v in o.data.vertices]
        mn=[min(v[i] for v in xs) for i in range(3)]; mx=[max(v[i] for v in xs) for i in range(3)]
        print('   mesh',len(o.data.vertices),'bounds',[round(mx[i]-mn[i],3) for i in range(3)],'min',[round(v,3) for v in mn],'mods',[m.type for m in o.modifiers])
for im in bpy.data.images:
    print('[img]',im.name,im.size[:],im.filepath,im.packed_file is not None)
