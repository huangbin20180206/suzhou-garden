// 桩：14-props。PROP_SPOTS 的三处站位与 QIN_LOW_SEAT 从真源码里按字面量抽出（不另抄一份）。
import fs from 'node:fs';
const SRC = fs.readFileSync(new URL('../../../src/14-props.js', import.meta.url), 'utf8');
function objLit(name){
  const i = SRC.indexOf('const ' + name + ' = {');
  let j = SRC.indexOf('{', i), d = 0;
  for (let k = j; k < SRC.length; k++){
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}' && --d === 0) return SRC.slice(j, k + 1);
  }
  throw new Error('props stub: ' + name);
}
const QIN_LOW = new Function('return ' + objLit('QIN_LOW'))();
export const QIN_LOW_SEAT = {
  x: +(QIN_LOW.x - QIN_LOW.seatBack * Math.sin(QIN_LOW.yaw) + QIN_LOW.seatOut * Math.cos(QIN_LOW.yaw)).toFixed(4),
  z: +(QIN_LOW.z - QIN_LOW.seatBack * Math.cos(QIN_LOW.yaw) - QIN_LOW.seatOut * Math.sin(QIN_LOW.yaw)).toFixed(4),
  y: QIN_LOW.y, yaw: +QIN_LOW.yaw.toFixed(4),
};
export const PROP_SPOTS = {
  stoneTable: { x: 15.4, z: 7.0, yaw: 0.55, y: 0.62 },
  well: { x: -20.4, z: -6.1, y: -0.131, yaw: 0.22 },
  ladyWell: { x: -19.2, z: -5.2, y: -0.174 },
};
export const SEAT_SPOTS = [
  { x: 14.7, z: 6.6, y: 0.62, yaw: 0.9 }, { x: 15.9, z: 6.3, y: 0.62, yaw: 2.4 },
  { x: 16.1, z: 7.4, y: 0.62, yaw: -2.2 }, { x: 14.9, z: 7.7, y: 0.62, yaw: -0.7 },
];
