from PIL import Image
import io, json
def arm_of(glb, tag):
    b = open(glb, "rb").read()
    clen = int.from_bytes(b[12:16], "little")
    j = json.loads(b[20:20+clen].decode("utf8"))
    m = j["materials"][0]["pbrMetallicRoughness"]
    if "metallicRoughnessTexture" not in m:
        print(tag, ": 无 ARM 贴图"); return
    img = j["images"][m["metallicRoughnessTexture"]["index"]]
    bv = j["bufferViews"][img["bufferView"]]
    off = 20 + clen + 8 + bv.get("byteOffset", 0)
    im = Image.open(io.BytesIO(b[off:off+bv["byteLength"]])).convert("RGB")
    px = list(im.getdata()); n = len(px)
    r = sum(p[0] for p in px)/n; g = sum(p[1] for p in px)/n; bl = sum(p[2] for p in px)/n
    print(tag, "ARM mean R=%.1f G=%.1f B=%.1f" % (r,g,bl))
arm_of("E:/ai_test/codex_test/suzhou-garden/assets/boulder-hero.glb", "现行浅灰版")
arm_of("E:/ai_test/codex_test/suzhou-garden/research/cc0-scout/hero2-candidates/boulder-hero.glb", "research 候选")
arm_of("E:/ai_test/codex_test/suzhou-garden/research/cc0-scout/models/boulder_01/boulder_01_1k.gltf".replace(".gltf",".gltf"), "源 gltf(实为文本，跳过)")