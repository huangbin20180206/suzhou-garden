// 同 hooks.mjs，只把 vendor.js 换成计数版（stubs/vendor-count.mjs）。perf-sim-bench 专用。
import * as H from './hooks.mjs';
export async function resolve(spec, ctx, next){
  const base = spec.split('?')[0].split('/').pop();
  if (base === 'vendor.js' && spec.startsWith('.')) return { url: new URL('./stubs/vendor-count.mjs', import.meta.url).href, shortCircuit: true };
  return H.resolve(spec, ctx, next);
}
export const load = H.load;
