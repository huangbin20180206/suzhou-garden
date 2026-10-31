// 纯 node 跑 16-actors 导演层用的模块解析/加载钩子（node:module register）。
// resolve：把依赖 DOM / WebGL / GLB 的 src 模块换成 probe/_actor-sim/stubs 下的桩，
//   其余（00-config、15a-shared、16a-actor-props）按原样加载。只按**文件名**匹配。
// load：给 src/16-actors.js 的**内存副本**末尾补一行 export（仿真要读内部的 ACTORS/DEFS/VISIT/VISCAR）。
//   ⚠️ 不改源码文件本身：本分支已决定 16-actors 单文件不拆，也不为探针加导出。
const STUB = {
  'vendor.js': 'vendor.mjs',
  '01-materials.js': 'materials.mjs',
  '02-scene.js': 'scene.mjs',
  '05-water.js': 'water.mjs',
  '06e-assets.js': 'assets.mjs',
  '08b-figures.js': 'figures.mjs',
  '09-lights.js': 'lights.mjs',
  '14-props.js': 'props.mjs',
  '15-stable.js': 'stable.mjs',
};
export async function resolve(spec, ctx, next){
  const base = spec.split('?')[0].split('/').pop();
  const fromStub = ctx.parentURL && ctx.parentURL.includes('/_actor-sim/stubs/');
  if (STUB[base] && !fromStub && spec.startsWith('.'))
    return { url: new URL('./stubs/' + STUB[base], import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
const EXTRA = '\nexport { ACTORS as __ACTORS, DEFS as __DEFS, seatedDefs as __seatedDefs, VISIT as __VISIT, VISCAR as __VISCAR, RITE as __RITE };\n';
export async function load(url, ctx, next){
  const r = await next(url, ctx);
  if (/\/src\/16-actors\.js(\?|$)/.test(url)) return { ...r, source: String(r.source) + EXTRA, shortCircuit: true };
  return r;
}
