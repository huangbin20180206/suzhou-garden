// 「写意艺术处理」登记表单测（2026-10-30）：node:test，零浏览器。
// 钉住三件事：
//   ① 登记表字段齐全，Kyle 拍板保留的四类物件都在，替代候选包含约定的那几样；
//   ② markArtLicense 只写 userData 两个键，拼错 id 当场抛错；artLicenseOf 沿祖先链找得到；
//   ③ 标为 tagged 的条目，源码里真的有对应的 markArtLicense(…, 'id') 调用（防"表里说打了、代码里没打"）；
//      pending 的条目写明了所在文件（15/16 系，按分工待合并时打标）；docs/art-license.md 存在且写明口径。
// 用法：node --test probe/art-license-unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART_LICENSE, markArtLicense, artLicenseOf } from '../src/art-license.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('① 四类物件都已登记，字段齐全，替代候选含约定项', () => {
  for (const id of ['macaw', 'stable', 'carriage', 'foreignHorse']) assert.ok(ART_LICENSE[id], id);
  for (const e of Object.values(ART_LICENSE)){
    for (const k of ['id', 'label', 'tag', 'real', 'why', 'alternatives', 'objects']) assert.ok(e[k], e.id + '.' + k);
    assert.ok(e.tag.startsWith('写意艺术处理：'), e.id + ' tag 前缀');
    assert.ok(e.alternatives.length >= 1 && e.objects.length >= 1, e.id);
  }
  const alt = (id) => ART_LICENSE[id].alternatives.join('');
  for (const w of ['八哥', '画眉', '白鹭']) assert.ok(alt('macaw').includes(w), 'macaw→' + w);
  for (const w of ['轿子', '明式马车']) assert.ok(alt('carriage').includes(w), 'carriage→' + w);
  for (const w of ['马房', '卸车棚']) assert.ok(alt('stable').includes(w), 'stable→' + w);
  assert.ok(alt('foreignHorse').includes('蒙古马'));
});

test('② markArtLicense / artLicenseOf', () => {
  const parent = { userData: {}, parent: null };
  const child = { userData: { keep: 1 }, parent };
  markArtLicense(parent, 'macaw');
  assert.equal(parent.userData.artLicenseId, 'macaw');
  assert.equal(parent.userData.artLicense, ART_LICENSE.macaw.tag);
  assert.deepEqual(Object.keys(child.userData), ['keep']);          // 子件不被改
  assert.equal(artLicenseOf(child), ART_LICENSE.macaw);             // 但能沿祖先链查到
  assert.equal(artLicenseOf({ userData: {}, parent: null }), null);
  assert.throws(() => markArtLicense({ userData: {} }, 'parrot'), /未登记/);
});

test('③ tagged 条目在源码里真有打标调用；pending 写明 15/16 系文件；文档在', () => {
  const srcDir = path.join(ROOT, 'src');
  const all = fs.readdirSync(srcDir).filter(f => f.endsWith('.js') && f !== 'art-license.js')
    .map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
  for (const e of Object.values(ART_LICENSE)){
    const tagged = e.objects.some(o => o.status === 'tagged');
    const re = new RegExp("markArtLicense\\([^)]*'" + e.id + "'\\)");
    if (tagged) assert.ok(re.test(all), e.id + '：登记为 tagged，但源码里没有 markArtLicense(…, \'' + e.id + '\')');
    for (const o of e.objects.filter(x => x.status === 'pending')) assert.match(o.file, /src\/1[56]/, e.id + ' pending 未写明文件');
  }
  const doc = fs.readFileSync(path.join(ROOT, 'docs/art-license.md'), 'utf8');
  assert.ok(doc.includes('展示保留，标注为艺术处理，替代资产候选见表'));
});
