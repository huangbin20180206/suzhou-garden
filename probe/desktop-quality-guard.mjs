// 电脑画质系统专项门禁：node probe/desktop-quality-guard.mjs
// 守三档配置、4K 预算、GTAO 半尺寸、QOS 平滑档与用户锁定。只跑本功能，不跑全量链。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.glb':'model/gltf-binary' };
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
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.setDefaultTimeout(180000);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});

  const load=async tier=>{
    await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=${tier}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__garden&&document.getElementById('loading').classList.contains('done'));
    await page.evaluate(async()=>{await window.__garden.bootDonePromise;});
    return page.evaluate(async()=>{
      const g=window.__garden,q=g.qualityState();
      const w=g.scene.getObjectByName('waterSurface');
      /* 低档按**行为**判定，而不是“有没有分配纹理”：Reflector 构造时必然建 RT，
         该断言的是它不再重渲、且着色器把反射权重压到 0。 */
      const before=w?.userData?.reflectCount||0;
      for(let i=0;i<6;i++) await new Promise(r=>requestAnimationFrame(r));
      return {...q, gtao:!!g.composer.passes.find(p=>p.userData&&'aoScale' in p.userData),
        gtaoScale:g.composer.passes.find(p=>p.userData&&'aoScale' in p.userData)?.userData.aoScale,
        reflMix:+(w?.material?.uniforms?.uReflMix?.value??-1).toFixed(2),
        reflectCalls:(w?.userData?.reflectCount||0)-before,
        reflection:Math.round(w?.getRenderTarget?Math.max(w.getRenderTarget().width,w.getRenderTarget().height):0)};
    });
  };

  const low=await load('low');
  check('low：AO 关、阴影 2048、反射停用', !low.ao&&low.shadow===2048&&low.reflMix===0&&low.reflectCalls===0,JSON.stringify(low));
  const mid=await load('mid');
  check('mid：AO 开、阴影 4096、反射中档', mid.ao&&mid.shadow===4096&&mid.reflMix>0&&mid.reflection===768,JSON.stringify(mid));
  const high=await load('high');
  check('high：AO 开、阴影 6144、反射 1024', high.ao&&high.shadow===6144&&high.reflection===1024,JSON.stringify(high));
  check('high 档开放 4K 像素预算', high.pixelBudget>=3840*2160,`budget=${high.pixelBudget}`);
  check('mid/high 的 GTAO 始终半尺寸', !low.gtao&&mid.gtao&&high.gtao&&mid.gtaoScale===0.5&&high.gtaoScale===0.5,
    `low=${low.gtao} mid=${mid.gtaoScale} high=${high.gtaoScale}`);

  // 用户锁定：性能模式把 QOS 锁在最低档，连喂低 fps 不再变化；高画质锁 L0。
  const lock=await page.evaluate(async()=>{
    const g=window.__garden;
    g.setQualityMode('performance');
    const p=g.qualityState();
    for(let i=0;i<20;i++) g.qosSample(10);
    const perf=g.qualityState();
    g.setQualityMode('high');
    const h=g.qualityState();
    for(let i=0;i<20;i++) g.qosSample(10);
    return {p,perf,h,after:g.qualityState()};
  });
  check('性能模式锁定最低 QOS 档', lock.p.mode==='performance'&&lock.p.locked&&lock.perf.level===lock.p.level,JSON.stringify(lock.perf));
  check('高画质模式锁定 L0', lock.h.mode==='high'&&lock.h.locked&&lock.h.level===0&&lock.after.level===0,JSON.stringify(lock.after));

  await page.click('#env .drawer-toggle');
  const ui=await page.evaluate(()=>[...document.querySelectorAll('[data-quality]')].map(b=>({mode:b.dataset.quality,pressed:b.getAttribute('aria-pressed'),on:b.classList.contains('on')})));
  check('画质按钮具备完整无障碍状态', ui.length===4&&ui.every(b=>b.pressed==='true'||b.pressed==='false'),JSON.stringify(ui));
  check('当前高画质按钮选中', ui.find(b=>b.mode==='high')?.pressed==='true',JSON.stringify(ui));

  /* 用模拟 GPU 名测试“保存性能模式后重新打开”，不能用 ?tier=mid：强制档会跳过本地偏好。 */
  await page.addInitScript(() => {
    localStorage.setItem('garden.quality.v1', 'performance');
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]){
      if (!C) continue;
      const original = C.prototype.getParameter;
      C.prototype.getParameter = function(p){ return p === 0x9246 ? 'Test Garden GPU' : original.call(this, p); };
    }
  });
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__garden&&document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async()=>{await window.__garden.bootDonePromise;});
  const restored = await page.evaluate(()=>window.__garden.qualityState());
  check('模拟均衡档设备重新打开后，保存的性能模式仍关闭 AO',
    restored.tier === 'mid' && restored.mode === 'performance' && !restored.ao, JSON.stringify(restored));

  /* 2026-11-02（老黄报障："左键拖动视角出现黑框/黑屏闪烁，位置和大小无规律"）的防回归。
     ⚠️ 这条缺陷在本门里**动态复现不出来**：QOS_IMMUNE = SOFTWARE_GL || PROBE_DRIVEN，
        探针里自适应改档根本不跑，setSize 也永远不会在渲染之后发生。所以只能读源码钉两条不变量：
          ① 自适应降档只许"记账"（queue），真正的重建由帧首的 flush() 落地；
          ② 帧函数里 QOS.flush() 必须排在 composer.render() 之前。
        反例形状（旧写法）：sample() 直接 apply() ⇒ setSize 落在"本帧已渲染、浏览器还没合成"
        之间，alpha 恒 true 的绘图缓冲换成空白 ⇒ 合成出一块纯色，就是用户看到的黑框。 */
  {
    const src = fs.readFileSync(path.join(ROOT, 'src/11-loop.js'), 'utf8');
    const queued = src.includes('queue(st.level + 1)') && src.includes('queue(st.level - 1)');
    const notApplied = !/apply\(st\.level\s*[+-]\s*1\)/.test(src);
    const iFlush = src.indexOf('QOS.flush();');
    const iRender = src.indexOf('composer.render();', iFlush);
    const ordered = iFlush > 0 && iRender > iFlush
      && src.slice(iFlush, iRender).includes('AA.tick();');
    check('自适应改档只记账（queue），由帧首 flush() 在 composer.render() 之前落地',
      queued && notApplied && ordered,
      `queue=${queued} 未直接apply=${notApplied} flush在render之前=${ordered}`);
  }

  check('零 pageerror / console error',errs.length===0,errs.slice(0,2).join(' | '));
  await browser.close(); server.close();
  const fails=results.filter(r=>!r.ok).length;
  console.log(`\n[desktop-quality-guard] ${fails?fails+' FAILED':'ALL PASS'}（${results.length} 项）`);
  process.exit(fails?1:0);
})().catch(e=>{console.error('[desktop-quality-guard] 探针异常：',e);process.exit(2);});
