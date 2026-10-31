// 到访导演层重播回归网（2026-10-31）：node:test，纯 node，不起浏览器。
// 用 probe/_actor-sim 的仿真器（桩掉场景/GLB、假骨架）重跑整场，与入库基线**逐帧**比对：
//   · carriage-2：马车版首场 → done → 冷却 45s → resetVisit → 重播一场 → 第二次 done
//   · walk-1：步行版（?visit=walk）一场到 done
//   以上两份带 `?etiquette=0` 跑（礼仪三段全关）—— 2026-10-31 加礼仪之前录的，**一帧都不许变**。
//   · carriage-rite：马车版、礼仪三段全开两场；另断"开礼仪比关礼仪到 done 多 60–90s"。
//   以上三份另带 `?walkback=0`（旧的"冷却到点直接瞬移"复位）—— 走回去是后加的，原基线一帧都不许变。
//   · carriage-walkback：产品默认（礼仪全开 + 走回去），相机在开机机位，两场；另断冷却复位期间
//     可见演员单帧水平位移 ≤0.5m（兜底瞬移除外，次数取自 VISIT.homeSnaps）、第二场相位链与首场一致。
// 每 0.4s 一帧，帧 = 导演层（VISIT/VISCAR/车）+ 全部演员的位置/朝向/权重/踏面/骨骼校验和。
// 为什么：改相位机（礼仪相位、走回原位）之前先锁住现状 —— 任何行为变化都会在这里报出首个不同帧。
// 有意改行为时重录基线：ACTOR_SIM_RECORD=1 node --test probe/actor-replay-unit.mjs（提交说明里写清为什么变）。
//   只重录其中一份：ACTOR_SIM_RECORD=carriage-rite（逗号分隔多份）；其余用例照常比对。
// 耗时：全量约 13s（四进程并行，远低于 60s ⇒ 默认就跑全量，不设 ACTOR_SIM_FULL 截断开关）。
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
               { name: 'carriage-rite', mode: 'carriage-rite', visits: 2 },
               { name: 'carriage-walkback', mode: 'carriage-walkback', visits: 2 }];
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

const runs = Object.fromEntries(CASES.map(c => [c.name, simulate(c)]));      // 四进程并行

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

/* 走回去（2026-10-31 · b4-walk）：冷却复位期间（done→homing→idle 的每一帧）不许有可见的"闪回"。
   ⚠️ 只量**水平**位移：y 跟踪踏面射线，仿真桩里的台基/桥是没有台阶的方盒，踩上去 y 一帧跳 1.3m，
      正常演出段（门房去岗位、主人上桥）同样如此 —— 那是桩的几何，不是瞬移。
   帧串格式见 sim.mjs snapshot：导演层 12 段，之后每位演员 19 段（id,x,z,y,…,第 10 段 visible）。 */
const WB_STEP_MAX = 0.5;
test('走回去：冷却复位期间可见演员单帧水平位移 ≤0.5m（兜底瞬移除外），第二场正常开演', async () => {
  if (STEPS) return;
  const r = await runs['carriage-walkback'], ref = await runs['carriage-rite'];
  assert.ok(r.walkback, '缺走回去统计（VISIT.homeLog）');
  const walks = r.walkback.log.filter(e => e.t !== undefined), snaps = r.walkback.snaps;
  assert.ok(walks.length >= 3 && walks.every(e => e.ok), '主人 + 两书童都应步行到位：' + JSON.stringify(r.walkback.log));
  let big = 0, worst = 0, homingFrames = 0;
  for (let i = 1; i < r.frames.length; i++){
    const a = r.frames[i - 1].split('|'), b = r.frames[i].split('|');
    if (b[0] === 'homing') homingFrames++;
    if (!(a[0] === 'homing' || b[0] === 'homing' || (a[0] === 'done' && b[0] === 'idle'))) continue;
    for (let k = 12; k + 19 <= b.length && b[k] !== 'rite'; k += 19){
      if (a[k] !== b[k] || a[k + 10] !== 'true' || b[k + 10] !== 'true') continue;
      const d = Math.hypot(b[k + 1] - a[k + 1], b[k + 2] - a[k + 2]);
      worst = Math.max(worst, d);
      if (d > WB_STEP_MAX) big++;
    }
  }
  assert.ok(homingFrames > 10, 'homing 相位只有 ' + homingFrames + ' 帧（没走起来？）');
  assert.ok(big <= snaps, '单帧 >' + WB_STEP_MAX + 'm 的可见位移 ' + big + ' 次，兜底瞬移只记了 ' + snaps + ' 次（最大 ' + worst.toFixed(3) + 'm）');
  assert.equal(snaps, 0, '开机机位下不该有兜底瞬移：' + JSON.stringify(r.walkback.log));
  /* 第二场：相位链与首场一模一样（homing 只插在两场之间），且比旧瞬移复位晚开演的秒数 = homing 时长 */
  assert.equal(r.doneAt.length, 2, '应跑满两场');
  const names = r.phases.map(p => p[1]), h = names.indexOf('homing');
  assert.ok(h > 0 && names[h - 1] === 'done' && names[h + 1] === 'idle', '相位链：done → homing → idle');
  const first = names.slice(0, names.indexOf('done') + 1), second = names.slice(h + 1);
  assert.deepEqual(second, first, '第二场相位链应与首场一致');
  const tH = r.phases[h][0], tI = r.phases[h + 1][0];
  const car2 = r.phases.filter(p => p[1] === 'carIn')[1][0], car2Ref = ref.phases.filter(p => p[1] === 'carIn')[1][0];
  assert.ok(Math.abs((car2 - car2Ref) - (tI - tH)) < 0.81, '第二场开演推迟 ' + (car2 - car2Ref).toFixed(1) + 's ≠ homing ' + (tI - tH).toFixed(1) + 's');
});
