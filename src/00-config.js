// 00-config: from index.html inline 106..130
/* ══════════════════════════════════════════════════════════════
   0 · 配置与工具
   ══════════════════════════════════════════════════════════════ */
export const CFG = {
  garden: { w: 60, d: 45 },        // 园林平面尺寸
  wall:   { h: 4.5, t: 0.6 },      // 粉墙高 / 厚
  water:  0,                       // 水面高度 Y
  sun:    { color: 0xfff6e2, intensity: 1.12, pos: [42, 56, 30] },
  amb:    { color: 0x8899aa, intensity: 0.50 },
  fog:    { color: 0xDCE0E2, density: 0.0052 },
};

// 可复现随机：保证每次刷新园林形态一致
export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
/* ⚠️ 2026-09-23 回退说明：排查"冷/热启动布局不同"期间，这里临时包了一层计数/检查点/栈聚合
   （rndCalls / captureRnd / __cp / __initEnd）。根因已查清并修掉（见 06-vegetation 的 jr 专用抖动流
   与 08-assemble 的预抽），故**按当时的约定回退成直接引用** —— 包一层函数会让 rnd 不再是
   mulberry32 的直接引用（对外语义不变，但没必要留着）。
   ⚠️ 那段临时实现**从未提交，已随本次回退消失**（不在 git 历史里）。日后若要再查"全局流漂没漂"，
   按这三件事重新写一遍即可：① 用 `let n = 0` 数抽取次数；② 每 1000 次记一个滚动哈希检查点
   `h = imul(h ^ ((v*1e9)|0), 16777619)`（冷/热两次比对，第一个不同的检查点就把分歧锁进 1000 次窗口）；
   ③ 需要"谁抽的"时用 `new Error().stack` 按签名聚合（注意：延迟链会把主线程占满，
   `setInterval` 轮询会被饿死，得把计数打进入产品日志或按次数区间触发捕获）。 */
export const rnd = mulberry32(20260909);

export const rr  = (a,b)=>a+rnd()*(b-a);
export const pick= a=>a[(rnd()*a.length)|0];

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// 统一登记：便于统计与批量设置阴影
export const registry = { meshes: 0, geos: 0, mats: 0 };

/* 跨模块「延迟绑定」挂钩 —— 专为打破 ESM 环而设（2026-09-20 拆模块时踩出来的）。
   ⚠️ 起因：12-env 需要 11-loop 的 queuePostcard / toggleSound（明信片、音景两个按钮），
   于是构成 2b-wind → 12-env → 11-loop → 2b-wind 的环。11-loop 的 body 里紧接着就
   `animate();` 和 `window.__garden = {...}`（要读 2b-wind 的 windClock、12-env 的 ENV），
   而它被环提前拽进来时 2b-wind 才求值到一半 → 启动期直接 TDZ：
   `Cannot access 'windClock' before initialization`，而且**渲染循环每帧重复报**。
   解法：凡是「只在事件回调里用」的跨模块引用，一律走本挂钩（回调触发时所有模块早已就绪）；
   静态 import 只留给**顶层就要读**的依赖。
   ⚠️ 挂钩对象必须住在模块图最上游（本文件），否则挂钩本身也会变 TDZ 源。
   ⚠️ 只登记"稍后才调用"的函数；顶层立刻要用的东西别往这里塞，那只是把 TDZ 藏起来。 */
export const HOOKS = {};

/* 当前环境（ENV）的**反查插槽** —— 同样是破环用：2b-wind 只在函数体里读天气参数
   （updateWindForce 的 windMul），但 12-env 顶层会 applyEnv() 读 2b-wind 的 gust →
   直接互相 import 就成环，2b-wind 先求值、12-env body 撞上尚未初始化的 gust（实测 TDZ）。
   由 12-env 在 `ENV.cur = resolveEnv()` 之后立即发布。⚠️ **发布的是解析后的参数集 `ENV.cur`，
   不是状态机 `ENV` 本身** —— windMul / gustMul 这些天气参数都挂在参数集上；挂错对象读出来
   全是 undefined，再被读侧的 `|| 1` 兜底吃掉 = **静默退化成晴天**（2026-09-20 实测：L2 风力
   调度器在暴雨里永远选微风档，画面风感全部偏弱）。
   ⚠️ 通则：**兜底默认值只能挡"还没发布"，挡不住"发布错了对象"** —— 破环插槽的两端必须
   对齐"发布的是什么形状 / 读的是哪个键"，注释要写死。 */
export const ENV_REF = { cur: null };

/* 启动分段计时：init 要 3~4 秒，只看"卡"没用，得能说出时间花在哪一段（审计 P04）。
   ⚠️ 定义必须留在模块图**最上游**（本文件）：程序化贴图与材质库都在 01-materials 的模块体里跑，
   若 t0 跟着写在那儿，就会晚于它文件顶部的 8 张 canvas 贴图 + 3 张法线派生 ——
   那段耗时在 [启动分段] 日志里**完全不可见**（2026-09-20 修）。
   只在控制台输出。注意外部采集器可能把 performance.now() 换成虚拟时钟，那种环境下本行不准。 */
export const BOOT = { t0: performance.now(), marks: [] };
export function bootMark(name){ BOOT.marks.push([name, +(performance.now() - BOOT.t0).toFixed(1)]); }

