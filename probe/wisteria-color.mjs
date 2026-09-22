// 紫藤配色门禁（2026-09-17）：老黄拿参考图核出"颜色反掉了"—— 这类**方向性**错误
// （渐变写反）不会有任何报错、也不会被别处的断言拦住，只能靠人眼，于是被抓到第二次。
// 本探针把参考图给出的规律变成可执行判据：**花穗越靠上越浅、越靠下越深**。
//
// 判据不是"猜"，是量：读花穗 InstancedMesh 的 instanceColor + instanceMatrix，
// 逐朵算世界 y 与明度 L，然后
//   ① 报最亮/最暗朵的色值（应与 index.html 的 paleC/deepC 两个端点对得上）；
//   ② 报 y 与 L 的**相关系数** —— 写反了就是强负相关；
//   ③ 按索引顺序切出"同穗连续段"（同一穗的 k 递增 = 一路向下），逐段比较
//      前 1/4 与后 1/4 的平均明度，统计通过率（结构性判据，比相关系数更硬）。
// 只读页面状态。用法: node probe/wisteria-color.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
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
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.setDefaultTimeout(180000);
  const msgs = [];
  page.on('pageerror', e => msgs.push('[pageerror] ' + e));
  page.on('console', m => { if (m.type() === 'error') msgs.push('[error] ' + m.text()); });

  // 绕开 SwiftShader 的"低端设备"分支（与 wind-audit 同款 spoof）
  await page.addInitScript(() => {
    const ENUM = 0x9246, VENDOR = 0x9245;
    const patch = (proto) => {
      if (!proto) return;
      const orig = proto.getParameter;
      proto.getParameter = function (p){
        if (p === ENUM || p === VENDOR) return 'NVIDIA GeForce RTX 4080 (probe spoof)';
        return orig.call(this, p);
      };
    };
    patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  });

  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000 });
  /* 紫藤属"延迟批"，比 GLB 晚但比首帧早；直接轮询到花穗实例出现为止（固定 sleep 会踩空） */
  const ok = await page.waitForFunction(() => {
    let found = 0;
    window.__garden.scene.traverse(o => {
      if (o.isInstancedMesh && o.instanceColor && o.count > 200) found++;
    });
    return found > 0;
  }, { timeout: 120000, polling: 500 }).then(() => true).catch(() => false);
  console.log('[wisteria-color] 花穗实例就绪: ' + ok);
  if (!ok){ await browser.close(); server.close(); process.exit(1); }

  const data = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    /* 定位：先按 seasonWisteriaLeaf 找到叶卡实例 → 其父组即整丛紫藤；
       花穗实例 = 同一父组下另一个带 instanceColor 的 InstancedMesh。 */
    let leafInst = null;
    g.scene.traverse(o => { if (o.isInstancedMesh && o.userData.seasonWisteriaLeaf && !leafInst) leafInst = o; });
    if (!leafInst) return { found: false, why: 'seasonWisteriaLeaf 实例未找到' };
    const root = leafInst.parent;
    root.updateWorldMatrix(true, true);
    let fl = null;
    root.traverse(o => { if (o.isInstancedMesh && o.instanceColor && o !== leafInst && (!fl || o.count > fl.count)) fl = o; });
    if (!fl) return { found: false, why: '花穗 InstancedMesh 未找到' };

    const m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
    /* ⚠️ instanceColor 里存的是**线性空间**值（ColorManagement 把 hex 转成 linear-srgb），
       直接拿它算"亮度"是 0~1 量纲，跟 hex 的 0~255 对不上号 ——
       必须 convertLinearToSRGB 回到 sRGB 再算 L，报告与阈值才有可比性。 */
    const rows = [];
    for (let i = 0; i < fl.count; i++){
      fl.getMatrixAt(i, m); m.decompose(p, q, s);
      p.applyMatrix4(root.matrixWorld);
      const c = new T.Color().fromBufferAttribute(fl.instanceColor, i).convertLinearToSRGB();
      rows.push({ i, y: p.y,
                  L: (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * 255,
                  hex: '#' + c.getHexString(T.LinearSRGBColorSpace).toUpperCase() });
    }
    const n = rows.length;
    const meanY = rows.reduce((a, r) => a + r.y, 0) / n;
    const meanL = rows.reduce((a, r) => a + r.L, 0) / n;
    let cov = 0, vy = 0, vl = 0;
    for (const r of rows){ const dy = r.y - meanY, dl = r.L - meanL; cov += dy * dl; vy += dy * dy; vl += dl * dl; }
    const corr = (vy > 0 && vl > 0) ? cov / Math.sqrt(vy * vl) : 0;

    const sorted = rows.slice().sort((a, b) => a.L - b.L);
    const brightest = sorted[sorted.length - 1], darkest = sorted[0];

    /* 同穗连续段：同一穗内 k 递增 → 一朵比一朵低（y 严格下降）。
       遇 y 回升 = 换穗（或撞上随机散布的"走茎花"）。段长 <8 丢掉（多是走茎花的噪声）。 */
    const runs = [];
    let cur = [rows[0]];
    for (let i = 1; i < n; i++){
      if (rows[i].y < rows[i - 1].y) cur.push(rows[i]);
      else { runs.push(cur); cur = [rows[i]]; }
    }
    runs.push(cur);
    const long = runs.filter(r => r.length >= 8);
    const avgL = arr => arr.reduce((a, r) => a + r.L, 0) / arr.length;
    let pass = 0;
    const deltas = [];
    for (const r of long){
      const k = Math.max(1, Math.round(r.length / 4));
      const d = avgL(r.slice(0, k)) - avgL(r.slice(-k));
      deltas.push(d);
      if (d > 0) pass++;
    }
    const passRate = long.length ? pass / long.length : 0;
    const medDelta = deltas.length ? deltas.slice().sort((a, b) => a - b)[deltas.length >> 1] : 0;
    return { found: true, count: n, corr: +corr.toFixed(3), runs: runs.length, longRuns: long.length,
             passRate: +passRate.toFixed(3), medDelta: +medDelta.toFixed(2),
             brightest: { hex: brightest.hex, L: +brightest.L.toFixed(1), y: +brightest.y.toFixed(2) },
             darkest: { hex: darkest.hex, L: +darkest.L.toFixed(1), y: +darkest.y.toFixed(2) } };
  });

  if (!data.found){
    console.log('[wisteria-color] 定位失败: ' + data.why);
    await browser.close(); server.close(); process.exit(1);
  }
  console.log(`[花穗] 实例 ${data.count} 朵 ｜ 最亮 ${data.brightest.hex}(L${data.brightest.L}) ｜ 最暗 ${data.darkest.hex}(L${data.darkest.L})`);
  console.log(`[方向] y–明度相关系数 r = ${data.corr}（上浅下深应为正）｜ 同穗段 ${data.longRuns}/${data.runs} 条够长，前四分之一更亮者占 ${(data.passRate * 100).toFixed(1)}%，中位明度差 ${data.medDelta}`);

  check('紫藤：花穗渐变为「上浅下深」（y–明度正相关）', data.corr > 0.15, `r=${data.corr}`);
  check('紫藤：同穗段前段比后段亮（结构判据，通过率 ≥80%）', data.passRate >= 0.8,
        `${(data.passRate * 100).toFixed(1)}%（${data.longRuns} 段）`);
  check('紫藤：最亮朵落在浅端量级（#C9B3EC 参考 L188，含抖动 170~215）',
        data.brightest.L >= 170 && data.brightest.L <= 215, `${data.brightest.hex} L=${data.brightest.L}`);
  check('紫藤：最暗朵落在深端量级（#6A3E96 参考 L78，含抖动 ≤110）',
        data.darkest.L <= 110, `${data.darkest.hex} L=${data.darkest.L}`);
  check('零 pageerror / console error', msgs.length === 0, msgs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[wisteria-color] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[wisteria-color] 探针自身异常：', e); process.exit(1); });
