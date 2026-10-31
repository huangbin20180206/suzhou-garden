// 桩：01-materials（真模块顶层建 Canvas 纹理，node 下不可用）
import * as THREE from 'three';
export const MAT = new Proxy({}, { get: () => new THREE.MeshBasicMaterial() });
