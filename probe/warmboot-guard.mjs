// 分帧暖编译门禁（2026-09-22 补齐 R-3）。
//   背景：启动的 8 秒硬冻 = 全部 shader 编译挤在第一次 render() 里，同步阻塞主线程。
//         warmBoot 把它拆成 10 桶 + 1 彩排帧，逐帧揭示、走真实 composer.render() 保证宏对齐。
//   为什么要门禁：这条优化**没有症状**就退化了 —— 桶数、揭示顺序、宏对齐任何一处写坏，
//        页面照样起来、断言全绿，只是又变回"白屏死等 8 秒"。而且总时长反而更长，
//        所以必须同时钉住"首帧段被清空"与"总时长代价没失控"两件事。
//   判据核心：**首帧段 ≤ 800ms**。老路径实测 7.3~9.1s、暖编译后 75~90ms，两档差两个数量级。
//   负例自检：本门**自带反例**——在传输层把 `warmBoot()` 换成 `Promise.resolve()` 再跑一遍，
//        要求它的首帧段 > 3000ms。探针自己演示"这条判据能红"，避免判据其实是永真。
//   ⚠️ 两个配置**各开一个全新 browser**：着色器编译缓存在浏览器内跨页面复用，同一 browser 里
//        跑两遍会变成"谁排后面谁快"，A/B 直接失效（第一版实测同一配置两轮差 5.6 倍）。
// usage: node probe/warmboot-guard.mjs
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra) => { results.push({ label, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };

/* '渲染器 39.6ms → … ｜ 合计 Nms' → [{name, t}] */
function parseMarks(raw){
  const body = raw.replace(/^\[启动分段\]\s*/, '').split(' ｜ ')[0];
  const out = [];
  for (const item of body.split(' → ')){
    const m = item.match(/([\d.]+)\s*ms\s*$/);
    if (!m) continue;
    out.push({ name: item.slice(0, m.index).trim() || '(未命名)', t: parseFloat(m[1]) });
  }
  return out;
}
const seg = (marks, name) => {
  const i = marks.findIndex(m => m.name === name);
  return i < 0 ? null : marks[i].t - (i > 0 ? marks[i - 1].t : 0);
};
const FIRST_BUDGET = 800;      // ms。暖编译后 75~90ms，老路径 7.3~9.1s —— 取中间留 10× 余量
const NEG_FLOOR = 3000;        // ms。负例（无暖编译）首帧段必须超过这个值，证明判据能红

/* 一个配置 = 一个全新 browser（冷着色器缓存） */
async function measure(chromium, port, { nowarm }){
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(400000);
  const boot = [], defer = [], errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') errs.push('console: ' + t);
    if (t.includes('[启动分段·延迟]')) defer.push(t);
    else if (t.includes('[启动分段]')) boot.push(t);
  });
  if (nowarm){
    const src = fs.readFileSync(path.join(ROOT, 'src/11-loop.js'), 'utf8');
    const patched = src.replace('warmBoot().then(startAfterWarm', 'Promise.resolve().then(startAfterWarm');
    if (patched === src) throw new Error('负例补丁没打上：11-loop.js 里找不到 warmBoot().then(startAfterWarm');
    await page.route(u => u.pathname.endsWith('/11-loop.js'),
      r => r.fulfill({ status: 200, contentType: 'text/javascript', body: patched }));
  }
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('done'),
    { timeout: 300000, polling: 200 }).catch(() => {});
  /* program 数不能在 loading.done 那一刻读：GLB 是异步挂载的，抓早了抓到的是"延迟链跑到哪了"。
     等延迟链收尾 + **收敛判据**（连续两次采样不变）才算稳定。 */
  const dl = Date.now() + 300000;
  while (Date.now() < dl && !defer.some(l => l.includes('合计'))) await sleep(500);
  let last = -1, stable = 0;
  for (let i = 0; i < 30 && stable < 2; i++){
    const n = await page.evaluate(() => {
      const g = window.__garden; return g && g.renderer ? (g.renderer.info.programs || []).length : -1;
    }).catch(() => -1);
    if (n === last && n > 0) stable++; else { stable = 0; last = n; }
    if (stable < 2) await sleep(1200);
  }
  const programs = last;
  await browser.close();
  const marks = boot.length ? parseMarks(boot[boot.length - 1]) : [];
  return { marks, total: marks.length ? marks[marks.length - 1].t : null,
           warm: seg(marks, '暖机'), first: seg(marks, '首帧'), programs, errs };
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();

  console.log('冷缓存对比：两个配置各开一个全新 browser\n');
  const ON  = await measure(chromium, port, { nowarm: false });
  console.log(`  暖编译开：合计 ${ON.total?.toFixed(0)}ms ｜ 暖机 ${ON.warm === null ? '—' : ON.warm.toFixed(0) + 'ms'}` +
              ` ｜ 首帧 ${ON.first?.toFixed(0)}ms ｜ program ${ON.programs}`);
  const OFF = await measure(chromium, port, { nowarm: true });
  console.log(`  暖编译关：合计 ${OFF.total?.toFixed(0)}ms ｜ 暖机 — ｜ 首帧 ${OFF.first?.toFixed(0)}ms` +
              ` ｜ program ${OFF.programs}\n`);

  const order = ON.marks.findIndex(m => m.name === '暖机');
  const iMerge = ON.marks.findIndex(m => m.name === '几何合并');
  check('启动分段里出现「暖机」刻度（暖编译确实跑过）', ON.warm !== null, `暖机段=${ON.warm?.toFixed(0)}ms`);
  check('「暖机」排在几何合并之后、首帧之前（顺序即语义：先有场景再预热）',
    order > iMerge && order >= 0 && ON.marks[ON.marks.length - 1].name === '首帧',
    `index(暖机)=${order} index(几何合并)=${iMerge} 末刻度=${ON.marks[ON.marks.length - 1]?.name}`);
  check('暖机本身是真在干活（≥3s），不是被跳过/被短路', ON.warm !== null && ON.warm >= 3000,
    `暖机段=${ON.warm?.toFixed(0)}ms`);
  check(`首帧段被清空（≤${FIRST_BUDGET}ms）—— 编译不许再堵在渲染循环入口`,
    ON.first !== null && ON.first <= FIRST_BUDGET, `首帧段=${ON.first?.toFixed(1)}ms`);

  /* 负例自检：探针自己证明这条判据能红 */
  check('负例自检：去掉暖编译后「暖机」刻度消失（补丁确实生效）', OFF.warm === null && OFF.marks.length > 0);
  check(`负例自检：去掉暖编译后首帧段必然 >${NEG_FLOOR}ms（证明上面那条首帧判据有牙）`,
    OFF.first !== null && OFF.first > NEG_FLOOR, `老路径首帧段=${OFF.first?.toFixed(0)}ms`);

  /* 代价：暖编译把 ~8s 搬进了暖机，总时长会变长 —— 这里只钉"不许失控"。
     实测代价 +1.1~1.4s，见 PITFALLS §32。 */
  if (ON.total !== null && OFF.total !== null){
    const cost = ON.total - OFF.total;
    check('启动总时长代价没失控（≤ +35%：它是"把硬冻拆成 11 次可播报等待"，不是白赚）',
      cost / OFF.total <= 0.35, `合计 ${OFF.total.toFixed(0)}ms → ${ON.total.toFixed(0)}ms（${cost > 0 ? '+' : ''}${cost.toFixed(0)}ms）`);
  } else check('启动总时长代价没失控', false, '分段日志缺失');

  /* program 数：暖编译后不该比老路径明显多（多出来就是"同一批材质编了两遍"）。
     实测现差 +3~4 个（约 6%），理想 0 —— 阈值给 6 是防"翻倍"这类真事故，不假装现状是 0。 */
  if (ON.programs > 0 && OFF.programs > 0){
    const d = ON.programs - OFF.programs;
    check('暖编译未造成 program 数失控膨胀（≤ 老路径 +6；实测 +3~4，理想 0）',
      d <= 6, `program ${OFF.programs} → ${ON.programs}（${d > 0 ? '+' : ''}${d}）`);
  } else check('暖编译未造成 program 数失控膨胀', false, 'program 数取不到');

  check('两种配置都零 pageerror / console error',
    ON.errs.length === 0 && OFF.errs.length === 0,
    (ON.errs[0] || OFF.errs[0]) || `${ON.errs.length}/${OFF.errs.length} 条`);

  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[暖编译] ${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[warmboot-guard] 崩溃:', e); process.exit(2); });
