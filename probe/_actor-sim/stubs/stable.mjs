// 桩：15-stable 门面。马车只是一个 Object3D：place 写位置、返回 {x,y,z,yaw}；
// 马（HORSE_LIFE）为空 ⇒ 常驻马夫的杂役状态机原地待命（不影响到访导演层）。
import * as THREE from 'three';
import { scene } from './scene.mjs';
import { groundHeight } from './water.mjs';
export { STABLE_ROAD_PTS } from '../../../src/15a-shared.js';
const car = new THREE.Group(); car.name = 'simCar'; scene.add(car);
export const SIM_CAR = { car, visible: true, tied: false, parks: 0, places: 0 };
const TRAVEL = { ready: true, car, group: car, slots: [] };
export function stableTravel(){ return TRAVEL.ready ? TRAVEL : null; }
export function travelCarriagePlace(x, z, yaw, dist){
  SIM_CAR.places++;
  const y = groundHeight(x, z) + 0.075;
  car.position.set(x, y, z); car.rotation.y = yaw;
  return { x, y, z, yaw, dist };
}
export function travelCarriagePark(){ SIM_CAR.parks++; car.position.set(38.0, 0, -1.0); car.rotation.y = 0; }
export function travelCarriageVisible(v){ SIM_CAR.visible = !!v; car.visible = !!v; }
export function travelCarriageTied(v){ SIM_CAR.tied = !!v; }
export function horseLifeDebug(){ return []; }
export function holdHorse(){}
