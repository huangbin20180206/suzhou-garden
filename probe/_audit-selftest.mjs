// import-audit 的负例自检（2026-10-02 加）：把 11-loop 里的别名 import 故意改坏，
// 确认 ② 段的"缺 import"判据**真的会报红**——修既存红门时最怕的就是把门修成永远绿的。
// 用法: node probe/_audit-selftest.mjs   （临时把别名拆掉→跑 audit→还原；报告红/绿）
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = path.join(ROOT, 'src', '11-loop.js');
const ORIG = fs.readFileSync(P, 'utf8');

/* 负例：把 `aggregate as preloadAggregate, describe as preloadDescribe` 换成直接用原名 ——
   这在运行期会炸（preloadAggregate 未定义），而 audit 的 ② 段如果只有别名感知修对了，
   这里应当不再误报；真正的"缺 import"负例是把 import 里的一个真用名删掉。 */
const BROKEN = ORIG.replace('aggregate as preloadAggregate, describe as preloadDescribe', 'aggregate, describe');
if (BROKEN === ORIG){ console.error('自检：没找到目标 import 片段（代码已变？）'); process.exit(2); }

const run = () => spawnSync(process.execPath, [path.join(ROOT, 'probe', 'import-audit.mjs')],
                            { encoding: 'utf8' });

let ok = true;
try {
  /* ① 正例（当前代码）：必须 PASS */
  const r1 = run();
  ok &= r1.status === 0;
  console.log((r1.status === 0 ? '✓' : '✗') + ' 当前代码 import-audit 应 PASS —— ' + (r1.status === 0 ? 'PASS' : 'FAIL:\n' + r1.stdout + r1.stderr));

  /* ② 负例 A：把别名改回原名 ⇒ 运行期 11-loop 里 preloadAggregate/preloadDescribe 未定义。
        audit 的 ④ 段（不得引用内联专有名）抓不到这种"本模块内"的名字，② 段按导出名比对
        也抓不到 ⇒ 这是**已知盲区**，不是本门的职责（真炸会由 smoke/pageerror 兜住）。
        所以负例 A 期望仍是 PASS —— 但要打印出来让人知道这个盲区存在。 */
  fs.writeFileSync(P, BROKEN);
  const r2 = run();
  console.log((r2.status === 0 ? '·' : '✗') + ' 负例A（别名改回原名，运行期会炸）audit 仍 PASS —— 已知盲区，由 smoke/pageerror 兜底，不属本门');

  /* ③ 负例 B：真缺 import —— 删掉一个真的被用到的导入名，② 段必须报红。 */
  const BROKEN2 = ORIG.replace('import { preloadPhase, aggregate as preloadAggregate,', 'import { aggregate as preloadAggregate,');
  if (BROKEN2 === ORIG){ console.error('自检：没找到 preloadPhase 片段'); process.exit(2); }
  fs.writeFileSync(P, BROKEN2);
  const r3 = run();
  const caught = r3.status !== 0 && /preloadPhase/.test(r3.stdout + r3.stderr);
  ok &= caught;
  console.log((caught ? '✓' : '✗') + ' 负例B（删掉真被使用的 import 名）必须报红 —— '
               + (caught ? '报红 ✓ 有牙' : '没报红 ⇒ 门是假的！\n' + (r3.stdout + r3.stderr).slice(0, 400)));

  /* ④ 负例 C（2026-10-05 加，对应新增的 ⑤ 段）：import 一个**对面没导出**的名字。
     这是"整页白屏"那一类：ESM 解析 import 就失败 ⇒ 模块图加载不起来、页面永远停在加载页，
     而 npm run check / ①②③④ 全都看不见。实测拆灯会时踩到（applyFestivalTo 忘 export）。 */
  const BROKEN3 = ORIG.replace('import { tickLightning, LIGHTNING, lightningStrikeNow,',
                               'import { tickLightning, LIGHTNING, lightningStrikeNow, bogusNameForSelftest,');
  if (BROKEN3 === ORIG){ console.error('自检：没找到 tickLightning 片段（代码已变？）'); process.exit(2); }
  fs.writeFileSync(P, BROKEN3);
  const r4 = run();
  const caught2 = r4.status !== 0 && /bogusNameForSelftest/.test(r4.stdout + r4.stderr);
  ok &= caught2;
  console.log((caught2 ? '✓' : '✗') + ' 负例C（import 了对面没导出的名字）必须报红 —— '
               + (caught2 ? '报红 ✓ 有牙' : '没报红 ⇒ ⑤ 段是假的！\n' + (r4.stdout + r4.stderr).slice(0, 400)));
} finally {
  fs.writeFileSync(P, ORIG);      // 无论中途怎么炸都还原
}
process.exit(ok ? 0 : 1);
