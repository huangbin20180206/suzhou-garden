// 水面菲涅尔专项门禁：node probe/fresnel-guard.mjs
// 守 Schlick 曲线的三个关键点：俯视低反射、平视升反射、掠射封顶；并验证两端画面仍在变。
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

/* 与产品 shader 同一份公式（01-materials 的水面 Fresnel 段），改那边必须同步这里。
   旧公式一并留着做对照：它在中角度就冲到上限，正是"水面泛白"的根因。 */
const schlick = (cosI, F0 = 0.02, max = 0.68) => Math.min(max, F0 + (1 - F0) * Math.pow(1 - cosI, 5));
const legacy  = (cosI, max = 0.68) => Math.min(max, 0.04 + Math.pow(1 - cosI, 2.6) * 1.02);

(async()=>{
  const port=await listenEphemeral(server);
  const {chromium}=createRequire(import.meta.url)('playwright');
  const browser=await launchChromium(chromium);
  const page=await browser.newPage({viewport:{width:900,height:600}});
  page.setDefaultTimeout(120000);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});

  const top = schlick(0.98), mid = schlick(0.45), graze = schlick(0.02);
  check('俯视（cos≈0.98）反射极低，看得清池底', top < 0.05, `F=${top.toFixed(4)}`);
  /* 63° 入射时水的真实反射率约 6~7% —— 判据按物理值给，不按"看起来该更亮"给。
     真正的回归信号是与旧公式的差距：旧公式同角度已到 60%，会把池面洗成一片灰白。 */
  check('平视（cos≈0.45）反射符合水在 63° 的量级', mid > 0.05 && mid < 0.10,
    `Schlick=${mid.toFixed(4)} 旧公式=${legacy(0.45).toFixed(3)}`);
  check('平视反射显著低于旧公式（修掉"中角度泛白"）', mid < legacy(0.45) * 0.3,
    `${mid.toFixed(3)} vs 旧 ${legacy(0.45).toFixed(3)}`);
  check('掠射（cos≈0.02）反射升高并被 0.68 封顶', graze > mid && graze <= 0.68, `F=${graze.toFixed(4)}`);
  check('曲线单调（角度越掠反射越强）', top < mid && mid < graze, `${top.toFixed(3)}<${mid.toFixed(3)}<${graze.toFixed(3)}`);

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__garden&&document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async()=>{await window.__garden.bootDonePromise;});

  // 画面验证：俯视机位与平视机位的水面亮度必须不同（反射确实随角度变化）。
  const shots = await page.evaluate(async()=>{
    const g=window.__garden;
    const luma=()=>{
      g.composer.render();
      const src=g.renderer.domElement;
      const c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
      const x=c.getContext('2d',{willReadFrequently:true}); x.drawImage(src,0,0);
      // 取画面下半部（水面区域）的中位亮度
      const d=x.getImageData(0,Math.floor(c.height*0.62),c.width,Math.floor(c.height*0.3)).data;
      const v=[]; for(let i=0;i<d.length;i+=16) v.push(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]);
      v.sort((a,b)=>a-b); return +v[v.length>>1].toFixed(2);
    };
    const save=()=>{ g.controls.target.set(0,3.5,-1); g.camera.position.set(0,42,20); g.camera.lookAt(0,3.5,-1); return luma(); };
    const grazing=()=>{ g.controls.target.set(0,0.2,3); g.camera.position.set(-24,1.1,3); g.camera.lookAt(0,0.2,3); return luma(); };
    return { top: save(), grazing: grazing() };
  });
  check('俯视与平视的水面亮度不同（菲涅尔生效）',
        Math.abs(shots.top - shots.grazing) > 1.5, JSON.stringify(shots));

  check('零 pageerror / console error', errs.length===0, errs.slice(0,2).join(' | '));
  await browser.close(); server.close();
  const fails=results.filter(r=>!r.ok).length;
  console.log(`\n[fresnel-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails?1:0);
})().catch(e=>{console.error('[fresnel-guard] 探针异常：',e);process.exit(2);});
