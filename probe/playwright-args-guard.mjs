// playwright-args-guard：抓 page.evaluate 实参个数超限的误用（纯静态，零浏览器零 GPU，毫秒级）
//
// ── 为什么要有这道门（2026-10-13 云端 smoke 崩溃真因）────────────────────
//   run 38332013849 的 smoke 只跑 4m22s 就 failure（预算 40min，远未到上限）
//   ⇒ 不是某项断言判红，是**探针自己崩了**。崩在：
//     page.evaluate(async (ms, rate) => { … }, fishMs, fishRate)
//   这类缺陷对本地三道门**全部隐形**：
//     · npm run check  对 probe/*.mjs 零覆盖（语法错它照样 PASS）
//     · node --check   只验语法，不执行该行
//     · 纯算术自证     算的是折算式，与调用签名无关
//   ⇒ 只能靠人记住；这次它咬了两次，所以机器化。
//
// ── 阈值：**实测得来，不靠转述**（playwright-core 1.63.0，2026-10-13 实跑）──
//   实跑（一次性脚本，跑完即删；outputs/ 被 .gitignore 忽略，所以本门只留读数）
//   page.evaluate 各形态的实跑读数：
//     1 参（只有函数）            OK
//     2 参（函数 + 任意实参）      OK
//     3 参（第 3 个是数字）        THROW Too many arguments
//     3 参（第 3 个是对象字面量）  OK      ← 第 3 位是 options，不是数据
//     3 参（第 3 个是字符串）      THROW
//     4 参                       THROW
//     waitForFunction 三参        OK（(fn, arg, options)，合法）
//   对应实现（node_modules/playwright-core/lib/coreBundle.js）：
//     assertMaxArguments(arguments.length, 3)  → 超过 3 个实参即抛
//     assertEvaluateOptions(options)          → 第 3 参必须是**非数组对象**，
//                                                否则抛同一句错
//   ⇒ 判据：**实参 ≥4 一律红；实参 3 且第 3 参不是以 { 开头的对象字面量则红**。
//     注意「两个实参」是**合法的**（函数 + 一个数据）——把 ≥2 当红是错的，
//     本门第一版就栽在这里（把 47 处合法调用全报红，等于没有牙）。
//
// ── 口径要点 ────────────────────────────────────────────────────────────
//   ① **只判 evaluate，不判 waitForFunction** —— 后者本来就是 (fn, arg, options)
//      三参，合法。误报它等于这道门没有牙。
//   ② **实参个数靠括号配平数顶层逗号**，不能数 '(' 或粗数逗号 —— 箭头函数体里
//      全是逗号（{ a, b }、f(x, y)）。本门用字符级状态机跳过 括号/引号/模板串
//      /正则字面量/行注释/块注释，**只把「仍在 evaluate 这层实参区」的逗号算顶层**。
//      ⚠️ 这层实参区的深度是 1——因为 evaluate 自己的开括号已经算进去了。
//         第一版初值写成 0，等于漏掉本层，于是 setEnv('time', t) 里的逗号
//         被当成顶层逗号，2 参的合法调用被判成 2 参且整体偏移一位。
//         **自己写这道门时也要有牙：先量清 depth 的初值，再跑。**
//   ③ **标记本身也走状态机**：头注释里出现的 .evaluate( 文本、字符串里的
//      '.evaluate(' 都不能当成调用点（第一版因此把自己报红两次）。
//   ④ 失败信息给 文件:行号 + 实参个数 + 原文片段，让人一眼知道该打包成对象。
//
// ── 边界（写清楚以免日后有人当它能抓更多）──────────────────────────────
//   · 只认**字面量形态**的 .evaluate( 调用；写成 .evaluate.apply(page, args)
//     本门看不见（那种写法本身也该改）。
//   · 只覆盖 Page/Frame 的 evaluate（max 3）。Locator.evaluate 与
//     ElementHandle.evaluate 在本版没有 assertMaxArguments，多传是**静默丢弃**
//     而非抛错——那属于另一类隐患（参数被吞），本门不判。
//   · 第 3 个实参若写成外部变量（opts）而非对象字面量，本门会红。这是有意的：
//     「拿不准它是不是 options」时逼你写成字面量，别赌。
//   · 跨行调用照样能数（状态机不按行断），报 .evaluate( 所在行。
//
// 用法：node probe/playwright-args-guard.mjs  （exit 0 = 全仓干净，1 = 有超限 evaluate）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = path.join(ROOT, 'probe');

/* 正则字面量 vs 除号：在「值可开始」的位置出现的 / 不是除号。
   判据取常见启发式（前一个有效字符）。只为别把 /\.evaluate\(/ 当成调用点。 */
const VALUE_START = /[({[=,;:!&|?+\-*%~^<>]/;

function skipQuoted(src, i) {           // i 指向 ' 或 "
  const q = src[i];
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === q) return i + 1;
  }
  return src.length;
}

function skipLine(src, i) {              // i 指向 // 之后
  const nl = src.indexOf('\n', i);
  return nl < 0 ? src.length : nl;
}

function skipBlock(src, i) {             // i 指向 /* 之后
  const e = src.indexOf('*/', i);
  return e < 0 ? src.length : e + 2;
}

/* 跳过模板串（含 ${…} 里的嵌套）。内部一切逗号都不是顶层逗号。 */
function skipTemplate(src, i) {          // i 指向 `
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') { i = skipExpr(src, i + 2, '}'); continue; }
    i++;
  }
  return src.length;
}

/* 跳过一段代码表达式，直到遇到不在任何嵌套里的 close 字符。
   与 scanArgs 共用同一套跳过规则 —— 两边口径不一致同样会造出假警报。 */
function skipExpr(src, i, close) {
  let depth = 0;
  let prev = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = skipLine(src, i + 2); continue; }
    if (c === '/' && d === '*') { i = skipBlock(src, i + 2); continue; }
    if (c === "'" || c === '"') { i = skipQuoted(src, i); prev = 'v'; continue; }
    if (c === '`') { i = skipTemplate(src, i); prev = 'v'; continue; }
    if (c === '/' && (prev === '' || VALUE_START.test(prev))) {
      i = skipRegex(src, i);
      prev = 'v';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; i++; prev = c; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0 && c === close) return i;      // 到顶了，归调用方处理
      depth--;
      i++;
      prev = c;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return i;
}

function skipRegex(src, i) {             // i 指向 /（已确定是正则）
  i++;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) { i++; while (i < src.length && /[a-z]/i.test(src[i])) i++; return i; }
    else if (c === '\n') return i;     // 没闭合，当普通字符处理，不吞后面的代码
    i++;
  }
  return i;
}

/* 扫描出「处于代码态」的 .evaluate( 起点（头注释与字符串里的不算）。 */
function findEvaluateCalls(src) {
  const marks = [];
  let i = 0, prev = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = skipLine(src, i + 2); continue; }
    if (c === '/' && d === '*') { i = skipBlock(src, i + 2); continue; }
    if (c === "'" || c === '"') { i = skipQuoted(src, i); prev = 'v'; continue; }
    if (c === '`') { i = skipTemplate(src, i); prev = 'v'; continue; }
    if (c === '/' && (prev === '' || VALUE_START.test(prev))) { i = skipRegex(src, i); prev = 'v'; continue; }
    if (c === '.' && src.startsWith('.evaluate(', i)) { marks.push(i); i += '.evaluate('.length; prev = 'v'; continue; }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return marks;
}

/* 从 openIdx（evaluate 的 '('）起做括号配平，返回 { args, argStarts, end }。
   实参区深度从 1 起算 —— openIdx 那个 '(' 就是这一层。 */
function scanArgs(src, openIdx) {
  let i = openIdx + 1, depth = 1, commas = 0, saw = false, end = -1;
  const argStarts = [openIdx + 1];
  let prev = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = skipLine(src, i + 2); continue; }
    if (c === '/' && d === '*') { i = skipBlock(src, i + 2); continue; }
    if (c === "'" || c === '"') { i = skipQuoted(src, i); saw = true; prev = 'v'; continue; }
    if (c === '`') { i = skipTemplate(src, i); saw = true; prev = 'v'; continue; }
    if (c === '/' && (prev === '' || VALUE_START.test(prev))) { i = skipRegex(src, i); saw = true; prev = 'v'; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; saw = true; i++; prev = c; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
      i++;
      prev = c;
      continue;
    }
    if (c === ',' && depth === 1) { commas++; argStarts.push(i + 1); saw = true; i++; prev = ','; continue; }
    if (depth >= 1 && !/\s/.test(c)) { saw = true; prev = c; }
    i++;
  }
  if (end < 0) return null;              // 没配平（片段不完整），不猜
  /* 尾逗号合法且不算一个实参：foo(fn, arg,) —— pwa-cache.mjs:71 就是这个写法。
     第一版没处理，它被数成 4 个实参，waitForFunction 自检因此误红。 */
  const tailBlank = argStarts.length && !src.slice(argStarts[argStarts.length - 1], end).trim();
  if (tailBlank) argStarts.pop();
  if (!argStarts.length) return { args: 0, argStarts, end };
  return { args: argStarts.length, argStarts, end };
}

function sliceArg(src, start, limit) {
  return src.slice(start, limit).trim().slice(0, 60);
}

/* 判红：实参 ≥4，或实参 3 且第 3 参不是对象字面量（assertEvaluateOptions）。 */
function checkCall(src, at) {
  const openIdx = at + '.evaluate'.length;      // 指向 '('
  const r = scanArgs(src, openIdx);
  if (!r) return null;
  if (r.args < 3) return null;
  const third = r.args === 3 ? sliceArg(src, r.argStarts[2], r.end) : '';
  if (r.args === 3 && third.startsWith('{')) return null;   // 第 3 位是 options，合法
  return { args: r.args, third,
           snippet: src.slice(at, Math.min(r.end + 1, at + 120)).replace(/\s+/g, ' ') };
}

function scanFile(file) {
  const src = fs.readFileSync(path.join(PROBE, file), 'utf8');
  const hits = [];
  for (const at of findEvaluateCalls(src)) {
    const h = checkCall(src, at);
    if (h) hits.push({ file, line: src.slice(0, at).split('\n').length, ...h });
  }
  return hits;
}

/* 同口径自检：waitForFunction 的三参签名是合法的，必须零命中，
   否则这道门会把合法写法当缺陷 ⇒ 等于没有牙。 */
function scanWaitForFunction(file) {
  const src = fs.readFileSync(path.join(PROBE, file), 'utf8');
  const n = [];
  const re = /\.waitForFunction\(/g;
  let m;
  while ((m = re.exec(src))) {
    const r = scanArgs(src, m.index + '.waitForFunction'.length);
    if (r && r.args > 3) n.push({ file, line: src.slice(0, m.index).split('\n').length, args: r.args });
  }
  return n;
}

/* ── 扫全仓（排除 _ 开头的辅助件：它们不是门，多传只影响自己）──────────── */
const files = fs.readdirSync(PROBE)
  .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort();

const bad = [];
const wfBad = [];
for (const f of files) {
  bad.push(...scanFile(f));
  wfBad.push(...scanWaitForFunction(f));
}

console.log('[playwright-args-guard] 扫 ' + files.length + ' 个非辅助件探针');
console.log('[playwright-args-guard] 阈值（实测 playwright-core 1.63.0）：实参 ≥4 红；'
  + '实参 3 且第 3 参非对象字面量红（它是 options 位）');
console.log('[playwright-args-guard] 实参 2（函数 + 一个数据）合法；waitForFunction 三参合法');

if (wfBad.length) {
  console.log('[playwright-args-guard] 口径自检失败：waitForFunction >3 实参 ' + wfBad.length
    + ' 处 ⇒ 本门会把合法写法当缺陷，先修口径');
  for (const h of wfBad.slice(0, 5)) console.log('    ' + h.file + ':' + h.line + '  实参 ' + h.args);
  console.log('[playwright-args-guard] FAIL');
  process.exit(1);
}
console.log('[playwright-args-guard] 口径自检：waitForFunction 零误报 ✓');

if (!bad.length) {
  console.log('[playwright-args-guard] ALL PASS（0 处超限 evaluate）');
  process.exit(0);
}

console.log('[playwright-args-guard] 发现 ' + bad.length + ' 处超限 evaluate：');
for (const h of bad) {
  console.log('  ' + h.file + ':' + h.line + '  实参 ' + h.args + ' 个'
    + (h.args === 3 ? '（第 3 参 = ' + h.third + '）' : ''));
  console.log('      ' + h.snippet);
  console.log('      → 修法：多个数据打包成一个对象，形如 }, { a, b })；'
    + '第 3 位只留给 options（如 { timeout }）');
}
console.log('[playwright-args-guard] FAIL（' + bad.length + ' 处）');
process.exit(1);
