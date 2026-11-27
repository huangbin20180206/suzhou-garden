// @guards: index.html, src/main.js, src/11-loop.js, src/11c-ux.js, src/12-env.js, src/00a-quality.js
// 真实浏览器回归：依赖失败、生产裁剪接口、分享接管与视口像素预算。
// 生产分支必须用非 localhost 源且 webdriver=false；否则本地调试接口会掩盖产品接线错误。
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchChromium, makeStaticServer, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = makeStaticServer(ROOT);
const port = await listenEphemeral(server);
const local = 'http://127.0.0.1:' + port;
const results = [];
function check(name, ok, detail = ''){
  results.push({ name, ok:!!ok });
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
}
async function visible(page, selector){
  return page.locator(selector).waitFor({ state:'visible', timeout:4000 }).then(() => true, () => false);
}
async function ready(page){
  await page.waitForFunction(() => window.__garden?.bootDone?.()
    && document.getElementById('loading')?.classList.contains('done'), null, { timeout:180000 });
}
async function waitCheck(page, name, predicate, arg = null, timeout = 15000){
  let ok = false;
  try {
    const result = await page.waitForFunction(predicate, arg, { timeout });
    await result.dispose(); ok = true;
  } catch (e){ if (e.name !== 'TimeoutError') throw e; }
  check(name, ok);
  return ok;
}
async function attachRuntime(page){
  // 测试专用句柄只复用已经求值的同源模块；先取句柄再点击，避免 import 延迟吞掉整个飞行窗口。
  await page.evaluate(async () => {
    const [tour, env, gfx, config, wind] = await Promise.all([
      import('/src/08d-tour.js'), import('/src/12-env.js'), import('/src/02-scene.js'),
      import('/src/00-config.js'), import('/src/2b-wind.js'),
    ]);
    const h = { tour, env, gfx, hooks:config.HOOKS, wind, lastClick:0, captionHideAfter:null };
    h.flags = () => ({ reel:env.REEL.on, seasonDemo:env.SEASON_DEMO.on, tour:tour.TOUR.on,
      intro:tour.INTRO.on, flying:tour.CAM_FLY.on, walking:!!h.hooks.walkState?.().active });
    h.off = () => Object.values(h.flags()).every(v => v === false);
    h.view = () => ({ hour:env.ENV.hour, season:env.ENV.season, weather:env.ENV.weather,
      cam:gfx.camera.position.toArray(), tgt:gfx.controls.target.toArray(), ...h.flags() });
    const near = (v, a) => Math.hypot(v.x - a[0], v.y - a[1], v.z - a[2]) < 0.05;
    h.matches = target => Math.abs(env.ENV.hour - target.hour) < 1e-8
      && env.ENV.season === target.season && env.ENV.weather === target.weather && h.off()
      && (!target.cam || (near(gfx.camera.position, target.cam) && near(gfx.controls.target, target.tgt)));
    h.atLantern = () => {
      const v = tour.VIEWPOINTS.find(v => v.id === 'lantern');
      return !!v && h.off() && gfx.controls.enabled
        && gfx.camera.position.distanceTo(v.pos) < 0.05 && gfx.controls.target.distanceTo(v.target) < 0.05;
    };
    // 以下仅建立每例的前置状态；观察阶段一律不调用 update/advance/step。
    h.reset = () => {
      h.hooks.walkExit?.();
      if (env.REEL.on) env.toggleReel();
      env.stopSeasonDemo('runtime-edge-reset'); tour.tourStop(); tour.introCancel(); tour.cancelCamFly();
      gfx.resetCamera();
    };
    document.getElementById('see-lantern').addEventListener('click', () => {
      h.lastClick = performance.now(); h.captionHideAfter = null;
    }, true);
    const caption = document.getElementById('caption');
    h.captionObserver = new MutationObserver(() => {
      if (h.lastClick && h.captionHideAfter === null && !caption.classList.contains('show')) h.captionHideAfter = performance.now() - h.lastClick;
    });
    h.captionObserver.observe(caption, { attributes:true, attributeFilter:['class'] });
    window.__runtimeEdge = h;
  });
}
async function observeView(page, target){
  // rAF 只读采样；风钟必须确实推进，避免“浏览器还排帧但产品循环停住”也被当成保持成功。
  return page.evaluate(target => new Promise(resolve => {
    const h = window.__runtimeEdge, start = performance.now(), clock = h.wind.windClock;
    let frames = 0, firstBad = null, raf = 0, done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer); cancelAnimationFrame(raf);
      resolve({ frames, elapsed:performance.now() - start, advanced:h.wind.windClock - clock,
        firstBad, after:h.view() });
    };
    const timer = setTimeout(finish, 15000);
    const tick = () => {
      frames++;
      if (!h.matches(target) && !firstBad) firstBad = h.view();
      if (frames >= 16 && performance.now() - start >= 1000 && h.wind.windClock - clock >= 0.25) finish();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }), target);
}
async function healthy(page, errors, label){
  const loop = await page.evaluate(() => window.__garden.loopErrors());
  check(label + '零 pageerror', errors.length === 0, errors.join(' | '));
  check(label + '零循环错误', loop.count === 0, JSON.stringify(loop));
}
async function viewport(page, width, height){
  await page.setViewportSize({ width, height });
  await page.waitForFunction(({ width, height }) => {
    const c = document.querySelector('#app canvas');
    return innerWidth === width && innerHeight === height && c?.clientWidth === width && c?.clientHeight === height;
  }, { width, height });
}
async function renderState(page){
  return page.evaluate(() => {
    const g = window.__garden, q = g.qualityState(), c = g.renderer.domElement;
    return { mode:q.mode, ratio:g.renderer.getPixelRatio(), expected:q.baseScale * q.pixelRatioScale,
      budget:q.pixelBudget, pixels:c.width * c.height, width:c.width, height:c.height,
      css:[innerWidth, innerHeight], composerRatio:g.composer._pixelRatio,
      rt1:[g.composer.renderTarget1.width, g.composer.renderTarget1.height],
      rt2:[g.composer.renderTarget2.width, g.composer.renderTarget2.height], aspect:g.camera.aspect };
  });
}
async function checkRender(page, label, mode){
  const q = await renderState(page);
  check(label + '画质倍率匹配当前视口', q.mode === mode && Math.abs(q.ratio - q.expected) < 1e-4, JSON.stringify(q));
  check(label + '实际像素不超预算', q.pixels <= q.budget + 1,
    JSON.stringify({ pixels:q.pixels, budget:q.budget }));
  // composer 保留小数配置，GPU 分配与 canvas 一样截为整数，须比实际尺寸而非只比 _pixelRatio。
  check(label + 'renderer 与 composer 两张 RT 尺寸一致', q.composerRatio === q.ratio
    && [q.rt1, q.rt2].every(([w, h]) => Math.floor(w) === q.width && Math.floor(h) === q.height)
    && q.width === Math.floor(q.css[0] * q.ratio) && q.height === Math.floor(q.css[1] * q.ratio),
  JSON.stringify({ canvas:[q.width, q.height], rt1:q.rt1, rt2:q.rt2 }));
  check(label + '相机宽高比同步', Math.abs(q.aspect - q.css[0] / q.css[1]) < 1e-8);
}
const browser = await launchChromium(chromium);
try {
  for (const fault of ['dependency', 'webgl']){
    const ctx = await browser.newContext({ serviceWorkers:'block' });
    const page = await ctx.newPage();
    if (fault === 'dependency') await page.route('**/vendor.js', route => route.abort('failed'));
    else await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args){
        if (/^webgl2?$/.test(type)) return null;
        return getContext.call(this, type, ...args);
      };
    });
    await page.goto(local + '/index.html?tier=low&intro=0&guide=0', { waitUntil:'load', timeout:30000 });
    const retry = await visible(page, '#boot-retry');
    check('启动失败有可见重试入口：' + fault, retry);
    if (fault === 'dependency' && retry){
      await page.evaluate(() => dispatchEvent(new ErrorEvent('error', { message:'<img id="boot-injected" src=x> 字面错误' })));
      check('启动错误按纯文本呈现', await page.locator('#boot-injected').count() === 0
        && (await page.locator('#loading').textContent()).includes('<img id="boot-injected" src=x>'));
      await page.unroute('**/vendor.js');
      let releaseVendor;
      const gate = new Promise(resolve => { releaseVendor = resolve; });
      // 重试后先让真实 15s 看门狗出现，再放行依赖：成功必须收起同一 document 中已经出现的错误卡。
      await page.route('**/vendor.js', async route => { await gate; await route.continue(); });
      const recoveryErrors = [];
      page.on('pageerror', e => recoveryErrors.push(e.message));
      try {
        await Promise.all([
          page.waitForEvent('framenavigated', { predicate:frame => frame === page.mainFrame(), timeout:30000 }),
          page.locator('#boot-retry').click({ noWaitAfter:true }),
        ]);
        const timedOut = await waitCheck(page, '重试已重载且慢依赖显示真实 15s 超时卡', () => {
          const ld = document.getElementById('loading');
          return !!document.getElementById('boot-retry') && ld?.textContent.includes('15 秒');
        }, null, 22000);
        if (timedOut) await page.evaluate(() => {
          window.__runtimeEdgeSlowDocument = document;
          window.__runtimeEdgeQuickNode = document.getElementById('ld-quick');
        });
        check('慢依赖超时提示保留基础版入口和进度节点', timedOut && await page.evaluate(() =>
          !!document.getElementById('ld-quick') && !!document.querySelector('#loading .ld-text')));
        releaseVendor();
        await ready(page);
        await waitCheck(page, '依赖恢复后错误加载层实际淡出且不拦点击', () => {
          const ld = document.getElementById('loading'), css = getComputedStyle(ld);
          return ld.classList.contains('done') && Number(css.opacity) < 0.05 && css.pointerEvents === 'none';
        });
        check('慢依赖恢复沿用原 document', timedOut && await page.evaluate(() => window.__runtimeEdgeSlowDocument === document));
        check('依赖恢复后基础版按钮仍为原节点', await page.evaluate(() =>
          window.__runtimeEdgeQuickNode === document.getElementById('ld-quick')));
        await healthy(page, recoveryErrors, '依赖重试恢复');
      } finally { releaseVendor(); }
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true,
    deviceScaleFactor:1, serviceWorkers:'block' });
  // garden.test 仅由本地路由映射，不进行外网 DNS 或请求。
  await ctx.route('http://garden.test/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url:local + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get:() => false, configurable:true });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://garden.test/index.html?tier=low&intro=0&guide=0', { waitUntil:'networkidle', timeout:180000 });
  await ready(page);
  await page.bringToFront();
  const prod = await page.evaluate(() => ({ host:location.hostname, webdriver:navigator.webdriver,
    frozen:Object.isFrozen(window.__garden), scene:'scene' in window.__garden, goto:'gotoViewpoint' in window.__garden }));
  check('真实生产分支未展开调试接口', prod.host === 'garden.test' && prod.webdriver === false
    && prod.frozen && !prod.scene && !prod.goto);
  const drawer = page.getByRole('button',{name:'展开/收起控制面板',exact:true});
  let drawerFocused = false;
  for (let i=0;i<12 && !drawerFocused;i++){
    await page.keyboard.press('Tab');
    drawerFocused = await drawer.evaluate(el => el === document.activeElement);
  }
  check('真实 Tab 导航能聚焦控制面板方印',drawerFocused);
  if (drawerFocused){
    await page.keyboard.press('Enter');
    check('Enter 打开控制面板',await drawer.getAttribute('aria-expanded') === 'true');
    await page.keyboard.press('Space');
    check('Space 收起控制面板',await drawer.getAttribute('aria-expanded') === 'false');
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    check('Escape 收起键盘打开的面板',await drawer.getAttribute('aria-expanded') === 'false');
  }
  await attachRuntime(page);
  for (const mode of ['idle', 'intro', 'walk', 'season', 'tour']){
    const setup = await page.evaluate(mode => {
      const h = window.__runtimeEdge; h.reset();
      if (mode === 'intro') h.tour.introStart();
      else if (mode === 'walk') h.hooks.walk();
      else if (mode === 'season') h.env.startSeasonDemo();
      else if (mode === 'tour') h.tour.tourStart();
      const f = h.flags();
      return { flags:f, ready:mode === 'idle' ? h.off()
        : mode === 'intro' ? f.intro : mode === 'walk' ? f.walking : mode === 'season' ? f.seasonDemo : f.tour };
    }, mode);
    check('灯笼接管前置模式已启动：' + mode, setup.ready, JSON.stringify(setup.flags));
    await page.locator('#see-lantern').click();
    const immediate = await page.evaluate(() => ({ flags:window.__runtimeEdge.flags(),
      shown:document.getElementById('caption').classList.contains('show'),
      title:document.querySelector('#caption b')?.textContent }));
    check('生产移动端看灯笼显示字幕：' + mode, immediate.shown && immediate.title === '石灯笼');
    check('灯笼点击立即停旧相机导演与步行：' + mode,
      !immediate.flags.intro && !immediate.flags.walking && !immediate.flags.seasonDemo && !immediate.flags.tour,
      JSON.stringify(immediate.flags));
    await waitCheck(page, '自然循环完成灯笼导览落位：' + mode, () => window.__runtimeEdge.atLantern());
  }
  await waitCheck(page, '手动灯笼字幕自然收起', () => {
    const h = window.__runtimeEdge;
    return h.captionHideAfter !== null && !document.getElementById('caption').classList.contains('show');
  }, null, 15000);
  const captionMs = await page.evaluate(() => window.__runtimeEdge.captionHideAfter);
  check('字幕由约 6s 计时收尾而非被旧模式提前隐藏', captionMs >= 5800, String(captionMs));

  const shareCases = [
    { mode:'reel', hash:'#v=1&s=autumn&w=mist&h=17.25', target:{ season:'autumn', weather:'mist', hour:17.25 } },
    { mode:'season', hash:'#v=1&s=winter&w=clear&h=8.50&c=12,4,18&t=0,3,-12',
      target:{ season:'winter', weather:'clear', hour:8.5, cam:[12,4,18], tgt:[0,3,-12] } },
  ];
  for (const { mode, hash, target } of shareCases){
    const started = await page.evaluate(mode => {
      const h = window.__runtimeEdge; h.reset();
      if (mode === 'reel') h.env.toggleReel(); else h.env.startSeasonDemo();
      return mode === 'reel' ? h.env.REEL.on : h.env.SEASON_DEMO.on;
    }, mode);
    check('分享接管前旧自动模式确实开启：' + mode, started);
    await page.evaluate(hash => { location.hash = hash; }, hash);
    await waitCheck(page, '分享目标环境/机位落位且所有旧模式停止：' + mode,
      ({ hash, target }) => location.hash === hash && window.__runtimeEdge.matches(target), { hash, target });
    const state = await page.evaluate(() => window.__runtimeEdge.view());
    check('分享链接停止全部旧自动模式：' + mode,
      !state.reel && !state.seasonDemo && !state.tour && !state.intro && !state.flying && !state.walking, JSON.stringify(state));
    const observed = await observeView(page, target);
    check('分享保持性观察期间真实仿真有推进：' + mode,
      observed.frames >= 16 && observed.elapsed >= 1000 && observed.advanced >= 0.25, JSON.stringify(observed));
    check('分享目标在真实后续帧中保持：' + mode, observed.firstBad === null, JSON.stringify(observed));
  }
  await healthy(page, errors, '生产交互');
  await page.evaluate(() => window.__runtimeEdge.captionObserver.disconnect());
  await ctx.close();

  const debugCtx = await browser.newContext({ viewport:{ width:1280, height:720 }, deviceScaleFactor:1, serviceWorkers:'block' });
  const debug = await debugCtx.newPage();
  // window 是 resize 的目标；后注册 capture 监听不保证先于既有 at-target 监听。
  // 在页面脚本前注册并按需武装，保证顶档输入态确实交给产品的 onResize。
  await debug.addInitScript(() => {
    addEventListener('resize', () => {
      const g = window.__garden;
      if (!window.__runtimeEdgeTopResizeArmed || !g?.aaSetStep) return;
      window.__runtimeEdgeTopResizeArmed = false;
      g.aaSetStep(2);
      window.__runtimeEdgeTopResizeBefore = g.aaState();
    });
  });
  const debugErrors = [];
  debug.on('pageerror', e => debugErrors.push(e.message));
  await debug.goto(local + '/index.html?tier=low&intro=0&guide=0', { waitUntil:'networkidle', timeout:180000 });
  await ready(debug);
  await debug.bringToFront();
  for (const mode of ['auto', 'performance']){
    await viewport(debug, 1280, 720);
    await debug.evaluate(mode => window.__garden.setQualityMode(mode), mode);
    await checkRender(debug, mode + ' 初始 720p：', mode);
    await viewport(debug, 3840, 2160);
    await checkRender(debug, mode + ' 放大至 4K：', mode);
    await viewport(debug, 1280, 720);
    await checkRender(debug, mode + ' 返回 720p：', mode);
  }
  await debug.evaluate(() => {
    const g = window.__garden;
    g.setQualityMode('high');
    // 不靠下一 rAF：它会被探针免疫的 AA.tick() 提前归零，掩盖 resize 自身的责任。
    window.__runtimeEdgeTopResizeArmed = true;
    addEventListener('resize', () => {
      window.__runtimeEdgeTopResize = { before:window.__runtimeEdgeTopResizeBefore, after:g.aaState() };
    }, { once:true });
  });
  await viewport(debug, 3840, 2160);
  await waitCheck(debug, '真实 resize 顶档前后状态已取样', () => !!window.__runtimeEdgeTopResize);
  const top = await debug.evaluate(() => window.__runtimeEdgeTopResize);
  check('resize 前置 AA 确实处于顶档', top?.before.step === 2 && top.before.scale === top.before.maxScale, JSON.stringify(top));
  check('resize 处理完成即把 AA 归零', top?.after.step === 0, JSON.stringify(top));
  await checkRender(debug, 'AA 顶档 resize 后 4K：', 'high');
  await viewport(debug, 1280, 720);
  await checkRender(debug, 'AA 顶档 resize 后返回 720p：', 'high');
  await healthy(debug, debugErrors, '调试 resize');
  await debugCtx.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
const failed = results.filter(r => !r.ok);
console.log('[runtime-edge-guard] ' + (failed.length ? 'FAILED' : 'ALL PASS')
  + ' (' + (results.length - failed.length) + '/' + results.length + ')');
assert.equal(failed.length, 0, failed.map(r => r.name).join('; '));
