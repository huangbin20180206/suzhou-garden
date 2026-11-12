# 2026-11-12 · 真机三报：卡在「即将开园」/ 坐姿喝茶穿模 / 红衣童子朝向

老黄把项目发布到 Cloudflare Pages 之后，在真浏览器里报的三件事。
第 1 条是**发布阻断级**，另两条是观感修复。

---

## 一、加载页停在「即将开园」1~2 分钟不动（最严重）

### 定位
`08-assemble.js` 的 `runDeferredBoot()` 收尾函数 `finish()` 原本四步**裸跑**：

```js
const finish = () => {
  mergeStatics(deferRoot);      // ①
  collectSeasonCaches();        // ②
  applyEnv(ENV.cur);            // ③
  collectAOSkip();              // ④
  renderer.shadowMap.needsUpdate = true;
  markBootDone();               // ← 永远执行不到（若上面任何一步抛错）
};
```

`markBootDone()` 兑现 `bootDonePromise` ⇒ `11-loop.js` 里
`document.getElementById('loading').classList.add('done')` 才执行 ⇒ 加载层才收起。

**任何一步抛异常 ⇒ 加载层永久停在「即将开园」，用户永远进不来。**

### 结构性不对称（这是关键，不是偶发）
同函数里的 `runOne()` **一直有 try/catch**（单批失败只跳过那一批、继续跑），
唯独收尾这五步没有。这不是某次意外，是写的时候就漏了。

### 改法
四步各自 `guard()` 包一层，`markBootDone()` 放进 `finally`：

```js
const guard = (label, fn) => {
  try { fn(); }
  catch (e){ fails.push(...); console.warn('[延迟装配·收尾] ' + label + ' 失败（已降级继续）：', e); }
};
try {
  guard('mergeStatics', () => mergeStatics(deferRoot));
  ... 其余四步同形 ...
} finally {
  markBootDone();       // 无论前面发生什么，加载层一定收
  bootJobs.length = 0;
}
```

**取舍口径（老黄拍板：宁可降级也别卡死）**：这五步是在**已经能渲染的场景**上做补正
（合并省 draw call / 重收季节缓存 / 套一遍环境 / 重算 AO 排除表 / 补一次阴影）。
任何一步失败，画面仍完整可看、只是不最优 —— 远好过永久卡在加载页。
失败明细进 console.warn + 汇总成一行，便于事后定位是哪一步坏了。

`markBootDone()` 的语义随之从"装配完美成功"变成"装配已结束"。

### 验证（`01-finish-guard.log`，负例自检）
`page.route` 注入，让收尾第一步 `mergeStatics` 强制抛错：

```
正常                 收层=true（21.4s） bootDone=true loopErr=0
负例·收尾第一步抛错   收层=true（21.4s） bootDone=true loopErr=0
   ⚠ [延迟装配·收尾] mergeStatics 失败（已降级继续）： Error: 负例：故意让收尾抛错
```

**修复前这一格会是"永不收层"。**

### ⚠️ 诚实交代：本机复现不出原故障
本地无头环境里收层正常（high 32.1s / low 20.7s，`bootDone=true`，零报错），
**没能复现老黄真机上的卡死**。所以本条修的是**确定存在的结构性缺陷**
（收尾抛错 = 永久卡死），而不是"抓到了那个具体异常"。
真机上是哪一步抛的错，仍需老黄复测确认 —— 若修复后再卡，而是别的路径。

---

## 二、坐姿喝茶穿模（手臂插进身体）

### 根因
`16a-actor-props.js` 的 `TEA_ARM.hold / lift` 两组角是**按站姿**解出来的
（文件里有求解记录：hold 手落 (−0.05,1.17,0.33) 误差 2cm）。

而 `SIT_ARM`（2026-11-09 加的坐姿补偿）只叠在 `relaxed` 基础分支上：

```js
set('RightUpperArm', relaxed.x + swing + SIT_ARM.x * sl, 0, -relaxed.z - SIT_ARM.z * sl);
```

喝茶段在其后执行，**绝对覆盖右臂**：

```js
set('RightUpperArm', bl * (1 - r1) + TEA * r1, 0, ...);   // ← 坐姿补偿被整个冲掉
```

⇒ 坐下时髋降 0.36m，而手臂按站姿抬到胸前，等于相对多抬 0.36m ⇒ 插进身体。

### 改法（含一次自我纠错）
**第一版写错的**：把 `SIT_ARM.x * sl` 加进了 `bl`，然后 `bl * (1 - r1)` ——
`r1=1`（手举到颌下）时 `(1-r1)=0`，**补偿被乘没了，等于没修**。
而 `r1=1` 恰恰就是"坐着喝茶"那一帧。

**正确写法**：补偿加在插值结果**之后**：

```js
set('RightUpperArm',
    bl * (1 - r1) + TEA插值 * r1 + SIT_ARM.x * sl, 0,
    bz * (1 - r1) + TEA插值 * r1 - SIT_ARM.z * sl);   // 右臂 z 与左臂反号
set('RightLowerArm', ... + SIT_ARM.ex * sl, 0, 0);
set('RightHand',      ... + SIT_ARM.hx * sl, ...);
```

`sl = st2 * r1`（坐姿度 × 抬手度）：
- `st2=0`（站着）⇒ `sl=0` ⇒ **与改动前逐位一致**，站姿喝茶完全不受影响；
- `st2=1 且 r1=1`（坐着举杯）⇒ `sl=1` ⇒ 补偿完整生效（本条要修的那一帧）；
- `r1` 由 0→1 时补偿渐入，抬手过程连续不跳。

### 覆盖到的真实路径
到访流程 `16-actors.js:3669` 的喝茶相位：`host.offerW = 0.88 * w`，此时 `host` 坐着
（`sitTarget=1`）⇒ `st2=1`、`sip=0.88` ⇒ `r1=min(1, 0.88/0.35)=1` ⇒ `sl=1`。

### ⚠️ 诚实交代：只有推演，没有实测图
我试图构造"坐姿+举杯"的实测环境（想直接写 `sitW`/`offerW` 再量手骨世界坐标），
但 `__garden` 没有暴露写这些状态的接口（`actorState()` 是只读的），
三次尝试都拿到**站姿**读数（两臂 A/B 结果逐位相同 ⇒ 状态没被改动）。
**所以本条的正确性依据是：到访流程里的真实数值 + 插值公式推演，不是实测。**
需要老黄在真机看到访喝茶那一段确认。

---

## 三、红衣童子朝向

### 改动
`16-actors.js` 的 child1：`spot.yaw` 从 `0`（面朝南）改成 `-2.36`（面朝西北·堂前台阶一侧）。

### 为什么取西北
坐标系约定（+x=东 / +z=南）。实测主客轨迹相对他：平均 dx=+5.92、dz=−0.73（东偏北），
与老黄箭头（朝堂前台阶，西北）差约 90°。
**信箭头**：他是侍立门房，礼制上面朝主位（堂屋台阶），主客从身侧经过时侧身相对；
面朝东等于背对堂屋，读作"在干别的"。

### 连带影响（必须记录）
`homeOf()` 用 `def.spot` **同时**定义位置与朝向：

```js
return { pt: [a.def.spot.x, a.def.spot.z], yaw: a.def.spot.yaw };
```

⇒ 改 yaw 会改变童子走回原位的落点朝向，并连带影响行走轨迹。
实测（`02-baseline-diff.log`）：位置最大偏移 96.4cm（帧8，t=3.2s），末帧位置不变。

**这是有意的行为变更**，按 `probe/actor-replay-unit.mjs` 文件头规定
（"有意改行为时重录基线：ACTOR_SIM_RECORD=1 ... 提交说明里写清为什么变"）
重录全部 4 份基线。

---

## 四、门禁

| 门 | 读数 |
|---|---|
| `npm run check` | PASS（403 文本文件 UTF-8） |
| `actor-replay-unit` | **8/8 PASS**（4 份基线全部重录） |
| `layout-fingerprint` | ALL PASS（2 项）—— 铁律 1 未破 |
| `visit-carriage-guard` | ALL PASS（34 项） |

---

## 五、顺带发现（本次未改，留记录）

1. **`#stats` 调试面板永远显示**（`index.html:61`，右下角 draw calls / triangles /
   geometries / textures）。发布给朋友看时这块会破坏观感，建议加个默认隐藏或仅在
   `?debug=1` 时显示。**本次没动**，因为不在老黄这次的三条要求里。
2. **加载层收起后画面是静止的**，只有左上角一行淡色的「按 0 恢复机位」。
   首次引导（`GUIDE_STEPS` 三步）只在 `localStorage` 无记录时自动弹，
   老黄反复测试时早已记录过 ⇒ 看不到 ⇒ "不知所措"。新访客会看到，但
   **若用户在引导出现前动了一下鼠标，引导会被 `bindGuide` 的首次交互即消失逻辑关掉**。
   这条值得单独评估要不要改成"收层后先静置 1.5s 再允许消失"。
3. 本机搭载的插件/探针在 `navigator.webdriver=true` 下会跳过引导，
   所以所有无头截图都拍不到引导 —— 排查时容易误判成"引导坏了"。