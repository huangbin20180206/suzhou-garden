// 到访导演层重播回归网（2026-10-31）：node:test，纯 node，不起浏览器。
// 用 probe/_actor-sim 的仿真器（桩掉场景/GLB、假骨架）重跑整场，与入库基线**逐帧**比对：
//   · carriage-2：马车版首场 → done → 冷却 45s → resetVisit → 重播一场 → 第二次 done
//   · walk-1：步行版（?visit=walk）一场到 done
// 每 0.4s 一帧，帧 = 导演层（VISIT/VISCAR/车）+ 全部演员的位置/朝向/权重/踏面/骨骼校验和。
// 为什么：改相位机（礼仪相位、走回原位）之前先锁住现状 —— 任何行为变化都会在这里报出首个不同帧。
// 有意改行为时重录基线：ACTOR_SIM_RECORD=1 node --test probe/actor-replay-unit.mjs（提交说明里写清为什么变）。
// 耗时：全量约 13s（两进程并行，远低于 60s ⇒ 默认就跑全量，不设 ACTOR_SIM_FULL 截断开关）。
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
const RECORD = process.env.ACTOR_SIM_RECORD === '1';
const STEPS = +(process.env.ACTOR_SIM_STEPS || 0);
const CASES = [{ name: 'carriage-2', mode: 'carriage', visits: 2 }, { name: 'walk-1', mode: 'walk', visits: 1 }];

const src = fs.readFileSync(path.join(ROOT, 'src/16-actors.js'), 'utf8');
const PHASES = new Function('return ' + src.match(/export const VISIT_PHASES = Object\.freeze\((\[[\s\S]*?\])\);/)[1])();

async function simulate(c){
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'actor-sim-')), c.name + '.json');
  const args = ['--import', './probe/_actor-sim/register.mjs', 'probe/_actor-sim/sim.mjs', c.mode, String(c.visits), out];
  if (STEPS && !RECORD) args.push(String(STEPS));
  await run(process.execPath, args, { cwd: ROOT, maxBuffer: 1 << 24 });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return r;
}

const runs = Object.fromEntries(CASES.map(c => [c.name, simulate(c)]));      // 两进程并行

for (const c of CASES){
  test('重播回归网 ' + c.name + '：与基线逐帧一致', async () => {
    const r = await runs[c.name];
    const file = path.join(BASE, c.name + '.json.gz');
    if (RECORD){ fs.mkdirSync(BASE, { recursive: true }); writeRunGz(file, r); return; }
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
