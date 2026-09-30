// 人物门禁（2026-09-18 · 第九道门）
//
// 为什么要有它：**服色与步态写错了，什么都不报。** 这正是紫藤渐变方向那类静默缺陷 ——
// 页面不崩、别的门禁全绿、画面里"明明有人"。所以这里把四件事钉死：
//   A. 服色分区 —— 读**实际材质**（不是读 FIG_PALETTE 常量），验的是"接线有没有断"；
//      并断言①袍身不是近黑（防止退回单色剪影）②与配色表一致③腰带与袍身有明度对比。
//   A2. 衣构件存在性 —— 交领（**必须 2 条**，1 条 = 少半边、读不出"交"）+ 下摆衣缘 +
//      它们与袍身的明度对比。删掉构件不报错、不崩、只是人变回素色瓷瓶，所以必须硬断言。
//   B. 同框可区分 —— 凡是 slot 重叠（可能同框）的两个角色，服色必须拉开距离。
//   C. 绿地约束 —— 站在草地上的人，袍色必须离"植被绿"够远。
//      参考图里的人都站在石头/木构上，天然没这问题；我们的人站草地，绿袍＝隐身。
//      首版把松绿给了童袍，ΔRGB 只有 49，样张里那孩子几乎看不见。
//   D. 步态 —— 散步的人曾经是"站桩滑行"：只有 position 平移、姿态是负手站立，
//      而且 sp=0.11 反算出 **2.24 m/s**（慢走的两倍半）。这里断言均速落在缓行区间、
//      躯干有前倾、步相在推进、身体有起伏、**朝向跟着行进方向**（侧身平移也读作"滑行"，
//      而且日程给的初始 yaw 是 π/2，垂直于廊道）—— 任何一项退回 0 都会被抓住。
//   E. 取景 —— 距离对 **≠** 看得到。机位从人物实际世界坐标反推 + 候选环射线求解，
//      既断言"没被 controls.minDistance 弹回 9m"，也断言**身上 9 点（3×3）无遮挡**，
//      还断言**机位自身周围有净空**（不扎进植被/构件）。
//      （首版只量距离：相机落进游廊栏杆后面、画面前景全是横梁，门禁照样 PASS。
//        之后又连栽两次，都是"单条射线"这条判据的盲区 —— 稀疏薄片状遮挡能被射线从缝里穿过去：
//        ① 草叶（8 条草横穿画面，射线恰好从两片叶子之间过去，报"首个遮挡 12.47m"）；
//        ② 垂下的紫藤花穗（正好罩住人物头部，人的头在画面里消失，而门禁全绿）。
//       所以最终把"相机→胸口一条线"换成"身上 9 点采样 ≤2 处被挡"，见 subjPts 注释。）
//      ⚠️ 取景**必须等异步 GLB 到齐**：荷花丛是 loading 收起后才挂载的，在它挂上之前
//      "环池的正 +z 机位"是通的，挂上后被荷叶挡掉，同一个候选环就跳到别的方位 ——
//      实测同代码两次跑出两个机位，样张不可比。所以先轮询 GLB 到齐再求解。
//
// ⚠️ 取景必须自己放开 controls.minDistance：渲染循环每帧把相机半径夹到 [minDistance, maxDistance]，
//    相机摆在 9m 以内会被**静默弹回**（方位对、不报错、只是人变得很小）。这与题名石近观机位
//    被弹回 9m 是同一个根因（见 index.html 缺陷⑤注释）。所以这里既不硬编码机位、也不靠猜：
//    相机位置从**人物实际世界坐标**反推，落位后再量一次真实距离并断言。
//
// 用法: node probe/figure-audit.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
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

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const report = detail => console.log(`  ⚠ [报告·不计入判定] ${detail}`);

/* sRGB 加权明度（0~255 口径，与 probe/figure-palette.mjs 同一把尺子）。
   旧单色墨蓝 #1A2233 → L=33.5；新服色最低的藕荷 #7E6FA6 → L=118。阈值取 70 卡在中间。 */
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const NEAR_BLACK_L = 70;    // 袍身明度下限：低于此判为"近黑剪影"
const PAIR_MIN_D = 60;      // 同框角色服色的 RGB 欧氏距离下限
const SASH_MIN_DL = 25;     // 腰带与袍身的明度差下限（腰带就是靠这个起作用的）
const LAWN_D = 60;          // 袍色与草坪绿的距离"提醒线"（见下文 C 段：只报告，不做硬判据）
const WALK_SPD = [0.3, 1.0];    // 缓行均速区间 m/s（人类慢走 0.6~0.9）
/* 落位距离必须**逐机位给期望区间**：中景本来就在 6m 外，拿近景的 2.2~4.2m 去卡会误红（首版就误红两项）。
   真正的判据是"有没有被 minDistance 夹回那个固定值"—— 被夹回就一定是 9m。 */
const DIST_CLOSE = [2.2, 4.2];
const DIST_MID   = [5.0, 8.5];
/* 机位自身的**近距净空**下限（m）：相机周围 0.6m 内不许有任何非人物几何。
   为什么单有"视线无遮挡"不够（2026-09-18 第七轮实测）：10c 的机位扎进了草丛，
   8 条横向草叶横穿整幅画面，但**射线正好从两片叶子之间穿过去** → 报"首个遮挡 12.47m"、
   门禁全绿。单条射线只能证明"那一条线上没东西"，证明不了"看得见"。
   同 §题名石"朝向 ≠ 视线"：判据必须验到"画面里的实际观感"，不能只验一条线。 */
const CLEAR_MIN = 0.55;

const shotsDir = path.join(ROOT, 'outputs', 'visual');
fs.mkdirSync(shotsDir, { recursive: true });

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000 });
  await page.evaluate(() => window.__garden.tourStop());
  await page.evaluate(() => {
    for (const id of ['env', 'hud', 'stats', 'caption']){
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    }
  });

  /* 人物是**同步装配**的（不在 deferBoot 队列里），loading 收起时就该全部到位 */
  const n = await page.evaluate(() => (window.__garden.figures || []).length);
  check('人物已装配（同步批，不该等延迟链）', n >= 5, `${n} 个`);

  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('season', 'summer'); g.setEnv('weather', 'clear'); g.setEnv('time', 'morning');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 120000, polling: 200 }).catch(() => {});

  /* ⚠️ 取景前必须等**异步 GLB 到齐**（同 wind-audit / visual-check 的做法）。
     这不是为了样张好看，而是为了**机位求解的确定性**：候选环靠射线否决被挡的方位，
     而池面的荷花丛是 loading 收起之后才异步挂载的 —— 挂上之前"正 +z 的环池机位"是通的，
     挂上之后同一束射线被荷叶挡住，机位就跳到别的方位去。
     实测同一份代码两次跑分别落在 `(1.21,1.82,0.75)` 与 `(-3.11,1.82,-1.04)` —— 两版样张不可比。 */
  const glbReady = await page.waitForFunction(() => {
    let banana = 0;
    window.__garden.scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.name === 'BananaPlant') banana++;
    });
    /* 2026-09-30：LotusPlant.glb 已删（a08bde0）、池边大荷花整体撤下 ——
       只剩芭蕉要等；旧"lotus >= 12"条件会永远超时。 */
    return banana >= 8 ? { banana } : false;
  }, { timeout: 120000, polling: 500 }).then(v => v.jsonValue?.() ?? v).catch(() => null);
  check('取景前异步 GLB 到齐（否则机位求解不确定）', !!glbReady,
    glbReady ? JSON.stringify(glbReady) : '超时未齐 —— 下面的机位可能换方位，样张与上次不可比');

  /* ── A/B. 服色（读实际材质） ── */
  const data = await page.evaluate(() => {
    const g = window.__garden;
    const hexOfMat = m => (m && m.color) ? '#' + m.color.getHexString().toUpperCase() : null;
    return {
      palette: g.FIG_PALETTE,
      figs: g.figures.map((f, i) => {
        let sash = null, lapel = null, lapelN = 0, hem = null, hemN = 0;
        f.traverse(o => {
          if (!o.isMesh) return;
          if (/^(scholar|child)Sash$/.test(o.name)) sash = o;
          if (/^(scholar|child)Lapel$/.test(o.name)){ lapel = o; lapelN++; }
          if (/^(scholar|child)Hem$/.test(o.name)){ hem = o; hemN++; }
        });
        const sl = f.userData.slot;
        return { i, skin: f.userData.skin, pose: f.userData.poseName,
                 robe: hexOfMat(f.userData.robe && f.userData.robe.material),
                 sash: hexOfMat(sash && sash.material),
                 lapel: hexOfMat(lapel && lapel.material), lapelN,
                 hem: hexOfMat(hem && hem.material), hemN,
                 h0: sl ? sl.h0 : null, h1: sl ? sl.h1 : null,
                 stroll: !!(sl && sl.stroll) };
      }),
    };
  });

  const figs = data.figs;
  const missing = figs.filter(f => !f.robe);
  check('每个角色都能读到袍身材质（robe 引用没断）', missing.length === 0,
    missing.length ? `读不到：${missing.map(f => f.skin).join(',')}` : `${figs.length} 个`);

  for (const f of figs){
    const L = lum(rgbOf(f.robe));
    check(`[${f.skin}/${f.pose}] 袍身是真彩色，不是近黑剪影`, L >= NEAR_BLACK_L,
      `${f.robe} L=${Math.round(L)}（下限 ${NEAR_BLACK_L}，旧单色 #1A2233 是 L=33.5）`);
    const want = data.palette[f.skin] && data.palette[f.skin].robe;
    const wantHex = want != null ? '#' + want.toString(16).padStart(6, '0').toUpperCase() : null;
    check(`[${f.skin}] 袍身确实取自 FIG_PALETTE（接线断言）`, !!wantHex && f.robe === wantHex,
      `实际 ${f.robe} / 表内 ${wantHex}`);
    if (f.sash){
      const d = Math.abs(L - lum(rgbOf(f.sash)));
      check(`[${f.skin}] 腰带与袍身有明度对比（否则腰带等于没加）`, d >= SASH_MIN_DL,
        `${f.robe} vs ${f.sash} → ΔL=${Math.round(d)}`);
    } else {
      check(`[${f.skin}] 腰带存在`, false, '没找到 scholarSash / childSash');
    }
  }

  /* A2. 衣构件（第六轮新增）—— **存在性本身必须进门禁**。
     交领/下摆衣缘是"穿好看的衣服"这条需求的主体；它们一旦被删或被改名，
     页面不崩、别的判据全绿、只是人又变回一只素色瓷瓶 —— 典型的静默缺陷。
     数量也断言：交领**必须 2 条**（自颈侧斜下在胸前交叉），1 条 = 少了半边，读不出"交"。 */
  const badLapel = figs.filter(f => f.lapelN !== 2);
  check('交领衣缘存在且每件 2 条（胸前交叉）', badLapel.length === 0,
    badLapel.length ? `异常：${badLapel.map(f => `${f.skin}=${f.lapelN} 条`).join(', ')}`
                    : `${figs.length} 件 × 2 条`);
  const badHem = figs.filter(f => f.hemN !== 1);
  check('下摆衣缘存在（缺了袍身会读成"花瓶"轮廓，没有终止线）', badHem.length === 0,
    badHem.length ? `异常：${badHem.map(f => `${f.skin}=${f.hemN} 个`).join(', ')}` : `${figs.length} 件`);
  for (const f of figs){
    if (!f.lapel) continue;
    const d = Math.abs(lum(rgbOf(f.robe)) - lum(rgbOf(f.lapel)));
    check(`[${f.skin}] 交领与袍身有明度对比（同一色就等于没画）`, d >= SASH_MIN_DL,
      `${f.robe} vs ${f.lapel} → ΔL=${Math.round(d)}`);
  }

  /* A3. 手持道具不许被**袍身/袖子**吞掉 —— 书卷原本放在 z=0.15，而袍身 y=1.04 处的前表面在 0.172，
     于是卷轴埋进胸口、样张里只剩"一根横杠"（手也够不着，是"姿态与道具各画各的"）。
     判据用**射线**而不是比坐标：从胸前 1m 处沿人物朝向打向道具，首个命中必须是道具自己。
     ⚠️ 射线**只打人物自己的子树**（`intersectObject(f, true)`），不打整个 scene：
     首版打 scene，水榭那位品茗者报"首个命中 mergedStatic"——那是**水榭栏杆**挡在身前 1m 处，
     属于"被场景遮挡"（另一码事），与本判据要抓的"道具埋在袍子里"混成了一个。 */
  const props = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    return g.figures.map(f => {
      let target = null;
      f.traverse(o => { if (o.isMesh && /^scholar(Scroll|Cup)$/.test(o.name) && !target) target = o; });
      if (!target) return null;
      const wp = target.getWorldPosition(new T.Vector3());
      const fwd = new T.Vector3(0, 0, 1).applyQuaternion(f.getWorldQuaternion(new T.Quaternion()));
      const cam = wp.clone().addScaledVector(fwd, 1.0);
      const rc = new T.Raycaster(cam, wp.clone().sub(cam).normalize(), 0, 3);
      const h = rc.intersectObject(f, true)[0];
      return { skin: f.userData.skin, prop: target.name,
               first: h ? h.object.name : '(无)', ok: !!h && h.object === target };
    }).filter(Boolean);
  });
  for (const p of props){
    check(`[${p.skin}] 手持道具（${p.prop}）没被袍身吞掉`, p.ok,
      `从正前方打射线、在人物自身几何里首个命中 ${p.first}${p.ok ? '' : ' ← 道具埋在袍身/袖子里，等于手上空着'}`);
  }

  /* C. 绿地约束 —— **只报告，不做硬判据**。
     想硬判"谁站在草坪上"得先认出脚下的面，但草地是**贴图白底材质**（material.color = #FFFFFF，
     真实颜色在 map 里），竖直下探测到的颜色是白的，判不出绿地。所以这里改用**实测常量**
     草坪绿 #457441（由 probe/figure-palette.mjs 量 08-hero-stone.png 得到）逐个人报距离：
     数值小就说明这件袍色在草地上会糊 —— 首版松绿童袍在这里只有 49。口径变了要重量。 */
  const LAWN_GREEN = '#457441';
  for (const f of figs){
    const d = cdist(rgbOf(f.robe), rgbOf(LAWN_GREEN));
    report(`[${f.skin}] 袍 ${f.robe} vs 草坪绿 ${LAWN_GREEN} → ΔRGB=${Math.round(d)}` +
           `${d < LAWN_D ? '  ← 偏小，这角色若站草坪会糊' : ''}`);
  }

  /* B. 同框可区分：只约束 **slot 有重叠** 的角色对（不重叠的永不同框，无需拉开） */
  for (let a = 0; a < figs.length; a++) for (let b = a + 1; b < figs.length; b++){
    const A = figs[a], B = figs[b];
    if (A.h0 == null || B.h0 == null) continue;
    if (!(A.h0 < B.h1 && B.h0 < A.h1)) continue;
    const d = cdist(rgbOf(A.robe), rgbOf(B.robe));
    check(`同框可区分：${A.skin} vs ${B.skin}（slot ${A.h0}~${A.h1} 与 ${B.h0}~${B.h1} 重叠）`,
      d >= PAIR_MIN_D, `${A.robe} ↔ ${B.robe} → ΔRGB=${Math.round(d)}`);
  }

  /* ── 取景与样张：相机从**人物实际世界坐标**反推，不硬编码机位 ──
     · matcher 用**声明式**条件（对象里的键值都要匹配；stroll:true 表示"带散步日程的那个"），
       不能传函数 —— page.evaluate 只能传可序列化的参数（传函数只会变成字符串，页面里用不了）。
     · 偏移给的是**候选环**：屏幕取景不是"算"出来的，是**求解**出来的（同 stele-viewpoint 的思路）。
       逐个候选从相机向取景目标打射线，取第一个无非人物遮挡的。
       ⚠️ 上一版只给单个偏移（游廊 +x 2.3m）→ 相机落进栏杆后面，距离 2.29m 落在期望区间内
       **门禁判 PASS，画面前景全是横梁** —— 与题名石"朝向 ≠ 视线"同源。距离对 ≠ 看得到。 */
  /* 候选环：**相对取景目标**给偏移（不是相对人物）—— 半径即距离，确定性；
     若相对人物给，重心与人物不是一个点，落位距离会飘（首版就这么飘到 2.09m、掉出区间）。 */
  const ring = (r, dy, a0 = Math.PI / 2, n = 8) => Array.from({ length: n }, (_, i) => {
    const a = a0 + i * 2 * Math.PI / n;
    return [Math.cos(a) * r, dy, Math.sin(a) * r];
  });
  /* ⚠️ 近景机位必须抬到**草层之上**：原 dy=0.30 → 相机 y≈1.22m，正好卡在 1m 出头的草丛里
     （10c 实测整幅画面被草叶横穿）。抬高后 y≈1.47m，既越过草叶、视线又只略俯。
     dy 参与距离计算：dist = √(r²+dy²)，改完仍落在 DIST_CLOSE 区间（2.51 / 3.51m）。 */
  const OFFS_CLOSE = [...ring(2.45, 0.55), ...ring(3.45, 0.65)];   // 2.51 / 3.51m
  const OFFS_MID   = [...ring(6.10, 0.90)];                        // 6.17m

  /* 等真实帧（软渲染下一帧 ~8s，所以只能按帧数等，不能按墙钟 sleep） */
  const rafWait = n => page.evaluate(k => new Promise(r => {
    let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
  }), n);

  const frame = async (match, offs, label, file, hour, distRange) => {
    /* ⚠️ 时辰必须走**滑杆的真实路径**，不能只给 `ENV.hour` 赋值：
       光照/雾/天空/水色全部只由 `ENV.cur` 决定，而 `ENV.cur` **只在滑杆的 input handler 里**
       由 `composeEnv(paramsAtHour(ENV.hour))` 重算。直接赋值只影响"人物时段门禁 + 时钟读数"，
       光照纹丝不动 —— 三张样张曾经分别标着 7.5 / 9.0 / 21.5，画面却全是**正午硬光**
       （标称与实物不符；"晨课组"没有晨光、"夜步者"没有夜色）。
       再把 `ENV.t` 推到 0.994：下一帧 `min(1, t + dt/dur)` 恰好到 1、缓动 `e = 1` → 环境一步到位。
       否则 0.45s 的过渡在软渲染下要 9 帧（~75s）才收敛，快门会按在过渡中间。 */
    await page.evaluate(h => {
      const el = document.getElementById('hourSlider');
      el.value = String(h);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      window.__garden.ENV.t = 0.994;
    }, hour);
    await rafWait(2);

    const info = await page.evaluate((arg) => {
      const g = window.__garden, T = g.THREE;
      const ok = x => Object.entries(arg.match).every(([k, v]) =>
        k === 'stroll' ? !!(x.userData.slot && x.userData.slot.stroll) : x.userData[k] === v);
      const f = g.figures.find(ok);
      if (!f) return null;
      /* ⚠️ 必须放开 minDistance，否则相机被弹回 9m（人变得很小，且不报错） */
      g.controls.minDistance = 0.4;
      g.scene.updateMatrixWorld(true);

      const wp = o => o.getWorldPosition(new T.Vector3());
      const p = wp(f);
      /* 取景目标 = 附近 4m 内**该时刻在场**角色的重心：只瞄主角会把旁边的童子切出画外。
         用重心还有个好处 —— 目标点是**空处**，"视线通"等价于"相机到目标点之间没有东西"。
         ⚠️ 在场判定必须用 **slot 时段（纯数据）**，不能用 `o.visible`：visible 由渲染循环
         按 ENV.hour 更新，而这个 evaluate 里刚改完 hour、一帧都还没跑 —— 读到的是上一档的陈旧值。
         首版就因此把游廊那张的重心取成了空集 → 除以 0 → 相机坐标 NaN。 */
      const inSlot = o => {
        const s = o.userData.slot;
        return s ? (arg.hour >= s.h0 && arg.hour < s.h1) : o.visible;
      };
      const near = g.figures.filter(o => inSlot(o) && wp(o).distanceTo(p) < 4);
      const aim = new T.Vector3();
      for (const o of (near.length ? near : [f])) aim.add(wp(o));
      aim.divideScalar(near.length || 1); aim.y += 0.92;

      const shown = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
      const isFig = o => { for (let q = o; q; q = q.parent) if (g.figures.includes(q)) return true; return false; };

      /* 候选环**按人物朝向旋转**，让首个候选正好落在人的正前方（样张默认拍正脸）。
         偏移方位角 α = atan2(ox, oz)，绕 Y 转 ry 即 α → α + ry；而模型正面 = +z、
         `rotation.y = ry` → 正面方位角恰好是 ry，所以转完第一个候选就在人正前方。
         ⚠️ 为什么必须这样：候选环只保证"看得见"，**不管从哪个方向看** —— 背影照一样合格，
         但读不出交领/腰带/道具（10c 首版拍到的就是背影：人在沿 z 走、机位默认落在 +z，正好在他身后）。 */
      const ry = f.rotation.y, cs = Math.cos(ry), sn = Math.sin(ry);
      const offs = arg.offs.map(o => [o[0] * cs + o[2] * sn, o[1], -o[0] * sn + o[2] * cs]);

      /* 取景采样点：**身上 9 点（3×3）**，而不是"相机→胸口"一条射线。
         ⚠️ 单条射线会漏掉所有**稀疏薄片状**遮挡，实测栽了两次：
           ① 草丛 —— 8 条草叶横穿画面，那条射线恰好从两片叶子之间过去了（报"首个遮挡 12.47m"）；
           ② 垂下的紫藤花穗 —— 正好罩住人物头部，射线从花穗间隙穿过，人的头在画面里消失。
         人身上任一部位被挡，这张样张就该换机位。图省事只打一个点，等于把判据交给运气。 */
      const bb = new T.Box3().setFromObject(f);
      const subjPts = [];
      for (const fy of [0.22, 0.52, 0.80])
        for (const fx of [0.32, 0.50, 0.68])
          subjPts.push(new T.Vector3(
            bb.min.x + (bb.max.x - bb.min.x) * fx,
            bb.min.y + (bb.max.y - bb.min.y) * fy,
            bb.min.z + (bb.max.z - bb.min.z) * 0.5));

      const probe = off => {
        const cam = new T.Vector3(aim.x + off[0], aim.y + off[1], aim.z + off[2]);
        const dAim = cam.distanceTo(aim);
        let worst = Infinity, who = null, blocked = 0;
        for (const sp of subjPts){
          const dSp = cam.distanceTo(sp);
          const rc = new T.Raycaster(cam, sp.clone().sub(cam).normalize(), 0, 500);
          /* 人物自己不算遮挡（挡住的必须是栏杆/墙/树/草这类东西） */
          const h = rc.intersectObject(g.scene, true).find(x => shown(x.object) && !isFig(x.object));
          if (h && h.distance < dSp - 0.35){ blocked++; if (h.distance < worst){ worst = h.distance; who = h.object.name || '匿名'; } }
        }
        return { off, cam, dAim, nRays: subjPts.length, blocked,
                 blockDist: worst, blocker: who, clear: blocked === 0 };
      };
      /* 机位净空：从相机向 10 个方向（8 横 + 上 + 下）打 CLEAR_MIN 长的短射线，取最近命中。
         命中很近 ⇒ 相机扎在东西里（草叶/栏杆/墙）。**只测"相机→目标"那一条线是不够的**：
         草是稀疏的细长叶片，那条线能从两片叶子之间穿过去，于是报"无遮挡"而画面糊满草叶。 */
      const CLEAR_DIRS = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],
                          [0.707,0,0.707],[-0.707,0,0.707],[0.707,0,-0.707],[-0.707,0,-0.707],
                          [0,1,0],[0,-1,0]];
      const clearDist = cam => {
        let near = Infinity, who = null;
        for (const a of CLEAR_DIRS){
          /* ⚠️ `arg.clearMin` 而不是 `CLEAR_MIN` —— 这段跑在**页面上下文**里，Node 侧的常量在这里
             是未定义标识符（实测直接 `ReferenceError: CLEAR_MIN is not defined`、整个探针崩）。
             `page.evaluate` 的参数必须逐个显式传（同"函数不能序列化"是同一类坑）。 */
          const rc = new T.Raycaster(cam, new T.Vector3(a[0], a[1], a[2]).normalize(), 0, arg.clearMin);
          const h = rc.intersectObject(g.scene, true).find(x => shown(x.object) && !isFig(x.object));
          if (h && h.distance < near){ near = h.distance; who = h.object.name || '匿名'; }
        }
        return { near, who };
      };
      /* 候选必须**同时**满足：① 身上 9 点全不被场景挡 ② 机位自己不扎在植被/构件里。
         兜底也有优先级：先比"身上被挡几处"（越少越好），再比机位净空 —— 不能只看一个。 */
      let best = null;
      for (const off of offs){
        const t = probe(off);
        t.clr = clearDist(t.cam);
        if (t.clear && t.clr.near >= arg.clearMin){ best = t; break; }
        if (!best || t.blocked < best.blocked ||
            (t.blocked === best.blocked && t.clr.near > best.clr.near)) best = t;
      }
      if (!best){ best = probe([0, 0, 0]); best.clr = { near: 0, who: null }; }
      g.camera.position.copy(best.cam);
      g.camera.fov = 42; g.camera.updateProjectionMatrix();
      g.controls.target.copy(aim);
      g.controls.update();
      return { skin: f.userData.skin, fig: p.toArray(), cam: g.camera.position.toArray(),
               dist: g.camera.position.distanceTo(g.controls.target), fov: g.camera.fov,
               minD: g.controls.minDistance, clear: best.clear, off: best.off,
               blocked: best.blocked, nRays: best.nRays,
               pts: subjPts.map(q => q.toArray()),        // 传给"快门时刻"那次评估，同一组点复测
               blockDist: best.blockDist, blocker: best.blocker, nTry: offs.length,
               clrNear: best.clr.near, clrWho: best.clr.who,
               nNear: near.length };
    }, { match, offs, clearMin: CLEAR_MIN });
    if (!info){ check(`取景：${label}`, false, '没找到目标角色'); return; }
    const hit = isFinite(info.blockDist) ? `${info.blockDist.toFixed(2)}m ${info.blocker}` : '无';
    report(`取景 ${label}：[${info.skin}] 人物 ${info.fig.map(v => v.toFixed(2))} → 相机 ` +
           `${info.cam.map(v => v.toFixed(2))}  距离 ${info.dist.toFixed(2)}m / fov ${info.fov} / minDistance ${info.minD}`);
    check(`近景落位距离未被 minDistance 弹走（${label}）`,
      info.dist >= distRange[0] && info.dist <= distRange[1],
      `实际 ${info.dist.toFixed(2)}m，期望 ${distRange[0]}~${distRange[1]}m；落到 9m（minDistance 默认值）即被夹回`);
    /* 判据是"身上 9 点采样被挡几处"，不是"一条线通不通"。
       允许 ≤2 处：花园里垂枝、竹叶、檐口本就与人同框，苛求 0 会让所有机位都不合格；
       但 3 处以上意味着"人被盖住一块"（紫藤罩头就是 3 处），必须换机位。 */
    check(`视线无遮挡（身上 9 点采样 · ${label}）`, info.blocked <= 2,
      `偏移 ${info.off.map(v => v.toFixed(2))}（${info.nTry} 个候选 / 同框 ${info.nNear} 人）；` +
      `9 点被挡 ${info.blocked} 处，最近遮挡 ${hit}`);
    /* ⚠️ "视线无遮挡"只验了一条线 —— 稀疏的草叶能被一条射线从缝里穿过去（10c 实测）。
       所以这条判据升级成**身上 9 点采样**（见上面的 subjPts）。
       另加一条：**机位自己周围的净空**。三条都过才叫"画面干净"。 */
    check(`机位没扎进植被/构件里（${label}）`, info.clrNear >= CLEAR_MIN,
      `机位周围 ${CLEAR_MIN}m 内最近命中 ` +
      `${isFinite(info.clrNear) ? info.clrNear.toFixed(2) + 'm ' + info.clrWho : '无'}（偏移 ${info.off.map(v => v.toFixed(2))}）`);
    /* ⚠️ 解完机位后要**重新量一次**目标：机位是拿"求解那一刻"的坐标架的，而散步者按累加仿真时间
       推进 —— 期间他会移动。而且"在取景范围内"远不等于"画面上看得见"：
       人可能已被场景挡住、或者这一刻 `visible=false`。
       所以拍前同时量三件事：**在 NDC 框内 + 可见 + 身上 9 点无遮挡**。
       （游廊那张就是这么漏过去的：NDC 说在框内、射线说 11m 外才有地面，可画面里没人。） */
    await rafWait(3);
    const live = await page.evaluate(arg => {
      const g = window.__garden, T = g.THREE;
      const ok = x => Object.entries(arg.match).every(([k, v]) =>
        k === 'stroll' ? !!(x.userData.slot && x.userData.slot.stroll) : x.userData[k] === v);
      const f = g.figures.find(ok);
      if (!f) return null;
      g.scene.updateMatrixWorld(true);
      const p = f.getWorldPosition(new T.Vector3());
      g.camera.updateMatrixWorld(true);
      const chest = p.clone(); chest.y += 0.92;      // 只用来算 NDC（"人在框里"）
      const n = chest.clone().project(g.camera);
      const cam = g.camera.position.clone();
      const shown = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
      const isFig = o => { for (let q = o; q; q = q.parent) if (g.figures.includes(q)) return true; return false; };
      /* 复测**同一组 9 个采样点**（求解时算好的，避免两次口径不一致） */
      let blocked = 0, worst = null, who = null;
      for (const a of arg.pts){
        const sp = new T.Vector3(a[0], a[1], a[2]);
        const dSp = cam.distanceTo(sp);
        const rc = new T.Raycaster(cam, sp.clone().sub(cam).normalize(), 0, 500);
        const h = rc.intersectObject(g.scene, true).find(x => shown(x.object) && !isFig(x.object));
        if (h && h.distance < dSp - 0.35){ blocked++; if (worst == null || h.distance < worst){ worst = h.distance; who = h.object.name || '匿名'; } }
      }
      return { ndc: [n.x, n.y], vis: f.visible, dFig: cam.distanceTo(p), blocked, nRays: arg.pts.length,
               blockDist: worst, blocker: who,
               drift: p.distanceTo(new T.Vector3(arg.fig[0], arg.fig[1], arg.fig[2])) };
    }, { match, fig: info.fig, pts: info.pts });
    check(`目标仍在画面内（${label}）`,
      !!live && Math.abs(live.ndc[0]) < 0.85 && Math.abs(live.ndc[1]) < 0.85,
      live ? `漂移 ${live.drift.toFixed(2)}m，胸口 NDC (${live.ndc.map(v => v.toFixed(2))})` : '找不到角色');
    check(`快门时刻目标真的看得见（${label}）`,
      !!live && live.vis && live.blocked <= 2,
      live ? `visible=${live.vis}，相机→人 ${live.dFig.toFixed(2)}m，` +
             `${live.nRays} 点采样被挡 ${live.blocked} 处，最近遮挡 ` +
             `${live.blockDist == null ? '无' : live.blockDist.toFixed(2) + 'm ' + live.blocker}`
           : '找不到角色');
    await page.screenshot({ path: path.join(shotsDir, file) });
    console.log(`  ▸ 样张 ${file}`);
  };

  /* 样张①②：晨课三人组（先生宝蓝 + 童天青 + 童秋香），近景看分区、中景看画面感 */
  await frame({ poseName: 'read' }, OFFS_CLOSE, '晨课组近景', '10a-figures-close.png', 7.5, DIST_CLOSE);
  await frame({ poseName: 'read' }, OFFS_MID, '晨课组中景', '10b-figures-group.png', 9.0, DIST_MID);
  /* 样张③：夜步者（藕荷）在游廊 —— 第二套服色 + 木构背景。
     机位交给候选环求解：游廊里有栏杆和立柱，靠手工猜偏移必然撞（上一版就是这个下场）。
     ⚠️ 时辰取 **18.0（时辰锚点里"暮"= 17.5，进入夜步日程的最亮时刻）**，不是 21.5：
     产品在深夜是**故意压到很暗**的（smoke 有"切夜过渡收敛与光强下调"），21.5 实测整幅近黑、
     服色完全读不出来 —— 样张的目的是展示藕荷服色与交领，不是演示夜景。
     18.0 在 slot（18~23）内、又正好是暮色起点，两者兼得。 */
  await frame({ stroll: true }, OFFS_CLOSE, '游廊暮步者', '10c-figures-walker.png', 18.0, DIST_CLOSE);

  /* ── D. 步态 ── */
  const gait = await page.evaluate(async () => {
    const g = window.__garden;
    g.ENV.hour = 21.5;
    const f = g.figures.find(x => x.userData.slot && x.userData.slot.stroll);
    if (!f) return { found: false };
    const s = f.userData.slot.stroll;
    const period = 1 / (s.sp * 2);           // sin(t·sp·TAU·2) 的周期
    const samp = [];
    /* ⚠️ 采样窗从 5 帧扩到 60 帧（2026-09-23 修"刀锋窗口"）：
       5 帧在 60fps 下只有 ~83ms，而散步是**沿 z 来回**（半周期 1/(sp·2)=18.5s）——
       窗口一旦正好落在**掉头点**，Δz≈0、yaw 正在平滑转 180° ⇒ "前向量 |z| 须 ≥0.94" 必然误判。
       实测（2026-09-23 把布局随机改走专用种子流 jr 之后）：散步者的摆动相位 `breathPhase` 由
       `Math.random()*TAU` 变成确定值，采样窗恰好落到掉头点，这条就红了 —— 而其余四条步态判据
       （步速/前倾/步相/起伏）全绿 ⇒ **产品行为是对的，是判据在量一个刀锋窗口**。
       （顺带：相位原来是每次加载随机的 ⇒ 这条判据**本来就偶发红**，前两次只是撞上了直行段。）
       扩窗后仍用"位移最大的一对样本"判朝向 —— 判据没变软，只是不再靠运气。 */
    for (let i = 0; i < 60; i++){
      await new Promise(r => requestAnimationFrame(r));
      samp.push({ rx: f.rotation.x, y: f.position.y, st: f.userData.stepPhase || 0, vis: f.visible,
                  x: f.position.x, z: f.position.z, ry: f.rotation.y });
    }
    /* 朝向：模型正面 = +z、`rotation.y = ry` → 前向量 = (sin ry, cos ry)。
       日程里给的初始 yaw 是 π/2（面朝 +x，垂直于廊道）—— 若步态没接管，这里会是 cos(π/2) ≈ 0。 */
    return { found: true, sp: s.sp, vAvg: 2 * Math.abs(s.z1 - s.z0) / period, samp,
             ry: f.rotation.y, fwdZ: Math.cos(f.rotation.y) };
  });

  if (!gait.found){
    check('找到散步角色', false, 'figures 里没有带 stroll 的角色');
  } else {
    check('散步角色在其时段内可见', gait.samp.some(s => s.vis), 'hour=21.5 / slot 18~23');
    check(`步速是缓行而不是小跑（sp=${gait.sp} → ${gait.vAvg.toFixed(2)} m/s）`,
      gait.vAvg >= WALK_SPD[0] && gait.vAvg <= WALK_SPD[1],
      `区间 ${WALK_SPD[0]}~${WALK_SPD[1]}；原来 sp=0.11 是 2.24 m/s`);
    const rx = Math.max(...gait.samp.map(s => Math.abs(s.rx)));
    check('散步时躯干前倾（站桩滑行的直接判据）', rx > 0.03, `max|rotation.x|=${rx.toFixed(3)}（应为 0.05）`);
    const st0 = gait.samp[0].st, st1 = gait.samp[gait.samp.length - 1].st;
    check('步相在按位移推进（不再是与时间脱钩的平移）', st1 > st0, `stepPhase ${st0.toFixed(3)} → ${st1.toFixed(3)}`);
    const yMax = Math.max(...gait.samp.map(s => s.y));
    check('迈步有身体起伏', yMax > 0.004, `max y=${yMax.toFixed(4)}m`);
    /* 朝向必须跟行进方向一致。走廊里人在 z 轴来回走，所以判据是"前向量的 z 分量接近 ±1"。
       ⚠️ 这条是**自检式**判据：日程给的初始 yaw = π/2（面朝 +x）→ cos(π/2) ≈ 0，
       步态没接管就必然判红；而且"面朝 +z 却在往 -z 走"（倒退）也会被后半段抓住。
       ⚠️ 取"窗口内相邻样本里 |Δz| 最大的那一段"来判（2026-09-23 修）：掉头点上 Δz≈0、yaw 正在
       平滑转 180°，拿它当判据会误红（那是判据的刀锋，不是产品的问题）。最快那一段必定是直行。 */
    let best = { dz: 0, ry: gait.ry, k: 0 };
    for (let i = 0; i + 1 < gait.samp.length; i++){
      const dz = gait.samp[i + 1].z - gait.samp[i].z;
      if (Math.abs(dz) > Math.abs(best.dz)) best = { dz, ry: gait.samp[i + 1].ry, k: i + 1 };
    }
    const fwdZ = Math.cos(best.ry);
    check('散步者面朝行进方向（不是侧身平移）',
      Math.abs(fwdZ) >= 0.94 && fwdZ * Math.sign(best.dz) >= 0,
      `取窗口内位移最大的一段（样本 #${best.k}→#${best.k + 1}，Δz=${best.dz.toFixed(4)}m）：` +
      `rotation.y=${best.ry.toFixed(3)} → 前向量 z=${fwdZ.toFixed(3)}（|z| 须 ≥0.94）；` +
      `侧身时 yaw 停在日程给的 π/2、前向量 z≈0`);
  }

  check('页面零报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(failures === 0 ? '\nfigure-audit: PASS ✓' : `\nfigure-audit: FAIL（${failures} 项）`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('figure-audit 异常：', e); process.exit(1); });
