// PMREM 四时段缓存专项门禁：node probe/pmrem-env-guard.mjs
// 守"切时段时反射色变了但只烘一次；切回旧时段零重烘；切季节/天气不触发烘焙"。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.glb':'model/gltf-binary' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT,p),(err,data)=>{
    if(err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(data);
  });
});
const results=[];
const check=(name,ok,detail='')=>{results.push({name,ok});console.log(`  ${ok?'✓':'✗'} ${name}${detail?' — '+detail:''}`);};

(async()=>{
  const port=await listenEphemeral(server);
  const {chromium}=createRequire(import.meta.url)('playwright');
  const browser=await launchChromium(chromium);
  const page=await browser.newPage({viewport:{width:900,height:600}});
  page.setDefaultTimeout(120000);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__garden&&document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async()=>{await window.__garden.bootDonePromise;});

  const baked = await page.evaluate(()=>window.__garden.envBakeState());
  check('启动时烘焙 1 张（default 键，noon 参数）', baked.builds===1 && baked.cached.length===1, JSON.stringify(baked));

  /* 启动时 ENV.time=noon；setEnv('time','noon') 会因 early-return 不触发烘焙。
     这是正确行为：同一时段切回自己不需要换贴图。
     所以第一张烘的 default 键就已经覆盖了 noon；后续 night/dusk 才会真正烘焙新键。 */
  await page.evaluate(()=>{ window.__garden.setEnv('time','night'); });
  const s2 = await page.evaluate(()=>window.__garden.envBakeState());
  const envNight = await page.evaluate(()=>window.__garden.scene.environment?.uuid);
  check('切夜时烘焙第 2 张（缓存键 night）', s2.builds===2 && s2.cached.includes('night'), JSON.stringify(s2));

  await page.evaluate(()=>{ window.__garden.setEnv('time','dusk'); });
  const s3 = await page.evaluate(()=>window.__garden.envBakeState());
  check('切暮时烘焙第 3 张（缓存键 dusk）', s3.builds===3 && s3.cached.includes('dusk'), JSON.stringify(s3));

  // 切回已缓存的夜时段：不应新增烘焙
  await page.evaluate(()=>{ window.__garden.setEnv('time','night'); });
  const s4 = await page.evaluate(()=>window.__garden.envBakeState());
  check('切回夜时段（已缓存）不增加烘焙', s4.builds===3, JSON.stringify(s4));

  // 切回 noon（无专属键但 default 键参数相同）：烘焙 1 次新键（首次），之后再切不新增
  await page.evaluate(()=>{ window.__garden.setEnv('time','noon'); });
  const s5 = await page.evaluate(()=>window.__garden.envBakeState());
  check('切回午时段（首次用 noon 键烘，default 参数相同但新键）', s5.builds===4, JSON.stringify(s5));

  await page.evaluate(()=>{ window.__garden.setEnv('time','noon'); });
  const s6 = await page.evaluate(()=>window.__garden.envBakeState());
  check('再切午时段（已缓存）不增加烘焙', s6.builds===4, JSON.stringify(s6));

  // 切季节/天气不触发烘焙
  await page.evaluate(()=>{ window.__garden.setEnv('season','spring'); window.__garden.setEnv('weather','storm'); });
  const s7 = await page.evaluate(()=>window.__garden.envBakeState());
  check('切季节/天气不触发烘焙（稳态零重烘）', s7.builds===4, JSON.stringify(s7));

  check('零 pageerror / console error', errs.length===0, errs.slice(0,2).join(' | '));
  await browser.close(); server.close();
  const fails=results.filter(r=>!r.ok).length;
  console.log(`\n[pmrem-env-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails?1:0);
})().catch(e=>{console.error('[pmrem-env-guard] 探针异常：',e);process.exit(2);});
