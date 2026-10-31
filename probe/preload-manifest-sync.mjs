// 资产清单一致性门禁（纯 node / 读文本 / 不发网络请求 / <1s）
//
// ── 沿革 ────────────────────────────────────────────────────────────────────
// 2026-10-03 新增：当时 sw.js 的 GLBS 与 src/13-preload.js 的 PRELOAD_MANIFEST 是**同一批资产的两个
//   手写投影**，加金刚鹦鹉时只改了一边、55 道门全绿（PWA 断网首开缺鹦鹉，且 required:false ⇒ 完全静默）。
// 2026-10-30 改（审查 S4）：单一真值改为 **assets/manifest.json**，两段代码由
//   tools/gen-asset-manifest.mjs 生成。本门从"比两份手写清单"改成"校验 JSON ↔ 磁盘 ↔ 两段生成代码"。
//
// ── 判据 ──────────────────────────────────────────────────────────────────
//   M0 结构：manifest.json 可解析；字段类型、url 唯一、phase/stage 合法、precache ⇔ phase=preload、lazy 写了理由
//   G1 13-preload 的 PRELOAD_MANIFEST 生成段 = 由 manifest 生成的结果（漏改/手改 ⇒ 红）
//   G2 sw.js 的 GLBS 生成段 = 由 manifest 生成的结果（漏 ⇒ PWA 离线首开缺件）
//   G3 反向扫磁盘：assets/ 下每个文件都登记在 manifest 里（新资产忘了登记即红；manifest.json 自身除外）
//   G4 bytes / sha256：manifest 声明 = 磁盘实测（不一致会让进度条卡在怪数；sha 变了提醒升 ASSET_CACHE）
//   G5 SHELL：应用壳成员齐全（漏一件 = 离线打开缺一块）
//   G6 接线：每件预载件都在 src 里有人 loadAssetOnce / placeAssets / settleAsset 回报
//          （漏 ⇒ 预载段死等满 PRELOAD_TIMEOUT_MS；2026-10-11 Horse.glb 真事故）
//   G0 自检：在内存里做变异（抹 GLBS 一项 / bytes 改错 / 磁盘多一件未登记 / SHELL 缺 vendor / 抹接线 /
//          precache 与 phase 不一致），对应判据必须红；未变异输入必须全绿（阳性对照）。
//
// ⚠️ 边界：只判文字级一致，不判缓存策略对不对（那是 check.mjs 的版本治理 + pwa-cache 的断网实测）。
// 用法: node probe/preload-manifest-sync.mjs [--selfcheck]
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, MANIFEST, PRELOAD, SW, measure, validate, readText, loadManifest,
  genPreloadBlock, genSwBlock, extractBlock, PRELOAD_BEGIN, PRELOAD_END, SW_BEGIN, SW_END,
} from '../tools/gen-asset-manifest.mjs';

const ASSET_DIR = 'assets';
const NOT_ASSETS = new Set(['manifest.json']);   // 清单自身不是资产

const norm = (p) => String(p).replace(/^\.\//, '');
function parseArray(src, name, file){
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\n\\];`));
  if (!m) throw new Error(`${file} 里找不到 \`const ${name} = [...]\` 数组（解析失败 —— 拒绝以「空清单」继续）`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => norm(x[1])).filter(s => s !== '');
}

/* ── 判据：纯函数（--selfcheck 喂变异副本，不碰磁盘） ── */
function audit({ manifest, preloadBlock, swBlock, shell, diskFiles, disk, wiredSet = new Set(), headOk = true, headErr = '' }){
  const checks = [];
  const ck = (name, ok, detail) => checks.push({ name, ok, detail });
  if (!headOk){ ck('头部：manifest.json / 13-preload.js / sw.js 均可解析', false, headErr); return checks; }

  const errs = validate(manifest);
  ck('M0 结构：manifest.json 字段合法（precache ⇔ preload、lazy 写理由、stage 不含 %）', errs.length === 0,
     errs.length ? errs.join('；') : `${manifest.assets.length} 件`);
  if (errs.length) return checks;      // 结构坏了，后面的判据没有意义

  const wantPre = genPreloadBlock(manifest), wantSw = genSwBlock(manifest);
  ck('G1 13-preload 的 PRELOAD_MANIFEST 生成段与 manifest 一致', preloadBlock === wantPre,
     preloadBlock === null ? '找不到 <asset-manifest:preload> 标记' : preloadBlock === wantPre
       ? `${manifest.assets.filter(a => a.phase === 'preload').length} 件预载`
       : '不一致 ⇒ node tools/gen-asset-manifest.mjs --write（别手改生成段）');
  ck('G2 sw.js 的 GLBS 生成段与 manifest 一致（漏则 PWA 离线首开缺件）', swBlock === wantSw,
     swBlock === null ? '找不到 <asset-manifest:precache> 标记' : swBlock === wantSw
       ? `${manifest.assets.filter(a => a.precache).length} 件回填`
       : '不一致 ⇒ node tools/gen-asset-manifest.mjs --write');

  const listed = new Set(manifest.assets.map(a => a.url));
  const stray = diskFiles.filter(u => !listed.has(u) && !NOT_ASSETS.has(path.basename(u)));
  ck('G3 反向扫磁盘：assets/ 每个文件都登记在 manifest.json（新资产忘了登记即红）', stray.length === 0,
     stray.length ? `未登记 ${stray.length} 件：${stray.join('、')}` : `磁盘 ${diskFiles.length} 个文件全部已登记`);

  const bad = [];
  for (const a of manifest.assets){
    const d = disk[a.url];
    if (!d){ bad.push(`${a.url}：磁盘上不存在`); continue; }
    if (a.bytes !== d.bytes) bad.push(`${a.url}：清单 ${a.bytes} vs 磁盘 ${d.bytes}（差 ${d.bytes - a.bytes}）`);
    else if (a.sha256 !== d.sha256) bad.push(`${a.url}：sha256 清单 ${a.sha256 || '-'} vs 磁盘 ${d.sha256}（内容变了 ⇒ 升 ASSET_CACHE）`);
  }
  ck('G4 bytes / sha256：清单 = 磁盘实测', bad.length === 0, bad.length ? bad.join('；') : `${manifest.assets.length} 件全部吻合`);

  const REQUIRED_SHELL = ['index.html', 'manifest.webmanifest', 'vendor.js', 'icons/garden.svg', 'docs/cover.jpg'];
  const missShell = REQUIRED_SHELL.filter(u => !shell.includes(u));
  ck('G5 SHELL：应用壳必需成员齐全', missShell.length === 0,
     missShell.length ? `SHELL 缺：${missShell.join('、')}` : `${REQUIRED_SHELL.length} 件齐全（SHELL 共 ${shell.length} 项）`);

  const pre = manifest.assets.filter(a => a.phase === 'preload').map(a => a.url);
  const unwired = pre.filter(u => !wiredSet.has(u));
  ck('G6 接线：每件预载件都在 src 里有人 loadAssetOnce / placeAssets / settleAsset 回报', unwired.length === 0,
     unwired.length ? `${unwired.length} 件没人回报：${unwired.join('、')} ⇒ 每次进项目都会死等满 PRELOAD_TIMEOUT_MS` : `${pre.length} 件全部接线`);
  return checks;
}

/* G6 探测：扫 src（排除 13-preload 自己），认 loadAssetOnce / placeAssets / settleAsset 三种入口，
   允许 `const X = '<url>'` 之后用常量调用。裸 `new GLTFLoader().load(X)` 不算（它不回报 settle）。 */
function detectWired(urls){
  const dir = path.join(ROOT, 'src');
  const blob = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== '13-preload.js')
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const wired = new Set();
  for (const u of urls){
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ids = [...blob.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*'${esc}'`, 'g'))].map(m => m[1]);
    const tokens = [`'${esc}'`, ...ids];
    if (tokens.some(t => new RegExp(`(loadAssetOnce|placeAssets|settleAsset)\\s*\\??\\.?\\s*\\(\\s*${t}\\s*[,)]`).test(blob))) wired.add(u);
  }
  return wired;
}

function collect(){
  const manifest = loadManifest();
  const preSrc = readText(PRELOAD), swSrc = readText(SW);
  const diskFiles = fs.readdirSync(path.join(ROOT, ASSET_DIR)).sort()
    .filter(f => fs.statSync(path.join(ROOT, ASSET_DIR, f)).isFile()).map(f => `${ASSET_DIR}/${f}`);
  const disk = {};
  for (const u of diskFiles) disk[u] = measure(u);
  const urls = Array.isArray(manifest.assets) ? manifest.assets.filter(a => a && a.phase === 'preload').map(a => a.url) : [];
  return {
    manifest,
    preloadBlock: extractBlock(preSrc, PRELOAD_BEGIN, PRELOAD_END),
    swBlock: extractBlock(swSrc, SW_BEGIN, SW_END),
    shell: parseArray(swSrc, 'SHELL', SW),
    diskFiles, disk, wiredSet: detectWired(urls),
  };
}

function selfcheck(base){
  const fails = [];
  const pick = (c, k) => c.find(x => x.name.startsWith(k));
  const expectRed = (label, mut, key) => {
    const r = pick(audit(mut), key);
    if (!r || r.ok) fails.push(`变异 ${label} 竟未让 ${key} 报红 —— 判据没牙`);
    else console.log(`  ✓ 负例 ${label} ⇒ ${key} 报红 — ${r.detail}`);
  };
  const macaw = base.manifest.assets.find(a => a.url.endsWith('Macaw.glb')) || base.manifest.assets.find(a => a.precache);
  // A：只从 sw.js 生成段抹掉一件（复现 2026-10-02 鹦鹉漏登记的形状）
  expectRed(`A（从 GLBS 段抹掉 ${macaw.url}）`,
    { ...base, swBlock: base.swBlock.split('\n').filter(l => !l.includes(macaw.url)).join('\n') }, 'G2');
  // A2：manifest 里删掉一件、磁盘还在（= 新资产忘了登记）
  expectRed(`A2（manifest 删掉 ${macaw.url}）`,
    { ...base, manifest: { ...base.manifest, assets: base.manifest.assets.filter(a => a !== macaw) } }, 'G3');
  // B：bytes 改错
  const mB = structuredClone(base); mB.manifest.assets[0].bytes += 12345;
  expectRed(`B（${mB.manifest.assets[0].url} 的 bytes +12345）`, mB, 'G4');
  // B2：预载段被手改（bytes 不再是生成值）
  expectRed('B2（手改 PRELOAD_MANIFEST 段）', { ...base, preloadBlock: base.preloadBlock.replace(/bytes: (\d+)/, (m, n) => `bytes: ${Number(n) + 1}`) }, 'G1');
  // C：SHELL 缺 vendor.js
  expectRed('C（SHELL 抹掉 vendor.js）', { ...base, shell: base.shell.filter(u => u !== 'vendor.js') }, 'G5');
  // D：抹掉一件的接线
  const victim = [...base.wiredSet][0];
  if (!victim) fails.push('变异 D 无法进行：wiredSet 为空');
  else expectRed(`D（抹掉 ${victim} 的接线）`, { ...base, wiredSet: new Set([...base.wiredSet].filter(u => u !== victim)) }, 'G6');
  // E：precache 与 phase 不一致（懒加载件被标成回填）
  const mE = structuredClone(base); const lazy = mE.manifest.assets.find(a => a.phase === 'lazy');
  if (lazy){ lazy.precache = true; expectRed(`E（${lazy.url} lazy 却 precache）`, mE, 'M0'); }

  const red = audit(base).filter(c => !c.ok);
  if (red.length) fails.push(`阳性对照失败：未变异输入红了 ${red.length} 项（${red.map(c => c.name.split('：')[0]).join('、')}）`);
  else console.log('  ✓ 阳性对照：未变异的输入全绿');
  console.log(`\n[preload-manifest-sync] 自检 ${fails.length ? 'FAILED' : 'ALL PASS'}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  return fails.length === 0;
}

if (process.argv.includes('--selfcheck')) process.exit(selfcheck(collect()) ? 0 : 1);

let base = null, checks;
try { base = collect(); checks = audit(base); }
catch (e){ checks = audit({ headOk: false, headErr: e.message }); }

console.log(`  ── 资产清单一致性（${MANIFEST} ↔ 磁盘 ↔ ${PRELOAD} / ${SW} 生成段）──`);
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
console.log('\n  ── 负例自检（探针自证能红）──');
const selfOk = base && checks.every(c => c.name.startsWith('M0') ? c.ok : true) && base.preloadBlock !== null && base.swBlock !== null
  ? selfcheck(base) : (console.log('  ✗ 材料不完整，自检无法进行'), false);
const red = checks.filter(c => !c.ok);
console.log(`\n[preload-manifest-sync] ${red.length === 0 && selfOk ? 'ALL PASS' : red.length + ' FAILED'}（${checks.length} 项判据 + 自检 ${selfOk ? 'PASS' : 'FAILED'}）`);
if (red.length){
  for (const c of red) console.log(`    ✗ ${c.name} — ${c.detail}`);
  console.log('  ⚠️ 修法：改 assets/manifest.json → node tools/gen-asset-manifest.mjs --write；资产内容变了再升 sw.js 的 ASSET_CACHE。');
}
process.exit(red.length === 0 && selfOk ? 0 : 1);
