// Desktop walking: owns camera only while active; actual visible meshes stop motion.
import { THREE } from '../vendor.js';
/* 第 4 批（2026-11-24 · 交互体验）：摇杆死区/曲线、减弱动效判据抽到零依赖的 00c-ux（纯 node 可单测）。 */
import { MOTION, stickResponse, combineMove } from './00c-ux.js';
/* escapeFirst（第 4 批）：Esc 先问一句"有没有更近的东西要关"（驻足卡）。返回 true ⇒ 这一下 Esc
   只关卡片、不退出步行 —— 否则桌面上想关卡片就得整个退出步行再走回来。可选参数，
   walk-guard 里那几个裸 createWalk 不传它，行为与旧版一字不差。 */
export function createWalk({ camera, controls, world, canvas, groundHeight, insidePond, stop, escapeFirst = null }) {
  const keys = new Set(), ray = new THREE.Raycaster(), normal = new THREE.Vector3();
  const direction = new THREE.Vector3(), origin = new THREE.Vector3();
  const down = new THREE.Vector3(0,-1,0);
  const state = { active:false, blocked:0, steps:0 };
  let saved, yaw = 0, pitch = 0, feet = 0, drag = false;
  /* 触屏行走（2026-11-22 · 移动端收口 #3B）：手机没有键盘+右键，走模式是死的。
     左半屏相对摇杆走（touchF/R ∈ [-1,1]，update() 里与键盘叠加走同一套 move 碰撞），
     右半屏滑动转头。pointerId 双指并发：走与看各跟各的手指。 */
  let touchF = 0, touchR = 0, moveId = null, lookId = null;
  let moveAX = 0, moveAY = 0, lookX = 0, lookY = 0;
  const TOUCH_UI = (() => { try {
    return matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  } catch { return false; } })();
  let joyBase = null, joyKnob = null;   // 浮动摇杆：按住左半屏才出现跟手指走
  function ensureJoy(){
    if (joyBase) return;
    joyBase = document.createElement('div');
    joyBase.id = 'walk-joy'; joyBase.hidden = true;
    joyBase.style.cssText = 'position:fixed;width:120px;height:120px;border-radius:50%;' +
      'border:2px solid #fffbeeb0;background:#302c2518;z-index:13;pointer-events:none';
    joyKnob = document.createElement('div');
    joyKnob.style.cssText = 'position:absolute;left:34px;top:34px;width:52px;height:52px;' +
      'border-radius:50%;background:#fffbeed0;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    joyBase.appendChild(joyKnob);
    document.body.appendChild(joyBase);
  }
  function joyHide(){
    touchF = 0; touchR = 0; moveId = null;
    if (joyBase){ joyBase.hidden = true; }
  }
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
    state.active=false; keys.clear();drag=false;joyHide();lookId=null;hint.hidden=true;
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
    camera.position.set(0,feet+1.65,26);camera.near=0.08;camera.updateProjectionMatrix();yaw=0;pitch=0;bobPhase=0;
    if (TOUCH_UI) hint.textContent = '左半屏拖动行走 · 右半屏拖动转头 · 点"步行"按钮退出';
    else hint.textContent = 'WASD / 方向键行走 · 按住鼠标右键转头 · Esc 返回';
    state.active=true;hint.hidden=false;button?.setAttribute('aria-pressed','true');
    update(0);
  }
  /* 走动的头部晃动（2026-11-23 · 批次 #23）：
     走模式是第一人称，之前相机 y 是**死值** feet+1.65 —— 画面平移、身体不动，
     因而不出戏但也不"在此处"。加两路低频摆动：
       · 竖直 bob：每步一次起伏（步频 = 实际位移 / 步长 0.85m ⇒ 2.2m/s 时约 2.6Hz）
       · 横向 roll：每步左右交替一次微倾（bob 的半频）
     幅度刻意**很小**（y ±3.2cm、roll ±0.35°）：这是"身体在走"的暗示，不是过山车；
     真机晕动症（motion sickness）在第三人称转第一人称时最容易被放大，宁轻勿重。
     ⚠️ amplitude 乘 **实际位移**（不是 dt）：站着看风景时相位冻结、不晃 ——
        否则人不动画面自己在抖，那是 bug 不是手感。
     ⚠️⚠️ 横向摆动**不能改 camera.position.x/z**：move() 的碰撞射线是从
        camera.position 起算的（三条肩宽射线，见 move 内 origin.set），
        借位置做 sway 会让"人在晃"和"墙在哪"混成一件事 —— 走着走着之间
        忽然被旁边的柱子挡住。所以横向那一路改走 **roll**（绕视线轴的极小平移感倾斜），
        位置的 x/z 永远只由真实行走决定。 */
  const BOB_STEP = 0.85, BOB_Y = 0.032, BOB_ROLL = 0.0061;   // 0.0061 rad ≈ 0.35°
  let bobPhase = 0;
  function update(dt) {
    if(!state.active)return;
    /* 第 4 批：旧式 distance=dt·2.2/len 会把任何非零输入归一成全速（摇杆没有模拟量，见 00c-ux
       stickResponse 注释的实据）。改为"合成后夹到模长 ≤1、再乘 2.2"：键盘单键 / 斜向仍是 2.2 m/s
       （与旧版逐位相同），摇杆半推 ≈ 半速。 */
    const mv=combineMove(
      Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))+touchF,
      Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+touchR);
    const forward=mv.f, right=mv.r, distance=Math.min(dt,0.1)*2.2;
    const dx=(right*Math.cos(yaw)-forward*Math.sin(yaw))*distance;
    const dz=(-right*Math.sin(yaw)-forward*Math.cos(yaw))*distance;
    const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/0.08));
    const px = camera.position.x, pz = camera.position.z;
    for(let i=0;i<n;i++)move(dx/n,dz/n);
    /* 只量**水平**位移：上下台阶（y 变化）不该被算成"走了步"，否则爬台阶时狂晃 */
    const moved = Math.hypot(camera.position.x - px, camera.position.z - pz);
    bobPhase += moved / BOB_STEP * Math.PI * 2;   // 走满一个步长 = 一个完整起伏周期
    /* 减弱动效（第 4 批）：系统开了 prefers-reduced-motion ⇒ 起伏与横滚幅度归零（?motion=1 强制保留）。
       相位 bobPhase **照常推进** —— 脚步声的节拍与门禁读数（HOOKS.walkBob）都靠它，只是画面不晃。 */
    const sway = MOTION.reduced ? 0 : 1;
    camera.position.y = feet + 1.65 + Math.sin(bobPhase) * BOB_Y * sway;
    /* roll 作第三轴（YXZ 的中轴仍是 pitch/yaw，roll 只影响画面倾角） */
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, Math.sin(bobPhase * 0.5) * BOB_ROLL * sway, 'YXZ'));
  }
  addEventListener('keydown',e=>{
    if(!state.active || e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(escapeFirst&&escapeFirst())return;end();return;}
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){
      keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();
    }
  },true);
  addEventListener('keyup',e=>keys.delete(e.code));
  addEventListener('blur',()=>{keys.clear();drag=false;joyHide();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();drag=false;joyHide();}});
  canvas.addEventListener('pointerdown',e=>{if(state.active&&e.button===2){drag=true;canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();}},true);
  canvas.addEventListener('pointermove',e=>{if(state.active&&drag){yaw-=e.movementX*0.003;pitch=THREE.MathUtils.clamp(pitch-e.movementY*0.003,-1.35,1.35);}},true);
  /* 触屏双区（#3B）：左半屏走、右半屏看。pointerType 判 touch ⇒ 鼠标行为一字不动。
     OrbitControls 在 controls.enabled=false 时直接 return ⇒ 不会抢手势。 */
  canvas.addEventListener('pointerdown',e=>{
    if(!state.active || e.pointerType!=='touch')return;
    if(e.clientX < innerWidth*0.45 && moveId===null){
      moveId=e.pointerId;moveAX=e.clientX;moveAY=e.clientY;
      ensureJoy();
      joyBase.style.left=(e.clientX-60)+'px';joyBase.style.top=(e.clientY-60)+'px';
      joyBase.hidden=false;joyKnob.style.transform='translate(0px,0px)';
      try{canvas.setPointerCapture(e.pointerId);}catch{}
      e.preventDefault();e.stopImmediatePropagation();
    } else if (lookId===null){
      lookId=e.pointerId;lookX=e.clientX;lookY=e.clientY;
      try{canvas.setPointerCapture(e.pointerId);}catch{}
      e.preventDefault();e.stopImmediatePropagation();
    } else {
      /* 第 4 批 · 多指冲突（实据）：旧版只认领前两根手指，第三根、或"右半屏已在转头时再落一指"
         （捏合的本能动作）没被拦 ⇒ 落到 11-loop 冒泡阶段的水面 pointerdown/up ⇒ 轻点一下就是
         投石+撒饵、拖一下就是划水涟漪，而用户此刻在走路。步行态下触屏一律归走模式，多余的手指吞掉。 */
      e.preventDefault();e.stopImmediatePropagation();
    }
  },true);
  canvas.addEventListener('pointermove',e=>{
    if(!state.active || e.pointerType!=='touch')return;
    if(e.pointerId===moveId){
      /* 第 4 批：死区 + 加速曲线（00c-ux stickResponse）。旋钮显示仍跟手指（kx/ky），速度走曲线。 */
      const s=stickResponse(e.clientX-moveAX,e.clientY-moveAY);
      touchR=s.r;touchF=s.f;   // 上推=前进
      joyKnob.style.transform=`translate(${s.kx*30}px,${s.ky*30}px)`;
      e.preventDefault();e.stopImmediatePropagation();
    } else if(e.pointerId===lookId){
      yaw-=(e.clientX-lookX)*0.0042;lookX=e.clientX;
      pitch=THREE.MathUtils.clamp(pitch-(e.clientY-lookY)*0.0042,-1.35,1.35);lookY=e.clientY;
      e.preventDefault();e.stopImmediatePropagation();
    }
  },true);
  const touchEnd=e=>{
    if(e.pointerId===moveId)joyHide();
    if(e.pointerId===lookId)lookId=null;
  };
  /* 第 4 批 · 横竖屏切换（实据）：摇杆底座是按下那一刻用 clientX/Y 绝对定位的，moveAX/AY 也是旧坐标系；
     旋转屏幕时 iOS/Android 并不保证对仍按着的手指发 pointercancel ⇒ 底座停在旧位置（可能已在屏外），
     touchF/R 冻在最后一个值 ⇒ 人自己一直往前走。没有任何 resize 监听兜它。
     ⇒ 视口尺寸一变就把两根手指都释放（下一次按下按新坐标重新起摇杆）。 */
  const touchReset=()=>{ if(moveId!==null||lookId!==null){ joyHide(); lookId=null; } };
  addEventListener('resize',touchReset);
  addEventListener('orientationchange',touchReset);
  canvas.addEventListener('pointerup',touchEnd,true);
  canvas.addEventListener('pointercancel',touchEnd,true);
  addEventListener('pointerup',()=>{drag=false;});
  canvas.addEventListener('contextmenu',e=>{if(state.active)e.preventDefault();});
  /* setTouch：测试钩子（无头门禁用，无需真触屏即可验证行走数学）+ 预留外部摇杆。 */
  function setTouch(f,r){touchF=f;touchR=r;}
  /* setYaw：测试钩子（批次 #24 · 水声方位门禁）—— 把视线**瞬间**转到指北，不靠拖拽。
     走模式里 yaw 是闭包私有变量，门禁没有别的入口能不靠手势改朝向。
     只在 state.active 时生效：走模式外没有"走模式的 yaw"这回事。 */
  function setYaw(y){ if(!state.active)return; yaw=y; update(0); }
  return { state,start,end,update,move, floor, setTouch, setYaw, bobPhase: () => bobPhase };
}
