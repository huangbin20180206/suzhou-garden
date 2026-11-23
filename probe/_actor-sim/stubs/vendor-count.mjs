// 计数版 vendor 桩（probe/perf-sim-bench.mjs 用，2026-11-24 · 第 5 批）：
// THREE 的数学类换成"构造时计数"的子类，原型上的 clone() 也计数 ⇒ 读出每帧 new / clone 次数。
// 只在 bench 的子进程里通过 register-count.mjs 换上；重播网 / 单测仍用 vendor.mjs（不受影响）。
import * as T from 'three';
export const ALLOC = globalThis.__ALLOC = { on: false, ctor: 0, clone: 0 };
const NAMES = ['Vector2', 'Vector3', 'Vector4', 'Color', 'Quaternion', 'Matrix3', 'Matrix4', 'Euler', 'Box3', 'Sphere', 'Ray', 'Plane', 'Frustum', 'Raycaster'];
const THREE = { ...T };
for (const n of NAMES){
  const Base = T[n];
  THREE[n] = { [n]: class extends Base { constructor(...a){ super(...a); if (ALLOC.on) ALLOC.ctor++; } } }[n];
  const oc = Base.prototype.clone;
  if (oc) Base.prototype.clone = function(){ if (ALLOC.on && this.constructor === Base) ALLOC.clone++; return oc.apply(this, arguments); };
}
export { THREE };
export class GLTFLoader { load(){} }
