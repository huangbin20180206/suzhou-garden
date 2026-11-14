import { chromium } from 'playwright';
const browser=await chromium.launch({args:['--no-sandbox']});
const page=await browser.newPage();
page.on('pageerror',e=>console.log('pageerror',e.message));
page.on('console',m=>console.log('console',m.text()));
console.log('goto');
await page.goto(`http://127.0.0.1:8935/index.html?intro=0&tier=low`,{waitUntil:'domcontentloaded', timeout:60000});
console.log('wait loading');
await page.waitForFunction(()=>window.__garden && document.getElementById('loading')?.classList.contains('done'),null,{timeout:120000});
console.log('loading done');
await page.evaluate(async()=>{ await window.__garden.bootDonePromise; });
console.log('bootDone');
await page.waitForTimeout(1500);
console.log('checking actors');
let st=null;
for(let i=0;i<20;i++){
  st=await page.evaluate(()=>window.__garden.actorState && window.__garden.actorState());
  console.log('try',i, st?st.n:'no');
  if(st && st.n>=7) break;
  await page.waitForTimeout(1000);
}
console.log(JSON.stringify(st,null,2));
if(st){
  const info=await page.evaluate(()=>{
    const g=window.__garden;
    const getY=(id)=>{
      const rig=g.actorRig(id);
      if(!rig) return null;
      const v=new g.THREE.Vector3(); rig.holder.getWorldPosition(v); return +v.y.toFixed(3);
    };
    const getPos=(id)=>{
      const rig=g.actorRig(id);
      if(!rig) return null;
      const v=new g.THREE.Vector3(); rig.holder.getWorldPosition(v); return v.toArray().map(n=>+n.toFixed(3));
    };
    return {
      go1Y: getY('go1'),
      go2Y: getY('go2'),
      go1Pos: getPos('go1'),
      go2Pos: getPos('go2'),
      scholarPos: getPos('scholar'),
      guestPos: getPos('guest'),
      qinPos: getPos('qin'),
      laborerPos: getPos('laborer'),
      // Also check SEAT_SPOTS via props
      seatSpots: g.PROP_SPOTS ? null : null // not exposed
    };
  });
  console.log('positions', JSON.stringify(info,null,2));
}
await browser.close();
console.log('done');
