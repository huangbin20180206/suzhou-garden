// 人物导演层的运行步长与到访天气：使用与重播网相同的假场景，不启动浏览器。
// 运行：node --import ./probe/_actor-sim/register.mjs --test probe/actor-tick-unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { camera, ENV, scene, SIM_CAR, loadSim, runVisit } from './_actor-sim/sim.mjs';
import * as THREE from 'three';
import { stableTravel } from './_actor-sim/stubs/stable.mjs';

const A = await loadSim('carriage');
await runVisit(A, { maxSteps: 1 });  // 创建演员；仍在 idle 等待开演

test('100ms 一帧：导演层应推进完整 100ms', () => {
  assert.equal(A.VISIT.phase, 'idle');
  const before = A.VISIT.t;
  A.tickActors(0.1);
  assert.ok(Math.abs(A.VISIT.t - before - 0.1) < 1e-8,
    `导演层只推进了 ${(A.VISIT.t - before).toFixed(3)}s`);
});

test('普通帧、负时间与超长帧仍遵守原来的 100ms 上限', () => {
  let before = A.VISIT.t;
  A.tickActors(0.016);
  assert.ok(Math.abs(A.VISIT.t - before - 0.016) < 1e-8);
  before = A.VISIT.t;
  A.tickActors(-1);
  assert.equal(A.VISIT.t, before);
  A.tickActors(1);
  assert.ok(Math.abs(A.VISIT.t - before - 0.1) < 1e-8);
});

test('到访只在太阳实际升起后的原定时段开演', () => {
  ENV.weather = 'clear';
  ENV.doy = 22;                         // 冬季代表日 1/22
  ENV.hour = 17.5;                      // 苏州此日已日落
  assert.equal(A.visitWeatherOK(), false, '冬季日落后不应开演');
  ENV.hour = 12;
  assert.equal(A.visitWeatherOK(), true, '冬季正午晴天应可开演');
  ENV.doy = 191;                        // 夏季代表日 7/10
  ENV.hour = 18;
  assert.equal(A.visitWeatherOK(), true, '夏季 18 点仍在白昼和原定时段内');
  ENV.hour = 6.99;
  assert.equal(A.visitWeatherOK(), false, '不放宽原有 7 点之后才开始的约定');
  ENV.hour = 10;
});

test('刚切细雨、雨量尚未升起时，不应开始到访', () => {
  ENV.weather = 'drizzle';
  ENV.cur.rainAmount = 0;
  A.actorStep(2);
  assert.equal(A.VISIT.phase, 'idle');
  ENV.weather = 'clear';
  A.actorStep(0.2);
  assert.notEqual(A.VISIT.phase, 'idle', '放晴后应允许开演');
});

test('停车后继续更新辕马姿势，以便腿回到站姿', () => {
  let n = 0;
  while (A.VISCAR.state !== 'stop' && n++ < 2000) A.actorStep(0.1);
  assert.equal(A.VISCAR.state, 'stop', '应进入停车阶段');
  const travel = stableTravel();
  travel.slots = [{ life: { gaitW: 1 } }];  // 模拟停车瞬间仍在迈步的辕马
  const before = SIM_CAR.places;
  A.actorStep(0.1);
  travel.slots = [];
  assert.ok(SIM_CAR.places > before, '停车时未再更新车与辕马的姿势');
});

test('并肩走过转角时，单帧不能横向跳位', () => {
  let n = 0;
  while (A.VISIT.phase !== 'pair' && n++ < 10000) A.actorStep(0.2);
  assert.equal(A.VISIT.phase, 'pair', '应进入并肩同行');
  const host = A.ACTORS.find(a => a.def.id === 'scholar');
  const guest = A.ACTORS.find(a => a.def.id === 'guest');
  let worst = 0, minGap = Infinity, frames = 0;
  while (A.VISIT.phase === 'pair' && frames++ < 15000){
    const before = [host, guest].map(a => [a.pos.x, a.pos.z]);
    A.actorStep(1 / 60);
    for (let i = 0; i < 2; i++){
      const a = [host, guest][i];
      worst = Math.max(worst, Math.hypot(a.pos.x - before[i][0], a.pos.z - before[i][1]));
    }
    minGap = Math.min(minGap, Math.hypot(host.pos.x - guest.pos.x, host.pos.z - guest.pos.z));
  }
  assert.ok(frames > 10 && frames < 15000, '并肩段应走完');
  // 日常速度 0.93m/s；60Hz 下 8cm/帧已超过正常一步约 5 倍，用于抓瞬移而非限制小幅摆动。
  assert.ok(worst <= 0.08, `单帧最大水平位移 ${worst.toFixed(3)}m`);
  assert.ok(minGap >= 0.70, `两人最小间距 ${minGap.toFixed(3)}m`);
});

test('驶离的里程从驶入终点继续，不重置车轮相位', () => {
  let n = 0;
  while (A.VISCAR.state !== 'board' && n++ < 10000) A.actorStep(0.2);
  assert.equal(A.VISCAR.state, 'board', '应进入上车阶段');
  const arrival = A.VISCAR.s;
  while (A.VISCAR.state !== 'driveout' && n++ < 12000) A.actorStep(0.1);
  assert.equal(A.VISCAR.state, 'driveout', '应进入驶离阶段');
  assert.ok(Math.abs(A.VISCAR.odo - arrival) < 0.5,
    `驶入末里程 ${arrival.toFixed(2)}m，驶离里程 ${A.VISCAR.odo.toFixed(2)}m`);
});

test('高精仕女继承原角色的晨间与天气显隐', () => {
  const lady = A.ACTORS.find(a => a.def.id === 'lady');
  assert.ok(lady);
  ENV.hour = 8; ENV.weather = 'clear'; A.tickActors(1 / 60);
  assert.equal(lady.holder.visible, true, '晴朗早晨应出现');
  ENV.hour = 13; A.tickActors(1 / 60);
  assert.equal(lady.holder.visible, false, '午后应退场');
  ENV.hour = 8; ENV.weather = 'storm'; A.tickActors(1 / 60);
  assert.equal(lady.holder.visible, false, '暴雨应退场');
  ENV.weather = 'snow'; A.tickActors(1 / 60);
  assert.equal(lady.holder.visible, false, '下雪应退场');
  ENV.weather = 'clear'; A.tickActors(1 / 60);
  assert.equal(lady.holder.visible, true, '天气恢复后应出现');
});

test('主人近镜头复位时先隐藏，再按延时恢复', () => {
  const host = A.ACTORS.find(a => a.def.id === 'scholar');
  host.holder.visible = true;
  host.holder.getWorldPosition(camera.position);
  camera.position.z += 1;
  A.VISIT.phase = 'done'; A.VISIT.t = 45;
  A.actorStep(0.02);
  assert.equal(A.VISIT.phase, 'idle');
  assert.equal(host.holder.visible, false, '复位当帧不应提前显现');
  A.actorStep(1);
  assert.equal(host.holder.visible, true, '避镜头计时结束后应恢复');
});

test('近镜头复位马车时，不隐藏整个马厩', () => {
  const travel = stableTravel();
  const stable = new THREE.Group(), otherHorse = new THREE.Group();
  scene.add(stable); stable.add(travel.car, otherHorse);
  travel.group = stable;
  travel.blob = new THREE.Group(); stable.add(travel.blob);
  travel.slots = [{ group: new THREE.Group() }]; stable.add(travel.slots[0].group);
  camera.position.set(0, 1, 1);
  A.VISIT.phase = 'done'; A.VISIT.t = 45;
  A.actorStep(0.02);
  assert.equal(stable.visible, true, '马厩根组应保持可见');
  assert.equal(otherHorse.visible, true, '无关马匹应保持可见');
  assert.equal(travel.car.visible, false, '复位的马车应暂时隐藏');
  A.actorStep(1);
  assert.equal(travel.car.visible, true, '马车延时后应恢复');
});
