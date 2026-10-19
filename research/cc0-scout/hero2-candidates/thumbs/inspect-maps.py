from PIL import Image
import io, json
b = open("E:/ai_test/codex_test/suzhou-garden/assets/boulder-hero.glb","rb").read()
clen = int.from_bytes(b[12:16], "little")
j = json.loads(b[20:20+clen].decode("utf8"))
m = j["materials"][0]["pbrMetallicRoughness"]
print("材料键:", list(m.keys()))
for key in m:
    if isinstance(m[key], dict) and "index" in m[key]:
        img = j["images"][m[key]["index"]]
        bv = j["bufferViews"][img["bufferView"]]
        off = 20 + clen + 8 + bv.get("byteOffset", 0)
        im = Image.open(io.BytesIO(b[off:off+bv["byteLength"]])).convert("RGB")
        px = list(im.getdata()); n = len(px)
        r = sum(p[0] for p in px)/n; g = sum(p[1] for p in px)/n; bl = sum(p[2] for p in px)/n
        print(" ", key, im.size, "mean R=%.1f G=%.1f B=%.1f" % (r,g,bl), "| 文件名:", img.get("name"))
        im.thumbnail((160,160))
        im.save("E:/ai_test/codex_test/suzhou-garden/research/cc0-scout/hero2-candidates/thumbs/boulder-" + key + ".png")