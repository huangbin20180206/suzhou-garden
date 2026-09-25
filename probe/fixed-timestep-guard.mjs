// 固定步长仿真专项门禁：node probe/fixed-timestep-guard.mjs
// 守“低帧率下仿真速度不膨胀”：帧率掉到 20fps 时，风钟/环境过渡/锦鲤仍按真实秒推进。
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

  // 持续低帧率：每帧 100ms（10fps）连跑 30 帧 ⇒ 真实经过 3s，仿真应推进约 3s。
  // ⚠️ 判据必须按**持续**低帧率写，不能拿“单帧 1 秒”当速度证据 ——
  //    单帧巨跳本来就该被补步上限削掉（那是防雪崩，不是速度问题）。
  const slow=await page.evaluate(()=>{
    const g=window.__garden, t0=g.simClock(), w0=g.windClockNow();
    for(let i=0;i<30;i++) g.stepSim(0.10);          // 30 帧 × 100ms = 真实 3 秒
    return { sim:+((g.simClock()-t0)).toFixed(3), wind:+((g.windClockNow()-w0)).toFixed(3),
             steps:g.simState().steps, maxSteps:g.simState().maxSteps };
  });
  check('持续 10fps 时仿真按真实秒推进（约 3 秒）', Math.abs(slow.sim-3.0)<0.15, JSON.stringify(slow));
  check('风钟与仿真时钟同步推进', Math.abs(slow.wind-slow.sim)<1e-6, JSON.stringify(slow));
  check('低帧率下走的是多步补进而非单步（步数上限内）', slow.steps<=slow.maxSteps, JSON.stringify(slow));

  // 极端卡顿（1s 一帧）应有上限，避免一帧补满 1s 把相位与鱼群推穿。
  const capped=await page.evaluate(()=>{
    const g=window.__garden, t0=g.simClock();
    g.stepSim(1.0);
    return { advanced:+((g.simClock()-t0)).toFixed(4), maxSteps:g.simState().maxSteps };
  });
  check('极端卡顿有补步上限（1s 帧不会补满 1s）',
        capped.advanced>0.05&&capped.advanced<capped.maxSteps/60+1e-6, `补步=${capped.advanced}s 上限${capped.maxSteps}步`);

  // 环境过渡与鱼速：低帧率下过渡仍按时长收敛。
  const env=await page.evaluate(async()=>{
    const g=window.__garden;
    g.setEnv('time','night');
    const t0=performance.now();
    let guard=0;
    while(g.ENV.t<1 && guard++<600) await new Promise(r=>requestAnimationFrame(r));
    return { converged:g.ENV.t>=1, frames:guard, ms:Math.round(performance.now()-t0) };
  });
  check('环境过渡仍能收敛', env.converged, JSON.stringify(env));

  check('零 pageerror / console error', errs.length===0, errs.slice(0,2).join(' | '));
  await browser.close(); server.close();
  const fails=results.filter(r=>!r.ok).length;
  console.log(`\n[fixed-timestep-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails?1:0);
})().catch(e=>{console.error('[fixed-timestep-guard] 探针异常：',e);process.exit(2);});
