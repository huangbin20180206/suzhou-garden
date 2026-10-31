#!/usr/bin/env node
// 资产清单生成器（2026-10-30 · 审查 S4）：assets/manifest.json 是**唯一真值**，本脚本
//   ① 从磁盘实测 bytes / sha256 写回 manifest.json；
//   ② 生成 src/13-preload.js 的 PRELOAD_MANIFEST 段（phase=preload 的件）；
//   ③ 生成 sw.js 的 GLBS 段（precache=true 的件）。
// 两段代码都夹在 `<asset-manifest:*>` 标记注释之间，标记外的手写代码一字不碰。
//
// 用法：node tools/gen-asset-manifest.mjs           # 只校验（不一致 exit 1）
//       node tools/gen-asset-manifest.mjs --write   # 写回 manifest.json + 两段生成代码
// 纯 node（fs + crypto），无第三方依赖 —— 门禁 probe/preload-manifest-sync.mjs 直接 import 本模块复用同一套逻辑。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = 'assets/manifest.json';
export const PRELOAD = 'src/13-preload.js';
export const SW = 'sw.js';
const PHASES = new Set(['preload', 'lazy']);

const lf = (s) => s.replace(/\r\n/g, '\n');
export const readText = (rel) => lf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/* 磁盘实测：bytes + sha256 前 16 位 */
export function measure(rel){
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
  const buf = fs.readFileSync(p);
  return { bytes: buf.byteLength, sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) };
}

/* 结构校验：字段类型、url 唯一、phase 合法、precache 与 phase 一致、lazy 必须写理由。返回错误数组。 */
export function validate(m){
  const errs = [];
  if (!m || !Array.isArray(m.assets) || !m.assets.length) return ['manifest.assets 缺失或为空（拒绝以「空清单」继续）'];
  const seen = new Set();
  for (const [i, a] of m.assets.entries()){
    const at = `assets[${i}]${a && a.url ? '（' + a.url + '）' : ''}`;
    if (!a || typeof a.url !== 'string' || !/^assets\/[^/]+$/.test(a.url)) { errs.push(`${at}：url 必须形如 assets/<文件>`); continue; }
    if (seen.has(a.url)) errs.push(`${at}：url 重复`);
    seen.add(a.url);
    if (!Number.isInteger(a.bytes) || a.bytes <= 0) errs.push(`${at}：bytes 必须是正整数`);
    if (typeof a.sha256 !== 'string') errs.push(`${at}：sha256 必须是字符串`);
    if (!PHASES.has(a.phase)) errs.push(`${at}：phase 只能是 preload | lazy`);
    if (typeof a.stage !== 'string' || !a.stage || a.stage.includes('%')) errs.push(`${at}：stage 必须非空且不含 %（loading-guard 的正则会误捕获）`);
    if (typeof a.label !== 'string' || !a.label) errs.push(`${at}：label 必须非空`);
    if (typeof a.required !== 'boolean') errs.push(`${at}：required 必须是布尔`);
    if (typeof a.precache !== 'boolean') errs.push(`${at}：precache 必须是布尔`);
    /* precache ⇔ preload：预载件必须离线可用（否则 PWA 断网首开缺件）；
       懒加载件不回填（否则 SW 会替一个开园用不到的大件额外下载一次，HTTP 缓存里也没有它）。 */
    if (typeof a.precache === 'boolean' && PHASES.has(a.phase) && a.precache !== (a.phase === 'preload'))
      errs.push(`${at}：precache 必须与 phase=preload 一致（预载件要离线可用；懒加载件不回填）`);
    if (a.phase === 'lazy' && !(typeof a.note === 'string' && a.note.trim())) errs.push(`${at}：lazy 件必须在 note 里写理由`);
    if (a.phase === 'preload' && !/\.glb$/.test(a.url)) errs.push(`${at}：预载件只能是 .glb（预载段只接 GLTFLoader 的回报）`);
  }
  return errs;
}

/* ── 两段生成代码 ───────────────────────────────────────────────────────── */
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
export const PRELOAD_BEGIN = '  /* <asset-manifest:preload> 由 tools/gen-asset-manifest.mjs 从 assets/manifest.json 生成，勿手改（改 JSON 后跑 --write） */';
export const PRELOAD_END = '  /* </asset-manifest:preload> */';
export const SW_BEGIN = '  /* <asset-manifest:precache> 由 tools/gen-asset-manifest.mjs 从 assets/manifest.json 生成，勿手改（改 JSON 后跑 --write） */';
export const SW_END = '  /* </asset-manifest:precache> */';

export function genPreloadBlock(m){
  const rows = m.assets.filter(a => a.phase === 'preload').map(a =>
    `  { url: ${q(a.url)}, bytes: ${a.bytes}, stage: ${q(a.stage)}, label: ${q(a.label)}, required: ${a.required} },`);
  return [PRELOAD_BEGIN, ...rows, PRELOAD_END].join('\n');
}
export function genSwBlock(m){
  const rows = m.assets.filter(a => a.precache).map(a => `  ${q('./' + a.url)},`);
  return [SW_BEGIN, ...rows, SW_END].join('\n');
}

/* 取出标记之间（含标记）的现有文本；找不到标记返回 null（门禁据此报红，不当成空） */
export function extractBlock(src, begin, end){
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) return null;
  return src.slice(i, j + end.length);
}
export function replaceBlock(src, begin, end, block){
  const cur = extractBlock(src, begin, end);
  if (cur === null) throw new Error(`找不到生成段标记：${begin.trim().slice(0, 40)}…`);
  return src.replace(cur, () => block);
}

/* 把磁盘实测写进清单对象（返回新对象 + 变化列表） */
export function refreshMeasured(m){
  const changes = [];
  const assets = m.assets.map(a => {
    const d = measure(a.url);
    if (!d) return a;
    if (d.bytes !== a.bytes || d.sha256 !== a.sha256) changes.push(`${a.url}: ${a.bytes}/${a.sha256 || '-'} → ${d.bytes}/${d.sha256}`);
    return { ...a, bytes: d.bytes, sha256: d.sha256 };
  });
  return { m: { ...m, assets }, changes };
}

/* 按"一件一行"写回 JSON（保持 diff 可读：改一件只动一行） */
export function stringifyManifest(m){
  const head = JSON.stringify({ _doc: m._doc }, null, 2).replace(/\n}$/, '');
  const rows = m.assets.map(a => {
    const { note, ...rest } = a;
    return '    ' + JSON.stringify(rest).replace(/^{/, '{ ').replace(/,"/g, ', "').replace(/":/g, '": ')
      .replace(/}$/, `,\n      "note": ${JSON.stringify(note || '')} }`);
  });
  return `${head},\n  "assets": [\n${rows.join(',\n')}\n  ]\n}\n`;
}

export function loadManifest(){
  return JSON.parse(readText(MANIFEST));
}

function main(){
  const WRITE = process.argv.includes('--write');
  let m = loadManifest();
  const errs = validate(m);
  for (const a of m.assets || []) if (!measure(a.url)) errs.push(`${a.url}：磁盘上不存在`);
  if (errs.length){ console.error('[gen-asset-manifest] 清单结构错误：\n  ' + errs.join('\n  ')); process.exit(1); }

  const r = refreshMeasured(m);
  m = r.m;
  const preSrc = readText(PRELOAD), swSrc = readText(SW);
  const preNew = replaceBlock(preSrc, PRELOAD_BEGIN, PRELOAD_END, genPreloadBlock(m));
  const swNew = replaceBlock(swSrc, SW_BEGIN, SW_END, genSwBlock(m));
  const jsonNew = stringifyManifest(m);
  const stale = [];
  if (r.changes.length || readText(MANIFEST) !== jsonNew) stale.push(MANIFEST + (r.changes.length ? '（' + r.changes.length + ' 件字节/哈希变化）' : '（格式）'));
  if (preNew !== preSrc) stale.push(PRELOAD + ' 的 PRELOAD_MANIFEST 段');
  if (swNew !== swSrc) stale.push(SW + ' 的 GLBS 段');

  if (WRITE){
    fs.writeFileSync(path.join(ROOT, MANIFEST), jsonNew);
    fs.writeFileSync(path.join(ROOT, PRELOAD), preNew);
    fs.writeFileSync(path.join(ROOT, SW), swNew);
    for (const c of r.changes) console.log('  · ' + c);
    console.log(`[gen-asset-manifest] 已写回：${stale.length ? stale.join('、') : '（无变化）'}`);
    if (r.changes.length) console.log('  ⚠️ 有资产文件变了：记得把 sw.js 的 ASSET_CACHE 后缀 +1（npm run check 会盯）。');
    return;
  }
  if (stale.length){
    console.error('[gen-asset-manifest] 不一致：' + stale.join('、') + ' ⇒ 跑 node tools/gen-asset-manifest.mjs --write');
    for (const c of r.changes) console.error('  · ' + c);
    process.exit(1);
  }
  const pre = m.assets.filter(a => a.phase === 'preload');
  console.log(`[gen-asset-manifest] 一致：${m.assets.length} 件（预载 ${pre.length} 件 ${(pre.reduce((s, a) => s + a.bytes, 0) / 1048576).toFixed(2)} MB · 回填 ${m.assets.filter(a => a.precache).length} 件）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
