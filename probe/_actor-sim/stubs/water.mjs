// 桩：05-water.groundHeight（确定性的小起伏）
export const groundHeight = (x, z) => -0.05 + 0.02 * Math.sin(x * 0.3) * Math.cos(z * 0.2);
