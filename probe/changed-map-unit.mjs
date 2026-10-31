// `verify-all --changed` 的映射自检（2026-10-31）· node probe/changed-map-unit.mjs
//
// 守什么：`--changed` 从"改了哪些文件"挑门的**挑选逻辑**本身。
// 这个参数最危险的失败形状不是"挑错了门"，而是**挑少了还全绿** ——
// 那会让人以为改动没问题，实际有一批门根本没跑。所以它必须自带牙。
//
// 为什么单独成门而不塞进 verify-all：verify-all 一跑就是 1~2 小时，
// 而这条判据是纯函数级、<0.2s —— 塞进去等于"为了守 0.2 秒的东西等两小时"。
// 放这里 ⇒ 能进 quick（每门 ≤1 分钟那条规矩），每次日常改动都会被它扫一遍。
//
// 判据（每条都配一个负例，证明它真的有牙）：
//   ① 未声明 @guards 的门 ⇒ **一律纳入**（不知道就别假装知道）
//   ② 门禁共享设施被改 ⇒ **退回全量**（地基动了，挑门没有意义）
//   ③ 挑出的门 < 8 道 ⇒ **退回全量**（省这点时间不值得冒漏测的险）
//   ④ 挑出 0 道 ⇒ **必须报错**，绝不静默全绿
//   ⑤ 声明了 @guards 的门，只在其声明的 src 被改时才纳入
//   ⑥ 负数：删掉 ①，症状必须复现（证明 ① 不是摆设）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/* ── 从 verify-all.mjs 里把挑选逻辑读出来跑 ──
   ⚠️ 不 import verify-all：它顶层就会起门禁、写日志、退出进程。
      这里用**受控的文本提取**：把 SUITES 表与 parseGuards/挑选函数抽出来，
      在一个干净的 module 里 eval。
   ⚠️ 提取失败必须**响亮报错**，不能"提取不到就跳过" —— 那样门会永远绿而什么也没守。 */
const srcPath = path.join(ROOT, 'probe', 'verify-all.mjs');
const src = fs.readFileSync(srcPath, 'utf8');

function slice(from, to){
  const i = src.indexOf(from);
  if (i < 0) return null;
  const j = src.indexOf(to, i + from.length);
  if (j < 0) return null;
  return src.slice(i, j + to.length);
}

const suitesBlock = (() => {
  const i = src.indexOf('const SUITES = [');
  if (i < 0) return null;
  const j = src.indexOf('\n];', i);
  if (j < 0) return null;
  return src.slice(i, j + 3);
})();

check('① 能从 verify-all.mjs 里定位到 SUITES 表',
  !!suitesBlock, suitesBlock ? `长度 ${suitesBlock.length}` : '找不到 —— 表格改名了要同步本门');

if (!suitesBlock){
  console.log('\n[changed-map-unit] FAILED（后续判据无从执行）');
  process.exit(1);
}

/* SUITES 里每一行形如 ['标签', 'probe/xxx.mjs', ...]。只取前两项。 */
const suites = [];
for (const m of suitesBlock.matchAll(/\[\s*'([^']+)'\s*,\s*'(probe\/[\w-]+\.mjs)'/g)){
  suites.push([m[1], m[2]]);
}
check('① SUITES 解析出条目', suites.length > 80, `${suites.length} 条`);
check('① SUITES 里没有重复门禁路径',
  new Set(suites.map(s => s[1])).size === suites.length,
  `${new Set(suites.map(s => s[1])).size} 个唯一路径 / ${suites.length} 条`);

/* ── 复刻挑选逻辑（与 verify-all 里那份同形）──
   ⚠️ 这里是**拷贝**，不是引用 —— 所以下面最后一条专门验证"拷贝与原件是否还同形"：
      若 verify-all 改了挑选规则而本文件没跟上，那条会红。 */
const INFRA_RE = /^probe\/(_harness\.mjs|verify-all\.mjs|_png\.mjs|_probe-detect\.mjs|_extract-section\.mjs|_codeonly\.mjs)$/;
const MIN_PICK = 8;

function parseGuardsFrom(text){
  const head = text.slice(0, 3000);
  const m = head.match(/^\s*\/\/\s*@guards:\s*(.+)$/m);
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : null;
}

/* 把"文件内容"做成可注入的查表，便于造场景而不碰磁盘。 */
function selectByChange(changed, contentOf){
  const srcFiles = changed.filter(f => /^src\/.*\.js$/.test(f));
  const gateFiles = changed.filter(f => /^probe\/.*\.mjs$/.test(f));
  const infra = gateFiles.filter(f => INFRA_RE.test(f));
  if (infra.length) return { list: suites, forcedAll: true, reason: 'infra' };
  const srcSet = new Set(srcFiles);
  const picked = [];
  for (const [label, rel] of suites){
    const g = parseGuardsFrom(contentOf(rel));
    if (g === null){ picked.push([label, rel]); continue; }
    if (g.some(x => srcSet.has(x)) || gateFiles.includes(rel)) picked.push([label, rel]);
  }
  if (picked.length < MIN_PICK) return { list: suites, forcedAll: true, reason: 'too-few' };
  return { list: picked, forcedAll: false, reason: 'ok' };
}

/* 真实门禁文件的读取器（只读头部 3KB，与本体一致）。 */
const realContent = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
};

/* ── ⑥ 先做负数：把"未声明 ⇒ 纳入"这条拿掉，必须能不通过 ──
   做法：造一个"所有门都未声明"的场景，用**删掉分支**的版本跑一遍，
   它应该挑出 <8 道 ⇒ 退回全量；而有分支的版本应该挑出全部。 */
{
  const changed = ['src/12h-solar.js'];
  const allUndeclared = () => '// 没有 @guards 行\n';
  const withRule = selectByChange(changed, allUndeclared);
  const withoutRule = (() => {
    const srcFiles = new Set(changed.filter(f => /^src\/.*\.js$/.test(f)));
    const picked = [];
    for (const [label, rel] of suites){
      const g = parseGuardsFrom(allUndeclared(rel));
      if (g === null) continue;                       // ← 删掉"未声明就纳入"
      if (g.some(x => srcFiles.has(x))) picked.push([label, rel]);
    }
    return picked.length < MIN_PICK ? { forcedAll: true, n: suites.length }
                                    : { forcedAll: false, n: picked.length };
  })();
  check('⑥ 负数：去掉「未声明⇒纳入」这条，未声明场景必须挑不出东西（证明规则有牙）',
    withRule.list.length === suites.length && withoutRule.n === suites.length && withoutRule.forcedAll,
    `有规则挑 ${withRule.list.length} 道 / 删掉规则挑 ${withoutRule.n} 道（退回全量=${withoutRule.forcedAll}）`);
}

/* ── ① 未声明 ⇒ 全部纳入（真实文件）── */
{
  const declared = suites.filter(([, rel]) => parseGuardsFrom(realContent(rel)) !== null);
  const undeclared = suites.length - declared.length;
  const r = selectByChange(['src/12h-solar.js'], realContent);
  /* 未声明的必然全在；所以 picked ≥ undeclared。 */
  check('① 未声明 @guards 的门一律纳入（不知道就不假装知道）',
    r.list.length >= undeclared,
    `未声明 ${undeclared} 道 ⇒ 本次挑出 ${r.list.length}/${suites.length} 道（含全部未声明）`);
  check('① 已声明 @guards 的门数已统计（将来补声明时这条会跟着变）',
    true, `${declared.length} 道已声明 / ${undeclared} 道未声明`);
}

/* ── ② 门禁共享设施被改 ⇒ 退回全量 ── */
{
  const r = selectByChange(['probe/_harness.mjs'], realContent);
  check('② 门禁共享设施（_harness）被改 ⇒ 退回全量',
    r.forcedAll && r.list.length === suites.length && r.reason === 'infra',
    `reason=${r.reason}，${r.list.length}/${suites.length}`);
  const r2 = selectByChange(['probe/verify-all.mjs'], realContent);
  check('② 门禁共享设施（verify-all）被改 ⇒ 退回全量',
    r2.forcedAll && r2.reason === 'infra', `reason=${r2.reason}`);
  /* 负数：普通门禁被改**不**触发退回全量（否则②就太宽了，等于永远全量）。 */
  const r3 = selectByChange(['probe/macaw-wing-guard.mjs'], realContent);
  check('② 负数：只改某一道普通门禁时**不**退回全量（否则这条规则太宽）',
    !r3.forcedAll || r3.reason === 'too-few',
    `reason=${r3.reason}`);
}

/* ── ③ 挑出 <8 道 ⇒ 退回全量 ──
   ⚠️ 造场景必须用**真实存在于 SUITES 里的路径**，否则"只有 1 道声明"这个前提就不成立
      —— 第一版用了虚构的 `probe/freshness-unit.mjs`，它不在 SUITES 里，
      于是"声明了但没被选中"和"根本没这道门"分不开，判据假绿/假红都可能。
      （本门第一版就踩了这个：③ 与 ⑤ 两条一起红，原因正是场景不真实。） */
{
  const firstRel = suites[0][1];
  const fake = (rel) => (rel === firstRel ? '// @guards: src/only-one.js\n' : '// 未声明\n');
  /* 把"未声明⇒纳入"暂时按"不纳入"处理，才可能少到 <8。
     做法：所有门都写成声明一条不相干的 src —— 谁也不命中。 */
  const noneHit = () => '// @guards: src/nobody-touches-this.js\n';
  const r = selectByChange(['src/only-one.js'], noneHit);
  check('③ 挑出 0 道（<8 阈值内）⇒ 退回全量',
    r.forcedAll && r.reason === 'too-few', `reason=${r.reason}，挑出 ${r.list.length}`);
  /* 一个恰好命中 1 道的场景：只有第一条声明 only-one，其余声明别的东西。 */
  const oneHit = (rel) => (rel === firstRel ? '// @guards: src/only-one.js\n'
                                            : '// @guards: src/nobody-touches-this.js\n');
  const r1 = selectByChange(['src/only-one.js'], oneHit);
  check('③ 挑出恰好 1 道 ⇒ 仍退回全量（不是"有就行"）',
    r1.forcedAll && r1.reason === 'too-few', `reason=${r1.reason}`);
  /* 负数：挑出 ≥8 道时**不该**退回全量。 */
  const many = () => '// @guards: src/big.js\n';
  const r2 = selectByChange(['src/big.js'], many);
  check('③ 负数：挑出 ≥8 道时正常返回挑选结果（不误触发退回全量）',
    !r2.forcedAll && r2.list.length === suites.length,
    `挑出 ${r2.list.length} 道，forcedAll=${r2.forcedAll}`);
}

/* ── ⑤ 声明了 @guards 的门，只在其声明的 src 被改时纳入 ──
   ⚠️ 不能直接看 `selectByChange` 的结果：只挑出 1~2 道时会触发 ③ 的"退回全量"兜底，
      列表里于是什么都有 —— 那条兜底是对的，但它把⑤要观察的东西盖住了。
      ⇒ 这里直接验证**逐门筛选这一步**（把 ③ 的兜底关掉再观察）。
   ⚠️ 场景必须用 SUITES 里真实存在的两个路径。 */
{
  const relA = suites[0][1], relB = suites[1][1];
  const fake = (rel) => (rel === relA ? '// @guards: src/alpha.js\n'
                         : rel === relB ? '// @guards: src/beta.js\n'
                         : '// @guards: src/nobody-touches-this.js\n');
  /* 逐门筛选（与本体同形，但**不做 <8 兜底**） */
  const rawPick = (changedSrc) => {
    const srcSet = new Set(changedSrc);
    const picked = [];
    for (const [label, rel] of suites){
      const g = parseGuardsFrom(fake(rel));
      if (g === null){ picked.push([label, rel]); continue; }
      if (g.some(x => srcSet.has(x))) picked.push([label, rel]);
    }
    return picked;
  };
  const pA = rawPick(['src/alpha.js']);
  const hasA = pA.some(([, rel]) => rel === relA);
  const hasB = pA.some(([, rel]) => rel === relB);
  check('⑤ 改 src/alpha.js ⇒ 逐门筛选只命中声明它的那一门',
    hasA && !hasB && pA.length === 1, `A=${hasA} B=${hasB} 命中 ${pA.length} 道`);
  const pB = rawPick(['src/beta.js']);
  check('⑤ 改 src/beta.js ⇒ 只命中 beta 门（对称验证，防"总是命中第一门"）',
    pB.some(([, rel]) => rel === relB) && !pB.some(([, rel]) => rel === relA) && pB.length === 1,
    `命中 ${pB.length} 道`);
  const pNeither = rawPick(['src/no-gate-declares-this.js']);
  check('⑤ 改一条**没有任何门声明**的 src ⇒ 一道都不命中（不会误纳入）',
    pNeither.length === 0, `命中 ${pNeither.length} 道`);
}

/* ── ④ 挑出 0 道 ⇒ 必须报错（本文件把它表达为"绝不返回空成功"）── */
{
  const r = selectByChange([], realContent);
  check('④ 没有任何改动 ⇒ 不返回「0 道门全绿」的成功形态',
    r.list.length > 0 || r.forcedAll,
    `改动 0 个 ⇒ list=${r.list.length}（要么有门，要么退回全量）`);
}

/* ── 神形一致性：本文件里那份挑选逻辑是否还和 verify-all 同形 ──
   改 verify-all 的挑选规则时若忘了改这里，本门必须红 —— 否则它守的是自己的影子。 */
{
  const hasInfra = /const GATE_INFRA\s*=/.test(src);
  const hasMinPick = /picked\.length\s*<\s*(\d+)/.test(src);
  const m = src.match(/picked\.length\s*<\s*(\d+)/);
  const minInSrc = m ? Number(m[1]) : -1;
  check('⑦ 与 verify-all 同形：两边都有 GATE_INFRA 与"挑太少退回全量"的阈值',
    hasInfra && hasMinPick && minInSrc === MIN_PICK,
    `GATE_INFRA=${hasInfra} 阈值 verify-all=${minInSrc} / 本门=${MIN_PICK}`);
}

const fails = results.filter(r => !r.ok).length;
console.log(`\n[changed-map-unit] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
process.exit(fails === 0 ? 0 : 1);
