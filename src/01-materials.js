// 01-materials: from index.html inline 131..1020
import { THREE } from '../vendor.js';
import { CFG, rnd, rr, mulberry32, TAU, registry, BOOT, bootMark } from './00-config.js';
/* ══════════════════════════════════════════════════════════════
   1 · 材质库（命名角色，全局复用）
   ══════════════════════════════════════════════════════════════ */
export function makeRoofTileTex(){                      // 青灰筒瓦：筒瓦圆拱 + 板瓦底 + 岁月斑驳
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#3E4852'; g.fillRect(0, 0, S, S);
  const cols = 10, cw = S / cols;
  for (let i = 0; i < cols; i++){
    const x = i * cw;
    const grd = g.createLinearGradient(x, 0, x + cw, 0);
    grd.addColorStop(0.00, '#2E373F');
    grd.addColorStop(0.16, '#4E5862');
    grd.addColorStop(0.40, '#78838E');
    grd.addColorStop(0.56, '#8B96A1');
    grd.addColorStop(0.78, '#4A545E');
    grd.addColorStop(1.00, '#2A323A');
    g.fillStyle = grd; g.fillRect(x, 0, cw, S);
    g.fillStyle = 'rgba(18,24,30,.8)';           // 筒瓦之间的缝
    g.fillRect(x, 0, 2, S);
  }
  g.fillStyle = 'rgba(26,32,38,.32)';            // 横向瓦垄搭接
  for (let y = 0; y < S; y += 26) g.fillRect(0, y, S, 2);
  for (let i = 0; i < 1100; i++){                // 苔痕与风化
    g.fillStyle = `rgba(${(58 + rr(0,74))|0},${(70 + rr(0,80))|0},${(80 + rr(0,84))|0},.13)`;
    g.fillRect(rnd() * S, rnd() * S, rr(1, 3.2), rr(1, 3.2));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function makePavingTex(){                        // 青砖铺地：45° 斜向菱形拼花 + 磨损
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#BEBAB0'; g.fillRect(0, 0, S, S);   // 原 #DDD9D0 在 ACES 下会糊成纯白
  const n = 8, step = S / n;
  for (let y = 0; y < n; y++){
    for (let x = 0; x < n; x++){
      if (((x + y) & 1) === 0) continue;         // 黑白相间
      const cx = (x + 0.5) * step, cy = (y + 0.5) * step;
      const v = rr(-12, 12);                          // 逐砖色差，避免整片死板
      g.fillStyle = `rgb(${46+v|0},${49+v|0},${52+v|0})`;
      g.beginPath();
      g.moveTo(cx, cy - step * 0.5);
      g.lineTo(cx + step * 0.5, cy);
      g.lineTo(cx, cy + step * 0.5);
      g.lineTo(cx - step * 0.5, cy);
      g.closePath();
      g.fill();
    }
  }
  g.strokeStyle = 'rgba(128,124,116,.55)'; g.lineWidth = 2.0;   // 砖缝
  for (let i = 0; i <= n; i++){
    g.beginPath(); g.moveTo(i*step, 0); g.lineTo(i*step, S); g.stroke();
    g.beginPath(); g.moveTo(0, i*step); g.lineTo(S, i*step); g.stroke();
  }

  // 磨损：磨亮的、磨暗的、苔痕 —— 青砖经年本就深浅不一
  const wear = [
    ['rgba(150,148,140,0.16)', 26, 18, 54],
    ['rgba(96,98,88,0.14)',    20, 14, 42],
    ['rgba(88,110,72,0.10)',   12, 10, 30],
  ];
  for (const [col, cnt, rMin, rMax] of wear){
    g.fillStyle = col;
    for (let i = 0; i < cnt; i++){
      g.beginPath();
      g.ellipse(rnd()*S, rnd()*S, rr(rMin,rMax), rr(rMin,rMax)*rr(0.5,1), rnd()*Math.PI, 0, Math.PI*2);
      g.fill();
    }
  }
  for (let i = 0; i < 6000; i++){
    const v = rr(-18, 18);
    g.fillStyle = `rgba(${150+v|0},${147+v|0},${139+v|0},0.30)`;
    g.fillRect(rnd()*S, rnd()*S, rr(1,2.4), rr(1,2.4));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function makeGroundTex(){                        // 草地：多尺度变化（大色块 → 草簇 → 细叶）
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#6E9C42'; g.fillRect(0,0,512,512);

  // ① 大尺度色块：打破平铺重复感（受旱泛黄 / 湿润深绿 / 中绿 / 草尖高光）
  const blobs = [
    ['rgba(126,150,70,0.30)', 22, 46, 92],
    ['rgba(72,110,52,0.34)',  18, 40, 78],
    ['rgba(96,132,58,0.26)',  24, 34, 70],
    ['rgba(140,160,96,0.18)', 10, 26, 58],
  ];
  for (const [col, n, rMin, rMax] of blobs){
    g.fillStyle = col;
    for (let i = 0; i < n; i++){
      g.beginPath();
      g.ellipse(rnd()*512, rnd()*512, rr(rMin, rMax), rr(rMin, rMax)*rr(0.5,1.0), rnd()*Math.PI, 0, Math.PI*2);
      g.fill();
    }
  }

  // ② 中尺度草簇
  for (let i = 0; i < 900; i++){
    const v = rr(-24, 26);
    g.fillStyle = `rgba(${96+v|0},${138+v|0},${54+v|0},0.5)`;
    g.beginPath();
    g.arc(rnd()*512, rnd()*512, rr(2, 7), 0, Math.PI*2);
    g.fill();
  }

  // ③ 细叶（保留原有竖向笔触）
  for (let i = 0; i < 14000; i++){
    const v = rr(-30, 26);
    g.fillStyle = `rgba(${100+v|0},${146+v|0},${56+v|0},.5)`;
    g.fillRect(rnd()*512, rnd()*512, rr(1,2.4), rr(2,6));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function makePondBedTex(){                       // 池底：淤泥 + 藻斑 + 卵石
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4A4E3C'; g.fillRect(0, 0, S, S);          // 淤泥（不是黑）

  // 大尺度斑块：藻 / 深淤泥 / 沙洲
  const blobs = [
    ['rgba(78,96,54,0.40)',   26, 30, 80],
    ['rgba(56,60,44,0.34)',   20, 24, 64],
    ['rgba(108,108,90,0.26)', 18, 18, 48],
  ];
  for (const [col, n, rMin, rMax] of blobs){
    g.fillStyle = col;
    for (let i = 0; i < n; i++){
      g.beginPath();
      g.ellipse(rnd()*S, rnd()*S, rr(rMin,rMax), rr(rMin,rMax)*rr(0.5,1), rnd()*Math.PI, 0, TAU);
      g.fill();
    }
  }

  // 卵石：石子 + 顶部高光
  for (let i = 0; i < 760; i++){
    const px = rnd()*S, py = rnd()*S, r = rr(2.5, 9);
    const rot = rnd()*Math.PI, ry = r * rr(0.55, 0.95);
    const v = rr(-26, 30);
    g.fillStyle = `rgba(${122+v|0},${120+v|0},${104+v|0},${rr(0.35,0.8).toFixed(2)})`;
    g.beginPath(); g.ellipse(px, py, r, ry, rot, 0, TAU); g.fill();
    g.fillStyle = `rgba(${178+v|0},${174+v|0},${154+v|0},0.32)`;
    g.beginPath(); g.ellipse(px - r*0.2, py - ry*0.25, r*0.42, ry*0.36, rot, 0, TAU); g.fill();
  }

  // 细泥点
  for (let i = 0; i < 12000; i++){
    const v = rr(-16, 16);
    g.fillStyle = `rgba(${74+v|0},${78+v|0},${60+v|0},0.35)`;
    g.fillRect(rnd()*S, rnd()*S, rr(1,2.2), rr(1,2.2));
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function makePlaqueTex(text, vertical = false){  // 匾额 / 对联
  const W = vertical ? 160 : 640, H = vertical ? 640 : 190;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#14110D'; g.fillRect(0,0,W,H);
  g.strokeStyle = '#B8912F'; g.lineWidth = 7; g.strokeRect(11,11,W-22,H-22);
  g.strokeStyle = 'rgba(184,145,47,.35)'; g.lineWidth = 2; g.strokeRect(21,21,W-42,H-42);
  g.fillStyle = '#E7C868';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(231,200,104,.55)'; g.shadowBlur = 16;
  if (vertical){
    const chars = [...text];
    const step = (H - 70) / chars.length;
    g.font = 'bold 88px "KaiTi","STKaiti","SimSun",serif';
    chars.forEach((ch,i)=> g.fillText(ch, W/2, 46 + step*(i+0.5)));
  } else {
    g.font = 'bold 104px "KaiTi","STKaiti","SimSun",serif';
    const chars = [...text].join(' ');
    g.fillText(chars, W/2, H/2 + 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* 碑刻：竖排石绿刻字 + 朱文小印。走"刻"而不是"写"的光影 ——
   字口压深一档、右下留一道浅边，远看才有石面被凿过的立体感。 */
export function makeSteleTex(chars, sub){
  const W = 220, H = 400;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#8E8F88'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++){                       // 石面斑驳
    g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '60,62,58,' : '210,210,200,') + (0.03 + rnd() * 0.07) + ')';
    g.beginPath(); g.arc(rnd() * W, rnd() * H, rr(1, 5), 0, TAU); g.fill();
  }
  g.strokeStyle = 'rgba(50,52,48,.55)'; g.lineWidth = 3;
  g.strokeRect(12, 12, W - 24, H - 24);                // 碑框
  const fs = 96;
  g.font = '600 ' + fs + 'px "Songti SC","SimSun",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  chars.forEach((ch, i)=>{
    const x = W / 2, y = 96 + i * (fs + 26);
    g.fillStyle = 'rgba(230,230,222,.55)'; g.fillText(ch, x + 2.5, y + 2.5);   // 刻口下缘的受光
    g.fillStyle = '#33352F'; g.fillText(ch, x, y);                            // 字口
  });
  g.font = '500 22px "Songti SC","SimSun",serif';
  g.fillStyle = 'rgba(51,53,47,.9)';
  g.fillText(sub || '太湖石', W / 2, H - 54);
  g.fillStyle = 'rgba(150,32,28,.92)';                                        // 朱文小印
  g.fillRect(W / 2 - 15, H - 40, 30, 30);
  g.fillStyle = '#8E8F88';
  g.font = '600 17px "Songti SC","SimSun",serif';
  g.fillText('雲', W / 2, H - 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeInkWashTex(){                        // 水墨山水（屏风背景）
  const W = 512, H = 384;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#EDE6D6'; g.fillRect(0, 0, W, H);          // 宣纸底
  const hill = (baseY, amp, alpha, col)=>{                   // 远山淡墨
    g.fillStyle = col; g.globalAlpha = alpha;
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 14){
      g.lineTo(x, baseY + Math.sin(x * 0.011 + baseY) * amp + Math.sin(x * 0.031) * amp * 0.45);
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  hill(H * 0.60, 26, 0.14, '#5A6470');
  hill(H * 0.71, 34, 0.22, '#4A545F');
  hill(H * 0.83, 20, 0.32, '#3A444E');
  // 一轮红日：外圈朱红晕染，内圈实心
  {
    const sx = W * 0.70, sy = H * 0.26, sr = H * 0.085;
    const halo = g.createRadialGradient(sx, sy, sr * 0.85, sx, sy, sr * 3.0);
    halo.addColorStop(0.0, 'rgba(184,55,42,.38)');
    halo.addColorStop(0.45, 'rgba(184,55,42,.12)');
    halo.addColorStop(1.0, 'rgba(184,55,42,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(sx, sy, sr * 3.0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(178,48,36,.92)';
    g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill();
  }
  g.globalAlpha = 0.10; g.fillStyle = '#6A7A88';             // 水面留白
  g.fillRect(0, H * 0.9, W, H * 0.1);
  g.globalAlpha = 0.5; g.fillStyle = '#3A342C';              // 一叶小舟
  g.beginPath(); g.ellipse(W * 0.62, H * 0.9, 26, 6, 0, 0, TAU); g.fill();
  g.globalAlpha = 0.42; g.strokeStyle = '#2E3A32'; g.lineWidth = 2;  // 松枝
  g.beginPath(); g.moveTo(W * 0.14, H * 0.86);
  g.quadraticCurveTo(W * 0.2, H * 0.66, W * 0.28, H * 0.6); g.stroke();
  for (let i = 0; i < 14; i++){
    const t = i / 14;
    const bx = W * (0.14 + 0.14 * t), by = H * (0.86 - 0.26 * t);
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + rr(-16, 16), by - rr(8, 22)); g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#A8352A'; g.fillRect(W - 76, H - 76, 44, 44);   // 印章
  g.fillStyle = '#EDE6D6'; g.font = 'bold 24px "KaiTi","SimSun",serif'; g.textAlign = 'center';
  g.fillText('園', W - 54, H - 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function makeRockHoleTex(){                       // 太湖石表面：细腻斑驳石质（孔洞由几何挖凹实现）
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#A8A69E'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 3400; i++){                 // 石质斑驳
    g.fillStyle = `rgba(${(140 + rr(0,60))|0},${(140 + rr(0,60))|0},${(134 + rr(0,56))|0},.28)`;
    g.fillRect(rnd() * S, rnd() * S, rr(1, 3.5), rr(1, 3.5));
  }
  g.strokeStyle = 'rgba(118,118,112,.22)'; g.lineWidth = 1.4;   // 淡淡石纹
  for (let i = 0; i < 28; i++){
    const x0 = rnd() * S, y0 = rnd() * S;
    g.beginPath(); g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + rr(-40,40), y0 + rr(-30,30), x0 + rr(-60,60), y0 + rr(-50,50),
                    x0 + rr(-90,90), y0 + rr(-70,70));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export const rockHoleTex = makeRockHoleTex();
bootMark('贴图·太湖石canvas');
// 微表面走法线贴图：平滑法线之后，石面的细孔与麻点靠它来给，而不是靠增加几何
export const rockNormalTex = makeNormalMapFrom(rockHoleTex, 2.4);
bootMark('贴图·太湖石');

export function makeWaterNormalTex(){                   // 水波法线（正弦叠加，供水面细碎反射）
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++){
    for (let x = 0; x < S; x++){
      const nx = Math.sin(x*0.11 + y*0.03)*0.55 + Math.sin(x*0.041 - y*0.067)*0.45;
      const ny = Math.cos(y*0.13 - x*0.02)*0.55 + Math.cos(y*0.05 + x*0.07)*0.45;
      const i = (y*S + x)*4;
      img.data[i]   = 128 + nx*46;
      img.data[i+1] = 128 + ny*46;
      img.data[i+2] = 250;
      img.data[i+3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const roofTileTex = makeRoofTileTex();
export const pavingTex   = makePavingTex();
bootMark('贴图·瓦与砖');

/* 由贴图的明度当高度场，用 Sobel 差分生成法线贴图，让平涂材质产生凹凸立体感 */
export function makeNormalMapFrom(srcTex, strength = 2.0){
  const src = srcTex.image;                    // CanvasTexture 的 image 就是 canvas
  const W = src.width, H = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const od = octx.createImageData(W, H);
  const lum = (x, y)=>{
    const i = (((y + H) % H) * W + ((x + W) % W)) * 4;
    return (sd[i] * 0.299 + sd[i+1] * 0.587 + sd[i+2] * 0.114) / 255;
  };
  for (let y = 0; y < H; y++){
    for (let x = 0; x < W; x++){
      const dx = (lum(x+1, y) - lum(x-1, y)) * strength;
      const dy = (lum(x, y+1) - lum(x, y-1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * W + x) * 4;
      od.data[i]   = (nx / len * 0.5 + 0.5) * 255;
      od.data[i+1] = (ny / len * 0.5 + 0.5) * 255;
      od.data[i+2] = (nz / len * 0.5 + 0.5) * 255;
      od.data[i+3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;                                     // 法线贴图是数据贴图，保持线性色彩空间
}
export const roofNormalTex  = makeNormalMapFrom(roofTileTex, 2.6);
export const pavingNormalTex = makeNormalMapFrom(pavingTex, 1.6);
bootMark('贴图·法线派生');
export const groundTex   = makeGroundTex();
export const waterNormalTex = makeWaterNormalTex();
waterNormalTex.repeat.set(18, 18);
bootMark('贴图·地面水面');

/* 池水着色：采样镜像反射 + 法线扰动 UV + 菲涅尔混合深水色。
   注意不加 tonemapping/colorspace 宏 —— 色调映射统一交给后处理链末端的 OutputPass，
   否则水面会被二次映射而与环境色不一致 */
/* 柳叶帘幕贴图（2026-09-15 柳树重塑）：竖条带 —— 一根微弯细茎 + 沿茎密生的
   窄小柳叶（左右互生、沿茎下指）。canvas 顶部 = 贴图 v=1 = 飘带挂点端 → 偏深；
   梢端偏亮。instanceColor 再叠加内外层次。alphaTest 硬裁边：无透明排序问题。 */
export function makeWillowCurtainTex(){
  const W = 128, H = 560;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  const rnd2 = mulberry32(20260916);        // 固定种子：贴图每次一致
  // 茎：中央微弯竖线（v=1 顶在 canvas 顶部）
  c.strokeStyle = 'rgba(122,124,82,0.95)'; c.lineWidth = 3;
  c.beginPath();
  let sx = W / 2;
  c.moveTo(sx, 4);
  for (let y = 4; y <= H - 4; y += 14){
    sx = W / 2 + Math.sin(y * 0.022) * 5;
    c.lineTo(sx, y);
  }
  c.stroke();
  /* 叶：左右互生、窄披针形。叶距带抖动（步长 8~16px 随机），越往梢端越稀
     （真实柳穗上密下疏）；色相顶深梢亮、逐叶 ±8% 明度与色相噪声 ——
     首版被验收判"等距串珠+整树一个色"，这两处是主因。 */
  let y = 10;
  let row = 0;
  while (y < H - 6){
    const tt = y / H;                              // 0=挂点端 → 1=梢端
    const g = 1 - tt;
    const lr = row % 2 === 0 ? 1 : -1;
    row++;
    y += 8 + rnd2() * 8 + tt * 6;                   // 步长随梢端渐大 = 密度渐疏
    if (rnd2() < tt * 0.30) continue;              // 梢端随机跳叶
    const L = (13 + rnd2() * 13) * (1.05 - tt * 0.22);
    const Wd = 3.4 + rnd2() * 1.8;
    const cx = W / 2 + Math.sin(y * 0.022) * 5 + lr * 3;
    const li = 0.90 + rnd2() * 0.18;
    /* 第十二轮：整贴图提亮+绿移 —— 旧顶部 (158,128,116) 枯褐调挂上枝后整帘读作
       "墨绿近黑"（三轮验收同一结论）。现顶部 (158,182,116) 中性黄绿、
       梢端 (128,212,116) 亮黄绿，配合材质底色 ×1.3 春芽提亮 */
    const rC = Math.round((128 + 30 * g) * li);
    const gC = Math.round((170 - 12 * g) * li);
    const bC = Math.round((92 + 24 * g) * li);
    c.save();
    c.translate(cx, y);
    c.rotate(lr * (0.95 + (rnd2() - 0.5) * 0.5));
    c.fillStyle = `rgb(${rC},${gC},${bC})`;
    c.beginPath();
    c.ellipse(lr * L * 0.45, 0, L * 0.62, Wd * 0.5, 0, 0, TAU);
    c.fill();
    c.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* 桃花瓣窗(canvas)：一朵五瓣桃花的单瓣贴图 —— 泪滴形花瓣、粉白渐变、透明底。
   花(blossom)由 5 片中空花瓣卡以 instancing 拼成，落花(petal)直接用单片。
   用同一张贴图保证桃花/落花同色系（"桃红柳绿"里桃得是粉色，不是大红）。 */
let _peachPetalTex = null;
export function makePeachPetalTex(){
  if (_peachPetalTex) return _peachPetalTex;
  const S = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  const cx = S / 2;
  const drawPetal = (scale, col, yOff = 0) => {   // 泪滴：尖在上、圆腹在下
    const tip = 8 * scale, base = (S - 8) * scale, W = 21 * scale;
    c.beginPath();
    c.moveTo(cx, tip);
    c.quadraticCurveTo(cx + W, (tip + base) * 0.5, cx, base + yOff);
    c.quadraticCurveTo(cx - W, (tip + base) * 0.5, cx, tip);
    c.closePath();
    c.fillStyle = col; c.fill();
  };
  drawPetal(1, 'rgba(250,205,216,1)');            // 底：浅粉
  drawPetal(0.82, 'rgba(238,150,178,0.9)', 2);    // 内：中粉偏红（瓣根到中部）
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _peachPetalTex = tex;
  return tex;
}

export const WATER_REFLECT_SHADER = {
  uniforms: {
    color:         { value: null },       // Reflector 会用 options.color 覆盖
    tDiffuse:      { value: null },       // 反射贴图
    textureMatrix: { value: null },
    tNormal:       { value: waterNormalTex },
    uTime:         { value: 0 },
    uCenter:       { value: new THREE.Vector2(0, 3.0) },   // 池心（世界 XZ）
    uPondAx:       { value: 15.7 },                         // 近似椭圆池形
    uPondAz:       { value: 9.4 },
    uAbsorb:       { value: new THREE.Vector3(0.85, 0.38, 0.28) },  // 红先被吸收 → 深水偏青
    uShallow:      { value: 0.95 },
    uDeep:         { value: 1.80 },
    uSkyTop:       { value: new THREE.Color(0xA8BDD4) },   // 低档位用：天空三停近似反射
    uSkyMid:       { value: new THREE.Color(0xBFD2E6) },
    uSkyHorizon:   { value: new THREE.Color(0xE6E2D8) },
    uReflMix:      { value: 1.0 },                          // 1=真实平面反射，0=天空近似
    uRain:         { value: 0.0 },                          // 降雨强度（0=不改变水面）
    /* 月（2026-09-19）：镜面方向命中月亮 → 池面拉出一条随波纹抖动的光带。
       平面反射贴图分辨率有限 + 菲涅尔会把月轮压得很淡，单靠镜像渲不出"池心那道月光"，
       所以显式补一条（物理上就是粗糙水面把月亮摊成一条竖直光带）。 */
    uMoonDir:      { value: new THREE.Vector3(0, 1, 0) },
    uMoonVis:      { value: 0.0 },
    uMoonColor:    { value: new THREE.Color(0xF4F7FF) },
    /* 晴午太阳波光（2026-09-21）：与月光带同构 —— 视线经波纹法线反射，命中太阳就打
       一串高光；太阳更小而亮 → 指数收得更紧。uSunVis 只在"接近正午 × 晴天"时非 0
       （晨昏/阴雨雪/夜=0），见 applyEnv。常亮则白天水面总是白刺一片。 */
    uSunDir:       { value: new THREE.Vector3(0, 1, 0) },
    uSunVis:       { value: 0.0 },
    uSunColor:     { value: new THREE.Color(0xFFF6E2) },
    /* 水面真折射（P2-5）：水面下另是一张「俯视的池底」贴图 —— 由一架只看水下层的
       正交相机单独渲出来（见 05-water 的折射段），水面再按波纹把采样 UV 掰弯后取它。
       ⚠️ uRefractOn=0 时下面整段折射逻辑被 if 跳过，与本功能加入之前逐字相同。 */
    uRefract:      { value: null },
    uRefractOn:    { value: 0.0 },
    uPondMin:      { value: new THREE.Vector2(-16.4, -6.8) },   // 折射贴图覆盖的世界 XZ 包围盒
    uPondSize:     { value: new THREE.Vector2(32.2, 19.6) },
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main(){
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform float uTime;
    uniform vec2  uCenter;
    uniform float uPondAx, uPondAz, uShallow, uDeep;
    uniform vec3  uAbsorb;
    uniform vec3  uSkyTop, uSkyMid, uSkyHorizon;
    uniform float uReflMix;
    uniform float uRain;
    uniform vec3  uMoonDir, uMoonColor;
    uniform float uMoonVis;
    uniform vec3  uSunDir, uSunColor;
    uniform float uSunVis;
    uniform sampler2D uRefract;
    uniform float uRefractOn;
    uniform vec2  uPondMin, uPondSize;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main(){
      vec3 nrm = texture2D(tNormal, vWorld.xz * 0.055 + vec2(uTime * 0.013, uTime * 0.009)).xyz * 2.0 - 1.0;
      /* 雨点打水：只靠几十个涟漪环是看不出"整片池子在挨雨"的。
         这里给法线叠一层高频扰动（靠时间推进 + 两套不同频率的缩放），
         池面会整片细碎地闪动起来 —— 这才是大雨落在水上的样子。 */
      if (uRain > 0.001){
        vec3 rp1 = texture2D(tNormal, vWorld.xz * 0.55 + vec2(uTime * 0.30, -uTime * 0.23)).xyz * 2.0 - 1.0;
        vec3 rp2 = texture2D(tNormal, vWorld.xz * 0.92 - vec2(uTime * 0.41, uTime * 0.34)).xyz * 2.0 - 1.0;
        nrm.xz += (rp1.xz + rp2.xz) * (0.42 * uRain);
      }
      /* 法线纵向分量 0.86→0.78：水面再"活"一点，波纹把远岸那条反射亮带掰碎，
         否则低档位假反射在远池糊成一整条均匀奶白带（2026-09-21 走查 F1）。 */
      nrm = normalize(vec3(nrm.x * 0.62, 0.78, nrm.y * 0.62));
      vec3 V = normalize(cameraPosition - vWorld);
      /* 菲涅尔改为 Schlick 近似（2026-09-25）：F = F0 + (1 - F0)·(1 - cosθ)^5。
         旧式 pow(1-cos, 2.6) 指数偏小 ⇒ 中等入射角就迅速逼近上限，
         近岸与远岸的反射差别被压平（俯视时也"泛白"）。
         Schlick 的五次方让反射集中在**掠射角**：正上方俯视约 0.02（看清水底），
         平视掠射升到上限，物理与观感都对。
         F0 = 0.02（水对空气），上限 0.68 保留：园林池水不是镜子，
         掠射时也只反射六七成天光，否则低档位的假天空会把远半池盖成一片灰白。
         ⚠️ 这段是 GLSL、位于 JS 模板字符串内：注释里**不能出现反引号**，否则字符串提前结束。 */
      float cosI = clamp(dot(V, nrm), 0.0, 1.0);
      float fres = clamp(0.02 + 0.98 * pow(1.0 - cosI, 5.0), 0.0, 0.68);
      /* 水面折射：原来只是把反射采样偏移一个固定量（0.045），
         那只做出"水在晃"，做不出"透过水看到的池底被水面掰弯"。
         折射的强弱本质取决于**视线与水面的夹角**：越接近斜掠越明显。
         这里按 1-cos(入射角) 收紧偏移量 —— 低头俯视时几乎不变形（看得清池底），
         平视池面时明显变形（水下扭曲）。偏移量压着 0.11 以内，
         避免把反射拉花成一片糊。 */
      vec4 uv = vUv;
      uv.xy += nrm.xz * uv.w * (0.045 + 0.065 * (1.0 - cosI));
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      /* 低档位（核显）不走真实平面反射：Reflector 每帧要把整个场景再渲一遍，
         实测核显上关掉它 33fps → 59fps。这里用天空双色按视线方向近似反射 ——
         水面仍有法线扰动、菲涅尔与水深吸收，只是反射来自天空而非镜像渲染。 */
      /* 低档位假反射（核显不开平面反射）：
         旧值 horizon*0.74 / top*0.88 实测在正午把远半池染成 RGB≈(180,185,180) 的
         奶白"毛玻璃"——真实池水哪怕映着天光，也先被水体自身吸收成深青灰，且池北
         半边映的是建筑/树（暗），不是整片天。压到 0.40/0.52 并混入水色，
         掠射时读起来是"暗下去的天光倒影"而不是白板（2026-09-21 走查 F1）。 */
      /* 三停与天空球同源（F4）：反射光从地平线到天顶也过中腰色，
         暮色里橙/蓝不再在池面上减出紫脏色。 */
      float upv = clamp(-V.y, 0.0, 1.0);
      vec3 fakeH = uSkyHorizon * 0.40 + color * 0.22;
      vec3 fakeM = uSkyMid     * 0.46 + color * 0.19;
      vec3 fakeT = uSkyTop     * 0.52 + color * 0.16;
      vec3 skyFake = mix(fakeH, fakeM, smoothstep(0.0, 0.45, upv));
      skyFake = mix(skyFake, fakeT, smoothstep(0.40, 1.0, upv));
      refl = mix(skyFake, refl, uReflMix);

      // 水体吸收：水柱越厚、视线越斜 → 光程越长 → 越不透明、越偏青。
      // 这一步是「看得见水下」与「深不见底」的分界；靠一个固定 alpha 是做不出来的。
      vec2 lp = vWorld.xz - uCenter;
      float pu = length(vec2(lp.x / uPondAx, lp.y / uPondAz));
      float depth = uShallow + (uDeep - uShallow) * sqrt(max(0.0, 1.0 - pu * pu));
      /* ⚠️ 这里原来是 clamp(dot(-V, up), 0.10, 1.0) —— **符号反了**。
         V 是"从水面指向相机"，俯视时 V≈+y，dot(-V,up) = −1 → 被 clamp 到 0.10；
         斜掠时 dot(-V,up)≈0 → 也被 clamp 到 0.10。也就是说**任何视角 cosT 都等于 0.10**，
         光程 depth/0.1 = 18 倍 → 吸收项 exp(−0.38×18) ≈ 0 → alpha 顶到 0.92~0.97，
         池面永远不透明，只剩固定的 base color(0x1C2E29) —— 看起来就是一块黑板。
         实测（正俯视取像素）：池水 RGB ≈ (30,48,46)，与 base color 几乎一致，池底完全没透出来。
         物理上光程 = depth / |cos(视线与法线夹角)|，所以取绝对值。 */
      float cosT = clamp(abs(dot(V, vec3(0.0, 1.0, 0.0))), 0.10, 1.0);
      vec3 absorb = exp(-uAbsorb * (depth / cosT));
      float body = clamp(1.0 - absorb.g, 0.06, 0.92);

      /* 真折射（P2-5）：采样一张「从水面上方俯视渲出来的池底」，采样点被波纹法线
         掰弯 —— 这才是"透过水面看到水底在晃"，而不是把反射图平移一下装样子。
         ⚠️ 贴图坐标与世界 XZ 是**几何对齐**（折射相机正交朝下、up 朝 +z，
            所以贴图 u 反着世界 x、v 正着世界 z），不靠投影矩阵算。
         偏移量随视角倾斜放大（cosI 越小 = 越斜 = 扭曲越大），与上面反射那行同源；
         量级压在 ~0.4m 以内，否则池底被拉花成一片糊。 */
      vec3 under = color;
      if (uRefractOn > 0.5){
        vec2 ruv = vec2(uPondMin.x + uPondSize.x - vWorld.x, vWorld.z - uPondMin.y) / uPondSize;
        ruv += nrm.xz * (0.004 + 0.020 * (1.0 - cosI));
        under = texture2D(uRefract, clamp(ruv, 0.002, 0.998)).rgb;
        under *= (0.45 + 0.55 * absorb);   // 水深吸收同样压一遍池底：光程越长越暗、越偏青
      }
      vec3 base = mix(color, under, uRefractOn * body);

      vec3 col = mix(base, refl, fres);
      /* 月光带：R 是视线经波纹法线反射后的方向，命中月亮就在该点加上高光。
         两个指数项分工：pow(...,110) 是**镜面像**那一小团（波纹把它抖碎成一片闪点），
         pow(...,16) 是向外扩散的整条光带 —— 真实池面看月亮就是"近处一团碎银、远处拖成一条"。
         ⚠️ 只加不替：平面反射里本来也有月亮（sky 在镜像渲染里），这里是补强不是替换，
         uReflMix=0 的低档位（没有真实反射）也能看到月光。 */
      if (uMoonVis > 0.001){
        vec3 R = reflect(-V, nrm);
        float ms = max(dot(normalize(R), normalize(uMoonDir)), 0.0);
        float glit = pow(ms, 110.0) * 0.95 + pow(ms, 16.0) * 0.11;
        col += uMoonColor * glit * uMoonVis * (0.40 + 0.60 * fres);
      }
      /* 晴午太阳波光：与月光带同构 —— 视线经波纹法线反射，命中太阳就打一串闪点。
         太阳比月亮更小、更亮、更锐 → 指数收得比月光紧（220 vs 110），且只加不替
         （平面反射里的日轮是另一回事）。uSunVis 由 applyEnv 每帧写，
         只在「接近正午 × 晴天」非 0，晨昏/阴雨雪/夜都是 0，不会白天白刺一片。 */
      if (uSunVis > 0.001){
        vec3 R = reflect(-V, nrm);
        float ss = max(dot(normalize(R), normalize(uSunDir)), 0.0);
        float glit = pow(ss, 220.0) * 1.85 + pow(ss, 24.0) * 0.18;
        col += uSunColor * glit * uSunVis * (0.30 + 0.70 * fres);
      }
      /* 折射开着时水面要更"盖得住"：池底已经被采进贴图里了，再让 framebuffer 里
         那张**没被掰弯的**锐利池底透 30% 出来，等于一份清晰叠一份扭曲，看起来是重影。 */
      float alpha = mix(mix(body, 0.94, uRefractOn), 0.97, fres);
      gl_FragColor = vec4(col, alpha);
    }`,
};
export let waterSurface = null;
export function setWaterSurface(v){ waterSurface = v; }
export function getWaterSurface(){ return waterSurface; }
/* 辅助 pass（GTAO 的法线/深度）期间：不刷新平面反射、不重渲阴影 —— 见 GTAO wrapper 处的说明 */
export let auxPass = false;
export function setAuxPass(v){ auxPass = v; }
export function getAuxPass(){ return auxPass; }
/* 辅助 pass 期间需要**整体隐藏**的对象名单（GTAO wrapper 逐帧存/还原 visible）。
   aoSkipped 只遍历 world 且只认材质身份；挂在相机下的镜头粒子（镜前雨帘/雪粒）
   不在 world 里、材质也不在 AO_SKIP_MATS 里 —— 它们若进法线 pass，会被 override
   材质画成一批贴镜头的纯色方块污染 AO。制造者把对象 push 进这里即可。 */
export const AUX_PASS_HIDDEN = [];
/* 启动分段计时的实现已上移到 00-config.js —— 必须比本文件的贴图段更早。
   这里只做转出，index.html 的 `from './src/01-materials.js'` 导入路径不变。 */
export { BOOT, bootMark };

/* 季节色调登记表 —— 材质在**创建时**就登记，这样克隆体（如地面的 MAT.grass.clone()）
   也能拿到季节注入；否则最大的一块可见面（草地）会完全不受季节影响。 */
export const SEASON_TINT_REGISTRY = [];
export function registerSeasonTint(mat, key){ SEASON_TINT_REGISTRY.push([mat, key]); return mat; }

/* ── 远山专用材质（2026-09-21 走查 F6 二轮）──────────────────────────────
   第一轮修复把锯齿折线换成了高斯峰轮廓，但平涂色块与天空之间仍是一条硬切线，
   暮色里读成"剪纸"。这层让每张山脊卡片从山麓到脊线**垂直地溶进当时的雾色**
   （uTopFade：越远的层溶得越多），脊线对比自然软掉；距离雾（fog chunk）照旧叠加。
   接口刻意伪装成 BasicMaterial：暴露可写的 .color 与 userData.baseColor，
   applyEnv 那段「山色跟天光压暗」的代码零改动。脊线渐变直接用 three 每帧
   刷新的 fogColor uniform（雾色随时段自动变：夜里深蓝、暮色暖灰）。
   ⚠️ ShaderMaterial 开 fog:true 时，uniforms 里**必须自带 fogColor/fogDensity**：
   refreshFogUniforms 会直接 uniforms.fogColor.value.copy(...)，缺了就在暖机
   首帧抛 undefined.value（2026-09-21 实测暖机回退）。 */
export function makeDistantMat(hex, opacity, topFade, opts = {}){
  /* opts.map（2026-09-22 加，为当时的"柱状树林"做的可裁剪剪影）：可选的 alpha 裁形贴图。
     传了就在 fragment 里按 alpha<0.5 裁形。
     ⚠️ 2026-09-23："柱状树林"整层已删除，**现在没有任何调用点传 opts** ——
        四层远山脊不传 opts → `${opts.map ? … : ''}` 展开为空串，shader 源码与旧版逐字一致。
        这个能力本身留着（通用、零成本），但别误以为还有谁在用。 */
  const uniforms = {
    uColor:     { value: new THREE.Color(hex) },
    uOpacity:   { value: opacity },
    uTopFade:   { value: topFade },
    fogColor:   { value: new THREE.Color(CFG.fog.color) },
    fogDensity: { value: CFG.fog.density },
    ...(opts.map ? { uMap: { value: opts.map } } : {}),
  };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent:true, depthWrite:false, fog:true,
    vertexShader:`
      varying vec2 vHillUv;
      #include <fog_pars_vertex>
      void main(){
        vHillUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTopFade;
      ${opts.map ? 'uniform sampler2D uMap;' : ''}
      varying vec2 vHillUv;
      #include <fog_pars_fragment>
      void main(){
        ${opts.map ? 'if (texture2D(uMap, vHillUv).a < 0.5) discard;' : ''}
        float h = smoothstep(0.10, 1.0, vHillUv.y);
        vec3 col = mix(uColor, fogColor, uTopFade * h);
        gl_FragColor = vec4(col, uOpacity);
        #include <fog_fragment>
      }`,
  });
  m.color = uniforms.uColor.value;            // 伪装 BasicMaterial 的 .color 接口
  return m;
}

/* ⚠️ 2026-09-23：原 makeTreeSilhouetteTex()（"柱状树林"的树形剪影 alpha 贴图）**已随该层
   一并删除** —— 它唯一的使用者是 MAT.distantTree，而那一层因"堂前池面那棵不知名的白色
   树形剪影"被整层下线（来龙去脉见 07-ground.js 的 makeDistantHills 顶部说明）。
   留这条注记是为了让后来者知道它是**故意删掉的**，不是漏删。 */

export const MAT = {
  // —— 建筑 ——
  wall:     new THREE.MeshStandardMaterial({ color:0xDCD8CF, roughness:0.95, metalness:0.0,  envMapIntensity:0.35 }),
  wallCap:  new THREE.MeshStandardMaterial({ map:roofTileTex, normalMap:roofNormalTex, normalScale:new THREE.Vector2(0.9,0.9), color:0x6C7783, roughness:0.72, metalness:0.06, envMapIntensity:0.7 }),
  roof:     new THREE.MeshStandardMaterial({ map:roofTileTex, normalMap:roofNormalTex, normalScale:new THREE.Vector2(1.1,1.1), color:0x8B95A1, roughness:0.66, metalness:0.08, envMapIntensity:0.85, side:THREE.DoubleSide }),
  ridge:    new THREE.MeshStandardMaterial({ color:0x3C444F, roughness:0.6,  metalness:0.12, envMapIntensity:0.9 }),
  // 博风板：歇山/悬山山面沿屋面边缘的封檐板。用 DoubleSide —— 它是一条很薄的闭合板条，
  // 与其在代码里赌四个侧面的绕序，不如两面都画（薄板没有性能意义）
  gableBoard: new THREE.MeshStandardMaterial({ color:0x5A2E14, roughness:0.66, metalness:0.0,
                                               envMapIntensity:0.5, side:THREE.DoubleSide }),
  wood:     new THREE.MeshStandardMaterial({ color:0x7C3F1D, roughness:0.66, metalness:0.0,  envMapIntensity:0.5 }),
  woodDark: new THREE.MeshStandardMaterial({ color:0x4A2610, roughness:0.74, metalness:0.0,  envMapIntensity:0.4 }),
  woodRed:  new THREE.MeshStandardMaterial({ color:0x8A3A16, roughness:0.62, metalness:0.0,  envMapIntensity:0.5 }),
  // —— 石作 ——
  stone:    new THREE.MeshStandardMaterial({ color:0xB2B0A6, roughness:0.84, metalness:0.03, envMapIntensity:0.45 }),
  stoneDark:new THREE.MeshStandardMaterial({ color:0x8E8D87, roughness:0.9,  metalness:0.02, envMapIntensity:0.45 }),
  marble:   new THREE.MeshStandardMaterial({ color:0x9A9A90, roughness:0.78, metalness:0.04, envMapIntensity:0.5 }),
  rock:     new THREE.MeshStandardMaterial({ color:0x8E8E88, roughness:0.9, metalness:0.02, envMapIntensity:0.5, flatShading:true }),
  rockDark: new THREE.MeshStandardMaterial({ color:0x4A4C4E, roughness:0.78, metalness:0.12, envMapIntensity:0.7, flatShading:true }),
  rockSmooth: new THREE.MeshStandardMaterial({ color:0x9C9C95, roughness:0.86, metalness:0.03, envMapIntensity:0.6 }),
  rockSmoothDark: new THREE.MeshStandardMaterial({ color:0x585C5E, roughness:0.78, metalness:0.1, envMapIntensity:0.75 }),
  // 太湖石用平滑法线：真实太湖石是溶蚀形成的曲面，棱角分明的多面体反而是「低模感」的来源。
  // 皱褶与孔洞由几何本身提供，不靠 flatShading。
  taihu:    new THREE.MeshStandardMaterial({ map:rockHoleTex, normalMap:rockNormalTex,
                                             normalScale:new THREE.Vector2(1.6, 1.6),
                                             color:0xC2C0B8, roughness:0.9, metalness:0.02,
                                             envMapIntensity:0.55, flatShading:false }),
  taihuDark: new THREE.MeshStandardMaterial({ map:rockHoleTex, normalMap:rockNormalTex,
                                              normalScale:new THREE.Vector2(1.5, 1.5),
                                              color:0x7A7C78, roughness:0.84, metalness:0.06,
                                              envMapIntensity:0.65, flatShading:false }),
  /* 特置立峰：几何自带顶点 AO / 风化色斑 / 水线渍带（全部烘在顶点色里），
     所以必须开 vertexColors。贴图与法线沿用太湖石那一套，只把基础色提到
     风化石灰岩的暖白（0xC2C0B8 偏冷灰绿，近景读起来像"脏水泥"）。
     ⚠️ 顶点色不在 mergeStatics 的保留属性里 —— 用本材质的网格必须 noMerge。 */
  taihuHero: new THREE.MeshStandardMaterial({ map:rockHoleTex, normalMap:rockNormalTex,
                                              normalScale:new THREE.Vector2(0.85, 0.85),
                                              color:0xEFE9DC, roughness:0.90, metalness:0.02,
                                              envMapIntensity:0.50, flatShading:false,
                                              vertexColors:true }),
  /* 峰群用的 SDF 石头材质（与立峰同源、明度低一档）—— 同样吃顶点色 AO */
  taihuLobe: new THREE.MeshStandardMaterial({ map:rockHoleTex, normalMap:rockNormalTex,
                                              normalScale:new THREE.Vector2(0.95, 0.95),
                                              color:0xD2CEC2, roughness:0.90, metalness:0.02,
                                              envMapIntensity:0.5, flatShading:false, vertexColors:true }),
  taihuLobeDark: new THREE.MeshStandardMaterial({ map:rockHoleTex, normalMap:rockNormalTex,
                                              normalScale:new THREE.Vector2(0.95, 0.95),
                                              color:0x9EA098, roughness:0.88, metalness:0.05,
                                              envMapIntensity:0.6, flatShading:false, vertexColors:true }),
  winCore:  new THREE.MeshStandardMaterial({ color:0x3A3A38, roughness:0.9, metalness:0.0, envMapIntensity:0.2 }),
  winPaper: new THREE.MeshStandardMaterial({ color:0xD9D3C4, roughness:0.94, metalness:0.0, envMapIntensity:0.25 }),
  lotusPod: new THREE.MeshStandardMaterial({ color:0xBDD270, roughness:0.82, metalness:0.0, envMapIntensity:0.4 }),  // 新蓬黄绿、比叶亮一档（验收：旧色比叶暗，明暗逻辑反了）
  lotusPodAged: new THREE.MeshStandardMaterial({ color:0xB49A58, roughness:0.85, metalness:0.0, envMapIntensity:0.35 }), // 老蓬：黄褐（三成概率）
  lotusPodDark: new THREE.MeshStandardMaterial({ color:0x3A4A20, roughness:0.9, metalness:0.0, envMapIntensity:0.2 }), // 籽孔凹窝：压得更深（孔感靠明暗对比）
  /* ⚠️ 莲子必须有**共享**材质并登进 SEASON_PRESENCE。
     原来每次 makeLotusPod 都 new 一个局部材质 —— 局部材质永远进不了登记表，
     于是冬季杆(MAT.lily)与莲蓬头(MAT.lotusPod)都藏了，只剩 5×9 颗绿色小球悬在水面上，
     正是用户报的"冬季水面上的小绿点"。这是"多材质构件必须整套登记"的第 4 次复现
     （前三次：紫藤、莲蓬、灯笼）。 */
  lotusSeed: new THREE.MeshStandardMaterial({ color:0xC6CA86, roughness:0.65, metalness:0.0, envMapIntensity:0.5 }),  // 莲子浅黄绿：与深凹窝拉满明暗（籽孔特征）
  bananaFruit: new THREE.MeshStandardMaterial({ color:0xFFFFFF, roughness:0.55, metalness:0.0, envMapIntensity:0.5 }),  // 白底：instanceColor 驱动青→黄熟度渐变
  bananaBud:   new THREE.MeshStandardMaterial({ color:0x5C2244, roughness:0.5, metalness:0.0, envMapIntensity:0.4 }),  // 束末蕉蕾（紫红卵形）
  riverStone: new THREE.MeshStandardMaterial({ color:0x9A9A92, roughness:0.88, metalness:0.02, envMapIntensity:0.5 }),
  // —— 水 ——
  // 水面材质改由 Reflector + WATER_REFLECT_SHADER 提供（见 makePond）
  // —— 植被 ——
  grass:    new THREE.MeshStandardMaterial({ map:groundTex, color:0xFFFFFF, roughness:0.96, metalness:0.0, envMapIntensity:0.4 }),
  bambooA:  new THREE.MeshStandardMaterial({ color:0xA8C46A, roughness:0.72, envMapIntensity:0.45 }),
  bambooB:  new THREE.MeshStandardMaterial({ color:0x7FA84C, roughness:0.74, envMapIntensity:0.45 }),
  leaf:     new THREE.MeshStandardMaterial({ color:0x4E8C36, roughness:0.82, envMapIntensity:0.4, side:THREE.DoubleSide }),
  leafDeep: new THREE.MeshStandardMaterial({ color:0x3A6B2C, roughness:0.84, envMapIntensity:0.35, side:THREE.DoubleSide }),
  /* 竹叶/柳叶基色快照：applyEnv 每帧 copy 基色再乘季节系数（防累积），
     春提亮逻辑见 applyEnv 处注释 */
  _leafBase: null, _leafDeepBase: null,
  willow:   new THREE.MeshStandardMaterial({ color:0x6E8F42, roughness:0.85, envMapIntensity:0.35, side:THREE.DoubleSide }),
  /* 柳叶帘幕飘带（2026-09-15 重塑）：alpha 叶纹贴图 + instanceColor 内外明暗。
    裸枝骨架仍走 MAT.willow —— 冬季叶幕收尽后留下的是一身裸枝，这正是冬柳该有的样子 */
  willowLeaf: new THREE.MeshStandardMaterial({ map:makeWillowCurtainTex(), color:0xFFFFFF, roughness:0.85, metalness:0.0, envMapIntensity:1.0, side:THREE.DoubleSide, alphaTest:0.42,
    emissive:0x16240b }),  // 垂帘背光面在顶光下 N·L≈0 会读成黑 —— 用极低自发光抬暗部（验收"发闷发黑"）
  /* 柳树专用枝干色：MAT.bark 的深棕在逆天空下读作"黑铁丝"（三轮验收同一条批评）。
     真实柳枝皮是灰绿褐，明度高一档，天际线对比立刻软化 */
  willowBark: new THREE.MeshStandardMaterial({ color:0x6B5E42, roughness:0.95, metalness:0.0, envMapIntensity:0.3, flatShading:true }),
  /* ⚠️ 2026-09-22：MAT.trunk 全场只有桃树在用（唯一引用在 06 的 makePeachTree）。
     旧色 0x3B2A1E 比 MAT.bark(0x4A3628) 还深 —— 柳树当年正是因为"深棕在逆天空下读作黑铁丝"
     才另起了 willowBark(0x6B5E42)，而桃树一直用着更深的那个：稀疏的桃枝衬在灰天空前
     就是一丛黑铁丝。抬到与 willowBark 同档，并加 flatShading 出低模棱面（与柳同法）。 */
  trunk:    new THREE.MeshStandardMaterial({ color:0x6B5B45, roughness:0.95, envMapIntensity:0.25, flatShading:true }),
  banana:   new THREE.MeshStandardMaterial({ color:0x4F9440, roughness:0.7, envMapIntensity:0.5, side:THREE.DoubleSide }),
  /* 紫藤花（重建）：白底 + instanceColor 逐朵上色（基部深紫→梢端淡紫渐变）。
     "塑料感"三来源全数拆除：①平面圆盘花冠→蝶形旗瓣+下唇 ②roughness 0.78 镜面反光→0.93
     ③整枝裹成花肠→真·总状花序（下垂花穗+互生小花+穗间露茎） */
  /* 紫藤花（重建）：白底 + instanceColor 逐朵上色（基部深紫→梢端淡紫渐变）。
     "塑料感"三来源全数拆除：①平面圆盘花冠→蝶形旗瓣+下唇 ②roughness 0.78 镜面反光→0.93
     ③整枝裹成花肠→真·总状花序（下垂花穗+互生小花+穗间露茎） */
  wisteria: new THREE.MeshStandardMaterial({ color:0xFFFFFF, roughness:0.93, metalness:0.0, envMapIntensity:0.15, side:THREE.DoubleSide }),
  /* 紫藤叶（重建 · 2026-09-17 用户"紫藤叶和花是什么鬼"）：
     旧版 MAT.wisteriaLeaf 基色 0xFFFFFF + 走 tinLeaf 季节通道 —— 季节通道按亮度
     归一化把深绿染成近白，渲染出来是一堆"大白纸片"（用户实拍判语）。
     改成**独立深绿基色 + 不走 tinLeaf**（下面登记表里删掉 wisteriaLeaf），
     冬季随 wisteriaShow 落尽（落叶藤本）的逻辑保留（见 6841 行 wisteriaShow 通道）。 */
  wisteriaLeaf: new THREE.MeshStandardMaterial({ color:0x5E7A3A, roughness:0.9, metalness:0.0, envMapIntensity:0.4, side:THREE.DoubleSide }),
  /* 桃花（2026-09-21）：桃是落叶小乔木，四季生命周期靠 12-env 的季节显隐通道控制：
       peachLeaf（叶冠，走 tinLeaf 季节色 → 秋叶转黄，冬 peachShow=0 落尽裸枝）；
       peachBlossom（花，春开 · 粉白纸质瓣）；peachFruit（果，夏秋红晕蜜桃）；
       peachPetal（落花铺地，春末夏初在地面留一层粉瓣 —— 花落田埂的唯美感）。
     花瓣/Blossom 共用裸色 0xFFFFFF 底 + instanceColor 上色（桃区别于红梅的大红）。 */
  /* ⚠️ 叶基色 0x5E9638 → 0x6BA340（2026-09-22）：盛夏 tintMix=0（季节色原样透传），
     0x5E9638 在强日照的草坪/竹丛旁边读成**一团发黑的绿**（老黄样张判语：像塑料片）。
     提一档明度，仍比竹叶深，保住"桃叶比竹叶沉"的层次。 */
  peachLeaf: new THREE.MeshStandardMaterial({ color:0x6BA340, roughness:0.86, metalness:0.0, envMapIntensity:0.35, side:THREE.DoubleSide }),
  peachBlossom: new THREE.MeshStandardMaterial({ map:makePeachPetalTex(), color:0xFFFFFF, roughness:0.9, metalness:0.0, envMapIntensity:0.2, side:THREE.DoubleSide, alphaTest:0.42 }),
  /* ⚠️ 果基色必须是**白**：实例色（frA→frB 的蜜桃黄→粉晕）会与材质 color 相乘，
     而 multiply 走的是线性空间 —— 基色 0xE08050 再乘一个橙红实例色 = 把颜色**平方**，
     出来的是一颗高饱和深红（用户截图里读作"圣女果"）。
     塑料感另有两个来源：roughness 0.5（果面不该有这么强的镜面）+ envMapIntensity 0.7。 */
  peachFruit: new THREE.MeshStandardMaterial({ color:0xFFFFFF, roughness:0.62, metalness:0.0, envMapIntensity:0.35 }),
  peachPetal: new THREE.MeshStandardMaterial({ map:makePeachPetalTex(), color:0xFFFFFF, roughness:0.92, metalness:0.0, envMapIntensity:0.2, side:THREE.DoubleSide, alphaTest:0.45 }),
  lily:     new THREE.MeshStandardMaterial({ color:0x3E7A34, roughness:0.7,  envMapIntensity:0.5, side:THREE.DoubleSide }),
  lotus:    new THREE.MeshStandardMaterial({ color:0xF2C7D4, roughness:0.62, envMapIntensity:0.55, side:THREE.DoubleSide }),
  reed:     new THREE.MeshStandardMaterial({ color:0x3F6B34, roughness:0.86, envMapIntensity:0.3, side:THREE.DoubleSide }),
  // —— 装饰 ——
  gauze:    new THREE.MeshPhysicalMaterial({ color:0xF4F0E4, roughness:0.55, metalness:0.0,
                                             transparent:true, opacity:0.2, side:THREE.DoubleSide, depthWrite:false }),
  latticeBack: new THREE.MeshStandardMaterial({ color:0xE6DFCC, roughness:0.92, metalness:0.0, envMapIntensity:0.25 }),
  bark:     new THREE.MeshStandardMaterial({ color:0x4A3628, roughness:0.95, metalness:0.0, envMapIntensity:0.25, flatShading:true }),
  gold:     new THREE.MeshStandardMaterial({ color:0xC9A227, roughness:0.34, metalness:0.86, emissive:0x2A1E00, envMapIntensity:1.2 }),
  // 远山：三层递远递淡。fog:true 让它们按距离融进雾色（=天光色），
  // 这才是真正的空气透视；原先 fog:false + 自定颜色，导致远山像贴上去的灰剪纸
  /* uTopFade 二轮（对拍实测）：旧值 0.30/0.38/0.46/0.56 与距离雾叠加，
     浓雾天气（暴雨 fogMul 2.4 / 冬暮 1.28）脊顶被垂直渐变 + Exp2 雾双重推到
     纯雾色，最远层成了"白纸片"。各档收约 1/3，脊线始终留住山色对比，
     "远"的空气透视仍完全交给距离雾负责。 */
  distantNear: makeDistantMat(0x76817F, 0.72, 0.20),
  distantDeep: makeDistantMat(0x8D9899, 0.62, 0.26),
  distant:     makeDistantMat(0xA6AFAF, 0.55, 0.32),
  distantFar:  makeDistantMat(0xBCC3C2, 0.45, 0.40),
  /* ⚠️ 2026-09-23：原 distantTree（"柱状树林"的树形剪影广告牌材质）**已整层删除** ——
     它被修过三轮（矩形→树形、改深灰绿、降不透明度、并进 DISTANT_MATS 跟天光）都断不了根：
     只要这层还在，堂前池北岸就会立着一棵淡色树形剪影（并被 Reflector 镜像进水里）。
     老黄第 3 次指认后明确要求"完全隐藏或者直接删除"，于是连材质带贴图一起下线。
     来龙去脉见 07-ground.js 的 makeDistantHills 顶部说明；这里留注记以示**故意删除**。 */
};
Object.values(MAT).forEach(m => registry.mats++);
/* 竹叶基色快照（applyEnv 春提亮用，见该处注释） */
MAT._leafBase = new THREE.Color(0x4E8C36);
MAT._leafDeepBase = new THREE.Color(0x3A6B2C);
/* 远景固有色快照（applyEnv 夜段压暗用，见该处注释）。
   ⚠️ 这四层远山是 **MeshBasicMaterial —— 不吃任何光**，固有色写死的是白天的灰绿
   （0x76817F → 0xBCC3C2，越远越淡）。白天没问题（它本来就该是那个亮度），
   但夜里灯光全暗、雾色被钳到 0.011 时，山还挂着白天的颜色 → 实测「山 35.4 vs 天 16.9」，
   剪影在夜空上发亮（README P1-2 的真身，probe/mist-guard 抓到）。
   物理上远景山只被天光漫射照明（没有直射、没有材质细节），所以正确做法是把它的 albedo
   乘以「当前天光 / 白天基准」—— 与 environmentIntensity 同源同算，保证山和它背后
   那片天空同步变暗。
   ⚠️ 2026-09-22 晚曾把"柱状远树"也并进这张表；2026-09-23 该层整层删除，本表回到四层远山。
   ⚠️ probe/mist-guard 的"山/天像素"判据用的是**显式四元素数组**（MAT.distant / distantNear /
      distantDeep / distantFar），与本表一致。 */
export const DISTANT_MATS = [MAT.distantNear, MAT.distantDeep, MAT.distant, MAT.distantFar];
DISTANT_MATS.forEach(m => { m.userData.baseColor = m.color.clone(); });

/* ── 天气材质登记表 ──
   积雪（snowCover）：只登记「雪真的会积在上面」的实体面 —— 地面 / 铺地 / 石 / 砖 / 木 /
   屋面 / 植被。刻意不含水面、池底、天空、远景山、窗纸 —— 雪落在水里不会白，落在远景山上
   会变成一片白剪影，两个都是明显的假。
   湿地（wetness）：粗糙度 → 变光、metalness 略微上抬，让天空与树在石板上留下反射。 */
export const SNOW_COVER_MATS = [
  MAT.grass, MAT.reed, MAT.lily, MAT.lotus, MAT.wisteria, MAT.banana,
  MAT.wall, MAT.wallCap, MAT.roof, MAT.ridge,
  MAT.wood, MAT.woodDark, MAT.woodRed,
  MAT.stone, MAT.stoneDark, MAT.marble, MAT.rock, MAT.rockDark,
  MAT.rockSmooth, MAT.rockSmoothDark, MAT.taihu, MAT.taihuDark, MAT.taihuHero,
  MAT.taihuLobe, MAT.taihuLobeDark,
  MAT.riverStone, MAT.bark, MAT.trunk,
];
export const WET_MATS = [MAT.grass, MAT.wall, MAT.wallCap, MAT.roof, MAT.ridge,
                  MAT.stone, MAT.stoneDark, MAT.marble, MAT.riverStone,
                  MAT.rockSmooth, MAT.rockSmoothDark, MAT.taihu, MAT.taihuDark, MAT.taihuHero,
                  MAT.taihuLobe, MAT.taihuLobeDark,
                  MAT.wood, MAT.woodDark, MAT.woodRed];
for (const m of WET_MATS){ m.userData.dryRough = m.roughness; m.userData.dryMetal = m.metalness; }
/* ── 天气角色登记 ──
   SNOW_COVER_MATS / WET_MATS 是**手工维护的数组**，材质必须在创建时登记。
   两条路的容错度不一样，这正是缺陷的来源：
     · 湿（applyWetness）每帧遍历整张 WET_MATS → **晚注册也生效**；
     · 雪（installSnow）只认"装雪那一刻"的数组内容（onBeforeCompile 只在那一刻挂上）
       → 晚注册的材质进了名单却收不到注入。故下面用 SNOW_HOOK 做了晚注册补装。
   ⚠️ 实测教训（同一形状：看名字该有、实际没有，且不报错不崩、状态全对）：
     · 地面是 MAT.grass.clone()、铺地是独立材质 —— 都不在表里，于是**最大的一块可见面
       （草地）与主步道既不积雪也不打湿**；
     · 竹竿（bambooA/bambooB）只配了 SNOW_BOOST 加成、没进雪表 —— 那个加成从来没被用上。 */
/* 破环插槽：装雪器由 12-env 在装配收尾时注册进来（01 不能 import 12，会成环）。
   见下 registerWeatherRoles 里的**晚注册补装**说明。 */
export const SNOW_HOOK = { install: null };

export function registerWeatherRoles(mat, { snow = 0, wet = 0 } = {}){
  if (snow && SNOW_COVER_MATS.indexOf(mat) < 0){
    SNOW_COVER_MATS.push(mat);
    /* ⚠️ 进名单 ≠ 生效。雪是 installSnow(SNOW_COVER_MATS) 在装配收尾**一次性**注入的
       （onBeforeCompile 只在那一刻挂上），此后才 push 进来的材质——deferBoot 的立峰·云根
       就是——名单里有它、着色器里没它：冬天那块石头不积雪，且不报错不崩，状态全对。
       所以名单一更新就立刻补装一次（installSnow 自带 snowInstalled 守卫，幂等）。 */
    if (SNOW_HOOK.install) SNOW_HOOK.install(mat);
  }
  if (wet && WET_MATS.indexOf(mat) < 0){
    WET_MATS.push(mat);
    /* 湿这边没有这个问题：applyWetness 每帧都遍历整张 WET_MATS，晚注册自然生效。 */
    mat.userData.dryRough = mat.roughness;
    mat.userData.dryMetal = mat.metalness;
  }
  return mat;
}
// 竹叶用的是 MAT.leaf，而薄叶面的积雪加成原来只写给了竹竿材质 —— 叶材质本身也要进雪表
registerWeatherRoles(MAT.leaf,     { snow: 1 });
registerWeatherRoles(MAT.leafDeep, { snow: 1 });
registerWeatherRoles(MAT.willowLeaf, { snow: 1 });   // 雪压柳帘
/* ⚠️ 竹竿此前**只配了 SNOW_BOOST 加成、没进雪表**（2026-09-20 补）：
   加成只是 shader 里的 uniform，材质不在表里就压根不会被注入 —— 竹竿那个 0.85
   （SNOW_BOOST 全表最高档，显然是想让雪压在竹竿上）从来没生效过。
   进了表，这个加成第一次真正派上用场；「竹竿竖直、加了也没效果」是错觉：
   0.85 的 boost 把 upness 判据放宽到"只要不是明显朝下就算"。 */
registerWeatherRoles(MAT.bambooA, { snow: 1 });
registerWeatherRoles(MAT.bambooB, { snow: 1 });
export const wetUniform = { value: 0 };

// 植被材质登记季节色调通道
/* ⚠️ wisteriaLeaf 已**移除**出 tinLeaf 通道（2026-09-17）：
   白基色 + tinLeaf 亮度归一化 = 渲染成近白纸片（用户判语"大白纸片"）。
   改为独立深绿基色 0x5E7A3A，季节深浅由 wisteriaShow 通道的**显隐**控制
   （落叶藤本：冬藏），不再有"染白"问题。 */
[['grass','tinGrass'],['bambooA','tinBamboo'],['bambooB','tinBamboo'],
 ['leaf','tinLeaf'],['leafDeep','tinLeaf'],['reed','tinReed'],
 ['willow','tinWillow'],['willowLeaf','tinWillow'],['trunk','tinTrunk'],['lily','tinLily'],
 ['lotus','tinLotus'],['wisteria','tinWisteria'],['banana','tinBanana'],['peachLeaf','tinLeaf']]
 .forEach(([k, key]) => registerSeasonTint(MAT[k], key));

/* 风摆动：注入顶点位移，用于竹叶 / 柳条 / 水草（风场与调度见 addWind / updateWind） */
/* ── 风场 ──
   一场阵风以一个风源（柳树）为中心，强度随到风源的距离衰减。
   相位取顶点的世界坐标，所以邻近枝叶同步摆、远处的不同步 —— 看起来才像风在"走"。
   所有风材质共享同一组 uniform 对象，每帧只需更新一次 */
export const WIND = {
  uTime:         { value: 0 },
  uWindOrigin:   { value: new THREE.Vector3(0, -999, 0) },
  uWindRadius:   { value: 17.0 },
  uWindStrength: { value: 0.0 },      // 局部阵风强度（按风源平方衰减）
  uWindGlobal:   { value: 0.0 },      // **全园均匀**的天气底值风：不乘衰减
  uWindPhase:    { value: 0.0 },
  /* 风**推**的方向：水平单位向量，x 分量对应世界 x、y 分量对应世界 z。
     由 L1 风向调度器（updateWindDir）按 16 档写入。位移合成必须在风向坐标系里做，
     否则 x/z 各自独立振荡会合成出椭圆 —— 那就是"植物在打转"的来源。 */
  uWindVec:      { value: new THREE.Vector2(0, -1) },
  uRain:         { value: 0.0 },      // 降雨强度：雨点砸在叶片上也会让枝叶抖，与风无关
};
export const willowOrigins = [];             // 由柳树摆放处登记，作为风源候选

/* 风摆权重按模式分三种 —— 第一种是之前的 bug 所在：
   柳条几何是从 y=0 向下垂到 y=-1 的，若统一用 max(position.y,0) 加权，
   柳条与柳叶的权重恒为 0，风再大也不动。
   · base  ：以基部为支点，越高摆得越厉害（竹叶、水草）—— 读**局部**坐标 position.y，
             要求几何体自己就以 y=0 为根部（程序化生成的植被都是这样）
   · crown ：以树冠为支点，**越低**摆得越厉害（垂柳的枝条与叶片都是垂挂的）
   · tip   ：方向同 base（越高越摆），但锚在**世界坐标**的基准高度 crownY 上。
             给「局部坐标不以 0 为根」的资产用：GLB 叶片（芭蕉）的原点由 GLB 决定，
             局部 y 可能是任意区间，套 base 会得到乱权重；水生植物同理 ——
             它们的世界根部是水面 y=0，但睡莲叶盘中心在 0.075、荷花瓣在 0.5~1.1，
             用 crown 会让高处的花权重被 clamp 成 0（"荷花一动不动"，用户实测）。 */
export function addWind(mat, amp = 0.09, speed = 1.4, mode = 'base', crownY = 5.2, maxDisp = 0, flutter = 1){
  /* 每材质**私有**的风参数 uniform（2026-09-20 首帧优化）：
     旧版把 amp/speed/mode/maxDisp/flutter 烘成 GLSL 常量并写进 customProgramCacheKey，
     13 种植被被编译成 11+ 份几乎相同的 STANDARD 大 program（实测首帧 5.8s 的主因之一）。
     常量降为 uniform 后所有风材质共享**同一个 program**，差异只在 uniform 值。
     审计口径（原 key 里的 amp/speed/mode/…）挪到 userData.windParams，探针从那里读。 */
  mat.userData.windParams = { amp, speed, mode, crownY, maxDisp, flutter };
  mat.userData.windU = {
    uWAmp:    { value: amp },
    uWSpeed:  { value: speed },
    uWFlutter:{ value: flutter },
    uWMaxDisp:{ value: maxDisp },
    uWCrownY: { value: crownY },
    /* 0=base（根部固定）· 1=crown（垂挂，越低越摆）· 2=tip（锚世界高度，越高越摆） */
    uWMode:   { value: mode === 'crown' ? 1 : mode === 'tip' ? 2 : 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WIND, mat.userData.windU);
    mat.userData.shader = shader;
    shader.vertexShader = `
      uniform float uTime;
      uniform vec3  uWindOrigin;
      uniform float uWindRadius;
      uniform float uWindStrength;
      uniform float uWindGlobal;
      uniform float uWindPhase;
      uniform vec2  uWindVec;
      uniform float uRain;
      uniform float uWAmp;
      uniform float uWSpeed;
      uniform float uWFlutter;
      uniform float uWMaxDisp;
      uniform float uWCrownY;
      uniform float uWMode;
      /* 相位 hash：three r184 未内置 hash，自声明（与项目 snowHash 同型） */
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec3 wPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
       #else
         vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;
       #endif
       float wFall = max(0.0, 1.0 - distance(wPos, uWindOrigin) / uWindRadius);
       /* 天气底值风是**独立一项**，不能塞进 uWindStrength：底值风没有风源，
          一旦乘上 wFall（风源挂在柳树上，或退化成 (0,-999,0) 的哨兵）就被衰减成 0。
          实测暴风时 wFall 在池中/竹林/柳树三处**全是 0**，有效风 = 0 ——
          表现就是"狂风暴雨里一片叶子都不动"。只有阵风该按距离衰减。 */
       float gust  = uWindGlobal + uWindStrength * wFall * wFall;
       /* 相位去同步（第十六轮修复"轮胎旋转"，本轮再由 L3 彻底接管）：
          更早的公式 X 用 sin、Z 用 cos、共用同一个 ph —— 整树相位几乎一致，
          在 (x,z) 平面合成椭圆轨道，狂风里像轮胎在同步打转（用户实测）。
          现在用世界坐标的 hash 给**每片叶/条一个独立相位**，邻片不同步，
          保证每片叶的摆动**不同时**发生；
          至于"轨迹是圆是线"——已交给下面的风向坐标系合成负责，
          这里只管相位（谁什么时候摆），不管几何形状。
       ⚠️ 相位 hash 必须取 **per-instance 锚点**，不能取逐顶点 wPos：
          浅 V 杯形叶（makeLeafVolumeGeo）左右缘只相距 ~6cm，而 hash21
          在该尺度上剧烈振荡 → 同一片叶的左右缘相位差达弧度，V 杯被异步
          拍开合，狂风里读作"叶片变粗、成了阔叶"（2026-09-17 用户反馈）。
          锚点取 instanceMatrix 的平移列：整片叶共享一个相位，叶片整体
          摆动而不是展宽；非实例化网格（藤管/水草）回退逐顶点。 */
       #ifdef USE_INSTANCING
         vec3 wAnchor = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
       #else
         vec3 wAnchor = wPos;
       #endif
       float h1 = hash21(wAnchor.xz * 3.7);
       float hx = wAnchor.x * 0.42 + wAnchor.z * 0.19 + uWindPhase + h1 * 6.28;
       float hz = wAnchor.x * 0.15 + wAnchor.z * 0.36 + uWindPhase * 1.7 + h1 * 5.1;
       /* 摆幅权重：mode 改 uniform 运行时分流（旧版是三份 shader 变体） */
       float wCrownW = clamp((uWCrownY - wPos.y) / 2.5, 0.0, 1.6);
       float wTipW   = clamp((wPos.y - uWCrownY) / 2.5, 0.0, 1.6);
       float wBaseW  = clamp(position.y, 0.0, 1.6);
       float wt = uWMode > 1.5 ? wTipW : (uWMode > 0.5 ? wCrownW : wBaseW);
       float ampEff = uWAmp * wt * (0.16 + 2.8 * gust);
       /* ── 位移合成：在**风向坐标系**里做，再投影回世界 xz ──
          Wv = 风推的方向（全局，由 L1 按 16 档转向），Pv = 其水平法向。
          旧公式让 x 与 z 各自跑不同频率的正弦、再叠一层每株自己的慢变风向 aDir ——
          两者近频正交，合成轨迹是个**胖椭圆**，眼睛读作"绕圈"
          （用户实测："非常明显的规律性旋转运动及轨迹"）。
          现在沿风向是唯一的大分量（1.00），横向硬压到 0.16：轨迹从"面"压回"线"。
          aDir 一并删除 —— 全局风向已经由 L1 真实转向，每株再各自乱摆等于
          "每棵树头顶的天气都不一样"，那是噪声不是风。 */
       vec2 Wv = uWindVec;
       vec2 Pv = vec2(-Wv.y, Wv.x);
       float along = sin(uTime * uWSpeed + hx) * ampEff
                   * (0.86 + 0.14 * sin(uTime * 0.37 + h1 * 2.1));
       float cross = cos(uTime * (uWSpeed * 0.61) + hz) * ampEff * 0.16;
       /* 高频抖动：起风时"枝叶翻飞" + 下雨时"雨点砸在叶片上"。同样压进风向坐标系，
          横向抖幅只有沿向的 0.26 —— 旧版 6.3 / 7.1 rad/s 只差 13%，
          两个近频正交分量合成出**每秒一圈**的快速小圈，是"打转"最刺眼的那一层。
          flutter 是**刚度标度**：叶片 1.0，硬质假茎只需 0.3（茎不该像叶子一样扑腾）。 */
       float tremble = gust * 0.55 + uRain * 0.85;
       along += sin(uTime * 6.3 + hx * 2.3) * ampEff * tremble * uWFlutter;
       cross += cos(uTime * 4.1 + hz * 1.9) * ampEff * tremble * (uWFlutter * 0.26);
       vec2 wdv = Wv * along + Pv * cross;
       float dx = wdv.x, dz = wdv.y;
       /* 位移硬上限（米）：给水生/大叶植物用 —— "晃动只在池子里，不要穿模到岸边"。
          uWMaxDisp=0 表示不设上限；旧版是编译期分支，现在运行时判断（顶点着色器，零负担）。 */
       if (uWMaxDisp > 0.0){
         float dLen = sqrt(dx * dx + dz * dz);
         if (dLen > uWMaxDisp){ float kLim = uWMaxDisp / dLen; dx *= kLim; dz *= kLim; }
       }
       transformed.x += dx;
       transformed.z += dz;`
    );
  };
  /* program 缓存 key：风参数已全部降为 uniform，与具体数值无关 —— 所有风材质共用一份 program。
     'wind|v2' 前缀留给探针做"是否进风场"判定；amp/speed/mode 等审计口径读 userData.windParams。 */
  mat.customProgramCacheKey = () => 'wind|v2';
  return mat;
}
addWind(MAT.leaf,   0.13, 1.35, 'base');    // 竹叶
addWind(MAT.willow, 0.14, 0.95, 'crown');   // 柳条：0.30→0.24→0.14，狂风摆幅 ~0.2m 不再"摇呼啦圈"
addWind(MAT.willowLeaf, 0.07, 0.95, 'crown');   // 叶帘飘带：0.26→0.20→0.11→0.07（用户两轮"杂乱/摇呼啦圈"）
addWind(MAT.wisteria, 0.05, 1.15, 'crown', 3.2);  // 花穗轻摆：0.08→0.05（用户"非常杂乱"）
addWind(MAT.wisteriaLeaf, 0.045, 1.05, 'crown', 3.2);  // 羽状复叶卡：0.07→0.045，与花穗同频但更轻
addWind(MAT.peachLeaf, 0.05, 1.0, 'crown');            // 桃叶冠轻摆（同柳叶的 crown 支点）
addWind(MAT.reed,   0.15, 1.10, 'base');    // 水草
/* ⚠️ 荷叶 / 荷花 / 芭蕉 此前不在风场表里 —— 狂风暴雨里柳枝疯摆而池面/芭蕉纹丝不动，
   同框对比出戏（用户反馈）。
   ⚠️ 睡莲/荷叶/荷花**改用 tip 模式**（2026-09-17 用户："荷花和荷叶为啥不会随风晃动"）：
   原来给 lily 挂 crownY=0.6、lotus 挂 crownY=0.8，而荷花瓣在 y=0.48~1.08 ——
   crown 权重是 (crownY - y)/2.5，y 一旦高过 crownY 就被 clamp 成 0：
   **越高的花越是一动不动**，正好和真实相反。实测花瓣 y=1.08 处权重恒为 0，
   荷叶 0.075 处仅 0.21，狂风里整池死水。
   现在锚在水面（crownY=0，即 CFG.water）：叶盘 0.075→权重 0.03（贴水几乎不动）、
   荷花瓣 0.48→0.19、1.08→0.43，杆顶 1.14→0.46。
   幅度反算（ampEff = amp × wt × (0.16 + 2.8 × gust)，storm gust≈0.75 → 乘数 2.26）：
   荷叶 0.03×0.03×2.26≈0.002m（静止感）、荷花瓣 0.05×0.43×2.26≈0.049m（5cm 轻摆）、
   杆顶同量级 —— 全部远小于池心到岸石的距离，**不会甩到岸上草皮/石头里**。 */
addWind(MAT.lily,  0.030, 1.15, 'tip', 0.0, 0.05);   // 睡莲浮叶/荷杆/莲蓬茎：贴水轻漾，位移硬顶 5cm
addWind(MAT.lotus, 0.050, 1.25, 'tip', 0.0, 0.05);   // 荷花瓣/花蕾：越高越摆，位移硬顶 5cm
/* 芭蕉（2026-09-17 用户："芭蕉树应该是叶子晃动，现在的晃动有问题"）：
   病根是**动错了对象、且权重反了** —— MAT.banana 只挂在假茎上、且用 crown 模式，
   权重 (3.6 - y)/2.5 在假茎根部 y=0 时 = 1.44（最大）、顶端 y=2.8 时只有 0.32：
   假茎从**土里**开始像钟摆一样甩，而真正的叶子（GLB 资产）材质不在风场表里、
   压根没动过。现在拆开：假茎是硬质草茎，只留 base 模式的极小幅度（顶端 ~7cm 微弯、
   根部权重 0 钉死在地），叶片的摆动在 makeBananaPlant 里给 GLB 材质单独注入。 */
/* flutter 0.30：假茎是硬质草茎，沿风向弯可以，像叶片一样高频扑腾就假了。
   第 7 参就是刚度标度，见 addWind 里 tremble 那两行。 */
addWind(MAT.banana, 0.025, 0.95, 'base', 5.2, 0, 0.30);  // 假茎：根部固定、顶端微弯，不再整根钟摆
/* 01-materials 模块体到此结束：上面的刻度把「贴图 → MAT/风场表」切开，
   下面 index.html 那一段（drawer/相机/渲染器/天空 PMREM）由 '渲染器' 与本节刻度夹住。 */
bootMark('材质库·风场表');
