// PMREM 的 GPU 资源有明确所有者：缓存持有 RenderTarget，而不只保留其中的 texture。
// 上下文恢复后旧 target 的像素已丢失，先释放旧资源，再按最后一次成功参数重烘当前环境。
export function createEnvCache({ createGenerator, makeScene }){
  const cache = new Map();
  let generator = null, currentPreset = null, builds = 0;

  function textureFor(preset = null){
    const key = preset?.key || 'noon|clear';
    const hit = cache.get(key);
    if (hit){
      currentPreset = hit.preset;
      return hit.target.texture;
    }
    const snapshot = preset ? { ...preset, sunPos: preset.sunPos?.slice() } : null;
    if (!generator) generator = createGenerator();
    const temporary = makeScene(snapshot);
    let target;
    try {
      target = generator.fromScene(temporary.es, 0.035);
    } finally {
      temporary.dispose();     // 烘焙失败也释放临时 geometry/material，失败结果不进入缓存。
    }
    cache.set(key, { target, preset:snapshot });
    currentPreset = snapshot;
    builds++;
    return target.texture;
  }

  function restore(){
    const preset = currentPreset;
    for (const { target } of cache.values()) target.dispose();
    cache.clear();
    if (generator) generator.dispose();
    generator = null;
    // 仅当前环境立即重烘；其余时段按需恢复，避免恢复事件里同步重烘整个缓存。
    return textureFor(preset);
  }

  return { textureFor, restore, state:() => ({ builds, cached:[...cache.keys()] }) };
}
