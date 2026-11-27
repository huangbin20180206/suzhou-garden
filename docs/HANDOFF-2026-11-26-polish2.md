# HANDOFF 2026-11-26 · hark/polish2（复核尾项 · 效率尾项 · 场景打造）

基线：d0f4512（hark/polish2）。沙箱本地提交，**未推送**。
沙箱只跑了纯 node 门（eslint 0、`npm run unit` 130+16 全绿、check、import-audit、gate-count-sync、
preload-manifest-sync、changed-map-unit）；**浏览器门一道都没跑**，见第四节。
四份重播基线（probe/_actor-sim/baseline）+ perstep 基线逐帧未变（actor-replay-unit 绿，本批没动 16-actors）。

## 一、提交清单

### 上批（复核三提交 + 效率批三提交，开工前已在分支上，本批第 0 步复验全绿）
| 提交 | 内容 |
|---|---|
| 9e6b528 | fix(sound)：桥面/汀步上水声回到脚下（#24 把池内可走位置算成"水在最近岸线"） |
| 5ce2dd5 | docs(sim,sound)：perStep 默认开后的两处过期注释 + 雷声 pan 计算时刻 |
| 16d6bfe | chore(vista)：驻足卡「堂额」堂名改取 03a SITE_NAMES.hall |
| 8322fe6 | perf(actor)：演员/def/VISIT 同形 + 骨骼写入走标量槽（装箱 22.5→14.7KB/帧） |
| f140f12 | perf(env)：环境过渡期阴影图按需重渲（3 秒过渡 180→31 次） |
| d0f4512 | perf(boot)：并行预编开关 ?warm=par / ?precompile=1（默认关） |

### 本批
| 提交 | 类别 | 内容 |
|---|---|---|
| 828828e | 效率 | 场景矩阵每帧只算一次：animate 在 composer.render() 前手动 `scene.updateMatrixWorld()`，主/反射/GTAO 与随后的折射渲染期间关 `scene.matrixWorldAutoUpdate`（try/finally 还原）。逃生口 `?matrix=auto`。11-loop 暖机注释里"compileAsync 负优化"改写为已查明根因（渲染目标为 null ⇒ outputColorSpace/toneMapping 宏与生产帧 RT 不一致）。unit-pure 的 perfFlags 用例补 matrixOnce。 |
| 85eb280 | 复核① | 堂内窗暖去掉二次日高门：`hallWarm = lamp × 0.55`（日高门只在 composeEnv 的 lamp 上做一次）。灯的云量门由线性 (0.82−云)/0.34 改 `1 − smoothstep(0.75, 0.92, 云)`：晴类云 0.50~0.62 原先漏 6%~41% ⇒ 夏晴 15:45 灯 0.023、17:00 0.015、17:30 0.096 不单调；现在晴类午后单调升、上午单调降。锚点：暮（7°）0.1375、夜 0.55 不变。阴雨雪白天灯不压，窗暖随之同亮（与灯同一口径）。env-blend-unit 补"窗暖=灯×0.55""单调"两项。 |
| 882e443 | 复核②③ | 驻足卡：匾触发心从 target 南移 2m（上层台基前沿 (0,−6.9)）、半径 3.0；选择规则改"只在可弹点里按 距离/半径 挑、同分取下标小、正在显示的卡 4s 内不被相邻点顶掉"（00c-ux `pickVistaSpot`）。沿中轴北行：z≈−3.9 先弹匾、z≈−8.5（门槛）弹远香堂（原来要进门到 −10.45）。spot 改持机位 target **引用**，stele 回填后自动与 hero 分开；回填前重合时按 SPOT_DEFS 顺序（stele 先）确定。桥名统一「石拱桥」（新增 03a `SITE_NAMES.bridge`；巡游按钮、机位 label、字幕标题、驻足卡同源），文案改"半圆桥洞与水中倒影合成一轮满月"。ux-pure-unit +4。 |
| 149b3c9 | 已知未做 | 星点按空气含水量收（fxGates.starPts = 云遮值 × (1 − 0.70·smoothstep(0.45, 0.72, H))）：薄雾夜 0.745→0.23（原来比晴夜 0.532 还亮）；晴/雨后/雪霁子夜一字不变，黎明晨湿处绝对差 ≤0.017。12-env 的 uStarAmount 改取 fx.starPts。 |
| a12d04c | 已知未做 | 水面波光按雾/湿度收（waterSunGates：hazeK = max(smoothstep(0.10,0.70,diskFade), smoothstep(0.55,0.80,H))，×(1−0.6·hazeK)）：薄雾正午 1.0→0.40；晴类（含晨湿）变化 ≤0.01，暮金波光保住。焦散同乘（守"焦散≤波光"）。 |
| 015229d | 已知未做 | 雪化湿地：lingerStep 里地面积雪在化（snowG > 预设）⇒ `L.wet = max(L.wet, 0.55·smoothstep(0,0.15,待化量))`，复用雨余韵通道（湿光/积水/檐滴/空气含水量全走现成写口）；化完约 3 分钟干透；雪霁、decayOnly 不湿。env-nature-unit +1。 |
| 3866237 | 已知未做 | 触屏转头灵敏度按屏幕短边归一：`0.0042 × clamp(760/短边, 1, 2.2)`（00c-ux touchLookGain）。短边 ≥760（桌面/平板）不变；390 手机 ×1.95，半屏一划 ≈100°；横竖屏同手感。鼠标右键 0.003 不动。 |
| 8c90a1b | 生动性 | 风与水/落叶联动（12a `windNature`）：① 池面风皱 chop = 0.30×smoothstep(0.22,0.85,uWindGlobal)，并入水面 uRain 高频扰动并加速法线滚动 —— 晴/薄雾/雨后/雪霁底值风上界 0.20 <0.22 ⇒ 恒 0；暴雨台风档 0.30。② 落叶/花瓣顺风漂改跟风向 uWindVec（原来恒往 +x），阵风时漂速 ×(1+1.2g)。③ 秋季阵风空中叶量 +0.35g。QUALITY_PRESETS 新键 `natureFx`（low=false 关①②的阵风项与③；漂向跟风向这条订正各档都生效）。env-nature-unit +2。 |
| 5feca02 | 交互 | 步行操作提示只教一次：首次进入显示；真走起来（≥40 移动步≈3m 且已显示 ≥4s）收起并记 localStorage `garden.walkhint.v1`；干站 15s 只收不记（下次再教）；webdriver 下保持旧的常驻行为。ux-pure-unit +1。 |
| 1c09f1a | 效率（11-27） | 后期按档分级（00a `postPlan`）：中档 GTAO 内部 0.5→0.375、采样 32→16、去噪 16→8；低/中档 bloom 内部 mip 链 ×0.5（包 setSize）；高档逐项不变。`?postfx=full` 各档回高档后期。 |
| 5074619 | 效率（11-27） | 程序化荷花杆/萼合成 2 个 InstancedMesh（12 朵：24 个 mesh → 2，各 pass 同比省约 22 draw）。名字/noMerge/季节通道不变；风摆相位改按实例锚点（原逐顶点），静帧 mm 级差。`?instancing=0` 回旧。 |
| 363706a | 效率（11-27） | 纯表演动画降频（00a `animLodEvery`）：蜻蜓（闭式航迹）、小鸟（攒 dt）视锥外 4 帧一更、>60m 2 帧一更；人物/鱼/仿真不走此路。`?animlod=0` 关；`__garden.animLodState()`。 |
| dfa362b | 场景（11-27） | 晨雾蛛网露珠：3 张程序化小网（东廊 (16.3,2.15,−0.46)、(22.66,2.15,4.2)，西墙竹丛前 (−24.9,1.2,3.1)）；12a `fxGates(p,out,hour,season).dewWeb` = 晨 5:30~8:30 × 湿 × 非雨雪 × 非冬；丝+露珠共 2 draw，门 0 不可见；低档不建。`AMBIENT.state().dewWeb`。 |
| fc70769 | 场景（11-27） | 人物闲时小动作：侧首/仰望/整袖/换脚，16a `fidgetPick(seed,n)` 确定性选取；advance 后叠、下次 advance 前撤回 ⇒ 重播基线逐帧不变（未重标）。webdriver 默认关；`__garden.actorFidgets()`。 |
| 9875874 | 效率（11-28） | 莲蓬伴生花梗/蕾梗跨组实例化（06m `flushLotusPodStems`，08-assemble 建完 5 处后调）：每处 0~1 根 noMerge 梗 → 花梗/蕾梗各 1 个 InstancedMesh（单位高几何按高缩 y，名字 flowerStem/budStem、noMerge、MAT.lotusStem、cast/recv 不变，不吃随机流）。籽窝/莲子本就由 09b group 拼成 45 实例、莲房/莲面/浮叶/花蕾走材质桶、S 弯茎每根曲线独一份 ⇒ 不动。主/阴影各省 k−(≤2)（k≤5，取决于 jr 流，基线实录后见 draw-estimate）。`?instancing=0` 回旧。09b `podStemXform` + unit-pure +1。 |
| b52315e | 效率（11-28） | 大雁并入降频（08e `updateGooseFlock(dt,t,lod)`）：头雁/波次/换阵每帧照推，单只不轮到攒 dt、轮到时一次缓动（扇翅 t 闭式），新波次重摆清零。锦鲤/萤火/花瓣复核后不扩（见六）。`?animlod=0` 关。 |
| ddb96b6 | 门禁（11-28） | `draw-estimate --check` 修复：基线自 853ccb6 起是**合批后**实录，旧锁再规划无组可拼恒 FAIL。现按口径分流：合批后快照锁「再规划 0 组 + 莲蓬籽窝/莲子 45 实例行在 + 估算不增 + 程序化实例化节省 ≥22」；合批前快照（`--fp <旧指纹>`）仍锁节省 ≥40。荷花杆/萼、莲蓬梗按 `#3e7a34` Cylinder 行计入（基线未实录时荷花按 24→2 预计）。纯 node，现 PASS。 |

11-27 批同样未加新模块、新资源、新门。未加新模块、新资源、新门 ⇒ preload manifest / sw.js CACHE（代码类 network-first，无需升）/ README 门数均不变（102 道，quick 21）。

## 二、新 URL 开关
- `?matrix=auto`：关掉"每帧矩阵只算一次"，回到 three 每次 render 全场重算（排查用；默认开）。
- 11-27：`?postfx=full`（各档按高档后期）、`?instancing=0`（荷花杆/萼回逐个 Mesh）、`?animlod=0`（动画每帧全更）、`?fidget=1|0`（闲时小动作强开/强关；缺省 = 非 webdriver 开）。
- 11-28：`?instancing=0` 同时回退莲蓬伴生花梗/蕾梗；`?animlod=0` 同时关大雁降频（`__garden.animLodState().skips` 含大雁）。
- （沿用）`?warm=par`、`?precompile=1`、`?shadowtrans=all`、`?perstep=0`。

## 三、留给本机的取证
- 矩阵单算的收益：`?matrix=auto` 与默认各量一次稳态帧 CPU 时间（outputs/_diag/matrixworld-cost-2026-11-26.mjs 是上批留下的量法）。
- 诊断脚本（gitignored）：outputs/_diag/lamp-mono-2026-11-26.mjs（灯/窗暖逐刻）、lamp-cloud-2026-11-26.mjs（各天气云量）、star-humid-2026-11-26.mjs（各天气夜 H/星点）。

## 四、本机浏览器门（独占跑，建议顺序）
    npm run unit
    node probe/smoke.mjs
    # 环境（窗暖/灯、星点、波光、雪化湿地、风皱水面）
    node probe/verify-all.mjs --gates=night-sky-guard,lamp-guard,lampvol-guard,afterrain-guard,postrain-guard,mist-guard,fresnel-guard,peach-guard,sky-layer-guard,pmrem-env-guard,reflect-adaptive,nearview-clarity-guard,weather-coverage,reel-guard
    # 渲染路径（矩阵单算）——再加 ?matrix=auto 对照一次 layout/像素类
    node probe/verify-all.mjs --gates=shader-guard,refract-guard,refract-coverage,gtao-halfres,aa-progressive-guard,longexposure-guard,warmboot-guard,gl-warning-guard,layout-fingerprint,legibility-guard,pageerror-guard,fixed-timestep-guard
    # 交互（驻足卡、桥名、步行提示、触屏转头）、面板换行
    node probe/verify-all.mjs --gates=walk-guard,walk-real-guard,tour-guard,intro-guard,guide-guard,season-demo-guard,postcard-guard,mobile-panel-guard,touch-target-guard,panel-icons-guard,desktop-quality-guard,pwa-cache
    # 落叶 / 风
    node probe/verify-all.mjs --gates=wind-trajectory,wind-audit,festival-guard,birds-guard
    # 11-27 批：后期分级 / 荷花实例化 / 降频 / 蛛网 / 小动作（layout-fingerprint 会报新增 2 行荷花杆/萼 InstancedMesh ⇒ 人眼确认后 --update-baseline）
    node probe/verify-all.mjs --gates=gtao-halfres,desktop-quality-guard,layout-fingerprint,peach-guard,birds-guard,mist-guard,reflect-adaptive,pageerror-guard,gl-warning-guard
    node probe/layout-fingerprint.mjs --update-baseline   # 仅在确认只多了荷花杆/萼两行后
    # 11-28 批：莲蓬梗实例化 / 大雁降频。layout-fingerprint 预期再多 ≤2 行 #3e7a34|k|CylinderGeometry（花梗、蕾梗；k 合计 ≤5），
    #   即相对 11-26 基线共多 ≤4 行 #3e7a34 Cylinder（荷花杆 12、萼 12、花梗 k1、蕾梗 k2），其余行与总数不变 ⇒ 人眼确认后 --update-baseline
    node probe/verify-all.mjs --gates=layout-fingerprint,birds-guard,wind-audit,refract-coverage,pageerror-guard,gl-warning-guard
    node probe/layout-fingerprint.mjs --update-baseline
    node probe/draw-estimate.mjs --check   # 更新基线后复跑：「程序化实例化」应显示"指纹实录：行 12+12+k1+k2"、节省 = 22 + k−2
    npm run verify -- --changed                    # 兜底（--changed=d0f4512 几乎全选，因为 11-loop 变了）；有余力跑全量 npm run verify

最可能需要看的：`mobile-panel-guard`（导览行「曲桥」→「石拱桥」多 1 个字，390 宽可能多折一行；面板留有约 72px 余量）、`night-sky-guard`（薄雾夜星点变暗）、`lamp-guard`/`lampvol-guard`（晴类下午灯完全熄到 17:00 后才起）。

## 五、人眼验收点
- 夏晴 16:00~17:30 拖时辰：灯笼与窗纸只亮不暗、17:15 之前不亮；阴/雨天下午灯与窗纸同亮。暮/夜观感与改前一致。
- 薄雾夜：疏星仍在、明显少于晴夜，无银河；晴夜星空不变。
- 薄雾正午池面：只剩被雾裹住的一点亮，不再白闪一片；晴天正午/秋晴暮金波光不变。
- `__garden.aftermath(true)` 后冬雪→晴：屋顶先化，地面化雪过程中石板/草地是湿的（湿光、浅积水、檐下滴水），雪化完约 3 分钟后干。**积雪+湿地同时出现的着色是第一次组合，最需要看。**
- 暴雨台风档：池面随柳条一起变碎、滚得快；风档回落时池面跟着平。晴天池面与改前一样。
- 春/秋：花瓣、落叶的漂向与竹柳倒向一致；秋季阵风来时空中叶子变多。
- 步行：从院中沿中轴北上，上台阶先弹「堂额」卡，走到门槛弹「远香堂」卡；立峰/题名石两站各弹各的。巡游按钮与字幕标题为「石拱桥」，桥卡文案为满月句。
- 手机：首次步行有提示，走几步后消失、退出再进不再出现；清 localStorage 后重现。390 宽竖屏转头明显变快（半屏一划约 100°），平板/桌面触屏手感不变。390 宽面板导览行是否多折一行（未实测）。
- 11-27 · 中档（`?tier=mid`）对 `?tier=mid&postfx=full`：AO 接触阴影与灯笼/月 bloom 晕圈应几乎一样；高档无变化。
- 11-27 · 荷花：近看杆/萼位置高度与 `?instancing=0` 一致；风里杆整体摆（不再逐顶点抖）；春季无杆、悬停仍出「荷花」。
- 11-27 · 降频：转身背对蜻蜓/小鸟再转回，无跳位；远处小鸟动作不卡顿到可见。
- 11-27 · 夏/秋 晨 7:30 薄雾或阴：东廊两柱间、西墙竹前有细丝和点点晶亮慢闪；晴晨 6:00 后渐显；9:00 后、雨雪天、冬季、低档都没有。**蛛网位置是按柱距推算的，最需要看是否悬空/穿挂落。**
- 11-27 · 人物站着不动时每 6~16s 偶尔侧首/仰望/整袖/换脚，幅度小、无弹跳；走路、作揖、挥别、端茶、刷马时不出；孩童不整袖。
- 11-28 · 莲蓬：夏季近看 5 处莲蓬旁的伴生荷花梗/花蕾梗位置、粗细、倾斜与 `?instancing=0` 一致；风里整根摆（同荷花杆）；春/秋随季节显隐不变。
- 11-28 · 大雁（秋）：转身背对雁阵再转回，队形无跳位/无拉长；飞远时扇翅不卡。
- 默认画面（夏晴午）任何角度都不应有可见变化（矩阵单算零像素；本批其它项在夏晴午均为 0 偏差）。

## 六、已知未做 / 跳过
- 生动性候选：晨雾蛛网露珠、人物闲时小动作 11-27 已做（见上）。"雨天池面雨点涟漪密度随雨强变化"现状已具备（12-env updateRainRipples 间隔 0.17~0.9s 随雨量、簇大小随雨量），未再改。
- 落叶漂向跟风向在低档也生效（它是方向订正，不是特效）；如要低档逐像素回旧行为需另加开关。
- 灯笼问题按派单跳过（11-25 已修）；春夜蟋蟀、梅雨蛙鸣仍无实证未加。
- 390 宽面板换行：本批只能确认按钮文字 +1 字，换行与否须 mobile-panel-guard / 人眼。
- advance() 未拆、three 内部 raycast clone 未动（同上批）。
- 本批没有卡住超过两次的项。
- 11-27：InstancedMesh 只做了荷花杆/萼一类（其余重复小件大多已被 09b 合批/实例化）；莲蓬组（5 处×每处 4~6 件）跨组合并未做。降频未覆盖锦鲤（有饵/惊鱼/涟漪与门禁耦合）、大雁、萤火/花瓣（着色器驱动或跟相机）。
- ~~`draw-estimate --check` 旧指纹 FAIL~~ 11-28 已修（ddb96b6）；莲蓬梗的确切 draw 节省要等本机 `--update-baseline` 实录后才在台账里出现。
- 11-28 莲蓬：S 弯茎（每根 Tube 曲线由 bend/lean 随机定，非仿射同形）不能实例化，仍 5 draw；若要再省需改成"单位曲线 + 顶点着色器弯折"，涉及风摆与折射层，未做。
- 11-28 降频不扩：锦鲤（两遍走同帧 cohesion、跃水穿越触发涟漪的时刻、投喂斜坡与 koi-orbit/koi-feed/koi-ripple 耦合；11 条轻量算术，收益抵不过风险）；萤火（ShaderMaterial uTime 驱动，CPU 只写 uOpacity，无需降频）；花瓣/落叶（12i 跟相机包围盒粒子，逐粒判视锥≈逐粒更新代价）。泳龟/鸭未评估。
- 11-28 其余纯 node 小项：未发现可不经人眼收尾的遗留；落叶漂向低档开关仍未加（需人眼判断是否要）。
