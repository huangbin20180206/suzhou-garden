// 天空视觉层专项门禁：node probe/sky-layer-guard.mjs
//
// 守一件事：**挂在天上的大视觉层，不许进 GTAO 的法线/深度 pre-pass**。
//
// Why 要有这道门（2026-10-04，老黄"进门首个画面就是这个大黑框"）：
//   GTAO 的 pre-pass 是拿 override 材质把**整个场景再画一遍** —— 被画进去的对象，
//   自己 shader 里的 `discard` / `depthWrite:false` / `blending` 全部不作数。
//   一条悬在天空里的薄带（虹拱 R=68m、带宽 5.2m，两侧都是天空）进了 AO 的深度缓冲后，
//   那片 AO 被算成 ≈0 再乘回画面 ⇒ **天上一条实心黑拱**（实测 9.24% 暗像素 ↔ 修后 0.37%）。
//   姊妹案例：闪电 bolt/streak（懒建的 Group）同样把**自己的亮痕**压暗（足迹 120px、
//   最大差 268；注意那一测 bolt 自身 opacity=0 —— 这 120px 全是被 AO 压出来的黑痕）。
//
// ⚠️⚠️ 这道门**必须强制 `?tier=high`**：`AO_ENABLED` 只在均衡/高两档为真，性能档压根没有 AO。
//   本机无头 Chromium 常落 Intel Iris Xe ⇒ `GPU_TIER='low'` ⇒ 全部既有门禁都在"没有 AO"
//   的地基上跑 —— 这就是"我这 57 道全绿、老黄一进游戏就是黑框"的**全部原因**。
//   断言前提（第 1 条）是这道门的地基，别删。
//
// 判据的牙（负例自检）：① 运行时撤掉虹拱的 aoSkip 标记 + 重收排除表 ⇒ 暗拱必须复现；
//   ② 运行时把闪电组从 AUX_PASS_HIDDEN 摘掉 ⇒ 压暗足迹必须复现。
//   两条都做过，且都实测报红（本门第一次跑就必须先证明自己能红）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs/sky-layer-guard');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

/* 天空暗拱指标：只统计画面中上部（y 2%~20%、x 2%~98%）。
   远山是浅灰（luma 150~195）、天空更亮 ⇒ 只有"被 AO 压出来的黑拱"会被数进来；
   同一条带里的彩色占比用于确认"虹还画着"（虹被弄没了也会让这条掉下来）。 */
const SKY_METRIC = () => {
  const cv = window.__skyShot;
  const cx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const d = cx.getImageData(0, 0, W, H).data;
  let dark = 0, dn = 0, color = 0, cn = 0;
  for (let y = Math.floor(H * 0.02); y < Math.floor(H * 0.20); y++){
    for (let x = Math.floor(W * 0.02); x < W * 0.98; x += 2){
      const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      dn++; if (L < 70) dark++;
      if (L > 90){ cn++; if (Math.max(r, g, b) - Math.min(r, g, b) > 28) color++; }
    }
  }
  return { darkPct: +(100 * dark / dn).toFixed(2), colorfulPct: +(100 * color / cn).toFixed(2) };
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1584, height: 827 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.waitForTimeout(1500);

  /* 页内工具：拿虹网格 / 拿闪电组 / 抓一张"当前画面"到 __skyShot / 重收 AO 排除表 */
  await page.evaluate(() => {
    window.__RB = () => { let m = null; window.__garden.scene.traverse(o => { if (o.isMesh && o.material && o.material.uniforms && o.material.uniforms.uRainbow) m = o; }); return m; };
    window.__SHOT = () => {
      /* ⚠️ 必须**同任务**渲染 + 取像素：renderer 的绘制缓冲不保留（preserveDrawingBuffer=false），
         跨 evaluate 再 drawImage 拿到的是一张全黑图（第一版就踩了这个：darkPct=100、彩色 NaN）。 */
      const G = window.__garden, cv = G.renderer.domElement;
      G.composer.render();
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0); window.__skyShot = c;
    };
  });

  /* ── 1) 前提：高档真的生效（AO 必须有，否则本门恒假绿） ────────────── */
  const pre = await page.evaluate(() => {
    const g = window.__garden;
    const gtao = g.composer.passes.find(p => p.userData && 'aoScale' in p.userData) || null;
    return { gtao: !!gtao, enabled: !!(gtao && gtao.enabled), aoScale: gtao ? gtao.userData.aoScale : null,
             pr: +g.renderer.getPixelRatio().toFixed(3) };
  });
  check('前提：?tier=high 生效且 GTAO 在链上（本门的地基）',
    pre.gtao && pre.enabled && pre.aoScale === 0.5, JSON.stringify(pre));

  /* ── 2) 晴天：天上不许有暗拱 ─────────────────────────────────────── */
  await page.evaluate(() => window.__SHOT());
  const clear = await page.evaluate(SKY_METRIC);
  fs.writeFileSync(path.join(OUT, 'clear-high.png'), await page.screenshot({ scale: 'css' }));
  check('晴·高档：天上没有 AO 压出来的暗拱（<1.5%）', clear.darkPct < 1.5, `darkPct=${clear.darkPct}`);

  /* ── 3) 负例自检：撤掉 aoSkip 标记 ⇒ 暗拱必须复现（证明第 2 条有牙） ── */
  await page.evaluate(async () => {
    const m = await import('/src/10-post.js');
    window.__RB().userData.aoSkip = false;
    m.collectAOSkip();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__SHOT());
  const neg = await page.evaluate(SKY_METRIC);
  fs.writeFileSync(path.join(OUT, 'clear-high-negctl.png'), await page.screenshot({ scale: 'css' }));
  check('负例自检：撤掉 aoSkip 后暗拱必须复现（>5%）', neg.darkPct > 5, `darkPct=${neg.darkPct}`);

  /* 还原修复态 */
  await page.evaluate(async () => {
    const m = await import('/src/10-post.js');
    window.__RB().userData.aoSkip = true;
    m.collectAOSkip();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__SHOT());
  const back = await page.evaluate(SKY_METRIC);
  check('还原 aoSkip 后暗拱消失（<1.5%）', back.darkPct < 1.5, `darkPct=${back.darkPct}`);

  /* ── 4) 雨后初晴：虹要照常画出来（修黑拱不能把虹一起弄没） ────────── */
  await page.evaluate(() => window.__garden.setEnv('weather', 'afterrain'));
  await page.waitForFunction(() => window.__garden.ENV.t >= 0.99, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(400);
  const envT = await page.evaluate(() => +window.__garden.ENV.t.toFixed(3));
  await page.evaluate(() => window.__SHOT());
  const rain = await page.evaluate(SKY_METRIC);
  fs.writeFileSync(path.join(OUT, 'afterrain-high.png'), await page.screenshot({ scale: 'css' }));
  check('雨后初晴：ENV 过渡已完成（前提）', envT >= 0.99, `ENV.t=${envT}`);
  check('雨后初晴：虹照常画出来（彩色占比 ≥ 晴天 +1.0）',
    rain.colorfulPct >= clear.colorfulPct + 1.0, `clear=${clear.colorfulPct} rain=${rain.colorfulPct}`);
  check('雨后初晴：天上仍然没有暗拱（<1.5%）', rain.darkPct < 1.5, `darkPct=${rain.darkPct}`);

  /* ── 5) 姊妹案例：闪电组（懒建）必须在 AUX_PASS_HIDDEN 里 ───────── */
  await page.evaluate(() => window.__garden.setEnv('weather', 'storm'));
  await page.waitForTimeout(2500);
  const struct = await page.evaluate(async () => {
    const m = await import('/src/01-materials.js');
    window.__garden.lightningStrikeNow();
    window.__garden.setLightningHold(0.30);
    let bolt = null;
    window.__garden.scene.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0xE8F0FF) bolt = o; });
    window.__BOLT = bolt; window.__LIST = m.AUX_PASS_HIDDEN;
    return { built: !!bolt, group: !!(bolt && bolt.parent), listed: !!(bolt && bolt.parent && m.AUX_PASS_HIDDEN.includes(bolt.parent)),
             rbFlag: window.__RB().userData.aoSkip === true };
  });
  await page.waitForTimeout(1200);
  check('结构：虹拱带 userData.aoSkip 标记', struct.rbFlag);
  check('结构：闪电组（懒建）已登记进 AUX_PASS_HIDDEN', struct.built && struct.group && struct.listed, JSON.stringify(struct));

  /* 冻结帧同任务 A/B：切换 bolt.visible 的画面足迹（同配置连渲两次必须逐位 0 作自检） */
  const footprint = () => {
    const G = window.__garden, cv = G.renderer.domElement, W = cv.width, H = cv.height;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const a = mk(), b = mk(), s1 = mk(), s2 = mk();
    const v = window.__BOLT.visible;
    window.__BOLT.visible = false; G.composer.render(); a.getContext('2d').drawImage(cv, 0, 0);
    window.__BOLT.visible = true;  G.composer.render(); b.getContext('2d').drawImage(cv, 0, 0);
    window.__BOLT.visible = v;
    G.composer.render(); s1.getContext('2d').drawImage(cv, 0, 0);
    G.composer.render(); s2.getContext('2d').drawImage(cv, 0, 0);
    const pa = a.getContext('2d').getImageData(0, 0, W, H).data, pb = b.getContext('2d').getImageData(0, 0, W, H).data;
    const q1 = s1.getContext('2d').getImageData(0, 0, W, H).data, q2 = s2.getContext('2d').getImageData(0, 0, W, H).data;
    let n = 0, max = 0, self = 0;
    for (let i = 0; i < pa.length; i += 4){
      if (q1[i] !== q2[i] || q1[i + 1] !== q2[i + 1] || q1[i + 2] !== q2[i + 2]) self++;
      const d = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
      if (d > 75){ n++; if (d > max) max = d; }
    }
    /* 前提：闪电有多少顶点在画面内（都在画外的话足迹恒 0，判据就没意义） */
    const cam = G.camera; cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    const p = window.__BOLT.geometry.attributes.position; let inView = 0;
    if (p){ const t = new G.THREE.Vector3(); for (let i = 0; i < p.count; i++){ t.set(p.getX(i), p.getY(i), p.getZ(i)).project(cam); if (Math.abs(t.x) <= 1 && Math.abs(t.y) <= 1 && t.z <= 1) inView++; } }
    return { boltPx: n, maxDelta: max, selfcheckDiffPx: self, inView, verts: p ? p.count : 0 };
  };

  const boltFix = await page.evaluate(footprint);
  check('闪电：排除后「可见性切换」不留压暗足迹（=0）', boltFix.boltPx === 0, JSON.stringify(boltFix));
  check('闪电：帧自检——同配置连渲两次逐位相同', boltFix.selfcheckDiffPx === 0, `diff=${boltFix.selfcheckDiffPx}`);
  check('闪电前提：至少 30 个顶点在画面内', boltFix.inView >= 30, `inView=${boltFix.inView}/${boltFix.verts}`);

  const boltNeg = await page.evaluate(async () => {
    const i = window.__LIST.indexOf(window.__BOLT.parent);
    if (i >= 0) window.__LIST.splice(i, 1);
    return i;
  });
  await page.waitForTimeout(400);
  const boltNegF = await page.evaluate(footprint);
  check('负例自检：把闪电组从 AUX_PASS_HIDDEN 摘掉 ⇒ 压暗足迹必须复现（>50px）',
    boltNegF.boltPx > 50, `boltPx=${boltNegF.boltPx} maxDelta=${boltNegF.maxDelta}`);
  await page.evaluate(async (idx) => { if (idx >= 0 && !window.__LIST.includes(window.__BOLT.parent)) window.__LIST.push(window.__BOLT.parent); }, boltNeg);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[sky-layer-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[sky-layer-guard] 探针异常：', e); process.exit(2); });
