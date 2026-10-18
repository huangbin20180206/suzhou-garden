import bpy, math, os
from mathutils import Vector
OUT=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(n,c,r=.9):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;p=next(x for x in m.node_tree.nodes if x.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=r;return m
stone=mat('aged grey stone',(.40,.42,.42)); light=mat('worn highlights',(.49,.50,.49),.85); groove=mat('soft carved lines',(.27,.29,.28),.95); eye=mat('warm stone eyes',(.55,.51,.43),.82); floor=mat('studio',(.12,.14,.16),.95)
def move(o,c):
 for x in list(o.users_collection):x.objects.unlink(o)
 c.objects.link(o)
def sph(n,loc,sc,ma,c):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=loc);o=bpy.context.object;o.name=n;o.scale=sc;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(ma)
 for p in o.data.polygons:p.use_smooth=True
 move(o,c);return o
def box(n,loc,dims,ma,c,b=.025):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=dims;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);m=o.modifiers.new('rounded edges','BEVEL');m.width=b;m.segments=3;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=m.name);o.data.materials.append(ma);move(o,c);return o
def wire(n,pts,r,ma,c):
 d=bpy.data.curves.new(n,'CURVE');d.dimensions='3D';d.bevel_depth=r;d.bevel_resolution=2;s=d.splines.new('POLY');s.points.add(len(pts)-1)
 for p,q in zip(s.points,pts):p.co=(*q,1)
 o=bpy.data.objects.new(n,d);c.objects.link(o);d.materials.append(ma);return o
def lion(cx,kind):
 c=bpy.data.collections.new(kind);bpy.context.scene.collection.children.link(c)
 # restrained three-tier plinth
 box(kind+' base',(cx,0,.06),(.62,.52,.12),stone,c);box(kind+' lower',(cx,0,.15),(.56,.47,.08),light,c);box(kind+' top',(cx,0,.235),(.52,.44,.09),stone,c)
 # metaball body creates one rounded seated silhouette
 mb=bpy.data.metaballs.new(kind+' body');mb.resolution=.018;mb.render_resolution=.018;o=bpy.data.objects.new(kind+' body',mb);c.objects.link(o)
 def e(x,y,z,a,b,d):
  q=mb.elements.new(type='ELLIPSOID');q.co=(cx+x,y,z);q.size_x=a;q.size_y=b;q.size_z=d
 e(0,-.04,.39,.205,.18,.22);e(0,.04,.50,.195,.17,.20);e(0,.075,.63,.135,.13,.15);e(0,.10,.765,.125,.115,.12);e(0,.19,.735,.085,.075,.065);e(0,.18,.68,.08,.065,.048)
 for s in (-1,1):e(s*.12,.075,.31,.075,.13,.145);e(s*.12,.16,.19,.095,.13,.055);e(s*.15,-.10,.24,.10,.14,.11)
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o=bpy.context.object;o.data.materials.append(stone)
 for p in o.data.polygons:p.use_smooth=True
 move(o,c)
 # mane curls frame rather than cover the face
 curls=[(-.16,.84),(-.12,.91),(-.055,.945),(.04,.945),(.12,.91),(.16,.84),(-.17,.73),(.17,.73),(-.15,.62),(.15,.62)]
 for i,(x,z) in enumerate(curls):sph(kind+' mane',(cx+x,.045,z),(.042,.064,.034),light if i%3 else stone,c)
 # neutral sculpted face: round eyes, broad muzzle, closed smile
 for s in (-1,1):
  sph(kind+' brow',(cx+s*.060,.241,.852),(.050,.030,.014),stone,c)
  sph(kind+' socket',(cx+s*.058,.251,.804),(.030,.011,.024),groove,c)
  sph(kind+' eye',(cx+s*.058,.263,.804),(.018,.012,.017),stone,c)
  sph(kind+' pupil',(cx+s*.058,.274,.804),(.005,.004,.008),groove,c)
  sph(kind+' ear',(cx+s*.145,.02,.885),(.040,.034,.048),stone,c)
  sph(kind+' muzzle pad',(cx+s*.038,.270,.710),(.044,.038,.036),light,c)
 sph(kind+' nose bridge',(cx,.258,.765),(.036,.026,.035),stone,c)
 sph(kind+' nose',(cx,.282,.738),(.046,.020,.026),groove,c)
 for s in (-1,1):sph(kind+' nostril',(cx+s*.021,.302,.740),(.007,.004,.005),stone,c)
 wire(kind+' mouth',[(cx-.050,.285,.686),(cx-.025,.290,.683),(cx,.291,.682),(cx+.025,.290,.683),(cx+.050,.285,.686)],.0035,groove,c)


 bpy.ops.mesh.primitive_torus_add(major_radius=.125,minor_radius=.01,major_segments=24,minor_segments=8,location=(cx,.02,.50),rotation=(math.pi/2,0,0));o=bpy.context.object;o.data.materials.append(light);move(o,c)
 sph(kind+' pendant',(cx,.095,.43),(.022,.016,.03),light,c)
 wire(kind+' tail',[(cx+.12,-.15,.32),(cx+.20,-.20,.38),(cx+.22,-.20,.46),(cx+.17,-.18,.51)],.018,stone,c)
 if kind=='male':
  bx=cx+.19;by=.23;bz=.405;sph('ball',(bx,by,bz),(.075,.075,.075),stone,c)
 else:
  sph('cub body',(cx-.18,.225,.385),(.067,.084,.05),stone,c);sph('cub head',(cx-.195,.278,.438),(.046,.042,.043),light,c);sph('paw on cub',(cx-.115,.18,.426),(.05,.06,.03),stone,c)
lion(-.37,'male');lion(.37,'female')
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.005));bpy.context.object.data.materials.append(floor)
sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=20;sc.render.resolution_x=1280;sc.render.resolution_y=960;sc.render.image_settings.file_format='PNG';sc.view_settings.view_transform='AgX'
sc.world=bpy.data.worlds.new('soft world');sc.world.use_nodes=True;sc.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.48,.51,.54,1);sc.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.72
cd=bpy.data.cameras.new('cam');cam=bpy.data.objects.new('cam',cd);bpy.context.collection.objects.link(cam);sc.camera=cam;cd.lens=55
def aim(t):cam.rotation_euler=(Vector(t)-cam.location).to_track_quat('-Z','Y').to_euler()
for nm,loc,power,size in [('key',(0,3.2,3.4),850,3.0),('fill',(3,1.0,2.5),360,3.5),('rim',(-3,-1.2,3.0),420,2.5)]:
 d=bpy.data.lights.new(nm,'AREA');d.energy=power;d.shape='DISK';d.size=size
 o=bpy.data.objects.new(nm,d);bpy.context.collection.objects.link(o);o.location=loc;aim((0,0,.53))
for n,loc,t,lens in [('v9-pair-front',(0,3.5,1.55),(0,.05,.53),55),('v9-pair-threequarter',(2.25,3.2,1.55),(0,.05,.53),55),('v9-male-close',(-.37,2.1,1.03),(-.37,.11,.72),75),('v9-female-close',(.37,2.1,1.03),(.37,.11,.72),75)]:
 cam.location=loc;cd.lens=lens;aim(t);sc.render.filepath=os.path.join(OUT,n+'.png');bpy.ops.render.render(write_still=True);print('RENDER_OK',n,os.path.getsize(sc.render.filepath))
print('Candidate only; live assets unchanged.')

