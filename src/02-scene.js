// 02-scene: from index.html inline 615..854
import { THREE, OrbitControls } from '../vendor.js';
import { CFG, bootMark } from './00-config.js';
/* ══════════════════════════════════════════════════════════════
   2 · 渲染器 / 相机 / 控制器   ══════════════════════════════════════════════════════════════ */
export const app = document.getElementById('app');
export const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
/* ── 快速设备档位 ──
   双显卡笔记本上，浏览器默认常常跑在核显上（实测 Intel Iris Xe 只有 22.6fps，
   而同一场景在 RTX 4060 上是 54.3fps）。场景是按独显设计的，核显上根本没法看。
   这里读一次 GPU 名字决定初始画质；*运行期自适应**见第 11 节的 QOS（帧率滞回升降档）。 */
export const GPU_NAME = (()=>{
  try {
    const gl = renderer.getContext();
    const d  = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
  } catch { return ''; }
})();
/* 软渲染（无头探针 / 无 GPU 的虚拟机）：帧率不反映真实设备能力，
   QOS 自适应必须对它免疫，否则回归条件会随机器负载漂移（见 QOS 段说明）。 */
export const SOFTWARE_GL = /SwiftShader|llvmpipe|Software|Mesa OffScreen|Microsoft Basic/i.test(GPU_NAME);
/* ── "当前这次运行不是真人在用" 的直接信号 ──
   2026-09-18 新增。原来判"要不要跑运行期自适应（QOS）"只看 `SOFTWARE_GL`，
   但那是 *代理判据**：它代理的是"无头探针"，而探针换到真 GPU 之后（实测 66× 提速，
   见 PITFALLS §1）`SOFTWARE_GL` 为 false → 自适应被激活，没 12 帧就自己降到 L1，
   而它会在跑的过程中改 `scale` / 阴影尺寸 —— 正是回归断言最怕的"自己会动"的量。
   代理判据会随环境变化失效（这次就是），所以换成直接判据：**被自动化驱动**。
   实测 Playwright（无论有无 GPU 参数）下 `navigator.webdriver === true`。 */
export const PROBE_DRIVEN = (() => { try { return navigator.webdriver === true; } catch { return false; } })();
export const QOS_IMMUNE = SOFTWARE_GL || PROBE_DRIVEN;
/* Tier 档位支持 `?tier=high` 覆盖（诊断/探针验证写实档用）：headless SwiftShader 会被
   误判成 low，从而跳过体积光锥等高写实效果 —— 探针带 ?tier=high 即可拍到它们。
   2026-09-25：mid 从“能解析但等同 high”改成真正独立的均衡档。 */
export const GPU_TIER_FORCED = (() => { try { return /[?&]tier=(low|mid|high)/.exec(location.search)?.[1] || null; } catch { return null; } })();
const autoTier = /Intel|Iris|UHD Graphics|HD Graphics|Radeon\(TM\) Graphics|Vega|llvmpipe|SwiftShader/i.test(GPU_NAME)
  ? 'low'
  : (/Apple M[1-9]|Intel Arc|GTX\s*(1[06]\d{2}|20[567]\d{2})|Radeon RX\s*[56]\d{3}/i.test(GPU_NAME) ? 'mid' : 'high');
export const GPU_TIER = GPU_TIER_FORCED || autoTier;

/* 电脑画质单一真值：分辨率、阴影、AO、反射、折射与粒子预算都从这里派生。
   mid 是真正的均衡档：4096 阴影 + 半分辨率 GTAO + 768 反射；high 才开放 4K 与 6144 阴影。 */
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ key:'low', label:'性能', pixelBudget:1920*1080*1.10, supersample:1.00,
                       shadow:2048, ao:false, reflection:0, refraction:384,
                       rain:5000, snow:1200, lensWeather:60, fireflies:34, volume:false }),
  mid: Object.freeze({ key:'mid', label:'均衡', pixelBudget:2560*1440*1.05, supersample:1.10,
                       shadow:4096, ao:true, reflection:768, refraction:768,
                       rain:10000, snow:1800, lensWeather:85, fireflies:48, volume:true }),
  high: Object.freeze({ key:'high', label:'高', pixelBudget:3840*2160*1.05, supersample:1.25,
                       shadow:6144, ao:true, reflection:1024, refraction:768,
                       rain:14000, snow:2400, lensWeather:110, fireflies:62, volume:true }),
});
export const ACTIVE_QUALITY = QUALITY_PRESETS[GPU_TIER];
export function pixelRatioForTier(tier = GPU_TIER, width = innerWidth, height = innerHeight){
  const q = QUALITY_PRESETS[tier] || ACTIVE_QUALITY;
  return Math.min(Math.max(devicePixelRatio, q.supersample),
                 Math.max(1, Math.sqrt(q.pixelBudget / Math.max(1, width * height))));
}

/* 超采样抗锯齿（SSAA）：按高于画布的分辨率渲染，由浏览器呈现时降采样。
   对竹林叶片、窗棂、瓦垄这类高频细节的提升比任何后期 AA 都直接。 */
export const SUPERSAMPLE = ACTIVE_QUALITY.supersample;
export const RENDER_SCALE = pixelRatioForTier(GPU_TIER);
renderer.setPixelRatio(RENDER_SCALE);
bootMark('渲染器');
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;   // 原 1.05 在 ACES 下把粉墙/石材推到纯白
renderer.shadowMap.enabled = true;
/* r184 已弃用 PCFSoftShadowMap（内部自动回落为 PCF），显式声明避免每帧 console 警告 */
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;      // 手动 reset，以便统计整帧（含后处理）开销
app.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CFG.fog.color, CFG.fog.density);

/* 园林世界的根容器。
   ⚠️ 它 *必须**住在模块图这一层（而不是 08-assemble 里）：6-vegetation 的装配函数要把
   植被挂进 world，若 world 定义在 08，06 就得 import 08 —— 而 08 的模块体又要读 06 的
   rippleInst / perchingAnchors 等 *模块级常量* → 成环，06 的 body 被推迟到 08 之后，
   08 的 body 读到的全是 TDZ（实测 "Cannot access 'rippleInst' before initialization"）。
   放在 scene 旁边，依赖方向就单纯了：02 → 06 → 08。
   `scene.add(world)` 仍留在 08（保持与原先一致的挂载时机）。 */
export const world = new THREE.Group();

export const camera = new THREE.PerspectiveCamera(46, innerWidth/innerHeight, 0.5, 900);
camera.position.set(-20, 17, 32);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.62;
controls.panSpeed = 0.7;
controls.zoomSpeed = 0.85;
/* 默认最小机位距离。⚠️ OrbitControls.update() 每帧都会把相机半径夹在 [minDistance, maxDistance]，
   而渲染循环里 updateCamFly() 之后紧跟 controls.update() —— 所以"近观"机位（字心前 2.8m）
   必须先把这个下限放开，否则镜头一到位就被弹回 9m（近观白做）。
   做法：机位可自带 minDist；飞行途中整体放开、落位后再按目标机位恢复。 */
export const CAM_MIN_DIST = 9;
controls.minDistance = CAM_MIN_DIST;
controls.maxDistance = 170;
controls.maxPolarAngle = Math.PI * 0.492;   // 限制俯仰，避免钻入地面
controls.minPolarAngle = Math.PI * 0.055;
controls.target.set(0, 3.5, -1);
/* 视角边界与复位（审计 F03）：极角原本就限住了，但**目标点可以任意平移** ——
   能把视点拖到园子外/地下而且回不来，也没有回初始机位的入口。
   这里给目标点一个园子范围，并保留初始机位供 0 键复位。 */
export const CAM_HOME = { pos: camera.position.clone(), target: controls.target.clone() };
controls.addEventListener('change', ()=>{
  const t = controls.target;
  t.x = Math.max(-34, Math.min(34, t.x));
  t.z = Math.max(-28, Math.min(28, t.z));
  t.y = Math.max(0.2, Math.min(16, t.y));
});
export function resetCamera(){
  camera.position.copy(CAM_HOME.pos);
  controls.target.copy(CAM_HOME.target);
  controls.minDistance = CAM_MIN_DIST;     // 复位时一并收回近观敞开的下限
  controls.update();
}

/* 渐变天空球（三停：地平线 → 中腰 → 天顶） */
function makeSkyMat(top, mid, horizon, sunCol, sunDir){
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{
      uTop:{value:new THREE.Color(top)}, uMid:{value:new THREE.Color(mid)},
      uHorizon:{value:new THREE.Color(horizon)},
      uSunColor:{value:new THREE.Color(sunCol)}, uSunDir:{value:sunDir.clone().normalize()},
      uTime:{value:0},
      uCloudTint:{value:new THREE.Color(0xFFFBF3)},   // 云的颜色（黄昏会转暖）
      uCloudAmount:{value:0.88},                       // 云量（阴天→1，晴→低值）
      uStarAmount:{value:0.0},                         // 星（仅夜间）
      /* 长曝光星轨（2026-09-21）：平时 0 = 星野静止；长曝合成时逐帧累加方位角，
         星点随帧走成圆弧（见 11-loop 的 queueLongExposurePostcard）。 */
      uStarRot:{value:0.0},
      uDiskFade:{value:0.0},                           // 1 = 抹掉日轮（阴/雨/雪：天上有云，看不到日头）
      /* 月（2026-09-19 老黄：晴夜该有月亮，随辰起落）：方向与可见度由 applyEnv 按 *时辰**
         写入，uMoonAmount=0 即天上无月（阴/雨/雪/白天）。uMoonPhase 保留成通道：
         1 = 满月；想换弯月只改这一个数（0.5 左右是上下弦，0.35 是月牙）。 */
      uMoonDir:{value:new THREE.Vector3(0,1,0)},
      uMoonAmount:{value:0.0},
      uMoonColor:{value:new THREE.Color(0xF4F7FF)},
      uMoonPhase:{value:1.0},
    },
    vertexShader:`varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader:`varying vec3 vDir;
      uniform vec3 uTop, uMid, uHorizon, uSunColor, uSunDir;
      uniform float uTime;
      uniform vec3  uCloudTint;
      uniform float uCloudAmount, uStarAmount, uDiskFade, uStarRot;
      uniform vec3  uMoonDir, uMoonColor;
      uniform float uMoonAmount, uMoonPhase;

      // 便宜的 value-noise FBM —— 给天空一层有体积感的云，
      // 原来的天空是均匀平色，占了画面 30~40% 面积却毫无信息。
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        /* 三停渐变（2026-09-21 走查 F4，二轮按实测机位修正）：
           默认俯视机位画面最顶端 h≈0.53 —— 天顶（h>0.70）根本不在视野里，
           旧锚点下整片可见天幕都是 horizon 色，暮色就成了芒果黄大幕。
           先做一次非线性重映射 hh：地平线贴死 0，离开地平线后中腰迅速接管，
           这样低仰角也能看到灰青；天顶段仍保留足够纵深。 */
        float hh = pow(clamp((h - 0.50) / 0.50, 0.0, 1.0), 0.72);
        /* 第一段必须极陡：实测默认俯视机位画面顶端 hh≈0.14，暖色只能贴地平线
           几度，再往上立刻交给中性中腰 —— 否则低视角下整片天都是 horizon 色。 */
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, hh));
        col = mix(col, uTop, smoothstep(0.45, 0.95, hh));

        float s = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
        /* 宽光晕收窄（pow 7→10、0.16→0.10）：暖橙只该贴着太阳方向，
           旧值在低视角把整圈地平线都烘暖 —— 橙色必须来自 preset 里已压灰的
           horizon，而不是这一项全方位补橙。 */
        col += uSunColor * (pow(s, 620.0) * 0.55 + pow(s, 10.0) * 0.10) * (1.0 - uDiskFade);

        // 云：把视线方向投影到天空平面做 FBM，两层叠出絮状结构。
        float cloudCover = 0.0;
        if (d.y > 0.015){
          vec2 cp = d.xz / max(d.y, 0.06) * 0.52 + vec2(uTime * 0.0035, uTime * 0.0019);
          float f  = fbm(cp * 1.55);
          float f2 = fbm(cp * 4.10 + 7.3);
          float cloud = smoothstep(0.50, 0.88, f * 0.74 + f2 * 0.36);
          cloud *= smoothstep(0.015, 0.28, d.y);           // 地平线附近淡出，避免硬边
          cloudCover = cloud * uCloudAmount;
          col = mix(col, uCloudTint, cloudCover);
        }

        // 星：夜间才有。方向量化后取伪随机亮点，加一点闪烁。
        if (uStarAmount > 0.001 && d.y > 0.0){
          vec3 rd = d;
          if (uStarRot > 1e-4){
            /* 长曝光星轨：uStarRot 就是累计方位角。平时为 0 走原样（星野静止），
               长曝合成时按帧累加一个微角 → 同一颗星在不同帧被画到不同量化格，
               加性叠加后读成一段圆弧。 */
            float ca = cos(uStarRot), sa = sin(uStarRot);
            rd = vec3(rd.x * ca - rd.z * sa, rd.y, rd.x * sa + rd.z * ca);
          }
          vec3 sp = floor(rd * 240.0);
          /* hash 输入必须收缩到 [0,2) 量级（2026-09-21 探针实测）：旧版
             sp.xy + sp.z*31.7 的量级到 3.7e6，在 mediump(fp16,上限 65504) 下
             sin() 参数溢出成 NaN → fract(NaN)=NaN → step(0.9982,NaN)=0，
             整片星空静默消失（探针 readPixels 顶部 45% 亮像素数为 0）。
             fract() 收缩后输入有界，fp16/fp32 都安全。 */
          vec2 hp = vec2(fract(sp.x * 0.1571), fract(sp.y * 0.1571)) + fract(sp.z * 0.0628);
          float hs = hash21(hp);                       // 星等随机数（原名 h，与外层天顶高度 h 重名，顺手正名）
          float h2 = hash21(hp + 7.31);                // 第二随机数：频率/包络相位错开用
          /* ── 闪烁（2026-09-22 老黄："给繁星增加随机闪烁效果"）──
             旧式单 sin：全星共用一个 2.1 rad/s 频率、只差相位、幅度只到 ±25% ——
             读起来是整片星空"一起呼吸"，而且暗到 50% 还是亮的，看不出在闪。
             现在三件事各管一头，全部由逐星 hash 驱动（每颗星互不相干）：
               ① 频率 fq：3.2~9.4 rad/s ≈ 0.5~1.5Hz，肉眼舒服的星闪速度；
               ② 双频（快载波 × 慢包络）→ 包络不规则；单 sin 是匀速明暗，像呼吸不像星闪；
               ③ 幅度 0.78±0.45（0.33~1.23），且被包络逐时刻缩放（有效幅度 ±4.5%~±45%）——
                  同一颗星时而几乎不闪、时而明暗剧烈，这才是"随机"。
             均值刻意保持 ≈0.78（与旧版 0.75 同档）：整体星野亮度不变，只把"稳定"换成"闪烁"，
             否则改完天会变暗、把 09-21 那轮星空密度调校一并推翻。
             ⚠️ 成本：2 次 hash21 + 3 次 sin，仍在 uStarAmount>0.001 分支内 —— 软渲染回退档
                只在夜里走这段，不新增分支、不新增 uniform。 */
          float fq  = 3.2 + 6.2 * h2;
          float ph  = hs * 63.0 + h2 * 41.0;
          float env = 0.55 + 0.45 * sin(uTime * fq * 0.23 + h2 * 23.0);
          float tw  = 0.78 + 0.45 * sin(uTime * fq + ph) * env;
          /* 双档星等（2026-09-21 星空修复后走查）：旧式单档 0.18% 密度在暗夜
             天空里只有十几颗小点，读不出"星空"。step(0.9965)=0.35% 普通星 +
             其中 top 0.1% 提为亮星（×1.0 vs ×0.55），拉开一等星与六等星的层次。 */
          vec3 starCol = vec3(0.85, 0.90, 1.0) * (0.55 + 0.45 * step(0.9990, hs)) * uStarAmount * tw;
          col += starCol * step(0.9965, hs) * smoothstep(0.0, 0.22, d.y);
        }

        /* ── 月 ──
           放在云之后：月亮要"隔着薄云"也能看见（纯按云覆盖整块抹掉会让它时有时无），
           所以只按云量衰减不抠除。三件事让它读起来是月亮而不是灯/太阳：
             ① 月海斑：月面局部坐标上的 FBM —— 满月的暗斑是它最可辨识的特征，
                纯白盘子会被当成第二个太阳；
             ② 边缘略暗（limb darkening）：球体的明暗过渡，平盘没有这个就还是"贴纸"；
             ③ 大气光晕：一大一小两个指数项，隔着薄云的月夜就是这个样子。
           视半径 R=0.026 rad（约 1.5°，真实月轮 0.26°）—— 不放这么大在画面里
           只有几个像素，读不出"那是个月亮"，月海暗斑也没有像素承载。 */
        if (uMoonAmount > 0.001){
          vec3 md = normalize(uMoonDir);
          float ca = dot(d, md);
          float ang = acos(clamp(ca, -1.0, 1.0));
          float R = 0.026;
          vec3 mt = normalize(cross(md, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
          vec3 mb = cross(md, mt);
          vec2 mc = vec2(dot(d, mt), dot(d, mb)) / R;
          float disk = 1.0 - smoothstep(R * 0.84, R * 1.08, ang);
          /* 相位（uMoonPhase=1 为满月）：用一条偏移的"明暗界线"把月轮切掉一块。
             phase<1 时圆缺随相位线性推进，0.5 上下弦、0.25 月牙。 */
          float ph = 1.0;
          if (uMoonPhase < 0.999){
            float off = (1.0 - uMoonPhase) * 2.0;               // 0(满) → 2(无)
            ph = smoothstep(-0.06, 0.06, mc.x + off);
          }
          float maria = fbm(mc * 1.15 + 3.7);
          /* 月盘亮度（2026-09-21 对拍实测，四次收敛）：像素扫描发现上一版
             峰值 sRGB 244（线性≈0.90），月盘整体落在 bloom 软膝（threshold
             0.86、膝区下沿≈0.43）内，被夜 bloom（radius 0.62）糊成半径 150px
             的光团。surf 收到 0.28~0.62、再乘 0.90：蓝通道峰值≈0.56，
             只有亮缘轻微沾膝，月盘靠月海明暗（0.28↔0.62）成立而非过曝。 */
          float surf = mix(0.28, 0.62, smoothstep(0.33, 0.71, maria));
          surf *= 1.0 - 0.20 * smoothstep(0.62, 1.0, length(mc));   // 边缘略暗
          float mvis = uMoonAmount * (1.0 - 0.55 * cloudCover);
          col += uMoonColor * disk * ph * surf * mvis * 0.90;
          /* 辉光（像素扫描驱动）：上一版 pow150 外晕半衰角仍有 2.2°，叠加 bloom
             后 72px 处天空被提亮近 3 倍。只保留紧贴月轮的窄冕（pow 900，
             半衰角 0.85°），外晕几乎归零 —— 月周天空不再洗白。 */
          float glow = pow(max(ca, 0.0), 900.0) * 0.16 + pow(max(ca, 0.0), 350.0) * 0.010;
          col += uMoonColor * glow * mvis * 0.38;
        }

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
export const skyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(420, 48, 28),
  makeSkyMat(0xA8BDD4, 0xBFD2E6, 0xE7E9E3, 0xFFF3D8, new THREE.Vector3(...CFG.sun.pos))
);
skyMesh.frustumCulled = false;
scene.add(skyMesh);
bootMark('天空球');

/* ── 环境贴图（PMREM）：按时段**按需烘焙 + 缓存**（2026-09-25）────────────────
   旧实现只在启动时按"白天渐变天空 + 地面色"烘一张，之后永不重烘，
   只用 environmentIntensity 缩放：夜里/阴天材质反射的仍是**白天的蓝天**（实测恒为 1.0）。
   这是一个真实的"合理性"缺陷：水面与石材的反射色随时段是错的。
   现在改成：每个时段首次被切到时烘一次并缓存，之后直接复用 ⇒
     · 反射色随时段正确（夜是月光冷色、暮是暖橙）；
     · 稳态零重烘（切季节/天气不会触发烘焙）；
     · 烘焙发生在**过渡刚结束**时，而不是过渡中每帧，避免卡顿被写进动画。
   烘焙参数由 12-env 在时段切换收尾时注入（避免 02 → 12 的反向依赖）。 */
const ENV_BAKE = { pmrem:null, geo:null, cache:new Map(), builds:0 };
function envBakeScene(preset){
  const p = preset || { skyTop:0xA8BDD4, skyMid:0xBFD2E6, skyHorizon:0xE7E9E3,
                        sunDisk:0xFFF3D8, ground:0x5F7B45, sunPos:CFG.sun.pos };
  const es = new THREE.Scene();
  const s = new THREE.Mesh(new THREE.SphereGeometry(14, 32, 20),
    makeSkyMat(p.skyTop, p.skyMid, p.skyHorizon, p.sunDisk, new THREE.Vector3(...p.sunPos)));
  es.add(s);
  const g = new THREE.Mesh(new THREE.CircleGeometry(14, 28).rotateX(-Math.PI/2),
    new THREE.MeshBasicMaterial({ color:p.ground }));
  g.position.y = -3.2; es.add(g);
  return { es, s, g };
}
function bakeEnvFor(preset){
  const key = preset && preset.key ? preset.key : 'default';
  const hit = ENV_BAKE.cache.get(key);
  if (hit) return hit;
  if (!ENV_BAKE.pmrem) ENV_BAKE.pmrem = new THREE.PMREMGenerator(renderer);
  const { es, s, g } = envBakeScene(preset);
  const tex = ENV_BAKE.pmrem.fromScene(es, 0.035).texture;
  s.geometry.dispose(); g.geometry.dispose();
  ENV_BAKE.cache.set(key, tex);
  ENV_BAKE.builds++;
  return tex;
}
/* 开机先烘当前时段（保证首帧就有正确的环境反射，而不是"第一帧是白天的"）。 */
scene.environment = bakeEnvFor(null);
scene.environmentIntensity = 1.0;
/** 由 12-env 调用：按预设烘（或复用缓存）并设为当前环境贴图。 */
export function setEnvPreset(preset){
  scene.environment = bakeEnvFor(preset);
  return ENV_BAKE.builds;
}
export const envBakeState = () => ({ builds:ENV_BAKE.builds, cached:[...ENV_BAKE.cache.keys()] });
/* 环境贴图只按**当前天光亮度 / 烘焙时天光亮度**缩放：这是廉价的连续调节，
   缓存负责"反射色对不对"，这个标量负责"整体亮度对不对"，两者互补。 */
export const lumOf = (c)=> 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
export const ENV_BAKE_LUM = (lumOf(new THREE.Color(0xA8BDD4)) + lumOf(new THREE.Color(0xE6E2D8))) * 0.5;
/* 天空球 + PMREM 烘焙（fromScene 同步走一遍 GPU 并编译天空 shader）是这一段的大头，
   单独钉一个刻度 —— 否则它会和下面 §3~§7 的函数声明混在同一帧 400ms 里看不出来。 */
bootMark('天空·PMREM');
