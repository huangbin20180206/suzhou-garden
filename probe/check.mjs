// 语法门禁：抽取 index.html 的内联 <script type="module"> 存成临时 .mjs，
// 用 node --check 做纯解析校验（不执行、不需要浏览器），一秒内出结果。
// 顺带校验 build-entry.js。npm run check。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('check: 未找到内联 module script'); process.exit(1); }

const tmp = path.join(os.tmpdir(), 'suzhou-garden-inline-check.mjs');
fs.writeFileSync(tmp, m[1]);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'build-entry.js')], { stdio: 'pipe' });
  /* ⚠️ 必须顺带 check src/*.js：内联脚本是**独立解析**的，它 import 的模块语法坏掉
     这里看不出来（--check 不解析依赖）。而拆模块的流程恰恰是"每节搬完立刻跑 check"——
     不覆盖 src 的话，这一步对一个搬残的模块完全瞎，只能等浏览器跑到才炸。 */
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort();
  for (const f of srcFiles) execFileSync(process.execPath, ['--check', path.join(ROOT, 'src', f)], { stdio: 'pipe' });
  /* ── PWA 缓存版本门禁（2026-09-23 · sw.js 纳入白名单时一并加）──
     病因（commit 77ccc60，老黄："这难道不是你程序上的 bug 吗"）：改完要刷两次才生效。
     策略已改成 代码类 network-first / 大件 cache-first，于是两条规则**分开守**：
       · `src/*.js`、`vendor.js`、`index.html` → network-first ⇒ **不需要** bump，改了即所见；
       · `assets/*.glb`、`icons/`、`docs/` → cache-first ⇒ **改了必须 bump `CACHE`**，
         否则已装 SW 的浏览器永远吃旧副本（`70ca3ab` 改过 LotusPlant.glb 却没 bump，
         那批客户端可能至今还在用旧贴图 —— 改了看不见、且不报错）。
     判据用 mtime（不依赖 git），容差 2s。 */
  {
    const swPath = path.join(ROOT, 'sw.js');
    if (!fs.existsSync(swPath)) throw new Error('sw.js 缺失（PWA 离线三件套之一）');
    execFileSync(process.execPath, ['--check', swPath], { stdio: 'pipe' });
    const swSrc = fs.readFileSync(swPath, 'utf8');
    const ver = (swSrc.match(/const CACHE = 'suzhou-garden-(v\d+)'/) || [])[1];
    if (!ver) throw new Error("sw.js 未声明 `const CACHE = 'suzhou-garden-vN'`");
    const frozen = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) if (f.endsWith('.glb')) frozen.push(path.join(ROOT, 'assets', f));
    for (const d of ['icons', 'docs']) {
      const dp = path.join(ROOT, d);
      if (fs.existsSync(dp)) for (const f of fs.readdirSync(dp)) frozen.push(path.join(dp, f));
    }
    const swM = fs.statSync(swPath).mtimeMs;
    const stale = frozen.filter(p => fs.statSync(p).mtimeMs > swM + 2000);
    if (stale.length) {
      throw new Error(`cache-first 资产比 sw.js 新，必须把 CACHE 从 ${ver} 升到 v${Number(ver.slice(1)) + 1}：\n`
        + stale.map(p => '        · ' + path.relative(ROOT, p)).join('\n')
        + '\n      否则已装 SW 的浏览器会一直吃旧副本（改了看不见，且不报错）');
    }
    console.log(`      PWA：sw.js 语法 OK · 缓存版本 ${ver} · cache-first 资产（${frozen.length} 件）未越过版本号 ✓`);
  }
  const lines = m[1].split('\n').length;
  console.log(`check: PASS（内联模块 ${lines} 行 + build-entry.js + src ${srcFiles.length} 个模块：${srcFiles.join(', ')}）`);
} catch (e) {
  console.error('check: FAIL\n' + (e.stderr || e.message));
  process.exit(1);
} finally {
  fs.rmSync(tmp, { force: true });
}
