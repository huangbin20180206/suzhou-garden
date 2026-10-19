# 扫描狮贴图去金化（2026-10-18）
# 输入：build_lions.py 导出的 out/*.glb（原始扫描贴图：金漆 + 青苔）
# 做法：只改 baseColor 贴图 —— 转亮度 → 重映射到青灰石色阶；
#       normal / ORM 原样保留（石皮的起伏、粗糙度全在法线里，不能丢）。
# 写回：原位覆盖 GLB 的 bufferView（新 WebP 必须 ≤ 原长度，不够就降质量），
#       只改该 bufferView 的 length，其余字节与偏移**一位不动**。
import json, struct, io, os, sys
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))


def read_glb(path):
    b = open(path, 'rb').read()
    magic, ver, total = struct.unpack('<III', b[:12])
    assert magic == 0x46546C67 and ver == 2
    jlen, jtype = struct.unpack('<II', b[12:20])
    assert jtype == 0x4E4F534A
    js = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack('<II', b[off:off + 8])
    assert btype == 0x004E4942
    bin0 = off + 8
    return js, bytearray(b[bin0:bin0 + blen])


def rebuild(js, binbytes):
    jb = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = binbytes + b'\x00' * ((4 - len(binbytes) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    out = struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    out += struct.pack('<II', len(bb), 0x004E4942) + bb
    return out


def stone_color(arr):
    """RGB float [0,1] → 青灰石。保留亮度结构，去掉金/黄/绿的色相。"""
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lo, hi = np.percentile(lum, 1.5), np.percentile(lum, 98.5)
    t = np.clip((lum - lo) / max(1e-4, hi - lo), 0, 1)
    t = t ** 0.92                       # 轻微提亮中间调（扫描整体偏暗）
    dark = np.array([0.285, 0.300, 0.298], dtype=np.float32)   # ≈ 73,77,76
    light = np.array([0.775, 0.787, 0.780], dtype=np.float32)  # ≈ 198,201,199
    out = dark + (light - dark) * t[..., None]
    # 极轻的冷灰偏色（园里的石材是中性偏冷的青灰）
    out[..., 0] *= 0.985
    out[..., 2] *= 1.012
    return np.clip(out, 0, 1)


def recolor_glb(path):
    js, binbytes = read_glb(path)
    # 找 baseColor 贴图
    mat = js['materials'][0]
    tex_i = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    tex = js['textures'][tex_i]
    img_i = tex.get('source', tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
    assert img_i is not None, tex
    img = js['images'][img_i]
    bv = js['bufferViews'][img['bufferView']]
    old = binbytes[bv['byteOffset']:bv['byteOffset'] + bv['byteLength']]
    im = Image.open(io.BytesIO(old)).convert('RGB')
    arr = np.asarray(im).astype(np.float32) / 255.0
    out = stone_color(arr)
    new_im = Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGB')
    print(os.path.basename(path), 'texture', im.size, 'old', len(old))
    chosen = None
    for q in (86, 82, 78, 74, 70, 64, 58):
        buf = io.BytesIO()
        new_im.save(buf, 'WEBP', quality=q, method=6)
        data = buf.getvalue()
        if len(data) <= len(old):
            chosen = (data, q)
            break
    if chosen is None:
        raise SystemExit('新贴图比原 bufferView 还大，需要先缩小尺寸')
    data, q = chosen
    off = bv['byteOffset']
    binbytes[off:off + len(data)] = data
    binbytes[off + len(data):off + bv['byteLength']] = b'\x00' * (bv['byteLength'] - len(data))
    bv['byteLength'] = len(data)
    out_glb = rebuild(js, binbytes)
    open(path, 'wb').write(out_glb)
    print('  -> q=%d %d bytes, glb %d bytes' % (q, len(data), len(out_glb)))


if __name__ == '__main__':
    targets = sys.argv[1:] or [os.path.join(BASE, 'out', 'stone-lion-male.glb'),
                               os.path.join(BASE, 'out', 'stone-lion-female.glb')]
    for t in targets:
        recolor_glb(t)
