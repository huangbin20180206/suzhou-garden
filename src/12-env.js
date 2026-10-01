// 12-env: from index.html inline 501..1876
import { THREE, mergeGeometries } from '../vendor.js';
/* ⚠️ 这里**不能** import 11-loop 的 queuePostcard / toggleSound（明信片、音景两个按钮）：
   12-env 被 2b-wind 依赖，2b-wind 又被 11-loop 依赖 → 静态 import 会构成
   2b-wind → 12-env → 11-loop → 2b-wind 的环，11-loop 的 body 会在 2b-wind 求值完成前
   跑 `animate()` / `window.__garden` → 启动期 TDZ（实测 "Cannot access 'windClock
   before initialization"，渲染循环每帧重复）。这两处都只在**事件回调**里调用，
   回调触发时所有模块早已就绪 → 走 00-config 的 HOOKS 延迟绑定（见该文件注释）。 */
import { MAT, waterSurface, DISTANT_MATS, SEASON_TINT_REGISTRY, addWind, wetUniform, WET_MATS, SNOW_COVER_MATS, SNOW_HOOK } from './01-materials.js';
import { world, dragonflies, setPerchShowOK, swimTurtles, tourUserTakeover, TOUR, tourStop, tourStart,
         gotoViewpoint, showCaption, showSeasonCaption, hideCaption, VIEWPOINTS,
         cancelCamFly, CAM_FLY, introActive, introCancel, geese } from './08-assemble.js';
import { sun, fitShadowCamera, amb, fill, hemiLight, markCasterBoxDirty } from './09-lights.js';
import { skyMesh, scene, lumOf, ENV_BAKE_LUM, resetCamera, camera, ACTIVE_QUALITY, renderer, setEnvPreset } from './02-scene.js';
import { bloom, gtaoPass, gradePass } from './10-post.js';
import { gust } from './2b-wind.js';
import { TAU, HOOKS, ENV_REF, mulberry32, CFG } from './00-config.js';
import { spawnRipple, rainRippleActive, treeLanternInsts } from './06-vegetation.js';
import { POND_RADII, groundHeight, insidePond } from './05-water.js';
/* ══════════════════════════════════════════════════════════════
   12 · 环境时序系统（ENV）
   ══════════════════════════════════════════════════════════════
   三个正交轴（时段 / 季节 / 天气）各自只写自己的预设表，最终参数由「组合规则」合成，
   而不是为 4×4×4 = 64 种组合各写一套 —— 这是这套系统不失控的关键。
   三根轴已全部接入（2-1 时段 / 2-2 季节 / 2-3 天气），合成位置就在 resolveEnv()。 */

/* ── 夜间的灯笼：自发光小体 + Bloom 辉光 ──
   2-1 先不做点光源：5 个点光会让所有材质重新编译着色器，代价远大于收益。
   夜里靠「低环境光 + 自发光灯笼 + 提高 bloom」就足以读成月夜园林。 */
/* 灯罩纸纹（2026-09-21 方案 n2 二轮）：纯色自发光在特写里是"光球"，
   加 8 棱灯骨的纵向暗纹 + 横箍 —— 白天是纸面骨架、夜里是骨影透光，
   圆滚滚的发光体立刻有"物件感"。 */
/* SSS 纸感（2026-09-21 写实增强）：在纸面上叠一层「内芯光透过纸缝渗出」的
   亮核 —— 灯内光源应被纸壳散射成中间最亮、向骨影/边缘渐弱的柔和渐晕，
   而不是整块等亮。做法：横向渐变压成「两端暗（骨架背光）+ 中央满（透光）」，
   再撒高频纸纤维颗粒。配合下方 onBeforeCompile 的运行时纸粒微噪声，白天是
   泛黄的纸、夜里是"光从纸里涌出来"的柔体 —— 打破塑料贴死的光球感。 */
function makeLanternTex(){
  const S = 128, H = 256;
  const c = document.createElement('canvas'); c.width = S; c.height = H;
  const g = c.getContext('2d');
  /* 内芯透光：横腰亮度按「越靠骨影越暗、越靠面心越亮」走，模拟纸壳对灯芯的漫散射 */
  const grd = g.createLinearGradient(0, 0, S, 0);
  grd.addColorStop(0.00, '#C98A22'); grd.addColorStop(0.10, '#E8A83C');
  grd.addColorStop(0.28, '#FFE9A8'); grd.addColorStop(0.50, '#FFF6D2');
  grd.addColorStop(0.72, '#FFE9A8'); grd.addColorStop(0.90, '#E8A83C'); grd.addColorStop(1.00, '#C98A22');
  g.fillStyle = grd; g.fillRect(0, 0, S, H);
  /* 纵向二次渐晕：上下口端被骨盖遮挡 → 暗，中腰被灯芯照亮 → 亮（纸透光的高度感） */
  const vg = g.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0.00, 'rgba(120,60,10,0.30)'); vg.addColorStop(0.25, 'rgba(0,0,0,0)');
  vg.addColorStop(0.75, 'rgba(0,0,0,0)'); vg.addColorStop(1.00, 'rgba(120,60,10,0.30)');
  g.fillStyle = vg; g.fillRect(0, 0, S, H);
  /* 8 棱灯骨：每棱右侧一道渐变暗带 —— 半边暗半边透光，造出"面与面折棱"的颚骨感 */
  for (let i = 0; i < 8; i++){
    const x0 = Math.floor((i + 0.45) * S / 8);
    const bw = Math.max(3, Math.floor(S / 8 * 0.10));
    const bg = g.createLinearGradient(x0, 0, x0 + bw, 0);
    bg.addColorStop(0, 'rgba(110,50,10,0.78)'); bg.addColorStop(1, 'rgba(110,50,10,0)');
    g.fillStyle = bg; g.fillRect(x0, 0, bw, H);
    g.fillStyle = 'rgba(70,35,8,0.9)'; g.fillRect(x0, 0, 1, H);
  }
  /* 横箍 + 纸纤维：细密横向微带模拟纸张经纬，比平涂更"织" */
  g.fillStyle = 'rgba(90,45,10,0.25)';
  for (let y = 0; y < H; y += 22) g.fillRect(0, y, S, 2);
  g.fillStyle = 'rgba(150,90,20,0.10)';
  for (let y = 0; y < H; y += 5) g.fillRect(0, y, S, 1);
  /* 纸张颗粒：明暗麻点暗含纤维 —— 特写下能看到纸面不是一块平色 */
  for (let i = 0, n = 1100; i < n; i++){
    const a = Math.random() * 0.16;
    g.fillStyle = a > 0.06 ? `rgba(120,70,15,${a})` : `rgba(255,240,190,${0.16 - a})`;
    g.fillRect(Math.random() * S, Math.random() * H, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/* SSS 运行时纸粒（2026-09-21）：夜里自发光 + UV 静止会让纸面"原地发光"，
   给 diffuse 叠一层随世界坐标**移动的**高频微噪 —— 光面和暗面交界不再是一条
   僵硬的公共服务，而像纸张纤维在透光。不进材质的真正 BRDF，只是廉价近似。
   uLampS 与 below lanternMat 的昼夜发光强度同源（applyEnv 里写）。 */
function addLanternSSS(mat){
  mat.onBeforeCompile = (sh)=>{
    sh.uniforms.uLampS = { value: 1.15 };
    mat.userData.uLampS = sh.uniforms.uLampS;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvLampW = worldPosition.xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform float uLampS;\nvarying vec3 vLampW;\n'
        + 'float lampGrain(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }')
      .replace('#include <map_fragment>',
        '#include <map_fragment>\n'
        + '  /* 纸粒：uLampS 大（夜）时影响小、白天几乎无损 —— 只在发光期内看得到麻点 */\n'
        + '  float _st = smoothstep(0.05, 1.0, uLampS);\n'
        + '  float _g = (lampGrain(fract(vLampW.xz * 0.9) * 61.7) - 0.5) * 0.05 * _st;\n'
        + '  /* 厚度不均：低频斑驳叠加在纸面的透光区 —— 手工宣纸厚薄不一的斑块感。\n'
        + '     一个中频噪声混一点高频，制造"这里透光、那里透光弱"的斑 〔特写才看得见〕 */\n'
        + '  float _lo = lampGrain(fract(vLampW.xz * 0.35) * 91.7);\n'
        + '  float _fo = lampGrain(fract(vLampW.xz * 1.7) * 71.3);\n'
        + '  float _m = mix(_lo, _fo, 0.35) - 0.5;\n'
        + '  diffuseColor.rgb *= (1.0 + _g + _m * 0.16 * _st);\n');
  };
}
const lanternTex = makeLanternTex();
const lanternMat = new THREE.MeshStandardMaterial({
  color: 0xFFFFFF, map: lanternTex, emissive: 0xFFB45A, emissiveMap: lanternTex,
  emissiveIntensity: 0, roughness: 0.6,
});
addLanternSSS(lanternMat);   // SSS 纸感：纸粒微噪（白天≈无损，夜里只见麻点）
/* ⚠️ 灯笼原来**没有吊绳**，是个悬在空中的小圆柱 —— 近看立刻穿帮。
   而且远香堂那两盏 y=5.25，比檐口（1.24+colH=5.89）只低 0.64，
   等于挂在屋顶里面。现在：
   · 每盏灯从顶部拉一根细绳到上方构件的底面（游廊到额枋、堂前到挑檐），
     绳子长度 = 挂点高度 - 灯笼高度，所以**不可能浮空**；
   · 堂前两盏下移到 4.85，落在檐下净空里，不再钻进瓦面。 */
/* ⚠️ 挂点高度**不能猜**：写错的两种表现用户都拍到了 ——
   · 游廊三盏原来写 6.15，而实测它正上方最近的构件底面在 **3.20**（额枋背面，#4a2610），
     绳子于是从额枋和瓦面穿出去三米，露在屋面上的一截就是"连廊上生出的两根天线"；
   · 堂前两盏原来写 5.80，实测额枋底在 **6.34**（#8a3a16），低了 0.54m ——
     绳顶悬在半空，所以"灯笼没挂上、还是悬空的"。
   下面是"从灯笼顶向上打一条射线，取最近命中点"量出来的值（探针 diag-lantern.mjs）。 */
const lanternSpots = [
  [13.2, 2.30, -6.0, 3.18], [18.2, 2.30, -1.8, 3.18], [24.0, 2.30, 6.5, 3.18],  // 游廊下（额枋底实测 3.20）
  [-6.2, 4.85, -7.1, 6.32], [ 6.2, 4.85, -7.1, 6.32],                            // 远香堂前檐下（额枋底实测 6.34）
];
const worldLights = []; // 定义灯笼点光源数组
let _lampVol = null;     // 体积光材质（applyEnv 同步 uLamp / uRain；白天 uLamp=0 → alpha 0，等效空 mesh）
let _groundSplashMat = null, _groundSplashGeo = null;   // 灯下地面光斑材质/几何（与 _lampVol 同理）
/* 已挂到灯笼上的光团 / 光斑实例（2026-09-22 · 为门禁收）。
   ⚠️ 不收这个清单，门禁就只能靠 traverse 猜对象 —— 而"猜"在本项目已经栽过
   （灯笼那次"引用没暴露 → found:false"）。清单必须由创建处自己登记。 */
const _volMeshes = [], _splashMeshes = [];
/* 灯笼在风里微摆：存**摆动支点**（pivot）到数组，渲染循环里统一做单摆。
   ⚠️ 支点必须是挂点、不是灯笼中心（2026-09-17 用户："能感觉到微弱的悬挂绳索与屋梁的
   连接处在动（这个不科学，这个地方应该不动）"）。原实现把 rotation 写在原点位于
   灯笼中心的 Group 上 —— 那等于绕灯笼自己转，吊绳的上端（贴着屋梁那截）跟着一起甩，
   绳与梁的连接处就"活"了。现在外层套一个原点精确落在挂点 (x, hang, z) 的 pivot：
   rotation 作用在 pivot 上就是真正的单摆 —— 挂点固定（位移 0）、绳下端摆幅最大、
   而灯笼挂在绳下端之下、离支点更远，位移**略大于**绳下端。这三条正是用户要的效果。 */
export const lanternGroups = [];
/* 灯笼相位 hash：与风场里的 hash21 同款（three r184 未内置，自声明），
   给每盏灯笼一个独立相位，避免所有灯笼"齐刷刷"同摆。 */
export function hash21Lantern(px, pz){
  return Math.abs(Math.sin(px * 127.1 + pz * 311.7) * 43758.5453123) % 1;
}
/* 流苏几何（2026-09-21 方案 n2）：一个「结 + 5 根微外张穗线」合并成单几何，
   每盏灯笼只多 1 个 Mesh —— 实体化的同时 draw call 增量最小。
   结是上粗下细的圆锥台，穗线从结底垂下、绕轴散开 0.1 rad。 */
function makeTasselGeo(){
  const knot = new THREE.CylinderGeometry(0.050, 0.026, 0.06, 8);
  knot.translate(0, -0.035, 0);
  const strands = [];
  for (let i = 0; i < 5; i++){
    const s = new THREE.CylinderGeometry(0.0045, 0.0045, 0.11, 4);
    const a = (i / 5) * TAU;
    s.translate(Math.cos(a) * 0.012, -0.125, Math.sin(a) * 0.012);
    s.rotateZ(Math.cos(a) * 0.10);
    s.rotateX(-Math.sin(a) * 0.10);
    strands.push(s);
  }
  return mergeGeometries([knot, ...strands], false) || knot;
}
export function makeLanterns(){
  /* 宫灯实体（2026-09-21 方案 n2）：旧版「圆柱体 + 两个平盖」近看是带盖的罐头。
     新版按腰鼓形 Lathe 轮廓（下口 0.09 → 鼓腹 0.176 → 上口 0.09）+ 顶珠 +
     底结流苏，剪影完整了，Bloom 光晕才挂得住形状（圆滚滚的发光体 + 垂穗
     才是"灯笼"而不是"路灯"）。全部部件共享模块级几何，每盏只多 2 个 Mesh。 */
  const bodyGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0.090, -0.150),
    new THREE.Vector2(0.150, -0.125),
    new THREE.Vector2(0.171, -0.060),
    new THREE.Vector2(0.176,  0.000),   // 鼓腹最大
    new THREE.Vector2(0.171,  0.060),
    new THREE.Vector2(0.150,  0.125),
    new THREE.Vector2(0.090,  0.150),
  ], 16);
  const capGeo  = new THREE.CylinderGeometry(0.108, 0.108, 0.045, 10);
  const knobGeo = new THREE.SphereGeometry(0.032, 10, 8);              // 顶珠
  const cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);   // 单位高，按需缩放
  const tasselGeo = makeTasselGeo();
  /* 体积光（2026-09-21 · 形态修正）：油灯的发光体是被纸罩包裹的烛火，光是**从灯体
     向四周弥散**的，落在各向同性的光团里，绝不会收成一道朝下的聚光锥。旧实现用
     开口向下的 ConeGeometry（灯口→地面收窄）→ 特写读成"路灯/舞台聚光"，是工业形态，
     不是油灯。现改为**球形弥散光团**：球心≈灯笼发光中心，密度按到球心的距离指数
     衰减、受 fbm 湍流与微尘调制（随时间漂移）。晴朗夜空下它只是拢着灯的一层薄辉，
     到雨夜/薄雾（uRain ↑）散射增强、才显成有颗粒感的丁达尔光团 —— 这才符合物理。
     uLamp 白天=0 → alpha 全 0，等效成本仅一个空 mesh；高档位才挂（核显不开）。 */
  const lampVolMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uLamp: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(0xFFAA33) } },
    vertexShader: `
      varying vec3 vP;
      void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uLamp; uniform float uRain; uniform float uTime; uniform vec3 uTint;
      varying vec3 vP;
      float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float vnoise(vec3 x){
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n000=hash13(i), n100=hash13(i+vec3(1.0,0.0,0.0)), n010=hash13(i+vec3(0.0,1.0,0.0)), n110=hash13(i+vec3(1.0,1.0,0.0));
        float n001=hash13(i+vec3(0.0,0.0,1.0)), n101=hash13(i+vec3(1.0,0.0,1.0)), n011=hash13(i+vec3(0.0,1.0,1.0)), n111=hash13(i+vec3(1.0,1.0,1.0));
        return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                   mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
      }
      float fbm(vec3 p){
        float s = 0.0, a = 0.55;
        for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.07 + 7.31; a *= 0.5; }
        return s;
      }
      void main(){
        float rl = length(vP);                             // vP 以球心（灯笼发光中心）为原点
        if (rl > 1.0) discard;                             // 光团球面之外
        /* 各向同性径向散射：光随距离指数衰减，拢着灯向外快快散开 —— 不是向下收窄的光束 */
        float atten = exp(-rl * 3.0);
        /* 微弱下偏：灯要照亮脚下空气与地面，但只偏一点点（下半略亮、上半仍有光），
           不会构成"反光碗聚光"的方向性。 */
        float dn = normalize(vP).y;
        float downBias = 0.80 + 0.20 * smoothstep(-1.0, 0.0, dn);
        /* 大尺度空气湍流：把"亮空气"搅成明暗气团，随 uTime 缓慢漂移（正在呼吸） */
        float macro = fbm(vP * 2.2 - uTime * 0.045);
        /* 细颗粒微尘：中高频 fbm，随时间漂移 → 光团里裹着流动的尘埃 */
        vec3 gp = vec3(vP.x * 5.0, vP.y * 4.0 - uTime * 0.05, vP.z * 5.0);
        float grain = fbm(gp) * 0.6 + fbm(gp * 2.4 + 13.7) * 0.5;
        /* 密度 = 距离衰减 × 略偏下 × 湍流 × 微尘，留出暗隙（0.30 下限）→ 不是均匀一团 */
        float den = atten * downBias * (0.30 + 0.70 * macro) * (0.5 + 0.5 * grain);
        den *= 1.0 + uRain * 1.2;                            // 雨夜/薄雾：空气颗粒多 → 光更显形（丁达尔）
        float a = uLamp * 0.36 * den;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uTint * (0.55 + 0.35 * grain + 0.22 * macro), a);
      }`,
  });
  lampVolMat.userData.uLamp = lampVolMat.uniforms.uLamp;   // 由 applyEnv 每切时段刷新为 p.lamp
  _lampVol = lampVolMat;

  /* 地面光斑（写实增强）：灯笼脚下被点亮的正圆形光晕 —— 解决"光锥悬空、没落在地上"。
     加性圆斑：径向高斯衰减 + 一点点噪声柔化边缘 + 时间微闪烁 + 雨夜更亮。
     uLamp=0 白天全透明，同挂高档位。 */
  const groundSplashMat = new THREE.ShaderMaterial({
    /* 2026-09-29 修"连廊灯光透过屋顶可见"（老黄截图）：光斑原来 depthTest:false
       （当年只有堂前两盏、头顶无屋顶，关深度无碍）；游廊挂灯后，光斑从廊屋顶面
       "透"了出来（高处看屋顶上浮着橙黄光晕、檐下反而暗）。改回参与深度遮挡：
       光斑贴地 +0.06m 不会与地面 z-fighting，而屋顶/廊身会正常把它挡住。 */
    transparent: true, depthWrite: false, depthTest: true,    // 光池贴地发光，但**必须被屋顶等遮挡**
    blending: THREE.AdditiveBlending,
    uniforms: { uLamp: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(0xFFB45A) } },
    vertexShader: `
      varying vec2 vC;
      void main(){ vC = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uLamp; uniform float uRain; uniform float uTime; uniform vec3 uTint;
      varying vec2 vC;
      float hash12(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      void main(){
        float d  = length(vC);
        if (d > 1.0) discard;
        float g  = exp(-d * d * 3.2);                      // 径向高斯光晕
        float nz = (hash12(vC * 21.0 - uTime * 3.0) - 0.5) * 0.18;   // 边缘微颗粒抖动
        float a  = uLamp * 0.50 * g * (0.9 + nz) * (1.0 + uRain * 0.5);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uTint * (0.55 + 0.45 * g), a);
      }`,
  });
  groundSplashMat.userData.uLamp = groundSplashMat.uniforms.uLamp;
  _groundSplashMat = groundSplashMat;
  _groundSplashGeo = new THREE.CircleGeometry(1, 22);
  const volGeo = new THREE.SphereGeometry(1, 24, 16);   // 弥散光团：以灯芯为源的各向同性散射，非向下聚光锥
  const WITH_VOL = ACTIVE_QUALITY.volume;
  for (const [x, y, z, hang] of lanternSpots){
    const pivot = new THREE.Group();          // 摆动支点 = 挂点
    const grp = new THREE.Group();            // 灯笼本体（含吊绳），相对挂点偏移
    grp.position.y = y - hang;                // 挂点在灯笼上方，故为负
    grp.add(new THREE.Mesh(bodyGeo, lanternMat));
    const c1 = new THREE.Mesh(capGeo, MAT.woodDark); c1.position.y =  0.178;
    const c2 = new THREE.Mesh(capGeo, MAT.woodDark); c2.position.y = -0.178;
    const knob = new THREE.Mesh(knobGeo, MAT.woodDark); knob.position.y = 0.225;
    const tas  = new THREE.Mesh(tasselGeo, MAT.woodRed); tas.position.y = -0.235;
    grp.add(c1, c2, knob, tas);
    // 吊绳：从顶珠顶部（y≈0.257）拉到挂点
    const cordLen = Math.max(0.1, hang - y - 0.25);
    const cord = new THREE.Mesh(cordGeo, MAT.woodDark);
    cord.scale.y = cordLen;
    cord.position.y = 0.25 + cordLen/2;
    grp.add(cord);
    pivot.position.set(x, hang, z);
    
    /* 灯笼点光：让「灯笼照亮廊下石板 / 堂前台阶」成立 —— 灯自己发亮不等于照亮了什么。
       · 五盏全给（堂前 2 + 游廊 3），**灯数在启动时一次性定死**，运行期只改 intensity，
         绝不 add/remove、也不切 visible（灯数一变，全场材质重编译着色器，几百毫秒卡顿）。
       · ⚠️ castShadow 一律 false：PointLight 的阴影是 **6 面立方体贴图**，一盏顶六盏平行光，
         原来堂前两盏开着它 = 每帧多渲 12 张深度图，纯亏不赚。
       · distance 收紧（堂前 8m / 游廊 5m）+ decay=2：光只落在灯笼脚下那一圈，
         不会把整座园子染成橘色。 */
    /* 灯笼聚光灯（2026-09-25）：PointLight 改 SpotLight —— 灯笼本来就往下照，
       聚光灯更贴物理且阴影成本从 6 面降到 1 张。高画质档允许前 3 盏（堂前 2 + 游廊 1）
       开投影；低档与 QOS 降档后由 applyQuality 关掉。 */
    const isHall = (z === -7.1);
    const useSpot = true;
    let spot;
    if (useSpot){
      spot = new THREE.SpotLight(0xFFAA33, 0, isHall ? 9.0 : 6.5, Math.PI * 0.22, 0.55, 2.0);
      spot.target = new THREE.Object3D();
      spot.target.position.set(0, 0, 0);
      grp.add(spot.target);
      spot.position.set(0, -0.21, 0);
      // 堂前 2 盏 + 游廊第一盏 = 3 盏有投影，high 档才开；QOS 降档后由 11-loop 统一关闭
      const lightIndex = worldLights.length;
      spot.castShadow = ACTIVE_QUALITY.ao && lightIndex < 3;
      if (spot.castShadow){
        spot.shadow.mapSize.set(512, 512);
        spot.shadow.camera.near = 0.5;
        spot.shadow.camera.far = 12;
        spot.shadow.bias = -0.003;
      }
    } else {
      spot = new THREE.PointLight(0xFFAA33, 0, isHall ? 8.0 : 5.0, 2.0);
      spot.position.set(0, -0.21, 0);
      spot.castShadow = false;
    }
    /* 强度必须按 **1/d² 反算**：堂前 4.85m 高 → 6.5；游廊 2.3m → 2.8。
       SpotLight 同为物理单位（坎德拉），衰减参数一致。 */
    spot.userData.base = isHall ? 6.5 : 2.8;
    grp.add(spot);
    worldLights.push(spot);
    if (WITH_VOL){
      /* 弥散光团：球心≈灯笼发光中心（≈底盖上方一点），向四周包裹灯笼散开。
         uLamp=0 时全透明，白天就是一个不许渲染的空 mesh。 */
      const vol = new THREE.Mesh(volGeo, lampVolMat);
      vol.position.set(0, -0.04, 0);                       // 球心≈灯体中心
      const vr = Math.min(0.85, 0.5 + y * 0.035);          // 半径：拢着灯笼、向四周再散一点
      vol.scale.set(vr, vr, vr);
      grp.add(vol);
      /* 起个名字：探针要靠它在场景图里定位光团（判"是否挂在灯体层 / 与灯内光源同高"），
         devtools 里也便于直接选中 —— 没有名字时探针只能靠几何类型猜。 */
      vol.name = 'lampVol';
      _volMeshes.push(vol);
      /* 地面光斑：贴在灯下地表微高处 —— 光池摊开在拂过的地面上（含各种地板高度） */
      const splash = new THREE.Mesh(_groundSplashGeo, groundSplashMat);
      const _sy = Math.max(0.6, y * 0.92);
      splash.position.set(0, -0.34 - _sy + 0.06, 0);   // 落到灯正下方的地表附近
      const sr = Math.min(1.7, 0.55 + y * 0.16);
      splash.scale.set(sr, sr, sr);
      splash.rotation.x = -Math.PI / 2;
      grp.add(splash);
      _splashMeshes.push(splash);
    }
    
    pivot.add(grp);
    world.add(pivot);
    lanternGroups.push(pivot);
  }
}
/* 每帧喂时间给体积光/地面光斑（驱动湍流漂移与微闪烁）。渲染循环里 composer.render 前调用。
   白天 uLamp=0 alpha 全 0，time 跑与否不影响任何像素。 */
export function tickLampVol(t){
  if (_lampVol) _lampVol.uniforms.uTime.value = t;
  if (_groundSplashMat) _groundSplashMat.uniforms.uTime.value = t;
}
/* 体积光状态（2026-09-22 · 门禁 lampvol-guard）。暴露的是**可判定的量**而不是布尔值：
   · volGeo —— 球形弥散团还是向下聚光锥。旧实现用 ConeGeometry 收成舞台聚光，
     形态退化**不报错、不崩**，只有几何类型与像素能分辨；
   · volCount / splashCount —— 5 盏灯是否都挂上了（与 lanternSpots 数一致）；
   · tint / uLamp / uRain —— 颜色是否还是暖橙（不是冷白）、是否随灯与雨联动。 */
export function lampVolState(){
  if (!_lampVol) return { on: false, mounted: false };
  const u = _lampVol.uniforms;
  const scales = _volMeshes.map(m => m.scale.y);
  return {
    on: true, mounted: _volMeshes.length > 0,
    uLamp: u.uLamp.value, uRain: u.uRain.value, uTime: u.uTime.value,
    /* 光斑是**另一份**材质/另一组 uniform：它漏跟时段（只跟光团走）时白天不会全透明，
       状态上完全看不出来 —— 所以它必须单独回读。 */
    splashLamp: _groundSplashMat ? _groundSplashMat.uniforms.uLamp.value : null,
    splashRain: _groundSplashMat ? _groundSplashMat.uniforms.uRain.value : null,
    tint: u.uTint.value.getHex(),
    volCount: _volMeshes.length, splashCount: _splashMeshes.length,
    volGeo: _volMeshes[0] ? _volMeshes[0].geometry.type : null,
    volR: scales.length ? { min: +Math.min(...scales).toFixed(3), max: +Math.max(...scales).toFixed(3) } : null,
    /* 基几何半径：`volR` 报的是 mesh.scale，只有当基半径恰好 1 时它才等于**世界半径**。
       把这条关系也回读出来，判据才不会在"基半径被改过"时静默失义。 */
    volGeoR: _volMeshes[0] ? _volMeshes[0].geometry.parameters.radius : null,
    /* 光团**世界球心**：门禁要按它投影出屏幕像素框（`lanternGroups` 存的是挂点 pivot，
       比灯体高一整段吊绳，拿它取景会把窗口摆到光团上方 —— 像素差分自然量不到）。 */
    volPos: _volMeshes.map(m => { const v = new THREE.Vector3(); m.getWorldPosition(v);
      return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]; }),
    splashGeo: _splashMeshes[0] ? _splashMeshes[0].geometry.type : null,
    splashFlat: _splashMeshes.length
      ? _splashMeshes.every(m => Math.abs(m.rotation.x + Math.PI / 2) < 1e-6) : null,
  };
}
/* 只改 uLamp 的强制通道 —— 门禁的**阳性对照**专用。
   ⚠️ 为什么非得有这么个后门：要证明"夜里的光团确实贡献了像素"，只能**只改 uLamp** 拍两张做差分；
   拿"夜 vs 昼"两张整幅比是不干净的（光照/雾/天空/曝光全变了），整幅差分必然很大却证明不了任何事
   —— 同 §29.3 那条"污染源"教训。默认不调用，只由探针在采样瞬间用、用完还原。 */
export function setLampVol(v){ if (_lampVol) _lampVol.uniforms.uLamp.value = v; }
/* ⚠️ 这个函数**不在本模块顶层调用**：它要往 `world` 里挂灯笼，而 world 由 08-assemble 定义、
   08 反过来又 import 本模块（applyEnv / collectSeasonCaches / ENV / onAssetAttached / envEl）
   → 成环，本模块先求值，顶层调用必撞 "Cannot access 'world' before initialization"。
   也**不能**晚于 mergeStatics：灯笼是动态单摆，必须留在合并之外（原 §12 在 §8 合并之后，
   本来就是这个时序）。故由 08 的 body 末尾统一调用，见 08 里的 initEnvScene 注释。 */

/* ── 时段预设 ──
   每个预设是一组扁平的标量与颜色通道。颜色用 hex（number），
   因此需要一份「哪些 key 是颜色 / 向量」的清单来指导构造与插值。 */
const ENV_COLOR_KEYS = ['sunColor','ambColor','hemiSky','hemiGround','fillColor',
                        'skyTop','skyMid','skyHorizon','sunDisk','cloudTint','fogColor',
                        'snowTint',          // 天气：积雪色调（不登记就不会被 makeParams 转成 Color）
                        // 季节植被色调（作用于各自材质）
                        'tinGrass','tinBamboo','tinLeaf','tinReed','tinWillow',
                        'tinLily','tinLotus','tinWisteria','tinBanana','tinTrunk'];
/* ── 天气预设（第三个正交轴）──
   与季节同样的契约：只写「与时段无关」的那部分 ——
   光强 / 雾 / 曝光 / 饱和的乘性或加性修正，加上天气专属通道。
   天气专属通道：cloudAmount / rainAmount / snowAmount / snowCover / wetness /
                windMul / gustMul / skyGray / fogGray / diskFade / snowTint / shadowK
   ⚠️ 每个预设必须写全这些键，否则 mixInto 会在 undefined 上做算术。
   ⚠️ shadowK = 物体影子的强度（2026-09-28 用户反馈："阴霾和薄雾场景不要建筑/
      植物/石头的影子，与现实不符"—— 阴天雾天是漫射光，投不出边界清晰的硬影）。
      1=照常、0=全无；applyEnv 写进 sun.shadow.intensity，切天气时随 mixInto
      逐键缓动 ⇒ 影子在过渡里渐隐渐现，不会"啪"一下消失。暴雨/雪暂维持 1（用户
      只点名这两种；暴雨 sunMul 0.14 本就几乎读不出影感）。 */
const ENV_WEATHER = {
  clear: { weatherLabel:'风和日丽', blizzard:0,
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:1.00, satMul:1.00, expMul:1.00, shadowK:1.00,
    cloudAmount:null, skyGray:0.00, fogGray:0.00, diskFade:0.00,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.0,
    /* 月亮可见度（2026-09-19）：晴夜满月照常；阴/雨/雪按云量打折到 0~0.3。
       老黄点名要"风和日丽场景下"有月亮 —— 所以晴=1.0 是基准，其余按"云有多厚"递减。 */
    windMul:1.00, gustMul:1.00, moonVis:1.00, snowTint:0xF2F6FA },
  storm: { weatherLabel:'狂风暴雨', blizzard:1,   // 冬季 → 下面的 blizzard 分支会把它变成风雪
    /* sunMul 0.38 → 0.14（2026-09-18 · 用户报「狂风暴雨里有些地方像有太阳透下来」）。
       0.38 是"还能看出方向感"的取法，但它把直射项留在了一个**可见**的量级上，
       和下面两条叠加就穿帮：① 湿地把石材/瓦/草地压成半镜面，直射项被反射成
       顺着视线跑的金色高光带（换个角度就特别明显）；② 影子的边界外没有阴影测试
       （旧阴影视体比园子还小），边界处影子被硬切出一条亮缝。
       真正的暴雨里直射项本就该≈0，画面靠 ambMul/hemiMul 撑（0.85/0.90 已够）。
       0.14 保留一丝方向感让体块读得出来，但不足以在地面/墙面结成亮带。 */
    /* 2026-09-29 二轮（老黄："秋+暴雨整个颜色基调太难看"）：四层灰叠加（雾2.40×秋1.18、
       环境0.85、饱和0.84、曝光0.95）把画面压成"脏灰老照片"。整体去闷：
       雾 2.40→1.70（雨幕该有、灰汤不该有）、环境/天光抬回接近满档（阴雨天靠天光照亮）、
       饱和 0.92、曝光回 1.00；sunMul 保持 0.14（无直射阳光的设定不变）。 */
    sunMul:0.14, ambMul:0.95, hemiMul:1.00, fogMul:1.70, satMul:0.92, expMul:1.00, shadowK:1.00,
    cloudAmount:1.00, skyGray:0.55, fogGray:0.30, diskFade:0.85,
    rainAmount:1.0, snowAmount:0.0, snowCover:0.0, wetness:1.0,
    windMul:4.00, gustMul:0.30, moonVis:0.00, snowTint:0xF2F6FA },   // 暴雨/风雪：全天无月
  /* ══ 雨后初晴（2026-09-30 · 老黄选的第 6 个场景）══════════════════════════
     "雨刚停，瓦片/石板/树叶还在滴水，太阳出来了；地面和池塘亮得反光，
      空气里飘着一层薄薄的水汽，草和树绿得发亮" + 加一道七色彩虹。
     取值逻辑（每一条都对应"雨刚停"的某个可感知的物理事实）：
       · rainAmount 0     —— 雨已经停了。这是"雨后"与"雨中"的唯一硬区别。
       · wetness 0.85      —— 地面/瓦/石/叶全是湿的 ⇒ 出现反光，亮得起来。
                              （这是"亮得反光"的来源，比调曝光物理。）
       · fogMul 1.08 + fogGray 0.05 —— **薄**水汽（2026-09-30 二轮实测后大幅调低）：
                              第一版给了 fogMul 1.35 / fogGray 0.10，画面亮度是够的
                              （实测 147 比晴天 141 还亮），但**老黄反馈"没有阳光"** ——
                              真因是这层雾把**方向感**洗掉了：整园蒙一层均匀亮雾
                              ⇒ 读作"阴天/薄雾"而不是"雨后太阳出来了"。
                              水汽要"薄"就得几乎不遮，现在只留一点点湿润感。
       · cloudAmount 0.42  —— 雨后的典型天：还有残余的云（彩虹要靠云作背景才读得出来），
                              但已是碎云，太阳大部分露在外面。
       · sunMul 0.95       —— 太阳出来了（2026-09-30 二轮 0.78 → 0.95）：直射接近晴天，
                              阴影方向明确，地面才有"被太阳照亮"的感觉。
                              不给满 1.0 是因为刚下过雨、地面反光强，直射过满会曝成死白。
       · diskFade 0.02     —— **日轮清晰可见**（2026-09-30 二轮 0.15 → 0.02）：
                              0.15 等于把太阳抹掉 85%，天上根本没有太阳，"没有阳光"。
       · satMul 1.06 / expMul 1.02 —— "草和树绿得发亮"：饱和与曝光都抬一点，
                              配合 wetness 的反光 = 洗过的绿。
       · shadowK 1.00      —— 有太阳就有影子（阴霾/雾是 0；这里必须 1，
                              否则"太阳出来了"在画面上读不出来）。
       · windMul 0.75      —— 雨后风小（暴雨 4.00）；只留一点微风让叶还在动。
       · rainbow:1.0       —— 本预设独有：七色彩虹（见 skyMesh 着色器与 applyEnv）。
     ⚠️ 预设必须写全所有键：mixInto 在 undefined 上做算术，缺键会算出 NaN
        （见本表上方的说明）。 */
  afterrain: { weatherLabel:'雨后初晴', blizzard:0, rainbow:1.0,
    sunMul:0.95, ambMul:1.00, hemiMul:1.04, fogMul:1.08, satMul:1.06, expMul:1.02, shadowK:1.00,
    cloudAmount:0.42, skyGray:0.06, fogGray:0.05, diskFade:0.02,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.85,
    windMul:0.75, gustMul:0.55, moonVis:0.00, snowTint:0xF2F6FA },
  /* 2026-09-28 老黄："阴霾暗沉和薄雾烟霭感官上太一致，保留薄雾" —— 从菜单/键盘/
     随机池收起（hidden）；预设数据保留（mist-guard 仍直调 setEnv 测雾管线），恢复只需去掉 hidden。 */
  overcast: { weatherLabel:'阴霾暗沉', blizzard:0, hidden: true,
    sunMul:0.55, ambMul:0.95, hemiMul:0.96, fogMul:1.55, satMul:0.72, expMul:0.98, shadowK:0.00,
    cloudAmount:1.00, skyGray:0.72, fogGray:0.62, diskFade:1.00,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.0,
    windMul:1.15, gustMul:1.00, moonVis:0.00, snowTint:0xF2F6FA },   // 阴霾：云底满天，看不见月
  snow: { weatherLabel:'银装素裹', blizzard:0,
    sunMul:0.62, ambMul:1.10, hemiMul:1.12, fogMul:1.30, satMul:0.80, expMul:1.00, shadowK:1.00,
    cloudAmount:0.94, skyGray:0.60, fogGray:0.55, diskFade:0.90,
    rainAmount:0.0, snowAmount:1.0, snowCover:1.0, wetness:0.0,
    windMul:1.35, gustMul:1.00, moonVis:0.12, snowTint:0xF4F8FF },   // 雪霁：云缝里透一点月色
  /* 薄雾烟霭：全季节合法。它不是"阴"—— 雾的本质是**雾本身变厚**（fogMul 1.3：
     正午 0.0052×1.3≈0.0068，晨间 0.0088×1.3≈0.011），天空只轻度去色、日轮留一个
     淡淡的白色圆盘（diskFade 0.7），湿气贴地（wetness 0.25）。
     ⚠️ 浓度调过四档：4.4 → 2.7 → 1.7 → 1.3。用户实测视角是**晨时**（晨的雾基数本来
     就是正午的 1.7 倍）：1.7 时主厅立面仍被洗成灰白（40m 处雾覆盖 30%）。
     量过关键段：1.3 时主厅段 ≈20%、60m ≈28%、远山 120m ≈50%、200m ≈75% ——
     "近清远朦"的灰阶阶梯成立，雾只剩三个职责：吞远山、压低日轮、中景蒙纱。
     ── 2026-09-28 活雾批次：1.3 → 1.8（老黄："雾气再浓一些"）。1.8 只是**底**，
     真正的浓淡由 ENV_TIME 的 mistMul 随时辰调制（晨 1.45 / 午 0.82 / 暮 1.30 /
     夜 0.72）：晨有效 2.61 正是老黄要的"整个正堂雾蒙蒙"（正堂前另有雾团半遮半掩，
     见 06 的 FOG_BANKS）；夜有效 1.8×0.72≈1.30 与旧版持平，night+mist 水位不动。 */
  mist: { weatherLabel:'薄雾烟霭', blizzard:0,
    sunMul:0.85, ambMul:1.05, hemiMul:1.08, fogMul:1.80, satMul:0.96, expMul:1.02, shadowK:0.00,
    cloudAmount:0.30, skyGray:0.22, fogGray:0.26, diskFade:0.70,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.25,
    windMul:1.00, gustMul:0.60, moonVis:0.30, snowTint:0xF2F6FA },   // 薄雾：月色被雾纱吃掉了七成
  /* ══ 电闪雷鸣（2026-09-30 · 老黄需求）════════════════════════════════════
     ⚠️ 2026-09-30 当晚合并进「狂风暴雨」：老黄"这两个场景可以合并，空出一个格子"。
        这个预设的观感（压到暮色之下）**原样保留在表里、标 hidden**：菜单/键盘/
        随机池都不再出现，但直接 setEnv('weather','thunder') 仍可用（thunder-guard
        门禁就靠这条路径复测闪电机制；LN_ALLOWED 里也还留着 'thunder'）。
        暴雨自己也会打闪电 ⇒ 机制两条路径都能验。
     下面这段注释描述的是它当初的取���逻辑（改暴雨时一并参考）：
     "把整个光线全部暗下来，达到或者接近暮色的光影效果" —— 只负责**暗**：
     直射几乎全关（sunMul 0.05）、环境/天光压到一半（0.47/0.50）、曝光压到 0.68、
     天空往深灰拉（skyGray 0.86 ⇒ 乌云压顶）、雨量满、地面全湿、风大。
     闪电（分叉雷电 + 亮痕 + 全场照亮 + 天幕泛白）与雷鸣由 tickLightning 叠加，
     不写在这里 —— 它们是把光照**乘**一个瞬时系数，天气表管不了"阵发"。
     ⚠️ moonVis 0（乌云压顶看不见月）、shadowK 0（没有直射就没有影子）。

     ── 曝光 0.86 → 0.76 → 0.68（2026-09-30，实测定的，不是估的）──
     `probe/thunder-guard.mjs` 同机位（夏·正午）冻结帧量平均亮度：
       晴 142.1 / 暴雨 133.7 / **电闪雷鸣** / **暮色(晴)** —— 三档实测：
       0.86 ⇒ 雷电 111.1 vs 暮色 97.6（亮 14%，多模态读成"大白天阴雨"）；
       0.76 ⇒ 雷电 103.0 vs 暮色 97.2（亮 6%，**判据贴边**，只剩 1.8 余量）；
       0.68 ⇒ 回到暮色之下（判据留 9 余量）。
     结论：只靠 skyGray 压不暗 —— grayMix 的靶色是固定的中灰
     （SKY_GRAY 0x8E949C / FOG_GRAY 0x9AA0A6），0.86 已接近它的极限；
     真正能"把整个光线全部暗下来"的是曝光。
     ⚠️ 判据那条（thunder 平均亮度 ≤ 暮色 + 4）**不许为了让门变绿而放宽** ——
     它是老黄那句"接近暮色"的可测形式；要动就动预设。
     ⚠️ hidden:true 只是**不进随机池**（randomScene 的 !hidden 过滤；R_W_BASE 里也没有它），
     按钮与键盘 H 照常 —— 老黄要的是"一个可选的场景"。随机撞进雷雨时音景多半没开
     （音频必须由用户手势才能起），会变成"闪电没雷声"的半成品。 */
  thunder: { weatherLabel:'电闪雷鸣', blizzard:0, hidden: true,
    sunMul:0.05, ambMul:0.47, hemiMul:0.50, fogMul:1.80, satMul:0.82, expMul:0.68, shadowK:0.00,
    cloudAmount:1.00, skyGray:0.86, fogGray:0.42, diskFade:1.00,
    rainAmount:1.0, snowAmount:0.0, snowCover:0.0, wetness:1.0,
    windMul:3.60, gustMul:0.30, moonVis:0.00, snowTint:0xF2F6FA },
};
/* 互斥矩阵 —— 唯一权威在这里。
   · 银装素裹仅冬季（其余季节按钮置灰，悬停给出原因）
   · 冬 + 狂风暴雨 → 渲染为风雪（雨置换为雪、给积雪）；其余季节是雨
   返回 null 表示该组合合法。 */
const WEATHER_RULES = {
  snow: s => s === 'winter' ? null : '仅冬季可用',
};
export function weatherMutexReason(weather, season){
  const r = WEATHER_RULES[weather];
  const why = r ? r(season) : null;
  return why || null;
}
/* 实际落到画面的天气效果：风雪 = 暴雨的强度 + 雪的存在形式 */
/* 只有标签需要随季节改写：天气是 storm，但冬季画面上是风雪。
   snowAmount 等参数由 applyWeatherTo 的 blizzard 分支负责，不在这里改。 */
function weatherLabelOf(weather, season){
  // 冬 + 暴风 = 狂风细雨：冬天下暴雨是个伪命题，画面该是"风大、雨细、天暗、地湿"的凄凉感
  if (weather === 'storm' && season === 'winter') return '狂风细雨';
  return (ENV_WEATHER[weather] || ENV_WEATHER.clear).weatherLabel;
}
export function weatherTag(){
  // 一律读解析后的值：冬季暴雨的天气轴是 storm，但画面上是风雪，不该显示"狂风暴雨"
  const p = ENV.cur && ENV.cur.weatherLabel;
  return p || weatherLabelOf(ENV.weather, ENV.season);
}
export function effectiveWeather(){
  if (ENV.weather === 'storm' && ENV.season === 'winter') return 'winterrain';
  return ENV.weather;
}

/* ── 天气参数叠加 ──
   在「时段 × 季节」之后叠第三层。与季节同构：乘性修正打底，专属通道只在该预设出现时写入。
   skyGray / fogGray 是把天空与雾往一个中性灰上拉 —— 「阴」这件事本质上是**去色 + 去直射光**，
   而不是单纯压暗，所以做成混色而不是乘一个系数。 */
const SKY_GRAY  = new THREE.Color(0x8E949C);
const FOG_GRAY  = new THREE.Color(0x9AA0A6);
function grayMix(col, gray, amount){
  if (amount <= 0) return;
  col.r += (gray.r - col.r) * amount;
  col.g += (gray.g - col.g) * amount;
  col.b += (gray.b - col.b) * amount;
}
function applyWeatherTo(p, eff){
  const w = ENV_WEATHER[ENV.weather] || ENV_WEATHER.clear;
  p.sunIntensity  *= w.sunMul;
  p.ambIntensity  *= w.ambMul;
  p.hemiIntensity *= w.hemiMul;
  p.fogDensity    *= w.fogMul;
  p.exposure      *= w.expMul;
  p.grade.saturation *= w.satMul;
  p.cloudAmount = (w.cloudAmount === null) ? p.cloudAmount : w.cloudAmount;
  p.rainAmount = w.rainAmount; p.snowAmount = w.snowAmount;
  p.snowCover  = w.snowCover;  p.wetness    = w.wetness;
  p.windMul    = w.windMul;    p.gustMul    = w.gustMul;
  /* 月：预设里给的是"天气允许度"，乘到时段基准上（时段基准恒为 1，见 paramsAtHour）。
     ⚠️ 两侧都要兜底：resolveEnv 在 ENV.hour 未定义时会走 makeParams(ENV_TIME[...])
     那条路，那份对象里没有 moonVis —— 不兜底就是 undefined → NaN 传进 uniform。 */
  p.moonVis = (p.moonVis === undefined ? 1 : p.moonVis) * (w.moonVis === undefined ? 1 : w.moonVis);
  /* 影子强度随天气（2026-09-28 用户："阴霾和薄雾不该有影子"，见表头 shadowK 注释）：
     直取天气预设值、缺键兜底 1。进了参数集 ⇒ mixInto 随天气切换逐帧缓动。 */
  p.shadowK = (w.shadowK === undefined ? 1 : w.shadowK);
  /* 七色彩虹（2026-09-30 雨后初晴）：只有该预设给 1，其余全部 0（缺键兜底 0，
     不能兜底成 1 —— 否则每个天气都会挂一道虹）。同样进参数集 ⇒ 切天气时
     随 mixInto 淡入淡出，不"啪"一下出现。 */
  p.rainbow = (w.rainbow === undefined ? 0 : w.rainbow);
  /* ── 活雾（2026-09-28 老黄设计："半遮半掩"随辰换景）──
     雾的"性格"跟一天时辰走：晨浓裹正堂、午间散开、午后复起遮竹林、夜里收平。
     三个键来自 ENV_TIME 时段预设（paramsAtHour 沿时辰连续插值），**只在 mist 天气
     生效**：mistMul 再乘雾密度（底 1.8 × 时辰档 0.72~1.45）；bankHall / bankBamboo
     是两团"半遮半掩"雾团的淡入值（0=全无，两团在 06 的 FOG_BANKS）。非雾天一律
     归 0 —— 晴/雨/雪的雾浓度不因 mistMul 变化。 */
  if (ENV.weather === 'mist'){
    p.fogDensity *= (p.mistMul === undefined ? 1 : p.mistMul);
    p.bankHall   = (p.bankHall === undefined ? 0 : p.bankHall);
    p.bankBamboo = (p.bankBamboo === undefined ? 0 : p.bankBamboo);
    p.bankBridge = (p.bankBridge === undefined ? 0 : p.bankBridge);
    p.bankRockery= (p.bankRockery === undefined ? 0 : p.bankRockery);
  } else {
    p.bankHall = 0; p.bankBamboo = 0; p.bankBridge = 0; p.bankRockery = 0;
  }
  p.skyGray    = w.skyGray;    p.fogGray    = w.fogGray;  p.diskFade = w.diskFade;
  p.weatherLabel = weatherLabelOf(ENV.weather, ENV.season);
  p.blizzard = w.blizzard || 0;          // 供统计栏/调试判断"这是不是风雪"，不参与插值
  p.snowTint = new THREE.Color(w.snowTint);
  if (eff === 'winterrain'){
    /* 冬季暴雨 = 风雪。这里以前是错的：把 snowAmount/snowCover/cloudAmount/skyGray/diskFade
       全部硬编码，等于把 storm 剩下的部分**退化成 snow 预设**，再叠上 storm 的光照系数。
       结果"冬季狂风暴雨"和"银装素裹"只差一点风、一点雾 —— 用户一眼就看出来了。
       正确做法是**换相态，不换性格**：雨→雪，但暴雨该有的强降水与狂风全部保留。 */
    /* 相态**保持液态**：冬 + 暴雨 = 狂风细雨。原来这里是"换相态成风雪"，
       用户判为"伪命题"—— 冬天下暴雨本来就该是凄凉的冷雨，不该变成暴风雪。
       强风/暗光/厚雾全部保留（那是暴风的性格），只把降水改成细雨、并且不积雪。 */
    p.rainAmount = 0.62;                 // 细雨：比夏天暴雨（1.0）细，但仍是持续降水
    p.snowAmount = 0.0;
    p.snowCover  = 0.0;                  // 湿冷的地面，而不是积雪
    p.cloudAmount = 1.0;
    p.skyGray = Math.max(p.skyGray, 0.72);
    p.fogGray = Math.max(p.fogGray, 0.45);
    p.diskFade = 1.0;
    p.exposure *= 0.90;                  // 比夏雨再暗一点，压出冬天的阴沉
    // windMul / gustMul / sunIntensity / fogDensity 一律沿用 storm 自己的值，不再覆盖
  }
  if (eff === 'snow'){
    p.snowAmount = 1.0; p.snowCover = 1.0; p.rainAmount = 0.0;
  }
  grayMix(p.skyTop,     SKY_GRAY, p.skyGray);
  /* 中段也得跟着去色，否则阴雨天地平线和天顶都灰了、腰上还横着一条彩色残带 */
  if (p.skyMid) grayMix(p.skyMid, SKY_GRAY, p.skyGray * 0.8);
  grayMix(p.skyHorizon, SKY_GRAY, p.skyGray);
  grayMix(p.fogColor,   FOG_GRAY, p.fogGray);
  return p;
}

const ENV_TIME = {
  morning: { label:'晨',
    sunColor:0xFFD2A0, sunIntensity:1.05, sunPos:[58, 20, 26],
    ambColor:0x9CB0C6, ambIntensity:0.58,
    hemiSky:0xD8E4F0, hemiGround:0x6E7A50, hemiIntensity:0.42,
    fillColor:0xBCCFE0, fillIntensity:0.40,
    /* F4 二轮校准：旧 mid #E4D6C6 是暖米色，新渐变在低视角（hh≈0.14）下中腰
       已接管 75% → 整片晨天成奶米色、蓝全丢。中腰改淡蓝灰 #C6D6E2，
       暖色只压地平线一窄条；云量 0.96→0.62 透出天蓝。 */
    skyTop:0x93B0CE, skyMid:0xC6D6E2, skyHorizon:0xF0DFC8, sunDisk:0xFFE7BC,
    cloudTint:0xFBF3E8, cloudAmount:0.62,
    fogColor:0xE6E0D4, fogDensity:0.0088, exposure:1.06,
    bloomStrength:0.36, bloomRadius:0.52, bloomThreshold:1.00, gtaoBlend:0.85,
    grade:{ contrast:0.13, saturation:1.02, split:0.30, vignette:0.50, warm:0xFFF2E0, cool:0xE6EEFF },
    /* 活雾三键（仅 mist 天气生效，见 applyWeatherTo）：晨 = 大雾裹正堂 ——
       mistMul 再乘雾密度、正堂雾团最浓、竹林雾团只留一线。 */
    starAmount:0.0, lamp:0.0, mistMul:1.45, bankHall:0.55, bankBamboo:0.12, bankBridge:0.25, bankRockery:0.50 },
  noon: { label:'午',
    /* F8 光照"晴感"再平衡（2026-09-21 · 三张正午样张一致指出"像阴天"）：
       原 sun1.12 / 环境 amb.50+hemi.35+fill.32=1.17 —— 直射仅占 49%，阴影被环境光
       稀释，读起来柔和泛灰、无烈阳感。改 sun 1.22、环境降到 .42+.30+.26=.98：
       总强度 2.29→2.20（微降 4%，亮度基本不变），直射占比 49%→55% ——
       阴影更深、形体更利落，正午才像"晴"。只动 noon，不碰 morning/dusk/night。 */
    sunColor:0xFFF6E2, sunIntensity:1.22, sunPos:[42, 56, 30],
    ambColor:0x8899AA, ambIntensity:0.42,
    hemiSky:0xE8ECEA, hemiGround:0x6B7B52, hemiIntensity:0.30,
    fillColor:0xBCD2E0, fillIntensity:0.26,
    /* F7 二轮：俯视机位可见天空带在 h≈0.50~0.72（horizon→mid 过渡），
       mid #D2DCE4 太淡，整条带读成灰白。mid 换成明确些的天蓝，
       天顶同步加深半档，白墙上方终于"有天"。暮色走自己的暖 mid，不受影响。 */
    /* F7 三轮（实测俯视机位）：画面顶端 hh≈0.14，天空带本该是 mid 天蓝，
       但 cloudAmount 0.88 的近白 FBM 云把它整片盖成灰白 —— 天不蓝、建筑蒙纱。
       云量降到 0.58，mid 加深半档、horizon 染极淡青，曝光回到 1.00，
       grade 对比/饱和微提；草色本来就够艳，不能再猛加饱和。 */
    skyTop:0x8FB2D4, skyMid:0xADCBE6, skyHorizon:0xDCE7EC, sunDisk:0xFFF3D8,
    cloudTint:0xF6F9FC, cloudAmount:0.58,
    /* fogDensity 0.0052（F7 后回归校准）：晴午仍保持四时段里最通透一档；
       薄雾天气 fogMul 1.30 后 =0.0068，正好落进 smoke 断言的 (0.0062,0.0085)
       可读窗口 —— 旧值 0.0046 叠雾只有 0.0060，雾天与晴天拉不开差距。 */
    fogColor:0xDCE3E2, fogDensity:0.0052, exposure:1.00,
    bloomStrength:0.26, bloomRadius:0.50, bloomThreshold:1.02, gtaoBlend:0.85,
    grade:{ contrast:0.25, saturation:1.12, split:0.24, vignette:0.50, warm:0xFFF6E8, cool:0xE2EEFF },
    /* 2026-09-28 二轮（老黄："中午几乎就没有了，不能没有，只是淡一点"）：mistMul
       0.82→1.10（有效 1.98，晨 2.61 的 ~76%——比晨淡、但明显有雾）；雾团也留三成
       而不是归零（bankHall 0.28 / bankBamboo 0.22）。 */
    starAmount:0.0, lamp:0.0, mistMul:1.10, bankHall:0.28, bankBamboo:0.22, bankBridge:0.15, bankRockery:0.20 },   // 午：淡一档但仍见雾
  dusk: { label:'暮',
    sunColor:0xFFA45C, sunIntensity:1.00, sunPos:[-56, 15, 30],
    ambColor:0x6E7B96, ambIntensity:0.44,
    hemiSky:0xC6A98E, hemiGround:0x5A5240, hemiIntensity:0.36,
    fillColor:0x8FA8C8, fillIntensity:0.34,
    /* 暮色三停（2026-09-21 走查 F4，二轮按实测俯视机位校准）：默认机位画面顶端
       h≈0.53，可见天幕几乎全是 horizon 区 —— 旧值 #EFB983 芒果橙把整片天染黄，
       0.95 云量的 #F6D4A8 橙云再补一刀。现在 horizon 压成低亮度陶土暖灰 #D0AC86
       （橙味保留、饱和度砍半），中腰换成更中性的灰褐 #BCAEA4，云染成暗暖灰
       #C9B39A（暮色云底本就该比天暗），天顶灰青蓝不变；真正的橙只留在日轮方向。 */
    skyTop:0x6A7A9A, skyMid:0xB4AEAE, skyHorizon:0xC9A072, sunDisk:0xFFC070,
    /* 暮色云量从 0.95 降到 0.50，云染浅暖灰：FBM 云在旧值下几乎铺满可见天幕。
       注意云不能染暗 —— 实测暗云色被 FBM 大软斑铺成"浓烟带"；暮色高空云
       仍被余辉照亮，该比中腰略亮、带一丝暖。 */
    cloudTint:0xC2B6A8, cloudAmount:0.50,
    /* F5（2026-09-21 走查二轮）：雾色去橙改低饱和暖灰，密度基数 0.0074
       （秋 fogMul 1.18 后 ≈0.0087，旧版同组合是 0.0120）—— 远山仍蒙雾，
       但中景不再被整片染暖。 */
    fogColor:0xCEC2B0, fogDensity:0.0074, exposure:1.00,
    bloomStrength:0.46, bloomRadius:0.58, bloomThreshold:0.94, gtaoBlend:0.92,
    /* saturation 1.04→0.97：暮色草地旧值下仍是高饱和翠绿，整体去艳半档，
       让暮色统一在灰暖调里。 */
    grade:{ contrast:0.20, saturation:0.97, split:0.42, vignette:0.56, warm:0xFFE4C0, cool:0xC8D8F0 },
    starAmount:0.0, lamp:0.25, mistMul:1.30, bankHall:0.14, bankBamboo:0.55, bankBridge:0.50, bankRockery:0.30 },  // 暮：雾复起，这回沉在竹林
  night: { label:'夜',
    sunColor:0xA8BEE0, sunIntensity:0.38, sunPos:[-34, 52, -22],
    /* 幽而不黑（2026-09-21 方案 n1，两轮收敛）：
       一轮 amb 0.20→0.27/hemi 0.15→0.21/fill 0.12→0.16/exposure 1.05→1.10，
       全景终拍仍是"欠曝的暗"：墙灰闷、游廊内部死黑、石竹沉底。
       二轮加月光方向感（sun 0.26→0.38，让瓦/墙/水面吃得到月光棱线），
       amb/hemi/fill 再抬一档，曝光 1.14、对比 0.15 —— 暗部透气、月光成影，
       而 ambColor 仍是暗蓝（0x2C3852），月夜冷调不破。 */
    ambColor:0x2C3852, ambIntensity:0.33,
    hemiSky:0x2A3A58, hemiGround:0x1A1E18, hemiIntensity:0.26,
    fillColor:0x30405E, fillIntensity:0.19,
    skyTop:0x0B1220, skyMid:0x182336, skyHorizon:0x24304A, sunDisk:0xDCE6F8,
    cloudTint:0x4A5878, cloudAmount:0.55,
    /* 雾 0x141C2A→0x182230：夜雾提一档成蓝灰（lum 0.107→0.129，仍低于
       applyEnv 的雾色上限 0.15），远山不再被纯黑雾吞死。
       exposure 1.05→1.14：ACES 中间调整体抬档 —— 月盘峰值 0.56×1.14≈0.64，
       仍在 bloom 阈值 0.90 之下，不引发月晕复发。 */
    fogColor:0x182230, fogDensity:0.0092, exposure:1.14,
    /* bloom 收敛（2026-09-21 月面对拍像素扫描）：旧 strength 0.62 / radius 0.62
       把月盘（即使压暗后）与灯芯糊成半径百余像素的光团。radius 收到 0.46、
       strength 0.50、threshold 0.90 —— 灯笼芯仍泛暖晕，但不再大面积洗白夜空。 */
    bloomStrength:0.50, bloomRadius:0.46, bloomThreshold:0.90, gtaoBlend:1.00,
    /* contrast 0.22→0.15：S 曲线对暗部的压黑逐轮退档（0.22→0.18→0.15），
       与 amb 提亮配套，暗部层次（墙裙/瓦当/石阶）不再糊死。 */
    grade:{ contrast:0.15, saturation:0.92, split:0.34, vignette:0.55, warm:0xE8D8C0, cool:0x9FB8E0 },
    /* 夜 mistMul 0.72 ⇒ 有效雾系数 1.8×0.72≈1.30，与旧版常数持平：night+mist 的画面
       与 mist-guard 的水位完全不动（夜里不加浓，画面别变脏）。 */
    starAmount:1.0, lamp:1.0, mistMul:0.72, bankHall:0.08, bankBamboo:0.08, bankBridge:0.30, bankRockery:0.08 },
};

/* ── 季节预设 ──
   季节只写「与时段无关」的那部分：植被色调 / 存在性 / 动物行为，
   外加少量对时段结果的乘性修正（光强、雾、饱和）。
   植被色调采用「保留明度的换色」（见 addSeasonTint）：tintMix=0 表示完全保留原色。 */
export const ENV_SEASON = {
  spring: { label:'春',
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:0.94, satMul:1.03,
    tinGrass:0x9CC85E, tinBamboo:0xAED078, tinLeaf:0x8ECB58, tinReed:0x9CC86A,
    tinWillow:0xB4D47C, tinLily:0x3E7A34, tinLotus:0xF2C7D4, tinWisteria:0x9B6FC4,   // 春：垂柳新芽淡绿（用户常识反馈）
    tinBanana:0x62B054, tinTrunk:0x3B2A1E, tintMix:0.50,
    lilyShow:0.05, lotusShow:0.05, wisteriaShow:1.0, bananaShow:0.9, reedShow:0.85, willowLeaf:0.38,   // 春：柳帘均匀变疏=新芽初绽（38%+洗牌）
    /* 竹叶季节叶量（2026-09-16 用户："初春先抽竿长叶、夏要茂密"）——
       系数×基数（12~21 片/枝）＝绝对量。夏 1.0 ≈ 4.2 万片（茂密）；
       春 0.28 ≈ 1.2 万片（初春抽竿后刚长叶，绝对量与旧版春一致）；
       秋 0.43 ≈ 1.8 万片（微落）；冬 0.33 ≈ 1.4 万片（常绿稍疏） */
    bambooLeaf:0.28, koiSpeed:1.0, dragonflyShow:0.35, turtleShow:1.0, gooseShow:1.0,   // 春：大雁北迁过境
    /* 春：先花后叶。花满树、叶始萌（15% 刚抽的嫩芽），落花初落 —— 桃是先花后叶树种 */
    peachShow:0.15, peachBlossomShow:1, peachFruitShow:0, peachPetalShow:0.3 },
  summer: { label:'夏',
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:1.00, satMul:1.00,
    tinGrass:0xFFFFFF, tinBamboo:0xA8C46A, tinLeaf:0x4E8C36, tinReed:0x3F6B34,
    tinWillow:0x5E9638, tinLily:0x3E7A34, tinLotus:0xF2C7D4, tinWisteria:0x9B6FC4,   // 夏：翠绿繁茂（用户常识反馈）
    tinBanana:0x4F9440, tinTrunk:0x3B2A1E, tintMix:0.0,
    lilyShow:1.0, lotusShow:1.0, wisteriaShow:1.0, bananaShow:1.0, reedShow:1.0, willowLeaf:1.0,
    bambooLeaf:1.0,
    koiSpeed:1.0, dragonflyShow:1.0, turtleShow:1.0, gooseShow:0.0,   // 夏：无雁（盛夏非迁徙季）
    /* 夏：花落尽、桃结果（叶茂果生，落花也快被扫净只余淡痕） */
    peachShow:1, peachBlossomShow:0, peachFruitShow:1, peachPetalShow:0.45 },  autumn: { label:'秋',
    sunMul:0.97, ambMul:0.95, hemiMul:0.96, fogMul:1.18, satMul:1.06,
    /* 秋竹叶：0xD8A94E（绿度 −47，金黄）→ 0x93A656（绿度 +19，转暗的秋绿）。
       ⚠️ 与冬季同一处数据错误的**遗留副本**：当年只修了竹竿通道 tinBamboo
       （见 winter 段注释），漏了竹叶通道 tinLeaf —— 而竹叶正是画面上竹子的主体。
       竹是**常绿**植物，秋不黄（黄=枯死），秋天该是"比夏暗、比冬绿"的中间档；
       原值把秋竹染成金黄，冬天换回橄榄（+2），于是"秋黄→冬返绿"。
       修完绿度阶梯：夏 +62 → 秋 +19 → 冬 +2，单调下降。 */
    tinGrass:0xC2AE66, tinBamboo:0xBCBE72, tinLeaf:0x93A656, tinReed:0xC4AC6E,
    tinWillow:0xDCAE52, tinLily:0x6E8A3E, tinLotus:0xE0B894, tinWisteria:0xB08858,
    tinBanana:0xA89E54, tinTrunk:0x3B2A1E, tintMix:0.76,
    lilyShow:0.55, lotusShow:0.42, wisteriaShow:0.35, bananaShow:0.7, reedShow:1.0, willowLeaf:0.72,
    bambooLeaf:0.43,
    koiSpeed:1.0, dragonflyShow:0.35, turtleShow:1.0, gooseShow:1.0,   // 秋：大雁南迁过境
    /* 秋：桃叶转黄（tinLeaf）、果渐疏（快被摘/落尽），花/落花早没了 */
    peachShow:1, peachBlossomShow:0, peachFruitShow:0.7, peachPetalShow:0 },
  winter: { label:'冬',
    sunMul:0.88, ambMul:0.93, hemiMul:0.94, fogMul:1.28, satMul:0.70,
    /* ⚠️ 冬季植被色**必须比秋季更灰**，这是之前的数据错误：
       旧值 竹 0x8E9A6E（绿度 +12）vs 秋 0xBCBE72（绿度 +2）——
       冬季的绿分量反而比秋季更高，于是"秋天黄了、冬天又绿回来"。
       柳叶更夸张：秋 0xDCAE52（绿度 −46，明显偏黄）vs 冬 0x828458（绿度 +2，转绿）。
       现在统一压成**低饱和的灰绿／灰黄**（绿度 ≤ 3，亮度维持原量级），
       与冬季 satMul 0.70 的降饱和叠加后是"枯槁"而不是"返青"。 */
    tinGrass:0x8E8874, tinBamboo:0x9C9878, tinLeaf:0x7C7E5E, tinReed:0x958E72,
    tinWillow:0xA08C66, tinLily:0x6A6850, tinLotus:0xAAA096, tinWisteria:0x8A7A68,
    tinBanana:0x9C8A58, tinTrunk:0x4A4038, tintMix:0.72,   // 芭蕉冬色提亮：0x87805A→0x9C8A58（旧色偏暗被环境绿反射洗成橄榄绿，枯黄读不出来）
    // 紫藤花期是开春四五月（见交接文档来源），冬季不该有花；藤枝走 MAT.bark，不受这里影响
    // 冬季水面不留绿：水草(MAT.reed)整片收掉，否则池面在冬天还浮着一簇簇绿草
    lilyShow:0.0, lotusShow:0.0, wisteriaShow:0.0, bananaShow:0.0, reedShow:0.0, willowLeaf:0.0,
    /* 冬：芭蕉叶幕枯落（多年生草本，假茎宿存——第九轮用户常识反馈）；
       柳叶**掉光**（垂柳是落叶乔木，裸枝过冬——2026-09-19 老黄科学反馈；
       0.02 是旧"变稀"思路残留，164 片残叶肉眼仍读作"挂着"）。 */
    bambooLeaf:0.33,   // 冬：竹常绿但疏（不落叶，只是密度回落）
    koiSpeed:0.42, dragonflyShow:0.0, turtleShow:0.0, gooseShow:0.0,   // 冬：无雁（越冬地不在此）
    /* 冬：桃树落叶，裸枝过冬（同冬柳）——叶落尽、无花无果无落花 */
    peachShow:0, peachBlossomShow:0, peachFruitShow:0, peachPetalShow:0 },
};

/* 预设 → 可插值参数对象 */
function makeParams(src){
  const o = {};
  for (const k in src){
    const v = src[k];
    if (ENV_COLOR_KEYS.indexOf(k) >= 0) o[k] = new THREE.Color(v);
    else if (Array.isArray(v)) o[k] = v.slice();
    else if (k === 'grade') o.grade = { ...v, warm:new THREE.Color(v.warm), cool:new THREE.Color(v.cool) };
    else o[k] = v;
  }
  return o;
}
function cloneParams(p){
  const o = {};
  for (const k in p){
    const v = p[k];
    if (v && v.isColor) o[k] = v.clone();
    else if (Array.isArray(v)) o[k] = v.slice();
    else if (k === 'grade') o[k] = { ...v, warm:v.warm.clone(), cool:v.cool.clone() };
    else o[k] = v;
  }
  return o;
}
/* 逐通道插值（就地写入 out） */
export function mixInto(out, a, b, t){
  for (const k in a){
    const va = a[k], vb = b[k], o = out[k];
    if (typeof va === 'number') out[k] = va + (vb - va) * t;
    else if (va && va.isColor) o.copy(va).lerp(vb, t);
    else if (Array.isArray(va)) { for (let i = 0; i < va.length; i++) o[i] = va[i] + (vb[i] - va[i]) * t; }
    else if (k === 'grade'){
      for (const gk in va){
        if (typeof va[gk] === 'number') o[gk] = va[gk] + (vb[gk] - va[gk]) * t;
        else if (va[gk] && va[gk].isColor) o[gk].copy(va[gk]).lerp(vb[gk], t);
      }
    }
    else out[k] = vb;                                  // label 之类的字符串直接取目标
  }
}

/* ── 组合规则 ──
   整套系统的核心：三个轴在这里合成，而不是各自直接改渲染对象。
   时段提供「基准」，季节以乘性修正 + 专属通道叠上去；
   天气（2-3 已接入）以同样方式叠第三层：乘性修正 + 专属通道 + 天空/雾去色。
   composeEnv 单独成函数：连续时辰滑杆要用自己的「时段基准」进来叠同一套规则。 */
function composeEnv(p){
  const s = ENV_SEASON[ENV.season] || ENV_SEASON.summer;       // 季节修正
  // 乘性修正（光强 / 雾 / 饱和）
  p.sunIntensity  *= s.sunMul;
  p.ambIntensity  *= s.ambMul;
  p.hemiIntensity *= s.hemiMul;
  p.fogDensity    *= s.fogMul;
  p.grade.saturation *= s.satMul;
  // 季节专属通道（时段不提供这些键）
  for (const k in s){
    const v = s[k];
    if (k === 'label' || k === 'tintMix') continue;
    if (typeof v === 'number') p[k] = v;
  }
  p.tintMix = s.tintMix;
  for (const k of ENV_COLOR_KEYS){
    if (k.indexOf('tin') === 0) p[k] = new THREE.Color(s[k] !== undefined ? s[k] : 0xFFFFFF);
  }
  // 第三层：天气（乘法打底 + 专属通道 + 去色）
  applyWeatherTo(p, effectiveWeather());
  // 第四层：灯会（存在性通道 + 暖光曝光）。festivalShow 两种态都必须写进参数集
  // —— mixInto 只遍历 from 的键，缺键就插不出 0↔1 的缓动。
  p.festivalShow = ENV.festival ? 1 : 0;
  if (ENV.festival) applyFestivalTo(p);
  return p;
}
function resolveEnv(){
  /* 时段基准统一走 ENV.hour（滑杆的连续时辰）：按钮切时段只是把 hour 对齐到锚点，
     这样"滑杆拖到 15:20 再切季节/天气"不会把时刻拽回整点锚点。 */
  const base = (ENV.hour !== undefined)
    ? paramsAtHour(ENV.hour)
    : makeParams(ENV_TIME[ENV.time] || ENV_TIME.noon);
  return composeEnv(base);
}

/* ── 连续昼夜（时辰滑杆）──
   四锚点取各时段"性格"的中间时刻：晨 7:30 / 午 12:30 / 暮 17:30 / 夜 21:30。
   夜里 21:30 → 次日 4:30 整段保持深夜（不是匀速往晨过渡——凌晨两点不该"半亮"），
   4:30 → 7:30 才是黎明渐亮。 */
export const TIME_ANCHORS = { morning: 7.5, noon: 12.5, dusk: 17.5, night: 21.5 };

/* ── 月亮（2026-09-19 老黄："风和日丽的夜里该有月亮，随辰起落"）──
   取**满月**节律：18:00 东方升起 → 24:00 中天 → 06:00 落下，其余时间在地平线下。
   （弯月也留了通道：sky 的 uMoonPhase，改一个数就能换成月牙，见 makeSkyMat 注释。）
   ⚠️ u = ((h-18)+24)%24 的取模不能省：时辰滑杆是 0~24，跨午夜必须绕回，
      否则凌晨 2 点（h=2）算出负的 u，月亮会突然跳到地平线下面去。

   ── 2026-09-22 二轮重定（老黄：夜间 00:00"满天繁星，唯独没有月亮"）──
   ⚠️ 上一版的失败方式值得完整记住：**数字全对，人看不见**。
      月亮仰角算得精确（午夜 38°）、满月节律也对，但默认机位是 (-20,17,32) 朝 -z
      俯视 19.3°（fov 46 → 画面上沿只到 +3.7°、水平半角 37°）。于是月亮整晚待在
      相机**背后或头顶**：00:00 与视线夹角 147°（身后），21:30 仰角 19.5°（画面之上）。
      老黄看到的只有星星——星空铺满整个半球，所以"满天繁星"反而更衬出月亮不在。
   ⇒ 定轨之前先量天：把天空按「世界仰角 × 世界方位角」切格，逐格强制放月亮、
      同帧差分（有月 vs uMoonAmount=0）数**月轮本体**像素（脚本
      outputs/_diag/_moon-sky-map.mjs）。结论是默认机位能看见的只有一条窄带：
      **仰角 -6°~+8°、方位 105°~190°**，仰角 ≥12° 一律在画面上沿之外，
      方位 ≥195° 一律在画面右侧之外；带内 0°~+5° 是"月轮整轮不被山脊/屋脊切"的区间。
   ⇒ 轨道因此重定：方位 110°→180°（月起于东偏北、横穿镜头正对的北半天；110° 与
      "满月东升"的真实方位 ≈118° 也基本对得上），仰角 4.5°·sin(πu/12)：
      峰值刻意压在 4.5°，让**整夜都落在可见带里**，而不是爬上去再飞出画面上沿。
   ⚠️ 峰值一压，applyEnv 的淡出窗口必须跟着压（见 MOON_FADE_HI）：旧窗口上沿 0.155
      相当于 9°，月亮永远到不了那个高度 → 整晚最亮只剩 55%。
   ⚠️ 这是**刻意的"不天文"**：北纬 31° 的真实满月永远中天于南天（az≈0），
      而默认机位朝北。要"数学正确"就必然"人看不见"——选可见。 */
const MOON_ARC = { az0: 110, az1: 180, peakAlt: 4.5 };
/* 淡出窗口上沿（归一化方向 y）：月亮爬到峰值高度的 ~62% 时亮度吃满 */
const MOON_FADE_HI = Math.sin(MOON_ARC.peakAlt * Math.PI / 180) * 0.62;
function moonDirAtHour(h){
  const u = (((h - 18) % 24) + 24) % 24;      // 0 = 18:00 月出；12 = 06:00 月落；>12 在地平线下
  const k = u / 12;
  const az  = (MOON_ARC.az0 + (MOON_ARC.az1 - MOON_ARC.az0) * k) * Math.PI / 180;
  const alt =  MOON_ARC.peakAlt * Math.PI / 180 * Math.sin(Math.PI * k);
  const ca = Math.cos(alt);
  return [Math.sin(az) * ca, Math.sin(alt), Math.cos(az) * ca];
}
function hourSeg(h){
  const hh = (h < 7.5 ? h + 24 : h);              // 夜→晨跨午夜：抬进 [21.5, 31.5)
  if (hh < 12.5) return { a:'morning', b:'noon',    t:(hh - 7.5)  / 5 };
  if (hh < 17.5) return { a:'noon',    b:'dusk',    t:(hh - 12.5) / 5 };
  if (hh < 21.5) return { a:'dusk',    b:'night',   t:(hh - 17.5) / 4 };
  if (hh < 28.5) return { a:'night',   b:'night',   t:0 };
  return           { a:'night',   b:'morning', t:(hh - 28.5) / 3 };
}
function paramsAtHour(h){
  const seg = hourSeg(h);
  const out = makeParams(ENV_TIME[seg.a]);
  if (seg.t > 0) mixInto(out, out, makeParams(ENV_TIME[seg.b]), Math.min(1, seg.t));
  /* ⚠️ 月亮**不能在时段预设里写死**：那样月亮只会在"切夜"时瞬移一下，拖时辰滑杆它不动
     （老黄要的就是"随着时辰变化慢慢升起又慢慢落下"）。所以由时辰 hour 直接算，
     并且放在 mixInto 之后 —— mixInto 遍历 out 的键，若 ENV_TIME 里没有同名键会算出 NaN。 */
  out.moonPos = moonDirAtHour(h);
  out.moonVis = 1;                       // 天气允许度（1=满月照常），applyWeatherTo 再按天气打折
  return out;
}
function nearestTimeKey(h){
  if (h >= 4.5 && h < 10)   return 'morning';
  if (h >= 10  && h < 15)   return 'noon';
  if (h >= 15  && h < 19.5) return 'dusk';
  return 'night';
}
function fmtHour(h){
  let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  if (mm === 60){ mm = 0; hh = (hh + 1) % 24; }
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
/* 标签：滑杆偏离锚点超过一刻钟就显示 HH:MM，正落锚点仍显示 晨/午/暮/夜 */
export function timeLabelNow(){
  const anchor = TIME_ANCHORS[ENV.time] !== undefined ? TIME_ANCHORS[ENV.time] : 12.5;
  let d = Math.abs(ENV.hour - anchor);
  if (d > 12) d = 24 - d;                          // 跨午夜比较
  return d > 0.25 ? fmtHour(ENV.hour) : (ENV_TIME[ENV.time] ? ENV_TIME[ENV.time].label : '午');
}

/* ── 把参数落到渲染对象上 ── */
const uiRoot = document.documentElement;
let uiLastDark = null;                 // 主题只跟时段轴有关：记住上次写过的值，别每帧重写 CSS
/* 月光色：冷白偏蓝（日光是 5600K 的白里透黄，月光本质是反射的日光 + 大气散射，
   实测照片的月夜高光大约落在 #C9D8F2 一带 —— 用纯白会失去"月夜"的冷调）。 */
const MOON_LIGHT = new THREE.Color(0xC9D8F2);
const _moonV = new THREE.Vector3();
export function applyEnv(p){
  sun.color.copy(p.sunColor); sun.intensity = p.sunIntensity;
  sun.position.set(p.sunPos[0], p.sunPos[1], p.sunPos[2]);
  sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
  /* ── 月亮 → 天空 / 池水 / 主光（2026-09-19 老黄需求）──
     ① 天空与水面只写 uniform：月轮本体在 sky shader 里（它会被平面反射渲进池面，
        所以"池中有月"是自动成立的，不需要另画一个倒影）；
     ② 主光跟着月亮走：夜里那盏"太阳灯"本来就是月光替身（night 预设 0xA8BEE0 / 0.26），
        但它此前**从不跟月亮走** —— 月亮在东、影子朝西，这正是"月光影响场景"要修的那处。
        不新增灯：复用同一盏 → 阴影方向与月光一致，也不多一张阴影贴图（省一次全场深度渲染）。 */
  if (p.moonPos){
    _moonV.set(p.moonPos[0], p.moonPos[1], p.moonPos[2]);
    if (_moonV.lengthSq() < 1e-6) _moonV.set(0, 1, 0);
    _moonV.normalize();
    /* 贴地平线时淡出：真实的月出/月落会被大气消光压暗并染红，这里只做压暗（染色会与
       黄昏的暖调打架）。窗口上沿走 MOON_FADE_HI（随 MOON_ARC.peakAlt 定，≈2.9°），
       下沿 0.0028 ≈ 0.16° —— 月亮一离地平线就迅速亮起来，"刚爬上来还很淡"。 */
    const alt = Math.max(0, Math.min(1, (_moonV.y - 0.0028) / MOON_FADE_HI));
    const vis = (p.moonVis || 0) * alt * alt * (3 - 2 * alt);
    const mu = skyMesh.material.uniforms;
    mu.uMoonDir.value.copy(_moonV);
    mu.uMoonAmount.value = vis;
    if (waterSurface){
      const wu = waterSurface.material.uniforms;
      if (wu.uMoonDir){ wu.uMoonDir.value.copy(_moonV); wu.uMoonVis.value = vis; }
    }
    /* ── 晴午太阳波光 → 水面（2026-09-21）：与月光同构，但只补水面不补天空（日轮本就在
       sky shader / 平面反射里）。uSunVis = 白天度 × 接近正午 × 晴天：
       ① 白天度用 starAmount 判（夜 1 / 昼 0，日照越深越关，避免夜里把月亮当太阳打出白刺）；
       ② 接近正午用太阳仰角判 —— 太阳几乎在头顶时反射才够锐，晨昏仰角低就归零；
       ③ 晴天用 cloudAmount 判 —— 云一厚（>0.82）就关，阴雨雪/阴天整片不闪。 */
    if (waterSurface){
      const wu = waterSurface.material.uniforms;
      if (wu.uSunDir){
        const sd = sun.position.clone().normalize();
        wu.uSunDir.value.copy(sd);
        const nightness = Math.max(0, Math.min(1, p.starAmount || 0));
        const dayW  = 1.0 - Math.max(0, Math.min(1, (nightness - 0.05) / 0.25));     // 昼 1 → 夜 0
        const noonC = Math.max(0, Math.min(1, (sd.y - 0.52) / 0.20));                // 仰角 0.72≧ 全亮，0.52 以下 0
        const clear = Math.max(0, Math.min(1, (0.82 - (p.cloudAmount || 0)) / 0.34));// 云 ≤0.48 全亮，≥0.82 关
        wu.uSunVis.value = dayW * noonC * clear;
      }
    }
    /* 主光交给月亮的前提是**真的入夜了**：starAmount 是现成的"夜色深度"通道
       （夜 1.0 / 暮 0.0，17:30→21:30 之间线性推进）。黄昏月亮虽已升起，
       但太阳还在西边压着 —— 那时把主光拽向东方会出现"夕阳还在、影子从东边来"的穿帮。
       0.45→0.85 这一段就是日落到月升的交接。 */
    const nightness = Math.max(0, Math.min(1, p.starAmount || 0));
    const ss = Math.max(0, Math.min(1, (nightness - 0.45) / 0.40));
    const mw = vis * ss * ss * (3 - 2 * ss);
    if (mw > 0.01){
      const D = 68;
      sun.position.set(_moonV.x * D, Math.max(8, _moonV.y * D), _moonV.z * D);
      sun.color.lerp(MOON_LIGHT, 0.75 * mw);
      sun.intensity = p.sunIntensity * (1 + 0.95 * mw);
    }
  }
  /* ── 物体影子强度随天气（2026-09-28 用户："阴霾和薄雾不该有影子"）──
     sun.shadow.intensity 是 three r155+ 的公开通道（shader 端 mix(1.0, shadow, k)）：
     阴影深度图照常渲，只调"影子的存在感"⇒ 阴/雾切换零额外渲染成本。
     阴霾/薄雾 → 0（漫射光投不出边界清晰的硬影）；晴/暴雨/雪 → 1。缺键兜底 1
     （探针重放旧参数集、或未过天气层的路径都不会误关影子）。 */
  sun.shadow.intensity = (p.shadowK === undefined ? 1 : p.shadowK);
  /* 阴影视体自适应（2026-09-18 重写，见 fitShadowCamera 处的长注释）：
     旧写法是「固定 ±28/±24，再按 1/仰角 放大」—— 那个旋钮的理由是错的
     （ortho 视体的 XY 只需要罩住投射物**轮廓**，影长由 near/far 承担），
     而且固定盒本来就比园子轮廓小 8m，盒外的影子边界会被硬切成一条亮缝。
     现在改成把投射物包围盒的 8 个角投到光空间直接拟合，永远刚好罩住全场。
     只在光向真的动了才重算（静止时防抖，免得每帧刷新投影矩阵）。 */
  if (Math.abs(sun.position.x - (sun.userData.lastFitPos ? sun.userData.lastFitPos[0] : 1e9)) > 0.01 ||
      Math.abs(sun.position.y - (sun.userData.lastFitPos ? sun.userData.lastFitPos[1] : 1e9)) > 0.01 ||
      Math.abs(sun.position.z - (sun.userData.lastFitPos ? sun.userData.lastFitPos[2] : 1e9)) > 0.01){
    sun.userData.lastFitPos = [sun.position.x, sun.position.y, sun.position.z];
    fitShadowCamera();
    renderer.shadowMap.needsUpdate = true;
  }
  amb.color.copy(p.ambColor);  amb.intensity = p.ambIntensity;
  fill.color.copy(p.fillColor); fill.intensity = p.fillIntensity;
  hemiLight.color.copy(p.hemiSky); hemiLight.groundColor.copy(p.hemiGround);
  hemiLight.intensity = p.hemiIntensity;

  scene.fog.color.copy(p.fogColor); scene.fog.density = p.fogDensity;
  /* 夜段雾色上限（交接遗留 #7）：雾色明度不许高于天光 ——
     否则"夜+浓雾"里被雾吞掉的远山会比天空还亮（fogGray 把夜雾往亮灰拉，
     scene 侧比值收敛到 1.05 后渲染实测仍是亮斑：ACES tone mapping 对暗部有
     toe 抬升，雾色在屏幕上被额外提亮，所以 scene 侧必须压到天空的 0.9 倍）。
     以地平线天光为参照、仅暗环境启用（白天天空亮、比值恒满足不触发）；
     multiplyScalar 保色相，夜里仍是蓝黑调。 */
  const hLum = lumOf(p.skyHorizon);
  if (hLum < 0.30){
    const fLum = lumOf(scene.fog.color);
    /* ⚠️ 系数 0.90 → **0.86**（2026-09-27，修 night+mist 的既存红：山 64.07 vs 天 62.42）。
       为什么 0.90 不够：这条钳制的**参照 `hLum` 本身就是被 mist 抬起来的**
       （`ENV_WEATHER.mist` 的 fogGray=0.26 把 skyHorizon 往亮灰拉）⇒ 上限 `hLum*0.90`
       水涨船高，钳制等于没做。实测越界幅度虽只有 0.15（容差 1.5 之上的边缘），
       但方向是"剪影反白发亮"，一眼假，必须压下去。
       0.86 仍**只在暗环境**触发（`hLum < 0.30`），白天天光恒远大于雾色 ⇒ 不影响日景；
       且它同时压低了雾本身，夜+浓雾的"雾里看山"会更有层次（山更暗、雾仍淡）。
       ⚠️ 别为了让它变绿去动 probe/mist-guard.mjs 的容差 —— 那条容差 1.5 有注释交代
       （山体自带基础色 + 抗锯齿抖动），产品侧压暗才是正解。 */
    const fMax = Math.min(hLum * 0.86, 0.15);
    if (fLum > fMax) scene.fog.color.multiplyScalar(fMax / fLum);
  }
  /* 环境贴图强度随天光走（见 ENV_BAKE_LUM 处的说明）：否则夜景里的石材/木材/水面
     仍在反射白天的天空，明明白墙已经暗下去了。
     ⚠️ 2026-09-25：反射**色**由 setEnvPreset 按时段缓存贴图解决（见下），
        这里只负责把**强度**标量调对 —— 两者互补，不要删掉任何一边。 */
  const curLum = (lumOf(p.skyTop) + lumOf(p.skyHorizon)) * 0.5;
  if (scene.environmentIntensity !== undefined){
    scene.environmentIntensity = Math.max(0.08, Math.min(1.25, curLum / ENV_BAKE_LUM));
  }
  /* PMREM 按时段缓存（2026-09-25）：不在 applyEnv 里调用（它会每帧兜底触发），改为
     在 setEnv 的时段变化后一次性切换缓存。稳态零重烘，过渡期间也不重烘（过渡用缓存的旧贴图）。 */
  // setEnvPreset 已移到 setEnv() 中时段变化后调用
  /* 远山 albedo 跟天光走（见 DISTANT_MATS 处的说明）：四层远山是 MeshBasicMaterial，
     不吃任何光，不跟着天光压暗的话夜里会在夜空上发亮（山 35.4 vs 天 16.9 的实测）。
     与上面 environmentIntensity **同源同算**，山和它背后的天同步变暗。
     floor 0.06：留一丝轮廓，别纯黑成一块死斑（夜山仍应有极淡的剪影可读）。
     ⚠️ 每次都从 baseColor 重算，不要就地乘 —— 就地乘会逐帧累积衰减成纯黑。
     ⚠️ 2026-09-22 晚曾把"柱状远树"也挂进这张表；2026-09-23 该层整层删除，本表回到四层远山。 */
  const hillAmb = Math.max(0.06, Math.min(1.0, curLum / ENV_BAKE_LUM));
  for (const m of DISTANT_MATS){
    m.color.copy(m.userData.baseColor).multiplyScalar(hillAmb);
    /* F6：山脊向雾色垂直渐变的目标色由 ShaderMaterial 的 fogColor uniform
       承担，three 每帧按 scene.fog 自动刷新，这里不用手动同步。 */
  }

  const su = skyMesh.material.uniforms;
  su.uTop.value.copy(p.skyTop);
  if (p.skyMid) su.uMid.value.copy(p.skyMid);
  su.uHorizon.value.copy(p.skyHorizon);
  su.uSunColor.value.copy(p.sunDisk);
  su.uSunDir.value.copy(sun.position).normalize();
  su.uCloudTint.value.copy(p.cloudTint);
  su.uCloudAmount.value = p.cloudAmount;
  // 阴天没有可见日轮 —— 阴霾给 diskFade=1 把天光里的日轮彻底抹掉，
  // 否则"阴天"的画面上会挂着一个亮太阳，一眼假
  su.uDiskFade.value = p.diskFade !== undefined ? p.diskFade : 0;
  // 星空也要被云遮掉：云量越大，星越少
  su.uStarAmount.value = p.starAmount * Math.max(0, 1 - (p.cloudAmount || 0) * 0.85);
  /* 七色彩虹（2026-09-30 雨后初晴 · 二轮）：虹心方向。
     ⚠️ **方位严格取太阳的反方向**（真实成因：背对太阳才看得到彩虹），但**仰角被抬起**
        到虹弧能落在天上 —— 因为物理上：正午（太阳仰角约 48°）反日点在地平线下同样角度，
        虹弧整体落到地平线以下 ⇒ **看不到**；而面板默认时段正是正午 ⇒ 用户一选这个场景
        永远看不到彩虹（实测反日点仰角恒为 −24°）。这是**明确的艺术性让步**：
        保方位（背对太阳）、抬仰角（保证可看）。targetElev = 0.62 − 太阳仰角×0.55
        （钳在 −0.25~0.45 rad ≈ −14°~26°），虹弧（42° 半径）便落在天上 20~60°。
     ⚠️ 太阳没升起来就没有虹（夜里/日出前）；夜里另按 uStarAmount 门控。
     ⚠️ **虹轴仰角定在 −15°~−24°**（2026-10-01 二次实测）：弧顶仰角 = 虹轴仰角 + 42°，
        所以 −15° ⇒ 弧顶 27°、−24° ⇒ 弧顶 18°。这是"虹落在园墙上方、不顶到画框
        上沿"的位置（改前是 −8°~−12° ⇒ 弧顶 30°~34° ⇒ 纵向 0%，虹顶压在画面顶端，
        老黄反馈"又高又远"）。
        真实成因是虹心恒与太阳反向、仰角 = −太阳仰角；正午太阳 47° 时虹心在地平线下
        47°、整条虹**物理上不可见** —— 抬到 −15°~−24° 是明确的艺术性让步
        （让彩虹在园林里看得见），别"修正"回物理值。
        第一版曾按物理取 target=0.62−太阳仰角×0.55，正午算出 9° ⇒ 弧顶 49°
        ⇒ **整条弧在画面外**。 */
  {
    const sd = su.uSunDir.value;
    const sunElev = Math.asin(Math.max(-1, Math.min(1, sd.y)));
    let ax = sd.x, az2 = sd.z;
    const hl = Math.hypot(ax, az2);
    if (hl < 1e-5){ ax = 0; az2 = 1; } else { ax /= hl; az2 /= hl; }
    /* ⚠️ **虹轴仰角 ≈ −40°**（2026-10-01 第四轮实测后的最终值）——
       这不是随手调的，是**按默认机位反解**出来的：
         · 默认机位是**俯视**的（pitch −19.3°、fov 46°）⇒ 画面只看得到仰角
           **−42°~+4°** 这一条天带（实测：画面顶端到"山"那段）。
         · 弧顶仰角 = 虹轴仰角 + 42°。所以要让拱顶**落进这条天带的上沿**，
           虹轴必须 ≈ −40° ⇒ 弧顶 +2°（对应画面纵向 y≈4%，正是老黄标注的位置）。
         · 前三轮我分别用过 −8°、−15~−24°、−5°，弧顶都在 +30°~+37° ⇒ **全部在画框之上**
           （实测 topPct 恒为 0），这就是"怎么调都看不见/只见到一小段"的根因。
       几何自洽性：虹心 −40° 时，弧的两只脚（方位 ±62°）落在仰角 −14°，
       整条弧在画面纵向 4%~39% —— 正好是"跨过园子上方、两脚落在围墙/假山与水榗之间"。
       ⚠️ 仍不是物理值（真实 = −太阳仰角，正午 −47° ⇒ 虹物理上完全不可见）；
          抬到看得见是明确的艺术性让步（老黄要"雨后初晴、园林里有彩虹"），别修正回物理值。 */
    /* ⚠️ 虹轴**仰角**（与上面的方位无关，方位见下面第二段）：
       弧顶仰角 = 虹轴仰角 + 42°。默认机位俯视 −19.3°、垂直视野 46° ⇒ 画面只看得到
       仰角 **−42°~+4°** 这一条天带。要让整条弧落在这条带里、且拱顶不贴画框上沿，
       虹轴取 **≈ −50°** ⇒ 弧顶 ≈ **−8°**（对应画面纵向 y≈25%，"拱顶在画面上部"）。
       ⚠️ 2026-10-01 第三轮修"雨后初晴看不到虹"时把这里从 −0.70（弧顶 +2°、**贴顶被切**，
       实测虹像素的屏幕范围 y0=0）压到 −0.86。 */
    const target = Math.max(-0.78, Math.min(-0.62, -0.70 - sunElev * 0.03));
    const dayK = Math.max(0, Math.min(1, (sunElev - 0.02) / 0.12));
    su.uRainbow.value = (p.rainbow || 0) * dayK * (1 - Math.min(1, su.uStarAmount.value / 0.35));
    /* ── 虹的**方位**：见下面第二段（2026-10-01 第三轮已改成"固定园子主视方位"）。
       ⚠️ 第一、二轮在这里写过一整套"按园内地标方位算 uArcAzOff"的逻辑（MARKS_AZ /
          GARDEN_AZ），第三轮连同那段代码一起删了 —— 因为它**在原理上就救不了**：
          方位锁在太阳反方向时，虹环两侧落在方位 ±90° 处、超出默认机位 ±35° 的水平
          视野，无论窗口怎么偏都不在画里（实测晨/午 0 像素）。别再把它加回来。 */
    /* ── 虹轴方位：**固定为"园子主视方位"**（2026-10-01 第三轮，老黄："雨后初晴为啥彩虹没了"）──
       ⚠️ 前两轮把方位**严格锁在太阳反方向**（真实成因），结果实测：
            dawn  默认机位 **0 像素** / 「看彩虹」机位 **0 像素**
            noon  默认机位 **0 像素** / 「看彩虹」机位 **0 像素**
            dusk  默认机位 18776（仅 3.1%，还缩在画面右上角）/ 机位 61274（10.2% 的宽拱）
         为什么"把弧窗口往可见方向拧"也救不了：虹环是"与虹轴夹 42° 的一圈方向"，
         虹轴压在 −40° 时，环的最高点（弧顶）在**虹轴方位**上、仰角 +2°，
         而环的**两侧**（方位 = 虹轴方位 ±90°）仰角是 −40° —— 晨/午太阳反方位
         约在园子正背后，弧顶在相机背后、两只脚又甩到相机左右各 90° 之外
         （默认机位水平视野只 ±35°）⇒ **整条虹必然在画外**，与窗口偏移无关。
       ⇒ 现在方位取固定的园子主视方位：虹永远悬在园子上方、默认机位一眼就能看到。
         代价（明确记下）：**它不再跟着太阳走** —— 晨/午/暮三个时段虹的位置一样，
         物理上这是"贴上去的"。这是老黄"要看得见"与"背对太阳才看得到"之间的取舍，
         按当前反馈取"看得见"。若要回到随太阳：把 CAM_AZ 换回 antiSunAz 即可，
         同时必须把 afterrain-guard 的"虹可看见"判据改回"虹心反太阳"，
         并接受晨/午看不到（旧状）。
       仰角仍保留 −40°（上一轮按默认机位俯视反解出来的值，别动）。 */
    const CAM_AZ = -1.03;                          // 默认机位朝向（本函数方位约定 az=atan2(z,x)，实测 −59°）
    const rbAz = CAM_AZ;
    const ce2 = Math.cos(target), se2 = Math.sin(target);
    su.uRainbowDir.value.set(Math.cos(rbAz) * ce2, se2, Math.sin(rbAz) * ce2);
    /* 弧宽 45°（2026-10-01 按老黄标注"一道跨越全园的宽拱"定值）：
       半宽再大（62°/70°/80°）会让弧宽到 90%+ 顶满整片天，反而不是"一道虹"。 */
    const ARC_HALF = 45.0;
    su.uArcHalf.value = ARC_HALF;
    /* 窗口中心锁在弧顶 ⇒ 偏移 0 就是"弧对称罩在园子上方"。
       旧值 +10°（相对太阳反方位往园心侧偏）是上一轮为"把虹脚推向围墙/水榭"调的；
       方位改成园子主视方位之后，弧本身就居中，再把偏移留着会把它甩偏。
       ⚠️ uArcAzOff 与 uArcHalf 都是**角度**（着色器里 degrees(...) 与它同尺度）。 */
    su.uArcAzOff.value = 0;
  }

  renderer.toneMappingExposure = p.exposure;
  bloom.strength = p.bloomStrength;
  bloom.radius   = p.bloomRadius;
  bloom.threshold = p.bloomThreshold;
  if (gtaoPass) gtaoPass.blendIntensity = p.gtaoBlend;

  const gu = gradePass.uniforms;      // 写 pass 自己那份（模板是死的，见 composer 处的说明）
  gu.uContrast.value   = p.grade.contrast;
  gu.uSaturation.value = p.grade.saturation;
  gu.uWarmHi.value.copy(p.grade.warm);
  gu.uCoolLo.value.copy(p.grade.cool);
  gu.uSplit.value      = p.grade.split;
  gu.uVignette.value   = p.grade.vignette;

  lanternMat.emissiveIntensity = p.lamp * 1.15;
  if (lanternMat.userData.uLampS) lanternMat.userData.uLampS.value = p.lamp * 1.15;   // SSS 纸粒强度与发光同步
  /* ⚠️ 自发光 3.4 → 1.15（2026-09-21 方案 n2 二轮·特写实测）：3.4 在 ACES+bloom
     下把灯身整体打成纯白，"宫灯"退化成光球，腰鼓轮廓/纸纹/顶珠全部淹没。
     1.15 仍在 bloom 阈值 0.90 之上 → 光晕照旧挂得住，但灯面保留纸纹明暗，
     远看是亮点、近看是灯笼。 */
  /* 灯笼点光 = lamp 通道的第二个消费端（第一个是自发光强度）。
     以前这里**没人接线**：worldLights 被填进去却从没被读过，于是那两盏灯
     白天也以固定强度亮着 —— 既浪费又不真实。现在按时段走：晨/午 lamp=0 → 全灭，
     暮 0.25 → 微亮，夜 1.0 → 全亮。
     ⚠️ 只调 intensity、绝不切 visible：Three 的材质 program 缓存 key 含"参与渲染的灯数"，
     隐藏一盏 = 灯数变化 = 全场材质重新编译（几百毫秒卡顿）。强度归零仍占一点 ALU，
     换来的是切换环境时零重编译 —— 这笔交换是值的。 */
  for (const L of worldLights) L.intensity = L.userData.base * p.lamp;
  if (_lampVol){ _lampVol.uniforms.uLamp.value = p.lamp; _lampVol.uniforms.uRain.value = p.rainAmount || 0; }  // 体积光锥 alpha/散射随灯与雨
  if (_groundSplashMat){ _groundSplashMat.uniforms.uLamp.value = p.lamp; _groundSplashMat.uniforms.uRain.value = p.rainAmount || 0; }

  // 核显档的水面用天空色近似反射，天空一变它也要跟着变
  if (waterSurface){
    const wu = waterSurface.material.uniforms;
    if (wu.uSkyTop)     wu.uSkyTop.value.copy(p.skyTop);
    if (wu.uSkyMid && p.skyMid) wu.uSkyMid.value.copy(p.skyMid);
    if (wu.uSkyHorizon) wu.uSkyHorizon.value.copy(p.skyHorizon);
  }

  /* ── 季节：植被色调 / 存在性 / 动物行为 ── */
  seasonMixUniform.value = p.tintMix;
  /* 柳帘季节亮度：tint 是保明度换色，压不出"春芽发亮/夏翠深"的明度差 ——
     直接驱动叶帘材质底色（春 ×1.3 提亮，其余季节回落 1.0） */
  MAT.willowLeaf.color.setScalar(ENV.season === 'spring' ? 1.30 : 1.00);
  /* 竹叶春芽提亮（2026-09-16 用户反馈"春/夏竹叶无差别"）：seasonTint 换色是
     **保明度**的 —— 嫩绿 #8ecb58 的明度被 shader 拉回与本色一致（sLum/tLum≈0.42），
     春竹叶实际 = 本色 ×0.42 的暗绿，与夏几乎同色。与 willowLeaf 同一对策：
     copy 基色后春 ×1.35 抬亮度（1.35 下换色结果 ≈#85C758 鲜嫩绿，与夏 #4E8C36 拉满对比），
     其余季节回 1.0。copy 基色防 applyEnv 逐帧调用累积。 */
  MAT.leaf.color.copy(MAT._leafBase); MAT.leafDeep.color.copy(MAT._leafDeepBase);
  if (ENV.season === 'spring'){
    MAT.leaf.color.multiplyScalar(1.35);
    MAT.leafDeep.color.multiplyScalar(1.25);
  }
  /* 芭蕉假茎冬季枯株：压掉环境反射 —— 否则 PMREM 里草地/天空的绿会把
     tint 的枯黄褐（0x9C8A58）洗回暗橄榄绿，萧瑟残株读不出来 */
  MAT.banana.envMapIntensity = (ENV.season === 'winter') ? 0.05 : 0.5;
  MAT.banana.roughness = (ENV.season === 'winter') ? 0.96 : (MAT.banana.userData.dryRough || 0.7);
  for (const [mat] of SEASON_TINT_MATS){
    const u = mat.userData.seasonTint;
    const c = p[mat.userData.seasonKey];
    if (u && c) u.value.copy(c);
  }
  collectSeasonGLB();
  if (window.__ENVDBG){
    const wl = seasonMeshCache.get(MAT.wisteria) || [];
    const visBefore = wl.map(o=>o.visible?1:0).join('');
    console.log('[ENVDBG] p.wisteriaShow=' + p.wisteriaShow + ' cacheLen=' + wl.length +
                ' visibleBefore=' + visBefore.slice(0,20) + ' label=' + p.weatherLabel);
  }
  applyPresence(p);
  collectSeasonGLB();
  applyGLBSeason(p);
  for (const it of willowLeafInsts) it.o.count = Math.max(0, Math.round(it.max * p.willowLeaf));
  /* 竹叶季节叶量：春稀（0.55，抽竿后刚长叶）→ 夏茂（1.0）→ 秋微落（0.85）→ 冬常绿稍疏（0.65） */
  for (const it of bambooLeafInsts) it.o.count = Math.max(0, Math.round(it.max * p.bambooLeaf));
  /* 蜻蜓：季节管"存不存在"，天气管"飞不飞"。
     暴雨/风雪里蜻蜓是停栖的，不该照常游弋 —— 这是之前漏掉的一层天气修正。 */
  {
    const eff = effectiveWeather();
    const grounded = eff === 'storm' || eff === 'winterrain'
                  || (p.rainAmount || 0) > 0.4 || (p.windMul || 1) > 2.5;
    for (const d of dragonflies) d.visible = !grounded && p.dragonflyShow > 0.03;
    /* 停栖蜻蜓同口径：冬（dragonflyShow=0）与暴雨/风雪都藏起来。
       这里只写开关，位置在渲染循环里逐帧算（隐藏期间不更新，重现时从停栖态重算）。 */
    setPerchShowOK(!grounded && p.dragonflyShow > 0.03);
    /* 大雁（2026-09-30）：只跟**季节**（春/秋迁徙），不跟天气 ——
       雁在雨天照样飞（真雁阵雨天常见）。夏/冬 gooseShow=0 ⇒ 整队隐藏。 */
    const gooseOn = p.gooseShow > 0.03;
    for (const g of geese) g.visible = gooseOn;
  }
  for (const tw of swimTurtles) tw.visible = p.turtleShow > 0.03;

  /* ── 天气：风 / 积雪 / 湿地 ──
     ⚠️ 这里**不写** WIND.uWindStrength：applyEnv 只在过渡期间被调用，
     写在这里会立刻被每帧的 updateWind 覆盖（实测底值 2.2 → 0.153）。
     风力统一由 updateWind 每帧合成，这里只交代"阵风该有多猛"。 */
  gust.peakMul = p.gustMul !== undefined ? p.gustMul : 1;   // 狂风下随机阵风不再叠得很高
  snowUniform.value      = p.snowCover  !== undefined ? p.snowCover  : 0;
  if (p.snowTint) snowTintUniform.value.copy(p.snowTint);
  applyWetness(p.wetness !== undefined ? p.wetness : 0);

  /* 界面主题直接由**时段轴**决定，不由渲染出来的颜色反推。
     走这条路之前试过两种"算亮度"的写法，都栽在同一件事上：天气会改天色。
       · 用雾色：天气的"天光压灰"把雾色抬到中灰（夜+银装素裹 #767b81，亮度 0.196）
       · 用天空色：同一个压灰把 skyTop 从 #0b1220 抬到 #71767d（亮度 0.178）
     两次都是"夜里的暗场景"被判成亮场，面板在夜景里闪回一块白疙瘩。
     昼夜本来就是时段轴的语义（夜里就是暗），它有确定答案、不被任何天气手段污染，
     也正好对应面板上"晨/午/暮/夜"那四个字。暮色仍算亮场（面板压在夕阳上依然读得清）。 */
  const dark = (ENV.time === 'night');
  // 亮场：近黑字 + 暖白衬底（对比度由衬底兜底）
  // 暗场：暖白字 + 深衬底。字色不用纯白，夜里纯白会眩
  /* ⚠️ applyEnv 在 2.8 秒过渡里是**逐帧**被调用的，而主题只跟"时段轴"这个离散量有关：
     9 条 CSS 变量 × 168 帧 = 1500 次重复 DOM 写。只在真正翻转时写一次。 */
  if (dark !== uiLastDark){
  uiLastDark = dark;
  uiRoot.style.setProperty('--ui-fg',      dark ? '#f2efe6' : '#121417');
  uiRoot.style.setProperty('--ui-fg-dim',  dark ? '#dcd8ce' : '#26292e');
  uiRoot.style.setProperty('--ui-fg-hint', dark ? '#c4c0b6' : '#3a3e44');
  uiRoot.style.setProperty('--ui-panel',   dark ? 'rgba(18,22,28,.62)' : 'rgba(246,246,243,.60)');
  uiRoot.style.setProperty('--ui-bg',      dark ? 'rgba(52,58,68,.60)' : 'rgba(255,255,255,.50)');
  uiRoot.style.setProperty('--ui-bd',      dark ? 'rgba(232,230,224,.45)' : 'rgba(40,40,40,.42)');
  uiRoot.style.setProperty('--ui-sh',      dark ? '0 1px 3px rgba(0,0,0,.85)' : '0 1px 0 rgba(255,255,255,.75)');
  uiRoot.style.setProperty('--ui-on-bg',   dark ? 'rgba(240,236,226,.95)' : 'rgba(30,34,40,.92)');
  uiRoot.style.setProperty('--ui-on-fg',   dark ? '#14171c' : '#ffffff');
  }
}

/* ══ 植被季节表现 ══
   色调：给植被材质注入共享 uniform，按「保留明度的换色」重着色 ——
   色相换成季节目标色，明暗仍来自原贴图，这样叶簇的层次不会糊掉。
   ⚠️ 必须链式挂接 onBeforeCompile：叶/柳/苇已经有风场注入，直接覆盖会把风弄坏。 */
// 直接取登记表：这样连运行时克隆出来的材质（地面）也被覆盖
const SEASON_TINT_MATS = SEASON_TINT_REGISTRY.slice();
const seasonMixUniform = { value: 0 };
for (const [mat, key] of SEASON_TINT_MATS){
  const uni = { value: new THREE.Color(0xFFFFFF) };
  mat.userData.seasonTint = uni;
  mat.userData.seasonKey  = key;
  const prevCB  = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer){
    if (prevCB) prevCB.call(this, shader, renderer);
    shader.uniforms.uSeasonTint = uni;            // 共享同一对象：所有变体一起变
    shader.uniforms.uSeasonMix  = seasonMixUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSeasonTint;\nuniform float uSeasonMix;')
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        '  float sLum = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722));\n' +
        '  float tLum = max(dot(uSeasonTint, vec3(0.2126,0.7152,0.0722)), 0.06);\n' +
        '  diffuseColor.rgb = mix(diffuseColor.rgb, uSeasonTint * (sLum / tLum), uSeasonMix);');
  };
  mat.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : '') + '|season'; };
}

/* 存在性：程序化植被已被 mergeStatics 按材质合并，只能整体开关；
   GLB 资产（荷/芭蕉/龟）异步挂载、晚于合并，可以逐个控制。 */
/* ══ 上元灯会（2026-09-24 · 计划书 Phase 3 第 7 项）════════════════════════════
   一键切换 = 夜 + 水面河灯（随波漂移）+ 游廊灯串 + 桃树枯枝挂灯 + 暖光曝光提升。
   三条硬规矩（计划书 v2.0 补注，全是绕坑，别省）：
   ① **不新增真光源**：夜里月光接管阴影方向 —— 河灯/灯串/挂灯一律用自发光材质"伪造"发光，
     全场真实灯数仍是灯笼那 5 盏 PointLight（festival-guard 断言这一点）。
   ② **draw calls 预算吃紧**（上限 800）：河灯 1 + 烛焰 1 + 灯串 1 + 两株桃树挂灯 2 = **+5**；
     非灯会态全部 count=0 ⇒ three 根本不提交，白天零成本。
   ③ 现有灯笼的"20 件故意不合并"是给单独寻址留的 —— 本功能不碰它们。
   ⚠️ 河灯落点必须避开三类**出水物**（实测坐标见 outputs/_diag/festival-geo.mjs）：
     · 桥体：08 里 world(8.4,0,4.6) 旋转 90°，跨度 9.4×厚 2.4 ⇒ 世界 x∈[7.2,9.6]、z∈[-0.1,9.3]
       （桥体被 mergeStatics 并网，运行期找不到名字 ⇒ 用源码常量）；
     · 汀步石：05 的 z=5.6 直线上 11 块 ⇒ 实测 x∈[-4.12,6.99]、z∈[4.93,6.32]；
     · 立峰石组（石矶+伴石）：实测 x∈[-6.97,-2.83]、z∈[5.9,9.81]。
     漂移是慢速小轨道（半径 ≤0.5m），落点对三者各留 ≥1m 余量 ⇒ 永远到不了；岸边同理
     （r ≤ 0.80×POND_RADII − 轨道半径）。 */
const FEST_RIVER_N = 24;
const FEST_BRIDGE  = { x0: 7.2, x1: 9.6, z0: -0.1, z1: 9.3 };     // 桥体（世界）
const FEST_STONES  = { x0: -4.12, x1: 6.99, z0: 4.93, z1: 6.32 }; // 汀步石（世界，实测）
const FEST_HERO    = { x0: -6.97, x1: -2.83, z0: 5.9, z1: 9.81 }; // 立峰石组（世界，实测）
const FEST_PAD = 1.0;                                             // 河灯对出水物的避让余量
const _inRect = (r, x, z, pad) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
/* 河灯：暖光纸罩（emissive 伪造发光）。烛火照透纸壳 —— 整盏自发光本来就是对的物理。
   ⚠️ 亮度是**量出来的**（2026-09-24 目视复核 fest-low.png）：初版 emissive 1.7 + 0xFF9A3C
   近看糊成一簇"实心亮黄块"，既不像灯也不像火（bloom 阈值 0.90，1.7 远远越线）。
   现在 0.85 + 更暖的橙（绿通道压低 ⇒ 不再偏黄绿）⇒ 近看能读出"一朵发光的花"。 */
const riverLampMat = new THREE.MeshStandardMaterial({
  color: 0xFFE9C8, emissive: 0xFF7A28, emissiveIntensity: 0.85, roughness: 0.62, metalness: 0.0 });
/* 灯串小灯泡：比纸罩亮一档（它们是"光源"本身），但同样压在 bloom 阈值附近。 */
const stringBulbMat = new THREE.MeshStandardMaterial({
  color: 0xFFE2B0, emissive: 0xFFB84D, emissiveIntensity: 1.15, roughness: 0.5, metalness: 0.0 });
const _festRiver = { inst: null, flame: null, data: [] };   // data: { bx, bz, orbR, orbSp, ph, yaw, yawSp }
const _festBulbs = { inst: null, n: 0 };
let _festBuilt = false;

function makeRiverLampGeo(){
  /* 莲花灯：托盘 + 6 片烫花瓣 —— 单几何单材质（1 draw call）。
     尺寸刻意小（直径 ~0.32m）：24 盏铺一池要"星星点点"，不是"漂浮的路灯"。
     ⚠️ **烛焰不进这个几何**：烛焰要用**更亮一档的材质**（独立 InstancedMesh），
     否则"灯芯"和"纸罩"同亮度 ⇒ 近看是一坨均匀亮块，读不出"火在花里"
     （初版就是这样，量图 fest-low.png 看出来的）。 */
  const dish = new THREE.CylinderGeometry(0.10, 0.13, 0.05, 9);
  dish.translate(0, 0.025, 0);
  const parts = [dish];
  for (let i = 0; i < 6; i++){
    const p = new THREE.CylinderGeometry(0.03, 0.085, 0.16, 6, 1, true);
    const a = (i / 6) * TAU;
    p.translate(0, 0.095, 0);
    p.rotateX(0.85);                                   // 花瓣外张
    p.rotateY(a);
    p.translate(Math.sin(a) * 0.10, 0, Math.cos(a) * 0.10);
    parts.push(p);
  }
  return mergeGeometries(parts, false) || dish;
}
/* 烛焰材质：亮一档（bloom 会给它拖出小光晕）⇒ 花是柔光、芯是亮点。 */
const riverFlameMat = new THREE.MeshStandardMaterial({
  color: 0xFFF0D0, emissive: 0xFFB050, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.0 });

export function makeFestivalLights(){
  if (_festBuilt) return;
  _festBuilt = true;
  /* —— 河灯落点（世界坐标）：本地种子流 —— 布局类随机不走共享 Math.random（项目铁律） */
  const fr = mulberry32(20260925);
  const data = [];
  let guard = 0;
  while (data.length < FEST_RIVER_N && guard++ < 4000){
    const a = fr() * TAU;
    const ri = Math.min(POND_RADII.length - 1, Math.floor(a / TAU * POND_RADII.length));
    const orbR = 0.16 + fr() * 0.34;                   // 轨道半径 ≤0.5 ⇒ 与 1m 避让余量配平（实测漂移量级见 festival-guard）
    const maxR = POND_RADII[ri] * 0.80 - orbR;         // 岸线内 20% 再扣轨道半径
    if (maxR < 2.0) continue;
    const r = 1.6 + Math.sqrt(fr()) * (maxR - 1.6);
    const wx = Math.cos(a) * r, wz = 3.0 + Math.sin(a) * r;   // 池局部 → 世界（池心 z=+3）
    if (_inRect(FEST_BRIDGE, wx, wz, FEST_PAD)) continue;
    if (_inRect(FEST_STONES, wx, wz, FEST_PAD)) continue;
    if (_inRect(FEST_HERO,  wx, wz, FEST_PAD)) continue;
    if (data.some(d => Math.hypot(d.bx - wx, d.bz - wz) < 0.9)) continue;   // 彼此不叠
    data.push({ bx: wx, bz: wz, orbR, orbSp: (fr() * 0.5 + 0.5) * (fr() < 0.5 ? 1 : -1) * 0.22,
                ph: fr() * TAU, yaw: fr() * TAU, yawSp: (fr() - 0.5) * 0.3 });
  }
  const inst = new THREE.InstancedMesh(makeRiverLampGeo(), riverLampMat, data.length);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
  inst.userData.noMerge = true;
  inst.userData.aoSkip = true;             // 河灯小且随波动，AO 贡献可忽略 ⇒ 不进法线 pass
  inst.name = 'riverLanterns';
  world.add(inst);
  _festRiver.inst = inst; _festRiver.data = data;

  /* 烛焰：同一批落点、同一套漂移，但用更亮的材质（+1 draw call：灯会共 +5，仍低于 800）。 */
  const flameGeo = new THREE.ConeGeometry(0.022, 0.07, 6);
  flameGeo.translate(0, 0.105, 0);
  const fInst = new THREE.InstancedMesh(flameGeo, riverFlameMat, data.length);
  fInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fInst.frustumCulled = false;
  fInst.userData.noMerge = true;
  fInst.userData.aoSkip = true;
  fInst.name = 'riverLanternFlames';
  world.add(fInst);
  _festRiver.flame = fInst;

  /* —— 游廊灯串：两跨悬链（锚点复用 lanternSpots 的游廊三点，额枋下 3.05m）—— */
  const CORRIDOR = [[13.2, -6.0], [18.2, -1.8], [24.0, 6.5]];   // 见上方 lanternSpots 注释
  const SAG = 0.34, Y = 3.02, PER = 14;
  const bulbs = [];
  for (let s = 0; s < CORRIDOR.length - 1; s++){
    const [x0, z0] = CORRIDOR[s], [x1, z1] = CORRIDOR[s + 1];
    for (let i = 0; i < PER; i++){
      const u = (i + 0.5) / PER;
      const sag = Math.sin(u * Math.PI) * SAG;                 // 悬链近似：正弦下垂
      bulbs.push([x0 + (x1 - x0) * u, Y - sag, z0 + (z1 - z0) * u]);
    }
  }
  const bulbGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const bInst = new THREE.InstancedMesh(bulbGeo, stringBulbMat, bulbs.length);
  const m4 = new THREE.Matrix4();
  bulbs.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); bInst.setMatrixAt(i, m4); });
  bInst.frustumCulled = false;
  bInst.userData.noMerge = true;
  bInst.userData.aoSkip = true;
  bInst.name = 'corridorStringLights';
  world.add(bInst);
  _festBulbs.inst = bInst; _festBulbs.n = bulbs.length;
}

/* ══ 灯会挂灯扩展（2026-09-26 · 用户："桃树，柳树，还有紫藤都可以挂花灯；
      院子围栏也可以挂一些中国传统的红色灯笼"）══════════════════════════════════
   两批新增挂灯，**都只加自发光材质、一个真光源都不加**（festival-guard 坑①：
   夜里月光接管阴影方向，加真灯就得同步改阴影逻辑）：

     A 柳树 + 紫藤挂**花灯** —— 形制照抄桃树那盏（Lathe 鼓腹 + 上下盖 + 挂绳），
       不改形制，只是换挂点。
     B 围栏挂**传统红灯笼** —— 新形制：直筒微鼓的朱红灯身 + 金色上下盖 +
       挂绳 + 底部流苏球。刻意与花灯可区分：直筒不收腰、色恒为红、尺寸大一档。

   ── 三条与既有门禁对齐的硬规矩 ──
   ① **一个灯笼 = 一份合并几何 = 一个 InstancedMesh**。
      诊断段（outputs/_diag/lantern-ab*.mjs）试摆时把一盏灯拆成 4~5 个 InstancedMesh
      （灯身/盖/底/绳/穗），报出 **+26 draw call** —— 纯浪费。生产实现用
      mergeGeometries 把部件并成一份 ⇒ 120 盏灯只占 **3 个对象**（柳花灯/紫藤花灯/红壁灯）。
      ⚠️ 红壁灯的金盖与红身**同属一份几何**（instanceColor 逐实例染色，gold 那一档
      用顶点色偏移表达），否则红壁灯就要 2 个对象。
   ② **非灯会态 count=0 零提交** —— 走 applyPresence 的直接清单（与 treeLanternInsts 同套路，
      不混进季节表：存在性语义是"随灯会"，与季节无关）。
   ③ **挂点存在性一律用 `instanceMatrix.count`（容量），不用 `count`**。
      `count` 会被季节通道改写（冬季 willowLeaf≈0、wisteriaShow=0 把柳叶/紫藤压到近 0），
      而 instanceMatrix 缓冲**仍是满容量**的。挂灯要留在树上（枯枝挂花灯/缠枝挂灯是上元灯会的
      题眼，冬天更是唯一能看见的一笔）—— 用 count 判会把挂灯一起判没了。 */
const FEST_WILLOW_PER = 12;         // 每株柳树 12 盏
const FEST_WISTERIA_PER = 12;       // 每丛大紫藤 12 盏
const FEST_WALL_GAP = 3.4;          // 围栏红灯笼间距（米）
const FEST_WALL_Y = 3.95;           // 挂高（帽檐 ~4.8 之下 0.85m）
const FEST_WALL_OFF = 0.95;         // 自墙面内缩（墙厚 0.6 ⇒ 内面在 ±W/2-0.3，这里再退一点避帽檐）
const FEST_WIS_MIN = 1500;          // 紫藤"大藤架"判别阈值（容量）—— 游廊棚上另有 12 小丛，容量 375~566

/* 花灯材质：与桃树那盏 TREE_LANTERN_MAT 同族（MeshBasic + toneMapped:false）。
   ⚠️ 不能直接 import 06 的 TREE_LANTERN_MAT 复用：那材质**已经**被桃树挂灯的
   instanceColor 通道占用（instanceColor 是**逐网格**的，两个网格各自一份，互不影响）——
   其实可以复用，但为了"红灯笼是独立一类"的判读清晰，这里给花灯挂灯单独一份同参材质，
   并登记进 festivalShow 的 presence 表（自发光件不吃季节色，登记只为统一显隐语义）。 */
const hangFlowerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false,
                                                    transparent: true, opacity: 0.95, depthWrite: false });
/* 红灯笼材质：朱红 + 逐实例染色（深红/正红/朱红三档抖动，±12% 亮度）——
   传统壁挂灯笼是成排的，全等亮度会读成"塑料玩具"。 */
const wallRedMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false,
                                                  transparent: true, opacity: 0.97, depthWrite: false });

/* 花灯几何：与桃树 makeTreeLanternGeo 同一形制（Lathe 鼓腹 + 上下盖 + 挂绳），
   只是这里**合并成一份**（桃树那版在 06 里也是合并的，见 makeTreeLanternGeo）。 */
function makeHangFlowerGeo(){
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0.026, -0.085), new THREE.Vector2(0.062, -0.062),
    new THREE.Vector2(0.068,  0.000), new THREE.Vector2(0.062,  0.062),
    new THREE.Vector2(0.026,  0.085),
  ], 10);
  const cap = new THREE.CylinderGeometry(0.030, 0.030, 0.016, 8);  cap.translate(0,  0.090, 0);
  const base = new THREE.CylinderGeometry(0.030, 0.030, 0.016, 8); base.translate(0, -0.090, 0);
  const cord = new THREE.CylinderGeometry(0.004, 0.004, 0.10, 4);  cord.translate(0,  0.148, 0);
  return mergeGeometries([body, cap, base, cord], false) || body;
}
/* 红灯笼几何：直筒微鼓的灯身 + 上下木盖 + 挂绳 + 流苏球。
   ⚠️ 金盖与红身**同属一份几何**（否则要多一个 InstancedMesh = 多一次提交）：
   盖用顶点色偏移（红身基色 R/G/B 分别 +0.62/+0.40/+0.06 ⇒ 落到金色），
   instanceColor 仍按**红身**那一档染色 ⇒ 盖跟着染成"偏金的暗红"，夜里读作铜盖。 */
function makeWallRedLanternGeo(){
  /* ⚠️ 上一轮（2026-09-27）把整份几何**放大 1.25×**（灯身直径 0.224 → 0.280m）。
     起因：40m 观距下 0.22m 的灯笼在屏上只有几个暗红点，读不出"真是一盏灯"。
     上界有两个物理约束，不能乱放大：
       ① 灯笼顶（绳头 y=+0.365 处）必须**低于**帽檐（帽檐在 y≈4.8）—— 放大后 y=+0.456，仍安全；
       ② 底沿玉坠（穗 y=-0.163 处）放大后 y=-0.204，挂点 y=3.95 ⇒ 底沿 y=3.75，
          高于人头且不与地面道具碰撞。
     尺寸只改几何，不改挂点/挂高（y=3.95），所以门禁里"墙灯 y 3.6~4.4"那条不受影响。 */
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0.085, -0.105), new THREE.Vector2(0.105, -0.075),
    new THREE.Vector2(0.112,  0.000), new THREE.Vector2(0.105,  0.075),
    new THREE.Vector2(0.085,  0.105),
  ], 12);
  const capT = new THREE.CylinderGeometry(0.070, 0.070, 0.022, 12); capT.translate(0,  0.115, 0);
  const capB = new THREE.CylinderGeometry(0.062, 0.062, 0.020, 12); capB.translate(0, -0.112, 0);
  const cord = new THREE.CylinderGeometry(0.005, 0.005, 0.16, 5);   cord.translate(0,  0.205, 0);
  const tassel = new THREE.SphereGeometry(0.018, 8, 6);             tassel.translate(0, -0.145, 0);
  /* 整体放大 1.25×（含偏移），closePath:false 不封口。 */
  for (const g of [body, capT, capB, cord, tassel]) g.scale(1.25, 1.25, 1.25);
  const parts = [body, capT, capB, cord, tassel];
  /* 给盖/绳/穗打顶点色标记（金 = +0.62/+0.40/+0.06 的偏移量），
     合并后 instanceColor 与它相乘 ⇒ 盖读作金、灯身读作红。 */
  const GOLD = [0.62, 0.40, 0.06];
  const partsVC = parts.map((g, gi) => {
    const gg = g.clone();
    const n = gg.attributes.position.count;
    const col = new Float32Array(n * 3);
    const isGold = (gi === 1 || gi === 2 || gi === 3);        // capT / capB / cord
    for (let i = 0; i < n; i++){
      col[i*3]     = isGold ? GOLD[0] : 0;
      col[i*3 + 1] = isGold ? GOLD[1] : 0;
      col[i*3 + 2] = isGold ? GOLD[2] : 0;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return gg;
  });
  return mergeGeometries(partsVC, false) || body;
}

/* 挂点收集：柳/紫藤/围栏。
   ⚠️ **必须在 collectSeasonCaches() 之后调用**（08 的 runDeferredBoot 收尾顺序：
   mergeStatics → collectSeasonCaches → applyEnv → collectAOSkip；本函数挂在 collectSeasonCaches
   之后由 initEnvScene/deferBoot 收尾触发）。柳与紫藤都在 deferRoot 延迟批里 —— 模块期去采
   拿到的是空集（本项目老坑：willowLeaf 季节通道曾经一直写不进去）。
   坐标来源**全是已经活着的对象**，不改 06/07：
     · 柳树 → `seasonWillowLeaf` 的柳叶 InstancedMesh（mergeStatics 不吃 InstancedMesh ⇒ 名字/矩阵都在），
       读它的实例矩阵取**真实冠内顶点**（诊断实测柳叶幕 y 3.22~6.61、冠半径中位 1.67）。
     · 紫藤 → 材质是 MAT.wisteria 的 InstancedMesh，按**容量 ≥1500** 筛出两丛大藤架
       （(13.2,3.35,1.2) 容量 2212 / (13.2,3.35,-4.6) 容量 1695；游廊棚另有 12 小丛 375~566，滤掉）。
     · 围栏 → makeWalls 的网格已被 mergeStatics 并掉（名字全丢，实测 count=0），
       墙位完全由 CFG 常量决定（garden 60×45 / wall.h 4.5 / wall.t 0.6），照 07-ground 的
       洞口坐标留空（月洞门与漏窗正上方不挂灯）。 */
const _hangAnchors = { willow: [], wisteria: [], wall: [], built: false };
const _hangInsts = [];             // 三份 InstancedMesh（柳花灯/紫藤花灯/红壁灯）
const FEST_HANG_COLORS = [0xFF6B35, 0xFF8FAB, 0xFFD166, 0x7BD389, 0x6BA8FF];

function collectWillowHangPts(){
  const out = [];
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const it of willowLeafInsts){
    const o = it.o;                                  // 柳叶 InstancedMesh（合并吃不掉）
    o.updateWorldMatrix(true, false);
    const g = o.parent, base = g.position, sc = g.scale.x;
    const cap = o.instanceMatrix.count;                // ⚠️ 容量，不是 count（季节会改 count）
    if (!cap) continue;
    const cand = [];
    const step = 5;
    for (let i = 0; i < cap; i += step){
      o.getMatrixAt(i, m4); m4.decompose(v, q, s);
      cand.push(new THREE.Vector3(base.x + v.x * sc, base.y + v.y * sc, base.z + v.z * sc));
    }
    cand.sort((a, b) => b.y - a.y);                    // 高 → 低
    /* ⚠️⚠️ 2026-09-26 观感修正：**按 y 分层等分索引会聚成一簇**，必须改成**横向最远点采样**。
       诊断（outputs/_diag/willow-cluster-diag.mjs + willow-cluster-points.png）证伪了原假设：
         · 12 个采样点的**原始实例索引是散开的**（[7463,438,7387,1162,...]，非连号）
           ⇒ "都从同一处序列取"（H1）不成立；
         · 单点世界坐标变换无 bug，冠幅本身 5.3~6.3m，12 盏的 xz 跨距已到冠幅的 66~87%
           ⇒ "scale/矩阵把范围压扁"（H2）不成立。
       真正的原因：y 排序后**等分索引**只保证"12 个点均匀分布在 y 那一维"，
       对 xz **毫无保证** —— 一堆 y 接近的叶子在 xz 上可能挤在冠的一角，于是画面读作
       "树冠一角挂了一串气球"，而冠的其余部分是空的（夜景里更明显，因为暗部什么都没有）。
       修法：**最远点采样**（farthest-point sampling）—— 先取 y 在冠中段（yP25~yP75）的候选
       作为种子池（保证仍挂在柳条上、不是浮空），再在 xz 平面上反复"取离已选集合最远的那个点"，
       直到 12 个。这样 12 盏**必然铺满整个冠幅**，读作"柳条上星星点点的花灯"。 */
    const lo = Math.floor(cand.length * 0.25), hi = Math.max(Math.floor(cand.length * 0.75), lo + 1);
    const band = cand.slice(lo, hi);                  // 冠中段的候选池（仍在枝上）
    if (!band.length){ out.push(cand[0].clone()); continue; }
    const picked = [];
    if (band.length <= FEST_WILLOW_PER){
      for (const p of band) picked.push(p);
    } else {
      /* 种子：候选池里离**池质心**最近的（落在冠的中心，最稳）；之后每轮取 xz 距
         已选集合最远者 —— 这是 k-center 贪心，12 个点把 6m 冠幅铺满且间距均匀。 */
      let cx = 0, cz = 0;
      for (const p of band){ cx += p.x; cz += p.z; } cx /= band.length; cz /= band.length;
      let seed = 0, bestD = Infinity;
      for (let i = 0; i < band.length; i++){
        const d = (band[i].x - cx) ** 2 + (band[i].z - cz) ** 2;
        if (d < bestD){ bestD = d; seed = i; }
      }
      picked.push(band[seed]);
      while (picked.length < FEST_WILLOW_PER){
        let bi = -1, bD = -1;
        for (let i = 0; i < band.length; i++){
          let d = Infinity;
          for (const q of picked){ const t = (band[i].x - q.x) ** 2 + (band[i].z - q.z) ** 2; if (t < d) d = t; }
          if (d > bD){ bD = d; bi = i; }
        }
        if (bi < 0) break;
        picked.push(band[bi]);
      }
    }
    for (const src of picked){
      const p = src.clone();
      p.y -= 0.15;                                    // 从枝上垂下来（灯顶贴枝）
      out.push(p);
    }
  }
  return out;
}
function collectWisteriaHangPts(){
  const out = [];
  const jrT = mulberry32(881122);                     // 本地流：布局类随机不走共享 rnd
  const groups = [];
  world.traverse(o => {
    if (o.isInstancedMesh && o.material === MAT.wisteria && o.instanceMatrix.count >= FEST_WIS_MIN)
      groups.push(o);
  });
  for (const grp of groups){
    grp.updateWorldMatrix(true, false);
    const p = grp.parent.position;
    const spanX = 4.4;                                // 实测 xRange 宽约 9m ⇒ 半跨 4.4
    for (let k = 0; k < FEST_WISTERIA_PER; k++){
      const u = (k + 0.5) / FEST_WISTERIA_PER;
      out.push(new THREE.Vector3(p.x - spanX + spanX * 2 * u,
                                 p.y - 0.20 - jrT() * 0.14,   // 落在藤与花穗顶之间
                                 p.z + (jrT() - 0.5) * 0.35));
    }
  }
  return out;
}
function collectWallHangPts(){
  const W = CFG.garden.w, D = CFG.garden.d;
  const jrL = mulberry32(334455);
  const out = [];
  /* 洞口留空：坐标抄 07-ground 的 makeWalls（北墙 i=±1,±2 漏窗；南墙月洞门 + 四漏窗；
     东西墙 rotation.y=π/2 ⇒ 墙沿 z，洞的墙局部 x 就是世界 z）。 */
  const inGap = (x, z, gaps) => gaps.some(gp => Math.hypot(x - gp[0], z - gp[1]) < gp[2]);
  const runGap = (x0, z0, x1, z1, gaps) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / FEST_WALL_GAP));
    for (let k = 0; k <= n; k++){
      const u = k / n, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
      if (inGap(x, z, gaps)) continue;
      out.push(new THREE.Vector3(x, FEST_WALL_Y + (jrL() - 0.5) * 0.05, z));
    }
  };
  runGap(-W/2 + FEST_WALL_OFF, -D/2 + FEST_WALL_OFF,  W/2 - FEST_WALL_OFF, -D/2 + FEST_WALL_OFF,
         [[0, -D/2, 3.2], [-18.4, -D/2, 2.4], [-9.2, -D/2, 2.4], [9.2, -D/2, 2.4], [18.4, -D/2, 2.4]]);
  runGap(-W/2 + FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,  W/2 - FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,
         [[0, D/2, 3.6], [-12.5, D/2, 2.4], [12.5, D/2, 2.4], [-21, D/2, 2.2], [21, D/2, 2.2]]);
  runGap(-W/2 + FEST_WALL_OFF, -D/2 + FEST_WALL_OFF, -W/2 + FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,
         [[-W/2, -14, 2.4], [-W/2, 2, 2.4]]);
  runGap( W/2 - FEST_WALL_OFF, -D/2 + FEST_WALL_OFF,  W/2 - FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,
         [[ W/2, -14, 2.4], [ W/2,  2, 2.4]]);
  return out;
}

/* 把一份挂点写成 InstancedMesh（一份几何一个对象 = 一次提交）。 */
function addHangInst(geo, mat, pts, seed, tag, colorFn){
  if (!pts.length) return null;
  const inst = new THREE.InstancedMesh(geo, mat, pts.length);
  inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  inst.userData.noMerge = true;                      // 实例色会被几何合并丢掉
  inst.userData.aoSkip = true;                       // 灯自身在发光，不进 GTAO 法线 pass
  inst.userData.festivalHang = true;                 // 门禁按标记识别（不靠名字猜）
  inst.userData.hangKind = tag;
  inst.name = 'festivalHang_' + tag;
  inst.frustumCulled = false;
  const jr = mulberry32(seed);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0),
        s1 = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < pts.length; i++){
    q.setFromAxisAngle(up, jr() * TAU);
    m4.compose(pts[i], q, s1);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, colorFn(jr));
  }
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  world.add(inst);
  _hangInsts.push(inst);
  return inst;
}

/* 收集挂点并建网格。**幂等**，且**在柳叶网格到齐之前拒绝建**（延迟批时序，见 collectSeasonCaches 注释）。 */
export function collectFestivalHangAnchors(){
  if (_hangAnchors.built) return _hangAnchors;
  /* ⚠️ 前置：柳叶 InstancedMesh 必须已经收进季节缓存。延迟批之前调用会拿到空集 ——
     此时**什么都不建、不落 built 标记**，等 runDeferredBoot 收尾那次再来。 */
  if (!willowLeafInsts.length) return _hangAnchors;
  _hangAnchors.built = true;
  _hangAnchors.willow   = collectWillowHangPts();
  _hangAnchors.wisteria = collectWisteriaHangPts();
  _hangAnchors.wall     = collectWallHangPts();
  const flowerCol = (jr) => new THREE.Color(
    FEST_HANG_COLORS[(jr() * FEST_HANG_COLORS.length) | 0]).multiplyScalar(0.82 + jr() * 0.36);
  const redCol = (jr) => {
    const c = [0xE02A1C, 0xD0231A, 0xEE3520][(jr() * 3) | 0];
    return new THREE.Color(c).multiplyScalar(0.88 + jr() * 0.24);
  };
  addHangInst(makeHangFlowerGeo(), hangFlowerMat, _hangAnchors.willow,   20260926, 'willowFlower',   flowerCol);
  addHangInst(makeHangFlowerGeo(), hangFlowerMat, _hangAnchors.wisteria, 20260927, 'wisteriaFlower', flowerCol);
  addHangInst(makeWallRedLanternGeo(), wallRedMat, _hangAnchors.wall,  20260928, 'wallRed',        redCol);
  /* 非灯会态立即归零（applyPresence 之后每帧重申，这里只保证"建完就是关的"） */
  for (const o of _hangInsts) o.count = 0;
  return _hangAnchors;
}

/* 每帧推进河灯漂移（随波 = 慢速小轨道 + 起伏 + 缓旋）。只在灯会开着时写矩阵。 */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(),
      _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
/* `_festFreeze`：门禁**负例自检**用（冻结漂移时钟）。置 true 时 tickFestival 提前 return ——
   ⚠️ 不能靠"在页内反复调 tickFestival(0)"来冻结：渲染循环每帧都会用真时钟再调一次，
   两次调用互相覆盖 ⇒ 冻结无效（实测"冻结"后仍漂 0.062m，门禁当场报红，暴露了这个竞态）。
   所以冻结必须是**权威开关**，而不是"再调一次"。 */
let _festFreeze = false;
export function setFestivalFreeze(v){ _festFreeze = !!v; }
export function tickFestival(t){
  const inst = _festRiver.inst, flame = _festRiver.flame;
  if (_festFreeze) return;
  if (!inst || !(ENV.cur && ENV.cur.festivalShow > 0.03)) return;
  for (let i = 0; i < _festRiver.data.length; i++){
    const d = _festRiver.data[i];
    const a = d.ph + t * d.orbSp;
    const x = d.bx + Math.cos(a) * d.orbR;
    const z = d.bz + Math.sin(a) * d.orbR;
    const y = 0.055 + Math.sin(t * 0.8 + d.ph * 3.0) * 0.02;      // 水面微起伏（水面 0.06 之下贴着）
    _e.set(0, d.yaw + t * d.yawSp, Math.sin(t * 0.9 + d.ph) * 0.06);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(x, y, z), _q, _s);
    inst.setMatrixAt(i, _m4);
    if (flame) flame.setMatrixAt(i, _m4);        // 烛焰与灯花同位同姿（只是材质更亮）
  }
  inst.instanceMatrix.needsUpdate = true;
  if (flame) flame.instanceMatrix.needsUpdate = true;
}

/* 灯会状态（festival-guard 读）—— 按项目规矩**显式暴露可判定的量**，不靠 traverse 猜。 */
export function festivalState(){
  const inst = _festRiver.inst;
  let treeN = 0, treeFull = 0;
  for (const o of treeLanternInsts){
    treeN += o.count;
    treeFull += o.userData.fullCount ?? o.count;
  }
  return {
    on: !!ENV.festival,
    riverN: inst ? inst.count : 0, riverFull: inst ? _festRiver.data.length : 0,
    riverPos: inst && inst.count > 0
      ? _festRiver.data.map((d, i) => {
          inst.getMatrixAt(i, _m4); _m4.decompose(_v, _q, _s);
          return [+_v.x.toFixed(3), +_v.z.toFixed(3)];
        }) : [],
    stringN: _festBulbs.inst ? _festBulbs.inst.count : 0,
    treeN, treeFull,
    /* 新增三批挂灯（柳花灯/紫藤花灯/围栏红壁灯）—— 显式暴露，不靠 traverse 猜。 */
    hang: _hangInsts.map(o => ({
      kind: o.userData.hangKind,
      n: o.count,
      full: o.userData.fullCount ?? o.instanceMatrix.count,
      objs: 1,                                  // 一份几何一个对象（合并后的 draw call 代价）
    })),
    hangBuilt: _hangAnchors.built,
    lampLights: worldLights.length,               // 真光源数必须仍等于灯笼的 5 盏
  };
}

/* 一键切换灯会：开 = 切到夜再叠灯会层；关 = 只撤灯会层（留在夜里）。 */
export function toggleFestival(force){
  const on = force === undefined ? !ENV.festival : !!force;
  if (on === !!ENV.festival) return;
  if (on && ENV.time !== 'night'){ ENV.time = 'night'; ENV.hour = 21.5; }   // 灯会 = 夜的 plus 版
  ENV.festival = on;
  ENV.from = cloneParams(ENV.cur);
  ENV.to = resolveEnv();
  ENV.t = 0;
  syncEnvUI();                              // 夜按钮、时辰滑杆、灯会按钮必须同帧落位
}

/* 灯会的"look"层：叠在时段/季节/天气之上的**第 4 层**（乘性/单键修改既有通道 ⇒
   关灯会时 mixInto 自动把这些键插值回原值，不需要反向代码）。 */
const _FEST_WARM = new THREE.Color(0xFFC890);
const _FEST_FOG  = new THREE.Color(0x3A2A20);
function applyFestivalTo(p){
  p.exposure *= 1.08;                                   // 暖光曝光提升（计划书原文）
  p.bloomStrength = Math.min(0.68, p.bloomStrength * 1.12);   // 辉光加一档（阈值 0.90 不动 ⇒ 不炸死白）
  p.grade.split = Math.min(0.55, p.grade.split + 0.05);
  p.grade.warm.lerp(_FEST_WARM, 0.55);                  // 高光更暖（灯笼红光弥漫）
  p.fogColor.lerp(_FEST_FOG, 0.45);                     // 夜雾里带一点灯会的暖
}

const SEASON_PRESENCE = [
  ['lotusShow',[MAT.lotus]], ['lilyShow',[MAT.lily]], ['wisteriaShow',[MAT.wisteria]],
  /* 芭蕉假茎**不进** presence 表（第八轮用户常识反馈）：芭蕉是多年生草本，
     冬季地上部枯萎但假茎宿存 —— 假茎的颜色由 tinBanana（冬=枯黄）表达，
     消失的只是冠层（GLB 叶+果，随 bananaShow 缩放/隐藏）。
     旧表把 MAT.banana 也挂在 bananaShow 上，冬天整株消失 = 把多年生当一年生。 */
  ['reedShow',[MAT.reed]],
  /* ⚠️ 莲蓬（莲实）必须跟着荷花一起消失。
     莲蓬的**杆**用 MAT.lily、**头与莲子**用 MAT.lotusPod —— 杆在表里、头不在，
     于是冬季 lilyShow=0 把杆藏了、头还留在水面上，看起来就是"悬空的莲蓬"。
     以后凡是"一株植物由多种材质拼成"，登记表必须把它**整套材质**都收进来。 */
  ['lotusShow',[MAT.lotusPod, MAT.lotusPodAged, MAT.lotusPodDark, MAT.lotusSeed]], ['bananaShow',[MAT.bananaFruit]],
  ['wisteriaShow',[MAT.wisteriaLeaf]],
  /* 桃花（2026-09-21）：花/果/落花/叶各自独立材质才能"只开该开的季节"——
     全植物用一种材质的话季节只能整棵树显/隐，做不出"春开花 → 夏结果 → 秋叶黄"。 */
  ['peachShow',[MAT.peachLeaf]], ['peachBlossomShow',[MAT.peachBlossom]],
  ['peachFruitShow',[MAT.peachFruit]], ['peachPetalShow',[MAT.peachPetal]],
  /* 灯会内容也走同一套存在性通道：festivalShow>0.03 才提交。 */
  ['festivalShow',[riverLampMat, riverFlameMat, stringBulbMat]],
];
const seasonMeshCache = new Map();
/* 填充已并入 collectSeasonCaches()（见 willowLeafInsts 一段）：一次遍历同时收
   柳/竹实例与 presence 材质表，并在延迟装配完成后重跑 —— 模块期一次性 traverse
   收不到 deferBoot 里迟到的物件（冬柳回归的根因）。 */
/* 存在性必须**每帧重申**，不能只在过渡里设一次。
   原因：GTAO pass 每帧都会把场景对象的 visible 临时关掉再改回来（AO 的正常做法），
   而 applyEnv 只在 ENV.t < 1 的过渡期间被调用 —— 过渡一结束，没人再重申，
   GTAO 就把 winter 的"花不存在"恢复成了 visible=true。实测就是这样：
     set true  | at gtao.render() <- renderer.render() <- animate()
   同一个根因之前也吃掉过"狂风底值风"。 */
export function applyPresence(p){
  for (const [key, mats] of SEASON_PRESENCE){
    const on = p[key] > 0.03;
    for (const m of mats){
      const list = seasonMeshCache.get(m);
      if (list) for (const o of list) o.visible = on;
    }
  }
  /* 实例化网格再补一道 count：visible 会被 GTAO pass 每帧改回 true，
     而 count=0 时 three.js 根本不提交实例，GTAO 也改不动它。
     花串是"每丛一个 InstancedMesh"（共 14 个），必须逐个处理，不能只认第一个。
     ── 2026-09-22：桃树三套材质改走**分量** count。季节表里 peachShow 春 0.15（先花后叶）、
     peachFruitShow 秋 0.7（果渐疏）、peachPetalShow 春 0.3 一直是小数，但可见性通道只认
     `> 0.03` 的布尔 —— 这三个小数**从来没生效过**：春天本该"花满树、叶刚萌"却直接挂满
     3800 片叶，秋天本该落掉三成果却一个不少。
     按 count 截前缀是唯一不会被 GTAO 冲掉的做法。桃树的实例写入顺序已在 makePeachTree 里
     按乘性散列打散，所以"截前缀"在空间上就是均匀变稀，而不是只掉半边。 */
  for (const [m, key, frac] of [[MAT.wisteria, 'wisteriaShow', false],
                                [MAT.peachLeaf, 'peachShow', true],
                                [MAT.peachFruit, 'peachFruitShow', true],
                                [MAT.peachPetal, 'peachPetalShow', true],
                                /* 河灯/灯串是 InstancedMesh：count=0 ⇒ three 不提交、GTAO 也改不动
                                   （同紫藤那条路的理由）。非灯会态零 draw call。 */
                                [riverLampMat, 'festivalShow', false],
                                [riverFlameMat, 'festivalShow', false],
                                [stringBulbMat, 'festivalShow', false]]){
    const list = seasonMeshCache.get(m);
    if (!list) continue;
    for (const o of list){
      if (!o.isInstancedMesh) continue;
      if (o.userData.fullCount === undefined) o.userData.fullCount = o.count;
      const full = o.userData.fullCount;
      const n = frac ? Math.round(full * Math.min(1, Math.max(0, p[key] || 0)))
                     : (p[key] > 0.03 ? full : 0);
      if (o.count !== n) o.count = n;
    }
  }
  /* ── 枯枝挂灯：走**直接清单**而不是上面的材质缓存表 ──
     ⚠️ 原因：挂灯网格是 `makePeachTree` 在 **deferBoot 延迟批**里建的，而
        `collectSeasonCaches()` 在装配收尾时跑 —— 时序上它能收得到，但**更关键**是
        挂灯网格是**每株桃树一个**、材质共用同一个 TREE_LANTERN_MAT，走材质表虽然也对，
        可它的存在性语义与"季节"无关（只随灯会），混进季节表反而容易被人误读。
        显式清单也和紫藤/柳叶那两组的做法一致（各自一份 max/count 记账）。
     ⚠️ 桃树是**两株**（西岸/北岸），必须整组处理 —— 只改第一个就会出现"一棵树挂灯、
        另一棵没有"（同紫藤只改第一个的老 bug）。 */
  const treeOn = p.festivalShow > 0.03;
  for (const o of treeLanternInsts){
    if (o.userData.fullCount === undefined) o.userData.fullCount = o.count;
    const n = treeOn ? o.userData.fullCount : 0;
    if (o.count !== n) o.count = n;
  }
  /* 柳/紫藤/围栏三批挂灯：同一条"随灯会"的通道，同样走**直接清单**而不是季节表。
     ⚠️ 容量取 `instanceMatrix.count`（建网格时定的），**不是** `o.count` —— count 是被本函数
        改写的量（下一行就写它），拿它当容量会第一次把 count 锁成 0、永不复原。 */
  for (const o of _hangInsts){
    const cap = o.instanceMatrix.count;
    if (o.userData.fullCount === undefined) o.userData.fullCount = cap;
    const n = treeOn ? o.userData.fullCount : 0;
    if (o.count !== n) o.count = n;
  }
}

/* 紫藤花串是**每丛一个 InstancedMesh**，不是整园共用一个：
   实测 14 个（实例数 508/697/702/…/4055）。
   ⚠️ 这里曾经只 find 了第一个并缓存成单个引用，结果冬季只清掉一丛，
   另外 13 丛照常开花 —— 画面看起来"紫藤冬天还在开花"。必须整组处理。 */
const seasonGLB = { LotusPlant: [], BananaPlant: [], Turtle: [] };
/* ⚠️ 不能"一旦非空就不再搜"。莲花 12 株是同一批挂上的没问题，但**乌龟有两批**：
   岸上晒背的 placeAssets 4 只 + 池中缓游的 loadAssetOnce 2 只 —— 先到的那批把数组填满后，
   后到的那批永远进不来，冬季 turtleShow=0 就只藏了一半。改为按对象去重地追加。 */
function collectSeasonGLB(){
  for (const name in seasonGLB){
    world.traverse(o => {
      if (o.isMesh && o.name === name && seasonGLB[name].indexOf(o) < 0) seasonGLB[name].push(o);
    });
  }
  /* ── GLB 荷花丛进风场（2026-09-17 用户："荷花和荷叶为啥不会随风晃动"）──
     GLB 材质的身份和芭蕉叶一样：异步挂载、材质是 GLB 自带的，
     从来没登记进风场表 —— 于是狂风里只有我们补的那根花梗在摆、花叶本体纹丝不动。
     这不仅是"不动"的问题：杆摆、花不摆，杆顶就会从花心里**脱出来**，
     又变回"杆没接上花"的样子。
     12 株共用同一个材质对象、且根部都在水面（y=0），所以 tip 模式的基准高度是同一个值，
     注一次即可 —— 用 Set 去重，避免每株各克隆一份（材质数 ×12 只会徒增 shader 变体）。
     幅度取 0.030，与同池的 MAT.lily（睡莲叶盘/程序化荷杆）完全一致：
     池面所有水生植物的摆动语汇统一，不会出现"这边狂摆那边死水"。
     位移硬顶同样取 5cm —— 用户要求"只能在水池中，不要穿模到岸边草皮或石头上"。 */
  const pending = new Set();
  for (const o of seasonGLB.LotusPlant){
    if (o.material && !o.material.userData.windInjected) pending.add(o.material);
  }
  for (const m of pending){
    const nm = m.clone();
    nm.userData.windInjected = true;
    addWind(nm, 0.030, 1.15, 'tip', 0.0, 0.05);
    for (const o of seasonGLB.LotusPlant) if (o.material === m) o.material = nm;
  }
}
/* 季节存在性 + 平滑缩放（GLB 用缩放而不是二值开关：冬季 lotusShow=0 才真消失，
   中间值如芭蕉 0.12 会缩到很小而不是突兀地整片闪掉）。
   独立成函数是为了"资产一到就立即套用当前状态"，不必等下一次环境切换。 */
function applyGLBSeason(p){
  for (const name in seasonGLB){
    const key = name === 'LotusPlant' ? 'lotusShow' : name === 'BananaPlant' ? 'bananaShow' : 'turtleShow';
    const v = Math.max(0.001, p[key]);
    for (const o of seasonGLB[name]){
      o.visible = p[key] > 0.02;
      let root = o; while (root.parent && root.parent !== world) root = root.parent;
      /* 芭蕉（多年生草本）：缩放目标优先取 userData.crown（冠层组）——
         假茎宿存不缩，冬季冠层隐藏 = "枯株"而不是"整株消失" */
      const target = root.userData.crown || root;
      if (target.parent === world || target.parent === root){
        if (!target.userData.baseScale) target.userData.baseScale = target.scale.clone();
        target.scale.copy(target.userData.baseScale).multiplyScalar(v);
      }
    }
  }
}
export function onAssetAttached(){
  collectSeasonGLB(); applyGLBSeason(ENV.cur);
  /* 迟到资产是**真投射物**（晒背龟/芭蕉/莲）：不光要补渲阴影图，
     包围盒也变了 —— 不重算的话阴影视体还是按旧轮廓拟合，新资产可能整个落在盒外。 */
  markCasterBoxDirty();
  fitShadowCamera();
  renderer.shadowMap.needsUpdate = true;   // 迟到资产含真投射物（晒背龟/芭蕉/莲），阴影图补渲一次
}
/* 登记给 06-vegetation 的 loadAssetOnce 回调（见 06 文件头的 HOOKS 说明）：
   06 不能静态 import 本模块 —— 本模块 body 早于 world 求值且 import 08，会把 08 提前拽进来。
   回调触发时（GLB 到位）一切早已就绪。 */
HOOKS.onAssetAttached = onAssetAttached;
/* 柳叶是实例化网格：改 count 就能做连续的「落叶」。
   ⚠️ 必须覆盖**每一棵柳树的叶片实例**。原来只记住 traverse 到的最后一个 MAT.willow 实例
   （4 棵柳树 ×（柳条 + 柳叶）共 8 个组），冬季只把其中一棵的叶子收掉，另外三棵照旧满树绿叶。
   与紫藤同一个根因：**同材质的实例化网格有多个，不能只认一个**。
   只标记 lInst（叶）；柳条是枝，冬季本就还在，不缩放。 */
const willowLeafInsts = [];
const bambooLeafInsts = [];
/* ⚠️ 收集必须能**重跑**（2026-09-19 冬柳回归）：
   柳/竹走 deferBoot 延迟装配，模块求值期 world 里根本没有它们 —— 这里收集到的永远是空表，
   于是 willowLeaf=0.02 写了个寂寞，冬季四棵柳照旧满树垂帘（用户截图实测：
   count 停在 8026/7830/7983/8327 满值）。凡"延迟批会塞东西进来"的缓存，
   必须在延迟批收尾处再调一次；所以收成函数，而不是模块期一次性 traverse。 */
export function collectSeasonCaches(){
  willowLeafInsts.length = 0;
  bambooLeafInsts.length = 0;
  const presence = new Map();                     // SEASON_PRESENCE 的材质 → mesh 表（一次遍历全收）
  for (const [, mats] of SEASON_PRESENCE) for (const m of mats) presence.set(m, []);
  world.traverse(o => {
    if (o.isInstancedMesh){
      if (o.userData.seasonWillowLeaf) willowLeafInsts.push({ o, max: o.count });
      if (o.userData.seasonBambooLeaf) bambooLeafInsts.push({ o, max: o.count });
      /* ⚠️ 不能在这里直接 return（2026-09-19 冬季紫藤照常开花的静默回归根因）：
         紫藤花穗也是 InstancedMesh（每丛一个），当年加柳/竹叶计数时把"所有实例网格"
         从 presence 收集里剔除了 → seasonMeshCache 里 MAT.wisteria 永远是空表
         → applyPresence 的 visible=false / count=0 全部落空，冬季 641 朵花照常提交。
         规则：实例网格凡材质登记在 presence 表里，照常收（柳/竹叶材质不在表里，互不干扰）。 */
      if (presence.has(o.material)) presence.get(o.material).push(o);
      return;
    }
    if (o.isMesh && presence.has(o.material)) presence.get(o.material).push(o);
  });
  for (const [m, list] of presence) seasonMeshCache.set(m, list);
  /* 挂点收集**挂在这里**（与季节缓存同一趟、且在其后）：柳/紫藤都在 deferRoot 延迟批里，
     必须在 collectSeasonCaches 之后才收得到（模块期收 = 空集，本项目老坑）。
     ⚠️ 本函数在启动里被调**两次**（initEnvScene 一次 = 延迟批之前；runDeferredBoot 收尾再一次
     = 延迟批之后）。第一次柳树还没进场 ⇒ 必须在"柳叶网格收齐"之前**拒绝建网格**，
     否则挂灯会按空集建好、永远补不上（这就是 willowLeaf 季节通道当年一直写不进去的同一类坑）。
     所以：柳叶网格为 0 时只返回、不落 built 标记、不建任何挂灯网格；围栏挂点与时机无关，
     但为保持"三个网格同生同死"的简洁，同样等柳叶到齐后一次性建。 */
  collectFestivalHangAnchors();
}
/* ⚠️ 这里**没有**顶层 `collectSeasonCaches()`：它 traverse `world`，而本模块被 08 import 而在
   world 之前求值 → 顶层调用必 TDZ。已并入下面的 initEnvScene（world 组装 + 合并之后才跑，
   这也正是原 §8→§12 的时序：缓存必须在合并后收，才能对上合并后的网格）。 */

/* ══ 天气表现 · 一 · 积雪 ══
   把「雪」做成朝上表面的着色，而不是给地面换一张贴图：
   顶点着色器算世界坐标与世界法线，片元按 upness 混白，并用世界坐标采一层多层 FBM 做斑驳
   （用世界坐标而不是 uv —— 合并几何后 uv 是各构件自己的，拼在一起会露出接缝）。
   雪在标准 PBR 里着色（不改 emissive 之类），所以它照样接受阴影与雾，看上去才是"落在地上"的。
   ❗ 必须链式挂接 onBeforeCompile：叶/柳/苇已有风场注入，季节色调也在同一个钩子上。 */
const snowUniform = { value: 0 };
let windBaseApplied = 0;
const snowTintUniform = { value: new THREE.Color(0xF2F6FA) };
function installSnow(list){
  for (const m of list){
    if (!m || m.userData.snowInstalled) continue;
    m.userData.snowInstalled = true;
    /* 补装路径（registerWeatherRoles 晚注册 → SNOW_HOOK）里材质可能**已经编译过**：
       改了 onBeforeCompile 与 customProgramCacheKey 之后必须标脏才会重新编译，
       否则"名单里加了它"这件事对画面毫无影响 —— 石头照样不积雪。首帧前全量装雪时无害。 */
    m.needsUpdate = true;
    const prevCB = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = function (shader, renderer){
      if (prevCB) prevCB.call(this, shader, renderer);
      shader.uniforms.uSnowCover = snowUniform;
      shader.uniforms.uSnowTint  = snowTintUniform;
      // 逐材质：薄叶面用自己的加成，没有登记的材质为 0（= 完全走原来的朝上判据）
      shader.uniforms.uSnowBoost = (this.userData && this.userData.snowBoost)
                                 ? this.userData.snowBoost : { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n' +
          /* ⚠️ 这里原来用 normalMatrix —— 那是**视空间**法线，片元里却拿 vSnowN.y 当"朝上程度"。
             后果：一块不动的屋面，相机仰角一变积雪判定就变（同一朝上面在三种仰角下
             vSnowN.y = 0.999 / 0.707 / 0.100）—— 雪会跟着相机走。
             改用世界空间法线（模型矩阵 × 实例矩阵）；非均匀缩放下仍非严格逆转置，
             但归一化之后对"朝上程度"足够。 */
          '#ifdef USE_INSTANCING\n' +
          '  mat4 sM = modelMatrix * instanceMatrix;\n' +
          '  vec3 sN = mat3(modelMatrix) * mat3(instanceMatrix) * normal;\n' +
          '#else\n' +
          '  mat4 sM = modelMatrix;\n' +
          '  vec3 sN = mat3(modelMatrix) * normal;\n' +
          '#endif\n' +
          '  vSnowW = (sM * vec4(transformed, 1.0)).xyz;\n' +
          '  vSnowN = normalize(sN);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\n' +
          'varying vec3 vSnowW;\n' +
          'varying vec3 vSnowN;\n' +
          'uniform float uSnowCover;\n' +
          'uniform vec3 uSnowTint;\n' +
          'uniform float uSnowBoost;\n' +
          'float snowHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }\n' +
          'float snowNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);\n' +
          '  return mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), u.x),\n' +
          '             mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), u.x), u.y); }')
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n' +
          '  if (uSnowCover > 0.001){\n' +
          '    // 平摊的薄叶面（竹叶/芭蕉等）法线基本水平，upness≈0，光靠朝上程度挂不住雪；\n' +
          '    // 用 uSnowBoost 给这类材质放宽：把 upness 的下限抬到"只要不是朝下就认"\n' +
          '    float upness = smoothstep(0.30, 0.78, vSnowN.y) * (1.0 - uSnowBoost)\n' +
          '                 + smoothstep(-0.15, 0.45, vSnowN.y) * uSnowBoost;\n' +
          '    float dr = snowNoise(vSnowW.xz * 0.65) * 0.62 + snowNoise(vSnowW.xz * 2.7 + 13.1) * 0.28\n' +
          '             + snowNoise(vSnowW.xz * 7.3 + 41.7) * 0.10;\n' +
          /* 覆盖量：噪声给斑驳的边缘（不是均匀刷白），阈值随 uSnowBoost 下移 ——
             只放宽 upness 是不够的：dr 的均值约 0.5，在 smoothstep(0.24,0.80) 下只有 ~0.47 的权重，
             薄叶面的雪就一直是"隐约有点白"，撑不起"雪压竹叶"这一笔。 */
          '    float lo = mix(0.24, 0.03, uSnowBoost);\n' +
          '    float hi = mix(0.80, 0.52, uSnowBoost);\n' +
          '    float amt = smoothstep(lo, hi, dr) * upness * uSnowCover;\n' +
          '    amt *= 1.0 + 0.25 * uSnowBoost;\n' +
          '    diffuseColor.rgb = mix(diffuseColor.rgb, uSnowTint * (0.72 + 0.40 * dr), amt);\n' +
          '  }');
    };
    m.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : '') + '|snow'; };
  }
}
/* 湿地：只改材质参数，不动着色器 —— 粗糙度压下去，天空与树就会在石板上留下倒影。
   ⚠️ 2026-09-18 改过系数，原因见下（metalness 曾是 +0.20、rough 系数是 0.72）。 */
export let wetApplied = -1;
function applyWetness(v){
  // 每帧都会走到这里，但只有数值真的变了才写材质属性 —— 否则会一直把材质标脏
  if (Math.abs(v - wetApplied) < 0.004) return;
  wetApplied = v;
  wetUniform.value = v;
  for (const m of WET_MATS){
    if (!m || m.userData.dryRough === undefined) continue;
    /* 物理上的错：水是**电介质**，蒙一层水膜不会让石头/木/瓦长出金属度。
       旧式 metalness = dryMetal + 0.20·v² 把整个湿面变成半金属 —— 环境反射被按
       基色放大，于是暴雨里瓦面、石岸、草地都浮出一层顺视线的金色/白色高光带
       （用户报的"像有太阳透下来"，换个角度才明显，正是镜面反射的签名）。
       正确取法：只压粗糙度、金属度几乎不动（+0.05 只为让 IBL 反射稍微"接得住"）。 */
    m.roughness = m.userData.dryRough * (1 - 0.62 * v * v);   // 平方：小雨几乎无感，暴雨才成镜
    m.metalness = m.userData.dryMetal + 0.05 * v * v;
  }
}

/* ══ 四季自动演示（2026-09-25 · 计划书 Phase 3 第 8 项）══════════════════════
   与 REEL 的时辰流转不同：这里只推进 season，并复用导览机位与字幕。
   默认不自动播放，只由按钮启动；任意手动操作立即停止并恢复控制权。 */
const SEASON_DEMO_ORDER = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_DEMO_SHOTS = ['hall', 'pavilion', 'hero', 'overview'];
export const SEASON_DEMO = { on: false, phase: 'idle', idx: 0, hold: 0,
                             flyDur: 7, holdDur: 3.5, history: [] };
function syncSeasonDemoBtn(){
  const b = envEl && envEl.querySelector('[data-act="season-demo"]');
  if (!b) return;
  b.classList.toggle('on', SEASON_DEMO.on);
  b.setAttribute('aria-pressed', SEASON_DEMO.on ? 'true' : 'false');
  b.textContent = SEASON_DEMO.on ? '四季停■' : '四季▸';
}
function stopTourForDemo(){ if (TOUR.on) tourStop(); }
export function stopSeasonDemo(reason = 'manual'){
  if (!SEASON_DEMO.on) return false;
  SEASON_DEMO.on = false; SEASON_DEMO.phase = 'idle'; SEASON_DEMO.hold = 0;
  cancelCamFly('season-demo');
  hideCaption('season-demo');
  syncSeasonDemoBtn();
  return true;
}
function enterSeasonDemo(i, flyDur = SEASON_DEMO.flyDur){
  const idx = ((i % SEASON_DEMO_ORDER.length) + SEASON_DEMO_ORDER.length) % SEASON_DEMO_ORDER.length;
  const season = SEASON_DEMO_ORDER[idx];
  SEASON_DEMO.idx = idx; SEASON_DEMO.phase = 'flying';
  SEASON_DEMO.history.push(season);
  setEnv('season', season);
  showSeasonCaption(season);
  gotoViewpoint(SEASON_DEMO_SHOTS[idx], flyDur, 'season-demo');
  syncSeasonDemoBtn();
}
export function startSeasonDemo(opts = {}){
  const flyDur = Number.isFinite(opts.flyDur) ? Math.max(0.01, opts.flyDur) : SEASON_DEMO.flyDur;
  const holdDur = Number.isFinite(opts.holdDur) ? Math.max(0, opts.holdDur) : SEASON_DEMO.holdDur;
  SEASON_DEMO.flyDur = flyDur; SEASON_DEMO.holdDur = holdDur;
  if (REEL.on) toggleReel();
  stopTourForDemo();
  if (introActive()) introCancel();
  cancelCamFly();
  if (envEl.classList.contains('expanded')){
    const toggle = envEl.querySelector('.drawer-toggle');
    if (toggle) toggle.click();
  }
  SEASON_DEMO.on = true; SEASON_DEMO.history = []; SEASON_DEMO.hold = holdDur;
  enterSeasonDemo(0, flyDur);
  return true;
}
export function toggleSeasonDemo(){ return SEASON_DEMO.on ? (stopSeasonDemo('button'), false) : startSeasonDemo(); }
export function advanceSeasonDemo(dt){
  if (!SEASON_DEMO.on) return;
  if (CAM_FLY.on && CAM_FLY.owner === 'season-demo') return;
  if (SEASON_DEMO.phase === 'flying') SEASON_DEMO.phase = 'holding';
  SEASON_DEMO.hold -= dt;
  if (SEASON_DEMO.hold <= 0) enterSeasonDemo(SEASON_DEMO.idx + 1, SEASON_DEMO.flyDur);
}
export function seasonDemoUserTakeover(){ stopSeasonDemo('user'); }
export function seasonDemoState(){
  return { ...SEASON_DEMO, history: SEASON_DEMO.history.slice() };
}
export function seasonDemoCaption(){
  const el = document.getElementById('caption');
  return { shown: !!(el && el.classList.contains('show')),
           title: el && el.querySelector('b') ? el.querySelector('b').textContent : '',
           text: el && el.querySelector('span') ? el.querySelector('span').textContent : '',
           season: ENV.season };
}

/* ══ 状态机与过渡 ══ */
export const ENV = {
  time:'noon', season:'summer', weather:'clear',
  festival:false,                                 // 上元灯会（第 4 层开关，见 makeFestivalLights 一段）
  hour:12.5,                                   // 连续时辰（0~24）：按钮切时段只是对齐到锚点
  cur:null, from:null, to:null, t:1, dur:2.8,      // dur = 过渡时长（秒）
};
ENV.cur  = resolveEnv();          // 必须走组合规则：季节通道也要在参数集里
ENV.from = cloneParams(ENV.cur);
ENV.to   = cloneParams(ENV.cur);
/* 发布给 2b-wind（它只在函数体里读 windMul，但若直接 import 本模块会成环 → 见 00-config
   的 ENV_REF 注释）。放在 ENV.cur 就位之后、applyEnv 之前：后续任何风力计算都拿得到。
   ⚠️ 发布的是**参数集 ENV.cur**，不是状态机 ENV —— windMul 挂在参数集上，发布错了对象会
   被读侧的 `|| 1` 静默兜底成晴天（2026-09-20 修）。ENV.cur 全程只在这里创建一次，之后由
   11-loop 的 mixInto(ENV.cur, from, to, t) **就地改写**、对象身份不变 → 发布一次即可，
   读到的恒为当前值。 */
ENV_REF.cur = ENV.cur;

export function setEnv(axis, val){
  /* 先验后写 —— 这个函数挂在 window.__garden 上供外部驱动（采集脚本、控制台），
     一次 setEnv('time', undefined) 就会把 ENV.time 写成 undefined，画面卡住且每帧报错。
     合法的轴/值在这里一次性收口，非法调用直接忽略并留痕，状态机不被污染。 */
  /* ⚠️ 必须用 Object.hasOwn，不能靠 ENV_TIME[val] 的真值：继承来的键
     （constructor / toString / __proto__ …）都是真值，会被当成合法值写进 ENV，
     然后 resolveEnv 在 ENV_TIME['constructor'].label 上炸 ——
     实测 throw：Cannot read properties of undefined (reading 'saturation')，状态同时被污染。 */
  const table = axis === 'time' ? ENV_TIME
              : axis === 'season' ? ENV_SEASON
              : axis === 'weather' ? ENV_WEATHER : null;
  const legal = !!table && Object.hasOwn(table, val);
  if (!legal){
    console.warn('[ENV] 非法切换被忽略：', axis, '=', val);
    return;
  }
  if (ENV[axis] === val) return;
  ENV[axis] = val;
  if (axis === 'time') ENV.hour = TIME_ANCHORS[val];   // 时段按钮 = 把连续时辰对齐到锚点
  ENV.from = cloneParams(ENV.cur);      // 从「当前实际画面」出发，连点也不会跳
  ENV.to   = resolveEnv();
  ENV.t    = 0;
  /* PMREM 按时段缓存：切时段时一次性切换环境贴图（缓存命中则零烘焙）。
     不能在 applyEnv 里调 —— applyEnv 每帧兜底触发会反复烘或压成 'default' 键。 */
  if (axis === 'time' && ENV.to.skyTop){
    setEnvPreset({ key: val, skyTop: ENV.to.skyTop.getHex(), skyMid: ENV.to.skyMid.getHex(),
                   skyHorizon: ENV.to.skyHorizon.getHex(), sunDisk: ENV.to.sunDisk.getHex(),
                   ground: 0x5F7B45, sunPos: ENV.to.sunPos });
  }
  enforceWeather();                     // 非法组合在这里就被打回，不留非法状态
  syncEnvUI();
}

/* 天气互斥：银装素裹只在冬季合法；非冬季若被置成它，自动降级回"风和日丽"。
   "狂风暴雨在冬季渲染为风雪"不是降级 —— 它是合法组合，由 effectiveWeather() 决定表现。 */
export function weatherAllowed(weather){
  return weatherMutexReason(weather, ENV.season) === null;
}
/* 唯一的强制点。UI 置灰只是「提示」，不是「保证」：键盘、控制台、外部脚本都能绕过按钮，
   所以真正的降级必须发生在 setEnv 里 —— 否则会出现「夏季 + 银装素裹」这种非法状态留在画面上。 */
function enforceWeather(){
  if (weatherAllowed(ENV.weather)) return false;
  ENV.weather = 'clear';                                  // 降级目标：风和日丽
  /* ⚠️ 不要在这里瞬切（ENV.t = 1 + 立刻 applyEnv）。原来那样写，从"冬 + 银装素裹"
     切到春天会把画面**当场**换成风和日丽，2.8 秒过渡整段被跳过 —— 用户看到的是跳变。
     正确做法：先把目标归一化，再从当前画面平滑过渡过去。 */
  ENV.from = cloneParams(ENV.cur);
  ENV.to   = resolveEnv();
  ENV.t    = 0;
  return true;
}

export const envEl = document.getElementById('env');
/* P2-2：巡游期间用户在画布上的任何手动操作都算接管 → 停巡游。
   start 系事件（手按下/滚轮即停），不赌 change/end，低延迟。 */
renderer.domElement.addEventListener('pointerdown', tourUserTakeover);
renderer.domElement.addEventListener('wheel', tourUserTakeover, { passive: true });
renderer.domElement.addEventListener('pointerdown', seasonDemoUserTakeover, true);
renderer.domElement.addEventListener('wheel', seasonDemoUserTakeover, { passive: true, capture: true });
addEventListener('keydown', (e) => {
  if (!SEASON_DEMO.on || e.key.toLowerCase() === 'y') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  seasonDemoUserTakeover();
}, true);
envEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.act !== 'season-demo') seasonDemoUserTakeover();
}, true);
/* 合并时段条的读数气泡：钉在滑块圆球正上方（--r = hour/24，CSS 端 calc 定位） */
function placeHourTip(hour){
  const tip = document.getElementById('hourReadout');
  const track = document.getElementById('timeTrack');
  if (!tip || !track) return;
  const r = Math.max(0, Math.min(24, hour)) / 24;
  track.style.setProperty('--r', r.toFixed(4));
  tip.textContent = fmtHour(hour);
}
function syncEnvUI(){
  envEl.querySelectorAll('button').forEach(b=>{
    /* 动作按钮（明信片/音景/巡游/时光流转）无 data-axis：不参与环境轴状态同步 ——
       否则 ENV[undefined]===undefined 恒真，它们初始就被错误点亮 .on 高亮。
       ⚠️ 这里**必须**补齐 aria-pressed（不能跳过 data-act 的那几个）：
       smoke 断言「所有 env 按钮 aria-pressed 齐全」，动作按钮的初始属性正是靠
       这里补上的，漏一个就红。开关类（音景/巡游/流转/灯会）的真实按下态由各自的
       toggle* 维护；环境轴切换时本函数会把普通动作按钮归零，而灯会是与时段正交的第 4 层，
       必须继续保留自身状态。 */
    if (b.dataset.act === 'festival'){
      b.setAttribute('aria-pressed', ENV.festival ? 'true' : 'false');
      return;
    }
    if (b.dataset.act === 'season-demo'){
      b.setAttribute('aria-pressed', SEASON_DEMO.on ? 'true' : 'false');
      return;
    }
    if (b.dataset.quality){
      const q = HOOKS.qualityState?.();
      const on = (q?.mode || 'auto') === b.dataset.quality;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      return;
    }
    if (!b.dataset.axis){ b.setAttribute('aria-pressed', 'false'); return; }
    const axis = b.dataset.axis, v = b.dataset.v;
    b.classList.toggle('on', ENV[axis] === v);
    /* aria-pressed（P1-8）：所有 env 按钮都是 toggle 语义，选中态对读屏可感知 */
    b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
    if (axis === 'weather'){
      const why = weatherMutexReason(v, ENV.season);
      b.disabled = !!why;
      b.title = why || '';                       // 悬停给出原因（原生 tooltip，零成本）
    }
  });
  /* 滑杆跟 ENV.hour 对齐（时段按钮把 hour 拉回锚点时，滑杆位置同步走） */
  const hs = document.getElementById('hourSlider');
  if (hs && Math.abs(parseFloat(hs.value) - ENV.hour) > 0.05){
    hs.value = ENV.hour;
    placeHourTip(ENV.hour);
  }
  /* 2026-09-29 合并时段条：读数气泡 = 拖动提示，钉在滑块正上方跟随移动
     （老黄："拖动的时候具体时间要跟随进度条，提示用户拖到的时间点"） */
  const tip = document.getElementById('hourReadout');
  if (tip) tip.style.left = (Math.max(0, Math.min(24, ENV.hour)) / 24 * 100).toFixed(2) + '%';
}
envEl.addEventListener('click', (e)=>{
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.quality){ HOOKS.setQuality?.(b.dataset.quality); return; }
  /* 动作按钮（明信片/音景）没有 data-axis，先于环境轴处理，避免落进 setEnv 的非法告警 */
  if (b.dataset.act === 'shot'){ HOOKS.postcard?.(); return; }
  if (b.dataset.act === 'long'){ HOOKS.longExposure?.(); return; }
  if (b.dataset.act === 'sound'){ b.classList.toggle('on', !!HOOKS.sound?.()); b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false'); return; }
  if (b.dataset.act === 'reel'){ toggleReel(); return; }   // 时光流转（按钮态由 toggleReel 自己同步）
  if (b.dataset.act === 'random'){ seasonDemoUserTakeover(); HOOKS.randomScene ? HOOKS.randomScene() : randomScene(); return; }
  if (b.dataset.act === 'festival'){ toggleFestival(); return; }   // 上元灯会：一键开关（按钮态由 toggleFestival 自己同步）
  if (b.dataset.act === 'season-demo'){ toggleSeasonDemo(); return; }
  /* P2-2 巡游开关：巡游中按任意导览/环境按钮都先停巡游（接管语义），再执行本意 */
  if (b.dataset.act === 'tour'){ seasonDemoUserTakeover(); TOUR.on ? tourStop() : tourStart(); return; }
  if (b.dataset.view || b.dataset.axis) seasonDemoUserTakeover();
  if (TOUR.on && (b.dataset.view || b.dataset.axis)) tourStop();
  if (REEL.on && b.dataset.axis === 'time') toggleReel();   // 手动选时段 = 接管，停时光流转
  if (b.dataset.view){ gotoViewpoint(b.dataset.view); showCaption(b.dataset.view, 'manual'); setTimeout(() => hideCaption('manual'), 6000); return; }
  /* 选"狂风暴雨"自动开启音景 —— 合并后暴雨带闪电，而闪电的核心观感之一就是雷鸣，
     没有声音等于没做一半。浏览器要求音频必须由用户手势创建，这次点击正好是手势。
     （雨后初晴不需要：它的彩虹是视觉，不需要开音景。） */
  if (b.dataset.axis === 'weather' && b.dataset.v === 'storm' && !HOOKS.sound?.()) HOOKS.sound();
  setEnv(b.dataset.axis, b.dataset.v);
  if (enforceWeather()) syncEnvUI();
});

/* ── 时辰滑杆 ──
   拖动 = 直接操纵时间轴：目标由「锚点插值 + 季节天气叠加」合成，从当前画面
   短过渡过去（0.45s 跟手）；松手把过渡节奏还给 2.8s 的默认值。 */
const hourSlider = document.getElementById('hourSlider');
hourSlider.addEventListener('input', ()=>{
  ENV.hour = parseFloat(hourSlider.value);
  tourUserTakeover();   // P2-2：拖时辰 = 接管，停巡游
  seasonDemoUserTakeover();
  if (REEL.on) toggleReel();   // 手动拖时辰 = 接管，停时光流转
  placeHourTip(ENV.hour);
  ENV.from = cloneParams(ENV.cur);
  ENV.to   = composeEnv(paramsAtHour(ENV.hour));
  ENV.t = 0; ENV.dur = 0.45;
  ENV.time = nearestTimeKey(ENV.hour);     // 按钮高亮 / UI 主题跟随最近锚点
  syncEnvUI();
});
hourSlider.addEventListener('change', ()=>{ ENV.dur = 2.8; });

/* ══ 时光流转（Showreel）：让 ENV.hour 自己走 ══
   按一下就什么都不用再点：晨 → 午 → 暮 → 夜 连续推进，日出日落、月起月落、灯笼点亮、
   星空浓淡、雾的厚薄全部跟着走 —— 它们本来就都由 hour 驱动，这里只是给它上发条。
   speed 单位「小时 / 秒」：0.4 → 一整天约 60 秒走完。 */
export const REEL = { on:false, speed: 0.4 };
export function toggleReel(){
  const next = !REEL.on;
  if (next) seasonDemoUserTakeover();
  REEL.on = next;
  const b = envEl && envEl.querySelector('button[data-act="reel"]');
  if (b){
    b.classList.toggle('on', REEL.on);
    b.setAttribute('aria-pressed', REEL.on ? 'true' : 'false');
    b.textContent = REEL.on ? '流转■' : '流转▸';
  }
  if (REEL.on && TOUR.on) tourStop();      // 两台马达别同时抢：巡游与流转互斥
  return REEL.on;
}
let reelUiAcc = 0, reelShadowAcc = 0;
export function advanceReel(dt){
  ENV.hour = (ENV.hour + REEL.speed * dt) % 24;
  const key = nearestTimeKey(ENV.hour);
  if (key !== ENV.time){ ENV.time = key; syncEnvUI(); }   // 按钮高亮只在跨锚点时刷，不必每帧
  const target = composeEnv(paramsAtHour(ENV.hour));
  /* ⚠️ from 与 to **都**传 target，不要 from 传 ENV.cur：mixInto 的 out 与 from
     若指向同一对象，非数值通道（Color / 数组）会边写边读被自己污染。
     from=to=target 且 e=1，等价于「直接落位到目标」，且零 clone。 */
  mixInto(ENV.cur, target, target, 1);
  ENV.from = target; ENV.to = target; ENV.t = 1;   // 状态保持一致，别让别的逻辑读到旧值
  applyEnv(ENV.cur);
  /* 阴影节流到 4Hz：0.25s 内太阳只走 0.1 小时（≈1.5°），肉眼不察，
     但 shadowMap 从「每帧重渲」降到每 0.25s 一次 —— 流转时的帧率才有保障。 */
  reelShadowAcc += dt;
  if (reelShadowAcc >= 0.25){ reelShadowAcc = 0; renderer.shadowMap.needsUpdate = true; }
  /* 滑杆 / 读数每帧写 DOM 太重，节流到 0.2s（滑杆 step=0.1，跟 60fps 也没意义） */
  reelUiAcc += dt;
  if (reelUiAcc >= 0.2){
    reelUiAcc = 0;
    const hs = document.getElementById('hourSlider');
    if (hs) hs.value = ENV.hour;
    const ro = document.getElementById('hourReadout');
    if (ro) placeHourTip(ENV.hour);
  }
}

/* ══ 偶得：随机一幅景色（2026-09-20）══
   "想继续点"的钩子：每按一下（或按 X）都值得截图。随机不是均匀抽——
   · 时段按出片率加权（暮的金光、夜的月与灯最出片；正午最平，权重最低）；
   · 季节均匀；
   · 天气先按所选季节过滤合法集（避免"抽雪得晴"的降级穿帮），再按时段调权
     （白天给阴/雨的戏剧性，夜里偏向晴与薄雾，保住月亮和萤火）；
   · 三连与当前完全相同就重抽；锚点时辰加 ±0.6h 抖动，同样是"暮"每次金光也深浅不同。
   返回 {label, time, season, weather, hour} 供 toast / 门禁使用。 */
const R_TIMES    = [['dusk',4],['night',4],['morning',2.5],['noon',1]];
const R_SEASONS  = ['spring','summer','autumn','winter'];
const R_W_BASE   = { clear:3, mist:2.4, storm:1.2, snow:1, afterrain:1.6 };
// 阴霾暗沉 2026-09-28 收起（权重并入薄雾）；电闪雷鸣 2026-09-30 并入狂风暴雨（hidden）。
// 雨后初晴 1.6：比暴雨高一档 —— 合并后暴雨变成"带雷电的雨"，随机池里若雨太多、
// 难得抽到一次"雨停了太阳出来"的画面。
function rwPick(items){
  let total = 0;
  for (const [, w] of items) total += w;
  let r = Math.random() * total;
  for (const [v, w] of items){ if ((r -= w) <= 0) return v; }
  return items[items.length - 1][0];
}
export function randomScene(){
  seasonDemoUserTakeover();
  if (REEL.on) toggleReel();                    // 流转中先停，否则马达立刻把灯会要设的时辰带走
  let time, season, weather, tries = 0;
  do {
    time = rwPick(R_TIMES);
    season = R_SEASONS[(Math.random() * R_SEASONS.length) | 0];
    const nightish = time === 'night';
    const pool = Object.keys(ENV_WEATHER)
      .filter(w => !ENV_WEATHER[w].hidden && weatherMutexReason(w, season) === null)
      .map(w => [w, (R_W_BASE[w] || 1) * (nightish ? (w === 'clear' || w === 'mist' ? 1.6 : 0.6) : 1)]);
    weather = rwPick(pool);
  } while (time === ENV.time && season === ENV.season && weather === ENV.weather && ++tries < 12);

  ENV.time = time; ENV.season = season; ENV.weather = weather;
  ENV.hour = (TIME_ANCHORS[time] + (Math.random() * 1.2 - 0.6) + 24) % 24;
  ENV.from = cloneParams(ENV.cur);
  ENV.to = resolveEnv(); ENV.t = 0;
  /* ⚠️ 标签必须取**兜底后的目标态** ENV.to.weatherLabel，不能取 weatherTag()：
     后者读 ENV.cur（上一帧画面），本函数可能被连发调用（探针连抽两次），
     两次之间没有动画帧 → cur 还是旧景色，会返回"抽 A 报 B"的穿帮标签。
     合法池已按季节过滤，enforceWeather 这里理论上不再降级——但返回值仍以它为准。 */
  enforceWeather();
  syncEnvUI();
  const hs = document.getElementById('hourSlider');
  if (hs) hs.value = ENV.hour;
  const ro = document.getElementById('hourReadout');
  if (ro) placeHourTip(ENV.hour);
  return {
    time, season, weather: ENV.weather, hour: ENV.hour,
    label: `${ENV_SEASON[season].label} · ${ENV_TIME[time].label} · ${ENV.to.weatherLabel}`,
  };
}
addEventListener('keydown', (e)=>{
  /* 别抢浏览器/编辑器快捷键：Ctrl+S、Cmd+R 之类必须原样放行；
     输入框里打字、输入法组合中、长按重复，也都不该切天气。 */
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (e.key === '0' || e.key === 'Home'){ tourUserTakeover(); seasonDemoUserTakeover(); resetCamera(); return; }   // 视角复位
  if (e.key === 'p' || e.key === 'P'){ HOOKS.postcard?.(); return; }     // 明信片
  if (e.key === 't' || e.key === 'T'){ seasonDemoUserTakeover(); TOUR.on ? tourStop() : tourStart(); return; }  // P2-2 巡游开关
  if (e.key === 'y' || e.key === 'Y'){ toggleSeasonDemo(); return; }
  /* 时光流转用 L：R 已经是「冬」，QWER 四键被季节占满，别抢。 */
  if (e.key === 'l' || e.key === 'L'){ toggleReel(); return; }
  /* 偶得随机景色：X（离右手位近，且未被占用） */
  if (e.key === 'x' || e.key === 'X'){ HOOKS.randomScene ? HOOKS.randomScene() : randomScene(); return; }
  if (e.key === 'z' || e.key === 'Z'){                                // 导览：巡览下一个机位
    tourUserTakeover();                                               // P2-2：巡游中按 Z = 接管，先停再走
    seasonDemoUserTakeover();
    const ids = VIEWPOINTS.map(v => v.id);
    const cur = VIEWPOINTS.findIndex(v => Math.abs(v.pos.x - camera.position.x) < 0.6
                                       && Math.abs(v.pos.z - camera.position.z) < 0.6);
    const nid = ids[(cur + 1 + ids.length) % ids.length];
    gotoViewpoint(nid); showCaption(nid, 'manual'); setTimeout(() => hideCaption('manual'), 6000);
    return;
  }
  if (e.key === 'm' || e.key === 'M'){                                // 音景开关（按钮态同步）
    const sb = envEl.querySelector('button[data-act="sound"]');
    if (sb) sb.classList.toggle('on', !!HOOKS.sound?.());
    return;
  }
  const map  = { '1':'morning', '2':'noon', '3':'dusk', '4':'night' };
  const smap = { q:'spring', w:'summer', e:'autumn', r:'winter' };
  /* 2026-09-28：'阴霾暗沉'从菜单收起（老黄："和薄雾感官上太一致，保留薄雾"）——
     d 键空出；预设数据保留（mist-guard 仍可直调 setEnv 测试雾管线），想恢复一条线的事。 */
  /* 2026-09-30：'电闪雷鸣'并入'狂风暴雨'（老黄："这两个场景可以合并，空出一个格子"）
     ⇒ h 键空出，'j' 改为新场景「雨后初晴」。 */
  const wmap = { a:'clear', s:'storm', j:'afterrain', f:'snow', g:'mist' };
  const hit = map[e.key] || smap[e.key.toLowerCase()] || wmap[e.key.toLowerCase()];
  if (!hit) return;
  seasonDemoUserTakeover();
  if (map[e.key])  setEnv('time', hit);
  else if (smap[e.key.toLowerCase()]) setEnv('season', hit);
  else if (weatherAllowed(hit)){
    if (hit === 'storm' && !HOOKS.sound?.()) HOOKS.sound();   // 同点击：选暴雨自动开音景（它带雷声）
    setEnv('weather', hit);
  }                                          // 非法组合不走键盘这条捷径
  if (enforceWeather()) syncEnvUI();
});

/* ── 装配阶段收尾（2026-09-20 · 拆模块时从本模块顶层移出）──
   这四件事都必须在 08 把 world 组装完（且 mergeStatics 之后）才做：
     · makeLanterns  往 world 挂灯笼（动态单摆，必须留在合并之外）
     · syncEnvUI     把当前时段/季节/天气同步到面板按钮
     · applyEnv      首帧前按当前环境套一遍（它会写 08 的 perchShowOK —— 08 body 未跑就写必 TDZ）
     · installSnow   首帧渲染前装雪（onBeforeCompile，编译期才读 snowBoost，所以与下方
                     SNOW_BOOST 赋值块的先后无所谓）
   ⚠️ 相对顺序与本文件原顶层完全一致（灯笼 → UI → applyEnv → installSnow），只是整体推后到
   world 就绪之后。由 08 的 body 末尾调用。 */
/* ══ 电闪雷鸣（2026-09-30 · 老黄需求）══════════════════════════════════════
   天气预设 thunder 只负责"暗"（压到接近暮色）；闪电是叠在上面的**事件**：
   · 随机间隔触发（4.5~11s，约 1/4 概率带一次连击 = 密集）；
   · 单次事件三件套：
     ① 空中电闪：程序化分叉雷电（折线宽带 ribbon，加性发光，叠 bloom）出现在
        **相机看得到的方位**（按当前视线方位角 ±66° 内选），同时写天空 uFlash
        让云层与天幕泛白（着色器里"云响应最强"）；
     ② 亮光划过：一条长亮痕沿同一天区横扫而过（0.3s，边走边淡）；
     ③ 照亮整体：把 sun/amb/hemi/曝光按闪光包络**乘**一个瞬时系数，
        2~4 次脉冲（真实闪电的多闪节奏）后归零；
   · 闪电瞬间通过 `HOOKS.thunder` 通知音景排队雷鸣（延迟按"距离"算，1~3 层叠放）。
   ⚠️ 三条纪律：
   ① 只在 ENV.weather==='thunder' 且未关时推进；离开该天气立刻把叠加量写回基准
      （写完 flash=0 ⇒ 各项 = 基准 × 1，零残留）。
   ② **不新增灯**（灯数一变全场材质重编译）—— 闪光是把既有 sun/amb/hemi/曝光乘系数，
      基准取 ENV.cur（applyEnv 的产物），每帧重算 ⇒ 与过渡系统天然自愈。
   ③ tickLightning 必须在 animate 的 ENV 过渡块**之后**调用（transition 里的 applyEnv
      会覆写光照；顺序反了闪光会被压掉）。
   ④ 顺序：闪电网格与照亮**同帧起**，且绝不出现"只有照亮没有闪电"的帧（老黄明确要求
      "一定是闪电后才有照亮场景的效果"）。 */
export const LIGHTNING = {
  on: true,             // 事件总开关（探针负例用）
  /* 定格：非 null 时把事件时钟**按住**在该 tau（秒），只按它重放包络 ——
     探针要可复现的峰值帧、截图/明信片要拍到闪电，都靠它。
     ⚠️ 为什么必须是产品侧开关：探针在页内"再调一次 tick"是无效的 ——
     渲染循环每帧都会用真实时钟再算一遍，两次互相覆盖（项目 2026-09-24 灯会那次
     就是栽在这上面，冻了 0 位移仍有 0.062m）。同 setFestivalFreeze 的做法。 */
  hold: null,
  next: 4.0,            // 下一次闪电的时刻（仿真秒）
  t0: -99,              // 本次事件起刻
  flash: 0,             // 当前闪光强度 0..1（探针读数）
  boltT: -99,           // 最近一次"闪电网格出现"的时刻
  strikes: 0,           // 累计闪电次数
  lastThunder: null,    // 最近一次雷鸣参数（探针/诊断）
  _pulses: null, _streakA: null, _streakB: null, _streakQ: null, _streakLen: 0,
  _group: null, _bolt: null, _boltMat: null, _streak: null, _streakMat: null,
};
const LN_RNG = mulberry32(20260930);        // 专用随机流（运行期效果也绝不吃全局 rnd）
const lnR = (a, b)=> a + LN_RNG() * (b - a);
const LN_R = 388;                            // 天球半径 420 ⇒ 闪电放在穹内 388
const _lnNd = new THREE.Vector3();            // 复用的 NDC 反投影暂存
/* NDC（归一化设备坐标，x/y ∈ [-1,1]）→ 天球上的世界点。
   ── 为什么按**画面坐标**摆闪电，而不是按"地平线以上多少度"（2026-09-30 实测修正）──
   garden 的机位是**俯视**的：默认机位实测 pitch −19.3°、相机 fov 46（垂直半角 23°）
   ⇒ 画面上缘只到仰角 +3.7°，可见天空是画面上端一条**只有约 4° 高**的窄带。
   旧写法按仰角 9°~38° 摆，实测闪电网格投到 ndc.y 1.8~6.8（整条在画面之上），
   亮痕 1.9~2.4 一样在画外 —— "冻结帧可见↔隐藏"的像素差是 **0**，
   也就是"空中电闪 / 亮光划过"这两个效果**从头到尾一个像素都没画出来**（探针
   outputs/_diag/thunder-bolt-vis.mjs 定案）。按画面坐标摆 ⇒ 相机怎么俯仰都在天上。
   落在天球内的做法：从相机沿该方向走，取与半径 r 天球的**远交点**（相机在球内）。 */
function skyAt(ndcx, ndcy, r){
  const dir = _lnNd.set(ndcx, ndcy, 0.5).unproject(camera).sub(camera.position).normalize();
  const o = camera.position;
  const b = o.dot(dir), c = o.lengthSq() - r * r;
  const disc = b * b - c;
  const t = disc > 0 ? (-b + Math.sqrt(disc)) : r;
  return new THREE.Vector3().copy(o).addScaledVector(dir, Math.max(1, t));
}
/* 折线 → 面向相机的宽带 ribbon（宽 2 边各一顶点，段间出两三角） */
function boltRibbon(pts, widthDir, w0, w1, pos, idx){
  const n = pts.length, base = pos.length / 3;
  for (let i = 0; i < n; i++){
    const t = i / Math.max(1, n - 1);
    const w = (w0 + (w1 - w0) * t) * 0.5;
    const p = pts[i];
    pos.push(p.x + widthDir.x * w, p.y + widthDir.y * w, p.z + widthDir.z * w,
             p.x - widthDir.x * w, p.y - widthDir.y * w, p.z - widthDir.z * w);
    if (i > 0){ const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2,  a + 1, a + 3, a + 2); }
  }
}
function buildLightning(){
  const g = new THREE.Group();
  g.visible = false;
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xE8F0FF, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
  bolt.frustumCulled = false; bolt.renderOrder = 7;
  const streakMat = new THREE.MeshBasicMaterial({ color: 0xD8E4FF, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(170, 6), streakMat);
  streak.frustumCulled = false; streak.renderOrder = 7;
  g.add(bolt, streak);
  scene.add(g);
  LIGHTNING._group = g; LIGHTNING._bolt = bolt; LIGHTNING._boltMat = boltMat;
  LIGHTNING._streak = streak; LIGHTNING._streakMat = streakMat;
}
/* 闪光包络：一串"起得快、落得稍慢"的脉冲（真实闪电的多闪节奏）。
   ⚠️ **pulses 必须容 null**（2026-10-02 夜间全量链抓到的真缺陷）：
      `LIGHTNING.next = 4.0`（第一次打击在仿真第 4 秒），而 `lnApply(tNow - L.t0)`
      在那之前就会跑 —— 那时 `_pulses` 还是 null ⇒ `for (const p of null)` 必炸
      TypeError。shadow-cover / ripple-bounds 两道门在暴雨臂里各抓到 ×2。
      返回 0 = "还没有闪电就没有照亮"，与"先闪电后照亮"的硬约束自洽。 */
function lnFlashAt(pulses, tau){
  if (!pulses) return 0;
  let v = 0;
  for (const p of pulses){
    if (tau < p.t) break;
    const d = tau - p.t;
    if (d < p.up) v = Math.max(v, p.v * (d / p.up));
    else if (d < p.up + p.down) v = Math.max(v, p.v * (1 - (d - p.up) / p.down));
  }
  return Math.min(1, v);
}
function lnStrike(tNow){
  const L = LIGHTNING;
  if (!L._group) buildLightning();
  camera.updateMatrixWorld();
  /* ── 主干：在**画面空间**里画之字（见 skyAt 的注释：默认机位的可见天空只有约 4° 高）──
     起点放在画面上缘**之外**（byTop > 1）⇒ 读起来是"从云里劈进来"；
     终点落到地平线之下，那截会被园子/远山的深度挡掉，只留天空里那一段可见。 */
  const bx0 = lnR(-0.34, 0.34);
  const byTop = lnR(1.10, 1.26);
  const byBot = lnR(0.50, 0.66);
  const driftX = lnR(-0.34, 0.34);
  const nx = [], ny = [];
  for (let i = 0; i < 11; i++){
    const t = i / 10;
    nx.push(bx0 + driftX * t + lnR(-0.032, 0.032));
    ny.push(byTop + (byBot - byTop) * t + lnR(-0.016, 0.016));
  }
  const mid = skyAt((nx[0] + nx[10]) * 0.5, (ny[0] + ny[10]) * 0.5, LN_R);
  const facing = mid.clone().normalize();
  const widthDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing).normalize();
  /* 主干 + 2~4 条分叉，全部塞进同一个几何（一次 draw call） */
  const trunk = [];
  for (let i = 0; i < 11; i++) trunk.push(skyAt(nx[i], ny[i], LN_R));
  const pos = [], idx = [];
  /* 线宽：4.8m @ 388m ≈ 0.0124 rad，在 46° 垂直视角下约 9 像素 —— 要"夸张点"
     就得先看得见；旧值 2.8m 只有 5 像素，且整条在画外（等于没画）。 */
  boltRibbon(trunk, widthDir, 4.8, 1.6, pos, idx);
  const nBr = 2 + ((LN_RNG() * 3) | 0);
  for (let b = 0; b < nBr; b++){
    const i0 = 2 + ((LN_RNG() * 6) | 0);
    const dirA = LN_RNG() < 0.5 ? -1 : 1;
    const pts = [trunk[i0].clone()];
    let bxp = nx[i0], byp = ny[i0];
    const len = 3 + ((LN_RNG() * 4) | 0);
    for (let k = 0; k < len; k++){
      bxp += dirA * lnR(0.020, 0.062);
      byp += lnR(-0.034, 0.022);
      pts.push(skyAt(bxp, byp, LN_R));
    }
    boltRibbon(pts, widthDir, 2.6, 0.6, pos, idx);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  L._bolt.geometry.dispose();
  L._bolt.geometry = geo;
  /* 亮痕（亮光划过）：两端也按画面坐标定，然后**冻结在世界里** ——
     横扫不做"跟着镜头跑"（那会读成贴在屏幕上的假东西），改成
     "长度从 0 擦到全长"（见 tickLightning），所以端点与朝向只需在这里算一次。 */
  {
    /* 两端都要落在**画面内**（x 别超出 ±1）：横扫是"从 A 端擦出去"，
       若 A 在画外，最亮的那一段（sT 小、不透明度高）正好在画外 ⇒ 亮痕等于没画。
       实测第一版 A 取 -1.30~-0.95，投影回来 x = -1.25~-1.1 全在画左之外，贡献 0。 */
    const sy = lnR(0.66, 0.90);
    const A = skyAt(lnR(-0.92, -0.55), sy + lnR(-0.05, 0.05), LN_R * 0.97);
    const B = skyAt(lnR(0.55, 0.92), sy + lnR(-0.05, 0.05), LN_R * 0.97);
    const xAx = B.clone().sub(A);
    L._streakLen = xAx.length();
    xAx.normalize();
    const zAx = A.clone().normalize();                          // 朝外（背向圆心 ≈ 背向相机）
    const yAx = new THREE.Vector3().crossVectors(zAx, xAx).normalize();
    const zAx2 = new THREE.Vector3().crossVectors(xAx, yAx).normalize();
    L._streakA = A; L._streakB = B;
    L._streakQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, yAx, zAx2));
  }
  /* 脉冲序列：2~4 闪 */
  const pulses = [];
  let tt = 0;
  const nP = 2 + ((LN_RNG() * 3) | 0);
  for (let i = 0; i < nP; i++){
    /* ⚠️ 起跳 0.028s（不是 0.012）：60fps 一帧 16.7ms，太陡的起跳**采样不到峰值**
       （探针实测峰值只被采到 0.76）；0.028 让每个脉冲都至少有一帧落在顶上。 */
    pulses.push({ t: tt, v: i === 0 ? 1 : lnR(0.32, 0.85), up: 0.028, down: i === 0 ? 0.11 : 0.15 });
    tt += (i === 0 ? 0.10 : lnR(0.15, 0.25));
  }
  pulses.push({ t: tt + 0.3, v: 0, up: 0.01, down: 0.01 });
  L._pulses = pulses;
  L._boltT = tNow;
  L._group.visible = true;
  L._streak.visible = true;
  /* 雷鸣：闪电在前、雷声在后 —— 延迟按"距离"给，1~3 层叠放 = 密集雷鸣 */
  const delay = lnR(0.9, 3.6);
  const ev = { delay: +delay.toFixed(2),
               layers: 1 + ((LN_RNG() * 2) | 0) + (delay > 2.2 ? 1 : 0),
               gain: +Math.max(0.18, 0.62 * (1 - delay / 6)).toFixed(3),
               lp: Math.round(Math.max(420, 2200 - delay * 420)),
               rate: +lnR(0.92, 1.05).toFixed(3), at: tNow };
  L.lastThunder = ev;
  HOOKS.thunder?.(ev);
}
/* ⚡ 哪些天气会打闪电（2026-09-30 老黄："狂风暴雨和电闪雷鸣合并，空出一格"）——
   合并后**暴雨默认带闪电**：大雨 + 狂风 + 雷电本来就是同一场天气。
   ⚠️ 用 Set 而不是散落的字符串比较：以后再加"带闪电的天气"只改这一处。
   ⚠️ 不要在这里判"雨量"——雨后初晴的 rainAmount=0，但绝不能因此放晴天的虹进来。 */
const LN_ALLOWED = new Set(['storm', 'thunder']);
/* 每帧推进（animate 的 ENV 过渡块之后调用） */
export function tickLightning(dt, tNow){
  const L = LIGHTNING;
  if (!LN_ALLOWED.has(ENV.weather) || !L.on){
    if (L.flash > 0 || (L._group && L._group.visible)){
      L.flash = 0;
      if (L._group){ L._group.visible = false; L._boltMat.opacity = 0; L._streakMat.opacity = 0; }
      skyMesh.material.uniforms.uFlash.value = 0;
      /* 写回基准（零残留） */
      sun.intensity = ENV.cur.sunIntensity; amb.intensity = ENV.cur.ambIntensity;
      hemiLight.intensity = ENV.cur.hemiIntensity;
      renderer.toneMappingExposure = ENV.cur.exposure;
    }
    return;
  }
  /* 定格模式（见 LIGHTNING.hold 的注释）：按指定 tau 重放包络，不排新事件、不动 t0 */
  if (L.hold !== null){ lnApply(L.hold); return; }
  if (tNow >= L.next || !L._pulses){
    /* ⚠️ `!L._pulses` 也触发首击（2026-10-02）：进入暴雨/雷雨后第一帧就打雷，
       而不是让用户等 4 个仿真秒看"只有乌云没有闪电"—— 同时把 null 包络这条路堵死。 */
    lnStrike(tNow);
    L.strikes++;
    L.t0 = tNow;
    L.next = tNow + (LN_RNG() < 0.26 ? lnR(0.55, 1.5) : lnR(4.5, 11));   // 约 1/4 概率连击
  }
  lnApply(tNow - L.t0);
}
/* 把"某一次事件在 tau 秒时刻的样子"写到网格 / 天空 / 光照上。
   抽出来是为了给"定格"复用（探针要可复现的峰值帧，截图要拍到闪电）。 */
function lnApply(tau){
  const L = LIGHTNING;
  /* ⚠️ 闪电几何是**首击时懒建**的（lnStrike → buildLightning）—— 在那之前
     _bolt/_streak 都是 null。上面的 lnFlashAt 空值兜底让执行走到这里，
     不挡一下就会换成 "Cannot read properties of null (reading 'visible')"。
     此时本来就还没有闪电 ⇒ 闪光归零、直接返回。 */
  if (!L._group){ L.flash = 0; return; }
  const fRaw = lnFlashAt(L._pulses, tau);
  /* ⚠️ "先闪电、后照亮"是**硬约束**（老黄原话："一定是闪电后才有照亮场景的效果"）：
     把照亮**铆在闪电网格的可见期上** —— 网格不可见的帧一律不许有闪光量。
     这样"只有提亮没有闪电"在构造上就不可能发生（探针实测修前有 3 帧只提亮）。 */
  const boltOn = tau >= 0 && tau < 1.2 && fRaw > 0.02;
  const f = boltOn ? fRaw : 0;
  L.flash = f;
  /* ① 闪电网格 */
  L._bolt.visible = boltOn;
  L._boltMat.opacity = boltOn ? Math.min(1, 0.35 + fRaw * 1.15) : 0;
  /* ② 亮痕横扫（0.3s）—— "长度从 0 擦到全长"，端点/朝向在 lnStrike 时按画面坐标定好、
     冻结在世界里（跟着镜头跑的"亮痕"会读成贴在屏幕上的假东西）。 */
  const sT = tau / 0.3;
  const streakOn = tau >= 0 && sT < 1 && !!L._streakA;
  L._streak.visible = streakOn;
  if (streakOn){
    const s = Math.max(0.001, Math.min(1, sT));
    const A = L._streakA, B = L._streakB;
    L._streak.position.set(A.x + (B.x - A.x) * s * 0.5,
                           A.y + (B.y - A.y) * s * 0.5,
                           A.z + (B.z - A.z) * s * 0.5);
    L._streak.quaternion.copy(L._streakQ);
    L._streak.scale.set(Math.max(0.001, (L._streakLen * s) / 170), 1, 1);   // 几何宽 170
    L._streakMat.opacity = 0.85 * (1 - sT);
  } else L._streakMat.opacity = 0;
  /* ③ 天幕/云层泛白（空中电闪） */
  skyMesh.material.uniforms.uFlash.value = f;
  /* ④ 照亮整体：乘系数（基准取 ENV.cur，零残留） */
  sun.intensity = ENV.cur.sunIntensity * (1 + f * 12);
  amb.intensity = ENV.cur.ambIntensity * (1 + f * 6);
  hemiLight.intensity = ENV.cur.hemiIntensity * (1 + f * 5);
  renderer.toneMappingExposure = ENV.cur.exposure * (1 + f * 0.5);
}
/* 探针用：下一次 tick 立刻打一条闪电 */
export function lightningStrikeNow(){ LIGHTNING.next = -1e9; }

export function initEnvScene(){
  makeLanterns();
  makeFestivalLights();               // 河灯/烛焰/灯串（须在 collectSeasonCaches 前；桃树挂灯由延迟批后置显隐）
  collectSeasonCaches();             // 同步建的物件（紫藤叶/苇/荷盘…）不能等延迟批
  syncEnvUI();
  applyEnv(ENV.cur);
  installSnow(SNOW_COVER_MATS);      // 必须在**首帧渲染之前**装上：注入才进得了编译好的程序
  /* 挂上补装器：此后任何**晚注册**的雪材质（deferBoot 的立峰·云根就比这里晚）会立刻被装雪，
     不必再赌"它的注册是否早于装配收尾"—— 赌输不报错、不崩、状态全对，只是那块东西冬天
     不积雪（2026-09-20 实测竹竿与题名石刻都栽在这里）。installSnow 自带守卫 → 幂等。 */
  SNOW_HOOK.install = (m) => installSnow([m]);
}

/* 薄叶面（竹叶、芭蕉叶）法线接近水平，如果按"朝上程度"判积雪，它们永远挂不住雪 ——
   而"雪压竹叶"恰恰是冬景里最该有的一笔。给这些材质一个逐材质加成：
   upness 的下限放宽到"只要不是明显朝下就算"，其余材质仍走原来的严格判据。 */
/* ⚠️ 竹叶用的是 **MAT.leaf**，这份加成原来只写给了竹竿/芭蕉/水草 ——
   于是"雪压竹叶"从来没生效过（叶材质既不在雪表里、也没有 boost）。 */
const SNOW_BOOST = new Map([[MAT.bambooA, 0.85], [MAT.bambooB, 0.85], [MAT.banana, 0.60],
                            [MAT.leaf, 0.70], [MAT.leafDeep, 0.55],
                            [MAT.willowLeaf, 0.55],
                            [MAT.reed, 0.45], [MAT.lily, 0.35], [MAT.lotus, 0.35],
                            [MAT.bark, 0.25], [MAT.trunk, 0.25]]);
for (const [mat, boost] of SNOW_BOOST){
  mat.userData.snowBoost = { value: boost };
}

/* ══ 天气表现 · 二 · 雨 / 雪 ══
   一套 GPU Points，两种精灵（雨=细长划痕，雪=柔和团），雨雪共用同一张图集与同一个着色器。
   粒子在 CPU 上逐帧推进：这比在着色器里按 uTime 反推落点更贵一点，但换来两件事 ——
   ① 风可以直接改速度（横着下的雨 / 斜飞的雪），② 起停、切档、换风向都不需要重建缓冲。
   位置是世界坐标，绕相机回收，所以"雨永远在看得见的地方"，也不会越飘越远。
   代价写在明处：约 1.4 万点 / 帧的 CPU 更新，只按档位调点数。 */
export const PRECIP = (()=>{
  /* 雨/雪的精灵**完全在着色器里画**，不用贴图。
     先试过 canvas 图集，但那条路的 alpha 混合在这个管线上不生效：
     实测「取纹理 rgb」改动 15433 个像素，而「取纹理 a」只改动 14 个 —— 图集本身没问题
     （第 31 列雨条 alpha=249），说明是取 a 这条通路出了岔子。
     与其去追一个和纹理预乘/色彩空间有关的坑，不如按 gl_PointCoord 直接算形状：
     更稳、更省一张纹理，而且形状参数是活的（雨条长宽、雪花边缘都能单独调）。 */
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.NormalBlending, side: THREE.DoubleSide,
    uniforms: { uSize:{ value: 15.0 }, uIntensity:{ value: 0.0 }, uStreak:{ value: 0.0 } },
    vertexShader: `attribute float aKind;
      attribute float aVariation;
      attribute float aSpeed;
      uniform float uSize;
      uniform float uIntensity;
      varying float vKind;
      varying float vAlpha;
      varying float vSeed;
      void main(){
        vKind = aKind;
        vSeed = fract(aVariation * 13.7 + aSpeed * 7.3);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 雨：天空里任何距离上都读得出来，所以给固定像素高（水平仍按透视收窄）
        // 雪：真的近大远小；aVariation 让每片雪花大小不一 ——
        //     大小一律相等时，雪在屏幕上会读成一层均匀的网点帘子，而不是雪
        float dist = max(-mv.z, 1.0);
        /* 近距淡出：粒子体积一直罩着相机，雪片会飞到镜头前 1~2m ——
           旧版无钳制，5m 处一片雪 = 30×(26/5)×1.4 ≈ 218px 的软白盘，
           满屏"幽灵泡泡"（2026-09-21 走查 F2）。2.5m 内整体淡没，
           雨丝同理（2m 内淡出，避免一条大白杠糊脸）。 */
        float nearFade = (aKind < 0.5) ? smoothstep(1.6, 4.0, dist)
                                       : smoothstep(2.6, 7.0, dist);
        vAlpha = uIntensity * nearFade;
        float rainLen = max(uSize, uSize * 26.0 / dist);
        /* 雪片尺寸：透视缩小 + 个体差异，再硬钳 20px —— 近景是"小绒片"，
           不是虚焦泡泡；远景不低于 2.5px，保持可读数。 */
        float snowPx = clamp(uSize * (26.0 / dist) * aVariation, 2.0, 15.0);
        gl_PointSize = (aKind < 0.5) ? min(rainLen, 64.0) : snowPx;
      }`,
    fragmentShader: `varying float vKind;
      varying float vAlpha;
      varying float vSeed;
      uniform float uStreak;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float a;
        if (vKind < 0.5){
          // 雨：一条竖划痕 —— 横向高斯收细，纵向淡入淡出
          float y = clamp(gl_PointCoord.y, 0.0, 1.0);
          float edge = smoothstep(0.0, 0.14, y) * smoothstep(1.0, 0.82, y);
          a = exp(-d.x * d.x * 46.0) * edge;
        } else {
          /* 雪：小绒片；**风大时横向拉成流线**。
             静雪与暴风雪如果都是一颗颗圆点，画面里两者就只剩"亮度差"，
             用户一眼分不出来（"冬季的狂风暴雨为啥还是银装素裹"）。
             风越大 → uStreak 越大 → 雪花沿风向被拉长，"风雪"才读得出风。
             边缘收到 0.22（旧 0.05 是整 sprite 都半透 → bloom 糊成白饼）。 */
          vec2 ds = vec2(d.x / (1.0 + uStreak * 2.4), d.y);
          float r = length(ds);
          /* 软绒团（F2 二轮）：旧版 body+core 是个亮度均匀的圆盘，雪片读成
             "白色泡泡"。改成单片高斯衰减，中心柔亮、边缘化进雾里；
             再叠一道很弱的六瓣角调制（±8%），近看是雪晶不是印刷网点。 */
          float ang = atan(ds.y, ds.x) + vSeed * 6.2831;
          float lobe = 1.0 + 0.08 * cos(ang * 6.0 + vSeed * 12.0);
          a = exp(-r * r * 15.0) * lobe;
          a *= smoothstep(0.50, 0.30, r);          /* 最外圈再收一档，没有硬圆边 */
        }
        a *= vAlpha;
        if (a < 0.004) discard;
        /* 雪不再是纯白（1.0 在加法感的亮雾里被 bloom 二次糊开），冷白 0.90 档 */
        vec3 col = mix(vec3(0.80, 0.85, 0.92), vec3(0.90, 0.93, 0.98), step(0.5, vKind));
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mk = (n, kind, size, strength, useMat) => {
    const geo = new THREE.BufferGeometry();
    const a = new Float32Array(n * 3), k = new Float32Array(n);
    const vr = new Float32Array(n), sp = new Float32Array(n);
    for (let i = 0; i < n; i++){
      k[i] = kind;
      vr[i] = 0.55 + Math.random() * 0.60;        // 尺寸倍率（原 0.42~1.40：上限太大，近片必成饼）
      sp[i] = 0.55 + Math.random() * 0.95;        // 下落速度倍率（见 updatePrecip 的说明）
    }
    geo.setAttribute('position',   new THREE.BufferAttribute(a, 3));
    geo.setAttribute('aKind',      new THREE.BufferAttribute(k, 1));
    geo.setAttribute('aVariation', new THREE.BufferAttribute(vr, 1));
    geo.setAttribute('aSpeed',     new THREE.BufferAttribute(sp, 1));
    const p = new THREE.Points(geo, useMat);
    p.frustumCulled = false; p.visible = false; p.renderOrder = 20;
    /* spread 是体积半径。第一版给 20~23，在视高机位上等于把自己塞进一团浓雾里 ——
       雨雪在屏幕上的覆盖率一度到 44%，画面被糊住。放大到 ±34/±30 之后
       同样多的粒子摊在更大体积里，"密度"才落回天气该有的量级。 */
    return { points: p, arr: a, n, spread: kind < 0.5 ? 34 : 30, size, strength, seeded: false };
  };
  // 单颗的量级刻意压得很低：厚度靠数量堆，不靠单颗不透明度（否则近处几颗就糊住画面）
  /* ⚠️ 雨雪**必须各有一份 uniform**。原来是同一个材质实例，而 updatePrecip 是逐个 S
     先写雨、再写雪地设 uSize/uIntensity —— 两者同时可见的过渡帧里，后写的雪会把雨的
     uSize 覆盖成 30（雨本该是 9），雨被画成一颗颗大雪球。
     ShaderMaterial.clone() 会克隆 uniforms：材质实例分开、着色器源码仍共用。 */
  const snowMat = mat.clone();
  const rain = mk(ACTIVE_QUALITY.rain, 0.0,  9.0, 0.115, mat);
  // 雪刻意比雨少：雨可以铺满画面，雪片一大就糊住视线
  // uSize 30→22→18：单片基础尺寸继续收（shader 内钳 15px）；强度 0.150：厚雪靠密度不靠单片不透明度
  const snow = mk(ACTIVE_QUALITY.snow,   1.0, 18.0, 0.150, snowMat);
  return { mat, snowMat, rain, snow, list: [rain, snow] };
})();
scene.add(PRECIP.rain.points, PRECIP.snow.points);
/* 粒子体积**跟着相机平移**，而不是靠"越界就折返"来回收。
   折返有个致命缺口：用 setCamera 瞬移机位（采集脚本每次都这么干）之后，
   整团粒子还在旧位置，近处会是一片"没有雨也没有雪"的空白 —— 实测 eye 与 low 两个机位
   视野内点数是 0。改成把相机位移整体加到粒子上，体积永远罩住相机。 */
let _prevCamX = null, _prevCamZ = null;
/* ── 室内禁区（2026-09-19 老黄截图：雪下进了远香堂屋里）──
   雨雪是全园一个盒子里绕相机回收的点，**不认识屋顶** —— 落在建筑轮廓内的粒子会
   直接穿屋面进室内，从敞开的门窗看就是"屋里下雪"。
   修法不在碰撞（每粒子对屋面做射线太贵），而是**禁区即死**：粒子一进禁区体积，
   立即按"落到顶"重生到别处 —— 室内永远不存在粒子。
   坐标来自 makeYuanxiangHall：W=20/D=8 @ (0,0,-12.8)。
   ⚠️ 水榭/游廊**故意不列**：榭与廊本就是开敞的，纳风迎雪是它们的天职 ——
   "荷风四面"若四面都不透风，那才假。
   ⚠️⚠️ **yTop 必须到"堂内天花标高"，不是随手取的一个数**（2026-10-01 老黄二次报
   "室内怎么也会有雪"，根因就在这里）：
     旧值 **5.0**，而堂内天花在 `1.24 + colH + 0.44`，`colH = H − 2.35`（04-buildings，
     H=7）⇒ **6.33**。房间净高 1.24~6.33，上半截 **5.0~6.33（占层高 26%）的雪没被杀掉**
     ⇒ 实测雪天"堂内、天花以下"仍剩 6 个粒子且**全在相机视锥内**，从敞开的门窗往里看
     就是"屋里下雪"。
     天花以上（>6.33）是屋顶空腔、被望板挡住，一并杀掉无害；再往上（>yTop）不动 ——
     那不是偷懒：剃到太高会把**屋顶上方**的雪也一起回收，从远处看屋顶那一块就成了
     "雪洞"。所以 yTop 取天花标高 + 一点点余量即可。
   ⚠️ 改这里只影响"哪些粒子会被回收"，**不消耗任何随机数**（铁律 1 安全）。 */
const PRECIP_INDOOR = [
  /* 远香堂室内。XZ 覆盖整个建筑外廓（W20/D8 @ z=-12.8）只留 4cm 内缩 ——
     这 4cm 落在**墙体厚度里**（墙厚 0.3），粒子死在墙体内部、被墙挡住，看不出来；
     留一点内缩是为了避免正好卡在边界上的粒子反复"进-出"抖动。
     （旧值是内缩 0.4m，那会让房间前沿 0.4m 一圈成为漏网区。） */
  { x0: -9.96, x1: 9.96, z0: -16.76, z1: -8.84, yTop: 6.4 },
];
export function updatePrecip(dt, t){
  const p = ENV.cur;
  const rainOn = (p.rainAmount || 0) > 0.01;
  const snowOn = (p.snowAmount || 0) > 0.01;
  PRECIP.rain.points.visible = rainOn;
  PRECIP.snow.points.visible = snowOn;
  if (!rainOn && !snowOn) return;
  const cam = camera.position;
  const dcx = _prevCamX === null ? 0 : cam.x - _prevCamX;
  const dcz = _prevCamZ === null ? 0 : cam.z - _prevCamZ;
  _prevCamX = cam.x; _prevCamZ = cam.z;
  const wx = Math.sin(t * 0.11) * 0.6 + Math.sin(t * 0.043) * 0.4;
  for (const S of PRECIP.list){
    const on = S === PRECIP.rain ? rainOn : snowOn;
    if (!on) continue;
    const amt = S === PRECIP.rain ? p.rainAmount : p.snowAmount;
    const uu = S.points.material.uniforms;     // 雨/雪各写自己那份（见 PRECIP 内的说明）
    uu.uIntensity.value = S.strength * Math.min(1, 0.35 + amt * 0.85);
    uu.uSize.value = S.size;
    uu.uStreak.value = (S === PRECIP.rain) ? 0
      : Math.max(0, Math.min(1, ((p.windMul || 1) - 1.5) / 2.2));
    const a = S.arr, n = S.n, X = S.spread, YT = 22, YB = -1.2, DH = YT - YB;
    /* 只推进**实际提交渲染**的那部分粒子。原来不管强度多小都遍历整个数组
       （独显档 1.4 万点/帧），小雨/小雪时 95% 的运算是白做的 —— drawRange 之外的粒子
       本来就不提交。降到小雪时 CPU 的粒子开销随之下降。 */
    const active = Math.max(32, Math.round(n * Math.min(1, amt)));
    if (!S.seeded){                       // 首帧铺满体积，否则会看到"从天上掉下来"
      S.seeded = true;
      for (let i = 0; i < n; i++){
        a[i*3]   = cam.x + (Math.random() * 2 - 1) * X;
        a[i*3+1] = YB + Math.random() * DH;
        a[i*3+2] = cam.z + (Math.random() * 2 - 1) * X;
      }
    }
    const isRain = S === PRECIP.rain;
    /* 下落速度必须**逐粒子**给。
       原来 vy 是整个数组共用的一个常量，2400 片雪同速下降 → 初始化时均匀铺开的那层间距
       永远保持，整层像一张网一起往下挪，落到底同批一起回顶，循环加深成"一层一层掉"。
       x/z 一直有逐粒子扰动，唯独下落速度没有，这才是分层的根因。
       给每片雪 0.55~1.50 的速度倍率：快慢互相追越，任何整齐的层都会在几帧内散掉。 */
    const vy = isRain ? -(16 + amt * 8) : -(10 + amt * 6);
    const sp = S.points.geometry.attributes.aSpeed;
    const spArr = sp.array;
    const drift = p.windMul * (isRain ? 1.6 : 3.4);
    for (let i = 0; i < active; i++){
      const j = i * 3;
      // 雨不做那层"雪花飘摆"（原来是对雨恒乘 0 的表达式，白算）
      a[j]   += dcx + wx * drift * dt + (isRain ? 0.0 : Math.sin(t * 1.6 + i * 0.37) * 0.9 * dt);
      a[j+1] += vy * spArr[i] * dt;
      a[j+2] += dcz + Math.sin(t * 1.1 + i * 0.21) * drift * 0.5 * dt;
      // 落到底就回到顶；横向越界折返，保证体积始终罩住相机
      if (a[j+1] < YB){ a[j+1] = YT; a[j] = cam.x + (Math.random() * 2 - 1) * X; a[j+2] = cam.z + (Math.random() * 2 - 1) * X; }
      else if (a[j] - cam.x >  X) a[j] -= 2 * X;
      else if (cam.x - a[j] >  X) a[j] += 2 * X;
      if (a[j+2] - cam.z >  X) a[j+2] -= 2 * X;
      else if (cam.z - a[j+2] >  X) a[j+2] += 2 * X;
      /* 室内禁区即死（见 PRECIP_INDOOR）：一进屋就按"落回顶部"重生到体积里别处，
         每粒子只是一条比较链，1.4 万点/帧的开销量级不变。 */
      for (const B of PRECIP_INDOOR){
        if (a[j+1] < B.yTop && a[j] > B.x0 && a[j] < B.x1 && a[j+2] > B.z0 && a[j+2] < B.z1){
          a[j+1] = YT; a[j] = cam.x + (Math.random() * 2 - 1) * X; a[j+2] = cam.z + (Math.random() * 2 - 1) * X;
          break;
        }
      }
    }
    S.points.geometry.attributes.position.needsUpdate = true;
    S.points.geometry.setDrawRange(0, active);
  }
}

/* ══ 雨后痕迹（2026-10-01 · 老黄："雨后初晴不是应该地面和周边环境还有雨水的痕迹么，
      或者屋檐还在继续滴水，否则怎么判断是雨后初晴"）══════════════════════════════
   在这之前，"雨后初晴"只有 wetness 一项（材质变光），既没有继续滴的水、也没有地上的水洼 ——
   所以光看画面确实读不出"刚下过雨"。
   两个部件，都只在 **wetness 高 + 雨已停** 时出现（雨还在下时由雨粒子负责，别叠加）：
     ① 屋檐滴水：沿三栋建筑的**檐口线**布 170 颗水珠，自由落体 → 落地 → 随机停顿 → 重生。
     ② 积水：铺地/地面上若干片不规则浅水洼（反光水膜），透明度随 wetness。
   ⚠️ 都用**运行期 Math.random**（不是布局流）：屋檐滴水是"每次不同"的效果，
      与本项目"运行期效果走 Math.random"的既定分工一致，**不吃全局布局流**（铁律 1）。
   ⚠️ 檐口线是**手写常量**（照 04-buildings 的屋顶参数算的），改屋顶尺寸要同步改这里 ——
      之所以不遍历场景去找屋檐：这里没有"檐口面"这种可直接识别的几何。 */

/* ① 檐口线（世界坐标折线）+ 檐高 + 落点高度 */
const EAVE_LINES = (() => {
  const out = [];
  const rect = (cx, cz, hx, hz, y, gy) => {
    const p = [[cx-hx, cz-hz], [cx+hx, cz-hz], [cx+hx, cz+hz], [cx-hx, cz+hz]];
    for (let i = 0; i < 4; i++){
      const a = p[i], b = p[(i+1) % 4];
      out.push({ x0: a[0], z0: a[1], x1: b[0], z1: b[1], y, gy });
    }
  };
  /* 远香堂：屋顶外沿 w=W+4.6=24.6 / d=D+4.6=12.6 @ (0,·,−12.8)；檐口高 = roof.position.y
     = 1.24 + colH + 0.5（colH = H−2.35 = 4.65）⇒ 6.39；落点 = 台基面 1.24。 */
  rect(0, -12.8, 12.3, 6.3, 6.39, 1.24);
  /* 水榭（荷风四面亭）：屋顶 w=W+3.2=11.2 / d=D+3.2=10.2；08 里 position (14.2,0,6.4)
     且 rotation.y = π/2 ⇒ 长宽在世界里**互换**（世界 x 半宽 = 10.2/2，z 半宽 = 11.2/2）；
     檐口高 = 0.55 + colH + 0.42（colH = 3.5）⇒ 4.47；落点 = 榭台面 0.55。 */
  rect(14.2, 6.4, 5.1, 5.6, 4.47, 0.55);
  /* 游廊：沿中线两侧各偏 1.76（= width*0.28 + 0.92，见 04-buildings 的 corridorFascia），
     檐口高 = colH + 0.44（colH = 2.9）⇒ 3.34。中线点抄自 08-assemble 的 makeCorridor 调用。 */
  const CP = [[10.6, -9.6], [13.2, -9.6], [13.2, -1.8], [24.0, -1.8], [24.0, 15.0]];
  for (let i = 0; i < CP.length - 1; i++){
    const dx = CP[i+1][0] - CP[i][0], dz = CP[i+1][1] - CP[i][1];
    const L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
    for (const s of [-1, 1]){
      out.push({ x0: CP[i][0] + nx * 1.76 * s, z0: CP[i][1] + nz * 1.76 * s,
                 x1: CP[i+1][0] + nx * 1.76 * s, z1: CP[i+1][1] + nz * 1.76 * s, y: 3.34, gy: 0.02 });
    }
  }
  let acc = 0;
  for (const s of out){ s.len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0); s.t0 = acc; acc += s.len; }
  return { segs: out, total: acc };
})();

const EAVE_DRIP = (() => {
  /* ⚠️ 尺寸/密度按"看得见"定，不是按物理：真实水珠 4~6mm，在这个视距下不到 1 像素。
     实测第一版（半径 0.021、停顿 0.25~2.6s）三个机位分别只贡献 65/220/96 像素 ——
     等于白做。现在加大到 0.030、缩短停顿（同时在落的比例更高）、数量 170→220。 */
  const N = 320;
  const geo = new THREE.SphereGeometry(0.046, 6, 5);
  const mat = new THREE.MeshBasicMaterial({ color: 0xE4EEF6, transparent: true, opacity: 0,
                                            depthWrite: false, fog: false });
  const im = new THREE.InstancedMesh(geo, mat, N);
  im.frustumCulled = false; im.visible = false; im.renderOrder = 18;
  scene.add(im);
  const drops = [];
  for (let i = 0; i < N; i++) drops.push({ s: 0, f: 0, y: 0, vy: 0, wait: Math.random() * 1.6, live: false });
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
  return { im, mat, drops, N, m, p, q, sv };
})();

/* ② 积水：铺地/地面上的不规则浅水洼。
   ⚠️ 2026-10-01 三轮实测后的定案形状（每一轮都是被实测/多模态当场否掉的）：
      · 第一版**手挑 10 个点**、高度取 `groundHeight+0.015` ⇒ 埋进铺地下面（铺地是浮在
        地形之上的独立网格），实测"开↔关"两张图**逐像素为 0** —— 完全看不见、也不报错。
        ⇒ 改成运行时**射线量真实表面**。
      · 第二版射线只取"第一个非实例网格" ⇒ 落点上方有墙/屋面时会把水洼**贴到墙上**
        （材质 metalness 高、反天空 ⇒ 发白），多模态一眼看出"右侧白墙上有一块不自然的白斑"。
        ⇒ 加两条：**只接受近似竖直朝上的面（世界法线 n.y > 0.8）且落点低（y < 2.6）**。
      · 第三版手挑点太少（10 片、默认机位只贡献 1607px＝0.27%）⇒ 多模态仍判"地面没湿痕"。
        ⇒ 改成**抖动网格自动铺**（候选约 80 个，池内的丢掉），并且**合成一个 InstancedMesh**
          （1 个 draw call；每片用自己的 scale 出椭圆、自己的 rotation 出朝向）。
   抖动用 Math.random —— 运行期效果，不吃布局流（铁律 1）。 */
const PUDDLES = (() => {
  /* ⚠️⚠️ **候选点的抖动必须走自己的种子流，绝不能用 Math.random**（2026-10-02，铁律 1 的
     直接翻车案例）：本模块体在**装配期**跑，而 Math.random 同时被时序类代码（对象 UUID、
     涟漪、音景）按帧消费 ⇒ "候选怎么抖"随加载时序变 ⇒ **实例网格的 count 都会漂**
     —— 81 ←→ 78 片来回跳，layout-fingerprint 修好之后立刻被抓出来（连跑两次不一致）。
     与 06/08 的既定规矩一致：布局/装配类走局部 mulberry32；运行期"每次不同"的效果
     （每颗水珠落在檐口线哪个点）才用 Math.random。 */
  const jr = mulberry32(20261002);
  const CAND = [];
  for (let x = -19; x <= 19.01; x += 2.7)
    for (let z = -7.6; z <= 16.61; z += 2.7){
      const jx = x + (jr() - 0.5) * 1.8, jz = z + (jr() - 0.5) * 1.8;
      /* ⚠️ insidePond 吃**池局部坐标**（池心世界 (0,+3)）⇒ y 传 z−3 */
      if (insidePond(jx, jz - 3)) continue;
      CAND.push([jx, jz]);
    }
  /* 一片不规则水膜的基几何（一圈带噪声的半径；实例再压扁成椭圆） */
  const n = 16, pts = [];
  for (let i = 0; i < n; i++){
    const a = i / n * TAU, r = 0.72 + 0.28 * Math.abs(Math.sin(i * 2.7 + 1.3));
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const g2 = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g2.rotateX(-Math.PI / 2);
  /* ⚠️⚠️ **必须自己写 UV**：ShapeGeometry 的 uv 直接取形状的 xy 坐标（不是 0~1 归一化），
     拿它当 alphaMap 的采样坐标会整片错位（全部 clamp 到边缘 ⇒ 没有柔和边缘）。
     按"形状半径≈1"把 x/z 归一化到 0~1 ⇒ 每片实例（等比缩放）都能正确取到
     中心亮、边缘淡的径向贴图。 */
  {
    const pos = g2.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++){
      uv[i*2]   = pos.getX(i) * 0.5 + 0.5;
      uv[i*2+1] = pos.getZ(i) * 0.5 + 0.5;
    }
    g2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  /* 柔和边缘的径向 alpha：水洼不能是个硬边多边形块 —— 硬边版本被多模态判成
     "生硬贴在草地上的深色多边形色块，像贴图或模型瑕疵"。 */
  const alphaTex = (() => {
    const S = 64, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const grd = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.62, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.88, 'rgba(255,255,255,0.34)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
    const t2 = new THREE.CanvasTexture(cv);
    t2.colorSpace = THREE.NoColorSpace;
    return t2;
  })();
  const mat = new THREE.MeshStandardMaterial({ color: 0x243039, roughness: 0.06, metalness: 0.30,
                                               transparent: true, opacity: 0, depthWrite: false,
                                               alphaMap: alphaTex });
  const im = new THREE.InstancedMesh(g2, mat, CAND.length);
  im.frustumCulled = false; im.visible = false;
  scene.add(im);
  return { im, mat, cand: CAND, placed: 0, missed: 0, badNormal: 0, tooHigh: 0, onGrass: 0 };
})();

/* 雨停之后才有：wetness 高、且雨/雪都不在下 */
export const POSTRAIN = { drip: EAVE_DRIP, puddles: PUDDLES };   // 给门禁读的句柄
function postRainK(){
  const p = ENV.cur || {};
  const wet = p.wetness || 0;
  const raining = (p.rainAmount || 0) > 0.05 || (p.snowAmount || 0) > 0.05;
  if (raining) return 0;
  return Math.max(0, Math.min(1, (wet - 0.30) / 0.45));
}
/* ⚠️ 水洼的**高度必须在运行时用射线量**（2026-10-01 实测踩到）：
   第一版按 `groundHeight(x,z)+0.015` 摆 —— 那是**地形**高度，而铺地/台基是浮在地形之上的
   独立网格 ⇒ 水洼被**埋进铺地下面**，实测"关掉水洼"与"开着"两张图**逐像素为 0 差异**
   （完全看不见，且不报错）。现在改成：第一次需要显示时，从每个落点上方 12m 向下打一条射线，
   取**真正的可见表面**高度 + 0.02，打不中就把那一片丢掉。
   放在"第一次显示"时做，是因为模块求值期场景（延迟批）还没装配好。 */
let _puddlePlaced = false;
function placePuddlesOnce(){
  if (_puddlePlaced) return;
  _puddlePlaced = true;
  const rc = new THREE.Raycaster(); rc.far = 40;
  const down = new THREE.Vector3(0, -1, 0);
  const nrm = new THREE.Vector3();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
  /* ⚠️ 每片的尺寸/朝向/长宽比也是**摆位决定** ⇒ 走自己的种子流（确定性就够，
     不必与候选点那条流"续上" —— 那要数燃烧次数，反而更脆）。 */
  const pj = mulberry32(20261003);
  let ok = 0;
  PUDDLES.im.visible = false;
  for (const [x, z] of PUDDLES.cand){
    rc.set(new THREE.Vector3(x, 14, z), down);
    const hs = rc.intersectObjects(scene.children, true)
                 .filter(h => h.object.isMesh && h.object.visible && !h.object.isInstancedMesh && h.face);
    const hit = hs[0];
    if (!hit){ PUDDLES.missed++; continue; }
    /* ⚠️⚠️ **必须拒绝"打到墙/屋面上"的命中**（实测踩到，见本块顶部注释）：
       只取"第一个非实例网格"的话，落点上方只要是屋面或墙面就会把水洼**贴到墙上** ——
       实测效果是"右侧白墙上出现一块不自然的白斑"。判法：取该三角面的**世界法线**，
       只接受接近竖直朝上的面；再要求落点低。屋面/墙面两条都被卡掉。 */
    nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (nrm.y < 0.8){ PUDDLES.badNormal++; continue; }
    if (hit.point.y > 2.6){ PUDDLES.tooHigh++; continue; }
    /* ⚠️ **草地不积水洼**：草地上的深色片读成"泥斑/贴图瑕疵"（多模态实测判语：
       "生硬贴在草地上的深色多边形色块"）。判法用材质基色的绿优势 —— 铺地/石/月台都是
       灰调（g 不显著大于 r/b），草地明显偏绿 ⇒ 直接跳过。 */
    const mc = hit.object.material && hit.object.material.color;
    if (mc && mc.g > mc.r * 1.12 && mc.g > mc.b * 1.12){ PUDDLES.onGrass++; continue; }
    if (Math.hypot(hit.point.x - x, hit.point.z - z) > 3.5){ PUDDLES.missed++; continue; }
    const R = 0.75 + pj() * 1.05;
    p.set(hit.point.x, hit.point.y + 0.02, hit.point.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pj() * TAU);
    sv.set(R, 1, R * (0.62 + pj() * 0.32));      // 每片自己的长宽比 ⇒ 不是一水儿的圆
    m.compose(p, q, sv);
    PUDDLES.im.setMatrixAt(ok, m);
    ok++;
  }
  PUDDLES.im.count = ok;
  PUDDLES.im.instanceMatrix.needsUpdate = true;
  PUDDLES.placed = ok;
}
export function updatePostRain(dt, t){
  const k = postRainK();
  const D = EAVE_DRIP;
  D.im.visible = k > 0.001;
  PUDDLES.im.visible = k > 0.001;
  D.mat.opacity = 0.85 * k;
  PUDDLES.mat.opacity = 0.60 * k;
  if (!D.im.visible) return;
  placePuddlesOnce();
  const { m, p, q, sv } = D;
  for (let i = 0; i < D.N; i++){
    const d = D.drops[i];
    if (!d.live){
      /* 停顿结束后重生：在**整条檐口线**上按长度加权随机取一点 */
      d.wait -= dt;
      if (d.wait > 0) continue;
      let tt = Math.random() * EAVE_LINES.total;
      let seg = EAVE_LINES.segs[0];
      for (const s of EAVE_LINES.segs){ if (tt >= s.t0 && tt <= s.t0 + s.len){ seg = s; break; } }
      const f = Math.random();
      d.s = seg; d.f = f; d.y = seg.y + Math.random() * 0.06; d.vy = -0.2; d.live = true;
    } else {
      /* 自由落体（限速 4.6 m/s ⇒ 从 6.4m 檐口落到台基约 1.4s，看得见）*/
      d.vy = Math.max(-4.6, d.vy - 9.8 * dt);
      d.y += d.vy * dt;
      if (d.y <= d.s.gy){ d.live = false; d.wait = 0.12 + Math.random() * 1.15; }
    }
    const x = d.s.x0 + (d.s.x1 - d.s.x0) * d.f, z = d.s.z0 + (d.s.z1 - d.s.z0) * d.f;
    const vis = d.live ? 1 : 0;
    p.set(x, d.y, z);
    /* 速度越快拉得越长 ⇒ 读作"一条水线"而不是"一颗珠子"；没在落的收到 0（不画） */
    const stretch = d.live ? Math.min(3.4, 1 + Math.abs(d.vy) * 0.55) : 0.001;
    sv.set(vis, stretch * vis, vis);
    m.compose(p, q, sv);
    D.im.setMatrixAt(i, m);
  }
  D.im.instanceMatrix.needsUpdate = true;
}

/* 雨打水面：复用鱼跃涟漪的池子，按雨量把雨痕铺满池面。
   只有雨要，雪落在水里不出圈。 */
let rainRippleAt = 0;
export function updateRainRipples(t){
  const rain = ENV.cur.rainAmount || 0;
  if (rain < 0.05) return;
  if (t < rainRippleAt) return;
  /* 间隔随雨量缩放（细雨 ~0.9s、暴雨 ~0.17s），每次泼一小簇 2~4 圈：
     一轮实测（俯视终拍）仍是"中低密度"——14 槽上限下暴雨约 14 圈/s 生成、
     寿命 1.9s → 池子长期饱和在 14 圈，雨面才读得出"雨打水面"。
     圈径也随 strength 打散（0.7~1.3 随机），避免等径同心圆重演"声呐感"。
     夜间不跳过（旧版 ENV.time==='night' 直接 return）：夜暴雨里水面
     闪动的雨痕恰是气氛点 —— 强度 0.75 压低，别在墨水上闪成白环。 */
  const interval = 0.17 + (1 - rain) * 0.73;
  rainRippleAt = t + interval * (0.7 + Math.random() * 0.6);
  const cluster = 2 + Math.floor(Math.random() * (2 + Math.round(rain * 2)));
  const night = ENV.time === 'night';
  for (let k = 0; k < cluster; k++){
    /* 雨滴配额随容量同比放大：64 槽时留 3/4 给点击与鱼跃（上限 44），
       否则暴雨会把池子占满 —— 表现是"点了没反应"，且不报错。
       ⚠️ 这个数字必须与 06-vegetation 的 RIPPLE_N 一起看，改容量就要改这里。 */
    if (rainRippleActive >= 44) break;
    const a = Math.random() * TAU, r = Math.sqrt(Math.random());
    const strength = (night ? 0.75 : 1.0) * (0.7 + Math.random() * 0.6);
    spawnRipple(Math.cos(a) * 12.5 * r, 3.0 + Math.sin(a) * 6.4 * r, t,
      rain > 0.8 ? 3 : 2, strength, 'rain');
  }
}