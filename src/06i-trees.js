// 06i-trees.js — 门面（facade）。
// 实现已按职责整块拆到：06k-willow.js / 06l-orchard.js / 06m-banana.js
// 对外接口与拆分前**完全一致**（11 个导出，逐个核对过）：消费方的 import 路径与名字都不用改。
// ⚠️ 门面必须写成「先 import 再 export」，不能写 export { X } from '...' ——
//    probe/import-audit 会把后者的名字判成「用到但没 import」的假红（12-env 上实测过）。
// ⚠️ export 块**末尾不要留逗号**：审计的 /^export\s*\{([^}]*)\}/ 会把尾逗号后的空串当成一个
//    名叫 "" 的导出，于是每个文件都被判成「用到本文件导出的（空名）但没 import」——实测一次炸 61 条假红。
import { makeWillow, tubeRadiusRamp } from './06k-willow.js';
import { treeLanternInsts, TREE_LANTERN_MAT, makePeachTree, makePlumTree, makeOrchidPot } from './06l-orchard.js';
import { makeBananaLeafCrown, makeBananaPlant, makeLotusPod, makeWaterGrass } from './06m-banana.js';

export {
  makeWillow,
  treeLanternInsts,
  TREE_LANTERN_MAT,
  makePeachTree,
  makePlumTree,
  makeOrchidPot,
  makeBananaLeafCrown,
  makeBananaPlant,
  makeLotusPod,
  makeWaterGrass,
  tubeRadiusRamp
};
