// 默认机位可读性 legibility-guard（2026-10-02 加，评审 P1）
//
// 守什么：**"做出来了但默认机位看不见"这一类缺陷**——近期一连串都是老黄实拍才发现的：
//   大雁（远看是黑点 ⇒ 整层下线）、小鸟（实测最长边 6~11.6px）、屋檐滴水
//   （默认机位 0.09% 像素）、彩虹（曾整条 0 像素）。这些探针当时都能量、却没有一道门
//   在量"用户实际站在默认机位能看到多少"。
//
// 手法：把机位摆到**默认机位**（resetCamera），对每个氛围元素做**冻结帧同任务 A/B**
// （元素可见 ↔ 隐藏，同任务连渲消除场景漂移；自检"同状态连渲两次逐像素 = 0"），
// 数该元素贡献的像素。判据下限**刻意放低**（只抓"几乎不可见"这一档），
// 不是要强制每个元素都占多少像素 —— 那会把门变成"罚当时的产品形态"。
//
// 自检（同 warmboot / verify-all 的负例文化）：`LEGIBILITY_SELFTEST=1` 把阈值
// 抬到不可能的高度 ⇒ 门必须报红 —— 证明红门路径本身是通的。
// 用法: node probe/legibility-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.mp3': 'audio/mpeg', '.webmanifest': 'application/webmanifest', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const SELFTEST = process.env.LEGIBILITY_SELFTEST === '1';

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.addStyleTag({ content: '#hud,#env,#caption,#loading{display:none !important}' });
  await page.evaluate(() => {
    const G = window.__garden;
    G.ENV.dur = 0.25;
    G.setEnv('season', 'summer'); G.setEnv('time', 'noon');
  });

  /* 元素清单：id → 默认机位下"应当看得见"的氛围元素。
     ⚠️ Playwright 的 evaluate 参数**不能传函数**（序列化会崩），也**别用 eval 传代码**
     （严格模式下 eval 里的 const 不外泄，第一次就这么崩的）—— 解析表直接写进页内函数。
     取的都必须是"整组一句柄可整体隐藏"的对象，分太细会把门变脆。 */
  const measure = async (weather, featIds) => {
    await page.evaluate((w) => { window.__garden.setEnv('weather', w); }, weather);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(2400);
    await page.evaluate(() => { window.__garden.resetCamera && window.__garden.resetCamera(); });
    await page.waitForTimeout(1200);
    return page.evaluate(async ({ featIds }) => {
      const G = window.__garden;
      /* ⚠️⚠️ 必须先把**水面反射钉成每帧刷**（lampvol-guard 同款：按名字取 + 覆盖开关）：
         反射按需降频 ⇒ 连续两次 composer.render() 之间反射纹理"这次更新/下次用旧的"
         ⇒ 水域整片出现 |Δ|>12 的假差异（第一版实测自检 180、六个元素全报 ~15.8k px 的
         雷同数字 —— 全是水在变，不是被测元素）。不钉住它，A/B 差分全是垃圾。 */
      const _w = G.scene.getObjectByName('waterSurface');
      if (_w) _w.userData.reflectEveryFrame = true;
      const resolve = (id, M) => {
        switch (id){
          case 'birds':  return [G.smallBirdMeshRef && G.smallBirdMeshRef.mesh];
          /* 金刚鹦鹉（2026-10-02 第九轮，老黄："加几只金刚鹦鹉，这个好像更显眼一点"）：
             不是走 smallBirdMeshRef（那 9 只是程序化小鸟），是自己 holder 里的 GLB。
             认它靠"metalness 被压到 0.25 的高面数 Mesh"——008-assemble 里的注释记了
             为什么压（Rodin 出的 GLB 金属度拉满、渲成黑块）。名字不能用来认：
             它的 mesh.name = 'Mesh'（非空），而 mergedStatic 之类才是空名。 */
          case 'macaw':  return (() => {
            const r = [];
            G.scene.traverse(o => {
              if (!o.isMesh || !o.visible || !o.geometry) return;
              const tri = (o.geometry.index ? o.geometry.index.count
                                           : o.geometry.attributes.position.count) / 3;
              const m = Array.isArray(o.material) ? o.material[0] : o.material;
              if (m && m.metalness === 0.25 && tri > 3000) r.push(o);
            });
            return r;
          })();
          case 'fly':    return [...G.dragonflies];
          case 'perch':  return [...G.perchingDragonflies];
          case 'koi':    return [G.koiGroup];
          case 'drip':   return [M.POSTRAIN && M.POSTRAIN.drip.im];
          case 'puddle': return [M.POSTRAIN && M.POSTRAIN.puddles.im];
          default: return [];
        }
      };
      const cv = document.createElement('canvas');
      cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
      const ctx = cv.getContext('2d');
      const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
        return ctx.getImageData(0, 0, cv.width, cv.height); };
      const hot = (A, B) => { let n = 0;
        for (let i = 0; i < A.data.length; i += 4){
          const d = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
          if (d > 12) n++;
        } return n; };
      /* ⚠️⚠️ 动态 import 必须放在**第一次抓图之前**（2026-10-02 实测踩坑）：
         `await` 会让出事件循环 ⇒ 中间跑一帧 rAF ⇒ 锦鲤/水面/风全部前进 ⇒
         自检 178、六个元素全报 ~17.8k px 的雷同数字（全是动掉的那一帧，不是被测元素）。
         —— 与 09-26"取样必须落在同一个 evaluate 任务内"是同一条，await 等于劈开任务。
         用 outputs/_diag/drift-where.mjs 对照过：无 await 的连渲逐位为 0。 */
      const M = await import('/src/12-env.js');      // 同一模块实例（POSTRAIN 句柄）
      grab();
      const A = grab();
      const out = {};
      for (const id of featIds){
        const objs = resolve(id, M).filter(Boolean);
        if (!objs.length){ out[id] = { px: -1, n: 0 }; continue; }     // -1 = 句柄没找到（单独报）
        const keep = objs.map(o => o.visible);
        objs.forEach(o => { o.visible = false; });
        grab(); const B = grab();
        objs.forEach((o, i) => { o.visible = keep[i]; });
        out[id] = { px: hot(A, B), n: objs.length };
      }
      grab(); const C = grab();
      let selfMax = 0;
      for (let i = 0; i < A.data.length; i++) selfMax = Math.max(selfMax, Math.abs(A.data[i]-C.data[i]));
      out.__self = selfMax;
      return out;
    }, { featIds });
  };

  /* ⚠️ 2026-10-05：`birds` 退出本门清单 —— 老黄"去掉草皮上的小鸟以及假山上的小鸟"
     （整层下线，count=0）。留着它必然报 0px 假红：**判据要跟产品形态一起改**。
     resolve() 里的 `case 'birds'` 保留（句柄还在、随时可恢复），只是不再被请求。 */
  const MIN_PX = 15;          // 判据线（原来内联在下面的 TH 里；提上来给"补采样"用）
  const clearIds = ['macaw', 'fly', 'perch', 'koi'];
  const mergeMax = (a, b) => {          // 逐元素取较大者；__self 取最大（任一次非零都要报出来）
    const o = { __self: Math.max(a.__self ?? 0, b.__self ?? 0) };
    for (const k of Object.keys({ ...a, ...b })){
      if (k === '__self') continue;
      const x = a[k], y = b[k];
      if (!x){ o[k] = y; continue; }
      if (!y){ o[k] = x; continue; }
      o[k] = (y.px > x.px) ? y : x;
    }
    return o;
  };
  let r1 = await measure('clear', clearIds);
  /* ⚠️⚠️ 只对**贴线**的元素补采样（2026-10-05 加）——「游弋蜻蜓」5 只绕着池子飞，
     单帧采样同代码连跑实测 **12 / 19 / 45 / 33px**，而判据线是 15px ⇒ 红绿完全由
     "开测那一瞬它们飞到哪儿"决定（同 2026-10-01 大雁那条"采样窗口 < 运动周期"的教训）。
     稳定的语义不是"某一帧有多少像素"，而是"**这一窗口里到底能不能看到**"：
     贴线的元素再采两次、取 max。真看不见的三次都低 ⇒ 判据照样红，
     判据线 15px 一个字没动；正常情况（一帧就过）零额外开销。 */
  for (let k = 0; k < 2; k++){
    const weak = clearIds.filter(id => r1[id] && r1[id].px >= 0 && r1[id].px <= MIN_PX);
    if (!weak.length) break;
    console.log(`  · 补采样（单帧贴线：${weak.join(', ')}）`);
    await page.waitForTimeout(1000);
    r1 = mergeMax(r1, await measure('clear', clearIds));
  }
  /* ⚠️ 2026-10-02 起屋檐滴水退出本门的默认机位清单 —— 老黄明确改了形态：
     "滴水慢一点、密度低一些、随机几个瓦片下水处、体积小一点"⇒ 16 个固定滴点/
     半径减半/限速 2m/s，默认机位实测只贡献 4px —— 这是**他要的形态**，不是缺陷；
     摆回 15px 那条线上等于强制回退到"沿檐口下冰雹"。滴水的验收口径在 postrain-guard
     （状态牙：16 滴点 + 空中 live>0；像素牙：檐下近景）。积水仍在此处量。 */
  const r2 = await measure('afterrain', ['puddle']);
  const all = { ...r1, ...r2 };
  const NAME = { macaw: '金刚鹦鹉', fly: '游弋蜻蜓', perch: '停栖蜻蜓', koi: '锦鲤群',
                 puddle: '地面积水' };
  const fmt = (id) => all[id] ? `${all[id].px}px（${all[id].n} 个对象）` : '句柄缺失';

  check('自检：同状态连渲两次画面不变（不是量的场景漂移）', all.__self === 0, `最大差 ${all.__self}`);

  /* 下限刻意低（15px）：只抓"几乎不可见"。SELFTEST 时抬到不可能的高度验证红门路径。 */
  const TH = SELFTEST ? 1e9 : MIN_PX;
  for (const id of ['macaw', 'fly', 'perch', 'koi', 'puddle']){
    if (!all[id] || all[id].px < 0){ check(`默认机位能看到：${NAME[id]}`, false, '句柄缺失（探针坏）'); continue; }
    check(`默认机位能看到：${NAME[id]}（A/B 差分 > ${SELFTEST ? '∞(自检)' : '15px'}）`,
      all[id].px > TH, fmt(id));
  }
  check('全程零 pageerror', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[legibility-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）${SELFTEST ? ' [自检模式：本应报红]' : ''}`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(SELFTEST ? (failed.length ? 0 : 1) : (failed.length ? 1 : 0));
})().catch(e => { console.error('[legibility-guard] 崩溃:', e); process.exit(2); });
