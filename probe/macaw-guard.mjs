// 金刚鹦鹉专项门禁：node probe/macaw-guard.mjs
//
// 为什么建这道门（2026-10-05）：老黄"鹦鹉的动作改得再自然一些，现在有时候会看到鹦鹉
// 像抽搐了几下"。**此前三只鹦鹉没有任何门禁** —— 所以这个观感缺陷一路漏到他眼前。
//
// 守什么：
//   ① 前提：白天/晴/夏 —— 3 只都在**栖停**态（否则下面的姿态判据没有被测对象）
//   ② **姿态角速度上限**（抽搐与正常动作的分界线）
//   ③ 前提（防"空判据"）：窗口内必须真的发生过 flutter 等事件，否则"没有跳变"
//      可能只是"那个动作压根没播"—— 这正是本项目反复踩的"恒绿的空判据"
//   ④ 作息：noon 该在 / night 不该在 / storm 不该在（macawWantPerch 是唯一真值源）
//
// ⚠️ 为什么量**角速度**而不是"单帧跳幅"：
//    单帧跳幅 = 角速度 × 帧率，同一份代码在 60fps 与 24fps 下读数差 2.5 倍 ——
//    拿它定阈值等于在量机器（本项目"采样窗口 < 运动周期"那条教训的同族）。
//    角速度与帧率无关，且区分度更大：
//      · 修前 `flutter` 用 `sin(u*34)`：60fps 下每帧相位 +1.35rad ⇒ roll 角速度
//        **≈48 rad/s**（实测单帧 Δroll 0.80rad），比其它事件高 16 倍，读作"抽搐"；
//      · 修后整段只走 2 个周期（3.6Hz、幅度 0.24）：roll 角速度 **≈5.5 rad/s**。
//    取 roll/pitch ≤ 8 rad/s、yaw ≤ 22 rad/s（yaw 的"急张望/小跳换向"是**故意**快的，
//    hop 的 τ=0.15 对应约 14 rad/s，留到 22 给它余量）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 40;                       // 采样窗（秒）
const W_ROLL = 8, W_YAW = 22;       // rad/s 上限（来历见文件头）
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.webmanifest': 'application/manifest+json', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
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
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* ── ① 前提：栖停（白天/晴/夏） ── */
  await page.evaluate(() => {
    const G = window.__garden;
    G.setEnv('season', 'summer'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);

  /* ── ② 逐帧录姿态（含仿真时钟，用来算与帧率无关的角速度） ── */
  const rows = await page.evaluate(async (secs) => {
    const G = window.__garden, out = [];
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        out.push({ t: performance.now() - t0, sc: G.simClock(), s: G.macawState() });
        if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    return out;
  }, W);

  const nB = rows[0].s.length;
  const st0 = rows[rows.length - 1].s;
  check('① 前提：3 只鹦鹉都在栖停（白天/晴/夏）',
    nB === 3 && st0.every(m => m.mode === 'perch' && m.visible === true),
    `${nB} 只 · ${st0.map(m => m.mode).join('/')}`);

  /* 逐鸟逐帧算角速度（Δ角 / Δ仿真时长；仿真是固定步长，故与机器帧率无关） */
  const evFrames = {};
  let worst = { roll: 0, pitch: 0, yaw: 0 }, worstAt = null;
  for (let i = 0; i < nB; i++){
    for (let k = 1; k < rows.length; k++){
      const a = rows[k - 1], b = rows[k];
      const dts = b.sc - a.sc;
      if (!(dts > 1e-4)) continue;                       // 该帧仿真没推进（补步用尽）：跳过
      const A = a.s[i], B = b.s[i];
      if (!A || !B) continue;
      (evFrames[B.ev] = evFrames[B.ev] || 0), evFrames[B.ev]++;
      const wr = Math.abs(B.roll - A.roll) / dts;
      const wp = Math.abs(B.pitch - A.pitch) / dts;
      const wy = Math.abs(B.yaw - A.yaw) / dts;
      if (wr > worst.roll) worst.roll = wr;
      if (wp > worst.pitch) worst.pitch = wp;
      if (wy > worst.yaw) worst.yaw = wy;
      if (!worstAt || wr > worstAt.wr) worstAt = { wr, wp, wy, ev: B.ev, i, t: b.t };
    }
  }
  const f1 = (x) => x.toFixed(1);
  console.log(`  · 各事件采样帧数：${Object.entries(evFrames).map(([e, n]) => `${e}=${n}`).join(' ')}`);
  console.log(`  · 全场最差单帧：roll ${f1(worst.roll)} / pitch ${f1(worst.pitch)} / yaw ${f1(worst.yaw)} rad/s`
    + (worstAt ? `（出现在 ${worstAt.ev}）` : ''));

  /* ── ③ 前提：防空判据 —— 窗口里必须真的播过那些动作 ── */
  const need = ['flutter', 'preen', 'tail'];
  const missing = need.filter(e => !(evFrames[e] >= 10));
  check('③ 前提：窗口内真的播过 flutter/preen/tail（否则"没跳变"只是"没发生"＝空判据）',
    missing.length === 0,
    missing.length ? `下列事件采样不足 10 帧：${missing.map(e => `${e}=${evFrames[e] || 0}`).join(', ')}`
                   : need.map(e => `${e}=${evFrames[e]}`).join(' '));

  /* ── ② 姿态角速度上限（判据本体） ── */
  check(`② 姿态不抽搐：roll/pitch ≤ ${W_ROLL} rad/s（修前 flutter 实测 ≈48）`,
    worst.roll <= W_ROLL && worst.pitch <= W_ROLL,
    `roll ${f1(worst.roll)} / pitch ${f1(worst.pitch)} rad/s`);
  check(`② 转向不甩头：yaw ≤ ${W_YAW} rad/s（"急张望/小跳换向"本来就是快的，给了余量）`,
    worst.yaw <= W_YAW, `yaw ${f1(worst.yaw)} rad/s`);

  /* ── ④ 作息：三个状态各断言一次（macawWantPerch 是唯一真值源） ── */
  const sched = await page.evaluate(async () => {
    const G = window.__garden;
    const read = () => G.macawWantPerch();
    const set = async (k, v) => { G.setEnv(k, v);
      await new Promise(r => { const t0 = performance.now();
        const w = () => (performance.now() - t0 > 2600) ? r() : requestAnimationFrame(w); w(); }); };
    const out = {};
    await set('time', 'noon'); out.noon = read();
    await set('time', 'night'); out.night = read();
    await set('time', 'noon'); await set('weather', 'storm'); out.storm = read();
    await set('weather', 'clear');
    return out;
  });
  check('④ 作息：白天栖停 / 夜里不在 / 暴雨不在',
    sched.noon === true && sched.night === false && sched.storm === false,
    `noon=${sched.noon} night=${sched.night} storm=${sched.storm}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[macaw-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[macaw-guard] 探针异常：', e); process.exit(2); });
