# 人物资产生成 → 接入 落地清单

> **本会话（2026-10-21）没有 TJGenerators 工具**：`generate_3d_model` / `unirig_rig` /
> `generate_motion` 都不在工具清单里。项目 `.codely-cli/settings.json` 已配置
> https://ai-generator.tuanjie.cn/mcp 且 OAuth 记录在，但 MCP 没连上（命令行测端点回 401 =
> 服务器通、没带授权）。**下面第 1~3 步都还没执行过，也一个模型都没有生成。**
> 工具挂上后从第 1 步开始。
>
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
