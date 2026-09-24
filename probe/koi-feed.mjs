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
import { launchChromium } from './_harness.mjs';

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
  await new Promise(r => server.listen(13000 + ((Math.random() * 17000) | 0), r));
  const port = server.address().port;
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
  const conv = await page.evaluate(async () => {
    const G = window.__garden;
    const t0 = performance.now();
    let turned = 0, outOfPond = 0, samples = 0, worstOut = null;
    const start = window.__kf.sample();
    while (performance.now() - t0 < 3000){
      await new Promise(r => requestAnimationFrame(r));
      const s = window.__kf.sample();
      samples++;
      turned = Math.max(turned, s.filter(f => f.aw > 0.3).length);
      for (const f of s) if (!f.inside){ outOfPond++; if (!worstOut) worstOut = f; }
    }
    const now = window.__kf.sample();
    /* "转向"还要看距离真的在缩短：统计初始有饵、且距饵变近的鱼数 */
    let closing = 0;
    for (let i = 0; i < now.length; i++){
      if (start[i].dToBait !== null && now[i].dToBait !== null && now[i].dToBait < start[i].dToBait) closing++;
    }
    return { turned, closing, outOfPond, samples, worstOut, now };
  });
  check('② 3 秒内 ≥3 条鱼转向饵点', conv.turned >= 3 && conv.closing >= 3,
    `aw>0.3 的最多 ${conv.turned} 条；距饵缩短的 ${conv.closing} 条`);
  check('⑤ 吸引全程**没有鱼出池**（"鱼游到草皮上"是踩过的真 bug）',
    conv.outOfPond === 0, conv.outOfPond ? `${conv.outOfPond} 次越界，例 ${JSON.stringify(conv.worstOut)}`
                                        : `${conv.samples} 帧 × 11 条全在池内`);

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
