// 特置立峰样稿探针：固定机位拍 晨·薄雾 / 午 / 暮 三张，供评审。
// 用法: node probe/hero-shot.mjs [outDir]
// 只读页面状态，不修改任何场景代码；输出到 outputs/hero/（已被 .gitignore 排除）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));   // 位置参数才是输出目录
const OUT = path.resolve(ARGS[0] || path.join(ROOT, 'outputs', 'hero'));

function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
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

/* 机位参数：低机位、略长焦 —— 参考图那种"一只石、一片水、几丛草"的压缩感。
   SIDE 把石头推到画面右三分线（正中构图太"证件照"）。 */
const DIST = 11.0, SIDE = 2.4, CAM_Y = 1.55, TARGET_Y = 1.75, FOV = 34;

/* --isolate：把除立峰外的世界全部藏起来，单独拍石头本身（形状/材质/孔洞一次看清） */
const ISOLATE = process.argv.includes('--isolate');
/* --rockery：改用"看南岸两座假山"的机位，检查峰群是否已换成同源石头 */
const ROCKERY = process.argv.includes('--rockery');
/* --fast：跳过环境三态与近景，只出官方机位那张（调构图时迭代快 3 分钟） */
const FAST = process.argv.includes('--fast');

const SHOTS = [
  { name: 'hero-morning-mist.png', time: 'morning', weather: 'mist',  label: '晨 · 薄雾' },
  { name: 'hero-noon.png',         time: 'noon',    weather: 'clear', label: '午 · 风和日丽' },
  { name: 'hero-dusk.png',         time: 'dusk',    weather: 'clear', label: '暮 · 风和日丽' },
];

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);          // 软渲染下单帧可能十几秒，30s 默认值会把 evaluate 掐掉
  const msgs = [], boot = [];
  page.on('pageerror', e => msgs.push('[pageerror] ' + e));
  page.on('console', m => {
    const t = m.text();
    if (/特置立峰|场景就绪|启动分段|GPU档位/.test(t)) boot.push(t);
    else if (m.type() === 'error') msgs.push('[error] ' + t);
  });
  /* 把渲染器字符串伪装成独显档：核显档**不走真实平面反射**（见 index.html 的 GPU_TIER 分支），
     那样拍出来的水面是一块平板，看不到立峰倒影 —— 而倒影正是这套构图的一半。
     只影响本探针的判定，不改页面代码。 */
  await page.addInitScript(() => {
    const ENUM = 0x9246, VENDOR = 0x9245;
    const patch = (proto) => {
      if (!proto) return;
      const orig = proto.getParameter;
      proto.getParameter = function (p){
        if (p === ENUM || p === VENDOR) return 'NVIDIA GeForce RTX 4080 (probe spoof)';
        return orig.call(this, p);
      };
    };
    patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  });

  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000 });
  /* P1-4：立峰延迟装配（首帧渲完才建），这里等石头落地再拍，别和延迟批抢跑 */
  await page.waitForFunction(() => {
    let h = null;
    if (window.__garden) window.__garden.scene.traverse(o => { if (o.name === 'taihuHero') h = o; });
    return !!h;
  }, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => { window.__garden.ENV.dur = 0.25; });

  const info = await page.evaluate((cfg) => {
    const g = window.__garden, T = g.THREE;
    if (cfg.ISOLATE){
      const keep = new Set();
      g.scene.traverse(o => { if (o.name === 'taihuHero' || o.name === 'taihuCompanion') keep.add(o); });
      g.scene.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh && !o.isPoints) return;
        let p = o, isHero = false;
        while (p){ if (keep.has(p)){ isHero = true; break; } p = p.parent; }
        if (!isHero) o.visible = false;
      });
      window.__isolateKeep = () => {};     // applyPresence 每帧重申存在性，隔离期间会被翻回来，故不拍环境态
    }
    /* ── 软渲染降负（只影响本探针的绘制成本，不改页面逻辑与构图）──
       独显档默认 6144² 阴影 + GTAO 法线预渲染 + 1.15 超采样：真实 GPU 上没问题，
       SwiftShader 上每帧几十秒。这里把阴影降到 1024²、摘掉 GTAO pass、超采样关掉，
       保留**水面平面反射**（那才是这套构图的一半）。 */
    g.scene.traverse(o => {
      if (o.isDirectionalLight && o.castShadow){
        o.shadow.mapSize.set(1024, 1024);
        if (o.shadow.map){ o.shadow.map.dispose(); o.shadow.map = null; }
      }
    });
    if (g.composer){
      g.composer.passes = g.composer.passes.filter(p => !(p.constructor && p.constructor.name === 'GTAOPass'));
      g.composer.setPixelRatio(1); g.composer.setSize(innerWidth, innerHeight);
    }
    g.renderer.setPixelRatio(1); g.renderer.setSize(innerWidth, innerHeight);
    g.renderer.shadowMap.needsUpdate = true;
    let hero = null, comps = 0;
    g.scene.traverse(o => {
      if (o.name === 'taihuHero') hero = o;
      if (o.name === 'taihuCompanion') comps++;
    });
    if (!hero) return { found: false, comps };
    const wp = new T.Vector3(); hero.getWorldPosition(wp);
    const box = new T.Box3().setFromObject(hero);
    const size = box.getSize(new T.Vector3());
    /* 机位：站在石头与池心之间（跨水），低机位略仰视 —— 倒影落在镜头与石头之间 */
    const out = new T.Vector3(wp.x, 0, wp.z).normalize();          // 池心 → 石头
    const side = new T.Vector3(-out.z, 0, out.x);                  // 水平垂直方向
    const cam = new T.Vector3(wp.x - out.x * cfg.DIST + side.x * cfg.SIDE, cfg.CAM_Y,
                              wp.z - out.z * cfg.DIST + side.z * cfg.SIDE);
    g.camera.position.copy(cam);
    g.camera.fov = cfg.FOV; g.camera.updateProjectionMatrix();
    g.controls.target.set(wp.x, cfg.TARGET_Y, wp.z);
    g.controls.update();
    return {
      found: true, comps,
      hero: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
      size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
      cam: [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2)],
      tris: hero.geometry.userData.tris,
      hasColor: !!hero.geometry.attributes.color,
    };
  }, { DIST, SIDE, CAM_Y, TARGET_Y, FOV, ISOLATE });

  /* ── 漏透率（"透"是可测量的）──
     把材质临时改成 DoubleSide，再沿两个水平方向各撒 90×90 条平行射线：
       实心石 → 每条穿过轮廓的射线恰好 2 次进出；
       有通洞 → 同一条射线会 4 次（进-出-进-出）。
     through / silhouette 就是"隔石见景"的面积占比。眼睛会骗人，这个数不会。 */
  const pierce = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let hero = null;
    g.scene.traverse(o => { if (o.name === 'taihuHero') hero = o; });
    const box = new T.Box3().setFromObject(hero);
    const size = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    const prevSide = hero.material.side;
    hero.material.side = T.DoubleSide;
    const rc = new T.Raycaster();
    const res = [];
    for (const dir of [new T.Vector3(0, 0, -1), new T.Vector3(1, 0, 0)]){
      const right = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), dir).normalize();
      const upv = new T.Vector3().crossVectors(dir, right).normalize();
      const N = 90, span = Math.max(size.x, size.z, size.y) * 1.25;
      let sil = 0, thru = 0;
      const org = new T.Vector3();
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++){
        const a = (i + 0.5) / N - 0.5, b = (j + 0.5) / N - 0.5;
        org.copy(center).addScaledVector(right, a * span).addScaledVector(upv, b * span);
        org.addScaledVector(dir, -span * 2);
        rc.set(org, dir); rc.far = span * 5;
        const hits = rc.intersectObject(hero, false);
        if (hits.length >= 2){ sil++; if (hits.length >= 4) thru++; }
      }
      res.push({ dir: dir.x ? '+x' : '-z', silhouette: sil, through: thru,
                 ratio: sil ? +(100 * thru / sil).toFixed(1) : 0 });
    }
    hero.material.side = prevSide;
    return res;
  });
  console.log('[漏透率] ' + pierce.map(r => r.dir + ': 轮廓 ' + r.silhouette + ' 格 / 通洞 ' + r.through
              + ' 格 → ' + r.ratio + '%').join(' ｜ '));

  /* ── 轮廓起伏（"势"的量化）──
     按高度切 20 层，量每层的最大水平半径。矩形板 → 各层几乎相等（CV 很小）；
     有收分、凹缺、悬挑的名石 → 半径忽大忽小（CV 大）。 */
  const shape = await page.evaluate(() => {
    let hero = null;
    window.__garden.scene.traverse(o => { if (o.name === 'taihuHero') hero = o; });
    const g = hero.geometry, p = g.attributes.position;
    g.computeBoundingBox();
    const yTop = g.boundingBox.max.y, N = 20, prof = new Array(N).fill(0);
    for (let i = 0; i < p.count; i++){
      const y = p.getY(i);
      if (y < 0.05) continue;                       // 只看水面以上
      const k = Math.min(N - 1, Math.floor((y / yTop) * N));
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (r > prof[k]) prof[k] = r;
    }
    const vals = prof.filter(v => v > 0);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length));
    const mx = Math.max(...vals), mn = Math.min(...vals);
    return { profile: prof.map(v => +v.toFixed(2)), cv: +(sd / mean).toFixed(3),
             maxMin: +(mx / Math.max(0.001, mn)).toFixed(2) };
  });
  console.log('[轮廓] 逐层半径 ' + shape.profile.join(' ') + ' ｜ 变异系数 ' + shape.cv + ' ｜ 粗细比 ' + shape.maxMin);

  if (ISOLATE){
    /* 隔离机位：3/4 视角、石心略上，石头尽量占满画面 */
    await page.evaluate(() => {
      const g = window.__garden, T = g.THREE;
      let hero = null;
      g.scene.traverse(o => { if (o.name === 'taihuHero') hero = o; });
      const wp = new T.Vector3(); hero.getWorldPosition(wp);
      const box = new T.Box3().setFromObject(hero);
      const cy = (box.min.y + box.max.y) / 2, h = box.max.y - box.min.y;
      g.camera.position.set(wp.x + 3.4, cy + h * 0.18, wp.z + 4.2);
      g.camera.fov = 34; g.camera.updateProjectionMatrix();
      g.controls.target.set(wp.x, cy + h * 0.05, wp.z);
      g.controls.update();
    });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const iso = path.join(OUT, 'hero-isolated.png');
    await page.screenshot({ path: iso });
    console.log('  ✓ 隔离样张 → ' + path.relative(ROOT, iso));
  }

  if (!info.found){ console.log('✗ 场景里没有找到 taihuHero —— 立峰未生成'); }
  else console.log('[机位] 石位 ' + JSON.stringify(info.hero) + ' 尺寸 ' + JSON.stringify(info.size)
                   + ' 机位 ' + JSON.stringify(info.cam) + ' 面数 ' + info.tris
                   + ' 顶点色 ' + info.hasColor + ' 伴石 ' + info.comps);

  if (!FAST) for (const s of SHOTS){
    await page.evaluate((sh) => {
      const g = window.__garden;
      if (g.ENV.season !== 'summer') g.setEnv('season', 'summer');
      if (g.ENV.time !== sh.time) g.setEnv('time', sh.time);
      if (g.ENV.weather !== sh.weather) g.setEnv('weather', sh.weather);
      /* 清干净画面：只留渲染结果，便于与参考图比对构图 */
      for (const id of ['env', 'hud', 'stats']){
        const el = document.getElementById(id); if (el) el.style.display = 'none';
      }
    }, s);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = path.join(OUT, s.name);
    await page.screenshot({ path: file });
    const st = await page.evaluate(() => {
      const i = window.__garden.renderer.info.render;
      return { calls: i.calls, tris: i.triangles };
    });
    console.log('  ✓ ' + s.label + ' → ' + path.relative(ROOT, file) + '  draw calls ' + st.calls + ' 三角形 ' + st.tris.toLocaleString());
  }
  if (boot.length) console.log('[启动日志]\n  ' + boot.join('\n  '));
  /* ── 近景机位：贴水面、略长焦，让石头在画面里占住主体（远景机位只作环境交代）── */
  if (!FAST){
  await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let hero = null;
    g.scene.traverse(o => { if (o.name === 'taihuHero') hero = o; });
    const wp = new T.Vector3(); hero.getWorldPosition(wp);
    const out = new T.Vector3(wp.x, 0, wp.z).normalize();
    const side = new T.Vector3(-out.z, 0, out.x);
    g.camera.position.set(wp.x - out.x * 6.2 + side.x * 1.5, 1.02, wp.z - out.z * 6.2 + side.z * 1.5);
    g.camera.fov = 30; g.camera.updateProjectionMatrix();
    g.controls.target.set(wp.x, 1.55, wp.z);
    g.controls.update();
  });
  for (const s of [{ n: 'hero-near-mist.png', t: 'morning', w: 'mist' }, { n: 'hero-near-noon.png', t: 'noon', w: 'clear' }]){
    await page.evaluate((sh) => {
      const g = window.__garden;
      g.setEnv('time', sh.t); g.setEnv('weather', sh.w);
    }, { t: s.t, w: s.w });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(OUT, s.n) });
    console.log('  ✓ 近景 ' + s.n);
  }
  }

  /* 官方机位（B：名石的"专用观赏面"）：走应用自己的 gotoViewpoint，验证飞行与构图 */
  await page.evaluate(() => {
    for (const id of ['env', 'hud', 'stats']){ const el = document.getElementById(id); if (el) el.style.display = ''; }
    window.__garden.gotoViewpoint('hero');
  });
  await page.waitForFunction(() => window.__garden && window.__garden.camFly && !window.__garden.camFly(),
    { timeout: 90000, polling: 200 }).catch(() => {});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: path.join(OUT, 'viewpoint-hero.png') });
  const camInfo = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let hb = null; g.scene.traverse(o => { if (o.name === 'taihuHero') hb = o; });
    const bb = new T.Box3().setFromObject(hb);
    return { cam: g.camera.position.toArray().map(v => +v.toFixed(2)), fov: g.camera.fov,
             target: g.controls.target.toArray().map(v => +v.toFixed(2)),
             heroTop: +bb.max.y.toFixed(2), dist: +g.camera.position.distanceTo(bb.getCenter(new T.Vector3())).toFixed(2) };
  });
  console.log('  ✓ 官方机位 viewpoint-hero.png ' + JSON.stringify(camInfo));

  if (ROCKERY){
    await page.evaluate(() => {
      const g = window.__garden;
      g.camera.position.set(1.5, 6.0, -4.0);
      g.camera.fov = 46; g.camera.updateProjectionMatrix();
      g.controls.target.set(1.5, 3.2, 15.0);
      g.controls.update();
      for (const id of ['env', 'hud', 'stats']){ const el = document.getElementById(id); if (el) el.style.display = 'none'; }
    });
    for (const s of [{ n: 'rockery-noon.png', t: 'noon', w: 'clear' }, { n: 'rockery-mist.png', t: 'morning', w: 'mist' }]){
      await page.evaluate((sh) => { const g = window.__garden; g.setEnv('time', sh.t); g.setEnv('weather', sh.w); }, { t: s.t, w: s.w });
      await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, s.n) });
      console.log('  ✓ 假山 ' + s.n);
    }
  }

  if (msgs.length) console.log('[页面报错]\n' + msgs.slice(0, 12).join('\n'));
  else console.log('[页面报错] 无');
  await browser.close();
  server.close();
})();
