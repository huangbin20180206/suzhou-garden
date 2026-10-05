// 12d-lantern: 夜间灯笼（灯罩纸纹 + 5 盏灯笼 + 体积光团 + 地面光斑）—— 2026-10-05 从 12-env.js 整块搬出。
/* 为什么单独一个文件：灯笼是"往 world 里挂的整套夜景装置"（自建贴图/材质/几何、5 盏 SpotLight、
   逐帧单摆、体积光与地面光斑的材质同步），与 12-env 的时段/季节/天气状态机是两件事。
   ⚠️ 本文件**不能** import './12-env.js'（12-env 反过来 import 本文件 → 成环、启动期 TDZ，项目多次前科）。
   ✅ 但它**不需要任何注入**：块内只有注释提到 applyEnv / initEnvScene 等（搬家时脚本已断言"非注释行零外部引用"），
      所以这里只写正常 import。这一条比 12c 干净 —— 印证"先扫描再搬"是值得的。
   ⚠️ makeLanterns 仍**不能**在任何模块顶层调用：它要往 world 挂灯笼，而 world 在本模块求值时还没建好
      （原文注释见下方 lampVolState 之后那一段）。调用点仍在 08 的 initEnvScene（经 12-env 转出）。
   ⚠️ 四个声明（_lampVol / _groundSplashMat / lanternMat / worldLights）在 12-env 的 applyEnv 与
      festivalState 里还在用，故本文件把它们 export 出去（其余一律不导出）。 */
import { THREE, mergeGeometries } from '../vendor.js';
import { MAT } from './01-materials.js';
import { camera, ACTIVE_QUALITY } from './02-scene.js';
import { world } from './08-assemble.js';
import { TAU } from './00-config.js';

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
export const lanternMat = new THREE.MeshStandardMaterial({
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
export const worldLights = []; // 定义灯笼点光源数组
export let _lampVol = null;     // 体积光材质（applyEnv 同步 uLamp / uRain；白天 uLamp=0 → alpha 0，等效空 mesh）
export let _groundSplashMat = null, _groundSplashGeo = null;   // 灯下地面光斑材质/几何（与 _lampVol 同理）
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
