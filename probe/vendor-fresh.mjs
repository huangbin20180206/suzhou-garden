// vendor 新鲜度门（2026-10-15 · 完结 Phase 2）：纯 node，毫秒级。
// vendor.js 是 esbuild 构建产物却入库跟踪 —— build-entry.js 改了而 vendor 没重打，
// 页面跑的还是旧 three/addons，静默且难查。本门锁死"输入指纹"：
//   sha256(build-entry.js) + three/meshoptimizer/draco/ktx-parse/esbuild 版本号
// 指纹文件：probe/vendor-fresh.json（入库）。
// 改了输入后正确姿势：npm run build:vendor && node probe/vendor-fresh.mjs --record
//
// ── 2026-10-30 修 Linux CI 误报（第 0 周热修）─────────────────────────────
// 症状：同一份提交，Windows 上 PASS、Ubuntu runner 上 FAIL，报"输入变了"。
// 病根不是内容，是**换行**：`git diff --ignore-all-space` 为空、而两边 sha256 不同。
//   仓库有 `.gitattributes` 的 `* text=auto eol=lf` ⇒ git 里存的是 LF；
//   Linux 检出即 LF；而 Windows 工作副本因 `core.autocrlf=true` 是 **CRLF** ——
//   本门直接拿**工作区字节**算哈希 ⇒ 同一文件产出两个指纹。实测：
//     CRLF d662228b0eae9dad / LF 394cf9dadf736a22（recorded 当初恰好是 CRLF 那份）。
// 修法：算哈希前**统一折成 LF**（只折叠 \r\n，不碰裸 \r —— 那是 Mac 经典格式，
//   真出现就该红）。指纹与平台、与本地 autocrlf 设置全部脱钩。
// ⚠️ 顺带取舍：这样也**看不见**"有人把整个文件从 CRLF 改成 LF"这种纯换行改动 ——
//   那是想要的，纯换行不会改变 esbuild 的产物语义，不该触发"重打 vendor"。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPRINT = path.join(ROOT, 'probe', 'vendor-fresh.json');

function fingerprint(){
  /* ⚠️ 读成 utf8 字符串再折 LF（**不要**直接 update 原始 Buffer）：见文件头
     「2026-10-30 修 Linux CI 误报」—— 工作区字节随平台的 autocrlf 变，折过才可比。 */
  const entry = fs.readFileSync(path.join(ROOT, 'build-entry.js'), 'utf8').replace(/\r\n/g, '\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = {};
  for (const k of ['three', 'meshoptimizer', 'draco', 'ktx-parse'])
    deps[k] = (pkg.dependencies || {})[k] || null;
  deps.esbuild = (pkg.devDependencies || {}).esbuild || null;
  const sha = crypto.createHash('sha256').update(entry).digest('hex').slice(0, 16);
  return { entrySha: sha, deps };
}

const fp = fingerprint();
/* 自检（探针自证判据有牙 · 沿用本项目惯例）：
   ① 换行归一真的生效 —— 同一份内容的 CRLF 版与 LF 版必须算出**同一个**指纹；
   ② 内容真的变了要能红 —— 改一个字符后指纹必须不同（否则上面的归一可能把内容也抹了）。
   两条都只在内存里做，不碰磁盘。任一条不成立 ⇒ 本门无意义 ⇒ 判红退出。 */
function selfcheck(){
  const fails = [];
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const body = 'a\nb\nc\n';
  const a = sha(body), b = sha(body.replace(/\n/g, '\r\n').replace(/\r\n/g, '\n'));
  if (a !== b) fails.push('换行归一失效：同一内容的 LF 版与 CRLF 版折完仍不同指纹');
  if (sha(body) === sha(body + 'd\n')) fails.push('内容判据失效：改一个字符后指纹没变');
  for (const f of fails) console.error('  ✗ ' + f);
  console.log(`[vendor-fresh] 自检 ${fails.length ? 'FAILED' : 'PASS'}（换行归一 + 内容变化）`);
  return fails.length === 0;
}
const selfOk = selfcheck();

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
if (!selfOk){
  console.error('[vendor-fresh] FAIL：判据自检未通过（见上方 ✗），本门结论不可信');
  process.exit(1);
}
console.log('[vendor-fresh] PASS（entrySha=' + fp.entrySha + '）');
