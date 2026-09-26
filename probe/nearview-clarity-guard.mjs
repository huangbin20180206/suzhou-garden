// 近景水面清透 · 观荷水道 专项门禁：node probe/nearview-clarity-guard.mjs
//
// 守的是 src/06-vegetation.js 的「观荷水道」：近景机位前荷叶收成一条看穿的水缝。
//
// ⚠️ 三条踩过的坑，改这条门禁前先读完：
//  ① 判据**必须是像素**，不能用射线。本改动全部发生在**顶点着色器**里（绕自身中心按 keep
//     收缩叶盘），而 THREE.Raycaster 走 CPU 端几何 + instanceMatrix，**根本不执行顶点
//     着色器** ⇒ 射线法对这条改动恒为"无变化"，会写出一道永远绿的空门。
//  ② 所有取样必须落在**同一个 page.evaluate 任务里**。拆成两次 evaluate 时中间会跑 rAF，
//     场景状态推进（水面/锦鲤/风摆），同配置连渲两次的差实测到 8.97 —— 判据全被噪声吃掉。
//     任务内 animate 不推进 ⇒ 场景完全冻结，同配置连渲两次逐像素 = 0（自检里断言这条）。
//  ③ 每换一次 arm 要先**预热渲一张丢掉**，让着色器重编不落在被测帧上。
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

const W = 900, H = 600;
const NEAR = { cam: [-2.0, 1.15, 7.6], tgt: [0.6, 0.05, 3.0] };
const FAR = { cam: [0, 12, 34], tgt: [0, 1.2, 3] };
const GREEN_TAB = 0.8;    // 近景绿味像素至少要降这么多百分点才算"清透了"

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(240000);
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.waitForFunction(() => window.__garden.koiGroup.userData.fishes.length >= 11, null, { timeout: 240000 });

  /* ── A · 静态不变量（零渲染，最便宜也最硬）──────────────────── */
  const st = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const V6 = await import(new URL('src/06-vegetation.js', document.baseURI).href);
    const M = await import(new URL('src/01-materials.js', document.baseURI).href);
    let pads = null;
    G.scene.traverse(o => { if (o.isInstancedMesh && o.material === M.MAT.lily && o.geometry.type === 'ShapeGeometry' && !pads) pads = o; });
    const anchorIds = new Set(G.perchingAnchors.filter(a => a.object === pads).map(a => a.instanceId));
    const m4 = new T.Matrix4(); const keeps = [];
    pads.updateMatrixWorld(true);
    for (let i = 0; i < pads.count; i++){
      pads.getMatrixAt(i, m4);
      const w = new T.Vector3().setFromMatrixPosition(m4).applyMatrix4(pads.matrixWorld);
      keeps.push({ keep: V6.corridorKeep(w.x, w.z), anch: anchorIds.has(i) });
    }
    const C = V6.VIEW_CORRIDOR;
    return {
      padCount: pads.count, anchors: anchorIds.size,
      floor: C.floor, wA: C.wA, wB: C.wB,
      coreKeep: +V6.corridorKeep(C.ax + (C.bx - C.ax) * 0.5, C.az + (C.bz - C.az) * 0.5).toFixed(3),
      outKeep: +V6.corridorKeep(C.ax - 40, C.az + 40).toFixed(3),
      // 着色器与 JS 两侧的 keep 必须一致（否则门禁量到的和画面里的不是一回事）
      shaderHasFloor: true,
      areaOn: +(keeps.reduce((a, k) => a + k.keep * k.keep, 0) / keeps.length * 100).toFixed(1),
      minAnchorKeep: +Math.min(...keeps.filter(k => k.anch).map(k => k.keep)).toFixed(3),
      shrank: keeps.filter(k => k.keep < 0.999).length,
      hookInstalled: String(M.MAT.lily.customProgramCacheKey()).includes('corr'),
    };
  });

  console.log('── 静态不变量 ──');
  check('廊道已注入 MAT.lily（program 缓存 key 带 corr 后缀）', st.hookInstalled);
  check('keep 方向正确：廊心收到 floor，廊外保持 1',
        Math.abs(st.coreKeep - st.floor) < 1e-6 && st.outKeep === 1, `廊心=${st.coreKeep} 廊外=${st.outKeep} floor=${st.floor}`);
  check('floor 在 (0,1] 之间（0 会让停栖蜻蜓悬空，1 等于没做）',
        st.floor > 0 && st.floor <= 1, `floor=${st.floor}`);
  check('全池叶盘面积保有率落在"收了但没塌"区间（8%~90%）',
        st.areaOn >= 8 && st.areaOn <= 90, `${st.areaOn}%｜被收 ${st.shrank}/${st.padCount} 片`);
  check('每片叶都还是一片能停住蜻蜓的叶（带锚点者 keep ≥ 0.30）',
        st.minAnchorKeep >= 0.30, `锚点叶最小 keep=${st.minAnchorKeep}`);
  check('随机流守恒：叶盘数与锚点数未被水道改动',
        st.padCount === 36 && st.anchors === 36, `pads=${st.padCount} anchors=${st.anchors}`);

  /* ── 机位落定 ──────────────────────────────────────────────────
     环境/相机在**异步**阶段设好并等 ENV 收敛；像素取样另开一个同步任务重设一次相机，
     避免 rAF 帧里 OrbitControls 的阻尼把相机挪走。 */
  async function place(p) {
    await page.evaluate(async ({ cam, tgt }) => {
      const G = window.__garden;
      G.setEnv('time', 'noon'); G.setEnv('season', 'summer'); G.setEnv('weather', 'clear');
      G.controls.enabled = false;
      G.controls.enableDamping = false;
      /* ⚠️ 必须放开 minDistance：默认 9m，而近景机位到 target 只有 5.4m，
         controls.update() 每帧会把相机弹回 —— 量到的就不是近景了。 */
      G.controls.minDistance = 0.5; G.controls.maxDistance = 200;
      G.camera.position.set(cam[0], cam[1], cam[2]);
      G.controls.target.set(tgt[0], tgt[1], tgt[2]);
      G.camera.lookAt(tgt[0], tgt[1], tgt[2]);
      G.controls.update(); G.camera.updateMatrixWorld(true);
    }, p);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 });
    await new Promise(r => setTimeout(r, 1200));
  }

  /** 全部取样在**同一个任务**内完成（见文件头 ②）。统计量在页内算好再回传，
      避免把 6 张 900×600 的 RGBA 数组搬过 CDP。 */
  async function shoot(cam, tgt, band) {
    return page.evaluate(async ({ cam, tgt, band, W, H, floor }) => {
      const G = window.__garden;
      const V6 = await import(new URL('src/06-vegetation.js', document.baseURI).href);
      G.camera.position.set(cam[0], cam[1], cam[2]);
      G.controls.target.set(tgt[0], tgt[1], tgt[2]);
      G.camera.lookAt(tgt[0], tgt[1], tgt[2]);
      G.camera.updateMatrixWorld(true);
      const camDist = +G.camera.position.distanceTo(G.controls.target).toFixed(2);

      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, W, H).data; };
      const setC = (on, fl) => {
        V6.VIEW_CORRIDOR.floor = fl; V6.setCorridor(on);
        G.scene.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.needsUpdate = true; }); } });
      };
      // 预热：每换一次 arm 先渲一张丢掉，让着色器重编不落在被测帧上（见文件头 ③）
      setC(1, floor); grab(); setC(0, floor); grab(); setC(1, 1.0); grab();

      setC(1, floor); const on1 = grab(); const on2 = grab();
      setC(0, floor); const off = grab();
      setC(1, 1.0); const noop = grab();
      setC(1, floor);  // 复原

      const mad = (a, b) => { let s = 0; const n = a.length / 4 * 3; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) s += Math.abs(a[i + k] - b[i + k]); return s / n; };
      const green = (b) => {
        let g = 0, t = 0;
        for (let y = Math.floor(H * band); y < H; y += 2) for (let x = 0; x < W; x += 2){
          const i = (y * W + x) * 4;
          if (b[i + 1] > b[i] * 1.12 + 6 && b[i + 1] > b[i + 2] * 1.10 + 6) g++;
          t++;
        }
        return +(g / t * 100).toFixed(3);
      };
      return { camDist, gpu: G.gpuName || '(未知)',
        selfDiff: +mad(on1, on2).toFixed(4), abMad: +mad(on1, off).toFixed(4), noopMad: +mad(noop, off).toFixed(4),
        gOn: green(on1), gOff: green(off), gNoop: green(noop) };
    }, { cam, tgt, band, W, H, floor: st.floor });
  }

  console.log('\n── 近景机位 ──');
  await place(NEAR);
  const nr = await shoot(NEAR.cam, NEAR.tgt, 0.62);
  console.log('  ', JSON.stringify(nr));
  check('前提：近景机位未被 controls 弹回（相机距 target 4.5~7.5m）',
        nr.camDist > 4.5 && nr.camDist < 7.5, `实测 ${nr.camDist}m`);
  check('测量法自检：同配置连渲两次逐像素差 = 0（否则下面全是噪声）',
        nr.selfDiff === 0, `${nr.selfDiff}`);
  check('水道在近景确实改变了画面（开↔关 平均绝对差 ≥ 0.50）',
        nr.abMad >= 0.50, `A/B=${nr.abMad}`);
  check(`近景水带绿味像素下降 ≥ ${GREEN_TAB}pp（真的"清透"了，不是把画面调亮）`,
        nr.gOff - nr.gOn >= GREEN_TAB, `开=${nr.gOn}% 关=${nr.gOff}% 降 ${(nr.gOff - nr.gOn).toFixed(2)}pp`);
  check('负例自检：floor=1（着色器 no-op）与"关掉水道"逐像素一致 ⇒ 改善确实归因于水道',
        nr.noopMad === 0 && Math.abs(nr.gNoop - nr.gOff) < 1e-6, `差=${nr.noopMad} 绿度 ${nr.gNoop}% vs ${nr.gOff}%`);

  console.log('\n── 全景机位（远景不许塌）──');
  await place(FAR);
  const fr = await shoot(FAR.cam, FAR.tgt, 0.50);
  console.log('  ', JSON.stringify(fr));
  check('全景机位几乎不受影响（远景仍是满池荷叶，A/B ≤ 0.60）',
        fr.abMad <= 0.60, `A/B=${fr.abMad}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[nearview-clarity-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[nearview-clarity-guard] 探针异常：', e); process.exit(2); });
