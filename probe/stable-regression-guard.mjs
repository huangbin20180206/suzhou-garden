// 马厩回归：真实 GLB 的坐标、脸手掩膜、缰绳、车厢与取草避障。
// @guards: src/15b-horse-rig.js, src/15c-horse-life.js, src/15d-carriage.js, src/15e-stable.js, src/16-actors.js
// 运行：node probe/stable-regression-guard.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchChromium, makeStaticServer, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = makeStaticServer(ROOT);
const port = await listenEphemeral(server);
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`); };
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=low&intro=0`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && window.__garden.bootDone()
    && window.__garden.horseLifeDebug().length === 6 && window.__garden.actorRig('groom')
    && window.__garden.actorRig('laborer'), null, { timeout: 180000 });
  const data = await page.evaluate(async () => {
    const g = window.__garden, T = g.THREE;
    const { makeCarriage } = await import('/src/15d-carriage.js');
    const nav = await import('/src/16-actors.js');
    const horses = g.horseLifeDebug().map(h => {
      let node = null; h.group.traverse(o => { if (o.isMesh && o.material?.userData?.rig) node = o; });
      if (!node) return { role: h.role, error: '没有伪蒙皮网格' };
      const geo = node.geometry, p = geo.attributes.position, a = geo.attributes.aRigA, b = geo.attributes.aRigB;
      let head = 0, front = 0, hind = 0, minHoofY = Infinity, hoofHead = 0;
      for (let i = 0; i < p.count; i++){
        if (a.getX(i) > 0.05) head++;
        if (a.getZ(i) > 0.05 || a.getW(i) > 0.05) front++;
        if (b.getX(i) > 0.05 || b.getY(i) > 0.05) hind++;
        if (p.getY(i) < 0.10){ minHoofY = Math.min(minHoofY, p.getY(i)); hoofHead = Math.max(hoofHead, a.getX(i)); }
      }
      geo.computeBoundingBox();
      const sh = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
        fragmentShader: '#include <common>\n#include <map_fragment>' };
      node.material.onBeforeCompile(sh);
      return { role: h.role, type: p.array.constructor.name, height: geo.boundingBox.max.y - geo.boundingBox.min.y,
        head, front, hind, minHoofY, hoofHead, nose: h.nose,
        liftScale: sh.uniforms.uFrontLiftScale?.value, shaderHalf: sh.vertexShader.includes('mix(transformed.y, q.y, uFrontLiftScale)') };
    });
    const actors = ['groom', 'laborer'].map(id => {
      const root = g.scene.getObjectByName('actor_' + id); let node = null;
      root.traverse(o => { if (o.isSkinnedMesh) node = o; });
      const geo = node.geometry, a = geo.attributes.aLivSkin, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
      const t = geo.attributes.aLivTone;
      const counts = { head: 0, left: 0, right: 0 }, tones = { head: 0, left: 0, right: 0 };
      for (let i = 0; i < a.count; i++){
        let k = 0; for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, k)) k = j;
        const n = node.skeleton.bones[si.getComponent(i, k)]?.name || '';
        const slot = n === 'Head' ? 'head' : (n.startsWith('Left') ? 'left' : (n.startsWith('Right') ? 'right' : ''));
        if (a.getX(i) >= 0.5 && slot) counts[slot]++;
        if (t && t.getX(i) >= 0.5 && slot) tones[slot]++;
      }
      return { id, ...counts, tones, matrix: !!node.material.userData.livU?.uLivToHolder };
    });
    const cars = [{ pair: true }, { detached: true }].map(opt => {
      const c = makeCarriage(opt); c.updateMatrixWorld(true);
      const b = new T.Box3().setFromObject(c.getObjectByName('carriageBed'));
      return { length: b.max.z - b.min.z, front: b.max.z, center: (b.min.z + b.max.z) / 2,
        wheels: c.userData.wheels.map(w => w.position.z), axle: c.getObjectByName('carriageAxle').position.z,
        seat: c.getObjectByName('carriageSeatPad').position.z };
    });
    const travel = g.stableTravel();
    const bridles = travel.slots.map(s => ({ bridle: !!s.bridle, reins: s.reins?.children.length || 0,
      ties: s.leadRope?.children.length || 0, attached: s.bridle?.head.parent === s.group,
      cheeks: ['bridleCheekLeft', 'bridleCheekRight', 'bridleCrown'].every(n => !!s.bridle?.head.getObjectByName(n)) }));
    // 停车并系在真实横杆的两个环上，不得跨院拉出几米长的线。
    const horseModule = await import('/src/15c-horse-life.js');
    g.travelCarriagePlace(40, 4, -2.868, 0);
    g.travelCarriageVisible(true);
    g.travelCarriageTied(true);
    horseModule.tickStableLife(0.016);
    const tiedRopes = travel.slots.map((slot, i) => {
      const expected = travel.group.localToWorld(travel.hitchPoints[travel.hitchPoints.length - 1 - i].clone());
      return slot.leadRope.children.map(line => {
        const p = line.geometry.attributes.position;
        const start = line.localToWorld(new T.Vector3().fromBufferAttribute(p, 0));
        const end = line.localToWorld(new T.Vector3().fromBufferAttribute(p, p.count - 1));
        return { distance: start.distanceTo(end), ringError: end.distanceTo(expected), start: start.toArray(), end: end.toArray(), horse: slot.group.getWorldPosition(new T.Vector3()).toArray() };
      });
    });
    g.travelCarriagePlace(60, 28, -2.868, 0);
    horseModule.tickStableLife(0.016);
    const farTiesHidden = travel.slots.every(s => !s.leadRope.visible && s.reins.visible);
    // 在实际到访停车位，检查往返路线；马和车的障碍使用场景中的实时位姿。
    g.travelCarriagePlace(40, 4, Math.PI, 0);
    const h = g.horseLifeDebug().find(x => x.role === 'graze'), P = h.group.getWorldPosition(new T.Vector3());
    const feed = [P.x + 1.45, P.z + 0.52], hay = [35.50, 0.20];
    const outward = nav.groomPath(feed, hay, h), back = nav.groomPath(hay, feed, h);
    const caps = nav.allHorseCapsules(null), carObstacles = nav.groomCars();
    const blockedOn = (route, target) => {
      if (!route) return -1; let n = 0;
      for (let i = 1; i < route.length; i++){
        const a = route[i - 1], b = route[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1]) / 0.04));
        for (let j = 1; j <= steps; j++){
          const t = j / steps;
          if (nav.groomOccupied(a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, caps, carObstacles, target)) n++;
        }
      }
      return n;
    };
    const offsetChecks = [];
    const oldPosition = h.group.position.clone();
    for (const d of [0, 0.25, 0.50, 0.75]){
      h.group.position.set(h.home.x + Math.sin(h.home.yaw) * d, oldPosition.y,
        h.home.z + Math.cos(h.home.yaw) * d);
      const p = h.group.getWorldPosition(new T.Vector3()), target = [p.x + 1.45, p.z + 0.52];
      offsetChecks.push({ d, to: !!nav.groomPath(target, hay, h), back: !!nav.groomPath(hay, target, h) });
    }
    h.group.position.copy(oldPosition);
    // 草料站被车占住时必须返回无路径，不能悄悄走直线。
    g.travelCarriagePlace(hay[0], hay[1], Math.PI, 0);
    const blockedGoal = nav.groomPath(feed, hay, h);
    g.travelCarriagePark();
    const stable = await import('/src/15c-horse-life.js');
    const states = new Set(); let unsafe = 0, sampled = 0;
    for (let i = 0; i < 500; i++){
      stable.tickStableLife(0.2); g.actorStep(0.2);
      const a = g.actorState().actors.find(x => x.id === 'groom');
      const visible = g.scene.getObjectByName('actor_groom')?.visible;
      if (!a || !visible) continue;
      states.add(a.chore);
      if (a.chore !== 'toHay' && a.chore !== 'back') continue;
      sampled++;
      if (nav.groomOccupied(a.pos[0], a.pos[2], nav.allHorseCapsules(null), nav.groomCars(), h)) unsafe++;
    }
    const lastActor = g.actorState().actors.find(x => x.id === 'groom');
    const lastHorse = h.group.getWorldPosition(new T.Vector3());
    const lastGoal = [lastHorse.x + 0.34, lastHorse.z + 0.52];
    const lastPath = nav.groomPath([lastActor.pos[0], lastActor.pos[2]], lastGoal, h);
    const lastCaps = nav.allHorseCapsules(null), lastCars = nav.groomCars();
    const lastBlocked = nav.groomOccupied(lastActor.pos[0], lastActor.pos[2], lastCaps, lastCars, h);
    return { horses, actors, cars, bridles, tiedRopes, farTiesHidden, outward, back, outwardBlocked: blockedOn(outward, h), backBlocked: blockedOn(back, h),
      offsetChecks, blockedGoal, run: { states: [...states], sampled, unsafe, lastActor, lastGoal, lastPath,
        lastBlocked, lastCaps, lastCar: g.actorVisit().car }, loopErrors: g.loopErrors() };
  });
  check('六匹马的顶点为米制浮点，头、前后腿权重非零', data.horses.length === 6 && data.horses.every(h => h.type === 'Float32Array'
    && Math.abs(h.height - 1.75) < 0.02 && h.head > 50 && h.front > 50 && h.hind > 50 && h.nose[2] < 2), JSON.stringify(data.horses));
  check('四蹄低处不再被当成头部参与低头旋转', data.horses.every(h => Math.abs(h.minHoofY) < 0.05 && h.hoofHead < 0.01),
    data.horses.map(h => `${h.role}: hoofY=${h.minHoofY?.toFixed(3)}, headWeight=${h.hoofHead?.toFixed(3)}`).join(' | '));
  check('两匹辕马前腿竖直位移系数为 0.5，其他马不缩', data.horses.every(h => h.shaderHalf
    && h.liftScale === (h.role === 'harnessed' ? 0.5 : 1)), data.horses.map(h => `${h.role}:${h.liftScale}`).join(' | '));
  check('马夫和车夫脸、左右手均有保护掩膜', data.actors.every(a => a.head > 20 && a.left > 10 && a.right > 10 && a.matrix), JSON.stringify(data.actors));
  /* 2026-11-02 老黄："马夫的脸和手依旧是那种泥土的颜色，不符合中国人的皮肤颜色特点"。
     肤色重映射掩膜必须真的盖到脸与双手（否则贴图那块土黄棕原样露出来）。 */
  check('马夫和车夫脸、左右手均有肤色重映射掩膜',
    data.actors.every(a => a.tones.head > 20 && a.tones.left > 10 && a.tones.right > 10),
    JSON.stringify(data.actors.map(a => ({ id: a.id, tones: a.tones }))));
  check('两驾车厢延长 1.5 倍，车轮和车轴位于厢体中部', data.cars.every(c => Math.abs(c.length - 2.43) < 0.001
    && Math.abs(c.front - 0.75) < 0.001 && Math.abs(c.seat - 0.93) < 0.001
    && c.wheels.length === 2 && c.wheels.every(z => Math.abs(z - c.center) < 0.001)
    && Math.abs(c.axle - c.center) < 0.001), JSON.stringify(data.cars));
  check('两匹辕马均有鼻箍、对称颊带和左右缰绳', data.bridles.length === 2 && data.bridles.every(b => b.bridle && b.attached && b.cheeks && b.reins === 2 && b.ties === 2), JSON.stringify(data.bridles));
  check('系绳接在实际横杆的环上，不横跨院子', data.tiedRopes.length === 2 && data.tiedRopes.every(pair => pair.length === 2
    && pair.every(r => r.ringError < 0.01 && r.distance < 1.75)), JSON.stringify(data.tiedRopes));
  check('马远离横杆后不显示被拉长的系绳', data.farTiesHidden, String(data.farTiesHidden));
  check('车停靠后，取草往返路线可达且不穿马车/马/围栏', !!data.outward && !!data.back
    && data.outwardBlocked === 0 && data.backBlocked === 0, JSON.stringify({ to: data.outward, back: data.back, blocked: [data.outwardBlocked, data.backBlocked] }));
  check('白马走动四个位置，取草路线仍可往返', data.offsetChecks.every(x => x.to && x.back), JSON.stringify(data.offsetChecks));
  check('草料站被车占住时不规划穿模直线', data.blockedGoal === null, JSON.stringify(data.blockedGoal));
  check('真实动作中取草往返时没有进入障碍', data.run.states.includes('toHay') && data.run.states.includes('back')
    && data.run.sampled > 0 && data.run.unsafe === 0, JSON.stringify(data.run));
  check('零页面与循环错误', errors.length === 0 && data.loopErrors.count === 0, JSON.stringify({ errors, loop: data.loopErrors }));
} finally {
  await browser.close(); await new Promise(r => server.close(r));
}
const bad = checks.filter(c => !c.ok);
console.log(`\n[stable-regression-guard] ${bad.length ? bad.length + ' FAILED' : 'ALL PASS'}（${checks.length} 项）`);
process.exit(bad.length ? 1 : 0);
