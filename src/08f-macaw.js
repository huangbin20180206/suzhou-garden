// 08f-macaw.js — 由 08c-aquatic.js 按职责整块搬出（纯搬家，逐字节未改）。
// 金刚鹦鹉：落点表、换峰飞行、扇翅/理羽/抖翅/跳步的动作状态机与顶点权重驱动。
import { ENV } from './12-env.js';
import { THREE } from '../vendor.js';
export const MACAW_SPOTS = [
  /* ① 东假山真峰顶（全山东面最高石面，射线实测 y=6.20，默认机位直视可见） */
  [9.2, 6.20, 15.7],
  /* ② 东假山南肩岩台（y=4.75；与 ① 屏幕 81px、世界 2.1m）——
     ⚠️ 试过北脊 (10.2,5.43,11.2)：屏幕距够（105px），但**被游廊屋脊挡住**，
     默认机位下只露出半个身子 ⇒ 读作"鹦鹉站在屋顶上"（探针 _tmp-macaw-vis.mjs
     的遮挡检测：相机→脚面/胸高/头高三条射线都被屋面截住）。故改到南肩。 */
  [10.4, 4.746, 17.4],
  /* ③ 西假山峰顶（y=5.29；2026-10-14 起从东假山挪来，为了"换峰飞行"能看出 15m 跨度） */
  [-5.4, 5.287, 15.0],
  /* ④ 西假山北台（y=4.69；与 ③ 屏幕 99px、世界 2.6m）—— 常空着，给换峰飞行当备选 */
  [-7.4, 4.686, 13.4],
];
/* ⚠️⚠️ 第十五轮（老黄二次实拍"鹦鹉仍不对"）：落点本身其实已经到位 —— 射线复核
   （outputs/_diag/macaw-final-check.mjs，spring/clear/noon 默认机位）三只脚底
   gap = 0 / −0.004 / 0，① 只低于 1.4m 邻域内的峰顶 0.013m，确实站在最高石面上。
   但 8× 放大图暴露两个**读感**问题（位置对 ≠ 看得出来）：
     ① ② 原为 (9.2,15.7) 与 (9.6,15.7)：只差 0.4m，而且**几乎正对视线方向**
     （机位 (−20,17,32)，视线水平分量 ≈ (0.518,−0.855)）⇒ 屏幕上只差 7px，
     两只糊成一只"双头鹦鹉"。
   ⚠️ 教训：峰顶选点要按**屏幕间距**筛，不能按世界间距 —— 世界 0.4m 里沿视线方向
   的那 0.35m 投到画面上等于 0。
   ⇒ 本轮把 ② 挪到 (9.97, 6.114, 16.17)（沿屏幕 x 方向挪开，石面只低 0.086m），
     与 ① 在屏幕上拉开 27px（1208 → 1235）；③ 不动（**仅指本轮**；2026-10-14 ③ 已因"换峰飞行看不出"挪去西假山顶，见下方该点注释）。
   ⚠️ 峰顶脊约 1.5m 宽、屏幕横向量程只有约 40px，三只不可能拉得很开：试过
   (10.4,16.6)（石面 4.92）与 (10.6,16.2)（石面 5.06）都会掉出"山顶"，不取。 */
/* ══ 金刚鹦鹉的作息与动作（2026-10-05 第十六轮）══════════════════════════
   老黄三条原话：①"鹦鹉无论白天黑夜还是刮风下雨都在假山上不动，这个不合理"
   ②"这个鹦鹉做得太大了，和人物的体积大小比夸张了一些" ③"我还希望能给鹦鹉加一个
   动作…最好不要我帮忙"。

   ⚠️⚠️ 这个 GLB 是**单节点单网格**（实测 nodes:1 / meshes:1 / primitives:1 /
   skins:0 / animations:0）—— 没有骨骼、没有动画轨道 ⇒ 做不出"只有翅膀动"，
   所有动作只能施加在 holder（整只）的位移/旋转上。下面这套是按**远处一眼读得出**
   挑的，不是按"像不像真鸟"挑的。
   ① 作息：白天栖峰顶，**夜与雨雪天不在这里**（鹦鹉是日行性、雨里会进林子躲）。
      判据用**连续的 ENV.hour**（不是离散的 ENV.time）⇒ 拖时辰滑杆时会自然归巢；
      走/回都带"起飞抬升 + 振翅 / 落下来收翅"，不是"啪一下隐藏"。
   ② 动作：呼吸起伏 / 缓慢张望 / 急张望 / 甩尾 / 抖翅 / 理羽 / 小跳换向。
   ⚠️ 事件用逐鸟**确定性**伪随机 h01()，不消耗 rnd/rr ⇒ layout-fingerprint 不受影响、
      探针可复现（运行时动效本来允许 Math.random，能用确定性就不用随机）。 */
export const MACAWS = [];
export const MACAW_COUNT = 3;                      // 鸟数（落点可以更多：多出来的空着给飞行用）
export const MACAW_LIFT = 2.4;                       // 起飞/落下时抬升的高度（m）
export const MACAW_CRUISE = 1.6;                     // 换点巡航弧顶额外高度（m）
export const MACAW_TAKEOFF = 0.35, MACAW_LANDING = 0.55; // 内部飞行 起/落时长（秒）
export const MACAW_FLY_DUR = 1.4;                    // 内部飞行巡航时长（秒）
export const MACAW_DEPART = 0.55, MACAW_ARRIVE = 0.75;
/* ⚠️ flutter 时长 0.42→0.55：与下面"整段只走 2 个周期"配套 —— 2/0.55 = 3.6Hz，
   60fps 下每帧相位 0.38rad、30fps 下 0.76rad，都在"看得出来是扇动"的采样率上。 */
export const MACAW_EV = { tail:0.38, flutter:0.55, preen:1.15, hop:0.52 };
/* ── 翅膀扇动（2026-10-23，老黄："起跳/换峰飞行翅膀都不动"）──────────────────
   Macaw.glb 是单网格无骨骼，翅膀**折叠贴在体侧** —— 顶点实测（outputs/_diag/macaw-wing-map.mjs）：
   头在 +z 高处（|x|≤0.23、y 到 0.95）、尾在 −z 底部垂下、两片翅膀从肩(y≈0.45, z≈0.5)
   沿体侧垂到翼尖(y≈−0.85, |x|≈0.27)。所以此前的"振翅"只有整身 roll
   （Math.sin(flightT*26)）—— 翅膀几何从未参与，起跳/飞行时两片翅膀僵死。
   修法照 installHorseRig 的伪蒙皮路子：几何烘 **aWing** 顶点权重（带符号，0=身体、1=翼外缘），
   onBeforeCompile 里绕**前向轴(z)、过肩点 y=pivotY** 旋转。两个关键取舍：
   ① 权重对 y>0.48 / z>0.52 **双重淡出** —— 只按 |x| 判的话，头颈(|x|≤0.23)会带 ~0.28
      的权重跟着扇，实测读作"脖子断了"；
   ② 扇翅是**抬-收式**（0→幅→0，用 0.5−0.5·cos），不做 ±过零摆动 —— 折叠翅的负角
      会把翼尖扫进身体里（翼尖离肩轴几乎正下方 1.27，负角横穿躯干）。 */
export const MACAW_WING = {
  pivotY: 0.42,                 // 肩关节高度（顶点量测，旋转不动点）
  /* ⚠️ 2026-10-25 老黄："鹦鹉飞行的时候还是没有展开翅膀"。
     原因是**基准角是 0**：旧写法 ampFly·(0.5−0.5cos) 只把折叠翅从"贴着体侧"抬到最多
     0.85rad(49°)，读起来是"翅膀在抖"，不是"张开"。折叠翅本身很长（肩 y0.45 → 翼尖 −0.85），
     绕肩转到接近水平就是一副长翼，所以改成 **在 baseFly 上扇动**：
     飞行时 1.15±0.35rad ⇒ 46°~86°（基本水平），落地/栖停仍回到 0（收翅）。 */
  baseFly: 1.15,
  ampFly: 0.35,                 // 在基准角上做 ± 扇动（不再是 0→幅）
  freqFly: 16,                  // 飞行扇翅角频率（2.55Hz；24fps 每帧 0.67rad，不越采样极限）
  ampFlutter: 0.35, ampHop: 0.30,
  /* 18 → 26（2026-10-25）：baseFly 1.15 之后收翅的尾巴更长 —— 落地后一瞬间还能剩 0.06rad，
     把 macaw-wing-guard 的"rest 时收翅 ≤0.06"顶成时红时绿（两次跑分别 0.062 / 0.012）。
     26 仍然平滑（时间常数 38ms），但落地 0.2s 内就归零。 */
  follow: 26,
};
/* 确定性伪随机 ∈ [0,1)：与全局随机流无关 */
export function h01(a, b){
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
/* 该不该栖在峰顶：白天 + 没在下雨下雪。导出是为了让门禁能直接断言"什么时候该在"。 */
export function macawWantPerch(){
  /* 6.5~18.2 时：晨 7.5 已经在、暮 17.5 还在、夜 21.5 已归林；日出前/日落后不在。 */
  if (!(ENV.hour >= 6.5 && ENV.hour <= 18.2)) return false;
  const w = ENV.weather, rain = (ENV.cur && ENV.cur.rainAmount) || 0;
  if (w === 'snow' || w === 'storm' || w === 'thunder') return false;
  return rain < 0.08;
}
/* 每帧推进：起飞/落地/栖停三态 + 栖停小动作。由 11-loop 调用（那里已经有 dt/t）。 */
export function updateMacaws(dt, t){
  if (!MACAWS.length) return;
  const want = macawWantPerch();
  for (const m of MACAWS){
    const h = m.holder;
    if (m.mode === 'perch' && !want){ m.mode = 'depart'; m.mt = 0; }
    else if (m.mode === 'away' && want){ m.mode = 'arrive'; m.mt = 0; }
    m.mt += dt;
    /* 翅膀角：把上一帧各分支写入的**目标值**（m.wingT）以固定速率跟随并写进 uniform。
       放在循环顶而不是各分支尾部 —— 三个飞行分支都以 continue 收场，这里统一做
       状态切换的缓动，落地收翅/起飞展翅都不会"啪"一下跳变。 */
    m.wingV += ((m.wingT || 0) - m.wingV) * Math.min(1, dt * MACAW_WING.follow);
    if (m.matWing) m.matWing.value = m.wingV;

    /* ── 内部换点飞行：白天在 MACAW_SPOTS 各峰顶间弧线移动 ──
       ⚠️⚠️ 2026-10-14 运动学校对（macaw-guard：roll/pitch ≤8、yaw ≤22 rad/s，按仿真时钟
       计量、与帧率无关）。三处不变量，改前必读：
       ① 航向取**最短角**（见触发处 flyYaw）：东↔西原始 atan2 差可达 7.2rad，直接混
          会让起飞段 yaw ≈41 rad/s；
       ② 振翅相位用全程累积 flightT，**不随 mt 复位**：mt 每换态归零，sin(mt*26) 会从
          sin(36.4)=−0.96 跳回 0，单帧 Δroll≈0.17rad≈10.3 rad/s（撞 roll≤8）；
       ③ 俯仰沿**路径解析斜率**连续：起降段端点 = 巡航贝塞尔在 v=0/1 的斜率，换态处
          严格相等（老写法 takeoff 收尾 −0.34、巡航起步 +0.24，单帧跳 0.58rad≈34）。
       ④ 弧顶高 flyYMid 在 trigger 处**算一次存字段**、三分支共用：距离缩放
          （dist/8 钳 0.2~1）。同源是闭合性的构造保证 —— 各分支各算一遍正是
          41.7 rad/s 那类"两处公式抄不一致"bug 的成因。
       ⚠️ 飞行时长常数 MACAW_TAKEOFF/FLY_DUR/LANDING（0.35/1.4/0.55）不许动 ——
          上面三处连续性全靠这组时长闭合。**节拍阈值不在此列**：它在下方 trigger 处，
          2026-10-14 由"8~22s/次"改为"首飞 10/14/18s、之后 60~120s/次"（改因：
          旧节拍下 40s 窗末必然有鸟在天上，macaw-guard ① 连挂）。
       ⚠️⚠️ 改节拍必须重跑 macaw-guard **两遍**且两遍都得绿 —— ① 是节拍稳定性判据，
           单遍绿可能是运气（旧节拍下线前实测两遍全挂在①）。 */
    if (m.mode === 'takeoff'){
      m.flightT += dt;
      const u = Math.min(1, m.mt / MACAW_TAKEOFF);
      const lift = u * u;                               // 加速上升
      const h0 = m.flyFrom.y + MACAW_LIFT;
      const yMid = m.flyYMid;                       // 与 cruise/land 同源（闭合性靠它）
      const pitchUp = Math.atan2(2 * (yMid - h0), Math.max(m.flyDist, 0.001)); // 巡航起步斜率
      h.position.set(m.flyFrom.x, m.flyFrom.y + lift * MACAW_LIFT, m.flyFrom.z);
      /* 俯仰用 smoothstep 斜坡（不是 u²：u² 末端速率 2/0.35，短距腾跃时 pitchUp≈1.3rad
         ⇒ 7.4 rad/s 贴线；smoothstep 末端速率 1.5/0.35 ⇒ ≤5.6，留余量） */
      h.rotation.set(pitchUp * (u * u * (3 - 2 * u)) + 0.08 * Math.sin(m.flightT * 26 + 1.1) * lift,
                     m.yaw + (m.flyYaw - m.yaw) * lift,
                     Math.sin(m.flightT * 26) * 0.18 * lift);
      /* 扇翅相位用 flightT（全程累积、换态不复位 —— 与 roll 同一来源，见上方不变量②） */
      m.wingT = MACAW_WING.baseFly + MACAW_WING.ampFly * Math.cos(m.flightT * MACAW_WING.freqFly + m.phase);
      if (u >= 1){ m.mode = 'cruise'; m.mt = 0; }
      continue;
    }
    if (m.mode === 'cruise'){
      m.flightT += dt;
      const u = Math.min(1, m.mt / MACAW_FLY_DUR);
      const v = u * u * (3 - 2 * u);                    // smoothstep：起降缓、中段匀速（读作巡航）
      const p0 = m.flyFrom, p3 = m.flyTo;
      const h0 = p0.y + MACAW_LIFT;
      const h3 = p3.y + MACAW_LIFT * 0.6;
      const x = p0.x + (p3.x - p0.x) * v;
      const z = p0.z + (p3.z - p0.z) * v;
      const yMid = m.flyYMid;                       // 与 takeoff/land 同源（闭合性靠它）
      const y = (1 - v) * (1 - v) * h0 + 2 * (1 - v) * v * yMid + v * v * h3;
      h.position.set(x, y, z);
      /* 俯仰 = 贝塞尔解析斜率：端点与起降段闭合，且不会像差分那样在 u→1 退化成 0 跳变 */
      const dydv = -2 * (1 - v) * h0 + 2 * (1 - 2 * v) * yMid + 2 * v * h3;
      h.rotation.set(Math.atan2(dydv, Math.max(m.flyDist, 0.001)) + 0.08 * Math.sin(m.flightT * 26 + 1.1),
                     m.flyYaw,
                     Math.sin(m.flightT * 26) * 0.18);
      m.wingT = MACAW_WING.baseFly + MACAW_WING.ampFly * Math.cos(m.flightT * MACAW_WING.freqFly + m.phase);
      if (u >= 1){ m.mode = 'land'; m.mt = 0; }
      continue;
    }
    if (m.mode === 'land'){
      m.flightT += dt;
      const u = Math.min(1, m.mt / MACAW_LANDING);
      const lift = 1 - (u * u);                         // 减速下降
      const h3 = m.flyTo.y + MACAW_LIFT * 0.6;
      const yMid = m.flyYMid;                       // 与 takeoff/cruise 同源（闭合性靠它）
      const pitchDn = Math.atan2(2 * (h3 - yMid), Math.max(m.flyDist, 0.001)); // 巡航收尾斜率（负）
      h.position.set(m.flyTo.x, m.flyTo.y + lift * MACAW_LIFT * 0.6, m.flyTo.z);
      const blend = 1 - lift;                           // 0→1：航向回正到 yaw0
      /* 俯仰从巡航收尾斜率 pitchDn 缓回 0（不是反向！第一版写成 0→pitchDn，
         落地一瞬从 pitchDn 跳回 0，实测 pitch 角速度 41.7 rad/s，撞 roll/pitch≤8）。
         ⚠️ 收尾必须随 lift（=1−u²）而不是 smoothstep：smoothstep 在 u=1 的导数
         还有 0，但第一版收在 u=1 的值恰是 pitchDn≠0，接栖停 rest 的 pitch=0
         会再跳一次（实测 9.4 rad/s）。与 roll/wobble 同用 lift ⇒ u=1 三项全为 0，
         与栖停的静止基准逐项相等，落地无跳。 */
      h.rotation.set(pitchDn * lift + 0.08 * Math.sin(m.flightT * 26 + 1.1) * lift * lift,
                     m.flyYaw + (m.yaw0 - m.flyYaw) * blend,
                     Math.sin(m.flightT * 26) * 0.18 * lift);
      /* 落地段扇翅随 lift 收 —— 触地时目标归 0，配合循环顶的缓动自然收拢 */
      m.wingT = (MACAW_WING.baseFly + MACAW_WING.ampFly * Math.cos(m.flightT * MACAW_WING.freqFly + m.phase)) * lift;
      if (u >= 1){
        m.base.copy(m.flyTo); m.mt = 0;
        if (!want){ m.mode = 'depart'; }   // 飞行期间天气突变：落到目的地再走，不从半空瞬移
        else {
          m.mode = 'perch'; m.ev = 'rest'; m.c++;
          m.evT = 1.2 + h01(m.i * 7 + 3, m.c) * 2.6;
          m.yaw = m.yawT = m.yaw0;
        }
      }
      continue;
    }

    if (m.mode === 'depart' || m.mode === 'arrive'){
      const dur = m.mode === 'depart' ? MACAW_DEPART : MACAW_ARRIVE;
      const u = Math.min(1, m.mt / dur);
      const e = u * u;                                   // 起飞加速 / 落地是同一条曲线的反向
      const lift = m.mode === 'depart' ? e : 1 - e;
      h.visible = true;
      h.position.set(m.base.x, m.base.y + lift * MACAW_LIFT, m.base.z);
      /* 振翅：绕自机纵轴高频滚转 + 抬头；越在空中越平（俯仰按 lift 给） */
      /* ⚠️ 振翅频率 42→26 rad/s（6.7→4.1Hz，与"抽搐"那条同源）：42 在 30fps 下每帧
         1.4rad、已经走出可采样范围；4.1Hz 才是金刚刚鹦鹉那种**慢而深**的扇翅节奏。 */
      h.rotation.set(-0.34 * lift + 0.12 * Math.sin(m.mt * 26 + 1.1),
                     m.yaw0 + Math.sin(m.mt * 0.7 + m.phase) * 0.12,
                     Math.sin(m.mt * 26) * (0.26 + 0.34 * lift));
      m.wingT = MACAW_WING.baseFly + MACAW_WING.ampFly * Math.cos(m.mt * MACAW_WING.freqFly + m.phase);
      if (u >= 1){
        if (m.mode === 'depart'){ m.mode = 'away'; h.visible = false; }
        else {
          m.mode = 'perch'; m.ev = 'rest'; m.c++;
          m.evT = 1.2 + h01(m.i * 7 + 3, m.c) * 2.6;
          m.yaw = m.yawT = m.yaw0;
        }
      }
      continue;
    }
    if (m.mode === 'away'){ h.visible = false; continue; }

    /* ── 栖停：事件驱动（含内部换点起飞） ── */
    h.visible = true;
    /* 白天偶尔换峰：落点只在 MACAW_SPOTS 内跳，弧线往返。
       ⚠️ 只在 ev==='rest'（静止小动作，pitch/roll 基准都是 0）时触发 —— 若从 flutter/
       preen 的半空中接飞行，起手一帧就要补上人家 0.24rad 的滚转 ⇒ Δroll≈14 rad/s，
          直接撞 macaw-guard 的 roll≤8。等当前小动作做完再走，肉眼无差别。 */
    /* ⚠️⚠️ 2026-10-20（老黄："金刚鹦鹉不会飞了吗？"）：**计时器改为整个栖停期持续累加**。
       旧写法 perchT 只在 ev==='rest' 的短窗里累加 —— rest 每轮只有 2.4~6s、事件序列又是
       确定性伪随机，个别鸟长时间轮不到 rest ⇒ 阈值迟迟攒不满，实测拖到 5 分钟都不飞。
       改后：perchT 与墙钟同步累加；首飞 6/8/10s（观众一进园 10 秒内必见真飞），
       之后仍 60~120s 一次（不加密 —— 加密会让 40s 门禁窗末有鸟在天上，macaw-guard ①
       必红，"改了尺子就得重新量"，这条不动）。
       **起飞判定仍等 ev==='rest'**（半空接飞行会撞 roll≤8，见上方原注释）——
       计时攒满后做完当前小动作就走，与旧节拍同衔接，肉眼无差别。 */
    if (want){ m.perchT = (m.perchT || 0) + dt; }
    if (want && m.ev === 'rest'){
      /* 节拍（2026-10-14，Chief 派单）：首飞早、之后稀。
         · 首飞阈值按鸟错开 6/8/10s（2026-10-20 由 10/14/18 收紧，配套上面的持续累加；
           末鸟 10s 起飞 + 2.3s 航程 ⇒ 12.3s 全员落定，40s 窗末余 27.7s ≥ 25s）
           —— 观众一进园就马上看得到真飞，且 40s 门禁窗内一定有飞行帧可量飞行姿态安全性（② 才有的可测）；
         · 之后转 60~120s 一次（真鹦鹉久栖偶飞）⇒ 40s 窗末有 25s+ 全员栖停
           余量，macaw-guard ①「窗末 3 只全 perch」才立得住。
         ⚠️ 为什么必须"首飞早+之后稀"：日常 8~22s 一飞时，任意时刻约 35% 概率
           有鸟在天上（单鸟在飞占比 2.3/(8~22+2.3)≈12~22%×3 只），40s 窗末
           撞上是常态 —— 门禁 run1/run2 连挂 ①（perch/cruise/takeoff）就是这个。
         ⚠️ 阈值全走确定性 h01（与全局随机流无关、探针可复现）；m.c 计数逻辑
           与飞行时长常数 0.35/1.4/0.55 都不动。*/
      const thr = m.flown ? 60 + h01(m.i * 3 + 1, m.c) * 60 : 6 + m.i * 2;
      if (m.perchT > thr){
        m.perchT = 0;
        /* ⚠️⚠️ 2026-10-20：**目标点必须避开"别人已经站着的位置"**。
           旧写法只排除了"自己脚下那点" ⇒ 一只鸟飞到西峰时，若另一只正好在西峰，
           两只就叠在同一处（老黄："两座假山的顶上都会重叠成一只"）。
           现在排除三类：自己脚下、别的鸟当前站着的地方、别的鸟**正在飞往**的地方。
           （落点集已扩到 4 个 ⇒ 永远至少有一个空位，飞行不会因为"无处可去"而停摆。） */
        const taken = (s) => {
          for (const o of MACAWS){
            if (o === m) continue;
            const at = (o.mode === 'takeoff' || o.mode === 'cruise' || o.mode === 'land') && o.flyTo
              ? o.flyTo : o.base;
            if (Math.abs(at.x - s[0]) <= 0.05 && Math.abs(at.z - s[2]) <= 0.05) return true;
          }
          return false;
        };
        const others = MACAW_SPOTS.filter(s =>
          (Math.abs(s[0] - m.base.x) > 0.01 || Math.abs(s[2] - m.base.z) > 0.01) && !taken(s));
        if (others.length){
          const t = others[Math.floor(h01(m.i * 3 + 2, m.c) * others.length)];
          m.flyFrom = new THREE.Vector3(m.base.x, m.base.y, m.base.z);
          m.flyTo = new THREE.Vector3(t[0], t[1], t[2]);
          m.flyDist = Math.hypot(m.flyTo.x - m.flyFrom.x, m.flyTo.z - m.flyFrom.z);
          /* 弧顶高：基础 1.6m，按距离缩（短跳配小弧）。算一次存字段，三个飞行分支
             共用同一个 yMid —— 端点闭合靠"同源"保证，不靠各分支重复算对。
             ⚠️ 为什么必须缩放：①② 是同峰并肩两点、相距仅 0.9m。恒 1.6m 弧高时，
             0.9m 水平距配 1.6m 落差 ⇒ 弧顶俯仰扫过率 ≈9.9 rad/s（离线逐帧仿真
             1/60 实测 8.61，上门禁因真实 dts 更细还要高约 1），撞 macaw-guard 的
             pitch≤8；且 0.9m 挪 1.6m 弧视觉上像气球，不像鸟。
             跨山（≈15m）时 dist/8>1 钳到 1 ⇒ 弧高仍是满值 1.6m，长飞行动轴不变。 */
          m.flyYMid = Math.max(m.flyFrom.y + MACAW_LIFT, m.flyTo.y + MACAW_LIFT * 0.6)
                      + MACAW_CRUISE * Math.min(1, Math.max(0.2, m.flyDist / 8));
          /* 航向取最短角：atan2(sin(dy),cos(dy)) 把差值折回 [-π,π]。
             东→西原始差 ≈−7.2rad（绕整圈 413°、峰值 yaw 角速度 ≈41 rad/s
             超 macaw-guard 22；且鸟会在空中多转一圈才对准航向）。 */
          const dYaw = Math.atan2(m.flyTo.x - m.flyFrom.x, m.flyTo.z - m.flyFrom.z) - m.yaw;
          m.flyYaw = m.yaw + Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
          m.flightT = 0;
          m.flown = 1;                                    // 首飞之后转"稀"节拍（见上）
          m.mode = 'takeoff'; m.mt = 0;
          continue;
        }
      }
    }
    m.evT -= dt;
    if (m.evT <= 0){
      const r = h01(m.i * 7 + 3, m.c * 5 + 1);
      m.ev = r < 0.44 ? 'rest' : r < 0.62 ? 'look' : r < 0.74 ? 'tail'
           : r < 0.87 ? 'flutter' : r < 0.95 ? 'preen' : 'hop';
      m.c++;
      const g = (k) => h01(m.i * 7 + 3, m.c * 11 + k);
      if (m.ev === 'rest'){ m.evT = 2.4 + g(1) * 3.6; m.yawT = m.yaw0 + (g(2) - 0.5) * 0.9; }
      else if (m.ev === 'look'){ m.evT = 0.5 + g(1) * 0.5; m.yawT = m.yaw0 + (g(2) - 0.5) * 1.6; }
      else if (m.ev === 'preen'){ m.evT = MACAW_EV.preen; m.yawT = m.yaw0 + (g(2) - 0.5) * 0.5; }
      else if (m.ev === 'tail'){ m.evT = MACAW_EV.tail; }
      else if (m.ev === 'flutter'){ m.evT = MACAW_EV.flutter; }
      else { m.evT = MACAW_EV.hop; m.yawT = m.yaw + (g(1) > 0.5 ? 1 : -1) * (1.2 + g(2) * 0.9); }
    }
    /* 偏航缓动（张望/转身共用）：急张望与小跳用更短的时间常数 —— 才是"急" */
    let dy = m.yawT - m.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    /* 转角时间常数：急张望 0.10（"急"是它的本意）/ 小跳换向 0.15（原与 look 共用 0.10，
       实测单帧 Δyaw 到 0.78rad≈45°，转身像被抽了一鞭）/ 其余 0.34。 */
    m.yaw += dy * (1 - Math.exp(-dt / (m.ev === 'look' ? 0.10 : m.ev === 'hop' ? 0.15 : 0.34)));

    let y = m.base.y + 0.010 * Math.sin(t * 2.2 + m.phase), pitch = 0, roll = 0;
    if (m.ev === 'flutter'){
      /* ⚠️⚠️ 2026-10-05 修"抽搐"（老黄："鹦鹉的动作改得再自然一些，现在有时候会看到
         鹦鹉像抽搐了几下"）：原式 `roll = sin(u*34)*0.42` —— u 每帧走 dt/0.42，
         60fps 下**每帧相位 +1.35rad**、本机 24fps 下 **+3.4rad**，远超采样极限 ⇒
         采出来的序列是**随机的乱抖**，读作"抽搐"而不是"抖翅"。
         实测逐帧录（outputs/_diag/macaw-twitch.mjs，45s/1025 帧）：flutter 的单帧
         Δroll 高达 **0.80rad**，而 rest / look / preen / tail 全在 0.05 以下 —— 差 16 倍，
         元凶唯一。
         修法＝把"频率"当成**帧率可承载的量**来定：整段只走 **2 个周期**
         （0.55s ⇒ 3.6Hz；60fps 每帧 0.38rad、30fps 0.76rad，都是"看得出在扇"的采样率），
         幅度同时收一半（0.42→0.24rad ≈ ±14°）。金刚刚鹦鹉本来就是**慢而深**的扇翅
         （真鸟 3~4Hz），慢下来反而更像鸟。 */
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.flutter, env = Math.sin(Math.PI * u);
      const ph = u * Math.PI * 4;                        // 整段 2 个周期
      roll = Math.sin(ph) * 0.24 * env;
      pitch = -0.06 * env + Math.sin(ph + 0.7) * 0.05 * env;
      y += 0.030 * env;                                  // 抖翅时轻轻离枝
    } else if (m.ev === 'preen'){
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.preen, env = Math.sin(Math.PI * u);
      pitch = 0.62 * env; y -= 0.018 * env; roll = 0.10 * env * Math.sin(u * 9.0);
    } else if (m.ev === 'tail'){
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.tail;
      pitch = -0.22 * Math.sin(Math.PI * u);
    } else if (m.ev === 'hop'){
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.hop;
      y += 0.055 * Math.sin(Math.PI * u);
      pitch = -0.12 * Math.sin(Math.PI * u);
    }
    /* 翅膀目标（栖停段）：默认收拢；抖翅/原地小跳给短促的抬-收（外层包络与身体同相位）。
       原地起跳 = 0.52s 内两扇（0.5−0.5·cos(u·4π)）—— 老黄指认的两个"翅膀僵死"场景之一。 */
    let wTgt = 0;
    if (m.ev === 'flutter' || m.ev === 'hop'){
      const u = 1 - Math.max(0, m.evT) / MACAW_EV[m.ev];
      wTgt = (m.ev === 'flutter' ? MACAW_WING.ampFlutter : MACAW_WING.ampHop)
           * Math.sin(Math.PI * u) * (0.5 - 0.5 * Math.cos(u * Math.PI * 4));
    }
    m.wingT = wTgt;
    h.position.set(m.base.x, y, m.base.z);
    h.rotation.set(pitch, m.yaw, roll);
  }
}
/* 落点集（门禁要量"两只会不会叠在一起" ⇒ 需要知道**所有候选落点**，
   不能只看当前站着的那几只）。 */
export function macawSpots(){ return MACAW_SPOTS.map(s => [s[0], s[1], s[2]]); }
/* 显式暴露给门禁（按项目规矩：可判定的量不靠 traverse 猜）。 */
export function macawState(){
  return MACAWS.map((m) => ({
    mode: m.mode, visible: m.holder.visible, ev: m.ev,
    yaw: +m.holder.rotation.y.toFixed(3),
    pitch: +m.holder.rotation.x.toFixed(3),
    roll: +m.holder.rotation.z.toFixed(3),
    lift: +(m.holder.position.y - m.base.y).toFixed(3),
    wing: +((m.matWing && m.matWing.value) || 0).toFixed(3),   // 扇翅角（rad）：门禁量"翅膀动了没有"就用它
    at: [+m.base.x.toFixed(2), +m.base.y.toFixed(2), +m.base.z.toFixed(2)],
  }));
}
// 乌龟：池中缓游
