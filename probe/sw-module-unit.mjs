// @guards: sw.js, tools/gen-module-manifest.mjs
// Service Worker 安装语义的纯 Node VM 单测：不启动浏览器、不触碰真实 CacheStorage。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const swSource = fs.readFileSync(new URL('sw.js', root), 'utf8');

class FixtureRequest{constructor(input,init={}){this.url=input instanceof FixtureRequest?input.url:new URL(typeof input==='string'?input:input.url,'https://garden.test/').href;this.cache=init.cache||input.cache||'default';this.method=init.method||input.method||'GET';this.mode=init.mode||input.mode||'cors';}}
class FixtureResponse{constructor(body,status=200){this.body=body;this.status=status;this.ok=status>=200&&status<300;}clone(){return new FixtureResponse(this.body,this.status);}static error(){return new FixtureResponse('',0);}}
function cacheMatch(map,request){const wanted=new URL(typeof request==='string'?request:request.url,'https://garden.test/').href;for(const [key,value] of map){const found=new URL(typeof key==='string'?key:key.url,'https://garden.test/').href;if(found===wanted)return value;}return undefined;}

function runtime({ failAt = null, online = true } = {}){
  const handlers = new Map();
  const buckets = new Map([
    ['suzhou-garden-v46', new Map([['./src/11-loop.js', 'old-module']])],
    ['suzhou-garden-assets-v22', new Map([['./assets/koi.glb', new FixtureResponse('old-koi')]])],
  ]);
  const addCalls = [], deleted = [], fetchCalls = [];
  let skipWaiting = 0, onlineState = online;
  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const bucket = buckets.get(name);
      return {
        async addAll(urls) {
          addCalls.push({ name, urls: [...urls] });
          for (const url of urls) {
            bucket.set(url, 'new-module');
            if (url === failAt) throw new Error('fixture fetch failed: ' + url);
          }
        },
        async match(url) { return cacheMatch(bucket,url); },
        async put(url, value) { bucket.set(url, value); },
      };
    },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { deleted.push(name); return buckets.delete(name); },
    async match(url) { for(const bucket of buckets.values()){const hit=cacheMatch(bucket,url);if(hit!==undefined)return hit;}return undefined; },
  };
  const self = {
    registration: { scope:'https://garden.test/' },
    clients: { claim: async () => {} },
    addEventListener(type, fn) { handlers.set(type, fn); },
    skipWaiting() { skipWaiting++; },
  };
  vm.runInNewContext(swSource, {
    self, caches, location:{ origin:'https://garden.test' },
    URL, Request:FixtureRequest, Response:FixtureResponse,
    fetch:async request=>{fetchCalls.push(request);if(!onlineState)throw new Error('offline fixture');return new FixtureResponse(request.cache==='reload'?'fresh-network':'stale-http');},console,
  }, { filename:'sw.js' });
  return { handlers, buckets, addCalls, deleted, fetchCalls, setOnline(value){onlineState=value;}, get skipWaiting(){ return skipWaiting; } };
}

async function runInstall(r) {
  let promise;
  r.handlers.get('install')({ waitUntil(p) { promise = Promise.resolve(p); } });
  assert.ok(promise, 'install handler must call waitUntil');
  return promise;
}

async function runActivate(r){let promise;r.handlers.get('activate')({waitUntil(p){promise=Promise.resolve(p);}});assert.ok(promise,'activate must call waitUntil');return promise;}
async function runFetch(r,request){let promise;r.handlers.get('fetch')({request,respondWith(p){promise=Promise.resolve(p);}});assert.ok(promise,'fetch must call respondWith');return promise;}
async function runAssetBackfill(r){let promise;r.handlers.get('message')({data:{type:'precache-assets'},waitUntil(p){promise=Promise.resolve(p);}});assert.ok(promise,'asset message must call waitUntil');return promise;}
test('生成的 MODULES 与 src 磁盘清单一致且包含新增 02a 模块', async () => {
  const gen = await import('../tools/gen-module-manifest.mjs');
  const files = gen.moduleFiles();
  const disk = fs.readdirSync(new URL('src/', root)).filter(name => name.endsWith('.js')).sort((a, b) => a.localeCompare(b));
  assert.ok(files.length > 0, 'src 模块清单不得为空');
  assert.deepEqual(files, disk, '生成器必须枚举实际 src/*.js 文件');
  assert.ok(files.includes('02a-env-cache.js'));
  assert.equal(new Set(files).size, files.length, 'MODULES 不得重复');
  const actual = gen.extractBlock(swSource, gen.MODULE_BEGIN, gen.MODULE_END);
  assert.equal(actual, gen.genModuleBlock(files), 'sw.js MODULES 生成段必须与磁盘一致');
});

test('新桶完整安装后才 skipWaiting，SHELL 与 MODULES 去重', async () => {
  const r = runtime();
  await runInstall(r);
  assert.equal(r.skipWaiting, 1);
  assert.equal(r.addCalls.length, 1);
  const cacheName = (swSource.match(/const CACHE = '([^']+)'/) || [])[1];
  const assetName = (swSource.match(/const ASSET_CACHE = '([^']+)'/) || [])[1];
  assert.ok(cacheName && cacheName !== 'suzhou-garden-v46', '本轮必须创建不同于旧桶的应用缓存');
  assert.match(cacheName, /^suzhou-garden-v\d+$/);
  assert.match(assetName || '', /^suzhou-garden-assets-v\d+$/);
  assert.notEqual(cacheName, assetName, '应用桶与资产桶必须独立');
  assert.equal(r.addCalls[0].name, cacheName);
  const urls = r.addCalls[0].urls;
  assert.equal(new Set(urls).size, urls.length, '安装清单不得重复');
  assert.equal(urls.filter(url => url === './src/main.js').length, 1, 'main.js 同时在壳/模块清单时只能安装一次');
  const gen = await import('../tools/gen-module-manifest.mjs');
  for (const file of gen.moduleFiles()) assert.ok(urls.includes('./src/' + file));
});

test('新桶安装失败不得 skipWaiting，旧 v46 可用桶保持不变', async () => {
  const failAt = './src/11-loop.js';
  const r = runtime({ failAt });
  await assert.rejects(runInstall(r), /fixture fetch failed/);
  assert.equal(r.skipWaiting, 0, 'addAll 失败时不得接管旧页面');
  assert.equal(r.buckets.get('suzhou-garden-v46').get(failAt), 'old-module');
  assert.equal(r.deleted.includes('suzhou-garden-v46'), false, '安装失败阶段不得清理旧桶');
  const cacheName = (swSource.match(/const CACHE = '([^']+)'/) || [])[1];
  assert.ok(r.buckets.get(cacheName).size > 0, '负例应模拟新桶可能留下部分写入，但旧桶仍独立可用');
});
test('资产桶升级时先保留上一桶，离线仍可读取旧模型',async()=>{
  const r=runtime({online:false});await runInstall(r);await runActivate(r);
  assert.ok(r.buckets.has('suzhou-garden-assets-v22'),'激活新版本不能提前删除唯一完整资产桶');
  const response=await runFetch(r,new FixtureRequest('https://garden.test/assets/koi.glb'));assert.equal(response.body,'old-koi');
});

test('资产版本升级绕过 immutable HTTP 缓存，完整回填后再清理旧桶',async()=>{
  const r=runtime();await runInstall(r);await runActivate(r);
  const response=await runFetch(r,new FixtureRequest('https://garden.test/assets/koi.glb',{cache:'force-cache'}));
  assert.equal(response.body,'fresh-network','CacheStorage miss 时不得复用 HTTP 里的旧 immutable 字节');
  await runAssetBackfill(r);assert.ok(r.fetchCalls.length>1,'应为缺失预缓存资产执行回填');
  assert.ok(r.fetchCalls.every(request=>request.cache==='reload'),'页面 miss 与 SW 回填都须绕过 HTTP immutable 旧响应');
  const assetName=(swSource.match(/const ASSET_CACHE = '([^']+)'/)||[])[1];
  assert.equal(r.buckets.get(assetName).size,18,'完成回填后新资产桶应含全体 GLB');
  assert.equal(r.buckets.has('suzhou-garden-assets-v22'),false,'全部新资源到位后方可回收旧桶');
});

