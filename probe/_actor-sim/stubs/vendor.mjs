// 桩：vendor.js（真 three 来自 node_modules；GLTFLoader 不加载任何东西）
import * as THREE from 'three';
export { THREE };
export class GLTFLoader { load(){ /* 纯 node 仿真不装 GLB：演员由 sim.mjs 直接造 */ } }
