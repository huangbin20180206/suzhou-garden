# debug: which mesh drags min-z below 0
import bpy, os
from mathutils import Vector
OUT = os.path.dirname(os.path.abspath(__file__))
for f in ('stone-lion-male.glb', 'stone-lion-female.glb'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f))
    for o in bpy.data.objects:
        if o.type == 'MESH':
            zs = [(o.matrix_world @ Vector(c)).z for c in o.bound_box]
            print('%s %s minZ=%.3f maxZ=%.3f' % (f, o.name, min(zs), max(zs)))
