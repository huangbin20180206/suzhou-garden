// 只验证：压缩后的 GLB 能否被项目的 loadAssetOnce 正常加载 + 挂进场景
// （不判画面，只判"有没有挂上、节点名还在不在、材质是不是真贴图"）
import { chromium } from 'playwright';
import { launchChromium, listenEphemeral, makeStaticServer } from './probe/_harness.mjs';
const ROOT = process.cwd();
const server = makeStaticServer(ROOT);
const port = await listenEphemeral(server);
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${port}/?nointro=1&tier=low`, { waitUntil: 'domcontentloaded' });
// 等开园
await page.waitForFunction(() => window.__garden && window.__garden.bootDone && window.__garden.bootDone(), null, { timeout: 240000 });
const info = await page.evaluate(() => {
  const g = window.__garden;
  const names = {};
  g.scene.traverse(o => { if (o.name) names[o.name] = (names[o.name] || 0) + 1; });
  // 数一下贴图：有 map 的材质 + 贴图尺寸
  let meshes = 0, withMap = 0;
  g.scene.traverse(o => { if (o.isMesh) { meshes++; const m = o.material; if (m && m.map && m.map.image) withMap++; } });
  return { assetFailures: window.__garden.assetFailures,
           hasTurtle: !!names['Turtle'], hasKoi: !!names['KoiFish'],
           macaw: Object.keys(names).filter(n=>/Macaw/i.test(n)),
           meshes, withMap,
           loopErrors: g.loopErrors ? g.loopErrors().count : -1 };
});
console.log(JSON.stringify(info, null, 2));
console.log('pageerrors:', errs.length, errs.slice(0,5));
await browser.close(); server.close();
