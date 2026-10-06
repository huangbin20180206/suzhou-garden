// 06b-atmos: 雾团 + 堂前香炉白烟 —— 2026-10-05 从 06-vegetation.js 整块搬出（纯搬家，逐字未改）。
/* 为什么单独一个文件：这两块是"挂在场景里的氛围片"（billboard 片 + 自己的私有随机流 + 每帧由
   11-loop 推 uTime/uOpacity），与植被建模（竹/柳/桃/荷/鱼）是两件事；06 曾 4588 行。
   依赖只有一个：06-vegetation 的 `makeMistSpriteTex()`（同一个雾片贴图，那边也自用）。
   ⚠️ 方向是**单向**的（06b → 06），06 **不** import 本文件 ⇒ 没有环，不需要注入。
   两块的对外名（FOG_BANKS / makeFogBanks / CENSER_SMOKE / makeCenserSmoke）原来从 06 转出，
   现已改为由 08-assemble 与 11-loop 直接从本文件 import（只有这两处引用，改它们比留转出更干净）。 */
import { THREE } from '../vendor.js';
import { TAU, rnd, mulberry32, bootMark } from './00-config.js';
import { WIND, AUX_PASS_HIDDEN } from './01-materials.js';   // 风向偏移；AUX_PASS_HIDDEN = 别让 GTAO 把萤火虫/雨雪当成实心体写进法线 pass
import { scene, renderer, ACTIVE_QUALITY } from './02-scene.js';   // 萤火虫/镜头天气层要挂进场景；按画质档决定粒子数
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

/* ══ 夏夜萤火虫 + 镜头天气层（镜前雨帘 / 雪粒）—— 2026-10-05 从 06-vegetation.js 末尾整块并入 ══
   两块都是"挂在相机/场景上的氛围粒子"，与雾团、香炉白烟同一族（billboard/Points + 私有随机流），
   故并进本文件而不是另开一个模块。⚠️ 搬到本文件后新增的两个 import：rnd（萤火虫/镜前粒子的运行期抖动）
   与 scene（把网格挂进场景）。调用点仍在 11-loop（makeFireflies / makeLensWeather）。 */
/* ══ 夏夜萤火虫（2026-09-20）══
   夜景最上镜的一笔。GPU 粒子（Points + 自定义 shader），零贴图、零 CPU 逐帧开销：
   漂移与明灭全部在顶点着色器里按独立相位算 —— 萤火不是常亮的点，是"呼吸式"明灭，
   且每只虫节奏不同。加法混色 + Bloom 后处理自动给它辉光。
   存在性/亮度由 11-loop 按「夏 · 夜 · 晴/薄雾」驱动 uOpacity（平滑淡入淡出）。
   userData.aoSkip：不进 GTAO 法线 pass（见 10-post 的 collectAOSkip）。 */
export function makeFireflies(){
  const N = ACTIVE_QUALITY.fireflies;
  /* 三簇，权重和为 1：池南灌丛岸 / 东瓣近水榭 / 西瓣水边。基准点全在岸上，
     高 0.35~2.1m。rnd 固定种子 → 每次刷新萤火分布一致（与全园同范式）。 */
  const clusters = [
    { cx:-5.5, cz: 11.5, r: 3.6, w: 0.40 },
    { cx: 6.8, cz:  9.2, r: 3.0, w: 0.32 },
    { cx:-9.2, cz: -0.6, r: 2.8, w: 0.28 },
  ];
  const pos = new Float32Array(N * 3), pha = new Float32Array(N), amp = new Float32Array(N);
  let n = 0;
  for (const c of clusters){
    const cnt = Math.max(2, Math.round(N * c.w));
    for (let i = 0; i < cnt && n < N; i++){
      const ang = rnd() * TAU, rad = Math.sqrt(rnd()) * c.r;
      pos[n*3]   = c.cx + Math.cos(ang) * rad;
      pos[n*3+1] = 0.35 + rnd() * 1.75;
      pos[n*3+2] = c.cz + Math.sin(ang) * rad * 0.8;
      pha[n] = rnd();
      amp[n] = 0.25 + rnd() * 0.5;
      n++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  geo.setAttribute('aAmp', new THREE.BufferAttribute(amp, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: WIND.uTime, uOpacity: { value: 0 } },
    vertexShader: `
      attribute float aPhase;
      attribute float aAmp;
      uniform float uTime;
      varying float vGlow;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*0.31 + aPhase*6.2831)*aAmp + sin(uTime*0.13 + aPhase*13.7)*aAmp*0.5;
        p.y += sin(uTime*0.23 + aPhase*9.4)*0.28 + sin(uTime*0.11 + aPhase*5.1)*0.12;
        p.z += cos(uTime*0.27 + aPhase*6.2831)*aAmp;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float tw = 0.5 + 0.5*sin(uTime*(1.1 + aAmp*1.3) + aPhase*40.0);
        tw = pow(tw, 2.2);                         /* 呼吸：比 3.0 缓，暗态仍留微光（否则远景看不到虫） */
        vGlow = tw;
        /* 尺寸档（F3 二轮，2026-09-21）：旧版峰值 140px 糊团 → 首修 52/dist 钳 12px，
           但默认机位 30m 外全员被钳到 2.2px，夏夜截图里萤火"集体失踪"。
           108/dist：30m 处 3.6×(1~2.3)≈3.6~8px 清晰可点；10m 内钳到 15px 封顶，
           近景仍是亮点而不是光斑。辉光依旧交给 bloom。 */
        float dist = max(2.0, -mv.z);
        gl_PointSize = clamp((1.05 + aAmp*1.25) * (108.0 / dist), 2.6, 15.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying float vGlow;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        /* 小实芯 + 一圈窄晕（F3 二轮）：暗态基数 0.10→0.20，远景暗虫不再消失；
           晕径 0.34→0.40、强度 0.45→0.55，亮灭两态都读得出"虫"而不是像素噪点。 */
        float core = smoothstep(0.14, 0.0, d);
        float halo = smoothstep(0.40, 0.10, d) * 0.55;
        float a = (core + halo) * (0.20 + 0.80*vGlow) * uOpacity;
        if (a < 0.003) discard;
        vec3 warm  = vec3(1.0, 0.83, 0.42);
        vec3 green = vec3(0.72, 1.0, 0.55);
        vec3 rgb = mix(warm, green, 0.25*vGlow);
        /* 亮起瞬间芯部 >1：加法混合在暗背景上稳稳越过夜阈值 0.86，bloom 给它拖光点；
           晕部仍 <1，不会炸成白饼。 */
        rgb *= 1.0 + core * 0.9 * vGlow;
        gl_FragColor = vec4(rgb, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.aoSkip = true;       // 不进 GTAO 法线 pass
  points.userData.noMerge = true;
  points.visible = false;
  return points;
}

/* ══ 镜头天气层（2026-09-20）：镜前雨帘 / 雪粒 ══
   场景雨雪是"你在看雨"；这一层是"你在雨里"——粒子挂在相机下、恒占镜头前方，
   近大远小带视差。雨丝快落并沿风向倾斜，雪粒慢、大、左右飘。
   全部在 shader 内按 aSeed 循环，CPU 每帧只写 5 个 uniform。
   相机必须进场景图（scene.add(camera)）其子节点才会被渲染。
   挂进 AUX_PASS_HIDDEN：GTAO 法线 pass 期间整体隐藏（否则被 override 材质
   画成一屏贴镜头的纯色方块污染 AO）。折射相机只渲 layer 3，天然不含本层。 */
export function makeLensWeather(cam){
  if (!cam.parent) scene.add(cam);
  /* 近景粒子宜疏不宜密：上一版 180 粒 + 30px 大 sprite，糊成一屏毛玻璃。 */
  const N = ACTIVE_QUALITY.lensWeather;
  const data = new Float32Array(N * 3);
  for (let i = 0; i < N; i++){
    data[i*3]   = rnd() * 2 - 1;   // nx：水平随机
    data[i*3+1] = rnd();           // seed：循环相位
    data[i*3+2] = Math.pow(rnd(), 1.4);  // depth^1.4：多数粒子推远，近脸大粒只留少数
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: WIND.uTime, uAspect: { value: 1 },
      uRain: { value: 0 }, uSnow: { value: 0 },
      uWind: { value: new THREE.Vector2(0.2, 0) },
      uPR: { value: Math.min(2, renderer.getPixelRatio() || 1) },
    },
    vertexShader: `
      uniform float uTime, uAspect, uSnow, uPR;
      uniform vec2 uWind;
      varying float vDep;
      varying float vSeed;
      void main(){
        float nx = position.x;
        float seed = position.y;
        float dep = position.z;
        float snow = clamp(uSnow, 0.0, 1.0);
        float dist = mix(2.4, 9.0, dep);
        float z = -dist;
        float spanY = 0.50 * dist;                  /* tan(23°)≈0.42，留余量 */
        float spanX = spanY * uAspect;
        float rainCyc = fract(seed*7.31 + uTime*mix(9.0,18.0,dep)/(spanY*2.0));
        float snowCyc = fract(seed*3.17 + uTime*mix(1.1,2.4,dep)/(spanY*2.0));
        float cyc = mix(rainCyc, snowCyc, snow);
        float y = mix(spanY, -spanY, cyc);
        float rainX = (cyc-0.5)*(2.0 + uWind.x*2.6);
        float snowX = sin(uTime*0.9 + seed*41.0)*0.45 + uWind.x*(cyc-0.5)*0.8;
        float x = nx*spanX*0.96 + mix(rainX, snowX, snow);
        vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
        gl_Position = projectionMatrix * mv;
        vDep = dep; vSeed = seed;
        /* 雨：细高拉丝（高 ~28/11px，宽在片元里只取中间 ~2px）；
           雪：小绒片（9/4.5px），近景也不能大 —— 上一版 16px 软圆被 bloom 糊成白饼。 */
        float rainSize = mix(28.0, 11.0, dep);
        float snowSize = mix(9.0, 4.5, dep);
        gl_PointSize = mix(rainSize, snowSize, snow) * uPR;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uRain, uSnow;
      uniform vec2 uWind;
      varying float vDep;
      varying float vSeed;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float snow = clamp(uSnow, 0.0, 1.0);

        /* ── 雨丝：沿风向倾斜的细线 SDF ──
           上一版 smoothstep(0.5,0.03,|q.x|) 让"线宽"几乎等于 sprite 全宽 → 画成椭圆盘。
           宽度收紧到 |qr.x|<~0.05（≈2px @28px sprite），纵向头亮尾淡出成拖尾。 */
        float wa = uWind.x * 0.55;
        float ca = cos(wa), sa = sin(wa);
        vec2 qr = mat2(ca, -sa, sa, ca) * q;
        float lw = 0.045 / max(0.35, 1.0 - vDep*0.55);   /* 远处线略细 */
        float lineW = smoothstep(lw + 0.03, lw, abs(qr.x));
        float lineL = smoothstep(0.52, 0.30, abs(qr.y));   /* 两端收圆 */
        float trail = clamp(0.75 - qr.y * 0.55, 0.0, 1.0); /* 上端（头）亮、下端拖尾淡 */
        float rainShape = lineW * lineL * trail;

        /* ── 雪片：每粒自转一个角度的小椭圆绒片，核心半透、边缘收得相对实 ──
           不用大软边圆盘（bloom 下必成白饼）；再加两道正交淡瓣，远看有"片"的翻折感。 */
        float sa2 = vSeed * 6.2831 + uTime * (0.6 + vSeed * 0.8);
        float cs = cos(sa2), sn = sin(sa2);
        vec2 qs = mat2(cs, -sn, sn, cs) * q;
        qs.x *= 1.25;                    /* 椭圆 */
        float r = length(qs);
        float body = smoothstep(0.42, 0.30, r);                 /* 绒片主体，边缘较实 */
        float core = smoothstep(0.20, 0.0, r) * 0.35;           /* 中心微微厚实 */
        float bar1 = smoothstep(0.05, 0.0, abs(qs.x)) * smoothstep(0.40, 0.30, r) * 0.22;
        float bar2 = smoothstep(0.05, 0.0, abs(qs.y)) * smoothstep(0.40, 0.30, r) * 0.22;
        float snowShape = body * 0.8 + core + bar1 + bar2;

        float shape = mix(rainShape, snowShape, snow);
        float inten = mix(uRain * 0.5, uSnow * 0.6, snow);
        /* 越靠近镜头越淡：雨丝贴面时半透，不抢景；雪同理 */
        float depthFade = mix(0.55, 0.85, vDep);
        float a = shape * inten * depthFade;
        if (a < 0.004) discard;
        vec3 rainCol = vec3(0.72, 0.80, 0.90);
        vec3 snowCol = vec3(0.82, 0.88, 0.98);   /* 降亮度：纯白会被 bloom 糊开 */
        gl_FragColor = vec4(mix(rainCol, snowCol, snow), a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.aoSkip = true;
  AUX_PASS_HIDDEN.push(points);
  cam.add(points);
  points.visible = false;
  let rain = 0, snow = 0;
  return {
    points,
    update(dt, aspect, rainTarget, snowTarget, windVec){
      rain += (rainTarget - rain) * Math.min(1, dt * 2.2);
      snow += (snowTarget - snow) * Math.min(1, dt * 2.2);
      mat.uniforms.uAspect.value = aspect;
      mat.uniforms.uRain.value = rain;
      mat.uniforms.uSnow.value = snow;
      mat.uniforms.uWind.value.copy(windVec);
      points.visible = rain > 0.015 || snow > 0.015;
    },
    level: () => Math.max(rain, snow),
  };
}

bootMark('§6 植被');
