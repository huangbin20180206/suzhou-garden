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
import { makeSoftAlphaTex } from './15a-shared.js';
import { scene, renderer } from './02-scene.js';
import { groundHeight } from './05-water.js';
import { markCasterBoxDirty } from './09-lights.js';
import { figures } from './08b-figures.js';
import { PROP_SPOTS, QIN_LOW_SEAT, SEAT_SPOTS } from './14-props.js';
import { STABLE_ROAD_PTS, stableTravel, travelCarriagePlace, travelCarriagePark,
         travelCarriageVisible, travelCarriageTied } from './15-stable.js';
/* ⚠️ WALK_ROUTE（08d-tour）与 ENV（12-env）**不能静态 import**（2026-10-24 审核）：
   那两条各多出一个环 —— 16-actors → 12-env → 08-assemble → 16-actors，
   以及 16-actors → 08d-tour → 12-env → 08-assemble → 16-actors。
   现在没炸只因为两处都只在函数体里读；谁把读操作挪到顶层就是启动白屏（TDZ）。
   一律走 00-config 的延迟绑定：ENV 由 12-env 发布进 ENV_REF.env，
   WALK_ROUTE 由 08d-tour 发布进 HOOKS.walkRoute。 */
import { HOOKS, ENV_REF } from './00-config.js';
import { TEA_ARM, TEA_CUP_FWD, ease01, _cupV, makeTeaCup, BRUSH, _brV, _brQ2, makeBrush, SCROLL, _scL, _scX, _scF, _scQ, makeScroll, HAY_ARM, _hyE, _hyQ2, _hyY, makeHayHandful, _brE, _brQ, _brZ, _scR, _scC, _scY, _scZ, _scM, _scQ2, _hyF, _hyQ } from './16a-actor-props.js';

const ACTORS = [];
let _built = false;
let _t = 0;
let _envRefWarned = false;      // ENV_REF.env 缺失只喊一次（否则每帧刷屏）

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
/* ── 正堂太师椅（厅堂端坐）──────────────────────────────────────────────────
   与跪坐/石桌对弈同为“坐”，但**座高完全不同**：石桌鼓凳 0.452（地台），正堂太师椅
   1.71（台基 1.24 + 座面 0.47）。原 SIT 按鼓凳反解，搬到厅堂会**髋沉 0.28m、腿插座底、
   裙摆压进椅面**——正是“厅堂穿模”的根因。单列一组数：drop 0.12 按“髋≈座面+0.05”反推
   （gy 0.93 + hipH 0.89 − drop = 1.76 ⇒ drop 0.06，留 0.06 余量防浮），
   裙摆压缩收小（0.60→0.72，长椅腿不压短），lean/headDown 收成端坐（0.18）。 */
const HALL_SIT = {
  drop: 0.12, thigh: 1.44, knee: 1.50, foot: 0.0, lean: 0.18, headDown: 0.18,
  skirtLen: 0.72, skirtRad: 1.20, lift: 0.90, kneeSwap: 1.00,
};
/* ── 车夫坐姿（2026-10-27 老黄："马夫依旧是缩成一团"）──────────────────────────
   车夫用的是 SIT（给石桌对弈反解的 lean 0.52）：坐在高高的车夫座上再深弓 0.52，
   读作"缩成一团"。车夫要直腰拉缰，只需轻微低头看马；腿仍沿用 SIT 的坐姿角度
   （座面 1.15 与凳面不同，但这一组数至少保证不劈叉/穿车）。 */
const COACH_SIT = Object.assign({}, SIT, { lean: 0.08, headDown: 0.12, skirtLen: 0.72 });
/* ── 对弈坐姿（2026-10-27 老黄："还是一副睡着了的样子，两人都坐直"）──────────────
   SIT 的 lean 0.52 / headDown 0.46 是**为"手够到盘面"反解的**（见 GO_ARM 注释）：
   上身压得很低，画面上就是两个人伏在桌上打瞌睡。这里把上身抬到 0.40、头只低 0.16
   —— 手会随肩一起后移约 5cm，但最深的那只落子手仍在盘边（盘半径 0.30）。
   若要再抬（0.30 以下）必须重跑 actor-go-solve 那套反解，否则手会离盘。 */
const GO_SIT = Object.assign({}, SIT, { lean: 0.18, headDown: 0.08 });
function curSit(a){
  if (a.def.id === VISIT.coachId) return COACH_SIT;
  if (a.def.id === 'go1' || a.def.id === 'go2') return GO_SIT;
  return (a.def.id === 'scholar' || a.def.id === 'guest') ? HALL_SIT : SIT;
}

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
/* ── 井边孩童：主人离席迎客后，两书童跑去井边与仕女玩 ────────────────────────
   井心 −20.4,−6.1；井台外径 0.76；仕女在 −19.2,−5.2 面井。两子分别到井的南北侧
   空草地，与仕女保持 0.8~1.0m 间距，围成“井边玩”构图。 */
const CHILD_WELL = {
  c1: [-19.6, -6.9],
  c2: [-21.0, -5.6],
};

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

/* 茶盏（青白瓷，与石桌上那套同材质）：盏身 + 盏里那汪茶汤。原点在**盏底中心**。
   茶汤那圈深色只在这盏里用（2cm 的小圆片、永远在盏内），不登记天气角色。 */

/* 马刷：木背 + 鬃毛刷头 + 短柄。原点在**腕心**，局部 +Z = 前臂方向（朝马身）。 */
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

/* ── 客人到访 · 导演层（S2 出迎+作揖 / S3 并排同行）──────────────────────────
   极小的状态机。**所有推进都读演员自己的状态**（arrived / 朝向差），
   不用墙钟：掉帧、软件渲染、探针的 actorStep 快进走的都是同一条路径。
     idle   → 客人走到门内（guest.arrived）
     stow   → 主人先把卷轴放下（0.55s）
     walk   → 放主人出门（scholar 沿 HOST_GREET_PTS 走一趟），等他到站
     face   → 两人站住互指（2.1rad/s 站转，不平移），≥1.2s
     bow    → 同时作揖一次（BOW 的时序）
     line   → 各自走到"并排线"的起点（横向 ±gap，见 PAIR）
     pair   → 并排走完门 → 桥 → 堂前（各自的偏移航点，见 PAIR）
     hall   → 到堂前站定（S4 入座奉茶从这里接）
     sit    → 端坐；S5 送客接在其后：rise → exit → eline/epair（并排回门内）
              → eface/ebow（门内送客揖）→ watch（目送）→ hostback → reenter/reseat
              （主人回座）→ done（终态，见 ESCORT 注释）
   文士的日常捧卷/端茶在整个过程中**保持关闭**（否则客人还站着、他已经读起书来）。
   ⚠️ 文士的 scroll/tea 是互斥手位状态机，必须在这里退出 —— 否则他会"边走边端着茶盏"。 */
const VISIT = {
  phase: 'idle', t: 0, bowW: 0,
  hostId: 'scholar', guestId: 'guest', coachId: 'laborer',
  greetPt: [0, 19.75],      // 门内 1.15m：两人面对面站定的位置（客人停在 0,20.9）居中过月洞门
  path: null, s: 0,            // 并排段的参数化航点（弧长驱动，见 pathTable）
  tourS: 0, tourPath: null,
  guestSent: false, hostSeated: false,
  /* 2026-10-23：马车版到访是默认；?visit=walk 保留旧的"客人自己走进来 + 走回去"分支。
     默认要求**白昼 + 不下雨不下雪**（见 visitWeatherOK），不满足时客人不出现。 */
  mode: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('visit') === 'walk')
        ? 'walk' : 'carriage',
};

/* ── 马车版到访（2026-10-23）──────────────────────────────────────────────────
   老黄："马车版到访（坐车到马厩→下车进园，与现在步行是反向）… 马和马车的动态，
   马夫驾车，马夫系马，客人下马，然后接客人步行通过石板路入园"。
   编排（全部由 sim 时钟推进，探针 actorStep 快进走同一条路径）：
     马夫在车夫位驾车 → 车从石板路驶到马厩院门外停稳 → 马夫跳下车、走到马头前
     把缰绳拴好（抬手 + 可见的引绳）→ 客人起身下车 → 客人沿石板路走向园门 →
     （S2~S4：主人出迎、作揖、并排入堂、奉茶、叙话）
     → 两人起身出堂 → **单列游园一圈**（池南岸→山脊→桥头，复用 WALK_ROUTE 的闭合环线）
     → 园门内作揖 → 客人回马厩、上车 → 马夫解绳、上车 → 马车倒出、调头、南下离开
     → 主人回堂落座 → done（冷却后自动重播）。
   ⚠️ 马车停在院门外、**头朝院里**（马头正好够到院内横杆）。离开时先**倒车 3.4m** 出到
      空旷处再原地调头 —— 六米长的车马在 3.6m 院门里直接掉头会扫到门柱。
   ⚠️ 车轮/马腿的相位由**里程**驱动（travelCarriagePlace 的 dist），不是墙钟。 */
const CARRY = {
  speed: 1.10, arriveSpeed: 2.60, backSpeed: 0.55, turnRate: 1.15,
  /* 驶入 / 驶离都走**出园新路**（2026-10-25 老黄："客人乘车离开还是在走去院子的石板路，
     这个不合理，做一条新路，朝向屏幕右下角……客人来访就反过来就行"）。
     新路 = 15e-stable 的 STABLE_EXIT_PTS（马厩院门 → 东南 → 一路出画），这里只是取它的
     中线航点。⚠️ 起点取**最远端**（85,46.8）：车在画面外出现、再开进来，不会"凭空冒出"；
     远端到院门约 75m，用 arriveSpeed 2.6 跑 ≈29s，最后 12m 平滑收到 1.1 停下。
     旧值（沿进园石板路从北面来）已撤：那条路现在只给步行版到访用。 */
  arrive: [[85.0, 46.8], [76.4, 40.4], [68.4, 34.6], [61.6, 29.4], [56.0, 24.8],
           [51.4, 20.6], [47.6, 16.8], [44.6, 13.4], [42.4, 10.2], [40.9, 7.2], [40.0, 4.0]],
  /* 倒车：沿车头相反方向退到空旷处（车仍朝院里 ⇒ 位置向南走） */
  backTo: [40.0, 7.4],
  /* 调头后的离场：从院门口拐上**新路**向东南开，到路尽头（已经出画）连人带车隐去 */
  depart: [[40.0, 7.4], [41.3, 8.6], [42.4, 10.2], [44.6, 13.4], [47.6, 16.8],
           [51.4, 20.6], [56.0, 24.8], [61.6, 29.4], [68.4, 34.6], [76.4, 40.4], [85.0, 46.8]],
  seat: { x: 0.0, y: 1.12, z: -0.55 },      // 厢内横凳面（bedY 0.72+0.38=1.10，留 0.02 余量；z 对准后壁前 0.24m，坐姿不顶后壁）
  coach: { x: 0.0, y: 1.15, z: 0.72 },      // 车夫木座面（bedY 0.72+0.42=1.14，坐姿落点；旧值 0.785 为站姿，已抬高）
  side: { x: -1.10, z: -0.10 },              // 下车落脚点（车左侧，厢门中缝侧）
  coachGround: { x: 1.15, z: 0.55 },         // 马夫从车夫位跳下来的落点
  coachTie: { x: 0.95, z: 1.95 },            // 系马时站的位置（马头前侧）
};

/* 游园环线：堂前 → 拱桥 → 桥南 → **池南岸/山脊/桥头一圈**（WALK_ROUTE，已在 08d 逐点
   射线验过）→ 廊道 → 东南假山 → 门内。单列走（园径最窄处 ~0.9m，并排会互相穿袍摆）。
   ⚠️ 惰性构建：HOST_GREET_PTS / pathTable 都在本段**之后**才声明（const 有 TDZ），
      模块求值期读会直接 ReferenceError。 */
let _tourPath = null;
function buildTourPath(){
  if (_tourPath) return _tourPath;
  /* WALK_ROUTE 走 HOOKS 延迟绑定（见文件头 import 处的注释）。这里已经是运行期
     （开演后才调用），08d 早发布好了；没发布说明模块图出了问题，宁可炸得响亮。 */
  const WALK_ROUTE = HOOKS.walkRoute;
  if (!WALK_ROUTE || !WALK_ROUTE.length){
    throw new Error('16-actors: HOOKS.walkRoute 未发布（08d-tour 未加载？）');
  }
  const L = WALK_ROUTE.length;
  const k = 15;                                  // WALK_ROUTE[15] = (8.05, 9.75) 桥南平台
  const loop = [];
  for (let i = 1; i <= L; i++) loop.push(WALK_ROUTE[(k + i) % L]);
  _tourPath = pathTable([...HOST_GREET_PTS.slice(0, 11), [8.05, 9.75], ...loop,
                         ...HOST_GREET_PTS.slice(11)]);
  return _tourPath;
}
const TOUR = { speed: 0.62, gap: 0.95 };

/* 马车/马夫的子状态机（与 VISIT.phase 并行：主人回堂与客人上车是两件事）。 */
const VISCAR = {
  state: 'parked', t: 0, s: 0, path: null, last: null,
  alighting: false, coachOff: false, tieOn: false,
  boardStarted: false, guestOn: false, coachOn: false, coachWalk: false,
  leg: '', legT: 0,
  odo: 0,                    // 累计里程（车轮/辕马腿相位）；跨段连续，见 driveout 注释
};

/* 卷轴纸：奶白底 + 八列竖排"墨点" + 一方朱印。
   不写真字 —— 5m 外只是一列列墨点，写真字反而会露出分辨率；抖动是确定性的
   （sin 哈希），不吃全局/私有随机流。 */
const HOST_GREET_PTS = [
  [1.2, -5.7], [3.5, -5.4], [6.0, -4.0], [7.6, -3.2],          // 堂前 → 桥北踏步
  [8.3, -2.0], [8.3, 0.5], [8.3, 2.0], [8.3, 4.6],              // 拱桥：1.30 → 2.10
  [8.3, 7.0], [8.3, 8.8], [8.3, 9.6], [8.3, 10.4], [8.3, 11.2], // 桥面 → 架高廊道（1.30）
  [8.3, 12.0], [8.3, 12.8], [8.7, 13.2],                       // 廊道南端逐级下坡
  [9.5, 13.4], [11.0, 13.5], [12.5, 13.8],                     // 下到地面
  [13.3, 15.0], [13.5, 17.0], [12.5, 18.8],                    // 绕假山东侧
  [9.0, 19.6], [5.0, 19.8], [2.0, 19.9], [0, 19.75],        // 门内空地向西 → 迎客点（居中过月洞门，原 0.15 偏东致底缘窄处穿模）
];

/* ── 并排同行（S3 · 2026-10-23）──────────────────────────────────────────────
   航点 = **S2 路线的反向**（同一条线已经逐点验过能走，见 docs §6），两人各按
   法线方向偏 ±gap 走各自的那条：主人靠内侧（园内一侧，z 更小/x 更小）。
   ⚠️ **偏移必须用航点自身的法线算，不能按世界 x 加**：拱桥那一段路沿 z 走、
      桥面中心 x=8.3、两侧栏杆在 6.95/9.85 —— 按世界 x 加会让"并排"变成"一前一后"
      （实测：按世界 x 加时过桥那一段两人纵向错开 0.9m，读作"主人在前面领路"）。
   ⚠️ gap 0.45 ⇒ 两人中心距 0.90m。再宽就出桥面（2.9m 宽减去两侧栏杆各 0.5m），
      再窄两条长袍下摆会互相穿（下摆半宽 ≈0.35m）。 */
const PAIR = {
  speed: 0.62, gap: 0.45,
  pts: [...HOST_GREET_PTS].reverse(),
};

/* ── 入座（S4 · 2026-10-23）──────────────────────────────────────────────────
   两把太师椅实测（outputs/_diag/hall-seat-layers.mjs，按 04-buildings 的
   makeChair(±1.35, zBack+2.9) + hall.position.z = −12.8 算，再用射线复核座面 1.75）：
     · 椅心 (±1.35, −13.6)、座面顶 1.75（地面 1.24 + 座厚 0.09/2 + 座高 0.47）；
     · 椅子朝 +z（面向堂门）⇒ "落座"是人朝 +z、椅子在**身后**，退半步坐下去。
   堂前 → 椅子的台阶（同一份日志）：
     草地 −0.2 → 踏跺一级 0.31（z −6.0~−6.4）→ 二级 0.62（z −6.8~−7.2）→
     月台/堂内地面 1.24（其上还有一层 1.30 的铺地砖）。
   ⚠️ 最后一级 0.62 超过默认"一步"窗口 0.42 ⇒ 这一段把 stepUp 临时放到 0.70，
      站到地上立刻收回 0.42（否则椅面 1.75 会被当成台阶、"坐"变成"站到椅子上"）。
   ⚠️ 月台踏跺只有 4.6m 宽（x ±2.3）、堂门只开中间一开间 ⇒ 进门时收到 x ±0.45
      再往两边分椅；直接按 ±1.35 走会擦到门框。 */
const SEAT = {
  yaw: 0,                       // 椅子朝 +z（面向堂门），坐的人也是 +z
  host: [-1.35, -13.6],
  guest: [1.35, -13.6],
  frontZ: -12.55,               // 站定（还没转身）的位置
};
const ENTER_PTS = {
  host: [[1.14, -5.25], [0.0, -5.95], [-0.45, -6.3], [-0.45, -6.95], [-0.45, -7.6],
         [-0.45, -8.9], [-0.9, -10.3], [-1.35, -11.7], [-1.35, -12.55]],
  guest: [[1.26, -6.15], [0.45, -6.4], [0.45, -6.95], [0.45, -7.6],
          [0.45, -8.9], [0.9, -10.3], [1.35, -11.7], [1.35, -12.55]],
};

/* ── 送客（S5 · 2026-10-23）──────────────────────────────────────────────────
   喝完茶起身送客，把 S2~S4 的路线全部倒着走一遍（同一条线已逐点验过能走）：
     rise       起身（sitTarget=0，坐姿自己缓下来）
     exit       倒走出堂（ENTER_PTS 反向）
     eline/epair 并排回门内：航点 = HOST_GREET_PTS（S2 迎客路线本身方向）
     eface/ebow 门内再作揖一次（送客礼，复用 BOW 全套）
     watch      目送 3.5s；客人沿石板路回马厩（STABLE_ROAD_PTS 反向 = S1 的逆）
     hostback   主人沿 S2 路线反向回堂前 → reenter/reseat 重进堂坐回太师椅 → done
   ⚠️ 并排偏移号与 S3 **相反**（host +gap / guest −gap）：出堂时主人在西 (−1.35)、
      客人在东 (+1.35)，并排线起点必须接得上各自的出口位置 —— host=+gap 时主人
      恰落在 (1.14,−5.25) 原地、客人只挪 0.9m；沿用 S3 的符号两人会交换位置、
      从对方身上穿过去（S3 的'line'相位就是这么防"各追各的点"的）。
   ⚠️ 终态是 'done'（不是 'idle'）：visiting 门控靠 phase!=='idle' 压住文士的
      捧卷/端茶 —— 坐回椅子的人不该突然捧起卷轴；也防 'idle' 里 guest.arrived
      的早退把整场戏立即重播（"可重播"与否还没拍板，先不做）。 */
const EXIT_PTS = {
  host: [...ENTER_PTS.host].reverse(),
  guest: [...ENTER_PTS.guest].reverse(),
};
const GUEST_HOME_PTS = [[0, 20.9], [0, 23.55], ...[...STABLE_ROAD_PTS].reverse()];
const HOST_RETURN_PTS = [...HOST_GREET_PTS].reverse();       // 门内 → 堂前（S2 反向）
const ESCORT = {
  /* ⚠️ 从第 2 个点起排（去掉堂前 [1.2,−5.7]）：它的 ±0.45 偏移点里客人那个
     (1.26,−6.15) 落在月台踏跺带内（踏跺 z −6.0~−6.4、一级顶 0.31），而
     0.31 − 草地(−0.2) = 0.51 超出"一步"窗口 0.42 ⇒ 走上去会陷进台阶里。
     从 [3.5,−5.4] 起排后，并排线起点 (3.44/3.56, −4.95/−5.85) 与两个出口位置
     (1.14/1.26, −5.25) 之间全程是草地，无台阶；并排段比 S3 少这 1.3m 堂前浅草。 */
  pts: HOST_GREET_PTS.slice(1),
  hostLat: PAIR.gap, guestLat: -PAIR.gap,       // 与 S3 相反，理由见上
};

const DEFS = [
  {
    id: 'scholar',
    url: 'assets/fig-scholar.glb',
    height: 1.72,
    hidePose: 'read',
    tint: 0xAEB9C9,          // 生成件偏亮蓝；压一点饱和，贴近场景的工笔淡彩
    /* 2026-10-25 着装：主人换成**藏青**（压暗 + 提饱和）。蓝衣在生成件上已经"很雅"，
       但一眼看不出"这家有钱"——深青直裰是明清文士的正装色，比浅蓝更像当家人。 */
    dye: { hue: 0.96, w: 0.14, shift: 0.02, sat: 1.55, val: 1.06 }, // 绛紫绸（2026-10-27 压深一档：1.22 太亮，读作粗布）
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
    /* 垂手系数 0.75（= −0.60rad，默认 1.5 ⇒ −1.2）：−1.2 时手贴得很紧好看，但摆臂只能绕
       上下走（实测 y 摆 0.28、前后只有 0.11 = "张翅膀"）；−0.6 时前后摆 0.24、上下 0.08。
       手离身体略远一点（±0.42），换来的是一走路就像人。 */
    armDownK: 0.75,
    /* 落座（S4）：太师椅是"正式厅堂的坐"，SIT.lean 0.52 是给石桌对弈
       （手要搭到盘面上）解的 —— 原样搬过来会读成"弓着背"。按 0.40 收成端坐。 */
    sitLeanK: 0.40,
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
    /* ⚠️ 2026-10-27：马夫拆成两个人 —— `laborer` = 车夫（只在到访时驾车/系马），
       `groom` = 常驻马厩的喂马/刷马人。两者共用同一件 GLB。
       车夫不再负责替换程序化马夫（hidePose 交给 groom），也不带草把/马刷；
       否则到访结束后他回到马厩，会和常驻马夫重叠、并且带着坐姿（见 resetVisit）。 */
    hidePose: null,
    hideUntilVisit: true,    // 到访开始前不出现（马厩的常驻马夫是 groom）
    tint: 0xDFE2D8,          // 冷一点的灰，和院子的黄沙地分开（暖米色会糊在沙里）
    /* ⚠️ 2026-10-27 撤掉染衣（老黄："马夫的脸色应该是正常的亚洲黄种人的肤色"）：
       原来给车夫配了 `dye { hue: 0.08, w: 0.16, shift: 0.55 }` 把袍子转成石青，
       好和常驻马夫区分。但这条色相带 0.08±0.16 **正好覆盖肤色**（黄种人皮肤 h≈0.05~0.09），
       而这张脸贴图的明度又低于 uDyeVMax 闸门 ⇒ **连脸一起被染成青蓝**（老黄截图里那个蓝脸）。
       现在两人不再同框（车夫在场时把常驻马夫收起，见 setGroomVisible），染色没有必要了。 */
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
    /* 车夫：站立时不再抱草/刷马（那是 groom 的活），只保留呼吸与轻微低头。 */
    idle: { breath: 0.012, head: 0.035, sway: 0.006, phase: 3.1, lean: 0.06, headDown: 0.10 },
  },
  {
    /* 常驻马厩的马夫（2026-10-27 从 laborer 里拆出来）：位置/朝向/动作沿用 P3 反解结果
       （x=38.0, z=1.30, yaw=π/2：刷尖到马身 42~74mm、命中高度 1.16~1.28m 的颈颌）。
       ⚠️ 这两个人共用 fig-laborer.glb；groom 负责 hidePose:'pointDown' 替换程序化马夫，
       laborer 不再替换（它只在到访时出现，平时 holder.visible=false）。 */
    id: 'groom',
    url: 'assets/fig-laborer.glb',
    height: 1.70,
    hidePose: 'pointDown',
    tint: 0xD8D2C2,
    spot: { x: 38.0, z: 1.30, yaw: Math.PI * 0.5 },
    floorRay: true,
    route: null,
    idle: { breath: 0.012, head: 0.035, sway: 0.006, phase: 3.1, lean: 0.07, headDown: 0.14,
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
    /* 2026-10-25 着装：书童原来是一身暗红 + 白围裙，远看像仆役。改成**朱红**（提亮提饱和），
       与另一个孩子的秋香黄分开 —— 大户人家的孩童本来穿得鲜亮。 */
    dye: { hue: 0.99, w: 0.11, shift: 0.00, sat: 1.32, val: 1.38 },
    spot: { x: 1.80, z: -5.25, yaw: -2.21 },   // 面向先生（1.2,−5.7）
    route: null,
    floorRay: true, followFloor: true, floorMax: 1.20,
    idle: { breath: 0.018, head: 0.055, sway: 0.009, phase: 0.9, hopEvery: [9, 22], hopH: 0.20 },
  },
  {
    id: 'child2',
    url: 'assets/fig-child.glb',
    height: 1.16,
    hidePose: 'child',
    tint: 0xDCE0E8,
    /* 另一个孩子改成**秋香/杏黄**（红相 shift +0.16 ⇒ 黄绿相）：两人同框一眼分得开，
       也符合"这家有钱"的读法（明代孩童常穿鲜艳的绢衣）。 */
    dye: { hue: 0.99, w: 0.11, shift: 0.16, sat: 1.08, val: 1.24 },
    spot: { x: 0.62, z: -5.10, yaw: 2.37 },    // 面向先生（1.2,−5.7）
    route: null,
    floorRay: true, followFloor: true, floorMax: 1.20,
    idle: { breath: 0.016, head: 0.05, sway: 0.008, phase: 4.2, hopEvery: [14, 30], hopH: 0.16 },
  },
  /* ── 低案抚琴（P2 第一件"坐着的动作"）────────────────────────────────────────
     同一件文士资产第二次 parse（与两个书童同款做法），坐位坐标由 14-props 的
     QIN_LOW_SEAT 给 —— 桌与人是**一处真值**推出的两个点，不在这里另写一份。
     ⚠️ 2026-10-25：整套（低案 + 此人）从"堂前月台"搬进**水榭**，并取代原来那套
        「高琴案 + 鼓凳 + 低模抚琴人」（老黄绿框："抚琴人应该在右侧凉亭里面，替代原有的低模"）。
        ⇒ 现在水榭里只有这一个人，`hidePose` 仍留空是对的（没有程序化替身要藏）。
     ⚠️ 站在**水榭台基**上：y 来自 QIN_LOW_SEAT（0.62），floorRay 再按真实踏面兜一道；
        floorMax 1.70 是因为台基顶面 0.62 会被默认上限 0.8 判成屋顶丢掉。 */
  {
    id: 'qin',
    url: 'assets/fig-scholar.glb',
    height: 1.72,
    hidePose: null,
    tint: 0xC6BFAE,          // 暖褐（与讲学那位蓝灰长衫分开，同一件资产不成"照镜子"）
    /* 2026-10-25：同一件资产第二次 parse，光靠 tint 分不开（乘色改不了色相）⇒ 用 dye 把
       衣料从蓝相转到**竹青/石绿**（shift −0.18），和主人的藏青、客人的月白都隔开。 */
    dye: { hue: 0.60, w: 0.16, shift: -0.18, sat: 1.02, val: 1.10 },
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
    dye: { hue: 0.58, w: 0.13, shift: 0.00, sat: 1.28, val: 1.12 }, // 月白偏天青鲜亮（与主人绛紫分开）
    spot: { x: 40.0, z: 4.2, yaw: -0.13 },      // 马厩门口（石板路起点），面朝路
    floorRay: true,
    followFloor: true,
    floorMax: 1.20,
    /* 步幅 0.34（默认 0.42）：老黄"脚跑在身体前面"——长袍遮腿、脚只在袍摆下露一截，
       步幅一大就是"脚先到、身子后到"。收到 0.34 后脚的前后摆幅 0.34，读起来是小步快走。 */
    stepLen: 0.34,
    /* 垂手系数 0.6（默认 1.5 × armDown 0.8 = 1.2rad）：这件资产的绑定姿势**本来就近垂手**
       （x=0 时手在 ±0.47），套主人那套 −1.2 会把双手收到胸前（实测 x=−1.2 ⇒ 手 ±0.13/1.05/0.38
       ——出图就是"双手抱在身前"）。0.6 ⇒ −0.48rad ⇒ 手 ±0.35/0.87/0.19，自然垂在大腿旁。 */
    armDownK: 0.6,
    /* 2026-10-23：路线改由**到访导演层**给（马车停稳、客人下车之后才起步）。
       旧版写死的"一进页面就沿石板路走"在马车版里会与上下车打架。
       `hideUntilVisit`：不满足白昼/天气条件时客人不出现（老黄："下雨下雪不出现"）。 */
    route: null,
    hideUntilVisit: true,
    idle: { breath: 0.014, head: 0.05, sway: 0.008, phase: 5.4, armDown: 0.80 },
    sitLeanK: 0.40,          // 同文士：坐太师椅不弓背
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

/* ── 垂手（2026-10-25 修「胳膊横在身侧」）────────────────────────────────────────
   老黄黄框："主人的手摆动动作好像很怪异"。
   实测（outputs/_diag/actor-armdown-scan.mjs）：armDown 写的是**绕 Y**，而绑定姿势是
   A 姿势（手臂沿 ±X 张开）⇒ 绕 Y 等于沿胳膊轴原地拧，1.6rad 手只挪 4cm，等于全程空转；
   卷轴一放下（迎客时）手就从胸前**弹回 ±0.65m**，那一下就是"甩胳膊"。
   真正把手放下来的是**绕 X，且左右两只骨镜像反号**（actor-armdown-solve.mjs：左 −、右 +）。
   1.2rad ⇒ 腕心 (±0.28, 0.91, 0.23)：手落在身侧略前、与大腿齐 —— 直裰垂手的读法。
   系数取 1.5 是为了让 idle.armDown=0.80 用同一套权重语义（0.8×1.5=1.2rad）。 */
const ARM_DOWN = 1.5;

/* ── 自然垂手（2026-10-27 第三版：上臂双轴 + 手腕三轴）─────────────────────
   老黄三轮反馈："手摊在身前" / "这叫自然下垂并随脚步轻微摆动？"。
   前两版都只绕 X 转，画面上仍然是"一只手整条前伸、掌心朝下"——
   实测（outputs/_diag/arm-2axis-2026-10-27.mjs、hand-sweep-2026-10-27.mjs）：
     · 只绕 X 时，客人走路的上臂只转了 8~21°，腕还在体侧 **0.40m**（应 0.24m）；
     · 腕的朝向由**手骨**决定：不转手骨时手指朝前（z≈0.7）、掌面朝下，
       正是"摊手"的样子；
     · 要把手放到大腿旁、掌心朝内，必须上臂**同时绕 X（收下）和 Z（内收）**，
       再把手腕三轴转过来（手指朝下、掌侧朝身体）。
   实测解（腕位是人物局部系，括号里是手指/掌侧方向）：
     客人 x=−0.55 z=±0.25 ⇒ 腕 (±0.245,0.825,0.202)，手指 (∓0.3,−0.95,0.11)，掌侧朝身体；
     文士 x=−0.30 z=±0.30 ⇒ 腕 (±0.25 ,0.836,0.125)，同样手指朝下。
   ⚠️ z 与 hy/hz **左右镜像**：这套骨架左右骨局部轴不对称，照抄会把另一只手的掌心翻到外面。
   ⚠️ 步行的前后摆仍只叠在上臂 X 上（±0.16rad）——Z 是"内收"，不参与摆。 */
const RELAXED_ARM = {
  guest:   { x: -0.55, z: 0.25, hx: -1.5, hy: 0.75, hz: 1.5, ex: 0.06 },
  scholar: { x: -0.30, z: 0.30, hx: -1.5, hy: 0.75, hz: 1.5, ex: 0.06 },
};

/* 贴地软影的材质（全部人物共用一份，只建一次）。
   ⚠️ 用 map 不用 alphaMap：makeSoftAlphaTex 的渐变在 **alpha 通道**里，
      alphaMap 只读绿通道（白底全 1）⇒ 会变成一块实心黑方块（马厩那边踩过）。 */
let _actorBlobMat = null;
function getActorBlobMat(){
  if (!_actorBlobMat){
    _actorBlobMat = new THREE.MeshBasicMaterial({
      map: makeSoftAlphaTex(), color: 0x000000,
      transparent: true, opacity: 0.18, depthWrite: false,
    });
  }
  return _actorBlobMat;
}

/* 绑腿材质（全部角色共用一份；色接近鞋的深褐黑，远看是裤脚/绑腿）。 */
let _legWrapMat = null;
function getLegWrapMat(){
  if (!_legWrapMat){
    _legWrapMat = new THREE.MeshStandardMaterial({ color: 0x2A2723, roughness: 0.94, metalness: 0.0 });
  }
  return _legWrapMat;
}

/* ── 衣料染色（2026-10-25）──────────────────────────────────────────────────
   老黄："所有成人的着装都一样，包括两个孩子，而且特别素雅，不像能住得起这种大院的人家"。
   生成件是**单张贴图、整套衣服一个色相** ⇒ 直接乘 material.color 只能压暗、改不了色相
   （蓝衣乘暖褐仍是蓝的，这就是"抚琴人 tint 设成暖褐却还是蓝的"的原因）。
   这里改成在片元里**按色相带**重染：只动"饱和度高、且色相落在指定带内"的像素 ——
   皮肤（橙相、低饱和）、白发、白袜、腰带都不在带内，不会被误染。
   每个角色的参数写在 DEFS 的 `dye` 里，改衣服颜色只改那一行。 */
const DYED_DECL =
  'uniform float uDyeHue; uniform float uDyeW; uniform float uDyeShift;\n' +
  'uniform float uDyeSat; uniform float uDyeVal; uniform float uDyeAmt; uniform float uDyeVMax;\n' +
  'vec3 dyeRgb2Hsv(vec3 c){\n' +
  '  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);\n' +
  '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));\n' +
  '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n' +
  '  float d = q.x - min(q.w, q.y);\n' +
  '  float e = 1.0e-10;\n' +
  '  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);\n' +
  '}\n' +
  'vec3 dyeHsv2Rgb(vec3 c){\n' +
  '  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);\n' +
  '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n' +
  '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n' +
  '}\n';
const DYED_BODY =
  'if (uDyeAmt > 0.001){\n' +
  '  vec3 dh_ = dyeRgb2Hsv(diffuseColor.rgb);\n' +
  '  float hd_ = abs(dh_.x - uDyeHue); hd_ = min(hd_, 1.0 - hd_);\n' +
  '  float band_ = 1.0 - smoothstep(uDyeW, uDyeW + 0.08, hd_);\n' +
  '  float sat_ = smoothstep(0.10, 0.26, dh_.y);\n' +
  /* 只染**暗部**：皮肤比衣料亮得多，而色相带在红相附近会绕回来（0.99±0.11 覆盖到 0.05），
     单靠色相挡不住脸 —— 实测孩子被染成绿脸。衣料 value≈0.3~0.5、皮肤≈0.7~0.85。 */
  '  float vmask_ = 1.0 - smoothstep(uDyeVMax - 0.10, uDyeVMax, dh_.z);\n' +
  '  vec3 t_ = dh_;\n' +
  '  t_.x = fract(t_.x + uDyeShift);\n' +
  '  t_.y = clamp(t_.y * uDyeSat, 0.0, 1.0);\n' +
  '  t_.z = clamp(t_.z * uDyeVal, 0.0, 1.0);\n' +
  '  diffuseColor.rgb = mix(diffuseColor.rgb, dyeHsv2Rgb(t_), band_ * sat_ * vmask_ * uDyeAmt);\n' +
  '}\n';

function dyeMaterial(m, dye){
  if (!m || !dye) return;
  const U = {
    uDyeHue:   { value: dye.hue === undefined ? 0.6 : dye.hue },
    uDyeW:     { value: dye.w === undefined ? 0.16 : dye.w },
    uDyeShift: { value: dye.shift || 0 },
    uDyeSat:   { value: dye.sat === undefined ? 1 : dye.sat },
    uDyeVal:   { value: dye.val === undefined ? 1 : dye.val },
    uDyeAmt:   { value: dye.amt === undefined ? 1 : dye.amt },
    /* 只染比这个更暗的像素（HSV 的 value）。默认 0.66：衣料 0.3~0.5、皮肤 0.7~0.85，
       所以皮肤与白袜一律不染 —— 红相带绕回 0.05 时靠它挡脸（实测没这道闸孩子会绿脸）。 */
    uDyeVMax:  { value: dye.vMax === undefined ? 0.66 : dye.vMax },
  };
  const prevCB = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (shader, renderer){
    if (prevCB) prevCB.call(this, shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DYED_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + DYED_BODY);
  };
  m.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : '') + '|dye'; };
  m.needsUpdate = true;
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
  else if (def.id === 'groom') HOOKS.settleAsset?.('assets/fig-laborer.glb', ok, err);
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

/* followFloor 专用：踏面取「一步之内能迈上去的最高面」，没有才回落成「离当前高度最近」。
   为什么不能沿用 sampleFloor 的"第一个命中"：射线从高处往下打，在树下先撞到的是树冠、
   在廊下先撞到的是檐口（2.5~2.95m），而人其实在地上走 —— 第一个命中会让
   "走到树荫底下"整个人突然抬高两米（低通 18/s，看起来就是弹一下）。

   ⚠️ 为什么也不能只用"最近"（S3 踩到，S2 时是够用的）：S2 只往**下**走
      （堂前 → 拱桥 → 廊道 → 门），"最近"天然连续；S3 反着往**上**走时它必然失效 ——
      廊道是架高的，人站在下面草地上：头顶 0.42m 有廊面、脚边 0.1m 有草，
      "最近"永远选草 ⇒ 整段从廊道底下、桥底下穿过去（实测 floorY 读到 −0.99 = 桥下地面）。
   窗口 [当前−0.60, 当前+0.42]：42cm 是普通台阶上限、60cm 是下台阶上限。
   ⚠️ 别把上界放大到 +0.8：廊下檐口、桥栏杆都在 1.5~1.8m，开大了人会"踩上屋顶"。 */
function sampleFloorNear(x, z, nearY, stepUp){
  _rc.set(_hitP.set(x, 3.6, z), _down);
  _rc.far = 7.0;
  let hi = null, near = null, nd = Infinity;
  const upLim = nearY + (stepUp || 0.42), loLim = nearY - 0.60;
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
    if (y >= loLim && y <= upLim && (hi === null || y > hi)) hi = y;
    const d = Math.abs(y - nearY);
    if (d < nd){ nd = d; near = y; }
  }
  return hi !== null ? hi : near;
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
      holder.position.set(def.spot.x, (def.fixedY && def.spot.y !== undefined) ? def.spot.y : groundHeight(def.spot.x, def.spot.z), def.spot.z);
      holder.rotation.y = def.spot.yaw;

      inner.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        o.userData.noMerge = true;         // 不进 mergeStatics
        if (Array.isArray(o.material)) o.material.forEach(m => { tintMaterial(m, def.tint); dyeMaterial(m, def.dye); });
        else { tintMaterial(o.material, def.tint); dyeMaterial(o.material, def.dye); }
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
      if (def.hideUntilVisit) holder.visible = false;   // 条件不满足时不出现（到访导演层开演时打开）
      hideProcedural(def.hidePose, def.spot);
      const r = def.route;
      /* 步幅 ↔ 步长对账：脚摆过的弧长必须等于推进的距离，否则就是"滑步"。
         半径取 Hips 到地面的高度（≈ 髋到踝 + 鞋底），由实测骨骼位置算，
         不写死 —— 文士 1.72 与仕女 1.63 的髋高差 6cm，共用一套振幅就会一个滑一个蹭。 */
      holder.updateMatrixWorld(true);
      /* ── 绑腿（2026-10-27）───────────────────────────────────────────────
         老黄："右脚始终感觉有个拖影"。放大出图（outputs/_diag/pose-qa/guest-feet.png）
         看到的是**一条肉色的小腿**：长袍下摆是一道开衩，迈步到最前时小腿从衩口探出来，
         而生成件的小腿是**裸皮肤**，于是每走一步都有一块浅色跟着那只脚 —— 就是"拖影"。
         做法：给两条小腿各套一段深色圆柱（绑腿/裤脚，明代足夫常见），挂在**小腿骨**上，
         跟着腿走，走到裙摆外也只露出深色布，不再是肉色。
         ⚠️ 半径/长度要按骨骼的**世界缩放**折算回骨骼局部单位（生成件经过归一化缩放），
            否则不同身高的角色绑腿粗细会跟着变。 */
      const wrapMat = getLegWrapMat();
      /* 只给**有裙骨的长袍角色**加：短打角色（马夫/书童）本来就穿着长裤，
         再套一层深色绑腿反而会在裤脚外多出一截。 */
      if (bones.Skirt0 || bones.Skirt0a){
        for (const side of ['Left','Right']){
          const knee = bones[side + 'LowerLeg'], ankle = bones[side + 'Foot'];
          if (!knee || !ankle) continue;
          const kw = knee.getWorldPosition(new THREE.Vector3());
          const aw = ankle.getWorldPosition(new THREE.Vector3());
          const span = aw.clone().sub(kw);
          const len = span.length();
          if (!(len > 0.08)) continue;
          const ws = Math.max(1e-4, knee.getWorldScale(new THREE.Vector3()).x);
          const geo = new THREE.CylinderGeometry(0.075 / ws, 0.058 / ws, (len * 0.92) / ws, 10, 1, true);
          const eq = new THREE.Quaternion();
          knee.getWorldQuaternion(eq).invert();
          const dir = span.clone().normalize().applyQuaternion(eq);       // 骨局部里的"膝→踝"
          const mid = kw.clone().addScaledVector(span, 0.48);
          knee.worldToLocal(mid);
          const wrap = new THREE.Mesh(geo, wrapMat);
          wrap.position.copy(mid);
          wrap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          wrap.castShadow = false;                 // 小件，投影贡献≈0；进投射物集合只会撑大阴影盒
          wrap.receiveShadow = true;
          wrap.userData.noMerge = true;
          knee.add(wrap);
        }
      }
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
      /* 步幅：默认 STEP_LEN(0.42)；个别角色可覆盖（def.stepLen）。
         ⚠️ 2026-10-25 老黄："客人走在石板路上的时候…脚跑在身体前面"——实测客人的脚在
         身体前后各摆 0.20m，是 0.42 步幅 + 长袍遮腿造成的"脚先到"。把客人的步幅收到
         0.34（脚跟摆动随之变 0.34），步频相应快一点，读起来才是"小步走"。
         amp 与相位必须用**同一个步幅**，否则脚要么拖地要么滑步。 */
      const SL = def.stepLen || STEP_LEN;
      const amp = Math.min(0.34, Math.max(0.14, Math.asin(Math.min(0.6, SL / (2 * hipH)))));
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
        /* 2026-10-23 马车版到访：ride = 现在被"车"载着（每帧由导演层写 pos/y/yaw）；
           trip = 上车/下车的一段过渡（从 A 平滑到 B，不含物理）；
           coachW = 车夫握缰权重、tieW = 系马抬手权重（都只动肘/腕，守腰带约束）。 */
        ride: null, trip: null, coachW: 0, tieW: 0, tieTarget: false,
      });
      /* 品茶：盏挂在 holder 上（不挂手骨，理由见 TEA_ARM 注释） */
      const aNew = ACTORS[ACTORS.length - 1];
      if (def.idle.tea) aNew.cup = makeTeaCup(holder);
      if (def.idle.brush) aNew.brush = makeBrush(holder);
      if (def.idle.scroll) aNew.scroll = makeScroll(holder);
      if (def.idle.hay) aNew.hay = makeHayHandful(holder);
      /* ── 贴地软影 + 走动时不投影（2026-10-27）────────────────────────────
         老黄："右脚始终感觉有个拖影"。取证（截图取样）：那块灰影比铺地**暗**
         （86,91,83 vs 109,116,104/138,144,134）⇒ 是影子，不是腿/衣摆。
         根因：阴影图是"只渲一次"的静态图（09-lights 的 shadowMap.autoUpdate=false），
         人一走，影子就留在原地 —— 每走一步都有一块影子拖在脚后。
         规矩与马厩的马同一套：**走动期间不投影、改用贴地软影；停下再烘一次**。
         切换只在"开始走/刚停下"各烘一次（整场景 shadow pass 很贵，不能每帧）。 */
      const blobMat = getActorBlobMat();
      /* ⚠️ 2026-10-27 二次收小（老黄："人物移动时脚底还是有拖影，感觉像穿了雪橇"）：
         0.72×0.52 在低机位下就是一整块深色椭圆，长袍一盖只剩这块"板"。
         改成 0.44×0.30、透明度 0.18 —— 只当"接触暗部"，不再读成影子/雪橇。 */
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.30), blobMat);
      blob.name = 'actorBlobShadow';
      blob.rotation.x = -Math.PI / 2;
      /* y=0.09：石板路的面在 +0.06 左右，贴 0.02 会被铺地整个盖住（马厩的软影同样取 0.09） */
      blob.position.set(0, 0.09, 0.02);
      blob.renderOrder = 2;
      blob.visible = false;
      blob.raycast = () => {};
      blob.userData.aoSkip = true;
      blob.userData.noMerge = true;
      holder.add(blob);
      aNew.blob = blob;
      aNew.meshes = [];
      inner.traverse((o) => { if (o.isMesh) aNew.meshes.push(o); });
      aNew.shadowCast = true;
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
  /* 2026-10-27：原来的淡紫/淡蓝（0xBBA9C4 / 0xA7B7D2）乘在白模上读作"灰扑扑的粗布"。
     改成两身深色绸衣：靛青 / 松绿（深色才压得住"大户人家"的分量）。 */
  [[0, 'go1', 0x3F5A7A], [2, 'go2', 0x4E6B58]].forEach(([si, id, tint]) => {
    const st = SEAT_SPOTS[si];
    if (!st) return;
    /* 往桌心挪 0.14m：坐在凳子的**前沿**（真人在石凳上下棋也是这样），
       否则凳心到盘心 1.09m、手臂只有 0.49m，手落不到盘上（actor-go-solve 实测）。 */
    const tb = PROP_SPOTS.stoneTable;
    const dx = tb.x - st.x, dz = tb.z - st.z;
    const dl = Math.hypot(dx, dz) || 1;
    const push = 0.30;   // 2026-10-27：坐直之后手要够到盘面 ⇒ 从 0.14 挪到 0.30（坐凳前缘）
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
  /* 并排段由导演层按弧长直接摆位（见 tickVisit 的 pair 相）——
     这里必须**整个让开**：tickRoute 是会写 moveW 的，两边都写就会一直打架。
     被马车载着 / 上下车过渡中同理：位置由 tickCarriage / trip 通道写。 */
  if (a.pairDrive) return;
  if (a.ride || a.trip){
    a.moved = 0;
    a.moveW = approach(a.moveW, 0, dt / 0.45);
    return;
  }
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

/* 把一条航点线按**自身法线**平移 lat 米（lat>0 = 行进方向右手侧）。
   取前后相邻点算切线 ⇒ 弯道上的偏移线仍是"等距线"，两人不会在转角处并到一起。
   端点段只有单侧相邻点，直接用该段切线（航点线本身就是直的，够用）。 */
function offsetPath(pts, lat){
  const out = [];
  for (let i = 0; i < pts.length; i++){
    const p = pts[i];
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const o = pts[Math.max(i - 1, 0)];
    let dx = q[0] - o[0], dz = q[1] - o[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    out.push([p[0] - dz * lat, p[1] + dx * lat]);   // 法线 = (−dz, dx)
  }
  return out;
}

/* 并排线的参数化表（弧长 → 点 / 法线 / 切线朝向）。
   为什么 S3 不走 tickRoute 的"逐航点追"：两个人各追各的点，转角的 TURN_GATE 停顿
   与外线更长这两件事会累积成纵向错位（实测间距从 0.9m 漂到 2.8m，"并排"变成"领路"）。
   改成**同一条弧长 s 驱动两个人**：s 相同 ⇒ 永远并肩，间距恒等于 2×gap。 */
function pathTable(pts){
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, total: cum[cum.length - 1] };
}
function pathAt(P, s){
  s = Math.max(0, Math.min(P.total, s));
  let i = 1;
  while (i < P.cum.length - 1 && P.cum[i] < s) i++;
  const a = P.pts[i - 1], b = P.pts[i];
  const L = (P.cum[i] - P.cum[i - 1]) || 1;
  const u = (s - P.cum[i - 1]) / L;
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u,
           nx: -dz, nz: dx, yaw: Math.atan2(dx, dz) };
}
const angDiff = (to, from) => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/* 给一位演员**换一条新路线**（导演层用）。
   ⚠️ 必须一起复位 arrived / target / walkOff / waitT —— 少一个就会出现
      "到了新路线的起点却永远站着"（tickRoute 见 arrived 直接早退）。
   ⚠️ floorMax 也要跟着路走：客人原本只走地面（1.20），并排要过 2.10m 的拱桥。 */
function giveRoute(a, pts, speed, waitT, floorMax){
  a.def.route = { pts, speed, pause: [0, 0], mode: 'once' };
  a.target = pts.length > 1 ? 1 : 0;
  a.arrived = false;
  a.walkOff = false;
  a.waitT = waitT;
  a.sampleT = 0;
  if (floorMax !== undefined){ a.def.floorMax = floorMax; a.def.followFloor = true; }
}

/* S4/S5 复用：单个人物的"转身 → 退半步 → 落座"，返回"是否已坐稳"。
   从 'seat' 相位里原样提出（S5 送客后主人要坐回同一把椅子）——
   两处各写一份迟早分家（本项目"两处公式不一致"的 bug 出过 41.7rad/s 那次）。 */
function seatOne(a, sxy, dt){
  /* ① 先转成"背对椅子"（椅子朝 +z ⇒ 人朝 +z、椅子在身后 / −z） */
  const e = angDiff(SEAT.yaw, a.yaw);
  if (Math.abs(e) > 0.10){
    const d = GAIT.turn * dt;
    a.yaw += Math.abs(e) <= d ? e : (e > 0 ? d : -d);
    a.moved = 0;
    a.step += dt * 0.17;
    a.moveW = approach(a.moveW, 0.28, dt / 0.3);
    return false;
  }
  const dx = sxy[0] - a.pos.x, dz = sxy[1] - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.02){
    const k = Math.min(1, (0.55 * dt) / dist);
    a.pos.x += dx * k; a.pos.z += dz * k;      // 退半步：不迈步，只往后退
    a.moved = 0;
    a.moveW = approach(a.moveW, 0, dt / 0.3);
  }
  /* ② 离座面 0.22m 以内才开始落座（sitW 自己 2.2/s 缓动 ≈0.45s） */
  if (dist < 0.22) a.sitTarget = 1;
  return a.sitW >= 0.98 && dist < 0.06;
}

/* S3/S5 复用：并排段的驱动（同一条弧长 s 驱动两个人，位置 = 中心线 ± 法线×lat）。
   S3 'pair'（门→堂）与 S5 'epair'（堂→门）共用；latH/latG 由调用方给
   （S5 的偏移号与 S3 相反，理由见 ESCORT 注释）。 */
function drivePair(v, host, guest, P, latH, latG, dt, onDone){
  const eh = angDiff(pathAt(P, v.s).yaw, host.yaw);
  const eg = angDiff(pathAt(P, v.s).yaw, guest.yaw);
  /* 转角处两人**一起站住转**（同一条切线 ⇒ 同时转完、转完仍并肩），
     s 这时不推进 —— 若各转各的，先转完那个会先走出去，队形立刻散掉。 */
  if (Math.abs(eh) > 0.12 || Math.abs(eg) > 0.12){
    for (const [a, e] of [[host, eh], [guest, eg]]){
      const d = GAIT.turn * dt;
      a.yaw += Math.abs(e) <= d ? e : (e > 0 ? d : -d);
      a.step += dt * 0.17;                       // 原地倒步
      a.moveW = approach(a.moveW, 0.32, dt / 0.3);
      a.moved = 0;
    }
    return;
  }
  v.s = Math.min(P.total, v.s + PAIR.speed * dt);
  const q = pathAt(P, v.s);
  for (const [a, lat] of [[host, latH], [guest, latG]]){
    a.pos.x = q.x + q.nx * lat;
    a.pos.z = q.z + q.nz * lat;
    const e = angDiff(q.yaw, a.yaw);
    const d = GAIT.turn * dt;
    a.yaw += Math.abs(e) <= d ? e : (e > 0 ? d : -d);
    a.moved = PAIR.speed * dt;
    a.step += a.moved;
    a.moveW = approach(a.moveW, 1, dt / 0.40);
  }
  if (v.s >= P.total - 1e-6){
    for (const a of [host, guest]){ a.arrived = true; a.pairDrive = false; a.moveW = 0; }
    onDone();
  }
}

/* ── 马车到访 · 条件与摆位工具（2026-10-23）──────────────────────────────────
   条件：白昼（老黄："时辰只是白天（上午、正午和下午）"）+ 不下雨不下雪。
   ⚠️ 读 `ENV.cur` 的雨雪量而不是只看 `ENV.weather` 字符串：天气切换有 2.8s 过渡，
      只看字符串会在"刚下起来"的那几秒把人放进场。 */
function visitWeatherOK(){
  const ENV = ENV_REF.env;              // 延迟绑定，见文件头 import 处
  /* 12-env 还没发布 ⇒ 条件不满足（不猜）。但**必须喊一声**：这个槽没填的话，
     整场到访会静默地永远停在 idle，画面上什么都不报（2026-10-24 就是靠新门禁抓到的）。 */
  if (!ENV){
    if (!_envRefWarned){ _envRefWarned = true; console.warn('[visit] ENV_REF.env 未发布（12-env 没注入）⇒ 到访不会开始'); }
    return false;
  }
  const h = ENV.hour;
  if (!(h >= 7.0 && h <= 18.0)) return false;
  const w = ENV.weather;
  if (w === 'storm' || w === 'snow' || w === 'thunder') return false;
  const c = ENV.cur;
  if (c && ((c.rainAmount || 0) > 0.05 || (c.snowAmount || 0) > 0.05 || (c.snowCover || 0) > 0.05)) return false;
  return true;
}

/* 车局部点 → 世界（车的 +z 是车头方向） */
function carPoint(P, lx, lz){
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  return { x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c };
}
function carSeat(P, local){
  const q = carPoint(P, local.x, local.z);
  return { x: q.x, y: P.y + (local.y || 0), z: q.z, yaw: P.yaw };
}
/* 让人物"坐在车上/站在车夫位"：之后每帧由 tickCarriage 重写 ride（车动人也动）。 */
function setRide(a, P, local, sit){
  const q = carSeat(P, local);
  a.ride = q;
  a.pos.x = q.x; a.pos.z = q.z; a.y = q.y; a.yaw = q.yaw;
  a.arrived = false; a.walkOff = true; a.moveW = 0; a.moved = 0;
  a.sitTarget = sit ? 1 : 0;
}
/* 上车/下车的一段过渡（纯插值，不迈步） */
function startTrip(a, to, dur, onDone){
  a.ride = null;
  a.trip = { t: 0, dur, from: { x: a.pos.x, y: a.y, z: a.pos.z, yaw: a.yaw },
             to: { x: to.x, y: to.y, z: to.z, yaw: to.yaw === undefined ? a.yaw : to.yaw },
             onDone: onDone || null };
}

/* 给访客路线（马车版）：
   下车点在东侧草地 → 绕过停在门口的马车 → 并回石板路 → 门内。
   ⚠️ 不能直接用 STABLE_ROAD_PTS[0]=(40,4.2)：那一点正好被停着的车占住。 */
const GUEST_ALIGHT = [[41.20, 4.20], [41.50, 5.40], [40.90, 6.60], [39.80, 8.60],
                      ...STABLE_ROAD_PTS.slice(1), [0, 23.55], [0, 20.90]];
const GUEST_HOME2 = (() => {
  const road = [...GUEST_HOME_PTS];
  road.pop();                                  // 去掉 (40,4.2)（被车占住，改走东侧草地）
  return [...road, [39.80, 8.60], [40.90, 6.60], [41.50, 5.40], [41.20, 4.20]];
})();

/* ── 马车/马夫的子状态机 ─────────────────────────────────────────────────────
   与 VISIT.phase 并行：主人回堂与客人上车是两件事，串成一条会互相等。
   states: parked → drivein → stop → tiewalk → tie → alight → wait
           → board → driveout → gone */
function tickCarriage(dt){
  const V = stableTravel();
  if (!V) return;
  const guest = actorRef(VISIT.guestId), coach = actorRef(VISIT.coachId);
  if (!guest || !coach) return;
  const S = VISCAR;

  if (S.state === 'drivein'){
    /* 远端 ~75m：用 arriveSpeed 开进来，最后 12m 平滑收到 CARRY.speed（硬切换到 1.1 会"一顿"） */
    const remain = S.path.total - S.s;
    const v = CARRY.speed + (CARRY.arriveSpeed - CARRY.speed) * Math.min(1, remain / 12);
    S.s = Math.min(S.path.total, S.s + v * dt);
    const q = pathAt(S.path, S.s);
    const P = travelCarriagePlace(q.x, q.z, q.yaw, S.s);
    S.last = P;
    if (P){ setRide(guest, P, CARRY.seat, true); setRide(coach, P, CARRY.coach, true); }
    if (S.s >= S.path.total - 1e-6){ S.state = 'stop'; S.t = 0; }
    return;
  }
  if (S.state === 'stop'){
    S.t += dt;
    if (S.last) setRide(guest, S.last, CARRY.seat, true);       // 客人仍坐着
    if (!S.coachOff) setRide(coach, S.last, CARRY.coach, true);
    if (S.t > 0.8 && !S.coachOff){
      S.coachOff = true;
      /* ⚠️ 2026-10-27 真 bug（老黄："马夫依旧是缩成一团，也没有任何动作"）：
         马夫从车夫位下来时 startTrip 只把 ride 清掉，**sitTarget 仍是 1** ⇒
         他下地后一路以坐姿（髋沉、两腿折叠）走到拴马桩、站在那儿，眼看着就是"缩成一团"。
         下车这一刻把 sitTarget 归零（sitW 在 1s 的 trip 里按 2.2/s 自然站直）。 */
      coach.sitTarget = 0;
      const g = carPoint(S.last, CARRY.coachGround.x, CARRY.coachGround.z);
      g.y = groundHeight(g.x, g.z);
      startTrip(coach, { x: g.x, y: g.y, z: g.z,
                         yaw: Math.atan2(g.x - S.last.x, g.z - S.last.z) }, 1.0,
        () => {
          S.state = 'tiewalk';
          const t = carPoint(S.last, CARRY.coachTie.x, CARRY.coachTie.z);
          t.y = groundHeight(t.x, t.z);
          giveRoute(coach, [[t.x, t.z]], 0.55, 0.15);
          coach.def.followFloor = true;
          coach.def.floorMax = 1.2;
        });
    }
    return;
  }
  if (S.state === 'tiewalk'){
    if (coach.arrived){ S.state = 'tie'; S.t = 0; }
    return;
  }
  if (S.state === 'tie'){
    S.t += dt;
    /* 面对马头；抬手（tieTarget）—— 抬手权重在演员块里驱动肘/腕 */
    if (S.last){
      const hd = carPoint(S.last, -0.40, 2.10);
      turnToward(coach, Math.atan2(hd.x - coach.pos.x, hd.z - coach.pos.z), dt);
    }
    coach.tieTarget = true;
    if (S.t > 2.4){
      travelCarriageTied(true);                 // 引绳出现（"系好了"的可读证据）
      S.tieOn = true;
      S.state = 'alight'; S.t = 0; S.alighting = false;
    }
    return;
  }
  if (S.state === 'alight'){
    S.t += dt;
    if (!S.alighting && S.last) setRide(guest, S.last, CARRY.seat, true);
    if (S.t < 0.35){ guest.sitTarget = 0; return; }
    if (!S.alighting){
      S.alighting = true;
      guest.sitTarget = 0;
      const g = carPoint(S.last, CARRY.side.x, CARRY.side.z);
      g.y = groundHeight(g.x, g.z);
      startTrip(guest, { x: g.x, y: g.y, z: g.z,
                         yaw: Math.atan2(g.x - S.last.x, g.z - S.last.z) }, 1.15, null);
    }
    if (!guest.trip){ S.alighting = false; guest.ride = null; S.state = 'alighted'; }
    return;
  }
  if (S.state === 'board'){
    S.t += dt;
    /* 解绳：先抬手放下（tieTarget=false），引绳收起 */
    if (coach.tieTarget){ coach.tieTarget = false; travelCarriageTied(false); S.tieOn = false; }
    /* 客人从地面跨上车 */
    if (!S.boardStarted && !guest.trip){
      S.boardStarted = true;
      const seat = carSeat(S.last, CARRY.seat);
      /* ⚠️ sitTarget 要放在**回调**里：跨上去的 1.15s 里人还在抬腿，立刻切坐姿会读到"半蹲着飘"。
         ⚠️⚠️ 回调里**必须补 ride**（2026-10-24 修）：startTrip 一进来就把 ride 清空，
         而 trip 结束到 driveout 之间（等马夫走 1.41m + 跨上车，约 3.5s）没人再写它 ⇒
         下面"落地"分支看到 !ride && !trip 就把人按**地面高度**直接落下去：
         客人从座面（车基座 +0.615m）瞬沉到地面、还保持坐姿。 */
      startTrip(guest, { x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw }, 1.15,
        () => {
          S.guestOn = true;
          if (S.last) setRide(guest, S.last, CARRY.seat, true);
        });
    }
    /* 已上车的人每帧钉回座位（等价于 drivein 那几段的做法）：
       兜住"trip 刚结束、driveout 还没开始"的空窗，也让车若被挪动时人跟着走。 */
    if (S.guestOn && !guest.trip && S.last) setRide(guest, S.last, CARRY.seat, true);
    /* 马夫走到车夫位旁边再跨上去 */
    if (S.guestOn && !S.coachOn && !coach.trip && !S.coachWalk){
      S.coachWalk = true;
      const g = carPoint(S.last, CARRY.coachGround.x, CARRY.coachGround.z);
      g.y = groundHeight(g.x, g.z);
      giveRoute(coach, [[g.x, g.z]], 0.55, 0.1);
    }
    if (S.coachWalk && coach.arrived && !S.coachOn && !coach.trip){
      S.coachWalk = false;
      const box = carSeat(S.last, CARRY.coach);
      /* 马夫同理：没有这一句他跨上去了也会掉回地面（他同样开着 followFloor）。 */
      startTrip(coach, { x: box.x, y: box.y, z: box.z, yaw: box.yaw }, 0.9,
        () => {
          S.coachOn = true;
          if (S.last) setRide(coach, S.last, CARRY.coach, false);
        });
    }
    if (S.coachOn && !coach.trip && S.last) setRide(coach, S.last, CARRY.coach, false);
    if (S.guestOn && S.coachOn && !guest.trip && !coach.trip){
      S.state = 'driveout'; S.t = 0; S.leg = 'back'; S.legT = 0; S.s = 0;
      S.odo = 0;                            // 里程从 0 起算，之后跨三个 leg 连续累加
    }
    return;
  }
  if (S.state === 'driveout'){
    S.t += dt;
    if (S.leg === 'back'){
      /* 倒车：车头仍朝院里（yaw π），位置向南退 3.4m。
         ⚠️ 里程走独立的 S.odo（**只增只减、绝不归零**）：旧写法把 S.s 直接当里程，
         而 S.s 是"本段走了多远"——调头结束时归零 ⇒ 车轮从 −6.2rad 一步跳到 0
         （约 2 圈），大辐条轮 15~25m 外也看得见；调头段又用它递增，同样在转折处跳。
         travelCarriagePlace 的 dist 同时驱动车轮转角与辕马四腿相位，必须连续。 */
      S.s = Math.min(3.4, S.s + CARRY.backSpeed * dt);
      S.odo -= CARRY.backSpeed * dt;          // 倒着走 ⇒ 里程递减（轮/腿反向）
      const x = 40.0, z = 4.0 + S.s;
      const P = travelCarriagePlace(x, z, Math.PI, S.odo);
      S.last = P;
      setRide(guest, P, CARRY.seat, true); setRide(coach, P, CARRY.coach, true);
      if (S.s >= 3.4 - 1e-6){ S.leg = 'spin'; S.legT = 0; }
      return;
    }
    if (S.leg === 'spin'){
      /* 原地调头（车马一起转，马跟着踏步）。1.15rad/s ⇒ π 用 2.7s。 */
      S.legT += dt;
      const yaw = Math.PI - Math.min(Math.PI, S.legT * CARRY.turnRate);
      S.odo += 0.55 * dt;                      // 原地踏步：让腿不是僵住的（里程接着累加）
      const P = travelCarriagePlace(40.0, 7.4, yaw, S.odo);
      S.last = P;
      setRide(guest, P, CARRY.seat, true); setRide(coach, P, CARRY.coach, true);
      if (S.legT * CARRY.turnRate >= Math.PI){
        S.leg = 'out'; S.legT = 0; S.s = 0;
        S.outPath = pathTable(CARRY.depart);
      }
      return;
    }
    /* out：沿石板路向南走远，到终点连人带车隐去 */
    S.legT += dt;
    S.s = Math.min(S.outPath.total, S.s + CARRY.speed * dt);
    S.odo += CARRY.speed * dt;
    const q = pathAt(S.outPath, S.s);
    const P = travelCarriagePlace(q.x, q.z, q.yaw, S.odo);
    S.last = P;
    setRide(guest, P, CARRY.seat, true); setRide(coach, P, CARRY.coach, true);
    if (S.s >= S.outPath.total - 1e-6){
      S.state = 'gone';
      travelCarriageVisible(false);
      guest.holder.visible = false;
      coach.holder.visible = false;
      guest.ride = null; coach.ride = null;
      /* 车走了之后两人都进入隐藏态；清坐姿，避免 45s 后 resetVisit 把"坐着的人"
         直接放回马厩（resetVisit 里也有同样的清零，这里是双保险）。 */
      guest.sitTarget = 0; guest.sitW = 0;
      coach.sitTarget = 0; coach.sitW = 0; coach.offerW = 0;
    }
    return;
  }
}

/* 游园：单列（主人领路、客人跟 0.95m），同一条弧长驱动，拐弯不会拉成一前一后 */
function driveTour(dt){
  const v = VISIT;
  const host = actorRef(v.hostId), guest = actorRef(v.guestId);
  if (!host || !guest) return;
  const P = v.tourPath;
  v.tourS = Math.min(P.total, v.tourS + TOUR.speed * dt);
  const qh = pathAt(P, v.tourS);
  const qg = pathAt(P, Math.max(0, v.tourS - TOUR.gap));
  for (const [a, q] of [[host, qh], [guest, qg]]){
    a.pos.x = q.x; a.pos.z = q.z;
    const e = angDiff(q.yaw, a.yaw);
    const d = GAIT.turn * dt;
    a.yaw += Math.abs(e) <= d ? e : (e > 0 ? d : -d);
    a.moved = TOUR.speed * dt;
    a.step += a.moved;
    a.moveW = approach(a.moveW, 1, dt / 0.40);
  }
  if (v.tourS >= P.total - 1e-6){
    host.arrived = guest.arrived = true;
    host.moveW = guest.moveW = 0;
    host.def.stepUp = guest.def.stepUp = 0.42;   // 游园结束：收回上桥的宽窗口
    v.phase = 'eface'; v.t = 0;
  }
}

/* 开演（条件满足时）：马车已在路上，客人在车里，马夫在车夫位。 */
/* ── 只留一个马夫（2026-10-27 老黄："现在出现了两个马夫…一个马夫就够了"）──────────
   车夫（laborer）与常驻马夫（groom）是同一件 GLB 的两个人，到访期间会同框在马厩里，
   两个人穿着、头巾、身材都一样 ⇒ 读作"两个马夫站在马旁边"。
   车夫一上场就把常驻马夫收起来（车夫走了再放回来），场上任何时刻只有一个马夫。 */
function setGroomVisible(v){
  const gm = actorRef('groom');
  if (gm) gm.holder.visible = !!v;
}

function startVisit(){
  const V = stableTravel();
  const guest = actorRef(VISIT.guestId), coach = actorRef(VISIT.coachId), host = actorRef(VISIT.hostId);
  if (!V || !guest || !coach || !host) return false;
  const a0 = CARRY.arrive[0], a1 = CARRY.arrive[1];
  const yaw0 = Math.atan2(a1[0] - a0[0], a1[1] - a0[1]);
  const P = travelCarriagePlace(a0[0], a0[1], yaw0, 0);
  if (!P) return false;
  VISCAR.state = 'drivein'; VISCAR.s = 0; VISCAR.t = 0;
  VISCAR.path = pathTable(CARRY.arrive); VISCAR.last = P;
  VISCAR.alighting = false; VISCAR.coachOff = false; VISCAR.tieOn = false;
  VISCAR.boardStarted = false; VISCAR.guestOn = false; VISCAR.coachOn = false; VISCAR.coachWalk = false;
  VISCAR.leg = ''; VISCAR.outPath = null; VISCAR.odo = 0;
  travelCarriageVisible(true);
  travelCarriageTied(false);

  guest.holder.visible = true;
  guest.def.route = null;
  guest.def.floorRay = true; guest.def.followFloor = true; guest.def.floorMax = 1.20;
  guest.def.stepUp = 0.42;
  guest.walkOff = true; guest.arrived = false; guest.trip = null; guest.tieW = 0;
  setRide(guest, P, CARRY.seat, true);

  coach.def.route = null; coach.walkOff = true; coach.arrived = false;
  coach.trip = null; coach.tieTarget = false; coach.tieW = 0; coach.coachW = 0;
  coach.holder.visible = true;
  setRide(coach, P, CARRY.coach, true);
  setGroomVisible(false);          // 车夫上场，常驻马夫退场（场上只留一个马夫）

  host.walkOff = true; host.arrived = false; host.trip = null;
  return true;
}

/* 复位（重播前）：把人、车、马夫都放回原位，客人重新藏起来等下一场。 */
function resetVisit(){
  const guest = actorRef(VISIT.guestId), coach = actorRef(VISIT.coachId), host = actorRef(VISIT.hostId);
  travelCarriagePark();
  travelCarriageVisible(true);
  travelCarriageTied(false);
  VISCAR.state = 'parked'; VISCAR.t = 0; VISCAR.s = 0; VISCAR.last = null;
  VISCAR.alighting = false; VISCAR.coachOff = false; VISCAR.tieOn = false;
  VISCAR.boardStarted = false; VISCAR.guestOn = false; VISCAR.coachOn = false; VISCAR.coachWalk = false;
  VISCAR.leg = ''; VISCAR.outPath = null; VISCAR.odo = 0;
  if (guest){
    guest.ride = null; guest.trip = null;
    guest.sitTarget = 0; guest.sitW = 0; guest.offerW = 0;
    guest.def.route = null; guest.walkOff = true; guest.arrived = false; guest.moveW = 0;
    guest.pos.x = guest.def.spot.x; guest.pos.z = guest.def.spot.z;
    guest.y = groundHeight(guest.pos.x, guest.pos.z);
    guest.yaw = guest.def.spot.yaw;
    guest.floorY = null; guest.floorDone = false; guest.floorTries = 0;
    guest.holder.visible = false;
  }
  if (coach){
    coach.ride = null; coach.trip = null; coach.tieTarget = false;
    coach.tieW = 0; coach.coachW = 0;
    /* ⚠️ 2026-10-27 真 bug（老黄："马夫依旧是缩成一团，也没有任何动作"）：
       setRide(..., true) 把 sitTarget 置 1，复位时只清了 ride/trip ⇒ 马夫回到马厩
       仍保持坐姿（髋沉、两腿折叠）站在原地，像一团缩着的人，且刷马动作被坐姿盖掉。
       guest 那一支一直有清零（见上），coach 漏了同一行。 */
    coach.sitTarget = 0; coach.sitW = 0; coach.offerW = 0;
    coach.moveW = 0; coach.brushT = 0; coach.brushW = 0;
    coach.pos.x = coach.def.spot.x; coach.pos.z = coach.def.spot.z;
    coach.y = coach.def.spot.y !== undefined ? coach.def.spot.y : groundHeight(coach.pos.x, coach.pos.z);
    coach.yaw = coach.def.spot.yaw;
    coach.floorY = null; coach.floorDone = false; coach.floorTries = 0;
    coach.walkOff = true; coach.arrived = false; coach.def.route = null;
    /* 车夫只属于到访：复位后藏起来，马厩交给常驻 groom（否则同一件 GLB 的两个人
       会在 38,1.3 重叠，用户又看到"两个马夫"）。下一次 startCarVisit 会重新显示。 */
    coach.holder.visible = false;
    /* 车夫退场 ⇒ 常驻马夫回到马厩（场上始终只有一个马夫） */
    setGroomVisible(true);
  }
  /* 两书童：复位时回堂前各自的位子。
     ⚠️ 2026-10-27 必须加这一段：他们跑到井边后会**留在井边**，而下一场到访的
        路线仍从堂前开始 ⇒ 起手第一步就是从井边直线穿回堂前（横穿池塘）。
        用户看到的"两个小孩子趟着池子边缘过去"有很大概率就是第二场以后的重播。
        复位时把人放回原位、清掉旧路线与 stepUp，下一场由 stow 相位重新给路线。 */
  for (const id of ['child1', 'child2']){
    const c = actorRef(id);
    if (!c) continue;
    c.ride = null; c.trip = null;
    c.def.route = null; c.walkOff = true; c.arrived = false;
    c.target = 0; c.moveW = 0; c.moved = 0; c.step = 0;
    c.pos.x = c.def.spot.x; c.pos.z = c.def.spot.z;
    c.y = groundHeight(c.pos.x, c.pos.z);
    c.yaw = c.def.spot.yaw;
    c.floorY = null; c.floorDone = false; c.floorTries = 0; c.sampleT = 0;
    c.def.stepUp = 0.42; c.def.floorMax = 1.20;
  }
  if (host){
    host.ride = null; host.trip = null;
    host.pos.x = 1.2; host.pos.z = -5.7;
    host.y = groundHeight(host.pos.x, host.pos.z);
    host.yaw = 0.42;
    host.sitTarget = 0; host.sitW = 0; host.offerW = 0; host.moveW = 0; host.arrived = false;
    host.scrollW = 0; host.scrollPhase = 0; host.scrollT = 0; host.teaT = 0; host.sipW = 0;
    host.def.stepUp = 0.42; host.def.floorMax = 2.45;
    host.def.route = { pts: HOST_GREET_PTS, speed: 0.86, pause: [0, 0], mode: 'once' };
    host.target = 1; host.walkOff = true; host.waitT = 0;
    host.floorY = null; host.floorDone = false; host.floorTries = 0;
    host.holder.visible = true;
  }
  VISIT.phase = 'idle'; VISIT.t = 0; VISIT.bowW = 0;
  VISIT.tourS = 0; VISIT.guestSent = false; VISIT.hostSeated = false;
}

function tickVisit(dt){
  const v = VISIT;
  const host = actorRef(v.hostId), guest = actorRef(v.guestId);
  if (!host || !guest) return;
  tickCarriage(dt);

  /* 客人已走到马车边 → 开始上车（这一步与主人回堂并行，放在所有相位之前） */
  if (v.guestSent && VISCAR.state === 'wait' && guest.arrived && !guest.trip && !guest.ride){
    VISCAR.state = 'board'; VISCAR.t = 0;
    VISCAR.boardStarted = false; VISCAR.guestOn = false; VISCAR.coachOn = false;
    VISCAR.coachWalk = false;
    giveRoute(guest, [[guest.pos.x, guest.pos.z]], 0.3, 0);
  }

  if (v.phase === 'idle'){
    /* 等条件：白昼 + 无雨雪 + 车/人都就位。不满足时客人不出现（老黄："下雨下雪不出现"）。 */
    v.t += dt;
    if (v.t < 1.2) return;
    if (!visitWeatherOK()) return;
    if (!stableTravel()) return;
    if (v.mode === 'walk'){
      guest.holder.visible = true;
      guest.def.stepUp = 0.70;
      giveRoute(guest, [...STABLE_ROAD_PTS, [0, 23.55], [0, 20.9]], 0.58, 2.0, 1.20);
      v.phase = 'gwalk'; v.t = 0;
      return;
    }
    if (!startVisit()) return;
    v.phase = 'carIn'; v.t = 0;
    return;
  }
  if (v.phase === 'carIn'){
    /* 车到门口停稳 → 马夫系马 → 客人下车（全部在 VISCAR 里），出到这里才放客人走路 */
    if (VISCAR.state === 'alighted'){
      guest.ride = null;
      /* ⚠️ 必须在这里翻到 wait：送客阶段的"客人走到车边就上车"只在 wait 上触发
         （tickVisit 顶部那段）。少了这一行，客人下车后状态永远停在 alighted ⇒
         上车/倒车/离场全都不发生 ⇒ wrap 一直等 VISCAR==='gone'，整场戏卡死。 */
      VISCAR.state = 'wait'; VISCAR.t = 0;
      v.phase = 'gwalk'; v.t = 0;
      guest.def.stepUp = 0.70;
      giveRoute(guest, GUEST_ALIGHT, 0.58, 0.9, 1.20);
    }
    return;
  }
  if (v.phase === 'gwalk'){
    if (guest.arrived){ v.phase = 'stow'; v.t = 0; }
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
      /* 桥北踏步一级实测 0.69m（docs §6），超出默认"一步"窗口 0.42 ⇒ 上坡方向
         取面窗口会拒绝台阶顶、"最近面"回落到地面 ⇒ 人从台阶里穿过去、沿桥底
         洼地走（S5 探针实测 floorY 一路 −0.5~−1.0）。迎客上坡与 S5 送客回程
         同一条路，这里放宽到 0.80，到门口'face'收回。 */
      host.def.stepUp = 1.35;
      /* 两书童随主人离席，跑向井边与仕女玩（2026-10-26 缺陷3；
         2026-10-27 重定路径 — 用户："两个小孩子是直接趟着池子边缘过去的"）。
         旧路 z≈−5.2/−5.8 在池的**左瓣下缘**（池局部 y≈−8.2，世界 z≈−5.2）穿过水面。
         新路先沿主人进堂的踏跺上台（与 ENTER_PTS 同一组已验证的点），
         沿月台前缘（z≈−7.2，铺地顶面 1.30）向西，过月台西端下到草地，
         再沿草地北缘绕到井边 —— 全程在岸上，最近点也离开水面 0.6m 以上。
         ⚠️ floorMax 必须给 1.70：月台铺地是 1.30，旧的 1.20 会把铺地当"屋顶"拒掉，
            采样回落到地形 ⇒ 人会贴着池岸走（这正是一条"看起来像趟水"的成因）。 */
      const c1 = actorRef('child1'), c2 = actorRef('child2');
      /* 上台第一级 0.31 比默认 stepUp 0.42 只差一点，但实测旧值下两童**上不去**：
         followFloor 的窗口拒绝台阶顶、floorY 回落到平台下的地面（y≈−0.5），
         人就贴着池岸/钻进月台肚子里走。必须和主人进堂时一样把 stepUp 放到 1.35。 */
      if (c1) c1.def.stepUp = 1.35;
      if (c2) c2.def.stepUp = 1.35;
      if (c1) giveRoute(c1, [
        [1.14, -5.25], [0.0, -5.95], [-0.45, -6.3], [-0.45, -7.2],
        /* ⚠️ 2026-10-27（老黄："他们居然从主堂前面的水缸上面跳过去"）：
           原来从 (-3.0,-7.2) 直连 (-7.0,-7.2)，而左侧水缸在 (−3.7,−7.4)（月台上、
           边缘内 0.1m，半径约 0.5）⇒ 这一段的直线正好从缸口上过去，stepUp 1.35
           又允许"踩上去" ⇒ 画面上就是从水缸上跳过去。
           改成绕缸北侧：先退到月台里侧 z≈−8.45（离缸心 1.05m），过了缸再回边缘。 */
        [-2.3, -7.2], [-2.3, -8.45], [-5.3, -8.45], [-5.3, -7.2],
        [-7.0, -7.2], [-10.5, -7.05], [-12.2, -6.85],
        [-15.0, -6.75], [-17.5, -6.85], [-18.6, -6.9], CHILD_WELL.c1,
      ], 1.05, 0.15, 1.70);
      if (c2) giveRoute(c2, [
        [0.62, -5.10], [0.0, -5.85], [0.45, -6.4], [0.45, -7.25],
        [-2.2, -7.25], [-2.2, -8.45], [-5.2, -8.45], [-5.2, -7.25],
        [-7.2, -7.25], [-10.7, -7.1], [-12.4, -6.9],
        [-15.2, -6.8], [-17.7, -6.9], [-18.8, -6.95], CHILD_WELL.c2,
      ], 1.05, 0.20, 1.70);
    }
    return;
  }
  if (v.phase === 'walk'){
    if (host.arrived){ v.phase = 'face'; v.t = 0; host.def.stepUp = 0.42; }
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
    else {
      v.bowW = 0; v.phase = 'line'; v.t = 0;
      /* 礼毕立刻各自挪到"并排线"的起点：主人靠内（lat −gap）、客人靠外（+gap）。
         起点只给一个点 ⇒ tickRoute 的 once 分支走到就 arrived（不用另写一套到位判定）。 */
      v.ptsH = offsetPath(PAIR.pts, -PAIR.gap);
      v.ptsG = offsetPath(PAIR.pts, PAIR.gap);
      v.path = pathTable(PAIR.pts);
      giveRoute(host, [v.ptsH[0]], PAIR.speed, 0.25, 2.45);
      giveRoute(guest, [v.ptsG[0]], PAIR.speed, 0.55, 2.45);
    }
    turnToward(host, yawToOther(host, guest), dt);     // 转身没转完也继续对上
    turnToward(guest, yawToOther(guest, host), dt);
    return;
  }
  if (v.phase === 'line'){
    /* 两人都站到各自那条线上才一起起步（谁先到谁站着等）—— 否则会出现
       "客人已经走出去 2m、主人才刚迈第一步"这种不合礼数的画面。 */
    if (host.arrived && guest.arrived){
      v.phase = 'pair'; v.t = 0; v.s = 0;
      host.pairDrive = guest.pairDrive = true;
      /* 已经在各自线的起点（s=0）上稳住，起步不用再等 */
      host.waitT = guest.waitT = 0;
    }
    return;
  }
  if (v.phase === 'pair'){
    drivePair(v, host, guest, v.path, -PAIR.gap, PAIR.gap, dt,
      () => { v.phase = 'hall'; v.t = 0; });
    return;
  }
  /* hall：到堂前站定，站一口气再进门（S4）。保持末段朝向（都朝着堂），不再互指。 */
  if (v.phase === 'hall'){
    v.t += dt;
    if (v.t < 2.0) return;
    v.phase = 'enter'; v.t = 0;
    /* 上台阶：把"一步"的窗口临时放到 0.70（最后一级 0.62）；floorMax 抬到 2.0
       （堂内地坪/铺地 1.24~1.30，1.20 的旧上限会把月台当屋顶拒掉）。 */
    host.def.stepUp = guest.def.stepUp = 0.70;
    giveRoute(host, ENTER_PTS.host, 0.52, 0.3, 2.0);
    giveRoute(guest, ENTER_PTS.guest, 0.52, 0.45, 2.0);
    return;
  }
  if (v.phase === 'enter'){
    if (host.arrived && guest.arrived){ v.phase = 'seat'; v.t = 0; }
    return;
  }
  if (v.phase === 'seat'){
    let done = 0;
    for (const [a, sxy] of [[host, SEAT.host], [guest, SEAT.guest]]){
      if (seatOne(a, sxy, dt)) done++;
    }
    if (done === 2){ v.phase = 'tea'; v.t = 0; }
    return;
  }
  if (v.phase === 'tea'){
    /* 主人举盏到胸前（TEA_ARM 的 lift 那一档，见 §3 第 7 条：这套骨架到不了嘴边），
       客人端坐。举 1.2s 到位、停 4.5s 再放下。 */
    v.t += dt;
    const w = v.t < 1.2 ? ease01(v.t / 1.2) : (v.t < 5.7 ? 1 : Math.max(0, 1 - (v.t - 5.7) / 1.0));
    host.offerW = 0.88 * w;
    if (v.t > 6.7){ host.offerW = 0; v.phase = 'sit'; v.t = 0; }
    return;
  }
  /* ── 叙话 → 起身 → 出堂 → 游园（2026-10-23 改成"先喝茶谈事、再游园、再送客"）── */
  if (v.phase === 'sit'){
    v.t += dt;
    if (v.t > 10){
      v.phase = 'rise'; v.t = 0;
      host.sitTarget = guest.sitTarget = 0;
      /* 出堂一路向下（唯一的上坎是门槛 +0.24，默认窗口 0.42 够），
         把 S4 进门临时放宽的 stepUp 收回。 */
      host.def.stepUp = guest.def.stepUp = 0.42;
    }
    return;
  }
  if (v.phase === 'rise'){
    if (host.sitW <= 0.06 && guest.sitW <= 0.06){
      v.phase = 'exit'; v.t = 0;
      giveRoute(host, EXIT_PTS.host, 0.52, 0.25, 2.0);
      giveRoute(guest, EXIT_PTS.guest, 0.52, 0.45, 2.0);
    }
    return;
  }
  if (v.phase === 'exit'){
    if (host.arrived && guest.arrived){
      if (v.mode === 'walk'){
        /* 旧版直接并排回门内再送客（保留给 ?visit=walk 的回归用） */
        v.phase = 'eline'; v.t = 0;
        v.eptsH = offsetPath(ESCORT.pts, ESCORT.hostLat);
        v.eptsG = offsetPath(ESCORT.pts, ESCORT.guestLat);
        v.epath = pathTable(ESCORT.pts);
        host.def.stepUp = guest.def.stepUp = 1.35;
        giveRoute(host, [v.eptsH[0]], PAIR.speed, 0.25, 2.45);
        giveRoute(guest, [v.eptsG[0]], PAIR.speed, 0.55, 2.45);
      } else {
        v.phase = 'tourgo'; v.t = 0;
      }
    }
    return;
  }
  /* 步行版的并排回门（?visit=walk 专用；马车版走下面的 tourgo/tour 单列游园）。
     ⚠️ 这两段是 S3 的既有实现，**不能因为加了游园分支就删** —— 删了以后
     walk 版会在 exit 之后停在 eline 上没有分支接手（2026-10-24 实测：
     相位链断在 300.7@eline，整场戏不往下走）。 */
  if (v.phase === 'eline'){
    if (host.arrived && guest.arrived){
      v.phase = 'epair'; v.t = 0; v.s = 0;
      host.pairDrive = guest.pairDrive = true;
      host.waitT = guest.waitT = 0;
    }
    return;
  }
  if (v.phase === 'epair'){
    drivePair(v, host, guest, v.epath, ESCORT.hostLat, ESCORT.guestLat, dt,
      () => { v.phase = 'eface'; v.t = 0; });
    return;
  }
  if (v.phase === 'tourgo'){
    v.tourPath = buildTourPath();
    v.tourS = TOUR.gap;
    host.def.stepUp = guest.def.stepUp = 1.35;   // 桥北/桥南各有一级 0.69m
    host.def.floorMax = guest.def.floorMax = 2.45;
    host.pairDrive = guest.pairDrive = false;
    host.arrived = guest.arrived = false;
    host.walkOff = guest.walkOff = true;
    host.moveW = guest.moveW = 0;
    v.phase = 'tour'; v.t = 0;
    return;
  }
  if (v.phase === 'tour'){ driveTour(dt); return; }
  if (v.phase === 'eface'){
    host.def.stepUp = guest.def.stepUp = 0.42;       // 游园结束，收回上桥的宽窗口
    v.t += dt;
    const dh = turnToward(host, yawToOther(host, guest), dt);
    const dg = turnToward(guest, yawToOther(guest, host), dt);
    /* 至少站 1.2s 再行礼（同 S2 face：走到就拜读起来像"撞上去"） */
    if (v.t > 1.2 && dh < 0.10 && dg < 0.10){ v.phase = 'ebow'; v.t = 0; }
    return;
  }
  if (v.phase === 'ebow'){
    v.t += dt;
    const t1 = BOW.in, t2 = BOW.in + BOW.hold, t3 = t2 + BOW.out;
    if (v.t < t1) v.bowW = ease01(v.t / BOW.in);
    else if (v.t < t2) v.bowW = 1;
    else if (v.t < t3) v.bowW = 1 - ease01((v.t - t2) / BOW.out);
    else {
      v.bowW = 0; v.phase = 'watch'; v.t = 0;
      /* 客人沿石板路回马厩：马车版一直走到车边（GUEST_HOME2），再上车离开；
         walk 版只走回马厩门口（旧口径）。 */
      v.guestSent = true;
      guest.def.stepUp = 0.70;
      giveRoute(guest, v.mode === 'walk' ? GUEST_HOME_PTS : GUEST_HOME2, 0.58, 0.45, 1.20);
    }
    turnToward(host, yawToOther(host, guest), dt);     // 转身没转完也继续对上
    turnToward(guest, yawToOther(guest, host), dt);
    return;
  }
  if (v.phase === 'watch'){
    /* 目送：主人站原地看客人走远一程（3.5s），自己再回堂。
       客人在走（自己那条 once 路线），主人无路线 → tickRoute 早退、原地站着。 */
    v.t += dt;
    if (v.t > 3.5){
      v.phase = 'hostback'; v.t = 0;
      /* 回程是**上坡**方向（廊道 0.38→1.30 逐级 + 桥拱）——同 stow/eline 的口径
         放宽到 0.80，'reenter' 换 0.70（进门那级 0.62）、坐下收回。 */
      host.def.stepUp = 1.35;
      giveRoute(host, HOST_RETURN_PTS, 0.58, 0.2, 2.45);
    }
    return;
  }
  if (v.phase === 'hostback'){
    if (host.arrived){
      v.phase = 'reenter'; v.t = 0;
      host.def.stepUp = 0.70;                       // 进门最后一级 0.62（同 S4 口径）
      giveRoute(host, ENTER_PTS.host, 0.52, 0.3, 2.0);
    }
    return;
  }
  if (v.phase === 'reenter'){
    if (host.arrived){ v.phase = 'reseat'; v.t = 0; }
    return;
  }
  if (v.phase === 'reseat'){
    if (seatOne(host, SEAT.host, dt)){
      host.def.stepUp = 0.42;                       // 坐下了，收回
      v.hostSeated = true;
      v.phase = 'wrap'; v.t = 0; v.wrapWarned = 0;
    }
    return;
  }
  /* wrap：主人坐回椅子、马车已离开（或 walk 版无马车）才收尾 */
  if (v.phase === 'wrap'){
    if (v.hostSeated && (v.mode === 'walk' || VISCAR.state === 'gone')){
      v.phase = 'done'; v.t = 0;
      return;
    }
    /* 超时兜底（2026-10-24）：这一相位只等 VISCAR.state === 'gone'，而那条链
       （客人走到车边 → 马夫走到车夫位 → 跨上车 → 倒车 → 调头 → 离场）任何一环卡住，
       整场戏就**永久停在 wrap**、再也不重播，而且画面上什么都不报。
       至少让它可诊断：每 30s 打一条 warn（带卡在哪一步）；超过 180s 且主人已坐好就强制收尾
       （resetVisit 会把车/人全部复位 ⇒ 下一场从干净状态重演，比永久卡死好）。 */
    v.t += dt;
    if (!v.wrapWarned || v.t - v.wrapWarned > 30){
      v.wrapWarned = v.t;
      console.warn('[visit] wrap 等待超时 ' + v.t.toFixed(0) + 's：hostSeated=' + !!v.hostSeated +
                   ' car=' + VISCAR.state + '/leg=' + (VISCAR.leg || '-') +
                   ' guestOn=' + !!VISCAR.guestOn + ' coachOn=' + !!VISCAR.coachOn +
                   ' guestArrived=' + !!guest.arrived);
    }
    if (v.t > 180 && v.hostSeated){
      console.warn('[visit] wrap 超 180s 仍未见到车离场 ⇒ 强制进入 done（复位后重演）');
      v.phase = 'done'; v.t = 0;
    }
    return;
  }
  /* done：这一场结束。冷却 45s 后复位重播（老黄："可重播"）。
     ⚠️ 刻意的"终态停留"没有了：复位由 resetVisit 做，条件不满足时下一场会停在 idle
        （客人不出现），满足时自动再演一遍。
     ⚠️ 冷却 8s 太短：整场戏约 9 分半，客人刚送走 8 秒又拉来一位，读起来像"卡带循环"，
        而且整场的收尾画面（主人坐回椅子、客人上车走远）只留 8 秒就复位。45s 是"一场结束
        歇一会儿"的量级，也给验收探针留出取终态的时间。 */
  if (v.phase === 'done'){
    v.t += dt;
    if (v.t > 45) resetVisit();
  }
}

/* 一次完整更新（时钟由调用方推进）—— tickActors 与探针的 actorStep 共用同一份，
   避免探针里再抄一遍步态口径（抄一遍 = 改产品时两边悄悄分家）。 */
function advance(dt){
  tickVisit(dt);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const a of ACTORS){
    tickRoute(a, dt);
    /* 上车/下车：一段纯插值的短程（1~1.3s），不走步态、不取踏面 ——
       走路时脚要踩地，而上下车是"跨上去/跳下来"，本来就是一气呵成。 */
    if (a.trip){
      a.trip.t += dt;
      const u = Math.min(1, a.trip.t / a.trip.dur);
      const ee = ease01(u);
      const F = a.trip.from, T = a.trip.to;
      a.pos.x = F.x + (T.x - F.x) * ee;
      a.pos.z = F.z + (T.z - F.z) * ee;
      a.y = F.y + (T.y - F.y) * ee;
      a.yaw = F.yaw + angDiff(T.yaw, F.yaw) * ee;
      a.moved = 0; a.moveW = 0;
      if (u >= 1){
        const cb = a.trip.onDone;
        a.trip = null;
        if (cb) cb();
      }
    }
    /* 马夫握缰 / 系马抬手的权重（只驱动肘腕，见下面的姿态块） */
    a.coachW = approach(a.coachW, a.ride && a.def.id === VISIT.coachId ? 1 : 0, dt / 0.5);
    a.tieW = approach(a.tieW, a.tieTarget ? 1 : 0, dt / 0.6);
    /* 院子/台基面：马厩是 deferBootFirst 建的，人物 GLB 可能先到 ⇒ 头几次射线只打得到地形。
       所以头 4 秒（16 次 ×0.25s）**持续采样取最高**，之后冻结：院子面一建出来就被采用。
       只接受 [−0.4, 0.8] 的命中，免得把马厩屋顶（2.9m）当成地面。
       （第一版"打中即冻结"踩过：第一个采样点打到的正是地形 0.052 ⇒ 人整体矮 5cm。） */
    if (a.def.floorRay && !a.ride && !a.trip && (!a.floorDone || a.def.followFloor)){
      /* followFloor（走长路的人，2026-10-23 客人）：**边走边采样**，并把间隔从 0.25s 收到
         0.10s —— 0.25s 在 0.58m/s 下已经是 15cm 一格，起伏路面会看出"悬空/下陷"。
         站着不动（或已到站）时只在必要时补采一次，避免每帧打射线。 */
      if (!a.def.followFloor || a.moved > 1e-4) a.sampleT -= dt;
      if (a.sampleT <= 0){
        a.sampleT = a.def.followFloor ? 0.10 : 0.25;
        const fy = a.def.followFloor
          ? sampleFloorNear(a.pos.x, a.pos.z, a.y, a.def.stepUp)
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
       fixedY = 钉在 spot.y（= 凳子所在的地面高，14-props 给的）。
       被马车载着 / 上下车过渡中：高度由 ride/trip 直接给，不取踏面（否则会被拉回地面）。 */
    const gy = (a.ride || a.trip) ? a.y
      : (a.def.fixedY ? a.def.spot.y
      : (a.def.floorRay ? (a.floorY === null ? a.y : a.floorY) : groundHeight(a.pos.x, a.pos.z)));
    if (!a.ride && !a.trip){
      /* 位置：先落地点，再叠步态起伏。groundHeight 是缓坡，直接跟即可。
         跟随型（走长路的人）收敛快一点，起伏路面上不至于"慢半拍"地悬空。
         ⚠️ 18/s 在**台阶**上留了 8.6cm 的瞬时悬空（S3 实测：拱桥/廊道那段每级 0.2m 的
            台阶，走上去的那 0.2s 里脚底一直比踏面低）⇒ 跟随型改 34/s（时间常数 29ms）。
         ⚠️ 但**超过 15cm 的高差要直接落上去**：门内那道门槛比园内草地低 0.42m、
            门口的 24cm 下槛又比堂内地坪高 0.18m，用平滑跟就会看到人"从地里升上来"
            （实测瞬时差 0.088 / 0.078 且要 0.1s 才收完）。15cm 以下的起伏仍走平滑
            （缓坡、砖缝这类小起伏不该一格格跳）。普通角色仍 8/s。 */
      const gapY = gy - a.y;
      if (a.def.followFloor && Math.abs(gapY) > 0.15) a.y = gy;
      else a.y += gapY * Math.min(1, dt * (a.def.followFloor ? 34 : 8));
    }
    const o = a.def.idle;
    const p = a.step / (a.def.stepLen || STEP_LEN) * Math.PI;      // 步态相位（按走过的距离推进）
    const w = a.moveW;
    /* 影子跟着人走（2026-10-27）：阴影图是静态只渲一次的，人一动影子就留在原地，
       画面上就是"每走一步都有一块影子拖在脚后"（老黄："右脚始终感觉有个拖影"）。
       做法：**在动的时候不投影**（改用贴地软影），停下时再烘一次、落到他现在的站位。
       ⚠️ 切换才烘（整场景 shadow pass 很贵），不是每帧；坐车/上下车期间也不投影 ——
          否则会在车厢里烘出一个人的影子。 */
    const inMotion = w > 0.02 || !!a.ride || !!a.trip;
    const castNow = !inMotion;
    if (castNow !== a.shadowCast){
      a.shadowCast = castNow;
      for (const m of a.meshes) m.castShadow = castNow;
      markCasterBoxDirty();
      renderer.shadowMap.needsUpdate = true;
    }
    if (a.blob) a.blob.visible = w > 0.02 && !a.ride && !a.trip;
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
    const cs = curSit(a); const legSym = hopCrouch * 0.8 - KNEEL.thigh * k - cs.thigh * st2;   // 两条腿共用的对称分量
    set('LeftUpperLeg',  a.amp * sw * w + legSym, 0, 0);    // 步态异号（交替）
    set('RightUpperLeg', -a.amp * sw * w + legSym, 0, 0);   // 对称分量同号（同向前屈）
    set('LeftLowerLeg',  -GAIT.knee * Math.pow(Math.max(0,  Math.cos(p)), 1.2) * w - hopCrouch * 1.8 - hopTuck + KNEEL.knee * k + cs.knee * st2, 0, 0);
    set('RightLowerLeg', -GAIT.knee * Math.pow(Math.max(0, -Math.cos(p)), 1.2) * w - hopCrouch * 1.8 - hopTuck + KNEEL.knee * k + cs.knee * st2, 0, 0);
    set('LeftFoot',  -GAIT.foot * sw * w + KNEEL.foot * k + cs.foot * st2, 0, 0);
    set('RightFoot',  GAIT.foot * sw * w + KNEEL.foot * k + cs.foot * st2, 0, 0);
    set('Hips',  0.010 * w,
        GAIT.hipYaw * sw * w,
        GAIT.hipRoll * Math.cos(p) * w);

    /* A 姿势 → 自然垂手（实测左 +Y / 右 -Y）。只对文士生效，仕女本来就是垂手。 */
    const ad = o.armDown || 0;
    /* 逐角色垂手系数：不同资产的绑定姿势不一样（客人本来就近垂手，用主人的角会抱手） */
    const ADK = a.def.armDownK || ARM_DOWN;
    /* 自然垂手的基准角（客人/文士；其余角色为 null ⇒ 走旧的"只绕 X"口径）。
       ⚠️ 必须定义在 `if (ad > 0.001)` **外面**：下面的捧卷/端茶/作揖都要从这个基准过渡，
          写在块里就会变成"块内可见"，那三段拿不到、手会在切换时弹回旧姿势。 */
    const relaxed = RELAXED_ARM[a.def.id] || null;
    const armBaseX = () => (relaxed ? relaxed.x : -ADK * ad);
    const armBaseZ = (side) => (relaxed ? (side === 'Left' ? relaxed.z : -relaxed.z) : 0);
    const handBase = (side) => (relaxed
      ? [relaxed.hx, side === 'Left' ? relaxed.hy : -relaxed.hy, side === 'Left' ? relaxed.hz : -relaxed.hz]
      : [0, 0, 0]);
    if (ad > 0.001){
      /* 绕 X；⚠️ **两只手都是负号**，不是镜像反号 —— 这一条实测过两遍：
         第一次按"镜像"给右臂写 +ad，结果右胳膊被抬到脸旁（左臂正常）；
         actor-right-arm-sign.mjs 按产品 set() 口径单扫右臂：x=−1.2 ⇒ 手 (−0.295,0.994,0.214)、
         x=+1.2 ⇒ (−0.369,1.475,−0.343)（抬起来了）。所以左右同为 −。 */
      /* 走路时手臂前后摆（2026-10-25 老黄："走路时手的位置和姿态像 gay"）：
         · 原来走路时两条胳膊**完全不动**、直挺挺垂着，这是被读成"扭捏"的主因；
         · 摆动的轴是 **X**（actor-swing-axis.mjs 实测：x 每 0.2rad 手前后走 5~6cm、
           上下只 2cm；绕 z 则是 3cm 前后 + 5cm 上下 = 张翅膀，第一版就栽在这）；
         · 左右**反号**：左 x 更负 = 手往前、右 x 更正 = 手往后 ⇒ 与腿交替；
         · 幅度 0.40rad，配 0.10~0.26rad 屈肘（摆到前面那只手更弯）+ 前臂内旋 ±0.12
           让掌心朝向身体 —— 直臂摆动像机器人，掌心朝外像"端着架子"。 */
      if (relaxed){
        /* 自然垂手（站与走共用同一组基准角）：手在大腿旁、掌心朝内；走路只叠前后摆。
           基准角由 arm-2axis / hand-sweep 两个探针实测解出（见 RELAXED_ARM 注释）。 */
        const swing = Math.sin(p) * 0.16 * w;
        set('LeftUpperArm',  relaxed.x - swing, 0,  relaxed.z);
        set('RightUpperArm', relaxed.x + swing, 0, -relaxed.z);
        set('LeftLowerArm',  relaxed.ex + 0.05 * Math.max(0,  Math.sin(p)) * w, 0, 0);
        set('RightLowerArm', relaxed.ex + 0.05 * Math.max(0, -Math.sin(p)) * w, 0, 0);
        set('LeftHand',  relaxed.hx,  relaxed.hy,  relaxed.hz);
        set('RightHand', relaxed.hx, -relaxed.hy, -relaxed.hz);
        for (const sd of ['Left','Right']){
          set(sd + 'IndexProximal', 0.45, 0, 0);
          set(sd + 'MiddleProximal', 0.45, 0, 0);
          set(sd + 'IndexIntermediate', 0.32, 0, 0);
          set(sd + 'MiddleIntermediate', 0.32, 0, 0);
          set(sd + 'ThumbProximal', -0.32, 0, 0);
          set(sd + 'ThumbIntermediate', -0.26, 0, 0);
          set(sd + 'ThumbDistal', -0.14, 0, 0);
        }
      } else {
        const swing = Math.sin(p) * 0.40 * w;
        set('LeftUpperArm', -ADK * ad - swing, 0, 0);
        set('RightUpperArm', -ADK * ad + swing, 0, 0);
        if (w > 0.02){
          const bendL = 0.10 + 0.16 * Math.max(0, Math.sin(p)) * w;
          const bendR = 0.10 + 0.16 * Math.max(0, -Math.sin(p)) * w;
          set('LeftLowerArm', bendL, 0.12, 0);
          set('RightLowerArm', bendR, -0.12, 0);
        }
      }
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
    /* ⚠️ 2026-10-27 真 bug（老黄："走路姿势，手还是不对"）：捧卷只在**站定**时做。
       之前只判 !visiting ⇒ 文士在自己散步时**边走边捧卷**，走路臂姿被 SCROLL 的手位整个覆盖，
       画面上就是"两只手摊在身前、掌心朝下"（卷轴又被宽袖挡住看不见）。
       w>0.05 时走进下面的 else-if，卷轴 0.55s 收起、手臂回到步行摆臂。 */
    if (o.scroll && !visiting && w < 0.05){
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
        /* 从"自然垂手"的基准过渡（含手腕角）—— 只过渡上臂会让手在收起/捧起时闪一下。 */
        const hbL = handBase('Left'), hbR = handBase('Right');
        const exB = relaxed ? relaxed.ex : 0;
        set('LeftUpperArm',  armBaseX() * (1 - w2) + L.sx * w2, L.sy * w2, armBaseZ('Left') * (1 - w2) + L.sz * w2);
        set('RightUpperArm', armBaseX() * (1 - w2) + Rr.sx * w2, Rr.sy * w2, armBaseZ('Right') * (1 - w2) + Rr.sz * w2);
        set('LeftLowerArm', L.ex * w2 + exB * (1 - w2), 0, 0);
        set('RightLowerArm', Rr.ex * w2 + exB * (1 - w2), 0, 0);
        set('LeftHand',  SCROLL.hx * w2 + hbL[0] * (1 - w2), hbL[1] * (1 - w2), hbL[2] * (1 - w2));
        set('RightHand', SCROLL.hx * w2 + hbR[0] * (1 - w2), hbR[1] * (1 - w2), hbR[2] * (1 - w2));
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
    /* 手持草料：只动**左肘**（肩保持垂手），手指松松地扣着草把 —— 见 HAY_ARM。
       马车版到访时马夫在驾车/系马，草把收起（否则一手草一手缰）。 */
    if (o.hay && a.coachW < 0.05 && a.tieW < 0.05){
      /* 2026-10-27：肘抬到 −0.90 ⇒ 草把举到马的嘴边（腕高约 0.95m），再叠 ±0.05 的慢速
         提放 —— 原来手臂垂着，草把贴在胸前，画面上读不出"在喂马"。 */
      set('LeftLowerArm', HAY_ARM.ex + 0.05 * Math.sin(_t * 1.3 + a.phase), 0, 0);
      set('LeftIndexProximal', 0.70, 0, 0);
      set('LeftMiddleProximal', 0.70, 0, 0);
      set('LeftIndexIntermediate', 0.50, 0, 0);
      set('LeftMiddleIntermediate', 0.50, 0, 0);
      set('LeftThumbProximal', -0.45, 0, 0);
      set('LeftThumbIntermediate', -0.38, 0, 0);
      set('LeftThumbDistal', -0.24, 0, 0);
    }
    /* ── 车夫握缰 / 系马（2026-10-23）─────────────────────────────────────────
       这只 rig 的**肩不能转**（腰带有一批顶点贴着前臂骨，见 BRUSH 的注释），所以
       驾车与系马都只动**肘 + 腕 + 指**：两条前臂抬到略高于水平、手扣住缰绳。
       视觉距离 15~25m ⇒ 读的是"两条胳膊往前伸、在胸前抓着东西"，够。
       ⚠️ 权重取 max(coachW, tieW)：两种状态互斥，但过渡帧会有短暂重叠。 */
    const rein = Math.max(a.coachW || 0, a.tieW || 0);
    if (rein > 0.001){
      const cw = rein;
      set('LeftLowerArm', -1.22 * cw, 0, 0);
      set('RightLowerArm', -1.10 * cw, 0, 0);
      set('LeftHand', 0.34 * cw, 0, 0);
      set('RightHand', 0.34 * cw, 0, 0);
      for (const sd of ['Left', 'Right']){
        set(sd + 'IndexProximal', 0.95 * cw, 0, 0);
        set(sd + 'MiddleProximal', 0.95 * cw, 0, 0);
        set(sd + 'IndexIntermediate', 0.70 * cw, 0, 0);
        set(sd + 'MiddleIntermediate', 0.70 * cw, 0, 0);
        set(sd + 'ThumbProximal', -0.60 * cw, 0, 0);
        set(sd + 'ThumbIntermediate', -0.52 * cw, 0, 0);
        set(sd + 'ThumbDistal', -0.34 * cw, 0, 0);
      }
    }

    /* ── 品茶（P2「喝茶」）：端着 → 抬到唇边 → 放下 ────────────────────────────
       4.2s 一个来回（抬 1.3 / 停 1.6 / 落 1.3），间歇 8~14s。
       只在**喝茶那只手**上写（右手），左臂继续走 armDown —— 两只手都端起来就成了"捧"。
       ⚠️ 与"捧卷轴"互斥：文士双手都占着卷轴时不能端盏 ⇒ 只在卷轴放下的那一相
          （a.scrollPhase === 2）才跑这段；其余时候把 sip 归零（否则低头角会冻住）。 */
    /* 同理：走路时不端盏（否则右臂被 TEA_ARM 抬到胸前，摆臂消失）。 */
    if (o.tea && (!visiting || (a.offerW || 0) > 0.001) && w < 0.05){
      let sip = 0;
      if (visiting){
        /* 迎客到访（S4）：举盏的权重由导演层给（1.2s 举到位、停 4.5s、1s 放下），
           不走"自己口渴喝一口"那套循环 —— 客人还坐着，主人不该自己灌茶。 */
        sip = a.offerW || 0;
        a.sipW = sip;
        a.teaT = 0;
      } else {
      a.teaWait -= dt;
      if (a.teaWait <= 0 && a.teaT <= 0){
        a.teaT = 1e-4;
        a.teaWait = o.teaEvery[0] + (o.teaEvery[1] - o.teaEvery[0]) * det(a.teaN++ + a.phase * 5.1);
      }
      if (a.teaT > 0){
        a.teaT += dt;
        const u = Math.min(1, a.teaT / 4.2);
        sip = u < 0.31 ? ease01(u / 0.31) : (u < 0.69 ? 1 : 1 - ease01((u - 0.69) / 0.31));
        if (u >= 1) a.teaT = 0;
      }
      a.sipW = sip;
      }
      const A = TEA_ARM.hold, B = TEA_ARM.lift;
      /* 抬手权重：sip 0→0.35 是从"垂手"抬到胸前（hold），0.35→1 才是举到颌下（lift）。
         ⚠️ 2026-10-25：原来 sip=0 就直接写 hold ⇒ 他**一整天端着一只看不见的盏**，
         出图里读成"伸手/让路"（杯子 3.9cm，被袖口挡住）。现在手垂着，喝茶才抬。 */
      const r1 = Math.min(1, sip / 0.35);
      const r2 = Math.max(0, Math.min(1, (sip - 0.35) / 0.65));
      const bl = armBaseX();
      const bz = armBaseZ('Right');
      const hbR = handBase('Right');
      const exB = relaxed ? relaxed.ex : 0;
      set('RightUpperArm',
          bl * (1 - r1) + (A.sx + (B.sx - A.sx) * r2) * r1, 0,
          bz * (1 - r1) + (A.sz + (B.sz - A.sz) * r2) * r1);
      set('RightLowerArm', exB * (1 - r1) + (A.ex + (B.ex - A.ex) * r2) * r1, 0, 0);
      set('RightHand', hbR[0] * (1 - r1) + (A.hx + (B.hx - A.hx) * r2) * r1,
          hbR[1] * (1 - r1), hbR[2] * (1 - r1));
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
        /* 被马车载着 / 在驾车 / 系马时不开始新一轮刷马（否则马夫一边拉缰一边刷空气） */
        if (a.brushWait <= 0 && w < 0.3 && !a.ride && rein < 0.05) a.brushT = 1e-4;
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
      const hbL = handBase('Left'), hbR = handBase('Right');
      const exB = relaxed ? relaxed.ex : 0;
      set('LeftUpperArm',  armBaseX() * (1 - wb) + L.sx * wb, L.sy * wb, armBaseZ('Left') * (1 - wb) + L.sz * wb);
      set('RightUpperArm', armBaseX() * (1 - wb) + Rr.sx * wb, Rr.sy * wb, armBaseZ('Right') * (1 - wb) + Rr.sz * wb);
      set('LeftLowerArm', BOW.ex * wb + exB * (1 - wb), 0, 0);
      set('RightLowerArm', BOW.ex * wb + exB * (1 - wb), 0, 0);
      set('LeftHand',  BOW.hand * wb + hbL[0] * (1 - wb), hbL[1] * (1 - wb), hbL[2] * (1 - wb));
      set('RightHand', BOW.hand * wb + hbR[0] * (1 - wb), hbR[1] * (1 - wb), hbR[2] * (1 - wb));
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
    const lean = (o.lean || 0) * (1 - a.brushW) * (1 - a.coachW) + BOW.lean * bw;
    const hd = (o.headDown || 0) * (1 - a.brushW) * (1 - a.coachW) + (o.tea ? a.sipW * 0.12 : 0) + BRUSH.headDown * a.brushW
             + SCROLL.headDown * a.scrollW + BOW.head * bw;
    set('Chest', o.breath * b + 0.02 * w + lean + cs.lean * st2 * (a.def.sitLeanK || 1), -GAIT.chestYaw * sw * w, o.sway * Math.sin(_t * 0.7 + a.phase));
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
      hb.position.copy(a.hipsRest).addScaledVector(a.hipsDown, KNEEL.drop * k + cs.drop * st2);
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
      /* 2026-10-27：走路时裙摆**跟着腿走**。
         原先 6 片共用同一个角度（整条裙子像钟摆前后晃），摆出去的那条腿会从裙下钻出来
         —— 实测客人走路时右小腿/鞋从袍摆缺口露出约 0.2m（outputs/_diag/pose-qa/guest-feet.png，
         放大后能看到一条肉色的小腿）。改成：每片按它所在的那一侧跟着**同侧腿**的相位摆，
         前片跟得多、后片跟得少；同时裙摆加长 5%、放宽 8%（长袍走路本来就会被腿撑开）。 */
      const lenE = (1 + (sq(KNEEL.skirtLen) - 1) * k) * (1 + (sq(cs.skirtLen) - 1) * st2) * (1 + 0.05 * w);
      const radE = (1 + (KNEEL.skirtRad - 1) * k) * (1 + (cs.skirtRad - 1) * st2) * (1 + 0.08 * w);
      /* 下段的翻转方向：跪坐 0.96（几乎对折回去）、坐凳 1.00（回到竖直、垂在膝前） */
      const swap = k + st2 > 1e-4 ? (k * KNEEL.kneeSwap + st2 * cs.kneeSwap) / (k + st2) : 1;
      for (const sk of a.skirt){
        const front = Math.cos(sk.ang);                       // 0° = 正前 ⇒ 1
        const legSw = Math.sin(sk.ang) >= 0 ? sw : -sw;        // 跟同侧的腿（Left=+amp·sw）
        const sway = w * a.amp * 1.15 * legSw * (0.55 + 0.45 * front);
        /* 跪坐：前襟整片前翻（0.55+0.55·front）。
           坐凳：前襟要**压在平放的大腿上**（1.0·front），后片只轻带一点（0.18）——
                 后片跟着前翻会让裙摆从凳子背后翘起来，读成"裙子掀了"。 */
        const th = sway
          - k * KNEEL.lift * (0.55 + 0.55 * front)
          - st2 * cs.lift * (0.18 + 1.00 * Math.max(0, front));
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
      /* 捧卷时盏收起来：手里不能同时有卷轴和茶盏；
         ⭐ 但**迎客举盏（S4）例外** —— 那时卷轴已经收进袖里（scrollW=0），
         手里只有盏，必须让它露出来，否则"奉茶"只有手没有盏。 */
      a.cup.visible = !o.scroll || a.scrollPhase === 2 || (a.offerW || 0) > 0.001;
      if (wr){
        a.holder.updateMatrixWorld(true);
        wr.getWorldPosition(_cupV);
        const yw = a.holder.rotation.y;
        /* 自己喝茶时盏贴近腕口（9cm）；**奉茶（offerW）时再往前 +5cm、往上 +5cm** ——
           否则盏正好落在袖口里，画面上只看到一截白袖子、读不出"端着一盏茶"
           （实测：world 手腕 (−1.26,1.944,−13.30) 与盏 (−1.27,1.96,−13.21) 只差 9cm）。
           这套骨架没有前臂旋前，掌心朝不了上，所以只能靠"把盏推离袖口"来让它露出来。 */
        const ow = a.offerW || 0;
        _cupV.x += Math.sin(yw) * (TEA_CUP_FWD + 0.05 * ow);
        _cupV.z += Math.cos(yw) * (TEA_CUP_FWD + 0.05 * ow);
        _cupV.y += 0.02 + 0.05 * ow;
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
      // ④ 马夫驾车时手握缰绳，不应再抱着草料（VISCAR 驾车段 + 任何 ride 状态）
      const driving = !!a.ride || (a.tieW && a.tieW > 0.05) || (a.coachW && a.coachW > 0.05);
      a.hay.visible = !!wl && !driving;
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
  return a ? { bones: a.bones, base: a.base, holder: a.holder,
               cup: a.cup, scroll: a.scroll } : null;
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
             sitW: +a.sitW.toFixed(3), offerW: +(a.offerW || 0).toFixed(3),
             moveW: +(a.moveW || 0).toFixed(3),
             ride: !!a.ride, trip: !!a.trip,
             coachW: +(a.coachW || 0).toFixed(3), tieW: +(a.tieW || 0).toFixed(3),
             visible: !!a.holder.visible };
  };
  const V = stableTravel();
  return { phase: VISIT.phase, t: +VISIT.t.toFixed(2), bowW: +VISIT.bowW.toFixed(3),
           mode: VISIT.mode,
           car: { state: VISCAR.state, s: +VISCAR.s.toFixed(2), leg: VISCAR.leg,
                  odo: +VISCAR.odo.toFixed(3),          // 累计里程：门禁守"跨段连续、无跳变"
                  tieOn: !!VISCAR.tieOn, guestOn: !!VISCAR.guestOn, coachOn: !!VISCAR.coachOn,
                  ready: !!V,
                  pos: V && V.car ? V.car.getWorldPosition(new THREE.Vector3()).toArray().map(n => +n.toFixed(3)) : null },
           host: one(VISIT.hostId), guest: one(VISIT.guestId), coach: one(VISIT.coachId) };
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
