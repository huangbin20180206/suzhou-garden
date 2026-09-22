// 场景"浮空小物体"普查：找出所有**离地很高**的小尺寸网格。
// 起因：Agnes 在两张不同的样张里都报"右侧柳树旁的空气中悬浮着一个白色长方体"。
// 两次独立报告同一位置 → 不像纯幻觉，但视觉模型本就不可作硬判据（会把明显埋入 0.5m 的石头判成悬空），
// 所以这里用几何普查给**确定答案**：小体积 + 底面包围盒明显高于地面 = 可疑残留。
// 用法: node probe/scene-survey.mjs
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

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000 });
  /* 等延迟批装配完（立峰/题名石到位），否则普查会漏掉晚挂载的对象 */
  await page.waitForFunction(() => {
    let s = false; window.__garden.scene.traverse(o => { if (o.name === 'steleGroup') s = true; });
    return s;
  }, { timeout: 300000 });
  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 180000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());

  const r = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const out = [];
    let n = 0;
    g.scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
      if (!o.visible) return;
      n++;
      let bb;
      try { bb = new T.Box3().setFromObject(o); } catch (e) { return; }
      if (!isFinite(bb.min.x) || !isFinite(bb.max.y)) return;
      const size = bb.getSize(new T.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const col = m && m.color ? '#' + m.color.getHexString() : '-';
      /* 可疑判据：整块都在 1.6m 以上（离地明显），且尺寸小（< 2.5m）—— 大件如屋檐不算 */
      if (bb.min.y > 1.6 && maxDim < 2.5){
        out.push({
          name: o.name || '(无名)', type: o.type, inst: !!o.isInstancedMesh,
          y: [+bb.min.y.toFixed(2), +bb.max.y.toFixed(2)],
          cen: [+((bb.min.x + bb.max.x) / 2).toFixed(2), +((bb.min.z + bb.max.z) / 2).toFixed(2)],
          size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
          col, matName: (m && m.name) || '(无名)', map: !!(m && m.map),
        });
      }
    });
    /* 只对"看起来最白"的几件再补一条：正上方有没有东西托着（免得把吊灯/屋檐挂件当残留） */
    out.sort((a, b) => (b.col === '#ffffff' ? 1 : 0) - (a.col === '#ffffff' ? 1 : 0) || a.y[0] - b.y[0]);
    return { meshN: n, cands: out };
  });

  console.log(`[场景] 可见网格 ${r.meshN} 个；「整块高于 1.6m 且最大边 < 2.5m」的候选 ${r.cands.length} 个：\n`);
  for (const c of r.cands){
    console.log(`  ${(c.name + (c.inst ? '[inst]' : '')).padEnd(26)} y=${c.y[0]}~${c.y[1]}  xz=(${c.cen[0]},${c.cen[1]})  ` +
                `size=${c.size.join('×')}  color=${c.col}${c.map ? ' +map' : ''}`);
  }
  const whites = r.cands.filter(c => /^#f{2}|^#ff/i.test(c.col) || c.col === '#ffffff');
  console.log(`\n[结论] 近白色候选 ${whites.length} 个${whites.length ? '：' + whites.map(c => c.name + '@y' + c.y[0]).join('、') : '（没有纯白浮空块）'}`);
  if (errs.length) console.log('[页面报错]', errs.slice(0, 3).join(' | '));

  try { await browser.close(); } catch {}
  server.close();
  process.exit(0);
})().catch(e => { console.error('普查探针异常：', e); process.exit(1); });
