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

/* 返回 null = 逐帧一致；否则一行人话（首个不同帧 + 前 12 个不同字段的 下标:基线≠新） */
export function diffRuns(A, B){
  const n = Math.min(A.frames.length, B.frames.length);
  for (let i = 0; i < n; i++){
    if (A.frames[i] === B.frames[i]) continue;
    const a = A.frames[i].split('|'), b = B.frames[i].split('|');
    const at = [];
    for (let j = 0; j < Math.max(a.length, b.length); j++) if (a[j] !== b[j]) at.push(j + ':' + a[j] + '≠' + b[j]);
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
