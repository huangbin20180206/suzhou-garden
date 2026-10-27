import { launchChromium, listenEphemeral } from './_harness.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p); fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end('not found');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'}); res.end(d);})});
const port=await listenEphemeral(server);
const { chromium } = await import('playwright');
const browser=await chromium.launch({args:['--no-sandbox']});
const page=await browser.newPage();
page.on('pageerror',e=>console.log('pageerror',e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=low`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__garden && document.getElementById('loading')?.classList.contains('done'),null,{timeout:120000});
await page.evaluate(async()=>{ await window.__garden.bootDonePromise; });
await page.waitForTimeout(1000);
await page.waitForFunction(()=>window.__garden.actorState && window.__garden.actorState().n>=7,null,{timeout:60000});
const info=await page.evaluate(()=>{
  const g=window.__garden;
  // get SEAT_SPOTS via props
  const seats = g.PROP_SPOTS ? g.PROP_SPOTS.stoneTable : null;
  // actorState
  const st=g.actorState();
  const actors=st.actors;
  // find go1/go2
  const go1=actors.find(a=>a.id==='go1');
  const go2=actors.find(a=>a.id==='go2');
  // get holder Y
  const getHolderY=(id)=>{
    const rig=g.actorRig(id);
    if(!rig) return null;
    const v=new g.THREE.Vector3(); rig.holder.getWorldPosition(v); return v.y;
  };
  // get SEAT_SPOTS from 14-props via window.__garden.PROP_SPOTS not exposed, try direct import
  // Instead read from figures? For procedural seats, check SEAT_SPOTS via actor's spot
  // We'll just return actor spots
  return {
    n: st.n,
    go1, go2,
    go1Y: getHolderY('go1'),
    go2Y: getHolderY('go2'),
    scholarY: getHolderY('scholar'),
    guestY: getHolderY('guest'),
    qinY: getHolderY('qin'),
    visit: g.actorVisit(),
  };
});
console.log(JSON.stringify(info,null,2));
await browser.close(); server.close();
