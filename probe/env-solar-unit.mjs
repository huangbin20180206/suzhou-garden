// 日轨 / 月相单测（12h-solar）：node:test，零依赖。苏州 31.3N / 120.6E、UTC+8、2027 年。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doyOf, sunTimes, moonAge, moonIllum } from '../src/12h-solar.js';
import { FESTIVAL_DAYS } from '../src/12g-phenology.js';

const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} vs ${want}±${tol}`);
const MIN = 1 / 60;

test('冬至（12/22）日落约 16:59 ±5 分钟', () => {
  near(sunTimes(doyOf(12, 22)).sunset, 16 + 59 / 60, 5 * MIN, '冬至日落');
});

test('夏至（6/21）日落约 19:05 ±5 分钟', () => {
  near(sunTimes(doyOf(6, 21)).sunset, 19 + 5 / 60, 5 * MIN, '夏至日落');
});

test('正午高度：冬至约 35°、夏至约 82°', () => {
  near(sunTimes(doyOf(12, 22)).noonAlt, 35.2, 1, '冬至正午高度');
  near(sunTimes(doyOf(6, 21)).noonAlt, 82.1, 1, '夏至正午高度');
});

test('中秋 2027-09-15 为望（照明 > 0.9）', () => {
  assert.equal(FESTIVAL_DAYS.zhongqiu.doy, doyOf(9, 15));
  assert.ok(moonIllum(moonAge(doyOf(9, 15))) > 0.9);
});

test('除夕 2027-02-05 为朔（照明 < 0.1）', () => {
  assert.equal(FESTIVAL_DAYS.chuxi.doy, doyOf(2, 5));
  assert.ok(moonIllum(moonAge(doyOf(2, 5))) < 0.1);
});
