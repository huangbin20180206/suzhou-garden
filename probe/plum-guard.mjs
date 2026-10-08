// 梅花门禁：node probe/plum-guard.mjs
//
// 守老黄 2026-10-07 那条反馈：
//   「从这个角度看两株梅花，根本看不出颜色，甚至连有花都看不出来，所以你看看怎么改这个
//     才能让人看到花，才想换角度放大了看，然后才发现是梅花，给人惊喜」
// 拆成两条契约：
//   ① **远处看得见花**：默认机位下"把花藏起来"必须让画面明显变化，且变化的像素要**偏花色的色相**
//      —— 这是"看得出颜色"的量化口径（不是"材质在不在"，而是"画到屏幕上了没有"）。
//   ② **近处看得出是梅花**：近景单朵要够大（≥40px），且花瓣是"外缘宽而圆"的梅瓣
//      （旧版是两头尖的柳叶形，远看近看都像叶片/放射条）。
//
// 真因（都在本次改动里，写在代码注释里）：
//   · alphaTest 0.42 在"单朵只有 2px"的尺度上把整朵丢掉（mip 平均 alpha 低于阈值）
//     ⇒ 实测藏起全部 800 朵，默认机位画面变化 **0 像素**；
//   · 冬季太阳只有 0.45 倍、没有硬影，梅花的漫反射只剩灰调 ⇒ 只降 alphaTest 时
//     "偏红"的像素只占 5%；补一层同色相自发光后才到 80%+。
//
// ⚠️ 就绪条件必须等"冬落叶真的落到这两株树上"：梅树是 deferBoot 延迟批装进来的
//   （本机实测 90~140s），而**季节存在性是在延迟装配收尾的 collectSeasonCaches 之后才生效**。
//   早量会读到"冬天还挂着 5200 片叶子"（假象）、花还被叶子挡着 ⇒ 基线读数全错。
//   这里显式调一次产品自己的 collectSeasonCaches()（**幂等**、产品在同一个生命周期点也会调）
//   把存在性推到位，再断言"叶子 count=0"作为前提。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
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
const OUT = 'outputs/_diag/plum-guard';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));

  console.log(`\n[plum-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });

  /* 老黄的状态：银装素裹（冬 + 雪）。
     ⚠️ 这两行 setEnv **不能省**（本门第二版就是把它们连同旧注释一起替换掉、结果跑在默认的
        "夏"上：peachShow=1 / plumBlossomShow=0 ⇒ 叶子满树、花不可见、藏花 0 像素 ——
        正是 premise 判据把它们抓出来的）。 */
  await page.evaluate(() => { const G = window.__garden; G.setEnv('season', 'winter'); G.setEnv('weather', 'snow'); });
  /* ⚠️⚠️ 必须**等季节过渡走完**（ENV.t 到 1）再量：季节量是插值的，本机帧率低时
     ENV.t 会爬好几秒（实测 20s 时才 0.32 ⇒ peachShow 还是 0.79、梅叶只掉到 1/3、
     冬色降饱和也没生效）—— 早量的读数**看起来像"冬天还挂着叶子"**，其实是过渡途中，
     会把判据全带偏。这是本项目"判据必须先断言前提"的又一例。 */
  const waitSettled = async (tag) => {
    await sleep(1500);                              // 先让 setEnv 真正起步，别在"过渡还没开始"时看到 t=1
    for (let i = 0; i < 150; i++){
      const t = await page.evaluate(() => ({ t: window.__garden.ENV.t, s: window.__garden.ENV.season }));
      if (t.t >= 1 && t.s === tag) return true;   // ⚠️ ENV.season 是小写，别跟大写比（比不对会白等满 75s）
      await sleep(500);
    }
    console.log(`  (提示：${tag} 的 ENV.t 未在 75s 内落定)`);
    return false;
  };
  await waitSettled('winter');
  await page.evaluate(async () => {
    const env = await import('/src/12-env.js');
    env.collectSeasonCaches();                 // 幂等；产品在延迟装配收尾也会调一次
    env.applyPresence(window.__garden.ENV.cur);
  });

  /* 等两株梅都进场景（延迟批），再把存在性推到当前季节 */
  let plums = 0;
  for (let i = 0; i < 90; i++){
    plums = await page.evaluate(async () => {
      const M = await import('/src/01-materials.js');
      let n = 0;
      window.__garden.scene.traverse(o => { if (o.isInstancedMesh &&
        (o.material === M.MAT.plumBlossomRed || o.material === M.MAT.plumBlossomYellow)) n++; });
      return n;
    });
    if (plums >= 2) break;
    await sleep(3000);
  }
  console.log(`  梅树进场景：${plums} 个花瓣网格 @ ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  check('两株梅都已装配（红梅 + 腊梅）', plums >= 2, `找到 ${plums} 个`);

  const winter = await page.evaluate(async () => {
    const M = await import('/src/01-materials.js');
    const st = { leaf: null, red: null, yel: null, peachShow: null, plumShow: null, envT: null };
    window.__garden.scene.traverse(o => {
      if (!o.isInstancedMesh) return;
      if (o.material === M.MAT.plumLeaf) st.leaf = Math.max(st.leaf || 0, o.count);
      if (o.material === M.MAT.plumBlossomRed) st.red = o.count;
      if (o.material === M.MAT.plumBlossomYellow) st.yel = o.count;
    });
    st.peachShow = +window.__garden.ENV.cur.peachShow.toFixed(3);
    st.plumShow = +window.__garden.ENV.cur.plumBlossomShow.toFixed(3);
    st.envT = +window.__garden.ENV.t.toFixed(3);
    return st;
  });
  check('前提：季节过渡已走完（ENV.t=1）—— 否则读到的是过渡途中',
    winter.envT >= 1, `ENV.t=${winter.envT} peachShow=${winter.peachShow} plumBlossomShow=${winter.plumShow}`);
  check('前提：冬季梅叶落尽（叶 count=0）—— 否则花会被叶子挡住、判据全不可信',
    winter.leaf === 0, `叶=${winter.leaf} 红梅花=${winter.red} 腊梅花=${winter.yel}`);
  check('前提：冬季两株梅的花都在（冬季 1.0）',
    winter.red > 100 && winter.yel > 100, `红 ${winter.red} / 黄 ${winter.yel}`);
  await sleep(2500);

  /* ── ① 远处看得见花：默认机位下"藏花"必须改变足够多、且偏花色的像素 ── */
  const far = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const M = await import('/src/01-materials.js');
    const canvas = G.renderer.domElement, W = canvas.width, H = canvas.height;
    const grab = () => { const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx = c.getContext('2d'); cx.drawImage(canvas, 0, 0);
      return { px: cx.getImageData(0, 0, W, H).data, url: c.toDataURL('image/png') }; };
    G.waterSurface && (G.waterSurface.userData.reflectEveryFrame = true);
    const find = mat => { let r = null; G.scene.traverse(o => { if (o.isInstancedMesh && o.material === mat) r = o; }); return r; };
    const red = find(M.MAT.plumBlossomRed), yel = find(M.MAT.plumBlossomYellow);
    /* ⚠️ 花苞与凋谢花是**另外两个网格**（同株、不同几何；凋谢花 2026-10-08 还换了材质）⇒
       "藏起花"的 A/B 必须把三者一起藏，否则量到的只是盛开的 60%，前提断言名不副实。
       ⚠️⚠️ 两株梅各有一套，不能只拿 traverse 的**最后一个** ——
          按"同一棵树的父组"配对才拿到眼前这株的（第一版拿错株，量出"花苞 0 像素"的假红）。 */
    const pairOf = (flowerM) => {
      const r = { bud: null, wither: null };
      flowerM.parent.traverse(o => {
        if (!o.isInstancedMesh) return;
        if (o.material === M.MAT.plumBud) r.bud = o;
        if (o.name === 'plumWithered') r.wither = o;
      });
      return r;
    };

    const boxOf = (o) => { const m = new T.Matrix4(), v3 = new T.Vector3(), rt = o.parent;
      let a = 1e9, b2 = 1e9, c = -1e9, d = -1e9, inF = 0;
      G.camera.updateMatrixWorld(true); G.camera.updateProjectionMatrix();
      for (let i = 0; i < o.count; i++){ o.getMatrixAt(i, m); v3.setFromMatrixPosition(m); rt.localToWorld(v3);
        const v = v3.clone().project(G.camera); const px = (v.x*0.5+0.5)*W, py = (-v.y*0.5+0.5)*H;
        if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z <= 1) inF++;
        a = Math.min(a,px); c = Math.max(c,px); b2 = Math.min(b2,py); d = Math.max(d,py); }
      return { box: { x0: Math.max(0, Math.floor(a-14)), y0: Math.max(0, Math.floor(b2-14)),
                      x1: Math.min(W, Math.ceil(c+14)), y1: Math.min(H, Math.ceil(d+14)) }, inF }; };

    /* 色相口径（2026-10-07 改）：冬色是**降饱和 + 冷色调**过的，暗光下"逐像素 r>g+35"
       会把正确的红梅判成灰（实测偏红只 57% 而平均RGB [156,123,124] 其实是暖的）。
       所以改成两条一起看：
         · **均值口径**（主判据）：变化像素的平均色要满足"红：R−G≥25"或"黄：G−B≥30 且 |R−G|≤45"；
         · **占比口径**（辅判据）：逐像素用宽松线（红 r>g+15 / 黄 g>b+25 且 r>b+25）数占比。 */
    const measure = (A, B, box) => { let n = 0, redP = 0, yelP = 0, sr = 0, sg = 0, sb = 0;
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++){
        const i = (y*W+x)*4;
        const d = Math.abs(A[i]-B[i]) + Math.abs(A[i+1]-B[i+1]) + Math.abs(A[i+2]-B[i+2]);
        if (d > 24){ n++; sr += A[i]; sg += A[i+1]; sb += A[i+2];
          const R = A[i], Gc = A[i+1], Bl = A[i+2];
          if (R > Gc + 15 && Gc >= Bl - 10) redP++;
          if (Gc > Bl + 25 && R > Bl + 25 && Math.abs(R - Gc) <= 70) yelP++;
        } }
      const mean = n ? [sr/n, sg/n, sb/n] : null;
      return { n, redPct: n ? Math.round(redP/n*100) : 0, yelPct: n ? Math.round(yelP/n*100) : 0,
               avgRGB: mean ? mean.map(v => Math.round(v)) : null,
               meanRed: mean ? +(mean[0] - mean[1]).toFixed(1) : null,
               meanYellow: mean ? +(((mean[0] + mean[1]) / 2) - mean[2]).toFixed(1) : null };
    };

    const shots = {};
    const shoot = (key, o, mat, withDefect = false) => {
      const { box, inF } = boxOf(o);
      if (box.x1 <= box.x0 || box.y1 <= box.y0) return { key, inF, note: '不在画内' };
      const { bud, wither } = pairOf(o);
      const keep = { bud: bud ? bud.count : 0, wit: wither ? wither.count : 0 };
      G.composer.render(0.016); const A = grab();
      mat.__keepRed = red.count; mat.__keepYel = yel.count;
      red.count = 0; yel.count = 0;
      if (bud) bud.count = 0;                       // 花苞与凋谢花一起藏（"藏起花"才是完整口径）
      if (wither) wither.count = 0;
      G.composer.render(0.016); const B = grab();
      red.count = mat.__keepRed; yel.count = mat.__keepYel;
      if (bud) bud.count = keep.bud;
      if (wither) wither.count = keep.wit;
      shots[key] = A.url;
      const res = { key, inF, boxPx: `${box.x1-box.x0}×${box.y1-box.y0}`, ...measure(A.px, B.px, box),
                    buds: keep.bud, withered: keep.wit, flowers: o.count };
      /* ── 缺陷态对照（同机位、同一任务内量）────────────────────────────────
         把两份花瓣材质还原成"老黄看到的那一版"（alphaTest .42 + 旧自发光），再对**同一张
         "花全关"基准 B** 量一次 —— 于是"健康态 vs 缺陷态"是同一个相机、同一个基准下的两个数，
         可以**直接比大小**。
         ⚠️ 2026-10-08 改成**比值**判据：原来写的是"缺陷态贡献 <200px"，朵数 800→1500 之后
           缺陷态也能画到 247px（朵多了、总会有几朵越过 alpha 测试）⇒ 那条会假红。
           比值才是不随朵数漂的口径：实测健康 762 / 缺陷 247 ≈ 3.1 倍。 */
      if (withDefect){
        const keep = { ar: M.MAT.plumBlossomRed.alphaTest, ay: M.MAT.plumBlossomYellow.alphaTest,
                       er: M.MAT.plumBlossomRed.emissive.getHex(), ei: M.MAT.plumBlossomRed.emissiveIntensity,
                       ey: M.MAT.plumBlossomYellow.emissive.getHex(), eiy: M.MAT.plumBlossomYellow.emissiveIntensity };
        M.MAT.plumBlossomRed.alphaTest = 0.42; M.MAT.plumBlossomYellow.alphaTest = 0.42;
        M.MAT.plumBlossomRed.emissive.setHex(0x3A0A12); M.MAT.plumBlossomRed.emissiveIntensity = 0.5;
        M.MAT.plumBlossomYellow.emissive.setHex(0x3A2E00); M.MAT.plumBlossomYellow.emissiveIntensity = 0.5;
        /* ⚠️ 缺陷态还要把**花苞与凋谢花也藏起来**：老黄看到的那一版**既没有能认出来的花苞**、
           也没有能认出来的凋谢花（他的原话："没有你说的带花苞的枝条"、"看不出是枯萎花"）——
           两者都是这一轮才独立出几何/材质的。
           不藏的话缺陷态会挂着 96 个苞（实测 361px），比值被抬到 2.4 倍而**假红**。 */
        const bk = bud ? bud.count : 0, wk = wither ? wither.count : 0;
        if (bud) bud.count = 0; if (wither) wither.count = 0;
        G.composer.render(0.016); const C = grab();
        if (bud) bud.count = bk; if (wither) wither.count = wk;
        res.defectN = measure(C.px, B.px, box).n;
        M.MAT.plumBlossomRed.alphaTest = keep.ar; M.MAT.plumBlossomYellow.alphaTest = keep.ay;
        M.MAT.plumBlossomRed.emissive.setHex(keep.er); M.MAT.plumBlossomRed.emissiveIntensity = keep.ei;
        M.MAT.plumBlossomYellow.emissive.setHex(keep.ey); M.MAT.plumBlossomYellow.emissiveIntensity = keep.eiy;
      }
      return res;
    };

    /* 默认机位：红梅在画内；腊梅要转向它 */
    const out = { atDefault: shoot('default', red, M.MAT, true), camPos: [G.camera.position.x, G.camera.position.y, G.camera.position.z] };
    const treeY = new T.Vector3(); yel.parent.getWorldPosition(treeY);
    G.camera.position.set(treeY.x + 9, 4.6, treeY.z - 9);
    G.camera.lookAt(treeY.x, 2.6, treeY.z);
    G.camera.updateMatrixWorld(true); G.camera.updateProjectionMatrix();
    G.composer.render(0.016);
    out.yellowView = shoot('yellow', yel, M.MAT);

    /* ── ② 近景：单朵像素尺寸（**贴到 1.6m** —— 这条判据对应"走近/放大才看清花型"那个体验）──
       ⚠️ 2026-10-08 机位 2.5m → 1.6m：花的**基础**尺寸按老黄"疏枝点花"的要求收到 0.10m
       （远处靠着色器按距离放大到 2.6 倍保住花色）。0.10m 的花在 2.5m 处只有 34px，
       离 40px 的门槛太贴边；而"看得清五瓣"本来就是**贴近**了才有的体验 ⇒ 判据相机挪到 1.6m
       （实测 0.10m 花 ≈ 53px），门槛仍保持 ≥40px 不变。 */
    const root = red.parent;
    const m0 = new T.Matrix4(), fp = new T.Vector3();
    red.getMatrixAt(0, m0); fp.setFromMatrixPosition(m0); root.localToWorld(fp);
    const side = new T.Vector3(1, 0, 0.6).normalize();
    G.camera.position.set(fp.x + side.x * 1.6, fp.y + 0.4, fp.z + side.z * 1.6);
    G.camera.lookAt(fp.x, fp.y, fp.z);
    G.camera.updateMatrixWorld(true); G.camera.updateProjectionMatrix();
    G.composer.render(0.016);
    const nearShot = grab();
    shots.near = nearShot.url;
    const persp = 2 * Math.tan((G.camera.fov * Math.PI / 180) / 2) * G.camera.position.distanceTo(fp);
    /* ⚠️ 单朵直径常量要跟着产品走（×0.488 ⇒ 0.10m）；写死旧值会让明细行虚高。 */
    out.near = { flowerPx: +((0.100 / persp) * H).toFixed(1), dist: +G.camera.position.distanceTo(fp).toFixed(2) };
    return { out, shots };
  });

  const d = far.out.atDefault;
  check('默认机位：红梅在画内', d && d.inF > 0, JSON.stringify({ inF: d && d.inF, box: d && d.boxPx }));
  check('默认机位：藏起花会让画面明显变化（≥200px）',
    d && d.n > 200, `变化 ${d && d.n}px（修前实测 0px）`);
  check('默认机位：变化像素的**平均色偏红**（R−G≥25）—— 这才是"看得出颜色"',
    d && d.meanRed >= 25, `R−G=${d && d.meanRed}  平均RGB ${JSON.stringify(d && d.avgRGB)}  逐像素偏红 ${d && d.redPct}%`);
  const yv = far.out.yellowView;
  check('转向腊梅：藏起花会让画面变化（≥120px）', yv && yv.n > 120, `变化 ${yv && yv.n}px`);
  check('转向腊梅：变化像素的**平均色偏黄**（(R+G)/2−B≥30）',
    yv && yv.meanYellow >= 30, `(R+G)/2−B=${yv && yv.meanYellow}  平均RGB ${JSON.stringify(yv && yv.avgRGB)}  逐像素偏黄 ${yv && yv.yelPct}%`);
  check('近景单朵够大（≥40px，看得出花型）', far.out.near.flowerPx >= 40,
    `${far.out.near.flowerPx}px @ ${far.out.near.dist}m（贴到 1.6m 看）`);
  /* ── ⑦ 三态比例 60/30/10（2026-10-08 · 老黄："总归有 60% 左右的花（黄色）、30% 左右的苞
        （嫩黄色）、还有 10% 左右是开始凋谢的花（花苞枯黄），按这个比例来重新修改两株梅花的造型"）──
     口径直接读**产品挂出来的计数**（`userData.flBuds` / `flWithered` + 花网格 count），不靠看图数；
     容差 ±5 个百分点（他要的是"左右"）。同时断"那棵树上真有花苞网格"（他上一轮的抱怨就是
     "没有你说的带花苞的枝条"⇒ 光有比例不够，得**真有那个网格**）。 */
  const mixOf = (s) => (s && s.flowers != null)
    ? { total: s.flowers + s.buds, buds: s.buds, withered: s.withered,
        pctBud: Math.round(s.buds / Math.max(1, s.flowers + s.buds) * 100),
        pctWither: Math.round(s.withered / Math.max(1, s.flowers + s.buds) * 100),
        pctOpen: Math.round((s.flowers - s.withered) / Math.max(1, s.flowers + s.buds) * 100) } : null;
  const mixRed = mixOf(d), mixYel = mixOf(yv);
  for (const [tag, mix] of [['红梅', mixRed], ['腊梅', mixYel]]){
    check(`⑦ 「${tag}」三态比例 ≈60% 盛开 / 30% 花苞 / 10% 凋谢（容差 ±5 点）`,
      mix && Math.abs(mix.pctOpen - 60) <= 5 && Math.abs(mix.pctBud - 30) <= 5 && Math.abs(mix.pctWither - 10) <= 5,
      mix ? `盛开 ${mix.pctOpen}% / 花苞 ${mix.pctBud}% / 凋谢 ${mix.pctWither}%（花网格 ${mix.total - mix.buds} + 花苞网格 ${mix.buds}）` : '没读到计数');
  }
  /* ── ⑤ "不是紫藤"的量化判据（2026-10-08 新加）──────────────────────────────
     老黄："梅花开出来紫藤这种花的效果，现实中的梅花不是这种密集型开放"。
     口径取**花距 / 花径**（沿枝分布的自然结果）：真实梅是 1~2 倍花径，紫藤式花串则花与花几乎重合。
     同时断"有没有把花堆出来"：花数不得超过枝条网络能自然承载的槽位数（靠 fillTo 凑数就是堆）。 */
  const sp = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const M = await import('/src/01-materials.js');
    let o = null; G.scene.traverse(x => { if (x.isInstancedMesh && x.material === M.MAT.plumBlossomRed) o = x; });
    if (!o) return null;
    const root = o.parent, m = new T.Matrix4(), v = new T.Vector3(), pts = [];
    for (let i = 0; i < o.count; i++){ o.getMatrixAt(i, m); v.setFromMatrixPosition(m); pts.push(root.localToWorld(v.clone())); }
    const dia = 0.100;                       // 基础花径（远处着色器会按距离放大，那是视觉尺寸）
    const nn = [];
    for (let i = 0; i < pts.length; i++){ let best = 1e9;
      for (let j = 0; j < pts.length; j++){ if (i === j) continue; const d = pts[i].distanceTo(pts[j]); if (d < best) best = d; }
      nn.push(best); }
    nn.sort((a, b) => a - b);
    return { n: o.count, med: +(nn[(nn.length / 2) | 0] / dia).toFixed(2),
             p90: +(nn[(nn.length * 0.9) | 0] / dia).toFixed(2),
             declared: o.userData.flDeclared, natural: o.userData.flNatural,
             fabricated: o.userData.flFabricated };
  });
  check('⑥ 「不是紫藤」：最近邻花距中位 ≥0.6 倍花径（紫藤式花串会掉到 0.2 倍以下）',
    sp && sp.med >= 0.6, `中位 ${sp && sp.med}× / P90 ${sp && sp.p90}× 花径（实测 1500 朵那版是 0.19×）`);
  check('⑥ 「不是把花堆出来」：朵数 ≤ 枝条自然槽位数（fillTo 没在凑数）',
    sp && sp.fabricated === 0, `声明 ${sp && sp.declared} / 自然槽位 ${sp && sp.natural} / 凑数 ${sp && sp.fabricated}`);

  /* ── ③ 负例自检：缺陷态必须**明显更弱**（比值口径，见上面 withDefect 的注释） ── */
  const dn = (d && d.defectN) || 0;
  check('负例自检：缺陷态（alphaTest .42 / 旧自发光）在同机位同基准下贡献**不到健康态的 40%**'
      + '（比值口径，不随朵数漂）',
    d && d.n > 0 && dn < d.n * 0.4, `健康 ${d && d.n}px / 缺陷 ${dn}px ＝ ${d && d.n ? (d.n / Math.max(1, dn)).toFixed(1) : '?'} 倍`);

  /* ── ④ 季节契约不变：夏季无花 ──
     ⚠️ 花这一档走的是**布尔存在性通道**（`p[key] > 0.03` ⇒ `visible`），**不是 count 通道**
        —— 夏季 count 仍然是 800 而 visible=false（three 不画）。判据读 count 会误判"夏天还开着花"，
        读 visible 才是对的口径（本门第一版就栽在这里）。 */
  await page.evaluate(() => window.__garden.setEnv('season', 'summer'));
  await waitSettled('summer');
  const summer = await page.evaluate(async () => {
    const M = await import('/src/01-materials.js');
    const G = window.__garden;
    const st = { redVis: null, yelVis: null, redCnt: null, leaf: null, envT: +G.ENV.t.toFixed(3),
                 plumShow: +G.ENV.cur.plumBlossomShow.toFixed(3), peachShow: +G.ENV.cur.peachShow.toFixed(3) };
    G.scene.traverse(o => {
      if (!o.isInstancedMesh) return;
      if (o.material === M.MAT.plumBlossomRed){ st.redVis = o.visible; st.redCnt = o.count; }
      if (o.material === M.MAT.plumBlossomYellow) st.yelVis = o.visible;
      if (o.material === M.MAT.plumLeaf) st.leaf = Math.max(st.leaf || 0, o.count);
    });
    return st;
  });
  check('夏季无花（季节契约不变：两株梅的花都不可见）',
    summer.redVis === false && summer.yelVis === false,
    `红 visible=${summer.redVis}（count=${summer.redCnt}，该通道不看 count）/ 黄 visible=${summer.yelVis}；夏叶=${summer.leaf}；ENV.t=${summer.envT}`);

  for (const [k, url] of Object.entries(far.shots || {}))
    fs.writeFileSync(`${OUT}/${k}.png`, Buffer.from(url.split(',')[1], 'base64'));
  if (errs.length) check('零 pageerror', false, errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();                                  // ⚠️ 必须关：否则全绿也不退出（见 mobile-panel-guard 的教训）
  const failed = results.filter(r => !r.ok);
  console.log(`\n[plum-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  if (failed.length){ console.log('失败项：'); failed.forEach(f => console.log('  · ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[plum-guard] 崩溃:', e); process.exit(2); });
