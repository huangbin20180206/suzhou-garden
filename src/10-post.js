// 10-post: from index.html inline 499..648
import { THREE, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, GTAOPass } from '../vendor.js';
import { renderer, RENDER_SCALE, scene, camera, ACTIVE_QUALITY, world } from './02-scene.js';
import { MAT, setAuxPass, AUX_PASS_HIDDEN, HFOG } from './01-materials.js';
/* ⚠️ world 从 02-scene 取，**不能**从 08-assemble 取：08 import 本模块的 collectAOSkip，
   反向 import 就成环 → 本模块 body 被推迟到 08 之后，而 08 的 body 末尾要调 collectAOSkip()
   → 启动期 TDZ。world 在本模块只在 collectAOSkip 内用。 */
import { bootMark } from './00-config.js';
/* ══════════════════════════════════════════════════════════════
   10 · 后处理
   ══════════════════════════════════════════════════════════════ */
// 后处理链的渲染缓冲必须显式开启 MSAA —— renderer 的 antialias 只对直连画布生效，
// 走 EffectComposer 时会被完全绕过（实测 samples 为 0，全场景边缘锯齿）
const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
export const composer = new EffectComposer(renderer, composerTarget);

/* ══════════════════════════════════════════════════════════════
   深度纹理（高度雾的输入）—— **必须在 EffectComposer 构造之后再挂**
   ══════════════════════════════════════════════════════════════
   ⚠️⚠️ 这是本项目最隐蔽的一个坑，也是本轮唯一真正的"实现失败"（第一版渲染完全无效、
      分带中位差全是 0 —— 深度恒读到 0）。根因在 three r184 的 **WebGLRenderTarget.copy()**：
        this.depthTexture = e.depthTexture.clone()          ← 拷配置，不是拷引用
      而 EffectComposer 恰好两条路径都会走 copy()：
        ① 构造时 `this.renderTarget2 = renderTarget.clone()`；
        ② 每次 setSize()：`this.renderTarget2.setSize(...)`（RT.setSize 内部再 copy 一次）。
      ⇒ 在**构造前**给 composerTarget 挂 depthTexture，pass 手里的 tDepth 会指向
        那个"从没被渲染过"的克隆体，采样恒为 0 ⇒ 整个 pass 静默失效。
      ⇒ 所以顺序必须是：先建 composer，再把 depthTexture 挂上并**每帧指回活跃 RT**。
   ⚠️ UnsignedIntType + DepthFormat：HalfFloat 深度附件在本机 ANGLE/Intel Iris Xe
      上不支持，采样会得到全 1。 */
function attachDepthTexture(){
  /* 两个缓冲**都要**挂：swapBuffers() 每帧换人，指到没挂的那一个就会退回
     不可读的 renderbuffer（采样恒 0 ⇒ 整层静默失效）。
     ⚠️ 挂在 EffectComposer **构造之后**、且每帧对着 readBuffer 自愈 ——
        RT.setSize() 内部会 copy() 再把 depthTexture 克隆掉，不自愈就会指向旧纹理。 */
  for (const rt of [composer.readBuffer, composer.renderTarget2]){
    if (rt && !rt.depthTexture){
      const dt = new THREE.DepthTexture(rt.width, rt.height);
      dt.type = THREE.UnsignedIntType;
      dt.format = THREE.DepthFormat;
      dt.minFilter = THREE.NearestFilter;
      dt.magFilter = THREE.NearestFilter;
      rt.depthTexture = dt;
    }
  }
  /* ⚠️ 真正给高度雾用的，是**场景那一帧**的深度，由 gradePass.render 捕获（见该处注释）。
     此刻回退到 readBuffer，只在"从未经过 gradePass"的旁路调用（直接 composer.render 一次）下生效。 */
  return sceneDepthTex || composer.readBuffer.depthTexture;
}
// 与 renderer 用同一倍率，否则超采样会在最后一次 blit 时被丢掉
composer.setPixelRatio(RENDER_SCALE);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));

/* 环境光遮蔽（GTAO）—— 治「构件像浮在地面上」这个毛病。
   建筑/石作/植被与地面的接触处会压出暗角，这是调光源参数调不出来的。
   代价：GTAO 需要一遍额外的法线渲染，等于把场景几何再画一次，draw call 会明显上升。
   radius 用世界单位（米），1.8 对应园林构件的接触尺度。 */
/* GTAO 需要一遍额外的法线渲染（= 场景几何再画一遍），实测让 draw call 与三角形各翻一倍。
   两个措施把它压回可接受范围：
   ① 按设备档位开关 —— 小视口（移动端）直接不接这个 pass；
   ② AO 阶段排除 foliage —— 叶片/柳条/水草的 AO 贡献极小，却占了绝大部分三角形。
      被排除的只是 AO 的计算输入，主渲染完全不受影响。*/
// GTAO 需要一遍额外的法线渲染（场景几何再画一遍），核显上代价不可接受。
// 这里只做**开机静态判档**（独显 / 核显两档）。
// ⚠️ 下面这句旧注释是错的，已删：「完整的多档位自动升降级留到定稿后」——
//    运行期的**帧率滞回升降档（QOS）早就实现了**，见第 11 节（4 档：L0 初始 / L1 关 AO /
//    L2 分辨率 ×0.85 + 阴影 2048 / L3 ×0.72 + 阴影 1024；连续 6 窗口 <45fps 降档、
//    12 窗口 >58fps 升档、变档后冷却 10 窗口）。smoke 已断言降档 ×0.72 与升回 L0。
//    （2026-09-20 核对开发计划时发现的过时注释 —— 它害得"帧率滞回"被当成未完项。）
export const AO_ENABLED = ACTIVE_QUALITY.ao;

/* AO 阶段排除表提到模块级：P1-4 的延迟装配（柳/竹）在首帧之后才入场景，
   排除表必须在延迟批跑完后补收（collectAOSkip），否则迟到植被会进法线 pass，
   GTAO 成本翻倍。gtaoRender 闭包按引用读 aoSkipped，补收后自动生效。 */
const AO_SKIP_MATS = new Set([ MAT.leaf, MAT.leafDeep, MAT.willow, MAT.willowLeaf, MAT.reed,
                               MAT.bambooA, MAT.bambooB, MAT.banana, MAT.wisteria,
                               MAT.lily, MAT.lotus, MAT.trunk ]);
const aoSkipped = [];
const _aoSeen = new Set();
export function collectAOSkip(){
  aoSkipped.length = 0; _aoSeen.clear();
  const add = (o) => { if (!_aoSeen.has(o)){ _aoSeen.add(o); aoSkipped.push(o); } };
  world.traverse(o => {
    /* userData.aoSkip：非标准材质的后加物件（夏夜萤火虫是 Points + ShaderMaterial，
       不在 MAT 表里）靠这个标记进隐藏名单；普通网格仍按材质身份认领。 */
    if (o.userData.aoSkip) add(o);
    else if (o.isMesh && AO_SKIP_MATS.has(o.material)) add(o);
  });
  /* ② world **之外**的「场景级天空视觉层」（2026-10-04）——
     虹拱是 `scene.add(rainbowMesh)`（见 02 的 makeRainbowMesh），world.traverse 收不到它。
     这一步不改①的既有口径：只认**显式 userData.aoSkip**，不按材质身份全场景认领，
     免得把世界之外的普通物件误收进来、平白改变既有 AO 观感。
     Why 必须有：GTAO 的 pre-pass 用 override 材质重画整个场景，虹自己的 shader
     （含 discard）不会执行 ⇒ 它进 AO 深度缓冲后那片 AO≈0 ⇒ 天上一条实心黑拱。 */
  scene.traverse(o => { if (!_aoSeen.has(o) && o.userData.aoSkip) add(o); });
}
/* ⚠️ 这里**没有**顶层 `collectAOSkip()`：它读 `world`，而 world 定义在 08-assemble，
   08 反过来又 import 本模块的 collectAOSkip（延迟批跑完补收）→ 构成环，本模块先求值，
   顶层调用必撞 "Cannot access 'world' before initialization"。
   原 §10 段首的那次调用已移回 08 的 body 末尾（world 填满 + mergeStatics 之后，
   即原 §8 跑完的时点；顺序也不能反 —— 合并后收集才看得见合并后的网格）。 */

export let gtaoPass = null;          // 提到外层，供 ENV 调节 AO 权重
/* ── GTAO 半分辨率（2026-09-24 · 计划书第 1 项）────────────────────────────────
   GTAO 的代价是"把场景几何再画一遍"（法线 pass）+ AO / 泊松去噪两遍全屏片元。
   内部 RT 减半 ⇒ 这三遍的**片元**成本降到 1/4、法线 pass 的**片元**减半
   （draw call 与顶点数不变 —— 省的是后处理那一段，不是几何）。
   AO 贴图在合成时按 UV 采样 ⇒ 由 blend 那一遍自动双线性放大
   （three r184 的 `GTAOPass.OUTPUT.Default` 正是：copy readBuffer → blend pdRenderTarget），
   不需要额外上采样代码。
   ⚠️ 必须**包住 setSize**：`composer.setSize` 会回调每个 pass 的 setSize —— 窗口 resize
      （11-loop.js:28）与 QOS 变分辨率（11-loop.js:536 `composer.setPixelRatio(s); setSize(...)`）
      都会调到，只把半尺寸交给构造函数会在下一次 setSize 时被拉回全尺寸。
      已核对 three@0.184 的 `GTAOPass.setSize`：它同时改 gtao/pd/normal 三个 RT 与
      两个 shader 的 `resolution` uniform ⇒ 包一层是自洽的（不会出现"RT 半尺寸但
      uniform 还是全尺寸"的错配）。
   ⚠️ 档位前提：`AO_ENABLED` 取自画质配置（性能档关闭、均衡/高开启）⇒ **低画质档本来就没有 AO**，
      这条优化只在开启了 AO 的档位（以及 QOS 降档关 AO 之前）有意义 —— 见计划书 v2.0 补注。 */
const AO_SCALE = 0.5;
if (AO_ENABLED){
  const gtao = new GTAOPass(scene, camera, Math.max(1, Math.round(innerWidth * AO_SCALE)),
                                            Math.max(1, Math.round(innerHeight * AO_SCALE)));
  gtaoPass = gtao;
  /* 倍率放 userData（本项目既有套路：noMerge / reflectEveryFrame 同此）——
     门禁/诊断可临时置 1 做"全尺寸 vs 半尺寸"的 A/B，不必改产品代码。
     ⚠️ `Pass` 基类**没有** userData（r184 实测：直接写 `gtao.userData.aoScale` 会
        "Cannot set properties of undefined" ⇒ 模块 body 抛错 ⇒ **页面永久停在加载页**）。 */
  gtao.userData = { aoScale: AO_SCALE };
  const gtaoSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => {
    const s = gtao.userData.aoScale || 1;
    return gtaoSetSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  };
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({
    radius: 1.8,            // 世界单位（米）—— 园林构件的接触尺度
    distanceExponent: 1.2,
    thickness: 1.0,
    scale: 1.0,
    samples: 32,            // PC 端专用，直接拉满质量
  });

  // 收集「AO 阶段可忽略」的植被网格（mergeStatics 之后，按材质认领）
  // ⚠️ 屋面/脊/墙帽**不能**排除！GTAO 的法线+深度缓冲是 AO 的唯一依据：
  //    把它们藏起来，那片像素就会按「屋顶后面」的室内几何算 AO，
  //    再把室内的 AO 图案乘回屋面 —— 看起来就是「瓦面透明、能看见堂内布局」。
  //    只能排除那些「藏起来也不会露馅」的东西：叶簇（背后是同类叶簇或天空）。
  //    （P1-4：表已提到模块级 aoSkipped / collectAOSkip，延迟批跑完会补收。）

  /* ⚠️ 还原时必须还原**原值**，不能一律置 true。
     这里原来写的是 `m.visible = true`，而 MAT.lily / MAT.reed / MAT.willow / MAT.lotus /
     MAT.wisteria 全都在 AO_SKIP_MATS 里，于是每帧都被 GTAO 从 false 翻回 true：
       applyPresence(false) → 主 RenderPass 正确地不画 → gtao.render() 的 finally 置 true
     一帧结束后对象的 visible 就停在 true 上。运行时因为下一帧 applyPresence 会再压一次，
     画面侥幸是对的；但**任何直接调用 composer.render() 的旁路**（采集脚本、控制台调试）
     都会照着 true 去画 —— 实测：冬季采集图里睡莲叶铺满水面，而实际运行时不显示。
     保存/还原原值后，帧末的 visible 才等于 applyPresence 的意图，采集与运行时一致。 */
  const gtaoRender = gtao.render.bind(gtao);
  const gtaoPrevVis = new Array(aoSkipped.length).fill(true);
  gtao.render = function (...args){
    for (let i = 0; i < aoSkipped.length; i++) gtaoPrevVis[i] = aoSkipped[i].visible;
    for (const m of aoSkipped) m.visible = false;
    /* 相机下挂的镜头粒子（镜前雨帘/雪粒）不在 world 里，走 AUX_PASS_HIDDEN 单独存/还原 */
    const auxPrev = AUX_PASS_HIDDEN.map(o => o.visible);
    for (const o of AUX_PASS_HIDDEN) o.visible = false;
    /* ⚠️ 辅助 pass 期间还要把两件事按下去：
       ① 平面反射：Reflector 的 onBeforeRender 在**任何** renderer.render 里都会被调用，
          GTAO 的法线 pass 会把整个场景再渲染一遍 → 反射贴图被"法线色"覆盖一次
          （白白多一整遍镜像渲染，两条 pass 的状态互相污染）。
       ② 阴影：renderer.render 在 shadowMap.autoUpdate 打开时会重渲整张 shadow map，
          而此刻植被正被隐藏着 —— 等于每帧白渲一张 6144² 阴影图，且结果还会被下一帧覆盖。
       两者都必须 try/finally 还原。 */
    setAuxPass(true);
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    if (!window.__NO_SHADOW_GUARD) renderer.shadowMap.autoUpdate = false;   // 隔离实验开关
    try { gtaoRender(...args); }
    finally {
      renderer.shadowMap.autoUpdate = prevShadowAuto;      setAuxPass(false);
      for (let i = 0; i < aoSkipped.length; i++) aoSkipped[i].visible = gtaoPrevVis[i];
      for (let i = 0; i < AUX_PASS_HIDDEN.length; i++) AUX_PASS_HIDDEN[i].visible = auxPrev[i];
    }
  };
  composer.addPass(gtao);
}

export const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.50, 1.02);
composer.addPass(bloom);

/* 调色 pass —— 在原有的暗角之上补齐「后期该有的三件事」：对比、分离调色、饱和度。
   高光偏暖、暗部偏冷的分离调色是让画面脱开「3D 渲染感」最便宜也最有效的一步，
   而且全部发生在一个已有的 ShaderPass 里，不引入任何新 addon。 */
const GradeShader = {
  uniforms:{
    tDiffuse:{ value:null },
    uContrast:{ value:0.16 },                          // S 曲线强度
    uSaturation:{ value:1.06 },
    uWarmHi:{ value:new THREE.Color(0xFFF6E8) },       // 高光染色（暖）
    uCoolLo:{ value:new THREE.Color(0xE2EEFF) },       // 暗部染色（冷）
    uSplit:{ value:0.24 },
    uVignette:{ value:0.52 },
    uVigSize:{ value:0.90 },
  },
  vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSaturation, uSplit, uVignette, uVigSize;
    uniform vec3 uWarmHi, uCoolLo;
    varying vec2 vUv;
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;

      // ① 对比：以 0.5 为轴的 S 曲线
      vec3 cc = clamp(c, 0.0, 1.0);
      vec3 s  = cc * cc * (3.0 - 2.0 * cc);
      c = mix(c, s, uContrast);

      // ② 分离调色：按亮度在高光暖 / 暗部冷之间插值
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 toned = mix(c * uCoolLo, c * uWarmHi, smoothstep(0.10, 0.75, l));
      c = mix(c, toned, uSplit);

      // ③ 饱和度
      c = mix(vec3(l), c, uSaturation);

      // ④ 暗角
      float d = distance(vUv, vec2(0.5));
      c *= mix(1.0, smoothstep(uVigSize, uVigSize - 0.52, d), uVignette);

      gl_FragColor = vec4(c, src.a);
    }`,
};
/* ⚠️ ShaderPass 会**克隆**模板的 uniforms（ShaderPass.js: this.uniforms = UniformsUtils.clone(shader.uniforms)）。
   所以 applyEnv 里写 GradeShader.uniforms 是写给一份没人用的模板 —— 实测：切到"夜 + 阴霾"后
   模板 saturation 已变成 0.662，而真正的 pass 还停在 1.06/0.16。
   也就是说对比 / 饱和 / 分离调色 / 暗角**从来没随时段天气变过**。必须写 pass 自己那份。 */
export const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);
/* ── 场景深度纹理的**捕获点**（高度雾的输入）────────────────────────────────
   ⚠️⚠️ 取深度的正确时机极容易搞错，本轮为此栽了两次，两次症状都是"整层静默失效"：
     ① 挂在 EffectComposer **构造前** → RT.copy() 会 depthTexture.clone()，
        拿到的是一张"从没被渲染过"的图（采样恒 0）。
     ② 每帧指 composer.readBuffer → 也错：**RenderPass 的 needsSwap 是 false**，
        它把颜色和深度都写进 readBuffer 且**不换手**；随后 gradePass（needsSwap=true）
        换了一次手 ⇒ 高度雾看到的 readBuffer 已经是 gradePass 的**输出缓冲**，
        它的深度纹理从没人写过。
   ⇒ 正确做法：在 **gradePass 渲染时**（此刻 readBuffer 仍是 RenderPass 的输出）
     把 `composer.readBuffer.depthTexture` 存下来给高度雾用。 */
let sceneDepthTex = null;
const gradeRenderOrig = gradePass.render.bind(gradePass);
gradePass.render = function (...a){
  const rb = composer.readBuffer;
  if (rb && rb.depthTexture) sceneDepthTex = rb.depthTexture;
  return gradeRenderOrig(...a);
};
bootMark('后处理链');

/* ══════════════════════════════════════════════════════════════
   近地面高度雾（2026-09-26）
   ══════════════════════════════════════════════════════════════
   动机与被证伪的替代方案见 01-materials.js 的 HFOG 注释（要点：FogExp2 是均匀介质，
   近景要浓与远景不能糊在它那里互斥 —— 实测 4.4× 密度会让 176m 远山 100% 消失）。

   算法：把视线**切成 uSteps 段**，逐段累加"该处世界高度上的雾浓度"，最后按 Beer-Lambert
   合成 —— 所以它是真正的**沿视线积分**，而不是"按距离贴一个系数"。
     浓度(p) = uDensity · 高度衰减(p.y) · 距离分段系数(p 的视线距离)
     高度衰减 = 1 - smoothstep(uTop·0.35, uTop, p.y)   —— 贴水面最浓，柱顶几乎为 0
     距离分段 = uNearGain (0~10m) / uFarGain (10m~uFarEnd)，uFarEnd 之后线性归零
   世界高度用 depthTexture 里的 NDC 深度**反投影**出来：
     viewZ = perspectiveDepthToViewZ(d, near, far) → 沿视线前进 -viewZ 得到世界点
   不额外传 uniform：cameraPosition 由 three 自动注入，near/far 在 pass 构造时抓进闭包。

   ⚠️ 必须放在 gradePass **之后**、OutputPass 之前：
      放前面会连暗角/对比一起被雾洗平（雾是"空气"，不作用于调色曲线），
      放 OutputPass 之后则要在 sRGB 空间里混颜色，会和 tone mapping 的响应打架。 */
const HeightFogShader = {
  uniforms:{
    tDiffuse:    { value:null },
    tDepth:      { value:null },
    uColor:      { value:new THREE.Color(0xDCE0E2) },
    uTop:        { value:2.6 },
    uSteps:      { value:8 },
    uDensity:    { value:0.030 },
    uNearGain:   { value:0.20 },
    uFarGain:    { value:1.00 },
    uFarEnd:     { value:30.0 },
    uNear:       { value:camera.near },
    uFar:        { value:camera.far },
    uEnabled:    { value:1.0 },
    uAspect:     { value:camera.aspect },
    uTanHalfFov: { value:Math.tan((camera.fov * Math.PI / 180) * 0.5) },
    uCamPos:     { value:new THREE.Vector3() },
    uCamFwd:     { value:new THREE.Vector3(0, 0, -1) },
    uCamRight:   { value:new THREE.Vector3(1, 0, 0) },
    uCamUp:      { value:new THREE.Vector3(0, 1, 0) },
  },
  vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  /* 视线方向由 uCamFwd/Right/Up 三个基向量 + uv 在片元里重建 —— 不用 three 的
     cameraPosition 注入（那是给顶点着色器准备的），也不用为每帧变化的 FOV 传 uniform
     快照：基向量每帧刷一次即可（见下方 render wrapper）。
     ⚠️ 早期版本曾用 cameraPosition + 字符串 replace 拼 rayDir，GLSL1 下"先用后声明"
        会编译失败；现在是把声明顺序一次写对，不是靠 replace 打补丁。 */
  fragmentShader:`
    uniform sampler2D tDiffuse, tDepth;
    uniform vec3 uColor;
    uniform float uTop, uSteps, uDensity, uNearGain, uFarGain, uFarEnd;
    uniform float uNear, uFar, uEnabled, uAspect, uTanHalfFov;
    uniform vec3 uCamPos, uCamFwd, uCamRight, uCamUp;
    varying vec2 vUv;
    /* three 的 GLSL1 chunk 同款换算：把 DepthTexture 的 [0,1] 深度变回视空间 z */
    float viewZFromDepth(float d){
      float ndc = d * 2.0 - 1.0;
      return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
    }
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      if (uEnabled < 0.5){ gl_FragColor = src; return; }
      float dRaw = texture2D(tDepth, vUv).x;
      float vz = viewZFromDepth(dRaw);
      /* 天空不参与积分：否则地平线以上会糊成一片白墙。
         阈值取 uFar 的 92% —— 远山最远才 176m 而 uFar=900，判据不会误伤真几何。 */
      if (dRaw >= 0.9999 || vz > uFar * 0.92){ gl_FragColor = src; return; }
      float dist = max(vz, 0.0);
      vec3 dir = normalize(uCamFwd
                         + uCamRight * ((vUv.x * 2.0 - 1.0) * uTanHalfFov * uAspect)
                         + uCamUp    * ((vUv.y * 2.0 - 1.0) * uTanHalfFov));
      float stepLen = dist / uSteps;
      float acc = 0.0;
      int N = int(uSteps);
      for (int i = 0; i < 16; i++){
        if (i >= N) break;
        /* 样本落在该步中点：比取端点更接近积分均值，8 步下误差可忽略 */
        float seg = (float(i) + 0.5) * stepLen;
        vec3 p = uCamPos + dir * seg;
        float hFall = 1.0 - smoothstep(uTop * 0.35, uTop, p.y);
        float dGain = (seg < 10.0) ? uNearGain
                     : uFarGain * (1.0 - smoothstep(uFarEnd * 0.55, uFarEnd, seg));
        acc += hFall * dGain;
      }
      acc *= uDensity * stepLen;
      /* Beer-Lambert：与 FogExp2 的观感一致，但"上边界"来自 uTop 而不是距离平方律 */
      float tr = clamp(exp(-acc), 0.0, 1.0);
      gl_FragColor = vec4(mix(uColor * src.rgb, src.rgb, tr), src.a);
    }`,
};
export const heightFogPass = new ShaderPass(HeightFogShader);
/* ⚠️⚠️ ShaderPass 会 **UniformsUtils.clone** 模板的 uniforms（GradeShader 处踩过：
   写模板是写给一份没人用的对象）。所以上面 `...HFOG` 的共享在这里等于失效 ——
   必须把 pass 自己的这批 uniform **指回** HFOG 的同一批对象，否则：
     · 门禁改 HFOG.uDensity 不会生效，A/B 全部退化成 0 差。
   这是**指针回接**（不是拷贝值），所以外部写 HFOG 立刻对 pass 生效。
   ⚠️ uColor 是**例外**：它每帧从 scene.fog.color 抄（见 render wrapper），
      因为 12-env/11-loop 那条同步链只刷 scene.fog.color 与 MIST.uColor，**不碰** HFOG。 */
for (const k of ['uColor', 'uTop', 'uSteps', 'uDensity', 'uNearGain', 'uFarGain', 'uFarEnd']){
  heightFogPass.uniforms[k] = HFOG[k];
}
/* ⚠️ uEnabled 刻意**不进**上面那张共享表：它是"要不要开这层"的总闸，与雾的形状参数
   不是一回事。上一版没导出它，于是想"整层关掉"的人只能伸手去抠
   `heightFogPass.uniforms.uEnabled` —— 而抠 pass 内部正是本项目反对的做法（探针里重调
   会被下一帧的参数覆盖；要按住一个每帧推进的东西必须走产品侧权威开关）。
   门禁/诊断要关它请走这个导出，别直接改 pass。 */
export function setHFogEnabled(v){ heightFogPass.uniforms.uEnabled.value = v ? 1 : 0; }
/* 相机基向量每帧刷一次（走 composer 链的 render 时 camera 已经就位）。
   ⚠️ 必须在 render 里刷而不是只在构造时抓：FOV 会随 12-env 的运镜/季节变，
   uTanHalfFov / uAspect 跟着 camera 走才对。
   ⚠️ tDepth 也在这里指：composer 的 setSize 会重建 RT 尺寸，DepthTexture 的
   size 由 EffectComposer 同步，但**引用**必须每帧指一次，resize 后才不会指向旧纹理。 */
heightFogPass.render = (function(orig){
  return function(...a){
    const u = heightFogPass.uniforms;
    /* ⚠️ 雾色每帧从 scene.fog 抄。12-env/11-loop 那条同步链只刷 scene.fog.color 与
       MIST.uColor，**不碰** HFOG —— 不抄的后果是夜里高度雾仍用白天的雾色，而近中景
       恰恰是夜里最需要层次的地方，这个错偏偏在暗场最显眼。
       在这里抄而不是去改 12-env：12 不在本轮文件边界内，而 scene.fog.color 就是那条链的
       **权威出口**，从出口读是最短路径、也最不容易再走偏。 */
    if (scene.fog) u.uColor.value.copy(scene.fog.color);
    u.uCamPos.value.copy(camera.position);
    camera.getWorldDirection(u.uCamFwd.value);
    u.uCamRight.value.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    u.uCamUp.value.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    u.uAspect.value = camera.aspect;
    u.uTanHalfFov.value = Math.tan((camera.fov * Math.PI / 180) * 0.5);
    /* ⚠️ 必须**每帧**指向 composer 当前的活跃 RT：RT.setSize 会内部 copy() ⇒
       depthTexture 被换成新克隆体，缓存引用会指向一张"从没被渲染过"的深度图。 */
    u.tDepth.value = attachDepthTexture();
    return orig.apply(this, a);
  };
})(heightFogPass.render.bind(heightFogPass));
composer.addPass(heightFogPass);
composer.addPass(new OutputPass());