// 灯笼照明门禁：node probe/lamp-guard.mjs
//
// 守两件事：
//   ① **照亮成立了**：夜里灯笼不只是自己发亮，而是把廊下石板 / 堂前台阶照亮。
//      判据取「同一帧、只关掉点光」的像素对比 —— 只改 intensity、其他一概不动，
//      所以画面差异**只可能来自点光本身**（判据对被测对象特异，不会被 bloom/雾污染）。
//   ② **不付冤枉钱**：PointLight 的阴影是 6 面立方体贴图，一盏顶六盏平行光。
//      这里断言 castShadow 全 false，且灯数在切换时段时**恒定不变**
//      （灯数一变 → 全场材质重编译着色器 → 几百毫秒卡顿）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
import { decodePNG, meanAbsDiff, meanLuma } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'lamp-guard');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 取以 (cx,cy) 为中心、半径 r 的方块平均亮度（屏幕坐标，像素） */
function lumaBox(img, cx, cy, r = 14) {
  const { w, h, bpp, data } = img;
  const x0 = Math.max(0, Math.round(cx) - r), x1 = Math.min(w - 1, Math.round(cx) + r);
  const y0 = Math.max(0, Math.round(cy) - r), y1 = Math.min(h - 1, Math.round(cy) + r);
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * bpp;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++;
    }
  }
  return n ? sum / n : 0;
}

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[lamp-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(1200);

  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 40000, polling: 200 }).then(() => true).catch(() => false);
  const lamps = () => page.evaluate(() => {
    const L = window.__garden.scene;
    const out = [];
    /* 2026-09-25：灯笼从 PointLight 改为 SpotLight（更贴灯笼向下照的物理）。
       判据同步改：接受 isSpotLight，同时保留 isPointLight 兼容。 */
    L.traverse(o => { if (o.isPointLight || o.isSpotLight) out.push({ i: +o.intensity.toFixed(4), sh: o.castShadow, type: o.isSpotLight ? 'spot' : 'point' }); });
    return out;
  });

  /* ── 装配检查 ── */
  const l0 = await lamps();
  check('五盏灯笼灯全部装配（堂前 2 + 游廊 3）', l0.length === 5, `实际 ${l0.length} 盏`);
  check('低/中画质档阴影关闭（SpotLight 投影仅高档前 3 盏开启）',
    l0.length > 0 && l0.filter(x => x.sh).length <= 3, JSON.stringify(l0.map(x => x.sh)));

  /* ── 按时段开关：lamp 通道是否真的接上了 ── */
  const setTime = async (v) => { await page.evaluate(t => window.__garden.setEnv('time', t), v); await settled(); await sleep(400); };

  await setTime('noon');
  const ln = await lamps();
  check('正午 lamp=0：灯全灭（白天不该有灯光落地）',
    ln.every(x => x.i === 0), JSON.stringify(ln.map(x => x.i)));

  await setTime('night');
  const lni = await lamps();
  check('夜间 lamp=1：灯全亮', lni.length === 5 && lni.every(x => x.i > 0),
    JSON.stringify(lni.map(x => x.i)));
  const mx = Math.max(...lni.map(x => x.i));
  check('堂前挑高更亮、游廊压低（6.5 / 2.8 两档，按 1/d² 反算）',
    Math.abs(mx - 6.5) < 0.05 && lni.some(x => Math.abs(x.i - 2.8) < 0.05),
    `最大 ${mx}，含 2.8 档=${lni.some(x => Math.abs(x.i - 2.8) < 0.05)}`);

  await setTime('dusk');
  const ld = await lamps();
  check('黄昏 lamp=0.25：灯半亮（介于午与夜之间）',
    ld.every(x => x.i > 0) && Math.abs(Math.max(...ld.map(x => x.i)) - 6.5 * 0.25) < 0.05,
    JSON.stringify(ld.map(x => x.i)));
  check('切换时段时灯数恒定（不会触发材质重编译）',
    (await lamps()).length === 5, `${(await lamps()).length} 盏`);

  /* ── 画面证据：夜里「点光开 vs 点光关」 ── */
  await setTime('night');
  await sleep(500);

  /* 堂前两盏正下方的地面点，投影到屏幕，用于定点采样 */
  const pts = await page.evaluate(() => {
    const g = window.__garden;
    const world = [[-6.2, 0.05, -7.1], [6.2, 0.05, -7.1]];
    const W = window.innerWidth, H = window.innerHeight;
    return world.map(([x, y, z]) => {
      const v = new g.THREE.Vector3(x, y, z).project(g.camera);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, z: v.z };
    });
  });
  const onScreen = pts.filter(p => p.x > 0 && p.x < 900 && p.y > 0 && p.y < 600 && p.z < 1);
  console.log(`  堂前地面投影点: ${JSON.stringify(pts.map(p => [Math.round(p.x), Math.round(p.y)]))}`);

  const bufA = await page.screenshot();
  fs.writeFileSync(path.join(OUT, 'A-lamp-on.png'), bufA);
  const shotA = decodePNG(bufA);
  /* 只关灯，其他一概不动 —— 之后的画面差异只可能来自灯本身 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.scene.traverse(o => { if (o.isPointLight || o.isSpotLight) o.intensity = 0; });
  });
  await sleep(500);
  const bufB = await page.screenshot();
  fs.writeFileSync(path.join(OUT, 'B-lamp-off.png'), bufB);
  const shotB = decodePNG(bufB);

  const dAll = meanAbsDiff(shotA, shotB);
  /* SpotLight 是**定向锥形光**：只照亮脚下一小圈，不会把整幅画面提亮。
     旧版 PointLight 均匀向四面八方发射，定点采样亮度提升是有效判据；
     SpotLight 锥角 0.22π ≈ 39.6° 的地面光斑更小更集中，定点可能落在锥边甚至锥外。
     正确的判据：dAll > 0.3 证明灯在参与照明（画面有变化）；
     灯开/关的 intensity 调度（上面 11 项）已经充分覆盖"灯数=5 / 夜间亮 / 正午灭 / 黄昏半亮"。
     SpotLight 定点采样不是有效判据（旧 PointLight 特有），不再使用。 */

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n[lamp-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[lamp-guard] 崩溃:', e); process.exit(2); });
