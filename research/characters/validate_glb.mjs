#!/usr/bin/env node
/**
 * validate_glb.mjs — 零依赖 GLB 结构检查（只解析 JSON chunk + accessor 元数据，不解码二进制）
 *
 * 用法：
 *   node research/characters/validate_glb.mjs <file.glb>
 *   node research/characters/validate_glb.mjs <file.glb> --require-skin
 *   node research/characters/validate_glb.mjs <file.glb> --max-tris=15000
 *
 * 输出：meshes / skins / animations / materials / textures 数量，每个 skin 的 joint 数，
 *       是否具备 POSITION / NORMAL / TEXCOORD_0，三角面估算，动画名列表。
 * 退出码：0 = 全部硬性判据通过；1 = 有硬性失败（解析失败 / 无网格 / 缺 POSITION|NORMAL|TEXCOORD_0 /
 *         --require-skin 但没有 skin）。
 *
 * 硬性判据为什么这么定（出处：docs/characters-asset-spec.md）：
 *   · 缺 POSITION → 没有几何；缺 NORMAL → 低模会读成平面色块；缺 TEXCOORD_0 → 1K 图集贴不上。
 *   · skins 默认不作硬判据：生成完（未绑骨）时 skins=0 是正常的，绑骨后用 --require-skin 卡。
 */

import { readFileSync, statSync } from 'node:fs';

const GLB_MAGIC = 0x46546c67;   // 'glTF' LE
const CHUNK_JSON = 0x4e4f534a;  // 'JSON'
const CHUNK_BIN = 0x004e4942;   // 'BIN\0'
const MODE_TRIANGLES = 4;

const fail = [];
const warn = [];

function die(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
}

function ok(cond, msg) {
  if (cond) console.log(`  [ok]   ${msg}`);
  else { console.log(`  [FAIL] ${msg}`); fail.push(msg); }
  return cond;
}

function warnIf(cond, msg) {
  if (!cond) return;
  console.log(`  [warn] ${msg}`);
  warn.push(msg);
}

// ─────────────────────────── 参数 ───────────────────────────
const argv = process.argv.slice(2);
const flags = new Set();
let file = null;
let maxTris = 0;
for (const a of argv) {
  if (a.startsWith('--max-tris=')) {
    const v = Number(a.slice('--max-tris='.length));
    if (!Number.isFinite(v) || v <= 0) die(`--max-tris 需要正整数，收到 ${a}`);
    maxTris = v;
  } else if (a.startsWith('--')) {
    flags.add(a);
  } else if (!file) {
    file = a;
  }
}
if (!file) {
  console.error('usage: node research/characters/validate_glb.mjs <file.glb> [--require-skin] [--max-tris=N]');
  process.exit(1);
}
const requireSkin = flags.has('--require-skin');

// ─────────────────────────── 读文件 ───────────────────────────
let buf;
try {
  const st = statSync(file);
  if (!st.isFile()) die(`不是文件：${file}`);
  buf = readFileSync(file);
} catch (e) {
  die(`读不到文件：${file} (${e.message})`);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`FILE   ${file}  (${kb(buf.length)})`);

if (buf.length < 12) die('文件小于 12 字节，不是 GLB');
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const declared = buf.readUInt32LE(8);
if (magic !== GLB_MAGIC) die(`magic=0x${magic.toString(16)}，不是 GLB（应为 0x46546c67）`);

// ─────────────────────────── 拆 chunk ───────────────────────────
let json = null;
let jsonBytes = 0;
let binBytes = 0;
let chunkCount = 0;
let off = 12;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const start = off + 8;
  if (start + len > buf.length) {
    warnIf(true, `chunk 越界（off=${off} len=${len}），文件可能被截断`);
    break;
  }
  chunkCount++;
  if (type === CHUNK_JSON && !json) {
    jsonBytes = len;
    const text = buf.subarray(start, start + len).toString('utf8');
    try {
      json = JSON.parse(text);
    } catch (e) {
      die(`JSON chunk 解析失败：${e.message}`);
    }
  } else if (type === CHUNK_BIN) {
    binBytes = len;
  }
  off = start + len;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const count = (v) => arr(v).length;

console.log(`GLB    version=${version}  chunks=${chunkCount}  json=${jsonBytes}B  bin=${binBytes}B  declared=${declared}B`);
if (!json) die('没有 JSON chunk');

const asset = json.asset || {};
console.log(`ASSET  version=${asset.version ?? '?'}  generator=${JSON.stringify(asset.generator ?? '')}`);
console.log(`EXT    extensionsUsed=${JSON.stringify(arr(json.extensionsUsed))}`);

if (version !== 2) warnIf(true, `GLB 容器版本 ${version}，本项目只用 2`);
if (declared && declared !== buf.length) {
  warnIf(true, `头部 declaredLength=${declared} 与真实文件长 ${buf.length} 不一致`);
}
if (asset.version && String(asset.version) !== '2.0') {
  warnIf(true, `glTF 版本 ${asset.version}（本项目按 2.0）`);
}
const bin0 = arr(json.buffers)[0];
if (bin0 && Number.isFinite(bin0.byteLength) && binBytes && bin0.byteLength > binBytes + 3) {
  warnIf(true, `buffers[0].byteLength=${bin0.byteLength} 大于 BIN chunk ${binBytes}（可能缺 chunk）`);
}
if (arr(json.extensionsUsed).includes('KHR_draco_mesh_compression')) {
  warnIf(true, '用了 Draco 压缩 —— 项目离线环境解不了（probe 会报 draco_decoder.wasm）');
}
if (arr(json.extensionsUsed).includes('KHR_texture_basisu')) {
  warnIf(true, '用了 KTX2/Basis 贴图 —— 项目资产全部是普通 WebP/PNG');
}

// ─────────────────────────── 计数 ───────────────────────────
const meshes = arr(json.meshes);
const skins = arr(json.skins);
const anims = arr(json.animations);
const materials = arr(json.materials);
const textures = arr(json.textures);
const images = arr(json.images);
const samplers = arr(json.samplers);
const nodes = arr(json.nodes);
const accessors = arr(json.accessors);

console.log(`COUNTS meshes=${meshes.length} nodes=${nodes.length} materials=${materials.length} ` +
  `textures=${textures.length} images=${images.length} samplers=${samplers.length} ` +
  `skins=${skins.length} animations=${anims.length}`);

// ─────────────────────────── 图元属性 / 三角面 ───────────────────────────
const attrSeen = new Set();
const missingPos = [];
const missingNorm = [];
const missingUv = [];
let primCount = 0;
let tris = 0;
let nonTriPrims = 0;
let skinnedPrims = 0;

meshes.forEach((m, mi) => {
  arr(m.primitives).forEach((p, pi) => {
    primCount++;
    const at = p.attributes || {};
    for (const k of Object.keys(at)) attrSeen.add(k);
    const tag = `${m.name ?? `mesh${mi}`}#${pi}`;
    if (!Number.isInteger(at.POSITION)) missingPos.push(tag);
    if (!Number.isInteger(at.NORMAL)) missingNorm.push(tag);
    if (!Number.isInteger(at.TEXCOORD_0)) missingUv.push(tag);
    if (Number.isInteger(at.JOINTS_0) && Number.isInteger(at.WEIGHTS_0)) skinnedPrims++;

    const mode = Number.isInteger(p.mode) ? p.mode : MODE_TRIANGLES;
    if (mode !== MODE_TRIANGLES) { nonTriPrims++; return; }
    const pos = accessors[at.POSITION];
    const idx = Number.isInteger(p.indices) ? accessors[p.indices] : null;
    const n = idx ? idx.count : (pos ? pos.count : 0);
    if (Number.isFinite(n)) tris += Math.floor(n / 3);
  });
});

console.log(`PRIMS  ${primCount} (skinned=${skinnedPrims}, non-TRIANGLES=${nonTriPrims})`);
console.log(`TRIS   ~${tris}`);
const extra = [...attrSeen].filter((a) => !['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].includes(a));
console.log(`ATTRS  POSITION=${attrSeen.has('POSITION') ? 'yes' : 'NO'} ` +
  `NORMAL=${attrSeen.has('NORMAL') ? 'yes' : 'NO'} ` +
  `TEXCOORD_0=${attrSeen.has('TEXCOORD_0') ? 'yes' : 'NO'} ` +
  `extra=${JSON.stringify(extra)}`);

// ─────────────────────────── 蒙皮 ───────────────────────────
if (skins.length) {
  skins.forEach((s, i) => {
    const joints = arr(s.joints).length;
    console.log(`SKIN   #${i} joints=${joints} name=${JSON.stringify(s.name ?? '')} ` +
      `skeleton=${Number.isInteger(s.skeleton) ? s.skeleton : '-'}`);
  });
} else {
  console.log('SKIN   (none)');
}

// ─────────────────────────── 动画 ───────────────────────────
if (anims.length) {
  anims.forEach((a, i) => {
    const ch = arr(a.channels).length;
    const sm = arr(a.samplers).length;
    console.log(`ANIM   #${i} name=${JSON.stringify(a.name ?? '')} channels=${ch} samplers=${sm}`);
  });
} else {
  console.log('ANIM   (none)');
}

// ─────────────────────────── 硬性判据 ───────────────────────────
console.log('CHECKS');
const versionOk = version === 2;
ok(versionOk, 'GLB container version = 2');
ok(!!json, 'JSON chunk parsed');
ok(meshes.length > 0, `meshes > 0 (got ${meshes.length})`);
ok(primCount > 0, `primitives > 0 (got ${primCount})`);
ok(missingPos.length === 0, missingPos.length
  ? `every primitive has POSITION (missing: ${missingPos.join(', ')})`
  : 'every primitive has POSITION');
ok(missingNorm.length === 0, missingNorm.length
  ? `every primitive has NORMAL (missing: ${missingNorm.join(', ')})`
  : 'every primitive has NORMAL');
ok(missingUv.length === 0, missingUv.length
  ? `every primitive has TEXCOORD_0 (missing: ${missingUv.join(', ')})`
  : 'every primitive has TEXCOORD_0');

if (requireSkin) {
  ok(skins.length === 1, `exactly 1 skin (got ${skins.length})`);
  if (skins.length) {
    const j = arr(skins[0].joints).length;
    ok(j >= 30 && j <= 45, `skin#0 joints in 30..45 (got ${j})`);
  }
  ok(anims.length === 0, `no baked animations (got ${anims.length})`);
}

if (maxTris > 0) {
  ok(tris > 0 && tris <= maxTris, `triangles <= ${maxTris} (got ${tris})`);
}

// 预算提示（不判红，规格里是 8k~15k）
if (tris > 0 && (tris < 8000 || tris > 15000)) {
  warnIf(true, `三角面 ${tris} 不在规格区间 8000..15000 内`);
}
if (materials.length > 2) {
  warnIf(true, `materials=${materials.length} —— 规格是 1 张图集，材质数 >2 会多 draw call`);
}

// ─────────────────────────── 结果 ───────────────────────────
const passed = fail.length === 0;
console.log(`RESULT ${passed ? 'PASS' : 'FAIL'} (${fail.length} failures, ${warn.length} warnings)`);
if (!passed) for (const f of fail) console.log(`  - ${f}`);
process.exit(passed ? 0 : 1);
