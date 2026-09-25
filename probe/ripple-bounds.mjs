// 涟漪边界门禁（2026-09-24）：守"**涟漪只画在池域内**"。
//
// 背景（老黄截图实证）：狂风暴雨场景里，**石驳岸下方的草皮**与**睡莲交界带**各出现一圈同心圆环 ——
//   涟漪画到了岸上。根因：雨滴涟漪按**外接椭圆**撒点（半轴 12.5 × 6.4、心在世界 (0,3)），
//   而池形是**不规则多边形**（POND_PTS / POND_RADII）⇒ 椭圆边缘在若干方向落到岸上。
//   修法：在 `spawnRipple` 的**唯一入口**按 `insidePond` 拦一道（所有调用方一起受保护）。
//
// 本门怎么守（不依赖任何产品埋点）：
//   ① 暴雨下持续采样**涟漪池的实例矩阵**（`rippleInst` 是场景里的 RingGeometry InstancedMesh；
//      未激活的槽缩放为 0.001 ⇒ 用缩放区分"活跃圈"），断言**所有活跃圈的落点都在池域内**；
//   ② 有牙自检：必须采到足够多的活跃圈（否则"没有圈"会让判据静默通过）；
//   ③ 正向对照：在池心合成一次真实点击（pointerdown/up），必须出圈 —— 证明"拦"没把正常路径拦掉。
//
// 用法: node probe/ripple-bounds.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require2 = createRequire(import.meta.url);
  try { return require2('playwright'); } catch {}
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require2(path.join(g, 'playwright'));
}
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
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  console.log(`\n[ripple-bounds] http://127.0.0.1:${port}/index.html`);

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* 页内工具：找涟漪池 + 采样活跃圈落点 + 用产品同一口径判池域（import 同一模块 URL，ESM 单例） */
  await page.evaluate(async () => {
    const g = window.__garden;
    const pond = await import('/src/05-water.js');
    let ripple = null;
    g.scene.traverse(o => { if (o.isInstancedMesh && o.geometry && o.geometry.type === 'RingGeometry') ripple = o; });
    window.__rb = {
      ripple, insidePond: pond.insidePond,
      sample(){
        const r = window.__rb.ripple, THREE = g.THREE, m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        const alpha = r && r.geometry && r.geometry.attributes.instanceAlpha;   // 每实例透明度
        const out = [];
        if (!r) return out;
        for (let i = 0; i < r.count; i++){
          /* ⚠️ 判"活跃"必须用 **instanceAlpha**，不能用实例矩阵的缩放：
             `updateRipples` 回收一圈时只置 `active=false` + `instanceAlpha=0`，**不重置矩阵缩放**
             （视觉上没问题：shader 乘 alpha=0 即不可见）。用缩放判会把已回收的圈全算进来 ——
             实测那样"切晴后 8.5s 仍是 20/20"，据此还会误判"池子满了、点击分不到槽"。 */
          if (!alpha || alpha.getX(i) <= 0.01) continue;
          r.getMatrixAt(i, m); m.decompose(p, q, s);
          out.push({ x: p.x, z: p.z, r: +s.x.toFixed(3) });
        }
        return out;
      },
      /* 世界 (x,z) → 池心局部 (x, z-3)：池心在世界 z=+3（同 07-ground / 06-vegetation 的口径） */
      inside(x, z){ return window.__rb.insidePond(x, z - 3.0); },
    };
  });
  const found = await page.evaluate(() => !!window.__rb.ripple);
  check('找到涟漪池（RingGeometry InstancedMesh）', found, found ? '' : '场景里没有涟漪实例网格');
  const cap = await page.evaluate(() => window.__garden.rippleCapacity());
  check('涟漪容量 64（暴雨+密集点击+鱼跃不抢不到槽）', cap === 64, `容量=${cap}`);
  if (!found){ check('（后续判据）', false, '没有涟漪池就无法判'); }
  else {
    /* ① 暴雨下持续采样：所有活跃圈都必须在池域内 */
    await page.evaluate(() => { window.__garden.setEnv('weather', 'storm'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const out = { seen: 0, bad: [], minR: 99, maxR: 0 };
      const t0 = performance.now();
      while (performance.now() - t0 < 4000){
        await new Promise(res => requestAnimationFrame(res));
        for (const q of window.__rb.sample()){
          out.seen++;
          if (!window.__rb.inside(q.x, q.z)){
            if (out.bad.length < 8) out.bad.push(`${q.x.toFixed(2)},${q.z.toFixed(2)}(r=${q.r})`);
          }
        }
      }
      return out;
    });
    check('暴雨下确实采到了活跃涟漪（否则判据会静默通过）', r.seen >= 20, `4s 内采到 ${r.seen} 个活跃圈样本`);
    check('**所有**活跃涟漪都落在池域内（不在岸上草地）', r.bad.length === 0,
      r.bad.length ? `${r.bad.length} 个越界，例：${r.bad.join(' ｜ ')}` : `${r.seen} 个样本全部在池内`);

    /* ③ 正向对照：**先把雨停掉、等池子排空**，再在池心合成一次真实点击，必须出圈。
       ⚠️ 必须在晴天下做：暴雨会占满涟漪池（容量 20：雨 14 + 鱼跃/龟各 3~5）⇒ 点击**分不到槽**，
       那不是"拦错了"而是"没位置"（第一次跑就是这么红的：20 → 20）。 */
    await page.evaluate(() => { window.__garden.setEnv('weather', 'clear'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 });
    const drained = await page.waitForFunction(() => window.__rb.sample().length <= 8,
      null, { timeout: 30000, polling: 200 }).then(() => true).catch(() => false);
    check('前置条件：晴天且涟漪池已排空（给点击留出槽位）', drained,
      drained ? '' : '30s 内池里仍有 >8 个活跃圈');
    const click = await page.evaluate(async () => {
      const g = window.__garden, THREE = g.THREE;
      const before = window.__rb.sample().length;
      const t0 = performance.now();
      const v = new THREE.Vector3(0, 0.06, 3).project(g.camera);          // 池心 → NDC
      const rect = g.renderer.domElement.getBoundingClientRect();
      const cx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const cy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const el = g.renderer.domElement;
      const opts = { clientX: cx, clientY: cy, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse' };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      /* 不能拿"活跃圈总数必须增加"当命中判据：锦鲤/泳龟仍可能出水，旧圈也会自然到期；
         两股变化可以互相抵消（3 连跑实测 8→8 一次），但产品已经权威记录了本击的
         手势过滤、射线与池域判定。读它才能证明正常点击链路没被拦。 */
      let last = null;
      while (performance.now() - t0 < 1000){
        await new Promise(res => requestAnimationFrame(res));
        last = g.clickRippleLast();
        if (last && last.at >= t0) break;
      }
      return { t0, before, after: window.__rb.sample().length, last, ndc: [+v.x.toFixed(2), +v.y.toFixed(2)] };
    });
    check('正向对照：池心点击确实出圈（"拦"没把正常路径拦掉）',
      !!click.last && click.last.at >= click.t0 && click.last.hit === true,
      `clickRipple={hit:${click.last && click.last.hit}, bait:${click.last && click.last.bait}, x:${click.last && click.last.x}, z:${click.last && click.last.z}} · 同期活跃圈 ${click.before}→${click.after}（池心 NDC ${click.ndc.join(',')}）`);
  }

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(x => !x.ok).length;
  console.log(`\n[ripple-bounds] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[ripple-bounds] 探针自身异常：', e); process.exit(1); });
