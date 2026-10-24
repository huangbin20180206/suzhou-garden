# 生成提示词与绑骨注意事项（可直接粘贴）

> 配套文档：`docs/characters-asset-spec.md`（规格与预算）、`research/characters/README.md`（落地清单）。
>
> **前提**：本会话（2026-10-21）的工具清单里**没有** `generate_3d_model` / `unirig_rig`。
> 下面的提示词是**备好的**，不是"已经生成过"的记录。等 TJGenerators 挂上再执行。

## 0. 建议的调用参数（先按这个跑，再调）

```
generate_3d_model(
  mode        = "text_to_model"   # 或 "multiview_to_model"（推荐，见 §5）
  provider    = "rodin"
  tier        = "Gen-2.5-Medium"  # 人物细节不够再升 High
  face_limit  = 12000             # 文士 12k / 仕女 14k / 马夫 9k / 孩童 10k
  pbr         = true
  texture_quality = "standard"
  with_fbx    = false
  export_uv   = true
)
unirig_rig(engine = "unirig", model_url = <上一步的 glb>)
```

- **不要 MIA**：MIA 给的是 Mixamo 22 骨 + T 姿势，与本项目 30~45 骨 / A 姿势冲突。
- 生成完先跑 `node research/characters/validate_glb.mjs <file>.glb`（此时 `skins=0` 是正常的），
  确认面数/UV/法线在预算内，再送绑骨。
- Rodin 的 `Gen-2.5-Extreme-Low` 档出过快但形态偏软；人物**建议 Medium 起**（2026-10-03 低档
  鹦鹉只读出一条红的事实仍然成立）。

---

## 1. 文士 · Scholar

```
A single adult Chinese scholar of the Ming dynasty, late twenties, standing in a relaxed A-pose,
full body from head to shoes, facing the viewer (front is +Z). He wears a long pale indigo-blue
changshan robe with a crossed collar (jiaoling youren), wide sleeves that taper to the wrist,
off-white cloth trim along the collar edge and the hem, a dark navy sash tied at the waist with a
small knot in front, and black cloth shoes. The robe hem stops 3 cm above the ground. Hair is combed
up into a topknot bun covered by a small black silk cap (wangjin); a short hairpin is allowed but
must be attached to the head, not floating. Slim upright build, shoulders 3 head-widths wide, arms
held about 45 degrees away from the body with palms facing inward, feet shoulder-width apart and
flat on the ground, knees straight.

Stylized semi-realistic low-poly game character: about 12000 triangles, clean silhouette, smooth
shading with low-density topology, quads preferred, no interior geometry, no overlapping shells.
Hand-painted 1K texture atlas: matte woven cloth with low-frequency ink-wash folds, gongbi
light-color palette (muted indigo, warm off-white, dark navy), soft diffuse shading, no specular
highlights, no sheen, no metallic parts. The face is painted on the atlas with realistic proportions:
visible sclera, dark iris and pupil, a clear upper lid, defined cheekbones and jaw, hairline sitting
on the forehead, calm neutral expression. Skin is matte painted, not photoreal: no pores, no
subsurface scattering, no oily highlights.

No props at all: no fan, no book, no scroll, no brush, no teacup, no board game, no sword, no bag,
no jewelry. No base, no pedestal, no ground plane, no backdrop, no cast shadow, no text, no
watermark, no extra limbs, no duplicated head.
```

**负向提示（若接口支持 negative_prompt）**

```
T-pose, crossed arms, hands behind back, extra fingers, extra limbs, merged legs, base, pedestal,
ground plane, shadow catcher, photoreal skin, pores, subsurface scattering, glossy plastic, metal,
armor, modern clothing, hat brim, fan, umbrella, sword, text, watermark, low-poly faceted artifacts,
long neck, alien face
```

---

## 2. 仕女 · Lady

```
A single young Chinese woman of the Ming dynasty, early twenties, standing in a relaxed A-pose,
full body from head to shoes, facing the viewer (front is +Z). She wears a ruqun: a short
cross-collared jacket (ru) in pale lilac over a high-waisted long skirt in a slightly deeper tone,
with a soft silk shawl (pibo) draped over both forearms and resting flat against her back so that it
stays in contact with the body (no floating cloth). Off-white trim along the collar and cuffs, a
narrow sash at the high waist, cloth shoes with a thin sole. Hair is gathered into a high bun with a
few simple hairpins made of geometry attached to the head. Slender build, narrow shoulders (about
2.6 head-widths), arms about 45 degrees away from the body with palms facing inward, feet close
together and flat on the ground.

Stylized semi-realistic low-poly game character: about 14000 triangles, clean silhouette, smooth
low-density topology, the skirt volume built from 6 to 8 gentle vertical folds (low-frequency, no
high-frequency noise), no interior geometry. Hand-painted 1K texture atlas: matte silk and cotton,
subtle hand-painted fold shading, gongbi light-color palette (pale lilac, warm off-white, muted
plum), soft diffuse light, no gloss, no metallic. Face painted with realistic proportions on the
atlas: visible sclera, dark iris, clear upper lid, soft eyebrows, small mouth with upper and lower
lips, defined cheekbones, hairline on the forehead. Matte painted skin, not photoreal.

No hand props: no round fan, no flower basket, no bucket, no umbrella, no lantern, no jewelry
chains. No base, no pedestal, no ground plane, no backdrop, no cast shadow, no text, no watermark.
Do not make the shawl a separate floating ribbon.
```

---

## 3. 劳工 / 马夫 · Laborer (stable hand)

```
A single Chinese working man in his thirties, a stable hand, standing in a relaxed A-pose, full
body from head to shoes, facing the viewer (front is +Z). He wears a short narrow-sleeved jacket
(duanda) in ochre-brown coarse cotton over loose trousers with the cuffs tied at the ankle, a cloth
belt at the waist, a simple cloth head wrap (bujin) covering the top of the head, and cloth shoes.
Sun-tanned skin, sturdy build with broader shoulders and thicker forearms than a scholar, arms about
45 degrees away from the body with palms facing inward, feet shoulder-width apart and flat on the
ground. Clothes are slightly worn: small hand-painted patches and creases at the elbows, knees and
waist.

Stylized semi-realistic low-poly game character: about 9000 triangles, clean silhouette, smooth
low-density topology, no interior geometry. Hand-painted 1K texture atlas: matte coarse cloth with
low-frequency creases, muted earth palette (ochre, warm grey-brown, off-white), soft diffuse light,
no gloss, no metallic. Face painted with realistic proportions: visible sclera, dark iris, clear
upper lid, defined jaw, stubble suggested by a few flat grey strokes, hairline on the forehead.
Matte painted skin with a slight tan gradient, not photoreal.

No props at all: no pitchfork, no yoke, no bucket, no hay bale, no sickle, no whip, no reins, no
horse, no saddle. No base, no pedestal, no ground plane, no backdrop, no cast shadow, no text, no
watermark, no extra limbs.
```

---

## 4. 孩童 · Child

```
A single Chinese child about eight years old, standing in a relaxed A-pose, full body from head to
shoes, facing the viewer (front is +Z). Child proportions: about 5 heads tall (head height roughly
one fifth of total height), round face, larger eyes, short limbs. Wearing a short cross-collared
jacket (duanru) in vermilion-red cotton over long trousers, a narrow cloth belt, and cloth shoes.
Hair shaved at the sides with two small buns on top of the head (zongjiao), tied with dark cloth.
Arms about 45 degrees away from the body with palms facing inward, feet close together and flat on
the ground, slightly pigeon-toed.

Stylized semi-realistic low-poly game character: about 10000 triangles, clean silhouette, smooth
low-density topology, no interior geometry. Hand-painted 1K texture atlas: matte cotton with
low-frequency creases, gongbi light-color palette (vermilion red, warm off-white, dark brown), soft
diffuse light, no gloss, no metallic. Face painted with realistic child proportions: large visible
sclera, dark iris, clear upper lid, soft cheeks with a light blush, small mouth with upper and lower
lips, hairline on the forehead. Matte painted skin, not photoreal, no pores.

No props at all: no kite, no candy stick, no toy, no lantern, no book. No base, no pedestal, no
ground plane, no backdrop, no cast shadow, no text, no watermark, no extra limbs. Do not make the
child a scaled-down adult.
```

---

## 5. 更稳的路线：先生成四视图概念图，再图生 3D

文本生 3D 在"手/脚/面部"上最容易糊。若 `generate_image` 可用，先出一张**正交四视图**，
再用 `generate_3d_model(mode="multiview_to_model")` 喂 2~4 张（顺序：正面 0°、左 90°、背 180°、右 270°）。

概念图提示词模板（把 `<CHARACTER>` 换成上面 §1~§4 第一段的角色描述）：

```
Character turnaround sheet of <CHARACTER>. Four orthographic views in a row: front, left side,
back, right side. Identical proportions, identical clothing details and colors in all four views.
Relaxed A-pose with arms about 45 degrees from the body, palms facing inward. Flat neutral grey
background, even soft studio lighting, no shadows on the background, no perspective distortion.
Full body visible in every view, feet on the same baseline. Semi-realistic stylized game character
concept art, hand-painted matte cloth, gongbi light-color palette, clean readable silhouette,
about 12000 triangles worth of detail. No props, no text, no watermark.
```

⚠️ 四视图之间**必须**保持衣服细节/配色一致，否则 3D 会在接缝处糊成花斑；生成后先人眼比对
"腰带位置、衣缘宽度、袖口长度"三处是否四张一致，不一致就重出。

---

## 6. UniRig 绑骨注意事项（逐条）

1. **引擎 = `unirig`，不是 `mia`。** 理由见 §0。
2. **保留 A 姿势**。若生成件是 T 姿势：在 Blender 里选中 `upperarm.L/R`，绕局部轴下压
   ≈45°，再 `prep_character.py` 归一（脚本**不改姿势**，只做缩放/居中/偏航）。
3. **长袍/裙摆要单独裙骨**：文士 ≥4、仕女 ≥6。绑完在 Blender 里抽查裙摆顶点：
   `Object Data → Vertex Groups`，看裙摆区域的主骨是不是 `thigh/shin` —— 如果是，走路时
   裙子会跟着大腿整片翻，必须补裙骨并重分配权重。
4. **手指可省略**。省 10 根骨，权重更稳；低模手指在默认机位只有几像素。
5. **骨名不可猜**。UniRig 可能输出 `Bone_001` 一类名字。接入 JS 前先读
   `skinIndex`/`skinWeight` 的主骨名（马那次"按 DEF- 猜骨"导致六项动作全空转、画面完全看不出错）。
   建议绑完在 Blender 里把每根骨的"驱动顶点数"打印一遍（`prep_character.py` 的统计里没有
   这一项，需另跑一段 `bpy` 脚本）。
6. **不要烘焙动画**：`animations` 应为 0。动作由 JS 程序化驱动（P0 的马步态那套），
   烘焙的 clip 会和程序化驱动互相打架。
7. **输出检查**：
   ```
   node research/characters/validate_glb.mjs <rigged>.glb --require-skin
   ```
   期望 `skins=1`、`joints 30~45`、`animations=0`、三角面不变（UniRig 不该改几何）。
8. **绑骨后立刻做拉伸测试**：`hips` 抬 0.10m、`thigh.L/R` 各转 20°、`upperarm` 抬 60°，
   出四张图看裙摆/披帛/腋下有没有撕开。撕开就重绑，别带进 JS。

---

## 7. 生成阶段的三条"别做"

- **不要**让模型自带衣物动态（披帛飘带、飘带片、布条）：glTF 里它们是静态片，绑骨后必被撕开。
- **不要**为了"真实"加胡须/发丝/流苏等**细长悬空件**：低模 + 1K 图集下它们只会变成噪点，
  且绑骨权重几乎必错。
- **不要**要求"照片级皮肤/毛孔/次表面散射"：本项目画风是工笔淡彩，照片级皮肤会和整个场景
  打架（对照：马丢掉 UV 图集、改程序细毛之后才不"像蜡像"）。

---

## 8. 客人（Guest，2026-10-23 · P4 第五个角色）

> 记录**实际用掉的那份 prompt**（Rodin Gen-2.5-Medium，face_limit 12000，pbr=true，
> export_uv=true，with_fbx=false）。与文士刻意区分：文士=靛蓝长衫+网巾+清瘦，
> 客人=灰褐直裰+东坡巾+短须+略壮 —— 同一场景里不能读成"同一个人换了个颜色"。

```
A single middle-aged Chinese visitor (guest) of the Ming dynasty, about forty-five years old,
standing in a relaxed A-pose, full body from head to shoes, facing the viewer (front is +Z).
He wears a long muted grey-brown zhiduo robe with a crossed collar (jiaoling youren), wide
sleeves that taper to the wrist, a broad dark brown fabric belt (dabu) knotted at the waist,
and dark cloth shoes. The robe hem stops 3 cm above the ground. On his head is a soft black
Dongpo scarf (dongpo jin) with a slightly folded back; a trimmed short black beard and moustache.
Slightly heavier build than a young scholar, shoulders 3 head-widths wide, arms held about 45
degrees away from the body with palms facing inward, feet shoulder-width apart and flat on the
ground, knees straight.

Stylized semi-realistic low-poly game character: about 12000 triangles, clean silhouette, smooth
shading with low-density topology, quads preferred, no interior geometry, no overlapping shells.
Hand-painted 1K texture atlas: matte woven cloth with low-frequency ink-wash folds, gongbi
light-color palette (muted grey-brown, warm off-white, dark brown), soft diffuse shading, no
specular highlights, no sheen, no metallic parts. The face is painted on the atlas with realistic
proportions: visible eye whites, dark iris and pupil, defined eyebrows, natural nose and mouth,
a short beard painted as flat colour. No base, no ground plane, no shadow, no props in his hands.
```

### 8.1 与前三件不同的两步（都踩过）

1. **必须先 `prep_character.py` 再绑骨**。原始生成件脚底在 z=−0.947、整体是**居中**的
   （bounds 1.37×0.54×1.90，y∈[−0.947, 0.948]）。直接丢给 UniRig，回来的骨架是按
   "归一化到 0~1 的小人"摆的：`Hips` 在 **z=0.027**、`Spine` 0.123 —— 整副骨架缩在脚底，
   网格与骨骼完全不贴合（`add_skirt_bones.py` 当场报 `hip z=0.027 hem z=0.120`、
   `reweighted=0`，那就是"骨头没落在衣服上"的可量化信号）。
   跑过 `--height 1.70` 之后 `Hips` 回到 **z=0.873**，裙骨 `reweighted=1698`。
2. **UniRig 的输出里带一个 `Icosphere`**（2×2×2、原点居中），它是绑骨工具的自带件。
   `optimize_character.py` 会把它删掉（判据 = "没有 ARMATURE 修改器的网格"），
   不删就会在场景里多出一个 2m 的白球。

### 8.2 落点

月洞门内 `(0.15, 20.9)`、`yaw=π`（面朝园内）。门内侧是**蹬石台阶**不是地形 ⇒
`floorRay: true` + `floorMax: 1.20`（吃真实踏面；按地形高度会陷进台阶）。
`route: null` —— 门口那一小片被台阶与门洞夹着，来回踱步会踩到台阶边。
