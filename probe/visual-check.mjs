// 视觉验收探针（2026-09-17）：紫藤叶/藤近景、GLB 荷花低视角杆、竹林风前风后对比。
// 只读页面状态、不改场景代码；截图输出到 outputs/visual/。
// 用法: node probe/visual-check.mjs
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

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const msgs = [];
  page.on('pageerror', e => msgs.push('[pageerror] ' + e));
  page.on('console', m => { if (m.type() === 'error') msgs.push('[error] ' + m.text()); });

  // 使用真实 GPU 能力分档，不伪装高端显卡，避免软渲染过载后输出空白样张。

  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000 });
  /* ⚠️ 必须等**异步 GLB** 到齐，不能只等延迟批（柳/竹/紫藤）：GLB（荷 / 芭蕉 / 龟）
     是在 loading 收起之后才挂载的，实测还要约 8 秒（2026-09-17 用轮询探针量过）。
     固定 sleep 会拍到"只有假茎、没有叶子"的芭蕉。 */
  const glbReady = await page.waitForFunction(() => {
    let lotus = 0, banana = 0;
    window.__garden.scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.name === 'LotusPlant') lotus++;
      else if (o.name === 'BananaPlant') banana++;
    });
    return lotus >= 12 && banana >= 8 ? { lotus, banana } : false;
  }, { timeout: 120000, polling: 500 }).then(v => v.jsonValue?.() ?? v).catch(() => null);
  console.log('[就绪] GLB ' + (glbReady ? JSON.stringify(glbReady) : '超时未齐（样张可能缺叶）'));
  await page.waitForTimeout(1500);   // 等延迟批（柳/竹/紫藤）装配完

  await page.evaluate(() => {
    const g = window.__garden;
    g.ENV.dur = 0.25;
    // 保留应用自身的渲染链与分辨率配置，样张只修改环境、机位和界面显隐。
    for (const id of ['env', 'hud', 'stats']){ const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  });

  const shot = async (name) => {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const f = path.join(OUT, name);
    await page.screenshot({ path: f });
    console.log('  ✓ ' + name);
  };

  /* ── 1 · 紫藤近景：藤管被 mergeStatics 合并后丢了名字，改按叶卡 InstancedMesh
       的 userData.seasonWisteriaLeaf 定位，其父组即整丛紫藤 ── */
  const wInfo = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let best = null;
    g.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.userData.seasonWisteriaLeaf) return;
      const root = o.parent;
      const box = new T.Box3().setFromObject(root);
      const sz = box.getSize(new T.Vector3());
      if (!best || sz.x > best.sz) best = { root, sz: sz.x };
    });
    if (!best) return { found: false };
    const root = best.root;
    let leafCount = 0, flowerCount = 0;
    root.traverse(o => {
      if (!o.isInstancedMesh) return;
      if (o.userData.seasonWisteriaLeaf) leafCount = o.count;
      else flowerCount = o.count;
    });
    const wp = new T.Vector3(); root.getWorldPosition(wp);
    const lb = new T.Box3().setFromObject(root);
    return {
      found: true, pos: [+wp.x.toFixed(1), +wp.y.toFixed(1), +wp.z.toFixed(1)],
      leafCount, flowerCount,
      box: [+lb.min.x.toFixed(1), +lb.min.y.toFixed(1), +lb.min.z.toFixed(1), +lb.max.x.toFixed(1), +lb.max.y.toFixed(1), +lb.max.z.toFixed(1)],
      /* ⚠️ 机位必须在紫藤**北侧**（z 小于棚架）：南侧是游廊屋面，从东南上方看过去
         视线会被瓦面整个挡住 —— 旧机位 (wp.x+3.4, wp.y+2.0, wp.z+3.4) 拍出来
         是一屏屋顶，紫藤一张都没入画（2026-09-17 发现）。棚架沿 x 展开、z≈1，
         所以取箱体中心的 x、z 往北退 7m、镜头略低于棚架顶。 */
      cam: [+((lb.min.x + lb.max.x) / 2).toFixed(1), +((lb.min.y + lb.max.y) / 2 - 0.4).toFixed(1),
            +(lb.min.z - 7.0).toFixed(1)],
      target: [+((lb.min.x + lb.max.x) / 2).toFixed(1), +((lb.min.y + lb.max.y) / 2 + 0.1).toFixed(1),
               +((lb.min.z + lb.max.z) / 2).toFixed(1)],
    };
  });
  console.log('[紫藤] ' + JSON.stringify(wInfo));
  if (wInfo.found){
    await page.evaluate((c) => {
      const g = window.__garden;
      g.setEnv('season', 'summer'); g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
      g.camera.position.set(c.cam[0], c.cam[1], c.cam[2]);
      g.camera.fov = 42; g.camera.updateProjectionMatrix();
      g.controls.target.set(c.target[0], c.target[1], c.target[2]);
      g.controls.update();
    }, wInfo);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await shot('wisteria-noon.png');
  }

  /* ── 2 · GLB 荷花低视角：12 株荷花丛散布在池心 (-2.5, 2.2) 半径 5.6 内，
       杆已并入 MAT.lily 静态桶（名字丢失），材质名在浏览器里也不保留。
       直接用池塘固定取景：从池北贴水面看向池心，丛与杆自然入画 ── */
  console.log('[荷花杆] 池心固定取景（lotusSpots 均值 -2.5,2.2 / r≤5.6）');
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('season', 'summer'); g.setEnv('time', 'afternoon'); g.setEnv('weather', 'clear');
    // 低机位：镜头贴水面、从池北看向池心荷花丛（模拟用户截图角度）
    g.camera.position.set(3.2, 0.42, 8.8);
    g.camera.fov = 40; g.camera.updateProjectionMatrix();
    g.controls.target.set(-2.5, 0.85, 2.2);
    g.controls.update();
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
  await shot('lotus-low-angle.png');

  /* ── 3 · 竹林：风和日丽 vs 狂风，同机位两张 ── */
  const bInfo = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let leaf = null;
    g.scene.traverse(o => { if (o.isInstancedMesh && o.userData.seasonBambooLeaf && !leaf) leaf = o; });
    if (!leaf) return { found: false };
    const wp = new T.Vector3(); leaf.getWorldPosition(wp);
    return { found: true, pos: [+wp.x.toFixed(1), +wp.y.toFixed(1), +wp.z.toFixed(1)], count: leaf.count };
  });
  console.log('[竹叶] ' + JSON.stringify(bInfo));
  if (bInfo.found){
    await page.evaluate((c) => {
      const g = window.__garden;
      g.setEnv('season', 'summer'); g.setEnv('time', 'noon');
      g.camera.position.set(c.pos[0] + 5.5, c.pos[1] + 1.4, c.pos[z = 0] + 5.5);
      g.camera.fov = 44; g.camera.updateProjectionMatrix();
      g.controls.target.set(c.pos[0], c.pos[1] + 0.8, c.pos[2 || 0]);
      g.controls.update();
    }, bInfo);
    await page.evaluate(() => { window.__garden.setEnv('weather', 'clear'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot('bamboo-calm.png');
    // 切狂风：底值风 0.72 + 等一阵风过
    await page.evaluate(() => { window.__garden.setEnv('weather', 'storm'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    const wind = await page.evaluate(() => {
      const g = window.__garden;
      let u = null;
      g.scene.traverse(o => {
        if (o.material && o.material.userData && o.material.userData.shader && !u){
          u = { global: o.material.userData.shader.uniforms.uWindGlobal.value,
                strength: o.material.userData.shader.uniforms.uWindStrength.value };
        }
      });
      return u;
    });
    console.log('[风场] storm 切换后 uniform = ' + JSON.stringify(wind));
    await page.waitForTimeout(7000);   // 等阵风扫过
    await shot('bamboo-storm.png');
  }

  /* ── 4 · 灯笼秋千摆：同一檐下机位，先静风再狂风，确认灯串不是悬死 ── */
  const lInfo = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const box = new T.Box3().setFromObject(g.scene);
    return {
      found: g.lanternGroups ? g.lanternGroups.length > 0 : false,
      count: g.lanternGroups ? g.lanternGroups.length : 0,
      cam: [1.0, 3.6, -3.2],
      target: [0, 4.6, -7.1],
    };
  });
  console.log('[灯笼] ' + JSON.stringify(lInfo));
  if (lInfo.found){
    await page.evaluate((c) => {
      const g = window.__garden;
      g.setEnv('season', 'summer'); g.setEnv('time', 'dusk'); g.setEnv('weather', 'clear');
      g.camera.position.set(c.cam[0], c.cam[1], c.cam[2]);
      g.camera.fov = 38; g.camera.updateProjectionMatrix();
      g.controls.target.set(c.target[0], c.target[1], c.target[2]);
      g.controls.update();
    }, lInfo);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await page.waitForTimeout(1200);
    await shot('lantern-calm.png');
    await page.evaluate(() => { window.__garden.setEnv('weather', 'storm'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await page.waitForTimeout(5000);
    await shot('lantern-storm.png');
  }

  /* ── 5 · 柳树（垂柳）：静风 vs 狂风，验证 0.14/0.11 是否不再"摇呼啦圈" ── */
  const w2Info = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let best = null;
    g.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.userData.seasonWillowLeaf) return;
      const wp = new T.Vector3(); o.getWorldPosition(wp);
      if (!best || o.count > best.count) best = { wp, count: o.count };
    });
    if (!best) return { found: false };
    return { found: true, pos: [+best.wp.x.toFixed(1), +best.wp.y.toFixed(1), +best.wp.z.toFixed(1)], count: best.count };
  });
  console.log('[垂柳] ' + JSON.stringify(w2Info));
  if (w2Info.found){
    await page.evaluate((c) => {
      const g = window.__garden;
      g.setEnv('season', 'spring'); g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
      g.camera.position.set(c.pos[0] + 4.5, c.pos[1] + 1.2, c.pos[2] + 4.5);
      g.camera.fov = 42; g.camera.updateProjectionMatrix();
      g.controls.target.set(c.pos[0], c.pos[1] + 1.0, c.pos[2]);
      g.controls.update();
    }, w2Info);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot('willow-calm.png');
    await page.evaluate(() => { window.__garden.setEnv('weather', 'storm'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
    await page.waitForTimeout(5000);
    await shot('willow-storm.png');
  }

  /* ── 6 · 芭蕉：静风 vs 狂风，验证"动的是叶子、假茎根部钉在地里" ── */
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('season', 'summer'); g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
    // 西侧芭蕉丛（-15.6,-5.6 / -15.0,-8.2 / -17.2,-9.6，假茎高 2.1~3.6）
    g.camera.position.set(-11.2, 2.8, 0.6);
    g.camera.fov = 45; g.camera.updateProjectionMatrix();
    g.controls.target.set(-16.0, 2.2, -7.0);
    g.controls.update();
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot('banana-calm.png');
  await page.evaluate(() => { window.__garden.setEnv('weather', 'storm'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
  await page.waitForTimeout(5000);
  await shot('banana-storm.png');

  if (msgs.length) console.log('[页面报错]\n' + msgs.join('\n'));
  else console.log('[页面报错] 无');
  await browser.close();
  server.close();
})();
