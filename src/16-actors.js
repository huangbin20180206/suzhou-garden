// 16-actors: 把 AI 生成的半写实人物接进场景（2026-10-21 · P1）
//
// 设计取舍（与 15-stable 的马同一套）：
//   · 每个实例**单独 parse 一份 GLB**，不用 clone —— clone 会共享 Skeleton，
//     多个人物会共用一套骨（vendor 里也没有 SkeletonUtils）。
//   · 加载成功才隐藏程序化替身；失败/离线时替身照常站着，场景不空。
//   · 人物是静态站点角色，只做呼吸/转头的小动作；不烘焙动画。
//   · 动作只写骨骼四元数（以绑定姿态为基准），不改 mesh / 不改材质贴图。
//
// ⚠️ 这批模型是 UniRig 绑的，裙摆权重目前仍挂在腿上（走动会撕）；所以这一版
//    只接**站立**角色（晨读先生、井边仕女），走路/坐姿等 P2 补裙骨后再接。

import { THREE, GLTFLoader } from '../vendor.js';
import { scene, renderer } from './02-scene.js';
import { groundHeight } from './05-water.js';
import { markCasterBoxDirty } from './09-lights.js';
import { figures } from './08b-figures.js';
import { PROP_SPOTS } from './14-props.js';
import { HOOKS } from './00-config.js';

const ACTORS = [];
let _built = false;
let _t = 0;

const LADY_SPOT = PROP_SPOTS.ladyWell;
const LADY_YAW = Math.atan2(PROP_SPOTS.well.x - LADY_SPOT.x, PROP_SPOTS.well.z - LADY_SPOT.z);

const DEFS = [
  {
    id: 'scholar',
    url: 'assets/fig-scholar.glb',
    height: 1.72,
    hidePose: 'read',
    tint: 0xD9E1F0,          // 生成件偏亮蓝；压一点饱和，贴近场景的工笔淡彩
    spot: { x: 1.2, z: -5.7, yaw: 0.42 },
    /* armDown：生成件是 A 姿势（手臂抬 40°），站桩像展示人偶。
       实测 LeftUpperArm Y=+0.8 / RightUpperArm Y=-0.8 能把两臂放下来、手掌朝内。 */
    idle: { breath: 0.016, head: 0.055, sway: 0.007, phase: 0.0, armDown: 0.80 },
  },
  {
    id: 'lady',
    url: 'assets/fig-lady.glb',
    height: 1.63,
    hidePose: 'draw',
    tint: 0xE9DFF5,          // 生成件近白；乘成淡紫，和场景里的藕色/墨色分开
    spot: { x: LADY_SPOT.x, z: LADY_SPOT.z, yaw: LADY_YAW },
    idle: { breath: 0.013, head: 0.045, sway: 0.010, phase: 1.7 },
  },
];

function hideProcedural(poseName){
  const f = figures.find(x => x.userData && x.userData.poseName === poseName);
  if (!f) return;
  /* 11-loop 每帧按 slot 写 visible ⇒ 不能只写 visible=false。
     h0=99 让"时段门"永远不成立，替身就不会再被放出来。 */
  if (f.userData.slot) f.userData.slot.h0 = 99;
  f.visible = false;
  f.userData.replacedByGLB = true;
}

function tintMaterial(m, tint){
  if (!m) return;
  m.color = new THREE.Color(tint);
  m.roughness = 0.92;
  m.metalness = 0.0;
  m.envMapIntensity = 0.20;
  m.needsUpdate = true;
}

/* G6 接线：预载清单要求 src 里出现**字面 URL** 的 settleAsset 调用，
   写成 def.url 变量不算（probe/preload-manifest-sync 的正则只认字面量）。
   所以这里显式按 id 分派，别改成通用变量。 */
function settleActor(def, ok, err){
  if (def.id === 'scholar') HOOKS.settleAsset?.('assets/fig-scholar.glb', ok, err);
  else if (def.id === 'lady') HOOKS.settleAsset?.('assets/fig-lady.glb', ok, err);
}

function loadActor(def){
  const loader = new GLTFLoader();
  loader.load(def.url,
    (gltf) => {
      const inner = gltf.scene;
      const holder = new THREE.Group();
      holder.name = 'actor_' + def.id;
      holder.add(inner);

      /* 归一：按包围盒高缩到 def.height，水平居中，脚底 y=0 */
      let bb = new THREE.Box3().setFromObject(inner);
      const sz = bb.getSize(new THREE.Vector3());
      const sc = def.height / Math.max(1e-6, sz.y);
      inner.scale.setScalar(sc);
      inner.updateMatrixWorld(true);
      bb = new THREE.Box3().setFromObject(inner);
      inner.position.set(
        -(bb.min.x + bb.max.x) / 2,
        -bb.min.y,
        -(bb.min.z + bb.max.z) / 2,
      );
      holder.position.set(def.spot.x, groundHeight(def.spot.x, def.spot.z), def.spot.z);
      holder.rotation.y = def.spot.yaw;

      inner.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        o.userData.noMerge = true;         // 不进 mergeStatics
        if (Array.isArray(o.material)) o.material.forEach(m => tintMaterial(m, def.tint));
        else tintMaterial(o.material, def.tint);
      });

      const bones = {};
      inner.traverse((o) => { if (o.isBone) bones[o.name] = o; });
      const base = {};
      for (const n of ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
                       'LeftUpperArm', 'RightUpperArm', 'LeftLowerArm', 'RightLowerArm']){
        if (bones[n]) base[n] = bones[n].quaternion.clone();
      }

      scene.add(holder);
      hideProcedural(def.hidePose);
      ACTORS.push({ def, holder, bones, base, phase: def.idle.phase });
      markCasterBoxDirty();
      renderer.shadowMap.needsUpdate = true;   // 静态阴影图补一次，人物有影子
      settleActor(def, true);
      console.log('[actor] 已接入 ' + def.id);
    },
    (e) => { if (e && e.total) HOOKS.reportAssetProgress?.(def.url, e.loaded, e.total); },
    (err) => {
      /* 失败不抛：程序化人物继续用 */
      settleActor(def, false, err);
      console.warn('[actor] ' + def.id + ' 加载失败，保留程序化替身：', err && err.message);
    });
}

/* 只在启动时调一次（08-assemble 在建完人物之后调） */
export function buildActors(){
  if (_built) return;
  _built = true;
  for (const def of DEFS) loadActor(def);
}

/* 每帧：呼吸 + 缓慢转头/重心。只写骨骼，不碰 root 的 position/rotation。 */
export function tickActors(dt){
  if (!ACTORS.length) return;
  _t += Math.min(Math.max(dt, 0), 0.1);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const a of ACTORS){
    const p = a.phase;
    const b = Math.sin(_t * 1.05 + p);
    const h = Math.sin(_t * 0.31 + p * 1.7);
    const set = (name, x, y, z) => {
      const bone = a.bones[name], rest = a.base[name];
      if (!bone || !rest) return;
      e.set(x, y, z, 'XYZ');
      q.setFromEuler(e);
      bone.quaternion.copy(rest).multiply(q);
    };
    /* A 姿势 → 自然垂手（实测左 +Y / 右 -Y）。只对文士生效，仕女本来就是垂手。 */
    const ad = a.def.idle.armDown || 0;
    if (ad > 0.001){
      set('LeftUpperArm', 0.03 * b, ad, 0);
      set('RightUpperArm', 0.03 * b, -ad, 0);
    }
    set('Chest', a.def.idle.breath * b, 0, a.def.idle.sway * Math.sin(_t * 0.7 + p));
    set('Spine', a.def.idle.breath * 0.5 * b, 0, 0);
    set('Head', 0.012 * Math.sin(_t * 0.5 + p), a.def.idle.head * h, 0);
    set('Neck', 0.008 * Math.sin(_t * 0.5 + p + 0.7), 0.4 * a.def.idle.head * h, 0);
  }
}

export function actorState(){
  return {
    n: ACTORS.length,
    actors: ACTORS.map(a => ({
      id: a.def.id,
      pos: a.holder.position.toArray().map(v => +v.toFixed(3)),
      yaw: +a.holder.rotation.y.toFixed(3),
      bones: Object.keys(a.bones).length,
    })),
  };
}
