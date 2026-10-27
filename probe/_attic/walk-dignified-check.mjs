import { launchChromium, listenEphemeral } from './_harness.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p); fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end('not found');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'}); res.end(d);})});
const port=await listenEphemeral(server);
import { chromium } from 'playwright';
const browser=await chromium.launch({args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
page.on('pageerror',e=>console.log('pageerror',e));
await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=low`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__garden && document.getElementById('loading')?.classList.contains('done'),null,{timeout:120000});
await page.evaluate(async()=>{ await window.__garden.bootDonePromise; });
await page.evaluate(async()=>{
  const g=window.__garden;
  g.setEnv('season','summer');
  const el=document.getElementById('hourSlider'); el.value='12.5'; el.dispatchEvent(new Event('input',{bubbles:true})); g.ENV.t=0.994;
  await new Promise(r=>setTimeout(r,800));
  g.setEnv('weather','clear');
});
await page.waitForFunction(()=>window.__garden.ENV.t>=1,null,{timeout:60000});
await page.waitForTimeout(2000);
// ensure actors loaded
await page.waitForFunction(()=>window.__garden.actorState && window.__garden.actorState().n>=7,null,{timeout:60000});
console.log('actorState',await page.evaluate(()=>window.__garden.actorState()));

// fast-forward scholar walk: set walkOff false and step
await page.evaluate(async()=>{
  const g=window.__garden;
  // force scholar to walk along its route
  g.actorWalk('scholar',true);
  g.actorWalk('guest',true);
  // also ensure guest visible (normally hidden until visit)
  // make guest visible via actorWalk? guest hideUntilVisit - need to show it
  // use actorRef to set visible
  for(let i=0;i<60;i++){ g.actorStep(0.1); }
});
await page.waitForTimeout(500);
// set camera to see scholar near bridge area
await page.evaluate(()=>{
  const g=window.__garden;
  const cam=g.camera, ctrl=g.controls;
  // scholar should be somewhere along HOST_GREET_PTS, around 8, -3 ?
  const scholar=g.actorState().actors.find(a=>a.id==='scholar');
  console.log('scholar pos',scholar);
  const x=scholar.pos[0], y=scholar.pos[1], z=scholar.pos[2];
  cam.position.set(x+4, 3.5, z+6);
  ctrl.target.set(x, 1.0, z);
  cam.updateMatrixWorld(true); ctrl.update();
});
await page.waitForTimeout(800);
await page.screenshot({path:'outputs/_diag/walk-dignified/scholar-walk.png', fullPage:false});
console.log('shot scholar done');
// also capture guest if visible
await page.evaluate(()=>{
  const g=window.__garden;
  const guest=g.actorState().actors.find(a=>a.id==='guest');
  console.log('guest pos',guest);
  if(guest){
    const cam=g.camera, ctrl=g.controls;
    const x=guest.pos[0], z=guest.pos[2];
    cam.position.set(x+4, 3.5, z+6);
    ctrl.target.set(x,1.0,z);
    cam.updateMatrixWorld(true); ctrl.update();
  }
});
await page.waitForTimeout(500);
await page.screenshot({path:'outputs/_diag/walk-dignified/guest-walk.png', fullPage:false});
console.log('shot guest done');
// capture both together in tour phase simulation
await page.evaluate(async()=>{
  const g=window.__garden;
  // fast-forward visit to pair phase
  // set time to trigger visit: need stableTravel ready, weather clear day
  // visit phase idle->gwalk->stow->walk etc, we can force by advancing time 40s
  for(let i=0;i<400;i++) g.actorStep(0.1);
  console.log('visit',g.actorVisit());
});
await page.waitForTimeout(500);
await page.evaluate(()=>{
  const g=window.__garden;
  const vs=g.actorVisit();
  const host=vs.host, guest=vs.guest;
  console.log('after fast host',host,'guest',guest,'phase',vs.phase);
  // center camera between them if both visible
  if(host && guest && host.visible && guest.visible){
    const mx=(host.pos[0]+guest.pos[0])/2, mz=(host.pos[2]+guest.pos[2])/2;
    const cam=g.camera, ctrl=g.controls;
    cam.position.set(mx+6, 4.0, mz+8);
    ctrl.target.set(mx,1.0,mz);
    cam.updateMatrixWorld(true); ctrl.update();
  }
});
await page.waitForTimeout(500);
await page.screenshot({path:'outputs/_diag/walk-dignified/pair-walk.png', fullPage:false});

await browser.close(); server.close();
console.log('done');
