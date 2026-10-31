// 适配器：本分支的单文件 src/16-actors.js（内部状态的导出由 hooks.mjs 的 load 钩子补在内存副本上）
export async function load(){
  const config = await import('../../src/00-config.js');
  const props = await import('../../src/16a-actor-props.js');
  const M = await import('../../src/16-actors.js');
  return { config, props, ACTORS: M.__ACTORS, defs: [...M.__DEFS, ...M.__seatedDefs()], actorStep: M.actorStep,
           actorVisit: M.actorVisit, VISIT: M.__VISIT, VISCAR: M.__VISCAR, VISIT_PHASES: M.VISIT_PHASES };
}
