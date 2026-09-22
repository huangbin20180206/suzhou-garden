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
  const lines = m[1].split('\n').length;
  console.log(`check: PASS（内联模块 ${lines} 行 + build-entry.js + src ${srcFiles.length} 个模块：${srcFiles.join(', ')}）`);
} catch (e) {
  console.error('check: FAIL\n' + (e.stderr || e.message));
  process.exit(1);
} finally {
  fs.rmSync(tmp, { force: true });
}
