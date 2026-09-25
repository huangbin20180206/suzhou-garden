// 水面真折射「覆盖度」守卫（P2-5 复核补 · 第 22 门）
//
// 守的是**只能靠遍历场景**才看得见的一类缺陷：**该进折射层的东西没进去**。
// 折射贴图只渲 `LAYER_REFRACT` 这一层，所以任何"半浸在水里却忘了打标记"的几何，
// 都会在水面处被齐刷刷切断 —— 贴图内容没错、状态全对、开关注解全对，不报错不崩。
//
// ⚠️ 本门是被**真实缺陷**逼出来的：P2-5 交付时门禁只验了「11 条锦鲤在贴图里」，
//    即"作者想到要看的东西"，从没审过"还有谁该在里面"。复核时一跑就发现池中立峰
//    水下 1.24m、石矶 0.89m、两伴石、三张驳岸石实例网格、石根草叶全数缺席。
//    —— 判据来自作者的假设，而不是来自系统的事实。这是 AI 交付最典型的盲区。
//
// 三条判据：
//   ① **正向清单**：必须进层的对象逐个点名（漏掉/被覆盖 = 红）。
//      点名比"扫一遍看有没有漏"更强：它锁的是**结论**，改代码的人删掉一行标记就会红。
//   ② **反向扫描**：遍历全场景，凡"下探水面 >15cm 且压到池体"却不在层里的，逐个报出来；
//      只允许命中白名单的豁免（每条豁免都必须写**理由**，理由要能被反驳）。
//   ③ **白名单不能吞掉一切**：断言在层对象数 ≥ 下限 —— 否则有人把白名单写宽就假绿。
//
// ⚠️ 定性要用「中心在池内还是岸外」判：只报包围盒跨越，岸上的东西会因为 bbox 探进池内
//    而被误报（实测 36 个候选里一大半是这种假阳性）。
// 用法: node probe/refract-coverage.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/* 正向清单：名称 → 最少件数。名字是 mesh(...) 的 name 参数（已被门禁当测点用过，稳定）。
   ⚠️ 只列**该在层里的**，不是"场景里叫这个名字的全部"。例：`Turtle` 场景里有 6 个 ——
      2 只是泳龟（在层，要求 2），另 4 只是 `placeAssets` 放在石上晒背的静置龟
      （y≈0.30~0.34，高于水面 28cm，**本就不该进层**）。若谁把那 4 只放进水里，
      判据 ② 的几何扫描会立刻把它当成"池内无理由缺席"抓出来 —— 不用在这里重复点名。 */
const REQUIRED = [
  ['pondBed', 1], ['bank', 0],                    // bank 无名，故 0 允许；由下面的材质口径兜
  ['taihuHero', 1], ['taihuShelf', 1], ['taihuCompanion', 2],
  ['KoiFish', 11], ['Turtle', 2],
];
/* 无名对象的兜底口径：按材质色 + 是否实例化网格点名（驳岸石 / 水生植物都是无名 InstancedMesh） */
const REQUIRED_BY_COLOR = [
  ['#9a9a92', 3, '驳岸石三张实例网格'],
  ['#3f6b34', 3, '水生芦苇丛（水草 2 丛 + 石根草叶 1 丛）'],
];

(async () => {
  const port = await listenEphemeral(server);
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(150000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), { timeout: 150000 });
  await page.waitForFunction(() => window.__garden.koiGroup.userData.fishes.length >= 11, { timeout: 150000 });
  await new Promise(r => setTimeout(r, 3000));

  const out = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const WATER_Y = 0.06;                 // 水面 = CFG.water(0) + 0.06
    const MIN_DEPTH = 0.15;               // 只追"下探超过 15cm"的，浅跨界（藤叶根/袍角/地面 6cm）不是"透过水看得见"的范畴
    const MASK = 1 << G.refractInfo().layer;
    const RAD = G.POND_RADII, N = RAD.length;

    /* POND_RADII 是"从池心按角度射线到岸线"再乘 0.92 的表，所以 r − RAD[i] 是相对
       **收缩后**岸线的距离；只用它判符号（在池内/外），不用它的绝对量级。 */
    function shoreSigned(x, z){
      const lx = x, lz = z - 3;
      const r = Math.hypot(lx, lz);
      if (r < 1e-6) return -RAD[0];
      let a = Math.atan2(lz, lx); if (a < 0) a += Math.PI * 2;
      return r - RAD[Math.floor(a / (Math.PI * 2) * N) % N];
    }
    const colorOf = (o) => {
      const m = o.material;
      if (!m) return '?';
      if (Array.isArray(m)) return 'array';
      return m.name || (m.color ? '#' + m.color.getHexString() : '?');
    };

    /* ⚠️ bbox 中心在池内 ⇒ 判"池内"，对**环形**物体会误判：池岸草环 bank 的几何全在池外
       （1.0×~1.14× 岸线的一圈，2026-09-24 起它成"池岸缓坡"、外缘贴地形、下探水面 0.99m），
       但它的 bbox 中心正是池心 ⇒ 会被当成"池内无理由缺席"报红。
       补**两道**复核（取"或"，两道都失手才归"岸外跨界"）：① 有顶点落在池内；
       ② 从上方垂直下打射线命中它（占住池内空间）。
       复核**不会放过真缺陷**：真半浸在池里的几何必有顶点在池内、或必被射线命中
       —— 门禁自带负例自检（注入池心水面下的无名白网格必须被报出来）。 */
    function hasVertexInsidePond(o){
      if (o.isInstancedMesh || o.isPoints || !o.geometry || !o.geometry.attributes.position) return true;
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 400));
      const v = new T.Vector3();
      for (let i = 0; i < pos.count; i += step){
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
        if (shoreSigned(v.x, v.z) < -0.15) return true;
      }
      return false;
    }
    /* 第二道复核：在池内取 9 个采样点、从上方垂直下打射线，命中 ⇒ 它确实**占住池内空间**
       （环形物件的 hole 会让射线穿过；"横跨池面但顶点全在岸外"的大板会被这道抓住）。
       与 hasVertexInsidePond 取"或"：任一成立即按池内处理 ⇒ 两道都失手才会漏判。 */
    const _rc = new T.Raycaster(), _down = new T.Vector3(0, -1, 0);
    function occupiesPond(o){
      if (o.isInstancedMesh || o.isPoints || !o.geometry) return true;      // 保守：不改判
      const pts = [[0, 3]];
      for (let k = 0; k < 8; k++){
        const a = k / 8 * Math.PI * 2;
        const rr_ = RAD[Math.floor(a / (Math.PI * 2) * N) % N] * 0.55;
        pts.push([Math.cos(a) * rr_, 3 + Math.sin(a) * rr_]);
      }
      for (const [x, z] of pts){
        _rc.set(new T.Vector3(x, 50, z), _down);
        if (_rc.intersectObject(o, false).length) return true;
      }
      return false;
    }
    function scan(){
    const inLayer = [], untaggedInPond = [], untaggedCross = [];
    /* ⚠️ 判据 ① 必须**直接读 layer 标记**，不能复用下面那套几何扫描的结果：
       扫描有 15cm 下探阈值，而锦鲤是会游到水面附近的 —— 一旦某条鱼恰好贴着水面，
       它就不是"越水面 >15cm 的候选"，于是被漏掉、清单报 10/11 假红（实测就是这个坑）。
       "谁该在层里"和"谁越过了水面"是两个独立问题，别用一把尺子量。 */
    const named = {};
    const seen = new Set();
    G.scene.traverse(o => {
      if (o.name){
        const e = named[o.name] || (named[o.name] = { total: 0, tagged: 0 });
        e.total++;
        if ((o.layers.mask & MASK) !== 0) e.tagged++;
      }
      if (!(o.isMesh || o.isInstancedMesh || o.isPoints)) return;
      if (o.name === 'waterSurface') return;
      if (seen.has(o.uuid)) return;
      const box = new T.Box3().setFromObject(o);
      if (box.isEmpty() || !(box.min.y < WATER_Y - MIN_DEPTH)) return;
      let onPond = false;
      for (let i = 0; i <= 6 && !onPond; i++) for (let j = 0; j <= 6; j++){
        if (G.insidePond(box.min.x + (box.max.x - box.min.x) * i / 6,
                         box.min.z + (box.max.z - box.min.z) * j / 6 - 3)){ onPond = true; break; }
      }
      if (!onPond) return;
      seen.add(o.uuid);
      const c = box.getCenter(new T.Vector3());
      const size = box.getSize(new T.Vector3());
      const rec = {
        name: o.name || '(无名)', color: colorOf(o),
        verts: o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0,
        depth: +(WATER_Y - box.min.y).toFixed(2),
        span: +Math.max(size.x, size.z).toFixed(1),
        inPond: shoreSigned(c.x, c.z) < 0 && (hasVertexInsidePond(o) || occupiesPond(o)),
        inst: !!o.isInstancedMesh,
        tagged: (o.layers.mask & MASK) !== 0,
      };
      if (rec.tagged) inLayer.push(rec);
      else (rec.inPond ? untaggedInPond : untaggedCross).push(rec);
    });
    return { inLayer, untaggedInPond, untaggedCross, named };
    }
    window.__rcScan = scan;
    return Object.assign({ layer: G.refractInfo().layer }, scan());
  });

  /* ── 判据 ① 正向清单（直接读 layer 标记，与几何扫描无关）── */
  const nTag = (n) => (out.named[n] ? out.named[n].tagged : 0);
  const missReq = REQUIRED.filter(([n, min]) => nTag(n) < min)
                           .map(([n, min]) => `${n} ${nTag(n)}/${min}`);
  check(`① 正向清单：${REQUIRED.length} 类必须进层的对象都打了标记`, missReq.length === 0,
    missReq.length ? '缺：' + missReq.join('、')
                   : REQUIRED.filter(([, m]) => m > 0).map(([n, m]) => `${n} ${nTag(n)}/${m}`).join('、'));
  const missCol = REQUIRED_BY_COLOR.filter(([c, min]) =>
    out.inLayer.filter(r => r.color === c && r.inst).length < min)
    .map(([c, min, label]) => `${label}(${c}) ${out.inLayer.filter(r => r.color === c && r.inst).length}/${min}`);
  check('① 匿名实例网格（驳岸石 / 水生植物）也在层里', missCol.length === 0,
    missCol.length ? '缺：' + missCol.join('、') : '驳岸石 3 + 水生植物 3');

  /* ── 判据 ② 反向扫描 + 白名单 ── */
  /* 每条豁免都必须写**理由**，且理由要窄到能被反驳 —— 不允许"因为它在白名单里"。 */
  const whitelistReason = (r) => {
    if (r.span > 100) return `跨度 ${r.span}m 的整景大网（天空球/远山/地形基底），不是池内物`;
    if (r.name === 'ground') return '地形网格：池底那一段被 pondBed 盖住，进层会挡住池底';
    if (r.name === 'mistField') return '低空云雾 billboard：浮在水面之上的雾，不是水下物';
    if (r.name === 'mergedStatic' && r.depth <= 0.25)
      return `静态合并大网：几何已按材质并网、无法单独拆层，且水下仅 ${r.depth}m（桥头踏跺 / 睡莲浮叶这一档）`;
    /* 汀步石（2026-09-22 补）：与上面"桥头踏跺"同类 —— 出水 12~20cm、水下 ≤0.25m 的
       浅浸石作。这条豁免是**量出来的**，不是猜的（probe/_steps-refract-tex.mjs）：
       把 11 块石头加进 LAYER_REFRACT 后，池底贴图确实变了（mean 7.4，基线 0.2），
       但那是它在**正上方俯视**下的顶面 —— 人眼掠射时该看到的是侧面；
       主画面 ROI 变化 7.0 vs 时间基线 6.7（正控"藏掉石头" 26.2，证明判据有牙）
       ⇒ 进层零视觉收益、多渲一层。上限 0.25m 不能松：再深就真成了"透过水该看见的水下物"。 */
    if (r.name === 'steppingStones' && r.depth <= 0.25)
      return `过水汀步青石（同"桥头踏跺"这一档）：出水 12~20cm、水下仅 ${r.depth}m，`
           + `主体在水面之上、由主通道完整绘制；实测进层只把俯视顶面写进池底贴图、画面变化在噪声内`;
    return null;
  };
  const unexcused = out.untaggedInPond
    .map(r => ({ r, why: whitelistReason(r) }))
    .filter(x => !x.why);
  check('② 反向扫描：池内越水面的几何没有"无理由缺席"的', unexcused.length === 0,
    unexcused.length
      ? unexcused.map(x => `${x.r.name}(${x.r.color}) 下探 ${x.r.depth}m @跨${x.r.span}m`).join('、')
      : `池内候选 ${out.untaggedInPond.length} 个全部命中白名单`);
  const whys = out.untaggedInPond.map(r => whitelistReason(r)).filter(Boolean);
  if (whys.length) console.log('    豁免（逐条有理由）：');
  [...new Set(whys)].forEach(w => console.log(`      · ${w}`));

  /* ── 判据 ② 的负例自检（有牙）：往池心注入一块**无名白材质、下探水面 0.5m** 的网格，
        判据 ② 必须报出来 —— 证明上面那道"逐顶点复核"没有把"真半浸在池里的几何"一起放过。
        （复核只改判"一个池内顶点都没有"的对象，这类对象按定义不可能半浸在池里。） */
  const neg = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const m = new T.Mesh(new T.PlaneGeometry(6, 6),
                         new T.MeshStandardMaterial({ color: 0xffffff }));
    m.name = '__refract_negctl';
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.06 - 0.5, 3);          // 池心、水面下 0.5m
    m.updateMatrixWorld(true);
    G.scene.add(m);
    const r = window.__rcScan();
    G.scene.remove(m);
    const hit = r.untaggedInPond.find(x => x.name === '__refract_negctl');
    return { flagged: !!hit, depth: hit ? hit.depth : 0, span: hit ? hit.span : 0, n: r.untaggedInPond.length };
  });
  check('② 负例自检：注入"池心水面下 0.5m 的无名白网格"必须被报出来（复核没失牙）',
    neg.flagged, neg.flagged ? `报出 下探 ${neg.depth}m @跨${neg.span}m` : '没有被报出 ⇒ 逐顶点复核把真缺陷也放过了');

  /* ── 判据 ③ 白名单没吞掉一切 ── */
  check('③ 在层对象数 ≥ 20（白名单没把扫描吞干净）', out.inLayer.length >= 20,
    `在层 ${out.inLayer.length} 件；岸外跨界未打标 ${out.untaggedCross.length} 件（本就该在岸上，不计）`);

  check('页面无报错', errs.length === 0, errs.slice(0, 2).join(' | ') || '无');

  await browser.close();
  server.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass === results.length ? '✓' : '✗'} ${pass}/${results.length} ${pass === results.length ? 'ALL PASS' : 'FAILED'}`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('探针异常：', e); process.exit(1); });
