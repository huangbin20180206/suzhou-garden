// Desktop walking: owns camera only while active; actual visible meshes stop motion.
import { THREE } from '../vendor.js';
export function createWalk({ camera, controls, world, canvas, groundHeight, insidePond, stop }) {
  const keys = new Set(), ray = new THREE.Raycaster(), normal = new THREE.Vector3();
  const direction = new THREE.Vector3(), origin = new THREE.Vector3();
  const down = new THREE.Vector3(0,-1,0);
  const state = { active:false, blocked:0, steps:0 };
  let saved, yaw = 0, pitch = 0, feet = 0, drag = false;
  const button = document.querySelector('[data-act="walk"]');
  const hint = document.createElement('div');
  hint.id = 'walk-help'; hint.hidden = true;
  hint.textContent = 'WASD / 方向键行走 · 按住鼠标右键转头 · Esc 返回';
  hint.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 18px;background:#fffbeee8;color:#302c25;border-radius:6px;z-index:12;pointer-events:none';
  document.body.appendChild(hint);
  function solid(o) {
    for (let p=o;p;p=p.parent) if (!p.visible) return false;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    return materials.some(m => m && !m.transparent && m.depthWrite !== false);
  }
  /* 台阶上限 CLIMB=0.60：月洞门门槛石是按绝对坐标 y=0..0.22 建的（07-ground.js），
     而门前铺装 -0.33、门内园地 -0.42 ⇒ 实际台阶 0.55~0.64m。原来的 0.34 是正常人的
     抬腿高度，但在这里等于把园门封死。抬到 0.60 只放开这一级，竖直面（栏杆/假山/池岸）
     仍被下面三条水平射线挡住，不会让人翻墙。DROP=0.70 是配套的下台阶上限（原来 0.65
     对 0.64 的下落只余 1cm，太贴）。 */
  const CLIMB = 0.60, DROP = 0.70;
  function floor(x,z,base) {
    origin.set(x,base+CLIMB+0.05,z); direction.set(0,-1,0);
    ray.set(origin,direction); ray.far=CLIMB+DROP+0.2;
    for (const h of ray.intersectObject(world,true)) {
      if (!solid(h.object) || !h.face) continue;
      normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (normal.y > 0.55) return h.point.y;
    }
    const y=groundHeight(x,z);
    return !insidePond(x,z-3) && y<=base+CLIMB && y>=base-DROP ? y : null;
  }
  function move(dx,dz) {
    const dist=Math.hypot(dx,dz); if(!dist) return;
    const x=camera.position.x+dx,z=camera.position.z+dz;
    if(x < -45 || x > 50 || z < -29 || z > 36) {state.blocked++;return;}
    const y=floor(x,z,feet);
    if(y===null) {state.blocked++;return;}
    direction.set(dx/dist,0,dz/dist);
    const base=Math.max(feet,y), top=base+CLIMB;
    /* 脚踝那条射线会先撞上台阶的**立面**——那是能踩上去的矮台，不是墙。
       判据：在命中点后 0.12m 往下打一条短射线，若顶面高度 ≤ 抬腿上限且是水平面，
       就当台阶放行；栏杆（顶面在 0.73m 以上）、假山、墙则顶面够不着 ⇒ 照旧拦人。 */
    const steppable=(hit)=>{
      origin.copy(hit.point).addScaledVector(direction,0.12); origin.y=top+0.05;
      ray.set(origin,down); ray.far=CLIMB+DROP+0.2;
      for(const h of ray.intersectObject(world,true)){
        if(!solid(h.object)||!h.face) continue;
        normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if(normal.y>0.55) return h.point.y<=top+0.01;
      }
      return false;
    };
    // Three shoulder-width rays at ankle-above-step, waist and eye height.
    for(const side of [-0.23,0,0.23]) for(const height of [0.43,0.95,1.55]) {
      origin.set(camera.position.x-direction.z*side,base+height,camera.position.z+direction.x*side);
      ray.set(origin,direction);ray.far=dist+0.25;
      const hit=ray.intersectObject(world,true).find(h=>solid(h.object));
      if(!hit) continue;
      if(height===0.43 && steppable(hit)) continue;
      state.blocked++;return;
    }
    camera.position.x=x;camera.position.z=z;feet=y;state.steps++;
  }
  function end() {
    if(!state.active)return;
    state.active=false; keys.clear();drag=false;hint.hidden=true;
    camera.position.copy(saved.p);camera.quaternion.copy(saved.q);camera.near=saved.near;camera.updateProjectionMatrix();
    controls.target.copy(saved.target);controls.enabled=saved.enabled;
    button?.setAttribute('aria-pressed','false');
  }
  function start() {
    if(state.active){end();return;}
    stop();world.updateMatrixWorld(true);
    saved={p:camera.position.clone(),q:camera.quaternion.clone(),target:controls.target.clone(),near:camera.near,enabled:controls.enabled};
    controls.enabled=false;
    // South courtyard, outside pond and clear of the moon gate pillars.
    feet=groundHeight(0,26); const sampled=floor(0,26,feet+0.3);if(sampled!==null)feet=sampled;
    camera.position.set(0,feet+1.65,26);camera.near=0.08;camera.updateProjectionMatrix();yaw=0;pitch=0;
    state.active=true;hint.hidden=false;button?.setAttribute('aria-pressed','true');
    update(0);
  }
  function update(dt) {
    if(!state.active)return;
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const right=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const len=Math.hypot(forward,right)||1, distance=Math.min(dt,0.1)*2.2/len;
    const dx=(right*Math.cos(yaw)-forward*Math.sin(yaw))*distance;
    const dz=(-right*Math.sin(yaw)-forward*Math.cos(yaw))*distance;
    const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/0.08));
    for(let i=0;i<n;i++)move(dx/n,dz/n);
    camera.position.y=feet+1.65;
    camera.quaternion.setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));
  }
  addEventListener('keydown',e=>{
    if(!state.active || e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();end();return;}
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){
      keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();
    }
  },true);
  addEventListener('keyup',e=>keys.delete(e.code));
  addEventListener('blur',()=>{keys.clear();drag=false;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();drag=false;}});
  canvas.addEventListener('pointerdown',e=>{if(state.active&&e.button===2){drag=true;canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();}},true);
  canvas.addEventListener('pointermove',e=>{if(state.active&&drag){yaw-=e.movementX*0.003;pitch=THREE.MathUtils.clamp(pitch-e.movementY*0.003,-1.35,1.35);}},true);
  addEventListener('pointerup',()=>{drag=false;});
  canvas.addEventListener('contextmenu',e=>{if(state.active)e.preventDefault();});
  return { state,start,end,update,move, floor };
}
