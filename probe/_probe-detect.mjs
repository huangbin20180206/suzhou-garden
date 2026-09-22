// 一次性：验证"探针识别信号"在 Playwright 下真的成立。
// 起因：QOS 的运行期自适应靠 `SOFTWARE_GL` 免疫软渲染，但换到真 GPU 后 SOFTWARE_GL=false
// → 自适应被激活、12 帧就自己降档 → 门禁基线中途漂移。
// 打算把免疫判据换成 `navigator.webdriver === true`（"被自动化驱动"）。
// ⚠️ 但这是**假设**，必须先实测 —— 本项目的规矩是判据要能观测，不靠"应该会"。
// 用法: node probe/_probe-detect.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const CASES = [
  { name: 'A 无参数（现状）',   headless: true, args: [] },
  { name: 'B GPU 参数',         headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] },
];

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const out = [];
  for (const c of CASES){
    const browser = await chromium.launch({ headless: c.headless, args: c.args });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const r = await page.evaluate(() => ({
      webdriver: navigator.webdriver,
      hasWebdriverIn: 'webdriver' in navigator,
      ua: navigator.userAgent.includes('HeadlessChrome') ? 'HeadlessChrome' : (navigator.userAgent.includes('Chrome') ? 'Chrome' : 'other'),
    }));
    await browser.close();
    out.push({ case: c.name, ...r });
    console.log(`  ${c.name.padEnd(18)} navigator.webdriver = ${JSON.stringify(r.webdriver)}  ('webdriver' in navigator = ${r.hasWebdriverIn})  UA=${r.ua}`);
  }
  const ok = out.every(r => r.webdriver === true);
  console.log(`\n[probe-detect] ${out.length} 个用例里 webdriver 恒为 true：${ok ? '是 ✓ 可以作为探针识别信号' : '否 ✗ 不可用，得换信号'}`);
  fs.mkdirSync(path.join(ROOT, 'outputs', '_diag'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'outputs', '_diag', 'probe-detect.json'), JSON.stringify(out, null, 2));
  server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('[probe-detect] 异常：', e); server.close(); process.exit(1); });
