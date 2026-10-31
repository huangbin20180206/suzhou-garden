// 桩：02-scene。场景里放一块地面 + 两块"台基"，让踏面射线有东西可打（新旧版本同一份）。
import * as THREE from 'three';
export const scene = new THREE.Scene();
export const renderer = { shadowMap: { needsUpdate: false } };
export const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 2000);
camera.position.set(0, 400, 0); camera.lookAt(0, 500, 0);      // 默认朝天：任何复位都"看不见"
camera.updateMatrixWorld(true);
const mat = new THREE.MeshBasicMaterial();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), mat);
ground.position.y = -0.05; ground.name = 'simGround';
const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.0, 9.2), mat);
bridge.position.set(8.4, 0.8, 4.5); bridge.name = 'simBridge';           // 顶 1.30
const hall = new THREE.Mesh(new THREE.BoxGeometry(12, 1.0, 9.6), mat);
hall.position.set(0, 0.74, -11.2); hall.name = 'simHall';                // 顶 1.24
scene.add(ground, bridge, hall);
scene.updateMatrixWorld(true);
