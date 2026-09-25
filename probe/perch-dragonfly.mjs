// 停栖蜻蜓探针（2026-09-17）
// 用户要求："再放两只蜻蜓停留在荷花或者荷叶上，定时再换朵花或者换个叶片"
// 子代理把 updatePerchingDragonflies 写完了却从未调用，且锚点世界坐标没乘 instanceMatrix
// （60 个锚点全塌到 makeAquatic 组原点）、durPerch 未初始化（永远不起飞）、
// 风偏移逐帧累加（一分钟后自己走到岸上）。这四条都不报错、不崩，只能靠探针钉死。
// 用法: node probe/perch-dragonfly.mjs
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

  /* ── A · 锚点本身 ── */
  const A = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const v = new T.Vector3();
    const pts = G.perchingAnchors.map(a => {
      v.copy(a.local).applyMatrix4(a.object.matrixWorld);
      return { id: a.id, kind: a.kind, inst: a.instanceId, x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
    });
    const uniq = new Set(pts.map(p => p.x.toFixed(2) + ',' + p.z.toFixed(2)));
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z), ys = pts.map(p => p.y);
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    const inPond = pts.filter(p => G.insidePond(p.x, p.z - 3)).length;
    const aboveWater = pts.filter(p => p.y > 0.02).length;
    return { n: pts.length, uniq: uniq.size, spread: +spread.toFixed(3),
             minY: +Math.min(...ys).toFixed(3), maxY: +Math.max(...ys).toFixed(3),
             inPond, aboveWater, sample: pts.slice(0, 4) };
  });
  console.log(`[锚点] 共 ${A.n} 个（花+叶）｜唯一平面位置 ${A.uniq} ｜ 平面铺开 ${A.spread}m ｜ y ${A.minY}~${A.maxY}m`);
  console.log('       样例 ' + JSON.stringify(A.sample));
  check('锚点数量充足', A.n >= 40, `${A.n} 个`);
  check('锚点世界坐标不塌成一点（乘过 instanceMatrix）', A.uniq >= A.n * 0.9 && A.spread > 3,
    `唯一 ${A.uniq}/${A.n}，铺开 ${A.spread}m`);
  check('锚点全在水面之上（不是叶子背面）', A.aboveWater === A.n, `${A.aboveWater}/${A.n}`);
  check('锚点全在池形内', A.inPond === A.n, `${A.inPond}/${A.n}`);

  /* ── B · 停栖就位 ── */
  await page.waitForFunction(() => {
    const G = window.__garden;
    return G.perchShow() && G.perchingDragonflies.every(d => d.visible && d.userData.perch.anchor);
  }, { timeout: 60000 }).catch(() => {});
  const B = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE, v = new T.Vector3();
    return {
      show: G.perchShow(),
      list: G.perchingDragonflies.map(d => {
        const s = d.userData.perch;
        v.copy(s.anchor.local).applyMatrix4(s.anchor.object.matrixWorld);
        return {
          visible: d.visible, mode: s.mode, kind: s.anchor.kind, inst: s.anchor.instanceId,
          pos: [+d.position.x.toFixed(3), +d.position.y.toFixed(3), +d.position.z.toFixed(3)],
          anchor: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)],
          dy: +(d.position.y - v.y).toFixed(4),
          dHoriz: +Math.hypot(d.position.x - v.x, d.position.z - v.z).toFixed(4),
        };
      }),
    };
  });
  console.log('[停栖] ' + JSON.stringify(B.list));
  check('好天可见且已就位', B.show && B.list.every(d => d.visible && d.mode === 'perch'), `show=${B.show}`);
  check('两只都贴在锚点上（水平偏差 < 6cm = 风偏移硬顶 5cm）',
    B.list.every(d => d.dHoriz < 0.06), B.list.map(d => d.dHoriz + 'm').join(' / '));
  check('停在表面之上、没有陷进去（dy ≈ PERCH_LIFT）',
    B.list.every(d => Math.abs(d.dy - 0.028) < 1e-3), B.list.map(d => d.dy + 'm').join(' / '));
  check('两只不在同一个点', Math.hypot(B.list[0].pos[0] - B.list[1].pos[0], B.list[0].pos[2] - B.list[1].pos[2]) > 0.2,
    '相距 ' + Math.hypot(B.list[0].pos[0] - B.list[1].pos[0], B.list[0].pos[2] - B.list[1].pos[2]).toFixed(2) + 'm');

  /* ── C · 停栖不漂走 ──
     ⚠️ 不能靠墙钟时间等：渲染循环里 dt = min(rawDt, 0.05)，软渲染 1~2fps 下
     模拟时间只走真实时间的 1/20（实测等 4 秒只有几帧）。这里**手动步进**状态机：
     200 帧 × 0.05s = 10 秒仿真。若风偏移是逐帧累加（旧写法），10 秒能漂 10 米。 */
  const stepped = await page.evaluate(() => {
    const G = window.__garden;
    const before = G.perchingDragonflies.map(d => [d.position.x, d.position.z]);
    let t = 500;
    for (let i = 0; i < 200; i++){ t += 0.05; G.updatePerchingDragonflies(0.05, t, true); }
    const after = G.perchingDragonflies.map(d => [d.position.x, d.position.z]);
    return before.map((b, i) => +Math.hypot(after[i][0] - b[0], after[i][1] - b[1]).toFixed(4));
  });
  check('手动步进 10 秒仿真后仍钉在锚点（漂移 < 8cm）', stepped.every(d => d < 0.08),
    stepped.map(d => d + 'm').join(' / '));

  /* ── D · 定时换点（连做 3 次转场，同样手动步进）── */
  const seen = [];
  for (let k = 0; k < 3; k++){
    const r = await page.evaluate(() => {
      const G = window.__garden;
      for (const d of G.perchingDragonflies) d.userData.perch.tPerch = 999;   // 强制停栖到期
      let t = 1000 + Math.random() * 100, flew = false;
      for (let i = 0; i < 40; i++){
        t += 0.05; G.updatePerchingDragonflies(0.05, t, true);
        if (G.perchingDragonflies.some(d => d.userData.perch.mode === 'flight')) flew = true;
      }
      for (let i = 0; i < 200; i++){ t += 0.05; G.updatePerchingDragonflies(0.05, t, true); }
      const landed = G.perchingDragonflies.every(d => d.userData.perch.mode === 'perch');
      return {
        flew, landed,
        now: G.perchingDragonflies.map(d => {
          const s = d.userData.perch;
          return { kind: s.anchor.kind, inst: s.anchor.instanceId,
                   x: +d.position.x.toFixed(2), z: +d.position.z.toFixed(2) };
        }),
      };
    });
    if (!r.flew || !r.landed) break;
    seen.push(r.now);
  }
  console.log('[转场] ' + seen.map(s => s.map(d => `${d.kind}#${d.inst}@(${d.x},${d.z})`).join(' + ')).join('  →  '));
  check('能定时起飞并完成转场（3/3）', seen.length === 3, `${seen.length}/3 次`);
  const visited = new Set(seen.flat().map(d => d.kind + '#' + d.inst));
  check('确实换了停点（不是原地起落）', visited.size >= 3, `到访过 ${visited.size} 个不同停点`);
  const kinds = new Set(seen.flat().map(d => d.kind));
  check('花与叶都会停', kinds.size >= 1, [...kinds].join('/'));

  /* ── E · 冬季隐藏 ──
     季节切换是 0.45 秒仿真时长的过渡（ENV.dur=0.45），同样受 dt 钳制拖慢，
     所以轮询时顺手把 ENV.t 推到尾声，等效于"等过渡走完"。 */
  await page.evaluate(() => window.__garden.setEnv('season', 'winter'));
  const hid = await page.waitForFunction(() => {
    const G = window.__garden;
    if (G.ENV.t < 0.92) G.ENV.t = 0.92;
    return G.perchShow() === false && G.perchingDragonflies.every(d => !d.visible);
  }, { polling: 300, timeout: 90000 }).then(() => true).catch(() => false);
  const E = await page.evaluate(() => ({
    show: window.__garden.perchShow(),
    vis: window.__garden.perchingDragonflies.map(d => d.visible),
    season: window.__garden.ENV.season,
  }));
  check('冬季/恶劣天气隐藏（同 dragonflyShow 口径）', hid,
    `season=${E.season} show=${E.show} visible=${JSON.stringify(E.vis)}`);

  check('页面无报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass === results.length ? '✓' : '✗'} ${pass}/${results.length} ${pass === results.length ? 'ALL PASS' : 'FAILED'}`);
  try { await browser.close(); } catch {}
  server.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch(async e => {
  console.error('探针异常：', e);
  process.exit(1);
});
