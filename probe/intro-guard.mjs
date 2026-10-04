// 开场运镜门禁（2026-09-22 补齐 R-1）。
//   背景：开场运镜（3 关键帧 5.4s）是 2026-09-20 加的功能，**一直没有门禁**。
//         这类"相机在飞"的缺陷两侧全是静默的：
//           · 静默失效：飞到一半停下、落位点不对、落位后 minDistance 没收回 —— 不报错、不崩；
//           · 静默污染：探针态下也跟着播 → 几十条机位/像素断言集体拿到"正在飞"的相机。
//   断言：
//     ① 自动化（navigator.webdriver）下**必须不自动播**；
//     ② ?intro=1 强制下：起幅确实在 K0（云外俯瞰 30,34,40）；飞行期 controls 锁死、minDist 放开到 0.2；
//     ③ 真的走完 K0→K1→K2（观测到 seg 推进），落位点 = VIEWPOINTS.overview（= CAM_HOME）；
//     ④ 落位后 controls 解冻、minDistance 收回 CAM_MIN_DIST；
//     ⑤ 任意交互（wheel）立即让位 —— "带看"不是"锁死"；
//     ⑥ 零 pageerror / console error。
// usage: node probe/intro-guard.mjs
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
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
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
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* K0 是写死在 08-assemble.js INTRO_KF[0] 的起幅（池南上空云外俯瞰）。
   这里复述常量，是为了让"起幅被悄悄改掉/被 CAM_HOME 顶替"能红 —— 若哪天改了 K0，
   必须同步改这里（门禁的常数就该跟被测常数成对出现，不靠遍历猜）。 */
const K0_POS = [30, 34, 40], K0_TGT = [0, 4.5, 2];
/* 收尾定义见 11-loop.js：loading.done 之后 2 帧才开始播 */
const waitReady = pg => pg.waitForFunction(
  () => window.__garden && document.getElementById('loading').classList.contains('done'),
  { timeout: 180000, polling: 300 });

const snap = pg => pg.evaluate(() => {
  const g = window.__garden;
  return {
    intro: g.introState(), active: g.introActive(),
    cam: [g.camera.position.x, g.camera.position.y, g.camera.position.z],
    tgt: [g.controls.target.x, g.controls.target.y, g.controls.target.z],
    enabled: g.controls.enabled, minDist: g.controls.minDistance,
    camMinDist: g.camMinDist(),
    overview: (() => { const v = g.VIEWPOINTS.find(v => v.id === 'overview');
      return v ? { pos: [v.pos.x, v.pos.y, v.pos.z], tgt: [v.target.x, v.target.y, v.target.z] } : null; })(),
  };
});

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const errors = [];
  const wire = p => {
    p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };

  /* ── A. 探针态（无参数）：**不许**自动播 ── */
  const pA = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pA.setDefaultTimeout(200000); wire(pA);
  await pA.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await waitReady(pA);
  await sleep(1500);                       // 留足"若会播，此时已在飞"的时间
  const A = await snap(pA);
  check('探针态：开场运镜不自动播（否则回归机位全漂）', A.active === false, `introActive=${A.active}`);
  check('探针态：相机不在起幅 K0（确属静止机位）', dist(A.cam, K0_POS) > 5, `距K0=${dist(A.cam, K0_POS).toFixed(1)}m`);
  check('探针态：minDistance = CAM_MIN_DIST（未被运镜放开）',
    Math.abs(A.minDist - A.camMinDist) < 1e-6, `minDist=${A.minDist} CAM_MIN_DIST=${A.camMinDist}`);
  await pA.close();

  /* ── B. ?intro=1 强制播：全过程 ── */
  const pB = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pB.setDefaultTimeout(200000); wire(pB);
  await pB.goto(`http://127.0.0.1:${port}/index.html?tier=high&intro=1`, { waitUntil: 'load', timeout: 180000 });
  await waitReady(pB);

  const started = await pB.waitForFunction(() => window.__garden.introState().on === true,
    { timeout: 15000, polling: 100 }).then(() => true).catch(() => false);
  check('?intro=1：加载收尾后自动起播', started);
  if (!started){
    console.log('\n[开场运镜] 起播失败，后续断言无意义 —— 提前退出');
    await browser.close(); server.close();
    console.log(`[运镜] ${results.filter(r => r.ok).length}/${results.length} 项通过`);
    process.exit(1);
  }

  /* ⚠️⚠️ 2026-10-05 修口径（全量链里"两跑红不同断言"里的第一条就是它）：
     原取法是「等 introState().on === true → 再发一次 snap()」，中间隔着**一次 IPC
     往返 + 若干帧**；而本运镜是 3 关键帧 5.4s 飞 53m ≈ **10 m/s** ⇒ 核显/负载高时
     一帧就能走 1~2.5m，实测 距K0 在 1.2m 阈值上下翻飞（1.34m 红、单跑 0.4m 绿）。
     ⇒ 拆成两条，各取所长：
       (a) **精确值**：introStart() 是**同步**把相机拷到 K0 的（08-assemble L2415），
           所以在**同一个任务里**读完就是精确值、与帧率无关；
       (b) **自动播路径**仍要看一眼，但只断"确实跳到云外俯瞰"—— 阈值按**航程**给
           （53m 的 ~1/10），不再拿单帧噪声当判据。 */
  const B0 = await snap(pB);
  const dK0 = dist(B0.cam, K0_POS), dT0 = dist(B0.tgt, K0_TGT);
  check('自动播起幅在云外俯瞰（距 K0 ≪ 航程，不是直接给交付机位 —— 交付机位离 K0 53m）',
    dK0 < 5, `距K0=${dK0.toFixed(2)}m（航程 53m）`);
  check('自动播起幅目标点朝 K0 注视点 (0,4.5,2)', dT0 < 5, `距K0tgt=${dT0.toFixed(2)}m`);

  const EXACT = await pB.evaluate(() => {
    const g = window.__garden;
    g.introStart();                                  // 起幅瞬间同步跳到 K0（产品行为）
    const c = g.camera.position, t = g.controls.target;
    return { cam: [c.x, c.y, c.z], tgt: [t.x, t.y, t.z] };
  });
  check('起幅**精确**等于 K0 (30,34,40) / 注视点 (0,4.5,2)（同步取证，与帧率无关）',
    dist(EXACT.cam, K0_POS) < 1e-6 && dist(EXACT.tgt, K0_TGT) < 1e-6,
    `距K0=${dist(EXACT.cam, K0_POS).toFixed(4)}m 距K0tgt=${dist(EXACT.tgt, K0_TGT).toFixed(4)}m`);

  check('飞行期 controls 冻结（拖拽/阻尼不许与插值抢相机）', B0.enabled === false, `enabled=${B0.enabled}`);
  check('飞行期 minDistance 放开到 0.2（否则近景插值被夹）',
    Math.abs(B0.minDist - 0.2) < 1e-6, `minDist=${B0.minDist}`);

  /* 边飞边采样：收集 seg 与头尾距离，验"真的在动"且"走满了 3 段关键帧" */
  const segs = new Set(), cams = [];
  const tEnd = Date.now() + 25000;
  let flying = true;
  while (flying && Date.now() < tEnd){
    const s = await snap(pB);
    segs.add(s.intro.seg); cams.push(s.cam);
    flying = s.intro.on;
    if (flying) await sleep(280);
  }
  const last = await snap(pB);
  check('走满了多个关键帧段（观测到 seg 推进，不是单段直飞）',
    segs.has(0) && [...segs].some(v => v >= 1), `观测段号={${[...segs].join(',')}}`);
  const maxMove = cams.reduce((a, c) => Math.max(a, dist(c, cams[0])), 0);
  check('飞行期间相机确实在大幅移动（非"标记在播、画面没动"）',
    maxMove > 3, `最大位移=${maxMove.toFixed(1)}m`);
  check('飞行在 25s 内自行结束（5.4s 设计值；卡住不落位即红）', last.intro.on === false);

  if (last.overview){
    const dOv = dist(last.cam, last.overview.pos), dOt = dist(last.tgt, last.overview.tgt);
    check('落位点 = VIEWPOINTS.overview（交付机位，与按 0 复位同落点）', dOv < 0.6, `距overview=${dOv.toFixed(2)}m`);
    check('落位注视点 = overview.target', dOt < 0.6, `距tgt=${dOt.toFixed(2)}m`);
  } else check('落位点 = VIEWPOINTS.overview', false, 'VIEWPOINTS 里没有 overview');

  check('落位后 controls 解冻（否则用户接管不了）', last.enabled === true, `enabled=${last.enabled}`);
  check('落位后 minDistance 收回 CAM_MIN_DIST（0.2 不许残留）',
    Math.abs(last.minDist - last.camMinDist) < 1e-6, `minDist=${last.minDist} CAM_MIN_DIST=${last.camMinDist}`);

  /* ── C. 任意交互即让位（语义 = **就地冻结**，不是跳回起点/终点）──
     ⚠️ 冻结判据必须用**键盘**接管来测，不能用 wheel：wheel 会顺带触发 OrbitControls 的缩放
     （deltaY 改球半径），相机本来就会动 —— 拿位置差去判"冻住"是拿污染量当判据（同 §29.3）。
     键盘 K 键：既在 introCancel 的接管集里，又在 12-env 的快捷键表之外（无副作用）。 */
  await pB.evaluate(() => window.__garden.introStart());
  await sleep(1500);                       // 先真的飞出去一段，否则"冻住"与"还没动"分不清
  const before = await snap(pB);
  check('重新起播后确实在飞、且已离开始幅（让位测试的前提成立）',
    before.active === true && before.enabled === false && dist(before.cam, K0_POS) > 2,
    `on=${before.active} enabled=${before.enabled} 距K0=${dist(before.cam, K0_POS).toFixed(1)}m`);
  await pB.keyboard.press('k');
  await sleep(500);
  const aft = await snap(pB);
  check('键盘交互立即让位（"带看"不是"锁死"）', aft.active === false, `introActive=${aft.active}`);
  check('让位后 controls 立即解冻', aft.enabled === true, `enabled=${aft.enabled}`);
  check('让位后 minDistance 立即收回', Math.abs(aft.minDist - aft.camMinDist) < 1e-6, `minDist=${aft.minDist}`);
  const ov = last.overview || aft.overview;
  /* ⚠️⚠️ 2026-10-05 修口径（全量链"两跑红不同断言"里的第二条）：原来
     `froze = dist(aft.cam, before.cam)` —— `before` 是**按 k 之前**那次快照，中间隔着
     "按键往返 + 若干帧"，而运镜 5.4s 飞 53m ≈ **10 m/s** ⇒ 慢帧一帧就是 1~2.5m。
     全量链里因此红成 2.5872m，单跑又是 0.0000m：典型的"阈值≈噪声×帧率"。
     ⇒ 改成**先让位、再观察**：让位落地后再跨若干帧采两次样，看它有没有继续动 ——
     这才是"就地冻结"的语义，且与帧率无关（旧量法只作参考打印，不再当判据）。 */
  const f0 = await snap(pB);
  await sleep(700);
  const f1 = await snap(pB);
  const froze = dist(f1.cam, f0.cam);
  check('让位 = 就地冻结（让位后跨帧不再移动，也不跳回起幅/落位点）',
    froze < 0.05 && dist(f1.cam, K0_POS) > 2 && (!ov || dist(f1.cam, ov.pos) > 5),
    `让位落地后 700ms 内位移=${froze.toFixed(4)}m（按 k 前→后含按键延迟是 ${dist(aft.cam, before.cam).toFixed(3)}m，不作判据）` +
    ` 距K0=${dist(f1.cam, K0_POS).toFixed(1)}m` + (ov ? ` 距落位点=${dist(f1.cam, ov.pos).toFixed(1)}m` : ''));

  /* 滚轮是另一条接管路径（listener 在 renderer.domElement 捕获阶段），只验"让位生效"。
     位置在这里不可判 —— 见上面那条注释。 */
  await pB.evaluate(() => window.__garden.introStart());
  await sleep(600);
  const box = await pB.evaluate(() => {
    const c = document.querySelector('#app canvas') || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await pB.mouse.move(box.x, box.y);
  await pB.mouse.wheel(0, 140);
  await sleep(400);
  check('滚轮交互也让位（画布捕获阶段收到，与点击涟漪同一条语义）',
    (await snap(pB)).active === false);

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[运镜] ${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[intro-guard] 崩溃:', e); process.exit(2); });
