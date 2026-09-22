// 09-lights: from index.html inline 497..708
import { THREE, mergeGeometries } from '../vendor.js';
/* ⚠️ world 从 02-scene 取，**不能**从 08-assemble 取：08 反过来 import 本模块的
   mergeStatics / validateGeometry / fitShadowCamera，成环 → 本模块的 body 会被推迟到
   08 之后，而 08 的 body 末尾就要调 fitShadowCamera()（读本模块的 `let casterBoxDirty`）
   → 启动期 TDZ。放 02-scene 后依赖方向单纯：02 → 09 → 08。
   （world 在本模块只在函数体内用，见下方 refreshCasterBox。） */
import { bootMark, CFG } from './00-config.js';
import { GPU_TIER, scene, renderer, world } from './02-scene.js';
/* ══════════════════════════════════════════════════════════════
   9 · 灯光
   ══════════════════════════════════════════════════════════════ */

/* 这里原本有一段对 world 的 world.traverse（小构件关投影）—— 本轮拆模块时移到了
   08-assemble.js 的 body 末尾：它操作的是 world，而 world 属于 08。
   移走不是为"干净"，是**断环**：09 要 export validateGeometry / mergeStatics 给 08 用，
   若 09 又在**模块顶层**读 world，就变成"08 的 body 必须等 09 求值完、09 的 body 又必须等 08"，
   ESM 只会给你一个 TDZ：`ReferenceError: Cannot access 'world' before initialization`。
   ⚠️ 通则：**循环依赖里任何一方都不能在模块顶层读另一方的绑定**（写在函数体里读是安全的）。 */

/* ── 几何校验 ──
   合并前确认 position/uv/normal 计数一致、索引不越界、坐标有限。
   太湖石顶心曾经只 push position 不 push uv（11 座峰 → 合并后两个网格各差 11/4 条 uv）——
   这种错不报错、不 NaN，只是那几个三角形采到越界的 uv。机器查，别靠肉眼。 */
export function validateGeometry(g, tag){
  const P = g.attributes.position;
  if (!P) return true;
  const n = P.count, bad = [];
  if (g.attributes.uv     && g.attributes.uv.count     !== n) bad.push('uv ' + g.attributes.uv.count + '≠' + n);
  if (g.attributes.normal && g.attributes.normal.count !== n) bad.push('normal ' + g.attributes.normal.count + '≠' + n);
  if (g.attributes.color  && g.attributes.color.count  !== n) bad.push('color ' + g.attributes.color.count + '≠' + n);
  if (g.index){
    const ix = g.index.array;
    let mx = -1; for (let i = 0; i < ix.length; i++) if (ix[i] > mx) mx = ix[i];
    if (mx >= n) bad.push('索引越界 ' + mx + '≥' + n);
  }
  const pos = P.array;
  for (let i = 0; i < pos.length; i++) if (!isFinite(pos[i])){ bad.push('非有限坐标'); break; }
  if (bad.length) console.warn('[几何校验] ' + tag + '：' + bad.join('；'));
  return bad.length === 0;
}

/* ── 几何合并：同材质 + 同阴影标记的静态网格合并成单个 BufferGeometry ──
   把 draw call 从数百降到几十；动态物体（鱼、龟）和 InstancedMesh 不参与 */
export function mergeStatics(root){
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse(o=>{
    if (!o.isMesh || o.isInstancedMesh) return;
    if (o.userData.noMerge || Array.isArray(o.material)) return;
    /* ⚠️ 分桶键必须带上"有无顶点色"：带色与不带色的几何合并会因属性集不同而失败，
       而且顶点色是 SDF 立峰的 AO 载体 —— 丢了颜色，石头就变成一块死灰。
       （原来只留 position/normal/uv，所以立峰一律 noMerge 单飞；现在可以并进来了。） */
    const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0)
              + (o.geometry && o.geometry.attributes.color ? '|c' : '');
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, list: [] });
    buckets.get(key).list.push(o);
  });

  let groups = 0, removed = 0;
  for (const b of buckets.values()){
    if (b.list.length < 2) continue;                 // 单个网格不值得合并
    const geos = [];
    for (const o of b.list){
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      /* ⚠️ 负行列式（镜像）物体：把 matrixWorld 烘进几何后**绕序会反转** ——
         三角形朝向与（已被 applyMatrix4 正确镜像的）法线相反。原来只烘矩阵不翻绕序，
         镜像构件合并后就变成反面：背面剔除下直接看不见；MAT.roof 这类 DoubleSide 材质
         虽被 gl_FrontFacing 兜住光照，但 AO 的法线 pass 与积雪的朝上判据读到的是反法线。
         翻一次绕序即可与法线一致。 */
      if (o.matrixWorld.determinant() < 0 && g.index){
        const ix = g.index.array;
        for (let t3 = 0; t3 + 2 < ix.length; t3 += 3){ const tmp = ix[t3]; ix[t3] = ix[t3 + 2]; ix[t3 + 2] = tmp; }
        g.index.needsUpdate = true;
      }
      if (!g.index){                                  // 统一为带索引
        const n = g.attributes.position.count;
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv){                          // 统一补 uv，否则合并会失败
        const n = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      const keep = new THREE.BufferGeometry();        // 保留 position/normal/uv（+ 顶点色）
      keep.setAttribute('position', g.attributes.position);
      keep.setAttribute('normal', g.attributes.normal);
      keep.setAttribute('uv', g.attributes.uv);
      if (g.attributes.color) keep.setAttribute('color', g.attributes.color);
      keep.setIndex(g.index);
      validateGeometry(keep, 'merge·' + (o.name || 'mesh'));
      geos.push(keep);
    }
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch(e){ merged = null; }
    if (!merged) continue;
    validateGeometry(merged, 'merged·' + (b.mat.name || b.mat.uuid.slice(0, 8)));
    const mm = new THREE.Mesh(merged, b.mat);
    mm.castShadow = b.cast; mm.receiveShadow = b.recv;
    mm.name = 'mergedStatic';
    root.add(mm);
    for (const o of b.list){ if (o.parent) o.parent.remove(o); removed++; }
    groups++;
  }
  console.log('[几何合并]', groups, '组材质 →', removed, '个网格');
}
/* bootMark('场景几何') / mergeStatics(world) / bootMark('几何合并') 三行已移到
   08-assemble.js 的 body 末尾 —— 同上的断环理由（合并对象是 world）。 */

export const sun = new THREE.DirectionalLight(CFG.sun.color, CFG.sun.intensity);
sun.position.set(...CFG.sun.pos);
sun.castShadow = true;
// 收紧扣到主体范围（园 60×45 + 围墙），配 4096² 贴图 → texel 密度从 45/m 提到 68/m
// 8192² 的阴影填充代价偏高（实测挤占了帧预算），退到 6144²：
//  6144 / 56 世界单位 ≈ 110 texel/m，仍是原始（45/m）的 2.4 倍
sun.shadow.mapSize.set(GPU_TIER === 'low' ? 2048 : 6144, GPU_TIER === 'low' ? 2048 : 6144);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 190;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);
sun.target.position.set(0, 0, 0);

/* ══ 阴影视体：按「投射物的真实轮廓」自动拟合 ══
   ⚠️ 2026-09-18 重写。旧实现是固定 ±28/±24，再按 1/太阳仰角 放大（上限 2.2×，
   暮时 ±30/±26）。那个旋钮的**理由本身是错的**：ortho 阴影相机的视体 XY 轴与光线
   方向平行，影子的**长度**由 near/far 承担（1/190，余量极大），XY 只需要罩住投射物的
   **轮廓** —— 太阳再低也不用放大 XY。

   真正的问题正好相反：固定盒比园子的轮廓还**小**。正午光方位角 35.5°，
   60×45 的园子轮廓投影到光空间 X 轴达 ±37.5（实测投影物范围 ±36.2），
   四个角落到盒外；而**盒外既不做阴影测试、投射物也不进深度图** ——
   于是边界处出现「影子被硬切出一条直边、切边外是亮的」。
   用户报的「狂风暴雨里有些地方像有太阳透下来，换这个角度特别明显」里，
   一部分就来自这条被切出来的亮缝。

   改为：把投射物世界包围盒的 8 个角投到光空间取极值 → 盒永远刚好罩住全场。
   代价只是 8 次矩阵变换，任何光向变化都便宜；texel 密度 6144/(2×37.5) ≈ 82/m，
   仍高于最初固定盒的 45/m（那才是这一路的初衷）。near/far 顺手收紧，深度精度更好。 */
export const casterBox = new THREE.Box3();        // 投射物世界包围盒（合并后算一次，迟到资产置脏重算）
export let casterBoxDirty = true, casterBoxAt = -1e9;
/* ⚠️ 置脏必须走这个函数：拆模块后 12-env（资产迟到回调）是**import** 本变量再赋值的，
   ESM 导入绑定只读 → 直接写抛 "Assignment to constant variable"（原单体里同处一个词法世界）。
   读数（本模块内部判断）走 live binding，不受影响。 */
export function markCasterBoxDirty(){ casterBoxDirty = true; }
export function refreshCasterBox(){
  /* ⚠️ 必须先强制刷一次世界矩阵：`Box3.expandByObject` 内部只做 updateWorldMatrix(false,false)，
     也就是**信任父链的 matrixWorld** —— 父链还没算过时它读到的是单位矩阵，包围盒会算成错的
     （而且不报错，只是盒偏小 → 又回到"影子被切一条亮缝"）。 */
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3(); let n = 0;
  world.traverse(o => {
    if (!o.castShadow || !o.isMesh || !o.geometry) return;
    b.expandByObject(o); n++;               // InstancedMesh 走 object.boundingBox，含实例矩阵
  });
  if (n && !b.isEmpty()){ casterBox.copy(b); casterBoxDirty = false; }
  return n;
}
const _fitInv = new THREE.Matrix4(), _fitV = new THREE.Vector3();
export function fitShadowCamera(){
  /* 迟到资产（含 deferBoot 的延后批）会往世界里加真投射物，所以包围盒不能只算一次：
     置脏时立刻重算，否则最多每 3 秒自愈一次（一次遍历，静止时基本走不到这里）。 */
  const now = performance.now();
  if (casterBoxDirty || now - casterBoxAt > 3000){ refreshCasterBox(); casterBoxAt = now; }
  const c = sun.shadow.camera;
  const box = casterBox.isEmpty()
    ? new THREE.Box3(new THREE.Vector3(-CFG.garden.w / 2, 0, -CFG.garden.d / 2),
                     new THREE.Vector3( CFG.garden.w / 2, CFG.wall.h, CFG.garden.d / 2))
    : casterBox;
  /* 复刻 DirectionalLightShadow.updateMatrices 的朝向：相机就在光位、看向 target */
  c.position.copy(sun.position);
  c.up.set(0, 1, 0);
  c.lookAt(sun.target.position);
  c.updateMatrixWorld(true);
  _fitInv.copy(c.matrixWorld).invert();
  let L = Infinity, R = -Infinity, B = Infinity, T = -Infinity, ZN = Infinity, ZF = -Infinity;
  for (let i = 0; i < 8; i++){
    _fitV.set(i & 1 ? box.max.x : box.min.x,
              i & 2 ? box.max.y : box.min.y,
              i & 4 ? box.max.z : box.min.z).applyMatrix4(_fitInv);
    L = Math.min(L, _fitV.x); R = Math.max(R, _fitV.x);
    B = Math.min(B, _fitV.y); T = Math.max(T, _fitV.y);
    ZN = Math.min(ZN, -_fitV.z); ZF = Math.max(ZF, -_fitV.z);
  }
  /* 余量 1.5m：最边缘的投射物必须**整个**进图 —— 半个身子在盒外 = 只剩半个影子 */
  const M = 1.5;
  c.left = L - M; c.right = R + M; c.bottom = B - M; c.top = T + M;
  c.near = Math.max(0.5, ZN - M); c.far = ZF + M;
  c.updateProjectionMatrix();
  sun.userData.fitInfo = { L, R, B, T, ZN, ZF, n: casterBox.isEmpty() ? 0 : 1 };
  return sun.userData.fitInfo;
}
/* ⚠️ 这里**没有**顶层 `fitShadowCamera()` 调用 —— 它读 `world`，而 world 由 08-assemble 定义、
   且 08 反过来要 import 本模块的 mergeStatics/validateGeometry，构成环。本模块先求值 →
   顶层调用必撞 "Cannot access 'world' before initialization"。
   原 §9 段首的那次调用已移回 08 的 body 末尾（那里 world 才填满、且刚好是原 §8 跑完的时点）。 */

/* ── 阴影按需更新 ──
   6144² ≈ 3770 万纹素的深度图原来**每帧全量重渲**（autoUpdate 恒开），
   而且 Reflector 的镜像 pass 里还会再渲一遍 —— 光向与投射物静止时全是白干的。
   改为显式失效，触发点三处：
   ① 环境过渡期间（sunPos 每时段都在动，applyEnv 逐帧改光向）
   ② 资产迟到（晒背龟/芭蕉/莲 GLB 都是真投射物，onAssetAttached）
   ③ WebGL 上下文恢复（深度图纹理已丢，必须补渲一次）。
   主色 RenderPass 在 pass 链最前，会用完整可见性消费失效标记；GTAO 辅助
   pass 在其后且本就压着阴影，不会用"植被被隐藏"的状态渲出脏阴影。 */
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.domElement.addEventListener('webglcontextrestored', () => { renderer.shadowMap.needsUpdate = true; });

export const amb = new THREE.AmbientLight(CFG.amb.color, CFG.amb.intensity);
scene.add(amb);

// 补光：从水面方向反射的冷调反弹光，压暗部
export const fill = new THREE.DirectionalLight(0xbcd2e0, 0.32);
fill.position.set(-30, 14, -26);
scene.add(fill);

// 天光半球，柔化阴影
// 保留引用：ENV 系统要按时段改它的天光/地光颜色与强度
export const hemiLight = new THREE.HemisphereLight(0xE8ECEA, 0x6B7B52, 0.35);
scene.add(hemiLight);