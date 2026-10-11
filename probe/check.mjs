// 语法门禁：抽取 index.html 的内联 <script type="module"> 存成临时 .mjs，
// 用 node --check 做纯解析校验（不执行、不需要浏览器），一秒内出结果。
// 顺带校验 build-entry.js。npm run check。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('check: 未找到内联 module script'); process.exit(1); }

const tmp = path.join(os.tmpdir(), 'suzhou-garden-inline-check.mjs');
fs.writeFileSync(tmp, m[1]);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'build-entry.js')], { stdio: 'pipe' });
  /* ⚠️ 必须顺带 check src/*.js：内联脚本是**独立解析**的，它 import 的模块语法坏掉
     这里看不出来（--check 不解析依赖）。而拆模块的流程恰恰是"每节搬完立刻跑 check"——
     不覆盖 src 的话，这一步对一个搬残的模块完全瞎，只能等浏览器跑到才炸。 */
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort();
  for (const f of srcFiles) execFileSync(process.execPath, ['--check', path.join(ROOT, 'src', f)], { stdio: 'pipe' });
  /* ── PWA 缓存版本门禁（2026-09-23 · sw.js 纳入白名单时一并加）──
     病因（commit 77ccc60，老黄："这难道不是你程序上的 bug 吗"）：改完要刷两次才生效。
     策略已改成 代码类 network-first / 大件 cache-first，于是两条规则**分开守**：
       · `src/*.js`、`vendor.js`、`index.html` → network-first ⇒ **不需要** bump，改了即所见；
       · `assets/*.glb`、`icons/`、`docs/` → cache-first ⇒ **改了必须 bump `CACHE`**，
         否则已装 SW 的浏览器永远吃旧副本（`70ca3ab` 改过 LotusPlant.glb 却没 bump，
         那批客户端可能至今还在用旧贴图 —— 改了看不见、且不报错）。
     判据用 mtime（不依赖 git），容差 2s。 */
  {
    const swPath = path.join(ROOT, 'sw.js');
    if (!fs.existsSync(swPath)) throw new Error('sw.js 缺失（PWA 离线三件套之一）');
    execFileSync(process.execPath, ['--check', swPath], { stdio: 'pipe' });
    const swSrc = fs.readFileSync(swPath, 'utf8');
    const ver = (swSrc.match(/const CACHE = 'suzhou-garden-(v\d+)'/) || [])[1];
    if (!ver) throw new Error("sw.js 未声明 `const CACHE = 'suzhou-garden-vN'`");
    /* ⚠️ 2026-09-23 收窄作用域（审核 A · 修假红）：原来扫 `assets/*.glb` + `icons/` + `docs/`
       **整个目录**，于是**任何**新文件都会被判"改了要 bump"。实测反例：往 docs/ 放一份评审文档
       就把 check 判红，而那份文件页面根本不请求、根本不需要换缓存 ⇒ **判据与结论不对应（假红）**，
       正是 §0.4-2「判据是否特异」那一类。
       正解：只对 **sw.js 里真正声明进 SHELL / GLBS 的那几件**判 mtime；
       同目录里其余文件（README 配图、说明文档）与 SW 缓存无关，一律不管。 */
    const arrBody = (name) => (swSrc.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`)) || [])[1] || '';
    const rels = [...(arrBody('SHELL') + arrBody('GLBS')).matchAll(/'([^']+)'/g)];
    const declared = rels.map(m => m[1].replace(/^\.\//, ''));
    /* ⚠️⚠️ 2026-10-11：**两个桶、两条纪律**（见 sw.js 顶部注释）。
       SHELL 进带应用版本号的桶（升版 = 换壳）；GLBS 进 `suzhou-garden-assets-vN`（跨应用版本存活）。
       ⇒ 判据也必须分开：**改了模型要升 ASSET_CACHE 的后缀，而不是升 CACHE**
         （反过来的话，用户以为"升版了"，其实旧模型照旧吃着）。 */
    const assetVer = (swSrc.match(/const ASSET_CACHE = 'suzhou-garden-assets-(v\d+)'/) || [])[1];
    if (!assetVer) {
      throw new Error("sw.js 未声明 `const ASSET_CACHE = 'suzhou-garden-assets-vN'` —— "
        + '资产桶必须带自己的版本后缀（改了模型才能靠它失效，否则用户永远吃旧的那一份）');
    }
    const shellSet = new Set([...arrBody('SHELL').matchAll(/'([^']+)'/g)].map(m => m[1].replace(/^\.\//, '')));
    const frozenShell = [], frozenAssets = [];
    for (const rel of declared) {
      if (/\.(js|mjs|html|webmanifest)$/.test(rel)) continue;   // 代码类走 network-first，改了即所见、不需 bump
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      (shellSet.has(rel) ? frozenShell : frozenAssets).push(p);
    }
    const swM = fs.statSync(swPath).mtimeMs;
    const staleShell = frozenShell.filter(p => fs.statSync(p).mtimeMs > swM + 2000);
    if (staleShell.length) {
      throw new Error(`cache-first 的应用壳文件比 sw.js 新，必须把 CACHE 从 ${ver} 升到 v${Number(ver.slice(1)) + 1}：\n`
        + staleShell.map(p => '        · ' + path.relative(ROOT, p)).join('\n')
        + '\n      否则已装 SW 的浏览器会一直吃旧副本（改了看不见，且不报错）');
    }
    const staleAssets = frozenAssets.filter(p => fs.statSync(p).mtimeMs > swM + 2000);
    if (staleAssets.length) {
      throw new Error(`模型资产比 sw.js 新，必须把 ASSET_CACHE 从 ${assetVer} 升到 v${Number(assetVer.slice(1)) + 1}`
        + '（**不是**升 CACHE —— 资产桶跨应用版本存活，升 CACHE 不会让旧模型失效）：\n'
        + staleAssets.map(p => '        · ' + path.relative(ROOT, p)).join('\n'));
    }
    console.log(`      PWA：sw.js 语法 OK · 应用壳 ${ver}（${frozenShell.length} 件）/ 资产桶 ${assetVer}`
      + `（${frozenAssets.length} 件）均未越过版本号 ✓`);
    /* ── 画布兜底底色（2026-10-11 · 静态）──────────────────────────────────────
       为什么必须常驻：three r184 申请 WebGL 上下文时把 `alpha` **硬写成 true**
       （vendor.js 里 `let S={alpha:!0,depth:a,...}`，与构造参数无关）⇒ 这个画布**天生允许透明**。
       于是只要某一帧有哪个区域没被画到（运行期改分辨率/合成层面的意外），那块就 α=0、
       **直接透出 `html,body` 的底色 `#D8DCDA`** —— 观感就是"一大块惨白的屏幕"
       （老黄 2026-10-11 报的那张图：那块白逐像素等于 #D8DCDA、完美轴对齐矩形、纯色无内容）。
       给画布一层不透明深色底之后，同样的意外只会留一块**暗斑**（夜里几乎看不出）。
       判据只钉"这条规则在不在、且不是 transparent/none"—— 它是**兜底**，不是根因修复。 */
    const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const bgRule = (htmlSrc.match(/#app\s+canvas\s*\{[^}]*\}/) || [])[0] || '';
    const bgVal = (bgRule.match(/background\s*:\s*([^;}]+)/) || [])[1] || '';
    if (!/rgb|#|hsl|var\(/.test(bgVal) || /transparent|none/i.test(bgVal)) {
      throw new Error('index.html 缺少 `#app canvas{background:<不透明色>}` 兜底 —— '
        + `当前匹配到：${bgRule || '（没有这条规则）'}\n`
        + '      画布上下文 alpha 恒为 true（three r184 的行为）⇒ 没画到的区域会透出网页底色 #D8DCDA，\n'
        + '      看起来就是"一大块白屏"。这层底色把它降级成暗斑，别删（见 index.html 里那段注释）。');
    }
    console.log(`      画布兜底底色：${bgVal.trim()} ✓（防"没画到的区域透出网页白底"）`);
  }
  /* ── 未定义标识符门禁（no-undef · 2026-10-02 · ESLint flat config）──
     病因（src/08-assemble.js 实录）：`b.preen` 误写成 `b.peen`，undefined*13 产 NaN，
     被 `p.yaw = b.yaw + (b.yawOff || 0)` 的 `||0` 静默吃掉 —— 语法门（--check）全绿，
     53 道浏览器门禁也全绿，只有那个动作消失。本层用 ESLint no-undef 做**真·作用域分析**：
     裸用未定义标识符（忘 import 的模块名 / 写错的变量名 / 给未声明变量赋值）在此报红，
     它们运行期要么 ReferenceError、要么产 NaN 被 `||0` 之类静默吞掉 —— 两样都看不见。
     范围：src/*.js + index.html 内联主模块（lintText 以虚拟文件名 index-inline.mjs 喂入，
     flat config 里有对应 files 条目）+ build-entry.js + sw.js。配置：eslint.config.mjs。
     ⚠️ 边界（如实声明）：**属性链上的拼写**（`b.peen` 是属性访问）不归本层管 ——
     no-undef 只判"标识符是否声明过"，不判"对象的属性存不存在"；那要另做
     "对象自身属性名校验"才抓得住，本层不装能抓。
     ⚠️ eslint 是 devDependency，而本机 npm 配置 omit=dev：普通 `npm install` 不装它。
     缺件时这里**必须红**（门禁没牙 = 没有门禁），并给出复装命令。 */
  {
    let ESLint;
    try { ({ ESLint } = await import('eslint')); }
    catch {
      throw new Error('no-undef 检查需要 eslint，但 node_modules 里没有（本机 npm 配置 omit=dev 会跳过 devDependencies）。跑一次 `npm install --include=dev` 再重试。');
    }
    const eslint = new ESLint({ cwd: ROOT });
    const results = await eslint.lintFiles([...srcFiles.map(f => 'src/' + f), 'build-entry.js', 'sw.js']);
    results.push(...await eslint.lintText(m[1], { filePath: 'index-inline.mjs' }));
    const relOf = p => path.isAbsolute(p) ? path.relative(ROOT, p) : p;
    const bad = [];
    for (const r of results) for (const msg of r.messages)
      if (msg.severity === 2) bad.push(`        · ${relOf(r.filePath)}:${msg.line}:${msg.column}  ${msg.message}  (${msg.ruleId})`);
    if (bad.length) {
      throw new Error(`no-undef：${bad.length} 处裸用未定义标识符（多为忘 import / 写错变量名，页面加载或运行期必炸，或被 ||0 之类静默吞掉）：\n` + bad.join('\n'));
    }
    console.log(`      no-undef：${results.length} 个编译单元（src ${srcFiles.length} + 内联主模块 + build-entry.js + sw.js）无未定义标识符 ✓`);
  }
  const lines = m[1].split('\n').length;
  console.log(`check: PASS（内联模块 ${lines} 行 + build-entry.js + src ${srcFiles.length} 个模块：${srcFiles.join(', ')}）`);
} catch (e) {
  console.error('check: FAIL\n' + (e.stderr || e.message));
  process.exit(1);
} finally {
  fs.rmSync(tmp, { force: true });
}
