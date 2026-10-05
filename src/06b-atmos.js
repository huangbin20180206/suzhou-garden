// 06b-atmos: 雾团 + 堂前香炉白烟 —— 2026-10-05 从 06-vegetation.js 整块搬出（纯搬家，逐字未改）。
/* 为什么单独一个文件：这两块是"挂在场景里的氛围片"（billboard 片 + 自己的私有随机流 + 每帧由
   11-loop 推 uTime/uOpacity），与植被建模（竹/柳/桃/荷/鱼）是两件事；06 曾 4588 行。
   依赖只有一个：06-vegetation 的 `makeMistSpriteTex()`（同一个雾片贴图，那边也自用）。
   ⚠️ 方向是**单向**的（06b → 06），06 **不** import 本文件 ⇒ 没有环，不需要注入。
   两块的对外名（FOG_BANKS / makeFogBanks / CENSER_SMOKE / makeCenserSmoke）原来从 06 转出，
   现已改为由 08-assemble 与 11-loop 直接从本文件 import（只有这两处引用，改它们比留转出更干净）。 */
import { THREE } from '../vendor.js';
import { TAU, mulberry32 } from './00-config.js';
import { WIND } from './01-materials.js';      // 雾团/白烟都按风向偏移（块内除 makeMistSpriteTex 外唯一的外部依赖）
import { makeMistSpriteTex } from './06-vegetation.js';

/* ══ 雾团（2026-09-28 · "半遮半掩"活雾，老黄设计）════════════════════════
   与雾絮场（上）互补：雾絮是全园均匀的低层纱；雾团是**定向遮挡** ——
   晨起裹正堂、午后沉竹林，"哪个景被雾藏"随时辰换主角。
   · 两团各一个 InstancedMesh（8~9 片软雾 billboard），共用雾絮贴图与漂移手法；
   · 淡入值由 11-loop 从 ENV.cur.bankHall / bankBamboo 逐帧写入（applyWeatherTo 已按
     天气归零 —— 非雾天恒 0）；时辰切换走 ENV 的 3s 缓动 ⇒ 雾团渐起渐收，不突兀；
   · 单片 α 0.28~0.42，几片叠透封顶约 0.5~0.65 —— 露轮廓、藏细节，正是"半遮半掩"。 */
export const FOG_BANKS = {
  hall:    { uTime:{ value:0 }, uOpacity:{ value:0 }, uColor:{ value:new THREE.Color(0xDCE0E2) },
             uMap:{ value:null }, uNear:{ value:3.5 }, uNearEnd:{ value:12.0 }, uWindVec: WIND.uWindVec },
  bamboo:  { uTime:{ value:0 }, uOpacity:{ value:0 }, uColor:{ value:new THREE.Color(0xDCE0E2) },
             uMap:{ value:null }, uNear:{ value:3.5 }, uNearEnd:{ value:12.0 }, uWindVec: WIND.uWindVec },
  /* 2026-09-29 增两团（老黄拍板"都要"）：桥洞烟雨（贴水低雾压在拱桥桥洞一带）+
     假山晨雾（南岸峰群半没入雾、只露峰尖）。 */
  bridge:  { uTime:{ value:0 }, uOpacity:{ value:0 }, uColor:{ value:new THREE.Color(0xDCE0E2) },
             uMap:{ value:null }, uNear:{ value:3.5 }, uNearEnd:{ value:12.0 }, uWindVec: WIND.uWindVec },
  rockery: { uTime:{ value:0 }, uOpacity:{ value:0 }, uColor:{ value:new THREE.Color(0xDCE0E2) },
             uMap:{ value:null }, uNear:{ value:3.5 }, uNearEnd:{ value:12.0 }, uWindVec: WIND.uWindVec },
};
function makeFogBank(u, cx, cy, cz, spreadX, spreadZ, n, seed, name, flat = false){
  /* 独立随机流（铁律：布局类随机绝不碰全局 rnd / Math.random） */
  const br = mulberry32(seed);
  const geo = new THREE.PlaneGeometry(1, 1);
  const base = new Float32Array(n * 3), par = new Float32Array(n * 4);
  for (let i = 0; i < n; i++){
    const t = (i / (n - 1)) * 2 - 1;               // -1..1：沿一条横带均匀铺开
    base[i*3+0] = cx + t * spreadX + (br() - 0.5) * 3.0;   // 带一点错落，不排成直线
    base[i*3+1] = cy + (br() - 0.5) * (flat ? 0.5 : 1.0);
    base[i*3+2] = cz + t * spreadZ + (br() - 0.5) * 1.6;
    par[i*4+0]  = flat ? 2.8 + br() * 1.8 : 4.6 + br() * 3.4;   // 半宽：贴水矮片 / 贴地大雾片
    par[i*4+1]  = flat ? 0.8 + br() * 0.5 : 1.6 + br() * 1.0;   // 半高
    par[i*4+2]  = br() * TAU;                       // 漂移相位
    par[i*4+3]  = 0.28 + br() * 0.14;               // 单片 α：叠透后到"半遮"，不到"盖死"
  }
  geo.setAttribute('aBase',  new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aParam', new THREE.InstancedBufferAttribute(par, 4));
  /* shader 与雾絮场同一份（拷贝而非共享：两边的漂移幅度/淡入曲线以后可能分头调） */
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `
      attribute vec3 aBase;
      attribute vec4 aParam;
      uniform float uTime;
      uniform vec2  uWindVec;
      uniform float uNear;
      uniform float uNearEnd;
      varying vec2  vUv;
      varying float vAlpha;
      void main(){
        vUv = uv;
        float ph = aParam.z;
        vec3 c = aBase;
        vec2 w   = uWindVec;
        vec2 wvP = vec2(-w.y, w.x);
        c.xz += w   * (sin(uTime * 0.085 + ph * 1.7) * 2.1);
        c.xz += wvP * (sin(uTime * 0.061 + ph * 2.3) * 1.5);
        c.y  += sin(uTime * 0.050 + ph * 0.9) * 0.22;
        vec3 toCam = cameraPosition - c;
        float dist = length(toCam);
        vec3 dir   = toCam / max(dist, 1e-4);
        vec3 cr    = cross(vec3(0.0, 1.0, 0.0), dir);
        float lr   = length(cr);
        vec3 right = lr > 1e-4 ? cr / lr : vec3(1.0, 0.0, 0.0);
        vec3 upv   = normalize(cross(dir, right));
        vec3 pos = c + right * (position.x * aParam.x * 2.0)
                     + upv   * (position.y * aParam.y * 2.0);
        vAlpha = aParam.w * smoothstep(uNear, uNearEnd, dist);
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3  uColor;
      uniform float uOpacity;
      varying vec2  vUv;
      varying float vAlpha;
      void main(){
        float a = texture2D(uMap, vUv).a * vAlpha * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite:  false,      // 互相之间不遮挡、不写深度，否则排序穿帮
    depthTest:   true,       // 被建筑/山石正常遮挡，才有"绕在树后面"的层次
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,  // 水面反射的镜像相机里三角面会翻向背面
    fog: false,              // 它自己就是雾，别再被 scene.fog 吃一道
  });
  u.uMap.value = makeMistSpriteTex();
  const im = new THREE.InstancedMesh(geo, mat, n);
  const MI = new THREE.Matrix4();
  for (let i = 0; i < n; i++) im.setMatrixAt(i, MI);   // shader 不读 instanceMatrix，补上只为包围球不出现零矩阵
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;                            // 实例位置在 shader 里算，CPU 侧包围球是错的
  im.raycast = () => {};                               // 与雾絮场同因：别挡"视线是否被挡"类射线判定
  im.castShadow = false; im.receiveShadow = false;
  im.renderOrder = 6;
  im.name = name;
  return im;
}
export function makeFogBanks(){
  const g = new THREE.Group();
  /* 正堂（远香堂，堂在 (0,-12.8)）前：雾团压在台基/踏跺一带 —— 晨起最浓时
     堂身没入雾里、只余脊线，正是"整个正堂雾蒙蒙"。 */
  g.add(makeFogBank(FOG_BANKS.hall, 0, 2.0, -8.8, 11, 0.8, 8, 20260928, 'fogBankHall', false));
  /* 竹林带：北墙根的竹丛（z=-20，x ±14~26 两丛；中段留给堂后留白）—— 午后渐浓时
     竹林半没入雾、竹梢挑出雾面。 */
  g.add(makeFogBank(FOG_BANKS.bamboo, 0, 2.6, -19.2, 23, 0.8, 9, 20260929, 'fogBankBamboo', false));
  /* 2026-09-29 增：桥洞烟雨 —— 贴水低雾沿拱桥桥洞一带（桥 (8.4,·,4.6) 跨 z），
     暮/夜配灯笼最出片。flat 贴水矮片，CPU 包围盒下探 ≈0.5m（refract-coverage
     的 fogBank 豁免线 ≤0.6m 内）。 */
  g.add(makeFogBank(FOG_BANKS.bridge, 8.4, 0.9, 4.6, 1.4, 2.2, 6, 20260930, 'fogBankBridge', true));
  /* 2026-09-29 增：假山晨雾 —— 南岸峰群（x -6.5 / 9.5 两座，z≈14~16）半没入雾、
     只露峰尖，晨最浓。 */
  g.add(makeFogBank(FOG_BANKS.rockery, 1.5, 2.2, 14.5, 9.5, 0.8, 8, 20260931, 'fogBankRockery', false));
  return g;
}

/* ══ 堂前香炉的袅袅白烟（2026-10-05 · 老黄："正堂前既然加了铜炉，是不是应该有袅袅白烟"）══
   与上面雾团**同一套范式**（billboard 片 + makeMistSpriteTex + 风偏移 + NormalBlending；
   理由也相同：片之间不写深度、被建筑正常遮挡、不吃 scene.fog），只在**运动**上换一种：
     · 雾团是原地漂移；烟是**上升柱** —— 每片按自己的相位走 0→1 的循环（fract），
       沿高度长大、两头收 α ⇒ 读作"一缕缕往上飘、越飘越淡"；
     · **越往上越受风**：横向偏移取 h²（炉口几乎不偏、飘到高处才被吹斜）—— 这才是"袅袅"。
   ⚠️ 三条项目硬规矩：
     ① 相位/速度/尺寸全走本函数**私有**的 mulberry32 流（铁律 1：绝不吃全局 rnd/rr，
        否则其后全园布局整体前移、且不报错）；
     ② `raycast = () => {}` —— 与雾团同因，别挡"视线是否被挡"这类判定；
     ③ `userData.aoSkip = true` —— 不进 GTAO 法线 pass（同萤火/钓饵/灯笼：这些片是软的，
        被当成实体会写成一块 AO ≈ 一团黑）。
   ⚠️ uTime 由 11-loop 用 **windClock（仿真时钟）** 驱动，与雾团/风共用同一条时间线
      （本项目规矩：仿真与风必须同一时间线，否则会出现"风在吹但相位不走"且不报错）。 */
export const CENSER_SMOKE = { uTime:{ value:0 }, uAlpha:{ value:0.40 } };   // 11-loop 每帧写
export function makeCenserSmoke(x, y, z){
  const sr = mulberry32(20261007);
  const N = 14;                                   // 14 片：够读成"一缕"，仍只占 1 个 draw call
  const geo = new THREE.PlaneGeometry(1, 1);
  const par = new Float32Array(N * 4);            // phase, speed(圈/秒), 尺寸倍率, 水平错开
  for (let i = 0; i < N; i++){
    par[i*4+0] = i / N + sr() * 0.05;             // 相位均匀铺开 ⇒ 任何一帧都"有烟"，不是一起冒
    par[i*4+1] = 0.15 + sr() * 0.07;              // 0.15~0.22 圈/秒 ⇒ 一缕约 4.5~6.7s 走完全程
    par[i*4+2] = 0.80 + sr() * 0.50;              // 尺寸倍率（个体有别）
    par[i*4+3] = (sr() - 0.5) * 0.10;             // 出烟口的水平错开（不然读成一根柱子）
  }
  geo.setAttribute('aPar', new THREE.InstancedBufferAttribute(par, 4));
  const u = {
    uTime: CENSER_SMOKE.uTime, uAlpha: CENSER_SMOKE.uAlpha,
    uColor:{ value:new THREE.Color(0xF3F4F1) }, uMap:{ value:null },
    uWindVec: WIND.uWindVec, uOrigin:{ value:new THREE.Vector3(x, y, z) },
    uRise:{ value:1.85 }, uLean:{ value:0.34 }, uSize:{ value:0.155 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `
      attribute vec4 aPar;
      uniform float uTime, uRise, uLean, uSize;
      uniform vec2  uWindVec;
      uniform vec3  uOrigin;
      varying vec2  vUv;
      varying float vAlpha;
      void main(){
        vUv = uv;
        /* 本片的寿命 0..1：相位错开、速度各异 ⇒ 同一帧里同时存在"刚冒出的/正飘的/快散的" */
        float life = fract(uTime * aPar.y + aPar.x);
        float h    = life * uRise;                  // 已经升多高
        float grow = 1.0 + life * 2.4;              // 越高越散
        vec3  c    = uOrigin + vec3(aPar.w, h, aPar.w * 0.6);
        c.xz += uWindVec * (h * h * uLean);         // 风：近口笔直、高处被吹斜
        vec3 toCam = cameraPosition - c;
        vec3 dir   = toCam / max(length(toCam), 1e-4);
        vec3 cr    = cross(vec3(0.0, 1.0, 0.0), dir);
        float lr   = length(cr);
        vec3 right = lr > 1e-4 ? cr / lr : vec3(1.0, 0.0, 0.0);
        vec3 upv   = normalize(cross(dir, right));
        float halfS = uSize * aPar.z * grow;
        vec3 pos = c + right * (position.x * halfS * 2.0) + upv * (position.y * halfS * 2.0);
        /* 两头收：起手 0.18 淡入（否则会看到"凭空出现一个圆片"），0.35 之后一路淡到顶 */
        vAlpha = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.35, 1.0, life));
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3  uColor;
      uniform float uAlpha;
      varying vec2  vUv;
      varying float vAlpha;
      void main(){
        float a = texture2D(uMap, vUv).a * vAlpha * uAlpha;
        if (a < 0.004) discard;                     // 与雾团同阈值：别让几乎全透明的片占填充率
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite:  false,
    depthTest:   true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  u.uMap.value = makeMistSpriteTex();
  const im = new THREE.InstancedMesh(geo, mat, N);
  const MI = new THREE.Matrix4();
  for (let i = 0; i < N; i++) im.setMatrixAt(i, MI);  // shader 不读 instanceMatrix；补上只为包围球不退化
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;                           // 实例位置在 shader 里算，CPU 侧包围球是错的
  im.raycast = () => {};
  im.castShadow = false; im.receiveShadow = false;
  im.renderOrder = 6;
  im.name = 'censerSmoke';
  im.userData.aoSkip = true;
  return im;
}
