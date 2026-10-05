// 12e-precip: 雨/雪粒子 + 雨后檐滴与积水 —— 2026-10-05 从 12-env.js 整块搬出（纯搬家，除 1 处 export 前缀外逐字未改）。
/* 为什么单独一个文件：这两套是"天气在画面上最直接的表现"（GPU Points 粒子 + 逐帧 CPU 推进、
   檐口线常量 + 水珠自由落体 + 积水实例），与 12-env 的时段/季节/天气**状态机**是两件事。原块 490 行。
   ⚠️ 本文件**不能** import './12-env.js'（12-env 反过来 import 本文件 → 成环、启动期 TDZ，项目多次前科）。
   它需要 12-env 的**环境状态机 ENV**（updatePrecip 读 ENV.cur 的雨雪量与风、postRainK 读 ENV.cur.wetness），
   由 12-env 在自己 body 里调 bindPrecipEnv(ENV) 注入；注入的是**状态机对象**、读的是它的 .cur ——
   ⚠️ 别把 ENV.cur 传进来（那是个会被 mixInto 就地改写、但 setEnv 时会换的引用，读侧会静默读到旧的雨量）。
   ⚠️ 不对注入做兜底：没注入就读到 null 立刻崩（静默兜底只会变成"雨雪不出现"而无人察觉）。
   ⚠️ PRECIP_INDOOR 同时被 12-env 的积雪覆盖层（installSnow 的 uInLo/uInHi）借用 ⇒ 本文件必须导出它。 */
import { THREE } from '../vendor.js';
import { scene, camera, ACTIVE_QUALITY } from './02-scene.js';
import { groundHeight, insidePond } from './05-water.js';
import { TAU, mulberry32 } from './00-config.js';

/* ↓ 由 12-env.js 的 bindPrecipEnv(...) 注入（见文件头；沿用原名字 "ENV" 是故意的，搬来的代码零改动） */
let ENV = null;
export function bindPrecipEnv(env){ ENV = env; }

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
   ⚠️⚠️ **yTop 必须到"堂内天花标高"，不是随手取的一个数**（2026-10-01 老黄二次报
   "室内怎么也会有雪"，根因就在这里）：
     旧值 **5.0**，而堂内天花在 `1.24 + colH + 0.44`，`colH = H − 2.35`（04-buildings，
     H=7）⇒ **6.33**。房间净高 1.24~6.33，上半截 **5.0~6.33（占层高 26%）的雪没被杀掉**
     ⇒ 实测雪天"堂内、天花以下"仍剩 6 个粒子且**全在相机视锥内**，从敞开的门窗往里看
     就是"屋里下雪"。
     天花以上（>6.33）是屋顶空腔、被望板挡住，一并杀掉无害；再往上（>yTop）不动 ——
     那不是偷懒：剃到太高会把**屋顶上方**的雪也一起回收，从远处看屋顶那一块就成了
     "雪洞"。所以 yTop 取天花标高 + 一点点余量即可。
   ⚠️ 改这里只影响"哪些粒子会被回收"，**不消耗任何随机数**（铁律 1 安全）。
   ⚠️⚠️ **2026-10-02 三次复发，游廊/水榭补进禁区**（老黄三报"屋里还是有雪"）：
     旧注释曾写"水榭/游廊故意不列：纳风迎雪是天职"—— 老黄实测后推翻这个取舍
     （他看到的就是穿**顶**落下来的雪点，不是"迎面飘进来的雪"）。取证
     （outputs/_diag/repro-2026-10-02.mjs）：堂内 0（9-01 那次修复有效），
     但**游廊内 1~7 粒/帧、水榭亭顶下 8~14 粒/帧** —— 这两处没有禁区，粒子
     直接穿廊顶/亭檐出现在顶棚下方。
       yTop 取**各自檐口标高**（游廊 3.34 / 榭 4.47）+ 一点余量：粒子在 y>yTop 时不判，
       落穿 yTop 那一帧才杀 ⇒ 杀点紧贴顶棚下沿，从廊外/亭外看被檐口结构挡住，
       不会读出"半空中雪点凭空消失"；顶棚以上的雪不受影响（不出现"雪洞"）。
     ⚠️ 这组盒子**同时被积雪覆盖层借用**（installSnow 的 uInLo/uInHi，见那里的注释）——
       2026-10-02 老黄再报"冬季室内仍然被白雪覆盖"时定性为**表面铺雪**而非飘雪粒子：
       snowCover 只认"面朝上"，堂内地面/案几顶面照样铺白。 */
export const PRECIP_INDOOR = [
  /* 远香堂室内。XZ 覆盖整个建筑外廓（W20/D8 @ z=-12.8）只留 4cm 内缩 ——
     这 4cm 落在**墙体厚度里**（墙厚 0.3），粒子死在墙体内部、被墙挡住，看不出来；
     留一点内缩是为了避免正好卡在边界上的粒子反复"进-出"抖动。
     （旧值是内缩 0.4m，那会让房间前沿 0.4m 一圈成为漏网区。） */
  { x0: -9.96, x1: 9.96, z0: -16.76, z1: -8.84, yTop: 6.4 },
  /* 游廊四段（中线抄自下方 EAVE_LINES 的 CP，两侧各 ±1.9 略宽于檐口线 ±1.76 ——
     檐口线是顶的外沿，禁区覆盖整个廊顶投影；边界内外缩进顶的覆盖范围里）。 */
  { x0: 10.4,  x1: 13.4,  z0: -11.5,  z1: -7.7,   yTop: 3.45 },   // 段1：堂侧横廊
  { x0: 11.1,  x1: 15.3,  z0: -9.8,   z1: -1.6,   yTop: 3.45 },   // 段2：折角纵廊
  { x0: 13.0,  x1: 24.2,  z0: -3.7,   z1: 0.2,    yTop: 3.45 },   // 段3：东西向主廊
  { x0: 22.2,  x1: 25.8,  z0: -2.0,   z1: 15.2,   yTop: 3.45 },   // 段4：东端纵廊
  /* 水榭（荷风四面亭）：屋顶世界半宽 x5.1 / z5.6 @ (14.2, 6.4)，檐口高 4.47。 */
  { x0: 9.3,   x1: 19.1,  z0: 1.0,    z1: 11.8,   yTop: 4.55 },
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
  /* ⚠️⚠️ 2026-10-02 老黄四连否掉第一版："滴水慢一点、密度低一些、随机有几个瓦片
     下水处有水滴滴下来就好、水滴体积做小一点（像冰雹）"。
     第一版是 320 颗、半径 0.046（4.6cm 球 —— 真冰雹尺寸）、限速 4.6m/s、全线随机重生，
     观感就是"沿整条屋檐下冰雹"。
     ⇒ 改成**固定滴点**模型：
       · 数量 320 → 16 个"漏水处"（每 ~12m 檐口线一个，位置固定且每次加载相同 ——
         用独立 mulberry32 选点，不碰任何共享流；数量固定 ⇒ 实例 count 不漂，铁律 1 安全）；
       · 半径 0.046 → 0.023（视觉尺寸减半；仍比真实水珠大 —— 纯物理 5mm 在 10m 外
         不到 1 像素，0.023 是"看得见"的下限附近）；
       · 限速 4.6 → 2.0 m/s（第九轮再放宽到 6.5 —— 见下方下落段的注释：
         加速段要占得到 1/3 檐高，"越来越快"才看得见；全程 ~1.15s）；
       · 节奏：每滴落地后**该滴点**停 1.2~4.7s 再滴下一滴（原来是 0.12~1.27s 全线抢跑）。
     同一时刻空中最多 16 颗且分布在不同滴点 ⇒ 默认机位的视觉密度大幅下降。 */
  const N = 16;
  const geo = new THREE.SphereGeometry(0.023, 6, 5);
  const mat = new THREE.MeshBasicMaterial({ color: 0xE4EEF6, transparent: true, opacity: 0,
                                            depthWrite: false, fog: false });
  const im = new THREE.InstancedMesh(geo, mat, N);
  im.frustumCulled = false; im.visible = false; im.renderOrder = 18;
  scene.add(im);
  /* 滴点表：把檐口线总长**均分 N 段、每段内随机取一点**（均匀铺开 + 带随机，
     不会两滴点挤在同一段瓦上）。选点走独立种子流 —— 滴点是"布局类"决定，
     绝不能吃运行期 Math.random（会随加载时序漂、也不该每次刷新换瓦片）。 */
  const dj = mulberry32(20261004);
  const spots = [];
  for (let i = 0; i < N; i++){
    const tt = (i + dj()) * EAVE_LINES.total / N;
    let seg = EAVE_LINES.segs[0];
    for (const s of EAVE_LINES.segs){ if (tt >= s.t0 && tt <= s.t0 + s.len){ seg = s; break; } }
    spots.push({ seg, f: (tt - seg.t0) / seg.len });
  }
  const drops = [];
  for (let i = 0; i < N; i++) drops.push({ s: 0, f: 0, y: 0, vy: 0, wait: Math.random() * 3, live: false });
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
  return { im, mat, drops, N, spots, m, p, q, sv };
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
    const spot = D.spots[i];                 // 本滴的"漏水处"（固定，见 EAVE_DRIP 注释）
    if (!d.live){
      /* 停顿结束后重生：**仍从自己的滴点**落下一滴（不是全线随机）——
         "哪个瓦片在漏水"是固定的，节奏是随机的。 */
      d.wait -= dt;
      if (d.wait > 0) continue;
      d.s = spot.seg; d.f = spot.f; d.y = spot.seg.y + Math.random() * 0.06; d.vy = -0.2; d.live = true;
    } else {
      /* 自由落体。⚠️ 2026-10-02 第九轮（老黄："下落过程中应该越来越快，不是匀速的，
         现在雨滴下落速度太慢了点"）—— 旧限速 2.0 m/s 是上一轮"滴水慢一点"时压的，
         但它把加速段掐到只剩开头 0.2s（0.2s 就顶到 2m/s），之后 2.5s 全程匀速滑落，
         老黄看到的"匀速"完全属实。现在限速放宽到 6.5：
         · 加速段（0→6.5m/s）要 ~0.66s、掉 ~2.2m，占檐高的 1/3 ⇒ "越来越快"看得见；
         · 全程 6.4m 从 ~2.7s 缩到 ~1.15s ⇒ 整体也快了一倍多；
         · 不取真实末速 9m/s 是刻意的：6.4m 自由落体 1.14s 一闪而过，快到看不见。 */
      d.vy = Math.max(-6.5, d.vy - 9.8 * dt);
      d.y += d.vy * dt;
      if (d.y <= d.s.gy){ d.live = false; d.wait = 1.2 + Math.random() * 3.5; }
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
