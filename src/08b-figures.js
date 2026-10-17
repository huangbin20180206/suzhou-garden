// 08b-figures: 人物（2026-10-15 W2 从 08-assemble.js 纯搬家：265-1465 点景人物＋3374-3548 看烟花一家）。
// 逻辑一字不动；铁律 1：jr/WR 两条布局流随代码一起搬进本模块（08 仅留 import { jr } 供补石用），
// 求值期消耗随 buildFigures()/buildWatchers() 在 08 原行号位置调用，顺序逐字一致。
import { THREE } from '../vendor.js';
import { world } from './02-scene.js';
import { mesh } from './03-factory.js';
import { groundHeight } from './05-water.js';
import { TAU, mulberry32 } from './00-config.js';
import { WALK_PATH, WALKERS, walkPointAt, WALK_SPEED, WALK_TURN, WALK_STRIDE, WALK_BOB, WALK_SWAY } from './08d-tour.js';
import { ENV } from './12-env.js';
import { PROP_SPOTS, makeWoodBucket, BUCKET_HANDLE_H, setGoPiecesVisible } from './14-props.js';
import { makeFeedBale } from './15-stable.js';

/* ── 布局专用抖动流（2026-09-23 · T0）：从 08-assemble.js:9-17 原样搬入。
   本模块两处用途：人物呼吸相位（建场）与看烟花一家的相位/跳跃（建场）。
   ⚠️ 08-assemble 的假山补石仍在用 jr ⇒ 那边 import { jr } 回去，流对象还是同一枚，顺序不变。 */
export const jr = mulberry32(20260924);
export const WR = mulberry32(20261009);

/* ══ 人物 · 点景人物（彩色剪影）（样稿：先过用户审，再铺日程系统）══
   用户前史："之前的AI把人物做得跟鬼一样" —— 病根是低模硬追写实五官/人体结构，
   正好落进恐怖谷。这条路线不动摇：**以形写神**，五官一个面都不建。
   · 宽袍大袖的 lathe 轮廓（江南直裰 A 形剪影，衣纹交给光影，不做面）
   · 无脸：圆头+发髻，五官一个面都不建
   · 姿态"负手观荷"：双袖拢到身后、俯首
   · 2026-09-18 上色：单色墨蓝剪影 → **四分区分色**（袍身 / 腰带 / 衣缘 / 发髻），
     色值与明度定标见下方 FIG_PALETTE（量出来的，不是调的）。
     无脸剪影认身份全靠**色块分区 + 姿态**这两条。
   · 呼吸微动 0.6% —— 剪影的"活"就靠这一口气 */
/* 人物服色（2026-09-18 · 老黄给的风俗画参考图）—— 色值来自 probe/figure-palette.mjs 实测。
   ⚠️ 抄的是参考图的**色相策略**，不是它的明度：参考图是"褪色绢本"（背景暗部 L≈90），
   本场景背景低饱和区 L≈178（粉墙/水面/天空），照抄明度＝把衣服压成灰点。
   本场景的**冷色是空位**（蓝 1.1% + 青 0.4%），植被绿却占 39% —— 穿冷色＝独占色相。
   trim 由原来的冷灰 0xB9C2CE 改米白：暖衣缘贴冷袍身，两段都读得出来。
   ⚠️ **草坪是绿底**：袍色若与植被绿（实测 #457441）同族，人一遭放上草坪就没了 ——
   首版把松绿 #5F8467 给了童袍，样张里那孩子与草坪只有 ΔRGB 49，几乎看不见（老黄给的是
   风俗画参考图，画里人站在石头/木构上，天然没这个问题；我们的人站在草地上，得自己兜）。
   所以**站草坪上的角色一律用非绿色相**（宝蓝/天青/秋香），绿色系只留给水榭平台上的角色。
   ⚠️ 色值改错不报错、不崩、不触发任何门禁 —— 由 probe/figure-audit.mjs 把守。 */
export const FIG_HAIR = 0x1C2029;
export const FIG_PALETTE = {
  indigo:  { robe:0x4A6C9B, trim:0xDCD3BE, sash:0x2A3550 },   // 宝蓝 · 先生晨课（草坪）L=104
  /* 天青 · 书童（草坪）—— **刻意提亮**：同框的蓝袍 L=104，深天青 #6E9C93 只差 42，
     提亮到 L=162 后与蓝袍差 58、与草坪差 60，两头都有余量（首版就是这一对余量只剩 1） */
  celadon: { robe:0x7FADA2, trim:0xE8E0CC, sash:0x3A5B55 },
  ochre:   { robe:0xA8804E, trim:0xE8DFC8, sash:0x5A4224 },   // 秋香 · 书童（草坪）
  moss:    { robe:0x5F8467, trim:0xDDD6C2, sash:0x2F4634 },   // 松绿 · 午后品茗（水榭平台，不在草坪）
  lily:    { robe:0x7E6FA6, trim:0xE0D6C8, sash:0x39305A },   // 藕荷 · 夜步（游廊）
  /* 坐姿二人（对弈 · 东草坪石桌）：**必须新开两个色相**，不能复用现役那三个。
     figure-audit 的"同框可区分"只约束 **slot 重叠**的角色对，而现役五色恰恰卡在这里：
     坐姿取 12.5~18 只与 moss(午后品茗 12~18) 同框，而 moss↔indigo 只有 61、moss↔ochre 88 ——
     复用 indigo/ochre 会直接进"同框"那组、且 indigo 只剩 1 点余量（阈值 60）。
     下面两色对现役五色的最小距离：绛紫 68（vs ochre）、藏青 52（vs indigo，两者 slot 不重叠、
     不参与判定，故可取）。两色对**草坪绿 #457441** 分别是 92 / 72，都过 LAWN_D 60。 */
  plum:    { robe:0x8B4A6B, trim:0xE2D6C8, sash:0x4A2C3E },   // 绛紫 · 对弈（东草坪石桌）
  navy:    { robe:0x2F4E7A, trim:0xDDD8C6, sash:0x1C2C44 },   // 藏青 · 对弈（东草坪石桌）
  /* 石青 · 抚琴（水榭临水）。它和上面两色同在 12.5~18 档、又与该档的 moss 同框，
     所以要求 ≥60 的伙伴是 {moss, plum, navy}：实测 67 / 94 / 100，全部有余量。
     与 indigo/lily 只差 50/33，但那两色分别属 7.5~12 / 18~23 档，**永不与它同框**
     （figure-audit 的"同框可区分"只约束 slot 重叠的对，这是该判据的既定口径）。 */
  slate:   { robe:0x6E8CA8, trim:0xE4DED0, sash:0x2E4257 },   // 石青 · 抚琴（水榭，临水）
  /* 朱红 · 看烟花的三童之末（2026-10-05 · 与 12-env 的春节烟花配套）。
     为什么必须新开一色、不能复用现役五色：这五个人的 slot 全是 18~23（与"夜步"同档），
     **必然互相同框** ⇒ figure-audit 的"同框可区分"要求两两 ΔRGB ≥ 60。现役非绿色相里
     只剩 moss（67~79 勉强过、但它对草坪绿只有 49 —— 站草坪等于隐身，见本表开头的血泪），
     所以取春节的一抹红开新色。实测（口径同 figure-palette 的 RGB 欧氏距离）：
       · 与同框四人：plum 84.8 / navy 166.5 / celadon 178.4 / ochre 82.7（最小 82.7）
       · 与**重叠时段**的"夜步"lily(18~23) 149.7（最小 62.1 是 celadon，见上）
       · 与草坪绿 #457441 = 138.2（LAWN_D 60 的 2.3 倍，站草坪读得出来）
       · L=84.7 ≥ 70（非近黑剪影）；与 trim 差 136.9、与 sash 差 53.5（都 ≥ 25）
     取色理由：朱红是"年"的颜色，夜里的篝火色相在冷月夜里也立得住（与月光/雪意的青蓝互补）。 */
  vermilion:{ robe:0xC0392B, trim:0xEBDCC6, sash:0x4A1410 },   // 朱红 · 看烟花的孩童
  /* ── 2026-10-05 · 观鱼人 / 仕女：两人都取 **7.5~12 晨档** —— 这是全天最空的一档，
     与之重叠的现役色只有 indigo(先生)、celadon(书童甲)、ochre(书童乙)。
     ⚠️ 两人彼此也同框 ⇒ 它们之间也要 ≥60。
     实测（口径同 figure-palette 的 RGB 欧氏距离，对**同档四色**取最小值）：
       · 月白 vs indigo 181 / celadon 106 / ochre 169 / 丁香 88 ⇒ 最小 88
       · 丁香 vs indigo 106 / celadon  61 / ochre 113 / 月白 88 ⇒ 最小 61
     两色对草坪绿 #457441 分别是 228 / 162（LAWN_D 60 的 3.8 / 2.7 倍）。
     ⚠️ 月白偏亮（L=213），所以它的 **trim 必须取深色**（0x4E5866）—— 照别的角色那样用
     浅玉色衣缘的话，与袍身明度差只有个位数、交领读不出来（figure-audit 会红）。 */
  moonwhite:{ robe:0xCFD6DA, trim:0x4E5866, sash:0x2A3550 },   // 月白 · 观鱼人（拱桥）
  lilac:   { robe:0xA98BBF, trim:0xE0D6C8, sash:0x4A3A5E },   // 丁香 · 仕女（井边）
  /* 赭红 · 马夫（马厩 · 2026-10-12 补开）。**为什么必须新开一色**：马夫的 slot 是 7.5~18
     （晨+午都在场），与 7.5~12 的**书童乙**重叠；原先他直接复用了 `ochre`，于是这一对
     slot 重叠且**同色**（#A8804E ↔ #A8804E，ΔRGB=0）—— 正是 figure-audit「同框可区分」
     （slot 重叠对要求 ΔRGB ≥ 60）会红的那种缺陷。不去动档期（会丢掉晨间喂马），也不借
     别人的色（`vermilion` 是朱红孩童的），照本表既有体例新开一色。
     实测（口径同 figure-palette 的 RGB 欧氏距离，对**所有 slot 重叠色**取最小值）：
       · ochre 80.0 / plum 72.0 / moss 116.9 / navy 141.0 / indigo 152.1 / slate 160.0 /
         celadon 170.9 / lilac 171.6 / moonwhite 241.3 ⇒ 最小 **72.0**（vs plum，余量 12）
       · 与草坪绿 #457441 = 110.8（马厩建在草皮上，LAWN_D 60 的 1.8 倍）
       · L=78.4 ≥ 70（非近黑剪影）；与 trim 差 144.9、与 sash 差 38.0（都 ≥ 25）
     ⚠️ 取色时**别往下压暗**：同一色相的 0x7A2E2E 明度只有 62.1 < 70，会反而红「近黑剪影」那条。 */
  russet:  { robe:0xA03A28, trim:0xE8DFC8, sash:0x4A2018 },   // 赭红 · 马夫（马厩）
};
const figMat = (color, rough) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, envMapIntensity: 0.3 });
/* ══ 半写实贴图与皮肤件（2026-10-06 · 用户选"第 3 档：半写实"）══════════════════
   此前的人物是"纯色积木"：头是一颗无脸黑球、袍是一片单色、手只到袖口为止。
   半写实升级 = 三件事，全部**程序化**（零外部文件，与 01-materials 的 Canvas 贴图同一套做法）：
   ① 脸贴图 —— 五官/肤色/发际线直接画在头球的球面 UV 上（一颗球 = 发型 + 脸）；
   ② 织物贴图 —— 袍/衣缘/腰带加织纹。⚠️ 是**白底乘色**：贴图只提供明度纹样，
      material.color 保持 FIG_PALETTE 原值 —— probe/figure-audit.mjs 的全部判色
      （同框 ΔRGB / 草坪距离 / 近黑下限 / 袍=表内色）读的都是 material.color，对 map
      零感知 ⇒ 配色门禁一条不受影响；
   ③ 皮肤件 —— 颈（填"立领顶→头底"那段透缝）与手（自袖口探出的肤色椭球；坐姿的掌
      直接由袍色换肤色）。新增几何只有"颈 + 手"两件，骨架/比例/摆位/动作一概不动
      —— 那些牵动全部道具挂点与既有门禁，不是本次的事。
   ⚠️ 纪律（每条都有出处）：
   · 贴图绘制**零随机**（建场期多抽一次随机都是布局漂移，与 jr/WR 铁律同源）；
   · 新网格的 noMerge 由 makeXxx 末尾的 root.traverse 统一打，不用另设；
   · 11-loop 的 figures 循环每帧只写 robe.scale / position / rotation / visible，
     头与材质无人碰 ⇒ 静态挂接一次生效，不存在"被每帧覆盖"的坑。 */

/* 肤色单例：不参与配色门禁（figure-audit 只认袍/腰/缘/领），全角色统一一版。
   0xEAC9A6 暖白肤——冷月夜偏灰蓝、暖阳下偏金，两头都立得住。 */
const FIG_SKIN = 0xEAC9A6;
const figSkinMat = figMat(FIG_SKIN, 0.68);
const figTexCache = new Map();

/* 脸贴图（成人 / 孩童两版）。球面 UV 口径（THREE.SphereGeometry 默认）：
   u=0.25 的经线朝 **+z**（模型正面，与"模型正面 = +z"的全项目约定一致）、
   v=0 头顶 / v=1 头底。⇒ 脸画在贴图 x≈64（u=0.25）一列，y 就是 v 方向。
   1px ≈ 2.1mm（头周长 0.54m ÷ 256）—— 眼裂 ~11px、唇线 ~3px 都是写实宽度；
   粗细按"3m 外可读"画（簪那条教训：画细了等于没画）。 */
function figFaceTexture(child){
  const key = child ? 'faceChild' : 'faceAdult';
  if (figTexCache.has(key)) return figTexCache.get(key);
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  const HAIR = '#1C2029';                     // 与 FIG_HAIR 同值：发髻/总角是纯色材质，色必须一致
  x.fillStyle = HAIR; x.fillRect(0, 0, S, S); // 球面除脸窗外全是头发（后脑/顶/两侧）
  const cx = 64;                              // u = 0.25 → x = 64
  const top = child ? 64 : 60, bot = child ? 202 : 198;
  /* 脸窗：竖椭圆（半宽 33px ≈ ±46°，写实"露耳脸"的角度），窗内画肤色与五官 */
  x.save();
  x.beginPath();
  x.ellipse(cx, (top + bot) / 2, 33, (bot - top) / 2, 0, 0, Math.PI * 2);
  x.clip();
  x.fillStyle = '#EAC9A6'; x.fillRect(cx - 40, top - 6, 80, bot - top + 12);
  /* 皮肤立体感：额颧微亮、颌底微暗（软边带，不描轮廓线——工笔不上线） */
  const g = x.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, 'rgba(255,238,214,0.50)');
  g.addColorStop(0.45, 'rgba(255,238,214,0)');
  g.addColorStop(0.80, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(146,96,64,0.28)');
  x.fillStyle = g; x.fillRect(cx - 40, top - 6, 80, bot - top + 12);
  const eyeY = child ? 118 : 126;
  const eyeDX = child ? 15 : 17;
  const eyeW = child ? 9 : 11;
  for (const e of [-1, 1]){
    const ex = cx + e * eyeDX;
    /* 眉：一道斜弧 */
    x.strokeStyle = 'rgba(52,40,34,0.9)';
    x.lineWidth = child ? 2.6 : 3.0;
    x.beginPath();
    x.moveTo(ex - eyeW, eyeY - (child ? 16 : 18));
    x.quadraticCurveTo(ex, eyeY - (child ? 22 : 25), ex + eyeW, eyeY - (child ? 17 : 20));
    x.stroke();
    /* 眼：上睑深线 + 瞳点（细长眼在球面上才不像贴纸） */
    x.strokeStyle = 'rgba(40,28,22,0.95)';
    x.lineWidth = child ? 3.0 : 2.6;
    x.beginPath();
    x.moveTo(ex - eyeW, eyeY);
    x.quadraticCurveTo(ex, eyeY + (child ? 7 : 5), ex + eyeW, eyeY - 1);
    x.stroke();
    x.fillStyle = '#2E2118';
    x.beginPath();
    x.arc(ex + e * 1.5, eyeY + 2, child ? 2.6 : 2.2, 0, Math.PI * 2);
    x.fill();
    /* 腮红（孩子更浓） */
    x.fillStyle = child ? 'rgba(214,116,92,0.30)' : 'rgba(201,128,102,0.16)';
    x.beginPath();
    x.ellipse(ex, eyeY + (child ? 17 : 14), child ? 8 : 7, child ? 5.5 : 4.5, 0, 0, Math.PI * 2);
    x.fill();
  }
  /* 鼻：一道淡影（竖短线 + 鼻底弧）—— 鼻梁不描线，描了就是哭脸 */
  x.strokeStyle = 'rgba(176,124,88,0.55)';
  x.lineWidth = 2.2;
  x.beginPath(); x.moveTo(cx, eyeY + 5); x.lineTo(cx, eyeY + 13); x.stroke();
  x.beginPath(); x.moveTo(cx - 3, eyeY + 15); x.quadraticCurveTo(cx, eyeY + 17, cx + 3, eyeY + 15); x.stroke();
  /* 嘴：唇色一道微弧 */
  x.strokeStyle = 'rgba(168,93,78,0.95)';
  x.lineWidth = child ? 3.4 : 3.0;
  x.beginPath();
  x.moveTo(cx - 7, eyeY + (child ? 28 : 26));
  x.quadraticCurveTo(cx, eyeY + (child ? 32 : 30), cx + 7, eyeY + (child ? 28 : 26));
  x.stroke();
  x.restore();
  /* 发际线：脸窗上缘盖回一条发弧（中额高、两鬓低）+ 两撮鬓角 */
  x.fillStyle = HAIR;
  x.beginPath();
  x.moveTo(cx - 33, top + 26);
  x.quadraticCurveTo(cx, top - 10, cx + 33, top + 26);
  x.lineTo(cx + 33, top - 8); x.lineTo(cx - 33, top - 8);
  x.closePath(); x.fill();
  for (const e of [-1, 1]){
    x.beginPath();
    x.ellipse(cx + e * 30, top + 34, 5, 15, 0, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  figTexCache.set(key, t);
  return t;
}
/* 脸材质单例 ×2（成人/孩童）：头材质无人改属性，共享最省。 */
const figFaceMatA = new THREE.MeshStandardMaterial({ map: figFaceTexture(false), roughness: 0.62, metalness: 0.0, envMapIntensity: 0.35 });
const figFaceMatC = new THREE.MeshStandardMaterial({ map: figFaceTexture(true), roughness: 0.62, metalness: 0.0, envMapIntensity: 0.35 });

/* 织物贴图（白底乘色）：只提供明度纹样，material.color 继续由 FIG_PALETTE 决定。
   纹样周期按实物尺度：袍身周长 ~1.2m 铺满 256px ⇒ 1px≈4.7mm —— 斜纹 6px≈2.8cm、
   团花 128px≈60cm、腰带菱格 16px≈7.5cm。三种纹样对应三处材质。 */
function figClothTexture(kind){
  const key = 'cloth_' + kind;
  if (figTexCache.has(key)) return figTexCache.get(key);
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, S, S);
  if (kind === 'robe'){
    /* 45° 斜纹（缎纹底） */
    x.strokeStyle = 'rgba(0,0,0,0.05)'; x.lineWidth = 2;
    for (let i = -S; i < S * 2; i += 6){
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke();
    }
    /* 暗团花：两圈四瓣花交错（低对比 —— 远看是"缎面有货"，近看才见花） */
    x.strokeStyle = 'rgba(0,0,0,0.045)'; x.lineWidth = 1.5;
    for (const gy of [0, 128]) for (const gx of [0, 128]){
      for (const r of [22, 40]){
        for (let k = 0; k < 4; k++){
          const a = k * Math.PI / 2 + (r === 22 ? 0 : Math.PI / 4);
          x.beginPath();
          x.ellipse(gx + Math.cos(a) * r * 0.62, gy + Math.sin(a) * r * 0.62, r * 0.42, r * 0.20, a, 0, Math.PI * 2);
          x.stroke();
        }
      }
      x.beginPath(); x.arc(gx, gy, 6, 0, Math.PI * 2); x.stroke();
    }
  } else if (kind === 'trim'){
    /* 平纹细格（衣缘的"织边"感） */
    x.strokeStyle = 'rgba(0,0,0,0.05)'; x.lineWidth = 1;
    for (let i = 0; i <= S; i += 4){
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke();
    }
  } else {
    /* 织锦菱纹（腰带）：双向斜线成菱格 + 隔点小点 */
    x.strokeStyle = 'rgba(0,0,0,0.08)'; x.lineWidth = 1.6;
    for (let i = -S; i < S * 2; i += 16){
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke();
      x.beginPath(); x.moveTo(i + S, 0); x.lineTo(i, S); x.stroke();
    }
    x.fillStyle = 'rgba(0,0,0,0.10)';
    for (let iy = 0; iy <= S; iy += 16) for (let ix = 0; ix <= S; ix += 16){
      if (((ix + iy) / 16) % 2 === 0){ x.beginPath(); x.arc(ix, iy, 2, 0, Math.PI * 2); x.fill(); }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  figTexCache.set(key, t);
  return t;
}
/* 躯干截面不是正圆（2026-09-18 第六轮 · 老黄选 B）。
   病根：袍身是 LatheGeometry（回转体），肩宽 = 2×0.186 = 0.37m，而头宽 0.172m
   → **肩只有 2.15 个头宽**（真人 ≈3），远看就是个保龄球瓶。这是"不像人"的最大来源，
   比配色影响大得多。修法是给**躯干层**一个椭圆缩放（横向 +15%、前后压扁 18%），
   ⚠️ 但**不能压整个 Group** —— 那样头也被压成扁球（头本来就该比肩更接近球）。
   所以 makeScholar/makeChildScholar 都是两层：外层 root（位置/朝向/整体缩放）+ 内层 body（椭圆截面），
   头挂在 root 上、不参与椭圆缩放。 */
const FIG_EW = 1.15, FIG_ED = 0.82;
/* 袍身轮廓半径的线性内插（prof 是 LatheGeometry 的 Vector2 数组）。
   交领衣缘要**贴着弧面**走 —— z 必须由半径算出来，不能猜（猜了不是穿模就是悬空）。 */
function profR(prof, y){
  for (let i = 0; i < prof.length - 1; i++){
    const a = prof[i], b = prof[i + 1];
    if (y >= a.y && y <= b.y) return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
  }
  return prof[prof.length - 1].x;
}
/* ⚠️⚠️ 2026-10-04：人物**落脚高度**必须显式给 —— 原来 makeScholar/makeChildScholar
   一律 `root.position.set(x, 0, z)`，而全园地形不是 y=0（草地上是 −0.14~−0.21），
   水榭台基顶面更是 y=0.62 ⇒ 三个人浮在地面上 0.13~0.20m（看着像"飘"），
   品茗那位直接**陷进台基 0.62m**（1.61m 的人只剩 1.0m 露在外面，读作"半截
   身子插在台基里"）。实测（outputs/_diag/fig-foot.mjs 射线）：read gap +0.186、
   child +0.202/+0.131、tea −0.62（相对台基顶面）。
   ⇒ 默认取 `groundHeight(x, z)`（与地面网格**同一个函数**，不会两处漂）；
     站在建筑台基上的那位显式给 y（水榭台基顶面 0.62，见 makeWaterPavilion：
     台基 box 高 0.9 中心 y=0.10 ⇒ 顶 0.55，加 0.12 厚压边石 ⇒ **0.62**）。
   ⚠️ 光改这里不生效：11-loop 的散步段每帧写 `f.position.y`（起伏/清零），
     必须把 `userData.baseY` 一起带过去（那里的注释写了为什么）。 */
const PAV_FLOOR_Y = 0.62;                  // 水榭台基顶面（= 人物脚底应站的高度）
export const figures = [];
function makeScholar({ x = 0, z = 0, y, yaw = 0, s = 1, pose = 'observe', skin = 'indigo',
                       lady = false, leanX = 0, headDown = 0.24 } = {}){
  const root = new THREE.Group();
  root.position.set(x, y === undefined ? groundHeight(x, z) : y, z);
  root.userData.baseY = root.position.y;     // 11-loop 的散步/站立分支据此恢复脚底高度
  root.rotation.order = 'YXZ';
  /* ⚠️⚠️ 必须 'YXZ'（**先偏航、后俯仰**）—— 与金刚鹦鹉那条同源：
     默认的 'XYZ' 里 rotation.x 是**最后**作用的、绕的是**世界横轴**，
     于是"前俯"会随朝向变成后仰/侧栽（实测：观鱼人 yaw=2.96、leanX=0.30 时，
     头相对脚底在**人体前向**上的投影是 **−0.391m**（后退），而不是 +0.45m）。
     成 'YXZ' 后俯仰绕人体自己的横轴，前俯才真的往前。
     ⚠️ 这条不改会影响所有角色的既有效果：rotation.x 为 0 的角色（绝大多数）
       两种序等价；只有散步者（rotation.x=0.05 + z 摆）与观鱼/仕女会变，都是变对。 */
  root.rotation.y = yaw;
  root.rotation.z = 0.03;                     // 重心微偏：负手的站姿不该是旗杆
  /* 前俯（观鱼人弯腰看水、仕女俯身汲水）：⚠️ **必须同时写进 userData** ——
     11-loop 的"非散步"分支每帧把 rotation.x 清零，只静态设在这里会被当场抹掉。
     那边已改成读 `f.userData.leanX`（同一个坑：改一处被另一处每帧覆盖）。 */
  root.rotation.x = leanX;
  root.userData.leanX = leanX;
  root.scale.setScalar(s);
  const g = new THREE.Group();                // 躯干层：只它吃椭圆截面缩放（头不跟着压扁）
  /* 仕女：整体收窄 10% —— 肩宽 2×0.186=0.37m 配 0.172m 的头是"肩 2.15 个头宽"的文人比例，
     女子要更窄才读得出；连下摆一起收，裙形更收束（本项目人物只有裙摆没有腿，
     轮廓就是全部信息）。 */
  g.scale.set(FIG_EW * (lady ? 0.90 : 1), 1, FIG_ED * (lady ? 0.90 : 1));
  root.add(g);
  const P = FIG_PALETTE[skin] || FIG_PALETTE.indigo;
  const ink      = figMat(P.robe, 0.92);      // 袍身主色（原为墨蓝近黑单色 0x1A2233）
  const inkLight = figMat(P.trim, 0.85);      // 领边 / 袖口环 / 后中缝
  const hair     = figMat(FIG_HAIR, 0.90);    // 头与发髻：比袍身更暗，剪影才立得住
  const sashMat  = figMat(P.sash, 0.88);      // 腰带
  /* 半写实（2026-10-06）：织纹挂接（白底乘色，color 不动 ⇒ 配色门禁零影响）；
     头球另用脸贴图材质（下方 headG 处），发发髻/簪仍用原材质（发色/玉色与贴图发区同值）。 */
  ink.map = figClothTexture('robe');       ink.needsUpdate = true;
  inkLight.map = figClothTexture('trim');  inkLight.needsUpdate = true;
  sashMat.map = figClothTexture('sash');   sashMat.needsUpdate = true;
  // 袍身：肩加宽、腰收窄（7.5 头身）；直裰 A 形剪影
  const prof = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.195, 0.01),
    new THREE.Vector2(0.225, 0.16),
    new THREE.Vector2(0.160, 0.55),
    new THREE.Vector2(0.150, 0.82),    // 腰（收窄 → 拉头身比）
    new THREE.Vector2(0.172, 1.04),
    new THREE.Vector2(0.186, 1.19),    // 肩（加宽 20%）
    new THREE.Vector2(0.062, 1.28),    // 颈
    new THREE.Vector2(0.001, 1.31),
  ];
  const robe = mesh(new THREE.LatheGeometry(prof, 18), ink, { name:'scholarRobe' });
  g.add(robe);
  /* 腰带（2026-09-18）：参考图里人人束腰 —— 一道对比色横带把袍身切成上下两段，
     是小尺寸下最省成本的"衣服感"信号（没有它，彩色袍身仍读成一块色团）。
     半径按 y=0.845 处的袍半径（≈0.1525）外放约 1cm；结放在正前，给正面机位一个信息点。 */
  const sashBand = mesh(new THREE.CylinderGeometry(0.163, 0.167, 0.062, 16, 1, true), sashMat, { name:'scholarSash' });
  sashBand.position.y = 0.845;
  g.add(sashBand);
  const sashKnot = mesh(new THREE.SphereGeometry(0.036, 8, 7), sashMat, { name:'scholarSashKnot' });
  sashKnot.position.set(0, 0.845, 0.148);
  sashKnot.scale.set(1.1, 0.8, 0.65);
  g.add(sashKnot);
  /* 下摆衣缘（第六轮）：加它是因为自视样张发现整体是**花瓶轮廓** —— 回转体 + 下摆外扩
     （y=0.16 处 0.225 > 肩 0.186）没有终止线，读作一只瓷瓶。一道浅色横缘把下摆"切断"，
     和腰带同款思路（最省成本的"衣服感"信号）。半径按 profR 在 y=0.02/0.07 处各取 +9mm。 */
  const hem = mesh(new THREE.CylinderGeometry(0.216, 0.206, 0.05, 18, 1, true), inkLight, { name:'scholarHem' });
  hem.position.y = 0.045;
  g.add(hem);
  // 立领（第三轮加高 + 浅色上缘 —— "无脖"读成"高领"）
  /* ⚠️⚠️ 2026-10-16 收窄筒身（老黄："马夫这个头和颈，太搞笑了"）——
     原先立领是 (0.066, 0.072)、再乘躯干层的椭圆缩放 (FIG_EW 1.15, FIG_ED 0.82)，
     正面半宽 0.066×1.15 = **7.6cm**，而里面的脖子只有 0.040~0.047 ⇒ 四周留着
     **2~4cm 的空腔**：半球头 + 细脖 + 一圈宽领口 = 截图里那根从灯罩里伸出来的杆子。
     收成 (0.0560, 0.0595) / 上缘 0.0565 ⇒ 正面半宽 6.4cm，与 0.047 的脖子只差 1.7cm，
     是"领口贴着脖子"而不是"脖子插在筒里"。
     ⚠️ 连带三处必须同步，否则领口的浅色缘会**悬空/穿模**（缘本来就只比领大 0.5mm）：
        · collarEdge 外径 0.0665 → 0.0565；
        · 后领中缝 seamCurve 的起点 z 从 −0.075 收到 −0.064（原来在领内壁上）；
        · 交领 lapel 的起点 x 从 0.050 收到 0.044（原本戳在领筒外壁上）。
     ⚠️ 不动脖子本身：0.040→0.047 已经是"成人脖子"的比例，怪的是领口不是脖子
        （加粗脖子会把脖子做成一根柱子，那是另一个方向的错）。 */
  const collar = mesh(new THREE.CylinderGeometry(0.0560, 0.0595, 0.075, 10), ink, { name:'scholarCollar' });
  collar.position.y = 1.25;
  g.add(collar);
  const collarEdge = mesh(new THREE.CylinderGeometry(0.0565, 0.0565, 0.012, 10), inkLight, { name:'scholarCollarEdge' });
  collarEdge.position.y = 1.282;
  g.add(collarEdge);
  // 后领中缝（第四轮：box 埋进了袍内 —— 改为**贴背曲线管**，沿袍背 S 轮廓全段外凸 1cm）
  const seamCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.26, -0.064),   // 颈后（领壁内侧，不穿出领口）
    new THREE.Vector3(0, 1.19, -0.196),   // 肩背（袍背 -0.186，外凸 1cm）
    new THREE.Vector3(0, 1.04, -0.182),
    new THREE.Vector3(0, 0.82, -0.160),  // 腰背
    new THREE.Vector3(0, 0.55, -0.170),
    new THREE.Vector3(0, 0.30, -0.205),
    new THREE.Vector3(0, 0.14, -0.235),   // 下摆
  ]);
  const seam = mesh(new THREE.TubeGeometry(seamCurve, 14, 0.011, 5), inkLight, { name:'scholarSeam' });
  g.add(seam);
  /* 交领（第六轮 · 老黄选 B）：两条衣缘自颈侧斜下、在胸前**交叉**（"交"的由来）。
     参考图里人人有交领，那是"一眼汉服"的构件；没有它，正面看就是一件圆筒色块。
     z 由 profR 按袍身轮廓实时算出 + 外凸 1.2cm —— 贴弧面，既不穿模也不悬空。 */
  for (const side of [-1, 1]){
    const pts = [[0.044, 1.235], [0.030, 1.10], [0.005, 0.95], [-0.028, 0.875]];
    const lapel = new THREE.CatmullRomCurve3(pts.map(([ax, y]) => {
      const x = side * ax, r = profR(prof, y) + 0.012;
      return new THREE.Vector3(x, y, Math.sqrt(Math.max(r * r - x * x, 0.0004)));
    }));
    g.add(mesh(new THREE.TubeGeometry(lapel, 12, 0.016, 5, false), inkLight, { name:'scholarLapel' }));
  }
  /* 双袖：**姿态决定手在哪里**（第六轮修）。
     ⚠️ 原来无论什么姿态都画"负手"（袖管拢到身后），于是「执卷读书」时**书卷悬在胸前没人拿**、
     正面看两条袖子还横向支出去像一对翅膀 —— 姿态与道具各画各的，这种不一致不报错、只能看图发现。
     点列都按 +x 侧给，-x 侧靠 `side` 镜像。
       back 负手（默认）：肩头→肘后外顶→前臂内收 35°→拢手，另挂垂布到膝
       read 捧卷：肘外张、前臂收到胸前书卷两端（卷在 y=1.04 / z=0.15 / x=±0.23）
       take 持盏：右手前举到茶盏（盏在 x=0.15 / y=0.96 / z=0.12），只用于茶姿的右侧 */
  const SLEEVE = {
    back:  { pts: [[0.180, 1.15, 0.030], [0.275, 0.99, -0.105], [0.098, 0.81, -0.215], [0.052, 0.72, -0.228]],
             drape: true },
    read:  { pts: [[0.180, 1.150, 0.030], [0.215, 0.950, 0.045], [0.195, 0.990, 0.130], [0.175, 1.020, 0.200]],
             drape: false },
    take:  { pts: [[0.180, 1.15, 0.030], [0.240, 1.035, 0.030], [0.198, 0.975, 0.100], [0.150, 0.960, 0.128]],
             drape: false },
    /* point 抬臂指天（2026-10-05 · 看烟花的那位大人）：只换点列 —— 袖管/肘球/袖口环/拢手球
       全是同一套构件，"姿态决定手在哪里"这条纪律不破。肩→手 = (−0.06, 0.59, 0.15) 长 0.61，
       与直裰的臂长一致；手落在 y=1.74 / 头心 1.445 + 头半径 0.086 ⇒ **高过头顶 21cm**，
       "指天"在剪影上读得出来。⚠️ drape 必须 false：垂布是"负手"那条胳膊的配件。 */
    point: { pts: [[0.180, 1.150, 0.030], [0.262, 1.330, 0.060], [0.200, 1.560, 0.120], [0.120, 1.740, 0.180]],
             drape: false, cuffAxis: true },
    /* draw 双手前下（2026-10-05 · 仕女俯身汲水）：两臂**对称**向前下方伸，手落在
       y≈0.84 / z≈0.25 —— 与井圈（外径 0.72、台面高 0.42）在视线上正好是"扶着井绳"的位置。
       与 point 一样只换点列，袖管/肘球/袖口环/拢手球共用同一套构件。 */
    /* draw 双手前下（2026-10-05 · 仕女俯身汲水）：两臂**对称**向前下方伸。
       ⚠️ 关键是**手相对肩的方向**，不是手的绝对位置：第一版给 (0.84, 0.245) 相对肩 (1.15,0.03)
       只是"前 0.22 / 下 0.31" ⇒ 离垂直只有 35°，出图判读三次都是"手垂在身侧、略前"。
       现在改成前 0.43 / 下 0.18（离垂直 ~68°）—— 这才是"伸手够井"的形态。
       手落在 y≈0.975 / z≈0.455，与井圈（外径 0.72、台面高 0.42）在视线上正好扶着井绳。 */
    draw:  { pts: [[0.180, 1.150, 0.030], [0.235, 1.090, 0.180], [0.210, 1.020, 0.330], [0.180, 0.975, 0.455]],
             drape: false, cuffAxis: true },
    /* down 单手前伸下指（2026-10-05 · 观鱼人）：**只用右侧那条胳膊**（左侧仍是负手）——
       与 point 同一套写法。⚠️ 同上：手相对肩要"前 0.49 / 下 0.19"（离垂直 ~69°），
       第一版"前 0.21 / 下 0.36"（30°）读出来是"手垂在身侧"。 */
    down:  { pts: [[0.180, 1.150, 0.030], [0.230, 1.075, 0.175], [0.205, 1.010, 0.360], [0.175, 0.965, 0.520]],
             drape: false, cuffAxis: true },
  };
  for (const side of [-1, 1]){
    const A = SLEEVE[pose === 'read' ? 'read'
                   : pose === 'draw' ? 'draw'
                   : (pose === 'pointDown' && side > 0) ? 'down'
                   : (pose === 'point' && side > 0) ? 'point'
                   : (pose === 'tea' && side > 0) ? 'take' : 'back'];
    const V = ([ax, ay, az]) => new THREE.Vector3(side * ax, ay, az);
    const sl = new THREE.CatmullRomCurve3(A.pts.map(V));
    g.add(mesh(new THREE.TubeGeometry(sl, 9, 0.065, 6, false), ink, { name:'scholarSleeve' }));
    // 肘尖（第五轮根因：肘球 0.062 < 袖管 0.065，完全埋在袖里 —— 沿点列第 2 点外移突破袖缘）
    const elbow = mesh(new THREE.SphereGeometry(0.055, 8, 7), ink, { name:'scholarElbow' });
    elbow.position.set(side * A.pts[1][0] * 1.16, A.pts[1][1], A.pts[1][2]);
    g.add(elbow);
    if (A.drape){
      // 垂布：自肘下向膝上垂落，起点离袖身留 2~3cm 缝隙（背光下才读得出层次）
      const dr = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.150, 0.90, -0.16),
        new THREE.Vector3(side * 0.145, 0.70, -0.155),
        new THREE.Vector3(side * 0.132, 0.50, -0.135),
      ]);
      g.add(mesh(new THREE.TubeGeometry(dr, 7, 0.048, 5, false), ink, { name:'scholarDrape' }));
    }
    // 袖口聚团 + 浅色袖口环（贴在袖管末端的实际位置，不再假设手在身后）
    const [hx, hy, hz] = A.pts[3];
    const clump = mesh(new THREE.SphereGeometry(0.058, 8, 7), ink, { name:'scholarClump' });
    clump.position.set(side * hx, hy, hz);
    clump.scale.set(1.25, 0.9, 0.85);
    g.add(clump);
    /* 手（肤色，2026-10-06 半写实）：自袖口聚团沿末段方向探出 ~5cm ——
       "袖 → 腕 → 指尖"三段读得出来。挂 g（与袖管同一坐标系，一起吃椭圆缩放，
       否则手会从袖口脱节）。⚠️ 不改 scholarClump 的名字/位置 —— attachWoodBucket
       按它找仕女的右手挂桶，探针也按它实测手位。 */
    const hDir = new THREE.Vector3(side * (hx - A.pts[2][0]), hy - A.pts[2][1], hz - A.pts[2][2]).normalize();
    const hand = mesh(new THREE.SphereGeometry(0.040, 8, 7), figSkinMat, { name:'scholarHand' });
    hand.position.set(side * hx, hy, hz).addScaledVector(hDir, 0.055);
    hand.scale.set(1.05, 0.72, 1.05);
    g.add(hand);
    const cuff = mesh(new THREE.TorusGeometry(0.040, 0.007, 5, 10), inkLight, { name:'scholarCuff' });
    cuff.position.set(side * hx, hy - 0.028, hz - 0.006);
    /* 袖口环的朝向：老姿态（负手/捧卷/持盏）用的是"绕 Y 转 90°"的固定写法（法线 = 局部 +x），
       那对**向前伸**的胳膊够用；但抬臂指天那条胳膊是**向上**伸的，同一个环就变成斜切手臂。
       所以带 cuffAxis 的姿态改由**前臂轴向**定姿（与坐姿 makeSeatedScholar 同一手法），
       老姿态逐字不动 —— 不去碰别的角色的既有观感。 */
    if (A.cuffAxis){
      const [qx, qy, qz] = A.pts[2];
      cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(side * (hx - qx), hy - qy, hz - qz).normalize());
    } else {
      cuff.rotation.y = Math.PI / 2;
      cuff.rotation.x = A.drape ? 0.4 : 1.2;
    }
    g.add(cuff);
  }
  /* 披帛（仕女的标志物，2026-10-05）：一条窄帛绕过双肩、向腰侧垂落 —— 只在轮廓上添两道斜线，
     却是"这是位女子"最省成本的信号（文人直裰没有这一件）。用浅色 trim 做，压在袍色上读得出来。
     ⚠️ 曲线点必须**落在袍身椭球之外**：第一版点列按"贴着袍面"给，实测 (0.150,1.165,0.060)
     满足 (0.150/0.186)²+(0.060/0.133)²=0.85 < 1 ⇒ **整条埋在袍子里**，出图判读"没有披帛"。
     现在把 x/z 各外放 12%（贴着表面），管径 0.026→0.030。 */
  if (lady){
    /* ⚠️ 披帛要用**与交领/衣缘不同的色**：第一版也用 inkLight（与交领同为奶白），
       出图判读成"衣服的一部分"、认不出是一条帛带。改成一抹更亮的丝白 0xF2EDE4，
       压在丁香袍上就是一道清楚的斜带。 */
    const stoleMat = figMat(0xF2EDE4, 0.72);
    const stole = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.213, 1.185, 0.056),
      new THREE.Vector3(-0.062, 1.238, 0.110),
      new THREE.Vector3( 0.168, 1.165, 0.067),
      new THREE.Vector3( 0.244, 0.940, -0.022),
      new THREE.Vector3( 0.199, 0.760, -0.103),
    ]);
    g.add(mesh(new THREE.TubeGeometry(stole, 16, 0.030, 5, false), stoleMat, { name:'ladyStole' }));
  }
  // 头 + 发髻 + 簪（低头回调 14°：20° 在俯拍机位读作"俯身"；观鱼/汲水要更低，由 headDown 给）
  const headG = new THREE.Group();
  headG.position.set(0, 1.445, 0.03);
  headG.rotation.x = headDown;
  /* 头球用脸贴图（2026-10-06 半写实）：一颗球 = 发型 + 脸（贴图里发区与 FIG_HAIR 同值，
     与下面的发髻/盘髻无缝衔接）。分段 14×11 → 16×13：脸窗 ±46° 需要 ~16 经段才不糊。 */
  headG.add(mesh(new THREE.SphereGeometry(0.086, 16, 13), figFaceMatA, { name:'scholarHead' }));
  /* 下颌（2026-10-16 B方案：老黄"脖子和脑袋明显不匹配，只能远看"）。
     病根：头是正球 + 颈是直杆，中间没有任何下巴过渡 ⇒ 棒棒糖。
     修法：颅顶保持 0.086（脸贴图 UV 按这个半径画的，不能动），下颌加一颗
     素肤色小椭球（前伸 2cm、托住下巴），与颈顶交叠 —— 球和杆之间有了"下巴"，
     侧面剪影从"球插杆"变成"颅+颌+颈"三段。素肤色不用脸贴图（小球上贴整张脸会糊）。 */
  const jaw = mesh(new THREE.SphereGeometry(0.062, 12, 10), figSkinMat, { name:'scholarJaw' });
  jaw.scale.set(0.88, 0.78, 0.92);
  jaw.position.set(0, -0.042, 0.024);
  headG.add(jaw);
  const knot = mesh(new THREE.SphereGeometry(0.030, 8, 7), hair, { name:'scholarKnot' });
  knot.position.set(0, 0.098, -0.020);
  knot.scale.set(1, 0.95, 1);
  headG.add(knot);
  /* 仕女的发髻（2026-10-05）：在小圆髻之上再加一圈**盘髻**（水平环）—— 头是俯拍机位里
     最容易被读到的部位，一圈盘髻在剪影上就与文人的单髻分开了（成本 1 个 torus）。 */
  if (lady){
    /* ⚠️ 发髻要**明显高出头球轮廓**、且形状是**圆头**的。
       三次实测的教训：① 环半径 0.034+管径 0.012 ⇒ 外缘 0.046 整个埋在头球（半径 0.086）里；
       ② 把小圆髻放大到 0.040，量 AABB 只比头顶高 1.5cm ⇒ 读作"一个黑球"；
       ③ 换成**圆柱**高髻 ⇒ 被读作"头顶一个小礼帽"（平顶）——形状不对。
       最终取"球体纵向拉长 1.5 倍"（半径 0.046、y=0.136 ⇒ 跨 0.067~0.205，高出头顶约 0.12m），
       再加底下那圈盘环 —— 圆头的髻 + 一圈盘，才是发髻。 */
    knot.geometry.dispose();
    knot.geometry = new THREE.SphereGeometry(0.046, 12, 9);
    knot.position.set(0, 0.136, -0.022);
    knot.scale.set(1, 1.5, 1);
    const coil = mesh(new THREE.TorusGeometry(0.046, 0.013, 5, 12), hair, { name:'ladyCoil' });
    coil.position.set(0, 0.088, -0.023);
    coil.rotation.x = Math.PI / 2;
    headG.add(coil);
  }
  /* 簪（第五轮根因：4mm 簪径在 1.5m 视距只有 2px，被抗锯齿吃掉 —— 不是变换问题）。
     加粗到 16mm（风格化簪）+ 两端簪头珠（0.02m，4~5px 可读），"常见机位一头可见"达标
     ⚠️ 2026-10-16 B方案二（老黄"发簪也是悬空的球"）：旧簪长 0.132、两端珠距头心
     0.10~0.13m —— 头球半径才 0.086，珠子整个浮在空气里。截短到 0.10、珠距 0.05，
     簪心沉到发髻中心，珠子贴着头发，远看杆被吃掉也只剩"贴发的两点"，不再是"飘着的两球"。 */
  const pinMat = new THREE.MeshStandardMaterial({ color:0xC9CDB8, roughness:0.6, metalness:0.0, envMapIntensity:0.5 });
  const pin = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.100, 6), pinMat, { name:'scholarPin' });
  pin.rotation.order = 'ZYX';
  pin.rotation.set(0, 0.55, Math.PI / 2 + 0.14);   // 近水平（俯仰 8°），斜偏 30°
  pin.position.set(0, 0.088, -0.020);
  headG.add(pin);
  const pinAxis = new THREE.Vector3(-0.824, -0.122, 0.505);
  for (const e of [-1, 1]){
    const bead = mesh(new THREE.SphereGeometry(0.013, 7, 6), pinMat, { name:'scholarPinBead' });
    bead.position.set(pinAxis.x * 0.050 * e, 0.088 + pinAxis.y * 0.050 * e, -0.020 + pinAxis.z * 0.050 * e);
    headG.add(bead);
  }
  root.add(headG);            // ⚠️ 头挂 root（不挂 g）：不能跟着躯干的椭圆缩放一起被压扁
  /* 颈（肤色，2026-10-06 半写实）：填"立领顶(1.2875) → 头底(1.359)"之间那段透缝
     —— 原来袍口收在 1.31、头球下缘 1.359，中间是一条看得见的黑缝。
     圆柱 y 1.245~1.405：下端没入立领、上端没入头球，只露中段 ~7cm 的脖子。
     挂 root（不挂 g）：不被椭圆缩放压扁，与头球同一套截面语义。
     ⚠️⚠️ 2026-10-16 下端由 0.047 外扩到 **0.062**（老黄："马夫这个头和颈，太搞笑了"）。
     原来的圆柱是**等径细杆**（0.040→0.047，几乎不收分），从领口直挺挺伸到下巴 ⇒
     出图判读就是"一根棒棒糖"：球 + 杆 + 一条硬边。真人脖子是**上细下粗**、
     向斜方肌散开的，所以下端要给足外扩量（0.062 ≈ 领口内径 0.056 × 1.1），
     让它**在领口里就化开**、露出来的那一小段带上"往上收"的走势，而不是一根柱子。 */
  const neck = mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.16, 10), figSkinMat, { name:'scholarNeck' });
  neck.position.y = 1.325;
  root.add(neck);
  // 呼吸相位 + 不参与合并（要每帧微动）
  /* ⚠️ 这三行必须挂 **root**（figures 里存的就是 root）：挂 g 的话
     ① 渲染循环读 `f.userData.robe.scale` 会 undefined 崩、
     ② `root.traverse` 改成 `g.traverse` 会漏掉挂在 root 上的头 →
        头/发髻/簪不是 noMerge，会被 mergeStatics 并进静态大网，人一动头就留在原地。 */
  root.userData.breathPhase = jr() * TAU;
  root.userData.robe = robe;
  /* 日程道具（第十四轮：人物随时间/天气切换举止 —— 用户要求）
     pose: 'read' 执卷读书 / 'tea' 端盏品茗 / 默认负手
     道具尺寸按 3~4m 视距定：盏/卷径 4~5cm 在实物比例下偏小，为可读性放大到
     最大边 ~18cm 且用 inkLight 浅玉色 + 微自发光，白天/傍晚都压得住背景 */
  if (pose === 'read'){
    /* 执卷读书：一卷浅色书卷横于胸前（长 0.46、径 0.05，算上把手在 3m 外约 8px）。
       ⚠️ z 必须 ≥ 0.20：袍身 y=1.04 处的前表面在 z=0.172（交领又外凸到 0.187），
       原来写 0.15 → 卷轴埋在胸口里，只露出半根"横杠"。手的位置（SLEEVE.read）与这里绑死，改一处必须同步。 */
    const vol = mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.46, 8), inkLight, { name:'scholarScroll', cast:false });
    vol.rotation.z = Math.PI / 2;
    vol.position.set(0, 1.035, 0.205);
    g.add(vol);
    const knobL = mesh(new THREE.SphereGeometry(0.022, 6, 5), inkLight, { name:'scholarScrollKnob' });
    knobL.position.set(-0.25, 1.035, 0.205);
    g.add(knobL);
    const knobR = mesh(new THREE.SphereGeometry(0.022, 6, 5), inkLight, { name:'scholarScrollKnob' });
    knobR.position.set(0.25, 1.035, 0.205);
    g.add(knobR);
    headG.rotation.x = 0.42;                        // 低头读书
  } else if (pose === 'tea'){
    /* 端盏品茗：浅色茶盏（径 0.07）前举至胸前，面对池面（yaw 由调用方给定）。
       ⚠️ z 同样必须外移：原来盏在 0.12、拢手球前缘在 0.177 —— 盏**在手的后面**，
       门禁从正前方打射线首个命中是手，读作"端着空气"。盏要露在手前（SLEEVE.take 与这里绑死）。 */
    const cup = mesh(new THREE.CylinderGeometry(0.035, 0.027, 0.042, 8), inkLight, { name:'scholarCup', cast:false });
    cup.position.set(0.15, 0.960, 0.185);
    cup.rotation.z = 0.18;
    g.add(cup);
    const saucer = mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.016, 8), inkLight, { name:'scholarSaucer', cast:false });
    saucer.position.set(0.15, 0.925, 0.185);
    g.add(saucer);
    const steam = mesh(new THREE.SphereGeometry(0.018, 5, 4), inkLight, { name:'scholarSteam', cast:false });
    steam.position.set(0.15, 1.030, 0.185);
    steam.scale.set(1, 1.6, 1);
    g.add(steam);
    headG.rotation.x = 0.18;                        // 微俯视盏
    root.rotation.z = 0.02;   // ⚠️ 挂 root：躯干层 g 上还有椭圆缩放，写在 g 上会变成"两层各歪一点"
  }
  root.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });
  figures.push(root);
  return root;
}
/* 马夫"喂马"动作的**肩枢轴句柄**（2026-10-11）。⚠️ 必须在 D_SCHEDULES 建场循环之前用 `let`
   声明 —— 循环里 makeGroomArm() 会往里写；放晚一行就是 TDZ 启动即炸（同 WALKERS 那条注释）。 */
let GROOM_ARM = null;
let _gfT = 0;
/* buildFigures 由 08-assemble 在原 926 行位置调用（布景之后、koi 之前）：
   D 循环 + 书童循环的求值期 jr 消耗顺序与搬家前逐字一致。 */
export function buildFigures(){
/* 人物日程（第十四轮：用户要求"人物造型和动作跟随时间和天气变化"）——
   · 上午 7:30~12:00  执卷读书（北岸近水，读到兴起背手抬眼观景）
   · 下午 12:00~18:00 端盏品茗、面池赏鱼（水榭临水平台）
   · 晚上 18:00~23:00 沿游廊散步（userData.stroll 让他在 animate 里来回缓行）
   · 天气门禁：刮风下雨下雪（storm/snow/winterrain）不出现 —— 雨天文人躲屋里，合理
   摆位守"留白"律：人物衬水面/游廊梁柱（亮背景），不贴深色石。 */
const D_SCHEDULES = [
  { pose:'read',  skin:'indigo',  x: 1.2, z: -5.7, yaw: 0.42, s: 1.0,   // 先生晨课于远香堂前草坪（前墙 z≈-8.8 以南）
    // 第六轮：原 yaw=0 是正面朝池的平板站姿（正对镜头 → 只读到一个色块）；
    // 改为侧身 24°，做"半围"阵型的中心，同时让衣缘/袖形在侧光下读得出来。
    // 坐标与两书童的朝向表达式绑死（童子的 atan2 参数就是按这个点算的），挪位必须同步改。
    h0: 7.5, h1: 12.0,
    stroll: null },
  { pose:'tea',   skin:'moss',    x: 15.3, z: 5.4, y: PAV_FLOOR_Y, yaw: Math.atan2(-15.3, -2.4), s: 1.02,   // 面朝池心赏鱼（水榭平台，非草坪 → 可用绿色系）
    h0: 12.0, h1: 18.0,                                                          // ⚠️ 站在**水榭台基**上 ⇒ 脚底抬到台基顶面
    stroll: null },
  /* ⚠️ 夜步路线的 z 区间原来写 [1.3, −3.8]，而游廊这条腿只到 z=−1.8（折线顶点
     (13.2,−9.6)→(13.2,−1.8)→(24,−1.8)）⇒ 他有 **2.5m 是在池面上走的**。
     实测（outputs/_diag/walk-lane.mjs / fig-foot.mjs / fig-path.mjs）：x=13.4 上
     z∈[−1.2, 1.3] 向下打射线首个命中就是 waterSurface(0.06)，起点 (13.4,1.0) 正好
     压在池子东缘；而近端 z>−3.0 与远端都另有构件（z≈−2.4 处有 1.17m 高的栏/凳）。
     ⇒ 收进廊道取 z∈[−8.8, −3.0]（实测该段 |脚底−铺装| ≤ 0.08）。
     ⚠️ y 显式给 0、不吃默认的 groundHeight：他走的是**廊道铺装**，铺装是平的，
       与地形公式不是一回事（实测该段铺装面 −0.081~+0.069，取 0 比跟地形更准）。 */
  { pose:'observe', skin:'lily',  x: 13.4, z: -4.6, y: 0, yaw: Math.PI * 0.5, s: 1.0,
    h0: 18.0, h1: 23.0,
    stroll: { a: 13.4, b: 13.4, z0: -3.0, z1: -8.8, sp: 0.027 } },   // 沿游廊 z 缓行（0.55 m/s）
  /* ── 巡游观鱼者（2026-10-06 · 老黄反馈 B）────────────────────────────────────
     老黄："**巡游**观鱼的主人身体倾斜也很厉害 ⇒ 收小倾斜，让他沿『草皮 → 池岸 →
     汀步/拱桥 → 回到草皮』走一条闭合路径"。
     ⚠️ 第一版（2026-10-05）是**站着**看鱼的（前俯 0.30rad + 右手前下指水）；现在他要"巡游"
        ⇒ ① 姿态回到 `observe`（负手缓行 —— 走路的人不会一直伸着一只手）；
           ② 前俯 0.30 → **0.05**（2.9°，只是"走路时躯干不竖直"那点量）、低头 0.58 → **0.20**；
           ③ 位置不再写死，改成 **WALK_PATH 的起点**（每个点都是射线实测的地面/桥面高），
              之后由 driveWalkers 沿闭合路径以 0.72 m/s 推进。
     ⚠️ `stroll` **保持 null**（不是漏写）：11-loop 的散步分支一旦接管，它会每帧写
        position.x/z、rotation.y —— 与 driveWalkers 两处互相覆盖；而且 figure-foot-guard
        是拿 `slot.stroll` 的 **z0~z1 直线区间**去扫点的，走矩形区间在他这条闭合路径上
        等于扫到水里/桥栏上（那条判据会报一堆假红）。位置由 driveWalkers 一处负责。
        rotation.x / rotation.z 则仍由 11-loop 写（leanX 0.05 / 0.03），起伏与侧摆走 pivot 层
        —— 两处互不重叠，见下面 WALKERS 一段。 */
  { pose:'observe', skin:'moonwhite',
    x: WALK_PATH.pts[0].x, z: WALK_PATH.pts[0].z, y: WALK_PATH.pts[0].y,
    /* 首帧朝向 = 第一段路的前进方向（`atan2(dx,dz)`，模型正面 = +z）——
       不写 0：写 0 的话第一帧会"面朝 +z"再慢慢转过去（探针/devtools 里能拍到半转身）。 */
    yaw: Math.atan2(WALK_PATH.pts[1].x - WALK_PATH.pts[0].x,
                    WALK_PATH.pts[1].z - WALK_PATH.pts[0].z),
    s: 1.0, leanX: 0.05, headDown: 0.20, walk: true,
    h0: 7.5, h1: 12.0, stroll: null },
  /* 仕女（2026-10-05 落点 / 2026-10-06 老黄 B 改倾角）：**井边汲水**。
     ⚠️ 落点**读 PROP_SPOTS.ladyWell**（14-props 的表）而不是在这里重写一份坐标：
     那张表同时被 14-props 的 buildProps 用来算辘轳摇柄朝哪一端（"井 / 架子 / 人"三者的
     相对关系只有一处真值）；两处各写一份坐标，坏起来就是"架子对着空地摇"这种只有看图
     才发现的不一致（该表里的注释已经把这条写成了约定）。
     朝向井心；俯身 + 双手前下（SLEEVE.draw）。
     ⚠️ 前俯 0.34 → **0.17**（≈9.7°，落在老黄要的 8~12° 区间）：0.34rad 是"整条上身扑向井口"
       的读数，出图判读成"要投井"，收小一半后才是"俯身汲水"。低头 0.55 → 0.42 与之配套
       （头还得看着井绳，所以收得比躯干少 —— 差 0.25rad ≈ 14°，读作"弓着背、眼睛还在水面"）。 */
  { pose:'draw', skin:'lilac', x: PROP_SPOTS.ladyWell.x, z: PROP_SPOTS.ladyWell.z, y: PROP_SPOTS.ladyWell.y,
    yaw: Math.atan2(PROP_SPOTS.well.x - PROP_SPOTS.ladyWell.x, PROP_SPOTS.well.z - PROP_SPOTS.ladyWell.z),
    s: 0.97, lady: true, leanX: 0.17, headDown: 0.42,
    h0: 7.5, h1: 12.0, stroll: null },
  /* 马夫（2026-10-09 · 老黄："再设计一个马夫在帮忙给马喂草料或者帮马匹梳理毛皮"）。
     · 站位：马厩台基上（y = 台基面 **0.14**）—— ⚠️ 这里**不能省 y 让 makeScholar 用
       groundHeight**：台基面比它下面的地形高 0.5m 以上，人会陷进台基里（井边仕女那条同源教训）。
       落点在院心那匹**低头就食**的马（world ≈ (6.9, 31.8)，头朝西）**西侧 1.4m**、
       面朝 +x（yaw = π/2）⇒ 他的右手正对马嘴，读作"递草喂马"。
     · 姿态 **'pointDown'**（只有右臂用 `down` 袖型：手相对肩"前 0.49 / 下 0.19"⇒ 离垂直 ~69°
       = 手真的伸出去；左臂仍是负手）。⚠️ 第一版用 'take'（手相对肩只前 0.098 ⇒ 落在身侧），
       出图判读是"**背手站着**，不像喂马" —— 这正是项目里"看肩→手的方向、别看手的绝对位置"
       那条老教训（观鱼人/仕女都踩过）。
     · 位置/高度**不在这里定**：马厩在延迟批里建，而这里是模块求值期 ⇒ 先给一个粗坐标，
       由马厩那边的 deferBootFirst 用 `userData.stable.groom` **回填**（见那一段的注释）。 */
  { pose:'pointDown', skin:'russet', x: 40, z: -8, y: 0,
    yaw: Math.PI / 2, s: 0.96, leanX: 0.10, headDown: 0.34,
    h0: 7.5, h1: 18.0, stroll: null, feed: true },
];
D_SCHEDULES.forEach((d, i)=>{
  const fg = makeScholar({ x: d.x, z: d.z, y: d.y, yaw: d.yaw, s: d.s, pose: d.pose, skin: d.skin,
                           lady: d.lady, leanX: d.leanX, headDown: d.headDown });
  fg.userData.slot = { h0: d.h0, h1: d.h1, stroll: d.stroll };
  fg.userData.skin = d.skin;                 // 供 probe/figure-audit.mjs 读角色服色做门禁
  fg.userData.poseName = d.pose;
  world.add(fg);
  if (d.walk) attachWalker(fg);              // 巡游观鱼者：沿 WALK_PATH 走（见下面 driveWalkers）
  if (d.lady) attachWoodBucket(fg);          // 井边仕女：右手提一只木桶（老黄 A4）
  if (d.feed){ fg.userData.isGroom = true; attachFeedBale(fg); makeGroomArm(fg); }   // 马夫：右手一捆草料 + 肩枢轴
});
/* 书童循环（原 1238-1246 行）：与 D 循环同一次 buildFigures 调用内、紧随其后 —— jr 顺序不变。 */
[{ x: 0.62, z: -5.10, yaw: 0.33 * Math.atan2( 0.58, -0.60), s: 0.90, skin:'celadon' },
 { x: 1.80, z: -5.25, yaw: 0.33 * Math.atan2(-0.60, -0.45), s: 0.78, skin:'ochre' }]
  .forEach((c)=>{
    const ch = makeChildScholar(c);
    ch.userData.slot = { h0: D_SCHEDULES[0].h0, h1: D_SCHEDULES[0].h1, stroll: null };
    ch.userData.skin = c.skin;
    ch.userData.poseName = 'child';
    world.add(ch);
  });
}  // buildFigures

/* ══ 巡游观鱼者的行走驱动（2026-10-06 · 老黄反馈 B）· 函数部分 ══════════════════
   ⚠️ 常量与 WALKERS 的**声明**在文件上方紧挨着 WALK_PATH（那边解释了全部数值与理由）：
   D_SCHEDULES 的建场循环会调 attachWalker() 往 WALKERS 里登记，而 `const` 在声明之前是
   TDZ —— 声明放晚一行就是 "Cannot access 'WALKERS' before initialization"，启动即炸。
   函数声明是提升的，所以这几个函数可以留在人物段里（离调用点近，读起来顺）。 */
/* 插一层 pivot（root → pivot → 人体几何）。搬迁用 while 而不是 forEach：
   three 的 add() 会把节点从原父级摘掉，边遍历边改数组会漏节点（wrapWatcher 同款）。 */
function attachWalker(root){
  const pivot = new THREE.Group();
  pivot.name = 'walkerPivot';
  while (root.children.length) pivot.add(root.children[0]);
  root.add(pivot);
  root.userData.walk = {
    s: 0,                                  // 沿闭合路径的弧长（m）
    cur: { i: 0 }, curA: { i: 0 },         // walkPointAt 的游标（避免每帧从 0 线性找）
    step: 0,                               // 步相（rad，按走过的距离推进）
    pivot,
  };
  WALKERS.push(root);
  return root;
}
/* 沿弧长推进（s 是"园中时间"的函数，闭合 ⇒ 走满一圈回到起点，不是原地掉头）。
   ⚠️ 取点必须在 [0, len) 内：walkPointAt 在 s ≥ len 时会拿最后一段**外推**（不是绕回），
   所以先在 driveWalkers 里把 s 绕回来。 */
function walkAt(s, cursor){
  const L = WALK_PATH.len;
  return walkPointAt(s >= L ? s - L : s, cursor);
}
function driveWalkers(dt){
  for (const f of WALKERS){
    const w = f.userData.walk;
    w.s += WALK_SPEED * dt;
    if (w.s >= WALK_PATH.len) w.s -= WALK_PATH.len;
    const p = walkAt(w.s, w.cur);
    /* 朝向 = 前方 0.25m 的差分方向（比取切线省一次"上一段/下一段"的分支，
       而且闭合处不必处理负下标）。模型正面 = +z ⇒ `atan2(dx, dz)`。 */
    const q = walkAt(w.s + 0.25, w.curA);
    const dx = q.x - p.x, dz = q.z - p.z;
    if (Math.hypot(dx, dz) > 1e-4){
      const want = Math.atan2(dx, dz);
      /* 归一到 (−π, π]：不归一的话绕圈经过 ±π 时会"抽一下"（走最短弧要求差值连续） */
      const d = Math.atan2(Math.sin(want - f.rotation.y), Math.cos(want - f.rotation.y));
      f.rotation.y += d * Math.min(1, dt * WALK_TURN);
    }
    f.position.x = p.x; f.position.z = p.z;
    /* baseY = 脚下那个面（建场期逐点**射线实测**的高，见 WALK_PATH 的注释）：
       figures 循环每帧 `f.position.y = f.userData.baseY`，所以只要这里对，人就不会
       悬空/陷地（桥面 1.302、山脊 1.4、草地 −0.2 都在 p.y 里）。 */
    f.userData.baseY = p.y;
    f.position.y = p.y;                 // 立刻写一次：本帧 figures 循环要写同一个值（幂等）
    w.step += WALK_SPEED * dt / WALK_STRIDE * Math.PI;
    w.pivot.position.y = Math.abs(Math.sin(w.step)) * WALK_BOB;     // 迈步起伏
    w.pivot.rotation.z = Math.sin(w.step) * WALK_SWAY;              // 左右轻摆
  }
}

/* ══ 井边仕女手上的木桶（2026-10-06 · 老黄 A4）══════════════════════════════════
   与地上那只（14-props 的 PROP_SPOTS.wellBucket）**同款同尺寸**：makeWoodBucket()。
   ⚠️ 挂点**实测**，不手填：手位由「SLEEVE.draw 的点列 × 躯干层 g 的椭圆截面缩放」两处
   共同决定 —— 手算等于把两处真值抄一遍，改任一处（比如再收一次肩宽）就静默错位。
   所以取右手拢手球的**世界坐标**，再用 `root.worldToLocal` 转回 root 局部坐标；
   桶的原点在**桶底中心、桶口朝 +Y** ⇒ `y = 手.y − BUCKET_HANDLE_H` 时提梁顶正好落在手心里。
   ⚠️ "右手" = 局部 **−x** 侧：模型正面约定为 +z，right = forward × up = (0,0,1)×(0,1,0) = (−1,0,0)。
      两只拢手球同名（`scholarClump`），所以按 x 符号挑 —— 这也是"实测"的一部分。
   ⚠️ 桶挂 **root**（不挂躯干层 g）：g 上有 (1.15×0.90, 1, 0.82×0.90) 的椭圆缩放，
      挂上去桶会被压扁成一个歪的铁丝圈。
   ⚠️ 桶的全部网格必须 `noMerge`：mergeStatics 会把它们并进 MAT.wood/woodDark 的静态大网、
      世界矩阵被烘死 ⇒ **人走了桶留在原地**（竹帘条、看烟花一家都踩过同一类坑）。
      代价：5 个 draw call（桶身/底/两道箍/提梁各一个网格）—— 要能跟着人动就得付。
   ⚠️ 桶的尺度：BUCKET_R 0.095 / BUCKET_H 0.20（可提的实物尺度）。挂完桶底在
      她脚面上方约 0.68m（手 y ≈ 0.975 − 提梁 0.293），是"垂手提桶"的高度，不蹭地。 */
/* 马夫手里的草料捆（2026-10-09 · 马厩）—— 与 attachWoodBucket **同一套挂法**：
   取拢手球的**世界坐标**再转回 root 局部（刚 world.add 完、matrixWorld 由
   getWorldPosition 现刷，不会是上一帧残值）。
   ⚠️⚠️ **挂哪只手要跟着姿态走**（本轮踩到）：`makeScholar` 的袖型是按 `side` 分侧的 ——
      `pointDown` 只让 **side > 0（局部 +x）**那条胳膊前伸，另一条仍是 'back'（负手在身后）。
      `attachWoodBucket` 用的是 `x < 0`，那是为仕女的 'draw'（**两臂都前伸**）写的；马夫直接
      照抄就把草料捆挂到了**背在身后的那只手**上 —— 出图判读原话："草料插在人物背后，
      伸出去的手是空的"，喂马的动作直接散架。这里按 `x > 0` 取前伸的那只手。
   ⚠️ 与木桶同一条硬约束：草料捆的全部网格 `noMerge` —— mergeStatics 会把它们并进
      MAT.straw 的静态大网、世界矩阵烘死 ⇒ 人一动草料就留在原地。 */
/* ── 马夫"递草料"的动作装置（2026-10-11 · 老黄："人喂马"）────────────────────────
   人物是程序化几何：袖管是一根 TubeGeometry、肘/手/拢手球是球 —— 都没有骨头。
   要让"喂马"读得出来，不必做骨骼：只要让**前伸那条胳膊整体绕肩**小幅前后摆
   （≈±6°、周期 ~7s）⇒ 手里那捆草跟着起伏，"递出去—收回来"就成立。
   做法：把 +x 侧那条胳膊的构件收进一个**肩枢轴组**（组放在肩点），每帧只转这一个组。
   ⚠️ 三条：
     ① **只对马夫这么做**（不动 makeScholar 的通用结构 ⇒ 别的角色零影响）；
     ② 袖管是"**顶点在几何里**、mesh.position 是 (0,0,0)" ⇒ 进组前必须先按肩点**平移几何**，
        否则整条袖子会跳走（第一版就会踩这个）；
     ③ 草料捆原来挂在人物 root 上（attachFeedBale 用世界坐标反算的局部位置）⇒ 也得挪进这个组，
        否则"手动草不动"（与 attachWoodBucket 那条"人一动草料留在原地"同源）。 */
export function makeGroomArm(root){
  const SH = new THREE.Vector3(0.180, 1.150, 0.030);      // 肩 = SLEEVE.down 的第 0 点（+x 侧）
  const arm = new THREE.Group();
  arm.position.copy(SH);
  root.add(arm);
  const moved = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.name === 'scholarSleeve'){
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if ((bb.min.x + bb.max.x) / 2 > 0.02){              // +x 侧那条（另一条是负手）
        const g2 = o.geometry.clone();
        g2.translate(-SH.x, -SH.y, -SH.z);                // ⚠️ 顶点在几何里 ⇒ 平移几何
        o.geometry = g2;
        o.position.set(0, 0, 0);
        moved.push(o);
      }
    } else if ((o.name === 'scholarElbow' || o.name === 'scholarClump' || o.name === 'scholarHand')
               && o.position.x > 0.02){
      o.position.sub(SH);
      moved.push(o);
    }
  });
  for (const o of moved) arm.add(o);
  const bale = root.getObjectByName('propFeedBaleHand');
  if (bale){ bale.position.sub(SH); arm.add(bale); }
  root.userData.groomArm = arm;
  GROOM_ARM = arm;
  return arm;
}
/* 每帧推"递草"的摆幅。时钟自己按 dt 累加（帧率无关），角度连续（慢正弦）—— 不用高频正弦直接
   打姿态（2026-10-05 鹦鹉"抽搐"那条教训）。 */
export function tickGroomFeed(dt){
  if (!GROOM_ARM) return;
  _gfT += Math.min(Math.max(dt, 0), 0.1);
  /* ⚠️ 2026-10-11 加大幅度（老黄："马夫看不出来喂马的动作"）：原来 ±6°、周期 7s ——
     马厩机位在 15~25m 外，±6° 让手里那捆草移动不到 0.07m（≈4px），等于看不出在动。
     现在 ±12.6°、周期 ~12.6s（更慢、更"人在递草"而不是机械臂），左右也放大到 ±4.6°。 */
  GROOM_ARM.rotation.x = 0.22 * Math.sin(_gfT * 0.5);           // 前后：递出去 / 收回来
  GROOM_ARM.rotation.z = 0.08 * Math.sin(_gfT * 0.6 + 1.1);     // 一点点左右，别像机械臂
}
export function groomFeedState(){
  return GROOM_ARM ? { ok: true, t: +_gfT.toFixed(2),
    rotX: +GROOM_ARM.rotation.x.toFixed(4), rotZ: +GROOM_ARM.rotation.z.toFixed(4),
    children: GROOM_ARM.children.map(c => c.name || c.type) } : { ok: false };
}

function attachFeedBale(root){
  let hand = null;
  root.traverse(o => {
    if (hand || !o.isMesh || o.name !== 'scholarClump') return;
    if (o.position.x > 0) hand = o;                 // +x 侧 = 'pointDown' 前伸的那条胳膊
  });
  if (!hand){
    console.warn('[马夫] 找不到前伸手的拢手球（scholarClump），草料捆未挂');
    return null;
  }
  const local = root.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
  const b = makeFeedBale();
  b.name = 'propFeedBaleHand';
  b.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });
  /* 捆的原点 = **握点**（草茎从原点上下各露一截：上 0.13 / 下 0.12，像倒提一把草）
     ⇒ 原点落在手心里，手就是**握住草捆上端**。⚠️ 2026-10-16 之前原点在捆腰、捆腰又压在
     手心里 ⇒ 手从草中间穿出来，正是老黄说的"手夹在竹棍里面"。 */
  b.position.copy(local);
  /* ⚠️ 2026-10-11 改姿（老黄："马夫看不出来喂马的动作"）：绕 X 转 ~36°，草茎长轴从竖直
     倒向**前下方**（朝马嘴那侧）—— 递草的手势。2026-10-16 随新几何从 0.95 收到 0.62：
     新捆的原点在握点、草茎本来就从 ±y 张开，再转 54° 会翘成"举着扫帚"。 */
  b.rotation.set(0.62, 0.30, 0.14);
  root.add(b);
  return b;
}
function attachWoodBucket(root){
  let hand = null;
  root.traverse(o => {
    if (hand || !o.isMesh || o.name !== 'scholarClump') return;
    if (o.position.x < 0) hand = o;
  });
  if (!hand){
    console.warn('[井边仕女] 找不到右手拢手球（scholarClump），木桶未挂');
    return null;
  }
  /* getWorldPosition 会沿父链把 matrixWorld 刷到最新（刚 world.add 完还没渲染过），
     所以下面这次 worldToLocal 用的是**真实**的世界矩阵，不是上一帧的残值。 */
  const local = root.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
  const b = makeWoodBucket();
  b.name = 'propWellBucketHand';
  /* 提梁顶 = 桶原点 + BUCKET_HANDLE_H ⇒ 让提梁顶落在手心里就是这一行（桶原点在桶底中心） */
  const bucketY = local.y - BUCKET_HANDLE_H;
  b.position.set(local.x, bucketY, local.z);
  b.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });
  root.add(b);
  /* 手位留给探针/门禁复核（"桶真的挂在手上"是一条可判定的断言，不该只靠看图）。 */
  root.userData.bucketHand = { hand: [+local.x.toFixed(4), +local.y.toFixed(4), +local.z.toFixed(4)],
                               bucketY: +bucketY.toFixed(4),
                               handleTop: +(bucketY + BUCKET_HANDLE_H).toFixed(4) };
  return b;
}

/* 私塾孩童（第十六轮：用户要求"2 孩童 + 1 教书先生"场景）。
   makeChildScholar 是先生剪影的子集 —— 矮约 0.72 倍、头更大（孩童头身比 ~3.5:1）、
   袍身更短圆、无簪、无负手垂布，只剩简单垂袖。陪先生晨课，面向先生。
   ⚠️ 2026-10-05 加 `arms`（'down' 垂袖 | 'up' 举袖欢呼，给"看烟花的孩子"用）：
      只换**同一条 tube 的点列**，几何管线（CatmullRomCurve3 + TubeGeometry + 同一材质）逐字不动，
      不新写一套手臂几何。 */
function makeChildScholar({ x = 0, z = 0, y, yaw = 0, s = 1, skin = 'moss', arms = 'down' } = {}){
  const root = new THREE.Group();
  root.position.set(x, y === undefined ? groundHeight(x, z) : y, z);
  root.userData.baseY = root.position.y;     // 同 makeScholar：站立分支靠它贴地
  root.rotation.y = yaw;
  root.scale.setScalar(s);
  const g = new THREE.Group();                // 躯干层：椭圆截面（同成人，头不参与）
  g.scale.set(FIG_EW, 1, FIG_ED);
  root.add(g);
  const P = FIG_PALETTE[skin] || FIG_PALETTE.moss;
  const ink  = figMat(P.robe, 0.92);          // 童袍主色
  const hair = figMat(FIG_HAIR, 0.90);
  /* 半写实（2026-10-06）：同站姿 —— 袍/腰/缘挂织纹（白底乘色，color 不动）；头用孩童脸。
     原先 cSash/cHem/交领各自内联 figMat（同色重复建材质），顺手各收成一个共享实例再挂 map。 */
  ink.map = figClothTexture('robe');  ink.needsUpdate = true;
  const cTrimMat = figMat(P.trim, 0.85);
  cTrimMat.map = figClothTexture('trim');  cTrimMat.needsUpdate = true;
  const cSashMat = figMat(P.sash, 0.88);
  cSashMat.map = figClothTexture('sash');  cSashMat.needsUpdate = true;
  // 童袍：矮圆，微 A 形
  const prof = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.132, 0.01),
    new THREE.Vector2(0.152, 0.12),
    new THREE.Vector2(0.130, 0.42),
    new THREE.Vector2(0.118, 0.62),
    new THREE.Vector2(0.112, 0.80),
    new THREE.Vector2(0.090, 0.88),
    new THREE.Vector2(0.040, 0.94),
    new THREE.Vector2(0.001, 0.96),
  ];
  const robe = mesh(new THREE.LatheGeometry(prof, 14), ink, { name:'childRobe' });
  g.add(robe);
  // 童腰带（同成人：一道横带 = 最省成本的"衣服感"）；半径按 y=0.60 处袍半径 0.118 外放 8mm
  const cSash = mesh(new THREE.CylinderGeometry(0.124, 0.128, 0.05, 12, 1, true), cSashMat, { name:'childSash' });
  cSash.position.y = 0.60;
  g.add(cSash);
  // 童下摆衣缘（同先生：给"花瓶轮廓"一条终止线）
  const cHem = mesh(new THREE.CylinderGeometry(0.152, 0.143, 0.05, 14, 1, true), cTrimMat, { name:'childHem' });
  cHem.position.y = 0.055;
  g.add(cHem);
  // 简单垂袖（孩童的袖子贴垂，不拢后）；arms:'up' = 举袖欢呼（两条胳膊举到头顶两侧成 V 形）
  /* 举袖的点列：肩 (0.115, 0.80) → 肘外张 (0.200, 0.92) → 手 (0.215, 1.12)。
     手高 1.12 而头心 1.02 + 头半径 0.075 ⇒ 手在**头顶之上**、横向 0.215*FIG_EW=0.25 之外
     （头半径 0.086）：两条胳膊在剪影上分得开，不会与头糊成一团。 */
  const CHILD_SLEEVE = arms === 'up'
    ? [[0.115, 0.80, 0.020], [0.200, 0.920, 0.045], [0.215, 1.120, 0.000]]
    : [[0.115, 0.80, 0.020], [0.105, 0.550, 0.000], [0.080, 0.340, -0.020]];
  for (const side of [-1, 1]){
    const sl = new THREE.CatmullRomCurve3(CHILD_SLEEVE.map(([ax, ay, az]) => new THREE.Vector3(side * ax, ay, az)));
    g.add(mesh(new THREE.TubeGeometry(sl, 5, 0.042, 5, false), ink, { name:'childSleeve' }));
    /* 手（肤色，2026-10-06 半写实）：同站姿手法 —— 自袖末点沿末段方向探出 ~4cm。
       举袖欢呼（arms:'up'）的手从袖口上探，读作"举着的手掌"。 */
    const hd = new THREE.Vector3(side * (CHILD_SLEEVE[2][0] - CHILD_SLEEVE[1][0]),
                                 CHILD_SLEEVE[2][1] - CHILD_SLEEVE[1][1],
                                 CHILD_SLEEVE[2][2] - CHILD_SLEEVE[1][2]).normalize();
    const hand = mesh(new THREE.SphereGeometry(0.030, 8, 6), figSkinMat, { name:'childHand' });
    hand.position.set(side * CHILD_SLEEVE[2][0], CHILD_SLEEVE[2][1], CHILD_SLEEVE[2][2]).addScaledVector(hd, 0.042);
    hand.scale.set(1.1, 0.75, 1.1);
    g.add(hand);
  }
  /* 童交领（第六轮）：与先生同款构件 —— 童装也是交领，缺了同框会看出"两种衣服" */
  for (const side of [-1, 1]){
    const pts = [[0.030, 0.900], [0.020, 0.800], [0.004, 0.700], [-0.016, 0.660]];
    const lapel = new THREE.CatmullRomCurve3(pts.map(([ax, y]) => {
      const x = side * ax, r = profR(prof, y) + 0.010;
      return new THREE.Vector3(x, y, Math.sqrt(Math.max(r * r - x * x, 0.0004)));
    }));
    g.add(mesh(new THREE.TubeGeometry(lapel, 10, 0.013, 5, false), cTrimMat, { name:'childLapel' }));
  }
  // 大头 + 双总角（孩童发髻：两小揪，不是成人单髻）
  const headG = new THREE.Group();
  headG.position.set(0, 1.02, 0.02);
  headG.rotation.x = 0.10;
  /* 头球用孩童脸贴图（2026-10-06 半写实）：眼睛更大更圆、腮红更浓。
     孩子袍口收在 0.96、头下缘 0.945 —— 头和袍本身重叠，没有露颈的缝，不加颈。
     分段 12×10 → 14×12（同站姿的理由：脸窗要够细）。 */
  headG.add(mesh(new THREE.SphereGeometry(0.075, 14, 12), figFaceMatC, { name:'childHead' }));
  /* 小孩同补下颌（与大人同一手法，按比例缩小：大人 0.062 → 小孩 0.054），
     否则一家同框，大人有下巴、小孩还是球插杆。 */
  const childJaw = mesh(new THREE.SphereGeometry(0.054, 12, 10), figSkinMat, { name:'childJaw' });
  childJaw.scale.set(0.88, 0.78, 0.92);
  childJaw.position.set(0, -0.037, 0.021);
  headG.add(childJaw);
  for (const side of [-1, 1]){
    /* 双总角（第六轮）：原 r=0.026 / ±0.030 / y=0.085 —— 剪影上是两个**带 V 形缺口的小圆包**，
       在 2.5m 视距（样张 10a）直接读成"耳朵"。修法：加大到 0.030、上移、向中线靠拢到 ±0.024，
       两球产生约 1.2cm 交叠 → 合成"头顶一团发"而不是两侧两只耳；
       同时保证内缘嵌进头球 2cm（不悬空）、离顶只凸出 3.9cm（不变成天线）。 */
    const top = mesh(new THREE.SphereGeometry(0.030, 8, 7), hair, { name:'childTopKnot' });
    top.position.set(side * 0.024, 0.080, -0.008);
    headG.add(top);
  }
  root.add(headG);            // ⚠️ 头挂 root（不挂 g）：不参与躯干椭圆缩放
  root.userData.breathPhase = jr() * TAU;   // 同先生：必须挂 root（figures 存的是 root）
  root.userData.robe = robe;
  root.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });
  figures.push(root);
  return root;
}
/* 两书童（第六轮 · 老黄选 B：改成"半围"阵型）。
   先生居中偏后侧身，两童在前左右各约 0.8m 处、身体**向内转 1/3 朝先生**。
   ⚠️ 内转比例是看图调出来的：首版转 55%（≈74°）→ 两人成了**纯侧影**，只剩一片薄色条，
   既丢了交领/腰带，"半围"也读成一个横排；转 1/3（≈43°）才是 3/4 侧身 ——
   交领、腰带、内向的肩线同时在，三个朝向各不相同才像"一群人"。
   ⚠️ 旧摆位的 yaw 把 atan2 的 x 写反了（`atan2(-0.6,-1.0)` 指向的是先生的**镜像方向**），
   实际两童是**背对先生**的，与注释"面朝先生"正好相反 —— 这种错不报错、不崩，只能看图发现。
   同样 7.5~12 时段出现、暴雨/风雪隐藏 —— 复用 D_SCHEDULES[0] 的 slot。 */
/* 书童构建已并入 buildFigures（见上）：此处只留位，不重复建场。 */

/* ══ 坐姿人物（2026-10-05 · 计划书 §6「人」批第一件，与 14-props 的 #1 石桌石凳棋盘配套）══
   ⚠️ 为什么不复用 makeScholar：站姿的袍身是一根**落地回转体**（y 0→1.31），而坐下的
   三处都不在这根回转体上 —— ① 腰从 0.82 降到 0.51、② 大腿**水平前伸**、③ 小腿在膝前
   垂直落下。硬套站姿得到的不是"矮一点的站姿"，而是"半截插进地里的立人"。
   ⇒ 坐姿由四段拼：躯干裙（lathe，腰以下略收 → 悬在凳腰之上）+ 大腿团（水平 tube）
     + 膝前垂布（tube，落到地面）+ 上身（腰以上与站姿同形）+ 头（与站姿同一套构件尺寸）。
   ⚠️ 与站姿**必须逐字对齐的两个比例**（否则两种姿势同框一眼看出"不是一套做的"）：
     躯干长（腰→肩）0.370、头心在颈顶上方 0.135 —— 与 makeScholar 的 prof 同源。
   ⚠️ SEAT_H 与 14-props 石凳坐面（stoolProf 顶面 0.452）是**同一个数**：改石凳要同步。
   ⚠️ 裙底**不收到底**（0.392）而是悬在凳腰之上：收到底会把整张鼓凳吞掉，
     读成"坐在一个圆锥里"；留出凳子下半截，"坐在鼓凳上"才成立。 */
const SEAT_H = 0.452;        // 石凳坐面高（= 14-props stoolProf 顶面）
const SEAT_SUP = 0.058;      // 坐骨压在坐面之上的量（屁股不该浮在凳面上）
/* 被 08-assemble 的座位/抚琴延迟装配块 import（原 3350/3366 行），故 export；其余工厂保持不导出。 */
export function makeSeatedScholar({ x = 0, z = 0, y, yaw = 0, s = 1, pose = 'go', skin = 'indigo' } = {}){
  const root = new THREE.Group();
  root.position.set(x, y === undefined ? groundHeight(x, z) : y, z);
  root.userData.baseY = root.position.y;     // 同站姿：11-loop 每帧会写 position.y
  root.rotation.y = yaw;
  root.rotation.z = 0.015;                   // 坐姿的重心微偏比站姿（0.03）小
  root.scale.setScalar(s);
  const g = new THREE.Group();               // 躯干层：只它吃椭圆截面缩放（头不跟着压扁）
  g.scale.set(FIG_EW, 1, FIG_ED);
  root.add(g);
  /* 腿/垂布层：⚠️ **只吃横向加宽、不吃前后压扁** —— 大腿与小腿的长度是它们自己的形状，
     再乘一次 FIG_ED(0.82) 会让前伸量凭空短 18%（要按压缩比反算 z 才能对上桌子，太脆）。 */
  const gl = new THREE.Group();
  gl.scale.set(FIG_EW, 1, 1);
  root.add(gl);
  const P = FIG_PALETTE[skin] || FIG_PALETTE.indigo;
  const ink      = figMat(P.robe, 0.92);
  const inkLight = figMat(P.trim, 0.85);
  const hair     = figMat(FIG_HAIR, 0.90);
  const sashMat  = figMat(P.sash, 0.88);
  /* 半写实（2026-10-06）：同站姿 —— 织纹挂接（白底乘色，color 不动）；头用成人脸。 */
  ink.map = figClothTexture('robe');       ink.needsUpdate = true;
  inkLight.map = figClothTexture('trim');  inkLight.needsUpdate = true;
  sashMat.map = figClothTexture('sash');   sashMat.needsUpdate = true;

  /* 关键高度：全部由坐面推出 + 与站姿同源的两段长度
       腰 HIP_Y = 0.510 · 肩 SHO_Y = 0.880 · 颈顶 NECK_Y = 1.000 · 头心 1.135 */
  const HIP_Y = SEAT_H + SEAT_SUP, SHO_Y = HIP_Y + 0.370, NECK_Y = SHO_Y + 0.120;

  const prof = [
    new THREE.Vector2(0.001, 0.392),          // 裙底（悬在凳腰之上，露出鼓凳下半截）
    new THREE.Vector2(0.214, 0.408),
    new THREE.Vector2(0.228, 0.455),
    new THREE.Vector2(0.206, 0.492),
    new THREE.Vector2(0.164, HIP_Y),          // 0.510 腰（同站姿 0.150 略放）
    new THREE.Vector2(0.172, HIP_Y + 0.220),  // 0.730 胸
    new THREE.Vector2(0.186, SHO_Y),          // 0.880 肩（同站姿 0.186）
    new THREE.Vector2(0.062, NECK_Y - 0.030), // 0.970 颈
    new THREE.Vector2(0.001, NECK_Y),         // 1.000
  ];
  const robe = mesh(new THREE.LatheGeometry(prof, 18), ink, { name:'seatRobe' });
  g.add(robe);

  /* 大腿团：水平前伸。半径 0.128、中心线 0.446~0.470 ⇒ 顶面 0.598 < 桌面下沿 0.62，
     即"膝能伸到桌沿下"而不顶穿桌面（石桌桌面是 y 0.62~0.72 的圆盘，见 14-props）。 */
  gl.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.470, -0.015),
    new THREE.Vector3(0, 0.458, 0.135),
    new THREE.Vector3(0, 0.446, 0.285),
  ]), 8, 0.128, 8, false), ink, { name:'seatThigh' }));
  /* 膝前垂布：从膝落到地面（坐姿剪影的"竖笔"），上端接大腿、下端略后收。
     z 取 0.295：与大腿前缘（0.285+0.128=0.413）搭上，不留缝。 */
  const shin = mesh(new THREE.CylinderGeometry(0.126, 0.104, 0.455, 12), ink, { name:'seatShin' });
  shin.position.set(0, 0.228, 0.295);
  gl.add(shin);

  /* 腰带（坐姿的腰比站姿低 0.31，必须跟着走；半径按 y=0.585 处的袍半径 0.167 外放 9mm）
     ⚠️ 腰带/衣缘/交领的**网格名沿用 `scholar*`**（不是 `seat*`）：
     probe/figure-audit.mjs 按 `/^(scholar|child)(Sash|Lapel|Hem)$/` 数件数，
     改名会让它报"腰带不存在 / 交领 0 条 / 下摆衣缘 0 个"——**判据滞后于产品**那一类假红。
     语义上也成立：坐姿穿的就是同一套直裰（腰带/衣缘/交领），只是身子坐下了。 */
  const sashBand = mesh(new THREE.CylinderGeometry(0.174, 0.178, 0.060, 16, 1, true), sashMat, { name:'scholarSash' });
  sashBand.position.y = 0.585;
  g.add(sashBand);
  const sashKnot = mesh(new THREE.SphereGeometry(0.036, 8, 7), sashMat, { name:'scholarSashKnot' });
  sashKnot.position.set(0, 0.585, 0.150);
  sashKnot.scale.set(1.1, 0.8, 0.65);
  g.add(sashKnot);
  /* 下摆衣缘：给坐姿的裙底一条终止线（同站姿"花瓶轮廓"的那道缘，位置改到裙底 0.428） */
  const hem = mesh(new THREE.CylinderGeometry(0.232, 0.222, 0.048, 18, 1, true), inkLight, { name:'scholarHem' });
  hem.position.y = 0.428;
  g.add(hem);
  /* 立领（与站姿同款，位置 = 肩 + 0.06） */
  const collar = mesh(new THREE.CylinderGeometry(0.066, 0.072, 0.075, 10), ink, { name:'seatCollar' });
  collar.position.y = SHO_Y + 0.060;
  g.add(collar);
  const collarEdge = mesh(new THREE.CylinderGeometry(0.0665, 0.0665, 0.012, 10), inkLight, { name:'seatCollarEdge' });
  collarEdge.position.y = SHO_Y + 0.092;
  g.add(collarEdge);
  /* 后领中缝：只画到腰背（坐姿的下摆在后腰断开，往下是凳子） */
  const seam = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, SHO_Y + 0.080, -0.075),
    new THREE.Vector3(0, SHO_Y, -0.196),
    new THREE.Vector3(0, HIP_Y + 0.220, -0.182),
    new THREE.Vector3(0, HIP_Y, -0.164),
  ]), 12, 0.011, 5), inkLight, { name:'seatSeam' });
  g.add(seam);
  /* 交领：点列 = 站姿那组整体下移 0.31（腰以上同形） */
  for (const side of [-1, 1]){
    const pts = [[0.050, 0.925], [0.030, 0.790], [0.005, 0.640], [-0.028, 0.568]];
    const lapel = new THREE.CatmullRomCurve3(pts.map(([ax, y]) => {
      const x = side * ax, r = profR(prof, y) + 0.012;
      return new THREE.Vector3(x, y, Math.sqrt(Math.max(r * r - x * x, 0.0004)));
    }));
    g.add(mesh(new THREE.TubeGeometry(lapel, 12, 0.016, 5, false), inkLight, { name:'scholarLapel' }));
  }
  /* 双袖：坐姿的手位与**道具高度绑死**（同站姿"姿态决定手在哪里"这条纪律）——
     · 'go'  对弈：右手落到**桌面**上（桌面 y 0.72 / 盘面 0.763，见 14-props 石桌），
                 左手搭在自己的大腿上（大腿顶面 0.574）
     · 'qin' 抚琴：双手落到琴弦上方（弦高 0.7905，见 14-props makeQinSet；桌面已抬到 0.72）
     ⚠️ 末点 z 会再乘 FIG_ED(0.82)：0.548 → 实际前伸 0.449。
        凳心离桌心 1.02、桌面半径 0.62 ⇒ 手落在离桌心 0.57（= 桌面边缘内侧 5cm）。
        **这是这套几何的极限**：再往里就要么脱凳、要么手臂长过身体。真实的"落子在盘上"
        在这张 1.24m 石桌上够不到（盘心离凳心 1.10m，人的前伸只有 ~0.70）——
        所以取"手撑在棋盘这一侧的桌沿"，而不是硬把手拉长到 1.1m。
     ⚠️ y 必须**单调下降**（0.862→0.800→0.782→0.774）：第一版中段反翘 0.034 ⇒ 肘部
        折出一个 V 形拐点，近景里读成"胳膊断了"（出图复核后改直）。 */
  const SLEEVE = {
    /* ⚠️ 点列一律给**正 x**，左右由 side 镜像（与站姿同一套约定）。
       第一版把 R/L 两臂各自带符号写死、外面又乘了一次 side ⇒ 左臂被翻到右边，
       两条胳膊叠在一处、左边完全空着（只有近景出图才看得出来）—— 这类"镜像乘两次"
       不报错、不影响任何数值判据，只让画面少一条胳膊。 */
    go: {
      reach: [[0.180, 0.862, 0.028], [0.272, 0.800, 0.180], [0.230, 0.782, 0.368], [0.176, 0.774, 0.548]],
      /* ⚠️ 末点 y 0.566 → **0.616**（2026-10-05）：手是"搭在腿上"的，而大腿（半径 0.128、
         中心线 0.470→0.446）在 z 0.30 处的**顶面只有 0.574** —— 0.566 的手心落在大腿
         **里面**，近景里读成"前臂插进大腿、只剩一截袖口环悬在膝上"。改到 0.616
         （= 腿面 + 掌高），手才真正压在腿上。同一次复核把肘点也从 0.726/0.088 收进来
         （旧值让前臂斜着穿过袍身）。 */
      rest:  [[0.180, 0.862, 0.028], [0.268, 0.720, 0.070], [0.172, 0.652, 0.150], [0.088, 0.600, 0.252]],
    },
    /* ⚠️ 末点 y 0.800 → **0.826**（2026-10-05）：琴身顶面 0.748+0.0275、七弦 0.7905，
       手心 0.800 ⇒ 掌底 0.760 **正好穿在弦和琴面里**。抬到 0.826 后掌底 0.786，
       压在弦上（差 1.5cm），才是"手悬在弦上"。 */
    qin: [[0.180, 0.862, 0.028], [0.268, 0.828, 0.170], [0.216, 0.820, 0.360], [0.150, 0.826, 0.525]],
  };
  for (const side of [-1, 1]){
    const A = pose === 'go' ? (side > 0 ? SLEEVE.go.reach : SLEEVE.go.rest) : SLEEVE.qin;
    const V = ([ax, ay, az]) => new THREE.Vector3(side * ax, ay, az);
    /* 袖：⚠️ 必须拆成**上臂（宽）/ 前臂（窄）**两段。单段 TubeGeometry 的半径是**常数**，
       整条胳膊从肩到腕一样粗（0.065），而真手只有 0.05 ⇒ 手**怎么摆都露不出来**，
       远端永远只能读到管口的平截面 —— 用户那张顶视图里的"紫色平口圆管"就是它。
       直裰的宽袖本来就是"肩肘宽、腕口收"，拆段既合物理，也让"腕 → 掌"读得出来。
       两段在肘球里搭接：缝落在球内，外面看到的是一段圆肘。*/
    const UPPER = 0.068, FORE = 0.046;
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(A.slice(0, 2).map(V)), 6, UPPER, 7, false),
      ink, { name:'seatSleeveUpper' }));
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(A.slice(1).map(V)), 9, FORE, 7, false),
      ink, { name:'seatForearm' }));
    const elbow = mesh(new THREE.SphereGeometry(0.070, 9, 7), ink, { name:'seatElbow' });
    elbow.position.set(side * A[1][0], A[1][1], A[1][2]);
    g.add(elbow);
    /* 手：掌（压扁的球）+ 沿**前臂轴向**推到袖口之外 0.030 ⇒ 袖 → 腕 → 掌三段分明。
       ⚠️ 掌 0.050 比前臂 0.046 大一圈、比旧袖管 0.065 小一圈 —— 这才是手的比例。
       2026-10-06 半写实：掌由袍色换**肤色**（坐姿的袖已拆上臂/前臂两段、袖口环独立，
       露出的就是"手"本身，用袍色反而读不出手）。⚠️ 名字 seatClump 不改 —— 探针
       按它实测手位（2026-10-05 的门禁记过这笔账）。 */
    const [hx, hy, hz] = A[3];
    const [px, py, pz] = A[2];
    const ux = hx - px, uy = hy - py, uz = hz - pz;
    const uL = Math.hypot(ux, uy, uz) || 1;        // 前臂轴向（局部坐标；g 的椭圆缩放另算）
    const OUT = 0.030;                              // 掌心推到腕口之外的距离
    const palm = mesh(new THREE.SphereGeometry(0.050, 9, 7), figSkinMat, { name:'seatClump' });
    palm.position.set(side * (hx + ux / uL * OUT), hy + uy / uL * OUT, hz + uz / uL * OUT);
    palm.scale.set(1.10, 0.80, 1.15);               // 压扁成"掌"，不是球
    g.add(palm);
    /* 袖口环：**套在手腕上**（= 腕口那一点）、轴向前臂。
       旧版按屏幕方向硬写 rotation.x = 1.2 —— 那是给"负手"那条胳膊配的角度，
       坐姿一换姿态，环就斜着切开袖子。改用 setFromUnitVectors 由轴向定姿，与姿态无关。
       半径 0.052 略大于前臂 0.046：不这样它整体缩在袖里，等于没画。 */
    const cuff = mesh(new THREE.TorusGeometry(0.052, 0.008, 5, 12), inkLight, { name:'seatCuff' });
    cuff.position.set(side * hx, hy, hz);
    cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(side * ux, uy, uz).normalize());
    g.add(cuff);
  }
  /* 头 + 发髻 + 簪（与站姿同一套尺寸/构件；坐姿低头角度按姿态给：
     对弈要盯着盘面 ⇒ 0.40；抚琴盯着弦 ⇒ 0.30；其余 0.24 同站姿）
     头球用脸贴图（2026-10-06 半写实，同站姿：16×13 分段 + figFaceMatA）。 */
  const headG = new THREE.Group();
  headG.position.set(0, NECK_Y + 0.135, 0.03);
  headG.rotation.x = pose === 'go' ? 0.40 : (pose === 'qin' ? 0.30 : 0.24);
  headG.add(mesh(new THREE.SphereGeometry(0.086, 16, 13), figFaceMatA, { name:'seatHead' }));
  /* 坐姿同补下颌（与站姿同尺寸：两姿势同框必须是一套头，见本文件顶部"逐字对齐"）。 */
  const seatJaw = mesh(new THREE.SphereGeometry(0.062, 12, 10), figSkinMat, { name:'seatJaw' });
  seatJaw.scale.set(0.88, 0.78, 0.92);
  seatJaw.position.set(0, -0.042, 0.024);
  headG.add(seatJaw);
  const knot = mesh(new THREE.SphereGeometry(0.030, 8, 7), hair, { name:'seatKnot' });
  knot.position.set(0, 0.098, -0.020);
  headG.add(knot);
  const pinMat = new THREE.MeshStandardMaterial({ color:0xC9CDB8, roughness:0.6, metalness:0.0, envMapIntensity:0.5 });
  const pin = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.100, 6), pinMat, { name:'seatPin' });
  pin.rotation.order = 'ZYX';
  pin.rotation.set(0, 0.55, Math.PI / 2 + 0.14);
  pin.position.set(0, 0.088, -0.020);
  headG.add(pin);
  const pinAxis = new THREE.Vector3(-0.824, -0.122, 0.505);
  for (const e of [-1, 1]){
    const bead = mesh(new THREE.SphereGeometry(0.013, 7, 6), pinMat, { name:'seatPinBead' });
    bead.position.set(pinAxis.x * 0.050 * e, 0.088 + pinAxis.y * 0.050 * e, -0.020 + pinAxis.z * 0.050 * e);
    headG.add(bead);
  }
  root.add(headG);            // ⚠️ 头挂 root（不挂 g）：不参与躯干椭圆缩放（同站姿）
  /* 颈（肤色，2026-10-06 半写实）：同站姿 —— 填"衣缘顶(0.994) → 头底(1.049)"那段透缝。
     圆柱 y 0.95~1.09：下端没入立领、上端没入头球，露中段 ~5cm。挂 root。 */
  const seatNeck = mesh(new THREE.CylinderGeometry(0.052, 0.060, 0.14, 10), figSkinMat, { name:'seatNeck' });
  seatNeck.position.y = 1.02;
  root.add(seatNeck);
  root.userData.breathPhase = jr() * TAU;
  root.userData.robe = robe;
  /* ⚠️ 坐姿的"接地面"不是脚底（= baseY），而是**坐面**：人物原点在凳心、正下方就是石凳，
     probe/figure-foot-guard.mjs 从天上往下打射线拿到的第一个面是**凳面**。
     所以这里显式声明"身体从 baseY + contactY 处落在支撑面上"，门禁照此比对 ——
     它同时也把"人真的坐在凳子上"这件事变成了一条可判定的断言（而不是只看脚底贴不贴地）。 */
  root.userData.contactY = SEAT_H;
  root.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });
  figures.push(root);
  return root;
}

/* ══ 看烟花的人（2026-10-05 · 计划书 §6「人」批第二件，与 12-env 的「春节烟花（冬季限定）」配套）══
   老黄：「大人带着孩童在左侧草皮上欣赏烟花，孩子们欢呼雀跃」。
   2 大人 + 3 孩童，站在**画面左侧那块西草坪**上（默认俯视机位下 ndc.x ≈ −0.6~−0.8 那一片），
   面朝园子上空偏北的烟花空域。冬季夜里烟花亮起时才出现；孩子们原地雀跃。

   ── 落点怎么定的（三样都是射线实测，没有一个是手填的）─────────────────────────
   ① 位置：老黄给的两条反投影（ndc(−0.85,−0.35)→(−22.8,−7.6)、(−0.6,−0.35)→(−17,−4.8)）
      圈出的是西草坪，但**那一带不是空场**：古井 (−20.4,−6.1)、花街铺地 (−20.4,−3.5)
      （14-props 的 PROP_SPOTS.well / .lane）占着东北角，x=−15~−16 与 −17 那两条竖带
      还被默认机位**挡死**（outputs/_diag/watchers-map.mjs 的 0.5m 可见性地图：那一列 3/3 射线
      全被挡 ⇒ 人站进去等于没画）。所以往西挪到 x∈[−21.2,−19.3]、z∈[−12.0,−9.9]：
      地图上整块都是"地面 + 默认机位 0~1 处遮挡"，离古井最近 3.4m、离花街铺地北端 4.4m。
   ② 地面高：一律走 `groundHeight(x,z)`（与地面网格同一个函数，不手填、不与 07-ground 两处漂）；
      figure-foot-guard 会用向下射线复核"脚底就踩在它脚下那个面上"。
   ③ 朝向：由**烟花空域中心**算 atan2，不手填 yaw（见 FW_AIM）。

   ── 三条铁律（这个项目在这里各栽过一次，照抄既有做法）───────────────────────
   ① 逐帧动画全写在**新加的 pivot 层**上，不动 root 的 position.y / rotation.x / rotation.z /
      visible：那四个量 11-loop 的人物循环**每帧都在写**（`f.position.y = baseY`、
      `rotation.x = 0`、`rotation.z = 0.03`、`f.visible = goodWeather && inSlot`）。
      写在 root 上就是"两处互相覆盖"，而且谁后跑谁赢 —— 改完看不见效果、也不报错。
      ⚠️ 所以**不要**动 11-loop.js；本模块只导出 updateWatchers，由调用方接一行。
   ② 相位/朝向微差全部吃**本模块的私有流**（WR = mulberry32(20261009)，铁律 1）；
      而**逐帧**动画一次随机都不取（只吃 dt/t）—— 否则帧数会改写私有流的消费位置，
      延迟批（runDeferredBoot 里那些还要 jr() 的 job）布局整体前移且不报错。
   ③ 人物网格 noMerge：由 makeScholar / makeChildScholar 内部 `root.traverse(...)` 统一打，
      本块不碰 —— 少了它会被 mergeStatics 并进静态大网，之后再也动不了。 */
/* 烟花的绽放空域中心（= 12-env 的 FW_VOL { x:[−38,38], y:[26,52], z:[−72,−26] } 的中点）。
   ⚠️ 只抄这个**常量**、不 import 那边的 FW_VOL：12-env 被本模块 import，反向取值成环
   （见本文件顶部与 02-scene 的 world 那条注释）。12-env 那边留了"改 FW_VOL 要看这里"的锚点。 */
const FW_AIM = new THREE.Vector3(0, 39, -49);
/* 站位的朝向 = 从本人位置指向空域中心的水平方位（模型正面 = +z、rotation.y = ry ⇒
   前向量 = (sin ry, cos ry)，所以方位角就是 atan2(dx, dz)）。 */
const watchYaw = (x, z) => Math.atan2(FW_AIM.x - x, FW_AIM.z - z);

const WATCHERS = [];                 // 逐帧要驱动的（外面经 fig.userData.watcher 也读得到）
/* ⚠️ pivot 是插在 root 与人体几何之间的**一层空组**（见上面铁律 ①）。
   搬迁用 while 而不是 forEach：three 的 add() 会把节点从原父级摘掉，边遍历边改数组会漏节点。
   root.userData.robe（呼吸）与 headG 的引用都还在 —— 它们只是父级换了一层。 */
function wrapWatcher(root){
  const pivot = new THREE.Group();
  pivot.name = 'watcherPivot';
  pivot.visible = false;             // 未接 updateWatchers 之前不露面（默认季节/时辰本来也不该出现）
  while (root.children.length) pivot.add(root.children[0]);
  root.add(pivot);
  return pivot;
}
/* 一家人（服色全部避开绿族：站的是草坪，见 FIG_PALETTE 开头那段的血泪）。
   服色与时段的口径：5 人同档、必然同框 ⇒ 两两 ΔRGB 必须 ≥60（figure-audit 的 B 段），
   实际：plum↔navy 93 / ↔celadon 114 / ↔ochre 68 / ↔vermilion 85、navy↔celadon 131 /
   ↔ochre 138、celadon↔ochre 104、ochre↔vermilion 83（最小 68）。
   时段 18~23 与"夜步"（lily 18~23）重叠 ⇒ 再核一遍对他们：70.8 / 96.3 / 62.1 / 99.0 / 149.7
   （最小 62.1 是 celadon —— 余量确实不大，但**不去动那条判据**，如实记在这儿）。
   ⚠️ 站位的 x/z 是上面那份可见性地图里挑的实测点；微差只动朝向（各转 8~10°），
      因为"三个朝向各不相同才像一群人"（同 06 那批晨课三人的结论）。 */
/* buildWatchers 由 08-assemble 在原 3436 行位置调用：
   WATCH_SPOTS 构建的 WR 消耗顺序与搬家前逐字一致（WR 定义已随本模块搬入）。 */
export function buildWatchers(){
const WATCH_SPOTS = [
  { kind:'adult', skin:'plum',  x:-20.9, z:-11.4, s:1.02, yawOff:+0.10, pose:'point'   }, // 父亲：抬手指天
  { kind:'adult', skin:'navy',  x:-19.7, z:-11.9, s:0.97, yawOff:-0.13, pose:'observe' }, // 母亲：负手同看
  { kind:'child', skin:'celadon', x:-20.2, z: -9.9, s:0.92, yawOff:+0.16 },   // 孩童甲（举袖）
  { kind:'child', skin:'ochre',   x:-19.3, z:-10.6, s:0.86, yawOff:-0.19 },   // 孩童乙
  { kind:'child', skin:'vermilion', x:-21.1, z:-10.6, s:0.96, yawOff:+0.28 }, // 孩童丙（转身看的那位）
];
WATCH_SPOTS.forEach((sp, i) => {
  const yaw = watchYaw(sp.x, sp.z) + sp.yawOff;
  const root = sp.kind === 'adult'
    ? makeScholar({ x: sp.x, z: sp.z, yaw, s: sp.s, pose: sp.pose, skin: sp.skin })
    : makeChildScholar({ x: sp.x, z: sp.z, yaw, s: sp.s, skin: sp.skin, arms: 'up' });
  root.userData.skin = sp.skin;
  root.userData.poseName = sp.kind === 'adult' ? 'watchAdult' : 'watchChild';
  /* 时段 18~23：与"夜步"同一档（本项目"夜"的人物统一口径，锚点 21.5 落在里面）。
     ⚠️ 它**不是**这道门的主判据 —— 出现与否由 updateWatchers 里那扇"与 FIREWORKS 同口径"的
     门控决定（冬 + starAmount>0.5 + 无雨雪雷暴）。留着 slot 还有一层用：
     figure-audit 的"同框可区分"只判定 slot 重叠的对 —— 没 slot 等于把这 5 人从那条判据里摘出去。
     边界如实声明：本项目的"夜"跨午夜（19.5~次日 4.5），而 slot 是个不跨午夜的 [h0,h1) ——
     23 点后烟花还会放，看烟花的人按 18~23 收工（与"夜步"一致）。 */
  root.userData.slot = { h0: 18, h1: 23, stroll: null };
  const pivot = wrapWatcher(root);
  let head = null;
  root.traverse(o => { if (!head && o.isMesh && /^(scholar|child)Head$/.test(o.name)) head = o.parent; });
  const wd = {
    pivot, head, idx: i, kind: sp.kind, skin: sp.skin, yawOff: sp.yawOff,
    /* 相位/微差只在这里取一次随机（建场性质）；下面逐帧一个随机都不取。 */
    ph: WR() * TAU,
    hop:  sp.kind === 'child' ? (0.16 + WR() * 0.05) : 0,   // 跳多高（m）
    per:  sp.kind === 'child' ? (0.95 + WR() * 0.30) : 0,   // 一跳多久（s/跳）
    turnAmp: sp.kind === 'child' ? (0.22 + WR() * 0.26) : (0.06 + WR() * 0.06),
    turnW:   sp.kind === 'child' ? (0.55 + WR() * 0.45) : (0.30 + WR() * 0.20),
    /* 仰头：袍身没有下颌、颈也是立领，抬太多会把后脑勺露成"看星星的球"。
       14°~22° 是实测读得出"在往天上看"又不穿帮的区间（孩子的头大、角度给得更大）。 */
    tilt: sp.kind === 'child' ? -(0.30 + WR() * 0.12) : -(0.20 + WR() * 0.08),
    /* 可判定量（探针/门禁直接读 fig.userData.watcher 里这几个）：*/
    on: false, clock: 0, hopH: 0, air: 0, footUp: 0, latX: 0, lean: 0, turn: 0,
  };
  /* 建场即摆到"门关着"的姿态：万一这一帧 updateWatchers 还没被接上，画面里也只是
     "一家人抬头站着"，不会是一个低着头、y=0 的替身。 */
  if (head) head.rotation.x = wd.tilt;
  root.userData.watcher = wd;
  pivot.userData.noMerge = true;
  WATCHERS.push(root);
  world.add(root);
});
}  // buildWatchers
/* 逐帧驱动（由 11-loop 接一行调用；本模块**不动** 11-loop.js）。
   dt = 本帧仿真步长（与风/水/散步者同一口径：60fps 下 ≡ 墙钟，软渲染下慢放且可复现），
   t  = 计时器的仿真时间（这里只用来给成年人一点极慢的摆动，不参与雀跃的相位）。 */
export function updateWatchers(dt, t){
  /* ── 每帧入口的第 1 段：巡游观鱼者（老黄 B）───────────────────────────────
     ⚠️ 必须在本函数**开头**、且早于 11-loop 的 figures 循环（调用顺序见函数上方注释与
     上方 WALKERS 声明处那段"谁写哪个量"）。driveWalkers 只写 position.x/z、baseY、rotation.y，
     与 figures 循环写的 position.y/rotation.x/z 互补 —— 起伏与侧摆走 pivot 层。 */
  driveWalkers(dt);
  /* ── 每帧入口的第 2 段：狂风暴雨里把棋子（棋钵）收起来（老黄第 3 条前半）─────────
     口径与 12-env 里大雁落地那条判据（fowlGrounded）**逐字一致**：
       (rainAmount || 0) > 0.5 || (snowAmount || 0) > 0.5
     即"暴雨/大雪这一档才收，小雨照摆"（雁是"小雨照飞、暴雨落地"，同一条取舍）。
     ⚠️ 为什么门开在这里而不是 14-props：那边读不到 ENV（14-props ← 08 ← 12f ← 12-env，
     反向 import 成环），而本模块早就 import 了 ENV 与 12-env 的同一枚状态。
     ⚠️ 必须每帧重申：rainAmount 是连续量（滑杆/天气过渡逐帧在变），门就该逐帧跟一次 ——
     这也正是 applyPresence（存在性）那条注释里的教训。 */
  setGoPiecesVisible(!((ENV.cur.rainAmount || 0) > 0.5 || (ENV.cur.snowAmount || 0) > 0.5));
  /* ── 门控：与 12-env 的 FIREWORKS._fwOn() **同一口径**（冬 + 夜色深度 + 无雨雪雷暴 + 无明显降水）。
     自己读 ENV 算，而不是 import 那边的开关：_fwOn 没有导出，而 12-env 被本模块 import
     —— 反向取值成环（本文件里 02/05/06/14 的几处 import 注释都记着这条）。两处口径要一起改。 */
  const w = ENV.weather || '';
  const on = ENV.season === 'winter'
          && (ENV.cur.starAmount || 0) >= 0.5
          && w !== 'storm' && w !== 'thunder' && w !== 'snow'
          && (ENV.cur.rainAmount || 0) < 0.05;
  for (const f of WATCHERS){
    const d = f.userData.watcher;
    d.on = on;
    /* ⚠️ 挂在 pivot 上，不写 f.visible：11-loop 每帧都在写 f.visible（时段 + 天气）。 */
    d.pivot.visible = on;
    if (!on) continue;                     // 关着时不推进相位：切回来是接着跳，不会瞬跳
    d.clock += dt;
    const c = d.clock;
    if (d.kind === 'child'){
      /* ── 雀跃：一跳 = 一个周期 ──────────────────────────────────────────────
         uu ∈ [0,1) 是"这一跳"的相位；air = sin(π·uu) 是**离地量**（0 落地 → 1 腾空 → 0 落地）。
         ① 上下起伏：y = hop·air − 0.035·max(0, cos 2π·uu)。后半项是**落地缓冲**（起跳/落地的
            那一刻蹲一下）—— 纯 sin 曲线在落地瞬间速度最大，看着像"被弹起来"，加了缓冲才像蹲着蓄力。
            地面高度由 baseY 保证（root 不动），所以"跳起来"不会变成"悬空的人"。
         ② 换脚小跳：每跳换一次重心脚 footUp = 第几跳 % 2（0/1 交替）——
            落地缓冲那一相里，重心偏向踩地的那只脚：身体侧倾 + 横向让开 5cm。
            左一下右一下地跳，才是"雀跃"而不是"原地蹦"。（袍身只有裙摆没有腿，
            所以只能靠"重心侧倾 + 横向位移"表达换脚 —— 与散步者"起伏+左右摆+前倾"同一套手法。）
         ③ 转身看：yaw 慢摆 ±turnAmp（1.6~3.5s 半周期），孩子跳着跳着回头看一眼家人/身后。  */
      const u = c / d.per, hopIdx = Math.floor(u), uu = u - hopIdx;
      const air = Math.sin(Math.PI * uu);
      const crouch = Math.max(0, Math.cos(TAU * uu)) * 0.035;
      d.air = air;
      d.hopH = d.hop * air;
      d.footUp = hopIdx % 2;
      d.lean = (d.footUp ? 1 : -1) * 0.085 * (1 - air);
      d.latX = (d.footUp ? 1 : -1) * 0.05 * (1 - air);
      d.turn = d.turnAmp * Math.sin(c * d.turnW + d.ph);
      d.pivot.position.set(d.latX, d.hopH - crouch, 0);
      d.pivot.rotation.set(0, d.turn, d.lean);
      /* 头：仰头看天 + 一点跟着转身的回望（头是球，y 向摆动比躯干更安全） */
      if (d.head){
        d.head.rotation.x = d.tilt - 0.06 * air;            // 跳到最高点再抬一点
        d.head.rotation.y = Math.sin(c * d.turnW * 0.9 + d.ph) * 0.22;
      }
    } else {
      /* ── 大人：脚不动（y ≡ 0），只有极慢的重心微摆 —— 大人是"看"，情绪由孩子承担。
         摆动幅度刻意压在 2cm / 2.5° 以内：超过就变成"也在蹦"，与孩子抢戏。 */
      d.turn = d.turnAmp * Math.sin(c * d.turnW + d.ph);
      d.latX = Math.sin(c * d.turnW * 0.8 + d.ph * 1.3) * 0.02;
      d.lean = Math.sin(c * d.turnW * 0.7 + d.ph * 0.7) * 0.025;
      d.hopH = 0; d.air = 0;
      d.pivot.position.set(d.latX, 0, 0);
      d.pivot.rotation.set(0, d.turn, d.lean);
      if (d.head) d.head.rotation.x = d.tilt + Math.sin(t * 0.5 + d.ph) * 0.02;
    }
  }
}
