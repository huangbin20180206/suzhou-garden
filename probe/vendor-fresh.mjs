// vendor 新鲜度门（2026-10-15 · 完结 Phase 2）：纯 node，毫秒级。
// vendor.js 是 esbuild 构建产物却入库跟踪 —— build-entry.js 改了而 vendor 没重打，
// 页面跑的还是旧 three/addons，静默且难查。本门锁死"输入指纹"：
//   sha256(build-entry.js) + three/meshoptimizer/draco/ktx-parse/esbuild 版本号
// 指纹文件：probe/vendor-fresh.json（入库）。
// 改了输入后正确姿势：npm run build:vendor && node probe/vendor-fresh.mjs --record
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPRINT = path.join(ROOT, 'probe', 'vendor-fresh.json');

function fingerprint(){
  const entry = fs.readFileSync(path.join(ROOT, 'build-entry.js'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = {};
  for (const k of ['three', 'meshoptimizer', 'draco', 'ktx-parse'])
    deps[k] = (pkg.dependencies || {})[k] || null;
  deps.esbuild = (pkg.devDependencies || {}).esbuild || null;
  const sha = crypto.createHash('sha256').update(entry).digest('hex').slice(0, 16);
  return { entrySha: sha, deps };
}

const fp = fingerprint();
if (process.argv.includes('--record')){
  fs.writeFileSync(FPRINT, JSON.stringify(fp, null, 2) + '\n');
  console.log('[vendor-fresh] 指纹已记录:', JSON.stringify(fp));
  process.exit(0);
}
if (!fs.existsSync(FPRINT)){
  console.error('[vendor-fresh] FAIL：指纹文件缺失，先跑 node probe/vendor-fresh.mjs --record');
  process.exit(1);
}
const want = JSON.parse(fs.readFileSync(FPRINT, 'utf8'));
const same = want.entrySha === fp.entrySha
  && JSON.stringify(want.deps) === JSON.stringify(fp.deps);
if (!same){
  console.error('[vendor-fresh] FAIL：输入变了，vendor.js 疑似过期');
  console.error('  期望:', JSON.stringify(want));
  console.error('  实测:', JSON.stringify(fp));
  console.error('  修复：npm run build:vendor && node probe/vendor-fresh.mjs --record');
  process.exit(1);
}
console.log('[vendor-fresh] PASS（entrySha=' + fp.entrySha + '）');
