// 丁达尔体积光门禁（2026-09-22 补齐 R-8）。
//   背景：灯笼的体积光 2026-09-21 做过一次**形态修正** —— 从"开口向下的 ConeGeometry
//         （灯口→地面收窄）"改成"球形弥散光团"（旧形态被读成路灯/舞台聚光，是工业感）。
//         形态退化**不报错、不崩、不影响任何别的断言**，只有几何类型与像素能分辨。
//   本门守五件事：
//     ① 归属：5 盏灯各挂 1 光团 + 1 光斑（数量与 lanternSpots 一致），且只在高档位挂；
//     ② 形态：几何必须是 **SphereGeometry**、基半径 1（否则 volR 不再是世界半径）；
//             光团**套在灯体上**（在挂点下方，不是挂在挂点上）；光斑是平躺的圆形；
//     ③ 联动：uLamp 随时段（夜>0、正午=0）、uRain 随天气（雨>0）、色温偏暖不成冷白，
//             且**地面光斑**那份材质也要跟着走（它漏跟时段时白天不会透明，状态上看不出来）；
//     ④ 取景：镜头距离 = 设计的最小距离（OrbitControls 每帧夹取，写 4m 会被弹回 9m）；
//     ⑤ 行为（阳性对照）：夜下**只**把光团的 uLamp 归零 → 灯周那块像素必须变暗。
//   ⚠️ 必须带 ?tier=high：核显档 WITH_VOL=false，压根不挂光团（属设计而非缺陷）。
//   ⚠️ 阳性对照的三条硬约束（都是踩出来的，不是洁癖）：
//      a) **窗口要对准光团球心**：`lanternGroups` 存的是挂点 pivot，比灯体高一整段吊绳，
//         拿它取景会把采样框摆到光团上方 —— 差分自然量不到（实测窗口偏 45px）；
//      b) **必须冻风**：风摆叶片与灯笼单摆制造的局部帧间噪声高达 5.1 luma，是信号(1.45)的
//         3.5 倍；不冻风就只能靠运气（同一份代码两次跑，方向判据一次对一次错）。
//         冻风后噪声 0.27（降 18.6×）⇒ 差分才能归因给光团；
//      c) **还原判据要比 luma，不能比像素**：光团 shader 自带湍流花纹（uTime 驱动），
//         开灯状态下两张图天然对不上（实测 1.24），比像素必假红。
// usage: node probe/lampvol-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';
import { decodePNG, meanAbsDiff, meanLuma } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', 'visual');
fs.mkdirSync(OUT, { recursive: true });
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra) => { results.push({ label, ok }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };

const LANTERNS = 5;   // 与 12-env.js 的 lanternSpots 条数成对出现（堂前 2 + 游廊 3）
const W = 1280, H = 720;

/* 以 (cx,cy) 为心、半径 r 的方块平均亮度 */
function boxLuma(img, cx, cy, r) {
  const { w, h, bpp, data } = img;
  const x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
  let s = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * bpp;
    s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++;
  }
  return n ? s / n : 0;
}
/* 同一块窗、两张图的平均绝对差 */
function boxDiff(a, b, cx, cy, r) {
  const { w, h, bpp } = a;
  const x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
  let s = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * bpp;
    s += (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3; n++;
  }
  return n ? s / n : 0;
}
const CELL = 80;   // 差分热点用 80×80px 栅格定位

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(200000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  /* ⚠️ 等"装配完成"信号，别猜时间（2026-09-24，同 mist-guard 的竞态）：
     `loading.done` 在**延迟批之前**就触发（deferBoot 是"每帧一个 job"），柳/竹/立峰要 ~1.0~1.1s
     才陆续进场景。原来这里只 `sleep(1200)` 赌它跑完 ⇒ 慢一点就会在**物件还在进场时**采样，
     体积光的像素 ROI 随之漂移（这正是项目里"全链红在某一门、单跑全绿"那类记录的成因之一）。 */
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await sleep(1200);                                  // 再让首帧后的光照/雾稳定一下
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 60000, polling: 200 }).then(() => true).catch(() => false);
  const st = () => page.evaluate(() => window.__garden.lampVolState());
  const setEnv = (time, season, weather) => page.evaluate((a) => {
    const g = window.__garden; g.setEnv('time', a[0]); g.setEnv('season', a[1]); g.setEnv('weather', a[2]);
  }, [time, season, weather]);
  /* ⚠️ 把水面反射钉成"每帧刷"（2026-09-24）：本门的热点判据要**全幅**找"差分最强格"，
     而"反射按需更新"会让水面像素带 ≤3 帧旧倒影（那是另一个子系统的设计行为，见 05-water 的注释）
     ⇒ 水面会造出与光团无关的**假热点**：实测热点跑到 (1200,560) 值 3.71，而光团格是 (640,320)，
     且两次跑数值完全相同（确定性，不是瞬时噪声）⇒ 是"水面刷新相位"这一个变量。
     用产品自带的覆盖开关把它钉住（长曝光路径也用同一个开关），本门只量**光团**。
     ⚠️ 反射的"按需降频"本身由 probe/reflect-adaptive.mjs 守，别在这里断言。 */
  await page.evaluate(() => {
    const w = window.__garden.scene.getObjectByName('waterSurface');
    if (w) w.userData.reflectEveryFrame = true;
  });

  /* ── ① 归属与形态 ── */
  await setEnv('night', 'winter', 'clear'); await settled(); await sleep(900);
  const S = await st();
  check('灯笼支点数与设计一致（堂前 2 + 游廊 3）', S.volCount === LANTERNS, `lanternGroups=${S.volCount}`);
  check('光团球心数与灯数成对（5 个世界球心可回读）', (S.volPos || []).length === LANTERNS, `volPos=${(S.volPos || []).length}`);
  /* 认"堂前灯"必须用 **pivot 的局部坐标**（= lanternSpots 里的静态布点），
     不能用光团的世界坐标 —— 灯笼在风里单摆，世界 z 会摆出 ±0.2m，
     上一版按 `|z+7.1|<0.02` 认灯，正好赶上摆动相位就一只都认不出来。 */
  const hall = await page.evaluate(() => window.__garden.lanternGroups
    .map((p, i) => [i, p.position.z]).filter(([, z]) => Math.abs(z + 7.1) < 0.01).map(([i]) => i));
  check('找到堂前灯（静态布点 z=−7.1）用于取景', hall.length === 2, `hall idx=${hall.join(',')||'无'}`);
  check('高档位下体积光材质与光团/光斑均已挂载', S.on === true && S.mounted === true,
    `on=${S.on} mounted=${S.mounted}`);
  check('5 盏灯各挂 1 个光团、1 个光斑', S.volCount === LANTERNS && S.splashCount === LANTERNS,
    `光团=${S.volCount} 光斑=${S.splashCount}`);
  /* 核心形态判据：退回"向下聚光锥"（ConeGeometry）必须红 */
  check('光团几何 = 球形弥散（SphereGeometry，不是向下收窄的 ConeGeometry）',
    S.volGeo === 'SphereGeometry', `volGeo=${S.volGeo}`);
  check('光团基几何半径 = 1（volR 才等于世界半径；基半径被改则半径判据静默失义）',
    S.volGeoR === 1, `volGeoR=${S.volGeoR}`);
  check('光团世界半径在合理区间（0 < r ≤ 0.85，拢着灯笼不吞掉整盏）',
    !!S.volR && S.volR.min > 0 && S.volR.max <= 0.85, JSON.stringify(S.volR));
  /* 光团必须**套在灯体上**：它是 `grp`（灯体，含吊绳）的子级，而 lanternGroups 存的 pivot
     是挂点。若有人把光团改挂到 pivot 上 → 光团飘到吊绳顶端、灯身裹不住，画面看着"灯上方有团雾"，
     不报错、不影响任何状态断言，只有场景图结构能分辨。
     ⚠️ 判据取自**同级的点光源**（`spot` 也挂在 grp 上、位于灯体中心 local y=−0.21），
     而不是"离挂点多少米"—— 后者要从注释里的绳长去推，实测堂前 1.51m 会让拍脑袋写的 1.5 假红。 */
  const tie = await page.evaluate((a) => a.idx.map(i => {
    const piv = window.__garden.lanternGroups[i];
    let vol = null, spot = null;
    piv.traverse(o => { if (o.name === 'lampVol') vol = o; if (o.isPointLight) spot = o; });
    if (!vol || !spot) return { ok: false, why: `灯${i} 图上缺件 vol=${!!vol} spot=${!!spot}` };
    return { ok: true, same: vol.parent === spot.parent, d: +(vol.position.y - spot.position.y).toFixed(3) };
  }), { idx: hall });
  /* ⚠️ `.every()` 对**空数组恒真** —— 认灯失败时这两条会假绿，故先钉死样本数 */
  const tied = tie.length === hall.length && hall.length === 2 && tie.every(t => t.ok);
  check('光团与灯内点光源同属"灯体"层（同一父级）—— 防光团被改挂到挂点 pivot',
    tied && tie.every(t => t.same === true),
    tied ? tie.map(t => t.same ? '同父级 ✓' : '父级不同 ✗').join(' · ')
         : `图上找不到光团/光源：${tie.map(t => t.why || '未知').join(' / ')}`);
  check('光团球心与灯内光源同高（|Δ局部 y| ≤ 0.25m）—— 防光团在灯体上飘走',
    tied && tie.every(t => Math.abs(t.d) <= 0.25),
    tied ? `Δ局部 y = ${tie.map(t => t.d).join(', ')} m（设计 0.17）` : '取样失败（见上一条）');
  check('地面光斑 = 圆形且平躺（CircleGeometry + rotation.x=−π/2）',
    S.splashGeo === 'CircleGeometry' && S.splashFlat === true,
    `splashGeo=${S.splashGeo} flat=${S.splashFlat}`);

  /* ── ② 联动：时段 / 天气 / 色温 ── */
  check('夜：光团 uLamp > 0（体光在亮）', S.uLamp > 0, `uLamp=${S.uLamp}`);
  check('夜：地面光斑 uLamp 与光团同步（漏跟时段 → 白天不会透明）',
    S.splashLamp !== null && Math.abs(S.splashLamp - S.uLamp) < 1e-6,
    `光团=${S.uLamp} 光斑=${S.splashLamp}`);
  check('晴：uRain = 0（无散射增强）', S.uRain === 0, `uRain=${S.uRain}`);
  /* 色温：0xFFAA33 → r=255 g=170 b=51，暖橙。防"退化成冷白/纯白" */
  const tint = { r: (S.tint >> 16) & 255, g: (S.tint >> 8) & 255, b: S.tint & 255 };
  check('色温偏暖（R>G>B 的烛火橙，不是冷白/纯白）',
    tint.r > tint.g && tint.g > tint.b && !(tint.r === 255 && tint.g === 255 && tint.b === 255),
    `tint=#${S.tint.toString(16).padStart(6, '0')} rgb(${tint.r},${tint.g},${tint.b})`);
  const t1 = (await st()).uTime;
  await sleep(700);
  const t2 = (await st()).uTime;
  check('uTime 在推进（tickLampVol 接线在，湍流/微尘才会呼吸）', t2 > t1, `uTime ${t1} → ${t2}`);

  await setEnv('noon', 'winter', 'clear'); await settled(); await sleep(900);
  const noon = await st();
  check('正午：光团 uLamp = 0（白天等效空 mesh，不白烧）', noon.uLamp === 0, `uLamp=${noon.uLamp}`);
  check('正午：地面光斑 uLamp 同样归零', noon.splashLamp === 0, `splashLamp=${noon.splashLamp}`);

  await setEnv('night', 'winter', 'storm'); await settled(); await sleep(900);
  const rain = await st();
  check('雨夜：uRain > 0（空气颗粒多 → 丁达尔光团更显形）', rain.uRain > 0, `uRain=${rain.uRain}`);
  check('雨夜：地面光斑 uRain 与光团同步', Math.abs(rain.splashRain - rain.uRain) < 1e-6,
    `光团=${rain.uRain} 光斑=${rain.splashRain}`);

  /* ── ③ 取景：按设计的最小距离，别写 4m（会被 OrbitControls 每帧弹回） ── */
  await setEnv('night', 'winter', 'clear'); await settled(); await sleep(1000);
  const aim = (await st()).volPos[hall[0]];   // 取景前重读：光团世界坐标随灯笼摆动在变
  const view = await page.evaluate((a) => {
    const g = window.__garden, T = g.THREE;
    const t = new T.Vector3(a.pos[0], a.pos[1], a.pos[2]);
    g.controls.target.copy(t);
    g.camera.position.set(t.x, t.y, t.z + a.back);      // 与光团等高平视
    g.camera.lookAt(t); g.controls.update();
    const dist = g.camera.position.distanceTo(t);
    const p = t.clone().project(g.camera);
    const pxPerM = (window.innerHeight / 2) / (Math.tan(g.camera.fov * Math.PI / 360) * dist);
    return { dist: +dist.toFixed(3), minDist: g.camMinDist(), ctrlMin: g.controls.minDistance,
      sx: Math.round((p.x * 0.5 + 0.5) * window.innerWidth),
      sy: Math.round((-p.y * 0.5 + 0.5) * window.innerHeight), pxPerM: +pxPerM.toFixed(1) };
  }, { pos: aim, back: await page.evaluate(() => window.__garden.camMinDist()) });
  check('镜头距离 = 设计最小距离（camMinDist 与 OrbitControls 一致，无静默夹取）',
    Math.abs(view.dist - view.minDist) < 0.05 && view.ctrlMin === view.minDist,
    `实际 ${view.dist}m · camMinDist=${view.minDist} · controls.minDistance=${view.ctrlMin}`);
  const rWin = Math.round(view.pxPerM * S.volR.max * 1.4);
  console.log(`  · 取景：光团球心投影 (${view.sx},${view.sy})，${view.pxPerM}px/m ⇒ 采样框 r=${rWin}px`);
  await sleep(900);

  /* ── ④ 阳性对照：只改光团 uLamp ── */
  const shot = () => page.screenshot();
  const box = { x: view.sx, y: view.sy, r: rWin };
  const loc = (img) => boxLuma(img, box.x, box.y, box.r);

  /* (a) 有风基准（**只打印，不判**）：风是主噪声源这件事得让人看见，但它本身是**阵发**的
     （gust 每 ~2s 来一波），拿 600ms 单次采样当判据必然时红时绿 —— 上一版就是这么翻车的：
     同机两次跑，一次"有风 5.10 → 冻风 0.27"，一次"有风 0.31 → 冻风 0.59"，正负都出现过。 */
  const w1 = await shot(); await sleep(600); const w2 = await shot();
  const noiseWind = boxDiff(decodePNG(w1), decodePNG(w2), box.x, box.y, box.r);

  /* (b) 隔离混杂：冻风（灯笼单摆 + 叶片风场）+ 冻住光团自身的湍流时钟（uTime）。
     ⚠️ 判据用**确定性回读**（连读 6 帧必须恒为 0），不用"噪声降了 N 倍"这种统计话术 ——
     回写压在渲染循环之上这件事，只有直接读才证明得了。 */
  const froze = await page.evaluate(() => {
    const g = window.__garden, W_ = g.WIND;
    if (!W_ || !W_.uWindGlobal || !W_.uWindStrength) return { ok: false, why: 'WIND 未暴露' };
    const freeze = (u, v) => Object.defineProperty(u, 'value', { get: () => v, set: () => {}, configurable: true });
    freeze(W_.uWindGlobal, 0); freeze(W_.uWindStrength, 0);
    let vm = null; g.scene.traverse(o => { if (o.name === 'lampVol') vm = o; });
    if (!vm) return { ok: false, why: '场景里找不到名为 lampVol 的网格' };
    freeze(vm.material.uniforms.uTime, vm.material.uniforms.uTime.value);
    return { ok: true };
  });
  check('风场与光团湍流时钟可冻结（阳性对照的隔离前提）', froze.ok === true,
    froze.why || 'WIND.uWindGlobal / uWindStrength + lampVol.uTime 已 pin');
  await sleep(1100);
  const windAt = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      await new Promise(r => requestAnimationFrame(r));
      out.push([window.__garden.WIND.uWindGlobal.value, window.__garden.WIND.uWindStrength.value]);
    }
    return out;
  });
  check('冻结生效：连读 6 帧风力恒为 0（渲染循环每帧回写也压不住）',
    windAt.length === 6 && windAt.every(p => p[0] === 0 && p[1] === 0),
    `${windAt.length} 帧采样，首帧=${JSON.stringify(windAt[0])} 末帧=${JSON.stringify(windAt[windAt.length - 1])}`);

  /* (c) ABAB 交错采样：每组"开/关"只隔 ~420ms，环境（萤火/浮尘/雾）几乎没变，
     配对差分就把光团单独拎出来（相敏检波）；再取中位数，防偶发一闪污染结论。
     ⚠️ N 从 6 提到 12（2026-09-24）：只有 6 个样本时 MAD 本身就很抖 —— 同一份代码连跑三次，
     σ 被估成 0.099 / 0.227 / 0.459（4.6 倍波动），而信号稳定在 1.36~1.79
     ⇒ 判据红绿由 **σ 的抖动**决定，不是信号。样本翻倍让中位数与 MAD 都稳得多。 */
  const N = 12;
  const lampOn = (await st()).uLamp;
  const shotOn = async () => { await page.evaluate(v => window.__garden.setLampVol(v), lampOn); await sleep(420); return page.screenshot(); };
  const shotOff = async () => { await page.evaluate(() => window.__garden.setLampVol(0)); await sleep(420); return page.screenshot(); };
  const ON = [], OFF = [];
  for (let i = 0; i < N; i++) { ON.push(decodePNG(await shotOn())); OFF.push(decodePNG(await shotOff())); }
  const backBuf = await shotOn();
  const BK = decodePNG(backBuf);
  fs.writeFileSync(path.join(OUT, 'lampvol-on.png'), backBuf);
  await page.evaluate(() => window.__garden.setLampVol(0)); await sleep(420);
  fs.writeFileSync(path.join(OUT, 'lampvol-off.png'), await page.screenshot());
  await page.evaluate(v => window.__garden.setLampVol(v), lampOn);

  const med = a => { const s = [...a].sort((p, q) => p - q); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const lumaOn = ON.map(loc), lumaOff = OFF.map(loc);
  /* ── 估计量换成**配对差分**（2026-09-24 做硬；判据与阈值一个字没改）──
     原来：dLoc = 两组各自中位数相减，σ = 两组残差**合并**后的 1.4826×MAD。
     问题：合并残差把**共模慢漂**（雾/萤火/风/环境光的缓慢起伏）也算进噪声。实测第 1 次的
     逐样本值：开组第 4/5 个偏低（90.41/90.64）的同时，关组第 3/4 个也偏低（88.87/88.81）
     —— 两组一起漂 ⇒ σ 被抬到 0.459，判据贴边（1.364 vs 3×0.459=1.377）而误红。
     而"ABAB 交错采样"的**本意**正是让同一次开/关只差 ~420ms、把慢漂变成共模 ——
     改成逐对相减，共模在相减时抵消，σ 只反映"同一对之间"的噪声：
       dPairs[i] = lumaOn[i] − lumaOff[i]  ⇒  dLoc = med(dPairs)，σ = 1.4826×MAD(dPairs)
     ⚠️ 这是**换估计量**，不是放水：光团若真不贡献像素（缺陷态），逐对差全会趋 0 ⇒ 照样红；
        而共模漂移不再能把真实信号淹没。 */
  const dPairs = lumaOn.map((v, i) => v - lumaOff[i]);
  const dLoc = med(dPairs);
  const sigma = 1.4826 * med(dPairs.map(v => Math.abs(v - dLoc)));
  const sigLoc = boxDiff(ON[0], OFF[0], box.x, box.y, box.r);     // 信号（局部像素）
  const sigAll = meanAbsDiff(ON[0], OFF[0]);                      // 信号（全幅像素）
  check('阳性对照：夜下把光团 uLamp 归零，灯周那块确实变暗（光团在贡献像素）',
    dLoc > 0.5 && dLoc > sigma * 3,
    `局部 luma ${med(lumaOn).toFixed(2)} → ${med(lumaOff).toFixed(2)}（差 ${dLoc.toFixed(3)}；同状态稳健 σ≈${sigma.toFixed(3)} ⇒ ${(dLoc / (sigma || 1e-6)).toFixed(1)}σ）`);
  console.log(`  · 逐样本局部 luma：开 [${lumaOn.map(v => v.toFixed(2)).join(', ')}] / 关 [${lumaOff.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(`  · 逐对差（配对差分）：[${dPairs.map(v => v.toFixed(2)).join(', ')}]（中位 ${dLoc.toFixed(3)}，MAD σ ${sigma.toFixed(3)}）`);
  check('光团是**局部**现象，不是全屏加了一层（局部窗信号 ≥5× 全幅均值）',
    sigLoc > sigAll * 5, `局部 ${sigLoc.toFixed(3)} vs 全幅 ${sigAll.toFixed(3)}（${(sigLoc / (sigAll || 1e-6)).toFixed(1)}×）`);
  /* 热点定位（2026-09-24 做硬）：差分最强的那一格必须落在光团所在格（±1 格）。
     ⚠️ 原来只拿 **单对** ON[0]/OFF[0] 全幅找最强格 —— 单对会被瞬时噪声（萤火/浮尘/雾絮
        恰好扫过别的格，同状态噪声 0.27~0.46）顶上去：别的格真值只差零点几，瞬时粒子
        一叠就把"最强格"顶到别处 ⇒ 时红时绿。按项目既定方针把**统计量**做硬（不是抬容差）：
        每格取 **12 对样本的差分中位数**（同 mist-guard 多帧中位数的思路）—— 瞬时粒子被
        中位数吃掉，判据意图（最强差分格 = 光团所在格、别处没有假光）一个字没变。
        顺带报出"次强格"的值与领先量，红了好定位（多灯笼 setLampVol 是全局的，
        游廊 3 盏一起灭、它们的格有真实差分，贴边时先看这里）。 */
  const hot = (() => {
    let best = { v: -1, x: 0, y: 0 }, second = { v: -1, x: 0, y: 0 };
    for (let gy = 0; gy < H; gy += CELL) for (let gx = 0; gx < W; gx += CELL) {
      const cxp = Math.min(W - 1, gx + CELL / 2), cyp = Math.min(H - 1, gy + CELL / 2);
      const v = med(ON.map((im, i) => boxDiff(im, OFF[i], cxp, cyp, CELL / 2)));
      if (v > best.v){ second = best; best = { v, x: gx, y: gy }; }
      else if (v > second.v) second = { v, x: gx, y: gy };
    }
    return { ...best, secondV: second.v, secondAt: [second.x, second.y] };
  })();
  const cxCell = Math.floor(box.x / CELL) * CELL, cyCell = Math.floor(box.y / CELL) * CELL;
  check('差分热点落在光团所在格（±1 格）——光团没挂错位置，别处也没有假光',
    Math.abs(hot.x - cxCell) <= CELL && Math.abs(hot.y - cyCell) <= CELL,
    `热点 (${hot.x},${hot.y}) 值 ${hot.v.toFixed(2)} · 光团格 (${cxCell},${cyCell})` +
    ` · 次强格 (${hot.secondAt.join(',')}) 值 ${hot.secondV.toFixed(2)}（领先 ${(hot.v - hot.secondV).toFixed(2)}）`);
  /* ⚠️ 还原判据比 luma 不比像素：光团 shader 自带 uTime 湍流花纹，开灯两张图天然对不上 */
  check('还原 uLamp 后亮度回到开灯态（|Δluma| < 信号一半，非单向漂移）',
    Math.abs(loc(BK) - med(lumaOn)) < Math.abs(dLoc) / 2,
    `还原 ${loc(BK).toFixed(2)} vs 开灯 ${med(lumaOn).toFixed(2)}（差 ${Math.abs(loc(BK) - med(lumaOn)).toFixed(3)} vs 信号 ${Math.abs(dLoc).toFixed(3)}）`);
  console.log(`  · 噪声对照（不判）：有风局部差 ${noiseWind.toFixed(3)} / 冻结后稳健 σ≈${sigma.toFixed(3)}（差 ${(noiseWind / (sigma || 1e-6)).toFixed(1)}×）`);

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[体积光] ${results.length - failed.length}/${results.length} 项通过 · 样张 ${OUT}/lampvol-*.png`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[lampvol-guard] 崩溃:', e); process.exit(2); });
