// @guards: package.json
// 日常 unit 清单必须覆盖每个正式单元文件，新增测试漏登记时直接报红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const script = JSON.parse(fs.readFileSync(new URL('package.json',root),'utf8')).scripts.unit;
const isUnit = name => name === 'unit-pure.mjs' || name.endsWith('-unit.mjs');
const disk = fs.readdirSync(new URL('probe/',root)).filter(isUnit).map(name => 'probe/' + name).sort();
const declared = [...script.matchAll(/probe\/[\w-]+\.mjs/g)].map(m => m[0]).filter(p => isUnit(p.slice(6)));

test('npm run unit 显式登记磁盘上所有正式单元文件', () => {
  assert.deepEqual(disk.filter(p => !declared.includes(p)), [], '缺失单元入口');
});

test('日常单元清单没有重复或已删除文件', () => {
  assert.equal(new Set(declared).size, declared.length, '重复登记会重复运行');
  assert.deepEqual(declared.filter(p => !disk.includes(p)), [], '登记文件应存在');
});

test('人物仿真测试继续使用独立 loader，避免污染其它单元', () => {
  const parts = script.split('&&').map(p => p.trim());
  const actor = parts.find(p => p.includes('--import ./probe/_actor-sim/register.mjs'));
  assert.ok(actor, '人物测试需要项目 loader');
  assert.ok(actor.includes('probe/actor-tick-unit.mjs'));
  assert.ok(actor.includes('probe/actor-shape-unit.mjs'));
  assert.ok(!parts.filter(p => p !== actor).some(p => /probe\/actor-(tick|shape)-unit\.mjs/.test(p)));
});
