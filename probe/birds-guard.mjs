// 一次性诊断（不入库）：大雁迁徙 + 鲜艳小鸟的常驻判据
// ① 季节：春/秋 13 只可见、夏/冬 0（老黄："春天和秋天增加大雁迁徙的场景"）
// ② 阵型：飞行中真的会切换，且两种阵型都出现过（老黄："变换阵型（人字和八字）"）
// ③ 大雁在高空（24~31m）且成队（不是散飞）
// ④ 小鸟：石上组必须**停在实测石面上**（不能悬空）、草上组必须在**跳跃**（位置随帧变化）
// ⑤ 小鸟颜色是亮色（线性分量足够大，不能是灰）
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
     本门随之翻回"守行为"：
       (a) 季节显隐 64 组合全扫（4 季 × 4 天气 × 4 时段）：春/秋全 13 只可见、
           夏/冬 0 —— 曾经只测单一天气+单一时段，"某个组合漏了"从缝里漏过去
           （2026-10-01 的教训：扫全表 + 扫完必须复位）；
       (b) 两种阵型真的都出现、且形状不同（人字横向宽、八字 S 纵向长）；
       (c) 航线在园子上空的高度带/半径带内（10~13m / 半径 26±呼吸）。 */
  {
    const SE = ['spring', 'summer', 'autumn', 'winter'];
    const WE = ['clear', 'mist', 'storm', 'afterrain'];
    const TI = ['morning', 'noon', 'dusk', 'night'];
    const bad = [];
    for (const ss of SE){
      for (const ww of WE){
        for (const tt of TI){
          await page.evaluate(([a, b, c]) => {
            const G = window.__garden;
            G.setEnv('season', a); G.setEnv('weather', b); G.setEnv('time', c);
          }, [ss, ww, tt]);
          await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 }).catch(() => {});
          await page.waitForTimeout(120);
          const st = await page.evaluate(() => {
            const G = window.__garden;
            return { total: G.geese.length, vis: G.geese.filter(g => g.visible).length };
          });
          const wantVis = (ss === 'spring' || ss === 'autumn') ? 13 : 0;
          if (st.total !== 13 || st.vis !== wantVis)
            bad.push(`${ss}/${ww}/${tt}: ${st.vis}/${st.total} 只（期望 ${wantVis}/13）`);
        }
      }
    }
    check('大雁：装配 13 只，春/秋 64 组合全可见、夏/冬全隐藏',
      bad.length === 0,
      bad.length ? `${bad.length} 个异常：${bad.slice(0, 6).join('，')}` : '64 组合全部符合');
    /* 复位环境（扫完必须复位，否则污染后面的判据——2026-10-01 的教训） */
    await page.evaluate(() => {
      const G = window.__garden;
      G.setEnv('season', 'spring'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon');
    });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  /* (b)(c)(d) 阵型/航线/入画。
     ⚠️⚠️ (b) 阵型形状**量槽位（slot）**：槽位是数据层"阵型是什么"（人字两臂横向
     张开 / S 纵向拖长），实际位置受跟随滞后影响、换阵过渡期更乱，定形状看槽位。
     —— 2026-10-02 更正：此处早先写过"绕圈把横距压扁到 26%"，**是误诊** ——
     那是把 S 形的横向 3.6m 对比人字槽位 13.8m（两形横向本来就不同）。复测
     稳态人字横向 13.35m ≈ 设计 13.8m，横向上没压扁；真问题只有**整队拖尾**
     （一阶缓动追 3m/s 前移目标，稳态恒落后 v×τ=4.8m ⇒ maxR 13.4m > 设计 9.8m），
     已在 08-assemble 用"速度前置 lead"修掉（槽位目标沿航向前移 v·τ，maxR 回 9.8m）。
     —— 跟随判据（量实际位置）：每帧 maxR = 全队相对头雁的最大散布。
       上限 12（lead 修复后稳态 ~9.8m，留 18% 余量；真散飞是 20m+ 且高方差），
       下限 2.5（全队叠成一团 = 缓动/slot 系统坏）。
       ⚠️ **换阵后 3s 过渡窗跳过**（全队重排是正确行为，过渡期散布天然超稳态，
       不跳会间歇红）。⚠️ 别量"离槽位世界目标的距离"（目标本身前移、滞后已被
       产品 lead 项补偿，量它会回归假红）。⚠️ 别逐雁设下限 —— 头雁天然在散布
       中心（R=0），逐雁下限会把它判越界。槽位是 userData.slot 的局部坐标。 */
  {
    const forms = {};
    let altBad = 0, radBad = 0, hBad = 0, inView = 0, followBad = 0, followN = 0, frameMax = 0;
    let fMaxMin = 1e9, fMaxMax = 0, prevForm = null, switchAt = 0, skipN = 0;
    for (let k = 0; k < 200 && Object.keys(forms).length < 2; k++){
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
                   y: g.position.y, r: Math.hypot(head.x, head.z - 3) };
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
          if (p.y < 9 || p.y > 14.5) hBad++;
          if (p.r < 20 || p.r > 31) radBad++;
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
      followN > 0 && followBad === 0,
      `越界 ${followBad}/${followN} 帧 · 每帧 maxR 实测 ${fMaxMin.toFixed(2)}~${fMaxMax.toFixed(2)}m · 换阵过渡跳过 ${skipN} 帧`);
    check('大雁：全队高度在园子上空带内（9~14.5m），绕园半径 20~31m',
      hBad === 0 && radBad === 0,
      `高度越界 ${hBad} 次 · 半径越界 ${radBad} 次`);
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
    return { count: im.count, rock, grass, cols, nan: nanWorst,
             stateNan, preenSeen, preenMax: +preenMax.toFixed(2) };
  });

  /* ⚠️ 数量 2026-10-01 按老黄要求改：石上 5 → **3**（"做两三只停在最高的假山上"），
     草上仍是 6。总数 11 → 9。 */
  check('小鸟：总数 = 石上 3 + 草上 6', birds.count === 9, `${birds.count} 只`);
  /* ⚠️ 新增（老黄："停在**最高的假山**上"）：三只必须都在**同一处**假山、
     且高度明显高于另一处（实测东假山最高 5.09m、西假山 4.08m）。
     量法：取三只石上鸟的 y，要求极差 ≤1.2m（同一座山）且最低那只 >2.5m（山顶量级）。 */
  {
    const ys = birds.rock.map(r => r.y).sort((a, b) => a - b);
    const spread = ys.length ? +(ys[ys.length - 1] - ys[0]).toFixed(2) : 99;
    check('小鸟（石上）：两三只都在**最高的假山**顶上（高度极差 ≤1.2m、最低 >2.5m）',
      birds.rock.length === 3 && spread <= 1.2 && ys[0] > 2.5,
      `高度 ${ys.join(' / ')}m（极差 ${spread}m）`);
  }
  const rockBad = birds.rock.filter(r => r.gap === null || r.gap < -0.05 || r.gap > 0.45);
  check('小鸟（石上）：站在石面上（脚底与石面差 0.45m 内，不悬空不陷进去）',
    rockBad.length === 0,
    rockBad.length ? `越界 ${rockBad.map(r => `#${r.i} gap=${r.gap}`).join(', ')}`
                   : birds.rock.map(r => `#${r.i} 高${r.y}/石面${r.ground}`).join(' '));
  /* ⚠️ 2026-10-01 反转：老黄"这些鸟都是不动的……这个鸟反而不能'灵动'起来？"
      —— 而这条判据当时写的恰恰是"**在休息**（20 秒累计位移 <0.4m）"，
      **强制了静止**。石上的鸟现在会踱步/转头/抖翅，20 秒累计位移应 >0.4m。 */
  const rockStill = birds.rock.every(r => r.path < 0.4);
  check('小鸟（石上）：虽在休息但**有持续小动作**（20 秒累计位移 ≥0.25m，不读作静止）',
    !rockStill || birds.rock.filter(r => r.path >= 0.25).length >= birds.rock.length - 1,
    `路径 ${birds.rock.map(r => r.path).join(', ')}m`);
  /* ⚠️ 门槛用"多数"而不是写死只数：2026-10-01 石上从 5 改 3 之后，
     草上仍是 6 只，但索引分类曾经错位导致"4/4 只"这种读数 ——
     写死 `>= 5` 会在只数变化时误报。改成"至少 4 只且过半"。 */
  const grassHop = birds.grass.filter(g => g.path > 1.5);
  check('小鸟（草上）：在跳跃捕食（20 秒累计路径 >1.5m）',
    grassHop.length >= 4 && grassHop.length * 2 >= birds.grass.length,
    `${grassHop.length}/${birds.grass.length} 只，路径 ${birds.grass.map(g => g.path).join(', ')}m`);
  const grassSwing = birds.grass.filter(g => g.ySwing > 0.06);
  check('小鸟（草上）：跳跃是抛物线（高度有起伏，不是平移滑行）',
    grassSwing.length >= 4 && grassSwing.length * 2 >= birds.grass.length,
    `起伏 ${birds.grass.map(g => g.ySwing).join(', ')}m`);
  /* ⚠️⚠️ **判据方向反转**（2026-10-01）：老黄明确否掉了原判据 ——
      "颜色不对，自然界很难找到这种纯色的鸟"。而这条判据当时写的是
      **饱和度 ≥0.9**、"不是灰扑扑"，实测 11 只饱和度 0.98~1.00 全"达标"
      —— 它**正在强制那个缺陷**。纯色上限就是 1.0，0.9 以上等于纯色。
      真实鸟羽的饱和度大致 0.15~0.65（橄榄褐、黄绿、石青蓝、栗棕），
      靠**分区**（背/腹/头/翼）而不是"整体纯色"才鲜艳。
      现在改成**双侧**判据：既不许灰（饱和度 ≥0.15），也不许纯色（≤0.65）。
      ⚠️ 教训与 09-28 那条同源：**判据会把产品当时的样子固化成"标准"**，
         用户提出反面意见时要先回头看这条判据是不是在强制缺陷。 */
  const satOf = c => { const mx = Math.max(...c), mn = Math.min(...c); return mx > 0 ? (mx - mn) / mx : 0; };
  const sats = birds.cols.map(satOf);
  const natural = birds.cols.filter(c => satOf(c) >= 0.15 && satOf(c) <= 0.65).length;
  check('小鸟：羽色自然（饱和度 0.15~0.65：既不灰、也不是纯色塑料鸟）',
    natural >= birds.cols.length - 1,
    `${natural}/${birds.cols.length} 只达标，饱和度 ${sats.map(s => s.toFixed(2)).join(',')}`);

  check('小鸟：实例矩阵无 NaN（姿态整体不能被算坏）', birds.nan === 0,
    birds.nan ? `窗口内最多 ${birds.nan} 个非有限元素` : '20 秒窗口内全程有限');
  /* ⚠️ 这条才是有牙的那条（见上方注释：`|| 0` 会掩盖 NaN，矩阵/位移/颜色都抓不到）。
     老黄点名要的三个动作之一"转头啄毛"，其可测量形态就是
     **低头期间头部朝身侧偏 ≥0.5rad**；typo 版本这条恒为 0。
     负例对照：把 `b.preen` 改回 `b.peen` ⇒ stateNan>0 且 preenMax=0 ⇒ 必红。 */
  check('小鸟（石上）：理羽动作真的发生（低头期间侧偏 ≥0.5rad，状态无 NaN）',
    birds.stateNan === 0 && birds.preenSeen > 0 && birds.preenMax >= 0.5,
    `状态 NaN ${birds.stateNan} 处 · 理羽采样 ${birds.preenSeen} 次 · 最大侧偏 ${birds.preenMax}rad`);

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
