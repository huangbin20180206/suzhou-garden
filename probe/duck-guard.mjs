// 池中水禽专项门禁 —— 2026-10-05 起**翻面**为"守它不再出现"：node probe/duck-guard.mjs
//
// ⚠️ 老黄 2026-10-05："去掉池子里的鸳鸯……保留金刚鹦鹉"。
//    整层水禽下线：绿头鸭 ♂♀ + 鸳鸯 ♂♀ **四只一起撤** —— 同一机位只有 12~14px，
//    分辨不出种类、只读作"池子里几个点"，与同时下线的草皮/假山小鸟是同一批量级。
//    产品侧只是把 `DUCK_KIND` 经 DUCK_ON 置空（**代码全保留**，恢复 = DUCK_ON 置 true），
//    所以本门也必须**能跟着一起复活**：旧的五组判据（① 逐顶点投影的尺寸口径 /
//    ② 24 相位池域 + 贴水面线 / ③ 在游 / ④ 不占涟漪配额 / ⑤ 本体在折射层而尾涡圈不在）
//    全部留在 git 历史里（本文件 2026-10-05 之前的那一版），恢复水禽时一并取回。
//
// 为什么"下线"也值得留一道门：这层是**被用户亲眼否掉**的东西，
// 最糟的回归不是它做错，而是哪天被某次重构顺手带回来（老黄不会再去确认一次）。
//
// 判据：
//   ① 场景里一只水禽都没有：`swimDucks` 为空 **且** 按名字扫不到任何 duck* 网格
//      （两条都要 —— 只看数组的话，有人换个地方建鸭子就绕过去了）
//   ② **自检（有牙）**：往场景注入一个 `name='duck0'` 的网格 ⇒ ① 必须报红，再移除。
//      没有这条，"扫不到"到底是产品干净还是探针坏了，无从分辨
//      （项目铁律：探针自己也要先证伪）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg',
               '.png': 'image/png', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };
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
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const finish = () => {
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[duck-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
};

/* 页内扫描：两条独立口径（数组 / 按名字） */
const SCAN = () => {
  const G = window.__garden;
  const named = [];
  G.scene.traverse(o => { if (o.isMesh && /^duck/i.test(o.name || '')) named.push(o.name); });
  return { ducks: (G.swimDucks || []).length, named: named.sort() };
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  console.log(`  · GPU: ${await page.evaluate(() => window.__garden.gpuName)}`);

  const now = await page.evaluate(SCAN);
  check('① 池中水禽已整层下线：swimDucks 为空', now.ducks === 0, `swimDucks=${now.ducks}`);
  check('① 且场景里按名字也扫不到任何 duck* 网格（换个地方建鸭子也绕不过去）',
    now.named.length === 0, now.named.length ? now.named.join(', ') : '0 个');

  /* ② 自检：注入一只假鸭子 ⇒ ① 必须报红 */
  await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const m = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshBasicMaterial());
    m.name = 'duck0';
    m.visible = false;                       // 只为让"按名字扫"命中，不污染画面
    G.scene.add(m);
    window.__fakeDuck = m;
  });
  const injected = await page.evaluate(SCAN);
  await page.evaluate(() => {
    const m = window.__fakeDuck;
    if (m && m.parent) m.parent.remove(m);
    window.__fakeDuck = null;
  });
  const cleaned = await page.evaluate(SCAN);
  check('② 自检（有牙）：注入 name="duck0" 后按名字必须扫得到 ⇒ ① 会报红',
    injected.named.includes('duck0') && cleaned.named.length === 0,
    `注入后扫到 [${injected.named.join(',')}]，移除后 ${cleaned.named.length} 个`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  await finish();
})().catch(e => { console.error('[duck-guard] 探针异常：', e); process.exit(2); });
