// 园林陈设（物）守门 · props-guard（2026-10-05）
//
// 守什么：**「登记表 ↔ 场景」的一致 + 「每件真的坐在它该坐的面上」**。
//   14-props.js 的注释把 PROP_SPOTS / PROP_REGISTRY 写成"门禁的唯一真值源"，
//   而 14-props 的注释里也反复出现一类**静默**事故：表里写 1.30、实物却摆在 −0.23
//   （水缸那次）——"表和实物不一致是最坏的一类 bug：门禁按表复核会全绿，眼睛看画面才发现"。
//   本门把这条从"注释里的自觉"变成机器判据：**既查表、也查实物**。
//
// 四条判据（都在真页面上量，不启像素）：
//   ① 登记项字段完整（x/y/z/r/top 有限、r>0、top>0）；
//   ② props 组的**直接子对象数 == 登记条目数**（"多出来的陈设"必须被登记 —— 例如
//      新加一件却忘了 reg()，这条立刻红）；
//   ③ 子对象 ↔ 登记项**双向配对**（按 XZ 距离，容差 max(1.2, r+0.6)）：任何一件场景里的东西
//      配对不上、或任何一条登记找不到实物，都报红；
//   ④ **落地件**（名字不含"帘/挂画"）从 (x, y+1.2, z) 向下打射线（**排除 props 组自身**、
//      不认水面），要求"脚下的那个面"与登记 y 的差 ≤ 0.18m。悬挂件（竹帘/挂画）跳过这条。
//
// ⚠️ 为什么必须排除 props 组自身：Raycaster 不认"这是我自己"，不排除的话量到的永远是
//    陈设自己的顶点，"坐在哪个面上"这件事就完全没被验证。
// ⚠️ 名字里的"帘/挂画"是**悬挂白名单**：它们的登记 y 是帘脚/画脚，正下方就是地面或廊道，
//    拿"脚下那个面"去比没有意义（竹帘挂在额枋下、挂画贴在后墙），所以只查 ②③。
//
// ⚠️⚠️ 为什么支撑面判据是"**第一个不高于自身基准 +0.06m 的命中**"，而不是"第一个命中"：
//    第一次写这道门时我用"按父链排除 props 组"来躲开陈设自己 —— **第一跑就红了 8 条**，
//    而且红得很奇怪：石桌石凳量到的"脚下面"是 0.859（比登记 y=0.099 高 0.76）。
//    真因：`mergeStatics(world)` 会把**陈设的网格从 props 组里搬走**、并进 world 下的
//    `mergedStatic` ⇒ props 组事后只剩一堆空 Group，"沿父链判断是不是自己"全部失效，
//    射线量到的 0.859 正是**石桌自己的桌面**。所以口径改成按**高度**分：
//    陈设的基准在 y，那么"它坐的那个面"不可能高于 y + 0.06（那一定是它自己或它上面的构件）；
//    于是取第一个 ≤ y+0.06 的命中。
//    这条口径**仍然有牙**：实物悬空 ⇒ 量到更低的那个面 ⇒ gap>0 报红；
//    实物陷进去 ⇒ 真正的面在阈值之上被跳过、只好量到更深的面 ⇒ gap<0 报红。
//    两种情况都会被抓住，只是不再依赖"哪个对象是我"。
//
// ── 自检（本门自带负例，证明判据有牙）────────────────────────────────
//   量完一遍之后，页内**现场构造两个违规态**：① 把 PROP_REGISTRY[0].x 挪 +5m
//   ② 往 props 组塞一个未登记的空组。同一套判据必须在这两个态上**报红**
//   （否则就是"永远绿的空门"，同 refract-coverage / weather-coverage 的既有教训）。
//
// 用法: node probe/props-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.png': 'image/png',
               '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

/* 落地件"脚下面"与登记 y 的允许偏差。标定：本门实测最差 0.005（石桌石凳）、
   0.02~0.03（台基/月台面上的几件）⇒ 0.18 留 6 倍余量，只抓"整件摆错面"这一档。 */
const TOL = Number(process.env.PROPS_GUARD_TOL || 0.18);
const HANGING = /帘|挂画/;

/* ── 同一套判据跑两遍：真态（必须全绿）/ 违规态（必须有红）── */
function judge(data){
  const fails = [];
  /* ① 登记项字段 */
  for (const r of data.rows)
    if (![r.x, r.y, r.z, r.r, r.top].every(Number.isFinite) || r.r <= 0 || r.top <= 0)
      fails.push(`登记项字段非法：${r.name}`);
  /* ② 件数 == 登记数 */
  if (data.kids.length !== data.rows.length)
    fails.push(`场景里的陈设件数(${data.kids.length}) ≠ 登记表条目数(${data.rows.length})`
      + (data.kids.length > data.rows.length ? ' —— 有新增陈设没有 reg()' : ''));
  /* ③ 双向配对（贪心最近） */
  const used = new Set(), unmatched = [];
  for (const k of data.kids){
    let best = -1, bd = Infinity;
    data.rows.forEach((r, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(r.x - k.x, r.z - k.z);
      if (d < bd){ bd = d; best = i; }
    });
    const tol = best >= 0 ? Math.max(1.2, data.rows[best].r + 0.6) : 0;
    if (best < 0 || bd > tol)
      unmatched.push(`${k.name}@(${k.x},${k.z}) 最近登记项 ${best >= 0 ? data.rows[best].name : '—'} 距 ${bd.toFixed(2)} > 容差 ${tol.toFixed(2)}`);
    else used.add(best);
  }
  if (unmatched.length) fails.push(`场景里有 ${unmatched.length} 件配不上任何登记项：${unmatched.slice(0, 4).join('；')}`);
  const unclaimed = data.rows.filter((r, i) => !used.has(i)).map(r => r.name);
  if (unclaimed.length) fails.push(`登记了但场景里找不到实物：${unclaimed.slice(0, 6).join('、')}`);
  /* ④ 落地件必须坐在它该坐的面上 */
  for (const r of data.rows){
    if (HANGING.test(r.name)) continue;
    if (!r.support){ fails.push(`${r.name}：脚下 4m 内没有可落的面`); continue; }
    if (r.support.isWater){ fails.push(`${r.name}：坐在水面上（${r.support.n}）`); continue; }
    const gap = +(r.y - r.support.y).toFixed(3);
    if (Math.abs(gap) > TOL)
      fails.push(`${r.name}：与脚下那个面差 ${gap}m（面 ${r.support.y}@${r.support.n}，登记 y=${r.y}）`);
  }
  return fails;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* 采样：登记表 + props 组直接子对象 + 每件的"脚下面"。
     ⚠️ 必须等 bootDonePromise：mergeStatics 会**把网格从各自的组里摘走**，
     采早了拿到的是合并前的对象组成（那就是另一套判据了）。 */
  const collect = (mutate) => page.evaluate(async (m) => {
    const G = window.__garden, T = G.THREE;
    const P = await import('/src/14-props.js');
    const props = G.scene.getObjectByName('props');
    if (!props) return { error: '场景里找不到名为 props 的组' };
    if (m === 'shift') P.PROP_REGISTRY[0] && (P.PROP_REGISTRY[0].x += 5);   // 负例①：登记项挪走
    if (m === 'extra') props.add(new T.Group());                            // 负例②：未登记的多出一件
    const kids = props.children.map(c => {
      const p = c.getWorldPosition(new T.Vector3());
      return { name: c.name || '(无名组)', x: +p.x.toFixed(3), z: +p.z.toFixed(3) };
    });
    const down = new T.Vector3(0, -1, 0), rc = new T.Raycaster();
    const rows = P.PROP_REGISTRY.map(r => {
      rc.set(new T.Vector3(r.x, r.y + 1.2, r.z), down); rc.far = 4;
      const hits = [];
      for (const h of rc.intersectObject(G.scene, true)){
        if (!h.object.isMesh) continue;
        hits.push({ y: +h.point.y.toFixed(3), n: h.object.name || h.object.type,
                    isWater: h.object.name === 'waterSurface' });
        /* ⚠️ 上限给 60 而不是 6：一件陈设自己就有二三十个网格（石桌 = 桌 3 件 + 4 凳 +
           4×8 鼓钉 + 棋盘 + 2 钵 + 茶具…），按"前 6 个命中"截断时，**全部名额都被它自己占满**
           ⇒ 真正的"脚下面"根本没进列表，判据报的是"脚下没有面"的假红（实测 5 件中招）。
           60 是"够穿过任何一件陈设 + 烟/雾絮"的量级，代价可以忽略。 */
        if (hits.length >= 60) break;
      }
      /* 脚下面 = 第一个**不高于自身基准 +0.06** 的命中（口径见文件头） */
      const support = hits.find(h => h.y <= r.y + 0.06) || null;
      return { name: r.name, x: +r.x.toFixed(3), y: +r.y.toFixed(3), z: +r.z.toFixed(3),
               r: r.r, top: r.top, firstHit: hits[0] || null, support };
    });
    return { regCount: P.PROP_REGISTRY.length, spotKeys: Object.keys(P.PROP_SPOTS), kids, rows };
  }, mutate);

  const real = await collect(null);
  if (real.error){ check('场景里存在 props 组', false, real.error); }
  else {
    console.log(`  [采样] 登记 ${real.regCount} 项 · 场景子对象 ${real.kids.length} 件 · PROP_SPOTS 键 ${real.spotKeys.length} 个`);
    for (const r of real.rows)
      console.log(`     · ${String(r.name).padEnd(6)} (${r.x},${r.z}) y=${r.y} r=${r.r} top=${r.top}`
        + `  首命中=${r.firstHit ? `${r.firstHit.y}@${r.firstHit.n}` : '（无）'}`
        + `  面=${r.support ? `${r.support.y}@${r.support.n}${r.support.isWater ? '(水!)' : ''}` : '（悬挂件）'}`
        + `  gap=${r.support && !HANGING.test(r.name) ? (r.y - r.support.y).toFixed(3) : '—'}`);
    const f = judge(real);
    check('登记表 ↔ 场景 一致，且每件坐在它该坐的面上', f.length === 0,
      f.length ? `${f.length} 条：${f.slice(0, 3).join('；')}` : `${real.rows.length} 项全部通过（容差 ±${TOL}m）`);
    /* 正向清单：本次两件新陈设必须在表里、也在场景里 */
    for (const nm of ['古井', '花街铺地'])
      check(`登记表里有「${nm}」`, real.rows.some(r => r.name === nm),
        real.rows.some(r => r.name === nm) ? '' : '缺这一条');
  }

  /* ── 负例自检：同一套判据在违规态上必须报红 ── */
  const shift = await collect('shift');
  const extra = await collect('extra');
  const fShift = shift.error ? ['no props'] : judge(shift);
  const fExtra = extra.error ? ['no props'] : judge(extra);
  check('自检①：把某条登记项挪 5m ⇒ 判据必须报红', fShift.length > 0, fShift[0] || '没报红（判据无牙）');
  check('自检②：往 props 里塞一件未登记的陈设 ⇒ 判据必须报红', fExtra.length > 0, fExtra[0] || '没报红（判据无牙）');
  check('全程零 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[props-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项 · ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[props-guard] 探针自身异常：', e); process.exit(2); });
