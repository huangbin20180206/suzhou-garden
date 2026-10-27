// 15a-shared.js — 由 15-stable.js 按职责整块搬出（纯搬家，逐字节未改）。
// 两件被「马」与「马厩」两条线共用的无状态小工具：
//   1) prRange —— 把 mulberry32 的 ()[0,1) 包成 (min,max) 区间映射；
//   2) makeSoftAlphaTex —— 贴地软阴影用的径向 alpha 贴图。
// 放在最上游，避免 15b/15c/15e 互相 import 成环。
// ⚠️ 2026-10-27 复核 B2：石板路两张点表（STABLE_ROAD_PTS / STABLE_EXIT_PTS）也住这里 ——
//    它们原本定义在 15e，而 15d（马车贴地判别）为了避开 15e 的环把同样的数字手抄了一份
//    （_ROAD_A/_ROAD_B）。两份手抄只要改一处忘一处，马车就会浮空/陷地。现在单份定义
//    在最上游的 15a，15d/15e 都从这里 import，谁也不许再抄。
import { THREE } from '../vendor.js';
export const prRange = (prng) => (a, b) => a + prng() * (b - a);

/* 马厩 → 园门的花街铺地中线（15e 铺路 + 15d 马车贴地判别共用，唯一真值） */
export const STABLE_ROAD_PTS = [
  [40.0, 4.2], [39.2, 10.5], [37.4, 16.5], [34.4, 21.8], [30.0, 26.2],
  [22.0, 27.2], [10.0, 26.4], [3.0, 26.0], [0.5, 25.9], [0.0, 24.55],
];
/* 出园新路：院门 → 东南 → 一路出画（到访马车驶入/驶离走这条，唯一真值） */
export const STABLE_EXIT_PTS = [
  [40.0, 4.2], [40.9, 7.2], [42.4, 10.2], [44.6, 13.4], [47.6, 16.8],
  [51.4, 20.6], [56.0, 24.8], [61.6, 29.4], [68.4, 34.6], [76.4, 40.4], [85.0, 46.8],
];

/* 径向柔和 alpha（中心不透明、边缘渐隐）——与雨后水膜同一套做法。
   ⚠️ 2026-10-27：支持自定义渐变停点（不传=旧版四停点，逐字节不变）。 */
export function makeSoftAlphaTex(stops){
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  for (const [o, a] of (stops || [[0.00, 'rgba(255,255,255,1)'],
                                  [0.55, 'rgba(255,255,255,0.95)'],
                                  [0.80, 'rgba(255,255,255,0.45)'],
                                  [1.00, 'rgba(255,255,255,0)']])){
    grd.addColorStop(o, a);
  }
  ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
