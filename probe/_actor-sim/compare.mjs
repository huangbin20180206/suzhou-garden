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
  /* 帧串用 toPrecision(15) 序列化（sim.mjs:96），15 位有效数字在量级 ~1 时末位 = 1e-15，
     对应 ~4.5 个二进制 ULP（实测 0.843882518873581 vs …582 = 4.5 ULP）。跨 CPU/负载 sin/cos 连乘
     末位差 1 个十进制位很常见，所以容差必须按「十进制末位」立，不能按二进制 ULP 立（4 ULP 太紧）。
     这里放 1e-14 相对（≈ 末 2 个十进制位 = ~9 ULP），能兜住末位抖一格，又远小于真实行为变化
     （行为变化通常 ≥1e-6 量级）。整数（骨骼校验和/计数）不在此路径：它们是纯数字串，
     数值差 ≥1 会超 1e-14 相对，自然零容差。 */
  const scale = Math.max(Math.abs(na), Math.abs(nb), 1);
  return Math.abs(na - nb) <= 1e-14 * scale;                        // 相对 1e-14 ≈ 末 2 个十进制位
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

/* 路径形状偏差（2026-11-24 · 第 5 批 · 固定步长两种口径对照）：
   两份按帧驱动的录像时间轴会慢慢错开（关闭口径大步积分，走得略慢），按帧号直接比位置会把"晚到 1 秒"量成"偏了 1 米"。
   这里按 (第几场, 相位名) 分段（byPhase=false：只按场分段 —— 不受相位外的个人计时器影响，量纯路线几何），每段里取 a 的每个快照点到 b 同段同一演员折线的最近距离，取最大 —— 量的是"走的路线是否一样"。
   只比两边都可见的演员；返回 { worst, at:[段, 演员], segs, pts }。 */
export function pathDeviation(a, b, { byPhase = true } = {}){
  const segs = (r) => {
    const m = new Map(); let visit = 0, prev = '';
    for (const f of r.frames){
      const x = f.split('|'), ph = x[0];
      if (ph === 'carIn' && prev !== 'carIn') visit++;
      prev = ph;
      for (let k = 12; k + 19 <= x.length && x[k] !== 'rite'; k += 19){
        if (x[k + 10] !== 'true') continue;
        const key = byPhase ? visit + '/' + ph + '/' + x[k] : visit + '/' + x[k];
        let arr = m.get(key); if (!arr) m.set(key, arr = []);
        arr.push(+x[k + 1], +x[k + 2]);
      }
    }
    return m;
  };
  const A = segs(a), B = segs(b);
  let worst = 0, at = null, n = 0, pts = 0;
  for (const [key, pa] of A){
    const pb = B.get(key); if (!pb) continue;
    n++;
    for (let i = 0; i < pa.length; i += 2){
      const px = pa[i], pz = pa[i + 1];
      let best = Infinity;
      if (pb.length === 2) best = Math.hypot(px - pb[0], pz - pb[1]);
      for (let j = 0; j + 3 < pb.length; j += 2){
        const ax = pb[j], az = pb[j + 1], dx = pb[j + 2] - ax, dz = pb[j + 3] - az;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
        best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
      }
      pts++;
      if (best > worst){ worst = best; at = key; }
    }
  }
  return { worst: +worst.toFixed(4), at, segs: n, pts };
}
