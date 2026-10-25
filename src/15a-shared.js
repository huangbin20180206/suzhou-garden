// 15a-shared.js — 由 15-stable.js 按职责整块搬出（纯搬家，逐字节未改）。
// 两件被「马」与「马厩」两条线共用的无状态小工具：
//   1) prRange —— 把 mulberry32 的 ()[0,1) 包成 (min,max) 区间映射；
//   2) makeSoftAlphaTex —— 贴地软阴影用的径向 alpha 贴图。
// 放在最上游，避免 15b/15c/15e 互相 import 成环。
import { THREE } from '../vendor.js';
export const prRange = (prng) => (a, b) => a + prng() * (b - a);

/* 径向柔和 alpha（中心不透明、边缘渐隐）——与雨后水膜同一套做法 */
export function makeSoftAlphaTex(){
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grd.addColorStop(0.00, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.80, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
