// 泳龟尾迹节流 专项门禁：node probe/turtle-wake-guard.mjs
//
// 用户诉求（2026-09-27 选定方案 A）：锦鲤跃水节流（546344c）之后实测**锦鲤链已降到
// 36 次/分，但龟链仍是 57.5 次/分** —— 龟只有 2 只，却贡献了水面 62% 的涟漪，
// 合计 92.5 次/分（≈每 0.65s 一圈），仍是"持续不断"而不是"偶发"。
// 本门守的正是**龟链的频率水位**。
//
// 为什么需要一扇**独立**的门（不能并进 koi-ripple-guard）：
//   两条链的**计数口径完全不同**。锦鲤落圈 1:1 挂在 `d.wasEmerged` 的符号翻转上（要聚类
//   成"破水事件"，因为一次跃水产生**两圈**）；而龟是**定时留尾迹**（11-loop:
//   `if (tw.visible && t >= d.wakeAt){ spawnRipple(..., 2); d.wakeAt = … }`），
//   一次 tick 就是一次落圈、**没有"事件"这个概念**。把两者塞进一扇门会让判据互相干扰
//   （本项目已经吃过一次"判据口径混用"的亏：night+mist 的带均值 vs 逐列是两条判据）。
//
// 判据全部是"次/分"计数比（项目铁律：不许用两次采样的间隔、也不许用峰值/极差）。
//
// 计数口径（**先断言前提**）：龟的落圈 1:1 挂在 `d.wakeAt` 的变化上。① 前提会**现场**核
//   insidePond 不吞掉任何一次（若不 1:1，下面所有计数都是高估值，必须在这里就报红）；
//   ② **季节断言**：冬季 `turtleShow=0` 时龟链必须**完全静默**（原注释就写了
//   "季节把乌龟藏起来时不要再留"）—— 漏了这条，冬天水面上仍会有看不见的龟在留圈。
//
// 负例自检：把间隔改回**旧值**（floor=1.5, spread=1.2，即改动前的中位 2.1s），
//   同一批判据必须**全部报红** —— 否则"水位判据"是假的（项目里栽过好几次这种空门）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg',
               '.png': 'image/png', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };
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
const finish = () => {
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[turtle-wake-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
};

/* 一个测量窗口：返回 龟落圈数 / 池内拒绝数 / 墙钟秒 */
async function measure(page, seconds) {
  return page.evaluate(async (sec) => {
    const G = window.__garden, R = window.__mr;
    const u0 = R.tur.length, r0 = R.reject, t0 = performance.now();
    await new Promise(r => setTimeout(r, sec * 1000));
    return { tur: R.tur.length - u0, reject: R.reject - r0,
             wall: (performance.now() - t0) / 1000 };
  }, seconds);
}

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  const got = await page.waitForFunction(() => window.__garden.swimTurtles.length >= 2,
    null, { timeout: 300000 }).then(() => true).catch(() => false);
  check('前提：2 只泳龟已挂载（否则频率判据无意义）', got, got ? '2 只' : '资产未挂载');
  if (!got){ await finish(); return; }

  console.log(`  · GPU: ${await page.evaluate(() => window.__garden.gpuName)}`);

  /* 装计数器：龟链按 d.wakeAt 变化（1:1），并**现场**核 insidePond 不吞落点。
     ⚠️ 计数器**先排下一帧再干活**（不是放在末尾）：否则首帧一抛异常就再也排不上，
        表现是"所有计数恒为 0"却零报错 —— 而产品其实一直在起涟漪（最难查的一种假象）。 */
  await page.evaluate(() => {
    const G = window.__garden;
    const TU = G.swimTurtles;
    const R = window.__mr = { tur: [], reject: 0, err: null, ticks: 0 };
    let pw = TU.map(t => t.userData.wakeAt);
    const tick = () => {
      requestAnimationFrame(tick);                 // ← 先排班（自愈）
      try {
        R.ticks++;
        for (let i = 0; i < TU.length; i++){
          const w2 = TU[i].userData.wakeAt;
          if (w2 !== pw[i]){
            const p = TU[i].getWorldPosition(new (TU[i].position.constructor)());
            if (!G.insidePond(p.x, p.z - 3.0)) R.reject++;   // 会被 spawnRipple 拦掉 ⇒ 计数高估
            R.tur.push({ i, t: G.simClock() });
          }
          pw[i] = w2;
        }
      } catch (e){ if (!R.err) R.err = String(e); }
    };
    requestAnimationFrame(tick);
  });
  /* ⚠️ 必须**等帧**再读：requestAnimationFrame 的回调下一帧才跑，派发后立刻读
     window.__mr 会拿到初始 0 ⇒ "计数器活着"永远假红（症状是"频率低"其实只是计数器没启动）。 */
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const tp = await page.evaluate(() => ({ ...window.__mr }));
  check('前提：计数器活着（否则"频率低"只是计数器死了，零报错最坑）',
    tp.ticks > 0 && !tp.err, `${tp.ticks} 次 tick${tp.err ? '，异常：' + tp.err : ''}`);

  /* ══ ① 前提：落点全部在池内（wakeAt 翻转 ⇒ spawnRipple 1:1） ══ */
  const pre = await measure(page, 40);
  check('① 前提：龟尾迹落点**全部**在池内（wakeAt 翻转 ⇒ spawnRipple 是 1:1）',
    pre.reject === 0, pre.reject ? `${pre.reject}/${pre.tur} 被 insidePond 拦掉 ⇒ 计数高估`
                                 : `${pre.tur} 次落圈，0 次被拦`);
  check('① 前提：观察窗内确实采到龟尾迹（否则"频率低"是采样不足，不是改对了）',
    pre.tur >= 6, `${pre.tur} 次落圈 / ${pre.wall.toFixed(0)}s`);

  /* ══ ② 频率水位：正常态（夏季·晴天·正午） ══ */
  const cfg = await page.evaluate(() => window.__garden.turtleWakeConfig());
  check('② 前提：权威开关已暴露（探针必须走它，不能在探针里重调产品函数）',
    cfg && typeof cfg.floor === 'number', `当前 floor=${cfg.floor} spread=${cfg.spread} on=${cfg.on}`);
  check('② 前提：间隔已放宽到稳态档（spread ≥ 2.0，即中位 ≥ ~4s）',
    cfg.spread >= 2.0, `spread=${cfg.spread} ⇒ 中位 ${(cfg.floor + cfg.spread / 2).toFixed(1)}s`);

  const A = await measure(page, 60), B = await measure(page, 60);
  const wall = A.wall + B.wall;
  const perMin = (A.tur + B.tur) / wall * 60;
  console.log(`  · 平时 120s 合并：龟链落圈 ${perMin.toFixed(1)}/分（2 只龟）`);
  check('② 平时 · 龟链尾迹频率落在 18~42 次/分（水面合计回到合理水位）',
    perMin >= 18 && perMin <= 42, `实测 ${perMin.toFixed(1)} 次/分`);
  check('② 平时 · 观察窗足够长（≥100s，避免 n 太小让中位数/频率抖）',
    wall >= 100, `${wall.toFixed(0)}s`);

  /* ══ ③ 季节：冬季龟被藏起来 ⇒ 必须完全静默 ══ */
  const win = await page.evaluate(async () => {
    const G = window.__garden;
    G.setEnv('season', 'winter'); G.setEnv('time', 'noon'); G.setEnv('weather', 'clear');
    return true;
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));     // 让季节显隐逐帧落到龟身上
  const W = await measure(page, 30);
  check('③ 冬季 · 龟被藏起后**完全不再留尾迹**（不然水面上有看不见的龟在留圈）',
    W.tur === 0, `冬季 30s 内落圈 ${W.tur} 次（应为 0）`);
  await page.evaluate(async () => {
    window.__garden.setEnv('season', 'summer');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  /* ══ ④ 负例自检：改回**旧间隔**（floor=1.5, spread=1.2）必须报红 ══ */
  const negCfg = await page.evaluate(() => window.__garden.setTurtleWake({ floor: 1.5, spread: 1.2 }));
  check('④ 负例前置：权威开关真的把间隔改回了旧值',
    negCfg.floor === 1.5 && negCfg.spread === 1.2, `读回 floor=${negCfg.floor} spread=${negCfg.spread}`);
  const N = await measure(page, 60);
  const nPerMin = N.tur / N.wall * 60;
  check('④ 有牙负例：旧间隔下龟链频率**超出水位上限**（判据必须能判红）',
    nPerMin > 42, `旧间隔实测 ${nPerMin.toFixed(1)} 次/分 > 上限 42`);
  const restored = await page.evaluate(() => window.__garden.setTurtleWake({ floor: 3, spread: 2.4 }));
  check('④ 负例收尾：已复原为产品默认 floor=3 spread=2.4',
    restored.floor === 3 && restored.spread === 2.4, `floor=${restored.floor} spread=${restored.spread}`);

  /* ══ ⑤ 权威开关的"完全关闭"必须让落圈归零 ══ */
  const offCfg = await page.evaluate(() => window.__garden.setTurtleWake({ on: false }));
  check('⑤ 前置：权威开关已关闭龟尾迹', offCfg.on === false, `on=${offCfg.on}`);
  const O = await measure(page, 30);
  check('⑤ 有牙负例：关闭后龟链落圈归零（证明计数确由该路径产生）',
    O.tur === 0, `关闭后 30s 内落圈 ${O.tur} 次（应为 0）`);
  await page.evaluate(() => window.__garden.setTurtleWake({ on: true }));

  /* ══ ⑥ 其它链未被波及 ══ */
  const cap = await page.evaluate(() => window.__garden.rippleCapacity());
  check('⑥ 涟漪池容量仍是 64（本次只改龟的节奏，没动容量与雨滴配额）', cap === 64, `容量=${cap}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  await finish();
})().catch(e => { console.error('[turtle-wake-guard] 探针异常：', e); process.exit(2); });
