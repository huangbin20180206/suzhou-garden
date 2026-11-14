from PIL import Image
import io, json
def diffuse_img(glb):
    b = open(glb, "rb").read()
    clen = int.from_bytes(b[12:16], "little")
    j = json.loads(b[20:20+clen].decode("utf8"))
    m = j["materials"][0]
    tex = m["pbrMetallicRoughness"]["baseColorTexture"]
    img = j["images"][tex["index"]]
    bv = j["bufferViews"][img["bufferView"]]
    off = 20 + clen + 8 + bv.get("byteOffset", 0)
    return Image.open(io.BytesIO(b[off:off+bv["byteLength"]])).convert("RGB")
for tag, glb in [("boulder", "E:/ai_test/codex_test/suzhou-garden/assets/boulder-hero.glb"), ("stone", "E:/ai_test/codex_test/suzhou-garden/research/cc0-scout/hero2-candidates/stone-hero.glb")]:
    im = diffuse_img(glb)
    im.thumbnail((160,160))
    out = "E:/ai_test/codex_test/suzhou-garden/research/cc0-scout/hero2-candidates/thumbs/%s-gray-160.png" % tag
    im.save(out, "PNG")
    px = list(im.getdata()); n=len(px)
    r=sum(p[0] for p in px)/n; g=sum(p[1] for p in px)/n; bl=sum(p[2] for p in px)/n
    print(tag, im.size, "mean R=%.1f G=%.1f B=%.1f" % (r,g,bl))