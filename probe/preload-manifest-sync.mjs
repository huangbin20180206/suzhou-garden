// 预载清单一致性门禁（纯 node / 读文本 / 不发网络请求 / <1s）
//
// ── 为什么要有这一门（2026-10-03 新增）─────────────────────────────────────
// `sw.js` 的 GLBS 与 `src/13-preload.js` 的 PRELOAD_MANIFEST 是**同一批资产的两个投影**，
// 这件事写在 sw.js 的注释里、也写在 13-preload.js 的注释里 —— 但**在此之前没有任何门禁把守**。
//
// 实测漏了两批：2026-10-02 加金刚鹦鹉（Macaw.glb，1.49 MB）时只改了 13-preload、漏了 sw.js，
// 而全套 55 道门**全绿**。为什么绿：
//   · `check.mjs` 的 PWA 判据只做两件事 —— sw.js 有 CACHE 声明、**sw.js 里声明过的**
//     cache-first 资产没有比 sw.js 新。它遍历的是 `SHELL + GLBS` 数组**本身**，
//     所以"清单里少了一件"这件事它从定义上就看不见（Macaw.glb 根本不在 GLBS 里、比对不到，
//     哪怕它比 sw.js 新 22 小时）；
//   · 其余门禁（pwa-cache / pwa-cold-restart）验的是"已声明的资产能否离线拿到"，
//     缺的那件不在它们的正向清单上 ⇒ 同样看不见。
//
// ── 危害是**分场景静默**的（这才是它值得单独成门的理由）────────────────────
//   · 在线首开：一切正常 —— `.glb` 走 fetch 之后会被 SW 运行时写进缓存，什么都不会报；
//   · **装成 PWA 后断网首开**：Macaw.glb 不在预缓存里 ⇒ 拿不到 ⇒ 但它是 `required:false`，
//     不阻塞开园 ⇒ 只是"假山上没有鹦鹉"，且进度条那一刻反而显示的是"正在下载"
//     （与"装了 PWA 就该能离线打开、进度条不该有真进度"的既有断言**正好相反**）。
//   ⇒ 这是本项目最高发的缺陷形状：**状态全对、计数全对、门禁全绿，只有换个场景看才现形**。
//
// ── 判据（四层）──────────────────────────────────────────────────────────
//   G1 正向：13-preload 的每一项都必须在 sw.js GLBS 里（漏 ⇒ PWA 离线首开缺件）
//   G2 反向：sw.js GLBS 的每一项都必须在 13-preload 里（多 ⇒ 重复下载 + 进度条走后网络）
//   G3 反向扫磁盘：assets/*.glb 每一件都必须在两份清单里（新加资产忘了登记 ⇒ 报红）
//   G4 bytes：13-preload 声明的 bytes 必须等于磁盘实测（否则进度条卡在怪数，见该文件头部）
//   G5 SHELL：应用壳成员齐全（漏一件 = 离线打开缺一块）
//   G0 自检：把 Macaw 从 GLBS 里抹掉 / 把某个 bytes 改错 ⇒ **G1 / G4 必须报红**
//           （探针自己证明判据有牙 —— 沿用 weather-coverage 的 G0 自检惯例）
//
// ⚠️ 边界（如实声明）：本门**只判清单与磁盘的文字级一致**，不判"缓存策略对不对"
//    （那是 check.mjs 的 mtime 判据 + pwa-cache.mjs 的断网实测的职责）。
// ⚠️ 注意区分：`assets/thunder.mp3` **故意不在**预载清单里（雷声是懒加载的点缀音效，
//    不在"开园前必须到位"的范畴）⇒ G3 的反向扫描只扫 `*.glb`，并把这条写进白名单理由。
//
// 用法: node probe/preload-manifest-sync.mjs
//       node probe/preload-manifest-sync.mjs --selfcheck   （只跑负例自检）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW = 'sw.js';
const PRELOAD = 'src/13-preload.js';
const ASSET_DIR = 'assets';

/* ── 反向扫描白名单：assets/ 里**故意**不进预载清单的东西，必须写理由 ──────────
   只有写了理由才放行 —— 否则"新加了个资产忘了登记"会被悄悄放过（正是本门要治的病）。 */
const ASSET_EXEMPT = new Map([
  ['thunder.mp3', '雷声：懒加载的点缀音效（闪电时才取），不在"开园前必须到位"的范畴'],
]);

const norm = (p) => String(p).replace(/^\.\//, '');
const uniq = (a) => [...new Set(a)];

/* ── 解析（纯文本 / 正则；这些文件都是手写常量表，格式稳定）──────────────────
   ⚠️ 解析失败**必须**报红，不能静默当成"空清单" —— 空 ⊂ 空 会让一切判据假绿，
      而那正是本门存在的理由。所以 parse 失败一律抛错（由 run() 落成一条失败判据）。 */
function parseArray(src, name, file){
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\n\\];`));
  if (!m) throw new Error(`${file} 里找不到 \`const ${name} = [...]\` 数组（解析失败 —— 拒绝以「空清单」继续）`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => norm(x[1])).filter(s => s !== '');
}
function parseManifest(src, file){
  const m = src.match(/export const PRELOAD_MANIFEST = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error(`${file} 里找不到 \`export const PRELOAD_MANIFEST = [...]\`（解析失败）`);
  const out = [];
  for (const o of m[1].matchAll(/\{([^{}]*)\}/g)){
    const body = o[1];
    const url = (body.match(/url:\s*'([^']+)'/) || [])[1];
    if (!url) continue;
    const b = (body.match(/bytes:\s*(\d+)/) || [])[1];
    out.push({ url: norm(url), bytes: b === undefined ? null : Number(b) });
  }
  if (!out.length) throw new Error(`${file} 的 PRELOAD_MANIFEST 解析出 0 项（拒绝以「空清单」继续）`);
  return out;
}

const readIf = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : null);

/* ── 判据全部写成一个**纯函数**：入参是四份材料，出参是 checks[]
   这么做是为了让 --selfcheck 能喂"变异副本"进来（不必真去改磁盘上的文件，
   也就不会出现"自检跑完忘了还原"这种把仓库改坏的事故）。 */
/* ⚠️ headOk 必须**默认 true**：collect() 成功时返回的对象里没有这个键，
   若默认成 undefined（falsy），所有判据都会走"解析失败"分支 ⇒ 自检全线"假红"，
   而"自检失败"又会把主门一起拖红。第一版就是这么栽的（7 项主判据全绿、4 条自检全假红）。 */
function audit({ shell, glbs, manifest, diskGlbs, diskBytes, headOk = true, headErr = '' }){
  const checks = [];
  const ck = (name, ok, detail) => checks.push({ name, ok, detail });

  /* 解析层：任何一处解析失败直接整体判红（不给后续判据假绿的机会） */
  if (!headOk){
    ck('头部：sw.js / 13-preload.js 均可解析', false, headErr);
    return checks;
  }
  ck('头部：sw.js / 13-preload.js 均可解析', true, `GLBS ${glbs.length} 项 · 清单 ${manifest.length} 项`);

  const swSet = new Set(glbs);
  const mfSet = new Set(manifest.map(x => x.url));

  /* G1 正向：清单里有的，sw.js 必须有 */
  const missingInSw = [...mfSet].filter(u => !swSet.has(u));
  ck('G1 正向：13-preload 的每一项都在 sw.js 的 GLBS 里（漏则 PWA 离线首开缺件）',
     missingInSw.length === 0,
     missingInSw.length ? `sw.js 缺 ${missingInSw.length} 项：${missingInSw.join('、')}` : `${mfSet.size} 项全部对上`);

  /* G2 反向：sw.js 里有的，清单必须有 */
  const missingInMf = [...swSet].filter(u => !mfSet.has(u));
  ck('G2 反向：sw.js 的每一项都在 13-preload 的 PRELOAD_MANIFEST 里（多则重复下载 + 进度条走网络）',
     missingInMf.length === 0,
     missingInMf.length ? `清单缺 ${missingInMf.length} 项：${missingInMf.join('、')}` : `${swSet.size} 项全部对上`);

  /* G3 反向扫磁盘：磁盘上的每个 .glb 都该在两份清单里 */
  const stray = diskGlbs.filter(u => !swSet.has(u) && !mfSet.has(u) && !ASSET_EXEMPT.has(path.basename(u)));
  ck('G3 反向扫磁盘：assets/*.glb 每一件都登记进了两份清单（新资产忘了登记即报红）',
     stray.length === 0,
     stray.length ? `未登记 ${stray.length} 件：${stray.join('、')}` : `磁盘 ${diskGlbs.length} 件全部已登记`);

  /* G3b 白名单自清：白名单里的文件若已消失（或已被登记进清单），说明该条理由过期了 */
  const staleExempt = [...ASSET_EXEMPT.keys()]
    .filter(f => !diskGlbs.includes(`${ASSET_DIR}/${f}`) && !fs.existsSync(path.join(ROOT, ASSET_DIR, f)));
  ck('G3b 白名单自清：ASSET_EXEMPT 里的文件仍然存在（条目过期就要删，避免白名单变成黑洞）',
     staleExempt.length === 0,
     staleExempt.length ? `已不存在：${staleExempt.join('、')}` : `${ASSET_EXEMPT.size} 条理由全部仍然适用`);

  /* G4 bytes 与磁盘一致 */
  const badBytes = [];
  for (const it of manifest){
    const real = diskBytes[it.url];
    if (real === undefined){ badBytes.push(`${it.url}：磁盘上不存在`); continue; }
    if (it.bytes === null){ badBytes.push(`${it.url}：清单未声明 bytes`); continue; }
    if (it.bytes !== real) badBytes.push(`${it.url}：清单 ${it.bytes} vs 磁盘 ${real}（差 ${real - it.bytes}）`);
  }
  ck('G4 bytes：清单声明的字节数与磁盘实测一致（不一致会让进度条卡在怪数）',
     badBytes.length === 0,
     badBytes.length ? badBytes.join('；') : `${manifest.length} 项全部吻合`);

  /* G5 SHELL 成员完整 */
  const REQUIRED_SHELL = ['index.html', 'manifest.webmanifest', 'vendor.js', 'icons/garden.svg', 'docs/cover.jpg'];
  const shellSet = new Set(shell);
  const missShell = REQUIRED_SHELL.filter(u => !shellSet.has(u));
  ck('G5 SHELL：应用壳必需成员齐全（漏一件 = 离线打开缺一块）',
     missShell.length === 0,
     missShell.length ? `SHELL 缺：${missShell.join('、')}` : `${REQUIRED_SHELL.length} 件齐全（SHELL 共 ${shell.length} 项）`);

  return checks;
}

/* ── 材料采集：真实仓库现状 ─────────────────────────────────────────────── */
function collect(){
  const swSrc = readIf(SW);
  const mfSrc = readIf(PRELOAD);
  if (swSrc === null) throw new Error(`${SW} 不存在（PWA 离线三件套之一）`);
  if (mfSrc === null) throw new Error(`${PRELOAD} 不存在`);
  const shell = parseArray(swSrc, 'SHELL', SW);
  const glbs = parseArray(swSrc, 'GLBS', SW);
  const manifest = parseManifest(mfSrc, PRELOAD);
  const assetDirAbs = path.join(ROOT, ASSET_DIR);
  const diskGlbs = fs.readdirSync(assetDirAbs).filter(f => f.endsWith('.glb')).sort()
    .map(f => `${ASSET_DIR}/${f}`);
  /* assets/ 下**所有**文件都登记大小（含 thunder.mp3 这类非 .glb）：G4 只查清单里的项，
     G3 只扫 .glb，而白名单自清要用到非 .glb 的存在性。 */
  const diskBytes = {};
  for (const f of fs.readdirSync(assetDirAbs)){
    const rel = `${ASSET_DIR}/${f}`;
    if (fs.statSync(path.join(ROOT, rel)).isFile()) diskBytes[rel] = fs.statSync(path.join(ROOT, rel)).size;
  }
  return { shell, glbs, manifest, diskGlbs, diskBytes };
}

/* ── 自检（负例）：探针自证判据有牙 ──────────────────────────────────────
   变异 A ：只从 GLBS 抹掉 Macaw（**复现 2026-10-02 那个真实事故的形状**）⇒ G1 必须红
   变异 A2：从**两份清单都**抹掉 Macaw（= 新资产忘了登记）⇒ G3 必须红
            ⚠️ 这两条必须分开验：只抹一边时 G3 **不该**红（那件资产在另一份清单里，
            确实"登记过"，只是登记偏了）—— G1/G2 才是那个方向的责任判据。
            第一版把 A' 也写成"G3 必须红"，结果自检自己假红了一次。
   变异 B ：把某个 bytes 改错 ⇒ G4 必须红
   变异 C ：从 SHELL 抹掉 vendor.js ⇒ G5 必须红
   全部只在内存里改副本，不碰磁盘。 */
function selfcheck(base){
  const fails = [];
  const pick = (c, k) => c.find(x => x.name.startsWith(k));

  const mutA = { ...base, glbs: base.glbs.filter(u => !u.endsWith('Macaw.glb')) };
  const rA = pick(audit(mutA), 'G1');
  if (!rA || rA.ok) fails.push('变异 A（只从 GLBS 抹掉 Macaw.glb）竟未让 G1 报红 —— 判据没牙');
  else console.log(`  ✓ 负例 A：只从 GLBS 抹掉 Macaw.glb ⇒ G1 报红 — ${rA.detail}`);

  {
    const mutA2 = {
      ...base,
      glbs: base.glbs.filter(u => !u.endsWith('Macaw.glb')),
      manifest: base.manifest.filter(x => !x.url.endsWith('Macaw.glb')),
    };
    const r = pick(audit(mutA2), 'G3');
    if (!r || r.ok) fails.push('变异 A2（两份清单都抹掉 Macaw.glb）竟未让 G3 报红 —— 判据没牙');
    else console.log(`  ✓ 负例 A2：两份清单都抹掉 Macaw.glb（= 忘了登记）⇒ G3 报红 — ${r.detail}`);
  }

  const mutB = structuredClone(base);
  const victim = mutB.manifest.find(x => x.bytes !== null);
  victim.bytes = victim.bytes + 12345;
  const rB = pick(audit(mutB), 'G4');
  if (!rB || rB.ok) fails.push('变异 B（bytes +12345）竟未让 G4 报红 —— 判据没牙');
  else console.log(`  ✓ 负例 B：${victim.url} 的 bytes 改错 ⇒ G4 报红 — ${rB.detail}`);

  const mutC = { ...base, shell: base.shell.filter(u => u !== 'vendor.js') };
  const rC = pick(audit(mutC), 'G5');
  if (!rC || rC.ok) fails.push('变异 C（从 SHELL 抹掉 vendor.js）竟未让 G5 报红 —— 判据没牙');
  else console.log(`  ✓ 负例 C：从 SHELL 抹掉 vendor.js ⇒ G5 报红 — ${rC.detail}`);

  /* 阳性对照：不变的输入必须全绿，否则"能红"可能只是因为判据恒红 */
  const rOk = audit(base);
  const redOnClean = rOk.filter(c => !c.ok);
  if (redOnClean.length) fails.push(`阳性对照失败：未变异的输入不该红，却红了 ${redOnClean.length} 项（${redOnClean.map(c => c.name.split('：')[0]).join('、')}）`);
  else console.log(`  ✓ 阳性对照：未变异的输入 ${rOk.length} 项全绿`);

  console.log(`\n[preload-manifest-sync] 自检 ${fails.length === 0 ? 'ALL PASS' : 'FAILED'}（4 变异 + 1 阳性对照）`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  return fails.length === 0;
}

const SELF_ONLY = process.argv.includes('--selfcheck');
let ok = true;

if (SELF_ONLY){
  ok = selfcheck(collect());
  process.exit(ok ? 0 : 1);
}

/* ── 主路径 ─────────────────────────────────────────────────────────────── */
let base = null, checks = [];
try {
  base = collect();
  checks = audit({ ...base, headOk: true });
} catch (e){
  checks = audit({ shell: [], glbs: [], manifest: [], diskGlbs: [], diskBytes: {}, headOk: false, headErr: e.message });
}

console.log('  ── 预载清单一致性（sw.js GLBS ↔ 13-preload PRELOAD_MANIFEST）──');
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);

/* 负例自检**始终**跑（不只 --selfcheck 时跑）：没有自检的门禁等于没有门禁。
   若自检自己挂了，主门也无意义 ⇒ 一并判红。 */
console.log('\n  ── 负例自检（探针自证能红）──');
const selfOk = base ? selfcheck(base) : (console.log('  ✗ 材料采集失败，自检无法进行'), false);

const red = checks.filter(c => !c.ok);
const total = checks.length;
console.log(`\n[preload-manifest-sync] ${red.length === 0 && selfOk ? 'ALL PASS' : red.length + ' FAILED'}（${total} 项判据 + 自检 ${selfOk ? 'PASS' : 'FAILED'}）`);
if (red.length){
  console.log('  红项明细：');
  for (const c of red) console.log(`    ✗ ${c.name} — ${c.detail}`);
  console.log('  ⚠️ 修法：两份清单必须**同一批**（沿革见 sw.js 头部 CACHE 注释区与 13-preload.js 头部）；' +
              '改完记得 bump sw.js 的 CACHE 版本号。');
}
process.exit(red.length === 0 && selfOk ? 0 : 1);
