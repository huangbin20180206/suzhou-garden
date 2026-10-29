// 马车版到访（S6）回归门禁：node probe/visit-carriage-guard.mjs
//
// 为什么建这道门（2026-10-24 代码审核 P2-4）：
//   S6「客人坐车来 → 马夫系马 → 下车进园 → 游园 → 送客上车 → 马车离开」整条链
//   **没有任何入库门禁** —— 583.6s 跑通、22 个相位、六项指标全来自一次性脚本。
//   于是下面这些缺陷谁都没守：
//     · 客人上车后 `ride` 没恢复 ⇒ 掉到地面约 3.5s（还保持坐姿）；
//     · 车轮里程拿"本段走了多远"当累计值 ⇒ 倒车→调头→离场两次跳变（约 2 圈）；
//     · wrap 只等"车已离场"，任何一环卡住就**永久停在终态前**、且不报错。
//
// 守什么：
//   ① 相位链真的走到 done（客到 → 迎 → 揖 → 同行 → 入座 → 奉茶 → 游园 → 送客 → 车走）；
//   ② 马车状态机走到 gone；
//   ③ **上车窗口里客人/马夫始终在座面高度**（相对车底 ≥0.40m / ≥0.55m）——
//      这就是"掉到地面"的直接判据（缺陷态实测会掉到 ≈0）；
//   ④ **里程 odo 跨段连续**：0.4s 步长内 |Δodo| ≤ 0.60m（出车 1.10m/s ⇒ 0.44；
//      倒车/原地踏步 0.55m/s ⇒ 0.22）。旧写法在倒车→调头处跳 3.4、调头→离场处跳 ~1.5；
//   ⑤ 客人全程贴地（走路段 |y − floorY| ≤ 0.25m），零 pageerror。
//
// ⚠️ 用 `actorStep` 快进：软件渲染只有 1~3fps，实时等 583s 的戏要几小时。
//    actorStep 与渲染循环走同一份 advance()（产品自己的时钟），快进不改口径。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEP = 0.4;                 // 快进步长（秒）
const MAX_STEPS = 3200;           // 上限 1280s（2026-10-29 起整场 ~804s：多了门外迎/送与回水榭两段路）
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.webmanifest': 'application/manifest+json', '.ktx2': 'image/ktx2' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = (() => {
    const require = createRequire(import.meta.url);
    try { return require('playwright'); }
    catch {
      const g = require('node:child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
      return require(path.join(g, 'playwright'));
    }
  })();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.setDefaultTimeout(1800000);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // 马车版是默认到访模式（?visit=walk 才是旧步行版）
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=low&intro=0`, { waitUntil: 'commit', timeout: 180000 });
  await page.waitForFunction(() => !!window.__garden && window.__garden.bootDone(), null,
    { timeout: 900000, polling: 500 });
  await page.waitForFunction(() => {
    const G = window.__garden;
    if (!G || !G.actorVisit || !G.actorState || !G.stableTravel || !G.stableTravel()) return false;
    /* ⚠️ 别按 id 猜马夫叫什么：人物 id 是 scholar / lady / **laborer**（不是 coach），
       而 VISIT 里的角色 id 才是导演层的事。直接问产品"客人/马夫/主人在不在"。 */
    const v = G.actorVisit();
    return !!(v && v.guest && v.coach && v.host);
  }, null, { timeout: 900000, polling: 500 });

  const r = await page.evaluate(({ STEP, MAX_STEPS }) => {
    const G = window.__garden;
    const phases = [], cars = [];
    let lastPhase = '', lastCar = '';
    let boardFrames = 0, coachFrames = 0, guestMinGap = Infinity, coachMinGap = Infinity;
    let guestDropFrames = 0, coachDropFrames = 0;
    let odoMaxJump = 0, odoJumpAt = '', lastOdo = null, lastLeg = '';
    let nan = 0, floorBad = 0, simT = 0;
    let coachBusyFrames = 0, coachHidden = 0, outFrames = 0, outHidden = 0;
    /* 2026-10-29 新契约：门外见面/送客、挥手、回水榭听琴 */
    let faceOut = null, wavePeak = 0, waveWristMax = -Infinity, waveMinDistHead = Infinity;
    const R = G.actorRig ? G.actorRig('scholar') : null;
    const _w = new G.THREE.Vector3(), _h = new G.THREE.Vector3();
    for (let k = 0; k < MAX_STEPS; k++){
      G.actorStep(STEP);
      simT += STEP;
      const v = G.actorVisit();
      if (v.phase === 'face' && !faceOut) faceOut = { host: v.host.pos.slice(), guest: v.guest.pos.slice() };
      if (v.phase === 'wave' && v.waveW > wavePeak) wavePeak = v.waveW;
      if (R && v.phase === 'wave' && v.waveW > 0.9){
        R.holder.updateMatrixWorld(true);
        R.holder.worldToLocal(R.bones.RightHand.getWorldPosition(_w));
        R.holder.worldToLocal(R.bones.Head.getWorldPosition(_h));
        if (_w.y > waveWristMax) waveWristMax = _w.y;
        const dh = Math.hypot(_w.x - _h.x, _w.y - _h.y, _w.z - _h.z);
        if (dh < waveMinDistHead) waveMinDistHead = dh;
      }
      if (v.phase !== lastPhase){ phases.push([+simT.toFixed(1), v.phase]); lastPhase = v.phase; }
      if (v.car.state + '/' + v.car.leg !== lastCar){
        cars.push([+simT.toFixed(1), v.car.state + (v.car.leg ? '/' + v.car.leg : '')]);
        lastCar = v.car.state + '/' + v.car.leg;
      }
      for (const A of [v.host, v.guest, v.coach]) if (A && !A.pos.every(Number.isFinite)) nan++;

      /* ⑧ 车夫在岗（2026-10-29 老黄："马车走的时候没有马夫在驾车"）。
         真因：tickVisit 里那张"该显示车夫还是常驻马夫"的白名单漏了 driveout
         （倒车/调头/驶离）与 stop/tie/alight，车一动车夫就被藏起来。
         这里逐状态断：车夫有活的每一个子状态，他都必须 visible。 */
      const BUSY = ['drivein', 'stop', 'tiewalk', 'tie', 'alight', 'board', 'driveout'];
      if (BUSY.includes(v.car.state) && v.coach){
        coachBusyFrames++;
        if (!v.coach.visible) coachHidden++;
        if (v.car.state === 'driveout') { outFrames++; if (!v.coach.visible) outHidden++; }
      }

      /* ③ 上车/在车上：人已上车、不在过渡插值里 ⇒ 必须坐在座面高度上。
         ⚠️ 取样窗必须含 driveout：马夫跨上车与"两人都到齐"几乎同一帧，只在 board 里取样
            会**一帧都取不到**（第一版就是空样本通过的，等于没有判据）。 */
      const carY = v.car.pos ? v.car.pos[1] : null;
      const onCar = v.car.state === 'board' || v.car.state === 'driveout';
      if (carY !== null && onCar && v.car.guestOn && !v.guest.trip){
        boardFrames++;
        const gap = v.guest.pos[1] - carY;
        guestMinGap = Math.min(guestMinGap, gap);
        if (gap < 0.40) guestDropFrames++;
      }
      if (carY !== null && onCar && v.car.coachOn && !v.coach.trip){
        coachFrames++;
        const gap = v.coach.pos[1] - carY;
        coachMinGap = Math.min(coachMinGap, gap);
        if (gap < 0.55) coachDropFrames++;
      }
      /* ④ 里程连续（只看有马车在动的段） */
      if (['driveout'].includes(v.car.state)){
        const odo = v.car.odo;
        if (lastOdo !== null){
          const j = Math.abs(odo - lastOdo);
          if (j > odoMaxJump){ odoMaxJump = j; odoJumpAt = v.car.leg + '@' + simT.toFixed(1) + 's'; }
        }
        lastOdo = odo; lastLeg = v.car.leg;
      }
      /* ⑤ 走路段贴地（骑在车上/过渡插值的帧跳过）。2026-10-29：主人也加了长距离步行
         （门外 → 水榭南门四级台阶），一并纳入贴地判据。 */
      for (const A of [v.host, v.guest, v.coach]){
        if (!A || !A.visible || A.ride || A.trip || A.sitW > 0.1 || A.floorY === null) continue;
        if (Math.abs(A.pos[1] - A.floorY) > 0.25) floorBad++;
      }
      if (v.phase === 'done') break;
    }
    /* 终态：主人应当站在水榭里、抚琴人旁边 */
    let qinDist = null, hostEnd = null;
    const q = G.scene.getObjectByName('actor_qin'), hs = G.scene.getObjectByName('actor_scholar');
    if (q && hs){
      const a = q.getWorldPosition(new G.THREE.Vector3());
      const b = hs.getWorldPosition(new G.THREE.Vector3());
      qinDist = +Math.hypot(a.x - b.x, a.z - b.z).toFixed(3);
      hostEnd = [b.x, b.y, b.z].map(n => +n.toFixed(3));
    }
    return { phases, cars, simT: +simT.toFixed(1), boardFrames, coachFrames, guestMinGap, coachMinGap,
             guestDropFrames, coachDropFrames, odoMaxJump: +odoMaxJump.toFixed(3), odoJumpAt,
             nan, floorBad, faceOut, wavePeak: +wavePeak.toFixed(3),
             coachBusyFrames, coachHidden, outFrames, outHidden,
             waveWristMax: Number.isFinite(waveWristMax) ? +waveWristMax.toFixed(3) : null,
             waveMinDistHead: Number.isFinite(waveMinDistHead) ? +waveMinDistHead.toFixed(3) : null,
             qinDist, hostEnd, end: G.actorVisit() };
  }, { STEP, MAX_STEPS });

  console.log('  相位：' + r.phases.map(p => p[0] + 's ' + p[1]).join(' → '));
  console.log('  马车：' + r.cars.map(c => c[0] + 's ' + c[1]).join(' → '));

  const names = r.phases.map(p => p[1]);
  check('① 相位链走到 done', names.includes('done'),
    `${r.simT}s 内到 ${names[names.length - 1]}（共 ${names.length} 段）`);
  for (const need of ['carIn', 'stow', 'bow', 'pair', 'enter', 'seat', 'tea', 'tour', 'ebow', 'wave', 'topav', 'listen'])
    check(`① 相位包含 ${need}`, names.includes(need));
  /* 2026-10-29 老黄：门外见面、门外送客 + 挥手 + 回水榭听琴 */
  const fo = r.faceOut;
  check('①b 见面在院门外（石狮旁，z>23）', !!fo && fo.host[2] > 23.0 && fo.guest[2] > 23.0,
    fo ? `主人 z=${fo.host[2]} / 客人 z=${fo.guest[2]}` : '未取到 face 相位');
  check('①c 挥手权重到 1', r.wavePeak >= 0.95, `峰值 ${r.wavePeak}`);
  check('①d 挥手时右手举过头顶（腕高 ≥1.68、离头 ≥0.28）',
    r.waveWristMax !== null && r.waveWristMax >= 1.68 && r.waveMinDistHead >= 0.28,
    `腕高 ${r.waveWristMax} / 离头 ${r.waveMinDistHead}`);
  check('①e 终态站在抚琴人旁边（≤1.6m）',
    r.qinDist !== null && r.qinDist <= 1.6 && !!r.end.hostAtQin,
    `距抚琴人 ${r.qinDist}m / hostAtQin=${r.end.hostAtQin} / 主人 ${JSON.stringify(r.hostEnd)}`);
  check('② 马车状态机走到 gone', r.cars.some(c => c[1].startsWith('gone')),
    r.cars.map(c => c[1]).slice(-4).join(' → '));

  check('③a 上车窗口取到样本（防"空判据"）', r.boardFrames >= 5, `${r.boardFrames} 帧`);
  check('③b 客人上车后始终在座面高度（≥0.40m，缺陷态 ≈0）',
    r.boardFrames >= 5 && r.guestDropFrames === 0,
    `最低 ${r.guestMinGap.toFixed(3)}m / 掉座 ${r.guestDropFrames} 帧`);
  check('③c 马夫上车后始终在车夫位高度（≥0.55m；≥3 帧才算有样本）',
    r.coachFrames >= 3 && r.coachDropFrames === 0,
    `最低 ${Number.isFinite(r.coachMinGap) ? r.coachMinGap.toFixed(3) + 'm' : '-'} / 掉座 ${r.coachDropFrames} 帧 / 样本 ${r.coachFrames} 帧`);

  check('④ 里程 odo 跨段连续（0.4s 内 |Δ| ≤ 0.60m；旧写法会跳 1.5~3.4m）',
    r.odoMaxJump <= 0.60, `最大跳变 ${r.odoMaxJump}m @ ${r.odoJumpAt || '-'}`);
  check('⑤ 走路段贴地（|y − floorY| ≤ 0.25m）', r.floorBad === 0, `越限 ${r.floorBad} 帧`);
  check('⑤b 无 NaN 位置', r.nan === 0, `NaN ${r.nan}`);
  /* ⑧ 2026-10-29 老黄："马车走的时候没有马夫在驾车" —— 那次是显隐白名单漏了 driveout。
     判据必须在**车夫有活的每一段**都取样（含 driveout，光看 drivein 会漏），
     且要有样本量下限（防"一帧都没取到"的空判据）。 */
  check('⑧ 车夫在岗：车在动/系马/上车的每一段他都在场上（含 driveout）',
    r.coachBusyFrames >= 20 && r.coachHidden === 0 && r.outFrames >= 3 && r.outHidden === 0,
    `在岗帧 ${r.coachBusyFrames} / 缺席 ${r.coachHidden}；其中驶离段 ${r.outFrames} 帧、缺席 ${r.outHidden}`);
  check('零 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  const fails = results.filter(x => !x.ok).length;
  console.log(`\n[visit-carriage-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[visit-carriage-guard] 探针异常：', e); process.exit(2); });
