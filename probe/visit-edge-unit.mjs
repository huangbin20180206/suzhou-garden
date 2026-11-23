// 到访导演层边界单测（2026-11-24 · 批次 3）：node:test，纯 node，不起浏览器。
// 每个场景一个子进程（到访模式在 16-actors 模块求值期读 location.search ⇒ 一进程一模式），
// 驱动脚本见 probe/_actor-sim/edge.mjs。守三件查实过的事：
//   ① 看门狗在 pair / tour（步行版 epair）中途复位后，pairDrive 残留 ⇒ 下一场主人在 gwalk 一步不动、永久卡死
//      —— 四种模式（含 ?etiquette=0、?walkback=0 组合）都要能在一场时长内再走到 done；
//   ② 步行模式（第一人称）玩家站在路线上：人物让行，不从相机里穿过；玩家一直不让也不卡死演出；
//   ③ 主人已在琴边听琴时入夜：抚琴人随戏可见，不留主人对着空凳；
//   另锁一条没出问题的：走回去途中入夜 / 复亮，步行者不发生可见跳位、走回去照常完成。
// 运行：node --test probe/visit-edge-unit.mjs（约 20~40s，场景并行）
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 并发上限 = CPU 数（至少 2）：每个子进程是单线程仿真 */
const MAX = Math.max(2, Math.min(8, os.cpus().length));
let active = 0; const queue = [];
function edge(...args){
  return new Promise((resolve, reject) => {
    const go = () => {
      active++;
      run(process.execPath, ['--import', './probe/_actor-sim/register.mjs', 'probe/_actor-sim/edge.mjs', ...args.map(String)],
          { cwd: ROOT, maxBuffer: 1 << 24 })
        .then(r => resolve(JSON.parse(r.stdout.trim().split('\n').pop())), reject)
        .finally(() => { active--; if (queue.length) queue.shift()(); });
    };
    if (active < MAX) go(); else queue.push(go);
  });
}

/* ① 中途复位：一场正常时长（仿真）马车版 ≈378s、步行版 ≈220s；给 1.3 倍余量 */
/* 四种模式各至少一例，pair / tour（epair）两种 pairDrive 段都覆盖；offer = 礼仪道具在手的中途 */
const ABORT = [
  ['carriage', 'tour', 500], ['carriage-rite', 'pair', 500],
  ['carriage-walkback', 'tour', 500], ['carriage-walkback', 'offer', 500],
  ['walk', 'epair', 300],
];
const abortRuns = ABORT.map(([m, p]) => edge(m, 'abort', p));
ABORT.forEach(([m, p, lim], i) => {
  test(`中途复位 ${m} @${p}：不残留并肩标记 / 礼仪道具，下一场能走到 done`, async () => {
    const r = await abortRuns[i];
    assert.ok(r.fired, '没走到相位 ' + p);
    assert.equal(r.reset.phase, 'idle', '看门狗应复位到 idle');
    assert.equal(r.reset.hostPairDrive, false, '主人 pairDrive 残留（下一场 tickRoute 早退、出迎一步不动）');
    assert.equal(r.reset.guestPairDrive, false, '客人 pairDrive 残留');
    assert.deepEqual(r.reset.riteBusy, [], '礼仪当差标记残留');
    assert.deepEqual(r.reset.cups, [], '茶盏残留可见');
    assert.equal(r.reset.guestVisible, false, '客人复位后应藏起');
    assert.equal(r.reset.car, 'parked', '马车应回马厩');
    assert.ok(r.nextDone !== null && r.nextDone <= lim, `复位后 ${r.nextDone}s 仍未到 done（停在 ${r.endPhase}）`);
  });
});

/* ② 让行：polite（被等满 3s 就让开）⇒ 全程离人物 ≥0.7m；stay（一直不动）⇒ 8s 上限后放行，演出仍收尾 */
const YIELD = [
  ['carriage-walkback', 0, 21.2], ['carriage-walkback', 5.0, 19.8], ['carriage-walkback', 0, 22.5],
  ['walk', 0.6, 25.6],                                  // 步行版：开机点 (0,26) 旁边就是客人的进出路线
];
const politeRuns = YIELD.map(([m, x, z]) => edge(m, 'yield', x, z, 'polite'));
const stayRuns = YIELD.slice(0, 1).map(([m, x, z]) => edge(m, 'yield', x, z, 'stay'));
YIELD.forEach(([m, x, z], i) => {
  test(`步行模式让行 ${m} 玩家站 (${x},${z})：人物不穿过玩家`, async () => {
    const r = await politeRuns[i];
    assert.ok(r.yields > 0, '人物从没为玩家停下过（路线没经过这一点？）');
    assert.ok(r.minD >= 0.7, `人物离玩家最近 ${r.minD}m（${r.minWho}）`);
    assert.ok(r.done !== null, '让行后演出应能走到 done');
  });
});
test('步行模式让行：玩家站着不动时，8s 上限后放行，演出不卡死', async () => {
  const r = await stayRuns[0];
  assert.ok(r.done !== null && r.done < 378.4 + 90, `一直挡路时 done=${r.done}`);
});

/* ③ 听琴时入夜：主人在琴边（hostAtQin）且戏在演 ⇒ 抚琴人可见 */
const nightListen = edge('carriage-walkback', 'night', 'listen', 40);
test('听琴时入夜：抚琴人随戏可见，不留主人对着空凳', async () => {
  const r = await nightListen;
  const atQin = r.qinSeen.filter(([ph, at]) => at && ph === 'listen');
  assert.ok(atQin.length > 10, '入夜窗口里没有 listen 帧');
  assert.ok(atQin.every(f => f[2] && f[3]), '听琴时入夜，抚琴人 / 主人被收走：' + JSON.stringify(atQin.find(f => !f[2] || !f[3])));
  assert.ok(r.hidden.some(([id]) => id === 'lady'), '其余人物照常按时段收工（对照）');
});

/* 锁：走回去途中入夜 8s 再天亮 —— 步行者被隐藏后继续走，复亮无跳位，走回去全员 ok、无兜底瞬移 */
const nightHome = edge('carriage-walkback', 'night', 'homing', 8);
test('走回去途中入夜再天亮：走回去照常完成，无兜底瞬移', async () => {
  const r = await nightHome;
  assert.ok(r.homeLog && r.homeLog.length >= 2, '缺走回去记录');
  assert.ok(r.homeLog.filter(e => e.t !== undefined).every(e => e.ok), JSON.stringify(r.homeLog));
  assert.equal(r.homeSnaps, 0, '出现兜底瞬移 ' + JSON.stringify(r.homeLog));
});
