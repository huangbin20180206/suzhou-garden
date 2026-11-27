// PMREM 四时段缓存专项门禁：node probe/pmrem-env-guard.mjs
// @guards: src/12-env.js, src/02-scene.js, src/02a-env-cache.js, src/01-materials.js
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
// 采样真实 PMREM atlas 像素；只看 renderer.info/循环存活会把空纹理误判成恢复成功。
function sampleEnvironment(){
  const g=window.__garden, T=g.THREE, renderer=g.renderer;
  const target=new T.WebGLRenderTarget(32,32), scene=new T.Scene();
  const geometry=new T.PlaneGeometry(2,2);
  const material=new T.MeshBasicMaterial({map:g.scene.environment,depthTest:false,depthWrite:false,toneMapped:false});
  scene.add(new T.Mesh(geometry,material));
  const camera=new T.OrthographicCamera(-1,1,1,-1,0,1), pixels=new Uint8Array(32*32*4);
  const old=renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target); renderer.render(scene,camera);
    renderer.readRenderTargetPixels(target,0,0,32,32,pixels);
  } finally {
    renderer.setRenderTarget(old); target.dispose(); geometry.dispose(); material.dispose();
  }
  let sum=0;
  for(let i=0;i<pixels.length;i+=4) sum+=pixels[i]+pixels[i+1]+pixels[i+2];
  return {mean:sum/(32*32*3),uuid:g.scene.environment.uuid,bake:g.envBakeState()};
}

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

  await page.evaluate(() => {
    window.__pmremContext={lost:0,restored:0};
    const canvas=window.__garden.renderer.domElement;
    canvas.addEventListener('webglcontextlost',()=>window.__pmremContext.lost++);
    canvas.addEventListener('webglcontextrestored',()=>window.__pmremContext.restored++);
  });
  let before=await page.evaluate(sampleEnvironment);
  check('恢复前环境贴图确实含有效像素',before.mean>1,JSON.stringify(before));
  for(let cycle=1;cycle<=3;cycle++){
    await page.evaluate(()=>window.__garden.renderer.forceContextLoss());
    await page.waitForFunction(n=>window.__pmremContext.lost===n,cycle);
    await page.evaluate(()=>window.__garden.renderer.forceContextRestore());
    await page.waitForFunction(n=>window.__pmremContext.restored===n,cycle);
    const after=await page.evaluate(sampleEnvironment);
    check('恢复 '+cycle+'：环境纹理已重烘，像素保留',after.uuid!==before.uuid && after.mean>before.mean*0.5,JSON.stringify(after));
    check('恢复 '+cycle+'：只保留当前缓存且只新增一次烘焙',after.bake.cached.length===1 && after.bake.builds===before.bake.builds+1);
    before=after;
  }
  const lazy=await go('time','night');
  check('恢复后的其它时段按需重烘',lazy.builds===before.bake.builds+1);
  const again=await go('time','noon');
  check('恢复后切回当前已缓存时段不重烘',again.builds===lazy.builds);
  const loop=await page.evaluate(()=>window.__garden.loopErrors());
  check('多次上下文恢复后零循环错误',loop.count===0,JSON.stringify(loop));

  check('零 pageerror / console error', errs.length===0, errs.slice(0,2).join(' | '));
  await browser.close(); server.close();
  const fails=results.filter(r=>!r.ok).length;
  console.log(`\n[pmrem-env-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails?1:0);
})().catch(e=>{console.error('[pmrem-env-guard] 探针异常：',e);process.exit(2);});
