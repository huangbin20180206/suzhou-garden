// 零依赖静态服务器：npm run serve → http://127.0.0.1:8935
// 开发预览用；测试探针（smoke.mjs）内置了自己的服务器实例，不依赖本文件。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8935;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.mjs':  'text/javascript',
  '.glb':  'model/gltf-binary',
  '.mp3':  'audio/mpeg',        // 雷鸣素材（2026-09-30 电闪雷鸣）——decodeAudioData 其实不看 Content-Type，
  '.png':  'image/png',         // 但按真类型发更稳（也免得将来加 <audio> 直连播放时踩坑）
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg':  'image/svg+xml',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  // 只允许项目内文件（防路径穿越）
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    /* ⚠️ 2026-10-11（老黄："现在每次进项目前这个下载都要持续好久"）：**模型资产允许 HTTP 缓存**。
       原来一律 `no-cache`（开发期禁缓存、改完刷新即生效）——但这条对**代码**才有意义；
       对 assets/*.glb 这种"内容不常变的大件"等于每次进来都重下 3.5 MB。
       ⚠️ 而且 `no-cache` 在没有 ETag/Last-Modified 时是**最坏组合**：不能复用、也不能 304，
       只能整包重下。这里给资产 7 天强缓存（改模型时文件名不变 ⇒ 需要把 sw.js 的
       ASSET_CACHE 后缀 +1；`npm run check` 会盯这件事）。代码类维持 no-cache。
       ⚠️ 这条只影响**本地开发服务器**；线上是静态托管，缓存策略由那边的规则决定。 */
    const isAsset = /^\/assets\/|^\/docs\/|^\/icons\//.test(p);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=604800, immutable' : 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} → http://127.0.0.1:${PORT}`));
