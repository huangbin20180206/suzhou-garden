/* 临时诊断（**不入链**，2026-09-20）：为什么"注入已挂"的石头在画面上不积雪？
 *
 * 背景：weather-coverage 的 G5 断言 stoneMat/bambooA 的 customProgramCacheKey 里带 `|snow`，
 * 且 G6 的"手段有效性对照"成立（关掉覆盖量整幅画面 Δ=40.1）——
 * 可是**石头那块 ROI 几乎不动**，俯视存证图里石头是深灰的、一点雪都没有。
 * 于是矛盾出现了：标记挂上了、uniform 也在起作用，唯独石头不白。
 *
 * 读法：直接问 WebGLRenderer —— **每个材质当前实际用的那个 program** 里，
 * 到底有没有 `uSnowCover` 这段着色代码。这是唯一能区分下面两种情况的证据：
 *   ① program 里就没有雪 → 注入/编译阶段丢了（key 碰撞、链没接上…）
 *   ② program 里有雪、石头还是不白 → 那才是 vSnowN / dr 的计算问题
 *
 * ⚠️ 绝不能用"包一层 onBeforeCompile 再观察"来查这件事：
 *    Three 的默认 cacheKey 就是 `onBeforeCompile.toString()`，一包就变，
 *    立刻污染所有材质之间的 program 共享关系 —— 那样测到的现象是自己造出来的。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
  page.setDefaultTimeout(180000);

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  await page.waitForFunction(() => {
    let has = false;
    window.__garden.scene.traverse(o => { if (o.isMesh && o.name === 'stele') has = true; });
    return has;
  }, { timeout: 180000, polling: 400 });
  /* 切到冬天+雪，让雪的路径真正被走一遍（light/雪材质都被渲染过） */
  await page.evaluate(() => { window.__garden.setEnv('season', 'winter');
                              window.__garden.setEnv('weather', 'snow'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000 }).catch(() => {});
  await sleep(2000);

  const out = await page.evaluate(async () => {
    const G = window.__garden;
    const M = await import(new URL('src/01-materials.js', document.baseURI).href);
    const gl = G.renderer.getContext();
    const srcOf = (p) => p ? { frag: gl.getShaderSource(p.fragmentShader) || '',
                               vert: gl.getShaderSource(p.vertexShader) || '',
                               key: String(p.cacheKey || '') } : null;
    const snowSet = new Set(M.SNOW_COVER_MATS);

    const probe = (label, mat) => {
      if (!mat) return { label, err: '材质不存在' };
      /* renderer.properties 记录每个材质**当前编译使用**的 program */
      let cur = null;
      try { const pr = G.renderer.properties.get(mat); cur = pr && pr.currentProgram; } catch (e) { }
      const s = srcOf(cur);
      return {
        label, type: mat.type,
        inSnow: snowSet.has(mat),
        cacheKey: String(mat.customProgramCacheKey()).slice(0, 72),
        rendered: !!cur,
        snowInFrag: s ? s.frag.indexOf('uSnowCover') >= 0 : null,
        snowInVert: s ? s.vert.indexOf('vSnowW') >= 0 : null,
        colorFrag: s ? s.frag.indexOf('#include <color_fragment>') >= 0 : null,
        /* 露骨的完整性检查：vSnowN 在片元里有没有声明（有 replace 没成功就缺这个） */
        vSnowN: s ? s.frag.indexOf('varying vec3 vSnowN') >= 0 : null,
      };
    };

    const picks = [
      ['MAT.grass', M.MAT.grass], ['MAT.taihuHero', M.MAT.taihuHero], ['MAT.taihu', M.MAT.taihu],
      ['MAT.rock', M.MAT.rock], ['MAT.rockDark', M.MAT.rockDark], ['MAT.stone', M.MAT.stone],
      ['MAT.bambooA', M.MAT.bambooA], ['MAT.leaf', M.MAT.leaf], ['MAT.roof', M.MAT.roof],
      ['MAT.wall', M.MAT.wall], ['MAT.banana', M.MAT.banana], ['MAT.wisteria', M.MAT.wisteria],
    ].map(([l, m]) => probe(l, m));

    let stele = null;
    G.scene.traverse(o => { if (o.isMesh && o.name === 'stele') stele = o; });
    if (stele){
      (Array.isArray(stele.material) ? stele.material : [stele.material])
        .forEach((m, i) => picks.push(probe('stele.material[' + i + ']', m)));
    }

    /* 场景里真正在用的雪表材质，逐个看它渲染时用的 program 有没有雪 */
    const seen = new Set(), usedSnow = [];
    G.scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])){
        if (!m || seen.has(m.uuid) || !snowSet.has(m)) continue;
        seen.add(m.uuid);
        let cur = null;
        try { const pr = G.renderer.properties.get(m); cur = pr && pr.currentProgram; } catch (e) { }
        const s = srcOf(cur);
        usedSnow.push({ label: (m.name || m.color && '#' + m.color.getHexString() || '?')
                               + '/' + m.type.replace('Mesh', '').replace('Material', ''),
                        rendered: !!cur, snow: s ? s.frag.indexOf('uSnowCover') >= 0 : null });
      }
    });

    const progs = (G.renderer.info.programs || []).map(p => {
      const s = srcOf(p);
      return { key: s.key.slice(0, 64), used: p.usedTimes,
               snow: s.frag.indexOf('uSnowCover') >= 0,
               len: s.frag.length };
    });
    return { picks, usedSnow, nProg: progs.length,
             nSnowProg: progs.filter(p => p.snow).length,
             nFragSame: new Set(progs.map(p => p.len)).size,
             programs: progs };
  });

  console.log('\n════ 每个材质当前实际用的 program 里有没有雪 ════');
  for (const r of out.picks){
    if (r.err){ console.log(`  ${r.label}: ${r.err}`); continue; }
    console.log(`  ${r.label.padEnd(20)} 雪表=${r.inSnow ? 'Y' : 'n'} 已渲染=${r.rendered ? 'Y' : 'n'}`
              + ` ｜ 片元有雪=${r.snowInFrag} 顶点有雪=${r.snowInVert} 有vSnowN=${r.vSnowN}`
              + ` ｜ key=${r.cacheKey}`);
  }

  console.log('\n════ 场景里在用的雪表材质（渲染时用的 program 里有没有雪）════');
  const bad = out.usedSnow.filter(r => r.rendered && r.snow === false);
  for (const r of out.usedSnow)
    console.log(`  ${r.snow === true ? '✓' : r.snow === false ? '✗' : '?'} ${r.label}`
              + `${r.rendered ? '' : ' (尚未渲染)'}`);
  console.log(`  → 在用的雪表材质 ${out.usedSnow.length} 种，其中 program 里**没有**雪的 ${bad.length} 种`);

  console.log(`\n════ program 总览 ════`);
  console.log(`  编译过的 program ${out.nProg} 个，其中片元含 uSnowCover 的 ${out.nSnowProg} 个`
            + ` ｜ 片元长度各不相同的 ${out.nFragSame} 种（相同长度≈同一份源码）`);
  console.log(`  （cacheKey 前列：注意若大量材质共享同一个 key，它们会被当成同一份 program）`);
  const keys = {};
  for (const p of out.programs) keys[p.key] = (keys[p.key] || 0) + 1;
  Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([k, n]) => console.log(`    ×${n}  ${k}`));

  /* ── 第二轮：把雪染成洋红，看它到底盖在哪 ──
     亮度在这儿不够灵敏：石头基色本来就灰、背景又被雾洗白，中位亮度差只有 1。
     把共享的 uSnowTint 改成洋红 —— 只要雪真的混进某个像素，它就会刺眼地变品红；
     没变紫的地方就是"雪没盖上去"的地方。一眼定位问题范围。 */
  const OUT = path.join(ROOT, 'outputs', 'weather-coverage');
  fs.mkdirSync(OUT, { recursive: true });
  const tint = await page.evaluate(async () => {
    const M = await import(new URL('src/01-materials.js', document.baseURI).href);
    let uCov = null, uTint = null;
    const mat = M.MAT.taihuHero;                 // 场景里那些大石用的材质
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r){ prev.call(this, sh, r);
      if (sh.uniforms.uSnowCover) uCov = sh.uniforms.uSnowCover;
      if (sh.uniforms.uSnowTint)  uTint = sh.uniforms.uSnowTint; };
    mat.needsUpdate = true;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!uCov || !uTint) return { err: '没捕获到' };
    window.__uCov = () => uCov; window.__uTint = () => uTint;
    const c = uTint.value;
    return { cov: uCov.value, tint: '#' + c.getHexString(),
             rgb: [+c.r.toFixed(3), +c.g.toFixed(3), +c.b.toFixed(3)] };
  });
  console.log('\n════ 第二轮：把雪染成洋红，看它盖在哪 ════');
  if (tint.err) console.log('  ✗ ' + tint.err);
  else {
    console.log(`  捕获到共享 uniform：uSnowCover=${tint.cov} ｜ uSnowTint=${tint.tint} rgb=${tint.rgb}`);
    await page.screenshot({ path: path.join(OUT, 'diag-tint-normal.png') });
    await page.evaluate(() => window.__uTint().value.setRGB(1, 0, 1));
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, 'diag-tint-magenta.png') });
    await page.evaluate(([r, g, b]) => window.__uTint().value.setRGB(r, g, b), tint.rgb);
    console.log('  存证：outputs/weather-coverage/diag-tint-normal.png 与 diag-tint-magenta.png');
    console.log('  判读：洋红出现在哪，雪就真的盖在哪；仍是石头本色的地方 = 雪没上去。');
  }

  await browser.close();
  server.close();
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
