// 12g-phenology: 苏州花历（按旬的物候曲线）+ 季节代表日 + 节令挂钩 —— 纯数据模块（2026-10-30）。
/* 为什么要有它（审查 B1 / S4）：旧的季节表每季只有一个数，显隐又一律按 `> 0.03` 判 ⇒
   春 lotusShow 0.05 就是"春天满池荷花莲蓬"，秋 plumBlossomShow 0.15 就是"秋天梅花满树"，
   夏秋 wisteriaShow 一个键同时管花和叶 ⇒ "夏秋紫藤挂满花串"，秋 peachFruitShow 0.7 ⇒ "秋天桃子还在树上"。
   现在改成：每个物候通道一条**按旬**的 0..1 曲线，四个季节按钮各对应一个**代表日**，
   参数合成时在曲线上取值（12a composeEnv）。曲线是连续的 ⇒ 切季节仍走 mixInto 平滑过渡。
   ⚠️ 本文件**零 import**，node 下直接单测（probe/env-phenology-unit.mjs 锁住"春无荷花 / 秋无梅花 /
      夏秋无紫藤花 / 秋无桃子"等常识）。日期工具复用 12h-solar（同样零依赖）。
   数据口径：苏州 / 拙政园的大致花期（写意为主，旬级精度足矣）——
     梅花 2 月上旬 ~ 3 月上旬；腊梅 12 月中旬 ~ 2 月上旬；桃花 3 月下旬 ~ 4 月上旬；
     紫藤 4 月中旬 ~ 5 月上旬；荷叶 4 月下旬出水、5 月下旬起铺满；荷花 6 月下旬 ~ 8 月下旬；
     莲蓬 7 月下旬 ~ 9 月（残荷留到 10 月中旬）；桃子 7 月；桂花 9 月下旬 ~ 10 月中旬；
     银杏 / 枫秋色 11 月中下旬。 */
import { doyOf, dateOfDoy, wrapDoy } from './12h-solar.js';

/* ── 旬坐标 ── x ∈ [0,36)：x = (月-1)*3 + 旬序(上0/中1/下2) + 旬内分数。
   例：2 月上旬 = [3,4)，4 月中旬 = [10,11)，12 月下旬 = [35,36)。下旬按当月实际天数（8~11 天）。 */
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function xunOfDoy(doy){
  const { month, day } = dateOfDoy(doy);
  const k = Math.min(2, Math.floor((day - 1) / 10));
  const len = k < 2 ? 10 : MDAYS[month - 1] - 20;
  return (month - 1) * 3 + k + (day - 1 - 10 * k) / len;
}

/* ── 花历曲线 ── 每条是按 x 升序的关键点 [x, v]，**跨年循环**（最后一点与第一点之间绕过年底插值），
   点间用 smoothstep 过渡（花开花谢是慢起慢收，不是折线）。
   ⚠️ 只写"相对盛期"的 0..1；各消费端自己决定怎么用（显隐阈值 / 实例数比例 / GLB 缩放）。 */
export const PHENO = {
  plumRed:      [[2.5, 0], [3.0, 0.6], [3.6, 1], [6.4, 1], [7.0, 0.3], [7.4, 0]],           // 红梅 2上~3上
  plumYellow:   [[3.4, 1], [4.0, 0.4], [4.5, 0], [33.3, 0], [34.0, 0.7], [34.6, 1]],        // 腊梅 12中~2上（跨年）
  peachBlossom: [[7.4, 0], [8.0, 0.7], [8.5, 1], [9.8, 1], [10.5, 0.3], [11.0, 0]],         // 桃花 3下~4上
  peachPetal:   [[9.0, 0], [10.0, 0.4], [10.8, 1], [11.5, 0.5], [12.3, 0]],                 // 落花：花期尾声最多
  peachLeaf:    [[8.5, 0], [9.5, 0.15], [10.5, 0.6], [11.5, 1], [30.0, 1], [31.5, 0.4], [32.5, 0]],  // 先花后叶，11 月落尽
  peachFruit:   [[17.0, 0], [17.8, 0.6], [18.3, 1], [20.6, 1], [21.2, 0.3], [21.6, 0]],     // 水蜜桃 7 月
  wisteriaBloom:[[9.5, 0], [10.0, 0.6], [10.5, 1], [12.6, 1], [13.2, 0.3], [13.6, 0]],      // 紫藤花 4中~5上
  wisteriaLeaf: [[10.0, 0], [10.8, 0.5], [11.8, 1], [30.5, 1], [31.5, 0.4], [32.3, 0]],     // 紫藤叶 4~11 月（落叶藤本）
  lotusLeaf:    [[11.0, 0], [11.6, 0.2], [13.0, 0.5], [14.0, 0.85], [14.5, 1], [28.5, 1], [30.0, 0.5], [31.5, 0.1], [32.0, 0]],  // 荷叶 4下出水、5下铺满
  lotusBud:     [[15.0, 0], [15.6, 0.5], [16.2, 1], [17.2, 1], [17.8, 0.3], [18.3, 0]],     // 荷苞 6 月（"小荷才露尖尖角"后的花苞）
  lotusFlower:  [[16.4, 0], [17.0, 0.5], [17.6, 1], [23.2, 1], [23.9, 0.4], [24.4, 0]],     // 荷花 6下~8下
  lotusPod:     [[19.4, 0], [20.0, 0.5], [20.6, 1], [26.4, 1], [27.6, 0.7], [28.8, 0.2], [29.4, 0]],  // 莲蓬 7下~9 月，残荷到 10中
  osmanthus:    [[25.5, 0], [26.0, 0.6], [26.5, 1], [28.4, 1], [29.0, 0.2], [29.4, 0]],     // 桂花 9下~10中（园中暂无桂树：数据先行）
  autumnFoliage:[[29.5, 0], [30.4, 0.5], [31.0, 1], [32.6, 1], [33.4, 0.3], [34.0, 0]],     // 银杏 / 枫秋色 11中下（同上，暂无消费端）
};

const ss = (t) => t * t * (3 - 2 * t);
export function phenoAt(curve, x){
  const k = PHENO[curve] || curve, n = k.length;
  let q = ((x % 36) + 36) % 36, a = null, b = null, x0 = 0, x1 = 0;
  for (let j = 0; j < n - 1; j++){
    if (q >= k[j][0] && q < k[j + 1][0]){ a = k[j]; b = k[j + 1]; x0 = a[0]; x1 = b[0]; break; }
  }
  if (!a){                                         // 末点 → 首点：绕过年底
    a = k[n - 1]; b = k[0]; x0 = a[0]; x1 = b[0] + 36;
    if (q < x0) q += 36;
  }
  const t = (x1 - x0) > 1e-9 ? (q - x0) / (x1 - x0) : 0;
  return a[1] + (b[1] - a[1]) * ss(Math.max(0, Math.min(1, t)));
}

/* ── 季节按钮 → 代表日 ──（季节仍是面板上的 4 档离散值；年内日序 doy 是它背后的内部量）
   选日的理由（同时兼顾花历与月相——月相按日期算，见 12h-solar）：
     春 4/12：桃花未谢、紫藤初放（两者唯一重叠的几天），荷叶尚未出水 ⇒ 春天没有荷花；
     夏 7/10：荷花盛期、桃子成熟、仍在梅雨（6中~7上）里 ⇒ 夏 + 细雨 = 梅雨；
     秋 10/12：桂花盛期、残荷莲蓬犹在，近望月（中秋前后的秋夜月色）；
     冬 1/22：腊梅盛开、红梅未开（红梅看梅机位另给 2/25），望月。 */
export const SEASON_DOY = {
  spring: doyOf(4, 12), summer: doyOf(7, 10), autumn: doyOf(10, 12), winter: doyOf(1, 22),
};
/* 两个看梅机位各自的日子（季节按钮仍落在"冬"，只是 doy 不同）：红梅 2/25 盛开、腊梅 1/22 盛开。 */
export const PLUM_VIEW_DOY = { plumRed: doyOf(2, 25), plumYellow: doyOf(1, 22) };

/* doy → 面板季节（按气象季：3~5 春 / 6~8 夏 / 9~11 秋 / 12~2 冬）。 */
export function seasonOfDoy(doy){
  const m = dateOfDoy(doy).month;
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}

/* ── 合成用：doy → 参数集里的物候通道 ──
   键名沿用 12f-season 存在性表的老名字（lotusShow / lilyShow / wisteriaShow / peach*Show /
   plumBlossomShow / lotusBud / lotusBloom / lotusPod），新拆出来的花 / 叶 / 果各自一个键：
     · wisteriaBloom（花串）与 wisteriaShow（叶）分开 —— 夏秋只剩叶；
     · plumRedShow / plumYellowShow 分开 —— 腊梅深冬、红梅早春；plumBlossomShow = 两者取大，
       仍管两树共用的花苞 / 凋花材质；
     · lotusPodShow 管程序化莲蓬（含花心托，所以取 max(荷花, 莲蓬)）；lotusShow 只管荷花瓣。
   GLB 池边荷花三态（lotusBud / lotusBloom / lotusPod）**一次只亮一态**：同一株的三个子节点叠在
   同一处，同时显示会穿插。取当前最强的那一态、保留它的强度（作缩放），其余归零；
   切季节时两端各是一态，中间靠 mixInto 的插值完成"苞 → 花 → 蓬"的交接（与旧做法同）。 */
export function phenoChannels(doy){
  const x = xunOfDoy(wrapDoy(doy));
  const v = (c) => phenoAt(c, x);
  const red = v('plumRed'), yellow = v('plumYellow');
  const flower = v('lotusFlower'), pod = v('lotusPod'), bud = v('lotusBud');
  const stage = [['lotusBud', bud], ['lotusBloom', flower], ['lotusPod', pod]]
    .reduce((best, s) => (s[1] > best[1] ? s : best), ['', 0.02]);
  return {
    plumRedShow: red, plumYellowShow: yellow, plumBlossomShow: Math.max(red, yellow),
    peachBlossomShow: v('peachBlossom'), peachPetalShow: v('peachPetal'),
    peachShow: v('peachLeaf'), peachFruitShow: v('peachFruit'),
    wisteriaBloom: v('wisteriaBloom'), wisteriaShow: v('wisteriaLeaf'),
    lilyShow: v('lotusLeaf'), lotusShow: flower, lotusPodShow: Math.max(flower, pod),
    lotusBud: stage[0] === 'lotusBud' ? stage[1] : 0,
    lotusBloom: stage[0] === 'lotusBloom' ? stage[1] : 0,
    lotusPod: stage[0] === 'lotusPod' ? stage[1] : 0,
    osmanthusShow: v('osmanthus'), autumnFoliage: v('autumnFoliage'),
  };
}

/* ── 梅雨 / 春雨 / 冷雨：同一个"细雨"天气按日期换名（审查 B3 / S2）── */
export const MEIYU = { from: doyOf(6, 11), to: doyOf(7, 10) };   // 6 月中旬 ~ 7 月上旬
export function drizzleKind(doy){
  const d = wrapDoy(doy), m = dateOfDoy(d).month;
  if (d >= MEIYU.from && d <= MEIYU.to) return 'meiyu';
  if (m >= 3 && m <= 5) return 'spring';
  if (m === 12 || m <= 2) return 'winter';
  return m >= 9 ? 'autumn' : 'summer';
}
const DRIZZLE_LABEL = { meiyu: '梅雨绵绵', spring: '春雨如酥', winter: '冬雨清寒', autumn: '秋雨潇潇', summer: '细雨霏霏' };
export const drizzleLabel = (doy) => DRIZZLE_LABEL[drizzleKind(doy)];

/* ── 节令挂钩（审查 B4 / B5）：灯会、烟花仍可手动随时开，但在"对的季节"开时把日子拨到节日当天 ——
   于是月相自动对上（上元 / 中秋是望月，除夕是朔月无月），花历也对上（上元红梅正开）。
   2027 年：春节 2/6 ⇒ 除夕 2/5、上元 2/20；中秋 9/15（与 12h-solar 的月相公式互验：望 0.47~0.48、朔 ≈1.0）。 */
export const FESTIVAL_DAYS = {
  shangyuan: { label: '上元灯会·正月十五', doy: doyOf(2, 20), season: 'winter', kind: 'lantern' },
  zhongqiu:  { label: '中秋赏月·八月十五', doy: doyOf(9, 15), season: 'autumn', kind: 'lantern' },
  chuxi:     { label: '除夕烟花·辞旧迎新', doy: doyOf(2, 5),  season: 'winter', kind: 'fireworks' },
};
/* 当前季节下某类节庆对应哪个节日（没有就 null ⇒ 只开景、不拨日子）。 */
export function festivalFor(kind, season){
  for (const k in FESTIVAL_DAYS){
    const f = FESTIVAL_DAYS[k];
    if (f.kind === kind && f.season === season) return { id: k, ...f };
  }
  return null;
}
