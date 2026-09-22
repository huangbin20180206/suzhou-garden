// 加载页门禁（2026-09-22 补齐 R-2）。
//   背景：加载页（水墨封面 Ken Burns + 流光条 + **由暖编译回填的真实进度条**）是 09-20 加的功能，
//         一直没有门禁。它最容易退化成两类静默缺陷：
//           · 封面 404 / 动画被媒体查询关掉 → 打开先是一片纯色，不报错；
//           · 进度条变"假动画"（CSS 匀速跑满 or 直接跳 100%）→ 看起来在走，其实与真实装配无关。
//   判据核心：**进度必须是暖编译按桶回填的**——用 MutationObserver 记录 width 与文案的完整序列，
//   要求中间态 ≥3 个、单调不减、终值 100%，且阶段名取自 WARM_STAGES 六值。
// usage: node probe/loading-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
/* 服务端记访问结果 —— 用来断言封面图**真的取到了 200**。
   "CSS 里写了 url()"不等于"图存在"：404 时浏览器只是安静地不画，页面照样启动。 */
const served = [];
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    served.push({ url: p, status: err ? 404 : 200 });
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra) => { results.push({ label, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };

/* 与 11-loop.js 的 WARM_STAGES 成对出现：阶段名变了必须同步改这里，否则这条判据形同虚设 */
const WARM_STAGES = ['立屋架', '铺黛瓦', '叠山石', '引池水', '植花竹', '起烟云'];

/* 在**页面脚本之前**挂观察器：加载页的进度是"设一次宽度 → 等两帧 → 冻主线程",
   靠探针侧轮询必然错过中间态（主线程被冻时 evaluate 排不上队）。
   MutationObserver 在变更发生的当下就记下来，之后回读序列 —— 这是唯一可靠的取法。 */
const INIT = () => {
  window.__ldLog = { w: [], txt: [], attrs: [] };
  window.__ldAttachOk = false;
  const attach = () => {
    const ld = document.getElementById('loading');
    const prog = ld && ld.querySelector('.ld-prog'), txt = ld && ld.querySelector('.ld-text');
    if (!prog || !txt) return false;
    const pushW = () => {
      const v = prog.style.width || '';
      const L = window.__ldLog.w;
      if (v && L[L.length - 1] !== v) L.push(v);
    };
    const pushT = () => {
      const v = txt.textContent || '';
      const L = window.__ldLog.txt;
      if (v && L[L.length - 1] !== v) L.push(v);
    };
    pushW(); pushT();
    new MutationObserver(pushW).observe(prog, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(pushT).observe(txt, { childList: true, characterData: true, subtree: true });
    window.__ldAttachOk = true;
    return true;
  };
  if (!attach()){ const iv = setInterval(() => { if (attach()) clearInterval(iv); }, 20); }
};

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
  await page.addInitScript(INIT);

  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });

  /* ① 结构：加载层该有的都在（等它存在，别在解析中就断言） */
  const struct = await page.waitForFunction(() => {
    const ld = document.getElementById('loading');
    if (!ld) return null;
    const q = s => !!ld.querySelector(s);
    return { attached: window.__ldAttachOk, bg: q('.ld-bg'), wash: q('.ld-wash'),
             title: q('.ld-title'), kicker: q('.ld-kicker'), bar: q('.ld-bar'),
             prog: q('.ld-prog'), text: q('.ld-text'),
             reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
  }, { timeout: 30000, polling: 100 }).then(h => h.jsonValue()).catch(() => null);
  /* ⚠️ 只报"该有却没有的"结构项：struct 里还带着 reduced / attached 这类**布尔状态**，
     把它们一起当"缺失项"打印会写出"✓ 结构完整 — reduced"这种自相矛盾的行。 */
  const NEED = ['bg', 'wash', 'title', 'kicker', 'bar', 'prog', 'text'];
  const missing = struct ? NEED.filter(k => !struct[k]) : NEED;
  check('加载层结构完整（封面/水墨罩/标题/进度条/文案）', missing.length === 0,
    missing.length ? `缺：${missing.join(',')}` : '7 项齐全');
  check('概率观察器已挂上（否则进度序列取不到）', !!struct && struct.attached === true);
  check('未处于 prefers-reduced-motion（该模式下动画被关，门禁会假红）',
    !!struct && struct.reduced === false, struct ? `reduce=${struct.reduced}` : '');

  /* ② 封面图真的取到了 200 —— 防"CSS 写了 url()、文件 404、页面安静地一片纯色" */
  const cover = served.find(s => s.url.endsWith('cover.jpg'));
  check('封面图 docs/cover.jpg 被请求且 200', !!cover && cover.status === 200,
    cover ? `status=${cover.status}` : '压根没请求（CSS 没引用？）');

  /* ③ 两条 CSS 动画确实声明了（Ken Burns 慢推 / 流光条循环） */
  const anim = await page.evaluate(() => {
    const cs = s => { const el = document.querySelector(s); return el ? getComputedStyle(el) : null; };
    const bg = cs('#loading .ld-bg'), i = cs('#loading .ld-bar i');
    return { bgName: bg && bg.animationName, bgDur: bg && bg.animationDuration,
             barName: i && i.animationName, barIter: i && i.animationIterationCount,
             barDur: i && i.animationDuration };
  });
  /* ⚠️ `.ld-bg` 上挂着**两条**动画（ldBgIn 淡入 + ldKen 慢推），computed style 的
     animationName / animationDuration 是**逗号分隔的列表**，必须按下标一一配对取时长 ——
     直接 parseFloat 只会拿到第一条（1.1s）从而假红。 */
  const pairs = (names, durs) => (names || '').split(',').map((n, i) => ({
    name: n.trim(), dur: parseFloat((durs || '').split(',')[i] || 'NaN') }));
  const bgAnims = pairs(anim.bgName, anim.bgDur);
  const ken = bgAnims.find(a => a.name === 'ldKen');
  check('Ken Burns 已声明且是慢推（ldKen，≥5s）',
    !!ken && ken.dur >= 5, `ldKen dur=${ken ? ken.dur + 's' : '缺失'}（全表：${bgAnims.map(a => a.name + ' ' + a.dur + 's').join(' / ')}）`);
  check('流光条已声明且无限循环（ldBar，infinite）',
    /ldBar/.test(anim.barName || '') && /infinite/.test(anim.barIter || ''),
    `name=${anim.barName} iter=${anim.barIter} dur=${anim.barDur}`);

  /* ④ 收尾：等 loading 收起，再回读整个进度序列 */
  const done = await page.waitForFunction(
    () => document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 200 }).then(() => true).catch(() => false);
  check('首帧后加载层收起（加 .done）', done);
  const log = await page.evaluate(() => window.__ldLog);
  await sleep(1000);
  const after = await page.evaluate(() => {
    const ld = document.getElementById('loading'), cs = getComputedStyle(ld);
    return { pe: cs.pointerEvents, opacity: parseFloat(cs.opacity) };
  });
  check('收起后 pointer-events:none（不再吃掉真实点击）', after.pe === 'none', `pointer-events=${after.pe}`);
  check('收起后已淡出（opacity < 0.5）', after.opacity < 0.5, `opacity=${after.opacity}`);

  /* ⑤ 进度条必须是"真实回填"，不是假动画 —— 这是本门最核心的一条 */
  const widths = (log.w || []).map(v => parseFloat(v)).filter(v => !Number.isNaN(v));
  const uniq = [...new Set(widths)];
  check('进度条出现中间态（≥3 个不同宽度）—— 只有 0 与 100 两个值即假进度',
    uniq.length >= 3, `观测到 ${uniq.length} 个不同宽度：${uniq.join(', ')}`);
  check('进度条单调不减（不许来回跳）',
    widths.every((v, i) => i === 0 || v >= widths[i - 1]), widths.join(' → '));
  check('进度条终值 = 100%', widths.length > 0 && widths[widths.length - 1] === 100,
    `终值=${widths[widths.length - 1]}`);
  check('存在"未满"的中间态（不是一步跳满）',
    widths.some(v => v > 0 && v < 100), `中间态=${widths.filter(v => v > 0 && v < 100).join(',') || '无'}`);
  /* 上界：暖编译只有 10 个桶 + 彩排帧 → setWarmUI 至多 11 次。
     若宽度被"逐帧刷"，说明进度条退化成了按帧跑的假动画（真实装配与之无关）。 */
  check('更新次数符合暖编译桶数（≤14，不是逐帧刷）', widths.length <= 14, `更新 ${widths.length} 次`);

  /* ⑥ 文案：阶段名必须来自 WARM_STAGES，收尾必须换成"即将开园" */
  const txts = log.txt || [];
  const stageHits = txts.map(t => (/营 造 中 · (\S+) (\d+)%/.exec(t) || [])[1]).filter(Boolean);
  const badStage = stageHits.filter(s => !WARM_STAGES.includes(s));
  check('进度文案带暖编译阶段名（营 造 中 · <阶段> <pct>%）', stageHits.length >= 2,
    `命中 ${stageHits.length} 次：${[...new Set(stageHits)].join('/') || '无'}`);
  check('阶段名只取自 WARM_STAGES 六值（没有编造的阶段）', badStage.length === 0,
    badStage.length ? `非法阶段：${badStage.join(',')}` : `观测到 ${[...new Set(stageHits)].join('/')}`);
  check('收尾文案换成「即 将 开 园」', txts.includes('即 将 开 园'),
    `末条文案=「${txts[txts.length - 1] || ''}」`);

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[加载页] ${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[loading-guard] 崩溃:', e); process.exit(2); });
