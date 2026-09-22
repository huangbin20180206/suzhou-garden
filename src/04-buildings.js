// 04-buildings: from index.html inline 491..936
import { THREE } from '../vendor.js';
import { makeWisteria } from './06-vegetation.js';
import { mesh, box, makeQueTu, makeGuaLuo, makeLatticePanel, makeChangChuang, makeJiangnanWindow, makeChineseRoof, makeCeiling, instancedBoxes, DOUGONG_H, instancedGeo, makeDougongGeo, makeColumn, makeCorrugatedSlab } from './03-factory.js';
import { MAT, makeInkWashTex, makePlaqueTex } from './01-materials.js';
import { bootMark } from './00-config.js';
import { POND_PTS, insidePond, POND_RADII, makePond, makeBankRocks, makeArchBridge, makeSteppingStones } from './05-water.js';
/* ══════════════════════════════════════════════════════════════
   4 · 建筑：远香堂 / 水榭 / 游廊
   ══════════════════════════════════════════════════════════════ */

/* 远香堂：面阔五开间、单檐歇山顶 */
export function makeYuanxiangHall(){
  const g = new THREE.Group();
  const W = 20, D = 8, H = 7;          // 面阔 / 进深 / 通高
  const bays = 5;

  /* ① 两级青石台基 */
  const p1 = mesh(box(W + 4.4, 0.62, D + 4.4), MAT.stone, { name:'terraceLower' });
  p1.position.y = 0.31; g.add(p1);
  const p2 = mesh(box(W + 3.0, 0.62, D + 3.0), MAT.stone, { name:'terraceUpper' });
  p2.position.y = 0.93; g.add(p2);
  // 台基压边
  const edge = mesh(box(W + 4.6, 0.1, D + 4.6), MAT.stoneDark);
  edge.position.y = 0.62; g.add(edge);

  /* ② 踏跺（南侧两级） */
  for (let i = 0; i < 2; i++){
    const st = mesh(box(4.6, 0.31, 0.62), MAT.stone, { name:'step' });
    st.position.set(0, 0.155 + i*0.31, (D + 4.4)/2 + 0.31 - i*0.62);
    g.add(st);
  }

  /* ③ 柱网：檐柱 6 根（五开间）+ 金柱 */
  const colH = H - 2.35;
  const zFront = D/2 - 0.3, zBack = -D/2 + 0.3;
  const xs = [];
  for (let i = 0; i <= bays; i++) xs.push(-W/2 + (W/bays)*i);
  const colGeo = new THREE.CylinderGeometry(0.22, 0.26, colH, 10);
  const frontCols = [], backCols = [];
  xs.forEach(x=>{ frontCols.push({x, y:0, z:zFront}); backCols.push({x, y:0, z:zBack}); });
  const allCols = [...frontCols, ...backCols];
  // 金柱（内圈）
  [-W/2 + W/bays, W/2 - W/bays].forEach(x=>{
    allCols.push({x, y:0, z: zFront - D*0.34});
    allCols.push({x, y:0, z: zBack + D*0.34});
  });
  const colInst = new THREE.InstancedMesh(colGeo, MAT.wood, allCols.length);
  colInst.castShadow = colInst.receiveShadow = true;
  const cm = new THREE.Matrix4(), cp = new THREE.Vector3(), cq = new THREE.Quaternion(), cs = new THREE.Vector3(1,1,1);
  allCols.forEach((c, i)=>{ cp.set(c.x, 1.24 + colH/2, c.z); cm.compose(cp, cq, cs); colInst.setMatrixAt(i, cm); });
  colInst.instanceMatrix.needsUpdate = true;
  g.add(colInst);
  // 柱础
  const baseGeo = new THREE.CylinderGeometry(0.36, 0.4, 0.22, 10);
  const baseInst = new THREE.InstancedMesh(baseGeo, MAT.stoneDark, allCols.length);
  baseInst.receiveShadow = true;
  allCols.forEach((c, i)=>{ cp.set(c.x, 1.24 + 0.11, c.z); cm.compose(cp, cq, cs); baseInst.setMatrixAt(i, cm); });
  baseInst.instanceMatrix.needsUpdate = true;
  g.add(baseInst);

  /* ④ 额枋（横向联系） */
  const beamY = 1.24 + colH;
  [zFront, zBack].forEach(z=>{
    const b = mesh(box(W + 0.6, 0.5, 0.32), MAT.woodRed, { name:'architrave' });
    b.position.set(0, beamY + 0.25, z); g.add(b);
  });
  // 端额枋：外侧面收在柱列线上（原来放在 ±(W/2+0.3)，外侧面到 ±10.46，
  // 在墙外露出一截无支撑的梁头）
  [-W/2 + 0.16, W/2 - 0.16].forEach(x=>{
    const b = mesh(box(0.32, 0.5, D + 0.6), MAT.woodRed);
    b.position.set(x, beamY + 0.25, 0); g.add(b);
  });

  /* ④b 雀替 + 挂落（小木作，紧贴额枋下缘）
     雀替是"梁柱交角"最直观的标志：每根檐柱两侧各一片，托在额枋下面。
     挂落挂在额枋前侧，是檐下的一道水平花边 —— 远看只是一条线，近看全是细节。 */
  {
    const fi = 1.45;                                   // 雀替高（从额枋下缘往下）
    // 檐柱列：与 xs 一致（五开间六柱）
    xs.forEach(x=>{
      { const q = makeQueTu(0.78, fi, MAT.woodRed);
        q.position.set(x - 0.39, beamY + 0.5 - fi, zFront + 0.30); g.add(q); }
      { const q = makeQueTu(0.78, fi, MAT.woodRed);
        q.scale.x = -1;
        q.position.set(x + 0.39, beamY + 0.5 - fi, zFront + 0.30); g.add(q); }
    });
    const gl = makeGuaLuo(W + 0.5, { depth: 0.34, step: 0.62 });
    gl.position.set(0, beamY + 0.5 - 0.20, zFront + 0.30);
    g.add(gl);
  }

  /* ⑤ 前檐：实心墙 + 中央大门（两扇敞开）+ 两侧长窗 */
  const panelH = colH - 0.35;
  const doorW = 3.8, doorH = 3.5;
  // 前墙（带门洞）
  const fw = new THREE.Shape();
  fw.moveTo(-W/2, 0); fw.lineTo(W/2, 0); fw.lineTo(W/2, colH); fw.lineTo(-W/2, colH); fw.closePath();
  const dh = new THREE.Path();
  dh.moveTo(-doorW/2, 0); dh.lineTo(doorW/2, 0); dh.lineTo(doorW/2, doorH); dh.lineTo(-doorW/2, doorH); dh.closePath();
  fw.holes.push(dh);
  const frontWall = mesh(new THREE.ExtrudeGeometry(fw, { depth: 0.3, bevelEnabled: false }), MAT.wall, { name:'frontWall' });
  frontWall.position.set(0, 1.24, zFront - 0.15);
  g.add(frontWall);
  // 门槛石
  const sill = mesh(box(doorW + 0.6, 0.24, 0.56), MAT.stoneDark, { name:'doorSill' });
  sill.position.set(0, 1.24 + 0.12, zFront);
  g.add(sill);
  // 门框
  [-1, 1].forEach(sx=>{
    const jamb = mesh(box(0.22, doorH, 0.36), MAT.woodRed, { name:'doorJamb' });
    jamb.position.set(sx * (doorW/2 + 0.11), 1.24 + doorH/2, zFront);
    g.add(jamb);
  });
  const lintel = mesh(box(doorW + 0.46, 0.3, 0.36), MAT.woodRed, { name:'doorLintel' });
  lintel.position.set(0, 1.24 + doorH + 0.15, zFront);
  g.add(lintel);
  // 两扇门向内敞开
  [-1, 1].forEach(sx=>{
    const pivot = new THREE.Group();
    pivot.position.set(sx * (doorW/2 - 0.03), 1.24 + 0.12, zFront - 0.08);
    const leaf = makeLatticePanel(doorW/2 - 0.06, doorH - 0.24, 2, 5);
    leaf.position.set(-sx * (doorW/4), (doorH - 0.24)/2, 0);
    pivot.add(leaf);
    pivot.rotation.y = -sx * 1.18;          // 向室内敞开
    g.add(pivot);
  });
  // 前墙半窗（每侧两扇，下有槛墙）
  [-1, 1].forEach(sx=>{
    [4.1, 7.9].forEach((px)=>{   // 柱心之间（檐柱约在 ±2.2 / ±6 / ±9.8），长窗填满开间
      /* 正面：**落地长窗**（一间一樘，填满柱间、从台基直达额枋）。
         ⚠️ 原来是 4 樘半窗（窗顶 4.49、下面砌槛墙）—— 那是山墙/次间的做法，不是四面厅的形制。 */
      const win = makeChangChuang(3.45, 3.20, 5, 4);
      win.position.set(sx * px, 1.24 + 0.06 + 1.60, zFront + 0.34);
      g.add(win);
    });
  });
  // 室内屏风（正对大门，裱水墨山水）
  const screen = mesh(box(2.9, 2.6, 0.14), MAT.woodRed, { name:'screen' });
  screen.position.set(0, 1.24 + 1.52, zBack + 1.7);
  g.add(screen);
  const inkMat = new THREE.MeshStandardMaterial({ map: makeInkWashTex(), roughness:0.88, metalness:0.0 });
  const screenPanel = mesh(new THREE.PlaneGeometry(2.5, 1.9), inkMat, { name:'screenPanel' });
  screenPanel.position.set(0, 1.24 + 1.78, zBack + 1.78);   // 抬高，避开案几遮挡
  g.add(screenPanel);
  // 室内陈设：主位（条案 + 左右各一太师椅，面向大门）+ 陪位（两侧各二，相向而坐）
  const furnY = 1.24;
  const altar = mesh(box(2.4, 0.12, 0.52), MAT.woodRed, { name:'altarTable' });   // 条案
  altar.position.set(0, furnY + 0.94, zBack + 2.35);
  g.add(altar);
  [-1.0, 1.0].forEach(sx=>{
    const leg = mesh(box(0.1, 0.92, 0.1), MAT.woodDark, { name:'tableLeg' });
    leg.position.set(sx, furnY + 0.46, zBack + 2.35);
    g.add(leg);
  });
  const makeChair = (x, z, ry)=>{
    const ch = new THREE.Group();
    const seat = mesh(box(0.64, 0.09, 0.58), MAT.woodRed, { name:'chairSeat' });
    seat.position.y = 0.47; ch.add(seat);
    const back = mesh(box(0.64, 0.66, 0.08), MAT.woodRed, { name:'chairBack' });
    back.position.set(0, 0.83, -0.25); ch.add(back);
    [-0.27, 0.27].forEach(lx=>{
      [0.23, -0.23].forEach(lz=>{
        const lg = mesh(box(0.08, 0.47, 0.08), MAT.woodDark, { name:'chairLeg' });
        lg.position.set(lx, 0.235, lz); ch.add(lg);
      });
    });
    // 扶手
    [-0.29, 0.29].forEach(lx=>{
      const arm = mesh(box(0.06, 0.06, 0.5), MAT.woodRed, { name:'chairArm' });
      arm.position.set(lx, 0.72, -0.02); ch.add(arm);
    });
    ch.position.set(x, furnY, z);
    ch.rotation.y = ry;
    return ch;
  };
  // 主位：条案前左右各一，面向大门（+Z）
  g.add(makeChair(-1.35, zBack + 2.9, 0));
  g.add(makeChair( 1.35, zBack + 2.9, 0));
  // 陪位：两侧各二，侧对大门、相向而坐
  [-1, 1].forEach(sx=>{
    [1.6, 3.2].forEach(dz=>{
      g.add(makeChair(sx * 6.8, zBack + dz, -sx * Math.PI / 2));
    });
  });
  // 后檐墙（白粉墙）
  const backWall = mesh(box(W + 0.6, colH - 0.2, 0.28), MAT.wall, { name:'backWall' });
  backWall.position.set(0, 1.24 + (colH - 0.2)/2, zBack - 0.28);
  g.add(backWall);
  // 两侧山墙（实心白粉墙）+ 各开一扇长窗
  [-1, 1].forEach(sgn=>{
    const sw = mesh(box(0.3, colH - 0.2, D + 0.4), MAT.wall, { name:'sideWall' });
    sw.position.set(sgn*(W/2 + 0.02), 1.24 + (colH - 0.2)/2, 0);
    g.add(sw);
    // 山墙半窗（每侧两扇，下有槛墙）
    [-2.0, 2.0].forEach((off, oi)=>{
      const win = makeJiangnanWindow(1.9, 2.2, oi === 0 ? 'ice' : 'bujunjin');
      win.position.set(sgn * (W/2 + 0.34), 1.24 + 1.05 + 1.1, off);
      win.rotation.y = sgn * Math.PI/2;
      g.add(win);
    });
  });

  /* ⑥ 屋顶：单檐歇山顶 */
  const roofH = 3.0;
  const roof = makeChineseRoof({
    w: W + 4.6, d: D + 4.6, hRidge: roofH, ridgeLen: W, lift: 1.15,
    /* ⚠️ ridgeLen 原来取 W−6：正脊只占面阔的 70%，收山宽 5.3m（≈0.84·D），
       于是两端坡比主坡缓得多（0.28 vs 0.48），不像歇山。
       让端坡与主坡同陡的收山宽 = 山花底高 / 主坡在山花处的坡度
       = (0.397·hRidge) / (3.31/D) ≈ 2.3m ⇒ 正脊半长 ≈ 面阔/2 —— 正是"正脊长≈面阔"的传统比例。 */
  });
  roof.position.y = 1.24 + colH + 0.5;
  g.add(roof);
  // 天花（望板）：封住屋顶下缘，消除透视穿视
  const hallCeil = makeCeiling(W + 0.4, D + 0.4, 1.24 + colH + 0.44);
  g.add(hallCeil);

  /* ⑦ 挑檐椽头：沿用原始的方块形制与高度。
     只有两处与原始不同 —— 长度从 2.3 收到 1.3：
     椽中心在 z=±(D+3.4)/2，而屋面边缘在 ±(D+4.6)/2，两者只差 0.6；
     2.3 长的椽外端会挑出檐口 0.55，在四角翼角起翘处看着像凭空伸出的横梁。
     收到 1.3 后外端正好压在檐口上，只露一个椽头。 */
  const zEave  = (D + 3.4) / 2;
  const nR = 34;
  const roofBaseY = 1.24 + colH + 0.5;
  const hAt = roof.userData.heightAt;        // 屋面高度场
  const rafters = [];
  for (let i = 0; i < nR; i++){
    const x = -W/2 - 1.9 + ((W + 3.8)/nR) * i;
    [1, -1].forEach(sgn=>{
      const z = sgn * zEave;
      // 逐根按该处屋面高度定位：椽随翼角上翘，而不是钉死在同一个高度。
      // 这也正是真实翼角椽的做法（椽头沿檐口曲线逐根抬起）。
      rafters.push({ x, y: roofBaseY + hAt(x, z) - 0.22, z });
    });
  }
  const rAfter = instancedBoxes(rafters, MAT.woodDark, [0.18, 0.18, 1.3]);
  if (rAfter) g.add(rAfter);
  /* 檐檩：压在檐椽下的横梁。
     ⚠️ 不能做成一根通长直料 —— 屋面沿面宽是**翘曲**的：
     檐口线处 x=0 屋面在 6.46，x=±10 处已升到 7.15。直料两端必然脱离屋面约 0.8 米，
     看上去就是一根凭空悬着的主梁（缩短长度也救不了，因为它还是不跟曲线）。
     所以按 21 段逐段贴合屋面，段间高差不到 0.04，视觉上仍是一条连续的檩。 */
  const NP = 21;
  const purlinSegs = [];
  for (let i = 0; i < NP; i++){
    const x = -W/2 + (W/(NP-1)) * i;
    [1, -1].forEach(sgn=>{
      const z = sgn * zEave;
      purlinSegs.push({ x, y: roofBaseY + hAt(x, z) - 0.38, z });
    });
  }
  const purlinInst = instancedBoxes(purlinSegs, MAT.woodRed, [W/(NP-1) + 0.05, 0.3, 0.3]);
  if (purlinInst) g.add(purlinInst);
  // 檐下斗拱：每攒按自己的净空纵向拉伸 —— 底坐在额枋顶面，顶顶住屋面下缘。
  // 屋面在墙线处可以比额枋高出 0.7~1.1 米（越靠端间越高），
  // 固定高度的斗拱必然吊在中间；拉伸后它就成了名副其实的「额枋→屋面」连接件。
  const beamTop = beamY + 0.5;                 // 额枋顶面
  // 斗拱在水平面占 1.02×1.02（横拱/纵拱），而屋面是个斜面 —— 越靠近檐口越低。
  // 必须取「斗拱所跨范围内屋面最低的那一点」来定高，否则靠檐口一侧会穿出瓦面。
  const DG_HX = 0.52, DG_HZ = 0.52;
  const dg = [];
  for (let i = 0; i <= bays*2; i++){
    const x = -W/2 + (W/(bays*2))*i;
    [[zFront, 0], [zBack, Math.PI]].forEach(([z, ry])=>{
      let minH = Infinity;
      for (const sx of [x - DG_HX, x, x + DG_HX])
        for (const sz of [z - DG_HZ, z, z + DG_HZ])
          minH = Math.min(minH, hAt(sx, sz));
      const clearance = roofBaseY + minH - 0.05 - beamTop;
      dg.push({ x, y: beamTop, z, ry, sy: Math.max(1, clearance / DOUGONG_H) });
    });
  }
  const dgInst = instancedGeo(makeDougongGeo(), dg, MAT.woodRed);
  if (dgInst) g.add(dgInst);

  /* ⑧ 匾额「远香堂」+ 对联 */
  const plaqueW = 4.6, plaqueH = 1.35;
  const plaqueTex = makePlaqueTex('远香堂');
  const plaque = mesh(new THREE.PlaneGeometry(plaqueW, plaqueH),
    new THREE.MeshStandardMaterial({ map:plaqueTex, roughness:0.55, metalness:0.1, envMapIntensity:0.6 }),
    { name:'plaque' });
  plaque.position.set(0, beamY - 0.05, zFront + 0.19);
  g.add(plaque);
  // 对联（前檐金柱，左右各一）
  const coupletTex = makePlaqueTex('碧水涵明月清风自在', true);
  const coupletMat = new THREE.MeshStandardMaterial({ map:coupletTex, roughness:0.55, metalness:0.1 });
  [-1, 1].forEach(sgn=>{
    const c = mesh(new THREE.PlaneGeometry(0.72, 2.9), coupletMat, { name:'couplet' });
    c.position.set(sgn*(W/bays)*0.5, 1.24 + colH*0.52, zFront + 0.17);
    g.add(c);
  });

  return g;
}

/* 荷风四面亭：临水四角卷棚歇山顶水榭 */
export function makeWaterPavilion(){
  const g = new THREE.Group();
  const W = 8, D = 7, colH = 3.5;

  /* 台基：前缘悬挑切入水面 */
  const base = mesh(box(W + 2.2, 0.9, D + 2.2), MAT.stone, { name:'pavilionBase' });
  base.position.set(0, 0.45 - 0.35, 0);
  g.add(base);
  const edge = mesh(box(W + 2.4, 0.12, D + 2.4), MAT.stoneDark);
  edge.position.set(0, 0.56, 0); g.add(edge);

  /* 四角柱 */
  const corners = [[-1,-1],[1,-1],[1,1],[-1,1]];
  corners.forEach(([sx, sz])=>{
    const c = makeColumn(colH, 0.22);
    c.position.set(sx*(W/2 - 0.35), 0.55 + colH/2, sz*(D/2 - 0.35));
    g.add(c);
    const cb = mesh(new THREE.CylinderGeometry(0.34,0.38,0.2,10), MAT.stoneDark);
    cb.position.set(sx*(W/2 - 0.35), 0.65, sz*(D/2 - 0.35));
    g.add(cb);
  });

  /* 额枋 */
  [1, -1].forEach(sz=>{
    const b = mesh(box(W - 0.2, 0.42, 0.26), MAT.woodRed);
    b.position.set(0, 0.55 + colH + 0.2, sz*(D/2 - 0.35)); g.add(b);
  });
  [1, -1].forEach(sx=>{
    const b = mesh(box(0.26, 0.42, D - 0.2), MAT.woodRed);
    b.position.set(sx*(W/2 - 0.35), 0.55 + colH + 0.2, 0); g.add(b);
  });

  /* 三面格窗（含不透明衬板）+ 上部墙板，面水一侧敞开 */
  const panelH = colH - 0.62;
  // 后墙（+Z 侧）
  const back = makeLatticePanel(W - 0.5, panelH, 4, 4);
  back.position.set(0, 0.55 + 0.5 + panelH/2, D/2 - 0.35);
  g.add(back);
  // 左右侧
  [1, -1].forEach(sx=>{
    const s = makeLatticePanel(D - 0.5, panelH, 4, 4);
    s.position.set(sx*(W/2 - 0.35), 0.55 + 0.5 + panelH/2, 0);
    s.rotation.y = sx * Math.PI/2;
    g.add(s);
    // 格窗上方的墙板（到额枋）
    const band = mesh(box(0.26, colH - panelH - 0.52, D - 0.3), MAT.wall, { name:'pavBand' });
    band.position.set(sx*(W/2 - 0.35), 0.55 + 0.5 + panelH + (colH - panelH - 0.52)/2, 0);
    g.add(band);
  });
  const bandB = mesh(box(W - 0.5, colH - panelH - 0.52, 0.26), MAT.wall, { name:'pavBandBack' });
  bandB.position.set(0, 0.55 + 0.5 + panelH + (colH - panelH - 0.52)/2, D/2 - 0.35);
  g.add(bandB);
  // 坐槛（三面）
  [1, -1].forEach(sx=>{
    const seat = mesh(box(0.5, 0.16, D - 0.8), MAT.wood);
    seat.position.set(sx*(W/2 - 0.35), 0.55 + 0.5, 0); g.add(seat);
  });
  const seatB = mesh(box(W - 0.8, 0.16, 0.5), MAT.wood);
  seatB.position.set(0, 0.55 + 0.5, D/2 - 0.35); g.add(seatB);

  /* 四角歇山顶 */
  // 同上：正脊取面阔，端坡才与主坡同陡
  const roof = makeChineseRoof({ w: W + 3.2, d: D + 3.2, hRidge: 2.1, ridgeLen: W, lift: 0.9 });
  roof.position.y = 0.55 + colH + 0.42;
  g.add(roof);
  // 天花
  const pavCeil = makeCeiling(W - 0.2, D - 0.2, 0.55 + colH + 0.36);
  g.add(pavCeil);

  /* 匾额「荷风四面」（面水一侧，-Z 敞开面） */
  const tex = makePlaqueTex('荷风四面');
  const pl = mesh(new THREE.PlaneGeometry(3.2, 0.95),
    new THREE.MeshStandardMaterial({ map:tex, roughness:0.55, metalness:0.1 }), { name:'pavilionPlaque' });
  pl.position.set(0, 0.55 + colH - 0.3, -(D/2 - 0.26));
  pl.rotation.y = Math.PI;
  g.add(pl);

  return g;
}

/* 游廊：沿折线路径生成多段双坡顶廊道 */
export function makeCorridor(points, width = 3.0){
  const g = new THREE.Group();
  const colH = 2.9;
  for (let i = 0; i < points.length - 1; i++){
    const a = points[i], b = points[i+1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(-dz, dx);         // 绕 Y 轴朝向（局部 +X 对齐走向）
    const seg = new THREE.Group();

    // 双坡顶（两片斜面 + 檐口封边）：中间高、两侧低
    [-1, 1].forEach(sgn=>{
      const slope = mesh(makeCorrugatedSlab(len + 0.36, 0.16, width*0.66), MAT.roof, { name:'corridorRoof' });
      slope.position.set(0, colH + 0.84, sgn*width*0.28);
      slope.rotation.x = sgn * 0.38;          // 外沿向下
      seg.add(slope);
      const fascia = mesh(box(len + 0.4, 0.22, 0.1), MAT.ridge, { name:'corridorFascia' });
      fascia.position.set(0, colH + 0.44, sgn*(width*0.28 + 0.92));
      seg.add(fascia);
    });
    const ridge = mesh(box(len + 0.4, 0.2, 0.26), MAT.ridge);
    ridge.position.set(0, colH + 1.28, 0); seg.add(ridge);
    // 天花（望板）
    const cCeil = mesh(box(len, 0.07, width), MAT.woodDark, { cast:false, name:'corridorCeiling' });
    cCeil.position.set(0, colH + 0.34, 0); seg.add(cCeil);

    // 柱列（两侧，每 2.6 米一对）
    const n = Math.max(2, Math.round(len / 2.6));
    for (let k = 0; k <= n; k++){
      const t = k / n, px = -len/2 + len*t;
      [-1, 1].forEach(sgn=>{
        const c = makeColumn(colH, 0.16);
        c.position.set(px, colH/2 + 0.2, sgn*(width/2 - 0.16));
        seg.add(c);
      });
    }
    // 额枋
    [-1, 1].forEach(sgn=>{
      const b = mesh(box(len, 0.24, 0.18), MAT.woodRed);
      b.position.set(0, colH + 0.22, sgn*(width/2 - 0.16));
      seg.add(b);
    });
    // 挂落（檐下花牙子，实例化）
    const drops = [];
    for (let k = 0; k < Math.floor(len/0.75); k++){
      drops.push({ x: -len/2 + 0.75*k + 0.4, y: colH + 0.02, z: width/2 - 0.16, ry:0 });
      drops.push({ x: -len/2 + 0.75*k + 0.4, y: colH + 0.02, z: -(width/2 - 0.16), ry:0 });
    }
    const dropInst = instancedBoxes(drops, MAT.woodDark, [0.14, 0.34, 0.12]);
    if (dropInst) seg.add(dropInst);
    // 美人靠（一侧座栏）
    const rail = mesh(box(len, 0.12, 0.42), MAT.wood, { name:'meirenkao' });
    rail.position.set(0, 1.05, width/2 - 0.28); seg.add(rail);
    const railBack = mesh(box(len, 0.1, 0.14), MAT.wood);
    railBack.position.set(0, 1.52, width/2 - 0.12); seg.add(railBack);

    seg.position.set((a.x + b.x)/2, 0, (a.z + b.z)/2);
    seg.rotation.y = ang;
    g.add(seg);

    // 沿额枋垂挂紫藤
    const nW = Math.max(2, Math.round(len / 3.4));
    for (let k = 0; k < nW; k++){
      const px = -len/2 + len * ((k + 0.5) / nW);
      const w = makeWisteria(3);
      w.position.set(px, colH + 0.26, width/2 - 0.16);
      seg.add(w);
    }
  }
  return g;
}

bootMark('§4 建筑');