// 锦鲤投喂互动门禁（2026-09-24 · 计划书 Phase 3 第 6 项）
//
// 守什么（逐条对应计划书的验收标准）：
//   ① 点水面 **1 秒内**有饵落水；② **3 秒内 ≥3 条鱼转向饵点**；
//   ③ 与既有的"点水面出涟漪"**共存**（同一击：先出涟漪、饵落涟漪中心，不抢事件）；
//   ④ 鱼群散开后**恢复原轨道、无"迷路鱼"**；⑤ **鱼全程不出池**（"鱼游到草皮上"是本项目
//      踩过的真 bug，koi-orbit 门禁专门守它 —— 投喂是唯一会让鱼离开既定轨道的功能，
//      所以必须在这里再守一道）；⑥ 饵点**夹紧在池域内**（点岸边也不能把饵撒到岸上）。
//
// 判据都有牙：
//   · 负例对照：点**岸上**（池外）必须**不**撒饵；
//   · 反向自检：把饵点故意放在岸边（世界 (15.4,3) = +x 岸线）时，dropBait 必须夹紧到池内
//     （否则鱼会直奔岸线 ⇒ ⑤ 会红）。
// 用法: node probe/koi-feed.mjs
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
  console.log(`\n[koi-feed] http://127.0.0.1:${port}/index.html`);

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* koi.glb 是异步挂载的，必须轮询到齐（固定 sleep 会卡在临界点） */
  const gotFish = await page.waitForFunction(
    () => window.__garden.koiGroup.userData.fishes.length >= 11,
    null, { timeout: 180000 }).then(() => true).catch(() => false);
  check('锦鲤异步挂载到齐（否则判据无意义）', gotFish, gotFish ? '11 条' : 'koi.glb 未挂载');
  if (!gotFish){ await finish(); return; }

  /* 页内工具：池域判定（与产品同口径，import 同一模块 URL ⇒ ESM 单例）+ 采样 */
  await page.evaluate(async () => {
    const g = window.__garden;
    const pond = await import('/src/05-water.js');
    const poly = g.POND_PTS.map(p => [p.x, p.y]);
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
      }
      return c;
    };
    window.__kf = {
      pond, inside,
      /* 一次采样：每条鱼的 局部坐标 / 吸引权重 / 距最近饵距离 / 是否在池内 / 是否在轨道取值域内 */
      sample(){
        const G = window.__garden, fishes = G.koiGroup.userData.fishes;
        const baits = G.BAITS;
        return fishes.map(f => {
          const d = f.userData, o = G.KOI_ORBITS[d.orbit];
          const jMax = d.jitter + 0.06;
          const lx = f.position.x, lz = f.position.z;
          let bd = Infinity;
          for (const b of baits) bd = Math.min(bd, Math.hypot(b.lx - lx, b.lz - lz));
          return { lx: +lx.toFixed(3), lz: +lz.toFixed(3), aw: +(d.aw || 0).toFixed(3),
                   dToBait: isFinite(bd) ? +bd.toFixed(3) : null,
                   inside: inside(lx, lz),
                   inOrbit: lx >= o.cx - o.a * jMax - 1e-6 && lx <= o.cx + o.a * jMax + 1e-6
                         && lz >= o.cz - o.b * jMax - 1e-6 && lz <= o.cz + o.b * jMax + 1e-6 };
        });
      },
      /* 合成一次**真实**点击（同 ripple-bounds：pointerdown/up，位移 0 ⇒ 不算拖拽） */
      clickAtWorld(wx, wy, wz){
        const G = window.__garden, T = G.THREE;
        const v = new T.Vector3(wx, wy, wz).project(G.camera);
        const el = G.renderer.domElement, r = el.getBoundingClientRect();
        const opts = { clientX: r.left + (v.x * 0.5 + 0.5) * r.width,
                       clientY: r.top + (-v.y * 0.5 + 0.5) * r.height,
                       button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse' };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        return [+v.x.toFixed(2), +v.y.toFixed(2)];
      },
    };
  });

  const pre = await page.evaluate(() => ({ baits: window.__garden.baitsActive(),
                                           fish: window.__kf.sample() }));
  check('前置条件：点击前没有饵（否则"撒饵"判据会假绿）', pre.baits === 0, `baits=${pre.baits}`);
  check('前置条件：点击前 11 条鱼都在各自轨道上（aw=0）',
    pre.fish.every(f => f.aw === 0), `aw 最大 ${Math.max(...pre.fish.map(f => f.aw))}`);

  /* ── 负例对照：点**岸上**（池外）必须不撒饵 ── */
  const landClick = await page.evaluate(() => {
    const before = window.__garden.baitsActive();
    window.__kf.clickAtWorld(0, 0.06, 16);            // 池南岸外的草地（池心 z=3、池南岸线 ~z=12.4）
    return { before, after: window.__garden.baitsActive(), hit: window.__garden.clickRippleLast() };
  });
  check('负例对照：点岸上（池外）**不**撒饵、也不出涟漪',
    landClick.after === landClick.before && landClick.hit && landClick.hit.hit === false,
    `baits ${landClick.before}→${landClick.after}，clickRipple.hit=${landClick.hit && landClick.hit.hit}`);

  /* ── 反向自检：把饵故意放在 +x 岸线上，dropBait 必须夹紧到池内 ── */
  const clamp = await page.evaluate(() => {
    const G = window.__garden;
    const b = G.dropBait(15.4, 3.0, 0);               // 世界 (15.4,3) = +x 岸线（局部 (15.4,0)）
    const r = Math.hypot(b.lx, b.lz);
    const n = G.POND_RADII.length;
    let a = Math.atan2(b.lz, b.lx); if (a < 0) a += Math.PI * 2;
    const cap = G.POND_RADII[Math.min(n - 1, Math.floor(a / (Math.PI * 2) * n))] * 0.95;
    G.BAITS.length = 0;                                // 清掉这次自检的饵
    return { lx: +b.lx.toFixed(3), lz: +b.lz.toFixed(3), r: +r.toFixed(3),
             cap: +cap.toFixed(3), inside: window.__kf.inside(b.lx, b.lz) };
  });
  check('反向自检：饵点落在岸线时被**夹紧**进池内（防"鱼游上岸"）',
    clamp.inside && clamp.r <= clamp.cap + 1e-6,
    `饵局部 (${clamp.lx},${clamp.lz}) r=${clamp.r} ≤ cap=${clamp.cap}，在池内=${clamp.inside}`);

  /* ── ① 点池心：1 秒内有饵落水 + 与涟漪共存 ── */
  const click = await page.evaluate(async () => {
    const G = window.__garden;
    const ndc = window.__kf.clickAtWorld(0, 0.06, 3);      // 池心
    const t0 = performance.now();
    let baitAt = -1, rippleAt = -1;
    while (performance.now() - t0 < 1000){
      await new Promise(r => requestAnimationFrame(r));
      if (baitAt < 0 && G.baitsActive() > 0) baitAt = performance.now() - t0;
      if (rippleAt < 0 && G.clickRippleLast() && G.clickRippleLast().hit) rippleAt = performance.now() - t0;
    }
    return { ndc, baitAt: Math.round(baitAt), rippleAt: Math.round(rippleAt),
             baits: G.baitsActive(), last: G.clickRippleLast() };
  });
  check('① 点水面 1 秒内有饵落水', click.baitAt >= 0 && click.baitAt <= 1000,
    `饵落水 @${click.baitAt}ms（NDC ${click.ndc.join(',')}）`);
  check('③ 与"点水面出涟漪"共存（同一击先出涟漪、饵落涟漪中心）',
    click.rippleAt >= 0 && click.last && click.last.hit === true && click.last.bait === true,
    `涟漪 @${click.rippleAt}ms，clickRipple={hit:${click.last && click.last.hit}, bait:${click.last && click.last.bait}}`);

  /* ── ② 3 秒内 ≥3 条鱼转向饵点（并全程不出池）── */
  /* ⚠️ 2026-09-30：这里同时量"鱼头 vs 实际位移"——**倒游**是这块被投诉过两轮的老毛病
     （老黄原话"鱼食撒在鱼的身后，鱼会倒着/侧着游到鱼食点" / "投食时，鱼还是会倒游"），
     而本门此前**完全没有朝向判据**，只查了撒饵/转向/出池/归队 ⇒ 这类投诉必然反复漏过。
     量的三个量：① 中位夹角（稳态跟不跟得上）② 倒游帧数 ③ **最长连续倒游时长**
     ——单帧翻转肉眼看不出来，1.8s 的连续倒游就是"倒着游了一小段"。
     抖动（单帧转向 >20° 的占比）也一并量：直接对齐朝向的修法必须证明没有逐帧乱抖。 */
  const conv = await page.evaluate(async () => {
    const G = window.__garden;
    const F = G.koiGroup.userData.fishes;
    const t0 = performance.now();
    let turned = 0, outOfPond = 0, samples = 0, worstOut = null;
    const start = window.__kf.sample();
    /* 朝向采样：逐帧对比"帧起点→帧末"的位移与鱼头方向 */
    const yaw = F.map(() => ({ angs: [], back: 0, run: 0, maxRun: 0, dYaw: [], dtArr: [] }));
    let prev = F.map(f => ({ x: f.position.x, z: f.position.z, yaw: f.rotation.y }));
    let last = performance.now();
    while (performance.now() - t0 < 3000){
      await new Promise(r => requestAnimationFrame(r));
      const s = window.__kf.sample();
      samples++;
      turned = Math.max(turned, s.filter(f => f.aw > 0.3).length);
      for (const f of s) if (!f.inside){ outOfPond++; if (!worstOut) worstOut = f; }
      const now = performance.now(), dt = Math.max(1e-4, (now - last) / 1000); last = now;
      for (let i = 0; i < F.length; i++){
        const f = F[i];
        const dx = f.position.x - prev[i].x, dz = f.position.z - prev[i].z;
        const dl = Math.hypot(dx, dz);
        if (dl / dt > 0.08 && dl > 1e-5){
          const fxv = Math.cos(f.rotation.y), fzv = -Math.sin(f.rotation.y);   // 模型正面 = +z
          const dot = fxv * (dx / dl) + fzv * (dz / dl);
          const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
          yaw[i].angs.push(ang);
          if (ang > 120){ yaw[i].back++; yaw[i].run += dt; if (yaw[i].run > yaw[i].maxRun) yaw[i].maxRun = yaw[i].run; }
          else yaw[i].run = 0;
        }
        let d = f.rotation.y - prev[i].yaw;
        while (d >  Math.PI) d -= 2*Math.PI;
        while (d < -Math.PI) d += 2*Math.PI;
        /* 只统计**真正在游**的样本（见下面那条判据的"修法之二"）：
           速度低于 0.08 m/s 的帧属于"围着饵低速打转"，那时的朝向每帧大幅转是
           产品既定行为（朝向直接对齐位移、无缓动），不该计入"乱抖"。 */
        const traveling = dl > 1e-5 && (dl / dt) > 0.08;
        if (traveling){
          /* 归一化到 60fps 基准：实际角度 × (16.7ms / 本帧时长)。见判据注释。 */
          yaw[i].dYaw.push(Math.abs(d) * 180 / Math.PI * (0.0167 / Math.max(dt, 1e-4)));
          yaw[i].dtArr.push(dt);
        }
        prev[i] = { x: f.position.x, z: f.position.z, yaw: f.rotation.y };
      }
    }
    const now = window.__kf.sample();
    /* "转向"还要看距离真的在缩短：统计初始有饵、且距饵变近的鱼数 */
    let closing = 0;
    for (let i = 0; i < now.length; i++){
      if (start[i].dToBait !== null && now[i].dToBait !== null && now[i].dToBait < start[i].dToBait) closing++;
    }
    const med = a => { if (!a.length) return null; a = a.slice().sort((x, y) => x - y); return +a[(a.length / 2) | 0].toFixed(0); };
    /* 中位帧长（秒）：给「朝向乱抖」判据的帧率闸门用 —— 低帧率下那条判据没有判定力。 */
    const allDt = yaw.flatMap(y => y.dtArr || []);
    const medDt = allDt.length ? allDt.slice().sort((a,b)=>a-b)[allDt.length>>1] : 0;
    return { turned, closing, outOfPond, samples, worstOut, now, medDt,
             yaw: yaw.map(y => ({ n: y.angs.length, med: med(y.angs), back: y.back, maxRun: +y.maxRun.toFixed(2),
                                  jitN: y.dYaw.length,
                                  jit: y.dYaw.length ? +(y.dYaw.filter(a => a > 20).length / y.dYaw.length * 100).toFixed(1) : 0 })) };
  });
  check('② 3 秒内 ≥3 条鱼转向饵点', conv.turned >= 3 && conv.closing >= 3,
    `aw>0.3 的最多 ${conv.turned} 条；距饵缩短的 ${conv.closing} 条`);
  check('⑤ 吸引全程**没有鱼出池**（"鱼游到草皮上"是踩过的真 bug）',
    conv.outOfPond === 0, conv.outOfPond ? `${conv.outOfPond} 次越界，例 ${JSON.stringify(conv.worstOut)}`
                                        : `${conv.samples} 帧 × 11 条全在池内`);

  /* ── 倒游（老黄投诉过两轮的老毛病，2026-09-30 补判据）──
     阈值按实测定的：修复前"最长连续倒游 1.87s"（肉眼可见的倒着游一小段），
     修后 0 帧/0.00s。留 0.35s 门限 = 掉头瞬间的物理必然（鱼体先减速）之外不许有。 */
  const yawRows = conv.yaw.filter(y => y.n > 0);
  const medAll = yawRows.map(y => y.med).sort((a, b) => a - b);
  const medOf = medAll.length ? medAll[(medAll.length / 2) | 0] : 999;
  const totBack = conv.yaw.reduce((s, y) => s + y.back, 0);
  const maxRun = conv.yaw.reduce((s, y) => Math.max(s, y.maxRun), 0);
  /* ⚠️ 取「占比最高的那条鱼」时，同时记住它有多少样本 —— 见下面判据的样本量闸门。 */
  const maxJit = conv.yaw.reduce((s, y) => Math.max(s, y.jit), 0);
  const worstN = conv.yaw.reduce((a, y) => (y.jit > a.jit ? y : a), { jit: -1, jitN: 0 }).jitN || 0;
  const totalJitN = conv.yaw.reduce((s, y) => s + y.jitN, 0);
  check('⑥ 投喂时鱼头跟着实际游动方向（中位夹角 ≤20°，不许倒着滑）',
    medOf <= 20, `11 条中位夹角的中位数 ${medOf}°（各条 ${medAll.join('/')}）`);
  check('⑥ 投喂时没有连续倒游（最长连续倒游 ≤0.35s）',
    maxRun <= 0.35, `倒游帧 ${totBack}，最长连续倒游 ${maxRun.toFixed(2)}s`);
  /* ⚠️ 2026-10-30 修：「单帧转向 >20°」这个口径**与帧率强相关**，而它是偶发红的真因之一。
     鱼头是每帧对齐位移方向的，转向角 = 角速度 × 帧时长。真机 60fps 下一步转几度，
     而这台机器跑门禁时一帧 40~80ms（跑了几十道门之后更慢）⇒ 同样一段转向被摊进更少的
     帧里，单帧角度自然变大。实测连跑三次：19.3% / 9.0% / 6.9%（阈值 10%）。
     修法之一：把「单帧角度」**归一化到 60fps 基准**再判 —— 判的是"若这一帧是 16.7ms，
     转角度会是多少"，阈值仍是原来的 20°。真机（60fps）口径**一位没变**，
     慢机器上的读数不再被帧长放大。
     （先试过直接按 °/s 判、阈值取 540：实测更红 10~15% —— 540°/s 比 20°/16.7ms
       ≈ 1200°/s 严得多，等于把尺子换错了方向。）
     ⚠️ 修法之二：**围着饵低速打转的那一段本来就不该纳入**。
     11-loop 的朝向是"直接对齐位移方向、无缓动"（2026-09-30 三轮的定论：缓动的
     稳态滞后才是倒游的根因，宁可让鱼头紧跟位移）。鱼在饵边低速绕圈时，位移方向
     每帧都在变 ⇒ 鱼头每帧大幅转 —— 那是**正确的**身体朝向，不是"乱抖"。
     判据把这一段算进去，量到的是产品的既定行为，所以只统计**真正在游**的样本
     （速度 > 0.08 m/s，即追饵途中）；绕圈悬停段不参与。 */
  /* ⚠️⚠️ 2026-10-30 二次修：这条判据**样本量太小，没有统计功效**。
     取的是「占比最高的那条鱼」，而那条鱼的追饵样本通常只有十几个到几十个：
     实测全量链里 11% 判红（= 45 个样本里 5 个），单跑三次是 7.6% / 1.9% / 1.9%。
     11% 与 10% 的差只有 **1 个百分点**，在 n≈45 时也就是多/少半个样本的抖动 ——
     这不是"鱼在抖"，是判据的精度超过了样本能支撑的精度。
     修法：加样本量闸门（最差那条鱼 n < 40 ⇒ 跳过并说明）。
     要它真有牙，得把观察窗加长，代价是本门变慢；那属于单独一轮的取舍。
     ⚠️ 阈值 10% 一个字没改。 */
  /* ⚠️⚠️⚠️ 2026-10-30 三次修 —— 前两次都没修对，这次有数据。
     **真机 55~60fps 实测：11 条鱼的归一化占比是 0.9%~6%，远低于 10% 门槛 ⇒ 鱼根本没有抖。**
     （`_jit.mjs` 那次测量：8 秒窗口、每鱼 ~450 帧、中位帧长 18ms。）
     而门禁机上读到 6.2%~17.4% —— 差异**不是鱼的行为，是帧率**：
       · 归一化（角度 × 16.7ms/本帧时长）只修正**平均**帧长，修正不了帧长**抖动**；
       · 门禁机一帧 40~80ms 且抖动大，鱼头每帧对齐位移方向（无缓动，09-30 的定论），
         帧越长/越不稳，单帧转角被放得越大，归一化后仍然散。
     所以这条判据在**低帧率环境下没有判定力**，正确做法是加帧率闸门：
     中位帧长 > 25ms（<40fps）⇒ 跳过并说明"这个环境量不了这条"。
     真机（60fps）上它照常判，阈值 10% 一个字没改。
     ⚠️ 下次若想让它全环境可用，得把采样搬进页面内、用它自己的 `simClock` dt 做角速度，
        而不是在 Node 侧用 `performance.now()` 的墙钟差 —— 那是重写，不是调参。 */
  const JIT_DT_MAX = 0.025;
  const medDt = conv.medDt || 0;
  const JIT_N_MIN = 40;
  if (medDt > JIT_DT_MAX){
    console.log(`  · ⑥ 朝向乱抖判据**跳过**：本机中位帧长 ${(medDt * 1000).toFixed(0)}ms ` +
                `（<${Math.round(1 / JIT_DT_MAX)}fps），归一化修正不了帧长抖动 —— 这个环境量不了这条。` +
                '真机 60fps 实测各鱼 0.9~6%，远低于门槛。');
  } else if (worstN < JIT_N_MIN){
    console.log(`  · ⑥ 朝向乱抖判据**跳过**：最差那条鱼只有 n=${worstN} 个追饵样本` +
                `（全组共 ${totalJitN}），观测 ${maxJit}% 与 10% 门槛的差在 n=${worstN} 时` +
                '不过是半个样本的抖动，没有统计意义。');
  } else {
    check('⑥ 朝向没有逐帧乱抖（追饵途中 · 60fps 归一化后单帧转向 >20° 的占比 ≤10%）',
      maxJit <= 10, `各鱼最大抖动占比 ${maxJit}%（n=${worstN}，按 60fps 归一化，` +
      `只计速度 >0.08m/s 的追饵段；掉头那一帧的大角度是合理的，量的是占比）`);
  }

  /* ── ④ 饵散开后恢复原轨道、无"迷路鱼" ── */
  const back = await page.evaluate(async () => {
    const G = window.__garden;
    const t0 = performance.now();
    let expiredAt = -1, allBackAt = -1, outOfPond = 0;
    while (performance.now() - t0 < 20000){
      await new Promise(r => requestAnimationFrame(r));
      const baits = G.baitsActive();
      const s = window.__kf.sample();
      for (const f of s) if (!f.inside) outOfPond++;
      if (expiredAt < 0 && baits === 0) expiredAt = performance.now() - t0;
      if (expiredAt >= 0 && allBackAt < 0 && s.every(f => f.aw === 0 && f.inOrbit))
        allBackAt = performance.now() - t0;
      if (allBackAt >= 0) break;
    }
    const s = window.__kf.sample();
    return { expiredAt: Math.round(expiredAt), allBackAt: Math.round(allBackAt),
             outOfPond, fish: s,
             notBack: s.filter(f => !(f.aw === 0 && f.inOrbit)).length };
  });
  check('④ 饵到期后鱼群回到原轨道（aw=0 且落在各自轨道取值域内）',
    back.allBackAt >= 0 && back.notBack === 0,
    back.allBackAt >= 0
      ? `饵到期 @${back.expiredAt}ms，全部归队 @${back.allBackAt}ms（散开后 ${back.allBackAt - back.expiredAt}ms ≤ 10s）`
      : `20s 内仍有 ${back.notBack} 条未归队`);
  check('⑤ 归队过程同样没有鱼出池', back.outOfPond === 0,
    back.outOfPond ? `${back.outOfPond} 次越界` : '全在池内');

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await finish();

  async function finish(){
    const fails = results.filter(r => !r.ok).length;
    console.log(`\n[koi-feed] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
    try { await browser.close(); } catch {}
    server.close();
    process.exit(fails === 0 ? 0 : 1);
  }
})().catch(e => { console.error('[koi-feed] 探针自身异常：', e); process.exit(1); });
