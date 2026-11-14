// PMREM 四时段缓存专项门禁：node probe/pmrem-env-guard.mjs
// @guards: src/12-env.js, src/02-scene.js, src/01-materials.js
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
  /* 2026-10-31：慢机（沙箱 SwiftShader 2 核首帧 ~125s、bootDone ~380s）用 GARDEN_BOOT_MS 放大；默认不变，判据不动。 */
  page.setDefaultTimeout(Math.max(120000, +process.env.GARDEN_BOOT_MS || 0));
  const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__garden&&document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async()=>{await window.__garden.bootDonePromise;});

  /* 2026-10-31 改口径（产品侧改了缓存键，见 src/12-env.js syncEnvMap 注释）：
     键 = 「时段|天气大类」（clear / clear+snow / overcast / snow），且**过渡落地那一帧**才烘焙/切换。
     所以每次 setEnv 之后要先等 ENV.t>=1 再读；开机那张直接用 noon|clear 键（02-scene bakeEnvFor），
     切回午时段因此是缓存命中（旧口径要多烘一张 noon 键）。判据意图不变：新键烘一次、旧键不重烘、季节不触发。 */
  await page.evaluate(()=>{ window.__garden.ENV.dur = 0.25; });
  const settle = ()=>page.waitForFunction(()=>window.__garden.ENV.t>=1, null, {polling:'raf'});
  const go = async (k,v)=>{ await page.evaluate(([k,v])=>window.__garden.setEnv(k,v),[k,v]); await settle();
                            return page.evaluate(()=>window.__garden.envBakeState()); };
  const baked = await page.evaluate(()=>window.__garden.envBakeState());
  check('启动时烘焙 1 张（noon|clear 键）', baked.builds===1 && baked.cached.length===1 && baked.cached[0]==='noon|clear', JSON.stringify(baked));

  const s2 = await go('time','night');
  check('切夜时烘焙第 2 张（缓存键 night|clear）', s2.builds===2 && s2.cached.includes('night|clear'), JSON.stringify(s2));
  const s3 = await go('time','dusk');
  check('切暮时烘焙第 3 张（缓存键 dusk|clear）', s3.builds===3 && s3.cached.includes('dusk|clear'), JSON.stringify(s3));
  const s4 = await go('time','night');
  check('切回夜时段（已缓存）不增加烘焙', s4.builds===3, JSON.stringify(s4));
  const s5 = await go('time','noon');
  check('切回午时段（开机那张即 noon|clear）不增加烘焙', s5.builds===3, JSON.stringify(s5));
  const s6 = await go('season','spring');
  check('切季节不触发烘焙', s6.builds===3, JSON.stringify(s6));
  const s7 = await go('weather','storm');
  check('切到阴雨大类：烘焙 1 张 noon|overcast', s7.builds===4 && s7.cached.includes('noon|overcast'), JSON.stringify(s7));
  const s8 = await go('weather','drizzle');
  check('同大类换天气（暴雨→细雨）不增加烘焙', s8.builds===4, JSON.stringify(s8));

  check('零 pageerror / console error', errs.length===0, errs.slice(0,2).join(' | '));
  await browser.close(); server.close();
  const fails=results.filter(r=>!r.ok).length;
  console.log(`\n[pmrem-env-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails?1:0);
})().catch(e=>{console.error('[pmrem-env-guard] 探针异常：',e);process.exit(2);});
