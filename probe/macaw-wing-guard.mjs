// 金刚鹦鹉"翅膀扇动"专项守卫 · node probe/macaw-wing-guard.mjs
//
// 为什么要有这道门：2026-10-23 老黄指认"起跳/换峰飞行翅膀都不动"。根因是 Macaw.glb
// 单网格无骨骼，此前的"振翅"只是整身 roll —— 翅膀几何从未参与动画。本轮按
// installHorseRig 的伪蒙皮路子给几何烘了 aWing 权重 + onBeforeCompile 注入绕肩旋转。
// ⚠️ 这类"着色器注入"的失效是**静默**的（画面只是不动，零报错，同马伪蒙皮教训），
//    所以必须有门：注入断了的唯一可靠信号是"驱动了 uniform 画面却一个像素都不变"。
//
// 验什么：
//   ① 前提：3 只 Macaw 到位，每只材质带独立 wingU 句柄（三只同引用=三只同步扇，必红）；
//   ② 结构：几何上有 aWing 属性、且正负权重都有（两翼对称的符号约定）；
//   ③ **注入有效性（像素 A/B）**：近机位冻结帧，uWing=0 ↔ 0.85 差异像素必须超预算
//      （防静默失败的核心牙）；自检：同状态连渲两张逐位 0（项目铁律）；
//   ④ 行为：40s 真实窗口里出现过"翅膀角明显非零"（flutter/hop/飞行任一）、
//      出现过两鸟翅膀角明显不同步、rest 时全体收拢 ≤0.06；
//   ⑤ 全程零 pageerror。
//
// ⚠️ 改 MACAW_WING 常数（幅度/频率/权重窗口）后必须重跑本门 + macaw-guard 两遍。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 40;                       // 行为窗（真实秒，按帧采样）
const PX_BUDGET = 200;              // ③ 展翅↔收翅 的差异像素下限
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
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' · ' + detail : ''}`);
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* 前提：白天/晴 —— macaws 才栖停（macawWantPerch 的唯一阈值源） */
  await page.evaluate(() => {
    const G = window.__garden;
    G.setEnv('season', 'summer'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);

  /* ① ② 前提与结构（一次页内扫描） */
  const pre = await page.evaluate(() => {
    const holders = [];
    window.__garden.scene.traverse(o => { if (o.name === 'Macaw') holders.push(o); });
    const wingUs = new Set(), meshes = [];
    const attr = { has: false, count: 0, pos: 0, neg: 0 };
    for (const h of holders){
      h.traverse(o => {
        if (!o.isMesh) return;
        meshes.push(o);
        const w = o.material && o.material.userData && o.material.userData.wingU;
        if (w) wingUs.add(w);
        const a = o.geometry && o.geometry.getAttribute('aWing');
        if (a){
          attr.has = true; attr.count = a.count;
          for (let i = 0; i < a.count; i++){
            const v = a.array[i];
            if (v > 0.5) attr.pos++; else if (v < -0.5) attr.neg++;
          }
        }
      });
    }
    return { n: holders.length, meshN: meshes.length, wingUN: wingUs.size, attr };
  });
  check('① 前提：3 只 Macaw 到位', pre.n === 3 && pre.meshN >= 3, `${pre.n} 只 / ${pre.meshN} 网格`);
  check('① 前提：3 只各自独立 wingU（同引用=三只同步扇）', pre.wingUN === 3, `独立句柄 ${pre.wingUN}`);
  check('② 结构：aWing 权重已烘且两翼符号都有', pre.attr.has && pre.attr.count > 0 && pre.attr.pos > 100 && pre.attr.neg > 100,
    `count=${pre.attr.count} +${pre.attr.pos}/−${pre.attr.neg}`);

  /* ③ 注入有效性：近机位冻结帧像素 A/B（同任务连渲，每臂取第二张落定帧） */
  const ab = await page.evaluate(() => {
    const G = window.__garden;
    const holder = [];
    G.scene.traverse(o => { if (o.name === 'Macaw') holder.push(o); });
    const p = new (Object.getPrototypeOf(G.camera.position).constructor)();
    holder[0].getWorldPosition(p);
    /* 机位离鸟 ~3.2m、略高俯视 —— 0.5m 的鸟约占画面高 1/4，翅摆差异肉眼级 */
    G.camera.position.set(p.x + 2.4, p.y + 0.9, p.z + 2.2);
    G.camera.lookAt(p.x, p.y + 0.2, p.z);
    G.camera.updateMatrixWorld(true); G.camera.updateProjectionMatrix();
    const wingUs = [];
    holder.forEach(h => h.traverse(o => {
      if (o.isMesh && o.material.userData && o.material.userData.wingU) wingUs.push(o.material.userData.wingU);
    }));
    const setAll = v => wingUs.forEach(u => { u.value = v; });
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, cv.width, cv.height).data; };
    const diff = (A, B) => {
      let n = 0;
      for (let i = 0; i < A.length; i += 4){
        const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d > 30) n++;
      }
      return n;
    };
    setAll(0); grab(); const A0 = grab();            // 收翅臂（第一张落定用）
    const A0b = grab();                              // 自检：同状态再渲一张，必须逐位同
    let selfDiff = 0;
    for (let i = 0; i < A0.length; i++) if (A0[i] !== A0b[i]) selfDiff++;
    setAll(0.85); grab(); const A1 = grab();         // 展翅臂
    const px = diff(A0, A1);
    setAll(0); grab(); const A2 = grab();            // 复位臂：必须回到与收翅臂逐位一致
    let back = 0;
    for (let i = 0; i < A0.length; i++) if (A0[i] !== A2[i]) back++;
    return { selfDiff, px, back, w: cv.width, h: cv.height };
  });
  check('③ 自检：冻结帧同状态连渲两张逐位一致（手法可信前提）', ab.selfDiff === 0, `差 ${ab.selfDiff} 字节`);
  check(`③ 展翅↔收翅 差异像素 ≥ ${PX_BUDGET}（注入失效=0，必红）`, ab.px >= PX_BUDGET,
    `${ab.px}px @${ab.w}×${ab.h}`);
  check('③ 复位：uWing 归零后画面逐位复原（uniform 确实驱动这一层）', ab.back === 0, `差 ${ab.back} 字节`);

  /* ④ 行为：40s 真实窗口按帧采样 macawState（软件渲染下仿真约 1/N 速，按帧数不断言） */
  const rows = await page.evaluate(async (secs) => {
    const G = window.__garden, out = [];
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        out.push({ sc: G.simClock(), s: G.macawState() });
        if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    return out;
  }, W);
  let maxW = 0, maxDesync = 0, restW = 0, restSamples = 0, flightW = 0;
  for (const r of rows){
    const ws = r.s.map(m => Math.abs(m.wing || 0));
    const mx = Math.max(...ws, 0);
    if (mx > maxW) maxW = mx;
    if (r.s.some(m => m.mode !== 'perch')) flightW = Math.max(flightW, mx);
    if (ws.length >= 2) maxDesync = Math.max(maxDesync, Math.max(...ws) - Math.min(...ws));
    if (r.s.length && r.s.every(m => m.mode === 'perch' && m.ev === 'rest')){
      restSamples++; restW = Math.max(restW, mx);
    }
  }
  const f3 = x => (+x).toFixed(3);
  check('④ 行为：窗口内翅膀角明显非零（flutter/hop/飞行任一）', maxW >= 0.12,
    `max wing ${f3(maxW)} rad`);
  check('④ 行为：出现过两鸟翅膀角不同步（逐鸟相位错开的既有取舍）', maxDesync >= 0.08,
    `max 同帧差 ${f3(maxDesync)} rad`);
  check('④ 行为：rest 时全体收拢 ≤0.06（不扇）', restSamples > 0 && restW <= 0.06,
    `${restSamples} 帧 rest，max ${f3(restW)}`);
  check('④ 全程零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? `\nmacaw-wing-guard: ${failed.length} 项红` : '\nmacaw-wing-guard: ALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('GUARD ERROR', e); process.exit(2); });
