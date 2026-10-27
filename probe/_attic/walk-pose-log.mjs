import { launchChromium, listenEphemeral } from './_harness.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; const file=path.join(ROOT,p); fs.readFile(file,(e,d)=>{ if(e){res.writeHead(404);res.end('not found');return;} const ext=path.extname(file).toLowerCase(); res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'}); res.end(d); });});
const port=await listenEphemeral(server);
const { chromium } = await import('playwright');
const browser = await chromium.launch({args:['--no-sandbox']});
const page = await browser.newPage();
page.on('pageerror', e=>console.log('pageerror',e));
page.on('console', m=>console.log('console',m.text()));
await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=low`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__garden && document.getElementById('loading')?.classList.contains('done'),null,{timeout:120000});
await page.evaluate(async()=>{ await window.__garden.bootDonePromise; });
await page.waitForTimeout(1500);
await page.waitForFunction(()=>window.__garden.actorState && window.__garden.actorState().n>=7,null,{timeout:60000});
console.log('actors', await page.evaluate(()=>window.__garden.actorState()));

// test dignified pose: force scholar to walk and read hand positions
let info = await page.evaluate(async()=>{
  const g=window.__garden;
  // set day clear to ensure visit can happen but we just manually walk scholar
  g.setEnv('season','summer');
  const el=document.getElementById('hourSlider'); el.value='12.5'; el.dispatchEvent(new Event('input',{bubbles:true})); g.ENV.t=0.994;
  await new Promise(r=>setTimeout(r,500));
  g.setEnv('weather','clear');
  await new Promise(r=>g._raf?requestAnimationFrame(r):setTimeout(r,100));
  // force scholar walk
  g.actorWalk('scholar',true);
  g.actorWalk('guest',true);
  // make guest visible
  const guestState = g.actorState().actors.find(a=>a.id==='guest');
  // guest hideUntilVisit holder visible false initially - force visible
  const guestObj = g.scene.getObjectByName('actor_guest');
  if(guestObj) guestObj.visible=true;
  for(let i=0;i<30;i++) g.actorStep(0.1);
  // get hand world positions via bones
  function handPos(id, boneName){
    const rig=g.actorRig(id);
    if(!rig) return null;
    const bone=rig.bones[boneName];
    if(!bone) return null;
    const v=new g.THREE.Vector3(); bone.getWorldPosition(v);
    return v.toArray().map(n=>+n.toFixed(3));
  }
  function holderPos(id){
    const rig=g.actorRig(id);
    if(!rig) return null;
    const v=new g.THREE.Vector3(); rig.holder.getWorldPosition(v);
    return v.toArray().map(n=>+n.toFixed(3));
  }
  const out=[];
  for(const id of ['scholar','guest']){
    const rig=g.actorRig(id);
    const bones=rig?Object.keys(rig.bones).slice(0,5):[];
    out.push({id, holder:holderPos(id),
      LeftUpperArm: handPos(id,'LeftUpperArm'),
      RightUpperArm: handPos(id,'RightUpperArm'),
      LeftHand: handPos(id,'LeftHand'),
      RightHand: handPos(id,'RightHand'),
      LeftLowerArm: handPos(id,'LeftLowerArm'),
      vis: rig?rig.holder.visible:false,
      state:g.actorState().actors.find(a=>a.id===id)
    });
  }
  return out;
});
console.log(JSON.stringify(info,null,2));
await browser.close(); server.close();
