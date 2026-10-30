// 门数一致性门禁（纯 node / 读文本 / <0.3s / 2026-10-30 · 第 0 周热修 CI 收尾④）
//
// ── 为什么要有这一门 ──────────────────────────────────────────────────────
// `README.md` 里至少 5 处写着"全部 N 道门"，而 N 的真值只有一处：
// `probe/verify-all.mjs` 的 `SUITES.length`。两者之间**从来没有任何东西把它们钉在一起**，
// 于是 README 一路漂：77 → 79 → 81 → 84 …（verify-all.mjs 自己的头部注释都写着
// "这份注释已经漂过三次：30 → 实际 54"）。实测 2026-10-30：SUITES 已经 **88 道**，
// README 还在说 84。
//
// 这类漂移的危害不是"文档不好看"，而是**它会骗人做决策**：
//   · 交接文档按 README 的 84 道估时间 ⇒ 低估；
//   · 有人说"75 道都过了怎么还红" ⇒ 因为真值根本不是 75；
//   · 更糟的是反向：README 说 84、实际 88，那**少跑的那 4 道**没人知道是哪 4 道。
//
// ── 判据 ────────────────────────────────────────────────────────────────
//   C1 全量门数：README 里所有「N 道门」的 N 必须等于 SUITES.length
//   C2 quick 门数：README 里所有「verify:quick = N」「现在 N 道」（quick 语境）必须等于 QUICK.size
//   C3 探针文件数：「探针 M 个 .mjs」的 M 必须等于 probe/*.mjs 实际个数（±0）
//   C4 自检：把真值 +1 喂进去必须报红（探针自证判据有牙）
//
// ⚠️ 边界（如实声明）：本门只判**数字**，不判文字描述是否还准确
//    （"门禁表下面那张表也不是全量"这种陈述它管不着）。
// ⚠️ 只认这几种**明确指代总数**的写法，避免把"3 道门""6 项断言"这类局部数字误判：
//      「全部 88 道门」「84 道门」「**84 道**」「verify:quick = 12」「12 道快门」「探针 85 个 .mjs」
//    —— 其余的「N 道」一律不管（那是子集口径，强行统一只会逼着人去写废话）。
// 用法: node probe/gate-count-sync.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── 真值来源一：SUITES / QUICK（**只读文本解析**，不 import —— import 会触发顶层副作用）── */
function parseList(src, name, closer){
  const re = new RegExp(`const\\s+${name}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\n\\]${closer}`);
  const m = src.match(re);
  if (!m) throw new Error(`verify-all.mjs 里解析不到 \`const ${name} = [...]\`（拒绝以「空清单」继续）`);
  return [...m[1].matchAll(/'(probe\/[^']+)'/g)].map(x => x[1]);
}

function collect(){
  const vaSrc = fs.readFileSync(path.join(ROOT, 'probe', 'verify-all.mjs'), 'utf8');
  const suites = parseList(vaSrc, 'SUITES', '');
  const quick = parseList(vaSrc, 'QUICK', '\\)');
  const probeCount = fs.readdirSync(path.join(ROOT, 'probe')).filter(f => f.endsWith('.mjs')).length;
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  return { suites, quick, probeCount, readme };
}

/* ── 判据纯函数：入参是四份材料，出参是 checks[]（便于自检喂变异副本） ── */
function audit({ suites, quick, probeCount, readme , truth }){
  const T = truth || { suites: suites.length, quick: quick.length, probeCount };
  const checks = [];
  const ck = (name, ok, detail) => checks.push({ name, ok, detail });

  /* C1：README 里所有「N 道门」。
     ⚠️ 排除 N=0：README 里「拒绝以『0 道门全绿』收场」是在讲**错误用法**，不是总数
        （那是唯一合法出现的 0，写成别的意思就该被人看见了）。 */
  const totalHits = [...readme.matchAll(/(\*\*)?(\d+)\s*道门(\*\*)?/g)].filter(m => Number(m[2]) !== 0);
  const badTotal = totalHits.filter(m => Number(m[2]) !== T.suites);
  ck(`C1 全量门数：README 的「N 道门」全部等于 SUITES.length（${T.suites}）`,
     badTotal.length === 0,
     badTotal.length
       ? `${badTotal.length} 处不符：${badTotal.map(m => `「${m[0].replace(/\*/g, '')}」`).join('、')}`
       : `${totalHits.length} 处提及全部一致（${T.suites} 道）`);

  /* C2：quick 门数。认两种写法：`verify:quick` = N  /  「现在 **N 道**」 */
  const quickHits = [
    ...[...readme.matchAll(/verify:quick`?\s*=\s*(\d+)/g)].map(m => ({ raw: m[0], n: Number(m[1]) })),
    ...[...readme.matchAll(/现在\s*\*\*(\d+)\s*道\*\*/g)].map(m => ({ raw: m[0], n: Number(m[1]) })),
  ];
  const badQuick = quickHits.filter(h => h.n !== T.quick);
  ck(`C2 quick 门数：README 的 quick 口径全部等于 QUICK.size（${T.quick}）`,
     badQuick.length === 0,
     badQuick.length
       ? `${badQuick.length} 处不符：${badQuick.map(h => `「${h.raw}」`).join('、')}`
       : `${quickHits.length} 处提及全部一致（${T.quick} 道）`);

  /* C3：探针文件数 */
  const probeHits = [...readme.matchAll(/探针\s*(\d+)\s*个\s*\.mjs/g)];
  const badProbe = probeHits.filter(m => Number(m[1]) !== T.probeCount);
  ck(`C3 探针文件数：README 的「探针 N 个 .mjs」等于磁盘实际（${T.probeCount}）`,
     badProbe.length === 0,
     badProbe.length
       ? `${badProbe.length} 处不符：${badProbe.map(m => `「${m[0]}」`).join('、')}`
       : `${probeHits.length} 处提及全部一致（${T.probeCount} 个）`);

  /* C1b：解析层自证 —— SUITES 里每一条都得是磁盘上真实存在的文件。
     没有这一条的话，门名改成笔误会让 verify-all 静默少跑一道（它不检查存在性，只 spawn）。 */
  const missing = suites.filter(p => !fs.existsSync(path.join(ROOT, p)));
  ck('C1b SUITES 每一条都在磁盘上（门名笔误 ⇒ verify-all 只会静默少跑一道）',
     missing.length === 0,
     missing.length ? `${missing.length} 条不存在：${missing.join('、')}` : `${suites.length} 条全部存在`);

  return checks;
}

/* ── 自检：判据有牙 ────────────────────────────────────────────────────── */
function selfcheck(base){
  const fails = [];
  const pick = (c, k) => c.find(x => x.name.startsWith(k));

  /* 变异 A：真值 +1（= verify-all 加了一道门、README 没跟）⇒ C1 必须红 */
  const rA = pick(audit({ ...base, truth: { suites: base.suites.length + 1, quick: base.quick.length, probeCount: base.probeCount } }), 'C1');
  if (!rA || rA.ok) fails.push('变异 A（真值 +1）竟未让 C1 报红 —— 判据没牙');
  else console.log(`  ✓ 负例 A：门数 +1 而 README 没跟 ⇒ C1 报红 — ${rA.detail}`);

  /* 变异 A2：真值 -3（= README 比实际多报）⇒ C1 也必须红（两个方向都要抓） */
  const rA2 = pick(audit({ ...base, truth: { suites: base.suites.length - 3, quick: base.quick.length, probeCount: base.probeCount } }), 'C1');
  if (!rA2 || rA2.ok) fails.push('变异 A2（真值 -3）竟未让 C1 报红 —— 只抓一个方向的漂移等于没抓');
  else console.log(`  ✓ 负例 A2：README 比实际多报 3 道 ⇒ C1 报红 — ${rA2.detail}`);

  /* 变异 B：quick 真值 +1 ⇒ C2 必须红 */
  const rB = pick(audit({ ...base, truth: { suites: base.suites.length, quick: base.quick.length + 1, probeCount: base.probeCount } }), 'C2');
  if (!rB || rB.ok) fails.push('变异 B（quick 真值 +1）竟未让 C2 报红 —— 判据没牙');
  else console.log(`  ✓ 负例 B：quick 门数 +1 而 README 没跟 ⇒ C2 报红 — ${rB.detail}`);

  /* 变异 C：SUITES 里塞一条不存在的门名 ⇒ C1b 必须红 */
  const rC = pick(audit({ ...base, suites: [...base.suites, 'probe/no-such-gate.mjs'],
                          truth: { suites: base.suites.length + 1, quick: base.quick.length, probeCount: base.probeCount } }), 'C1b');
  if (!rC || rC.ok) fails.push('变异 C（塞一条不存在的门名）竟未让 C1b 报红 —— 判据没牙');
  else console.log(`  ✓ 负例 C：SUITES 里写错一个门名 ⇒ C1b 报红 — ${rC.detail}`);

  const rOk = audit(base);
  const redOnClean = rOk.filter(c => !c.ok);
  if (redOnClean.length) fails.push(`阳性对照失败：未变异的输入不该红，却红了 ${redOnClean.length} 项（${redOnClean.map(c => c.name.split('：')[0]).join('、')}）`);
  else console.log(`  ✓ 阳性对照：未变异的输入 ${rOk.length} 项全绿`);

  console.log(`\n[gate-count-sync] 自检 ${fails.length === 0 ? 'ALL PASS' : 'FAILED'}（3 变异 + 1 阳性对照）`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  return fails.length === 0;
}

const SELF_ONLY = process.argv.includes('--selfcheck');
let base = null, checks = [];
try {
  base = collect();
  checks = audit(base);
} catch (e){
  checks = [{ name: '头部：材料采集', ok: false, detail: e.message }];
}

if (!SELF_ONLY){
  console.log('  ── 门数一致性（README ↔ verify-all SUITES/QUICK ↔ 磁盘）──');
  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  console.log('\n  ── 负例自检（探针自证能红）──');
}
const selfOk = base ? selfcheck(base) : (console.log('  ✗ 材料采集失败，自检无法进行'), false);

if (SELF_ONLY){
  process.exit(selfOk ? 0 : 1);
}
const red = checks.filter(c => !c.ok);
console.log(`\n[gate-count-sync] ${red.length === 0 && selfOk ? 'ALL PASS' : red.length + ' FAILED'}（${checks.length} 项判据 + 自检 ${selfOk ? 'PASS' : 'FAILED'}）`);
if (red.length){
  console.log('  ⚠️ 修法：以 `probe/verify-all.mjs` 的 SUITES/QUICK 为**唯一真值**，改 README 的数字去对齐它 ——');
  console.log('     反过来（改 SUITES 去凑 README）等于删门禁，绝对不要。');
}
process.exit(red.length === 0 && selfOk ? 0 : 1);
