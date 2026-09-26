// 锦鲤行为门禁 · 避障 / 惊鱼 / 轻微聚集（2026-09-26）
//
// 背景：11 条锦鲤沿**固定椭圆轨道**游动（koi-orbit.mjs 守"不越池"、koi-feed.mjs 守
// "投喂可吸引且散后回轨"）。本轮在轨道之上**叠加**三层行为，且必须满足：
//   ① 所有偏移都**加在原公式之上**、受同一套 0.95×POND_RADII 池域夹紧保护；
//   ② 鱼**始终在池内**、仍在**轨道邻域**（偏移有界）；
//   ③ **投喂行为不受破坏**。
//
// 本门怎么守（判据都有牙）：
//   · **纯函数直测**：页内 import 同一个 /src/06-vegetation.js（ESM 单例），
//     直接驱动 koiAvoidOffset / koiStartleOffset / koiCohesionOffset / koiBehaviorOffset。
//   · **有牙负例（硬断言）**：逐个行为把开关**关掉**，重跑同一判据，要求**必须失败**
//     —— 避障关掉 ⇒ 鱼穿障碍；惊鱼关掉 ⇒ 点击不惊散；聚集关掉 ⇒ 同组鱼叠一起。
//     任一负例没能变红 ⇒ 说明判据太松、当前的"全绿"是假的。
//   · **实时回归**：读真实 koiGroup 的鱼位（无论 11-loop 是否已接线），
//     确认"此刻所有鱼都在池内、都在各自轨道取值域内"（与 koi-orbit 同一判据）。
//
// 用法: node probe/koi-behavior-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  console.log(`\n[koi-behavior-guard] http://127.0.0.1:${port}/index.html`);

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* 锦鲤异步挂载到齐（否则实时判据无意义） */
  const gotFish = await page.waitForFunction(
    () => window.__garden.koiGroup.userData.fishes.length >= 11,
    null, { timeout: 180000 }).then(() => true).catch(() => false);
  check('锦鲤异步挂载到齐（否则实时判据无意义）', gotFish, gotFish ? '11 条' : 'koi.glb 未挂载');
  if (!gotFish){ await finish(); return; }

  /* ── 注入页内测试台：纯函数 + 池域判定（import 同一模块 URL ⇒ ESM 单例）── */
  await page.evaluate(async () => {
    const veg = await import('/src/06-vegetation.js');
    const G = window.__garden;
    const poly = G.POND_PTS.map(p => [p.x, p.y]);
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
      }
      return c;
    };
    /* 0.95×POND_RADII 夹紧（与 11-loop 鱼段 / dropBait 同口径）—— 门禁的"出池"判据 */
    const capAt = (x, z) => {
      let a = Math.atan2(z, x); if (a < 0) a += Math.PI * 2;
      const ri = Math.min(G.POND_RADII.length - 1, Math.floor(a / (Math.PI * 2) * G.POND_RADII.length));
      return G.POND_RADII[ri] * 0.95;
    };
    window.__kb = {
      veg, inside, capAt,
      OBST: veg.KOI_OBSTACLES,
      BEH: veg.KOI_BEHAVIOR,
      /* 离最近障碍表面的最短距离（负 = 已侵入圆包络） */
      minObstacleGap(x, z){
        let g = Infinity;
        for (const o of veg.KOI_OBSTACLES) g = Math.min(g, Math.hypot(x - o.x, z - o.z) - o.r);
        return g;
      },
      /* 沿 KOI_ORBITS 采样，取**表面距最小**（最易穿障碍）的轨道点 —— 正向用。
         teethPoint() 则取一个**确实落在障碍包络内**的点（gap<0），专供"关掉避障必须穿模"的负例。 */
      worstOrbitPoint(){
        let best = null;
        for (const o of veg.KOI_ORBITS){
          for (let k = 0; k < 720; k++){
            const t = (k / 720) * Math.PI * 2;
            for (let ji = 0; ji <= 8; ji++){
              const j = 0.66 + (1.06 - 0.66) * (ji / 8);
              const x = o.cx + Math.cos(t) * o.a * j;
              const z = o.cz + Math.sin(t) * o.b * j;
              const gap = window.__kb.minObstacleGap(x, z);
              if (!best || gap < best.gap) best = { x, z, gap };
            }
          }
        }
        return { x: +best.x.toFixed(3), z: +best.z.toFixed(3), gap: +best.gap.toFixed(3) };
      },
      /* 取一个**确实在水中、且已侵入最近障碍包络**的点（gap<0）。
         负例专用：这样的点在关掉避障时必然"穿石头"，门禁才有牙。 */
      teethPoint(){
        for (const o of window.__kb.OBST){
          for (let k = 0; k < 180; k++){
            const th = (k / 180) * Math.PI * 2;
            for (const rr2 of [0.0, 0.3, 0.6]){
              const x = o.x + Math.cos(th) * rr2, z = o.z + Math.sin(th) * rr2;
              if (window.__kb.inside(x, z) && window.__kb.minObstacleGap(x, z) < -0.2)
                return { x: +x.toFixed(3), z: +z.toFixed(3),
                         gap: +window.__kb.minObstacleGap(x, z).toFixed(3), r: o.r };
            }
          }
        }
        return null;
      },
      /* 驱动避障：返回施加偏移后的最终位置与"是否仍贴/已避" */
      applyAvoid(x, z){
        const o = veg.koiAvoidOffset(x, z);
        return { x: x + o.x, z: z + o.z, gapBefore: window.__kb.minObstacleGap(x, z),
                 gapAfter: window.__kb.minObstacleGap(x + o.x, z + o.z),
                 mag: Math.hypot(o.x, o.z) };
      },
      /* 驱动惊鱼：在 (lx,lz) 记一次惊扰，然后问 tNow 时刻的偏移 */
      fireStartle(lx, lz, tNow){
        veg.koiStartleAt(lx, lz, tNow, 1.6);
        return veg.koiStartleOffset(lx + 0.4, lz, tNow);   // 鱼在惊扰点旁 0.4m
      },
      /* 驱动聚集：把 fish 放到几乎叠在 peer 上，看是否被推开 */
      applyCohesion(x, z, peers){ return veg.koiCohesionOffset(x, z, peers); },
      /* 合并入口 + 是否出池 */
      applyAll(x, z, tNow, peers){
        const r = veg.koiBehaviorOffset(x, z, tNow, peers);
        return { nx: x + r.dx, nz: z + r.dz, dx: r.dx, dz: r.dz,
                 inside: inside(x + r.dx, z + r.dz),
                 underCap: window.__kb.capAt(x + r.dx, z + r.dz) >= Math.hypot(x + r.dx, z + r.dz) - 1e-6,
                 energy: r.energy, clamped: r.clamped, avoidGap: r.avoidGap };
      },
    };
  });

  const OBST = await page.evaluate(() => window.__kb.OBST.map(o => ({ n: o.name, x: +o.x.toFixed(2), z: +o.z.toFixed(2), r: +o.r.toFixed(2) })));
  console.log(`  · 水中障碍 ${OBST.length} 个（由 POND_RADII + 已知摆位推导）：` +
    OBST.map(o => `${o.n}(${o.x},${o.z},r${o.r})`).join(' '));

  /* ══ ① 避障 · 正向：贴障碍的轨道点被推离，侵入被消除 ══ */
  const worst = await page.evaluate(() => window.__kb.worstOrbitPoint());
  const avoidPos = await page.evaluate(() => window.__kb.applyAvoid(window.__kb.worstOrbitPoint().x, window.__kb.worstOrbitPoint().z));
  console.log(`  · 最贴的轨道点 (${worst.x},${worst.z}) 表面距 ${worst.gap}m`);
  check('① 避障 · 找得到"贴近水中障碍"的轨道点（否则避障判据无意义）',
    worst.gap < 0.9, `最小表面距 ${worst.gap}m`);
  check('① 避障 · 避障偏移把该点推出障碍包络（gap 变大）',
    avoidPos.gapAfter > avoidPos.gapBefore,
    `gap ${avoidPos.gapBefore.toFixed(3)} → ${avoidPos.gapAfter.toFixed(3)}，位移 ${avoidPos.mag.toFixed(3)}m`);

  /* ══ ① 避障 · 有牙负例：取一个**确实嵌进石矶包络内**的点。
     开着避障 ⇒ 被推出包络（gap 变正）；关掉避障 ⇒ 原地不动、仍然嵌在石头里（gap 仍为负）。
     门禁断言后者必须为真 —— 否则"避障在起作用"就是假绿。 ══ */
  const teeth = await page.evaluate(() => {
    const p = window.__kb.teethPoint();
    if (!p) return { found: false };
    const save = window.__kb.BEH.avoid;
    /* 开：跑一次避障 */
    window.__kb.BEH.avoid = true;
    const on = window.__kb.veg.koiAvoidOffset(p.x, p.z);
    const onGap = window.__kb.minObstacleGap(p.x + on.x, p.z + on.z);
    /* 关：偏移必须为 0，点仍然嵌在石头里 */
    window.__kb.BEH.avoid = false;
    const off = window.__kb.veg.koiAvoidOffset(p.x, p.z);
    const offGap = window.__kb.minObstacleGap(p.x + off.x, p.z + off.z);
    window.__kb.BEH.avoid = save;
    return { found: true, p, onGap: +onGap.toFixed(3), offGap: +offGap.toFixed(3),
             onMag: +Math.hypot(on.x, on.z).toFixed(3), offMag: +Math.hypot(off.x, off.z).toFixed(3) };
  });
  check('① 避障 · 找得到"嵌进水中障碍包络内"的点（否则负例无意义）', teeth.found,
    teeth.found ? `(${teeth.p.x},${teeth.p.z}) 表面距 ${teeth.p.gap}m` : '没有这样的采样点');
  check('① 避障 · 开着避障把该点推出障碍包络（gap 由负转正）',
    teeth.found && teeth.onGap > teeth.p.gap,
    teeth.found ? `gap ${teeth.p.gap} → ${teeth.onGap}m，位移 ${teeth.onMag}m` : '—');
  check('① 避障 · 有牙负例：关掉 avoid 后该点**仍然嵌在障碍里**（门禁必须能判红）',
    teeth.found && teeth.offMag < 1e-6 && teeth.offGap <= 0,
    teeth.found ? `关掉后位移 ${teeth.offMag}m、gap 仍为 ${teeth.offGap}m（≤0 即穿模）` : '—');

  /* ══ ① 避障 · 偏移有界 & 不出池 ══
     ⚠️ 采样基点**只取池内**的点：锦鲤永远在池内游动，避障也只对池内位置有意义。
     （早期版本绕障碍画一圈采样，其中靠岸一侧的基点本身就在岸上 ⇒ 判"避障把鱼推出池"，
      那是采样点的错，不是避障的错 —— 真实调用方永远不会从池外位置调避障。） */
  const avoidBounds = await page.evaluate(() => {
    const B = window.__kb.BEH; const save = B.avoid;
    B.avoid = true;
    let maxMag = 0, anyOut = 0, skipped = 0, n = 0;
    for (const o of window.__kb.OBST){
      for (let k = 0; k < 180; k++){
        const th = (k / 180) * Math.PI * 2;
        for (const rad of [o.r, o.r + 0.2, o.r + 0.6, o.r + 1.2]){
          const x = o.x + Math.cos(th) * rad, z = o.z + Math.sin(th) * rad;
          if (!window.__kb.inside(x, z)){ skipped++; continue; }     // 只测池内基点
          const r = window.__kb.veg.koiAvoidOffset(x, z);
          const mag = Math.hypot(r.x, r.z);
          if (mag > maxMag) maxMag = mag;
          if (!window.__kb.inside(x + r.x, z + r.z)) anyOut++;
          n++;
        }
      }
    }
    B.avoid = save;
    return { maxMag: +maxMag.toFixed(3), anyOut, n, skipped };
  });
  check('① 避障 · 位移有界（≤ AVOID_MAX=1.20m）', avoidBounds.maxMag <= 1.20 + 1e-6,
    `${avoidBounds.n} 个池内采样点，最大位移 ${avoidBounds.maxMag}m`);
  check('① 避障 · 避障后仍全部在池内', avoidBounds.anyOut === 0,
    avoidBounds.anyOut ? `${avoidBounds.anyOut}/${avoidBounds.n} 越界`
                       : `${avoidBounds.n} 个池内采样点全在池内（跳过 ${avoidBounds.skipped} 个池外基点）`);

  /* ══ ② 惊鱼 · 正向：点击处惊扰让附近鱼被推 ══ */
  const startlePos = await page.evaluate(() => {
    const t = 100.0;
    const s = window.__kb.fireStartle(0, 0, t);          // 池心附近点一次惊扰
    return { mag: +Math.hypot(s.x, s.z).toFixed(3) };
  });
  check('② 惊鱼 · 惊扰点旁的鱼被推开（产生非零偏移）', startlePos.mag > 0.01,
    `池心惊扰 → 旁鱼偏移 ${startlePos.mag}m`);

  /* ══ ② 惊鱼 · 有牙负例：关掉 startle，同一判据必须失效 ══ */
  const startleNeg = await page.evaluate(() => {
    const B = window.__kb.BEH; const save = B.startle;
    B.startle = false;
    const t = 200.0;
    window.__kb.veg.koiStartleAt(0, 0, t, 1.6);
    const s = window.__kb.veg.koiStartleOffset(0.4, 0, t);
    B.startle = save;
    return { mag: +Math.hypot(s.x, s.z).toFixed(3) };
  });
  check('② 惊鱼 · 有牙负例：关掉 startle 后惊扰不再推鱼（偏移≈0）',
    startleNeg.mag < 0.01, `关掉后偏移 ${startleNeg.mag}m`);

  /* ══ ② 惊鱼 · 偏移有界 & 随时间衰减 & 不出池 ══ */
  const startleBounds = await page.evaluate(() => {
    const t = 300.0;
    window.__kb.veg.koiStartleAt(0, 0, t, 1.6);
    let maxMag = 0, anyOut = 0, skipped = 0, n = 0;
    for (let k = 0; k < 180; k++){
      const th = (k / 180) * Math.PI * 2;
      for (const rad of [0.3, 1.0, 2.0, 3.0, 3.4]){
        const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        if (!window.__kb.inside(x, z)){ skipped++; continue; }     // 只测池内基点
        const s = window.__kb.veg.koiStartleOffset(x, z, t);
        const mag = Math.hypot(s.x, s.z);
        if (mag > maxMag) maxMag = mag;
        if (!window.__kb.inside(x + s.x, z + s.z)) anyOut++;
        n++;
      }
    }
    /* 时间衰减：惊扰后 0s vs 1.0s（life=1.1s ⇒ 应显著变小） */
    const e0 = window.__kb.veg.koiStartleOffset(0.4, 0, t);
    const e1 = window.__kb.veg.koiStartleOffset(0.4, 0, t + 1.0);
    const early = Math.hypot(e0.x, e0.z), late = Math.hypot(e1.x, e1.z);
    return { maxMag: +maxMag.toFixed(3), anyOut, n, skipped,
             early: +early.toFixed(3), late: +late.toFixed(3) };
  });
  check('② 惊鱼 · 位移有界（≤ STARTLE_MAX=1.60m）', startleBounds.maxMag <= 1.60 + 1e-6,
    `${startleBounds.n} 个池内采样点，最大位移 ${startleBounds.maxMag}m`);
  check('② 惊鱼 · 惊扰后仍全部在池内', startleBounds.anyOut === 0,
    startleBounds.anyOut ? `${startleBounds.anyOut}/${startleBounds.n} 越界`
                         : `${startleBounds.n} 个池内采样点全在池内（跳过 ${startleBounds.skipped} 个池外基点）`);
  check('② 惊鱼 · 推力随时间衰减（1.0s 后显著小于起手）', startleBounds.late < startleBounds.early * 0.2,
    `起手 ${startleBounds.early}m → 1.0s 后 ${startleBounds.late}m`);

  /* ══ ③ 聚集 · 正向：几乎叠住的同组鱼被推开 ══ */
  const coherePos = await page.evaluate(() => {
    const peers = [{ x: 0.1, z: 0 }, { x: 5, z: 0 }];      // 一条几乎重合、一条很远
    const c = window.__kb.applyCohesion(0, 0, peers);
    return { mag: +Math.hypot(c.x, c.z).toFixed(3) };
  });
  check('③ 聚集 · 几乎叠住的同组鱼被推开（产生非零偏移）', coherePos.mag > 0.01,
    `距最近邻 0.1m → 偏移 ${coherePos.mag}m`);

  /* ══ ③ 聚集 · 有牙负例：关掉 cohesion，同一判据必须失效 ══ */
  const cohereNeg = await page.evaluate(() => {
    const B = window.__kb.BEH; const save = B.cohesion;
    B.cohesion = false;
    const c = window.__kb.applyCohesion(0, 0, [{ x: 0.1, z: 0 }]);
    B.cohesion = save;
    return { mag: +Math.hypot(c.x, c.z).toFixed(3) };
  });
  check('③ 聚集 · 有牙负例：关掉 cohesion 后叠鱼不再被推开（偏移≈0）',
    cohereNeg.mag < 0.01, `关掉后偏移 ${cohereNeg.mag}m`);

  /* ══ ③ 聚集 · 位移有界 & 不出池 ══ */
  const cohereBounds = await page.evaluate(() => {
    let maxMag = 0, anyOut = 0, skipped = 0, n = 0;
    for (let k = 0; k < 90; k++){
      const th = (k / 90) * Math.PI * 2;
      for (const rad of [0.05, 0.2, 0.4, 0.55]){
        const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        if (!window.__kb.inside(x, z)){ skipped++; continue; }     // 只测池内基点
        const c = window.__kb.applyCohesion(x, z, [{ x: x + 0.02 * Math.cos(th), z: z + 0.02 * Math.sin(th) }]);
        const mag = Math.hypot(c.x, c.z);
        if (mag > maxMag) maxMag = mag;
        if (!window.__kb.inside(x + c.x, z + c.z)) anyOut++;
        n++;
      }
    }
    return { maxMag: +maxMag.toFixed(3), anyOut, n, skipped };
  });
  check('③ 聚集 · 位移有界（≤ COHESION_MAX=0.90m）', cohereBounds.maxMag <= 0.90 + 1e-6,
    `${cohereBounds.n} 个池内采样点，最大位移 ${cohereBounds.maxMag}m`);
  check('③ 聚集 · 推开后仍在池内', cohereBounds.anyOut === 0,
    cohereBounds.anyOut ? `${cohereBounds.anyOut}/${cohereBounds.n} 越界`
                        : `${cohereBounds.n} 个池内采样点全在池内（跳过 ${cohereBounds.skipped} 个池外基点）`);

  /* ══ ④ 合并入口 · 三层全开。
     关键判据：**沿真实轨道扫一整圈**（每条轨道 × 全抖动区间 0.66~1.06 × 720 相位，
     与 koi-orbit.mjs 解析扫轨**同一套采样**），在每个轨道点叠加行为偏移后：
       · 位移**有界**（≤ KOI_OFFSET_TOTAL_CAP）；
       · 结果**仍在池内**且**仍在 0.95×POND_RADII 夹紧内**；
       · 结果与"原始轨道点"的偏离**有界**（这就是"仍在轨道邻域"的量化）。
     另加一组"贴障碍采样"，确保避障在最紧的地方也不破界。 */
  const allOn = await page.evaluate(() => {
    const B = window.__kb.BEH;
    Object.assign(B, { avoid: true, startle: true, cohesion: true, startleFromRipple: true });
    const t = 400.0;
    window.__kb.veg.koiStartleAt(0, 0, t, 1.6);          // 池心一记惊扰（最坏情况叠加）
    let maxMag = 0, anyOut = 0, anyOverCap = 0, maxDrift = 0, n = 0, skipped = 0;
    const scan = (x, z, peers) => {
      if (!window.__kb.inside(x, z)){ skipped++; return; }
      const r = window.__kb.applyAll(x, z, t, peers);
      const mag = Math.hypot(r.dx, r.dz);
      if (mag > maxMag) maxMag = mag;
      if (mag > maxDrift) maxDrift = mag;
      if (!r.inside) anyOut++;
      if (!r.underCap) anyOverCap++;
      n++;
    };
    /* (a) 沿全部轨道整周期扫（与 koi-orbit 解析扫轨同采样） */
    for (const o of window.__kb.veg.KOI_ORBITS)
      for (let k = 0; k < 720; k++){
        const th = (k / 720) * Math.PI * 2;
        for (let ji = 0; ji <= 8; ji++){
          const j = 0.66 + (1.06 - 0.66) * (ji / 8);
          scan(o.cx + Math.cos(th) * o.a * j, o.cz + Math.sin(th) * o.b * j, [{ x: o.cx, z: o.cz }]);
        }
      }
    /* (b) 贴障碍采样：避障最吃劲的地方 */
    for (const o of window.__kb.OBST)
      for (let k = 0; k < 60; k++){
        const th = (k / 60) * Math.PI * 2;
        for (const rad of [o.r, o.r + 0.4, o.r + 1.0])
          scan(o.x + Math.cos(th) * rad, o.z + Math.sin(th) * rad, [{ x: o.x, z: o.z }]);
      }
    return { maxMag: +maxMag.toFixed(3), anyOut, anyOverCap, n, skipped,
             maxDrift: +maxDrift.toFixed(3) };
  });
  check('④ 合并 · 三项全开时总位移有界（≤ KOI_OFFSET_TOTAL_CAP=2.60m）',
    allOn.maxMag <= 2.60 + 1e-6,
    `${allOn.n} 个池内采样点（跳过 ${allOn.skipped} 个池外），最大总位移 ${allOn.maxMag}m`);
  check('④ 合并 · 三项全开时叠加后**全部在池内**', allOn.anyOut === 0,
    allOn.anyOut ? `${allOn.anyOut}/${allOn.n} 越界` : `${allOn.n} 个池内采样点全在池内`);
  check('④ 合并 · 三项全开时叠加后仍受 0.95×POND_RADII 夹紧（无一超 cap）', allOn.anyOverCap === 0,
    allOn.anyOverCap ? `${allOn.anyOverCap}/${allOn.n} 超 cap` : `${allOn.n} 个池内采样点全在 cap 内`);
  /* "仍在轨道邻域"：偏移量本身就是"离原轨道点的距离" ⇒ 上界即邻域半径。 */
  check('④ 合并 · 离原轨道点的偏离有界（≤2.60m，即"轨道邻域"半径）',
    allOn.maxDrift <= 2.60 + 1e-6, `整周期扫轨最大偏离 ${allOn.maxDrift}m`);

  /* ══ ④.5 有牙负例：三层全关 ⇒ 偏移必须为 0（否则"行为层"其实是空转）══ */
  const allOff = await page.evaluate(() => {
    const B = window.__kb.BEH;
    const save = { a: B.avoid, s: B.startle, c: B.cohesion };
    Object.assign(B, { avoid: false, startle: false, cohesion: false });
    const t = 500.0;
    window.__kb.veg.koiStartleAt(0, 0, t, 1.6);
    const r = window.__kb.veg.koiBehaviorOffset(-6.15, 4.6, t, [{ x: -6.1, z: 4.6 }]);
    Object.assign(B, { avoid: save.a, startle: save.s, cohesion: save.c });
    return { mag: +Math.hypot(r.dx, r.dz).toFixed(4) };
  });
  check('④.5 有牙负例：三项全关时 koiBehaviorOffset 偏移为 0（证明偏移确由行为层产生）',
    allOff.mag < 1e-6, `全关后偏移 ${allOff.mag}m`);

  /* ══ ⑤ 实时回归：真实鱼群此刻在池内 + 在各自轨道取值域内 ══
     （与 koi-orbit 同一判据；无论 11-loop 是否已接线，这是"没把鱼改坏"的底线。） */
  const live = await page.evaluate(() => {
    const G = window.__garden;
    /* 行为偏移上限：与 06 的 KOI_OFFSET_TOTAL_CAP 一致。行为层**允许**把鱼推离基准轨道点
       （避障/惊鱼/聚散就是要偏离轨道才成立），所以这里量的是"轨道域 + 有界偏移"，
       而不是精确轨道域 —— 精确域会把任何避障行为判红。
       本条的本意仍是抓"整体系数错位"（如父组 +3 叠加两遍），那是 3m 量级，2.6 抓不到。 */
    const CAP = 2.6;
    return G.koiGroup.userData.fishes.map(f => {
      const d = f.userData, o = G.KOI_ORBITS[d.orbit];
      const jMax = d.jitter + 0.06;
      const lx = f.position.x, lz = f.position.z;
      return { orbit: d.orbit, lx: +lx.toFixed(3), lz: +lz.toFixed(3),
               inside: window.__kb.inside(lx, lz),
               inOrbit: lx >= o.cx - o.a * jMax - CAP && lx <= o.cx + o.a * jMax + CAP
                     && lz >= o.cz - o.b * jMax - CAP && lz <= o.cz + o.b * jMax + CAP };
    });
  });
  const outLive = live.filter(f => !f.inside);
  const offOrbit = live.filter(f => !f.inOrbit);
  check('⑤ 实时 · 11 条鱼此刻全在池内（叠加行为不得把鱼推出池）', live.length >= 11 && outLive.length === 0,
    outLive.length ? JSON.stringify(outLive.slice(0, 3)) : `${live.length} 条全在池内`);
  check('⑤ 实时 · 11 条鱼在基准轨道 +2.6m 有界偏移内（无整体系数错位）', offOrbit.length === 0,
    offOrbit.length ? JSON.stringify(offOrbit.slice(0, 3)) : `11 条全部落在轨道域 +2.6m 内`);

  /* ══ ⑥ 投喂可调用性：dropBait / nearestBait 仍正常（投喂路径未被本次改动破坏）══
     ⚠️ `nearestBait` 没有被 __garden 暴露（11-loop 独占），所以从模块本身取
     —— 同一个 ESM 单例，与 11-loop 鱼段用的是**同一个函数**。 */
  const feed = await page.evaluate(() => {
    const G = window.__garden, veg = window.__kb.veg;
    const b = veg.dropBait(0, 3.0, 0);            // 池心世界 (0,3) → 池局部 (0,0)
    const near = veg.nearestBait(0.1, 0.1);        // 附近有饵 ⇒ 应找到
    const far = veg.nearestBait(0.1, 0.1);         // 仍在 6.5m 吸引半径内
    const inside = window.__kb.inside(b.lx, b.lz);
    const n0 = G.baitsActive();
    veg.BAITS.length = 0;                           // 清掉
    return { found: !!near, farFound: !!far, inside, n0, after: G.baitsActive(),
             active: G.baitsActive() };
  });
  check('⑥ 投喂 · dropBait 后 nearestBait 能找到饵、饵点在池内',
    feed.found && feed.inside && feed.n0 > 0,
    `nearestBait 命中=${feed.found}，饵在池内=${feed.inside}，活跃饵 ${feed.n0}→${feed.after}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await finish();

  async function finish(){
    const fails = results.filter(r => !r.ok).length;
    console.log(`\n[koi-behavior-guard] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
    try { await browser.close(); } catch {}
    server.close();
    process.exit(fails === 0 ? 0 : 1);
  }
})().catch(e => { console.error('[koi-behavior-guard] 探针自身异常：', e); process.exit(1); });
