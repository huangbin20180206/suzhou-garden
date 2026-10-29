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

/* ── 石板路抬升（2026-10-26 ① 轮陷）────────────────────────────────────────────
   石板顶在 groundHeight+0.075（15e-stable 的 slab +0.075/bed +0.045），而车轮底 = car.y
  （轮心 0.55 - 半径 0.55），旧版用裸 groundHeight ⇒ 轮底比路面低 7.5cm，在近景读作"陷进去"。
   解法：给车心 y 加 0.075，但**只在石板路上**（ yard 仍是裸地，抬了会浮）。判别按到两条
   石板中线的距离（HW 0.86 + 0.19 轮缘）。
   ⚠️ 2026-10-27 复核 B2：点表改为直接 import 15a-shared 的单份真值 ——
      原来手抄的 _ROAD_A/_ROAD_B 与 15e 的定义互不同步，改一处忘一处马车就浮空/陷地。 */
import { STABLE_ROAD_PTS, STABLE_EXIT_PTS } from './15a-shared.js';
function _onStoneRoad(x,z){
  const ck = (pts)=>{ for(let i=0;i<pts.length-1;i++){ const ax=pts[i][0],az=pts[i][1],bx=pts[i+1][0],bz=pts[i+1][1]; const dx=bx-ax,dz=bz-az; const l2=dx*dx+dz*dz||1; const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2)); const cx=ax+dx*t,cz=az+dz*t; if(Math.hypot(x-cx,z-cz)<1.05) return true; } return false; };
  return ck(STABLE_ROAD_PTS)||ck(STABLE_EXIT_PTS);
}
function _roadY(x,z){ return groundHeight(x,z) + (_onStoneRoad(x,z) ? 0.075 : 0); }
export const _travV = new THREE.Vector3();
/* 把车 + 两匹辕马摆到世界 (x,z)、朝向 yaw；dist = 累计里程（驱动车轮与四腿相位）。
   返回车心落地的世界坐标，供人物"坐在车上"用（不再让调用方另算一遍）。 */
export function travelCarriagePlace(x, z, yaw, dist){
  const V = TRAVEL;
  if (!V.ready) return null;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const gL = _roadY(x - rx * 0.62, z - rz * 0.62);
  const gR = _roadY(x + rx * 0.62, z + rz * 0.62);
  const gF = _roadY(x + fx * 0.80, z + fz * 0.80);
  const gB = _roadY(x - fx * 0.80, z - fz * 0.80);
  const y = (gL + gR) / 2;
  const car = V.car;
  car.position.copy(V.group.worldToLocal(_travV.set(x, y, z)));
  car.rotation.order = 'YXZ';
  // 车头 +z 沿行进方向；pitch 让车随坡抬头/低头，roll 让两轮同时落地（与 seatCart 同一口径）
  car.rotation.set(-Math.atan2(gF - gB, 1.6), yaw - V.stableYaw, (gR - gL) / 1.24);
  for (const w of V.wheels) w.rotation.z = dist / V.wheelR;
  for (const s of V.slots){
    const ox = s.travelOff ? s.travelOff.x : 0;
    const oz = s.travelOff ? s.travelOff.z : 1.93;   // 无 travelOff 的兜底：与 15e 的槽位同一口径（2026-10-27 统一）
    const hx = x + ox * Math.cos(yaw) + oz * Math.sin(yaw);
    const hz = z - ox * Math.sin(yaw) + oz * Math.cos(yaw);
    /* ⚠️⚠️ 2026-10-27 修（老黄"马四肢底部有明显拖影/重影"）：这里原来写的是裸
       `groundHeight`，而车心走的是 `_roadY`（石板路上 +0.075）⇒ **辕马比车低 7.5cm**，
       踏上石板路后四蹄整段埋进石板里、蹄底与路面反复穿插，远看就是"腿底下有重影"；
       顺带贴地软影（槽位组局部 +0.09）也跟着沉到路面下 1.5cm，影子被石板切掉一半。
       改成与车同一口径（`_roadY`）——院子外的土面它自己就等于 groundHeight，无副作用。 */
    const hy = _roadY(hx, hz);
    s.group.position.copy(V.group.worldToLocal(_travV.set(hx, hy, hz)));
    s.group.rotation.y = yaw - V.stableYaw;
    const L = s.life;
    if (L){
      L.driving = true;
      /* 停车姿态（2026-10-30 第 0 周热修，老黄"辕马停车改回站姿"）：
         这里原来无条件 gaitW=1、按**里程**写 trot 腿相位 —— 车一停 dist 不再变，
         四条腿就冻在半步姿势上（driving 又挡住 updateHorseGait 接管），读作"雕塑马"。
         现在：车动 ⇒ trot 照旧；车停 ⇒ gaitW 缓落到 0、腿回绑定站姿（gaitLegs=null）。
         grazeW 恒 0：套着辕的马不低头吃草（那是院里散养马的事）。
         缓落系数按调用次数给（place 每帧一次，0.12 ≈ 半秒收稳），起步反向缓起不跳变。 */
      const moving = V._lastDist !== undefined && Math.abs(dist - V._lastDist) > 1e-4;
      L.gaitW += ((moving ? 1 : 0) - L.gaitW) * 0.12;
      L.grazeW = 0;
      if (L.gaitW > 0.003){
        // ⑥ 马腿核验：拉车为**快步（trot）**，对角两拍（FL+HR / FR+HL），速度 1.1~2.6 与 trot 的 1.85m/s 匹配；
        // 旧版用 walk（四拍 0/0.25/0.5/0.75，摆幅 0.28）读作"散步拉车"，步频也对不上车速。
        const stride = 1.24; // HORSE_GAIT.trot.stride（走 trot 时的真实步幅）
        const ph = ((dist / stride) + (s.travelPh || 0)) % 1;
        L.gaitLegs = gaitPose('trot', ph < 0 ? ph + 1 : ph);
        L.gaitBob = Math.sin(ph * Math.PI * 4) * 0.024;
      } else {
        L.gaitLegs = null; L.gaitBob = 0;    // 站姿
      }
    }
  }
  V._lastDist = dist;
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

/* ── 参考图外观材质（2026-10-27）────────────────────────────────────────────
   用户给了参考图：红板壁 + 金框、上排大窗带菱形窗棂、米黄桶篷 + 青绿下沿、
   实心金边圆轮。这里新增 5 个外观材质（只在车厢上用，不碰 MAT 全局表）。 */
const CAR = {
  red:   new THREE.MeshStandardMaterial({ color: 0x9E2B22, roughness: 0.82, metalness: 0.02 }),
  gold:  new THREE.MeshStandardMaterial({ color: 0xC08A3E, roughness: 0.55, metalness: 0.28 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xE7D3A2, roughness: 0.80, metalness: 0.0, side: THREE.DoubleSide }),
  teal:  new THREE.MeshStandardMaterial({ color: 0x3E6C76, roughness: 0.80, metalness: 0.0, side: THREE.DoubleSide }),
  grey:  new THREE.MeshStandardMaterial({ color: 0x6E7C84, roughness: 0.90, metalness: 0.0 }),
  dark:  MAT.woodDark,
};
/* 窗棂贴图（菱形格）：透明底 + 米色斜线；只建一次，两个车厢共用。 */
let _latticeMat = null;
function latticeMat(){
  if (_latticeMat) return _latticeMat;
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(238,224,186,0.95)'; ctx.lineWidth = 3;
  for (let i = -S; i <= S; i += 18){
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, S); ctx.lineTo(i + S, 0); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _latticeMat = new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide,
    roughness: 0.85, depthWrite: false });
  return _latticeMat;
}
/* 桶形篷面：沿 x 的半椭圆拱、沿 z 拉长。θ 从 0（右檐）到 π（左檐），y 相对檐口。 */
function archSurface(rx, ry, len, zc, th0, th1, segs){
  const pos = [], idx = [];
  const z0 = zc - len / 2, z1 = zc + len / 2;
  for (let i = 0; i <= segs; i++){
    const t = th0 + (th1 - th0) * i / segs;
    const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    pos.push(x, y, z0, x, y, z1);
  }
  for (let i = 0; i < segs; i++){ const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  gg.setIndex(idx); gg.computeVertexNormals();
  return gg;
}
/* 拱形端脸（半椭圆三角扇，朝 +z；后脸旋转 π 朝后）。 */
function archCap(rx, ry, segs){
  const pos = [0, 0, 0], idx = [];
  for (let i = 0; i <= segs; i++){
    const t = Math.PI * i / segs;
    pos.push(Math.cos(t) * rx, Math.sin(t) * ry, 0);
  }
  for (let i = 1; i <= segs; i++) idx.push(0, i, i + 1);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  gg.setIndex(idx); gg.computeVertexNormals();
  return gg;
}

export function makeCarriage(opts = {}){
  const g = new THREE.Group();
  const wood = MAT.woodDark, strap = MAT.harness;
  const detached = !!opts.detached;
  const wheel = (sx, z) => {
    /* 参考图那种实心圆轮：深色轮盘 + 金边 + 红辐条 + 金毂 + 一圈铆钉 */
    const w = new THREE.Group();
    const disc = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 28), CAR.dark, { name: 'wheelDisc', cast: true });
    disc.rotation.x = Math.PI / 2; w.add(disc);
    /* 红辐条与金铆钉必须落在**轮盘外表面**（z ±0.033）——之前放在 z=0 被 6cm 厚的
       轮盘整个吞掉，出图只剩一块光板（参考图是有红辐 + 金钉的）。 */
    for (let i = 0; i < 10; i++){
      const a = (i / 10) * Math.PI * 2;
      for (const zf of [-1, 1]){
        const sp = mesh(box(0.05, 0.46, 0.018), CAR.red, { name: 'wheelSpoke', cast: false });
        sp.position.set(-Math.sin(a) * 0.24, Math.cos(a) * 0.24, zf * 0.033);
        sp.rotation.z = -a;
        w.add(sp);
      }
    }
    const hub = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.11, 16), CAR.gold, { name: 'wheelHub' });
    hub.rotation.x = Math.PI / 2; w.add(hub);
    for (let i = 0; i < 10; i++){
      const a = (i / 10) * Math.PI * 2 + 0.15;
      for (const zf of [-1, 1]){
        const riv = mesh(new THREE.SphereGeometry(0.022, 8, 6), CAR.gold, { name: 'wheelRivet', cast: false });
        riv.position.set(Math.cos(a) * 0.505, Math.sin(a) * 0.505, zf * 0.034);
        w.add(riv);
      }
    }
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
  /* ── 中式厢式车厢（2026-10-27 按用户参考图重做外观）────────────────────────────
     参考图：红板壁 + 金框、侧面上排 4 个大窗（金框 + 菱形窗棂）、半桶形篷顶
     （米黄篷面 + 青绿下沿 + 金边铆钉 + 两端朱红拱脸）、实心金边红辐圆轮。
     ⚠️ 与到访导演层绑死的尺寸**一个不动**：bench 顶 1.10、车夫座顶 1.17、
        车轮 R 0.55、CAB_W 1.38、CAB_L 1.62（CARRY.seat/coach 与里程都按它们算）。
     ⚠️ 篷内净高：墙顶 bedY+WALL_H = 1.82，篷顶 1.82+0.50 = 2.32（局部）；
        客人发髻局部 2.07 ⇒ 留 25cm。改墙高/座位/篷半径必须回量"发髻 vs 篷顶"。 */
  const bedY = 0.72;
  const CAB_W = 1.38, CAB_L = 1.62, WALL_H = 1.10;
  const HALF_W = CAB_W / 2, SIDE_X = CAB_W / 2 - 0.04, SIDE_LEN = CAB_L - 0.07, CZ = -0.06;
  const Y_TOP = bedY + WALL_H;                 // 1.82
  const BAND_Y0 = bedY + 0.58, BAND_Y1 = bedY + 1.00;   // 窗带 1.30~1.72
  const bed = mesh(box(CAB_W, 0.09, CAB_L), CAR.dark, { name: 'carriageBed', cast: true });
  bed.position.set(0, bedY, CZ); g.add(bed);

  /* 侧壁：下金裙 + 红板 + 窗带（4 窗 3 柱）+ 上红板 */
  const bayW = (SIDE_LEN - 3 * 0.05) / 4;
  const bayZ = [-0.66, -0.26, 0.14, 0.54];
  const mullZ = [-0.46, -0.06, 0.34];
  for (const sx of [-1, 1]){
    const x = sx * SIDE_X;
    const skirt = mesh(box(0.075, 0.075, SIDE_LEN), CAR.gold, { name: 'carriageSkirt', cast: false });
    skirt.position.set(x, bedY + 0.0825, CZ); g.add(skirt);
    const low = mesh(box(0.07, 0.44, SIDE_LEN), CAR.red, { name: 'carriageSideLow' });
    low.position.set(x, bedY + 0.3375, CZ); g.add(low);
    const topH = Y_TOP - (BAND_Y1 + 0.025);
    const top = mesh(box(0.07, topH, SIDE_LEN), CAR.red, { name: 'carriageSideTop' });
    top.position.set(x, (BAND_Y1 + 0.025 + Y_TOP) / 2, CZ); g.add(top);
    for (const yy of [BAND_Y0, BAND_Y1]){
      const rail = mesh(box(0.085, 0.05, SIDE_LEN), CAR.gold, { name: 'carriageWinRail', cast: false });
      rail.position.set(x, yy, CZ); g.add(rail);
    }
    for (const mz of mullZ){
      const m = mesh(box(0.085, BAND_Y1 - BAND_Y0, 0.05), CAR.gold, { name: 'carriageWinMull', cast: false });
      m.position.set(x, (BAND_Y0 + BAND_Y1) / 2, mz); g.add(m);
    }
    /* 窗内衬（红）——窗棂后是暗红内壁，读作车厢内部 */
    const inner = mesh(box(0.03, BAND_Y1 - BAND_Y0 - 0.02, SIDE_LEN - 0.02), CAR.red, { name: 'carriageWinInner', cast: false });
    inner.position.set(x - sx * 0.028, (BAND_Y0 + BAND_Y1) / 2, CZ); g.add(inner);
    /* 4 扇菱形窗棂 */
    for (const bz of bayZ){
      const lat = mesh(new THREE.PlaneGeometry(bayW - 0.02, BAND_Y1 - BAND_Y0 - 0.06), latticeMat(),
        { name: 'carriageLattice', cast: false });
      lat.position.set(x + sx * 0.006, (BAND_Y0 + BAND_Y1) / 2, bz);
      lat.rotation.y = sx * Math.PI / 2;
      g.add(lat);
    }
  }
  /* 四角金柱 */
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){
    const post = mesh(box(0.09, WALL_H, 0.09), CAR.gold, { name: 'carriageCorner', cast: true });
    post.position.set(sx * (HALF_W - 0.045), bedY + WALL_H / 2, CZ + sz * (CAB_L / 2 - 0.045));
    g.add(post);
  }
  /* 后壁：红板 + 两道金线（不再外露榫头）
     ⚠️⚠️ 2026-10-27 修"停稳后背部一片闪光"（老黄截图 1）：后壁厚 0.06、中心在
     CZ−CAB_L/2+0.03 ⇒ **背面恰好在 z=−0.870**，而四角金柱的盒子（0.09 深、中心
     CZ±(CAB_L/2−0.045)，即 −0.825）**背面也是 −0.870** ⇒ 两块面片完全共面，
     深度测试逐像素打架，画面上就是一条金红交错的雪花带（相机一动就闪）。
     做法：红板整体前移 0.014（背面 −0.856，比柱子内收 14mm，读作"芯板退在框内"），
     金线压到 −0.869（在柱面 −0.870 之前 1mm，不再共面），并把金线宽度从 1.32 收到
     1.14（x ±0.57）—— 柱子在 x 0.60~0.69，两者连 x 方向也不再重叠。 */
  const back = mesh(box(CAB_W - 0.02, WALL_H - 0.02, 0.06), CAR.red, { name: 'carriageBack', cast: true });
  back.position.set(0, bedY + WALL_H / 2, CZ - CAB_L / 2 + 0.044); g.add(back);
  for (const yy of [bedY + 0.30, bedY + 0.86]){
    const bar = mesh(box(CAB_W - 0.24, 0.035, 0.018), CAR.gold, { name: 'carriageBackTrim', cast: false });
    bar.position.set(0, yy, CZ - CAB_L / 2 + 0.010); g.add(bar);
  }
  /* 前口：两柱 + 金横梁 + 两幅前帘 */
  for (const sx of [-1, 1]){
    const post = mesh(box(0.08, WALL_H, 0.08), CAR.gold, { name: 'carriageFrontPost', cast: true });
    post.position.set(sx * (HALF_W - 0.04), bedY + WALL_H / 2, CZ + CAB_L / 2 - 0.035); g.add(post);
  }
  const frontBeam = mesh(box(CAB_W, 0.10, 0.08), CAR.gold, { name: 'carriageFrontBeam', cast: true });
  frontBeam.position.set(0, Y_TOP - 0.05, CZ + CAB_L / 2 - 0.035); g.add(frontBeam);
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x7A2E2A, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  const curH = WALL_H - 0.14, curY = bedY + 0.10 + curH / 2;
  for (const sx of [-1, 1]){
    const curtain = mesh(box(0.58, curH, 0.015), curtainMat, { name: 'carriageCurtain', cast: false });
    curtain.position.set(sx * 0.32, curY, CZ + CAB_L / 2 - 0.02);
    g.add(curtain);
  }
  /* ── 桶形篷顶（参考图的核心）：米黄篷面 + 青绿下沿 + 金檐 + 两端朱红拱脸 ── */
  const RX = HALF_W + 0.02, RY = 0.50, ROOF_L = CAB_L + 0.12;
  const canopy = mesh(archSurface(RX, RY, ROOF_L, CZ, 0, Math.PI, 16), CAR.cream, { name: 'carriageCanopy', cast: true });
  canopy.position.y = Y_TOP; g.add(canopy);
  for (const [t0, t1] of [[0, 0.34], [Math.PI - 0.34, Math.PI]]){
    const band = mesh(archSurface(RX + 0.015, RY + 0.015, ROOF_L, CZ, t0, t1, 4), CAR.teal, { name: 'carriageCanopyBand', cast: false });
    band.position.y = Y_TOP; g.add(band);
  }
  for (const sz of [-1, 1]){
    const zEnd = CZ + sz * (ROOF_L / 2);
    const cap = mesh(archCap(RX, RY, 16), CAR.red, { name: 'carriageCanopyFace', cast: true });
    cap.position.set(0, Y_TOP, zEnd); if (sz < 0) cap.rotation.y = Math.PI; g.add(cap);
    const pts = [];
    for (let i = 0; i <= 16; i++){ const t = Math.PI * i / 16; pts.push(new THREE.Vector3(Math.cos(t) * RX, Y_TOP + Math.sin(t) * RY, zEnd)); }
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.026, 5, false),
      CAR.gold, { name: 'carriageCanopyRim', cast: false }));
  }
  /* 檐口金线 + 铆钉 */
  for (const sx of [-1, 1]){
    const eave = mesh(box(0.05, 0.05, ROOF_L), CAR.gold, { name: 'carriageEave', cast: false });
    eave.position.set(sx * RX, Y_TOP + 0.02, CZ); g.add(eave);
    for (let i = 0; i < 8; i++){
      const riv = mesh(new THREE.SphereGeometry(0.022, 8, 6), CAR.gold, { name: 'carriageRivet', cast: false });
      riv.position.set(sx * RX * 0.993, Y_TOP + 0.06, CZ - ROOF_L / 2 + 0.10 + i * (ROOF_L - 0.20) / 7);
      g.add(riv);
    }
  }
  /* 车夫座垫（参考图前部那块灰蓝布）：平垫 + 前缘一卷 */
  {
    const pad = mesh(box(0.96, 0.07, 0.34), CAR.grey, { name: 'carriageSeatPad', cast: true });
    pad.position.set(0, bedY + 0.455, CZ + CAB_L / 2 + 0.18); g.add(pad);
    const lip = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.96, 10), CAR.grey, { name: 'carriageSeatLip', cast: true });
    lip.rotation.z = Math.PI / 2;
    lip.position.set(0, bedY + 0.445, CZ + CAB_L / 2 + 0.36); g.add(lip);
  }
  // 厢内座位：靠后壁的横向木座（供客人坐），高 0.38，坐面进深 0.40
  const bench = mesh(box(CAB_W - 0.14, 0.38, 0.42), MAT.wood, { name: 'carriageBench', cast: true });
  bench.position.set(0, bedY + 0.19, -0.06 - CAB_L/2 + 0.28); g.add(bench);
  // 车夫木座（④）：前沿横板 + 两条立柱直抵地面 + 脚踏板，够坐一人，马夫脚不悬空
  const driverSeat = mesh(box(1.02, 0.06, 0.34), MAT.woodDark, { name: 'carriageDriverSeat', cast: true });
  driverSeat.position.set(0, bedY + 0.42, -0.06 + CAB_L/2 + 0.18); g.add(driverSeat);
  for (const sx of [-1, 1]){
    const leg = mesh(box(0.07, bedY + 0.42, 0.07), MAT.woodDark, { name: 'carriageDriverLeg', cast: true });
    leg.position.set(sx * 0.45, (bedY + 0.42) / 2, -0.06 + CAB_L/2 + 0.28); g.add(leg);
  }
  const footBoard = mesh(box(1.02, 0.04, 0.20), MAT.wood, { name: 'carriageFootBoard', cast: true });
  footBoard.position.set(0, 0.18, -0.06 + CAB_L/2 + 0.32); g.add(footBoard);
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
      // 牵挽带（trace）：从项圈下沿拉回厢侧，承重可视，15m 外读作"套着"的实线
      const trace = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 0.40, yokeY - 0.18, 1.18),
        new THREE.Vector3(sx * 0.48, bedY + 0.28, 0.70),
        new THREE.Vector3(sx * 0.52, bedY + 0.22, 0.28),
      ]);
      g.add(mesh(new THREE.TubeGeometry(trace, 6, 0.018, 4, false), strap, { name: 'yokeTrace', cast: false }));
    }
    /* ── 缰绳（2026-10-14 提出、2026-10-27 定案）────────────────────────────────
       2026-10-14 版按"马在车局部 −z"画了口络/颊带/缰绳，2026-10-27 用户报"车后面的木条
       还在、越来越多"——实测两组辕马的马心在**车局部 +z**：parked 时 z≈1.45、
       行驶时 z≈2.15，鼻端 z≈2.5/3.2。画在 −z 的管子从车厢后壁探出一排 50cm 细杆，
       还从车厢里穿过去，正是那排"木条"。
       现在只保留 **+z 侧的缰绳**：马鼻端 → 马颈外侧 → 车夫手部（z≈1.15）。
       半径 0.012（皮带量级）；与既有 strap(MAT.harness) 同材质，不引入新资产。 */
    /* ⚠️⚠️ 2026-10-29 老黄："马的缰绳不对，一匹马应该是两根（或者是一根，以马头为中点
       对折、马身两侧各一，然后两头汇总到马夫手上）"。
       旧版每匹马只有**一根**、起点在马身中线（x=±0.40）—— 那是马的**体内**（实测头部
       在该 z 的横向跨度是 ±0.20），所以缰绳从马脸里长出来，画面上就是"两根棍子"。
       现在每匹马 **两根**：口角（左右各一）→ 沿颈侧 → 沿马身两侧 → 在马尾之后合到
       车夫同侧的手里（= 一根缰绳在马头对折，两端都在手上）。
       控制点的横向偏移**按实测剖面**给（outputs/_diag/meas-2026-10-29）：车局部 z 切片上
       马身最宽处的半宽 0.10~0.295，缰绳取"半宽 + 0.035" ⇒ 全程贴在马身外侧、不插进肉里。
       ⚠️ 马尾巴在 z≈1.02（身后就没有马体了），所以**先绕到马尾之后（z 0.90）再往里收**，
          否则从外侧收到手心的那一段会横穿马臀（实测 x 0.70→0.24 在 z 1.0 处正好穿过）。 */
    const HORSE_X = 0.40;                       // 两匹马横向（与辕距对齐）
    /* [车局部 z, 该处马身半宽实测值, 缰绳高度 y] —— 由马体顶点剖面给出，别手填 */
    const REIN_PATH = [
      [3.03, 0.20, 1.05],    // 口角（马嘴两侧；该 z 上头部半宽 0.20）
      [2.86, 0.18, 1.22],    // 颊
      [2.60, 0.20, 1.34],    // 颈侧
      [2.25, 0.28, 1.34],    // 肩/鬐甲外缘
      [1.80, 0.295, 1.30],   // 胸廓最宽处
      [1.35, 0.28, 1.32],    // 腹侧
      [1.02, 0.23, 1.34],    // 臀（马尾之外）
    ];
    const HAND = { x: 0.24, y: 1.36, z: 0.80 };  // 车夫坐姿下的手（实测 z 0.64~0.88 / y 1.34~1.36 / x ±0.24）
    for (const sx of [-1, 1]){
      for (const side of [-1, 1]){
        const pts = REIN_PATH.map(([z, half, y]) =>
          new THREE.Vector3(sx * HORSE_X + side * (half + 0.035), y, z));
        /* 马尾之后再往里收：z 0.90 处仍贴着马身外侧，然后才斜向手心 */
        pts.push(new THREE.Vector3(sx * HORSE_X + side * (0.23 + 0.045), 1.35, 0.90));
        pts.push(new THREE.Vector3(sx * HAND.x, HAND.y, HAND.z));
        const rein = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25);
        g.add(mesh(new THREE.TubeGeometry(rein, 26, 0.0105, 4, false), strap,
          { name: 'bridleRein', cast: false }));
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
