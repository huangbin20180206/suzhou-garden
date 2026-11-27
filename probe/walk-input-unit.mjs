// @guards: src/11a-walk.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from '../vendor.js';
import { createWalk } from '../src/11a-walk.js';

class FakeTarget {
  constructor(){ this.listeners = new Map(); this.style = {}; this.hidden = false; this.children = []; this.captures = new Set(); }
  addEventListener(type, fn){ const a = this.listeners.get(type) || []; a.push(fn); this.listeners.set(type, a); }
  dispatch(type, init = {}){
    const e = { type, target:this, pointerId:1, pointerType:'touch', button:0, clientX:0, clientY:0,
      movementX:0, movementY:0, preventDefault(){}, stopImmediatePropagation(){}, ...init };
    for (const fn of this.listeners.get(type) || []) fn(e);
    return e;
  }
  appendChild(child){ this.children.push(child); return child; }
  setPointerCapture(id){ this.captures.add(id); }
}

function fixture(){
  const old = new Map();
  for (const key of ['document','window','matchMedia','addEventListener','innerWidth','innerHeight'])
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const win = new FakeTarget(); win.ontouchstart = null;
  const doc = new FakeTarget(); doc.hidden = false; doc.body = new FakeTarget();
  doc.createElement = () => new FakeTarget(); doc.querySelector = () => null;
  Object.assign(globalThis, { document:doc, window:win, matchMedia:()=>({matches:true}),
    addEventListener:win.addEventListener.bind(win), innerWidth:390, innerHeight:844 });
  const canvas = new FakeTarget(), camera = new THREE.PerspectiveCamera();
  const world = new THREE.Group();
  const controls = { target:new THREE.Vector3(), enabled:true };
  const walk = createWalk({ camera, controls, world, canvas, groundHeight:()=>0, insidePond:()=>false, stop:()=>{} });
  walk.start();
  return {
    canvas, camera, doc, win, walk,
    finish(){ walk.end(); for (const [key, descriptor] of old) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    } },
  };
}
function movedYaw(f, downId, moveId = downId){
  f.canvas.dispatch('pointerdown', { pointerId:downId, pointerType:'touch', clientX:300, clientY:400 });
  f.canvas.dispatch('pointermove', { pointerId:moveId, pointerType:'touch', clientX:330, clientY:400 });
  f.walk.update(0);
}
function angle(a, b){ return a.angleTo(b); }

test('window blur releases a held right-zone touch look pointer', () => {
  const f = fixture();
  try {
    movedYaw(f, 7);
    const before = f.camera.quaternion.clone();
    f.win.dispatch('blur'); // 模拟切后台时无 pointerup / pointercancel
    f.canvas.dispatch('pointerdown', { pointerId:9, pointerType:'touch', clientX:300, clientY:400 });
    f.canvas.dispatch('pointermove', { pointerId:9, pointerType:'touch', clientX:330, clientY:400 });
    f.walk.update(0);
    assert.ok(angle(before, f.camera.quaternion) > 0.01, '新触摸应重新取得右区转向');
  } finally { f.finish(); }
});

test('hidden visibility releases a held right-zone touch look pointer', () => {
  const f = fixture();
  try {
    movedYaw(f, 7);
    const before = f.camera.quaternion.clone();
    f.doc.hidden = true;
    f.doc.dispatch('visibilitychange'); // 模拟切后台时未结束旧 pointer
    f.canvas.dispatch('pointerdown', { pointerId:9, pointerType:'touch', clientX:300, clientY:400 });
    f.canvas.dispatch('pointermove', { pointerId:9, pointerType:'touch', clientX:330, clientY:400 });
    f.walk.update(0);
    assert.ok(angle(before, f.camera.quaternion) > 0.01, '恢复后新触摸应可转向');
  } finally { f.finish(); }
});

test('lostpointercapture releases touch look ownership', () => {
  const f = fixture();
  try {
    movedYaw(f, 7);
    const before = f.camera.quaternion.clone();
    f.canvas.dispatch('lostpointercapture', { pointerId:7, pointerType:'touch' });
    f.canvas.dispatch('pointerdown', { pointerId:9, pointerType:'touch', clientX:300, clientY:400 });
    f.canvas.dispatch('pointermove', { pointerId:9, pointerType:'touch', clientX:330, clientY:400 });
    f.walk.update(0);
    assert.ok(angle(before, f.camera.quaternion) > 0.01, '丢失捕获后应释放旧 lookId');
  } finally { f.finish(); }
});

test('pointercancel ends right-button camera drag', () => {
  const f = fixture();
  try {
    f.canvas.dispatch('pointerdown', { pointerId:4, pointerType:'mouse', button:2 });
    f.canvas.dispatch('pointermove', { pointerId:4, pointerType:'mouse', movementX:24, movementY:0 });
    f.walk.update(0);
    const before = f.camera.quaternion.clone();
    f.canvas.dispatch('pointercancel', { pointerId:4, pointerType:'mouse', button:2 });
    f.canvas.dispatch('pointermove', { pointerId:4, pointerType:'mouse', movementX:24, movementY:0 });
    f.walk.update(0);
    assert.ok(angle(before, f.camera.quaternion) < 1e-8, '取消后鼠标移动不应继续改变视线');
  } finally { f.finish(); }
});

test('lostpointercapture ends right-button camera drag', () => {
  const f = fixture();
  try {
    f.canvas.dispatch('pointerdown', { pointerId:4, pointerType:'mouse', button:2 });
    f.canvas.dispatch('pointermove', { pointerId:4, pointerType:'mouse', movementX:24, movementY:0 });
    f.walk.update(0);
    const before = f.camera.quaternion.clone();
    f.canvas.dispatch('lostpointercapture', { pointerId:4, pointerType:'mouse', button:2 });
    f.canvas.dispatch('pointermove', { pointerId:4, pointerType:'mouse', movementX:24, movementY:0 });
    f.walk.update(0);
    assert.ok(angle(before, f.camera.quaternion) < 1e-8, '失去捕获后鼠标移动不应继续改变视线');
  } finally { f.finish(); }
});

test('right look capture loss leaves the left joystick active', () => {
  const f = fixture();
  try {
    f.canvas.dispatch('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:400 });
    f.canvas.dispatch('pointermove', { pointerId:1, pointerType:'touch', clientX:100, clientY:370 });
    f.walk.update(0.1);
    const beforeZ = f.camera.position.z;
    f.canvas.dispatch('pointerdown', { pointerId:2, pointerType:'touch', clientX:300, clientY:400 });
    f.canvas.dispatch('lostpointercapture', { pointerId:2, pointerType:'touch' });
    f.canvas.dispatch('pointermove', { pointerId:1, pointerType:'touch', clientX:100, clientY:340 });
    f.walk.update(0.1);
    assert.ok(f.camera.position.z < beforeZ - 0.05, '右区丢捕获不能清除左区移动量');
  } finally { f.finish(); }
});

test('left joystick capture loss leaves the right look active', () => {
  const f = fixture();
  try {
    f.canvas.dispatch('pointerdown', { pointerId:2, pointerType:'touch', clientX:300, clientY:400 });
    f.canvas.dispatch('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:400 });
    f.canvas.dispatch('lostpointercapture', { pointerId:1, pointerType:'touch' });
    const before = f.camera.quaternion.clone();
    f.canvas.dispatch('pointermove', { pointerId:2, pointerType:'touch', clientX:330, clientY:400 });
    f.walk.update(0);
    assert.ok(angle(before, f.camera.quaternion) > 0.01, '左区丢捕获不能清除右区 lookId');
  } finally { f.finish(); }
});

test('untracked pointercancel does not end active right-button drag', () => {
  const f = fixture();
  try {
    f.canvas.dispatch('pointerdown', { pointerId:4, pointerType:'mouse', button:2 });
    f.canvas.dispatch('pointermove', { pointerId:4, pointerType:'mouse', movementX:24, movementY:0 });
    f.walk.update(0);
    const before = f.camera.quaternion.clone();
    f.canvas.dispatch('pointercancel', { pointerId:99, pointerType:'touch' });
    f.canvas.dispatch('pointermove', { pointerId:4, pointerType:'mouse', movementX:24, movementY:0 });
    f.walk.update(0);
    assert.ok(angle(before, f.camera.quaternion) > 0.01, '无关 pointerId 的取消不能结束右键拖动');
  } finally { f.finish(); }
});
