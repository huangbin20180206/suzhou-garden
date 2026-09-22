/* 只读诊断（**不入链**，2026-09-20）：首帧那 6 秒 = 63 个 shader program 的编译。
 *
 * 为什么写它：A 项的病灶已经量清楚（启动 6996ms 里有 6109ms 全在"首帧"那一次 render，
 * 即 program 编译），且试过的最省事的解法（compileAsync 提前编）实测**负优化**
 * （program 63→101、启动 6996→8784ms，见 11-loop.js 顶部那段注释）。
 * 剩下真正能缩短它的只有两条路：
 *   ① 减少 program **数量**（63 个）  ② 降低单个 shader 的复杂度
 * 两条都得先知道"**这 63 个是怎么分裂出来的**"——否则只能瞎合并材质。
 *
 * 做法：Three 把参与编译的参数拼成一个字符串当 program 的 cacheKey
 * （`getProgramCacheKey`：shaderID + precision + outputColorSpace + 一排能力布尔 + defines
 *  + customProgramCacheKey）。本脚本把它按 token 拆开，对同一类 shader 的 program
 * **逐 token 统计出现频次** —— 出现次数少于总数的 token 就是"分裂来源"
 * （例：只有 16 个带 `uv`、只有 3 个带 `vertexColors`），一眼看出该统一哪一项。
 *
 * ⚠️ 全程只读：不碰材质、不碰 onBeforeCompile（那会改掉默认 cacheKey，见 §29.4）。
 * 用法: node probe/_program-audit.mjs
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
  /* 等延迟批也挂完：柳/竹/立峰的材质会新增 program，早读会漏 */
  await page.waitForFunction(() => {
    let has = false;
    window.__garden.scene.traverse(o => { if (o.isMesh && o.name === 'stele') has = true; });
    return has;
  }, { timeout: 180000, polling: 400 });
  await sleep(2500);

  const out = await page.evaluate(() => {
    const G = window.__garden;
    const progs = (G.renderer.info.programs || []).map(p => ({
      name: p.name || '(无名)', used: p.usedTimes || 0, key: String(p.cacheKey || ''),
    }));
    /* 按 shader 名分组（physical / basic / depth / OutputShader / GLB 的 model.* …） */
    const groups = new Map();
    for (const p of progs){
      if (!groups.has(p.name)) groups.set(p.name, []);
      groups.get(p.name).push(p);
    }
    const report = [];
    for (const [name, list] of groups){
      const freq = new Map();
      let maxFields = 0;
      for (const p of list){
        const toks = p.key.split(',');
        maxFields = Math.max(maxFields, toks.length);
        for (const t of new Set(toks)) freq.set(t, (freq.get(t) || 0) + 1);
      }
      /* 出现次数 < 总数 的 token = 制造分裂的那一项 */
      const rare = [...freq.entries()].filter(([, n]) => n < list.length)
        .sort((a, b) => b[1] - a[1]).slice(0, 16)
        .map(([t, n]) => ({ t, n }));
      const shared = [...freq.entries()].filter(([, n]) => n === list.length).map(([t]) => t);
      report.push({ name, count: list.length,
                    usedSum: list.reduce((a, p) => a + p.used, 0),
                    maxFields, rare, sharedSample: shared.slice(0, 5),
                    sample: list[0].key.slice(0, 200) });
    }
    /* 场景在用的材质一共映射到多少个不同 program（共享度） */
    const seen = new Set(), matN = { total: 0, withProg: 0 };
    const progIds = new Set();
    G.scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])){
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid); matN.total++;
        let cur = null;
        try { const pr = G.renderer.properties.get(m); cur = pr && pr.currentProgram; } catch (e) { }
        if (cur){ matN.withProg++; progIds.add(cur.id); }
      }
    });
    return { total: progs.length, report, matN, distinctProg: progIds.size };
  });

  console.log(`\n════ program 分裂分析（首帧那 6 秒的来源）════`);
  console.log(`  编译过的 program 共 ${out.total} 个`);
  console.log(`  场景在用材质 ${out.matN.total} 种（其中已编译 ${out.matN.withProg}），`
            + `映射到 ${out.distinctProg} 个不同 program\n`);

  for (const g of out.report.sort((a, b) => b.count - a.count)){
    console.log(`── ${g.name}：${g.count} 个 program（被用 ${g.usedSum} 次，cacheKey 最多 ${g.maxFields} 字段）`);
    if (!g.rare.length){
      console.log(`   · 全部参数一致 —— 这 ${g.count} 个的差异只在 customProgramCacheKey（注入后缀）\n`);
      continue;
    }
    console.log(`   **制造分裂的字段**（出现次数 < ${g.count} 的都列出来）：`);
    for (const r of g.rare)
      console.log(`      ×${String(r.n).padStart(3)}  ${r.t || '(空)'}`);
    console.log(`   所有 program 共有的字段（前 5）：${g.sharedSample.join(' , ') || '(无)'}\n`);
  }

  console.log('  [怎么用] 分裂字段里出现 `uv` / `vertexColors` / `USE_INSTANCING` / `map` 这类');
  console.log('  能力开关时，"让同一族的材质统一带上同一组能力"就能把 program 数压下来 ——');
  console.log('  代价是每个 program 更重（多一次贴图采样等），必须量完再决定。');
  console.log('  [读法] 若某类只有 1 个 program 却 used=1，那是纯粹的"一次性变体"，最该合并。');

  await browser.close();
  server.close();
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
