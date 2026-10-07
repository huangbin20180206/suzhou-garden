// 按钮图标门禁：node probe/panel-icons-guard.mjs
//
// 守老黄 2026-10-07 那条："按钮图标做成彩色的"。
// 图标是 12-env 的 ICON 表打上的 `data-ic` + CSS `::before{content:attr(data-ic)}`，
// 颜色在 index.html 里"按语义键逐条给"。这条门禁只验**样式层**（快、无像素）：
//   ① 图标覆盖：带 data-ic 的按钮数够（缺口只允许时段条那 4 个刻度标签）；
//   ② 真的上色了：::before 的计算色**不等于**按钮文字色（不是"继承来的墨色"）；
//   ③ 是**成套**配色而不是一种色刷到底：出现的颜色种类 ≥12；
//   ④ 选中态（.on）在深木褐底上要**提亮**（filter brightness > 1）；
//   ⑤ 禁用态（如冬季的「狂风暴雨」）要**去色压暗**（grayscale + 低不透明度）；
//   ⑥ 字形仍然只在 ::before 里 —— 按钮 textContent 里不许出现任何 data-ic 字形
//      （各探针按文字找按钮，字形混进文字会一起改口径）。
//
// ⚠️ ④⑤ 是**样式层**验证（页内临时加 .on / disabled 读计算样式再还原）：CSS 对
//    :disabled / .on 的响应与谁设的这两个状态无关，所以这样验是充分的；
//    真实状态路径（冬季禁用狂风暴雨、选中高亮）另有 pageerror-guard / smoke 覆盖。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  console.log(`\n[panel-icons-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });
  await sleep(1200);

  const st = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#env button[data-ic]')];
    const rows = btns.map(b => {
      const cs = getComputedStyle(b, '::before');
      const glyph = b.dataset.ic || '';
      const key = [b.dataset.axis && `${b.dataset.axis}:${b.dataset.v}`, b.dataset.act && `act:${b.dataset.act}`,
                   b.dataset.view && `view:${b.dataset.view}`, b.dataset.quality && `quality:${b.dataset.quality}`]
                  .filter(Boolean).join('');
      return { key, glyph, icColor: cs.color, textColor: getComputedStyle(b).color,
               content: cs.content, text: b.textContent.trim(), disabled: b.disabled };
    });
    const all = [...document.querySelectorAll('#env button')];
    return {
      iconButtons: rows.length, totalButtons: all.length, rows,
      glyphInText: all.filter(b => b.dataset.ic && b.textContent.includes(b.dataset.ic)).map(b => b.textContent.trim()),
      noIcon: all.filter(b => !b.dataset.ic).map(b => b.textContent.trim()),
      distinct: [...new Set(rows.map(r => r.icColor))],
    };
  });

  check('图标覆盖：带 data-ic 的按钮 ≥26（缺口只允许时段条的 4 个刻度标签）',
    st.iconButtons >= 26, `${st.iconButtons}/${st.totalButtons} 有图标；没图标的：${st.noIcon.join(' ') || '无'}`);
  const colored = st.rows.filter(r => r.icColor !== r.textColor);
  check('真的上色了：::before 计算色 ≠ 按钮文字色（≥90% 的图标按钮）',
    colored.length >= Math.ceil(st.iconButtons * 0.9), `${colored.length}/${st.iconButtons} 上了色`);
  check('成套配色：出现 ≥12 种不同颜色（不是一种色刷到底）',
    st.distinct.length >= 12, `${st.distinct.length} 种：${st.distinct.slice(0, 8).join(' ')} …`);
  check('字形只在 ::before 里（按钮 textContent 不含任何 data-ic 字形）',
    st.glyphInText.length === 0, st.glyphInText.join(' | ') || '无');

  const state = await page.evaluate(() => {
    const b = document.querySelector('#env button[data-ic]');
    const read = () => { const cs = getComputedStyle(b, '::before');
      return { filter: cs.filter, opacity: +cs.opacity }; };
    const base = read();
    b.classList.add('on'); const on = read(); b.classList.remove('on');
    const b2 = document.querySelector('#env button[data-act="festival"]') || b;
    const read2 = () => { const cs = getComputedStyle(b2, '::before'); return { filter: cs.filter, opacity: +cs.opacity }; };
    const before = read2();
    b2.setAttribute('disabled', ''); const dis = read2(); b2.removeAttribute('disabled');
    return { base, on, before, dis, sampleKey: b.dataset.ic };
  });
  check('选中态图标提亮（filter 里有 brightness > 1）',
    /brightness\(1\.[0-9]+\)/.test(state.on.filter) && parseFloat(state.on.filter.match(/brightness\(([\d.]+)\)/)[1]) > 1,
    `选中 ${state.on.filter}｜常态 ${state.base.filter}`);
  check('禁用态图标去色压暗（grayscale 且不透明度 <0.5）',
    /grayscale/.test(state.dis.filter) && state.dis.opacity < 0.5,
    `禁用 ${state.dis.filter} · opacity=${state.dis.opacity}｜常态 opacity=${state.before.opacity}`);

  /* 留档图（失败不影响判据：本机重场景下截图偶发超时，见 mobile-panel-guard 的注记） */
  fs.mkdirSync('outputs/_diag/panel-icons', { recursive: true });
  await page.evaluate(() => { const e = document.getElementById('env');
    if (!e.classList.contains('expanded')) e.querySelector('.drawer-toggle').click(); });
  await sleep(900);
  await page.screenshot({ path: 'outputs/_diag/panel-icons/panel-icons.png', timeout: 60000 })
    .then(() => console.log('  留档图：outputs/_diag/panel-icons/panel-icons.png'))
    .catch(e => console.log('  (留档图跳过：' + String(e).slice(0, 60) + ')'));

  if (errs.length) check('零 pageerror', false, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();                                    // ⚠️ 必须关：否则全绿也不退出
  const failed = results.filter(r => !r.ok);
  console.log(`\n[panel-icons-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  if (failed.length){ console.log('失败项：'); failed.forEach(f => console.log('  · ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[panel-icons-guard] 崩溃:', e); process.exit(2); });
