// 抗锯齿渐进超采样专项门禁：node probe/aa-progressive-guard.mjs
// 守四件事：相机静止时倍率逐级上升、相机一动立刻回落、低档不上探、回落不脱离 QOS 档位。
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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const port=await listenEphemeral(server);
  const {chromium}=createRequire(import.meta.url)('playwright');
  const browser=await launchChromium(chromium);
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.setDefaultTimeout(120000);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__garden&&document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async()=>{await window.__garden.bootDonePromise;});
  // 关掉 intro 与 QOS 干扰：本门只量“静止是否升采样”
  await page.evaluate(()=>{ window.__garden.setQualityMode('high'); });

  const a0 = await page.evaluate(()=>window.__garden.aaState());
  check('起始为基础倍率（未升采样）', a0.step===0, JSON.stringify(a0));

  // 静止累积：等倍率上升
  const rose = await page.waitForFunction(
    ()=>window.__garden.aaState().step>=2, null, {timeout:8000, polling:100})
    .then(()=>true).catch(()=>false);
  const a1 = await page.evaluate(()=>window.__garden.aaState());
  check('相机静止时倍率逐级上升', rose && a1.step>=2, JSON.stringify(a1));
  check('倍率不超过上限', a1.scale<=a1.maxScale+1e-6, `scale=${a1.scale} max=${a1.maxScale}`);
  check('实际像素比与配置同步', Math.abs(a1.pixelRatio-a1.baseScale*a1.scale)<1e-6,
    `pr=${a1.pixelRatio} base=${a1.baseScale} scale=${a1.scale}`);

  // 相机一动：立刻回落
  await page.evaluate(()=>{ const g=window.__garden; g.camera.position.x += 3; g.controls.update(); });
  await page.waitForFunction(()=>window.__garden.aaState().step===0, null, {timeout:3000, polling:50})
    .then(()=>true).catch(()=>false);
  const a2 = await page.evaluate(()=>window.__garden.aaState());
  check('相机一动立即回落（无拖影等待）', a2.step===0, JSON.stringify(a2));

  // 低档不上探：性能档不参与渐进升采样
  await page.evaluate(()=>{ window.__garden.setQualityMode('performance'); });
  const roseLow = await page.waitForFunction(
    ()=>window.__garden.aaState().step>=2, null, {timeout:3000, polling:100})
    .then(()=>true).catch(()=>false);
  const a3 = await page.evaluate(()=>window.__garden.aaState());
  check('性能档不参与渐进升采样', !roseLow && a3.step===0, JSON.stringify(a3));

  // 与 QOS 联动：QOS 降档后渐进升采样应被压制
  await page.evaluate(()=>{ window.__garden.setQualityMode('high'); });
  await page.waitForFunction(()=>window.__garden.aaState().step>=1, null, {timeout:8000, polling:100}).catch(()=>false);
  await page.evaluate(()=>{ window.__garden.setQos(window.__garden.qualityState().maxLevel); });
  await page.evaluate(()=>{ const g=window.__garden; g.camera.position.x += 3; g.controls.update(); });
  await sleep(600);
  const a4 = await page.evaluate(()=>({ aa:window.__garden.aaState(), q:window.__garden.qualityState() }));
  check('QOS 已降档时不再升采样', a4.aa.step===0, `qos L${a4.q.level} aa=${JSON.stringify(a4.aa)}`);

  check('零 pageerror / console error', errs.length===0, errs.slice(0,2).join(' | '));
  await browser.close(); server.close();
  const fails=results.filter(r=>!r.ok).length;
  console.log(`\n[aa-progressive-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails?1:0);
})().catch(e=>{console.error('[aa-progressive-guard] 探针异常：',e);process.exit(2);});
