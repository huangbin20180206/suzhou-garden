// 偶得（随机景色）门禁（2026-09-22 补齐 R-5）。
//   背景：按 X / 点「偶得✦」随机抽一幅景色（时段加权 · 季节均匀 · 天气先按季节过滤合法集）。
//         这个功能的失效方式全是静默的：
//           · 抽到非法组合（如夏季抽到"银装素裹"）→ enforceWeather 悄悄降级，**标签与实际天气不符**；
//           · 标签读的是 ENV.cur（上一帧画面）而不是本次结果 → "抽 A 报 B"（连发两次必现）；
//           · 权重写反 → 正午（最不出片）反而最常抽到，功能意义整个反过来，却没有任何报错。
//   判据核心：**三轴合法性**（weatherMutexReason 必须为空）+ **标签必须跟着三轴变**。
// usage: node probe/random-guard.mjs
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
const check = (label, ok, extra) => { results.push({ label, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };

const N = 600;                 // 样本量：比例类判据（夜间天气偏置）要压到 ~6σ，120 抽只够 ~2σ，会偶发假红
const TIMES = ['morning', 'noon', 'dusk', 'night'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const WEATHERS = ['clear', 'storm', 'overcast', 'snow', 'mist'];

(async () => {
  const port = await listenEphemeral(server);
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
  await sleep(1200);

  /* 一次性抽 N 次并回读：抽的动作在页面里跑完再整体回传（逐次往返太慢） */
  const data = await page.evaluate((n) => {
    const g = window.__garden;
    const before = { time: g.ENV.time, season: g.ENV.season, weather: g.ENV.weather, hour: g.ENV.hour };
    const rows = [];
    for (let i = 0; i < n; i++){
      const r = g.randomScene();
      rows.push({ ...r,
        /* 逐次回读"这一抽是否合法"——按 (天气, 季节) 查互斥原因，非空即非法组合 */
        mutex: g.weatherMutexReason(r.weather, r.season),
        anchors: g.TIME_ANCHORS });
    }
    return { rows, before };
  }, N);

  const rows = data.rows;
  check(`抽取 ${N} 次全部返回完整结构（time/season/weather/hour/label）`,
    rows.every(r => TIMES.includes(r.time) && SEASONS.includes(r.season)
                 && WEATHERS.includes(r.weather) && typeof r.hour === 'number' && typeof r.label === 'string'),
    `首例=${JSON.stringify({ time: rows[0].time, season: rows[0].season, weather: rows[0].weather })}`);

  /* ① 合法性 —— 本门最核心。非法组合会被 enforceWeather 静默降级，标签与实际不符 */
  const illegal = rows.filter(r => r.mutex);
  check('三轴组合全部合法（weatherMutexReason 为空）—— 非法即静默降级穿帮',
    illegal.length === 0, illegal.length ? `非法 ${illegal.length} 例，如 ${illegal[0].season}+${illegal[0].weather}: ${illegal[0].mutex}` : '全部合法');
  const snowOut = rows.filter(r => r.weather === 'snow' && r.season !== 'winter');
  check('非冬季绝不出现「银装素裹」（样本级复核）', snowOut.length === 0,
    snowOut.length ? `${snowOut.length} 例：${[...new Set(snowOut.map(r => r.season))].join('/')}` : '0 例');

  /* ② 时辰抖动：必须落在所选时段的锚点 ±0.6h 内 */
  const anchor = r => r.anchors[r.time];
  const off = rows.map(r => Math.abs(r.hour - anchor(r)));
  check('时辰落在所选时段锚点 ±0.6h 内', Math.max(...off) <= 0.6 + 1e-6,
    `最大偏移=${Math.max(...off).toFixed(3)}h`);
  const perTime = {};
  for (const r of rows){ (perTime[r.time] = perTime[r.time] || new Set()).add(r.hour.toFixed(3)); }
  check('锚点 ±0.6h 抖动确实在生效（同时段出现过多个不同时辰）',
    TIMES.every(t => !perTime[t] || perTime[t].size >= 2),
    TIMES.map(t => `${t}:${perTime[t] ? perTime[t].size : 0}种`).join(' '));

  /* ③ 标签必须跟着本次三轴变 —— 抓"标签读 ENV.cur（上一帧画面）→ 抽 A 报 B" */
  const key = r => `${r.season}|${r.time}|${r.weather}`;
  const stale = [];
  for (let i = 1; i < rows.length; i++){
    if (key(rows[i]) !== key(rows[i - 1]) && rows[i].label === rows[i - 1].label)
      stale.push(`${rows[i - 1].label} 连报两次（第 ${i}/${i + 1} 抽）`);
  }
  check('相邻两抽三轴不同则标签必不同（防"抽 A 报 B"）', stale.length === 0,
    stale.length ? stale[0] : '0 例');
  check('标签是三段式（季节 · 时段 · 天气）',
    rows.every(r => r.label.split(' · ').length === 3), `样例=「${rows[0].label}」`);

  /* ④ 去重：与上一次三轴完全相同的连抽必须被重试掉 */
  const same = rows.slice(1).filter((r, i) => key(r) === key(rows[i])).length;
  check('相邻两抽三轴不重复（重抽逻辑在生效）', same / rows.length <= 0.1,
    `${same}/${rows.length} 例重复`);

  /* ⑤ 覆盖度与加权方向：时段按出片率加权（暮/夜 4 > 晨 2.5 > 正午 1），季节均匀 */
  const cnt = (f) => rows.filter(f).length;
  const bySeason = Object.fromEntries(SEASONS.map(s => [s, cnt(r => r.season === s)]));
  const byTime = Object.fromEntries(TIMES.map(t => [t, cnt(r => r.time === t)]));
  check('四季都抽得到（季节均匀，无漏档）', SEASONS.every(s => bySeason[s] > 0), JSON.stringify(bySeason));
  check('四时段都抽得到', TIMES.every(t => byTime[t] > 0), JSON.stringify(byTime));
  check('时段加权方向正确：暮 / 夜 明显多于正午（正午最不出片）',
    Math.min(byTime.dusk, byTime.night) > byTime.noon,
    `dusk=${byTime.dusk} night=${byTime.night} morning=${byTime.morning} noon=${byTime.noon}`);

  /* ⑥ 夜间的天气偏置：⚠️ 代码里 `nightish` 只认 `time === 'night'`，**dusk 不参与**加权 ——
     所以对比也必须只取 night。把 dusk 混进"夜"会把差异稀释成 68% vs 69% 的假红。
     设计期望：night ≈80%、morning+noon ≈62%（snow 只在冬季入池）。 */
  const share = (rs) => rs.length ? rs.filter(r => r.weather === 'clear' || r.weather === 'mist').length / rs.length : NaN;
  const nightRows = rows.filter(r => r.time === 'night');
  const dayRows = rows.filter(r => r.time === 'morning' || r.time === 'noon');
  const nightShare = share(nightRows), dayShare = share(dayRows);
  check('夜里的晴与薄雾占比高于白天（保月亮与萤火；dusk 不参与加权故不计入）',
    nightShare > dayShare,
    `夜=${(nightShare * 100).toFixed(1)}%（n=${nightRows.length}）` +
    ` 晨+午=${(dayShare * 100).toFixed(1)}%（n=${dayRows.length}）`);

  /* ⑦ 抽完不留污染：环境应停在最后一次结果上，且 setEnv 仍能正常接管 */
  const after = await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('season', 'winter'); g.setEnv('weather', 'snow');
    return { season: g.ENV.season, weather: g.ENV.weather };
  });
  check('抽完后 setEnv 仍能正常接管（随机不锁死环境）',
    after.season === 'winter' && after.weather === 'snow', JSON.stringify(after));

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[偶得] ${results.length - failed.length}/${results.length} 项通过（样本 ${N} 抽）`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[random-guard] 崩溃:', e); process.exit(2); });
