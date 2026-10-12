// 06e-assets: GLB 资产加载（双轨入口 + 两级缓存 + 解码器装配）（W3 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出。门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
// ⚠️ assetFailures 是 export let **活绑定**：06/08/11/12f 侧读到的必须是同一个计数器，
//    写法一字不改（原样搬），门面 import 的是活绑定本身、不是当时的快照值。
// ⚠️ rawCache / assetCache 是本模块私有的两个 Map，随搬；不导出（外部无引用）。
import { THREE, GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder } from '../vendor.js';
import { HOOKS } from './00-config.js';
import { world } from './02-scene.js';
import { assetUrl, ASSET_CDN, withCdnFallback } from './13-preload.js';

/* ── Hyper3D Rodin 生成的真实模型：加载一次，克隆复用 ──
   ⚠️ 缓存键必须带上**归一化尺寸与材质覆盖**。原来只按 url 缓存，于是
   `placeAssets('Turtle.glb', 0.5)` 与 `loadAssetOnce('Turtle.glb', 0.46)` 共用先到的那一份模板 ——
   两个尺寸里必有一个是错的，而且取决于谁先加载完（时序相关，最难查）。
   顺带把"在飞的加载"也登记：并发请求同一配置时只解析一次；失败要把在飞项删掉，否则永远无法重试。 */
/* 两级缓存：
   · rawCache  —— 按 URL 缓存**未归一化的原始 gltf.scene**（Promise），一个 URL 只解析一次。
   · assetCache—— 按 "URL|尺寸|材质" 缓存**归一化后的模板**，各配置互不干扰。
   ⚠️ 踩过一次：一开始只做了第二级、把尺寸也写进 key，结果芭蕉的 8 株各自一个 leafScale
   ⇒ **同一个 1MB 的 GLB 被解析 8 次**（几何/贴图都多份）。正确做法是审计里那句话：
   "缓存不可变的原始模板，按实例做归一化" —— 原始解析只有一份，归一化后的克隆各自独立。 */
const rawCache = new Map();          // url → Promise<原始 scene>
const assetCache = new Map();        // url|尺寸|材质 → 归一化模板
export let assetFailures = 0;               // 供启动状态显示
/* 组合式 GLTFLoader 实例：自动启用 Draco/KTX2/Meshopt 解码
   ⚠️ 解码器**必须直接用本模块的 import**，不能读 index.html 内联模块里的 `$解码器`：
   拆模块后 src 与内联模块不再共享词法世界，那个名字在 src 里压根不存在 → ReferenceError；
   而它是在 `new Promise` 的 executor 里抛的，被下游 `.catch(()=>{})` 静默吞掉 ——
   现象是 Turtle / BananaPlant / LotusPlant 三类 GLB **永远挂不上**，却零告警、零失败计数，
   全靠 smoke 的「四类 GLB 资产均已挂载」才看得见（2026-09-20 拆模块时实测）。 */
const DECODERS = { DRACOLoader, KTX2Loader, MeshoptDecoder };
function createGLTFLoaderWithDecoders(){
  const loader = new GLTFLoader();
  // 启用 Draco 几何压缩
  if (DECODERS.DRACOLoader){
    const dracoLoader = new DECODERS.DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(dracoLoader);
  }
  // 启用 KTX2 纹理压缩
  if (DECODERS.KTX2Loader){
    loader.setKTX2Loader(new DECODERS.KTX2Loader());
  }
  // 启用 Meshopt 压缩几何
  if (DECODERS.MeshoptDecoder){
    loader.setMeshoptDecoder(DECODERS.MeshoptDecoder);
  }
  return loader;
}

export function loadAssetOnce(url, targetSize, cb, overrideMat){
  const key = url + '|' + targetSize + '|' + (overrideMat ? (overrideMat.uuid || 'mat') : '-');
  if (assetCache.has(key)){ cb(assetCache.get(key)); return; }
  if (!rawCache.has(url)){
    /* ── 双轨入口（2026-10-02 · CDN 可选基址）─────────────────────────────
       CDN 关（默认）：走 else —— 与旧实现**逐语句相同**（仅请求 URL 改经 assetUrl，
       空 base 恒等返回），失败判定仍在 loader 的 onError 里同步做
       rawCache.delete + assetFailures++ + settleAsset(false)，时序一位不挪。
       CDN 开：attempt 只负责"发一次请求"（onError 只 reject，**不算失败**）；真失败
       统一挪到 raw.catch —— 走到那里时 withCdnFallback 已把"CDN 失败 ⇒ 本地重试一次"
       走完，**两次都失败**才轮得到 = 失败判定链与旧版同一条
       （settleAsset(false) → required:false 的项进程序化替身流程）。 */
    if (ASSET_CDN.base){
      const attempt = (reqUrl)=>new Promise((resolve, reject)=>{
        const loader = createGLTFLoaderWithDecoders();
        loader.load(reqUrl, (gltf)=>{ HOOKS.settleAsset?.(url, true); resolve(gltf.scene); },
          /* ← 第三槽：onProgress 口径不变（SW cache-first 下 0→100 跳变是预期，见
             13-preload.reportAssetProgress 的注释）。CDN 半途而废时 13 的回退会把
             该件 loaded 清零，本地重下从真实起算。settle/report 的键仍是相对 url。 */
          (e)=>{ HOOKS.reportAssetProgress?.(url, e.loaded, e.total); },
          reject);
      });
      const raw = withCdnFallback(url, attempt);
      raw.catch((e)=>{
        rawCache.delete(url); assetFailures++;
        /* 失败报给预载清单：required:false 的项据此进入程序化替身流程
           （芭蕉叶片不来就会留一根 3.6m 高的光杆，比没有芭蕉更难看）。 */
        HOOKS.settleAsset?.(url, false, e);
        console.warn('模型加载失败：', url, e);
      });
      rawCache.set(url, raw);
    } else {
      rawCache.set(url, new Promise((resolve, reject)=>{
        const loader = createGLTFLoaderWithDecoders();
        loader.load(assetUrl(url), (gltf)=>{ HOOKS.settleAsset?.(url, true); resolve(gltf.scene); },
          /* ← 第三槽：原为 `undefined`，现接 onProgress（13-preload 的预载清单）
             ⚠️ **SW cache-first 下这里会直接 0→100 跳变，这是预期**：
             首次访问走网络时 loaded/total 是真进度；SW 装好后 .glb 命中缓存直接
             return，不产生数据流事件，直到 onLoad 那一刻 settle 一次性补满。
             装成 PWA 后那段时间里根本没有网络发生，没有进度可言。 */
          (e)=>{ HOOKS.reportAssetProgress?.(url, e.loaded, e.total); },
          (e)=>{
            rawCache.delete(url); assetFailures++;
            /* 失败报给预载清单：required:false 的项据此进入程序化替身流程
               （芭蕉叶片不来就会留一根 3.6m 高的光杆，比没有芭蕉更难看）。 */
            HOOKS.settleAsset?.(url, false, e);
            console.warn('模型加载失败：', url, e); reject(e);
          });
      }));
    }
  }
  rawCache.get(url).then(raw=>{
    const src = raw.clone(true);                 // 几何/贴图与原始模板共享，只有变换是独立的
    const b1 = new THREE.Box3().setFromObject(src);
    const s1 = b1.getSize(new THREE.Vector3());
    src.scale.setScalar(targetSize / Math.max(s1.x, s1.y, s1.z));
    src.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(src);
    // 居中，底部落在 y=0 —— 摆放**不要**再改这个 position，用外层 holder（见 placeAssets）
    src.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    src.traverse(o=>{
      if (o.isMesh){
        o.castShadow = true; o.receiveShadow = true;
        if (overrideMat) o.material = overrideMat;
      }
    });
    assetCache.set(key, src);
    cb(src);
  }).catch(()=>{});
}

export function placeAssets(url, size, placements, overrideMat){
  loadAssetOnce(url, size, (src)=>{
    placements.forEach(p=>{
      /* ⚠️ 摆放必须放在**外层 holder** 上，不能改克隆体自己的 position：
         loadAssetOnce 把"水平居中 + 底部对齐到 y=0"的偏移写在 src.position 上，
         克隆体会继承它，而 c.position.set(...) 会把这份归一化偏移**整个覆盖掉** ——
         模型于是按原始轴心摆放（左右不居中、上下不落底）。holder 管摆放、
         子节点管归一化，两者各一层。 */
      const holder = new THREE.Group();
      holder.position.set(p.x, p.y || 0, p.z);
      if (p.ry) holder.rotation.y = p.ry;
      if (p.s) holder.scale.multiplyScalar(p.s);
      holder.add(src.clone(true));
      world.add(holder);
    });
    HOOKS.onAssetAttached?.();         // 迟到资产立刻拿到当前季节状态，不等下一次环境切换
  }, overrideMat);
}
