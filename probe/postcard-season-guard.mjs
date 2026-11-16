/* postcard-season-guard — 四季四联明信片（2026-11-16）
   ────────────────────────────────────────────────────────────────────────
   状态：新增门（本门随功能一起进仓库，当前应为绿）。

   它守四件事，任一条不成立就是功能坏了：
   ① 按钮与挂载：`#env button[data-act="seasons"]` 存在、标签是「四联」、图标走 data-ic，
      `HOOKS.postcardSeasons` / `HOOKS.postcardSeasonsData` 都是函数；
   ② 立刻落位：`setEnv('season', …)` 之后 `settleEnv()` 必须一步把 ENV.t 推到 1
      —— 四联要的是"同一刻只换季节"，靠 2.8s 过渡自己走完就拍不成；
   ③ 四格真的不同：按 `seasonsLayout()` 给出的每格像素矩形，两两做**逐像素**平均差
      （|ΔR|+|ΔG|+|ΔB| 除以 3，再对全格求平均，0~255），最小的一对也必须过阈值。
      ⚠️ 2026-11-17 自查纠错：初版比的是"两格各自的通道均值之差"，春↔夏只读出 1.0，
      差点被当成"春夏没区别"的缺陷——**均值之差会把逐像素差异抵消掉**（花开了几万像素、
      别处又暗了同样多，均值就差 0）。同一批帧改逐像素差后春↔夏 = 5.04，
      同季重渲两次的噪声底 = 0.00，可见初版量错了对象。本门只认逐像素差。
   ④ 拍完还原：用户原来的季节要回来、ENV.t 落回 1（不能让人点一下按钮就被丢进过渡）。

   ⚠️ 只量"四格互不相同"和"版面成立"，**不量好不好看**——观感由人眼定，门禁只防退化。
   ⚠️ 阈值取的是"远低于实测值"的下限（实测见 docs/gate-evidence/2026-11-16-seasons-postcard/），
      不是卡着读数定的，避免下一次调色/调光被误报红。 */
import { chromium } from 'playwright';
import { makeStaticServer, listenEphemeral, launchChromium } from './_harness.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const OUT_DIR = 'docs/gate-evidence/2026-11-16-seasons-postcard';
const MIN_PAIR_DIFF = 2.5;    // 逐像素平均差下限：噪声底 0.00、实测最小一对 5.04（春↔夏），取一半余量

const server = makeStaticServer(path.resolve(fileURLToPath(new URL('../', import.meta.url))));
const port = await listenEphemeral(server); let browser;
try {
  browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?tier=low&debug=1`);
  await page.waitForFunction(() => window.__garden, null, { timeout: 120000 });
  await page.evaluate(async () => { const a = await import('/src/08-assemble.js'); await a.bootDonePromise; });

  /* ── ① 按钮与挂载 ── */
  const wired = await page.evaluate(async () => {
    const { HOOKS } = await import('/src/00-config.js');
    const b = document.querySelector('#env button[data-act="seasons"]');
    return {
      btn: !!b, label: b ? b.textContent.trim() : null, ic: b ? (b.dataset.ic || '') : '',
      hook: typeof HOOKS.postcardSeasons, dataHook: typeof HOOKS.postcardSeasonsData,
    };
  });
  console.log('WIRED', JSON.stringify(wired));
  assert.ok(wired.btn, 'seasons button exists in #env');
  assert.equal(wired.label, '四联', 'button label is 四联（图标由 data-ic 注入，标签里不许带字形）');
  assert.equal(wired.ic, '▦', 'icon glyph comes from data-ic');
  assert.equal(wired.hook, 'function', 'HOOKS.postcardSeasons is wired');
  assert.equal(wired.dataHook, 'function', 'HOOKS.postcardSeasonsData is wired');

  /* ── ② 立刻落位 ── */
  const settle = await page.evaluate(async () => {
    const { ENV, setEnv, settleEnv } = await import('/src/12-env.js');
    const keep = ENV.season;
    setEnv('season', 'winter');
    const tMid = ENV.t;                       // 过渡刚起步：应≈0，不能已经 1
    const did = settleEnv();
    const tEnd = ENV.t;
    setEnv('season', keep); settleEnv();
    return { keep, tMid: +tMid.toFixed(3), tEnd, did, back: ENV.season, backT: ENV.t };
  });
  console.log('SETTLE', JSON.stringify(settle));
  assert.ok(settle.tMid < 0.5, 'setEnv starts a transition (t≈0), so settleEnv has real work to do');
  assert.equal(settle.did, true, 'settleEnv reports it landed the transition');
  assert.equal(settle.tEnd, 1, 'settleEnv lands on ENV.t=1 in one call');
  assert.equal(settle.back, settle.keep, 'season is restored after the probe');
  assert.equal(settle.backT, 1, 'restore also lands immediately (no 2.8s transition left running)');

  /* ── ③④ 合成一张、量四格、看还原 ── */
  const shot = await page.evaluate(async () => {
    const { HOOKS } = await import('/src/00-config.js');
    const { ENV } = await import('/src/12-env.js');
    const L = await import('/src/11-loop.js');
    const before = { season: ENV.season, t: ENV.t };
    const t0 = performance.now();
    const url = HOOKS.postcardSeasonsData();
    const ms = Math.round(performance.now() - t0);
    const after = { season: ENV.season, t: ENV.t };
    const layout = L.seasonsLayout();
    if (!layout) return { layoutMissing: true, url };
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const pixels = layout.rects.map(r => g.getImageData(r.x, r.y, r.w, r.h).data);
    /* 逐像素平均差：|ΔR|+|ΔG|+|ΔB| / 3，对全格求平均（0~255） */
    const mad = (a, b) => {
      let sum = 0;
      for (let i = 0; i < a.length; i += 4)
        sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      return +((sum / (a.length / 4)) / 3).toFixed(2);
    };
    const quads = layout.rects.map((r, i) => ({ season: r.season, rect: [r.x, r.y, r.w, r.h], px: pixels[i].length / 4 }));
    const pairs = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++)
      pairs.push({ p: quads[i].season + '-' + quads[j].season, d: mad(pixels[i], pixels[j]) });
    /* 左上角 6×6 应落在宣纸色上（外框塌了这里就会变成画面像素） */
    const corner = g.getImageData(2, 2, 6, 6).data;
    let cr = 0, cg = 0, cb = 0; const cn = corner.length / 4;
    for (let i = 0; i < corner.length; i += 4){ cr += corner[i]; cg += corner[i + 1]; cb += corner[i + 2]; }
    const paper = [cr / cn, cg / cn, cb / cn].map(v => Math.round(v));
    return { before, after, ms, size: [img.width, img.height], quads, pairs, paper, url };
  });
  assert.ok(!shot.layoutMissing, 'seasonsLayout() exposes the quadrant rects');
  console.log('COMPOSITE', JSON.stringify({ before: shot.before, after: shot.after, ms: shot.ms, size: shot.size, paper: shot.paper }));
  for (const q of shot.quads) console.log('QUAD', q.season, 'rect=' + JSON.stringify(q.rect), 'px=' + q.px);
  for (const p of shot.pairs) console.log('DIFF', p.p, p.d);

  assert.ok(shot.size[0] > 1280 && shot.size[1] > 720, `composite is a 2×2 sheet (got ${shot.size.join('×')})`);
  assert.ok(shot.ms < 20000, `composite renders in bounded time (${shot.ms}ms)`);
  const minPair = shot.pairs.reduce((m, p) => (p.d < m.d ? p : m), shot.pairs[0]);
  assert.ok(minPair.d >= MIN_PAIR_DIFF, `every pair of seasons differs (min ${minPair.p}=${minPair.d} >= ${MIN_PAIR_DIFF})`);
  assert.equal(shot.after.season, shot.before.season, 'user season restored after compositing');
  assert.equal(shot.after.t, 1, 'no transition left running after compositing');
  /* 纸边：宣纸色 #efe9dc = (239,233,220)，容差 12 —— 若这里变成画面像素，说明外框塌了 */
  const paperOk = Math.abs(shot.paper[0] - 239) <= 12 && Math.abs(shot.paper[1] - 233) <= 12 && Math.abs(shot.paper[2] - 220) <= 12;
  assert.ok(paperOk, `paper margin present (corner rgb ${shot.paper.join(',')})`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const png = Buffer.from(shot.url.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT_DIR, '01-seasons-quad.png'), png);
  fs.mkdirSync('outputs/_diag', { recursive: true });
  fs.writeFileSync('outputs/_diag/seasons-quad-20261117.png', png);
  console.log('SAVED', path.join(OUT_DIR, '01-seasons-quad.png'), png.length + 'B');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('ALL PASS: seasons button / settleEnv lands instantly / four quadrants differ / paper margin / season restored / page errors');
} finally {
  await browser?.close();
  server.close();
}
