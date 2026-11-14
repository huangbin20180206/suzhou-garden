# 试水2 · Blender 侧改浅灰参数记录（2026-10-14 17:00-18:10）

## 状态

**Blender 侧转换 + 调色已完成；代码接线按 Chief 18:0x 停手令已回滚**
（src/08-assemble.js、src/13-preload.js、sw.js 回到开工时状态；两块候选 GLB 从 assets/ 撤到
`research/cc0-scout/hero2-candidates/`，树冻结不动。等"树解冻"信号再进代码。）

## 方法与参数（同一个脚本对两块石执行）

脚本：`convert-hero-glbGray.py`（本目录），口径对两块石头完全一致。

| 项 | 参数 | 说明 |
|---|---|---|
| 改动对象 | 仅 Base Color 入口的 diffuse 贴图像素 | 法线 / 粗糙度 / AO / arm 贴图与 PBR 链**一字未动** |
| 去色 | RGB = 灰度（0.2126/0.7152/0.0722 加权） | 彻底去饱和，灰阶替代原褐彩 |
| 亮度归一 | `s = 0.62 / 原亮度均值`，**上限 2.5** | 防暗部提白后细节炸裂 |
| 灰阶范围 | `g = 0.25 + g*(0.95-0.25)` | 保留原贴图明暗细节，只做线性重映射 |
| 几何 | 未动 | 同一脚本同时做"最长轴旋到 +Z"的立姿摆放（与 boulder 同规则） |
| 导出 | export_format="GLB"，3 张贴图内嵌 | 4 个环境全离线 |

## 实测调色前后（Blender stderr + PIL 复核）

| 模型 | 文件 | 原色均值 | 改后 | scale | 复核手段 |
|---|---|---|---|---|---|
| boulder_01 | boulder-hero.glb | (0.442, 0.363, 0.289) 深褐 | lumMean 0.374→**0.684** | **1.66** | PIL 算内嵌 diffuse jpg：R=G=B=174.3（sat=0.000 纯灰） |
| stone_01 | stone-hero.glb | (0.497, 0.356, 0.271) 深褐 | lumMean 0.380→**0.681** | **1.63** | PIL 算内嵌 diffuse jpg：R=G=B=173.8（sat=0.000 纯灰） |

> 说明：改色是全图灰度化（灰+无彩色），**没有保留石材的暖色/冷色倾向**。若用户看三方对比后觉得
> "太素"，下一步可把色调微调到浅冷灰（如 RGB 同阶 +8% 蓝），再走同一脚本只调 TARGET 常量即可。

## 产物（未进 assets/，进 research/）

| 文件 | 体积 | 面数 | 立姿 bbox | 底部 |
|---|---|---|---|---|
| hero2-candidates/boulder-hero.glb | **5.21 MB** | 66122 | 1.27 × **1.83** × 1.00 m | y=0 ✓ |
| hero2-candidates/stone-hero.glb | **3.05 MB** | 53520 | 0.07 × **0.15** × 0.09 m | y=0 ✓ |

（原深褐版 boulder-hero.glb 快照留档 `outputs/_snap/hero2-assets_boulder-hero.glb`，可比对回退。）

## 先前离线解析结论（供解冻后接线用）

- glTF 头/长度/bin chunk/三张内嵌 jpg 均闭合（magic=glTF、ver 2）；node 上带立姿四元数，GLTFLoader 会应用。
- 3 张贴图按 1024×1024；diffuse 改色已由 PIL 独立复核为纯灰（R=G=B，sat=0.000）。
- stone_01 原生尺度 0.147m（小石块）——按归一化 targetSize 4.49 会放到 4.49m 高、2.2m宽，
  与 boulder（4.49m高、3.13m宽）同量级，三方视觉体量可比；若用户嫌 stone 放太高，改 targetSize 一处即可。
