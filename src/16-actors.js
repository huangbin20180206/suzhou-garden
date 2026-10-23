// 16-actors: 把 AI 生成的半写实人物接进场景（2026-10-21 · P1 / 2026-10-22 · P2 步态）
//
// 设计取舍（与 15-stable 的马同一套）：
//   · 每个实例**单独 parse 一份 GLB**，不用 clone —— clone 会共享 Skeleton，
//     多个人物会共用一套骨（vendor 里也没有 SkeletonUtils）。
//   · 加载成功才隐藏程序化替身；失败/离线时替身照常站着，场景不空。
//   · 不烘焙动画：走路由程序化步态驱动（同 08b 的 driveWalkers 一套口径 —— 0.42m/步），
//     骨骼只写四元数、root 只写 position.y / rotation.y。
//   · 动作只写骨骼四元数（以绑定姿态为基准），不改 mesh / 不改材质贴图。
//
// ── 裙摆（P2 更正 2026-10-22）─────────────────────────────────────────────────
// P1 的注释写着"裙摆权重挂在腿上，走动会撕，等补裙骨"。实测（outputs/_diag/
// actor-stride.mjs：大腿 ±0.38rad + 小腿 −0.18rad，两位人物前/侧各一张）**没有撕**：
// 长袍/长裙是锥面，跟着大腿摆、下摆随脚露出鞋面，读数正常。所以走路不必等裙骨；
// 幅度按 GAIT.amp=0.27 收着用（≈15.5°），比测试的 0.38 更保守。
// 真正需要裙骨的是**极大幅度**（抬腿/坐/跪），那些动作继续押后。

import { THREE, GLTFLoader } from '../vendor.js';
import { scene, renderer } from './02-scene.js';
import { groundHeight } from './05-water.js';
import { markCasterBoxDirty } from './09-lights.js';
import { figures } from './08b-figures.js';
import { PROP_SPOTS, QIN_LOW_SEAT, SEAT_SPOTS } from './14-props.js';
import { STABLE_ROAD_PTS } from './15-stable.js';
import { MAT } from './01-materials.js';
import { HOOKS } from './00-config.js';

const ACTORS = [];
let _built = false;
let _t = 0;

/* ── 步态常数（口径对齐 08d 的 WALK_STRIDE=0.42 / WALK_BOB=0.028）────────────
   相位的推进按**走过的距离**算，不按时间：站下/转身/上坡都不会出现"脚在原地划"。
   步长 0.42m 时，一条腿一个完整周期 = 两步 = 0.84m ⇒ p = 距离/0.42 × π。 */
const STEP_LEN = 0.42;
const GAIT = {
  amp: 0.27,        // 大腿前后摆（≈15.5°；测试到 0.38 裙面仍干净，留余量）
  knee: 0.40,       // 摆动期屈膝（负号 = 小腿往后勾）
  foot: 0.12,       // 踝：跟落/趾离的小幅补偿
  bob: 0.022,       // 重心起伏（比散步者 0.028 小一号 —— 人物脚是真的在动）
  hipYaw: 0.055,    // 骨盆扭转
  hipRoll: 0.030,   // 骨盆侧倾（支撑腿一侧高一侧低）
  chestYaw: 0.045,  // 上身反向扭转
  turn: 2.1,        // 原地转身角速度 rad/s（比散步者 4.0 慢：真人不甩头）
};
const TURN_GATE = 0.55;   // 朝向偏差超过这个就"站住转身"，不再平移

/* ── 跪坐（P2 坐姿）参数：与 research/characters/README.md §12.2 的出图一致 ─────────
   drop  = 髋部骨骼下沉量（**不动 holder**，动 Hips 骨：holder 原点在地面，移它整只人下沉）；
   knee  = 小腿屈曲（这套架子**正号才是往后折**，负号会往前折成"脚朝天"）；
   lift  = 前襟绕世界横轴抬起（负号 = 往前翻；实测 Skirt0a 局部 X 负 = 前翻）；
   skirtLen/Rad = 裙骨沿骨长压缩、径向撑开（下摆铺地）。 */
const KNEEL = {
  drop: 0.46, thigh: 0.06, knee: 1.62, foot: -1.30, footScale: 0.04,
  spine: 0.03, skirtLen: 0.55, skirtRad: 1.45, lift: 1.15, kneeSwap: 0.96,
};

/* ── 坐凳（P2 第二件坐姿：石桌对弈）──────────────────────────────────────────
   与跪坐是两套参数，不是"跪坐的半个"：跪坐是小腿折到身下（髋贴地 0.46），
   坐凳是大腿抬平、小腿垂下来（髋在凳面 0.452 之上）。两者共用同一批裙骨通道。
   实测基数（actor-go-measure.mjs，scholar 1.72m）：
     Hips 在原点以上 **0.937**、凳面 0.452 + 骨盆半径 ≈ 0.09 ⇒ drop ≈ 0.395；
     大腿骨 0.41 / 小腿骨 0.383 —— 髋 0.542（相对地面）抬起平放 ⇒ 膝 0.542、
     踝 0.159，正好落在凳面上方、脚掌踩地。
   lean 是**必需的**，不是风格：凳心离盘心 1.09m，而肩→腕只有 0.489m ⇒
   不往前倾（把肩送到桌沿）手根本够不到盘面（actor-go-measure 的几何账）。
   ⚠️ 腿的角度与 drop 是一组数：只改 drop 会让脚离地/入地，必须一起看脚尖高度。 */
const SIT = {
  /* foot 取 0：大腿 −1.44 与小腿 +1.50 的净转角 ≈ +0.06（几乎与站姿同向），
     脚掌本来就是平的，再补一个踝角反而会翘脚尖。 */
  /* lean 0.52 / headDown 0.46：实测（actor-go-solve）lean 0.40 时腕离盘面还差
     0.27~0.42m —— 凳心到盘心 1.09m，而肩→腕只有 0.489m。所以坐位再往桌心挪
     0.14（坐凳前沿，仍是坐着）+ 上身倾到 0.52，两手才够得到盘边。 */
  drop: 0.395, thigh: 1.44, knee: 1.50, foot: 0.0, lean: 0.52, headDown: 0.46,
  skirtLen: 0.60, skirtRad: 1.35, lift: 1.30, kneeSwap: 1.00,
};

/* ── 对弈（坐凳 + 一只手落到盘面）────────────────────────────────────────────
   两边的角度各自反解（outputs/_diag/actor-go-solve.mjs）：这套骨架左右手臂
   **本来就不对称**，镜像着填会让一只手肘朝外翻（抚琴那轮已经踩过）。
   目标点：各自这一侧的盘边往内 0.20m、指面略高于盘面 0.03m。
   ⚠️ 与 SIT 是一组数：改 drop / lean / 坐位就要重跑那个探针。 */
const GO_ARM = {
  /* ⚠️⚠️ 键必须是 **Left / Right**（与下面动作块里的 `for (const side of ['Left','Right'])`
     一致）。第一版这里写成 R / L，动作块取 A[side] 恒为 undefined ⇒ `continue` 什么都不写，
     但 placeT 照常在走：**症状是"两只手一直垂在腿边、人像在打瞌睡"，而且不报错**。
     这类"名字对不上就静默不写"的坑与 base[] 白名单同族（见 QIN_HAND 注释）。 */
  /* 落子手（place:1）实测（actor-go-solve4.log，凳子拉到 0.88 之后）：
     go1 右手指尖 (6.663, 0.905, −5.280) = 盘心往外 0.175m ⇒ 盘内 4cm；
     go2 左手指尖 (6.417, 0.869, −5.258) = 盘心 0.075m ⇒ 几乎落子到盘心。 */
  go1: {
    Right: { sx: -2.195, sy: 1.250, sz: -0.040, ex: 0.22, hx: 0.10, hy: 0.00, hz: 0.00, curl: 0.45, mid: 0.20, thumb: -0.60, place: 1 },
    /* 闲着那只手（place:0）实测（actor-go-rest-solve.log，目标 = 自己膝上 5cm、往外让 6cm）：
       go1 左手 d 0.0835。/ 腕骨三轴由 actor-go-palm.log 反解（目标 = **掌心朝下** 0.94、
       手指顺着前臂 0.35）。手型用**放松半握**（curl 0.55 / mid 0.45 / thumb −0.45）——
       落子手要把棋子按在盘面上、所以指尖压得低（0.45/0.20），闲手绷那么紧像握拳。
       ⚠️ 腕子比腿面高 8cm（腿面 0.557 / 腕 0.64）。试过把它压到 2cm（actor-go-rest3/4）：
         要么手背**折回前臂 180°**（follow −0.76~−0.99），要么腕三轴全部贴到搜索框边界
         （hx −2.4 / hz ±2）。原因是这套骨架上臂/前臂只有屈伸、**没有前臂旋前**，
         掌心朝下只能靠腕子拧出来 —— 压得更低就必然更拧。取舍：宁可"手背悬在腿上方
         一掌"（在桌面以下、常规机位看不见），也不要一只拧成麻花的手腕。 */
    Left:  { sx: -1.550, sy: 0.300, sz: 0.100, ex: 0.90, hx: -1.54, hy: -0.48, hz: -1.14, curl: 0.55, mid: 0.45, thumb: -0.45, place: 0 },
  },
  go2: {
    /* go2 右手 d 0.0792（左右各自反解，不镜像 —— 理由同抚琴）；掌心朝下 0.99。 */
    Right: { sx: -1.550, sy: -0.350, sz: -0.100, ex: 0.90, hx: -2.02, hy: 0.32, hz: 1.24, curl: 0.55, mid: 0.45, thumb: -0.45, place: 0 },
    Left:  { sx: -1.995, sy: 0.050, sz: 0.205, ex: 0.22, hx: 0.10, hy: 0.00, hz: 0.00, curl: 0.45, mid: 0.20, thumb: -0.60, place: 1 },
  },
};

/* ── 抚琴（跪坐 + 两手下探到弦上）────────────────────────────────────────────
   这一组数是**反解**出来的，不是照姿势凭感觉填的：outputs/_diag/actor-qin-solve.mjs
   在页内按 rest×Euler(XYZ) 复算、网格搜索肩三轴 + 固定屈肘 0.65（自由解 4 个自由度
   会挑"手臂几乎伸直"的边界解，读起来僵，所以屈肘先钉死）。
   实测腕位（actor-qin-verify.mjs）：左 8.287,1.824,−7.843 / 右 7.649,1.850,−7.859，
   比弦面 1.7305 高 0.09~0.11 —— 腕在上、**指尖靠 QIN_HAND 压到弦面**。
   **改案高 / 坐距 / lean 必须重跑**（触达链 腕→肩 ≈ 0.58m，`seatBack` 一拉开就够不到）。
   ⚠️ 左右两组**各自求解**、不镜像（这套骨架的左右骨骼朝向本来就不对称，
      照 armDown 那样乘 −1 会让右手肘朝外翻）。 */
const QIN_ARM = {
  Left:  { sx: -1.125, sy: 0.125, sz: -0.125, ex: 0.65, pluck: 0.035, rate: 0.9 },
  Right: { sx: -0.700, sy: -0.675, sz: 0.250, ex: 0.65, pluck: 0.080, rate: 1.9 },
};

/* 腕骨与手指（同样是**量出来的**，不是照"掌屈"这个名字填的 → actor-qin-hand3.mjs）
   ① 腕骨必须**三轴一起解**：只压一个轴时右手中指会比食指高 5~12cm（两根手指在同一
      平面里天生不齐），必须叠一点滚转（y）把指扇摆平；
   ② 两只手的腕屈符号**相反且与直觉相反**（细扫实测：左手 z+ 往下、右手 z− 往下）；
   ③ 拇指 **x 负**才是"收向掌心"、正号是往外张 —— 张开的拇指正是"摊手"的一半；
      三节各 −0.65/−0.585/−0.39 时拇指尖到食指尖 0.152 → 0.067m。
   实测结果（指尖 = *_Distal_end 相对弦面 1.7305）：左手食指 +0.014 / 中指 +0.010，
   右手食指 +0.016 / 中指 +0.012，前后位置都在弦带 z∈[−7.852,−7.708] 之内。
   ⚠️ 改案高 / 坐距 / lean 之后这组数**全部失效**，必须重跑上面那两个探针。 */
const QIN_HAND = {
  Left:  { hx: 0.50, hy: -0.50, hz: 0.00, curl: 0.15, mid: 0.13, thumb: -0.65 },
  Right: { hx: 0.10, hy: 0.80, hz: -0.50, curl: 0.15, mid: 0.13, thumb: -0.65 },
};

const LADY_SPOT = PROP_SPOTS.ladyWell;
const LADY_YAW = Math.atan2(PROP_SPOTS.well.x - LADY_SPOT.x, PROP_SPOTS.well.z - LADY_SPOT.z);

/* ── 品茶（P2「喝茶」）────────────────────────────────────────────────────────
   讲学那位文士右手端一盏，每 8~14s 把盏举到胸前再放下。两组角是反解出来的
   （outputs/_diag/actor-tea-solve.mjs / actor-tea-lift.mjs，腕到目标 0.003m / 0.061m）。
   ⚠️ **没有做"就唇"**：这件资产的长袖把整只手包住了（出图里手是袖口里一团），
      盏贴掌心时连带袖子一起被吞掉、画面上完全看不见；而且嘴边目标离肩只有 0.25m，
      真解要靠把肘抬到肩上 21cm，读作"端碗往嘴里倒"。所以改成"举到胸前"的端茶姿态，
      盏摆到**腕前 9cm**（袖口之外）才露得出来 —— 与马厩那捆草料同一条经验：
      手里的小道具必须露在父几何轮廓之外。
   ⚠️ 茶盏**不挂在手骨上**：挂上去会被腕子拧歪（这套骨架只有屈伸、没有前臂旋前）。
      盏是 holder 的子节点，每帧按腕的位置摆一次、姿态恒竖直（盏里的水面才不斜）。 */
const TEA_ARM = {
  hold: { sx: -0.42, sy: 1.19, sz: -1.18, ex: 0.60, hx: 0.35 },
  lift: { sx: -2.20, sy: -0.18, sz: -0.55, ex: 1.10, hx: 0.35 },
};
const TEA_CUP_FWD = 0.09;    // 盏心在腕**前**多少（袖口之外才看得见）
const ease01 = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const _cupV = new THREE.Vector3();

/* 茶盏（青白瓷，与石桌上那套同材质）：盏身 + 盏里那汪茶汤。原点在**盏底中心**。
   茶汤那圈深色只在这盏里用（2cm 的小圆片、永远在盏内），不登记天气角色。 */
function makeTeaCup(holder){
  const g = new THREE.Group();
  g.name = 'actorTeaCup';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.028, 0.046, 16), MAT.porcelain);
  body.position.y = 0.023;
  body.castShadow = false;
  body.receiveShadow = true;
  g.add(body);
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.002, 14),
    new THREE.MeshStandardMaterial({ color: 0x6B4620, roughness: 0.26, metalness: 0.0 }));
  tea.position.y = 0.040;
  g.add(tea);
  g.userData.noMerge = true;
  holder.add(g);
  return g;
}

/* ── 刷马（P3）──────────────────────────────────────────────────────────────
   马夫的第二件事：给身边那匹低头吃草的马刷颈肩。
   ⚠️ **只动肘 + 腕，绝不转肩**：这条 rig 的腰带有一批顶点贴着前臂/拇指骨
      （research/characters/repair_hands.py 修过一类，但腰带上仍有少数与骨骼几何上
      分不开），转肩会把腰带拽成尖刺 —— 与"马夫/书童只做躯干动作"同一条约束。
      肘与腕是否干净由 outputs/_diag/actor-brush-probe.mjs 的"顶点离骨轴距离"实测。
   ⚠️ 刷子**不挂手骨**（同茶盏）：挂上去会被腕子拧歪。每帧按"腕 + 前臂方向"重摆，
      朝向 = 前臂方向 ⇒ 刷面正好贴着马身。
   ⚠️ 尺寸**按像素定**、不按实物：马厩机位在 15~25m 外，15cm 的刷子才读得出来
      （草料捆那条：8cm 粗在 20m 外只有 1~2px）。
   ⚠️ 举手高度由**骨架可达范围**定：肩不动时腕最高只到肘上方约 0.25m ⇒ 刷的是
      马的颈肩（1.1~1.25m），不是背脊。 */
const BRUSH = {
  /* 举起角**实测**（actor-brush-probe.mjs 的只动肘扫描，腕心/指尖的世界坐标）：
     ex −1.6 ⇒ 腕 (38.174,1.219,1.622)、指尖 (38.358,1.234,1.548)；
     ex −1.2 ⇒ 腕 (38.170,1.132,1.632)、指尖 (38.348,1.071,1.567)。
     ⇒ 负角是"前臂抬到前方"（正角把手往身后甩），−1.45 时腕在胸前约 0.2m、
       指尖抬到 1.19m —— 正好是马的颈肩高度。 */
  elbow: -1.45, wrist: 0.20,         // 举起时：前臂抬到略高于水平、腕稍回勾
  amp: 0.20, wAmp: 0.16, hz: 0.45,   // 来回刷：肘 ±0.20rad、腕反相 ±0.16rad
  fwd: 0.10,                         // 刷心在腕前 10cm（指外才看得见）
  every: [7, 12],                    // 两次刷马之间隔多久（其间前俯看马吃草）
  dur: 9.2,                          // 一整轮：抬 0.9 / 刷 7.4 / 收 0.9
  headDown: 0.10,                    // 刷的时候低头看刷子（不是看马嘴）
};
const _brV = new THREE.Vector3(), _brE = new THREE.Vector3(), _brQ = new THREE.Quaternion();
const _brQ2 = new THREE.Quaternion(), _brZ = new THREE.Vector3(0, 0, 1);

/* 马刷：木背 + 鬃毛刷头 + 短柄。原点在**腕心**，局部 +Z = 前臂方向（朝马身）。 */
function makeBrush(holder){
  const g = new THREE.Group();
  g.name = 'actorBrush';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.10, 8), MAT.wood);
  handle.rotation.x = Math.PI / 2;       // 圆柱默认沿 Y ⇒ 转成沿 Z
  handle.position.set(0, 0, 0.012);
  g.add(handle);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.022), MAT.woodDark);
  back.position.set(0, 0, 0.082);
  g.add(back);
  const bristleMat = new THREE.MeshStandardMaterial({ color: 0x8E7A50, roughness: 0.95, metalness: 0.0 });
  const bristles = new THREE.Mesh(new THREE.BoxGeometry(0.080, 0.070, 0.032), bristleMat);
  bristles.position.set(0, 0, 0.108);
  g.add(bristles);
  g.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false;                // 15m 外的小件，投影贡献约 0、只会撑大阴影盒
    o.receiveShadow = true;
    o.userData.noMerge = true;
  });
  g.userData.noMerge = true;
  g.visible = false;
  holder.add(g);
  return g;
}

/* ── 捧卷读（P2 最后一件）────────────────────────────────────────────────────
   文士双手捧着卷轴读；读一阵放下、喝口茶（沿用 TEA_ARM），再捧起来。
   ⚠️ 与"端茶"是**互斥的两种手位**：共用右臂，靠 a.scrollW 交接 ——
      卷轴放下之后才端盏，盏放下之后才捧卷轴。
   ⚠️ 两只手腕的目标点是**反解**的（outputs/_diag/actor-scroll-solve.mjs）：
      左右各自求解、**不镜像**（这套骨架左右骨骼朝向本来不对称，同抚琴那条）。
      实测（ex=1.0 一行）左手腕 (1.193,1.014,−5.394)、右手腕 (1.438,1.012,−5.503)
      ⇒ 两手相距 0.268m、高差 2mm（几乎水平）；两肘在肩前 0.20m、外 0.145m。
      目标是 (±0.155, 腕高 1.20, 前 0.30)，解出的腕比目标低 0.19m 左右，
      所以卷轴的宽度/高度都按**实测手距**缩放（span/SCROLL.span）而不是写死。
   ⚠️ 卷轴姿态**不写死**：每帧按两只腕子的实际位置现算（位置 = 两腕中点，
      X = 左腕→右腕，纸面法线 = 前上方）—— 与茶盏、马刷同一条经验：骨骼一转，
      道具跟着走，不会"纸歪了、手空了"。
   ⚠️ 纸面**上沿朝人、法线朝前上方**（上仰 24°）：外场（相机在正面偏上）看到的是
      纸面；竖直拿着时从默认俯视机位只看见一条白边。 */
const SCROLL = {
  /* 反解结果（outputs/_diag/actor-scroll-solve2.log 的 chest42 一组）：
     目标 = 腕高 1.32（相对脚下，胸口）、左右 ±0.21、前伸 0.30；实测每只手误差 0.04m，
     两只手因此相距约 0.36m（不是 0.42）—— 缩放按**实测**走，见下面 span。
     ⚠️ 第一版目标取 1.20/±0.155（腰腹高、两手并拢）：出图里两只手被宽袖口吞掉、
        卷轴只露出一个白三角（outputs/_diag/actor-scroll/front.png）⇒ 抬到胸口、
        两手拉开，纸面才从袖口之间露出来。 */
  L: { sx: -2.34, sy: -1.77, sz: -0.17, ex: 0.70 },
  R: { sx: -1.99, sy: 0.77, sz: -0.43, ex: 0.70 },
  w: 0.42, h: 0.26,      // 纸面宽 × 高（宽由两手距离定，见 span）
  yOff: 0.02,            // 纸心比手高一点：握的是卷轴的下三分之一，纸往上展开
  span: 0.42,            // 反解目标的两手间距（缩放基准）
  hx: 0.90,              // 腕子内旋（actor-grip-sweep 的 E 组）：指节朝下、扣住木轴
  tilt: 0.42,            // 纸面上仰角（rad）≈24°
  hold: [22, 38],        // 捧读时长（秒）
  trans: 1.00,           // 举起 / 放下各多久
  headDown: 0.22,        // 读的时候低头看纸（顶在 o.headDown 之上）
  fwdMin: 0.80, fwdMax: 1.15,   // 手距缩放夹紧（防解出的姿势异常时纸被拉爆）
};
const _scL = new THREE.Vector3(), _scR = new THREE.Vector3(), _scC = new THREE.Vector3();
const _scX = new THREE.Vector3(), _scY = new THREE.Vector3(), _scZ = new THREE.Vector3();
const _scF = new THREE.Vector3(), _scM = new THREE.Matrix4();
const _scQ = new THREE.Quaternion(), _scQ2 = new THREE.Quaternion();

/* ── 作揖（S2「主人出迎」· 2026-10-23）──────────────────────────────────────
   拱手的手位**不是照姿势凭感觉填的**：这套 GLB 骨架没有前臂旋前、左右骨骼朝向
   也不对称（抚琴/端茶/卷轴三轮都踩过），所以肩肘三轴由
   `outputs/_diag/actor-bow-solve.mjs` 扫出来 —— 目标是"两腕在胸前合拢、前伸够远
   （宽袖不插进袍子）、两手等高"。
   读得出的"礼"只有三件事，按画面可读性给幅度、不按真人的 45°：
     ① 躯干前俯（Chest/Spine 一起，0.62rad ≈ 36°；袖口会吃掉手的细节，太小就读成"点了个头"）
     ② 双手在胸前合拢（两袖并在一起，这套骨架做不出"两掌相合"）
     ③ 两人面对面同时起落（导演层对齐，不各演各的）
   时序 0.70 起 / 1.00 停 / 0.70 落：比真人慢一点 —— 长袍摆动要时间，太快像"鞠躬机"。 */
const BOW = {
  lean: 0.62, head: 0.12,
  in: 0.70, hold: 1.00, out: 0.70,
  /* 手位（2026-10-23 二次反解：outputs/_diag/actor-bow-solve2..6.mjs）。
     ⚠️ 第一版是**站着**解的（手在胸前没错），但作揖时躯干还要前俯 0.62rad，
        整个上半身往前压 ⇒ 手跟着掉到胯部（实测只到脚上 0.94m，像"弯腰找东西"）。
     这次把前俯一起摆上，并把**两腕间距**也写进目标（第一版只约束"手在胸前"，
        解出的是"两手分开 37cm 举在脸旁"，读起来像举手）：五参数（左右肩 sx/sy + 肘）
        一起搜（outputs/_diag/actor-bow-solve7.mjs），结果是
       · 腕高 1.221m（相对脚底）、两腕间距 0.138m、身前 0.46m、高差 7mm；
       · 身前 0.46m 听着远，是因为躯干已经前俯 36°、胸口本身前移了 ~0.25m，
         实际是"手在胸前一个手掌之外"，宽袖刚好并在一起。 */
  L: { sx: -1.85, sy: -3.75, sz: -0.17 },
  R: { sx: -1.95, sy: 2.90, sz: -0.43 },
  ex: 1.30, hand: 0.30,
  curl: 0.75, mid: 0.55, thumb: -0.55,
};

/* ── 客人到访 · 导演层（S2：出迎 → 面对面 → 相互作揖）──────────────────────
   极小的状态机，只做四件事。**所有推进都读演员自己的状态**（arrived / 朝向差），
   不用墙钟：掉帧、软件渲染、探针的 actorStep 快进走的都是同一条路径。
     idle  → 客人走到门内（guest.arrived）
     walk  → 放主人出门（scholar 沿 HOST_GREET_PTS 走一趟），等他到站
     face  → 两人站住互指（2.1rad/s 站转，不平移）
     bow   → 同时作揖一次（BOW 的时序）
     done  → 保持互指；文士的日常捧卷/端茶**保持关闭**（否则客人还站着、他已经读起书来）
   ⚠️ 文士的 scroll/tea 是互斥手位状态机，必须在这里退出 —— 否则他会"边走边端着茶盏"。 */
const VISIT = {
  phase: 'idle', t: 0, bowW: 0,
  hostId: 'scholar', guestId: 'guest',
  greetPt: [0.15, 19.75],      // 门内 1.15m：两人面对面站定的位置（客人停在 0.15,20.9）
};

/* 卷轴纸：奶白底 + 八列竖排"墨点" + 一方朱印。
   不写真字 —— 5m 外只是一列列墨点，写真字反而会露出分辨率；抖动是确定性的
   （sin 哈希），不吃全局/私有随机流。 */
function makeScrollPaperTex(){
  const c = document.createElement('canvas');
  c.width = 256; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#F3E9D4';
  g.fillRect(0, 0, 256, 200);
  g.globalAlpha = 0.05;                        // 纸纤维：淡淡的横纹，近景别像一块纯色板
  for (let y = 0; y < 200; y += 3){
    g.fillStyle = (y % 6) ? '#9C8B6A' : '#FFFFFF';
    g.fillRect(0, y, 256, 1);
  }
  g.globalAlpha = 1;
  const hsh = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
  g.fillStyle = '#2B2622';
  let k = 0;
  for (let col = 0; col < 8; col++){
    const x = 18 + col * 29;
    g.fillRect(x, 16, 12, 4);                  // 列首"抬头"比正文粗一点
    let y = 30;
    while (y < 176){
      const w = 9 + hsh(++k) * 6, h = 5 + hsh(++k) * 4;
      g.fillRect(x + hsh(++k) * 2, y, w, h);
      y += h + 3 + hsh(++k) * 5;
    }
  }
  g.fillStyle = '#A8362C';                     // 朱印
  g.fillRect(214, 158, 20, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 卷轴：纸面 + 两端竖向木轴 + 轴头。原点在纸心，局部 +Z = 纸面法线。 */
function makeScroll(holder){
  const g = new THREE.Group();
  g.name = 'actorScroll';
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(SCROLL.w, SCROLL.h),
    new THREE.MeshStandardMaterial({ map: makeScrollPaperTex(), roughness: 0.94, metalness: 0.0,
                                     side: THREE.DoubleSide }));
  paper.position.y = SCROLL.yOff;              // 握下三分之一、纸往上展开
  g.add(paper);
  for (const s of [-1, 1]){
    /* 木轴心必须**正好落在手腕上**（x = ±w/2、y = 0）：卷轴整体按实测手距缩放，
       木轴随缩放一起落到腕心，手掌才包得住它（第一版多放了 1.2cm + 抬 2cm，
       实测两只手各离轴心 2.5cm，近景读成"手悬在纸下面"）。 */
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, SCROLL.h + 0.035, 10), MAT.wood);
    rod.position.set(s * (SCROLL.w * 0.5), 0, -0.010);
    g.add(rod);
    for (const t of [-1, 1]){
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.030, 10), MAT.woodDark);
      cap.position.set(rod.position.x, t * (SCROLL.h * 0.5 + 0.030), -0.010);
      g.add(cap);
    }
  }
  g.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false;                      // 手里的小件，投影贡献≈0，只会撑大阴影盒
    o.receiveShadow = true;
    o.userData.noMerge = true;
  });
  g.userData.noMerge = true;
  g.visible = false;
  holder.add(g);
  return g;
}

/* ── 手持草料（马夫）────────────────────────────────────────────────────────
   马夫前俯看马吃草的时候，手里也该有一把草（否则站着一个空手闲人）。
   ⚠️ **只动左肘**：这只 rig 的腰带挂了一批与骨骼几何上分不开的顶点（见
      research/characters/repair_hands.py 与 BRUSH 的注释），转肩会把腰带拽成尖刺。
   ⚠️ 肘角是**扫出来**的（outputs/_diag/actor-bale-solve.log，肩保持垂手基线）：
      ex −1.6 ⇒ 腕在身前 0.116m、离地 1.06m；−1.2 ⇒ 0.093m；−0.35 ⇒ 0.024m。
      **但"往前伸"这条路被站位堵死了**：马夫离马腹只有 20cm（马身 x≥38.2、人在 x=38.0），
      前伸 11cm 的一把草（半径 0.14m）会**整个插进马的颈肩里**（实测草把包围盒
      中心 (38.36,1.19,1.09) 落在马身包围盒内，出图里一点都看不见）。
      ⇒ 取"手臂自然垂着、草把拎在身侧"（ex −0.35），草把**竖直**立在手里
        （不跟前臂方向 —— 前臂朝下，草会朝地）。
   ⚠️ 草把摆在腕**上 5cm**、不挂手骨：每帧按腕位重摆（同茶盏/马刷）。 */
const HAY_ARM = { ex: -0.35, up: 0.05, out: 0.13, lean: 0.30, len: 0.24 };
const _hyE = new THREE.Vector3(), _hyQ = new THREE.Quaternion();
const _hyQ2 = new THREE.Quaternion(), _hyF = new THREE.Vector3();
const _hyY = new THREE.Vector3(0, 1, 0);

/* 手里的一把草：11 根细锥管（InstancedMesh，1 个 draw call）沿 +Z 散开 + 两道捆绳。
   梢头偏青绿（"是草不是棍"）—— 用一条竖渐变贴图而不是顶点色：InstancedMesh 的
   顶点色只管"整根一个色"，而草要根黄梢绿。
   ⚠️ 第一版用 mergeGeometries 拼 11 根管，结果**静默失败**（合并返回空、草不出现，
      且异常被资产加载器的 onError 吞掉）⇒ 改用 InstancedMesh，不碰合并。
   局部 +Z = 草梢方向、原点在捆绳处。 */
function makeHayStrawTex(){
  const c = document.createElement('canvas');
  c.width = 2; c.height = 16;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 16, 0, 0);   // 下（根）=黄褐 → 上（梢）=青绿
  grd.addColorStop(0.0, '#B99F63');
  grd.addColorStop(0.55, '#C9B372');
  grd.addColorStop(1.0, '#8FA457');
  g.fillStyle = grd; g.fillRect(0, 0, 2, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeHayHandful(holder){
  const g = new THREE.Group();
  g.name = 'actorHay';
  /* 圆柱轴就是 +Y ⇒ 草把**竖直**（手臂垂着的时候，跟"前臂方向"走会朝地） */
  const geo = new THREE.CylinderGeometry(0.0035, 0.0055, 1, 4, 1);
  const N = 11;
  const im = new THREE.InstancedMesh(geo,
    new THREE.MeshStandardMaterial({ map: makeHayStrawTex(), roughness: 0.95, metalness: 0.0,
                                     envMapIntensity: 0.30 }), N);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++){
    const a = (i / 11) * Math.PI * 2 + (i % 3) * 0.21;
    const sp = 0.026 + (i % 4) * 0.007;           // 梢头张开、根部收在一起
    const len = HAY_ARM.len - 0.02 + ((i * 7) % 5) * 0.012;
    pv.set(Math.cos(a) * sp * 0.55, len * 0.5 - 0.02, Math.sin(a) * sp * 0.55);
    q.setFromAxisAngle(up, (i % 5 - 2) * 0.10);   // 每根略歪，不成一束直棍
    /* 每根往自己那个方向倒一点点，做成"一把"而不是"一根柱" */
    sv.set(1, len, 1);
    M.compose(pv, q, sv);
    im.setMatrixAt(i, M);
  }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = false;                          // 手里的小件，投影贡献≈0
  im.receiveShadow = true;
  im.userData.noMerge = true;
  g.add(im);
  for (const y of [0.012, 0.052]){
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.0055, 5, 12), MAT.woodDark);
    tie.rotation.x = Math.PI / 2;                 // 环面躺平 ⇒ 套在竖直的草把上
    tie.position.set(0, y, 0);
    tie.castShadow = false; tie.receiveShadow = true;
    tie.userData.noMerge = true;
    g.add(tie);
  }
  g.userData.noMerge = true;
  holder.add(g);
  return g;
}

/* route = 往复踱步线（端点交替）。y 一律现算 groundHeight，不给写死的高度：
   两位人物站的草坪是一片缓坡，写死等于在坡上悬空/陷地。 */
/* ── 主人出迎的路线（S2 · 2026-10-23）────────────────────────────────────────
   从堂前 (1.2,−5.7) 绕到门内迎客点 (0.15,19.75)。走**东侧**：北岸往东 → 上拱桥 →
   过桥后沿架高廊道往南 → 廊道南端逐级下到地面 → 绕假山东侧空地往南 → 向西到门口。

   这些点不是"照着平面图画的"，是量出来的（outputs/_diag/host-layers.mjs 逐点列出
   所有命中面，outputs/_diag/host-route-verify.mjs 沿线 0.25m 一档量踏面 + 净距）：
     · 拱桥桥面实测 1.30(北端) → 2.10(桥心) → 1.30(南端)，桥宽 2.9m、中心线 x≈8.3；
       桥北要靠 (7.6,−3.2) 那道 0.69m 的踏步上来 —— 直接从地面切到桥面会是 1.3m 的坎。
     · 桥南 z 9.6~11.2 仍是一段**架高廊道**（桥面 1.30m，下面还有地面），
       所以 floorRay 不能取"最低面"（会踩到桥下），必须跟着连续性走（见 sampleFloorNear）。
     · 廊道 z 12~13.4 逐级降到 0.38m，再往东到 x≈12.5 才回到地面。
     · 南园正中 z 13.5~19.3 / x 0~4.5 是一整块假山（净距 0），只能绕东侧空地（x 12~16）。
   改桥/廊/假山的位置就要重跑 host-route-verify.mjs，否则会走进去。 */
const HOST_GREET_PTS = [
  [1.2, -5.7], [3.5, -5.4], [6.0, -4.0], [7.6, -3.2],          // 堂前 → 桥北踏步
  [8.3, -2.0], [8.3, 0.5], [8.3, 2.0], [8.3, 4.6],              // 拱桥：1.30 → 2.10
  [8.3, 7.0], [8.3, 8.8], [8.3, 9.6], [8.3, 10.4], [8.3, 11.2], // 桥面 → 架高廊道（1.30）
  [8.3, 12.0], [8.3, 12.8], [8.7, 13.2],                       // 廊道南端逐级下坡
  [9.5, 13.4], [11.0, 13.5], [12.5, 13.8],                     // 下到地面
  [13.3, 15.0], [13.5, 17.0], [12.5, 18.8],                    // 绕假山东侧
  [9.0, 19.6], [5.0, 19.8], [2.0, 19.9], [0.15, 19.75],        // 门内空地向西 → 迎客点
];

const DEFS = [
  {
    id: 'scholar',
    url: 'assets/fig-scholar.glb',
    height: 1.72,
    hidePose: 'read',
    tint: 0xAEB9C9,          // 生成件偏亮蓝；压一点饱和，贴近场景的工笔淡彩
    spot: { x: 1.2, z: -5.7, yaw: 0.42 },
    /* S2「主人出迎」（2026-10-23）：客人走到门内后，文士才出发、沿 HOST_GREET_PTS
       走到门口与客人面对面（见 VISIT）。awaitGuest = 开局先按住不动，
       否则他一进园就自己往门口走，然后在那儿站两分钟。
       floorRay + followFloor：这条路要过月台台阶、1.3~2.1m 的拱桥、架高廊道和门内台地，
       高度不是一条 groundHeight 能算出来的，必须一路取真实踏面；
       桥面最高 2.10m ⇒ floorMax 给 2.45（默认 0.8 会把它当"屋顶"丢掉）。 */
    awaitGuest: true,
    floorRay: true,
    followFloor: true,
    floorMax: 2.45,
    route: { pts: HOST_GREET_PTS, speed: 0.86, pause: [0, 0], mode: 'once' },
    /* armDown：生成件是 A 姿势（手臂抬 40°），站桩像展示人偶。
       实测 LeftUpperArm Y=+0.8 / RightUpperArm Y=-0.8 能把两臂放下来、手掌朝内。
       scroll：双手捧卷轴读（P2 最后一件，见 SCROLL）；tea：间歇喝茶（见 TEA_ARM）。
       两者是**互斥手位**，由 a.scrollPhase 交接：捧读 → 放下 → 喝茶 → 再捧起来。 */
    idle: { breath: 0.016, head: 0.055, sway: 0.007, phase: 0.0, armDown: 0.80,
            scroll: true, tea: true, teaEvery: [8, 14] },
  },
  {
    id: 'lady',
    url: 'assets/fig-lady.glb',
    height: 1.63,
    hidePose: 'draw',
    tint: 0xE9DFF5,          // 生成件近白；乘成淡紫，和场景里的藕色/墨色分开
    spot: { x: LADY_SPOT.x, z: LADY_SPOT.z, yaw: LADY_YAW },
    /* 井边这块院子被芭蕉/井架/山石夹着（outputs/_diag/actor-grid.mjs 的 0.25m 网格：
       x=−19.2 一列往北到 z=−7.4 全是 ground、高差 ≤0.03m，是最干净的一条）。 */
    route: { pts: [[LADY_SPOT.x, LADY_SPOT.z], [-18.85, -7.35]], speed: 0.58, pause: [5.0, 9.0] },
    idle: { breath: 0.013, head: 0.045, sway: 0.010, phase: 1.7 },
  },
  {
    id: 'laborer',
    url: 'assets/fig-laborer.glb',
    height: 1.70,
    hidePose: 'pointDown',   // 马厩那个"递草"替身（08b 的 pose:'pointDown'）
    tint: 0xDFE2D8,          // 冷一点的灰，和院子的黄沙地分开（暖米色会糊在沙里）
    /* 落点：马厩院里那匹低头就食的枣马（马身世界 x∈[38.20,38.80]、z∈[−0.15,1.70]，
       马头在 +z 那头、低头吃草时口鼻约 (38.5,0.87,1.81)）。
       ⚠️ P3（刷马）实测姿势（outputs/_diag/actor-brush-solve.mjs，26 方向射线取最近面）：
          x=38.0 时肘 −1.5 ⇒ 刷尖 (38.399,1.208,1.599) 离马身 **7mm**；−1.4 是 11mm、
          −1.6 是 24mm ⇒ 刷拭行程（肘 −1.25~−1.65）全程贴在马身上。
          **x 因此不再动**（往 +x 挪会让刷子插进马身），只在 z 上从"马嘴正前方 1.40"
          退到 **1.30**：手抬起来落在下颌/颈侧，而不是杵在口鼻上（出图判读"像在摸马嘴"）。
       ⚠️ 站点必须落在院子面（yardWear）以内：x<37.8 或 z>2.0 就掉回地形（矮 6cm），
          z=2.3 那条线是 stableGateSill（门槛面 0.213），站进去会半埋。 */
    spot: { x: 38.0, z: 1.30, yaw: Math.PI * 0.5 },
    floorRay: true,          // 台基/院子面不是地形：groundHeight 会让他陷 6cm
    route: null,
    /* 前俯 + 低头 = "看着马把草吃完"。手臂**不动**：这只 rig 的腰带带误权重
       （见 research/characters/repair_hands.py 注释），转肩会把腰带拽成尖刺。
       brush：每 7~12s 站起来刷一轮马（只动肘/腕，见 BRUSH 的注释）。 */
    idle: { breath: 0.012, head: 0.035, sway: 0.006, phase: 3.1, lean: 0.11, headDown: 0.26,
            brush: true, brushEvery: BRUSH.every, hay: true },
  },
  /* 两个书童（08b 的 'child' 一对，半围在先生两侧）。一件资产、两次 parse：
     高度/色调/相位各差一点，避免看出是同一个人在照镜子。
     朝向沿用 08b 原值（0.33×atan2(…)，即"斜着朝先生"而不是正对）。 */
  {
    id: 'child1',
    url: 'assets/fig-child.glb',
    height: 1.20,
    hidePose: 'child',
    tint: 0xEFE4DC,
    spot: { x: 1.80, z: -5.25, yaw: -2.21 },   // 面向先生（1.2,−5.7）
    route: null,
    idle: { breath: 0.018, head: 0.055, sway: 0.009, phase: 0.9, hopEvery: [9, 22], hopH: 0.20 },
  },
  {
    id: 'child2',
    url: 'assets/fig-child.glb',
    height: 1.16,
    hidePose: 'child',
    tint: 0xDCE0E8,
    spot: { x: 0.62, z: -5.10, yaw: 2.37 },    // 面向先生（1.2,−5.7）
    route: null,
    idle: { breath: 0.016, head: 0.05, sway: 0.008, phase: 4.2, hopEvery: [14, 30], hopH: 0.16 },
  },
  /* ── 低案抚琴（P2 第一件"坐着的动作"）────────────────────────────────────────
     同一件文士资产第二次 parse（与两个书童同款做法），坐位坐标由 14-props 的
     QIN_LOW_SEAT 给 —— 桌与人是**一处真值**推出的两个点，不在这里另写一份。
     hidePose 留空：他没有替换任何程序化人物（水榭里抚琴那位是另一处陈设，保留）。
     ⚠️ 站在**堂前月台**上：y 必须走 floorRay（台面 1.30，不是地形），而且默认的
        接受上限 0.8 会把 1.30 判成"屋顶"丢掉 ⇒ 本条目显式给 floorMax。 */
  {
    id: 'qin',
    url: 'assets/fig-scholar.glb',
    height: 1.72,
    hidePose: null,
    tint: 0xC6BFAE,          // 暖褐（与讲学那位蓝灰长衫分开，同一件资产不成"照镜子"）
    spot: { x: QIN_LOW_SEAT.x, z: QIN_LOW_SEAT.z, y: QIN_LOW_SEAT.y, yaw: QIN_LOW_SEAT.yaw },
    floorRay: true,
    floorMax: 1.70,
    pose: 'kneel',
    route: null,
    idle: { breath: 0.009, head: 0.028, sway: 0.003, phase: 2.3, qin: true, lean: 0.18, headDown: 0.12 },
  },
  /* ── 客人（2026-10-23，P4 第五个角色）────────────────────────────────────────
     叙事位置：**从马厩沿石板路走到园子南门口**（"客人到访"主序列的第一段，见
     docs/guest-visit-choreography.md）。走到门内就停、面朝园子，等主人出迎。
     ⚠️ 航点直接用 15-stable 导出的 STABLE_ROAD_PTS（石板路控制点）+ 门内两点：
        改路时人物自动跟着改，不另抄坐标。
     ⚠️ 走长路必须 `followFloor`：老的 floorRay 是"头 4 秒取最高再冻结"（给站着不动的人用的），
        走过坡/桥时会一路悬空或陷进去。桥面/台阶靠每 0.25s 重新打射线取真实踏面。
     ⚠️ 长袍：走路靠 6 根裙骨（已加），**坐姿**要另验（见规划文档 §3）。 */
  {
    id: 'guest',
    url: 'assets/fig-guest.glb',
    height: 1.70,
    hidePose: null,
    tint: 0xF0EDE6,          // 生成件本身就偏灰褐，只做很轻的提亮（压重会糊成一团）
    spot: { x: 40.0, z: 4.2, yaw: -0.13 },      // 马厩门口（石板路起点），面朝路
    floorRay: true,
    followFloor: true,
    floorMax: 1.20,
    route: {
      pts: [...STABLE_ROAD_PTS, [0.15, 23.55], [0.15, 20.9]],
      speed: 0.58,
      pause: [0, 0],
      mode: 'once',                              // 走一趟就停（不来回踱步）
    },
    idle: { breath: 0.014, head: 0.05, sway: 0.008, phase: 5.4, armDown: 0.80 },
  },
];

/* 隐藏程序化替身。near 给了就按**最近的那个**挑：
   poseName 不是唯一的（08b 里两个书童都叫 'child'、家里三个孩子都叫 'watchChild'），
   只按 poseName 取第一个会让"两个书童换掉一个、另一个留着"这种半残状态悄悄发生。 */
function hideProcedural(poseName, near){
  /* 没有 poseName 就没有替身可换（低案抚琴那位是**新增**的人，不是替换某位程序化人物）。
     ⚠️ 必须在这里挡：`poseName === undefined` 会匹配上**所有没有 poseName 的人物**，
        过滤器一放开就会静默藏掉别人。 */
  if (!poseName) return;
  const all = figures.filter(x => x.userData && x.userData.poseName === poseName);
  if (!all.length) return;
  let f = all[0];
  if (near){
    let best = Infinity;
    for (const c of all){
      const d = (c.position.x - near.x) ** 2 + (c.position.z - near.z) ** 2;
      if (d < best){ best = d; f = c; }
    }
  }
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
  else if (def.id === 'qin') HOOKS.settleAsset?.('assets/fig-scholar.glb', ok, err);
  else if (def.id === 'lady') HOOKS.settleAsset?.('assets/fig-lady.glb', ok, err);
  else if (def.id === 'laborer') HOOKS.settleAsset?.('assets/fig-laborer.glb', ok, err);
  else if (def.id === 'child1' || def.id === 'child2') HOOKS.settleAsset?.('assets/fig-child.glb', ok, err);
  else if (def.id === 'guest') HOOKS.settleAsset?.('assets/fig-guest.glb', ok, err);
}

/* 脚下那个面：马厩院子/台基不是地形（groundHeight 给 −0.05，院子面 0.10），
   而 buildActors 跑在马厩 deferBootFirst **之前** ⇒ 求值期打射线常常打空。
   所以"点一次、失败就下次再点"：命中即冻结，最多试 40 次（0.25s 一次 = 10s）。 */
const _rc = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _hitP = new THREE.Vector3();
function sampleFloor(x, z){
  _rc.set(_hitP.set(x, 3.0, z), _down);
  _rc.far = 6.0;
  for (const h of _rc.intersectObject(scene, true)){
    if (!h.object.isMesh) continue;
    /* 跳过：人物 GLB（actor_*）、程序化替身（userData.poseName）、马（horseXxx） */
    let p = h.object, skip = false;
    while (p){
      if ((p.name && (p.name.startsWith('actor_') || /^horse/i.test(p.name))) ||
          (p.userData && p.userData.poseName)) { skip = true; break; }
      p = p.parent;
    }
    if (skip) continue;
    return h.point.y;
  }
  return null;
}

/* followFloor 专用：取**所有**命中面里离"当前高度"最近的那个。
   为什么不能沿用 sampleFloor 的"第一个命中"：射线从 y=3.0 往下打，在树下先撞到的是
   树冠、在廊下先撞到的是檐口（2.5~2.95m），而人其实在地上走 —— 第一个命中会让
   "走到树荫底下"整个人突然抬高两米（低通 18/s，看起来就是弹一下）。
   挑"离当前 y 最近"则天然连续：在地面选地面、上了拱桥选桥面、下桥选回地面。 */
function sampleFloorNear(x, z, nearY){
  _rc.set(_hitP.set(x, 3.0, z), _down);
  _rc.far = 6.0;
  let best = null, bd = Infinity;
  for (const h of _rc.intersectObject(scene, true)){
    if (!h.object.isMesh) continue;
    /* 排除人物 GLB（actor_*）、程序化替身（userData.poseName）、真马（horseXxx） */
    let p = h.object, skip = false;
    while (p){
      if ((p.name && (p.name.startsWith('actor_') || /^horse/i.test(p.name))) ||
          (p.userData && p.userData.poseName)) { skip = true; break; }
      p = p.parent;
    }
    if (skip) continue;
    /* 水面 / 任何半透明层不算踏面 —— 否则在桥边会"选中最接近的水面"、人踩在水上走 */
    const mats = Array.isArray(h.object.material) ? h.object.material : [h.object.material];
    if (mats.some(m => m && (m.transparent || m.opacity < 0.9 || m.depthWrite === false))) continue;
    const y = h.point.y;
    const d = Math.abs(y - nearY);
    if (d < bd){ bd = d; best = y; }
  }
  return best;
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
                       'LeftUpperArm', 'RightUpperArm', 'LeftLowerArm', 'RightLowerArm',
                       'LeftUpperLeg', 'RightUpperLeg', 'LeftLowerLeg', 'RightLowerLeg',
                       'LeftFoot', 'RightFoot',
                       /* 腕与指（抚琴用）：腕骨三轴 + 指节 + 拇指三节。
                          ⚠️ 骨骼不在 base 表里 ⇒ set() 会**静默返回**、画面一动不动
                          （拇指这三节就踩过：探针扫了四档，读数一模一样）。
                          这套骨架只有 食指/中指/拇指 三根，无名指与小指是刚性网格，
                          收不拢 ⇒ 只能靠腕骨滚转 + 拇指内收把整只手读成"收拢"。 */
                       'LeftHand', 'RightHand',
                       'LeftIndexProximal', 'LeftIndexIntermediate', 'LeftMiddleProximal', 'LeftMiddleIntermediate',
                       'RightIndexProximal', 'RightIndexIntermediate', 'RightMiddleProximal', 'RightMiddleIntermediate',
                       'LeftThumbProximal', 'LeftThumbIntermediate', 'LeftThumbDistal',
                       'RightThumbProximal', 'RightThumbIntermediate', 'RightThumbDistal',
                       'Skirt0', 'Skirt1', 'Skirt2', 'Skirt3', 'Skirt4', 'Skirt5',
                       'Skirt0a', 'Skirt1a', 'Skirt2a', 'Skirt3a', 'Skirt4a', 'Skirt5a',
                       'Skirt0b', 'Skirt1b', 'Skirt2b', 'Skirt3b', 'Skirt4b', 'Skirt5b']){
        if (bones[n]) base[n] = bones[n].quaternion.clone();
      }

      scene.add(holder);
      hideProcedural(def.hidePose, def.spot);
      const r = def.route;
      /* 步幅 ↔ 步长对账：脚摆过的弧长必须等于推进的距离，否则就是"滑步"。
         半径取 Hips 到地面的高度（≈ 髋到踝 + 鞋底），由实测骨骼位置算，
         不写死 —— 文士 1.72 与仕女 1.63 的髋高差 6cm，共用一套振幅就会一个滑一个蹭。 */
      holder.updateMatrixWorld(true);
      /* 裙骨（有空才收集）：把"世界横向轴"换算到每根骨的局部系一次存好。
         6 根裙骨是绕身体一圈的，直接用局部 X 转会让每片往各自的方向翻；
         用同一根世界横向轴（人物正面 +Z ⇒ 横向 = X）才是"裙摆随走动前后摆"。 */
      const skirt = [];
      for (let i = 0; i < 6; i++){
        const namA = bones['Skirt' + i + 'a'] ? 'Skirt' + i + 'a' : 'Skirt' + i;
        const namB = bones['Skirt' + i + 'b'] ? 'Skirt' + i + 'b' : null;
        const bA = bones[namA];
        if (!bA) continue;
        const qw = new THREE.Quaternion();
        bA.getWorldQuaternion(qw);
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(qw.invert()).normalize();
        skirt.push({ a: namA, b: namB, axis, ang: (i * Math.PI) / 3 });
      }
      if (skirt.length) console.log('[actor] ' + def.id + ' 裙骨 x' + skirt.length);
      /* 坐姿要把**髋骨**往下移（不是 holder：holder 原点在地面），所以先记下骨局部系的'下' */
      const hipsBone2 = bones['Hips'];
      const hipsDown = new THREE.Vector3(0, -1, 0);
      if (hipsBone2){
        const qh = new THREE.Quaternion();
        hipsBone2.getWorldQuaternion(qh);
        hipsDown.applyQuaternion(qh.invert()).normalize();
      }
      const hipsRest = hipsBone2 ? hipsBone2.position.clone() : null;
      /* 落点高度：能给的就在 spot 里显式给（月台/台基是浮在地形上的独立网格，
         groundHeight 会让人整个沉进去）；不给才算地形。floorRay 的条目随后还会
         用射线把它校正到真实命中的面。 */
      const gy0 = def.spot.y !== undefined ? def.spot.y : groundHeight(def.spot.x, def.spot.z);
      let hipH = def.height * 0.52;
      const hipsBone = bones['Hips'];
      if (hipsBone){
        const p = new THREE.Vector3();
        hipsBone.getWorldPosition(p);
        hipH = Math.max(0.35, p.y - gy0);
      }
      const amp = Math.min(0.34, Math.max(0.16, Math.asin(Math.min(0.6, STEP_LEN / (2 * hipH)))));
      ACTORS.push({
        def, holder, bones, base, phase: def.idle.phase, amp, skirt,
        pos: { x: def.spot.x, z: def.spot.z },
        y: gy0,
        yaw: def.spot.yaw,
        target: r ? 1 : 0, waitT: r ? 2.0 : 0,        // 首帧先站 2s 再起步
        /* awaitGuest：先按住不动，由迎客导演层（VISIT）放行 —— 主人不该一开局就
           自己走到门口等两分钟。 */
        walkOff: !!def.awaitGuest,
        step: 0, moveW: 0, moved: 0, stopN: 0,
        hopT: 0, hopDur: 0.62, hopN: 0, hopWait: def.idle.hopEvery ? 3 + det(def.idle.phase) * 6 : 0,
        floorY: null, floorTries: 0, sampleT: 0, floorDone: false,   // 只有 floorRay 的才会去点
        kneelW: 0, kneelTarget: def.pose === 'kneel' ? 1 : 0,
        sitW: 0, sitTarget: def.pose === 'sit' ? 1 : 0,
        placeT: 0, placeN: 0, placeWait: 1.5 + det(def.idle.phase) * 4,
        teaT: 0, teaN: 0, teaWait: 1.5 + det(def.idle.phase) * 6, sipW: 0, cup: null,
        brushT: 0, brushN: 0, brushWait: 2.5 + det(def.idle.phase + 2.3) * 5, brushW: 0, brush: null,
        scrollT: 0, scrollN: 0, scrollPhase: 0, scrollW: 0, scroll: null,
        scrollHold: SCROLL.hold[0] + (SCROLL.hold[1] - SCROLL.hold[0]) * det(def.idle.phase + 4.1),
        hay: null,
        hipsDown, hipsRest,
      });
      /* 品茶：盏挂在 holder 上（不挂手骨，理由见 TEA_ARM 注释） */
      const aNew = ACTORS[ACTORS.length - 1];
      if (def.idle.tea) aNew.cup = makeTeaCup(holder);
      if (def.idle.brush) aNew.brush = makeBrush(holder);
      if (def.idle.scroll) aNew.scroll = makeScroll(holder);
      if (def.idle.hay) aNew.hay = makeHayHandful(holder);
      markCasterBoxDirty();
      renderer.shadowMap.needsUpdate = true;   // 静态阴影图补一次，人物有影子
      settleActor(def, true);
      console.log('[actor] 已接入 ' + def.id + '  hip=' + hipH.toFixed(3) + 'm  amp=' + amp.toFixed(3));
    },
    (e) => { if (e && e.total) HOOKS.reportAssetProgress?.(def.url, e.loaded, e.total); },
    (err) => {
      /* 失败不抛：程序化人物继续用 */
      settleActor(def, false, err);
      console.warn('[actor] ' + def.id + ' 加载失败，保留程序化替身：', err && err.message);
    });
}

/* 石桌对弈的两个人（坐 SEAT_SPOTS 的**对径一对** 0 / 2，与 08-assemble 里
   "i 与 i+2 夹角 180° 才是对弈"同一条口径）。
   ⚠️ **不能写进模块级 DEFS**：SEAT_SPOTS 是 14-props 的 makeStoneTableSet 在
      装配期填的（含 ±7cm 的 jr 抖动），模块求值那一刻还是空数组 ——
      提前读会得到 undefined、两个人静默不出现。所以在这里现算。
   hidePose 'go' + near：把该座位上的程序化对弈者按"最近的那个"换掉
   （同 poseName 有两位，只按名字取第一个会换错人）。 */
function seatedDefs(){
  const out = [];
  [[0, 'go1', 0xBBA9C4], [2, 'go2', 0xA7B7D2]].forEach(([si, id, tint]) => {
    const st = SEAT_SPOTS[si];
    if (!st) return;
    /* 往桌心挪 0.14m：坐在凳子的**前沿**（真人在石凳上下棋也是这样），
       否则凳心到盘心 1.09m、手臂只有 0.49m，手落不到盘上（actor-go-solve 实测）。 */
    const tb = PROP_SPOTS.stoneTable;
    const dx = tb.x - st.x, dz = tb.z - st.z;
    const dl = Math.hypot(dx, dz) || 1;
    const push = 0.14;
    out.push({
      id,
      url: 'assets/fig-scholar.glb',
      height: 1.72,
      hidePose: 'go',
      tint,
      spot: { x: +(st.x + dx / dl * push).toFixed(4), z: +(st.z + dz / dl * push).toFixed(4),
              y: st.y, yaw: st.yaw },
      pose: 'sit',
      fixedY: true,          // 凳面高度是绝对量，不跟地形
      route: null,
      /* 坐姿的两只手分别在 GO_ARM 里；这里只留下呼吸、低头看盘与"落子"的节奏 */
      idle: { breath: 0.008, head: 0.022, sway: 0.002, phase: si === 0 ? 1.1 : 3.9,
              go: id, headDown: SIT.headDown, placeEvery: [4.5, 9.0] },
    });
  });
  return out;
}

/* 只在启动时调一次（08-assemble 在建完人物之后调）。
   ⚠️ 这里**只**装 DEFS 里那批：石桌对弈的两个人要等 14-props 的 buildProps
      （SEAT_SPOTS 在 makeStoneTableSet 里填）跑完，见 buildSeatedActors。 */
export function buildActors(){
  if (_built) return;
  _built = true;
  for (const def of DEFS) loadActor(def);
}

/* 石桌对弈的两个人：必须由 08-assemble 在 buildProps + 程序化对弈者建好**之后**调
   （① 座位坐标要真实落位；② 换人靠 hideProcedural 找 figures 里那两个 poseName='go'）。 */
let _seatedBuilt = false;
export function buildSeatedActors(){
  if (_seatedBuilt) return;
  _seatedBuilt = true;
  for (const def of seatedDefs()) loadActor(def);
}

/* 每帧：呼吸 + 缓慢转头/重心。只写骨骼，不碰 root 的 position/rotation。 */
/* 确定性伪随机（不碰全局随机流 —— 铁律 1：装配期多抽一次，其后全园布局整体前移）。
   只用来给"这次停多久"一点变化，不进任何门禁的哈希。 */
function det(i){
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
const approach = (v, t, d)=> (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

/* 走路：多航点 + 两种收尾（2026-10-23 为"客人到访"扩的）。
   - mode 缺省 = 'pingpong'：到端点停 dwell 后掉头（十几位原有角色都是这个行为，逐字不变）
   - mode = 'once'：沿航点一路走到底，到终点置 `a.arrived = true` 并停下（给导演层判断用）
   ⚠️ 两点时仍走老的 `1 - target` 分支，保证"仕女/书童"这类既有路线一位不差。
   ⚠️ 转身是"站住转"（|Δyaw| > TURN_GATE 时不平移），不是边走边拧 ——
      真实的人转身时脚是原地倒步，边走边转在长袍上会看出膝盖朝侧面。 */
function tickRoute(a, dt){
  const r = a.def.route;
  a.moved = 0;
  if (!r || a.walkOff || a.arrived){ a.moveW = approach(a.moveW, 0, dt / 0.45); return; }
  if (a.waitT > 0){
    a.waitT -= dt;
    a.moveW = approach(a.moveW, 0, dt / 0.45);
    return;
  }
  const last = r.pts.length - 1;
  const t = r.pts[a.target];
  const dx = t[0] - a.pos.x, dz = t[1] - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05){
    if (r.mode === 'once' && a.target >= last){
      a.arrived = true;
      a.sampleT = 0;                 // 到站补采一次脚下踏面，别带着"上一格"的高度站住
      a.moveW = approach(a.moveW, 0, dt / 0.45);
      return;
    }
    if (r.pts.length === 2){
      a.target = 1 - a.target;
    } else if (r.mode === 'once'){
      a.target++;
    } else {
      /* 多航点往复：端点处翻向，中间点按当前方向继续 */
      if (a.target >= last) a.dir = -1;
      else if (a.target <= 0) a.dir = 1;
      a.target += (a.dir || 1);
    }
    a.waitT = r.pause[0] + (r.pause[1] - r.pause[0]) * det(a.stopN++);
    a.moveW = approach(a.moveW, 0, dt / 0.45);
    return;
  }
  let dy = Math.atan2(dx, dz) - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const dTurn = GAIT.turn * dt;
  if (Math.abs(dy) > TURN_GATE){
    a.yaw += dy > 0 ? dTurn : -dTurn;
    a.step += dt * 0.17;                       // 原地倒步：让脚小碎步跟上
    a.moveW = approach(a.moveW, 0.32, dt / 0.3);
    return;
  }
  a.yaw += Math.max(-dTurn, Math.min(dTurn, dy));
  const v = r.speed * (1 - 0.5 * (Math.abs(dy) / TURN_GATE));
  const k = Math.min(1, (v * dt) / dist);
  a.pos.x += dx * k; a.pos.z += dz * k;
  a.moved = v * dt;
  a.step += a.moved;
  a.moveW = approach(a.moveW, 1, dt / 0.40);
}

/* ── 迎客导演层 ─────────────────────────────────────────────────────────────
   见 VISIT 的注释。这里只写 a.yaw（tickRoute 在 arrived/walkOff 时早退、不碰 yaw，
   所以两者不打架），以及 bowW —— 姿态块在同一帧里读它。 */
function actorRef(id){ for (const a of ACTORS) if (a.def.id === id) return a; return null; }

/* 站住转（不平移，同 tickRoute 的口径）。返回**转之前**的剩余角差。 */
function turnToward(a, yawTo, dt){
  let dy = yawTo - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const d = GAIT.turn * dt;
  a.yaw += Math.abs(dy) <= d ? dy : (dy > 0 ? d : -d);
  return Math.abs(dy);
}
const yawToOther = (a, b) => Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);

function tickVisit(dt){
  const v = VISIT;
  const host = actorRef(v.hostId), guest = actorRef(v.guestId);
  if (!host || !guest) return;
  if (v.phase === 'idle'){
    /* 客人走到门内才"出门相迎"。用演员自己的 arrived，不用墙钟。 */
    if (!guest.arrived) return;
    v.phase = 'stow'; v.t = 0;
    return;
  }
  if (v.phase === 'stow'){
    /* 先把卷轴放下再迈步：手里还捧着卷轴就走，会看到卷轴"粘在手上跟着飘"。
       0.55s 是 SCROLL "放下"那一段的时长量级（卷轴在这里线性收到 0）。 */
    v.t += dt;
    if (v.t > 0.55){
      v.phase = 'walk'; v.t = 0;
      host.walkOff = false;
      host.waitT = 0.3;               // 起步前再站一下（"我从堂前出来"）
    }
    return;
  }
  if (v.phase === 'walk'){
    if (host.arrived){ v.phase = 'face'; v.t = 0; }
    return;
  }
  if (v.phase === 'face'){
    v.t += dt;
    const dh = turnToward(host, yawToOther(host, guest), dt);
    const dg = turnToward(guest, yawToOther(guest, host), dt);
    /* 至少站 1.2s 再行礼：走到就拜读起来像"撞上去" */
    if (v.t > 1.2 && dh < 0.10 && dg < 0.10){ v.phase = 'bow'; v.t = 0; }
    return;
  }
  if (v.phase === 'bow'){
    v.t += dt;
    const t1 = BOW.in, t2 = BOW.in + BOW.hold, t3 = t2 + BOW.out;
    if (v.t < t1) v.bowW = ease01(v.t / BOW.in);
    else if (v.t < t2) v.bowW = 1;
    else if (v.t < t3) v.bowW = 1 - ease01((v.t - t2) / BOW.out);
    else { v.bowW = 0; v.phase = 'done'; v.t = 0; }
    turnToward(host, yawToOther(host, guest), dt);     // 转身没转完也继续对上
    turnToward(guest, yawToOther(guest, host), dt);
    return;
  }
  /* done：两人保持互指（客人等下一段 S3 并排同行；文士的日常手位保持关闭） */
  turnToward(host, yawToOther(host, guest), dt);
  turnToward(guest, yawToOther(guest, host), dt);
}

/* 一次完整更新（时钟由调用方推进）—— tickActors 与探针的 actorStep 共用同一份，
   避免探针里再抄一遍步态口径（抄一遍 = 改产品时两边悄悄分家）。 */
function advance(dt){
  tickVisit(dt);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const a of ACTORS){
    tickRoute(a, dt);
    /* 院子/台基面：马厩是 deferBootFirst 建的，人物 GLB 可能先到 ⇒ 头几次射线只打得到地形。
       所以头 4 秒（16 次 ×0.25s）**持续采样取最高**，之后冻结：院子面一建出来就被采用。
       只接受 [−0.4, 0.8] 的命中，免得把马厩屋顶（2.9m）当成地面。
       （第一版"打中即冻结"踩过：第一个采样点打到的正是地形 0.052 ⇒ 人整体矮 5cm。） */
    if (a.def.floorRay && (!a.floorDone || a.def.followFloor)){
      /* followFloor（走长路的人，2026-10-23 客人）：**边走边采样**，并把间隔从 0.25s 收到
         0.10s —— 0.25s 在 0.58m/s 下已经是 15cm 一格，起伏路面会看出"悬空/下陷"。
         站着不动（或已到站）时只在必要时补采一次，避免每帧打射线。 */
      if (!a.def.followFloor || a.moved > 1e-4) a.sampleT -= dt;
      if (a.sampleT <= 0){
        a.sampleT = a.def.followFloor ? 0.10 : 0.25;
        const fy = a.def.followFloor
          ? sampleFloorNear(a.pos.x, a.pos.z, a.y)
          : sampleFloor(a.pos.x, a.pos.z);
        const fyMax = a.def.floorMax !== undefined ? a.def.floorMax : 0.8;
        /* ⚠️ 下限不能再写死 −0.4（2026-10-23 踩到）：园子南门外那一段地面低到 −0.8，
           写死 −0.4 会把**合法路面**当成"屋顶"拒掉 ⇒ floorY 冻在上一格，
           人在下坡路上一路悬空（实测悬空 0.39m）。跟随型改用"相对当前高度"的窗口。 */
        const fyLo = a.def.followFloor ? a.y - 2.0 : -0.4;
        if (fy !== null && fy > fyLo && fy < fyMax){
          /* 老角色仍是"头 16 次取最高再冻结"：他们站在院子/台基上不动，
             取最高是为了等马厩台基建出来。跟随型直接取当前值。 */
          if (a.def.followFloor) a.floorY = fy;
          else if (a.floorY === null || fy > a.floorY + 0.004) a.floorY = fy;
        }
        if (!a.def.followFloor && ++a.floorTries >= 16) a.floorDone = true;
      }
    }
    /* 坐凳的人**坐的是凳子**，不是脚下那块地形：石桌四周是缓坡，跟着地形走会让
       同一条凳子上的两个人一个高一个低（go2 实测比 go1 低 8cm、沉到凳面以下）。
       fixedY = 钉在 spot.y（= 凳子所在的地面高，14-props 给的）。 */
    const gy = a.def.fixedY ? a.def.spot.y
      : (a.def.floorRay ? (a.floorY === null ? a.y : a.floorY) : groundHeight(a.pos.x, a.pos.z));
    /* 位置：先落地点，再叠步态起伏。groundHeight 是缓坡，直接跟即可。
       跟随型（走长路的人）收敛快一点，起伏路面上不至于"慢半拍"地悬空。 */
    a.y += (gy - a.y) * Math.min(1, dt * (a.def.followFloor ? 18 : 8));
    const o = a.def.idle;
    const p = a.step / STEP_LEN * Math.PI;      // 步态相位（按走过的距离推进）
    const w = a.moveW;
    const sw = Math.sin(p);
    const bob = -GAIT.bob * Math.cos(2 * p) * w;

    /* ── 孩子跳（可选）：站着的角色每隔 hopEvery 秒蹦一下 ───────────────────
       只做 **腿部 + 整身抛物线**：肩部不动（腰/衣摆被手骨误权重，抬臂会撕）。
       起跳相位用 hopT 归一化：0~0.32 下蹲蓄力、0.32~0.78 腾空、0.78~1 落地缓冲。 */
    let hopY = 0, hopCrouch = 0, hopTuck = 0;
    const he = o.hopEvery;
    if (he && w < 0.2){
      a.hopWait -= dt;
      if (a.hopWait <= 0 && a.hopT <= 0){
        a.hopT = 1e-4;
        a.hopDur = he[2] || 0.62;
        a.hopWait = he[0] + (he[1] - he[0]) * det(a.hopN++ + a.phase * 13.7);
      }
      if (a.hopT > 0){
        a.hopT += dt;
        const u = Math.min(1, a.hopT / a.hopDur);
        if (u < 0.32){
          const q1 = u / 0.32;
          hopCrouch = 0.30 * Math.sin(q1 * Math.PI * 0.5);      // 下蹲
        } else if (u < 0.78){
          const q1 = (u - 0.32) / 0.46;
          hopY = (o.hopH || 0.20) * Math.sin(q1 * Math.PI);      // 腾空抛物线
          hopTuck = 0.55 * Math.sin(q1 * Math.PI);               // 收起小腿
          hopCrouch = -0.10 * Math.sin(q1 * Math.PI);            // 起跳伸直
        } else {
          const q1 = (u - 0.78) / 0.22;
          hopCrouch = 0.22 * Math.sin(q1 * Math.PI);             // 落地缓冲
        }
        if (u >= 1) a.hopT = 0;
      }
    }
    a.holder.position.set(a.pos.x, a.y + bob + hopY - hopCrouch * 0.16, a.pos.z);
    a.holder.rotation.y = a.yaw;

    /* 跪坐权重 0→1 平滑过渡（换姿势不能"啪"一下跪下） */
    if (a.kneelTarget > a.kneelW) a.kneelW = Math.min(a.kneelTarget, a.kneelW + dt * 2.2);
    else if (a.kneelTarget < a.kneelW) a.kneelW = Math.max(a.kneelTarget, a.kneelW - dt * 2.2);
    const k = a.kneelW;
    if (a.sitTarget > a.sitW) a.sitW = Math.min(a.sitTarget, a.sitW + dt * 2.2);
    else if (a.sitTarget < a.sitW) a.sitW = Math.max(a.sitTarget, a.sitW - dt * 2.2);
    const st2 = a.sitW;

    const b = Math.sin(_t * 1.05 + a.phase);
    const h = Math.sin(_t * 0.31 + a.phase * 1.7);
    const set = (name, x, y, z) => {
      const bone = a.bones[name], rest = a.base[name];
      if (!bone || !rest) return;
      e.set(x, y, z, 'XYZ');
      q.setFromEuler(e);
      bone.quaternion.copy(rest).multiply(q);
    };

    /* ── 步态（w→0 时全部回零，站姿与 P1 逐字一致）────────────────────────
       屈膝相位：腿往前送的半程（cos>0）才弯；支撑期直着撑住重量。
       踝：跟落抬趾、趾离压趾，用 ±GAIT.foot 的小幅反向补偿。 */
    /* 坐凳：大腿抬平（1.44rad）、小腿往下折、脚掌踏平。
       ⚠️⚠️ 这套骨架的**左右大腿局部 X 轴并没有镜像** —— actor-leg-axis.mjs 实测：
          两条腿都给 +0.3 时膝都往后 0.14m、给 −0.3 时都往前 0.10m。所以：
            · **步态**必须异号才能交替（Left +amp·sw / Right −amp·sw）；
            · **对称动作**（蹲 / 跪 / 坐）必须同号。写异号会让一条腿往前、另一条
              甩到身后：坐凳第一版右膝跑到身后 0.42m、右踝比髋还高 0.28m，
              裙下露出一大块深色裤腿，读作"背后挂着一块黑布"（v-east 出图）。 */
    const legSym = hopCrouch * 0.8 - KNEEL.thigh * k - SIT.thigh * st2;   // 两条腿共用的对称分量
    set('LeftUpperLeg',  a.amp * sw * w + legSym, 0, 0);    // 步态异号（交替）
    set('RightUpperLeg', -a.amp * sw * w + legSym, 0, 0);   // 对称分量同号（同向前屈）
    set('LeftLowerLeg',  -GAIT.knee * Math.pow(Math.max(0,  Math.cos(p)), 1.2) * w - hopCrouch * 1.8 - hopTuck + KNEEL.knee * k + SIT.knee * st2, 0, 0);
    set('RightLowerLeg', -GAIT.knee * Math.pow(Math.max(0, -Math.cos(p)), 1.2) * w - hopCrouch * 1.8 - hopTuck + KNEEL.knee * k + SIT.knee * st2, 0, 0);
    set('LeftFoot',  -GAIT.foot * sw * w + KNEEL.foot * k + SIT.foot * st2, 0, 0);
    set('RightFoot',  GAIT.foot * sw * w + KNEEL.foot * k + SIT.foot * st2, 0, 0);
    set('Hips',  0.010 * w,
        GAIT.hipYaw * sw * w,
        GAIT.hipRoll * Math.cos(p) * w);

    /* A 姿势 → 自然垂手（实测左 +Y / 右 -Y）。只对文士生效，仕女本来就是垂手。 */
    const ad = o.armDown || 0;
    if (ad > 0.001){
      set('LeftUpperArm', 0.03 * b, ad, 0);
      set('RightUpperArm', 0.03 * b, -ad, 0);
    }
    /* ── 捧卷读（P2 最后一件）：两手抬到胸前、捧着卷轴读 ────────────────────
       相位：0 捧读(a.scrollHold 秒) → 1 放下(1s) → 2 喝茶(4.2s，复用 TEA_ARM)
             → 3 举起(1s) → 0
       权重 a.scrollW 在 0/2 相是纯粹的 1/0、中间两相各 1s 缓动 ⇒ 手不会瞬移，
       且放下之后茶盏才端起来（两种手位共用右臂，必须互斥）。
       与 armDown 的基线做加权过渡：w=0 时逐字等于"自然垂手"。 */
    /* 到访期间（从客人走到门口起）：文士退出"捧卷 ↔ 端茶"的日常循环。
       否则他会在迎客路上一手卷轴一手茶盏（规划文档 §3 第 6 条点名的风险）。 */
    const visiting = a.def.id === VISIT.hostId && VISIT.phase !== 'idle';
    if (o.scroll && !visiting){
      a.scrollT += dt;
      if (a.scrollPhase === 0 && a.scrollT >= a.scrollHold){
        a.scrollPhase = 1; a.scrollT = 0;
      } else if (a.scrollPhase === 1 && a.scrollT >= SCROLL.trans){
        a.scrollPhase = 2; a.scrollT = 0;
        a.teaT = 1e-4;                                   // 卷轴放下了，端盏
        a.teaWait = o.teaEvery[0] + (o.teaEvery[1] - o.teaEvery[0]) * det(a.teaN++ + a.phase * 5.1);
      } else if (a.scrollPhase === 2 && a.teaT <= 0 && a.scrollT > 0.1){
        a.scrollPhase = 3; a.scrollT = 0;                // 喝完，把卷轴捧回去
      } else if (a.scrollPhase === 3 && a.scrollT >= SCROLL.trans){
        a.scrollPhase = 0; a.scrollT = 0;
        a.scrollHold = SCROLL.hold[0] + (SCROLL.hold[1] - SCROLL.hold[0]) * det(a.scrollN++ + a.phase * 7.7);
      }
      const u2 = a.scrollT / SCROLL.trans;
      a.scrollW = a.scrollPhase === 0 ? 1
                : a.scrollPhase === 1 ? 1 - ease01(u2)
                : a.scrollPhase === 2 ? 0 : ease01(u2);
      if (a.scrollW > 0.001){
        const w2 = a.scrollW, L = SCROLL.L, Rr = SCROLL.R;
        set('LeftUpperArm', 0.03 * b * (1 - w2) + L.sx * w2, ad * (1 - w2) + L.sy * w2, L.sz * w2);
        set('RightUpperArm', 0.03 * b * (1 - w2) + Rr.sx * w2, -ad * (1 - w2) + Rr.sy * w2, Rr.sz * w2);
        set('LeftLowerArm', L.ex * w2, 0, 0);
        set('RightLowerArm', Rr.ex * w2, 0, 0);
        set('LeftHand', SCROLL.hx * w2, 0, 0);
        set('RightHand', SCROLL.hx * w2, 0, 0);
        /* 握木轴：食指/中指扣住、拇指内收（比端盏更实 —— 卷轴是有重量的） */
        for (const sd of ['Left', 'Right']){
          set(sd + 'IndexProximal', 0.85 * w2, 0, 0);
          set(sd + 'MiddleProximal', 0.85 * w2, 0, 0);
          set(sd + 'IndexIntermediate', 0.62 * w2, 0, 0);
          set(sd + 'MiddleIntermediate', 0.62 * w2, 0, 0);
          set(sd + 'ThumbProximal', -0.55 * w2, 0, 0);
          set(sd + 'ThumbIntermediate', -0.48 * w2, 0, 0);
          set(sd + 'ThumbDistal', -0.30 * w2, 0, 0);
        }
      }
    } else if (o.scroll){
      /* 迎客期间：卷轴**在 0.55s 内收掉**，不是"啪"一下消失 —— 这一步就发生在客人面前，
         直接归零会让手里的卷轴凭空不见。收完再回到"垂手"基线。 */
      a.scrollW = Math.max(0, a.scrollW - dt / 0.55);
      if (a.scrollW <= 1e-3){ a.scrollPhase = 0; a.scrollT = 0; }
    }
    /* 手持草料：只动**左肘**（肩保持垂手），手指松松地扣着草把 —— 见 HAY_ARM。 */
    if (o.hay){
      set('LeftLowerArm', HAY_ARM.ex, 0, 0);
      set('LeftIndexProximal', 0.70, 0, 0);
      set('LeftMiddleProximal', 0.70, 0, 0);
      set('LeftIndexIntermediate', 0.50, 0, 0);
      set('LeftMiddleIntermediate', 0.50, 0, 0);
      set('LeftThumbProximal', -0.45, 0, 0);
      set('LeftThumbIntermediate', -0.38, 0, 0);
      set('LeftThumbDistal', -0.24, 0, 0);
    }
    /* ── 品茶（P2「喝茶」）：端着 → 抬到唇边 → 放下 ────────────────────────────
       4.2s 一个来回（抬 1.3 / 停 1.6 / 落 1.3），间歇 8~14s。
       只在**喝茶那只手**上写（右手），左臂继续走 armDown —— 两只手都端起来就成了"捧"。
       ⚠️ 与"捧卷轴"互斥：文士双手都占着卷轴时不能端盏 ⇒ 只在卷轴放下的那一相
          （a.scrollPhase === 2）才跑这段；其余时候把 sip 归零（否则低头角会冻住）。 */
    if (o.tea && !visiting && (!o.scroll || a.scrollPhase === 2)){
      a.teaWait -= dt;
      if (a.teaWait <= 0 && a.teaT <= 0){
        a.teaT = 1e-4;
        a.teaWait = o.teaEvery[0] + (o.teaEvery[1] - o.teaEvery[0]) * det(a.teaN++ + a.phase * 5.1);
      }
      let sip = 0;
      if (a.teaT > 0){
        a.teaT += dt;
        const u = Math.min(1, a.teaT / 4.2);
        sip = u < 0.31 ? ease01(u / 0.31) : (u < 0.69 ? 1 : 1 - ease01((u - 0.69) / 0.31));
        if (u >= 1) a.teaT = 0;
      }
      a.sipW = sip;
      const A = TEA_ARM.hold, B = TEA_ARM.lift;
      set('RightUpperArm', A.sx + (B.sx - A.sx) * sip, A.sy + (B.sy - A.sy) * sip, A.sz + (B.sz - A.sz) * sip);
      set('RightLowerArm', A.ex + (B.ex - A.ex) * sip, 0, 0);
      set('RightHand', A.hx + (B.hx - A.hx) * sip, 0, 0);
      /* 指节：虚握盏身（食指/中指弯、拇指内收扣住盏沿） */
      const cu = 0.80 + 0.10 * sip;
      set('RightIndexProximal', cu, 0, 0);
      set('RightMiddleProximal', cu, 0, 0);
      set('RightIndexIntermediate', 0.55, 0, 0);
      set('RightMiddleIntermediate', 0.55, 0, 0);
      set('RightThumbProximal', -0.55, 0, 0);
      set('RightThumbIntermediate', -0.50, 0, 0);
      set('RightThumbDistal', -0.33, 0, 0);
    } else if (o.tea){
      a.sipW = 0; a.teaT = 0;      // 双手占着卷轴：不端盏、也不留上一杯的低头角
    }
    /* ── 刷马（P3）：站起来、抬前臂、来回刷 —— **只动肘/腕** ──────────────────
       · 只在站着（w<0.3）时开始，走路自然打断；
       · 一轮 9.2s：0.9s 抬 / 7.4s 刷 / 0.9s 收，间歇 7~12s（其间继续前俯看马吃草）；
       · 摆动**叠加在肘上**（腕反相做"手腕带一下"），上臂一动不动 ⇒ 腰带安全
         （实测：右肘/右腕骨上挂的顶点离骨轴 ≤0.132m、无一个 >0.14m 的越界顶点）；
       · 刷子每帧按"腕 + 前臂方向 10cm"重摆，朝向 = 前臂方向（刷面正对马身）。 */
    if (o.brush){
      const ev = o.brushEvery || BRUSH.every;
      const nextWait = () => ev[0] + (ev[1] - ev[0]) * det(a.brushN++ + a.phase * 11.3);
      if (a.brushT <= 0){
        a.brushWait -= dt;
        if (a.brushWait <= 0 && w < 0.3) a.brushT = 1e-4;
      }
      let bw2 = 0;
      if (a.brushT > 0){
        a.brushT += dt;
        const u = Math.min(1, a.brushT / BRUSH.dur);
        bw2 = u < 0.10 ? ease01(u / 0.10) : (u < 0.90 ? 1 : 1 - ease01((u - 0.90) / 0.10));
        if (u >= 1){ a.brushT = 0; a.brushWait = nextWait(); }   // ⚠️ 收完必须重排间歇，否则会一轮接一轮
      }
      a.brushW = bw2;
      if (bw2 > 0.001){
        const st3 = Math.sin(a.brushT * 6.2832 * BRUSH.hz);
        set('RightLowerArm', BRUSH.elbow * bw2 - BRUSH.amp * st3 * bw2, 0, 0);
        set('RightHand', BRUSH.wrist * bw2 + BRUSH.wAmp * st3 * bw2, 0, 0);
        /* 握住刷柄：食指/中指弯、拇指内收（比端茶扣得更紧 —— 刷子要受力） */
        set('RightIndexProximal', 0.95 * bw2, 0, 0);
        set('RightMiddleProximal', 0.95 * bw2, 0, 0);
        set('RightIndexIntermediate', 0.70 * bw2, 0, 0);
        set('RightMiddleIntermediate', 0.70 * bw2, 0, 0);
        set('RightThumbProximal', -0.62 * bw2, 0, 0);
        set('RightThumbIntermediate', -0.55 * bw2, 0, 0);
        set('RightThumbDistal', -0.36 * bw2, 0, 0);
      }
    }
    /* ── 抚琴：两臂前伸下探到弦上（参数 QIN_ARM + QIN_HAND，反解口径见文件头）──────
       · 只在跪坐权重上来之后才伸手（过渡帧里手不会先去按空气）；
       · **拨弦叠在指节上、不叠在肘上**：肘一动整条手臂跟着上下摆 1~2cm，而指尖只离弦
         1.2cm ⇒ 会周期性地穿进弦里。改成食指/中指交替起点，手是稳的、只有指尖在动；
       · 左右手节奏不同（左手按弦慢、右手拨弦快），两个手不会像机器一样同步。 */
    if (o.qin && k > 0.2){
      const tt = _t + a.phase;
      for (const side of ['Left', 'Right']){
        const P = QIN_ARM[side], H = QIN_HAND[side];
        set(side + 'UpperArm', P.sx, P.sy, P.sz);
        set(side + 'LowerArm', P.ex, 0, 0);
        set(side + 'Hand', H.hx, H.hy, H.hz);
        const osc = Math.sin(tt * P.rate * 6.2832);
        set(side + 'IndexProximal',  H.curl + P.pluck * Math.max(0, osc), 0, 0);
        set(side + 'MiddleProximal', H.curl + P.pluck * Math.max(0, -osc), 0, 0);
        set(side + 'IndexIntermediate',  H.mid, 0, 0);
        set(side + 'MiddleIntermediate', H.mid, 0, 0);
        set(side + 'ThumbProximal', H.thumb, 0, 0);
        set(side + 'ThumbIntermediate', H.thumb * 0.9, 0, 0);
        set(side + 'ThumbDistal', H.thumb * 0.6, 0, 0);
      }
    }
    /* ── 对弈：一只手落到盘面、每 4.5~9s 落一次子 ─────────────────────────────
       · 两只手的基准角在 GO_ARM 里**各自反解**（不镜像，理由同抚琴）；
       · "落子"只动肘/腕/指的一点点（手走 ~5cm），头跟着点一下 ——
         真人是手腕轻轻放下，不是整条手臂抬起来砸下去。 */
    if (o.go && st2 > 0.2){
      const A = GO_ARM[o.go] || GO_ARM.go1;
      a.placeWait -= dt;
      if (a.placeWait <= 0 && a.placeT <= 0){
        a.placeT = 1e-4;
        a.placeWait = o.placeEvery[0] + (o.placeEvery[1] - o.placeEvery[0]) * det(a.placeN++ + a.phase * 7.3);
      }
      let place = 0;
      if (a.placeT > 0){
        a.placeT += dt;
        const u = Math.min(1, a.placeT / 1.4);
        place = Math.sin(u * Math.PI);          // 0→1→0
        if (u >= 1) a.placeT = 0;
      }
      for (const side of ['Left', 'Right']){
        const P = A[side];
        if (!P) continue;
        const d = P.place ? place : 0;
        set(side + 'UpperArm', P.sx - 0.05 * d, P.sy, P.sz);
        set(side + 'LowerArm', P.ex + 0.10 * d, 0, 0);
        set(side + 'Hand', P.hx - 0.20 * d, P.hy, P.hz);
        set(side + 'IndexProximal', P.curl - 0.18 * d, 0, 0);
        set(side + 'MiddleProximal', P.curl - 0.18 * d, 0, 0);
        set(side + 'IndexIntermediate', P.mid, 0, 0);
        set(side + 'MiddleIntermediate', P.mid, 0, 0);
        set(side + 'ThumbProximal', P.thumb, 0, 0);
        set(side + 'ThumbIntermediate', P.thumb * 0.9, 0, 0);
        set(side + 'ThumbDistal', P.thumb * 0.6, 0, 0);
      }
    }
    /* ── 作揖（S2）：两手在胸前合拢 + 躯干前俯 ─────────────────────────────────
       权重 = 导演层的 bowW（0→1→0，起落各 0.7s）。只对参与迎客的两个人生效。
       ⚠️ 手位用**线性插值**从"垂手基线"过渡到 BOW 的角：bowW 自己是 ease01，
          再叠非线性会读成"弹一下"。
       ⚠️ 躯干前俯不在这里写 —— 下面的 Chest/Spine/Head 是同一批骨的最后一次写入，
          这里再 set 一遍会被覆盖（本项目踩过"设了没生效"的坑）。 */
    const bw = (a.def.id === VISIT.hostId || a.def.id === VISIT.guestId) ? VISIT.bowW : 0;
    if (bw > 0.001){
      const L = BOW.L, Rr = BOW.R, wb = bw;
      set('LeftUpperArm', L.sx * wb, ad * (1 - wb) + L.sy * wb, L.sz * wb);
      set('RightUpperArm', Rr.sx * wb, -ad * (1 - wb) + Rr.sy * wb, Rr.sz * wb);
      set('LeftLowerArm', BOW.ex * wb, 0, 0);
      set('RightLowerArm', BOW.ex * wb, 0, 0);
      set('LeftHand', BOW.hand * wb, 0, 0);
      set('RightHand', BOW.hand * wb, 0, 0);
      /* 手指并拢虚握：拱手读的是"两只袖子并在一起"，指节只做"收"不张开 */
      for (const sd of ['Left', 'Right']){
        set(sd + 'IndexProximal', BOW.curl * wb, 0, 0);
        set(sd + 'MiddleProximal', BOW.curl * wb, 0, 0);
        set(sd + 'IndexIntermediate', BOW.mid * wb, 0, 0);
        set(sd + 'MiddleIntermediate', BOW.mid * wb, 0, 0);
        set(sd + 'ThumbProximal', BOW.thumb * wb, 0, 0);
        set(sd + 'ThumbIntermediate', BOW.thumb * 0.9 * wb, 0, 0);
        set(sd + 'ThumbDistal', BOW.thumb * 0.6 * wb, 0, 0);
      }
    }
    /* lean / headDown：马夫"看着马吃草"那种前俯，只动躯干和头（手臂不动）。
       品茶时头跟着低一点（a.sipW 是抬盏的权重，0~1）—— 人把盏送到嘴边时一定会低头。
       刷马时**直起身来**（前俯按 1−brushW 收掉）、低头盯着刷子。
       作揖再叠一层前俯（BOW.lean）：这是"礼"的主体，手臂只是配合。 */
    const lean = (o.lean || 0) * (1 - a.brushW) + BOW.lean * bw;
    const hd = (o.headDown || 0) * (1 - a.brushW) + (o.tea ? a.sipW * 0.12 : 0) + BRUSH.headDown * a.brushW
             + SCROLL.headDown * a.scrollW + BOW.head * bw;
    set('Chest', o.breath * b + 0.02 * w + lean + SIT.lean * st2, -GAIT.chestYaw * sw * w, o.sway * Math.sin(_t * 0.7 + a.phase));
    set('Spine', o.breath * 0.5 * b + lean * 0.45, -GAIT.chestYaw * 0.5 * sw * w, 0);
    set('Head', 0.012 * Math.sin(_t * 0.5 + a.phase) + hd, o.head * h, 0);
    set('Neck', 0.008 * Math.sin(_t * 0.5 + a.phase + 0.7) + hd * 0.45, 0.4 * o.head * h, 0);

    /* ── 坐姿/裙骨（k=跪坐权重）────────────────────────────────────────────
       ① 髋骨沿自身"下"轴下沉（不动 holder —— 它原点在地面）；
       ② 小腿/脚/脚趾骨缩到 0.10：跪坐时鞋与裤脚会从袍摆下伸出来，收进袍里；
       ③ 裙摆：走路的摆动（世界横向轴）+ 跪坐时前襟前翻，长度压缩、径向撑开。
       ⚠️ 缩放**每帧无条件写**（k=0 时写 1），否则切回站姿时腿还是缩着的。 */
    const hb = a.bones['Hips'];
    if (hb && a.hipsRest){
      hb.position.copy(a.hipsRest).addScaledVector(a.hipsDown, KNEEL.drop * k + SIT.drop * st2);
    }
    const legS = 1 - (1 - KNEEL.footScale) * k;
    for (const n of ['LeftLowerLeg', 'RightLowerLeg', 'LeftFoot', 'RightFoot', 'LeftToes', 'RightToes']){
      const bb = a.bones[n];
      if (bb) bb.scale.setScalar(legS);
    }
    if (a.skirt.length){
      const twoSeg = !!a.skirt[0].b;
      /* 两种坐姿各自压缩裙长、径向撑开；互斥 ⇒ 两段的系数相乘就等于取其一。
         跪坐髋到地 0.46（裙长要压到 0.55）、坐凳 0.54（压到 0.60）。 */
      const sq = (v) => (twoSeg ? Math.sqrt(v) : v);
      const lenE = (1 + (sq(KNEEL.skirtLen) - 1) * k) * (1 + (sq(SIT.skirtLen) - 1) * st2);
      const radE = (1 + (KNEEL.skirtRad - 1) * k) * (1 + (SIT.skirtRad - 1) * st2);
      /* 下段的翻转方向：跪坐 0.96（几乎对折回去）、坐凳 1.00（回到竖直、垂在膝前） */
      const swap = k + st2 > 1e-4 ? (k * KNEEL.kneeSwap + st2 * SIT.kneeSwap) / (k + st2) : 1;
      const sway = w * a.amp * 0.9 * sw;
      for (const sk of a.skirt){
        const front = Math.cos(sk.ang);                       // 0° = 正前 ⇒ 1
        /* 跪坐：前襟整片前翻（0.55+0.55·front）。
           坐凳：前襟要**压在平放的大腿上**（1.0·front），后片只轻带一点（0.18）——
                 后片跟着前翻会让裙摆从凳子背后翘起来，读成"裙子掀了"。 */
        const th = sway
          - k * KNEEL.lift * (0.55 + 0.55 * front)
          - st2 * SIT.lift * (0.18 + 1.00 * Math.max(0, front));
        const ba = a.bones[sk.a], ra = a.base[sk.a];
        if (ba && ra){
          q.setFromAxisAngle(sk.axis, th);
          ba.quaternion.copy(ra).multiply(q);
          ba.scale.set(radE, lenE, radE);
        }
        if (sk.b){
          const bb2 = a.bones[sk.b], rb = a.base[sk.b];
          if (bb2 && rb){
            q.setFromAxisAngle(sk.axis, -th * swap);
            bb2.quaternion.copy(rb).multiply(q);
            bb2.scale.set(radE, lenE, radE);
          }
        }
      }
    }
    /* 茶盏跟手：位置 = 腕 + 人物正前方 9cm + 上 2cm（摆到袖口之外，否则被长袖吞掉），
       姿态恒竖直（盏里的水面不斜）。
       ⚠️ 必须先 updateMatrixWorld —— 上面刚写完骨骼四元数，矩阵还是上一帧的
          （不刷就会"盏比手慢一帧"，抬盏那段最明显）。 */
    if (a.cup){
      const wr = a.bones.RightHand;
      /* 捧卷轴时盏收起来（两种手位互斥；不收起会"两手捧着卷轴、腕上还挂着盏"） */
      a.cup.visible = !o.scroll || a.scrollPhase === 2;
      if (wr){
        a.holder.updateMatrixWorld(true);
        wr.getWorldPosition(_cupV);
        const yw = a.holder.rotation.y;
        _cupV.x += Math.sin(yw) * TEA_CUP_FWD;
        _cupV.z += Math.cos(yw) * TEA_CUP_FWD;
        _cupV.y += 0.02;
        a.holder.worldToLocal(_cupV);
        a.cup.position.copy(_cupV);
      }
    }
    /* 刷子跟手：位置 = 腕 + 前臂方向 10cm；朝向 = 前臂方向（局部 +Z 指出去）
       ⇒ 刷面正对马身、随肘/腕一起动。同一帧里刷完骨骼才摆，理由同茶盏。 */
    if (a.brush){
      const wr = a.bones.RightHand, el = a.bones.RightLowerArm;
      const show = a.brushW > 0.04 && !!wr && !!el;
      a.brush.visible = show;
      if (show){
        a.holder.updateMatrixWorld(true);
        wr.getWorldPosition(_brV);
        el.getWorldPosition(_brE);
        _brV.sub(_brE);
        if (_brV.lengthSq() < 1e-8) _brV.set(1, 0, 0);
        _brV.normalize();                        // 前臂方向（世界）
        wr.getWorldPosition(_brE).addScaledVector(_brV, BRUSH.fwd);
        a.holder.worldToLocal(_brE);
        a.brush.position.copy(_brE);
        a.holder.getWorldQuaternion(_brQ2).invert();
        _brQ.setFromUnitVectors(_brZ, _brV).premultiply(_brQ2);
        a.brush.quaternion.copy(_brQ);
      }
    }
    /* 卷轴跟手：位置 = 两腕中点，X 轴 = 左腕→右腕，法线 = 前上方（纸面上仰 24°）。
       与茶盏/马刷同一条：先刷骨骼矩阵、再摆道具（否则道具比手慢一帧）。
       宽度按**实测手距**缩放（反解出的两手相距 0.268m ≠ 目标 0.31m），
       这样两端木轴始终落在两只手掌心里。 */
    if (a.scroll){
      const wl = a.bones.LeftHand, wr2 = a.bones.RightHand;
      const show = a.scrollW > 0.04 && !!wl && !!wr2;
      a.scroll.visible = show;
      if (show){
        a.holder.updateMatrixWorld(true);
        wl.getWorldPosition(_scL);
        wr2.getWorldPosition(_scR);
        _scC.copy(_scL).add(_scR).multiplyScalar(0.5);
        _scX.copy(_scR).sub(_scL);
        const spanW = Math.max(0.02, _scX.length());
        _scX.multiplyScalar(1 / spanW);
        const yw2 = a.holder.rotation.y;
        _scF.set(Math.sin(yw2), 0, Math.cos(yw2));                 // 人物正前（世界）
        _scY.set(0, Math.cos(SCROLL.tilt), 0).addScaledVector(_scF, -Math.sin(SCROLL.tilt));
        _scY.addScaledVector(_scX, -_scX.dot(_scY)).normalize();   // 与 X 正交（纸面才不平）
        _scZ.crossVectors(_scX, _scY).normalize();
        a.holder.worldToLocal(_scC);
        a.scroll.position.copy(_scC);
        _scM.makeBasis(_scX, _scY, _scZ);
        _scQ.setFromRotationMatrix(_scM);
        a.holder.getWorldQuaternion(_scQ2).invert();
        a.scroll.quaternion.copy(_scQ).premultiply(_scQ2);
        a.scroll.scale.set(Math.min(SCROLL.fwdMax, Math.max(SCROLL.fwdMin, spanW / SCROLL.span)), 1, 1);
      }
    }
    /* 草把跟手：**竖直**立在左手里（位置 = 腕位 + 上 5cm，朝向 = 世界上方 + 轻靠向身体），
       不跟前臂方向 —— 垂手时前臂朝下，跟它走草把就朝地了。
       同茶盏/马刷/卷轴：先刷骨骼矩阵再摆道具。 */
    if (a.hay){
      const wl = a.bones.LeftHand;
      a.hay.visible = !!wl;
      if (wl){
        a.holder.updateMatrixWorld(true);
        wl.getWorldPosition(_hyE);
        _hyE.y += HAY_ARM.up;
        /* 往**远离身体的一侧**再让出 0.13m。⚠️ 这只 rig 的 LeftHand 在人物的 **−z 侧**
           （yaw=π/2 时腕在 z=1.035、体心 1.3），所以"远离身体"是 (cosθ, 0, −sinθ)；
           第一版按"左手 = +z"算，草把被塞进袍子里（实测量到 z=1.198，离体心只有 0.10m）。 */
        const yw2 = a.holder.rotation.y;
        _hyE.x += Math.cos(yw2) * HAY_ARM.out;
        _hyE.z -= Math.sin(yw2) * HAY_ARM.out;
        a.holder.worldToLocal(_hyE);
        a.hay.position.copy(_hyE);
        /* 朝向：竖直、绕人物正前轴往外倒 HAY_ARM.lean（负号 = 倒向外侧），再换到 holder 局部 */
        _hyF.set(Math.sin(yw2), 0, Math.cos(yw2));
        _hyQ.setFromAxisAngle(_hyF, -HAY_ARM.lean);
        _hyQ2.setFromAxisAngle(_hyY, yw2).invert();
        a.hay.quaternion.copy(_hyQ2).multiply(_hyQ);
      }
    }
  }
}

export function tickActors(dt){
  if (!ACTORS.length) return;
  const d = Math.min(Math.max(dt, 0), 0.05);   // 位置用更紧的步长上限，掉帧也不会跳过端点
  _t += Math.min(Math.max(dt, 0), 0.1);
  advance(d);
}

/* 探针用：把 sim 快进 seconds 秒（软件渲染只有 1~3fps，实时等 6s 只走了 0.2s 的 sim）。
   与 tickActors 走同一份 advance()，不吃随机数、不改环境。 */
export function actorStep(seconds, quantum){
  if (!ACTORS.length) return;
  const q = quantum || 1 / 60;
  let acc = Math.min(Math.max(seconds, 0), 30);
  while (acc > 1e-6){ const d = Math.min(q, acc); _t += d; advance(d); acc -= d; }
}

/* 调试/探针用：a=on 走自家 route；b=指定 id 时只让那一个走 */
/* 探针用：切站 / 跪坐 / 坐凳（权重会平滑过渡，不会瞬移）。
   'sit' 与 'kneel' 互斥：切到其中一个就把另一个归零，否则两套腿角会叠加成怪姿势。 */
export function actorPose(id, pose){
  for (const a of ACTORS){
    if (id && a.def.id !== id) continue;
    a.kneelTarget = pose === 'kneel' ? 1 : 0;
    a.sitTarget   = pose === 'sit'   ? 1 : 0;
  }
}

/* 探针用：坐姿/对弈的参数对象（反解它们时要能改一改再看几何，不用改文件重跑） */
export function actorTune(){ return { SIT, GO_ARM }; }

/* 探针用：某个人物的骨骼表与**绑定姿态**（只在页内用 —— 返回的是 THREE 对象，
   跨 evaluate 序列化不了）。抚琴的肩/肘角度是"手落到弦上"反解出来的，
   探针必须在同一个任务里按同一套公式（rest × Euler XYZ）复算，不能只读当前姿势。 */
export function actorRig(id){
  const a = ACTORS.find(x => x.def.id === id);
  return a ? { bones: a.bones, base: a.base, holder: a.holder } : null;
}

export function actorWalk(id, on){
  for (const a of ACTORS) if (!id || a.def.id === id) a.walkOff = !on;
}

/* 探针用：迎客序列的现状（S2 验收要断"到站/间距/朝向/作揖同时性/文士没端茶"）。
   与 actorState 分开，是因为导演层只有一组状态，不必塞进每个演员里。 */
export function actorVisit(){
  const one = (id) => {
    const a = actorRef(id);
    if (!a) return null;
    return { id, pos: [+a.pos.x.toFixed(3), +a.y.toFixed(3), +a.pos.z.toFixed(3)],
             yaw: +a.yaw.toFixed(3), arrived: !!a.arrived,
             floorY: a.floorY == null ? null : +a.floorY.toFixed(3),
             scrollW: +(a.scrollW || 0).toFixed(3), sipW: +(a.sipW || 0).toFixed(3),
             moveW: +(a.moveW || 0).toFixed(3) };
  };
  return { phase: VISIT.phase, t: +VISIT.t.toFixed(2), bowW: +VISIT.bowW.toFixed(3),
           host: one(VISIT.hostId), guest: one(VISIT.guestId) };
}

export function actorState(){
  return {
    n: ACTORS.length,
    actors: ACTORS.map(a => ({
      id: a.def.id,
      pos: a.holder.position.toArray().map(v => +v.toFixed(3)),
      yaw: +a.holder.rotation.y.toFixed(3),
      bones: Object.keys(a.bones).length,
      mode: !a.def.route || a.walkOff ? 'stand' : (a.waitT > 0 ? 'wait' : 'walk'),
      kneelW: +a.kneelW.toFixed(3),
      sitW: +a.sitW.toFixed(3),
      /* 探针用（2026-10-23 客人走路）：脚下踏面/是否走完，判断"悬空/到站"不必再猜 */
      floorY: a.floorY == null ? null : +a.floorY.toFixed(3),
      arrived: !!a.arrived, target: a.target,
      /* 探针用：对弈块到底跑没跑 —— goId 从 idle 取，placeT 只有进了那块才会动 */
      goId: (a.def.idle && a.def.idle.go) || null,
      placeT: +a.placeT.toFixed(2),
      teaT: +a.teaT.toFixed(2),
      sipW: +a.sipW.toFixed(3),
      brushT: +a.brushT.toFixed(2),
      brushW: +a.brushW.toFixed(3),
      scrollPhase: a.scrollPhase,
      scrollW: +a.scrollW.toFixed(3),
      moveW: +a.moveW.toFixed(3),
      floorY: a.floorY === null ? null : +a.floorY.toFixed(3),
      floorTries: a.floorTries,
      step: +a.step.toFixed(3),
    })),
  };
}
