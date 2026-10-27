import { chromium } from 'playwright';
const browser=await chromium.launch({args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
page.on('pageerror',e=>console.log('pageerror',e.message));
page.on('console',m=>{if(m.text().startsWith('[actor]')) console.log(m.text())});
await page.goto(`http://127.0.0.1:8935/index.html?intro=0&tier=low`,{waitUntil:'domcontentloaded', timeout:60000});
await page.waitForFunction(()=>window.__garden && document.getElementById('loading')?.classList.contains('done'),null,{timeout:120000});
await page.evaluate(async()=>{ await window.__garden.bootDonePromise; });
await page.waitForTimeout(800);
// set day clear
await page.evaluate(async()=>{
  const g=window.__garden;
  g.setEnv('season','summer');
  const el=document.getElementById('hourSlider'); el.value='12.5'; el.dispatchEvent(new Event('input',{bubbles:true})); g.ENV.t=0.994;
  await new Promise(r=>setTimeout(r,600));
  g.setEnv('weather','clear');
  await new Promise(r=>setTimeout(r,600));
});
// force scholar to walk along a short route for verification
await page.evaluate(()=>{
  const g=window.__garden;
  g.actorWalk('scholar',true);
  g.actorWalk('guest',true);
  const guestObj=g.scene.getObjectByName('actor_guest');
  if(guestObj) guestObj.visible=true;
  // set guest to a visible ground position near scholar for pair test
  const guest=g.actorState().actors.find(a=>a.id==='guest');
  // move guest near scholar for photo
  // We'll just step them
  for(let i=0;i<40;i++) g.actorStep(0.1);
});
await page.waitForTimeout(500);
// Capture scholar walking from 3 angles
for(const [name, posOff] of [['front', [0,1.8,4]], ['side',[4,1.8,0]], ['back',[-4,1.8,-4]]]){
  await page.evaluate((off)=>{
    const g=window.__garden;
    const scholar=g.actorState().actors.find(a=>a.id==='scholar');
    const x=scholar.pos[0], z=scholar.pos[2];
    const cam=g.camera, ctrl=g.controls;
    cam.position.set(x+off[0], off[1], z+off[2]);
    ctrl.target.set(x,1.0,z);
    cam.updateMatrixWorld(true); ctrl.update();
  }, posOff);
  await page.waitForTimeout(400);
  await page.screenshot({path:`outputs/_diag/walk-verify/scholar-${name}.png`});
  console.log('shot',name);
}
// Capture guest similarly
await page.evaluate(()=>{
  const g=window.__garden;
  for(let i=0;i<40;i++) g.actorStep(0.1);
});
for(const [name, posOff] of [['front', [0,1.8,4]], ['side',[4,1.8,0]]]){
  await page.evaluate((off)=>{
    const g=window.__garden;
    const guest=g.actorState().actors.find(a=>a.id==='guest');
    if(!guest) return;
    const x=guest.pos[0], z=guest.pos[2];
    const cam=g.camera, ctrl=g.controls;
    cam.position.set(x+off[0], off[1], z+off[2]);
    ctrl.target.set(x,1.0,z);
    cam.updateMatrixWorld(true); ctrl.update();
  }, posOff);
  await page.waitForTimeout(400);
  await page.screenshot({path:`outputs/_diag/walk-verify/guest-${name}.png`});
  console.log('guest shot',name);
}
// Capture pair walking together (simulate tour phase)
await page.evaluate(async()=>{
  const g=window.__garden;
  // Fast forward visit to pair phase if possible
  for(let i=0;i<200;i++) g.actorStep(0.1);
  const vs=g.actorVisit();
  console.log('visit phase',vs.phase);
});
await page.waitForTimeout(300);
await page.evaluate(()=>{
  const g=window.__garden;
  const host=g.actorState().actors.find(a=>a.id==='scholar');
  const guest=g.actorState().actors.find(a=>a.id==='guest');
  if(host && guest && host.pos && guest.pos){
    const mx=(host.pos[0]+guest.pos[0])/2, mz=(host.pos[2]+guest.pos[2])/2;
    const cam=g.camera, ctrl=g.controls;
    cam.position.set(mx+6, 4.0, mz+8);
    ctrl.target.set(mx,1.0,mz);
    cam.updateMatrixWorld(true); ctrl.update();
  }
});
await page.waitForTimeout(400);
await page.screenshot({path:`outputs/_diag/walk-verify/pair.png`});
console.log('pair shot done');
await browser.close();
console.log('done');
