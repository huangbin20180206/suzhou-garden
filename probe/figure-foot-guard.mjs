// 人物落脚 figure-foot-guard（2026-10-04 加）
//
// 守什么：**"人物没有站在他脚下的那个面上"** —— 这一类缺陷此前**没有任何门禁覆盖**：
//   figure-audit 查服色/道具/取景，从不查脚底；layout-fingerprint 不哈希人物（noMerge）。
//   2026-10-04 实测抓到两例（老黄要的"不要放过细节和逻辑合理性"）：
//     · 品茗的人 root.position.y 写死 0，而水榭台基顶面是 0.62 ⇒ **陷进台基 0.62m**，
//       1.61m 的人只剩 1.0m 露在外面（截图里读作"半截身子插在台基里"）；
//     · 夜步的人散步区间 z∈[1.3,−3.8]，而游廊那条腿只到 z=−1.8 ⇒ **2.5m 是在池面上走的**
//       （首个命中就是 waterSurface）。
//   两例的共同点是"状态全对、不报错、断言全绿，只有量脚下才看得见"。
//
// 手法（纯状态 + 射线，零像素）：
//   ① 对每个点景人物，从 y=20 向下打射线：3.0 只做"滤屋顶/檐口"（水榭/游廊的人头上都有顶）；
//      地面取 y<3.0 命中里**离脚底最近**的（2026-10-13 修：灯笼体积光 lampVol 按名排除，非可站面）；
//   ② 散步的人**沿整条散步区间扫描**（采样点按公式静态算出，不移动人物），不能只量起点 —— 起点对不代表全程对；
//   ③ 判据两条：脚下那个面**不能是 waterSurface**；|脚底 − 脚下那个面| ≤ TOL。
//
// ⚠️ 射线必须**排除人物自己**：Raycaster 不认 .visible（父级隐藏也照样命中），
//    所以量之前先把全部人物隐藏、并沿父链复核可见性（2026-10-04 我在这里踩过一次，
//    量出来的"地面"其实是学者的头/袍）。
//
// 自检：`FIGURE_FOOT_SELFTEST=1` 把每个人物的 y 强制归 0（= 复现修复前的缺陷态）⇒
// 门必须报红，证明这条判据有牙。
// 用法: node probe/figure-foot-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.mp3': 'audio/mpeg', '.webmanifest': 'application/webmanifest', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const SELFTEST = process.env.FIGURE_FOOT_SELFTEST === '1';
/* 脚下面与脚底的允许偏差。标定：静态人物实测 0.003~0.006；散步者沿全程实测 ≤0.11
   （他走的是**廊道铺装**，比地形公式平，取常数 y 比跟地形更准）。0.15 留约 1.4 倍余量。 */
const TOL = Number(process.env.FIGURE_FOOT_TOL || 0.15);
const EXPECT_FIGS = 14;                     // 先生 + 2 书童 + 夜步 + 对弈二人（坐姿）2
                                            // + 看烟花的一家 5（2 大人 + 3 孩童，2026-10-05 春节烟花配套）
                                            // + 观鱼人（拱桥）+ 仕女（井边）（2026-10-05）
                                            // + 马夫（南墙外马厩，2026-10-09 —— 他站在**马厩台基**上
                                            //   而不是地形上，本门用"向下射线取真实命中面"量，所以照过）
                                            // 2026-10-25 起抚琴人由 16-actors 的 AI 人物承担，不在点景人物之列，故 16→15
                                            // ⚠️ 2026-10-28 15→14：水榭那位程序化"品茗"站像下线（老黄截图
                                            //   红框"低模人物去掉" —— 与搬进水榭的 AI 抚琴人在同一间亭子里重复）。
                                            //   要恢复它，这里同步改回 15。

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.addStyleTag({ content: '#hud,#env,#caption,#loading{display:none !important}' });
  await page.evaluate(() => { const G = window.__garden; G.ENV.dur = 0.25; });
  await page.waitForTimeout(600);

  const data = await page.evaluate(async (selftest) => {
    const G = window.__garden, T = G.THREE;
    const A = await import('/src/08-assemble.js');   // 取产品自己的 walkPointAt（见文件头"巡游者"一条）
    const SC = await import('/src/02-scene.js');   // 只读画质档（前提断言：volume:true 档下 lampVol 才存在）
    const figs = G.figures || [];
    /* 复现缺陷态：人全按回 y=0（修复前就是这个值），
       并把散步区间换回修复前的 [1.3, −3.8]（那段有 2.5m 在池面上）——
       两条判据都要被证明有牙，只复现其中一条等于只验了一半。 */
    if (selftest) {
      figs.forEach(f => { f.userData.baseY = 0; f.position.y = 0; });
      let done = false;
      figs.forEach(f => {
        if (!done && f.userData.slot && f.userData.slot.stroll) {
          f.userData.slot.stroll = { a: 13.4, b: 13.4, z0: 1.3, z1: -3.8, sp: 0.027 };
          done = true;
        }
      });
    }

    const was = figs.map(f => f.visible);
    const shown = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    figs.forEach(f => { f.visible = false; });          // 量之前隐藏全部人物

    const rc = new T.Raycaster();
    const down = new T.Vector3(0, -1, 0);
    let lampVolSkipped = 0;   // 前提断言用：本轮按名排除掉多少个 lampVol 命中
    /* 前提断言用：场景里此刻真的挂着几个可见的 lampVol 网格。
       "没排到"有两种原因 —— ①过滤器坏了；②当时场景里压根没有 lampVol（时刻/档位/机位不同）。
       只有 ① 才算问题，所以断言必须先排掉 ②，否则它会随场景状态乱红（2026-10-13 自检模式实测就是这么红的）。 */
    let lampVolInScene = 0;
    G.scene.traverse(o => { if (o.isMesh && o.name === 'lampVol' && shown(o)) lampVolInScene++; });
    /* 2026-10-13 口径修复（A 为主 + B 按名排除 lampVol）：3.0 只干"滤屋顶/檐口"一件事；
       "哪块是地面"改由离脚最近决定。TOL/gap 公式/check 名与阈值一字未动。 */
    const surfaceAt = (x, z, foot) => {
      rc.set(new T.Vector3(x, 20, z), down); rc.far = 40;
      const cands = [];
      for (const h of rc.intersectObject(G.scene, true)) {
        if (!shown(h.object)) continue;                 // 沿父链查可见性（hidden 的 figure 在此被排除）
        if (h.object.name === 'lampVol') { lampVolSkipped++; continue; }  // B：灯笼体积光球不是可站面
        if (h.point.y < 3.0) cands.push({ y: h.point.y, name: h.object.name || '(无名)', isWater: h.object.name === 'waterSurface' });
      }
      if (!cands.length) return null;
      cands.sort((a, b) => Math.abs(a.y - foot) - Math.abs(b.y - foot));  // A：离脚最近的当作地面
      return cands[0];
    };

    const out = [];
    for (const f of figs) {
      const p = f.getWorldPosition(new T.Vector3());
      const sl = f.userData.slot || {};
      const st = sl.stroll;
      /* 采样点：静态人物就一个点；散步者沿整条区间扫（x 取 a/b，z 取两端之间） */
      const pts = [];
      if (st) {
        const xs = [st.a, st.b].filter((v, i, a) => a.indexOf(v) === i);
        for (const x of xs) for (let i = 0; i <= 12; i++) {
          pts.push([x, st.z0 + (st.z1 - st.z0) * i / 12]);
        }
      } else {
        pts.push([p.x, p.z]);
      }
      const rows = pts.map(([x, z]) => {
        /* 脚底：baseY 是权威值（渲染循环每帧就写它）；散步时另有 ≤0.028 的迈步起伏，
           这里取 baseY，起伏当噪声不予计入（0.028 远小于 TOL）。 */
        /* ⚠️ 接地面高度 = baseY + contactY。站姿人物 contactY 未定义（= 0，脚底即接地面）；
           坐姿人物（对弈二人）的**原点在凳心、正下方就是石凳**，它声明 contactY = 坐面高 0.452
           ⇒ 这条判据对它实际断言的是"**人真的坐在凳面上**"。
           不这么做的话，坐姿会拿 baseY（= 地面高度 0.099）去比它射到的凳面（0.551），
           报一个 gap −0.452 的假红。 */
        const contactY = f.userData.contactY || 0;
        const foot = f.userData.baseY + contactY;
        const s = surfaceAt(x, z, foot);
        return { x: +x.toFixed(2), z: +z.toFixed(2),
                 surf: s ? +s.y.toFixed(3) : null, name: s ? s.name : '—', isWater: !!(s && s.isWater),
                 gap: s ? +(foot - s.y).toFixed(3) : null };
      });
      out.push({ pose: f.userData.poseName || '(无)', skin: f.userData.skin || '(无)',
                 baseY: +f.userData.baseY.toFixed(3), strolling: !!st, rows });
    }
    /* ⚠️ 巡游观鱼者要**沿整条路扫**（2026-10-06 补）：他的 `slot.stroll` 是 null（位置由
       driveWalkers 沿 WALK_PATH 推），所以上面的循环只量到他**此刻那一个点** ——
       而"过桥头踏跺时陷一下"只在路径的特定几段出现（实测 s=10.5~16.8 的两处踏跺）。
       这里用**产品自己的** `walkPointAt` 取点（口径与 driveWalkers 逐字一致，不在探针里
       另抄一份 lerp —— 抄一份 = 改产品时两边悄悄分家），0.02m 一档扫完一圈。 */
    let walkerScan = null;
    const wk = figs.find(f => f.userData.walk);
    if (wk && A.WALK_PATH && A.walkPointAt){
      const P = A.WALK_PATH, cur = { i: 0 }, rows = [];
      for (let s = 0; s < P.len; s += 0.02){
        const p = A.walkPointAt(s, cur);
        const sf = surfaceAt(p.x, p.z, p.y);
        if (sf) rows.push({ s: +s.toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2),
                            gap: +(p.y - sf.y).toFixed(4), isWater: sf.isWater });
      }
      if (rows.length){
        const worst = rows.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
        walkerScan = { points: P.pts.length, len: +P.len.toFixed(2), n: rows.length,
                       maxAbs: Math.abs(worst.gap), worst,
                       maxSink: Math.min(...rows.map(r => r.gap)),      // 最深的"陷进去"
                       /* ⚠️ 关键量是**里程**（=持续时间）而不是峰值：见下面判据的标定说明 */
                       over5Len: +(rows.filter(r => Math.abs(r.gap) > 0.05).length * 0.02).toFixed(3),
                       water: rows.filter(r => r.isWater).length };
      }
    }
    figs.forEach((f, i) => { f.visible = was[i]; });
    return { figs: out, walkerScan, lampVolSkipped, lampVolInScene, volOn: SC.ACTIVE_QUALITY.volume };
  }, SELFTEST);

  check(`点景人物数量 = ${EXPECT_FIGS}（先生 + 2 书童 + 夜步 + 对弈二人 + 看烟花的一家 5 + 观鱼人 + 仕女 + 马夫）`,
    data.figs.length === EXPECT_FIGS, `实测 ${data.figs.length} 个：${data.figs.map(d => d.pose).join('、')}`);

  let worstGap = 0, worstWhere = '', waterHits = [];
  for (const d of data.figs) {
    for (const r of d.rows) {
      if (r.isWater) waterHits.push(`${d.pose}@z=${r.z}`);
      if (r.gap !== null && Math.abs(r.gap) > Math.abs(worstGap)) { worstGap = r.gap; worstWhere = `${d.pose}@(${r.x},${r.z})`; }
    }
  }
  check('人物脚下都不是水面（没有人走在池面上）', waterHits.length === 0,
    waterHits.length ? `${waterHits.length} 处：${waterHits.slice(0, 4).join('、')}` : '0 处');
  check(`人物脚底贴着脚下的面（|脚底 − 面| ≤ ${TOL}，含散步全程扫描）`,
    Math.abs(worstGap) <= TOL, `最差 ${worstGap} @ ${worstWhere || '—'}`);
  /* 前提断言（2026-10-13 口径修复配套）：lampVol 按名排除必须真实生效过，否则过滤器静默失效无人知。
     volume:false 档下光团根本不挂，豁免；volume:true 档下排除数必须 >0。阈值与产品判据无关。 */
  /* ⚠️ 自检模式下这条前提不适用：自检把人物全部下陷到 baseY=0，射线的落点集合随之改变
     （实测正常跑排除 4 次、自检跑排除 0 次，而场景里两次都挂着 5 个可见 lampVol）
     ⇒ 在自检里要求"必须排到过"会引入一条与注入缺陷无关的红，把"有牙"的证据搅浑。
     它守的是**正常测量路径**，所以只在非自检模式判定。 */
  check('前提：lampVol 按名排除真实生效（场景里有 lampVol 时，排除次数必须 >0）',
    SELFTEST || (data.lampVolInScene || 0) === 0 || (data.lampVolSkipped || 0) > 0,
    `场景内可见 lampVol ${(data.lampVolInScene || 0)} 个 · 本轮排除 ${(data.lampVolSkipped || 0)} 次 · volume=${data.volOn}`
    + `（场景内为 0 ⇒ 该条件下不适用；自检模式 ⇒ 人物被下陷、射线落点改变，不适用）`);
  /* ── 巡游观鱼者：沿整条闭合路径扫描（2026-10-06 新增）─────────────────────
     标定（修复前 → 修复后，0.02m 一档复算产品自己的 walkPointAt，outputs/_diag/walk-step-check.mjs）：
       · **最大下陷 −0.161 → −0.019**（"脚陷进石板里"就是老黄说的"过桥头时陷一下"）；
       · |偏差| > 5cm 的**路程 0.62m → 0.04m**（0.62m ≈ 0.86s 的持续时间 ⇒ 肉眼看得出来；
         0.04m ≈ 0.06s ⇒ 就是一"步"落下去）。
     ⚠️⚠️ 判据必须量**里程/持续时间**，不能只量峰值：桥头是四级 0.2m 的踏跺，而**任何**线性
     插值跨坎时瞬时偏差都在 Δy/2 左右（实测修后仍有 0.070m 的一瞬）—— 峰值这条抓不出
     真正的观感缺陷（0.86s 的持续下陷），量里程才抓得出（同"鱼倒游要量连续时长、不数单帧翻转"
     那条）。所以这里不写"最大偏差 ≤ 0.05"，而是"下陷 ≤ 0.03 + >5cm 的路程 ≤ 0.15m"。 */
  if (data.walkerScan) {
    const w = data.walkerScan;
    console.log(`     · 巡游观鱼者全程扫描：路径 ${w.points} 点 / ${w.len}m，复算 ${w.n} 档`
      + `（最大外浮 ${w.maxAbs.toFixed(3)} @ (${w.worst.x},${w.worst.z}) s=${w.worst.s}`
      + `，最大下陷 ${w.maxSink.toFixed(3)}，>5cm 里程 ${w.over5Len}m）`);
    check('巡游观鱼者沿全程：脚不会陷进石头（最大下陷 ≤ 0.03m；修复前 −0.161m）',
      w.maxSink >= -0.03, `最大下陷 ${w.maxSink.toFixed(3)}m · 最大外浮 ${w.maxAbs.toFixed(3)}m`);
    check('巡游观鱼者：偏差 >5cm 的路程 ≤ 0.15m（修复前 0.62m ≈ 0.86s 的"陷进去"）',
      w.over5Len <= 0.15, `${w.over5Len}m / 全程 ${w.len}m`);
    check('巡游观鱼者全程不踩水面', w.water === 0, `${w.water} 档命中 waterSurface`);
  } else {
    check('找到巡游观鱼者并扫完全程（userData.walk + 产品的 walkPointAt）', false,
      '没扫到 ⇒ 上面的"没越界"只是没量过');
  }
  for (const d of data.figs) {
    const gs = d.rows.map(r => r.gap).filter(g => g !== null);
    const mn = gs.length ? Math.min(...gs) : NaN, mx = gs.length ? Math.max(...gs) : NaN;
    console.log(`     · ${d.pose.padEnd(8)} y=${String(d.baseY).padStart(6)} ${d.strolling ? '散步' : '静止'}`
      + `  采样 ${d.rows.length} 点  gap ∈ [${mn}, ${mx}]`);
  }
  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[figure-foot-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s${SELFTEST ? '（自检模式：期望 FAIL）' : ''}`);
  if (SELFTEST) { console.log('自检结论：' + (failed.length ? '✓ 有牙（缺陷态被报出）' : '✗ 无牙 —— 缺陷态没被报出')); process.exit(failed.length ? 0 : 3); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[figure-foot-guard] 崩溃:', e); process.exit(2); });
