// 风场审计探针（2026-09-17）：把"谁在动、动多大、绕哪根轴动"变成可断言的事实。
// 起因：连续三轮用户视觉反馈都指向同一类问题 ——
//   · 动错了对象（芭蕉：假茎在摆、叶子不动）
//   · 权重算反了（假茎根部权重最大；荷花瓣高过 crownY 被 clamp 成 0）
//   · 绕错了轴（灯笼绕自身中心转，导致绳与屋梁的连接处跟着甩）
// 这三类都能在无头浏览器里直接量出来，不必靠肉眼。
// 用法: node probe/wind-audit.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs');
fs.mkdirSync(OUT, { recursive: true });

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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  page.setDefaultTimeout(120000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000 });
  /* ⚠️ 必须**等 GLB 到齐**再审计，不能固定 sleep：软渲染下首帧要 12~16 秒，
     GLB（荷/芭蕉/龟）是在首帧之后才异步挂载的，实测 loading 收起后还要约 8 秒 ——
     上一版固定等 8 秒正好卡在临界点上，同一份代码两次跑一次看得到一次看不到，
     误报"GLB 资产没进风场"。改为轮询到齐。 */
  const ready = await page.waitForFunction(() => {
    let lotus = 0, banana = 0;
    window.__garden.scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.name === 'LotusPlant') lotus++;
      else if (o.name === 'BananaPlant') banana++;
    });
    /* 2026-09-30 三轮：LotusPlant.glb 回归（老黄："之前有个版本有好多株树立的荷花，
       虽然有点假但是至少能看"）⇒ 等待条件恢复成"荷花+芭蕉"（中间程序化/撤空两轮
       曾删掉 lotus 条件；GLB 在不在，这里就是证据位）。 */
    return lotus >= 12 && banana >= 8 ? { lotus, banana } : false;
  }, { timeout: 120000, polling: 500 }).then(v => v.jsonValue?.() ?? v).catch(() => null);
  console.log(`\n[wind-audit] GLB 到齐：${ready ? JSON.stringify(ready) : '超时未齐（下面结果可能不完整）'}`);

  console.log(`\n[wind-audit] 页面就绪，开始审计`);

  /* ── 1 · 风场材质清单：谁进了风场、什么模式、多大振幅 ──
     ⚠️ 判据用 customProgramCacheKey() 而不是 userData.shader：后者只在材质**被渲染过**
     之后才由 onBeforeCompile 写入，视锥外的物体（芭蕉在场景两侧）会漏检 ——
     探针第一版就因此误报"GLB 荷花丛没进风场"。
     2026-09-20 起风参数降为 uniform、program 合并，amp/speed/mode/maxDisp 改读
     userData.windParams（addWind 写入，与是否上过屏无关）；老的 key 拆分只作回退。 */
  const mats = await page.evaluate(() => {
    const g = window.__garden, seen = new Map();
    g.scene.traverse(o => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list){
        if (!m) continue;
        const ck = typeof m.customProgramCacheKey === 'function' ? m.customProgramCacheKey() : '';
        const inj = typeof ck === 'string' && ck.indexOf('wind|') === 0;
        if (seen.has(m.uuid)){ seen.get(m.uuid).n++; continue; }
        const parts = inj ? ck.split('|') : [];
        const wp = (m.userData && m.userData.windParams) || null;
        const src = (m.userData && m.userData.shader && m.userData.shader.vertexShader) || '';
        const baseY = wp ? wp.crownY : (src.match(/wPos\.y - ([\d.-]+)\)/) || [])[1];
        seen.set(m.uuid, {
          inj, type: m.type,
          amp: wp ? wp.amp : (inj ? parseFloat(parts[1]) : null),
          speed: wp ? wp.speed : (inj ? parseFloat(parts[2]) : null),
          mode: wp ? wp.mode : (inj ? parts[3] : null),
          maxDisp: wp ? wp.maxDisp : (inj ? parseFloat(parts[4]) : null),
          baseY: baseY === undefined ? null : parseFloat(baseY),
          hasMap: !!m.map, n: 1,
          color: m.color ? m.color.getHexString() : '',
          sample: (o.name || o.type) + (o.parent && o.parent.name ? '/' + o.parent.name : ''),
          rendered: !!(m.userData && m.userData.shader),
        });
      }
    });
    return [...seen.values()];
  });
  console.log('\n[材质清单]  (inj=已进风场)');
  for (const m of mats){
    const tag = m.inj ? `${m.mode} amp=${m.amp}` : '— 未进风场';
    console.log(`  ${m.inj ? '✔' : '·'} ${String(tag).padEnd(20)} map=${m.hasMap ? '有' : '无'}` +
                ` #${m.color} ${m.type} ×${m.n}` +
                `${m.inj && m.maxDisp ? ' 位移上限=' + m.maxDisp + 'm' : ''}  e.g. ${m.sample}`);
  }
  console.log('\n[仅未进风场且带贴图的材质]（GLB 资产的真身应在此列，若为空说明已全部注入）');
  for (const m of mats.filter(m => !m.inj && m.hasMap)){
    console.log(`  · ${m.type} ×${m.n}  map=有  e.g. ${m.sample}`);
  }

  const bySig = (pred) => mats.find(pred);
  /* GLB 荷花丛与芭蕉叶都是**带贴图**的材质（GLB 自带 map），程序化植被一律无贴图 ——
     所以"有 map + tip"就是这两类资产的指纹。 */
  const tipMapped = mats.filter(m => m.hasMap && m.mode === 'tip');
  /* 2026-09-30 三轮：LotusPlant.glb 回归 ⇒ 带贴图的 tip 材质恢复两种（荷花丛+芭蕉叶）。 */
  check('风场：GLB 资产（荷花丛/芭蕉叶，带贴图）已注入且走 tip 模式',
        tipMapped.length >= 2, tipMapped.map(m => `amp=${m.amp}`).join(' ') || '无');
  /* 芭蕉叶幅度二轮定标（2026-09-17 用户："夸张到极致了"）：0.13→0.05。
     amp 0.13 时叶尖 ampEff ≈ 0.45m（12% 株高）= 抽搐；0.05 → ≈0.17m（4.5% 株高）。 */
  check('风场：芭蕉叶幅度 0.04~0.08（叶尖被风掀起量级，非抽搐）',
        tipMapped.some(m => m.amp >= 0.04 && m.amp <= 0.08),
        tipMapped.map(m => m.amp).join(' '));
  check('风场：荷花瓣/荷叶走 tip 模式（越高越摆，不再被 clamp 成 0）',
        !!bySig(m => m.mode === 'tip' && !m.hasMap && m.amp >= 0.03));
  check('风场：假茎走 base 模式（根部固定，不再整根钟摆）',
        !!bySig(m => m.mode === 'base' && m.amp > 0 && m.amp <= 0.03));
  check('风场：柳叶幅度已降到 ≤0.08', !!bySig(m => m.mode === 'crown' && m.amp <= 0.08));
  check('风场：无残留的 king 级幅度（>0.2）', !mats.some(m => m.amp > 0.2),
        mats.filter(m => m.amp > 0.2).map(m => m.amp).join(',') || '—');
  /* 位移硬顶分两档，按 maxDisp 而不是 amp 分（两者 amp 只差 0.02，分不开）：
       水生（荷/睡莲）≤6cm —— 老黄要求"晃动只能在水池中，不要穿模到岸边草皮或石头"；
       芭蕉大叶 ≤22cm —— 反算够不等于永远够，amp 将来被调大一档也不会破防。 */
  const capped  = mats.filter(m => m.inj && m.mode === 'tip' && m.maxDisp > 0);
  const aquatic = capped.filter(m => m.maxDisp <= 0.06);
  const bigLeaf = capped.filter(m => m.maxDisp > 0.06);
  /* 2026-09-30 三轮：GLB 回归 ⇒ 水生 tip 材质恢复 ≥3（荷花丛自带 + 荷花瓣 + 睡莲叶/杆）。 */
  check('风场：水生植物（tip 模式）位移有硬上限且 ≤6cm',
        aquatic.length >= 3 && aquatic.every(m => m.maxDisp <= 0.06),
        aquatic.map(m => `${m.amp}/上限${m.maxDisp}`).join(' '));
  check('风场：芭蕉大叶位移硬上限 ≤22cm',
        bigLeaf.length >= 1 && bigLeaf.every(m => m.maxDisp <= 0.22),
        bigLeaf.map(m => `${m.amp}/上限${m.maxDisp}`).join(' ') || '无');

  /* ── 2 · 灯笼支点：必须落在挂点上，绳顶端与支点重合 ── */
  /* ⚠️ 绳的几何是 CylinderGeometry(r, r, 1, 6)（单位高、中心在原点），所以它的**顶点**
     局部坐标是 ±0.5，不是 ±scale.y/2 —— 后者已经把缩放算进去了，再经 localToWorld
     会**二次缩放**（探针第一版算出的绳顶偏移 0.1097 恰好等于 0.675² / 2 那条链）。 */
  const lan = await page.evaluate(() => {
    const g = window.__garden, THREE = g.THREE;
    const findCord = (inner) => {
      let cord = null;
      inner.children.forEach(c => {
        if (c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry' &&
            c.scale.y > 0.05 && c.scale.y < 20) cord = c;
      });
      return cord;
    };
    return g.lanternGroups.map(p => {
      const inner = p.children[0];
      const cord = findCord(inner);
      if (!cord) return { err: 'undetected' };
      const top = new THREE.Vector3(0, 0.5, 0); cord.localToWorld(top);
      const bot = new THREE.Vector3(0, -0.5, 0); cord.localToWorld(bot);
      const lamp = new THREE.Vector3(); inner.getWorldPosition(lamp);
      const piv = p.position;
      return {
        pivot: [+piv.x.toFixed(3), +piv.y.toFixed(3), +piv.z.toFixed(3)],
        cordLen: +cord.scale.y.toFixed(3),
        dTop: +top.distanceTo(piv).toFixed(4),        // 绳顶端 ↔ 支点：应 ≈0
        dBot: +bot.distanceTo(piv).toFixed(3),        // 绳下端 ↔ 支点：应 >0
        dLamp: +lamp.distanceTo(piv).toFixed(3),      // 灯笼中心 ↔ 支点：应 > 绳下端
      };
    });
  });
  console.log('\n[灯笼支点]');
  for (const l of lan) console.log('  ' + JSON.stringify(l));
  check('灯笼：支点是挂点（绳顶端与支点重合）',
        lan.length > 0 && lan.every(l => l.dTop < 0.01), lan.map(l => l.dTop).join(', '));
  check('灯笼：灯笼中心离支点比绳下端更远（摆幅 灯笼 > 绳下端 > 绳上端）',
        lan.every(l => l.dLamp > l.dBot && l.dBot > 0),
        lan.map(l => `绳下${l.dBot}/灯${l.dLamp}`).join(' '));

  /* ── 3 · 施加摆角后实测位移：挂点必须纹丝不动，位移随离支点距离递增 ──
     ⚠️ 这里量的是**旋转前后的位置差**，不是"到支点的距离" —— 后者在刚体旋转下守恒，
     探针第一版把 0.675（绳长）当成位移报了，读起来像是"绳下端位移 67cm"。 */
  const swung = await page.evaluate(() => {
    const g = window.__garden, THREE = g.THREE, out = [];
    const findCord = (inner) => {
      let cord = null;
      inner.children.forEach(c => {
        if (c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry' &&
            c.scale.y > 0.05 && c.scale.y < 20) cord = c;
      });
      return cord;
    };
    const at = (cord, sign) => { const v = new THREE.Vector3(0, sign * 0.5, 0); cord.localToWorld(v); return v; };
    for (const p of g.lanternGroups){
      const inner = p.children[0], cord = findCord(inner);
      const t0 = at(cord, 1).clone(), b0 = at(cord, -1).clone();
      const l0 = new THREE.Vector3(); inner.getWorldPosition(l0);
      const piv0 = p.position.clone();
      p.rotation.x = 0.045; p.rotation.z = 0.027; p.updateMatrixWorld(true);
      const t1 = at(cord, 1), b1 = at(cord, -1);
      const l1 = new THREE.Vector3(); inner.getWorldPosition(l1);
      out.push({
        pivotShift: +piv0.distanceTo(p.position).toFixed(6),
        topShift: +t0.distanceTo(t1).toFixed(5),
        botShift: +b0.distanceTo(b1).toFixed(5),
        lampShift: +l0.distanceTo(l1).toFixed(5),
      });
      p.rotation.set(0, 0, 0); p.updateMatrixWorld(true);
    }
    return out;
  });
  console.log('\n[摆角 0.045+0.027 rad 下的真实位移]');
  for (const s of swung) console.log('  ' + JSON.stringify(s));
  check('灯笼：挂点静止（施加摆角后挂点位移 = 0）', swung.every(s => s.pivotShift === 0));
  check('灯笼：绳上端位移 ≈ 0（与屋梁的连接处不动）', swung.every(s => s.topShift < 0.002),
        swung.map(s => s.topShift).join(', '));
  check('灯笼：位移随离支点距离递增（绳上端 0 < 绳下端 < 灯笼）',
        swung.every(s => s.botShift > 0.01 && s.lampShift > s.botShift),
        swung.map(s => `${s.topShift}<${s.botShift}<${s.lampShift}`).join(' '));

  /* ── 4 · 池面叶盘（2026-09-30 重写）──
     原本这两条断言的是"程序化杆高常量 vs GLB 花位下限""GLB 丛顶 ≈2.0m" ——
     GLB 在 a08bde0 已删、池边大荷花在 2026-09-30 二轮整体撤下（只剩叶盘），
     两条都成了必然红的死判据。换成守**现行不变量**：池面叶盘全部落在池内
     （旧版大荷花叶盘没走夹回，实测 5 片在岸上 —— 老黄："睡莲又到草皮上了"）。 */
  const padsInPond = await page.evaluate(() => {
    const g = window.__garden, THREE = g.THREE;
    const pads = [];
    g.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.geometry || o.geometry.type !== 'ShapeGeometry') return;
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      for (let i = 0; i < o.count; i++){
        o.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        pads.push([+v.x.toFixed(2), +v.z.toFixed(2)]);
      }
    });
    const inPond = pads.filter(p => g.insidePond(p[0], p[1] - 3.0));   // insidePond 吃池局部坐标（池心世界 z=+3）
    return { n: pads.length, inPond: inPond.length, onLand: pads.length - inPond.length,
             ex: pads.filter(p => !g.insidePond(p[0], p[1])).slice(0, 3) };
  });
  check('池面叶盘：全部落在池内（睡莲不上岸）', padsInPond.onLand === 0,
        `叶盘 ${padsInPond.n} 片：池内 ${padsInPond.inPond} / 岸上 ${padsInPond.onLand}` +
        (padsInPond.ex.length ? `，例 ${JSON.stringify(padsInPond.ex)}` : ''));

  /* ── 4b · 杆高必须盖住花底（2026-09-30 四轮恢复 —— 这条判据防的就是本次的病）──
     GLB 荷花丛的几何里**没有茎**（花与叶分别烘进网格，0~1.7m 之间是空的），
     杆一直是 08 里补的；杆在 mergeStatics 里合并后名字丢失，无法从场景反查
     顶点高度 ⇒ 只能断言设计常量。四轮那天有人把这个常量判成"死判据"删了，
     当晚老黄就反馈"荷花都浮在空中" —— 杆顶 1.78×0.84 ≈ 1.50m 必须盖住
     花位下限 1.748×0.84 ≈ 1.47m，差 3cm，一删就悬空。 */
  const stemConst = await page.evaluate(() => window.__garden.GLB_LOTUS_STEM_H);
  const flowerBottomMin = 1.748 * 0.84;
  check('荷花杆：杆高常量已覆盖 GLB 花位下限（杆顶 ≥ 花底，否则花悬空）',
        stemConst * 0.84 >= flowerBottomMin - 0.02,
        `常量 ${stemConst} → 最低株杆顶 ${(stemConst * 0.84).toFixed(3)}m，花底 ${flowerBottomMin.toFixed(3)}m`);

  /* ── 5 · 风的三层调度：L1 风向 16 档 / L2 风力四档 ──
     ⚠️ 必须**手动步进**状态机，不能靠墙钟等：软渲染下一帧 8.4 秒、模拟时间只走真实 1/20，
     等一次 12~30 秒的换向要等到天荒地老，而且换向目标随机、等到一次也未必看得全。
     手动步进 900 秒仿真时间，把整段调度史一次收全（本项目既定范式）。
     ⚠️ 判据要落到 **uWindVec**（shader 真正吃的东西），不能只断言"档位号正确" ——
     档位对了但向量写错，门禁会绿、画面会错。
     ⚠️ 必须先在**狂风暴雨**下测：用户报的就是这个场景，而页面默认天气是晴天（区间 [0,1]）。
     上一版忘了切天气，拿晴天的观测去断言"暴雨区间 [1,3]"，红得莫名其妙 ——
     判据本身没错，是前提错了。切完还要**回读 windMul 确认真的切过去了**，否则又是一次假绿。 */
  const wx = await page.evaluate(async () => {
    const g = window.__garden;
    g.setEnv('weather', 'storm');
    g.ENV.t = 0.999;                     // 把 2.8 秒过渡直接推到末尾，不干等
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { weather: g.ENV.weather, windMul: g.ENV.cur.windMul };
  });
  console.log(`\n[调度测试前提] 天气=${wx.weather}｜windMul=${wx.windMul}`);
  check('前置：已进入狂风暴雨（windMul ≥2.5，否则下面的"区间"断言测的其实是晴天）',
        wx.weather === 'storm' && wx.windMul >= 2.5, `weather=${wx.weather} windMul=${wx.windMul}`);

  const sched = await page.evaluate(() => {
    const g = window.__garden, STEP = Math.PI / 8, TAU2 = Math.PI * 2;
    const dirTurns = [], forceTurns = [];
    let lastT0 = null, lastF0 = null, gridErr = 0, vecErr = 0, tierMin = 99, tierMax = -1;
    for (let t = 0; t <= 900; t += 0.25){
      g.updateWindDir(t); g.updateWindForce(t);
      const d = g.WIND_DIR, f = g.WIND_FORCE;
      if (d.t0 !== lastT0){
        dirTurns.push({ t0: +d.t0.toFixed(2), steps: +(Math.abs(d.to - d.from) / STEP).toFixed(4) });
        lastT0 = d.t0;
      }
      if (f.t0 !== lastF0){ forceTurns.push({ t0: +f.t0.toFixed(2), idx: f.idx, lo: f.lo, hi: f.hi }); lastF0 = f.t0; }
      /* 只在过渡结束后取样：静止态的风向必须落在 16 档栅格上 */
      if (t >= d.t0 + d.dur){
        const a = ((d.angle % TAU2) + TAU2) % TAU2, want = d.tier * STEP;
        const e = Math.abs(a - want);
        gridErr = Math.max(gridErr, Math.min(e, TAU2 - e));
        tierMin = Math.min(tierMin, d.tier); tierMax = Math.max(tierMax, d.tier);
        // 档位号 → 向量的映射必须逐位吻合：(sin a, −cos a)
        const v = g.WIND.uWindVec.value;
        vecErr = Math.max(vecErr,
          Math.abs(Math.hypot(v.x, v.y) - 1) + Math.abs(v.x - Math.sin(a)) + Math.abs(v.y + Math.cos(a)));
      }
    }
    const gaps = (arr) => arr.slice(1).map((x, i) => +(x.t0 - arr[i].t0).toFixed(2));
    const dt = dirTurns.slice(1), ft = forceTurns.slice(1);      // 丢掉 t0=−99 的合成首项
    return {
      nDir: dt.length, dirGaps: gaps(dt), dirSteps: dt.map(x => x.steps),
      nForce: ft.length, forceGaps: gaps(ft), forceIdx: ft.map(x => x.idx),
      forceBandSeen: [...new Set(ft.map(x => x.lo + '~' + x.hi))],
      gridErr: +gridErr.toFixed(7), vecErr: +vecErr.toFixed(7), tierMin, tierMax,
      dirN: g.DIR_N, tierNames: g.FORCE_TIERS.map(x => x.name),
      bandStorm: g.forceBand(4.0), bandClear: g.forceBand(1.0),
      gainClear: +g.windGain(1.0).toFixed(3), gainStorm: +g.windGain(4.0).toFixed(3),
    };
  });
  console.log('\n[风的三层调度] 手动步进 900 秒仿真');
  console.log(`  风向：换向 ${sched.nDir} 次｜间隔 ${sched.dirGaps.slice(0, 6).join(', ')} s｜跨档 ${[...new Set(sched.dirSteps)].slice(0, 6).join('/')} 档`);
  console.log(`  风力：换档 ${sched.nForce} 次｜间隔 ${sched.forceGaps.slice(0, 6).join(', ')} s｜出现档位 ` +
              `${[...new Set(sched.forceIdx)].map(i => sched.tierNames[i]).join('/')}`);
  console.log(`  天气区间：暴雨 ${JSON.stringify(sched.bandStorm)}｜晴 ${JSON.stringify(sched.bandClear)}｜` +
              `增益 晴 ${sched.gainClear} / 暴雨 ${sched.gainStorm}`);

  check('L1：风向是 16 档离散栅格（静止态角度误差 < 1e-6 rad）',
        sched.dirN === 16 && sched.gridErr < 1e-6 && sched.tierMin >= 0 && sched.tierMax <= 15,
        `档位 ${sched.tierMin}~${sched.tierMax}，最大栅格误差 ${sched.gridErr}`);
  check('L1：档位号 → uWindVec 映射正确（单位向量 = (sin a, −cos a)，shader 吃的是这个）',
        sched.vecErr < 1e-6, `最大误差 ${sched.vecErr}`);
  check('L1：每次换向都挪整数档且至少 1 档（不会"原地换档"读作卡住）',
        sched.dirSteps.length > 5 &&
        sched.dirSteps.every(s => s >= 0.999 && Math.abs(s - Math.round(s)) < 0.01),
        `跨档 ${sched.dirSteps.slice(0, 8).join(' ')}`);
  check('L1：换向保持 ≥12 秒（够观众看出这一阵风的方向）',
        sched.dirGaps.length > 5 && Math.min(...sched.dirGaps) >= 12,
        `最短 ${Math.min(...sched.dirGaps)}s，共 ${sched.dirGaps.length} 段`);
  check('L2：风力只在天气允许的区间内换档（暴雨 = 中风~台风，不出现微风/晴天档）',
        JSON.stringify(sched.bandStorm) === '[1,3]' &&
        sched.forceBandSeen.length === 1 && sched.forceBandSeen[0] === '1~3',
        `暴雨区间 ${JSON.stringify(sched.bandStorm)}，实际出现 ${sched.forceBandSeen.join(' ')}`);
  check('L2：换档保持 ≥5 秒，且三档（中风/大风/台风）都真的出现过',
        sched.forceGaps.length > 5 && Math.min(...sched.forceGaps) >= 5 &&
        new Set(sched.forceIdx).size === 3,
        `最短 ${Math.min(...sched.forceGaps)}s，出现 ${[...new Set(sched.forceIdx)].map(i => sched.tierNames[i]).join('/')}`);
  check('L2：晴天区间是微风~中风（狂风暴雨的可达区间确实更猛）',
        JSON.stringify(sched.bandClear) === '[0,1]' && JSON.stringify(sched.bandStorm) !== JSON.stringify(sched.bandClear),
        `晴 ${JSON.stringify(sched.bandClear)} / 暴雨 ${JSON.stringify(sched.bandStorm)}`);
  check('L2：天气决定绝对量级（晴天增益 ≪ 暴雨增益，"微风档"在晴天不该摆 30cm）',
        sched.gainStorm > 0.95 && sched.gainClear < 0.12,
        `晴 ${sched.gainClear} / 暴雨 ${sched.gainStorm}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[wind-audit] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  fs.writeFileSync(path.join(OUT, 'wind-audit.json'),
    JSON.stringify({ mats, lanterns: lan, swung, lotus, sched, results }, null, 2));
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[wind-audit] 探针自身异常：', e); process.exit(1); });
