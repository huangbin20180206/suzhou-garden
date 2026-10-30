// 00a-quality：画质档位判定（**纯函数，零 DOM、零 three**，2026-10-30 第 0 周热修 · 架构收口）
//
// ── 为什么单独成文件 ──────────────────────────────────────────────────────
// 档位判定原来长在 `02-scene.js` 里，而那个文件顶层会 `new THREE.WebGLRenderer(...)`、
// 建场景、挂 DOM —— 于是这段"看 GPU 名字决定画质"的逻辑**在 node 里根本无法被测试**，
// 而它恰恰是"错了也没人知道"的那类：
//   · 判错成 high：手机/核显按 4K 预算 + 6144 阴影 + 1.25 超采样跑 ⇒ 发热降频反而更卡；
//   · 判错成 low：独显用户白白吃低画质，看得到但以为是"程序就这水平"；
//   · 两者都**不报错、不崩、门禁全绿**，只有换台机器才现形。
// 2026-10-30 那次修（手机落 mid / 独显正则扩到 RTX-RX 全系 / 未知不再默认 high）
// 就是在没有任何测试网的情况下摸黑改的。现在把它提成纯函数，进 `npm run unit`。
//
// ── 边界 ────────────────────────────────────────────────────────────────
// 本文件只放**判定**（输入 GPU 名 + UA + 触点数 → 输出 'low'|'mid'|'high'）。
// 档位对应的具体数值（预算/阴影/粒子）仍留在 02-scene 的 QUALITY_PRESETS —— 那里
// 是"当前档的数值真值"，与"怎么判出这个档"是两件事，混在一起就又回到不可测。

/* 低档：核显 / 软渲染。这两个词表来自实测的 UNMASKED_RENDERER_WEBGL 输出，
   加新词之前先确认真遇到过（别凭想象写 "Intel" 之外的猜测词）。 */
const LOW_RE = /Intel|Iris|UHD Graphics|HD Graphics|Radeon\(TM\) Graphics|Vega|llvmpipe|SwiftShader/i;

/* 高档：叫得出名字的独显。原来只认 GTX 10xx/20xx —— RTX 30/40/50 全靠"未知=high"蒙对，
   一改默认值（未知不再 high）就会把独显用户也降档，所以这里必须把全系列上。 */
const HIGH_RE = /Apple M[1-9]|Intel Arc|GTX\s*\d{3,4}|RTX\s*\d{3,4}|Radeon RX\s*\d+/i;

/* 手机 / 平板：Adreno / Mali 在 GPU 名里哪个正则都不中，只能看 UA。
   ⚠️ iPadOS 13+ 的 UA **冒充 Macintosh**，所以还要靠 maxTouchPoints > 1 兜住
      （Mac 的触控板不会让这个值大于 1）。 */
export function isMobileUA(userAgent = '', maxTouchPoints = 0){
  const ua = String(userAgent || '');
  if (/Android|iPhone|Mobi/i.test(ua)) return true;
  return /Macintosh/.test(ua) && Number(maxTouchPoints) > 1;
}

/* 档位判定唯一入口。`gpuName` 是 `WEBGL_debug_renderer_info` 的 UNMASKED_RENDERER_WEBGL；
   取不到时传空串（→ 落到 mid，不再默认 high）。
   优先级：低档词表 → 移动端 → 独显词表 → 其余一律 mid。 */
export function pickTier({ gpuName = '', userAgent = '', maxTouchPoints = 0 } = {}){
  if (LOW_RE.test(String(gpuName || ''))) return 'low';
  if (isMobileUA(userAgent, maxTouchPoints)) return 'mid';
  return HIGH_RE.test(String(gpuName || '')) ? 'high' : 'mid';
}

/* ── 调试接口是否展开（2026-10-30 · 架构收口）───────────────────────────────
   `window.__garden` 挂着 100+ 个内部对象与后门（setXxx），是门禁的唯一驱动面，
   不能删；但线上不该让任何人从控制台改场景状态。
   判据：`?debug=1` 显式要求 / 被自动化驱动（navigator.webdriver）/ 本机打开。
   ⚠️ **本机一律算调试态**：localhost、127.0.0.1、`*.localhost`、以及 `file://`
      （hostname 为空）—— 老黄始终本机打开，他的体验一位不变。
   ⚠️ 提成纯函数是为了让**生产分支**有测试网：本机永远走不到那条分支，
      不抽出来就只能靠"读代码觉得对"（本项目最不信任的验证方式）。 */
export function isDebugSurface({ search = '', webdriver = false, hostname = '' } = {}){
  if (String(search).includes('debug=1')) return true;
  if (webdriver === true) return true;
  const h = String(hostname || '');
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
}
