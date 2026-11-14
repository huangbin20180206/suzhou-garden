# 人物资产生成 → 接入 落地清单

> **状态（2026-10-22 更新）**：TJGenerators 已挂上并跑通全流程。已落地三件——
> 文士 `assets/fig-scholar.glb`（1.72m）、仕女 `assets/fig-lady.glb`（1.63m）、
> 马夫 `assets/fig-laborer.glb`（1.70m），全部 Rodin Gen-2.5-Medium → UniRig →
> `convert_3d_model`(fbx→glb) → `repair_hands.py` → `optimize_character.py`(1024 + JPEG)。
> 孩童 `fig-child` 还没做（提示词见 prompts.md §4）。
>
> 下面第 1~3 步的"工具没挂上"那段是当时的历史记录，留着说明**为什么**踩过这些坑；
> 实操顺序以第 4 步之后为准。

> 配套：`docs/characters-asset-spec.md`（规格/预算/骨架）、`research/characters/prompts.md`
> （可直接粘贴的英文提示词 + UniRig 注意事项）。

---

## 0. 前置：确认生成工具真的挂上了

```
/mcp list          # 看 TJGenerators 是 Connected 还是 Disconnected
/mcp reload        # Disconnected 就先 reload
```

仍不可用：完全退出 Codely 再开（或新开一个对话）。**不要删项目**、不要重建 OAuth。
工具在的时候应该能直接看到 `generate_3d_model` / `unirig_rig` 这两个名字。

---

## 1. 生成 4 个基础模型

- 规格与提示词：`docs/characters-asset-spec.md` §2、`research/characters/prompts.md` §1~§4。
- 建议参数：`provider=rodin`、`tier=Gen-2.5-Medium`、`face_limit` 按各自预算（9k~14k）、
  `pbr=true`、`with_fbx=false`、`export_uv=true`。
- 命名先落到 **`research/characters/_stage/`**（不要直接写 `assets/`）：
  `fig-scholar.raw.glb` / `fig-lady.raw.glb` / `fig-laborer.raw.glb` / `fig-child.raw.glb`。
- 更稳的路线：先出四视图概念图 → `mode="multiview_to_model"`（见 prompts.md §5）。

**出口条件**：4 个文件都在本地，单个 < 5MB（还没减面/压贴图，先别管 1.5MB 上限）。

---

## 2. 检查朝向 / 比例（Blender 里，先别绑骨）

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background `
  --python research/characters/prep_character.py -- `
  --in research/characters/_stage/fig-scholar.raw.glb `
  --out research/characters/_stage/fig-scholar.prep.glb --height 1.72
```

看脚本打印的三行：

| 打印 | 期望 | 不对怎么办 |
|---|---|---|
| `size: x=… y=… z=…` | `z` 是最大维度（人站着，高 > 宽） | `x` 或 `y` 才是最大 ⇒ 模型躺倒/朝向错，先在 Blender 里转正 |
| `WARNING: 水平尺寸 … 相对身高过大` | **不该出现** | 模型自带底座/地面片 ⇒ Blender 里删掉再跑 |
| `! 无材质、无顶点组` | **不该出现** | 生成器的占位件（粒子毛球/地面片）⇒ 删掉再跑，否则它会撑大包围盒、把身高算错 |
| `height=… feet z=0.0000` | 身高 = 目标、脚底 z≈0 | 差值 > 1mm 说明有多余几何（影子片/贴花） |

**朝向**：本项目约定 **正面 = +Z（glTF）**，对应 **Blender 里朝 −Y**（`export_yup=True` 会把
Blender `−Y` 映到 glTF `+Z`）。判断办法：Blender 里从 **−Y 方向**看过去，应该看到正脸。
看到后脑勺就是反了 ⇒ 加 `--yaw 180`。

**如果不确定朝向**，用两次导出比对：`--yaw 0` 和 `--yaw 180` 各出一份，丢进
`outputs/_diag/` 下的临时查看页（或 three 官方 editor），哪份正脸朝镜头就用哪份。
**别靠猜** —— 石狮子那次就因为"新旧资产朝向相反"差点让两只背对游客。

---

## 3. 绑骨（UniRig，不是 MIA）

```
unirig_rig(engine="unirig", model_url=<第 1/2 步的 glb>)
```

要点（细节见 `prompts.md` §6）：

- **不要 MIA**（Mixamo 22 骨 + T 姿势，与 30~45 骨 / A 姿势冲突）。
- **保留 A 姿势**；长袍/裙摆要独立裙骨（文士 ≥4、仕女 ≥6）；**手指可省**。
- 输出落到 `research/characters/_stage/fig-xxx.rigged.glb`。
- 绑完在 Blender 里做拉伸测试（`hips` 抬 0.10m、`thigh` 各转 20°）确认裙摆/披帛不撕开。

---

## 4. prep（归一化 → 偏航 → 减面 → 重导出）

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background `
  --python research/characters/prep_character.py -- `
  --in  research/characters/_stage/fig-scholar.rigged.glb `
  --out research/characters/_stage/fig-scholar.final.glb `
  --height 1.72 --yaw 0 --decimate 12000
```

- 绑骨之后再减面会**插值顶点权重**，所以先绑再减面之后必须复核权重（见第 5 步的 `--require-skin`
  与 Blender 里的 `Weights → Clean`）。
- 若面数本来就在预算内，**不要**传 `--decimate`（多一次减面就多一次权重误差）。
- `--height`：文士 1.72 / 仕女 1.63 / 马夫 1.70 / 孩童 1.18。
- 输出**只能落在 `research/` 下**（脚本会拒绝写进 `assets/`）。
- 脚本在偏航/减面之后会**再归一化一次**（偏航改 AABB、减面会塌掉最外层顶点），
  所以最后的 `height= / feet z= / center x= y=` 三行应当精确（误差 < 1mm）。

---

## 5. validate（结构判据）

```powershell
node research/characters/validate_glb.mjs research/characters/_stage/fig-scholar.final.glb --require-skin --max-tris=15000
```

必须看到：

```
COUNTS meshes=1 … skins=1 animations=0
SKIN   #0 joints=3x
ATTRS  POSITION=yes NORMAL=yes TEXCOORD_0=yes
RESULT PASS
```

退出码非 0 就别往下走。常见红：

| 红 | 含义 | 处理 |
|---|---|---|
| `every primitive has NORMAL` | 导出时没带法线 | Blender 里 `Shade Smooth` + 重导出，别在 three 里 `computeVertexNormals` 糊弄（低模会变硬边） |
| `TEXCOORD_0` | 没 UV | 生成时 `export_uv=true`；已有贴图没 UV = 图集白做 |
| `skins=0` | UniRig 没跑成功 | 重跑第 3 步（先看返回的 task 是不是 completed） |
| `joints 30..45` | 骨架太多/太少 | 太多：MIA 混进来了（应该 22）或手指全带；太少：裙骨没生成 |
| `animations=0` | 带烘焙 clip | 动作归 JS 程序化驱动，重导出时关动画 |

---

## 6. 放进 `assets/`

- 命名：`assets/fig-scholar.glb` / `fig-lady.glb` / `fig-laborer.glb` / `fig-child.glb`。
- **单件 ≤ 1.5MB**（`Get-ChildItem assets/*.glb | Select Name,Length` 自查）。
  超了就依次压：贴图 1K→WebP 质量 80、面数减到 8k、删法线图。**不要用 Draco**（离线解不了）。
- 放进去之后**不要**再手改几何 —— `prep_character.py` 是唯一的入口。

---

## 7. 加预载清单 + SW（两个地方必须同时改）

1. `src/13-preload.js` 的 `PRELOAD_MANIFEST` 追加一项（`url / bytes / stage / label / required`）。
   `bytes` 用**真实文件字节**，别手算。
2. `sw.js` 的 `GLBS` 追加 `'./assets/fig-scholar.glb'`，并把
   **`ASSET_CACHE` 的后缀 +1**（当前 `suzhou-garden-assets-v13` → `suzhou-garden-assets-v14`）。
3. `node probe/preload-manifest-sync.mjs` —— 它逐项比对"13-preload ↔ sw.js"的集合与 bytes，
   少一处就报红（2026-10-02 就漏过 `Macaw.glb` 22 小时）。

> **SW 版本口径**（`sw.js` 头部 2026-10-12 收窄后）：`assets/*.glb` 是 **cache-first**，
> 所以必须 bump `ASSET_CACHE`；`index.html` / `src/*.js` / `vendor.js` / `manifest.webmanifest`
> 是 **network-first**，改了**不用** bump `CACHE`。`CACHE`（现 v41）只在 `docs/cover.jpg`、
> `icons/garden.svg` 这类 cache-first 的 SHELL 成员变化时才动。

---

## 8. 接入 `08b-figures.js`

三条**必须一起做**，少一条就会留下"看得见但不对"的半残状态：

1. **克隆用 `SkeletonUtils.clone`，不是 `Object3D.clone(true)`。**
   现有 `loadAssetOnce` 内部是 `src.clone(true)`，而 `SkinnedMesh.clone()` 会**共享同一个
   `Skeleton`** ⇒ 四个角色共用一套骨、动作完全同步。
   ⚠️ `vendor.js` **目前没导出** `SkeletonUtils`（`build-entry.js` 只导出了 `mergeGeometries`；
   在 `vendor.js` 里搜 `SkeletonUtils` / `cloneSkeleton` 命中 **0** 次）。所以接 P1 时要先：
   ```js
   // build-entry.js 追加一行，然后 npm run build:vendor
   export { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
   ```
2. **注册进 `figures[]` 的日程系统**，沿用 `userData.baseY` / `rotation.order='YXZ'` /
   `rotation.y = atan2(dx, dz)` 这套口径（11-loop 每帧会写回 `baseY`，只静态设 position.y 会被抹掉）。
3. **阴影与合并**：会动的角色 → `castShadow = false` + 贴地软阴影（`makeSoftAlphaTex` 生成，
   用 **`map`** 不是 `alphaMap`）；网格打 `userData.noMerge = true`；
   资产异步到场后 `markCasterBoxDirty()` + `renderer.shadowMap.needsUpdate = true`
   （`autoUpdate=false` 下不刷这张图，人会"没有影子、旧影子赖在地上"）。

已知接口冲突（详见 spec §8）：`probe/figure-audit.mjs` 的配色判据读 `material.color`，
GLB 人物的 color 是白色 ⇒ 要么给新角色暴露 `userData.palette`，要么把 GLB 角色排除出该判据
并另建"贴图主色采样"。**不要**为了让门禁变绿去把材质颜色改白/改灰。

---

## 9. 截图验收

至少四张，缺一张都可能把缺陷放过去：

| 张 | 机位/状态 | 看什么 |
|---|---|---|
| A | 默认机位（40m）· 正午 | 与剪影同框时的**身高比例**是否差一个头；袍色是否被草坪绿吞掉 |
| B | 3~5m 近景 · 正午 | 脸：眼白/虹膜/唇读不读得出（0.5~1m 再补一张） |
| C | 3~5m 近景 · 夜（21:30） | 夜里会不会变"影子人"（P0-1 的老问题） |
| D | 走路 10s · 冻结尾帧 | 脚不穿地、裙摆不穿腿、披帛不撕开 |

门禁：`node probe/figure-audit.mjs`（配色/脚底/朝向）+ `npm run verify:quick`
（**不跑全量 `npm run verify`** —— 老黄明令全量只在最终交付前跑一次）。

---

## 10. 收尾

- `npm run check`（语法 + no-undef + import 链接）。
- `node probe/layout-fingerprint.mjs`：**新增会动的网格不影响指纹**（它只哈希
  `InstancedMesh`），但如果你顺手加了实例化装饰，就要重出基线。
- 提交：逐个列名 `git add <file>`，**不要** `git add -A`（同文件多主题时会裹进别人的改动）。

---

## 11. P2 实测补充（2026-10-22）

### 11.1 裙摆不用裙骨也能走

P1 的顾虑"裙摆权重挂在腿上 ⇒ 一走动就撕"**实测不成立**。办法：`outputs/_diag/actor-stride.mjs`
把大腿摆到 ±0.38rad、小腿 −0.18rad，前/侧各出一张（`outputs/_diag/actor-stride/`）：
长袍/长裙是锥面，跟着大腿摆、下摆让鞋面露出来，**没有撕口、没有穿模**。
所以 `16-actors` 的步态直接用了（振幅 0.27rad ≈ 15.5°，比测试值更保守）。
真正需要裙骨的是**大幅抬腿/坐/跪**（膝盖过腰那种），那些动作仍然押后。

### 11.2 UniRig 会把"手骨"错分到躯干 —— 必须过一遍 `repair_hands.py`

马夫这只 rig：`LeftThumbDistal` 分到 448 个顶点，包围盒 z=0.51~0.90（**裤腿**）、
`LeftHand` 分到 224 个（含腰带外缘）。后果实测（`pose_stretch_test.py` 抬臂 0.75rad）：
袖子没事，但整条**白腰带被拽成一片尖刺**。

修法（几何判据，不看权重名）：手链骨（Hand/Thumb/Index/Middle/Ring/Little）对某顶点有权重，
而该顶点离这根骨的线段 > **0.09m** ⇒ 转给最近的躯干/腿骨。
⚠️ 阈值别给 0.14（第一版）：垂手掌根在 z≈0.87、x≈0.28，腰带外缘离它只有 0.13m，会漏。
修完 1868 条误权重，抬臂/迈步测试干净。

**遗留**：腰带上仍有少量顶点贴着前臂骨（几何上分不开），所以马夫**只做躯干前俯、不转肩**。
要用他做"递草"的手部动作，得重新绑骨（或给腰带单独分骨）。

### 11.3 贴图预算：PNG 顶不住，走 JPEG q88

生成件 1K 图集是**噪声很大**的 PNG：单张 1.6MB，两张大 ⇒ 单件 3.66MB（预算 1.5MB）。
`optimize_character.py` 的第 4 个参数换成 `JPEG`：1.76/2.56/3.66MB ⇒ **0.68/0.84/0.74MB**，
`outputs/_diag/*-jpg` 的 1:1 对比看不出差别（哑光布面，3m 机位）。
用法：`optimize_character.py -- <in> <out> 1024 JPEG`。

### 11.4 台基/院子面要用射线，不是 groundHeight

马夫站在马厩的 `yardWear` 面（0.10），`groundHeight` 给的是地形（0.05）⇒ 人会陷 5cm。
`16-actors` 里 `floorRay: true` 的角色会在**开局 4 秒内每 0.25s 打一次向下射线并取最高**，
之后冻结（马厩是 `deferBootFirst` 建的，人物 GLB 常常先到；"打中就冻结"会冻在错的地形上）。
只接受 [−0.4, 0.8] 的命中，避免把屋顶（2.9m）当地面。

### 11.5 步幅与推进距离要对账（否则滑步）

`STEP_LEN = 0.42m` 是散步者（08d `WALK_STRIDE`）的口径，而每个人的腿长不同：
振幅按 `asin(STEP_LEN / (2 × 髋高))` 现算（髋高由 Hips 骨骼世界高度 − 地面得到），
文士/马夫/仕女各不相同。相位按**走过的距离**推进，所以站下/转身/上坡都不会"脚在原地划"。

### 11.6 ⚠️ 大腿骨左右是**镜像**的，膝不是

UniRig 这套骨架里两条大腿的局部 X 轴互为镜像：**同步动作（蹲、跳、两腿一起前屈）必须用反号**
（左 +、右 −），而**膝盖屈曲两个都用负号**是同向的。
第一版孩子跳把蹲写成 `两边都 +0.8` ⇒ 出图是一条腿往前、一条腿往后（劈叉式起跳）。
行走时用 `±amp·sin(p)` 恰好天然正确，所以只有"同步态"才会踩到这条。

### 11.7 孩子的"跳"只动腿

`idle.hopEvery = [min,max]` + `hopH`：0~0.32 下蹲蓄力、0.32~0.78 腾空（整身抛物线 + 收小腿）、
0.78~1 落地缓冲；**肩部全程不动**（书童的袖子/衣摆同样被手链骨误权重，抬臂会撕）。
间隔用 `det()` 确定性伪随机（不碰全局随机流）。

---

## 12. P2 前置：裙骨与坐姿（2026-10-22 实测）

### 12.1 补裙骨：`add_skirt_bones.py`

```powershell
blender -b --python research/characters/add_skirt_bones.py -- `
  research/characters/_stage/scholar_rigged.glb research/characters/_stage/fig-scholar.skirt.glb `
  hem=0.12 tex=1024
```

- 加 6 根 `Skirt0..Skirt5`（父级 Hips，头在髋心、尾指下摆，0° = 正前；Blender 里人物朝 −Y）。
  `seg=2` 时改为 12 根：`Skirt{i}a`（髋→膝线）+ `Skirt{i}b`（膝线→下摆，父级是 a）。
- 改绑范围 z ∈ [hem, hip]，**跳过**三类顶点：手链骨权重 > 0.20（袖子/手）、
  半径 > 0.33（张开的手臂在轮廓外）、**半径 < 0.15（袍内的腿/裤）**。
  ⚠️ 第三条是后加的：漏了它，裤腿会被一起改绑到裙骨上，坐姿时**裤脚/鞋被撕成碎片**
  （实测出图那一地黑色碎片就是它）。
- 权重：相邻两根裙骨余弦混合 + 按高度往 Hips 渐混（下摆 100% 裙骨 / 髋部 45%+55%）。
- 实测文士 2926 / 仕女 6801 个顶点改绑（加内径判据后文士 2392）；体积 680 / 842 KB。

**顺带治好了腰带**：抬臂 65° 时文士的白腰带不再炸成尖刺（原来 65° 必炸）—— 因为腰带
整条在改绑区间里，被一起交给了裙骨。

**裙骨轴向（实测，文士）**：`Skirt0a` 局部 **X 负** = 前面那片往前上翻
（X−0.8 ⇒ 骨末端 y=−0.649 = 身前；X+0.8 则往后）。b 段与 a 同轴，反向同角度即可"抵消"
父级旋转、让下摆重新垂下来。

### 12.2 坐姿：跪坐已验证；坐凳还差两件事

| 姿态 | 结果 |
|---|---|
| 跪坐（髋 −0.46 / 膝 **+**1.62 / 脚 −1.30，脚骨缩到 0.04） | ✅ 袍摆落地、无撕裂，高 1.72→1.26m |
| 坐凳 · 单段裙骨（髋 −0.34 / 大腿 +1.45 / 膝 −1.45） | ❌ 袍被大腿顶成"贵妃榻"；前翻 0.9rad 则下摆对开撕裂 |
| 坐凳 · 两段裙骨（a 前翻 1.15×角度剖面、b 反向 0.96） | ⚠️ 形状对了（前襟盖腿、下摆垂地），但**下摆穿地 0.36m**、**鞋/裤脚在身后堆成一团黑块** |

⇒ 坐凳要真正可用，还差：① 下摆长度按坐姿再压（b 段 `scale.y` 缩到 ~0.75）；
② 脚要么缩进袍内、要么给鞋单独摆位。**下一轮先做低案（跪坐）路线**，
它已验证、也更合园林气（席地抚琴/对弈），坐凳留作后续。

⚠️ **膝的符号**：这套架子**小腿正号才是往后折**（实测膝 +1.57 时踝在 y=+0.43 = 身后）；
负号会往前折（初版据此渲染出"脚朝天"）。
⚠️ **脚要收进袍里**：跪坐时鞋会从下摆下伸出一截（很出戏），把 Foot/Toes 的 `scale`
收到 0.04 即可。文士实测站立 1.72m → 跪坐 1.26m；仕女 1.63 → 1.28。

### 12.3 手部误权重：三种判据都被实测否掉（别再试）

背景：垂手时**拇指贴着大腿**，裤腿/腰带尾部有一批顶点被 UniRig 给了
`LeftThumbDistal = 1.00`，抬肩时位移 **0.55~0.61m**。

| 判据 | 结果 |
|---|---|
| 到骨线段距离（0.09~0.14） | ❌ 误分点 0.12m、真手也 0.10m，分布重叠 |
| 手部球体（腕心、手长 1.2×） | ❌ 真指尖离腕 0.24m、大腿面离腕 0.26m，大球放过、小球剥真指尖 |
| 左右镜像 | ❌ 生成件本身不对称（826/984 个手部顶点找不到镜像） |
| 谁近算谁的 | ❌ 拇指就在大腿前面 13cm，比腿骨还近 |

⇒ **几何上分不开**。两条可用的实践结论：
① 长袍角色走 12.1 的整体改绑（腰带被一起带走）；
② 短打角色（马夫/书童）**不抬肩**，只做躯干/腿部动作 —— 这是取舍，不是没做完。

### 12.4 仕女还有第二道限制：披帛

她的 pibo 挂在两条小臂上，抬臂 65° 时整条披帛在胸前炸开 ⇒ 只能做**≤25°** 的上肢动作。
抚琴/展卷这类大动作交给文士。

### 12.5 接入前必须先做"裙骨驱动"

换上新资产后**裙摆不再跟腿**（权重已交给 `Skirt*`）。16-actors 必须同时补：
走路的裙摆摆动 + 坐姿的前翻 + 跪坐的长度压缩。**这一步没做之前，两件新资产留在
`_stage/`，不进 `assets/`** —— 否则仕女走路会变成"腿在动、裙子是块硬板"。

---

## 13. P2 第一件"坐着的动作"：堂前低案 · 跪坐抚琴（2026-10-22 实测）

### 13.1 位置与单一真值

堂前月台上、东次间：`x=8.0`（列柱在 `x=±6/±10`、`z=−9.1`；台缘在 `z=−7.3`；
离水缸 `(3.7,−7.4)` 4.3m ⇒ 不挡路、不压缸）。桌与人是**一处真值推出的两个点**：

```js
// src/14-props.js
const QIN_LOW = { x: 8.0, z: -7.78, y: 1.30, yaw: 0,
                  top: 0.36, seatBack: 0.42, seatOut: 0.0 };
export const QIN_LOW_SEAT = { x: 8.0, y: 1.30, z: -8.20, yaw: 0 };   // 由上式算出
```

`16-actors` 的 `qin` 条目直接吃 `QIN_LOW_SEAT`，**不另写一份坐标**；
`PROP_SPOTS.qinLow / qinLowSeat` 也由它派生 —— 挪桌子只改 `QIN_LOW` 一处。

### 13.2 低案的尺寸与"为什么不是板足"

| 件 | 尺寸 / 位置（相对台面） | 说明 |
|---|---|---|
| 案面 | 1.30 × 0.055 × 0.44，`y = top−0.0275` | 低案面宽够放 1.16m 的琴 |
| 压边 | 1.34 × 0.020 × 0.48，`y = top−0.065` | 一圈深色，近景才读得出"案沿" |
| 牙板 | 0.072 高 × 4 条，`y = top−0.111` | 长边 1.14 宽、短边 0.36 |
| 腿 | 0.046² × 0.23 高，`(±0.548, ±0.168)` + 马蹄 0.058×0.026 | **细腿**是关键 |
| 侧枨 | 0.034 × 0.032 × 0.372，`y=0.095` | |
| 草席 | 0.80 × 0.014 × 0.72，`z = −seatBack−0.02` | 压住袍摆与地面的接缝 |

⚠️ **第一版是"两端各一块竖板"（板足）**：0.3m 高的板足在侧视里是一整块深色方块，
读作"箱子/柜子"而不是案（出图复核当场否掉）。低案的识别特征恰恰是
**面 + 窄牙板 + 细腿**，腿越细越读得出"这是张桌子"。
⚠️ 草席别做大：0.96×0.84 那版读成"一块白板垫在地上"，收到 0.80×0.72 才像席。

古琴几何抽成 `addQinModel(g, topY)`，**水榭那张高案（0.72）与这里（0.36）共用**。
弦的实测口径（近景判读全靠它）：

```
弦面 y = topY + 0.0705          // 本处 = 1.7305
弦 7 根，x ∈ [−0.574, +0.586]    // 长 1.16，两端是岳山(−0.575)/龙龈(+0.588)
              z ∈ [−0.072, +0.072]   // 世界 z ∈ [−7.852, −7.708]
岳山/龙龈面在 topY+0.065/+0.062（比弦面低 5~8mm，指尖碰到它才是穿模）
```

### 13.3 人物条目：两处"必须显式给"

```js
{ id:'qin', url:'assets/fig-scholar.glb', height:1.72, hidePose:null,
  spot:{ x:8.0, z:-8.20, y:1.30, yaw:0 }, floorRay:true, floorMax:1.70,
  pose:'kneel', idle:{ qin:true, lean:0.18, headDown:0.12, ... } }
```

- **`floorRay` 的默认接受上限 0.8 会把 1.30 的月台当成"屋顶"丢掉** ⇒ 条目必须给 `floorMax`。
- **月台是浮在地形上的独立网格**，`groundHeight()` 给的是地形（约 −0.2），照它放会陷 1.5m
  ⇒ `spot.y` 显式写 1.30（与 `11.4` 的马厩院子同一条理由）。
- `hidePose: null`：他是**新增**的人，不替换任何程序化人物（水榭里抚琴那位保留）。
  ⚠️ `hideProcedural()` 里必须先挡 `if (!poseName) return` —— 传 `undefined` 会匹配上
  **所有**没有 `poseName` 的人物，静默把别人一起藏掉。
- 同一份 `fig-scholar.glb` **第二次 parse**（与两个书童同款）；`settleAsset` 是幂等的，
  预载/`sw.js` 不需要新 URL、不需要升缓存版本。

### 13.4 姿态是三级反解出来的，不是照姿势填的

| 级 | 探针 | 做法 | 结果 |
|---|---|---|---|
| ① 肩/肘轴向 | `actor-qin.mjs` | 每根骨绕世界 X/Y/Z 各 ±0.4rad，量手的世界位移 | 肩 X− = 前摆、Z+ = 下压（左）、Y ≈ 扭；`LowerArm` 的 **Y 是纯扭转、手不动** |
| ② 肩三轴网格 | `actor-qin-solve.mjs` | **屈肘先钉死 0.65**，再解肩三轴（0.075 粗 → 0.025 细），带"肘插进躯干"惩罚 | 自由解 4 个自由度会挑"手臂几乎伸直"的边界解（看着僵），钉死屈肘才有自然弯 |
| ③ 手骨三轴 | `actor-qin-hand3.mjs` | 手骨 (x,y,z) 0.1 步 × 指蜷三档，目标"指尖落在弦面上方 1cm 且在弦带内" | 见下节 |
| ④ 复核 | `actor-qin-verify.mjs` | **不加任何覆盖**，读产品自己摆出来的姿态，并步进 1.2s 取指尖极值 | 见 13.6 |

**触达约束**：腕→肩这条链约 **0.58m**。`seatBack` 一拉开就够不到弦（0.55 那版手停在
案沿前 0.14m），所以取 **0.42** + `lean 0.18`（把肩送进触达范围）。
左右两组**各自求解、不镜像**：这套骨架左右骨骼朝向本来就不对称，照 `armDown` 那样乘 −1
会让右手肘朝外翻。

### 13.5 手：腕骨三轴 + 拇指方向（这一节全是"反直觉"）

```js
const QIN_HAND = {
  Left:  { hx: 0.50, hy: -0.50, hz: 0.00, curl: 0.15, mid: 0.13, thumb: -0.65 },
  Right: { hx: 0.10, hy: 0.80, hz: -0.50, curl: 0.15, mid: 0.13, thumb: -0.65 },
};
```

- **腕屈符号左右相反，而且与"掌屈"这个直觉相反**：细扫（`actor-qin-wrist.mjs`，
  Hand 单轴 −1.0…+1.0）实测**左手 z+ 往下、右手 z− 往下**。第一版按"左 z− / 右 z+"
  写，两只手都被抬到弦上方 6.5~9.7cm，"摊着两只手"。
  ⚠️ 更早一轮的轴向探针给出过"左 z− 降 3.9cm"，与细扫矛盾 —— 原因是当时拿**当前姿态**
  当基准做差分（基线里已经含 0.42 的腕屈），所以两轮读数互相打架。**量轴向一律用
  "整副骨快照 + 逐轴还原 + 读绝对高度"**，别做相对差分。
- **必须三轴一起解**：只压一个轴时右手中指会比食指高 **5~12cm**（两根手指在同一平面里
  天生不齐），叠一点滚转（y）把指扇摆平后才齐。
- **拇指 x 负才是"收向掌心"**，正号往外张（张开的拇指正是"摊手"的一半）。
  三节 −0.65/−0.585/−0.39 时拇指尖到食指尖 **0.152 → 0.066m**。
- ⚠️ **这套骨架只有 食指/中指/拇指 三根指骨，无名指与小指是刚性网格**（收不拢）⇒
  只能靠"腕骨滚转 + 拇指内收"把整只手读成收拢；别再指望蜷无名指。
- ⚠️ **骨骼不在 `base[]` 表里 ⇒ `set()` 静默返回、画面一动不动**。拇指这三节踩过：
  探针扫了四档，四个读数一模一样才发现。新增任何被驱动的骨都要先登记。

### 13.6 拨弦叠在**指节**上，不叠在肘上

第一版把拨弦振荡加在 `LowerArm` 上：肘一动整条手臂上下摆 **1~2cm**，而指尖只离弦 1cm
⇒ 会周期性地穿进弦里。改成食指/中指**交替起点**（`max(0,±sin)`），手是稳的、只有指尖在动，
而且读起来像"擘/托"两指交替，比两只手同时上下更像弹琴。

**复核数值**（`actor-qin-verify.mjs`，弦面 1.7305；`back` 正 = 靠人、负 = 靠琴尾）：

| 量 | 左手 | 右手 |
|---|---|---|
| 腕（Hand 骨） | y 1.824（+0.093）· back +0.063 | y 1.840（+0.109）· back +0.079 |
| 食指尖 | **+0.006** · back −0.039 | **+0.006** · back −0.067 |
| 中指尖 | **+0.003** · back +0.029 | **+0.001** · back −0.037 |
| 拇指尖 | +0.031 · back +0.017 | +0.035 · back −0.011 |
| 拨弦 1.2s 内指尖 dY 极值 | 0.003 ~ 0.013 | 0.001 ~ 0.014 |

判据：**指尖 dY ∈ [0, +0.02]**（贴弦不穿琴面）、**back ∈ ±0.072**（在弦带之内）、
腕高 0.09~0.11（腕在上、指尖压下去）。

### 13.7 改动联动（改之前先读这条）

| 改了什么 | 必须重跑 |
|---|---|
| `QIN_LOW.top` / `seatBack` / `seatOut` / `y` / `yaw` | `actor-qin-solve.mjs` → `actor-qin-hand3.mjs` → `actor-qin-verify.mjs` 全部 |
| `idle.lean` / `headDown` | 同上（lean 直接改肩的位置，指尖会整体漂） |
| 换了人物 GLB（高度/骨架不同） | 同上 + `actor-qin.mjs` 的轴向段（轴可能完全不同） |
| 只改观感（呼吸/转头/拨弦节奏） | `actor-qin-verify.mjs` 一遍即可 |

三个探针都在 `outputs/_diag/`，都是"进页 → 等 6 位 actor 到齐 → `actorPose('qin','kneel')`
→ 页内算"的同一套写法；改姿势后**先跑 verify 再出图**，别拿图当判据。

---

## 14. P2 第三件：端茶（2026-10-22 实测）

讲学那位文士（`scholar`）右手端一盏青白瓷茶盏，每 8~14s 举到胸前再放下
（`src/16-actors.js` 的 `TEA_ARM`，`idle.tea` 打开）。

### 14.1 两组角的来历

| 姿态 | 目标（人物局部） | 腕到目标 | 解（sx / sy / sz / ex） |
|---|---|---|---|
| `hold` 端着 | 身前 0.24m、腰腹高 1.02m | 0.003m | −0.42 / 1.19 / −1.18 / 0.60 |
| `lift` 举起 | 身前 0.26m、胸前 1.25m | 0.061m | −2.20 / −0.18 / −0.55 / 1.10 |

探针：`outputs/_diag/actor-tea-solve.mjs`（hold + 就唇）、`actor-tea-lift.mjs`（胸前）、
取证 `actor-tea-view.mjs`（两态数值 + 三机位出图）。

### 14.2 为什么没有做"把盏送到嘴边"

三件事一起否掉了它，都出图验证过：

1. **长袖把手整个包住** —— 盏贴掌心时（`cup = palm + 1.2cm`）出图里茶盏**完全看不见**，
   只看到袖口一团。"手里的小道具必须露在父几何轮廓之外"这条经验（马厩草料捆）
   在这里再一次成立 ⇒ 盏改摆到**腕前 9cm**（`TEA_CUP_FWD`），正好在袖口之外。
2. **嘴边目标离肩只有 0.25m** —— 腕要到嘴边，肘必须折到 2.4rad 且**抬到肩上 21cm**，
   读作"端碗往嘴里倒"（`actor-tea-sip2.mjs` 的 elbowUp 列）。屈肘上限设 2.0 时最好也差 5.7cm。
3. 这套骨架**没有前臂旋前**，掌心朝向只能靠腕子拧 —— 与对弈"闲手"同一类限制，
   见 `GO_ARM` 的注释。

### 14.3 茶盏为什么不挂在手骨上

挂手骨 ⇒ 盏跟着腕子拧（没有旋前骨，腕子本身就是拧出来的角度）⇒ 盏里的水面会斜。
做法：盏是 `holder` 的子节点，**每帧**按"腕 + 人物正前方 9cm + 上 2cm"摆一次、姿态恒竖直。
⚠️ 摆之前必须 `holder.updateMatrixWorld(true)`：刚写完骨骼四元数时矩阵还是上一帧的，
不刷会看出"盏比手慢一帧"，举盏那段最明显。

### 14.4 改动联动

| 改了什么 | 必须重跑 |
|---|---|
| `TEA_ARM` 任一角 / `TEA_CUP_FWD` | `actor-tea-view.mjs`（两态数值 + 出图） |
| 换人物 GLB | 先跑 `actor-qin.mjs` 的轴向段（轴可能完全不同），再重解 `TEA_ARM` |
| `idle` 里新增/删除动作 | `npm run check` + `verify:quick`（`actorState` 的字段探针要跟着改） |

---

## 15. P3 马夫刷马（2026-10-22/23 实测）

马厩里那位马夫（`laborer`）前俯看着马吃草，每 7~12s 直起腰、抬右前臂对着身边那匹
枣马的颈颌刷一轮（一轮 9.2s：抬 0.9 / 刷 7.4 / 收 0.9）。参数在 `src/16-actors.js`
的 `BRUSH`，道具是 `makeBrush()`。

### 15.1 为什么"只动肘 + 腕、绝不转肩"

这只 rig（UniRig 自动绑骨 + `repair_hands.py` 修过一轮）的**腰带**上仍有一批顶点
几何上贴着前臂/拇指骨，分不开 —— 转肩会把腰带拽成尖刺（仕女披帛、抚琴裤脚同族）。

**能不能动，用两条量测定案**（`outputs/_diag/actor-brush-probe.mjs`）：

1. **骨轴距离**：逐顶点量"挂在某根骨上的顶点离这根骨线段多远"（前臂半径 ≈6cm）。
   右肘 316 顶点 maxD **0.132m**、右腕 20 顶点 **0.090m**、>0.14m 的越界顶点 **0 个**
   ⇒ 肘与腕是干净的；肩不干净（所以不碰）。
2. **主导骨位移归类**：只转右肘 0.35rad，按"占权重最大的骨"给每个顶点归类再量位移 ——
   全部落在 `RightLowerArm / RightHand / Index·Middle·Ring·Little·Thumb` 各节，
   **Spine / Hips / Chest / Skirt 位移 0**。

这两条也是"某根骨到底能不能动"的**最快裁决法**：比出图可靠，比试错快一个数量级。

### 15.2 刷尖贴面是**量出来的**，不是调出来的

**必须用多方向射线取最近面**：第一版"朝马身包围盒中心打一条射线"量出 0.32m，
据此差点判定"刷子在空刷" —— 那条线打到的是**马腹**（从马颈前方射向体心必然穿腹）。

改为 26 个方向各打一条、取最近命中（`actor-brush-solve.mjs` / `actor-brush-final.mjs`）：

| 站位 | 刷拭行程（肘 −1.25~−1.65） | 命中高度 | 判定 |
|---|---|---|---|
| x=38.0、z=1.40 | 7~37mm（肘 −1.45 时 **7mm**） | — | 贴在马嘴/面颊 |
| x=38.0、z=1.30 | **42~74mm** | 1.157~1.283m | 贴在马颈颌（当前采用） |

站位只在 z 上退 0.10m：**x 是实测贴面值**，往 +x 挪会让刷子插进马身。
命中高度落在 1.16~1.28m 正是"颈颌"，同时也是"刷面法线朝内"的旁证
（法线与命中面法线的夹角 140~165°，即**正对**着表面 —— 90° 才是侧着蹭）。

### 15.3 刷子为什么不挂手骨

同茶盏/卷轴：挂手骨会被腕子拧歪（这套骨架没有前臂旋前）。做法是每帧按
"腕 + 前臂方向 10cm"重摆、**朝向 = 前臂方向**，摆之前先 `holder.updateMatrixWorld(true)`
（否则道具比手慢一帧）。

尺寸 **15cm（按像素定）**：马厩机位在 15~25m 外，8cm 的小件只有 1~2px；
`castShadow=false` —— 15m 外小件的投影贡献≈0，只会把阴影盒撑大。

### 15.4 一个必须记住的相位 bug

一轮刷完（`u>=1`）时**必须同时把 `brushT` 归零并重排 `brushWait`**。第一版只归零
`brushT`，而收尾那 0.9s 里 `brushWait` 已经减到负数 ⇒ 下一帧立刻又开始新一轮
⇒ **一轮接一轮地连续刷**（画面看起来"这个人一直在刷，从不歇"）。

---

## 16. P2 收尾：文士捧卷轴 + 马夫手持草料（2026-10-23 实测）

### 16.1 捧卷轴：两只手各自反解、不镜像

`SCROLL`（`src/16-actors.js`）。目标点是"卷轴两端木轴的中心"：

| 侧 | 目标（相对脚下） | 解（sx / sy / sz / ex） | 误差 |
|---|---|---|---|
| Left | 高 1.32m、左 0.21m、前 0.30m | −2.34 / −1.77 / −0.17 / 0.70 | 0.043m |
| Right | 同上（右侧） | −1.99 / 0.77 / −0.43 / 0.70 | 0.039m |

探针 `outputs/_diag/actor-scroll-solve.mjs`（一次扫三组目标：胸口宽/窄/低）。
**左右各自求解、绝不镜像** —— 这套骨架左右骨骼朝向本来就不对称
（抚琴、对弈那两轮都踩过镜像会把一只手肘翻到外面）。

实测：两手相距 **0.353m**、高差 1mm、腕在离地 **1.12m**（胸口）；卷轴按
"实测手距 / `SCROLL.span`" 缩放（0.84），两端木轴落在腕心 **12mm** 之内（掌厚）。

**第一版为什么废掉**：目标取 1.20m/±0.155（腰腹高、两手并拢），出图里两只手被
宽袖口整个吞掉、卷轴只剩一个白三角（`outputs/_diag/actor-scroll/front.png`）。
抬到胸口 + 两手拉开之后纸面才从袖口之间露出来。

### 16.2 纸面朝向：法线朝前上 24°

卷轴不写死姿态：每帧按"两腕中点 + 左腕→右腕 = 纸的 X 轴"现摆（同茶盏/马刷）。
纸的 up 取 `up·cos24° − 正前·sin24°`（**上沿朝人**），于是法线 = 前 + 上（实测
`normal.y = 0.41`）。外场相机在人物正面偏上，看到的才是纸面；竖直拿着时从默认
俯视机位只剩一条白边。

### 16.3 手腕内旋：这套骨架只能靠腕子表达"握"

只有食指/中指/拇指三根指骨，无名指小指是刚性网格 ⇒ 握姿只能靠**腕骨**转。
`outputs/_diag/actor-grip-sweep.mjs` 一次渲 5 个变体（A 不转 / B y+ / C y− /
D z+ / E x+）直接看图定案：**E（`hx = 0.90`，掌心内旋、指节朝下）** 读作"扣住木轴"，
A（不转）是"摊开的手掌托在纸下面"，D 变成"双手捧着往外递"。

### 16.4 与"端茶"是互斥手位（四相状态机）

`a.scrollPhase`：0 捧读（22~38s）→ 1 放下（1s）→ 2 喝茶（4.2s，复用 `TEA_ARM`）
→ 3 捧起（1s）→ 0。握手规则：

* 卷轴权重 `a.scrollW` 在 0/2 相是纯 1/0、中间两相各 1s 缓动 ⇒ 手不会瞬移；
* 茶盏 `visible` 只在相位 2 打开，其余时候收起（否则"两手捧着卷轴、腕上还挂着盏"）；
* 相位 1 结束**主动**置 `teaT = 1e-4` 起喝，相位 2 等 `teaT` 归零才捧回去。

### 16.5 马夫手里那把草

`HAY_ARM` + `makeHayHandful()`。

* **只动左肘**（右臂是刷马那条，肩不能动）：`ex −0.35` 手臂自然垂着（腕在身前约 0.02m、
  离地 0.94m）。⚠️ **"往前伸"这条路被站位堵死**：马夫离马腹只有 20cm（马身 x≥38.2、
  人在 x=38.0），前伸 11cm 的一把草（半径 0.14m）**整个插进马的颈肩**——
  实测草把中心 (38.36,1.19,1.09) 落在马身包围盒内，出图里一点都看不见。
* **草把要离开袍子**：垂手时草把立在腕心 ⇒ 草在袖筒里，出图里"手是空的"。
  现在放到腕的**外侧 0.13m**（`HAY_ARM.out`），竖直、略向外倒 0.30rad。
  ⚠️ 这只 rig 的 `LeftHand` 在人物 **−z 侧**（yaw=π/2 时腕 z=1.035、体心 1.3），
  所以"外侧"是 `(cosθ, 0, −sinθ)`；第一版按"左手 = +z"算 ⇒ 草把被塞进袍子
  （实测 z=1.198，离体心只有 0.10m）。
* **11 根草用 `InstancedMesh`（1 个 draw call）**，根黄梢绿用一条竖渐变贴图。
  ⚠️ 第一版用 `mergeGeometries` 拼 11 根管，**静默失败**（合并结果为空、草不出现，
  异常被资产加载器的 `onError` 吞掉）⇒ 换 InstancedMesh。判据也要注意：
  **`Box3.setFromObject` 对 InstancedMesh 返回空盒**（`size = Infinity`），
  量草把尺寸要按 `getMatrixAt` 逐实例手算（`actor-hay-probe.mjs`）。
* ⚠️ **`HAY_ARM.len` 漏写 ⇒ 草把整个不存在，而且一声不响**：`len` 是 undefined，
  `Matrix4.compose(…, scale.z = NaN)` 把 11 个实例矩阵全写成 NaN ⇒ 顶点全是 NaN、
  一个像素都画不出来；`Box3` 也因此变成 `Infinity`（JSON 里是 null）。
  **症状 = "道具没出现"，真因是一个拼错的属性名** —— 与 `b.peen` 那条 `|| 0`
  吞 NaN 同族。新增常量时，凡"用它算矩阵/尺寸"的字段，最好在同一行里给出默认值。

### 16.6 改动联动

| 改了什么 | 必须重跑 |
|---|---|
| `BRUSH` 任一角 / 站位移 | `actor-brush-final.mjs`（贴面距离 + 命中高度 + 出图） |
| `SCROLL` 任一角 / `span` | `actor-scroll-solve.mjs` → `actor-p3-verify.mjs` |
| `HAY_ARM` / 草把尺寸 | `actor-final-shots.mjs`（近景 + 马厩机位像素） |
| 改 `makeScroll` 的木轴位置 | 必须保持 **x = ±w/2、y = 0**：卷轴整体按手距缩放，木轴要落在腕心 |
| 新增/删除人物动作 | `npm run check` + `smoke` + `figure-foot-guard` + `layout-fingerprint` |

---

## 本项目已知约束（每条都有出处）

| 约束 | 具体做法 | 出处 |
|---|---|---|
| **私有随机流** | 新增落点/相位/抖动一律 `mulberry32(<固定种子>)`；**不许** `Math.random()`（装配期），也**不许**多抽一次全局 `rr()/rnd()` —— 少一次/错位一次，其后全园布局整体前移且不报错 | 铁律 1、`layout-fingerprint` 基线 |
| **静态阴影** | `renderer.shadowMap.autoUpdate = false`：异步资产到场/替换后必须 `markCasterBoxDirty()` + `renderer.shadowMap.needsUpdate = true` | 2026-10-10 马厩 |
| **移动角色用 blob shadow** | `castShadow=false` + 贴地软阴影片（`makeSoftAlphaTex`，`map` 槽）；不参与静态阴影图 | 马步态 / 2026-10-21 计划 |
| **单件 ≤ 1.5MB** | 1K 图集 WebP + 8k~15k 三角面 ≈ 0.6~1.1MB；超出按 §6 的顺序压 | 预载预算 |
| **SW 版本要 bump** | 新增 `assets/*.glb` ⇒ `ASSET_CACHE` +1（v13→v14）；`CACHE` 只在 cache-first 的 SHELL 成员变化时 +1 | `sw.js` 头部 |
| **预载双清单** | `13-preload.PRELOAD_MANIFEST` ↔ `sw.js.GLBS` 同集合同字节，`preload-manifest-sync.mjs` 把关 | 2026-09-27 |
| **不跑全量门禁** | 功能开发期只跑专项 + `verify:quick`；全量只在交付前一次 | 用户 2026-10-05 明令 |
| **相机钳制** | `maxPolarAngle = 88.6°` ⇒ 镜头抬不起来；任何"抬头看"的机位会被静默钳回，探针设完机位要回读 | 2026-10-05 |

---

## 目录说明

```
research/characters/
├─ README.md            ← 本文件：10 步落地清单
├─ prompts.md           ← 4 段可直接粘贴的英文提示词 + UniRig 注意事项
├─ prep_character.py    ← Blender 5.2 headless：归一化/偏航/减面/重导出
├─ validate_glb.mjs     ← 零依赖 GLB 结构检查（退出码 0/1）
└─ _stage/              ← 中间产物（raw / rigged / final），不入库
```

`_stage/` 里的东西都是中间物，验收通过后只把 `assets/fig-*.glb` 留下；`_stage/` 不进 git。

---

## 17. P4：第五个角色「客人」（2026-10-23）

| 项 | 值 |
|---|---|
| 资产 | `assets/fig-guest.glb` · 667 KB · 11 222 tri · 1 mesh / 1 skin / **60 骨**（54 + 6 裙骨）|
| 贴图 | 1024 漫反射 + 1024 法线（JPEG q88，`optimize_character.py` 的 4 参）|
| prompt | `prompts.md` §8（灰褐直裰 + 东坡巾 + 短须 + 略壮；与文士的靛蓝长衫 + 网巾刻意分开）|
| 落位 | 月洞门内 `(0.15, 20.9)`、`yaw = π`（面朝园内）、`floorRay: true` / `floorMax: 1.20` |
| 动作 | `route: null`（门口那片被台阶与门洞夹着，来回踱步会踩台阶边）＋ idle（呼吸/转头/微摆）|
| 手臂 | `idle.armDown: 0.80`（与文士同口径：左 +Y / 右 −Y 把手从 A 姿势放下来）|

### 17.1 管线（与前三件只差一步，但这一步是硬性的）

```
generate_3d_model(rodin, Gen-2.5-Medium, face_limit 12000, pbr, export_uv)
  → prep_character.py --height 1.70     ← ★ 必须先跑
  → unirig_rig(engine="unirig")
  → repair_hands.py                     （本轮 moved 543 条误权重）
  → add_skirt_bones.py hem=0.12 tex=1024（reweighted 1698 顶点）
  → optimize_character.py <in> <out> 1024 JPEG
```

**为什么必须先 `prep_character.py`**：生成的 GLB 是**居中**的（bounds z ∈ [−0.947, 0.948]），
而 UniRig 是按"归一化小人"摆骨头的 —— 直接把原始件丢过去，回来的 `Hips` 落在 **z=0.027**，
整副骨架缩在脚底、和网格完全脱节。这时 `add_skirt_bones.py` 会打印
`hip z=0.027  hem z=0.120`、`reweighted=0` —— **这组数字就是"骨头没落在衣服上"的诊断信号**，
看到它别去调 `hem`，回去补 prep。归一化之后同一件是 `hip z=0.873`、`reweighted=1698`。

**UniRig 输出自带一个 `Icosphere`**（2×2×2、原点居中）。`optimize_character.py` 会按
"没有 ARMATURE 修改器的网格"删掉它；不删，场景里会凭空多一个 2 m 白球。

### 17.2 验收

`outputs/_diag/guest-check.mjs`：六件人物都在、客人 60 骨且带 6 根裙骨、
世界包围盒高 1.70 且 `minY == holder.y`（门内是踏面 −0.415）、位置在门内 ±1.2 m、
快进 8 s 头骨有摆幅、零 pageerror。出图 `outputs/_diag/guest/`（门内 / 门外 / 3/4 近景）。

⚠️ **探针拍图前不要留在"试验姿态"上**：`guest-check` 里量"手臂符号"那一段会改
`LeftUpperArm/RightUpperArm` 的旋转，第一版把它放在出图之前 ⇒ 三张图全是最后一组试验值
（`-0.8/-0.8`，一臂横伸），看起来像"A 姿势没放下来"。现在这段挪到出图之后，并在末尾还原产品值。
