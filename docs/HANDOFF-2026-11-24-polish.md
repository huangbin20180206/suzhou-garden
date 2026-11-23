# HANDOFF 2026-11-24 · hark/polish（视觉 · 自然真实 · 业务逻辑 · 交互 · 执行效率）

基线：origin/master 1a38d48。分支 hark/polish，14 个提交，沙箱本地，未推送。
沙箱只跑了纯 node 门（eslint 0 error、npm run unit 全绿、check、import-audit、gate-count-sync、preload-manifest-sync）；**浏览器门一道都没跑**，见第三节。

## 一、提交清单

| 批次 | 提交 | 内容 |
|---|---|---|
| 1 视觉 | 834db62 / bbde6f8 | 特效门控收进 12a `fxGates`：银河不进雾雨雪夜（独立 uMilkyWay）；余辉与云受光乘白天度；焦散独立 uCausticVis 只取正午段×shadowK；云影离开阴雨与日落后并消除暮色硬切；堂内窗暖仰角 12°~22° 收掉。新单测 env-blend-unit（11 项）。 |
| 2 自然真实 | 0d87387 / 0dd5f77 | 生灵/声景门控（萤火梅雨与雨后、蜻蜓雨量>0.12/冬/夜不飞、荷叶水珠只在雨后、花瓣夜暗与暴雨、冬鱼跃×0.25、冬芭蕉无雨声、冬晨山雀、雪地闷脚步与积水水声）；统一空气含水量（远山谷雾、倒影蒙化；默认夏晴午零偏差）；天气余韵（雨停约 5 分钟干透，雪停屋顶石面 3 分钟、地面 8 分钟；setEnv 默认不带余韵，`__garden.aftermath(true)` 打开）。新单测 env-nature-unit（17 项）。 |
| 3 业务逻辑 | 2db7921 / 4e2df49 / 87fa9e9 | 雪天到访改读余韵积雪（满雪雪停约 4 分钟才开演）；看门狗中途复位未清 pairDrive → 下一场主人冻住（四种开关组合都可复现）已修；步行模式人物 0.75m 外让行、8s 超时照走；听琴入夜抚琴人随戏可见。四份重播基线逐帧未变。新单测 visit-edge-unit（12 项）。 |
| 4 交互 | 1331234 / 1cdf573 / 05b7773 | 驻足卡 Esc/下滑/点卡外关闭，2 分钟冷却；触屏摇杆 18% 死区 + 1.6 次幂（原来恒全速）、多指不再误投石划水、转屏释放输入；首访入口小红点；prefers-reduced-motion（`?motion=1/0` 强制）；低电量<20% 未充电降 performance 档；音量/开关记忆；分享链接（hash：`#v=1&s=autumn&h=17.25&w=mist&c=x,y,z&t=x,y,z`）。SW CACHE v46。新单测 ux-pure-unit（13 项）。 |
| 5 效率 | 8cdb8c6 / 8fede27 / 348de7b / e1d85e0 | 帧内 THREE 对象构造 8.49→0/帧（堆 ~60KB→~50KB/帧，余量是 advance() 里的数值装箱）；时光流转目标改关键帧插值（重算 1→0.23/帧，最大偏差 0.0087），地表三项改为输入变了才算；`FIXED_STEP_POLICY.perStep`（默认关，`?perstep=1` 开）及基线 carriage-walkback-perstep；纯 node 微基准 probe/perf-sim-bench.mjs。 |

README 门数：102 道（quick 21），探针 176。

## 二、待 Kyle 决定
- **perStep 是否默认开**：开启后相位链不变，相位时刻差 ≤3s（两场 835s 中 0.35%），路线差 ≤0.275m；actor 每帧 124→236µs。建议浏览器门在 `?perstep=1` 下通过后再默认开。

## 三、本机浏览器门（建议顺序，独占跑）
    npm run unit
    node probe/smoke.mjs
    node probe/verify-all.mjs --gates=night-sky-guard,hill-guard,mist-guard,sky-layer-guard,reel-guard,fresnel-guard,afterrain-guard,postrain-guard,pmrem-env-guard,sound-guard,indoor-precip-guard,legibility-guard
    node probe/visit-carriage-guard.mjs            # 再加 ?perstep=1 跑一次
    node probe/verify-all.mjs --gates=walk-guard,walk-real-guard,horse-motion-guard,thunder-guard,intro-guard,tour-guard,season-demo-guard,postcard-guard
    node probe/verify-all.mjs --gates=layout-fingerprint,mobile-panel-guard,touch-target-guard,pageerror-guard,pwa-cache
    npm run verify -- --changed                    # 最后兜底；有余力再跑全量 npm run verify

## 四、人眼验收点
- 夏晴夜北天变暗、银河仍在；mist/storm 夜无银河。秋晴暮有金波光无焦散网。春晴 16:00 窗纸不亮。雨/雾正午无云影。
- `__garden.aftermath(true)` 后：storm→clear 积水檐滴约 3.5 分钟消失；冬雪→clear 屋顶先化、地面后化（**积雪着色器改过，最需要看**）。
- 步行站在院门外 (0,22) 等出迎：主人停下等，让开后接着走。傍晚时光流转，听琴段入夜抚琴人仍在。
- 复制链接新标签页同一幅画；Esc 关卡后 W 能继续走；手机下滑关卡、三指点池面不投石、转屏摇杆正常；390 宽竖屏留影行是否多换一行（未实测）。
- 系统开减弱动效：步行无起伏、雷雨闪屏减弱。

## 五、已知未做
- 星点本身在薄雾夜仍 0.745（旧观感）；灯笼下午 14:50 起亮（10-30 以来老行为）；薄雾正午水面波光照开。
- 春夜蟋蟀、梅雨蛙鸣无实证未加；雪化时地面不变湿。
- 触屏转向 0.0042 rad/px 偏慢但无实证未改。
- advance() 未拆（装箱分配的主要来源）；three 内部 raycast clone 未动。
