// 探针统一 harness（2026-09-18）。**所有浏览器探针都必须走这里，不要再自己写 launch。**
//
// 为什么要有这个文件：
//  无头 Chromium 默认落到 **SwiftShader 软渲染 ≈2427ms/帧**（实测），一次
//  "等 3 帧 + 截图"要 60~90 秒，整套门禁 18 分钟。给它加 D3D11/ANGLE 参数后
//  **37ms/帧（66×）**，renderer 变成真的 GPU。
//
//  ⚠️ ANGLE 到底挑哪块 GPU **不固定**，别把某一次的观察写成前提：
//     2026-09-18 记的是 `Intel Iris Xe`（→ `GPU_TIER = 'low'`，`SUPERSAMPLE = 1.0`、
//     阴影 1024、像素预算 1920×1080×1.1）；
//     2026-09-20 实测是 `ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU …)`（→ `'high'`，
//     超采样 1.15、阴影 2048）。
//     同一台机器两次的**画质档不同**，于是：
//      · 几何 / 状态 / layer / 计数类断言**与档位无关** → 仍与旧基线可比；
//      · **像素类**断言（mist-guard / postcard-guard / refract-guard）的阈值**必须容忍档位差**，
//        不能当成跨档可比。探针里要报档位就打印 `GPU_NAME` / `GPU_TIER`，别假设。
//
//  唯一的行为差异是 QOS：它原来的免疫判据是 `SOFTWARE_GL`，换到真 GPU 后变 false
//  → 自适应被激活、量 12 帧就自己降档，而它会动态改 scale / 阴影尺寸。
//  这个已在 index.html 侧改成"认 `navigator.webdriver`"（被自动化驱动就免疫），
//  所以探针这边**不需要任何额外动作** —— 启动即免疫。
//
// 用法：
//   import { launchChromium } from './_harness.mjs';
//   const browser = await launchChromium(chromium);
//
// 回退到旧的软渲染 harness（复现历史基线用）：
//   GARDEN_SOFT=1 node probe/xxx.mjs
export const CHROMIUM_ARGS = process.env.GARDEN_SOFT === '1' ? [] : [
  '--use-angle=d3d11',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

/* ⚠️ 一律 headless:true。别用 headless:false —— 那会在使用者桌面弹出一个真窗口。 */
export function launchChromium(chromium, extra = {}){
  return chromium.launch({ headless: true, args: CHROMIUM_ARGS, ...extra });
}

/* PWA 类的 `launchPersistentContext` 也走同一套参数（它有独立签名，单独包一层）。 */
export const PERSISTENT_ARGS = CHROMIUM_ARGS;

export function launchPersistent(chromium, userDataDir, extra = {}){
  return chromium.launchPersistentContext(userDataDir, { headless: true, args: PERSISTENT_ARGS, ...extra });
}
