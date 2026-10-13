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
// ── 2026-10-12 局部性判据换度量（第 ⑤ 件事之外）────────────────────────────
//   旧量 mean|Δ| 量的是像素级抖动而不是"抬亮"（实测 87% 是 uTime 湍流细结构），两次跑差
//   123%（9.729/4.355）⇒ 不可复现。现改为**有向亮度位移**：liftNear(r≤BR) vs
//   liftFar(r>1.25×BR)，判据 `liftFar ≤ liftNear/5`（阈值 5× 未动），并自带两条：
//     · 门内可复现性自证（同状态两半各取中位，|Δlift| ≤ 25%×liftNear）；
//     · 放大 vol.scale 的**可驱动负例**（硬前提 —— 没有它，新度量只是"没人验过有牙"）。
//   · 砍掉的候选（留档，勿悄悄加回）：`liftFar ≤ 3σ_far` 那颗第二牙 —— 同轮纪律是
//     「每加一条判据就多一个可能不可证伪的红」；一颗牙、但每次跑都自证有牙。
//   · 待办（本轮未动、不夹带）：阳性对照的取样框落在**灯体不透明部分**上（58px 窗量到
//     1.23 luma，而光团投影内整体 5.81）—— 改它要重标定阳性对照的阈值。
// usage: node probe/lampvol-guard.mjs
//   ⚠️ 门控口径（2026-10-12 写死，防"以为跑了其实静默跳过"）：
//      本门的**全部判据无条件执行**，不受任何环境变量门控 —— 每次单跑都全跑。
//      下面三处 env 只门控**默认关闭的诊断输出**，都不参与任何 check()：
//        · LAMPVOL_AB=1          —— A/B 双对照（bloom.strength ×4 / PointLight.distance→200），只打印；
//        · LAMPVOL_NEG_INJECT=1  —— "注入层出像素"自检（两帧都挂、差分抵消，故意默认关），只打印；
//        · LAMPVOL_NO_ISOLATE=1  —— 逃生阀：跳过烟花/风场隔离（默认是**执行**隔离 ⇒ 默认关＝更严）。
//      启动时会打印这三个开关的实际状态（"诊断开关"那一行）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
/* ⚠️ meanAbsDiff 已在本文件退场（2026-10-12 局部性判据换度量后无人再用）—— 顺手摘掉，
   免得下一个人以为还有谁在用它。meanLuma 是更早留下的未用项，不属本轮，未动。 */
import { decodePNG, meanLuma } from './_png.mjs';

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

/* 门控自证（2026-10-12）：不设变量 ≠ 静默跳过判据。全部 check() 无条件执行，
   下面三处 env 只影响诊断输出；启动即打印实际开关，日志里一眼可核。 */
console.log('· 诊断开关：LAMPVOL_AB=' + (process.env.LAMPVOL_AB === '1' ? '开' : '关')
  + ' · LAMPVOL_NEG_INJECT=' + (process.env.LAMPVOL_NEG_INJECT === '1' ? '开' : '关')
  + ' · LAMPVOL_NO_ISOLATE=' + (process.env.LAMPVOL_NO_ISOLATE === '1' ? '开(跳过隔离)' : '关(执行隔离)')
  + ' —— 判据条数不受影响，只少/多诊断读数。');

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
/* ── 有向亮度位移（ON − OFF 的 luma 均值）────────────────────────────────────
   ⚠️ 为什么不能用 mean|Δ|（旧版局部性判据的签名量）：实测同一核窗里
   |有向 lift| = 1.233 而 mean|Δ| = 9.457 ⇒ **87% 的绝对差是光团自身 uTime 湍流细结构
   在像素间跳**，只有 13% 是真正的抬亮。湍流在均值上下对称地加亮/加暗 ⇒ 有向和把它相消，
   绝对和把它全留下 —— 这就是旧量两次跑差 123%（9.729/4.355）而同门 dLoc 只差 2%
   （1.359/1.384）的全部原因。判据问的是"整幅有没有被均匀抬亮"，那是个**有符号**量。 */
function signedLift(a, b, cx, cy, r0, r1) {
  const { w, h, bpp } = a;
  const r0q = r0 * r0, r1q = r1 === Infinity ? Infinity : r1 * r1;
  let s = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 < r0q || d2 >= r1q) continue;
    const i = (y * w + x) * bpp;
    s += (0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2])
       - (0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2]);
    n++;
  }
  return { lift: n ? s / n : 0, n };
}
/* 圆盘内像素数（算"光团占画面多少"用；带画面裁剪） */
function discPixels(w, h, cx, cy, r) {
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) n++; }
  return n;
}
const CELL = 80;   // 差分热点用 80×80px 栅格定位

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(200000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });
  /* ⚠️ 等"装配完成"信号，别猜时间（2026-09-24，同 mist-guard 的竞态）：
     `loading.done` 在**延迟批之前**就触发（deferBoot 是"每帧一个 job"），柳/竹/立峰要 ~1.0~1.1s
     才陆续进场景。原来这里只 `sleep(1200)` 赌它跑完 ⇒ 慢一点就会在**物件还在进场时**采样，
     体积光的像素 ROI 随之漂移（这正是项目里"全链红在某一门、单跑全绿"那类记录的成因之一）。 */
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await sleep(1200);                                  // 再让首帧后的光照/雾稳定一下
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    null, { timeout: 60000, polling: 200 }).then(() => true).catch(() => false);
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
  /* ⚠️ 前提断言（2026-09-27 补）：本门测的一切都建立在"高档位真的挂上了光团"之上 ——
     12-env 的 `const WITH_VOL = ACTIVE_QUALITY.volume` 只在 high 档为真，low/mid 档
     5 盏灯**一盏都不挂**（属设计的降级，不是缺陷）。
     而本机 ANGLE 常落在 **Intel Iris Xe = low 档** ⇒ 若 `?tier=high` 因任何原因失效
     （query 被 SW 吞、模块在导航前求值、URL 拼错），下面所有判据都会在"光团根本不存在"
     的前提下运行 ⇒ 报出一堆看似合理的红，把人引去改本来正确的产品。
     实测过：`?tier=high` 生效时 volCount=5、不带 tier 时 volCount=0 —— 差别就是这样大。 */
  const tierOK = await page.evaluate(() => {
    const g = window.__garden;
    const search = location.search;
    const forced = /[?&]tier=(low|mid|high)/.exec(search)?.[1] || null;
    return { search, forced, volCount: g.lampVolState().volCount };
  });
  check('前提：?tier=high 真的生效（否则光团压根不挂，后面全在错误前提下跑）',
    tierOK.forced === 'high' && tierOK.volCount === LANTERNS,
    `search="${tierOK.search}" forced=${tierOK.forced} volCount=${tierOK.volCount}（应为 high 与 ${LANTERNS}）`);
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
     ⚠️ 判据取自**同级的真光源**，而不是"离挂点多少米"—— 后者要从注释里的绳长去推，
     实测堂前 1.51m 会让拍脑袋写的 1.5 假红。
     ⚠️⚠️ **认光源必须同时接受 PointLight 与 SpotLight**（2026-09-27 修）：
        提交 `ebe99c8`「PMREM 四时段缓存 + 灯笼 SpotLight 投影」把灯笼从 PointLight
        换成了 SpotLight（更贴灯笼向下照的物理，且阴影成本从 6 面降为 1 张），
        但本判据仍写死 `o.isPointLight` ⇒ `spot` 恒为 null ⇒ 报
        「图上缺件 vol=true spot=false」，**两条判据一起假红**。
        实测：`?tier=high` 下 5 盏灯的 `lampVol` **全都在**（volCount=5），产品没缺件，
        是判据没跟上那次改造。这类"判据滞后于产品"的假红最坑 —— 它会让人去改本来正确的产品。 */
  const tie = await page.evaluate((a) => a.idx.map(i => {
    const piv = window.__garden.lanternGroups[i];
    let vol = null, spot = null;
    piv.traverse(o => {
      if (o.name === 'lampVol') vol = o;
      /* 灯笼现役光源是 SpotLight；保留 isPointLight 是为了旧档/旧场景仍能认出来。 */
      if (o.isPointLight || o.isSpotLight) spot = o;
    });
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

  /* ⚠️⚠️ 2026-10-12：**季节必须选允许 storm 的那个**。旧版写 winter —— 而自 942dbbe
     （2026-10-06「冬季禁用狂风暴雨」）起，`12a-presets.js:178` 的 WEATHER_RULES 会拒绝
     「冬 + 狂风暴雨」，并由 `enforceWeather()` 在 setEnv 里**兜底降级回风和日丽**
     （UI 置灰只是提示，键盘/控制台/外部脚本都能绕过按钮 ⇒ 强制点在 setEnv）。
     后果：rainAmount=0 ⇒ `12-env.js:303` 写的 uRain 恒为 0 ⇒ 这条判据从此**恒定红**
     （实跑日志：`✗ 雨夜：uRain > 0 … — uRain=0`）。
     ⚠️ 不用 blizzard（银装素裹）替代：那测的是雪散射，与判据名 uRain 不符。
     ⚠️ 换个季节还不够 —— 必须**先断言前提真的成立**，否则以后再加季节互斥会重演同样的含糊红。 */
  await setEnv('night', 'summer', 'storm'); await settled(); await sleep(900);
  const rainPre = await page.evaluate(() => {
    const g = window.__garden;
    return { weather: g.ENV.weather, season: g.ENV.season, eff: g.effectiveWeather(),
             allowed: g.weatherAllowed('storm'), why: g.weatherMutexReason('storm', g.ENV.season),
             rain: g.ENV.cur.rainAmount };
  });
  check('前提[雨夜]：storm 在当季合法且真的落到画面上（否则 uRain 判据在错误前提下跑）',
    rainPre.allowed === true && rainPre.weather === 'storm' && rainPre.eff === 'storm',
    `季节=${rainPre.season} weather=${rainPre.weather} eff=${rainPre.eff} allowed=${rainPre.allowed}` +
    ` · 互斥原因="${rainPre.why || '无（组合合法）'}"`);
  const rain = await st();
  check('雨夜：uRain > 0（空气颗粒多 → 丁达尔光团更显形）', rain.uRain > 0,
    `uRain=${rain.uRain}（rainAmount=${rainPre.rain}）`);
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
  /* ⚠️⚠️ 2026-10-12：**取样框必须钳成"真的局部"**。
     旧版 `rWin = pxPerM × volR.max × 1.4` —— pxPerM 与相机距离**成反比**，而这条式子
     **没有上限**。取景用的距离是 `camMinDist()`，它已由 9m 改成 **1.6m**
     （`02-scene.js:122`，提交 d2d10ae"相机可达性：最近距离 9m→1.6m"）⇒ 实测
     pxPerM 530.1、**rWin = 497px** —— 1280×720 下这个"局部窗"覆盖 **77.6% 画面**，
     于是「局部窗信号 ≥5× 全幅均值」必然塌成 1.3×（日志原文：
     `· 取景：光团球心投影 (640,381)，530.1px/m ⇒ 采样框 r=497px` /
     `✗ 局部 3.819 vs 全幅 2.980（1.3×）`）。产品侧无缺陷 —— 同次运行阳性对照
     （>3σ）与热点格都绿，光团真的在贡献像素。
     ⇒ 钳到 `min(W,H) × 8%`（720×8% ≈ 57px，覆盖 ≈1.4% 画面）。
     ⚠️ **不改产品常量**（那是把判据架在产品上，正是这次的病根）：改门禁。 */
  const RWIN_MAX_FRAC = 0.08;
  const rWinRaw = Math.round(view.pxPerM * S.volR.max * 1.4);
  const rWinCap = Math.round(Math.min(W, H) * RWIN_MAX_FRAC);
  const rWin = Math.min(rWinRaw, rWinCap);
  const rWinFrac = (2 * rWin + 1) * (2 * rWin + 1) / (W * H) * 100;
  console.log(`  · 取景：光团球心投影 (${view.sx},${view.sy})，${view.pxPerM}px/m ⇒ 采样框 r=${rWin}px（未钳 ${rWinRaw}px，上限 ${rWinCap}px；覆盖 ${rWinFrac.toFixed(1)}% 画面）`);
  /* 前提断言（铁律 3）：窗必须真的是"局部" —— 这次它静默通过，根因就是没人守这条。
     有了它，以后任何"距离/常量变了把窗撑大"的情况会当场自报，而不是靠 1.3× 这种间接症状。 */
  check('前提[取景]：采样框真的是"局部"（≤ 画面 15%）',
    rWinFrac <= 15, `窗 r=${rWin}px ⇒ 覆盖 ${rWinFrac.toFixed(1)}% 画面（旧版 497px = 77.6%）`);
  /* ── 局部性判据用的两个半径（2026-10-12 换度量时一并定义）──────────────────
     BR = 光团在屏上的投影半径；两个区域都**按 BR 定位**，不写死像素数：
       liftNear = r ≤ BR（光团自己的投影）      liftFar = r > 1.25×BR（"远处"）
     ⚠️ 1.25×BR 的依据（门禁自存样张实测）：晕圈延伸到 ≈1.13×BR —— 355~400px 段仍有
        4.54 luma，400~450 骤降到 0.214，450px 之后 ≈0。 */
  const BR = view.pxPerM * S.volR.max;
  /* 远区半径：**环带**，不是无界圆外（2026-10-12 改）。
     ⚠️ 为什么：`liftFar = r > FAR_R` 在 BR 被放大后会变成"整片画面外" ⇒ 采样集为空，
        而 `signedLift` 在 n=0 时**静默返回 0** ⇒ `0 <= liftNear/5` 恒成立 ⇒ 判据静默变绿
        （即加壳要堵的失效方式 3）。加上界后该区域永远非空，语义仍是"光团之外"。
     ⚠️ 1.25×BR 的依据（门禁自存样张实测）：晕圈延伸到 ≈1.13×BR —— 355~400px 段仍有
        4.54 luma，400~450 骤降到 0.214，450px 之后 ≈0。
     ⚠️ 上界 1.75×BR 只影响统计口径、不放松判据：k=1 时环带 [444,621]px 有 282026 像素
        （30.6% 画面），仍覆盖画面四边与四角（实测四角到球心 723~745px）。 */
  const FAR_R = 1.25 * BR;          // 环带内径（晕圈之外）
  const FAR_R2 = 1.75 * BR;         // 环带外径（上界：防 BR 变大后环带整体逸出画面）
  /* 前提[取景]（防呆，2026-10-12 补）：判据的"局部 vs 远处"要成立，必须留下足够的"远处"。
     ⚠️ 门槛用**面积占比 0.60** —— 立这条时引用的正是"光团占画面 42.7%"这个面积数；
        直径口径的现值也一并打印供核对（按高 0.99 / 按宽 0.55）。 */
  const blobAreaFrac = discPixels(W, H, view.sx, view.sy, BR) / (W * H);
  /* ⚠️ 环带口径（2026-10-12 改）：原来是 discPixels(FAR_R2)/面积 —— 它只能抓"disc 太小"，
     抓不到反方向：FAR_R2 罩住整个画框时该值读到 **100%** 而"远处环带"其实已被推出画面
     （实测：d=8 构造下 BR=568px、FAR_R2=994px > 画框角 734px ⇒ 环带只剩四角 ≈0.3% 画面，
     而旧口径读到 100%）。判据语义要的是**环带**，故按环带面积算。 */
  const farAreaFrac = (discPixels(W, H, view.sx, view.sy, FAR_R2) - discPixels(W, H, view.sx, view.sy, FAR_R)) / (W * H);
  check('前提[取景]：光团投影面积 ≤ 60% 画面、"远处"还剩 ≥5%（否则本判据静默退化）',
    blobAreaFrac <= 0.60 && farAreaFrac >= 0.05,
    `光团占画面 ${(blobAreaFrac * 100).toFixed(1)}%（上限 60%）· 远处环带占 ${(farAreaFrac * 100).toFixed(1)}%（下限 5%）· BR=${BR.toFixed(0)}px（直径/高 ${(2 * BR / H).toFixed(2)}、/宽 ${(2 * BR / W).toFixed(2)}）`);
  await sleep(900);

  /* ── ④ 阳性对照：只改光团 uLamp ── */
  /* ⚠️⚠️ 隔离前提（2026-10-05 补，本门因此从 25/29 恢复到全绿）：**先把烟花关掉**。
     本门的取样场景是「冬·夜·晴」—— 而这正是**春节烟花**的开启条件（379a275 落地后），
     每发绽放都会给全场打一记光（sun/amb/hemi/曝光乘系数 + amb 染色），实测：
       · 冬·夜·晴（烟花默认开）：取样框 σ = 19.15、全幅极差 51 luma；
       · 夏·夜·晴（烟花自然关）或 冬·夜·晴+强制关：σ = 0.06、极差 0.12。
     而本门要测的信号只有 ~2.3 luma ⇒ 全场打光把信号整片淹掉，判据红成"阳性对照 0.1σ"。
     这与"风要冻住"是同一条纪律：**测什么就把无关的全局效果关掉**，用产品自己的权威开关
     （setFireworksForce，与 fireworks-guard 同一个后门），不要靠统计去压。
     ⚠️ 副作用要说清：本门此后的画面**没有烟花**，所以它测的是"灯笼体积光本身"而不是
     "烟花夜里的灯笼"；要看两者共存的效果由 fireworks-guard 负责。 */
  if (process.env.LAMPVOL_NO_ISOLATE === '1'){
    check('隔离前提：烟花已强制关（冬·夜·晴 本该开烟花，它的全场打光会把本门 2.3 luma 的信号淹掉）',
      false, '按 LAMPVOL_NO_ISOLATE=1 故意不隔离（负例自检用）');
  } else {
    const missing = await page.evaluate(() =>
      typeof window.__garden.setFireworksForce === 'function' ? null : 'setFireworksForce 未暴露');
    if (!missing) await page.evaluate(() => window.__garden.setFireworksForce(false));
    /* ⚠️ 必须**等渲染循环翻面**再回读：`fireworksState().on` 是 tickFireworks 每帧算出来的 F.on，
       刚调完 setFireworksForce 就在同一个 evaluate 里读，拿到的还是上一帧的 true（实测踩过）。 */
    await sleep(600);
    const fwOn = await page.evaluate(() => {
      const g = window.__garden; const s = g.fireworksState ? g.fireworksState() : { on: null }; return s.on;
    });
    check('隔离前提：烟花已强制关（冬·夜·晴 本该开烟花，它的全场打光会把本门 2.3 luma 的信号淹掉）',
      missing === null && fwOn === false, missing || `fireworksState().on=${fwOn}`);
  }
  await sleep(900);

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
  /* ⚠️ 这里原来还有 sigLoc / sigAll（均取**单对** ON[0]/OFF[0] 的 mean|Δ|）——
     2026-10-12 连同那条局部性判据一起废弃，理由见下方新判据的注释。 */
  check('阳性对照：夜下把光团 uLamp 归零，灯周那块确实变暗（光团在贡献像素）',
    dLoc > 0.5 && dLoc > sigma * 3,
    `局部 luma ${med(lumaOn).toFixed(2)} → ${med(lumaOff).toFixed(2)}（差 ${dLoc.toFixed(3)}；同状态稳健 σ≈${sigma.toFixed(3)} ⇒ ${(dLoc / (sigma || 1e-6)).toFixed(1)}σ）`);
  console.log(`  · 逐样本局部 luma：开 [${lumaOn.map(v => v.toFixed(2)).join(', ')}] / 关 [${lumaOff.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(`  · 逐对差（配对差分）：[${dPairs.map(v => v.toFixed(2)).join(', ')}]（中位 ${dLoc.toFixed(3)}，MAD σ ${sigma.toFixed(3)}）`);
  /* ── 局部性判据（2026-10-12 换度量：改"量什么"，不动"要多严"）──────────────
     旧量 = mean|Δ|（单对、全幅均值当分母）：① 量的是像素级抖动，不是"抬亮"——实测核窗里
     87% 是 uTime 湍流细结构；② 分母含光团自己（1.6m 下占画面 42.7%）⇒ 结构上到不了 5×。
     新量 = **有向亮度位移**（见文件顶 signedLift 的说明），两个区域按 BR 定位：
       liftNear = r ≤ BR（光团自己的投影）      liftFar = r > 1.25×BR（"远处"）
     判据写成 `liftFar ≤ liftNear / 5`（**不做除法**：远处 lift 本底≈0，比值会数值爆掉）。
     ⚠️ 阈值 5× 一个字没改 —— 改的是"量什么"，不是"要多严"。
     旧口径实测（本次红）：近 9.457 / 全幅 3.386 = 2.79×。 */
  const liftNearPairs = ON.map((im, i) => signedLift(im, OFF[i], view.sx, view.sy, 0, BR).lift);
  const liftFarPairs = ON.map((im, i) => signedLift(im, OFF[i], view.sx, view.sy, FAR_R, FAR_R2).lift);
  /* 两个采样区的落屏像素数（由第 0 对的尺寸定；12 对同尺寸）。
     ⚠️ 必须在这里算：`liftNearN` 与 `signedLift` 用的是**同一个** `0..BR` 采样，
        所以它同时是"近区确实取到像素"与"光团投影真的覆盖了近区"的凭据。 */
  const liftDim = { w: ON[0].w, h: ON[0].h };
  const nearN = discPixels(liftDim.w, liftDim.h, view.sx, view.sy, BR);
  const farN = discPixels(liftDim.w, liftDim.h, view.sx, view.sy, FAR_R2)
             - discPixels(liftDim.w, liftDim.h, view.sx, view.sy, FAR_R);
  const liftNearN = liftNearPairs.length;
  const liftNear = med(liftNearPairs);
  const liftFar = med(liftFarPairs);
  /* 前提：两个采样区都必须非空。
     ⚠️ 这一条才是"失效方式 3"的正解：`signedLift` 在 n=0 时返回 0，`0 <= x/5` 恒成立，
        采样区一空判据就**静默恒绿**。环带上界（1.75×BR）只把"外扩出画面"这条路径封住，
        而"是否真的非空"必须**每次运行现场断言**，不能靠推导。 */
  check('前提[采样区]：近区与远区环带都非空、远区占比 ≥20%、且环带内径不越出画框角 95%（否则判据静默变绿 —— 失效方式 3）',
    nearN > 0 && farN > 0 && liftNearN > 0
      && farN >= (W * H) * 0.20                                  // 远区面积占比下限（Chief 2026-10-12 定 20%）
      && FAR_R <= 0.95 * Math.hypot(W / 2, H / 2),               // 环带内径不得越过画框角点（越过即采样区退化）
    `近区 n=${nearN} / 画面 ${(nearN / (W * H) * 100).toFixed(1)}%（r≤${BR.toFixed(0)}px）· 远环带 n=${farN} / 画面 ${(farN / (W * H) * 100).toFixed(1)}%（${FAR_R.toFixed(0)}..${FAR_R2.toFixed(0)}px，下限 20%）· 环带内径 ${FAR_R.toFixed(0)}px vs 画框角 95% = ${(0.95 * Math.hypot(W / 2, H / 2)).toFixed(0)}px`);
  check('光团是**局部**现象，不是全屏加了一层（远处的有向抬亮 ≤ 近处的 1/5）',
    liftFar <= liftNear / 5,
    `liftNear=${liftNear.toFixed(3)}（r≤${BR.toFixed(0)}px，n=${nearN}）· liftFar=${liftFar.toFixed(4)}（${FAR_R.toFixed(0)}<r≤${FAR_R2.toFixed(0)}px，n=${farN}）· 近/远 ${(liftNear / Math.max(Math.abs(liftFar), 1e-6)).toFixed(0)}×（须 ≥5）· 原始比较 liftFar×5=${(liftFar * 5).toFixed(4)} vs liftNear=${liftNear.toFixed(4)}（负值会显示假裕量，故并列原始比较）· 有向 luma 均值、12 对中位`);
  /* ── 【临时·A/B 双对照 2026-10-12】只打印，默认关闭（LAMPVOL_AB=1 时跑）─────────
     Chief 批的两条"真产品开关"：A = bloom.strength ×4（10-post.js:194）；
     B = 灯笼点光 distance → 200（12d-lantern.js:310 等）。各测「远区是否被抬亮 + 判据是否红」。
     ⚠️ 先验判断：这两者都**在两帧里都存在**（ON/OFF 只切 uLamp），所以它们的贡献在差分里
        很可能被抵消 —— 与"注入层两帧都挂"那次的失败同因。这一跑就是为了让实测说话。 */
  if (process.env.LAMPVOL_AB === "1") {
    const abState = await page.evaluate(() => {
      const g = window.__garden, lights = [];
      g.scene.traverse(o => { if (o.isLight && o.distance > 0) lights.push(o); });
      window.__abLights = lights;
      const bloom = (g.composer && g.composer.passes || []).find(p => p.strength !== undefined && p.radius !== undefined && p.threshold !== undefined);
      window.__abBloom = bloom || null;
      return { lights: lights.length, dists: lights.map(l => l.distance), bloom: bloom ? bloom.strength : null };
    });
    console.log("\n[临时 A/B] 找到带 distance 的灯 " + abState.lights + " 盏（" + abState.dists.join("/") + "）· bloom.strength=" + abState.bloom);
    const measure = async (tag) => {
      await sleep(500);
      const on = decodePNG(await shotOn()), off = decodePNG(await shotOff());
      const n = signedLift(on, off, view.sx, view.sy, 0, BR).lift;
      const f = signedLift(on, off, view.sx, view.sy, FAR_R, FAR_R2).lift;
      console.log("   " + tag + "：liftNear=" + n.toFixed(4) + " · liftFar=" + f.toFixed(4) + " · 判据 " + (f <= n / 5 ? "绿" : "**红**") + "（far/near=" + (f / Math.max(Math.abs(n), 1e-6)).toFixed(3) + "）");
      return { n: n, f: f };
    };
    const base = await measure("基线");
    await page.evaluate(() => { window.__abLights.forEach(l => { l.userData.abDist = l.distance; l.distance = 200; }); });
    const bRes = await measure("B: 灯 distance→200");
    await page.evaluate(() => { window.__abLights.forEach(l => { l.distance = l.userData.abDist; }); });
    const bBack = await measure("B 还原后");
    const bloomBase = await page.evaluate(() => { const b = window.__abBloom; if (!b) return null; const s = b.strength; b.strength = s * 4; return s; });
    const aRes = bloomBase === null ? { n: NaN, f: NaN } : await measure("A: bloom.strength ×4（" + bloomBase + "→" + (bloomBase * 4) + "）");
    await page.evaluate((s) => { if (window.__abBloom) window.__abBloom.strength = s; }, bloomBase);
    const aBack = await measure("A 还原后");
    console.log("   ⇒ A 效果：ΔliftFar=" + (aRes.f - base.f).toFixed(4) + " · B 效果：ΔliftFar=" + (bRes.f - base.f).toFixed(4)
      + " · 还原校验 A=" + (Math.abs(aBack.f - base.f) < 0.01 ? "✓" : "✗") + " B=" + (Math.abs(bBack.f - base.f) < 0.01 ? "✓" : "✗"));
    await page.evaluate(() => { delete window.__abLights; delete window.__abBloom; });
  }
  /* ── 保留"已证明有效的一半"（2026-10-12）：vol.scale 是探针可拨的**静态量** ──────────
     为什么留：它曾在旧负例里当构造量（放大光团模拟全屏叠加）。那个用法已由实跑排除
     （见下面负例块注释：d=1.6 造不出、且 A 是比值中立旋钮），但**这条控制能力本身是真的**：
     `vol.scale` 只在构造期写一次（src/12d-lantern.js:325），`tickLampVol`(:349) 每帧只写 uTime、
     `setLampVol`(:389) 只写 uLamp ⇒ 探针拨它之后不会被渲染循环回写。留一条轻断言把它钉住，
     免得以后有人以为"探针拨不动场景量"。本条**不拍图**（只回读数值），不影响任何像素读数。 */
  {
    const vsBase = await page.evaluate(() => {
      const g = window.__garden; window.__vsMeshes = [];
      g.scene.traverse(o => { if (o.name === "lampVol") window.__vsMeshes.push(o); });
      return window.__vsMeshes.map(o => o.scale.x);
    });
    const vsAfter = await page.evaluate(async () => {
      const m = window.__vsMeshes;
      m.forEach(o => o.scale.setScalar(o.scale.x * 1.5));
      await new Promise(r => setTimeout(r, 700));           // 等渲染循环翻多帧，看会不会被回写
      return m.map(o => +o.scale.x.toFixed(4));
    });
    check("已证明有效的一半：vol.scale 拨得动、且不被渲染循环回写（连读多帧后仍是拨后的值）",
      vsBase.length === LANTERNS && vsAfter.every((v, i) => Math.abs(v - vsBase[i] * 1.5) < 1e-3),
      "找到 " + vsBase.length + " 个光团（应为 " + LANTERNS + "）· 拨后 700ms 回读 " + vsAfter.map((v, i) => v + "(原 " + vsBase[i] + ")").join(" / "));
    const vsRestored = await page.evaluate((base) => {
      const m = window.__vsMeshes;
      m.forEach((o, i) => o.scale.setScalar(base[i]));
      delete window.__vsMeshes;
      return m.map(o => +o.scale.x.toFixed(4));
    }, vsBase);
    check("还原自检：vol.scale 已还原到拨前值（读数不受本条影响）",
      // 相对容差 1e-3×拨前值（Chief 2026-10-12 批）：实测尾差 5e-5（0.66975→0.6698，toFixed(4) 取整）
      // 远在容差内（余量 ~13×）；而该条要抓的失败模式是"没还原"（残留 1.5× ⇒ 偏差 0.29，余量 ~300×）。
      // ⚠️ 不要再收紧到 1e-4×拨前值（=6.7e-5）——那对观测尾差只剩 1.3× 余量，等于造一个近乎恒红的门。
      vsRestored.every((v, i) => Math.abs(v - vsBase[i]) < 1e-3 * vsBase[i]),
      "还原后 " + vsRestored.join(" / ") + "（拨前 " + vsBase.join(" / ") + "）");
  }
  /* ── 负例自检（2026-10-12 第七版·注入全屏加法层，**与灯态耦合**）：判据必须红 ──────
     为什么注入层必须**只出现在 ON 帧**（这是这一版与前一次尝试的唯一差别）：
       判据量的是 ON−OFF 差分。若注入层在 ON 与 OFF 两帧都挂着，两帧被抬亮同一量 ⇒
       差分时**完全抵消**（实测：注入层出像素 近 13.5 / 远 13.9 luma，但两区 lift 与基线
       差 <0.05，判据照绿）。而这条判据守的缺陷是「**灯亮时**整幅被抬亮」——
       所以注入层必须挂进"灯亮"这个状态里：shotOn 时 visible=true、shotOff 时 visible=false。
     另两条构造留档（都不如本条通用，供后人核）：
       · 放大光团（产品保真）在 d=1.6 造不出来（k>1.66 中央黑洞 + 相机在球内时可见球面翻到
         灯后被 depthTest 剔掉）；退到 d=8 + k∈{8,10,11} 能红（实测六组全红，
         badNear≈3.7~4.1 / badFar≈5.7~6.2，日志 outputs/_diag/lampvol-d8b-202610120112.log），
         但要临时移相机、多一次状态切换，故不作为本门默认构造；
       · 抬 uLamp 不能改比值（ON/OFF 对里只有 uLamp 变 ⇒ badNear=A·m_near、badFar=A·m_far
         ⇒ 翻转条件 5·m_far>m_near 与 A 无关）。
     ⚠️ 注入层是**非产品几何**，只在负例块里临时加、量完立刻移除；不参与任何其它判据读数。 */
  {
    const inj = await page.evaluate(() => {
      const g = window.__garden, T = g.THREE;
      if (!T || !T.PlaneGeometry) return { err: "THREE 未暴露" };
      window.__injWasInScene = !!(g.camera.parent);
      if (!window.__injWasInScene) g.scene.add(g.camera);
      const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0165, blending: T.AdditiveBlending, depthTest: false, depthWrite: false });
      const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), mat);
      const cv = document.querySelector("canvas");
      const cw = cv ? cv.width : window.innerWidth, ch = cv ? cv.height : window.innerHeight;
      const vHalf = g.camera.fov * Math.PI / 360;
      const hHalf = Math.atan(Math.tan(vHalf) * (cw / ch));
      const cornerHalf = Math.atan(Math.hypot(Math.tan(vHalf), Math.tan(hHalf)));
      const dist = 0.5 * (g.camera.near + 1.5);          // 放在 near 之外
      const h = 2 * Math.tan(cornerHalf) * dist;         // 尺寸按**实测**画框角半视场算，不写死像素
      mesh.scale.set(h * (cw / ch), h, 1);
      mesh.position.set(0, 0, -dist);
      mesh.renderOrder = 999; mesh.visible = false;
      g.camera.add(mesh); window.__injMesh = mesh;
      mesh.updateMatrixWorld(true);
      return { ok: true, alpha: mat.opacity, w: +(h * (cw / ch)).toFixed(2), h: +h.toFixed(2), dist: +dist.toFixed(2),
        cornerDeg: +(cornerHalf * 180 / Math.PI).toFixed(2), vp: window.innerWidth + "x" + window.innerHeight, canvas: cw + "x" + ch };
    });
    check("负例前提[注入]：全屏加法层已挂上相机、尺寸按实测画框角算、且默认不可见（不污染其它读数）",
      !inj.err && inj.ok === true,
      inj.err ? ("注入失败：" + inj.err) : ("alpha=" + inj.alpha + " · 平面 " + inj.w + "x" + inj.h + "m @ " + inj.dist + "m（near=0.5 之外）· 画框角半视场 " + inj.cornerDeg + "°（实测 window " + inj.vp + " · canvas " + inj.canvas + "）"));
    await sleep(400);
    const injOn = async () => { await page.evaluate(() => { window.__injMesh.visible = true; }); await sleep(420); return decodePNG(await page.screenshot()); };
    const injOff = async () => { await page.evaluate(() => { window.__injMesh.visible = false; }); await sleep(420); return decodePNG(await page.screenshot()); };
    /* null 对照：同灯态下连拍两对，得该配置的分带噪声 σ（风已冻结） */
    await page.evaluate((v) => window.__garden.setLampVol(v), lampOn);
    const nA = await injOn();
    await injOff();
    const nB = await injOn();
    await injOff();
    const nL1 = (a, b) => signedLift(a, b, view.sx, view.sy, 0, BR).lift;
    const fL1 = (a, b) => signedLift(a, b, view.sx, view.sy, FAR_R, FAR_R2).lift;
    const sigN = Math.abs(nL1(nA, nB)), sigF = Math.abs(fL1(nA, nB));
    /* 缺陷态：注入层挂进"灯亮"这一边 */
    const on1 = await injOn();
    await page.evaluate(() => window.__garden.setLampVol(0));
    const off1 = await injOff();
    const on2 = await injOn();
    await page.evaluate(() => window.__garden.setLampVol(0));
    const off2 = await injOff();
    await page.evaluate((v) => window.__garden.setLampVol(v), lampOn);
    const nb = (nL1(on1, off1) + nL1(on2, off2)) / 2;
    const fb = (fL1(on1, off1) + fL1(on2, off2)) / 2;
    /* ⚠️ σ 的口径就在下一行 detail 里：σ 取自**一对**同态相邻帧（n=1）⇒ 3σ 这根横杆本身
       是随机量，跨运行实测可差 **50×**（0.0002~0.0099）。它够用是因为**信号**（badFar≈13.9 luma）
       远大于它，而不是因为横杆稳。要让横杆变稳：把 null 对照做成 12 对池化 MAD。 */
    check("负例前提[可判定]：注入态两区都取到正向读数、远区抬亮过同态噪声 3σ",
      nb > 0 && fb > 0 && fb >= 3 * sigF,
      "badNear=" + nb.toFixed(4) + " · badFar=" + fb.toFixed(4) + " · 同态噪声 σ_near=" + sigN.toFixed(4) + " σ_far=" + sigF.toFixed(4) + "（3σ_far=" + (3 * sigF).toFixed(4) + "）");
    check("负例自检：注入「灯亮即全幅抬亮」的加法层 ⇒ 本判据必须红（证明它有牙）",
      !(fb <= nb / 5),
      "badFar×5=" + (fb * 5).toFixed(4) + " vs badNear=" + nb.toFixed(4) + " ⇒ " + (fb > nb / 5 ? "红（判据失败＝正确）" : "绿（判据没抓住 ⇒ 本负例失效，须重做）"));
    const removed = await page.evaluate(() => {
      const g = window.__garden, m = window.__injMesh;
      if (m) { g.camera.remove(m); m.geometry.dispose(); m.material.dispose(); }
      if (window.__injWasInScene === false) g.scene.remove(g.camera);
      delete window.__injWasInScene; delete window.__injMesh;
      return !window.__injMesh;
    });
    await sleep(500);
    const back = await page.evaluate(() => { const g = window.__garden; const s = g.lampVolState(); return { d: +g.camera.position.distanceTo(g.controls.target).toFixed(3), lamp: s.uLamp, meshes: g.camera.children.length }; });
    check("负例自检：注入层已移除、uLamp 已还原、相机未被改动",
      removed === true && back.lamp === lampOn && Math.abs(back.d - 1.6) < 0.05,
      "移除 " + (removed ? "✓" : "✗") + " · uLamp=" + back.lamp + "（原 " + lampOn + "）· 相机 " + back.d + "m（原 1.6m）· 相机子节点 " + back.meshes);
  }

  check('前提[可判定]：近带是正向抬亮（liftNear > 0）—— 防"两个负数"制造假红',
    liftNear > 0, `liftNear=${liftNear.toFixed(4)}（须 > 0）· liftFar=${liftFar.toFixed(4)}`);
  /* 可复现性自证（2026-10-12 补）：同状态两半各取中位，差不得超过 25% × liftNear ——
     判据能"可复现"才算判据：同代码同机位连着两次读数若差出量级，红绿就由噪声决定。 */
  const nearA = med(liftNearPairs.slice(0, N / 2)), nearB = med(liftNearPairs.slice(N / 2));
  const farA = med(liftFarPairs.slice(0, N / 2)), farB = med(liftFarPairs.slice(N / 2));
  const reproduceLim = 0.25 * Math.abs(liftNear);
  check('可复现性自证：同状态两次量读数一致（|Δlift| ≤ 25% × liftNear）',
    Math.abs(nearA - nearB) <= reproduceLim && Math.abs(farA - farB) <= reproduceLim,
    `liftNear 两半 ${nearA.toFixed(3)} / ${nearB.toFixed(3)}（Δ ${Math.abs(nearA - nearB).toFixed(3)}）· liftFar 两半 ${farA.toFixed(4)} / ${farB.toFixed(4)}（Δ ${Math.abs(farA - farB).toFixed(4)}）· 上限 ${reproduceLim.toFixed(3)}`);
  /* 前提[分辨力]（2026-10-12 补，Chief 清单第 3 条）：判据的判定阈值是 liftNear/5。
     若远带噪声与之同量级，判据就分不清"真的没有远处抬亮"和"噪声" ⇒ 必须报「无分辨力」，
     而不是静默判「通过」 —— 这是"绿比红危险"那条纪律的又一落点。σ_far 用同状态两半差作代理。 */
  const sigFarProxy = Math.abs(farA - farB);
  const resNeed = Math.abs(liftNear) / 5;
  check('前提[分辨力]：3σ_far 远小于判据阈值 liftNear/5（否则应判「无分辨力」而不是通过）',
    3 * sigFarProxy < resNeed,
    `3σ_far=${(3 * sigFarProxy).toFixed(4)}（两半差 ${sigFarProxy.toFixed(4)}）vs 阈值 liftNear/5=${resNeed.toFixed(4)} ⇒ 余量 ${(resNeed / Math.max(3 * sigFarProxy, 1e-9)).toFixed(0)}×`);

  /* ── 能力边界（2026-10-12 定稿）：三件事必须分开说，混说会自相矛盾 ──────────────────
     ① **「放大光团」方向：不可用于定档（2026-10-12 实测更正）** —— 相机退 d=8 + 五盏 lampVol
        放大 k=8（几何窗口 [7.81,11.19]），按**新距离重算**采样带后 BR8=568px、环带 [710,994]px，
        而画框角点只有 734px ⇒ 环带与画框的交集只剩四角 r∈(710,734] ≈ **0.3% 画面** ⇒
        「远处」实际已不存在 ⇒ 按前提[采样区]应判**不可定档**，不能当负例用。
        强行按带读到的比值是 **0.986**（badNear 4.5768 / badFar 4.5146，两次一致）——那是
        「全屏叠加」的签名，但样本退化，只作旁证。日志 outputs/_diag/lampvol-d8c-20261012095854.log。
        ⇒ **「整个画面被壳罩满」与「判据仍有『远处』可测」在几何上互斥**：这条路给不出干净负例。
        ⚠️ 旧读数（outputs/_diag/lampvol-d8b-202610120112.log 的六组）**已作废**：那一版把相机退到
        8m 却沿用 1.6m 取景算出的 BR/FAR_R/sx/sy ⇒ 判据的区域与实际取景不对齐（Chief 2026-10-12 指出）。
        为什么 d=1.6 也不行：k>1.66 中央出黑洞（z(0)=d−R 被近平面裁）；相机在球内时唯一可见的
        球面翻到灯**之后**被 depthTest 剔掉（:182 只关了 depthWrite）⇒ 两带同时归零。
        ⚠️ 放大的是**五盏**：远环带里混着游廊三盏的球壳，R 只用于几何前提，覆盖全幅的是
        五盏壳的**并集** —— 别拿 R 反推远带来源。
     ② **仪器标定：有效 ✓** —— 只在 **ON 帧**整体加常量 C（纯 PNG 数学、零 GPU）⇒ 实测翻转点
        C∈(1.4,1.5] ⇒ **判据门限 ≈1.46 luma**，与代数 (badNear−5·badFar)/4 的 1.4584 一致。
     ③ **做不到的**：把加法层注入到 **ON/OFF 两帧**再指望判据变红 —— 判据量的是**差分**，
        两帧同量抬亮 ⇒ **完全抵消**（实测：注入层出像素 近 13.5 / 远 13.9 luma，而两区 lift
        与基线差 <0.05）。同理下列"两帧都变"的真产品开关对本判据**零贡献**（实测）：
        light.distance 6.5/9→200（ΔliftFar ≈ −0.003）与 bloom.strength 0.5→2（ΔliftFar ≈ −0.0035）
        —— 要抓「有人把灯改成全场光源」这类回归，得另立一条**绝对值**判据。
     ⚠️ 落盘的活负例是**与灯态耦合**的注入层（见上面第七版块）：只有「灯亮时整幅被抬亮」
        这种签名才在差分里留下痕迹 ⇒ 必红。
     ⚠️ 一处容易误读的数：**旧 d=8 那组** badFar(5.7) > badNear(4.1) 不是几何反了 —— 壳的加性
        在线性空间两带相同，但近带基线更亮（灯体与亮构件）⇒ 同样的线性增量在 sRGB luma 上
        更小（凹性）⇒ 远带读数更大。按新距离重算后该差消失（4.577 vs 4.515，比值 0.986），
        说明那 0.39 里含了不少"两组基线亮度不同"的成分。
        ⚠️ **本段只解释 d=8 放大光团那一组**；**注入自检组方向相反**（near 16.70 > far 13.93），
        因为那组换了相机机位、两带基线亮度分布不同 ⇒ 两组数不要并排套同一句解释。
     ⚠️ **σ 的口径**：活负例块里的 σ 取自**一对**同态相邻帧（n=1）⇒ 3σ 横杆本身就是随机量 ——
        不同运行实测 σ_far 从 **0.0002 到 0.0099（差 50×）**。信号（badFar≈5.5 luma）远超之，
        结论不受影响；但**别把某一次的 0.0002 当成稳定噪声底**。要更硬的横杆就把 null 对照做成
        12 对池化 MAD（当前 2 对 + 1 对 null 在 7× 余量下够用）。
     ⚠️ **A 轴（uLamp 倍率）的精确口径**：A **不改变红/绿**（比值 1.2~1.6，远在门限 1/5 之外），
        但比值有 **13~19% 的非线性漂移**（A=20 时 badNear 只长 17.5×、badFar 只长 15.1×，双双次线性）
        ⇒ 与"近带多一项随 A 增长（b>0）"的分解**符号一致**，但 sRGB/ACE 凹性也能贡献同号效应，
        故这只是一条假设、不是结论；要定性需补 A∈{2,4,8}（平滑单调 ⇒ b>0；阈值型陡现 ⇒ 削顶）。
     ⚠️ **不要把 5.64 与 1.46 并列比大小**：C*≈1.46 luma 是"从基线态起算、平坦泄漏加到多少才翻转"
        的门限；5.64 是壳在远带的抬亮（基线态远带≈0.005）。两者只是**方向一致**（都判红），不是同一把尺。 */
  if (process.env.LAMPVOL_NEG_INJECT === "1") {
    /* 保留原来那条“注入全屏加法层”的**出像素自检**段（默认不跑，**这不是仪器标定**）：
       它证明的是“注入层确实出像素”；而“判据会不会被它改红”取决于它挂在哪一边 ——
       · 挂在 ON/OFF **两帧** ⇒ 差分抵消 ⇒ 判据纹丝不动（本段就是这种，故默认关闭）；
       · 只挂在 **ON 帧** ⇒ 落盘的活负例（见上面第七版块）⇒ 必红。
       真正的**仪器标定**是另一件事：只给 ON 帧加常量 C ⇒ 门限 ≈1.46 luma（见能力边界块 ②）。 */
    const injInfo = await page.evaluate(() => {
      const g = window.__garden, T = g.THREE;
      if (!T || !T.PlaneGeometry) return { err: "THREE 未暴露" };
      const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01651, blending: T.AdditiveBlending, depthTest: false, depthWrite: false });
      const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), mat);
      const dist = 1, h = 2 * Math.tan(170 * Math.PI / 360) * dist, w = h * (window.innerWidth / window.innerHeight);
      mesh.scale.set(w, h, 1); mesh.position.set(0, 0, -dist); mesh.renderOrder = 999;
      window.__camWasInScene = !!(g.camera.parent);
      if (!window.__camWasInScene) g.scene.add(g.camera);
      g.camera.add(mesh); window.__lampVolInjected = mesh;
      return { ok: true };
    });
    await sleep(450);
    const onI = decodePNG(await shotOn());
    await page.evaluate(() => { window.__lampVolInjected.visible = false; });
    await sleep(450);
    const onN = decodePNG(await shotOn());
    const dN = signedLift(onI, onN, view.sx, view.sy, 0, BR).lift;
    const dF = signedLift(onI, onN, view.sx, view.sy, FAR_R, FAR_R2).lift;
    console.log("  · [注入层出像素自检] 近区 " + dN.toFixed(3) + " · 远环带 " + dF.toFixed(3) + " luma（同开灯态、只切 visible；自检，不是仪器标定）");
    await page.evaluate(() => {
      const g = window.__garden, m = window.__lampVolInjected;
      if (m) { g.camera.remove(m); m.geometry.dispose(); m.material.dispose(); }
      if (g.__camWasInScene === false) g.scene.remove(g.camera);
      delete g.__camWasInScene; delete window.__lampVolInjected;
    });
    await sleep(400);
  }

  /* 热点定位 · 2026-10-13 改口径：差分场必须**整体**落在光团上，而不是"最强格落在哪一格"。
     ⚠️ 为什么不能只看最强格：取景把相机放在光团正前方 camMinDist 处（:293-305），
        灯笼**本体是不透明的**，正压在光团球心上 ⇒ 该处差分被压成 ≈0；而光团在本体之外的
        暗背景上贡献近乎均匀的抬亮。差分场因此是一个**中心被挖空的圆盘**，最强格必然落在
        本体剪影边缘、离中心约两个格 —— 这与"光团挂错位置"无关，是**几何必然**。
     ⇒ 改成两条并列子条件（仍是一条 check，阈值一个都不放松）：
       A 位置（遮挡不敏感）：算**全格差分值的加权重心**（权重就是各格 v，无门槛），
         要求它离光团球心投影**逐轴** ≤1 格。圆盘绕中心对称 ⇒ 本体挡不挡都不改重心；
         支撑集恒为整幅画面，不随任何单格起伏而变。
       B 保语义：最强格的**格心**离光团球心投影 ≤1.5×BR（盘半径的 1.5 倍）。只问
         "最强差分还在不在光团盘上"，不要求精确落格 ⇒ 遮挡同样毁不掉它。
     两个子条件都直接与 box.x/box.y 比像素，顺带消掉旧口径 floor(box/CELL)*CELL 的量化跳变
     （取景点恰在画面正中时 sx 常等于 W/2，而 W/2 正是 CELL 的整数倍，抖一像素就翻一格）。
     每格仍取 12 对样本的差分中位数（同 mist-guard 多帧中位数思路）：瞬时粒子被中位数吃掉。
     ⚠️ A 为什么**不能**用"取 v ≥ 0.5×vMax 的格再求重心"：那个门槛是**相对 vMax** 的，而
        vMax 是**单格峰值**、坐在灯笼剪影边缘上、随风摆动 —— 它一抬高，门槛就把圆盘里近乎
        均匀的那片抬亮整片切掉，集合收缩、重心跟着飘（实测同一份代码，集合大小在三个量级
        间跳）。**支撑集依赖一个本身不稳的量，必然继承它的抖动**：那是统计量选错，不是
        容差不够，放宽容差只会把真缺陷一起放过。改无阈值的值加权重心后，支撑集固定、权重
        正比真实差分。旧的门槛重心仍打印，但**降级为诊断、不再参与判定**。 */
  const SIG_FRAC = 0.5;                 // **仅用于诊断打印**：旧门槛集合，已不作判据（见上）
  const HOT_CAP_BR = 1.5;               // 子条件 B 的上限，单位 = 盘半径 BR
  const evalHot = (ONs, OFFs) => {
    const cells = [];
    for (let gy = 0; gy < H; gy += CELL) for (let gx = 0; gx < W; gx += CELL) {
      const cx = Math.min(W - 1, gx + CELL / 2), cy = Math.min(H - 1, gy + CELL / 2);
      cells.push({ gx, gy, cx, cy, v: med(ONs.map((im, i) => boxDiff(im, OFF[i], cx, cy, CELL / 2))) });
    }
    const hot = cells.reduce((a, b) => b.v > a.v ? b : a);
    const second = cells.reduce((a, b) => (b === hot || b.v <= a.v ? a : b), { v: -1, gx: 0, gy: 0 });
    /* A 的判据量 = **全格值加权重心**（无门槛）：mcx = Σ(v·cx)/Σv，对全部格求和。
       支撑集恒为整幅画面、权重正比各格真实差分 ⇒ 不依赖任何单格峰值。 */
    const vSum = cells.reduce((s, c) => s + c.v, 0);
    const wcx = vSum > 0 ? cells.reduce((s, c) => s + c.v * c.cx, 0) / vSum : box.x;
    const wcy = vSum > 0 ? cells.reduce((s, c) => s + c.v * c.cy, 0) / vSum : box.y;
    const dmx = wcx - box.x, dmy = wcy - box.y;
    /* 旧的门槛重心：只作**诊断**打印，不参与判定。 */
    const sig = cells.filter(c => c.v >= SIG_FRAC * hot.v);
    const tmcx = sig.reduce((s, c) => s + c.cx, 0) / sig.length;
    const tmcy = sig.reduce((s, c) => s + c.cy, 0) / sig.length;
    const hotDist = Math.hypot(hot.cx - box.x, hot.cy - box.y);
    const hotCap = HOT_CAP_BR * BR;
    /* okA 的 `vSum > 0` 前置：全幅差分为 0（光团压根不贡献像素）时加权重心无定义 ⇒ 判红。
       它同时挡住两种情形：**除零** 与 **无光团**（后者是"灯没亮"，必须红而不是恒绿）。 */
    const okA = vSum > 0 && Math.abs(dmx) <= CELL && Math.abs(dmy) <= CELL;
    const okB = hotDist <= hotCap;
    return { hot, second, sigN: sig.length, cellsN: cells.length, vSum,
             wcx, wcy, dmx, dmy, tmcx, tmcy,
             hotDist, hotCap, okA, okB, ok: okA && okB };
  };
  const hotDetail = v =>
    `A 值加权重心 (${v.wcx.toFixed(1)},${v.wcy.toFixed(1)}) 偏移 (${v.dmx.toFixed(1)},${v.dmy.toFixed(1)})、容差 ±${CELL} ⇒ ${v.okA ? '绿' : '红'}` +
    ` · B 最强格 (${v.hot.gx},${v.hot.gy}) 格心 (${v.hot.cx},${v.hot.cy}) 值 ${v.hot.v.toFixed(2)} 离光团 ${v.hotDist.toFixed(1)}px ≤ ${HOT_CAP_BR}×BR=${v.hotCap.toFixed(1)}px ⇒ ${v.okB ? '绿' : '红'}` +
    ` · Σv=${v.vSum.toFixed(1)} · vMax=${v.hot.v.toFixed(2)} · 次强格 (${v.second.gx},${v.second.gy}) 值 ${v.second.v.toFixed(2)}（领先 ${(v.hot.v - v.second.v).toFixed(2)}）` +
    ` · [诊断·不作判据] 旧门槛重心 (${v.tmcx.toFixed(1)},${v.tmcy.toFixed(1)}) 偏移 (${(v.tmcx - box.x).toFixed(1)},${(v.tmcy - box.y).toFixed(1)})、显著格 ${v.sigN}/${v.cellsN}`;
  const hv = evalHot(ON, OFF);
  check('差分场落在光团上：①全格值加权重心逐轴 ≤1 格 ②最强格离光团 ≤1.5×盘半径（光团没挂错位置，别处也没有假光）',
    hv.ok, hotDetail(hv));

  /* ── 自检模式（LAMPVOL_SELFCHECK=1，默认整段跳过）· 缺陷态注入，证明上面这条判据**有牙** ──
     缺陷 = 「光团挂错位置」：把所有光团整体横移。
     · **只在开灯帧存在**：光团网格 uLamp=0 时全透明（src/12d-lantern.js:321），所以位移只在
       ON 帧显形；若像本门 :712 那条注入自检那样两帧都注入，差分会直接抵消、什么也测不到。
     · 位移量按**格宽**定（4 格），不写死像素/米：位移太小推不出容差，太大会把光团推出画面 ——
       推出画面后差分整体消失、显著格退化成全画面，重心反而回到画面中心，判据就假绿了。
     · 量完必须**原样还原并回读验证**，自检不得给后面的断言留任何场景残留。 */
  if (process.env.LAMPVOL_SELFCHECK === '1') {
    console.log('\n[体积光] 自检模式：注入缺陷态「光团整体横移」，要求上面这条判据实测报红');
    const shiftM = CELL * 4 / view.pxPerM;                 // 4 格宽的横向位移
    const moved = await page.evaluate((dx) => {
      const g = window.__garden; const list = [];
      g.scene.traverse(o => { if (o.name === 'lampVol' && o.parent) list.push(o); });
      window.__lvSaved = list.map(o => [o.position.x, o.position.y, o.position.z]);
      list.forEach(o => { o.position.x += dx; });
      return list.length;
    }, shiftM);
    check('自检·缺陷注入成功（光团整体横移，只在开灯帧可见 ⇒ 差分不抵消）', moved === LANTERNS,
      `横移 ${shiftM.toFixed(2)}m（≈${(shiftM * view.pxPerM).toFixed(0)}px = ${CELL * 4 / CELL} 格），命中 ${moved}/${LANTERNS} 个光团`);
    const sON = [], sOFF = [];
    for (let i = 0; i < 4; i++) { sON.push(decodePNG(await shotOn())); sOFF.push(decodePNG(await shotOff())); }
    const sv = evalHot(sON, sOFF);
    check('自检·缺陷态下子条件 A 判红（重心被推出 1 格容差）', !sv.okA, hotDetail(sv));
    check('自检·缺陷态整条判据报红（有牙，不是恒绿）', !sv.ok, hotDetail(sv));
    const restored = await page.evaluate(() => {
      const g = window.__garden; const saved = window.__lvSaved || []; let k = 0;
      g.scene.traverse(o => {
        if (o.name !== 'lampVol' || !o.parent || k >= saved.length) return;
        o.position.set(saved[k][0], saved[k][1], saved[k][2]); k++;
      });
      let m = 0, j = 0;                                       // 回读活对象，验证真的还原了
      g.scene.traverse(o => {
        if (o.name !== 'lampVol' || !o.parent || j >= saved.length) return;
        const s = saved[j++];
        m = Math.max(m, Math.abs(o.position.x - s[0]), Math.abs(o.position.y - s[1]), Math.abs(o.position.z - s[2]));
      });
      delete window.__lvSaved;
      return { n: k, read: j, total: saved.length, worst: m };
    });
    check('自检·光团位置已原样还原（回读比对，最大残差必须为 0，不给后续断言留残留）',
      restored.total === LANTERNS && restored.n === restored.total && restored.read === restored.total && restored.worst === 0,
      `回写 ${restored.n}/${restored.total} · 回读 ${restored.read} · 最大残差 ${restored.worst}`);
    await page.evaluate(v => window.__garden.setLampVol(v), lampOn);   // 连灯态一起还原，自检不留任何场景残留
  }
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
})().catch(e => { console.error("[lampvol-guard] 崩溃:", e); process.exit(2); });
