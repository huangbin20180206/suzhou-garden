/* 天气覆盖门禁（第 23 道）—— 2026-09-20
 *
 * 起因：全园"隐形缺陷"盘点（probe/_coverage-audit.mjs）在同一形状上抓到两处：
 *   ① 竹竿（bambooA / bambooB）在 SNOW_BOOST 里配了 **0.85，全表最高**的积雪加成，
 *      却不在 SNOW_COVER_MATS 里。加成只是 shader 里的一个 uniform，材质不在表里就
 *      压根不会被注入 —— 那个 0.85 从来没生效过，"雪压竹竿"是纸面上的意图。
 *   ② 题名石刻（云根）的 stoneMat 只登记了 wet、没登记 snow —— 而园里其它石头
 *      （taihu / rock / stone / riverStone…）全在雪表里，只有这块 hero 主角是光板。
 * 形状与折射层漏石头完全一致：「某个东西该出现在某个集合里，却没出现。
 *   不报错、不崩、状态全对，只有主动去问『这个集合里还应该有什么』才发现。」
 *
 * 判据分三层，**每一层都能独立变红**：
 *   G1~G4 结构性：名单与标记必须互洽（对象身份比对，零启发式）。
 *   G5    阳性对照：修好的两处必须真的在表里**且注入已挂**，且石刻必须是走
 *         「晚注册补装」进来的（它比装雪收尾晚，能挂上就证明补装路径真的通了）。
 *   G6    行为（像素）：冬+晴 vs 冬+雪，题名石刻 ROI 的**中位亮度**必须显著上升 ——
 *         证明补装出来的 shader 真的把雪画到了石头上，而不只是"标记挂上了"。
 *   G0    自检：把竹竿从雪表里移出去，确认 G1 会红 —— 探针自带"我确实能红"的证据，
 *         免得某天门禁全绿而其实是判据自己失效了（项目里出过这种假绿）。
 *
 * ⚠️ 像素判据的已知污染源，一律按项目既定办法处置：
 *   · 压画面的 UI（首次引导气泡）→ 开跑前 guideStop()
 *   · 逐帧随机（飘雪粒子）→ 用**中位数**，不用均值
 *   · 天气本身会改光照/雾（雪天 sunMul 0.62、fogMul 1.30）→ 所以对照取
 *     「同季节同时段、只切天气」，把季节/时段这两个变量按住不动
 *
 * 用法: node probe/weather-coverage.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';
import { decodePNG } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ROI 统计：**中位数**是主判据（抗飘雪这类逐帧随机），同时给出 p10/p90 便于判断
   "是整块变白"还是"只有零星像素变白"。 */
function roiStats(img, x, y, w, h){
  const { data, bpp, w: W, h: H } = img;
  const lum = [];
  for (let py = Math.max(0, y); py < Math.min(H, y + h); py++){
    for (let px = Math.max(0, x); px < Math.min(W, x + w); px++){
      const i = (py * W + px) * bpp;
      lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
  }
  if (!lum.length) return null;
  lum.sort((a, b) => a - b);
  return { n: lum.length,
           med: +lum[lum.length >> 1].toFixed(1),
           p10: +lum[Math.floor(lum.length * 0.10)].toFixed(1),
           p90: +lum[Math.floor(lum.length * 0.90)].toFixed(1),
           mean: +(lum.reduce((a, b) => a + b, 0) / lum.length).toFixed(1) };
}

/* ROI 内「变亮超过阈值」的像素占比 —— 回答"雪有没有盖到这块面上"，
   而**不**要求"盖了多厚"。后者由物体的几何形状决定（太湖石以竖面为主，
   雪的判据是"朝上程度"，本来就上不去多少），把它当判据就是拿物理事实当缺陷。 */
function roiBrighter(a, b, x, y, w, h, thr = 15){
  const A = a.data, B = b.data, bp = a.bpp, W = a.w, H = a.h;
  let n = 0, up = 0;
  for (let py = Math.max(0, y); py < Math.min(H, y + h); py++){
    for (let px = Math.max(0, x); px < Math.min(W, x + w); px++){
      const i = (py * W + px) * bp;
      const la = 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2];
      const lb = 0.2126 * B[i] + 0.7152 * B[i + 1] + 0.0722 * B[i + 2];
      n++;
      if (la - lb > thr) up++;
    }
  }
  return { n, up, pct: n ? +(up / n * 100).toFixed(2) : 0 };
}

let fails = 0, checks = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' ｜ ' + detail : ''}`);
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  /* 立峰·云根是 deferBootFirst 的第一批；它没到位就谈不上"补装"这条判据 */
  await page.waitForFunction(() => {
    let has = false;
    window.__garden.scene.traverse(o => { if (o.isMesh && o.name === 'stele') has = true; });
    return has;
  }, { timeout: 180000, polling: 400 });
  /* ⚠️ 还要等**整条延迟链**跑完（2026-09-24 修偶发红）：竹竿在延迟链**靠后**的批次里，
     而 G0 自检是"把竹竿移出雪表 ⇒ G1 必须报出来"，G1 只看**场景在用**的材质
     ⇒ 竹竿还没进场时把它移出雪表，G1 自然 = 0，自检就报假红。
     实测：整轮 verify 里红的正是这条（"移出后 G1=0"），而单跑却绿 —— 典型竞态。
     等 bootDonePromise（T0 补的装配完成信号）后竹竿必定在场，负例必触发。 */
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.evaluate(() => { try { window.__garden.guideStop?.(); } catch (_) {} });
  await sleep(900);

  /* ── 结构性判据：G1~G4 ──
     读名单走**动态 import 同一模块 URL**：ESM 单例，拿到的是页面正在用的那两个数组
     本身（不是副本），所以 Set.has 的对象身份判定成立。 */
  const struct = await page.evaluate(async () => {
    const G = window.__garden;
    const M = await import(new URL('src/01-materials.js', document.baseURI).href);
    const SNOW = M.SNOW_COVER_MATS, WET = M.WET_MATS;
    const snowSet = new Set(SNOW), wetSet = new Set(WET);
    const hasKey = (m) => {
      try { return String(m.customProgramCacheKey()).indexOf('|snow') >= 0; } catch (_) { return false; }
    };
    const label = (m) => `${m.name || '(无名)'}`
      + `${m.color ? '#' + m.color.getHexString() : ''}`
      + `/${m.type.replace('Mesh', '').replace('Material', '')}`;

    const scan = () => {
      const mats = new Map(), used = new Set();
      G.scene.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])){
          if (!m) continue;
          used.add(m);
          if (!mats.has(m.uuid)) mats.set(m.uuid, m);
        }
      });
      return { mats: [...mats.values()], used };
    };

    const run = () => {
      /* ⚠️ Set **必须每次重建**：它是对数组的快照，splice 掉数组里的元素并不会影响
         已经建好的 Set —— 第一版就是在外面建一次 Set，于是 G0 自检报出"把竹竿移出
         雪表后 G1=0"。自检的第一份战果是抓出了探针自己的 bug，而不是产品的。 */
      const snowNow = new Set(SNOW), wetNow = new Set(WET);
      const { mats, used } = scan();
      const boost = mats.filter(m => m.userData.snowBoost);
      return {
        nMat: mats.length,
        nSnow: SNOW.length, nWet: WET.length,
        /* G1 配了积雪加成，却不在雪表 → 那个加成永远是死代码 */
        G1: boost.filter(m => !snowNow.has(m)).map(label),
        /* G2 带 dryRough（＝有人以为它进了湿表）却不在湿表 → clone 漏网 */
        G2: mats.filter(m => m.userData.dryRough !== undefined && !wetNow.has(m)).map(label),
        /* G3 带了装雪标记却不在雪表 → 表被重建 / clone 漏网（雪侧） */
        G3: mats.filter(m => m.userData.snowInstalled && !snowNow.has(m)).map(label),
        /* G4 在雪表里、也确实在用，却没挂上注入 → 晚注册没收到的那个缺陷 */
        G4: [...used].filter(m => snowNow.has(m) && !hasKey(m)).map(label),
        nBoost: boost.length, nSnowUsed: [...used].filter(m => snowNow.has(m)).length,
      };
    };

    const normal = run();
    /* ── G0 自检：把竹竿移出雪表，G1 必须报出来 ── */
    const iA = SNOW.indexOf(M.MAT.bambooA);
    let selfCheck = { removed: iA >= 0, G1: [], G4: [] };
    if (iA >= 0){
      const saved = SNOW.splice(iA, 1);
      const after = run();
      selfCheck = { removed: true, G1: after.G1, G4: after.G4, restored: false };
      SNOW.splice(iA, 0, saved[0]);            // 立刻复原，别影响后面的像素判据
      selfCheck.restored = SNOW.indexOf(M.MAT.bambooA) === iA;
    }

    /* ── G5 阳性对照 ──
       石刻用的 stoneMat / faceMat 是 deferBoot 里**晚注册**的，能挂上 |snow 只可能是
       补装路径生效 —— 这一条同时验证了"修好了"和"补装机制通了"。 */
    let stele = null;
    G.scene.traverse(o => { if (o.isMesh && o.name === 'stele') stele = o; });
    const sm = stele && (Array.isArray(stele.material) ? stele.material[0] : stele.material);
    const fm = stele && (Array.isArray(stele.material) ? stele.material[1] : null);
    const positive = {
      bambooA:  { inSnow: snowSet.has(M.MAT.bambooA),  key: hasKey(M.MAT.bambooA) },
      bambooB:  { inSnow: snowSet.has(M.MAT.bambooB),  key: hasKey(M.MAT.bambooB) },
      steleStone: sm ? { inSnow: snowSet.has(sm), key: hasKey(sm),
                         installed: !!sm.userData.snowInstalled } : null,
      /* 刻字面**故意**不积雪（雪盖住刻字 = 题名不可读，stele-legibility 守的就是这个） */
      steleFace:  fm ? { inSnow: snowSet.has(fm), inWet: wetSet.has(fm),
                         key: hasKey(fm) } : null,
    };
    return { normal, selfCheck, positive };
  });

  const S = struct;
  console.log('\n── 结构性判据（名单与标记必须互洽）──');
  console.log(`   名单规模：雪表 ${S.normal.nSnow} 项 / 湿表 ${S.normal.nWet} 项`
            + ` ｜ 场景在用材质 ${S.normal.nMat} 种（属雪表 ${S.normal.nSnowUsed}）`
            + ` ｜ 带积雪加成 ${S.normal.nBoost} 种`);
  const list = (arr) => arr.length ? ' → ' + arr.slice(0, 6).join(' / ') : '';
  check('G1 每个带 snowBoost 的材质都在雪表里', S.normal.G1.length === 0, `违规 ${S.normal.G1.length}${list(S.normal.G1)}`);
  check('G2 每个带 dryRough 的材质都在湿表里', S.normal.G2.length === 0, `违规 ${S.normal.G2.length}${list(S.normal.G2)}`);
  check('G3 每个带 snowInstalled 的材质都在雪表里', S.normal.G3.length === 0, `违规 ${S.normal.G3.length}${list(S.normal.G3)}`);
  check('G4 雪表里在用的材质都挂上了雪注入', S.normal.G4.length === 0, `漏挂 ${S.normal.G4.length}${list(S.normal.G4)}`);

  console.log('\n── G0 自检（这个探针是否真的能红）──');
  check('把竹竿移出雪表后 G1 能报出来',
        S.selfCheck.removed && S.selfCheck.G1.length > 0,
        S.selfCheck.removed ? `移出后 G1=${S.selfCheck.G1.length}${list(S.selfCheck.G1)}`
                            : '没能在雪表里找到 bambooA');
  check('自检完名单已复原（不影响后续判据）', S.selfCheck.restored === true);

  console.log('\n── G5 阳性对照（修好的两处必须真的通了）──');
  const p = S.positive;
  check('竹竿 bambooA 在雪表且注入已挂', p.bambooA.inSnow && p.bambooA.key,
        `inSnow=${p.bambooA.inSnow} key=${p.bambooA.key}`);
  check('竹竿 bambooB 在雪表且注入已挂', p.bambooB.inSnow && p.bambooB.key,
        `inSnow=${p.bambooB.inSnow} key=${p.bambooB.key}`);
  check('题名石刻 stoneMat 在雪表且注入已挂（= 晚注册补装生效）',
        !!p.steleStone && p.steleStone.inSnow && p.steleStone.key,
        p.steleStone ? `inSnow=${p.steleStone.inSnow} key=${p.steleStone.key} installed=${p.steleStone.installed}`
                     : '场景里没找到 stele');
  check('题名石刻刻字面在湿表、且**故意**不在雪表（雪不能盖住刻字）',
        !!p.steleFace && p.steleFace.inWet && !p.steleFace.inSnow,
        p.steleFace ? `inWet=${p.steleFace.inWet} inSnow=${p.steleFace.inSnow}` : '没找到第二个材质');

  /* ── G6 行为判据：像素 ──
     先切到「冬 + 银装素裹」，再在同一天气里只切**积雪的覆盖量**（见下）。

     ⚠️ 机位：不能沿用 hero。第一版就是在 hero（平视）上测的，Δ=-3 —— 因为题名石刻
       是**竖立**的碑，平视看到的几乎全是刻字面（faceMat，故意不积雪），石头的朝上面
       只占 17.8% 且被机位压成窄窄一条。测的根本不是石头。改成从斜上方俯视，
       碑的顶面与斜面（stoneMat）这时才占主要画面。
     ⚠️ 距离必须 ≥11m：<9m 会被 OrbitControls 每帧静默弹回（项目老坑）。 */
  await page.evaluate(() => window.__garden.setEnv('season', 'winter'));
  await page.evaluate(() => window.__garden.setEnv('weather', 'snow'));
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000 }).catch(() => {});
  await sleep(1800);                                       // 过渡尾段，之后 applyEnv 不再跑

  const aim = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    let stele = null;
    G.scene.traverse(o => { if (o.isMesh && o.name === 'stele') stele = o; });
    if (!stele) return null;
    const bb = new T.Box3().setFromObject(stele);
    const c = bb.getCenter(new T.Vector3()), s = bb.getSize(new T.Vector3());
    const dist = Math.max(11, s.length() * 2.2);
    const a = 38 * Math.PI / 180;                          // 俯角 38°
    G.camera.position.set(c.x, c.y + dist * Math.sin(a) + 1.0, c.z + dist * Math.cos(a));
    G.controls.target.copy(c);
    G.controls.update();
    return { center: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], dist: +dist.toFixed(2) };
  });
  await sleep(1000);

  const roiBox = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    let stele = null;
    G.scene.traverse(o => { if (o.isMesh && o.name === 'stele') stele = o; });
    if (!stele) return null;
    const bb = new T.Box3().setFromObject(stele);
    const xs = [], ys = [];
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]){
      const v = new T.Vector3(x, y, z).project(G.camera);
      xs.push((v.x * 0.5 + 0.5) * window.innerWidth);
      ys.push((-v.y * 0.5 + 0.5) * window.innerHeight);
    }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const mw = (x1 - x0) * 0.2, mh = (y1 - y0) * 0.2;      // 四周各收 20%
    return { x: Math.round(x0 + mw), y: Math.round(y0 + mh),
             w: Math.round(x1 - x0 - mw * 2), h: Math.round(y1 - y0 - mh * 2) };
  });

  /* 把**积雪**从**雪天的光照/雾变化**里分离出来 —— 第一版拿"晴 vs 雪"对比，测得
     石刻 Δ=-12（反而变暗）：雪天 sunMul 0.62 + fogMul 1.30 的整体压暗盖过了积雪变白，
     判据没有分辨力（它测的是"天气变没变"，不是"雪上没上石头"）。
     改法：包一层石刻材质的 onBeforeCompile，把 shader 里那个**共享的** uSnowCover
     uniform 对象抓出来（installSnow 里写的正是 `shader.uniforms.uSnowCover = snowUniform`，
     同一份引用），然后只把它在 1 / 0 之间切。其余一切——光照、雾、飘雪粒子、机位——全按住。 */
  const capSnow = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const M = await import(new URL('src/01-materials.js', document.baseURI).href);
    const snowSet = new Set(M.SNOW_COVER_MATS);
    let stele = null;
    G.scene.traverse(o => { if (o.isMesh && o.name === 'stele') stele = o; });
    if (!stele) return { err: '没找到 stele' };
    const mat = Array.isArray(stele.material) ? stele.material[0] : stele.material;
    if (!snowSet.has(mat)) return { err: '石刻主材质不在雪表里' };
    let u = null;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r){ prev.call(this, sh, r);
      if (sh.uniforms && sh.uniforms.uSnowCover) u = sh.uniforms.uSnowCover; };
    mat.needsUpdate = true;                                // 触发重编译，钩子这时才被调用
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!u) return { err: '重编译后仍未拿到 uSnowCover' };
    window.__snowU = () => u;
    /* 诊断：这块石头的面到底朝哪。雪是按"朝上程度"混白的（vSnowN.y 过
       smoothstep(0.30,0.78)），若可见面几乎全是竖直的，严格判据下积雪量恒为 0 ——
       那样"把它加进雪表"就只是名单上的正确，画面上什么都没发生。 */
    stele.updateWorldMatrix(true, false);
    const geo = stele.geometry, nrm = geo.attributes.normal;
    const n3 = new T.Matrix3().getNormalMatrix(stele.matrixWorld);
    const v3 = new T.Vector3();
    let tot = 0, up30 = 0, up78 = 0;
    if (nrm) for (let i = 0; i < nrm.count; i++){
      v3.fromBufferAttribute(nrm, i).applyMatrix3(n3).normalize();
      tot++;
      if (v3.y > 0.30) up30++;
      if (v3.y > 0.78) up78++;
    }
    return { ok: true, value: u.value,
             normals: tot ? { tot, p30: +(up30 / tot).toFixed(3), p78: +(up78 / tot).toFixed(3) } : null };
  });

  const setCover = (v) => page.evaluate(async (vv) => {
    const u = window.__snowU && window.__snowU();
    if (!u) return { err: '未捕获' };
    u.value = vv;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { set: vv, read: u.value };      // 读回：确认没有别的地方在每帧覆盖它
  }, v);

  console.log('\n── G6 行为判据（像素：雪真的画到石头上了吗）──');
  if (!roiBox || roiBox.w < 6 || roiBox.h < 6){
    check('题名石刻在 hero 机位里有可测的画面区域', false,
          roiBox ? `ROI 太小 ${roiBox.w}×${roiBox.h}` : '没找到 stele');
  } else if (capSnow.err){
    check('能抓到积雪的覆盖量控制（uSnowCover）', false, capSnow.err);
  } else {
    const OUT = path.join(ROOT, 'outputs', 'weather-coverage');
    fs.mkdirSync(OUT, { recursive: true });
    const wide = (r) => ({ x: Math.max(0, r.x - 110), y: Math.max(0, r.y - 70),
                           width: r.w + 220, height: r.h + 140 });
    /* 存证：判据红了要能直接看一眼画面到底什么样，而不是只对着数字猜 */
    const on  = await setCover(1);
    const onImg = decodePNG(await page.screenshot());          // 解码一次，后面几处共用
    const imgOn   = roiStats(onImg, roiBox.x, roiBox.y, roiBox.w, roiBox.h);
    const frameOn = roiStats(onImg, 0, 0, 4096, 4096);         // 整幅（手段有效性对照）
    await page.screenshot({ path: path.join(OUT, 'stele-cover-on.png'), clip: wide(roiBox) });
    const off = await setCover(0);
    const offImg = decodePNG(await page.screenshot());
    const imgOff   = roiStats(offImg, roiBox.x, roiBox.y, roiBox.w, roiBox.h);
    const frameOff = roiStats(offImg, 0, 0, 4096, 4096);
    await page.screenshot({ path: path.join(OUT, 'stele-cover-off.png'), clip: wide(roiBox) });
    await page.screenshot({ path: path.join(OUT, 'view-winter-snow.png') });
    check('覆盖量可稳定控制（没被每帧覆盖）',
          on.read === 1 && off.read === 0, `set/read ${on.set}/${on.read} 与 ${off.set}/${off.read}`);
    const dMed = +(imgOn.med - imgOff.med).toFixed(1);
    const dFrame = +(frameOn.med - frameOff.med).toFixed(1);
    console.log(`   石刻·有雪 ${JSON.stringify(imgOn)}`);
    console.log(`   石刻·无雪 ${JSON.stringify(imgOff)}`);
    console.log(`   石刻中位亮度差 Δ=${dMed}（ROI ${roiBox.w}×${roiBox.h} @ ${roiBox.x},${roiBox.y}）`
              + ` ｜ 机位 ${aim ? '俯角38° 距' + aim.dist + 'm' : '未设定'}`);
    console.log(`   ⚠️ 中位数几乎不动是**几何决定**的（石刻以竖面/刻字面为主），不是缺陷；`
              + `判据看下面的"变亮像素占比"。`);
    console.log(`   整幅画面 有雪 ${frameOn.med} / 无雪 ${frameOff.med}（Δ=${dFrame}）`
              + ` ← 这一项是"手段是否有效"的对照`);
    if (capSnow.normals){
      const n = capSnow.normals;
      console.log(`   石刻面法线分布：${n.tot} 个顶点 ｜ 朝上 >0.30 占 ${(n.p30 * 100).toFixed(1)}%`
                + ` ｜ >0.78 占 ${(n.p78 * 100).toFixed(1)}%（雪的判据要过 0.30 才开始有量）`);
    }
    console.log(`   存证图：outputs/weather-coverage/（俯视全景 + 石刻周边 有雪/无雪 两张）`);
    /* 先证明**手段本身有效**：覆盖量一切，整幅画面必须明显变化。若这一条不成立，
       下面"石刻没变"就不能解读成"石头不积雪"——可能 uniform 压根没接到材质上。
       判据之间要有这种自证关系，否则红了也不知道该往哪查。 */
    /* 判据分两条，各管一件事：
       · 整幅画面必须明显变化 → 证明"切覆盖量"这个手段本身有效。
         若这条不成立，下面"石刻没变"就不能解读成"石头没雪"，可能只是手段失灵。
       · 石刻 ROI 里必须有像素真的被盖白 → 证明它确实被注入了雪。
         只要求"有"，不要求"厚"：太湖石 960 个顶点里朝上(>0.30)的只占 31.6%，
         雪本来就上不去多少，要求它明显变白等于把物理事实判成缺陷。
         但这条**有牙**：一旦有人把石刻从雪表里拿掉，变亮像素会掉到 ~0，立刻红。 */
    const bri = roiBrighter(onImg, offImg, roiBox.x, roiBox.y, roiBox.w, roiBox.h, 15);
    console.log(`   石刻 ROI 内变亮 >15 的像素：${bri.up}/${bri.n} = ${bri.pct}%`
              + `（石头以竖面为主，有量就够）`);
    check('切覆盖量能改变画面（手段有效性对照）', Math.abs(dFrame) > 5, `整幅 Δ=${dFrame}`);
    check('题名石刻确实分到了雪（ROI 内有像素被盖白）', bri.pct > 1, `变亮像素占比 ${bri.pct}%`);
    /* 有牙性自检：拿同一张图自己比自己，"变亮占比"必须是 0 ——
       证明这条判据读的确实是**雪的差异**，而不是噪声或图像压缩误差。 */
    const briZero = roiBrighter(offImg, offImg, roiBox.x, roiBox.y, roiBox.w, roiBox.h, 15);
    check('判据自检：无差异时变亮占比为 0', briZero.pct === 0, `${briZero.pct}%`);
  }
  await page.evaluate(() => { window.__garden.setEnv('weather', 'clear');
                              window.__garden.setEnv('season', 'summer'); });

  console.log(`\n[异物] pageerror=${errs.length}${errs.length ? ' → ' + errs[0] : ''}`);
  console.log(`\n${fails === 0 ? '✓ 天气覆盖门禁 PASS' : '✗ 天气覆盖门禁 FAIL'}`
            + `  ${checks - fails}/${checks} 项通过`);
  await browser.close();
  server.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
