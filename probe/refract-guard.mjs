// 水面真折射守卫（P2-5）
// 守两件**只能靠读像素**才能判定的事：
//   ① 折射贴图里真的有鱼（水下层标记漏了 = 贴图里只剩池底，静默且不报错）；
//   ② 贴图坐标与世界 XZ 的映射方向没反（反了 = 鱼位读到池底、池心空着，一样静默）。
// 判据：按折射相机的几何对齐算出每条鱼**应该落在哪个纹素**，去读那附近的像素，
//   要求它明显比池心深水区亮（锦鲤橙白、池底墨绿）。映射反了就会读到池底而失败。
// 另查：贴图不是一整块清屏色（= 从没渲过）、贴图会跟着时间更新（= 没被冻住 ——
//   在**同一次加载内**读两遍、每遍按当时的鱼位算纹素：贴图冻住的话第二遍就会扑空）。
// 反向对照：?refract=0 必须把整套东西关掉（refractRT 为 null、uRefractOn=0）。
// 用法: node probe/refract-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MARGIN = 35;                       // 锦鲤橙白 vs 墨绿池底的亮度差（0-255）

/* 在页面里做一遍完整的采样分析；keepCanvas=true 时把贴图画到画布上供截图 */
async function sample(page, keepCanvas){
  return page.evaluate(async (keepCanvas) => {
    const G = window.__garden;
    const info = G.refractInfo();
    if (!info.on) return { info, ready: false };

    /* 等第一张贴图渲出来（uRefractOn 翻到 1） */
    const ready = await new Promise(res => {
      const t0 = Date.now();
      (function poll(){
        const w = G.scene.getObjectByName('waterSurface');
        if (w && w.material.uniforms.uRefractOn.value > 0.5) return res(true);
        if (Date.now() - t0 > 20000) return res(false);
        setTimeout(poll, 100);
      })();
    });
    if (!ready) return { info, ready: false };

    const r = G.renderer;
    const box = info.box;
    const W = box.maxX - box.minX, D = box.maxZ - box.minZ;
    /* 鱼的世界坐标 → 预测纹素。折射相机正交朝下、up=+z：
       屏幕右 = 世界 −x（所以 u 反着 x），屏幕上 = 世界 +z（v 正着 z）。 */
    const texelOf = (wx, wz) => ({
      x: Math.round((box.maxX - wx) / W * info.texW),
      y: Math.round((wz - box.minZ) / D * info.texH),
    });
    const fishWorld = () => G.koiGroup.userData.fishes.map(f => {
      const v = new G.THREE.Vector3(); f.getWorldPosition(v); return { x: v.x, z: v.z };
    });

    function readRT(){
      const rt = G.refractRT();
      const w = rt.width, h = rt.height;
      const buf = new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      return { w, h, buf };
    }
    const lum = (img, x, y) => {
      const i = (y * img.w + x) * 4;
      return (img.buf[i] + img.buf[i + 1] + img.buf[i + 2]) / 3;
    };
    function blockMax(img, cx, cy, half){
      let best = 0;
      for (let y = Math.max(0, cy - half); y <= Math.min(img.h - 1, cy + half); y++)
        for (let x = Math.max(0, cx - half); x <= Math.min(img.w - 1, cx + half); x++)
          best = Math.max(best, lum(img, x, y));
      return best;
    }
    /* 池心深水区中位亮度（对照组：这儿就该是暗池底） */
    function bedMedian(img){
      const vals = [];
      for (let y = Math.round(img.h * 0.42); y < Math.round(img.h * 0.58); y += 3)
        for (let x = Math.round(img.w * 0.42); x < Math.round(img.w * 0.58); x += 3)
          vals.push(lum(img, x, y));
      vals.sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    }

    const img = readRT();
    const bed = bedMedian(img);
    let mn = 255, mx = 0, acc = 0;        // 整张贴图亮度分布：没渲过会塌成一点
    for (let i = 0; i < img.buf.length; i += 12){
      const l = (img.buf[i] + img.buf[i + 1] + img.buf[i + 2]) / 3;
      if (l < mn) mn = l; if (l > mx) mx = l; acc += l;
    }
    const bright = fishWorld().map(p => {
      const t = texelOf(p.x, p.z);
      return blockMax(img, t.x, t.y, 3);
    });

    if (keepCanvas){
      /* readPixels 是倒序的，翻一行再画；鱼位画十字方便核对映射 */
      const cv = document.createElement('canvas');
      cv.width = img.w; cv.height = img.h;
      cv.style.cssText = `position:fixed;left:0;top:0;width:${img.w}px;height:${img.h}px;z-index:99;background:#000`;
      const ctx = cv.getContext('2d');
      const id = ctx.createImageData(img.w, img.h);
      for (let y = 0; y < img.h; y++){
        const src = y * img.w * 4, dst = (img.h - 1 - y) * img.w * 4;
        id.data.set(img.buf.subarray(src, src + img.w * 4), dst);
      }
      ctx.putImageData(id, 0, 0);
      ctx.strokeStyle = '#FF3B30'; ctx.lineWidth = 2;
      fishWorld().forEach(p => {
        const t = texelOf(p.x, p.z);
        ctx.beginPath();
        ctx.moveTo(t.x - 6, t.y); ctx.lineTo(t.x + 6, t.y);
        ctx.moveTo(t.x, t.y - 6); ctx.lineTo(t.x, t.y + 6);
        ctx.stroke();
      });
      document.body.appendChild(cv);
    }
    return { info, ready: true, bedMedian: bed,
             spread: { min: mn, max: mx, mean: acc / (img.buf.length / 12) }, bright };
  }, keepCanvas);
}

async function runOnce(qs){
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(150000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html${qs}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000 });
  /* koi.glb 异步挂载，鱼没到齐时采样无意义 */
  const gotFish = await page.waitForFunction(
    () => window.__garden && window.__garden.koiGroup.userData.fishes.length >= 11,
    { timeout: 120000 }).then(() => true).catch(() => false);

  const first = gotFish ? await sample(page, true) : { info: { on: null }, ready: false };
  if (first.ready){
    await page.screenshot({ path: path.join(OUT, 'refract-rt.png') }).catch(() => {});
    await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) c.remove(); });
  }
  await page.screenshot({ path: path.join(OUT, 'refract-water.png') }).catch(() => {});

  /* 同一次加载内再来一遍：贴图冻住的话，鱼已经游到新位置，旧贴图里扑空 */
  let second = null;
  if (first.ready){
    await new Promise(r => setTimeout(r, 2500));
    second = await sample(page, false);
  }
  await browser.close();
  server.close();
  return { first, second, errs, gotFish };
}

(async () => {
  const a = await runOnce('');
  const A = a.first;
  check('锦鲤异步挂载到齐', a.gotFish, a.gotFish ? '' : 'koi.glb 未挂载（采样无意义）');
  if (!a.gotFish) return finish(1);

  check('折射默认开启（无 ?refract=0）', A.info.on === true, JSON.stringify(A.info));
  check('首张贴图已渲出（uRefractOn 翻 1）', A.ready === true);
  if (!A.ready) return finish(1);
  check('贴图尺寸随档位（独显 768×459 / 核显 384×229，按池形长宽比）',
    (A.info.texW === 768 && A.info.texH === 459) || (A.info.texW === 384 && A.info.texH === 229),
    `${A.info.texW}×${A.info.texH}`);
  check('贴图亮度有分布（渲过，不是一整块清屏色）', A.spread.max - A.spread.min > 30,
    `${A.spread.min}~${A.spread.max}，均值 ${A.spread.mean.toFixed(0)}`);
  check('池心深水区确实是暗池底', A.bedMedian < 120, `中位亮度 ${A.bedMedian.toFixed(0)}`);

  const hits = arr => arr.filter(b => b >= A.bedMedian + MARGIN);
  const h1 = hits(A.bright);
  check(`11 条锦鲤落在折射贴图里（≥9 条命中，判据比池心底亮 +${MARGIN}）`,
    h1.length >= 9,
    `${h1.length}/11，亮度 [${A.bright.map(b => b.toFixed(0)).join(',')}]，池心底 ${A.bedMedian.toFixed(0)}`);
  check('映射方向没反（鱼位是鱼、池心是池底）',
    h1.length >= 9 && A.bedMedian < A.bright.reduce((x, y) => x + y, 0) / A.bright.length,
    'u 或 v 反了，鱼位就会读到池底而失败');

  const B = a.second;
  const h2 = B && B.ready ? hits(B.bright) : [];
  check('贴图随时间更新（2.5s 后鱼游到新位置，新位置仍然命中）',
    h2.length >= 9,
    B ? `${h2.length}/11，亮度 [${B.bright.map(b => b.toFixed(0)).join(',')}]` : '第二次采样未完成');

  /* 反向对照 */
  const c = await runOnce('?refract=0');
  const C = c.first;
  check('?refract=0 时折射整套关闭', C.info.on === false && C.info.ready === false, JSON.stringify(C.info));

  check('页面无报错', a.errs.length === 0 && c.errs.length === 0,
    [...a.errs, ...c.errs].slice(0, 3).join(' | ') || '无');

  finish();
  function finish(force){
    const pass = results.filter(r => r.ok).length;
    console.log(`\n${pass === results.length ? '✓' : '✗'} ${pass}/${results.length} ${pass === results.length ? 'ALL PASS' : 'FAILED'}`);
    process.exit(force !== undefined ? force : (pass === results.length ? 0 : 1));
  }
})().catch(async e => {
  console.error('探针异常：', e);
  process.exit(1);
});
