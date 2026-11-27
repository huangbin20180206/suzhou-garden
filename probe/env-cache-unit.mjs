// @guards: src/02a-env-cache.js, src/02-scene.js
// 只替换 GPU 边界，验证缓存、上下文重建和临时资源所有权；不创建浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEnvCache } from '../src/02a-env-cache.js';

function fixture(){
  const generators = [], targets = [], scenes = [];
  let fail = false;
  const cache = createEnvCache({
    createGenerator(){
      const generator = { disposed:0, fromScene(scene, sigma){
        assert.equal(sigma, 0.035);
        if (fail) throw new Error('GPU bake failed');
        const target = { texture:{ id:targets.length + 1 }, disposed:0, dispose(){ this.disposed++; } };
        targets.push(target);
        return target;
      }, dispose(){ this.disposed++; } };
      generators.push(generator);
      return generator;
    },
    makeScene(preset){
      const scene = { preset, disposed:0 };
      scenes.push(scene);
      return { es:scene, dispose(){ scene.disposed++; } };
    },
  });
  return { cache, generators, targets, scenes, fail(value){ fail = value; } };
}
const night = () => ({ key:'night|clear', skyTop:0x102030, sunPos:[1,2,3] });

test('默认午时和相同 key 共用一次烘焙', () => {
  const f = fixture();
  const first = f.cache.textureFor();
  assert.equal(f.cache.textureFor({ key:'noon|clear', sunPos:[4,5,6] }), first);
  assert.deepEqual(f.cache.state(), { builds:1, cached:['noon|clear'] });
  assert.equal(f.generators.length, 1);
});

test('新 key 只烘一次，切回旧 key 保持零重烘', () => {
  const f = fixture();
  const noon = f.cache.textureFor();
  const dark = f.cache.textureFor(night());
  assert.notEqual(noon, dark);
  assert.equal(f.cache.textureFor(), noon);
  assert.equal(f.cache.textureFor(night()), dark);
  assert.deepEqual(f.cache.state(), { builds:2, cached:['noon|clear','night|clear'] });
});

test('每次烘焙都释放临时场景资源，命中缓存不创建临时场景', () => {
  const f = fixture();
  f.cache.textureFor(); f.cache.textureFor(night()); f.cache.textureFor();
  assert.equal(f.scenes.length, 2);
  assert.ok(f.scenes.every(s => s.disposed === 1));
  assert.ok(f.targets.every(t => t.disposed === 0));
});

test('恢复时废弃所有旧离屏 target，并只重烘当前环境', () => {
  const f = fixture();
  f.cache.textureFor();
  const old = f.cache.textureFor(night());
  const fresh = f.cache.restore();
  assert.notEqual(fresh, old);
  assert.equal(f.targets[0].disposed, 1);
  assert.equal(f.targets[1].disposed, 1);
  assert.equal(f.targets[2].disposed, 0);
  assert.equal(f.generators[0].disposed, 1);
  assert.equal(f.generators.length, 2);
  assert.deepEqual(f.cache.state(), { builds:3, cached:['night|clear'] });
});

test('恢复后未访问的旧 key 采用惰性重烘，之后仍命中缓存', () => {
  const f = fixture();
  f.cache.textureFor(); f.cache.textureFor(night()); f.cache.restore();
  const noon = f.cache.textureFor();
  assert.equal(f.cache.textureFor(), noon);
  assert.equal(f.cache.state().builds, 4);
});

test('恢复目标跟随最后命中的 key，而不是最后新建的 key', () => {
  const f = fixture();
  f.cache.textureFor(); f.cache.textureFor(night()); f.cache.textureFor();
  f.cache.restore();
  assert.deepEqual(f.cache.state(), { builds:3, cached:['noon|clear'] });
});

test('保存烘焙参数快照，外部后续修改不污染恢复结果', () => {
  const f = fixture(), p = night();
  f.cache.textureFor(p);
  p.key = 'dusk|snow'; p.skyTop = 0; p.sunPos[0] = 999;
  f.cache.restore();
  assert.equal(f.scenes[1].preset.key, 'night|clear');
  assert.equal(f.scenes[1].preset.skyTop, 0x102030);
  assert.deepEqual(f.scenes[1].preset.sunPos, [1,2,3]);
});

test('连续三次恢复不累计废弃 target 或生成器', () => {
  const f = fixture();
  f.cache.textureFor(night());
  for (let i = 0; i < 3; i++) f.cache.restore();
  assert.ok(f.targets.slice(0,-1).every(t => t.disposed === 1));
  assert.ok(f.generators.slice(0,-1).every(g => g.disposed === 1));
  assert.equal(f.targets.at(-1).disposed, 0);
  assert.equal(f.cache.state().cached.length, 1);
});

test('烘焙异常仍释放临时资源，失败 key 不入缓存，允许重试', () => {
  const f = fixture();
  f.cache.textureFor(); f.fail(true);
  assert.throws(() => f.cache.textureFor(night()), /GPU bake failed/);
  assert.equal(f.scenes[1].disposed, 1);
  assert.deepEqual(f.cache.state(), { builds:1, cached:['noon|clear'] });
  f.fail(false);
  assert.ok(f.cache.textureFor(night()));
  assert.equal(f.cache.state().builds, 2);
});

test('尚未使用的缓存恢复时创建默认环境，状态数组与内部隔离', () => {
  const f = fixture();
  assert.ok(f.cache.restore());
  f.cache.state().cached.push('foreign');
  assert.deepEqual(f.cache.state(), { builds:1, cached:['noon|clear'] });
});

// 直接执行页面使用的场景工厂，确保资源清理契约也在真实接线处成立。
test('真实烘焙场景同时释放天空和地面的几何、材质', () => {
  const source = fs.readFileSync(new URL('../src/02-scene.js', import.meta.url), 'utf8');
  const factory = source.match(/function envBakeScene[(][^]*?^}/m);
  assert.ok(factory, '应能定位真实场景工厂');
  const resources = [];
  class Resource {
    constructor(){ this.disposed=0; resources.push(this); }
    rotateX(){ return this; }
    dispose(){ this.disposed++; }
  }
  const THREE = { SphereGeometry:Resource, CircleGeometry:Resource, MeshBasicMaterial:Resource,
    Scene:class { add(){} }, Vector3:class {},
    Mesh:class { constructor(geometry, material){ Object.assign(this,{geometry,material,position:{}}); } } };
  const makeScene = new Function('THREE','makeSkyMat','CFG',factory[0] + '; return envBakeScene;')(THREE,() => new Resource(),{ sun:{pos:[1,2,3]} });
  const temporary = makeScene(null);
  temporary.dispose();
  assert.equal(resources.length,4);
  assert.ok(resources.every(r => r.disposed === 1));
});
