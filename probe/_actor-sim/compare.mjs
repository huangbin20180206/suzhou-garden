// 逐帧比对两份 sim.mjs 输出（JSON 或 .json.gz）：第一处不同的帧、字段，及相位链/到 done 的时刻。
// CLI：node probe/_actor-sim/compare.mjs 基线.json.gz 新录.json
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

export function readRun(f){
  const buf = fs.readFileSync(f);
  return JSON.parse((f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'));
}
export function writeRunGz(f, r){ fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(r), { level: 9 })); }

/* 返回 null = 逐帧一致；否则一行人话（首个不同帧 + 前 12 个不同字段的 下标:基线≠新）。
 *
 * 逐位 vs 容差（2026-11-14 全量 verify 后修）：
 *   帧串里用 N6 = toPrecision(15) 序列化浮点（sim.mjs:96）。Math.sin/cos 连乘在不同 CPU/负载下
 *   末位会差 1 ULP（例：carriage 首帧字段 71 `0.843882518873581≠0.843882518873582`），
 *   逐位 `===` 分不清「行为变了」与「末位抖一格」。
 *   但**同进程**（同一份代码、同一台机器、同一负载）重复跑必须逐位相同 —— 那才是真不确定信号。
 *   所以这里对「入库基线 vs 新录」允许浮点字段最后 1~2 个最小刻度（10^-15 量级）的差，
 *   整数/相位名/帧号/帧数/骨骼校验和仍零容差：那是真行为变化，不许放。
 *   相位名（每帧第一段）与字段数不同 = 硬红（不管数值）。
 */
function closeNum(a, b){
  if (a === b) return true;
  if (a === '-' || b === '-' || a === 'true' || b === 'true' || a === 'false' || b === 'false') return false;
  const na = Number(a), nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;   // 相位名/状态串等非数值，必须逐位相等
  const scale = Math.max(Math.abs(na), Math.abs(nb), 1);
  const ulp = Number.EPSILON * scale;
  return Math.abs(na - nb) <= 4 * ulp;                              // 4×机器精度 = 约末 2 个最小刻度
}
export function diffRuns(A, B){
  const n = Math.min(A.frames.length, B.frames.length);
  for (let i = 0; i < n; i++){
    if (A.frames[i] === B.frames[i]) continue;
    const a = A.frames[i].split('|'), b = B.frames[i].split('|');
    if (a.length !== b.length)
      return '首个不同帧 ' + i + '（t=' + ((i + 1) * A.dt).toFixed(1) + 's，基线相位 ' + a[0] + '）字段数不同 ' + a.length + '≠' + b.length;
    if (a[0] !== b[0])                                            // 相位名硬红：行为真变了
      return '首个不同帧 ' + i + '（t=' + ((i + 1) * A.dt).toFixed(1) + 's）基线相位 ' + a[0] + ' ≠ 新相位 ' + b[0];
    const at = [];
    for (let j = 0; j < a.length; j++) if (!closeNum(a[j], b[j])) at.push(j + ':' + a[j] + '≠' + b[j]);
    if (at.length)
      return '首个不同帧 ' + i + '（t=' + ((i + 1) * A.dt).toFixed(1) + 's，基线相位 ' + a[0] + '）' + at.slice(0, 12).join('  ');
  }
  if (A.frames.length !== B.frames.length)
    return '帧数不同：基线 ' + A.frames.length + ' / 新 ' + B.frames.length + '（doneAt ' + A.doneAt + ' / ' + B.doneAt + '）';
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href){
  const [A, B] = process.argv.slice(2).map(readRun);
  console.log('帧数', A.frames.length, B.frames.length, '· doneAt', A.doneAt, B.doneAt);
  const d = diffRuns(A, B);
  console.log(d || '逐帧一致 ✓');
  process.exit(d ? 1 : 0);
}
