// 06-vegetation: from index.html inline 493..2993
import { THREE, mergeGeometries, GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder } from '../vendor.js';
/* ⚠️ world 从 02-scene 取，**不能**从 08-assemble 取：08 的模块体要读本模块的
   rippleInst / perchingAnchors 等模块级常量，若本模块反向 import 08 就成环 ——
   本模块的 body 被推迟到 08 之后，而 08 的 body 读到的就是 TDZ
   （实测 "Cannot access 'rippleInst' before initialization"）。依赖方向：02 → 06 → 08。 */
import { world, scene, ACTIVE_QUALITY, renderer } from './02-scene.js';
/* ⚠️ onAssetAttached 也**不能**静态 import 12-env：12-env 的模块体在 world 之前求值，
   而它 import 08；本模块一旦 import 12-env，12-env 就会把 08 提前拽进来 → 同一个 TDZ。
   它只在 loadAssetOnce 的**回调**里调用（那时一切就绪），故走 00-config 的 HOOKS 延迟绑定。 */
import { TAU, rnd, rr, CFG, mulberry32, bootMark, HOOKS } from './00-config.js';
/* 2026-10-02 CDN 双轨：assetUrl/withCdnFallback 只改"请求发到哪"，settleAsset /
   reportAssetProgress 的键**仍是相对路径**（预载清单键一位不挪）；ASSET_CDN.base
   为空（默认）时三个入口都走与旧版逐字节相同的直接调用。 */
import { onAssetFailed, assetUrl, ASSET_CDN, withCdnFallback } from './13-preload.js';

/* 布局专用抖动流已搬至 src/06a-rng.js（W0 拆分，2026-10-12）：
   门面约束（方案§3.2）——原文件 import 后 export，不写 export ... from。
   搬出的理由与实测依据见 06a-rng.js 内的注释块，此处不重复。 */
import { jr } from './06a-rng.js';
export { jr };
import { MAT, WIND, addWind, AUX_PASS_HIDDEN } from './01-materials.js';
import { mesh } from './03-factory.js';
import { POND_RADII, insidePond, markUnderwater } from './05-water.js';
/* ══════════════════════════════════════════════════════════════
   6 · 植被
   ══════════════════════════════════════════════════════════════ */

/* ── 植被专用几何体（带弧度，避免"纸片感"） ── */
/* 植被专用几何体生成器族（14 个：叶片体积/竹叶/荷瓣/睡莲盘/芦叶/紫藤小瓣/桃叶/桃花/梅花/花苞/凋谢/桃果/挂灯色/挂灯壳）
   已搬至 src/06c-organs.js（W1 拆分，2026-10-12）—— 纯几何，无副作用，随搬的是各自的说明注释。
   门面约束（方案§3.2）—— 原文件 import 后 export，不写 export ... from。
   ⚠️ 搬出的符号在 06c 内必须**行首** export：probe/import-audit.mjs 的 declsOf 正则是
   /^export\s+/gm（行首锚点），带前导缩进的 export 对门禁不可见 ⇒ 会被判成"用到但没 import"。 */
import {
  makeLeafVolumeGeo, makeBambooLeafGeo, makeLotusPetalGeo, makeLilyPadGeo,
  makeReedBladeGeo, makeWisteriaFloretGeo, makePeachLeafGeo, makePeachFlowerGeo,
  makePlumFlowerGeo, makePlumBudGeo, makePlumWitheredGeo, makePeachFruitGeo,
  TREE_LANTERN_COLORS, treeLanternColor, makeTreeLanternGeo,
} from './06c-organs.js';
export { makeLeafVolumeGeo, makeBambooLeafGeo, makeLotusPetalGeo, makeLilyPadGeo, makeReedBladeGeo, makeWisteriaFloretGeo, makePeachLeafGeo, makePeachFlowerGeo, makePlumFlowerGeo, makePlumBudGeo, makePlumWitheredGeo, makePeachFruitGeo, TREE_LANTERN_COLORS, treeLanternColor, makeTreeLanternGeo };
/* 草花水生（makePondPads / makeBamboo / makeWisteria / makeAquatic）+ 雾絮场
   （makeMistSpriteTex / MIST_WHITE / MIST / makeMistField）已搬至 src/06j-herbs.js（W8 拆分，2026-10-12）；
   搬出的理由与实测依据见该文件内的注释块。门面约束（方案§3.2）—— import 后 export，不写 export ... from。
   ⚠️ MIST / MIST_WHITE 是**可写对象**：mist-guard 与 12-env 按属性改写它们，门面 import 的
      就是那两个对象本身，重建会让门禁读到空 uniform。 */
import { makePondPads, makeBamboo, makeWisteria, makeAquatic, makeMistSpriteTex, MIST_WHITE, MIST, makeMistField } from './06j-herbs.js';
export { makePondPads, makeBamboo, makeWisteria, makeAquatic, makeMistSpriteTex, MIST_WHITE, MIST, makeMistField };

/* 睡莲叶 + 荷花 */
/* 观荷水道（视廊 VIEW_CORRIDOR / corridor* / CORRIDOR_U）+ 睡莲廊道材质注入 + 蜻蜓停栖锚点
   已搬至 src/06d-corridor.js（W2 拆分，2026-10-12）；搬出的理由与实测依据见该文件内的注释块。
   门面约束（方案§3.2）—— 原文件 import 后 export，不写 export ... from。
   ⚠️ perchingAnchors 是 08-assemble / 11-loop 共享的**同一可变数组实例**：门面 import 的
      就是那个实例，两侧都不许重建，否则锚点登记与读取会落到两个不同的数组上。 */
import { perchingAnchors, addPerchingAnchor, VIEW_CORRIDOR, corridorT, corridorRaw, corridorKeep, CORRIDOR_U, syncCorridorU, setCorridor, installLilyCorridor } from './06d-corridor.js';
export { perchingAnchors, addPerchingAnchor, VIEW_CORRIDOR, corridorT, corridorRaw, corridorKeep, CORRIDOR_U, syncCorridorU, setCorridor, installLilyCorridor };


/* 锦鲤整块（轨道 KOI_ORBITS + 投喂 baitPoints/BAITS/dropBait/updateBaits/nearestBait +
   行为层 KOI_BEHAVIOR/koiStartleAt/koiStartleEnergy/koiBehaviorOffset）已搬至 src/06g-koi.js
   （W5 拆分，2026-10-12）；搬出的理由与实测依据见该文件内的注释块。
   门面约束（方案§3.2）—— import 后 export，不写 export ... from。
   ⚠️ baitPoints 的构造与 markUnderwater(baitPoints) 的先后顺序在 06g 内保持原样（方案 §4.3 S7）：
      顶层构造次序一改，折射层静默失效。tubeRadiusRamp 的定义与导出行都留本文件原位，不在此门面内。 */
/* ⚠️ 溯源注（2026-10-13 收口）：紧邻上一段末尾关于 tubeRadiusRamp「留本文件原位」的表述**已过时** ——
   它实际定义在 src/06i-trees.js:581，并在该文件 :657 由 `export { tubeRadiusRamp }` 导出；
   本文件 :184 只是 import 转发、:185 只是再 export 一次，均非定义处。
   原句一字未动：它记录的是「W5 拆分当日」的判断（当时确实还没搬），改写会使其失去凭据。
   先例：sw.js:80-84、probe/shadow-bake-guard.mjs:7、probe/verify-all.mjs:313 同为加注不改写。 */
import { KOI_ORBITS, BAIT_LIFE, BAIT_ATTRACT_R, baitPoints, BAITS, baitsActive, dropBait, updateBaits, nearestBait, KOI_OBSTACLES, KOI_BEHAVIOR, koiAvoidOffset, koiStartleAt, koiStartleOffset, koiStartleEnergy, koiCohesionOffset, koiBehaviorOffset, makeKoiGroup } from './06g-koi.js';
export { KOI_ORBITS, BAIT_LIFE, BAIT_ATTRACT_R, baitPoints, BAITS, baitsActive, dropBait, updateBaits, nearestBait, KOI_OBSTACLES, KOI_BEHAVIOR, koiAvoidOffset, koiStartleAt, koiStartleOffset, koiStartleEnergy, koiCohesionOffset, koiBehaviorOffset, makeKoiGroup };
/* 涟漪池（鱼跃/雨滴/点击共用的 64 环 InstancedMesh，含 onBeforeCompile 注入 instanceAlpha）
   已搬至 src/06f-ripple.js（W4 拆分，2026-10-12）；搬出的理由与实测依据见该文件内的注释块。
   门面约束（方案§3.2）—— import 后 export，不写 export ... from。
   ⚠️ rainRippleActive / lastRippleAge 是 export let **活绑定**：12-env 限雨滴配额、11-loop 判
      "刚刚有动作"，读到的必须与 06f 内部增减/赋值的是同一个。 */
import { rippleInst, rainRippleActive, rippleCapacity, spawnRipple, lastRippleAge, ripplesActive, updateRipples } from './06f-ripple.js';
export { rippleInst, rainRippleActive, rippleCapacity, spawnRipple, lastRippleAge, ripplesActive, updateRipples };

/* 锦鲤建组 makeKoiGroup（2026-10-13 从本文件原 :82-158 搬至 src/06g-koi.js，按拆分口径归 koi 模块，纯搬家逐字未改；
   经上部 KOI 门面 import/export 转出，调用方 08-assemble.js:1629 不动）。 */


/* GLB 资产加载（双轨入口 + 两级缓存 + 解码器装配）已搬至 src/06e-assets.js（W3 拆分，2026-10-12）；
   搬出的理由与实测依据见该文件内的注释块。门面约束（方案§3.2）—— import 后 export，不写 export ... from。
   ⚠️ assetFailures 是 export let **活绑定**：门面 import 的是计数器本身，11-loop 读到的
      必须与 06e 内部自增的是同一个，否则启动状态的失败计数会永远停在 0。 */
import { loadAssetOnce, placeAssets, assetFailures } from './06e-assets.js';
export { loadAssetOnce, placeAssets, assetFailures };
/* 太湖石族（segDist + Surface Nets + makeTaihuHeroGeo 立峰 + makeTaihuPeak + makeRockChain +
   makeRockery，以及方案 §3.2 明列的单点依赖 hash3i/vnoise3/fbm3）已搬至 src/06h-rock.js
   （W6 拆分，2026-10-12）；搬出的理由与实测依据见该文件内的注释块。
   门面约束（方案§3.2）—— import 后 export，不写 export ... from。
   ⚠️ segDist / hash3i / vnoise3 / fbm3 只在 06h 内定义并被立峰 SDF 共用，本文件不再转出：
      它们拆散会静默坏掉（不报错、只是石形变），故不作为门面的一部分。 */
import { makeTaihuPeak, makeTaihuHeroGeo, makeRockChain, makeRockery, fbm3 } from './06h-rock.js';
export { makeTaihuPeak, makeTaihuHeroGeo, makeRockChain, makeRockery, fbm3 };



/* ══ 雾团 + 堂前香炉白烟 ⇒ 已移入 06b-atmos.js（2026-10-05 拆分，纯搬家、逐字未改）═══════════
   原 1995~2204 行整块搬走。两者都是"billboard 氛围片 + 私有随机流"，与植被建模无关，故独立成文件。
   ⚠️ 本文件仍要 `makeMistSpriteTex()`（雾絮场 MIST 也用同一张雾片贴图），故把它 export 出去；
   方向是单向的（06b → 本文件），不要在本文件 import 06b —— 那会成环。
   对外名（FOG_BANKS / makeFogBanks / CENSER_SMOKE / makeCenserSmoke）已改由 08-assemble 与
   11-loop 直接从 06b-atmos.js import，本文件不再转出。 */
/* 乔木族（柳 makeWillow / 桃 makePeachTree / 梅 makePlumTree / 兰 makeOrchidPot /
   蕉 makeBananaPlant + makeBananaLeafCrown / 荷蓬 makeLotusPod / 枯枝挂灯 treeLanternInsts +
   TREE_LANTERN_MAT / 水草 makeWaterGrass，以及变速管 tubeRadiusRamp）已搬至 src/06i-trees.js
   （W7 拆分，2026-10-12）；搬出的理由与实测依据见该文件内的注释块。
   门面约束（方案§3.2）—— import 后 export，不写 export ... from。
   ⚠️ treeLanternInsts / budMeshes / witheredMeshes 是可变数组**原引用**：门面 import 的就是
      那三个数组本身，12-env 的 applyPresence 按 count 开/关时读写的必须是它们。 */
import { makeWillow, tubeRadiusRamp, treeLanternInsts, TREE_LANTERN_MAT, makePeachTree, makePlumTree, makeOrchidPot, makeBananaLeafCrown, makeBananaPlant, makeLotusPod, makeWaterGrass } from './06i-trees.js';
export { makeWillow, tubeRadiusRamp, treeLanternInsts, TREE_LANTERN_MAT, makePeachTree, makePlumTree, makeOrchidPot, makeBananaLeafCrown, makeBananaPlant, makeLotusPod, makeWaterGrass };


/* ══ 夏夜萤火虫 + 镜头天气层（镜前雨帘 / 雪粒）⇒ 已并入 06b-atmos.js（2026-10-05 拆分）══════    原 4173~4384 行整块搬走（纯搬家、逐字未改）。两块都是"挂在相机/场景上的氛围粒子"，与雾团、    香炉白烟同一族，故并入同一个文件。调用点仍在 11-loop（makeFireflies / makeLensWeather），    已改为从 06b-atmos.js 直接 import。 */
