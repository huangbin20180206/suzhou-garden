// 静态服务器请求边界：直接触发真实 request 回调，不监听端口、不启动浏览器。
// serve 入口复制到临时 fixture，仅拦截 listen 来保留其 MIME / 缓存 / HOST 契约。
// 用法：node --test probe/static-server-unit.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeStaticServer } from './_harness.mjs';

const PROBE = path.dirname(fileURLToPath(import.meta.url));
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-static-unit-'));
const ROOT = path.join(TEMP, 'root');
const SIBLING = path.join(TEMP, 'root-extra');
const files = {
  'index.html': '<!doctype html><title>fixture</title>',
  'code.JS': 'export const fixture = true;',
  'module.mjs': 'export default 1;',
  'encoded name.json': '{"fixture":true}',
  'data.json': '{}',
  'assets/model.glb': 'model fixture',
  'sound.mp3': 'audio fixture',
  'image.png': 'image fixture',
  'docs/readme.txt': 'documentation fixture',
  'icons/icon.svg': '<svg/>',
  'app.webmanifest': '{}',
  'unknown.bin': 'binary fixture',
};
for (const [rel, content] of Object.entries(files)) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
fs.mkdirSync(SIBLING, { recursive: true });
fs.writeFileSync(path.join(SIBLING, 'sentinel.txt'), 'outside-root fixture');

// 删除对象由 mkdtemp 创建；先核对父目录和专用前缀，再清理唯一的测试目录。
after(() => {
  assert.equal(path.dirname(path.resolve(TEMP)), path.resolve(os.tmpdir()));
  assert.match(path.basename(TEMP), /^garden-static-unit-/);
  fs.rmSync(TEMP, { recursive: true, force: true });
});

const copiedProbe = path.join(ROOT, 'probe');
fs.mkdirSync(copiedProbe, { recursive: true });
for (const name of ['serve.mjs', '_static-path.mjs']) {
  const source = path.join(PROBE, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(copiedProbe, name));
}

async function loadServe(host, port, key) {
  const originalListen = http.Server.prototype.listen;
  const originalArgv = process.argv;
  const previousHost = process.env.SERVE_HOST;
  let server, listenArgs;
  http.Server.prototype.listen = function (...args) {
    server = this;
    listenArgs = args;
    return this;
  };
  process.argv = [process.execPath, path.join(copiedProbe, 'serve.mjs')];
  if (port !== undefined) process.argv.push(port);
  if (host === undefined) delete process.env.SERVE_HOST;
  else process.env.SERVE_HOST = host;
  try {
    const url = pathToFileURL(path.join(copiedProbe, 'serve.mjs'));
    url.searchParams.set('fixture', key);
    await import(url.href);
  } finally {
    http.Server.prototype.listen = originalListen;
    process.argv = originalArgv;
    if (previousHost === undefined) delete process.env.SERVE_HOST;
    else process.env.SERVE_HOST = previousHost;
  }
  assert.ok(server, 'serve 入口应创建 HTTP server');
  assert.equal(server.listening, false, 'fixture 始终不绑定端口');
  return { server, listenArgs };
}

// 捕获回调的同步抛错，使坏路径在测试中报红，同时保留其真实 fs.readFile 路径。
function request(server, url) {
  return new Promise((resolve, reject) => {
    let status = 200, headers = {};
    const res = {
      writeHead(code, fields = {}) { status = code; headers = fields; return this; },
      end(body = '') {
        resolve({ status, headers, body: Buffer.isBuffer(body) ? body.toString('utf8') : String(body) });
      },
    };
    try {
      assert.ok(server.emit('request', { url, method: 'GET' }, res));
    } catch (error) {
      reject(error);
    }
  });
}

const dev = await loadServe(undefined, undefined, 'default');
const lan = await loadServe('0.0.0.0', '18445', 'lan');
// Windows 的工作区和 TEMP 可能分属不同盘，path.relative 会退成绝对路径；显式建一个真相对 root。
const originalCwd = process.cwd();
let relativeServer;
try {
  process.chdir(TEMP);
  relativeServer = makeStaticServer('./root');
} finally {
  process.chdir(originalCwd);
}
const servers = [
  ['harness / absolute root', makeStaticServer(ROOT)],
  ['harness / relative root', relativeServer],
  ['harness / trailing separator', makeStaticServer(ROOT + path.sep)],
  ['serve / development entry', dev.server],
];

for (const [name, server] of servers) {
  test(name, async t => {
    await t.test('根路径与查询串仍返回首页', async () => {
      for (const url of ['/', '/?payload=%&path=/../root-extra/sentinel.txt']) {
        const res = await request(server, url);
        assert.equal(res.status, 200);
        assert.equal(res.body, files['index.html']);
        assert.ok(res.headers['Content-Type'].startsWith('text/html'));
      }
    });
    await t.test('合法编码文件名与查询串按路径读取', async () => {
      const res = await request(server, '/encoded%20name.json?ignored=%00');
      assert.equal(res.status, 200);
      assert.equal(res.body, files['encoded name.json']);
    });
    await t.test('正常文件保留 MIME 与未知扩展名兜底', async () => {
      const cases = {
        '/code.JS?version=1': 'text/javascript',
        '/module.mjs': 'text/javascript',
        '/data.json': 'application/json',
        '/assets/model.glb': 'model/gltf-binary',
        '/sound.mp3': 'audio/mpeg',
        '/image.png': 'image/png',
        '/icons/icon.svg': 'image/svg+xml',
        '/app.webmanifest': 'application/manifest+json',
        '/unknown.bin': 'application/octet-stream',
      };
      for (const [url, mime] of Object.entries(cases)) {
        const res = await request(server, url);
        assert.equal(res.status, 200, url);
        assert.equal(res.headers['Content-Type'], mime, url);
      }
    });
    await t.test('不存在的文件返回 404', async () => {
      assert.equal((await request(server, '/missing.txt?version=1')).status, 404);
    });
    for (const url of ['/%', '/%GG', '/%E0%A4%A', '/%00', '/assets/%00model.glb']) {
      await t.test('坏路径返回 400 且后续请求正常：' + url, async () => {
        assert.equal((await request(server, url)).status, 400);
        assert.equal((await request(server, '/index.html')).status, 200);
      });
    }
    const outsidePaths = [
      '/../root-extra/sentinel.txt',
      '/%2e%2e%2froot-extra%2fsentinel.txt',
      '/%2e%2e%5croot-extra%5csentinel.txt',
      String.raw`/..\root-extra\sentinel.txt`,
      '/../outside/sentinel.txt',
    ];
    for (const url of outsidePaths) {
      await t.test('目录边界返回 403：' + url, async () => {
        const res = await request(server, url);
        assert.equal(res.status, 403);
        assert.notEqual(res.body, 'outside-root fixture');
      });
    }
  });
}

test('harness 保留调用方 MIME 覆盖', async () => {
  const server = makeStaticServer(ROOT, { '.json': 'application/x-garden-json' });
  const res = await request(server, '/data.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/x-garden-json');
});

test('serve 保留资产七天强缓存与代码 no-cache', async () => {
  for (const url of ['/assets/model.glb', '/docs/readme.txt', '/icons/icon.svg']) {
    const res = await request(dev.server, url);
    assert.equal(res.status, 200);
    assert.equal(res.headers['Cache-Control'], 'public, max-age=604800, immutable', url);
  }
  for (const url of ['/', '/code.JS', '/module.mjs', '/unknown.bin']) {
    const res = await request(dev.server, url);
    assert.equal(res.status, 200);
    assert.equal(res.headers['Cache-Control'], 'no-cache', url);
  }
});

test('serve 保留默认本机 HOST、端口与显式 LAN 配置', () => {
  assert.equal(dev.listenArgs[0], 8935);
  assert.equal(dev.listenArgs[1], '127.0.0.1');
  assert.equal(lan.listenArgs[0], 18445);
  assert.equal(lan.listenArgs[1], '0.0.0.0');
});
