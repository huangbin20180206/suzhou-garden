// 堂前香炉「袅袅白烟」专项门禁：node probe/censer-guard.mjs
//
// 为什么建这道门（2026-10-05）：老黄"正堂前既然加了铜炉，是不是应该有袅袅白烟"。
// 新加的视觉元素必须配门 —— 本项目反复踩过"做出来了但默认机位看不见"这一类
// （大雁 4~10px、滴水 4px、彩虹曾整条 0 像素），而这缕烟是**半透明白烟**、天生容易淡到看不见。
//
// 守什么：
//   ① 前提：香炉在登记表里（它是"烟从哪儿冒"的唯一真值源）、烟网格存在且片数 = 设计值
//   ② 位置：烟柱底的水平原点 = 香炉落点（xz 逐字相同）、高度 = 炉盖口那一档
//   ③ **真的在动**：同一个位置换两个 uTime 渲染，逐像素必须不同（否则是一片静止白斑）
//   ④ **默认机位看得见**：同任务内 uAlpha=0.40 ↔ 0 的像素差 ≥ MIN_PX
//   ⑤ 自检：同参数连渲两次必须**逐位为 0**（证明 ④ 量的是烟本身，不是场景漂移）
//
// ⚠️ 全部用"冻结帧同任务连渲"（项目铁律）：同一次 page.evaluate 里 composer.render()
//    多次，animate 只在 rAF 里推进 ⇒ 任务内场景状态完全冻结，两图之差只剩被测变量。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_PX = 15;          // 与 legibility-guard 同一条"默认机位可读"线
const N_PUFF = 14;          // 与 06-vegetation makeCenserSmoke 的 N 一致（改一处要改两处）
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.webmanifest': 'application/manifest+json', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
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
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.addStyleTag({ content: '#hud,#env,#caption,#stats,#loading{display:none !important}' });

  /* ── ① 前提 + ② 位置 ── */
  const info = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const P = await import('/src/14-props.js');
    /* 2026-10-05：香炉白烟（含 CENSER_SMOKE 句柄）已随"雾团+白烟"整块搬进 06b-atmos.js。 */
    const M = await import('/src/06b-atmos.js');
    const reg = P.PROP_REGISTRY.find(r => r.name === '香炉');
    let im = null; G.scene.traverse(o => { if (o.name === 'censerSmoke') im = o; });
    if (!reg || !im) return { reg: !!reg, im: !!im };
    return { reg: !!reg, im: !!im,
             regXZ: [reg.x, reg.z], regY: reg.y, regTop: reg.top,
             count: im.count, cap: im.instanceMatrix.count,
             origin: im.material.uniforms.uOrigin.value.toArray().map(v => +v.toFixed(4)),
             hasAlpha: !!M.CENSER_SMOKE.uAlpha, alpha: M.CENSER_SMOKE.uAlpha.value,
             aoSkip: im.userData.aoSkip === true, raycast: String(im.raycast).includes('=>') };
  });
  check('① 前提：香炉在登记表里、烟网格存在', info.reg && info.im,
    info.reg && info.im ? `香炉 (${info.regXZ.join(', ')}) · 片数 ${info.count}/${info.cap}` : '缺香炉或烟网格');
  if (!info.reg || !info.im){ await browser.close(); server.close(); process.exit(1); }
  check(`① 片数 = 设计值 ${N_PUFF}（改 N 要同步改本门）`, info.count === N_PUFF, `count=${info.count}`);
  check('② 烟柱水平原点 = 香炉落点（xz 逐字相同）',
    Math.abs(info.origin[0] - info.regXZ[0]) < 1e-6 && Math.abs(info.origin[2] - info.regXZ[1]) < 1e-6,
    `烟 (${info.origin[0]}, ${info.origin[2]}) vs 炉 (${info.regXZ[0]}, ${info.regXZ[1]})`);
  check('② 起烟口落在炉盖之上、且不高于登记 top（顶 0.92）',
    info.origin[1] > info.regY + 0.5 && info.origin[1] < info.regY + info.regTop,
    `烟口 y=${info.origin[1]}（炉底 ${info.regY} · top ${info.regTop}）`);
  check('① 已按项目规矩关掉 raycast、打了 aoSkip',
    info.hasAlpha && info.aoSkip && info.raycast, `aoSkip=${info.aoSkip} raycast=noop=${info.raycast}`);

  /* ── ③④⑤ 冻结帧同任务连渲 ── */
  const m = await page.evaluate(() => {
    const G = window.__garden;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    let im = null; G.scene.traverse(o => { if (o.name === 'censerSmoke') im = o; });
    const u = im.material.uniforms;
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, cv.width, cv.height).data; };
    const diff = (A, B) => { let n = 0;
      for (let i = 0; i < A.length; i += 4)
        if (Math.abs(A[i]-B[i]) + Math.abs(A[i+1]-B[i+1]) + Math.abs(A[i+2]-B[i+2]) > 12) n++;
      return n; };
    const A0 = u.uAlpha.value, T0 = u.uTime.value;
    /* ④ 烟 vs 无烟 */
    u.uAlpha.value = A0; const on = grab();
    u.uAlpha.value = 0;  const off = grab();
    u.uAlpha.value = A0; const on2 = grab();          // ⑤ 同参数复现值
    /* ③ 同一位置换两个 uTime：烟在动 */
    u.uTime.value = T0;        const t1 = grab();
    u.uTime.value = T0 + 2.30; const t2 = grab();
    u.uTime.value = T0; u.uAlpha.value = A0;
    return { px: diff(on, off), self: diff(on, on2), anim: diff(t1, t2), alpha: A0, t: T0 };
  });
  console.log(`  · uAlpha=${m.alpha} · uTime=${(+m.t).toFixed(2)}s（+2.30s 再看一次）`);
  check('⑤ 自检：同参数连渲两次逐位为 0（④ 量的不是场景漂移）', m.self === 0, `最大差 ${m.self}`);
  check('③ 真的在动：换 uTime 后画面必须变（不是一片静止白斑）', m.anim > 0, `差分 ${m.anim}px`);
  check(`④ 默认机位看得见（烟贡献像素 ≥ ${MIN_PX}）`, m.px >= MIN_PX, `烟↔无烟 差分 ${m.px}px`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[censer-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[censer-guard] 探针异常：', e); process.exit(2); });
