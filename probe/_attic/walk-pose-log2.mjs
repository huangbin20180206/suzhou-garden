import { launchChromium, listenEphemeral } from './_harness.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; const file=path.join(ROOT,p); fs.readFile(file,(e,d)=>{ if(e){res.writeHead(404);res.end('not found');return;} const ext=path.extname(file).toLowerCase(); res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'}); res.end(d); });});
const port=await listenEphemeral(server);
const { chromium } = await import('playwright');
const browser = await chromium.launch({args:['--no-sandbox']});
const page = await browser.newPage();
page.on('pageerror', e=>console.log('pageerror',e.message));
page.on('console', m=>console.log('page console',m.text()));
await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=low`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__garden && document.getElementById('loading')?.classList.contains('done'),null,{timeout:120000});
console.log('loading done');
await page.evaluate(async()=>{ await window.__garden.bootDonePromise; console.log('bootDone'); });
console.log('bootDone await ok');
await page.waitForTimeout(1000);
await page.waitForFunction(()=>window.__garden.actorState && window.__garden.actorState().n>=7,null,{timeout:60000});
console.log('actors ready', await page.evaluate(()=>window.__garden.actorState().n));
try{
  let info = await page.evaluate(async()=>{
    try{
      const g=window.__garden;
      g.setEnv('season','summer');
      const el=document.getElementById('hourSlider'); if(el){ el.value='12.5'; el.dispatchEvent(new Event('input',{bubbles:true})); }
      g.ENV.t=0.994;
      await new Promise(r=>setTimeout(r,500));
      g.setEnv('weather','clear');
      await new Promise(r=>setTimeout(r,500));
      // force scholar walk
      if(g.actorWalk){ g.actorWalk('scholar',true); g.actorWalk('guest',true); }
      const guestObj = g.scene.getObjectByName('actor_guest');
      if(guestObj) guestObj.visible=true;
      for(let i=0;i<30;i++) g.actorStep(0.1);
      function getWorldPos(bone){
        const v=new g.THREE.Vector3(); bone.getWorldPosition(v); return v.toArray().map(n=>+n.toFixed(3));
      }
      const out=[];
      for(const id of ['scholar','guest']){
        const rig=g.actorRig(id);
        if(!rig){ out.push({id, err:'no rig'}); continue; }
        const holderPos=getWorldPos(rig.holder);
        const lh=rig.bones['LeftHand']?getWorldPos(rig.bones['LeftHand']):null;
        const rh=rig.bones['RightHand']?getWorldPos(rig.bones['RightHand']):null;
        const lua=rig.bones['LeftUpperArm']?getWorldPos(rig.bones['LeftUpperArm']):null;
        const rua=rig.bones['RightUpperArm']?getWorldPos(rig.bones['RightUpperArm']):null;
        const st=g.actorState().actors.find(a=>a.id===id);
        out.push({id, holderPos, LeftHand:lh, RightHand:rh, LeftUpperArm:lua, RightUpperArm:rua, state:st});
      }
      return out;
    }catch(e){ return {error:e.message, stack:e.stack}; }
  });
  console.log('INFO',JSON.stringify(info,null,2));
}catch(e){ console.log('evaluate error',e); }
await browser.close(); server.close();
console.log('done');
