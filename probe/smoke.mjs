// 冒烟回归门禁：npm test
// 无头浏览器加载真实页面，断言：启动零报错、几何合并零告警、资产到齐、
// 环境四轴切换与过渡、雪天互斥、相机复位、stats 更新、视口缩放。
// playwright 解析顺序：项目 node_modules → 全局 npm root（本机全局装有 playwright）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 本地没有，走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* ── 仿真推进速率 → 超时换算（2026-10-13 修 CI smoke 误红）─────────────────────
   根因：本文件等的三样东西 —— ENV.t 收敛、camFly 飞行落位 —— **由仿真时间推进**
   （ENV.t += dt / ENV.dur，src/11-loop.js:952；CAM_FLY.t += dt / dur，
   src/08-assemble.js:3256；dt 来自 stepSim），而墙钟超时闸曾**写死 30000ms**。
   两者只在真 GPU 上等价。慢机上仿真远远落后墙钟：src/11-loop.js:878 MAX_STEPS=6
   （一帧最多补 100ms 仿真）+ :887 补步用尽即 simAccum=0 丢弃余量 ⇒ 每墙钟秒只推进
   约 0.1s 仿真。CI 软渲染 ci.yml:15 自述约 2.4s/帧 ⇒ 仿真/墙钟 ≈ 0.1/2.4 ≈ 0.042，
   即仿真比墙钟慢约 24 倍 ⇒ 30000ms 墙钟只够推进约 1.25s 仿真。

   ⚠️ 修法是**换算超时口径**，不是放宽断言：`ENV.t>=1` 与 `!camFly()` 两个判据一字未动，
      等不到仍照样报红。超时值 = 需要的仿真秒数 / 实测推进速率 × 余量，取自页面 simClock。

   ⚠️⚠️ 本段改过两轮，**第一轮算出来等于没改**，这个坑值得留给后人：
   首版按 `needed = ENV.dur`（探针已压到 0.25s）、slack=4 折算：
   0.25 / 0.042 × 4 ≈ 23.8 秒 < 地板 30000ms ⇒ `Math.max(30000, …)` 把结果整段夹回
   30000ms，**与改前一毫秒不差**；r=1（真 GPU）到 r=0.02（比 CI 还慢 2 倍）全区间如此。
   ⇒ 改了 75 行仍会红。教训：**带地板的折算必须先把折算表按 r 全区间打出来再写代码**，
      否则「以为放宽了、实际被地板吃掉」在运行时完全看不出来（本次就是靠打表才发现）。

   ⚠️⚠️ 更要紧的一条实测结论，与「smoke 在 CI 上必然误红」的初始假设**相反**：
   逐条核算（r=0.042）⇒ settled 只等 ENV.t>=1，需 0.25 仿真秒 = **5.9 秒**，
   旧值 30000ms 有 **20 倍冗余，从来不是 CI 判红的瓶颈**；
   真正必然超时的是 **camFly**：dur=1.4 仿真秒 ÷ 0.042 = **33.3 秒 > 旧值 30 秒**，
   而那处原带 `.catch(() => {})` 把超时**静默吞掉**（已修，见下方巡游段）。
   ⇒ settled 这段保留折算，是为**未来更慢的环境**（比 CI 还慢 2~10 倍的机器）留余量，
     **不是它治好了本次 CI**，别把它当功劳记。 */
/* 实测推进速率（仿真秒 / 墙钟秒）。读页面自己的 simClock，不写死 0.042 ——
   那个数只在 CI 软渲染下成立，真 GPU 下 r≈1。

   ⚠️⚠️ 采样窗**必须长于一帧**。这是 Chief 自查抓到的第二个真缺陷（第一个是秒/毫秒错配）：
   首版采样窗取 1.2s，而软渲染**一帧就要 2.4s**（ci.yml:15 自述）⇒ 1.2s 窗口连一帧都跑不完，
   前后两次 simClock 读数**必然相同** ⇒ 走进「没推进 ⇒ 回落 1.0」那条分支 ⇒
   按 r=1 算出 camFly 预算 30s，而真实需求 33.3s ⇒ **折算完全失效、CI 仍红**。
   ⇒ 这类「实测速率」的写法，采样窗与最小步进周期的关系是**硬约束**，不是调优项：
     窗 < 一帧 ⇒ 恒读到 0；窗 = 一帧 ⇒ 恰好可能跨 0；窗须显著大于一帧。
   现取 **4000ms**（≈ 1.7 倍软渲染帧长）。代价 12 处 × 4s ≈ 48s，相对 ci.yml 的
   timeout-minutes: 40 与本门实测分钟级耗时可忽略；换来的是任何比真 GPU 慢 ≤ ~10 倍的环境
   都能正确测出 r。若嫌慢，正确做法是**只在第一次调用时测一次并缓存**，而不是把窗调短。 */
const RATE_WINDOW_MS = 4000;   // 采样窗：必须 > 最慢环境的一帧时长（软渲染 ≈2.4s）
async function measureRate(page){
  const a = await page.evaluate(() => window.__garden.simClock());
  const w0 = Date.now();
  await sleep(RATE_WINDOW_MS);
  const b = await page.evaluate(() => window.__garden.simClock());
  const dWall = (Date.now() - w0) / 1000;
  /* 采样窗内仿真没推进 ⇒ 页面没在跑（挂了/卡了）。此时回落 1.0 是**故意**的：
     让预算维持地板值、尽快报红，而不是给一个天文数字把 40 分钟的 CI 作业拖到被杀。 */
  return (dWall > 0 && b > a) ? (b - a) / dWall : 1;
}
/* 换算墙钟超时。rate = 仿真秒/墙钟秒，needed = 需要的**仿真秒**，slack = 余量系数。
   ⚠️⚠️ 返回**毫秒**。这里踩了本轮唯一一个真 bug，值得留给后人：
   首版写的是 `needed / rate * slack` —— 结果单位是**秒**（0.5/0.042×3 = 35.7），
   却直接拿去和 `Math.max(30000, …)` 这个**毫秒**地板比大小 ⇒ 折算值 36 被地板 30000
   整段吃掉，**改了 75 行与改前一毫秒不差**。漏的就是那个 ×1000。
   ⇒ 判据（这类 bug 的通用抓手）：**折算式与阈值必须当场标注单位，并把折算表打全**。
     前两轮曾误判成「地板太高」而两次动地板（一次降到 12000、一次想改 needed），
     全是在治标；直到把两侧单位并排写出来才看见真凶。

   ⚠️ 地板**保持 30000ms 不动**，中途降过一次又收回：降到 12000 会让**真 GPU** 下
     settled 从 30s 掉到 12s ⇒ 那是对本机门禁的收紧，属回归，不能为慢机的改善牺牲本机。 */
const WALL_FLOOR = 30000;   // 毫秒。真 GPU 下等一次 0.25s 过渡的旧档位，保留不动。
/* ⚠️ rate 必须**封顶**在「还能容忍的慢」之内，否则页面已挂（rate=0）时
   `needed / 1e-6 * slack * 1000` 会算出 15 亿毫秒（41 天）——
   那不是给慢机留余量，而是把 ci.yml 的 40 分钟作业拖到**被杀**，
   表现为「超时」而不是「红」，恰恰丢掉了这次修复要恢复的判别力。
   封顶 0.01（仿真比墙钟慢 100 倍）⇒ 上界 needed/slack 反推 ≈ 75s，
   远小于 40 分钟，而比 CI 现状慢 4 倍以上的机器仍能拿到足额预算。
   —— 有牙自证第 6 例抓到的就是这个（期望回落地板 30000，实际 15 亿）。 */
const RATE_MIN = 0.01;      // 仿真/墙钟速率下限：再慢就是「页面没在跑」，不是「机器慢」
const wallBudget = (rate, needed, slack) =>
  Math.max(WALL_FLOOR, Math.ceil(needed / Math.max(rate, RATE_MIN) * slack * 1000));  // ×1000 = 秒→毫秒
/* settled 等的是**一次完整过渡**：ENV.dur（探针压到 0.25s，但兜底 2.8s）
   × 走完它所需的仿真秒，再留 3× 余量盖住首帧未推进与 setEnv 往返。
   ⚠️ 取 needed 用 Math.max(dur, 0.5) 兜底：dur 已被上一段代码压到 0.25，
      若哪天读到的 dur 是 undefined/0，折算会退化成 0 → 撞地板，与真实需求无关。 */
const settled = async page => {
  const rate = await measureRate(page);
  const needed = Math.max(await page.evaluate(() => window.__garden.ENV.dur || 2.8), 0.5);
  const ms = wallBudget(rate, needed, 3);
  try {
    await page.waitForFunction(() => window.__garden && window.__garden.ENV.t >= 1,
      null, { timeout: ms, polling: 250 });
    return true;
  } catch {
    /* 报红时把读数打出来，否则「超时」是黑箱：仿真推进到哪 / 墙钟等了多久 / 速率多少。
       能分辨「慢机等不够」与「仿真真没走（页面挂了）」这两件完全不同的事。 */
    const st = await page.evaluate(() => ({ t: window.__garden.ENV.t, s: window.__garden.simClock() }));
    const info = await page.evaluate(() => window.__garden.simState());
    console.log(`    [settled 超时] ENV.t=${Number(st.t).toFixed(3)}（需 ≥1）· ` +
      `仿真已走 ${Number(st.s).toFixed(2)}s · 预算 ${ms}ms 墙钟 · 采样速率 ${rate.toFixed(4)} 仿真s/墙钟s` +
      ` · 本帧补步 ${info.steps}/${info.maxSteps} @ ${Number(info.fixed * 1000).toFixed(1)}ms`);
    return false;
  }
};
/* ── 等 stats 标签刷新到位（2026-09-18 新增，修竞态）──
   `#stats` 不是逐帧写的：渲染循环里按**累加节拍**（约 0.5 秒）刷新一次。
   于是"设完状态就立刻读 textContent"是在赌 HUD 那一拍恰好已经跑过 ——
   旧软渲染 harness 一帧 2.4 秒，一帧就跨过节拍，永远踩得中；
   harness 换到真 GPU（37ms/帧）后这个赌局输了：实测连跑 3 次，2 次读到上一拍的旧标签
   （"切夜"读到"午夏"、"晨雾"读不到"薄雾"）。
   ⚠️ 这类"读一次"的断言换 harness 时是最先碎的 —— 判据要改成**轮询到谓词成立**。 */
/* ⚠️ 2026-10-13：#stats 的刷新条件是**墙钟累加** `acc += rawDt; if (acc >= 0.5)`
   （src/11-loop.js:1399-1400，注释自述「必须用 rawDt」）⇒ 一拍只要 0.5 **墙钟**秒，
   **不依赖仿真速率**，与上面 settled/camFly 那两个仿真钟判据是不同的口径，别混为一谈。
   慢机上每帧 2.4s，一帧就跨过 0.5s 节拍 ⇒ 刷新只会比真 GPU 更快，不是更慢。
   真正吃时间的是「读到的那一拍内容对不对」：状态刚 setEnv、那一拍还带着旧标签。
   ⇒ 6s 在慢机上够不够，取决于那之后有几帧可用，不是由节拍本身决定；
     统一抬到 12s（留 20 帧以上）即可覆盖，仍是**只改等多久、test() 一字未动**。 */
const STATS_BUDGET = 12000;
/* 启动等待（2026-10-31）：真 GPU 下首帧 <45s；沙箱 SwiftShader 2 核首帧要 ~125s、
   bootDone ~380s ⇒ 45s 必然假红（门禁超时，不是产品慢到不可用）。
   默认值不变，慢机用 GARDEN_BOOT_MS 放大；只改等多久，判据一字不动。 */
const BOOT_WAIT_MS = Math.max(45000, +process.env.GARDEN_BOOT_MS || 0);
async function waitStats(page, test, ms = STATS_BUDGET){
  const read = () => page.evaluate(() => (document.getElementById('stats') || {}).textContent || '');
  const t0 = Date.now();
  for (;;){
    const txt = await read();
    if (test(txt)) return { ok: true, txt };
    if (Date.now() - t0 > ms) {
      /* 超时把读到的东西原样打出来：空字符串说明 #stats 一拍都没刷新过（与"有旧标签但谓词不成立"
         是两回事，后者说明状态真没落位 —— 不打出来就没法分辨）。 */
      console.log(`    [waitStats 超时] ${ms}ms 内谓词未成立 · 读到 ${txt ? JSON.stringify(statsLineRaw(txt)) : '(空 —— #stats 一拍未刷新)'} ` +
        `· 墙钟已走 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { ok: false, txt };
    }
    await sleep(80);
  }
}
const statsLineRaw = txt => String(txt).split('\n').filter(l => l.includes('·')).join(' ').trim();
/* stats 里那行"天气 · 时刻季节"：两处断言都要它，取法统一在这里 */
const statsLine = txt => (String(txt).split('\n').find(l => l.includes('·')) || '').trim();

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  // 小视口：像素越少每帧越省，过渡靠仿真推进才等得起（harness 见 _harness.mjs）
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleMsgs.push({ type: 'pageerror', text: String(e) }));

  console.log(`\n[smoke] http://127.0.0.1:${port}/index.html`);

  /* ⚠️ 必须声明在早退分支之前：启动失败时第 63 行就 finish() 了，而下面那句
     `const info = ...` 还没执行到 —— 此时读取 info 命中 TDZ，finish() 自己抛
     ReferenceError，把"启动失败"的报告变成 Node 崩溃。用 let 提前置空。 */
  let info = null;

  // ── 1. 启动 ──
  /* ⚠️ 2026-10-19 · 钉 `?tier=low`（与 layout-fingerprint.mjs:40 同一理由）：
     本机双显卡，无头 ANGLE 会随机落到 NVIDIA=high 档 ⇒ pixelRatio=1.25、阴影/反射
     联动开启，同一份代码读数差一倍（实测 2026-10-19：Intel 轮 400/1.93M 绿；
     RTX 轮 796~804/4.32M 红三连）。判据数字不动，钉档保证跨机跨次可比。
     高档口径的渲染量防线由已钉 ?tier=high 的门（lamp-guard 等）守。 */
  const response = await page.goto(`http://127.0.0.1:${port}/index.html?tier=low&intro=0`, { waitUntil: 'load', timeout: 60000 });
  console.log('[source] HTTP=' + response.status() + ' matchesDisk=' + (await response.body()).equals(fs.readFileSync(path.join(ROOT, 'index.html'))));
  const booted = await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    undefined, { timeout: BOOT_WAIT_MS }).then(() => true).catch(e => { console.log('[boot-wait] ' + e.message); return false; });
  check('页面启动完成（loading 层收起，__garden 就绪）', booted);
  if (!booted) {
    for (const m of consoleMsgs) console.log('[boot-console] ' + m.type + ': ' + m.text);
    console.log('[boot-state] ' + JSON.stringify(await page.evaluate(() => ({ garden: !!window.__garden, loading: document.getElementById('loading')?.textContent, state: document.readyState })).catch(e => ({ error: e.message }))));
    await finish(); return;
  }

  // ── 2. 控制台卫生（SwiftShader 软渲染的 CONTEXT_LOST/Restored 属环境噪声，放行）──
  await sleep(4000);
  const isEnvNoise = t => /CONTEXT_LOST|Context Lost|Context Restored/.test(t);
  const errors   = consoleMsgs.filter(m => m.type === 'error' || m.type === 'pageerror');
  const geoWarns = consoleMsgs.filter(m => m.type === 'warning' && m.text.includes('[几何校验]'));
  const assetFail = consoleMsgs.filter(m => m.text.includes('资产失败') || m.text.includes('加载失败'));
  check('零 console error / pageerror', errors.length === 0, errors.map(e => e.text.slice(0, 90)).join(' | '));
  check('几何合并零校验告警', geoWarns.length === 0, geoWarns.map(w => w.text.slice(0, 90)).join(' | '));
  check('零资产加载失败', assetFail.length === 0);

  // ── 3. 渲染量上限（防性能回退的硬门禁）──
  /* ⚠️⚠️ 必须**等渲染量落到稳态**再读（2026-10-08 定案，两次踩坑）：
     `renderer.info.render.*` 是**上一帧**的计数，而它会被两件与场景规模无关的"临时多一趟"抬起来：
       ① 状态变化后的那一帧要重画一遍**阴影贴图**（`shadowMap.needsUpdate`）；
       ② **水面反射是自适应的**（静止时每 3 帧才刷一次）⇒ 命中那一帧就多出一整趟镜像渲染。
     实测**同一份未改动的代码**：674 calls / 2.65M tri（基线）↔ 1030 / 4.23M（含反射那帧）
     ↔ 835~1237（含阴影那趟）—— 800 的上限因此时红时绿，而这与"场景有没有变重"无关。
     ⇒ 读 **6 帧**、取 **calls 最小**的那次当基线，并把全部读数打进明细（不静默、不重试掩盖）。
     口径写清楚：这条守的是**场景基础渲染量**；自适应的反射/阴影那一趟是"按需多付"，
     按需付的那一帧不在本判据里（否则判据量的是"探针什么时候按的快门"）。 */
  const readBudget = () => page.evaluate(() => {
    const r = window.__garden.renderer;
    return { calls: r.info.render.calls, tris: r.info.render.triangles,
             geos: r.info.memory.geometries, tex: r.info.memory.textures };
  });
  const oneFrame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  /* ⚠️⚠️ 读之前先把状态**钉在"晴·夏"**（2026-10-08 第二次修，同一族的坑）：
     上面的步骤测过天气轴，结束时可能停在**暴雨/雨**，而 `waterBusy()` 在下雨时为真
     ⇒ 水面反射**每帧满速刷**、多出一整趟镜像渲染（实测基线 674 → **817**，直接撞 800 上限）。
     这也是"按需多付"的另一种形态：要量**场景基础量**，就得先回到确定的状态。
     改天气会让阴影贴图置脏 ⇒ 再多等 4 帧让那趟过去，然后 6 帧取最小。 */
  await page.evaluate(() => { window.__garden.setEnv('weather', 'clear'); window.__garden.setEnv('season', 'summer'); });
  for (let i = 0; i < 4; i++) await oneFrame();
  const reads = [];
  for (let i = 0; i < 6; i++){ reads.push(await readBudget()); await oneFrame(); }
  info = reads.reduce((a, b) => (b.calls < a.calls ? b : a));
  check(`draw calls 上限（${info.calls} < 800 · 晴夏基线）`, info.calls < 800,
    `6 帧读数 ${reads.map(r => r.calls).join('/')}（取最小＝基线；大值那几帧含反射/阴影那趟）`);
  check(`三角形上限（${info.tris.toLocaleString()} < 4,200,000 · 晴夏基线）`, info.tris < 4_200_000);
  /* ⚠️ 2026-10-19 上限 800→950：马厩换 Tinker 真马后，6 匹 × 7 个蒙皮网格 = 42 个几何，
     再加门口拴马桩/上马石 10 件、月洞门补铺 1 件 ⇒ 基线从 ~714 抬到 ~896。
     这条防的是"每实例复制几何"这类事故（如芭蕉 8 株各一份），不是防正常资产增量；
     950 仍能抓住翻倍（~1800）。 */
  check('几何/纹理数量健康', info.geos < 950 && info.tex < 300, `geos=${info.geos} tex=${info.tex}`);

  // ── 4. GLB 资产到齐且动起来 ──
  /* 2026-09-30 三轮：LotusPlant.glb 回归（老黄要回"树立的荷花"）—— 名单同步加回
     （a08bde0 下线那笔把它删了；沿革见 08 的注释）。 */
  /* ⚠️ 2026-10-03 名单补 **Macaw**：它是"五类"里的第五类，此前**不在名单上** ——
     于是"鹦鹉到底挂上没有"这一门从定义上就看不见它。而它又同时是 `required:false`
     ⇒ 失败既不阻塞开园、也无人报红，是**双重静默**。
     可辨识的抓手由 08-assemble.js 的 `holder.name = 'Macaw'` 提供：
     Rodin 导出的那个 GLB 自己的节点名就是泛用的 `Mesh`，本来没有名字可查
     （见该处注释；大小写敏感，'macaw' 匹配不上）。 */
  const glb = await page.waitForFunction(() => {
    const names = { KoiFish: 0, Turtle: 0, BananaPlant: 0, LotusPlant: 0, Macaw: 0 };
    window.__garden.scene.traverse(o => {
      for (const k of Object.keys(names)) if (o.name && o.name.includes(k)) names[k]++;
    });
    return Object.values(names).every(n => n > 0) && window.__garden.ENV
      ? names : false;
  }, null, { timeout: Math.max(40000, BOOT_WAIT_MS) }).then(v => v.jsonValue?.() ?? v).catch(() => null);
  /* ⚠️ **先断言前提，再判对错**（项目老教训：判据必须先断言前提）。
     「五类 GLB 均已挂载」这条在**降级态**下天然为假：required:false 的项失败后
     走程序化替身（芭蕉叶片），场景里出现的是 `banana-leaf` 冠层而不是名字里
     带 "BananaPlant" 的 GLB 节点 —— 这不是 bug，是设计。
     早先直接 `check('四类 GLB 资产均已挂载', !!glb)`，于是任何一次资产失败都让
     smoke 报红，而**报红原因与被测代码无关**（网络抖动）。现在按降级态分支断言。 */
  const deg = await page.evaluate(() => {
    const s = window.__garden.preloadState ? window.__garden.preloadState() : null;
    return { degraded: s?.degraded || [], settled: s?.settled, count: s?.count };
  });
  const degradedMode = deg.degraded.length > 0;
  if (degradedMode){
    // 降级态：断"替身确实上场了"，而不是断"GLB 都在"
    const sub = await page.evaluate(() => {
      let crowns = 0, leaves = 0;
      window.__garden.scene.traverse(o => {
        if (o.userData && o.userData.substitute === 'banana-leaf'){ crowns++; leaves += o.children.length; }
      });
      return { crowns, leaves };
    });
    console.log(`  [降级态] 失败 ${deg.degraded.length}/${deg.count} 项：`
      + deg.degraded.map(d => d.url || d).join(', '));
    check(`降级态有 ${deg.degraded.length} 项走替身流程（而不是静默穿帮）`, degradedMode);
    check('芭蕉替身叶片已构造（≥3 片，不是空冠层/光杆）', sub.leaves >= 3,
      `替身冠层 ${sub.crowns} 个 / 叶片 ${sub.leaves} 片`);
  } else {
    check('五类 GLB 资产均已挂载（未降级）', !!glb, glb ? JSON.stringify(glb) : '未挂载');
  }
  /* 锦鲤在游动（2026-10-13 改等待口径，判据 0.001m 一字未动）──
     ⚠️ 原来是「固定 sleep 1200ms 后读一次」。软渲染**一帧就要 2.4s**（ci.yml:15），
     若这 1.2s 内一帧都没渲染，position 压根不会被更新 ⇒ 必然判红。
     今天没红纯属侥幸：前面步骤已跑过 4 秒多帧 —— **靠别处跑过，不是靠本处保障**。
     ⇒ 改成**轮询到位移达标 + 设上界**，与本文件 waitStats 既有范式一致。
     上界直接复用 measureRate/wallBudget，不新造一套口径（unit 与地板只有一套）。
     needed 取 0.5 仿真秒：实测最慢线速度下走满 0.001m 约需 0.076 仿真秒，0.5 是 6.6 倍余量。 */
  const fishRate = await measureRate(page);
  const fishMs = wallBudget(fishRate, 0.5, 3);
  /* ⚠️⚠️ 这里曾让云端 CI 直接崩掉（2026-10-13 09:32 run 38332013849 smoke=failure），
     而 Chief 当时误判成「等待口径还不够」，往错方向改了半小时。真因：**page.evaluate 只能接收
     一个参数**（本仓 playwright-core 抛 `Too many arguments... wrap them in an object.`），
     而这里曾传 (ms, rate) 两个 ⇒ 探针在锦鲤这一步异常退出，整个 smoke 提前结束。
     ⇒ 多参数必须打包成对象；且改完探针必须**实跑**，本地真 GPU 跑不出来不算验过。 */
  const fish = await page.evaluate(async ({ ms, rate }) => {
    let group = null;
    window.__garden.scene.traverse(o => { if (o.userData && o.userData.fishes) group = o; });
    if (!group) return { ok: false, why: '没找到 fishes 组' };
    const p0 = group.userData.fishes[0].position.clone();
    const t0 = Date.now();
    for (;;){
      const d = group.userData.fishes[0].position.distanceTo(p0);
      if (d > 0.001) return { ok: true, d };
      if (Date.now() - t0 > ms) return { ok: false, d, waited: Date.now() - t0 };
      /* 轮询间隔必须跨得上一帧，**按注释做却没做**（接任时自审发现）：
         软渲染一帧 2.4s，原值 300ms ⇒ 绝大多数轮询读到的都是同一个 position，
         白跑上百次页面往返。真 GPU 一帧 37ms 时 300ms 反而是合理的。
         ⇒ 用已实测的速率换算间隔：走满「一帧」仿真量所需墙钟 = (1/60) / r。
         r=1（真 GPU）⇒ 17ms；r=0.042 ⇒ 397ms。区间本身自洽，不需要额外下限。 */
      const frameMs = Math.ceil((1 / 60) / Math.max(rate, 0.01) * 1000);
      await new Promise(r => setTimeout(r, Math.max(30, Math.min(frameMs, 3000))));
    }
  }, { ms: fishMs, rate: fishRate });
  const fishDisp = (fish.d || 0).toFixed(5);
  if (!fish.ok){
    console.log(`    [锦鲤超时] 等待 ${fishMs}ms 墙钟内位移未达标 · 当前位移 ${fishDisp}m（需 > 0.001）· ` +
      `仿真速率 ${fishRate.toFixed(4)} 仿真s/墙钟s` + (fish.why ? ` · ${fish.why}` : '') +
      (fish.waited ? ` · 实等 ${fish.waited}ms` : ''));
  }
  check('锦鲤在游动（位移 > 0.001m）', fish.ok, fish.why || `位移 ${fishDisp}m`);

  // ── 5. 环境轴切换与过渡 ──
  await page.evaluate(() => { window.__garden.ENV.dur = 0.25; });   // 探针加速过渡（见 settled 注释）
  /* 2026-10-31：真实月相合入后，夏季代表日 2027-07-10 是蛾眉月、21:30 月高仅 1.9° ⇒ 下面两条按"满月夜"写的
     月亮判据必须钉住月相 0.5（望）才是在量它们原本要量的东西（月可见、月光接管主光）。判据阈值不动。 */
  await page.evaluate(() => { window.__garden.ENV.moonPhase = 0.5; });
  await page.evaluate(() => window.__garden.setEnv('time', 'night'));
  check('切夜：过渡完成（ENV.t 收敛）', await settled(page));
  const nightStats = await waitStats(page, t => t.includes('夜'));
  const night = await page.evaluate(() => ({
    t: window.__garden.ENV.time, lum: window.__garden.scene.environmentIntensity,
  }));
  check('切夜：状态落位', night.t === 'night');
  check('切夜：stats 标签联动', nightStats.ok, statsLine(nightStats.txt));
  check('切夜：环境强度随亮度下调', night.lum < 0.6, `environmentIntensity=${night.lum && night.lum.toFixed(3)}`);
  // ── 5.1 月亮（2026-09-19 需求：晴夜有月、随辰起落；雨/阴天无月）──
  const nightMoon = await page.evaluate(() => {
    let mat = null;
    window.__garden.scene.traverse(o => {
      if (o.material && o.material.uniforms && o.material.uniforms.uMoonAmount) mat = o.material;
    });
    if (!mat) return null;
    /* ⚠️ 场景里有两盏平行光（sun + fill），必须认**投影那盏**：fill 不跟着月亮走，
       取错灯这条断言会永远红（或者更糟：fill 碰巧同向就假绿）。 */
    let dl = null;
    window.__garden.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow && !dl) dl = o; });
    if (!dl) window.__garden.scene.traverse(o => { if (o.isDirectionalLight && !dl) dl = o; });
    const d = mat.uniforms.uMoonDir.value;
    return { vis: mat.uniforms.uMoonAmount.value, alt: Math.asin(Math.max(-1, Math.min(1, d.y))),
             dot: dl ? dl.position.clone().normalize().dot(d) : null };
  });
  check('晴夜有月：天空月可见度>0.5 且月在地平线上', !!nightMoon && nightMoon.vis > 0.5 && nightMoon.alt > 0,
        nightMoon ? `vis=${nightMoon.vis.toFixed(2)} 仰角=${(nightMoon.alt * 180 / Math.PI).toFixed(1)}°` : '未找到天空材质');
  check('月光即主光：夜里的平行光方向 = 月亮方向', !!nightMoon && nightMoon.dot !== null && nightMoon.dot > 0.99,
        nightMoon ? `dot=${nightMoon.dot && nightMoon.dot.toFixed(3)}` : '未找到主光');

  await page.evaluate(() => { window.__garden.setEnv('time', 'noon'); window.__garden.setEnv('weather', 'storm'); });
  check('切暴雨：过渡完成', await settled(page));
  const storm = await page.evaluate(() => ({
    eff: window.__garden.effectiveWeather(),
    rain: window.__garden.ENV.cur.rainAmount || 0,
    windGlobal: window.__garden.WIND.uWindGlobal.value,
  }));
  check('切暴雨：有效天气为 storm', storm.eff === 'storm');
  check('切暴雨：雨量>0 且底值风>0（审计 B03 回归）', storm.rain > 0 && storm.windGlobal > 0,
        `rain=${storm.rain.toFixed(2)} windGlobal=${storm.windGlobal.toFixed(2)}`);

  // ── 6. 雪天互斥（B16/B17 回归）──
  await page.evaluate(() => { window.__garden.setEnv('weather', 'clear'); window.__garden.setEnv('season', 'summer'); });
  await settled(page);
  const summerMutex = await page.evaluate(() => ({
    allowed: window.__garden.weatherAllowed('snow'),
    disabled: document.querySelector('#env button[data-v="snow"]').disabled,
  }));
  check('夏季雪被拒：weatherAllowed=false 且按钮置灰', summerMutex.allowed === false && summerMutex.disabled === true);

  await page.evaluate(() => window.__garden.setEnv('season', 'winter'));
  await settled(page);
  const winterSnow = await page.evaluate(() => {
    window.__garden.setEnv('weather', 'snow');
    return window.__garden.weatherAllowed('snow');
  });
  check('冬季切雪：过渡完成', await settled(page));
  const snowState = await page.evaluate(() => ({
    eff: window.__garden.effectiveWeather(),
    snow: window.__garden.ENV.cur.snowAmount || 0,
    reverted: (document.querySelector('#env button[data-v="snow"]').classList.contains('on')),
  }));
  check('冬季切雪合法且生效', winterSnow === true && snowState.eff === 'snow' && snowState.snow > 0 && snowState.reverted);
  // ── 6.1 冬季植被存在性（紫藤是落叶藤本，冬季花穗必须落尽）──
  //    回归背景：collectSeasonCaches 曾把所有 InstancedMesh 从 presence 收集里剔除，
  //    MAT.wisteria 缓存恒空 → applyPresence 落空 → 冬季照常开花（无报错、无门禁，纯静默）。
  const winterWisteria = await page.evaluate(() => {
    let meshes = 0, visible = 0, count = 0;
    window.__garden.scene.traverse(o => {
      if (o.isInstancedMesh && o.material === window.__garden.MAT.wisteria){
        meshes++; if (o.visible) visible++; count += o.count;
      }
    });
    return { meshes, visible, count };
  });
  check('冬季紫藤落尽：花穗 InstancedMesh 全部 count=0 且不可见',
        winterWisteria.meshes > 0 && winterWisteria.visible === 0 && winterWisteria.count === 0,
        `meshes=${winterWisteria.meshes} visible=${winterWisteria.visible} count=${winterWisteria.count}`);
  await page.evaluate(() => { window.__garden.setEnv('season', 'summer'); window.__garden.setEnv('time', 'noon'); });
  await settled(page);
  const noonMoon = await page.evaluate(() => {
    let mat = null;
    window.__garden.scene.traverse(o => {
      if (o.material && o.material.uniforms && o.material.uniforms.uMoonAmount) mat = o.material;
    });
    return mat ? mat.uniforms.uMoonAmount.value : null;
  });
  check('正午无月（月亮只在夜里起落）', noonMoon === 0, `uMoonAmount=${noonMoon}`);

  // ── 6.5 拓展特性：晨雾 / 连续时辰 / 明信片 / 音景 ──
  await page.evaluate(() => window.__garden.setEnv('weather', 'mist'));
  check('切晨雾：过渡完成', await settled(page));
  const mistStats = await waitStats(page, t => t.includes('薄雾'));
  const mistState = await page.evaluate(() => ({
    fog: window.__garden.scene.fog.density,
    btnEnabled: !document.querySelector('#env button[data-v="mist"]').disabled,
  }));
  /* 2026-09-28 活雾批次：此处实际是**午+薄雾**（时辰停在上一节的正午），旧窗
     (0.0062,0.0085) 按常数 fogMul 1.3 校准；活雾后午档 = 0.0052×1.8×1.10 = 0.0103
     （老黄："中午不能没有雾，只是淡一点"），窗重定为 (0.008,0.013)。 */
  check('薄雾：雾密度抬升（底 1.8×时辰档，主建筑须可读）', mistState.fog > 0.008 && mistState.fog < 0.013, `density=${mistState.fog.toFixed(4)}`);
  check('晨雾：标签联动且全季节可用', mistStats.ok && mistState.btnEnabled,
        `label="${statsLine(mistStats.txt)}" btnEnabled=${mistState.btnEnabled}`);

  const sliderTaken = await page.evaluate(() => {
    const s = document.getElementById('hourSlider');
    s.value = 15.3;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  check('时辰滑杆：拖动事件受理', sliderTaken);
  check('时辰滑杆：短过渡完成', await settled(page));
  const hourState = await page.evaluate(() => ({
    hour: window.__garden.ENV.hour,
    time: window.__garden.ENV.time,
    readout: document.getElementById('hourReadout').textContent,
  }));
  check('时辰滑杆：ENV.hour 落位、按钮跟随最近锚点',
        Math.abs(hourState.hour - 15.3) < 0.01 && hourState.time === 'dusk',
        `hour=${hourState.hour} time=${hourState.time} readout=${hourState.readout}`);
  /* 这一条同样吃 HUD 节拍：等"·"行里出现 HH:MM 为止，别读一次就判 */
  const hourStats = await waitStats(page, t => /:\d\d/.test(statsLine(t)));
  check('时辰滑杆：stats 显示 HH:MM', hourStats.ok, statsLine(hourStats.txt));
  await page.evaluate(() => window.__garden.setEnv('time', 'noon'));
  await settled(page);
  const backNoon = await page.evaluate(() => ({
    hour: window.__garden.ENV.hour,
    slider: parseFloat(document.getElementById('hourSlider').value),
  }));
  check('时段按钮：把连续时辰拉回锚点 12:30',
        /* ⚠️ 2026-10-31（batch3 · 真实日轨 12h-solar）：`ENV.hour` 不再恰好是 12.5。
           换日轨前 `setEnv('time','noon')` 是"把 hour 赋成锚点常量 12.5"；换日轨后
           noon 表示"太阳正午"，由 12h-solar 按日期/纬度算出真值 —— 实测
           2026-10-31 苏州得 12.5448（与锚点差 0.045h ≈ 2.7min，即真太阳时与
           平太阳时的时差）。
           ⚠️ 判据口径也跟着改：**slider（按钮位置）仍必须是 12.5**（那是 UI 的锚点，
              一点没变）；`hour` 只要求"落在正午附近"，容差 0.15h ≈ 9min —— 够容纳
              全年时差变化（最大约 ±16min，取 9min 是保守值，因为本项目固定夏/冬日）。
           这不是放宽判据求绿：原来那条断言的是**旧模型的实现细节**，新模型下它
           测的东西已经不存在了。真正要守的是"按钮能把时辰拉回正午"，两个量都守住了。 */
        Math.abs(backNoon.slider - 12.5) < 0.01 && Math.abs(backNoon.hour - 12.5) < 0.15,
        `hour=${backNoon.hour.toFixed(4)} slider=${backNoon.slider}`);

  const card = await page.evaluate(() => {
    const url = window.__garden.postcardData();
    return { len: url.length, png: url.startsWith('data:image/png') };
  });
  check('明信片：可生成含题跋的 PNG', card.png && card.len > 50000, `${(card.len / 1024).toFixed(0)}KB dataURL`);
  const snd = await page.evaluate(() => ({
    a: window.__garden.toggleSound(),
    on: window.__garden.sndState(),
    b: window.__garden.toggleSound(),
  }));
  check('音景：开关往返状态正确', snd.a === true && snd.on === true && snd.b === false);
  await page.evaluate(() => window.__garden.setEnv('weather', 'clear'));
  await settled(page);

  // ── 7. 相机复位（键盘 0）──
  const pos0 = await page.evaluate(() => { const p = window.__garden.camera.position; return [p.x, p.y, p.z]; });
  await page.evaluate(() => window.__garden.camera.position.set(31, 9, 26));
  await page.keyboard.press('0');
  await sleep(250);
  const pos1 = await page.evaluate(() => { const p = window.__garden.camera.position; return [p.x, p.y, p.z]; });
  const moved = Math.hypot(pos0[0] - pos1[0], pos0[1] - pos1[1], pos0[2] - pos1[2]);
  check('按 0 键视角复位', moved < 1e-3, `复位距离 ${moved}`);

  // ── 7.5 点击水面起涟漪（2026-09-19）：可信鼠标点击 → 射线命中池面 → spawnRipple ──
  /* 回归要点：① insidePond 是池心局部坐标（池心世界 z=3），世界点要先减 3；
     ② 必须发**可信** pointerdown+up（page.mouse），合成 pointerup 会被手势过滤丢掉。 */
  const pondPt = await page.evaluate(() => {
    const { camera, THREE, insidePond } = window.__garden;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const cv = document.querySelector('canvas');
    for (const fy of [0.62, 0.58, 0.66, 0.70, 0.55, 0.50]){
      for (const fx of [0.30, 0.34, 0.26, 0.40, 0.22, 0.45]){
        ndc.set(fx * 2 - 1, -(fy * 2) + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(plane, hit) && insidePond(hit.x, hit.z - 3))
          return { x: Math.round(fx * cv.clientWidth), y: Math.round(fy * cv.clientHeight) };
      }
    }
    return null;
  });
  check('点击涟漪：默认机位下找得到池面可点屏幕点', !!pondPt, JSON.stringify(pondPt));
  if (pondPt){
    await page.mouse.click(pondPt.x, pondPt.y);
    await sleep(250);
    const rip = await page.evaluate(() => window.__garden.clickRippleLast());
    check('点击涟漪：可信点击命中池面并生成水痕', !!(rip && rip.hit), JSON.stringify(rip));
  }

  // ── 8. stats 实时更新 & 视口缩放 ──
  const statsOk = await page.evaluate(() => /draw calls/.test(document.getElementById('stats').textContent));
  check('stats 面板持续刷新', statsOk);
  await page.setViewportSize({ width: 480, height: 800 });
  await sleep(600);
  const smallOk = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c.width > 0 && c.height > 0 && Math.abs(c.clientWidth - 480) < 2;
  });
  check('视口缩放画布自适应（480×800）', smallOk);

  // ── 8.5 移动端适配（P1-8 → 2026-10-07 收紧）：320px 不溢出 + aria-pressed + 触控命中区 ──
  // 命中区门槛 38→44px：老黄 2026-10-07 要求"选项卡的样式和尺寸要能适配用手点击"，
  // 面板里所有按钮（含时段条下方那四个锚点标签）在窄屏/触控档统一 46px ⇒ 44 是新契约。
  // 这条有牙：改之前量到的是 40px，按 44 判必红（对照见 probe/mobile-panel-guard.mjs）。
  await page.setViewportSize({ width: 320, height: 640 });
  await sleep(600);
  const mob = await page.evaluate(() => {
    const env = document.getElementById('env').getBoundingClientRect();
    const stats = document.getElementById('stats').getBoundingClientRect();
    const hud = document.getElementById('hud').getBoundingClientRect();
    const btns = [...document.querySelectorAll('#env button')];
    return {
      inVp: env.left >= 0 && env.right <= innerWidth &&
            stats.left >= 0 && stats.right <= innerWidth &&
            hud.left >= 0 && hud.right <= innerWidth,
      noOverflow: document.documentElement.scrollWidth <= 320 && document.body.scrollWidth <= 320,
      allPressed: btns.length > 0 && btns.every(b => b.hasAttribute('aria-pressed')),
      minH: Math.min(...btns.map(b => b.getBoundingClientRect().height)),
    };
  });
  check('移动端 320px：面板收进视口且无横向溢出', mob.inVp && mob.noOverflow);
  check('移动端：按钮 aria-pressed 齐全、触控命中区 ≥44px', mob.allPressed && mob.minH >= 44,
        `minH=${Math.round(mob.minH)}`);

  // ── 8.6 PWA 离线三件套（P1-3）：manifest 可取 + sw.js 可取 + 注册不报错 ──
  const pwa = await page.evaluate(async () => {
    const out = { manifest: false, sw: false, regErr: '' };
    try {
      const r = await fetch('./manifest.webmanifest');
      const j = await r.json();
      out.manifest = !!(j && j.name && j.start_url);
    } catch (e) { out.manifest = false; }
    try {
      const r2 = await fetch('./sw.js');
      const t = await r2.text();
      /* 版本号模式即可：缓存清单每次迭代都可能升 v2/v3（如封面入壳），
         写死 v1 会逼着每次正常换缓存都来改探针。守的是"sw 可取且声明了版本化缓存"。 */
      out.sw = /suzhou-garden-v\d+/.test(t);
    } catch (e) { out.sw = false; }
    try {
      if ('serviceWorker' in navigator) await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (e) { out.regErr = String((e && e.message) || e).slice(0, 80); }
    return out;
  });
  check('PWA：manifest 可取且字段齐全', pwa.manifest);
  check('PWA：sw.js 可取且缓存版本一致', pwa.sw);
  check('PWA：SW 注册不抛错（http 下应成功）', !pwa.regErr, pwa.regErr);

  // ── 8.7 导览字幕巡游（P2-2）：启停往返 + 字幕联动 + 用户接管停 ──
  await page.evaluate(() => { window.__garden.ENV.dur = 0.25; });
  const tour0 = await page.evaluate(() => {
    window.__garden.tourStart();
    return { st: window.__garden.tourState(), cap: window.__garden.tourCaption() };
  });
  check('巡游：启动后状态 on 且首站 hero', tour0.st.on === true && tour0.st.idx === 0, JSON.stringify(tour0.st));
  check('巡游：首站字幕为立峰·云根', /云根/.test(tour0.cap), tour0.cap);
  // 等首站飞行落定（camFly 熄灭），再确认停留计时不提前切站
  /* ⚠️ 2026-10-13：原来这里是 `.catch(() => {})` **静默吞掉超时**。
     后果是两条：① 飞行没落定就继续取样，tourFly.idx 读到的是**飞行途中**的状态 ⇒ 假读数；
     ② 真超时也无人知道。这与"等不到就红"的门禁原则直接冲突。
     超时同样按推进速率换算：CAM_FLY.t += dt / CAM_FLY.dur（src/08-assemble.js:3256），
     巡游飞行 dur=1.4 秒（src/08-assemble.js:3533 gotoViewpoint(id, 1.4, 'tour')）
     ⇒ 需要的仿真秒数取 camFlyState().dur 实测值，不写死。 */
  const flyRate = await measureRate(page);
  const flyDur = await page.evaluate(() => window.__garden.camFlyState().dur || 1.4);
  const flyMs = wallBudget(flyRate, flyDur, 4);
  const flyOK = await page.waitForFunction(() => window.__garden && !window.__garden.camFly(),
    null, { timeout: flyMs, polling: 200 }).then(() => true).catch(() => false);
  if (!flyOK){
    const st = await page.evaluate(() => window.__garden.camFlyState());
    console.log(`    [camFly 超时] 飞行未落定：t=${Number(st.t).toFixed(3)}（需 ≥1）· dur=${st.dur}s · ` +
      `owner="${st.owner}" · 预算 ${flyMs}ms 墙钟 · 速率 ${flyRate.toFixed(4)} 仿真s/墙钟s`);
  }
  const tourFly = await page.evaluate(() => window.__garden.tourState());
  check('巡游：首站飞行按期落定（camFly 熄灭）', flyOK, `owner=${tourFly.idx === 0 ? 'tour' : '?'} 飞行 dur=${flyDur}s`);
  check('巡游：飞行落定后仍在首站（不提前切站）', tourFly.idx === 0, `idx=${tourFly.idx}`);
  // 用户接管：画布 pointerdown 应停巡游并收字幕
  const tourTake = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const el = document.getElementById('caption');
    return { st: window.__garden.tourState(), shown: el.classList.contains('show') };
  });
  check('巡游：画布接管即停并收字幕', tourTake.st.on === false && tourTake.shown === false,
        `on=${tourTake.st.on} shown=${tourTake.shown}`);
  // 按钮开关往返：巡游▸ → 停■ → 巡游▸
  const tourBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#env button')].find(x => x.dataset.act === 'tour');
    b.click(); const on1 = window.__garden.tourState().on, t1 = b.textContent;
    b.click(); const on2 = window.__garden.tourState().on, t2 = b.textContent;
    return { on1, t1, on2, t2 };
  });
  check('巡游：按钮开关往返且文案切换', tourBtn.on1 === true && tourBtn.t1 === '停■' && tourBtn.on2 === false && tourBtn.t2 === '巡游▸',
        `${tourBtn.t1}/${tourBtn.t2}`);
  await page.evaluate(() => window.__garden.tourStop());

  // ── 8.8 帧率自适应（P1-1 附带项）：自动化免疫 + 手动降档生效 + 后台暂停接线 ──
  /* ⚠️ 2026-09-18 判据换过。原来的断言是 `softwareGL === true`（"软渲染下免疫"），
     但探针 harness 换到真 GPU 之后 SOFTWARE_GL 变 false（实测 66× 提速，见 _harness.mjs），
     那条断言就红了 —— 而它红得对：**它守的本来就是"探针运行时 QOS 不许自己动"**，
     软渲染只是那个不变量的**代理**。代理失效了，判据要换成直接信号 `probeDriven`。
     不变量本身不变：active=false 且档位停在 L0（QOS 会在跑的过程中改 scale / 阴影尺寸，
     是回归断言最怕的"会自己动的量"）。 */
  const qos0 = await page.evaluate(() => ({
    st: window.__garden.qosState(), sw: window.__garden.softwareGL, gpu: window.__garden.gpuName,
    pd: window.__garden.probeDriven, immune: window.__garden.qosImmune,
  }));
  check('QOS：自动化驱动下自适应免疫（active=false，档位停在 L0）',
        qos0.pd === true && qos0.immune === true && qos0.st.active === false && qos0.st.level === 0,
        `probeDriven=${qos0.pd} immune=${qos0.immune} software=${qos0.sw} active=${qos0.st.active} L${qos0.st.level}`);
  /* 手动降档：最低档必须关 AO、压分辨率并降阴影。
     ⚠️ 倍率不再写死 0.72 —— 2026-09-25 画质系统改为五档平滑退化
     （1.00 / 0.94 / 0.86 / 0.78 / 0.72），锁定最低档 L4 恰为 0.72，
     但判据应当是"倍率取自**产品自己**的档位表"而不是我在这里复述一遍数字：
     复述会随档位调整而静默失配（这次就是这样先红）。 */
  const qos1 = await page.evaluate(() => {
    const before = { pr: window.__garden.renderer.getPixelRatio(), base: window.__garden.qosState().baseScale };
    const st0 = window.__garden.qosState();
    window.__garden.setQos(st0.maxLevel);
    return { before, after: window.__garden.renderer.getPixelRatio(),
             st: window.__garden.qosState(), maxLevel: st0.maxLevel };
  });
  check('QOS：降到最低档生效（分辨率下压且 AO 关闭）',
        qos1.after < qos1.before.base - 1e-6 && qos1.st.ao === false && qos1.st.level === qos1.maxLevel,
        `pixelRatio ${qos1.before.pr}→${qos1.after}（基准 ${qos1.before.base}）L${qos1.st.level}/${qos1.maxLevel} AO=${qos1.st.ao}`);
  await page.evaluate(() => window.__garden.setQos(0));
  const qos2 = await page.evaluate(() => ({
    pr: window.__garden.renderer.getPixelRatio(), st: window.__garden.qosState(),
  }));
  check('QOS：升回 L0 恢复基准像素比',
        Math.abs(qos2.pr - qos2.st.baseScale) < 1e-6 && qos2.st.level === 0,
        `pixelRatio=${qos2.pr}`);
  /* 后台暂停：覆盖 document.hidden 后派发 visibilitychange，页面应记录为隐藏 */
  const hid = await page.evaluate(() => {
    const before = window.__garden.hidden();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const during = window.__garden.hidden();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return { before, during, after: window.__garden.hidden() };
  });
  check('后台暂停：visibilitychange 接线（隐藏→暂停，恢复→继续）',
        hid.before === false && hid.during === true && hid.after === false,
        `${hid.before}→${hid.during}→${hid.after}`);

  /* ── 檐口两排圆头的几何关系（2026-09-30，老黄两轮指认"红褐椽头顶进灰蓝瓦当"）──
     三条判据，牙齿在②③：
       ① 三维上不相交（最近实例中心距 ≥ 两半径和 0.195，实测 0.495）—— 这条是**安全不变量**，
          注意它**抓不到本缺陷**（旧值 0.22 时两排中心距仍有 0.60，因为 0.6m 的进深差占了大头：
          当时"看着穿模"是仰视透视重叠，不是互穿）。留着它只为防"真的互穿"这类回归。
       ② **进深错位**（椽头外端退在瓦当排之后 ≥0.10m，实测 0.15）—— 这才是让檐口读得开的那条，
          旧值 -0.05（外端还挑出瓦当 0.05）⇒ 必然报红。三轮 A/B 定案：只加大下压量修不好
          （只下压 0.10 → 咬合照旧；只里收 0.20 → 沿坡度抬高、咬合反增到五六成）。
       ③ 两侧檐口飞椽头"斜削端朝外"（北檐靠 ry=π）。低角度看不到斜面本身，所以用
          局部 +z 变换后的世界朝向做**确定性**判定；旧值南檐对、北檐反（34/34）。 */
  const eave = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    /* ⚠️ 2026-10-31（batch3 · 静态合批）：原先只从**活着的 InstancedMesh** 里按
       `geometry.parameters` 找瓦当(radiusTop 0.105)/椽头(radiusTop 0.09 + height 1.3)。
       合批的 bake 路径会把这些小件**展开成普通几何**并进材质桶、原件 remove + 几何 dispose
       ⇒ 本判据当场报 "没找到瓦当/椽头实例网格"（三条一起红）。
       ⚠️ 几何数据没丢，但从合并后的顶点**逆推**"哪个实例是哪件、朝向如何"等于把 bake 的
          变换反解一遍，任何一侧改动都会静默出错 —— 所以不这么干。
       改为**优先读合批台账** `__garden.mergeLedger`（合批当场记下的 name/参数/世界矩阵）。
       仍保留原来的活体扫描作为兜底：没走 bake 的件（例如 `?batch=0` 或将来改回 keep）
       照旧能被找到，两条路径的读数口径完全一致（都取实例的原点世界坐标）。 */
    const tiles = [], raft = [];
    /* 台账两条路都要读：
       · kind='bake'  —— 小件被展开进材质桶（原件 remove + 几何 dispose）
       · kind='group' —— 内容相同的多个 InstancedMesh 拼成一个（合并后 geometry.parameters
         常为 null，所以也找不到） */
    const ledger = (G.mergeLedger || []).filter(e => e.worldMatrices && e.count);
    const posOf = (mArr) => [mArr[12], mArr[13], mArr[14]];   // 列主序：平移在第 4 列
    const isTile = e => e.radiusTop != null && Math.abs(e.radiusTop - 0.105) < 1e-6;
    const isRaft = e => e.radiusTop != null && Math.abs(e.radiusTop - 0.09) < 1e-6
                     && e.height != null && Math.abs(e.height - 1.3) < 1e-6;
    const ledC = ledger.filter(isTile).flatMap(e => e.worldMatrices.map(posOf));
    const ledR = ledger.filter(isRaft).flatMap(e => e.worldMatrices.map(posOf));
    /* 椽头的**完整世界矩阵**（斜削朝向要用到旋转，光有平移点不够）——
       台账直接给矩阵；活体件要现算 `matrixWorld · instanceMatrix`。 */
    const raftWorld = ledger.filter(isRaft).flatMap(e => e.worldMatrices.slice());
    /* 活体兜底（未走 bake 的件） */
    G.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.geometry || !o.geometry.parameters) return;
      const pr = o.geometry.parameters;
      if (Math.abs((pr.radiusTop || 0) - 0.105) < 1e-6) tiles.push(o);
      if (Math.abs((pr.radiusTop || 0) - 0.09) < 1e-6 && Math.abs((pr.height || 0) - 1.3) < 1e-6) raft.push(o);
    });
    const dump = (im) => { const out = [], m = new T.Matrix4(), v = new T.Vector3();
      for (let i = 0; i < im.count; i++){ im.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
        out.push([v.x, v.y, v.z]); } return out; };
    /* 活体椽头的世界矩阵（补进 raftWorld，与台账同一形态） */
    {
      const m = new T.Matrix4();
      for (const im of raft){
        for (let i = 0; i < im.count; i++){
          im.getMatrixAt(i, m);
          raftWorld.push(m.clone().premultiply(im.matrixWorld).toArray());
        }
      }
    }
    const C = ledC.concat(tiles.flatMap(dump)), R = ledR.concat(raft.flatMap(dump));
    if (!C.length || !R.length) return { err: '没找到瓦当/椽头实例（台账与活体扫描均为空）',
                                         ledger: ledger.length, liveTiles: tiles.length, liveRaft: raft.length };
    const d3 = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    let minPair = 1e9;
    for (const r of R){ let best = 1e9; for (const c of C){ const d = d3(r, c); if (d < best) best = d; } if (best < minPair) minPair = best; }
    /* ⚠️ 必须**只取正堂那套瓦当**：全场 324 个瓦当里混着水榭/游廊的，
       拿全集取 max(z) 会拿到别家屋顶（实测 12）⇒ 判据变成假绿（退 18.65m 也照样通过）。
       筛法：正堂屋面 x∈±12.3、z∈-12.8±6.3 ⇒ 按包围盒圈出正堂那一套。 */
    const hallC = C.filter(p => Math.abs(p[0]) <= 13 && Math.abs(p[2] + 12.8) <= 7);
    const hallR = R.filter(p => Math.abs(p[0]) <= 13 && Math.abs(p[2] + 12.8) <= 7);
    if (!hallC.length || !hallR.length) return { err: '没圈出正堂那套瓦当/椽头' };
    /* 南檐（z 最大的一条）：瓦当排 z 与椽头外端 z（外端 = 中心 + 0.65，朝外） */
    const capZ = Math.max(...hallC.map(p => p[2]));
    const rafZSouth = Math.max(...hallR.map(p => p[2]));
    const rafTipZ = rafZSouth + 0.65;
    /* 斜削朝向：局部 +z 经实例矩阵变换后的世界 z 分量，应与"该椽相对中心的方向"同号。
       ⚠️ 2026-10-31（batch3 · 静态合批）：原先这里直接拿 `raft[0]` 这个活体 InstancedMesh
          逐个 `getMatrixAt`。合批后椽头全走 bake 路径（活体扫描 raft=0）⇒ 这一行抛
          "Cannot read properties of undefined (reading 'count')"，整个 smoke 崩掉。
          改为**统一从世界矩阵数组读**：台账与活体两条来源在下面被归一成同一种形态
          （每项 = 一个实例的世界矩阵），斜削朝向只跟矩阵有关，与来源无关。 */
    const centerZ = -12.8;
    let bevelOut = 0, bevelIn = 0;
    const dirM = new T.Matrix4(), dir = new T.Vector3(), pos = new T.Vector3();
    for (const mArr of raftWorld){
      dirM.fromArray(mArr);
      pos.setFromMatrixPosition(dirM);
      /* 斜削方向 = 该实例局部 +z 轴在世界空间的方向 */
      dir.set(0, 0, 1).transformDirection(dirM);
      if (Math.sign(dir.z) === Math.sign(pos.z - centerZ)) bevelOut++; else bevelIn++;
    }
    return { capN: C.length, rafN: R.length, hallCapN: hallC.length, minPair: +minPair.toFixed(3),
             capZ: +capZ.toFixed(3), rafTipZ: +rafTipZ.toFixed(3), bevelOut, bevelIn };
  });
  check('檐口：瓦当排与椽头排三维不相交（最近中心距 ≥ 两半径和 0.195）',
        !eave.err && eave.minPair >= 0.195,
        eave.err || `最近 ${eave.minPair}（瓦当 ${eave.capN} / 椽头 ${eave.rafN}）`);
  check('檐口：椽头外端退在瓦当排之后 ≥0.10m（进深错位才是读得开的原因）',
        !eave.err && (eave.capZ - eave.rafTipZ) >= 0.10,
        eave.err || `正堂瓦当 ${eave.hallCapN} 个，南檐瓦当 z=${eave.capZ} ｜ 椽头外端 z=${eave.rafTipZ}（退 ${(eave.capZ - eave.rafTipZ).toFixed(3)}m）`);
  check('檐口：两侧檐口飞椽头的斜削端都朝外（形制一致）',
        !eave.err && eave.bevelIn === 0 && eave.bevelOut === eave.rafN,
        eave.err || `朝外 ${eave.bevelOut} / 朝内 ${eave.bevelIn}`);

  // ── 汇总 ──
  finish();

  async function finish() {
    const bootLog = consoleMsgs.find(m => m.text.includes('[启动分段]'));
    if (bootLog) console.log(`[info] ${bootLog.text}`);
    /* ⚠️ 启动失败时 info 停在 null（早退分支在赋值之前就走到这儿了）—— 这里必须能安全
        取值，否则报告"启动失败"的过程本身会崩掉，看到的是一堆栈而不是"哪一项没过"。 */
    console.log(info ? `[info] draw calls=${info.calls} triangles=${info.tris.toLocaleString()} geos=${info.geos} tex=${info.tex}`
                     : '[info] 启动未完成，跳过渲染量统计');
    await browser.close().catch(() => {});
    server.close();
    const fails = results.filter(r => !r.ok).length;
    console.log(`\n[smoke] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
    process.exit(fails === 0 ? 0 : 1);
  }
})().catch(e => { console.error('[smoke] 探针自身异常：', e); process.exit(1); });
