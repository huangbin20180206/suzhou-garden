// 巡游端到端门禁（2026-10-18 · 补 P1「新增两站没有门禁」）
//
// 守三件事：
//   ① **10 站逐站落位**：巡游按序走到 lantern / heroPeak 两站（以及既有八站），
//      每站飞行落定后相机真的停在 VIEWPOINTS 的 pos 上、注视点在 target 上；
//   ② **字幕与站一一对应**：每站字幕标题必须能在 VIEWPOINTS 里找到同名的机位
//      （标题写错 / 站点漏配 / 顺序漂移都会在这里红）；
//   ③ **不穿墙**：整个巡游期间逐帧采样相机位置；凡是落在园墙厚度带里
//      （|x|≈30 或 |z|≈22.5）且低于墙顶的帧都算穿墙。南墙中央月洞门（|x|<1.25）除外。
//
// 背景：2026-10-17 新增 lantern（院外石板路 35.6,18.6）与 heroPeak 两站，
//   smoke 只验证首站 hero；而 lantern 在院外、plaque 在园内，直线飞行会在 y≈1.8m
//   处穿过东墙（墙高 4.5m）。2026-10-18 起 flyTo 对这类跨墙飞行自动插入越墙中间点
//   （08d-tour.js wallArcPoint），本门禁逐帧守住它。
//
// 用法：node probe/tour-guard.mjs
// 耗时：约 70~80 秒（10 站 × dwell 6s，真实巡游节奏，不偷时间）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').replace(/[\s·・]/g, '');

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(150000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));

  console.log(`\n[tour-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 120000, polling: 300 });
  await sleep(800);

  const plan = await page.evaluate(() => window.__garden.tourPlan());
  check('巡游清单可读（10 站，逐站有 pos/target/字幕）',
    plan.length === 10 && plan.every(p => p.pos && p.target && p.title),
    plan.map(p => p.id).join(' → '));

  /* 逐帧记录相机位置（跨墙判据要吃整条飞行轨迹，不能只抓到站点） */
  await page.evaluate(() => {
    window.__tourSamples = [];
    const rec = () => {
      const c = window.__garden.camera;
      if (window.__tourSamples.length < 20000)
        window.__tourSamples.push([c.position.x, c.position.y, c.position.z]);
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  });

  await page.evaluate(() => window.__garden.tourStart());
  const seen = [];                 // 按出现顺序的 {idx, cap}
  const landing = new Map();       // idx -> 落定后的最小偏差 {h, dy, dTarget, hit}
  const t0 = Date.now();
  let stopped = false;
  while (Date.now() - t0 < 110000){
    const s = await page.evaluate(() => {
      const g = window.__garden, st = g.tourState();
      return { on: st.on, idx: st.idx, cap: g.tourCaption(), fly: g.camFly(),
               p: [g.camera.position.x, g.camera.position.y, g.camera.position.z],
               t: [g.controls.target.x, g.controls.target.y, g.controls.target.z] };
    });
    if (!s.on){ stopped = true; break; }
    if (!seen.length || seen[seen.length - 1].idx !== s.idx || seen[seen.length - 1].cap !== s.cap){
      seen.push({ idx: s.idx, cap: s.cap });
    }
    if (!s.fly){
      const v = plan[s.idx];
      if (v && v.pos){
        /* 只比"水平落点 + 注视点"，y 允许被 polar 钳制抬高（见下方注释） */
        const h = Math.hypot(s.p[0] - v.pos[0], s.p[2] - v.pos[2]);
        const dy = s.p[1] - v.pos[1];
        const dt = Math.hypot(s.t[0] - v.target[0], s.t[1] - v.target[1], s.t[2] - v.target[2]);
        const cur = landing.get(s.idx) || { h: Infinity, dy: 0, dTarget: Infinity };
        if (h < cur.h) cur.h = h, cur.dy = dy;
        if (dt < cur.dTarget) cur.dTarget = dt;
        landing.set(s.idx, cur);
      }
    }
    if (seen.length >= 11) break;          // 第 10 站之后回卷到第 0 站，说明 10 站都走过
    await sleep(100);
  }
  await page.evaluate(() => window.__garden.tourStop());

  const uniq = [];
  for (const x of seen){ if (!uniq.some(y => y.idx === x.idx)) uniq.push(x); }
  check('巡游按序走满 10 站', uniq.length >= 10 && uniq.slice(0, 10).every((x, i) => x.idx === i),
    uniq.slice(0, 11).map(x => `${x.idx}:${x.cap}`).join(' → '));

  /* 字幕↔清单同名：第 i 站的字幕必须是 plan[i].title（顺序漂移/字幕配错都会红） */
  const badCap = uniq.slice(0, 10).filter((x, i) => norm(x.cap) !== norm(plan[i].title));
  check('10 站字幕与巡游清单逐站对应', badCap.length === 0,
    badCap.length ? badCap.map(x => `#${x.idx}「${x.cap}」≠「${plan[x.idx].title}」`).join('、') : '逐站对应');

  /* 逐站落位：
     · 水平落点必须与机位 pos 的 x/z 一致（Δ<0.05m）——站位漂了/飞错地方会红；
     · y 只允许**被抬高** 0~1.0m：本项目的 OrbitControls 夹住 polar ≤ 88.6°，
       机位把相机放在注视点之下时（hero / heroPeak 的"贴水/贴石"构图），controls.update()
       会沿视线把它抬到与注视点近似等高。这是既有相机约定，不是缺陷；plaque 旧站位的
       2.1m 偏移正是这里抓出来并已修掉的（见 08d-tour.js 该站注释）。
     · 注视点必须与机位 target 一致（Δ<0.30m）。 */
  const landRows = [];
  let landOK = true;
  for (let i = 0; i < 10; i++){
    const x = uniq[i];
    const v = plan[i];
    const L = landing.get(i);
    const ok = !!(v && v.pos && L && L.h < 0.05 && L.dy > -0.03 && L.dy < 1.0 && L.dTarget < 0.30);
    if (!ok) landOK = false;
    landRows.push(`#${i} ${x ? x.cap : '?'} hΔ=${L ? L.h.toFixed(3) : '—'} dy=${L ? L.dy.toFixed(2) : '—'} tgtΔ=${L ? L.dTarget.toFixed(3) : '—'}`);
  }
  check('10 站逐站落位（水平 Δ<0.05m / 注视点 Δ<0.30m / y 只许被 polar 抬高）', landOK, landRows.join(' | '));

  /* 穿墙：相机出现在墙厚带内且低于墙顶 = 红。南墙月洞门 |x|<1.25 放行。 */
  const samples = await page.evaluate(() => window.__tourSamples || []);
  const HW = 30, HD = 22.5, H = 4.5, BAND = 0.55, CLEAR = 0.20;
  let worst = null, hits = 0;
  for (const [x, y, z] of samples){
    const inXBand = Math.abs(Math.abs(x) - HW) <= BAND && Math.abs(z) < HD + 0.1;
    const inZBand = Math.abs(Math.abs(z) - HD) <= BAND && Math.abs(x) < HW + 0.1;
    if (!inXBand && !inZBand) continue;
    const moonGate = inZBand && !inXBand && z > 0 && Math.abs(x) < 1.25 && y > 0.6 && y < 3.3;
    if (moonGate) continue;
    if (y < H + CLEAR){
      hits++;
      if (!worst || y < worst[1]) worst = [x, y, z];
    }
  }
  check('巡游全程不穿墙（墙厚带内 y≥墙顶+0.2m）', hits === 0,
    hits ? `${hits} 帧低于墙顶，最低 ${worst[1].toFixed(2)}m @ (${worst[0].toFixed(1)}, ${worst[2].toFixed(1)})` : `${samples.length} 帧采样全部在墙顶之上`);

  check('巡游期间无 pageerror', errs.length === 0, errs.slice(0, 3).join(' | '));

  const bad = results.filter(r => !r.ok);
  console.log(`\n[tour-guard] ${results.length - bad.length}/${results.length} PASS` + (bad.length ? ` · 红：${bad.map(b => b.name).join('、')}` : ''));
  await browser.close();
  server.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
