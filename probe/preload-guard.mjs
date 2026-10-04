// P1 预载门禁：钉住"进度条不许撒谎"这条判据。
// usage: node probe/preload-guard.mjs
//
// 为什么需要它：这一整套改造**没有症状就会退化** —— 一旦有人把 250ms 采样合并改成
// 逐 chunk 直写、或者把 45/55 的分段改成两条各自重画的进度条，页面照样起来、
// loading-guard 大概率照样全绿（它的 ≤40 上界对"慢 4 倍速刷"根本不敏感），
// 用户只是重新被一条每秒跳 20 次的假动画折磨。所以必须单独钉：
//   ① 相邻两次进度更新间隔 ≥ 250ms   ← 防逐 chunk 刷的**真牙**（不是次数上界）
//   ② 整数百分比去重                  ← 同值不重复写
//   ③ 单调不减
//   ④ 下载段占 0~45%、暖编译段占 45~100%（两段合成为一条）
//   ⑤ 清单与磁盘一致（bytes 是开发期常量，跑偏了进度条会卡在怪数）
//   ⑥ program 数守恒（预载只等网络，不该改变"最终编了多少 program"）
//
// ⚠️ 统计口径：全程用**中位数**，不用峰值/极差（项目铁律 3）。
// ⚠️ 探针启动期采样：与 loading-guard / warmboot-guard 同理，**故意**不等 bootDonePromise
//    去抓启动期那一段（就抓那一段）。但 ⑥ program 数**必须**等 bootDonePromise 之后
//    再读 —— 提前读到的是"延迟批正跑到哪了"，不是收敛值。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                          'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
const results = [];
const check = (label, ok, extra) => { results.push({ label, ok });
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function parseFirstFrame(log){
  if (!log.length) return null;
  const body = log[log.length - 1].replace(/^\[启动分段\]\s*/, '').split(' \uff5c ')[0];
  const ms = body.split(' \u2192 ').map(it => { const m = it.match(/([\d.]+)\s*ms\s*$/); return m ? { name: it.slice(0, m.index).trim(), t: parseFloat(m[1]) } : null; }).filter(Boolean);
  const i = ms.findIndex(x => x.name === '首帧');
  return i < 0 ? null : ms[i].t - (i > 0 ? ms[i-1].t : 0);
}
const med = a => { const v = a.filter(x => Number.isFinite(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : NaN; };

/* 记录进度条的 (宽度, 时刻) 与文案序列。用页内 MutationObserver —— 记"变更当下"，
   所以时间戳与外部时钟口径无关（第一段已证伪过外部时间戳能差 12.7s）。 */
const INIT = () => {
  window.__pg = { w: [], txt: [] };
  const attach = () => {
    const ld = document.getElementById('loading');
    if (!ld) return false;
    const prog = ld.querySelector('.ld-prog'), txt = ld.querySelector('.ld-text');
    if (!prog || !txt) return false;
    const now = () => performance.now();
    new MutationObserver(() => window.__pg.w.push([now(), prog.style.width || '']))
      .observe(prog, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(() => window.__pg.txt.push(txt.textContent || ''))
      .observe(txt, { childList: true, characterData: true, subtree: true });
    window.__pg.w.push([now(), prog.style.width || '']);
    return true;
  };
  if (!attach()){ const iv = setInterval(() => { if (attach()) clearInterval(iv); }, 10); }
};

/* 一臂 = 一个全新 browser（着色器缓存跨页面复用会让 A/B 失效）
   slowM: 给该臂套链路限速，让 4 个 GLB 在 warmBoot 跑起来时**还在飞** ——
          这是唯一能让"下载段"代码路径真正被执行到的办法。
          ⚠️ 带宽不是越低越好：负例臂的带宽直接决定 ⑥ 有没有牙（见文件末尾"负例刻度"）。 */
async function run(chromium, port, { strip, chunky, slowM, mbps }){
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(700000);
  const errs = [], bootLog = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text());
    if (m.text().includes('[启动分段]')) bootLog.push(m.text()); });
  if (slowM){
    /* 链路受限（延迟固定 100ms = 保证 GLB 在 warmBoot 跑起来时**还在飞**）。
       ⚠️ 带宽可调，而它决定 ⑥ 负例有没有牙 —— 见文件末尾"负例刻度"那段注释：
       撤销合并后的中位间隔 ≈ 下载段时长 / 44（整数百分比去重把写入次数封在 ~45 次），
       所以带宽太低（下载段 >11s）时中位间隔必然 ≥250ms，**负例永远红、且证明不了①有牙**。
       1.5Mbps（原值，下载段 ~13s）实测中位 296ms 就是踩在这个上；6Mbps 实测 80ms，
       3 倍余量。可用 PRELOAD_NEG_MBPS 覆盖以复测。 */
    const mb = mbps ?? Number(process.env.PRELOAD_NEG_MBPS || 6);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions',
      { offline: false, latency: 100, downloadThroughput: mb * 1e6 / 8, uploadThroughput: mb * 1e6 / 8 });
  }
  if (strip || chunky){
    let src = fs.readFileSync(path.join(ROOT, 'src/11-loop.js'), 'utf8');
    if (strip){
      const p = src.replace(/^\s*await preloadPhase\(setPreloadUI\)\.promise;\s*$/m, '');
      if (p === src) throw new Error('剥预载段没打上');
      src = p;
    }
    if (chunky){
      // 负例注入：coalesceMs 打成 0 = 撤掉采样合并（等价于"逐 chunk 直刷"）
      const p = src.replace('await preloadPhase(setPreloadUI).promise;',
        'await preloadPhase(setPreloadUI, undefined, 0).promise;');
      if (p === src) throw new Error('负例注入没打上');
      src = p;
    }
    await page.route(u => u.pathname.endsWith('/11-loop.js'),
      r => r.fulfill({ status: 200, contentType: 'text/javascript', body: src }));
  }
  await page.addInitScript(INIT);
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 420000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'),
    { timeout: 560000, polling: 50 }).catch(() => {});
  // ⑥ program 数必须等 bootDonePromise 之后 + 收敛（连续两次不变）
  await page.evaluate(async () => { if (window.__garden?.bootDonePromise) await window.__garden.bootDonePromise; });
  let programs = -1, last = -1, stable = 0;
  for (let i = 0; i < 30 && stable < 2; i++){
    const n = await page.evaluate(() => window.__garden?.renderer?.info?.programs?.length ?? -1);
    if (n === last && n > 0) stable++; else { stable = 0; last = n; }
    programs = n; if (stable < 2) await sleep(1000);
  }
  const d = await page.evaluate(() => {
    const g = window.__garden;
    const s = g && g.preloadState ? g.preloadState() : null;
    return { pg: window.__pg, st: s ? { loaded: s.loaded, total: s.total, settled: s.settled,
             count: s.count, degraded: s.degraded, manifest: s.manifest, totalBytes: s.totalBytes,
             offlineUrl: s.offlineUrl } : null,
             // ⑥ 的判据要用**集合差集**而不是只比长度：差一个投影 program 与"少了一整类材质"
             // 危害完全不同（前者是一次时序差，后者是穿帮）。
             keys: g?.renderer?.info?.programs?.map(p => String(p.cacheKey)) || [] };
  });
  /* ⚠️ 「启动分段」那行 log 是在 startAfterWarm 的 rAF 回调里打的，早于我们判定
     `loading.done` 的那一刻 —— 直接 parse 会取不到「首帧」刻度（实测确实取不到，
     ⑥c 于是变成永真）。在这里**主动等那行 console 出现**（只等这一行，
     不等 bootDonePromise —— 不破坏"启动期采样"的语义；warmboot-guard 用同一手法）。 */
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !bootLog.length) await sleep(200);
  const marks = parseFirstFrame(bootLog);
  await browser.close();
  return { ...d, programs, errs, first: marks };
}

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();

  console.log('【臂 A：产品路径】');
  const A = await run(chromium, port, {});
  const W = A.pg.w.map(([t, w]) => [t, parseFloat(w)]).filter(([, v]) => !Number.isNaN(v));

  // ── 前提断言：不先断言前提就下结论，是本项目最常见的一类假绿
  check('前提：进度条有真实时间戳序列（observer 挂上了）', W.length >= 2, `${W.length} 个采样`);
  check('前提：__garden.preloadState 存在（否则后面几条都是永真）', !!A.st, A.st ? `settled ${A.st.settled}/${A.st.count}` : '取不到');
  if (!W.length || !A.st){ server.close(); process.exit(1); }

  // ① 采样合并：相邻两次更新间隔 ≥ 250ms —— **用中位数**（铁律 3）
  const gaps = [];
  for (let i = 1; i < W.length; i++) gaps.push(W[i][0] - W[i - 1][0]);
  const gMed = med(gaps);
  check('① 进度更新是"采样合并"而非逐 chunk 刷（中位间隔 ≥ 250ms）', gMed >= 250,
    `中位 ${gMed?.toFixed(0)}ms（共 ${W.length} 次更新，最小 ${Math.min(...gaps)?.toFixed(0)}ms）`);

  // ② 整数百分比去重
  const pcts = W.map(([, v]) => Math.round(v));
  const dupes = pcts.filter((v, i) => i > 0 && v === pcts[i - 1]);
  check('② 同一整数百分比不重复写（去重生效）', dupes.length === 0,
    `重复 ${dupes.length} 次${dupes.length ? '：' + dupes.join(',') : ''}`);

  // ③ 单调不减
  const drops = [];
  for (let i = 1; i < pcts.length; i++) if (pcts[i] < pcts[i - 1]) drops.push(`${pcts[i - 1]}→${pcts[i]}`);
  check('③ 进度单调不减（不许来回跳）', drops.length === 0, drops.length ? '倒退：' + drops.join(',') : `0→${pcts[pcts.length - 1]}`);

  // ④ 两段合成为一条：下载段 0~45、暖编译段 45~100
  const below = pcts.filter(v => v > 0 && v < 45).length;
  const above = pcts.filter(v => v >= 45 && v < 100).length;
  check('④ 下载段落在 0~45%、暖编译段落在 45~100%（两段合成一条）',
    below === 0 && above > 0 && pcts[pcts.length - 1] === 100,
    `<45 的采样 ${below} 个（须 0），45~99 的 ${above} 个，终值 ${pcts[pcts.length - 1]}`);

  // ⑤ 清单与磁盘一致（bytes 是开发期常量；跑偏了进度条会卡在怪数）
  let drift = [];
  for (const it of (A.st.manifest || [])){
    const abs = path.join(ROOT, it.url);
    const real = fs.existsSync(abs) ? fs.statSync(abs).size : -1;
    if (real !== it.bytes) drift.push(`${it.url} ${it.bytes}→${real}`);
  }
  const sum = (A.st.manifest || []).reduce((a, b) => a + b.bytes, 0);
  check('⑤ 预载清单的 bytes 与磁盘一致（单一真值没漂）', drift.length === 0,
    drift.length ? drift.join('; ') : `${(sum / 1048576).toFixed(3)} MB / ${(A.st.manifest || []).length} 项`);
  check('⑤b 预载总量 = 清单 bytes 之和（聚合没有算错）', A.st.total === sum, `${A.st.total} vs ${sum}`);

  console.log('\n【臂 B：无预载段（对照）】');
  const B = await run(chromium, port, { strip: true });
  check('前提：对照臂能取到 program 数', B.programs > 0, `A=${A.programs} B=${B.programs}`);

  /* ⑥ program 守恒 —— 这条断言**改过一次口径**（2026-09-27），理由必须留在代码里：
     原写法是"预载臂 programs == 对照臂 programs"，实测**确定性地少 1**（两轮各 2 次全复现，
     12 次采样/铁律 3 口径下不是噪声）。查因结论（outputs/_diag/program-key-diff.mjs，
     用 cacheKey 集合差集定位）：
        收敛时   A(带预载)=84  B(对照)=85   差 −1
        强制把相机绕场 8 方向全渲一遍后  A=90  B=91  差仍 −1（**没归零**）
        差集里 A 有 3 个、B 有 4 个，唯一的净差是 **B 独有**：
            `depth,highp,srgb-linear,...`
     那个 `depth` 前缀 = Three.js 为**投影（castShadow）网格**自动生成的
     `MeshDepthMaterial` 程序（项目里没人写 customDepthMaterial，全项目仅 vendor.js 命中）。
     机制：`collectWarmBuckets()` 在**调用那一刻**对场景拍快照，而
        · 对照臂：warmBoot 立即跑 ⇒ 快照早 ⇒ 4 个 GLB 还没 attach ⇒ 不在桶里，
          保持 visible ⇒ 随后被"彩排帧"（reveal 全部桶后的全生产路径渲染）连投影一起编掉；
        · 预载臂：先 await（哪怕是"同步返回"也会抽干微任务队列）⇒ 至少一个 GLB 已 attach
          ⇒ 它进了桶 ⇒ 分桶帧用 `hidden=true` 的彩排路径渲染**不投影**，
          而它真正的投影 program 改由之后**首帧可见时**的正常渲染补上。
     ⇒ 少的那 1 个是"**换个时刻编**"，不是"丢失"：B 独有的那 3 个（`10,11`/`12,13`/`14,15`
        三种实例化变体）A 也有，所以 A 不是"少编了一类材质"，只少了 1 次投影编译。
     ⚠️ 但"换个时刻编"不等于"无害"：它意味着该 program 会在**首帧之后的某一次可见渲染**
        里现场编译 ⇒ 理论上一次小卡顿。实测未观测到（两臂首帧段 60~132ms，均 ≤ 预算），
        因为首帧本来就会把相机对着的对象全渲一遍。**所以这里断的是"没有整类材质丢失"**，
        而不是"program 数必须逐个相等"——后者会把一次正常的时序差判成事故。 */
  const onlyA = (A.keys || []).filter(k => !(B.keys || []).includes(k));
  const onlyB = (B.keys || []).filter(k => !(A.keys || []).includes(k));
  /* ⚠️ **不能**拿"完整 cacheKey 集合"直接比 —— 那是**变体**（`10,11` vs `10,12`）级别的，
     同一个材质类的不同实例化/光源参数组合会编出不同的 key，于是两臂正常就会差好几条
     （实测 A 独有 3 / B 独有 4）。那样比等于把正常的时序差判成事故。
     有意义的是**族**（cacheKey 第一个逗号前的类型标识：MeshBasicMaterial / 10 / depth …）：
     "一整类材质完全没被编出来"才是穿帮级的故障。 */
  const fam = ks => new Set(ks.map(k => k.split(',')[0]));
  const famA = fam(A.keys || []), famB = fam(B.keys || []);
  const famOnlyB = [...famB].filter(f => !famA.has(f));
  const famOnlyA = [...famA].filter(f => !famB.has(f));
  check('⑥ 没有整类材质丢失（预载臂不含"对照臂完全没有"的 program 族）',
    famOnlyA.length === 0, famOnlyA.length ? famOnlyA.join(',') : `A 独有族 ${famOnlyA.length} 个`);
  check('⑥b program 差额已定位：唯一缺失的族是 depth（投影程序），属"换个时刻编"而非丢失',
    famOnlyB.length === 0 || (famOnlyB.length === 1 && famOnlyB[0] === 'depth'),
    `B 独有族: ${famOnlyB.join(',') || '无'}（A ${A.programs} / B ${B.programs}，`
    + `完整 key 差 A${onlyA.length}/B${onlyB.length} 属正常变体差）`);
  /* 真正对用户有意义的是"那 1 个换到别处编去了，会不会变成一次卡顿" ⇒ 断首帧段。 */
  check('前提：取得到「首帧」刻度（否则 ⑥c 是永真，不许静默通过 —— 铁律 4）',
    A.first !== null && Number.isFinite(A.first),
    A.first === null ? '启动分段里没有「首帧」刻度' : `首帧段 ${A.first.toFixed(1)}ms`);
  check('⑥c 补编（若发生）在首帧预算内（≤800ms，与 warmboot-guard 同阈值）',
    A.first !== null && Number.isFinite(A.first) && A.first <= 800,
    A.first === null ? '取不到刻度，不能判' : `首帧段 ${A.first.toFixed(1)}ms`);

  check('零 pageerror / console error', A.errs.length === 0 && B.errs.length === 0,
    (A.errs[0] || B.errs[0]) || `${A.errs.length}/${B.errs.length} 条`);

  /* ── 负例自检：必须跑在**链路受限、但数据快节奏到达**的臂上 ──────────────────
     ⚠️ 两个刻度都踩过坑，缺一不可：
     ① **不能跑在不限速臂上**（第一版）：本地档 GLB 早就下完 ⇒ 走的是**零等待分支**，
        `setInterval` 根本没建起来，coalesceMs 传 0 完全无效 ⇒ 负例是**永真**的
        （"注入没改到东西"也能过）。所以臂上必须有在飞的资产，才会真正进 tick 循环。
     ② **也不能跑在太慢的链路上**（2026-10-05 修）：撤销合并后的中位间隔 ≈
        **下载段时长 ÷ 44** —— 因为产品还有"同一整数百分比不重复写"这条去重，
        下载段映射到 0~45%，写入次数封顶在 ~45 次，于是间隔完全由**下载时长**决定。
        原值 1.5Mbps（下载段 ~13s）算出中位 296ms **仍在 250ms 之上** ⇒ ① 在该档
        根本不区分"有没有合并"，负例永远红、且证明不了 ① 有牙。
        ⚠️ 由此换算出**判据自己的适用边界**：① 只在"下载段短于 44×250ms ≈ 11s"的
        链路上才有牙；比这更慢的链路，逐百分比写入本来就慢于 250ms，不加合并也不会
        "每秒跳 20 次"。这不是产品缺陷，是 ① 的适用范围 —— 写在这里，别再回头去动
        那个 250ms。
        ⇒ 带宽改 6Mbps（下载段 ~3.5s ⇒ 预计中位 ~80ms，3 倍余量）。
        标定脚本：outputs/_diag/preload-neg-sweep.mjs（扫 5 档，1.5Mbps 复现 296ms）。 */
  console.log('\n【臂 C：负例自检（100ms 延迟 + 6Mbps）—— 撤掉 250ms 采样合并】');
  const C = await run(chromium, port, { chunky: true, slowM: true });
  const WC = C.pg.w.map(([t, w]) => [t, parseFloat(w)]).filter(([, v]) => !Number.isNaN(v));
  const gapsC = [];
  for (let i = 1; i < WC.length; i++) gapsC.push(WC[i][0] - WC[i - 1][0]);
  const gMedC = med(gapsC);
  // 前提：负例臂必须真的走进了下载段（宽度序列里要有 <45 的采样）
  const inDownloadPath = WC.some(([, v]) => v > 0 && v < 45);
  check('⑥ 负例前提：限速臂确实走进了下载段（否则注入无效、这条负例是永真）',
    inDownloadPath, `0~45 的采样 ${WC.filter(([, v]) => v > 0 && v < 45).length} 个`);
  check('⑥ 负例自检：撤掉 250ms 合并后，① 的中位间隔必然跌破 250ms（证明 ① 有牙）',
    gMedC < 250, `注入后中位 ${gMedC?.toFixed(0)}ms（共 ${WC.length} 次更新；≈ 下载段时长/44 ⇒ 链路须快于 ~11s 才判得出）`);

  const fail = results.filter(r => !r.ok).length;
  console.log(`\n[预载] ${results.length - fail}/${results.length} 项通过`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('[预载] 异常：', e); server.close(); process.exit(1); });
