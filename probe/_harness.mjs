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
// ── 2026-10-30 平台感知（第 0 周热修 · CI 收尾③）────────────────────────
// 原来这仨参数是写死的：`--use-angle=d3d11` 是 **Windows 专属后端**，拿到 Linux
// runner 上 Chromium 会忽略它、静默回退 SwiftShader 软渲染（2.4s/帧）——
// 不是报错、是**跑得极慢**，看起来像"卡死"。同一份代码在两种系统上语义不同的东西
// 不该写死。现在按平台分流：
//   · win32  → d3d11（原行为，一位不动）
//   · linux  → vulkan（CI runner 上即便没 GPU 驱动，Chromium 也会落到
//               SwiftShader-Vulkan；比默认 GL 路径报错少）
//   · darwin → 什么都不加（Metal 是默认后端，加 ANGLE 参数反而把它顶掉）
// 软渲染回退仍是 `GARDEN_SOFT=1`（原有开关，语义不变）；新增 `GARDEN_GL=swiftshader`
// 强制软渲染，便于在**有 GPU 的机器上**复现云端的慢速基线。
export const CHROMIUM_ARGS = (() => {
  if (process.env.GARDEN_SOFT === '1') return [];
  const mode = (process.env.GARDEN_GL || '').toLowerCase();
  if (mode === 'swiftshader' || mode === 'soft') return ['--use-gl=swiftshader'];
  if (mode === 'vulkan') return ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  if (process.platform === 'linux')
    return ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  if (process.platform === 'darwin') return ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  return [
    '--use-angle=d3d11',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ];
})();
//
// 用法：
//   import { launchChromium } from './_harness.mjs';
//   const browser = await launchChromium(chromium);
//
// 回退到旧的软渲染 harness（复现历史基线用）：
//   GARDEN_SOFT=1 node probe/xxx.mjs
// 强制走某个后端（见下方平台分流）：
//   GARDEN_GL=swiftshader node probe/xxx.mjs   # 在有 GPU 的机器上复现云端慢速基线
//   GARDEN_GL=vulkan     node probe/xxx.mjs   # 指定 ANGLE 后端
export const CHROMIUM_ARGS = process.env.GARDEN_SOFT === '1' ? [] : [
  '--use-angle=d3d11',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

/* ⚠️ 一律 headless:true。别用 headless:false —— 那会在使用者桌面弹出一个真窗口。 */
export function launchChromium(chromium, extra = {}){
  return chromium.launch({ headless: true, args: CHROMIUM_ARGS, ...extra });
}

/* 本地静态服务器统一走浏览器安全端口。`listen(0)` 也可能被 Windows 分到
   Chrome 的 ERR_UNSAFE_PORT 禁用端口（如 5060），表现为首跑假红、重跑却绿。 */
export async function listenEphemeral(server, host = '127.0.0.1'){
  for (let i = 0; i < 20; i++){
    const port = 40000 + ((Math.random() * 8000) | 0);
    try {
      await new Promise((resolve, reject) => {
        const onError = (e) => { server.off('listening', onListening); reject(e); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return server.address().port;
    } catch (e) {
      if (!e || e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('连续 20 次未找到可用的浏览器安全端口');
}

/* PWA 类的 `launchPersistentContext` 也走同一套参数（它有独立签名，单独包一层）。 */
export const PERSISTENT_ARGS = CHROMIUM_ARGS;

export function launchPersistent(chromium, userDataDir, extra = {}){
  return chromium.launchPersistentContext(userDataDir, { headless: true, args: PERSISTENT_ARGS, ...extra });
}
