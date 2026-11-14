#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""prep_character.py — 人物 GLB 归一化 / 偏航 / 减面 / 重导出（Blender 5.2 headless）

用途：AI 生成的半写实人物（或 UniRig 绑骨后的结果）在进项目之前统一成项目口径：
  1 单位 = 1 米、正面 = +Z、脚底原点、身高 = --height。
规格见 docs/characters-asset-spec.md；落地清单见 research/characters/README.md。

用法（PowerShell）：
  & "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \
      --python research/characters/prep_character.py -- \
      --in  assets/fig-scholar.glb \
      --out research/characters/_stage/fig-scholar.prep.glb \
      --height 1.72

参数：
  --in       输入 .glb（只读，绝不修改/删除）
  --out      输出 .glb（会覆盖同名文件；**拒绝写到 assets/ 下**）
  --height   目标身高，米（默认 1.72）
  --yaw      绕竖直轴的偏航，**度**（默认 0；Blender 里 +Z 逆时针 = 导出后绕 glTF +Y 同向）
  --decimate 目标三角面数（可选；<=0 表示不减面）

流程（顺序即代码顺序）：
  导入 → 打印网格/材质/骨骼/动画统计 → 按包围盒归一化（缩放 + 水平居中 + 脚底 z=0）
  → 可选偏航（绕世界 Z、以脚底中心为原点）→ 可选减面（Decimate/Collapse，先移到栈首）
  → **再归一化一次**（偏航会改 AABB、减面会塌掉最外层顶点）→ 导出 GLB
  （export_yup=True, export_apply=False）。

⚠️ 本脚本**不改姿势**：A 姿势必须由生成阶段/绑骨阶段保证。
⚠️ 减面对蒙皮网格会**插值顶点权重**，减面后必须复核权重（见 prompts.md §6）。
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

TAG = '[prep]'
_SKIP_LOGGED = False


def log(*args):
    print(TAG, *args, flush=True)


def die(msg, code=2):
    print(TAG, 'ERROR:', msg, flush=True)
    sys.exit(code)


# ────────────────────────────── 参数 ──────────────────────────────
def parse_args():
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser(
        prog='prep_character.py',
        description='归一化人物 GLB：身高 / 居中 / 脚底 / 偏航 / 减面 / 重导出。',
    )
    p.add_argument('--in', dest='src', required=True, help='输入 .glb（只读）')
    p.add_argument('--out', dest='dst', required=True, help='输出 .glb')
    p.add_argument('--height', type=float, default=1.72, help='目标身高（米），默认 1.72')
    p.add_argument('--yaw', type=float, default=0.0, help='偏航角（度），默认 0')
    p.add_argument('--decimate', type=int, default=0, help='目标三角面数；<=0 不减面')
    args = p.parse_args(argv)

    if not os.path.isfile(args.src):
        die('输入文件不存在：%s' % args.src)
    if not (args.height and args.height > 0.05):
        die('--height 必须 > 0.05（米）')

    src = os.path.abspath(args.src)
    dst = os.path.abspath(args.dst)
    if src == dst:
        die('--out 与 --in 是同一个文件；本脚本不覆盖输入。')
    # 只允许新增/覆盖 research 侧的产物，绝不写进仓库资产目录
    parents = [p.lower() for p in os.path.dirname(dst).split(os.sep)]
    if 'assets' in parents:
        die('--out 不允许落在 assets/ 下（资产要人工确认后再生效）：%s' % dst)
    os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
    return args, src, dst


# ────────────────────────────── 统计 ──────────────────────────────
def meshes(visible_only=False):
    ms = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if visible_only:
        return [o for o in ms if o.visible_get()]
    return ms


def armatures():
    return [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def world_bounds():
    """可见网格的世界坐标包围盒（静止姿势 = 网格基础坐标）。

    ⚠️ 只量 `visible_get()` 为真的网格 —— 与 Blender 的 glTF 导出器保持一致。
    2026-10-21 的实测：`assets/HorseTinker.glb` 里有一个**不在视图层**的 2m 占位球
    （粒子毛发用的 Icosphere，无材质无顶点组），它把包围盒从 1.75m 撑到 2.81m；
    导出时它被跳过，于是"归一化到 1.75m"实际只把马做到约 1.25m。
    """
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    found = False
    global _SKIP_LOGGED
    skipped = [o.name for o in meshes() if not o.visible_get()]
    for o in meshes(visible_only=True):
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            lo.x = min(lo.x, w.x); lo.y = min(lo.y, w.y); lo.z = min(lo.z, w.z)
            hi.x = max(hi.x, w.x); hi.y = max(hi.y, w.y); hi.z = max(hi.z, w.z)
            found = True
    if skipped and not _SKIP_LOGGED:
        _SKIP_LOGGED = True
        log('note: 跳过 %d 个不可见网格：%s' % (len(skipped), ', '.join(skipped[:6])))
    if not found:
        die('场景里没有可见网格顶点')
    return lo, hi


def print_stats(title):
    ms = meshes()
    total_tris = sum(tri_count(o) for o in ms)
    total_verts = sum(len(o.data.vertices) for o in ms)
    log('══ %s ══' % title)
    log('meshes: %d  verts: %d  tris: %d' % (len(ms), total_verts, total_tris))
    for o in ms:
        mats = [s.material.name if s.material else '(none)' for s in o.material_slots]
        vis = o.visible_get()
        log('  - %-28s verts=%-6d tris=%-6d mats=%s%s%s' % (
            o.name[:28], len(o.data.vertices), tri_count(o), mats,
            '  [shapeKeys]' if o.data.shape_keys else '',
            '' if vis else '  [hidden: 不导出]'))
        if vis and len(mats) == 0 and len(o.vertex_groups) == 0:
            log('    ! 无材质、无顶点组 —— 像是生成器的占位件（粒子毛球/地面片/底座），'
                '建议在 Blender 里删掉再跑')

    imgs = [im for im in bpy.data.images if im.name != 'Render Result']
    log('materials: %d  images: %d' % (len([m for m in bpy.data.materials]), len(imgs)))
    for im in imgs:
        try:
            size = '%dx%d' % (im.size[0], im.size[1])
        except Exception:
            size = '?'
        log('  · image %-24s %-10s %-6s packed=%s' % (
            im.name[:24], size, im.file_format, bool(im.packed_file)))

    arms = armatures()
    log('armatures: %d' % len(arms))
    for a in arms:
        bones = a.data.bones
        roots = [b.name for b in bones if b.parent is None]
        log('  · %-24s bones=%-3d root=%s' % (a.name[:24], len(bones), roots))
        names = [b.name for b in bones]
        log('    bone names: %s%s' % (
            ', '.join(names[:24]), ' …' if len(names) > 24 else ''))

    acts = list(bpy.data.actions)
    log('animations (actions): %d' % len(acts))
    for a in acts:
        try:
            fr = a.frame_range
            rng = '%.1f..%.1f' % (fr[0], fr[1])
        except Exception:
            rng = '?'
        log('  · %-28s frames=%s' % (a.name[:28], rng))

    lo, hi = world_bounds()
    size = hi - lo
    log('bounds: min=(%.4f, %.4f, %.4f) max=(%.4f, %.4f, %.4f)' % (
        lo.x, lo.y, lo.z, hi.x, hi.y, hi.z))
    log('size:   x=%.4f  y=%.4f  z=%.4f  (height=%.4f)' % (size.x, size.y, size.z, size.z))
    return total_tris, lo, hi


# ────────────────────────────── 变换 ──────────────────────────────
def root_objects():
    """没有父级的 MESH/ARMATURE/EMPTY —— 只动它们，蒙皮关系不动。"""
    out = [o for o in bpy.context.scene.objects
           if o.parent is None and o.type in {'MESH', 'ARMATURE', 'EMPTY'}]
    if not out:
        die('找不到根对象（可能全被父级串在一起），无法归一化')
    return out


def apply_world(matrix):
    """对所有根对象左乘同一个世界矩阵 —— 均匀相似变换，蒙皮/骨架关系保持不变。"""
    for o in root_objects():
        o.matrix_world = matrix @ o.matrix_world
    bpy.context.view_layer.update()


def normalize(height, label='normalize', warn=True):
    lo, hi = world_bounds()
    h = hi.z - lo.z
    if h < 1e-6:
        die('包围盒高度为 0，模型可能是空网格')
    k = height / h
    cx = (lo.x + hi.x) * 0.5
    cy = (lo.y + hi.y) * 0.5
    # p' = k*p - k*(cx, cy, minZ)
    m = Matrix.Translation((-k * cx, -k * cy, -k * lo.z)) @ Matrix.Diagonal((k, k, k, 1.0))
    apply_world(m)
    log('%s: k=%.6f (%.4fm -> %.4fm), centered on x/y, feet at z=0' % (label, k, h, height))
    if warn and (k < 0.001 or k > 1000.0):
        log('WARNING: 缩放因子异常（%.6f）—— 输入单位可能不是米' % k)
    sx = (hi.x - lo.x) * k
    sy = (hi.y - lo.y) * k
    if warn and max(sx, sy) > 1.1 * height:
        log('WARNING: 水平尺寸 %.2f x %.2f 相对身高过大 —— 模型可能自带底座/地面片/占位球，'
            '请在 Blender 里删掉再重跑' % (sx, sy))


def yaw(deg):
    if abs(deg) < 1e-9:
        return
    m = Matrix.Rotation(math.radians(deg), 4, 'Z')
    apply_world(m)
    log('yaw: %.1f° (about world Z, pivot = feet center)' % deg)


# ────────────────────────────── 减面 ──────────────────────────────
def decimate(target_tris):
    ms = [o for o in meshes(visible_only=True) if len(o.data.vertices) > 0]
    before = sum(tri_count(o) for o in ms)
    if target_tris <= 0:
        return
    if target_tris >= before:
        log('decimate: skipped (target %d >= current %d)' % (target_tris, before))
        return
    ratio = target_tris / float(before)
    log('decimate: %d → %d tris (global ratio %.4f)' % (before, target_tris, ratio))
    for o in ms:
        if o.data.shape_keys:
            log('  ! %s 有 shape keys，跳过减面' % o.name)
            continue
        name = 'prep_decimate'
        mod = o.modifiers.new(name=name, type='DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        try:
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            # ⚠️ 必须挪到栈首：Decimate 若排在 Armature 之后，apply 会把**当前姿势**
            # 烘进基础网格（人形会被摆成半蹲/歪斜且不可逆）。
            with bpy.context.temp_override(object=o, active_object=o,
                                           selected_objects=[o],
                                           selected_editable_objects=[o]):
                bpy.ops.object.modifier_move_to_index(modifier=name, index=0)
                bpy.ops.object.modifier_apply(modifier=name)
        except Exception as e:  # noqa: BLE001 - 单个网格失败不该中断整批
            log('  ! %s 减面失败（%s），已移除该修改器' % (o.name, e))
            try:
                o.modifiers.remove(mod)
            except Exception:
                pass
    after = sum(tri_count(o) for o in ms)
    log('decimate: done, now %d tris (Δ %+d)' % (after, after - before))


# ────────────────────────────── 导出 ──────────────────────────────
def export_glb(dst):
    kw = dict(
        filepath=dst,
        export_format='GLB',
        export_apply=False,          # 规格要求：不应用修改器
        export_yup=True,             # Blender Z-up → glTF Y-up
        export_skins=True,
        export_animations=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_draco_mesh_compression_enable=False,   # 项目离线环境解不了 Draco
        export_image_format='WEBP',
        export_image_quality=90,
    )
    # 不同大版本的 gltf 导出器会增删关键字 —— 按操作符自带的 RNA 属性过滤
    try:
        props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
        kw = {k: v for k, v in kw.items() if k in props or k == 'filepath'}
    except Exception:
        pass
    log('export: %s' % ', '.join(sorted(kw.keys())))
    bpy.ops.export_scene.gltf(**kw)
    if not os.path.isfile(dst):
        die('导出失败：%s 不存在' % dst)
    log('OUT %s  (%.1f KB)' % (dst, os.path.getsize(dst) / 1024.0))


# ────────────────────────────── 主流程 ──────────────────────────────
def main():
    args, src, dst = parse_args()
    log('in : %s (%.1f KB)' % (src, os.path.getsize(src) / 1024.0))
    log('out: %s' % dst)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    total_tris, lo, hi = print_stats('imported')

    normalize(args.height, 'normalize')
    yaw(args.yaw)
    decimate(args.decimate)
    # 偏航会改变 AABB（长条形的包围盒随转角变），减面会塌掉最外层的顶点
    # ⇒ 最后再落一遍不变量，保证导出的东西严格满足"身高 / 居中 / 脚底=0"。
    normalize(args.height, 'finalize', warn=False)

    log('── final ──')
    lo2, hi2 = world_bounds()
    log('height=%.4f  feet z=%.4f  center x=%.4f  y=%.4f  yaw=%.1f°' % (
        hi2.z - lo2.z, lo2.z, (lo2.x + hi2.x) * 0.5, (lo2.y + hi2.y) * 0.5, args.yaw))

    export_glb(dst)
    log('done（输入文件未改动）')


if __name__ == '__main__':
    main()
