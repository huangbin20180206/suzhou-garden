// 12f-season: 植被季节表现（色调注入）+ 季节存在性 + 积雪覆盖 + 湿地 —— 2026-10-05 从 12-env.js 整块搬出。
/* 为什么单独一个文件：这一块做的是"按季节把**几何/材质**收掉或换色"，与 12-env 的时段/天气参数、
   applyEnv（把参数落到渲染对象上）、面板 UI 是两件事。原块 378 行，是把 12-env 逼近 1900 行的第二大头。
   ⚠️ 本文件**不能** import './12-env.js'（12-env 反过来 import 本文件 → 成环、启动期 TDZ，项目多次前科）。
   它只在函数体里读环境状态（onAssetAttached 用 ENV.cur 重刷一次季节），由 12-env 注入：
   `bindSeasonEnv(ENV)`。
   ⚠️ 几个"老坑"原样保留（都是踩过的，别以为能简化）：
     · seasonMeshCache 的填充必须并进 collectSeasonCaches —— 分开收会让紫藤花在冬季照常提交；
     · 本文件里**没有**顶层 collectSeasonCaches()：它 traverse world，而本模块被 08 import、
       在 world 之前求值 ⇒ 顶层调用必 TDZ（调用点仍在 12-env 的 initEnvScene）；
     · installSnow 的 uInLo/uInHi 取自 12e-precip.js 的 PRECIP_INDOOR，**必须惰性求值**（注释里写了）。
   ⚠️ 本文件不导出"只给自己用"的名字（snowBoost 相关、applyWetness 的内部量除外）。 */
import { THREE } from '../vendor.js';
import { MAT, SEASON_TINT_REGISTRY, wetUniform, WET_MATS, addWind } from './01-materials.js';
import { renderer } from './02-scene.js';
import { world } from './08-assemble.js';
import { markCasterBoxDirty, fitShadowCamera } from './09-lights.js';
import { treeLanternInsts } from './06-vegetation.js';
import { PRECIP_INDOOR } from './12e-precip.js';
import { HOOKS } from './00-config.js';
/* ⚠️ 灯会的 4 个材质与挂灯收集**住在 12c**：存在性表要按它们开合（河灯/烛焰/灯串），
   而 collectSeasonCaches 末尾要接一次 collectFestivalHangAnchors（原文的设计：挂点必须在
   季节缓存收完之后才收得到）。直接 import 12c 是单向依赖（12c 不 import 本文件），不成环；
   ⚠️ 但**绝不能**改成从 12-env 转出（12-env 反过来 import 本文件 → 环 + 启动期 TDZ）。 */
import { collectFestivalHangAnchors, riverLampMat, stringBulbMat, riverFlameMat, _hangInsts } from './12c-festival.js';

/* ↓ 由 12-env.js 注入（见文件头） */
let ENV = null;
export function bindSeasonEnv(state){ ENV = state; }

/* ══ 植被季节表现 ══
   色调：给植被材质注入共享 uniform，按「保留明度的换色」重着色 ——
   色相换成季节目标色，明暗仍来自原贴图，这样叶簇的层次不会糊掉。
   ⚠️ 必须链式挂接 onBeforeCompile：叶/柳/苇已经有风场注入，直接覆盖会把风弄坏。 */
// 直接取登记表：这样连运行时克隆出来的材质（地面）也被覆盖
export const SEASON_TINT_MATS = SEASON_TINT_REGISTRY.slice();
export const seasonMixUniform = { value: 0 };
for (const [mat, key] of SEASON_TINT_MATS){
  const uni = { value: new THREE.Color(0xFFFFFF) };
  mat.userData.seasonTint = uni;
  mat.userData.seasonKey  = key;
  const prevCB  = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer){
    if (prevCB) prevCB.call(this, shader, renderer);
    shader.uniforms.uSeasonTint = uni;            // 共享同一对象：所有变体一起变
    shader.uniforms.uSeasonMix  = seasonMixUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSeasonTint;\nuniform float uSeasonMix;')
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        '  float sLum = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722));\n' +
        '  float tLum = max(dot(uSeasonTint, vec3(0.2126,0.7152,0.0722)), 0.06);\n' +
        '  diffuseColor.rgb = mix(diffuseColor.rgb, uSeasonTint * (sLum / tLum), uSeasonMix);');
  };
  mat.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : '') + '|season'; };
}

/* 存在性：程序化植被已被 mergeStatics 按材质合并，只能整体开关；
   GLB 资产（荷/芭蕉/龟）异步挂载、晚于合并，可以逐个控制。 */
/* ══ 上元灯会（河灯 / 灯串 / 挂灯 / 暖光第 4 层）⇒ 已移入 12c-festival.js（2026-10-05 拆分）══════
   原 1390~1892 行整块搬走（纯搬家，除 4 个声明补 export 前缀外逐字未改）；对外的 import / 转出
   写在文件顶部那一处（守卫要求显式 import）。灯会代码要的 6 样东西由本文件 body 里的
   bindFestival(...) 注入 —— 为什么不能反过来 import：见 12c-festival.js 文件头。 */

const SEASON_PRESENCE = [
  ['lotusShow',[MAT.lotus]], ['lilyShow',[MAT.lily]], ['wisteriaShow',[MAT.wisteria]],
  /* 芭蕉假茎**不进** presence 表（第八轮用户常识反馈）：芭蕉是多年生草本，
     冬季地上部枯萎但假茎宿存 —— 假茎的颜色由 tinBanana（冬=枯黄）表达，
     消失的只是冠层（GLB 叶+果，随 bananaShow 缩放/隐藏）。
     旧表把 MAT.banana 也挂在 bananaShow 上，冬天整株消失 = 把多年生当一年生。 */
  ['reedShow',[MAT.reed]],
  /* ⚠️ 莲蓬（莲实）必须跟着荷花一起消失。
     莲蓬的**杆**用 MAT.lily、**头与莲子**用 MAT.lotusPod —— 杆在表里、头不在，
     于是冬季 lilyShow=0 把杆藏了、头还留在水面上，看起来就是"悬空的莲蓬"。
     以后凡是"一株植物由多种材质拼成"，登记表必须把它**整套材质**都收进来。 */
  ['lotusShow',[MAT.lotusPod, MAT.lotusPodAged, MAT.lotusPodDark, MAT.lotusSeed]], ['bananaShow',[MAT.bananaFruit]],
  ['wisteriaShow',[MAT.wisteriaLeaf]],
  /* 桃花（2026-09-21）：花/果/落花/叶各自独立材质才能"只开该开的季节"——
     全植物用一种材质的话季节只能整棵树显/隐，做不出"春开花 → 夏结果 → 秋叶黄"。 */
  ['peachShow',[MAT.peachLeaf]], ['peachBlossomShow',[MAT.peachBlossom]],
  ['peachFruitShow',[MAT.peachFruit]], ['peachPetalShow',[MAT.peachPetal]],
  /* 梅（2026-10-06）：两株梅的**花**各自独立通道（腊梅深冬开、红梅冬末春初开），
     树干与枝不进表 —— 梅是落叶小乔木，冬天要留"疏影横斜"的骨相（进表就会被整株收掉）。 */
  ['plumBlossomShow',[MAT.plumBlossomRed, MAT.plumBlossomYellow]],
  /* 灯会内容也走同一套存在性通道：festivalShow>0.03 才提交。 */
  ['festivalShow',[riverLampMat, riverFlameMat, stringBulbMat]],
  /* ── 2026-10-04 · 陈设（物）的季节通道 ──
     竹帘：夏挂冬撤（用户要的"低垂遮阳"，冬天还挂着就假）。
     卷轴挂画"随季节换画"：**两套画心 + 互补的存在性**，而不是运行时换 map ——
     这样直接复用既有"存在性每帧重申"机制（GTAO 每帧会把 visible 改回 true），
     不必在 applyEnv 里新增一条特殊分支。春/夏 = 青绿山水，秋/冬 = 秋山雪意。
     ⚠️ 材质必须是**共享**的那两份（MAT.bambooBlind / scrollArtCool / scrollArtWarm）：
     克隆一份就进不了这张表，冬天收不掉（莲子/莲蓬踩过三次，这是第四次重申）。 */
  ['blindShow',[MAT.bambooBlind]],
  ['scrollCoolShow',[MAT.scrollArtCool]],
  ['scrollWarmShow',[MAT.scrollArtWarm]],
];
export const seasonMeshCache = new Map();
/* 填充已并入 collectSeasonCaches()（见 willowLeafInsts 一段）：一次遍历同时收
   柳/竹实例与 presence 材质表，并在延迟装配完成后重跑 —— 模块期一次性 traverse
   收不到 deferBoot 里迟到的物件（冬柳回归的根因）。 */
/* 存在性必须**每帧重申**，不能只在过渡里设一次。
   原因：GTAO pass 每帧都会把场景对象的 visible 临时关掉再改回来（AO 的正常做法），
   而 applyEnv 只在 ENV.t < 1 的过渡期间被调用 —— 过渡一结束，没人再重申，
   GTAO 就把 winter 的"花不存在"恢复成了 visible=true。实测就是这样：
     set true  | at gtao.render() <- renderer.render() <- animate()
   同一个根因之前也吃掉过"狂风底值风"。 */
export function applyPresence(p){
  for (const [key, mats] of SEASON_PRESENCE){
    const on = p[key] > 0.03;
    for (const m of mats){
      const list = seasonMeshCache.get(m);
      if (list) for (const o of list) o.visible = on;
    }
  }
  /* 实例化网格再补一道 count：visible 会被 GTAO pass 每帧改回 true，
     而 count=0 时 three.js 根本不提交实例，GTAO 也改不动它。
     花串是"每丛一个 InstancedMesh"（共 14 个），必须逐个处理，不能只认第一个。
     ── 2026-09-22：桃树三套材质改走**分量** count。季节表里 peachShow 春 0.15（先花后叶）、
     peachFruitShow 秋 0.7（果渐疏）、peachPetalShow 春 0.3 一直是小数，但可见性通道只认
     `> 0.03` 的布尔 —— 这三个小数**从来没生效过**：春天本该"花满树、叶刚萌"却直接挂满
     3800 片叶，秋天本该落掉三成果却一个不少。
     按 count 截前缀是唯一不会被 GTAO 冲掉的做法。桃树的实例写入顺序已在 makePeachTree 里
     按乘性散列打散，所以"截前缀"在空间上就是均匀变稀，而不是只掉半边。 */
  for (const [m, key, frac] of [[MAT.wisteria, 'wisteriaShow', false],
                                [MAT.peachLeaf, 'peachShow', true],
                                [MAT.peachFruit, 'peachFruitShow', true],
                                [MAT.peachPetal, 'peachPetalShow', true],
                                /* 河灯/灯串是 InstancedMesh：count=0 ⇒ three 不提交、GTAO 也改不动
                                   （同紫藤那条路的理由）。非灯会态零 draw call。 */
                                [riverLampMat, 'festivalShow', false],
                                [riverFlameMat, 'festivalShow', false],
                                [stringBulbMat, 'festivalShow', false]]){
    const list = seasonMeshCache.get(m);
    if (!list) continue;
    for (const o of list){
      if (!o.isInstancedMesh) continue;
      if (o.userData.fullCount === undefined) o.userData.fullCount = o.count;
      const full = o.userData.fullCount;
      const n = frac ? Math.round(full * Math.min(1, Math.max(0, p[key] || 0)))
                     : (p[key] > 0.03 ? full : 0);
      if (o.count !== n) o.count = n;
    }
  }
  /* ── 枯枝挂灯：走**直接清单**而不是上面的材质缓存表 ──
     ⚠️ 原因：挂灯网格是 `makePeachTree` 在 **deferBoot 延迟批**里建的，而
        `collectSeasonCaches()` 在装配收尾时跑 —— 时序上它能收得到，但**更关键**是
        挂灯网格是**每株桃树一个**、材质共用同一个 TREE_LANTERN_MAT，走材质表虽然也对，
        可它的存在性语义与"季节"无关（只随灯会），混进季节表反而容易被人误读。
        显式清单也和紫藤/柳叶那两组的做法一致（各自一份 max/count 记账）。
     ⚠️ 桃树是**两株**（西岸/北岸），必须整组处理 —— 只改第一个就会出现"一棵树挂灯、
        另一棵没有"（同紫藤只改第一个的老 bug）。 */
  const treeOn = p.festivalShow > 0.03;
  for (const o of treeLanternInsts){
    if (o.userData.fullCount === undefined) o.userData.fullCount = o.count;
    const n = treeOn ? o.userData.fullCount : 0;
    if (o.count !== n) o.count = n;
  }
  /* 柳/紫藤/围栏三批挂灯：同一条"随灯会"的通道，同样走**直接清单**而不是季节表。
     ⚠️ 容量取 `instanceMatrix.count`（建网格时定的），**不是** `o.count` —— count 是被本函数
        改写的量（下一行就写它），拿它当容量会第一次把 count 锁成 0、永不复原。 */
  for (const o of _hangInsts){
    const cap = o.instanceMatrix.count;
    if (o.userData.fullCount === undefined) o.userData.fullCount = cap;
    const n = treeOn ? o.userData.fullCount : 0;
    if (o.count !== n) o.count = n;
  }
}

/* 紫藤花串是**每丛一个 InstancedMesh**，不是整园共用一个：
   实测 14 个（实例数 508/697/702/…/4055）。
   ⚠️ 这里曾经只 find 了第一个并缓存成单个引用，结果冬季只清掉一丛，
   另外 13 丛照常开花 —— 画面看起来"紫藤冬天还在开花"。必须整组处理。 */
const seasonGLB = { LotusPlant: [], BananaPlant: [], Turtle: [] };
/* ⚠️ 不能"一旦非空就不再搜"。莲花 12 株是同一批挂上的没问题，但**乌龟有两批**：
   岸上晒背的 placeAssets 4 只 + 池中缓游的 loadAssetOnce 2 只 —— 先到的那批把数组填满后，
   后到的那批永远进不来，冬季 turtleShow=0 就只藏了一半。改为按对象去重地追加。 */
export function collectSeasonGLB(){
  for (const name in seasonGLB){
    world.traverse(o => {
      if (o.isMesh && o.name === name && seasonGLB[name].indexOf(o) < 0) seasonGLB[name].push(o);
    });
  }
  /* ── GLB 荷花丛进风场（2026-09-17 用户："荷花和荷叶为啥不会随风晃动"）──
     GLB 材质的身份和芭蕉叶一样：异步挂载、材质是 GLB 自带的，
     从来没登记进风场表 —— 于是狂风里只有我们补的那根花梗在摆、花叶本体纹丝不动。
     这不仅是"不动"的问题：杆摆、花不摆，杆顶就会从花心里**脱出来**，
     又变回"杆没接上花"的样子。
     12 株共用同一个材质对象、且根部都在水面（y=0），所以 tip 模式的基准高度是同一个值，
     注一次即可 —— 用 Set 去重，避免每株各克隆一份（材质数 ×12 只会徒增 shader 变体）。
     幅度取 0.030，与同池的 MAT.lily（睡莲叶盘/程序化荷杆）完全一致：
     池面所有水生植物的摆动语汇统一，不会出现"这边狂摆那边死水"。
     位移硬顶同样取 5cm —— 用户要求"只能在水池中，不要穿模到岸边草皮或石头上"。 */
  const pending = new Set();
  for (const o of seasonGLB.LotusPlant){
    if (o.material && !o.material.userData.windInjected) pending.add(o.material);
  }
  for (const m of pending){
    const nm = m.clone();
    nm.userData.windInjected = true;
    addWind(nm, 0.030, 1.15, 'tip', 0.0, 0.05);
    for (const o of seasonGLB.LotusPlant) if (o.material === m) o.material = nm;
  }
}
/* 季节存在性 + 平滑缩放（GLB 用缩放而不是二值开关：冬季 lotusShow=0 才真消失，
   中间值如芭蕉 0.12 会缩到很小而不是突兀地整片闪掉）。
   独立成函数是为了"资产一到就立即套用当前状态"，不必等下一次环境切换。 */
export function applyGLBSeason(p){
  for (const name in seasonGLB){
    const key = name === 'LotusPlant' ? 'lotusShow' : name === 'BananaPlant' ? 'bananaShow' : 'turtleShow';
    const v = Math.max(0.001, p[key]);
    for (const o of seasonGLB[name]){
      o.visible = p[key] > 0.02;
      let root = o; while (root.parent && root.parent !== world) root = root.parent;
      /* 芭蕉（多年生草本）：缩放目标优先取 userData.crown（冠层组）——
         假茎宿存不缩，冬季冠层隐藏 = "枯株"而不是"整株消失" */
      const target = root.userData.crown || root;
      if (target.parent === world || target.parent === root){
        if (!target.userData.baseScale) target.userData.baseScale = target.scale.clone();
        target.scale.copy(target.userData.baseScale).multiplyScalar(v);
      }
    }
  }
}
export function onAssetAttached(){
  collectSeasonGLB(); applyGLBSeason(ENV.cur);
  /* 迟到资产是**真投射物**（晒背龟/芭蕉/莲）：不光要补渲阴影图，
     包围盒也变了 —— 不重算的话阴影视体还是按旧轮廓拟合，新资产可能整个落在盒外。 */
  markCasterBoxDirty();
  fitShadowCamera();
  renderer.shadowMap.needsUpdate = true;   // 迟到资产含真投射物（晒背龟/芭蕉/莲），阴影图补渲一次
}
/* 登记给 06-vegetation 的 loadAssetOnce 回调（见 06 文件头的 HOOKS 说明）：
   06 不能静态 import 本模块 —— 本模块 body 早于 world 求值且 import 08，会把 08 提前拽进来。
   回调触发时（GLB 到位）一切早已就绪。 */
HOOKS.onAssetAttached = onAssetAttached;
/* 柳叶是实例化网格：改 count 就能做连续的「落叶」。
   ⚠️ 必须覆盖**每一棵柳树的叶片实例**。原来只记住 traverse 到的最后一个 MAT.willow 实例
   （4 棵柳树 ×（柳条 + 柳叶）共 8 个组），冬季只把其中一棵的叶子收掉，另外三棵照旧满树绿叶。
   与紫藤同一个根因：**同材质的实例化网格有多个，不能只认一个**。
   只标记 lInst（叶）；柳条是枝，冬季本就还在，不缩放。 */
export const willowLeafInsts = [];
export const bambooLeafInsts = [];
/* ⚠️ 收集必须能**重跑**（2026-09-19 冬柳回归）：
   柳/竹走 deferBoot 延迟装配，模块求值期 world 里根本没有它们 —— 这里收集到的永远是空表，
   于是 willowLeaf=0.02 写了个寂寞，冬季四棵柳照旧满树垂帘（用户截图实测：
   count 停在 8026/7830/7983/8327 满值）。凡"延迟批会塞东西进来"的缓存，
   必须在延迟批收尾处再调一次；所以收成函数，而不是模块期一次性 traverse。 */
export function collectSeasonCaches(){
  willowLeafInsts.length = 0;
  bambooLeafInsts.length = 0;
  const presence = new Map();                     // SEASON_PRESENCE 的材质 → mesh 表（一次遍历全收）
  for (const [, mats] of SEASON_PRESENCE) for (const m of mats) presence.set(m, []);
  world.traverse(o => {
    if (o.isInstancedMesh){
      if (o.userData.seasonWillowLeaf) willowLeafInsts.push({ o, max: o.count });
      if (o.userData.seasonBambooLeaf) bambooLeafInsts.push({ o, max: o.count });
      /* ⚠️ 不能在这里直接 return（2026-09-19 冬季紫藤照常开花的静默回归根因）：
         紫藤花穗也是 InstancedMesh（每丛一个），当年加柳/竹叶计数时把"所有实例网格"
         从 presence 收集里剔除了 → seasonMeshCache 里 MAT.wisteria 永远是空表
         → applyPresence 的 visible=false / count=0 全部落空，冬季 641 朵花照常提交。
         规则：实例网格凡材质登记在 presence 表里，照常收（柳/竹叶材质不在表里，互不干扰）。 */
      if (presence.has(o.material)) presence.get(o.material).push(o);
      return;
    }
    if (o.isMesh && presence.has(o.material)) presence.get(o.material).push(o);
  });
  for (const [m, list] of presence) seasonMeshCache.set(m, list);
  /* 挂点收集**挂在这里**（与季节缓存同一趟、且在其后）：柳/紫藤都在 deferRoot 延迟批里，
     必须在 collectSeasonCaches 之后才收得到（模块期收 = 空集，本项目老坑）。
     ⚠️ 本函数在启动里被调**两次**（initEnvScene 一次 = 延迟批之前；runDeferredBoot 收尾再一次
     = 延迟批之后）。第一次柳树还没进场 ⇒ 必须在"柳叶网格收齐"之前**拒绝建网格**，
     否则挂灯会按空集建好、永远补不上（这就是 willowLeaf 季节通道当年一直写不进去的同一类坑）。
     所以：柳叶网格为 0 时只返回、不落 built 标记、不建任何挂灯网格；围栏挂点与时机无关，
     但为保持"三个网格同生同死"的简洁，同样等柳叶到齐后一次性建。 */
  collectFestivalHangAnchors();
}
/* ⚠️ 这里**没有**顶层 `collectSeasonCaches()`：它 traverse `world`，而本模块被 08 import 而在
   world 之前求值 → 顶层调用必 TDZ。已并入下面的 initEnvScene（world 组装 + 合并之后才跑，
   这也正是原 §8→§12 的时序：缓存必须在合并后收，才能对上合并后的网格）。 */

/* ══ 天气表现 · 一 · 积雪 ══
   把「雪」做成朝上表面的着色，而不是给地面换一张贴图：
   顶点着色器算世界坐标与世界法线，片元按 upness 混白，并用世界坐标采一层多层 FBM 做斑驳
   （用世界坐标而不是 uv —— 合并几何后 uv 是各构件自己的，拼在一起会露出接缝）。
   雪在标准 PBR 里着色（不改 emissive 之类），所以它照样接受阴影与雾，看上去才是"落在地上"的。
   ❗ 必须链式挂接 onBeforeCompile：叶/柳/苇已有风场注入，季节色调也在同一个钩子上。 */
export const snowUniform = { value: 0 };
let windBaseApplied = 0;
export const snowTintUniform = { value: new THREE.Color(0xF2F6FA) };
export function installSnow(list){
  for (const m of list){
    if (!m || m.userData.snowInstalled) continue;
    m.userData.snowInstalled = true;
    /* 补装路径（registerWeatherRoles 晚注册 → SNOW_HOOK）里材质可能**已经编译过**：
       改了 onBeforeCompile 与 customProgramCacheKey 之后必须标脏才会重新编译，
       否则"名单里加了它"这件事对画面毫无影响 —— 石头照样不积雪。首帧前全量装雪时无害。 */
    m.needsUpdate = true;
    const prevCB = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = function (shader, renderer){
      if (prevCB) prevCB.call(this, shader, renderer);
      shader.uniforms.uSnowCover = snowUniform;
      shader.uniforms.uSnowTint  = snowTintUniform;
      /* 室内剔除盒：从 PRECIP_INDOOR **就地求值**（盒沿 ±0.3 外扩：含墙厚余量，
         shader 里再留 0.2 平滑带，门洞处雪从门口往里渐隐不出硬缝；y 下界 −1.5
         连台基底一起罩住）。
         ⚠️⚠️ 不能在模块级提前 const 出来引用 PRECIP_INDOOR —— installSnow 的调用点
         （装配收尾）在 PRECIP_INDOOR 定义**之前**，模块级求值会 TDZ ⇒ 传进去
         undefined ⇒ three 上传 uniform 时 `value[i].toArray()` 抛
         "Cannot read properties of undefined" ⇒ **整页卡在加载页**（渲染循环每帧抛）。 */
      shader.uniforms.uInLo = { value: PRECIP_INDOOR.map(b => new THREE.Vector3(b.x0 - 0.3, -1.5, b.z0 - 0.3)) };
      shader.uniforms.uInHi = { value: PRECIP_INDOOR.map(b => new THREE.Vector3(b.x1 + 0.3, b.yTop + 0.15, b.z1 + 0.3)) };
      shader.uniforms.uInN  = { value: PRECIP_INDOOR.length };
      /* ⚠️⚠️ GLSL 里 `uInLo[6]` 的长度必须与 PRECIP_INDOOR.length **逐字一致**：
         three 按 GLSL 声明的数组长度注册 uniform（size=6），上传时按该长度 flatten，
         JS 侧少给一个 ⇒ `array[6]` 是 undefined ⇒ flatten 里 `toArray()` 抛
         "Cannot read properties of undefined" ⇒ **渲染循环每帧抛、整页卡在加载页**。
         （这就是刚才那一次的故障：盒子实际 6 个、GLSL 写了 7。）新增禁区盒子时两处同步。 */
      // 逐材质：薄叶面用自己的加成，没有登记的材质为 0（= 完全走原来的朝上判据）
      shader.uniforms.uSnowBoost = (this.userData && this.userData.snowBoost)
                                 ? this.userData.snowBoost : { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n' +
          /* ⚠️ 这里原来用 normalMatrix —— 那是**视空间**法线，片元里却拿 vSnowN.y 当"朝上程度"。
             后果：一块不动的屋面，相机仰角一变积雪判定就变（同一朝上面在三种仰角下
             vSnowN.y = 0.999 / 0.707 / 0.100）—— 雪会跟着相机走。
             改用世界空间法线（模型矩阵 × 实例矩阵）；非均匀缩放下仍非严格逆转置，
             但归一化之后对"朝上程度"足够。 */
          '#ifdef USE_INSTANCING\n' +
          '  mat4 sM = modelMatrix * instanceMatrix;\n' +
          '  vec3 sN = mat3(modelMatrix) * mat3(instanceMatrix) * normal;\n' +
          '#else\n' +
          '  mat4 sM = modelMatrix;\n' +
          '  vec3 sN = mat3(modelMatrix) * normal;\n' +
          '#endif\n' +
          '  vSnowW = (sM * vec4(transformed, 1.0)).xyz;\n' +
          '  vSnowN = normalize(sN);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\n' +
          'varying vec3 vSnowW;\n' +
          'varying vec3 vSnowN;\n' +
          'uniform float uSnowCover;\n' +
          'uniform vec3 uSnowTint;\n' +
          'uniform float uSnowBoost;\n' +
          'uniform vec3 uInLo[6];\n' +
          'uniform vec3 uInHi[6];\n' +
          'uniform int uInN;\n' +
          'float snowHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }\n' +
          'float snowNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);\n' +
          '  return mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), u.x),\n' +
          '             mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), u.x), u.y); }')
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n' +
          '  if (uSnowCover > 0.001){\n' +
          '    // 平摊的薄叶面（竹叶/芭蕉等）法线基本水平，upness≈0，光靠朝上程度挂不住雪；\n' +
          '    // 用 uSnowBoost 给这类材质放宽：把 upness 的下限抬到"只要不是朝下就认"\n' +
          '    float upness = smoothstep(0.30, 0.78, vSnowN.y) * (1.0 - uSnowBoost)\n' +
          '                 + smoothstep(-0.15, 0.45, vSnowN.y) * uSnowBoost;\n' +
          '    float dr = snowNoise(vSnowW.xz * 0.65) * 0.62 + snowNoise(vSnowW.xz * 2.7 + 13.1) * 0.28\n' +
          '             + snowNoise(vSnowW.xz * 7.3 + 41.7) * 0.10;\n' +
          /* 覆盖量：噪声给斑驳的边缘（不是均匀刷白），阈值随 uSnowBoost 下移 ——
             只放宽 upness 是不够的：dr 的均值约 0.5，在 smoothstep(0.24,0.80) 下只有 ~0.47 的权重，
             薄叶面的雪就一直是"隐约有点白"，撑不起"雪压竹叶"这一笔。 */
          '    float lo = mix(0.24, 0.03, uSnowBoost);\n' +
          '    float hi = mix(0.80, 0.52, uSnowBoost);\n' +
          '    float amt = smoothstep(lo, hi, dr) * upness * uSnowCover;\n' +
          '    amt *= 1.0 + 0.25 * uSnowBoost;\n' +
          /* ⚠️ 室内剔除（2026-10-02）：盒子内的片元（堂内/廊下/亭下的地面与家具顶面）
             雪量归零 —— snowCover 只认"面朝上"，没有它堂内地面会与门外台阶雪连成一片
             （老黄实拍定性）。盒沿已在 JS 侧外扩 0.3，这里再留 ±0.2 平滑带：
             门洞处雪从门口往里渐隐，不出硬缝。y 下界 -1.5 连台基底一起罩住。 */
          '    float inK = 0.0;\n' +
          '    for (int i = 0; i < 7; i++){\n' +
          '      if (i >= uInN) break;\n' +
          '      vec3 lo2 = uInLo[i];\n' +
          '      vec3 hi2 = uInHi[i];\n' +
          '      vec3 inA = smoothstep(lo2 - vec3(0.2), lo2 + vec3(0.2), vSnowW);\n' +
          '      vec3 outA = 1.0 - smoothstep(hi2 - vec3(0.2), hi2 + vec3(0.2), vSnowW);\n' +
          '      vec3 mm = clamp(inA * outA, 0.0, 1.0);\n' +
          '      inK = max(inK, mm.x * mm.y * mm.z);\n' +
          '    }\n' +
          '    amt *= 1.0 - inK;\n' +
          '    diffuseColor.rgb = mix(diffuseColor.rgb, uSnowTint * (0.72 + 0.40 * dr), amt);\n' +
          '  }');
    };
    m.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : '') + '|snow'; };
  }
}
/* 湿地：只改材质参数，不动着色器 —— 粗糙度压下去，天空与树就会在石板上留下倒影。
   ⚠️ 2026-09-18 改过系数，原因见下（metalness 曾是 +0.20、rough 系数是 0.72）。 */
export let wetApplied = -1;
export function applyWetness(v){
  // 每帧都会走到这里，但只有数值真的变了才写材质属性 —— 否则会一直把材质标脏
  if (Math.abs(v - wetApplied) < 0.004) return;
  wetApplied = v;
  wetUniform.value = v;
  for (const m of WET_MATS){
    if (!m || m.userData.dryRough === undefined) continue;
    /* 物理上的错：水是**电介质**，蒙一层水膜不会让石头/木/瓦长出金属度。
       旧式 metalness = dryMetal + 0.20·v² 把整个湿面变成半金属 —— 环境反射被按
       基色放大，于是暴雨里瓦面、石岸、草地都浮出一层顺视线的金色/白色高光带
       （用户报的"像有太阳透下来"，换个角度才明显，正是镜面反射的签名）。
       正确取法：只压粗糙度、金属度几乎不动（+0.05 只为让 IBL 反射稍微"接得住"）。 */
    m.roughness = m.userData.dryRough * (1 - 0.62 * v * v);   // 平方：小雨几乎无感，暴雨才成镜
    m.metalness = m.userData.dryMetal + 0.05 * v * v;
  }
}
