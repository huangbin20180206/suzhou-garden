// 自然真实单测（2026-11-24 · 视觉打磨批次 2）：node:test，零浏览器，<1s。
// 走与运行时同一条链：12a baseParamsAt → composeEnv → natureGates / soundPlan / lotusDropK / koiBreachRate /
// footstepVoice（A）、airHumidity → aerialFromHumidity（B）、lingerStep / lingerEff / lingerReset（C）。
// 11-loop / 12-env / 12e / 12i 都只调这些纯函数，所以这里断言的就是画面与声景用的值。
// 守三类事：
//   A 互斥表 —— 季节 × 天气（按互斥矩阵剔非法）× 时辰（0.5h 步）全扫：萤火只在夏夜晴 / 雨后 / 薄雾 / 细雨；
//     蜻蜓雨天 / 冬 / 夜不飞；荷叶水珠只在雨停后且叶盘在；桂花只在秋；冬季鱼跃减少；
//     声景：雨天无鸟无虫、冬夜无夏虫、冬无"雨打芭蕉"、雪地脚步闷、积水脚步带水声。
//   B 空气含水量 —— 默认（夏晴午）五个系数偏差 <1%；各系数对 H 单调；humidW 与天气 fogMul 同序；
//     晨 > 午、雪霁 < 晴 < 雨后 < 薄雾（远山谷雾）；拖时辰无跳变。
//   C 天气余韵 —— 雨停 5 分钟干透、屋顶石面先于地面化雪、流转按游戏小时快进、上升即时、reset 回预设、
//     与 3 秒过渡叠加时有效湿度单调不增且不低于预设。
// 为什么要它：这些门控原来散在四个文件里按天气名 / 时段名现算，穿帮只在某个组合里露馅（见 12a 批次 2 表头）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindPresetsEnv, composeEnv, baseParamsAt, cloneParams, mixInto, timeKeyNow, effectiveWeather,
         ENV_WEATHER, ENV_SEASON, weatherMutexReason,
         natureGates, soundPlan, lotusDropK, koiBreachRate, footstepVoice, FIREFLY_WX,
         airHumidity, aerialFromHumidity, HUMID_DEFAULT,
         LINGER, lingerInit, lingerReset, lingerStep, lingerEff, windNature } from '../src/12a-presets.js';
import { SEASON_DOY, phenoChannels, seasonOfDoy } from '../src/12g-phenology.js';

const ENV = { season: 'summer', weather: 'clear', doy: SEASON_DOY.summer, festival: false, moonPhase: null };
bindPresetsEnv(ENV);
const SEASONS = Object.keys(ENV_SEASON), WEATHERS = Object.keys(ENV_WEATHER);
const setAxes = (season, weather) => Object.assign(ENV, { season, weather, doy: SEASON_DOY[season] });
const at = (season, weather, h) => { setAxes(season, weather); return composeEnv(baseParamsAt(h)); };
const dayKOf = p => Math.max(0, Math.min(1, p.dayK ?? (1 - (p.starAmount || 0))));

/* 全扫一次，后面各测共用 */
const rows = [];
for (const season of SEASONS) for (const weather of WEATHERS){
  if (weatherMutexReason(weather, season) !== null) continue;
  for (let i = 0; i < 48; i++){
    const h = i * 0.5;
    const p = at(season, weather, h);
    const eff = effectiveWeather();
    const time = timeKeyNow(h, ENV.doy);
    rows.push({ season, weather, eff, h, time, p, ng: natureGates(p, season, eff),
                snd: soundPlan(p, { time, season, wind01: 0 }) });
  }
}
const tag = r => `${r.season}/${r.weather}@${r.h}`;

/* ═════════════════════════ A · 物候 × 天气 × 时段 ═════════════════════════ */
test('A 萤火：只在 夏 × 夜 × 晴/雨后/薄雾/细雨；冬 / 雪 / 暴雨 / 雷雨 / 阴 = 0', () => {
  const bad = rows.filter(r => r.ng.fireflies > 0 &&
    !(r.season === 'summer' && FIREFLY_WX[r.eff] > 0 && (r.p.starAmount || 0) >= 0.45 && (r.p.snowAmount || 0) < 0.2));
  assert.deepEqual(bad.map(tag), []);
  for (const r of rows) if (['storm', 'thunder', 'snow', 'overcast', 'winterrain'].includes(r.eff) || r.season === 'winter')
    assert.equal(r.ng.fireflies, 0, tag(r));
  const pick = (w, h) => rows.find(r => r.season === 'summer' && r.weather === w && r.h === h);
  assert.equal(+pick('clear', 22).ng.fireflies.toFixed(3), 0.9, '夏夜晴（门禁口径 0.9）');
  assert.ok(pick('drizzle', 22).ng.fireflies > 0.3, '梅雨夜有萤火');
  assert.ok(pick('afterrain', 22).ng.fireflies >= 0.85, '雨后湿夜萤火最盛');
  assert.equal(pick('clear', 12).ng.fireflies, 0, '白天没有');
});

test('A 飘落花瓣 / 秋叶：雨把它们打下来；夜里不发光', () => {
  for (const r of rows){
    if ((r.p.rainAmount || 0) >= 0.95) assert.ok(r.ng.petalWx <= 0.26 && r.ng.petalFall >= 3, tag(r));
    if ((r.p.rainAmount || 0) === 0) assert.equal(r.ng.petalWx, 1, tag(r));
    if ((r.p.starAmount || 0) >= 0.99) assert.ok(r.ng.petalLight <= 0.2, `${tag(r)} 夜里花瓣 ${r.ng.petalLight}`);
  }
  const noon = rows.find(r => r.season === 'spring' && r.weather === 'clear' && r.h === 12.5);
  assert.ok(noon.ng.petalLight > 0.98, `春晴午花瓣受光 ${noon.ng.petalLight}（白天观感不变）`);
});

test('A 蜻蜓：雨天 / 冬 / 夜 / 雪 / 大风不飞不停；夏晴午在', () => {
  for (const r of rows){
    if (!r.ng.dragonfly) continue;
    assert.ok((r.p.rainAmount || 0) <= 0.12, `${tag(r)} 雨 ${r.p.rainAmount}`);
    assert.ok(r.season !== 'winter', tag(r));
    assert.ok((r.p.starAmount || 0) < 0.85, `${tag(r)} 夜`);
    assert.ok(!['storm', 'thunder', 'drizzle', 'snow', 'winterrain'].includes(r.eff), tag(r));
  }
  assert.ok(rows.find(r => r.season === 'summer' && r.weather === 'clear' && r.h === 12.5).ng.dragonfly);
  assert.ok(!rows.find(r => r.season === 'summer' && r.weather === 'clear' && r.h === 22).ng.dragonfly, '夏夜');
  assert.ok(!rows.find(r => r.season === 'summer' && r.weather === 'drizzle' && r.h === 12.5).ng.dragonfly, '夏细雨 0.342');
});

test('A 桂花：花期只落在秋季日序', () => {
  for (let d = 1; d <= 365; d++)
    if (phenoChannels(d).osmanthusShow > 0) assert.equal(seasonOfDoy(d), 'autumn', `doy ${d}`);
  assert.equal(phenoChannels(SEASON_DOY.autumn).osmanthusShow, 1);
  for (const s of ['spring', 'summer', 'winter']) assert.equal(phenoChannels(SEASON_DOY[s]).osmanthusShow, 0, s);
});

test('A 荷叶水珠：只在雨停后、叶盘在、未下雪', () => {
  for (const r of rows){
    const k = lotusDropK(r.p, r.p.wetness || 0);
    if ((r.p.rainAmount || 0) >= 0.2 || r.season === 'winter' || (r.p.snowAmount || 0) > 0.2) assert.equal(k, 0, tag(r));
  }
  assert.ok(lotusDropK(at('summer', 'afterrain', 12.5), 0.85) > 0.99, '夏雨后满');
  assert.equal(lotusDropK(at('summer', 'clear', 12.5), 0), 0, '晴天干');
  assert.equal(lotusDropK(at('winter', 'afterrain', 12.5), 0.85), 0, '冬叶盘已收');
});

test('A 鱼跃：冬季频率 ≤0.3，其余季节 1（夏逐字不变）', () => {
  for (const s of SEASONS){
    const k = koiBreachRate(at(s, 'clear', 12.5));
    if (s === 'winter') assert.ok(k <= 0.3, `${s} ${k}`); else assert.equal(k, 1, s);
  }
});

test('A 声景：雨天无鸟无虫、冬夜无夏虫、冬季无雨打芭蕉、冬晨只剩山雀半频', () => {
  for (const r of rows){
    const q = r.snd, rain = r.p.rainAmount || 0;
    if (rain >= 0.15) assert.ok(q.bird === 0 && q.cricket === 0 && q.cicada === 0 && q.frog === 0, `${tag(r)} 雨 ${rain}`);
    if (r.season === 'winter') assert.ok(q.cricket === 0 && q.cicada === 0 && q.frog === 0 && q.drum === 0, `${tag(r)} drum ${q.drum}`);
    if (r.time !== 'morning') assert.equal(q.bird, 0, tag(r));
    if (r.time !== 'night') assert.equal(q.cricket, 0, tag(r));
    if (r.season !== 'summer') assert.ok(q.cicada === 0 && q.frog === 0, tag(r));
    if (rain === 0) assert.equal(q.rain, 0, tag(r));
  }
  const find = (s, w, time) => rows.find(r => r.season === s && r.weather === w && r.time === time);
  assert.ok(find('summer', 'clear', 'night').snd.cricket > 0 && find('summer', 'clear', 'night').snd.frog > 0, '夏夜虫蛙');
  assert.ok(find('summer', 'clear', 'noon').snd.cicada > 0, '夏午蝉');
  assert.equal(find('winter', 'clear', 'morning').snd.bird, 0.5, '冬晨山雀半频');
  assert.equal(find('spring', 'clear', 'morning').snd.bird, 1, '春晨鸟');
  assert.ok(find('summer', 'storm', 'noon').snd.drum > 0.9, '夏暴雨雨打芭蕉照旧');
  assert.equal(find('winter', 'drizzle', 'noon').snd.drum, 0, '冬冷雨：芭蕉叶幕已枯落');
});

test('A 脚步：干地与旧版逐值相同；雪地闷；积水带水声；雪地不叠水声', () => {
  assert.deepEqual(footstepVoice(true), { freq: 2400, Q: 1.8, rate: 1.0, gain: 0.055, dur: 0.05, splash: 0 });
  assert.deepEqual(footstepVoice(false), { freq: 700, Q: 0.7, rate: 0.72, gain: 0.042, dur: 0.085, splash: 0 });
  for (const st of [true, false]){
    const dry = footstepVoice(st), snow = footstepVoice(st, 0, 1), wet = footstepVoice(st, 0.9, 0);
    assert.ok(snow.freq < dry.freq * 0.55 && snow.gain < dry.gain && snow.dur > dry.dur, `雪地闷 ${JSON.stringify(snow)}`);
    assert.equal(wet.splash, 1); assert.equal(footstepVoice(st, 0.2, 0).splash, 0, '微湿不溅');
    assert.equal(footstepVoice(st, 0.9, 1).splash, 0, '雪地不叠水声');
  }
});

/* ═════════════════════════ B · 空气含水量 ═════════════════════════ */
const aerialOf = (p, wetExcess = 0) => aerialFromHumidity(airHumidity(p, wetExcess), dayKOf(p));

test('B 默认（夏 · 晴 · 午 12.5）五个系数偏差 < 1%（实为 0）', () => {
  const p = at('summer', 'clear', 12.5);
  assert.equal(p.humidW, HUMID_DEFAULT); assert.equal(p.dawnHumid, 0);
  const a = aerialOf(p);
  assert.ok(Math.abs(a.fogK - 1) < 0.01 && Math.abs(a.satK - 1) < 0.01 && Math.abs(a.hillHazeK - 1) < 0.01, JSON.stringify(a));
  assert.ok(a.horizonMix < 0.01 && a.reflHaze < 0.01, JSON.stringify(a));
  assert.deepEqual(a, { fogK: 1, horizonMix: 0, satK: 1, hillHazeK: 1, reflHaze: 0 });
});

test('B 单调：H 越大雾 / 地平线 / 远山 / 倒影越蒙、饱和越低', () => {
  let prev = null;
  for (let i = 0; i <= 50; i++){
    const H = i / 50;
    const a = aerialFromHumidity({ H, Hp: Math.min(H, HUMID_DEFAULT) }, 1);
    if (prev){
      assert.ok(a.fogK >= prev.fogK && a.horizonMix >= prev.horizonMix && a.hillHazeK >= prev.hillHazeK
             && a.reflHaze >= prev.reflHaze && a.satK <= prev.satK, `H=${H}`);
    }
    prev = a;
  }
  /* airHumidity 对三个来源各自单调 */
  const base = { humidW: 0.3, dawnHumid: 0 };
  assert.ok(airHumidity({ ...base, humidW: 0.6 }).H > airHumidity(base).H);
  assert.ok(airHumidity({ ...base, dawnHumid: 0.35 }).H > airHumidity(base).H);
  assert.ok(airHumidity(base, 0.5).H > airHumidity(base).H && airHumidity(base, 0.5).Hp === airHumidity(base).Hp);
});

test('B 同一种天气：humidW 与天气雾倍率同序；远山谷雾 雪霁 < 晴 < 雨后 < 薄雾，晴晨 > 晴午', () => {
  const hw = {};
  for (const w of WEATHERS) hw[w] = at(w === 'snow' || w === 'snowclear' ? 'winter' : 'summer', w, 12.5).humidW;
  for (const a of WEATHERS) for (const b of WEATHERS){
    if (ENV_WEATHER[a].fogMul > ENV_WEATHER[b].fogMul + 0.05) assert.ok(hw[a] > hw[b], `${a} ${hw[a]} vs ${b} ${hw[b]}`);
  }
  const hill = (s, w, h) => aerialOf(at(s, w, h)).hillHazeK;
  assert.ok(hill('winter', 'snowclear', 12.5) < 1 && hill('summer', 'clear', 12.5) === 1
         && hill('summer', 'afterrain', 12.5) > 1 && hill('summer', 'mist', 12.5) > hill('summer', 'afterrain', 12.5));
  assert.ok(hill('summer', 'clear', 7.5) > 1.2, `晴晨远山谷雾 ${hill('summer', 'clear', 7.5)}`);
  assert.equal(aerialOf(at('summer', 'afterrain', 12.5)).reflHaze, 0, '雨后倒影仍锐（空气被雨洗过）');
  assert.ok(aerialOf(at('summer', 'mist', 12.5)).reflHaze > 0.15, '薄雾倒影蒙');
  /* 夜里远山 / 倒影 / 地平线不动（mist-guard 夜+薄雾余量） */
  for (const w of WEATHERS){
    const p = at(w === 'snow' || w === 'snowclear' ? 'winter' : 'summer', w, 23);
    const a = aerialOf(p, 1);
    assert.ok(a.hillHazeK === 1 && a.reflHaze === 0 && a.horizonMix === 0, `${w} 夜 ${JSON.stringify(a)}`);
  }
});

test('B 连续：时辰 3 分钟一步，五个系数单步跳变有限', () => {
  for (const season of SEASONS) for (const weather of WEATHERS){
    if (weatherMutexReason(weather, season) !== null) continue;
    let prev = null;
    for (let i = 0; i <= 480; i++){
      const a = aerialOf(at(season, weather, i * 0.05), 0.3);
      /* 远山谷雾乘白天度：日出日落那 ~1 小时随 dayK 走，暴雨（1.56 档）3 分钟最大 0.063（uHaze 绝对量 ≤0.04） */
      if (prev) for (const k of Object.keys(a))
        assert.ok(Math.abs(a[k] - prev[k]) <= (k === 'hillHazeK' ? 0.08 : 0.06), `${season}/${weather}@${(i * 0.05).toFixed(2)} ${k} Δ${Math.abs(a[k] - prev[k])}`);
      prev = a;
    }
  }
});

/* ═════════════════════════ C · 天气余韵 ═════════════════════════ */
const storm = () => at('summer', 'storm', 12.5), clear = () => at('summer', 'clear', 12.5);
const run = (L, p, secs, dt = 1 / 60) => { for (let t = 0; t < secs - 1e-9; t += dt) lingerStep(L, p, dt); return L; };

test('C 无余韵时有效值 = 预设直出（默认画面零偏差）', () => {
  const p = clear(), L = lingerInit(p);
  run(L, p, 10);
  assert.deepEqual(lingerEff(L, p), { wet: 0, snowGround: 0, snowFast: 0, wetExcess: 0 });
});

test('C 雨停：湿度按线性曲线 5 分钟干透；积水 / 水珠先收、湿光后收', () => {
  const L = lingerInit(storm()), p = clear();
  const puddleK = w => Math.max(0, Math.min(1, (w - 0.30) / 0.45));
  const curve = [];
  for (let s = 0; s <= LINGER.wetSec + 5; s += 1){ curve.push(lingerEff(L, p).wet); run(L, p, 1); }
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] <= curve[i - 1] + 1e-12, `第 ${i}s 回升`);
  assert.ok(Math.abs(curve[150] - 0.5) < 0.01, `150s 湿度 ${curve[150]}`);
  assert.ok(curve[60] > 0.75 && puddleK(curve[60]) > 0.9, '1 分钟时积水仍在');
  assert.equal(puddleK(curve[215]), 0, '3.6 分钟积水收');
  assert.ok(curve[215] > 0.2, '湿光还在');
  assert.equal(curve[LINGER.wetSec + 1], 0, '5 分钟干透');
  /* 雨后初晴：从暴雨 1.0 降到预设 0.85 就停（不会把雨后初晴自己晒干） */
  const L2 = lingerInit(storm()); run(L2, at('summer', 'afterrain', 12.5), 600);
  assert.ok(Math.abs(lingerEff(L2, at('summer', 'afterrain', 12.5)).wet - 0.85) < 1e-9);
});

test('C 雪停：屋顶 / 石面 3 分钟化完时地面还剩六成，8 分钟地面化完', () => {
  const snow = at('winter', 'snow', 12.5), cl = at('winter', 'clear', 12.5);
  const L = lingerInit(snow);
  run(L, cl, LINGER.snowFastSec + 1);
  const e = lingerEff(L, cl);
  assert.equal(e.snowFast, 0);
  assert.ok(e.snowGround > 0.6 && e.snowGround < 0.65, `地面 ${e.snowGround}`);
  run(L, cl, LINGER.snowGroundSec - LINGER.snowFastSec);
  assert.equal(lingerEff(L, cl).snowGround, 0);
  /* 雪 → 雪霁：预设积雪仍是 1 ⇒ 不化（雪霁的景就是积雪还在） */
  const L2 = lingerInit(snow), sc = at('winter', 'snowclear', 12.5); run(L2, sc, 600);
  assert.deepEqual([lingerEff(L2, sc).snowGround, lingerEff(L2, sc).snowFast], [1, 1]);
});

test('C 雪化湿地：化雪全程地面湿（复用雨余韵通道），化完约 3 分钟干透；雪霁 / decayOnly 不湿', () => {
  const snow = at('winter', 'snow', 12.5), cl = at('winter', 'clear', 12.5);
  const L = lingerInit(snow);
  assert.equal(L.wet, snow.wetness || 0);
  run(L, cl, 5);
  assert.ok(Math.abs(lingerEff(L, cl).wet - LINGER.meltWet) < 1e-9, `化雪 5s 湿度 ${L.wet}`);
  assert.ok(lingerEff(L, cl).wetExcess > 0.5, '空气含水量跟着抬（wetExcess）');
  run(L, cl, LINGER.snowGroundSec * 0.6);
  assert.ok(Math.abs(L.wet - LINGER.meltWet) < 1e-9, '化雪中途仍湿');
  let tDry = 0, prev = Infinity, mono = true;
  for (; tDry < 900 && lingerEff(L, cl).wet > 0; tDry++){ const w = lingerEff(L, cl).wet; if (w > prev + 1e-12) mono = false; prev = w; run(L, cl, 1); }
  assert.equal(L.snowG, 0);
  assert.ok(mono, '收尾单调不增');
  const total = LINGER.snowGroundSec * 0.6 + 5 + tDry;
  assert.ok(total > LINGER.snowGroundSec && total < LINGER.snowGroundSec + 220, `雪停到地面干透 ${total}s`);
  /* 雪霁：积雪还在，不湿 */
  const sc = at('winter', 'snowclear', 12.5), L2 = lingerInit(snow); run(L2, sc, 60);
  assert.equal(lingerEff(L2, sc).wet, Math.max(sc.wetness || 0, 0));
  /* decayOnly 不抬湿 */
  const L3 = lingerInit(snow); lingerStep(L3, cl, 0, 1, true); assert.equal(L3.wet, snow.wetness || 0);
});

test('C 时光流转按游戏小时快进；拨时辰 decayOnly 不提前打湿；下雨即时变湿；reset 回预设', () => {
  const L = lingerInit(storm()), p = clear();
  lingerStep(L, p, 0, 1.0); assert.ok(Math.abs(L.wet - 0.5) < 1e-9, `流转 1 小时 ${L.wet}`);
  lingerStep(L, p, 0, 1.0); assert.equal(L.wet, 0);
  /* 流转 0.4 时/秒：5 秒（2 个游戏小时）干透 */
  const L1 = lingerInit(storm()); for (let i = 0; i < 300; i++) lingerStep(L1, p, 1 / 60, 0.4 / 60);
  assert.ok(L1.wet < 0.02, `流转 5s ${L1.wet}`);
  const L2 = lingerInit(p); lingerStep(L2, storm(), 0, 3, true); assert.equal(L2.wet, 0, 'decayOnly 不升');
  lingerStep(L2, storm(), 1 / 60); assert.equal(L2.wet, 1, '下雨即时跟随');
  const L3 = lingerInit(storm()); lingerReset(L3, p); assert.deepEqual(L3, { wet: 0, snowF: 0, snowG: 0 });
});

test('C 与 3 秒过渡叠加：有效湿度单调不增、恒 ≥ 预设插值；空气含水量随之回落到默认', () => {
  const from = storm(), to = clear(), cur = cloneParams(from);
  const L = lingerInit(from);
  let prev = Infinity;
  const dt = 1 / 60;
  for (let t = 0; t <= 400; t += dt){
    const e = Math.min(1, t / 2.8);
    mixInto(cur, from, to, e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2);
    lingerStep(L, cur, dt);
    const eff = lingerEff(L, cur);
    assert.ok(eff.wet <= prev + 1e-12 && eff.wet >= (cur.wetness || 0) - 1e-12, `t=${t.toFixed(2)}`);
    prev = eff.wet;
  }
  const a0 = aerialOf(to, 1), a1 = aerialOf(to, lingerEff(L, cur).wetExcess);
  assert.ok(a0.fogK > 1.2, `雨刚停雾 ×${a0.fogK.toFixed(3)}`);
  assert.deepEqual(a1, { fogK: 1, horizonMix: 0, satK: 1, hillHazeK: 1, reflHaze: 0 });
});

/* ═════════════════════════ ⑧ 风与水 / 落叶（2026-11-26 · 场景打造批）═════════════════════════ */
/* 2b-wind 的底值风 = 档位 v × windGain(windMul) + 阵风 ×0.15（阵风峰值 ≤ 1.1）。2b-wind import 了 DOM 依赖的 01，
   node 里拿不到，这里按其公式与常量重算上界（windGain 与 FORCE_TIERS 改了要同步本处）。 */
const windGainRef = wf => Math.pow(Math.max(0, Math.min(1, (wf - 0.90) / 3.10)), 0.75);
const bandHi = wf => (wf >= 2.5 ? 1.00 : wf >= 1.10 ? 0.70 : 0.42);
const globalMax = wf => bandHi(wf) * windGainRef(wf) + 1.1 * 0.15;

test('⑧ 风皱池面：晴 / 薄雾 / 雨后 / 雪霁的底值风上界内恒 0（默认画面不变）；暴雨台风档满 0.30；低档关', () => {
  for (const w of ['clear', 'mist', 'afterrain', 'snowclear']){
    const wm = ENV_WEATHER[w].windMul;
    const g = globalMax(wm);
    assert.ok(g < 0.22, `${w} windMul=${wm} 底值风上界 ${g}`);
    assert.equal(windNature(g, wm, 'summer').chop, 0);
  }
  assert.ok(Math.abs(windNature(1.0, 4, 'summer').chop - 0.30) < 1e-12);
  assert.ok(windNature(0.5, 4, 'summer').chop > 0.05);
  assert.equal(windNature(1.0, 4, 'summer', false).chop, 0);
  /* 单调：风越大越皱 */
  let prev = -1;
  for (let x = 0; x <= 1.2; x += 0.01){ const c = windNature(x, 4, 'summer').chop; assert.ok(c >= prev - 1e-12); prev = c; }
});

test('⑧ 落叶：无阵风时漂速 = 旧值 windMul×0.55；阵风加速；只秋季多吹落叶；低档阵风项归零', () => {
  for (const wm of [0.55, 1, 1.35, 4]) assert.ok(Math.abs(windNature(0, wm, 'spring').leafDrift - wm * 0.55) < 1e-12);
  assert.ok(windNature(1, 1, 'autumn').leafDrift > 1.1 * 0.55 * 2 - 1e-9);
  assert.equal(windNature(1, 1, 'spring').leafLoose, 0);
  assert.ok(Math.abs(windNature(1, 1, 'autumn').leafLoose - 0.35) < 1e-12);
  assert.equal(windNature(1, 1, 'autumn', false).leafLoose, 0);
  assert.equal(windNature(1, 1, 'autumn', false).leafDrift, 0.55);
  const o = {}; assert.equal(windNature(0.5, 1, 'autumn', true, o), o, '给复用对象就零分配');
});

/* ── ⑨ 晨露蛛网（2026-11-27）── */
import { dewWebGate, dewWebLayout, fxGates as _fxG, paramsAtHour as _pah, ENV_WEATHER as _EW } from '../src/12a-presets.js';
import { mulberry32 as _m32 } from '../src/00-config.js';

test('⑨ 蛛网露珠门：只在晨 5:30~8:30、湿、非雨雪、非冬；不给 hour 的旧调用恒 0', () => {
  const E = { season: 'summer', weather: 'clear', doy: SEASON_DOY.summer, festival: false, moonPhase: null };
  bindPresetsEnv(E);
  const at = (w, h, s = 'summer') => { Object.assign(E, { weather: w, season: s, doy: SEASON_DOY[s] }); return dewWebGate(composeEnv(_pah(h)), h, s); };
  for (const w of Object.keys(_EW)) for (const h of [3, 4.5, 9.5, 12, 18, 22]) assert.equal(at(w, h), 0, `${w}@${h}`);
  assert.ok(at('mist', 7.5) > 0.95 && at('overcast', 6) > 0.95, '雾/阴晨满');
  assert.ok(at('clear', 7.5) > 0.9 && at('afterrain', 7) > 0.9, '晴/雨后晨也有露');
  for (const w of ['storm', 'thunder', 'drizzle', 'snow']) assert.equal(at(w, 7.5), 0, w);
  assert.equal(at('mist', 7.5, 'winter'), 0);
  assert.equal(_fxG(composeEnv(_pah(7.5))).dewWeb, 0);
  /* 连续：3 分钟一步跳 ≤0.12 */
  let prev = at('clear', 4.5);
  for (let h = 4.55; h <= 10; h += 0.05){ const v = at('clear', h); assert.ok(Math.abs(v - prev) <= 0.12, `跳变 @${h.toFixed(2)}`); prev = v; }
});

test('⑨ 蛛网布点：确定性、数量适中、全在网半径 1.5 倍内', () => {
  const specs = [{ c: [0, 2, 0], n: [0, 0, 1], r: 0.3, seed: 7 }, { c: [5, 1, 5], n: [1, 0, 0], r: 0.25, seed: 9 }];
  const a = dewWebLayout(specs, _m32), b = dewWebLayout(specs, _m32);
  assert.deepEqual([...a.beads], [...b.beads]);
  assert.equal(a.lines.length % 6, 0);
  assert.ok(a.size.length > 60 && a.size.length < 800, `露珠 ${a.size.length}`);
  for (let i = 0; i < a.beads.length; i += 3){
    const d0 = Math.hypot(a.beads[i], a.beads[i + 1] - 2, a.beads[i + 2]), d1 = Math.hypot(a.beads[i] - 5, a.beads[i + 1] - 1, a.beads[i + 2] - 5);
    assert.ok(Math.min(d0, d1) < 0.45);
  }
});
