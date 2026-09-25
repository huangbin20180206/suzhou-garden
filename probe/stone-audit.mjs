// 立峰 / 题名石审计探针（2026-09-17）
// 用户两条主观要求必须变成可断言的事实，否则"改好没改好"全靠嘴说：
//   ① 太湖石「造型更别致、孔洞再多一些」→ 用**欧拉示性数**数出真正的透孔数
//      （χ = V-E+F = 2-2g-b，g 就是贯穿孔的个数），并量"瘦/皱/悬挑"三个形制指标；
//   ② 题名石「别像墓碑」→ 长高比（卧石 vs 立碑）、有没有碑座边框、朝向、有没有真刻字。
// 用法: node probe/stone-audit.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  page.setDefaultTimeout(150000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000 });
  /* 立峰在 deferBoot 延迟批里（首帧之后才建），必须轮询到，不能假设它已经在场。 */
  const found = await page.waitForFunction(() => {
    let hero = false, stele = false;
    window.__garden.scene.traverse(o => {
      if (o.name === 'taihuHero') hero = true;
      if (o.name === 'steleGroup') stele = true;
    });
    return hero && stele;
  }, { timeout: 120000 }).then(() => true).catch(() => false);
  check('立峰 / 题名石已装配', found, found ? '' : '延迟批没跑完，后续断言无意义');
  if (!found){ await finish(); return; }

  const R = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    let hero = null, stele = null, companions = [];
    G.scene.traverse(o => {
      if (o.name === 'taihuHero') hero = o;
      if (o.name === 'steleGroup') stele = o;
      if (o.name === 'taihuCompanion') companions.push(o);
    });
    if (!stele) return { missing: 'steleGroup' };

    /* ── 拓扑：欧拉示性数 → 透孔数 ──
       闭合可定向曲面：χ = V - E + F = 2 - 2g - b（g 个贯穿孔、b 条边界环）。
       顶点按量化坐标焊接，边按无向对去重，退化三角形不计面。 */
    function topo(geo){
      const pos = geo.attributes.position, index = geo.index;
      const n = index ? index.count : pos.count;
      const q = v => Math.round(v * 1e4);
      const map = new Map(), vid = new Int32Array(pos.count);
      let V = 0;
      for (let i = 0; i < pos.count; i++){
        const k = q(pos.getX(i)) + '|' + q(pos.getY(i)) + '|' + q(pos.getZ(i));
        if (!map.has(k)) map.set(k, V++);
        vid[i] = map.get(k);
      }
      const ekey = (p, r) => p < r ? p + ',' + r : r + ',' + p;
      const ecnt = new Map();
      const adj = Array.from({ length: V }, () => []);
      let F = 0;
      for (let i = 0; i < n; i += 3){
        const a = vid[index ? index.getX(i) : i],
              b = vid[index ? index.getX(i + 1) : i + 1],
              c = vid[index ? index.getX(i + 2) : i + 2];
        if (a === b || b === c || a === c) continue;
        F++;
        for (const [p, r] of [[a, b], [b, c], [c, a]]){
          const k = ekey(p, r);
          ecnt.set(k, (ecnt.get(k) || 0) + 1);
          if (p !== r){ if (!adj[p].includes(r)) adj[p].push(r); if (!adj[r].includes(p)) adj[r].push(p); }
        }
      }
      const E = ecnt.size, chi = V - E + F;
      /* 连通分量（并查集）—— "掉下一块浮空石"就是 C>1 */
      const par = new Int32Array(V); for (let i = 0; i < V; i++) par[i] = i;
      const find = x => { while (par[x] !== x){ par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let p = 0; p < V; p++) for (const r of adj[p]){ const A = find(p), B = find(r); if (A !== B) par[A] = B; }
      const comps = new Set(); for (let i = 0; i < V; i++) comps.add(find(i));
      /* 边界**环**数（不是边界边数）：χ = 2C - 2g - b，拿边数当代入会把 g 算成负数 */
      const bAdj = new Map();
      for (const [k, c] of ecnt){
        if (c !== 1) continue;
        const [p, r] = k.split(',').map(Number);
        if (!bAdj.has(p)) bAdj.set(p, []);
        if (!bAdj.has(r)) bAdj.set(r, []);
        bAdj.get(p).push(r); bAdj.get(r).push(p);
      }
      const seenB = new Set();
      let loops = 0;
      for (const p of bAdj.keys()){
        if (seenB.has(p)) continue;
        loops++;
        let cur = p, prev = -1;
        while (cur !== undefined && !seenB.has(cur)){
          seenB.add(cur);
          const nx = bAdj.get(cur).find(x => x !== prev);
          prev = cur; cur = nx;
        }
      }
      const C = comps.size, b = loops;
      return { V, E, F, chi, C, b, genus: (2 * C - chi - b) / 2 };
    }

    hero.geometry.computeBoundingBox();
    const lb = hero.geometry.boundingBox;
    const heroBox = new T.Box3().setFromObject(hero);
    const hs = heroBox.getSize(new T.Vector3());
    /* 收分：底 15% 高与顶 15% 高的**水平跨度**（max-min）。
       ⚠️ 不能用"到中轴的距离"—— 悬挑把顶部整根推出去了，半径当然变大，
       量出来是"上粗下细"的假象（第一版实测 0.91）。跨度是平移不变量，量的是粗细本身。 */
    const hp = hero.geometry.attributes.position;
    const y0 = lb.min.y, y1 = lb.max.y, H = y1 - y0;
    let bX0 = 1e9, bX1 = -1e9, bZ0 = 1e9, bZ1 = -1e9;
    let tX0 = 1e9, tX1 = -1e9, tZ0 = 1e9, tZ1 = -1e9;
    let cx = 0, cz = 0;
    for (let i = 0; i < hp.count; i++){
      const yy = hp.getY(i), x = hp.getX(i), z = hp.getZ(i);
      cx += x; cz += z;
      if (yy < y0 + H * 0.15){
        if (x < bX0) bX0 = x; if (x > bX1) bX1 = x;
        if (z < bZ0) bZ0 = z; if (z > bZ1) bZ1 = z;
      }
      if (yy > y1 - H * 0.15){
        if (x < tX0) tX0 = x; if (x > tX1) tX1 = x;
        if (z < tZ0) tZ0 = z; if (z > tZ1) tZ1 = z;
      }
    }
    const spanB = Math.max(bX1 - bX0, bZ1 - bZ0);
    const spanT = Math.max(tX1 - tX0, tZ1 - tZ0);
    const taper = spanB / Math.max(0.001, spanT);
    /* 悬挑不对称：局部质心相对**局部** bbox 中心的水平偏移 / 半宽。
       ⚠️ 用世界 bbox 中心会混进 hero.position（第一版量出 6.3，纯属口径错）。 */
    cx /= hp.count; cz /= hp.count;
    const lbc = lb.getCenter(new T.Vector3());
    const leanOff = Math.hypot(cx - lbc.x, cz - lbc.z) / Math.max(0.001, Math.max(hs.x, hs.z) / 2);

    const tHero = topo(hero.geometry);

    /* ── 题名石 ── */
    const sb = new T.Box3().setFromObject(stele);
    const ss = sb.getSize(new T.Vector3());
    const sc = sb.getCenter(new T.Vector3());
    let slabGeo = null;
    stele.traverse(o => { if (!slabGeo && o.geometry) slabGeo = o.geometry; });
    const groups = slabGeo ? slabGeo.groups.map(g => ({ mat: g.materialIndex, count: g.count })) : [];
    const sp = stele.position;
    /* 落位自检：世界 → 池局部（池心在世界 z=+3），核对该方向上的真实岸线半径 */
    const sLx2 = sp.x, sLz2 = sp.z - 3;
    const sAng2 = Math.atan2(sLz2, sLx2);
    const kS2 = Math.round((((sAng2 % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * G.POND_RADII.length) % G.POND_RADII.length;
    const shore2 = G.POND_RADII[kS2] / 0.92;
    const r2 = Math.hypot(sLx2, sLz2);
    const inPond = G.insidePond(sLx2, sLz2);
    /* 刻字面法线（局部 +z）经 stele 旋转后的世界方向，应当朝向池心 (0, ·, 3) */
    const fn = new T.Vector3(0, 0, 1).applyQuaternion(stele.getWorldQuaternion(new T.Quaternion()));
    const toPond = new T.Vector3(0 - sp.x, 0, 3 - sp.z).normalize();
    const facing = fn.dot(toPond);
    /* 刻字墨迹：faceMat 的 CanvasTexture 里数暗像素 */
    let inkRatio = 0, inkNote = '';
    try {
      let face = null;
      stele.traverse(o => {
        if (face || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        face = mats.find(m => m && m.map && m.map.image && m.map.image.getContext) || null;
      });
      if (face){
        const cv = face.map.image, cx2 = cv.getContext('2d');
        const d = cx2.getImageData(0, 0, cv.width, cv.height).data;
        let dark = 0, tot = 0;
        for (let i = 0; i < d.length; i += 4 * 7){
          tot++;
          if (d[i] < 110 && d[i + 1] < 130) dark++;
        }
        inkRatio = dark / tot;
      } else inkNote = '未找到带贴图的刻字材质';
    } catch (e){ inkNote = String(e.message); }

    return {
      hero: { ...tHero,
        h: +hs.y.toFixed(2), w: +Math.max(hs.x, hs.z).toFixed(2),
        slenderness: +(hs.y / Math.max(hs.x, hs.z)).toFixed(2),
        taper: +taper.toFixed(2), leanOff: +leanOff.toFixed(3),
        tris: (hero.geometry.index ? hero.geometry.index.count : hero.geometry.attributes.position.count) / 3,
        pos: [+hero.position.x.toFixed(2), +hero.position.z.toFixed(2)] },
      comps: companions.map(c => {
        const t = topo(c.geometry);
        return { g: t.genus, C: t.C, b: t.b, chi: t.chi, F: t.F,
                 h: +new T.Box3().setFromObject(c).getSize(new T.Vector3()).y.toFixed(2) };
      }),
      stele: { len: +Math.max(ss.x, ss.z).toFixed(2), h: +ss.y.toFixed(2), wide: +Math.min(ss.x, ss.z).toFixed(2),
               ratio: +(ss.y / Math.max(ss.x, ss.z)).toFixed(3),
               groups, inPond, facing: +facing.toFixed(3),
               r: +r2.toFixed(2), shore: +shore2.toFixed(2),
               ink: +inkRatio.toFixed(4), inkNote,
               pos: [+sp.x.toFixed(2), +sp.z.toFixed(2)],
               center: [+sc.x.toFixed(2), +sc.z.toFixed(2)] },
    };
  });

  const H = R.hero, S = R.stele;
  console.log(`\n[立峰] 高 ${H.h}m 宽 ${H.w}m ｜ 瘦高比 ${H.slenderness} ｜ 收分(底/顶半径) ${H.taper} ｜ 悬挑偏心 ${H.leanOff}`);
  console.log(`       拓扑 V=${H.V} E=${H.E} F=${H.F} χ=${H.chi} ｜ 连通分量 ${H.C} ｜ 边界环 ${H.b} → **透孔 ${H.genus} 个**`);
  console.log(`       伴石 ` + R.comps.map(c => `${c.F} 面/分量${c.C}/边界环${c.b}/χ${c.chi}`).join('  ｜  ') + ` ｜ 立峰位置 (${H.pos})`);
  console.log(`[题名石] 长 ${S.len}m 高 ${S.h}m 厚 ${S.wide}m ｜ 高/长 = ${S.ratio} ｜ 落位 (${S.pos})`);
  console.log(`         距池心 ${S.r}m / 该方向岸线 ${S.shore}m（+${(S.r - S.shore).toFixed(2)}m）｜ 在池内=${S.inPond}`);
  console.log(`         材质组 ${JSON.stringify(S.groups)} ｜ 在池内=${S.inPond} ｜ 刻字面朝池心 ${S.facing} ｜ 墨迹占比 ${(S.ink * 100).toFixed(2)}%`);

  check('立峰是单块（连通分量 = 1，不掉浮空碎块）', H.C === 1, `连通分量 ${H.C}，边界环 ${H.b}`);
  check(`立峰透孔数 ≥ 6（"孔洞再多一些"）`, H.genus >= 6, `实测 ${H.genus} 个贯穿孔`);
  check('立峰"瘦"（高 > 1.6 × 宽）', H.slenderness > 1.6, `${H.slenderness}`);
  check('立峰"收分"（底半径 > 1.15 × 顶半径）', H.taper > 1.15, `${H.taper}`);
  check('立峰有悬挑（质心偏离 bbox 中心 > 4% 半宽）', H.leanOff > 0.04, `${H.leanOff}`);
  /* 伴石是半浸在水里的陪石，剩下的边界环应当只是**孔开口 + 底封口**（3 条隧道 ×2 + 底面 ≈ 7~9），
     不再是「隧道在瘦石体侧面拖出的长沟豁口」（2026-09-17 实测旧参数 b=15/19）。
     修复：tunLen 收短隧道 + biteN=0 关掉咬穿侧面的大咬缺球。半浸被水面/池底遮挡是视觉问题、
     不产生几何边界环，所以这里只卡环数上限，不要求 genus（半浸石不数透孔）。 */
  check('伴石是单块', R.comps.every(c => c.C === 1), R.comps.map(c => `分量${c.C}`).join('/'));
  check('伴石几何量够（未被切烂，≥800 面）', R.comps.every(c => c.F >= 800),
    R.comps.map(c => c.F + ' 面').join(' / '));
  check('伴石豁口已收敛（边界环 ≤ 10，只剩孔开口不是长沟豁口）', R.comps.every(c => c.b <= 10),
    R.comps.map(c => '环' + c.b).join(' / '));

  check('题名石是卧石不是碑（高/长 < 0.6）', S.ratio < 0.6, `${S.ratio}（墓碑式方板通常 > 1.2）`);
  check('题名石体量合宜（长 1.2~3.5m）', S.len > 1.2 && S.len < 3.5, `${S.len}m`);
  const mats = new Set(S.groups.map(g => g.mat));
  check('题名石只有石材 + 刻字面两种材质、且只切 2 段（无碑座/边框、不多 draw call）',
    mats.size === 2 && S.groups.length <= 2 && S.groups.every(g => g.count > 0),
    `${S.groups.length} 段 / ${mats.size} 种材质`);
  check('题名石在岸上（不在水里）', !S.inPond, `insidePond=${S.inPond}`);
  check('刻字面朝向池心（来人看得见）', S.facing > 0.7, `dot=${S.facing}`);
  check('石面确有刻字墨迹（不是空白贴图）', S.ink > 0.004, `${(S.ink * 100).toFixed(2)}% 暗像素 ${S.inkNote}`);
  check('页面无报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');

  await finish();

  async function finish(){
    const pass = results.filter(r => r.ok).length;
    console.log(`\n${pass === results.length ? '✓' : '✗'} ${pass}/${results.length} ${pass === results.length ? 'ALL PASS' : 'FAILED'}`);
    try { await browser.close(); } catch {}
    server.close();
    process.exit(pass === results.length ? 0 : 1);
  }
})().catch(async e => {
  console.error('探针异常：', e);
  process.exit(1);
});
