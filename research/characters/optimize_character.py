import bpy, sys, os
argv=sys.argv[sys.argv.index('--')+1:]
src,out,size = argv[0], argv[1], int(argv[2]) if len(argv)>2 else 1024
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.context.scene.objects:
    if o.type=='ARMATURE':
        for pb in o.pose.bones: pb.custom_shape=None
for o in list(bpy.context.scene.objects):
    if o.type=='MESH' and not any(m.type=='ARMATURE' for m in o.modifiers):
        print('[opt] remove stray mesh',o.name)
        bpy.data.objects.remove(o, do_unlink=True)
for im in bpy.data.images:
    if im.size[0]>size or im.size[1]>size:
        print('[opt] resize',im.name,im.size[:],'->',size)
        im.scale(size,size); im.pack()
print('[opt] scene objects',[(o.name,o.type) for o in bpy.context.scene.objects])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_apply=False, export_animations=False, export_skins=True,
    export_image_format='AUTO', export_jpeg_quality=85)
print('[opt] wrote',out,'bytes',os.path.getsize(out))
