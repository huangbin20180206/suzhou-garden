// 阴影烘焙 · 结论状态门禁：node probe/shadow-bake-guard.mjs
//
// ── 这道门守的是「不烘焙」这个结论的**前提**（2026-09-26 阶段 A 诊断）──
// 离线把静态几何的阴影预烘成贴图、运行时零开销，理论上很美。本项目判为**不可行**，
// 理由是结构性的，不是"暂时没时间做"：
//
//   ① 太阳方向是**连续**的。src/12-env.js 的 hourSeg() 在 晨/午/暮/夜 四段之间对
//      sunPos 做**线性插值**（morning→noon 跨 5h、noon→dusk 跨 5h、dusk→night 跨 4h），
//      拖时辰滑杆时方向连续变化。实测太阳主导时段 h∈[6.5,19]、全天弧长 **180°**、
//      8° 口径下 **11 个**显著独立方向 ⇒ 有限张烘焙图在采样之间必然错位。
//   ② 错位量 = 投射物高度 × tan(Δθ)。实测投射物高度 p50 = 2.64m（p90 8.11m），
//      要把错位压到 2 个 texel 以内（阴影才看不出滑），Δθ 得小到零点几度，
//      实测需 **104~335 张** 2048² 以上的阴影图（low/mid/high 三档）。
//   ③ 更硬的墙：Three.js 的阴影着色器是 `shadow *= getShadow(...)` —— 多盏方向光的
//      阴影**连乘**，没有"按权重混合 N 张烘焙图"的路径。要混合就得自己重写阴影采样，
//      那等于把 CSM / variance shadow map 重新实现一遍。而**标准 CSM 在本项目已被
//      实测判定为负优化并完全回退**（见 CODELY.md：相机 far=900 一眼看全园，
//      不夹全场则 texel 密度只有 0.74/m，夹回全场盒则三级级联退化成同一个 76m 盒）。
//
// ⇒ 所以这道门不守"有没有烘焙产物"，而是**守着上面三条前提仍然成立**：
//    哪天有人重提烘焙，这道门会立刻告诉他前提变没变，不必再从头实测一轮。
//
// ⚠️ 已排除的替代路径（别重复做）：多方向光 CSM（负优化，已回退）；
//    直接把阴影贴图提到 8192（显存与 shadow pass 带宽约 4 倍，收益远小于代价）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

/* 判定"不可行"的门槛：把错位压进 2 texel 所需的烘焙张数。≥24 张即判不可行 ——
   24 张 2048² 光栅深度图已经 ~96MB，且要混合就得重写阴影采样（见文件头 ③）。 */
const INFEASIBLE_MAPS = 24;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(240000);
  const errs = []; page.on('pageerror', e => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  const r = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const E = await import(new URL('src/12-env.js', document.baseURI).href);
    const { sun } = await import(new URL('src/09-lights.js', document.baseURI).href);

    /* ① 太阳方向连续。⚠️ 两个必须踩准的点：
       · 时辰必须走**滑杆的 input handler**：ENV.cur 只在 handler 里由 composeEnv(paramsAtHour)
         重算。直接给 ENV.hour 赋值、或 setEnv 之后立刻 applyEnv(ENV.cur)，都只会重放**旧值** ——
         实测那样 48 个采样点的方向一步不动、弧长只有 38°，会得出"太阳整天不动、烘焙很容易"
         的**反向假结论**。再把 ENV.t 推到 0.994，下一帧缓动一步到位。
       · 夜里那盏"太阳灯"是**月光替身**：starAmount>0.45 且月亮升到可见窗口时主光交给月亮。
         混进来会出现 80°~135° 的假跳变（实测 h=5.5 / h=19.5）。判据取 applyEnv 的接管式。 */
    const all = [];
    for (let h = 0; h < 24; h += 0.5){
      const el = document.getElementById('hourSlider');
      el.value = String(h);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      E.ENV.t = 0.994;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const night = Math.max(0, Math.min(1, E.ENV.cur.starAmount || 0));
      const d = sun.position.clone().normalize();
      all.push({ h, night, day: night <= 0.45, d: [d.x, d.y, d.z] });
    }
    const day = all.filter(s => s.day);
    const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]))) * 180 / Math.PI;
    let arc = 0; const steps = [];
    for (let i = 1; i < day.length; i++){
      const a = ang(day[i-1].d, day[i].d);
      steps.push(a);
      if (a < 60) arc += a;                        // ≥60° 视为断点，不计入弧长
    }
    const sorted = steps.slice().sort((a, b) => a - b);
    const medianStep = sorted[sorted.length >> 1];
    const maxStep = sorted[sorted.length - 1];
    // 显著独立方向数（8° 口径：小于 8° 的两个方向，其投影差异在一片叶的尺度上分不出）
    const cs = [];
    for (const s of day){
      let best = -1, bd = 1e9;
      for (let i = 0; i < cs.length; i++){ const dd = ang(cs[i], s.d); if (dd < bd){ bd = dd; best = i; } }
      if (best >= 0 && bd <= 8) cs[best] = s.d; else cs.push(s.d);
    }

    /* ② 投射物高度 p50（世界系：setFromObject 走 matrixWorld，不是裸几何 bbox） */
    const hs = [];
    G.scene.traverse(o => {
      if (!o.castShadow || !o.geometry) return;
      const b = new T.Box3().setFromObject(o);
      const h = b.max.y - b.min.y;
      if (h > 0.05 && h < 60) hs.push(h);
    });
    hs.sort((a, b) => a - b);
    const hp50 = hs.length ? hs[hs.length >> 1] : 0;

    const sc = sun.shadow.camera;
    return {
      daySamples: day.length, moonSamples: all.length - day.length,
      dayFrom: day[0] && day[0].h, dayTo: day[day.length - 1] && day[day.length - 1].h,
      arcDeg: +arc.toFixed(1), medianStep: +medianStep.toFixed(3), maxStep: +maxStep.toFixed(2),
      clusters8: cs.length,
      casters: hs.length, hp50: +hp50.toFixed(2),
      mapSize: sun.shadow.mapSize.x, camFar: +G.camera.far.toFixed(0),
      // 前提 ③：阴影视体必须罩住全场（shadow-cover 的既有契约）⇒ texel 尺寸
      shadowBox: +(sc.right - sc.left).toFixed(1),
      texelCm: +((sc.right - sc.left) / sun.shadow.mapSize.x * 100).toFixed(2),
      dirLights: (() => { let n = 0; G.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) n++; }); return n; })(),
      bakedShadows: (() => { let n = 0; G.scene.traverse(o => { if (o.userData && (o.userData.bakedShadow || o.userData.shadowBake)) n++; }); return n; })(),
    };
  });

  /* 每张图能摊到的角度：错位 = H·tan(Δθ) ≤ 2 texel ⇒ Δθ = atan(2·texel/H)。
     ⚠️ 括号不能省：JS 的 `/` 与 `*` **同优先级、左结合**，写成
     `arc / atan(x) * 180 / PI` 会算成 (arc/atan(x))×180/PI —— 实测给出 1048388
     （正好 2^20）这种一眼假的数，而判据 need >= 24 照样"通过"。
     门禁自己骗自己比门禁报红更糟，所以下一条专门自检这个量级，并把 degPerMap 打出来供人核对。 */
  const degPerMap = Math.atan((2 * r.texelCm / 100) / r.hp50) * 180 / Math.PI;
  const need = Math.ceil(r.arcDeg / degPerMap);

  console.log('── 太阳路径（已剔除月亮时段）──');
  check('前提 0：能采到连续的太阳主导样本（≥20 个 0.5h 采样点）',
        r.daySamples >= 20, `${r.daySamples} 个（h∈[${r.dayFrom}, ${r.dayTo}]），剔掉 ${r.moonSamples} 个月亮时段`);
  check('前提 ①：太阳方向随时辰**连续**变化，不是几个固定角（步进中位数 > 0.2°）',
        r.medianStep > 0.2, `相邻 0.5h 步进 中位 ${r.medianStep}° 最大 ${r.maxStep}°`);
  check('前提 ①：显著独立方向数 ≥ 8（8° 口径）',
        r.clusters8 >= 8, `${r.clusters8} 个 / 总弧长 ${r.arcDeg}°`);

  console.log('\n── 烘焙代价（错位压进 2 texel）──');
  check('前提 ②：投射物中位高度 > 1m（越高越吃角度误差）',
        r.hp50 > 1.0, `p50=${r.hp50}m，${r.casters} 个投射物`);
  check(`前提 ②：要不出错需 ≥ ${INFEASIBLE_MAPS} 张烘焙图 ⇒ 离散烘焙不可行`,
        need >= INFEASIBLE_MAPS,
        `需 ${need} 张｜每张摊 ${degPerMap.toFixed(3)}°（H=${r.hp50}m, texel=${r.texelCm}cm, 弧长 ${r.arcDeg}°）`);
  check('算术自检：每张摊的角度在合理量级（0.05°~5°）—— 防止上面的括号被改坏后假绿',
        degPerMap > 0.05 && degPerMap < 5, `${degPerMap.toFixed(3)}°/张`);

  console.log('\n── 结构前提 ──');
  check(`前提 ③：相机 far 很大（${r.camFar}m）⇒ 近级小视锥换密度这条路已被证伪（CSM 已回退）`,
        r.camFar >= 500, `far=${r.camFar}m，阴影视体宽 ${r.shadowBox}m / ${r.mapSize}²`);
  check('前提 ③：场景里只有 1 盏投影方向光（多盏会连乘压暗，不是混合）',
        r.dirLights === 1, `${r.dirLights} 盏`);
  check('结论仍成立：场景里不存在任何烘焙阴影产物（真要做，这道门该改口径）',
        r.bakedShadows === 0, `${r.bakedShadows} 个`);

  check('零 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  const fails = results.filter(x => !x.ok).length;
  console.log(`\n[shadow-bake-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[shadow-bake-guard] 探针异常：', e); process.exit(2); });
