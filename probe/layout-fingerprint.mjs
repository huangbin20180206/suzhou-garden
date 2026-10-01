// 布局指纹门禁（T0 · 2026-09-23）：**"全局随机流守恒"（铁律 1）唯一的机器守卫**。
//
// 为什么需要它：
//   铁律 1 说"在既有函数里增删一次 rr()/rnd()，其后所有抽样整体后移，而且不报任何错"。
//   项目现有唯一的自证是 `peach-form-guard` 的"叶包围盒/主干高/夏 fill 逐位一致"——
//   但那**只覆盖桃树自己的本地流**，对**全局流**零信息量（见铁律 7：证据作用域 ≠ 结论作用域）。
//   本门把"全园布局有没有漂"变成可测量：把场景里**所有静态 InstancedMesh 的实例矩阵**做哈希。
//
// 为什么以前做不到（实测，2026-09-23 两个独立原因，**都已修**）：
//   ① 没有"装配完成"的时刻：deferBoot 是"每帧一个 job"，探针只能猜时间 ⇒ 采样时刻不同
//      ⇒ 同一份代码连测两次都不一致（InstancedMesh 数 158/160/161、竹叶实例数 41202/41643/42309）。
//      修法：`__garden.bootDonePromise`（08-assemble 的 markBootDone，落点在延迟批四步之后）。
//   ② 全局流被**异步回调**消耗：koi 的 onLoad 里 rr()×44、泳龟的 onLoad 里 rr()×8（共 52 次）。
//      onLoad 何时执行取决于模型何时加载完（冷/热启动不同），而延迟批（柳/竹/立峰）在首帧后才跑
//      ⇒ 落在其后的延迟批看到的流偏移每次都不同。实测：两次加载 157 个网格里 **76 个不同，
//      且全部落在延迟批**（柳叶 7992 vs 7995、竹竿首实例 (−0.09,0,0.90) vs (0.84,0,0.32)），
//      模块期网格逐个逐实例一致。
//      修法：把那 52 次抽取**预抽到模块期**（06-vegetation 的 KOI_DRAW / 08-assemble 的
//      SWIM_TURTLE_DRAW），异步回调只读不抽 —— 布局从此与"资产何时加载完"无关。
//   ③ 布局自己吃**共享的 `Math.random`**（柳帘条件 push、柳/竹洗牌、莲蓬材质选择…），而这条流
//      同时被"时序类"代码消费（Three.js 每 `new` 一个对象生成 UUID 就抽 4 次、涟漪、音景…）
//      ⇒ 布局拿到的值随**加载时序**错位：位置/顺序变（只改哈希），有时连它消耗的 `rnd` 次数都变
//      （实测冷启动 流总数 996320 vs 热启动 999246，竹叶 41989 vs 42230，竹竿首实例坐标全不同）。
//      决定性对照：把 `Math.random` 换成**常量**后 4 连跑（含冷启动）逐位一致 ⇒ 元凶确认。
//      修法：布局类 `Math.random` 全部改走**各自的专用种子流**（06-vegetation / 08-assemble 的 `jr`），
//      运行期效果（涟漪抖动、音景、风场调度）继续用 Math.random —— 它们不影响布局。
//      ⇒ 现在本门**不冻结** Math.random（跑真实条件）；4 连跑含冷启动逐位一致。
//      ⚠️ 红线：谁把布局再接回共享 `Math.random`，本门会以**偶发红**报出来 —— 那是真缺陷，
//         别用"再冻结一次 Math.random"盖掉，正解是给那块布局自己的种子流。
//
// 用法：
//   node probe/layout-fingerprint.mjs                  # 与基线比对（门禁用）
//   node probe/layout-fingerprint.mjs --update-baseline # 有意改布局后重新基线（并在 commit 里写明）
//   node probe/layout-fingerprint.mjs --selfcheck       # 自检：3 连跑指纹必须逐位相同 + "戳一下"必须变
//
// ⚠️ 本门是**纯状态门（零像素）** ⇒ 不受 GPU 档位/并发负载影响（铁律 6 对它无效），比像素门可靠。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'probe', '_baseline', 'layout-fingerprint.txt');
const MODE = process.argv.includes('--selfcheck') ? 'selfcheck'
           : process.argv.includes('--update-baseline') ? 'update' : 'compare';

function loadPlaywright(){
  const require2 = createRequire(import.meta.url);
  try { return require2('playwright'); } catch {}
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require2(path.join(g, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/* 采样一次：等信号 → 锁状态 → 取指纹。**顺序不能变**，理由见下。 */
async function sample(page, { poke = false } = {}){
  await page.evaluate(async () => {
    const g = window.__garden;
    await Promise.race([
      g.bootDonePromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('bootDonePromise 120s 未 resolve')), 120000)),
    ]);
    /* 锁状态：竹叶实例数随季节变（春 0.28 / 夏 1.0 / 秋 0.43 / 冬 0.33），不锁会假红。
       时辰也要锁（灯光/雾/天空影响的是像素，与实例矩阵无关，但锁上更稳）。 */
    g.setEnv('season', 'summer');
    const el = document.getElementById('hourSlider');
    el.value = '12.5'; el.dispatchEvent(new Event('input'));
    g.ENV.t = 0.994;
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  return page.evaluate(({ poke }) => {
    const g = window.__garden, THREE = g.THREE;
    /* ⚠️ 排除**动画驱动**的实例（显式名单，不用启发式 —— 启发式会静默漏/误纳）：
         · mistField：位置在 shader 的 aBase 属性里算，实例矩阵是单位阵；
         · 涟漪池：RingGeometry，**逐帧写矩阵**（涟漪在动）。
       其余 InstancedMesh 的矩阵都是"建场时一次写定"的常量 ⇒ 它们才是全局随机流的产物。 */
    /* ⚠️ 排除两类**逐帧动画驱动**的网格（2026-10-02 加第二个）——它们不是"布局"：
     ① mistField：位置在 shader 的 aBase 属性里、uOpacity 每帧变；
     ② smallBirdMesh：踱步/啄毛/理羽连续动 ⇒ **采样时刻的相位决定矩阵** ⇒
        两次加载的哈希必然不同（实测首实例相同、哈希不同——这是"采样相位"不是布局漂移）。
        位置/落点/行为的守卫交给 birds-guard（它本来就查"石上鸟在石面上、
        在最高的假山、有持续动作"）。若以后再加"每帧写矩阵"的实例网格，也要来这里登记。 */
  const EXCLUDE_NAME = new Set(['mistField', 'smallBirdMesh']);
    const EXCLUDE_GEOM = new Set(['RingGeometry']);
    const rows = [];
    let global = 0;
    g.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.geometry) return;
      if (EXCLUDE_NAME.has(o.name) || EXCLUDE_GEOM.has(o.geometry.type)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const mm = new THREE.Matrix4();
      /* ⚠️ 自检用的"戳一下"必须在**哈希之前**（2026-09-23 修）：原来写在哈希之后 ⇒ 本轮哈希里
         压根不含被戳过的矩阵 ⇒ "戳了却不变"永远成立。它此前能通过，纯粹是因为布局本来就在漂
         （两次采样天然不同）—— 判据不能靠"被测对象正好在漂"才有牙。 */
      if (poke){
        o.getMatrixAt(0, mm);
        mm.elements[12] += 0.001;
        o.setMatrixAt(0, mm);
        o.instanceMatrix.needsUpdate = true;
      }
      let h = 2166136261 >>> 0;
      for (let i = 0; i < o.count; i++){
        o.getMatrixAt(i, mm);
        for (const e of mm.elements){ h ^= (Math.round(e * 1e5) | 0); h = Math.imul(h, 16777619) >>> 0; }
      }
      o.getMatrixAt(0, mm);
      const p0 = new THREE.Vector3().setFromMatrixPosition(mm);
      rows.push({
        key: `${m && m.color ? '#' + m.color.getHexString() : '-'}|${o.count}|${o.geometry.type}`,
        count: o.count, first: `${p0.x.toFixed(2)},${p0.y.toFixed(2)},${p0.z.toFixed(2)}`,
        hash: h >>> 0,
      });
      global = (Math.imul(global, 16777619) >>> 0) ^ (h >>> 0);
    });
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return { rows, global: global >>> 0 };
  }, { poke });
}

const render = (fp) => [
  `# 布局指纹基线（T0）网格数=${fp.rows.length} 总指纹=${fp.global}`,
  `# 采样条件：bootDonePromise 已 resolve → season=summer → hour=12.5 → ENV.t>=1 → settle 2 帧`,
  `# 排除：name∈{mistField}、geom∈{RingGeometry}（动画驱动，非流产物）`,
  ...fp.rows.map(r => `${r.key}\t首实例=${r.first}\thash=${r.hash}`),
].join('\n') + '\n';

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  /* ── 不再冻结 Math.random（2026-09-23 收尾）────────────────────────────
     这里曾经用 addInitScript 把 Math.random 换成定种子流，好让本门只量"全局随机流"。
     根因查清后**已撤掉**：布局侧不再吃共享的 Math.random（06-vegetation / 08-assemble 的
     抖动、条件 push、洗牌全部改走各自的专用种子流 `jr`），所以本门现在跑的是**真实条件**，
     4 连跑（含冷启动、含真实 Math.random）逐位一致。
     ⚠️ 保留这条注释是为了**守住一条红线**：谁要是再把布局接回共享 `Math.random`，
        布局就会重新随"加载时序"漂（对象创建时的 UUID、涟漪、音景都在消费同一条流），
        本门会以**偶发红**报出来 —— 那是真缺陷，别用"再冻结一次 Math.random"把它盖掉，
        正确做法是给那块布局**自己的种子流**（同 jr 的写法）。 */

  const load = async () => {
    await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__garden && document.getElementById('loading')
      && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  };

  if (MODE === 'selfcheck'){
    /* 自检层①：3 连跑指纹必须逐位相同（证明"探针本身不是噪声源"）。
       ⚠️ 每次都要**重新加载页面**（新的一次装配），不能在同一页上连取 3 次 —— 那测不出装配时序。 */
    const fps = [];
    for (let i = 0; i < 3; i++){
      await load();
      const fp = await sample(page);
      fps.push(fp);
      console.log(`  第 ${i + 1} 次：网格=${fp.rows.length} 总指纹=${fp.global}`);
    }
    const same = fps.every(f => f.global === fps[0].global && f.rows.length === fps[0].rows.length);
    check('自检①：3 连跑（各开新页）指纹逐位相同', same,
          same ? `总指纹=${fps[0].global}` : `分别=${fps.map(f => f.global).join(' / ')}`);
    if (!same){
      /* 诊断：把"两次采样差在哪些网格"打出来 —— 只报总指纹对不上是查不出根因的。 */
      const k = (fp) => new Map(fp.rows.map(r => [r.key, r]));
      const a = k(fps[0]), b = k(fps[1]);
      const added = [...b.keys()].filter(x => !a.has(x));
      const gone = [...a.keys()].filter(x => !b.has(x));
      const diff = [...b.entries()].filter(([x, v]) => a.has(x) && a.get(x).hash !== v.hash).map(([x]) => x);
      console.log(`  [诊断] 第1次 ${fps[0].rows.length} 网格 / 第2次 ${fps[1].rows.length} 网格`);
      console.log(`  [诊断] 新增 ${added.length}：${added.slice(0, 8).join(' ｜ ') || '(无)'}`);
      console.log(`  [诊断] 消失 ${gone.length}：${gone.slice(0, 8).join(' ｜ ') || '(无)'}`);
      console.log(`  [诊断] 同键但哈希不同 ${diff.length}：${diff.slice(0, 8).join(' ｜ ') || '(无)'}`);
    }

    /* 自检层②：运行时"戳一下"实例矩阵 → 指纹必须变（证明哈希真在量实例矩阵，不是恒绿摆设）。 */
    await load();
    const base = await sample(page);
    await load();
    const poked = await sample(page, { poke: true });
    check('自检②：戳一下实例矩阵 ⇒ 指纹必须变（哈希真的在量它）',
          poked.global !== base.global, `${base.global} → ${poked.global}`);
  } else {
    await load();
    const fp = await sample(page);
    if (MODE === 'update'){
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, render(fp), 'utf8');
      console.log(`  ✓ 基线已更新：${path.relative(ROOT, BASELINE)}（网格 ${fp.rows.length}，总指纹 ${fp.global}）`);
      console.log('  ⚠️ 若这次布局改变是**有意**的，请在 commit message 里写明原因。');
    } else {
      if (!fs.existsSync(BASELINE)){
        check('基线文件存在', false, `缺 ${path.relative(ROOT, BASELINE)}；先跑 --update-baseline`);
      } else {
        /* ⚠️⚠️ **滤行只滤注释，绝不能滤 '#' 开头的数据行**（2026-10-02 修，真窟窿）：
           基线里每条数据行都以颜色十六进制开头（`#ffffff|117|PlaneGeometry…`），
           旧写法 `!l.startsWith('#')` 把**全部数据行滤光**，只剩 3 条无色（'-'）网格
           ——"与基线一致"实际只比了 3 个网格。实测坐实：BIRD_SCALE 2.2↔3.3
           总指纹 3830115668↔1092296036 明明变了，判据仍报"变化 0 新增 0 消失 0"恒绿。
           注释行的固定格式是 `# `（井号+空格），数据行是 `#<hex>|…`（井号+字符）——
           用 `'# '` 区分两者。 */
        const want = fs.readFileSync(BASELINE, 'utf8').split('\n').filter(l => l && !l.startsWith('# '));
        const got = render(fp).split('\n').filter(l => l && !l.startsWith('# '));
        /* ⚠️⚠️ **比较必须是"多重集合"，不能按键 Map**（同日修，第二个窟窿）：
           175 个网格里有 70 个键重复（键=#色|count|几何类型），`new Map()` 每键只留
           最后一条 ⇒ 同键的其余网格全部**静默不比**。多重集合比较 = 排序后逐行相等，
           任何一条的 hash 变 / 任何一条的增删都会被抓到（排序本身稳定：
           render() 先按 key 排序，同键行的次序继承自确定性的场景遍历序）。 */
        const wantS = [...want].sort();
        const gotS = [...got].sort();
        const linesEqual = wantS.length === gotS.length && wantS.every((l, i) => l === gotS[i]);
        /* 键级诊断（只是给人看的明细；判定看上面的多重集合） */
        const wantMap = new Map(want.map(l => [l.split('\t')[0], l]));
        const gotMap = new Map(got.map(l => [l.split('\t')[0], l]));
        const changed = [...gotMap.entries()].filter(([k, v]) => wantMap.has(k) && wantMap.get(k) !== v).map(([k]) => k);
        const added = [...gotMap.keys()].filter(k => !wantMap.has(k));
        const removed = [...wantMap.keys()].filter(k => !gotMap.has(k));
        const cntKey = (arr) => { const m = new Map(); for (const l of arr){ const k = l.split('\t')[0]; m.set(k, (m.get(k) || 0) + 1); } return m; };
        const wc = cntKey(want), gc = cntKey(got);
        const countMismatch = [...new Set([...wc.keys(), ...gc.keys()])].filter(k => (wc.get(k) || 0) !== (gc.get(k) || 0));
        console.log(`  [指纹] 网格 ${fp.rows.length} ｜ 总指纹 ${fp.global} ｜ 变化 ${changed.length} 新增 ${added.length} 消失 ${removed.length} 同键条数不齐 ${countMismatch.length}`);
        changed.slice(0, 6).forEach(k => console.log(`    · 变了：${k}\n        基线 ${wantMap.get(k)}\n        现在 ${gotMap.get(k)}`));
        added.slice(0, 6).forEach(k => console.log(`    · 新增：${gotMap.get(k)}`));
        removed.slice(0, 6).forEach(k => console.log(`    · 消失：${wantMap.get(k)}`));
        countMismatch.slice(0, 6).forEach(k => console.log(`    · 同键条数不齐：${k}（基线 ${wc.get(k) || 0} 条 / 现在 ${gc.get(k) || 0} 条 —— Map 比较会静默吞掉这类差异）`));
        check('布局指纹与基线一致（全局随机流未漂）',
              linesEqual,
              linesEqual ? '' : '若有**有意**改布局，请跑 --update-baseline 并在 commit 里写明原因');
      }
    }
  }

  check('零 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[layout-fingerprint] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[layout-fingerprint] 探针自身异常：', e); process.exit(1); });
