/* 极简 PNG 解码（零依赖，仅用 node:zlib）。
 *
 * 为什么需要它：探针要断言"画面确实变了 / 变了多少"，而 Playwright 只给 PNG 字节流。
 * 项目里原来做像素差分走的是 Python + PIL（probe/_shot-calib.mjs 就这么干的），
 * 于是 Node 探针里没法直接量化差异 —— 而"画面有没有响应状态切换"恰恰是本项目
 * 反复踩坑的静默缺陷（render 没执行、影子在盒外失效、朝向对但被挡…）。
 *
 * 支持范围：8 位、非隔行、colorType 0/2/4/6（灰度/RGB/RGBA/灰度+alpha），
 * 覆盖 Playwright 截图与 canvas.toDataURL 的全部实际输出。
 * 不支持：16 位、调色板、Adam7 隔行 —— 遇到直接抛错，不静默给错数据。
 */
import zlib from 'node:zlib';

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47 || buf.readUInt32BE(4) !== 0x0D0A1A0A)
    throw new Error('不是 PNG');
  let w = 0, h = 0, bd = 0, ct = 0, interlace = 0;
  const idat = [];
  for (let off = 8; off + 8 <= buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9]; interlace = data[12];
      if (bd !== 8) throw new Error(`PNG bitDepth=${bd} 不支持`);
      if (interlace !== 0) throw new Error('PNG 隔行（Adam7）不支持');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const BPP = { 0: 1, 4: 2, 2: 3, 6: 4 }[ct];
  if (!BPP) throw new Error(`PNG colorType=${ct} 不支持`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * BPP;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= BPP ? cur[i - BPP] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= BPP) ? prev[i - BPP] : 0;
      let v = line[i];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 255;
      } else if (f !== 0) throw new Error(`PNG 行过滤器 ${f} 未知`);
      cur[i] = v;
    }
  }
  return { w, h, bpp: BPP, data: out };
}

/* 平均绝对差（0~255）：逐通道取 |a-b| 的均值。
   只比 RGB（跳过 alpha），alpha 在截图里恒为 255，算进来会把差异稀释。 */
export function meanAbsDiff(A, B) {
  const a = A.data, b = B.data;
  if (a.length !== b.length) throw new Error(`尺寸不一致 ${a.length} vs ${b.length}`);
  const bp = A.bpp;
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += bp) {
    for (let k = 0; k < Math.min(3, bp); k++) { sum += Math.abs(a[i + k] - b[i + k]); n++; }
  }
  return sum / n;
}

/* 平均亮度（0~255），用于"切夜是否真的变暗"这类判据 */
export function meanLuma(img) {
  const d = img.data, bp = img.bpp;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += bp) {
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
  }
  return sum / n;
}
