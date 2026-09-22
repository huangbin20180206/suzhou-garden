// 静态门禁共用的「语法判定」：什么算代码、什么算"引用了一个名字"、谁是顶层声明、谁是局部绑定。
//
// 为什么要单独一个文件：拆模块工具（_extract-section.mjs）与 import 审计（import-audit.mjs）
// 都要问同一批问题。两边各写一份必然分叉，而分叉的后果是同一处代码在两个门禁里得到相反的结论。
//
// ── 三类假红全部实测踩过（假红比漏报更坏：它会让人跑去给一个本来就不该 import 的名字加 import）──
//   ① 注释：给 00-config.js 写一句说明，里面出现裸的 `MAT` → 判「用到 MAT 但没 import」
//   ② GLSL 模板串：01-materials.js 的 shader 里写着 `float gust = ...`，
//      而 2b-wind.js 恰好导出了同名 JS 变量 `gust` → 判「用到 gust 但没 import」
//   ③ 属性访问 / 对象字面量的键：抽出 09-lights.js 后，00-config.js 里的 `CFG.sun` 与
//      `sun: {...}` 被判「用到 sun 但没 import」—— 一次炸出 9 条同型假红，
//      而它们指向的是一个**根本不该存在**的 import。
// 对应三道处理：codeOnly / codeOnly / stripObjKeys + 跳过 `.` 前缀。

/* ── ① 挖掉注释与字符串字面文本，保留模板串里的 ${...}（那是真代码） ── */
export function codeOnly(src){
  const out = src.split('');
  const blank = (i, j) => { for (let k = i; k < j; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < src.length){
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/'){ let j = src.indexOf('\n', i); if (j < 0) j = src.length; blank(i, j); i = j; continue; }
    if (c === '/' && n === '*'){ let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2; blank(i, j); i = j; continue; }
    if (c === '"' || c === "'"){
      let j = i + 1;
      while (j < src.length && src[j] !== c){ if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '`'){
      let j = i + 1;
      while (j < src.length){
        if (src[j] === '\\'){ j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{'){          // 跳过整个插值表达式（它是真代码）
          let d = 1, k = j + 2;
          while (k < src.length && d > 0){
            if (src[k] === '{') d++; else if (src[k] === '}') d--;
            k++;
          }
          j = k; continue;
        }
        j++;
      }
      /* 逐段保留 ${...}：把模板串里的字面文本挖空 */
      const inner = src.slice(i + 1, j);
      let out2 = '', p = 0;
      while (p < inner.length){
        const s = inner.indexOf('${', p);
        if (s < 0){ out2 += ' '.repeat(inner.length - p); break; }
        const close = inner.indexOf('}', s);
        out2 += ' '.repeat(s - p) + inner.slice(s, close + 1);
        p = close + 1;
      }
      out.splice(i + 1, inner.length, ...out2.split(''));
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/* ── ③ 去掉对象字面量的**键**（保留值）；`{ sun }` 这种简写不算键，会留下 ── */
export function stripObjKeys(code){
  return String(code).replace(/([{,]\s*)[A-Za-z_$][\w$]*(\s*:)/g, '$1$2');
}

const IDENT_RE = /(?<![\w$])[A-Za-z_$][\w$]*(?![\w$])/g;
/* ⚠️ 标识符边界不能用 `\b`：`$` 是标识符允许的字符但**不是词字符**，
   于是 `\b\$解码器\b` 永远匹配不到（前面是空格时 `\b` 不成立）—— 实测就是这样漏掉了
   src 里对 index.html 内联 `$解码器` 的引用（那处 ReferenceError 被 Promise 吞掉，
   三类 GLB 资产静默挂不上）。改用 lookbehind/lookahead 判标识符字符。 */
const identBoundary = name => '(?<![\\w$])' + name.replace(/\$/g, '\\$') + '(?![\\w$])';
/* 名字是否被真正引用：跳过属性访问（`a.b` 里的 b 不是自由变量）。
   前缀空白也要往前吃掉 —— `CFG . sun` 同样不是引用。 */
function referencedAt(s, index){
  let k = index - 1;
  while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--;
  return !(k >= 0 && s[k] === '.');
}
export function identsOf(src){
  const s = stripObjKeys(src);
  const out = new Set();
  for (const m of s.matchAll(IDENT_RE)) if (referencedAt(s, m.index)) out.add(m[0]);
  return out;
}
export function referencesName(code, name){
  const s = stripObjKeys(code);
  const re = new RegExp(identBoundary(name), 'g');
  for (const m of s.matchAll(re)) if (referencedAt(s, m.index)) return true;
  return false;
}

export const DECL_RE = /^(?:export\s+)?(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
export function topLevelDecls(src){
  const lines = Array.isArray(src) ? src : String(src).split('\n');
  const out = [];
  lines.forEach((l, i) => { const r = l.match(DECL_RE); if (r) out.push({ name: r[2], kind: r[1], idx: i }); });
  return out;
}
/* 某个下标处**最内层**的 `{...}` 块（对象字面量也算进去 —— 保守但安全）。找不到返回 null。
   依赖 codeOnly 保长（挖空注释/字符串时用空格顶位、模板串按长度对齐），故下标与源码一致。 */
export function enclosingBlock(code, index){
  let depth = 0, start = -1;
  for (let i = index; i >= 0; i--){
    if (code[i] === '}') depth++;
    else if (code[i] === '{'){ if (depth === 0){ start = i; break; } depth--; }
  }
  if (start < 0) return null;
  let d = 0;
  for (let j = start; j < code.length; j++){
    if (code[j] === '{') d++;
    else if (code[j] === '}'){ d--; if (d === 0) return [start, j]; }
  }
  return null;
}

/* 名字的引用是否**全部**被某个"可能声明它的作用域块"罩住。
   ⚠️ 旧实现（"文件里出现过同名局部声明"就放行）是危险的假阴性：
   06-vegetation.js 里一句 `const rr = r1 - r2;`（函数内的半径差）给全模块几百处
   `rr(a,b)` 背了书 → 漏掉 `rr` 的 import → 页面加载即 `rr is not defined`。
   现改为"最小覆盖"：取每个引用点最内层的块，逐个挖空后看是否还有引用残留；
   全被罩住才允许豁免，否则照判缺 import。
   函数形参也走同一路：形参所在下标向外找 `{` 命中的正是函数体。 */
export function shadowCoversAll(code, name){
  const re = new RegExp(identBoundary(name), 'g');
  const cands = [];
  for (const m of code.matchAll(re)){
    const b = enclosingBlock(code, m.index);
    if (b) cands.push(b);
  }
  for (const [s, e] of cands){
    const masked = code.slice(0, s) + ' '.repeat(e - s + 1) + code.slice(e + 1);
    if (!referencesName(masked, name)) return true;
  }
  return false;
}

/* 切片/文件内**任意层级**的局部绑定（含函数参数与解构模式）。
   只收顶层声明的话，函数体里的 const 与形参全会被当成"查无此人"，
   噪声一大，真正要看的那一行就淹了 —— 更坏的是会把它报成"缺 import"。 */
export function localBindings(src){
  const s = new Set();
  const add = txt => { for (const m of String(txt).matchAll(/[A-Za-z_$][\w$]*/g)) s.add(m[0]); };
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of src.matchAll(/\bfunction\s+[A-Za-z_$]*\s*\(([^()]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/(?:^|[\s,(=])([A-Za-z_$][\w$]*)\s*=>/g)) s.add(m[1]);
  return s;
}
