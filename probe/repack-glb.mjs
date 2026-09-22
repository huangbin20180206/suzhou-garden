#!/usr/bin/env node
/* GLB 贴图重编码（P1-3 GLB 资产压缩）—— 离线、零新增依赖、零 CDN。
 *
 * 为什么不是 Draco / KTX2：
 *   实测四个资产 85%~92% 的体积是**贴图**（几何只有 74~193 KB），
 *   而 12 张贴图全是 512×512 RGB PNG（无 alpha），单张 140~429 KB —— 那是
 *   AI 生成图的噪点让 PNG 的行滤波 + deflate 彻底失效，不是分辨率问题。
 *   所以「缩几何」收益极小、KTX2 又需要 basis 编码器（要下载）；
 *   真正对症的是**换编码器不降分辨率**：无 alpha 的 RGB → JPEG（glTF 核心
 *   mimeType，不需要任何扩展，兼容性最好），逐槽给不同质量：
 *     baseColor 0.88 / normal 0.92（法线最怕压缩噪点）/ metalRough 0.85。
 *   几何**一个字节都不动**（不 quantize、不简面），所以没有形体变化风险。
 *
 * 编码器：不引入 sharp / node-canvas 之类原生依赖 —— 直接用已有依赖 Playwright
 *   的 Chromium：PNG 喂给 canvas，再 toDataURL('image/jpeg', q)。全离线。
 *
 * 用法：
 *   node probe/repack-glb.mjs              # 输出到 outputs/glb-opt（默认，不动 assets/）
 *   node probe/repack-glb.mjs --apply      # 先备份到 outputs/glb-backup 再覆盖 assets/
 *   node probe/repack-glb.mjs --q 0.85     # 统一质量（覆盖逐槽默认）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = path.join(ROOT, 'assets');
const OUT  = path.join(ROOT, 'outputs', 'glb-opt');
const BAK  = path.join(ROOT, 'outputs', 'glb-backup');
const APPLY = process.argv.includes('--apply');
const qArg = process.argv.indexOf('--q');
const Q_OVERRIDE = qArg >= 0 ? parseFloat(process.argv[qArg + 1]) : null;

const QUALITY = { baseColor: 0.88, normal: 0.92, metalRough: 0.85, emissive: 0.90, occlusion: 0.85 };

function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}

/* ── GLB 读写（只重排 BIN 里的贴图字节，JSON 结构语义不变）── */
function readGlb(file){
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('不是 GLB：' + file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binOff = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binOff);
  const bin = buf.slice(binOff + 8, binOff + 8 + binLen);
  return { json, bin };
}
function writeGlb(file, json, bin){
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);   // 空格补齐
  let bn = bin;
  if (bn.length % 4) bn = Buffer.concat([bn, Buffer.alloc(4 - (bn.length % 4), 0)]);      // 零补齐
  const total = 12 + 8 + js.length + 8 + bn.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bn.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, js, bh, bn]));
}

/* image → 用途（槽位名），决定 JPEG 质量 */
function slotOf(json, imageIdx){
  const usage = new Map();
  for (const m of json.materials || []){
    const pbr = m.pbrMetallicRoughness || {};
    if (pbr.baseColorTexture) usage.set(pbr.baseColorTexture.index, 'baseColor');
    if (pbr.metallicRoughnessTexture) usage.set(pbr.metallicRoughnessTexture.index, 'metalRough');
    if (m.normalTexture) usage.set(m.normalTexture.index, 'normal');
    if (m.emissiveTexture) usage.set(m.emissiveTexture.index, 'emissive');
    if (m.occlusionTexture) usage.set(m.occlusionTexture.index, 'occlusion');
  }
  const texIdx = (json.textures || []).findIndex(t => t.source === imageIdx);
  return usage.get(texIdx) || 'baseColor';
}

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');

  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter(n => n.endsWith('.glb'));
  let totalBefore = 0, totalAfter = 0;

  for (const f of files){
    const src = path.join(SRC, f);
    const before = fs.statSync(src).size;
    const { json, bin } = readGlb(src);
    totalBefore += before;

    /* 哪些 bufferView 是 PNG 贴图（其余：几何/索引，原样搬） */
    const imgViews = new Map();
    (json.images || []).forEach((im, i) => {
      if (im.bufferView !== undefined) imgViews.set(im.bufferView, { i, slot: slotOf(json, i) });
    });

    const parts = [];
    let off = 0;
    const log = [];
    for (let v = 0; v < json.bufferViews.length; v++){
      const bv = json.bufferViews[v];
      let bytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);

      const isImg = imgViews.get(v);
      if (isImg && json.images[isImg.i].mimeType === 'image/png'){
        const slot = isImg.slot;
        const q = Q_OVERRIDE !== null ? Q_OVERRIDE : (QUALITY[slot] || 0.88);
        const b64 = bytes.toString('base64');
        const outB64 = await page.evaluate(async ({ b64, q }) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + b64;
          await img.decode();
          const c = document.getElementById('c');
          c.width = img.width; c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          return c.toDataURL('image/jpeg', q).slice('data:image/jpeg;base64,'.length);
        }, { b64, q });
        const jpg = Buffer.from(outB64, 'base64');
        log.push(`${slot} ${(bytes.length / 1024).toFixed(0)}→${(jpg.length / 1024).toFixed(0)}KB q${q}`);
        bytes = jpg;
        json.images[isImg.i].mimeType = 'image/jpeg';
      }

      /* 4 字节对齐：accessor 的 byteOffset 相对 bufferView，对齐语义必须保持 */
      const pad = (4 - (bytes.length % 4)) % 4;
      bv.byteOffset = off;
      bv.byteLength = bytes.length;
      parts.push(bytes, Buffer.alloc(pad, 0));
      off += bytes.length + pad;
    }
    const newBin = Buffer.concat(parts);
    json.buffers[0].byteLength = newBin.length;

    const dst = path.join(OUT, f);
    writeGlb(dst, json, newBin);
    const after = fs.statSync(dst).size;
    totalAfter += after;
    console.log(`${f}  ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB ` +
                `(-${(100 - after / before * 100).toFixed(0)}%)`);
    console.log('   ' + log.join(' · '));
  }

  console.log(`\n合计 ${(totalBefore / 1024).toFixed(0)} KB → ${(totalAfter / 1024).toFixed(0)} KB ` +
              `(-${(100 - totalAfter / totalBefore * 100).toFixed(0)}%)`);

  if (APPLY){
    fs.mkdirSync(BAK, { recursive: true });
    for (const f of files){
      fs.copyFileSync(path.join(SRC, f), path.join(BAK, f));      // 先备份原件
      fs.copyFileSync(path.join(OUT, f), path.join(SRC, f));
    }
    console.log('已覆盖 assets/（原件备份在 outputs/glb-backup/，git restore assets/ 亦可还原）');
  } else {
    console.log('输出在 outputs/glb-opt/（未动 assets/）—— 复核后加 --apply 生效');
  }
  await browser.close();
})().catch(e => { console.error('[repack] 失败：', e); process.exit(1); });