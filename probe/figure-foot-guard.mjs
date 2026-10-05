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
//   ① 对每个点景人物，从 y=20 向下打射线，取**第一个 y<3.0 的命中**当"脚下那个面"
//      （3.0 是为了跳过屋顶/檐口 —— 水榭/游廊的人头上都有顶）；
//   ② 散步的人**沿整条散步区间扫描**（逐点把 position 摆过去再量：同一个 evaluate 任务内
//      渲染循环跑不到，所以摆位是有效的），不能只量起点 —— 起点对不代表全程对；
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
const EXPECT_FIGS = 13;                     // 先生 + 2 书童 + 品茗 + 夜步 + 对弈二人 + 抚琴（坐姿 3）
                                            // + 看烟花的一家 5（2 大人 + 3 孩童，2026-10-05 春节烟花配套）

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

  const data = await page.evaluate((selftest) => {
    const G = window.__garden, T = G.THREE;
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
    const surfaceAt = (x, z) => {
      rc.set(new T.Vector3(x, 20, z), down); rc.far = 40;
      for (const h of rc.intersectObject(G.scene, true)) {
        if (!shown(h.object)) continue;                 // 沿父链查可见性（hidden 的 figure 在此被排除）
        if (h.point.y < 3.0) return { y: h.point.y, name: h.object.name || '(无名)', isWater: h.object.name === 'waterSurface' };
      }
      return null;
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
        const s = surfaceAt(x, z);
        /* 脚底：baseY 是权威值（渲染循环每帧就写它）；散步时另有 ≤0.028 的迈步起伏，
           这里取 baseY，起伏当噪声不予计入（0.028 远小于 TOL）。 */
        /* ⚠️ 接地面高度 = baseY + contactY。站姿人物 contactY 未定义（= 0，脚底即接地面）；
           坐姿人物（对弈二人）的**原点在凳心、正下方就是石凳**，它声明 contactY = 坐面高 0.452
           ⇒ 这条判据对它实际断言的是"**人真的坐在凳面上**"。
           不这么做的话，坐姿会拿 baseY（= 地面高度 0.099）去比它射到的凳面（0.551），
           报一个 gap −0.452 的假红。 */
        const contactY = f.userData.contactY || 0;
        const foot = f.userData.baseY + contactY;
        return { x: +x.toFixed(2), z: +z.toFixed(2),
                 surf: s ? +s.y.toFixed(3) : null, name: s ? s.name : '—', isWater: !!(s && s.isWater),
                 gap: s ? +(foot - s.y).toFixed(3) : null };
      });
      out.push({ pose: f.userData.poseName || '(无)', skin: f.userData.skin || '(无)',
                 baseY: +f.userData.baseY.toFixed(3), strolling: !!st, rows });
    }
    figs.forEach((f, i) => { f.visible = was[i]; });
    return out;
  }, SELFTEST);

  check(`点景人物数量 = ${EXPECT_FIGS}（先生 + 2 书童 + 品茗 + 夜步 + 对弈二人 + 抚琴 + 看烟花的一家 5）`,
    data.length === EXPECT_FIGS, `实测 ${data.length} 个：${data.map(d => d.pose).join('、')}`);

  let worstGap = 0, worstWhere = '', waterHits = [];
  for (const d of data) {
    for (const r of d.rows) {
      if (r.isWater) waterHits.push(`${d.pose}@z=${r.z}`);
      if (r.gap !== null && Math.abs(r.gap) > Math.abs(worstGap)) { worstGap = r.gap; worstWhere = `${d.pose}@(${r.x},${r.z})`; }
    }
  }
  check('人物脚下都不是水面（没有人走在池面上）', waterHits.length === 0,
    waterHits.length ? `${waterHits.length} 处：${waterHits.slice(0, 4).join('、')}` : '0 处');
  check(`人物脚底贴着脚下的面（|脚底 − 面| ≤ ${TOL}，含散步全程扫描）`,
    Math.abs(worstGap) <= TOL, `最差 ${worstGap} @ ${worstWhere || '—'}`);
  for (const d of data) {
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
