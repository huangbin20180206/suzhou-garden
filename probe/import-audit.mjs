// P0-1 拆分守卫：算 index.html 内联模块对 src/*.js 导出名的使用缺口，
// 并检查 src/*.js 之间的互相引用是否都有 import。
// 用法: node probe/import-audit.mjs     （npm run check 之外的第二道拆分门禁）
//
// 为什么需要它：内联模块与 src 模块共享**同一个词法世界**时，漏一个 import
// 只在浏览器运行到那一行才炸（node --check 完全看不出）。实测踩过三次：
// mulberry32（在 01 内被用）、makePondBedTex / makePlaqueTex / makeSteleTex / makeInkWashTex
// （在内联里被用）—— 都是这道理。本门禁把这类错误压到"改完即知"。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly, referencesName, topLevelDecls, localBindings, shadowCoversAll } from './_codeonly.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m){ console.error('import-audit: 未找到内联 module script'); process.exit(1); }
const body = m[1];

function declsOf(src){
  const names = new Set();
  for (const r of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(r[1]);
  for (const r of src.matchAll(/^export\s*\{([^}]*)\}/gm)){
    for (const part of r[1].split(',')){
      const t = part.trim().split(/\s+as\s+/);
      if (t.length) names.add((t[1] || t[0]).trim());
    }
  }
  return names;
}
function importsOf(src){
  /* ⚠️ **别名 import 必须把"原名"和"本地名"都记进可见集**（2026-10-02 修既存红门时定位）。
     旧写法 `names.add(part.trim())` 把 `aggregate as preloadAggregate` 整串当成一个名字
     ⇒ 集合里既没有 `aggregate` 也没有 `preloadAggregate`。两个后果（① 是 HEAD 上红了两天的假红）：
       ① ② 段判"缺 import"比对的是**导出原名**：codeOnly 会保留 import 语句行本身，
          而 referencesName 不认识 import 语法 ⇒ import 行里的原名被当成"一次使用"
          ⇒ 11-loop 的 `aggregate as preloadAggregate` 被报"用到 aggregate 但没 import"；
       ② ③ 段"禁止给导入绑定赋值"比对的是本地名 ⇒ 别名导入的绑定根本不在保护名单里。
     修这一处，两段同时受益。 */
  const names = new Set();
  for (const r of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)){
    for (const part of r[1].split(',')){
      const p = part.trim();
      if (!p) continue;
      const m = p.match(/^([\w$]+)\s+as\s+([\w$]+)$/);   // 原名 as 本地名
      if (m){ names.add(m[1]); names.add(m[2]); }
      else names.add(p);
    }
  }
  return names;
}
/* 「有没有引用这个名字」一律走共享判定（见 _codeonly.mjs）：
   注释 / 字符串字面文本 / 属性访问 / 对象字面量的键**都不算引用**。
   ⚠️ 这里吃过 9 条同型假红的教训：抽出 09-lights.js 之后，00-config.js 里的
   `CFG.sun` 与 `sun: {...}` 被判成"用到 sun 但没 import 09-lights.js"。 */
const occ = (src, name) => referencesName(codeOnly(src), name);
/* 一个文件里"自己能看见的名字"：顶层声明 + import 进来的 + 任意层级的局部绑定。
   落进 top/imp 的名字，就轮不到"缺 import"这条判据。
   ⚠️ loc（含形参 / 函数内 const）**不能单独豁免**：见 shadowCoversAll 的注释 ——
   局部声明只有真罩住全部引用时才算数，否则照判缺 import。
   （真缺 import 会在页面加载时硬炸，`npm test` 一定看得见；而假红会让人加一个
   根本不该存在的 import，那是把错误写进代码。两条风险现在都由"引用是否被罩住"来裁决。） */
function visibleNames(src){
  const code = codeOnly(src);
  return {
    code,
    top: new Set(topLevelDecls(code).map(d => d.name)),
    imp: importsOf(src),
    loc: localBindings(code),
  };
}
/* 局部声明豁免的唯一入口：罩住了才放行（放行时留一条 note 便于回查） */
function excusedByLocal(vis, name){
  return vis.loc.has(name) && shadowCoversAll(vis.code, name);
}

const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => /\.js$/.test(f));
const exportsByFile = new Map();
for (const f of srcFiles) exportsByFile.set(f, declsOf(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')));

const problems = [];
const notes = [];

// ① 内联模块用到的 src 导出名，必须已经 import
const inlineImported = new Set();
for (const r of body.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/src\/([^'"]+)['"]/g)){
  for (const part of r[1].split(',')) if (part.trim()) inlineImported.add(part.trim());
}
const bodyVis = visibleNames(body);
for (const [file, names] of exportsByFile){
  for (const name of names){
    if (inlineImported.has(name) || bodyVis.top.has(name)) continue;
    if (!occ(body, name)) continue;
    if (excusedByLocal(bodyVis, name)){ notes.push(`index.html: ${name} 被本地声明整体罩住（另有同名导出）—— 不判缺 import`); continue; }
    problems.push(`index.html 用到 ${name}（${file} 导出）但没 import`);
  }
}

// ② src 模块之间的引用缺口（排除自身声明 / 自身 import / 同名整体遮蔽）
for (const [file, names] of exportsByFile){
  const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
  const vis = visibleNames(src);
  for (const [other, otherNames] of exportsByFile){
    if (other === file) continue;
    for (const name of otherNames){
      if (vis.top.has(name) || vis.imp.has(name)) continue;
      if (!occ(src, name)) continue;
      if (excusedByLocal(vis, name)){ notes.push(`${file}: ${name} 被本地声明整体罩住（另有同名导出）—— 不判缺 import`); continue; }
      problems.push(`${file} 用到 ${name}（${other} 导出）但没 import`);
    }
  }
}

// ③ 不得给 import 进来的绑定赋值 —— ESM 导入绑定只读（等价 const）。
//    拆模块把原单体里"§A 赋值 §B 的 let"变成了对导入绑定赋值 → 运行期
//    "TypeError: Assignment to constant variable"，且报错**不说是哪个名字**。
//    实测 2 处（11-loop 的 `windClock += dt`、12-env 的 `casterBoxDirty = true`）。
//    修法：由定义方导出 setter / advance 之类的小函数（读仍走 live binding，不受影响）。
//    ⚠️ 局部再声明（`const NAME = ...`，遮蔽）是合法的，必须排除 —— 否则又是假红。
function assignedImported(src, imported){
  const hits = new Set();
  for (const line of codeOnly(src).split('\n')){
    for (const name of imported){
      const esc = name.replace(/\$/g, '\\$');
      const re = new RegExp('(^|[^.\\w$])' + esc + '\\s*(?:=(?!=|>)|\\+=|-=|\\*=|/=|\\+\\+|--)');
      const m = line.match(re);
      if (!m) continue;
      if (/\b(?:const|let|var)\s+$/.test(line.slice(0, m.index + m[1].length))) continue;
      hits.add(name);
    }
  }
  return hits;
}
for (const [file] of exportsByFile){
  const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
  for (const name of assignedImported(src, importsOf(src)))
    problems.push(`${file} 给 import 进来的 ${name} 赋值（导入绑定只读，运行期抛 Assignment to constant variable）`);
}

// ④ src 模块不得引用 index.html 内联模块**专有**的名字
//    拆模块后 src 与内联模块不再共享词法世界：内联里的 const / function 在 src 中根本不存在，
//    引用它 = 运行期 ReferenceError。实测踩过（2026-09-20）：06-vegetation 的
//    createGLTFLoaderWithDecoders 读内联的 `$解码器` 抛 ReferenceError，而它在
//    `new Promise` 的 executor 里抛、被下游 `.catch(()=>{})` 静默吞掉 ——
//    三类 GLB 资产永远挂不上，零告警、零失败计数，只有 smoke 的一条能看见。
//    只查"内联专有"（src 里没有任何同名导出的名字）以免与 ① ② 重复报；
//    vendor 导出的名字（THREE / GTAOPass…）也算内联专有 —— src 要用必须自己从 vendor import。
const inlineOwn = new Set();
for (const d of topLevelDecls(body)) inlineOwn.add(d.name);
for (const n of importsOf(body)) inlineOwn.add(n);
const exportedAnywhere = new Set();
for (const [, names] of exportsByFile) for (const n of names) exportedAnywhere.add(n);
for (const [file] of exportsByFile){
  const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
  const vis = visibleNames(src);
  for (const name of inlineOwn){
    if (exportedAnywhere.has(name)) continue;
    if (vis.top.has(name) || vis.imp.has(name)) continue;
    if (excusedByLocal(vis, name)) continue;
    if (referencesName(vis.code, name))
      problems.push(`${file} 引用了 index.html 内联模块专有的 ${name}（src 里没有该绑定，运行期必 ReferenceError）`);
  }
}

// ⑤ 从 src 模块 import 的名字，**对面必须真的导出它**。
//    这一类缺陷的症状最重：ESM 解析 import 时就失败 ⇒ 整个模块图加载不起来 ⇒
//    **整页停在加载页（白屏）**，而 `npm run check`（语法 + no-undef）看不见
//    （import 语句本身语法合法、名字也没"裸用"），①②③④ 也全都看不见
//    （它们查的是"用了没导入 / 给导入赋值 / 引用内联专有名"）。
//    实测 2026-10-05 拆灯会时踩到：12-env `import { ..., applyFestivalTo } from './12c-festival.js'`，
//    而 12c 里那个函数忘了加 `export` ⇒ 本门当时报 PASS、页面却永远加载不出来，
//    最后是 smoke/pageerror 的超时 + outputs/_diag/boot-error.mjs 抓出来的。
//    ⚠️ 只查 src ↔ src；vendor.js 与其它非 src 目标不查（它们的导出面不在本门的登记表里）。
//    ⚠️⚠️ 这里**不能**用 codeOnly()：它连字符串字面量一起涂白（那是它的本职：防"注释/字符串里的
//       裸名字"误报），而 import 语句的模块路径恰恰是字符串 ⇒ 涂白后整条 import 都匹配不到
//       （实测：codeOnly 后本文件能匹配到的 import 数 = 0，负例自检当场报"门是假的"）。
//       所以只去注释、保留字符串（`(^|[^:])` 那半截是为了别把 `https://` 当成行注释）。
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
function importedNamesOf(src){
  const out = [];
  for (const r of stripComments(src).matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([^'"]+)['"]/g)){
    const names = r[1].split(',').map(s => s.trim()).filter(Boolean)
                       .map(s => s.split(/\s+as\s+/)[0].trim());
    out.push({ from: r[2], names });
  }
  return out;
}
for (const [file] of exportsByFile){
  const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
  for (const { from, names } of importedNamesOf(src)){
    const have = exportsByFile.get(from);
    if (!have) continue;                     // 目标不是 src 模块（vendor / 其它）⇒ 不查
    for (const n of names){
      if (have.has(n)) continue;
      problems.push(`${file} import 了 ./${from} 的 ${n}，但那个模块没有导出它`
                  + `（模块图加载会失败 → 整页停在加载页；注意 import 与 export 都要写）`);
    }
  }
}

if (problems.length){
  console.error('import-audit: FAIL');
  for (const p of problems) console.error('  ✗ ' + p);
  for (const n of notes) console.error('  · ' + n);
  process.exit(1);
}
console.log(`import-audit: PASS（src ${srcFiles.length} 个模块，导出/引用无缺口）`);
for (const n of notes) console.log('  · ' + n);
