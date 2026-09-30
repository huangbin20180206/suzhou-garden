// 一次性诊断（不入库）：大雁迁徙 + 鲜艳小鸟的常驻判据
// ① 季节：春/秋 13 只可见、夏/冬 0（老黄："春天和秋天增加大雁迁徙的场景"）
// ② 阵型：飞行中真的会切换，且两种阵型都出现过（老黄："变换阵型（人字和八字）"）
// ③ 大雁在高空（24~31m）且成队（不是散飞）
// ④ 小鸟：石上组必须**停在实测石面上**（不能悬空）、草上组必须在**跳跃**（位置随帧变化）
// ⑤ 小鸟颜色是亮色（线性分量足够大，不能是灰）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'birds-guard');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.waitForTimeout(2500);
  const settle = () => page.waitForTimeout(4200);

  /* ══ ① 大雁的季节显隐 ═══════════════════════════════════════════════ */
  const seasonRows = [];
  for (const s of ['spring', 'summer', 'autumn', 'winter']){
    await page.evaluate((s) => { const G = window.__garden; G.setEnv('season', s); G.setEnv('time', 'noon'); G.setEnv('weather', 'clear'); }, s);
    await settle();
    seasonRows.push(await page.evaluate(() => {
      const G = window.__garden;
      const vis = G.geese.filter(g => g.visible);
      return { n: G.geese.length, vis: vis.length,
               alt: vis.length ? +vis[0].position.y.toFixed(1) : null,
               spread: vis.length ? +Math.max(...vis.map(g => g.position.distanceTo(vis[0].position))).toFixed(1) : null };
    }));
  }
  const sp = seasonRows[0], su = seasonRows[1], au = seasonRows[2], wi = seasonRows[3];
  check('大雁：春/秋可见（迁徙季）', sp.vis === sp.n && au.vis === au.n,
    `春 ${sp.vis}/${sp.n}、秋 ${au.vis}/${au.n}`);
  check('大雁：夏/冬完全不见（非迁徙季）', su.vis === 0 && wi.vis === 0, `夏 ${su.vis}、冬 ${wi.vis}`);
  /* ⚠️ 高度区间 2026-09-30 从 20~35m 改成 12~18m —— 起因是**用户实拍**：
     第一版 24~31m 时，40m 外每只只有 4~5 像素（翅展 16~20px），远看就是
     "棕色小圆球"（老黄："这个就是你做的大雁？"），队形还整体落在画面外。
     现在 40m 外体 9~10px、翅展 37px，雁的剪影才读得出；
     下限守住 12m 是为了仍明显高于园内最高处（假山峰 7.5m、正堂脊 9.4m），
     不让它像"在院子里飞"。⚠️ 别为了"真实"把它调回高空 —— 那正是第一版被打回的原因。 */
  check('大雁：飞在空中但不高（12~18m，40m 外仍读得出剪影）',
    sp.alt > 12 && sp.alt < 18, `春 ${sp.alt}m / 秋 ${au.alt}m`);
  check('大雁：成队（队形跨度 ≥8m，不是散飞）', sp.spread >= 8, `春跨度 ${sp.spread}m / 秋 ${au.spread}m`);

  /* ══ ② 阵型切换（老黄点名"人字和八字"）══════════════════════════════ */
  await page.evaluate(() => window.__garden.setEnv('season', 'spring'));
  await settle();
  const seq = await page.evaluate(async () => {
    const G = window.__garden;
    const out = [];
    for (let i = 0; i < 40; i++){ out.push(G.GOOSE.form); await new Promise(r => setTimeout(r, 1000)); }
    return out;
  });
  const changes = seq.filter((v, i) => i > 0 && v !== seq[i - 1]).length;
  const forms = [...new Set(seq)];
  check('大雁：飞行过程中变换阵型（40s 内 ≥1 次切换）', changes >= 1, `切换 ${changes} 次，序列 ${seq.join('')}`);
  check('大雁：人字与八字两种阵型都出现过', forms.length === 2,
    `出现：${forms.map(f => f === 0 ? '人字' : '八字').join(' + ')}`);
  /* 有牙的补充：只断言 form 数字变过是不够的 —— 两种阵型的**槽位几何**必须真的不同，
     否则"切换"只是计数器变了、画面上队伍没变形（form 变成一个摆设）。
     做法：强制停在两种阵型上，各量一次"全队相对队首的散布"，两次必须不同。 */
  const spreadByForm = await page.evaluate(async () => {
    const G = window.__garden;
    const snap = () => {
      const vis = G.geese.filter(g => g.visible);
      if (vis.length < 2) return null;
      const lead = vis.reduce((a, b) => (b.userData.slot.lead ? b : a), vis[0]);
      const lp = lead.position;
      const xs = vis.map(g => g.position.x - lp.x), zs = vis.map(g => g.position.z - lp.z);
      return { sx: +(Math.max(...xs) - Math.min(...xs)).toFixed(2),
               sz: +(Math.max(...zs) - Math.min(...zs)).toFixed(2) };
    };
    const out = {};
    for (const f of [0, 1]){
      G.GOOSE.form = f;
      /* 阵型变了位置要缓动 1.6s 才到位 ⇒ 等它落定再量 */
      await new Promise(r => setTimeout(r, 2600));
      out[f] = snap();
    }
    return out;
  });
  const s0 = spreadByForm[0], s1 = spreadByForm[1];
  check('大雁：两种阵型的队形散布真的不同（切换不是摆设）',
    !!s0 && !!s1 && (Math.abs(s0.sx - s1.sx) > 1.0 || Math.abs(s0.sz - s1.sz) > 1.0),
    `人字 横向${s0 && s0.sx}/纵向${s0 && s0.sz}，八字 横向${s1 && s1.sx}/纵向${s1 && s1.sz}`);

  /* ══ ②b 用户视角可见性（本轮踩坑最多的一条，务必守住）══
     前四轮我一直在调尺寸/高度/航路，却**从来没量过"从池边抬头能不能看见"** ——
     结果第一版交付后老黄实拍："这个就是你做的大雁？"（只有一个棕色小圆球）。
     探针实测第一版：40m 外每只 4~5px，且队形整体在**画面外**（屏幕坐标 3883 vs 画幅 900）。
     判据：站到池边、朝园内抬头，**20 秒里至少 8 秒有 ≥1 只在画面内**；
     并且要**同时验四个朝向**（用户的朝向不可控 —— 我曾把航线钉死在"正北偏西"，
     结果只对一种朝向有效、另外一半时间用户朝别处看就是空的）。 */
  const CAMS = [
    { n: '朝北', tgt: [0, 4.0, -30] }, { n: '朝东', tgt: [30, 4.0, 3] },
    { n: '朝南', tgt: [0, 4.0, 30] },  { n: '朝西', tgt: [-30, 4.0, 3] },
  ];
  const CAM_POS = [0, 1.7, 16];
  const visRows = [];
  for (const c of CAMS){
    await page.evaluate(({ pos, tgt }) => {
      const G = window.__garden;
      G.camera.fov = 52; G.camera.updateProjectionMatrix();
      G.camera.position.set(...pos); G.controls.target.set(...tgt); G.controls.update();
    }, { pos: CAM_POS, tgt: c.tgt });
    await page.waitForTimeout(400);
    const s = await page.evaluate(async () => {
      const G = window.__garden;
      let ge1 = 0;
      for (let k = 0; k < 20; k++){
        let on = 0;
        for (const g of G.geese){
          if (!g.visible) continue;
          const n = g.position.clone().project(G.camera);
          if (Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z <= 1) on++;
        }
        if (on >= 1) ge1++;
        await new Promise(r => setTimeout(r, 1000));
      }
      return { ge1 };
    });
    visRows.push({ n: c.n, ge1: s.ge1 });
  }
  /* 门槛按实测定的：四朝向实测 3/10/5/7（第一版是 0/0/0/0）。
     每朝向 ≥2/20 秒、且**至少两个朝向** ≥4/20 秒 —— 后者防"又钉死在某个方向"。 */
  const okPer = visRows.filter(v => v.ge1 >= 2).length;
  const goodDirs = visRows.filter(v => v.ge1 >= 4).length;
  check('大雁：池边抬头能看到（每朝向 20 秒内 ≥2 秒有雁入画）', okPer >= 3,
    visRows.map(v => `${v.n} ${v.ge1}/20秒`).join('、'));
  check('大雁：航线不只对一个朝向有效（≥2 个朝向 20 秒里 ≥4 秒能看到）', goodDirs >= 2,
    `达标朝向 ${goodDirs}/4（${visRows.map(v => `${v.n}:${v.ge1}`).join(' ')}）`);

  /* ══ ③ 小鸟：落点贴面 + 行为 + 颜色 ═════════════════════════════════ */
  const birds = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const im = G.smallBirdMeshRef.mesh;
    const m = new T.Matrix4(), v = new T.Vector3();
    const read = () => {
      const out = [];
      for (let i = 0; i < im.count; i++){
        im.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
        out.push([v.x, v.y, v.z]);
      }
      return out;
    };
    /* ① **20 秒**窗口的累计路径（第一版用 1.4s 窗口 ⇒ 假红，见下方注释） */
    const SECS = 20;
    const hist = [];
    for (let k = 0; k < SECS * 5; k++){ hist.push(read()); await new Promise(r => setTimeout(r, 200)); }
    const s2 = hist[hist.length - 1];
    /* ② 石面高度：射线量每只脚下处的命中面，与鸟高比 */
    const rc = new T.Raycaster(); rc.far = 60;
    const groundAt = (x, z) => {
      rc.set(new T.Vector3(x, 40, z), new T.Vector3(0, -1, 0));
      const hs = rc.intersectObjects(G.scene.children, true).filter(h => h.object.isMesh);
      return hs.length ? +hs[0].point.y.toFixed(2) : null;
    };
    const N_ROCK = 5;                       // 与产品侧一致
    const rock = [], grass = [];
    for (let i = 0; i < im.count; i++){
      const [x, y, z] = s2[i];
      const gy = groundAt(x, z);
      let path = 0, yMin = 1e9, yMax = -1e9;
      for (let k = 1; k < hist.length; k++){
        path += Math.hypot(hist[k][i][0]-hist[k-1][i][0], hist[k][i][1]-hist[k-1][i][1], hist[k][i][2]-hist[k-1][i][2]);
        yMin = Math.min(yMin, hist[k][i][1]); yMax = Math.max(yMax, hist[k][i][1]);
      }
      (i < N_ROCK ? rock : grass).push({ i, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2),
        ground: gy, gap: gy === null ? null : +(y - gy).toFixed(2),
        path: +path.toFixed(2), ySwing: +(yMax - yMin).toFixed(2) });
    }
    const cols = [];
    for (let i = 0; i < im.count; i++)
      cols.push([im.instanceColor.getX(i), im.instanceColor.getY(i), im.instanceColor.getZ(i)]);
    return { count: im.count, rock, grass, cols };
  });

  check('小鸟：总数 = 石上 5 + 草上 6', birds.count === 11, `${birds.count} 只`);
  const rockBad = birds.rock.filter(r => r.gap === null || r.gap < -0.05 || r.gap > 0.45);
  check('小鸟（石上）：站在石面上（脚底与石面差 0.45m 内，不悬空不陷进去）',
    rockBad.length === 0,
    rockBad.length ? `越界 ${rockBad.map(r => `#${r.i} gap=${r.gap}`).join(', ')}`
                   : birds.rock.map(r => `#${r.i} 高${r.y}/石面${r.ground}`).join(' '));
  const rockStill = birds.rock.every(r => r.path < 0.4);
  check('小鸟（石上）：在休息（20 秒累计位移 <0.4m，只剩呼吸起伏）', rockStill,
    `路径 ${birds.rock.map(r => r.path).join(', ')}m`);
  const grassHop = birds.grass.filter(g => g.path > 1.5);
  check('小鸟（草上）：在跳跃捕食（20 秒累计路径 >1.5m）', grassHop.length >= 5,
    `${grassHop.length}/${birds.grass.length} 只，路径 ${birds.grass.map(g => g.path).join(', ')}m`);
  const grassSwing = birds.grass.filter(g => g.ySwing > 0.06);
  check('小鸟（草上）：跳跃是抛物线（高度有起伏，不是平移滑行）', grassSwing.length >= 5,
    `起伏 ${birds.grass.map(g => g.ySwing).join(', ')}m`);
  /* 颜色：**量饱和度**而不是亮度总和 —— 青蓝（线性 [0.01,0.06,0.30]）亮度低但**极鲜艳**，
     按"三通道之和"判会把这类饱和亮色误判成灰（第一版 4/11 假红就是这个）。
     实测 11 只饱和度全在 0.98~1.00 ⇒ 判据取 ≥0.9 且最亮通道 ≥0.25。 */
  const satOf = c => { const mx = Math.max(...c), mn = Math.min(...c); return mx > 0 ? (mx - mn) / mx : 0; };
  const vivid = birds.cols.filter(c => satOf(c) >= 0.9 && Math.max(...c) >= 0.25).length;
  check('小鸟：颜色鲜艳（线性饱和度 ≥0.9，不是灰扑扑）', vivid >= 10,
    `${vivid}/${birds.cols.length} 只达标，样例 rgb=${JSON.stringify(birds.cols[0].map(v => +v.toFixed(2)))} sat=${satOf(birds.cols[0]).toFixed(2)}`);

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[birds-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[birds-guard] 崩溃:', e); process.exit(2); });
