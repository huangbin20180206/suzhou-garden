// 远山观感门禁（2026-09-30）：守"远山 + 天空别读成没画完的背景板"。
//
// 2026-09-28 走查用"挑剔玩家视角"抓到三个问题，四十多道既有门禁一条都验不出：
//   ① 四层远山颜色趋同  ② 山体平涂无内部明暗  ③ 山脊与天对比极弱
// 原因：既有门禁全是"守住已知不变量"，而"看起来假"只能靠**量**出来。
//
// 三个量（都是冻结帧 + 同任务连渲，噪声底 = 0，见 09-24 那条方法论）：
//   ① 层间色阶：逐层单独可见 vs 全关，取该层独占像素的平均亮度 ⇒ 相邻层差
//   ② 层内明暗：同一批像素的亮度标准差（平涂 ⇒ ≈0）
//   ③ 脊线对比：山脊像素 vs 其上紧邻天空像素的亮度差
//
// ⚠️ 认身份靠"逐层切 mesh.visible + 差分"，不靠 Raycaster ——
//    远山是 ShapeGeometry 单面片 + depthWrite:false，射线打不准；
//    合并后名字全丢（都叫 mergedStatic），也不能靠名字认。
// ⚠️ 采样前必须 `await bootDonePromise`（09-24 那条：loading.done 在延迟批之前就触发）。
// ⚠️ 阈值是**按实测定的**，不是拍的：改远山配色/雾/不透明度后要重新量一遍再动，
//    别为了让门禁变绿去调这里的数（那正是它存在的意义）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'hill-guard');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
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

/* 正午·默认机位（俯视）。
   ⚠️ 机位是**试出来的**，不是算出来的：远山在默认机位下横跨画面上缘、脊线落在
   画面上方约 1/5~1/4 处，上方留有天空 —— 这是唯一能同时量到"四层各自的屏幕颜色"
   和"脊线 vs 天空"的机位。试过并**放弃**的两种：
     · 池边平视 (0,1.65,16)→(0,2.2,3)：柳树正对镜头、远山被挡，占屏只剩 0.01%~0.06%；
     · 抬头 (0,1.65,16)→(0,26,3)：脊线顶到画框上沿，上方无天空 ⇒ 脊线一列都取不到。
   ⚠️ 门禁自带"占屏 ≥1.5%"的前置断言（自检②）—— 机位再被改坏会当场报红，
   而不是静默地把"层间差"量成别的东西。 */
const VIEW = null;   // null = 用产品自己的默认机位

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[hill-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  /* 09-24 硬规矩：采样场景内容必须等装配完成，不能只等 loading.done + 猜 sleep */
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  await page.evaluate(async (v) => {
    const G = window.__garden;
    G.setEnv('time', 'noon'); G.setEnv('season', 'summer'); G.setEnv('weather', 'clear');
    G.controls.enabled = false; G.controls.enableDamping = false;
    G.controls.minDistance = 0.5; G.controls.maxDistance = 500;
    /* v 为 null ⇒ 用产品自己的默认机位（resetCamera），且**保持 controls 关闭**，
       否则 resetCamera 之后的 target 会被 OrbitControls 每帧改写。 */
    if (v){
      G.camera.position.set(v.cam[0], v.cam[1], v.cam[2]);
      G.controls.target.set(v.tgt[0], v.tgt[1], v.tgt[2]);
      G.camera.lookAt(v.tgt[0], v.tgt[1], v.tgt[2]);
    } else if (G.resetCamera){
      G.resetCamera();
    }
    G.controls.update(); G.camera.updateMatrixWorld(true);
  }, VIEW);
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 });
  await sleep(800);

  const m = await page.evaluate(() => {
    const G = window.__garden;
    const W = G.renderer.domElement.width, H = G.renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    /* 冻结帧同任务连渲：animate 只在 rAF 里推进状态 ⇒ 同一 JS 任务内场景完全冻结，
       两图之差只剩被测变量。取像素用 drawImage 到 2D canvas（避开 MSAA 帧缓冲不能
       readPixels 的问题，也不需要 preserveDrawingBuffer）。 */
    const draw = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0, W, H); return ctx.getImageData(0, 0, W, H).data; };
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

    const mats = [G.MAT.distantNear, G.MAT.distantDeep, G.MAT.distant, G.MAT.distantFar];
    const order = ['distantNear', 'distantDeep', 'distant', 'distantFar'];
    const cards = [];
    G.scene.traverse(o => { if (o.isMesh && mats.indexOf(o.material) >= 0) cards.push(o); });
    /* ⚠️ keep 是三态：-1=全开 / -2=全关 / >=0=只开那一层。
       写成 `keep < 0 ⇒ 全开` 的话 setOnly(-2)（本意"全关"）会变成"全开"，
       基准帧 == 完整帧 ⇒ 差分恒 0、脊线一列都找不到（差分必须真的量到"被测层"）。 */
    const setOnly = (keep) => {
      for (const o of cards) o.visible =
        keep === -2 ? false : keep === -1 ? true : (mats.indexOf(o.material) === keep);
    };

    /* ── 自检①：同配置连渲两次必须逐像素相同（否则下面的差分全不可信）── */
    setOnly(-1);
    const a1 = draw(); const a2 = draw();
    let noise = 0;
    for (let k = 0; k < W * H; k++){
      const p = k * 4;
      noise = Math.max(noise, Math.abs(lum(a1, p) - lum(a2, p)));
    }

    /* ── 自检②（负例对照）：把四层全关掉，掩码必须**真的**归零。
       没有这条，"层间差"可能是被别的东西（比如白墙、竹丛）算出来的 ——
       而我第一版就因为 setOnly 写错、全关帧实际是全开帧，差分恒 0。 ── */
    setOnly(-2);
    const none = draw();
    setOnly(-1);
    const all = draw();
    let bgChanged = 0;
    for (let k = 0; k < W * H; k++){
      const p = k * 4;
      if (Math.abs(lum(all, p) - lum(none, p)) > 1.2) bgChanged++;
    }

    /* ── 腐蚀 3px：只保留"上下左右都是山"的像素 ──
       为什么必须做：山脊/山脚边缘的抗锯齿过渡本身就带 ±10 以上的亮度跳变，
       而远两层只占屏 2~3%，**边缘像素占了大多数** ⇒ 不腐蚀的话量到的是
       "抗锯齿边缘有多少"，不是"山体内部有没有明暗"。实测远层腐蚀前后
       标准差 4.35 → 6.14，判据含义完全不同。 ── */
    const erode = (mask, times) => {
      let cur = mask;
      for (let it = 0; it < times; it++){
        const nx = new Uint8Array(mask.length);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){
          const k = y * W + x;
          if (cur[k] && cur[k-1] && cur[k+1] && cur[k-W] && cur[k+W]) nx[k] = 1;
        }
        cur = nx;
      }
      return cur;
    };
    const rawMask = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++){
      const p = k * 4;
      if (Math.abs(lum(all, p) - lum(none, p)) > 1.2) rawMask[k] = 1;
    }
    /* 远层卡片薄，腐蚀 3px 可能整层消失 ⇒ 逐层用"属于该层的掩码"各自腐蚀。 */
    const layerMask = [];
    for (let i = 0; i < mats.length; i++){
      setOnly(i); const img = draw(); setOnly(-2);
      const mk = new Uint8Array(W * H);
      for (let k = 0; k < W * H; k++){
        const p = k * 4;
        if (Math.abs(lum(img, p) - lum(none, p)) > 1.2) mk[k] = 1;
      }
      layerMask.push(mk);
    }
    setOnly(-1);

    /* ── 自检③ / 层内明暗的**主判据**（有牙的 A/B，而不是统计量）──
       为什么不用"亮度标准差"当主判据：我试过，SD 几乎与 relief 无关
       （近层 relief 归零后 17.98→17.63，只掉 2%）—— 因为 SD 被**竖向的谷底沉雾
       渐变**和卡片互相叠压主导，量的是"山脚到山腰有多少色阶"，不是"有没有明暗"。
       远层更离谱：176m 处 Exp2 雾吃掉 57% 信号，剩下的对比天生就小，
       无论怎么调 relief 都到不了 SD≥8 ⇒ 那是一条**物理上不可能满足**的判据。
       真正对应用户抱怨（"山体平涂无内部明暗"）的问题是：
       **把 relief 关掉，画面到底变不变？** 直接 A/B 量它，绕开所有代理量。
       同任务连渲 ⇒ 噪声底为 0，差值只可能来自被测变量本身。 */
    const hasRelief = mats.every(m => m.uniforms && m.uniforms.uRelief);
    const savedRelief = mats.map(m => (hasRelief ? m.uniforms.uRelief.value : 0));
    const reliefAB = [];
    for (let i = 0; i < mats.length; i++){
      setOnly(i);
      if (hasRelief) mats[i].uniforms.uRelief.value = 0;
      G.composer.render(); draw();                    // 预热一张丢掉，让重编不落在被测帧
      const off = draw();
      if (hasRelief) mats[i].uniforms.uRelief.value = savedRelief[i];
      G.composer.render(); draw();
      const on = draw();
      let n = 0, sum = 0;
      for (let k = 0; k < W * H; k++){
        const d = Math.abs(lum(on, k * 4) - lum(off, k * 4));
        if (d > 0.5){ n++; sum += d; }
      }
      reliefAB.push({ px: n, mean: n ? +(sum / n).toFixed(3) : 0 });
      setOnly(-2);
    }
    setOnly(-1);

    const layers = [];
    for (let i = 0; i < mats.length; i++){
      setOnly(i); const img = draw(); setOnly(-2);
      /* 用"该层自己的掩码"腐蚀后的内部像素统计 —— 见上面 erode 的说明 */
      const inner = erode(layerMask[i], 3);
      let n = 0, s = 0, s2 = 0, raw = 0;
      for (let k = 0; k < W * H; k++){
        if (!layerMask[i][k]) continue;
        raw++;
        if (!inner[k]) continue;
        const L = lum(img, k * 4); n++; s += L; s2 += L * L;
      }
      if (!n){ layers.push({ i, name: order[i], px: 0, rawPx: raw, pct: 0, mean: 0, sd: 0 }); continue; }
      const mean = s / n;
      layers.push({ i, name: order[i], px: n, rawPx: raw, pct: +(100 * raw / (W * H)).toFixed(2),
                    innerPct: +(100 * n / (W * H)).toFixed(2),
                    mean: +mean.toFixed(2), sd: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(2) });
    }
    setOnly(-1);

    /* ── 脊线：复用已算好的 all / none 两帧，不再重渲。
       ⚠️ 不要用"亮度低于某个固定阈值"来找脊线：正午晴天山与天亮度只差几档，
          任何阈值都会切在两者之间，命中的往往是白墙/竹丛。必须先用差分得到山体掩码。 ── */
    setOnly(-1);
    const f = all;
    const isHill = rawMask;
    const cols = [];
    for (let x = 0; x < W; x += 3){
      let top = -1;
      for (let y = 0; y < H; y++){ if (isHill[y * W + x]){ top = y; break; } }
      if (top < 10) continue;                       // 顶上没有 10px 余量就弃用该列
      if (isHill[(top - 8) * W + x]) continue;      // 上方 8px 仍是山 ⇒ 不是脊线
      cols.push({ hill: lum(f, (top * W + x) * 4), sky: lum(f, ((top - 8) * W + x) * 4) });
    }
    const med = (arr) => {
      const s = arr.slice().sort((p, q) => p - q);
      return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) * 0.5) : null;
    };
    const diffs = cols.map(c => c.hill - c.sky);
    return {
      W, H, noise, cardCount: cards.length, layers, reliefAB, bgChanged, hasRelief,
      ridge: {
        n: cols.length,
        med: med(diffs) === null ? null : +med(diffs).toFixed(2),
        hillP50: cols.length ? +med(cols.map(c => c.hill)).toFixed(1) : null,
        skyP50: cols.length ? +med(cols.map(c => c.sky)).toFixed(1) : null,
      },
    };
  });

  console.log(`  画面 ${m.W}×${m.H}  远山卡片 ${m.cardCount} 张  冻结帧噪声底 ${m.noise.toFixed(3)}`);
  for (const L of m.layers){
    console.log(`    层${L.i} ${L.name.padEnd(13)} 占屏 ${String(L.pct).padStart(5)}%  `
      + `平均亮度 ${String(L.mean).padStart(6)}  层内标准差 ${String(L.sd).padStart(5)}`);
  }
  const chain = m.layers.map(l => l.mean);
  const gaps = chain.slice(1).map((v, i) => +(v - chain[i]).toFixed(2));
  console.log(`  相邻层亮度差：${gaps.join(' / ')}  ｜ 脊线(山−天)中位 ${m.ridge.med}`
    + `（山 ${m.ridge.hillP50} / 天 ${m.ridge.skyP50}，${m.ridge.n} 列）`);

  await page.screenshot({ path: path.join(OUT, 'look-up.png') });

  /* ── 判据（阈值按 2026-09-30 实测定；缺陷态是相邻差 0.56~4.14、层内 sd 2.5~8.2、
        脊线 −1.35）───────────────────────────────────────────────────────────── */
  check('自检①：冻结帧同任务连渲两次逐像素相同（噪声底 = 0）', m.noise < 0.01, `最大差 ${m.noise.toFixed(4)}`);
  check('自检②：四层远山都真实存在且各占屏 ≥1.5%（机位没被改坏）',
    m.layers.every(L => L.pct >= 1.5),
    m.layers.map(L => `${L.name} ${L.pct}%`).join(' ｜ '));
  check('自检②b：开关四层真的改变画面（差分掩码非空）', m.bgChanged > 1000, `变化像素 ${m.bgChanged}`);
  check('层内明暗：关掉 relief 画面必须变（每层平均差 ≥1.0 lum，A/B 实测）',
    m.hasRelief && m.reliefAB.every(a => a.mean >= 1.0),
    m.hasRelief
      ? m.reliefAB.map((a, i) => `${m.layers[i].name} ${a.mean}`).join(' ｜ ')
      : '远山材质没有 uRelief uniform（缺陷态代码）');
  check('层内明暗：远层也不能是死平（平均差 ≥1.0 且变化像素 ≥800）',
    m.hasRelief && m.reliefAB.slice(2).every(a => a.mean >= 1.0 && a.px >= 800),
    m.hasRelief ? m.reliefAB.slice(2).map(a => `${a.px}px/${a.mean}`).join(' ｜ ') : '—');
  check('层间色阶：相邻层亮度差 ≥ 2.0（三层都不得"趋同"）',
    gaps.length === 3 && gaps.every(g => Math.abs(g) >= 2.0),
    gaps.join(' / '));
  check('层间色阶：四层亮度**单调**（近深远浅，不能倒挂）',
    gaps.every(g => g > 0), gaps.join(' / '));
  check('层内明暗（参考值，非判据）：山体内部亮度标准差 — '
    + m.layers.map(L => `${L.name} ${L.sd}`).join(' ｜ '),
    true, '远层天生低（176m 处 Exp2 雾吃掉 57% 信号），标准差不是好判据，见 reliefAB');
  check('脊线对比：山脊比紧邻天空暗 ≥ 6 lum（剪影咬得住天）',
    m.ridge.n >= 20 && m.ridge.med <= -6,
    `中位 ${m.ridge.med}（山 ${m.ridge.hillP50} / 天 ${m.ridge.skyP50}，${m.ridge.n} 列）`);
  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[hill-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[hill-guard] 崩溃:', e); process.exit(2); });
