// 花历单测（12g-phenology）：node:test，零依赖。锁住"春无荷花 / 秋无梅花 / 夏秋无紫藤花 / 秋无桃子"等常识，
// 外加花期峰值点（红梅 2/25、荷花 8/1）——曲线改坏时在 node 里就红，不必等截图门。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doyOf } from '../src/12h-solar.js';
import { SEASON_DOY, phenoChannels, xunOfDoy } from '../src/12g-phenology.js';

const NONE = 0.03;   // 旧显隐阈值：低于它即"不出现"
const at = (season) => phenoChannels(SEASON_DOY[season]);

/* ⚠️ 2026-11-08 老黄："春天的池塘为什么什么植物都没有？"
   —— 这条断言原来把 **lilyShow（荷叶/睡莲叶盘）** 跟荷花绑在一起要求"春无"。
   那是错的常识：苏州 4 月中旬池塘里**荷叶已经铺开**，4/12 时一片都没有才是反常。
   荷**花**（lotusShow / bud / bloom / pod）春无是对的（6 月下旬才开），
   荷叶必须单独判、而且要求"有明显一片"。改判据的同时把荷叶的生长曲线
   起点从 4/1 提前到 3 月中（见 12g 的 lotusLeaf）。 */
test('春季代表日：没有荷花（荷花瓣 / 荷苞 / 莲蓬都不出），但**荷叶已经在长**', () => {
  const p = at('spring');
  for (const k of ['lotusShow', 'lotusPodShow', 'lotusBud', 'lotusBloom', 'lotusPod']) {
    assert.ok(p[k] < NONE, `${k}=${p[k]}`);
  }
  assert.ok(p.lilyShow > 0.3, `春季荷叶应当已经出水：lilyShow=${p.lilyShow}`);
});

test('秋季代表日：没有梅花（红梅 / 腊梅 / 合并通道）', () => {
  const p = at('autumn');
  for (const k of ['plumRedShow', 'plumYellowShow', 'plumBlossomShow']) assert.ok(p[k] < NONE, `${k}=${p[k]}`);
});

test('夏季、秋季代表日：没有紫藤花串（叶仍在）', () => {
  for (const s of ['summer', 'autumn']) {
    const p = at(s);
    assert.ok(p.wisteriaBloom < NONE, `${s} wisteriaBloom=${p.wisteriaBloom}`);
    assert.ok(p.wisteriaShow > 0.5, `${s} wisteriaShow=${p.wisteriaShow}`);
  }
});

test('秋季代表日：没有桃子', () => {
  assert.ok(at('autumn').peachFruitShow < NONE);
});

test('峰值点：红梅 2/25 盛开', () => {
  assert.ok(phenoChannels(doyOf(2, 25)).plumRedShow > 0.95);
});

test('峰值点：荷花 8/1 盛开且 GLB 三态只亮"花"', () => {
  const p = phenoChannels(doyOf(8, 1));
  assert.ok(p.lotusShow > 0.95);
  assert.ok(p.lotusBloom > 0.95 && p.lotusBud === 0 && p.lotusPod === 0);
});

test('旬坐标：2 月上旬起点 = 3、12 月 31 日 < 36', () => {
  assert.equal(xunOfDoy(doyOf(2, 1)), 3);
  const x = xunOfDoy(doyOf(12, 31));
  assert.ok(x > 35 && x < 36, String(x));
});
