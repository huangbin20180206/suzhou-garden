from PIL import Image
import glob
for f in sorted(glob.glob('E:/ai_test/codex_test/suzhou-garden/research/cc0-scout/recolored-jpgs/*.jpg')):
    im = Image.open(f).convert('RGB')
    px = list(im.getdata()); n=len(px)
    r=sum(p[0] for p in px)/n; g=sum(p[1] for p in px)/n; b=sum(p[2] for p in px)/n
    print(f.split('/')[-1], '| %dx%d | R=%.1f G=%.1f B=%.1f | sat=%.3f' % (im.size[0], im.size[1], r,g,b, (max(r,g,b)-min(r,g,b))/255))