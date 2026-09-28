/* ══ 基础版入口 / 芭蕉替身 门禁（2026-09-27 · 段 2b-2b）═══════════════════════
   为什么**另建一个文件**而不是并进 preload-guard：
     · preload-guard 的 run() 是围绕 "program 数 A/B 对照 + 首帧预算" 定做的
       （strip / chunky 两种源码补丁 + 冷缓存双 browser），它已有 16 项在绿；
     · 本文件要的两条判据用的是**完全不同的臂形状**：
         判据 6 需要 page.route 注入 404（拦单个 .glb）
         判据 7 需要慢4G + 真实指针交互 + localStorage 断言
       把这些塞进 run() 要么再加 3 个开关、要么把它的对照语义搅浑，
       风险是**打翻已有的 16 项**。分开建 = 各管各的臂语义，互不牵连。

   ── 本文件的两条判据（各配负例对照，铁律 4）──────────────────────────────
   判据 6 芭蕉替身：
     正例 注入 assets/BananaPlant.glb → 404 ⇒ 场景里必须出现**程序化叶片**
          （≥3 片/株）且**挂在 crown 上**（不是光杆、也不是挂错父级）。
          ⚠️ 还要先核对"拦截真的生效了"——项目教训：page.route 曾被实测
             没生效而据此误判。这里用**双证据**：route 处理器命中计数 > 0
             ∧ preloadState().degraded 里确实含该 URL。
     负例 不注入 ⇒ 替身数量必须为 **0**（证明"走替身"只在失败时发生，不是永真）。
   判据 7 静默入口：
     负例1 未交互时 #ld-quick 必须**不可见**（证明它真是"静默的"）。
     负例2 被动 mousemove **不算**触发（这是我自己定的设计约束，必须验）。
     正例 慢4G 下首次 pointerdown ⇒ #ld-quick 淡入；
          点击后 ⇒ localStorage 标记置位 ∧ 加载层收起 ∧
          **暖编译段真的跑过**（文案序列里出现过「营 造 中 ·」）∧
          场景**不是空的**（三角面/几何数在同一量级）。
          ⚠️ "暖编译跑过"这条是本文件最重要的一条：它把"跳过下载"与
             "跳过编译"区分开 —— 后者会让首帧整批重编，比不暖机更慢。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                          'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
const results = [];
const check = (label, ok, extra) => { results.push({ label, ok });
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 页内：记录 .ld-text 文案序列（用来证明暖编译段确实跑过）。 */
const INIT = () => {
  window.__bt = { txt: [] };
  const attach = () => {
    const t = document.querySelector('#loading .ld-text');
    if (!t) return false;
    new MutationObserver(() => window.__bt.txt.push(t.textContent || ''))
      .observe(t, { childList: true, characterData: true, subtree: true });
    return true;
  };
  if (!attach()){ const iv = setInterval(() => { if (attach()) clearInterval(iv); }, 10); }
};

/* 收集"芭蕉替身"证据：替身冠层数、叶片总数、以及它是否挂在真正的 crown 上。
   ⚠️ "挂在 crown 上"必须**从植株组反查**，不能只看替身自己：
      挂错父级的形态是"替身存在、但季节缩放不动它"，只看替身自己查不出来。
   ⚠️⚠️ **不要用 `crown.getObjectByProperty('userData.substitute', v)`** ——
      Three 的 getObjectByProperty 做的是**扁平** `object[name] === value`，
      它**不支持点号路径**！传 'userData.substitute' 会去读 `o['userData.substitute']`
      （一个不存在的字面量键）⇒ 永远 undefined ⇒ 反查恒为 0。
      第一版就是这么写的，实测 onCrown=0/8 假红（而同一探针的 leaves 计数是对的，
      正是"替身确实在 crown 里"的反证）。这里改成手写递归 traverse。 */
const SUB_PROBE = () => {
  const findSub = (root) => {
    let hit = null;
    root.traverse(o => { if (!hit && o.userData && o.userData.substitute === 'banana-leaf') hit = o; });
    return hit;
  };
  let crowns = 0, leaves = 0, onCrown = 0, minLeaves = Infinity;
  const plants = [];
  window.__garden.scene.traverse(o => {
    if (!o.userData || !o.userData.crown) return;
    const cn = o.userData.crown;
    const subs = [];
    for (const h of cn.children) for (const c of h.children){
      if (c.userData && c.userData.substitute === 'banana-leaf') subs.push(c);
    }
    if (!subs.length) return;
    plants.push(o.name || '(anon)');
    for (const s of subs){
      crowns++;
      const lc = s.children.filter(m => m.isMesh).length;
      leaves += lc;
      minLeaves = Math.min(minLeaves, lc);
      if (findSub(cn) === s) onCrown++;
    }
  });
  return { crowns, leaves, onCrown, minLeaves: Number.isFinite(minLeaves) ? minLeaves : 0, plants };
};

/* 一臂 = 一个全新 browser。throttle: 慢4G；killBanana: 给 BananaPlant.glb 打 404。
   interact: 走"用户动手 → 点静默入口"的完整路径。 */
async function run(chromium, port, { throttle, killBanana, interact }){
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(700000);
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  /* 拦截生效的**第一份证据**：处理器命中次数。0 次 = 拦截根本没打上。 */
  let bangHits = 0;
  if (killBanana){
    await page.route(u => u.pathname.endsWith('/BananaPlant.glb'), r => {
      bangHits++;
      r.fulfill({ status: 404, contentType: 'text/plain', body: 'injected-404' });
    });
  }
  if (throttle){
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    // 慢4G 1.5Mbps/100ms（100M 档失真 1.6× 已证伪，不采用）
    await cdp.send('Network.emulateNetworkConditions',
      { offline: false, latency: 100, downloadThroughput: 1.5e6 / 8, uploadThroughput: 1.5e6 / 8 });
  }
  await page.addInitScript(INIT);
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 420000 });

  // 等 boot 起来（loading 层在 + __garden 存在）
  await page.waitForFunction(() => !!window.__garden && !!document.getElementById('loading'),
    { timeout: 300000, polling: 50 });

  const out = { bangHits, errs };
  if (interact){
    // ── 负例1：未交互时必须不可见 ──
    out.visBefore = await page.evaluate(() => {
      const b = document.getElementById('ld-quick');
      if (!b) return 'MISSING';
      return { hidden: b.hidden, show: b.classList.contains('show') };
    });
    // ── 负例2：被动 mousemove 不算触发 ──
    await page.mouse.move(60, 60); await page.mouse.move(200, 120); await page.mouse.move(420, 300);
    await sleep(900);
    out.visAfterMove = await page.evaluate(() => {
      const b = document.getElementById('ld-quick');
      return { hidden: b.hidden, show: b.classList.contains('show') };
    });
    // ── 正例：首次 pointerdown ⇒ 淡入（重试若干次以容忍 armQuickEntry 的武装时点）──
    let shown = false;
    for (let i = 0; i < 12 && !shown; i++){
      await page.mouse.move(600, 360);
      await page.mouse.down(); await page.mouse.up();     // 真指针路径
      await sleep(280);
      shown = await page.evaluate(() => {
        const b = document.getElementById('ld-quick');
        return !b.hidden && b.classList.contains('show');
      });
    }
    out.shownAfterDown = shown;
    out.visNow = await page.evaluate(() => {
      const b = document.getElementById('ld-quick');
      const cs = getComputedStyle(b);
      return { hidden: b.hidden, show: b.classList.contains('show'), opacity: cs.opacity,
               pointerEvents: cs.pointerEvents, display: cs.display };
    });
    // ── 点击 → 走完 warmBoot ──
    if (shown){
      await page.click('#ld-quick', { force: true });
      out.lsAfterClick = await page.evaluate(() => { try { return localStorage.getItem('sg.basicEntered'); } catch { return 'ERR'; } });
    }
  }

  // 等加载层收起（走完 warmBoot 的收尾）。interact 臂若已提前开园则立刻满足。
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'),
    { timeout: 560000, polling: 50 }).catch(() => {});
  await page.evaluate(async () => { if (window.__garden?.bootDonePromise) await window.__garden.bootDonePromise; });
  await sleep(800);

  const d = await page.evaluate(() => {
    const g = window.__garden;
    const s = g && g.preloadState ? g.preloadState() : null;
    return {
      degraded: s ? s.degraded.map(x => x.url || x) : null,
      settled: s?.settled, count: s?.count,
      tri: g?.renderer?.info?.render?.triangles ?? -1,
      geos: g?.renderer?.info?.memory?.geometries ?? -1,
      txtSeq: window.__bt.txt.slice(),
      done: document.getElementById('loading').classList.contains('done'),
      quickHidden: document.getElementById('ld-quick')?.hidden,
    };
  });
  /* ⚠️ 替身证据**单独一次 evaluate**，且直接传函数（Playwright 会序列化函数体）。
      早先写成 `new Function('return (' + src + ')()')` 是错的：页面若有 CSP
      会直接挡住 new Function —— 而且那种写法在这里完全没必要。 */
  const sub = await page.evaluate(SUB_PROBE);

  await browser.close();
  return Object.assign(out, d, { sub });
}

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();

  /* ══ 臂 D：注入 404（判据 6 正例）═════════════════════════════════════════ */
  console.log('【臂 D：BananaPlant.glb 注入 404 —— 替身必须上场】');
  const D = await run(chromium, port, { killBanana: true });
  // 前提①：拦截真的生效（route 命中 > 0）
  check('D 前提：404 拦截确实被请求命中（否则后面全是永真）', D.bangHits > 0, `命中 ${D.bangHits} 次`);
  // 前提②：预载清单确实把该 URL 判成降级
  const dBanana = (D.degraded || []).some(u => /BananaPlant/i.test(u));
  check('D 前提：preloadState().degraded 里确实含 BananaPlant（降级被登记）',
    dBanana, `degraded=${JSON.stringify(D.degraded)}`);
  // 判据①：替身叶片 ≥3 片/株（不是光杆）
  check('D ① 芭蕉替身叶片 ≥3 片/株（不是光杆）', D.sub.leaves >= 3 && D.sub.minLeaves >= 3,
    `株数=${D.sub.crowns} 叶总=${D.sub.leaves} 最少的株=${D.sub.minLeaves} 片`);
  // 判据②：替身挂在 crown 上（季节缩放能作用到它）
  check('D ② 替身挂在植株的 crown 上（不是挂错父级）', D.sub.onCrown > 0 && D.sub.onCrown === D.sub.crowns,
    `onCrown=${D.sub.onCrown}/${D.sub.crowns}`);
  /* ⚠️ 本臂**故意**注入 404 ⇒ 浏览器必然打一条 "Failed to load resource ... 404"。
     那不是应用的错，是注入本身的声音 ⇒ 必须把它排掉再判"零 console error"。
     ⚠️ pageerror（未捕获 JS 异常）**不豁免** —— 那才是真故障。 */
  const realErrs = D.errs.filter(e => !(/Failed to load resource/i.test(e) && /404/.test(e)));
  check('D ④ 零 pageerror / 真实 console error（豁免注入 404 自身那一条）',
    realErrs.length === 0,
    realErrs.length ? realErrs[0] : `0 条（豁免 ${D.errs.length} 条注入 404 噪声）`);

  /* ══ 臂 D0：不注入（判据 6 负例）═════════════════════════════════════════ */
  console.log('\n【臂 D0：负例对照 —— 不注入时不许走替身】');
  const D0 = await run(chromium, port, {});
  check('D0 负例前提：本臂 BananaPlant 未降级（注入确实是变量）',
    !(D0.degraded || []).some(u => /BananaPlant/i.test(u)), `degraded=${JSON.stringify(D0.degraded)}`);
  check('D0 负例：不注入 404 ⇒ 替身数量为 0（证明 D① 有牙，不是永远走替身）',
    D0.sub.crowns === 0 && D0.sub.leaves === 0, `替身株=${D0.sub.crowns} 叶=${D0.sub.leaves}`);

  /* ══ 臂 E：慢4G + 静默入口（判据 7）══════════════════════════════════════ */
  console.log('\n【臂 E：慢4G + 用户动手 —— 静默入口】');
  const E = await run(chromium, port, { throttle: true, interact: true });
  /* ⚠️ 前提只断"清单非空、下载段确实存在"（count>0）。
     不要写 `count >= settled` —— settled ≤ count 恒成立，那个合项是**永真**的凑数，
     会让这条看起来像"有前提"实则只有前半段在管事（今天已自查出两处同类问题）。 */
  check('E 前提：预载清单非空（否则"提前开园"没有东西可提）',
    E.count > 0, `count=${E.count} settled=${E.settled}`);
  check('E 负例1（静默性）：未交互时 #ld-quick 不可见',
    E.visBefore && E.visBefore !== 'MISSING' && E.visBefore.hidden === true && E.visBefore.show === false,
    JSON.stringify(E.visBefore));
  check('E 负例2（设计约束）：被动 mousemove 不触发它',
    E.visAfterMove && E.visAfterMove.hidden === true && E.visAfterMove.show === false,
    JSON.stringify(E.visAfterMove));
  check('E ① 首次 pointerdown 后 #ld-quick 淡入（show + 可见）',
    E.shownAfterDown === true && E.visNow && E.visNow.hidden === false && E.visNow.opacity !== '0',
    JSON.stringify(E.visNow));
  check('E ② localStorage 标记已置位', E.lsAfterClick === '1', `sg.basicEntered=${E.lsAfterClick}`);
  // ③ 暖编译真的跑过 —— 把"跳过下载"与"跳过编译"区分开
  const warmSeen = (E.txtSeq || []).some(t => /营 造 中 ·/.test(t));
  const finaleSeen = (E.txtSeq || []).some(t => /即 将 开 园/.test(t));
  check('E ③ 暖编译段确实跑过（文案序列出现过「营 造 中 ·」—— 没有跳过编译）',
    warmSeen, `文案序列 ${JSON.stringify((E.txtSeq || []).slice(0, 12))}`);
  check('E ④ 收尾到「即 将 开 园」（走完了 warmBoot 的收尾）', finaleSeen && E.done === true,
    `finale=${finaleSeen} done=${E.done}`);
  // ⑤ 场景不是空的（不能是"跳到空场景"）
  check('E ⑤ 场景不是空的（几何数与满配同一量级，不是空场景）',
    E.geos > 300 && E.tri > 300000, `geos=${E.geos} tri=${E.tri}`);
  check('E ⑥ 提前开园确实"砍掉了下载等待"（降级非空）', (E.degraded || []).length > 0,
    `degraded=${JSON.stringify(E.degraded)}`);
  /* ⑧ 替身在**真实静默入口路径**上也确实补上了 —— 不是只有"注入 404"那条路才补。
     这条直接把"用户点了基础版会看到什么"从推测变成证据：降级 4 项，替身在场。 */
  check('E ⑧ 静默入口路径上替身确实补上了（芭蕉叶替身在场，不留光杆）',
    E.sub.leaves >= 3, `替身株=${E.sub.crowns} 叶=${E.sub.leaves} 最少/株=${E.sub.minLeaves}`);
  check('E ⑦ 零 pageerror / console error', E.errs.length === 0, E.errs[0] || '0 条');

  const bad = results.filter(r => !r.ok);
  console.log(`\n[基础版入口/芭蕉替身] ${results.length - bad.length}/${results.length} 项通过`);
  server.close();
  process.exit(bad.length ? 1 : 0);
})();
