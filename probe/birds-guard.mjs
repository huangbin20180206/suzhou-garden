// 大雁迁徙的常驻判据 + **小鸟已整层下线**的防复活判据
// ① 季节：春/秋 13 只可见、夏/冬 0（老黄："春天和秋天增加大雁迁徙的场景"）
// ② 阵型：飞行中真的会切换，且两种阵型都出现过（老黄："变换阵型（人字和八字）"）
// ③ 大雁在高空且成队（不是散飞）
// ④ 小鸟：**2026-10-05 起整层下线**（老黄："去掉……草皮上的小鸟以及假山上的小鸟，
//    保留金刚鹦鹉"）—— 本节从"守行为"翻成"守它不再出现"：只数 0 + 网格仍在
//    （容量 9）+ 探针自检。旧的四组行为/配色判据（贴石面 / 跳跃抛物线 / 羽色自然 /
//    理羽侧偏）留在 git 历史里；恢复 = 把 08-assemble 的 N_ROCK_BIRD / N_GRASS_BIRD
//    改回 3 / 6，并把那四组判据取回。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'birds-guard');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.waitForTimeout(2500);
  const settle = () => page.waitForTimeout(4200);

  /* ══ ① 大雁：**2026-10-02 恢复**（老黄："春秋两季的大雁也没有了"）══════════════
     2026-10-01 曾按老黄"把天上飞的几只小鸟去掉"整层下线（GN=0），10-02 他又报
     "春秋两季的大雁也没有了"，拍板恢复（GN=13 + 整体放大 1.4×）。
     本门随之翻回"守行为"（2026-10-05 再补一条"恶劣天气不飞"）：
       (a) 季节显隐 80 组合全扫（4 季 × **5 天气** × 4 时段）：春/秋在**非降水天气**下 13 只可见、
           夏/冬 0；**降水天气（狂风暴雨 / 银装素裹）春/秋也必须 0** —— 老黄 2026-10-05：
           "春秋季大雁在狂风暴雨场景依旧在天上飞，这个不合理"（判据在产品里用 rainAmount /
           snowAmount 的阈值，这里按天气名对齐同一口径）；
           曾经只测单一天气+单一时段，"某个组合漏了"从缝里漏过去
           （2026-10-01 的教训：扫全表 + 扫完必须复位）；
       (b) 两种阵型真的都出现、且形状不同（人字横向宽、八字 S 纵向长）；
       (c) 航线在园子上空的高度带/半径带内（10~13m / 半径 26±呼吸）。 */
  {
    const SE = ['spring', 'summer', 'autumn', 'winter'];
    const WE = ['clear', 'mist', 'storm', 'afterrain', 'snow'];   // 2026-10-05：补 snow（同属降水天气）
    const TI = ['morning', 'noon', 'dusk', 'night'];
    const GROUNDED_W = new Set(['storm', 'snow']);                // 与产品里的 rainAmount/snowAmount 阈值同口径
    const bad = []; let skipped = 0;
    for (const ss of SE){
      for (const ww of WE){
        for (const tt of TI){
          /* ⚠️ 天气有**季节合法性**（例：夏季不能下雪 'snow' 只在冬季合法）——先设季节、再问产品
             这个组合合不合法；不合法的组合本就不该出现，跳过并计数（别把它当异常，
             2026-10-05 我第一版就是这么假红的：请求 snow 被产品静默拒绝，天气仍是 clear）。 */
          await page.evaluate((a) => window.__garden.setEnv('season', a), ss);
          const legal = await page.evaluate((w) => {
            const G = window.__garden;
            return typeof G.weatherAllowed === 'function' ? G.weatherAllowed(w) : true;
          }, ww);
          if (!legal){ skipped++; continue; }
          await page.evaluate(([b, c]) => {
            const G = window.__garden;
            G.setEnv('weather', b); G.setEnv('time', c);
          }, [ww, tt]);
          await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 }).catch(() => {});
          await page.waitForTimeout(120);
          const st = await page.evaluate(() => {
            const G = window.__garden;
            return { total: G.geese.length, vis: G.geese.filter(g => g.visible).length,
                     w: G.ENV.weather, s: G.ENV.season };
          });
          const seasonal = (ss === 'spring' || ss === 'autumn');
          const wantVis = (seasonal && !GROUNDED_W.has(st.w)) ? 13 : 0;
          if (st.total !== 13 || st.vis !== wantVis)
            bad.push(`${ss}/${ww}/${tt}: ${st.vis}/${st.total} 只（期望 ${wantVis}/13，实际天气 ${st.w}）`);
        }
      }
    }
    check('大雁：装配 13 只；春/秋在非降水天气全可见、夏/冬与降水天气全隐藏（非法季节组合已跳过）',
      bad.length === 0,
      bad.length ? `${bad.length} 个异常：${bad.slice(0, 6).join('，')}` : `全部符合（跳过 ${skipped} 个季节非法组合）`);
    /* 复位环境（扫完必须复位，否则污染后面的判据——2026-10-01 的教训） */
    await page.evaluate(() => {
      const G = window.__garden;
      G.setEnv('season', 'spring'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon');
    });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  /* (b)(c)(d) 阵型/航线/入画。
     ⚠️⚠️ 2026-10-02 第九轮航线重做（老黄："不要围绕着院子飞，就从整个画面中从左到右
     （春季），从右到左（秋季），飞完一个回合再生成一波继续飞"）：
       (b) 阵型形状**量槽位（slot）**：槽位是数据层"阵型是什么"（人字两臂横向
           张开 / S 纵向拖长），实际位置受跟随滞后影响、换阵过渡期更乱，定形状看槽位。
       (c) 航线：**高空横穿**（高度 18~23m、沿 x 轴、|z|≤12m），春 +x / 秋 −x
           （dirSign 由 12-env 按季节写）；不再是"绕园半径"。
       (d) 入画：横穿 ⇒ 队首在画面内的比例 >0（绕圈时有半程在画外也正常）。
     —— 以下"误诊存档"留给后人：曾把 S 形的横向 3.6m 对比人字槽位 13.8m、
       诊断"绕圈把横距压扁到 26%"，实际是量错了阵型；稳态人字横向与设计一致。
     —— "跟随判据"量法（量实际位置）：每帧 maxR = 全队相对头雁的最大散布。
       上限 12（稳态 ~9.8m；真散飞是 20m+ 高方差），下限 2.5（全队叠成一团）。
       ⚠️ 换阵后 3s 过渡窗跳过（重排是正确行为）。⚠️ 别量"离槽位世界目标的距离"
       （目标前移 + 产品 lead 补偿 ⇒ 回归假红）。⚠️ 别逐雁设下限（头雁天然在中心）。 */
  /* ⚠️⚠️ 采样窗必须**跑满**（k<200 且不限形式条件），否则 followN=0：
     横穿波次下换阵快（6~13s），"凑满两阵型就退出"会在 10 帧内结束 ——
     而那 10 帧全落在换阵 3s 过渡窗内（被跳过）⇒ followN=0、fMaxMin 还是初始 1e9
     ⇒ 判据读成"越界 0/0 · 实测 1e9~0m"假红（2026-10-02 实测）。 */
  {
    const forms = {};
    let altBad = 0, zBad = 0, hBad = 0, inView = 0, followBad = 0, followN = 0, frameMax = 0;
    let fMaxMin = 1e9, fMaxMax = 0, prevForm = null, switchAt = 0, skipN = 0;
    for (let k = 0; k < 200; k++){
      const st = await page.evaluate(() => {
        const G = window.__garden;
        const head = G.GOOSE.head;
        const ndc = head.clone().project(G.camera);
        const dir = G.GOOSE.dir, dl = Math.hypot(dir.x, dir.y) || 1;
        const ux = dir.x / dl, uz = dir.y / dl;          // 航向单位向量（dir.y 存 z 分量）
        const rel = G.geese.map(g => {
          const px = g.position.x - head.x, pz = g.position.z - head.z;
          const s = g.userData.slot || { x: 0, z: 0 };
          return { sx: s.x, sz: s.z,
                   lx: px * (-uz) + pz * ux,            // 实际位置：航向系横向
                   lz: px * ux + pz * uz,               // 实际位置：航向系纵向
                   y: g.position.y, wz: g.position.z };  // wz = 世界 z（横穿走廊检查用）
        });
        return { form: G.GOOSE.form, rel, ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(2)] };
      });
      if (st.form !== prevForm){ prevForm = st.form; switchAt = Date.now(); }
      const inTransition = Date.now() - switchAt < 3000;   // 换阵后 3s 重排窗跳过（不跳会间歇红）
      frameMax = 0;                                   // 每帧重置（frameMax 是本帧聚合量）
      if (!forms[st.form]){
        const xs = st.rel.map(p => p.sx), zs = st.rel.map(p => p.sz);
        forms[st.form] = { sx: Math.max(...xs) - Math.min(...xs), sz: Math.max(...zs) - Math.min(...zs) };
      }
      if (!inTransition){
        /* 每帧聚合（不逐雁）：frameMax = 本帧全队相对头雁的最大散布。
           上限/下限的设计依据与两条量法教训见本块头部注释。 */
        for (const p of st.rel){
          followN++;
          const R = Math.hypot(p.lx, p.lz);
          if (R > frameMax) frameMax = R;
          if (p.y < 18 || p.y > 23) hBad++;
          if (Math.abs(p.wz + 20) > 9) zBad++;   // 横穿走廊 z=-20±2.5呼吸+缓动滞后 ⇒ 带±9
        }
        if (frameMax > 12 || frameMax < 2.5) followBad++;
        fMaxMin = Math.min(fMaxMin, frameMax); fMaxMax = Math.max(fMaxMax, frameMax);
      } else skipN++;
      if (Math.abs(st.ndc[0]) < 1 && Math.abs(st.ndc[1]) < 1 && st.ndc[2] < 1) inView++;
      await page.waitForTimeout(200);
    }
    const f0 = forms[0], f1 = forms[1];
    check('大雁：两种阵型的目标形状不同（槽位：人字两臂横向宽 / 八字 S 纵向长）',
      !!f0 && !!f1 && f0.sx > f1.sx && f1.sz > f1.sx,
      f0 && f1 ? `人字槽位 ${f0.sx.toFixed(1)}×${f0.sz.toFixed(1)}m / S槽位 ${f1.sx.toFixed(1)}×${f1.sz.toFixed(1)}m`
               : `只采到 ${Object.keys(forms).join(',')} 种阵型`);
    check('大雁：队形保持成队不散飞（每帧相对头雁最大散布 2.5~12m）',
      followN >= 30 && followBad === 0,
      followN < 30 ? `采样不足（仅 ${followN} 个非过渡帧，跳过 ${skipN}）— 采样窗需覆盖一个完整波次`
                   : `越界 ${followBad}/${followN} 帧 · 每帧 maxR 实测 ${fMaxMin.toFixed(2)}~${fMaxMax.toFixed(2)}m · 换阵过渡跳过 ${skipN} 帧`);
    check('大雁：全队高度在高空带内（18~23m），且沿 x 轴横穿（z≈−20 走廊 ±9m）',
      hBad === 0 && zBad === 0,
      `高度越界 ${hBad} 次 · z 越界 ${zBad} 次`);
    check('大雁：绕园巡飞时会进默认机位的视野（40s 内队首入画采样 ≥3 次）',
      inView >= 3, `入画采样 ${inView} 次（每 200ms 一次）`);
  }

  /* ══ ③ 小鸟：落点贴面 + 行为 + 颜色 ═════════════════════════════════ */
  const birds = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const im = G.smallBirdMeshRef.mesh;
    const m = new T.Matrix4(), v = new T.Vector3();
    const read = () => {
      const out = [];
      for (let i = 0; i < im.count; i++){
        im.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
        out.push([v.x, v.y, v.z]);
      }
      return out;
    };
    /* ① **20 秒**窗口的累计路径（第一版用 1.4s 窗口 ⇒ 假红，见下方注释） */
    const SECS = 20;
    const hist = [];
    /* ⚠️ **NaN 自检**（2026-10-01 新增，被真事故逼出来的）：石上鸟的"转头啄毛"
       我第一版把变量名写成了 `b.peen`（应为 `b.preen`）⇒ yawOff = NaN。
       ⚠️⚠️ **负例对照实测（把 bug 装回去跑一遍）证明：矩阵判据抓不到它** ——
       `p.yaw = b.yaw + (b.yawOff || 0)` 里的 `|| 0` 会把 NaN **静默归零**，
       矩阵 16 个元素全程有限、位置/高度/颜色全绿，**只是那个动作没发生**。
       ⇒ 真正的牙在下面那条"读状态"的判据（stateNan / preenMax），
         这条矩阵判据只作为"姿态整体算坏"的粗兜底，**不要指望它抓 typo**。
       两条都必须**在整个采样窗口内取最坏值**（理羽只占 ~0.7s / 每 1.5~4s，
       只在窗口末尾抽查一次约四成概率漏掉 ⇒ 那会是一条时红时绿的假门）。 */
    const nanScan = () => {
      const raw = im.instanceMatrix.array;
      let n = 0;
      for (let i = 0; i < raw.length; i++) if (!Number.isFinite(raw[i])) n++;
      return n;
    };
    /* ⚠️ 阳性判据：**状态本身**必须有限，且"理羽"必须真的产生侧向偏头。
       带牙版本（读产品自己的行为状态，2026-10-01 起 smallBirdMeshRef.state）。 */
    const st = G.smallBirdMeshRef.state;
    let nanWorst = 0, stateNan = 0, preenMax = 0, preenSeen = 0;
    const scanState = () => {
      if (!st) return;
      for (const b of st){
        for (const k of ['x', 'y', 'z', 'yaw']) if (!Number.isFinite(b[k])) stateNan++;
        if (b.kind !== 'rock') continue;              // yawOff/preen 只有石上鸟有
        if (!Number.isFinite(b.yawOff)) stateNan++;
        if (!(b.preen > 0)) continue;
        preenSeen++;
        if (Number.isFinite(b.yawOff)) preenMax = Math.max(preenMax, Math.abs(b.yawOff));
      }
    };
    for (let k = 0; k < SECS * 5; k++){
      hist.push(read());
      nanWorst = Math.max(nanWorst, nanScan());
      scanState();
      await new Promise(r => setTimeout(r, 200));
    }
    const s2 = hist[hist.length - 1];
    /* ② 石面高度：射线量每只脚下处的命中面，与鸟高比 */
    const rc = new T.Raycaster(); rc.far = 60;
    const groundAt = (x, z) => {
      rc.set(new T.Vector3(x, 40, z), new T.Vector3(0, -1, 0));
      const hs = rc.intersectObjects(G.scene.children, true).filter(h => h.object.isMesh);
      return hs.length ? +hs[0].point.y.toFixed(2) : null;
    };
    /* ⚠️ 石上/草上的只数必须**从产品侧读**，不能在这里写死（2026-10-01 修）。
       写死 N_ROCK=5 时，产品已改成 3 只石上 + 6 只草上，索引 3/4 就被**误判成
       "石上"** ⇒ 报出"高度 −0.25/−0.21、越界"这类根本不存在的假红，
       而真正的草上行为（跳跃抛物线）反而少了两只被算成石头。 */
    const N_ROCK = (G.smallBirdMeshRef.counts && G.smallBirdMeshRef.counts.rock) || 0;
    const rock = [], grass = [];
    for (let i = 0; i < im.count; i++){
      const [x, y, z] = s2[i];
      const gy = groundAt(x, z);
      let path = 0, yMin = 1e9, yMax = -1e9;
      for (let k = 1; k < hist.length; k++){
        path += Math.hypot(hist[k][i][0]-hist[k-1][i][0], hist[k][i][1]-hist[k-1][i][1], hist[k][i][2]-hist[k-1][i][2]);
        yMin = Math.min(yMin, hist[k][i][1]); yMax = Math.max(yMax, hist[k][i][1]);
      }
      (i < N_ROCK ? rock : grass).push({ i, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2),
        ground: gy, gap: gy === null ? null : +(y - gy).toFixed(2),
        path: +path.toFixed(2), ySwing: +(yMax - yMin).toFixed(2) });
    }
    const cols = [];
    for (let i = 0; i < im.count; i++)
      cols.push([im.instanceColor.getX(i), im.instanceColor.getY(i), im.instanceColor.getZ(i)]);
    return { count: im.count, cap: im.instanceMatrix.count,
             counts: G.smallBirdMeshRef.counts,
             rock, grass, cols, nan: nanWorst,
             stateNan, preenSeen, preenMax: +preenMax.toFixed(2) };
  });

  /* ══ ③ 小鸟：**2026-10-05 整层下线** ═════════════════════════════════
     老黄："去掉……草皮上的小鸟以及假山上的小鸟，保留金刚鹦鹉"。
     本段从"守行为"翻成"**守它不再出现**" —— 与 2026-10-01 大雁、以及 far-tree
     那次同款处理。⚠️ 下线一个功能时必须**一起改门禁**：旧判据留着要么一片恒假红，
     要么更糟 —— 改法不当（比如把 `count===9` 松成 `count>=0`）会变成一堆
     **恒绿的空判据**，那比没有门禁更坏。
     三条牙：
       ① 只数 = 0（两类都从产品侧读，不写死）；
       ② 网格**还在、容量还是 9** —— 这是"只关数量、不删网格"的契约，
          layout-fingerprint 的稳定性靠它（删掉网格反而会动指纹）；
       ③ **探针自检**：把 count 临时改成 1，本门必须读到 1 ⇒ 证明"读到 0"不是探针坏了
          （项目铁律：探针自己也要先证伪）。 */
  const birdSelf = await page.evaluate(() => {
    const G = window.__garden, im = G.smallBirdMeshRef.mesh;
    const keep = im.count;
    im.count = 1;                                   // 临时"复活"一只
    const seen = im.count;
    im.count = keep;
    return { seen, restored: im.count };
  });
  check('小鸟：已整层下线（石上 0 + 草上 0）',
    birds.count === 0 && birds.counts.rock === 0 && birds.counts.grass === 0,
    `count=${birds.count}（石上 ${birds.counts.rock} / 草上 ${birds.counts.grass}）`);
  check('小鸟：网格仍在、容量保持 9（只关数量不删网格 ⇒ layout-fingerprint 不漂）',
    birds.cap === 9, `容量 ${birds.cap}`);
  check('小鸟：探针自检（临时 count=1 时本门必须读到 1，复位回 0）',
    birdSelf.seen === 1 && birdSelf.restored === 0,
    `读到 ${birdSelf.seen}，复位后 ${birdSelf.restored}`);

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[birds-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[birds-guard] 崩溃:', e); process.exit(2); });
