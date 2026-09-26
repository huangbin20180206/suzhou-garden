// 灯会挂灯扩展门禁（2026-09-26）—— 守用户这一轮的两件新东西：
//   A 柳树 + 紫藤挂**花灯**（形制照抄桃树那盏，只换挂点）
//   B 院子**围栏**挂**传统红灯笼**（新形制，与花灯可区分）
//
// 沿用 festival-guard 的三条铁规矩：
//   ① **不新增真光源** —— 真光源恒为灯笼那 5 盏（lampLights===5）。
//   ② **非灯会态零提交** —— 三个挂灯网格 count 必须全 = 0。
//   ③ **draw calls 仍 < 800**（既有红线）。
//
// 判据文化（项目规矩）：先断言前提 → 配**负例自检** → 统计量做硬。
// 负例自检有两条，互相独立：
//   · 把新增挂灯 count 改 0（模拟"挂灯没建出来"）⇒ 显形判据必须报红；
//   · 关掉灯会（festivalShow=0）⇒ 零提交判据必须报红。
// 用法: node probe/festival-lanterns-guard.mjs
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  console.log(`\n[festival-lanterns-guard] http://127.0.0.1:${port}/index.html`);

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* 页内工具：按 userData.festivalHang 标记找挂灯网格（不靠名字猜） */
  await page.evaluate(() => {
    const g = window.__garden;
    window.__fl = {
      hangObjs(){
        const out = [];
        g.scene.traverse(o => { if (o.isInstancedMesh && o.userData.festivalHang) out.push(o); });
        return out;
      },
      /* 挂灯的**实际世界位置**（跟实例矩阵，判"画面上真在哪"） */
      hangPos(objs){
        const T = g.THREE, m4 = new T.Matrix4(), v = new T.Vector3(),
              q = new T.Quaternion(), s = new T.Vector3(), out = [];
        for (const o of objs){
          const arr = [];
          for (let i = 0; i < o.count; i++){
            o.getMatrixAt(i, m4); m4.decompose(v, q, s);
            arr.push([+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]);
          }
          out.push({ kind: o.userData.hangKind, pos: arr });
        }
        return out;
      },
      calls(){ return g.renderer.info.render.calls; },
    };
  });

  /* ── 前提：挂点已收集、三个网格都在 ── */
  const pre = await page.evaluate(() => {
    const g = window.__garden, objs = window.__fl.hangObjs();
    return { built: g.festivalState().hangBuilt, kinds: objs.map(o => o.userData.hangKind),
             objs: objs.length, calls: window.__fl.calls() };
  });
  check('前提：挂点已在延迟批收尾后收集完（hangBuilt=true）', pre.built === true, `hangBuilt=${pre.built}`);
  check('前提：柳花灯/紫藤花灯/围栏红壁灯三个网格齐备（各一份合并几何）',
    pre.objs === 3 && ['willowFlower', 'wisteriaFlower', 'wallRed'].every(k => pre.kinds.includes(k)),
    `objs=${pre.objs} kinds=${JSON.stringify(pre.kinds)}`);

  /* ── ② 非灯会态零提交 ── */
  const off = await page.evaluate(() => {
    const g = window.__garden, objs = window.__fl.hangObjs();
    return { st: g.festivalState(), counts: objs.map(o => o.count), caps: objs.map(o => o.instanceMatrix.count),
             calls: window.__fl.calls() };
  });
  check('② 非灯会态：三批挂灯 count 全 = 0（零提交、零 draw call）',
    off.counts.every(c => c === 0) && off.caps.every(c => c > 0),
    `count=${JSON.stringify(off.counts)} 容量=${JSON.stringify(off.caps)} · draw calls=${off.calls}`);

  /* ── ① 不新增真光源 ── */
  check('① 不新增真光源：真光源仍是灯笼那 5 盏',
    off.st.lampLights === 5, `lampLights=${off.st.lampLights}`);

  /* ── 开灯会：数量显形 ── */
  const on = await page.evaluate(async () => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
    g.toggleFestival(true);
    await new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) await new Promise(r => requestAnimationFrame(r));
    const objs = window.__fl.hangObjs();
    return { st: g.festivalState(), counts: objs.map(o => o.count),
             calls: window.__fl.calls(), show: g.ENV.cur.festivalShow };
  });
  const byKind = Object.fromEntries(on.st.hang.map(h => [h.kind, h]));
  check('② 开灯会：三批挂灯全部显形（count = fullCount）',
    on.counts.every((c, i) => c > 0 && c === on.st.hang[i].full),
    on.st.hang.map(h => `${h.kind}=${h.n}/${h.full}`).join(' · '));
  check('A 柳树：4 株全挂（挂点数 = 4 × 每株 12）', byKind.willowFlower.n === 48,
    `柳花灯 ${byKind.willowFlower?.n} 盏`);
  check('A 紫藤：只挂两丛大藤架（12 × 2）', byKind.wisteriaFlower.n === 24,
    `紫藤花灯 ${byKind.wisteriaFlower?.n} 盏`);
  check('B 围栏红灯笼：四边成排（≥30 盏）', byKind.wallRed.n >= 30,
    `红壁灯 ${byKind.wallRed?.n} 盏`);
  check('③ 灯会态 draw calls 仍 < 800（既有红线）', on.calls < 800, `draw calls=${on.calls}`);

  /* ── 一个灯笼一份几何 ⇒ 3 个对象（合并的收益，硬指标）── */
  const total = on.st.hang.reduce((a, h) => a + h.n, 0);
  check('硬指标：一个灯笼 = 一份合并几何 = 一个 InstancedMesh（对象数恒为 3，与盏数无关）',
    on.st.hang.length === 3 && on.st.hang.every(h => h.objs === 1),
    `${total} 盏灯只占 ${on.st.hang.length} 个对象（诊断试摆拆 4~5 件时报 +26 draw call）`);

  /* ── 挂点位置合理性：贴树冠 / 贴藤 / 贴墙檐 ── */
  const geo = await page.evaluate(() => {
    const g = window.__garden, W = 60, D = 45;
    const byK = Object.fromEntries(window.__fl.hangPos(window.__fl.hangObjs()).map(o => [o.kind, o.pos]));
    const stat = (arr) => ({ n: arr.length,
      yMin: +Math.min(...arr.map(p => p[1])).toFixed(2), yMax: +Math.max(...arr.map(p => p[1])).toFixed(2) });
    /* 墙灯必须在四面围墙**内侧**、檐下（y≈3.95），且离墙心带 ≤1.6m */
    const wall = byK.wallRed || [];
    const onRing = wall.filter(([x, , z]) => Math.abs(Math.abs(x) - (W/2 - 0.95)) < 0.3
                                      || Math.abs(Math.abs(z) - (D/2 - 0.95)) < 0.3);
    const yOK = wall.filter(([, y]) => y > 3.6 && y < 4.4).length;
    return { willow: stat(byK.willowFlower || []), wisteria: stat(byK.wisteriaFlower || []),
             wall: stat(wall), wallOnRing: onRing.length, wallYOK: yOK };
  });
  check('B 围栏红灯笼：落在四面围墙内侧带、檐下高度 3.6~4.4m',
    geo.wallOnRing === geo.wall.n && geo.wallYOK === geo.wall.n,
    `贴墙带 ${geo.wallOnRing}/${geo.wall.n} · 高度合格 ${geo.wallYOK}/${geo.wall.n}（y ${geo.wall.yMin}~${geo.wall.yMax}）`);
  /* 柳冠实测（诊断 outputs/_diag/lantern-hangpts.mjs）：叶幕 y 2.30~6.61。
     挂点取冠中段 yP25~yP75 再垂 0.15 ⇒ 上界 6.6、下界 1.5 都留了余量。 */
  check('A 柳树挂灯：挂点在冠内（y 1.5~6.6m），不是浮在空中也不是贴树梢',
    geo.willow.n > 0 && geo.willow.yMin > 1.5 && geo.willow.yMax < 6.6,
    `柳 ${geo.willow.n} 盏 y ${geo.willow.yMin}~${geo.willow.yMax}（叶幕 2.30~6.61，取中段 + 垂 0.15）`);
  check('A 紫藤挂灯：挂在藤架高度（y 2.8~3.3m，藤在 3.35）',
    geo.wisteria.n > 0 && geo.wisteria.yMin > 2.7 && geo.wisteria.yMax < 3.4,
    `紫藤 ${geo.wisteria.n} 盏 y ${geo.wisteria.yMin}~${geo.wisteria.yMax}`);

  /* ── 负例自检 ①：把新增挂灯 count 改 0 ⇒ 显形判据必须报红 ──
     （模拟"挂灯没建出来 / 建在了错时机"这个最可能的回归） */
  const negCount = await page.evaluate(() => {
    const objs = window.__fl.hangObjs();
    const saved = objs.map(o => o.count);
    objs.forEach(o => { o.count = 0; });
    const st = window.__garden.festivalState();
    /* 用与上面"开灯会显形"判据同口径的算式复算一遍，必须为假 */
    const visible = st.hang.every(h => h.n > 0 && h.n === h.full);
    objs.forEach((o, i) => { o.count = saved[i]; });     // 复原
    return { visible, ns: st.hang.map(h => h.n) };
  });
  check('负例自检 ①：把新增挂灯 count 改 0 后，"三批挂灯全部显形"判据必须报红',
    negCount.visible === false, `改 0 后 n=${JSON.stringify(negCount.ns)} ⇒ visible=${negCount.visible}`);

  /* ── 负例自检 ②：关灯会 ⇒ 零提交判据必须报红（同时验证复原有效） ── */
  const back = await page.evaluate(async () => {
    const g = window.__garden;
    g.toggleFestival(false);
    await new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now();
    while (performance.now() - t0 < 4500) await new Promise(r => requestAnimationFrame(r));
    const objs = window.__fl.hangObjs();
    return { show: g.ENV.cur.festivalShow, counts: objs.map(o => o.count),
             calls: window.__fl.calls(), lamp: g.festivalState().lampLights };
  });
  check('② 关灯会后三批挂灯 count 归 0（负例：零提交判据确实会因灯会开而变红）',
    back.counts.every(c => c === 0) && back.show < 0.03,
    `count=${JSON.stringify(back.counts)} festivalShow=${(+back.show).toFixed(2)} · draw calls=${back.calls}`);
  check('① 开关两态真光源都仍是 5 盏', back.lamp === 5, `lampLights=${back.lamp}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[festival-lanterns-guard] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[festival-lanterns-guard] 探针自身异常：', e); process.exit(1); });
