# HANDOFF · 人物/动物改造（P0~P3 收尾）2026-10-23

> 给下一个窗口的一页索引。细节看 `research/characters/README.md`（§11~§16）与根目录 `CODELY.md`。
> 分支 `refactor-06-split-20261013`。

## 1. 现在是什么状态

| 批次 | 内容 | 状态 | 提交 |
|---|---|---|---|
| P0 | 马会走（后腿骨链 + 四拍/对角步态 + 走↔吃草） | ✅ | 5208a46 |
| P1 | 资产管线（prompts / prep / validate）+ 4 件 AI 人物接入 | ✅ | 215c…/2194e12 |
| P2 | 程序化步态（不滑步）、对弈闲手+棋子、跪坐文士抚琴、文士端茶 | ✅ | 6567635 / c54be02 / 69ce296 |
| P3 | 马夫刷马（只动肘/腕 + 程序化马刷） | ✅ | 7c95077 |
| P2 收尾 | 文士捧卷轴（含与端茶的四相互斥）+ 马夫手持草料 | ✅ 本轮 |
| P4 | README 补节（research/characters §15/§16） | ✅ 本轮 |
| P4 剩余 | **交付前全量门禁**、**临时探针清理** | ⏳ |

## 2. 本轮做了什么（一句话一条）

- **文士捧卷轴**：两臂各自反解到"卷轴两端木轴"，实测两手相距 0.353m、腕在离地 1.12m、
  木轴落在腕心 10mm；纸面上沿朝人、法线上仰 24°；腕子内旋 0.90（5 变体出图定案）。
  相位机 0 捧读(22~38s)/1 放下/2 喝茶/3 捧起；茶盏只在相位 2 可见。
- **马夫手持草料**：只动左肘 `ex −1.60`（腕在身前 0.116m、离地 1.11m），11 根草
  `InstancedMesh`（1 个 draw call）+ 根黄梢绿渐变贴图，摆在腕前 9cm。

## 3. 验证证据（都可复跑）

| 断言 | 数字 | 探针 |
|---|---|---|
| 卷轴两端木轴 ↔ 两只手腕 | 各 **10mm**（掌厚） | `actor-final-shots.mjs` |
| 两手间距 / 高度 / 纸面法线 | 0.353m / 1.12m / (0.36,0.41,0.84) | 同上 |
| 四相状态机 | 0:w=1 无盏 / 1:w→0 / 2:w=0 有盏 sip=1 / 3:w→0.99 | `actor-scroll-check.mjs` |
| 刷尖贴在马颈颌（z=1.30 站位） | 全程 **42~74mm**，命中高度 1.157~1.283m | `actor-brush-final.mjs` |
| 腰带安全（只转右肘 0.35rad） | Spine/Hips/Chest/Skirt 位移 **0** | `actor-brush-probe.mjs` |
| 草把尺寸 | 0.272×0.105×0.156m，腕前 0.09m | `actor-final-shots.mjs` |

本轮还跑完 `verify:quick` 的三道尾巴：**pageerror-guard 28/28、layout-fingerprint ALL PASS
（网格 189 / 指纹 2971685213 / 变化 0）、random-guard 14/14**。

## 4. 已知边界（不是 bug，别再当缺陷查）

- **马夫够不到马嘴**：这条骨架没有前臂旋前、也不许转肩（腰带误权重），手臂只能在肘上折
  ⇒ 草把只能"拎在身前"（离地 1.11m），不能递到低头马的口鼻（0.87m）。
- **手的指节只有食指/中指/拇指三根骨**，无名指小指是刚性网格 ⇒ 握姿只能靠腕子转。
- **马模型是 AI 低模**（无眼/鼻孔/耳朵细节、腿是方棍）—— 属网格形体，不换资产改不动。
- `probe/figure-audit.mjs` 的"人物配色"判据对 GLB 白模会误报（改判据、不是改材质）。

## 5. 下一步（按优先级）

1. **交付前全量门禁**：`npm run verify`（67 门，约 20~40 分钟；只在交付前跑一次）。
   若某门红：先单跑复核，再 `git stash push -- <改的文件>` 对照 HEAD 定性。
2. **临时探针清理**：`outputs/_diag/actor-*.mjs` 是诊断件（不入库，仓库本来也不跟踪
   `outputs/`）；要留的先例是 `probe/` 下带判据的门禁。
3. 可选：书童的独立动作、马夫的"递草"若要更像，只能换带旋前骨的资产重新绑。
4. 可选：`search_my_assets`/生成管线若要再做新角色，先读
   `docs/characters-asset-spec.md`（预算 1.5MB、1024 JPEG、UniRig 绑骨）。

## 6. 干活入口

```powershell
npm run serve                 # 8935（不要重复起第二个）
npm run check                 # 语法 + no-undef + PWA
npm run verify:quick          # 7 道快门（改完功能先跑这个）
node outputs/_diag/actor-final-shots.mjs   # 人物道具验收图 + 量化
```

---

## 7. 下午追加（2026-10-23）：换马 + 第五个角色

### 7.1 马：Tinker → Rodin 三匹（无骨骼，伪蒙皮）

| 项 | 值 |
|---|---|
| 资产 | `assets/horse-camargue.glb` 782KB / `horse-mongolian.glb` 786KB / `horse-criollo-saddle.glb` 862KB |
| 来源 | 用户已生成资产库（`search_my_assets`），三匹都是 Rodin 生成件，自带耳/眼/鼻孔/蹄形 + 2048 PBR |
| 处理 | `outputs/_diag/horse-cand/convert_horse.py`：脚底 y=0、头朝 +Z、总高 1.75、x/z 居中、贴图降到 1024 JPEG |
| 骨架 | **没有骨骼**（`skins=0`） ⇒ 走项目现成的着色器伪蒙皮 `installHorseRig` |
| 权重 | `rodinRigData()` 按归一化后的实际几何量：四蹄心分簇、颈枢轴 (0,1.26,0.40)、尾根、下颌铰点 |
| 步幅 | `strideWalk = 2×肩高×sin(A) = 0.663m`（用 HORSE_GAIT 常量会滑步） |
| 分配 | 厩内 criollo/camargue、辕里 camargue+mongolian、吃草 camargue、受喂 mongolian |
| 回退 | `src/15-stable.js` 顶部 `HORSE_MODEL = 'tinker'` 一行 |

验证：`outputs/_diag/horse-rodin-check.mjs`（PASS）——六匹都在、`headDot=1`（头朝槽位前方）、
脚下 `minY == groupY`、与厩内任何非马网格**包围盒相交体积 0**、快进 12s 六匹姿态角全都有摆幅、
零 pageerror。出图存 `outputs/_diag/horse-rodin/`（wide/quarter/top/inside/close）。

门禁同步：`probe/horse-motion-guard.mjs` 加了**伪蒙皮分支** —— 没有蒙皮网格时改量
`rig.head/tail/leg/jaw`（尾摆门槛按单位区分：骨骼分支是米、伪蒙皮是弧度），
所以"低头吃草/摇尾/抬蹄/咀嚼/白气"五项一条没退。

⚠️ 两条别踩：① 贴地软影是 1.18×2.30 的**零厚度平面**，算进组包围盒会让相邻两匹"插在一起"
（假阳性 0.51m3），量相交必须只取马本体网格；② 伪蒙皮只注入颜色材质、**没注入深度材质**
⇒ 六匹全部 `castShadow=false` + 贴地软影，否则投影永远是"没低头的站姿"。

### 7.2 第五个角色「客人」

| 项 | 值 |
|---|---|
| 资产 | `assets/fig-guest.glb` 667KB / 11222 tri / **60 骨**（54 + 6 裙骨）|
| prompt | `research/characters/prompts.md` §8（灰褐直裰 + 东坡巾 + 短须 + 略壮，与文士区分）|
| 管线 | Rodin Gen-2.5-Medium → **prep_character.py** → UniRig → repair_hands.py → add_skirt_bones.py → optimize_character.py |
| 落点 | 月洞门内 `(0.15, 20.9)`、`yaw=π`（面朝园内）、`floorRay: true`、`floorMax: 1.20` |

⚠️ **必须先 prep 再绑骨**：原始生成件脚底在 z=−0.947（居中），直接丢给 UniRig 回来的骨架是
"按 0~1 归一化小人"摆的 —— `Hips` 落在 **z=0.027**，整副骨架缩在脚底、与网格完全不贴合；
`add_skirt_bones.py` 会当场报 `hip z=0.027 hem z=0.120 / reweighted=0`（这就是"骨头没落在衣服上"
的可量化信号）。prep 到 `--height 1.70` 之后 `Hips` 回到 **z=0.873**、裙骨 `reweighted=1698`。

⚠️ UniRig 输出里带一个 `Icosphere`（2×2×2），`optimize_character.py` 会按"没有 ARMATURE 修改器"
删掉它；不删场景里会多一个 2m 白球。
