// 15-stable.js — 门面（facade）。
// 实现已按职责整块拆到：15a-shared.js / 15b-horse-rig.js / 15c-horse-life.js / 15d-carriage.js / 15e-stable.js
// 对外接口与拆分前**完全一致**（21 个导出，逐个核对过）：消费方（08-assemble / 11-loop /
// 16-actors / 08b-figures）的 import 路径与名字都不用改。
// ⚠️ 门面必须写成「先 import 再 export」，不能写 export { X } from '...' ——
//    probe/import-audit 会把后者的名字判成「用到但没 import」的假红（12-env 上实测过）。
// ⚠️ export 块**末尾不要留逗号**：审计的 /^export\s*\{([^}]*)\}/ 会把尾逗号后的空串当成一个
//    名叫 "" 的导出，于是**每个文件**都被判成「用到 15-stable.js 导出的 （空名）但没 import」——
//    实测一次炸出 61 条假红。
import { decorateHorseGeometry, horseWeights, horsePivots, bakeHorseShading } from './15b-horse-rig.js';
import { horseLifeDebug, horseLifeState, holdHorse, tinkerPoseDebug, horseBreathMesh, tickStableLife, loadStableHorses, makeHorse } from './15c-horse-life.js';
import { stableTravel, travelCarriagePlace, travelCarriagePark, travelCarriageVisible, travelCarriageTied, makeCarriage, makeFeedBale } from './15d-carriage.js';
import { STABLE_ROAD_PTS, makeStableRoad, makeStable, STABLE_EXIT_PTS, makeStableExitRoad } from './15e-stable.js';

export {
  decorateHorseGeometry,
  horseWeights,
  horsePivots,
  bakeHorseShading,
  horseLifeDebug,
  horseLifeState,
  holdHorse,
  tinkerPoseDebug,
  horseBreathMesh,
  tickStableLife,
  loadStableHorses,
  makeHorse,
  stableTravel,
  travelCarriagePlace,
  travelCarriagePark,
  travelCarriageVisible,
  travelCarriageTied,
  makeCarriage,
  makeFeedBale,
  STABLE_ROAD_PTS,
  makeStableRoad,
  STABLE_EXIT_PTS,
  makeStableExitRoad,
  makeStable
};
