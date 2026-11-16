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
 const result=await page.evaluate(async()=>{
 const {HOOKS}=await import('/src/00-config.js'); const {camera}=await import('/src/02-scene.js');
 const p=camera.position.toArray();HOOKS.walk();return {p,on:HOOKS.walkState().active,start:camera.position.toArray()};
 });
 assert.equal(result.on,true);console.log('START',JSON.stringify(result));
 await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');
 const moved=await page.evaluate(async()=>{const {camera}=await import('/src/02-scene.js');const {HOOKS}=await import('/src/00-config.js');return {p:camera.position.toArray(),s:HOOKS.walkState()};});
 console.log('MOVE',JSON.stringify(moved));assert.ok(moved.p[2]<result.start[2]-0.1,'W moves forward');
 await page.screenshot({path:'docs/gate-evidence/2026-11-16-desktop-upgrades/walk.png'});
 await page.keyboard.press('Escape');
 const end=await page.evaluate(async()=>{const {camera}=await import('/src/02-scene.js');const {HOOKS}=await import('/src/00-config.js');return {p:camera.position.toArray(),on:HOOKS.walkState().active};});
 assert.equal(end.on,false);assert.ok(end.p.every((v,i)=>Math.abs(v-result.p[i])<0.1),'restores camera');assert.deepEqual(errors,[]);
 const collision=await page.evaluate(async()=>{
   const {THREE}=await import('/vendor.js');const {createWalk}=await import('/src/11a-walk.js');
   const world=new THREE.Group(),cam=new THREE.PerspectiveCamera(),controls={target:new THREE.Vector3(),enabled:true};
   const box=(x,y,z,w,h,d)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial());m.position.set(x,y,z);world.add(m);return m;};
   const wall=box(0,1,24,4,2,.2);world.updateMatrixWorld(true);
   const walk=createWalk({camera:cam,controls,world,canvas:document.createElement('canvas'),groundHeight:()=>0,insidePond:()=>false,stop:()=>{}});
   walk.start();for(let i=0;i<60;i++)walk.move(0,-.05);const wallZ=cam.position.z;walk.end();world.remove(wall);
   box(0,.1,25,2,.2,1);world.updateMatrixWorld(true);walk.start();for(let i=0;i<20;i++)walk.move(0,-.05);walk.update(0);const stepY=cam.position.y;walk.end();
   const pond=createWalk({camera:cam,controls,world:new THREE.Group(),canvas:document.createElement('canvas'),groundHeight:()=>0,insidePond:(_x,z)=>z<22,stop:()=>{}});
   pond.start();for(let i=0;i<60;i++)pond.move(0,-.05);const pondZ=cam.position.z;pond.end();
   return {wallZ,stepY,pondZ};
 });
 console.log('COLLISION',JSON.stringify(collision));assert.ok(collision.wallZ>24.3,'wall blocks body');assert.ok(Math.abs(collision.stepY-1.85)<.01,'climbs 20cm step');assert.ok(collision.pondZ>=25,'pond edge blocks');
 console.log('ALL PASS: walk entry / keyboard movement / exit restoration / page errors / wall / step / pond');
}finally{await browser?.close();server.close();}
