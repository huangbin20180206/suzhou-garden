import { chromium } from 'playwright';
import { makeStaticServer, listenEphemeral, launchChromium } from './_harness.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const server=makeStaticServer(path.resolve(fileURLToPath(new URL('../',import.meta.url))));
const port=await listenEphemeral(server);let browser;
try {
 browser=await launchChromium(chromium);const page=await browser.newPage({viewport:{width:960,height:640}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${port}/?tier=low&debug=1`);
 await page.waitForFunction(()=>window.__garden,null,{timeout:120000});
 await page.evaluate(async()=>{const a=await import('/src/08-assemble.js');await a.bootDonePromise;});
 // A. real pond shore: walk north from start until the shore stops us
 const start=await page.evaluate(async()=>{
   const {HOOKS}=await import('/src/00-config.js');HOOKS.walk();
   return {on:HOOKS.walkState().active};
 });
 assert.equal(start.on,true);
 // Headless software rendering runs at a few fps, so a fixed wall-clock hold
 // covers an unpredictable distance. Hold W and poll until the shore blocks us.
 await page.keyboard.down('w');
 const walkDeadline=Date.now()+90000;
 let blockedSeen=false;
 while(Date.now()<walkDeadline){
   await page.waitForTimeout(1000);
   const s=await page.evaluate(async()=>{const {HOOKS}=await import('/src/00-config.js');return HOOKS.walkState();});
   if(s.blocked>0){blockedSeen=true;break;}
 }
 await page.keyboard.up('w');
 if(!blockedSeen) console.log('SHORE-TIMEOUT: never blocked within 90s');
 const shore=await page.evaluate(async()=>{
   const {HOOKS}=await import('/src/00-config.js');
   const {camera}=await import('/src/02-scene.js');
   const {insidePond}=await import('/src/05-water.js');
   const s=HOOKS.walkState();
   return {p:camera.position.toArray(),blocked:s.blocked,steps:s.steps,
     inPond:insidePond(camera.position.x,camera.position.z-3)};
 });
 console.log('SHORE',JSON.stringify(shore));
 console.log('GATE',JSON.stringify({z:+shore.p[2].toFixed(2),y:+shore.p[1].toFixed(2),
   crossedGate:shore.p[2]<21.5}));
 assert.ok(shore.steps>0,'moves on real ground');
 assert.ok(shore.blocked>0,'pond shore blocks');
 assert.equal(shore.inPond,false,'never enters pond');
 // 月洞门门槛石顶比门前铺装高 0.55m（绝对坐标遗留），CLIMB 抬到 0.60 后必须能过去。
 assert.ok(shore.p[2]<21.5,`crosses the moon-gate threshold, z=${shore.p[2].toFixed(2)}`);
 // B. real bridge steps + deck floor samples (world coords; bridge at (8.4,0,4.6) rotY 90deg)
 const floors=await page.evaluate(async()=>{
   const {HOOKS}=await import('/src/00-config.js');
   const pts=[
     {x:8.4,z:-2.40,base:0.9,exp:1.085},
     {x:8.4,z:-3.32,base:0.5,exp:0.690},
     {x:8.4,z:-4.24,base:0.1,exp:0.296},
     {x:8.4,z:-1.10,base:1.1,exp:1.302},
     {x:8.4,z:4.60,base:1.9,exp:2.099},
   ];
   return pts.map(q=>({z:q.z,y:HOOKS.walkFloor(q.x,q.z,q.base),exp:q.exp}));
 });
 console.log('FLOORS',JSON.stringify(floors));
 for (const f of floors){
   assert.ok(f.y!==null,`floor found at z=${f.z}`);
   assert.ok(Math.abs(f.y-f.exp)<0.09,`floor z=${f.z} ~${f.exp}, got ${f.y}`);
 }
 // C. real railing blocks sideways exit from deck.
 //    Uses the walker's own collision heights (feet+0.43 / +0.95 / +1.55) and its
 //    block rule (any single hit blocks). A ray at eye height alone is wrong: the
 //    rail panels top out at deck+0.73 and the balusters stand every ~2.3m, so an
 //    eye-height ray slides over the panel and between two posts.
 const rail=await page.evaluate(async()=>{
   const {THREE}=await import('/vendor.js');
   const {world}=await import('/src/02-scene.js');
   const {HOOKS}=await import('/src/00-config.js');
   world.updateMatrixWorld(true);
   const ray=new THREE.Raycaster();
   const solid=h=>{
     const ms=Array.isArray(h.object.material)?h.object.material:[h.object.material];
     let vis=true; for(let p=h.object;p;p=p.parent) if(!p.visible) vis=false;
     return vis&&ms.some(m=>m&&!m.transparent&&m.depthWrite!==false);
   };
   const out=[];
   for (const z of [0, 2.3, 4.6]){
     // Search the deck height instead of assuming it: walkFloor needs a base
     // within ~1m of the surface, and the deck slopes along the span.
     let feet=null;
     for (let base=0.5; base<=2.5 && feet===null; base+=0.1) feet=HOOKS.walkFloor(8.4,z,base);
     if (feet===null){ out.push({z,feet:null}); continue; }
     const row={z,feet};
     for (const side of [1,-1]){
       let blocked=false, minDist=null;
       for (const h of [0.43,0.95,1.55]){
         ray.set(new THREE.Vector3(8.4,feet+h,z),new THREE.Vector3(side,0,0));
         ray.far=1.6;
         const hit=ray.intersectObject(world,true).find(solid);
         if (hit){ blocked=true; if(minDist===null||hit.distance<minDist) minDist=hit.distance; }
       }
       row[side>0?'px':'nx']={blocked,minDist};
     }
     out.push(row);
   }
   return out;
 });
 console.log('RAIL',JSON.stringify(rail));
 for (const r of rail){
   assert.ok(r.feet!==null,`deck floor at z=${r.z}`);
   assert.equal(r.px.blocked,true,`east railing blocks at z=${r.z}`);
   assert.equal(r.nx.blocked,true,`west railing blocks at z=${r.z}`);
   assert.ok(r.px.minDist>0.7&&r.px.minDist<1.3,`east railing within arm reach at z=${r.z}`);
   assert.ok(r.nx.minDist>0.7&&r.nx.minDist<1.3,`west railing within arm reach at z=${r.z}`);
 }
 await page.evaluate(async()=>{const {HOOKS}=await import('/src/00-config.js');HOOKS.walkExit();});
 assert.deepEqual(errors,[]);
 console.log('ALL PASS: real pond shore / bridge steps+deck / railings / page errors');
}finally{await browser?.close();server.close();}
