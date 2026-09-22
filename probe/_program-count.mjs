/* 只读诊断（**不入链**，2026-09-20）：A 项——首帧那 6 秒到底是谁编的。
 *
 * 背景：A 项的病灶是"启动 6996ms 里 6109ms 全在首帧那一次 render"，也就是 program 编译。
 * 已经排除的路：
 *   ① `renderer.compileAsync` 提前编 —— 实测**负优化**（program 63→101、启动→8784ms），
 *      因为它在"调用时刻的渲染状态"下编，与首帧真正的宏组合对不上 → 白编一遍。见 11-loop.js 注释。
 *   ② 折射 pass 单独一份 —— `?refract=0` 实测只差 3 个 program，不是大头。
 *
 * 那么 63 个到底是怎么来的？本脚本按 **usedTimes** 把它们切成两堆：
 *   - usedTimes > 0：当前真的绑在场景材质上（= 画面需要的）
 *   - usedTimes = 0：**孤儿** —— 编过、但此刻没有任何材质在用（建构期临时材质、
 *     被替换掉的旧材质、只在某一帧存在的中间材质…）。孤儿是纯浪费：它们占了编译时间，
 *     却没参与画面。
 * 再把两堆按 shader 名分组，看孤儿集中在哪一类 —— 这决定"该去删谁的材质"。
 *
 * ⚠️ 全程只读：不碰材质、不碰 onBeforeCompile（那会改默认 cacheKey，见 §29.4）。
 * 用法: node probe/_program-count.mjs
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
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.setDefaultTimeout(180000);

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  /* 等延迟批挂完（柳/竹/立峰会新增材质 → 新增 program，早读会漏） */
  await page.waitForFunction(() => {
    let has = false;
    window.__garden.scene.traverse(o => { if (o.isMesh && o.name === 'stele') has = true; });
    return has;
  }, { timeout: 180000, polling: 400 });
  await sleep(2500);

  const out = await page.evaluate(() => {
    const G = window.__garden;
    const progs = G.renderer.info.programs || [];
    const live = [], orphan = [];
    for (const p of progs){
      const rec = { name: p.name || '(无名)', used: p.usedTimes || 0,
                    key: String(p.cacheKey || ''), frag: p.fragmentShader ? true : false };
      (rec.used > 0 ? live : orphan).push(rec);
    }
    const hist = arr => {
      const m = new Map();
      for (const r of arr) m.set(r.name, (m.get(r.name) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    /* 场景材质 → 不同 program 数（共享度），以及材质侧的"一个材质一个 program"程度 */
    const seen = new Set(), progIds = new Set(); let matN = 0;
    const matProg = new Map();   // programId → 材质数
    G.scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])){
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid); matN++;
        try {
          const pr = G.renderer.properties.get(m);
          const cp = pr && pr.currentProgram;
          if (cp){ progIds.add(cp.id); matProg.set(cp.id, (matProg.get(cp.id) || 0) + 1); }
        } catch (e){ }
      }
    });
    const share = [...matProg.values()].sort((a, b) => b - a);
    return {
      total: progs.length,
      liveN: live.length, orphanN: orphan.length,
      liveHist: hist(live), orphanHist: hist(orphan),
      orphanSample: orphan.slice(0, 12).map(r => ({ name: r.name, used: r.used, key: r.key.slice(0, 90) })),
      matN, distinctProg: progIds.size,
      shareTop: share.slice(0, 8), shareOne: share.filter(n => n === 1).length,
      boot: (G.BOOT && G.BOOT.marks) ? G.BOOT.marks.slice(-6) : null,
    };
  });

  console.log('\n════ program 数归因（A 项：首帧 6 秒是谁编的）════');
  console.log(`  编译过的 program 共 ${out.total} 个`);
  console.log(`    ├─ 真在用（usedTimes>0） ${out.liveN} 个`);
  console.log(`    └─ **孤儿（usedTimes=0）** ${out.orphanN} 个  ← 编了却不参与画面`);
  console.log(`  场景在用的材质 ${out.matN} 种 → 映射到 ${out.distinctProg} 个 program`);
  console.log(`    （其中只被 1 个材质用到的 program：${out.shareOne} 个）`);
  console.log(`  共享最广的几个 program 各带多少材质：${out.shareTop.join(' , ')}\n`);

  console.log('  ── 真在用的按 shader 名分组：');
  for (const [n, c] of out.liveHist) console.log(`     ${String(c).padStart(3)}  ${n}`);
  console.log('  ── 孤儿按 shader 名分组：');
  if (!out.orphanHist.length) console.log('     （没有孤儿）');
  for (const [n, c] of out.orphanHist) console.log(`     ${String(c).padStart(3)}  ${n}`);
  if (out.orphanSample.length){
    console.log('  ── 孤儿样例（key 前 90 字符）：');
    for (const r of out.orphanSample) console.log(`     [${r.name}] ${r.key}`);
  }
  if (out.boot) console.log(`\n  启动打点（末 6 条）：${out.boot.map(m => `${m[0]} ${m[1]}ms`).join(' | ')}`);

  console.log('\n  [读法] 孤儿数 = 纯浪费的编译份额。孤儿集中在 GLB 的 model.* 或 OutputShader');
  console.log('  → 是"建构期临时材质没回收 / 后处理换过一遍"；集中在 (无名) 且量大 → 多半是');
  console.log('  "同一族材质因能力开关不同而分裂"，那才轮到合并材质（代价是每个 program 更重）。');

  await browser.close();
  server.close();
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
