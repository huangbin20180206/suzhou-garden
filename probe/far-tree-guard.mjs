// 远树剪影「下线」门禁（2026-09-23）。
//
// 背景：堂前池北岸那棵"不知名的白色树形剪影"被老黄指认了三次，前两轮都在"修"它，都没断根：
//   ① 0f95688：46 块**纯色矩形 quad**（r=62）叠雾色 → 读作"池北白框"；
//   ② 0f95688 同批：换成程序化树形剪影贴图（馒头冠）+ 半径 62→95 → 变成"白色树形剪影"；
//   ③ 2026-09-22 晚：颜色改深灰绿 0x74827A + 不透明度 0.62→0.45 + 并进 DISTANT_MATS 跟天光
//      → 从"亮白剪影"变成"淡色剪影"，**但仍然立在那儿**（池岸那棵树形 + 它的水中倒影）。
//   ④ 2026-09-23：老黄明确要求"完全隐藏或者直接删除" → 「柱状树林」**整层删除**。
//
// 实证（outputs/_diag/winter-pond/CONFIRM-{with,without}-trees.png）：只隐藏这一层，
// 池岸那棵树形剪影与它的水中倒影**同时消失**，画面其余部分逐像素不变 —— 元凶确认无疑。
//
// 本门存在的意义：这类"看画面才发现"的缺陷已经复发三次，**必须有一条机器判据拦住第 4 次**。
// 判据全部是结构性的（零像素、零抖动）：只要有人再把"46 块 PlaneGeometry 广告牌"这层加回来，
// ① 立刻报红。另带一个**自检负例**：临时往场景里塞一个同形状的 InstancedMesh，① 必须能红
// —— 探针自己证明"我不是个永远绿的摆设"（同 warmboot-guard 的负例、weather-coverage 的 G0）。
//
// 只读页面状态（自检那一步会临时注入一个对象并在同一次 evaluate 内移除）。
// 用法: node probe/far-tree-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
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
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const msgs = [];
  page.on('pageerror', e => msgs.push('[pageerror] ' + e));
  page.on('console', m => { if (m.type() === 'error') msgs.push('[error] ' + m.text()); });

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000 });
  await page.evaluate(() => window.__garden.setEnv('season', 'winter'));
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 120000 });

  /* ── ① 场景里不得再有"柱状树林"广告牌 ── */
  const scan = () => page.evaluate(() => {
    const g = window.__garden;
    const found = [];
    g.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.geometry) return;
      if (o.geometry.type !== 'PlaneGeometry') return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      found.push({ count: o.count, hasMap: !!(m && m.uniforms && m.uniforms.uMap),
                   visible: o.visible });
    });
    return found;
  });
  const before = await scan();
  const treeLike = before.filter(o => o.count === 46);
  console.log(`[远树] 场景内 PlaneGeometry 实例网格 ${before.length} 个（其中 count=46 的 ${treeLike.length} 个）`);
  check('远树：「柱状树林」广告牌已下线（场景内不存在 PlaneGeometry × 46 的 InstancedMesh）',
        treeLike.length === 0, treeLike.length ? JSON.stringify(treeLike) : '0 个');

  /* ── ② 材质与登记表都不得再留这一层 ── */
  const mat = await page.evaluate(() => {
    const g = window.__garden;
    return { hasMat: !!g.MAT.distantTree,
             hillCount: (g.MAT.distantNear && g.MAT.distantDeep && g.MAT.distant && g.MAT.distantFar) ? 4 : -1 };
  });
  check('远树：MAT.distantTree 已删除（材质库回到四层远山）',
        mat.hasMat === false, mat.hasMat ? 'MAT.distantTree 仍存在' : '不存在');
  check('远树：四层远山材质仍在（删的只是远树，没误伤远山）',
        mat.hillCount === 4, `远山材质 ${mat.hillCount}/4`);

  /* ── ③ 自检负例：临时塞一个"同形状"的 InstancedMesh，① 的判据必须能红 ── */
  const selfCheck = await page.evaluate(() => {
    const g = window.__garden, THREE = g.THREE;
    const geo = new THREE.PlaneGeometry(1, 1);
    const fake = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 46);
    fake.name = '__selfcheck_far_tree__';
    g.scene.add(fake);
    let n = 0;
    g.scene.traverse(o => {
      if (o.isInstancedMesh && o.geometry && o.geometry.type === 'PlaneGeometry' && o.count === 46) n++;
    });
    g.scene.remove(fake);
    geo.dispose();
    let after = 0;
    g.scene.traverse(o => {
      if (o.isInstancedMesh && o.geometry && o.geometry.type === 'PlaneGeometry' && o.count === 46) after++;
    });
    return { injected: n, cleaned: after };
  });
  console.log(`[远树] 自检：注入同形状网格后判据计数=${selfCheck.injected}（应为 1），移除后=${selfCheck.cleaned}（应为 0）`);
  check('远树：判据有牙 —— 临时注入"PlaneGeometry × 46"后 ① 必须能报红',
        selfCheck.injected === 1, `注入后计数=${selfCheck.injected}`);
  check('远树：自检对象已干净移除（探针不污染场景）',
        selfCheck.cleaned === 0, `移除后计数=${selfCheck.cleaned}`);

  check('零 pageerror / console error', msgs.length === 0, msgs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[far-tree] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[far-tree] 探针自身异常：', e); process.exit(1); });
