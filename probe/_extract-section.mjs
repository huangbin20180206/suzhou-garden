// C 项「拆模块」工具：按行区间把 index.html 内联模块的一节**字节级精确**搬到 src/NN-name.js。
// 为什么要有它：一个节动辄 200~2500 行，手抄进 new_string 是纯转录风险（漏一行不报错、
// 只在浏览器跑偏）；而 import-audit 只能事后抓"缺 import"，抓不到"抄丢了半行"。
//
// 用法：
//   node probe/_extract-section.mjs --list
//   node probe/_extract-section.mjs --spec '<json>'          # 预演，不写盘（默认）
//   node probe/_extract-section.mjs --spec '<json>' --apply
// spec 字段：{ "num":2, "name":"scene", "start":615, "end":853,
//              "imports":[{"from":"../vendor.js","names":["THREE","OrbitControls"]}] }
// 行号是 index.html 的 1-based 行号，区间 [start, end) —— end 取"下一节 banner 的第一行"。
//
// 它会做三件事：
//   ① 把 [start,end) 原样切成模块体，给指定名字加 export（每个都必须**恰好命中一次**，否则报错退出）
//   ② 生成模块头 import + index.html 侧的 import 语句（由 exports 推导，不手写）
//   ③ **依赖体检**：列出"节内用到、但节内没定义"的名字，并逐个判定
//      （已声明的 import / 全局 / 定义在节前 / ⚠️定义在节后——后者搬走必断，违反铁律①）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeonly.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m){ console.error('未找到内联 module script'); process.exit(1); }
const body = m[1];
const bodyLines = body.split('\n');
const fileLines = html.split('\n');

/* ⚠️ banner 一律在**整份 html** 上搜，不在 body 上搜：
   body 是捕获组，它的起点比 match.index 晚一个 `<script ...>` 的长度 ——
   拿 `match.index + 组内偏移` 换算行号会整体漂（实测把 §2 的起点从 615 报成 612）。
   在 html 上搜，r.index 本身就是绝对下标，行号 = 它前面的换行数，无需换算。
   ⚠️ 不要求第 3 行就是收口行：§12 的 banner 在第 3 行之后还挂着说明文字，
   旧正则（要求收口行紧跟标题行）因此**整节漏检**；而它一漏，上一节的区间就把
   ENV 那一千多行一起吞进去（实测 §10 被算成 1527 行，看着还挺"合理"）。 */
const sectionRe = /\/\* ═+\n\s*(\d+) · ([^\n]*)\n/g;
function listSections(){
  const out = [];
  let r;
  while ((r = sectionRe.exec(html))) out.push({
    num: +r[1], title: r[2].trim(), raw: r[0],
    startLine: html.slice(0, r.index).split('\n').length,
    inScript: r.index > m.index && r.index < m.index + m[0].length,
  });
  return out;
}

/* ⚠️ 区间终点**不能**直接取"下一节 banner 的第一行"。
   一旦中间某节先被抽走，它的 banner 就没了、只剩一条 import 语句落在
   「上一节区间的尾巴」上 —— 量下一节 banner 时它被顺带圈进来。
   实测：抽完 §5 后再量 §4，末行成了 §5 那条 import → 它被卷进 04-buildings.js，
   index.html 反而丢了 §5 的 import（而模块里那条路径还是错的：`./src/05-water.js`
   在 src/ 内应为 `./05-water.js`）。危险在于**工具照旧报"✓ 已写入"**。
   修法：把尾巴上的"生成物"（空行 + 本工具写的 src import 行）先剥掉。 */
const GEN_IMPORT = /^import (?:[\w{][^']*from )?'\.\/src\/[^']+';\s*$/;
/* 内联模块的**收口行**（`</script>` 所在行）。
   ⚠️ 最后一节的 end 会一路取到文件末尾，把 `</script></body></html>` 一起卷进模块 ——
   实测发生过：index.html 的 `</script>` 被搬走，页面直接报"未找到内联 module script"，
   而工具照旧报 ✓ 已写入。所以 end 必须夹在这条线**之前**。 */
const SCRIPT_END_LINE = html.slice(0, m.index + m[0].length).split('\n').length;
function effEnd(endLine){
  let e = Math.min(endLine, SCRIPT_END_LINE);
  while (e - 1 > 0 && (fileLines[e - 2].trim() === '' || GEN_IMPORT.test(fileLines[e - 2]))) e--;
  return e;
}

/* ── codeOnly（"什么算代码"）已抽到 ./_codeonly.mjs，与 import-audit.mjs 共用同一份判定 ── */

const GLOBALS = new Set(`document window console Math JSON Object Array String Number Boolean Symbol Promise Map Set WeakMap WeakSet Date RegExp Error TypeError RangeError isNaN isFinite parseFloat parseInt setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame addEventListener removeEventListener innerWidth innerHeight devicePixelRatio navigator performance location localStorage sessionStorage fetch Image Audio AudioContext URL Blob TextEncoder TextDecoder Float32Array Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Uint8ClampedArray ArrayBuffer DataView structuredClone queueMicrotask crypto getComputedStyle matchMedia IntersectionObserver ResizeObserver OffscreenCanvas Path2D DOMMatrix globalThis undefined null true false this arguments of in new typeof instanceof delete void return function if else for while do switch case break continue const let var class extends super try catch finally throw await async yield static get set import export default as from
  use strict`.split(/\s+/));

const DECL_RE = /^(?:export\s+)?(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
function topLevelDecls(lines){
  const out = [];
  lines.forEach((l, i) => { const r = l.match(DECL_RE); if (r) out.push({ name: r[2], kind: r[1], idx: i }); });
  return out;
}
const identRe = /\b[A-Za-z_$][\w$]*\b/g;
/* ⚠️ 必须跳过**属性访问**：`CFG.sun.pos` 里的 `sun` 不是自由变量。
   不跳的话 §2 会被报成"依赖内联的 sun（第 6505 行）"—— 一个纯粹的假红。
   假红比漏报更坏：它会让人跑去搬一个根本不需要搬的东西。 */
function idents(src){
  const s = new Set();
  for (const m of src.matchAll(identRe)){
    let k = m.index - 1;
    while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
    if (k >= 0 && src[k] === '.') continue;
    s.add(m[0]);
  }
  return s;
}
/* 切片内**任意层级**的局部绑定（含函数参数与解构模式）。
   只收顶层声明的话，函数体里的 const / 形参全会被当成"查无此人"，
   噪声一大，真正要看的那一行就淹了。 */
function localBindings(src){
  const s = new Set();
  const add = txt => { for (const m of String(txt).matchAll(/[A-Za-z_$][\w$]*/g)) s.add(m[0]); };
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of src.matchAll(/\bfunction\s*[A-Za-z_$]*\s*\(([^()]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/(?:^|[\s,(=])([A-Za-z_$][\w$]*)\s*=>/g)) s.add(m[1]);
  return s;
}

const args = process.argv.slice(2);
const has = f => args.includes(f);
const specArg = (() => { const i = args.indexOf('--spec'); return i < 0 ? null : args[i + 1]; })();
void has;

if (!specArg){
  console.log('节清单（按文件内出现顺序，行号 = index.html 1-based）：\n');
  const secs = listSections();
  for (let i = 0; i < secs.length; i++){
    const s = secs[i], next = secs[i + 1];
    const rawEnd = next ? next.startLine : fileLines.length;
    const endLine = effEnd(rawEnd);
    /* 自校验：起点那行必须真的是 banner 开头，否则说明行号推导又漂了 */
    const head = (fileLines[s.startLine - 1] || '').trim().slice(0, 14);
    const ok = head.startsWith('/*') && s.inScript;
    const trimmed = endLine !== rawEnd ? `  ⚠️ 尾部剥掉 ${rawEnd - endLine} 行生成物` : '';
    console.log(`  ${ok ? ' ' : '✘'}§${String(s.num).padStart(2)} ${s.title.padEnd(22)} ${String(s.startLine).padStart(5)} ~ ${String(endLine - 1).padStart(5)}  (${endLine - s.startLine} 行)  [${head}]${trimmed}`);
    if (!ok) console.log(`        匹配原文首行：${JSON.stringify(s.raw.split('\n')[0].slice(0, 40))}（inScript=${s.inScript}）`);
  }
  console.log('\n传入 --spec \'<json>\' 预演；加 --apply 落盘。');
  process.exit(0);
}

const spec = JSON.parse(specArg);
const { num, name, start } = spec;
let end = spec.end;
if (!num || !name || !start || !end) { console.error('spec 缺字段（num/name/start/end）'); process.exit(1); }
/* 即使 spec 给宽了，也把尾巴上的生成物剥掉 —— 宁可剥，也不能把别的节的 import 卷进模块 */
const endClamped = effEnd(end);
if (endClamped !== end) console.log(`  ⚠️ end ${end} → ${endClamped}：尾巴是空行 / 本工具写的 import，已剥掉`);
end = endClamped;
const slice = fileLines.slice(start - 1, end - 1);
/* 起点守卫：切片**首行**若是空行或本工具写的 import，说明 start 偏了 ——
   偏一行就会把上一节的 import 语句卷进模块（实测发生过：§4 卷走了 §5 的 import）。
   这是"工具照样报 ✓ 已写入"的那类静默灾难，必须在落盘前拦死。 */
if (!slice.length || slice[0].trim() === '' || GEN_IMPORT.test(slice[0])){
  console.error(`✘ 切片首行是空行 / 生成的 import：${JSON.stringify((slice[0] || '').slice(0, 60))}`);
  console.error('  说明 start 偏了。用 node probe/_extract-section.mjs --list 重新取行号。');
  process.exit(2);
}
/* 终点守卫：切片里出现 `</script>`，说明 end 越过了内联模块的收口行 */
if (slice.some(l => /^\s*<\/script>/.test(l))){
  console.error('✘ 切片里含 </script> —— end 越过了内联模块的收口行，拒绝落盘。');
  process.exit(2);
}
const importSpecs = spec.imports || [];
/* 默认 export 集合 = 切片内的顶层声明 ∩ 切片外真被引用的那些。
   全导没用（导入行变长、绑一堆死名），全不导直接断；只导"外面用得到的"才对。
   ⚠️ 只扫 index.html 是不够的：已抽出去的节会把自己对外的 import 语句**从 index.html 带走**，
   于是"外面还有谁在用这个名字"就断了线。实测：抽完 §8 再抽 §9，§8 需要
   validateGeometry / mergeStatics，而这两个名字在 index.html 里已经不存在 →
   工具判成"切片外零引用"、不给 export，结果是 src/08-assemble.js 引用一个不存在的导出
   （浏览器加载即炸，而工具照旧报 ✓ 已写入）。所以要把"已有 src 模块从**本文件**import 了
   哪些名字"也算进"外面在用"。 */
const targetFile = `${String(num).padStart(2, '0')}-${name}.js`;
const importedFromMe = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(x => x.endsWith('.js'))){
  if (f === targetFile) continue;
  const s = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  for (const r of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)'/g)){
    if (r[2] !== targetFile) continue;
    for (const p of r[1].split(',')) if (p.trim()) importedFromMe.add(p.trim());
  }
}
const outsideIds = idents(codeOnly(fileLines.slice(0, start - 1).concat(fileLines.slice(end - 1)).join('\n')));
const allDecls = topLevelDecls(slice).map(d => d.name);
const exports_ = spec.exports || allDecls.filter(n => outsideIds.has(n) || importedFromMe.has(n));
/* index.html 侧的 import 只要"index.html 真用得到"的（= outsideIds），
   与模块对外 export 的集合**分开算**：像 validateGeometry 这种，只有别的 src 模块要，
   写进 index.html 就是一条永不使用的 import。 */
const indexNames = exports_.filter(n => outsideIds.has(n));

/* ① export 注入：每个名字必须恰好命中一次 */
const bodyOut = slice.slice();
const hits = new Map(exports_.map(n => [n, 0]));
bodyOut.forEach((l, i) => {
  const r = l.match(/^(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/);
  if (r && hits.has(r[2])){ bodyOut[i] = 'export ' + l; hits.set(r[2], hits.get(r[2]) + 1); }
});
const miss = [...hits].filter(([, c]) => c !== 1);
if (miss.length){
  console.error('✘ export 注入失败（名字没找到或命中多次）：');
  for (const [n, c] of miss) console.error(`   ${n} → 命中 ${c} 次`);
  process.exit(1);
}

/* ③ 依赖体检 —— 拆模块真正的风险不是"搬错行"，而是"搬过去之后看不见某个名字"。
   模块有独立词法作用域：内联模块里的 const / function，搬进 src 后**一个都看不见**，
   而 import-audit 只能事后抓"已 export 的名字"，抓不到这一类。
   所以落盘前把它们分三类点名：
     · 出自 src 模块 → 必须补进 spec.imports（漏了直接报错，不给落盘）
     · 出自内联模块 → 根本没法 import：切片之前的要先搬过来，切片之后的违反铁律①
     · 查无此人     → 多是注释 / GLSL 误报，人眼过一遍即可
   ⚠️ "在切片之前"和"在切片之后"必须分开报：补救方式完全不同，混在一起就是误导。 */
const scriptLine = html.slice(0, m.index).split('\n').length;
const sliceCode = codeOnly(bodyOut.join('\n'));
const declaredHere = new Set(topLevelDecls(bodyOut).map(d => d.name));

/* 内联模块里、切片之外的顶层声明 → 绝对行号 */
const inlineDecls = new Map();
bodyLines.forEach((l, k) => {
  const r = l.match(DECL_RE);
  if (!r) return;
  const abs = scriptLine + k;
  if (abs >= start && abs < end) return;
  if (!inlineDecls.has(r[2])) inlineDecls.set(r[2], abs);
});

/* src 模块的导出名 → 文件名（这些才是"可以 import"的） */
const srcExports = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(x => x.endsWith('.js'))){
  const s = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  for (const r of s.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm))
    if (!srcExports.has(r[1])) srcExports.set(r[1], f);
  for (const r of s.matchAll(/^export\s*\{([^}]*)\}/gm))
    for (const part of r[1].split(',')){
      const t = part.trim().split(/\s+as\s+/);
      if (t[0] && !srcExports.has((t[1] || t[0]).trim())) srcExports.set((t[1] || t[0]).trim(), f);
    }
}

let importedNames = new Set(importSpecs.flatMap(s => s.names));
const locals = localBindings(sliceCode);
function dependencyAudit(){
  const missingSrc = [], fromInline = [], unknown = [];
  for (const id of idents(sliceCode)){
    if (declaredHere.has(id) || locals.has(id) || importedNames.has(id) || GLOBALS.has(id)) continue;
    if (inlineDecls.has(id)){ fromInline.push({ id, line: inlineDecls.get(id), before: inlineDecls.get(id) < start }); continue; }
    if (srcExports.has(id)){ missingSrc.push({ id, file: srcExports.get(id) }); continue; }
    if (/^[A-Z][A-Z0-9_]{4,}$/.test(id)) continue;        // 全大写名：多为宏 / 节标题噪声
    unknown.push(id);
  }
  return { missingSrc, fromInline, unknown };
}
let { missingSrc, fromInline, unknown } = dependencyAudit();
/* --auto：把"出自 src 模块的漏网引用"直接补进模块头，不必手抄进 spec。
   为什么要它：一个中段小节动辄要 20~30 个跨模块名字，手抄进 spec.imports 是纯转录风险
   —— 少一个就是"模块里引用不存在的绑定"，只在浏览器跑到那一行才炸（node --check 看不出）。
   ⚠️ 只自动补「能定位到 src 文件」的；「出自内联作用域」的一律不补（那些没法 import，
   必须人工决定先搬谁），所以它仍然拦得住铁律①的违规。 */
if (has('--auto') && missingSrc.length){
  const byFile = new Map();
  for (const x of missingSrc){ if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x.id); }
  for (const [f, names] of byFile){ importSpecs.push({ from: './' + f, names }); names.forEach(n => importedNames.add(n)); }
  console.log('  --auto 自动补 import：' + [...byFile].map(([f, n]) => `${n.join(', ')} ← ${f}`).join('；'));
  ({ missingSrc, fromInline, unknown } = dependencyAudit());
}
const sliceNoCmt = codeOnly(bodyOut.join('\n'));
function unusedOf(){
  return new Set([...importedNames].filter(n => !new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b').test(sliceNoCmt)));
}
/* --trim：把 spec.imports 里写了、切片内却一次没用到的名字从模块头删掉。
   有了它，spec 就可以"宁可多给"（vendor.js 的 13 个名字整片列上），
   一次调用既预演又落盘，不必为猜准一行 import 反复跑。 */
if (has('--trim')){
  const drop = unusedOf();
  if (drop.size){
    for (let k = importSpecs.length - 1; k >= 0; k--){
      importSpecs[k].names = importSpecs[k].names.filter(n => !drop.has(n));
      if (!importSpecs[k].names.length) importSpecs.splice(k, 1);
    }
    importedNames = new Set(importSpecs.flatMap(s => s.names));
    console.log('  --trim 删掉没用到的 import：' + [...drop].join(', '));
    ({ missingSrc, fromInline, unknown } = dependencyAudit());
  }
}
const fatal = missingSrc.length > 0 || fromInline.length > 0;

const file = `${String(num).padStart(2, '0')}-${name}.js`;
const modHeader = [`// ${String(num).padStart(2, '0')}-${name}: from index.html inline ${start}..${end - 1}`]
  .concat(importSpecs.map(s => `import { ${s.names.join(', ')} } from '${s.from}';`))
  .concat(['']).join('\n');
/* 侧效应模块（只挂监听、只执行，对外不需要名字）：`import {  } from …` 虽然合法但很怪，
   直接写成裸 import。 */
const indexImport = indexNames.length
  ? `import { ${indexNames.join(', ')} } from './src/${file}';`
  : `import './src/${file}';`;

console.log(`── 抽取 §${num} ${name} → src/${file} ──────────────────`);
/* 切片自检：把首/末行打出来。行号一旦凭"位移"猜（每抽走一节，后面所有节就整体上移），
   差一行就是**静默的灾难**：起点偏上一行会把上一节的 import 语句卷进模块，
   终点偏上一行会**直接丢掉本节最后一行代码**，而工具照样报"✓ 已写入"。
   有了这两行，肉眼 2 秒就能判断区间对不对。 */
console.log(`  切片首 3 行｜${slice.slice(0, 3).map(l => l.trim()).filter(Boolean).join(' ▸ ').slice(0, 90)}`);
console.log(`  切片末行｜${(slice[slice.length - 1] || '').trim().slice(0, 70)}`);
console.log(`  切片 ${start} ~ ${end - 1}（${slice.length} 行）｜ export ${exports_.length} 个：${exports_.join(', ')}`);
console.log(`  未导出（切片外零引用）：${allDecls.filter(n => !exports_.includes(n)).join(', ') || '无'}`);
console.log(`  模块头 import ${importSpecs.length} 条；index.html 侧将写入：\n     ${indexImport}`);
console.log(`\n  依赖体检：`);
if (missingSrc.length)
  console.log(`    ⛔ 还得补 import（${missingSrc.length}）：` + missingSrc.map(x => `${x.id}(${x.file})`).join(', '));
if (fromInline.length){
  console.log(`    ⛔ 出自**内联作用域**、模块看不见（${fromInline.length}）—— 没法 import，只能先搬：`);
  for (const x of fromInline) console.log(`         ${x.id}  第 ${x.line} 行（在切片之${x.before ? '前' : '后'}）`);
}
if (!fatal) console.log(`    ✅ 切片内没有跨作用域的漏网引用。`);
/* 第二道直查：按**名字**扫"用到了但没 import"，不问作用域。
   为什么要加它：第一道体检依赖"这名字在切片内不是局部绑定"的启发式，实测**漏报**过
   waterSurface（05-water.js）与 rnd（03-factory.js）。漏报是致命的 —— 模块里引用一个
   不存在的绑定，只在浏览器跑到那一行才炸，`node --check` 完全看不出。
   所以第二道宁可有误报：代价是人工扫一眼多出来的名字，收益是漏不掉。
   误报的典型长相：函数内 `const rnd = mulberry32(seed)` 遮蔽了 00-config 的 rnd。 */
const missingByName = [...srcExports.keys()]
  .filter(n => !importedNames.has(n) && !allDecls.includes(n))
  .filter(n => new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b').test(sliceNoCmt));
if (missingByName.length)
  console.log(`    ⚠️ 直查（不问作用域）：` + missingByName.map(n => `${n}(${srcExports.get(n)})`).join(', '));
/* 反向一道：spec.imports 里写了、切片内却一次都没用到的名字。
   有了它，spec 就可以先"宁可多给"，再按报告删掉（或直接加 --trim 让它自己删）。 */
const unused = [...unusedOf()];
if (unused.length) console.log(`    🧹 写了但没用（加 --trim 自动从 spec.imports 删）：` + unused.join(', '));
console.log(`    查无此人（多是注释 / GLSL 误报，人眼过一遍）：${unknown.join(', ') || '无'}`);

if (!has('--apply')){ console.log('\n（预演。确认无误后加 --apply 落盘）'); process.exit(fatal ? 2 : 0); }
if (fatal){ console.error('\n✘ 依赖体检未通过，拒绝落盘。'); process.exit(2); }

fs.writeFileSync(path.join(ROOT, 'src', file), modHeader + bodyOut.join('\n'));
const before = fileLines.slice(0, start - 1).join('\n');
const after = fileLines.slice(end - 1).join('\n');
fs.writeFileSync(HTML, before + '\n' + indexImport + '\n' + after);
console.log(`\n✓ 已写入 src/${file}；index.html 的 ${start}~${end - 1} 行替换为 1 行 import。`);
