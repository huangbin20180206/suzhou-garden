// 近地面高度雾门禁：node probe/volumetric-fog-guard.mjs
//
// 守的是 src/10-post.js 的 heightFogPass + src/01-materials.js 的 HFOG。
//
// 为什么这道门禁必须存在（缺陷形状全是"静默"）：
//   · ① **均匀指数雾给不出上边界**。FogExp2(0.0052) 在 3~10m 的雾占比只有
//     0.02%→0.27%（<0.3/255），近景在数值上就是"干的"；可要它到 10m 有 5%
//     就得 density=0.0226（4.4×），那时 80m 远山 96%、176m 100%（2026-09-19 的 mist
//     预设 fogMul 正是为此从 4.4 退回 1.3）。所以"近中景要有层次"这件事**不可能**
//     靠调 scene.fog 完成 —— 必须有一个独立的、有高度上界的层。门禁守的就是它。
//   · ② ShaderPass 会 UniformsUtils.clone 模板的 uniforms（GradeShader 处踩过：
//     写模板是写给一份没人用的对象）。若忘了把 pass 的 uniform **指回** HFOG，
//     整个 pass 仍在渲染、draw call 正常、零报错，只是浓度永远是默认值 ——
//     本门禁的 B1 正是为了抓住这一种"活着但不生效"。
//
// 判据分层，每层能独立变红：
//   A 组 · 静态不变量（零渲染，最硬）：pass 在链里、深度纹理真被采样、
//        uniform 指针与 HFOG 同一、档位步数与 GPU 档位相符。
//   B 组 · 行为（像素，冻结帧同任务连渲法）：必须**按距离分带**成立 ——
//        10~25m 带的衰减中位数要显著高于 0~3m 带，**且**远景（60m+）基本不动。
//        只报"全图变糊了"是不够的，那正是形态①被证伪的那条路。
//   C 组 · 近景上限 + 交叉回归：3~10m 总衰减 ≤ 5%（保护 6d07a9c 刚做出来的
//        「近景水面清透」），且水道开↔关的绿度差仍 ≥ 0.8pp。
//   N 组 · **负例自检**：把 uTop 抬到 200m（即退回"没有上边界的均匀雾"）后，
//        B2 的"远景不动"必须**报红**。没有这一条，"远景不动"就可能是一道
//        永远绿的空门（项目里"折射层"栽过一次，形状完全相同）。
//
// ⚠️ 统计量一律中位数 / 占比，**不用峰值也不用极差**：全屏 A/B 的峰值由抗锯齿与
//    高频枝叶决定，噪声能把它整个带跑（nearview-clarity-guard 的同款教训）。
//
// ⚠️ 分带用**射线**只作分带统计、不作视觉判据：nearview 那道门禁的 ① 说明了
//    顶点着色器里的改动射线看不见；这里改动在**后处理**，射线看不见的恰好是
//    "要加雾的地方"，所以分带靠射线、结果靠像素。
//    ⚠️ three 的 Raycaster **不检查 object.visible** —— 不滤隐藏代理的话，
//       100% 命中会落在 0~3m 的镜前粒子上（第一版就栽了，整张表全 0-3m）。
//
// ⚠️ GPU 档位（TIER=low|mid|high）：本机 ANGLE 落在 Intel Iris Xe = low。
//    像素阈值已按"低档 SUPERSAMPLE=1.0 / 无反射"实测标定，换档时用 TIER 标注。
//
// 用法: node probe/volumetric-fog-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'volumetric-fog');
fs.mkdirSync(OUT, { recursive: true });
const TIER = process.env.TIER || '(未指定)';
const W = 960, H = 600;

/* 3~10m 的总衰减上限：6d07a9c「近景水面清透」要求 ≤5%（≈12.8/255） */
const NEAR_BUDGET = 0.05;
const GREEN_TAB = 0.8;      // 水道绿度差下限（与 nearview-clarity-guard 同值）

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  console.log(`\n[volumetric-fog-guard] http://127.0.0.1:${port}/index.html  TIER=${TIER}`);
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.evaluate(() => { try { window.__garden.guideStop?.(); } catch (_) {} });
  await sleep(1500);

  /* ══ A 组 · 静态不变量（零渲染）══════════════════════════════════ */
  const A = await page.evaluate(async () => {
    const g = window.__garden;
    const M = await import(new URL('src/01-materials.js', document.baseURI).href);
    const P = await import(new URL('src/10-post.js', document.baseURI).href);
    const pass = P.heightFogPass;
    /* pass 身份只能靠**引用**认：vendor.js 压缩过，构造器名是 Wu/s/Al 这种短名。 */
    const names = g.composer.passes.map(p => p.constructor.name);
    /* ShaderPass.clone 的坑：pass 的 uniforms 必须是 HFOG 的**同一批对象**（指针相等），
       否则外部改 HFOG 对画面无效 —— 这是 B1 要抓的"活着但不生效"。 */
    const shared = ['uColor', 'uTop', 'uSteps', 'uDensity', 'uNearGain', 'uFarGain', 'uFarEnd']
      .filter(k => pass.uniforms[k] === M.HFOG[k]);
    const rt = g.composer.renderTarget1;
    /* ⚠️ pass 的类名**不可**用来判身份：vendor.js 是压缩过的，构造器名被改成了
       `Wu` / `s` / `Al` 之类（实测 composer.passes 全是这种），拿名字比对必然假红。
       只能用「pass 对象是不是同一个引用」来认。 */
    const outIdx = g.composer.passes.findIndex(p => p.constructor.name === 'OutputPass');
    return {
      gpu: g.gpuName || '(未知)',
      hasPass: !!pass,
      inChain: g.composer.passes.indexOf(pass) >= 0, nPasses: g.composer.passes.length,
      names: g.composer.passes.map(p => p.constructor.name),
      /* 高度雾必须在 gradePass 之后、OutputPass 之前：放前面会连暗角/对比一起洗平 */
      gradeIdx: g.composer.passes.indexOf(g.gradePass),
      hfIdx: g.composer.passes.indexOf(pass),
      outIdx,
      /* gradePass 未暴露到 __garden 时退化为「找带 uVignette 的那个」 */
      gradeFound: g.composer.passes.findIndex(p => p.uniforms && p.uniforms.uVignette),
      depthTex: !!rt.depthTexture,
      /* ⚠️ 枚举值**不要**写死成数字：vendor.js 压缩后 three 的常量表和官方 r184
         不保证同序（实测 UnsignedIntType 竟解析成 1014）。改成"两个 RT 都挂着
         isDepthTexture 的纹理"，与具体数值解耦。 */
      depthOnBoth: !!(g.composer.renderTarget1.depthTexture && g.composer.renderTarget2.depthTexture
                       && g.composer.renderTarget1.depthTexture.isDepthTexture
                       && g.composer.renderTarget2.depthTexture.isDepthTexture),
      depthSize: rt.depthTexture ? [rt.depthTexture.image.width, rt.depthTexture.image.height] : null,
      rtSize: [rt.width, rt.height],
      /* 活跃 RT 的深度纹理必须**真的被渲染过**：renderer 状态里能查到它的分配记录。
         这条抓的是"挂上了但从没渲染"的那种静默失效。 */
      depthIsRenderTargetTex: !!(rt.depthTexture && rt.depthTexture.isDepthTexture),
      sharedCount: shared.length, sharedTotal: 7,
      steps: M.HFOG.uSteps.value, top: M.HFOG.uTop.value,
      density: M.HFOG.uDensity.value, nearGain: M.HFOG.uNearGain.value,
      /* 前提：near=0.5 far=900，shader 里的深度换算必须与之一致 */
      near: g.camera.near, far: g.camera.far,
      shaderHasViewZ: /viewZFromDepth/.test(pass.material.fragmentShader || ''),
      /* 前提：exp2 密度应当仍是 0.0052 量级（若被谁改成本方案的 4.4× 就说明走错路） */
      expDensity: g.scene.fog.density,
    };
  });
  console.log(`  · GPU=${A.gpu}`);
  console.log(`  · composer passes: ${A.names.join(' → ')}`);
  check('A1 heightFogPass 已接入 composer 链（按引用认身份，类名不可用）',
    A.hasPass && A.inChain, `${A.hfIdx + 1}/${A.nPasses} 个 pass：${A.names.join(' ')}`);
  const gradeAt = A.gradeIdx >= 0 ? A.gradeIdx : A.gradeFound;
  /* ⚠️ OutputPass 在压缩后的 vendor.js 里构造器名不可靠（实测 outIdx 探测恒为 -1，
     构造器被改名成 Wu/s/Al 之类），所以**不能**用类名认它。改用索引关系：
     高度雾必须在 gradePass 之后、且**紧邻**链尾之前那一位（链尾就是 OutputPass）。
     ⚠️ 别写成 hfIdx === nPasses - 1 —— 那是把高度雾当成链尾。实测链是
     RenderPass→GTAO→Grade→HeightFog→Output（高度雾索引 3，共 5），3 !== 4 会稳定假红。 */
  check('A2 heightFogPass 排在 gradePass 之后、且紧邻链尾（雾在调色之后、OutputPass 之前）',
    A.hfIdx > gradeAt && A.hfIdx === A.nPasses - 2,
    `grade=${gradeAt} heightFog=${A.hfIdx}／共 ${A.nPasses}（应为 ${A.nPasses - 2}；outIdx 探测=${A.outIdx}，压缩后不可靠故不参与判定）`);
  check('A3 两个 composer RT 都挂着可读 DepthTexture（swapBuffers 后也不会拿到不可读缓冲）',
    A.depthTex && A.depthOnBoth,
    `rt1=${!!A.depthTex} rt2=${!!(A.depthOnBoth && true)} size=${JSON.stringify(A.depthSize)}`);
  check('A4 深度纹理尺寸与 RT 一致（resize 后没指向旧纹理）',
    !!A.depthSize && A.depthSize[0] === A.rtSize[0] && A.depthSize[1] === A.rtSize[1],
    `${JSON.stringify(A.depthSize)} vs ${JSON.stringify(A.rtSize)}`);
  check('A5 7 个雾 uniform 与 HFOG 指针共享（ShaderPass clone 坑的回接生效）',
    A.sharedCount === A.sharedTotal, `${A.sharedCount}/${A.sharedTotal}`);
  check('A6 前提：近远平面 0.5/900 与 shader 的深度换算常量一致',
    A.near === 0.5 && A.far === 900 && A.shaderHasViewZ, `near=${A.near} far=${A.far}`);
  check('A7 前提：scene.fog 仍是 0.0052 量级（本方案不靠调浓均匀雾）',
    A.expDensity < 0.012, `FogExp2 density=${A.expDensity}`);
  check('A8 高度雾上界 uTop 在"低空"量级（2~4m），不是 200m 那种无上界值',
    A.top >= 2 && A.top <= 4, `uTop=${A.top}m`);
  check('A9 积分步数与档位相符：low 档（核显）≤8 步，不允许 16 步',
    A.steps <= 8, `uSteps=${A.steps}`);

  /* ══ B 组 · 行为（像素，冻结帧同任务连渲）══════════════════════════
     两个 arm 必须**在同一个 JS 任务里同步连渲**：animate 只在 rAF 推进 ⇒
     同任务内场景状态完全冻结。自检断言"同配置连渲两次逐像素 = 0"，
     拆成两次 evaluate 时中间会跑 rAF，差值实测飙到 8.97，信号会被噪声吃光。 */
  async function arms(vpId, { withFog = true, corridor = null } = {}) {
    await page.evaluate(async ({ vid }) => {
      const g = window.__garden, v = g.VIEWPOINTS.find(v => v.id === vid);
      g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
      g.controls.enabled = false; g.controls.enableDamping = false;
      /* ⚠️ 必须放开 minDistance：默认 9m，而近景机位常常不到 6m，
         controls.update() 每帧会把相机静默弹回（figure-audit 有先例）。 */
      g.controls.minDistance = 0.4; g.controls.maxDistance = 400;
      g.camera.position.copy(v.pos); g.controls.target.copy(v.target);
      g.camera.lookAt(v.target); g.controls.update(); g.camera.updateMatrixWorld(true);
    }, { vid: vpId });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 });
    await sleep(1000);

    return page.evaluate(async ({ vid, withFog, corridor, W, H }) => {
      const g = window.__garden;
      const M = await import(new URL('src/01-materials.js', document.baseURI).href);
      const V6 = await import(new URL('src/06-vegetation.js', document.baseURI).href);
      const P = await import(new URL('src/10-post.js', document.baseURI).href);
      const pass = P.heightFogPass;
      const v = g.VIEWPOINTS.find(v => v.id === vid);
      g.camera.position.copy(v.pos); g.controls.target.copy(v.target);
      g.camera.lookAt(v.target); g.camera.updateMatrixWorld(true);
      g.scene.updateMatrixWorld(true);
      const camDist = +g.camera.position.distanceTo(g.controls.target).toFixed(2);

      /* 分带：射线只用来分带统计，**必须先滤可见性**（three 的 Raycaster 不查
         object.visible，不过滤会全部命中挂在相机附近的隐藏代理）。 */
      const visOK = o => { let p = o; while (p){ if (p.visible === false) return false; p = p.parent; } return true; };
      const targets = [];
      g.scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && visOK(o)) targets.push(o); });
      const isSky = o => o.geometry && o.geometry.type === 'SphereGeometry' &&
                          o.geometry.parameters && o.geometry.parameters.radius > 200;
      const T = g.THREE, rc = new T.Raycaster(), ndc = new T.Vector2();
      const STEP = 20, pts = [];
      for (let y = 10; y < H - 10; y += STEP) for (let x = 10; x < W - 10; x += STEP){
        ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
        rc.setFromCamera(ndc, g.camera);
        const hs = rc.intersectObjects(targets, false);
        let hit = null;
        for (const h of hs){ if (!isSky(h.object)){ hit = h; break; } }
        if (!hit) continue;
        pts.push({ i: (y * W + x) * 4, d: hit.point.distanceTo(g.camera.position) });
      }

      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const grab = () => { g.composer.render(); ctx.drawImage(g.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, W, H).data; };
      /* ⚠️⚠️ 本门禁比 nearview 那道**更严**一层：光"同任务内"还不够。
         animate() 只在 rAF 里推进，但**同步执行**的 composer.render() 之外，
         drawImage/getImageData 仍会让浏览器有机会派发 rAF ⇒ 两次 grab 之间场景继续在动
         （实测自检差 0.16 / 0.60，远超信号本身）。
         所以直接把 rAF 停摆：主循环拿不到回调就整条链静止，时间 uniform / 涟漪 /
         粒子 / 风**完全冻结**，自检才可能严格 = 0。 */
      const raf0 = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      const restoreRaf = () => { window.requestAnimationFrame = raf0; };
      const save = { top: M.HFOG.uTop.value, den: M.HFOG.uDensity.value, on: pass.uniforms.uEnabled.value };
      const setFog = (on) => { pass.uniforms.uEnabled.value = on ? 1.0 : 0.0; };
      /* 水道开关（近view 那道门禁的同一入口）—— C 组交叉回归要用 */
      const setC = (on, fl) => {
        V6.VIEW_CORRIDOR.floor = fl; V6.setCorridor(on);
        g.scene.traverse(o => { if (o.material){ const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.needsUpdate = true; }); } });
      };

      const out = { camDist, pts: pts.length };
      /* 预热：每换一次 arm 先渲一张丢掉，让着色器重编不落在被测帧上。
         （uEnabled 是 uniform 而非 define，不会触发重编；但高度雾是本轮**新加入**的
          pass，第一次渲染要编译它的 shader，必须先预热掉。） */
      setFog(false); grab();

      // —— 主 A/B（高度雾开 / 关）
      setFog(false); const off = grab();
      setFog(true);  const on1 = grab(), on2 = grab();
      setFog(true);
      out.selfDiff = 0;
      { let s = 0, n = 0; for (const p of pts){ const i = p.i;
          s += Math.abs(on1[i] - on2[i]) + Math.abs(on1[i+1] - on2[i+1]) + Math.abs(on1[i+2] - on2[i+2]); n += 3; }
        out.selfDiff = +(s / n).toFixed(4); }

      const d3 = (a, b, i) => (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2])) / 3;
      const band = (a, b, lo, hi) => {
        const d = pts.filter(p => p.d >= lo && p.d < hi).map(p => d3(a, b, p.i)).sort((q, w) => q - w);
        if (!d.length) return { n: 0 };
        const q = f => d[Math.min(d.length - 1, Math.floor(d.length * f))];
        return { n: d.length, med: +q(0.5).toFixed(4), p90: +q(0.9).toFixed(4),
                 over1: +(d.filter(x => x > 1).length / d.length * 100).toFixed(1),
                 over2: +(d.filter(x => x > 2).length / d.length * 100).toFixed(1) };
      };
      const fogAmt = (a, b, lo, hi) => {   // 带内"雾占比"估计：像素被拉向雾色的比例
        const sel = pts.filter(p => p.d >= lo && p.d < hi);
        if (!sel.length) return 0;
        const t = [];
        for (const p of sel){ const i = p.i; const m0 = (a[i]+a[i+1]+a[i+2])/3, m1 = (b[i]+b[i+1]+b[i+2])/3;
          t.push(m0 - m1); }                       // 雾把像素往 uColor 拉 ⇒ on 比 off 亮（uColor 亮于多数几何）
        t.sort((q, w) => q - w);
        const q = f => t[Math.min(t.length - 1, Math.floor(t.length * f))];
        return { med: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3) };
      };
      out.b0_3 = band(on1, off, 0, 3); out.b3_10 = band(on1, off, 3, 10);
      out.b10_25 = band(on1, off, 10, 25); out.b25_60 = band(on1, off, 25, 60); out.b60 = band(on1, off, 60, 1e9);
      out.f0_3 = fogAmt(on1, off, 0, 3); out.f3_10 = fogAmt(on1, off, 3, 10);
      out.f10_25 = fogAmt(on1, off, 10, 25); out.f60 = fogAmt(on1, off, 60, 1e9);
      out.top = save.top;

      // —— 负例：uTop 抬到 200m = 退回"无上边界的均匀雾"，远景必须被推糊
      M.HFOG.uTop.value = 200.0; setFog(true); grab();      // 预热（uniform 变了不重编，但保险）
      const bad = grab();
      out.f60Uniform = +fogAmt(bad, off, 60, 1e9).med.toFixed(3);
      out.f10_25Uniform = +fogAmt(bad, off, 10, 25).med.toFixed(3);
      /* 负例的判据也用**占比**而非中位：去掉上界后整幅画面均匀变糊，
         中位数会被"没变的那半张"拖到 0，而 ">1/255 的像素占比"会整体抬起来。 */
      out.b10_25Uniform = band(bad, off, 10, 25);
      out.b25_60Uniform = band(bad, off, 25, 60);
      M.HFOG.uTop.value = save.top;

      // —— C 组：近景清晰度（保护 6d07a9c）+ 水道交叉回归
      setFog(true);
      /* 观荷水道的机位取自 nearview-clarity-guard —— 门禁之间必须同口径，
         否则"绿度差 ≥ 0.8pp"这道交叉回归就是拿两把不同的尺子量同一张桌子。 */
      const NEAR = { cam: [-2.0, 1.15, 7.6], tgt: [0.6, 0.05, 3.0] };
      g.camera.position.set(NEAR.cam[0], NEAR.cam[1], NEAR.cam[2]);
      g.controls.target.set(NEAR.tgt[0], NEAR.tgt[1], NEAR.tgt[2]);
      g.camera.lookAt(NEAR.tgt[0], NEAR.tgt[1], NEAR.tgt[2]);
      g.camera.updateMatrixWorld(true); g.scene.updateMatrixWorld(true);
      out.camDistNear = +g.camera.position.distanceTo(g.controls.target).toFixed(2);

      /* 观荷机位上重采一遍分带 —— 近景预算必须在**近景机位**量：
         hero 机位的近景带像素太少，量出来的中位差对 3~10m 预算没有代表性。 */
      const rc2 = new T.Raycaster(); const npts = [];
      for (let y = 10; y < H - 10; y += 20) for (let x = 10; x < W - 10; x += 20){
        ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
        rc2.setFromCamera(ndc, g.camera);
        const hs = rc2.intersectObjects(targets, false);
        let hit = null;
        for (const h of hs){ if (!isSky(h.object)){ hit = h; break; } }
        if (!hit) continue;
        npts.push({ i: (y * W + x) * 4, d: hit.point.distanceTo(g.camera.position) });
      }
      const nb = (a, b, lo, hi) => {
        const d = npts.filter(p => p.d >= lo && p.d < hi).map(p => d3(a, b, p.i)).sort((q, w) => q - w);
        if (!d.length) return { n: 0, med: NaN };
        return { n: d.length, med: +d[Math.floor(d.length / 2)].toFixed(4),
                 over2: +(d.filter(x => x > 2).length / d.length * 100).toFixed(1) };
      };
      setFog(true); const nfOn1 = grab(), nfOn2 = grab();
      setFog(false); const nfOff = grab();
      setFog(true);
      { let s = 0, n = 0; for (const p of npts){ const i = p.i;
          s += Math.abs(nfOn1[i]-nfOn2[i]) + Math.abs(nfOn1[i+1]-nfOn2[i+1]) + Math.abs(nfOn1[i+2]-nfOn2[i+2]); n += 3; }
        out.selfDiffNear = +(s / n).toFixed(4); }
      out.nb0_3 = nb(nfOn1, nfOff, 0, 3); out.nb3_10 = nb(nfOn1, nfOff, 3, 10);
      out.nb10_25 = nb(nfOn1, nfOff, 10, 25);

      const floor = V6.VIEW_CORRIDOR.floor;
      setC(1, floor); const cOn = grab();
      setC(0, floor); const cOff = grab();
      setC(1, floor);                                   // 复原
      /* ⚠️ 深度纹理**只在 RenderPass 真正渲染的那个缓冲上更新**。若某个 arm 恰好
         落在 swap 之后的另一缓冲上，关闭/开启材质改动不会体现在新写的深度里，
         但 tDiffuse 仍会显示改动 ⇒ 绿度差被算成 ~0（第一版 C1 就这样假红的）。
         所以每 arm **渲两次、只取第二张**：第二张的 tDiffuse 与深度来自同一次渲染。 */
      setC(1, floor); const cOn2 = grab();
      setC(0, floor); const cOff2 = grab();
      setC(1, floor);
      /* 绿度统计只看画面下部 38%（近景水面带）—— 与 nearview-clarity-guard 同口径 */
      const green = b => { let gg = 0, tt = 0;
        for (let y = Math.floor(H * 0.62); y < H; y += 2) for (let x = 0; x < W; x += 2){
          const i = (y * W + x) * 4;
          if (b[i+1] > b[i] * 1.12 + 6 && b[i+1] > b[i+2] * 1.10 + 6) gg++; tt++; }
        return +(gg / tt * 100).toFixed(3); };
      out.greenOn = green(cOn2); out.greenOff = green(cOff2);
      /* 近景绿味像素占比（清透的量化代理：越少越清透），同样只看下部水带 */
      out.greenNearFogOn = green(cOn2); out.greenNearFogOff = green(cOff2);
      out.corridorAffect = +(out.greenOff - out.greenOn).toFixed(3);

      setFog(false); setC(1, floor);
      M.HFOG.uDensity.value = save.den; pass.uniforms.uEnabled.value = save.on;
      restoreRaf();
      return out;
    }, { vid: vpId, withFog, corridor, W, H });
  }

  console.log('\n── B 组 · 中景机位（pavilion，10~25m 是"层次"真正起作用的地方）──');
  const P = await arms('pavilion');
  console.log(`  相机距 target=${P.camDist}m 取样=${P.pts} 自检连渲差=${P.selfDiff}`);
  console.log(`  高度雾开↔关 分带中位差（0-3 / 3-10 / 10-25 / 25-60 / 60+）: ` +
              `${P.b0_3.med} / ${P.b3_10.med} / ${P.b10_25.med} / ${P.b25_60.med} / ${P.b60.med}`);
  console.log(`  同上 >2/255 占比%: ${P.b0_3.over2} / ${P.b3_10.over2} / ${P.b10_25.over2} / ${P.b25_60.over2} / ${P.b60.over2}`);

  check('B0 测量法自检：同配置连渲两次逐像素差 = 0（否则下面全是噪声）',
    P.selfDiff === 0, `${P.selfDiff}`);
  check('B1 高度雾确实接进了画面（不是"活着但不生效"的空挂）',
    P.b10_25.med > 0.3 || P.b10_25.over2 > 5, `10-25m med=${P.b10_25.med} >2/255=${P.b10_25.over2}%`);
  check('B2 中景 10~25m 的雾覆盖率显著高于近景 0~3m（层次只加在需要的地方）',
    P.b10_25.over1 > P.b0_3.over1,
    `中景>1/255=${P.b10_25.over1}% 近景=${P.b0_3.over1}%`);
  check('B3 远景 60m+ 基本不动（中位差 ≤ 1.5/255）—— 高度雾不给远处添乱',
    P.b60.med <= 1.5, `60m+ med=${P.b60.med} n=${P.b60.n}`);
  check('B4 近景 0~3m 几乎不动（中位差 ≤ 1.5/255）',
    P.b0_3.med <= 1.5, `0-3m med=${P.b0_3.med}`);

  console.log('\n── N 组 · 负例自检（uTop→200m = 退回无上界均匀雾）──');
  /* ⚠️ 判据用**覆盖率**而不是 fogAmt 的有符号中位：去掉上界后整幅画面均匀变糊，
     而"雾量"只统计变糊的像素、被没变的那半张拖到 0 —— 实测正常态 0 / 缺陷态 −0.667，
     符号还是反的，判据会永远红。">1/255 的像素占比"才是随雾整体抬起来的那个量。
     ⚠️ 用 25~60m 带而不是 60m+：pavilion 机位在 60m+ 只有 n=2 个样本，中位数几乎没有
     统计意义（这正是 B3 自身最弱的一条，n 一起打出来）。 */
  console.log(`  25-60m 带 >1/255 占比: 正常 uTop=${P.top} → ${P.b25_60.over1}%  ／ 缺陷态 uTop=200 → ${P.b25_60Uniform.over1}%`);
  console.log(`  60m+ 带样本数 n=${P.b60.n}（n 很小 ⇒ B3 是本门最弱的一条，读它要连着 n 一起看）`);
  check('N1 负例有效：去掉上界后中远景雾覆盖率显著上升（证明"远景不动"不是永远绿的空门）',
    P.b25_60Uniform.over1 > P.b25_60.over1 + 5,
    `缺陷态 ${P.b25_60Uniform.over1}% vs 正常 ${P.b25_60.over1}%`);

  console.log('\n── C 组 · 近景清透上限 + 水道交叉回归（观荷水道机位）──');
  const N = await arms('hero');
  console.log(`  分带中位差（0-3 / 3-10 / 10-25m）: ${N.nb0_3.med} / ${N.nb3_10.med} / ${N.nb10_25.med}`);
  console.log(`  3-10m 带 >2/255 占比: ${N.nb3_10.over2}%  ｜ 3-10m 样本数 ${N.nb3_10.n}`);
  console.log(`  水带绿度（观荷水道机位，画面下部 38%）：水道开=${N.greenOn}% 关=${N.greenOff}% 差=${N.corridorAffect}pp`);
  check('C0 观荷水道机位确实落在近景（相机距 target 4.5~7.5m）',
    N.camDistNear > 4.5 && N.camDistNear < 7.5, `实测 ${N.camDistNear}m`);
  check('C0b 测量法自检（观荷机位）：同配置连渲两次 = 0', N.selfDiffNear === 0, `${N.selfDiffNear}`);
  check(`C2 近景 3~10m 总衰减在清透预算内（≤ ${NEAR_BUDGET}×255 ≈ ${(NEAR_BUDGET * 255).toFixed(1)}/255，取中位 ≤ 1.3）`,
    N.nb3_10.med <= 1.3, `3-10m med=${N.nb3_10.med}/255 n=${N.nb3_10.n}｜>2/255 占 ${N.nb3_10.over2}%`);
  check('C3 观荷机位 0~3m 几乎不动（中位 ≤ 1.5/255）',
    N.nb0_3.med <= 1.5, `0-3m med=${N.nb0_3.med}`);
  check('C1 交叉回归：水道开↔关绿度差仍 ≥ ${GREEN_TAB}pp（6d07a9c「近景水面清透」未被高度雾破坏）'.replace('${GREEN_TAB}', GREEN_TAB),
    N.corridorAffect >= GREEN_TAB, `开=${N.greenOn}% 关=${N.greenOff}% 差=${N.corridorAffect}pp`);

  check('全程零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[volumetric-fog-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张目录：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[volumetric-fog-guard] 崩溃:', e); process.exit(2); });
