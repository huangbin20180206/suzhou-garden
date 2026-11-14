# 2026-11-10 灯笼体积光「衰减从未生效」修复 · 证据包

状态：**已修复**（本目录为修复当时的读数留档，不是待办）。

## 缺陷

`src/12d-lantern.js` 光团（`lampVolMat`）片元着色器里写着：

```glsl
float rl = length(vP);          // vP 以球心（灯笼发光中心）为原点
if (rl > 1.0) discard;
float atten = exp(-rl * 3.0);   // 注释：光随距离指数衰减
```

而光团网格是 `new THREE.SphereGeometry(1, 24, 16)` + `vol.scale.set(vr, vr, vr)`（等比例缩放），
所以每个片元的 `|vP|` 恒等于 1 ⇒ `rl ≡ 1` ⇒ `atten ≡ exp(-3) = 0.0498` 是个常量。

后果：注释承诺的"中心亮、向外快快散开"从未发生，整团光是一片**均匀涂层**（`if (rl > 1.0) discard`
同样是死代码，永不成立）。这类缺陷不报错、不崩、不影响任何其它断言，只能靠读代码或像素剖面发现。

## 修法

把「到球心的距离」换成**撞击参数**（球心到"相机→本片元"这条视线的垂距，在视图空间里量），
再按球半径归一：

```glsl
vec3 rayDir = normalize(vViewPos);
float impact = length(cross(vCenterView, rayDir));
float rn = clamp(impact / max(vRadView, 1e-4), 0.0, 1.0);
float atten = 0.28 * exp(-rn * 3.0);
```

- 视线正穿球心 → `rn = 0`（穿过最厚的一层光，最亮）；擦过盘面边缘 → `rn = 1`（最暗）。
- 新增三个 varying：`vViewPos`（片元位置）、`vCenterView`（球心位置，取 `modelViewMatrix` 平移列）、
  `vRadView`（球半径在视图空间的长度 = `length(modelViewMatrix[0].xyz)`，等比例缩放成立）。
- **0.28 这个系数是算出来的，不是调出来的**：全盘面积加权均值
  `0.28 × 2∫₀¹ r·e^(−3r)dr = 0.28 × 0.17796 = 0.0498`，与原实现的常量总光量一致。
  这样"修 bug"不会顺带把门禁的抬亮读数整体位移，读数变化可归因于形状而非总量。

判据文件一个都没改。

## 读数（改前 / 改后，同一台机器、同一份代码其余部分）

| 门 | 改前（HEAD=90c572f） | 改后 |
|---|---|---|
| `probe/lampvol-guard.mjs` | **41/43**，阳性对照 `局部 luma 116.61 → 115.46（差 1.432；σ≈0.793 ⇒ 1.8σ）` **红**；「还原 uLamp 后亮度回到开灯态」**红**（差 0.759 vs 信号 1.432） | **43/43**，阳性对照 `119.79 → 114.01（差 5.798；σ≈0.063 ⇒ 92.4σ）` 绿 |
| `probe/lamp-guard.mjs` | —（未在改前跑，见下） | **ALL PASS（17 项）**，115.6s |
| `npm run check` | PASS | **PASS**（60 编译单元 / 381 文本文件 UTF-8 / PWA v45·v23 未越界） |

诚实标注两点：

1. **`lamp-guard` 没有改前读数**。它守的是灯体几何、灯数、时段联动，与光团着色器无关；改动只碰
   `lampVolMat` 的两个着色器字符串，跑它是为了确认没被牵连，不是用来证明修复有效。真正的前后对照
   是 `lampvol-guard` 那一行。
2. **改前那 41/43 是这台机器的基线，不是本次改动造成的**。改前读数在 `00-before-lampvol.log`，
   时间 09:23，早于任何编辑。它顺带说明：这条门在修前就贴着分辨力下限（信号 1.432 luma vs
   同状态 σ 0.793，仅 1.8σ），修后信号涨到 5.798、σ 降到 0.063（92.4σ）——**形状对了，门才站得住**。

## 文件

- `00-before-lampvol.log` — 改前 lampvol 全量输出（41/43，含两条 ✗ 原文）
- `01-after-lampvol.log` — 改后 lampvol 全量输出（43/43）
- `01-after-lampvol-on.png` / `01-after-lampvol-off.png` — 改后光团开/关样张（像素证据）
- `02-after-lampguard.log` — 灯体门 17 项全过
