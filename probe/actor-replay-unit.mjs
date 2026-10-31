// 到访导演层重播回归网（2026-10-31）：node:test，纯 node，不起浏览器。
// 用 probe/_actor-sim 的仿真器（桩掉场景/GLB、假骨架）重跑整场，与入库基线**逐帧**比对：
//   · carriage-2：马车版首场 → done → 冷却 45s → resetVisit → 重播一场 → 第二次 done
//   · walk-1：步行版（?visit=walk）一场到 done
//   以上两份带 `?etiquette=0` 跑（礼仪三段全关）—— 2026-10-31 加礼仪之前录的，**一帧都不许变**。
//   · carriage-rite：马车版、礼仪三段全开（产品默认）两场；另断"开礼仪比关礼仪到 done 多 60–90s"。
// 每 0.4s 一帧，帧 = 导演层（VISIT/VISCAR/车）+ 全部演员的位置/朝向/权重/踏面/骨骼校验和。
// 为什么：改相位机（礼仪相位、走回原位）之前先锁住现状 —— 任何行为变化都会在这里报出首个不同帧。
// 有意改行为时重录基线：ACTOR_SIM_RECORD=1 node --test probe/actor-replay-unit.mjs（提交说明里写清为什么变）。
//   只重录其中一份：ACTOR_SIM_RECORD=carriage-rite（逗号分隔多份）；其余用例照常比对。
// 耗时：全量约 13s（三进程并行，远低于 60s ⇒ 默认就跑全量，不设 ACTOR_SIM_FULL 截断开关）。
//   ACTOR_SIM_STEPS=N 只比前 N 帧（调试时快速看开头）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readRun, writeRunGz, diffRuns } from './_actor-sim/compare.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIM = path.join(ROOT, 'probe/_actor-sim');
const BASE = path.join(SIM, 'baseline');
const REC_ENV = process.env.ACTOR_SIM_RECORD || '';
const recording = (name) => REC_ENV === '1' || REC_ENV.split(',').includes(name);
const STEPS = +(process.env.ACTOR_SIM_STEPS || 0);
const CASES = [{ name: 'carriage-2', mode: 'carriage', visits: 2 }, { name: 'walk-1', mode: 'walk', visits: 1 },
               { name: 'carriage-rite', mode: 'carriage-rite', visits: 2 }];
/* 礼仪三段合计让首场到 done 推迟的窗口（任务口径 60–90s；2026-10-31 录基线时实测 +76.0s） */
const RITE_DELAY = [60, 90];

const src = fs.readFileSync(path.join(ROOT, 'src/16-actors.js'), 'utf8');
const PHASES = new Function('return ' + src.match(/export const VISIT_PHASES = Object\.freeze\((\[[\s\S]*?\])\);/)[1])();

async function simulate(c){
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'actor-sim-')), c.name + '.json');
  const args = ['--import', './probe/_actor-sim/register.mjs', 'probe/_actor-sim/sim.mjs', c.mode, String(c.visits), out];
  if (STEPS && !recording(c.name)) args.push(String(STEPS));
  await run(process.execPath, args, { cwd: ROOT, maxBuffer: 1 << 24 });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return r;
}

const runs = Object.fromEntries(CASES.map(c => [c.name, simulate(c)]));      // 三进程并行

for (const c of CASES){
  test('重播回归网 ' + c.name + '：与基线逐帧一致', async () => {
    const r = await runs[c.name];
    const file = path.join(BASE, c.name + '.json.gz');
    if (recording(c.name)){ fs.mkdirSync(BASE, { recursive: true }); writeRunGz(file, r); return; }
    assert.ok(fs.existsSync(file), '缺基线 ' + file + '（ACTOR_SIM_RECORD=1 录一份）');
    let B = readRun(file);
    assert.equal(r.mode, B.mode, '模式');
    if (STEPS) B = { ...B, frames: B.frames.slice(0, r.frames.length) };
    else assert.equal(r.doneAt.length, c.visits, '应跑满 ' + c.visits + ' 场');
    const d = diffRuns(B, r);
    assert.equal(d, null, d || '');
    /* 走过的相位都在声明表里（与 visit-carriage-guard ①f 的静态判据互补：这条是运行期） */
    for (const [, p] of r.phases) assert.ok(PHASES.includes(p), '未声明的相位 ' + p);
  });
}

test('礼仪三段：开启时首场到 done 比全关晚 60–90s，且三段的相位都走到', async () => {
  if (STEPS) return;                                 // 截断模式下没有 done 可比
  const off = await runs['carriage-2'], on = await runs['carriage-rite'];
  assert.equal(off.etiquette, false); assert.equal(on.etiquette, true);
  const d = +(on.doneAt[0] - off.doneAt[0]).toFixed(1);
  assert.ok(d >= RITE_DELAY[0] && d <= RITE_DELAY[1], '推迟 ' + d + 's（关 ' + off.doneAt[0] + ' / 开 ' + on.doneAt[0] + '）');
  const names = on.phases.map(p => p[1]);
  for (const need of ['await', 'usher', 'announce', 'serve', 'offer']) assert.ok(names.includes(need), '缺相位 ' + need);
  assert.ok(on.cars.some(c => c[1] === 'take'), '马车子状态缺 take（马夫接马）');
  for (const need of ['await', 'usher', 'announce', 'serve', 'offer'])
    assert.ok(!off.phases.some(p => p[1] === need), '全关时不该出现 ' + need);
});
