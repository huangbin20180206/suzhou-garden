// 01b-textures: 程序化贴图生成器（2026-10-07 从 01-materials.js 整块搬出，纯搬运、逐字未改）
//   —— 从 makeRoofTileTex 到 makePlumPetalTex，共 23 个导出函数。
// 为什么单独成文件：这部分是"画布上画图"的纯函数（只依赖 document + THREE + 00-config 的随机流），
// 与"材质库/季节显隐/天气角色登记"是两件事；搬出去后 01-materials 只留库与接线，读起来只剩一张表。
// ⚠️ 块内引用了 rr/rnd/mulberry32/TAU/CFG ⇒ **这些导入必须跟着搬**（共用同一条随机流，
//    少一个都会改变抽样位置 ⇒ 全园布局漂移）；01-materials 仍按原名转出（先 import 再 export），
//    所以外部模块继续从 './01-materials.js' 取这些函数，一行都不用改。
import { THREE } from '../vendor.js';
import { CFG, rnd, rr, mulberry32, TAU, registry, BOOT, bootMark } from './00-config.js';

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
  const S = 1024;
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
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  const P = 1024;
  g.fillStyle = '#6E9C42'; g.fillRect(0,0,P,P);

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
      g.ellipse(rnd()*P, rnd()*P, rr(rMin, rMax), rr(rMin, rMax)*rr(0.5,1.0), rnd()*Math.PI, 0, Math.PI*2);
      g.fill();
    }
  }

  // ② 中尺度草簇
  for (let i = 0; i < 900; i++){
    const v = rr(-24, 26);
    g.fillStyle = `rgba(${96+v|0},${138+v|0},${54+v|0},0.5)`;
    g.beginPath();
    g.arc(rnd()*P, rnd()*P, rr(2, 7), 0, Math.PI*2);
    g.fill();
  }

  // ③ 细叶（保留原有竖向笔触）
  for (let i = 0; i < 14000; i++){
    const v = rr(-30, 26);
    g.fillStyle = `rgba(${100+v|0},${146+v|0},${56+v|0},.5)`;
    g.fillRect(rnd()*P, rnd()*P, rr(1,2.4), rr(2,6));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* ══ 水禽的常驻尾涡圈贴图（2026-10-04）══════════════════════════════════════
   鸭子划水时在水面顶出的一圈**常驻**波纹（不扩散、不进涟漪池 —— 理由见 07-ground
   makeDuckGeo 头注释：水面涟漪事件额度是用户拍板过的 ≈30 次/分，水禽不再加一条链）。
   ⚠️ **确定性**：整张图不抽任何随机数 —— 本模块的 makeGroundTex 等走的是**全局流**
   rnd()/rr()，这里若也抽流，等于把它之后所有消费者的抽样整体前移（铁律 1）。 */
export function makeDuckWakeTex(){
  const S = 256, mid = S / 2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  /* 一组同心细环叠出"水被顶起来"的柔和感：越靠外越淡、最外缘收干净 ——
     出现一根硬边圈会读成"贴在鸭子身上的贴纸"。 */
  for (let i = 0; i < 26; i++){
    const r = mid * (0.40 + i * 0.023);
    const a = 0.20 * (1 - i / 26) * (i < 3 ? 0.35 : 1);
    g.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    g.lineWidth = S * 0.010 + i * 0.05;
    g.beginPath(); g.arc(mid, mid, r, 0, Math.PI * 2); g.stroke();
  }
  /* 鸭身周围那一圈稍亮的水线（水被身体抓开的地方） */
  g.strokeStyle = 'rgba(255,255,255,0.30)';
  g.lineWidth = S * 0.022;
  g.beginPath(); g.arc(mid, mid, mid * 0.36, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makePondBedTex(){                       // 池底：淤泥 + 藻斑 + 卵石
  const S = 1024;
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

export function makeInkWashTex(R){                       // 水墨山水（屏风背景）
  /* ⚠️ 可选随机源 R（返回 [0,1) 的函数，如 mulberry32 实例）：传了就用它，
     **一个全局随机数都不抽**。14-props 的卷轴画心必须走这条 —— 它是在**模块级**
     调用的，哪怕只多抽一次 rr()，其后所有抽样（含延迟批的柳/竹/立峰/桃）都会
     整体前移 ⇒ 全园布局漂且不报错（layout-fingerprint 报"新增 41 / 消失 42"）。
     不传则沿用全局 rr() ⇒ 04-buildings 的屏风背景逐位不变。 */
  const rrT = R ? ((a, b) => a + R() * (b - a)) : rr;
  const W = 1024, H = 768;
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
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + rrT(-16, 16), by - rrT(8, 22)); g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#A8352A'; g.fillRect(W - 76, H - 76, 44, 44);   // 印章
  g.fillStyle = '#EDE6D6'; g.font = 'bold 24px "KaiTi","SimSun",serif'; g.textAlign = 'center';
  g.fillText('園', W - 54, H - 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function makeGoBoardTex(){                        // 围棋盘面：19 路棋路 + 九星
  /* ⚠️ 本函数**不碰全局 rnd()/rr()** —— 木纹的随机性走自带的局部 LCG。
     上面那些模块级贴图工厂都会消耗全局随机流，而"全局随机流守恒"是红线：
     在 14-props 的模块级新增哪怕一次 rr() 调用，其后所有抽样整体前移、
     全园布局漂且不报错。木纹用局部流就够，没必要动全局。 */
  const W = 512, H = 490;                                // ≈ 45.4 : 42.4（真实棋盘的纵横比）
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let s = 20261005 >>> 0;                                // 局部 LCG（Numerical Recipes）
  const lr = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const r2 = (a, b) => a + lr() * (b - a);
  g.fillStyle = '#D8B072'; g.fillRect(0, 0, W, H);       // 楸木本色：比桌面石材暖、比 MAT.wood 亮
  g.globalAlpha = 0.16;                                  // 木纹：几十道纵向深浅纹
  for (let i = 0; i < 90; i++){
    g.strokeStyle = lr() < 0.5 ? '#A9782F' : '#EFD3A2';
    g.lineWidth = r2(1, 4.5);
    const x = lr() * W;
    g.beginPath(); g.moveTo(x, 0);
    g.bezierCurveTo(x + r2(-14, 14), H * 0.33, x + r2(-14, 14), H * 0.66, x + r2(-10, 10), H);
    g.stroke();
  }
  g.globalAlpha = 1;
  /* 19 路：边框各留 1/22 边距 ⇒ 18 道间隔等分内区（真实棋盘就是等距） */
  const px = W / 22, st = (W - px * 2) / 18;
  const py = H / 22, sy = (H - py * 2) / 18;
  g.strokeStyle = '#2A1A0C'; g.lineWidth = 2.2; g.lineCap = 'round';
  for (let i = 0; i < 19; i++){
    const x = px + i * st;
    g.beginPath(); g.moveTo(x, py); g.lineTo(x, H - py); g.stroke();
    const y = py + i * sy;
    g.beginPath(); g.moveTo(px, y); g.lineTo(W - px, y); g.stroke();
  }
  g.fillStyle = '#2A1A0C';                               // 九星（四角 4-4 / 四边中星 / 天元）
  for (const [ix, iy] of [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]]){
    g.beginPath(); g.arc(px + ix * st, py + iy * sy, 3.6, 0, TAU); g.fill();
  }
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

/* ⚠️⚠️ 梅的瓣贴图（2026-10-06 二轮 · 老黄："梅花颜色也不对"）：**必须是白/灰底**。
   真因不在材质底色，而在**这张贴图是粉的**（上面桃瓣：底 250,205,216 + 内 238,150,178）——
   粉贴图 × 黄色实例色 = **橙锈色**，所以腊梅怎么调都读作锈红、红梅也发闷。
   （我第一版只把材质底色改白，没用：色污染在贴图里。）
   形状与桃瓣**逐字同参**（同一朵花的轮廓，只是不着色），灰度只表达瓣根到瓣心的明度层次，
   色相完全交给实例色（blossomA→blossomB）。 */
let _plumPetalTex = null;
export function makePlumPetalTex(){
  if (_plumPetalTex) return _plumPetalTex;
  const S = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  const cx = S / 2;
  /* 花瓣形状（2026-10-07 改）：**外缘宽而圆、基部收窄** —— 真实梅瓣就长这样。
     旧版画的是两头尖的柳叶形（上下都是尖点、最宽在正中），近看五片尖瓣呈放射条状；
     多模态对贴脸图的判读是"花瓣细长、带尖、呈放射条状…像花瓣＋叶片混贴的剪影，不像梅花"。
     ⚠️ 方向别搞反：canvas 的 y **小端（上）= 花瓣外缘**、y 大端（下）= 花心侧
        —— three 的 flipY 默认为真（贴图上下与 plane 一致），而 plane 的底边被
        translate 到了花心（见 06-vegetation 的 makePlumFlowerGeo）。 */
  const drawPetal = (scale, col, yOff = 0) => {
    const yOut = 5 * scale, yIn = (S - 6) * scale;   // 外缘端 / 基部端
    const wIn = 11 * scale, wOut = 22 * scale;       // 基部半宽 / 最宽处半宽
    const dy = yIn - yOut;
    c.beginPath();
    c.moveTo(cx - wIn, yIn + yOff);
    /* 左缘：基部外扩 → 最宽处落在偏外（约 0.4 处）→ 收成圆弧外缘（控制点贴近 yOut 保证不是尖角） */
    c.bezierCurveTo(cx - wOut * 0.98, yIn - dy * 0.55, cx - wOut, yOut + dy * 0.10, cx, yOut + yOff);
    c.bezierCurveTo(cx + wOut, yOut + dy * 0.10, cx + wOut * 0.98, yIn - dy * 0.55, cx + wIn, yIn + yOff);
    c.closePath();
    c.fillStyle = col; c.fill();
  };
  drawPetal(1, 'rgba(246,246,246,1)');            // 底：近白
  drawPetal(0.82, 'rgba(214,214,214,0.9)', 2);    // 内：浅灰（只做明度层次，不带色相）
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _plumPetalTex = tex;
  return tex;
}

/* ══ 梅树皮 bump 贴图（2026-10-09 · 老黄："主干和主枝条太过光滑像不锈钢一样光滑还带着
      光泽感，没有树干该有的纹理和树疤（结）"）════════════════════════════════════
   参考图（老黄给的蜡梅/梅实拍）：深褐近黑、带冷灰调；**细枝相对光滑但有细纵向皮纹**，
   分枝节点颜色更深、花簇着生处略膨大有环状芽鳞痕（= 树疤/结）。
   ⇒ 生成一张**竖向沟纹 + 椭圆树疤**的灰度 bump（亮=凸、暗=凹）：
     · 纵纹：竖向窄条带（宽度不均、略带倾斜），模拟纵向皮裂；
     · 树疤：随机散布的小椭圆深色环（外亮内暗），模拟节疤/芽鳞痕；
     · 噪声底：低频明暗让整体不发闷。
   ⚠️ 纹理 wrap 设 RepeatWrapping + repeat 高值（主干细长，UV 是 TubeGeometry 的
      u=环向/v=轴向，v 0→1 走整条干——repeat.y 高一些让纹路密）。 */
let _plumBarkTex = null;
export function makePlumBarkTex(){
  if (_plumBarkTex) return _plumBarkTex;
  const S = 128;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const c = cv.getContext('2d');
  /* 底改**近白**（2026-10-09 二轮）：这张贴图同时做 map 与 bumpMap——
     map 走"材质色 × 贴图"，底色偏灰会把干/枝整体压暗一档；近白底让 color(0x4A423C)
     主导色相、贴图只出明暗变化。 */
  c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, S, S);
  // 低频噪声底
  for (let i = 0; i < 300; i++){
    const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 6;
    c.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 120},${Math.random() > 0.5 ? 255 : 120},${Math.random() > 0.5 ? 255 : 120},0.07)`;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  // 纵向皮纹：竖向窄条带（宽度不均、略倾斜），模拟纵向皮裂 —— 加深加重（bump 也靠它）
  for (let i = 0; i < 30; i++){
    const x0 = Math.random() * S;
    const w = 1.5 + Math.random() * 4;
    const tilt = (Math.random() - 0.5) * 14;
    const shade = Math.random() > 0.45;
    c.strokeStyle = shade ? 'rgba(40,40,40,0.75)' : 'rgba(255,255,255,0.55)';
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x0, -4);
    c.quadraticCurveTo(x0 + tilt * 0.5, S * 0.5, x0 + tilt, S + 4);
    c.stroke();
  }
  // 树疤/芽鳞痕：随机散布的小椭圆环（外亮环+内暗心）—— 加大加深让 2m 外读得出
  for (let i = 0; i < 9; i++){
    const x = 10 + Math.random() * (S - 20), y = 10 + Math.random() * (S - 20);
    const rx = 4 + Math.random() * 6, ry = rx * (0.65 + Math.random() * 0.3);
    c.fillStyle = 'rgba(35,35,35,0.85)';
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(x, y, rx + 2, ry + 2, 0, 0, Math.PI * 2); c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  /* repeat：主干 UV 是 u=环向/v=轴向、各段 0→1 —— repeat(2,3) 让 3m 干上竖纹密到
     "细纵向皮纹"的密度（repeat 1 的话整条干只有一圈纹，拉成宽条 = 假）。 */
  tex.repeat.set(2, 3);
  tex.colorSpace = THREE.NoColorSpace;          // bump 走线性；map 也只出明度（色相交给 color）
  _plumBarkTex = tex;
  return tex;
}

