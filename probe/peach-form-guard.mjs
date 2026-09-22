// 桃树**形态**门禁（2026-09-22，与 peach-guard 分工：那道管四季生命周期，这道管"长得像不像树"）。
//
//   背景：老黄实拍判语"光秃秃的直棍插在石头上"——而当时 30 道门禁全绿。
//   原因是门禁只查"有没有 / 显不显"，不查"形"。这道门禁把两个现象钉成断言：
//     ① 主干是不是一根**圆柱**（逐圈半径的圆度 + 是否塌陷 + 是否真在收细 + 世界空间两向直径）
//     ② 冠层是不是一**团叶**（从 4 个方位各投 9×9 条平行射线打向树冠，命中叶片的比例 = 投影填充率）
//
//   判据为什么这样写（都是上一轮的教训）：
//     · 不用像素分类：树后的草/水/天全是绿的，旧诊断"叶绿 82%"其实量的是背景。
//     · 轴向射线用**世界坐标**、平行投影填充率 —— 与"从外面看能不能看穿"直接对应。
//     · 逐圈半径从 `geometry.parameters.path` 取圈心（与 TubeGeometry 生成顶点同一个 getPointAt），
//       所以"半径"是真的径向距离；塌陷圈会立刻露出来（旧版实测 0.006 ~ 0.38，差 60 倍）。
//     · 主干**不进 mergeStatics**（userData.noMerge，见 06-vegetation）：合并后名字会丢，
//       按名字量不到 —— 而这正是它上一轮能静默塌掉的原因。
// usage: node probe/peach-form-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

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

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(200000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  await sleep(2500);
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 60000, polling: 200 }).then(() => true).catch(() => false);
  /* 延迟批跑完（桃树是 deferBoot）才谈得上量形态 —— 等树干真的出现 */
  let nTree = 0;
  for (let k = 0; k < 16 && nTree < 2; k++){
    nTree = await page.evaluate(() => { let n = 0;
      window.__garden.scene.traverse(o => { if (o.userData && o.userData.peachTree) n++; }); return n; });
    if (nTree < 2) await sleep(700);
  }
  check('园里已种下 ≥2 株桃（延迟装配后存在）', nTree >= 2, `found=${nTree}`);
  /* 延迟批收尾（mergeStatics(deferRoot) 在最后一批之后）再稳一会儿：
     主干是 noMerge，早晚都按名量得到，但季节缓存要等 collectSeasonCaches 重收才认桃树的实例。 */
  await sleep(2500);

  const trunkOf = (ti) => page.evaluate((i) => {
    const g = window.__garden, T = g.THREE;
    const trees = []; g.scene.traverse(o => { if (o.userData && o.userData.peachTree) trees.push(o); });
    const tree = trees[i]; if (!tree) return null;
    tree.updateMatrixWorld(true);
    const trunks = []; tree.traverse(o => { if (o.name === 'peachTrunk') trunks.push(o); });
    return trunks.map(m => {
      const gp = m.geometry.parameters;
      const S = gp.tubularSegments, R = gp.radialSegments;
      const pos = m.geometry.attributes.position;
      const rings = [];
      for (let k = 0; k <= S; k++){
        const c = gp.path.getPointAt(k / S);
        let mn = 1e9, mx = -1e9;
        for (let j = 0; j <= R; j++){
          const idx = k * (R + 1) + j;
          const d = Math.hypot(pos.getX(idx) - c.x, pos.getY(idx) - c.y, pos.getZ(idx) - c.z);
          if (d < mn) mn = d;
          if (d > mx) mx = d;
        }
        rings.push({ mn: +mn.toFixed(4), mx: +mx.toFixed(4) });
      }
      /* 世界空间直径：只取 y ∈ [0.30, 1.30] 的顶点 —— 这段高度上只有主干，
         根盘（y<0.2）与主枝（y>0.34H≈1.4）都不在这个带里，不会污染"这根管子多粗"。 */
      const v = new T.Vector3();
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
      for (let idx = 0; idx < pos.count; idx++){
        v.fromBufferAttribute(pos, idx);
        if (v.y < 0.30 || v.y > 1.30) continue;
        v.applyMatrix4(m.matrixWorld);
        if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
        if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
        n++;
      }
      return { rings, bandN: n, bandX: +(x1 - x0).toFixed(3), bandZ: +(z1 - z0).toFixed(3),
               paramR: gp.radius, geo: m.geometry.type };
    });
  }, ti);

  /* 冠层投影填充率：4 个方位 × 9×9 条平行射线射向树冠，命中叶片的比例。
     这就是"从外面看能不能看穿它"——骨架 0.1x，叶团 0.8x。 */
  const canopyFill = (ti) => page.evaluate((i) => {
    const g = window.__garden, T = g.THREE;
    const trees = []; g.scene.traverse(o => { if (o.userData && o.userData.peachTree) trees.push(o); });
    const tree = trees[i]; if (!tree) return null;
    tree.updateMatrixWorld(true);
    let leafInst = null;
    tree.traverse(o => { if (o.isInstancedMesh && o.material === g.MAT.peachLeaf) leafInst = o; });
    if (!leafInst) return null;
    const alloc = leafInst.instanceMatrix.count;          // 声明总数（冬春 count 会被季节通道截短）
    /* ⚠️ getMatrixAt 给的是**局部**实例矩阵。冠心必须换算到世界坐标再架射线 ——
       直接拿局部值当世界坐标，相机就架到 27m 外的池子上了（上一版实测 fill=0 就是这个原因）。 */
    const m4 = new T.Matrix4(), p = new T.Vector3(), ctr = new T.Vector3();
    for (let k = 0; k < alloc; k++){
      leafInst.getMatrixAt(k, m4);
      m4.premultiply(leafInst.matrixWorld);              // → 世界矩阵
      ctr.add(p.setFromMatrixPosition(m4));
    }
    ctr.multiplyScalar(1 / Math.max(1, alloc));
    let RR = 0;
    for (let k = 0; k < alloc; k++){
      leafInst.getMatrixAt(k, m4);
      m4.premultiply(leafInst.matrixWorld);
      p.setFromMatrixPosition(m4);
      RR = Math.max(RR, Math.hypot(p.x - ctr.x, p.z - ctr.z));
    }
    const rc = new T.Raycaster(); rc.far = 80;
    const dir = new T.Vector3(), org0 = new T.Vector3(), right = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    const N = 9, dist = 8;
    let hit = 0, tot = 0;
    for (let ai = 0; ai < 4; ai++){
      const az = ai * Math.PI / 2 + 0.4;
      org0.set(ctr.x + Math.cos(az) * dist, ctr.y + 0.30 * dist, ctr.z + Math.sin(az) * dist);
      dir.copy(ctr).sub(org0).normalize();
      right.crossVectors(dir, up).normalize();
      const ext = RR * 1.15, org = new T.Vector3();
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++){
        const u = (a / (N - 1) * 2 - 1) * ext, w = (b / (N - 1) * 2 - 1) * ext;
        /* 只统计落在**树冠轮廓内**的射线：轮廓外的射线必定打空，
           混进来只会稀释比例，量不出"这棵树从外面看能不能看穿"。 */
        if (Math.hypot(u, w) > RR) continue;
        org.copy(org0).addScaledVector(right, u).addScaledVector(up, w);
        rc.set(org, dir);
        tot++;
        if (rc.intersectObject(leafInst, false).length) hit++;
      }
    }
    return { fill: +(hit / tot).toFixed(3), tot, declared: alloc, live: leafInst.count,
             ctr: ctr.toArray().map(v => +v.toFixed(2)), RR: +RR.toFixed(2) };
  }, ti);

  /* 四季的实例数（"声明多少就实挂多少" + 季节分量通道） */
  const instCounts = (ti) => page.evaluate((i) => {
    const g = window.__garden;
    const trees = []; g.scene.traverse(o => { if (o.userData && o.userData.peachTree) trees.push(o); });
    const tree = trees[i]; if (!tree) return null;
    const want = { peachLeaf: 'leaf', peachBlossom: 'blossom', peachFruit: 'fruit', peachPetal: 'petal' };
    const out = {};
    tree.traverse(o => {
      if (!o.isInstancedMesh) return;
      for (const [mk, label] of Object.entries(want))
        if (o.material === g.MAT[mk]) out[label] = { live: o.count, alloc: o.instanceMatrix.count, vis: o.visible };
    });
    return out;
  }, ti);

  /* ── 形态：主干 ── */
  const TREE_N = Math.min(2, nTree);
  for (let ti = 0; ti < TREE_N; ti++){
    const tr = await trunkOf(ti);
    const tag = `株${ti}`;
    if (!tr || !tr.length){ check(`${tag}：找到 peachTrunk（noMerge，能按名量）`, false, '没找到'); continue; }
    const t = tr[0];
    check(`${tag}：找到 peachTrunk（noMerge，能按名量）`, tr.length === 1, `找到 ${tr.length} 个`);
    const rings = t.rings;
    const R = rings.map(r => (r.mn + r.mx) / 2);
    /* ① 每圈必须**圆**：TubeGeometry 的一圈顶点都在等距路径点的同一半径上 */
    const worstRound = Math.max(...rings.map(r => r.mx / Math.max(1e-6, r.mn)));
    check(`${tag}：每一圈都是圆（逐圈 max/min 半径比 ≤ 1.06）`, worstRound <= 1.06,
      `最差圆度比=${worstRound.toFixed(3)}（旧版塌陷圈会是几十倍）`);
    /* ② 没有任何一圈塌掉 —— 旧版的病就是这个 */
    const minRing = Math.min(...rings.map(r => r.mn));
    check(`${tag}：没有一圈塌陷（最小圈半径 ≥ 0.045）`, minRing >= 0.045,
      `最小圈半径=${minRing.toFixed(4)}`);
    /* ③ 相邻圈平滑：突变 = 局部塌陷 */
    let maxJump = 0;
    for (let k = 1; k < R.length; k++) maxJump = Math.max(maxJump, Math.abs(R[k] - R[k - 1]) / R[k - 1]);
    check(`${tag}：半径沿轴平滑变化（相邻圈变化 ≤ 25%）`, maxJump <= 0.25, `最大跳变=${(maxJump * 100).toFixed(1)}%`);
    /* ④ 确实在收细（半球的"直棍"才会上下一样粗） */
    const taper = R[R.length - 1] / R[0];
    check(`${tag}：主干确实在收细（梢/基 ∈ [0.30, 0.75]）`, taper >= 0.30 && taper <= 0.75,
      `梢/基=${taper.toFixed(3)} 基=${R[0].toFixed(3)} 梢=${R[R.length - 1].toFixed(3)}`);
    /* ⑤ 不是刀片：世界空间两向直径都要够粗、且互相接近。
       ⚠️ 绝对下限 0.22 → 0.15（2026-09-22）：干径 0.15 → 0.10（旧值在 4m 高的桃上是一根
       0.44m 粗的旗杆，实拍判语"光杆"），下限按同比例下调。这条判据的**意图**是
       "两个方向都实心、不是 0.06×0.15 的刀片"，不是"主干必须粗" —— 粗不粗由设计定，
       塌不塌由这条守。 */
    const dX = t.bandX, dZ = t.bandZ;
    const thin = Math.min(dX, dZ), skew = Math.abs(dX - dZ) / Math.max(dX, dZ);
    const thinFloor = 0.15;
    check(`${tag}：主干在两向上都是实心圆管（y∈0.3~1.3 两向直径 ≥${thinFloor} 且相差 ≤30%）`,
      t.bandN > 0 && thin >= thinFloor && skew <= 0.30,
      `直径 X=${dX} Z=${dZ} 差异=${(skew * 100).toFixed(1)}% 采样顶点=${t.bandN}（旧版实测 0.06×0.15 的刀片）`);
  }

  /* ── 形态：冠层不是骨架 ── */
  const setSeason = (s) => page.evaluate((s) => { const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('weather', 'clear'); g.setEnv('season', s); }, s);

  await setSeason('summer'); await settled(); await sleep(1400);
  const sumFill = await canopyFill(0);
  const sum0 = (await instCounts(0)) || {};
  /* 阈值 0.50 是**先定后测**的：树冠轮廓内超过一半的方向被叶子挡住，才读得出"一团叶"。
     旧版（3800 片 0.155m 小真值叶）实测 0.093 —— 同一判据下就是能看穿的骨架。 */
  check('夏：冠层轮廓内被叶子挡住的比例 ≥ 0.50（从外面看是叶团，不是能看穿的骨架）',
    !!sumFill && sumFill.fill >= 0.50, sumFill ? `fill=${sumFill.fill} 射线=${sumFill.tot} 冠半径=${sumFill.RR}m` : '没量到');
  check('夏：叶实例挂满声明数（声明多少就实挂多少）',
    !!sum0.leaf && sum0.leaf.live === sum0.leaf.alloc && sum0.leaf.live >= 3000,
    sum0.leaf ? `${sum0.leaf.live}/${sum0.leaf.alloc}` : '没量到');
  check('夏：果实例挂满声明数且够多（≥100）',
    !!sum0.fruit && sum0.fruit.live === sum0.fruit.alloc && sum0.fruit.live >= 100,
    sum0.fruit ? `${sum0.fruit.live}/${sum0.fruit.alloc}` : '没量到');
  /* ⚠️ 花走的是**显隐**通道（visible=false），不是 count —— 它 count 仍是 900，只是一帧不提交。
     判"花落尽"必须看 visible，不能看 count（上一版拿 count 判，误报了两季）。 */
  check('夏：花落尽（blossom 已不可见）',
    !!sum0.blossom && (sum0.blossom.vis === false || sum0.blossom.live === 0),
    sum0.blossom ? `visible=${sum0.blossom.vis} count=${sum0.blossom.live}` : '没量到');
  await page.evaluate(() => { const g = window.__garden, T = g.THREE;
    const trees = []; g.scene.traverse(o => { if (o.userData && o.userData.peachTree) trees.push(o); });
    const b = new T.Box3().setFromObject(trees[0]); const c = b.getCenter(new T.Vector3());
    g.controls.target.copy(c);
    g.camera.position.set(c.x + 7, c.y + 2.4, c.z + 7);
    g.camera.lookAt(c); g.controls.update(); });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'peach-form-summer.png') });

  await setSeason('spring'); await settled(); await sleep(1400);
  const spr0 = (await instCounts(0)) || {};
  const sprFill = await canopyFill(0);
  const wantSpringLeaf = spr0.leaf ? Math.round(spr0.leaf.alloc * 0.15) : -1;
  check('春：先花后叶**真的落地**（叶实例 = 声明数 × 0.15）',
    !!spr0.leaf && spr0.leaf.live === wantSpringLeaf,
    spr0.leaf ? `叶 live=${spr0.leaf.live} 期望=${wantSpringLeaf}（声明 ${spr0.leaf.alloc}×0.15）` : '没量到');
  check('春：花满树（blossom 实例挂满声明且 ≥700）',
    !!spr0.blossom && spr0.blossom.live === spr0.blossom.alloc && spr0.blossom.live >= 700,
    spr0.blossom ? `${spr0.blossom.live}/${spr0.blossom.alloc}` : '没量到');
  check('春：叶比夏疏（先花后叶，叶不该先满）',
    !!spr0.leaf && !!sum0.leaf && spr0.leaf.live < sum0.leaf.live,
    spr0.leaf && sum0.leaf ? `春 ${spr0.leaf.live} < 夏 ${sum0.leaf.live}` : '没量到');
  await page.evaluate(() => { const g = window.__garden, T = g.THREE;
    const trees = []; g.scene.traverse(o => { if (o.userData && o.userData.peachTree) trees.push(o); });
    const b = new T.Box3().setFromObject(trees[0]); const c = b.getCenter(new T.Vector3());
    g.controls.target.copy(c);
    g.camera.position.set(c.x + 7, c.y + 2.4, c.z + 7);
    g.camera.lookAt(c); g.controls.update(); });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'peach-form-spring.png') });

  await setSeason('autumn'); await settled(); await sleep(1400);
  const aut0 = (await instCounts(0)) || {};
  const wantAutFruit = aut0.fruit ? Math.round(aut0.fruit.alloc * 0.7) : -1;
  check('秋：果渐疏（果实例 = 声明数 × 0.7，该掉的真的掉了）',
    !!aut0.fruit && aut0.fruit.live === wantAutFruit,
    aut0.fruit ? `果 live=${aut0.fruit.live} 期望=${wantAutFruit}（声明 ${aut0.fruit.alloc}×0.7）` : '没量到');

  await setSeason('winter'); await settled(); await sleep(1400);
  const win0 = (await instCounts(0)) || {};
  const winFill = await canopyFill(0);
  /* 花/落花是"显隐"通道、叶/果是"分量 count"通道（同一株树两套机制并存，别用一条判据套） */
  const hidden = (k) => !!win0[k] && (win0[k].vis === false || win0[k].live === 0);
  const allHidden = ['leaf', 'blossom', 'fruit', 'petal'].every(hidden);
  check('冬：裸枝过冬（叶/花/果/落花全隐）', allHidden,
    ['leaf', 'blossom', 'fruit', 'petal']
      .map(k => `${k}=${win0[k] ? (win0[k].live === 0 ? '0' : (win0[k].vis ? '?' : '不可见')) : '?'}`).join(' '));
  check('冬：冠层填充率 ≤ 0.05（叶真的落尽，不是"变稀"）',
    !!winFill && winFill.fill <= 0.05, winFill ? `fill=${winFill.fill}` : '没量到');
  check('春 比 冬 密、夏 比 春 密（季节真的在改叶量）',
    !!sprFill && !!winFill && !!sumFill && sprFill.fill > winFill.fill && sumFill.fill > sprFill.fill,
    sprFill && winFill && sumFill ? `冬 ${winFill.fill} < 春 ${sprFill.fill} < 夏 ${sumFill.fill}` : '没量到');
  await page.evaluate(() => { const g = window.__garden, T = g.THREE;
    const trees = []; g.scene.traverse(o => { if (o.userData && o.userData.peachTree) trees.push(o); });
    const b = new T.Box3().setFromObject(trees[0]); const c = b.getCenter(new T.Vector3());
    g.controls.target.copy(c);
    g.camera.position.set(c.x + 7, c.y + 2.4, c.z + 7);
    g.camera.lookAt(c); g.controls.update(); });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'peach-form-winter.png') });

  /* ── 几何确定性：**同一份代码连开两个页面**，株0 必须逐位一致 ──
     ⚠️ 为什么单列一条：00-config 的 `rnd/rr` 是一条**共享**的全局流（注释写着"保证每次刷新
     园林形态一致"），而桃树建在 deferBoot 的**延迟任务**里 —— 异步 GLB 回调/其它延迟 job 的
     先后会拨动这条流的抽样位置，于是"每次刷新长出一棵新树"。本轮实锤：两次加载株0 主干高
     2.77m vs 2.92m（诊断脚本 outputs/_diag/_peach-determinism.mjs）。
     代价是**所有形态类 A/B 数字里都掺着"换了一棵树"的噪声** —— 我据此得出过"叶量已饱和"的错结论。
     判据写成**自己和自己比**，不写死任何常数：写死数值会在正常改设计时变成假红（§33 的教训）。
     签名取 `instanceMatrix.count`（声明总数，与季节无关）+ 主干几何高 —— 都是建造期写入的静态量。 */
  const shapeSig = (pg) => pg.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const trees = []; g.scene.traverse(o => { if (o.userData && o.userData.peachTree) trees.push(o); });
    const t = trees[0]; if (!t) return null;
    t.updateMatrixWorld(true);
    let leaf = null, trunk = null;
    t.traverse(o => {
      if (o.isInstancedMesh && o.material === g.MAT.peachLeaf && !leaf && o.instanceMatrix.count > 100){
        const b = new T.Box3(), m4 = new T.Matrix4(), p = new T.Vector3();
        for (let k = 0; k < o.instanceMatrix.count; k++){
          o.getMatrixAt(k, m4); m4.premultiply(o.matrixWorld);
          b.expandByPoint(p.setFromMatrixPosition(m4));
        }
        leaf = b.getSize(new T.Vector3()).toArray().map(v => +v.toFixed(4));
      }
      if (o.name === 'peachTrunk'){
        o.geometry.computeBoundingBox();
        trunk = +o.geometry.boundingBox.max.y.toFixed(4);
      }
    });
    return { leaf, trunk };
  });
  const page2 = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page2.setDefaultTimeout(200000);
  page2.on('pageerror', e => errors.push('page2 pageerror: ' + e.message));
  await page2.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page2.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  for (let k = 0; k < 16; k++){
    const ok = await page2.evaluate(() => { let n = 0;
      window.__garden.scene.traverse(o => { if (o.userData && o.userData.peachTree) n++; }); return n >= 1; });
    if (ok) break;
    await sleep(700);
  }
  await sleep(1500);
  const sigA = await shapeSig(page), sigB = await shapeSig(page2);
  check('几何确定性：连开两个页面，株0 的叶包围盒 + 主干高**逐位一致**（rnd/rr 不受延迟装配拨动）',
    !!sigA && !!sigB && JSON.stringify(sigA) === JSON.stringify(sigB),
    `页1 ${JSON.stringify(sigA)} ｜ 页2 ${JSON.stringify(sigB)}`);
  await page2.close();

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[桃·形态] ${results.length - failed.length}/${results.length} 项通过 · 样张 ${OUT}/peach-form-*.png`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[peach-form-guard] 崩溃:', e); process.exit(2); });
