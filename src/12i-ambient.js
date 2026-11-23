// 12i-ambient: 环境小品 · 夜萤火虫 + 飘落花瓣/秋叶 —— 2026-11-23 从 12-env 拆出单立（纯新建，原 12-env 无此块）。
/* 为什么单独一个文件：这两套是"有生命感"的环境粒子（萤火虫夜飞、花瓣季落），
   与 12e 的天气粒子（雨/雪）是两件事：门控走**季节/夜色**通道而非天气量，
   萤火虫是**定点生物**（绕家域游荡，不跟相机），花瓣是**相机跟随体积**（与雨雪同口径）。
   ⚠️ 本文件**不能** import './12-env.js'（12-env 反过来 import 本文件 → 成环，见 12e 文件头）。
   环境状态机由 12-env 在 body 里调 bindAmbientEnv(ENV) 注入；读的是 .cur（setEnv 会换引用，别缓存 cur）。
   ⚠️ 随机数用独立 mulberry32 种子流 —— 不许碰 06a 全局共享流（铁律 1：布局可复现）。 */
import { THREE } from '../vendor.js';
import { scene, camera } from './02-scene.js';
import { mulberry32 } from './00-config.js';
import { PRECIP_INDOOR } from './12e-precip.js';

/* ↓ 由 12-env.js 注入（见文件头） */
let ENV = null;
export function bindAmbientEnv(env){ ENV = env; }

/* ══ 萤火虫（夜 · 暖季 · 池岸与花木区）══════════════════════════════════
   定点生物：N 个家域点（池岸环 + 花木簇），每帧在家域附近 1~2m 内缓慢游荡；
   闪烁在 shader 里按 uTime 算（CPU 只推位置，blink 零成本）。
   门控三连乘：夜色深 × 暖季 × 无雨雪（雨夜萤火虫不出飞）—— 任一不满足直接 visible=false
   并跳过 CPU 推进（零成本 return，与 updatePrecip 同款早退）。 */
const FIREFLY_N = 110;
const SEASON_FLY = { spring: 0.55, summer: 1.0, autumn: 0.15, winter: 0.0 };  // 夏夜最盛，冬无
const FIREFLY = (()=>{
  const rngF = mulberry32(0xF1E51);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(FIREFLY_N * 3);
  const home = new Float32Array(FIREFLY_N * 3);
  const phase = new Float32Array(FIREFLY_N);
  const size = new Float32Array(FIREFLY_N);
  for (let i = 0; i < FIREFLY_N; i++){
    let x, z;
    if (rngF() < 0.7){
      /* 池岸环：池椭圆 x/15.7、(z-3.0)/9.4（口径与走模式 pond 一致），家域落在水外 1~5m 的岸上 */
      const a = rngF() * Math.PI * 2;
      const k = 1.08 + rngF() * 0.32;
      x = Math.cos(a) * 15.7 * k; z = 3.0 + Math.sin(a) * 9.4 * k;
    } else {
      /* 花木簇：桂花树 (23.5,17) 与桃林带附近各撒一半 */
      const cx = rngF() < 0.5 ? 23.5 : -14.0, cz = rngF() < 0.5 ? 17.0 : 14.0;
      x = cx + (rngF() * 2 - 1) * 6; z = cz + (rngF() * 2 - 1) * 6;
    }
    home[i*3] = x; home[i*3+1] = 0.8 + rngF() * 1.6; home[i*3+2] = z;
    phase[i] = rngF(); size[i] = 5.0 + rngF() * 4.0;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 },
                uColor: { value: new THREE.Color(0xC4FF7A) } },  // 萤黄绿（偏黄一档，月夜里不至于发青）
    vertexShader: `attribute float aPhase; attribute float aSize;
      uniform float uTime; uniform float uIntensity;
      varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 1.0);
        /* 闪烁：慢亮灭 × 快呼吸，平方后占空比更像真萤（亮-暗分明，不断续） */
        float tw = 0.5 + 0.5 * sin(uTime * 2.1 + aPhase * 6.2831);
        tw *= 0.65 + 0.35 * sin(uTime * 6.7 + aPhase * 17.0);
        /* 近距淡出（口径与降水一致：飞到镜头前不糊脸） */
        vA = uIntensity * tw * tw * smoothstep(1.2, 3.2, dist);
        gl_PointSize = clamp(aSize * (30.0 / dist), 1.5, 9.0);
      }`,
    fragmentShader: `varying float vA; uniform vec3 uColor;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float a = exp(-dot(d, d) * 18.0) * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.visible = false; points.renderOrder = 21;
  return { points, home, phase, n: FIREFLY_N };
})();
scene.add(FIREFLY.points);

/* ══ 飘落（春花瓣 · 秋叶，同套粒子、颜色按季切）════════════════════════
   相机跟随体积（与雨雪同口径：相机位移整体加到粒子上，瞬移机位不留空白）。
   门控：春 = peachPetalShow（桃红粉），秋 = 固定 0.8（金黄，ENV.season==='autumn'），
   取大者；两者皆零 ⇒ visible=false 早退。颜色按两季权重插值（过渡旬里粉黄渐变）。 */
const PETAL_N = 260;
const PETALS = (()=>{
  const geo = new THREE.BufferGeometry();
  const a = new Float32Array(PETAL_N * 3);
  const vr = new Float32Array(PETAL_N), sp = new Float32Array(PETAL_N);
  const rngP = mulberry32(0x9E7A1);
  for (let i = 0; i < PETAL_N; i++){ vr[i] = 0.6 + rngP() * 0.8; sp[i] = 0.6 + rngP() * 0.9; }
  geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
  geo.setAttribute('aVariation', new THREE.BufferAttribute(vr, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.NormalBlending,
    uniforms: { uIntensity: { value: 0 },
                uPink: { value: new THREE.Color(0xF2C2D2) },   // 春：桃粉（与 tinLotus 同系）
                uGold: { value: new THREE.Color(0xDFAF62) },   // 秋：落叶金（与秋 tinWillow 同系）
                uMix: { value: 0 } },
    vertexShader: `attribute float aVariation; attribute float aSpeed;
      uniform float uIntensity;
      varying float vAlpha;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 1.0);
        /* 近距淡出（雪同口径 2.6→7：花瓣比雪小，2.0→5 就够） */
        vAlpha = uIntensity * smoothstep(2.0, 5.0, dist);
        gl_PointSize = clamp(8.0 * aVariation * (26.0 / dist), 2.0, 9.0);
      }`,
    fragmentShader: `varying float vAlpha;
      uniform vec3 uPink; uniform vec3 uGold; uniform float uMix;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        /* 花瓣形：横向椭圆（x 收紧比 y 快），不是圆点也不是雪团 */
        float r = length(vec2(d.x * 1.7, d.y));
        float a = exp(-r * r * 14.0) * smoothstep(0.5, 0.32, r) * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uPink, uGold, uMix), a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.visible = false; points.renderOrder = 20;
  return { points, arr: a, n: PETAL_N, spread: 30, seeded: false };
})();
scene.add(PETALS.points);
let _prevCamX = null, _prevCamZ = null;

const clamp01 = v => Math.max(0, Math.min(1, v));

/* 门禁/诊断读的句柄（与 PRECIP/POSTRAIN 同款：只读状态，不暴露推进） */
export const AMBIENT = {
  firefly: FIREFLY, petals: PETALS,
  state: () => ({
    flyVisible: FIREFLY.points.visible, flyI: +FIREFLY.points.material.uniforms.uIntensity.value.toFixed(3),
    petalVisible: PETALS.points.visible, petalI: +PETALS.points.material.uniforms.uIntensity.value.toFixed(3),
    petalMix: +PETALS.points.material.uniforms.uMix.value.toFixed(3),
  }),
};

export function updateAmbient(dt, t){
  const p = ENV.cur;
  /* —— 萤火虫 —— */
  const nightW = clamp01(((p.starAmount || 0) - 0.05) / 0.25);   // 口径与 12-env dayW 互补（昼1→夜0）
  const seasonW = SEASON_FLY[ENV.season] ?? 0;
  const clearW = 1 - Math.min(1, (p.rainAmount || 0) + (p.snowAmount || 0));
  const flyI = nightW * seasonW * clearW;
  FIREFLY.points.visible = flyI > 0.01;
  FIREFLY.points.material.uniforms.uIntensity.value = flyI * 0.9;
  FIREFLY.points.material.uniforms.uTime.value = t;
  if (FIREFLY.points.visible){
    const arr = FIREFLY.points.geometry.attributes.position.array, H = FIREFLY.home;
    for (let i = 0; i < FIREFLY.n; i++){
      const j = i * 3, ph = FIREFLY.phase[i] * 6.2831;
      /* 家域游荡：x/z 大圈慢 + y 小幅浮沉，每只相位不同 ⇒ 不结队 */
      arr[j]   = H[j]   + Math.sin(t * 0.31 + ph) * 1.4 + Math.sin(t * 0.83 + ph * 2.0) * 0.35;
      arr[j+1] = H[j+1] + Math.sin(t * 0.53 + ph * 1.7) * 0.45;
      arr[j+2] = H[j+2] + Math.cos(t * 0.27 + ph) * 1.4 + Math.cos(t * 0.71 + ph * 2.0) * 0.35;
    }
    FIREFLY.points.geometry.attributes.position.needsUpdate = true;
  }
  /* —— 飘落 —— */
  const petal = p.peachPetalShow || 0;
  const autumn = ENV.season === 'autumn' ? 0.8 : 0;
  const amt = Math.max(petal, autumn);
  PETALS.points.visible = amt > 0.02;
  if (!PETALS.points.visible) return;
  const uu = PETALS.points.material.uniforms;
  uu.uIntensity.value = Math.min(1, amt) * 0.75;
  uu.uMix.value = autumn / (petal + autumn + 1e-5);   // 谁主导就偏谁的颜色
  const cam = camera.position;
  const dcx = _prevCamX === null ? 0 : cam.x - _prevCamX;
  const dcz = _prevCamZ === null ? 0 : cam.z - _prevCamZ;
  _prevCamX = cam.x; _prevCamZ = cam.z;
  const a = PETALS.arr, n = PETALS.n, X = PETALS.spread, YT = 16, YB = -1.0, DH = YT - YB;
  if (!PETALS.seeded){
    PETALS.seeded = true;
    for (let i = 0; i < n; i++){
      a[i*3] = cam.x + (Math.random() * 2 - 1) * X;
      a[i*3+1] = YB + Math.random() * DH;
      a[i*3+2] = cam.z + (Math.random() * 2 - 1) * X;
    }
  }
  const wind = p.windMul || 1;
  const spArr = PETALS.points.geometry.attributes.aSpeed.array;
  const active = Math.max(32, Math.round(n * Math.min(1, amt)));
  for (let i = 0; i < active; i++){
    const j = i * 3;
    /* 花瓣比雪落得慢、摆得开：慢速下坠 + 大幅摇摆 + 顺风漂 */
    a[j]   += dcx + (Math.sin(t * 0.9 + i * 0.53) * 1.1 + wind * 0.55) * dt;
    a[j+1] += -(0.55 + amt * 0.5) * spArr[i] * dt;
    a[j+2] += dcz + Math.cos(t * 0.7 + i * 0.41) * 1.1 * dt;
    if (a[j+1] < YB){ a[j+1] = YT; a[j] = cam.x + (Math.random() * 2 - 1) * X; a[j+2] = cam.z + (Math.random() * 2 - 1) * X; }
    else if (a[j] - cam.x >  X) a[j] -= 2 * X;
    else if (cam.x - a[j] >  X) a[j] += 2 * X;
    if (a[j+2] - cam.z >  X) a[j+2] -= 2 * X;
    else if (cam.z - a[j+2] >  X) a[j+2] += 2 * X;
    /* 室内禁区即死（借用 12e 的盒子：堂/廊/榭，不新增真值来源） */
    for (const B of PRECIP_INDOOR){
      if (a[j+1] < B.yTop && a[j] > B.x0 && a[j] < B.x1 && a[j+2] > B.z0 && a[j+2] < B.z1){
        a[j+1] = YT; a[j] = cam.x + (Math.random() * 2 - 1) * X; a[j+2] = cam.z + (Math.random() * 2 - 1) * X;
        break;
      }
    }
  }
  PETALS.points.geometry.attributes.position.needsUpdate = true;
  PETALS.points.geometry.setDrawRange(0, active);
}
