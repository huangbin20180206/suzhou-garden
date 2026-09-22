// 05-water: from index.html inline 1062..1435
import { THREE, mergeGeometries, Reflector } from '../vendor.js';
import { CFG, rnd, rr, pick, TAU, DEG, registry, mulberry32, bootMark } from './00-config.js';
import { MAT, waterNormalTex, WATER_REFLECT_SHADER, waterSurface, setWaterSurface, auxPass, makePondBedTex, WIND, addWind } from './01-materials.js';
import { scene, renderer, camera, controls, skyMesh, lumOf, ENV_BAKE_LUM, GPU_TIER } from './02-scene.js';
import { mesh, box, makeColumn, instancedBoxes, instancedGeo, makeCorrugatedSlab, DOUGONG_H, makeDougongGeo, makeChineseRoof, makeCeiling, makeQueTu, makeGuaLuo, makeJiangnanWindow, makeChangChuang, makeLatticePanel, makeWallRun, makeWallCap } from './03-factory.js';
/* ══════════════════════════════════════════════════════════════
   5 · 水体 · 桥 · 驳岸
   ══════════════════════════════════════════════════════════════ */

/* 葫芦形池塘轮廓 */
function makePondShape(){
  const s = new THREE.Shape();
  s.moveTo(-16, 0);
  s.bezierCurveTo(-16, 6.4, -12.4, 9.4, -7.2, 9.4);   // 左瓣上半
  s.bezierCurveTo(-3.2, 9.4, -1.2, 5.2, 0, 4.1);       // 收腰
  s.bezierCurveTo(1.4, 3.0, 4.2, 6.2, 9.2, 6.2);       // 右瓣上半
  s.bezierCurveTo(13.2, 6.2, 15.4, 3.2, 15.4, 0);      // 右端
  s.bezierCurveTo(15.4, -3.2, 13.2, -6.2, 9.2, -6.2);  // 右瓣下半
  s.bezierCurveTo(4.2, -6.2, 1.4, -3.0, 0, -4.1);      // 收腰
  s.bezierCurveTo(-1.2, -5.2, -3.2, -9.4, -7.2, -9.4); // 左瓣下半
  s.bezierCurveTo(-12.4, -9.4, -16, -6.4, -16, 0);
  return s;
}
const POND_SHAPE = makePondShape();
export const POND_PTS = POND_SHAPE.getPoints(160);   // 用于驳岸布石

/* 池形内外判定（坐标相对池心 0,0） */
export function insidePond(x, y){
  const poly = POND_PTS;
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

/* 池岸半径表：从池心按角度射线求到岸线的距离 */
export const POND_RADII = (()=>{
  const N = 160, res = new Float32Array(N);
  for (let k = 0; k < N; k++){
    const a = (k / N) * TAU;
    const dx = Math.cos(a), dy = Math.sin(a);
    let r = 0;
    for (let s = 0.4; s < 22; s += 0.2){
      if (!insidePond(dx * s, dy * s)) break;
      r = s;
    }
    res[k] = r * 0.92;                        // 留余量贴岸
  }
  return res;
})();

/* 池底：径向网格 + 碗形。原来是 ShapeGeometry 的**一整块平面**（还只有外轮廓顶点），
   既无法做出深度变化，也没法位移成缓坡 —— 低头看就是一块均匀的深色板。
   这里改成「角向 128 × 径向 24」的网格：中心最深、向岸抬升，并带轻微起伏。 */
function makePondBed(shoreY = 0.34, maxDepth = 1.45){
  const NA = 128, NR = 24;
  const verts = [], uvs = [], idx = [];
  for (let i = 0; i <= NR; i++){
    const u = i / NR;
    for (let k = 0; k <= NA; k++){
      const a = (k / NA) * TAU;
      /* ⚠️ 角向最后一列（k=NA, a=TAU）必须回到 k=0 的半径：原来的 min() 钳位让同一个
         角度用到了 POND_RADII[len-1]，与 k=0 的 POND_RADII[0] 差一个台阶 ——
         池底沿 +x 轴有一条径向接缝。取模就周期闭合了。 */
      const ri = Math.floor((a / TAU) * POND_RADII.length) % POND_RADII.length;
      const R = POND_RADII[ri];
      // u=0 直接收到一点，把原来 3cm 的中央开口封掉（一圈顶点重合，退化三角形无害）
      const r = R * u;
      const y = -(shoreY + (maxDepth - shoreY) * Math.sqrt(Math.max(0, 1 - u * u)));
      const wob = 0.055 * Math.sin(a * 5 + u * 7) * u;      // 轻微淤积起伏
      verts.push(Math.cos(a) * r, y + wob, Math.sin(a) * r);
      uvs.push(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16);
    }
  }
  for (let i = 0; i < NR; i++){
    for (let k = 0; k < NA; k++){
      const a0 = i * (NA + 1) + k, b0 = a0 + 1;
      const c0 = (i + 1) * (NA + 1) + k, d0 = c0 + 1;
      idx.push(a0, b0, c0,  b0, d0, c0);       // 绕序保证法线朝上
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ══ 水面真折射（P2-5）══
   水面下其实是另一张贴图：「从水面上方俯视的池底」。用一架**只看水下层**的正交
   相机单独渲染（池底 + 锦鲤 + 泳龟 + 水草），水面 shader 再按波纹把采样 UV 掰弯
   后取它 —— 这才是「透过水面看到水底在晃」，而不是把反射图平移一下装样子。
   ⚠️ 只渲水下那一层是全部意义所在：靠 layer 隔离（折射相机只看 LAYER_REFRACT），
      水面 / 天空 / 建筑 / 睡莲叶全都不进这张贴图，否则就是「水底里映着屋顶」。
   ⚠️ 与平面反射（Reflector，把整场景再渲一遍）是两回事：折射只渲水下几十个网格、
      半分辨率、不渲阴影，核显档也开得起（Reflector 在核显档是被关掉的）。
   ⚠️ layer **不被子节点继承**：异步挂上来的锦鲤/泳龟必须在挂载的那一处补打标记
      （06-vegetation 的锦鲤回调、08 的泳龟回调），漏了就是「水底没有鱼」——静默。 */
export const LAYER_REFRACT = 3;
let refractRT = null, refractCam = null, refractReady = false;
export const REFRACT_ON = (()=>{ try { return !/[?&]refract=0/.test(location.search); } catch { return true; } })();
/* 折射贴图覆盖的世界包围盒（池心 z=+3；POND_SHAPE 外扩 0.4m，给边缘扭曲采样留余量）。
   ⚠️ 必须沿池心**对称**：正交相机的 left/right/top/bottom 是**相机空间**量，而相机
      架在 (0,10,3) 看向 (0,0,3) → 相机空间 x = −世界x、y = 世界z − 3。原来直接把
      世界包围盒 [−16.4, 15.8]×[−6.8, 12.8] 塞进去，视锥在世界 z 上就只盖 [−9.8, 9.8]
      （池北大半截在视锥外）、x 整体偏 0.6m —— 贴图没画错，是「世界→纹素」换算对不上，
      鱼全数读在池底上（复核工具 `probe/_refract-map-check.mjs`：往已知世界坐标放标记、
      扫贴图质心，对「世界坐标 / 漏池心偏移 / x 镜像」三个假设算距离 —— 一次定案）。
      沿池心对称后，相机空间与世界只差一个池心平移 + x 镜像，shader 的 UV 换算才成立。 */
const PBOX = { minX: -16.4, maxX: 16.4, minZ: -6.8, maxZ: 12.8 };
const PBW = PBOX.maxX - PBOX.minX, PBD = PBOX.maxZ - PBOX.minZ;
const REFRACT_CLEAR = 0x1C2E29;        // 包围盒外缘的深水底色（边缘扭曲采样会带到）

export function markUnderwater(root){
  if (!root) return;
  root.traverse(o => { o.layers.enable(LAYER_REFRACT); });
}

function setupRefraction(water){
  if (!REFRACT_ON || refractRT) return;
  const texW = GPU_TIER === 'low' ? 384 : 768;
  /* UnsignedByte 而非 HalfFloat：池底视图是 LDR 内容，8 位足够；HalfFloat 贴图
     在 readPixels 时要求 Uint16Array 读回，门禁多一道转换，且显存翻倍。 */
  refractRT = new THREE.WebGLRenderTarget(texW, Math.round(texW * PBD / PBW),
                                          { type: THREE.UnsignedByteType });
  /* 折射贴图要经水面以斜角采样，没 mipmap 会让池底纹理在平视时闪成一片噪点 */
  refractRT.texture.generateMipmaps = true;
  refractRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  refractRT.texture.wrapS = refractRT.texture.wrapT = THREE.ClampToEdgeWrapping;
  /* left/right/top/bottom 是相机空间：相机在 (0,10,3) 看池心，相机空间 x=−世界x、
     y=世界z−3。要贴图沿池心对称覆盖世界包围盒，就传**半宽/半深**而不是世界边界。 */
  refractCam = new THREE.OrthographicCamera(-PBW / 2, PBW / 2, PBD / 2, -PBD / 2, 4, 18);
  refractCam.position.set(0, 10, 3);
  refractCam.up.set(0, 0, 1);
  refractCam.lookAt(0, 0, 3);
  refractCam.layers.set(LAYER_REFRACT);      // 只看水下层：水面/天空/建筑自动缺席
  refractCam.updateProjectionMatrix();
  camera.layers.enable(LAYER_REFRACT);       // 主相机照旧看得到它们（不能把鱼从主画面里弄没了）
  const u = water.material.uniforms;
  u.uRefract.value = refractRT.texture;
  u.uPondMin.value.set(PBOX.minX, PBOX.minZ);
  u.uPondSize.value.set(PBW, PBD);
}

  const _clearColor = new THREE.Color();
export function renderRefraction(){
  if (!REFRACT_ON || !refractRT) return;
  /* 与 Reflector 同一套保存/还原：渲完贴图把渲染器状态原样放回去。
     ⚠️ 阴影必须关掉自动更新 —— 折射相机也要跑一遍 renderer.render，
        不关等于每帧多渲一张 6144² 阴影图（池底/鱼/草本来就不投也不接收阴影）。
     ⚠️ 清屏色必须在 setRenderTarget **之前**设：r184 的 setRenderTarget 在
        autoClear=true 时会顺手按当前清屏色清一遍目标。 */
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.shadowMap.autoUpdate;
  renderer.getClearColor(_clearColor);
  const prevClearAlpha = renderer.getClearAlpha();
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(REFRACT_CLEAR, 1);
  renderer.setRenderTarget(refractRT);
  renderer.state.buffers.depth.setMask(true);
  try { renderer.render(scene, refractCam); }
  finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(_clearColor, prevClearAlpha);
    renderer.shadowMap.autoUpdate = prevAuto;
  }
  if (!refractReady){
    refractReady = true;                     // 首张贴图到位之前水面走老逻辑（uRefractOn 仍为 0）
    if (waterSurface) waterSurface.material.uniforms.uRefractOn.value = 1;
  }
}
export function refractInfo(){
  return { on: REFRACT_ON, ready: refractReady, layer: LAYER_REFRACT,
           texW: refractRT ? refractRT.width : 0, texH: refractRT ? refractRT.height : 0,
           box: PBOX };
}
export function getRefractRT(){ return refractRT; }

export function makePond(){
  const g = new THREE.Group();
  // 水面：平面反射（镜像渲染整场景），非透明材质但按菲涅尔调 alpha 以便看见水下鱼
  const wGeo = new THREE.ShapeGeometry(POND_SHAPE, 40);
  // ⚠️ 不要把旋转烘进几何。Reflector 是从 matrixWorld 推镜面法线的：
  //     normal = (0,0,1) 经 matrixWorld 的旋转部分变换。烘进几何后 matrixWorld
  //     只剩平移，法线退化成水平的 (0,0,1)，于是它的「是否背对相机」判据变成了
  //     「相机在池塘哪一侧」——相机在池北时会直接 return 不更新反射贴图，
  //     水面便采样到过期贴图（用新投影矩阵采旧画面，UV 全错）而拖出紫色。
  //     改为给 mesh 加旋转，matrixWorld 里就有正确的 up 法线了。
  const water = new Reflector(wGeo, {
    textureWidth: GPU_TIER === 'high' ? 1024 : 640,
    textureHeight: GPU_TIER === 'high' ? 1024 : 640,
    clipBias: 0.004,
    color: 0x25443C,          // 深水底色（0x14201E → 0x1C2E29 → 现在 0x25443C：俯视时的自色别再是黑洞）
    shader: WATER_REFLECT_SHADER,
  });
  water.material.transparent = true;
  water.material.depthWrite = false;
  water.rotation.x = -Math.PI / 2;          // 旋转放在 mesh 上，而不是烘进几何
  water.position.set(0, CFG.water + 0.06, 3.0);
  water.name = 'waterSurface';
  water.receiveShadow = false;
  // 核显档：跳过平面反射的镜像渲染（这是核显上最大的一笔开销）
  // 高档位：只在**主 pass**里刷新反射，辅助 pass（AO 的法线/深度）里不刷（见 GTAO wrapper）
  const reflectOnce = water.onBeforeRender.bind(water);
  if (GPU_TIER === 'low'){
    water.onBeforeRender = () => {};
    water.material.uniforms.uReflMix.value = 0;
  } else {
    water.onBeforeRender = (renderer, scene, camera) => { if (!auxPass) reflectOnce(renderer, scene, camera); };
  }
  setWaterSurface(water);
  setupRefraction(water);                    // 折射相机 + 池底贴图，创建一次、接好 uniform
  g.add(water);
  /* 池底：带纹理的碗形。原来是一块 color:0x1A2422 的平面 —— 低头看就是一片黑。 */
  const bedTex = makePondBedTex();
  const bedMat = new THREE.MeshStandardMaterial({
    map: bedTex, color: 0xFFFFFF, roughness: 0.96, metalness: 0.0, envMapIntensity: 0.22,
  });
  /* 水下焦散：光斑由世界坐标 + 时间驱动，注入到 diffuse。
     这是「水下有光在晃」最便宜的实现，也让池底不再是死板的一块。 */
  bedMat.onBeforeCompile = (shader)=>{
    shader.uniforms.uTime = WIND.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBedW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBedW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const cau = [
      'varying vec3 vBedW;',
      'uniform float uTime;',
      'float causticPat(vec2 p, float t){',
      '  vec2 i = p; float c = 1.0; float inten = 0.0045;',
      '  for (int n = 0; n < 4; n++){',
      '    float ti = t * (1.0 - (3.5 / float(n + 1)));',
      '    i = p + vec2(cos(ti - i.x) + sin(ti + i.y), sin(ti - i.y) + cos(ti + i.x));',
      '    c += 1.0 / length(vec2(p.x / (sin(i.x + ti) / inten), p.y / (cos(i.y + ti) / inten)));',
      '  }',
      '  c /= 4.0; c = 1.17 - pow(c, 1.4);',
      '  return clamp(pow(abs(c), 8.0), 0.0, 1.5);',
      '}',
    ].join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + cau)
      .replace('#include <color_fragment>',
               '#include <color_fragment>\n' +
               '  float cau = causticPat(vBedW.xz * 1.25, uTime * 0.5);\n' +
               '  diffuseColor.rgb *= (0.85 + 0.60 * cau);');
  };
  const bed = mesh(makePondBed(0.95, 1.80), bedMat, { cast:false, receive:false, name:'pondBed' });
  bed.position.set(0, CFG.water, 3.0);
  markUnderwater(bed);                        // 池底入折射层（材质唯一，不会被 mergeStatics 并走）
  g.add(bed);
  // 池岸缓坡：只保留岸边草环（挖掉池面），否则水下会透出草纹像草地
  const bankOuter = new THREE.Shape();
  POND_PTS.forEach((p, i)=>{
    const x = p.x * 1.14, y = p.y * 1.14;
    i === 0 ? bankOuter.moveTo(x, y) : bankOuter.lineTo(x, y);
  });
  const bankInner = new THREE.Path();
  for (let i = POND_PTS.length - 1; i >= 0; i--){
    const p = POND_PTS[i];
    i === POND_PTS.length - 1 ? bankInner.moveTo(p.x, p.y) : bankInner.lineTo(p.x, p.y);
  }
  bankOuter.holes.push(bankInner);
  const bankGeo = new THREE.ShapeGeometry(bankOuter, 8);
  bankGeo.rotateX(-Math.PI/2);
  const bank = mesh(bankGeo, MAT.grass, { cast:false });
  bank.position.set(0, CFG.water + 0.02, 3.0);
  /* 岸草环与别处共用 MAT.grass，会被 mergeStatics 并进静态大网。
     不 markUnderwater：岸草环是岸边的草，不在水下，不应进入折射贴图。
     冬季 MAT.grass 变白（积雪）后，若留在折射层会在水面形成明显的白色异常。
     noMerge 保留：防止几何合并导致后续如果需要独立操作 bank 时找不到它。 */
  bank.userData.noMerge = true;
  g.add(bank);
  return g;
}

/* 太湖石驳岸：沿池边实例化圆润河石（水流冲刷感，非棱角） */
export function makeBankRocks(){
  const geos = [
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.SphereGeometry(1, 12, 9),
    new THREE.IcosahedronGeometry(1, 1),
  ];
  geos.forEach(g=>{
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++){        // 轻微扰动 → 自然河石
      const n = rr(0.9, 1.12);
      p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * rr(0.6, 0.85), p.getZ(i) * n);
    }
    g.computeVertexNormals();
  });
  const buckets = geos.map(()=> []);
  const N = POND_PTS.length;
  for (let i = 0; i < N; i += 2){
    const p = POND_PTS[i];
    const ang = Math.atan2(p.y, p.x);
    const jitter = rr(0.86, 1.06);
    const x = p.x * jitter, z = p.y * jitter + 3.0;
    const k = (rnd()*3)|0;
    buckets[k].push({
      x, y: rr(-0.28, 0.12), z,
      s: rr(0.26, 0.52), ry: rr(0, TAU),
    });
  }
  const group = new THREE.Group();
  buckets.forEach((list, gi)=>{
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geos[gi], MAT.riverStone, list.length);
    inst.castShadow = false; inst.receiveShadow = true;
    const m = new THREE.Matrix4(), pv = new THREE.Vector3(),
          q = new THREE.Quaternion(), sv = new THREE.Vector3();
    const col = new THREE.Color();
    list.forEach((it, i)=>{
      pv.set(it.x, it.y, it.z);
      q.setFromEuler(new THREE.Euler(rr(-0.3,0.3), it.ry, rr(-0.3,0.3)));
      sv.set(it.s*rr(0.8,1.4), it.s*rr(0.6,1.0), it.s*rr(0.8,1.4));
      m.compose(pv, q, sv); inst.setMatrixAt(i, m);
      col.setHSL(0.09, 0.06, rr(0.4, 0.66));       // 石色深浅不一
      inst.setColorAt(i, col);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  });
  /* 驳岸石入折射层：jitter 取 0.86~1.06（岸线内外摆动）× y 取 -0.28~+0.12，
     所以**约三分之一落在岸线内侧、石体下半截真的沉在水里**（最深约 1m）。
     不打标记的话，透过水看池边那圈石头会在水面处被齐刷刷切断
     （探针 `probe/refract-coverage.mjs` 实测：三张实例化网格下探 0.89~1.01m）。
     代价是岸上那部分石头也会被渲进"水下世界"贴图 —— 正交俯视相机分不出水线上下，
     这是本方案固有的取舍，与池中立峰/伴石一致。 */
  markUnderwater(group);
  return group;
}


/* 汉白玉单孔拱桥 */
export function makeArchBridge(){
  const g = new THREE.Group();
  const span = 9.4, rise = 2.1, deckW = 2.9, thick = 2.4;
  /* ⚠️ 拱洞高度必须**从桥身轮廓反推**，不能独立拍。桥身是贝塞尔拱（端点 rise*0.62、
     控制点 rise*0.98），拱顶 = (0.62 + 3×0.98 + 3×0.98 + 0.62)/8 × rise = 0.89·rise = 1.869。
     原来拱洞半径单独取 span*0.29 → 洞顶 = 0.05 + 2.726 = **2.776**，比桥身拱顶还高 0.9m：
     洞口穿出桥面，锁石（2.876）与拱券带浮在桥面上方 0.7m。 */
  const bodyCrown = (0.62 + 3 * 0.98 + 3 * 0.98 + 0.62) / 8 * rise;
  const ARCH_MIN = 0.30;                 // 洞顶到桥身顶面至少留的结构厚度

  // 侧面轮廓：外矩形 + 弧形桥面 + 半圆拱洞
  const s = new THREE.Shape();
  s.moveTo(-span/2, 0);
  s.lineTo(-span/2, rise * 0.62);
  // 桥面弧线
  s.bezierCurveTo(-span*0.3, rise*0.98, span*0.3, rise*0.98, span/2, rise*0.62);
  s.lineTo(span/2, 0);
  s.lineTo(span/2 - 1.1, 0);
  // 拱洞（半圆）
  const hole = new THREE.Path();
  const hcy = 0.05;
  const hr = Math.max(0.8, bodyCrown - ARCH_MIN - hcy);   // 见上方推导
  hole.moveTo(-hr, hcy);
  hole.absarc(0, hcy, hr, Math.PI, 0, true);
  hole.lineTo(hr, hcy);
  hole.lineTo(-hr, hcy);
  s.holes.push(hole);
  s.lineTo(-span/2, 0);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, { depth:thick, bevelEnabled:false, curveSegments:24 });
  geo.translate(0, 0, -thick/2);
  const body = mesh(geo, MAT.marble, { name:'bridgeBody' });
  g.add(body);

  // 桥面石板（沿弧线）
  /* ⚠️ 桥面拱顶要落在**桥身拱顶之上一点点**：原来用 rise*1.0 = 2.10，比桥身拱顶 1.869
     高 0.23 —— 中间是一条透空的缝（低侧视角能看见桥面悬在桥身上）。 */
  const deckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-span/2, rise*0.62, 0),
    new THREE.Vector3(0, bodyCrown + 0.10, 0),
    new THREE.Vector3(span/2, rise*0.62, 0),
  ]);
  const N = 28;                              // 石板加密，消除台阶感
  for (let i = 0; i < N; i++){
    const t = (i + 0.5)/N;
    const pt = deckCurve.getPoint(t);
    const tan = deckCurve.getTangent(t);
    const slab = mesh(box(span/N * 1.12, 0.13, thick + 0.3), MAT.marble, { name:'deckSlab' });
    slab.position.set(pt.x, pt.y + 0.065, 0);
    slab.rotation.z = Math.atan2(tan.y, tan.x);
    g.add(slab);
  }
  // 桥身装饰：拱洞两侧的雕花束腰
  [-1, 1].forEach(zs=>{
    const band = mesh(new THREE.TorusGeometry(hr + 0.02, 0.07, 6, 28, Math.PI), MAT.marble, { name:'archBand' });
    band.position.set(0, hcy, zs * (thick / 2 + 0.02));
    g.add(band);
    // 拱顶锁石
    const key = mesh(box(0.26, 0.4, 0.18), MAT.marble, { name:'keystone' });
    key.position.set(0, hcy + hr + 0.1, zs * (thick / 2 + 0.06));
    g.add(key);
  });

  // 望柱（4 根圆头柱）+ 栏板
  [-1, 1].forEach(sgn=>{
    for (let i = 0; i < 4; i++){
      const t = 0.13 + (i/3) * 0.74;
      const pt = deckCurve.getPoint(t);
      const post = mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.82, 8), MAT.marble, { name:'baluster' });
      post.position.set(pt.x, pt.y + 0.55, sgn*(thick/2 - 0.12));
      g.add(post);
      const knob = mesh(new THREE.SphereGeometry(0.17, 10, 8), MAT.marble);
      knob.position.set(pt.x, pt.y + 1.0, sgn*(thick/2 - 0.12));
      g.add(knob);
      // 栏板
      if (i < 3){
        const t2 = t + 0.74/3;
        const p2 = deckCurve.getPoint(t2);
        const rail = mesh(box(Math.abs(p2.x - pt.x) * 1.02, 0.42, 0.13), MAT.marble, { name:'railPanel' });
        rail.position.set((pt.x + p2.x)/2, (pt.y + p2.y)/2 + 0.52, sgn*(thick/2 - 0.12));
        rail.rotation.z = Math.atan2(p2.y - pt.y, p2.x - pt.x);
        g.add(rail);
      }
    }
  });

  // 拱券石：沿拱洞一圈的楔形石（复用拱洞半径 hr / 圆心高 hcy）
  const nStone = 13;
  for (let i = 0; i < nStone; i++){
    const am = Math.PI * ((i + 0.5) / nStone);
    const st = mesh(box(0.3, 0.26, thick + 0.08), MAT.marble, { name:'archStone' });
    st.position.set(Math.cos(am) * (hr + 0.14), hcy + Math.sin(am) * (hr + 0.14), 0);
    st.rotation.z = am - Math.PI / 2;
    g.add(st);
  }
  // 桥头抱鼓石
  [-1, 1].forEach(sgn=>{
    [1, -1].forEach(zs=>{
      const drum = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.28, 12), MAT.marble, { name:'drumStone' });
      drum.rotation.x = Math.PI / 2;
      drum.position.set(sgn * (span / 2 + 0.15), rise * 0.62 + 0.52, zs * (thick / 2 - 0.12));
      g.add(drum);
    });
  });

  // 桥头平板石（折线延伸）
  [-1, 1].forEach(sgn=>{
    const flat = mesh(box(2.2, 0.24, thick + 0.5), MAT.marble, { name:'bridgeApron' });
    flat.position.set(sgn*(span/2 + 1.0), rise*0.62 - 0.12, 0);
    g.add(flat);
  });
  // 桥头踏跺：从平板石逐级落到地面，与周边地势平接
  [-1, 1].forEach(sgn=>{
    const topY = rise * 0.62 - 0.12;
    const nStep = 6;
    for (let i = 0; i < nStep; i++){
      const y = topY - (i + 1) * (topY + 0.1) / (nStep + 0.5);
      const st = mesh(box(0.46, 0.2, thick + 0.4 - i * 0.09), MAT.marble, { name:'approachStep' });
      st.position.set(sgn * (span / 2 + 2.3 + i * 0.46), y, 0);
      g.add(st);
    }
  });

  return g;
}

/* 跨水汀步：等距平直长方青石 */
export function makeSteppingStones(){
  const list = [];
  const n = 11, startX = -3.6, step = 1.02, z = 5.6;   // 汀步加密，直抵桥侧
  for (let i = 0; i < n; i++){
    list.push({ x: startX + i*step + rr(-0.1,0.1), y: CFG.water + rr(0.03,0.11), z: z + rr(-0.12,0.12), ry: rr(-0.09,0.09) });
  }
  const g = new THREE.InstancedMesh(box(0.68, 0.18, 0.98), MAT.stoneDark, n);
  g.castShadow = g.receiveShadow = true;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1,1,1);
  list.forEach((it, i)=>{
    p.set(it.x, it.y, it.z); q.setFromEuler(new THREE.Euler(0, it.ry, 0));
    m.compose(p, q, s); g.setMatrixAt(i, m);
  });
  g.instanceMatrix.needsUpdate = true;
  return g;
}

bootMark('§5 水体桥');