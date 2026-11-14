import bpy
import bmesh
import math
from mathutils import Vector

def clear_existing_lions():
    """清理场景中已有的石狮集合"""
    if "Chinese_Stone_Lions" in bpy.data.collections:
        coll = bpy.data.collections["Chinese_Stone_Lions"]
        for obj in list(coll.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(coll)

def create_weathered_bluestone_material():
    """创建写实中式风化青石（含雕刻凹槽积灰与边缘磨损）PBR程序化材质"""
    mat_name = "M_Chinese_Weathered_Bluestone"
    if mat_name in bpy.data.materials:
        return bpy.data.materials[mat_name]
    
    mat = bpy.data.materials.new(name=mat_name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    
    # 核心输出与着色器（兼容 Blender 5.2 Principled BSDF）
    node_out = nodes.new(type='ShaderNodeOutputMaterial')
    node_out.location = (800, 0)
    
    node_bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    node_bsdf.location = (450, 0)
    node_bsdf.inputs['Roughness'].default_value = 0.78
    if 'IOR' in node_bsdf.inputs:
        node_bsdf.inputs['IOR'].default_value = 1.52
    
    # 纹理坐标与映射
    node_tex_coord = nodes.new(type='ShaderNodeTexCoord')
    node_tex_coord.location = (-900, 0)
    
    node_mapping = nodes.new(type='ShaderNodeMapping')
    node_mapping.location = (-700, 0)
    node_mapping.inputs['Scale'].default_value = (4.0, 4.0, 4.0)
    
    # 1. 石材基底噪波（模拟青石颗粒与斑驳色差）
    node_noise_base = nodes.new(type='ShaderNodeTexNoise')
    node_noise_base.location = (-450, 250)
    node_noise_base.inputs['Scale'].default_value = 18.0
    node_noise_base.inputs['Detail'].default_value = 12.0
    node_noise_base.inputs['Roughness'].default_value = 0.65
    
    # 2. 沃罗诺伊纹理（模拟石材晶粒与凿痕裂隙）
    node_voronoi = nodes.new(type='ShaderNodeTexVoronoi')
    node_voronoi.location = (-450, -50)
    node_voronoi.feature = 'DISTANCE_TO_EDGE'
    node_voronoi.inputs['Scale'].default_value = 35.0
    
    # 3. 几何节点（利用 Pointiness 提取石雕凸出边缘磨损与凹槽青苔）
    node_geom = nodes.new(type='ShaderNodeNewGeometry')
    node_geom.location = (-450, 520)
    
    node_ramp_wear = nodes.new(type='ShaderNodeValToRGB')
    node_ramp_wear.location = (-180, 520)
    node_ramp_wear.color_ramp.elements[0].position = 0.46
    node_ramp_wear.color_ramp.elements[0].color = (0.12, 0.14, 0.11, 1.0) # 深槽暗青苔灰
    node_ramp_wear.color_ramp.elements[1].position = 0.56
    node_ramp_wear.color_ramp.elements[1].color = (0.42, 0.44, 0.45, 1.0) # 边缘高光磨损白灰
    
    # 青石主色调渐变
    node_ramp_stone = nodes.new(type='ShaderNodeValToRGB')
    node_ramp_stone.location = (-180, 250)
    node_ramp_stone.color_ramp.elements[0].position = 0.25
    node_ramp_stone.color_ramp.elements[0].color = (0.18, 0.20, 0.22, 1.0) # 深青石色
    node_ramp_stone.color_ramp.elements[1].position = 0.75
    node_ramp_stone.color_ramp.elements[1].color = (0.31, 0.33, 0.35, 1.0) # 浅青灰
    
    # 混合基底石色与几何曲率磨损色
    node_mix_color = nodes.new(type='ShaderNodeMix')
    node_mix_color.data_type = 'RGBA'
    node_mix_color.blend_type = 'OVERLAY'
    node_mix_color.location = (150, 320)
    node_mix_color.inputs['Factor'].default_value = 0.65
    
    # 粗糙度映射
    node_ramp_rough = nodes.new(type='ShaderNodeValToRGB')
    node_ramp_rough.location = (-180, -50)
    node_ramp_rough.color_ramp.elements[0].position = 0.1
    node_ramp_rough.color_ramp.elements[0].color = (0.88, 0.88, 0.88, 1.0)
    node_ramp_rough.color_ramp.elements[1].position = 0.8
    node_ramp_rough.color_ramp.elements[1].color = (0.55, 0.55, 0.55, 1.0)
    
    # 凹凸节点（Bump 模拟石雕风化表面微凹凸）
    node_bump = nodes.new(type='ShaderNodeBump')
    node_bump.location = (150, -180)
    node_bump.inputs['Strength'].default_value = 0.35
    node_bump.inputs['Distance'].default_value = 0.02
    
    # 连接节点
    links.new(node_tex_coord.outputs['Object'], node_mapping.inputs['Vector'])
    links.new(node_mapping.outputs['Vector'], node_noise_base.inputs['Vector'])
    links.new(node_mapping.outputs['Vector'], node_voronoi.inputs['Vector'])
    
    links.new(node_geom.outputs['Pointiness'], node_ramp_wear.inputs['Fac'])
    links.new(node_noise_base.outputs['Fac'], node_ramp_stone.inputs['Fac'])
    
    links.new(node_ramp_stone.outputs['Color'], node_mix_color.inputs[6]) # A输入
    links.new(node_ramp_wear.outputs['Color'], node_mix_color.inputs[7])  # B输入
    links.new(node_mix_color.outputs[2], node_bsdf.inputs['Base Color'])
    
    links.new(node_noise_base.outputs['Fac'], node_ramp_rough.inputs['Fac'])
    links.new(node_ramp_rough.outputs['Color'], node_bsdf.inputs['Roughness'])
    
    links.new(node_noise_base.outputs['Fac'], node_bump.inputs['Height'])
    links.new(node_bump.outputs['Normal'], node_bsdf.inputs['Normal'])
    links.new(node_bsdf.outputs['BSDF'], node_out.inputs['Surface'])
    
    return mat

def create_sumeru_pedestal(name, location, collection, material):
    """创建高精度传统中式须弥座（包含圭角、下枋、束腰、仰覆莲瓣层、上枋）"""
    layers = [
        ("Base_Plinth",   (1.10, 1.40, 0.12), 0.06), # 地栿/圭角底层
        ("Lower_Fang",    (1.02, 1.32, 0.14), 0.19), # 下枋
        ("Lower_Lotus",   (0.96, 1.26, 0.10), 0.31), # 覆莲层
        ("Waist_Shuyao",  (0.84, 1.14, 0.16), 0.44), # 束腰（内收结构）
        ("Upper_Lotus",   (0.96, 1.26, 0.10), 0.57), # 仰莲层
        ("Upper_Fang",    (1.04, 1.34, 0.12), 0.68), # 上枋台面
    ]
    
    pedestal_objs = []
    for part_name, scale, z_offset in layers:
        bpy.ops.mesh.primitive_cube_add(
            size=1.0,
            location=(location[0], location[1], location[2] + z_offset)
        )
        obj = bpy.context.active_object
        obj.name = f"{name}_{part_name}"
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
        # 添加倒角修改器模拟石雕打磨边缘
        bevel = obj.modifiers.new(name="Stone_Bevel", type='BEVEL')
        bevel.width = 0.012
        bevel.segments = 3
        
        obj.data.materials.append(material)
        pedestal_objs.append(obj)
        
    # 合并须弥座为单一网格
    bpy.ops.object.select_all(action='DESELECT')
    for o in pedestal_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = pedestal_objs[-1]
    bpy.ops.object.join()
    pedestal = bpy.context.active_object
    pedestal.name = f"{name}_Sumeru_Pedestal"
    
    # 移入目标集合
    for coll in pedestal.users_collection:
        coll.objects.unlink(pedestal)
    collection.objects.link(pedestal)
    return pedestal

def create_stone_lion_sculpt_base(name, is_male, base_loc, collection, material):
    """创建石狮雕刻高模体块（含躯干、头部、四肢、螺发阵列、绣球/幼狮）供细分雕刻或AI重拓扑替换"""
    parts = []
    z0 = base_loc[2] + 0.74 # 须弥座顶面高度
    
    def add_part(prim_type, part_name, loc, scale, rot=(0,0,0)):
        if prim_type == 'SPHERE':
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.5, location=loc)
        elif prim_type == 'CYLINDER':
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.5, depth=1.0, location=loc)
        elif prim_type == 'CUBE':
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
        obj = bpy.context.active_object
        obj.name = f"{name}_{part_name}"
        obj.scale = scale
        obj.rotation_euler = rot
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.data.materials.append(material)
        parts.append(obj)
        return obj

    # 1. 雄壮胸腔与后臀（坐姿前倾）
    add_part('SPHERE', "Chest", (base_loc[0], base_loc[1] - 0.05, z0 + 0.58), (0.68, 0.62, 0.72), (math.radians(18), 0, 0))
    add_part('SPHERE', "Pelvis", (base_loc[0], base_loc[1] + 0.25, z0 + 0.28), (0.62, 0.58, 0.48), (math.radians(-10), 0, 0))
    
    # 2. 狮首与吻部
    head_yaw = math.radians(-8) if is_male else math.radians(8) # 双狮微向大门中轴线内顾
    add_part('SPHERE', "Head", (base_loc[0], base_loc[1] - 0.18, z0 + 1.02), (0.62, 0.58, 0.58), (0, 0, head_yaw))
    add_part('CUBE', "Snout", (base_loc[0], base_loc[1] - 0.42, z0 + 0.96), (0.38, 0.28, 0.26), (0, 0, head_yaw))
    
    # 3. 螺旋卷毛（螺发阵列在脑后与头顶生成立体石雕颗粒）
    for row in range(4):
        for col in range(7):
            angle_u = math.radians(-65 + col * 22)
            angle_v = math.radians(15 + row * 20)
            r = 0.30
            cx = base_loc[0] + r * math.sin(angle_u) * math.cos(angle_v)
            cy = base_loc[1] - 0.16 + r * math.cos(angle_u) * math.cos(angle_v) * 0.8
            cz = z0 + 1.04 + r * math.sin(angle_v)
            if cy > base_loc[1] - 0.28: # 避开正脸面部
                add_part('SPHERE', f"Curl_{row}_{col}", (cx, cy, cz), (0.11, 0.11, 0.11))

    # 4. 雄狮/雌狮差异化前爪与足下瑞物
    if is_male:
        # 雄狮：右前爪（X负方向侧）抬起踩镂空绣球，左前爪稳踏底座
        add_part('SPHERE', "Brocade_Ball", (base_loc[0] - 0.24, base_loc[1] - 0.38, z0 + 0.16), (0.32, 0.32, 0.32))
        add_part('CYLINDER', "Front_Right_Leg", (base_loc[0] - 0.24, base_loc[1] - 0.28, z0 + 0.48), (0.18, 0.18, 0.48), (math.radians(-18), 0, 0))
        add_part('CYLINDER', "Front_Left_Leg", (base_loc[0] + 0.24, base_loc[1] - 0.28, z0 + 0.36), (0.19, 0.19, 0.68))
    else:
        # 雌狮：左前爪（X正方向侧）抬起抚幼狮，右前爪稳踏底座
        add_part('SPHERE', "Cub_Body", (base_loc[0] + 0.24, base_loc[1] - 0.38, z0 + 0.13), (0.28, 0.36, 0.22), (0, math.radians(25), 0))
        add_part('SPHERE', "Cub_Head", (base_loc[0] + 0.24, base_loc[1] - 0.48, z0 + 0.24), (0.18, 0.18, 0.18))
        add_part('CYLINDER', "Front_Left_Leg", (base_loc[0] + 0.24, base_loc[1] - 0.28, z0 + 0.46), (0.18, 0.18, 0.48), (math.radians(-18), 0, 0))
        add_part('CYLINDER', "Front_Right_Leg", (base_loc[0] - 0.24, base_loc[1] - 0.28, z0 + 0.36), (0.19, 0.19, 0.68))

    # 5. 后肢蹲坐体块与卷尾
    add_part('SPHERE', "Hind_Left", (base_loc[0] + 0.28, base_loc[1] + 0.18, z0 + 0.22), (0.26, 0.42, 0.34))
    add_part('SPHERE', "Hind_Right", (base_loc[0] - 0.28, base_loc[1] + 0.18, z0 + 0.22), (0.26, 0.42, 0.34))
    add_part('CYLINDER', "Tail", (base_loc[0], base_loc[1] + 0.52, z0 + 0.42), (0.14, 0.10, 0.45), (math.radians(25), 0, 0))

    # 合并所有体块并通过 Voxel Remesh（体素重构网格）融合为无缝高模雕刻基底
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    lion_obj = bpy.context.active_object
    lion_obj.name = name
    
    # 添加体素重构修改器与置换细节，模拟石雕一体成型感
    remesh = lion_obj.modifiers.new(name="Sculpt_Voxel_Base", type='REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = 0.015
    remesh.use_smooth_shade = True
    
    for coll in lion_obj.users_collection:
        coll.objects.unlink(lion_obj)
    collection.objects.link(lion_obj)
    return lion_obj

def build_courtyard_guardian_lions():
    clear_existing_lions()
    lion_coll = bpy.data.collections.new("Chinese_Stone_Lions")
    bpy.context.scene.collection.children.link(lion_coll)
    
    stone_mat = create_weathered_bluestone_material()
    
    # 左侧雄狮（X = -1.6m，脚踏绣球）
    create_sumeru_pedestal("Male_Lion_Left", (-1.6, 0.0, 0.0), lion_coll, stone_mat)
    create_stone_lion_sculpt_base("Male_Guardian_Lion", True, (-1.6, 0.0, 0.0), lion_coll, stone_mat)
    
    # 右侧雌狮（X = +1.6m，手抚幼狮）
    create_sumeru_pedestal("Female_Lion_Right", (1.6, 0.0, 0.0), lion_coll, stone_mat)
    create_stone_lion_sculpt_base("Female_Guardian_Lion", False, (1.6, 0.0, 0.0), lion_coll, stone_mat)
    
    # 设置渲染引擎为 Cycles 以激活 Pointiness 几何风化材质
    bpy.context.scene.render.engine = 'CYCLES'
    print("传统中式庭院石狮（一公一母）基准场景与写实青石材质已在 Blender 5.2 中创建完成。")

if __name__ == "__main__":
    build_courtyard_guardian_lions()
