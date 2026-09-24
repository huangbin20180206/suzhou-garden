// GTAO 半分辨率门禁（2026-09-24 · 计划书第 1 项）
//
// 守什么：GTAO 的三张内部 RT（法线 / AO / 泊松去噪）必须是**半分辨率**，而且
//   **在 `composer.setSize` 之后仍然是半分辨率** —— 窗口 resize（11-loop.js:28）与
//   QOS 变分辨率（11-loop.js:536）都会回调每个 pass 的 setSize。只把半尺寸交给构造函数
//   是不够的：下一次 setSize 就把它拉回全尺寸（计划书原文点名警告过这个坑）。
//
// 为什么做成**状态门（零像素）**：判据是"RT 尺寸"这个确定量，与 GPU 档位/就绪竞态无关，
//   不会像像素门那样随档位漂。而这条一旦退化，**画面几乎看不出**（只是白丢性能）——
//   正是必须靠门禁守住的"静默性能回退"。
//   （画质那半边由 `outputs/_diag/gtao-ab.mjs` 的冻结帧 A/B 量：全↔半 = 0.77、
//     全↔关AO = 2.74 ⇒ 半分辨率的差异远小于 AO 自身的存在感。本门不重复做像素。）
//
// 档位前提：核显档（low）**本来就没有 AO**（`AO_ENABLED = GPU_TIER !== 'low'`）⇒
//   本门强制 `?tier=high`，否则在核显机器上会"因为根本没有这个 pass 而永远跳过"。
// 用法: node probe/gtao-halfres.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  await new Promise(r => server.listen(13000 + ((Math.random() * 17000) | 0), r));
  const port = server.address().port;
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  console.log(`\n[gtao-halfres] http://127.0.0.1:${port}/index.html?tier=high`);

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0&tier=high', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  const st = await page.evaluate(() => {
    const g = window.__garden;
    const pass = g.composer.passes.find(p => p.userData && 'aoScale' in p.userData);
    const rb = g.composer.readBuffer;
    return pass
      ? { ok: true, w: pass.width, h: pass.height, scale: pass.userData.aoScale,
          composerW: rb.width, composerH: rb.height, enabled: pass.enabled }
      : { ok: false, passes: g.composer.passes.map(p => p.constructor.name) };
  });
  check('tier=high 下存在 GTAO pass（核显档本来无 AO，故本门强制高档）', st.ok,
    st.ok ? `pass=${st.w}×${st.h} · composer=${st.composerW}×${st.composerH} · aoScale=${st.scale}`
          : '找不到带 userData.aoScale 的 pass；passes=' + (st.passes || []).join(','));
  if (!st.ok){ check('（后续判据）', false, '没有 GTAO pass 就无法判'); }
  else {
    check('① 初始就是半分辨率（pass 尺寸 = composer 尺寸 × 0.5）',
      st.w === Math.round(st.composerW * 0.5) && st.h === Math.round(st.composerH * 0.5),
      `pass ${st.w}×${st.h} vs composer×0.5 ${Math.round(st.composerW * 0.5)}×${Math.round(st.composerH * 0.5)}`);

    /* ② 关键回归：composer.setSize（窗口 resize / QOS 变分辨率）之后必须**仍然**半分辨率。
       实测把 setSize 包装去掉后这条会红（pass 被拉回全尺寸）—— 即计划书点名的那个坑。 */
    const after = await page.evaluate(() => {
      const g = window.__garden;
      const pass = g.composer.passes.find(p => p.userData && 'aoScale' in p.userData);
      g.composer.setSize(1600, 900);
      const rb = g.composer.readBuffer;
      return { w: pass.width, h: pass.height, cw: rb.width, ch: rb.height };
    });
    check('② composer.setSize(1600,900) 之后仍半分辨率（resize / QOS 不会拉回全尺寸）',
      after.w === Math.round(after.cw * 0.5) && after.h === Math.round(after.ch * 0.5),
      `pass ${after.w}×${after.h} vs composer ${after.cw}×${after.ch}`);

    /* ③ A/B 钩子（userData.aoScale）必须真的能改倍率 —— 诊断脚本的"全尺寸 vs 半尺寸"靠它；
       若钩子失效，A/B 会量到"全 vs 全"而静默得出"零差异"的假结论。 */
    const hook = await page.evaluate(() => {
      const g = window.__garden;
      const pass = g.composer.passes.find(p => p.userData && 'aoScale' in p.userData);
      pass.userData.aoScale = 1;  g.composer.setSize(1600, 900);
      const full = { w: pass.width, h: pass.height, cw: g.composer.readBuffer.width };
      pass.userData.aoScale = 0.5; g.composer.setSize(1600, 900);
      const half = { w: pass.width, h: pass.height, cw: g.composer.readBuffer.width };
      return { full, half };
    });
    /* ⚠️ 期望值要用 **composer 的实际尺寸**（`setSize` 传给各 pass 的是 `width × pixelRatio`，
       本项目 RENDER_SCALE=1.15 ⇒ 1600 会变成 1840），别拿入参 1600 去比；
       且 composer 尺寸带浮点尾数（1839.9999999999998）⇒ 一律 round 后比。 */
    check('③ A/B 钩子 userData.aoScale 有效（1 ⇒ 全尺寸；0.5 ⇒ 半尺寸）',
      hook.full.w === Math.round(hook.full.cw) && hook.half.w === Math.round(hook.half.cw * 0.5),
      `aoScale=1 → ${hook.full.w}×${hook.full.h}（composer ${hook.full.cw}）；` +
      `aoScale=0.5 → ${hook.half.w}×${hook.half.h}（composer ${hook.half.cw}）`);

    /* ④ 还原真实尺寸后仍是半分辨率（别把页面留在 A/B 的中间态） */
    const back = await page.evaluate(() => {
      const g = window.__garden;
      const pass = g.composer.passes.find(p => p.userData && 'aoScale' in p.userData);
      pass.userData.aoScale = 0.5;
      g.composer.setPixelRatio(g.renderer.getPixelRatio());
      g.composer.setSize(innerWidth, innerHeight);
      const rb = g.composer.readBuffer;
      return { w: pass.width, h: pass.height, cw: rb.width, ch: rb.height };
    });
    check('④ 还原 innerWidth/Height 后仍是半分辨率', back.w === Math.round(back.cw * 0.5),
      `pass ${back.w}×${back.h} vs composer ${back.cw}×${back.ch}`);
  }

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[gtao-halfres] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[gtao-halfres] 探针自身异常：', e); process.exit(1); });
