// 15d-carriage.js — 由 15-stable.js 按职责整块搬出（纯搬家，逐字节未改）。
// 车与院子里的家伙什：
//   · 到访用的那驾马车（TRAVEL 子状态机 + 摆位/停放/显隐/系马绳）
//   · makeCarriage（厩里停的那两驾）
//   · 草料捆（FEED_BALE / makeFeedBale）与水槽（makeTrough）
import { THREE, mergeGeometries } from '../vendor.js';
import { groundHeight } from './05-water.js';
import { gaitPose } from './15c-horse-life.js';
import { mesh, box } from './03-factory.js';
import { prRange } from './15a-shared.js';
import { mulberry32 } from './00-config.js';
import { MAT } from './01-materials.js';
export function mergeLocalMeshes(container, inv, accept){
  const list = [];
  container.traverse(o => { if (o.isMesh && o !== container && accept(o)) list.push(o); });
  const buckets = new Map();
  for (const o of list){
    const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, items: [] });
    buckets.get(key).items.push(o);
  }
  for (const b of buckets.values()){
    if (b.items.length < 2) continue;
    const geos = [];
    for (const o of b.items){
      const g = o.geometry.clone();
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(m);
      if (!g.index){
        const n = g.attributes.position.count, idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      geos.push(g);
    }
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch (e){ merged = null; }
    if (!merged) continue;                       // 合并失败就保留原网格（宁可慢，不可消失）
    const mm = new THREE.Mesh(merged, b.mat);
    mm.castShadow = b.cast; mm.receiveShadow = b.recv;
    mm.name = 'carriagePart';
    container.add(mm);
    for (const o of b.items) if (o.parent) o.parent.remove(o);
  }
}
export function prepareTravelCarriage(car){
  car.updateMatrixWorld(true);
  const wheels = car.userData.wheels || [];
  const inWheel = (o) => {
    let p = o;
    while (p && p !== car){ if (wheels.includes(p)) return true; p = p.parent; }
    return false;
  };
  for (const w of wheels){
    w.updateMatrixWorld(true);
    mergeLocalMeshes(w, new THREE.Matrix4().copy(w.matrixWorld).invert(), () => true);
  }
  car.updateMatrixWorld(true);
  mergeLocalMeshes(car, new THREE.Matrix4().copy(car.matrixWorld).invert(), (o) => !inWheel(o));
  car.traverse(o => {
    if (!o.isMesh) return;
    o.userData.noMerge = true;                   // 别被 mergeStatics 烘走（见上）
    o.castShadow = false;                        // 静态阴影图烘不出"移动的车"（见上）
    o.receiveShadow = true;
    o.frustumCulled = false;                     // 车很大、随时在动，包围球不可靠
  });
  car.userData.wheels = wheels;
  car.userData.travel = true;
}

/* 行驶中的马车 + 两匹辕马（都由 16-actors 的到访导演层驱动）。
   parked 是"停在院里待发"的**局部**坐标（与 makeStable 里 carA 的落点一致）。 */
export const TRAVEL = {
  ready: false, group: null, car: null, wheels: [], slots: [], blob: null,
  cx: 0, cz: 0, stableYaw: 0, cy: 1, sy: 0,
  parked: { lx: -3.0, lz: -1.4, yaw: Math.PI },
  wheelR: 0.55,
};
export function stableTravel(){ return TRAVEL.ready ? TRAVEL : null; }

export const _travV = new THREE.Vector3();
/* 把车 + 两匹辕马摆到世界 (x,z)、朝向 yaw；dist = 累计里程（驱动车轮与四腿相位）。
   返回车心落地的世界坐标，供人物"坐在车上"用（不再让调用方另算一遍）。 */
export function travelCarriagePlace(x, z, yaw, dist){
  const V = TRAVEL;
  if (!V.ready) return null;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const gL = groundHeight(x - rx * 0.62, z - rz * 0.62);
  const gR = groundHeight(x + rx * 0.62, z + rz * 0.62);
  const gF = groundHeight(x + fx * 0.80, z + fz * 0.80);
  const gB = groundHeight(x - fx * 0.80, z - fz * 0.80);
  const y = (gL + gR) / 2;
  const car = V.car;
  car.position.copy(V.group.worldToLocal(_travV.set(x, y, z)));
  car.rotation.order = 'YXZ';
  // 车头 +z 沿行进方向；pitch 让车随坡抬头/低头，roll 让两轮同时落地（与 seatCart 同一口径）
  car.rotation.set(-Math.atan2(gF - gB, 1.6), yaw - V.stableYaw, (gR - gL) / 1.24);
  for (const w of V.wheels) w.rotation.z = dist / V.wheelR;
  const stride0 = 0.663;
  for (const s of V.slots){
    const ox = s.travelOff ? s.travelOff.x : 0;
    const oz = s.travelOff ? s.travelOff.z : 1.45;
    const hx = x + ox * Math.cos(yaw) + oz * Math.sin(yaw);
    const hz = z - ox * Math.sin(yaw) + oz * Math.cos(yaw);
    const hy = groundHeight(hx, hz);
    s.group.position.copy(V.group.worldToLocal(_travV.set(hx, hy, hz)));
    s.group.rotation.y = yaw - V.stableYaw;
    const L = s.life;
    if (L){
      L.driving = true;
      L.gaitW = 1; L.grazeW = 0;
      const stride = L.strideWalk || stride0;
      const ph = ((dist / stride) + (s.travelPh || 0)) % 1;
      L.gaitLegs = gaitPose('walk', ph < 0 ? ph + 1 : ph);
      L.gaitBob = Math.sin(ph * Math.PI * 4) * 0.016;
    }
  }
  if (V.blob){
    V.blob.position.copy(V.group.worldToLocal(_travV.set(x, y + 0.10, z)));
    V.blob.rotation.y = yaw - V.stableYaw;
  }
  return { x, y, z, yaw, pitch: car.rotation.x, roll: car.rotation.z };
}

/* 回到院里的停车位（复位 / 场景不出现时）。辕马同时回到各自的 home。 */
export function travelCarriagePark(){
  const V = TRAVEL;
  if (!V.ready) return;
  const p = V.parked;
  const x = V.cx + p.lx * V.cy + p.lz * V.sy;
  const z = V.cz - p.lx * V.sy + p.lz * V.cy;
  travelCarriagePlace(x, z, V.stableYaw + p.yaw, 0);
  for (const s of V.slots){
    const L = s.life;
    if (L){ L.driving = false; L.gaitW = 0; L.gaitLegs = null; L.gaitBob = 0; }
    const h = s.home;
    if (h){
      s.group.position.set(h.x, h.y, h.z);
      s.group.rotation.y = h.yaw;
    }
  }
  if (V.blob){
    V.blob.position.set(p.lx, groundHeight(x, z) + 0.10, p.lz);
    V.blob.rotation.y = p.yaw;
  }
}

/* 显隐（车走了 / 还没来）。抬车时辕马一起藏 —— 否则场上只剩两匹"拉空气"的马。 */
export function travelCarriageVisible(v){
  const V = TRAVEL;
  if (!V.ready) return;
  V.car.visible = !!v;
  if (V.blob) V.blob.visible = !!v;
  for (const s of V.slots) s.group.visible = !!v;
}

/* 系马绳（马夫把两匹辕马的缰绳拴到院内横杆上）：两根细管，与马一起走，
   只在"已系好"时显示。位置在槽位组的局部系里（马头前下方 → 横杆方向）。 */
export function makeLeadRope(slot){
  const g = new THREE.Group();
  g.name = 'leadRope';
  const mat = MAT.harness;
  for (const sgn of [-1, 1]){
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sgn * 0.10, 1.05, 0.74),
      new THREE.Vector3(sgn * 0.17, 0.96, 1.02),
      new THREE.Vector3(sgn * 0.24, 0.99, 1.28),
    ]);
    const t = mesh(new THREE.TubeGeometry(c, 8, 0.016, 5, false), mat, { name: 'leadRopeTube', cast: false });
    t.userData.noMerge = true;
    g.add(t);
  }
  g.userData.noMerge = true;
  g.visible = false;
  slot.group.add(g);
  slot.leadRope = g;
  return g;
}
export function travelCarriageTied(on){
  for (const s of TRAVEL.slots) if (s.leadRope) s.leadRope.visible = !!on;
}

export function makeCarriage(opts = {}){
  const g = new THREE.Group();
  const wood = MAT.woodDark, trim = MAT.wood, strap = MAT.harness;
  const detached = !!opts.detached;
  const wheel = (sx, z) => {
    const w = new THREE.Group();
    w.add(mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 20), wood, { name: 'wheelRim', cast: true }));
    for (let i = 0; i < 10; i++){
      const sp = mesh(box(0.035, 0.50, 0.030), trim, { name: 'wheelSpoke' });
      const a = (i / 10) * Math.PI * 2;
      sp.position.set(-Math.sin(a) * 0.25, Math.cos(a) * 0.25, 0);
      sp.rotation.z = -a;
      w.add(sp);
    }
    const hub = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.10, 10), wood, { name: 'wheelHub' });
    hub.rotation.x = Math.PI / 2; w.add(hub);
    w.position.set(sx * 0.62, 0.55, z);
    w.rotation.y = Math.PI / 2;
    return w;
  };
  /* 车轮留句柄：2026-10-23「马车版到访」要真的把车开起来，两只轮子得随里程转。
     车体其余静态件在 prepareTravelCarriage 里按材质并成 1~2 个网格（否则 45 个网格
     全部 noMerge ⇒ 45 个 draw call，smoke 的 800 预算吃不消）。 */
  const wheelL = wheel(-1, 0), wheelR = wheel(1, 0);
  g.add(wheelL); g.add(wheelR);
  g.userData.wheels = [wheelL, wheelR];
  const axle = mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.42, 8), wood, { name: 'carriageAxle' });
  axle.rotation.z = Math.PI / 2; axle.position.set(0, 0.55, 0); g.add(axle);
  const bedY = 0.72;
  const bed = mesh(box(1.15, 0.09, 1.32), wood, { name: 'carriageBed', cast: true });
  bed.position.set(0, bedY, -0.05); g.add(bed);
  for (const sx of [-1, 1]){
    const side = mesh(box(0.07, 0.42, 1.28), trim, { name: 'carriageSide' });
    side.position.set(sx * 0.54, bedY + 0.26, -0.05); g.add(side);
  }
  const back = mesh(box(1.10, 0.52, 0.07), trim, { name: 'carriageBack' });
  back.position.set(0, bedY + 0.30, -0.68); g.add(back);
  const front = mesh(box(1.10, 0.30, 0.07), trim, { name: 'carriageFront' });
  front.position.set(0, bedY + 0.16, 0.58); g.add(front);
  const canopy = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.86, 14, 1, true, 0, Math.PI), MAT.bambooBlind,
    { name: 'carriageCanopy', cast: false });
  canopy.rotation.z = Math.PI / 2; canopy.rotation.y = Math.PI / 2;
  canopy.position.set(0, bedY + 0.42, -0.30); canopy.material.side = THREE.DoubleSide;
  g.add(canopy);
  /* 车辕：**单马**用"双辕"（两根杆夹住一匹马的两侧）；**两匹马并排**要用
     「**中央辕杆（pole）+ 横轭（yoke）**」—— 辕杆从两马**中间**穿过、横轭横在两马颈上，
     这才是双马套车的真实结构。
     ⚠️⚠️ 2026-10-10 四轮定案：原来给"套两匹马"的车也做了双辕，而双辕的横向位置恰好落在
        两匹马的**身体中线**上 ⇒ 辕杆直接从马身里穿过去（出图判读"看不到辕木、辕/轮插在马身上"
        —— 其实是**结构用错**，不是位置偏）。 */
  const lift = detached ? 0.42 : 0.0;
  if (opts.pair){
    /* 2026-10-20 纠偏（老黄："马车套马的位置又不是枷锁，怎么都嵌到马的脑袋里面去了"）：
       彻底删除穿马头的 4 根垂直木柱（yokePost）。辕木沿马肩高平缓前伸，横轭（yoke）落在两马
       肩胛前胸鞍部（车局部 z=1.38、y=bedY+0.55≈1.27m，避开马头耳），并挂两具皮套项圈（yokeCollar）
       贴合马胸，还原真实驾车挽具，告别"马头套木枷上刑"。 */
    const pole = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, bedY + 0.02, 0.50),
      new THREE.Vector3(0, bedY + 0.30, 0.95),
      new THREE.Vector3(0, bedY + 0.55, 1.38),
    ]), 8, 0.045, 6, false), wood, { name: 'carriagePole', cast: true });
    g.add(pole);
    const yokeY = bedY + 0.55;
    const yoke = mesh(box(1.16, 0.08, 0.08), wood, { name: 'carriageYoke', cast: true });
    yoke.position.set(0, yokeY, 1.38); g.add(yoke);
    for (const sx of [-1, 1]){
      // 两具皮套挽圈：套在两马胸肩部，贴合自然
      const collar = mesh(new THREE.TorusGeometry(0.19, 0.028, 6, 16), MAT.harness, { name: 'yokeCollar', cast: true });
      collar.position.set(sx * 0.40, yokeY - 0.12, 1.38);
      collar.rotation.x = 0.36;
      collar.scale.set(1, 1.15, 1);
      g.add(collar);
    }
    /* ── 口络带（2026-10-14 · 用户报"马嘴和套车器具之间没有连接、悬空，像各自咬了一根木棍"）──
       ⚠️⚠️ 坐标系是这一条的关键（首版画错、出图"带子垂到马胸前"）：
         车 rotation.y=π ⇒ **车局部 +z = 世界 −z**；车心世界 z=−0.6 ⇒ 局部 z 与 世界 z 关系
         `世界z = −0.6 − 局部z`。
         实测（运行期探针）：辕里两匹马心世界 z≈0.85 ⇒ **车局部 z≈−1.45**（负侧！），
         马嘴世界 z≈−0.30 ⇒ 车局部 z≈**−0.30**；横轭在局部 +1.98（世界 −2.58）= **在马的后面**。
         即"马站在车的后方、辕朝相反方向" —— 首版把带子画在局部 +1.98→+2.96，
         等于挂在车头那侧，与马嘴隔了 3m，所以出图看着是悬空垂落。
       修法：把口络带画在**马身这一侧**（局部 z 为负），形成嘴→颊带→鼻革→缰绳的闭环：
         · 鼻革 at 局部 z≈−0.30（= 马嘴正中），y≈0.98
         · 颊带 从鼻革两侧斜向后上 to 局部 z≈−0.75, y≈1.15（马颊）
         · 缰绳 从颊带上端向后 to 局部 z≈−1.30, y≈1.25（车辕/颈圈侧），形成可读的连接
       半径 0.012~0.015（皮带量级）；与既有 strap(MAT.harness) 同材质，不引入新资产。 */
    const MX = sx0 => sx0 * 0.40;                 // 两匹马横向（与辕距对齐）
    for (const sx of [-1, 1]){
      /* 鼻革：跨过马嘴的一小段横带 */
      const nose = new THREE.CatmullRomCurve3([
        new THREE.Vector3(MX(sx) - 0.075, 0.99, -0.30),
        new THREE.Vector3(MX(sx),        0.97, -0.38),
        new THREE.Vector3(MX(sx) + 0.075, 0.99, -0.30),
      ]);
      g.add(mesh(new THREE.TubeGeometry(nose, 6, 0.014, 5, false), strap, { name: 'bridleNose', cast: false }));
      for (const s2 of [-1, 1]){
        /* 颊带：鼻革侧端 → 马颊侧后方（斜向上后） */
        const cheek = new THREE.CatmullRomCurve3([
          new THREE.Vector3(MX(sx) + s2 * 0.075, 0.99, -0.30),
          new THREE.Vector3(MX(sx) + s2 * 0.095, 1.08, -0.55),
          new THREE.Vector3(MX(sx) + s2 * 0.105, 1.16, -0.78),
        ]);
        g.add(mesh(new THREE.TubeGeometry(cheek, 6, 0.013, 5, false), strap, { name: 'bridleCheek', cast: false }));
        /* 缰绳：颊带上端 → 向后拉到车辕/颈圈侧（形成"套着"的连续读法） */
        const rein = new THREE.CatmullRomCurve3([
          new THREE.Vector3(MX(sx) + s2 * 0.105, 1.16, -0.78),
          new THREE.Vector3(MX(sx) + s2 * 0.115, 1.22, -1.10),
          new THREE.Vector3(MX(sx) + s2 * 0.120, 1.26, -1.42),
        ]);
        g.add(mesh(new THREE.TubeGeometry(rein, 8, 0.012, 4, false), strap, { name: 'bridleRein', cast: false }));
      }
    }
  } else {
    for (const sx of [-1, 1]){
      const shaftCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 0.40, bedY - 0.02, 0.55),
        new THREE.Vector3(sx * 0.40, bedY + 0.10 + lift * 0.6, 1.30),
        new THREE.Vector3(sx * 0.42, bedY + 0.22 + lift, 2.05),
      ]);
      g.add(mesh(new THREE.TubeGeometry(shaftCurve, 8, 0.042, 6, false), wood, { name: 'carriageShaft', cast: true }));
    }
    const yoke = mesh(box(0.92, 0.07, 0.07), wood, { name: 'carriageYoke', cast: true });
    yoke.position.set(0, bedY + 0.24 + lift, 1.98); g.add(yoke);
  }
  if (detached){
    // 支辕棍：一根斜撑把抬起的辕头托住（真实停车做法）
    for (const sx of [-1, 1]){
      const prop = mesh(box(0.06, 0.62, 0.06), wood, { name: 'shaftProp', cast: true });
      prop.position.set(sx * 0.42, 0.31, 1.72); prop.rotation.x = -0.28; g.add(prop);
    }
  } else if (!opts.pair){
    // 单马套车：两根缰绳从辕头垂到马侧
    for (const sx of [-1, 1]){
      const rein = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 0.30, bedY + 0.44, 0.42),
        new THREE.Vector3(sx * 0.42, bedY + 0.30, 1.20),
        new THREE.Vector3(sx * 0.44, bedY + 0.20, 1.85),
      ]);
      g.add(mesh(new THREE.TubeGeometry(rein, 8, 0.014, 4, false), strap, { name: 'carriageRein', cast: false }));
    }
  }
  g.userData.carriage = true;
  return g;
}

/* ⚠️⚠️ 私有流必须自己包一层区间映射：`mulberry32(seed)` 返回的是**裸的 `()=>[0,1)`**，
   带 (min,max) 签名的是 00-config 的 `rr`（= `(a,b)=>a+rnd()*(b-a)`），不是它本身。
   2026-10-16 实测踩到：把 `mulberry32(...)` 直接当 `(a,b)` 调，参数被**静默忽略**、
   一律返回 0~1 —— 草茎的 `r` 于是涨到 1.03、再乘 3.4 倍外扩 ⇒ 草捆变成一个 6 米大的
   几何体糊在镜头上（3 次截图排查才定位到）。同型写法在本文件**至少出现过两次**
   （旧的 horseCoatRoughTex 也是），凡新建私有流一律走这两个函数。 */

/* ── 草料捆（马夫手里那捆）──────────────────────────────────────────────────
   ⚠️ 尺寸按**可读性**定，不按实物：10~20m 外 8cm 粗只有 1~2px ⇒ 出图判读"手边没有草料"，
      所以整体做到约 0.3m 长、0.2m 粗才读得出。
   ⚠️⚠️ 2026-10-16 第三次返工（老黄："马夫手上拿的是草，怎么会是几节竹棍还把手夹在竹棍里面"）
      —— 前两版都是**把这个读数做反了**：
        第一版 9 根半径 0.017 的直管 + 居中硬圆柱束带 ⇒ 侧影"两根细杆 + 一个箍" = 竹夹；
        第二版把茎加到 14 根、半径 0.030、顶端放射到 2.6 倍 ⇒ 侧影变成**一把摊开的黄扇子**，
        而且捆心就落在手心里 ⇒ 手从草中间穿出来 = "手夹在竹棍里面"。
      根因两条，这次都从几何上解掉：
        ① "几节竹棍"——单根 0.030 半径是 **6cm 粗的棒**，14 根各自独立又都笔直 → 就是竹签。
           改成 **34 根半径 0.009~0.012**（真麦秆 2cm 上下）的**变速管**：根粗梢细、整体向 +z
           侧倾 ~20°，密密麻麻叠在一起 —— 密到一定程度，单根就不再被读成"一根杆"，
           而是一片**草束的质感**（这正是"一根夹"与"一把草"的区别）。
           ⚠️ 必须用 tubeRadiusRamp 做**锥形**：等径管哪怕再细，34 根也是 34 根棍子。
        ② "手夹在竹棍里"——捆的原点原来压在**手心里**。改成原点在**握点下方 0.13m**、
           草茎从握点上下各露一截（上短下长，像**倒提**一把草），
           捆的 AABB 上缘因此比手低 ⇒ 手是**握住草捆上端**，不再是穿在草中间。
           ⚠️ 顺带把簇的横向铺开从 0.40m 收到 **0.24m**：一把草不该比马头还宽。
   ⚠️ 全程只用私有流（mulberry32 固定种子）：这里若吃全局 rnd，全园布局会静默漂移（铁律 1）。 */
export const FEED_BALE = (() => {
  const pr = prRange(mulberry32(20261016));   // 私有流（区间映射，见上面的警告）
  const out = [];
  for (let i = 0; i < 56; i++){
    const a = (i / 56) * Math.PI * 2 + pr(-0.11, 0.11);
    /* ⚠️ 束口半径与顶端外扩倍数一起定"稠密还是稀疏"：第一版 34 根、外扩 3.4 倍
       ⇒ 出图判读"还是几根黄签子"，因为 34 根摊在 0.42m 直径上、彼此离得开。
       现在 56 根、外扩只给 2.4 倍（0.24m 直径）—— **密到重叠**才读得出"一把草"。 */
    const r = 0.008 + pr(0, 0.026) + (i % 4) * 0.005;
    const zTip = 0.085 + pr(0, 0.055);           // 茎长不齐，束口才毛糙（v4 收短：长茎=爪子）
    const zMid = zTip * 0.46;
    out.push({ a, r, rad: 0.011 + pr(0, 0.005), zTip, zMid,
               tilt: pr(-0.16, 0.16),                 // 逐根微偏，别像一把牙签
               y0: -0.062 - pr(0, 0.025) });          // 握点在上、根茬在下
  }
  return out;
})();
export function makeFeedBale(){
  const g = new THREE.Group();
  /* ⚠️ 56 根草茎**必须并成一个几何**：一根一个 mesh 就是 56 个 draw call，
     mergeStatics 又碰不到它们（整个捆挂着 noMerge，跟着马夫的手臂动）——
     一个小道具吃掉 36 个 draw call 是不该付的代价。并完只剩 2 个（草 + 束带）。 */
  const strands = [];
  for (const s of FEED_BALE){
    const ca = Math.cos(s.a), sa = Math.sin(s.a);
    const P = (r, z, y) => new THREE.Vector3(ca * r, y, sa * r + z);
    /* 起点在**竖直轴外**一点点（r 0.95 倍）—— 草是从手里往上往外张开的，不是从一根杆上插出来 */
    const c = new THREE.CatmullRomCurve3([
      P(s.r * 0.95, -0.030, s.y0),
      P(s.r,        0.010, -0.062 + s.tilt * 0.05),
      P(s.r * 1.55, s.zMid, 0.008 + s.tilt * 0.08),
      P(s.r * 1.50, s.zTip, 0.030 + s.tilt * 0.12),
    ]);
    const tg = new THREE.TubeGeometry(c, 6, s.rad, 5, false);
    {
      /* TubeGeometry uv.x 沿茎长（0 根 → 1 梢）：基部稻草色 → 梢头青草色 */
      const uvA = tg.attributes.uv, nn = tg.attributes.position.count;
      const carr = new Float32Array(nn * 3);
      const cA = new THREE.Color(0xC7B173), cB = new THREE.Color(0x8AA063), t2 = new THREE.Color();
      for (let vi = 0; vi < nn; vi++){
        const tt = uvA.getX(vi), k = Math.min(1, Math.max(0, (tt - 0.30) / 0.70));
        t2.copy(cA).lerp(cB, k * k);
        carr[vi * 3] = t2.r; carr[vi * 3 + 1] = t2.g; carr[vi * 3 + 2] = t2.b;
      }
      tg.setAttribute('color', new THREE.BufferAttribute(carr, 3));
    }
    strands.push(tg);
  }
  /* 手里这捆自带顶点色 ⇒ 不用 MAT.straw（一乘就 double tint 发暗） */
  const baleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95,
    metalness: 0.0, envMapIntensity: 0.30 });
  g.add(mesh(mergeGeometries(strands, false), baleMat, { name: 'feedStrands', cast: false }));
  /* 束带：麻绳两圈（束腰 + 略上收口），不再是"一个居中的硬箍" */
  const ties = [];
  for (const [y, r, h] of [[-0.038, 0.049, 0.020], [-0.012, 0.055, 0.017]]){
    const t = new THREE.CylinderGeometry(r, r, h, 10);
    t.translate(0, y, 0);
    ties.push(t);
  }
  g.add(mesh(mergeGeometries(ties, false), MAT.harness, { name: 'feedTie' }));
  return g;
}

/* ── 石槽（食槽 / 水槽共用）：上开口的石箱 ───────────────────────────────── */
export function makeTrough(w, d, h, mat = MAT.stoneDark, fillMat = null, fillY = 0.10){
  const g = new THREE.Group();
  const t = 0.09;
  const floor = mesh(box(w, t, d), mat, { name: 'troughFloor', cast: true });
  floor.position.set(0, t / 2, 0); g.add(floor);
  for (const sx of [-1, 1]){
    const s = mesh(box(t, h, d), mat, { name: 'troughWall', cast: true });
    s.position.set(sx * (w / 2 - t / 2), h / 2, 0); g.add(s);
  }
  for (const sz of [-1, 1]){
    const s = mesh(box(w, h, t), mat, { name: 'troughWallEnd', cast: true });
    s.position.set(0, h / 2, sz * (d / 2 - t / 2)); g.add(s);
  }
  const fill = mesh(box(w - t * 2, 0.05, d - t * 2), fillMat || MAT.straw, { name: 'troughFill', cast: false });
  fill.position.set(0, fillY, 0); g.add(fill);
  return g;
}

/* ── 院外石板路（上下马处 → 园子南门）────────────────────────────────────────
   老黄 2026-10-10："再铺设一条石板路从下马处（上马处）直接铺到院子的南门"。
   ⚠️ 为什么不是一块平板：院外是**草坡**（groundHeight 起伏量级 ±0.5m），平板必然一头
   悬空一头埋进地里 ⇒ 沿路线**逐点采样地形高**做成跟着坡走的带子。
   路线：院门（世界约 (40, 3) ）→ 向南**绕过东南墙角**（东墙 x=30 延伸到 z=22.5）
   → 再沿南墙外侧向西 → 接月洞门（南墙正中 x=0，外侧有 4×1.4m 门槛石）。
   ⚠️ 必须绕墙角：直着斜穿会在 z<22.5 的地方撞进东墙（墙在 x=30、厚 ±0.6）。
   ⚠️ 抬升 0.07：地形是解析式 groundHeight，而地面网格是按 1.9m 一格线性插值的，
   两者在起伏处差几厘米 ⇒ 抬 5cm 以下会有局部"路面被草吃进去"。 */
/* ── 院外石板路（上下马处 → 园子南门）· 2026-10-11 **重做**────────────────────
   老黄 2026-10-10："再铺设一条石板路从下马处（上马处）直接铺到院子的南门"
   老黄 2026-10-11："从马厩到院子的这条石块路**重做**，我不知道中国古代对这种路的设计讲究
   弯曲还是也要中规中矩，你查下资料再定形状的方案，然后石板路我给你一个参考图，
   你选一个适合我们项目的样式来设计细节"。

   ── 查资料得到的口径（决定了"形状"）─────────────────────────────────────────
     · 园林里的地面统称**铺地**；**中轴对称、方砖对缝**的那种叫**甬路**（多用在厅堂前的正道、
       寺观神道）——那是"中规中矩"的一路做法。
     · 而**园中小径**讲究**"曲径通幽"**（拙政园、留园的文字记载都在这句上）⇒ 走向要**弯**。
       对我们这条还好有两层好处：马车进出本来就要弧线，且它沿墙外草坡走，直线反而要削坡。
     · 做法上苏州园林最著名的两种：**花街铺地**（用卵石 + 碎瓦/缸片/碎瓷拼图案，瓦片勾线）与
       **乱石路**（不规则石块像石榴子一样铺砌，旧籍评"**既坚固又雅致**"）。
   ⇒ 老黄给的参考图里，我选**"不规则石板 + 卵石勾缝 + 两侧卵石镶边"**这一类（他图里第 6/9 张
     那种感觉）：石板块大小不一、错缝铺、缝里嵌小卵石、两边一条卵石镶边。理由：合"乱石路"
     的旧法；与园内已有的方砖对缝地面（07-ground 的 makePaving）**区分得开**；马车硬轮也吃得消。

   ── 实现（三层，都跟着地形走）───────────────────────────────────────────────
     ① **垫层**（勾缝底）：沿路线逐点采样地形高做一条深色窄带 —— 它保证石板之间露出来的是
        "深色的缝"而不是草。
     ② **石板**：两侧各自独立按"错缝"步进（左右接缝不齐 = 错缝），每块是**四角棱柱**
        （顶面在草皮 +0.075、底在 +0.015），四角逐点取地形高 ⇒ 整块跟着坡微倾；
        尺寸/转角/**色调**逐块抖动（色调走顶点色 ⇒ 一块块深浅不一，这正是乱石路的读感来源）。
     ③ **两侧卵石镶边**：沿两条边按 ~0.34m 一颗铺低模鹅卵石（压扁的球），同样逐颗抖动色调。
   ⚠️ 三条纪律：① **私有随机流**（mulberry32(20261012)，铁律 1：绝不碰全局 rnd/rr —— 本函数在
      马厩的 deferBootFirst 里跑，吃全局流会让其后所有按序抽样整体前移且不报错）；
      ② 石板/卵石都是**合并几何**而不是 InstancedMesh（新 InstancedMesh 会动 layout-fingerprint
      的网格计数、要重出基线；合并 Mesh 不进指纹）；
      ③ 石板材质开 **DoubleSide**：顶面按逆时针绕向是正的，但侧面那条绕向容易写反，
      DoubleSide 兜住（石板的底面本来就看不见）。
   ⚠️ 抬升 0.075：地形是解析式 groundHeight，而地面网格按 1.9m 一格线性插值，
   起伏处差几厘米 ⇒ 抬 5cm 以下会有局部"路面被草吃进去"。 */
/* 石板路控制点（世界 xz，马厩门口 → 月洞门外）。**导出**给 16-actors 的"客人到访"：
   人物沿这条路走，改路时人物自动跟着改，不用另抄一份坐标。 */
