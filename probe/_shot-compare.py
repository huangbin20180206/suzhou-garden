# -*- coding: utf-8 -*-
"""修复前后对比图：切暴雨，画面到底动没动？
上排 = 修复前（render 被每帧异常吃掉，画面冻结）／下排 = 修复后。
由 PIL 拼图，输出到 outputs/_diag/pageerror-guard/before-after-weather.png。
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT   = r"E:\ai_test\codex_test\suzhou-garden"
BEFORE = os.path.join(ROOT, "outputs", "_diag", "env-apply")          # 上一轮（带缺陷）
AFTER  = os.path.join(ROOT, "outputs", "_diag", "pageerror-guard")    # 本轮（已修复）
OUT    = os.path.join(AFTER, "before-after-weather.png")

BW, BH   = 560, 360      # 每格内容框（等比缩放后居中，留黑边，保证两行对齐）
PAD      = 20
HEAD_H   = 106
LABEL_H  = 46
FONTS    = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simsun.ttc"]

BG   = (14, 16, 20)
FG   = (238, 238, 238)
DIM  = (150, 155, 162)
RED  = (228, 96, 88)     # 缺陷 / 失败
GRN  = (96, 200, 128)    # 正常 / 通过


def font(size):
    for p in FONTS:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def fit(path, bw, bh):
    im = Image.open(path).convert("RGB")
    im.thumbnail((bw, bh), Image.LANCZOS)
    canvas = Image.new("RGB", (bw, bh), (8, 9, 12))
    canvas.paste(im, ((bw - im.width) // 2, (bh - im.height) // 2))
    return canvas


rows = [
    ("修复前", RED,
     os.path.join(BEFORE, "A-clear.png"), os.path.join(BEFORE, "B-storm.png"),
     "切暴雨像素差 0.80 —— 竟小于同状态两帧的 0.87：画面纹丝未动（render 从未执行）"),
    ("修复后", GRN,
     os.path.join(AFTER, "A-clear-clean.png"), os.path.join(AFTER, "B-storm-clean.png"),
     "切暴雨像素差 33.6 —— 雨幕压暗全部到位：切换真实生效"),
]

W = PAD + BW + PAD + BW + PAD
H = HEAD_H + len(rows) * (LABEL_H + BH + PAD) + PAD
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

d.text((PAD, 16), "苏州园林 · 「功能切换不起作用」修复前后", font=font(27), fill=FG)
d.text((PAD, 52), "每行：左 = 晴 clear，右 = 切暴雨 storm（真实点击「狂风暴雨」按钮，其余条件不变，同一机位）。",
       font=font(17), fill=DIM)
d.text((PAD, 76), "上排 = 修复前（每帧异常吃掉 render → 画面冻结）；下排 = 修复后。",
       font=font(17), fill=DIM)

y = HEAD_H
for name, color, pa, pb, note in rows:
    d.text((PAD, y + 10), name, font=font(22), fill=color)
    d.text((PAD + 92, y + 15), note, font=font(17), fill=DIM)
    y += LABEL_H
    img.paste(fit(pa, BW, BH), (PAD, y))
    img.paste(fit(pb, BW, BH), (PAD + BW + PAD, y))
    d.rectangle([PAD - 1, y - 1, PAD + BW, y + BH], outline=(70, 74, 80))
    d.rectangle([PAD + BW + PAD - 1, y - 1, PAD + 2 * BW + PAD, y + BH], outline=(70, 74, 80))
    y += BH + PAD

img.save(OUT)
print("已生成:", OUT, img.size)
