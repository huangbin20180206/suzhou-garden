// 明信片门禁：node probe/postcard-guard.mjs
//
// 明信片是本项目唯一「用户能带走的成品」，它的排版（装裱框 / 竖排题款 / 朱文印）
// 一旦静默失效，没有任何别的门禁会发现 —— smoke 只断言"能生成含题跋的 PNG"。
//
// 判据选择上的取舍（⚠️ 判据必须对被测对象特异）：
//   · **印章用朱砂红像素数** —— 强判据。但必须在**夏季正午**测：秋叶/红枫同样落在
//     朱砂色域里，会把"没有印章"判成"有印章"。故开头先切到夏 + 午。
//   · **题款只做报告、不做判定** —— 画面里的白墙/天空同样是"高亮低饱和"，
//     拿它当硬判据会得到一个永远为真、因此毫无价值的断言。要验题款请看样张。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';
import { decodePNG } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'postcard-guard');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 朱砂红统计：#B23A2E = (178,58,46)。收紧到 (R>150, R-G>70, R-B>70, G<110, B<110)。 */
function sealStats(img) {
  const { w, bpp, data } = img;
  let n = 0, sx = 0;
  for (let i = 0; i < data.length; i += bpp) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 150 && r - g > 70 && r - b > 70 && g < 110 && b < 110) { n++; sx += ((i / bpp) % w); }
  }
  return { n, cx: n ? sx / n : -1 };
}
/* 高亮低饱和像素（题款/文字）。仅用于报告，不作判定 —— 白墙与天空同样满足。 */
function brightCount(img, fx0, fx1, fy0, fy1) {
  const { w, h, bpp, data } = img;
  const x0 = Math.floor(w * fx0), x1 = Math.floor(w * fx1);
  const y0 = Math.floor(h * fy0), y1 = Math.floor(h * fy1);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * bpp;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 200 && mx - mn < 40) n++;
    }
  }
  return n;
}

(async () => {
  const t0 = Date.now();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[postcard-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(1200);

  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 40000, polling: 200 }).then(() => true).catch(() => false);

  /* ⚠️ 必须在夏季正午测：秋叶/红枫也落在朱砂色域里，会让"无印章"被判成"有印章" */
  await page.evaluate(() => {
    window.__garden.setEnv('season', 'summer');
    window.__garden.setEnv('time', 'noon');
    window.__garden.setEnv('weather', 'clear');
  });
  await settled(); await sleep(600);

  const canvasSize = await page.evaluate(() => {
    const c = window.__garden.renderer.domElement;
    return { w: c.width, h: c.height };
  });

  const url = await page.evaluate(() => window.__garden.postcardData());
  check('明信片可生成（dataURL 为 PNG）',
    typeof url === 'string' && url.startsWith('data:image/png;base64,'), `${(url || '').slice(0, 24)}…`);
  check('明信片体积合理（真的画了东西）', url.length > 50000, `${Math.round(url.length / 1024)} KB`);

  const buf = Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, 'postcard-summer-noon.png'), buf);
  const img = decodePNG(buf);
  check('明信片尺寸 = 渲染画布尺寸', img.w === canvasSize.w && img.h === canvasSize.h,
    `${img.w}×${img.h} vs 画布 ${canvasSize.w}×${canvasSize.h}`);

  const seal = sealStats(img);
  check('钤有朱文印（朱砂红像素成片）', seal.n > 100, `朱砂红像素 ${seal.n} 个`);
  check('印章落在右侧题款之下（不是画面里的红叶）', seal.cx > img.w * 0.6,
    `朱砂重心 x=${Math.round(seal.cx)} / 宽 ${img.w}`);

  const titleBright = brightCount(img, 0.84, 0.99, 0.04, 0.40);
  console.log(`  ▸ [报告·不计入判定] 右侧题款区高亮像素 ${titleBright}（白墙/天空同样满足，故不作断言）`);

  /* ── 其它环境组合下不崩（明信片走的是 Canvas 2D，季节/天气只影响字符）── */
  const combos = [
    { season: 'winter', time: 'night', weather: 'snow', tag: '冬夜雪' },
    { season: 'autumn', time: 'dusk', weather: 'mist', tag: '秋暮雾' },
    { season: 'spring', time: 'morning', weather: 'storm', tag: '春雨暴' },
  ];
  const bad = [];
  for (const c of combos) {
    await page.evaluate(o => {
      window.__garden.setEnv('season', o.season);
      window.__garden.setEnv('time', o.time);
      window.__garden.setEnv('weather', o.weather);
    }, c);
    await settled();
    const u = await page.evaluate(() => window.__garden.postcardData());
    if (!u || !u.startsWith('data:image/png;base64,')) { bad.push(c.tag); continue; }
    const b2 = Buffer.from(u.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, `postcard-${c.tag}.png`), b2);
    if (sealStats(decodePNG(b2)).n < 100) bad.push(`${c.tag}(无印)`);
  }
  check('各季节/时段/天气组合下都能出片且钤印', bad.length === 0,
    bad.length ? `异常：${bad.join('、')}` : `${combos.map(c => c.tag).join(' / ')} 全部通过`);

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n[postcard-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[postcard-guard] 崩溃:', e); process.exit(2); });
