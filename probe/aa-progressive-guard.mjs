// 抗锯齿渐进超采样专项门禁：node probe/aa-progressive-guard.mjs
//
// ── 2026-09-28 分流改造 ─────────────────────────────────────────────────────
// AA 与 QOS 是**同一个像素预算上的两个调节器**，共用同一条免疫判据 `QOS_IMMUNE`
// （`02-scene.js`：`QOS_IMMUNE = SOFTWARE_GL || PROBE_DRIVEN`）。AA 侧落在
// `src/11-loop.js` 的 `adaptiveAllowed() = st.enabled && !QOS_IMMUNE` —— 为假时恒停 step0。
//
// 旧版只测「相机静止时倍率逐级上升」，那条**只在真机语义下成立**：
//   无头探针里 `PROBE_DRIVEN=true` ⇒ 免疫 ⇒ AA 恒停 step0，而那才是**正确**行为。
//   于是旧判据在探针里必然红。它改造前之所以绿，是靠撞上 AA 自己的 `q.level>=2` 自闸
//   （QOS 偶发降档把它压住）—— 侥幸，不是稳定成立。
//
// 本门因此按**环境语义**分流，两个 context 各测一支，**两支都有牙、各配负例自检**：
//   [P] 探针语义（默认 context，webdriver=true ⇒ immune=true）
//       AA 必须**恒停 step0**，且不许改 renderer/composer 的 pixelRatio。
//       负例：「假免疫」—— 免疫为真但 AA 仍在升档 ⇒ 判据必须红。
//   [R] 真机语义（webdriver 胶水置 false ⇒ immune=false）
//       四条真机约束：静止升档 / 一动回落 / 低档不上探 / 与 QOS 联动，
//       外加「升档后的像素比 = min(base×qosScale×scale, 像素预算上限)」。
//       负例：「AA 不升档」（含把作者开关关掉）⇒ 判据必须红。
//   [B] 4K + high：AA 顶档是**唯一**会被像素预算 clamp 咬到的组合（base=1.0247，
//       ×1.36=1.393 会突破 budget=8709120 ⇒ 像素面积 1.29× 预算）。这一支守
//       「AA 升档不得突破 pixelBudget」这条护栏，并**先断言 clamp 确实在咬**
//       （否则在 1080p 上这条断言是空转的 —— 那里 base×1.36 本来就低于预算）。
//       ⚠️ 本支并入本门而非另立一门：它与 [R] 同属"AA 自己的像素行为"，且
//       `outputs/_diag/aa-immunity-diag.mjs` 的 [A]/[B] 场景已被上面两支覆盖。
// ⚠️ 不许为了让门绿而弱化判据。两支的断言方向**相反**：任何一支被弱化成永真，
//    另一支的负例自检（喂合成违规态 + 现场构造违规态）会立刻抓到。
// ⚠️ 本门不碰 src/：探针环境不能靠改产品代码造负例（铁律 3），只能喂态 / 用产品侧开关。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.glb':'model/gltf-binary' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT,p),(err,data)=>{
    if(err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(data);
  });
});
const results=[];
const check=(name,ok,detail='')=>{results.push({name,ok});console.log(`  ${ok?'✓':'✗'} ${name}${detail?' — '+detail:''}`);};

/* 负例自检（铁律 3）：判据必须能红。喂一个**应然被拦下**的态，判据必须为假。
   ⚠️ 绝不用 `A.x || B.x` 之类会短路的写法 —— 那正是永真的来源。 */
function expectRed(label, pred, violating){
  const pass = pred(violating) === false;
  check(`负例自检：${label}`, pass,
    pass ? '' : `判据对违规态仍为真 ⇒ 该判据永真！态=${JSON.stringify(violating)}`);
}

/* 等 n 个动画帧（**帧数**而非墙钟：RISE_FRAMES 是帧数，软渲染一帧 ~100ms，
   用墙钟等会把"渲染慢"误判成"AA 坏了"）。 */
const stillFrames = (page, n) => page.evaluate(n => new Promise(res => {
  let k = 0;
  const step = () => { if (++k >= n) res(k); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), n);

/* 静止帧数：RISE_FRAMES=45/档，两支各需跨过 2 档 ⇒ 120 帧足够（>45×2=90）。
   保持静止的前提：intro 已关、巡游未启动、QOS 被产品侧锁档（见下）。 */
const STILL_FRAMES = 120;

/* ── 两支的判据（提出来是为了让负例能直接喂态）────────────────────────────
   [P] 免疫语义：AA 不得动 —— 恒 step0，且像素比仍等于 QOS 给的基础倍率。 */
const immuneHolds = s => s.allowed === false && s.step === 0
  && Math.abs(s.pixelRatio - s.baseScale) < 1e-6;
/* [R] 真机语义：AA 确实升到顶档，且像素比 = min(base×qosScale×scale, 预算上限)。 */
const realRiseHolds = s => s.step >= 2 && s.scale <= s.maxScale + 1e-6
  && Math.abs(s.pixelRatio - Math.min(s.baseScale * s.qosScale * s.scale, s.budgetCap)) < 1e-6;
/* [R] 回落语义：相机一动 / 档位一降，AA 必须已回到 step0（同步回落，不等拖影）。 */
const realFallbackHolds = s => s.step === 0
  && Math.abs(s.pixelRatio - Math.min(s.baseScale * s.qosScale, s.budgetCap)) < 1e-6;
/* [B] 预算护栏：AA 抬起来的像素比不得越过像素预算上限，且必须精确等于
   `min(base×qosScale×scale, cap)`（既不许超预算，也不许无故少算）。 */
const budgetHolds = s => s.pixelRatio <= s.budgetCap + 1e-6
  && Math.abs(s.pixelRatio - Math.min(s.baseScale * s.qosScale * s.scale, s.budgetCap)) < 1e-6;

/* 开一个页面。mockReal=true 时用胶水把 `navigator.webdriver` 置 false ——
   这是 `02-scene.js` 的 `PROBE_DRIVEN` 唯一输入，从而在探针里**模拟真机语义**。
   ⚠️ 胶水必须在任何页面脚本之前跑，所以用 `addInitScript`（`_harness` 无需改动）。 */
async function open(browser, port, { mockReal = false, width = 1280, height = 720 } = {}){
  const ctx = await browser.newContext({ viewport:{ width, height } });
  if (mockReal){
    await ctx.addInitScript(() => {
      try { Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true }); } catch {}
    });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  return { ctx, page, errs };
}

(async()=>{
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);

  /* ══ [P] 探针语义：免疫必须"真免疫" ══════════════════════════════════ */
  console.log('\n[P] 探针语义（默认 context：webdriver=true ⇒ QOS_IMMUNE=true）');
  const P = await open(browser, port);
  const p0 = await P.page.evaluate(() => window.__garden.qualityState());
  // 前提断言（铁律 3①）：先把"这次跑在哪一支"钉死，否则下面的断言可能测错对象
  check('前提[P]：环境被判为免疫，且由 PROBE_DRIVEN 触发',
    p0.immune === true && p0.probeDriven === true,
    `immune=${p0.immune} probeDriven=${p0.probeDriven} software=${p0.software}`);
  check('前提[P]：QOS 自身也被同一条判据钉在 L0',
    p0.active === false && p0.level === 0, `active=${p0.active} level=${p0.level}`);
  // 锁档：把 QOS 自动升降档这个干扰源去掉，测的才是 AA 自己的行为（旧版靠它侥幸绿）
  await P.page.evaluate(() => window.__garden.setQualityMode('high'));
  const a0 = await P.page.evaluate(() => window.__garden.aaState());
  check('起始为基础倍率（未升采样）',
    a0.step === 0 && Math.abs(a0.pixelRatio - a0.baseScale) < 1e-6, JSON.stringify(a0));

  const stilled = await stillFrames(P.page, STILL_FRAMES);
  const a1 = await P.page.evaluate(() => window.__garden.aaState());
  check(`[P] 连静止 ${STILL_FRAMES} 帧 AA 仍恒停 step0（真机在此帧数内必升到 step2）`,
    immuneHolds(a1), `实际静止=${stilled} 帧 state=${JSON.stringify(a1)}`);
  check('[P] 停用原因确为 QOS_IMMUNE（不是作者把开关关了）',
    a1.immune === true && a1.enabled === true && a1.allowed === false,
    `immune=${a1.immune} enabled=${a1.enabled} allowed=${a1.allowed}`);
  check('[P] pr 稳定在 baseScale（AA 不再改分辨率）',
    Math.abs(a1.pixelRatio - a1.baseScale) < 1e-6, `pr=${a1.pixelRatio} base=${a1.baseScale}`);

  // 负例自检：判据必须能抓"假免疫"
  expectRed('假免疫①（免疫名义为真，但 allowed=true 且已升到 step2）', immuneHolds,
    { allowed:true, step:2, pixelRatio:1.70, baseScale:1.25 });
  expectRed('假免疫②（免疫为真，但 step 被推到 1）', immuneHolds,
    { allowed:false, step:1, pixelRatio:1.475, baseScale:1.25 });
  expectRed('假免疫③（step 为 0，但 pr 已被 AA 抬离 baseScale）', immuneHolds,
    { allowed:false, step:0, pixelRatio:1.475, baseScale:1.25 });
  // 现场构造违规态：同步把 AA 推到 step2，并在**同一个 tick 内**读回（rAF 来不及拉回）
  const inj = await P.page.evaluate(() => { const g = window.__garden; g.aaSetStep(2); return g.aaState(); });
  check('负例自检：现场构造的违规态（step=2）确实被判据拦下',
    inj.step === 2 && immuneHolds(inj) === false, JSON.stringify(inj));
  check('负例自检：该违规态是"真升档"而非读到旧值（step=2 且 pr>base）',
    inj.step === 2 && inj.pixelRatio > inj.baseScale + 1e-6,
    `step=${inj.step} pr=${inj.pixelRatio} base=${inj.baseScale}`);
  // 免疫是**每帧强制**的（不是一次性开关）：注入后很快被 tick() 拉回
  await stillFrames(P.page, 4);
  const a1b = await P.page.evaluate(() => window.__garden.aaState());
  check('[P] 免疫每帧强制（注入 step2 后 ≤4 帧被拉回 step0）', immuneHolds(a1b), JSON.stringify(a1b));

  /* ══ [R] 真机语义：AA 的三条约束 + 预算护栏必须都真 ════════════════════ */
  console.log('\n[R] 真机语义（webdriver 胶水置 false ⇒ QOS_IMMUNE=false）');
  const R = await open(browser, port, { mockReal:true });
  const r0 = await R.page.evaluate(() => window.__garden.qualityState());
  check('前提[R]：环境已非免疫（immune=false / probeDriven=false）',
    r0.immune === false && r0.probeDriven === false,
    `immune=${r0.immune} probeDriven=${r0.probeDriven} software=${r0.software}`);
  // 锁档：mockReal 下 QOS 是"活的"，1280×720+软渲染会自己降档而按住 AA —— 那是另一条
  // 硬约束（QOS 联动，下面单独测）。这里先锁 'high' 让 QOS 不动，测 AA 自己的升档。
  await R.page.evaluate(() => window.__garden.setQualityMode('high'));
  const b0 = await R.page.evaluate(() => window.__garden.aaState());
  check('前提[R]：AA 处于可自适应（allowed=true / enabled=true）',
    b0.allowed === true && b0.enabled === true, `allowed=${b0.allowed} enabled=${b0.enabled}`);
  check('起始为基础倍率（未升采样）', b0.step === 0, JSON.stringify(b0));

  await stillFrames(R.page, STILL_FRAMES);
  const b1 = await R.page.evaluate(() => window.__garden.aaState());
  check(`[R] 相机静止时倍率逐级上升（≥${STILL_FRAMES} 帧）`,
    realRiseHolds(b1), JSON.stringify(b1));
  check('[R] 倍率不超过上限', b1.scale <= b1.maxScale + 1e-6, `scale=${b1.scale} max=${b1.maxScale}`);
  check('[R] 实际像素比与配置同步（且不突破像素预算）',
    Math.abs(b1.pixelRatio - Math.min(b1.baseScale * b1.qosScale * b1.scale, b1.budgetCap)) < 1e-6,
    `pr=${b1.pixelRatio} base=${b1.baseScale} qos=${b1.qosScale} scale=${b1.scale} cap=${b1.budgetCap}`);
  check('[R] 升档后像素数不超预算',
    (1280 * b1.pixelRatio) * (720 * b1.pixelRatio) <= b1.pixelBudget + 1,
    `${Math.round(1280*b1.pixelRatio*720*b1.pixelRatio)} ≤ ${b1.pixelBudget}`);

  // 相机一动：立刻回落（在 45 帧升档周期内读，确保测的是"回落"而不是"又升回来"）
  await R.page.evaluate(() => { const g = window.__garden; g.camera.position.x += 3; g.controls.update(); });
  await stillFrames(R.page, 3);
  const b2 = await R.page.evaluate(() => window.__garden.aaState());
  check('[R] 相机一动立即回落（无拖影等待）', realFallbackHolds(b2), JSON.stringify(b2));

  // 低档不上探：性能档不参与渐进升采样
  await R.page.evaluate(() => window.__garden.setQualityMode('performance'));
  await stillFrames(R.page, STILL_FRAMES);
  const b3 = await R.page.evaluate(() => window.__garden.aaState());
  check('[R] 性能档不参与渐进升采样（连静止 120 帧仍 step0）',
    b3.step === 0 && b3.mode === 'performance', JSON.stringify(b3));

  // 与 QOS 联动：QOS 降档后渐进升采样应被压制
  await R.page.evaluate(() => window.__garden.setQualityMode('high'));
  await stillFrames(R.page, STILL_FRAMES);
  const b4 = await R.page.evaluate(() => window.__garden.aaState());
  check('前提[R]：联动测试前 AA 已确实升档', b4.step >= 2, JSON.stringify(b4));
  await R.page.evaluate(() => { const g = window.__garden; g.setQos(g.qualityState().maxLevel); g.camera.position.x += 3; g.controls.update(); });
  await stillFrames(R.page, 3);
  const b5 = await R.page.evaluate(() => ({ aa:window.__garden.aaState(), q:window.__garden.qualityState() }));
  check('[R] QOS 已降档时不再升采样', realFallbackHolds(b5.aa),
    `qos L${b5.q.level} aa=${JSON.stringify(b5.aa)}`);

  // 负例自检：判据必须能抓"AA 不升档"
  expectRed('AA 不升档①（合成：停在 step0）', realRiseHolds,
    { step:0, scale:1, maxScale:1.36, pixelRatio:1.25, baseScale:1.25, qosScale:1, budgetCap:3.07 });
  expectRed('AA 不升档②（合成：只升到 1 档）', realRiseHolds,
    { step:1, scale:1.18, maxScale:1.36, pixelRatio:1.475, baseScale:1.25, qosScale:1, budgetCap:3.07 });
  expectRed('AA 升档但像素比与配置脱钩（pr 被写坏）', realRiseHolds,
    { step:2, scale:1.36, maxScale:1.36, pixelRatio:0.90, baseScale:1.25, qosScale:1, budgetCap:3.07 });
  expectRed('回落判据不为永真（合成：仍停在 step1）', realFallbackHolds,
    { step:1, scale:1.18, pixelRatio:1.475, baseScale:1.25, qosScale:1, budgetCap:3.07 });
  // 现场构造违规态：关掉作者开关 ⇒ AA 确实不升档 ⇒ realRiseHolds 必须红
  await R.page.evaluate(() => window.__garden.setQualityMode('high'));
  const off = await R.page.evaluate(() => window.__garden.aaSetEnabled(false));
  await stillFrames(R.page, STILL_FRAMES);
  const b6 = await R.page.evaluate(() => window.__garden.aaState());
  check('负例自检：真机下关掉开关后 AA 确实不升档（判据会红）',
    realRiseHolds(b6) === false && b6.step === 0,
    `step=${b6.step} allowed=${b6.allowed} setEnabled返回.allowed=${off.allowed}`);
  check('负例自检：关开关的原因可读（allowed=false 而 immune=false ⇒ 是开关不是免疫）',
    b6.allowed === false && b6.immune === false, `allowed=${b6.allowed} immune=${b6.immune}`);
  // 可逆：同一条判据在开关恢复后必须重新为真 —— 证明上一条不是"判据本来就假"
  await R.page.evaluate(() => window.__garden.aaSetEnabled(true));
  await stillFrames(R.page, STILL_FRAMES);
  const b7 = await R.page.evaluate(() => window.__garden.aaState());
  check('[R] 重新开开关后恢复升档（可逆 ⇒ 上一条确实是被开关压住的）',
    realRiseHolds(b7), JSON.stringify(b7));

  /* ══ [B] 4K 像素预算护栏：AA 升档不得突破 pixelBudget ══════════════════ */
  console.log('\n[B] 4K + high：AA 顶档会被像素预算 clamp（护栏回归）');
  const B = await open(browser, port, { mockReal:true, width:3840, height:2160 });
  await B.page.evaluate(() => window.__garden.setQualityMode('high'));
  const c0 = await B.page.evaluate(() => window.__garden.aaState());
  // 前提断言：clamp **必须真的在咬** —— 否则下面的断言在 1080p 那种档位上是空转的
  check('前提[B]：该视口下 clamp 确实在咬（base×maxScale > 预算上限）',
    c0.baseScale * c0.maxScale > c0.budgetCap + 1e-6,
    `base=${c0.baseScale} ×max=${c0.maxScale} = ${(c0.baseScale*c0.maxScale).toFixed(4)} > cap=${c0.budgetCap}`);
  await stillFrames(B.page, STILL_FRAMES);
  const c1 = await B.page.evaluate(() => window.__garden.aaState());
  const px = (3840 * c1.pixelRatio) * (2160 * c1.pixelRatio);
  const naive = c1.baseScale * c1.qosScale * c1.scale;   // 不 clamp 的旧写法
  check('前提[B]：AA 已确实升档（否则预算断言测不到升档路径）', c1.step >= 1, JSON.stringify(c1));
  check('[B] 升档后像素比 ≤ 预算上限', c1.pixelRatio <= c1.budgetCap + 1e-6,
    `pr=${c1.pixelRatio} cap=${c1.budgetCap}`);
  check('[B] 升档后像素数 ≤ pixelBudget', px <= c1.pixelBudget + 1, `${Math.round(px)} ≤ ${c1.pixelBudget}`);
  check('[B] 像素比精确等于 min(base×qosScale×scale, cap)', budgetHolds(c1),
    `pr=${c1.pixelRatio} 未 clamp 会是 ${naive.toFixed(4)}`);
  check('[B] clamp 确实做了事（不 clamp 的话会越界）', naive > c1.budgetCap + 1e-6,
    `未 clamp=${naive.toFixed(4)} > cap=${c1.budgetCap.toFixed(4)}（越界 ${(naive/c1.budgetCap).toFixed(3)}×）`);
  // 负例自检：判据必须能抓"超预算"和"算错倍率"
  expectRed('超预算（pr 越过 cap）', budgetHolds,
    { pixelRatio:1.2091, budgetCap:1.0247, baseScale:1.0247, qosScale:1, scale:1.18 });
  expectRed('算错倍率（pr 低于应然值）', budgetHolds,
    { pixelRatio:1.0000, budgetCap:1.0247, baseScale:1.0247, qosScale:1, scale:1.18 });

  check('零 pageerror / console error（[P] + [R] + [B] 三个 context）',
    P.errs.length === 0 && R.errs.length === 0 && B.errs.length === 0,
    [P.errs[0], R.errs[0], B.errs[0]].filter(Boolean).join(' | '));

  await browser.close(); server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[aa-progressive-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[aa-progressive-guard] 探针异常：', e); process.exit(2); });
