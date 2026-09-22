// 语法判定单元门禁（2026-09-20 加）：给 `_codeonly.mjs` 定契约。
// 为什么必须有：这个模块是 check / import-audit / _extract-section **共用的"什么算引用"**，
// 它判错的方向**全是静默**的 —— 判宽了 → 假红（让人去加一个根本不该存在的 import），
// 判窄了 → 假绿（漏掉真缺口，页面加载才炸）。两种都在拆模块时真实发生过：
//   · 判宽：抽出 09-lights 后，00-config 里的 `CFG.sun` / `sun: {...}` 一次炸出 9 条同型假红。
//   · 判窄：`\b` 做标识符边界时 `$` 不是词字符 → `\b\$解码器\b` 永远匹配不到，
//     于是 src 里对内联模块 `$解码器` 的引用**没有任何门禁看得见**，
//     06-vegetation 因此静默丢了三类 GLB 资产（ReferenceError 被 Promise 吞掉）。
// 本门禁就是拿这些真实案例反过来钉住行为：边界、属性访问、遮蔽覆盖面。
// 用法: node probe/codeonly-unit.mjs
import { codeOnly, referencesName, identsOf, topLevelDecls, localBindings, shadowCoversAll } from './_codeonly.mjs';

let bad = 0;
function eq(label, got, want){
  const ok = Object.is(got, want);
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

console.log('── ① codeOnly：注释 / 字符串字面量挖空，模板串里的 ${} 保留 ──');
eq('// 注释不算代码',   codeOnly('a; // bbb\nc;').includes('bbb'), false);
eq('/* */ 不算代码',    codeOnly('a; /* bbb */ c;').includes('bbb'), false);
eq('单引号串挖空',      codeOnly("f('hello')").includes('hello'), false);
eq('模板串字面挖空',    codeOnly('`hello ${x}`').includes('hello'), false);
eq('模板串 ${} 保留',   codeOnly('`hello ${x}`').includes('${x}'), true);
eq('保长（下标对齐）',  codeOnly('a; /* b */ c;').length, 'a; /* b */ c;'.length);

console.log('── ② referencesName：标识符边界（`$` 不是词字符，不能用 \\b）──');
eq('$ 开头的名字能匹配',   referencesName('return $解码器.x;', '$解码器'), true);
eq('属性访问不算引用',      referencesName('return a.$解码器;', '$解码器'), false);
eq('子串不算引用',          referencesName('const $解码器X = 1;', '$解码器'), false);
eq('中文名能匹配',          referencesName('return 解码器.x;', '解码器'), true);
eq('普通名字能匹配',        referencesName('rr(0,1)', 'rr'), true);
eq('同名后缀不算',          referencesName('myrr(0,1)', 'rr'), false);
eq('对象字面量的键不算',    referencesName('const o = { sun: 1 };', 'sun'), false);
eq('简写属性值算引用',      referencesName('const o = { sun };', 'sun'), true);

console.log('── ③ shadowCoversAll：局部声明只有**罩住全部引用**才允许豁免 ──');
/* 真实案例：06-vegetation 里一句函数内的 `const rr = r1 - r2;` 曾给全模块几百处 `rr(a,b)`
   背书 → 漏掉 rr 的 import。判宽就会这样漏。 */
eq('只罩住一部分 → 不豁免',
   shadowCoversAll(codeOnly('function f(){ const rr = 1; return rr; }\nconst x = rr(0,1);'), 'rr'),
   false);
eq('全部引用都在块内 → 豁免',
   shadowCoversAll(codeOnly('function f(){ const rr = 1; return rr + rr; }'), 'rr'),
   true);
/* ⚠️ 契约边界：本函数**只**回答"嵌套局部声明罩没罩住全部引用"。
   顶层声明不归它管（那由调用方先用 topLevelDecls 判掉，见 import-audit 的 visibleNames）——
   这里返回 false 是**正确**的，不是缺陷。 */
eq('顶层声明不由本函数负责 → false',
   shadowCoversAll(codeOnly('const rr = 1;\nfunction f(){ return rr; }\nconst y = rr;'), 'rr'),
   false);

console.log('── ④ topLevelDecls / localBindings ──');
eq('顶层声明只收列 0',
   topLevelDecls('const a = 1;\nfunction f(){\n  const b = 2;\n}').map(d => d.name).join(','),
   'a,f');
eq('局部绑定收形参',
   localBindings('function f(x, y){ const z = 1; }').has('z'), true);
eq('局部绑定收解构',
   localBindings('const { p, q } = o;').has('q'), true);
eq('identsOf 含 $ 名字',
   identsOf('let y = $foo + 1;').has('$foo'), true);
eq('identsOf 排除属性名',
   identsOf('a.b.c;').has('b'), false);

if (bad){
  console.error(`\ncodeonly-unit: FAILED（${bad} 条不符）`);
  process.exit(1);
}
console.log('\ncodeonly-unit: PASS（共享语法判定契约全部符合）');
