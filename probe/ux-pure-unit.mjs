// 交互体验纯函数单测（2026-11-24 · 第 4 批）· node --test probe/ux-pure-unit.mjs
// 守 src/00c-ux.js：分享链接编解码 / 省电降档判据 / 减弱动效开关 / 音量持久化 /
// 驻足卡冷却与关闭手势 / 触屏摇杆死区与曲线 / 首访小红点记账。零浏览器、<0.2s。
// 为什么能在 node 里跑：00c-ux 没有任何 import、模块期只做 typeof 兜底的探测（见其头注释）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMotionParam, resolveReducedMotion, MOTION, autoFlyDur, REDUCED_FLY_DUR, lightningFlashGain,
  batteryShouldDowngrade, parseSoundPrefs, serializeSoundPrefs, parseSeen, serializeSeen, SEEN_ENTRIES,
  VISTA_COOLDOWN_MS, vistaMayShow, classifyCardGesture, pickVistaSpot, VISTA_HOLD_MS,
  stickResponse, combineMove, STICK_RADIUS, STICK_DEAD,
  encodeView, decodeView,
} from '../src/00c-ux.js';

const OPTS = { seasons:['spring','summer','autumn','winter'],
               weathers:['clear','storm','afterrain','snow','mist','drizzle','snowclear'] };

test('分享链接：编码再解码 = 原景（精度 2 位）', () => {
  const v = { season:'autumn', hour:17.256, weather:'mist', doy:290,
              cam:[12.304, 4.6, 18], tgt:[0, 3.6, -12.004] };
  const h = encodeView(v);
  assert.match(h, /^v=1&s=autumn&h=17\.26&w=mist&d=290&c=12\.30,4\.60,18\.00&t=0\.00,3\.60,-12\.00$/);
  const d = decodeView('#' + h, OPTS);
  assert.deepEqual(d, { season:'autumn', weather:'mist', hour:17.26, doy:290,
                        cam:[12.3, 4.6, 18], tgt:[0, 3.6, -12] });
});

test('分享链接：时辰取模到 [0,24)，没有机位就不写 c/t', () => {
  assert.equal(encodeView({ season:'summer', hour:24.5, weather:'clear' }), 'v=1&s=summer&h=0.50&w=clear');
  assert.equal(encodeView({ hour:-1 }), 'v=1&h=23.00');
});

test('分享链接：非法值逐项丢弃、绝不抛错，全坏 ⇒ null', () => {
  assert.equal(decodeView('', OPTS), null);
  assert.equal(decodeView('#', OPTS), null);
  assert.equal(decodeView('#s=autumn', OPTS), null, '没有 v=1 不认');
  assert.equal(decodeView('#v=2&s=autumn', OPTS), null, '未知版本不认');
  assert.equal(decodeView('#v=1&s=constructor&w=__proto__', OPTS), null, '原型键不能混进来');
  assert.equal(decodeView('#v=1&h=25', OPTS), null);
  assert.equal(decodeView('#v=1&h=NaN&d=0&d=999', OPTS), null);
  assert.equal(decodeView('#v=1&c=1,2,3', OPTS), null, '只有机位没有目标点 ⇒ 丢');
  assert.equal(decodeView('#v=1&c=1,2,3&t=1,2,3', OPTS), null, '机位与目标点重合 ⇒ 丢');
  assert.equal(decodeView('#v=1&c=9999,2,3&t=0,0,0', OPTS), null, '越界');
  assert.equal(decodeView('#v=1&c=1e3,2,3&t=0,0,0', OPTS), null, '科学计数法不收');
  assert.equal(decodeView('#v=1&w=%E0%A4%A', OPTS), null, '坏的 % 编码不抛');
  assert.equal(decodeView('#v=1&s=' + 'x'.repeat(500), OPTS), null, '超长不解析');
  assert.equal(decodeView(null, OPTS), null);
  assert.deepEqual(decodeView('#v=1&s=winter&w=bogus&h=6.5', OPTS), { season:'winter', hour:6.5 }, '坏一个丢一个');
});

test('分享链接：与现有查询参数（tier/debug/intro/walkback…）互不干扰', () => {
  /* 分享走 hash；查询串里写什么 decodeView 都看不见（它只吃 hash 字符串） */
  assert.equal(decodeView('?tier=low&walkback=0', OPTS), null);
  assert.equal(parseMotionParam('?tier=low&motion=1&debug=1'), true);
});

test('减弱动效：?motion=1 强开、?motion=0 强关、其余跟系统', () => {
  assert.equal(parseMotionParam('?motion=1'), true);
  assert.equal(parseMotionParam('?a=1&motion=0'), false);
  assert.equal(parseMotionParam('?motion=2'), null);
  assert.equal(parseMotionParam('?motion=10'), null);
  assert.equal(parseMotionParam('?emotion=1'), null);
  assert.equal(parseMotionParam(''), null);
  assert.equal(resolveReducedMotion(true, true), false, 'URL 强开压过系统设置');
  assert.equal(resolveReducedMotion(false, false), true);
  assert.equal(resolveReducedMotion(null, true), true);
  assert.equal(resolveReducedMotion(null, false), false);
  assert.equal(MOTION.reduced, false, 'node 下无 matchMedia ⇒ 默认不减弱');
});

test('减弱动效：只有自动运镜直切、闪电泛白压到 25%', () => {
  assert.equal(autoFlyDur(1.4, 'tour', true), REDUCED_FLY_DUR);
  assert.equal(autoFlyDur(1.4, 'season-demo', true), REDUCED_FLY_DUR);
  assert.equal(autoFlyDur(1.4, 'manual', true), 1.4, '用户自己点的机位照飞');
  assert.equal(autoFlyDur(1.4, 'tour', false), 1.4);
  assert.equal(lightningFlashGain(true), 0.25);
  assert.equal(lightningFlashGain(false), 1);
});

test('省电降档：<20% 且未充电才降，读数不可信一律不降', () => {
  assert.equal(batteryShouldDowngrade({ level:0.19, charging:false }), true);
  assert.equal(batteryShouldDowngrade({ level:0.2, charging:false }), false, '恰好 20% 不降');
  assert.equal(batteryShouldDowngrade({ level:0.05, charging:true }), false, '充电中不降');
  assert.equal(batteryShouldDowngrade({ level:0.05 }), false, 'charging 未知不降');
  assert.equal(batteryShouldDowngrade({ level:NaN, charging:false }), false);
  assert.equal(batteryShouldDowngrade({ level:-1, charging:false }), false);
  assert.equal(batteryShouldDowngrade({ level:'0.1', charging:false }), false);
  assert.equal(batteryShouldDowngrade(null), false);
  assert.equal(batteryShouldDowngrade({ level:0.3, charging:false }, 0.5), true, '阈值可传');
});

test('音景偏好：往返一致；坏值退默认（满音量、关）', () => {
  assert.deepEqual(parseSoundPrefs(serializeSoundPrefs({ vol:0.37, on:true })), { vol:0.37, on:true });
  assert.deepEqual(parseSoundPrefs(serializeSoundPrefs({ vol:0, on:false })), { vol:0, on:false });
  assert.deepEqual(parseSoundPrefs(null), { vol:1, on:false });
  assert.deepEqual(parseSoundPrefs('{oops'), { vol:1, on:false });
  assert.deepEqual(parseSoundPrefs('"str"'), { vol:1, on:false });
  assert.deepEqual(parseSoundPrefs('{"v":250,"on":"yes"}'), { vol:1, on:false }, '越界夹紧、on 只认 true');
  assert.deepEqual(parseSoundPrefs('{"v":-5,"on":true}'), { vol:0, on:true });
  assert.equal(serializeSoundPrefs({ vol:NaN, on:0 }), '{"v":100,"on":false}');
});

test('首访小红点：只记已知入口、顺序稳定', () => {
  const s = parseSeen('["walk","bogus","hour","walk"]');
  assert.deepEqual([...s].sort(), ['hour', 'walk']);
  assert.equal(serializeSeen(new Set(['walk', 'drawer'])), '["drawer","walk"]');
  assert.equal(parseSeen('nope').size, 0);
  assert.equal(parseSeen('{"a":1}').size, 0);
  assert.ok(SEEN_ENTRIES.includes('sound') && SEEN_ENTRIES.includes('shot'));
});

test('驻足卡：本轮弹过不弹；主动关掉后冷却期内不弹，冷却过了可弹', () => {
  const cooldown = new Map([['远香堂', 1000 + VISTA_COOLDOWN_MS]]);
  assert.equal(vistaMayShow('远香堂', { visited:new Set(), idx:1, cooldown, now:1000 }), false);
  assert.equal(vistaMayShow('远香堂', { visited:new Set(), idx:1, cooldown, now:1000 + VISTA_COOLDOWN_MS - 1 }), false);
  assert.equal(vistaMayShow('远香堂', { visited:new Set(), idx:1, cooldown, now:1000 + VISTA_COOLDOWN_MS }), true);
  assert.equal(vistaMayShow('荷风四面', { visited:new Set([2]), idx:2, cooldown, now:0 }), false);
  assert.equal(vistaMayShow('荷风四面', { visited:new Set([1]), idx:2, cooldown, now:0 }), true);
});

test('驻足卡手势：卡上下滑 / 卡外轻点才关，走路拖动不误关', () => {
  const d = (x, y, t, onCard) => ({ x, y, t, onCard });
  assert.equal(classifyCardGesture(d(300, 600, 0, true), { x:305, y:660, t:200 }), 'swipe');
  assert.equal(classifyCardGesture(d(300, 600, 0, true), { x:360, y:640, t:200 }), null, '斜划为主不算');
  assert.equal(classifyCardGesture(d(300, 600, 0, true), { x:300, y:560, t:200 }), null, '上滑不算');
  assert.equal(classifyCardGesture(d(300, 600, 0, true), { x:302, y:603, t:100 }), null, '卡上轻点不算（卡上点是透传给转头的）');
  assert.equal(classifyCardGesture(d(100, 300, 0, false), { x:104, y:303, t:180 }), 'tap');
  assert.equal(classifyCardGesture(d(100, 300, 0, false), { x:104, y:303, t:900 }), null, '长按不算');
  assert.equal(classifyCardGesture(d(100, 300, 0, false), { x:100, y:240, t:200 }), null, '摇杆拖动不算');
  assert.equal(classifyCardGesture(null, { x:0, y:0, t:0 }), null);
});

test('摇杆：死区内静止；推满全速；中间是模拟量且单调', () => {
  const R = STICK_RADIUS;
  const jitter = stickResponse(3, -2);
  assert.equal(jitter.mag, 0, '指尖 3px 抖动不再是全速');
  assert.equal(jitter.f, 0); assert.equal(jitter.r, 0);
  assert.ok(stickResponse(0, -R * STICK_DEAD).mag < 1e-9, '死区边界 ≈ 0（连续，无台阶）');
  const full = stickResponse(0, -R * 2);
  assert.ok(Math.abs(full.f - 1) < 1e-12 && Math.abs(full.r) < 1e-12, '上推到底 = 全速前进');
  assert.deepEqual([full.kx, full.ky], [0, -1], '旋钮夹在圆内');
  const half = stickResponse(R * 0.6, 0);
  assert.ok(half.r > 0.2 && half.r < 0.6 && half.f === 0, '半推 = 部分速度（右）');
  let prev = 0;
  for (let px = 0; px <= R; px += 2){
    const m = stickResponse(0, -px).mag;
    assert.ok(m >= prev - 1e-12, '单调不减'); prev = m;
  }
  assert.equal(stickResponse(NaN, 0).mag, 0);
});

test('合成移动：键盘单键 / 斜向模长 = 1（与旧手感一致），摇杆半推保留', () => {
  assert.deepEqual(combineMove(1, 0), { f:1, r:0, mag:1 });
  const diag = combineMove(1, 1);
  assert.ok(Math.abs(Math.hypot(diag.f, diag.r) - 1) < 1e-12 && diag.mag === 1);
  const kbPlusStick = combineMove(1 + 0.5, 0);
  assert.equal(kbPlusStick.mag, 1, '键盘 + 摇杆叠加不超速');
  assert.deepEqual(combineMove(0.4, 0), { f:0.4, r:0, mag:0.4 });
  assert.deepEqual(combineMove(0, 0), { f:0, r:0, mag:0 });
});

/* ── 驻足点选择（2026-11-26 · 复核②）──────────────────────────────────────── */
/* 沿 x=0 从院中往北走进远香堂，1.2m/s、60fps；返回每张卡第一次弹出时的 z。 */
function walkNorth(spots, { z0 = 0, z1 = -11, v = 1.2 } = {}){
  const visited = new Set(), first = {};
  let current = -1, shownAt = -Infinity;
  for (let t = 0, z = z0; z >= z1; t += 1000 / 60, z -= v / 60){
    const i = pickVistaSpot(spots, 0, z, { visited, cooldown: new Map(), now: t, current, shownAt });
    if (i >= 0){ visited.add(i); current = i; shownAt = t; if (!(spots[i].name in first)) first[spots[i].name] = z; }
  }
  return first;
}
test('驻足点：旧几何（匾 −8.9 / 堂 −12 同 3.5m）——远香堂卡要进门 1.6m 才弹（复现）', () => {
  /* 旧规则 = "全表最近一条"在半径内且可弹；用 hold=0、只在最近点上判来复现 */
  const spots = [{ x:0, z:-8.9, r:3.5, name:'堂匾' }, { x:0, z:-12, r:3.5, name:'远香堂' }];
  const visited = new Set(); let hallZ = null;
  for (let z = 0; z >= -11; z -= 0.02){
    const d = spots.map(s => Math.abs(z - s.z)); const i = d[0] <= d[1] ? 0 : 1;
    if (d[i] <= 3.5 && !visited.has(i)){ visited.add(i); if (i === 1) hallZ = z; }
  }
  assert.ok(hallZ < -10.4, `旧规则远香堂卡在 z=${hallZ}`);
});
test('驻足点：新几何 + 新规则 —— 上台阶先读匾、到门槛讲堂，两卡都在进门前弹出', () => {
  const spots = [{ x:0, z:-6.9, r:3.0, name:'堂匾' }, { x:0, z:-12, r:3.5, name:'远香堂' }];
  const f = walkNorth(spots);
  assert.ok(f['堂匾'] <= -3.8 && f['堂匾'] > -4.0, `匾 z=${f['堂匾']}`);
  assert.ok(f['远香堂'] !== undefined && f['远香堂'] > -9.6, `远香堂 z=${f['远香堂']}（前檐 −8.8）`);
  assert.ok(f['远香堂'] < f['堂匾']);
});
test('驻足点：正在显示的卡 hold 内不被相邻点顶掉；hold 过后才换', () => {
  const spots = [{ x:0, z:0, r:3, name:'a' }, { x:1, z:0, r:3, name:'b' }];
  const visited = new Set([0]);
  assert.equal(pickVistaSpot(spots, 0.9, 0, { visited, current:0, shownAt:0, now:VISTA_HOLD_MS - 1 }), -1);
  assert.equal(pickVistaSpot(spots, 0.9, 0, { visited, current:0, shownAt:0, now:VISTA_HOLD_MS }), 1);
});
test('驻足点：只在可弹点里挑（弹过的近点不挡远点）；同分取下标小（回填前立峰/题名石重合）', () => {
  const spots = [{ x:0, z:0, r:3.5, name:'题名石' }, { x:0, z:0, r:3.5, name:'立峰' }, { x:2.5, z:0, r:3.5, name:'c' }];
  assert.equal(pickVistaSpot(spots, 0.5, 0, {}), 0);
  assert.equal(pickVistaSpot(spots, 0.5, 0, { visited: new Set([0]) }), 1);
  assert.equal(pickVistaSpot(spots, 0.5, 0, { visited: new Set([0, 1]) }), 2);
  const cd = new Map([['立峰', 10]]);
  assert.equal(pickVistaSpot(spots, 0.5, 0, { visited: new Set([0]), cooldown: cd, now: 5 }), 2);   // 冷却中跳过
  assert.equal(pickVistaSpot(spots, 9, 9, {}), -1);
  assert.equal(pickVistaSpot([], 0, 0, {}), -1);
});
test('驻足点：按 距离/半径 归一化 —— 小半径的点要更靠近才赢', () => {
  const spots = [{ x:0, z:0, r:2, name:'small' }, { x:3, z:0, r:4, name:'big' }];
  assert.equal(pickVistaSpot(spots, 1.2, 0, {}), 1);      // 1.2/2=0.6 vs 1.8/4=0.45
  assert.equal(pickVistaSpot(spots, 0.5, 0, {}), 0);      // 0.25 vs 0.625
});
