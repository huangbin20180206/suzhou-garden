// 00c-spatial：声音空间化的**纯数学**（2026-11-23 · 批次 #24）
//
// 为什么单独成文件：11-loop 顶层要建 AudioContext / 挂 DOM，node 里 import 即炸；
// 而这里算的又是"错了不报错、只有戴耳机才听得出来"的东西（左右反了、远处的声音在耳边），
// 必须能像 00a-quality 那样在 node:test 里直接断言。
//
// 坐标口径（与 11a-walk 的 move() 完全一致，别另立一套）：
//   世界 forward = (-sin yaw, -cos yaw)，right = (cos yaw, -sin yaw)。
//   yaw=0 时朝 -z、右手边是 +x。
//
// 覆盖范围：只算**水平面**的方位与距离。俯仰（人在高台、声在低处）不参与 ——
// 园林是平面游园，把高度混进来只会让 pan 在上下台阶时乱跳。

/** 限幅。 */
export function clamp(x, lo, hi){ return x < lo ? lo : x > hi ? hi : x; }

/**
 * 声源相对听者的左右方位 → StereoPanner 的 pan 值 [-1, 1]。
 * dx/dz：声源 − 听者（世界坐标）；yaw：听者朝向（弧度，YXZ 的 y）。
 * 正右 = +1、正左 = −1、正前/正后 = 0。
 * 正后方不特殊处理：人耳靠音色辨前后，耳机里强行做"后场"要用 HRTF，
 * 这里刻意只做双耳电平差（便宜、稳、不会把窗外的水声翻到脑后）。
 */
export function spatialPan(dx, dz, yaw){
  const right = dx * Math.cos(yaw || 0) - dz * Math.sin(yaw || 0);
  const forward = -dx * Math.sin(yaw || 0) - dz * Math.cos(yaw || 0);
  const d = Math.hypot(right, forward);
  if (d < 0.35) return 0;               // 贴脸的声源不给方向，否则一转身 pan 就满程乱甩
  return +clamp(right / d, -1, 1).toFixed(4);
}

/**
 * 距离衰减：近处满增益，远处降到 floor。用线性而非 1/d² ——
 * 真实声压确实按平方反比，但这里的"增益"是在已有环境底噪上做调制，
 * 真按平方会让池边 1.9 vs 园深处 0.02，一转身就静音，听感像 bug。
 */
export function spatialGain(dist, maxDist, floor){
  const u = clamp(dist / Math.max(0.01, maxDist), 0, 1);
  return +(floor + (1 - floor) * (1 - u)).toFixed(4);
}

/**
 * 点到椭圆边界的最近点（近似）：把方向按半轴归一化再投影回世界。
 * 用于"人在岸上、水声从最近的岸线传来"——池心 (0,3) 是个 15.7×9.4 的大椭圆，
 * 拿池心当声源会让站在南岸的玩家听到水从池中心"飘"过来，左右还会随位置失真。
 * 这不是精确的最近点（那要求解四次方程），但对 pan 这种感知量足够，
 * 且**单调、连续、无需迭代**，每帧调用不会带来可测的开销。
 */
export function nearestOnEllipse(x, z, cx, cz, a, b){
  const lx = x - cx, lz = z - cz;
  const nx = lx / a, nz = lz / b;
  const m = Math.hypot(nx, nz);
  if (m < 1e-6) return { x: cx + a, z: cz, dx: a, dz: 0, dist: a };  // 正中心：取 +x 岸兜底
  const sx = nx / m, sz = nz / m;
  const px = cx + a * sx, pz = cz + b * sz;
  const dx = px - x, dz = pz - z;
  return { x: px, z: pz, dx, dz, dist: Math.hypot(dx, dz) };
}

/** 一次算出某声源的 pan 与 gain，供音景与门禁共用同一口径。 */
export function spatialMix(listener, source, opts = {}){
  const dx = source.x - listener.x, dz = source.z - listener.z;
  const dist = Math.hypot(dx, dz);
  return {
    dist: +dist.toFixed(4),
    pan: spatialPan(dx, dz, listener.yaw || 0),
    gain: spatialGain(dist, opts.maxDist ?? 24, opts.floor ?? 0.4),
  };
}

/* ── 池声听感（2026-11-26 复核修正 · 批次 #24 的池内回归）────────────────────────
   #24 把水声声源改成"椭圆岸线上离听者最近的点"，对站在岸上的人是对的；
   但石拱桥 (8.4,4.6) 的桥面和桥南汀步都是**能走上去的池内位置**（归一化池距 ≈0.56）：
   脚下就是水，按"最近岸线"算却成了"水从 6.7m 外的东岸传来"——增益从 #18 的 1.9 掉到 ≈1.52、
   pan 甩向一侧。#18 的口径是 u<1（椭圆内）一律 1.9（水就在脚边），这里恢复它：
   椭圆内 ⇒ 增益 1.9、居中；椭圆外 ⇒ 与 #24 逐位相同（最近岸点 + 24m 处落到 0.55）。
   out 由调用方给（每帧调，零分配）；返回 out = { gain, pan, inside }。 */
export const POND_EAR = Object.freeze({ cx: 0, cz: 3.0, a: 15.7, b: 9.4, near: 1.9, floor: 0.55, slope: 0.0562 });
export function pondEar(x, z, yaw, out = { gain: 1, pan: 0, inside: false }){
  const E = POND_EAR;
  const lx = x - E.cx, lz = z - E.cz;
  const nx = lx / E.a, nz = lz / E.b;
  const m = Math.hypot(nx, nz);
  if (m < 1){                       // 椭圆内（桥面 / 汀步）：水就在脚下
    out.gain = E.near; out.pan = 0; out.inside = true;
    return out;
  }
  /* 椭圆外：与 nearestOnEllipse 同式（不建对象） */
  const dx = E.cx + E.a * (nx / m) - x, dz = E.cz + E.b * (nz / m) - z;
  out.gain = Math.max(E.floor, E.near - Math.hypot(dx, dz) * E.slope);
  out.pan = spatialPan(dx, dz, yaw);
  out.inside = false;
  return out;
}
